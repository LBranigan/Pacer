# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-03)

**Core value:** Accurate, word-level fluency error detection powered by Google Cloud STT — giving teachers actionable data on exactly where and how a struggling reader breaks down.
**Current focus:** v1.1 — ASR Ensemble Strategy

## Current Position

Phase: 13 - Confidence Classification
Plan: 02 of 03
Status: In progress
Last activity: 2026-02-03 — Completed 13-02-PLAN.md

Progress: [██████████████████░░░░░░░░░░░░] 62% (10/16 v1.1 plans)

Phases remaining: 4 (Phases 13-16)
Plans completed in v1.1: 10

## Performance Metrics

**v1.0 Velocity:**
- Total plans completed: 21
- Average duration: 2min
- Total execution time: ~0.7 hours

**v1.1 Velocity:**
- Plans completed: 10
- Average duration: 2.5min
- Total execution time: ~27min

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
- Calibration: 2s recording, noise classification (Low/Moderate/High), threshold 0.15-0.60
- No calibration persistence - threshold resets to default (0.375) on page reload
- VAD runs during assessment flow before alignment (12-03)
- Ghost detection on merged words, _vad field persisted in saved assessments (12-03)
- Full number coverage 21-99 with hyphenated and concatenated forms (13-01)
- Confidence thresholds: HIGH=0.93, MEDIUM=0.70, VALID_MUMBLE=0.85, HALLUCINATION_RISK=0.50 (13-01)
- Asymmetric trust: latest_only+ref=0.85, latest_only+noref=0.50+flag (13-02)
- VAD ghost override: confidence 0.0, trustLevel 'ghost' (highest priority) (13-02)

### Pending Todos

None.

### Blockers/Concerns

**For v1.1:**
- ~~Silero VAD browser integration (ONNX runtime required)~~ RESOLVED in 12-01
- Two parallel STT API calls doubles latency — may need optimization

## Session Continuity

Last session: 2026-02-03
Stopped at: Completed 13-02-PLAN.md
Resume with: `/gsd:execute-phase 13` (continue with 13-03)
