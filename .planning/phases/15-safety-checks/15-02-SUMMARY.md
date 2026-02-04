---
phase: 15-safety-checks
plan: 02
type: summary
subsystem: safety
tags: [sequence-detection, corroboration-override, collapse-detection, flag-resolution]
graph:
  requires: [15-01]
  provides: [uncorroborated-sequence-detection, corroboration-override, collapse-detection, safety-pipeline]
  affects: [15-03, app-integration]
tech-stack:
  added: []
  patterns: [split-threshold, flag-resolution, confidence-collapse]
key-files:
  created: []
  modified: [js/safety-checker.js]
decisions:
  - "7+ consecutive latest_only IN reference = suspicious"
  - "3+ consecutive latest_only NOT in reference = hallucination risk"
  - "Strong corroboration requires source='both' AND confidence >= 0.93"
  - "Ghost flags NEVER removed by corroboration override"
  - ">40% flagged/none triggers confidence collapse state"
metrics:
  duration: 1.8min
  completed: 2026-02-03
---

# Phase 15 Plan 02: Uncorroborated Sequences and Safety Pipeline Summary

**One-liner:** Complete safety checker module with uncorroborated sequence detection (split thresholds), corroboration override (preserves ghost flags), collapse detection (40%), and applySafetyChecks orchestrator.

## What Was Built

### 1. Uncorroborated Sequence Detection
`detectUncorroboratedSequences(words, referenceSet)` function:
- Split thresholds based on reference presence:
  - 7+ consecutive `latest_only` words IN reference = suspicious
  - 3+ consecutive `latest_only` words NOT in reference = hallucination risk
- Corroborated words (`source='both'`) reset both counters
- Back-flags ALL words in flagged sequences (not just first/last)
- Stores `_uncorroboratedSequence` metadata with type and length for debugging

### 2. Corroboration Override
`applyCorroborationOverride(words)` function:
- Strong corroboration = `source='both'` AND `confidence >= 0.93`
- Removes `rate_anomaly` and `uncorroborated_sequence` flags for strongly corroborated words
- NEVER removes `vad_ghost` flag (ghost flags take priority per CONTEXT.md)
- Cleans up empty `_flags` arrays

### 3. Confidence Collapse Detection
`detectConfidenceCollapse(words)` function:
- Counts words with `trustLevel === 'none'` OR `_flags.length > 0`
- Returns `{ collapsed: boolean, percent: number, flaggedCount: number }`
- Collapsed = true when >40% of words are flagged/none
- Triggers UI banner display in Phase 16

### 4. Safety Check Orchestrator
`applySafetyChecks(words, referenceText, audioDurationMs)` function:
- Main entry point for app.js integration
- Pipeline order:
  1. `detectRateAnomalies` (3-word sliding window)
  2. `detectUncorroboratedSequences` (split thresholds)
  3. `applyCorroborationOverride` (remove flags for strong corroboration)
  4. `detectConfidenceCollapse` (>40% triggers collapse)
- Returns `{ words, _safety }` structure with counts
- Skips safety checks for single-word utterances

### Key Links Established
- `safety-checker.js` imports `buildReferenceSet` from `confidence-classifier.js`
- `safety-checker.js` imports `getCanonical` from `word-equivalences.js`

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 4325b0a | feat | Add uncorroborated sequence detection |
| 143dccc | feat | Add corroboration override and collapse detection |
| 5b62142 | feat | Add applySafetyChecks orchestrator |

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Split thresholds (7 in-ref / 3 not-in-ref) | Higher tolerance for expected words, stricter for potential hallucinations |
| Back-flag all words in sequence | Per CONTEXT.md: "Flag each word in the suspicious sequence (not just first/last)" |
| Ghost flags never removed | Per CONTEXT.md: "Ghost flags take priority" - they indicate serious VAD issues |
| Strong corroboration = 0.93 | Matches CONFIDENCE_THRESHOLDS.HIGH for consistency |
| 40% collapse threshold | Per CONTEXT.md: significant portion of transcript is unreliable |
| Single-word skip | No meaningful rate or sequence patterns in single words |

## Deviations from Plan

None - plan executed exactly as written.

## Testing Notes

- All functions export correctly (verified with grep)
- Safety checker module complete with 6 exported functions:
  - `addFlag`, `detectRateAnomalies`, `detectUncorroboratedSequences`
  - `applyCorroborationOverride`, `detectConfidenceCollapse`, `applySafetyChecks`
- Ready for app.js integration in Plan 15-03

## Next Phase Readiness

Plan 15-03 can proceed immediately:
- `applySafetyChecks()` returns `{ words, _safety }` ready for app.js consumption
- `_safety.collapse.collapsed` boolean ready for UI banner display
- `_safety.rateAnomalies` and `_safety.uncorroboratedSequences` counts ready for stats

---

*Completed: 2026-02-03*
*Duration: ~1.8 minutes*
