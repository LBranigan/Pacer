# Phase 23: Kitchen Sink Integration - Research

**Researched:** 2026-02-05
**Domain:** ASR pipeline integration, ensemble orchestration, fallback architecture
**Confidence:** HIGH

## Summary

Phase 23 integrates three completed components (Reverb backend, sequence alignment, Deepgram cross-validation) into a unified "Kitchen Sink" ensemble that replaces the existing Google STT ensemble for primary transcription. The architecture is well-defined by prior phases and the FuturePlans documentation.

The key challenge is orchestration: calling Reverb and Deepgram in parallel, running sequence alignment on Reverb's dual-pass output to detect disfluencies, applying cross-validation to flag hallucinations, and gracefully falling back to the Google ensemble when Reverb is unavailable.

All components already exist and are tested. This phase wires them together with a feature flag for A/B comparison and a fallback mechanism for robustness.

**Primary recommendation:** Create `reverb-api.js` client and `kitchen-sink-merger.js` orchestrator that call Reverb /ensemble, run Needleman-Wunsch alignment via existing `sequence-aligner.js`, apply cross-validation via existing `deepgram-api.js`, and fall back to Google ensemble when Reverb offline.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Pure JavaScript | ES6+ | Client-side orchestration | Matches existing codebase architecture |
| fetch API | Browser native | HTTP client for Reverb service | Standard browser API, no dependencies |
| Promise.allSettled | Browser native | Parallel API calls with graceful failure | Built-in, handles partial failures |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `js/sequence-aligner.js` | Existing (Phase 21) | Needleman-Wunsch alignment | Comparing v=1.0 vs v=0.0 transcripts |
| `js/disfluency-tagger.js` | Existing (Phase 21) | Classify disfluencies | Tagging alignment insertions |
| `js/deepgram-api.js` | Existing (Phase 22) | Cross-validation | Flagging Reverb hallucinations |
| `js/ensemble-merger.js` | Existing (v1.0) | Google ensemble fallback | When Reverb unavailable |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Separate reverb-api.js | Extend stt-api.js | Clean separation of vendors; reverb-api.js is Reverb-specific |
| kitchen-sink-merger.js | Modify ensemble-merger.js | New file avoids breaking Google ensemble fallback |
| Feature flag in localStorage | Config file | localStorage allows per-session toggling without deployment |

**Installation:**
```bash
# No installation needed - pure JavaScript modules
# Backend already deployed (Phase 20)
```

## Architecture Patterns

### Recommended Project Structure
```
js/
  reverb-api.js             # NEW: Reverb HTTP client (INTG-01)
  kitchen-sink-merger.js    # NEW: Orchestrates full pipeline (INTG-05)
  sequence-aligner.js       # EXISTS: Needleman-Wunsch (Phase 21)
  disfluency-tagger.js      # EXISTS: Classification (Phase 21)
  deepgram-api.js           # EXISTS: Cross-validation (Phase 22)
  ensemble-merger.js        # EXISTS: Google fallback (v1.0)
  stt-api.js                # EXISTS: Google STT client (v1.0)
  app.js                    # MODIFY: Wire kitchen sink pipeline
```

### Pattern 1: Reverb API Client

**What:** HTTP client for local Reverb service (localhost:8765)
**When to use:** Sending audio to Reverb and receiving dual-pass transcription

