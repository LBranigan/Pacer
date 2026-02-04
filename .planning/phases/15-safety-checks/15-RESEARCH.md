# Phase 15: Safety Checks - Research

**Researched:** 2026-02-03
**Domain:** ASR safety checks, rate anomaly detection, uncorroborated sequence flagging
**Confidence:** HIGH (algorithms user-specified, codebase patterns established, domain well-understood)

## Summary

This research investigates how to implement safety checks that flag physically impossible or suspicious ASR outputs before presenting results to teachers. The phase adds two detection systems: (1) rate anomaly detection using a 3-word sliding window to flag >5 words/second bursts, and (2) uncorroborated sequence flagging based on consecutive `latest_only` words with thresholds split by reference presence.

The key insight from domain research is that **5 words/second (300 WPM) represents the physiological upper limit of human speech**. Research shows typical oral reading at 183 WPM (3.05 w/s), with maximal reading aloud at 275 WPM (4.58 w/s). Even auctioneers top out at 250-350 WPM. A rate of 300+ WPM sustained over multiple words is physically impossible for child readers and indicates ASR hallucination.

The user has provided clear decisions in CONTEXT.md for:
- Rate threshold (5 w/s) and detection method (3-word sliding window)
- Split uncorroborated thresholds (7 consecutive if IN ref, 3 if NOT in ref)
- Flag resolution rules (additive flags, strong corroboration overrides, ghost priority)
- Edge case handling (300ms edge tolerance, single-word utterances, confidence collapse state)

**Primary recommendation:** Implement a standalone `safety-checker.js` module that processes classified words after disfluency detection but before UI display. The module should detect rate anomalies, flag uncorroborated sequences, apply corroboration overrides, and compute confidence collapse state. Use the existing `_flags` array pattern established in Phase 13.

## Standard Stack

The existing codebase provides everything needed. No new libraries required.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none) | - | Pure JavaScript implementation | Custom domain-specific logic; sliding window and sequence detection are simple algorithms |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Existing `confidence-classifier.js` | - | Source of classified words | Provides `trustLevel`, `confidence`, `_source`, `_flags` |
| Existing `confidence-config.js` | - | Threshold constants | Reuse HIGH confidence threshold (0.93) for corroboration override |
| Existing `disfluency-detector.js` | - | Pipeline predecessor | Safety checks run after disfluency detection |
| Existing `diagnostics.js` | - | Time parsing utilities | Reuse `parseTime()` function |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| 3-word sliding window | Exponential moving average | User specified 3-word window; EMA adds complexity without benefit |
| Per-word rate calculation | Global average rate | Per-word catches bursts that global average would miss |
| Hardcoded threshold | ML-based anomaly detection | 5 w/s is physiologically grounded; ML requires training data |

**Installation:**
```bash
# No new dependencies required
```

## Architecture Patterns

### Recommended Project Structure
```
js/
├── safety-checker.js       # NEW: Rate anomaly, sequence flagging, confidence collapse
├── safety-config.js        # NEW: Thresholds for safety checks
├── disfluency-detector.js  # Existing: Runs BEFORE safety checks
├── confidence-classifier.js # Existing: Provides word classification
├── confidence-config.js    # Existing: HIGH threshold for corroboration
└── app.js                  # Orchestration: Call safety checks after disfluency
```

### Pattern 1: Pipeline Integration Point

**What:** Safety checks run as a distinct step after disfluency detection, before UI display/storage.

**When to use:** Always - safety flags should be applied to the final word array before it's saved or displayed.

**Pipeline evolution:**
```javascript
// Current flow (Phase 14):
// 1. ensembleResult = sendEnsembleSTT()
// 2. mergedWords = mergeEnsembleResults(ensembleResult)
// 3. classifiedWords = classifyAllWords(mergedWords, referenceText)  // Phase 13
// 4. filteredWords = filterGhosts(classifiedWords)
// 5. processedWords = detectDisfluencies(filteredWords)  // Phase 14
// 6. alignment = alignWords(referenceText, processedWords)

// With Phase 15:
// 1. ensembleResult = sendEnsembleSTT()
// 2. mergedWords = mergeEnsembleResults(ensembleResult)
// 3. classifiedWords = classifyAllWords(mergedWords, referenceText)  // Phase 13
// 4. filteredWords = filterGhosts(classifiedWords)
// 5. disfluencyResult = detectDisfluencies(filteredWords)  // Phase 14
// 6. safetyResult = applySafetyChecks(disfluencyResult.words, referenceText, audioDuration)  // Phase 15 NEW
// 7. alignment = alignWords(referenceText, safetyResult.words)
```

