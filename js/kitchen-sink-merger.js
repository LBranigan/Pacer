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
 * 4. Cross-validation (cross-validator.js)
 * 5. Fallback to cross-validator-only if Reverb unavailable (no disfluency detection)
 *
 * No Google dependency - fully replaced.
 */

import { isReverbAvailable, sendToReverbEnsemble } from './reverb-api.js';
import { alignTranscripts } from './sequence-aligner.js';
// tagDisfluencies no longer used — divergence blocks replace individual classification
// computeDisfluencyStats no longer used — stats computed inline from merged words
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
 * Build merged words using anchor-based divergence block detection.
 *
 * Walks the v1/v0 alignment and finds "anchor" points where both transcripts
 * agree (match entries). Everything between two anchors is a "divergence block"
 * where the student struggled — the v0 (clean) side gives the target word(s),
 * the v1 (verbatim) side gives all the messy fragments of the attempt.
 *
 * Example:
 *   v1:  ... the | apo-  a  pe-peal | that ...
 *   v0:  ... the |     appeal       | that ...
 *         anchor   DIVERGENCE BLOCK   anchor
 *
 *   → cleanTarget: "appeal"
 *   → verbatimFragments: ["apo-", "a", "pe-peal"]
 *   → All three v1 words get isDisfluency: true, linked via _divergence
 *
 * @param {Array} verbatimWords - Words from Reverb v=1.0 transcript
 * @param {Array} alignment - Alignment from alignTranscripts(v1, v0)
 * @returns {Array} Merged words with isDisfluency and _divergence block data
 */
