# Disfluency Detection Refactor: Hierarchy of Truth

**Created:** 2026-02-04
**Status:** Ready for Implementation
**Priority:** High (fixes active bug)

---

## Problem Statement

The current disfluency detection engine uses a **grouping-based greedy scan** that causes "Semantic Vacuuming" — valid, high-confidence words (like "the") are incorrectly removed as fragments of phonetically similar words (like "then") appearing later in the same temporal group.

**Evidence:** Debug log `orf-debug-2026-02-04T19-24-43.json` shows:
- "the" (position 6, confidence 0.99) incorrectly merged into "then" (position 10)
- Both STT models agreed on "the" with high confidence
- 3 words were incorrectly removed, damaging WCPM accuracy

**Root Cause:**
1. Temporal grouping creates giant groups (fluent speech has no gaps > 1.0s)
2. Fragment detection scans ALL words in group (no distance limit)
3. `"then".startsWith("the")` = true, so "the" is flagged as fragment
4. No protection mechanism for high-confidence or reference-verified words

---

## Solution: Hierarchy of Truth

Replace grouping-based approach with a **single-pass, three-filter architecture**:

```
For each word:
  → Filter 1: Is it protected by reference text? (N-gram with phonetic matching)
  → Filter 2: Does it pass phonological horizon rules? (distance + time limits)
  → Filter 3: Is it protected by acoustic confidence? (default model ≥ 0.93)

Only mark as fragment if it passes ALL filters AND matches a target.
```

---

## Filter 1: Reference Text Anchor (Intent Filter)

### Purpose
If a sequence of STT words matches (or phonetically matches) a sequence in the reference passage, those words represent the student's intent to read that part of the text. They should be protected from fragment detection.

### Implementation

```javascript
import { doubleMetaphone, levenshtein } from './phonetic-utils.js';

/**
 * Build phonetic N-gram index from reference text.
 * Stores both exact strings and phonetic codes for fuzzy matching.
 */
function buildReferenceNgrams(referenceText, maxN = 3) {
  if (!referenceText) return { exact: new Set(), phonetic: new Map() };

  const words = normalizeText(referenceText).split(/\s+/).filter(w => w.length > 0);
  const exact = new Set();
  const phonetic = new Map();  // phoneticKey → original ngram

  for (let n = 1; n <= maxN; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      const ngram = words.slice(i, i + n);
      const ngramStr = ngram.join(' ');
      const phoneticKey = ngram.map(w => doubleMetaphone(w)).join(' ');

      exact.add(ngramStr);
      phonetic.set(phoneticKey, ngramStr);
    }
  }

  return { exact, phonetic };
}

/**
 * Check if STT words match reference using phonetic similarity.
 * Returns true if the N-gram exists in reference (exact or phonetic match).
 */
function matchesReferencePhonetically(sttWords, referenceNgrams, maxPhoneticDistance = 1) {
  const sttNgram = sttWords.map(w => normalizeWord(w)).join(' ');
  const sttPhonetic = sttWords.map(w => doubleMetaphone(w)).join(' ');

  // Exact match
  if (referenceNgrams.exact.has(sttNgram)) {
    return { matched: true, type: 'exact', ref: sttNgram };
  }

  // Phonetic match - find closest reference N-gram
  for (const [refPhonetic, refOriginal] of referenceNgrams.phonetic) {
    const distance = levenshtein(sttPhonetic, refPhonetic);
    if (distance <= maxPhoneticDistance) {
      return { matched: true, type: 'phonetic', ref: refOriginal, distance };
    }
  }

  return { matched: false };
}

/**
 * Check if word at index is protected by reference text.
 */
function isProtectedByReference(words, index, referenceNgrams) {
  if (!referenceNgrams || referenceNgrams.exact.size === 0) return false;

  // Check bigram: [current, next]
  if (index < words.length - 1) {
    const bigram = [words[index].word, words[index + 1].word];
    const match = matchesReferencePhonetically(bigram, referenceNgrams);
    if (match.matched) return true;
  }

  // Check trigram: [current, next, next2]
  if (index < words.length - 2) {
    const trigram = [words[index].word, words[index + 1].word, words[index + 2].word];
    const match = matchesReferencePhonetically(trigram, referenceNgrams);
    if (match.matched) return true;
  }

  return false;
}
```

### Example: "the hazy dog" vs reference "the lazy dog"

