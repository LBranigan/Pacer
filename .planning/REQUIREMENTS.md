# Requirements: ReadingQuest

**Defined:** 2026-02-02
**Core Value:** Accurate, word-level fluency error detection powered by Google Cloud STT — giving teachers actionable data on exactly where and how a struggling reader breaks down.

## v1 Requirements

### Core Metrics

- [x] **CORE-01**: App calculates WCPM (words read correctly / elapsed minutes)
- [x] **CORE-02**: App calculates accuracy percentage (correct words / total words)
- [x] **CORE-03**: App classifies each word as correct, substitution, omission, or insertion via alignment
- [x] **CORE-04**: App tracks assessment duration with timer UI and passage-level timing

### Diagnostics

- [x] **DIAG-01**: App detects word onset delay with tiered thresholds (<1s normal, 1.5-2s developing, >3s flag, >5s frustration)
- [x] **DIAG-02**: App detects long non-prosodic pauses (3s+) with extra allowance at commas/periods
- [x] **DIAG-03**: App detects self-corrections from repeated word/phrase patterns in transcript
- [x] **DIAG-04**: App infers morphological errors via low confidence scores on word suffixes
- [x] **DIAG-05**: App provides crude prosody proxy from pause-at-punctuation patterns

### Input

- [ ] **INPT-01**: Teacher can type reference passage manually (dev/debug mode)
- [ ] **INPT-02**: Teacher can photograph book page and extract text via Google Vision OCR
- [ ] **INPT-03**: Student audio captured via browser microphone (existing)
- [ ] **INPT-04**: Audio file upload with format detection (existing)

### Alignment

- [x] **ALGN-01**: App aligns STT transcript to reference text using diff/LCS algorithm
- [x] **ALGN-02**: Alignment maps each transcript word to its reference word (or marks as insertion)
- [x] **ALGN-03**: Alignment identifies reference words not spoken (omissions)

### Teacher View

- [ ] **TCHR-01**: Teacher dashboard shows assessment results with error breakdown
- [ ] **TCHR-02**: Teacher dashboard shows progress trends over time per student
- [x] **TCHR-03**: Teacher can generate formal RTI reports (printable, with trend data)
- [x] **TCHR-04**: Teacher can view Hasbrouck-Tindal benchmark norms and "on track" indicators
- [ ] **TCHR-05**: Audio playback synced to word highlighting for teacher review

### Student View

- [ ] **STUD-01**: Student-facing animated playback with character hopping on highlighted words
- [ ] **STUD-02**: Character struggles/battles enemy at words where student had difficulty
- [ ] **STUD-03**: Gamified feedback (points, levels, streaks, progress rings)

### Infrastructure

- [ ] **INFR-01**: Codebase modularized into ES modules (alignment, scoring, ui, api, etc.)
- [ ] **INFR-02**: Async STT endpoint (longrunningrecognize) for passages >60 seconds
- [x] **INFR-03**: Assessment data persisted in localStorage with student profiles
- [x] **INFR-04**: Assessment history with per-student progress tracking
- [ ] **INFR-05**: App is a Progressive Web App (manifest.json, service worker, installable on devices)

## v2 Requirements

### Advanced Prosody

- **PROS-01**: Full prosody scoring from audio waveform analysis (pitch contour, expression, volume)
- **PROS-02**: NAEP-aligned 4-point prosody rubric scoring

### Scale

- **SCAL-01**: Backend server with secure API key management
- **SCAL-02**: User authentication (teacher accounts)
- **SCAL-03**: Cloud-based assessment storage (multi-device, multi-browser)
- **SCAL-04**: Exportable video of student playback animation

## Out of Scope

| Feature | Reason |
|---------|--------|
| Pre-loaded passage library | Teacher provides passages via photo or manual input |
| Comprehension questions / retell scoring | Separate construct from fluency |
| Student-to-student leaderboards | Harmful for struggling readers; personal bests only |
| Automatic tier placement recommendations | Requires teacher judgment and team consensus |
| Multi-student simultaneous assessment | ORF is inherently one-on-one |
| Phonics/phonemic awareness breakdown | STT operates at word level, not phoneme level |
| Real-time live scoring during reading | Batch STT processing; results after reading completes |
| Multi-language support | en-US only for v1 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 2 | Complete |
| CORE-02 | Phase 2 | Complete |
| CORE-03 | Phase 2 | Complete |
| CORE-04 | Phase 2 | Complete |
| DIAG-01 | Phase 3 | Complete |
| DIAG-02 | Phase 3 | Complete |
| DIAG-03 | Phase 3 | Complete |
| DIAG-04 | Phase 3 | Complete |
| DIAG-05 | Phase 3 | Complete |
| INPT-01 | Phase 1 | Complete |
| INPT-02 | Phase 4 | Complete |
| INPT-03 | Phase 1 | Complete |
| INPT-04 | Phase 1 | Complete |
| ALGN-01 | Phase 2 | Complete |
| ALGN-02 | Phase 2 | Complete |
| ALGN-03 | Phase 2 | Complete |
| TCHR-01 | Phase 6 | Pending |
| TCHR-02 | Phase 6 | Pending |
| TCHR-03 | Phase 7 | Complete |
| TCHR-04 | Phase 7 | Complete |
| TCHR-05 | Phase 6 | Pending |
| STUD-01 | Phase 8 | Pending |
| STUD-02 | Phase 8 | Pending |
| STUD-03 | Phase 8 | Pending |
| INFR-01 | Phase 1 | Complete |
| INFR-02 | Phase 4 | Complete |
| INFR-03 | Phase 5 | Complete |
| INFR-04 | Phase 5 | Complete |
| INFR-05 | Phase 1 | Complete |

**Coverage:**
- v1 requirements: 29 total
- Mapped to phases: 29
- Unmapped: 0

---
*Requirements defined: 2026-02-02*
*Last updated: 2026-02-02 after roadmap creation*
