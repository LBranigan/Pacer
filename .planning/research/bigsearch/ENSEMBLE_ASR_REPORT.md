# Ensemble ASR for Real-Time Reading Assessment: Technical Research Report

**Date:** 2026-02-06
**Context:** GoogSTT reading assessment tool for struggling middle schoolers
**Research Corpus:** 4,486 lines across 4 parallel research agents, 50+ papers, 150+ tool calls
**Goal:** Identify the 3 most promising ensemble strategies to test

---

## Executive Summary

After surveying 50+ papers (InterSpeech 2024-2025, ICASSP 2024-2025, ICLR 2025, NeurIPS 2025), commercial benchmarks, and open-source implementations, three ensemble strategies stand out for our reading assessment use case. Critically, **the biggest single win isn't ensembling at all — it's contextual biasing** (providing the known passage text to the ASR model), which alone delivers 20-50% WER reduction. The strategies below build on top of that foundation.

### The 3 Strategies at a Glance

| # | Strategy | Expected WER Gain | Cost Impact | Implementation Complexity |
|---|----------|-------------------|-------------|--------------------------|
| 1 | **Confidence-Based Cascading** | 10-16% relative WERR | 57-63% savings vs always-both | Low-Medium |
| 2 | **SpeechLLM Fusion** | 29-47% relative WERR | Moderate (LLM inference cost) | Medium-High |
| 3 | **Prompted CrisperWhisper** | 20-50% relative WERR | Low (self-hosted Whisper) | Medium |

---

## Critical Context: The Disfluency Problem

Before choosing a strategy, understand the landscape of ASR on disfluent child speech:

| Model | Fluent WER | Disfluent WER | Disfluency Gap |
|-------|-----------|---------------|----------------|
| Whisper Large-v3 | 6.3% | 12.1% | +5.8pp |
| Google Cloud STT | 6.9% | 27.5% | **+20.6pp** |
| Azure | 7.3% | 16.8% | +9.5pp |
| Rev.AI | 15.9% | 26.3% | +10.4pp |
| wav2vec 2.0 | 10.1% | 38.0% | +27.9pp |

*Source: "Lost in Transcription" (arXiv:2405.06150)*

**Key finding:** Google STT has the **worst** disfluency gap of all tested models (+20.6pp). It is the weakest link in our current ensemble for the exact scenario where we need it most.

**On child speech specifically (MyST corpus):**
- Adult-trained Whisper: 13-15% WER
- Kid-Whisper (fine-tuned): 8.9% WER
- NVIDIA Canary-Qwen (zero-shot): 9.5% WER
- LoRA fine-tuning (1% params): 9.6% WER

---

## Strategy 1: Confidence-Based Cascading with Agreement Routing

### Concept
Don't run all engines on all audio. Use a cheap, fast engine (Deepgram) for everything, and only trigger an expensive engine when the cheap one is uncertain. This is the **most practical, immediately implementable** strategy.

### Key Research

**AutoMode-ASR** (arXiv:2409.12476, Sept 2024)
- Trains a lightweight XGBoost classifier to select the optimal ASR engine per audio segment
- Uses Deepgram-style confidence scores as the most important routing feature
- Results: **16.2% relative WER reduction, 65% cost savings, 75% speed improvement**
- Works with commercial black-box ASR APIs — no model internals needed
- Router overhead: negligible (<10ms for XGBoost classification)

**FrugalML** (NeurIPS 2020, arXiv:2006.07512)
- Directly tested on speech recognition API routing (Google, Amazon, Microsoft, IBM, Baidu)
- Achieves **90% cost reduction** while matching best-API accuracy
- Open source: github.com/lchen001/FrugalML

**Agreement-Based Cascading (ABC)** (arXiv:2407.02348)
- Training-free, black-box compatible
- Routing signal: **do the two engines agree?** If yes, accept. If no, escalate.
- Sidesteps the confidence calibration problem entirely
- Achieves **22-25x cost reduction**, needs only ~100 validation samples

### Proposed Implementation (3-Tier)

