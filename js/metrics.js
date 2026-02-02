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
export function computeAccuracy(alignmentResult) {
  let correctCount = 0, substitutions = 0, omissions = 0, insertions = 0;
  for (const w of alignmentResult) {
    switch (w.type) {
      case 'correct': correctCount++; break;
      case 'substitution': substitutions++; break;
      case 'omission': omissions++; break;
      case 'insertion': insertions++; break;
    }
  }
  const totalRefWords = correctCount + substitutions + omissions;
  const accuracy = totalRefWords === 0
    ? 0
    : Math.round((correctCount / totalRefWords) * 1000) / 10;
  return { accuracy, correctCount, totalRefWords, substitutions, omissions, insertions };
}
