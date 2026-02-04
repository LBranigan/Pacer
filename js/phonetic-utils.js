/**
 * Phonetic utilities for terminal word leniency.
 * Uses Double Metaphone algorithm to compare sounds, not spellings.
 *
 * "hen" vs "hand" are spelling errors but phonetic near-matches:
 *   hen  -> HN
 *   hand -> HNT
 *   and  -> ANT
 *
 * Levenshtein distance of 1 on phonetic codes = teacher grace.
 */

/**
 * Double Metaphone implementation (simplified).
 * Returns primary phonetic code for a word.
 *
 * Based on Lawrence Philips' algorithm.
 * @param {string} word - Word to encode
 * @returns {string} Primary metaphone code
 */
export function doubleMetaphone(word) {
  if (!word) return '';

  // Normalize
  let str = word.toUpperCase().replace(/[^A-Z]/g, '');
  if (!str) return '';

  let primary = '';
  let pos = 0;
  const last = str.length - 1;

  // Helper to check character at position
  const charAt = (p) => (p >= 0 && p <= last) ? str[p] : '';
  const isVowel = (c) => 'AEIOU'.includes(c);

  // Skip initial silent letters
  if (['GN', 'KN', 'PN', 'WR', 'PS'].some(pair => str.startsWith(pair))) {
    pos = 1;
  }

  // Initial X sounds like Z
  if (charAt(0) === 'X') {
    primary += 'S';
    pos = 1;
  }

  while (pos <= last && primary.length < 4) {
    const c = charAt(pos);

    switch (c) {
      case 'A':
      case 'E':
      case 'I':
      case 'O':
      case 'U':
        // Vowels only matter at start
        if (pos === 0) primary += 'A';
        pos++;
        break;

      case 'B':
        primary += 'P';
        pos += (charAt(pos + 1) === 'B') ? 2 : 1;
        break;

      case 'C':
        if (charAt(pos + 1) === 'H') {
          primary += 'X';
          pos += 2;
        } else if ('IEY'.includes(charAt(pos + 1))) {
          primary += 'S';
          pos += 1;
        } else {
          primary += 'K';
          pos += (charAt(pos + 1) === 'C' && !'IEY'.includes(charAt(pos + 2))) ? 2 : 1;
        }
        break;

      case 'D':
        if (charAt(pos + 1) === 'G' && 'IEY'.includes(charAt(pos + 2))) {
          primary += 'J';
          pos += 3;
        } else {
          primary += 'T';
          pos += (charAt(pos + 1) === 'D') ? 2 : 1;
        }
        break;

      case 'F':
        primary += 'F';
        pos += (charAt(pos + 1) === 'F') ? 2 : 1;
        break;

      case 'G':
        if (charAt(pos + 1) === 'H') {
          if (pos > 0 && !isVowel(charAt(pos - 1))) {
            pos += 2;
          } else {
            primary += 'K';
            pos += 2;
          }
        } else if (charAt(pos + 1) === 'N') {
          if (pos === 0) {
            pos += 2;
          } else {
            primary += 'KN';
            pos += 2;
          }
        } else if ('IEY'.includes(charAt(pos + 1))) {
          primary += 'J';
          pos += 1;
        } else {
          primary += 'K';
          pos += (charAt(pos + 1) === 'G') ? 2 : 1;
        }
        break;

      case 'H':
        // H is silent between vowels or at end after vowel
        if (isVowel(charAt(pos + 1)) && (pos === 0 || !isVowel(charAt(pos - 1)))) {
          primary += 'H';
        }
        pos++;
        break;

      case 'J':
        primary += 'J';
        pos += (charAt(pos + 1) === 'J') ? 2 : 1;
        break;

      case 'K':
        primary += 'K';
        pos += (charAt(pos + 1) === 'K') ? 2 : 1;
        break;

      case 'L':
        primary += 'L';
        pos += (charAt(pos + 1) === 'L') ? 2 : 1;
        break;

      case 'M':
        primary += 'M';
        pos += (charAt(pos + 1) === 'M') ? 2 : 1;
        break;

      case 'N':
        primary += 'N';
        pos += (charAt(pos + 1) === 'N') ? 2 : 1;
        break;

      case 'P':
        if (charAt(pos + 1) === 'H') {
          primary += 'F';
          pos += 2;
        } else {
          primary += 'P';
          pos += (charAt(pos + 1) === 'P') ? 2 : 1;
        }
        break;

      case 'Q':
        primary += 'K';
        pos += (charAt(pos + 1) === 'Q') ? 2 : 1;
        break;

      case 'R':
        primary += 'R';
        pos += (charAt(pos + 1) === 'R') ? 2 : 1;
        break;

      case 'S':
        if (charAt(pos + 1) === 'H') {
          primary += 'X';
          pos += 2;
        } else if (charAt(pos + 1) === 'I' && 'OA'.includes(charAt(pos + 2))) {
          primary += 'X';
          pos += 3;
        } else {
          primary += 'S';
          pos += (charAt(pos + 1) === 'S') ? 2 : 1;
        }
        break;

      case 'T':
        if (charAt(pos + 1) === 'H') {
          primary += '0'; // TH sound
          pos += 2;
        } else if (charAt(pos + 1) === 'I' && 'OA'.includes(charAt(pos + 2))) {
          primary += 'X';
          pos += 3;
        } else {
          primary += 'T';
          pos += (charAt(pos + 1) === 'T') ? 2 : 1;
        }
        break;

      case 'V':
        primary += 'F';
        pos += (charAt(pos + 1) === 'V') ? 2 : 1;
        break;

      case 'W':
        if (isVowel(charAt(pos + 1))) {
          primary += 'W';
        }
        pos++;
        break;

      case 'X':
        primary += 'KS';
        pos += (charAt(pos + 1) === 'X') ? 2 : 1;
        break;

      case 'Y':
        if (isVowel(charAt(pos + 1))) {
          primary += 'Y';
        }
        pos++;
        break;

      case 'Z':
        primary += 'S';
        pos += (charAt(pos + 1) === 'Z') ? 2 : 1;
        break;

      default:
        pos++;
    }
  }

  return primary;
}

