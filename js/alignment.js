/**
 * Word-level alignment engine using Needleman-Wunsch with graded substitution costs.
 * Aligns STT transcript against reference text to classify each word.
 *
 * Uses Levenshtein similarity to score substitutions — similar words get lower
 * penalty than dissimilar ones. This ensures that when two hypothesis words
 * compete for the same reference slot, the more similar one wins.
 *
 * Replaces the previous diff-match-patch binary (match/no-match) approach,
 * which could assign the wrong hypothesis word to a reference slot when
 * insertions appeared adjacent to substitutions.
 *
 * Scoring (based on texterrors: https://github.com/RuABraun/texterrors):
 *   Match (exact canonical):  +2.0
 *   Gap (insertion/omission): -1.0
 *   Mismatch (graded):        -1.5 × (1 - levenshteinRatio)
 */

import { normalizeText, filterDisfluencies } from './text-normalize.js';
import { getCanonical } from './word-equivalences.js';
import { levenshteinRatio } from './nl-api.js';

/**
 * Post-process alignment to detect compound words split by ASR.
 * E.g., reference "hotdog" transcribed as "hot" + "dog" should be marked correct.
 *
 * Pattern: substitution(ref=X, hyp=A) followed by insertion(hyp=B) where A+B = X
 */
function mergeCompoundWords(alignment) {
  const result = [];
  let i = 0;

  while (i < alignment.length) {
    const current = alignment[i];

    // Look for substitution followed by one or more insertions
    if (current.type === 'substitution' && current.ref && current.hyp) {
      const refCanon = getCanonical(current.ref);
      let combined = current.hyp;
      let insertionsConsumed = 0;

      // Try combining with following insertions
      for (let j = i + 1; j < alignment.length && alignment[j].type === 'insertion'; j++) {
        combined += alignment[j].hyp;
        insertionsConsumed++;

        // Check if combined matches reference
        if (getCanonical(combined) === refCanon) {
          // Found compound word match
          result.push({
            ref: current.ref,
            hyp: combined,
            type: 'correct',
            compound: true,
            parts: [current.hyp, ...alignment.slice(i + 1, i + 1 + insertionsConsumed).map(a => a.hyp)]
          });
          i += 1 + insertionsConsumed;
          break;
        }
      }

      // If no compound match found, keep original
      if (i < alignment.length && alignment[i] === current) {
        result.push(current);
        i++;
      }
    } else {
      result.push(current);
      i++;
    }
  }

  return result;
}

/**
 * Post-process alignment to detect ASR merging two reference words into one.
 * Mirror of mergeCompoundWords — handles the reverse direction.
 *
 * Two sub-patterns:
 *
 * 1. Contraction via equivalence: ref "you will" → hyp "you'll"
 *    Uses getCanonical() to match known multi-word equivalences.
 *
 * 2. Pure concatenation: ref "long" + "term" → hyp "longterm"
 *    ASR fused adjacent words without any linguistic transformation.
 *
 * Layout: substitution(ref=X, hyp=C) + omission(ref=Y), or the reverse.
 * Both ref words are re-marked as 'correct' with compound: true.
 */
