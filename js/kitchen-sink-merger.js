/**
 * Kitchen Sink Ensemble Merger
 *
 * Combines Reverb + Deepgram results into unified pipeline for:
 * - Model-level disfluency detection (fillers, repetitions, false starts)
 * - Cross-vendor hallucination flagging
 *
 * Requirements covered:
 * - INTG-05: kitchen-sink-merger.js combines Reverb + Deepgram results
 * - INTG-06: Replaces Google STT ensemble with Kitchen Sink
 *
 * Pipeline:
 * 1. Reverb /ensemble (v=1.0 + v=0.0)
 * 2. Needleman-Wunsch alignment (sequence-aligner.js)
 * 3. Disfluency tagging (disfluency-tagger.js)
 * 4. Deepgram cross-validation (deepgram-api.js)
 * 5. Fallback to Deepgram-only if Reverb unavailable (no disfluency detection)
 *
 * No Google dependency - fully replaced.
 */

import { isReverbAvailable, sendToReverbEnsemble } from './reverb-api.js';
import { alignTranscripts } from './sequence-aligner.js';
import { tagDisfluencies, computeDisfluencyStats } from './disfluency-tagger.js';
import { sendToDeepgram, crossValidateWithDeepgram } from './deepgram-api.js';

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
 * Build merged words from alignment result.
 *
 * Maps alignment entries back to verbatim words with disfluency flags.
 * Skips deletions (clean-only words) since they're not in verbatim output.
 *
 * @param {Array} verbatimWords - Words from Reverb v=1.0 transcript
 * @param {Array} taggedAlignment - Alignment with disfluencyType tags
 * @returns {Array} Merged words with isDisfluency and disfluencyType
 */
