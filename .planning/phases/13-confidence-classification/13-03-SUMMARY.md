---
phase: 13-confidence-classification
plan: 03
subsystem: app
tags: [confidence-classifier, pipeline-integration, ghost-filtering, alignment]

# Dependency graph
requires:
  - phase: 13-02
    provides: classifyAllWords, filterGhosts, computeClassificationStats functions
  - phase: 12-vad-integration
    provides: Ghost detection in assessment flow, _vad field
  - phase: 11-ensemble-merger
    provides: Merged words with source field
provides:
  - Classification integrated into runAnalysis() assessment flow
  - Ghost words filtered before alignment (prevents WCPM inflation)
  - _classification field persisted in saved assessments
  - trustLevel and _flags visible in debug data
affects: [16-ui-confidence]

# Tech tracking
tech-stack:
  added: []
  patterns: [Pipeline integration: Classify -> Filter -> Align]

key-files:
  modified:
    - js/app.js

key-decisions:
  - "Classification runs AFTER ghost detection, BEFORE alignment"
  - "Ghost words filtered via data structure modification (Option A)"
  - "All words preserved in _classification.allWords for debugging"
  - "_classification field persisted in saved assessments"

patterns-established:
  - "Pipeline order: Classify -> Filter ghosts -> Align"
  - "Use wordsForAlignment for alignment, preserve allWords for debugging"

# Metrics
duration: 3min
completed: 2026-02-03
---

# Phase 13 Plan 03: App Integration Summary

**Confidence classifier integrated into assessment flow - ghost words filtered before alignment to prevent WCPM inflation from hallucinations**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-03T23:05:00Z
- **Completed:** 2026-02-03T23:08:16Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments
- Integrated confidence classifier imports into app.js
- Classification step runs after ghost detection in handleAnalyze flow
- Ghost words (confidence 0.0) filtered before alignment
- Classification stats logged to debug stages
- _classification field preserved in saved assessments
- trustLevel and _flags visible in stt_words debug output

## Task Commits

Each task was committed atomically:

1. **Task 1: Add confidence classifier imports** - `ab3934a` (feat)
2. **Task 2: Insert classification step in flow** - `f6cdc3e` (feat)
3. **Task 3: Ensure alignment uses filtered words** - `8b88dfa` (feat)

## Files Modified
- `js/app.js` - Added imports, classification pipeline, _classification persistence
- `index.html` - Version timestamp update

## Pipeline Flow After Integration

```
Audio Recording
    |
Ensemble STT (latest_long + default)
    |
Merge Results (temporal word association)
    |
VAD Ghost Detection (flag vad_ghost_in_reference)
    |
[NEW] Confidence Classification
    |   - classifyAllWords() applies trust policy
    |   - computeClassificationStats() logs distribution
    |
[NEW] Filter Ghosts
    |   - filterGhosts() removes confidence 0.0 words
    |   - Ghost count logged
    |
Alignment (receives only non-ghost words)
    |
WCPM Calculation (ghosts excluded)
```

## Data Structure

```javascript
data = {
  results: [{
    alternatives: [{
      words: wordsForAlignment,  // Filtered (ghosts excluded)
      transcript: wordsForAlignment.map(w => w.word).join(' ')
    }]
  }],
  _ensemble: { raw, stats },
  _vad: { segments, durationMs, ghostCount, hasGhostSequence, error },
  _classification: {
    stats: { total, high, medium, low, ghost, possibleInsertions },
    allWords: classifiedWords,  // ALL words including ghosts
    filteredCount: N
  }
};
```

## Decisions Made

- **Option A for filtering:** Modified data structure so alignment sees filtered words, rather than modifying the alignment call directly. This maintains backward compatibility with existing code.
- **Preserve allWords:** Keep all classified words (including ghosts) in `_classification.allWords` for debugging and future UI display.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 13 complete - confidence classification fully integrated
- Ready for Phase 16 UI confidence indicators
- Ghost words successfully filtered before alignment
- WCPM calculation no longer inflated by hallucinations
- Possible insertions flagged but preserved for teacher review

---
*Phase: 13-confidence-classification*
*Completed: 2026-02-03*
