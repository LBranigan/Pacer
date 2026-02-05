# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-05)

**Core value:** Accurate, word-level fluency error detection powered by ensemble ASR with hallucination filtering — giving teachers actionable data on exactly where and how a struggling reader breaks down.
**Current focus:** v1.3 Kitchen Sink Ensemble — Reverb ASR with model-level disfluency detection

## Current Position

Phase: 23 (Kitchen Sink Integration) — IN PROGRESS
Plan: 01 of 02 complete
Status: In progress
Last activity: 2026-02-05 — Completed 23-01-PLAN.md (Reverb API Client & Kitchen Sink Orchestrator)

Progress: [███████░░░░░░░░░░░░░░░░░░░░░░░] ~23% (6/26 plans)

Milestones complete: 3 (v1.0, v1.1, v1.2)
Current milestone: v1.3 Kitchen Sink Ensemble (5 phases, 26 requirements)

## v1.3 Kitchen Sink Ensemble Overview

**Goal:** Replace Google STT ensemble with Reverb ASR for model-level disfluency detection via verbatimicity diff.

**Phases:**
- Phase 20: Reverb Backend Service (5 requirements) — NOT STARTED (dependency for runtime activation)
- Phase 21: Sequence Alignment & Disfluency Detection (9 requirements) — COMPLETE
- Phase 22: Cross-Vendor Validation (4 requirements) — COMPLETE
- Phase 23: Kitchen Sink Integration (3 requirements) — IN PROGRESS (01/02 plans complete)
- Phase 24: Disfluency UI Display (5 requirements) — NOT STARTED

**Key deliverables:**
- `services/reverb/` - FastAPI backend with Docker + GPU
- `js/sequence-aligner.js` - Needleman-Wunsch algorithm (COMPLETE)
- `js/disfluency-tagger.js` - Disfluency classification (COMPLETE)
- `js/deepgram-api.js` - Nova-3 cross-validation client (COMPLETE)
- `js/reverb-api.js` - Reverb HTTP client (COMPLETE - Plan 23-01)
- `js/kitchen-sink-merger.js` - Unified ensemble merger (COMPLETE - Plan 23-01)

## v1.2 VAD Gap Analysis Summary

**Status:** SHIPPED 2026-02-04

**Goal:** Teachers can distinguish true silence from speech-containing gaps in pause/hesitation indicators.

**Completed phases:**
- Phase 18: VAD Gap Analyzer Core (vad-gap-analyzer.js, pipeline integration)
- Phase 19: VAD Gap UI Display (tooltips, orange visual distinction)

**Key deliverables:**
- `js/vad-gap-analyzer.js` - calculateSpeechPercent, getAcousticLabel functions
- `js/ui.js` - buildVADTooltipInfo, VAD class assignment
- `style.css` - .pause-indicator-vad, .word-hesitation-vad classes

## Performance Metrics

**v1.0 Velocity:**
- Total plans completed: 21
- Average duration: 2min
- Total execution time: ~0.7 hours

**v1.1 Velocity:**
- Plans completed: 22
- Average duration: 2.2min
- Total execution time: ~49min

**v1.2 Velocity:**
- Plans completed: 3
- Average duration: 3min
- Total execution time: ~9min

**v1.3 Velocity (in progress):**
- Plans completed: 6
- Average duration: 2min
- Total execution time: ~12min

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full history.

**Summary:**
- v1.0: 8 key decisions (all validated)
- v1.1: 7 key decisions (all validated)
- v1.2: 6 key decisions (all validated)

**v1.3 Phase 23 Decisions:**
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Feature flag default | Enabled (localStorage !== 'false') | Kitchen Sink is primary path; fallback always available |
| Parallel API strategy | Promise.allSettled | Both Reverb + Deepgram can proceed independently |
| Fallback chain | Flag -> Reverb health -> Reverb result | Graceful degradation at each step |
| Placeholder properties | isDisfluency=false, disfluencyType=null, crossValidation='unavailable' | Downstream compatibility in fallback |

### v1.3 Key Research Findings

From `.planning/research/`:

1. **Reverb verbatimicity works:** Same model/encoder/CTC clock for v=1.0 vs v=0.0 means 10-20ms drift (not 60ms+ that caused disfluency-detector.js failure)
2. **Deepgram Nova-3 for cross-validation:** Pure Transformer architecture (different from Reverb's CTC/Attention) provides uncorrelated errors
3. **Needleman-Wunsch absorbs drift:** Global alignment with asymmetric gap penalties (insert=-1, delete=-2) works where local matching failed
4. **Critical pitfalls addressed:**
   - Docker GPU silent failure -> explicit startup check
   - VRAM exhaustion -> chunking at 60-90s
   - CORS blocking -> browser-based smoke test
   - Gap penalty misconfiguration -> asymmetric penalties + test cases

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-02-05T18:55:40Z
Stopped at: Completed 23-01-PLAN.md
Resume file: .planning/phases/23-kitchen-sink-integration/23-02-PLAN.md

### Next Steps

1. Execute Phase 23 Plan 02 (app.js integration) — wire Kitchen Sink into main analysis flow
2. Execute Phase 20 (Reverb Backend Service) — required for runtime activation
3. Plan/Execute Phase 24 (Disfluency UI Display) — final phase
