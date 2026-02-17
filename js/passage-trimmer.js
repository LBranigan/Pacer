import { normalizeText, filterDisfluencies } from './text-normalize.js';

/**
 * Character-level Levenshtein distance.
 */
function levenshteinDistance(s1, s2) {
  const m = s1.length, n = s2.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/**
 * Common OCR confusion pairs — machine errors that should not penalize students.
 */
const OCR_CONFUSIONS = [
  ['0', 'o'], ['1', 'l'], ['1', 'i'], ['5', 's'], ['8', 'b'], ['6', 'g'],
  ['rn', 'm'], ['cl', 'd'], ['vv', 'w'], ['li', 'h'], ['ii', 'u'],
  ['c', 'e'], ['n', 'h']
];

function normalizeOcrConfusions(word) {
  let w = word;
  for (const [ocrChar, actual] of OCR_CONFUSIONS) {
    w = w.replaceAll(ocrChar, actual);
  }
  return w;
}

/**
 * Calculate similarity between two normalized words (0–1).
 * Handles OCR confusions, prefix matching, and Levenshtein distance.
 */
export function calculateWordSimilarity(w1, w2) {
  if (!w1 || !w2) return 0;
  if (w1 === w2) return 1.0;

  // OCR confusion normalization
  const w1Ocr = normalizeOcrConfusions(w1);
  const w2Ocr = normalizeOcrConfusions(w2);
  if (w1Ocr === w2Ocr) return 1.0;

  // Prefix matching (same first 3+ characters)
  const minLen = Math.min(w1.length, w2.length);
  if (minLen >= 3 && w1.substring(0, 3) === w2.substring(0, 3)) {
    const lengthRatio = minLen / Math.max(w1.length, w2.length);
    return 0.6 + 0.35 * lengthRatio;
  }

  // Levenshtein-based similarity (best of raw and OCR-normalized)
  const dist = levenshteinDistance(w1, w2);
  const ocrDist = levenshteinDistance(w1Ocr, w2Ocr);
  const bestDist = Math.min(dist, ocrDist);
  const maxLen = Math.max(w1.length, w2.length);
  const sim = 1 - bestDist / maxLen;

  // Same-length bonus
  const lengthBonus = w1.length === w2.length ? 0.1 : 0;
  return Math.min(1, sim + lengthBonus);
}

/**
 * Build similarity matrix between spoken and OCR words.
 */
function buildSimilarityMatrix(spoken, ocr) {
  const matrix = [];
  for (let s = 0; s < spoken.length; s++) {
    matrix[s] = new Float64Array(ocr.length);
    for (let o = 0; o < ocr.length; o++) {
      matrix[s][o] = calculateWordSimilarity(spoken[s], ocr[o]);
    }
  }
  return matrix;
}

/**
 * Find where in the OCR text the student started and stopped reading.
 * Uses 2D semi-global alignment: free leading/trailing OCR gaps so the
 * student can start and end anywhere in the passage, with penalized gaps
 * in the middle (skipped OCR words during reading).
 *
 * @param {string[]} spokenNorm  Normalized spoken words (disfluencies removed)
 * @param {string[]} ocrNorm     Normalized OCR words
 * @returns {{ firstIndex: number, lastIndex: number, matchedCount: number }}
 */
export function findSpokenRangeInOCR(spokenNorm, ocrNorm) {
  if (spokenNorm.length === 0 || ocrNorm.length === 0) {
    return { firstIndex: 0, lastIndex: ocrNorm.length - 1, matchedCount: 0 };
  }

  const simMatrix = buildSimilarityMatrix(spokenNorm, ocrNorm);

  const m = spokenNorm.length;
  const n = ocrNorm.length;

  const MATCH_THRESHOLD = 0.55;
  const SKIP_PENALTY = 0.3;   // OCR word skipped during reading
  const GAP_PENALTY = 0.4;    // Spoken word with no OCR match

  // dp[s][o] = best score aligning spoken[0..s-1] to OCR[0..o-1]
  // Semi-global: free leading OCR gaps (dp[0][o] = 0), free trailing (max over o at end)
  const dp = Array.from({ length: m + 1 }, () => new Float64Array(n + 1));
  // Pointer: 0=none, 1=diag(match), 2=up(skip spoken), 3=left(skip OCR)
  const ptr = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1));

  // dp[0][o] = 0 for all o (free to start at any OCR position) — already zero
  // dp[s][0] = skip all spoken words
  for (let s = 1; s <= m; s++) {
    dp[s][0] = dp[s - 1][0] - GAP_PENALTY;
    ptr[s][0] = 2;
  }

  for (let s = 1; s <= m; s++) {
    for (let o = 1; o <= n; o++) {
      // Skip spoken word (no OCR match for this word)
      let best = dp[s - 1][o] - GAP_PENALTY;
      let bestPtr = 2;

      // Skip OCR word (student didn't read this word)
      const skipOCR = dp[s][o - 1] - SKIP_PENALTY;
      if (skipOCR > best) { best = skipOCR; bestPtr = 3; }

      // Match spoken to OCR
      const sim = simMatrix[s - 1][o - 1];
      if (sim >= MATCH_THRESHOLD) {
        const matchScore = dp[s - 1][o - 1] + sim;
        if (matchScore > best) { best = matchScore; bestPtr = 1; }
      }

      dp[s][o] = best;
      ptr[s][o] = bestPtr;
    }
  }

  // Free trailing OCR gaps: find best ending position
  let bestO = 0;
  for (let o = 1; o <= n; o++) {
    if (dp[m][o] > dp[m][bestO]) bestO = o;
  }

  // Traceback to find first and last matched OCR positions
  let s = m, o = bestO;
  let firstOCR = -1, lastOCR = -1, matchCount = 0;

  while (s > 0 && o > 0) {
    const p = ptr[s][o];
    if (p === 1) { // match
      if (lastOCR === -1) lastOCR = o - 1;
      firstOCR = o - 1;
      matchCount++;
      s--; o--;
    } else if (p === 2) { // skip spoken
      s--;
    } else { // skip OCR
      o--;
    }
  }

  if (firstOCR === -1 || lastOCR === -1 || matchCount < 2) {
    return { firstIndex: 0, lastIndex: ocrNorm.length - 1, matchedCount: 0 };
  }

  return { firstIndex: firstOCR, lastIndex: lastOCR, matchedCount: matchCount };
}

