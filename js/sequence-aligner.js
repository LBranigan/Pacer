/**
 * Sequence alignment using Needleman-Wunsch algorithm.
 * Compares v=1.0 (verbatim) against v=0.0 (clean) Reverb transcripts.
 *
 * Pipeline: Reverb /ensemble -> sequence-aligner.js -> disfluency-tagger.js
 *
 * The algorithm finds the optimal global alignment between two word sequences,
 * identifying insertions (disfluencies in verbatim), deletions (words missing
 * from verbatim), matches, and mismatches.
 *
 * Uses asymmetric gap penalties: insertions (disfluencies) are expected and
 * cheaper (-1) than deletions (rare, -2) to bias toward finding disfluencies.
 */

// Scoring parameters - tuned for disfluency detection
const DEFAULT_OPTIONS = {
  match: 2,
  mismatch: -1,
  gapInsert: -1,   // Insertion = disfluency in verbatim (expected, cheaper)
  gapDelete: -2    // Deletion = missing from verbatim (rare, penalize more)
};

/**
 * Normalize a word for comparison (lowercase, strip punctuation).
 * Preserves apostrophes and hyphens within words.
 *
 * @param {string} word - Word to normalize
 * @returns {string} Normalized word
 */
function normalizeWord(word) {
  if (!word) return '';
  return word.toLowerCase().replace(/[^a-z'-]/g, '');
}

/**
 * Core Needleman-Wunsch dynamic programming algorithm.
 *
 * @param {string[]} verbatim - Words from v=1.0 transcript
 * @param {string[]} clean - Words from v=0.0 transcript
 * @param {object} options - Scoring parameters
 * @returns {{ alignment: object[], score: number }} Alignment result
 */
function needlemanWunsch(verbatim, clean, options) {
  const { match, mismatch, gapInsert, gapDelete } = options;

  const m = verbatim.length;
  const n = clean.length;

  // Initialize scoring matrix F and pointer matrix P
  const F = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  const P = Array(m + 1).fill(null).map(() => Array(n + 1).fill(null));

  // Fill first column with cumulative insertion penalties
  for (let i = 1; i <= m; i++) {
    F[i][0] = F[i - 1][0] + gapInsert;
    P[i][0] = 'up';
  }

  // Fill first row with cumulative deletion penalties
  for (let j = 1; j <= n; j++) {
    F[0][j] = F[0][j - 1] + gapDelete;
    P[0][j] = 'left';
  }

  // Fill rest of matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const verbatimWord = normalizeWord(verbatim[i - 1]);
      const cleanWord = normalizeWord(clean[j - 1]);

      const scoreDiag = F[i - 1][j - 1] + (verbatimWord === cleanWord ? match : mismatch);
      const scoreUp = F[i - 1][j] + gapInsert;   // Insert verbatim word (disfluency)
      const scoreLeft = F[i][j - 1] + gapDelete; // Delete clean word (rare)

      const maxScore = Math.max(scoreDiag, scoreUp, scoreLeft);
      F[i][j] = maxScore;

      // Set pointer for traceback (prefer diagonal for ties to minimize gaps)
      if (maxScore === scoreDiag) {
        P[i][j] = 'diag';
      } else if (maxScore === scoreUp) {
        P[i][j] = 'up';
      } else {
        P[i][j] = 'left';
      }
    }
  }

  // Traceback from bottom-right to top-left
  const alignment = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && P[i][j] === 'diag') {
      const verbatimWord = verbatim[i - 1];
      const cleanWord = clean[j - 1];
      alignment.unshift({
        verbatim: verbatimWord,
        clean: cleanWord,
        type: normalizeWord(verbatimWord) === normalizeWord(cleanWord) ? 'match' : 'mismatch'
      });
      i--;
      j--;
    } else if (i > 0 && (j === 0 || P[i][j] === 'up')) {
      // Insertion: word in verbatim but not in clean = DISFLUENCY
      alignment.unshift({
        verbatim: verbatim[i - 1],
        clean: null,
        type: 'insertion'
      });
      i--;
    } else {
      // Deletion: word in clean but not in verbatim (rare with Reverb)
      alignment.unshift({
        verbatim: null,
        clean: clean[j - 1],
        type: 'deletion'
      });
      j--;
    }
  }

  return { alignment, score: F[m][n] };
}

/**
 * Align verbatim and clean transcripts using Needleman-Wunsch global alignment.
 *
 * @param {object[]} verbatimWords - Words from v=1.0 transcript [{word, start_time, end_time}]
 * @param {object[]} cleanWords - Words from v=0.0 transcript [{word, start_time, end_time}]
 * @param {object} [options] - Optional scoring parameters
 * @param {number} [options.match=2] - Score for matching words
 * @param {number} [options.mismatch=-1] - Penalty for mismatched words
 * @param {number} [options.gapInsert=-1] - Penalty for insertion (disfluency)
 * @param {number} [options.gapDelete=-2] - Penalty for deletion
 * @returns {object[]} Alignment result with entries:
 *   - type: 'match' | 'mismatch' | 'insertion' | 'deletion'
 *   - verbatim: string | null
 *   - clean: string | null
 *   - verbatimData?: original word object with timing
 *   - cleanData?: original word object with timing
 */
