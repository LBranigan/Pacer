# ASR Ensemble Strategy: `default` + `latest_long` Models

**Created:** 2026-02-03
**Updated:** 2026-02-03 (v7)
**Purpose:** Improve ASR accuracy for ReadingQuest ORF assessment using a two-model ensemble + VAD
**Status:** Research Complete, Ready for Implementation

**v7 Changes:**
- Added "Orphaned Stutter" fix — merges `default_only` phonetic fragments into target word
- Added "Line Skip" detection — flags physically impossible reading rates (>5 WPS)
- Added VAD calibration system with dedicated "Calibrate" button
- Calibration measures ambient noise for 1.5s, finds optimal threshold
- UI shows calibrated threshold level after calibration completes
- Dev mode includes manual threshold slider for testing

**v6 Changes:**
- Added separate disfluency detection layer (confidence ≠ fluency)
- Stutters now report severity: none | minor | moderate | significant
- Computes attempt count, total duration, max pause between attempts
- High confidence + significant stutter = "correct but struggled"
- UI shows both signals: word color (accuracy) + stutter badge (fluency)
- Clinically important for RTI intervention targeting

**v5 Changes:**
- Added 50ms asymmetric jitter buffer to handle CTC vs Conformer timestamp drift
- `default` (CTC) has tight timestamps around vowel nucleus
- `latest_long` (Conformer) has wider timestamps including context
- Jitter buffer prevents missed associations on short words with processing drift
- Only expands `latest_long` window (asymmetric) to avoid false associations
- Added `jitterAssisted` flag for debugging

**v4 Changes:**
- Added Silero VAD as "Ghost Buster" for the asymmetric trust blind spot
- Asymmetric trust alone can't detect hallucinations of boosted words in silence
- VAD provides "Evidence of Life" check: 50ms minimum speech overlap required
- Scoped narrowly: only applies to `latest_only + IN REFERENCE` cases
- Sensitive VAD config to preserve quiet speech detection

