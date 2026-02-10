/**
 * Cross-Validator Orchestrator
 *
 * Engine-agnostic cross-validation of Reverb transcript against a second ASR engine
 * using Needleman-Wunsch sequence alignment.
 *
 * Currently supported engines: Deepgram Nova-3, Parakeet TDT 0.6B v3
 * Engine selection via localStorage key 'orf_cross_validator' (default: 'parakeet').
 *
 * Cross-validation statuses:
 *   confirmed  — both engines produced the same word (text match, fuzzy match, or near-match)
 *   disagreed  — both engines heard something, but different words (mismatch, edit distance > 1)
 *   unconfirmed — only Reverb produced a word; cross-validator had nothing at this position
 *   unavailable — cross-validator service was offline
 *
 * Near-match resolution (edit distance ≤ 1):
 *   Long words (≥ 5 chars): A single-character difference is phonetic parsing noise or BPE
 *   spelling variation (e.g., "jumped"/"jumpt"). Confirmed; cross-validator word used.
 *   Short words (2-4 chars): A single character IS the phonemic difference — "cat"/"bat" is
 *   a real consonant substitution, "went"/"want" a real vowel error. Marked as disagreed
 *   so downstream scoring counts these as potential errors. Reverb's word kept.
 *
 * Requirements covered:
 * - XVAL-01: Cross-validator called for cross-validation
 * - XVAL-02: Reverb <-> cross-validator disagreement flags words via 'disagreed' status
 * - XVAL-03: Graceful fallback when service unavailable
 */

import { isDeepgramAvailable, sendToDeepgram } from './deepgram-api.js';
import { isParakeetAvailable, sendToParakeet } from './parakeet-api.js';
import { alignSequences } from './sequence-aligner.js';
import { levenshteinRatio } from './nl-api.js';

const ENGINE_KEY = 'orf_cross_validator';

/**
 * Get the currently selected cross-validator engine.
 * @returns {string} Engine name (e.g., 'deepgram')
 */
export function getCrossValidatorEngine() {
  return localStorage.getItem(ENGINE_KEY) || 'parakeet';
}

/**
 * Set the cross-validator engine.
 * @param {string} engine - Engine name (e.g., 'deepgram')
 */
export function setCrossValidatorEngine(engine) {
  localStorage.setItem(ENGINE_KEY, engine);
}

/**
 * Get a display-friendly name for the current cross-validator engine.
 * @returns {string} Capitalized engine name (e.g., "Deepgram")
 */
export function getCrossValidatorName() {
  const engine = getCrossValidatorEngine();
  return engine.charAt(0).toUpperCase() + engine.slice(1);
}

/**
 * Check if the current cross-validator engine is available and configured.
 * @returns {Promise<boolean>} True if the engine is available
 */
export async function isCrossValidatorAvailable() {
  switch (getCrossValidatorEngine()) {
    case 'deepgram':
      return isDeepgramAvailable();
    case 'parakeet':
      return isParakeetAvailable();
    default:
      console.warn(`[cross-validator] Unknown engine: ${getCrossValidatorEngine()}`);
      return false;
  }
}

/**
 * Send audio to the current cross-validator engine.
 * @param {Blob} blob - Audio blob (WAV, WebM, etc.)
 * @returns {Promise<object|null>} Response with words array, or null if unavailable
 */
export async function sendToCrossValidator(blob) {
  switch (getCrossValidatorEngine()) {
    case 'deepgram':
      return sendToDeepgram(blob);
    case 'parakeet':
      return sendToParakeet(blob);
    default:
      console.warn(`[cross-validator] Unknown engine: ${getCrossValidatorEngine()}`);
      return null;
  }
}

