---
phase: 11-ensemble-core
plan: 02
subsystem: api
tags: [ensemble, temporal-alignment, stt, merge-algorithm]

# Dependency graph
requires:
  - phase: 11-01
    provides: sendEnsembleSTT parallel API calls returning latestLong/default results
provides:
  - mergeEnsembleResults() temporal word association
  - extractWordsFromSTT() STT response parser
  - computeEnsembleStats() agreement metrics
affects: [11-03, 11-04, 16-debug-ui]

# Tech tracking
tech-stack:
  added: []
  patterns: [temporal-overlap-matching, jitter-tolerance-buffer]

key-files:
  created: [js/ensemble-merger.js]
  modified: []

key-decisions:
  - "50ms jitter tolerance for CTC/Conformer timestamp drift"
  - "latest_long model takes priority when both models detect a word"
  - "Words matched by timestamp overlap, not text content"

patterns-established:
  - "Temporal word association: Math.max(start1, start2) < Math.min(end1, end2)"
  - "Source tagging: both, latest_only, default_only for debugging"
  - "_debug property on merged words for model comparison"

# Metrics
duration: 2min
completed: 2026-02-03
---

# Phase 11 Plan 02: Temporal Word Association Summary

**Temporal word merger using 50ms jitter-tolerant interval overlap detection with source tagging and debug data**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-03T21:02:51Z
- **Completed:** 2026-02-03T21:04:52Z
- **Tasks:** 2
- **Files created:** 1

## Accomplishments
- Temporal word association algorithm that matches words by timestamp overlap (not text)
- Handles stutters/disfluencies correctly (e.g., "th-th-the" matches "the" by timing)
- Source tagging (both/latest_only/default_only) for confidence arbitration
- _debug property captures both model results for debugging
- Agreement metrics for UI display in Phase 16

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ensemble-merger.js with core functions** - `d933dfe` (feat)
2. **Task 2: Add statistics to merged result** - `014c0f0` (feat)

## Files Created
- `js/ensemble-merger.js` - Temporal word association and merge logic with 3 exports

## Decisions Made
- 50ms jitter tolerance per STATE.md decision (handles CTC vs Conformer timestamp drift)
- latest_long model is primary source when both detect word (better rare word handling)
- Text content deliberately NOT used for matching (stutters break text matching)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - implementation straightforward following plan specification.

## Next Phase Readiness
- mergeEnsembleResults() ready for 11-03 confidence arbitration
- Source tags enable confidence voting (both = high agreement, *_only = model specific)
- _debug data available for Phase 16 debug UI display

---
*Phase: 11-ensemble-core*
*Completed: 2026-02-03*
