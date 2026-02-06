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
 * Uses DP alignment trying multiple starting positions — matches the proven
 * approach from the Word Analyzer iPad app's findSpokenRangeInOCR.
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
  const SKIP_PENALTY = 0.3;
  const GAP_PENALTY = 0.4;

  let bestScore = 0;
  let bestStartOCR = -1;
  let bestEndOCR = -1;
  let bestMatchCount = 0;

  // Try different starting positions in OCR
  for (let startOCR = 0; startOCR < n; startOCR++) {
    const dp = new Array(m + 1);
    for (let k = 0; k <= m; k++) {
      dp[k] = { score: 0, matchCount: 0, lastOCR: startOCR - 1, firstOCR: -1 };
    }

    for (let s = 0; s < m; s++) {
      const prev = dp[s];

      // Try matching spoken[s] to each OCR word after the previous match
      for (let o = prev.lastOCR + 1; o < n; o++) {
        const sim = simMatrix[s][o];

        if (sim >= MATCH_THRESHOLD) {
          const skippedOCR = o - prev.lastOCR - 1;
          const skipPen = skippedOCR * SKIP_PENALTY;
          const newScore = prev.score + sim - skipPen;

          if (newScore > dp[s + 1].score) {
            dp[s + 1] = {
              score: newScore,
              matchCount: prev.matchCount + 1,
              lastOCR: o,
              firstOCR: prev.firstOCR === -1 ? o : prev.firstOCR
            };
          }
        }
      }

      // Allow skipping spoken words (student said something not in text)
      if (dp[s].score - GAP_PENALTY > dp[s + 1].score) {
        dp[s + 1] = {
          score: dp[s].score - GAP_PENALTY,
          matchCount: dp[s].matchCount,
          lastOCR: dp[s].lastOCR,
          firstOCR: dp[s].firstOCR
        };
      }
    }

    const final = dp[m];
    if (final.matchCount >= 2 && final.score > bestScore) {
      bestScore = final.score;
      bestEndOCR = final.lastOCR;
      bestStartOCR = final.firstOCR;
      bestMatchCount = final.matchCount;
    }
  }

  // Fallback: no good alignment found
  if (bestStartOCR === -1 || bestEndOCR === -1) {
    return { firstIndex: 0, lastIndex: ocrNorm.length - 1, matchedCount: 0 };
  }

  return { firstIndex: bestStartOCR, lastIndex: bestEndOCR, matchedCount: bestMatchCount };
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
