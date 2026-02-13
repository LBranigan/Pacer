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

import { normalizeText, DISFLUENCIES } from './text-normalize.js';
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

    // Pattern A: substitution followed by one or more insertions
    // e.g., sub(ref="hotdog", hyp="hot") + ins(hyp="dog") → correct("hotdog")
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
          // If match is via canonical equivalence (e.g., "etcetera" → "etc"), flag as
          // abbreviation expansion so compound struggle reclassification skips it.
          const isAbbrExpansion = combined.toLowerCase() !== current.ref.toLowerCase();
          result.push({
            ref: current.ref,
            hyp: combined,
            type: 'correct',
            compound: true,
            hypIndex: current.hypIndex,
            parts: [current.hyp, ...alignment.slice(i + 1, i + 1 + insertionsConsumed).map(a => a.hyp)],
            ...(isAbbrExpansion && { _abbreviationExpansion: true })
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

    // Pattern B: one or more insertions followed by substitution (reversed order)
    // NW traceback can produce this when tie-breaking favors diagonal at the later position.
    // e.g., ins(hyp="hot") + sub(ref="hotdog", hyp="dog") → correct("hotdog")
    } else if (current.type === 'insertion' && current.hyp) {
      // Collect consecutive insertions
      let insertionCount = 0;
      while (i + insertionCount < alignment.length && alignment[i + insertionCount].type === 'insertion') {
        insertionCount++;
      }

      // Check if a substitution follows the insertion run
      const subIdx = i + insertionCount;
      if (subIdx < alignment.length && alignment[subIdx].type === 'substitution' && alignment[subIdx].ref) {
        const refCanon = getCanonical(alignment[subIdx].ref);
        let combined = '';
        let matched = false;

        // Try combining insertions (from first) + substitution hyp
        for (let k = 0; k < insertionCount; k++) {
          combined += alignment[i + k].hyp;
          const withSub = combined + alignment[subIdx].hyp;
          if (getCanonical(withSub) === refCanon) {
            // Found reversed compound word match
            const isAbbrExpansion = withSub.toLowerCase() !== alignment[subIdx].ref.toLowerCase();
            const parts = [];
            for (let p = 0; p <= k; p++) parts.push(alignment[i + p].hyp);
            parts.push(alignment[subIdx].hyp);
            result.push({
              ref: alignment[subIdx].ref,
              hyp: withSub,
              type: 'correct',
              compound: true,
              hypIndex: alignment[subIdx].hypIndex,
              parts,
              ...(isAbbrExpansion && { _abbreviationExpansion: true })
            });
            i = subIdx + 1;
            matched = true;
            break;
          }
        }

        if (!matched) {
          // No compound match — push all insertions normally
          for (let k = 0; k < insertionCount; k++) {
            result.push(alignment[i + k]);
          }
          i += insertionCount;
          // Don't push the substitution here; it will be handled in the next iteration
        }
      } else {
        // No substitution follows — push insertions normally
        for (let k = 0; k < insertionCount; k++) {
          result.push(alignment[i + k]);
        }
        i += insertionCount;
      }
    } else {
      result.push(current);
      i++;
    }
  }

  return result;
}

/**
 * Known abbreviation → multi-word expansion mappings.
 * Keys are period-stripped forms (after normalizeText).
 * Values are arrays of acceptable spoken expansions.
 */
const ABBREVIATION_EXPANSIONS = {
  // Latin / general
  'ie':    [['that', 'is']],
  'eg':    [['for', 'example']],
  'etc':   [['et', 'cetera']],
  'aka':   [['also', 'known', 'as']],
  'diy':   [['do', 'it', 'yourself']],
  'rsvp':  [['please', 'respond']],
  'ps':    [['post', 'script']],
  // Time
  'am':    [['in', 'the', 'morning']],
  'pm':    [['in', 'the', 'afternoon'], ['in', 'the', 'evening']],
  // Historical eras
  'bc':    [['before', 'christ']],
  'ad':    [['anno', 'domini']],
  'bce':   [['before', 'common', 'era']],
  'ce':    [['common', 'era']],
  // Geography / organizations
  'us':    [['united', 'states']],
  'usa':   [['united', 'states', 'of', 'america']],
  'uk':    [['united', 'kingdom']],
  'dc':    [['district', 'of', 'columbia']],
  'nyc':   [['new', 'york', 'city']],
  'un':    [['united', 'nations']],
  'eu':    [['european', 'union']],
  // Speed / rate units
  'mph':   [['miles', 'per', 'hour']],
  'kph':   [['kilometers', 'per', 'hour']],
  // War / history
  'wwi':   [['world', 'war', 'one'], ['world', 'war', 'i']],
  'wwii':  [['world', 'war', 'two'], ['world', 'war', 'ii']],
};

