# Project Research Summary

**Project:** Browser-based Oral Reading Fluency Assessment Tool
**Domain:** Educational technology / Speech-to-text assessment
**Researched:** 2026-02-02
**Confidence:** MEDIUM-HIGH

## Executive Summary

ReadingQuest is a browser-based ORF assessment tool for RTI Tier 2 middle school struggling readers, building on an existing single-file vanilla JS prototype. Research confirms the technical approach is sound: Google Cloud STT v1 provides the foundation for automated transcription, diff-match-patch enables reference-to-transcript alignment, and the single-file constraint is maintainable with ES modules. The core value proposition — automating the manual error-marking that DIBELS/AIMSweb require — is validated by research showing manual scoring suffers from inter-rater variability and training overhead.

The critical technical challenge is ASR reliability with child speech from struggling readers. Research shows child speech WER ranges from 0.30-0.78 depending on conditions, and dialectal bias in commercial ASR produces systematically unfair scores for some student populations. The mitigation strategy is clear: never treat ASR output as ground truth, build uncertainty into every error classification, test with actual target population audio from day one, and use speech adaptation (phrase hints) to boost accuracy. WCPM calculation is robust (errors tend to cancel), but word-level error detection must be presented as "words to review" with confidence indicators, never as definitive mispronunciations.

Architecture follows a clean pipeline: Audio -> STT -> Alignment -> Scoring -> Display. The alignment engine is the foundation everything else builds on — without accurate transcript-to-reference diff, no downstream feature works. Feature prioritization is clear: table stakes are WCPM, accuracy percentage, error classification, and progress tracking (all RTI Tier 2 requirements). Differentiators are automated scoring, word onset delay detection with tiered thresholds, and gamified student playback. Anti-features include pre-loaded passage libraries (use OCR instead), real-time scoring (STT is batch), and comprehension questions (out of scope). Prosody scoring requires audio waveform analysis, not STT output — defer to v2+ or skip entirely.

## Key Findings

### Recommended Stack

The stack is constrained by the single-file vanilla JS architecture. All additions must be CDN-loadable libraries with no build step required.

**Core technologies:**
- **Google Cloud STT v1 REST API** — Speech recognition with word timestamps. Already integrated. v1 still supported, stick with it rather than migrating to v2 which requires OAuth/service accounts incompatible with client-only architecture.
- **Google Cloud Vision REST API v1** — OCR for photographed passages. Same auth model as STT (API key via query param). Use DOCUMENT_TEXT_DETECTION for best accuracy on printed text.
- **diff-match-patch (Google)** — Transcript-to-reference alignment. Battle-tested Myers diff algorithm, character-level that can be post-processed to word-level. Single file, no dependencies, CDN-available.
- **localStorage** — Session metadata, scores, settings. Already decided. 5MB limit is sufficient for structured data (~2-5KB per assessment = 1000-2500 assessments).
- **IndexedDB via localForage** — Audio blobs, large datasets. localStorage caps at 5MB and is strings-only. localForage provides Promise-based localStorage-like API backed by IndexedDB. CDN-available.
- **CSS animations + vanilla JS** — Word-by-word animated playback. CSS transitions on DOM elements, requestAnimationFrame loop synced to audio timestamps. No canvas library needed for MVP.

**Supporting libraries (optional):**
- Chart.js for teacher dashboard trend visualization
- Lottie-web for richer character animations if CSS feels limiting

**What NOT to use:**
- React/Vue/Angular (contradicts single-file architecture)
- npm/Webpack/Vite build system (no build step is explicit constraint)
- Google STT v2 (requires OAuth, cannot use API key from browser)
- Tesseract.js for OCR (15MB WASM, worse accuracy than Cloud Vision)
- Full game engines (Phaser, Unity WebGL) for character animation (massive overkill)

### Expected Features

**Must have (table stakes for RTI Tier 2 teachers):**
- WCPM calculation — the universal fluency metric, teachers are trained to interpret it
- Accuracy percentage — determines instructional level (independent >97%, instructional 90-97%, frustration <90%)
- Error classification (substitutions, omissions, insertions) — standard running record taxonomy
- Timed assessment (passage duration tracking)
- Progress monitoring over time — RTI Tier 2 requires biweekly data, teachers must see growth trends
- Goal setting with benchmark comparison — Hasbrouck-Tindal norms, show if student is "on track" vs "at risk"
- Printable/shareable reports for RTI meetings — documentation required for team decisions
- Reference passage input (OCR or manual text)

