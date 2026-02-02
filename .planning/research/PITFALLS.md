# Pitfalls Research

**Domain:** ASR-based oral reading fluency assessment for struggling middle school readers
**Researched:** 2026-02-02
**Confidence:** MEDIUM-HIGH (well-documented research domain, but specific to Google Cloud STT v1 integration)

## Critical Pitfalls

### Pitfall 1: Treating ASR Confidence Scores as Mispronunciation Detectors

**What goes wrong:**
Developers use word-level confidence scores from Google Cloud STT as a direct proxy for pronunciation correctness. A low confidence score triggers a "mispronunciation" flag. In practice, confidence score distributions for correct and incorrect words overlap massively. Research (CHI 2025) shows classifiers built on confidence scores achieve "moderate success at best, failing to detect most errors or producing many false positives." The overlap means any threshold either misses most real errors (low recall) or flags correct words constantly (low precision).

**Why it happens:**
Confidence scores feel like they should measure correctness -- the name implies it. But ASR confidence reflects how well the audio matches the model's expected acoustic patterns, not whether the word was pronounced correctly. Quiet speech, background noise, child vocal characteristics, and dialectal variation all depress confidence without indicating errors.

**How to avoid:**
- Never use a single confidence threshold as a binary correct/incorrect classifier.
- Use confidence as one signal in a multi-feature scoring system: combine confidence with forced-alignment duration, expected vs. actual word match, and context.
- For substitution detection, compare the ASR transcript against the expected passage text. A substitution is when STT returns a different word, not when confidence is low on the correct word.
- For morphological error detection (e.g., "running" read as "runnin"), accept this is LOW accuracy and communicate uncertainty explicitly to teachers.
- Validate against human-scored samples before deploying. Target: measure correlation with human judgment, not just threshold accuracy.

**Warning signs:**
- False positive rate for "mispronunciation" exceeds 30% in testing.
- Teachers report students being flagged for errors they did not make.
- Confidence scores cluster high (0.85-0.99) for both correct and incorrect words.

**Phase to address:**
Phase 1 (core alignment/scoring). Establish the confidence-is-a-signal-not-a-verdict principle from the start. Build the multi-signal scoring architecture before any error classification logic.

---

### Pitfall 2: Dialect and Accent Bias Producing Systematically Unfair Scores

**What goes wrong:**
Commercial ASR systems show WER of 0.35 for Black speakers vs. 0.19 for white speakers (Koenecke et al., 2020). AAE morpho-syntactic features like habitual "be" are disproportionately error-prone. For RTI Tier 2 middle schoolers -- a population likely to include significant dialectal diversity -- this means the tool systematically scores some students as less fluent based on dialect, not reading ability. This is not a minor accuracy issue; it is an equity and validity problem that could harm the students the tool is supposed to help.

**Why it happens:**
Google Cloud STT is trained predominantly on standard American English adult speech. It interprets dialectal pronunciations and grammar as errors. The system has no concept of "correct for this dialect." When the tool then flags these as omissions, substitutions, or mispronunciations, it compounds ASR bias into instructional decisions.

**How to avoid:**
- Build a dialect-aware scoring layer that does not treat dialectal variants as errors. Maintain a configurable allowlist of known dialectal patterns (e.g., consonant cluster reduction, habitual "be," copula deletion).
- For substitution detection, check if the ASR output and expected text are dialectal variants of each other before flagging.
- Report accuracy metrics disaggregated by demographic subgroups during validation.
- Include a teacher override / review mechanism for flagged errors so the tool never makes final instructional decisions autonomously.
- Be explicit in documentation: "This tool does not assess dialect correctness. Dialectal pronunciations are not reading errors."

**Warning signs:**
- Disproportionate error rates across student subgroups during pilot testing.
- Teachers from diverse schools report the tool "doesn't work for my students."
- WCPM scores for dialectal speakers are systematically lower than human-scored WCPM.

**Phase to address:**
Phase 2 (error classification). Must be designed into the error taxonomy from the start, not bolted on later. Needs explicit test cases with dialectal speech samples.

---

### Pitfall 3: Google Cloud STT Word Timestamps Are Not Precise Enough for Fine-Grained Timing

