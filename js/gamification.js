/**
 * Gamification scoring module -- pure logic, no DOM or storage.
 * Computes points, streaks, level, bonus, and progress from alignment data.
 */

/**
 * @param {Array<{type: string, ref?: string, hyp?: string}>} alignment
 * @param {number[]} pastScores - previous total scores for progress calc
 * @returns {{totalPoints: number, bestStreak: number, currentStreak: number, level: number, bonus: number, progress: number|null, wordsCorrect: number, wordsTotal: number}}
 */
export function computeScore(alignment, pastScores) {
  let wordsCorrect = 0;
  let currentStreak = 0;
  let bestStreak = 0;

  const nonInsertions = alignment.filter(a => a.type !== 'insertion');
  const wordsTotal = nonInsertions.length;

  for (const item of nonInsertions) {
    if (item.type === 'correct') {
      wordsCorrect++;
      currentStreak++;
      if (currentStreak > bestStreak) {
        bestStreak = currentStreak;
      }
    } else {
      // substitution or omission breaks streak
      currentStreak = 0;
    }
  }

  const basePoints = wordsCorrect * 10;
  const bonus = bestStreak >= 5 ? bestStreak * 2 : 0;
  const totalPoints = basePoints + bonus;

  const level = Math.min(Math.floor(totalPoints / 100) + 1, 10);

  let progress = null;
  if (pastScores && pastScores.length > 0) {
    const avg = pastScores.reduce((sum, s) => sum + s, 0) / pastScores.length;
    if (avg === 0) {
      progress = totalPoints > 0 ? 2 : 0;
    } else {
      progress = Math.min(Math.max(totalPoints / avg, 0), 2);
    }
  }

  return { totalPoints, bestStreak, currentStreak, level, bonus, progress, wordsCorrect, wordsTotal };
}
