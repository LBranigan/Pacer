/**
 * Disfluency detector - SIMPLIFIED.
 *
 * IMPORTANT: Fragment and repetition detection have been REMOVED because STT
 * converts acoustic events into words, losing the original signal needed to
 * reliably detect stutters. What we see as "d d duck" could be:
 *   - A real stutter (d-d-duck)
 *   - Separate words that STT misheard
 *   - Timestamp drift between models creating duplicates
 *
 * The old approach caused false positives like marking "went" as repeated when
 * it was actually timestamp drift, or marking "the" as a fragment of "then".
 *
 * Current approach:
 *   - Morphological prefix absorption is handled in ensemble-merger.js
 *   - Hesitation detection is handled in diagnostics.js (timing gaps)
 *   - This file now just passes through words with basic severity tagging
 *
 * Pipeline order: Classify -> Filter ghosts -> Detect disfluencies -> Align
 */

import { parseTime } from './diagnostics.js';
import { DISFLUENCY_THRESHOLDS, SEVERITY_LEVELS } from './disfluency-config.js';
// NOTE: Removed phonetic-utils imports (doubleMetaphone, levenshtein) - no longer needed
// after removing unreliable fragment/repetition detection

/**
 * Normalize a word for comparison (lowercase, strip punctuation).
 * @param {string} word - Word to normalize
 * @returns {string} Normalized word
 * @deprecated Kept for backward compatibility with isMergeEligible export
 */
