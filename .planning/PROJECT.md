# ReadingQuest — Oral Reading Fluency Assessment

## What This Is

A browser-based oral reading fluency (ORF) assessment tool for middle school RTI Tier 2 students. A teacher photographs a book page (OCR via Google Vision) or types a passage, the student reads aloud, and Google Cloud STT transcribes the audio with word-level timestamps and confidence. The app aligns the transcript against the reference text to detect fluency challenges — substitutions, omissions, word onset delays, pauses — and computes WCPM. Two views: a teacher dashboard showing raw data and progress over time with a Standard Celeration Chart, and a student-facing gamified playback where an animated character hops across highlighted words and battles enemies at struggle points.

## Core Value

Accurate, word-level fluency error detection powered by Google Cloud STT — giving teachers actionable data on exactly where and how a struggling reader breaks down, without manual running record marking.

## Current State (v1.0 shipped 2026-02-03)

**Shipped features:**
- ES module architecture (24 modules) with PWA support
- Word-level alignment using diff-match-patch
- Five fluency diagnostics (onset delays, pauses, self-corrections, morphological errors, prosody proxy)
- Google Cloud integration: STT (sync + async), Vision OCR, Natural Language API
- Teacher dashboard with Standard Celeration Chart, error breakdown, word-synced audio playback
- RTI reports with Hasbrouck-Tindal benchmark comparisons (grades 1-6)
- Gamified student playback with animated character battles

**Tech stack:**
- ~6,675 LOC (JS/HTML/CSS)
- localStorage + IndexedDB for persistence
- Google Cloud APIs: STT, Vision, Natural Language

**Known limitations:**
- Benchmark norms only available for grades 1-6 (HT 2017 published range)
- Local-first architecture (no user accounts, single browser)

## Requirements

### Validated (v1.0)

- ✓ Audio capture via browser microphone (MediaRecorder/WebM) — v1.0
- ✓ Audio file upload with format detection (WAV, FLAC, OGG, MP3, WebM) — v1.0
- ✓ Google Cloud STT integration with word-level timestamps and confidence — v1.0
- ✓ Speech context boosting from reference passage — v1.0
- ✓ Confidence-based word coloring in results display — v1.0
- ✓ Google Vision OCR for photographed book pages — v1.0
- ✓ Manual text input for reference passage — v1.0
- ✓ Transcript-to-reference alignment algorithm (diff/LCS) — v1.0
- ✓ Word classification: correct, substitution, omission, insertion — v1.0
- ✓ WCPM calculation (words correct per minute) — v1.0
- ✓ Accuracy percentage — v1.0
- ✓ Error breakdown by type (substitutions, omissions, insertions) — v1.0
- ✓ Word onset delay detection with tiered thresholds — v1.0
- ✓ Long non-prosodic pause detection (3s+, with punctuation allowance) — v1.0
- ✓ Self-correction detection (repeated word/phrase patterns) — v1.0
- ✓ Morphological error inference via suffix confidence scores — v1.0
- ✓ Crude prosody proxy from pause-at-punctuation patterns — v1.0
- ✓ Teacher dashboard with assessment data, error breakdown, progress trends — v1.0
- ✓ Standard Celeration Chart for student progress — v1.0
- ✓ Word-synced audio playback for teacher review — v1.0
- ✓ RTI reports with Hasbrouck-Tindal benchmark comparisons — v1.0
- ✓ Student-facing animated playback with character and battles — v1.0
- ✓ Gamified feedback (points, streaks, levels) — v1.0
- ✓ Async STT endpoint for passages >60 seconds — v1.0
- ✓ PWA with offline shell caching — v1.0
- ✓ NL API integration for proper noun forgiveness and word tier classification — v1.0

### Active (v1.1+)

- [ ] Full prosody scoring from audio waveform analysis (NAEP-aligned)
- [ ] Backend server with secure API key management
- [ ] User authentication (teacher accounts)
- [ ] Cloud-based assessment storage (multi-device sync)

### Out of Scope

- Pre-loaded passage library — teacher provides passages via photo or manual input
- Exportable video of student playback — in-browser animation only
- Multi-language support — en-US only
- Student-to-student leaderboards — harmful for struggling readers
- Real-time live scoring during reading — batch STT processing
- Phonics/phonemic awareness breakdown — STT operates at word level

## Context

- Target users: RTI Tier 2 middle school students (struggling readers) and their teachers
- Codebase: 24 ES modules in js/ directory, 4 HTML entry points
- Google Cloud STT v1 `latest_long` model with enhanced mode, word timestamps, and confidence
- Google Cloud Natural Language API for POS tagging, entity recognition, and word tier classification
- Standard Celeration Chart ported from standalone project

## Constraints

- **API**: Google Cloud STT v1 (sync <60s, async for longer)
- **API**: Google Cloud Natural Language API v1
- **API**: Google Cloud Vision API for OCR
- **Storage**: localStorage (~5MB) + IndexedDB (audio blobs)
- **Architecture**: Client-side only, no backend — API key entered by teacher
- **Benchmarks**: Hasbrouck-Tindal 2017 norms (grades 1-6 only)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Google Vision OCR for reference text | Teacher photographs any book page, not limited to curated passages | ✓ Implemented v1.0 |
| localStorage for data persistence | Simple local-first approach, no backend needed initially | ✓ Implemented v1.0 |
| In-browser animation for student playback | Simpler than video rendering, sufficient for classroom use | ✓ Implemented v1.0 |
| Core metrics first, prosody later | WCPM/accuracy/error classification provides immediate teacher value; prosody is lower accuracy | ✓ Implemented v1.0 |
| Confidence-score approach for morphological errors | STT autocorrects suffixes but reports low confidence — usable signal | ✓ Implemented v1.0 |
| NL API for word-level annotation | POS tags + entity types enable proper noun forgiveness, word tier classification, and ASR healing | ✓ Implemented v1.0 |
| diff-match-patch for alignment | Unicode encoding technique enables word-level diff with character-based library | ✓ Implemented v1.0 |
| Standard Celeration Chart | Industry-standard progress monitoring visualization for RTI | ✓ Implemented v1.0 |

---
*Last updated: 2026-02-03 after v1.0 milestone*
