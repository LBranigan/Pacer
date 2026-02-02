# Roadmap: ReadingQuest

## Overview

ReadingQuest delivers automated oral reading fluency assessment by building up from a modularized codebase through the core alignment pipeline, layering diagnostics and OCR on top, persisting data for progress tracking, and finally delivering teacher and student interfaces. The critical path runs through alignment (Phase 2) -- nothing downstream works without accurate transcript-to-reference diff.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Modularize monolith, establish input pipeline ✓
- [x] **Phase 2: Alignment & Core Metrics** - Transcript-to-reference alignment, WCPM, accuracy, word classification ✓
- [x] **Phase 3: Diagnostics** - Onset delay, pauses, self-corrections, morphological errors, prosody proxy ✓
- [ ] **Phase 4: OCR & Async STT** - Google Vision OCR for book pages, long passage support
- [ ] **Phase 5: Data Persistence** - localStorage student profiles and assessment history
- [ ] **Phase 6: Teacher Dashboard** - Assessment results, progress trends, synced audio playback
- [ ] **Phase 7: Teacher Reporting & Benchmarks** - RTI reports, Hasbrouck-Tindal norms
- [ ] **Phase 8: Student Experience** - Animated playback with character, battles, gamification

## Phase Details

### Phase 1: Foundation
**Goal**: Existing monolithic HTML app is modularized into ES modules with manual text input working as a reference passage source. App is a PWA installable on classroom devices.
**Depends on**: Nothing (first phase)
**Requirements**: INFR-01, INFR-05, INPT-01, INPT-03, INPT-04
**Success Criteria** (what must be TRUE):
  1. Codebase is split into ES modules (alignment, scoring, ui, api, data-store) importable from a single HTML entry point
  5. App is a PWA with manifest.json and service worker, installable on classroom devices
  2. Teacher can type or paste a reference passage into a text input area
  3. Student audio can be captured via browser microphone and transcribed via Google Cloud STT (existing functionality preserved)
  4. Audio file upload with format detection works (existing functionality preserved)
**Plans**: 2 plans

Plans:
- [ ] 01-01-PLAN.md -- Modularize monolith into ES modules with extracted CSS
- [ ] 01-02-PLAN.md -- Add PWA support (manifest, service worker, icons)

### Phase 2: Alignment & Core Metrics
**Goal**: App aligns STT transcript against reference text and computes core fluency metrics (WCPM, accuracy, word classification)
**Depends on**: Phase 1
**Requirements**: ALGN-01, ALGN-02, ALGN-03, CORE-01, CORE-02, CORE-03, CORE-04
**Success Criteria** (what must be TRUE):
  1. After a student reads aloud, the app displays each reference word marked as correct, substitution, omission, or insertion
  2. WCPM (words correct per minute) is calculated and displayed after each assessment
  3. Accuracy percentage (correct words / total reference words) is displayed after each assessment
  4. Assessment duration is tracked with a visible timer during reading and reflected in passage-level timing
  5. Insertions (words spoken but not in reference) are identified and shown separately
**Plans**: 2 plans

Plans:
- [ ] 02-01-PLAN.md -- Text normalization, alignment engine, and metrics modules
- [ ] 02-02-PLAN.md -- Wire pipeline and color-coded UI display

### Phase 3: Diagnostics
**Goal**: App detects fine-grained fluency challenges beyond simple word correctness -- onset delays, pauses, self-corrections, morphological struggles, and crude prosody signals
**Depends on**: Phase 2
**Requirements**: DIAG-01, DIAG-02, DIAG-03, DIAG-04, DIAG-05
**Success Criteria** (what must be TRUE):
  1. Words with onset delay are flagged with tiered severity (developing 1.5-2s, flag >3s, frustration >5s) visible in results
  2. Long non-prosodic pauses (3s+) are detected and displayed, with commas/periods given extra allowance
  3. Self-corrections are identified from repeated-word patterns and shown as a separate category (not counted as errors)
  4. Words with low suffix confidence are flagged as possible morphological errors
  5. A crude prosody proxy is computed from pause-at-punctuation patterns and displayed alongside other metrics
**Plans**: 2 plans

