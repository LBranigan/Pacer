/**
 * Algorithmic number-to-words converter for oral reading assessment.
 *
 * When a reading passage contains digits like "2014", readers naturally say
 * "twenty fourteen" or "two thousand fourteen". This module generates all
 * valid spoken forms so the alignment engine can recognize them as correct.
 *
 * Coverage: integers 0–9999 (years, statistics, page/figure refs).
 * Single-word numbers (1–20, 30, 40…90, 100) are already handled by
 * word-equivalences.js — this module covers multi-word spoken forms.
 */

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];

const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty',
  'seventy', 'eighty', 'ninety'];

/**
 * Convert a 2-digit number (0–99) to its word form as an array of words.
 * Returns [] for 0, single-element for 1–19, two-element for 21–99.
 * @param {number} n - Integer 0–99
 * @returns {string[]}
 */
function twoDigitWords(n) {
  if (n === 0) return [];
  if (n < 20) return [ONES[n]];
  const t = Math.floor(n / 10);
  const o = n % 10;
  if (o === 0) return [TENS[t]];
  return [TENS[t], ONES[o]];
}

/**
 * Generate all valid spoken forms for a number string (pure digits).
 *
 * Returns an array of word arrays. Each word array is one valid pronunciation.
 * For example:
 *   numberToWordForms("2014") → [
 *     ["twenty", "fourteen"],
 *     ["two", "thousand", "fourteen"],
 *     ["two", "thousand", "and", "fourteen"]
 *   ]
 *
 * @param {string} numStr - Pure digit string (e.g., "2014", "365", "80")
 * @returns {string[][]} Array of valid spoken forms (each is an array of words)
 */
function numberToWordForms(numStr) {
  const n = parseInt(numStr, 10);
  if (isNaN(n) || n < 0 || n > 9999) return [];

  const forms = new Set(); // deduplicate using JSON string keys
  const add = (arr) => {
    if (arr.length > 0) forms.add(JSON.stringify(arr));
  };

  if (n === 0) {
    add(['zero']);
    return [['zero']];
  }

  // --- Single-word forms (1–19, 20, 30, …, 90) ---
  // These are already handled by word-equivalences.js for alignment,
  // but we include them so numberToWordForms is self-contained for merge logic.
  if (n < 20) {
    add([ONES[n]]);
  } else if (n < 100) {
    add(twoDigitWords(n));
  }

  // --- Hundreds (100–999) ---
  if (n >= 100 && n <= 999) {
    const h = Math.floor(n / 100);
    const rem = n % 100;
    const remWords = twoDigitWords(rem);

    // "three hundred sixty five"
    if (rem === 0) {
      add([ONES[h], 'hundred']);
    } else {
      add([ONES[h], 'hundred', ...remWords]);
      // "three hundred AND sixty five" (British-style)
      add([ONES[h], 'hundred', 'and', ...remWords]);
    }
  }

  // --- Thousands (1000–9999) ---
  if (n >= 1000 && n <= 9999) {
    const th = Math.floor(n / 1000);
    const rem = n % 1000;

    if (rem === 0) {
      // "two thousand"
      add([ONES[th], 'thousand']);
    } else if (rem < 100) {
      // "two thousand fourteen"
      const remWords = twoDigitWords(rem);
      add([ONES[th], 'thousand', ...remWords]);
      // "two thousand AND fourteen"
      add([ONES[th], 'thousand', 'and', ...remWords]);
    } else {
      // "two thousand three hundred sixty five"
      const h = Math.floor(rem / 100);
      const hRem = rem % 100;
      const hRemWords = twoDigitWords(hRem);

      if (hRem === 0) {
        add([ONES[th], 'thousand', ONES[h], 'hundred']);
      } else {
        add([ONES[th], 'thousand', ONES[h], 'hundred', ...hRemWords]);
        add([ONES[th], 'thousand', ONES[h], 'hundred', 'and', ...hRemWords]);
      }
    }

    // --- Year-style pronunciation for 4-digit numbers ---
    // Split as XX-YY: "2014" → "twenty" + "fourteen"
    // Only valid when first two digits form 10–99 and last two digits > 0
    if (n >= 1000) {
      const hi = Math.floor(n / 100);  // first two digits as number
      const lo = n % 100;              // last two digits as number

      if (hi >= 10 && hi <= 99) {
        const hiWords = twoDigitWords(hi);
        if (lo === 0) {
          // "twenty hundred" style (e.g., 1900 → "nineteen hundred")
          add([...hiWords, 'hundred']);
        } else {
          const loWords = twoDigitWords(lo);
          // "twenty fourteen"
          add([...hiWords, ...loWords]);
          // "twenty oh four" for XX0Y patterns (e.g., 2004 → "twenty oh four")
          if (lo >= 1 && lo <= 9) {
            add([...hiWords, 'oh', ONES[lo]]);
          }
        }
      }
    }
  }

  // Convert Set back to array of arrays
  const result = [];
  for (const key of forms) {
    result.push(JSON.parse(key));
  }
  return result;
}

// Expose globally (non-module script loaded before alignment.js)
window.numberToWordForms = numberToWordForms;
