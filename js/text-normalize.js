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
  const tokens = text
    .replace(/-\s*\n\s*/g, '')   // Rejoin line-break hyphens when newlines survive
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/^[^\w'-]+|[^\w'-]+$/g, ''))
    .filter(w => w.length > 0);

  // Merge trailing-hyphen tokens with next token (line-break artifacts from OCR).
  // e.g., ["spread-", "sheet"] → ["spreadsheet"]
  // Real hyphenated words like "mother-in-law" have internal hyphens, never trailing.
  const merged = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].endsWith('-') && i + 1 < tokens.length) {
      merged.push(tokens[i].slice(0, -1) + tokens[i + 1]);
      i++; // skip next token
    } else {
      merged.push(tokens[i]);
    }
  }
  return merged;
}

/**
 * Remove common speech disfluencies from a word array.
 * @param {string[]} words
 * @returns {string[]}
 */
export function filterDisfluencies(words) {
  return words.filter(w => !DISFLUENCIES.has(w.toLowerCase()));
}
