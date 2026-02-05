# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-05)

**Core value:** Accurate, word-level fluency error detection powered by ensemble ASR with hallucination filtering — giving teachers actionable data on exactly where and how a struggling reader breaks down.
**Current focus:** v1.3 Kitchen Sink Ensemble — Reverb ASR with model-level disfluency detection

## Current Position

Phase: 24 (Disfluency UI Display) — In progress
Plan: 01 of 02 complete
Status: In progress
Last activity: 2026-02-05 — Completed 24-01-PLAN.md (Miscue Registry, CSS, HTML Foundation)

Progress: [█████████░░░░░░░░░░░░░░░░░░░░░] ~31% (8/26 plans)

Milestones complete: 3 (v1.0, v1.1, v1.2)
Current milestone: v1.3 Kitchen Sink Ensemble (5 phases, 26 requirements)

## v1.3 Kitchen Sink Ensemble Overview

**Goal:** Replace Google STT ensemble with Reverb ASR for model-level disfluency detection via verbatimicity diff. (Google fully removed — Deepgram-only fallback when Reverb offline)

**Phases:**
- Phase 20: Reverb Backend Service (5 requirements) — COMPLETE (confirmed by user)
- Phase 21: Sequence Alignment & Disfluency Detection (9 requirements) — COMPLETE
- Phase 22: Cross-Vendor Validation (4 requirements) — COMPLETE
- Phase 23: Kitchen Sink Integration (3 requirements) — COMPLETE
- Phase 24: Disfluency UI Display (5 requirements) — IN PROGRESS (Plan 01 complete)

**Key deliverables:**
- `services/reverb/` - FastAPI backend with Docker + GPU (COMPLETE - Phase 20)
- `js/sequence-aligner.js` - Needleman-Wunsch algorithm (COMPLETE)
- `js/disfluency-tagger.js` - Disfluency classification (COMPLETE)
- `js/deepgram-api.js` - Nova-3 cross-validation client (COMPLETE)
- `js/reverb-api.js` - Reverb HTTP client (COMPLETE - Plan 23-01)
- `js/kitchen-sink-merger.js` - Unified ensemble merger (COMPLETE - Plan 23-01)
- `js/app.js` - Kitchen Sink pipeline integration (COMPLETE - Plan 23-02)

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
- Plans completed: 8
- Average duration: 2min
- Total execution time: ~16min

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full history.

**Summary:**
- v1.0: 8 key decisions (all validated)
- v1.1: 7 key decisions (all validated)
- v1.2: 6 key decisions (all validated)

**v1.3 Phase 24 Decisions:**
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Dot marker style | Gray bullet (U+2022) at top:-8px via ::before | Subtle indicator, doesn't compete with error highlighting |
| Section visibility | display:none by default | Avoid empty section when no disfluency data; JS shows it |

**v1.3 Phase 23 Decisions:**
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Feature flag default | Enabled (localStorage !== 'false') | Kitchen Sink is primary path; fallback always available |
| Parallel API strategy | Promise.allSettled | Both Reverb + Deepgram can proceed independently |
| Fallback chain | Kitchen Sink → Deepgram-only → Error | No Google dependency; Deepgram provides degraded transcription when Reverb offline |
| Google STT removal | Fully removed from pipeline | User requested no Google dependency; Deepgram-only fallback is sufficient |
| Placeholder properties | isDisfluency=false, disfluencyType=null, crossValidation='confirmed' | Downstream compatibility in Deepgram fallback |
| Primary pipeline replacement | runKitchenSinkPipeline replaces sendEnsembleSTT | Kitchen Sink as default analysis path |
| Stats computation | Always computeKitchenSinkStats | Works for both kitchen_sink and deepgram_fallback sources |

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

Last session: 2026-02-05T19:39:00Z
Stopped at: Completed 24-01-PLAN.md (Miscue Registry, CSS, HTML Foundation)
Resume file: None

### Next Steps

1. Execute Plan 24-02 (Disfluency UI JavaScript wiring)
2. Milestone v1.3 completion review after Phase 24
