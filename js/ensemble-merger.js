/**
 * Ensemble transcript merger with two-pass word association.
 *
 * ============================================================================
 * ALGORITHM: Two-Pass String Alignment
 * ============================================================================
 * - Pass 1 (Semantic Anchoring): Match identical words within 500ms temporal window
 * - Pass 2 (Temporal Scavenging): Match remaining words by timestamp overlap
 *
 * ============================================================================
 * TRUST HIERARCHY (based on Google STT research - see docs/google-stt-models-research.md)
 * ============================================================================
 * - Word text: latest_long (better vocabulary, rare words, proper nouns)
 * - Timestamps: default (more accurate acoustic boundaries)
 * - Confidence: default (only reliable source - latest_long returns fake scores)
 *
 * ============================================================================
 * REFERENCE VETO (when models disagree on word text at SAME timestamp)
 * ============================================================================
 * Applies when: source === 'both' AND latestWord.word !== defaultWord.word
 *
 * - If default's word matches reference AND latest's doesn't → use default
 * - If neither matches reference → use latest_long (legitimate substitution)
 * - Fixes: latest_long's Conformer hallucinations ("Hefty" vs "happy")
 *
 * IMPORTANT: Reference Veto does NOT apply to latest_only words!
 * - latest_only = word detected by latest_long but NOT by default model
 * - These might be: real words default missed, OR hallucinations
 * - Ghost detection (ghost-detector.js) handles latest_only words separately
 *   by checking VAD speech overlap
 * - If you see an extra word appearing as an insertion, check:
 *   1. Is it latest_only? → Ghost detection should handle it
 *   2. Is it source='both' with disagreement? → Reference Veto handles it
 *
 * ============================================================================
 */

// Configuration constants
const JITTER_MS = 50; // Tolerance for timestamp overlap matching
const MIN_WORD_DURATION_MS = 10; // Minimum duration to be considered real speech
const SEMANTIC_WINDOW_MS = 500; // Maximum gap for semantic (exact word) matching
const MAX_POSITION_DRIFT = 7; // Maximum sequence position difference for semantic matching

// Deduplication and prefix absorption constants
const MAX_PREFIX_GAP_MS = 3000; // Maximum gap for absorbing morphological prefixes (3 seconds)

// Common morphological prefixes that students may sound out separately
// When a student says "un...nerved", we should absorb "un" into "unnerved"
const MORPHOLOGICAL_PREFIXES = new Set([
  'un', 're', 'pre', 'dis', 'mis', 'non', 'de', 'in', 'im', 'ir', 'il',
  'over', 'under', 'out', 'sub', 'super', 'anti', 'auto', 'bi', 'co',
  'ex', 'extra', 'hyper', 'inter', 'micro', 'mid', 'mini', 'mono',
  'multi', 'neo', 'post', 'pro', 'semi', 'trans', 'tri', 'ultra'
]);

// Debug logging flag - set to true for verbose output
const DEBUG_LOGGING = true;

// Reference-aware word selection - cached reference word set
let cachedReferenceSet = null;

/**
 * Log debug messages if DEBUG_LOGGING is enabled.
 * @param  {...any} args - Arguments to log
 */
function debugLog(...args) {
  if (DEBUG_LOGGING) {
    console.log('[ensemble-merger]', ...args);
  }
}

/**
 * Normalize a word for reference comparison.
 *
 * Used by Reference Veto logic to compare words regardless of:
 * - Case differences ("The" vs "the")
 * - Trailing punctuation ("dog." vs "dog")
 *
 * @param {string} word - Word to normalize
 * @returns {string} Normalized word (lowercase, no punctuation)
 *
 * @example
 * normalizeWord("Hello,") // "hello"
 * normalizeWord("DOG")    // "dog"
 * normalizeWord("it's")   // "its"
 */
