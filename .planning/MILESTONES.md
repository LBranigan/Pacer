# Project Milestones: ReadingQuest

## v1.1 ASR Ensemble (Shipped: 2026-02-04)

**Delivered:** Two-model ensemble ASR with VAD-based hallucination detection, separate disfluency classification, safety checks, and enhanced teacher UI for accurate word-level fluency assessment.

**Phases completed:** 10-17 (22 plans total)

**Key accomplishments:**

- Two-model ensemble STT (`latest_long` + `default`) with temporal word association
- Silero VAD ghost detection for hallucinations in reference-matched words
- Asymmetric confidence classification with research-backed thresholds (0.93/0.70)
- Separate disfluency detection layer (stutter severity independent of confidence)
- Safety checks pipeline (rate anomaly, uncorroborated sequences, collapse detection)
- Enhanced teacher UI (tooltips with both models, disfluency badges, WCPM ranges)

**Stats:**

- 81 files created/modified
- +15,658 lines of code
- 8 phases, 22 plans
- 2 days (2026-02-03 → 2026-02-04)
- 105 commits

**Git range:** `feat(10-01)` → `docs(17)`

**What's next:** v1.2 — prosody scoring, backend server, or user authentication

---

## v1.0 MVP (Shipped: 2026-02-03)

**Delivered:** Complete oral reading fluency assessment tool with word-level alignment, diagnostics, teacher dashboard with Standard Celeration Chart, RTI reports, and gamified student playback.

**Phases completed:** 1-9 (21 plans total)

**Key accomplishments:**

- Modular ES architecture (24 modules) with PWA support
- Word-level alignment engine using diff-match-patch with Unicode encoding
- Five fluency diagnostic analyzers (onset delays, pauses, self-corrections, morphological errors, prosody proxy)
- Google Cloud integration: STT (sync + async), Vision OCR, Natural Language API
- Teacher dashboard with Standard Celeration Chart, error breakdown, word-synced audio playback
- RTI reports with Hasbrouck-Tindal benchmark comparisons
- Gamified student playback with animated character battles at struggle points

**Stats:**

- 81 files created/modified
- ~6,675 lines of code (4,928 JS + 1,132 HTML + 615 CSS)
- 9 phases, 21 plans
- 1 day from start to ship (2026-02-02)

**Git range:** `feat(01-01)` → `feat(08-03)` + Phase 9 direct implementation

**What's next:** v1.1 enhancements based on user feedback

---
