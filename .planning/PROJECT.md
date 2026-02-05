# ReadingQuest — Oral Reading Fluency Assessment

## What This Is

A browser-based oral reading fluency (ORF) assessment tool for middle school RTI Tier 2 students. A teacher photographs a book page (OCR via Google Vision) or types a passage, the student reads aloud, and Google Cloud STT transcribes the audio with word-level timestamps and confidence. The app uses a two-model ensemble (`latest_long` + `default`) with VAD-based hallucination detection to align the transcript against the reference text, detecting fluency challenges — substitutions, omissions, word onset delays, pauses, stutters — and computes WCPM with uncertainty ranges. Two views: a teacher dashboard showing raw data and progress over time with a Standard Celeration Chart, and a student-facing gamified playback where an animated character hops across highlighted words and battles enemies at struggle points.

## Core Value

Accurate, word-level fluency error detection powered by ensemble ASR with hallucination filtering — giving teachers actionable data on exactly where and how a struggling reader breaks down, without manual running record marking.

## Current Milestone: v1.3 Kitchen Sink Ensemble

**Goal:** Replace Google STT ensemble with Reverb ASR for model-level disfluency detection via verbatimicity diff.

**Target features:**
- Reverb ASR backend service (Docker/FastAPI, local GPU)
- Three-pass ensemble: Reverb v=1.0 (verbatim) + Reverb v=0.0 (clean) + Google default (cross-validation)
- Needleman-Wunsch sequence alignment for disfluency detection from v1.0 vs v0.0 diff
- Tagged disfluencies: fillers (um, uh), repetitions, false starts
- Teacher UI showing disfluency markers per word
- Google STT retained for hallucination cross-validation only

**Why this works (vs abandoned disfluency-detector.js):**
- Same model/encoder/CTC clock for both passes (no cross-vendor drift)
- Model-level disfluency decision (trained on 200k hours with verbatim labels)
- Global sequence alignment absorbs timestamp drift (not brittle local matching)

## Current State (v1.2 shipped 2026-02-04)

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
- ~9,840 LOC (JS/HTML/CSS)
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

**v1.2:**
- ✓ VAD acoustic analysis overlay on pause/gap indicators — v1.2
- ✓ 5-tier acoustic labels for speech percentage classification — v1.2
- ✓ Orange visual distinction for pauses with significant VAD activity (≥30%) — v1.2
- ✓ Debug logging for VAD gap analysis summary — v1.2

### Active

**v1.3 Kitchen Sink Ensemble:**
- [ ] Reverb ASR backend service with dual-pass transcription (v=1.0 + v=0.0)
- [ ] Needleman-Wunsch sequence alignment for disfluency detection
- [ ] Disfluency tagging (fillers, repetitions, false starts) from alignment insertions
- [ ] Integration with existing pipeline (replaces Google ensemble)
- [ ] Google STT cross-validation for hallucination detection
- [ ] Teacher UI displaying tagged disfluencies per word

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

- **API**: Google Cloud STT v1 (cross-validation only in v1.3+)
- **API**: Google Cloud Natural Language API v1
- **API**: Google Cloud Vision API for OCR
- **Backend**: Reverb ASR service (Docker, requires GPU — GTX 1070+ / 8GB VRAM)
- **Storage**: localStorage (~5MB) + IndexedDB (audio blobs)
- **Architecture**: Browser client + local Reverb backend (teacher runs Docker)
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

## Key Decisions (v1.2)

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| <10% threshold for silence confirmed | Strict interpretation of requirements | ✓ Good v1.2 |
| Round speech percentage to one decimal | Clean display in UI | ✓ Good v1.2 |
| Mutation pattern with _vadAnalysis | Matches existing codebase conventions | ✓ Good v1.2 |
| Place VAD enrichment after diagnostics | Ensures diagnostics exist and alignment not yet modified | ✓ Good v1.2 |
| Guard with vadResult.segments check | Handle cases where VAD is unavailable | ✓ Good v1.2 |
| Tooltip format "VAD: X% (label) - hint" | User decision from CONTEXT.md | ✓ Good v1.2 |

---
*Last updated: 2026-02-05 after v1.3 milestone started*
