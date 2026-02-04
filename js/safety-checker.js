/**
 * Safety check module for ASR output validation.
 * Per CONTEXT.md Phase 15: Flag physically impossible or suspicious outputs.
 *
 * Rate anomaly detection uses 3-word sliding window to flag >5 w/s bursts.
 * Edge tolerance (300ms) relaxes thresholds at audio boundaries.
 */

import { parseTime } from './diagnostics.js';
import { SAFETY_THRESHOLDS, SAFETY_FLAGS } from './safety-config.js';

/**
 * Add a flag to a word, avoiding duplicates.
 * @param {Object} word - Word object to flag
 * @param {string} flag - Flag string to add
 * @returns {Object} The word (for chaining)
 */
export function addFlag(word, flag) {
  if (!word._flags) {
    word._flags = [];
  }
  if (!word._flags.includes(flag)) {
    word._flags.push(flag);
  }
  return word;
}

/**
 * Detect rate anomalies using 3-word sliding window.
 * Flags words in windows exceeding 5 words/second.
 * Skips edge windows (first/last 300ms of audio).
 *
 * @param {Array} words - Array of word objects with startTime/endTime
 * @param {number} audioDurationMs - Total audio duration in milliseconds
 * @returns {Array} The words array (mutated with flags)
 */
export function detectRateAnomalies(words, audioDurationMs) {
  const { MAX_WORDS_PER_SECOND, RATE_WINDOW_SIZE, EDGE_TOLERANCE_MS } = SAFETY_THRESHOLDS;

  // Skip if fewer than window size words
  if (words.length < RATE_WINDOW_SIZE) {
    return words;
  }

  // Slide window across words
  for (let i = 0; i <= words.length - RATE_WINDOW_SIZE; i++) {
    const windowWords = words.slice(i, i + RATE_WINDOW_SIZE);

    // Parse timestamps for first and last word in window
    const windowStart = parseTime(windowWords[0].startTime);
    const windowEnd = parseTime(windowWords[RATE_WINDOW_SIZE - 1].endTime);
    const windowDurationSec = windowEnd - windowStart;

    // Convert to ms for edge check
    const windowStartMs = windowStart * 1000;
    const windowEndMs = windowEnd * 1000;

    // Skip edge windows (first/last 300ms of audio get relaxed thresholds)
    if (windowStartMs < EDGE_TOLERANCE_MS ||
        windowEndMs > audioDurationMs - EDGE_TOLERANCE_MS) {
      continue;
    }

    // Calculate rate and check threshold
    if (windowDurationSec > 0) {
      const rate = RATE_WINDOW_SIZE / windowDurationSec;

      if (rate > MAX_WORDS_PER_SECOND) {
        // Flag all words in this window
        for (const word of windowWords) {
          addFlag(word, SAFETY_FLAGS.RATE_ANOMALY);
          // Store rate metadata for debugging
          word._rateAnomaly = {
            rate: Math.round(rate * 100) / 100,
            windowIndex: i
          };
        }
      }
    }
  }

  return words;
}
