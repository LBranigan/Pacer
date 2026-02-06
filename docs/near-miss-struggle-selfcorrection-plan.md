# Near-Miss Detection: Struggle Words & Self-Corrections

**Date:** 2026-02-06
**Status:** Implemented
**Triggered by:** Test `orf-debug-2026-02-06T04-58-16.json`

---

## Problem Statement

The current system misclassifies two important reading patterns:

1. **"station" case** — Student said `sta`, `tieion`, `staion` (three failed attempts). Currently classified as 1 substitution + 2 insertions. Should be: **struggle word** (student demonstrated partial knowledge but never produced the word).

2. **"epiphany" case** — Student said `epi-` then successfully said `epiphany`. Currently classified as 1 insertion + 1 correct. Should be: the insertion is a **self-correction** (student attempted, failed, then corrected).

3. **Insertions** should be informational signals (helping identify struggles and self-corrections), not errors.

---

## Design Decisions

| Decision | Resolution | Rationale |
|----------|-----------|-----------|
| Struggle counts as error? | **Yes** | Struggle = "substitution but worse." Student never produced the word. Still an error for WCPM/accuracy. |
| Model disagreement required for near-miss struggle? | **No** | Phonetic near-miss evidence is sufficient. If both models agree on "staion" (wrong), that's *stronger* evidence of struggle. |
| Replace DIAG-03 self-corrections? | **No** | Keep existing word/phrase repeat detection. *Add* near-miss insertion detection alongside it. |
| Multiple paths to struggle? | **Yes** | Path 1: modified (substitution + pause ≥3s + >3 chars). Path 2: new (substitution + near-miss insertions + >3 chars). Both are "substitution+" — struggle always counts as error. |
| Processing approach? | **Single-pass cluster resolution** | No multi-pass race conditions. Each insertion evaluated once and assigned to at most one category. |
| Short word protection? | **Both** insertion AND reference word must be >= 3 chars after cleaning | Prevents "cat" vs "cap" (2-char shared prefix) from triggering false near-miss. |

---

## The Near-Miss Algorithm

### `isNearMiss(insertionText, referenceWord)`

New utility function in `diagnostics.js`.

```
Clean both: lowercase, strip punctuation
If either < 3 chars → false (hard gate)
Check shared prefix >= 3 chars → true
Check shared suffix >= 3 chars → true
Check Levenshtein ratio >= 0.4 → true
Otherwise → false
```

**Validation against test data:**

| Insertion | Reference | Prefix | Suffix | Levenshtein | Result |
|-----------|-----------|--------|--------|-------------|--------|
| `tieion` | `station` | 0 (t≠s) | 3 (`ion`) | ~0.43 | **near-miss** |
| `staion` | `station` | 3 (`sta`) | 4 (`tion`) | ~0.86 | **near-miss** |
| `epi` (from `epi-`) | `epiphany` | 3 (`epi`) | — | — | **near-miss** |
| `cat` | `cap` | 2 (`ca`) | 0 | 0.33 | **blocked** (< 3 chars shared, ratio < 0.4) |

**Dependency:** Imports `levenshteinRatio` from `nl-api.js` (already exported).

---

## The Single-Pass Cluster Resolution

### `resolveNearMissClusters(alignment)`

New function in `diagnostics.js`. Called once after alignment, before diagnostics.

**Algorithm:**

```
for each insertion in alignment:
  Clean insertion hyp text
  if cleaned text < 3 chars → skip

  Find nearest preceding non-insertion entry (prevEntry)
  Find nearest following non-insertion entry (nextEntry)

  PRIORITY 1 — Self-correction (look ahead for success):
    If nextEntry.type === 'correct'
    AND nextEntry.ref (cleaned) >= 3 chars
    AND isNearMiss(insertion.hyp, nextEntry.ref)
    → Mark insertion: _isSelfCorrection = true, _nearMissTarget = nextEntry.ref

  PRIORITY 2 — Pre-struggle (look ahead for failure):
    If nextEntry.type === 'substitution'
    AND nextEntry.ref (cleaned) >= 3 chars
    AND isNearMiss(insertion.hyp, nextEntry.ref)
    → Mark insertion: _partOfStruggle = true, _nearMissTarget = nextEntry.ref
    → Accumulate on nextEntry._nearMissEvidence[]

  PRIORITY 3 — Post-struggle (look behind for failure):
    If prevEntry.type === 'substitution'
    AND prevEntry.ref (cleaned) >= 3 chars
    AND isNearMiss(insertion.hyp, prevEntry.ref)
    → Mark insertion: _partOfStruggle = true, _nearMissTarget = prevEntry.ref
    → Accumulate on prevEntry._nearMissEvidence[]

After the pass — upgrade substitutions with evidence:
  for each entry with _nearMissEvidence[]:
    → Change type from 'substitution' to 'struggle'
    → Set _originalType = 'substitution'
```

