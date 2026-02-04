/**
 * Disfluency detection configuration.
 * Per CONTEXT.md: thresholds are configurable in dev mode.
 */

// Severity thresholds (per CONTEXT.md "Count-First, Duration-Override" model)
export const DISFLUENCY_THRESHOLDS = {
  // Filter 2: Phonological Horizons (replaces grouping-based approach)
  // Fragment detection (prefix matches) - STRICT
  FRAGMENT_MAX_LOOKAHEAD: 1,        // Only check i+1 for fragments
  FRAGMENT_MAX_TIME_GAP_SEC: 0.5,   // Fragments resolve within 500ms

  // Repetition detection (exact matches) - LOOSE
  REPETITION_MAX_LOOKAHEAD: 2,      // Check i+1 and i+2 for repetitions
  REPETITION_MAX_TIME_GAP_SEC: 1.0, // Repetitions can have fillers between

  // Filter 3: Confidence Protection
  // Default model provides real acoustic confidence (unlike latest_long)
  CONFIDENCE_PROTECTION_THRESHOLD: 0.93,  // Consistent with HIGH_CONFIDENCE_THRESHOLD

  // Filter 1: Phonetic Matching for Reference Protection
  MAX_PHONETIC_DISTANCE: 1,  // Levenshtein distance for fuzzy N-gram match

  // Duration override thresholds
  SIGNIFICANT_DURATION_SEC: 2.0,  // totalDuration >= 2.0s -> significant
  MODERATE_PAUSE_SEC: 0.5,        // maxPause >= 0.5s with 2+ attempts -> moderate

  // Attempt count thresholds
  SIGNIFICANT_ATTEMPTS: 5,  // 5+ attempts -> significant
  MODERATE_ATTEMPTS: 3,     // 3-4 attempts -> moderate
  MINOR_ATTEMPTS: 2,        // 2 attempts -> minor

  // Fragment merge eligibility
  SHORT_FRAGMENT_MAX_CHARS: 3,  // Fragments <= 3 chars use prefix matching
  LONG_PREFIX_MIN_CHARS: 4      // Fragments >= 4 chars need exact or long prefix match
};

// Severity levels
export const SEVERITY_LEVELS = {
  NONE: 'none',
  MINOR: 'minor',
  MODERATE: 'moderate',
  SIGNIFICANT: 'significant'
};

// Export for dev mode slider
export const THRESHOLD_RANGES = {
  FRAGMENT_MAX_TIME_GAP_SEC: { min: 0.2, max: 1.0, step: 0.1 },
  REPETITION_MAX_TIME_GAP_SEC: { min: 0.5, max: 2.0, step: 0.1 },
  CONFIDENCE_PROTECTION_THRESHOLD: { min: 0.85, max: 0.99, step: 0.01 },
  SIGNIFICANT_DURATION_SEC: { min: 1.0, max: 5.0, step: 0.5 },
  MODERATE_PAUSE_SEC: { min: 0.2, max: 1.0, step: 0.1 }
};
