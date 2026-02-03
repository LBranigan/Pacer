# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-03)

**Core value:** Accurate, word-level fluency error detection powered by Google Cloud STT — giving teachers actionable data on exactly where and how a struggling reader breaks down.
**Current focus:** v1.1 — ASR Ensemble Strategy

## Current Position

Phase: 12 - VAD Integration (2/4 plans complete)
Plan: 02 of 4
Status: In progress
Last activity: 2026-02-03 — Completed 12-02-PLAN.md

Progress: [██████████░░░░░░░░░░░░░░░░░░░░] 38% (6/16 v1.1 plans)

Phases remaining: 5 (Phases 12-16)
Plans completed in v1.1: 6

## Performance Metrics

**v1.0 Velocity:**
- Total plans completed: 21
- Average duration: 2min
- Total execution time: ~0.7 hours

**v1.1 Velocity:**
- Plans completed: 6
- Average duration: 3min
- Total execution time: 17min

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table.

**v1.1 Decisions:**
- Temporal word association over text-based alignment (stutters break text matching)
- Silero VAD for hallucination detection (not universal filter)
- Separate disfluency signal from confidence (clinical nuance)
- `default` model as ensemble partner (Whisper has 40% hallucination rate)
- Proper nouns boost=5, uncommon words (8+ chars) boost=3, common words boost=0 for latest_long
- Default model uses lower boost (3/2) to reduce phantom insertions
- maxAlternatives reduced from 2 to 1 (alternatives unreliable without confidence)
- Promise.allSettled for parallel API calls (fault-tolerant, both results return)
- 50ms jitter tolerance for CTC/Conformer timestamp drift (implemented in ensemble-merger.js)
- latest_long model takes priority when both models detect same word
- Async path unchanged for now - ensemble may be extended later if needed
- Ensemble data preserved in _ensemble field for debugging and future UI display
- NonRealTimeVAD for post-process audio analysis (not MicVAD for live)
- CDN loading for ONNX/vad-web (no bundler required)
- Ghost detection: 50ms overlap for normal words, 30ms for short words (<200ms)
- 300ms edge tolerance - words at audio boundaries not flagged as ghosts
- Only flag latest_only words that ARE in reference text
- 5+ consecutive ghosts triggers hasGhostSequence for UI escalation

### Pending Todos

None.

### Blockers/Concerns

**For v1.1:**
- ~~Silero VAD browser integration (ONNX runtime required)~~ RESOLVED in 12-01
- Two parallel STT API calls doubles latency — may need optimization

## Session Continuity

Last session: 2026-02-03
Stopped at: Completed 12-02-PLAN.md
Resume with: `/gsd:execute-phase` for 12-03-PLAN.md