**Example:**
```javascript
// Source: services/reverb/server.py endpoint specifications

const REVERB_URL = 'http://localhost:8765';

/**
 * Check if Reverb service is available.
 * Uses 3-second timeout for fast failure detection.
 */
export async function isReverbAvailable() {
  try {
    const resp = await fetch(`${REVERB_URL}/health`, {
      signal: AbortSignal.timeout(3000)
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.status === 'ok' && data.model_loaded;
  } catch {
    return false;
  }
}

/**
 * Transcribe audio with Reverb dual-pass ensemble.
 * Returns verbatim (v=1.0) and clean (v=0.0) transcripts.
 *
 * @param {Blob} blob - Audio blob (WAV recommended)
 * @returns {object|null} { verbatim, clean } or null on failure
 */
export async function sendToReverbEnsemble(blob) {
  try {
    const base64 = await blobToBase64(blob);

    const resp = await fetch(`${REVERB_URL}/ensemble`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_base64: base64 }),
      signal: AbortSignal.timeout(60000) // 60s for long audio
    });

    if (!resp.ok) {
      console.warn(`[reverb-api] Backend returned ${resp.status}`);
      return null;
    }

    const data = await resp.json();

    // Normalize word format to match project conventions
    // Reverb returns: { start_time: float, end_time: float }
    // Project uses: { startTime: "X.XXs", endTime: "X.XXs" }
    return {
      verbatim: {
        words: normalizeReverbWords(data.verbatim.words),
        transcript: data.verbatim.transcript
      },
      clean: {
        words: normalizeReverbWords(data.clean.words),
        transcript: data.clean.transcript
      }
    };
  } catch (e) {
    console.warn('[reverb-api] Service unavailable:', e.message);
    return null;
  }
}

function normalizeReverbWords(words) {
  return words.map(w => ({
    word: w.word,
    startTime: `${w.start_time}s`,
    endTime: `${w.end_time}s`,
    start_time: w.start_time,  // Keep numeric for alignment
    end_time: w.end_time,
    confidence: w.confidence
  }));
}
```

### Pattern 2: Kitchen Sink Orchestrator

**What:** Orchestrates Reverb + Deepgram + alignment into unified pipeline
**When to use:** Primary transcription flow when feature flag enabled

**Example:**
```javascript
// Source: Phase 21/22 components + FuturePlans documentation

import { isReverbAvailable, sendToReverbEnsemble } from './reverb-api.js';
import { alignTranscripts } from './sequence-aligner.js';
import { tagDisfluencies, computeDisfluencyStats } from './disfluency-tagger.js';
import { sendToDeepgram, crossValidateWithDeepgram } from './deepgram-api.js';
import { sendEnsembleSTT, mergeEnsembleResults } from './ensemble-merger.js';

/**
 * Run Kitchen Sink ensemble pipeline.
 *
 * Pipeline:
 * 1. Check Reverb availability
 * 2. If available: Reverb /ensemble + Deepgram in parallel
 * 3. Align verbatim vs clean to find disfluencies
 * 4. Cross-validate against Deepgram to catch hallucinations
 * 5. Return merged words with isDisfluency + crossValidation properties
 *
 * If Reverb unavailable: Fall back to Google ensemble
 *
 * @param {Blob} blob - Audio blob
 * @param {string} encoding - Audio encoding for Google fallback
 * @param {number} sampleRateHertz - Sample rate for Google fallback
 * @returns {object} Pipeline result
 */
export async function runKitchenSinkPipeline(blob, encoding, sampleRateHertz) {
  // Step 1: Check Reverb availability
  const reverbUp = await isReverbAvailable();

  if (!reverbUp) {
    console.log('[kitchen-sink] Reverb offline, falling back to Google ensemble');
    return await runGoogleFallback(blob, encoding, sampleRateHertz);
  }

  // Step 2: Run Reverb + Deepgram in parallel
  const [reverbResult, deepgramResult] = await Promise.allSettled([
    sendToReverbEnsemble(blob),
    sendToDeepgram(blob)
  ]);

  const reverb = reverbResult.status === 'fulfilled' ? reverbResult.value : null;
  const deepgram = deepgramResult.status === 'fulfilled' ? deepgramResult.value : null;

  if (!reverb) {
    console.log('[kitchen-sink] Reverb failed, falling back to Google ensemble');
    return await runGoogleFallback(blob, encoding, sampleRateHertz);
  }

  // Step 3: Align verbatim vs clean to detect disfluencies
  const alignment = alignTranscripts(reverb.verbatim.words, reverb.clean.words);
  const taggedAlignment = tagDisfluencies(alignment);
  const disfluencyStats = computeDisfluencyStats(taggedAlignment);

  // Step 4: Build merged word array from tagged alignment
  // Each verbatim word gets isDisfluency and disfluencyType from alignment
  const mergedWords = buildMergedWordsFromAlignment(
    reverb.verbatim.words,
    taggedAlignment
  );

  // Step 5: Apply cross-validation against Deepgram
  const deepgramWords = deepgram?.words || null;
  const validatedWords = crossValidateWithDeepgram(mergedWords, deepgramWords);

  return {
    words: validatedWords,
    source: 'kitchen_sink',
    reverb: reverb,
    deepgram: deepgram,
    disfluencyStats: disfluencyStats,
    alignment: taggedAlignment,
    _debug: {
      reverbAvailable: true,
      deepgramAvailable: !!deepgram,
      verbatimWordCount: reverb.verbatim.words.length,
      cleanWordCount: reverb.clean.words.length,
      disfluenciesDetected: disfluencyStats.total
    }
  };
}
```

