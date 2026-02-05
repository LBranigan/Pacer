# Pitfalls Research

**Domain:** ASR-based oral reading fluency assessment for struggling middle school readers
**Researched:** 2026-02-02 (base), 2026-02-05 (Reverb integration update)
**Confidence:** MEDIUM-HIGH (well-documented research domain, specific to Google Cloud STT v1 and now Reverb integration)

---

## v1.3 Milestone: Reverb ASR Integration Pitfalls

> **Context:** This section covers pitfalls specific to adding Reverb ASR local backend and cross-vendor alignment. ReadingQuest currently has no backend -- v1.3 introduces first backend service (FastAPI/Docker), first GPU dependency, and first cross-vendor ASR comparison.
>
> **Prior failure reference:** The abandoned `disfluency-detector.js` demonstrated that cross-vendor timestamp drift (Google latest_long vs default) with naive local matching (50ms windows) caused 100% false positive rate when drift exceeded window size.

### Pitfall V1.3-1: Cross-Vendor Timestamp Drift Causing False Positives (CRITICAL)

**What goes wrong:**
When comparing transcripts from different ASR systems (Google STT vs Reverb, or even Reverb v=1.0 vs v=0.0), timestamp drift between systems causes alignment algorithms to misidentify words. The disfluency-detector.js failure is the canonical example: 60ms global drift between Google's latest_long and default models caused 100% of words to be flagged as disfluencies because naive local matching (50ms windows) couldn't absorb the drift.

