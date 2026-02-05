/**
 * Deepgram Nova-3 API Client
 *
 * Calls backend proxy at localhost:8765/deepgram (browser cannot call Deepgram directly - no CORS).
 * Provides cross-validation against Reverb ASR for hallucination detection.
 *
 * Requirements covered:
 * - XVAL-01: Deepgram Nova-3 called for cross-validation
 * - XVAL-03: Graceful fallback when service unavailable
 * - INTG-02: deepgram-api.js client calls Deepgram Nova-3 API
 */

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

/**
 * Normalize word for comparison (lowercase, strip punctuation).
 * @param {string} word
 * @returns {string} Normalized word
 */
function normalizeWord(word) {
  return word.toLowerCase().replace(/[^a-z']/g, '');
}

/**
 * Cross-validate Reverb transcript against Deepgram Nova-3.
 *
 * Words present in both sources are marked "confirmed".
 * Words present only in Reverb are marked "unconfirmed" (potential hallucination).
 * If Deepgram unavailable, all words marked "unavailable".
 *
 * Implements XVAL-02: Reverb <-> Nova-3 disagreement flags words as uncertain.
 *
 * @param {Array} reverbWords - Merged words from Reverb ensemble (v=1.0 verbatim + v=0.0 clean, after Needleman-Wunsch + disfluency tagging)
 * @param {Array|null} deepgramWords - Words from Deepgram Nova-3, or null if unavailable
 * @returns {Array} Words with crossValidation status, Deepgram timestamps as primary (confirmed), and both confidence values preserved
 */
export function crossValidateWithDeepgram(reverbWords, deepgramWords) {
  // If Deepgram unavailable, mark all as unavailable (graceful degradation)
  if (!deepgramWords || deepgramWords.length === 0) {
    return reverbWords.map(word => ({
      ...word,
      crossValidation: 'unavailable'
    }));
  }

  // Build Deepgram word queue for O(1) lookup with confidence pass-through
  const dgWordQueues = new Map();
  for (const w of deepgramWords) {
    const norm = normalizeWord(w.word);
    if (!dgWordQueues.has(norm)) dgWordQueues.set(norm, []);
    dgWordQueues.get(norm).push(w);
  }

  // Annotate each Reverb word with cross-validation status + Deepgram confidence + timestamps
  const timestampComparison = [];

  const result = reverbWords.map(word => {
    const normalized = normalizeWord(word.word);
    const queue = dgWordQueues.get(normalized);

    if (queue && queue.length > 0) {
      const dgWord = queue.shift();

      // Collect timestamp comparison for diagnostic logging
      timestampComparison.push({
        word: word.word,
        reverbStart: word.startTime,
        reverbEnd: word.endTime,
        deepgramStart: dgWord.startTime,
        deepgramEnd: dgWord.endTime,
        reverbDurMs: Math.round((_parseTs(word.endTime) - _parseTs(word.startTime)) * 1000),
        deepgramDurMs: Math.round((_parseTs(dgWord.endTime) - _parseTs(dgWord.startTime)) * 1000),
      });

      return {
        ...word,
        crossValidation: 'confirmed',
        // Deepgram timestamps as primary (Reverb CTM uses hardcoded 100ms durations)
        startTime: dgWord.startTime,
        endTime: dgWord.endTime,
        // Preserve Reverb timestamps for reference
        _reverbStartTime: word.startTime,
        _reverbEndTime: word.endTime,
        // Deepgram confidence as primary (Reverb attention scores drift to 0)
        confidence: dgWord.confidence,
        _reverbConfidence: word.confidence,
        _deepgramConfidence: dgWord.confidence,
        // Deepgram's word text for tooltip display
        _deepgramWord: dgWord.word
      };
    }

    // Unconfirmed: keep Reverb timestamps (no Deepgram alternative available)
    return {
      ...word,
      crossValidation: 'unconfirmed',
      _reverbConfidence: word.confidence,
      _reverbStartTime: word.startTime,
      _reverbEndTime: word.endTime
    };
  });

  // Diagnostic: side-by-side timestamp comparison
  if (timestampComparison.length > 0) {
    console.log('[cross-validation] Reverb vs Deepgram timestamp comparison:');
    console.table(timestampComparison);

    // Show gap comparison (gaps drive hesitation detection)
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
    console.log('[cross-validation] Inter-word gap comparison (drives hesitation detection):');
    console.table(gapComparison);
  }

  return result;
}

/** Parse timestamp string "1.234s" to float seconds. */
function _parseTs(t) {
  return parseFloat(String(t).replace('s', '')) || 0;
}