### Pattern 2: Additive Flag Array

**What:** Multiple flags can apply to a single word. The `_flags` array accumulates flags from different detection systems.

**When to use:** When a word may have multiple anomaly types (e.g., both rate anomaly AND uncorroborated sequence).

**Example:**
```javascript
// Word with multiple flags
{
  word: "impossible",
  source: "latest_only",
  trustLevel: "low",
  _flags: [
    "possible_insertion",        // From Phase 13 (latest_only + NOT in ref)
    "rate_anomaly",              // From Phase 15 (>5 w/s)
    "uncorroborated_sequence"    // From Phase 15 (7+ consecutive latest_only)
  ]
}
```

### Pattern 3: 3-Word Sliding Window for Rate Detection

**What:** Calculate average rate over 3-word windows; flag all words in windows that exceed threshold.

**When to use:** For detecting rate bursts while tolerating natural variation.

**Algorithm:**
```javascript
// Per CONTEXT.md: 3-word sliding window, catches bursts while tolerating variation
function detectRateAnomalies(words, audioDurationMs) {
  const THRESHOLD_WORDS_PER_SEC = 5.0;
  const WINDOW_SIZE = 3;
  const EDGE_TOLERANCE_MS = 300;

  // Skip if fewer than 3 words (can't compute meaningful rate)
  if (words.length < WINDOW_SIZE) return;

  for (let i = 0; i <= words.length - WINDOW_SIZE; i++) {
    const windowWords = words.slice(i, i + WINDOW_SIZE);

    // Calculate time span for this window
    const windowStart = parseTime(windowWords[0].startTime);
    const windowEnd = parseTime(windowWords[WINDOW_SIZE - 1].endTime);
    const windowDurationSec = windowEnd - windowStart;

    // Skip edge windows (first/last 300ms of audio)
    const windowStartMs = windowStart * 1000;
    const windowEndMs = windowEnd * 1000;
    if (windowStartMs < EDGE_TOLERANCE_MS ||
        windowEndMs > audioDurationMs - EDGE_TOLERANCE_MS) {
      continue; // Relaxed rate thresholds at edges
    }

    // Compute rate: 3 words / window duration
    if (windowDurationSec > 0) {
      const rate = WINDOW_SIZE / windowDurationSec;

      if (rate > THRESHOLD_WORDS_PER_SEC) {
        // Flag all words in this window
        for (const word of windowWords) {
          addFlag(word, 'rate_anomaly');
          word._rateAnomaly = { rate: Math.round(rate * 100) / 100 };
        }
      }
    }
  }
}
```

### Pattern 4: Uncorroborated Sequence Detection with Split Thresholds

**What:** Track consecutive `latest_only` words and flag when they exceed thresholds (different for in-ref vs not-in-ref).

**When to use:** For detecting runs of uncorroborated ASR output that are likely hallucinations.

**Algorithm:**
```javascript
// Per CONTEXT.md: Split thresholds based on reference presence
const THRESHOLD_IN_REF = 7;      // Words IN reference: flag at 7+ consecutive
const THRESHOLD_NOT_IN_REF = 3;  // Words NOT in reference: flag at 3+ consecutive

function detectUncorroboratedSequences(words, referenceSet) {
  let sequenceStart = null;
  let inRefCount = 0;
  let notInRefCount = 0;
  const sequences = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const source = word.source || word._source;

    // A corroborated word (both) resets the sequence
    if (source === 'both') {
      // Check if previous sequence should be flagged
      if (sequenceStart !== null) {
        evaluateAndFlagSequence(words, sequenceStart, i - 1, inRefCount, notInRefCount);
      }
      sequenceStart = null;
      inRefCount = 0;
      notInRefCount = 0;
      continue;
    }

    // latest_only: track sequence
    if (source === 'latest_only') {
      if (sequenceStart === null) {
        sequenceStart = i;
      }

      const inRef = isWordInReference(word.word, referenceSet);
      if (inRef) {
        inRefCount++;
      } else {
        notInRefCount++;
      }
    }

    // default_only also breaks the latest_only sequence
    if (source === 'default_only') {
      if (sequenceStart !== null) {
        evaluateAndFlagSequence(words, sequenceStart, i - 1, inRefCount, notInRefCount);
      }
      sequenceStart = null;
      inRefCount = 0;
      notInRefCount = 0;
    }
  }

  // Handle sequence at end of word array
  if (sequenceStart !== null) {
    evaluateAndFlagSequence(words, sequenceStart, words.length - 1, inRefCount, notInRefCount);
  }
}

function evaluateAndFlagSequence(words, start, end, inRefCount, notInRefCount) {
  const length = end - start + 1;

  // Per CONTEXT.md: Different thresholds
  // Words IN reference: flag at 7+
  // Words NOT in reference: flag at 3+

  // If the sequence is mostly in-ref words, use in-ref threshold
  // If it contains significant not-in-ref words, those trigger at lower threshold

  // Simple approach: Check both thresholds
  const shouldFlag = (inRefCount >= THRESHOLD_IN_REF) || (notInRefCount >= THRESHOLD_NOT_IN_REF);

  if (shouldFlag) {
    // Flag EACH word in the sequence (per CONTEXT.md)
    for (let i = start; i <= end; i++) {
      addFlag(words[i], 'uncorroborated_sequence');
    }
  }
}
```