### Pattern 3: Fallback to Google Ensemble

**What:** Gracefully fall back to existing Google ensemble when Reverb unavailable
**When to use:** Reverb service down, network issues, or feature flag disabled

**Example:**
```javascript
// Source: Existing ensemble-merger.js infrastructure

async function runGoogleFallback(blob, encoding, sampleRateHertz) {
  const referenceText = document.getElementById('transcript')?.value || '';

  const ensembleResult = await sendEnsembleSTT(blob, encoding, sampleRateHertz);

  if (!ensembleResult.latestLong && !ensembleResult.default) {
    return {
      words: [],
      source: 'google_fallback',
      error: 'Both Google models failed'
    };
  }

  const mergedWords = mergeEnsembleResults(ensembleResult, referenceText);

  // Add placeholder properties for consistency
  const wordsWithDefaults = mergedWords.map(w => ({
    ...w,
    isDisfluency: false,  // Google can't detect disfluencies reliably
    disfluencyType: null,
    crossValidation: 'unavailable'  // No Deepgram when using fallback
  }));

  return {
    words: wordsWithDefaults,
    source: 'google_fallback',
    _ensemble: ensembleResult,
    _debug: {
      reverbAvailable: false,
      fallbackReason: 'Reverb service unavailable'
    }
  };
}
```

### Pattern 4: Feature Flag for A/B Comparison

**What:** Toggle between Kitchen Sink and legacy Google ensemble
**When to use:** Gradual rollout, debugging, comparison testing

**Example:**
```javascript
// Feature flag stored in localStorage for persistence

const FEATURE_FLAG_KEY = 'orf_use_kitchen_sink';

export function isKitchenSinkEnabled() {
  // Default: enabled when Reverb is available
  return localStorage.getItem(FEATURE_FLAG_KEY) !== 'false';
}

export function setKitchenSinkEnabled(enabled) {
  localStorage.setItem(FEATURE_FLAG_KEY, enabled ? 'true' : 'false');
}

// In app.js analysis flow:
async function runAnalysis() {
  // ... audio preparation ...

  let result;
  if (isKitchenSinkEnabled()) {
    result = await runKitchenSinkPipeline(blob, encoding, sampleRate);
  } else {
    result = await runGoogleFallback(blob, encoding, sampleRate);
  }

  // Rest of pipeline uses result.words uniformly
  // ...
}
```

### Anti-Patterns to Avoid

- **Calling APIs sequentially when parallel is possible:** Reverb and Deepgram are independent; use `Promise.allSettled` to run in parallel
- **Hard failure on Reverb unavailability:** Always have Google fallback ready; users shouldn't see errors when Reverb is down
- **Different word formats for different sources:** Normalize all words to same structure (`word`, `startTime`, `endTime`, `confidence`, `isDisfluency`, `disfluencyType`, `crossValidation`)
- **Modifying existing ensemble-merger.js:** Create new kitchen-sink-merger.js to avoid breaking Google ensemble fallback
- **Forgetting to preserve _debug data:** Downstream components (diagnostics, UI) rely on _debug properties from merged words

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Needleman-Wunsch alignment | Custom diff algorithm | `sequence-aligner.js` | Already tested, handles edge cases |
| Disfluency classification | Pattern matching | `disfluency-tagger.js` | Already has filler word set, repetition detection |
| Cross-validation logic | Word-by-word comparison | `crossValidateWithDeepgram()` | Handles normalization, graceful null handling |
| Google fallback | Inline fallback code | Existing `sendEnsembleSTT` + `mergeEnsembleResults` | Proven, full feature set |
| Base64 encoding | Manual conversion | Existing `blobToBase64()` pattern | Used throughout codebase |

