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

  // Build reverse map: char -> word
  const charToWord = new Map();
  for (const [word, char] of wordMap) {
    charToWord.set(char, word);
  }

  // Decode diffs into classified word list, merging adjacent DELETE+INSERT into substitutions
  const result = [];
  let i = 0;

  while (i < diffs.length) {
    const [op, text] = diffs[i];

    if (op === DIFF_EQUAL) {
      for (const ch of text) {
        const w = charToWord.get(ch);
        result.push({ ref: w, hyp: w, type: 'correct' });
      }
      i++;
    } else if (op === DIFF_DELETE) {
      const delWords = [...text].map(ch => charToWord.get(ch));
      // Check if next diff is INSERT (substitution merge)
      if (i + 1 < diffs.length && diffs[i + 1][0] === DIFF_INSERT) {
        const insWords = [...diffs[i + 1][1]].map(ch => charToWord.get(ch));
        const pairCount = Math.min(delWords.length, insWords.length);
        // Pair 1:1 as substitutions
        for (let j = 0; j < pairCount; j++) {
          result.push({ ref: delWords[j], hyp: insWords[j], type: 'substitution' });
        }
        // Excess deletes become omissions
        for (let j = pairCount; j < delWords.length; j++) {
          result.push({ ref: delWords[j], hyp: null, type: 'omission' });
        }
        // Excess inserts become insertions
        for (let j = pairCount; j < insWords.length; j++) {
          result.push({ ref: null, hyp: insWords[j], type: 'insertion' });
        }
        i += 2;
      } else {
        // Pure omissions
        for (const w of delWords) {
          result.push({ ref: w, hyp: null, type: 'omission' });
        }
        i++;
      }
    } else if (op === DIFF_INSERT) {
      // Pure insertions (no preceding DELETE)
      for (const ch of text) {
        result.push({ ref: null, hyp: charToWord.get(ch), type: 'insertion' });
      }
      i++;
    }
  }

  // Merge compound words split by ASR (e.g., "hotdog" → "hot" + "dog")
  return mergeCompoundWords(result);
}