export function alignTranscripts(verbatimWords, cleanWords, options = {}) {
  // Edge case: both empty
  if (!verbatimWords?.length && !cleanWords?.length) {
    return [];
  }

  // Edge case: verbatim empty - all clean words are deletions
  if (!verbatimWords?.length) {
    return cleanWords.map(w => ({
      type: 'deletion',
      verbatim: null,
      clean: w.word,
      cleanData: w
    }));
  }

  // Edge case: clean empty - all verbatim words are insertions (disfluencies)
  if (!cleanWords?.length) {
    return verbatimWords.map(w => ({
      type: 'insertion',
      verbatim: w.word,
      clean: null,
      verbatimData: w
    }));
  }

  // Extract word strings for alignment
  const verbatim = verbatimWords.map(w => w.word);
  const clean = cleanWords.map(w => w.word);

  // Run Needleman-Wunsch alignment
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const { alignment } = needlemanWunsch(verbatim, clean, mergedOptions);

  // Attach timing data to alignment entries
  let vIdx = 0;
  let cIdx = 0;

  return alignment.map(entry => {
    const result = { ...entry };

    if (entry.verbatim !== null) {
      result.verbatimData = verbatimWords[vIdx++];
    }

    if (entry.clean !== null) {
      result.cleanData = cleanWords[cIdx++];
    }

    return result;
  });
}

/**
 * Generic sequence alignment — reuses the NW core with neutral labels.
 * Used for cross-validation (Reverb vs Deepgram) where neither sequence
 * is privileged as "verbatim" or "clean".
 *
 * @param {object[]} wordsA - First word sequence [{word, ...}]
 * @param {object[]} wordsB - Second word sequence [{word, ...}]
 * @param {object} [options] - Scoring parameters (same as alignTranscripts)
 * @returns {object[]} Alignment with { type, wordA, wordB, wordAData, wordBData }
 */
export function alignSequences(wordsA, wordsB, options = {}) {
  if (!wordsA?.length && !wordsB?.length) return [];

  if (!wordsA?.length) {
    return wordsB.map(w => ({ type: 'deletion', wordA: null, wordB: w.word, wordBData: w }));
  }
  if (!wordsB?.length) {
    return wordsA.map(w => ({ type: 'insertion', wordA: w.word, wordB: null, wordAData: w }));
  }

  const stringsA = wordsA.map(w => w.word);
  const stringsB = wordsB.map(w => w.word);
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const { alignment } = needlemanWunsch(stringsA, stringsB, mergedOptions);

  let aIdx = 0;
  let bIdx = 0;

  return alignment.map(entry => {
    const result = {
      type: entry.type,
      wordA: entry.verbatim,
      wordB: entry.clean
    };
    if (entry.verbatim !== null) result.wordAData = wordsA[aIdx++];
    if (entry.clean !== null) result.wordBData = wordsB[bIdx++];
    return result;
  });
}

// ============================================================================
// Inline Tests (commented out - uncomment to verify)
// ============================================================================
/*
// Test 1: "the the cat" vs "the cat" should produce one insertion
const verbatim1 = [{word: 'the'}, {word: 'the'}, {word: 'cat'}];
const clean1 = [{word: 'the'}, {word: 'cat'}];
const result1 = alignTranscripts(verbatim1, clean1);
console.log('Test 1: "the the cat" vs "the cat"');
console.log(JSON.stringify(result1, null, 2));
// Expected: match(the), insertion(the), match(cat)
console.assert(result1.length === 3, 'Should have 3 entries');
console.assert(result1[0].type === 'match' && result1[0].verbatim === 'the', 'First should be match(the)');
console.assert(result1[1].type === 'insertion' && result1[1].verbatim === 'the', 'Second should be insertion(the)');
console.assert(result1[2].type === 'match' && result1[2].verbatim === 'cat', 'Third should be match(cat)');
console.log('Test 1 PASSED\n');

// Test 2: Both empty
const result2 = alignTranscripts([], []);
console.log('Test 2: Both empty');
console.assert(result2.length === 0, 'Should be empty');
console.log('Test 2 PASSED\n');

// Test 3: Verbatim empty
const result3 = alignTranscripts([], [{word: 'hello'}]);
console.log('Test 3: Verbatim empty');
console.assert(result3.length === 1, 'Should have 1 entry');
console.assert(result3[0].type === 'deletion', 'Should be deletion');
console.log('Test 3 PASSED\n');

// Test 4: Clean empty
const result4 = alignTranscripts([{word: 'um'}, {word: 'hello'}], []);
console.log('Test 4: Clean empty');
console.assert(result4.length === 2, 'Should have 2 entries');
console.assert(result4[0].type === 'insertion', 'First should be insertion');
console.assert(result4[1].type === 'insertion', 'Second should be insertion');
console.log('Test 4 PASSED\n');

// Test 5: Identical arrays
const result5 = alignTranscripts([{word: 'a'}, {word: 'b'}], [{word: 'a'}, {word: 'b'}]);
console.log('Test 5: Identical arrays');
console.assert(result5.length === 2, 'Should have 2 entries');
console.assert(result5[0].type === 'match', 'First should be match');
console.assert(result5[1].type === 'match', 'Second should be match');
console.log('Test 5 PASSED\n');

// Test 6: Case insensitivity
const result6 = alignTranscripts([{word: 'The'}], [{word: 'the'}]);
console.log('Test 6: Case insensitivity');
console.assert(result6.length === 1, 'Should have 1 entry');
console.assert(result6[0].type === 'match', 'Should match despite case');
console.log('Test 6 PASSED\n');

console.log('All tests passed!');
*/