```
Tier 1: Deepgram Nova (streaming, ~150ms)
    |
    +-- Word confidence < 0.85? OR interim instability detected?
    |
    No (75-80% of segments) --> Accept Deepgram output
    |
    Yes (20-25%) --> Escalate to Tier 2
    |
Tier 2: Google STT with passage phrase hints (boost=5-10)
    |
    +-- Deepgram and Google agree?
    |
    Yes (15%) --> Accept (high confidence)
    |
    No (5-10%) --> Escalate to Tier 3
    |
Tier 3: CrisperWhisper (verbatim + timestamps)
    --> Align to expected text
    --> Classify specific miscue types
```

### Routing Signals Already Available in Our System

| Signal | Source | Cost to Implement |
|--------|--------|-------------------|
| Word-level confidence | Deepgram API (already returned) | Zero |
| Interim result instability | Track Deepgram WebSocket `is_final` updates | Low |
| Long pauses / hesitations | Our existing VAD pipeline | Zero |
| Deviation from expected text | Alignment with reference passage | Medium |
| Google STT phrase hint mismatch | Compare boosted vs unboosted | Medium |

### Cost Projection

| Approach | Cost/session (3 min) | Annual (1000 students x 20 sessions) |
|----------|---------------------|--------------------------------------|
| Current (Google + Deepgram always) | $0.071 | $1,422 |
| Cascading (75/15/10 split) | $0.030 | ~$600 |
| **Savings** | **58%** | **~$820/year** |

### Key References
- AutoMode-ASR: https://arxiv.org/abs/2409.12476
- FrugalML: https://arxiv.org/abs/2006.07512 | github.com/lchen001/FrugalML
- ABC Cascading: https://arxiv.org/abs/2407.02348
- RouteLLM (adaptable framework): https://arxiv.org/abs/2406.18665 | github.com/lm-sys/RouteLLM
- Deepgram interim results docs: https://developers.deepgram.com/docs/interim-results
- Google STT adaptation/phrase hints: https://docs.cloud.google.com/speech-to-text/docs/adaptation-model

---

## Strategy 2: SpeechLLM Fusion (Multi-ASR + LLM Arbitration)

### Concept
Instead of ROVER-style word voting, feed multiple ASR outputs (and optionally raw audio) to an LLM that arbitrates the best transcription. The LLM uses language understanding and acoustic evidence jointly.

### Key Research

**Multi-ASR SpeechLLM Fusion** (Prakash et al., InterSpeech 2025, arXiv:2506.11089)
Three architectures compared:
1. Traditional ROVER ensemble: WER 14.36% → good but limited
2. Textual LLM fusion (Llama 3.2 processes confusion networks): WER 11.60%
3. **SpeechLLM fusion (Qwen2-Audio + audio + text)**: WER **9.30%** — best by far

The SpeechLLM approach outperforms ROVER because it considers both acoustic evidence AND text hypotheses jointly, avoiding error propagation.

**GenSEC Challenge / N-best LLM Correction** (NVIDIA, arXiv:2409.09785)
- LLaMA2-7B corrects Whisper output: 11.82% → **8.33% WER** (**29.5% relative improvement**)
- Works by feeding N-best ASR hypotheses to an LLM with constrained decoding
- GPT-4 with zero-shot correction matches fine-tuned T5 on N-best lists

**Confidence-Guided LLM Correction for Disordered Speech** (arXiv:2509.25048)
- Embeds word-level confidence scores into LLM prompts during fine-tuning
- **47% relative WER reduction on TORGO** (dysarthric speech)
- **10% relative reduction on spontaneous speech**
- Directly addresses our disfluent speech scenario

**Generative Fusion Decoding (GFD)** (ACL 2025, arXiv:2405.14259)
- Open-source, plug-and-play framework: github.com/mtkresearch/generative-fusion-decoding
- Integrates LLMs into ASR during decoding (not post-processing)
- Operates across mismatched token spaces via byte-level likelihood
- Up to **17.7% WER reduction** through in-context learning
- No retraining needed — works with any autoregressive ASR model

### Proposed Implementation

```
Step 1: Collect hypotheses
    Deepgram N-best (from streaming)
    Google STT N-best (with phrase hints)

Step 2: Build confusion network
    Word-level alignment of all hypotheses
    Include per-word confidence scores from each engine

Step 3: LLM arbitration
    Option A (fast): Fine-tuned T5/LLaMA on N-best correction
    Option B (best): Qwen2-Audio with raw audio + confusion network
    Option C (practical): GPT-4 zero-shot with confidence-annotated hypotheses

Step 4: Output
    Corrected transcription with word-level uncertainty markers
```

