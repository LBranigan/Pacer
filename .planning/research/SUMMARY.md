# Project Research Summary: v1.3 Kitchen Sink Ensemble

**Project:** ReadingQuest - Oral Reading Fluency Assessment Tool
**Domain:** ASR-based reading assessment for RTI Tier 2 struggling middle school readers
**Milestone:** v1.3 Kitchen Sink Ensemble (Reverb ASR Integration)
**Researched:** 2026-02-05
**Confidence:** MEDIUM-HIGH

## Executive Summary

The v1.3 milestone adds Reverb ASR as a local GPU backend to enable model-level disfluency detection and cross-vendor validation. The key innovation is using Reverb's verbatimicity parameter (v=1.0 verbatim vs v=0.0 clean) with Needleman-Wunsch global alignment to detect fillers, repetitions, and false starts - disfluencies that the existing Google STT ensemble cannot reliably identify.

**Critical architectural change:** ReadingQuest has no backend service currently. v1.3 introduces the first backend (FastAPI/Docker/GPU), first cross-vendor ASR comparison, and a new algorithm (Needleman-Wunsch sequence alignment) to replace the abandoned disfluency-detector.js. The abandoned detector's failure - 100% false positives from timestamp drift between Google's latest_long and default models - directly informs this design: global alignment with text-based matching works where local timestamp windows failed.

**Key risk:** Cross-vendor timestamp drift between Google (cloud) and Reverb (local) can cause false alignment positives if naive local matching is used. Mitigation is built into the design: Needleman-Wunsch absorbs drift, and the critical disfluency detection happens within Reverb (v=1.0 vs v=0.0) using the same model encoder, eliminating cross-vendor drift for the core feature. Google STT serves as validation, not a primary disfluency signal.

## Key Findings

### Recommended Stack (v1.3 Additions)

From STACK.md, v1.3 introduces:

**Core technologies:**
- **Reverb ASR (rev-reverb 0.1.0)**: Speech recognition with verbatimicity parameter - enables model-level disfluency capture that post-hoc STT analysis cannot achieve. Trained on 200k hours, provides both verbatim (v=1.0) and clean (v=0.0) transcripts.
- **FastAPI (0.115.0+)**: REST API framework for local backend - industry standard with native async, Pydantic v2 validation, automatic OpenAPI docs. Direct uvicorn serving is sufficient for single-user deployment.
- **Docker + NVIDIA Container Toolkit**: Reproducible GPU deployment - critical for 8GB VRAM model that runs 5x faster on GPU than CPU (12-20s vs 3min for 1min audio).
- **Python 3.11**: Runtime for Reverb - explicit 3.10+ requirement, 3.11 recommended for PyTorch 2.x compatibility.

**Existing stack unchanged:**
- Browser client remains single HTML file with vanilla JS
- Google Cloud STT v1 REST API continues as fallback and validation
- diff-match-patch used for reference text alignment (existing)
- IndexedDB via localForage for audio storage (existing)

### Expected Features (v1.3 Scope)

From FEATURES-reverb-disfluency.md:

**Must have (table stakes for disfluency detection):**
- Filler word detection (um, uh, er, ah) - standard in verbatim ASR, teachers expect to see what student actually said
- Repetition detection ("the the cat") - core disfluency type indicating decoding struggle
- Disfluency vs error separation in UI - clinical standard; disfluencies inform fluency, errors inform accuracy
- WCPM unaffected by disfluencies - per DIBELS: self-corrections and repetitions are NOT errors
- Visual distinction in word-synced playback - different color/style from errors

**Should have (competitive advantage):**
- Disfluency type classification (filler vs repetition vs false start) - each has different clinical significance
- False start detection ("I w- I went") - rare in competing products, indicates word attack issues
- Integration with existing VAD stutter severity - combine signals for richer diagnostic picture
- Disfluency trend over time - valuable for RTI progress monitoring

**Defer (v2+):**
- SLP referral report export - requires clinical validation
- Reading difficulty vs speech disorder distinction - requires multi-passage assessment workflow
- Real-time disfluency detection - performance/latency concerns with streaming