/**
 * Post-process alignment to detect abbreviation → multi-word expansions.
 * When a student reads an abbreviation as its full English meaning,
 * we get 1 ref token mapping to N hyp tokens of different words.
 *
 * Example: ref="ie" (after period strip), student says "that is"
 *   → sub(ref="ie", hyp="that") + ins(hyp="is")
 *   → reclassified as correct (compound merge with abbreviation expansion)
 *
 * Position in pipeline: after mergeCompoundWords, before mergeContractions.
 */
function mergeAbbreviationExpansions(alignment) {
  const result = [];
  let i = 0;

  while (i < alignment.length) {
    const current = alignment[i];

    // Pattern A: substitution followed by insertions matching an expansion
    if (current.type === 'substitution' && current.ref && current.hyp) {
      const refNorm = current.ref.toLowerCase();
      const expansions = ABBREVIATION_EXPANSIONS[refNorm];

      if (expansions) {
        let matched = false;

        for (const expansion of expansions) {
          // First word of expansion must match the substitution's hyp
          if (current.hyp.toLowerCase() !== expansion[0]) continue;

          // Remaining expansion words must match following insertions
          const remaining = expansion.slice(1);
          let allMatch = true;

          for (let k = 0; k < remaining.length; k++) {
            const nextIdx = i + 1 + k;
            if (nextIdx >= alignment.length ||
                alignment[nextIdx].type !== 'insertion' ||
                alignment[nextIdx].hyp?.toLowerCase() !== remaining[k]) {
              allMatch = false;
              break;
            }
          }

          if (allMatch) {
            // Reclassify as correct compound
            const parts = [current.hyp, ...remaining.map((_, k) => alignment[i + 1 + k].hyp)];
            result.push({
              ref: current.ref,
              hyp: parts.join(' '),
              type: 'correct',
              compound: true,
              hypIndex: current.hypIndex,
              _abbreviationExpansion: true,
              parts
            });
            i += 1 + remaining.length;
            matched = true;
            break;
          }
        }

        if (!matched) {
          result.push(current);
          i++;
        }
        continue;
      }
    }

    // Pattern B: insertions followed by substitution matching an expansion
    // e.g., ins(hyp="for") + sub(ref="eg", hyp="example")
    if (current.type === 'insertion' && current.hyp) {
      // Collect consecutive insertions
      let insertionCount = 0;
      while (i + insertionCount < alignment.length && alignment[i + insertionCount].type === 'insertion') {
        insertionCount++;
      }

      const subIdx = i + insertionCount;
      if (subIdx < alignment.length && alignment[subIdx].type === 'substitution' && alignment[subIdx].ref) {
        const refNorm = alignment[subIdx].ref.toLowerCase();
        const expansions = ABBREVIATION_EXPANSIONS[refNorm];

        if (expansions) {
          let matched = false;

          for (const expansion of expansions) {
            // Last word of expansion must match the substitution's hyp
            if (alignment[subIdx].hyp?.toLowerCase() !== expansion[expansion.length - 1]) continue;

            // Preceding insertion words must match the expansion prefix
            const prefix = expansion.slice(0, -1);
            if (prefix.length > insertionCount) continue;

            let allMatch = true;
            const startIns = insertionCount - prefix.length;
            for (let k = 0; k < prefix.length; k++) {
              if (alignment[i + startIns + k].hyp?.toLowerCase() !== prefix[k]) {
                allMatch = false;
                break;
              }
            }

            if (allMatch) {
              // Push non-matching insertions before the expansion
              for (let k = 0; k < startIns; k++) {
                result.push(alignment[i + k]);
              }

              const parts = [...prefix.map((_, k) => alignment[i + startIns + k].hyp), alignment[subIdx].hyp];
              result.push({
                ref: alignment[subIdx].ref,
                hyp: parts.join(' '),
                type: 'correct',
                compound: true,
                hypIndex: alignment[subIdx].hypIndex,
                _abbreviationExpansion: true,
                parts
              });
              i = subIdx + 1;
              matched = true;
              break;
            }
          }

          if (!matched) {
            for (let k = 0; k < insertionCount; k++) {
              result.push(alignment[i + k]);
            }
            i += insertionCount;
          }
          continue;
        }
      }

      // No abbreviation match — push insertions normally
      for (let k = 0; k < insertionCount; k++) {
        result.push(alignment[i + k]);
      }
      i += insertionCount;
      continue;
    }

    result.push(current);
    i++;
  }

  return result;
}

