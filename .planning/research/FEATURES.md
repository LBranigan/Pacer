# Feature Research

**Domain:** Oral Reading Fluency (ORF) Assessment Tools
**Researched:** 2026-02-02
**Confidence:** MEDIUM-HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features every ORF assessment tool provides. Missing any of these and RTI Tier 2 teachers will not take the tool seriously.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| WCPM calculation | The universal fluency metric. DIBELS, AIMSweb, Read Naturally all center on it. Teachers are trained to interpret WCPM. Without it, the tool is not an ORF tool. | LOW | Already scoped in PROJECT.md. Straightforward: count correct words / elapsed minutes. |
| Accuracy percentage | Standard companion to WCPM. Every running record and ORF tool reports it. Teachers use accuracy to determine instructional level (independent >97%, instructional 90-97%, frustration <90%). | LOW | Derived directly from alignment results. |
| Error classification (substitutions, omissions, insertions) | Running records have always categorized errors this way. Teachers are trained in this taxonomy. DIBELS scores mispronunciations, substitutions, omissions, and 3-second hesitations as errors. | MEDIUM | Core alignment algorithm output. The transcript-to-reference diff is the foundation everything else builds on. |
| Timed assessment (1-minute or passage-based) | DIBELS and AIMSweb use 1-minute timed probes. Teachers expect a timer or at minimum a passage-duration measurement. | LOW | Timer UI plus passage duration tracking from audio timestamps. |
| Progress monitoring over time | RTI Tier 2 requires biweekly progress monitoring per IES guidelines. Teachers must see growth trends to make tier decisions (continue Tier 2, move to Tier 3, return to Tier 1). This is non-negotiable for RTI compliance. | MEDIUM | Requires data persistence, trend visualization, and goal-line comparison. localStorage is the planned approach. |
| Goal setting with benchmark comparison | AIMSweb provides ROI sliders (Rate of Improvement). DIBELS has grade-level benchmark goals. Teachers need to know if a student is "on track" vs "at risk" vs "well below." | MEDIUM | Need grade-level WCPM norms (Hasbrouck-Tindal norms are standard). Display goal line on progress chart. |
| Printable/shareable reports for RTI meetings | RTI decisions require documentation. Teachers bring data to team meetings. Reports must show current level, trend, error patterns, and intervention response. | MEDIUM | Generate structured report view. Print-friendly CSS or PDF generation. |
| Reference passage input | Every ORF tool has a known passage the student reads. The tool compares oral reading to expected text. Without this, you cannot compute accuracy or classify errors. | LOW | Already scoped: OCR via Google Vision or manual text input. |

### Differentiators (Competitive Advantage)

