/**
 * Text normalization utilities for oral reading fluency assessment.
 * Handles case normalization, punctuation stripping, and disfluency filtering.
 */

const DISFLUENCIES = new Set([
  'um', 'uh', 'uh-huh', 'mm', 'hmm', 'er', 'ah'
]);

/**
 * Normalize text into an array of lowercase words.
 * Strips leading/trailing punctuation from each word and preserves
 * apostrophes within words. Hyphens at line breaks are rejoined;
 * all other hyphens split the word into separate tokens.
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
  const merged = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].endsWith('-') && i + 1 < tokens.length) {
      merged.push(tokens[i].slice(0, -1) + tokens[i + 1]);
      i++; // skip next token
    } else {
      merged.push(tokens[i]);
    }
  }

  // Split internal-hyphen words into separate words so they match STT output.
  // e.g., "soft-on-skin" → ["soft", "on", "skin"]
  // Line-break hyphens were already rejoined above, so remaining hyphens are
  // real compound-word hyphens that STT engines output as separate words.
  const result = [];
  for (const token of merged) {
    if (token.includes('-')) {
      const parts = token.split('-').filter(p => p.length > 0);
      result.push(...parts);
    } else {
      result.push(token);
    }
  }
  return result;
}

/**
 * Remove common speech disfluencies from a word array.
 * @param {string[]} words
 * @returns {string[]}
 */
export function filterDisfluencies(words) {
  return words.filter(w => !DISFLUENCIES.has(w.toLowerCase()));
}
