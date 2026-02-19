/**
 * Parakeet TDT 0.6B v2 API Client (English-only)
 *
 * Calls backend at localhost:8765/parakeet for local GPU-based transcription.
 * Pure transport layer — cross-validation logic is in cross-validator.js.
 *
 * Uses v2 (English-only) instead of v3 (multilingual) for better English WER
 * and a tighter 1,024-token BPE vocabulary that produces fewer fragmentation artifacts.
 * See server.py get_parakeet_model() docstring for full rationale.
 *
 * Parakeet TDT (Token-and-Duration Transducer) provides:
 * - Native word-level timestamps from duration prediction head
 * - Runs locally on GPU — no API key needed, no network latency
 */

import { BACKEND_URL, backendHeaders } from './backend-config.js';

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
 * Check if Parakeet service is available.
 * Uses /health endpoint to verify nemo_toolkit is installed.
 *
 * @returns {Promise<boolean>} True if Parakeet is available
 */
export async function isParakeetAvailable() {
  try {
    const resp = await fetch(`${BACKEND_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.parakeet_configured === true;
  } catch {
    return false;
  }
}

/**
 * Send audio to Parakeet TDT via backend.
 *
 * Returns null on failure for graceful degradation.
 *
 * @param {Blob} blob - Audio blob (WAV, WebM, etc.)
 * @returns {Promise<object|null>} Response with words array, or null if unavailable
 */
export async function sendToParakeet(blob) {
  try {
    const base64 = await blobToBase64(blob);

    const resp = await fetch(`${BACKEND_URL}/parakeet`, {
      method: 'POST',
      headers: backendHeaders('application/json'),
      body: JSON.stringify({ audio_base64: base64 }),
      signal: AbortSignal.timeout(40000) // 40s timeout
    });

    if (!resp.ok) {
      console.warn(`[parakeet-api] Backend returned ${resp.status}`);
      return null;
    }

    return await resp.json();
  } catch (e) {
    console.warn('[parakeet-api] Service unavailable:', e.message);
    return null;
  }
}
