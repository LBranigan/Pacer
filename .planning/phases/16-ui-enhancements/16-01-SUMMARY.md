---
phase: 16-ui-enhancements
plan: 01
subsystem: ui
tags: [tooltip, ensemble, debug, css, rate-anomaly]

# Dependency graph
requires:
  - phase: 15-safety-checks
    provides: _flags array with rate_anomaly flag
  - phase: 11-dual-api
    provides: _debug field with latest/default model results
provides:
  - Enhanced word tooltips with ensemble debug info
  - Visual rate anomaly indicator (dashed orange underline)
affects: [16-02, 16-03, 16-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - buildEnhancedTooltip helper for unified tooltip generation
    - sttWord._debug.latest and _debug.default access pattern

key-files:
  created: []
  modified:
    - js/ui.js
    - style.css
    - index.html

key-decisions:
  - "Flags shown as text list in tooltip (no icons)"
  - "Duration shown in ms alongside timestamp range"
  - "Rate anomaly uses dashed underline, not badge"

patterns-established:
  - "Enhanced tooltip pattern: buildEnhancedTooltip(item, sttWord) for unified debug info display"

# Metrics
duration: 5min
completed: 2026-02-03
---

# Phase 16 Plan 01: Word Tooltips with Ensemble Debug Summary

**Enhanced word tooltips showing dual model results, timestamps with duration, and flags as text list; rate anomaly words marked with dashed orange underline**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-03T17:35:00Z
- **Completed:** 2026-02-03T17:40:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added `.word-rate-anomaly` CSS class with dashed orange underline
- Created `buildEnhancedTooltip()` function with full ensemble debug display
- Tooltips now show timestamps with duration format: "0.50s - 0.80s (300ms)"
- Both model results displayed when _debug field exists: latest_long and default
- Flags displayed as text list: "Flags: rate_anomaly, ghost"
- Rate anomaly words receive visual indicator class

## Task Commits

Each task was committed atomically:

1. **Task 1: Add rate anomaly CSS class** - `69f2f89` (style)
2. **Task 2: Extend tooltip with ensemble debug info** - `8d29424` (feat)

## Files Created/Modified
- `style.css` - Added .word-rate-anomaly class with dashed underline styling
- `js/ui.js` - Added buildEnhancedTooltip function, integrated into displayAlignmentResults
- `index.html` - Updated version timestamp

## Decisions Made
- Flags shown as text list per CONTEXT.md ("no icons in tooltip")
- Duration calculated as (end - start) * 1000 and shown in ms
- Rate anomaly visual is dashed underline, distinct from correctness colors per CONTEXT.md

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Tooltip infrastructure ready for additional debug info in future plans
- Rate anomaly visual styling in place for safety check indicators
- Ready for 16-02: Confidence collapse UI banner

---
*Phase: 16-ui-enhancements*
*Completed: 2026-02-03*
