/**
 * Disfluency detector - Hierarchy of Truth architecture.
 *
 * Replaces grouping-based greedy scan with single-pass, three-filter approach:
 *   Filter 1: Reference Text Protection (phonetic N-gram matching)
 *   Filter 2: Phonological Horizons (strict for fragments, loose for repetitions)
 *   Filter 3: Acoustic Confidence Veto (default model confidence >= 0.93)
 *
 * This fixes "Semantic Vacuuming" bug where valid words like "the" were
 * incorrectly removed as fragments of later words like "then".
 *
 * Pipeline order: Classify -> Filter ghosts -> Detect disfluencies -> Align
 */

import { parseTime } from './diagnostics.js';
import { DISFLUENCY_THRESHOLDS, SEVERITY_LEVELS } from './disfluency-config.js';
import { doubleMetaphone, levenshtein } from './phonetic-utils.js';

/**
 * Normalize a word for comparison (lowercase, strip punctuation).
 * @param {string} word - Word to normalize
 * @returns {string} Normalized word
 */
function normalizeWord(word) {
  if (!word) return '';
  return word.toLowerCase().replace(/[^a-z'-]/g, '');
}

/**
 * Normalize text for N-gram building.
 * @param {string} text - Text to normalize
 * @returns {string} Normalized text
 */
function normalizeText(text) {
  if (!text) return '';
  return text.toLowerCase().replace(/[^a-z' -]/g, '');
}

// ═══════════════════════════════════════════════════════════════════════════
// FILTER 1: Reference Text Anchor (Intent Filter)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build phonetic N-gram index from reference text.
 * Stores both exact strings and phonetic codes for fuzzy matching.
 *
 * @param {string} referenceText - The reference passage
 * @param {number} maxN - Maximum N-gram size (default 3)
 * @returns {{exact: Set<string>, phonetic: Map<string, string>}}
 */
function buildReferenceNgrams(referenceText, maxN = 3) {
  if (!referenceText) return { exact: new Set(), phonetic: new Map() };

  const words = normalizeText(referenceText).split(/\s+/).filter(w => w.length > 0);
  const exact = new Set();
  const phonetic = new Map();  // phoneticKey → original ngram

  for (let n = 1; n <= maxN; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      const ngram = words.slice(i, i + n);
      const ngramStr = ngram.join(' ');
      const phoneticKey = ngram.map(w => doubleMetaphone(w)).join(' ');

      exact.add(ngramStr);
      phonetic.set(phoneticKey, ngramStr);
    }
  }

  return { exact, phonetic };
}

/**
 * Check if STT words match reference using phonetic similarity.
 * Returns true if the N-gram exists in reference (exact or phonetic match).
 *
 * @param {Array<string>} sttWords - STT word strings to check
 * @param {{exact: Set, phonetic: Map}} referenceNgrams - Pre-built reference index
 * @param {number} maxPhoneticDistance - Max Levenshtein distance for phonetic match
 * @returns {{matched: boolean, type?: string, ref?: string, distance?: number}}
 */
function matchesReferencePhonetically(sttWords, referenceNgrams, maxPhoneticDistance = 1) {
  const sttNgram = sttWords.map(w => normalizeWord(w)).join(' ');
  const sttPhonetic = sttWords.map(w => doubleMetaphone(w)).join(' ');

  // Exact match
  if (referenceNgrams.exact.has(sttNgram)) {
    return { matched: true, type: 'exact', ref: sttNgram };
  }

  // Phonetic match - find closest reference N-gram
  for (const [refPhonetic, refOriginal] of referenceNgrams.phonetic) {
    const distance = levenshtein(sttPhonetic, refPhonetic);
    if (distance <= maxPhoneticDistance) {
      return { matched: true, type: 'phonetic', ref: refOriginal, distance };
    }
  }

  return { matched: false };
}

/**
 * Check if word at index is protected by reference text.
 * Checks bigrams and trigrams starting at this position.
 *
 * @param {Array} words - Array of word objects
 * @param {number} index - Index of word to check
 * @param {{exact: Set, phonetic: Map}} referenceNgrams - Pre-built reference index
 * @returns {boolean} True if word is protected by reference match
 */
function isProtectedByReference(words, index, referenceNgrams) {
  if (!referenceNgrams || referenceNgrams.exact.size === 0) return false;

  // Check unigram (single word exact match in reference)
  const unigram = [words[index].word];
  const uniMatch = matchesReferencePhonetically(unigram, referenceNgrams, 0);  // Exact only for unigrams
  if (uniMatch.matched && uniMatch.type === 'exact') {
    // Single word is in reference - but only protect if confidence is decent
    // (prevents protecting random fragments that happen to match common words)
    const conf = words[index]._debug?.default?.confidence;
    if (conf != null && conf >= 0.8) return true;
  }

  // Check bigram: [current, next]
  if (index < words.length - 1) {
    const bigram = [words[index].word, words[index + 1].word];
    const match = matchesReferencePhonetically(bigram, referenceNgrams, DISFLUENCY_THRESHOLDS.MAX_PHONETIC_DISTANCE);
    if (match.matched) return true;
  }

  // Check trigram: [current, next, next2]
  if (index < words.length - 2) {
    const trigram = [words[index].word, words[index + 1].word, words[index + 2].word];
    const match = matchesReferencePhonetically(trigram, referenceNgrams, DISFLUENCY_THRESHOLDS.MAX_PHONETIC_DISTANCE);
    if (match.matched) return true;
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// FILTER 3: Acoustic Confidence Veto
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if word is protected by high acoustic confidence.
 * Uses default model confidence (not latest_long which returns fake scores).
 *
 * @param {object} word - Word object with _debug containing model confidences
 * @returns {boolean} True if protected by high confidence
 */
function isProtectedByConfidence(word) {
  // Check default model confidence (real acoustic confidence)
  const defaultConf = word._debug?.default?.confidence;
  if (defaultConf != null && defaultConf >= DISFLUENCY_THRESHOLDS.CONFIDENCE_PROTECTION_THRESHOLD) {
    return true;
  }

  // Fallback: check merged confidence if no _debug
  if (word.confidence != null && word.confidence >= DISFLUENCY_THRESHOLDS.CONFIDENCE_PROTECTION_THRESHOLD) {
    return true;
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// FILTER 2: Phonological Horizons
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a fragment word should be merged into a target word.
 * Per CONTEXT.md merge eligibility rules:
 *   - First char must match
 *   - Short fragments (1-3 chars): must match prefix of target
 *   - Long fragments (4+ chars): must be exact match OR long prefix match
 *
 * @param {string} fragment - The potential fragment word
 * @param {string} target - The potential target word
 * @returns {boolean} True if fragment should merge into target
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

/**
 * Check for fragment at current position (STRICT: i+1 only, 500ms max).
 *
 * @param {Array} words - Array of word objects
 * @param {number} i - Current index
 * @param {Set} fragmentIndices - Set to add fragment indices to
 * @param {Map} targetFragments - Map from target index to its fragments
 * @returns {boolean} True if current word is a fragment
 */
function checkForFragment(words, i, fragmentIndices, targetFragments) {
  const current = words[i];
  const nextIdx = i + 1;

  if (nextIdx >= words.length) return false;

  const next = words[nextIdx];
  const currentEnd = parseTime(current.endTime);
  const nextStart = parseTime(next.startTime);
  const gap = nextStart - currentEnd;

  // Time limit: fragments must resolve within 500ms
  if (gap > DISFLUENCY_THRESHOLDS.FRAGMENT_MAX_TIME_GAP_SEC) return false;

  // Check if current is a prefix/fragment of next
  if (isMergeEligible(current.word, next.word)) {
    // Don't merge if words are exactly the same (that's a repetition, not fragment)
    if (normalizeWord(current.word) === normalizeWord(next.word)) return false;

    fragmentIndices.add(i);

    if (!targetFragments.has(nextIdx)) {
      targetFragments.set(nextIdx, []);
    }
    targetFragments.get(nextIdx).push({
      word: current.word,
      startTime: current.startTime,
      endTime: current.endTime,
      type: 'fragment'
    });

    return true;
  }

  return false;
}

/**
 * Check for repetition at current position (LOOSE: i+1 and i+2, 1.0s max).
 *
 * @param {Array} words - Array of word objects
 * @param {number} i - Current index
 * @param {Set} fragmentIndices - Set to add fragment indices to
 * @param {Map} targetFragments - Map from target index to its fragments
 * @returns {boolean} True if current word is a repetition
 */
function checkForRepetition(words, i, fragmentIndices, targetFragments) {
  const current = words[i];
  const currentLower = normalizeWord(current.word);
  const currentEnd = parseTime(current.endTime);

  // Search limit: i+1 and i+2
  const maxLookahead = DISFLUENCY_THRESHOLDS.REPETITION_MAX_LOOKAHEAD;
  const searchLimit = Math.min(words.length, i + 1 + maxLookahead);

  for (let j = i + 1; j < searchLimit; j++) {
    // Skip words already marked as fragments
    if (fragmentIndices.has(j)) continue;

    const candidate = words[j];
    const candidateStart = parseTime(candidate.startTime);
    const gap = candidateStart - currentEnd;

    // Time limit: repetitions within 1.0s
    if (gap > DISFLUENCY_THRESHOLDS.REPETITION_MAX_TIME_GAP_SEC) break;

    // Exact match (case-insensitive)
    if (normalizeWord(candidate.word) === currentLower) {
      fragmentIndices.add(i);

      if (!targetFragments.has(j)) {
        targetFragments.set(j, []);
      }
      targetFragments.get(j).push({
        word: current.word,
        startTime: current.startTime,
        endTime: current.endTime,
        type: 'repetition'
      });

      return true;
    }
  }

  return false;
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
 * Main disfluency detection function using Hierarchy of Truth architecture.
 *
 * Single-pass algorithm:
 *   For each word:
 *     → Filter 1: Is it protected by reference text? (N-gram with phonetic matching)
 *     → Filter 2: Does it pass phonological horizon rules? (distance + time limits)
 *     → Filter 3: Is it protected by acoustic confidence? (default model ≥ 0.93)
 *
 *   Only mark as fragment if it passes ALL filters AND matches a target.
 *
 * @param {Array} words - Classified words (from filterGhosts output)
 * @param {string} referenceText - Reference passage for protection matching
 * @returns {object} { words: processedWords, summary: _disfluencySummary, fragmentsRemoved }
 */
export function detectDisfluencies(words, referenceText = '') {
  if (!words || words.length === 0) {
    return {
      words: [],
      summary: computeDisfluencySummary([]),
      fragmentsRemoved: 0
    };
  }

  // Pre-build reference N-grams with phonetic index
  const referenceNgrams = buildReferenceNgrams(referenceText);

  const fragmentIndices = new Set();
  const targetFragments = new Map();  // targetIndex → array of fragment info

  // Single pass through all words
  for (let i = 0; i < words.length; i++) {
    const current = words[i];

    // Skip if already marked as fragment
    if (fragmentIndices.has(i)) continue;

    // ─────────────────────────────────────────────
    // FILTER 1: Reference Text Protection (Phonetic)
    // ─────────────────────────────────────────────
    if (isProtectedByReference(words, i, referenceNgrams)) {
      continue;  // Protected - skip fragment detection
    }

    // ─────────────────────────────────────────────
    // FILTER 3: Acoustic Confidence Veto
    // (Checked before Filter 2 for efficiency)
    // ─────────────────────────────────────────────
    if (isProtectedByConfidence(current)) {
      continue;  // High confidence - real word, not fragment
    }

    // ─────────────────────────────────────────────
    // FILTER 2A: Fragment Detection (STRICT)
    // Only check i+1, within 500ms
    // ─────────────────────────────────────────────
    if (checkForFragment(words, i, fragmentIndices, targetFragments)) {
      continue;
    }

    // ─────────────────────────────────────────────
    // FILTER 2B: Repetition Detection (LOOSE)
    // Check i+1 and i+2, within 1.0s
    // ─────────────────────────────────────────────
    checkForRepetition(words, i, fragmentIndices, targetFragments);
  }

  // Build processed words array (excluding fragments)
  const processedWords = [];

  for (let i = 0; i < words.length; i++) {
    if (fragmentIndices.has(i)) continue;  // Skip fragments

    const word = { ...words[i] };
    const fragments = targetFragments.get(i) || [];

    // Compute metrics including fragments + this word
    const allAttempts = [
      ...fragments,
      { word: word.word, startTime: word.startTime, endTime: word.endTime }
    ];
    const attempts = allAttempts.length;

    if (attempts >= 2) {
      const metrics = computeDisfluencyMetrics(allAttempts.map(f => ({
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
    }

    processedWords.push(word);
  }

  // Compute summary
  const summary = computeDisfluencySummary(processedWords);

  return {
    words: processedWords,
    summary: summary,
    fragmentsRemoved: fragmentIndices.size
  };
}

// Legacy exports for backward compatibility
export { isMergeEligible };
