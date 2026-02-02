---
phase: "03"
plan: "02"
subsystem: diagnostics-ui
tags: [diagnostics, ui, pipeline-wiring, onset-delays, pauses, self-corrections, morphology, prosody]

dependency-graph:
  requires: ["03-01"]
  provides: ["diagnostics-ui-display", "diagnostics-pipeline-integration"]
  affects: ["04-scoring", "06-teacher-dashboard"]

tech-stack:
  added: []
  patterns: ["diagnostic overlay rendering", "hypIndex tracking for alignment-to-STT mapping"]

file-tracking:
  key-files:
    created: []
    modified: ["js/app.js", "js/ui.js", "style.css", "index.html"]

decisions:
  - id: "DIAG-PAUSE-BUFFER"
    choice: "600ms comma buffer, 1200ms period buffer (reduced from 1.5s/2s)"
    reason: "User feedback — original allowances too generous"
  - id: "DIAG-LEGEND-TOOLTIPS"
    choice: "Detailed detection logic in legend hover tooltips"
    reason: "User requested full transparency on how each classification works"

metrics:
  duration: "3min"
  completed: "2026-02-02"
---

# Phase 3 Plan 2: Wire Diagnostics into Pipeline & UI Summary

**Diagnostics pipeline integration and visual rendering of all five diagnostic categories in assessment results**

## What Was Done

1. **Pipeline wiring (app.js):** Added `runDiagnostics` import and call after alignment. Passes diagnostics result to `displayAlignmentResults`.

2. **Visual rendering (ui.js):** Updated `displayAlignmentResults` to accept and render diagnostics:
   - Onset delays: colored left borders (orange/red/purple) with severity tooltips
   - Long pauses: `[Xs]` indicators inserted between words
   - Self-corrections: separate section below insertions
   - Morphological errors: wavy underline on qualifying substitutions
   - Prosody proxy: ratio displayed in metrics bar alongside WCPM and Accuracy

3. **Styles (style.css):** Added CSS classes for all diagnostic indicators, legend cursor changed to `help`.

4. **Legend tooltips (index.html):** All legend items now have detailed hover tooltips explaining the exact detection logic, thresholds, and examples.

5. **Threshold adjustment (diagnostics.js):** Comma buffer reduced from 1.5s to 0.6s, period buffer from 2s to 1.2s per user feedback.

## Commits

| Hash | Message |
|------|---------|
| 86c041c | feat(03-02): wire diagnostics into pipeline and render visual indicators |
| c08eee7 | fix(03-02): refine pause thresholds and add detailed legend tooltips |

## Deviations from Plan

- Pause thresholds adjusted during checkpoint review (600ms/1200ms instead of 1.5s/2s)
- Legend tooltips added with full detection logic descriptions (not in original plan)

## Next Phase Readiness

- All five diagnostic categories visible in UI
- Pipeline runs end-to-end: STT → alignment → metrics → diagnostics → display
- Ready for Phase 4 (OCR & Async STT)
