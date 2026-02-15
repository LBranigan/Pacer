// syllable-analysis.js — Syllable-level analysis of near-miss reading fragments
//
// Provides syllabifyWord() which splits an English word into syllable strings,
// and analyzeSyllableCoverage() which measures how many syllables of a reference
// word a student's near-miss fragment covers.
//
// Purpose: Ground the AI interpretation layer's claims in data. Without this,
// the LLM can only say "fragment shares a 5-character prefix with the target."
// With this, it can say "fragment covers 2 of 3 syllables (prefix position)."
//
// Algorithm: Rule-based Maximum Onset Principle syllabification, cross-validated
// against countSyllables() from syllable-counter.js. When the syllabifier's count
// disagrees with the validated counter, falls back to consonant-boundary splitting.
//
// Accuracy target: Correct syllable boundaries for ~90% of K-8 reading vocabulary.
// Cross-validation against countSyllables() (95% accurate with exception dictionary)
// catches most remaining errors.

import { countSyllables } from './syllable-counter.js';

// ── Valid English onset clusters ────────────────────────────────────────
// Consonant clusters that can legally begin an English syllable.
// Used by the Maximum Onset Principle: when splitting consonants between
// two vowel nuclei, give as many consonants as possible to the NEXT
// syllable — but only if they form a valid onset.

const VALID_ONSETS = new Set([
  // Two-consonant onsets
  'bl', 'br', 'ch', 'cl', 'cr', 'dr', 'dw', 'fl', 'fr', 'gh',
  'gl', 'gr', 'kn', 'kw', 'ph', 'pl', 'pr', 'qu',
  'sc', 'sh', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'sw',
  'th', 'tr', 'tw', 'wh', 'wr',
  // Three-consonant onsets
  'scr', 'shr', 'spl', 'spr', 'squ', 'str', 'thr',
]);

// Vowel digraphs — two vowel letters that form a single vowel sound.
// When encountered, they constitute one syllable nucleus, not two.
const VOWEL_DIGRAPHS = new Set([
  'ai', 'au', 'aw', 'ay', 'ea', 'ee', 'ei', 'ew', 'ey',
  'ie', 'oa', 'oe', 'oi', 'oo', 'ou', 'ow', 'oy', 'ue', 'ui',
]);

const VOWELS = 'aeiou';

function isVowel(ch) {
  return VOWELS.includes(ch);
}

// ── Core syllabifier ────────────────────────────────────────────────────

/**
 * Tokenize a word into a sequence of {chars, type, pos} units.
 * Handles vowel digraphs, 'y' as vowel/consonant, and basic letter classification.
 *
 * @param {string} w - Lowercase alphabetic word
 * @returns {Array<{chars: string, type: 'V'|'C', pos: number}>}
 */
function tokenize(w) {
  const tokens = [];
  let i = 0;

  while (i < w.length) {
    // Check for vowel digraphs (2-char lookahead)
    if (i < w.length - 1) {
      const pair = w[i] + w[i + 1];
      if (VOWEL_DIGRAPHS.has(pair)) {
        tokens.push({ chars: pair, type: 'V', pos: i });
        i += 2;
        continue;
      }
    }

    const ch = w[i];

    if (ch === 'y') {
      // Y is a consonant at word start or immediately before a vowel letter.
      // Otherwise it functions as a vowel (e.g., "gym", "my", "rhythm").
      const isConsonant = i === 0 || (i < w.length - 1 && isVowel(w[i + 1]));
      tokens.push({ chars: ch, type: isConsonant ? 'C' : 'V', pos: i });
    } else if (isVowel(ch)) {
      tokens.push({ chars: ch, type: 'V', pos: i });
    } else {
      tokens.push({ chars: ch, type: 'C', pos: i });
    }
    i++;
  }

  return tokens;
}

/**
 * Find the index of the last token in a vowel nucleus starting at startIdx.
 * A nucleus is a maximal run of consecutive V-type tokens.
 */
function nucleusEnd(tokens, startIdx) {
  let t = startIdx;
  while (t + 1 < tokens.length && tokens[t + 1].type === 'V') t++;
  return t;
}

