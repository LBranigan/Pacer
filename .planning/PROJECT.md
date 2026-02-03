# ReadingQuest — Oral Reading Fluency Assessment

## What This Is

A browser-based oral reading fluency (ORF) assessment tool for middle school RTI Tier 2 students. A teacher photographs a book page (OCR via Google Vision) or types a passage, the student reads aloud, and Google Cloud STT transcribes the audio with word-level timestamps and confidence. The app aligns the transcript against the reference text to detect fluency challenges — substitutions, omissions, word onset delays, pauses — and computes WCPM. Two views: a teacher dashboard showing raw data and progress over time, and a student-facing gamified playback where an animated character hops across highlighted words and battles enemies at struggle points.

## Core Value

Accurate, word-level fluency error detection powered by Google Cloud STT — giving teachers actionable data on exactly where and how a struggling reader breaks down, without manual running record marking.

## Requirements

### Validated

- ✓ Audio capture via browser microphone (MediaRecorder/WebM) — existing
- ✓ Audio file upload with format detection (WAV, FLAC, OGG, MP3, WebM) — existing
- ✓ Google Cloud STT integration with word-level timestamps and confidence — existing
- ✓ Speech context boosting from reference passage — existing
- ✓ Confidence-based word coloring in results display — existing

### Active

- [ ] Google Vision OCR for photographed book pages (reference text extraction)
- [ ] Manual text input for reference passage (dev/debug mode)
- [ ] Transcript-to-reference alignment algorithm (diff/LCS)
- [ ] Word classification: correct, substitution, omission, insertion
- [ ] WCPM calculation (words correct per minute)
- [ ] Accuracy percentage
- [ ] Error breakdown by type (substitutions, omissions, insertions)
- [ ] Word onset delay detection (<1s normal, 1.5-2s developing, >3s flag, >5s frustration)
- [ ] Long non-prosodic pause detection (3s+, with comma/period allowance)
- [ ] Self-correction detection (repeated word/phrase patterns)
- [ ] Morphological error inference via suffix confidence scores
- [ ] Prosody analysis (phrasing, expression, smoothness) — medium accuracy
- [ ] Teacher dashboard with assessment data and error breakdown
- [ ] Student progress tracking over time (localStorage)
- [ ] Student-facing animated playback (character hopping on words, battles at struggle points)
- [ ] Teacher-facing formal reporting for RTI meetings and parents
- [ ] Async STT endpoint (longrunningrecognize) for passages >60 seconds

### Out of Scope

- Backend server / user authentication — local-first for now, grow later
- Pre-loaded passage library — teacher provides passages via photo or manual input
- Exportable video of student playback — in-browser animation only
- Multi-language support — en-US only
- Mobile app — browser-based only

## Context

- Target users: RTI Tier 2 middle school students (struggling readers) and their teachers
- Existing codebase: single-file HTML app with working STT pipeline (orf_assessment.html)
- Google Cloud STT v1 `latest_long` model with enhanced mode, word timestamps, and confidence
- The STT model may autocorrect morphological errors — use confidence scores to infer suffix struggles
- Self-corrections create identifiable repeated-word patterns in ASR output
- Prosody detection (phrasing, expression, smoothness) is inherently limited by STT capabilities — medium accuracy is acceptable
- Codebase needs modularization as features are added (currently monolithic single HTML file)

## Constraints

- **API**: Google Cloud STT v1 (sync endpoint, ~60s limit) — must add async for longer passages
- **API**: Google Cloud Natural Language API v1 for POS tagging, entity recognition, and word tier classification
- **Storage**: localStorage for assessment data (~5MB limit, single browser)
- **Architecture**: Client-side only, no backend — API key entered by teacher
- **OCR**: Google Vision API for book page photos
- **Audio**: Browser MediaRecorder API (WebM/Opus)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Google Vision OCR for reference text | Teacher photographs any book page, not limited to curated passages | — Pending |
| localStorage for data persistence | Simple local-first approach, no backend needed initially | — Pending |
| In-browser animation for student playback | Simpler than video rendering, sufficient for classroom use | — Pending |
| Core metrics first, prosody later | WCPM/accuracy/error classification provides immediate teacher value; prosody is lower accuracy | — Pending |
| Confidence-score approach for morphological errors | STT autocorrects suffixes but reports low confidence — usable signal | — Pending |
| NL API for word-level annotation | POS tags + entity types enable proper noun forgiveness, word tier classification, and ASR healing — reduces false errors on names | Implemented 2026-02-03 |

---
*Last updated: 2026-02-03 after NL API integration*
