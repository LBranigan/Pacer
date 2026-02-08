/**
 * Deepgram Nova-3 API Client
 *
 * Calls backend proxy at localhost:8765/deepgram (browser cannot call Deepgram directly - no CORS).
 * Pure transport layer — cross-validation logic is in cross-validator.js.
 *
 * Requirements covered:
 * - INTG-02: deepgram-api.js client calls Deepgram Nova-3 API
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
 * Check if Deepgram service is available and configured.
 * Uses /health endpoint to verify backend is running and has API key.
 *
 * @returns {Promise<boolean>} True if Deepgram is available
 */
export async function isDeepgramAvailable() {
  try {
    const resp = await fetch(`${BACKEND_URL}/health`, {
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

    const resp = await fetch(`${BACKEND_URL}/deepgram`, {
      method: 'POST',
      headers: backendHeaders('application/json'),
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