/**
 * Raw syllabification using the Maximum Onset Principle.
 *
 * Algorithm:
 * 1. Tokenize word into vowel (V) and consonant (C) units
 * 2. Find all vowel nuclei (syllable peaks)
 * 3. Handle silent-e (final 'e' that doesn't create a syllable)
 * 4. Between consecutive nuclei, split consonant cluster to maximize
 *    the onset of the following syllable, subject to valid onset constraints
 * 5. Return array of syllable strings
 *
 * @param {string} word - English word
 * @returns {string[]} Array of syllable strings (e.g., ["ad", "ven", "ture"])
 */
function _syllabify(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w || w.length <= 2) return w ? [w] : [];

  const tokens = tokenize(w);

  // Find vowel nuclei — each nucleus is the start of a syllable's vowel peak
  const nuclei = [];
  let inVowel = false;
  for (let t = 0; t < tokens.length; t++) {
    if (tokens[t].type === 'V') {
      if (!inVowel) {
        nuclei.push(t);
        inVowel = true;
      }
    } else {
      inVowel = false;
    }
  }

  if (nuclei.length === 0) return [w]; // no vowels (e.g., "rhythm" edge case)

  // Handle silent-e: final single 'e' preceded by consonant(s) and another nucleus
  if (nuclei.length >= 2) {
    const lastNucIdx = nuclei[nuclei.length - 1];
    const lastToken = tokens[lastNucIdx];
    // Silent-e conditions: single 'e', at word end, preceded by consonant
    if (lastToken.chars === 'e' &&
        lastToken.pos === w.length - 1 &&
        lastNucIdx > 0 &&
        tokens[lastNucIdx - 1].type === 'C') {

      // Exception: consonant + le at word end IS a syllable ("ap-ple", "can-dle")
      // But vowel + le is silent e ("while", "smile")
      const prevToken = tokens[lastNucIdx - 1];
      if (prevToken.chars === 'l') {
        // Check token before 'l': if vowel → silent e, if consonant → real syllable
        if (lastNucIdx >= 2 && tokens[lastNucIdx - 2].type === 'V') {
          nuclei.pop(); // vowel + le → silent e
        }
        // consonant + le → keep as syllable
      } else {
        nuclei.pop(); // regular silent e
      }
    }
  }

  if (nuclei.length <= 1) return [w];

  // Split consonant clusters between consecutive nuclei
  const splitPositions = [0]; // character positions where each syllable starts

  for (let n = 0; n < nuclei.length - 1; n++) {
    const curNucEnd = nucleusEnd(tokens, nuclei[n]);
    const nextNucStart = nuclei[n + 1];

    // Gather consonant tokens between current nucleus end and next nucleus start
    const consonants = [];
    for (let t = curNucEnd + 1; t < nextNucStart; t++) {
      if (tokens[t].type === 'C') consonants.push(tokens[t]);
    }

    if (consonants.length === 0) {
      // Hiatus: two vowels with no consonants (e.g., "po-et", "di-al")
      splitPositions.push(tokens[nextNucStart].pos);
    } else if (consonants.length === 1) {
      // Single consonant between vowels → onset of next syllable
      splitPositions.push(consonants[0].pos);
    } else {
      // Multiple consonants: apply Maximum Onset Principle
      // Try progressively shorter suffixes of the consonant cluster as onset
      let splitPos = consonants[0].pos; // default: all consonants go to next syllable's coda

      for (let c = 0; c < consonants.length; c++) {
        const onsetChars = consonants.slice(c).map(t => t.chars).join('');
        // Valid onset: either a recognized cluster, or a single consonant (always valid)
        if (VALID_ONSETS.has(onsetChars) || consonants.length - c === 1) {
          splitPos = consonants[c].pos;
          break;
        }
      }

      splitPositions.push(splitPos);
    }
  }

  // Build syllable strings from split positions
  const syllables = [];
  for (let s = 0; s < splitPositions.length; s++) {
    const start = splitPositions[s];
    const end = s < splitPositions.length - 1 ? splitPositions[s + 1] : w.length;
    if (start < end) syllables.push(w.slice(start, end));
  }

  return syllables.length > 0 ? syllables : [w];
}

/**
 * Fallback: split word into N syllables at the best consonant-vowel boundaries.
 * Used when the syllabifier's count disagrees with the validated countSyllables().
 *
 * Strategy: find all consonant-to-vowel transition points in the word,
 * then choose the N-1 split points that produce the most even syllable lengths.
 *
 * @param {string} word - Lowercase alphabetic word
 * @param {number} targetCount - Expected number of syllables
 * @returns {string[]}
 */