**What goes wrong:**
Developers rely on Google Cloud STT word-level timestamps for sub-second timing measurements like word onset delay, inter-word pauses, and hesitation detection. STT timestamps have granularity and accuracy limitations -- they represent the model's best estimate of word boundaries, not precise acoustic onset/offset. Research shows forced alignment phone boundaries are typically within 10-25ms of human placement for adult speech, but degrade for child speech. Google's STT timestamps are likely coarser than dedicated forced aligners. Building pause detection on 100ms+ timing uncertainty produces unreliable results.

**Why it happens:**
Word timestamps from the API look precise (reported in fractional seconds). Developers assume this precision equals accuracy. For adult read-aloud speech this may be acceptable for WCPM calculation (which only needs total time and word count), but for per-word timing analysis the errors compound.

**How to avoid:**
- Use STT timestamps for coarse measures only: total reading time, WCPM, and pauses longer than 2-3 seconds (where timestamp error is negligible relative to pause duration).
- For fine-grained pause detection (under 1 second), validate timestamp accuracy against manually annotated samples before relying on it.
- Define minimum detectable pause duration based on empirical testing -- likely 500ms+ is reliable, under 250ms is noise.
- For word onset delay, use the gap between consecutive word end/start timestamps, but report it as an approximate measure with stated uncertainty.
- Do NOT attempt phoneme-level timing from word-level timestamps.

**Warning signs:**
- Pause counts vary wildly between identical audio runs (non-determinism in STT).
- Short pauses (under 500ms) show no correlation with human-perceived hesitations.
- Word onset delay measurements don't correlate with human WCPM ratings.

**Phase to address:**
Phase 1 (timestamp extraction and alignment). Establish timing accuracy bounds empirically before building features on top of them.

---

### Pitfall 4: Child Speech WER Degrades All Downstream Measures Simultaneously

**What goes wrong:**
Google Cloud STT has no child-specific model. Research shows child speech WER ranges from 0.30 (best case, controlled environment) to 0.78 (classroom). For struggling readers who speak quietly, hesitate, and self-correct, WER will be even higher. Every downstream measure -- WCPM, omissions, substitutions, prosody -- is built on the transcript. A 30% WER means roughly 30% of word-level signals are corrupted. Developers build and test features on adult or fluent-reader audio, then discover the system falls apart for the actual target population.

**Why it happens:**
Child speech has higher pitch, more variable articulation, shorter vocal tracts, and more disfluencies than adult speech. Struggling readers compound this: quiet speech, incomplete words, long hesitations, and self-corrections all confuse the ASR. The system was trained on adults reading fluently -- the exact opposite of the target use case.

**How to avoid:**
- Test with actual target population audio from day one. Never validate exclusively on adult or fluent-reader speech.
- Use speech adaptation in Google Cloud STT: provide the passage text as a phrase set boost to improve recognition of expected words.
- Use `latest_long` model (already planned) -- it handles longer audio better.
- Set realistic accuracy expectations per measure and communicate them:
  - WCPM: MEDIUM accuracy (errors roughly cancel between false insertions and deletions)
  - Omission detection: MEDIUM accuracy (real omissions are indistinguishable from ASR deletions)
  - Substitution detection: LOW-MEDIUM accuracy (ASR substitution errors look identical to reader substitutions)
  - Prosody: LOW accuracy (requires accurate timing and word boundaries)
  - Self-correction detection: LOW accuracy (ASR may not transcribe the incorrect attempt at all)
- Build a "confidence in the assessment" meta-score that degrades gracefully when audio quality is poor.

**Warning signs:**
- WER on target population audio exceeds 25%.
- Omission counts are much higher than human-scored counts (ASR deletions being counted as omissions).
- Teachers report scores that don't match what they hear.

**Phase to address:**
Phase 0 (STT integration). Measure WER on target population audio before building any fluency features. This is a go/no-go gate.

---

### Pitfall 5: Conflating ASR Errors with Reading Errors in the Error Taxonomy