function normalizeWord(word) {
  if (!word) return '';
  return word.toLowerCase().replace(/[^a-z'-]/g, '');
}

// NOTE: normalizeText() removed - was only used by buildReferenceNgrams() which was removed

// ═══════════════════════════════════════════════════════════════════════════
// DEPRECATED: Fragment/Repetition Detection Functions
// ═══════════════════════════════════════════════════════════════════════════
// The following functions have been REMOVED because STT-based stutter detection
// is unreliable. The acoustic signal is lost when STT converts speech to words.
//
// REMOVED:
//   - buildReferenceNgrams() - was for phonetic N-gram protection
//   - matchesReferencePhonetically() - was for fuzzy reference matching
//   - isProtectedByReference() - was Filter 1
//   - isProtectedByConfidence() - was Filter 3
//   - checkForFragment() - was Filter 2A (caused false positives)
//   - checkForRepetition() - was Filter 2B (caused "went went" bugs)
//
// Morphological prefix absorption is now handled in ensemble-merger.js
// Hesitation detection is handled in diagnostics.js
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a fragment word should be merged into a target word.
 * DEPRECATED but kept for backward compatibility.
 *
 * @param {string} fragment - The potential fragment word
 * @param {string} target - The potential target word
 * @returns {boolean} True if fragment should merge into target
 * @deprecated No longer used - fragment detection removed
 */
function isMergeEligible(fragment, target) {
  if (!fragment || !target) return false;

  const f = fragment.toLowerCase();
  const t = target.toLowerCase();

  // First char must match
  if (!t.startsWith(f.charAt(0))) return false;

  // Short fragments (1-3 chars): must match prefix of target
  if (f.length <= DISFLUENCY_THRESHOLDS.SHORT_FRAGMENT_MAX_CHARS) {
    return t.startsWith(f);
  }

  // Long fragments (4+ chars): must be exact match OR long prefix match
  return (f === t) || (t.startsWith(f) && f.length >= DISFLUENCY_THRESHOLDS.LONG_PREFIX_MIN_CHARS);
}

// ═══════════════════════════════════════════════════════════════════════════
// Metrics and Severity
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute pause durations between consecutive words.
 *
 * @param {Array} words - Array of words in chronological order
 * @returns {Array<number>} Array of pause durations in seconds
 */
function computePauses(words) {
  const pauses = [];
  for (let i = 1; i < words.length; i++) {
    const prevEnd = parseTime(words[i - 1].endTime);
    const currStart = parseTime(words[i].startTime);
    const pause = Math.max(0, currStart - prevEnd);
    pauses.push(pause);
  }
  return pauses;
}

/**
 * Compute disfluency metrics for a group of words.
 *
 * @param {Array} attemptWords - Words that are part of same stutter event
 * @returns {object|null} { attempts, totalDuration, maxPause } or null if only 1 word
 */
export function computeDisfluencyMetrics(attemptWords) {
  if (!attemptWords || attemptWords.length <= 1) {
    return null;
  }

  const sorted = [...attemptWords].sort(
    (a, b) => parseTime(a.startTime) - parseTime(b.startTime)
  );

  const pauses = computePauses(sorted);
  const firstStart = parseTime(sorted[0].startTime);
  const lastEnd = parseTime(sorted[sorted.length - 1].endTime);

  return {
    attempts: sorted.length,
    totalDuration: Math.round((lastEnd - firstStart) * 100) / 100,
    maxPause: pauses.length > 0 ? Math.round(Math.max(...pauses) * 100) / 100 : 0
  };
}

/**
 * Calculate disfluency severity using "Count-First, Duration-Override" model.
 *
 * @param {number} attempts - Number of stutter attempts (1 = clean read)
 * @param {number} totalDuration - Total time from first attempt to word end (seconds)
 * @param {number} maxPause - Longest pause between attempts (seconds)
 * @returns {string} Severity level: 'none' | 'minor' | 'moderate' | 'significant'
 */
export function calculateSeverity(attempts, totalDuration = 0, maxPause = 0) {
  if (attempts <= 1) return SEVERITY_LEVELS.NONE;

  if (attempts >= DISFLUENCY_THRESHOLDS.SIGNIFICANT_ATTEMPTS ||
      totalDuration >= DISFLUENCY_THRESHOLDS.SIGNIFICANT_DURATION_SEC) {
    return SEVERITY_LEVELS.SIGNIFICANT;
  }

  if (maxPause >= DISFLUENCY_THRESHOLDS.MODERATE_PAUSE_SEC && attempts >= 2) {
    return SEVERITY_LEVELS.MODERATE;
  }

  if (attempts >= DISFLUENCY_THRESHOLDS.MODERATE_ATTEMPTS) {
    return SEVERITY_LEVELS.MODERATE;
  }

  if (attempts === DISFLUENCY_THRESHOLDS.MINOR_ATTEMPTS) {
    return SEVERITY_LEVELS.MINOR;
  }

  return SEVERITY_LEVELS.NONE;
}

/**
 * Compute document-level disfluency summary.
 *
 * @param {Array} words - Processed words with severity
 * @returns {object} Summary counts by severity
 */
function computeDisfluencySummary(words) {
  const summary = {
    none: 0,
    minor: 0,
    moderate: 0,
    significant: 0,
    totalWordsWithDisfluency: 0
  };

  for (const word of words) {
    const sev = word.severity || SEVERITY_LEVELS.NONE;
    summary[sev] = (summary[sev] || 0) + 1;

    if (sev !== SEVERITY_LEVELS.NONE) {
      summary.totalWordsWithDisfluency++;
    }
  }

  return summary;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Detection Function
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Main disfluency detection function - SIMPLIFIED.
 *
 * Fragment and repetition detection have been REMOVED due to unreliable results.
 * STT converts acoustic events to words, losing the signal needed for stutter
 * detection. False positives were common (e.g., timestamp drift creating "went went").
 *
 * What remains:
 *   - Pass through words without fragment merging
 *   - Tag words with morphological breaks (from ensemble-merger.js)
 *   - Basic severity tagging (for future use if needed)
 *
 * Hesitation detection is handled separately in diagnostics.js using timing gaps.
 *
 * @param {Array} words - Classified words (from filterGhosts output)
 * @param {string} referenceText - Reference passage (kept for API compatibility)
 * @returns {object} { words: processedWords, summary: _disfluencySummary, fragmentsRemoved: 0 }
 */
export function detectDisfluencies(words, referenceText = '') {
  if (!words || words.length === 0) {
    return {
      words: [],
      summary: computeDisfluencySummary([]),
      fragmentsRemoved: 0
    };
  }

  // Build processed words array - pass through without fragment detection
  const processedWords = [];

  for (let i = 0; i < words.length; i++) {
    const word = { ...words[i] };

    // Default: clean read (no attempts/fragments)
    word.attempts = 1;
    word.severity = SEVERITY_LEVELS.NONE;

    // Check if this word has a morphological break (from ensemble-merger.js)
    // These are NOT errors, just indicators that student sounded out a prefix
    if (word._debug?.morphologicalBreak) {
      // Add disfluency info for UI display (squiggly line)
      word._disfluency = {
        type: 'morphological_break',
        prefix: word._debug.morphologicalBreak.prefix,
        gapMs: word._debug.morphologicalBreak.gapMs
      };
      // Morphological breaks are NOT counted as disfluencies for severity
      // They indicate good phonics skills, not reading struggles
    }

    processedWords.push(word);
  }

  // Compute summary
  const summary = computeDisfluencySummary(processedWords);

  return {
    words: processedWords,
    summary: summary,
    fragmentsRemoved: 0  // No longer removing fragments
  };
}

// Legacy exports for backward compatibility
export { isMergeEligible };
