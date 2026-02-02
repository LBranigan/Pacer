---
phase: 02-alignment-core-metrics
plan: 02
subsystem: pipeline-ui
tags: [pipeline, color-coded-display, wcpm, accuracy, audio-playback]

requires:
  - phase: 02-alignment-core-metrics
    plan: 01
    provides: "alignWords, computeWCPM, computeAccuracy"
provides:
  - "End-to-end pipeline: STT -> alignment -> metrics -> color-coded display"
  - "Audio playback after analysis"
  - "Confidence/timing tooltips on hover"
affects: [03-diagnostics, 05-data-persistence, 06-teacher-dashboard]

tech-stack:
  added: []
  patterns: [callback pattern for module decoupling, STT metadata passthrough]

key-files:
  created: []
  modified: [js/stt-api.js, js/recorder.js, js/file-handler.js, js/ui.js, js/app.js, js/alignment.js, index.html, style.css]

key-decisions:
  - "sendToSTT returns data instead of calling displayResults"
  - "Callback pattern (setOnComplete) to avoid circular imports between recorder/file-handler and app.js"
  - "Removed diff_cleanupSemantic — it incorrectly merged correct words into substitution blocks"
  - "Confidence shown as wavy underlines (raw mode) and tooltips (alignment mode)"
  - "Audio playback blob shown via URL.createObjectURL after analysis"

patterns-established:
  - "Pipeline orchestration in app.js: STT -> align -> metrics -> display"
  - "STT metadata lookup map for enriching alignment results"

duration: 5min
completed: 2026-02-02
---

# Phase 2 Plan 2: Pipeline Wiring & UI Summary

**Refactored data flow, wired full pipeline, color-coded alignment display with metrics and audio playback**

## Performance

- **Duration:** ~5 min (including human verification checkpoint)
- **Tasks:** 3 (2 auto + 1 human-verify)
- **Files modified:** 8

## Accomplishments
- sendToSTT refactored to return data instead of displaying directly
- Full pipeline: Record → STT → Alignment → Metrics → Color-coded display
- Color-coded words: green (correct), orange (substitution), red/strikethrough (omission), blue (insertion)
- Metrics summary bar: WCPM, accuracy %, error breakdown
- Audio playback control after analysis
- Confidence scores and timestamps in hover tooltips
- Backward compatible: no reference text = raw transcript display

## Task Commits

1. **Task 1: Refactor sendToSTT and wire pipeline** - `f792f03`
2. **Task 2: Color-coded alignment UI and metrics** - `2094d71`
3. **Testing fixes (mono audio, alignment bug, playback, tooltips)** - `e8a0f1a`

## Deviations from Plan
- Removed `diff_cleanupSemantic` call — it merged correct matches into substitution blocks (bug found during user testing)
- Added audio playback feature (user request during testing)
- Added STT confidence/timing tooltips (user request during testing)
- Changed confidence colors from background to wavy underlines (user request — too similar to error colors)
- Forced mono audio in getUserMedia (Google STT rejected stereo)

## Issues Encountered
- Google STT rejected stereo audio — fixed by constraining getUserMedia to channelCount: 1
- diff_cleanupSemantic grouped "dog"="dog" into a DELETE+INSERT block, causing false substitution — fixed by removing the call

---
*Phase: 02-alignment-core-metrics*
*Completed: 2026-02-02*
