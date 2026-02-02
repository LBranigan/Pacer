# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-02)

**Core value:** Accurate, word-level fluency error detection powered by Google Cloud STT -- giving teachers actionable data on exactly where and how a struggling reader breaks down.
**Current focus:** Phase 4: OCR & Async STT

## Current Position

Phase: 4 of 8 (OCR & Async STT)
Plan: 0 of TBD complete
Status: Not started
Last activity: 2026-02-02 -- Completed Phase 3: Diagnostics

Progress: [████████░░] 38%

## Performance Metrics

**Velocity:**
- Total plans completed: 6
- Average duration: 2min
- Total execution time: 0.20 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation | 2/2 | 4min | 2min |
| 02-alignment-core-metrics | 2/2 | 6min | 3min |
| 03-diagnostics | 2/2 | 5min | 2.5min |

**Recent Trend:**
- Last 5 plans: 02-01 (1min), 02-02 (5min), 03-01 (2min), 03-02 (3min)
- Trend: Stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Option A for sendToSTT: handles full flow (status + display) internally, matching original monolith pattern
- orf_assessment.html kept as reference alongside new modular structure
- Cache-first for app shell, network passthrough for googleapis.com API calls
- SW cache versioning via CACHE_NAME constant
- diff-match-patch loaded as global via CDN, accessed in ES modules
- Adjacent DELETE+INSERT merged into substitutions with 1:1 pairing
- Insertions excluded from error count per ORF standard
- Removed diff_cleanupSemantic -- it incorrectly merged correct words into substitution blocks
- sendToSTT returns data; callback pattern avoids circular imports
- Confidence shown as wavy underlines (raw mode) and tooltips (alignment mode)
- 3s base pause threshold with punctuation allowance (600ms comma, 1200ms period)
- First word onset delay threshold at 3s to avoid recording lead-in false positives
- 3+ char shared prefix minimum for morphological error detection

### Pending Todos

None yet.

### Blockers/Concerns

- Research flags child speech WER (0.30-0.78) as fundamental risk. Phase 1 should validate STT accuracy with target population audio early.
- Dialect bias in ASR (WER 0.35 for Black speakers vs 0.19 for white) must be designed into error taxonomy from Phase 2, not bolted on later.
- STT timestamp precision needs empirical validation before building timing-dependent features (Phase 3 diagnostics).

## Session Continuity

Last session: 2026-02-02
Stopped at: Completed Phase 3: Diagnostics
Resume file: None