**What goes wrong:**
The system cannot distinguish between "the student said the wrong word" (a reading error) and "the ASR heard the wrong word" (a transcription error). Both appear as mismatches between expected text and transcript. Without this distinction, every reported metric conflates system error with student error. Omission counts include ASR deletion errors. Substitution counts include ASR substitution errors. The tool reports false reading errors and misses real ones.

**Why it happens:**
The alignment algorithm treats the ASR transcript as ground truth. If the ASR says the student said "house" instead of "horse," the system flags a substitution. But maybe the student said "horse" correctly and the ASR misheard. There is no way to distinguish these cases from the transcript alone.

**How to avoid:**
- Never report individual word-level errors as definitive. Report them as "possible errors" with confidence indicators.
- Use confidence scores to weight error reports: a substitution where the ASR confidence on the substituted word is also low should be flagged as uncertain.
- Aggregate to passage-level metrics where individual errors average out. WCPM is more robust than individual error counts because ASR insertions and deletions partially cancel.
- Design the teacher-facing UI to show flagged words as "review these" rather than "these are wrong."
- Track false error rates during validation: compare system-detected errors against human-scored errors on the same passages.

**Warning signs:**
- System reports more total errors than a human scorer finds.
- Error counts don't decrease as students improve (because ASR error rate is constant).
- Teachers lose trust in individual error flags.

**Phase to address:**
Phase 2 (error classification). The error taxonomy must include an "uncertain" category from the start. UI must be designed around uncertainty.

---

### Pitfall 6: Prosody Detection is Largely Aspirational with STT-Only Architecture

**What goes wrong:**
Developers plan prosody scoring (intonation, stress, expression) using STT output. But STT returns text and timestamps -- it discards the acoustic features that encode prosody. You cannot recover pitch contours, stress patterns, or intonation from a transcript. Research confirms: "Oral reading fluency assessments do not usually measure prosody... assessing prosody takes significantly longer than ORF but does not improve the accuracy of the fluency measure."

**Why it happens:**
Prosody is an important component of fluency (accuracy, automaticity, prosody). Product requirements include it because the reading science says it matters. But STT is the wrong tool for measuring it. Prosody requires acoustic analysis of the raw audio waveform, not transcription.

**How to avoid:**
- Separate prosody from the STT pipeline entirely. If prosody scoring is needed, it requires direct audio analysis (pitch tracking, energy contours, speaking rate variation) -- a completely different technical approach.
- For MVP, do not attempt prosody scoring. Focus on what STT can measure: WCPM, pause patterns, and word accuracy.
- If prosody is a hard requirement, scope it as a separate milestone that processes the raw audio alongside (not through) STT.
- Use pause patterns from STT timestamps as a rough proxy for one aspect of prosody (phrasing), but do not call it "prosody scoring."

**Warning signs:**
- Prosody feature is on the roadmap but no audio analysis library is in the stack.
- Team discusses prosody scoring using only STT output fields.
- Prosody score correlates poorly with human prosody ratings.

**Phase to address:**
Phase 3 or later (if at all). Defer prosody to a dedicated audio-analysis phase after core STT-based measures are validated. Clearly label it as requiring a different technical approach.

---

### Pitfall 7: Self-Correction Detection Requires Temporal Pattern Recognition the STT May Not Support

**What goes wrong:**
Self-correction (student says wrong word, then corrects) is an important fluency signal -- it shows monitoring. But STT may transcribe only the final correct word, only the incorrect attempt, both words, or neither clearly. The self-correction pattern (word-pause-word or word-word) requires detecting repeated/revised word sequences in the transcript with specific timing patterns. With unreliable timestamps and possible ASR errors on the incorrect attempt, detection accuracy is very low.

**Why it happens:**
Self-corrections are acoustically messy: partial words, overlapping speech, quick revisions. ASR is optimized to produce the most likely clean transcript, not to preserve disfluency patterns. Google Cloud STT may "clean up" self-corrections into a single word.

**How to avoid:**
- Treat self-correction detection as LOW confidence from the start.
- Look for patterns where STT returns two words where one was expected, or where a word has very low confidence followed by the correct word with higher confidence.
- Do not count self-corrections as errors -- if anything, they indicate good reading monitoring.
- Consider this a "bonus signal when detected" rather than a reliable measure.
- Enable `enable_automatic_punctuation` and check if STT inserts any disfluency markers, but do not rely on this.