### Pattern 5: Strong Corroboration Override

**What:** Words with `source === 'both'` AND `confidence >= 0.93` have their rate and sequence flags removed.

**When to use:** When both models agree with high confidence, trust the result despite anomaly flags.

**Example:**
```javascript
// Per CONTEXT.md: Strong corroboration overrides BOTH rate and sequence flags
function applyCorroborationOverrides(words) {
  const HIGH_CONF = 0.93;  // From CONFIDENCE_THRESHOLDS.HIGH

  for (const word of words) {
    const source = word.source || word._source;
    const isStronglyCorroborated = source === 'both' && word.confidence >= HIGH_CONF;

    if (isStronglyCorroborated && word._flags) {
      // Remove rate_anomaly and uncorroborated_sequence flags
      word._flags = word._flags.filter(f =>
        f !== 'rate_anomaly' && f !== 'uncorroborated_sequence'
      );

      // Clean up empty _flags array
      if (word._flags.length === 0) {
        delete word._flags;
      }
    }
  }
}
```

### Pattern 6: Confidence Collapse Detection

**What:** When >40% of words have `trustLevel === 'none'` OR have `_flags`, the assessment is in confidence collapse state.

**When to use:** For determining when to show diagnostic mode UI instead of WCPM score.

**Example:**
```javascript
// Per CONTEXT.md: >40% words have trustLevel 'none' or _flags
function detectConfidenceCollapse(words) {
  if (words.length === 0) return { isCollapsed: false };

  let flaggedCount = 0;

  for (const word of words) {
    // Count words with trustLevel 'none' (ghost is already filtered)
    // OR words with any _flags
    if (word.trustLevel === 'ghost' || word.trustLevel === 'none' ||
        (word._flags && word._flags.length > 0)) {
      flaggedCount++;
    }
  }

  const flaggedPercent = (flaggedCount / words.length) * 100;

  return {
    isCollapsed: flaggedPercent > 40,
    flaggedPercent: Math.round(flaggedPercent),
    flaggedCount,
    totalWords: words.length
  };
}
```

### Anti-Patterns to Avoid

- **Checking rate on individual words:** A single fast word is normal; rate anomalies need window context.

- **Filtering flagged words before alignment:** Flags are for display, not exclusion. Per CONTEXT.md: "flagged words are kept but visually de-emphasized."

- **Mutating flags during iteration:** Collect indices first, then add flags in a second pass to avoid iterator invalidation.

- **Ignoring ghost flag priority:** Per CONTEXT.md: "Ghost flags take priority." When rendering, show ghost flag and suppress other flags from display (but track in data for debugging).

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Time parsing | Custom parser | `diagnostics.js:parseTime()` | Already handles "1.200s" format reliably |
| Reference word matching | Custom lowercase | `confidence-classifier.js:buildReferenceSet()` | Already handles homophones, numbers, canonical forms |
| Confidence threshold | Magic number | `confidence-config.js:CONFIDENCE_THRESHOLDS.HIGH` | Centralized constant (0.93) |
| Flag management | Direct array push | Helper function `addFlag()` | Handles deduplication and null checks |

**Key insight:** The codebase already has reference matching, time parsing, and confidence thresholds. Reuse them for consistency.

## Common Pitfalls