Features that set ReadingQuest apart from DIBELS/AIMSweb paper-based workflows and basic digital tools.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Automated transcription and scoring | DIBELS and AIMSweb require a trained examiner to manually mark errors in real-time while listening. This is error-prone, requires training, and creates inter-rater variability. Automated STT-based scoring eliminates this. NAEP uses speech-to-text for rate/accuracy but still relies on humans for prosody. | HIGH | This is the core technical bet. Google Cloud STT does the heavy lifting, but alignment accuracy is everything. |
| Word onset delay detection with tiered thresholds | No standard ORF tool provides granular hesitation data. DIBELS only counts 3-second waits as errors (binary). ReadingQuest's tiered approach (<1s normal, 1.5-2s developing, >3s flag, >5s frustration) gives teachers a heat map of where decoding breaks down. | MEDIUM | Derived from STT word-level timestamps. The thresholds are novel and need validation with teachers. |
| Long pause detection with punctuation allowance | Distinguishes between prosodic pauses (appropriate at commas/periods) and dysfluent pauses (mid-sentence stalls). Standard tools lump all pauses together or ignore them. | MEDIUM | Requires cross-referencing pause locations with reference text punctuation positions. |
| Self-correction detection | Self-corrections are diagnostically important (they indicate the student is monitoring comprehension) but hard to capture in standard timed assessments. DIBELS counts self-corrections as correct but does not track them as a separate metric. | MEDIUM | Pattern: STT produces repeated word sequences when a student says "the... the cat" or backs up and re-reads. Detectable but may have false positives. |
| Morphological error inference via confidence scores | No existing tool captures suffix-level errors ("walked" read as "walking"). STT autocorrects these but reports low confidence, which is a usable signal. Unique to this approach. | HIGH | Novel technique. Confidence is a proxy, not a direct measurement. Needs validation. Flag as experimental. |
| Prosody scoring (phrasing, expression, smoothness) | NAEP Oral Reading Fluency Scale is the gold standard (4-point rubric). Current automated prosody research achieves ~62.5% accuracy with deep learning. Most commercial tools skip prosody or rely on human raters. Even partial automation is differentiating. | HIGH | Research frontier. STT alone is insufficient -- would need pitch/intensity analysis from audio waveform. Acceptable to start with coarse measures (appropriate pausing at punctuation = phrasing proxy). |
| Gamified student playback with animated character | No standard ORF tool provides a student-facing experience. DIBELS/AIMSweb are entirely teacher-facing. Middle school struggling readers are demotivated; gamification turns assessment data into engagement. Research shows 77% reading improvement with gamified approaches. | HIGH | Animated character hopping on words, battles at struggle points. Significant frontend work but high engagement value. |
| Photographed passage via OCR | Teachers currently type passages or use only pre-loaded passage banks. Photographing any book page and extracting text via OCR means teachers are not limited to curated passages. This removes a major friction point. | MEDIUM | Google Vision API handles OCR. Needs post-processing for formatting artifacts. |
| Audio playback synced to word highlighting | Teachers can re-listen to specific reading moments rather than relying on real-time memory. This is unavailable in paper-based ORF. | MEDIUM | Audio element synced to word-level timestamps from STT. Valuable for teacher review and student self-reflection. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Pre-loaded passage library with readability levels | Seems convenient; standard in DIBELS/AIMSweb | Licensing costs for passages, maintenance burden, limits teacher flexibility, and ReadingQuest's value is the STT pipeline not the content library | OCR any book page. Teacher chooses passages matching their curriculum. Optionally link to free passage sources (e.g., public domain texts). |
| Real-time live scoring during reading | Teachers want to see errors as the student reads | Google Cloud STT batch processing (especially async for >60s) means results come after reading. Attempting real-time creates latency issues, partial results, and architectural complexity. | Near-real-time: process immediately after reading completes. Results in seconds, not during reading. |
| Comprehension questions / retell scoring | DIBELS includes passage retell. Comprehension is part of the full fluency picture. | Comprehension is a separate construct from fluency. Building question banks or retell scoring adds massive scope. The tool's value is fluency measurement. | Note in reports: "Complement with comprehension assessment." Teacher can pair ReadingQuest with their existing comprehension tools. |
| Student-to-student leaderboards | Gamification often includes competition | Struggling readers are already demoralized. Public comparison is harmful for Tier 2 students. Research on meaningful gamification warns against shallow competitive mechanics. | Personal bests, streaks, and progress-against-self. The animated character "levels up" based on individual improvement, not class rank. |
| Automatic tier placement recommendations | Teachers want the tool to say "move to Tier 3" | Tier decisions involve multiple data sources, teacher judgment, parent input, and team consensus. Automated recommendations oversimplify and may create liability. | Show data clearly with benchmark overlays. Let the data speak. Provide decision-support (trend lines, ROI calculations) not decisions. |
| Multi-student simultaneous assessment | Classroom-wide ORF at once would save time | ORF is inherently one-on-one (student reads aloud). Multiple students reading simultaneously creates audio interference. Some AI tools claim whole-class listening but accuracy drops severely. | Efficient single-student workflow. Minimize overhead so a teacher can assess a student in 2-3 minutes total. |
| Detailed phonics/phonemic awareness breakdown | Some tools (DIBELS) assess phoneme segmentation separately | This is a different assessment entirely. STT transcription operates at the word level, not the phoneme level. Attempting phoneme-level analysis from word-level STT is unreliable. | Report error patterns at the word level. Teachers can infer phonics gaps from substitution patterns (e.g., consistently misreading vowel teams). |

## Feature Dependencies

```
[Reference Text Input (OCR/Manual)]
    |
    v
[Audio Recording + STT Transcription]
    |
    v
[Transcript-to-Reference Alignment] --- foundation for everything below
    |
    +---> [WCPM Calculation]
    +---> [Accuracy Percentage]
    +---> [Error Classification (sub/omit/insert)]
    |        +---> [Morphological Error Inference] (needs confidence scores)
    |        +---> [Self-Correction Detection] (needs repeated-word patterns)
    +---> [Word Onset Delay Detection] (needs word timestamps)
    +---> [Long Pause Detection] (needs word timestamps + ref punctuation)
    +---> [Audio Playback with Word Sync] (needs word timestamps)
    |
    v
[Progress Tracking] --- requires stored assessment results
    +---> [Goal Setting / Benchmark Comparison]
    +---> [Teacher Dashboard]
    +---> [RTI Reporting]
    +---> [Student Gamified Playback] (needs alignment + timestamps + error data)

[Prosody Analysis] --- partially independent; needs audio waveform analysis
    +---> crude version from pause/punctuation alignment (Medium)
    +---> full version from pitch/intensity features (High, later)
```

