/**
 * Text normalization utilities for oral reading fluency assessment.
 * Handles case normalization, punctuation stripping, and disfluency filtering.
 */

export const DISFLUENCIES = new Set([
  'um', 'uh', 'uh-huh', 'mm', 'hmm', 'er', 'ah'
]);

/**
 * Normalize text into an array of lowercase words.
 * Strips leading/trailing punctuation, apostrophes (straight and curly),
 * and internal periods from each word. Hyphens at line breaks are rejoined;
 * all other hyphens split the word into separate tokens, except when the
 * first part is a single character (e.g., "e-mail" → "email").
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
    .map(w => w.replace(/\./g, ''))   // Strip internal periods (abbreviations: i.e. → ie, U.S.A. → usa)
    .map(w => w.replace(/['\u2018\u2019\u201B`]/g, ''))  // Strip apostrophes/smart quotes (content's → contents, don't → dont)
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
  // Exception: single-letter PREFIX hyphens join instead of splitting,
  // because ASR engines output the merged form (e.g., "e-mail" → "email").
  // Only first part being single-letter triggers joining — covers e-mail,
  // e-book, x-ray. When single letter is a suffix (e.g., "cayuco-a" from
  // OCR em-dash), it's a separate word, not a prefix.
  // Line-break hyphens were already rejoined above, so remaining hyphens are
  // real compound-word hyphens that STT engines output as separate words.
  const result = [];
  for (const token of merged) {
    if (token.includes('-')) {
      const parts = token.split('-').filter(p => p.length > 0);
      if (parts.length >= 2 && parts[0].length === 1) {
        // Single-letter prefix (e-mail, e-book, x-ray) → join as one token
        result.push(parts.join(''));
      } else {
        result.push(...parts);
      }
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
