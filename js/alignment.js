/**
 * Word-level alignment engine using diff-match-patch.
 * Diffs STT transcript against reference text to classify each word.
 */

import { normalizeText, filterDisfluencies } from './text-normalize.js';
import { getCanonical } from './word-equivalences.js';

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

/* diff-match-patch constants */
const DIFF_DELETE = -1;
const DIFF_INSERT = 1;
const DIFF_EQUAL = 0;

/**
 * Align reference text against transcript words from STT.
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

  // Encode words as single Unicode characters for diff-match-patch
  const wordMap = new Map();
  let nextChar = 0x100; // start above ASCII

  function encode(words) {
    let encoded = '';
    for (const w of words) {
      const canon = getCanonical(w);
      if (!wordMap.has(canon)) {
        wordMap.set(canon, String.fromCharCode(nextChar++));
      }
      encoded += wordMap.get(canon);
    }
    return encoded;
  }

  const refEncoded = encode(refWords);
  const hypEncoded = encode(hypWords);

  // eslint-disable-next-line no-undef
  const dmp = new diff_match_patch();
  const diffs = dmp.diff_main(refEncoded, hypEncoded);

  // Decode diffs into classified word list using original word forms (not canonical).
  // Track indices into refWords/hypWords so output preserves what was actually said.
  const result = [];
  let refIdx = 0;
  let hypIdx = 0;
  let i = 0;

  while (i < diffs.length) {
    const [op, text] = diffs[i];
    const count = [...text].length;

    if (op === DIFF_EQUAL) {
      for (let j = 0; j < count; j++) {
        result.push({ ref: refWords[refIdx], hyp: hypWords[hypIdx], type: 'correct' });
        refIdx++;
        hypIdx++;
      }
      i++;
    } else if (op === DIFF_DELETE) {
      // Check if next diff is INSERT (substitution merge)
      if (i + 1 < diffs.length && diffs[i + 1][0] === DIFF_INSERT) {
        const insCount = [...diffs[i + 1][1]].length;
        const pairCount = Math.min(count, insCount);
        // Pair 1:1 as substitutions
        for (let j = 0; j < pairCount; j++) {
          result.push({ ref: refWords[refIdx], hyp: hypWords[hypIdx], type: 'substitution' });
          refIdx++;
          hypIdx++;
        }
        // Excess deletes become omissions
        for (let j = pairCount; j < count; j++) {
          result.push({ ref: refWords[refIdx], hyp: null, type: 'omission' });
          refIdx++;
        }
        // Excess inserts become insertions
        for (let j = pairCount; j < insCount; j++) {
          result.push({ ref: null, hyp: hypWords[hypIdx], type: 'insertion' });
          hypIdx++;
        }
        i += 2;
      } else {
        // Pure omissions
        for (let j = 0; j < count; j++) {
          result.push({ ref: refWords[refIdx], hyp: null, type: 'omission' });
          refIdx++;
        }
        i++;
      }
    } else if (op === DIFF_INSERT) {
      // Pure insertions (no preceding DELETE)
      for (let j = 0; j < count; j++) {
        result.push({ ref: null, hyp: hypWords[hypIdx], type: 'insertion' });
        hypIdx++;
      }
      i++;
    }
  }

  // Merge compound words split by ASR (e.g., "hotdog" → "hot" + "dog")
  return mergeCompoundWords(result);
}