### Critical Warning from CHSER Research
Text-only LLM correction **worsens** child-specific disfluency handling (CHSER dataset, InterSpeech 2025, arXiv:2505.18463). The LLM "corrects" disfluencies into fluent text, destroying the signal we need. **The LLM correction MUST be acoustic-aware** (SpeechLLM approach) or explicitly instructed to preserve disfluency markers.

### WER Expectations

| Approach | Expected WERR on Disfluent Child Speech |
|----------|----------------------------------------|
| ROVER (baseline ensemble) | 10-20% relative |
| N-best T5 correction | 20-25% relative |
| GPT-4 zero-shot on N-best | 25-30% relative |
| Confidence-guided LLM (fine-tuned) | 30-47% relative |
| SpeechLLM fusion (Qwen2-Audio) | 35-50% relative |

### Key References
- Multi-ASR SpeechLLM: https://arxiv.org/abs/2506.11089
- GenSEC Challenge: https://arxiv.org/abs/2409.09785
- Confidence-Guided Correction: https://arxiv.org/abs/2509.25048
- GFD (open-source): https://arxiv.org/abs/2405.14259 | github.com/mtkresearch/generative-fusion-decoding
- N-best T5: https://arxiv.org/abs/2303.00456
- CHSER (child speech): https://arxiv.org/abs/2505.18463
- Qwen2-Audio: https://arxiv.org/abs/2407.10759

---

## Strategy 3: Prompted CrisperWhisper with Passage-Aware Decoding

### Concept
The most impactful single change: since we **know the passage** the student is reading, feed it directly into the ASR model as context. This alone can reduce WER by 20-50%. Combined with a disfluency-aware Whisper variant (CrisperWhisper), this becomes a specialized heavy engine for reading assessment.

### Key Research

**Prompted Whisper for Miscue Detection** (Apple ML Research, InterSpeech 2025, arXiv:2505.23627)
- Target reading text is tokenized and prepended to Whisper's decoder input
- Vocabulary augmented with special miscue tokens: `<omit>`, `<substitute>`, `<insert>`
- Model simultaneously generates **verbatim transcription AND miscue annotations**
- WER below 15% across configurations; Macro-F1 0.44+ for miscue detection
- Post-hoc calculated miscues from verbatim transcripts outperformed direct predictions

**PromptASR** (arXiv:2309.07414, 2024)
- Content prompts (target text) injected via cross-attention into Zipformer encoder
- **21.9% relative WER reduction on book reading** (our exact scenario)
- 10.3% overall improvement; largest gains on known-text scenarios

**CrisperWhisper** (arXiv:2408.16589 | github.com/nyrahealth/CrisperWhisper)
- Open-source Whisper variant optimized for verbatim transcription
- Handles filled pauses ('uh', 'um'), false starts, repetitions, partial words
- Timestamp F1: **84.7%** vs 76.7% (WhisperX) on standard data
- Noise robustness: **79.5%** vs 59.0% (WhisperX) — critical for classrooms
- AMI WER: **9.72%** vs 16.82% (standard Whisper)

**Contextual Biasing / Phrase Hints**
- Google STT supports `PhraseSet` with boost parameter (5-10 recommended)
- Qwen3-ASR has built-in contextual biasing feature
- Adaptive Context Biasing (PMC12328576): inference-time vocabulary adaptation

**Complementary Model Strengths for Miscue Detection** (arXiv:2406.07060)

| Model | Strength | Metric |
|-------|----------|--------|
| Wav2Vec2 Large | Catches most errors | Recall = 0.83 |
| Whisper Large-v2 | Fewer false alarms | Precision = 0.52, WER = 9.8% |
| HuBERT Large | Best phoneme accuracy | PER = 23.1% |

An ensemble leveraging all three creates a multi-resolution miscue detection system.

### Proposed Implementation

