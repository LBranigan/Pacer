# Phase 3: Diagnostics - Research

**Researched:** 2026-02-02
**Domain:** Speech fluency diagnostics derived from STT word timestamps and confidence scores
**Confidence:** MEDIUM

## Summary

Phase 3 builds five diagnostic features on top of the existing alignment pipeline: onset delay detection, long pause detection, self-correction detection, morphological error inference, and a crude prosody proxy. All five features derive entirely from data already returned by Google Cloud STT (word-level timestamps and confidence scores) combined with the reference text. No new libraries or APIs are needed.

The critical constraint is that Google Cloud STT word timestamps have **100ms granularity** (increments of 0.1s). This is sufficient for all five diagnostics since the thresholds involved (1s, 1.5s, 2s, 3s, 5s) are well above 100ms resolution. However, sub-100ms timing distinctions are not possible.

**Primary recommendation:** Create a single new `js/diagnostics.js` module that takes the alignment result, the STT transcript words array, and the reference text as inputs, and returns a diagnostics object consumed by `ui.js` for display.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| None needed | — | All diagnostics are computed from existing STT data | Pure arithmetic on timestamps and confidence scores |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None needed | — | — | — |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom pause detection | Web Audio API silence detection | Would give true audio-level silence but adds massive complexity; STT gaps are sufficient for 3s+ thresholds |
| Custom prosody analysis | Pitch extraction via Web Audio | Far more accurate but out of scope; crude proxy from pauses is the stated requirement |

**Installation:** No new dependencies.

## Architecture Patterns

### Recommended Project Structure
```
js/
├── diagnostics.js    # NEW — all five diagnostic analyzers
├── alignment.js      # existing — provides alignment data
├── metrics.js        # existing — WCPM and accuracy
├── app.js            # existing — orchestrates; will call diagnostics
└── ui.js             # existing — will render diagnostic results
```

### Pattern 1: Single Diagnostics Module with Named Exports
**What:** One module exporting individual analyzer functions plus a top-level `runDiagnostics()` that calls all five and returns a unified result object.
**When to use:** Always — keeps diagnostics testable individually but callable as a group.
**Example:**
```javascript
// js/diagnostics.js

/**
 * Parse STT time string "1.200s" to float seconds.
 */
function parseTime(t) {
  return parseFloat(String(t).replace('s', '')) || 0;
}

/**
 * DIAG-01: Detect word onset delays.
 * Gap = word[i].startTime - word[i-1].endTime
 * First word: gap = word[0].startTime (delay before speaking)
 *
 * Thresholds: <1s normal, 1-1.5s normal, 1.5-2s developing, 2-3s developing, >3s flag, >5s frustration
 */
export function detectOnsetDelays(transcriptWords) {
  const results = [];
  for (let i = 0; i < transcriptWords.length; i++) {
    const start = parseTime(transcriptWords[i].startTime);
    const prevEnd = i === 0 ? 0 : parseTime(transcriptWords[i - 1].endTime);
    const gap = start - prevEnd;

    let severity = null;
    if (gap >= 5) severity = 'frustration';
    else if (gap >= 3) severity = 'flag';
    else if (gap >= 1.5) severity = 'developing';

    if (severity) {
      results.push({
        wordIndex: i,
        word: transcriptWords[i].word,
        gap: Math.round(gap * 10) / 10,
        severity
      });
    }
  }
  return results;
}

/**
 * DIAG-02: Detect long non-prosodic pauses (3s+).
 * Extra allowance at punctuation boundaries.
 */
export function detectLongPauses(transcriptWords, referenceText) {
  // ... uses gaps between words, checks reference text for punctuation context
}

/**
 * DIAG-03: Detect self-corrections from repeated word/phrase patterns.
 */
export function detectSelfCorrections(transcriptWords) {
  // ... looks for repeated consecutive words/phrases in transcript
}

/**
 * DIAG-04: Infer morphological errors from low suffix confidence.
 */
export function detectMorphologicalErrors(transcriptWords, alignment) {
  // ... checks confidence on words that are substitutions where ref/hyp share a stem
}

/**
 * DIAG-05: Crude prosody proxy from pause-at-punctuation patterns.
 */
export function computeProsodyProxy(transcriptWords, referenceText) {
  // ... measures whether pauses occur at punctuation vs mid-sentence
}

/**
 * Run all diagnostics and return unified result.
 */
export function runDiagnostics(transcriptWords, alignment, referenceText) {
  return {
    onsetDelays: detectOnsetDelays(transcriptWords),
    longPauses: detectLongPauses(transcriptWords, referenceText),
    selfCorrections: detectSelfCorrections(transcriptWords),
    morphologicalErrors: detectMorphologicalErrors(transcriptWords, alignment),
    prosodyProxy: computeProsodyProxy(transcriptWords, referenceText)
  };
}
```

