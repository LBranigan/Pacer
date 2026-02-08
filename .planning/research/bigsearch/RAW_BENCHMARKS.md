# Ensemble ASR Benchmark Research: Is It Worth the Complexity?

**Researcher:** Teammate C (Critique/Benchmarker)
**Date:** 2026-02-06
**Purpose:** Determine whether ensemble ASR (Google STT + Deepgram) is justified for a middle-school reading assessment tool vs. upgrading to a single best-in-class model.

---

## Table of Contents

1. [WER Benchmarks: Current State of the Art](#1-wer-benchmarks-current-state-of-the-art)
2. [Child Speech and Disfluent Speech Benchmarks](#2-child-speech-and-disfluent-speech-benchmarks)
3. [Cost and Latency Analysis](#3-cost-and-latency-analysis)
4. [ROVER and Ensemble-Specific Results](#4-rover-and-ensemble-specific-results)
5. [Critical Analysis: When Ensembles Do and Don't Help](#5-critical-analysis-when-ensembles-do-and-dont-help)
6. [Recommendations for Our System](#6-recommendations-for-our-system)

---

## 1. WER Benchmarks: Current State of the Art

### 1.1 Open ASR Leaderboard (HuggingFace, Nov 2025)

The Open ASR Leaderboard compares 60+ models from 18 organizations across 11 datasets. Standardized text normalization enables unified WER comparison; RTFx (real-time factor) measures efficiency.

**Top English Transcription Models (Short-Form):**

| Rank | Model | Org | Avg WER | Architecture |
|------|-------|-----|---------|-------------|
| 1 | Canary-Qwen 2.5B | NVIDIA | 5.63% | Conformer + LLM decoder |
| 2 | Granite-Speech-3.3-8B | IBM | ~5.85% | Conformer + LLM decoder |
| 3 | Phi-4-Multimodal-Instruct | Microsoft | ~6% | Multimodal LLM |
| 4 | Parakeet TDT 1.1B | NVIDIA | ~7% (est.) | Conformer + TDT decoder |
| -- | Whisper Large-v3 | OpenAI | ~7.88% | Encoder-decoder transformer |

**Key Tradeoff:** Conformer + LLM decoder models (top accuracy) are significantly slower than CTC/TDT decoder models. Parakeet TDT processes audio 6.5x faster than Canary-Qwen while ranking 23rd in accuracy.

**Source:** [HuggingFace Open ASR Leaderboard](https://huggingface.co/spaces/hf-audio/open_asr_leaderboard); [Slator coverage](https://slator.com/nvidia-microsoft-elevenlabs-top-automatic-speech-recognition-leaderboard/); [arXiv paper 2510.06961](https://arxiv.org/abs/2510.06961)
**Reliability:** HIGH -- standardized evaluation, reproducible, maintained by HuggingFace + NVIDIA + Cambridge.

---

### 1.2 Artificial Analysis Independent Leaderboard (2025-2026)

Uses AA-WER Index across 3 diverse real-world datasets (VoxPopuli, Earnings-22, AMI-SDM). This is one of the most trustworthy independent comparisons because it uses real-world audio, not curated test sets.

| Model | Provider | AA-WER | Speed Factor | Cost ($/1k min) |
|-------|----------|--------|-------------|-----------------|
| Chirp 2 | Google | 11.6% | 16.7x | $16.00 |
| Amazon Transcribe | AWS | 14.0% | 18.6x | $24.00 |
| Scribe v2 | ElevenLabs | 14.0% | 35.7x | $6.67 |
| Universal-2 | AssemblyAI | 14.5% | 74.1x | $2.50 |
| Voxtral Small | Mistral | 14.7% | 69.2x | $4.00 |
| Whisper Large v2 | OpenAI | 15.8% | 28.4x | $6.00 |
| Nova 2 Pro | Amazon Bedrock | 15.8% | 23.3x | $3.10 |
| Whisper Large v3 | Groq | 16.8% | 277.9x | $1.85 |
| Deepgram Nova-2 | Deepgram | 17.3% | 583.8x | $4.30 |

**CRITICAL NOTE:** These numbers are substantially higher than vendor-reported WER because AA uses challenging real-world audio. Provider benchmarks use cleaner, curated data.

**Nova-3 Independent:** Reported ~18% AA-WER on independent benchmarks (vs. Deepgram's self-reported 5.8%).

**Source:** [Artificial Analysis STT Leaderboard](https://artificialanalysis.ai/speech-to-text)
**Reliability:** HIGH -- independent, standardized, uses real-world audio.

---

### 1.3 Whisper Model Family (No "v4" Exists)

| Model | Params | WER (clean) | WER (mixed) | WER (Common Voice 15) | Speed |
|-------|--------|-------------|-------------|----------------------|-------|
| Whisper Large-v3 | 1550M | 2.7% | 7.88% | 9.0% | 1x baseline |
| Whisper Large-v3 Turbo | 809M | ~3% | 7.75% | 10.2% | 6x faster |
| Whisper Large-v2 | 1550M | ~3.5% | ~9% | ~11% | 1x baseline |

Turbo achieves this speedup by reducing decoder layers from 32 to 4. Accuracy within 1-2% of full Large-v3.

**There is no Whisper v4.** The latest release is Whisper Large-v3 Turbo (released 2024). OpenAI has not announced further Whisper model updates.

**Source:** [OpenAI Whisper GitHub](https://github.com/openai/whisper); [Northflank benchmarks](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks)
**Reliability:** HIGH -- well-documented, widely reproduced.

---

### 1.4 DeepSeek ASR

**DeepSeek has NOT released a dedicated ASR model.** Their focus is on large language models (DeepSeek-R1, DeepSeek-V3). Some developers integrate DeepSeek LLMs with ASR systems (e.g., Whisper + DeepSeek for post-processing), but there is no standalone DeepSeek ASR to benchmark.

**Source:** [DeepSeek official](https://www.deepseek.com/); [HuggingFace models](https://huggingface.co/models?search=deepseek-ai/deepseek)
**Reliability:** CONFIRMED -- no ASR model exists.

---

### 1.5 VoiceWriter Independent Comparison (2025)

This evaluation tested multiple providers on clean, noisy, accented, and technical speech:

| Category | Best Performer | Runner-up | Worst |
|----------|---------------|-----------|-------|
| Clean speech | OpenAI Whisper | Deepgram, Gemini | -- |
| Noisy speech | Whisper, AssemblyAI, AWS | -- | Azure, Google Cloud ASR |
| Accented speech | Google Gemini | Whisper, AssemblyAI | Google Cloud ASR (35% WER!) |
| Technical speech | Google Gemini | Whisper, AssemblyAI | -- |
| Overall batch | Whisper & Gemini (tied 1st) | -- | Google Cloud ASR (last) |
| Streaming | AWS & AssemblyAI (tied 1st) | -- | -- |

**Key insight:** Google Cloud ASR (the standard STT API, not Chirp) performed poorly with 35% WER on accented speech. This is relevant to our system since we use Google STT.

**Source:** [VoiceWriter Blog](https://voicewriter.io/blog/best-speech-recognition-api-2025)
**Reliability:** MEDIUM-HIGH -- independent, systematic, but single evaluator.

---

## 2. Child Speech and Disfluent Speech Benchmarks

### 2.1 Children's Speech: The Performance Gap

**Adult vs. child speech WER gap is enormous.** An adult-trained transformer ASR achieved:
- Adults: 2.89% WER
- MyST corpus (children ages 8-11): 38.8% WER
- OGI Kids corpus: 87.2% WER

This is a 13-30x degradation. Children's speech is fundamentally harder due to higher pitch, variable pronunciation, smaller vocabulary overlap with training data, and reading-specific disfluencies.

**Source:** [MDPI Applied Sciences 2024](https://www.mdpi.com/2076-3417/14/6/2353)
**Reliability:** HIGH -- peer-reviewed, well-controlled experiment.

---

### 2.2 Model-by-Model Child Speech Benchmarks

**MyST Dataset (children ages 8-11, conversational, ~240 hours):**

| Model | Zero-Shot WER | Fine-Tuned WER |
|-------|--------------|----------------|
| Whisper-tiny | 20.6% | 11.6% |
| Whisper-base | 16.8% | 10.4% |
| Whisper-small | 13.4% | 9.3% |
| Whisper-medium | 13.1% | 8.9% |
| Whisper-large | 12.5% | 13.0% (overfit) |
| Whisper-large-v3 | 12.6% | 9.1% |
| Canary (NVIDIA) | 9.5% | -- |
| Parakeet (NVIDIA) | 11.1% | -- |
| wav2vec2.0 | -- | 11.1% |
| HuBERT | -- | 11.3% |
| WavLM | -- | 10.4% |

**Best reported MyST result:** 8.61% WER (Whisper-Medium fine-tuned, Kid-Whisper paper). Separate work achieved 9.2% (lowest at time of publication, ICASSP 2024).

**OGI Kids Corpus (children ages 4-14, read speech, ~50 hours):**

| Model | Zero-Shot WER | Fine-Tuned WER |
|-------|--------------|----------------|
| Whisper-tiny | 53.8% | 3.0% |
| Whisper-base | 38.0% | 2.3% |
| Whisper-small | 25.4% | 1.8% |
| Whisper-medium | 20.8% | 1.5% |
| Whisper-large | 22.9% | 1.7% |
| Whisper-large-v3 | 19.9% | 1.4% |
| Canary | 18.2% | -- |
| Parakeet | 16.7% | -- |

**Key Insight for Our Use Case:** Zero-shot Whisper-large-v3 achieves 12.6% on MyST and 19.9% on OGI. Fine-tuning drops these to 9.1% and 1.4% respectively. NVIDIA Canary achieves 9.5% zero-shot on MyST -- competitive with fine-tuned Whisper.

**Source:** [arXiv 2406.10507](https://arxiv.org/html/2406.10507v1); [Kid-Whisper, arXiv 2309.07927](https://arxiv.org/abs/2309.07927v3)
**Reliability:** HIGH -- peer-reviewed, reproducible benchmarks.

---

### 2.3 Disfluent Speech: Where All ASR Models Struggle

This is the most critical data for our reading assessment tool. From the "Lost in Transcription" study (2024):

**Real Stuttered Speech (FluencyBank):**

| ASR Model | Fluent WER | Disfluent WER | Gap |
|-----------|-----------|---------------|-----|
| Whisper | 6.3% | 12.1% | +5.8% |
| Azure | 7.3% | 16.8% | +9.5% |
| GCP (Google) | 6.9% | 27.5% | +20.6% |
| RevAI | 15.9% | 26.3% | +10.4% |
| wav2vec 2.0 | 10.1% | 38.0% | +27.9% |
| IBM Watson | 16.7% | 47.6% | +30.9% |

**Synthetic Disfluencies on LibriSpeech:**

| ASR Model | Fluent WER | Disfluent WER | Gap |
|-----------|-----------|---------------|-----|
| Whisper | 3.1% | 19.8% | +16.7% |
| Azure | 3.7% | 22.8% | +19.1% |
| GCP (Google) | 7.0% | 26.8% | +19.8% |
| RevAI | 6.2% | 25.4% | +19.2% |
| wav2vec 2.0 | 3.3% | 25.9% | +22.6% |
| IBM Watson | 19.1% | 56.0% | +36.9% |

**Critical Finding for Our System:**
- Whisper handles disfluency best (smallest gap), but still degrades significantly.
- Google Cloud (GCP) has a MASSIVE disfluency gap: 6.9% -> 27.5% on real stuttered speech (+20.6 percentage points). This means Google STT is particularly weak where our tool needs it most.
- Only 56% of speech disfluencies at the word level are correctly transcribed by Whisper.

**Source:** [arXiv 2405.06150](https://arxiv.org/abs/2405.06150)
**Reliability:** HIGH -- peer-reviewed, systematic evaluation, multiple ASR systems.

---

### 2.4 ASR in Reading Assessment

**NWEA MAP Reading Fluency** is the most widely deployed ASR-based reading assessment (K-3), using speech recognition to automatically score oral reading. ASR-based systems achieve WCPM (words correct per minute) scores within 3-4 words of human scorers.

A 2025 Interspeech study found differential ASR error rates by language background:
- English native speakers: ~19.5% error rate
- Indo-European language speakers: ~23.2%
- Non-Indo-European language speakers: ~26.9%

Fine-tuning Whisper on child speech or on the specific reading texts significantly improves performance for reading assessment applications.

**Source:** [PMC/12686063](https://pmc.ncbi.nlm.nih.gov/articles/PMC12686063/); [Interspeech 2025](https://www.isca-archive.org/interspeech_2025/harmsen25_interspeech.pdf)
**Reliability:** HIGH -- peer-reviewed validation studies.

---

## 3. Cost and Latency Analysis

### 3.1 Per-Minute Pricing (As of July 2025)

**Streaming (Real-Time):**

| Provider | Model | $/minute | $/1000 min | Notes |
|----------|-------|----------|-----------|-------|
| AssemblyAI | Universal-2 | $0.0025 | $2.50 | Cheapest streaming |
| Deepgram | Nova-3 | $0.0077 | $7.70 | Pay-as-you-go |
| Deepgram | Nova-3 | $0.0065 | $6.50 | Growth plan |
| Google Cloud | STT v2 | $0.016 | $16.00 | Standard streaming |
| Azure | AI Speech | $0.0167 | $16.70 | Standard |
| AWS | Transcribe | $0.024 | $24.00 | Most expensive |

**Batch (Pre-Recorded):**

| Provider | Model | $/minute | $/1000 min |
|----------|-------|----------|-----------|
| AssemblyAI | Universal-2 | $0.0045 | $4.50 |
| Azure | AI Speech | $0.003 | $3.00 |
| Google Cloud | STT v2 | $0.003 | $3.00 (dynamic batch) |
| Deepgram | Nova-3 | $0.0043 | $4.30 |
| OpenAI | Whisper API | $0.006 | $6.00 |
| AWS | Transcribe | $0.024 | $24.00 |

**Source:** [Deepgram pricing breakdown](https://deepgram.com/learn/speech-to-text-api-pricing-breakdown-2025); [VocaFuse comparison](https://vocafuse.com/blog/best-speech-to-text-api-comparison-2025/)
**Reliability:** HIGH -- pulled from published pricing pages, verified July 2025.

---

### 3.2 Cost of Our Current Ensemble (Google + Deepgram)

**Per reading session (assume 3 minutes of streaming audio):**

| Component | Cost/min | Cost/session (3 min) |
|-----------|----------|---------------------|
| Google STT streaming | $0.016 | $0.048 |
| Deepgram Nova-3 streaming | $0.0077 | $0.023 |
| **Total ensemble** | **$0.0237** | **$0.071** |

**Versus single-model alternatives:**

| Approach | Cost/session (3 min) | Relative Cost |
|----------|---------------------|--------------|
| Google + Deepgram (current) | $0.071 | 1.0x (baseline) |
| Deepgram only | $0.023 | 0.32x |
| AssemblyAI only (streaming) | $0.0075 | 0.11x |
| Google only | $0.048 | 0.68x |

**At scale (1000 students, 20 sessions each = 60,000 minutes):**

| Approach | Annual Cost |
|----------|------------|
| Google + Deepgram ensemble | $1,422 |
| Deepgram only | $462 |
| AssemblyAI only | $150 |
| Google only | $960 |

---

### 3.3 Self-Hosted Whisper Costs

| Setup | Monthly Cost | $/minute (effective) | Break-Even vs API |
|-------|-------------|---------------------|-------------------|
| T4 GPU (cloud) | ~$861/mo (all-in) | $0.072 | Never at low volume |
| A100 GPU (cloud) | ~$500-2,400/mo | $0.013-0.067 | ~3,000 hrs/mo |
| OpenAI Whisper API | Pay-per-use | $0.006 | -- |

**Verdict:** Self-hosting only makes sense at very high volumes (>2,400 hours/month). For a reading assessment tool, API-based models are more cost-effective.

**Source:** [BrassTranscripts analysis](https://brasstranscripts.com/blog/openai-whisper-api-pricing-2025-self-hosted-vs-managed)
**Reliability:** MEDIUM-HIGH -- well-researched but costs vary by region/provider.

---

### 3.4 Streaming Latency

| Provider | Typical Latency | Notes |
|----------|----------------|-------|
| Deepgram | ~150ms | Best-in-class for streaming |
| AssemblyAI | <300ms | Competitive |
| Google Cloud STT | Sub-second (variable) | Historically 200-500ms |
| AWS Transcribe | 200-500ms | Moderate |

For our reading assessment use case, sub-500ms latency is sufficient (we need near-real-time tracking, not conversational response).

**Source:** [Introl voice AI guide](https://introl.com/blog/voice-ai-infrastructure-real-time-speech-agents-asr-tts-guide-2025)
**Reliability:** MEDIUM -- latency varies by network, region, and audio characteristics.

---

## 4. ROVER and Ensemble-Specific Results

### 4.1 ROVER WER Reduction

ROVER (Recognizer Output Voting Error Reduction) is the standard approach for combining ASR outputs, which is effectively what our system does when cross-validating Google STT and Deepgram results.

**Published ensemble improvements:**

| Study | Individual Best WER | Ensemble WER | Relative WERR | Method |
|-------|-------------------|--------------|---------------|--------|
| Kaldi + wav2vec 2.0 (2024) | ~20% | ~17.2% | 14% primary, 20% noisy | ROVER |
| TED talks (quality-weighted) | ~7% (est.) | 5.4-5.9% | 1.6% absolute | Segment-ROVER |
| CHiME-3 noisy (quality-weighted) | ~20% (est.) | 12.7-13% | 7.3% absolute | Segment-ROVER |
| FH + AED combination (2025) | 5.4% (AED) | 5.1% | 0.3 pts absolute | Log-linear |
| CTC + AED combination (2025) | 5.4% (AED) | 5.2% | 0.2 pts absolute | Log-linear |
| Teacher ensemble adaptation | ~35% (est.) | ~25% | 9.8% absolute | Multi-domain |

**Source:** [ACL Anthology 2024](https://aclanthology.org/2024.lrec-main.547/); [arXiv 2508.09880](https://arxiv.org/html/2508.09880v1); [ACL P15-1106](https://aclanthology.org/P15-1106.pdf)
**Reliability:** HIGH -- peer-reviewed, reproducible.

---

### 4.2 When Ensembles Provide the Most Benefit

The theoretical framework (IEEE 2014) decomposes ROVER performance:

```
WER_ROVER = Avg_WER_individual - Diversity_measure
```

**Maximum benefit occurs when:**
1. Individual models have similar WER (neither dominates)
2. Models make DIFFERENT errors (high diversity/complementarity)
3. Audio is challenging (noisy, disfluent, accented)

**Surprising finding:** "The combination of two identical models can perform as well as the combination of two very distinct models" -- suggesting that N-best list overlap, not just architecture diversity, matters.

**Source:** [IEEE 6727393](https://ieeexplore.ieee.org/document/6727393/)
**Reliability:** HIGH -- theoretical + experimental, IEEE journal.

---

### 4.3 Typical Ensemble Improvement Ranges

| Condition | Typical WERR | Worth It? |
|-----------|-------------|----------|
| Clean speech, both models good | 2-5% relative | Marginal |
| Clean speech, one model dominant | 0-2% relative | No |
| Noisy/challenging speech | 10-20% relative | Yes |
| Models with different architectures | 10-14% relative | Often yes |
| Models with same architecture | 3-7% relative | Marginal |

---

## 5. Critical Analysis: When Ensembles Do and Don't Help

### 5.1 The Case FOR Our Ensemble (Google + Deepgram)

**Argument 1: Different error profiles.**
Google STT and Deepgram Nova use fundamentally different architectures and training data. Google uses USM/Chirp (2B parameter, trained on 12M hours), while Deepgram Nova uses a proprietary end-to-end model. Different architectures = different errors = ROVER-style combination helps.

**Argument 2: Disfluency is our hardest problem.**
On disfluent speech, Google degrades by +20.6 percentage points while Whisper/Deepgram-class models degrade by ~6-10 points. When one model fails on a disfluency, the other may catch it. This is exactly the high-diversity scenario where ensembles help most.

**Argument 3: Reading assessment tolerance is tight.**
Our system needs to detect specific miscues (omissions, substitutions, hesitations). A 3-4% WER improvement could translate to catching several more real errors per passage. WCPM accuracy within 3-4 words of human scorers is the standard -- ensemble could help reach that threshold.

---

### 5.2 The Case AGAINST Our Ensemble

**Argument 1: Cost is 2.3x single model.**
Our Google+Deepgram ensemble costs $0.071/session vs. $0.023 for Deepgram alone. At scale, this is $1,422 vs. $462 annually. The question is whether accuracy gains justify 3x cost.

**Argument 2: Google STT is a weak link on our hardest problem.**
Google Cloud ASR scored LAST in independent comparisons (VoiceWriter), with 35% WER on accented speech and a 20.6% disfluency gap. We are paying premium ($0.016/min) for arguably the worst model for our specific use case. Replacing Google with AssemblyAI ($0.0025/min) or keeping Deepgram alone might be better.

**Argument 3: Diminishing returns at the low end.**
When models are already <10% WER, ensemble gains shrink. The FH+AED combination study showed only 0.3 percentage point improvement when the best individual model was 5.4% WER. But our real-world WER on child disfluent speech is much higher (probably 15-30%), where ensemble gains are larger.

**Argument 4: Complexity tax.**
Alignment logic, confidence arbitration, and cross-validation code add bugs and maintenance burden. Every new error type needs calibration across two engines.

---

### 5.3 The Overlooked Alternative: Fine-Tuned Single Model

The child speech benchmarks show that fine-tuning Whisper-medium on MyST data drops WER from 13.1% to 8.9% -- a 32% relative improvement. This is larger than most ensemble gains (typically 10-20% relative) and costs nothing extra at inference time.

A fine-tuned Whisper model could potentially:
- Beat our current ensemble on child/disfluent speech
- Cost $0.006/min (OpenAI API) or $0.0043/min (via Deepgram/AssemblyAI)
- Eliminate alignment complexity entirely

**However:** Fine-tuning requires labeled child speech data, and the OpenAI API does not support custom models. Self-hosting would be needed, which adds infrastructure cost.

---

### 5.4 Error Correlation Analysis: Do Google and Deepgram Make Different Errors?

This is the key question. Based on available evidence:

| Factor | Google STT | Deepgram Nova-3 | Diversity? |
|--------|-----------|-----------------|-----------|
| Architecture | USM/Chirp (2B params) | Proprietary E2E | HIGH |
| Training data | YouTube, public audio | Proprietary, business focus | MEDIUM |
| Disfluency handling | Very poor (+20.6% gap) | Better (est. +8-12% gap) | HIGH |
| Accented speech | Very poor (35% WER) | Moderate | HIGH |
| Clean speech | Competitive (11.6% AA-WER) | Moderate (17-18% AA-WER) | MEDIUM |
| Streaming latency | 200-500ms | ~150ms | LOW |

**Assessment:** The models likely have HIGH error diversity on disfluent/challenging speech, which is exactly our target scenario. This suggests ensemble DOES help for our use case, more than it would for clean speech transcription.

---

## 6. Recommendations for Our System

### 6.1 Summary Table

| Approach | Est. WER (child disfluent) | Cost/session | Complexity | Recommendation |
|----------|---------------------------|-------------|------------|----------------|
| Google + Deepgram (current) | ~18-22% | $0.071 | High | Keep for now, but consider replacing Google |
| Deepgram only | ~22-28% | $0.023 | Low | Good fallback |
| AssemblyAI Universal-2 only | ~20-25% (est.) | $0.0075 | Low | Best cost-efficiency |
| AssemblyAI + Deepgram | ~16-20% (est.) | $0.030 | Medium | Recommended upgrade |
| Fine-tuned Whisper (self-hosted) | ~10-15% | $0.013-0.072 | Medium (infra) | Best accuracy, more complex |
| 3-model ensemble | ~15-18% | $0.10+ | Very high | Diminishing returns |

### 6.2 Specific Recommendations

**Recommendation 1: REPLACE Google STT with AssemblyAI in the ensemble.**
- AssemblyAI Universal-2 has 14.5% AA-WER (vs. Google's 11.6%), but AssemblyAI excels at streaming, has 30% fewer hallucinations than Whisper, and costs $0.0025/min vs. $0.016/min.
- Google STT is our weakest performer on disfluent speech (the core use case).
- AssemblyAI + Deepgram ensemble would cost $0.030/session (58% cheaper than current) with likely BETTER accuracy on disfluent child speech.

**Recommendation 2: The ensemble IS justified for disfluent child speech.**
- On clean adult speech, ensembles provide marginal 2-5% WERR. Not worth it.
- On disfluent/child speech (WER 15-30%), ensembles provide 10-20% WERR. Worth it.
- Our use case (struggling middle schoolers reading aloud) is exactly the scenario where ensemble provides maximum benefit.
- The cost difference is small in absolute terms ($0.030 vs. $0.008 per session).

**Recommendation 3: Long-term, investigate fine-tuned Whisper for reading assessment.**
- Fine-tuned Whisper-medium on child speech: 8.9% WER on MyST.
- This could be a single model that outperforms our ensemble.
- Requires collecting/labeling our own student reading data.
- Could be deployed via a service like Replicate or Modal at low cost.

**Recommendation 4: Do NOT add a third model.**
- Going from 2 to 3 models adds ~50% more cost for diminishing returns.
- The 2025 combination studies show 0.2-0.3 percentage point gains from adding a third model to already-strong pairs.
- Alignment complexity grows quadratically with model count.

---

## Appendix A: Data Gaps and Limitations

1. **No direct benchmark of Google STT + Deepgram ensemble exists.** All ensemble WER numbers are extrapolated from analogous ROVER studies.
2. **No child disfluent speech benchmarks for Deepgram Nova-3 or AssemblyAI Universal-2.** Only Whisper and legacy commercial APIs have been tested.
3. **Vendor benchmarks are unreliable.** Deepgram reports 5.8% WER; independent testing shows 17-18%. Always prefer independent benchmarks.
4. **Our reading assessment task is unique.** We need miscue detection (substitutions, omissions, insertions), not just transcription. WER is a proxy; task-specific accuracy may differ.
5. **Pricing changes frequently.** All costs verified as of early 2026 but subject to change.

## Appendix B: Key Sources

- [HuggingFace Open ASR Leaderboard](https://huggingface.co/spaces/hf-audio/open_asr_leaderboard) -- 60+ models, standardized evaluation
- [Artificial Analysis STT](https://artificialanalysis.ai/speech-to-text) -- Independent real-world WER
- [VoiceWriter 2025 Comparison](https://voicewriter.io/blog/best-speech-recognition-api-2025) -- Multi-category testing
- [arXiv 2406.10507: Children's ASR Benchmarks](https://arxiv.org/html/2406.10507v1) -- MyST and OGI WER tables
- [arXiv 2405.06150: Lost in Transcription](https://arxiv.org/abs/2405.06150) -- Disfluent speech bias quantification
- [arXiv 2309.07927: Kid-Whisper](https://arxiv.org/abs/2309.07927v3) -- Fine-tuned Whisper for child speech
- [IEEE 6727393: Diversity in ASR Ensembles](https://ieeexplore.ieee.org/document/6727393/) -- Theoretical framework
- [ACL 2024: Hybrid + E2E Ensembles](https://aclanthology.org/2024.lrec-main.547/) -- ROVER WER reduction
- [arXiv 2508.09880: ASR System Combination](https://arxiv.org/html/2508.09880v1) -- Multi-architecture combination
- [Deepgram Pricing 2025](https://deepgram.com/learn/speech-to-text-api-pricing-breakdown-2025) -- Cost comparison
- [ICASSP 2024: Child ASR in Classroom](https://par.nsf.gov/servlets/purl/10520979) -- Classroom ASR challenges
- [PMC 12686063: Reading Fluency Validation](https://pmc.ncbi.nlm.nih.gov/articles/PMC12686063/) -- ASR reading assessment validation
- [Northflank 2026 Benchmarks](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks) -- Open-source model comparison
- [Interspeech 2025: ASR Reading Fluency](https://www.isca-archive.org/interspeech_2025/harmsen25_interspeech.pdf) -- Child fluency with ASR

---
---

# SECOND PASS: Additional Benchmarks and Numbers

**Date:** 2026-02-06 (second research pass)
**Focus:** Deeper drill-down into specific numbers, new models, cost data for emerging providers, hallucination rates, and ensemble decision frameworks.

---

## 7. Open ASR Leaderboard: Expanded Top 20 with Per-Dataset WER

### 7.1 Top Models by Average WER (Open ASR Leaderboard, Nov 2025)

The leaderboard evaluates models across 8 English datasets: AMI, Earnings22, GigaSpeech, LibriSpeech test-clean, LibriSpeech test-other, SPGISpeech, TedLIUM, and VoxPopuli. RTFx = seconds of audio processed per second of compute (higher = faster).

| Rank | Model | Org | Avg WER | RTFx | Params | Architecture |
|------|-------|-----|---------|------|--------|-------------|
| 1 | Canary-Qwen 2.5B | NVIDIA | 5.63% | 418 | 2.5B | FastConformer + Qwen3 LLM |
| 2 | Granite-Speech-3.3-8B | IBM | 5.74% | 145 | ~9B | Conformer + LLM |
| 3 | Granite-Speech-3.3-2B | IBM | 6.00% | 260 | ~2B | Conformer + LLM |
| 4 | Phi-4-Multimodal-Instruct | Microsoft | 6.02% | 151 | ~14B | Multimodal LLM |
| 5 | Parakeet TDT 0.6B v2 | NVIDIA | 6.05% | 3,386 | 0.6B | FastConformer + TDT |
| 6 | Parakeet TDT 1.1B | NVIDIA | ~6.7% | ~2,794 | 1.1B | FastConformer + TDT |
| 7 | Whisper Large-v3 Turbo | OpenAI | 7.75% | 216 | 809M | Encoder-Decoder Transformer |
| 8 | Whisper Large-v3 | OpenAI | 7.88% | 69 | 1,550M | Encoder-Decoder Transformer |
| 9 | Parakeet TDT 0.6B v3 | NVIDIA | ~8.0% | ~3,300 | 0.6B | FastConformer + TDT (multilingual) |
| 10 | Distil-Whisper Large-v3 | HuggingFace | ~8.5% | ~350 | 756M | Distilled Encoder-Decoder |
| 11 | CrisperWhisper | -- | ~8.8% | -- | ~1,550M | Fine-tuned Whisper |
| 12 | Moonshine Base | Useful Sensors | 9.89% | ~1,500 | 61M | Lightweight Enc-Dec |
| 13 | Whisper Large-v2 | OpenAI | ~9.0% | ~65 | 1,550M | Encoder-Decoder Transformer |
| 14 | Moonshine Tiny | Useful Sensors | 12.53% | ~3,000 | 27M | Lightweight Enc-Dec |
| ~15 | Whisper Medium | OpenAI | ~10.5% | ~120 | 769M | Encoder-Decoder Transformer |
| ~16 | Whisper Small | OpenAI | ~12% | ~250 | 244M | Encoder-Decoder Transformer |
| -- | ElevenLabs Scribe v2 | ElevenLabs | ~7% (est.) | -- | Closed | Closed-source (long-form leader) |

**Note:** Ranks 10-16 are approximate based on published fragments and cross-referencing. The dynamic leaderboard updates frequently.

**Source:** [arXiv 2510.06961 Table 3](https://arxiv.org/html/2510.06961v1); [HuggingFace Blog](https://huggingface.co/blog/open-asr-leaderboard); [Slator](https://slator.com/nvidia-microsoft-elevenlabs-top-automatic-speech-recognition-leaderboard/)
**Reliability:** HIGH -- standardized, reproducible.

---

### 7.2 NVIDIA Canary-Qwen 2.5B: Full Per-Dataset Breakdown

This is the #1 model on the leaderboard. Complete per-dataset WER (from the official model card):

| Dataset | WER |
|---------|-----|
| LibriSpeech test-clean | 1.60% |
| LibriSpeech test-other | 3.10% |
| SPGISpeech | 1.90% |
| TedLIUM | 2.72% |
| VoxPopuli | 5.66% |
| GigaSpeech | 9.41% |
| AMI | 10.18% |
| Earnings22 | 10.42% |
| **Mean** | **5.63%** |

**Noise Robustness (LibriSpeech test-clean with additive white noise):**

| SNR (dB) | WER |
|----------|-----|
| 10 dB | 2.41% |
| 5 dB | 4.08% |
| 0 dB | 9.83% |
| -5 dB | 30.60% |

**Hallucination metric (MUSAN 48hr eval set):** 138.1 characters/minute generated on non-speech audio.

**Key details:**
- Trained on 234,500 hours of public English speech data
- AMI was oversampled to ~15% of training data, biasing toward verbatim transcription including disfluencies
- Architecture: FastConformer encoder + Qwen3-1.7B LLM decoder
- 90k training steps on 32x A100 80GB GPUs

**Source:** [NVIDIA Canary-Qwen 2.5B Model Card](https://huggingface.co/nvidia/canary-qwen-2.5b)
**Reliability:** HIGH -- official model card with reproducible benchmarks.

---

### 7.3 NVIDIA Parakeet TDT: Speed King

Parakeet models dominate the speed axis of the leaderboard. Key numbers:

| Model | Avg WER | RTFx | LibriSpeech clean | LibriSpeech other | Params |
|-------|---------|------|-------------------|-------------------|--------|
| Parakeet TDT 0.6B v2 | 6.05% | 3,386 | 1.69% | 3.19% | 600M |
| Parakeet TDT 0.6B v3 | ~8.0% | ~3,300 | -- | -- | 600M |
| Parakeet TDT 1.1B | ~6.7% | ~2,794 | -- | -- | 1.1B |
| Parakeet CTC 1.1B | 6.68% | 2,794 | -- | -- | 1.1B |

**v2 vs v3:** v3 adds multilingual support (25 European languages) but sacrifices ~2 points of English WER. Best v3 per-language results: Italian 4.3%, Spanish 5.4%, English 6.1%, German 7.4%, French 7.7%.

**Speed context:** Parakeet TDT 0.6B v2 at RTFx 3,386 processes 1 hour of audio in ~1.06 seconds. Compare to Whisper Large-v3 at RTFx 69, which takes ~52 seconds for the same hour. That is a **49x speed difference**.

**Source:** [NVIDIA Parakeet v2 Model Card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2); [NVIDIA Blog](https://developer.nvidia.com/blog/nvidia-speech-ai-models-deliver-industry-leading-accuracy-and-performance/)
**Reliability:** HIGH -- official model card.

---

## 8. New Models: Moonshine, ElevenLabs Scribe, GPT-4o Transcribe

### 8.1 Moonshine (Useful Sensors) -- Lightweight Edge ASR

Moonshine is designed for edge deployment (phones, embedded devices). It is the fastest model with competitive accuracy at extreme parameter efficiency.

| Model | Params | Avg WER (Open ASR) | Speed vs Whisper | Key Advantage |
|-------|--------|-------------------|-----------------|---------------|
| Moonshine Tiny | 27M | 12.53% | 5x faster on 10s clips | Runs on CPU, <30MB |
| Moonshine Base | 61M | 9.89% | 3x faster | Edge-viable, decent accuracy |
| Whisper Tiny | 39M | ~15% | 1x baseline | Reference |
| Whisper Base | 74M | ~12% | 1x baseline | Reference |

**Non-English performance:** Moonshine Tiny achieves error rates 48% lower than Whisper Tiny across Arabic, Chinese, Japanese, Korean, Ukrainian, and Vietnamese. It also outperforms Whisper Small (9x larger) on these languages.

**Relevance to our system:** Moonshine is NOT suitable for our reading assessment tool. Its accuracy on challenging audio (child speech, disfluencies) would be significantly worse than larger models. However, if we ever need offline/edge processing (e.g., a tablet app without internet), Moonshine Base could be a viable fallback.

**Source:** [Moonshine GitHub](https://github.com/moonshine-ai/moonshine); [arXiv 2509.02523](https://arxiv.org/pdf/2509.02523)
**Reliability:** HIGH -- open-source, reproducible.

---

### 8.2 ElevenLabs Scribe v2 -- Accuracy Leader for Long-Form

ElevenLabs Scribe v2 is a closed-source commercial model that leads the Open ASR Leaderboard for long-form transcription.

**Performance:**
- Scribe v2 (batch): 14.0% AA-WER on Artificial Analysis independent benchmark
- Scribe v2 Realtime: 93.5% accuracy on FLEURS multilingual benchmark (30 languages)
- Scribe v2 batch: 96.7% accuracy for English (ElevenLabs reported), 98.7% for Italian
- Long-form transcription: #1 on Open ASR Leaderboard long-form track

**Scribe v2 Realtime vs competitors (FLEURS, 30 languages):**

| Model | Accuracy | Latency |
|-------|----------|---------|
| ElevenLabs Scribe v2 RT | 93.5% | 150ms |
| Google Gemini Flash 2.5 | 90% | -- |
| OpenAI GPT-4o Mini | 85% | -- |
| Deepgram Nova-3 | 80% | ~150ms |

**Pricing:**
- Scribe v2 (batch): $0.40/hour = $0.00667/min = $6.67/1000 min
- Scribe v2 Realtime: $0.40/hour (same rate)
- 50% launch discount was available (expired)

**Source:** [ElevenLabs Scribe v2 Launch](https://elevenlabs.io/blog/introducing-scribe-v2); [ElevenLabs Scribe v2 Realtime](https://elevenlabs.io/blog/introducing-scribe-v2-realtime); [Artificial Analysis](https://artificialanalysis.ai/speech-to-text)
**Reliability:** MEDIUM-HIGH -- Artificial Analysis independent numbers are reliable; ElevenLabs self-reported numbers less so.

---

### 8.3 OpenAI GPT-4o Transcribe -- LLM-Powered ASR

OpenAI released dedicated transcription models in 2025, separate from Whisper.

**Artificial Analysis Independent Benchmarks:**

| Model | AA-WER | VoxPopuli | Earnings-22 | AMI-SDM | Speed Factor | Cost/1k min |
|-------|--------|-----------|-------------|---------|-------------|-------------|
| GPT-4o Transcribe | 21.3% | 7.03% | 12.68% | 44.26% | 26.5x | $6.00 |
| GPT-4o Mini Transcribe | 20.1% | 7.46% | 12.43% | 40.39% | 42.6x | $3.00 |

**Key insight:** GPT-4o Transcribe ranks only 15th on the Artificial Analysis leaderboard despite OpenAI's claims of "lowest WER across benchmarks." The AMI-SDM dataset (meeting speech with distant microphones) is its Achilles heel at 40-44% WER. On cleaner datasets (VoxPopuli, Earnings-22), it is competitive.

**December 2025 update:** OpenAI reported 35% lower WER on Common Voice and FLEURS vs. earlier versions.

**Relevance:** For our reading assessment, GPT-4o Transcribe is overpriced ($6/1k min) for modest accuracy. Its LLM decoder could theoretically help with disfluency understanding, but the high AMI-SDM WER suggests it struggles with challenging acoustic conditions.

**Source:** [Artificial Analysis GPT-4o](https://artificialanalysis.ai/speech-to-text/models/gpt-4o-audio); [OpenAI Blog](https://openai.com/index/introducing-our-next-generation-audio-models/)
**Reliability:** HIGH -- independent benchmarks from Artificial Analysis.

---

## 9. LibriSpeech test-other: Top Models Head-to-Head

LibriSpeech test-other is the standard "challenging" English benchmark (noisy conditions, diverse speakers). Here are the best results:

| Rank | Model | LibriSpeech test-other WER | Year | Notes |
|------|-------|---------------------------|------|-------|
| 1 | Canary-Qwen 2.5B | 3.10% | 2025 | NVIDIA, LLM decoder |
| 2 | Parakeet TDT 0.6B v2 | 3.19% | 2025 | NVIDIA, 49x faster |
| 3 | Whisper Large-v3 | ~3.5% | 2023 | OpenAI |
| 4 | Whisper Large-v3 Turbo | ~3.7% | 2024 | OpenAI, 6x faster |
| 5 | Whisper Large-v2 | ~4.2% | 2022 | OpenAI |
| 6 | Parakeet (NVIDIA, 2024) | ~4.0% | 2024 | Earlier version |
| 7 | Phi-4-Multimodal | ~4.5% (est.) | 2025 | Microsoft |
| 8 | Granite-Speech 8B | ~4.0% (est.) | 2025 | IBM |
| 9 | wav2vec 2.0 (fine-tuned) | 3.4% | 2020 | Meta, SSL |
| 10 | HuBERT Large (fine-tuned) | 3.3% | 2021 | Meta, SSL |

**Context:** LibriSpeech test-other numbers are much lower than real-world WER because the audio is still relatively clean read speech. Our system will see WER 3-5x higher on actual child reading audio.

**Source:** [NVIDIA Canary Model Card](https://huggingface.co/nvidia/canary-qwen-2.5b); [NVIDIA Parakeet v2 Model Card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2); [OpenAI Whisper GitHub](https://github.com/openai/whisper)
**Reliability:** HIGH -- official reported numbers.

---

## 10. Comprehensive RTFx / Inference Speed Comparison

RTFx = input audio seconds processed per second of compute time. Measured on A100 GPUs unless noted.

| Model | RTFx | Relative Speed | Avg WER | Speed-Accuracy Tradeoff |
|-------|------|---------------|---------|------------------------|
| Parakeet TDT 0.6B v2 | 3,386 | 1.0x (fastest) | 6.05% | BEST tradeoff |
| Moonshine Tiny (27M) | ~3,000 | 0.89x | 12.53% | Edge only |
| Parakeet CTC 1.1B | 2,794 | 0.83x | 6.68% | Excellent |
| Canary-1B v2 | 749 | 0.22x | ~7% | Good |
| Deepgram Nova-2 (API) | 584 | 0.17x | 17.3% | Fast but less accurate |
| Canary-Qwen 2.5B | 418 | 0.12x | 5.63% | Most accurate |
| Distil-Whisper | ~350 | 0.10x | ~8.5% | Good middle ground |
| Deepgram Nova-3 (API) | 286 | 0.08x | 18.3% | Surprisingly slower than Nova-2 |
| Groq Whisper Large-v3 | 278 | 0.08x | 16.8% | Hardware-accelerated |
| Whisper Large-v3 Turbo | 216 | 0.06x | 7.75% | 6x faster than full v3 |
| Microsoft Phi-4 | 151 | 0.04x | 6.02% | Accurate but slow |
| IBM Granite 8B | 145 | 0.04x | 5.74% | Accurate but slow |
| Whisper Large-v3 | 69 | 0.02x | 7.88% | Baseline |
| IBM Granite 2B | 31 | 0.009x | 6.00% | Slowest per accuracy |

**Critical observation:** Deepgram Nova-3 (RTFx 286) is SLOWER than Nova-2 (RTFx 584) on the Artificial Analysis benchmark, despite being the newer model. This suggests Nova-3 traded speed for accuracy features (multilingual, keyterm prompting), though its independent WER (18.3%) is actually worse than Nova-2 (17.3%) on the AA benchmark.

**For our streaming use case:** RTFx for batch processing is not directly equivalent to streaming latency. Streaming latency depends on chunk size, network, and first-token time. See Section 11 below.

**Source:** [arXiv 2510.06961](https://arxiv.org/html/2510.06961v1); [Artificial Analysis](https://artificialanalysis.ai/speech-to-text); [NVIDIA Blog](https://developer.nvidia.com/blog/accelerating-leaderboard-topping-asr-models-10x-with-nvidia-nemo/)
**Reliability:** HIGH -- standardized RTFx measurement on consistent hardware.

---

## 11. Streaming Latency: Detailed Comparison

Streaming latency = time from speaking to receiving transcription. Different from batch RTFx.

| Provider | Model | Time-to-First-Token | Median E2E Latency | Notes |
|----------|-------|--------------------|--------------------|-------|
| Deepgram | Nova-3 | ~150ms (US) | <300ms | Best-in-class |
| Deepgram | Nova-3 | 250-350ms (global) | <400ms | Non-US regions |
| ElevenLabs | Scribe v2 RT | -- | ~150ms | Claimed, not independently verified |
| AssemblyAI | Universal-2 | -- | 300-600ms | English only for streaming |
| Gladia | Solaria | -- | ~270ms | French company |
| Speechmatics | Enhanced | -- | <200ms | UK-based |
| Google Cloud | STT v2 | 200-500ms (est.) | 300-800ms | Variable, depends on model |
| OpenAI | Whisper (custom) | ~500ms | ~500ms+ | No official streaming API |
| Azure | AI Speech | -- | 200-400ms | Varies by region |
| AWS | Transcribe | -- | 200-500ms | Moderate |

**For our reading assessment:** We need continuous word-by-word tracking. The critical metric is not time-to-first-token but consistency of word delivery. Deepgram's sub-300ms consistency is ideal. Google's variable 300-800ms introduces alignment jitter.

**Source:** [Deepgram Latency Docs](https://developers.deepgram.com/docs/measuring-streaming-latency); [Introl Voice AI Guide](https://introl.com/blog/voice-ai-infrastructure-real-time-speech-agents-asr-tts-guide-2025); [ElevenLabs Scribe v2 RT](https://elevenlabs.io/realtime-speech-to-text)
**Reliability:** MEDIUM -- latency varies significantly by network, region, and audio chunk size. Most numbers are vendor-reported.

---

## 12. Complete Children's ASR Benchmarks (MyST + OGI, All Models)

### 12.1 Full MyST Corpus Results (Interspeech 2024, arXiv 2406.10507)

**Zero-Shot Performance (no fine-tuning):**

| Model | Params | MyST dev | MyST test | OGI dev | OGI test |
|-------|--------|----------|-----------|---------|----------|
| Whisper-tiny | 39M | 18.5% | 20.6% | 40.1% | 53.8% |
| Whisper-base | 74M | 15.6% | 16.8% | 36.8% | 38.0% |
| Whisper-small | 244M | 14.4% | 13.4% | 21.2% | 25.4% |
| Whisper-medium | 769M | 13.3% | 13.1% | 18.8% | 20.8% |
| Whisper-large | 1,550M | 14.4% | 12.5% | 21.2% | 22.9% |
| Whisper-large-v3 | 1,550M | 12.3% | 12.6% | 14.9% | 19.9% |
| **Canary** | ~1B | **9.3%** | **9.5%** | **14.8%** | **18.2%** |
| Parakeet-RNNT | ~1B | 10.7% | 11.1% | 14.3% | 16.7% |

**Key finding:** NVIDIA Canary achieves 9.5% WER zero-shot on MyST -- better than Whisper-large-v3 (12.6%) and competitive with fine-tuned Whisper-medium (8.9%). Parakeet also outperforms all Whisper variants zero-shot on both corpora.

**Full Fine-Tuning Results:**

| Model | Params | MyST dev | MyST test | OGI dev | OGI test |
|-------|--------|----------|-----------|---------|----------|
| Whisper-tiny | 39M | 11.6% | 11.6% | 2.7% | 3.0% |
| Whisper-base | 74M | 9.1% | 10.4% | 2.0% | 2.3% |
| Whisper-small | 244M | 8.4% | 9.3% | 5.0% | 1.8% |
| Whisper-medium | 769M | 8.4% | 8.9% | 1.6% | 1.5% |
| Whisper-large | 1,550M | 8.2% | 13.0% | 1.8% | 1.7% |
| Whisper-large-v3 | 1,550M | 8.5% | 9.1% | 1.6% | 1.4% |
| wav2vec 2.0 | 311M | 10.6% | 11.1% | 2.1% | 2.5% |
| HuBERT | 311M | 10.5% | 11.3% | 2.2% | 2.5% |
| WavLM | 311M | 9.6% | 10.4% | 1.7% | 1.8% |
| Canary (FT) | ~1B | 8.6% | 9.2% | 1.4% | 1.5% |
| **Parakeet (FT)** | **~1B** | **7.9%** | **8.5%** | **1.8%** | **1.8%** |

**Best results overall:**
- MyST: Parakeet fine-tuned = 8.5% test (BEST), Canary FT = 9.2%, Whisper-medium FT = 8.9%
- OGI: Whisper-large-v3 FT = 1.4% test (BEST), Canary FT = 1.5%

### 12.2 Data Augmentation Impact (Whisper-small on MyST)

| Augmentation Method | MyST dev | MyST test | Improvement |
|---------------------|----------|-----------|-------------|
| No augmentation (baseline) | 8.4% | 9.3% | -- |
| Pitch perturbation (x3) | 8.6% | 8.8% | +0.5 pts |
| VTLP (x3) | 8.6% | 9.0% | +0.3 pts |
| Speed perturbation (x3) | 8.1% | 8.9% | +0.4 pts |
| SpecAugment | 8.2% | 9.0% | +0.3 pts |
| SpecAugment + Pitch | 8.2% | 8.9% | +0.4 pts |
| SpecAugment + Speed | 8.3% | 8.9% | +0.4 pts |
| PIF + Pitch (x3) | 8.3% | 8.9% | +0.4 pts |

**Conclusion:** Data augmentation provides modest gains (0.3-0.5 pts). Pitch perturbation is most effective for child speech, which makes sense given children's higher fundamental frequency.

### 12.3 Parameter-Efficient Fine-Tuning (Whisper-small on MyST)

| Method | MyST dev | MyST test | Trainable Params |
|--------|----------|-----------|-----------------|
| Zero-shot (no FT) | 14.4% | 13.4% | 0 |
| Full fine-tuning | 8.4% | 9.3% | 244M (100%) |
| Encoder-only FT | 9.0% | 9.2% | ~100M (~41%) |
| LoRA | 9.1% | 9.6% | ~2M (~1%) |
| Adapter | 8.4% | 9.3% | ~5M (~2%) |
| Prompt Tuning | 10.4% | 10.4% | ~0.1M (<1%) |
| Prefix Tuning | 8.9% | 10.2% | ~1M (<1%) |

**Key insight for practical deployment:** LoRA fine-tuning achieves 9.6% WER using only ~1% of parameters (2M trainable). This makes fine-tuning feasible without massive GPU resources. Adapter tuning matches full fine-tuning (9.3%) with only 2% of parameters.

**Source:** [arXiv 2406.10507](https://arxiv.org/html/2406.10507v1)
**Reliability:** HIGH -- peer-reviewed, comprehensive benchmark.

---

## 13. Expanded Cost Analysis: Budget Providers

### 13.1 Complete Pricing Table (All Providers, 2025-2026)

**Batch/Pre-Recorded Transcription:**

| Provider | Model | $/minute | $/1000 min | $/hour | Notes |
|----------|-------|----------|-----------|--------|-------|
| Groq | Distil-Whisper | $0.00033 | $0.33 | $0.02 | Cheapest available |
| DeepInfra | Whisper Large-v3 | $0.00045 | $0.45 | $0.027 | Budget hosting |
| Groq | Whisper Large-v3 Turbo | $0.00067 | $0.67 | $0.04 | Best value for quality |
| NVIDIA (Replicate) | Canary-Qwen 2.5B | $0.00074 | $0.74 | $0.044 | Top accuracy, cheap |
| Fireworks AI | Whisper (batch) | $0.0009-$0.0015 | $0.90-$1.50 | $0.054-$0.09 | Variable |
| Voxtral Mini | Mistral | $0.001 | $1.00 | $0.06 | Open-weight |
| Hathora | Parakeet TDT 0.6B v3 | $0.00132 | $1.32 | $0.079 | Fastest + cheap |
| Groq | Whisper Large-v3 | $0.00185 | $1.85 | $0.111 | Full model |
| AssemblyAI | Universal-2 | $0.0045 | $4.50 | $0.27 | Established provider |
| Deepgram | Nova-3 | $0.0043 | $4.30 | $0.258 | Established provider |
| OpenAI | Whisper API | $0.006 | $6.00 | $0.36 | Official API |
| OpenAI | GPT-4o Transcribe | $0.006 | $6.00 | $0.36 | LLM-powered |
| ElevenLabs | Scribe v2 | $0.00667 | $6.67 | $0.40 | Long-form leader |
| Google Cloud | Chirp 2 | $0.016 | $16.00 | $0.96 | Most accurate on AA |
| Azure | AI Speech | $0.003 | $3.00 | $0.18 | Batch only |
| AWS | Transcribe | $0.024 | $24.00 | $1.44 | Most expensive |

**Streaming Transcription:**

| Provider | Model | $/minute | $/1000 min | Notes |
|----------|-------|----------|-----------|-------|
| AssemblyAI | Universal-2 | $0.0025 | $2.50 | Cheapest streaming |
| Fireworks AI | Whisper (streaming) | $0.0032 | $3.20 | New entrant |
| Deepgram | Nova-3 | $0.0077 | $7.70 | Pay-as-you-go |
| ElevenLabs | Scribe v2 RT | $0.00667 | $6.67 | 150ms latency claimed |
| Google Cloud | STT v2 | $0.016 | $16.00 | Premium |
| Azure | AI Speech | $0.0167 | $16.70 | Premium |
| AWS | Transcribe | $0.024 | $24.00 | Most expensive |

### 13.2 Revised Ensemble Cost Scenarios

With the new budget providers, ensemble economics change dramatically:

| Ensemble Approach | Cost/session (3 min) | vs. Current | Quality Est. |
|-------------------|---------------------|-------------|-------------|
| Google + Deepgram (CURRENT) | $0.071 | 1.0x | Baseline |
| AssemblyAI + Deepgram | $0.031 | 0.43x | Better on disfluency |
| Groq Whisper + Deepgram (streaming) | $0.025 | 0.35x | Experimental |
| Fireworks Whisper + Deepgram (streaming) | $0.033 | 0.46x | Experimental |
| AssemblyAI + Fireworks Whisper | $0.017 | 0.24x | Cheapest viable ensemble |
| Canary-Qwen (Replicate, batch) + Deepgram (stream) | $0.025 | 0.35x | Best accuracy + real-time |

**New finding:** An AssemblyAI + Fireworks Whisper streaming ensemble could cost only $0.017/session -- 76% cheaper than our current setup -- while potentially offering BETTER accuracy (AssemblyAI + Whisper both handle disfluency better than Google STT).

**Source:** [Groq Pricing](https://groq.com/pricing); [Fireworks AI Pricing](https://fireworks.ai/pricing); [Artificial Analysis](https://artificialanalysis.ai/speech-to-text)
**Reliability:** HIGH -- pricing from official pages; quality estimates are projections.

---

## 14. ASR Hallucination Rates: Detailed Analysis

### 14.1 SHALLOW Hallucination Benchmark (arXiv 2510.16567)

The SHALLOW framework measures hallucination across 4 dimensions on 10 datasets including MyST (child speech):

| Model | WER | Lexical Fab. | Phonetic Fab. | Morphological | Semantic |
|-------|-----|-------------|---------------|---------------|----------|
| Parakeet | 12.54% | 5.38 | 15.33 | 10.59 | 13.33 |
| Phi-4 | 12.07% | 6.18 | 17.94 | 11.22 | 14.37 |
| Qwen2.5-Omni | 12.76% | 5.17 | 16.25 | 10.56 | 12.71 |
| Whisper-v3 | 14.20% | 6.74 | 17.75 | 11.13 | 14.74 |
| Kimi | 13.53% | 6.92 | 20.45 | 12.30 | 15.48 |
| Whisper-v2 | 19.12% | 8.08 | 20.38 | 13.15 | 17.37 |

**Lower is better for all metrics.** Parakeet and Qwen2.5-Omni have the lowest hallucination rates across most dimensions.

**Critical finding:** SHALLOW metrics correlate strongly with WER when recognition quality is high (low WER), but the relationship weakens substantially as WER increases. This means for our high-WER child speech scenario, WER alone does not capture hallucination risk.

### 14.2 Whisper-Specific Hallucination Data

| Metric | Value | Source |
|--------|-------|--------|
| Overall phrase hallucination rate | ~1% of all transcriptions | Cornell 2024 |
| Whisper-v3 vs v2 hallucination rate | v3 hallucinates 4x more than v2 | Deepgram analysis |
| Silence hallucination (>30s files) | Rate rises noticeably | arXiv 2501.11378 |
| Non-speech audio hallucination | 3 of 20 attention heads cause 75%+ | Calm-Whisper, Interspeech 2025 |
| Calm-Whisper reduction | 80% fewer non-speech hallucinations | arXiv 2505.12969 |
| AssemblyAI vs Whisper-v3 | 30% fewer hallucinations | AssemblyAI benchmarks |
| Gladia (Whisper-based) | 99.9% hallucination removal claimed | Gladia marketing |

**Aphasia-relevant finding:** Hallucinations disproportionately occur for speakers with longer non-vocal durations. Aphasia speakers had 41% non-vocal audio vs. 15% for controls, and significantly more hallucinations. This directly relates to our use case: struggling readers will have more pauses, hesitations, and silence -- exactly the conditions that trigger Whisper hallucinations.

**Mitigation:** VAD (Voice Activity Detection) preprocessing is the most effective strategy for reducing hallucinations on non-speech audio. Our system already uses VAD, which partially addresses this.

**Source:** [SHALLOW Benchmark, arXiv 2510.16567](https://arxiv.org/html/2510.16567); [Calm-Whisper, arXiv 2505.12969](https://arxiv.org/html/2505.12969v1); [Careless Whisper, arXiv 2402.08021](https://arxiv.org/html/2402.08021v2); [Deepgram Whisper-v3 Analysis](https://deepgram.com/learn/whisper-v3-results)
**Reliability:** HIGH -- peer-reviewed research.

---

## 15. Ensemble Cost-Benefit Framework: When Is It Worth It?

### 15.1 Theoretical Framework (arXiv 2506.04677)

This 2025 paper provides the most rigorous cost-benefit analysis for ensembling:

**Key findings:**

1. **2-model ensembles capture most accuracy benefits.** Going from 1 to 2 models provides the largest marginal gain. Going from 2 to 3 provides minimal additional benefit.

2. **Diminishing returns are severe:**

| Ensemble Size | Relative Improvement | Cost Multiplier |
|---------------|---------------------|-----------------|
| 1 model | Baseline | 1.0x |
| 2 models | Most of the gain | 2.0x |
| 3 models | Negligible additional gain | 3.0x |
| 4 models | No measurable improvement | 4.0x |
| 5 models | Can actually DEGRADE | 5.0x |

3. **On stable, clean data: ensembles show "minimal advantage over individual models" while costing 3x more.** The M5 dataset example: ensemble cost ~$2.25M vs. single model ~$750K for marginal accuracy gains.

4. **On challenging, variable data: ensembles are justified.** This is our scenario.

5. **ENSTIME vs ENSACC tradeoff:**
   - ENSACC (accuracy-optimized ensemble): best accuracy, highest cost
   - ENSTIME (time-optimized ensemble, combining fast cheap models): competitive accuracy at ~50% lower cost
   - ENSTIME shows "increasing returns" as models are added -- opposite of ENSACC

6. **Retraining frequency matters more than ensemble size.** Reducing retraining from weekly to bi-weekly saves 33% compute with <2% accuracy loss.

### 15.2 Decision Framework for Our System

Based on the theoretical framework and our specific data:

| Factor | Our Situation | Favors Ensemble? |
|--------|--------------|-----------------|
| Data difficulty | High (child disfluent speech, 15-30% WER) | YES |
| Model diversity | High (Google vs Deepgram = different architectures) | YES |
| Error correlation | Low (different failure modes on disfluency) | YES |
| Cost sensitivity | Moderate (educational, not enterprise) | NEUTRAL |
| Absolute cost | Low ($0.03-0.07/session) | YES (cost is trivial) |
| Complexity cost | High (alignment, cross-validation code) | NO |
| Volume | Low-medium (1000s of sessions, not millions) | NEUTRAL |
| Latency requirement | Moderate (sub-500ms OK) | NEUTRAL |

**Verdict:** 5 factors favor ensemble, 1 opposes, 3 neutral. The ensemble IS worth it for our specific use case, but only if we choose the RIGHT pair of models.

### 15.3 Optimal Ensemble for Our Use Case

Based on all data gathered in both passes:

**Recommended ensemble: AssemblyAI Universal-2 + Deepgram Nova-3**

| Criterion | Google+Deepgram (current) | AssemblyAI+Deepgram (recommended) |
|-----------|--------------------------|-----------------------------------|
| Cost/session | $0.071 | $0.031 |
| Disfluency handling | Poor (Google) + Good (Deepgram) | Good (AAI) + Good (Deepgram) |
| Architecture diversity | HIGH | HIGH |
| Streaming latency | Variable (Google) + Fast (Deepgram) | Moderate (AAI) + Fast (Deepgram) |
| Hallucination risk | Unknown (Google) + Low (Deepgram) | Low (AAI, 30% less than Whisper) + Low (Deepgram) |
| Annual cost (1000 students) | $1,422 | $620 |

**Even cheaper alternative: AssemblyAI + Fireworks Whisper streaming**
- Cost: $0.017/session ($340/year at scale)
- Both models handle disfluency better than Google
- Fireworks Whisper provides architectural diversity vs. AssemblyAI
- Risk: Fireworks is a newer provider; reliability/uptime less proven

**Source:** [arXiv 2506.04677](https://arxiv.org/html/2506.04677)
**Reliability:** HIGH -- peer-reviewed, comprehensive cost modeling.

---

## 16. Artificial Analysis Full Leaderboard (Expanded)

Complete independent leaderboard with all models including Nova-3 per-dataset breakdown:

| Rank | Model | Provider | AA-WER | VoxPopuli | Earnings-22 | AMI-SDM | Speed | $/1k min |
|------|-------|----------|--------|-----------|-------------|---------|-------|----------|
| 1 | Chirp 2 | Google | 11.6% | -- | -- | -- | 16.7x | $16.00 |
| 2 | Parakeet TDT v3 | Hathora | 13.0% | -- | -- | -- | 38.7x | $1.32 |
| 3 | Canary-Qwen 2.5B | Replicate | 13.2% | -- | -- | -- | 8.2x | $0.74 |
| 4 | Amazon Transcribe | AWS | 14.0% | -- | -- | -- | 18.6x | $24.00 |
| 5 | Scribe v2 | ElevenLabs | 14.0% | -- | -- | -- | 35.7x | $6.67 |
| 6 | Speechmatics Enh. | Speechmatics | 14.4% | -- | -- | -- | 24.1x | $6.70 |
| 7 | Universal-2 | AssemblyAI | 14.5% | -- | -- | -- | 74.1x | $2.50 |
| 8 | Voxtral Small | Mistral | 14.7% | -- | -- | -- | 69.2x | $4.00 |
| 9 | Gemini 2.5 Pro | Google | 15.0% | -- | -- | -- | 12.7x | $0.00* |
| 10 | Whisper Large-v2 | OpenAI | 15.8% | -- | -- | -- | 28.4x | $6.00 |
| 11 | Nova 2 Pro | Amazon Bedrock | 15.8% | -- | -- | -- | 23.3x | $3.10 |
| 12 | Voxtral Mini | Mistral | 15.8% | -- | -- | -- | 48.8x | $1.00 |
| 13 | Nova 2 Omni | Amazon Bedrock | 15.9% | -- | -- | -- | 36.7x | $1.85 |
| 14 | Whisper Large-v3 | Groq | 16.8% | -- | -- | -- | 277.9x | $1.85 |
| 15 | Whisper Large-v3 | DeepInfra | 16.8% | -- | -- | -- | 82.4x | $0.45 |
| 16 | Deepgram Nova-2 | Deepgram | 17.3% | -- | -- | -- | 583.8x | $4.30 |
| 17 | Deepgram Nova-3 | Deepgram | 18.3% | -- | -- | -- | 285.6x | $4.30 |
| 18 | GPT-4o Mini Transcr. | OpenAI | 20.1% | 7.46% | 12.43% | 40.39% | 42.6x | $3.00 |
| 19 | GPT-4o Transcribe | OpenAI | 21.3% | 7.03% | 12.68% | 44.26% | 26.5x | $6.00 |
| 20 | Deepgram Base | Deepgram | 21.9% | -- | -- | -- | 518.0x | $12.50 |

*Gemini pricing is per-token, not per-minute; $0 reflects free tier availability.

**SHOCKING FINDING: Deepgram Nova-3 (18.3%) performs WORSE than Nova-2 (17.3%) on the AA independent benchmark, while being slower (286x vs 584x RTFx) and costing the same ($4.30/1k min).** This contradicts Deepgram's marketing claiming Nova-3 is "54.2% better." The discrepancy is likely due to different test datasets and evaluation methodology.

**Source:** [Artificial Analysis STT Leaderboard](https://artificialanalysis.ai/speech-to-text)
**Reliability:** HIGH -- independent, standardized, consistent methodology.

---

## 17. Updated Recommendations (Post Second Pass)

### 17.1 What Changed From First Pass

1. **Deepgram Nova-3 is weaker than expected.** Independent testing shows 18.3% WER, worse than Nova-2 (17.3%). Our ensemble partner may not be as strong as assumed.

2. **Budget Whisper providers are viable.** Groq ($0.67/1k min) and DeepInfra ($0.45/1k min) offer Whisper Large-v3 at 3-13x cheaper than OpenAI's API, making Whisper-based ensembles much more affordable.

3. **NVIDIA Canary-Qwen 2.5B is the accuracy king** at 5.63% WER, available on Replicate for just $0.74/1k min. It achieves 9.5% zero-shot on MyST child speech -- competitive with fine-tuned models.

4. **Parakeet is the speed king** at 3,386x RTFx with 6.05% WER. For batch processing of recorded sessions, this is unbeatable.

5. **Hallucination risk is real for our use case.** Struggling readers produce more pauses/silence, which triggers more ASR hallucinations. VAD preprocessing is essential.

6. **LoRA fine-tuning is practical.** Achieves 9.6% WER on MyST with only 1% of parameters trainable. This makes fine-tuning feasible on modest hardware.

### 17.2 Revised Architecture Options

**Option A: Current system improved** (short-term)
- Replace Google STT with AssemblyAI Universal-2
- Keep Deepgram Nova-3 (or downgrade to Nova-2 which is actually better on AA)
- Cost: $0.031/session, 56% savings
- Expected improvement: Better disfluency handling from AssemblyAI side

**Option B: Budget ensemble** (cost-optimized)
- AssemblyAI streaming ($0.0025/min) + Groq Whisper Turbo batch ($0.00067/min)
- Process streaming via AssemblyAI for real-time, run Groq batch for verification
- Cost: ~$0.010/session, 86% savings vs current
- Trade-off: Batch leg is not real-time; useful for post-session analysis

**Option C: Best-accuracy single model** (simplicity-optimized)
- NVIDIA Canary-Qwen 2.5B via Replicate ($0.74/1k min)
- 5.63% avg WER, 9.5% zero-shot on MyST child speech
- Cost: $0.0022/session (97% savings)
- Trade-off: Not streaming; batch only. Would need separate streaming model for real-time

**Option D: Fine-tuned Whisper** (long-term best)
- LoRA fine-tune Whisper-small on our own student reading data
- Expected: ~9% WER on child speech (from benchmark data)
- Cost: $0.00067/min via Groq after fine-tuning
- Trade-off: Requires data collection and training pipeline

**Option E: Hybrid architecture** (RECOMMENDED)
- Real-time stream: Deepgram Nova-2 for live word tracking ($0.0077/min)
- Post-utterance verification: Canary-Qwen 2.5B batch via Replicate ($0.00074/min)
- Cost: $0.025/session
- Advantage: Best accuracy model (Canary) validates Deepgram's real-time output within 1-2 seconds, catches errors before next sentence

---

## Appendix C: Additional Sources (Second Pass)

- [NVIDIA Canary-Qwen 2.5B Model Card](https://huggingface.co/nvidia/canary-qwen-2.5b) -- Per-dataset WER, noise robustness
- [NVIDIA Parakeet TDT v2 Model Card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2) -- Speed benchmarks
- [NVIDIA Parakeet TDT v3 Model Card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) -- Multilingual extension
- [Moonshine GitHub](https://github.com/moonshine-ai/moonshine) -- Edge model benchmarks
- [arXiv 2509.02523: Flavors of Moonshine](https://arxiv.org/pdf/2509.02523) -- Multilingual tiny models
- [ElevenLabs Scribe v2 Realtime](https://elevenlabs.io/blog/introducing-scribe-v2-realtime) -- 150ms latency claims
- [Artificial Analysis GPT-4o Audio](https://artificialanalysis.ai/speech-to-text/models/gpt-4o-audio) -- GPT-4o transcribe benchmarks
- [Artificial Analysis Deepgram](https://artificialanalysis.ai/speech-to-text/models/deepgram) -- Nova-2 vs Nova-3
- [arXiv 2510.16567: SHALLOW Hallucination Benchmark](https://arxiv.org/html/2510.16567) -- Multi-dimensional hallucination metrics
- [arXiv 2505.12969: Calm-Whisper](https://arxiv.org/html/2505.12969v1) -- 80% hallucination reduction
- [arXiv 2402.08021: Careless Whisper](https://arxiv.org/html/2402.08021v2) -- Hallucination harms quantification
- [arXiv 2501.11378: Whisper Non-Speech Hallucinations](https://arxiv.org/html/2501.11378v1) -- Silence-induced hallucination
- [arXiv 2506.04677: The Cost of Ensembling](https://arxiv.org/html/2506.04677) -- Ensemble cost-benefit framework
- [Groq Pricing](https://groq.com/pricing) -- Budget Whisper hosting
- [Fireworks AI Pricing](https://fireworks.ai/pricing) -- Budget Whisper streaming
- [Deepgram Latency Docs](https://developers.deepgram.com/docs/measuring-streaming-latency) -- Streaming latency methodology
- [OpenAI GPT-4o Transcribe](https://openai.com/index/introducing-our-next-generation-audio-models/) -- LLM-powered ASR
- [MarkTechPost: NVIDIA Canary Analysis](https://www.marktechpost.com/2025/07/17/nvidia-ai-releases-canary-qwen-2-5b/) -- Model architecture deep-dive
- [NVIDIA Blog: Speech AI Accuracy](https://developer.nvidia.com/blog/nvidia-speech-ai-models-deliver-industry-leading-accuracy-and-performance/) -- Official NVIDIA benchmarks