### Pitfall 1: Overlapping Window Flags
**What goes wrong:** Word at index 2 appears in windows [0,1,2], [1,2,3], and [2,3,4]. If all three windows have anomalies, the word gets flagged three times.
**Why it happens:** Naive flag addition without deduplication.
**How to avoid:** Use a Set to track which words already have `rate_anomaly` flag, or use `addFlag()` helper that checks for existing flag.
**Warning signs:** `_flags` array contains duplicate entries.

### Pitfall 2: Edge Tolerance Window Calculation
**What goes wrong:** A window that starts at 100ms but ends at 400ms might incorrectly get edge tolerance applied.
**Why it happens:** Only checking window start, not window end.
**How to avoid:** Per CONTEXT.md: "first/last 300ms of audio get relaxed rate thresholds." Apply when window STARTS within 300ms of start OR ENDS within 300ms of end.
**Warning signs:** Rate anomalies flagged in legitimate edge speech.

### Pitfall 3: Sequence Count Confusion
**What goes wrong:** Sequence of 5 `latest_only` words gets flagged when it contains 3 words IN ref and 2 words NOT in ref.
**Why it happens:** Conflating total sequence length with per-category counts.
**How to avoid:** Track IN-ref and NOT-in-ref counts separately. Flag if (inRefCount >= 7) OR (notInRefCount >= 3).
**Warning signs:** Short not-in-ref sequences getting through, or reasonable in-ref sequences being flagged.

### Pitfall 4: Corroboration Override Missing Ghost Check
**What goes wrong:** A ghost word that also has `source === 'both'` gets its ghost flag overridden.
**Why it happens:** Not checking flag type before removing.
**How to avoid:** Per CONTEXT.md: "Ghost flags take priority - show ghost flag but still track other flags in data for debugging." Never remove `vad_ghost` flag.
**Warning signs:** Ghost words displayed as normal words.

### Pitfall 5: Single-Word Rate Calculation
**What goes wrong:** Trying to calculate rate for single-word utterances gives NaN or Infinity.
**Why it happens:** Division by zero when word duration is 0, or undefined behavior when no window can be formed.
**How to avoid:** Per CONTEXT.md: "Single-word utterances: basic checks only (ghost/VAD), skip rate and sequence checks."
**Warning signs:** NaN or Infinity in `_rateAnomaly.rate` field.

### Pitfall 6: Confidence Collapse State Check Location
**What goes wrong:** Confidence collapse detected but UI still shows WCPM.
**Why it happens:** Collapse detection runs but result isn't propagated to UI rendering.
**How to avoid:** Return collapse state from `applySafetyChecks()` and persist in `_safety` field for UI to consume.
**Warning signs:** Sea of red/gray flags displayed alongside a confident WCPM number.

## Code Examples

Verified patterns adapted from codebase and user decisions.

### Time Parsing (from diagnostics.js)
```javascript
// Source: diagnostics.js
export function parseTime(t) {
  return parseFloat(String(t).replace('s', '')) || 0;
}
```

### Flag Helper Function
```javascript
// Pattern: Safely add flag with deduplication
function addFlag(word, flag) {
  if (!word._flags) {
    word._flags = [];
  }
  if (!word._flags.includes(flag)) {
    word._flags.push(flag);
  }
}
```

### Safety Config (new file)
```javascript
// safety-config.js
/**
 * Safety check thresholds.
 * Per CONTEXT.md Phase 15 decisions.
 */
export const SAFETY_THRESHOLDS = Object.freeze({
  // Rate anomaly detection
  RATE_WORDS_PER_SEC: 5.0,       // Flag words spoken faster than 5 w/s (300 WPM)
  RATE_WINDOW_SIZE: 3,           // 3-word sliding window

  // Edge tolerance (matches ghost-detector.js)
  EDGE_TOLERANCE_MS: 300,        // First/last 300ms get relaxed thresholds

  // Uncorroborated sequence thresholds (split by reference presence)
  SEQUENCE_THRESHOLD_IN_REF: 7,      // 7+ consecutive latest_only IN reference
  SEQUENCE_THRESHOLD_NOT_IN_REF: 3,  // 3+ consecutive latest_only NOT in reference

  // Confidence collapse
  COLLAPSE_THRESHOLD_PERCENT: 40,    // >40% flagged words triggers collapse
});

/**
 * Flag constants for _flags array.
 * Extends CONFIDENCE_FLAGS from confidence-config.js
 */
export const SAFETY_FLAGS = Object.freeze({
  RATE_ANOMALY: 'rate_anomaly',
  UNCORROBORATED_SEQUENCE: 'uncorroborated_sequence',
});
```