**Key insight:** All complex algorithms are already implemented. This phase is purely orchestration and wiring.

## Common Pitfalls

### Pitfall 1: Word Format Mismatch

**What goes wrong:** Reverb returns `start_time` (float), project uses `startTime` (string "X.XXs"). Mixing formats causes timestamp parsing failures downstream.

**Why it happens:** Different vendors have different JSON schemas.

**How to avoid:** Normalize immediately after receiving API response. Keep both formats:
```javascript
{
  word: w.word,
  startTime: `${w.start_time}s`,  // String for existing code
  start_time: w.start_time,        // Numeric for alignment
  endTime: `${w.end_time}s`,
  end_time: w.end_time
}
```

**Warning signs:** `NaN` in timestamps, `parseFloat("undefineds")` errors.

### Pitfall 2: Alignment Index Mismatch

**What goes wrong:** Building merged words from alignment assumes alignment indices map 1:1 to verbatim words, but alignment may have deletions (clean-only words).

**Why it happens:** Alignment output includes deletions that have no corresponding verbatim word.

**How to avoid:** Track verbatim index separately when iterating alignment:
```javascript
function buildMergedWordsFromAlignment(verbatimWords, alignment) {
  let vIdx = 0;
  return alignment
    .filter(a => a.type !== 'deletion')  // Skip clean-only entries
    .map(entry => {
      const verbatimWord = entry.verbatim !== null ? verbatimWords[vIdx++] : null;
      // ...
    });
}
```

**Warning signs:** Array index out of bounds, words appearing twice.

### Pitfall 3: Deepgram Null Handling

**What goes wrong:** Calling `crossValidateWithDeepgram(words, deepgramResult.words)` when `deepgramResult` is null.

**Why it happens:** Deepgram returns null on service unavailability.

**How to avoid:** Check for null before accessing properties:
```javascript
const deepgramWords = deepgramResult?.words || null;
const validated = crossValidateWithDeepgram(mergedWords, deepgramWords);
// crossValidateWithDeepgram already handles null → returns 'unavailable'
```

**Warning signs:** `Cannot read property 'words' of null`.

### Pitfall 4: Feature Flag Ignored in Fallback Path

**What goes wrong:** Fallback path doesn't add isDisfluency/crossValidation properties, causing `undefined` checks in downstream code.

**Why it happens:** Google ensemble doesn't detect disfluencies, so properties are missing.

**How to avoid:** Always add placeholder properties for consistency:
```javascript
const wordsWithDefaults = mergedWords.map(w => ({
  ...w,
  isDisfluency: w.isDisfluency ?? false,
  disfluencyType: w.disfluencyType ?? null,
  crossValidation: w.crossValidation ?? 'unavailable'
}));
```

**Warning signs:** UI checking `word.isDisfluency` gets undefined, causes render bugs.

### Pitfall 5: Blocking on Reverb Health Check

**What goes wrong:** Health check hangs for 30+ seconds when Reverb service is completely down (no TCP connection).

**Why it happens:** Default fetch timeout is very long.

**How to avoid:** Use short timeout (3 seconds) for health checks:
```javascript
const resp = await fetch(`${REVERB_URL}/health`, {
  signal: AbortSignal.timeout(3000)  // Fail fast
});
```

**Warning signs:** UI freezes waiting for health check, then suddenly works.

## Code Examples

### Complete reverb-api.js Structure

