# ReadingQuest — Oral Reading Fluency Assessment

## What This Is

A browser-based oral reading fluency (ORF) assessment tool for middle school RTI Tier 2 students. A teacher photographs a book page (OCR via Google Vision) or types a passage, the student reads aloud, and Google Cloud STT transcribes the audio with word-level timestamps and confidence. The app uses a two-model ensemble (`latest_long` + `default`) with VAD-based hallucination detection to align the transcript against the reference text, detecting fluency challenges — substitutions, omissions, word onset delays, pauses, stutters — and computes WCPM with uncertainty ranges. Two views: a teacher dashboard showing raw data and progress over time with a Standard Celeration Chart, and a student-facing gamified playback where an animated character hops across highlighted words and battles enemies at struggle points.

## Core Value

Accurate, word-level fluency error detection powered by ensemble ASR with hallucination filtering — giving teachers actionable data on exactly where and how a struggling reader breaks down, without manual running record marking.

## Current Milestone: v1.2 VAD Gap Analysis

**Goal:** Add VAD-based acoustic analysis to pause/gap indicators, giving teachers visibility into what actually happened during reported "silences" — distinguishing true hesitation from sounding out or timestamp drift.

**Target features:**
- VAD speech percentage overlay on pause indicators (hover tooltip)
- VAD speech percentage overlay on hesitation indicators (hover tooltip)
- Acoustic labels (silence confirmed, mostly silent, mixed signal, speech detected, continuous speech)
- Visual indicator for pauses with significant speech activity
- Debug logging for VAD gap analysis

## Current State (v1.1 shipped 2026-02-04)

**Shipped features:**
- ES module architecture (24+ modules) with PWA support
- Two-model ensemble STT with temporal word association
- Silero VAD ghost detection for hallucination filtering
- Asymmetric confidence classification (reference-aware trust policy)
- Separate disfluency detection (stutter severity: none/minor/moderate/significant)
- Safety checks (rate anomaly, uncorroborated sequences, collapse detection)
- Word-level alignment using diff-match-patch
- Five fluency diagnostics (onset delays, pauses, self-corrections, morphological errors, prosody proxy)
- Google Cloud integration: STT (sync + async), Vision OCR, Natural Language API
- Teacher dashboard with Standard Celeration Chart, error breakdown, word-synced audio playback
- Enhanced tooltips showing both model results, disfluency badges, WCPM ranges
- RTI reports with Hasbrouck-Tindal benchmark comparisons (grades 1-6)
- Gamified student playback with animated character battles

**Tech stack:**
- ~9,400 LOC (JS/HTML/CSS)
- localStorage + IndexedDB for persistence
- Google Cloud APIs: STT, Vision, Natural Language
- Silero VAD via ONNX runtime (browser-based)

**Known limitations:**
- Benchmark norms only available for grades 1-6 (HT 2017 published range)
- Local-first architecture (no user accounts, single browser)
- Ensemble only for sync path (<60s recordings)

## Requirements

### Validated

**v1.0:**
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

**v1.1:**
- ✓ Two-model ensemble (`latest_long` + `default`) with parallel API calls — v1.1
- ✓ Temporal word association (time-based, not text-based alignment) — v1.1
- ✓ Asymmetric trust policy (reference-aware confidence classification) — v1.1
- ✓ Silero VAD integration for hallucination detection — v1.1
- ✓ VAD calibration system with dedicated UI — v1.1
- ✓ Separate disfluency detection layer (stutter severity classification) — v1.1
- ✓ Safety checks (rate anomaly, uncorroborated sequence detection) — v1.1
- ✓ Enhanced UI (word tooltips, disfluency badges, WCPM ranges) — v1.1

### Active

- [ ] VAD acoustic analysis overlay on pause/gap indicators
- [ ] Acoustic labels for speech percentage classification
- [ ] Visual indicator for pauses with significant VAD activity
- [ ] Debug logging for VAD gap analysis summary

### Future (v1.2+)

- [ ] Full prosody scoring from audio waveform analysis (NAEP-aligned)
- [ ] Backend server with secure API key management
- [ ] User authentication (teacher accounts)
- [ ] Cloud-based assessment storage (multi-device sync)
- [ ] Ensemble for async path (>60s recordings)

### Out of Scope

- Pre-loaded passage library — teacher provides passages via photo or manual input
- Exportable video of student playback — in-browser animation only
- Multi-language support — en-US only
- Student-to-student leaderboards — harmful for struggling readers
- Real-time live scoring during reading — batch STT processing
- Phonics/phonemic awareness breakdown — STT operates at word level
- wav2vec2 fine-tuning — requires transcribed child speech + GPU infrastructure
- Text-based transcript alignment — fails on stutters, use temporal association
- Combining confidence + disfluency — loses clinical nuance
- Whisper as ensemble partner — also hallucinates (40% rate)
- VAD as universal filter — only scoped for `latest_only + IN REFERENCE`

## Context

- Target users: RTI Tier 2 middle school students (struggling readers) and their teachers
- Codebase: 24+ ES modules in js/ directory, 4 HTML entry points
- Google Cloud STT v1 with two-model ensemble (`latest_long` + `default`)
- Google Cloud Natural Language API for POS tagging, entity recognition, word tier classification
- Silero VAD via ONNX runtime for browser-based speech activity detection
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
| Google Vision OCR for reference text | Teacher photographs any book page, not limited to curated passages | ✓ Good v1.0 |
| localStorage for data persistence | Simple local-first approach, no backend needed initially | ✓ Good v1.0 |
| In-browser animation for student playback | Simpler than video rendering, sufficient for classroom use | ✓ Good v1.0 |
| Core metrics first, prosody later | WCPM/accuracy/error classification provides immediate teacher value; prosody is lower accuracy | ✓ Good v1.0 |
| Confidence-score approach for morphological errors | STT autocorrects suffixes but reports low confidence — usable signal | ✓ Good v1.0 |
| NL API for word-level annotation | POS tags + entity types enable proper noun forgiveness, word tier classification, and ASR healing | ✓ Good v1.0 |
| diff-match-patch for alignment | Unicode encoding technique enables word-level diff with character-based library | ✓ Good v1.0 |
| Standard Celeration Chart | Industry-standard progress monitoring visualization for RTI | ✓ Good v1.0 |
| Temporal word association over text | Stutters break text matching ("p-p-please" vs "please"), time overlap is robust | ✓ Good v1.1 |
| `default` model as ensemble partner | Whisper hallucinates 40%, CTC-based `default` is more conservative | ✓ Good v1.1 |
| Silero VAD for ghost detection | Catches `latest_long` hallucinations in reference text without universal filtering | ✓ Good v1.1 |
| Post-process VAD (not live) | Chromebook-safe, no CPU spike during recording | ✓ Good v1.1 |
| Separate disfluency from confidence | Clinical nuance: a stuttered word is still correct, confidence ≠ fluency | ✓ Good v1.1 |
| Conservative WCPM as primary | Underpromise philosophy — show min value, range reveals uncertainty | ✓ Good v1.1 |
| Ghost filtering before alignment | Prevents WCPM inflation from hallucinated words | ✓ Good v1.1 |

---
*Last updated: 2026-02-04 after v1.2 milestone start*