function _fallbackSplit(word, targetCount) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (targetCount <= 1 || !w) return w ? [w] : [];

  // Find all consonant-to-vowel transitions (potential syllable boundaries)
  const candidates = [];
  for (let i = 1; i < w.length; i++) {
    if (!isVowel(w[i - 1]) && isVowel(w[i])) {
      candidates.push(i);
    }
  }

  // Also consider vowel-to-consonant transitions as secondary candidates
  if (candidates.length < targetCount - 1) {
    for (let i = 1; i < w.length; i++) {
      if (isVowel(w[i - 1]) && !isVowel(w[i]) && !candidates.includes(i)) {
        candidates.push(i);
      }
    }
    candidates.sort((a, b) => a - b);
  }

  if (candidates.length === 0) {
    // No good split points — proportional split
    const avg = w.length / targetCount;
    const result = [];
    for (let i = 0; i < targetCount; i++) {
      result.push(w.slice(Math.round(i * avg), Math.round((i + 1) * avg)));
    }
    return result.filter(s => s.length > 0);
  }

  // Choose targetCount-1 split points that produce the most even distribution
  // For simplicity, use the greedy approach: ideal split at w.length/targetCount intervals
  const idealInterval = w.length / targetCount;
  const chosen = [];
  const used = new Set();

  for (let s = 1; s < targetCount; s++) {
    const idealPos = Math.round(s * idealInterval);
    let bestCandidate = candidates[0];
    let bestDist = Math.abs(candidates[0] - idealPos);

    for (const c of candidates) {
      if (used.has(c)) continue;
      const dist = Math.abs(c - idealPos);
      if (dist < bestDist) {
        bestDist = dist;
        bestCandidate = c;
      }
    }
    chosen.push(bestCandidate);
    used.add(bestCandidate);
  }

  chosen.sort((a, b) => a - b);

  // Build syllable strings
  const result = [];
  let prev = 0;
  for (const pos of chosen) {
    if (pos > prev) result.push(w.slice(prev, pos));
    prev = pos;
  }
  if (prev < w.length) result.push(w.slice(prev));

  return result.filter(s => s.length > 0);
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Split an English word into syllables.
 *
 * Uses rule-based Maximum Onset Principle syllabification, cross-validated
 * against countSyllables(). When they disagree, falls back to consonant-boundary
 * splitting with the validated count as the target.
 *
 * @param {string} word - An English word
 * @returns {string[]} Array of syllable strings (e.g., ["ad", "ven", "ture"])
 */
export function syllabifyWord(word) {
  if (!word || typeof word !== 'string') return [];

  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return [];
  if (w.length <= 2) return [w];

  const syllables = _syllabify(w);
  const expectedCount = countSyllables(w);

  // Cross-validate: if counts match, trust the syllabifier's boundaries
  if (syllables.length === expectedCount) return syllables;

  // Disagreement: the countSyllables() exception dictionary is more reliable
  // for count. Use fallback splitting with the validated count.
  return _fallbackSplit(w, expectedCount);
}

/**
 * Analyze how much of a reference word a near-miss fragment covers,
 * measured in syllables.
 *
 * This is the key function for the AI interpretation layer. It transforms
 * character-level near-miss detection ("5-char prefix match") into
 * syllable-level reading science claims ("covers 2 of 3 syllables").
 *
 * @param {string} fragment - The near-miss text (e.g., "adven")
 * @param {string} refWord - The reference word (e.g., "adventure")
 * @returns {{
 *   fragment: string,
 *   refWord: string,
 *   refSyllables: string[],
 *   totalSyllables: number,
 *   syllablesCovered: number,
 *   coverageRatio: number,
 *   position: 'prefix'|'suffix'|'interior'|'scattered',
 *   coveredSyllables: string[],
 *   partialNext: boolean
 * }}
 */