### Dependency Notes

- **Everything requires Alignment:** The transcript-to-reference alignment algorithm is the critical foundation. No fluency metric works without it.
- **Word timestamps enable three features independently:** onset delay, pause detection, and audio playback sync. These can be built in parallel once alignment exists.
- **Progress tracking requires persistence:** localStorage is sufficient initially but creates a single-browser limitation. This constrains multi-device use.
- **Gamified playback is a leaf node:** It consumes all upstream data (alignment, timestamps, errors) but nothing depends on it. Can be built last without blocking anything.
- **Prosody has two tiers:** A crude "phrasing proxy" (pauses at punctuation) can be built from existing STT data. True prosody (pitch contour, expression) requires audio waveform analysis, which is a separate technical track.

## MVP Definition

### Launch With (v1)

Minimum viable product -- what teachers need to start using this instead of manual running records.

- [ ] Reference text input (manual entry; OCR can follow) -- teachers need a passage to compare against
- [ ] Audio recording and STT transcription -- the core pipeline (already exists)
- [ ] Transcript-to-reference alignment with error classification -- the foundation
- [ ] WCPM and accuracy percentage -- the metrics teachers are trained on
- [ ] Word onset delay detection -- immediate differentiator, low marginal cost once timestamps exist
- [ ] Basic results display with error highlighting -- teachers must see what happened
- [ ] Assessment history in localStorage -- teachers need to see "is the student improving?"

### Add After Validation (v1.x)

Features to add once core alignment is proven accurate.

- [ ] Google Vision OCR for book page photos -- removes text input friction
- [ ] Long pause detection with punctuation awareness -- enhances diagnostic value
- [ ] Self-correction detection -- diagnostically valuable, needs pattern validation
- [ ] Goal setting with Hasbrouck-Tindal benchmark norms -- teachers need "on track" context
- [ ] Formal RTI report generation -- needed for team meetings
- [ ] Audio playback synced to word highlighting -- teacher review tool
- [ ] Async STT for passages >60 seconds -- removes the 1-minute constraint

### Future Consideration (v2+)

Features to defer until core product is validated with teachers.

- [ ] Prosody scoring (beyond crude phrasing proxy) -- requires audio waveform analysis, research-grade difficulty
- [ ] Morphological error inference -- novel technique needing validation
- [ ] Student gamified playback with animated character -- high value but high cost, build after teacher-facing tools are solid
- [ ] Teacher dashboard with multi-student views -- needed at scale but not for initial validation

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Transcript-to-reference alignment | HIGH | HIGH | P1 |
| WCPM calculation | HIGH | LOW | P1 |
| Accuracy percentage | HIGH | LOW | P1 |
| Error classification (sub/omit/insert) | HIGH | MEDIUM | P1 |
| Word onset delay detection | HIGH | LOW | P1 |
| Progress tracking (localStorage) | HIGH | MEDIUM | P1 |
| Reference text input (manual) | HIGH | LOW | P1 |
| Google Vision OCR | MEDIUM | MEDIUM | P2 |
| Long pause detection | MEDIUM | LOW | P2 |
| Self-correction detection | MEDIUM | MEDIUM | P2 |
| Goal setting with benchmarks | HIGH | MEDIUM | P2 |
| RTI report generation | HIGH | MEDIUM | P2 |
| Audio playback with word sync | MEDIUM | MEDIUM | P2 |
| Async STT (>60s passages) | MEDIUM | MEDIUM | P2 |
| Prosody (crude phrasing proxy) | MEDIUM | MEDIUM | P2 |
| Teacher dashboard (multi-student) | MEDIUM | HIGH | P2 |
| Morphological error inference | LOW | HIGH | P3 |
| Prosody (full pitch/expression) | MEDIUM | HIGH | P3 |
| Student gamified playback | HIGH | HIGH | P3 |

