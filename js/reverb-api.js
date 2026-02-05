/**
 * Reverb ASR HTTP Client
 *
 * Calls localhost:8765 backend (Docker container from Phase 20).
 * Provides dual-pass transcription: v=1.0 (verbatim) and v=0.0 (clean).
 *
 * Requirements covered:
 * - INTG-01: reverb-api.js client calls local Reverb service
 *
 * Pipeline: reverb-api.js -> sequence-aligner.js -> disfluency-tagger.js
 */

// Configurable base URL - allows override via window global
const REVERB_URL = window.REVERB_API_URL || 'http://localhost:8765';

/**
 * Convert blob to base64 string.
 * Uses FileReader API (browser-native).
 *
 * @param {Blob} blob - Audio blob to convert
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
 * Normalize Reverb word format to project conventions.
 *
 * Reverb returns: { word, start_time (float), end_time (float), confidence }
 * Project uses: { word, startTime ("X.XXs"), endTime ("X.XXs"), confidence }
 *
 * We keep BOTH formats:
 * - startTime/endTime as strings for existing code compatibility
 * - start_time/end_time as floats for alignment calculations
 *
 * @param {object} w - Reverb word object
 * @returns {object} Normalized word object
 */
function normalizeWord(w) {
  return {
    word: w.word,
    // String format for existing code
    startTime: `${w.start_time}s`,
    endTime: `${w.end_time}s`,
    // Numeric format for alignment calculations
    start_time: w.start_time,
    end_time: w.end_time,
    confidence: w.confidence
  };
}

/**
 * Check if Reverb service is available and model is loaded.
 * Uses 3-second timeout for fast failure detection.
 *
 * @returns {Promise<boolean>} True if Reverb is ready for transcription
 */
export async function isReverbAvailable() {
  try {
    const resp = await fetch(`${REVERB_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    });

    if (!resp.ok) return false;

    const data = await resp.json();
    // Accept both 'ok' (model loaded) and 'ready' (model loads on first request)
    // Model loads lazily on first /ensemble call, so 'ready' means service is up
    return data.status === 'ok' || data.status === 'ready';
  } catch {
    // Network error, timeout, or service unavailable
    return false;
  }
}

/**
 * Transcribe audio with Reverb dual-pass ensemble.
 *
 * Returns verbatim (v=1.0) and clean (v=0.0) transcripts for
 * disfluency detection via sequence alignment.
 *
 * Verbatim transcript includes fillers, repetitions, false starts.
 * Clean transcript removes them via model conditioning.
 * Difference reveals model-detected disfluencies.
 *
 * @param {Blob} blob - Audio blob (WAV recommended, WebM supported)
 * @returns {Promise<object|null>} { verbatim, clean } or null on failure
 *   - verbatim.words: Array of normalized word objects
 *   - verbatim.transcript: Full transcript string
 *   - verbatim.verbatimicity: v=1.0
 *   - clean.words: Array of normalized word objects
 *   - clean.transcript: Full transcript string
 *   - clean.verbatimicity: v=0.0
 */
export async function sendToReverbEnsemble(blob) {
  try {
    const base64 = await blobToBase64(blob);

    const resp = await fetch(`${REVERB_URL}/ensemble`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_base64: base64 }),
      // 120-second timeout: first request triggers model loading (~30-60s)
      // Subsequent requests are fast (~5-15s depending on audio length)
      signal: AbortSignal.timeout(120000)
    });

    if (!resp.ok) {
      console.warn(`[reverb-api] Backend returned ${resp.status}`);
      return null;
    }

    const data = await resp.json();

    // Normalize word format to project conventions
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
    return null; // Graceful degradation - caller should fall back to Deepgram-only
  }
}
