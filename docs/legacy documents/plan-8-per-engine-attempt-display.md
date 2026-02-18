# Plan 8 — Per-Engine Full Attempt Display

## Problem

When a student fragments a word (e.g., "overall" → "var" + "all"), the teacher-facing tooltip only shows the NW-matched fragment per engine:

```
V1: "all" | V0: "all" | Pk: "all"
```

The full attempt data exists in the pipeline but isn't surfaced:

```
V1 heard: "var" + "all"    (v1 alignment has insertion "var" + sub "all")
V0 heard: "var" + "all"    (v0Alignment has insertion "var" + sub "all")
Pk heard: "ovar" + "all"   (parakeetAlignment has insertion "ovar" + sub "all")
```

Additionally, `resolveNearMissClusters` checks individual insertions against ref words but never tries combining an insertion with the adjacent substitution's hyp — so "var" alone fails `isNearMiss("var", "overall")` and the struggle goes undetected.

## Approach: Three Targeted Fixes (~45 Lines Total)

No new pipeline stages. No architectural changes. Each part solves one concrete gap.

### Part A — Fix the Tooltip (UI-only, ~20 lines)

**File:** `js/ui.js`, tooltip builder around line 747-758

**Current state:** V1 evidence already includes insertions:
```js
// Line 749-756 — V1 already shows full attempt
const v1Parts = [];
for (const ins of insertionsBefore) v1Parts.push(ins.hyp);
if (entry.compound && entry.parts) v1Parts.push(...entry.parts);
else if (entry.hyp) v1Parts.push(entry.hyp);
for (const ins of insertionsAfter) v1Parts.push(ins.hyp);
const v1Ev = v1Parts.join(' + ');  // "var + all" ← already works!

// Line 757-758 — V0 and Pk only show the ref-matched word
const v0Ev = entry._v0Word || ...;   // "all" ← missing fragments
const pkEv = entry._xvalWord || ...; // "all" ← missing fragments
```

**Fix:** `v0Alignment` and `parakeetAlignment` are already available via `rawSttSources` (passed to `renderNewAnalyzedWords` at line 482). The `groupInsertions()` helper already exists (line 1972) and is used in the Step 1 debug table.

Compute V0/Pk insertion groups using the same `groupInsertions()` pattern, then build V0/Pk evidence strings the same way V1 evidence is already built:

```js
// Compute once at the top of renderNewAnalyzedWords
const v0Align = rawSttSources?.v0Alignment || [];
const pkAlign = rawSttSources?.parakeetAlignment || [];
const v0InsGroups = groupInsertions(v0Align);
const pkInsGroups = groupInsertions(pkAlign);
// v0InsGroups[i] = insertions before v0's i-th ref word
// Same ref-entry count invariant guarantees index alignment

// Then in the per-word tooltip builder (replacing lines 757-758):
const v0Parts = [];
const v0RefIdx = /* current ref index from the classified loop */;
if (v0InsGroups[v0RefIdx]) for (const ins of v0InsGroups[v0RefIdx]) v0Parts.push(ins.hyp);
const v0RefEntry = v0Ref[v0RefIdx];
if (v0RefEntry) v0Parts.push(v0RefEntry.hyp || '(omitted)');
const v0Ev = v0Parts.join(' + ') || '\u2014';

// Same pattern for Pk
```

**Result:** Tooltip shows "var + all / var + all / ovar + all".

**Risk:** Low. Pure display change. The ref-entry count invariant (filtering insertions from all alignments yields same-length arrays) guarantees the index `refIdx` lines up across V1/V0/Pk.

### Part B — Concatenated Fragment Near-Miss (~10 lines)

**File:** `js/diagnostics.js`, `resolveNearMissClusters()` around line 226-235

**Current state:** Priority 2 checks if a single insertion is near-miss of the next substitution's ref:
```js
// Line 226-234
if (nextEntry && (nextEntry.type === 'substitution' || nextEntry.type === 'struggle') &&
    clean(nextEntry.ref).length >= 3 &&
    isNearMiss(entry.hyp, nextEntry.ref)) {
  entry._partOfStruggle = true;
  // ...
}
```

For "var" → `isNearMiss("var", "overall")` → false (only 3 chars, no shared prefix/suffix ≥ 3, levenshtein ratio ~0.28). The insertion escapes all three priority checks.

**Fix:** After the individual check fails, try combining the insertion with the substitution's hyp:

```js
// After existing Priority 2 check (which handles individual near-miss):
// Fallback: try insertion + sub's hyp concatenated
if (nextEntry && (nextEntry.type === 'substitution' || nextEntry.type === 'struggle') &&
    clean(nextEntry.ref).length >= 3) {
  const combined = cleanedHyp + clean(nextEntry.hyp);
  const refClean = clean(nextEntry.ref);
  // Guard: combined length must be reasonable relative to ref
  if (combined.length >= refClean.length - 2 && combined.length <= refClean.length + 2 &&
      isNearMiss(combined, nextEntry.ref)) {
    entry._partOfStruggle = true;
    entry._nearMissTarget = nextEntry.ref;
    entry._combinedWith = nextEntry.hyp;
    if (!nextEntry._nearMissEvidence) nextEntry._nearMissEvidence = [];
    nextEntry._nearMissEvidence.push(entry.hyp);
    continue;
  }
}
```

