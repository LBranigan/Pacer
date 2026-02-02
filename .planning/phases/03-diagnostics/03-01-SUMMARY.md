---
phase: "03"
plan: "01"
subsystem: diagnostics
tags: [fluency, onset-delays, pauses, self-corrections, morphology, prosody]

dependency-graph:
  requires: ["02-alignment-core-metrics"]
  provides: ["diagnostics-analyzers", "runDiagnostics-orchestrator"]
  affects: ["03-02 (UI integration)", "04-scoring"]

tech-stack:
  added: []
  patterns: ["tiered severity classification", "punctuation-aware thresholds", "alignment-based cross-referencing"]

file-tracking:
  key-files:
    created: ["js/diagnostics.js"]
    modified: []

decisions:
  - id: "DIAG-THRESHOLD"
    choice: "3s base pause threshold with +1.5s comma / +2s period allowance"
    reason: "Avoids false positives at natural sentence boundaries"
  - id: "DIAG-ONSET-FIRST"
    choice: "First word onset delay threshold at 3s (higher than mid-text 1.5s)"
    reason: "Recording lead-in causes false positives at lower thresholds"
  - id: "DIAG-MORPH-PREFIX"
    choice: "3+ char shared prefix for morphological error detection"
    reason: "Balances sensitivity -- shorter prefixes catch too many unrelated words"

metrics:
  duration: "2min"
  completed: "2026-02-02"
---

# Phase 3 Plan 1: Diagnostics Analyzers Summary

**Five fluency diagnostic analyzers (onset delays, long pauses, self-corrections, morphological errors, prosody proxy) with runDiagnostics orchestrator, all in js/diagnostics.js**

## What Was Done

Created `js/diagnostics.js` with 324 lines implementing:

1. **detectOnsetDelays** -- Tiered severity (developing >= 1.5s, flag >= 3s, frustration >= 5s) with 3s minimum for first word to avoid recording lead-in false positives
2. **detectLongPauses** -- 3s base threshold with punctuation-aware allowance (+1.5s comma, +2s period) using alignment mapping to cross-reference hypothesis words to reference positions
3. **detectSelfCorrections** -- Consecutive word and 2-word phrase repeat detection, excluding repeats that are legitimate per reference text alignment
4. **detectMorphologicalErrors** -- Substitutions with 3+ char shared prefix and STT confidence < 0.8
5. **computeProsodyProxy** -- Ratio of average pause duration at punctuation boundaries vs mid-sentence
6. **runDiagnostics** -- Orchestrator calling all five and returning unified object

Three shared helpers: `parseTime`, `getPunctuationPositions`, `buildHypToRefMap`.

## Commits

| Hash | Message |
|------|---------|
| 47c894e | feat(03-01): add fluency diagnostics module with five analyzers |

## Deviations from Plan

None -- plan executed exactly as written.

## Next Phase Readiness

- All five analyzers are pure functions ready for UI integration
- `runDiagnostics` provides single entry point for Phase 3 Plan 2 (UI/wiring)
- Thresholds are hardcoded constants; could be made configurable in future phase if needed
