/**
 * Disfluency detector - stutter metrics and fragment merging.
 * Detects stutters as a SEPARATE signal from confidence.
 *
 * Pipeline order: Classify -> Filter ghosts -> Detect disfluencies -> Align
 */

import { parseTime } from './diagnostics.js';
import { DISFLUENCY_THRESHOLDS, SEVERITY_LEVELS } from './disfluency-config.js';

/**
 * Group consecutive words within MAX_STUTTER_GAP_SEC into potential stutter events.
 * Words are grouped by temporal proximity, not text content.
 *
 * @param {Array} words - Array of word objects with startTime/endTime
 * @returns {Array<Array>} Array of word groups (each group is potential stutter event)
 */
export function groupStutterEvents(words) {
  if (!words || words.length === 0) return [];

  const groups = [];
  let currentGroup = [words[0]];

  for (let i = 1; i < words.length; i++) {
    const prevEnd = parseTime(words[i - 1].endTime);
    const currStart = parseTime(words[i].startTime);
    const gap = currStart - prevEnd;

    if (gap <= DISFLUENCY_THRESHOLDS.MAX_STUTTER_GAP_SEC && gap >= 0) {
      // Within gap threshold - add to current group
      currentGroup.push(words[i]);
    } else {
      // Gap too large - start new group
      groups.push(currentGroup);
      currentGroup = [words[i]];
    }
  }

  // Don't forget the last group
  groups.push(currentGroup);

  return groups;
}

/**
 * Compute pause durations between consecutive words in a group.
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
 * Used to calculate attempt count, total duration, and max pause.
 *
 * @param {Array} attemptWords - Words that are part of same stutter event
 * @returns {object|null} { attempts, totalDuration, maxPause } or null if only 1 word
 */
export function computeDisfluencyMetrics(attemptWords) {
  if (!attemptWords || attemptWords.length <= 1) {
    return null;
  }

  // Sort by start time (should already be sorted, but be safe)
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
 * Per CONTEXT.md algorithm:
 *   - 5+ attempts OR totalDuration >= 2.0s -> significant
 *   - maxPause >= 0.5s AND attempts >= 2 -> moderate (duration override)
 *   - 3-4 attempts -> moderate
 *   - 2 attempts -> minor
 *   - 1 attempt -> none (clean read)
 *
 * @param {number} attempts - Number of stutter attempts (1 = clean read)
 * @param {number} totalDuration - Total time from first attempt to word end (seconds)
 * @param {number} maxPause - Longest pause between attempts (seconds)
 * @returns {string} Severity level: 'none' | 'minor' | 'moderate' | 'significant'
 */
export function calculateSeverity(attempts, totalDuration = 0, maxPause = 0) {
  // Default to 'none' for clean reads
  if (attempts <= 1) return SEVERITY_LEVELS.NONE;

  // Check significant thresholds first (highest priority)
  if (attempts >= DISFLUENCY_THRESHOLDS.SIGNIFICANT_ATTEMPTS ||
      totalDuration >= DISFLUENCY_THRESHOLDS.SIGNIFICANT_DURATION_SEC) {
    return SEVERITY_LEVELS.SIGNIFICANT;
  }

  // Duration override: long pause with multiple attempts escalates to moderate
  if (maxPause >= DISFLUENCY_THRESHOLDS.MODERATE_PAUSE_SEC && attempts >= 2) {
    return SEVERITY_LEVELS.MODERATE;
  }

  // Moderate by attempt count
  if (attempts >= DISFLUENCY_THRESHOLDS.MODERATE_ATTEMPTS) {
    return SEVERITY_LEVELS.MODERATE;
  }

  // Minor: exactly 2 attempts ("the double take")
  if (attempts === DISFLUENCY_THRESHOLDS.MINOR_ATTEMPTS) {
    return SEVERITY_LEVELS.MINOR;
  }

  // Fallback (should not reach here, but be safe)
  return SEVERITY_LEVELS.NONE;
}
