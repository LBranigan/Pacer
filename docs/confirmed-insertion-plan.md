# Plan: Confirmed Insertions (3-Engine Agreement → Error)

## Problem

Currently, **all insertions are treated equally** — none count as errors per ORF standards. But there's a meaningful diagnostic difference:

- **Single-engine insertion**: Likely an ASR artifact (BPE fragment, hallucination, echo). Shouldn't count as error.
- **3-engine confirmed insertion**: All three engines (V1, V0, Parakeet) independently heard the same extra word. The student **definitely** said something not in the passage. This is a real reading error — the student added a word.

Examples:
- Student reads "the big dog" for ref "the dog" — all 3 engines hear "big" → confirmed insertion → error
- Student repeats "the the dog" — all 3 engines hear two "the"s → confirmed insertion → error
- V1 hears a BPE fragment "pla" but V0 and Parakeet don't → unconfirmed insertion → not an error

## Approach

Extend the existing insertion cross-validation (currently V1→Parakeet only) to check all 3 engines. When all 3 agree on an insertion, flag it as `_confirmedInsertion: true` and count it as an error.

## Changes

### 1. `js/app.js` — 3-way insertion cross-validation

Currently (lines 955-995), V1 insertions are only checked against Parakeet. Extend to also check V0.

After the existing `v1InsGroups`, `v0InsGroups`, `pkInsGroups` grouping (line 750-764), add a 3-way insertion comparison loop:

For each ref-word boundary position `i`:
- Get V1 insertions: `v1InsGroups[i]`
- Get V0 insertions: `v0InsGroups[i]`
- Get Pk insertions: `pkInsGroups[i]`
- For each V1 insertion, normalize and check if the same word appears in **both** V0 and Pk insertion lists at that position
- If all 3 engines heard it: `entry._confirmedInsertion = true`

This replaces the current binary V1→Parakeet-only cross-validation for insertions. The existing `crossValidation: 'confirmed'/'unconfirmed'` on insertions still gets set, but `_confirmedInsertion` is the stronger 3-engine flag.

**Exclusions** — skip confirmed insertion flagging for:
- Fillers (`_preFilteredDisfluency` or `isDisfluency`) — "um"/"uh" are disfluencies, not added words
- Self-corrections (`_isSelfCorrection`) — already classified
- Struggle fragments (`_partOfStruggle`) — already classified
- CTC artifacts (`_ctcArtifact`) — already filtered

### 2. `js/app.js` — Error counting

In the accuracy/WCPM calculation section, add confirmed insertions to the error count:

```js
const confirmedInsertionCount = alignment.filter(e => e._confirmedInsertion).length;
const errors = substitutions + omissions + longPauses + confirmedInsertionCount;
```

Currently: `errors = substitutions + omissions + longPauses`
After: `errors = substitutions + omissions + longPauses + confirmedInsertions`

### 3. `js/ui.js` — Legend entry

Add a new legend item for confirmed insertions in the legacy legend bar and ensure the new analyzed words view renders them distinctly.

**Legend tooltip**:
```
Confirmed Insertion — student added a word not in the reference, confirmed by all 3 engines.

Logic: V1, V0, and Parakeet all independently heard the same extra word at the same position in the passage. Counts as an error.

Example: Reference "the dog" → Student says "the big dog" → all 3 engines hear "big" → confirmed insertion (error)
```

### 4. `js/ui.js` — Rendering in analyzed words

In `renderNewAnalyzedWords`, confirmed insertions get a distinct CSS class (`word-confirmed-insertion`) so they're visually different from regular fragments. They should appear more like substitutions/omissions (error-colored) than like fragments (purple).

In the insertion rendering logic, check `ins._confirmedInsertion` and render with the error class instead of the fragment class.

### 5. `style.css` — New CSS class

```css
.word-confirmed-insertion {
  background: #ffcdd2;  /* light red, like substitution */
  color: #c62828;
  border-radius: 3px;
  padding: 0 3px;
  font-weight: 600;
}
```

### 6. `js/ui.js` — STT Transcript Step 1 verdict

In the insertion verdict column (line 2293), add a case for confirmed insertions:

```js
if (ins._confirmedInsertion) label = 'confirmed insertion ✗';
```

### 7. `js/ui.js` — STT Transcript Step 3 post-processing

Add a new section in the post-processing step listing confirmed insertions, similar to how compound merges and self-corrections are listed.

### 8. `js/miscue-registry.js` — Document the new type

Add a new entry:

```js
confirmed_insertion: {
  description: 'Student added a word not in the reference passage, confirmed by all 3 ASR engines',
  detector: 'app.js — 3-way insertion comparison after alignment',
  countsAsError: true,
  config: {},
  uiClass: 'word-confirmed-insertion',
  example: 'Reference "the dog" → Student says "the big dog" → all engines hear "big" → confirmed insertion'
}
```

### 9. `js/diagnostics.js` — Insertion count adjustment

The diagnostics `insertions` count currently excludes self-corrections, struggle fragments, disfluencies. Confirmed insertions should be counted separately in the metrics summary since they're now errors.

### 10. `index.html` — Version bump

Update version timestamp.

## Files Modified

| File | Change |
|------|--------|
| `js/app.js` | 3-way insertion cross-validation, error count adjustment |
| `js/ui.js` | Legend entry, rendering, STT Transcript verdict + post-processing |
| `style.css` | `.word-confirmed-insertion` class |
| `js/miscue-registry.js` | Document new type |
| `js/diagnostics.js` | Separate confirmed insertion count in metrics |
| `index.html` | Version bump |

## What Does NOT Change

- `js/alignment.js` — insertions still produced the same way by NW alignment
- `js/word-equivalences.js` — no equivalence changes
- `js/cross-validator.js` — engine-agnostic orchestrator unchanged
- `normalizeText()` — no token count change

## Edge Cases

1. **Filler words** ("um", "uh"): Pre-filtered disfluencies are excluded — they're tagged before the 3-way check and skipped. A filler heard by all 3 engines stays a filler, not a confirmed insertion.

2. **Self-corrections**: Near-miss insertions already classified as self-corrections are skipped. "epi-" before "epiphany" stays a self-correction even if all 3 engines heard it.

3. **Compound fragments**: Insertions absorbed into compound merges or struggle clusters are skipped.

4. **Repeated words**: "the the dog" → V1 alignment produces one correct "the" + one insertion "the". If all 3 engines heard the repeat, the insertion "the" becomes a confirmed insertion (error). This is correct — the student added an extra word.

5. **Number expansions / abbreviation expansions**: These are merged into compound entries before insertion cross-validation runs, so they won't be falsely flagged.

6. **Only 2 engines available**: If V0 or Parakeet is unavailable, require agreement from the 2 available engines (V1 + whichever is present). The flag could be `_confirmedInsertion` only when both available non-V1 engines agree, or we could require strict 3-engine agreement and skip when an engine is missing. **Recommendation**: Require all available engines to agree — if only V1+Pk available, both must hear it. If all 3 available, all 3 must agree.

## Verification

1. Test with a passage where student adds a word ("the big dog" for "the dog") — should flag "big" as confirmed insertion and count as error
2. Test with a filler ("um") — should NOT become confirmed insertion even if all engines hear it
3. Test with a BPE fragment heard by V1 only — should stay as regular insertion (not error)
4. Verify WCPM and accuracy metrics correctly include confirmed insertions in error count
5. Verify STT Transcript Step 1 shows "confirmed insertion ✗" verdict
6. Verify legend tooltip is accurate