/**
 * Trim an OCR passage to just the words the student attempted.
 *
 * IMPORTANT: Operates on original (non-normalized) token indices by maintaining
 * a mapping between normalized words and their original token positions.
 *
 * @param {string} ocrText           Full OCR text
 * @param {Array} transcriptWords    STT word objects (with .word property)
 * @returns {string} Trimmed passage text
 */
export function trimPassageToAttempted(ocrText, transcriptWords) {
  if (!ocrText || !transcriptWords || transcriptWords.length === 0) return ocrText || '';

  // Normalize spoken words
  const sttRaw = transcriptWords.map(w => w.word || w);
  const sttNorm = filterDisfluencies(normalizeText(sttRaw.join(' ')));

  if (sttNorm.length < 5) return ocrText; // too few words to align reliably

  // Split OCR into original tokens and build normalized→original index mapping
  const ocrTokens = ocrText.split(/\s+/).filter(t => t.length > 0);
  const normToOrigIndex = []; // normToOrigIndex[i] = original token index for normalized word i
  const ocrNorm = [];

  for (let t = 0; t < ocrTokens.length; t++) {
    const norm = ocrTokens[t].toLowerCase().replace(/^[^\w'-]+|[^\w'-]+$/g, '');
    if (norm.length > 0) {
      ocrNorm.push(norm);
      normToOrigIndex.push(t);
    }
  }

  if (ocrNorm.length === 0) return ocrText;

  const { firstIndex, lastIndex, matchedCount } = findSpokenRangeInOCR(sttNorm, ocrNorm);

  // If very few matches, alignment is unreliable — return full text
  if (matchedCount < 2) return ocrText;

  // Map normalized indices back to original token indices
  const origStart = normToOrigIndex[firstIndex];
  const origEnd = normToOrigIndex[lastIndex];

  // ASR fusion detection at the end boundary.
  // When ASR fuses the last word with subsequent ones (e.g., "long"+"term" →
  // "longterm"), the DP matches the fused word to the first half and stops there,
  // cutting off the rest. Detect this by checking if the last spoken word is a
  // concatenation of the boundary OCR word + following OCR word(s). Only extend
  // the boundary when there's concrete evidence of fusion — no blind buffer.
  const start = origStart;
  let end = origEnd;

  const lastSpoken = sttNorm[sttNorm.length - 1];
  const lastMatchedOCR = ocrNorm[lastIndex];
  if (lastSpoken !== lastMatchedOCR && lastIndex + 1 < ocrNorm.length) {
    let combined = lastMatchedOCR;
    for (let k = lastIndex + 1; k < Math.min(lastIndex + 3, ocrNorm.length); k++) {
      combined += ocrNorm[k];
      if (combined === lastSpoken) {
        end = normToOrigIndex[k];
        break;
      }
    }
  }

  return ocrTokens.slice(start, end + 1).join(' ');
}
