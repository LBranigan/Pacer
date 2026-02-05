# Cross-Validation Rewrite: Sequence Alignment + Honest Struggle Detection

## Problem Statement

Three interconnected issues with the current cross-validation pipeline:

1. **Text-based matching silently discards Deepgram data on disagreements.** The greedy queue lookup in `crossValidateWithDeepgram()` matches by normalized word text. When Reverb hears "jued" and Deepgram hears "jumped", they don't match — Deepgram's word is silently lost, and the word is marked "unconfirmed" with no `_deepgramWord`.

2. **"Unconfirmed" conflates two very different situations.** Currently it means "no Deepgram text match found." But that could mean: (a) Deepgram heard a *different* word at the same position (a disagreement — likely a mispronunciation), or (b) Deepgram heard *nothing* at that position (true silence/null). These need different labels.

3. **Struggle detection depends on confidence scores we've established are unreliable.** The `detectStruggleWords()` function requires `confidence < 0.70`. For confirmed words, Deepgram gives ~99% (struggle can never fire). For unconfirmed words, Reverb gives ~0% (struggle always fires). The detector is accidentally filtering by cross-validation status, not by actual confidence.

---

## Solution Overview

Replace the greedy text-queue cross-validation with **Needleman-Wunsch sequence alignment** (already implemented in `sequence-aligner.js`), add a new **"disagreed"** status, and replace the confidence check in struggle detection with cross-validation status.

---

## Changes

### 1. Rewrite `crossValidateWithDeepgram()` in `js/deepgram-api.js`

**Current approach (delete):**
```
Build Map<normalizedText, queue[]> from Deepgram words
For each Reverb word: lookup text in map → confirmed or unconfirmed
```

**New approach:**
```
Extract word strings from both Reverb and Deepgram arrays
Run Needleman-Wunsch alignment (import from sequence-aligner.js)
Walk the alignment to pair Reverb words with Deepgram words positionally
```

**Scoring parameters** — different from the disfluency use case:
```javascript
const XVAL_OPTIONS = {
  match: 2,        // Same word in both engines (ideal)
  mismatch: 0,     // Different word at same position (disagreement — expected for mispronunciations)
  gapInsert: -1,   // Reverb word with no Deepgram counterpart
  gapDelete: -1    // Deepgram word with no Reverb counterpart
};
```

Rationale for symmetric gap penalties: unlike the v=1.0 vs v=0.0 case (where insertions are expected disfluencies), there's no prior reason to favor either engine producing extra words.

Rationale for `mismatch: 0` instead of `-1`: mismatches are the interesting case (like "jued"/"jumped"). We don't want to penalize them so heavily that the aligner prefers gap+gap over a mismatch, because we'd lose the pairing.

**Walk the alignment result and classify each entry:**

| NW result | Reverb word | Deepgram word | crossValidation | Properties set |
|-----------|-------------|---------------|-----------------|----------------|
| `match` | present | present, same text | `'confirmed'` | Deepgram timestamps, Deepgram confidence, `_deepgramWord` |
| `mismatch` | present | present, different text | `'disagreed'` | Deepgram timestamps, Deepgram confidence, `_deepgramWord` (shows what DG heard) |
| `insertion` | present | none | `'unconfirmed'` | Reverb timestamps only, Reverb confidence, `_deepgramWord: null` |
| `deletion` | none | present (extra DG word) | — | Logged as unconsumed but not added to word list |

**For `'disagreed'` words:** We still promote Deepgram timestamps (they have real durations, Reverb has 100ms). We still set `_deepgramWord` so the UI can show "Reverb heard: jued | Deepgram heard: jumped". We set `_deepgramConfidence` so both values are available.

**For truly `'unconfirmed'` words:** `_deepgramWord` is explicitly `null` — meaning Deepgram genuinely had no word at this position. This is the real "null" the user asked for.

**Unconsumed Deepgram words** (alignment `deletion` type): Log them to console for diagnostics. These are words Deepgram heard but Reverb didn't produce. Not added to the merged word list (Reverb is the backbone for word count), but visible in debug output.

### 2. Add generic `alignSequences()` wrapper — `js/sequence-aligner.js`

The current `alignTranscripts()` works but its parameter names say "verbatim"/"clean". Add a thin wrapper (~15 lines):

```javascript
export function alignSequences(wordsA, wordsB, options = {}) {
  // Same NW algorithm, generic labels
  // Returns entries with { type, wordA, wordB, wordAData, wordBData }
}
```

The existing `alignTranscripts()` stays unchanged for backward compatibility with the disfluency pipeline.

### 3. Replace confidence gate in `detectStruggleWords()` — `js/diagnostics.js`

**Current condition 2 (line 385-388):**
```javascript
// Condition 2: Low confidence (< 0.70)
const conf = w.confidence;
if (conf == null || conf >= 0.70) continue;
```