export function analyzeSyllableCoverage(fragment, refWord) {
  const frag = (fragment || '').toLowerCase().replace(/[^a-z]/g, '');
  const ref = (refWord || '').toLowerCase().replace(/[^a-z]/g, '');

  const refSyllables = syllabifyWord(ref);
  const totalSyllables = refSyllables.length;

  const empty = {
    fragment: frag, refWord: ref, refSyllables, totalSyllables,
    syllablesCovered: 0, coverageRatio: 0,
    position: 'scattered', coveredSyllables: [], partialNext: false,
  };

  if (!frag || !ref || totalSyllables === 0) return empty;

  // Determine match position: prefix, suffix, or interior
  const isPrefix = ref.startsWith(frag);
  const isSuffix = !isPrefix && ref.endsWith(frag);

  if (isPrefix) {
    return _computePrefixCoverage(frag, ref, refSyllables);
  }

  if (isSuffix) {
    return _computeSuffixCoverage(frag, ref, refSyllables);
  }

  // Interior or scattered match — ordered substring check per syllable.
  // Walk through ref syllables in order, checking if each appears in the
  // fragment at or after the previous match. Non-overlapping, order-preserving.
  // "baracoda" vs ["bar","ra","cu","da"] → "bar" at 0, "da" at 6 → 2/4
  let searchFrom = 0;
  const coveredSyllables = [];
  for (const syl of refSyllables) {
    const idx = frag.indexOf(syl, searchFrom);
    if (idx >= 0) {
      coveredSyllables.push(syl);
      searchFrom = idx + syl.length;
    }
  }
  const syllablesCovered = coveredSyllables.length;

  return {
    fragment: frag, refWord: ref, refSyllables, totalSyllables,
    syllablesCovered,
    coverageRatio: syllablesCovered / totalSyllables,
    position: 'interior',
    coveredSyllables,
    partialNext: false,
  };
}

/**
 * Compute syllable coverage for a prefix-matching fragment.
 * Walk through syllable boundaries, counting how many complete syllables
 * fit within the fragment length.
 */
function _computePrefixCoverage(frag, ref, refSyllables) {
  const totalSyllables = refSyllables.length;
  let charsCovered = 0;
  let syllablesCovered = 0;
  const coveredSyllables = [];

  for (let i = 0; i < refSyllables.length; i++) {
    const nextBoundary = charsCovered + refSyllables[i].length;
    if (nextBoundary <= frag.length) {
      // Fragment fully covers this syllable
      syllablesCovered++;
      coveredSyllables.push(refSyllables[i]);
      charsCovered = nextBoundary;
    } else {
      break;
    }
  }

  // Check if fragment extends into the next syllable (partial coverage)
  const partialNext = charsCovered < frag.length && syllablesCovered < totalSyllables;

  return {
    fragment: frag, refWord: ref, refSyllables, totalSyllables,
    syllablesCovered,
    coverageRatio: syllablesCovered / totalSyllables,
    position: 'prefix',
    coveredSyllables,
    partialNext,
  };
}

/**
 * Compute syllable coverage for a suffix-matching fragment.
 * Walk backwards through syllable boundaries.
 */
function _computeSuffixCoverage(frag, ref, refSyllables) {
  const totalSyllables = refSyllables.length;
  let charsCovered = 0;
  let syllablesCovered = 0;
  const coveredSyllables = [];

  for (let i = refSyllables.length - 1; i >= 0; i--) {
    const nextBoundary = charsCovered + refSyllables[i].length;
    if (nextBoundary <= frag.length) {
      syllablesCovered++;
      coveredSyllables.unshift(refSyllables[i]);
      charsCovered = nextBoundary;
    } else {
      break;
    }
  }

  const partialNext = charsCovered < frag.length && syllablesCovered < totalSyllables;

  return {
    fragment: frag, refWord: ref, refSyllables, totalSyllables,
    syllablesCovered,
    coverageRatio: syllablesCovered / totalSyllables,
    position: 'suffix',
    coveredSyllables,
    partialNext,
  };
}

/**
 * Analyze syllable coverage for a struggle entry's collected fragments.
 * Handles the common case: multiple insertion fragments that together
 * represent the student's attempt at a word.
 *
 * @param {string[]} fragments - Array of near-miss fragment texts (from _nearMissEvidence)
 * @param {string} refWord - The reference word
 * @returns {ReturnType<typeof analyzeSyllableCoverage>} Coverage analysis of concatenated fragments
 */
export function analyzeFragmentsCoverage(fragments, refWord) {
  if (!fragments || fragments.length === 0) {
    return analyzeSyllableCoverage('', refWord);
  }

  // Concatenate fragments (same logic as _concatAttempt in resolveNearMissClusters)
  const combined = fragments.map(f => (f || '').toLowerCase().replace(/[^a-z']/g, '')).join('');
  return analyzeSyllableCoverage(combined, refWord);
}
