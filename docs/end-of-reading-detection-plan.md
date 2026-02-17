# End-of-Reading Detection Plan

## Problem

When reference text includes non-passage content (instructional footers like "Enter your reading time below", page metadata, etc.) that survives OCR passage trimming, the NW aligner forces post-reading speech (proctor announcing time, calling student name, saying "we're done") against these words, producing false substitution errors.

**Concrete example** (debug `orf-debug-2026-02-17T20-26-41.json`):
- Student's last word: "takes" (correct, confirmed, 64.78s)
- Proctor speech immediately after: "jacobs hot oh emma it was five minutes and two seconds emma we're done"
- Reference footer: "Enter your reading time below..."
- False errors: enter→hot, your→oh, reading→done, time→done (4 bogus substitution errors, 3 bucketed as "definite-struggle")

The passage trimmer (`trimPassageToAttempted`) ran and trimmed 822→~187 words, but common function words in proctor speech (e.g., "on", "minutes") accidentally matched instruction text, dragging `lastIndex` 4 words past the real reading end.

## Solution: 3-Engine End-of-Reading Detection

After alignment and all forgiveness passes, walk **backward** through the alignment to detect where the student stopped reading. Mark trailing ref-words as `_notAttempted` when **no engine** produced anything resembling the reference word.

### Core Insight

When all 3 engines (V1, V0, Parakeet) independently produce words completely unrelated to the reference, the student was not reading that word. A struggling reader who *attempts* a word produces something at least phonologically similar ("met" for "metamorphosis", "cong" for "congratulations"). "Hot" for "enter" is not a reading attempt — it's someone else talking.

### Algorithm

```
Walk backward from end of alignment (ref entries only, skip insertions):

For each entry:
  IF type === 'correct' OR forgiven === true:
    STOP — student was reading here

  IF type === 'substitution':
    Check V1 (hyp), V0 (_v0Word), Parakeet (_xvalWord) against ref
    IF any engine isNearMiss(ref, engineWord):
      STOP — genuine reading attempt
    ELSE:
      Mark _notAttempted = true

  IF type === 'omission':
    IF we've already marked a not-attempted SUBSTITUTION after this position:
      Mark _notAttempted = true (contaminated by proctor noise zone)
    ELSE:
      STOP — trailing omission without proctor evidence = could be legitimate
```

**Key design decision**: Omissions alone do NOT trigger not-attempted status. We require at least one non-near-miss substitution (positive evidence of non-reading speech) before omissions in the tail get marked. This preserves legitimate trailing omissions (student ran out of time).

### `isNearMiss` as the Comparison Function

Using the existing `isNearMiss()` from diagnostics.js (shared prefix/suffix >= 3 chars OR levenshtein ratio >= 0.4). This is better than raw levenshtein ratio alone because it catches partial decoding attempts where the student gets the beginning right:
- "met" vs "metamorphosis": shared prefix "met" (3 chars) → near-miss → attempted ✓
- "hot" vs "enter": no shared prefix/suffix, lev 0.2 → NOT near-miss → not attempted ✓
- "done" vs "reading": no shared prefix/suffix, lev 0.14 → NOT near-miss → not attempted ✓

### Pipeline Position

After: `post_struggle_leniency` (all forgiveness/reclassification complete)
Before: `metrics_computed` (so not-attempted words are excluded from scoring)

This ensures forgiven words, struggle-correct words, and pk-trust overrides are already resolved before we check.

### Scoring Impact

In `computeAccuracy()` (metrics.js):
- Exclude `_notAttempted` entries from **both** total ref words (denominator) AND error count (numerator)
- Effect: accuracy reflects only the portion the student actually read

In `computeWCPM()` / `computeWCPMRange()` (metrics.js):
- Exclude `_notAttempted` from correct word count
- No timing adjustment needed (these words are at the very end, past the student's reading)

### UI Rendering

- New bucket: `'not-attempted'`
- Visual: grayed out, distinct from all other states
- Tooltip: "Not attempted — detected as post-reading speech"
- Insertions between not-attempted ref entries: leave as-is (regular insertions don't count as errors anyway)

## Edge Cases

| Case | V1 | V0 | Pk | isNearMiss? | Result |
|------|----|----|----|----|--------|
| Student struggles on last word: "met" for "metamorphosis" | met | met | met | YES (prefix) | Attempted ✓ |
| Proctor says "done" for ref "enter" | done | done | done | NO | Not attempted ✓ |
| Proctor says "on" when ref is "on" | on | on | on | YES (exact) | Attempted (false positive but benign — would be scored correct) |
| Student reads to word 100, omits 101-103 | — | — | — | omission, no proctor sub | Attempted (legitimate omission) ✓ |
| Student stops at 100, proctor matches 101 accidentally, 102-103 are non-near-miss subs | — | — | — | Walk stops at 101 | 102-103 trimmed, 101 preserved (conservative) |
| Student reads nothing (ambient noise only) | all unrelated | all unrelated | all unrelated | NO for all | All not-attempted (correct — assessment invalid) |

## Files to Modify

1. **`js/app.js`** — Add detection phase after post-struggle leniency, before metrics
2. **`js/metrics.js`** — `computeAccuracy()`, `computeWCPM()`, `computeWCPMRange()` exclude `_notAttempted`
3. **`js/ui.js`** — New bucket rendering for not-attempted words
4. **`js/miscue-registry.js`** — Add `endOfReadingDetection` entry

## What This Does NOT Fix

- **Trailing omissions from running out of time**: These remain as omission errors (pre-existing behavior, separate issue)
- **Mid-passage proctor interruptions**: Only detects end-of-reading, not mid-passage noise
- **OCR capturing non-passage text**: The trimmer still does its best; this is a safety net

## Invariants

1. Detection ONLY walks backward from the end — never marks mid-passage words
2. Requires positive evidence (non-near-miss substitution) — pure trailing omissions are left alone
3. Uses existing `isNearMiss()` — no new similarity thresholds introduced
4. Respects all prior forgiveness passes — forgiven words are "attempted" by definition