**Warning signs:**
- Self-correction detection rate is near zero in testing (STT is cleaning them up).
- False self-correction detections on fluent reading (STT artifacts being misinterpreted).

**Phase to address:**
Phase 2 or 3. Build it, measure it, and be transparent about its low reliability. It is a nice-to-have, not a core measure.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hard-coded confidence thresholds | Quick error classification | Thresholds are passage-dependent, grade-dependent, and audio-quality-dependent; constant tuning | Never -- use configurable thresholds from day one |
| Testing only on clean adult audio | Fast development cycle | Features break on actual target population | Only for initial API integration smoke tests |
| Treating STT transcript as ground truth | Simpler scoring logic | Conflates ASR errors with reading errors permanently | Never for error-level reporting; acceptable for coarse WCPM |
| Skipping speech adaptation (phrase hints) | Fewer API parameters to manage | 10-30% worse WER on passage-specific vocabulary | Never -- phrase hints are low-effort, high-impact |
| Single global pause threshold | Simple pause detection | Ignores that pause significance varies by passage difficulty, reader, and position in text | MVP only, replace with adaptive thresholds |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Google Cloud STT | Not sending passage text as speech adaptation phrases | Always include the expected passage text as phrase hints to boost recognition accuracy |
| Google Cloud STT | Using `default` model instead of `latest_long` | Use `latest_long` for read-aloud passages (longer utterances, better for continuous speech) |
| Google Cloud STT | Not requesting word-level timestamps and confidence | Always set `enable_word_time_offsets: true` and `enable_word_confidence: true` in config |
| Google Cloud STT | Sending pre-processed/noise-reduced audio | Google explicitly advises against noise reduction before sending -- their models handle noise internally |
| Google Cloud STT | Assuming deterministic results | Same audio can produce slightly different transcripts/timestamps across calls; cache results |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Synchronous STT calls blocking UI | Teacher waits 10-30s for results after student reads | Use async recognition for passages over 1 minute; show progress indicator | Passages over 60 seconds |
| Storing raw audio without lifecycle policy | Storage costs grow linearly, FERPA/privacy concerns | Define retention policy, auto-delete after processing unless consent for research use | 1000+ recordings |
| Re-processing audio for each analysis feature | Redundant API calls, increased latency and cost | Process once, store structured results (transcript, timestamps, confidence), derive all features from stored results | Any scale |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing student audio without FERPA compliance | Legal liability, privacy violation | Encrypt at rest, define retention policy, get parental consent, minimize storage duration |
| Sending student identifiers with audio to Google Cloud | PII exposed to third party | Strip all student identifiers before API calls; associate results by internal session ID only |
| Displaying individual student error details without access controls | Unauthorized access to student performance data | Role-based access; only assigned teachers see individual student data |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing raw error counts without context | Teachers over-interpret noise as signal; lose trust when counts seem wrong | Show ranges ("approximately 3-5 errors"), highlight only high-confidence flags |
| Presenting WCPM as the sole fluency measure | Teachers focus on speed, students rush, comprehension drops | Show WCPM alongside accuracy rate and qualitative indicators; note that speed beyond benchmarks is not better |
| Displaying "mispronounced words" list without uncertainty | Teachers drill students on words the ASR misheard, not words the student actually missed | Label as "words to review" with confidence indicator; never say "mispronounced" definitively |
| No teacher override mechanism | System errors become permanent student records | Allow teachers to dismiss/confirm flagged errors; store teacher corrections to improve system |
| Showing prosody scores from STT-only analysis | Teachers make instructional decisions based on unreliable data | Either do prosody properly (audio analysis) or don't show it; no middle ground |

## "Looks Done But Isn't" Checklist