**Why three priorities?** Students can stutter/fragment both *before* and *after* the word they fail on. diff-match-patch can produce either ordering depending on its edit path. The "look both ways" approach handles all topologies:

- **Post-struggle** (common): `sub(station→sta), ins(tieion), ins(staion)` — insertions come after the substitution. Caught by Priority 3.
- **Pre-struggle** (uncommon): `ins(sta), sub(station→tion)` — insertion comes before the substitution. Caught by Priority 2.
- **Sandwich** (both): `ins(sta), sub(station→tion), ins(staion)` — insertions on both sides. `sta` caught by Priority 2, `staion` caught by Priority 3.

**Why self-correction wins highest priority:** If an insertion is a near-miss for a following correct word, the student *did* eventually produce the word. That's a positive outcome (self-correction), not evidence of failure (struggle).

**Why look-ahead-for-failure beats look-behind:** If an insertion sits between two substitutions and is a near-miss for both, Priority 2 assigns it to the following substitution. Rationale: temporal ordering — a fragment is more likely a leading attempt at the upcoming word than a trailing attempt at the previous one. This is a reasonable default for an extremely rare case.

**Why this is race-condition-free:** Each insertion is evaluated exactly once, top-to-bottom through priorities, assigned to the first match. Single forward pass, no revisiting.

### Type Strategy

| Classification | Type change? | Mechanism | Rationale |
|----------------|-------------|-----------|-----------|
| **Struggle** | `substitution` → `struggle` | Structural type change | Affects scoring. Same positional behavior as substitution (advances both ref + hyp indices). Safe for all downstream code. |
| **Self-correction** (near-miss) | Stays `insertion`, flag `_isSelfCorrection = true` | Flag only | Avoids downstream breakage. Self-corrections have `ref: null` and must behave like insertions for index tracking in `buildHypToRefMap()` etc. |
| **Part of struggle** | Stays `insertion`, flag `_partOfStruggle = true` | Flag only | Filtered from "Inserted words" UI section. Shown in struggle word tooltip. |

---

## How Test Cases Would Be Processed

### "station" (struggle)

**Student produced:** `bus` → `sta` → `tieion` → `staion` → gave up

| Step | What happens |
|------|-------------|
| Alignment | `correct(bus)`, `sub(station→sta)`, `ins(tieion)`, `ins(staion)` |
| Cluster resolution | `tieion` near-miss for "station" (suffix "ion") → `_partOfStruggle`. `staion` near-miss for "station" (prefix "sta") → `_partOfStruggle`. Substitution gets `_nearMissEvidence: ["tieion", "staion"]` → type changed to `struggle`. |
| Metrics | Struggle counted as error. Accuracy decreases. |
| UI | "station" shows in teal with tooltip: "Struggle: 3 attempts (sta, tieion, staion)" |

### "epiphany" (self-correction)

**Student produced:** `epi-` → pause → `epiphany`

| Step | What happens |
|------|-------------|
| Alignment | `ins(epi-)`, `correct(epiphany)` |
| Cluster resolution | `epi-` near-miss for "epiphany" (prefix "epi"), following entry is `correct` → `_isSelfCorrection = true` |
| Metrics | Not counted as error (stays insertion internally). |
| UI | "epiphany" shows green (correct). Self-corrections section shows "'epi-' → 'epiphany'" in purple. |

### "station" reversed alignment (pre-struggle edge case)

**Student produced:** `sta` → `tion` — DMP pairs "tion" as the substitution