```
STT:  ["the", "hazy", "dog"]
Ref:  ["the", "lazy", "dog"]

Bigram check: "the hazy"
  - STT phonetic: "0 HZ" (the→0, hazy→HZ)
  - Ref phonetic: "0 LZ" (the→0, lazy→LZ)
  - Distance: levenshtein("0 HZ", "0 LZ") = 1 ✓
  - PROTECTED!

Result: "the" is protected, not treated as fragment of "then"
```

---

## Filter 2: Differentiated Phonological Horizons

### Purpose
Fragments and repetitions have different linguistic profiles and should have different detection windows.

### Rules

| Type | Description | Lookahead | Time Limit | Rationale |
|------|-------------|-----------|------------|-----------|
| **Fragment** | Incomplete motor plan ("th-" → "the") | i+1 only | ≤ 500ms | Fragments resolve immediately |
| **Repetition** | Cognitive reset ("the the") | i+1, i+2 | ≤ 1.0s | Can have fillers between |

### Implementation

```javascript
const DISFLUENCY_THRESHOLDS = {
  // Fragment detection (prefix matches) - STRICT
  FRAGMENT_MAX_LOOKAHEAD: 1,
  FRAGMENT_MAX_TIME_GAP_SEC: 0.5,

  // Repetition detection (exact matches) - LOOSE
  REPETITION_MAX_LOOKAHEAD: 2,
  REPETITION_MAX_TIME_GAP_SEC: 1.0,
};
```

### Why This Fixes the Bug

Before (buggy):
```
"the" at pos 2 checks ALL subsequent words in group
→ finds "then" at pos 6
→ "then".startsWith("the") = true
→ INCORRECTLY marks "the" as fragment
```

After (fixed):
```
"the" at pos 2 checks only pos 3 (i+1)
→ pos 3 is "hazy"
→ "hazy".startsWith("the") = false
→ NOT marked as fragment ✓
```

---

## Filter 3: Acoustic Confidence Veto

### Purpose
The `default` model provides real acoustic confidence scores (unlike `latest_long` which returns fake scores per Google documentation). High confidence from `default` means the model clearly heard a distinct word — not a stutter fragment.

### Evidence from Google Documentation

