/**
 * Ensemble transcript merger with temporal word association.
 * Associates words from two STT models by timestamp overlap, not text content.
 */

const JITTER_MS = 50; // Tolerance for CTC vs Conformer timestamp drift

/**
 * Parse Google STT timestamp string to milliseconds.
 * @param {string|number} t - Timestamp like "1.400s" or number
 * @returns {number} Milliseconds
 */
function parseTimeMs(t) {
  if (typeof t === 'number') return t * 1000;
  return (parseFloat(String(t).replace('s', '')) || 0) * 1000;
}

/**
 * Check if two words have temporal overlap within jitter tolerance.
 * @param {object} word1 - Word with startTime/endTime
 * @param {object} word2 - Word with startTime/endTime
 * @param {number} jitterMs - Tolerance in milliseconds
 * @returns {boolean} True if words overlap
 */
function timeOverlap(word1, word2, jitterMs = JITTER_MS) {
  const start1 = parseTimeMs(word1.startTime);
  const end1 = parseTimeMs(word1.endTime);
  const start2 = parseTimeMs(word2.startTime) - jitterMs; // Expand word2 window
  const end2 = parseTimeMs(word2.endTime) + jitterMs;

  // Overlap exists if: max(start1, adjustedStart2) < min(end1, adjustedEnd2)
  return Math.max(start1, start2) < Math.min(end1, end2);
}

/**
 * Create a merged word structure with debug data.
 * @param {object|null} latestWord - Word from latest_long model
 * @param {object|null} defaultWord - Word from default model
 * @returns {object} Merged word with source tag and _debug
 */
function createMergedWord(latestWord, defaultWord) {
  // Determine source tag
  let source;
  if (latestWord && defaultWord) {
    source = 'both';
  } else if (latestWord) {
    source = 'latest_only';
  } else {
    source = 'default_only';
  }

  // Primary word comes from latest_long when available (better for rare words)
  const primary = latestWord || defaultWord;

  return {
    word: primary.word,
    startTime: primary.startTime,
    endTime: primary.endTime,
    confidence: primary.confidence,
    source: source,
    _debug: {
      latestLong: latestWord ? {
        word: latestWord.word,
        startTime: latestWord.startTime,
        endTime: latestWord.endTime,
        confidence: latestWord.confidence
      } : null,
      default: defaultWord ? {
        word: defaultWord.word,
        startTime: defaultWord.startTime,
        endTime: defaultWord.endTime,
        confidence: defaultWord.confidence
      } : null
    }
  };
}

/**
 * Extract words array from STT API response.
 * @param {object} sttResponse - Google STT response object
 * @returns {Array} Array of word objects
 */
export function extractWordsFromSTT(sttResponse) {
  if (!sttResponse || !sttResponse.results) return [];

  const words = [];
  for (const result of sttResponse.results) {
    const alt = result.alternatives && result.alternatives[0];
    if (alt && alt.words) {
      for (const w of alt.words) {
        words.push(w);
      }
    }
  }
  return words;
}

/**
 * Merge two STT results using temporal word association.
 * @param {object} ensembleResult - Result from sendEnsembleSTT
 * @returns {Array} Array of merged words with source tags and _debug data
 */
export function mergeEnsembleResults(ensembleResult) {
  const latestWords = extractWordsFromSTT(ensembleResult.latestLong);
  const defaultWords = extractWordsFromSTT(ensembleResult.default);

  // Handle edge cases
  if (latestWords.length === 0 && defaultWords.length === 0) {
    return [];
  }
  if (latestWords.length === 0) {
    return defaultWords.map(w => createMergedWord(null, w));
  }
  if (defaultWords.length === 0) {
    return latestWords.map(w => createMergedWord(w, null));
  }

  // Temporal word association
  const merged = [];
  const usedDefault = new Set();

  // For each latest_long word, find overlapping default word
  for (const lw of latestWords) {
    let matchedDefault = null;

    for (let i = 0; i < defaultWords.length; i++) {
      if (usedDefault.has(i)) continue;

      if (timeOverlap(lw, defaultWords[i], JITTER_MS)) {
        matchedDefault = defaultWords[i];
        usedDefault.add(i);
        break; // Take first match (words are time-ordered)
      }
    }

    merged.push(createMergedWord(lw, matchedDefault));
  }

  // Add any unmatched default words (default_only)
  for (let i = 0; i < defaultWords.length; i++) {
    if (!usedDefault.has(i)) {
      merged.push(createMergedWord(null, defaultWords[i]));
    }
  }

  // Sort by timestamp
  merged.sort((a, b) => parseTimeMs(a.startTime) - parseTimeMs(b.startTime));

  return merged;
}

/**
 * Compute statistics about the ensemble merge.
 * @param {Array} mergedWords - Result from mergeEnsembleResults
 * @returns {object} Statistics object
 */
export function computeEnsembleStats(mergedWords) {
  const stats = {
    totalWords: mergedWords.length,
    both: 0,
    latestOnly: 0,
    defaultOnly: 0,
    agreementRate: 0
  };

  for (const w of mergedWords) {
    if (w.source === 'both') stats.both++;
    else if (w.source === 'latest_only') stats.latestOnly++;
    else if (w.source === 'default_only') stats.defaultOnly++;
  }

  stats.agreementRate = stats.totalWords > 0
    ? Math.round((stats.both / stats.totalWords) * 100)
    : 0;

  return stats;
}
