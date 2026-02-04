/**
 * Safety check module for ASR output validation.
 * Per CONTEXT.md Phase 15: Flag physically impossible or suspicious outputs.
 *
 * Rate anomaly detection uses 3-word sliding window to flag >5 w/s bursts.
 * Edge tolerance (300ms) relaxes thresholds at audio boundaries.
 */

import { parseTime } from './diagnostics.js';
import { SAFETY_THRESHOLDS, SAFETY_FLAGS } from './safety-config.js';
import { buildReferenceSet } from './confidence-classifier.js';
import { getCanonical } from './word-equivalences.js';

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

/**
 * Normalize word for reference set lookup.
 * Matches confidence-classifier.js normalizeWord logic.
 * @param {string} word
 * @returns {string}
 */
function normalizeWord(word) {
  if (!word) return '';
  return word.toLowerCase().replace(/^[^a-z0-9'-]+|[^a-z0-9'-]+$/g, '');
}

/**
 * Detect uncorroborated sequences (consecutive latest_only words).
 * Uses split thresholds based on reference presence:
 * - 7+ consecutive IN reference = suspicious (even expected words lack corroboration)
 * - 3+ consecutive NOT in reference = highly suspicious (hallucination risk)
 *
 * A single corroborated word (_source === 'both') resets both counters.
 * Per CONTEXT.md: "Flag each word in the suspicious sequence (not just first/last)"
 *
 * @param {Array} words - Array of word objects with _source property
 * @param {Set} referenceSet - Set from buildReferenceSet()
 * @returns {Array} The words array (mutated with flags)
 */
export function detectUncorroboratedSequences(words, referenceSet) {
  const { UNCORROBORATED_IN_REF_THRESHOLD, UNCORROBORATED_NOT_IN_REF_THRESHOLD } = SAFETY_THRESHOLDS;

  // Track consecutive latest_only words by reference presence
  let inRefCount = 0;
  let notInRefCount = 0;
  let sequenceStartIndex = -1;

  // Track words in current sequence for back-flagging
  const inRefSequence = [];
  const notInRefSequence = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const source = word._source || word.source;

    if (source === 'both') {
      // Corroborated word resets BOTH counters
      inRefCount = 0;
      notInRefCount = 0;
      sequenceStartIndex = -1;
      inRefSequence.length = 0;
      notInRefSequence.length = 0;
    } else if (source === 'latest_only') {
      // Check if word is in reference
      const normalized = normalizeWord(word.word);
      const canonical = getCanonical(normalized);
      const inReference = referenceSet.has(normalized) || referenceSet.has(canonical);

      if (sequenceStartIndex === -1) {
        sequenceStartIndex = i;
      }

      if (inReference) {
        inRefCount++;
        inRefSequence.push(i);

        // Check if in-reference threshold breached
        if (inRefCount >= UNCORROBORATED_IN_REF_THRESHOLD) {
          // Flag all words in the in-ref sequence
          for (const idx of inRefSequence) {
            addFlag(words[idx], SAFETY_FLAGS.UNCORROBORATED_SEQUENCE);
            words[idx]._uncorroboratedSequence = {
              type: 'in_reference',
              sequenceLength: inRefCount
            };
          }
        }
      } else {
        notInRefCount++;
        notInRefSequence.push(i);

        // Check if not-in-reference threshold breached
        if (notInRefCount >= UNCORROBORATED_NOT_IN_REF_THRESHOLD) {
          // Flag all words in the not-in-ref sequence
          for (const idx of notInRefSequence) {
            addFlag(words[idx], SAFETY_FLAGS.UNCORROBORATED_SEQUENCE);
            words[idx]._uncorroboratedSequence = {
              type: 'not_in_reference',
              sequenceLength: notInRefCount
            };
          }
        }
      }
    } else {
      // default_only or other - resets counters (breaks sequence)
      inRefCount = 0;
      notInRefCount = 0;
      sequenceStartIndex = -1;
      inRefSequence.length = 0;
      notInRefSequence.length = 0;
    }
  }

  return words;
}

/**
 * Apply corroboration override: remove rate and sequence flags for strongly corroborated words.
 * Strong corroboration = source='both' AND confidence >= 0.93 (HIGH threshold).
 *
 * Per CONTEXT.md: "Ghost flags take priority - show ghost flag but still track other flags"
 * NEVER removes vad_ghost flag.
 *
 * @param {Array} words - Array of word objects with _flags
 * @returns {Array} The words array (mutated)
 */
export function applyCorroborationOverride(words) {
  const { STRONG_CORROBORATION_CONF } = SAFETY_THRESHOLDS;

  for (const word of words) {
    const source = word._source || word.source;
    const confidence = word.confidence ?? 0;

    // Check for strong corroboration
    if (source === 'both' && confidence >= STRONG_CORROBORATION_CONF) {
      if (word._flags && word._flags.length > 0) {
        // Remove RATE_ANOMALY and UNCORROBORATED_SEQUENCE, but NEVER vad_ghost
        word._flags = word._flags.filter(flag =>
          flag !== SAFETY_FLAGS.RATE_ANOMALY &&
          flag !== SAFETY_FLAGS.UNCORROBORATED_SEQUENCE &&
          flag !== 'vad_ghost' // Explicit check per CONTEXT.md
        );

        // Clean up empty _flags array
        if (word._flags.length === 0) {
          delete word._flags;
        }
      }
    }
  }

  return words;
}

/**
 * Detect confidence collapse state.
 * Collapse = >40% of words have trustLevel 'none' OR have _flags.
 *
 * Per CONTEXT.md: When collapsed, UI shows banner and hides WCPM score.
 *
 * @param {Array} words - Array of word objects
 * @returns {{ collapsed: boolean, percent: number, flaggedCount: number }}
 */
export function detectConfidenceCollapse(words) {
  if (!words || words.length === 0) {
    return { collapsed: false, percent: 0, flaggedCount: 0 };
  }

  const { COLLAPSE_THRESHOLD_PERCENT } = SAFETY_THRESHOLDS;

  let flaggedCount = 0;

  for (const word of words) {
    // Count words with trustLevel 'none' OR any _flags
    const hasNoneTrust = word.trustLevel === 'none';
    const hasFlags = word._flags && word._flags.length > 0;

    if (hasNoneTrust || hasFlags) {
      flaggedCount++;
    }
  }

  const percent = (flaggedCount / words.length) * 100;
  const collapsed = percent > COLLAPSE_THRESHOLD_PERCENT;

  return {
    collapsed,
    percent: Math.round(percent * 10) / 10, // Round to 1 decimal
    flaggedCount
  };
}
