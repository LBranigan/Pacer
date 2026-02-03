/**
 * Confidence classifier with asymmetric trust policy.
 * Classifies words based on model agreement (_source) and reference presence.
 *
 * Pipeline order: Classify -> Filter ghosts -> Align
 */

import { CONFIDENCE_THRESHOLDS, TRUST_LEVELS, CONFIDENCE_FLAGS } from './confidence-config.js';
import { getCanonical, getAllEquivalents } from './word-equivalences.js';

/**
 * Normalize word for reference matching.
 * Per CONTEXT.md: case-insensitive, strip punctuation except apostrophes/hyphens.
 * @param {string} word
 * @returns {string}
 */
function normalizeWord(word) {
  if (!word) return '';
  return word.toLowerCase().replace(/^[^a-z0-9'-]+|[^a-z0-9'-]+$/g, '');
}

/**
 * Build a Set of all canonical word forms from reference text.
 * Expands ALL reference words to ALL equivalent forms for O(1) lookup.
 *
 * Per CONTEXT.md reference matching rules:
 * - Case-insensitive
 * - Strip punctuation except apostrophes/hyphens
 * - Homophones match
 * - Numbers match word forms
 * - Hyphenated compounds match multiple forms (well-known = wellknown = well known)
 *
 * @param {string} referenceText
 * @returns {Set<string>} Set of all acceptable word forms
 */
export function buildReferenceSet(referenceText) {
  if (!referenceText || typeof referenceText !== 'string') {
    return new Set();
  }

  const words = referenceText.split(/\s+/).filter(Boolean);
  const refSet = new Set();

  for (const word of words) {
    const normalized = normalizeWord(word);
    if (!normalized) continue;

    // Add the word itself
    refSet.add(normalized);

    // Add canonical form
    const canonical = getCanonical(normalized);
    refSet.add(canonical);

    // Add ALL equivalents (homophones, numbers, etc.)
    const equivalents = getAllEquivalents(normalized);
    for (const eq of equivalents) {
      refSet.add(eq);
    }

    // Handle hyphenated compounds: "well-known" matches "wellknown" and "well known"
    if (normalized.includes('-')) {
      // Without hyphens (wellknown)
      refSet.add(normalized.replace(/-/g, ''));
      // As separate words - add each part
      const parts = normalized.split('-');
      for (const part of parts) {
        refSet.add(part);
      }
    }
  }

  return refSet;
}
