/**
 * Disfluency classification from sequence alignment.
 * Classifies insertions as: filler, repetition, false_start, unknown.
 *
 * Pipeline: sequence-aligner.js -> disfluency-tagger.js -> metrics integration
 *
 * IMPORTANT: Per clinical ORF standards, disfluencies are NOT errors.
 * They show effort to self-correct and do not count against WCPM.
 */

/**
 * Set of common speech filler words.
 * Extended from text-normalize.js DISFLUENCIES Set.
 * @type {Set<string>}
 */
export const FILLER_WORDS = new Set([
  'um', 'uh', 'er', 'ah', 'mm', 'hmm', 'hm', 'erm',
  'uh-huh', 'mhm', 'mmm'
]);

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
 * Classify a disfluency by type.
 *
 * Classification priority:
 * 1. Filler words (um, uh, er, ah, mm, hmm, etc.)
 * 2. Repetitions (same word as adjacent word in verbatim)
 * 3. False starts (short partial word followed by complete word with same prefix)
 * 4. Unknown (unclassified disfluency)
 *
 * @param {object} entry - Alignment entry with type='insertion'
 * @param {object[]} alignment - Full alignment array for context
 * @param {number} index - Position of entry in alignment
 * @returns {string} Disfluency type: 'filler' | 'repetition' | 'false_start' | 'unknown'
 */
export function classifyDisfluency(entry, alignment, index) {
  const word = normalizeWord(entry.verbatim);

  // 1. DISF-03: Filler words (um, uh, er, ah, mm, hmm)
  if (FILLER_WORDS.has(word)) {
    return 'filler';
  }

  // 2. DISF-04: Repetitions (consecutive identical words)
  // Check if this word matches an adjacent word in the verbatim transcript
  const prevEntry = index > 0 ? alignment[index - 1] : null;
  const nextEntry = index < alignment.length - 1 ? alignment[index + 1] : null;

  // Check previous verbatim word (if this is a repeated word after the original)
  if (prevEntry && prevEntry.verbatim && normalizeWord(prevEntry.verbatim) === word) {
    return 'repetition';
  }

  // Check next verbatim word (if this is the first occurrence before a repeat)
  // Only mark as repetition if the next word is also an insertion of the same word
  if (nextEntry && nextEntry.type === 'insertion' && normalizeWord(nextEntry.verbatim) === word) {
    return 'repetition';
  }

  // 3. DISF-05: False starts (partial word followed by complete word)
  // Short word (1-3 chars) followed by longer word starting with same prefix
  if (word.length >= 1 && word.length <= 3 && nextEntry && nextEntry.verbatim) {
    const nextWord = normalizeWord(nextEntry.verbatim);
    if (nextWord.startsWith(word) && nextWord.length > word.length) {
      return 'false_start';
    }
  }

  // 4. Unknown disfluency type
  return 'unknown';
}

/**
 * Tag disfluencies in alignment result.
 * Adds disfluencyType field to each insertion entry.
 *
 * @param {object[]} alignment - From alignTranscripts()
 * @returns {object[]} Alignment with disfluencyType field on insertions
 */
export function tagDisfluencies(alignment) {
  if (!alignment || !alignment.length) {
    return [];
  }

  return alignment.map((entry, index) => {
    if (entry.type !== 'insertion') {
      return entry;
    }

    return {
      ...entry,
      disfluencyType: classifyDisfluency(entry, alignment, index)
    };
  });
}

/**
 * Calculate disfluency statistics from tagged alignment.
 *
 * CRITICAL: Per DISF-06 and DISF-07, disfluencies do NOT affect WCPM.
 * The rate calculation uses contentWords (non-disfluency words) as denominator
 * to preserve WCPM integrity.
 *
 * @param {object[]} taggedAlignment - From tagDisfluencies()
 * @returns {object} Statistics object:
 *   - total: Total disfluency count
 *   - contentWords: Word count excluding disfluencies (for WCPM)
 *   - rate: Disfluency rate as percentage string (disfluencies / contentWords)
 *   - byType: Counts by disfluency type {filler, repetition, false_start, unknown}
 */
