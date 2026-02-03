/**
 * Confidence classification thresholds and constants.
 * Developer-tunable values for asymmetric trust policy.
 *
 * Per CONTEXT.md:
 * - Thresholds are INCLUSIVE (0.70 exactly = Medium, not Low)
 * - Values are research-backed: 0.93 (high), 0.70 (low)
 */

export const CONFIDENCE_THRESHOLDS = Object.freeze({
  // Trust level boundaries (inclusive)
  HIGH: 0.93,      // >= 0.93 = High confidence (crystal clear)
  MEDIUM: 0.70,    // >= 0.70 = Medium confidence (acceptable)
  // Below 0.70 = Low confidence (uncertain)
  // 0.0 = Ghost (VAD detected no speech)

  // Assigned confidence for special cases
  VALID_MUMBLE: 0.85,        // latest_only + IN reference (benefit of doubt)
  HALLUCINATION_RISK: 0.50,  // latest_only + NOT in reference (below MEDIUM)
});

/**
 * Trust level enum for type safety.
 */
export const TRUST_LEVELS = Object.freeze({
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  GHOST: 'ghost',
});

/**
 * Flag constants for _flags array.
 */
export const CONFIDENCE_FLAGS = Object.freeze({
  POSSIBLE_INSERTION: 'possible_insertion',
  VAD_GHOST: 'vad_ghost',
  DEFAULT_ONLY_NOT_IN_REF: 'default_only_not_in_ref',
});
