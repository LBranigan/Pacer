---
phase: 16-ui-enhancements
plan: 03
subsystem: ui-display
tags: [wcpm, range, disfluency, fluency-summary, collapse-banner]
dependencies:
  requires: [14-disfluency, 15-safety]
  provides: [wcpm-range-display, fluency-summary-ui, collapse-banner]
  affects: [teacher-interpretation]
tech-stack:
  added: []
  patterns: [conservative-underpromise]
key-files:
  created: []
  modified:
    - style.css
    - js/metrics.js
    - js/ui.js
    - js/app.js
    - index.html
decisions:
  - id: wcpm-conservative-primary
    choice: "Show wcpmMin (conservative) as primary value"
    rationale: "Underpromise philosophy - better to report lower and be accurate"
  - id: range-conditional-display
    choice: "Only show range when wcpmMin differs from wcpmMax"
    rationale: "Avoid clutter for clean reads with no disfluency"
  - id: fluency-summary-location
    choice: "Fluency summary directly below WCPM box"
    rationale: "Per CONTEXT.md - keeps related data grouped"
metrics:
  duration: 2.5min
  completed: 2026-02-04
---

# Phase 16 Plan 03: WCPM Range Display Summary

WCPM now displays as a range (e.g., 85-92) with conservative min value primary, fluency concerns summary below showing disfluency counts by severity, and collapse banner for unreliable results.

## What Was Done

### Task 1: CSS for WCPM Range and Fluency Summary
- Added `.wcpm-container` with flex column layout for vertical stacking
- Added `.wcpm-primary` for large, prominent min value display
- Added `.wcpm-range` for smaller range text below
- Added `.wcpm-label` for WCPM label styling
- Added `.fluency-summary` with severity-specific color classes (red/orange/yellow)
- Added `.collapse-banner` for warning when results are unreliable

### Task 2: computeWCPMRange Function
- New function in `metrics.js` alongside existing `computeWCPM`
- Returns `{ wcpmMin, wcpmMax, correctCount, elapsedSeconds }`
- wcpmMax: Standard WCPM counting all correct words
- wcpmMin: Conservative WCPM excluding words with significant/moderate disfluency
- Graceful fallback when severity data unavailable (wcpmMin equals wcpmMax)

### Task 3: displayAlignmentResults Updates
- Added `disfluencySummary` and `safetyData` parameters to function signature
- Collapse state handling: Shows warning banner instead of WCPM when `safetyData.collapse.collapsed`
- WCPM range display: Primary value prominent with range below
- Fluency summary: Shows "X significant, Y moderate, Z minor" with severity colors
- Conditional range display: Only shows range when min differs from max

### Task 4: app.js Wiring
- Added `computeWCPMRange` to imports from `metrics.js`
- Replaced `computeWCPM(alignment, effectiveElapsedSeconds)` with `computeWCPMRange`
- Pass `disfluencyResult.summary` to displayAlignmentResults (from Phase 14)
- Pass `safetyResult._safety` to displayAlignmentResults (from Phase 15)

## Key Implementation Details

### Range Calculation Logic
```javascript
// Standard WCPM (max) - all correct words
const wcpmMax = Math.round((correctCount / elapsedSeconds) * 60 * 10) / 10;

// Conservative WCPM (min) - exclude words with significant/moderate disfluency
const confidentCorrect = correctWords.filter(w => {
  const severity = w.severity || 'none';
  return severity === 'none' || severity === 'minor';
}).length;
const wcpmMin = Math.round((confidentCorrect / elapsedSeconds) * 60 * 10) / 10;
```

### Display Logic
- Collapse state: Show warning banner, hide WCPM
- Normal state with range: Show "85" prominently, "85-92 WCPM" below
- No range (min equals max): Show single value
- Fluency summary only appears if `totalWordsWithDisfluency > 0`

## Commits

| Hash | Message |
|------|---------|
| 3cb1d75 | feat(16-03): add WCPM range and fluency summary CSS |
| 7a8209a | feat(16-03): add computeWCPMRange function |
| 81ff9e0 | feat(16-03): update displayAlignmentResults for WCPM range |
| 162b7ec | feat(16-03): wire computeWCPMRange and pass new UI parameters |
| d8e3258 | chore(16-03): update version timestamp |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- [x] style.css contains `.wcpm-container`, `.wcpm-primary`, `.wcpm-range`
- [x] style.css contains `.fluency-summary` with severity color classes
- [x] style.css contains `.collapse-banner` styling
- [x] metrics.js exports `computeWCPMRange` function
- [x] ui.js displayAlignmentResults handles wcpmMin/wcpmMax
- [x] ui.js shows fluency summary with colored severity counts
- [x] ui.js shows collapse banner when safetyData.collapse.collapsed is true
- [x] app.js imports `computeWCPMRange` from metrics.js
- [x] app.js calls `computeWCPMRange` instead of `computeWCPM`
- [x] app.js passes disfluencyResult.summary to displayAlignmentResults
- [x] app.js passes safetyResult._safety to displayAlignmentResults

## Next Phase Readiness

Plan 03 complete. Ready for Plan 04 (calibration UI) if it exists, otherwise Phase 16 complete.