**Should have (competitive differentiators):**
- Automated transcription and scoring — eliminates inter-rater variability, no examiner training needed
- Word onset delay detection with tiered thresholds — novel heat map of where decoding breaks down (not available in DIBELS/AIMSweb)
- Long pause detection with punctuation allowance — distinguishes prosodic pauses from dysfluent pauses
- Self-correction detection — diagnostically important, DIBELS counts them as correct but doesn't track separately
- Gamified student playback with animated character — no standard ORF tool has student-facing experience, high engagement value for struggling middle schoolers
- Photographed passage via OCR — removes friction of typing passages, not limited to curated passage banks
- Audio playback synced to word highlighting — teacher can re-listen to specific moments, unavailable in paper-based ORF

**Defer (v2+ or anti-features):**
- Pre-loaded passage library — licensing costs, maintenance burden, limits teacher flexibility (use OCR instead)
- Real-time live scoring during reading — STT is batch processing, architectural complexity for minimal gain
- Comprehension questions / retell scoring — separate construct from fluency, massive scope increase
- Student-to-student leaderboards — harmful for struggling readers, use personal bests instead
- Automatic tier placement recommendations — tier decisions require multiple data sources and team consensus
- Detailed phonics/phonemic awareness breakdown — different assessment, STT operates at word level not phoneme level
- Full prosody scoring (pitch/expression) — requires audio waveform analysis, not STT output

### Architecture Approach

Clean pipeline architecture: Audio Capture -> STT Service -> Alignment Engine -> Scoring Engine -> Display. The assessment flow is linear with clear stage boundaries. Each stage is pure computation where possible (alignment and scoring are pure functions with no side effects), services wrap external APIs (STT, OCR), and views consume data via event-driven updates from the Data Store.

**Major components:**
1. **Services layer** (audio-capture.js, stt-service.js, ocr-service.js, data-store.js) — External API wrappers isolated from business logic. Each has single external dependency. Testable by mocking fetch.
2. **Engines layer** (alignment.js, scoring.js, animation.js) — Pure computation with no DOM or API dependencies. Alignment and scoring are the clinical core — pure functions make them testable and reusable.
3. **Views layer** (teacher dashboard, student playback) — UI rendering grouped by user role. Each view reads from Data Store and calls engines as needed. Event-driven updates decouple pipeline from rendering.
4. **Assessment Controller** — Orchestrates full pipeline, glue between services and UI, but doesn't compute anything itself.

**Build order based on dependencies:**
- Level 0: data-store, audio-capture (no dependencies)
- Level 1: stt-service, ocr-service (need Level 0)
- Level 2: alignment engine (needs STT result + reference text) — THIS IS THE CRITICAL FOUNDATION
- Level 3: scoring engine (needs alignment output)
- Level 4: teacher dashboard, animation engine (need scoring + alignment)
- Level 5: student playback, progress tracking (need Level 4)

**Key patterns:**
- Pipeline architecture for assessment flow (simple to reason about, rigid but appropriate for linear dependencies)
- Event-driven view updates (Data Store emits events, views re-render independently)
- Pure engine functions (alignment/scoring have no side effects, maximizes testability)

### Critical Pitfalls

1. **Child speech WER degrades all downstream measures** — Google Cloud STT has no child-specific model. Research shows child WER 0.30-0.78. Struggling readers who speak quietly with hesitations will be even higher. Every measure (WCPM, omissions, substitutions, prosody) is built on transcript — 30% WER means 30% of word-level signals are corrupted. **Prevention:** Test with actual target population audio from day one (never validate on adult/fluent speech), use speech adaptation (phrase hints with passage text), set realistic accuracy expectations per measure, communicate uncertainty explicitly. This is a Phase 0 go/no-go gate.

2. **Dialect and accent bias producing systematically unfair scores** — Research shows WER 0.35 for Black speakers vs 0.19 for white speakers. AAE morpho-syntactic features are disproportionately error-prone. For RTI Tier 2 population, this means tool systematically scores some students lower based on dialect, not reading ability. This is an equity and validity problem. **Prevention:** Build dialect-aware scoring layer with allowlist of known dialectal patterns, never treat dialectal variants as errors, include teacher override mechanism, report accuracy disaggregated by demographics during validation. Must be designed into error taxonomy from Phase 2, not bolted on later.

