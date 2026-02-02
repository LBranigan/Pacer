/**
 * Text normalization utilities for oral reading fluency assessment.
 * Handles case normalization, punctuation stripping, and disfluency filtering.
 */

const DISFLUENCIES = new Set([
  'um', 'uh', 'uh-huh', 'mm', 'hmm', 'er', 'ah'
]);

/**
 * Normalize text into an array of lowercase words.
 * Strips leading/trailing punctuation from each word but preserves
 * apostrophes and hyphens within words.
 * @param {string} text
 * @returns {string[]}
 */
export function normalizeText(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/^[^\w'-]+|[^\w'-]+$/g, ''))
    .filter(w => w.length > 0);
}

/**
 * Remove common speech disfluencies from a word array.
 * @param {string[]} words
 * @returns {string[]}
 */
export function filterDisfluencies(words) {
  return words.filter(w => !DISFLUENCIES.has(w.toLowerCase()));
}