```javascript
/**
 * Reverb ASR HTTP client.
 * Calls localhost:8765 backend (Docker container from Phase 20).
 *
 * INTG-01: reverb-api.js client calls local Reverb service
 */

const REVERB_URL = window.REVERB_API_URL || 'http://localhost:8765';

/**
 * Convert blob to base64 string.
 */
function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

/**
 * Normalize Reverb word format to project conventions.
 *
 * Reverb returns: { word, start_time (float), end_time (float), confidence }
 * Project uses: { word, startTime ("X.XXs"), endTime ("X.XXs"), confidence }
 */
function normalizeWord(w) {
  return {
    word: w.word,
    startTime: `${w.start_time}s`,
    endTime: `${w.end_time}s`,
    start_time: w.start_time,  // Keep numeric for alignment
    end_time: w.end_time,
    confidence: w.confidence
  };
}

/**
 * Check if Reverb service is available.
 * 3-second timeout for fast failure detection.
 */
export async function isReverbAvailable() {
  try {
    const resp = await fetch(`${REVERB_URL}/health`, {
      signal: AbortSignal.timeout(3000)
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.status === 'ok' && data.model_loaded;
  } catch {
    return false;
  }
}

/**
 * Transcribe audio with Reverb dual-pass ensemble.
 * Returns verbatim (v=1.0) and clean (v=0.0) transcripts.
 *
 * @param {Blob} blob - Audio blob (WAV recommended)
 * @returns {object|null} { verbatim, clean } or null on failure
 */
export async function sendToReverbEnsemble(blob) {
  try {
    const base64 = await blobToBase64(blob);

    const resp = await fetch(`${REVERB_URL}/ensemble`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_base64: base64 }),
      signal: AbortSignal.timeout(60000)  // 60s for long audio
    });

    if (!resp.ok) {
      console.warn(`[reverb-api] Backend returned ${resp.status}`);
      return null;
    }

    const data = await resp.json();

    return {
      verbatim: {
        words: data.verbatim.words.map(normalizeWord),
        transcript: data.verbatim.transcript,
        verbatimicity: data.verbatim.verbatimicity
      },
      clean: {
        words: data.clean.words.map(normalizeWord),
        transcript: data.clean.transcript,
        verbatimicity: data.clean.verbatimicity
      }
    };
  } catch (e) {
    console.warn('[reverb-api] Service unavailable:', e.message);
    return null;
  }
}
```

### Complete kitchen-sink-merger.js Structure