### Pattern 2: Linking STT Words to Alignment Results
**What:** The alignment result has `{ref, hyp, type}` but no timestamps. The STT transcript words have timestamps but no alignment classification. Diagnostics need both.
**When to use:** For DIAG-01, DIAG-04, DIAG-05 where you need to correlate aligned words with their timestamps.
**Example:**
```javascript
// In app.js, the sttLookup map already links normalized hyp words to STT metadata.
// For diagnostics, pass transcriptWords directly — they're already ordered by time.
// For DIAG-04 (morphological), pass both alignment and transcriptWords.
// The alignment hyp field can be used to look up the corresponding STT word.
```

### Pattern 3: Reference Text Punctuation Extraction
**What:** DIAG-02 and DIAG-05 need to know where punctuation falls in the reference text. The reference text is normalized (punctuation stripped) for alignment, but diagnostics need the original punctuation.
**When to use:** For pause allowance at commas/periods and prosody proxy.
**Example:**
```javascript
// Build a set of reference word positions that precede punctuation
function getPunctuationPositions(referenceText) {
  const words = referenceText.split(/\s+/);
  const positions = new Map(); // index -> punctuation type
  words.forEach((w, i) => {
    if (/[,;:]$/.test(w)) positions.set(i, 'comma');
    if (/[.!?]$/.test(w)) positions.set(i, 'period');
  });
  return positions;
}
```

### Anti-Patterns to Avoid
- **Modifying alignment.js to carry timestamps:** Keep alignment pure (ref/hyp/type). Pass STT words separately to diagnostics.
- **Doing audio-level analysis for pause detection:** STT inter-word gaps are sufficient for the 3s+ thresholds required. Audio analysis adds unjustified complexity.
- **Treating self-corrections as errors:** The requirement explicitly states self-corrections should be a separate category, not counted as errors. They should be identified and displayed separately.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stem extraction for morphological comparison | Custom stemmer | Simple shared-prefix heuristic (e.g., first 3+ chars match) | A real stemmer is overkill; we only need to detect if ref and hyp share a root to flag suffix errors |
| Silence detection from audio | Web Audio API FFT analysis | STT inter-word time gaps | STT gaps capture speaking pauses well enough for 3s+ thresholds |

**Key insight:** All five diagnostics can be computed purely from STT output (timestamps + confidence) combined with the reference text. No audio signal processing is needed.

## Common Pitfalls

### Pitfall 1: STT Timestamp Granularity is 100ms
**What goes wrong:** Assuming millisecond precision when computing gaps between words.
**Why it happens:** STT returns strings like "1.200s" which look precise but are quantized to 100ms increments.
**How to avoid:** All thresholds (1.5s, 2s, 3s, 5s) are well above 100ms, so this is fine for the current requirements. Do not try to detect sub-second timing differences below 200-300ms.
**Warning signs:** False onset delay detections clustering at exactly 0.1s boundaries.

### Pitfall 2: First Word Onset Delay Baseline
**What goes wrong:** The first word has no preceding word, so its "onset delay" is measured from time 0 (start of audio). If the recording has a lead-in silence, every first word gets flagged.
**Why it happens:** Recording start != speech start.
**How to avoid:** Either skip the first word for onset delay analysis, or use a higher threshold for the first word (e.g., 2s instead of 1.5s). Document this as a known limitation.
**Warning signs:** First word always flagged as "developing" onset delay.

### Pitfall 3: Self-Correction Detection False Positives
**What goes wrong:** Legitimate repeated words in the reference text (e.g., "the the" in some texts, or "had had") get flagged as self-corrections.
**Why it happens:** Naive consecutive-duplicate detection doesn't check the reference.
**How to avoid:** Cross-reference detected repetitions against the reference text. If the reference text also has the repeated word at that position, it's not a self-correction.
**Warning signs:** Words that appear multiple times in the reference flagged as corrections.

