/**
 * Disfluency detection configuration.
 * Per CONTEXT.md: thresholds are configurable in dev mode.
 */

// Severity thresholds (per CONTEXT.md "Count-First, Duration-Override" model)
export const DISFLUENCY_THRESHOLDS = {
  // Gap threshold for grouping stutter attempts
  MAX_STUTTER_GAP_SEC: 2.0,

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
  MAX_STUTTER_GAP_SEC: { min: 0.5, max: 5.0, step: 0.5 },
  SIGNIFICANT_DURATION_SEC: { min: 1.0, max: 5.0, step: 0.5 },
  MODERATE_PAUSE_SEC: { min: 0.2, max: 1.0, step: 0.1 }
};
