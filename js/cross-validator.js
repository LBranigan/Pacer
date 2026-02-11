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

// crossValidateTranscripts() has been removed — replaced by reference-anchored
// cross-validation in app.js (Plan 5). Each engine is independently aligned to
// the reference text, and verdicts are compared per-reference-word.
