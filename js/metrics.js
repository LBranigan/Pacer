/**
 * Oral reading fluency metrics: WCPM and accuracy.
 */

/**
 * Compute Words Correct Per Minute (WCPM).
 * @param {Array<{type: string}>} alignmentResult - From alignWords()
 * @param {number} elapsedSeconds - Reading duration in seconds
 * @returns {{ wcpm: number, correctCount: number, elapsedSeconds: number }}
 */
export function computeWCPM(alignmentResult, elapsedSeconds) {
  if (!elapsedSeconds || elapsedSeconds <= 0) {
    return { wcpm: 0, correctCount: 0, elapsedSeconds: elapsedSeconds || 0 };
  }
  const correctCount = alignmentResult.filter(w => w.type === 'correct').length;
  const wcpm = Math.round((correctCount / elapsedSeconds) * 60 * 10) / 10;
  return { wcpm, correctCount, elapsedSeconds };
}

/**
 * Compute reading accuracy and error breakdown.
 * Insertions are NOT counted as errors per ORF standard.
 * @param {Array<{type: string}>} alignmentResult - From alignWords()
 * @returns {{ accuracy: number, correctCount: number, totalRefWords: number, substitutions: number, omissions: number, insertions: number }}
 */
export function computeAccuracy(alignmentResult, options = {}) {
  let correctCount = 0, substitutions = 0, omissions = 0, insertions = 0, forgiven = 0;
  for (const w of alignmentResult) {
    switch (w.type) {
      case 'correct':
        correctCount++;
        break;
      case 'substitution':
        // Proper noun forgiveness: count as correct if flagged as forgiven
        if (w.forgiven) {
          correctCount++;
          forgiven++;
        } else {
          substitutions++;
        }
        break;
      case 'omission':
        // Proper noun forgiveness for omissions too
        if (w.forgiven) {
          correctCount++;
          forgiven++;
        } else {
          omissions++;
        }
        break;
      case 'insertion': insertions++; break;
    }
  }
  const totalRefWords = correctCount + substitutions + omissions;
  const accuracy = totalRefWords === 0
    ? 0
    : Math.round((correctCount / totalRefWords) * 1000) / 10;
  return { accuracy, correctCount, totalRefWords, substitutions, omissions, insertions, forgiven };
}

/**
 * Compute WCPM range accounting for uncertainty from disfluencies.
 * Per CONTEXT.md: Conservative (min) value is primary.
 *
 * Range calculation:
 * - wcpmMin: Excludes words with significant/moderate disfluency (they may not have been "correctly" read)
 * - wcpmMax: Standard WCPM (all correct words counted)
 *
 * @param {Array<{type: string, severity?: string}>} alignmentResult - From alignWords() with disfluency data
 * @param {number} elapsedSeconds - Reading duration in seconds
 * @returns {{ wcpmMin: number, wcpmMax: number, correctCount: number, elapsedSeconds: number }}
 */
export function computeWCPMRange(alignmentResult, elapsedSeconds) {
  if (!elapsedSeconds || elapsedSeconds <= 0) {
    return { wcpmMin: 0, wcpmMax: 0, correctCount: 0, elapsedSeconds: elapsedSeconds || 0 };
  }

  // Count correct words
  const correctWords = alignmentResult.filter(w => w.type === 'correct');
  const correctCount = correctWords.length;

  // Standard WCPM (max) - all correct words
  const wcpmMax = Math.round((correctCount / elapsedSeconds) * 60 * 10) / 10;

  // Conservative WCPM (min) - exclude words with significant/moderate disfluency
  // These words may have been technically "correct" but with struggle
  const confidentCorrect = correctWords.filter(w => {
    const severity = w.severity || 'none';
    return severity === 'none' || severity === 'minor';
  }).length;

  const wcpmMin = Math.round((confidentCorrect / elapsedSeconds) * 60 * 10) / 10;

  return {
    wcpmMin,
    wcpmMax,
    correctCount,
    elapsedSeconds
  };
}
