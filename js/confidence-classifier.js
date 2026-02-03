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

/**
 * Determine trust level from confidence score.
 * Per CONTEXT.md: thresholds are INCLUSIVE.
 * @param {number} confidence
 * @returns {string} Trust level: 'high' | 'medium' | 'low' | 'ghost'
 */
function getTrustLevel(confidence) {
  if (confidence === 0) return TRUST_LEVELS.GHOST;
  if (confidence >= CONFIDENCE_THRESHOLDS.HIGH) return TRUST_LEVELS.HIGH;
  if (confidence >= CONFIDENCE_THRESHOLDS.MEDIUM) return TRUST_LEVELS.MEDIUM;
  return TRUST_LEVELS.LOW;
}

/**
 * Classify a single word's confidence using asymmetric trust policy.
 *
 * Per CONTEXT.md trust policy:
 * - Both models: use default model's confidence as-is
 * - latest_only + IN ref: 0.85 (valid mumble - student likely mumbled correctly)
 * - latest_only + NOT in ref: 0.50 + possible_insertion flag (hallucination risk)
 * - default_only + IN ref: use default's confidence, CAP trustLevel at MEDIUM
 * - default_only + NOT in ref: LOW trust (phantom from weaker model)
 *
 * VAD ghost flag overrides everything to confidence 0.0.
 *
 * @param {object} word - Merged word with source and _debug
 * @param {Set<string>} referenceSet - Set from buildReferenceSet()
 * @returns {object} { confidence, trustLevel, _flags }
 */
export function classifyWordConfidence(word, referenceSet) {
  const flags = [];

  // Check VAD ghost flag first (highest priority override)
  if (word.vad_ghost_in_reference) {
    flags.push(CONFIDENCE_FLAGS.VAD_GHOST);
    return {
      confidence: 0.0,
      trustLevel: TRUST_LEVELS.GHOST,
      _flags: flags
    };
  }

  // Check if word is in reference (using canonical form)
  const normalized = normalizeWord(word.word);
  const canonical = getCanonical(normalized);
  const inReference = referenceSet.has(normalized) || referenceSet.has(canonical);

  // Get default model's confidence from _debug (per CONTEXT.md: use default only)
  const defaultConf = word._debug?.default?.confidence ?? word.confidence;

  let confidence;
  let trustLevel;

  switch (word.source) {
    case 'both':
      // Both models agree - use default's confidence as-is
      confidence = defaultConf;
      trustLevel = getTrustLevel(confidence);
      break;

    case 'latest_only':
      if (inReference) {
        // Stronger model caught quiet speech - benefit of doubt
        confidence = CONFIDENCE_THRESHOLDS.VALID_MUMBLE; // 0.85
        trustLevel = getTrustLevel(confidence); // Will be MEDIUM (0.85 >= 0.70)
      } else {
        // Hallucination risk - flag as possible insertion
        confidence = CONFIDENCE_THRESHOLDS.HALLUCINATION_RISK; // 0.50
        trustLevel = TRUST_LEVELS.LOW; // 0.50 < 0.70
        flags.push(CONFIDENCE_FLAGS.POSSIBLE_INSERTION);
      }
      break;

    case 'default_only':
      confidence = defaultConf;
      if (inReference) {
        // Student said it but unclearly - use confidence but CAP at MEDIUM
        const rawLevel = getTrustLevel(confidence);
        trustLevel = rawLevel === TRUST_LEVELS.HIGH ? TRUST_LEVELS.MEDIUM : rawLevel;
      } else {
        // Phantom from weaker model - LOW trust regardless of confidence
        trustLevel = TRUST_LEVELS.LOW;
        flags.push(CONFIDENCE_FLAGS.DEFAULT_ONLY_NOT_IN_REF);
      }
      break;

    default:
      // Fallback for unexpected source values
      confidence = word.confidence;
      trustLevel = getTrustLevel(confidence);
  }

  return {
    confidence,
    trustLevel,
    _flags: flags.length > 0 ? flags : undefined
  };
}