```
Phase 1 (immediate): Contextual Biasing
    - Add passage text as phrase hints to Google STT (boost=7)
    - Expected: 15-20% WER improvement, zero additional cost

Phase 2 (short-term): CrisperWhisper as Heavy Engine
    - Deploy CrisperWhisper (self-hosted, GPU)
    - Use as Tier 3 engine in the cascading strategy
    - Gets verbatim transcription + accurate timestamps on hard segments

Phase 3 (medium-term): Prompted Whisper for Miscue Detection
    - Fine-tune Whisper with passage prompting (Apple approach)
    - Add miscue tokens to vocabulary (<omit>, <substitute>, <insert>)
    - Single model outputs both transcription AND miscue classification

Phase 4 (long-term): SpeechLLM Reading Assessment
    - Qwen2-Audio or similar multimodal model
    - Input: raw audio + passage text + N-best from streaming engines
    - Output: verbatim transcription, miscue annotations, fluency scores
```

### Expected WER Trajectory (Known Passage)

| Stage | Expected WER |
|-------|-------------|
| Baseline Whisper (no adaptation) | 13-15% |
| + Contextual biasing (passage as prompt) | 8-10% |
| + Child speech fine-tuning (LoRA, 1% params) | 6-8% |
| + MBR decoding (4-8 samples) | 5-6% |
| + SpeechLLM fusion (audio + text) | 3-5% |
| + CTC forced alignment verification | <3% effective |

### Key References
- Prompted Whisper (Apple): https://arxiv.org/abs/2505.23627
- PromptASR: https://arxiv.org/abs/2309.07414
- CrisperWhisper: https://arxiv.org/abs/2408.16589 | github.com/nyrahealth/CrisperWhisper
- Reading Miscue Detection: https://arxiv.org/abs/2406.07060
- Two-Pass Miscue System: https://www.isca-archive.org/interspeech_2024/gothi24_interspeech.html
- KidSpeak (multi-purpose child ASR): https://arxiv.org/abs/2512.05994
- CHSER Dataset: https://arxiv.org/abs/2505.18463
- Disfluency-Aware LM: https://www.isca-archive.org/interspeech_2025/vidal25_interspeech.pdf

---

## Immediate Action Items

### Priority 1: Zero-Cost Quick Wins (this week)
1. **Add passage text as phrase hints to Google STT** (boost=7). Our system knows the target text — this is free accuracy.
2. **Track Deepgram interim confidence instability** in the existing WebSocket handler. Log segments where confidence fluctuates > 0.2 between interim results.
3. **Log engine agreement rate** — what % of words do Google STT and Deepgram agree on? This tells us how much headroom ensembling provides.