| Step | What happens |
|------|-------------|
| Alignment | `ins(sta)`, `sub(station→tion)` |
| Cluster resolution | `sta`: nextEntry is `sub(station→tion)`. Priority 2 (look ahead for failure): isNearMiss("sta", "station") = prefix "sta" ≥ 3. Marked `_partOfStruggle`, evidence on `tion`. Substitution `tion` has `_nearMissEvidence: ["sta"]` → type changed to `struggle`. |
| Metrics | 1 struggle error (same as 1 substitution — no double penalty). |
| UI | "station" shows teal with tooltip: "Struggle (decoding error): 2 attempts (sta, tion)" |

### "station" sandwich (both pre- and post-struggle)

**Student produced:** `sta` → `tion` → `staion`

| Step | What happens |
|------|-------------|
| Alignment | `ins(sta)`, `sub(station→tion)`, `ins(staion)` |
| Cluster resolution | `sta`: Priority 2 matches (look ahead → sub for "station"). `staion`: Priority 3 matches (look behind → sub for "station"). Both accumulate on the substitution. → type changed to `struggle`. |
| UI | "station" shows teal with tooltip: "Struggle (decoding error): 3 attempts (sta, tion, staion)" |

### "bird" → "dirt" (unchanged)

- Stays as substitution. No near-miss insertions around it. No change.

---

## File-by-File Changes

### 1. `js/diagnostics.js`

**Add:**
- `isNearMiss(insertionText, referenceWord)` — near-miss detection utility (exported)
- `resolveNearMissClusters(alignment)` — single-pass cluster resolution (exported)

**Import:** `levenshteinRatio` from `nl-api.js`

**Update `detectMorphologicalErrors()`:** Also check `type === 'struggle'` (not just `type === 'substitution'`) so morphological annotations are preserved on struggle words.

**Modify `detectStruggleWords()`:** Change from operating on correct transcriptWords to operating on alignment entries. New logic: iterate alignment entries where `type === 'substitution'` (or `type === 'struggle'` from Path 2), check for pause >= 3s before the word using transcriptWords timing data, and if ref word > 3 chars → upgrade to `struggle` with `_strugglePath = 'hesitation'`. For entries already upgraded by Path 2, add `_hasHesitation = true` for richer tooltips. Correct words with hesitation are no longer flagged as "struggle" — onset delay tooltips (DIAG-05) still surface that information.

**Keep unchanged:** All other existing detectors (DIAG-01 through DIAG-07).

### 2. `js/app.js`

**Integration point** — after alignment + compound word merging, before diagnostics:

```javascript
const alignment = alignWords(referenceText, transcriptWords);
// ... compound word merging, severity propagation (existing) ...

// EXISTING: Omission recovery (Deepgram healing) — must run BEFORE cluster resolution
// Converts omissions to correct when Deepgram confirms the word was spoken.
// Without this ordering, self-corrections after recovered words would be missed
// (e.g., ins(epi-) → omission(epiphany) would not resolve because Priority 1
// requires nextEntry.type === 'correct', not 'omission').
recoverOmissions(alignment, unconsumedDeepgram, ...);

// NEW: Resolve near-miss clusters — Path 2 (single pass)
// Now sees correct entries created by omission recovery.
resolveNearMissClusters(alignment);

// ... existing: diagnostics (includes modified detectStruggleWords — Path 1), VAD, etc. ...
// Path 2 runs first (structural evidence), then Path 1 runs during diagnostics (temporal evidence).
// Path 1 checks both remaining substitutions AND struggles already upgraded by Path 2.
```

**Update alignment stage logging:** Add struggle/self-correction counts.

**Update existing self-correction reclassification (lines ~839-871):** Skip insertions already claimed by near-miss resolution:

```javascript
if (entry.type === 'insertion' && !entry._isSelfCorrection && !entry._partOfStruggle) {
  if (scHypIndices.has(hypIdx)) {
    entry.type = 'self-correction'; // existing DIAG-03 path
  }
}
```

**Update metrics_computed stage:** Include struggles in alignmentSummary.

### 3. `js/metrics.js`

**`computeAccuracy()`** — add struggle handling:

```javascript
case 'struggle':
  struggles++;  // new counter — counts as error
  break;

case 'insertion':
  // Exclude claimed insertions from reported count
  if (!entry._partOfStruggle && !entry._isSelfCorrection) {
    insertions++;
  }
  break;
```

Update: `totalRefWords = correctCount + substitutions + omissions + struggles`

Return `struggles` in the result object alongside substitutions/omissions/insertions. Insertion count excludes `_partOfStruggle` and `_isSelfCorrection` entries — these are accounted for under "struggle" and "self-correction" respectively, so counting them as insertions would be double-reporting.

**`computeWCPMRange()`** — no change needed. Struggle words are not `correct`, so they're already excluded from correct count.

### 4. `js/ui.js`

**Main alignment rendering loop — handle `item.type === 'struggle'`:**
- CSS class: `word word-struggle` (existing teal/cyan style)
- Text: `item.ref` (the reference word, like substitution)
- Tooltip must clearly identify as decoding error: "Expected: station, Said: sta\nStruggle (decoding error): 3 attempts (sta, tieion, staion)"
- Morphological overlay still applies if detected

**Tooltip distinction for Path 1 vs Path 2 struggle (both are errors):**
- Path 1 (pause struggle): "Struggle (hesitation): 3.5s pause before failed word"
- Path 2 (decoding struggle): "Struggle (decoding error): 3 attempts (sta, tieion, staion)"
- Both paths (word has both evidence types): "Struggle (decoding error): 3 attempts (sta, tieion, staion)\n3.2s pause before word"
- Same visual style (teal), same scoring impact. Tooltip explains the evidence type.

**Insertions section — filter out claimed insertions:**

```javascript
const regularInsertions = insertions.filter(ins => {
  if (ins.partOfForgiven) return false;
  if (ins._isSelfCorrection) return false;
  if (ins._partOfStruggle) return false;
  // existing disfluency filter...
  return true;
});
```

**Self-corrections section — augment with near-miss self-corrections:**

Collect `alignment.filter(a => a._isSelfCorrection)` and render alongside DIAG-03 self-corrections. Display as purple: `"'epi-' → 'epiphany' (self-correction)"`.

**Metrics error box — include struggles:**

```
"2 substitutions, 0 omissions, 1 struggle, 0 insertions"
```

### 5. `js/miscue-registry.js`

**Update `struggle`:**
- `countsAsError: true` (changed from false)
- `detector:` updated to reference both paths
- `description:` updated: "Substitution+ — student failed to produce the word, with additional evidence of decoding difficulty (long pause and/or near-miss fragments). Always an error."
- `config:` add `near_miss_min_shared_affix: 3`, `near_miss_levenshtein_threshold: 0.4`, `pause_threshold_s: 3`
- Updated example showing "station" case
- **Clarity note:** The `struggle` alignment type is always "substitution+". It only exists when the student failed to produce the word. Correct words with hesitation do not become `struggle` — they remain `correct` with onset delay information.

**Update `selfCorrection`:**
- `detector:` updated to reference both DIAG-03 and near-miss detection
- Updated example showing "epi-" → "epiphany" case

### 6. `style.css`

Existing `.word-struggle` class (teal/cyan with dotted border) is kept. It's diagnostically useful to visually distinguish "student tried hard and failed" from "student said a completely different word" even though both count as errors.

### 7. `index.html`

Version bump per CLAUDE.md: update `#version` element.

---

## Struggle Word: Two Paths (Substitution+ Logic)

Both paths detect the same fundamental outcome: **the student failed to produce the word.** Both upgrade a `substitution` to `struggle`. Both count as errors. The difference is only in what *evidence* triggered the upgrade — temporal (long pause) or structural (near-miss fragments).

This "substitution+" model keeps the concept clean: `struggle` always means "substitution but with additional evidence of decoding difficulty." The value is **error bucketing** — what would otherwise appear as 1 substitution + 2 insertions (3 separate items) is consolidated into 1 struggle with a clear explanation.

### Path 1 — Pause Struggle ("long pause before a failed word")