- [ ] **WCPM calculation:** Often missing handling of partial words, self-corrections, and repeated words -- verify scoring rules match DIBELS/Acadience conventions
- [ ] **Omission detection:** Often conflates ASR deletion errors with actual student omissions -- verify against human-scored samples with known omission counts
- [ ] **Passage timing:** Often uses first/last word timestamps instead of actual student start/stop -- verify timing includes pre-first-word hesitation
- [ ] **Error classification:** Often tested only on fluent readers -- verify on struggling readers with hesitations, repetitions, and dialect features
- [ ] **Speech adaptation:** Often configured once and forgotten -- verify phrase hints are updated per passage and include passage-specific vocabulary
- [ ] **Confidence reporting:** Often shows teacher-facing accuracy percentage without stating what it means -- verify that uncertainty communication is clear and actionable

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Confidence thresholds hard-coded | LOW | Extract to configuration; re-tune with target population data |
| Dialect bias in scoring | MEDIUM | Add dialect-aware layer; requires dialectal speech samples for testing |
| Prosody built on STT output | HIGH | Must rebuild prosody on audio analysis pipeline; STT-based prosody is not recoverable |
| No uncertainty in teacher UI | MEDIUM | Redesign error display; add confidence indicators; requires UI changes throughout |
| Tested only on adult/fluent speech | HIGH | Discovered late = all feature accuracy claims invalid; must re-validate everything |
| ASR errors conflated with reading errors | MEDIUM | Add uncertainty layer to error taxonomy; update scoring logic and UI |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Child speech WER degradation | Phase 0 (STT integration) | Measure WER on target population audio; establish go/no-go threshold |
| Confidence score misuse | Phase 1 (scoring architecture) | Confidence used as signal weight, not binary classifier; validate correlation with human judgment |
| Timestamp precision limits | Phase 1 (timing features) | Empirically measure timestamp accuracy on test audio; define minimum reliable pause duration |
| Dialect bias | Phase 2 (error classification) | Test error rates disaggregated by dialect; include dialectal allowlist |
| ASR/reading error conflation | Phase 2 (error taxonomy) | Every error flag has confidence indicator; compare system vs. human error counts |
| Prosody from STT only | Phase 3+ (if needed) | Prosody requires audio analysis pipeline, not STT; defer or scope separately |
| Self-correction detection | Phase 2-3 (advanced features) | Measure detection rate; label as LOW confidence; treat as bonus signal |
| Teacher UI shows false certainty | Phase 2 (teacher dashboard) | All error reports include uncertainty language; teacher override exists |

## Sources

- [Evaluating ASR Confidence Scores for Automated Error Detection (CHI 2025)](https://arxiv.org/abs/2503.15124) -- confidence scores unreliable for error classification
- [Racial Disparities in Automated Speech Recognition (PNAS 2020)](https://pubmed.ncbi.nlm.nih.gov/32205437/) -- WER 0.35 Black vs 0.19 white speakers
- [Bias in ASR: The Case of African American Language (Applied Linguistics 2023)](https://academic.oup.com/applij/article/44/4/613/6901317) -- habitual "be" and dialectal feature errors
- [How Alignment Error Affects Pronunciation Scoring in Children's Speech (PMC 2024)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11977302/) -- forced alignment degrades on child speech
- [Improving ASR for Children's Reading Assessment (Interspeech 2025)](https://www.isca-archive.org/interspeech_2025/vidal25_interspeech.pdf) -- fine-tuning results inconclusive
- [Causal Analysis of ASR Errors for Children (2025)](https://arxiv.org/html/2502.08587) -- age and physiology are top error factors
- [Voice Assistant Technology Underperforms on Children's Speech (JASA 2025)](https://pubs.aip.org/asa/jel/article/5/3/035201/3338215/) -- commercial ASR still struggles
- [Transfer Learning from Adult to Children for Speech Recognition (PMC 2020)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7199459/) -- child speech WER benchmarks
- [Challenges and Feasibility of ASR in Classrooms (EDM 2022)](https://educationaldatamining.org/edm2022/proceedings/2022.EDM-long-papers.26/index.html) -- classroom WER 0.78
- [Google Cloud STT Best Practices](https://docs.google.com/speech-to-text/docs/v1/best-practices) -- speech adaptation, model selection, noise handling
- [Google Cloud STT Accuracy Guide](https://cloud.google.com/speech-to-text/docs/speech-accuracy) -- tuning recommendations

---
*Pitfalls research for: ASR-based oral reading fluency assessment*
*Researched: 2026-02-02*
