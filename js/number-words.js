/**
 * Algorithmic number-to-words converter for oral reading assessment.
 *
 * When a reading passage contains digits like "2014", readers naturally say
 * "twenty fourteen" or "two thousand fourteen". This module generates all
 * valid spoken forms so the alignment engine can recognize them as correct.
 *
 * Coverage: integers 0–999,999 and decimals (e.g., "3.3", "2.5").
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
 * Convert a number in the hundreds (1–999) to word forms.
 * Returns array of word arrays (multiple valid forms).
 * @param {number} n - Integer 1–999
 * @param {function} add - Accumulator function
 */
function addHundredsForms(n, add) {
  if (n < 100) {
    add(twoDigitWords(n));
    return;
  }
  const h = Math.floor(n / 100);
  const rem = n % 100;
  const remWords = twoDigitWords(rem);
  if (rem === 0) {
    add([ONES[h], 'hundred']);
  } else {
    add([ONES[h], 'hundred', ...remWords]);
    add([ONES[h], 'hundred', 'and', ...remWords]);
  }
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
  if (isNaN(n) || n < 0 || n > 999999) return [];

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
    addHundredsForms(n, add);
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

  // --- Ten-thousands to hundreds of thousands (10,000–999,999) ---
  if (n >= 10000 && n <= 999999) {
    const thPart = Math.floor(n / 1000); // 10–999
    const rem = n % 1000;

    // Generate the thousands-part words (e.g., 58 → "fifty eight")
    const thWordSets = [];
    if (thPart < 20) {
      thWordSets.push([ONES[thPart]]);
    } else if (thPart < 100) {
      thWordSets.push(twoDigitWords(thPart));
    } else {
      // 100–999 thousands (e.g., 153,000 → "one hundred fifty three thousand")
      const h = Math.floor(thPart / 100);
      const hRem = thPart % 100;
      const hRemWords = twoDigitWords(hRem);
      if (hRem === 0) {
        thWordSets.push([ONES[h], 'hundred']);
      } else {
        thWordSets.push([ONES[h], 'hundred', ...hRemWords]);
        thWordSets.push([ONES[h], 'hundred', 'and', ...hRemWords]);
      }
    }

    for (const thWords of thWordSets) {
      if (rem === 0) {
        // "fifty eight thousand"
        add([...thWords, 'thousand']);
      } else if (rem < 100) {
        const remWords = twoDigitWords(rem);
        add([...thWords, 'thousand', ...remWords]);
        add([...thWords, 'thousand', 'and', ...remWords]);
      } else {
        const h = Math.floor(rem / 100);
        const hRem = rem % 100;
        const hRemWords = twoDigitWords(hRem);
        if (hRem === 0) {
          add([...thWords, 'thousand', ONES[h], 'hundred']);
        } else {
          add([...thWords, 'thousand', ONES[h], 'hundred', ...hRemWords]);
          add([...thWords, 'thousand', ONES[h], 'hundred', 'and', ...hRemWords]);
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

/**
 * Generate spoken forms for a decimal number string (e.g., "3.3", "2.5").
 *
 * Decimal numbers are read as: left side + "point" + right side digit-by-digit.
 * For multi-digit right sides, also generates standard number form.
 *
 * Examples:
 *   decimalToWordForms("3.3")  → [["three", "point", "three"]]
 *   decimalToWordForms("2.5")  → [["two", "point", "five"]]
 *   decimalToWordForms("3.25") → [["three", "point", "two", "five"],
 *                                  ["three", "point", "twenty", "five"]]
 *
 * @param {string} str - Decimal string (e.g., "3.3", "2.5")
 * @returns {string[][]} Array of valid spoken forms
 */
function decimalToWordForms(str) {
  const dotIdx = str.indexOf('.');
  if (dotIdx === -1) return [];
  const leftStr = str.slice(0, dotIdx);
  const rightStr = str.slice(dotIdx + 1);
  if (!leftStr || !rightStr || !/^\d+$/.test(leftStr) || !/^\d+$/.test(rightStr)) return [];

  const leftN = parseInt(leftStr, 10);
  const forms = new Set();
  const add = (arr) => { if (arr.length > 0) forms.add(JSON.stringify(arr)); };

  // Left side: standard number words
  const leftForms = leftN === 0 ? [['zero']] : numberToWordForms(leftStr);
  if (leftForms.length === 0 && leftN !== 0) return [];

  // Right side: digit-by-digit (standard for reading decimals)
  const digitByDigit = rightStr.split('').map(d => {
    const v = parseInt(d, 10);
    return v === 0 ? 'zero' : ONES[v];
  });

  // Right side: standard form (for multi-digit: "25" → "twenty five")
  const rightN = parseInt(rightStr, 10);
  const standardForms = rightStr.length > 1 && rightN > 0 ? numberToWordForms(rightStr) : [];

  for (const left of leftForms) {
    // "three point three", "two point five"
    add([...left, 'point', ...digitByDigit]);
    // "three point twenty five" (multi-digit decimals)
    for (const right of standardForms) {
      add([...left, 'point', ...right]);
    }
  }

  return Array.from(forms).map(s => JSON.parse(s));
}

// Expose globally (non-module script loaded before alignment.js)
window.numberToWordForms = numberToWordForms;
window.decimalToWordForms = decimalToWordForms;
