/**
 * Safety check configuration.
 * Per CONTEXT.md: Flag physically impossible or suspicious ASR outputs.
 *
 * Rate anomaly detection uses 5 words/second threshold (physiological limit).
 * 3-word sliding window catches bursts while tolerating natural variation.
 * Edge tolerance relaxes thresholds at audio boundaries.
 */

export const SAFETY_THRESHOLDS = Object.freeze({
  // Rate anomaly detection
  MAX_WORDS_PER_SECOND: 5,          // >5 w/s is physically impossible
  RATE_WINDOW_SIZE: 3,              // 3-word sliding window
  EDGE_TOLERANCE_MS: 300,           // Relaxed thresholds at audio edges

  // Uncorroborated sequence detection (split by reference presence)
  UNCORROBORATED_IN_REF_THRESHOLD: 7,      // 7+ consecutive latest_only IN reference
  UNCORROBORATED_NOT_IN_REF_THRESHOLD: 3,  // 3+ consecutive latest_only NOT in reference

  // Corroboration override
  STRONG_CORROBORATION_CONF: 0.93,  // Matches CONFIDENCE_THRESHOLDS.HIGH

  // Confidence collapse detection
  COLLAPSE_THRESHOLD_PERCENT: 40,   // >40% flagged/none triggers collapse
});

export const SAFETY_FLAGS = Object.freeze({
  RATE_ANOMALY: 'rate_anomaly',
  UNCORROBORATED_SEQUENCE: 'uncorroborated_sequence',
});