**Detector:** `diagnostics.js → detectStruggleWords()` (modified)
**Operates on:** `alignment` entries, cross-referenced with `transcriptWords` pause data
**Effect:** Changes alignment type from `substitution` to `struggle`. Sets `_strugglePath = 'hesitation'`.
**Scoring:** **Counts as error.** The student paused significantly and still did not produce the word.
**Meaning:** The student needed extra decoding time and ultimately failed.
**Criteria:**
1. Alignment entry is `substitution` (or already `struggle` from Path 2 — adds hesitation evidence)
2. Pause >= 3s before the word (from transcriptWords timing data)
3. Reference word > 3 characters

**Example:** Student pauses 3.5 seconds before "elephant", then says "elphant" (substitution). Long pause + failure → upgraded to struggle.

**Note:** The existing `detectStruggleWords()` currently flags *correct* words with hesitation. Under the new model, it is modified to only flag *substitutions* (and existing struggles). Correct words with hesitation remain correct — the hesitation is still visible via onset delay tooltips (DIAG-05) but is not called "struggle."

### Path 2 — Decoding Struggle ("near-miss fragments around a failed word")

**Detector:** `diagnostics.js → resolveNearMissClusters()` (new)
**Operates on:** `alignment` entries
**Effect:** Changes alignment type from `substitution` to `struggle`. Sets `_strugglePath = 'decoding'`.
**Scoring:** **Counts as error.** The student never produced the word correctly.
**Meaning:** The student made multiple near-miss attempts but could not produce the reference word.
**Criteria:**
1. A substitution exists for a reference word (>= 3 chars)
2. Nearby insertions (>= 3 chars) are morphologically/phonetically similar to the reference word
3. The reference word was never correctly produced

**Example:** Student says "sta", "tieion", "staion" for "station" — three attempts, none correct. Word is a decoding struggle (error).

### UI Distinction

Both paths produce the same type (`struggle`) and both count as errors. The **tooltip** distinguishes the evidence type so teachers understand what happened:

| | Path 1: Pause Struggle | Path 2: Decoding Struggle | Both Paths |
|---|---|---|---|
| **CSS** | `word word-struggle` | `word word-struggle` | `word word-struggle` |
| **Tooltip** | "Struggle (hesitation): 3.5s pause before failed word" | "Struggle (decoding error): 3 attempts (sta, tieion, staion)" | "Struggle (decoding error): 3 attempts (sta, tieion, staion)\n3.2s pause before word" |
| **Affects accuracy?** | Yes | Yes | Yes |
| **Teacher takeaway** | Student could not decode this word after extended effort | Student made multiple failed attempts at this word | Both signals reinforce: this word needs targeted instruction |

---

## Known Considerations

1. **DIAG-03 "not working" issue:** Existing word/phrase repeat detection may not fire because Kitchen Sink pipeline (Reverb) absorbs repetitions as disfluencies before DIAG-03 sees them. The new near-miss detection sidesteps this entirely (looks at alignment structure, not transcript patterns). DIAG-03 can be investigated separately if needed.

2. **Morphological + struggle overlap:** A struggle word like "station" → "sta" already fires the morphological detector (shared prefix "sta" >= 3). After upgrading to `struggle` type, `detectMorphologicalErrors()` needs to check `type === 'struggle'` in addition to `type === 'substitution'` so the morphological annotation is preserved.

3. **Levenshtein cross-module import:** `diagnostics.js` will import `levenshteinRatio` from `nl-api.js`. This is a clean pure-function dependency. Alternative: duplicate the small function into diagnostics.js to keep the module self-contained.

4. **Struggle visual style:** Keep the existing teal/cyan for both paths. The teal communicates "this word was a struggle" and is always an error. The *tooltip* distinguishes the evidence type — "Struggle (hesitation): 3.5s pause" vs "Struggle (decoding error): 3 attempts (...)" — so teachers understand what happened, even though both affect scoring equally.

5. **Correct words with hesitation:** Under the old model, `detectStruggleWords()` flagged correct words with hesitation as "struggle." Under the new model, these words remain `correct`. Hesitation on correct words is still visible via DIAG-05 onset delay tooltips (e.g., "Onset delay: 640ms") — the diagnostic information is preserved, it's just not called "struggle."