**Critical clinical distinction:** Disfluencies are NOT reading errors. Per ASHA and DIBELS guidelines, a child who says "the the the dog" read ONE word correctly with disfluency markers. Current ORF tools often conflate these, unfairly penalizing struggling readers. Reverb's dual-pass approach separates disfluencies (present in v=1.0, absent in v=0.0) from content words (present in both).

### Architecture Approach

From ARCHITECTURE.md, v1.3 uses:

**Service Adapter Pattern** - Normalize Reverb and Google responses to common interface (both return `{word, startTime, endTime, confidence}` format). Reverb's native CTM format (`start_time`, `end_time` floats) gets converted at the API boundary.

**Graceful Degradation** - Fall back to Google-only when Reverb offline. Health check (`/health` endpoint) determines availability. Browser continues to work even if backend is down - preserves existing functionality.

**New Algorithm for Disfluency** - Needleman-Wunsch global alignment of Reverb v=1.0 vs v=0.0 (not post-hoc cross-model comparison). This is fundamentally different from the abandoned disfluency-detector.js approach:
  - **Old approach (failed):** Compare Google latest_long vs default with 50ms local matching windows → 100% false positives when 60ms drift exceeded window size
  - **New approach:** Same model, same encoder, same CTC clock for v=1.0 vs v=0.0 → 10-20ms drift expected, absorbed by global alignment with text-based matching

**Cross-Vendor Validation** - Reverb vs Google disagreement flags potential hallucinations. When Reverb and Google produce different words at the same timestamp, Reference Veto logic (existing from ensemble-merger.js) determines which to trust. Cross-vendor errors are uncorrelated, so disagreement indicates ASR uncertainty.

**Major components:**
1. **reverb-api.js** [NEW] - HTTP client for localhost:8765, normalizes CTM to Google STT format
2. **sequence-aligner.js** [NEW] - Needleman-Wunsch implementation, pure function with no side effects
3. **disfluency-tagger.js** [NEW] - Classify disfluencies (filler/repetition/false_start) from alignment indices
4. **kitchen-sink-merger.js** [NEW] - Combine Reverb + Google results, cross-validation, trust hierarchy
5. **kitchen-sink-orchestrator.js** [NEW] - Coordinate parallel API calls, health check, fallback logic
6. **services/reverb/server.py** [NEW] - FastAPI server wrapping Reverb model, Docker container with GPU

**Existing components (24 JS modules) unchanged** - alignment.js, diagnostics.js, ensemble-merger.js, ghost-detector.js, vad-processor.js, etc. remain as fallback/complementary systems.

### Critical Pitfalls

From PITFALLS.md (v1.3-specific pitfalls):

1. **Cross-Vendor Timestamp Drift Causing False Positives (CRITICAL)** - Different ASR systems have no shared clock; drift ranges 22-127ms across systems. The abandoned disfluency-detector.js is the canonical failure: 60ms drift between Google models caused 100% false positive rate. **Avoid:** Use global alignment (Needleman-Wunsch) instead of local matching windows. For Reverb v=1.0 vs v=0.0, same model/encoder minimizes drift (10-20ms). Normalize timestamps before alignment. **Warning sign:** >30% of words flagged as mismatches between same-model passes.

2. **Docker GPU Access Silent Failure (CRITICAL)** - Container starts successfully but runs on CPU (10-20x slower). No error thrown. With 8GB VRAM, 1min audio takes 2-3min instead of 12-20s. **Avoid:** Explicit GPU check at startup: `if not torch.cuda.is_available(): raise RuntimeError`. Include `--gpus all` in docker-compose.yml. Test inference speed immediately (should be >3x realtime). **Warning sign:** nvidia-smi shows 0% GPU utilization during transcription.

3. **VRAM Exhaustion on Long Audio (CRITICAL)** - Model loads fine, short clips work, but >3-5min recordings cause CUDA OOM errors. ASR model memory grows with audio length; PyTorch fragments VRAM. **Avoid:** Implement chunked processing (60-90s segments with 1-2s overlap). Set `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`. Add request timeout (60s). **Warning sign:** First few transcriptions succeed, then random failures.

