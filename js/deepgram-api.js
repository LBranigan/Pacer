/**
 * Deepgram Nova-3 API Client
 *
 * Calls backend proxy at localhost:8765/deepgram (browser cannot call Deepgram directly - no CORS).
 * Provides cross-validation against Reverb ASR using Needleman-Wunsch sequence alignment.
 *
 * Cross-validation statuses:
 *   confirmed  — both engines produced the same word (text match)
 *   disagreed  — both engines heard something, but different words (mismatch)
 *   unconfirmed — only Reverb produced a word; Deepgram had nothing at this position
 *   unavailable — Deepgram service was offline
 *
 * Requirements covered:
 * - XVAL-01: Deepgram Nova-3 called for cross-validation
 * - XVAL-02: Reverb <-> Nova-3 disagreement flags words via 'disagreed' status
 * - XVAL-03: Graceful fallback when service unavailable
 * - INTG-02: deepgram-api.js client calls Deepgram Nova-3 API
 */

import { alignSequences } from './sequence-aligner.js';
import { levenshteinRatio } from './nl-api.js';

const BACKEND_BASE_URL = 'http://localhost:8765';

/**
 * Convert blob to base64 string.
 * @param {Blob} blob - Audio blob
 * @returns {Promise<string>} Base64 encoded audio (without data URL prefix)
 */
function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

/**
 * Check if Deepgram service is available and configured.
 * Uses /health endpoint to verify backend is running and has API key.
 *
 * @returns {Promise<boolean>} True if Deepgram is available
 */
export async function isDeepgramAvailable() {
  try {
    const resp = await fetch(`${BACKEND_BASE_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.deepgram_configured === true;
  } catch {
    return false;
  }
}

/**
 * Send audio to Deepgram Nova-3 via backend proxy.
 *
 * Returns null on failure for graceful degradation (XVAL-03).
 * Cross-validation is optional - if Deepgram unavailable, proceed with Reverb-only.
 *
 * @param {Blob} blob - Audio blob (WAV, WebM, etc.)
 * @returns {Promise<object|null>} Response with words array, or null if unavailable
 */
export async function sendToDeepgram(blob) {
  try {
    const base64 = await blobToBase64(blob);

    const resp = await fetch(`${BACKEND_BASE_URL}/deepgram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_base64: base64 }),
      signal: AbortSignal.timeout(30000) // 30s timeout for transcription
    });

    if (!resp.ok) {
      console.warn(`[deepgram-api] Backend returned ${resp.status}`);
      return null;
    }

    return await resp.json();
  } catch (e) {
    console.warn('[deepgram-api] Service unavailable:', e.message);
    return null; // Graceful fallback - cross-validation is optional
  }
}

/**
 * Extract words array from Deepgram response.
 * @param {object|null} deepgramResponse - Response from sendToDeepgram
 * @returns {Array} Words array or empty array if null
 */
export function extractWordsFromDeepgram(deepgramResponse) {
  if (!deepgramResponse || !deepgramResponse.words) return [];
  return deepgramResponse.words;
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
  gapInsert: -1,   // Reverb word with no Deepgram counterpart
  gapDelete: -1    // Deepgram word with no Reverb counterpart
};

/**
 * Cross-validate Reverb transcript against Deepgram Nova-3
 * using Needleman-Wunsch sequence alignment.
 *
 * Alignment pairs words by position in both sequences, then classifies:
 *   match    → 'confirmed'   (both heard the same word)
 *   mismatch → 'disagreed'   (both heard something, text differs)
 *   insertion→ 'unconfirmed' (Reverb-only, Deepgram had nothing here)
 *   deletion → unconsumed    (Deepgram-only, logged but not added to word list)
 *
 * For confirmed and disagreed words, Deepgram timestamps replace Reverb's
 * (Reverb CTM hardcodes 100ms durations). Both confidence values are preserved.
 *
 * @param {Array} reverbWords - Merged words from Reverb ensemble (after NW + disfluency tagging)
 * @param {Array|null} deepgramWords - Words from Deepgram Nova-3, or null if unavailable
 * @returns {Array} Reverb words annotated with crossValidation status and Deepgram data
 */