function normalizeWord(word) {
  // Lowercase for case-insensitive comparison
  // Strip common punctuation that may differ between STT output and reference
  return word.toLowerCase().replace(/[.,!?;:'"()-]/g, '');
}

/**
 * Build a Set of normalized words from reference text.
 *
 * This Set is used by Reference Veto to quickly check if a word
 * appears in the original passage the student was reading.
 *
 * @param {string} referenceText - The reference passage (from textarea)
 * @returns {Set<string>} Set of normalized words for O(1) lookup
 *
 * @example
 * buildReferenceSet("The cat sat.") // Set { "the", "cat", "sat" }
 */
function buildReferenceSet(referenceText) {
  // Handle missing or invalid input
  if (!referenceText || typeof referenceText !== 'string') {
    return new Set();
  }
  // Split on whitespace, filter empty strings, normalize each word
  const words = referenceText.split(/\s+/).filter(w => w.length > 0);
  return new Set(words.map(normalizeWord));
}

/**
 * Check if a word is in the reference text (exact match after normalization).
 *
 * This is the core lookup used by Reference Veto logic.
 * Returns true if the normalized word exists anywhere in the reference passage.
 *
 * Note: This is an EXACT match after normalization, not fuzzy/phonetic matching.
 * "house" will NOT match "home" even if they sound similar.
 *
 * @param {string} word - Word to check (from STT output)
 * @param {Set<string>} referenceSet - Set of normalized reference words
 * @returns {boolean} True if word is in reference
 *
 * @example
 * const ref = buildReferenceSet("The happy dog");
 * isInReference("happy", ref)  // true
 * isInReference("Happy", ref)  // true (case-insensitive)
 * isInReference("Hefty", ref)  // false
 */
function isInReference(word, referenceSet) {
  // If no reference provided, can't do lookup - return false
  if (!referenceSet || referenceSet.size === 0) return false;
  // Normalize the word and check Set membership (O(1) lookup)
  return referenceSet.has(normalizeWord(word));
}

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
 * Format milliseconds as seconds string for logging.
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted string like "1.40s"
 */
function formatTime(ms) {
  return (ms / 1000).toFixed(2) + 's';
}

/**
 * Check if a word is a phantom insertion (zero or near-zero duration).
 * latest_long can produce language model insertions with no acoustic basis.
 * @param {object} word - Word with startTime/endTime
 * @returns {boolean} True if word appears to be a phantom
 */
function isPhantomWord(word) {
  const duration = parseTimeMs(word.endTime) - parseTimeMs(word.startTime);
  return duration < MIN_WORD_DURATION_MS;
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
 * Find the best matching default word for a latest_long word using two-pass algorithm.
 *
 * Pass 1 (Semantic Anchoring): Look for exact word match within temporal window
 * Pass 2 (Temporal Scavenging): Fall back to timestamp overlap
 *
 * @param {object} latestWord - Word from latest_long model
 * @param {number} latestIdx - Index of the word in latest_long array
 * @param {Array} defaultWords - Array of words from default model
 * @param {Set} usedIndices - Set of already-matched default word indices
 * @returns {object|null} Match result with index and match type, or null
 */
function findBestMatch(latestWord, latestIdx, defaultWords, usedIndices) {
  const latestStart = parseTimeMs(latestWord.startTime);
  const latestEnd = parseTimeMs(latestWord.endTime);
  const latestText = latestWord.word.toLowerCase();

  // PASS 1: Semantic Anchoring - exact word match within temporal window
  for (let i = 0; i < defaultWords.length; i++) {
    if (usedIndices.has(i)) continue;

    const defaultWord = defaultWords[i];
    const defaultStart = parseTimeMs(defaultWord.startTime);
    const defaultText = defaultWord.word.toLowerCase();

    // Check if words are identical
    if (latestText !== defaultText) continue;

    // Check temporal proximity (start-to-start distance within window)
    const temporalGap = Math.abs(latestStart - defaultStart);
    if (temporalGap > SEMANTIC_WINDOW_MS) continue;

    // Check position proximity (prevent cross-sentence matching)
    const positionDiff = Math.abs(latestIdx - i);
    if (positionDiff > MAX_POSITION_DRIFT) continue;

    // Found a semantic anchor!
    debugLog(
      `PASS1 MATCH: "${latestWord.word}"[${latestIdx}] ↔ "${defaultWord.word}"[${i}]`,
      `| gap=${temporalGap}ms, posDiff=${positionDiff}`,
      `| latest=${formatTime(latestStart)}-${formatTime(latestEnd)}`,
      `| default=${formatTime(defaultStart)}-${formatTime(parseTimeMs(defaultWord.endTime))}`
    );

    return { index: i, matchType: 'semantic' };
  }

  // -------------------------------------------------------------------------
  // PASS 1.5: Extended Semantic - same word with temporal overlap
  // -------------------------------------------------------------------------
  // Catches cases where the same word appears in both models but with timestamps
  // outside the 500ms semantic window (e.g., 600ms apart).
  // This MUST run before Pass 2 to prevent wrong matches like:
  //   latest "his" (5.0-5.8) matching default "to" (5.0-5.6) instead of
  //   default "his" (5.6-5.8) which is the correct same-word match.
  // -------------------------------------------------------------------------
  for (let i = 0; i < defaultWords.length; i++) {
    if (usedIndices.has(i)) continue;

    const defaultWord = defaultWords[i];
    const defaultText = defaultWord.word.toLowerCase();

    // Must be the SAME word
    if (latestText !== defaultText) continue;

    // Check position proximity (prevent cross-sentence matching)
    const positionDiff = Math.abs(latestIdx - i);
    if (positionDiff > MAX_POSITION_DRIFT) continue;

    // Must have temporal overlap
    if (timeOverlap(latestWord, defaultWord, JITTER_MS)) {
      const defaultStart = parseTimeMs(defaultWord.startTime);
      const defaultEnd = parseTimeMs(defaultWord.endTime);
      const temporalGap = Math.abs(latestStart - defaultStart);

      debugLog(
        `PASS1.5 MATCH: "${latestWord.word}"[${latestIdx}] ↔ "${defaultWord.word}"[${i}]`,
        `| same word with temporal overlap (outside 500ms window)`,
        `| gap=${temporalGap}ms, posDiff=${positionDiff}`,
        `| latest=${formatTime(latestStart)}-${formatTime(latestEnd)}`,
        `| default=${formatTime(defaultStart)}-${formatTime(defaultEnd)}`
      );

      return { index: i, matchType: 'semantic_extended' };
    }
  }

  // -------------------------------------------------------------------------
  // PASS 2: Temporal Scavenging - different words with timestamp overlap
  // -------------------------------------------------------------------------
  // Only reached if no same-word match was found in Pass 1 or 1.5.
  // This handles cases where models disagree on what word was said.
  // -------------------------------------------------------------------------
  for (let i = 0; i < defaultWords.length; i++) {
    if (usedIndices.has(i)) continue;

    const defaultWord = defaultWords[i];

    if (timeOverlap(latestWord, defaultWord, JITTER_MS)) {
      const defaultStart = parseTimeMs(defaultWord.startTime);
      const defaultEnd = parseTimeMs(defaultWord.endTime);

      debugLog(
        `PASS2 MATCH: "${latestWord.word}"[${latestIdx}] ↔ "${defaultWord.word}"[${i}]`,
        `| temporal overlap (different words)`,
        `| latest=${formatTime(latestStart)}-${formatTime(latestEnd)}`,
        `| default=${formatTime(defaultStart)}-${formatTime(defaultEnd)}`
      );

      return { index: i, matchType: 'temporal' };
    }
  }

  // No match found
  debugLog(
    `NO MATCH: "${latestWord.word}"[${latestIdx}]`,
    `| latest=${formatTime(latestStart)}-${formatTime(latestEnd)}`,
    `| will be latest_only`
  );

  return null;
}

/**
 * Create a merged word structure with debug data.
 *
 * ============================================================================
 * TRUST HIERARCHY (based on Google STT research):
 * ============================================================================
 * - Word text: latest_long (Conformer model - better vocabulary, rare words, proper nouns)
 * - Timestamps: default (CTC model - more accurate acoustic boundaries)
 * - Confidence: default (only reliable source - latest_long returns fake 0.9+ scores)
 *
 * ============================================================================
 * REFERENCE VETO - "Fuzzy Matching Refinement"
 * ============================================================================
 * Problem: latest_long's Conformer model sometimes hallucinates similar-sounding words.
 *          Example: Student says "happy" → latest_long hears "Hefty"
 *                   Student says "tended" → latest_long hears "attended"
 *
 * Solution: When models DISAGREE on word text, use reference as tie-breaker:
 *
 *   Case 1: Default matches reference, latest doesn't → VETO (use default)
 *           - latest_long hallucinated; default heard it correctly
 *           - Example: ref="happy", default="happy", latest="Hefty" → use "happy"
 *
 *   Case 2: Latest matches reference, default doesn't → use latest (normal)
 *           - latest_long's better vocabulary got it right
 *           - Example: ref="Hermione", default="her money", latest="Hermione" → use "Hermione"
 *
 *   Case 3: NEITHER matches reference → use latest_long (NO VETO)
 *           - This is the "fuzzy refinement" - student made a legitimate substitution
 *           - Neither model's word is in the book, so student said something different
 *           - Trust latest_long's better vocabulary for the substituted word
 *           - Example: ref="home", default="house", latest="house" → use "house"
 *             (Student said "house" instead of "home" - that's their error, not STT's)
 *
 *   Case 4: BOTH match reference → use latest_long (rare)
 *           - Both words exist in reference (e.g., "the" appears multiple times)
 *           - Default to latest_long's vocabulary
 *
 * Why "Fuzzy"? Because we're NOT doing fuzzy string matching between words.
 * Instead, we're using reference membership as a binary signal to break ties.
 * The "fuzziness" is in knowing when NOT to veto - legitimate errors should
 * use latest_long's superior vocabulary, not be incorrectly "corrected" to
 * a reference word that the student didn't actually say.
 *
 * ============================================================================
 *
 * @param {object|null} latestWord - Word from latest_long model
 * @param {object|null} defaultWord - Word from default model
 * @param {string|null} matchType - How the match was made: 'semantic', 'temporal', or null
 * @param {Set|null} referenceSet - Set of normalized reference words (optional)
 * @returns {object} Merged word with source tag and _debug
 */
function createMergedWord(latestWord, defaultWord, matchType = null, referenceSet = null) {
  // -------------------------------------------------------------------------
  // STEP 1: Determine source tag (for debugging and stats)
  // -------------------------------------------------------------------------
  let source;
  if (latestWord && defaultWord) {
    source = 'both';        // Both models detected a word at this time
  } else if (latestWord) {
    source = 'latest_only'; // Only latest_long detected this word
  } else {
    source = 'default_only'; // Only default model detected this word
  }

  // -------------------------------------------------------------------------
  // STEP 2: Apply trust hierarchy based on what's available
  // -------------------------------------------------------------------------
  let word, startTime, endTime, confidence;
  let referenceVetoApplied = false;
  let vetoReason = null;

  if (latestWord && defaultWord) {
    // -----------------------------------------------------------------------
    // CASE: BOTH models detected something at this timestamp
    // -----------------------------------------------------------------------
    // Always use default's timestamps (more accurate acoustic boundaries)
    startTime = defaultWord.startTime;
    endTime = defaultWord.endTime;
    // Always use default's confidence (latest_long's scores are fake)
    confidence = defaultWord.confidence;

    // Normalize both words for comparison (lowercase, strip punctuation)
    const latestText = normalizeWord(latestWord.word);
    const defaultText = normalizeWord(defaultWord.word);

    if (latestText === defaultText) {
      // -------------------------------------------------------------------
      // Models AGREE on word text
      // -------------------------------------------------------------------
      // Use latest_long's version (may have better casing like "iPhone")
      word = latestWord.word;
    } else {
      // -------------------------------------------------------------------
      // Models DISAGREE on word text - apply Reference Veto logic
      // -------------------------------------------------------------------
      // Check if each model's word appears in the reference passage
      const latestInRef = referenceSet && isInReference(latestWord.word, referenceSet);
      const defaultInRef = referenceSet && isInReference(defaultWord.word, referenceSet);

      if (defaultInRef && !latestInRef) {
        // -----------------------------------------------------------------
        // CASE 1: REFERENCE VETO
        // Default's word is in reference, latest_long's is not
        // latest_long likely hallucinated a similar-sounding word
        // -----------------------------------------------------------------
        word = defaultWord.word;
        referenceVetoApplied = true;
        vetoReason = `default "${defaultWord.word}" in reference, latest "${latestWord.word}" not`;
        debugLog(
          `REFERENCE VETO: Using default "${defaultWord.word}" instead of latest "${latestWord.word}"`,
          `| default in ref: ${defaultInRef}, latest in ref: ${latestInRef}`
        );
      } else if (latestInRef && !defaultInRef) {
        // -----------------------------------------------------------------
        // CASE 2: Latest matches reference, default doesn't
        // latest_long's superior vocabulary got it right (e.g., proper nouns)
        // -----------------------------------------------------------------
        word = latestWord.word;
        debugLog(
          `Reference confirms latest: "${latestWord.word}" (default "${defaultWord.word}" not in ref)`
        );
      } else {
        // -----------------------------------------------------------------
        // CASE 3 & 4: Neither matches OR both match reference
        // Use latest_long (default trust hierarchy for vocabulary)
        //
        // IMPORTANT: This is the "fuzzy refinement" - when NEITHER word is
        // in the reference, the student made a legitimate substitution.
        // We should NOT veto in this case - trust latest_long's vocabulary
        // to accurately capture what the student actually said.
        //
        // Example: Reference says "home", student says "house"
        //          - default hears "house", latest hears "house"
        //          - Neither "house" is in reference → NO VETO
        //          - Use "house" (what student said, not "home")
        // -----------------------------------------------------------------
        word = latestWord.word;
        if (!latestInRef && !defaultInRef) {
          debugLog(
            `Neither in reference: latest "${latestWord.word}", default "${defaultWord.word}"`,
            `| using latest (legitimate substitution - student said something not in book)`
          );
        }
        // If both match, it's a common word like "the" - just use latest
      }
    }
  } else if (latestWord) {
    // -----------------------------------------------------------------------
    // CASE: LATEST_ONLY - only latest_long detected this word
    // -----------------------------------------------------------------------
    // Use latest_long for everything, but mark confidence as unreliable
    word = latestWord.word;
    startTime = latestWord.startTime;
    endTime = latestWord.endTime;
    confidence = null; // Don't trust latest_long's fake confidence scores
  } else {
    // -----------------------------------------------------------------------
    // CASE: DEFAULT_ONLY - only default model detected this word
    // -----------------------------------------------------------------------
    // Use default for everything (confidence is reliable)
    word = defaultWord.word;
    startTime = defaultWord.startTime;
    endTime = defaultWord.endTime;
    confidence = defaultWord.confidence;
  }

  // -------------------------------------------------------------------------
  // STEP 3: Build and return the merged word object
  // -------------------------------------------------------------------------
  // IMPORTANT: The returned object has ONE canonical word in the `word` field.
  // This is the ONLY word that should be used for alignment and miscue detection.
  // The _debug data contains raw model outputs for debugging ONLY - these should
  // NEVER be treated as separate words or create additional miscues.
  // -------------------------------------------------------------------------
  return {
    // The canonical word to use for alignment/display (after trust hierarchy + veto)
    word,
    // Timestamps from default model (more accurate acoustic boundaries)
    startTime,
    endTime,
    // Confidence from default model (only reliable source)
    confidence,
    // Where the word came from: 'both', 'latest_only', or 'default_only'
    source,
    // Debug data - FOR LOGGING/INSPECTION ONLY, not for creating miscues
    _debug: {
      // How the models were matched: 'semantic', 'temporal', or null
      matchType: matchType,
      // Whether Reference Veto overrode the normal trust hierarchy
      referenceVetoApplied: referenceVetoApplied,
      // Human-readable reason for veto (if applied)
      vetoReason: vetoReason,
      // Raw latest_long output (may differ from final `word` if vetoed)
      // WARNING: This is debug info only - do NOT use latestLong.word for alignment
      // If vetoed, this word was REJECTED and should not appear as a miscue
      latestLong: latestWord ? {
        word: latestWord.word,         // Original word (may be vetoed)
        startTime: latestWord.startTime,
        endTime: latestWord.endTime
        // NOTE: latest_long confidence intentionally omitted - Google returns fake scores
      } : null,
      // Raw default model output (may differ from final `word` if latest was used)
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
 * Merge two STT results using two-pass word association.
 * @param {object} ensembleResult - Result from sendEnsembleSTT
 * @param {string} referenceText - Optional reference passage for Reference Veto logic
 * @returns {Array} Array of merged words with source tags and _debug data
 */
export function mergeEnsembleResults(ensembleResult, referenceText = '') {
  const rawLatestWords = extractWordsFromSTT(ensembleResult.latestLong);
  const defaultWords = extractWordsFromSTT(ensembleResult.default);

  // Build reference word set for Reference Veto logic
  const referenceSet = buildReferenceSet(referenceText);

  debugLog('=== ENSEMBLE MERGE START ===');
  debugLog(`latest_long: ${rawLatestWords.length} words, default: ${defaultWords.length} words`);
  if (referenceSet.size > 0) {
    debugLog(`Reference text: ${referenceSet.size} unique words for Reference Veto`);
  } else {
    debugLog('No reference text provided - Reference Veto disabled');
  }

  // Filter phantom words from latest_long (zero-duration language model insertions)
  const latestWords = rawLatestWords.filter(w => !isPhantomWord(w));
  const phantomsFiltered = rawLatestWords.length - latestWords.length;
  if (phantomsFiltered > 0) {
    const phantoms = rawLatestWords.filter(w => isPhantomWord(w));
    debugLog(`Filtered ${phantomsFiltered} phantom word(s):`, phantoms.map(p => `"${p.word}" at ${p.startTime}`).join(', '));
  }

  // Handle edge cases
  if (latestWords.length === 0 && defaultWords.length === 0) {
    debugLog('Both models returned empty results');
    return [];
  }
  if (latestWords.length === 0) {
    debugLog('latest_long empty, using all default words');
    return defaultWords.map(w => createMergedWord(null, w, null, referenceSet));
  }
  if (defaultWords.length === 0) {
    debugLog('default empty, using all latest_long words');
    return latestWords.map(w => createMergedWord(w, null, null, referenceSet));
  }

  // Log input words for debugging
  debugLog('--- latest_long words ---');
  latestWords.forEach((w, i) => {
    debugLog(`  [${i}] "${w.word}" ${w.startTime}-${w.endTime}`);
  });
  debugLog('--- default words ---');
  defaultWords.forEach((w, i) => {
    debugLog(`  [${i}] "${w.word}" ${w.startTime}-${w.endTime} (conf: ${w.confidence?.toFixed(2) || 'N/A'})`);
  });

  // Three-pass word association (Pass 1, 1.5, 2)
  debugLog('--- MATCHING ---');
  const merged = [];
  const usedDefault = new Set();
  const matchStats = { semantic: 0, semantic_extended: 0, temporal: 0, latestOnly: 0 };

  // For each latest_long word, find best matching default word
  for (let latestIdx = 0; latestIdx < latestWords.length; latestIdx++) {
    const lw = latestWords[latestIdx];
    const match = findBestMatch(lw, latestIdx, defaultWords, usedDefault);

    if (match) {
      usedDefault.add(match.index);
      merged.push(createMergedWord(lw, defaultWords[match.index], match.matchType, referenceSet));
      matchStats[match.matchType]++;
    } else {
      merged.push(createMergedWord(lw, null, null, referenceSet));
      matchStats.latestOnly++;
    }
  }

  // Add any unmatched default words (default_only)
  const unmatchedDefault = [];
  for (let i = 0; i < defaultWords.length; i++) {
    if (!usedDefault.has(i)) {
      unmatchedDefault.push({ index: i, word: defaultWords[i] });
      merged.push(createMergedWord(null, defaultWords[i], null, referenceSet));
    }
  }

  if (unmatchedDefault.length > 0) {
    debugLog(`--- UNMATCHED DEFAULT (${unmatchedDefault.length}) ---`);
    unmatchedDefault.forEach(({ index, word }) => {
      debugLog(`  [${index}] "${word.word}" ${word.startTime}-${word.endTime} → default_only`);
    });
  }

  // Sort by timestamp
  merged.sort((a, b) => parseTimeMs(a.startTime) - parseTimeMs(b.startTime));

  // -------------------------------------------------------------------------
  // POST-MERGE PROCESSING
  // -------------------------------------------------------------------------

  // Step 5: Deduplicate consecutive identical words
  // Fixes "went went" from large timestamp drift between models
  const beforeDedup = merged.length;
  let processed = deduplicateConsecutiveWords(merged);
  const dedupRemoved = beforeDedup - processed.length;

  // Step 6: Absorb morphological prefixes
  // Fixes "un" being counted as insertion when student says "un...nerved"
  const beforeAbsorb = processed.length;
  processed = absorbMorphologicalPrefixes(processed);
  const prefixesAbsorbed = beforeAbsorb - processed.length;

  // Count Reference Veto applications
  const referenceVetoCount = processed.filter(w => w._debug?.referenceVetoApplied).length;
  const morphBreakCount = processed.filter(w => w._debug?.morphologicalBreak).length;

  // Log summary
  debugLog('--- MERGE SUMMARY ---');
  debugLog(`Total merged words: ${processed.length} (after post-processing)`);
  debugLog(`  Semantic matches (Pass 1): ${matchStats.semantic}`);
  debugLog(`  Semantic extended (Pass 1.5): ${matchStats.semantic_extended}`);
  debugLog(`  Temporal matches (Pass 2): ${matchStats.temporal}`);
  debugLog(`  latest_only: ${matchStats.latestOnly}`);
  debugLog(`  default_only: ${unmatchedDefault.length}`);
  if (dedupRemoved > 0) {
    debugLog(`  Duplicates removed: ${dedupRemoved}`);
  }
  if (prefixesAbsorbed > 0) {
    debugLog(`  Prefixes absorbed: ${prefixesAbsorbed}`);
  }
  if (referenceVetoCount > 0) {
    debugLog(`  Reference Veto applied: ${referenceVetoCount} word(s)`);
    processed.filter(w => w._debug?.referenceVetoApplied).forEach(w => {
      debugLog(`    → "${w.word}" (${w._debug.vetoReason})`);
    });
  }
  if (morphBreakCount > 0) {
    debugLog(`  Morphological breaks: ${morphBreakCount} word(s)`);
    processed.filter(w => w._debug?.morphologicalBreak).forEach(w => {
      const mb = w._debug.morphologicalBreak;
      debugLog(`    → "${mb.prefix}" + "${w.word}" (gapMs=${mb.gapMs})`);
    });
  }
  debugLog('=== ENSEMBLE MERGE END ===');

  return processed;
}

// ═══════════════════════════════════════════════════════════════════════════
// POST-MERGE PROCESSING: Deduplication and Prefix Absorption
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deduplicate consecutive identical words caused by timestamp drift.
 *
 * Problem: When models have large timestamp drift (e.g., 1.3 seconds), the same
 * word can appear twice in the merged output:
 *   - latest_only "went" at 5.0s (no default match found)
 *   - default_only "went" at 6.3s (no latest match found)
 *
 * Solution: After merging, scan for consecutive identical words and keep only
 * the one with better timing (prefer default model's timestamps).
 *
 * @param {Array} words - Merged words array (already sorted by timestamp)
 * @returns {Array} Deduplicated words array
 */
function deduplicateConsecutiveWords(words) {
  if (words.length <= 1) return words;

  const result = [];
  let i = 0;

  while (i < words.length) {
    const current = words[i];
    const currentText = normalizeWord(current.word);

    // Look ahead for consecutive identical words
    let j = i + 1;
    while (j < words.length && normalizeWord(words[j].word) === currentText) {
      j++;
    }

    // If we found duplicates (j > i + 1), pick the best one
    if (j > i + 1) {
      const duplicates = words.slice(i, j);

      // Prefer source='both' > 'default_only' > 'latest_only'
      // (Both has verified match; default_only has real confidence; latest_only may hallucinate)
      const ranked = duplicates.sort((a, b) => {
        const sourceOrder = { 'both': 0, 'default_only': 1, 'latest_only': 2 };
        return (sourceOrder[a.source] ?? 3) - (sourceOrder[b.source] ?? 3);
      });

      const kept = ranked[0];
      const removed = ranked.slice(1);

      debugLog(
        `DEDUP: Kept "${kept.word}" (source=${kept.source}) at ${formatTime(parseTimeMs(kept.startTime))}`,
        `| Removed ${removed.length} duplicate(s):`,
        removed.map(w => `"${w.word}" (${w.source}) at ${formatTime(parseTimeMs(w.startTime))}`).join(', ')
      );

      // Add dedup debug info to kept word
      kept._debug = kept._debug || {};
      kept._debug.deduplication = {
        removedCount: removed.length,
        removedSources: removed.map(w => w.source)
      };

      result.push(kept);
      i = j;
    } else {
      // No duplicate, keep as-is
      result.push(current);
      i++;
    }
  }

  return result;
}

/**
 * Absorb morphological prefixes that were sounded out separately.
 *
 * Problem: When a student sounds out a word like "un...nerved", the default model
 * may split it into two words: "un" (prefix) + "nerved" (rest).
 * The "un" becomes default_only and gets flagged as an insertion, penalizing
 * the student for correct morphological decoding.
 *
 * Solution: Detect prefix patterns and absorb them into the following word:
 *   1. Current word is a known morphological prefix (un, re, dis, etc.)
 *   2. Next word starts with that prefix or forms a valid compound
 *   3. Gap between them is within MAX_PREFIX_GAP_MS (3 seconds)
 *
 * UI behavior: Mark the absorbed word with morphologicalBreak flag for
 * display with squiggly underline (not an error, just indicates sounding out).
 *
 * @param {Array} words - Merged words array (already sorted by timestamp)
 * @returns {Array} Words with prefixes absorbed
 */
function absorbMorphologicalPrefixes(words) {
  if (words.length <= 1) return words;

  const result = [];
  let i = 0;

  while (i < words.length) {
    const current = words[i];
    const currentText = normalizeWord(current.word);

    // Check if current word is a morphological prefix
    if (MORPHOLOGICAL_PREFIXES.has(currentText) && i + 1 < words.length) {
      const next = words[i + 1];
      const nextText = normalizeWord(next.word);

      // Calculate gap using default model's timestamps (more accurate)
      const currentEndMs = parseTimeMs(current.endTime);
      const nextStartMs = parseTimeMs(next.startTime);
      const gapMs = nextStartMs - currentEndMs;

      // Check if next word starts with the prefix (e.g., "nerved" after "un")
      // OR if concatenating them forms a word starting with the prefix
      const concatenated = currentText + nextText;
      const nextStartsWithPrefix = nextText.startsWith(currentText);
      const formsCompound = concatenated.length > currentText.length;

      if (gapMs <= MAX_PREFIX_GAP_MS && gapMs >= 0 && (nextStartsWithPrefix || formsCompound)) {
        debugLog(
          `PREFIX ABSORB: "${current.word}" + "${next.word}" → absorbed`,
          `| gapMs=${gapMs.toFixed(0)}, prefix="${currentText}"`,
          `| current source=${current.source}, next source=${next.source}`
        );

        // Create absorbed version of next word with morphological break marker
        const absorbed = { ...next };
        absorbed._debug = absorbed._debug || {};
        absorbed._debug.morphologicalBreak = {
          prefix: current.word,
          gapMs: Math.round(gapMs),
          prefixSource: current.source,
          prefixStartTime: current.startTime,
          prefixEndTime: current.endTime
        };

        // Extend start time to include prefix pronunciation
        absorbed.startTime = current.startTime;

        result.push(absorbed);
        i += 2; // Skip both current (prefix) and next (absorbed into)
        continue;
      }
    }

    // Not a prefix or no valid absorption target
    result.push(current);
    i++;
  }

  return result;
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
    semanticMatches: 0,
    semanticExtendedMatches: 0,
    temporalMatches: 0,
    referenceVetoCount: 0,
    duplicatesRemoved: 0,
    morphologicalBreaks: 0,
    agreementRate: 0
  };

  for (const w of mergedWords) {
    if (w.source === 'both') {
      stats.both++;
      if (w._debug?.matchType === 'semantic') stats.semanticMatches++;
      else if (w._debug?.matchType === 'semantic_extended') stats.semanticExtendedMatches++;
      else if (w._debug?.matchType === 'temporal') stats.temporalMatches++;
      if (w._debug?.referenceVetoApplied) stats.referenceVetoCount++;
    }
    else if (w.source === 'latest_only') stats.latestOnly++;
    else if (w.source === 'default_only') stats.defaultOnly++;

    // Track post-processing stats
    if (w._debug?.deduplication) {
      stats.duplicatesRemoved += w._debug.deduplication.removedCount;
    }
    if (w._debug?.morphologicalBreak) {
      stats.morphologicalBreaks++;
    }
  }

  stats.agreementRate = stats.totalWords > 0
    ? Math.round((stats.both / stats.totalWords) * 100)
    : 0;

  return stats;
}
