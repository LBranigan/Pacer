// readability.js — Passage reading level estimation
//
// Computes 3 established readability formulas and reports the median as a
// grade-level band. Designed for ORF passages (100-250 words). Accuracy is
// ±2 grade levels on short text — report a band, not a point estimate.

import { countSyllables } from './syllable-counter.js';

// ── Dale-Chall familiar word set (loaded async) ─────────────────────────

let _daleChallSet = null;

async function loadDaleChallList() {
  if (_daleChallSet) return _daleChallSet;
  const resp = await fetch('data/dale-chall.json');
  const words = await resp.json();
  _daleChallSet = new Set(words);
  return _daleChallSet;
}

// ── Sentence splitting ──────────────────────────────────────────────────

function countSentences(text) {
  // Split on sentence-ending punctuation. Handles "Mr.", "Dr.", "U.S." etc.
  // by requiring the period to be followed by whitespace + capital or end-of-string.
  const endings = text.match(/[.!?]+(?:\s|$)/g);
  return Math.max(endings ? endings.length : 1, 1);
}

// ── Character/letter counting ───────────────────────────────────────────

function countLetters(words) {
  // Count alphabetic characters only (for Coleman-Liau)
  return words.reduce((sum, w) => sum + w.replace(/[^a-zA-Z]/g, '').length, 0);
}

// ── Formulas ────────────────────────────────────────────────────────────

function fleschKincaidGrade(wordCount, sentenceCount, syllableCount) {
  if (!wordCount || !sentenceCount) return NaN;
  return 0.39 * (wordCount / sentenceCount) + 11.8 * (syllableCount / wordCount) - 15.59;
}

function colemanLiauIndex(wordCount, sentenceCount, letterCount) {
  if (!wordCount || !sentenceCount) return NaN;
  const L = (letterCount / wordCount) * 100;
  const S = (sentenceCount / wordCount) * 100;
  return 0.0588 * L - 0.296 * S - 15.8;
}

function daleChallScore(wordCount, sentenceCount, difficultWordCount) {
  if (!wordCount || !sentenceCount) return NaN;
  const pctDifficult = difficultWordCount / wordCount;
  let score = 0.1579 * (pctDifficult * 100) + 0.0496 * (wordCount / sentenceCount);
  if (pctDifficult > 0.05) score += 3.6365;
  return score;
}

// Dale-Chall raw score → grade level mapping (New Dale-Chall 1995)
function daleChallToGrade(score) {
  if (score <= 4.9) return 3;    // Grade 3 and below
  if (score <= 5.9) return 5;    // Grade 4-5
  if (score <= 6.9) return 7;    // Grade 6-7
  if (score <= 7.9) return 9;    // Grade 8-9
  if (score <= 8.9) return 11;   // Grade 10-11
  return 13;                     // Grade 12+
}

// ── Grade band formatting ───────────────────────────────────────────────

function gradeBand(median) {
  const clamped = Math.max(1, Math.min(median, 16));
  const low = Math.max(1, Math.floor(clamped));
  const high = Math.min(low + 1, 13);
  if (low >= 13) return '12+';
  if (low <= 1) return 'K-1';
  return low + '-' + high;
}

function gradeLabel(grade) {
  if (grade <= 1) return 'Early Elementary';
  if (grade <= 3) return 'Elementary';
  if (grade <= 5) return 'Upper Elementary';
  if (grade <= 8) return 'Middle School';
  if (grade <= 12) return 'High School';
  return 'College';
}

// ── Main entry point ────────────────────────────────────────────────────

/**
 * Analyze passage readability and return grade-level estimates.
 * @param {string} referenceText - The raw passage text
 * @returns {Promise<{band: string, median: number, label: string, formulas: Object, stats: Object}>}
 */
export async function analyzeReadability(referenceText) {
  if (!referenceText || referenceText.trim().length === 0) return null;

  const daleChallList = await loadDaleChallList();

  // Tokenize
  const text = referenceText.trim();
  const rawWords = text.split(/\s+/).filter(Boolean);
  // Clean words for analysis (strip leading/trailing punctuation, lowercase)
  const cleanWords = rawWords.map(w => w.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '').toLowerCase()).filter(w => w.length > 0);

  const wordCount = cleanWords.length;
  if (wordCount < 10) return null; // Too short for any formula

  const sentenceCount = countSentences(text);
  const syllableCount = cleanWords.reduce((sum, w) => sum + countSyllables(w), 0);
  const letterCount = countLetters(cleanWords);

  // Dale-Chall: count words NOT in the familiar list
  const difficultWords = cleanWords.filter(w => {
    const base = w.replace(/['']/g, ''); // strip apostrophes
    // Skip numbers
    if (/^\d+$/.test(base)) return false;
    // Check the word and its base form (strip trailing s/es/ed/ing)
    if (daleChallList.has(base)) return false;
    if (base.endsWith('s') && daleChallList.has(base.slice(0, -1))) return false;
    if (base.endsWith('es') && daleChallList.has(base.slice(0, -2))) return false;
    if (base.endsWith('ed') && daleChallList.has(base.slice(0, -2))) return false;
    if (base.endsWith('d') && daleChallList.has(base.slice(0, -1))) return false;
    if (base.endsWith('ing') && daleChallList.has(base.slice(0, -3))) return false;
    if (base.endsWith('ing') && daleChallList.has(base.slice(0, -3) + 'e')) return false;
    if (base.endsWith('ly') && daleChallList.has(base.slice(0, -2))) return false;
    if (base.endsWith('er') && daleChallList.has(base.slice(0, -2))) return false;
    if (base.endsWith('est') && daleChallList.has(base.slice(0, -3))) return false;
    return true;
  });

  // Compute all three formulas
  const fk = fleschKincaidGrade(wordCount, sentenceCount, syllableCount);
  const cl = colemanLiauIndex(wordCount, sentenceCount, letterCount);
  const dcRaw = daleChallScore(wordCount, sentenceCount, difficultWords.length);
  const dcGrade = daleChallToGrade(dcRaw);

  // Median of three grade estimates
  const grades = [fk, cl, dcGrade].filter(g => !isNaN(g)).sort((a, b) => a - b);
  const median = grades.length === 3
    ? grades[1]
    : grades.length === 2
      ? (grades[0] + grades[1]) / 2
      : grades[0] || NaN;

  if (isNaN(median)) return null;

  const band = gradeBand(median);
  const label = gradeLabel(median);

  return {
    band,
    median: Math.round(median * 10) / 10,
    label,
    formulas: {
      fleschKincaid: Math.round(fk * 10) / 10,
      colemanLiau: Math.round(cl * 10) / 10,
      daleChallRaw: Math.round(dcRaw * 10) / 10,
      daleChallGrade: dcGrade,
    },
    stats: {
      words: wordCount,
      sentences: sentenceCount,
      syllables: syllableCount,
      syllablesPerWord: Math.round((syllableCount / wordCount) * 100) / 100,
      avgSentenceLength: Math.round((wordCount / sentenceCount) * 10) / 10,
      difficultWords: difficultWords.length,
      pctDifficult: Math.round((difficultWords.length / wordCount) * 1000) / 10,
      difficultWordList: difficultWords.slice(0, 15), // Top 15 for tooltip
    },
  };
}