/**
 * Post-process alignment to detect numbers read as multi-word spoken forms.
 * When reference contains "2014" and student says "twenty fourteen", NW alignment
 * produces sub(ref="2014", hyp="twenty") + ins(hyp="fourteen"). This function
 * detects that pattern and reclassifies it as correct.
 *
 * Uses numberToWordForms() from number-words.js to dynamically generate all
 * valid spoken forms for the digit string.
 *
 * Position in pipeline: after mergeAbbreviationExpansions, before mergeContractions.
 */
function mergeNumberExpansions(alignment) {
  // numberToWordForms is loaded globally from number-words.js
  if (typeof window === 'undefined' || typeof window.numberToWordForms !== 'function') {
    return alignment;
  }

  const result = [];
  let i = 0;

  while (i < alignment.length) {
    const current = alignment[i];

    // Pattern A: substitution(ref=DIGITS) followed by insertions matching a spoken form
    if (current.type === 'substitution' && current.ref && current.hyp && /^\d+$/.test(current.ref)) {
      const expansions = window.numberToWordForms(current.ref);

      if (expansions.length > 0) {
        let matched = false;

        for (const expansion of expansions) {
          // First word of expansion must match the substitution's hyp
          if (current.hyp.toLowerCase() !== expansion[0]) continue;

          // Remaining expansion words must match following insertions
          const remaining = expansion.slice(1);
          let allMatch = true;

          for (let k = 0; k < remaining.length; k++) {
            const nextIdx = i + 1 + k;
            if (nextIdx >= alignment.length ||
                alignment[nextIdx].type !== 'insertion' ||
                alignment[nextIdx].hyp?.toLowerCase() !== remaining[k]) {
              allMatch = false;
              break;
            }
          }

          if (allMatch) {
            const parts = [current.hyp, ...remaining.map((_, k) => alignment[i + 1 + k].hyp)];
            result.push({
              ref: current.ref,
              hyp: parts.join(' '),
              type: 'correct',
              compound: true,
              hypIndex: current.hypIndex,
              _numberExpansion: true,
              parts
            });
            i += 1 + remaining.length;
            matched = true;
            break;
          }
        }

        if (!matched) {
          result.push(current);
          i++;
        }
        continue;
      }
    }

    // Pattern B: insertions followed by substitution(ref=DIGITS) matching a spoken form
    if (current.type === 'insertion' && current.hyp) {
      // Collect consecutive insertions
      let insertionCount = 0;
      while (i + insertionCount < alignment.length && alignment[i + insertionCount].type === 'insertion') {
        insertionCount++;
      }

      const subIdx = i + insertionCount;
      if (subIdx < alignment.length && alignment[subIdx].type === 'substitution' &&
          alignment[subIdx].ref && /^\d+$/.test(alignment[subIdx].ref)) {
        const expansions = window.numberToWordForms(alignment[subIdx].ref);

        if (expansions.length > 0) {
          let matched = false;

          for (const expansion of expansions) {
            // Last word of expansion must match the substitution's hyp
            if (alignment[subIdx].hyp?.toLowerCase() !== expansion[expansion.length - 1]) continue;

            // Preceding insertion words must match the expansion prefix
            const prefix = expansion.slice(0, -1);
            if (prefix.length > insertionCount) continue;

            let allMatch = true;
            const startIns = insertionCount - prefix.length;
            for (let k = 0; k < prefix.length; k++) {
              if (alignment[i + startIns + k].hyp?.toLowerCase() !== prefix[k]) {
                allMatch = false;
                break;
              }
            }

            if (allMatch) {
              // Push non-matching insertions before the expansion
              for (let k = 0; k < startIns; k++) {
                result.push(alignment[i + k]);
              }

              const parts = [...prefix.map((_, k) => alignment[i + startIns + k].hyp), alignment[subIdx].hyp];
              result.push({
                ref: alignment[subIdx].ref,
                hyp: parts.join(' '),
                type: 'correct',
                compound: true,
                hypIndex: alignment[subIdx].hypIndex,
                _numberExpansion: true,
                parts
              });
              i = subIdx + 1;
              matched = true;
              break;
            }
          }

          if (!matched) {
            for (let k = 0; k < insertionCount; k++) {
              result.push(alignment[i + k]);
            }
            i += insertionCount;
          }
          continue;
        }
      }

      // No number match — push insertions normally
      for (let k = 0; k < insertionCount; k++) {
        result.push(alignment[i + k]);
      }
      i += insertionCount;
      continue;
    }

    result.push(current);
    i++;
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
          hypIndex: current.hypIndex,
          _mergedFrom: spaced
        });
        result.push({
          ref: next.ref,
          hyp: current.hyp,
          type: 'correct',
          compound: true,
          hypIndex: current.hypIndex,
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
          hypIndex: next.hypIndex,
          _mergedFrom: spaced
        });
        result.push({
          ref: next.ref,
          hyp: next.hyp,
          type: 'correct',
          compound: true,
          hypIndex: next.hypIndex,
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

  // Build normalized hypothesis words, tracking original indices through disfluency filter.
  // Raw V1 words include fillers ("uh", "um") that filterDisfluencies strips.
  // hypIndex must map back to the original transcriptWords position, not the filtered position.
  // flatMap: a single hyphenated word like "in-person" normalizes to ["in", "person"],
  // producing two alignment entries both mapping back to the same original word index.
  const rawNormed = (transcriptWords || [])
    .flatMap((w, i) => normalizeText(w.word).map(norm => ({ norm, origIdx: i })))
    .filter(p => p.norm);
  const filtered = rawNormed.filter(p => !DISFLUENCIES.has(p.norm));
  const hypWords = filtered.map(p => p.norm);

  if (refWords.length === 0 && hypWords.length === 0) return [];

  const m = refWords.length;
  const n = hypWords.length;

  // Edge cases: one side empty
  if (m === 0) {
    return hypWords.map((w, idx) => ({ ref: null, hyp: w, type: 'insertion', hypIndex: filtered[idx].origIdx }));
  }
  if (n === 0) {
    return refWords.map(w => ({ ref: w, hyp: null, type: 'omission', hypIndex: -1 }));
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
      result.unshift({ ref: refWords[i - 1], hyp: hypWords[j - 1], type, hypIndex: filtered[j - 1].origIdx });
      i--;
      j--;
    } else if (i > 0 && (j === 0 || P[i][j] === 'up')) {
      result.unshift({ ref: refWords[i - 1], hyp: null, type: 'omission', hypIndex: -1 });
      i--;
    } else {
      result.unshift({ ref: null, hyp: hypWords[j - 1], type: 'insertion', hypIndex: filtered[j - 1].origIdx });
      j--;
    }
  }

  // Post-process pipeline:
  // 1. Merge compound words split by ASR (e.g., "hotdog" → "hot" + "dog", "ie" → "i" + "e")
  // 2. Merge abbreviation expansions (e.g., ref "ie" → hyp "that is")
  // 3. Merge number expansions (e.g., ref "2014" → hyp "twenty fourteen")
  // 4. Merge contractions spanning two ref words (e.g., "you will" → "you'll")
  const merged = mergeCompoundWords(result);
  const abbrMerged = mergeAbbreviationExpansions(merged);
  const numMerged = mergeNumberExpansions(abbrMerged);
  const final = mergeContractions(numMerged);

  // Re-inject pre-filtered disfluencies as insertion entries.
  // These were stripped before NW alignment to prevent "uh" matching short ref words like "a",
  // but they need to appear in the alignment result so the UI can render them and the
  // filler classifier in app.js can tag them on transcriptWords.
  const disfluencyWords = rawNormed.filter(p => DISFLUENCIES.has(p.norm));
  for (const disf of disfluencyWords) {
    let insertPos = final.length;
    for (let k = 0; k < final.length; k++) {
      if (final[k].hypIndex >= 0 && final[k].hypIndex > disf.origIdx) {
        insertPos = k;
        break;
      }
    }
    final.splice(insertPos, 0, {
      ref: null,
      hyp: disf.norm,
      type: 'insertion',
      hypIndex: disf.origIdx,
      _preFilteredDisfluency: true
    });
  }

  return final;
}