**New condition 2:**
```javascript
// Condition 2: Cross-validation indicates uncertainty
// 'confirmed' = both engines agree — not a struggle
// 'disagreed' = engines heard different words (mispronunciation)
// 'unconfirmed' = only Reverb heard something (Deepgram found nothing)
// 'unavailable' = Deepgram was down (can't confirm either way)
const xval = w.crossValidation;
if (xval === 'confirmed') continue;
```

This is more honest: if both engines agree the student said the word, it's not a struggle regardless of confidence score. If they disagree or only one heard it, combined with a pause and long word, that's a struggle.

The confidence value is still logged in the result for diagnostics, just no longer used as a gate.

### 4. Replace confidence gate in `detectMorphologicalErrors()` — `js/diagnostics.js`

**Current (line 264):** Uses `confidence < 0.8` as a condition.

**New:** Replace confidence check with cross-validation check. A morphological error where both engines agree on the spoken word is a reliable substitution. Only flag morphological when cross-validation shows uncertainty.

```javascript
// Old: if (conf !== null && conf >= 0.8) continue;
// New: if (xval === 'confirmed') continue;
```

### 5. Handle `'disagreed'` status in UI — `js/ui.js`

**Tooltip text (~line 170-173):** Add case:
```javascript
case 'disagreed': xvalText = 'Models disagree'; break;
```

**CSS class mapping (~line 233):**
```javascript
// 'disagreed' → 'mid' class (amber/caution, same visual as unconfirmed)
```

For disagreed words, `_deepgramWord` will be set, so the existing "Deepgram heard: X / Reverb heard: Y" tooltip logic works automatically.

### 6. Add `disagreed` count to statistics — `js/kitchen-sink-merger.js`

In `computeKitchenSinkStats()` (~line 290): add `disagreed` field to the returned stats object alongside `confirmed`, `unconfirmed`, `unavailable`.

### 7. Update `js/miscue-registry.js`

Update the `struggle` entry's config to reflect cross-validation status replaces raw confidence. Update `morphological` entry similarly.

### 8. Update `docs/pipeline-architecture.html`

Update cross-validation section:
- Four statuses: confirmed / disagreed / unconfirmed / unavailable
- Sequence alignment instead of text matching
- Struggle detection uses cross-validation, not confidence

### 9. Update `index.html` version timestamp

---

## Files Modified

| File | Change |
|------|--------|
| `js/deepgram-api.js` | Rewrite `crossValidateWithDeepgram()` to use NW alignment, add 'disagreed' status, log unconsumed DG words |
| `js/sequence-aligner.js` | Add generic `alignSequences()` wrapper (~15 lines) |
| `js/diagnostics.js` | Replace confidence checks with cross-validation checks in `detectStruggleWords()` and `detectMorphologicalErrors()` |
| `js/ui.js` | Handle 'disagreed' in tooltip text and CSS class mapping |
| `js/kitchen-sink-merger.js` | Add `disagreed` count to `computeKitchenSinkStats()` |
| `js/miscue-registry.js` | Update struggle/morphological config comments |
| `docs/pipeline-architecture.html` | Update cross-validation and struggle detection sections |
| `index.html` | Version timestamp |

## Files NOT Modified

| File | Why |
|------|-----|
| `js/app.js` | Auto-propagates — logs whatever properties are on words |
| `js/kitchen-sink-merger.js` (pipeline) | Pipeline order unchanged — NW replaces text-queue inside `crossValidateWithDeepgram()` |
| `js/confidence-classifier.js` | Trust levels still use confidence thresholds for their own purposes |
| `js/safety-checker.js` | Still uses confidence >= 0.93 for corroboration override (ghost detection, separate concern) |

---

## Example: "jued"/"jumped" Before vs After

**Before:**
```
Word: "jued"
crossValidation: "unconfirmed"
_deepgramWord: (missing)
confidence: 0.01 (Reverb's broken score)
Struggle fires because: pause ✓, conf < 0.70 ✓, length > 3 ✓
Teacher sees: "Reverb heard: jued" — no Deepgram info
```

**After:**
```
Word: "jued"
crossValidation: "disagreed"
_deepgramWord: "jumped"
confidence: (Deepgram's confidence for "jumped")
_deepgramConfidence: (Deepgram's confidence)
_reverbConfidence: 0.01
Struggle fires because: pause ✓, crossValidation !== 'confirmed' ✓, length > 3 ✓
Teacher sees: "Reverb heard: jued | Deepgram heard: jumped" — full picture
```

---

## Verification

1. Re-run the "the big dog ate the cat and then jumped out of the window" test with deliberate "joomped" mispronunciation
2. Check debug log for:
   - `crossValidation: "disagreed"` on the "jued"/"jumped" word
   - `_deepgramWord: "jumped"` present
   - Unconsumed Deepgram words logged to console (if any)
   - Struggle word still detected (via cross-validation check, not confidence)
3. Check UI tooltips show "Reverb heard: jued | Deepgram heard: jumped"
4. Run a clean reading (all words correct) — verify all words show `confirmed`
5. Run with Deepgram backend offline — verify all words show `unavailable`
6. Check `computeKitchenSinkStats()` shows `disagreed` count in debug log