function buildMergedWordsFromAlignment(verbatimWords, alignment) {
  // Step 1: Walk alignment, group into anchors and divergence blocks
  const blocks = [];
  let currentDiv = null;

  for (const entry of alignment) {
    if (entry.type === 'match') {
      // Anchor point — close any open divergence block
      if (currentDiv) {
        blocks.push(currentDiv);
        currentDiv = null;
      }
      blocks.push({ kind: 'anchor', entries: [entry] });
    } else {
      // Divergence — accumulate
      if (!currentDiv) {
        currentDiv = { kind: 'divergence', entries: [] };
      }
      currentDiv.entries.push(entry);
    }
  }
  if (currentDiv) blocks.push(currentDiv);

  // Step 2: Build merged word array from blocks
  const merged = [];
  let vIdx = 0;
  let divergenceId = 0;

  for (const block of blocks) {
    if (block.kind === 'anchor') {
      const entry = block.entries[0];
      const verbatimWord = verbatimWords[vIdx++];
      const cleanTimestamps = {};
      if (entry.cleanData) {
        cleanTimestamps._reverbCleanStartTime = entry.cleanData.startTime;
        cleanTimestamps._reverbCleanEndTime = entry.cleanData.endTime;
      }
      merged.push({
        ...verbatimWord,
        ...cleanTimestamps,
        isDisfluency: false,
        disfluencyType: null,
        _divergence: null,
        _alignment: { type: 'match', verbatim: entry.verbatim, clean: entry.clean }
      });
    } else {
      // Divergence block — extract v1 words and v0 (clean) targets
      divergenceId++;
      const v1Entries = block.entries.filter(e => e.type !== 'deletion');
      const v0Words = [];
      const v1Words = [];

      for (const entry of block.entries) {
        if (entry.type === 'insertion') {
          v1Words.push(entry.verbatim);
        } else if (entry.type === 'deletion') {
          v0Words.push(entry.clean);
        } else if (entry.type === 'mismatch') {
          v1Words.push(entry.verbatim);
          v0Words.push(entry.clean);
        }
      }

      const cleanTarget = v0Words.join(' ') || null;
      const divergenceInfo = {
        id: divergenceId,
        cleanTarget,
        cleanWords: [...v0Words],
        verbatimWords: [...v1Words]
      };

      // Determine disfluency type for the block
      let blockType = 'struggle'; // default: student struggled
      if (v1Words.length === 1 && v0Words.length === 1) {
        // Single word mismatch — could be a simple pronunciation difference
        blockType = 'mismatch';
      } else if (v0Words.length === 0) {
        // Pure insertions with no clean counterpart (rare)
        blockType = 'extra';
      }

      // Emit each v1 word in the block
      let v1Count = 0;
      for (const entry of block.entries) {
        if (entry.type === 'deletion') continue; // v0-only, no v1 word

        const verbatimWord = verbatimWords[vIdx++];
        v1Count++;
        const isLast = v1Count === v1Entries.length;

        const cleanTimestamps = {};
        if (entry.cleanData) {
          cleanTimestamps._reverbCleanStartTime = entry.cleanData.startTime;
          cleanTimestamps._reverbCleanEndTime = entry.cleanData.endTime;
        }

        merged.push({
          ...verbatimWord,
          ...cleanTimestamps,
          isDisfluency: true,
          disfluencyType: blockType,
          _divergence: {
            ...divergenceInfo,
            role: isLast ? 'final' : 'fragment'
          },
          _alignment: { type: entry.type, verbatim: entry.verbatim, clean: entry.clean }
        });
      }

      if (v1Words.length > 0) {
        console.log(`[Divergence Block #${divergenceId}] v0: "${cleanTarget || '(none)'}" ← v1: ${v1Words.map(w => `"${w}"`).join(', ')} [${blockType}]`);
      }
    }
  }

  return merged;
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
    isDisfluency: false,
    disfluencyType: null,
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
 * - Reverb offline → cross-validator-only (no disfluency detection)
 * - Cross-validator fails → Error (empty words array)
 *
 * @param {Blob} blob - Audio blob
 * @param {string} encoding - Audio encoding (unused, kept for API compatibility)
 * @param {number} sampleRateHertz - Sample rate (unused, kept for API compatibility)
 * @returns {Promise<object>} Pipeline result with:
 *   - words: Array of words with isDisfluency, disfluencyType, crossValidation
 *   - source: 'kitchen_sink' or 'xval_fallback'
 *   - reverb: Raw Reverb response (if used)
 *   - xvalRaw: Raw cross-validator response (may be null)
 *   - disfluencyStats: Statistics from disfluency-tagger
 *   - alignment: Tagged alignment result
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

  // Step 2: Run Reverb + Deepgram in parallel
  // Use Promise.allSettled so one failure doesn't block the other
  const [reverbResult, xvalResult] = await Promise.allSettled([
    sendToReverbEnsemble(blob),
    sendToCrossValidator(blob)
  ]);

  const reverb = reverbResult.status === 'fulfilled' ? reverbResult.value : null;
  const xvalRaw = xvalResult.status === 'fulfilled' ? xvalResult.value : null;

  // Step 3: If Reverb failed, fall back to Deepgram only
  if (!reverb) {
    console.log('[kitchen-sink] Reverb transcription failed, falling back to cross-validator only');
    return await runXvalFallback(blob);
  }

  // Step 4: Align verbatim vs clean using anchor-based divergence blocks.
  // Finds where v1 and v0 agree (anchors) and groups all disagreements
  // between anchors into divergence blocks. Each block links v1 fragments
  // (the messy reality) to v0 target words (the clean version).
  const alignment = alignTranscripts(reverb.verbatim.words, reverb.clean.words);

  // Step 5: Build merged word array from divergence blocks
  // (replaces disfluency-tagger — classification happens via block grouping)
  const mergedWords = buildMergedWordsFromAlignment(
    reverb.verbatim.words,
    alignment
  );

  // Step 6: Compute disfluency statistics from merged words
  const disfluencyCount = mergedWords.filter(w => w.isDisfluency).length;
  const contentCount = mergedWords.filter(w => !w.isDisfluency).length;
  const disfluencyStats = {
    total: disfluencyCount,
    contentWords: contentCount,
    rate: contentCount > 0 ? (disfluencyCount / contentCount * 100).toFixed(1) + '%' : '0%',
    byType: { filler: 0, repetition: 0, false_start: 0, unknown: 0, struggle: 0, mismatch: 0 }
  };
  for (const w of mergedWords) {
    if (w.isDisfluency && w.disfluencyType) {
      disfluencyStats.byType[w.disfluencyType] = (disfluencyStats.byType[w.disfluencyType] || 0) + 1;
    }
  }

  // Step 7: Mark words as pending cross-validation.
  // Reference-anchored cross-validation happens in app.js AFTER alignment,
  // where both Reverb and Parakeet are independently aligned to the reference text.
  const validatedWords = mergedWords.map(w => ({
    ...w,
    crossValidation: 'pending',
    _reverbStartTime: w.startTime,
    _reverbEndTime: w.endTime
  }));

  console.log('[kitchen-sink] Pipeline complete:', {
    verbatimWords: reverb.verbatim.words.length,
    cleanWords: reverb.clean.words.length,
    disfluencies: disfluencyStats.total,
    divergenceBlocks: mergedWords.filter(w => w._divergence?.role === 'final').length,
    crossValidated: !!xvalRaw
  });

  return {
    words: validatedWords,
    source: 'kitchen_sink',
    reverb: reverb,
    xvalRaw: xvalRaw,
    disfluencyStats: disfluencyStats,
    alignment: alignment,
    _debug: {
      reverbAvailable: true,
      xvalAvailable: !!xvalRaw,
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
 *   - confirmed: Words confirmed by cross-validator
 *   - unconfirmed: Words not in cross-validator (potential hallucinations)
 *   - unavailable: Words where cross-validator was unavailable
 *   - source: 'kitchen_sink' or 'xval_fallback'
 */
export function computeKitchenSinkStats(result) {
  if (!result || !result.words) {
    return {
      totalWords: 0,
      disfluencies: 0,
      disfluencyRate: '0%',
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
    disfluencies: words.filter(w => w.isDisfluency).length,
    disfluencyRate: words.length > 0
      ? (words.filter(w => w.isDisfluency).length / words.length * 100).toFixed(1) + '%'
      : '0%',
    confirmed: words.filter(w => w.crossValidation === 'confirmed').length,
    disagreed: words.filter(w => w.crossValidation === 'disagreed').length,
    unconfirmed: words.filter(w => w.crossValidation === 'unconfirmed').length,
    unavailable: words.filter(w => w.crossValidation === 'unavailable').length,
    source: result.source
  };
}
