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
 * Regular insertions are NOT counted as errors per ORF standard.
 * Confirmed insertions (all engines agreed) ARE counted as errors.
 * @param {Array<{type: string}>} alignmentResult - From alignWords()
 * @returns {{ accuracy: number, correctCount: number, totalRefWords: number, substitutions: number, omissions: number, insertions: number }}
 */
export function computeAccuracy(alignmentResult, options = {}) {
  let correctCount = 0, wordErrors = 0, omissions = 0, insertionErrors = 0, forgiven = 0;
  const longPauseErrors = options.longPauseCount || 0;
  for (const w of alignmentResult) {
    switch (w.type) {
      case 'correct':
        correctCount++;
        break;
      case 'substitution':
        if (w.forgiven) {
          correctCount++;
          forgiven++;
        } else {
          wordErrors++;
        }
        break;
      case 'struggle':
        // Compound fragments — orange bucket
        wordErrors++;
        break;
      case 'omission':
        if (w.forgiven) {
          correctCount++;
          forgiven++;
        } else {
          omissions++;
        }
        break;
      case 'insertion':
        // Only confirmed insertions count (all available engines agreed on same extra word)
        if (w._confirmedInsertion) {
          insertionErrors++;
        }
        break;
    }
  }
  // ORF formula: accuracy = (Total Words Attempted − Errors) / Total Words Attempted
  // totalRefWords = passage length (fixed), errors don't inflate word count
  const totalRefWords = correctCount + wordErrors + omissions;
  const totalErrors = wordErrors + omissions + longPauseErrors + insertionErrors;
  const accuracy = totalRefWords === 0
    ? 0
    : Math.round(((totalRefWords - totalErrors) / totalRefWords) * 1000) / 10;
  return { accuracy, correctCount, totalRefWords, totalErrors, wordErrors, omissions, insertionErrors, forgiven, longPauseErrors };
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