### Main Safety Check Function
```javascript
// safety-checker.js
import { parseTime } from './diagnostics.js';
import { SAFETY_THRESHOLDS, SAFETY_FLAGS } from './safety-config.js';
import { CONFIDENCE_THRESHOLDS } from './confidence-config.js';
import { buildReferenceSet } from './confidence-classifier.js';

/**
 * Apply all safety checks to processed words.
 * Call after disfluency detection, before alignment/UI display.
 *
 * @param {Array} words - Words from detectDisfluencies() output
 * @param {string} referenceText - Reference passage text
 * @param {number} audioDurationMs - Total audio duration in milliseconds
 * @returns {object} { words, collapseState, stats }
 */
export function applySafetyChecks(words, referenceText, audioDurationMs) {
  if (!words || words.length === 0) {
    return {
      words: [],
      collapseState: { isCollapsed: false, flaggedPercent: 0 },
      stats: { rateAnomalies: 0, uncorroboratedSequences: 0 }
    };
  }

  // Skip rate/sequence checks for single-word utterances
  if (words.length === 1) {
    return {
      words,
      collapseState: detectConfidenceCollapse(words),
      stats: { rateAnomalies: 0, uncorroboratedSequences: 0 }
    };
  }

  const referenceSet = buildReferenceSet(referenceText);

  // Step 1: Detect rate anomalies
  const rateStats = detectRateAnomalies(words, audioDurationMs);

  // Step 2: Detect uncorroborated sequences
  const seqStats = detectUncorroboratedSequences(words, referenceSet);

  // Step 3: Apply corroboration overrides
  applyCorroborationOverrides(words);

  // Step 4: Detect confidence collapse
  const collapseState = detectConfidenceCollapse(words);

  return {
    words,
    collapseState,
    stats: {
      rateAnomalies: rateStats.flaggedCount,
      uncorroboratedSequences: seqStats.sequenceCount
    }
  };
}
```

### Word Rate Calculation
```javascript
// Pattern: Calculate instantaneous rate between consecutive words
// Used for debugging and _rateAnomaly metadata

function calculateWordRate(word, nextWord) {
  const wordStart = parseTime(word.startTime);
  const wordEnd = parseTime(word.endTime);
  const nextStart = parseTime(nextWord.startTime);

  // Gap between words
  const gap = nextStart - wordEnd;

  // Word duration
  const duration = wordEnd - wordStart;

  // Rate = 1 word / (duration + gap)
  // This gives effective rate considering both articulation and pause
  const effectiveDuration = duration + gap;

  if (effectiveDuration > 0) {
    return 1 / effectiveDuration;
  }
  return Infinity; // Overlapping timestamps - definite anomaly
}
```

### Data Structure Output Pattern
```javascript
// Pattern: Word object with safety flags
// Per CONTEXT.md: _flags array supports multiple anomaly types

// Word with rate anomaly:
{
  word: "hallucinated",
  startTime: "1.0s",
  endTime: "1.05s",  // 50ms - impossibly fast
  source: "latest_only",
  confidence: 0.50,
  trustLevel: "low",
  _flags: ["possible_insertion", "rate_anomaly"],
  _rateAnomaly: {
    rate: 12.5,  // Words per second in this window
    windowIndex: 3
  }
}

// Word in uncorroborated sequence:
{
  word: "suspicious",
  startTime: "2.0s",
  endTime: "2.3s",
  source: "latest_only",
  confidence: 0.50,
  trustLevel: "low",
  _flags: ["possible_insertion", "uncorroborated_sequence"]
}

// Word with strong corroboration (flags overridden):
{
  word: "legitimate",
  startTime: "3.0s",
  endTime: "3.2s",
  source: "both",
  confidence: 0.95,
  trustLevel: "high"
  // No _flags - corroboration override cleared them
}
```