**Why it happens:**
- Different models have different acoustic front-ends and CTC decoders
- Cross-vendor systems (Google cloud vs local Reverb) have no shared clock
- Even same-vendor models can drift when using different architectures (Conformer vs CTC)
- Research shows [timestamp prediction errors range from 22 to 127 milliseconds](https://arxiv.org/html/2505.15646v1) across different systems

**How to avoid:**
1. Use **global alignment** (Needleman-Wunsch) instead of local matching windows
2. For Reverb v=1.0 vs v=0.0 comparison: same model, same encoder, same CTC clock = minimal drift (10-20ms expected)
3. Normalize timestamps BEFORE alignment (convert "1.5s" strings to milliseconds consistently)
4. Implement drift estimation: compute median offset across aligned word pairs, then compensate

**Warning signs:**
- Alignment flagging >30% of words as mismatches between same-model passes
- Systematic offset visible in aligned word pairs (all v=1.0 words 50ms earlier than v=0.0)
- "Disfluency" count equals total word count (the abandoned detector's failure mode)

**Phase to address:**
Phase 2 (Needleman-Wunsch Alignment) - Build alignment with drift tolerance from day one

---

### Pitfall V1.3-2: Docker GPU Access Silent Failure (CRITICAL)

**What goes wrong:**
Container starts successfully, model loads, but inference runs on CPU instead of GPU. No error is thrown - just 10-20x slower inference. With 8GB VRAM, this means 1-minute audio takes 2-3 minutes instead of 12-20 seconds.

**Why it happens:**
- Missing `--gpus` flag in docker run command
- NVIDIA Container Toolkit not installed or not configured
- CUDA version mismatch between base image and host drivers
- WSL2-specific: GPU passthrough requires additional configuration
- [Docker GPU support on Windows requires WSL2 backend specifically](https://docs.docker.com/desktop/features/gpu/)

**How to avoid:**
1. Add explicit GPU check at startup:
   ```python
   import torch
   if not torch.cuda.is_available():
       raise RuntimeError("GPU not available - check Docker --gpus flag and NVIDIA Container Toolkit")
   print(f"Using GPU: {torch.cuda.get_device_name(0)}")
   ```
2. Include `--gpus all` in docker-compose.yml and startup scripts
3. Pin CUDA version in Dockerfile to match host driver
4. Test inference speed immediately after deployment (should be >3x realtime)

**Warning signs:**
- Inference taking >0.5x realtime (1 min audio > 2 min processing)
- `torch.cuda.is_available()` returns False inside container
- nvidia-smi shows 0% GPU utilization during transcription

**Phase to address:**
Phase 1 (Backend Setup) - GPU verification must be first health check

---

### Pitfall V1.3-3: VRAM Exhaustion on Long Audio (CRITICAL)

**What goes wrong:**
Model loads fine, short clips transcribe successfully, but longer recordings (>3-5 minutes) cause CUDA out-of-memory errors. With 8GB VRAM limit, this is a hard constraint.

**Why it happens:**
- ASR models accumulate hidden states proportional to audio length
- CTC decoder memory grows with sequence length
- PyTorch memory allocator fragments VRAM over multiple inferences
- [CUDA OOM likely means the GPU is too small for the job](https://www.runpod.io/articles/guides/cloud-gpu-mistakes-to-avoid)

**How to avoid:**
1. Implement chunked processing: split audio into 60-90 second segments with 1-2 second overlap
2. Set `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` to reduce fragmentation
3. Explicitly free tensors and call `torch.cuda.empty_cache()` between chunks
4. Add request timeout (60s) to prevent single long request from blocking service
5. Monitor with nvidia-smi during load testing

**Warning signs:**
- First few transcriptions succeed, then random failures
- `CUDA out of memory` errors in logs
- Service becoming unresponsive after processing long files

**Phase to address:**
Phase 1 (Backend Setup) - Implement chunking before first real deployment

---

### Pitfall V1.3-4: CORS Blocking Browser-to-Backend Communication (MODERATE)

**What goes wrong:**
FastAPI server running, health check passes via curl, but browser JavaScript gets `CORS policy` errors. The frontend shows "Reverb offline" even though the service is running.

**Why it happens:**
- [CORS errors are common when frontend and backend run on different origins](https://fastapi.tiangolo.com/tutorial/cors/)
- Default CORSMiddleware is restrictive - must explicitly allow origins
- `allow_origins=["*"]` doesn't work with credentials
- Docker networking adds another origin layer (localhost:8765 inside container vs host port mapping)

**How to avoid:**
1. Configure explicit CORS in FastAPI:
   ```python
   app.add_middleware(
       CORSMiddleware,
       allow_origins=["http://localhost:8000", "http://127.0.0.1:8000", "file://"],
       allow_methods=["GET", "POST"],
       allow_headers=["Content-Type"],
   )
   ```
2. For development, use `allow_origins=["*"]` BUT set `allow_credentials=False`
3. Test with actual browser (not curl) - CORS is browser-enforced
4. Check browser DevTools Network tab for preflight OPTIONS failures

**Warning signs:**
- curl works, browser doesn't
- `Access-Control-Allow-Origin` errors in browser console
- Health check returns "offline" despite service running

**Phase to address:**
Phase 1 (Backend Setup) - Test browser connectivity, not just curl

---

### Pitfall V1.3-5: Needleman-Wunsch Gap Penalty Misconfiguration (MODERATE)

**What goes wrong:**
Alignment produces implausible results: short words aligned to long sequences, or systematic insertion/deletion bias. Gap penalties that work for DNA sequences don't work for word alignment.

**Why it happens:**
- Default gap penalties from bioinformatics tutorials are calibrated for DNA (4-letter alphabet)
- Word alignment needs different penalties: insertions (disfluencies) are common, deletions (omissions) are meaningful
- [Multiple optimal pathways exist](https://en.wikipedia.org/wiki/Needleman%E2%80%93Wunsch_algorithm) - wrong tiebreaker selection causes inconsistent alignments
- Scoring substitution similarity (phonetic distance) vs binary match/mismatch matters

**How to avoid:**
1. Use asymmetric gap penalties: `gap_insert = -1` (disfluencies cheap), `gap_delete = -2` (omissions costly)
2. Use phonetic similarity for substitution scores (not binary)
3. Implement traceback tiebreaker: prefer diagonal (substitution) over gaps
4. Test with known-good alignments: "the the cat" vs "the cat" should produce 1 insertion
5. Log alignment matrix for debugging (at least for development)

**Warning signs:**
- Alignment length >> max(len(verbatim), len(clean))
- All differences classified as one type (all insertions, no substitutions)
- Same input producing different alignments on repeated runs

**Phase to address:**
Phase 2 (Needleman-Wunsch Alignment) - Tune penalties with real ORF data

---

### Pitfall V1.3-6: CTM Format Parsing Assumptions (MODERATE)

**What goes wrong:**
Parser assumes 5-field CTM format but Reverb outputs 6 fields. Or assumes confidence is always present but Phase 0 validation shows `confidence=0.00` (default, not real).

**Why it happens:**
- CTM format has variations: `<word> <channel> <start> <duration> <confidence> [<alternative>]`
- Documentation says 5 fields, actual output may have 6
- `0.00` confidence looks valid but means "no real score available"

**How to avoid:**
1. Parse by field count, not fixed positions
2. Treat confidence=0.00 as "unknown" (use 0.9 default as proposal suggests)
3. Validate with actual Reverb output from Phase 0:
   ```
   <word> <channel> <start> <duration> 0.00 <sixth_field>
   ```

**Warning signs:**
- IndexError during CTM parsing
- All words showing identical confidence scores
- Word text appearing in wrong field

**Phase to address:**
Phase 1 (Backend Setup) - Validate CTM parsing against real output

---

### Pitfall V1.3-7: Vocabulary Normalization Asymmetry (MODERATE)

**What goes wrong:**
v=0.0 (clean) normalizes "gonna" to "going to" but v=1.0 (verbatim) preserves "gonna". Alignment marks this as substitution instead of match.

**Why it happens:**
- verbatimicity=0.0 is explicitly designed to "clean up" disfluencies AND informal speech
- This is by design in Reverb, not a bug
- Phase 0 validation confirmed: v=0.0 may normalize vocabulary

**How to avoid:**
1. Normalize both sides before alignment: `gonna` -> `gonna`, `going to` -> `gonna`
2. Build normalization map for common informal/formal pairs
3. Compare on lemmatized forms when detecting disfluencies

**Warning signs:**
- High substitution rate between v=1.0 and v=0.0 for non-disfluent speech
- Formal words appearing in clean that weren't in verbatim
- WER unexpectedly high between same-audio transcripts

**Phase to address:**
Phase 2 (Needleman-Wunsch Alignment) - Normalize before comparing

---

### Pitfall V1.3-8: Cross-Vendor Hallucination Detection False Positives (MINOR)

**What goes wrong:**
Cross-vendor comparison (Google vs Reverb) flags legitimate differences as "hallucinations" - words that exist in both transcripts but with different surface forms.

**Why it happens:**
- Different models have different vocabularies ("gonna" vs "going to")
- Different models handle named entities differently ("iPhone" vs "iphone")
- [Hallucinations defined as semantically disconnected outputs](https://arxiv.org/html/2502.12414) - need semantic comparison, not string matching
- Research shows [WER/CER often fail to reflect quality in critical contexts](https://arxiv.org/html/2502.12414)

**How to avoid:**
1. Normalize case and common contractions before comparison
2. Use semantic similarity (embedding distance) not just string matching
3. Flag only words that appear in one transcript with NO corresponding word in the other
4. Trust same-model disagreement (verbatim vs clean) more than cross-vendor disagreement

**Warning signs:**
- "Hallucination" count correlates with vocabulary style differences
- Common words like "going" flagged as hallucinations
- Same audio producing dramatically different "hallucination" counts

**Phase to address:**
Phase 3 (Cross-Vendor Validation) - Build semantic comparison, not string matching

---

## V1.3 Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `allow_origins=["*"]` | No CORS debugging | Security risk in production | Development only |
| Hardcoded gap penalties | Faster implementation | Poor alignment on edge cases | Never - parameterize from start |
| No chunking for long audio | Simpler code | OOM on real classroom recordings | Never - 8GB VRAM is hard limit |
| Skip GPU verification | Service starts faster | Silent 10x slowdown | Never - must fail fast |
| String timestamps ("1.5s") | Matches Google format | Conversion bugs in alignment | Convert to ms at API boundary |

---

## V1.3 Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Docker GPU | Assuming GPU access without `--gpus` | Explicit flag + startup verification |
| FastAPI CORS | Testing with curl instead of browser | Browser-based smoke test mandatory |
| Reverb CTM | Assuming 5-field format | Parse dynamically by field count |
| WSL2 networking | localhost inside container | Host network mode or explicit port mapping |
| PyTorch VRAM | Trusting automatic garbage collection | Explicit `empty_cache()` between requests |

---

## V1.3 Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| No audio chunking | OOM on long files | Chunk at 60-90s with overlap | >3-5 min audio |
| CPU fallback | 2-3 min for 1 min audio | GPU check at startup | Any production use |
| Synchronous transcription | UI blocks during inference | Async with progress callback | Any file >10s |
| Full model reload per request | 5-10s latency per call | Load once at startup | Any multi-request scenario |
| No request timeout | One bad request blocks all | 60s timeout per request | Concurrent users |

---

## V1.3 "Looks Done But Isn't" Checklist

- [ ] **Backend health check:** Passes from browser, not just curl (CORS)
- [ ] **GPU inference:** Verified with nvidia-smi during actual transcription (not just torch.cuda.is_available)
- [ ] **Long audio:** Tested with 5+ minute recording without OOM
- [ ] **CTM parsing:** Validated against real Reverb output (6 fields, confidence=0.00)
- [ ] **Alignment correctness:** Tested with known inputs ("the the cat" vs "the cat")
- [ ] **Vocabulary normalization:** Checked that "gonna" aligns to "gonna" not flagged as error
- [ ] **Error handling:** Service recovers after OOM without restart

---

## V1.3 Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Timestamp drift false positives | MEDIUM | Implement global alignment, reprocess existing data |
| GPU silent fallback | LOW | Add startup check, redeploy |
| VRAM exhaustion | MEDIUM | Implement chunking, handle existing long recordings specially |
| CORS blocking | LOW | Update middleware config, no data loss |
| Wrong gap penalties | MEDIUM | Retune parameters, reprocess alignments |

---

## V1.3 Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| V1.3-1: Cross-vendor timestamp drift | Phase 2: NW Alignment | Global alignment absorbs 100ms+ drift |
| V1.3-2: Docker GPU silent failure | Phase 1: Backend Setup | Startup GPU check, nvidia-smi during health check |
| V1.3-3: VRAM exhaustion | Phase 1: Backend Setup | Process 5-min audio without OOM |
| V1.3-4: CORS blocking | Phase 1: Backend Setup | Browser fetch to /health succeeds |
| V1.3-5: NW gap penalty misconfiguration | Phase 2: NW Alignment | Known-good test cases pass |
| V1.3-6: CTM format parsing | Phase 1: Backend Setup | Parse real Reverb output correctly |
| V1.3-7: Vocabulary normalization | Phase 2: NW Alignment | "gonna" aligns to "gonna" between passes |
| V1.3-8: Hallucination false positives | Phase 3: Cross-Vendor Validation | Semantic similarity, not string matching |

---

## Project-Specific Context: The Abandoned disfluency-detector.js

This project has direct experience with cross-vendor alignment failure. Key lessons:

1. **Local matching windows (50ms) cannot absorb global drift (60ms+)**
   - Naive approach: find matching word within +-50ms window
   - Failure mode: 100% of words flagged when drift exceeds window

2. **Same model, different passes is fundamentally different from cross-vendor**
   - Google latest_long vs default: different models, different encoders, 500ms+ drift possible
   - Reverb v=1.0 vs v=0.0: same model, same encoder, same CTC clock, 10-20ms drift expected
   - This is why Reverb integration is more tractable

3. **Needleman-Wunsch global alignment is the correct approach**
   - Absorbs global drift by finding optimal alignment across entire sequence
   - Validated in Phase 0 as the right technique

---

## V1.3 Sources

**Docker/GPU Issues:**
- [Docker GPU Documentation](https://docs.docker.com/desktop/features/gpu/)
- [GPU Container Pitfalls Discussion](https://forums.docker.com/t/applications-not-using-gpu-inside-the-container/140376)
- [VRAM Management Strategies](https://localai.io/advanced/vram-management/)

**CORS Configuration:**
- [FastAPI CORS Documentation](https://fastapi.tiangolo.com/tutorial/cors/)
- [CORS in Docker Environments](https://github.com/fastapi/fastapi/issues/5086)

**Sequence Alignment:**
- [Needleman-Wunsch Algorithm](https://en.wikipedia.org/wiki/Needleman%E2%80%93Wunsch_algorithm)
- [Time Complexity Analysis](https://bio.libretexts.org/Bookshelves/Computational_Biology/Book:_Computational_Biology_-_Genomes_Networks_and_Evolution_(Kellis_et_al.)/02:_Sequence_Alignment_and_Dynamic_Programming/2.05:_The_Needleman-Wunsch_Algorithm)

**ASR Timestamp Issues:**
- [Cross-vendor ASR Comparison Research](https://arxiv.org/html/2406.19363v1)
- [Timestamp Alignment Drift Study](https://arxiv.org/html/2505.15646v1)
- [Reverb ASR Technical Paper](https://arxiv.org/html/2410.03930)

**Hallucination Detection:**
- [ASR Hallucination Research](https://arxiv.org/html/2502.12414)
- [Hallucination Benchmark](https://www.arxiv.org/pdf/2510.16567)

---

## Critical Pitfalls (Base System - v1.0-v1.2)

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
*Researched: 2026-02-02 (base), 2026-02-05 (v1.3 Reverb integration)*