**v3 Changes:**
- **CRITICAL FIX:** Replaced text-based alignment (diff-match-patch) with temporal association
- Text alignment fails on stutters: "please" vs "p-p-please" breaks word mapping
- Temporal overlap (IoU) correctly associates same acoustic events regardless of spelling
- diff-match-patch is ONLY used for transcript → reference text (where timestamps don't exist)

**v2 Changes:**
- Added asymmetric trust policy (reference-aware classification)
- Trust `latest_only` words that appear in passage (stronger model caught quiet speech)
- Distrust `latest_only` words NOT in passage (genuine phantom risk)
- Added word hover tooltip requirement (show both model results + timestamps)
- Documented accepted trade-offs (false positives vs false negatives)

---

## Executive Summary

The current `latest_long` model has one critical flaw for ORF assessment: **its confidence scores are not reliable**. Google's documentation explicitly states: *"The API will return a value, but it is not truly a confidence score."*

The solution is a **three-layer ensemble**:
- `latest_long` — best transcription accuracy
- `default` — reliable confidence scores
- **Silero VAD** — "Ghost Buster" to detect hallucinations in silence

This document details:
1. What each model is good at for ORF
2. How to align words between two transcripts (temporal association)
3. When to flag disagreements as "uncertain"
4. Optimal settings for each model
5. How VAD closes the asymmetric trust blind spot

**wav2vec2 fine-tuning** is deferred to a future phase as it requires significant data collection investment.

---

## Part 1: Why Two Models?

### The Core Problem

| Capability | `latest_long` | `default` |
|------------|---------------|-----------|
| Transcription accuracy | Higher (Conformer architecture) | Baseline |
| **Confidence scores** | **Unreliable** (returns values but meaningless) | **Reliable** (calibrated) |
| Word timestamps | Yes | Yes |
| Speech adaptation (boost) | Yes | Yes |
| Child speech handling | Poor (~82% WER) | Poor (~80% WER) |

**The key insight:** Neither model is great at child speech, but `default` gives us **calibrated confidence scores** that let us know *when* the ASR is uncertain. `latest_long` may give better transcriptions but can't tell us which words to trust.

### What Each Model Provides for ORF

#### `latest_long` (Primary Transcription)

**Strengths:**
- Best accuracy on long-form audio (reading passages)
- Conformer architecture captures context better
- Good at recognizing words when they're spoken clearly

**Weaknesses:**
- Confidence scores are decorative (don't reflect actual uncertainty)
- May "hallucinate" expected words when boosted
- Disfluencies may be cleaned up

**Use for:** The transcript itself (what words were said)

#### `default` (Confidence Oracle)

**Strengths:**
- Calibrated confidence scores (research suggests 0.93 threshold detects 85% of errors)
- Conservative transcription (less likely to hallucinate)
- Reliable signal for "I'm not sure about this word"

**Weaknesses:**
- Slightly lower accuracy than latest_long
- May miss words that latest_long catches

**Use for:** Confidence scores to weight each word's reliability

---

## Part 2: Model Configuration

### Current Configuration (stt-api.js)

```javascript
// CURRENT - problematic
{
  model: 'latest_long',
  enableWordConfidence: true,      // Returns values, but unreliable!
  enableWordTimeOffsets: true,
  speechContexts: [{ phrases: words, boost: 5 }]  // May be too aggressive
}
```

### Recommended Configuration

#### For `latest_long` (Primary Transcription)

```javascript
const latestLongConfig = {
  encoding: encoding,
  languageCode: 'en-US',
  model: 'latest_long',
  useEnhanced: true,
  enableAutomaticPunctuation: false,
  enableSpokenPunctuation: false,
  enableWordTimeOffsets: true,
  enableWordConfidence: true,      // Still request, but don't trust
  maxAlternatives: 1,              // Reduce from 2 - not useful without confidence
  speechContexts: buildSpeechContexts(passageText, { boost: 3 })  // LOWER boost
};
```

**Key changes:**
- **Reduce boost from 5 to 3** — Higher boost increases phantom insertions
- **maxAlternatives: 1** — Alternatives are useless without real confidence
- **Don't trust confidence** — Use for display only, not decisions

#### For `default` (Confidence Oracle)

```javascript
const defaultConfig = {
  encoding: encoding,
  languageCode: 'en-US',
  model: 'default',               // Different model
  useEnhanced: true,
  enableAutomaticPunctuation: false,
  enableSpokenPunctuation: false,
  enableWordTimeOffsets: true,
  enableWordConfidence: true,      // TRUST these values
  maxAlternatives: 1,
  speechContexts: buildSpeechContexts(passageText, { boost: 2 })  // EVEN LOWER boost
};
```

**Key changes:**
- **model: 'default'** — Uses older but confidence-calibrated model
- **boost: 2** — Very conservative boosting to avoid phantom insertions
- **Trust confidence scores** — These are calibrated and meaningful

### Speech Adaptation (Phrase Hints) Strategy

The current approach boosts ALL passage words equally. This is problematic:

**Problem:** If boost is too high, the model will "hear" expected words even when the student said something different. This creates **phantom insertions** — words appearing in the transcript that weren't spoken.

**Better approach:** Tiered boosting based on word characteristics.

```javascript
function buildSpeechContexts(passageText, options = {}) {
  const { boost = 3 } = options;
  const words = passageText.toLowerCase().replace(/[^a-z'\s-]/g, '').split(/\s+/).filter(Boolean);

  // Categorize words
  const properNouns = [];      // Capitalize in original
  const uncommonWords = [];    // Long words, likely domain-specific
  const commonWords = [];      // Everything else

  const originalWords = passageText.split(/\s+/);
  for (let i = 0; i < originalWords.length; i++) {
    const orig = originalWords[i];
    const normalized = words[i];
    if (!normalized) continue;

    // Proper nouns: start with capital (not sentence start)
    if (i > 0 && /^[A-Z]/.test(orig)) {
      properNouns.push(normalized);
    } else if (normalized.length >= 8) {
      // Long words are more likely to be domain-specific
      uncommonWords.push(normalized);
    } else {
      commonWords.push(normalized);
    }
  }

  const contexts = [];

  // Proper nouns get highest boost (most likely to be misrecognized)
  if (properNouns.length > 0) {
    contexts.push({ phrases: [...new Set(properNouns)], boost: boost + 2 });
  }

  // Uncommon words get medium boost
  if (uncommonWords.length > 0) {
    contexts.push({ phrases: [...new Set(uncommonWords)], boost: boost });
  }

  // Common words get low or no boost (ASR already knows them)
  // Only include if they might be confused (e.g., homophones)
  // For now, skip boosting common words entirely

  return contexts;
}
```

### Boost Value Guidelines

| Word Type | `latest_long` Boost | `default` Boost | Rationale |
|-----------|---------------------|-----------------|-----------|
| Proper nouns | 5 | 3 | High risk of misrecognition |
| Uncommon/long words | 3 | 2 | Moderate risk |
| Common words | 0-1 | 0 | ASR already knows them; boosting adds phantom risk |

**Rule of thumb:** If the ASR already recognizes a word correctly without boosting, don't boost it. Only boost words that are likely to be misrecognized.

---

## Part 3: Temporal Association Between Transcripts

### The Problem

Two models may produce **different text representations** of the same acoustic event:

```
Audio:        [p....p....p....please.........]
              |-------- ~1.2 seconds --------|

latest_long:  ["please"]           @ 0.0-1.2s    (cleaned up stutter)
default:      ["p", "p", "please"] @ 0.0-0.3s, 0.3-0.6s, 0.6-1.2s
```

**Why text-based alignment (diff-match-patch) fails here:**
- It sees `["please"]` vs `["p", "p", "please"]`
- It marks `"p"`, `"p"` as `default_only` (orphaned)
- The confidence score for `default`'s final `"please"` (0.94) can't be mapped
- We lose the very thing we're trying to steal: calibrated confidence

**The insight:** These aren't two documents — they're two interpretations of the **same acoustic events**. The relationship is *temporal*, not textual.

### CTC vs Conformer Timestamp Drift

The two models have fundamentally different timestamp behaviors:

| Model | Architecture | Timestamp Behavior |
|-------|--------------|-------------------|
| `default` | Likely CTC/LAS | "Spiky" — tight around vowel nucleus |
| `latest_long` | Conformer/RNN-T | "Smooth" — wider, includes surrounding context |

**The problem:** Short words + processing drift can cause zero overlap.

```
Student says "a" quickly (50ms)

default (CTC):       |---|                    (2.00s - 2.05s, tight)
latest_long:              |---|               (2.08s - 2.15s, shifted)

Overlap: 0ms ✗ — Association fails!
```

**The fix:** Add a 50ms asymmetric jitter buffer to `latest_long`'s window.

```
With 50ms jitter on latest_long:

default (CTC):       |---|                    (2.00s - 2.05s, unchanged)
latest_long:       |-------|                  (2.03s - 2.20s, expanded)

Overlap: 20ms ✓ — Association succeeds!
```

**Why asymmetric?** Only expand `latest_long` (the wider one). Expanding both risks false associations in fast speech.

**Why 50ms?** Handles typical ~40ms CTC/Conformer drift without over-reaching.

### Temporal Association Algorithm

Associate words by **time overlap**, with jitter buffer for architecture drift:

```javascript
import { parseTime } from './diagnostics.js';

// 50ms jitter buffer to handle CTC vs Conformer timestamp drift
// Only applied to latest_long (asymmetric) to avoid false associations
const JITTER_SEC = 0.05;

/**
 * Associate words from two transcripts by temporal overlap.
 * Returns array of { latest, defaultAssociates, bestConfidence, agreement }.
 *
 * This is NOT text alignment — it's acoustic event association.
 * "please" and "p-p-please" in the same time window = same event.
 *
 * Includes 50ms jitter buffer on latest_long to handle CTC vs Conformer drift.
 */
function associateByTime(latestWords, defaultWords) {
  const results = [];
  const usedDefaultIndices = new Set();

  for (const lw of latestWords) {
    // JITTER BUFFER: Expand latest_long's window to handle Conformer vs CTC drift
    // Only expand latest_long (asymmetric) — default's tight timestamps are accurate
    const lStartRaw = parseTime(lw.startTime);
    const lEndRaw = parseTime(lw.endTime);
    const lStart = lStartRaw - JITTER_SEC;  // Expand start by 50ms
    const lEnd = lEndRaw + JITTER_SEC;      // Expand end by 50ms

    // Find all default words that overlap this (expanded) time window
    const overlapping = [];

    for (let i = 0; i < defaultWords.length; i++) {
      if (usedDefaultIndices.has(i)) continue;  // Already associated

      const dw = defaultWords[i];
      // DON'T expand default's window — it's already tight and accurate
      const dStart = parseTime(dw.startTime);
      const dEnd = parseTime(dw.endTime);

      // Calculate overlap with expanded latest_long window
      const overlapStart = Math.max(lStart, dStart);
      const overlapEnd = Math.min(lEnd, dEnd);
      const overlap = Math.max(0, overlapEnd - overlapStart);

      if (overlap > 0) {
        // Track if association only happened due to jitter (for debugging)
        const wouldOverlapWithoutJitter =
          Math.max(lStartRaw, dStart) < Math.min(lEndRaw, dEnd);

        overlapping.push({
          index: i,
          word: dw,
          overlap,
          jitterAssisted: !wouldOverlapWithoutJitter
        });
      }
    }

    // Sort by overlap size — prevents false associations from jitter bleeding
    // The "real" match will have much larger overlap than adjacent words
    overlapping.sort((a, b) => b.overlap - a.overlap);

    // Mark these default words as used
    for (const o of overlapping) {
      usedDefaultIndices.add(o.index);
    }

    // Best confidence from any associated default word
    const bestConfidence = overlapping.length > 0
      ? Math.max(...overlapping.map(o => o.word.confidence ?? 0))
      : null;

    // Track if any association required jitter
    const anyJitterAssisted = overlapping.some(o => o.jitterAssisted);

    // Determine agreement type
    let agreement;
    if (overlapping.length === 0) {
      agreement = 'latest_only';  // No default word in this time window
    } else if (overlapping.length === 1 &&
               normalizeWord(lw.word) === normalizeWord(overlapping[0].word.word)) {
      agreement = 'match';  // Same word, same time
    } else {
      agreement = 'temporal_match';  // Different text, same acoustic event
    }

    results.push({
      latest: lw,
      defaultAssociates: overlapping.map(o => o.word),
      bestConfidence,
      agreement,
      stutterDetected: overlapping.length > 1,
      jitterAssisted: anyJitterAssisted  // For debugging/validation
    });
  }

  // Find default words that had no overlap with any latest word
  for (let i = 0; i < defaultWords.length; i++) {
    if (!usedDefaultIndices.has(i)) {
      results.push({
        latest: null,
        defaultAssociates: [defaultWords[i]],
        bestConfidence: defaultWords[i].confidence,
        agreement: 'default_only',
        jitterAssisted: false
      });
    }
  }

  return results;
}

function normalizeWord(word) {
  return (word || '').toLowerCase().replace(/[^a-z']/g, '');
}
```

### The Stutter Case, Solved

```
latest: ["please"] @ 0.0-1.2s
default: ["p" @ 0.0-0.3s (conf: 0.4),
          "p" @ 0.3-0.6s (conf: 0.5),
          "please" @ 0.6-1.2s (conf: 0.92)]
```

With temporal association:
- `"please"` (latest) overlaps all three default words in time
- `defaultAssociates = ["p", "p", "please"]`
- `bestConfidence = 0.92` (from the final "please")
- `agreement = 'temporal_match'` (different text, same event)
- `stutterDetected = true` (multiple default words associated)

**The confidence score is preserved.** The stutter is detected. No orphaned words.

### The "Slow Stutter" Problem: Confidence ≠ Fluency

The basic stutter case works, but there's a clinical subtlety for RTI Tier 2/3 students:

```
Fast stutter (handled correctly):
  Student: "p-p-please" (400ms total, quick recovery)
  Result: stutterDetected=true, bestConfidence=0.92 ✓

Slow, labored stutter (needs refinement):
  Student: "p..." (0.5s pause) "...p..." (0.5s pause) "...please"

  latest_long: "please" (0.0s - 2.0s)  ← collapses to clean word
  default:     "p" (0.0-0.2s), "p" (0.7-0.9s), "please" (1.4-2.0s)

  Result: stutterDetected=true, bestConfidence=0.95

  Problem: Teacher sees "HIGH confidence" but student struggled for 2 seconds!
```

**The issue:** Confidence measures *accuracy* (was the word correct?), not *fluency* (did they struggle?). These are different clinical signals.

### Separate Disfluency Detection Layer

Don't modify confidence. Add a **parallel disfluency signal**:

```javascript
/**
 * Compute disfluency metrics from stutter attempts.
 * Separate from confidence — both are clinically relevant.
 */
function computeStutterMetrics(defaultAssociates) {
  if (!defaultAssociates || defaultAssociates.length <= 1) {
    return null;  // No stutter
  }

  // Sort by start time
  const sorted = [...defaultAssociates].sort(
    (a, b) => parseTime(a.startTime) - parseTime(b.startTime)
  );

  // Compute pauses between attempts
  const pauses = [];
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = parseTime(sorted[i - 1].endTime);
    const currStart = parseTime(sorted[i].startTime);
    pauses.push(Math.max(0, currStart - prevEnd));
  }

  const totalDuration =
    parseTime(sorted[sorted.length - 1].endTime) -
    parseTime(sorted[0].startTime);

  return {
    attempts: sorted.length,
    totalDurationSec: Math.round(totalDuration * 100) / 100,
    pauses,
    maxPauseSec: Math.round(Math.max(...pauses) * 100) / 100
  };
}

/**
 * Classify disfluency severity based on attempt count and pauses.
 */
function classifyDisfluency(metrics) {
  if (!metrics) {
    return { detected: false, severity: 'none', reason: null };
  }

  const { attempts, totalDurationSec, maxPauseSec } = metrics;

  // Significant: Long pauses between attempts (slow, labored stutter)
  // Common in RTI Tier 2/3 students with severe disfluency
  if (maxPauseSec >= 0.5 || totalDurationSec >= 2.0) {
    return {
      detected: true,
      severity: 'significant',
      reason: 'slow_stutter_with_pauses'
    };
  }

  // Moderate: Multiple attempts but relatively quick recovery
  if (attempts >= 3 || totalDurationSec >= 1.0) {
    return {
      detected: true,
      severity: 'moderate',
      reason: 'multiple_attempts'
    };
  }

  // Minor: Quick self-correction (e.g., "th-the")
  return {
    detected: true,
    severity: 'minor',
    reason: 'quick_self_correction'
  };
}
```

### Disfluency Severity Thresholds

| Severity | Criteria | Clinical Meaning |
|----------|----------|------------------|
| `none` | No stutter detected | Fluent production |
| `minor` | 2 attempts, <1s total, <0.5s max pause | Quick self-correction |
| `moderate` | 3+ attempts OR 1-2s total | Noticeable struggle |
| `significant` | ≥0.5s pause between attempts OR ≥2s total | Labored, effortful production |

### Integration with Word Object

```javascript
// In mergeResults(), after computing stutterDetected:

if (assoc.stutterDetected) {
  const metrics = computeStutterMetrics(assoc.defaultAssociates);
  const disfluency = classifyDisfluency(metrics);

  mergedWord.disfluency = {
    ...disfluency,
    ...metrics  // attempts, totalDurationSec, maxPauseSec
  };
} else {
  mergedWord.disfluency = { detected: false, severity: 'none' };
}
```

### Why Keep Confidence and Disfluency Separate?

| Scenario | Confidence | Disfluency | Teacher Interpretation |
|----------|------------|------------|------------------------|
| Fluent correct | HIGH | none | Great! |
| Fluent wrong | LOW | none | Error, but no struggle |
| Struggled, got it right | HIGH | significant | **Correct but needs intervention** |
| Struggled, still wrong | LOW | significant | Priority intervention target |

Combining them into one number loses this clinical nuance.

### The "Orphaned Stutter" Problem

Sometimes `latest_long` only timestamps the final clean production, leaving early stutter attempts as `default_only` orphans:

```
Student: "p..." (pause) "...p..." (pause) "...please"

latest_long: "please" (1.4s - 2.0s)  ← Only the final production
default:     "p" (0.0-0.2s), "p" (0.7-0.9s), "please" (1.4-2.0s)

With temporal association:
  "please" overlaps only "please" (1.4-2.0s)
  "p" at 0.0-0.2s → default_only → looks like INSERTION ERROR!
  "p" at 0.7-0.9s → default_only → looks like INSERTION ERROR!

Result: Student is PENALIZED for stuttering.
```

### The Fix: Merge Orphaned Stutters

After temporal association, scan for `default_only` words that are likely stutter fragments:

```javascript
const MAX_STUTTER_GAP_SEC = 2.0;  // Orphan must be within 2s of target

/**
 * Merge orphaned stutter fragments into their target words.
 * Run AFTER temporal association, BEFORE final output.
 */
function mergeOrphanedStutters(mergedWords) {
  // Work backwards to handle chains ("p p p please")
  for (let i = mergedWords.length - 1; i >= 0; i--) {
    const target = mergedWords[i];

    // Skip if not a potential target
    if (target._source === 'default_only') continue;

    // Look backwards for orphaned stutters
    let j = i - 1;
    while (j >= 0) {
      const candidate = mergedWords[j];

      // Must be default_only (orphaned)
      if (candidate._source !== 'default_only') break;

      // Must be short (phonetic onset, ≤3 chars)
      if (candidate.word.length > 3) break;

      // Must be temporally close to target
      const gap = parseTime(target.startTime) - parseTime(candidate.endTime);
      if (gap > MAX_STUTTER_GAP_SEC || gap < 0) break;

      // Must match phonetic onset of target
      const candidateNorm = candidate.word.toLowerCase().replace(/[^a-z]/g, '');
      const targetNorm = target.word.toLowerCase().replace(/[^a-z]/g, '');

      if (targetNorm.startsWith(candidateNorm)) {
        // === MERGE INTO TARGET'S DISFLUENCY ===
        target.disfluency = target.disfluency || {
          detected: false, severity: 'none', attempts: 1
        };
        target.disfluency.detected = true;
        target.disfluency.attempts = (target.disfluency.attempts || 1) + 1;
        target.disfluency.orphansMerged = target.disfluency.orphansMerged || [];
        target.disfluency.orphansMerged.push({
          word: candidate.word,
          startTime: candidate.startTime,
          endTime: candidate.endTime
        });

        // Update total duration to include orphan
        target.disfluency.totalDurationSec =
          parseTime(target.endTime) - parseTime(candidate.startTime);

        // REMOVE orphan from array (it's not an error)
        mergedWords.splice(j, 1);
        i--;  // Adjust index since we removed an element
      }

      j--;
    }

    // Reclassify severity after merging orphans
    if (target.disfluency?.orphansMerged?.length > 0) {
      const severity = classifyDisfluency({
        attempts: target.disfluency.attempts,
        totalDurationSec: target.disfluency.totalDurationSec,
        maxPauseSec: MAX_STUTTER_GAP_SEC  // Conservative estimate
      }).severity;
      target.disfluency.severity = severity;
      target.disfluency.reason = 'orphaned_stutters_merged';
    }
  }

  return mergedWords;
}
```

### Orphan Merge Criteria

| Check | Threshold | Rationale |
|-------|-----------|-----------|
| Word length | ≤ 3 chars | Phonetic onsets: "p", "th", "st", "pl" |
| Temporal gap | ≤ 2 seconds | Reasonable pause between stutter attempts |
| Phonetic match | `startsWith()` | "p" → "please", "th" → "the" |
| Direction | Backwards only | Stutters precede the target word |

### When to Use Each Alignment Method

| Comparison | Method | Why |
|------------|--------|-----|
| Transcript ↔ Transcript | **Temporal association** | Same audio, both have timestamps |
| Transcript ↔ Reference text | **diff-match-patch** | Reference has no timestamps |

diff-match-patch is still correct for comparing the merged transcript to the reference passage (what we do in `alignment.js`).

### Agreement Categories

With temporal association, we get more nuanced agreement types:

| Agreement | Meaning | Confidence Source |
|-----------|---------|-------------------|
| `match` | Same word, same time window | Use `default` confidence |
| `temporal_match` | Different text, same acoustic event (e.g., stutter) | Use best confidence from overlapping words |
| `latest_only` | No default word overlaps this time window | Apply asymmetric trust policy |
| `default_only` | No latest word overlaps this time window | Unusual — latest_long missed something |

The naive approach would flag all `latest_only` words as suspicious. **This is wrong.**

#### The "Incompetent Auditor" Problem

If we use the weaker model (`default`) to audit the stronger model (`latest_long`), we risk penalizing students for correct reading:

| Scenario | Naive Logic | Correct Logic |
|----------|-------------|---------------|
| Student mumbles "necessary" quietly | `latest_long` hears it, `default` misses it → Flag as phantom | Word is in passage → **Trust `latest_long`** |
| `latest_long` hallucinates "banana" | Both miss or only `latest_long` has it → Flag | Word NOT in passage → **Distrust** |

#### Asymmetric Trust Policy

The key insight: **we have the reference passage**. We know what words the student *should* have said.

| Category | Word in Reference? | Trust Level | Rationale |
|----------|-------------------|-------------|-----------|
| `match` | N/A | Use `default` confidence | Both agree — trust the calibrated confidence |
| `temporal_match` | N/A | Use best `default` confidence | Same event, different spelling (stutter/normalization) |
| `latest_only` | **YES** | **HIGH** | `latest_long` correctly caught a passage word that `default` missed (it's better at quiet/mumbled speech) |
| `latest_only` | **NO** | **LOW** | `latest_long` "heard" a word NOT in the passage — genuine phantom/hallucination risk |
| `default_only` | YES | MEDIUM | Unusual — check `default`'s confidence |
| `default_only` | NO | LOW | Neither model should have this word |

#### Accepted Trade-Off: "Confirmed Hallucination" Risk

By trusting `latest_only` words that appear in the reference, we accept a small risk:

**Scenario:** Text is "The big dog." Student says "The... dog" (skipping "big"). `latest_long` might hallucinate "big" to fill the gap. Since "big" is in the reference, we'd trust it incorrectly.

**Why this is acceptable:**
1. **False positives < False negatives** — Penalizing correct mumbles is worse than giving occasional unearned credit
2. **Lower boost (3 instead of 5)** makes this hallucination less likely
3. **Genuine mumbles are far more common** than "lucky hallucinations" where the model invents the exact expected word
4. **Net WCPM impact is minimal** — these edge cases are rare

#### Known Limitation: "Bag of Words" Check

The implementation uses `referenceWords.has(word)` — a set membership check, not positional matching.

**This means:** If the passage is "The dog ran. The cat sat." and the student says "The dog cat ran", we'd trust the misplaced "cat" because it's in the reference set.

**Why this is acceptable:**
- Requires a very specific error pattern (student inserts word from elsewhere in passage)
- The *other* "cat" later will show as an omission
- Net effect on WCPM is roughly neutral
- Positional matching adds significant complexity for minimal gain

---

## Part 4: Confidence-Based Flagging (Reference-Aware)

### When to Flag Words as "Uncertain"

The classification function must be **reference-aware**:

```javascript
/**
 * Classify word confidence using asymmetric trust policy.
 * @param {Object} assoc - From associateByTime()
 * @param {Set<string>} referenceWords - Normalized words from passage
 */
function classifyWordConfidence(assoc, referenceWords) {
  const { latest, defaultAssociates, bestConfidence, agreement } = assoc;

  // Thresholds from research (arXiv 2024)
  const HIGH_CONF = 0.93;   // 85% sensitivity, 75% specificity
  const LOW_CONF = 0.70;

  if (agreement === 'match') {
    // Same word in same time window — use default's calibrated confidence
    const conf = bestConfidence ?? 0;
    if (conf >= HIGH_CONF) {
      return { trust: 'high', reason: 'both_agree_high_conf' };
    } else if (conf >= LOW_CONF) {
      return { trust: 'medium', reason: 'both_agree_medium_conf' };
    } else {
      return { trust: 'low', reason: 'both_agree_low_conf' };
    }
  }

  if (agreement === 'temporal_match') {
    // Different text but same acoustic event (e.g., stutter normalized)
    // Trust the best confidence from the overlapping default words
    const conf = bestConfidence ?? 0;
    if (conf >= HIGH_CONF) {
      return { trust: 'high', reason: 'temporal_match_high_conf' };
    } else if (conf >= LOW_CONF) {
      return { trust: 'medium', reason: 'temporal_match_medium_conf' };
    } else {
      return { trust: 'low', reason: 'temporal_match_low_conf' };
    }
  }

  if (agreement === 'latest_only') {
    // ASYMMETRIC TRUST: Check if word is in the reference passage
    const word = (latest?.word || '').toLowerCase().replace(/[^a-z']/g, '');
    const inReference = referenceWords.has(word);

    if (inReference) {
      // TRUST: latest_long correctly detected a passage word
      // This is the stronger model doing its job better
      return { trust: 'high', reason: 'latest_caught_reference_word' };
    } else {
      // DISTRUST: latest_long "heard" a word NOT in the passage
      // Genuine phantom/hallucination risk
      return { trust: 'low', reason: 'phantom_not_in_reference' };
    }
  }

  if (agreement === 'default_only') {
    // latest_long missed a word that default caught — unusual
    const dw = defaultAssociates[0];
    const word = (dw?.word || '').toLowerCase().replace(/[^a-z']/g, '');
    const inReference = referenceWords.has(word);
    const conf = dw?.confidence ?? 0;

    if (inReference && conf >= HIGH_CONF) {
      return { trust: 'medium', reason: 'default_caught_reference_word' };
    } else if (!inReference) {
      return { trust: 'low', reason: 'not_in_reference' };
    }
    return { trust: 'low', reason: 'default_only_low_conf' };
  }

  return { trust: 'unknown', reason: 'unclassified' };
}

/**
 * Build reference word set from passage text.
 */
function buildReferenceWordSet(passageText) {
  const words = passageText
    .toLowerCase()
    .replace(/[^a-z'\s-]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  return new Set(words);
}
```

### Confidence Thresholds

Based on research (arXiv 2024: "Using Confidence Scores to Improve Eyes-free Detection of Speech Recognition Errors"):

| Threshold | Sensitivity | Specificity | Use Case |
|-----------|-------------|-------------|----------|
| **0.93** | 85% | 75% | Optimal for detecting errors |
| 0.85 | ~70% | ~85% | Conservative (fewer flags) |
| 0.70 | ~95% | ~50% | Aggressive (more flags) |

**Recommendation:** Use 0.93 as the "high confidence" threshold, 0.70 as "low confidence".

### Safety Check: "Line Skip" Hallucination Detection

**The Problem:** If a student skips a line of text, `latest_long` (with boost) might hallucinate the skipped words at a physically impossible reading rate.

```
Student skips from word 20 to word 50 (skipping 30 words)
latest_long "fills in" the gap with boosted words

Result: 30 words appear in 2 seconds = 15 words/sec = 900 WPM
This is PHYSICALLY IMPOSSIBLE for oral reading.
```

**Human Reading Rate Limits:**

| Reader Type | Oral Reading Rate |
|-------------|-------------------|
| Adult fluent | 150-200 WPM |
| RTI Tier 2 student | 50-100 WCPM |
| Physical maximum | ~300 WPM |
| **Impossible** | >360 WPM (6+ words/sec) |

### The Fix: Rate Anomaly Detection

```javascript
const MAX_WORDS_PER_SECOND = 5;  // 300 WPM = physical limit
const WINDOW_SIZE_SEC = 1.0;     // Check rate over 1-second windows
const MAX_UNCORROBORATED_SEQUENCE = 5;  // Flag long sequences without default support

/**
 * Flag words that appear at physically impossible reading rates.
 * Catches "line skip hallucinations" where boost causes latest_long
 * to invent words faster than humanly possible.
 */
function flagImpossibleRate(mergedWords) {
  if (mergedWords.length < 3) return mergedWords;

  for (let i = 0; i < mergedWords.length; i++) {
    const windowStart = parseTime(mergedWords[i].startTime);
    const windowEnd = windowStart + WINDOW_SIZE_SEC;

    // Count words that START within this 1-second window
    let wordsInWindow = 0;
    const windowWords = [];

    for (let j = i; j < mergedWords.length; j++) {
      const wordStart = parseTime(mergedWords[j].startTime);
      if (wordStart >= windowEnd) break;
      wordsInWindow++;
      windowWords.push(mergedWords[j]);
    }

    // Check if rate exceeds physical limit
    if (wordsInWindow > MAX_WORDS_PER_SECOND) {
      for (const word of windowWords) {
        // Only flag if we don't have strong corroboration
        const hasDefaultSupport = word._source === 'both' || word._source === 'match';
        const hasHighConfidence = word.confidence >= 0.9;

        if (!hasDefaultSupport || !hasHighConfidence) {
          word.trustLevel = {
            trust: 'low',
            reason: 'impossible_reading_rate',
            rateWPS: wordsInWindow
          };
          word._flags = word._flags || [];
          word._flags.push('rate_anomaly');
        }
      }
    }
  }

  return mergedWords;
}

/**
 * Flag long sequences of latest_only words without default corroboration.
 * If latest_long produces 5+ consecutive words that default doesn't hear,
 * something is likely wrong (hallucination or audio issue).
 */
function flagLongUncorroboratedSequences(mergedWords) {
  let uncorroboratedCount = 0;
  let sequenceStart = -1;

  for (let i = 0; i <= mergedWords.length; i++) {
    const word = mergedWords[i];
    const isUncorroborated = word && word._source === 'latest_only';

    if (isUncorroborated) {
      if (sequenceStart === -1) sequenceStart = i;
      uncorroboratedCount++;
    } else {
      // End of sequence (or end of array)
      if (uncorroboratedCount > MAX_UNCORROBORATED_SEQUENCE) {
        for (let j = sequenceStart; j < i; j++) {
          mergedWords[j].trustLevel = {
            trust: 'low',
            reason: 'long_uncorroborated_sequence',
            sequenceLength: uncorroboratedCount
          };
          mergedWords[j]._flags = mergedWords[j]._flags || [];
          mergedWords[j]._flags.push('uncorroborated_sequence');
        }
      }
      uncorroboratedCount = 0;
      sequenceStart = -1;
    }
  }

  return mergedWords;
}
```

### Rate Anomaly Thresholds

| Check | Threshold | Rationale |
|-------|-----------|-----------|
| Words per second | > 5 (300 WPM) | Beyond physical oral reading limit |
| Window size | 1 second | Catches local bursts, not global rate |
| Uncorroborated sequence | > 5 consecutive | If default misses 5+ words, suspicious |
| Corroboration override | `_source === 'both'` + conf >= 0.9 | Strong evidence overrides rate flag |

### How Flagging Affects ORF Metrics

#### WCPM Calculation

```javascript
function computeWCPMWithUncertainty(alignment, transcriptAlignment, elapsedSeconds) {
  let correctCount = 0;
  let uncertainCount = 0;

  for (const word of alignment) {
    if (word.type === 'correct') {
      const trustInfo = word.trustLevel;  // From ensemble classification
      if (trustInfo.trust === 'high') {
        correctCount++;
      } else if (trustInfo.trust === 'medium') {
        correctCount += 0.75;  // Partial credit
        uncertainCount++;
      } else {
        correctCount += 0.5;   // Low confidence
        uncertainCount++;
      }
    }
  }

  const wcpm = (correctCount / elapsedSeconds) * 60;
  const wcpmLow = ((correctCount - uncertainCount * 0.5) / elapsedSeconds) * 60;
  const wcpmHigh = ((correctCount + uncertainCount * 0.5) / elapsedSeconds) * 60;

  return {
    wcpm: Math.round(wcpm),
    wcpmRange: [Math.round(wcpmLow), Math.round(wcpmHigh)],
    uncertainWords: uncertainCount
  };
}
```

#### Error Classification

| Trust Level | Display to Teacher |
|-------------|-------------------|
| HIGH | Show as definite error (substitution/omission) |
| MEDIUM | Show as "likely error" with indicator |
| LOW | Show as "possible error — review audio" |

---

## Part 5: VAD "Ghost Buster" (Silero VAD)

### The Asymmetric Trust Blind Spot

The asymmetric trust policy has one vulnerability: **boosted words that hallucinate into silence**.

```
Reference: "The necessary steps were taken."
Student reads: "The ne—" (stops, gives up, 3 seconds of silence)

latest_long: "The necessary" (hallucinated "necessary" due to boost)
default: "The" (nothing during silence)

Asymmetric trust sees:
  - "necessary" is latest_only
  - "necessary" IS in reference
  - Result: HIGH trust ✗ (false positive!)
```

Neither ASR model can tell us "there was no speech here." We need a third signal.

### What VAD Provides

VAD (Voice Activity Detection) answers: *"Was there any human speech in this time window?"*

| latest_long says | VAD says | Conclusion |
|------------------|----------|------------|
| "necessary" at 1.5-2.1s | Speech at 0.0-1.4s only | **Ghost** — no speech when word claimed |
| "necessary" at 1.5-2.1s | Speech at 1.4-2.2s | **Real** — speech energy present |

### The "50ms Evidence of Life" Rule

**Problem:** Words like "stop", "apart", "potato" contain stop closures — tiny milliseconds of silence where the tongue blocks air before releasing a 'p', 't', 'k'.

An aggressive VAD might flag these as ghosts.

**Solution:** Don't require 100% speech overlap. Require "evidence of life."

```javascript
const MIN_SPEECH_REQUIRED_SEC = 0.05;  // 50ms

function isGhostWord(word, speechSegments) {
  const wordStart = parseTime(word.startTime);
  const wordEnd = parseTime(word.endTime);

  // Calculate total overlap with any speech segment
  let totalOverlap = 0;

  for (const segment of speechSegments) {
    const overlapStart = Math.max(wordStart, segment.start);
    const overlapEnd = Math.min(wordEnd, segment.end);
    if (overlapEnd > overlapStart) {
      totalOverlap += (overlapEnd - overlapStart);
    }
  }

  // Real words (even short ones like "a" or "I") have 100ms+ of voiced sound
  // Ghosts in silence have 0ms
  return totalOverlap < MIN_SPEECH_REQUIRED_SEC;
}
```

**Why 50ms works:**

| Word Type | Typical Duration | Speech Overlap | 50ms Rule |
|-----------|------------------|----------------|-----------|
| Short word ("a", "I") | 100-150ms | 100-150ms | KEEP ✓ |
| Stop consonant ("stop") | 300-400ms | 250-350ms (gap bridged) | KEEP ✓ |
| Quiet mumble | 200-400ms | 150-300ms | KEEP ✓ |
| Ghost in silence | N/A | 0-10ms (breathing noise) | VETO ✓ |

### Scoping VAD Narrowly

**Critical:** Don't use VAD as a universal filter. Only check VAD for the specific blind spot.

```javascript
function classifyWordConfidence(assoc, referenceWords, speechSegments) {
  const { latest, defaultAssociates, bestConfidence, agreement } = assoc;

  // ... existing match/temporal_match logic unchanged ...

  if (agreement === 'latest_only') {
    const word = normalize(latest.word);
    const inReference = referenceWords.has(word);

    if (inReference) {
      // THIS is the blind spot — check VAD for "Evidence of Life"
      const isGhost = isGhostWord(latest, speechSegments);

      if (isGhost) {
        // Boosted hallucination in silence
        return { trust: 'low', reason: 'vad_ghost_in_reference' };
      }
      // Real word that default missed (latest_long is better at quiet speech)
      return { trust: 'high', reason: 'latest_caught_reference_word' };
    } else {
      // NOT in reference — already low trust, no VAD needed
      return { trust: 'low', reason: 'phantom_not_in_reference' };
    }
  }

  // ... rest unchanged ...
}
```

**When VAD is NOT consulted:**

| Agreement | VAD Check? | Reason |
|-----------|------------|--------|
| `match` | No | Both models agree — trust temporal association |
| `temporal_match` | No | Both models heard something — stutter case |
| `latest_only` + NOT in reference | No | Already low trust |
| `latest_only` + IN reference | **Yes** | This is the blind spot |
| `default_only` | No | latest_long missed it, use default confidence |

### VAD Timing: "Post-Process Safety Valve" (Chromebook-Safe)

**The Problem:** Running VAD live during recording risks CPU spikes that cause audio skips on low-power devices (Chromebooks).

**The Solution:** Post-process VAD — run on completed recording, not live.

```
1. Record: Just record audio + show waveform (Low CPU, Chromebook-safe)
2. Stop: Student clicks "Stop"
3. Process: Run VAD on the full file locally while "Processing..." spinner shows
4. Send: Upload to Google STT

Latency Cost: Adds ~0.5 seconds to wait time at the end
Safety Gain: 100% safe — recording is already finished, CPU spike can't cause audio skips
```

### Silero VAD Configuration

**The Problem:** A hardcoded threshold (0.35) is risky because:
- Classroom noise levels vary dramatically
- Microphone sensitivity varies
- Soft-spoken students may be missed
- Noisy environments trigger false positives

**The Solution:** VAD Calibration System with dedicated "Calibrate" button.

### VAD Calibration System

```javascript
// Default config — overridden by calibration
const vadConfig = {
  threshold: 0.35,              // Will be set by calibration
  min_speech_duration_ms: 50,   // Short words like "a" or "I"
  min_silence_duration_ms: 200, // Bridges stop consonant gaps
  calibrated: false,            // Track calibration state
  calibratedAt: null
};

const CALIBRATION_DURATION_MS = 1500;
const TARGET_FALSE_POSITIVE_RATE = 0.05;  // Max 5% speech during "silence"

/**
 * Calibrate VAD threshold based on ambient noise.
 * Called when user clicks "Calibrate" button.
 *
 * @param {MediaStream} stream - Active microphone stream
 * @returns {Object} { threshold, noiseLevel, success }
 */
async function calibrateVAD(stream) {
  // 1. Record ambient noise for 1.5 seconds
  const calibrationBlob = await recordForDuration(stream, CALIBRATION_DURATION_MS);

  // 2. Test different thresholds to find optimal
  const thresholds = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60];
  let optimalThreshold = 0.35;  // Fallback
  let noiseLevel = 'unknown';

  for (const threshold of thresholds) {
    const segments = await runVADWithThreshold(calibrationBlob, threshold);
    const speechRatio = computeSpeechRatio(segments, CALIBRATION_DURATION_MS);

    // Find lowest threshold that doesn't trigger too much on silence
    if (speechRatio <= TARGET_FALSE_POSITIVE_RATE) {
      optimalThreshold = threshold;
      break;
    }
  }

  // 3. Apply safety margin (bias toward sensitivity)
  //    We want to catch quiet speech, so go slightly lower
  const finalThreshold = Math.max(0.15, optimalThreshold - 0.05);

  // 4. Classify noise level for UI display
  if (optimalThreshold >= 0.50) {
    noiseLevel = 'high';
  } else if (optimalThreshold >= 0.35) {
    noiseLevel = 'moderate';
  } else {
    noiseLevel = 'low';
  }

  // 5. Update config
  vadConfig.threshold = finalThreshold;
  vadConfig.calibrated = true;
  vadConfig.calibratedAt = new Date().toISOString();
  vadConfig.noiseLevel = noiseLevel;

  return {
    threshold: finalThreshold,
    noiseLevel,
    success: true
  };
}

/**
 * Detect if calibration failed (user spoke during calibration).
 */
function detectCalibrationFailure(calibrationSegments, durationMs) {
  const speechRatio = computeSpeechRatio(calibrationSegments, durationMs);
  // If VAD detected >30% speech during "silence", user probably spoke
  return speechRatio > 0.30;
}

function computeSpeechRatio(segments, totalDurationMs) {
  const speechMs = segments.reduce((sum, seg) =>
    sum + (seg.end - seg.start) * 1000, 0);
  return speechMs / totalDurationMs;
}

async function runVADWithThreshold(audioBlob, threshold) {
  const config = { ...vadConfig, threshold };
  const vad = await SileroVAD.create(config);
  return await vad.process(audioBlob);
}
```

### VAD Calibration UI

**Dedicated "Calibrate" button** (separate from recording controls):

```
┌─────────────────────────────────────────────────────────────┐
│  🎤 Microphone Settings                                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [ 🔧 Calibrate Microphone ]                                │
│                                                             │
│  Status: ● Not calibrated                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**During calibration:**

```
┌─────────────────────────────────────────────────────────────┐
│  🎤 Microphone Calibration                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  🔇 Please remain QUIET for 2 seconds...                    │
│                                                             │
│  [████████████░░░░░░░░] 1.2s / 1.5s                         │
│                                                             │
│  Measuring ambient noise level...                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**After successful calibration:**

```
┌─────────────────────────────────────────────────────────────┐
│  🎤 Microphone Settings                                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [ 🔧 Recalibrate ]                                         │
│                                                             │
│  Status: ● Calibrated                                       │
│  Noise level: Low 🟢                                        │
│  VAD threshold: 0.25                                        │
│  Calibrated: 2 minutes ago                                  │
│                                                             │
│  ⚙️ Advanced (Dev Mode):                                    │
│     Manual threshold: [────●──────────] 0.25                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**If calibration fails (user spoke):**

```
┌─────────────────────────────────────────────────────────────┐
│  🎤 Calibration Failed                                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ⚠️ Speech detected during calibration.                     │
│     Please remain quiet and try again.                      │
│                                                             │
│  [ Try Again ]  [ Use Default (0.35) ]                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Noise Level Indicators

| Level | Threshold Found | UI Display | Meaning |
|-------|-----------------|------------|---------|
| Low | < 0.35 | 🟢 Low | Quiet environment, sensitive detection |
| Moderate | 0.35 - 0.49 | 🟡 Moderate | Some background noise |
| High | ≥ 0.50 | 🔴 High | Noisy environment, may miss quiet speech |

### Dev Mode: Manual Threshold Slider

For testing and debugging, include a manual slider (hidden by default):

```javascript
// In UI settings panel
function renderVADDevControls() {
  return `
    <details>
      <summary>⚙️ Advanced VAD Settings (Dev Mode)</summary>
      <label>
        Manual threshold override:
        <input type="range"
               id="vadThresholdSlider"
               min="0.10" max="0.90" step="0.05"
               value="${vadConfig.threshold}"
               onchange="updateVADThreshold(this.value)">
        <span id="vadThresholdValue">${vadConfig.threshold}</span>
      </label>
    </details>
  `;
}

function updateVADThreshold(value) {
  vadConfig.threshold = parseFloat(value);
  vadConfig.calibrated = false;  // Mark as manually overridden
  document.getElementById('vadThresholdValue').textContent = value;
  console.log(`VAD threshold manually set to ${value}`);
}
```

### Running VAD (with calibration)

```javascript
async function runVAD(audioBlob) {
  // Warn if not calibrated
  if (!vadConfig.calibrated) {
    console.warn('VAD not calibrated — using default threshold', vadConfig.threshold);
  }

  const vad = await SileroVAD.create({
    threshold: vadConfig.threshold,
    min_speech_duration_ms: vadConfig.min_speech_duration_ms,
    min_silence_duration_ms: vadConfig.min_silence_duration_ms
  });

  const segments = await vad.process(audioBlob);
  return segments;
}
```

### Integration with Ensemble Pipeline

```
Audio Blob
    │
    ├────────────┬────────────┬────────────┐
    ▼            ▼            ▼            │
latest_long   default    Silero VAD       │
(transcript)  (confidence) (speech segs)   │
    │            │            │            │
    └────────────┴────────────┴────────────┘
                        │
                        ▼
              associateByTime()
                        │
                        ▼
          classifyWordConfidence()
                   │
                   ├── match/temporal_match
                   │      → use default confidence
                   │
                   └── latest_only + IN REFERENCE
                              │
                              ▼
                       isGhostWord(speechSegments)
                         overlap < 50ms?
                              │
                       ┌──────┴──────┐
                       ▼             ▼
                    GHOST         TRUST
              (vad_ghost)   (latest_caught)
```

### Hover Tooltip for VAD-Vetoed Words

When a word is vetoed by VAD, the tooltip should explain why:

```
┌─────────────────────────────────────────┐
│  "necessary"                            │
├─────────────────────────────────────────┤
│  latest_long:                           │
│    Word: "necessary"                    │
│    Time: 1.700s - 2.300s                │
│    Confidence: 0.78 (unreliable)        │
│                                         │
│  default:                               │
│    ⚠ Did not detect this word           │
│                                         │
│  VAD Analysis:                          │
│    Speech segments: 0.0s - 1.4s         │
│    Word window: 1.7s - 2.3s             │
│    Speech overlap: 0ms                  │
│                                         │
│  Agreement: LATEST_ONLY                 │
│  Trust: LOW (vad_ghost_in_reference)    │
│  ⚠ Ghost: No speech detected in window  │
│    Word is in reference but VAD found   │
│    no human voice at this timestamp.    │
└─────────────────────────────────────────┘
```

### Cost-Benefit Summary

| Factor | Assessment |
|--------|------------|
| **Problem solved** | Boosted hallucinations in silence (asymmetric trust blind spot) |
| **False positive risk** | Very quiet mumbles might be flagged (~5% of quiet speech) |
| **Mitigation** | Low threshold (0.35), 200ms silence bridging |
| **Performance** | Silero VAD is fast (~10ms for 60s audio) |
| **Complexity** | Moderate — one additional processing step |
| **Worth it?** | **Yes** — false positive (credit for hallucinated word) is worse than false negative (flag rare ultra-quiet mumble) |

---

## Part 6: Implementation Architecture

### API Call Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Audio Blob                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ (parallel processing)
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
       │ latest_long  │ │   default    │ │  Silero VAD  │
       │ boost: 3     │ │ boost: 2     │ │ threshold:   │
       │              │ │              │ │ 0.35         │
       └──────────────┘ └──────────────┘ └──────────────┘
              │               │               │
              │ transcript    │ transcript    │ speech
              │ + timestamps  │ + timestamps  │ segments
              │ (unrel conf)  │ (rel conf)    │ [{start,end}]
              │               │               │
              ▼               ▼               ▼
       ┌──────────────────────────────────────────┐
       │         associateByTime()                │
       │   TEMPORAL association (not text diff)   │
       │   "please" ↔ "p-p-please" if same time   │
       └──────────────────────────────────────────┘
                              │
                              ▼
       ┌──────────────────────────────────────────┐
       │    classifyWordConfidence()              │
       │    + isGhostWord() for blind spot        │
       │                                          │
       │    latest_only + IN REF → check VAD      │
       │      overlap < 50ms → GHOST (veto)       │
       │      overlap >= 50ms → TRUST             │
       └──────────────────────────────────────────┘
                              │
                              ▼
       ┌──────────────────────────────────────────┐
       │         mergeResults()                   │
       │   - Use latest_long's words              │
       │   - Use latest_long's timestamps         │
       │   - Use default's best confidence        │
       │   - Detect stutters (multi-word assoc)   │
       │   - Flag disagreements + VAD ghosts      │
       └──────────────────────────────────────────┘
                              │
                              ▼
       ┌──────────────────────────────────────────┐
       │         alignWords()                     │
       │   (existing reference alignment)         │
       └──────────────────────────────────────────┘
                              │
                              ▼
       ┌──────────────────────────────────────────┐
       │         Scoring + Diagnostics            │
       │   (with uncertainty propagation)         │
       └──────────────────────────────────────────┘
```

### New Module: `ensemble-stt.js`

```javascript
// ensemble-stt.js — Dual-model STT with confidence merging

import { setStatus } from './ui.js';

/**
 * Send audio to both models in parallel, merge results.
 */
export async function sendToEnsembleSTT(blob, encoding) {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) { setStatus('Please enter your API key.'); return null; }

  setStatus('Sending to Google Cloud STT (dual model)...');
  const base64 = await blobToBase64(blob);

  const passageText = document.getElementById('transcript').value.trim();

  // Build configs for both models
  const latestConfig = buildConfig('latest_long', passageText, { boost: 3 });
  const defaultConfig = buildConfig('default', passageText, { boost: 2 });

  // Send both requests in parallel
  const [latestResult, defaultResult] = await Promise.all([
    sendRequest(apiKey, latestConfig, base64),
    sendRequest(apiKey, defaultConfig, base64)
  ]);

  if (!latestResult || !defaultResult) {
    // Fallback to single model if one fails
    return latestResult || defaultResult;
  }

  // Merge results
  return mergeResults(latestResult, defaultResult);
}

function buildConfig(model, passageText, options) {
  const contexts = buildSpeechContexts(passageText, options);

  return {
    encoding: encoding,
    languageCode: 'en-US',
    model: model,
    useEnhanced: true,
    enableAutomaticPunctuation: false,
    enableSpokenPunctuation: false,
    enableWordTimeOffsets: true,
    enableWordConfidence: true,
    maxAlternatives: 1,
    speechContexts: contexts
  };
}

function mergeResults(latestResult, defaultResult, passageText) {
  const latestWords = extractWords(latestResult);
  const defaultWords = extractWords(defaultResult);

  // Build reference word set for asymmetric trust policy
  const referenceWords = buildReferenceWordSet(passageText);

  // Associate transcripts BY TIME, not text
  // This correctly handles stutters: "please" vs "p-p-please"
  const associated = associateByTime(latestWords, defaultWords);

  // Merge: use latest_long's transcript, default's confidence
  const mergedWords = [];

  for (const assoc of associated) {
    // Classify using reference-aware asymmetric trust policy
    const trustLevel = classifyWordConfidence(assoc, referenceWords);

    if (assoc.agreement === 'match' || assoc.agreement === 'temporal_match') {
      // Both models detected something in this time window
      // Use latest's word (better accuracy), default's confidence (calibrated)
      mergedWords.push({
        word: assoc.latest.word,
        startTime: assoc.latest.startTime,
        endTime: assoc.latest.endTime,
        confidence: assoc.bestConfidence,  // Best from overlapping default words
        trustLevel: trustLevel,
        _source: assoc.agreement === 'match' ? 'both' : 'temporal_match',
        stutterDetected: assoc.stutterDetected,
        // Store both model results for hover tooltip
        _debug: {
          latest: {
            word: assoc.latest.word,
            startTime: assoc.latest.startTime,
            endTime: assoc.latest.endTime,
            confidence: assoc.latest.confidence  // (unreliable but show it)
          },
          // May have multiple default words (stutter case)
          default: assoc.defaultAssociates.map(dw => ({
            word: dw.word,
            startTime: dw.startTime,
            endTime: dw.endTime,
            confidence: dw.confidence
          }))
        }
      });
    } else if (assoc.agreement === 'latest_only') {
      // No default word overlapped this time window
      // Use reference-aware trust (HIGH if in passage, LOW if not)
      mergedWords.push({
        word: assoc.latest.word,
        startTime: assoc.latest.startTime,
        endTime: assoc.latest.endTime,
        confidence: trustLevel.trust === 'high' ? 0.85 : 0.5,
        trustLevel: trustLevel,
        _source: 'latest_only',
        _debug: {
          latest: {
            word: assoc.latest.word,
            startTime: assoc.latest.startTime,
            endTime: assoc.latest.endTime,
            confidence: assoc.latest.confidence
          },
          default: []  // No default words in this time window
        }
      });
    } else if (assoc.agreement === 'default_only') {
      // latest_long didn't detect anything in this time window
      const dw = assoc.defaultAssociates[0];
      mergedWords.push({
        word: dw.word,
        startTime: dw.startTime,
        endTime: dw.endTime,
        confidence: dw.confidence,
        trustLevel: trustLevel,
        _source: 'default_only',
        _debug: {
          latest: null,  // latest_long had nothing here
          default: [{
            word: dw.word,
            startTime: dw.startTime,
            endTime: dw.endTime,
            confidence: dw.confidence
          }]
        }
      });
    }
  }

  // Return in same format as single-model result
  return {
    results: [{
      alternatives: [{
        transcript: mergedWords.map(w => w.word).join(' '),
        confidence: averageConfidence(mergedWords),
        words: mergedWords
      }]
    }],
    _ensemble: {
      latestWordCount: latestWords.length,
      defaultWordCount: defaultWords.length,
      agreements: aligned.filter(a => a.agreement === 'match').length,
      latestOnly: aligned.filter(a => a.agreement === 'latest_only').length,
      defaultOnly: aligned.filter(a => a.agreement === 'default_only').length
    }
  };
}
```

### Cost Impact

Each assessment will make **2 API calls** instead of 1:

| Model | Price per 15s | Typical 60s passage |
|-------|---------------|---------------------|
| `latest_long` | $0.006 | $0.024 |
| `default` | $0.006 | $0.024 |
| **Total** | $0.012 | **$0.048** |

**2x cost increase** — but provides meaningful confidence scores that were previously unavailable.

---

## Part 7: Settings Summary

### `latest_long` Settings

| Setting | Current Value | Recommended Value | Reason |
|---------|---------------|-------------------|--------|
| `model` | `latest_long` | `latest_long` | No change |
| `boost` | 5 | **3** | Reduce phantom insertion risk |
| `enableWordConfidence` | true | true | Request but don't trust |
| `maxAlternatives` | 2 | **1** | Alternatives useless without confidence |
| Speech context strategy | All words equally | **Tiered by word type** | Proper nouns get higher boost |

### `default` Settings

| Setting | Current Value | Recommended Value | Reason |
|---------|---------------|-------------------|--------|
| `model` | N/A (new) | `default` | Confidence oracle |
| `boost` | N/A | **2** | Conservative to avoid phantoms |
| `enableWordConfidence` | N/A | true | **Trust these values** |
| `maxAlternatives` | N/A | 1 | Not needed |
| Speech context strategy | N/A | **Even more conservative** | Only boost proper nouns |

### Confidence Thresholds

| Threshold | Value | Use |
|-----------|-------|-----|
| HIGH_CONFIDENCE | **0.93** | Word is probably correct |
| MEDIUM_CONFIDENCE | **0.70** | Word is uncertain |
| LOW_CONFIDENCE | < 0.70 | Word is probably wrong |

---

## Part 8: UI Changes

### Teacher Dashboard

Add uncertainty indicators AND disfluency badges to word display:

```
Word Display Legend (Color = Accuracy):
  ███ High confidence (green) — word is correct
  ███ Medium confidence (yellow) — review recommended
  ███ Low confidence (red) — likely error
  ███ Phantom risk (orange border) — only one model detected

Disfluency Badges (Icon = Fluency):
  [word]      — no stutter (fluent)
  [word] ~    — minor stutter (quick self-correction)
  [word] ~~   — moderate stutter (noticeable struggle)
  [word] ⚠️   — significant stutter (labored, 2s+ or long pauses)
```

**Combined Display Examples:**
```
"please"        — High confidence, fluent (green, no badge)
"please" ~      — High confidence, minor stutter (green + ~)
"please" ⚠️     — High confidence, significant stutter (green + ⚠️)
                  Teacher sees: "Correct but struggled significantly"

"plese" ⚠️      — Low confidence, significant stutter (red + ⚠️)
                  Teacher sees: "Error AND struggled — priority target"
```

### Word Hover Tooltip (Required)

When the teacher hovers over any analyzed word, display a tooltip showing **both model results and timestamps**:

```
┌─────────────────────────────────────────┐
│  "necessary"                            │
├─────────────────────────────────────────┤
│  latest_long:                           │
│    Word: "necessary"                    │
│    Time: 3.240s - 3.890s                │
│    Confidence: 0.87 (unreliable)        │
│                                         │
│  default:                               │
│    Word: "necessary"                    │
│    Time: 3.250s - 3.880s                │
│    Confidence: 0.94 ✓                   │
│                                         │
│  Agreement: MATCH                       │
│  Trust: HIGH (both_agree_high_conf)     │
└─────────────────────────────────────────┘
```

**For `latest_only` words (trusted because in reference):**

```
┌─────────────────────────────────────────┐
│  "necessary"                            │
├─────────────────────────────────────────┤
│  latest_long:                           │
│    Word: "necessary"                    │
│    Time: 3.240s - 3.890s                │
│    Confidence: 0.72 (unreliable)        │
│                                         │
│  default:                               │
│    ⚠ Did not detect this word           │
│                                         │
│  Agreement: LATEST_ONLY                 │
│  Trust: HIGH (in reference passage)     │
│  Note: latest_long is better at         │
│        quiet/mumbled speech             │
└─────────────────────────────────────────┘
```

**For `latest_only` words (distrusted because NOT in reference):**

```
┌─────────────────────────────────────────┐
│  "banana"                               │
├─────────────────────────────────────────┤
│  latest_long:                           │
│    Word: "banana"                       │
│    Time: 5.100s - 5.450s                │
│    Confidence: 0.65 (unreliable)        │
│                                         │
│  default:                               │
│    ⚠ Did not detect this word           │
│                                         │
│  Agreement: LATEST_ONLY                 │
│  Trust: LOW (not in reference passage)  │
│  ⚠ Possible hallucination               │
└─────────────────────────────────────────┘
```

**For minor stutter (quick self-correction):**

```
┌─────────────────────────────────────────┐
│  "please" ~                             │
├─────────────────────────────────────────┤
│  latest_long:                           │
│    Word: "please"                       │
│    Time: 0.000s - 0.800s                │
│    Confidence: 0.65 (unreliable)        │
│                                         │
│  default (2 words in same window):      │
│    [1] Word: "p"                        │
│        Time: 0.000s - 0.200s            │
│        Confidence: 0.40                 │
│    [2] Word: "please"                   │
│        Time: 0.250s - 0.800s            │
│        Confidence: 0.92 ✓ (used)        │
│                                         │
│  Agreement: TEMPORAL_MATCH              │
│  Trust: HIGH (best conf = 0.92)         │
│                                         │
│  Disfluency: MINOR                      │
│    Attempts: 2                          │
│    Duration: 0.8s                       │
│    Max pause: 0.05s                     │
│    Quick self-correction                │
└─────────────────────────────────────────┘
```

**For significant stutter (slow, labored — clinical concern):**

```
┌─────────────────────────────────────────┐
│  "please" ⚠️                            │
├─────────────────────────────────────────┤
│  latest_long:                           │
│    Word: "please"                       │
│    Time: 0.000s - 2.000s                │
│    Confidence: 0.65 (unreliable)        │
│                                         │
│  default (3 words in same window):      │
│    [1] Word: "p"                        │
│        Time: 0.000s - 0.200s            │
│        Confidence: 0.40                 │
│    [2] Word: "p"                        │
│        Time: 0.700s - 0.900s            │
│        Confidence: 0.50                 │
│    [3] Word: "please"                   │
│        Time: 1.400s - 2.000s            │
│        Confidence: 0.95 ✓ (used)        │
│                                         │
│  Agreement: TEMPORAL_MATCH              │
│  Trust: HIGH (best conf = 0.95)         │
│                                         │
│  ⚠️ Disfluency: SIGNIFICANT             │
│    Attempts: 3                          │
│    Duration: 2.0s                       │
│    Max pause: 0.5s ← long gap           │
│    Labored production — intervention    │
│    target even though word is correct   │
└─────────────────────────────────────────┘
```

### Data Structure for Hover

Each merged word includes `_debug` object for tooltip. Note: `default` is now an **array** to handle stutters:

```javascript
// Normal case: both models heard same word (fluent)
{
  word: "necessary",
  startTime: "3.240s",
  endTime: "3.890s",
  confidence: 0.94,
  trustLevel: { trust: 'high', reason: 'both_agree_high_conf' },
  _source: 'both',
  stutterDetected: false,
  disfluency: { detected: false, severity: 'none' },
  _debug: {
    latest: { word: "necessary", startTime: "3.240s", endTime: "3.890s", confidence: 0.87 },
    default: [{ word: "necessary", startTime: "3.250s", endTime: "3.880s", confidence: 0.94 }]
  }
}

// Significant stutter case: correct but struggled (clinical concern)
{
  word: "please",
  startTime: "0.0s",
  endTime: "2.0s",
  confidence: 0.95,  // Best from overlapping words — word IS correct
  trustLevel: { trust: 'high', reason: 'temporal_match_high_conf' },
  _source: 'temporal_match',
  stutterDetected: true,
  disfluency: {
    detected: true,
    severity: 'significant',  // 'none' | 'minor' | 'moderate' | 'significant'
    reason: 'slow_stutter_with_pauses',
    attempts: 3,
    totalDurationSec: 2.0,
    maxPauseSec: 0.5
  },
  _debug: {
    latest: { word: "please", startTime: "0.0s", endTime: "2.0s", confidence: 0.65 },
    default: [
      { word: "p", startTime: "0.0s", endTime: "0.2s", confidence: 0.4 },
      { word: "p", startTime: "0.7s", endTime: "0.9s", confidence: 0.5 },
      { word: "please", startTime: "1.4s", endTime: "2.0s", confidence: 0.95 }
    ]
  }
}
```

### Metrics Display

Show WCPM with uncertainty range AND disfluency summary:

```
WCPM: 87 (range: 82-92)
Accuracy: 156/162 words correct (96%)
Uncertain words: 5 of 156

Fluency Concerns:
  Significant struggles: 2 words ← priority intervention targets
  Moderate struggles: 4 words
  Minor self-corrections: 8 words
```

### Ensemble Diagnostics (Debug Mode)

```
Ensemble Results:
  latest_long: 156 words
  default: 158 words
  Agreements: 148 (95%)
    - match: 145
    - temporal_match: 3 (stutters)
    - jitter-assisted: 2  ← Would have failed without jitter buffer
  latest_only: 8
    - trusted (in ref + VAD pass): 5
    - phantom (not in ref): 2
    - ghost (in ref + VAD fail): 1  ← VAD caught this!
  default_only: 2 (possible deletions)
  VAD speech segments: 12
  Jitter buffer saves: 2

Disfluency Analysis:
  Stutters detected: 14
    - significant: 2  ← clinical concern (correct but struggled)
    - moderate: 4
    - minor: 8 (quick self-corrections)
  Total struggle time: 8.5s
  Avg attempts per stutter: 2.4
```

---

## Part 9: Implementation Checklist

### Phase 1: Configuration Changes (No New Code)

- [ ] Reduce `latest_long` boost from 5 to 3
- [ ] Implement tiered boosting (proper nouns, uncommon words)
- [ ] Test with sample passages

### Phase 2: Add `default` Model Call + Temporal Association

- [ ] Create `ensemble-stt.js` module
- [ ] Add parallel API call for `default` model
- [ ] Implement `associateByTime()` function (TEMPORAL, not text-based)
- [ ] **Add 50ms asymmetric jitter buffer (JITTER_SEC = 0.05)**
- [ ] **Only expand latest_long window, not default (asymmetric)**
- [ ] **Track `jitterAssisted` flag for debugging**
- [ ] **Sort overlapping words by overlap size (prevent false associations)**
- [ ] Implement `buildReferenceWordSet()` function
- [ ] Implement `mergeResults()` function with `_debug` data
- [ ] Handle stutter detection (multiple default words → one latest word)

### Phase 3: Silero VAD Integration + Calibration

- [ ] Add Silero VAD dependency (ONNX runtime for browser)
- [ ] Implement `runVAD()` function to get speech segments
- [ ] Configure VAD defaults: `threshold: 0.35`, `min_silence_duration_ms: 200`
- [ ] Run VAD in parallel with STT API calls
- [ ] Store speech segments for classification step
- [ ] **Implement `calibrateVAD()` function for ambient noise calibration**
- [ ] **Add dedicated "Calibrate Microphone" button in UI**
- [ ] **Calibration: record 1.5s silence, find optimal threshold**
- [ ] **Display calibrated threshold level in UI after calibration**
- [ ] **Show noise level indicator (🟢 Low / 🟡 Moderate / 🔴 High)**
- [ ] **Detect calibration failure (user spoke during calibration)**
- [ ] **Dev mode: manual threshold slider for testing**

### Phase 4: Asymmetric Trust Policy + VAD Ghost Check

- [ ] Implement reference-aware `classifyWordConfidence()` function
- [ ] Add `trustLevel` to word objects
- [ ] Trust `latest_only` words that ARE in reference passage
- [ ] Distrust `latest_only` words NOT in reference passage
- [ ] **Implement `isGhostWord()` for VAD "Evidence of Life" check**
- [ ] **For `latest_only + IN REFERENCE`: check VAD overlap >= 50ms**
- [ ] **Add `vad_ghost_in_reference` trust reason**
- [ ] Update diagnostics to use real confidence from `default`
- [ ] Update morphological error detection threshold

### Phase 5: Disfluency Detection + Orphaned Stutter Fix

- [ ] Implement `computeStutterMetrics()` function
- [ ] Calculate pauses between stutter attempts
- [ ] Track attempts count, total duration, max pause
- [ ] Implement `classifyDisfluency()` function
- [ ] Severity thresholds: none | minor | moderate | significant
- [ ] Add `disfluency` object to word data structure
- [ ] Keep confidence and disfluency as SEPARATE signals (don't combine)
- [ ] Significant = maxPause >= 0.5s OR totalDuration >= 2.0s
- [ ] **Implement `mergeOrphanedStutters()` function**
- [ ] **Detect `default_only` words that are phonetic onsets (≤3 chars)**
- [ ] **Check temporal proximity (≤2s gap to target word)**
- [ ] **Check phonetic match (`startsWith()` check)**
- [ ] **Merge orphans into target's disfluency, remove from error list**

### Phase 6: Safety Checks (Rate Anomaly Detection)

- [ ] Implement `flagImpossibleRate()` function
- [ ] Sliding window check: >5 words/second = physically impossible
- [ ] Flag suspicious words as low trust (`impossible_reading_rate`)
- [ ] Only flag if not strongly corroborated by default model
- [ ] Implement `flagLongUncorroboratedSequences()` function
- [ ] Flag >5 consecutive `latest_only` words as suspicious
- [ ] Add `_flags` array to word objects for multiple anomalies

### Phase 7: UI Updates

- [ ] Add uncertainty indicators to word display
- [ ] **Add disfluency badges (~, ~~, ⚠️) alongside word colors**
- [ ] **Implement word hover tooltip showing both model results**
- [ ] Display timestamps from both models in tooltip
- [ ] Show trust reasoning in tooltip
- [ ] **Show disfluency details in tooltip (attempts, duration, max pause)**
- [ ] Show WCPM range instead of single value
- [ ] **Add fluency concerns summary (significant/moderate/minor counts)**
- [ ] Add ensemble diagnostics in debug mode
- [ ] **Add VAD calibration UI (button + status display)**
- [ ] **Show calibrated threshold and noise level after calibration**
- [ ] **Add rate anomaly indicators for flagged words**

### Phase 8: Validation

- [ ] Test with 10+ real student recordings
- [ ] Compare single-model vs ensemble results
- [ ] Validate confidence thresholds with human review
- [ ] Verify asymmetric trust policy works for quiet/mumbled speech
- [ ] Check for false positives from "lucky hallucinations"
- [ ] **Verify VAD catches boosted hallucinations in silence**
- [ ] **Verify VAD doesn't flag quiet mumbles as ghosts**
- [ ] **Monitor `jitterAssisted` count in debug output**
- [ ] **Verify jitter buffer doesn't cause false associations in fast speech**
- [ ] **Test with short function words ("a", "the", "I") to confirm association works**
- [ ] **Verify disfluency severity thresholds are clinically meaningful**
- [ ] **Test slow stutters (0.5s+ pauses) are flagged as "significant"**
- [ ] **Confirm high confidence + significant stutter shows both signals**
- [ ] **Validate with RTI specialist that disfluency display is useful**
- [ ] **Test orphaned stutter merge: "p p please" shouldn't show 2 errors**
- [ ] **Verify orphan merge respects temporal proximity (≤2s)**
- [ ] **Test VAD calibration in quiet and noisy environments**
- [ ] **Verify calibration failure detection when user speaks**
- [ ] **Test rate anomaly detection: simulate line skip scenario**
- [ ] **Verify rate check doesn't flag legitimately fast readers**
- [ ] **Test uncorroborated sequence detection (>5 latest_only words)**

---

## Part 10: Future Phase — wav2vec2 Fine-Tuning

This is deferred until data collection is possible. The ensemble approach above provides immediate improvement without ML infrastructure investment.

### Prerequisites for wav2vec2

1. **5-10 hours of transcribed child speech**
   - From actual RTI Tier 2 students
   - Verbatim transcripts (with disfluencies)

2. **GPU infrastructure**
   - Cloud: AWS p3.2xlarge (~$3/hr) or Google Colab Pro+
   - Local: RTX 3090/4090

3. **6-10 weeks implementation time**

### Expected Improvement from wav2vec2

| Metric | Current (latest_long) | Ensemble | Fine-tuned wav2vec2 |
|--------|----------------------|----------|---------------------|
| WER on child speech | ~82% | ~80% (with uncertainty) | **10-20%** |
| Confidence calibration | None | Good (from default) | Good (native) |
| Disfluency handling | Deleted | Still deleted | **Preserved** |
| Miscue detection recall | ~0.50 | ~0.55 | **~0.83** |

The ensemble approach is a bridge until wav2vec2 is feasible.

---

## Appendix A: Research Sources

### Official Documentation
- [Google Cloud STT: Latest Models](https://docs.cloud.google.com/speech-to-text/docs/latest-models) — Confirms confidence scores unreliable for latest_long
- [Google Cloud STT: Speech Adaptation](https://docs.cloud.google.com/speech-to-text/docs/adaptation-model) — Boost value guidelines
- [Google Cloud STT: Word Confidence](https://docs.cloud.google.com/speech-to-text/docs/word-confidence) — How to enable and interpret

### Research Papers
- [Using Confidence Scores to Improve Eyes-free Detection of Speech Recognition Errors (arXiv 2024)](https://arxiv.org/html/2410.20564v1) — 0.93 threshold achieves 85% sensitivity
- [Comparative Analysis of ASR Errors in Classroom Discourse (ACM 2023)](https://dl.acm.org/doi/fullHtml/10.1145/3565472.3595606) — 82-85% WER on middle school speech
- [wav2vec2 for Children's Speech (AAAS 2025)](https://aclanthology.org/2025.aaas-1.1.pdf) — 0.83 recall for miscue detection

### Codebase References
- `js/stt-api.js` — Current STT implementation
- `js/alignment.js` — diff-match-patch word alignment
- `js/diagnostics.js` — Confidence usage in morphological error detection

---

## Appendix B: Quick Reference

### Boost Values

```
Proper nouns:     latest_long=5, default=3
Uncommon words:   latest_long=3, default=2
Common words:     latest_long=0, default=0
```

### Confidence Interpretation

```
>= 0.93  HIGH    Word is probably correct
>= 0.70  MEDIUM  Word is uncertain, review audio
<  0.70  LOW     Word is probably wrong
```

### Asymmetric Trust Policy (Reference-Aware + VAD)

```
MATCH:
  Same word, same time → Use default's confidence

TEMPORAL_MATCH:
  Different text, same time (stutter) → Use best default confidence

LATEST_ONLY + IN REFERENCE:
  └─→ VAD CHECK: Does word have >= 50ms speech overlap?
      YES → TRUST (latest_long caught quiet speech)
      NO  → GHOST (vad_ghost_in_reference) — hallucination in silence

LATEST_ONLY + NOT IN REFERENCE:
  latest_long "heard" unexpected word → DISTRUST (no VAD needed)

DEFAULT_ONLY + IN REFERENCE:
  Unusual — check default's confidence

DEFAULT_ONLY + NOT IN REFERENCE:
  Neither model should have this → DISTRUST
```

### VAD Configuration (Silero) + Calibration

```
Default config (before calibration):
  threshold: 0.35
  min_speech_duration_ms: 50
  min_silence_duration_ms: 200

Calibration process:
  1. User clicks "Calibrate Microphone" button
  2. Record 1.5s of ambient noise (user stays quiet)
  3. Test thresholds from 0.15 to 0.60
  4. Find lowest threshold that doesn't trigger on noise
  5. Apply safety margin (-0.05) for sensitivity
  6. Display result: threshold + noise level (🟢/🟡/🔴)

Noise levels:
  🟢 Low:      threshold < 0.35 (quiet room)
  🟡 Moderate: threshold 0.35-0.49 (some noise)
  🔴 High:     threshold >= 0.50 (noisy, may miss quiet speech)
```

### VAD "Evidence of Life" Rule

```
MIN_SPEECH_REQUIRED = 50ms

isGhostWord(word, speechSegments):
  overlap = sum of (word.time ∩ segment.time) for all segments
  return overlap < 50ms  # Ghost if less than 50ms of speech
```

### Accepted Trade-Offs

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| False negative (penalize correct mumble) | Common | High (unfair to student) | ✅ Fixed by asymmetric trust |
| False positive ("lucky hallucination") | Rare | Low (minor WCPM inflation) | Lower boost (3 instead of 5) |
| Bag-of-words position error | Very rare | Neutral (one credit, one omission) | Accept for simplicity |
| Stutter text mismatch | Common | High (lose confidence mapping) | ✅ Fixed by temporal association |
| Boosted hallucination in silence | Occasional | High (false credit) | ✅ Fixed by VAD ghost check |
| Ultra-quiet mumble flagged as ghost | Rare (~5%) | Medium | Low VAD threshold (0.35) |
| CTC/Conformer timestamp drift | Common | High (lose association) | ✅ Fixed by 50ms jitter buffer |
| Jitter false association | Very rare | Low | Sort by overlap size, asymmetric only |
| Orphaned stutter fragments | Common | High (false insertion errors) | ✅ Fixed by orphan merge |
| Line skip hallucination | Rare | High (false credit for skipped words) | ✅ Fixed by rate anomaly check |
| VAD threshold wrong for environment | Common | Medium | ✅ Fixed by calibration |

### Orphaned Stutter Merge

```
Problem: latest_long timestamps only final "please", leaving "p p" as errors

Fix: Merge orphans that match phonetic onset of next word

Criteria:
  - default_only word
  - Length ≤ 3 chars (phonetic onset)
  - Within 2 seconds of target word
  - startsWith() match (e.g., "p" → "please")

Result: "p p please" → "please" with disfluency.attempts = 3
```

### Rate Anomaly Detection (Line Skip)

```
Problem: Student skips a line, latest_long hallucinates skipped words

Fix: Flag physically impossible reading rates

Thresholds:
  MAX_WORDS_PER_SECOND = 5   (300 WPM = human limit)
  WINDOW_SIZE = 1 second     (check local rate, not global)
  MAX_UNCORROBORATED = 5     (flag long latest_only sequences)

If >5 words in 1 second AND not corroborated by default:
  trustLevel = low, reason = 'impossible_reading_rate'
```

### Disfluency Severity (Separate from Confidence)

```
Confidence = Accuracy (was word correct?)
Disfluency = Fluency (did student struggle?)

Keep them SEPARATE — both are clinically relevant.

Severity Thresholds:
  none:        No stutter detected
  minor:       2 attempts, <1s total, <0.5s max pause
  moderate:    3+ attempts OR 1-2s total
  significant: maxPause >= 0.5s OR totalDuration >= 2s

UI Display:
  [word]      — fluent
  [word] ~    — minor (quick self-correction)
  [word] ~~   — moderate
  [word] ⚠️   — significant (clinical concern)

Example:
  "please" (green) ⚠️  = correct but struggled significantly
                        → intervention target even though WCPM counts it
```

### Word Hover Data Structure

```javascript
word._debug = {
  latest: { word, startTime, endTime, confidence } | null,
  default: [{ word, startTime, endTime, confidence }, ...] | [],  // Array for stutters
  vad: { speechOverlapMs, isGhost } | null  // VAD analysis (only for latest_only + in_ref)
}
word.stutterDetected = true | false  // Multiple default words in same time window
word.disfluency = {
  detected: true | false,
  severity: 'none' | 'minor' | 'moderate' | 'significant',
  reason: string | null,
  attempts: number,
  totalDurationSec: number,
  maxPauseSec: number
}
word.vadGhost = true | false         // VAD found no speech in word's time window
word.jitterAssisted = true | false   // Association required jitter buffer (debug)
```

### Alignment Methods

```
Transcript ↔ Transcript: TEMPORAL (associateByTime)
  - Uses time overlap, not text equality
  - "please" matches "p-p-please" if same time window
  - Enables stutter detection and confidence stealing
  - 50ms asymmetric jitter buffer handles CTC/Conformer drift

Transcript ↔ Reference: TEXT (diff-match-patch)
  - Reference has no timestamps
  - Standard word-level diff
```

### Jitter Buffer Configuration

```
JITTER_SEC = 0.05  (50ms)

Applied ONLY to latest_long window (asymmetric):
  lStart = lStartRaw - JITTER_SEC
  lEnd = lEndRaw + JITTER_SEC

default window unchanged (tight timestamps are accurate)

Why 50ms:
  - Handles ~40ms typical CTC/Conformer drift
  - Conservative enough to avoid false associations
  - RTI students read slowly (short words less common)
```

---

*Document last updated: 2026-02-03 (v7 - orphaned stutter fix, line skip detection, VAD calibration with UI)*