For "var" + "all" = "varall" vs "overall": shared suffix "rall" = 4 chars ≥ 3 → `isNearMiss` returns true. Levenshtein ratio = 0.71 (also passes).

**Same pattern for Priority 3** (post-struggle, look behind): try combining the substitution's hyp + the insertion.

**Same pattern for Priority 1** (self-correction): try combining the insertion + the correct word's hyp. Guard: only if combined matches ref. (Student said fragments then got the word right.)

**Guards:**
- Length ratio: combined must be within ±2 chars of ref (prevents coincidental matches from wildly different-length strings)
- Only combine with the immediately adjacent entry (already the case — `nextEntry`/`prevEntry`)
- Only one insertion combined at a time (conservative; extend later if needed)

**Result:** "var" flagged `_partOfStruggle`, "all" (sub for "overall") upgraded to `type: 'struggle'` with `_nearMissEvidence: ["var"]`, `_strugglePath: 'decoding'`.

**Risk:** Low. The length guard + `isNearMiss` threshold make false positives unlikely. Only fires when an insertion is directly adjacent to a substitution AND their combined form resembles the ref.

### Part C — Store Per-Engine Attempt Context (~15 lines)

**File:** `js/app.js`, inside the existing 3-way comparison loop (line ~720-884)

**Current state:** The 3-way loop iterates over ref-aligned entries and stores single words:
```js
entry._v0Word = v0Entry?.hyp;
entry._xvalWord = pkEntry?.hyp;
```

**Fix:** In the same loop, also compute and store grouped attempts using the insertion arrays that are already available:

```js
// v0Alignment and parakeetAlignment are in scope
// v0InsGroups / pkInsGroups computed once before the loop (same groupInsertions pattern)

// Inside the per-ref-word loop, at index i:
const v0Ins = v0InsGroups[i] || [];
const pkIns = pkInsGroups[i] || [];

// Store full attempt (insertions + ref-matched word)
const v0Attempt = [...v0Ins.map(e => e.hyp)];
if (v0Entry?.hyp) v0Attempt.push(v0Entry.hyp);
if (v0Attempt.length > 1) entry._v0Attempt = v0Attempt;

const pkAttempt = [...pkIns.map(e => e.hyp)];
if (pkEntry?.hyp) pkAttempt.push(pkEntry.hyp);
if (pkAttempt.length > 1) entry._xvalAttempt = pkAttempt;
```

Only stored when there are 2+ words (fragments exist). Single-word cases don't need the array — `_v0Word` / `_xvalWord` already cover them.

**Result:** The alignment entry for "overall" carries:
```json
{
  "ref": "overall",
  "hyp": "all",
  "_v0Word": "all",
  "_v0Attempt": ["var", "all"],
  "_xvalWord": "all",
  "_xvalAttempt": ["ovar", "all"]
}
```

**Risk:** Low. Additive fields only. No existing fields modified. Downstream code that reads `_v0Word` / `_xvalWord` continues to work unchanged.

## Implementation Order

1. **Part C first** — Store per-engine attempt data in the 3-way loop. This makes the data available for both tooltip (Part A) and future diagnostics.
2. **Part A second** — Update tooltip to read `_v0Attempt` / `_xvalAttempt` (or compute from rawSttSources). Immediately visible to the teacher.
3. **Part B last** — Extend near-miss resolution with concatenation. This changes classification (substitution → struggle), so test carefully.

## Interaction with Existing Pipeline

- **Compound merge (alignment.js):** Unchanged. Still handles exact matches ("every"+"one"="everyone"). Part B catches what compound merge misses (near-miss fragments).
- **Compound struggle reclassification (app.js ~664):** Unchanged. Fires on exact compound merges with 2+ parts.
- **Fragment absorption (diagnostics.js):** Unchanged. Still absorbs BPE fragments by temporal containment. Part B's `_partOfStruggle` flag means fewer orphan insertions reach this stage.
- **resolveNearMissClusters:** Part B extends it, not replaces it. Existing individual-insertion checks still run first. Concatenation is a fallback.
- **UI classifyWord():** No changes needed. A struggle entry produced by Part B follows the same path as existing struggles. `_nearMissEvidence` triggers the existing upgrade logic (line 252-256 in diagnostics.js).

## Validation

Test with the "overall" case from `orf-debug-2026-02-12T03-35-37.json`:
- Before: tooltip shows "all / all / all", "var" is orphan insertion, "all" is plain substitution
- After Part C: entry has `_v0Attempt: ["var","all"]`, `_xvalAttempt: ["ovar","all"]`
- After Part A: tooltip shows "var + all / var + all / ovar + all"
- After Part B: "all" upgraded to struggle, "var" flagged `_partOfStruggle`

## Miscue Registry Update

Add to `DIAGNOSTIC_MISCUES.struggle.pathways`:

```js
fragmented_near_miss: 'Concatenated fragment: insertion + substitution hyp combined form is near-miss of ref (e.g., "var"+"all" ≈ "overall"). Detected via resolveNearMissClusters concatenation fallback.'
```