/**
 * Post-alignment consolidation of spillover fragments.
 *
 * When a student struggles with a word, Reverb's CTC decoder often produces
 * fragments that NW alignment distributes across multiple ref slots. For example,
 * "informational" → Reverb hears "in" + "four" + "uh". NW greedily aligns "four"
 * to ref="expert" because sub("four"→"expert") scores better than gap+insertion.
 * This loses the struggle evidence — "four" is attributed to the wrong ref word.
 *
 * This function identifies ref slots where the hyp is NOT a real attempt at that
 * ref word, but concatenating it with the preceding sub's hyp IS a near-miss for
 * the preceding ref word. It converts the spillover entry to an omission and emits
 * the hyp as an insertion after the anchor word.
 *
 * Guards:
 *   - candidate.hyp must NOT be a near-miss for candidate.ref (it's not a real attempt)
 *   - concat(anchor.hyp, candidate.hyp) must BE a near-miss for anchor.ref
 *
 * Uses only the engine's own data — no cross-engine dependency.
 *
 * @param {Array} aligned - Alignment array (modified in place)
 * @param {Function} nearMissFn - isNearMiss(a, b) → boolean
 * @returns {Array} Log entries for debug stage
 */
export function consolidateSpilloverFragments(aligned, nearMissFn) {
  // Phase 1: Build ref-anchored index and identify targets
  const refEntries = [];
  for (let i = 0; i < aligned.length; i++) {
    if (aligned[i].type !== 'insertion') {
      refEntries.push({ idx: i, entry: aligned[i] });
    }
  }

  const targets = new Set(); // indices into aligned[] to consolidate
  const log = [];

  for (let r = 1; r < refEntries.length; r++) {
    const anchor = refEntries[r - 1];
    if (anchor.entry.type !== 'substitution' && anchor.entry.type !== 'struggle') continue;

    // Try progressive chaining: anchor + candidate, anchor + candidate + next, ...
    let concat = anchor.entry.hyp;
    for (let c = r; c < refEntries.length; c++) {
      const candidate = refEntries[c];
      if (candidate.entry.type !== 'substitution') break;

      // Guard 1: candidate hyp must NOT be a near-miss for its own ref
      if (nearMissFn(candidate.entry.hyp, candidate.entry.ref)) break;

      // Build concatenation
      concat += candidate.entry.hyp;

      // Guard 2: concatenation must BE a near-miss for anchor's ref
      if (!nearMissFn(concat, anchor.entry.ref)) continue;

      // Mark all candidates from r to c as targets
      for (let t = r; t <= c; t++) {
        targets.add(refEntries[t].idx);
      }
      log.push({
        anchorRef: anchor.entry.ref,
        anchorHyp: anchor.entry.hyp,
        concat,
        absorbed: Array.from({ length: c - r + 1 }, (_, k) => ({
          ref: refEntries[r + k].entry.ref,
          hyp: refEntries[r + k].entry.hyp
        }))
      });
      break; // found match for this anchor, move on
    }
  }

  if (targets.size === 0) return log;

  // Phase 2: Rebuild array
  const result = [];
  for (let i = 0; i < aligned.length; i++) {
    if (!targets.has(i)) {
      result.push(aligned[i]);
      continue;
    }

    const entry = aligned[i];

    // Emit the hyp as an insertion (spillover fragment)
    result.push({
      ref: null,
      type: 'insertion',
      hyp: entry.hyp,
      hypIndex: entry.hypIndex,
      _spillover: true
    });

    // Sweep trailing insertions between this target and the next ref entry
    let j = i + 1;
    while (j < aligned.length && aligned[j].type === 'insertion') {
      const swept = { ...aligned[j], _spillover: true };
      result.push(swept);
      j++;
    }

    // Emit omission for the ref word that lost its hyp
    result.push({
      ref: entry.ref,
      hyp: null,
      type: 'omission',
      hypIndex: -1,
      _spilloverOmission: true
    });

    // Skip the trailing insertions we already swept
    i = j - 1;
  }

  // Replace in place
  aligned.length = 0;
  aligned.push(...result);

  return log;
}