Plans:
- [ ] 03-01-PLAN.md -- Diagnostics computation module (all five analyzers)
- [ ] 03-02-PLAN.md -- Wire diagnostics into pipeline and render in UI

### Phase 4: OCR & Async STT
**Goal**: Teachers can photograph a book page to extract reference text, and passages longer than 60 seconds are handled via async STT
**Depends on**: Phase 1
**Requirements**: INPT-02, INFR-02
**Success Criteria** (what must be TRUE):
  1. Teacher can photograph or upload a book page image and the app extracts readable text via Google Vision OCR
  2. Extracted OCR text can be reviewed and edited before use as the reference passage
  3. Audio recordings longer than 60 seconds are processed via the async longrunningrecognize endpoint without error
**Plans**: 2 plans

Plans:
- [ ] 04-01-PLAN.md — Google Vision OCR: image upload, text extraction, editable preview, use as reference passage
- [ ] 04-02-PLAN.md — Async STT: longrunningrecognize with polling, chunked sync fallback, duration-based routing

### Phase 5: Data Persistence
**Goal**: Assessment data persists across sessions with student profiles and history
**Depends on**: Phase 2
**Requirements**: INFR-03, INFR-04
**Success Criteria** (what must be TRUE):
  1. Teacher can create and select student profiles stored in localStorage
  2. Completed assessments are saved and persist across browser sessions
  3. Assessment history is viewable per student, showing all past assessments with dates and scores
**Plans**: 2 plans

Plans:
- [ ] 05-01-PLAN.md — Storage module and HTML/CSS scaffolding for student profiles and history
- [ ] 05-02-PLAN.md — Wire storage into app, auto-save assessments, render history

### Phase 6: Teacher Dashboard
**Goal**: Teachers can review assessment results in detail, track student progress over time, and replay audio synced to words
**Depends on**: Phase 2, Phase 5
**Requirements**: TCHR-01, TCHR-02, TCHR-05
**Success Criteria** (what must be TRUE):
  1. Teacher dashboard displays assessment results with full error breakdown (substitutions, omissions, insertions, counts, and locations)
  2. Teacher can view progress trends over time per student (WCPM and accuracy plotted across assessments)
  3. Teacher can play back student audio with word-by-word highlighting synced to STT timestamps
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

### Phase 7: Teacher Reporting & Benchmarks
**Goal**: Teachers can generate formal reports for RTI meetings and see how students compare to grade-level norms
**Depends on**: Phase 6
**Requirements**: TCHR-03, TCHR-04
**Success Criteria** (what must be TRUE):
  1. Teacher can generate a printable RTI report with student trend data, error breakdown, and assessment history
  2. Hasbrouck-Tindal benchmark norms are displayed alongside student scores with "on track" / "at risk" indicators
**Plans**: TBD

Plans:
- [ ] 07-01: TBD

### Phase 8: Student Experience
**Goal**: Students see a gamified, animated playback of their reading with a character that reacts to their performance
**Depends on**: Phase 2, Phase 3
**Requirements**: STUD-01, STUD-02, STUD-03
**Success Criteria** (what must be TRUE):
  1. After assessment, student can watch an animated character hop word-by-word across the highlighted passage in sync with their audio
  2. At words where the student struggled (errors, long delays), the character visibly battles an enemy or obstacle
  3. Student receives gamified feedback: points earned, streaks for consecutive correct words, and a progress ring showing improvement over past attempts
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8
(Phases 3, 4, 5 can potentially run in parallel after Phase 2)

| Phase | Plans Complete | Status | Completed |
|-------|---------------|--------|-----------|
| 1. Foundation | 2/2 | Complete ✓ | 2026-02-02 |
| 2. Alignment & Core Metrics | 2/2 | Complete ✓ | 2026-02-02 |
| 3. Diagnostics | 2/2 | Complete ✓ | 2026-02-02 |
| 4. OCR & Async STT | 2/2 | Complete ✓ | 2026-02-02 |
| 5. Data Persistence | 0/2 | Not started | - |
| 6. Teacher Dashboard | 0/TBD | Not started | - |
| 7. Teacher Reporting & Benchmarks | 0/TBD | Not started | - |
| 8. Student Experience | 0/TBD | Not started | - |
