---
phase: 13-confidence-classification
plan: 01
subsystem: api
tags: [word-equivalences, homophones, numbers, confidence, thresholds]

# Dependency graph
requires:
  - phase: 11-ensemble-merger
    provides: Word merging with _source field
  - phase: 12-vad-integration
    provides: Ghost detection with _vad field
provides:
  - Extended word equivalences (homophones, numbers 21-100, ordinals)
  - getAllEquivalents() function for reference set building
  - Confidence threshold constants (HIGH=0.93, MEDIUM=0.70)
  - Trust level and flag enums for classifier
affects: [13-02, 13-03, 16-ui-confidence]

# Tech tracking
tech-stack:
  added: []
  patterns: [Object.freeze for config immutability]

key-files:
  created:
    - js/confidence-config.js
  modified:
    - js/word-equivalences.js

key-decisions:
  - "Full number coverage 21-100 with hyphenated and concatenated forms"
  - "Confidence thresholds from CONTEXT.md: HIGH=0.93, MEDIUM=0.70"
  - "VALID_MUMBLE=0.85 (latest_only + in reference)"
  - "HALLUCINATION_RISK=0.50 (latest_only + not in reference)"

patterns-established:
  - "Object.freeze() for all config exports"
  - "ALL_EQUIVALENCE_GROUPS combines multiple group arrays"

# Metrics
duration: 4min
completed: 2026-02-03
---

# Phase 13 Plan 01: Equivalences and Confidence Config Summary

**Extended word equivalences with 36 homophone groups, numbers 21-100 with ordinals, plus confidence threshold config for asymmetric trust policy**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-03T22:15:00Z
- **Completed:** 2026-02-03T22:19:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added HOMOPHONE_GROUPS with 36 common English homophone sets (their/there/they're, etc.)
- Added NUMBER_WORDS covering 21-100 with hyphenated and concatenated forms
- Added ordinals 1st-20th with word equivalents (first, second, third...)
- Created confidence-config.js with research-backed thresholds
- Exported getAllEquivalents() for building reference word sets

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend word-equivalences.js with homophones and numbers** - `6f68f10` (feat)
2. **Task 2: Create confidence-config.js with thresholds** - `0e76be3` (feat)

## Files Created/Modified
- `js/word-equivalences.js` - Extended with HOMOPHONE_GROUPS, NUMBER_WORDS, getAllEquivalents()
- `js/confidence-config.js` - New file with CONFIDENCE_THRESHOLDS, TRUST_LEVELS, CONFIDENCE_FLAGS
- `index.html` - Version timestamp update

## Decisions Made
- Extended numbers beyond plan's 21-29 and tens to full 21-99 coverage (more complete for reading assessment)
- Used Object.freeze() for all config exports (immutability pattern from CONTEXT.md)
- Threshold values exactly match CONTEXT.md specification (0.93, 0.70, 0.85, 0.50)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Full number coverage 21-99**
- **Found during:** Task 1 (Number words implementation)
- **Issue:** Plan only specified 21-29 and tens (30, 40, etc.) but reading passages commonly include all numbers
- **Fix:** Added complete 21-99 coverage with hyphenated and concatenated forms for each
- **Files modified:** js/word-equivalences.js
- **Verification:** All number-word equivalences work via getCanonical()
- **Committed in:** 6f68f10 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Enhanced coverage for number matching. No scope creep - just more complete implementation.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Word equivalences ready for reference matching in 13-02
- Confidence thresholds ready for classifier in 13-02
- getAllEquivalents() ready for building reference word sets

---
*Phase: 13-confidence-classification*
*Completed: 2026-02-03*