```javascript
/**
 * Kitchen Sink Ensemble Merger.
 * Combines Reverb + Deepgram results into unified pipeline.
 *
 * INTG-05: kitchen-sink-merger.js combines Reverb + Deepgram results
 * INTG-06: Replaces Google STT ensemble with Kitchen Sink
 *
 * Pipeline:
 * 1. Reverb /ensemble (v=1.0 + v=0.0)
 * 2. Needleman-Wunsch alignment (sequence-aligner.js)
 * 3. Disfluency tagging (disfluency-tagger.js)
 * 4. Deepgram cross-validation (deepgram-api.js)
 * 5. Fallback to Google if Reverb unavailable
 */

import { isReverbAvailable, sendToReverbEnsemble } from './reverb-api.js';
import { alignTranscripts } from './sequence-aligner.js';
import { tagDisfluencies, computeDisfluencyStats } from './disfluency-tagger.js';
import { sendToDeepgram, crossValidateWithDeepgram } from './deepgram-api.js';
import { sendEnsembleSTT } from './stt-api.js';
import { mergeEnsembleResults, computeEnsembleStats } from './ensemble-merger.js';

// Feature flag
const FEATURE_FLAG_KEY = 'orf_use_kitchen_sink';

export function isKitchenSinkEnabled() {
  return localStorage.getItem(FEATURE_FLAG_KEY) !== 'false';
}

export function setKitchenSinkEnabled(enabled) {
  localStorage.setItem(FEATURE_FLAG_KEY, enabled ? 'true' : 'false');
}

/**
 * Build merged words from alignment result.
 * Maps alignment entries back to verbatim words with disfluency flags.
 */
function buildMergedWordsFromAlignment(verbatimWords, taggedAlignment) {
  let vIdx = 0;
  const merged = [];

  for (const entry of taggedAlignment) {
    // Skip deletions (clean-only words that aren't in verbatim)
    if (entry.type === 'deletion') {
      continue;
    }

    const verbatimWord = verbatimWords[vIdx++];

    merged.push({
      ...verbatimWord,
      isDisfluency: entry.type === 'insertion',
      disfluencyType: entry.disfluencyType || null,
      _alignment: {
        type: entry.type,
        verbatim: entry.verbatim,
        clean: entry.clean
      }
    });
  }

  return merged;
}

/**
 * Run Google ensemble fallback.
 */
async function runGoogleFallback(blob, encoding, sampleRateHertz) {
  const referenceText = document.getElementById('transcript')?.value || '';

  const ensembleResult = await sendEnsembleSTT(blob, encoding, sampleRateHertz);

  if (!ensembleResult.latestLong && !ensembleResult.default) {
    return {
      words: [],
      source: 'google_fallback',
      error: 'Both Google models failed',
      _ensemble: ensembleResult
    };
  }

  const mergedWords = mergeEnsembleResults(ensembleResult, referenceText);
  const stats = computeEnsembleStats(mergedWords);

  // Add placeholder properties for consistency
  const wordsWithDefaults = mergedWords.map(w => ({
    ...w,
    isDisfluency: false,
    disfluencyType: null,
    crossValidation: 'unavailable'
  }));

  return {
    words: wordsWithDefaults,
    source: 'google_fallback',
    _ensemble: ensembleResult,
    stats: stats,
    _debug: {
      reverbAvailable: false,
      fallbackReason: 'Reverb service unavailable'
    }
  };
}

/**
 * Run Kitchen Sink ensemble pipeline.
 *
 * @param {Blob} blob - Audio blob
 * @param {string} encoding - Audio encoding for Google fallback
 * @param {number} sampleRateHertz - Sample rate for Google fallback
 * @returns {object} Pipeline result with words array
 */
export async function runKitchenSinkPipeline(blob, encoding, sampleRateHertz) {
  // Check if feature flag disabled
  if (!isKitchenSinkEnabled()) {
    console.log('[kitchen-sink] Feature flag disabled, using Google ensemble');
    return await runGoogleFallback(blob, encoding, sampleRateHertz);
  }

  // Step 1: Check Reverb availability
  const reverbUp = await isReverbAvailable();

  if (!reverbUp) {
    console.log('[kitchen-sink] Reverb offline, falling back to Google ensemble');
    return await runGoogleFallback(blob, encoding, sampleRateHertz);
  }

  // Step 2: Run Reverb + Deepgram in parallel
  const [reverbResult, deepgramResult] = await Promise.allSettled([
    sendToReverbEnsemble(blob),
    sendToDeepgram(blob)
  ]);

  const reverb = reverbResult.status === 'fulfilled' ? reverbResult.value : null;
  const deepgram = deepgramResult.status === 'fulfilled' ? deepgramResult.value : null;

  if (!reverb) {
    console.log('[kitchen-sink] Reverb failed, falling back to Google ensemble');
    return await runGoogleFallback(blob, encoding, sampleRateHertz);
  }

  // Step 3: Align verbatim vs clean to detect disfluencies
  const alignment = alignTranscripts(reverb.verbatim.words, reverb.clean.words);
  const taggedAlignment = tagDisfluencies(alignment);
  const disfluencyStats = computeDisfluencyStats(taggedAlignment);

  // Step 4: Build merged word array from tagged alignment
  const mergedWords = buildMergedWordsFromAlignment(
    reverb.verbatim.words,
    taggedAlignment
  );

  // Step 5: Apply cross-validation against Deepgram
  const deepgramWords = deepgram?.words || null;
  const validatedWords = crossValidateWithDeepgram(mergedWords, deepgramWords);

  console.log('[kitchen-sink] Pipeline complete:', {
    verbatimWords: reverb.verbatim.words.length,
    cleanWords: reverb.clean.words.length,
    disfluencies: disfluencyStats.total,
    crossValidated: !!deepgram
  });

  return {
    words: validatedWords,
    source: 'kitchen_sink',
    reverb: reverb,
    deepgram: deepgram,
    disfluencyStats: disfluencyStats,
    alignment: taggedAlignment,
    _debug: {
      reverbAvailable: true,
      deepgramAvailable: !!deepgram,
      verbatimWordCount: reverb.verbatim.words.length,
      cleanWordCount: reverb.clean.words.length,
      disfluenciesDetected: disfluencyStats.total,
      disfluencyBreakdown: disfluencyStats.byType
    }
  };
}

/**
 * Compute statistics for Kitchen Sink result.
 */
export function computeKitchenSinkStats(result) {
  if (!result || !result.words) {
    return { totalWords: 0, disfluencies: 0, crossValidated: 0 };
  }

  const words = result.words;

  return {
    totalWords: words.length,
    disfluencies: words.filter(w => w.isDisfluency).length,
    disfluencyRate: words.length > 0
      ? (words.filter(w => w.isDisfluency).length / words.length * 100).toFixed(1) + '%'
      : '0%',
    confirmed: words.filter(w => w.crossValidation === 'confirmed').length,
    unconfirmed: words.filter(w => w.crossValidation === 'unconfirmed').length,
    unavailable: words.filter(w => w.crossValidation === 'unavailable').length,
    source: result.source
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Google latest_long + default | Reverb v=1.0 + v=0.0 | Phase 23 | Model-level disfluency detection |
| No cross-validation | Deepgram Nova-3 validation | Phase 22 | Uncorrelated error detection |
| Heuristic disfluency detection | Needleman-Wunsch alignment | Phase 21 | Mathematically optimal alignment |
| No fallback | Google ensemble fallback | Phase 23 | Robustness when Reverb offline |

**Deprecated/outdated:**
- `disfluency-detector.js`: Fragment/repetition detection removed in Phase 14 due to STT timing unreliability
- Direct disfluency detection from Google STT: Replaced by alignment-based detection with Reverb

## Open Questions

Things that couldn't be fully resolved:

1. **Optimal cross-validation threshold**
   - What we know: Words in both sources are "confirmed", Reverb-only words are "unconfirmed"
   - What's unclear: Should "unconfirmed" words be penalized in metrics? What percentage triggers a warning?
   - Recommendation: Display in UI without penalty; let Phase 24 handle UI presentation

2. **Parallel timing with slow Deepgram**
   - What we know: Deepgram has 30s timeout, Reverb may be faster
   - What's unclear: Should we wait for both, or proceed with Reverb-only if Deepgram is slow?
   - Recommendation: Use Promise.allSettled and proceed; cross-validation is enhancement, not requirement

3. **Long audio chunking**
   - What we know: Reverb may have VRAM limits for long audio
   - What's unclear: Does current backend handle 60+ second audio reliably?
   - Recommendation: Test with real data; Phase 20 documented 60-90s chunking if needed

## Sources

### Primary (HIGH confidence)
- `services/reverb/server.py` - Actual Reverb API implementation (Phase 20)
- `js/sequence-aligner.js` - Needleman-Wunsch implementation (Phase 21)
- `js/disfluency-tagger.js` - Disfluency classification (Phase 21)
- `js/deepgram-api.js` - Cross-validation client (Phase 22)
- `js/ensemble-merger.js` - Google ensemble reference (v1.0)
- `FuturePlans/0 Kitchen-Sink-Ensemble-Implementation-Plan.md` - Architecture design

### Secondary (MEDIUM confidence)
- `.planning/phases/21-sequence-alignment-disfluency/21-RESEARCH.md` - Alignment research
- `.planning/phases/22-cross-vendor-validation/22-VERIFICATION.md` - Cross-validation verification

### Tertiary (LOW confidence)
- None - all patterns come from existing codebase and verified research

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All components exist and are tested
- Architecture: HIGH - Clear pipeline defined in prior research and FuturePlans
- Pitfalls: HIGH - Based on actual code analysis and known format differences
- Integration: HIGH - Follows existing patterns in ensemble-merger.js

**Research date:** 2026-02-05
**Valid until:** 2026-03-05 (30 days - stable architecture, unlikely to change)