/** Normalize a word for comparison (lowercase, strip punctuation). */
function _normalizeWord(word) {
  if (!word) return '';
  return word.toLowerCase().replace(/[^a-z'-]/g, '');
}

// NW scoring tuned for cross-validation: symmetric gaps, cheap mismatches
// so the aligner pairs words positionally even when text differs
const XVAL_OPTIONS = {
  match: 2,        // Same word in both engines
  mismatch: 0,     // Different word at same position (e.g. "jued"/"jumped")
  gapInsert: -1,   // Reverb word with no cross-validator counterpart
  gapDelete: -1    // Cross-validator word with no Reverb counterpart
};

/**
 * Cross-validate Reverb transcript against a second ASR engine
 * using Needleman-Wunsch sequence alignment.
 *
 * Alignment pairs words by position in both sequences, then classifies:
 *   match    → 'confirmed'   (both heard the same word)
 *   mismatch → 'disagreed'   (both heard something, text differs)
 *   insertion→ 'unconfirmed' (Reverb-only, cross-validator had nothing here)
 *   deletion → unconsumed    (cross-validator-only, logged but not added to word list)
 *
 * For confirmed and disagreed words, cross-validator timestamps replace Reverb's
 * (Reverb CTM hardcodes 100ms durations).
 *
 * @param {Array} reverbWords - Merged words from Reverb ensemble (after NW + disfluency tagging)
 * @param {Array|null} xvalWords - Words from cross-validator (e.g. Deepgram Nova-3), or null if unavailable
 * @returns {Array} Reverb words annotated with crossValidation status and cross-validator data
 */
export function crossValidateTranscripts(reverbWords, xvalWords) {
  // If cross-validator unavailable, mark all as unavailable (graceful degradation)
  if (!xvalWords || xvalWords.length === 0) {
    return {
      words: reverbWords.map(word => ({
        ...word,
        crossValidation: 'unavailable'
      })),
      unconsumedXval: []
    };
  }

  // Run NW sequence alignment: Reverb (A) vs cross-validator (B)
  const alignment = alignSequences(reverbWords, xvalWords, XVAL_OPTIONS);

  const result = [];
  const timestampComparison = [];
  const unconsumedXv = [];

  for (const entry of alignment) {
    if (entry.type === 'deletion') {
      // Cross-validator word with no Reverb counterpart — log but don't add to word list
      unconsumedXv.push(entry.wordBData);
      continue;
    }

    const reverbWord = entry.wordAData;

    if (entry.type === 'insertion') {
      // Reverb-only word — cross-validator had nothing at this position (true null)
      result.push({
        ...reverbWord,
        crossValidation: 'unconfirmed',
        _reverbStartTime: reverbWord.startTime,
        _reverbEndTime: reverbWord.endTime,
        _xvalStartTime: null,
        _xvalEndTime: null,
        _xvalWord: null
      });
      continue;
    }

    // match or mismatch — cross-validator has a paired word
    const xvWord = entry.wordBData;
    let status;
    let fuzzyMatch = null;
    let nearMatch = null;
    if (entry.type === 'match') {
      status = 'confirmed';
    } else {
      // Mismatch: both engines heard something, but text differs.
      // Three tiers of similarity determine how we handle it:
      const normA = _normalizeWord(reverbWord.word);
      const normB = _normalizeWord(xvWord.word);
      const similarity = levenshteinRatio(normA, normB);

      if (similarity >= 0.8) {
        // Tier 1 — High similarity (e.g., "shelly"/"shelley"): spelling variant.
        // Mark confirmed. For single-char differences on long words (e.g.,
        // "format"/"formats"), prefer cross-validator's word text — the extra
        // character is likely a real inflection the student spoke.
        status = 'confirmed';
        const maxLen = Math.max(normA.length, normB.length);
        const editDist = maxLen > 0 ? Math.round((1 - similarity) * maxLen) : 0;
        if (editDist <= 1 && maxLen >= 5) {
          nearMatch = {
            reverbWord: reverbWord.word,
            xvalWord: xvWord.word,
            editDistance: editDist,
            similarity: Math.round(similarity * 1000) / 1000
          };
        } else {
          fuzzyMatch = { reverbWord: reverbWord.word, xvalWord: xvWord.word, similarity: Math.round(similarity * 1000) / 1000 };
        }
      } else {
        // Check edit distance for near-match detection.
        // Derive from similarity: dist = (1 - ratio) * maxLen
        const maxLen = Math.max(normA.length, normB.length);
        const editDist = maxLen > 0 ? Math.round((1 - similarity) * maxLen) : 0;

        if (editDist <= 1 && maxLen >= 5) {
          // Tier 2a — Long near-match (edit distance ≤ 1, length ≥ 5).
          // e.g., "jumped"/"jumpt", "house"/"houses". A single-character difference
          // on a longer word is phonetic parsing noise or BPE spelling variation,
          // not a meaningful disagreement. Confirm and use cross-validator's word.
          status = 'confirmed';
          nearMatch = {
            reverbWord: reverbWord.word,
            xvalWord: xvWord.word,
            editDistance: editDist,
            similarity: Math.round(similarity * 1000) / 1000
          };
        } else if (editDist <= 1 && maxLen >= 2) {
          // Tier 2b — Short near-match (edit distance ≤ 1, length 2-4).
          // e.g., "cat"/"bat", "went"/"want". For short words, a single character
          // IS the phonemic difference — a real consonant or vowel substitution.
          // Mark as disagreed so downstream scoring counts these as potential errors.
          status = 'disagreed';
          nearMatch = {
            reverbWord: reverbWord.word,
            xvalWord: xvWord.word,
            editDistance: editDist,
            similarity: Math.round(similarity * 1000) / 1000
          };
        } else {
          // Tier 3 — True disagreement (edit distance > 1).
          // Engines heard genuinely different words.
          status = 'disagreed';
        }
      }
    }

    // Collect timestamp comparison for diagnostic logging
    timestampComparison.push({
      word: reverbWord.word,
      xvWord: xvWord.word,
      status,
      ...(nearMatch ? { nearMatch: true, editDist: nearMatch.editDistance } : {}),
      reverbStart: reverbWord.startTime,
      reverbEnd: reverbWord.endTime,
      xvalStart: xvWord.startTime,
      xvalEnd: xvWord.endTime,
      reverbDurMs: Math.round((_parseTs(reverbWord.endTime) - _parseTs(reverbWord.startTime)) * 1000),
      xvalDurMs: Math.round((_parseTs(xvWord.endTime) - _parseTs(xvWord.startTime)) * 1000),
    });

    // For confirmed near-matches (Tier 1 inflections + Tier 2a long words), use
    // cross-validator's word text. For disagreed near-matches (Tier 2b, short
    // words), keep Reverb's word — the single-character difference may be a real
    // phonemic error.
    const wordOverride = (nearMatch && status === 'confirmed') ? { word: _normalizeWord(xvWord.word) } : {};

    result.push({
      ...reverbWord,
      ...wordOverride,
      crossValidation: status,
      // Cross-validator timestamps as primary timekeeper
      startTime: xvWord.startTime,
      endTime: xvWord.endTime,
      // All three timestamp sources preserved for display
      _reverbStartTime: reverbWord.startTime,
      _reverbEndTime: reverbWord.endTime,
      _xvalStartTime: xvWord.startTime,
      _xvalEndTime: xvWord.endTime,
      // _reverbCleanStartTime/_reverbCleanEndTime carried through via ...reverbWord
      ...(fuzzyMatch ? { _fuzzyMatch: fuzzyMatch } : {}),
      ...(nearMatch ? { _nearMatch: nearMatch } : {}),
      _xvalWord: xvWord.word,
      _xvalEngine: getCrossValidatorEngine()
    });
  }

  // Diagnostic logging
  if (timestampComparison.length > 0) {
    console.log('[cross-validation] Reverb vs cross-validator alignment (NW sequence):');
    console.table(timestampComparison);

    const gapComparison = [];
    for (let i = 1; i < timestampComparison.length; i++) {
      const prev = timestampComparison[i - 1];
      const curr = timestampComparison[i];
      const reverbGap = Math.round((_parseTs(curr.reverbStart) - _parseTs(prev.reverbEnd)) * 1000);
      const xvalGap = Math.round((_parseTs(curr.xvalStart) - _parseTs(prev.xvalEnd)) * 1000);
      gapComparison.push({
        between: `"${prev.word}" → "${curr.word}"`,
        reverbGapMs: reverbGap,
        xvalGapMs: xvalGap,
        diffMs: reverbGap - xvalGap
      });
    }
    console.log('[cross-validation] Inter-word gap comparison:');
    console.table(gapComparison);
  }

  if (unconsumedXv.length > 0) {
    console.log('[cross-validation] Unconsumed cross-validator words (heard by xval but not Reverb):');
    console.table(unconsumedXv.map(w => ({ word: w.word, start: w.startTime, end: w.endTime })));
  }

  return { words: result, unconsumedXval: unconsumedXv };
}

/** Parse timestamp string "1.234s" to float seconds. */
function _parseTs(t) {
  return parseFloat(String(t).replace('s', '')) || 0;
}