### Pitfall 4: Morphological Error Detection Noise
**What goes wrong:** Low confidence scores flag words that are simply unclear audio, not morphological errors.
**Why it happens:** Confidence reflects acoustic clarity, not just morphological accuracy.
**How to avoid:** Only flag words as morphological errors when: (a) they are substitutions in alignment, (b) the ref and hyp share a stem (3+ char prefix), AND (c) the confidence is below threshold. All three conditions must hold.
**Warning signs:** Many "morphological errors" on words that are just mumbled, not morphologically wrong.

### Pitfall 5: Pause-at-Punctuation Requires Mapping STT Words Back to Reference Positions
**What goes wrong:** STT words are in transcript order, but you need to know which reference position they correspond to for checking punctuation context.
**Why it happens:** The alignment maps ref to hyp, but pauses are between consecutive STT words.
**How to avoid:** Build a mapping from STT word index to reference word index using the alignment result. For each consecutive pair of STT words, check if the corresponding reference position has punctuation after it.
**Warning signs:** Prosody proxy always returns 0 or always 100%.

## Code Examples

### Parsing STT Timestamps
```javascript
// STT returns startTime/endTime as strings like "1.200s" or "0s"
function parseTime(t) {
  return parseFloat(String(t).replace('s', '')) || 0;
}

// Gap between consecutive words
function interWordGap(words, i) {
  if (i === 0) return parseTime(words[0].startTime);
  return parseTime(words[i].startTime) - parseTime(words[i - 1].endTime);
}
```

### Self-Correction Detection via Consecutive Repetitions
```javascript
function detectSelfCorrections(transcriptWords) {
  const corrections = [];
  const words = transcriptWords.map(w => w.word.toLowerCase());

  for (let i = 1; i < words.length; i++) {
    // Single word repetition: "the the cat" -> self-correction on first "the"
    if (words[i] === words[i - 1]) {
      corrections.push({
        type: 'word-repeat',
        index: i - 1,
        repeated: words[i],
        count: 1
      });
    }
    // Two-word phrase repetition: "the big the big cat"
    if (i >= 3 && words[i] === words[i - 2] && words[i - 1] === words[i - 3]) {
      corrections.push({
        type: 'phrase-repeat',
        index: i - 3,
        repeated: words[i - 3] + ' ' + words[i - 2],
        count: 1
      });
    }
  }
  return corrections;
}
```

### Morphological Error Detection via Shared Prefix
```javascript
function detectMorphologicalErrors(alignment, sttLookup) {
  const errors = [];
  for (const item of alignment) {
    if (item.type !== 'substitution' || !item.ref || !item.hyp) continue;

    // Check shared prefix (stem)
    const minLen = Math.min(item.ref.length, item.hyp.length);
    let shared = 0;
    for (let i = 0; i < minLen; i++) {
      if (item.ref[i] === item.hyp[i]) shared++;
      else break;
    }

    // At least 3 chars shared AND different suffix
    if (shared >= 3 && item.ref !== item.hyp) {
      // Check confidence
      const queue = sttLookup?.get(item.hyp);
      if (queue && queue.length > 0) {
        const meta = queue[0]; // peek, don't shift
        if (meta.confidence < 0.8) {
          errors.push({
            ref: item.ref,
            hyp: item.hyp,
            sharedPrefix: item.ref.substring(0, shared),
            confidence: meta.confidence
          });
        }
      }
    }
  }
  return errors;
}
```

