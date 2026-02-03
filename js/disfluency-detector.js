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

/**
 * Check if a fragment word should be merged into a target word.
 * Per CONTEXT.md merge eligibility rules:
 *   - First char must match
 *   - Short fragments (1-3 chars): must match prefix of target
 *   - Long fragments (4+ chars): must be exact match OR long prefix match
 *
 * This distinguishes stutters from substitutions:
 *   - "p" before "please" -> stutter (merge)
 *   - "beauti" before "beautiful" -> stutter (merge, long prefix)
 *   - "sat" before "sit" -> substitution (no merge, 3+ chars, not exact)
 *
 * @param {string} fragment - The potential fragment word
 * @param {string} target - The potential target word
 * @returns {boolean} True if fragment should merge into target
 */
export function isMergeEligible(fragment, target) {
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
  // Exact match handles full word repetitions: "ball" before "ball"
  // Long prefix handles partial: "beauti" before "beautiful"
  return (f === t) || (t.startsWith(f) && f.length >= DISFLUENCY_THRESHOLDS.LONG_PREFIX_MIN_CHARS);
}

/**
 * Find the best target word for a fragment within a group.
 * Per CONTEXT.md: "Nearest word wins" - prefer closest by time.
 *
 * @param {object} fragment - The fragment word
 * @param {Array} candidates - Potential target words after the fragment
 * @returns {object|null} Best target word or null if no match
 */
function findBestTarget(fragment, candidates) {
  if (!candidates || candidates.length === 0) return null;

  // Candidates are already sorted by time (from the group)
  // Find first eligible target (nearest by time)
  for (const candidate of candidates) {
    if (isMergeEligible(fragment.word, candidate.word)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Process a group of temporally-close words to detect stutters.
 * Identifies fragments, merges them into targets, computes metrics.
 *
 * @param {Array} group - Words within 2s gap of each other
 * @returns {object} { processedWords, fragmentsRemoved }
 */
function processStutterGroup(group) {
  if (group.length === 0) return { processedWords: [], fragmentsRemoved: 0 };
  if (group.length === 1) {
    // Single word - no stuttering, just add default disfluency props
    const word = { ...group[0], attempts: 1, severity: SEVERITY_LEVELS.NONE };
    return { processedWords: [word], fragmentsRemoved: 0 };
  }

  // Track which indices are fragments to be removed
  const fragmentIndices = new Set();
  // Map from target index to its fragments
  const targetFragments = new Map();

  // Forward scan: for each word, check if it's a fragment of a later word
  for (let i = 0; i < group.length - 1; i++) {
    if (fragmentIndices.has(i)) continue; // Already marked as fragment

    const current = group[i];
    const candidates = group.slice(i + 1);
    const target = findBestTarget(current, candidates);

    if (target) {
      const targetIdx = group.indexOf(target);

      // Current word is a fragment - mark for removal
      fragmentIndices.add(i);

      // Add to target's fragment list
      if (!targetFragments.has(targetIdx)) {
        targetFragments.set(targetIdx, []);
      }
      targetFragments.get(targetIdx).push({
        word: current.word,
        startTime: current.startTime,
        endTime: current.endTime
      });
    }
  }

  // Also check for full word repetitions (exact matches)
  // e.g., "ball ball ball" - all but last are fragments
  for (let i = 0; i < group.length - 1; i++) {
    if (fragmentIndices.has(i)) continue;

    const current = group[i];
    const currentLower = (current.word || '').toLowerCase();

    // Look for later exact match
    for (let j = i + 1; j < group.length; j++) {
      const candidate = group[j];
      if ((candidate.word || '').toLowerCase() === currentLower) {
        // This is a repetition - mark current as fragment of later occurrence
        fragmentIndices.add(i);
        if (!targetFragments.has(j)) {
          targetFragments.set(j, []);
        }
        targetFragments.get(j).push({
          word: current.word,
          startTime: current.startTime,
          endTime: current.endTime
        });
        break; // Move to next word
      }
    }
  }

  // Build processed words array (excluding fragments)
  const processedWords = [];
  for (let i = 0; i < group.length; i++) {
    if (fragmentIndices.has(i)) continue; // Skip fragments

    const word = { ...group[i] };
    const fragments = targetFragments.get(i) || [];

    // Compute metrics including fragments + this word
    const allAttempts = [...fragments, { word: word.word, startTime: word.startTime, endTime: word.endTime }];
    const attempts = allAttempts.length;

    if (attempts >= 2) {
      // Compute full metrics
      const metrics = computeDisfluencyMetrics(allAttempts.map((f) => ({
        word: f.word,
        startTime: f.startTime,
        endTime: f.endTime
      })));

      word.attempts = attempts;
      word.severity = calculateSeverity(attempts, metrics?.totalDuration || 0, metrics?.maxPause || 0);
      word._disfluency = {
        maxPause: metrics?.maxPause || 0,
        totalDuration: metrics?.totalDuration || 0,
        fragments: fragments
      };
    } else {
      // Clean read
      word.attempts = 1;
      word.severity = SEVERITY_LEVELS.NONE;
      // No _disfluency object for clean reads
    }

    processedWords.push(word);
  }

  return {
    processedWords,
    fragmentsRemoved: fragmentIndices.size
  };
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

/**
 * Main disfluency detection function.
 * Processes words to detect stutters, merge fragments, and classify severity.
 *
 * Pipeline order: Call AFTER filterGhosts(), BEFORE alignment.
 *
 * @param {Array} words - Classified words (from filterGhosts output)
 * @returns {object} { words: processedWords, summary: _disfluencySummary, fragmentsRemoved }
 */
export function detectDisfluencies(words) {
  if (!words || words.length === 0) {
    return {
      words: [],
      summary: computeDisfluencySummary([]),
      fragmentsRemoved: 0
    };
  }

  // Step 1: Group words by temporal proximity
  const groups = groupStutterEvents(words);

  // Step 2: Process each group for stutters
  const allProcessed = [];
  let totalFragmentsRemoved = 0;

  for (const group of groups) {
    const { processedWords, fragmentsRemoved } = processStutterGroup(group);
    allProcessed.push(...processedWords);
    totalFragmentsRemoved += fragmentsRemoved;
  }

  // Step 3: Compute summary
  const summary = computeDisfluencySummary(allProcessed);

  return {
    words: allProcessed,
    summary: summary,
    fragmentsRemoved: totalFragmentsRemoved
  };
}
