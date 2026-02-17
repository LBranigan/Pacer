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
    .map(w => w.replace(/(\d),(?=\d)/g, '$1'))  // Strip commas between digits: "58,000" → "58000"
    .map(w => /^\d[\d.]*\d$/.test(w) ? w : w.replace(/\./g, ''))  // Strip periods except in decimal numbers (3.3 stays, i.e. → ie)
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

  // Split internal-hyphen words via shared splitHyphenParts (single source of truth).
  // Line-break hyphens were already rejoined above, so remaining hyphens are
  // real compound-word hyphens that STT engines output as separate words.
  const result = [];
  for (const token of merged) {
    const hp = splitHyphenParts(token);
    if (!hp) {
      result.push(token);
    } else if (hp.type === 'join') {
      result.push(hp.parts.join(''));
    } else {
      result.push(...hp.parts);
    }
  }
  return result;
}

/**
 * Core hyphen-split decision for a single stripped token (no leading/trailing punctuation).
 *
 * This is the single source of truth for the hyphen-splitting algorithm.
 * All consumers (normalizeText, refPositions, splitForPunct, getPunctuationPositions,
 * computePauseAtPunctuation) must use this function to stay in sync.
 *
 * Rules:
 *   - No hyphen → null (no processing needed)
 *   - Single-letter first part (e-mail, e-book, x-ray) → {type:'join', parts} → join into one token
 *   - Otherwise → {type:'split', parts} → split into separate tokens
 *
 * @param {string} stripped - Token with leading/trailing punctuation already removed
 * @returns {null | {type: 'join'|'split', parts: string[]}}
 */
export function splitHyphenParts(stripped) {
  if (!stripped.includes('-')) return null;
  const parts = stripped.split('-').filter(p => p.length > 0);
  if (parts.length < 2) return null;
  if (parts[0].length === 1) return { type: 'join', parts };
  return { type: 'split', parts };
}

/**
 * Split reference text into tokens that match normalizeText's count, preserving
 * original formatting for punctuation extraction.
 *
 * Handles trailing-hyphen merge (OCR line breaks) + internal-hyphen split +
 * single-letter prefix join, all via splitHyphenParts.
 *
 * Used by: getPunctuationPositions, splitForPunct (ui.js), computePauseAtPunctuation.
 *
 * @param {string} referenceText
 * @returns {string[]} Tokens with preserved original formatting on last split parts
 */
export function splitReferenceForDisplay(referenceText) {
  const stripPunct = w => w.replace(/^[^\w'-]+|[^\w'-]+$/g, '');
  const rawTokens = referenceText.trim().split(/\s+/);

  // Step 1: Trailing-hyphen merge (OCR line-break artifacts)
  const merged = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const s = stripPunct(rawTokens[i]);
    if (s.length === 0) continue;
    if (s.endsWith('-') && i + 1 < rawTokens.length) {
      merged.push(rawTokens[i + 1]); // second part keeps original formatting
      i++;
    } else {
      merged.push(rawTokens[i]);
    }
  }

  // Step 2+3: Internal-hyphen split via shared splitHyphenParts
  const result = [];
  for (const token of merged) {
    const s = stripPunct(token);
    const hp = splitHyphenParts(s);
    if (!hp) {
      result.push(token);
    } else if (hp.type === 'join') {
      result.push(token); // single-letter prefix — keep as one token
    } else {
      // split: inner parts are stripped, last part keeps original for punct
      for (let j = 0; j < hp.parts.length - 1; j++) result.push(hp.parts[j]);
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