3. **Treating ASR confidence scores as mispronunciation detectors** — Developers use low confidence scores to flag mispronunciations. In practice, confidence distributions for correct/incorrect words overlap massively. Research shows "moderate success at best, failing to detect most errors or producing many false positives." **Prevention:** Never use single confidence threshold as binary classifier, use confidence as one signal in multi-feature system, compare transcript against expected text for substitution detection, validate against human-scored samples. Build multi-signal architecture in Phase 1 before any error classification.

4. **Conflating ASR errors with reading errors in the error taxonomy** — System cannot distinguish "student said wrong word" from "ASR heard wrong word." Both appear as transcript mismatches. Without this distinction, every reported metric conflates system error with student error. **Prevention:** Never report word-level errors as definitive, report as "possible errors" with confidence indicators, use confidence scores to weight error reports, aggregate to passage-level metrics where errors average out, design teacher UI as "review these" not "these are wrong." Phase 2 error taxonomy must include "uncertain" category from start.

5. **Google Cloud STT word timestamps are not precise enough for fine-grained timing** — Timestamps look precise (fractional seconds) but accuracy is limited. Forced alignment phone boundaries are typically 10-25ms for adults, degrade for children. Building pause detection on 100ms+ uncertainty produces unreliable results. **Prevention:** Use STT timestamps for coarse measures only (total reading time, WCPM, pauses >2-3 seconds), validate timestamp accuracy against manually annotated samples, define minimum detectable pause duration based on empirical testing (likely 500ms+), do NOT attempt phoneme-level timing. Establish timing accuracy bounds in Phase 1 before building features on them.

6. **Prosody detection is aspirational with STT-only architecture** — STT returns text and timestamps, discards acoustic features that encode prosody (pitch contours, stress patterns, intonation). You cannot recover prosody from transcript. Research confirms prosody assessment "takes significantly longer than ORF but does not improve accuracy of fluency measure." **Prevention:** Separate prosody from STT pipeline entirely. For MVP, do not attempt prosody scoring. If needed, scope as separate milestone processing raw audio (not through STT). Use pause patterns from STT as rough proxy for phrasing aspect only, but don't call it "prosody scoring." Defer to Phase 3+ or skip entirely.

7. **Self-correction detection requires temporal patterns STT may not support** — Self-corrections are acoustically messy. STT is optimized to produce clean transcript, may "clean up" self-corrections into single word. Detection accuracy is very low. **Prevention:** Treat as LOW confidence from start, look for patterns where STT returns two words where one expected, do not count as errors (they indicate good monitoring), consider "bonus signal when detected" not reliable measure. Phase 2-3 feature, be transparent about low reliability.

## Implications for Roadmap

Based on research, suggested phase structure follows the natural dependency chain discovered in architecture research:

### Phase 0: Foundation & Validation
**Rationale:** Before building any features, establish that the core STT pipeline produces usable results with the target population. This is the go/no-go gate.
**Delivers:** WER measurement on target population audio (middle school struggling readers), speech adaptation implementation (phrase hints), baseline accuracy benchmarks.
**Critical validation:** If WER exceeds 35-40% on target audio, the approach may not be viable. Establish this immediately.
**Avoids pitfall:** Child speech WER degradation (Pitfall #4). Testing with actual target population from day one prevents building features on a foundation that won't work.

### Phase 1: Core Pipeline & Modularization
**Rationale:** The alignment engine is the foundation everything else builds on. No downstream feature works without accurate transcript-to-reference diff. Extract existing code into clean modules while building this critical component.
**Delivers:**
- Modularized codebase (audio-capture, stt-service, data-store as ES modules)
- Alignment engine using diff-match-patch (character-level diff post-processed to word-level)
- Basic WCPM and accuracy calculation
- Passage input (manual text entry)
**Addresses features:** WCPM calculation, accuracy percentage, reference passage input (table stakes)
**Avoids pitfalls:**
- Confidence score misuse (Pitfall #3) — build multi-signal architecture from start
- Timestamp precision (Pitfall #5) — establish timing accuracy bounds before building timing features
- Technical debt of monolithic code before complexity increases

### Phase 2: Error Classification & Teacher Dashboard
**Rationale:** Once alignment is proven accurate, build the error taxonomy and teacher-facing reporting. This is where uncertainty management is critical.
**Delivers:**
- Error classification (substitutions, omissions, insertions) with confidence indicators
- Word onset delay detection with tiered thresholds (<1s normal, 1.5-2s developing, >3s flag)
- Basic teacher dashboard showing assessment results, error breakdown
- Assessment history in localStorage
- Progress tracking over time
**Addresses features:** Error classification, progress monitoring, word onset delay detection (table stakes + differentiators)
**Avoids pitfalls:**
- ASR/reading error conflation (Pitfall #4) — error taxonomy includes "uncertain" category, UI shows "words to review" not "mispronounced"
- Dialect bias (Pitfall #2) — error classification includes dialect-aware layer, allowlist for dialectal patterns, teacher override mechanism
**Uses stack:** localStorage for persistence, diff-match-patch alignment output, STT word timestamps

### Phase 3: OCR & Enhanced Diagnostics
**Rationale:** OCR removes friction of manual text entry. Long pause detection and self-correction add diagnostic depth once core error classification is solid.
**Delivers:**
- Google Cloud Vision OCR integration for photographed passages
- Long pause detection with punctuation awareness
- Self-correction detection (labeled as LOW confidence)
- Goal setting with Hasbrouck-Tindal benchmark norms
- Formal RTI report generation
**Addresses features:** Photographed passage OCR, long pause detection, self-correction detection, goal setting/benchmarks (differentiators + table stakes)
**Uses stack:** Google Cloud Vision REST API, enhanced scoring engine
**Avoids pitfall:** Self-correction detection (Pitfall #7) — build it, measure it, transparent about low reliability

### Phase 4: Student Engagement
**Rationale:** Gamified playback is complex UI work but has no dependencies on earlier stages being perfect. It's a leaf node consuming alignment/timing data. Build after teacher-facing tools are solid and validated.
**Delivers:**
- Animation engine (CSS transitions + requestAnimationFrame)
- Student playback view with character hopping across words
- Audio replay synced to word highlighting
- Personal best tracking (progress-against-self, not leaderboards)
**Addresses features:** Gamified student playback, audio playback with word sync (major differentiators)
**Uses stack:** CSS animations, STT word timestamps for sync, alignment data for highlighting
**Implements architecture:** Animation engine component, student view

### Phase 5: Teacher Scale & Polish
**Rationale:** After core validation with single students, add multi-student management and visualization for classroom use.
**Delivers:**
- Multi-student dashboard with trend visualization (Chart.js)
- Class-level progress view
- Export/import JSON for portability across devices
- Enhanced RTI report formatting
**Addresses features:** Teacher dashboard multi-student views, enhanced progress monitoring
**Uses stack:** Chart.js from CDN, enhanced data-store with student management

### Phase Ordering Rationale

- **Phase 0 before all others:** Must establish that STT produces viable results with target population before investing in features. This is the fundamental technical risk.
- **Phase 1 builds the foundation:** Alignment engine is the critical dependency for Phases 2-5. Nothing downstream works without it.
- **Phase 2 before Phase 3:** Error classification architecture must be solid before adding OCR and advanced diagnostics. Dialect-aware error handling needs to be baked into taxonomy before surface area increases.
- **Phase 4 deferred until after Phase 2-3:** Student-facing gamification is high-value but not critical path for teacher validation. Build and validate teacher tools first.
- **Phase 5 is scale, not MVP:** Multi-student management is needed at scale but not for initial teacher validation with few students.

This ordering follows the natural dependency chain from architecture research (Level 0 -> Level 1 -> Level 2 -> Level 3 -> Level 4 -> Level 5) while front-loading the critical technical risks (child speech WER, alignment accuracy) and deferring nice-to-haves (gamification, scale features) until core value is proven.

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 0:** May need additional research on speech adaptation best practices, phrase hint formatting, and WER benchmarking methodology.
- **Phase 2:** Dialect-aware error classification is novel — may need linguistic research on AAE patterns, dialectal variant lists. No off-the-shelf solution.
- **Phase 4:** Animation engine implementation if CSS approach proves limiting — may need research on Lottie integration or PixiJS lightweight canvas patterns.

**Phases with standard patterns (skip research-phase):**
- **Phase 1:** Text alignment with diff-match-patch is well-documented. LCS/edit distance is standard CS curriculum.
- **Phase 3:** Google Cloud Vision OCR is straightforward API integration with clear documentation.
- **Phase 5:** Chart.js integration is well-documented, trend visualization is standard data vis problem.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Technologies are battle-tested (diff-match-patch powers Google Docs, STT v1 confirmed active, Cloud Vision is GA). CDN-loadable constraint is clear. Single-file architecture is maintainable with ES modules. |
| Features | MEDIUM-HIGH | Table stakes validated against DIBELS/AIMSweb research and RTI requirements. Differentiators (onset delay, automated scoring) are novel but technically feasible. Prosody correctly identified as out of scope. MVP definition is clear. |
| Architecture | HIGH | Pipeline pattern is appropriate for linear dependencies. Component boundaries are clean (services, engines, views). Build order follows natural dependency chain. Pure functions for core logic maximizes testability. |
| Pitfalls | MEDIUM-HIGH | Critical pitfalls well-documented in research literature (child speech WER, dialect bias, confidence score misuse). Prevention strategies are specific and actionable. Some uncertainty around dialectal variant lists (requires linguistic expertise). |

**Overall confidence:** MEDIUM-HIGH

The technical approach is sound and the architecture is clean. The major uncertainties are:
1. Whether child speech WER with Google Cloud STT v1 will be acceptable for target population (Phase 0 validation gates this)
2. Whether dialect-aware error classification can be implemented effectively without linguistic expertise
3. Whether STT timestamp precision is sufficient for word onset delay detection (requires empirical testing in Phase 1)

These are known unknowns with clear validation paths, not unknown unknowns.

### Gaps to Address

**Dialectal variant allowlist:** Research identifies dialect bias as critical pitfall but doesn't provide ready-to-use allowlist of AAE or other dialectal patterns. This needs linguistic research or consultation during Phase 2 planning. Consider partnering with linguist or using published AAE feature lists from applied linguistics research.

**WER benchmarking methodology:** Phase 0 requires measuring WER on target population audio against human transcripts. Need to define sampling strategy (how many students, how many passages, what diversity), transcription protocol, and acceptable WER threshold. This is methodology gap, not technical gap.

**Confidence score calibration:** Research shows confidence scores are unreliable for error detection, but doesn't provide specific guidance on how to use them as one signal in multi-feature system. Phase 1 alignment/scoring will need to experiment with weighting approaches and validate empirically.

**Timestamp accuracy validation:** Need to establish empirical bounds on STT timestamp precision for pause detection. Requires manual annotation of a subset of audio to measure timestamp error distribution. Phase 1 task.

**Hasbrouck-Tindal norms integration:** Phase 3 requires grade-level WCPM benchmark data. Need to obtain the published norms (likely from Hasbrouck & Tindal 2006 or updated versions) and structure them for lookup. Data gap, not technical gap.

## Sources

### Primary (HIGH confidence)
- **STACK.md** — Google Cloud STT v1 REST API documentation (confirmed active Dec 2025), Google Cloud Vision API documentation, diff-match-patch GitHub repository, MDN Storage API docs, web.dev IndexedDB guidance
- **FEATURES.md** — DIBELS 8th Edition ORF scoring practice, AIMSweb Plus (NCII charts + Pearson docs), IES Practice Guide on RTI Tier 2 progress monitoring, Read Naturally RTI assessments
- **ARCHITECTURE.md** — Existing codebase analysis (orf_assessment.html), Google Cloud STT/Vision REST API references, Web Audio API / MediaRecorder API (MDN), PROJECT.md constraints
- **PITFALLS.md** — Peer-reviewed research: CHI 2025 on ASR confidence scores, PNAS 2020 on racial disparities in ASR (Koenecke et al.), Applied Linguistics 2023 on AAE bias, PMC 2024 on alignment error in children's speech, Interspeech 2025 on improving ASR for children, JASA 2025 on voice assistant underperformance, Google Cloud STT best practices docs

### Secondary (MEDIUM confidence)
- Frontiers in Education 2024 on prosody in ORF (automated prosody achieves ~62.5% accuracy)
- Arxiv 2025 on deep learning for ORF assessment (state of art for automated WCPM)
- EDM 2022 on ASR feasibility in classrooms (WER 0.78 in classroom environments)
- Reading Rockets / Shanahan on Literacy blog posts on WCPM interpretation
- Frontiers in Computer Science 2022 on gamified reading fluency training (77% improvement with meaningful gamification)

### Tertiary (LOW confidence, needs validation)
- npm-compare.com library adoption statistics (used for diff library comparison)
- Generalist Programmer Phaser vs PixiJS comparison (used for animation library sizing)
- Specific confidence score threshold recommendations (none found in research — will need to derive empirically)

---
*Research completed: 2026-02-02*
*Ready for roadmap: yes*