function mergeContractions(alignment) {
  const result = [];
  let i = 0;

  while (i < alignment.length) {
    const current = alignment[i];
    const next = i + 1 < alignment.length ? alignment[i + 1] : null;

    // Pattern A: substitution + omission
    // e.g., sub(ref="you", hyp="you'll") + omission(ref="will")
    // e.g., sub(ref="long", hyp="longterm") + omission(ref="term")
    if (current.type === 'substitution' && current.ref && current.hyp &&
        next && next.type === 'omission' && next.ref) {
      const hypCanon = getCanonical(current.hyp).replace(/'/g, '');

      // Check 1: equivalence match (contractions like you'll = you will)
      const spaced = current.ref + ' ' + next.ref;
      const spacedCanon = getCanonical(spaced).replace(/'/g, '');

      // Check 2: pure concatenation (ASR fusion like longterm = long + term)
      const concat = current.ref + next.ref;
      const concatCanon = getCanonical(concat).replace(/'/g, '');

      if (spacedCanon === hypCanon || concatCanon === hypCanon) {
        result.push({
          ref: current.ref,
          hyp: current.hyp,
          type: 'correct',
          compound: true,
          _mergedFrom: spaced
        });
        result.push({
          ref: next.ref,
          hyp: current.hyp,
          type: 'correct',
          compound: true,
          _mergedInto: current.hyp
        });
        i += 2;
        continue;
      }
    }

    // Pattern B: omission + substitution (less common order)
    // e.g., omission(ref="do") + sub(ref="not", hyp="don't")
    if (current.type === 'omission' && current.ref &&
        next && next.type === 'substitution' && next.ref && next.hyp) {
      const hypCanon = getCanonical(next.hyp).replace(/'/g, '');

      const spaced = current.ref + ' ' + next.ref;
      const spacedCanon = getCanonical(spaced).replace(/'/g, '');

      const concat = current.ref + next.ref;
      const concatCanon = getCanonical(concat).replace(/'/g, '');

      if (spacedCanon === hypCanon || concatCanon === hypCanon) {
        result.push({
          ref: current.ref,
          hyp: next.hyp,
          type: 'correct',
          compound: true,
          _mergedFrom: spaced
        });
        result.push({
          ref: next.ref,
          hyp: next.hyp,
          type: 'correct',
          compound: true,
          _mergedInto: next.hyp
        });
        i += 2;
        continue;
      }
    }

    result.push(current);
    i++;
  }

  return result;
}

// --- Needleman-Wunsch scoring parameters ---
// Based on texterrors (https://github.com/RuABraun/texterrors)
const MATCH_BONUS = 2;      // Exact canonical match reward
const GAP_PENALTY = -1;     // Insertion or omission penalty
const MAX_MISMATCH = -1.5;  // Worst-case mismatch (1.5× multiplier prevents over-favoring subs)

/**
 * Compute alignment score for pairing refWord with hypWord.
 *
 * Exact canonical matches get full MATCH_BONUS (+2).
 * Non-matches get a graded penalty: -1.5 × (1 - levenshteinRatio).
 *   - Near-miss ("bark"→"barked", ratio ~0.67): -0.50  (cheap sub)
 *   - Distant ("the"→"mission", ratio ~0):      -1.50  (expensive sub)
 *
 * Substitution is always preferred over ins+del (-1.5 < -2.0),
 * so no false gap pairs are created. But when two hypothesis words
 * compete for the same reference slot, the more similar one wins.
 */
function scorePair(refWord, hypWord) {
  const refCanon = getCanonical(refWord).replace(/'/g, '');
  const hypCanon = getCanonical(hypWord).replace(/'/g, '');

  // Exact canonical match (includes equivalences like "one"/"1")
  if (refCanon === hypCanon) return MATCH_BONUS;

  // Graded mismatch based on character-level similarity
  const ratio = levenshteinRatio(refCanon, hypCanon);
  return MAX_MISMATCH * (1 - ratio);
}

/**
 * Align reference text against transcript words from STT.
 *
 * Uses Needleman-Wunsch global alignment with graded substitution costs.
 * When two hypothesis words compete for a reference slot, the one with
 * higher character-level similarity wins — preventing the diff algorithm
 * from assigning unrelated words (like "the") as substitutions for
 * content words (like "mission") when the actual attempt is nearby.
 *
 * @param {string} referenceText - The passage the student should read.
 * @param {Array<{word: string}>} transcriptWords - STT word objects (each has .word).
 * @returns {Array<{ref: string|null, hyp: string|null, type: string}>}
 *   type is one of: "correct", "substitution", "omission", "insertion"
 */
export function alignWords(referenceText, transcriptWords) {
  const refWords = normalizeText(referenceText);
  const hypWords = filterDisfluencies(
    (transcriptWords || []).map(w => normalizeText(w.word)[0]).filter(Boolean)
  );

  if (refWords.length === 0 && hypWords.length === 0) return [];

  const m = refWords.length;
  const n = hypWords.length;

  // Edge cases: one side empty
  if (m === 0) {
    return hypWords.map(w => ({ ref: null, hyp: w, type: 'insertion' }));
  }
  if (n === 0) {
    return refWords.map(w => ({ ref: w, hyp: null, type: 'omission' }));
  }

  // --- Needleman-Wunsch dynamic programming ---

  // Scoring matrix F[i][j] = best score aligning ref[0..i-1] with hyp[0..j-1]
  const F = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  // Pointer matrix for traceback
  const P = Array(m + 1).fill(null).map(() => Array(n + 1).fill(null));

  // First column: all omissions (ref words with no hypothesis match)
  for (let i = 1; i <= m; i++) {
    F[i][0] = F[i - 1][0] + GAP_PENALTY;
    P[i][0] = 'up';
  }

  // First row: all insertions (hypothesis words with no reference match)
  for (let j = 1; j <= n; j++) {
    F[0][j] = F[0][j - 1] + GAP_PENALTY;
    P[0][j] = 'left';
  }

  // Fill matrix with graded substitution costs
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const scoreDiag = F[i - 1][j - 1] + scorePair(refWords[i - 1], hypWords[j - 1]);
      const scoreUp   = F[i - 1][j]     + GAP_PENALTY;  // Omission
      const scoreLeft = F[i][j - 1]      + GAP_PENALTY;  // Insertion

      const maxScore = Math.max(scoreDiag, scoreUp, scoreLeft);
      F[i][j] = maxScore;

      // Prefer diagonal for ties (minimizes gaps)
      if (maxScore === scoreDiag) {
        P[i][j] = 'diag';
      } else if (maxScore === scoreUp) {
        P[i][j] = 'up';
      } else {
        P[i][j] = 'left';
      }
    }
  }

  // Traceback from bottom-right to top-left
  const result = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && P[i][j] === 'diag') {
      const refCanon = getCanonical(refWords[i - 1]).replace(/'/g, '');
      const hypCanon = getCanonical(hypWords[j - 1]).replace(/'/g, '');
      const type = (refCanon === hypCanon) ? 'correct' : 'substitution';
      result.unshift({ ref: refWords[i - 1], hyp: hypWords[j - 1], type });
      i--;
      j--;
    } else if (i > 0 && (j === 0 || P[i][j] === 'up')) {
      result.unshift({ ref: refWords[i - 1], hyp: null, type: 'omission' });
      i--;
    } else {
      result.unshift({ ref: null, hyp: hypWords[j - 1], type: 'insertion' });
      j--;
    }
  }

  // Post-process: merge compound words split by ASR (e.g., "hotdog" → "hot" + "dog")
  // then merge contractions spanning two ref words (e.g., "you will" → "you'll")
  const merged = mergeCompoundWords(result);
  return mergeContractions(merged);
}