4. **CORS Blocking Browser-to-Backend Communication (MODERATE)** - FastAPI running, curl works, but browser gets CORS errors. **Avoid:** Configure explicit CORS for localhost origins and file:// protocol. Test with actual browser (not curl) - CORS is browser-enforced. **Warning sign:** curl works, browser doesn't.

5. **Needleman-Wunsch Gap Penalty Misconfiguration (MODERATE)** - Default gap penalties from DNA tutorials don't work for word alignment. Insertions (disfluencies) are common; deletions (omissions) are meaningful. **Avoid:** Use asymmetric penalties: `gap_insert=-1` (disfluencies cheap), `gap_delete=-2` (omissions costly). Use phonetic similarity for substitution scores. Test with "the the cat" vs "the cat" (should produce 1 insertion). **Warning sign:** All differences classified as one type.

## Implications for Roadmap

Based on research, v1.3 phases align with the implementation plan structure. The build order is dictated by dependencies: backend must work before browser integration, alignment algorithm must work before disfluency classification.

### Phase 1: Reverb Backend Setup
**Rationale:** Can't develop JS integration without working backend. Foundation for all disfluency detection features.
**Delivers:** FastAPI service with `/ensemble` endpoint, Docker container with GPU passthrough, health check working from browser
**Addresses:**
- Stack requirement: FastAPI + Reverb + Docker + GPU (from STACK.md)
- Must prevent: Docker GPU silent failure, VRAM exhaustion, CORS blocking (Pitfalls V1.3-2, V1.3-3, V1.3-4)
**Avoids:** GPU verification must be first health check, chunking implemented before first real deployment, CORS tested with browser not curl
**Research needs:** STANDARD - Docker GPU passthrough is well-documented, FastAPI has extensive docs

### Phase 2: Needleman-Wunsch Disfluency Detection
**Rationale:** Core algorithm that makes this milestone work. Must validate that same-model alignment (v=1.0 vs v=0.0) succeeds where cross-model failed.
**Delivers:** sequence-aligner.js (pure function), disfluency-tagger.js (classification), unit tests for alignment edge cases
**Uses:**
- Needleman-Wunsch global alignment (from ARCHITECTURE.md)
- Asymmetric gap penalties, phonetic similarity scoring (from PITFALLS.md)
**Addresses:**
- Table stakes: Filler detection, repetition detection (from FEATURES.md)
- Must prevent: Cross-vendor timestamp drift false positives, gap penalty misconfiguration (Pitfalls V1.3-1, V1.3-5)
**Avoids:** Global alignment instead of local windows, test with known-good inputs ("the the cat" vs "the cat")
**Research needs:** MODERATE - Needleman-Wunsch is well-documented for DNA but tuning for word alignment requires experimentation

### Phase 3: Browser Integration & Kitchen Sink Merger
**Rationale:** Ties backend and algorithm together. Implements cross-vendor validation and graceful fallback.
**Delivers:** reverb-api.js (HTTP client), kitchen-sink-merger.js (combine Reverb+Google), kitchen-sink-orchestrator.js (coordinate flow), fallback logic
**Implements:**
- Service Adapter Pattern (normalize response formats)
- Graceful Degradation (fall back to Google-only)
- Cross-Vendor Validation (disagreement flags hallucinations)
**Addresses:**
- Table stakes: Disfluency vs error separation in UI (from FEATURES.md)
- Should have: Disfluency type classification, integration with VAD stutter severity
- Must prevent: Cross-vendor hallucination false positives (Pitfall V1.3-8)
**Avoids:** Normalize case and contractions before comparison, use semantic similarity not string matching
**Research needs:** LOW - Integration patterns are straightforward given existing ensemble-merger.js as reference

