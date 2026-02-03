---
phase: 14-disfluency-detection
plan: 02
subsystem: detection
tags: [stutter, severity, classification, merge-eligibility]

# Dependency graph
requires:
  - phase: 14-01
    provides: DISFLUENCY_THRESHOLDS, SEVERITY_LEVELS constants
provides:
  - Severity classification function (calculateSeverity)
  - Fragment merge eligibility function (isMergeEligible)
affects: [14-03-fragment-merging, 14-04-pipeline-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Count-First, Duration-Override severity model"
    - "Length-based fragment merge eligibility"

key-files:
  created: []
  modified:
    - js/disfluency-detector.js

key-decisions:
  - "Check order enforces highest severity wins"
  - "Short fragments (1-3 chars) use prefix matching"
  - "Long fragments (4+ chars) require exact or long prefix"
  - "Substitutions distinguished from stutters by prefix mismatch"

patterns-established:
  - "Severity levels as configurable threshold lookups"
  - "Fragment eligibility as boolean predicate function"

# Metrics
duration: 2min
completed: 2026-02-03
---

# Phase 14 Plan 02: Severity Classification Summary

**Count-First, Duration-Override severity model with merge eligibility check for stutter-vs-substitution distinction**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-03T23:50:00Z
- **Completed:** 2026-02-03T23:52:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Implemented calculateSeverity() with "Count-First, Duration-Override" model per CONTEXT.md
- Implemented isMergeEligible() to distinguish stutters from substitutions
- All severity thresholds use configurable constants from disfluency-config.js
- Edge cases handled (empty strings, single attempts, duration overrides)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add severity classification function** - `9575bf1` (feat)
2. **Task 2: Add merge eligibility check function** - `723e1b1` (feat)

## Files Created/Modified
- `js/disfluency-detector.js` - Added calculateSeverity(), isMergeEligible() functions

## Key Implementation Details

### calculateSeverity()
- 1 attempt = 'none' (clean read)
- 2 attempts = 'minor' (the double take)
- 3-4 attempts = 'moderate' (the struggle)
- 5+ attempts = 'significant' (the block/loop)
- totalDuration >= 2.0s = 'significant' (duration override)
- maxPause >= 0.5s + 2 attempts = 'moderate' (pause override)

### isMergeEligible()
- First char must match target
- Short fragments (1-3 chars): prefix match required
- Long fragments (4+ chars): exact match OR long prefix match
- "sat" before "sit" = substitution (NOT merge)
- "p" before "please" = stutter (merge)

## Decisions Made
- **Check order enforces priority** - Significant checked first, then duration override, then count-based
- **Pause override requires 2+ attempts** - Single attempt with long pause stays 'none'
- **Length threshold at 3 chars** - Balances false positive stutters vs substitutions

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- calculateSeverity() ready for 14-03 fragment merging (will use to score merged words)
- isMergeEligible() ready for 14-03 (will determine which fragments merge into targets)
- Both functions exported for independent testing

---
*Phase: 14-disfluency-detection*
*Completed: 2026-02-03*
