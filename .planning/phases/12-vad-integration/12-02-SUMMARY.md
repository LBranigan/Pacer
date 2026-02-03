---
phase: 12-vad-integration
plan: 02
subsystem: audio-processing
tags: [vad, ghost-detection, hallucination, timestamp-overlap]

# Dependency graph
requires:
  - phase: 12-01
    provides: VADProcessor with speech segments
  - phase: 11-ensemble-core
    provides: ensemble merger with latest_only tagging
provides:
  - Ghost word detection via VAD timestamp overlap
  - flagGhostWords function for marking hallucinated words
  - Consecutive ghost sequence tracking for UI escalation
affects: [12-03, 12-04, ui-integration, assessment-flow]

# Tech tracking
tech-stack:
  added: []
  patterns: [timestamp-overlap-detection, word-normalization]

key-files:
  created: [js/ghost-detector.js]
  modified: [index.html]

key-decisions:
  - "50ms overlap threshold for normal words, 30ms for short words (<200ms)"
  - "300ms edge tolerance - words at audio boundaries not flagged"
  - "Only flag latest_only words that ARE in reference text"
  - "5+ consecutive ghosts triggers hasGhostSequence flag for UI escalation"

patterns-established:
  - "Ghost detection: check word.source === 'latest_only' + in reference + no VAD overlap"
  - "Word normalization: lowercase + strip leading/trailing punctuation (keep apostrophe/hyphen)"
  - "Overlap calculation: max(wordStart, segStart) < min(wordEnd, segEnd)"

# Metrics
duration: 2min
completed: 2026-02-03
---

# Phase 12 Plan 02: Ghost Detection Logic Summary

**VAD-based ghost word detection comparing latest_only word timestamps against speech segments**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-03T21:51:17Z
- **Completed:** 2026-02-03T21:53:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created ghost-detector.js module with timestamp parsing utilities
- Implemented flagGhostWords function that flags hallucinated words
- Short word lenient threshold (30ms for <200ms words) for better accuracy
- Edge tolerance (300ms) prevents false positives at audio boundaries
- Consecutive ghost tracking enables UI escalation for 5+ ghost sequences
- Graceful VAD error handling - proceeds without ghost detection if VAD fails

## Task Commits

Both tasks implemented together as cohesive module:

1. **Tasks 1+2: Create ghost-detector.js with full detection logic** - `b6d5ee7` (feat)

## Files Created/Modified
- `js/ghost-detector.js` - Ghost detection logic with flagGhostWords export
- `index.html` - Updated version timestamp

## Decisions Made
- **Overlap thresholds:** 50ms for normal words, 30ms for short words (<200ms). These values balance sensitivity (catching real ghosts) with specificity (not flagging quiet speech).
- **Edge tolerance:** 300ms at start/end of recording. Recording artifacts and mic warmup can cause false VAD readings at boundaries.
- **Reference-only flagging:** Only flag words that ARE in reference text. Non-reference ghosts are likely true insertions or disfluencies, not hallucinations.
- **Sequence threshold:** 5+ consecutive ghosts triggers hasGhostSequence for prominent UI display.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Ghost detector ready for integration with VAD processing flow (12-03)
- flagGhostWords accepts mergedWords from ensemble-merger and vadResult from vadProcessor
- ghostIndices array available for UI highlighting
- hasGhostSequence flag available for escalation display

---
*Phase: 12-vad-integration*
*Completed: 2026-02-03*