### Crude Prosody Proxy
```javascript
function computeProsodyProxy(transcriptWords, referenceText) {
  // Build punctuation map from reference
  const refWords = referenceText.split(/\s+/);
  const punctAfter = new Set();
  refWords.forEach((w, i) => {
    if (/[.!?,;:]/.test(w.charAt(w.length - 1))) punctAfter.add(i);
  });

  // For each inter-word gap, classify as at-punctuation or mid-sentence
  // A good reader pauses more at punctuation, less mid-sentence
  let pauseAtPunct = 0, pauseMidSentence = 0;
  let punctCount = 0, midCount = 0;

  // This requires mapping STT word indices to reference positions
  // (simplified — real implementation needs alignment-based mapping)

  // Prosody score: ratio of avg pause at punctuation vs avg pause mid-sentence
  // Higher ratio = better prosody
  const avgPunct = punctCount > 0 ? pauseAtPunct / punctCount : 0;
  const avgMid = midCount > 0 ? pauseMidSentence / midCount : 0.001;
  return { ratio: avgPunct / avgMid, avgPauseAtPunct: avgPunct, avgPauseMid: avgMid };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Audio waveform analysis for pauses | STT timestamp gaps | Always available with STT | Simpler, sufficient for coarse thresholds |
| Manual fluency annotation | Automated from STT metadata | This phase | Enables real-time diagnostic feedback |

**Deprecated/outdated:**
- None relevant — this is custom analysis logic, not dependent on external library versions.

## Open Questions

1. **First-word onset delay baseline**
   - What we know: First word's gap is from audio start, which includes recording lead-in
   - What's unclear: Whether to skip it, use a higher threshold, or use the recorder's actual start signal
   - Recommendation: Use a 2s threshold for the first word specifically, document as known limitation

2. **STT timestamp precision empirically**
   - What we know: Documentation says 100ms increments
   - What's unclear: Whether `latest_long` model actually returns finer granularity in practice
   - Recommendation: The STATE.md already notes this needs empirical validation. For planning, assume 100ms. The thresholds are coarse enough that this works.

3. **Self-correction vs. stuttering repetition**
   - What we know: Repeated words can be self-corrections OR stuttering
   - What's unclear: Whether to differentiate these (requires timing analysis — quick repeats = stutter, slow repeats = self-correction)
   - Recommendation: For Phase 3, treat all repetitions as "self-corrections" (the simpler category). Stuttering detection could be a future enhancement.

4. **Morphological confidence threshold**
   - What we know: Need "low confidence" on suffixes, but STT gives per-word confidence, not per-morpheme
   - What's unclear: What threshold to use (0.7? 0.8?) and whether confidence reliably correlates with suffix errors
   - Recommendation: Start with confidence < 0.8 on substitutions sharing a 3+ char prefix. Tune empirically.

5. **Mapping STT word indices to reference positions for prosody**
   - What we know: Alignment gives ref-hyp pairs, but not indices into the original reference
   - What's unclear: Best way to map aligned words back to reference positions (for punctuation lookup)
   - Recommendation: Track reference word index as alignment iterates. Add an `refIndex` field to alignment items or build the mapping in diagnostics.

## Sources

### Primary (HIGH confidence)
- [Google Cloud STT Word Timestamps Documentation](https://cloud.google.com/speech-to-text/docs/async-time-offsets) — confirmed 100ms granularity, enableWordTimeOffsets parameter
- [Google Cloud STT Request Construction](https://cloud.google.com/speech-to-text/docs/speech-to-text-requests) — confirmed enableWordConfidence parameter
- Existing codebase: `js/stt-api.js` — confirms `enableWordTimeOffsets: true` and `enableWordConfidence: true` already set
- Existing codebase: `js/alignment.js` — confirmed alignment output structure `{ref, hyp, type}`

### Secondary (MEDIUM confidence)
- [FluencyBank Timestamped Dataset](https://pubs.asha.org/doi/10.1044/2024_JSLHR-24-00070) — confirms approach of using word timestamps for disfluency detection is established in speech-language pathology research
- Codebase analysis: `js/app.js` already builds `sttLookup` map (normalized word -> STT metadata queue), which can be reused by diagnostics

### Tertiary (LOW confidence)
- Morphological error detection via shared-prefix heuristic — this is a pragmatic approximation, not an established technique. Needs empirical validation.
- Prosody proxy from pause patterns — crude by design, no established benchmark for validation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries needed, all computation from existing STT data
- Architecture: HIGH — single new module pattern follows existing codebase conventions exactly
- Pitfalls: MEDIUM — identified from codebase analysis and domain knowledge; first-word baseline and morphological confidence threshold need empirical tuning
- Code examples: MEDIUM — patterns are straightforward but exact thresholds and edge cases need testing

**Research date:** 2026-02-02
**Valid until:** 2026-03-02 (stable — pure computation logic, no external dependency changes expected)