> "The API will return a value, but it is not truly a confidence score."
> — [Google Cloud STT Latest Models docs](https://docs.cloud.google.com/speech-to-text/docs/v1/latest-models)

This applies to `latest_long`. The `default` model returns actual acoustic confidence.

### Implementation

```javascript
const CONFIDENCE_PROTECTION_THRESHOLD = 0.93;  // Consistent with HIGH_CONFIDENCE_THRESHOLD

function isProtectedByConfidence(word) {
  const defaultConf = word._debug?.default?.confidence;
  if (defaultConf == null) return false;

  return defaultConf >= CONFIDENCE_PROTECTION_THRESHOLD;
}
```

### Example from Debug Log

```
"the" at position 6:
  - default confidence: 0.99
  - threshold: 0.93
  - 0.99 >= 0.93 → PROTECTED ✓
```

---

## Complete Algorithm

```javascript
export function detectDisfluencies(words, referenceText = '') {
  // Pre-build reference N-grams with phonetic index
  const referenceNgrams = buildReferenceNgrams(referenceText);

  const fragmentIndices = new Set();
  const targetFragments = new Map();

  for (let i = 0; i < words.length; i++) {
    const current = words[i];

    if (fragmentIndices.has(i)) continue;

    // ─────────────────────────────────────────────
    // FILTER 1: Reference Text Protection (Phonetic)
    // ─────────────────────────────────────────────
    if (isProtectedByReference(words, i, referenceNgrams)) {
      continue;  // Protected - skip fragment detection
    }

    // ─────────────────────────────────────────────
    // FILTER 3: Acoustic Confidence Veto
    // ─────────────────────────────────────────────
    if (isProtectedByConfidence(current)) {
      continue;  // High confidence - real word, not fragment
    }

    // ─────────────────────────────────────────────
    // FILTER 2A: Fragment Detection (STRICT)
    // Only check i+1, within 500ms
    // ─────────────────────────────────────────────
    if (checkForFragment(words, i, fragmentIndices, targetFragments)) {
      continue;
    }

    // ─────────────────────────────────────────────
    // FILTER 2B: Repetition Detection (LOOSE)
    // Check i+1 and i+2, within 1.0s
    // ─────────────────────────────────────────────
    checkForRepetition(words, i, fragmentIndices, targetFragments);
  }

  // Build output with metrics
  return buildOutput(words, fragmentIndices, targetFragments);
}
```

---

## Files to Change

### 1. `js/disfluency-config.js` — Update Thresholds

**DELETE:**
```javascript
MAX_STUTTER_GAP_SEC: 1.0,  // Grouping threshold (no longer used)
```

**ADD:**
```javascript
// Filter 2: Phonological Horizons
FRAGMENT_MAX_LOOKAHEAD: 1,
FRAGMENT_MAX_TIME_GAP_SEC: 0.5,
REPETITION_MAX_LOOKAHEAD: 2,
REPETITION_MAX_TIME_GAP_SEC: 1.0,

// Filter 3: Confidence Protection
CONFIDENCE_PROTECTION_THRESHOLD: 0.93,

// Filter 1: Phonetic Matching
MAX_PHONETIC_DISTANCE: 1,  // Levenshtein distance for fuzzy N-gram match
```

### 2. `js/disfluency-detector.js` — Complete Rewrite

**DELETE:**
- `groupStutterEvents()` function (~25 lines)
- `processStutterGroup()` function (~130 lines)
- Grouping loop in `detectDisfluencies()`

**ADD:**
- `buildReferenceNgrams()` — Build phonetic N-gram index
- `matchesReferencePhonetically()` — Fuzzy N-gram matching
- `isProtectedByReference()` — Filter 1
- `isProtectedByConfidence()` — Filter 3
- `checkForFragment()` — Filter 2A (strict adjacency)
- `checkForRepetition()` — Filter 2B (loose window)
- Rewritten `detectDisfluencies()` — Single-pass architecture

**IMPORT:**
```javascript
import { doubleMetaphone, levenshtein } from './phonetic-utils.js';
```

### 3. `js/app.js` — Pass Reference Text

**CHANGE (line ~339):**
```javascript
// Before:
const disfluencyResult = detectDisfluencies(wordsForAlignment);

// After:
const disfluencyResult = detectDisfluencies(wordsForAlignment, referenceText);
```

---

## Test Cases

| # | Input | Expected | Validates |
|---|-------|----------|-----------|
| 1 | "the hazy dog" with ref "the lazy dog" | "the" preserved | Filter 1 (phonetic) |
| 2 | "the" with default conf 0.99 | "the" preserved | Filter 3 |
| 3 | "th- the" adjacent, 200ms gap | "th-" merged | Filter 2A |
| 4 | "the the ball" | First "the" merged | Filter 2B |
| 5 | "the um the ball" | First "the" merged | Filter 2B (filler) |
| 6 | "the cat ... the mat" (3s gap) | Both "the" preserved | Filter 2B (time limit) |
| 7 | "the quick brown then" | "the" preserved | Filter 2A (distance limit) |

---

## Verification: "the/then" Bug

Using debug log data:

```
Position:  ...  6      7      8     9     10    ...
Word:           the    hazy   dog   and   then
Time:           7.9s   8.4s   9.5s  11.3s 11.5s
Default Conf:   0.99   0.95   0.98  0.96  1.00
```

**Filter 1 Check:**
- Bigram "the hazy" → phonetic "0 HZ"
- Reference "the lazy" → phonetic "0 LZ"
- Distance = 1 ≤ 1 → **PROTECTED** ✓

**Filter 3 Check:**
- Default confidence = 0.99 ≥ 0.93 → **PROTECTED** ✓

**Filter 2A Check (if filters 1,3 weren't there):**
- Check i+1 only: "hazy"
- `"hazy".startsWith("the")` = false → **NOT a fragment** ✓

**Result:** "the" is preserved in all scenarios. Bug fixed.

---

## Migration Notes

1. **No data migration needed** — Changes are to runtime logic only
2. **Backward compatible** — Output structure unchanged
3. **Rollback** — Previous implementation can be restored from git
4. **Testing** — Run against saved debug logs to verify fix

---

## Performance Impact

| Metric | Before | After |
|--------|--------|-------|
| Time complexity | O(n²) within groups | O(n) single pass |
| N-gram building | N/A | O(m²) where m = ref words (one-time) |
| Overall | Faster (no cross-group scans) | Slightly more memory for N-gram index |

---

## Future Enhancements

1. **Weighted phonetic distance** — Some phoneme substitutions are more common (l/r, v/w)
2. **Context-aware thresholds** — Different thresholds for different word lengths
3. **ML-based fragment detection** — Train classifier on labeled stutter data
4. **Real-time feedback** — Show stutter detection during recording

---

## Approval Checklist

- [ ] Code review completed
- [ ] Unit tests pass
- [ ] Integration tests with debug logs
- [ ] Performance benchmarked
- [ ] Documentation updated
