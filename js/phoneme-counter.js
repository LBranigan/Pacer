// phoneme-counter.js — CMUdict-based phoneme count lookup for duration normalization
//
// Provides getPhonemeCount(word) which returns the exact phoneme count from the
// CMU Pronouncing Dictionary (134K+ entries). For words not in CMUdict, falls back
// to syllable count * PHONEMES_PER_SYLLABLE_RATIO (empirical ratio from CMUdict).
//
// Phoneme count is a finer-grained normalizer than syllable count for spoken word
// duration. Syllable count misses consonant density — "spreadsheet" (2 syl, 8 phonemes)
// and "baby" (2 syl, 4 phonemes) have the same syllable count but very different
// articulatory cost. Phoneme count captures this variance.
//
// See docs/phoneme-normalization-plan.md for full rationale and research references.

import { countSyllables } from './syllable-counter.js';

// Ratio of total phonemes to total syllables across all CMUdict entries.
// Computed as Σphonemes / Σsyllables = 799853 / 309581 ≈ 2.5837.
// This is the regression-through-origin slope — the single number that minimizes
// total squared phoneme-count estimation error when estimating from syllable count.
const PHONEMES_PER_SYLLABLE_RATIO = 2.5837;

// Phoneme count lookup: loaded lazily from data/cmudict-phoneme-counts.json
let _phonemeCounts = null;
let _loadPromise = null;
let _loadFailed = false;

/**
 * Load the CMUdict phoneme counts JSON. Returns a promise that resolves
 * when the data is ready. Safe to call multiple times — deduplicates.
 */
export function loadPhonemeData() {
  if (_phonemeCounts) return Promise.resolve();
  if (_loadPromise) return _loadPromise;

  _loadPromise = fetch('data/cmudict-phoneme-counts.json')
    .then(resp => {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    })
    .then(data => {
      _phonemeCounts = data;
      console.log(`[phoneme-counter] Loaded ${Object.keys(data).length} entries from CMUdict`);
    })
    .catch(err => {
      console.warn(`[phoneme-counter] Failed to load CMUdict data, using syllable fallback: ${err.message}`);
      _loadFailed = true;
      _phonemeCounts = {}; // empty — all lookups will use fallback
    });

  return _loadPromise;
}

/**
 * Get the phoneme count for a word.
 *
 * @param {string} word - An English word (case-insensitive)
 * @returns {number|null} Exact phoneme count from CMUdict, or null if not found.
 *   Use getPhonemeCountWithFallback() if you always want a number.
 */
export function getPhonemeCount(word) {
  if (!word || typeof word !== 'string') return null;
  if (!_phonemeCounts) return null;

  const w = word.toLowerCase().replace(/[^a-z'-]/g, '');
  if (!w) return null;

  const count = _phonemeCounts[w];
  return count !== undefined ? count : null;
}

/**
 * Get phoneme count with syllable-based fallback for unknown words.
 * Always returns a positive number.
 *
 * @param {string} word - An English word
 * @returns {{ count: number, source: 'cmudict'|'fallback' }}
 */
export function getPhonemeCountWithFallback(word) {
  const exact = getPhonemeCount(word);
  if (exact != null) {
    return { count: exact, source: 'cmudict' };
  }

  // Fallback: syllable count * empirical ratio
  const syllables = countSyllables(word);
  const estimated = Math.round(syllables * PHONEMES_PER_SYLLABLE_RATIO);
  if (word && word.length > 0 && !_loadFailed) {
    console.warn(`[phoneme-counter] "${word}" not in CMUdict, using fallback: ${syllables} syl × ${PHONEMES_PER_SYLLABLE_RATIO} ≈ ${estimated} phonemes`);
  }
  return { count: Math.max(estimated, 1), source: 'fallback' };
}

export { PHONEMES_PER_SYLLABLE_RATIO };
