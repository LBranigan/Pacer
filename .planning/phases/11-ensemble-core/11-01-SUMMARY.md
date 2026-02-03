---
phase: 11-ensemble-core
plan: 01
subsystem: api
tags: [stt, google-cloud, promise-allsettled, parallel-api, ensemble]

# Dependency graph
requires:
  - phase: 10-configuration
    provides: getDefaultModelConfig for default model STT config
provides:
  - sendEnsembleSTT function for parallel dual-model API calls
  - fetchSTTRaw internal helper for clean STT fetch operations
affects: [11-02, 11-03, ensemble-merger]

# Tech tracking
tech-stack:
  added: []
  patterns: [Promise.allSettled for parallel fault-tolerant API calls]

key-files:
  created: []
  modified: [js/stt-api.js]

key-decisions:
  - "Promise.allSettled over Promise.all - ensures both results return even if one fails"
  - "No UI status calls from sendEnsembleSTT - caller handles presentation"
  - "Structured return object with separate errors property for granular failure handling"

patterns-established:
  - "fetchSTTRaw helper: internal reusable raw fetch for STT API"
  - "Ensemble return shape: { latestLong, default, errors: { latestLong, default } }"

# Metrics
duration: 3min
completed: 2026-02-03
---

# Phase 11 Plan 01: Parallel API Calls Summary

**sendEnsembleSTT function calling latest_long and default models in parallel via Promise.allSettled**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-03T21:02:07Z
- **Completed:** 2026-02-03T21:05:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `sendEnsembleSTT()` exported function for parallel dual-model STT
- Added `fetchSTTRaw()` internal helper for clean API call logic
- Uses `Promise.allSettled` ensuring both results return even if one model fails
- Returns structured object with granular error tracking per model

## Task Commits

Each task was committed atomically:

1. **Tasks 1-2: Add sendEnsembleSTT + fetchSTTRaw helper** - `3cde60b` (feat)

**Plan metadata:** Pending final commit

## Files Created/Modified
- `js/stt-api.js` - Added fetchSTTRaw helper (lines 67-88) and sendEnsembleSTT function (lines 282-319)
- `index.html` - Version timestamp updated to v 2026-02-03 21:05

## Decisions Made
- Used `Promise.allSettled` instead of `Promise.all` to handle partial failures gracefully
- No `setStatus()` calls from `sendEnsembleSTT` - allows caller to control UI messaging
- Structured return object separates successful responses from errors for flexible handling

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `sendEnsembleSTT` ready to be integrated into recording flow
- Next plan (11-02) will create ensemble-merger.js for combining model results
- `fetchSTTRaw` helper available for any future single-model API needs

---
*Phase: 11-ensemble-core*
*Completed: 2026-02-03*
