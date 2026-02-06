/**
 * Deepgram Nova-3 API Client
 *
 * Calls backend proxy at localhost:8765/deepgram (browser cannot call Deepgram directly - no CORS).
 * Provides cross-validation against Reverb ASR using Needleman-Wunsch sequence alignment.
 *
 * Cross-validation statuses:
 *   confirmed  — both engines produced the same word (text match, fuzzy match, or near-match)
 *   disagreed  — both engines heard something, but different words (mismatch, edit distance > 1)
 *   unconfirmed — only Reverb produced a word; cross-validator had nothing at this position
 *   unavailable — cross-validator service was offline
 *
 * Near-match resolution (edit distance ≤ 1):
 *   When engines disagree by a single character (e.g., Reverb "you" vs Deepgram "your"),
 *   this is phonetic parsing noise — not a student error. In connected speech, trailing
 *   sounds like 'r', 's', or 't' are often reduced and parsed differently by each engine.
 *   For these near-matches, we use Deepgram's word text (1 char away from Reverb's,
 *   negligible difference) since Deepgram generally has slightly higher word-level accuracy.
 *   This is NOT reference-biased — we don't look at the reference text at all.
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
  gapInsert: -1,   // Reverb word with no cross-validator counterpart
  gapDelete: -1    // Cross-validator word with no Reverb counterpart
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
        _reverbConfidence: reverbWord.confidence,
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
        // Keep Reverb's word text, mark confirmed.
        status = 'confirmed';
        fuzzyMatch = { reverbWord: reverbWord.word, xvalWord: xvWord.word, similarity: Math.round(similarity * 1000) / 1000 };
      } else {
        // Check edit distance for near-match detection.
        // Derive from similarity: dist = (1 - ratio) * maxLen
        const maxLen = Math.max(normA.length, normB.length);
        const editDist = maxLen > 0 ? Math.round((1 - similarity) * maxLen) : 0;

        if (editDist <= 1 && maxLen >= 2) {
          // Tier 2 — Near-match (edit distance ≤ 1, e.g., "you"/"your", "cat"/"cats").
          // A single-character difference between two ASR engines is phonetic parsing
          // noise, not a meaningful disagreement. In connected speech, trailing sounds
          // like 'r', 's', 't' are often reduced and each engine parses the boundary
          // differently. We confirm the match and use Deepgram's word text since it's
          // only 1 char different and Deepgram generally has higher word-level accuracy.
          // This is NOT reference-biased — we don't look at the reference at all.
          status = 'confirmed';
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

    // For near-matches, use cross-validator's word text (normalized to match Reverb format).
    // For all other cases, keep Reverb's word text via ...reverbWord spread.
    const wordOverride = nearMatch ? { word: _normalizeWord(xvWord.word) } : {};

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
      // Cross-validator confidence as primary
      confidence: xvWord.confidence,
      _reverbConfidence: reverbWord.confidence,
      _xvalConfidence: xvWord.confidence,
      ...(fuzzyMatch ? { _fuzzyMatch: fuzzyMatch } : {}),
      ...(nearMatch ? { _nearMatch: nearMatch } : {}),
      _xvalWord: xvWord.word,
      _xvalEngine: 'deepgram'
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
    console.table(unconsumedXv.map(w => ({ word: w.word, start: w.startTime, end: w.endTime, conf: w.confidence })));
  }

  return { words: result, unconsumedXval: unconsumedXv };
}

/** Parse timestamp string "1.234s" to float seconds. */
function _parseTs(t) {
  return parseFloat(String(t).replace('s', '')) || 0;
}