**Priority key:**
- P1: Must have for launch -- core ORF functionality
- P2: Should have, add iteratively -- enhances teacher workflow and diagnostic depth
- P3: Nice to have, defer -- high cost or experimental, build after validation

## Competitor Feature Analysis

| Feature | DIBELS 8 | AIMSweb Plus | Read Naturally Live | ReadingQuest (Our Approach) |
|---------|----------|--------------|--------------------|-----------------------------|
| WCPM | Yes (manual scoring) | Yes (manual scoring) | Yes (manual + auto) | Automated via STT |
| Error classification | Examiner marks in real-time | Examiner marks miscues | Limited | Automated via alignment |
| Prosody | Not scored | Not scored | Not scored | Crude proxy initially, full later |
| Progress monitoring | Yes (DIBELS Data System) | Yes (built-in charting) | Yes (built-in) | Yes (localStorage, later cloud) |
| Benchmark norms | Yes (grade K-8) | Yes (national + local) | Yes (grade-level) | Hasbrouck-Tindal norms |
| Comprehension | Passage retell + Maze | Separate measures | Comprehension quiz | Out of scope (by design) |
| Passage library | Curated, licensed | Curated, licensed | 23 levels, curated | Any passage via OCR/manual input |
| Student-facing experience | None | None | Student reads along | Gamified playback with character |
| Word-level hesitation data | 3s binary only | Not captured | Not captured | Tiered thresholds (novel) |
| Self-correction tracking | Counted as correct, not tracked separately | Not tracked | Not tracked | Detected and tracked |
| Pricing | Subscription per student | Subscription per student | Subscription | Free/low-cost (API usage only) |
| Examiner training required | Yes (manual administration) | Yes (manual administration) | Moderate | Minimal (automated) |

## RTI Tier 2 Teacher Workflow Needs

Based on research, here is what RTI Tier 2 teachers actually need from an ORF tool:

1. **Biweekly data collection in under 5 minutes per student.** Tier 2 groups are 3-6 students meeting 3-5x/week. Teachers cannot spend 15 minutes per assessment.
2. **Trend lines showing rate of improvement (ROI).** The core RTI question is "Is intervention working?" This requires slope comparison against benchmark goals.
3. **Clear documentation for RTI team meetings.** Teachers must present data to justify continuing, modifying, or escalating intervention. One-page summaries with graphs.
4. **Error pattern visibility.** Not just "how many errors" but "what kind of errors" -- so teachers can adjust instruction (e.g., student struggles with multisyllabic words, target morphology).
5. **Minimal training overhead.** Paraprofessionals administer DIBELS/AIMSweb after under 1 hour of training. ReadingQuest should require zero scorer training since scoring is automated.

## Sources

- [DIBELS ORF Scoring Practice](https://dibels.uoregon.edu/resources/scoring-practice-oral-reading-fluency-orf)
- [DIBELS 8th Edition](https://dibels.amplify.com/assessment/dibels-eighth-edition)
- [aimswebPlus Reading (NCII)](https://charts.intensiveintervention.org/progressmonitoring/tool/?id=ff643b9d824b2b62)
- [aimswebPlus (Pearson)](https://www.pearsonassessments.com/en-us/Store/Professional-Assessments/Academic-Learning/aimswebPlus/p/100000519)
- [Deep Learning for ORF Assessment (arxiv)](https://arxiv.org/html/2405.19426)
- [Automated Prosody Classification for ORF (Frontiers)](https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2024.1440760/full)
- [Prosody and Construct Representativeness (SAGE)](https://journals.sagepub.com/doi/10.1177/02655322251348956)
- [RTI Tier 2 Progress Monitoring Best Practice (Reading Rockets)](https://www.readingrockets.org/topics/rti-and-mtss/articles/best-practice-rti-monitor-progress-tier-2-students)
- [IES Practice Guide: Progress Monitoring at Tier 2](https://ies.ed.gov/ncee/wwc/Docs/PracticeGuide/wwc_rrti_pg_rec04.pdf)
- [Meaningful Gamified Training of Reading Fluency (Frontiers)](https://www.frontiersin.org/journals/computer-science/articles/10.3389/fcomp.2022.968137/full)
- [Read Naturally Assessments in RTI](https://www.readnaturally.com/rti/rn-assessments-in-rti-model)
- [Shanahan on WCPM](https://www.shanahanonliteracy.com/blog/should-we-be-using-words-correct-per-minute)

---
*Feature research for: Oral Reading Fluency Assessment Tools*
*Researched: 2026-02-02*
