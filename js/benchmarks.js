// benchmarks.js – Hasbrouck-Tindal 2017 ORF norms (Technical Report #1702)
// Values from training data — flagged for manual verification against published source.
// Grade 1 has no fall norms (testing begins in winter).

export const HT_NORMS = {
  1: {
    winter: { p10: 12, p25: 28, p50: 53, p75: 82, p90: 111 },
    spring: { p10: 28, p25: 46, p50: 72, p75: 100, p90: 126 }
  },
  2: {
    fall:   { p10: 25, p25: 44, p50: 72, p75: 100, p90: 124 },
    winter: { p10: 42, p25: 64, p50: 89, p75: 114, p90: 136 },
    spring: { p10: 55, p25: 78, p50: 104, p75: 127, p90: 148 }
  },
  3: {
    fall:   { p10: 44, p25: 66, p50: 93, p75: 120, p90: 146 },
    winter: { p10: 61, p25: 82, p50: 108, p75: 133, p90: 157 },
    spring: { p10: 69, p25: 91, p50: 118, p75: 143, p90: 166 }
  },
  4: {
    fall:   { p10: 65, p25: 87, p50: 113, p75: 139, p90: 165 },
    winter: { p10: 74, p25: 98, p50: 125, p75: 152, p90: 177 },
    spring: { p10: 83, p25: 105, p50: 133, p75: 160, p90: 185 }
  },
  5: {
    fall:   { p10: 75, p25: 99, p50: 126, p75: 153, p90: 179 },
    winter: { p10: 84, p25: 109, p50: 136, p75: 163, p90: 189 },
    spring: { p10: 90, p25: 115, p50: 144, p75: 171, p90: 197 }
  },
  6: {
    fall:   { p10: 82, p25: 107, p50: 136, p75: 164, p90: 190 },
    winter: { p10: 89, p25: 115, p50: 145, p75: 173, p90: 199 },
    spring: { p10: 96, p25: 122, p50: 150, p75: 177, p90: 204 }
  }
};

export function getSeason(date) {
  const month = new Date(date).getMonth(); // 0-indexed
  if (month >= 7 && month <= 10) return 'fall';    // Aug-Nov
  if (month >= 11 || month <= 1) return 'winter';  // Dec-Feb
  return 'spring';                                   // Mar-Jul
}

export function getBenchmarkStatus(wcpm, grade, season) {
  const norms = HT_NORMS[grade]?.[season];
  if (!norms) return { status: 'unknown', label: 'No norms available', color: '#757575', norms: null };
  if (wcpm >= norms.p50) return { status: 'on-track', label: 'On Track', color: '#2e7d32', norms };
  if (wcpm >= norms.p25) return { status: 'some-risk', label: 'Some Risk', color: '#f57f17', norms };
  return { status: 'at-risk', label: 'At Risk', color: '#c62828', norms };
}