/**
 * Compute Levenshtein distance between two strings.
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
export function levenshtein(a, b) {
  if (!a) return b ? b.length : 0;
  if (!b) return a.length;

  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Check if final word should receive "terminal leniency" grace.
 *
 * Applies phonetic comparison when:
 * - Word is marked incorrect (substitution)
 * - ASR confidence is low (< 0.85)
 * - Phonetic codes match or have distance <= 1
 *
 * @param {string} referenceWord - Expected word from passage
 * @param {string} asrWord - What ASR heard
 * @param {number} asrConfidence - ASR confidence (0-1)
 * @returns {{isMatch: boolean, reason: string|null, refCode: string, asrCode: string}}
 */
export function checkTerminalLeniency(referenceWord, asrWord, asrConfidence) {
  const result = {
    isMatch: false,
    reason: null,
    refCode: '',
    asrCode: ''
  };

  if (!referenceWord || !asrWord) return result;

  // Strict match - no leniency needed
  if (referenceWord.toLowerCase() === asrWord.toLowerCase()) {
    result.isMatch = true;
    result.reason = 'exact';
    return result;
  }

  // Only apply leniency for low-confidence final words
  // Higher threshold (0.85) since we're being lenient
  if (asrConfidence >= 0.85) {
    return result;
  }

  // Get phonetic codes
  const refCode = doubleMetaphone(referenceWord);
  const asrCode = doubleMetaphone(asrWord);

  result.refCode = refCode;
  result.asrCode = asrCode;

  // Exact phonetic match
  if (refCode === asrCode) {
    result.isMatch = true;
    result.reason = 'phonetic_exact';
    return result;
  }

  // Fuzzy phonetic match (distance <= 1)
  const distance = levenshtein(refCode, asrCode);

  // Allow distance 1 for codes of length 2+
  // This catches hen(HN) vs hand(HNT) = distance 1
  if (distance <= 1 && refCode.length >= 2) {
    result.isMatch = true;
    result.reason = 'phonetic_fuzzy';
    return result;
  }

  return result;
}
