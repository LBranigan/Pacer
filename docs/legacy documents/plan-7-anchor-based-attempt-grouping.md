# Plan 7 — Anchor-Based Attempt Grouping

## Problem Statement

When a student breaks a word into fragments (e.g., "overall" → "var" + "all"), the current pipeline loses the full picture:

- NW alignment picks ONE fragment per engine as the ref match, orphans the rest as insertions
- The 3-way comparison only sees the ref-matched fragment: `hyp: "all", _v0Word: "all", _xvalWord: "all"`
- The orphan insertion ("var" / "ovar") floats separately with no connection to the ref word
- The teacher tooltip shows "all / all / all" instead of "var + all / var + all / ovar + all"
- Diagnostics (resolveNearMissClusters, absorbMispronunciationFragments) try to reconnect fragments after the fact, but per-engine data is already lost

## Root Cause

The 3-way comparison (app.js ~line 720) filters out insertions before iterating over ref words:

```js
const v1Ref = alignment.filter(e => e.type !== 'insertion');
```

This discards the fragment data at the architectural level. Everything downstream is patching.

## Motivating Example

Reference: "...potential and **overall** brand recognition..."

| Engine | Raw Output | NW Alignment | What 3-Way Sees |
|--------|-----------|--------------|-----------------|
| V1 | "var" + "all" | insertion("var") + sub("all"/"overall") | "all" |
| V0 | "var" + "all" | insertion("var") + sub("all"/"overall") | "all" |
| Pk | "ovar" + "all" | insertion("ovar") + sub("all"/"overall") | "all" |

**Desired:** For ref "overall", each engine's FULL attempt: `["var","all"]`, `["var","all"]`, `["ovar","all"]`.

## Proposed Architecture

### Current Pipeline

```
1. Kitchen Sink → raw words per engine
2. Fragment pre-merge (BPE cleanup)
3. NW align each engine to reference (word-to-word)
4. Compound merge (exact match only: "every"+"one"="everyone" → correct)
5. 3-way comparison — ONE hyp per engine per ref word
6. Compound struggle reclassification
7. Disfluency classification
8. Omission recovery
9. Near-miss resolution (reconnect orphans after the fact)
10. Fragment absorption (reconnect more orphans)
11. Diagnostics
```

### Proposed Pipeline

```
1. Kitchen Sink → raw words per engine (unchanged)
2. Fragment pre-merge (BPE cleanup) (unchanged)
3. NW align each engine to reference (unchanged)
4. Compound merge for exact matches (unchanged)
5. NEW — Anchor-based attempt grouping (per engine)
6. 3-way comparison — FULL attempt per engine per ref word
7. Classification using grouped data (combined form vs ref)
8. Disfluency classification (unchanged)
9. Omission recovery (unchanged)
10. Near-miss resolution (simplified — grouping handles most cases)
11. Fragment absorption (simplified — grouping handles most cases)
12. Diagnostics (unchanged)
```

Steps 5-7 are the new/changed work. Everything else stays the same.

## Step 5 — Anchor-Based Attempt Grouping

### Concept

After NW alignment + compound merge, each engine's alignment looks like:

```
correct("and")                    ← anchor
insertion("var")                  ← orphan
substitution("all" / "overall")  ← ref-aligned
correct("brand")                  ← anchor
```

**Anchors** = correctly matched entries (type `correct`).

Between anchors "and" and "brand": 1 ref word ("overall"), 2 hyp words ("var", "all"). All hyp words in this region are the student's attempt at the ref word(s) in the region.

### Algorithm

```
For each engine's alignment (after NW + compound merge):
  1. Walk the alignment array
  2. Identify anchors (entries with type='correct', not compound-struggle)
  3. Between consecutive anchors, collect:
     - refEntries: entries with a ref word (substitution, omission, struggle, correct)
     - insertions: entries with type='insertion'
  4. For each refEntry in the region:
     - Attach nearby insertions as part of the attempt
     - Store: refEntry._attemptWords = [insertion hyps..., refEntry.hyp]
       (preserving temporal order)
  5. For correct entries with no extra insertions:
     - _attemptWords = [entry.hyp] (trivial — clean read)
```

### Edge Cases

**1 ref + N hyp (common — the "overall" case):**
All hyp words grouped under the single ref word.
`_attemptWords: ["var", "all"]`

**M ref + N hyp (multiple ref words between anchors):**
Use NW's existing assignment. Each ref-aligned entry claims the insertions closest to it (by array position). Split insertions between ref entries at the midpoint.

**0 ref + N hyp (all insertions, no ref words between anchors):**
True insertions — student added words. Leave as insertions, no grouping.

**Insertions before first anchor / after last anchor:**
True insertions or edge effects. Leave ungrouped.

**Compound-merged entries (e.g., "everyone"):**
Already merged by Step 4. Grouping sees a single correct entry, no fragments. `_attemptWords: ["everyone"]`.

## Step 6 — Enhanced 3-Way Comparison

### Current (line ~720)

```js
// Only sees one word per engine per ref slot
entry._v0Word = v0Entry.hyp;
entry._xvalWord = pkEntry.hyp;
```

### Proposed

```js
// Full attempt per engine per ref slot
entry._attemptWords = v1RefEntry._attemptWords;   // ["var", "all"]
entry._v0Attempt = v0RefEntry._attemptWords;       // ["var", "all"]
entry._xvalAttempt = pkRefEntry._attemptWords;     // ["ovar", "all"]

// Keep single-word fields for backward compatibility
entry._v0Word = v0Entry.hyp;      // "all" (best NW match — still useful)
entry._xvalWord = pkEntry.hyp;    // "all"
```