### Assessment-Level Safety Data
```javascript
// Pattern: Persisted in saved assessment
{
  // ... existing assessment fields ...
  _safety: {
    stats: {
      rateAnomalies: 5,
      uncorroboratedSequences: 2
    },
    collapseState: {
      isCollapsed: false,
      flaggedPercent: 15,
      flaggedCount: 8,
      totalWords: 53
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Trust all ASR output | Multi-signal anomaly detection | Phase 15 | Physically impossible outputs flagged before teacher sees them |
| Single confidence threshold | Layered detection (rate + sequence + corroboration) | Phase 15 | Multiple signals catch different failure modes |
| Binary good/bad | Additive flag array | Phase 13-15 | Preserve audit trail of all detected issues |

**Research validation:**
- 5 words/second threshold is physiologically grounded. Research shows:
  - Average oral reading: 183 WPM (3.05 w/s)
  - Maximal reading aloud: 275 WPM (4.58 w/s)
  - Auctioneers: 250-350 WPM max
  - Children read slower than adults
- Sources: [Brysbaert 2019](https://www.sciencedirect.com/science/article/abs/pii/S0749596X19300786), [VirtualSpeech](https://virtualspeech.com/blog/average-speaking-rate-words-per-minute), [Wikipedia WPM](https://en.wikipedia.org/wiki/Words_per_minute)

**Sliding window for burst detection:**
- 3-word window balances burst detection with noise tolerance
- Adaptive sliding windows are established technique for time-series anomaly detection
- Sources: [Medium - Sliding Window Algorithms](https://medium.com/@machinelearningclub/sliding-window-algorithms-for-real-time-data-processing-2012f00d07d7), [Springer - Adaptive Sliding Window](https://link.springer.com/article/10.1007/s11276-021-02852-3)

## Open Questions

Things that couldn't be fully resolved (marked as "Claude's Discretion" in CONTEXT.md):

1. **Exact sliding window implementation - overlapping vs distinct windows**
   - What we know: 3-word window, catch bursts
   - Options: (a) Overlapping windows [0,1,2], [1,2,3], [2,3,4]... or (b) Distinct windows [0,1,2], [3,4,5]...
   - Recommendation: **Overlapping windows** - they catch bursts that straddle window boundaries. Deduplicate flags to avoid counting same word multiple times.

2. **How to calculate word rate from timestamps**
   - What we know: Words have startTime and endTime
   - Options: (a) Use window start-to-end span, (b) Sum individual word durations + gaps
   - Recommendation: **Window span approach** - simpler and captures the effective rate. Rate = WINDOW_SIZE / (window_end - window_start).

3. **Internal data structure for _flags array**
   - What we know: Array of string flags, additive
   - What's unclear: Should flags include metadata?
   - Recommendation: **Separate metadata fields** - keep _flags as simple strings for easy filtering. Put metadata (e.g., rate value) in separate `_rateAnomaly` object.

4. **Sequence tracking across filtered words**
   - What we know: Ghost words are filtered before this step
   - What's unclear: Should ghost position break sequence count?
   - Recommendation: **Yes, reset on gaps** - since ghosts are filtered, their positions create gaps in the word array. Only count consecutive `latest_only` words in the filtered array.

## Sources

### Primary (HIGH confidence)
- `CONTEXT.md` (Phase 15) - User decisions document with specific thresholds, edge cases, flag priority
- Existing codebase: `confidence-classifier.js`, `confidence-config.js`, `disfluency-detector.js`, `ghost-detector.js` - Established patterns and pipeline
- `REQUIREMENTS.md` - SAFE-01 through SAFE-04 requirements

### Secondary (MEDIUM confidence)
- [Brysbaert 2019 - Reading Rate Meta-Analysis](https://www.sciencedirect.com/science/article/abs/pii/S0749596X19300786) - Average oral reading 183 WPM, validates 5 w/s as impossible
- [VirtualSpeech - Average Speaking Rate](https://virtualspeech.com/blog/average-speaking-rate-words-per-minute) - Auctioneers 250 WPM, validates threshold
- [Wikipedia - Words per Minute](https://en.wikipedia.org/wiki/Words_per_minute) - Physiological limits reference
- [Sliding Window Algorithms for Real-Time Processing](https://medium.com/@machinelearningclub/sliding-window-algorithms-for-real-time-data-processing-2012f00d07d7) - Window technique validation

### Tertiary (LOW confidence - for reference only)
- [ASR Hallucination Research](https://arxiv.org/html/2401.01572v1) - General hallucination detection approaches (ML-based, not directly applicable)
- [SHALLOW Benchmark](https://aclanthology.org/2025.findings-acl.1190.pdf) - Hallucination categorization framework

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies; pure JavaScript using existing utilities
- Architecture: HIGH - Pipeline integration point clear; patterns match existing codebase (Phase 13/14)
- Rate detection: HIGH - Algorithm user-specified; threshold physiologically validated
- Sequence detection: HIGH - Algorithm user-specified; thresholds defined in CONTEXT.md
- Edge cases: HIGH - User decisions explicitly cover all edge cases

**Research date:** 2026-02-03
**Valid until:** 2026-03-03 (30 days - stable domain, user decisions locked)