### Phase 4: UI Display & Miscue Registry
**Rationale:** Make disfluencies visible and ensure system integrity per CLAUDE.md requirements.
**Delivers:** Visual distinction in word timeline (CSS classes), disfluency metrics in results panel, miscue-registry.js updates
**Addresses:**
- Table stakes: Visual distinction in playback, WCPM unaffected by disfluencies (from FEATURES.md)
- Project requirement: Miscue registry updates mandatory per CLAUDE.md
**Miscue registry entries required:**
  - `reverb_filler` (countsAsError: false, uiClass: 'word-filler')
  - `reverb_repetition` (countsAsError: false, uiClass: 'word-repetition')
  - `reverb_false_start` (countsAsError: false, uiClass: 'word-false-start')
**Research needs:** NONE - UI patterns established, miscue registry format defined

### Phase Ordering Rationale

- **Backend first (Phase 1):** Cannot test browser integration without working service. GPU and CORS issues must be resolved at foundation level.
- **Algorithm second (Phase 2):** Pure function can be developed and tested independently with mock data. Must validate before building on it.
- **Integration third (Phase 3):** Depends on both backend (Phase 1) and algorithm (Phase 2). Parallel API calls only make sense when both endpoints work.
- **UI last (Phase 4):** Presentation layer depends on data pipeline. Visual design is fast to iterate once data is correct.

**Dependency chain:**
```
Phase 1 (Backend) --> Phase 2 (Algorithm) --> Phase 3 (Integration) --> Phase 4 (UI)
                         |                           |
                         +---------------------------+
```

**How this avoids pitfalls:**
- Phase 1 catches Docker GPU, VRAM, CORS issues before any browser code written
- Phase 2 validates Needleman-Wunsch with unit tests before integration complexity
- Phase 3 tests cross-vendor validation in isolation before UI concerns
- Phase 4 ensures miscue registry (CLAUDE.md requirement) updated with correct countsAsError flags

### Research Flags

**Phases needing deeper research:**
- **Phase 2 (Needleman-Wunsch):** Gap penalty tuning requires experimentation with real ORF data. DNA-based defaults won't work. Need to iterate with known-good test cases until alignment produces clinically sensible results.

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Backend Setup):** Docker GPU passthrough, FastAPI CORS, Python dependency management are all well-documented with established patterns. Implementation plan provides sufficient detail.
- **Phase 3 (Integration):** Service adapter and graceful degradation are standard architectural patterns. Existing ensemble-merger.js provides reference implementation.
- **Phase 4 (UI Display):** CSS class-based styling is established pattern in codebase. Miscue registry format is defined in CLAUDE.md.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Reverb 0.1.0 verified via Phase 0 testing; FastAPI+Docker are production-proven; GPU requirements measured |
| Features | MEDIUM-HIGH | Clinical distinction (disfluency vs error) verified via ASHA/DIBELS docs; Reverb verbatimicity confirmed in paper; MVP scope realistic |
| Architecture | HIGH | Existing codebase analysis shows 24 JS modules; new components follow established patterns; abandoned detector failure informs design |
| Pitfalls | HIGH | Cross-vendor drift is documented in research (22-127ms); Docker GPU failures are common in forums; gap penalty issues predicted from bioinformatics experience |

**Overall confidence:** MEDIUM-HIGH

The v1.3 approach directly addresses the failure mode of the abandoned disfluency-detector.js (timestamp drift with local windows). Using the same Reverb model for both passes (v=1.0 and v=0.0) eliminates the cross-vendor drift that caused 100% false positives. Global alignment absorbs the remaining 10-20ms drift.

**Lower confidence area:** Needleman-Wunsch gap penalty tuning for word alignment (not DNA). This requires empirical validation with real student audio. The implementation plan includes test cases, but final parameter values will emerge from experimentation.

### Gaps to Address

**Gap 1: Reverb performance on children's speech** - Training was on 200k hours of general speech, not child-specific. Performance validation must happen during Phase 3 testing with real student recordings. The implementation plan includes A/B testing (Reverb vs Google ensemble) to measure accuracy.

**Gap 2: Verbatimicity normalization behavior** - Phase 0 confirmed v=0.0 may normalize "gonna" to "going to" (vocabulary cleaning, not just disfluency removal). Phase 2 must implement pre-alignment normalization to avoid false substitution flags.