function buildMergedWordsFromAlignment(verbatimWords, taggedAlignment) {
  let vIdx = 0;
  const merged = [];

  for (const entry of taggedAlignment) {
    // Skip deletions - these are clean-only words not present in verbatim
    if (entry.type === 'deletion') {
      continue;
    }

    // Get the corresponding verbatim word
    const verbatimWord = verbatimWords[vIdx++];

    merged.push({
      ...verbatimWord,
      // Mark as disfluency if this is an insertion (verbatim-only)
      isDisfluency: entry.type === 'insertion',
      // Classification from disfluency-tagger.js (filler, repetition, false_start, unknown)
      disfluencyType: entry.disfluencyType || null,
      // Debug: preserve alignment info for inspection
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
 * Run Deepgram-only fallback.
 *
 * Used when:
 * - Reverb service unavailable
 * - Reverb transcription fails
 *
 * Provides transcription without disfluency detection (no verbatim/clean diff available).
 * Still cloud-based (Deepgram API) but no Google dependency.
 *
 * @param {Blob} blob - Audio blob
 * @returns {Promise<object>} Result object with words array
 */
async function runDeepgramFallback(blob) {
  console.log('[kitchen-sink] Running Deepgram-only fallback (no disfluency detection)');

  const deepgramResult = await sendToDeepgram(blob);

  // Handle complete failure
  if (!deepgramResult || !deepgramResult.words || deepgramResult.words.length === 0) {
    console.error('[kitchen-sink] Deepgram fallback failed');
    return {
      words: [],
      source: 'deepgram_fallback',
      error: 'Deepgram transcription failed',
      _debug: {
        reverbAvailable: false,
        deepgramAvailable: false,
        fallbackReason: 'Both Reverb and Deepgram failed'
      }
    };
  }

  // Add placeholder properties for consistency with Kitchen Sink output
  // No disfluency detection without Reverb's verbatim/clean diff
  const wordsWithDefaults = deepgramResult.words.map(w => ({
    ...w,
    isDisfluency: false,
    disfluencyType: null,
    crossValidation: 'confirmed', // Deepgram is the only source, so "confirmed" by itself
    source: 'deepgram'
  }));

  return {
    words: wordsWithDefaults,
    source: 'deepgram_fallback',
    deepgram: deepgramResult,
    transcript: deepgramResult.transcript,
    _debug: {
      reverbAvailable: false,
      deepgramAvailable: true,
      fallbackReason: 'Reverb service unavailable, using Deepgram only',
      wordCount: wordsWithDefaults.length
    }
  };
}

/**
 * Run Kitchen Sink ensemble pipeline.
 *
 * Full pipeline:
 * 1. Check feature flag - if disabled, use Deepgram-only fallback
 * 2. Check Reverb availability
 * 3. Run Reverb + Deepgram in parallel
 * 4. Align verbatim vs clean to find disfluencies
 * 5. Tag disfluencies (filler, repetition, false_start, unknown)
 * 6. Build merged words from alignment
 * 7. Cross-validate against Deepgram
 * 8. Return result with all metadata
 *
 * Fallback chain (no Google dependency):
 * - Reverb offline → Deepgram-only (no disfluency detection)
 * - Deepgram fails → Error (empty words array)
 *
 * @param {Blob} blob - Audio blob
 * @param {string} encoding - Audio encoding (unused, kept for API compatibility)
 * @param {number} sampleRateHertz - Sample rate (unused, kept for API compatibility)
 * @returns {Promise<object>} Pipeline result with:
 *   - words: Array of words with isDisfluency, disfluencyType, crossValidation
 *   - source: 'kitchen_sink' or 'deepgram_fallback'
 *   - reverb: Raw Reverb response (if used)
 *   - deepgram: Raw Deepgram response (may be null)
 *   - disfluencyStats: Statistics from disfluency-tagger
 *   - alignment: Tagged alignment result
 *   - _debug: Debug metadata
 */
export async function runKitchenSinkPipeline(blob, encoding, sampleRateHertz) {
  // Step 0: Check feature flag
  if (!isKitchenSinkEnabled()) {
    console.log('[kitchen-sink] Feature flag disabled, using Deepgram only');
    return await runDeepgramFallback(blob);
  }

  // Step 1: Check Reverb availability (3s timeout)
  const reverbUp = await isReverbAvailable();

  if (!reverbUp) {
    console.log('[kitchen-sink] Reverb offline, falling back to Deepgram only');
    return await runDeepgramFallback(blob);
  }

  // Step 2: Run Reverb + Deepgram in parallel
  // Use Promise.allSettled so one failure doesn't block the other
  const [reverbResult, deepgramResult] = await Promise.allSettled([
    sendToReverbEnsemble(blob),
    sendToDeepgram(blob)
  ]);

  const reverb = reverbResult.status === 'fulfilled' ? reverbResult.value : null;
  const deepgram = deepgramResult.status === 'fulfilled' ? deepgramResult.value : null;

  // Step 3: If Reverb failed, fall back to Deepgram only
  if (!reverb) {
    console.log('[kitchen-sink] Reverb transcription failed, falling back to Deepgram only');
    return await runDeepgramFallback(blob);
  }

  // Step 4: Align verbatim vs clean to detect disfluencies
  // Verbatim has fillers/repetitions; clean does not
  // Insertions in alignment = disfluencies
  const alignment = alignTranscripts(reverb.verbatim.words, reverb.clean.words);

  // Step 5: Tag disfluencies by type
  const taggedAlignment = tagDisfluencies(alignment);

  // Step 6: Compute disfluency statistics
  const disfluencyStats = computeDisfluencyStats(taggedAlignment);

  // Step 7: Build merged word array from tagged alignment
  // Each verbatim word gets isDisfluency and disfluencyType from alignment
  const mergedWords = buildMergedWordsFromAlignment(
    reverb.verbatim.words,
    taggedAlignment
  );

  // Step 8: Apply cross-validation against Deepgram
  // Words in both sources are 'confirmed', Reverb-only are 'unconfirmed'
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
 *
 * @param {object} result - Result from runKitchenSinkPipeline
 * @returns {object} Statistics object with:
 *   - totalWords: Total word count
 *   - disfluencies: Disfluency count
 *   - disfluencyRate: Percentage string
 *   - confirmed: Words confirmed by Deepgram
 *   - unconfirmed: Words not in Deepgram (potential hallucinations)
 *   - unavailable: Words where Deepgram was unavailable
 *   - source: 'kitchen_sink' or 'google_fallback'
 */
export function computeKitchenSinkStats(result) {
  if (!result || !result.words) {
    return {
      totalWords: 0,
      disfluencies: 0,
      disfluencyRate: '0%',
      confirmed: 0,
      unconfirmed: 0,
      unavailable: 0,
      source: result?.source || 'unknown'
    };
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