### Priority 2: Replace Google STT (next sprint)
Google STT is our weakest link on disfluent speech (+20.6pp gap) and our most expensive engine ($0.016/min). Replace with:
- **AssemblyAI Universal-2** ($0.0025/min streaming, 14.5% WER, 30% fewer hallucinations than Whisper)
- OR **NVIDIA Canary-Qwen 2.5B** via Replicate ($0.00074/min batch, 5.63% WER, #1 on Open ASR Leaderboard)

### Priority 3: Implement Cascading Router (next month)
Start with simple confidence threshold (Tier 1 only):
- Deepgram word confidence < 0.85 → trigger second engine
- Expected to handle 75-80% of segments with cheap engine alone

### Priority 4: Deploy CrisperWhisper (next quarter)
Self-hosted heavy engine for the hardest 5-10% of segments:
- Verbatim transcription preserving all disfluencies
- Accurate word-level timestamps via trained attention alignment
- Open-source, ready to deploy

### Priority 5: Fine-tune for Children (long-term)
- LoRA fine-tune Whisper on MyST child speech dataset (achieves 9.6% WER with 1% params)
- Add passage prompting (Apple approach) for end-to-end miscue detection
- Build child reading assessment training data from our own system logs

---

## Key Benchmark Data

### ASR Provider Comparison (Independent Testing, 2025-2026)

| Provider | Model | Avg WER | Streaming | $/1000 min | Best For |
|----------|-------|---------|-----------|-----------|----------|
| Google | Chirp 2 | 11.6% | Yes | $16.00 | Accuracy (clean speech) |
| Hathora | Parakeet TDT v3 | 13.0% | No | $1.32 | Speed + accuracy |
| Replicate | Canary-Qwen 2.5B | 13.2% | No | $0.74 | Best accuracy overall |
| AssemblyAI | Universal-2 | 14.5% | Yes | $2.50 | Best streaming value |
| ElevenLabs | Scribe v2 | 14.0% | Yes | $6.67 | Low latency |
| Groq | Whisper Large-v3 Turbo | ~16% | No | $0.67 | Budget batch |
| Deepgram | Nova-2 | 17.3% | Yes | $4.30 | Ultra-low latency |
| Deepgram | Nova-3 | 18.3% | Yes | $4.30 | (Nova-2 actually better on AA) |

*Source: Artificial Analysis independent benchmark (artificialanalysis.ai/speech-to-text)*

### Ensemble Cost Scenarios

| Approach | Cost/session | vs Current | Notes |
|----------|-------------|-----------|-------|
| Google + Deepgram (current) | $0.071 | baseline | Google weakest on disfluency |
| AssemblyAI + Deepgram | $0.031 | -56% | Both better on disfluency |
| Cascaded (75/15/10 split) | $0.030 | -58% | Best cost-accuracy tradeoff |
| AssemblyAI + Fireworks Whisper | $0.017 | -76% | Budget ensemble |
| Canary-Qwen batch + Deepgram stream | $0.025 | -65% | Best accuracy + real-time |
| Fine-tuned Whisper via Groq | $0.002 | -97% | Requires training pipeline |

### Hallucination Risk (Critical for Disfluent Speech)

Struggling readers produce more pauses/silence, which triggers ASR hallucinations:

| Model | Hallucination Rate | Notes |
|-------|-------------------|-------|
| Whisper v3 | 4x more than v2 | Silence-induced hallucination |
| AssemblyAI | 30% fewer than Whisper | Best for our use case |
| Parakeet | Lowest lexical fabrication | Best overall hallucination profile |
| Calm-Whisper | 80% fewer non-speech hallucinations | Attention head modification |

**Mitigation:** Our existing VAD preprocessing already helps. Ensemble disagreement is the strongest hallucination detection signal.

---

## Open-Source Tools to Evaluate

| Tool | Purpose | URL |
|------|---------|-----|
| CrisperWhisper | Verbatim ASR + disfluency | github.com/nyrahealth/CrisperWhisper |
| GFD | Plug-and-play ASR+LLM fusion | github.com/mtkresearch/generative-fusion-decoding |
| FrugalML | ASR API routing | github.com/lchen001/FrugalML |
| RouteLLM | Model routing framework | github.com/lm-sys/RouteLLM |
| NIST SCTK | ROVER implementation | github.com/usnistgov/SCTK |
| CTC-Forced-Aligner | Alignment for reading assessment | github.com/MahmoudAshraf97/ctc-forced-aligner |
| Kid-Whisper | Child speech ASR | github.com/C3Imaging/whisper_child_asr |
| MBR for ASR | Minimum Bayes Risk decoding | github.com/CyberAgentAILab/mbr-for-asr |
| ESPnet | Full ASR toolkit (MoE, lattice) | github.com/espnet/espnet |
| whisper-timestamped | DTW timestamps + confidence | github.com/linto-ai/whisper-timestamped |

---

## Full Reference List (50+ sources)

### Ensemble Methods
1. ROVER (Fiscus, 1997): https://ieeexplore.ieee.org/document/659110/
2. Multi-ASR SpeechLLM Fusion (InterSpeech 2025): https://arxiv.org/abs/2506.11089
3. SKIP-SALSA / SALSA (IBM, InterSpeech 2024-2025): https://arxiv.org/abs/2408.16542
4. GFD (ACL 2025): https://arxiv.org/abs/2405.14259
5. Confidence-Based Ensemble (LREC-COLING 2024): https://aclanthology.org/2024.lrec-main.547.pdf
6. MBR Decoding for ASR: https://arxiv.org/abs/2510.19471
7. ASR System Combination (2025): https://arxiv.org/abs/2508.09880
8. Quality Estimation ROVER: https://www.sciencedirect.com/science/article/abs/pii/S0885230816300328

### LLM Correction
9. GenSEC Challenge (NVIDIA): https://arxiv.org/abs/2409.09785
10. N-best T5: https://arxiv.org/abs/2303.00456
11. ASR Error Correction with LLMs: https://arxiv.org/abs/2409.09554
12. Confidence-Guided Correction: https://arxiv.org/abs/2509.25048
13. Whisper-LM: https://arxiv.org/abs/2503.23542
14. ProGRes Rescoring: https://arxiv.org/abs/2409.00217
15. Steamroller (Jan 2026): https://arxiv.org/abs/2601.10223

### Routing & Cascading
16. AutoMode-ASR: https://arxiv.org/abs/2409.12476
17. FrugalML (NeurIPS 2020): https://arxiv.org/abs/2006.07512
18. FrugalGPT: https://arxiv.org/abs/2305.05176
19. Agreement-Based Cascading: https://arxiv.org/abs/2407.02348
20. RouteLLM (ICLR 2025): https://arxiv.org/abs/2406.18665
21. Cascade Routing (ICLR 2025): https://arxiv.org/abs/2410.10347
22. C3PO (NeurIPS 2025): https://arxiv.org/abs/2511.07396
23. Speculative Cascades (Google): https://research.google/blog/speculative-cascades
24. Early-Exit ASR: https://arxiv.org/abs/2309.09546
25. Splitformer (EUSIPCO 2025): https://arxiv.org/abs/2506.18035
26. Omni-Router MoE: https://arxiv.org/abs/2507.05724

### Child Speech & Reading Assessment
27. Prompted Whisper for Miscues (Apple): https://arxiv.org/abs/2505.23627
28. Child Reading Miscue Detection: https://arxiv.org/abs/2406.07060
29. Two-Pass Miscue System: https://www.isca-archive.org/interspeech_2024/gothi24_interspeech.html
30. CHSER Dataset: https://arxiv.org/abs/2505.18463
31. KidSpeak: https://arxiv.org/abs/2512.05994
32. Kid-Whisper: https://arxiv.org/abs/2309.07927
33. Disfluency-Aware LM: https://www.isca-archive.org/interspeech_2025/vidal25_interspeech.pdf
34. ASR for Child Reading Fluency (InterSpeech 2025): https://www.isca-archive.org/interspeech_2025/harmsen25_interspeech.pdf
35. Inclusive ASR for Disfluent Speech: https://arxiv.org/abs/2406.10177
36. CTC Disfluency Detection: https://arxiv.org/abs/2409.10177
37. FluencyBank Timestamped: https://pubs.asha.org/doi/10.1044/2024_JSLHR-24-00070
38. ORF Sub-Sequence Assessment: https://s2.smu.edu/~eclarson/pubs/2024_icassp_orf.pdf
39. Lost in Transcription (disfluency bias): https://arxiv.org/abs/2405.06150
40. SERDA Validation: https://link.springer.com/article/10.1007/s40593-025-00480-y
41. PromptASR: https://arxiv.org/abs/2309.07414

### Benchmarks & Analysis
42. Open ASR Leaderboard: https://huggingface.co/spaces/hf-audio/open_asr_leaderboard
43. Artificial Analysis STT: https://artificialanalysis.ai/speech-to-text
44. SHALLOW Hallucination Benchmark: https://arxiv.org/abs/2510.16567
45. Calm-Whisper: https://arxiv.org/abs/2505.12969
46. ASR Confidence Score Reliability: https://arxiv.org/abs/2503.15124
47. Ensemble Cost-Benefit Framework: https://arxiv.org/abs/2506.04677
48. CrisperWhisper: https://arxiv.org/abs/2408.16589
49. Whisper Internal Aligner: https://arxiv.org/abs/2509.09987
50. NoRefER Quality Estimation: https://arxiv.org/abs/2306.12577

### Commercial
51. Telnyx Multi-ASR API: https://telnyx.com/products/speech-to-text-api
52. Gladia Whisper-Zero: https://www.gladia.io
53. Deepgram Nova-3: https://deepgram.com/learn/introducing-nova-3-speech-to-text-api
54. Deepgram Interim Results: https://developers.deepgram.com/docs/interim-results
55. Google STT Adaptation: https://docs.cloud.google.com/speech-to-text/docs/adaptation-model