**Gap 3: CTM format variations** - Phase 0 showed confidence=0.00 (no real score) and potential 6-field output. Parser must handle field count dynamically. Phase 1 must validate against actual Reverb output, not documentation assumptions.

**Gap 4: Long audio chunking strategy** - 8GB VRAM is a hard limit. Chunk size (60-90s) and overlap (1-2s) are estimates. Phase 1 must test with actual 5-10min recordings to tune parameters and verify no OOM.

**Gap 5: Cross-vendor validation thresholds** - When Reverb and Google disagree, what confidence delta triggers Reference Veto? Phase 3 will inherit logic from ensemble-merger.js but may need tuning for cross-vendor (not just cross-model) comparison.

## Sources

### Primary (HIGH confidence)

**v1.3 Reverb Stack:**
- [rev-reverb PyPI](https://pypi.org/project/rev-reverb/) - Version 0.1.0, Python 3.10+ requirement
- [Reverb ASR GitHub](https://github.com/revdotcom/reverb) - Installation, verbatimicity parameter docs
- [FastAPI CORS Documentation](https://fastapi.tiangolo.com/tutorial/cors/) - CORSMiddleware configuration
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) - Docker GPU setup
- [PyTorch Docker Images](https://hub.docker.com/r/pytorch/pytorch) - CUDA 11.8/12.x variants

**v1.3 Clinical Context:**
- [ASHA Fluency Disorders](https://www.asha.org/practice-portal/clinical-topics/fluency-disorders/) - Clinical distinction disfluency vs error
- [DIBELS ORF Scoring Guide](https://dibels.uoregon.edu/resources/scoring-practice-oral-reading-fluency-orf) - What counts as error in ORF (self-corrections and repetitions are NOT errors)

**v1.3 Alignment Research:**
- [Needleman-Wunsch Algorithm](https://en.wikipedia.org/wiki/Needleman%E2%80%93Wunsch_algorithm) - Global alignment approach
- [Cross-vendor ASR Timestamp Study](https://arxiv.org/html/2505.15646v1) - 22-127ms drift across systems
- [Reverb arXiv Paper](https://arxiv.org/html/2410.03930) - Table 5 verbatimicity behavior, 200k hours training

**Existing Codebase:**
- ReadingQuest codebase analysis - 24 JS modules, abandoned disfluency-detector.js failure documented
- FuturePlans/0 Kitchen-Sink-Ensemble-Implementation-Plan.md - 1014 lines, Phase 0 verification completed

### Secondary (MEDIUM confidence)

**v1.3 Performance:**
- [Rev.ai Reverb Blog](https://www.rev.com/blog/introducing-reverb-open-source-asr-diarization) - Verbatimicity feature description
- [Docker GPU Forums](https://forums.docker.com/t/applications-not-using-gpu-inside-the-container/140376) - Silent failure patterns
- [VRAM Management Strategies](https://localai.io/advanced/vram-management/) - Chunking and memory optimization

**Clinical Assessment:**
- [Reading Disfluency vs Stuttering - SpeechPathology.com](https://www.speechpathology.com/ask-the-experts/reading-disfluency-versus-stuttering-781) - Assessment guidance
- [Springer: Speech Enabled Reading Fluency](https://link.springer.com/article/10.1007/s40593-025-00480-y) - ASR in education validation

### Tertiary (LOW confidence - Needs Validation)

- GPU VRAM requirements (~1.6GB FP32) - Estimated from parameter count, not measured (measure in Phase 1)
- Reverb Turbo INT8 variant - Mentioned in paper but availability unverified
- Optimal verbatimicity threshold for ORF - Rev suggests 0.5 for captioning; ORF may need 1.0 (validate in Phase 3)
- False start capture reliability - Depends on acoustic clarity of partial words (validate with real student audio in Phase 3)

---
*Research completed: 2026-02-05*
*Milestone: v1.3 Kitchen Sink Ensemble*
*Ready for roadmap: yes*