export function crossValidateWithDeepgram(reverbWords, deepgramWords) {
  // If Deepgram unavailable, mark all as unavailable (graceful degradation)
  if (!deepgramWords || deepgramWords.length === 0) {
    return {
      words: reverbWords.map(word => ({
        ...word,
        crossValidation: 'unavailable'
      })),
      unconsumedDeepgram: []
    };
  }

  // Run NW sequence alignment: Reverb (A) vs Deepgram (B)
  const alignment = alignSequences(reverbWords, deepgramWords, XVAL_OPTIONS);

  const result = [];
  const timestampComparison = [];
  const unconsumedDg = [];

  for (const entry of alignment) {
    if (entry.type === 'deletion') {
      // Deepgram word with no Reverb counterpart — log but don't add to word list
      unconsumedDg.push(entry.wordBData);
      continue;
    }

    const reverbWord = entry.wordAData;

    if (entry.type === 'insertion') {
      // Reverb-only word — Deepgram had nothing at this position (true null)
      result.push({
        ...reverbWord,
        crossValidation: 'unconfirmed',
        _reverbConfidence: reverbWord.confidence,
        _reverbStartTime: reverbWord.startTime,
        _reverbEndTime: reverbWord.endTime,
        _deepgramStartTime: null,
        _deepgramEndTime: null,
        _deepgramWord: null
      });
      continue;
    }

    // match or mismatch — Deepgram has a paired word
    const dgWord = entry.wordBData;
    let status;
    let fuzzyMatch = null;
    if (entry.type === 'match') {
      status = 'confirmed';
    } else {
      // Mismatch: check fuzzy similarity for spelling variants (e.g. "shelly" vs "shelley")
      const normA = _normalizeWord(reverbWord.word);
      const normB = _normalizeWord(dgWord.word);
      const similarity = levenshteinRatio(normA, normB);
      if (similarity >= 0.8) {
        status = 'confirmed';
        fuzzyMatch = { reverbWord: reverbWord.word, deepgramWord: dgWord.word, similarity: Math.round(similarity * 1000) / 1000 };
      } else {
        status = 'disagreed';
      }
    }

    // Collect timestamp comparison for diagnostic logging
    timestampComparison.push({
      word: reverbWord.word,
      dgWord: dgWord.word,
      status,
      reverbStart: reverbWord.startTime,
      reverbEnd: reverbWord.endTime,
      deepgramStart: dgWord.startTime,
      deepgramEnd: dgWord.endTime,
      reverbDurMs: Math.round((_parseTs(reverbWord.endTime) - _parseTs(reverbWord.startTime)) * 1000),
      deepgramDurMs: Math.round((_parseTs(dgWord.endTime) - _parseTs(dgWord.startTime)) * 1000),
    });

    result.push({
      ...reverbWord,
      crossValidation: status,
      // Deepgram timestamps as primary timekeeper
      startTime: dgWord.startTime,
      endTime: dgWord.endTime,
      // All three timestamp sources preserved for display
      _reverbStartTime: reverbWord.startTime,
      _reverbEndTime: reverbWord.endTime,
      _deepgramStartTime: dgWord.startTime,
      _deepgramEndTime: dgWord.endTime,
      // _reverbCleanStartTime/_reverbCleanEndTime carried through via ...reverbWord
      // Deepgram confidence as primary
      confidence: dgWord.confidence,
      _reverbConfidence: reverbWord.confidence,
      _deepgramConfidence: dgWord.confidence,
      ...(fuzzyMatch ? { _fuzzyMatch: fuzzyMatch } : {}),
      _deepgramWord: dgWord.word
    });
  }

  // Diagnostic logging
  if (timestampComparison.length > 0) {
    console.log('[cross-validation] Reverb vs Deepgram alignment (NW sequence):');
    console.table(timestampComparison);

    const gapComparison = [];
    for (let i = 1; i < timestampComparison.length; i++) {
      const prev = timestampComparison[i - 1];
      const curr = timestampComparison[i];
      const reverbGap = Math.round((_parseTs(curr.reverbStart) - _parseTs(prev.reverbEnd)) * 1000);
      const deepgramGap = Math.round((_parseTs(curr.deepgramStart) - _parseTs(prev.deepgramEnd)) * 1000);
      gapComparison.push({
        between: `"${prev.word}" → "${curr.word}"`,
        reverbGapMs: reverbGap,
        deepgramGapMs: deepgramGap,
        diffMs: reverbGap - deepgramGap
      });
    }
    console.log('[cross-validation] Inter-word gap comparison:');
    console.table(gapComparison);
  }

  if (unconsumedDg.length > 0) {
    console.log('[cross-validation] Unconsumed Deepgram words (heard by DG but not Reverb):');
    console.table(unconsumedDg.map(w => ({ word: w.word, start: w.startTime, end: w.endTime, conf: w.confidence })));
  }

  return { words: result, unconsumedDeepgram: unconsumedDg };
}

/** Parse timestamp string "1.234s" to float seconds. */
function _parseTs(t) {
  return parseFloat(String(t).replace('s', '')) || 0;
}