The `_attemptWords`, `_v0Attempt`, `_xvalAttempt` fields carry the full story. The existing `_v0Word`, `_xvalWord` fields stay for backward compatibility (many UI/diagnostic paths use them).

## Step 7 — Classification Using Grouped Data

After the 3-way comparison stores per-engine attempts, classify each ref word:

```
For each ref entry with _attemptWords:
  combined = attemptWords.join("")   // "varall"

  if combined === ref:
    → correct (compound — ASR split a correctly-read word)
    (This is what mergeCompoundWords does today for exact matches.
     Compound merge still runs first; this catches what it missed.)

  else if isNearMiss(combined, ref):
    → struggle (student attempted the word in fragments, near-miss)
    _strugglePath = 'fragmented_attempt'
    Parts preserved for tooltip: parts = attemptWords

  else:
    → keep NW's original classification (substitution)
    But still store _attemptWords for richer tooltip data
```

### "overall" Example After Fix

```json
{
  "ref": "overall",
  "hyp": "varall",
  "type": "struggle",
  "_strugglePath": "fragmented_attempt",
  "_attemptWords": ["var", "all"],
  "_v0Attempt": ["var", "all"],
  "_xvalAttempt": ["ovar", "all"],
  "parts": ["var", "all"],
  "_v0Word": "all",
  "_xvalWord": "all",
  "crossValidation": "confirmed"
}
```

## UI Changes

### Tooltip (ui.js)

Currently reads `entry.hyp`, `entry._v0Word`, `entry._xvalWord` → shows "all / all / all".

After: if `entry._attemptWords` exists, show joined with " + ":
- V1: "var + all"
- V0: "var + all" (from `_v0Attempt`)
- Pk: "ovar + all" (from `_xvalAttempt`)

### Classification Buckets

The `classifyWord()` function in ui.js maps internal types to teacher-facing buckets. A `type: 'struggle'` with `compound: true` and `parts.length >= 2` currently → `attempted-struggled` (orange). The new `_strugglePath: 'fragmented_attempt'` would follow the same path.

## What This Simplifies Downstream

### resolveNearMissClusters (diagnostics.js)

Currently tries to reconnect orphan insertions to nearby substitutions using text similarity. After grouping, many of these insertions are already associated with their ref word. The function still adds value for cases where insertions escape the anchor-based grouping (e.g., insertions at passage boundaries), but its workload is reduced.

### absorbMispronunciationFragments (diagnostics.js)

Currently uses temporal containment to absorb short BPE fragments into nearby substitutions/struggles. After grouping, most fragments are already captured. This function becomes a safety net rather than a primary mechanism.

### Compound merge (alignment.js)

Still runs for exact matches (Step 4). The grouping step (Step 5) catches what compound merge misses (near-miss fragments). No changes needed to compound merge itself.

## Edge Case: True Insertions vs Fragments

Between anchors, not all extra hyp words are fragments. Student might say "the really big dog" for ref "the big dog" — "really" is a true insertion, not a fragment of "big".

**How classification handles this (Step 7):**
- Anchor "the" → anchor "dog", ref has "big", hyp has "really" + "big"
- `_attemptWords: ["really", "big"]`
- Combined "reallybig" is NOT near-miss of "big"
- Classification: keep NW's original assignment ("big" = correct, "really" = insertion)
- The `_attemptWords` grouping collected them, but classification determines they're unrelated

This means grouping is **permissive** (collects everything in the region) and classification is **selective** (uses similarity to determine what's actually part of the attempt). This separation keeps the grouping step simple and free of threshold tuning.

## Implementation Order

1. **Anchor-based grouping function** — New function in alignment.js or a new file. Takes an alignment array, returns the same array with `_attemptWords` added to ref entries. Pure, testable, no side effects on existing fields.

2. **Wire grouping into pipeline** — Call after compound merge, before 3-way comparison. Apply to V1, V0, and Pk alignments independently.

3. **Enhanced 3-way comparison** — Store `_v0Attempt` and `_xvalAttempt` alongside existing fields. No breaking changes (existing fields preserved).

4. **Classification pass** — After 3-way, check combined attempt form. Upgrade to struggle if near-miss. Keep original type if combined form doesn't match.

5. **UI tooltip update** — Read `_attemptWords` / `_v0Attempt` / `_xvalAttempt` when available. Fall back to existing `hyp` / `_v0Word` / `_xvalWord`.

6. **Miscue registry update** — Add `fragmentedAttempt` entry to DIAGNOSTIC_MISCUES.

## Risk Assessment

**Low risk:**
- Grouping is additive (adds `_attemptWords`, doesn't modify existing fields)
- Existing fields (`_v0Word`, `_xvalWord`, `hyp`) preserved for backward compatibility
- Compound merge still handles exact cases before grouping runs

**Medium risk:**
- Classification step (Step 7) changes `type` for some entries (substitution → struggle)
- This affects error counts — but in the RIGHT direction (1 struggle instead of 1 sub + 1 insertion)
- UI bucket mapping may need adjustment for new `_strugglePath` value

**Watch for:**
- Multi-ref regions (M ref + N hyp between anchors) — insertion assignment heuristic
- Passage boundaries (no anchor before first word / after last word)
- Interaction with omission recovery (recovered words become new anchors?)
- Existing compound struggle reclassification — may overlap with new classification step
