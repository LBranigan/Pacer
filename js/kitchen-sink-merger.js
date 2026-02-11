/**
 * Kitchen Sink Ensemble Merger
 *
 * Runs Reverb (dual-pass: verbatim v=1.0 + clean v=0.0) and Parakeet in parallel.
 * Returns raw V1 (verbatim) words as the primary transcript.
 *
 * Three-way alignment (V1, V0, Parakeet) against reference text happens
 * downstream in app.js — this module only handles STT invocation and fallback.
 *
 * Pipeline:
 * 1. Reverb /ensemble (v=1.0 + v=0.0)
 * 2. Cross-validator (Parakeet/Deepgram)
 * 3. Return raw V1 words + raw V0 words + raw Parakeet words for downstream alignment
 *
 * Fallback chain:
 * - Reverb offline → cross-validator-only (no disfluency detection)
 * - Cross-validator fails → Error (empty words array)
 */

import { isReverbAvailable, sendToReverbEnsemble } from './reverb-api.js';
import { sendToCrossValidator, getCrossValidatorEngine } from './cross-validator.js';

// Feature flag stored in localStorage for A/B comparison
const FEATURE_FLAG_KEY = 'orf_use_kitchen_sink';

/**
 * Check if Kitchen Sink pipeline is enabled.
 * Defaults to true (enabled) when localStorage is empty.
 *
 * @returns {boolean} True if Kitchen Sink should be used, false for Deepgram-only
 */
export function isKitchenSinkEnabled() {
  // Enabled by default unless explicitly set to 'false'
  return localStorage.getItem(FEATURE_FLAG_KEY) !== 'false';
}

/**
 * Set Kitchen Sink feature flag.
 *
 * @param {boolean} enabled - True to enable Kitchen Sink, false to use Deepgram-only
 */
export function setKitchenSinkEnabled(enabled) {
  localStorage.setItem(FEATURE_FLAG_KEY, enabled ? 'true' : 'false');
}

/**
 * Run cross-validator-only fallback.
 *
 * Used when:
 * - Reverb service unavailable
 * - Reverb transcription fails
 *
 * Provides transcription without disfluency detection (no verbatim/clean diff available).
 * Still cloud-based but no Google dependency.
 *
 * @param {Blob} blob - Audio blob
 * @returns {Promise<object>} Result object with words array
 */
async function runXvalFallback(blob) {
  console.log('[kitchen-sink] Running cross-validator-only fallback (no disfluency detection)');

  const xvalResult = await sendToCrossValidator(blob);

  // Handle complete failure
  if (!xvalResult || !xvalResult.words || xvalResult.words.length === 0) {
    console.error('[kitchen-sink] Cross-validator fallback failed');
    return {
      words: [],
      source: 'xval_fallback',
      error: 'Cross-validator transcription failed',
      _debug: {
        reverbAvailable: false,
        xvalAvailable: false,
        fallbackReason: 'Both Reverb and cross-validator failed'
      }
    };
  }

  // Add placeholder properties for consistency with Kitchen Sink output
  // No disfluency detection without Reverb's verbatim/clean diff
  const wordsWithDefaults = xvalResult.words.map(w => ({
    ...w,
    crossValidation: 'confirmed', // Cross-validator is the only source, so "confirmed" by itself
    source: getCrossValidatorEngine()
  }));

  return {
    words: wordsWithDefaults,
    source: 'xval_fallback',
    xvalRaw: xvalResult,
    transcript: xvalResult.transcript,
    _debug: {
      reverbAvailable: false,
      xvalAvailable: true,
      fallbackReason: 'Reverb service unavailable, using cross-validator only',
      wordCount: wordsWithDefaults.length
    }
  };
}

/**
 * Run Kitchen Sink ensemble pipeline.
 *
 * Returns raw V1 (verbatim) words as the primary transcript. Disfluency
 * classification and 3-way alignment happen downstream in app.js.
 *
 * @param {Blob} blob - Audio blob
 * @param {string} encoding - Audio encoding (unused, kept for API compatibility)
 * @param {number} sampleRateHertz - Sample rate (unused, kept for API compatibility)
 * @returns {Promise<object>} Pipeline result with:
 *   - words: Array of raw V1 words with crossValidation='pending'
 *   - source: 'kitchen_sink' or 'xval_fallback'
 *   - reverb: Raw Reverb response (verbatim + clean)
 *   - xvalRaw: Raw cross-validator response (may be null)
 *   - _debug: Debug metadata
 */
export async function runKitchenSinkPipeline(blob, encoding, sampleRateHertz) {
  // Step 0: Check feature flag
  if (!isKitchenSinkEnabled()) {
    console.log('[kitchen-sink] Feature flag disabled, using cross-validator only');
    return await runXvalFallback(blob);
  }

  // Step 1: Check Reverb availability (3s timeout)
  const reverbUp = await isReverbAvailable();

  if (!reverbUp) {
    console.log('[kitchen-sink] Reverb offline, falling back to cross-validator only');
    return await runXvalFallback(blob);
  }

  // Step 2: Run Reverb + Parakeet in parallel
  // Use Promise.allSettled so one failure doesn't block the other
  const [reverbResult, xvalResult] = await Promise.allSettled([
    sendToReverbEnsemble(blob),
    sendToCrossValidator(blob)
  ]);

  const reverb = reverbResult.status === 'fulfilled' ? reverbResult.value : null;
  const xvalRaw = xvalResult.status === 'fulfilled' ? xvalResult.value : null;

  // Step 3: If Reverb failed, fall back to Parakeet only
  if (!reverb) {
    console.log('[kitchen-sink] Reverb transcription failed, falling back to cross-validator only');
    return await runXvalFallback(blob);
  }

  // Step 4: Return raw V1 (verbatim) words directly.
  // No V0/V1 divergence alignment here — 3-way comparison against reference
  // happens in app.js where all three engines are independently NW-aligned.
  const validatedWords = reverb.verbatim.words.map(w => ({
    ...w,
    crossValidation: 'pending',
    _reverbStartTime: w.startTime,
    _reverbEndTime: w.endTime
  }));

  console.log('[kitchen-sink] Pipeline complete:', {
    verbatimWords: reverb.verbatim.words.length,
    cleanWords: reverb.clean.words.length,
    crossValidated: !!xvalRaw
  });

  return {
    words: validatedWords,
    source: 'kitchen_sink',
    reverb: reverb,
    xvalRaw: xvalRaw,
    _debug: {
      reverbAvailable: true,
      xvalAvailable: !!xvalRaw,
      verbatimWordCount: reverb.verbatim.words.length,
      cleanWordCount: reverb.clean.words.length
    }
  };
}

/**
 * Compute statistics for Kitchen Sink result.
 *
 * @param {object} result - Result from runKitchenSinkPipeline
 * @returns {object} Statistics object
 */
export function computeKitchenSinkStats(result) {
  if (!result || !result.words) {
    return {
      totalWords: 0,
      confirmed: 0,
      disagreed: 0,
      unconfirmed: 0,
      unavailable: 0,
      source: result?.source || 'unknown'
    };
  }

  const words = result.words;

  return {
    totalWords: words.length,
    confirmed: words.filter(w => w.crossValidation === 'confirmed').length,
    disagreed: words.filter(w => w.crossValidation === 'disagreed').length,
    unconfirmed: words.filter(w => w.crossValidation === 'unconfirmed').length,
    unavailable: words.filter(w => w.crossValidation === 'unavailable').length,
    source: result.source
  };
}