export function computeDisfluencyStats(taggedAlignment) {
  if (!taggedAlignment || !taggedAlignment.length) {
    return {
      total: 0,
      contentWords: 0,
      rate: '0%',
      byType: { filler: 0, repetition: 0, false_start: 0, unknown: 0 }
    };
  }

  // Separate disfluencies from content
  const disfluencies = taggedAlignment.filter(a => a.type === 'insertion');
  const content = taggedAlignment.filter(a => a.type !== 'insertion');

  // Count by type
  const byType = { filler: 0, repetition: 0, false_start: 0, unknown: 0 };
  for (const d of disfluencies) {
    const type = d.disfluencyType || 'unknown';
    if (byType.hasOwnProperty(type)) {
      byType[type]++;
    } else {
      byType.unknown++;
    }
  }

  // DISF-07: Rate calculation uses contentWords as denominator
  // This ensures WCPM integrity - disfluencies excluded from both numerator and denominator
  const totalDisfluencies = disfluencies.length;
  const totalContent = content.length;
  const rate = totalContent > 0
    ? (totalDisfluencies / totalContent * 100).toFixed(1) + '%'
    : '0%';

  return {
    total: totalDisfluencies,
    contentWords: totalContent,
    rate,
    byType
  };
}

// ============================================================================
// Inline Tests (commented out - uncomment to verify)
// ============================================================================
/*
// Test 1: Filler classification
console.log('=== Test 1: Filler classification ===');
const fillerEntry = { verbatim: 'um', type: 'insertion' };
const fillerType = classifyDisfluency(fillerEntry, [fillerEntry], 0);
console.assert(fillerType === 'filler', 'um should be filler');
console.log('um ->', fillerType, '(expected: filler)');

const uhEntry = { verbatim: 'uh', type: 'insertion' };
console.assert(classifyDisfluency(uhEntry, [uhEntry], 0) === 'filler', 'uh should be filler');

const erEntry = { verbatim: 'er', type: 'insertion' };
console.assert(classifyDisfluency(erEntry, [erEntry], 0) === 'filler', 'er should be filler');
console.log('Test 1 PASSED\n');

// Test 2: Repetition classification
console.log('=== Test 2: Repetition classification ===');
const alignment = [
  { verbatim: 'the', clean: 'the', type: 'match' },
  { verbatim: 'the', clean: null, type: 'insertion' },
  { verbatim: 'cat', clean: 'cat', type: 'match' }
];
const tagged = tagDisfluencies(alignment);
console.log('Tagged alignment:', JSON.stringify(tagged, null, 2));
console.assert(tagged[1].disfluencyType === 'repetition', 'Second "the" should be repetition');
console.log('Test 2 PASSED\n');

// Test 3: False start classification
console.log('=== Test 3: False start classification ===');
const fsAlignment = [
  { verbatim: 'p', clean: null, type: 'insertion' },
  { verbatim: 'please', clean: 'please', type: 'match' }
];
const fsTagged = tagDisfluencies(fsAlignment);
console.assert(fsTagged[0].disfluencyType === 'false_start', 'p before please should be false_start');
console.log('p before please ->', fsTagged[0].disfluencyType, '(expected: false_start)');
console.log('Test 3 PASSED\n');

// Test 4: Stats calculation - WCPM integrity
console.log('=== Test 4: Stats calculation (WCPM integrity) ===');
const statsAlignment = [
  { verbatim: 'the', clean: 'the', type: 'match' },
  { verbatim: 'um', clean: null, type: 'insertion', disfluencyType: 'filler' },
  { verbatim: 'cat', clean: 'cat', type: 'match' }
];
const stats = computeDisfluencyStats(statsAlignment);
console.log('Stats:', JSON.stringify(stats, null, 2));
// 1 disfluency, 2 content words -> rate = 50% (not 33%)
console.assert(stats.total === 1, 'Should have 1 disfluency');
console.assert(stats.contentWords === 2, 'Should have 2 content words');
console.assert(stats.rate === '50.0%', 'Rate should be 50%');
console.log('Test 4 PASSED\n');

console.log('All tests passed!');
*/
