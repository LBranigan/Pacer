# Segment-Level Semantic Voting and Oracle-Based ASR Routing: Research Findings

**Researcher:** Teammate D (Specialist)
**Date:** 2026-02-06
**Focus:** Intelligent ASR routing for educational reading assessment of struggling middle schoolers

---

## Table of Contents
1. [AutoMode-ASR: The Definitive Framework](#1-automode-asr)
2. [Segment-Level Semantic Voting Methods](#2-segment-level-semantic-voting)
3. [Confidence-Based ASR Routing and Cascading](#3-confidence-based-routing)
4. [Speculative Decoding Applied to ASR](#4-speculative-decoding)
5. [Application to Educational/Disfluent Speech](#5-educational-application)
6. [Reference-Free Quality Estimation (Key Enabler)](#6-quality-estimation)
7. [Practical Architecture Considerations](#7-architecture)
8. [Synthesis: Proposed Architecture for Our System](#8-synthesis)

---

## 1. AutoMode-ASR: The Definitive Framework {#1-automode-asr}

**Paper:** "AutoMode-ASR: Learning to Select ASR Systems for Better Quality and Cost"
**Published:** September 2024, arXiv:2409.12476
**Source:** [https://arxiv.org/html/2409.12476](https://arxiv.org/html/2409.12476)

### THIS IS THE KEY PAPER. It does exactly what we need.

AutoMode-ASR is a framework that trains a lightweight decision model to select the optimal ASR system for each audio **segment** before running any full ASR inference. This is precisely the "oracle routing" concept we discussed.

### Architecture

AutoMode-ASR uses a **pairwise learning-to-rank approach** with XGBoost classifiers:

- Decomposes the multi-engine selection problem into binary classifiers, each comparing a "pivot" system (default/cheap) against alternatives
- Uses a **one-vs-pivot strategy** -- new ASR engines can be added incrementally without retraining everything
- XGBoost was chosen over deep neural networks for flexibility in feature integration and interpretability

### Feature Set (4 categories)

1. **Self-supervised audio embeddings:** Wav2Vec2-XLSR-53 cross-lingual representations (1024 dims), averaged across time
2. **ASR-derived features:** Encoder output embeddings + confidence scores (mean, stddev, five-number summary of log probabilities)
3. **Quality estimation (NoRefER):** Reference-free quality metrics and embeddings (384 dims)
4. **Language metadata:** Categorical language features

**Critical finding on feature importance:** "ASR confidence scores are deemed the most important, followed by embeddings from self-supervised audio models." This means for our system, Deepgram's word-level confidence scores would be the primary routing signal.

### Performance Results

| Metric | Result |
|--------|--------|
| WER reduction | 16.2% relative (13.4% down to 11.1%) |
| Cost savings | **65%** compared to single-best baseline |
| Speed improvement | **75%** faster |
| Oracle upper bound | 6.5% WER (showing room for improvement) |

The framework achieves 36.2% of single-best baseline cost and 24.9-25.1% of baseline runtime.

### Router Overhead

- Quality estimation rescoring introduces **"negligible extra cost and runtime"**
- Initial classification decision requires only audio feature extraction -- does NOT require running full ASR inference
- Inference time for the NoRefER quality estimator: **0.095 seconds per hypothesis**

### Direct Relevance to Our System

- Operates at **segment level** (sentence/phrase chunks), not full utterance
- Compatible with **commercial and open-source black-box ASR systems** -- no model code changes needed
- The pivot system (cheap default) only gets overridden when the classifier is confident a different engine would do better
- **This is exactly our architecture:** Deepgram Nova as pivot, Google STT / fine-tuned Whisper as alternatives triggered when needed

---

## 2. Segment-Level Semantic Voting Methods {#2-segment-level-semantic-voting}

### 2.1 Driving ROVER with Segment-Based ASR Quality Estimation

**Paper:** Jalalvand & Negri, ACL 2015 (P15-1106)
**Source:** [https://aclanthology.org/P15-1106.pdf](https://aclanthology.org/P15-1106.pdf)

Standard ROVER feeds hypotheses in random order or uses global confidence. This paper proposes **segment-level quality estimation** to rank hypotheses before ROVER fusion:

- Uses ASR quality estimation (without reference transcripts) to rank hypotheses at the segment level
- Significantly outperforms standard ROVER: **0.5% to 7.3% absolute WER improvements**
- Competitive with strong oracle upper bounds
- Key insight: segment-level ranking matters more than global system ranking because different ASR engines excel on different types of speech segments

### 2.2 Ensembles of Hybrid and End-to-End ASR (LREC-COLING 2024)

**Source:** [https://aclanthology.org/2024.lrec-main.547/](https://aclanthology.org/2024.lrec-main.547/)

Combines Kaldi hybrid ASR with wav2vec2 XLS-R end-to-end ASR using ROVER with calibrated confidence scores:

- **Problem addressed:** End-to-end ASR models are overconfident in their predictions
- **Solution:** Renyi's entropy-based confidence approach with temperature scaling to align E2E confidence with hybrid ASR confidence
- **Results:** 14% WERR on primary test set, **20% WERR on noisy/imbalanced data**
- Key lesson: **Confidence calibration is essential before using confidence for voting or routing** -- raw confidence scores from different engines are not directly comparable

### 2.3 SeMaScore: Segment-Level Semantic Evaluation

**Paper:** Sasindran et al., Interspeech 2024
**Source:** [https://arxiv.org/html/2401.07506v1](https://arxiv.org/html/2401.07506v1)

SeMaScore is a segment-wise semantic similarity metric for ASR evaluation that could be repurposed for voting:

**Algorithm:**
1. Character-level Levenshtein alignment creates segment pairs between hypothesis and reference
2. Contextual embeddings extracted from DeBERTa-large-mnli for each segment
3. Mean pooling produces single segment representations
4. Cosine similarity between paired segment embeddings
5. Error penalty: multiply by (1 - MER) where MER is match error rate
6. Importance weighting: segments weighted by cosine similarity to full ground truth embedding

**Final score:** SeMaScore = Sum(alpha_i * SegScore_i) / Sum(alpha_i)

**Relevance to voting:** While designed as an evaluation metric, the segment-wise scoring framework could support ASR output fusion -- comparing competing hypotheses segment-by-segment and selecting high-confidence segments from different models. It is **41x faster than BERTScore** in computation.

**Critical insight for our system:** For reading assessment, we have the **reference text** (the passage the student is reading). SeMaScore's approach of comparing ASR hypotheses to a reference at the segment level is directly applicable -- we can compare each engine's output against the expected text segment-by-segment and pick the best match.

---

## 3. Confidence-Based ASR Routing and Cascading {#3-confidence-based-routing}

### 3.1 Standard Cascade Architecture

The cascade/fallback pattern for ASR:

1. **Fast/cheap engine** processes audio first (e.g., Deepgram Nova at $0.0043/min)
2. **Confidence check** on the output
3. If confidence < threshold, **trigger heavier engine** (e.g., fine-tuned Whisper or Google STT at $0.016/min)
4. Select the best output or combine via ROVER

**Latency considerations from production systems:**
- Hybrid conditional routing adds **70-200ms** for language/condition detection
- Model switching and routing adds **100-300ms** additional latency
- Total overhead: typically under 500ms for the routing decision

### 3.2 Multi-Model Strategy in Production (Deepgram/Industry)

From industry analysis ([Deepgram blog](https://deepgram.com/learn/whisper-vs-deepgram)):

- Organizations implement **primary + fallback approaches** with automatic fallback when confidence scores drop below thresholds
- Some use **parallel processing** of 2-3 models for critical interactions
- **Context-aware routing** sends different interaction types to specialized models
- Multi-model strategies reduce error rates by an additional **35-40%**

### 3.3 Cost Comparison for Routing Decisions

| Engine | Cost per 1000 min | Streaming Latency | WER (clean) |
|--------|-------------------|-------------------|-------------|
| Deepgram Nova-3 | $4.30 | sub-300ms | 5.26% (batch) / 6.84% (streaming) |
| OpenAI Whisper | $6.00 | seconds (no native streaming) | ~10.6% |
| Google STT (Chirp 2) | $16.00 | ~300ms | competitive |
| Self-hosted Whisper | GPU cost (~$1/hr) | depends on hardware | variable |

**Key insight:** If we can route 70-80% of audio to Deepgram (fluent reading segments) and only 20-30% to the heavier engine (disfluent segments), we save approximately 50-60% on ASR costs while improving accuracy on the hard cases.

---

## 4. Speculative Decoding Applied to ASR {#4-speculative-decoding}

### 4.1 SpecASR (July 2025)

**Paper:** "SpecASR: Accelerating LLM-based ASR via Speculative Decoding"
**Source:** [https://arxiv.org/abs/2507.18181](https://arxiv.org/abs/2507.18181)

A speculative decoding framework specialized for ASR:

**Core insight:** ASR decoding is audio-conditioned, resulting in **high output alignment between small and large ASR models** -- much higher than in text generation. This makes speculative decoding especially effective for ASR.

**Three key techniques:**
1. **Adaptive single-sequence prediction:** Dynamically adjusts draft length per verification round (up to 24 tokens). Threshold-based truncation at uncertain positions. Achieves **94.4% decoding-acceptance ratio**, reducing draft model steps by 74.1%.
2. **Draft sequence recycling:** Reuses rejected draft tokens via a two-stage masked token tree approach. Merges branches when regenerated tokens match previous predictions.
3. **Two-pass sparse-tree prediction:** Initial greedy pass identifies uncertain positions, second pass explores alternatives only at those positions.

**Performance:**
- 3.04x-3.79x speedup over autoregressive decoding (Vicuna-13B)
- 1.25x-1.84x speedup over baseline speculative decoding
- **No recognition accuracy loss**
- Total decoding latency: 485ms -> 368ms per 10-second audio

**Models tested:** Whisper tiny.en (draft) -> Whisper medium.en (target); TinyLlama -> Llama-7B/Vicuna-13B

### 4.2 Faster Cascades via Speculative Decoding (ICLR 2025)

**Source:** [https://arxiv.org/html/2405.19261v1](https://arxiv.org/html/2405.19261v1)

Combines cascade deferral with speculative execution:

- **Sequential cascade:** Binary defer/don't-defer decision using only smaller model's confidence (defer when max probability < 1-alpha)
- **Speculative cascade:** Smaller model drafts tokens auto-regressively while larger model scores them in parallel
- **Optimal deferral rule:** Defer when E[loss(q)] > E[loss(p)] + alpha * DTV(p,q) where DTV is total variation distance
- Achieves **better cost-quality trade-offs than both sequential cascades and standard speculative decoding**

**Relevance:** While demonstrated on NLP tasks rather than ASR specifically, the principle of speculative cascading could be applied to our two-engine system -- Deepgram generates draft transcription, and heavier model only "verifies" uncertain segments.

---

## 5. Application to Educational/Disfluent Speech {#5-educational-application}

### 5.1 Reading Miscue Detection with Prompted Whisper (Apple, 2025)

**Paper:** "Prompting Whisper for Improved Verbatim Transcription and End-to-end Miscue Detection"
**Source:** [https://arxiv.org/html/2505.23627v1](https://arxiv.org/html/2505.23627v1) | [Apple ML Research](https://machinelearning.apple.com/research/prompting-whisper)

**THIS IS HIGHLY RELEVANT.** Apple researchers modified Whisper for reading assessment:

**Architecture:**
- Target reading text is tokenized and **prepended to Whisper's decoder input** as a prompt
- Vocabulary augmented with special miscue tokens: `<omit>`, `<substitute>`, `<insert>`
- Model simultaneously generates verbatim transcription AND miscue annotations
- Loss computed only on predicted transcription/miscue tokens, not on the prompt

**Performance:**
- WER below 15% across configurations
- Macro-F1 of 0.44+ for miscue detection (up from 0.38 baseline)
- Tested on Whisper tiny.en, small.en, medium.en
- Post-hoc calculated miscues from verbatim transcripts outperformed direct miscue predictions

**Miscue types handled:** Substitutions, omissions, insertions. Framework is "theoretically extensible to pauses and filler words."

**Key insight for our system:** This prompted Whisper could serve as our "heavy engine" -- it knows what the student is supposed to read and can detect exactly where they deviate. The cheap engine (Deepgram) handles fluent segments; prompted Whisper handles segments where the student struggles.

### 5.2 Two-Pass System for Reading Miscue Detection (Interspeech 2024)

**Source:** [https://www.isca-archive.org/interspeech_2024/gothi24_interspeech.html](https://www.isca-archive.org/interspeech_2024/gothi24_interspeech.html)

- Dataset: 1,110 elementary school children reading connected text in L2 English
- First pass: hybrid ASR generates initial hypotheses
- Second pass: Uses "local features derived from alternate decodings under different linguistic context constraints" + deep acoustic model
- Focus on accurately detecting mispronounced words while limiting false positives
- **Two-pass architecture is analogous to our routing concept:** fast first pass, refined second pass on hard segments

### 5.3 ASR Models for Children's Reading Assessment

**Source:** [https://arxiv.org/abs/2406.07060](https://arxiv.org/abs/2406.07060) (Interspeech 2024)

Evaluation of ASR models for reading miscue detection in primary school:

| Model | Strength | Key Metric |
|-------|----------|------------|
| Wav2Vec2 Large | Highest recall | 0.83 recall |
| Whisper (Faster Whisper Large-v2) | Highest precision | 0.52 precision, WER 9.8% |
| HuBERT Large (Dutch fine-tuned) | Best phoneme-level | PER 23.1% |

**Complementary strengths suggest ensemble value:** Wav2Vec2 catches more errors (high recall), Whisper makes fewer false accusations (high precision). A routing/ensemble system could leverage both.

### 5.4 SERDA: Speech Enabled Reading Diagnostics App

**Source:** [https://pmc.ncbi.nlm.nih.gov/articles/PMC12686063/](https://pmc.ncbi.nlm.nih.gov/articles/PMC12686063/)

Dutch oral reading fluency assessment instrument:
- 176 hours of speech data from 653 children (grades 2-3)
- Moderate agreement with human raters: MCC 0.43 (words), 0.55 (passages)
- High sensitivity (0.93 for word errors) but lower precision
- Limitation: ASR models "trained on adult speech perform worse on child speech"
- Cronbach's Alpha: 0.96-1.0 (excellent internal consistency)

### 5.5 Steamroller: Multi-Agent System for Disfluent Speech

**Paper:** "Steamroller: A Multi-Agent System for Inclusive ASR for People Who Stutter" (January 2026)
**Source:** [https://arxiv.org/html/2601.10223](https://arxiv.org/html/2601.10223)

Three-stage pipeline for stuttered speech:
1. **ASR transcription** (Whisper-base, data2vec-audio, wav2vec2) -- baseline WER 21.53%
2. **Multi-agent text repair** -- 3 repair agents (GPT-4o) + 1 master agent that evaluates for text stability, coherence, and consensus
3. **TTS synthesis** (StyleTTS2) for fluent audio output

**Results:**
- WER: 31.60% -> 18.69%
- Semantic similarity: 0.81 -> 0.91 (Sentence-BERT)
- Latency: 3.77 +/- 0.62 seconds per 50-100 word segment

**Relevance:** The multi-agent repair approach could be adapted for post-processing in our system -- after ASR routing, an LLM agent could verify/repair transcriptions of disfluent segments.

### 5.6 Deep Learning for Oral Reading Fluency

**Source:** [https://arxiv.org/html/2405.19426v2](https://arxiv.org/html/2405.19426v2)

End-to-end fluency prediction using wav2vec2.0:
- **W2VAligned architecture:** Force-aligns audio to text, pools wav2vec embeddings at word level (including post-word pauses), contextual FC layers process word sequences
- Achieves CCC of 0.827, outperforming hand-crafted feature systems (0.794 Pearson)
- The model implicitly learns speech rate and prosodic features without explicit supervision
- **Does not require manual transcriptions for prediction**

### 5.7 Inclusive ASR for Disfluent Speech

**Source:** [https://arxiv.org/abs/2406.10177](https://arxiv.org/abs/2406.10177)

- Fine-tuning wav2vec 2.0 with small labeled disfluent dataset + data augmentation
- Significantly reduces WER on stuttered speech
- Handles involuntary blocks and word repetitions
- Demonstrates that targeted fine-tuning on disfluent speech, even with limited data, yields meaningful improvements

---

## 6. Reference-Free Quality Estimation (Key Enabler) {#6-quality-estimation}

### 6.1 NoRefER: Referenceless Quality Metric

**Paper:** "NoRefER: a Referenceless Quality Metric for ASR via Semi-Supervised Language Model Fine-Tuning with Contrastive Learning"
**Source:** [https://arxiv.org/html/2306.12577](https://arxiv.org/html/2306.12577)

NoRefER is the quality estimation component used in AutoMode-ASR. It predicts ASR output quality **without requiring reference transcripts**.

**Architecture:**
- Siamese network built on **MiniLMv2** (117M parameters -- 2.7x smaller than XLM-RoBERTa-Large)
- Dense encoder reduces embeddings to single scalar logit
- Two linear layers, 10% dropout, non-linear activation
- Processes hypothesis pairs through shared network, subtracts logits, sigmoid activation

**Training:**
- Self-supervised: Uses Whisper compression levels as quality proxy (higher compression = lower quality). 800,340 parallel hypothesis pairs from 6 compression levels
- Semi-supervised: Adds supervised pairs from referenced datasets
- Loss: alpha * L_sup + (1-alpha) * L_self (alpha=0.5 default)

**Performance:**
- Correlates highly with WER-based rankings
- Training time: 27-59 minutes
- **Inference: 0.095 seconds per hypothesis** on RTX 3090
- Hardware: RTX 3090 GPU, AMD Ryzen 5900X, 64GB RAM

**Application to routing:** NoRefER can estimate which ASR engine produced the better transcription for a given audio segment without needing ground truth. This is the "oracle" signal.

### 6.2 Word-Level ASR Quality Estimation (2024)

**Source:** [https://arxiv.org/html/2401.11268v2](https://arxiv.org/html/2401.11268v2)

Extension of NoRefER to word-level quality estimation:
- Uses NoRefER's attention mechanism for word-level error identification
- Enables efficient corpus sampling and post-editing
- Applicable to speech datasets lacking ground truth

### 6.3 Ground Truth-Free WER Prediction

**Source:** [https://www.researchgate.net/publication/396496612](https://www.researchgate.net/publication/396496612)

Predicts WER using only audio quality features and model confidence features, without needing reference transcripts. Could serve as a lightweight routing signal.

### 6.4 Confidence Calibration for Overconfident ASR

**Source:** [https://arxiv.org/html/2509.07195](https://arxiv.org/html/2509.07195)

A lightweight post-hoc framework identifies overconfident tokens using acoustic, uncertainty, and contextual features, then applies selective temperature scaling. Critical for making routing decisions based on confidence -- raw confidence from different engines is not directly comparable without calibration.

---

## 7. Practical Architecture Considerations {#7-architecture}

### 7.1 Latency Impact of Routing Decision

Based on the collected evidence:

| Component | Latency |
|-----------|---------|
| Audio feature extraction (Wav2Vec2 embeddings) | 50-100ms for 10s audio |
| XGBoost classification (AutoMode-ASR) | <10ms |
| NoRefER quality estimation | 95ms per hypothesis |
| Deepgram streaming transcription | sub-300ms |
| Whisper inference (medium.en, GPU) | 1-3 seconds for 10s audio |
| VAD + routing logic | 70-200ms |
| **Total overhead of routing decision** | **~100-200ms** |

The routing decision itself (feature extraction + classification) adds approximately 100-200ms, which is negligible compared to the time saved by not running the heavy engine on easy segments.

### 7.2 Can the Oracle Reuse Existing Features?

**Yes.** AutoMode-ASR demonstrates that the most important features for routing are:

1. **ASR confidence scores** from the fast engine (already available from Deepgram)
2. **Audio embeddings** from self-supervised models (Wav2Vec2-XLSR-53)
3. **Signal-level features** (SNR, energy, spectral characteristics)

For our system specifically:
- Deepgram already returns **word-level confidence scores** in its streaming API
- We could extract Wav2Vec2 embeddings using a frozen encoder (runs on CPU or lightweight GPU)
- VAD features (pause duration, energy contour) are already computed in our pipeline

### 7.3 Minimum Oracle Model Size

From the evidence:

- **AutoMode-ASR uses XGBoost** -- not a deep neural network. This is extremely lightweight (kilobytes, not megabytes)
- **NoRefER uses MiniLMv2** (117M parameters) for quality estimation, but this is optional -- confidence scores alone are the most important feature
- **A simple confidence threshold** could serve as the simplest "oracle" -- if Deepgram's average word confidence for a segment drops below X, trigger the heavy engine

Minimum viable oracle: **A confidence threshold on Deepgram output** (zero additional computation)
Better oracle: **XGBoost classifier on Deepgram confidence + simple audio features** (<1MB model, <10ms inference)
Best oracle: **XGBoost + Wav2Vec2 embeddings + NoRefER** (~200ms overhead, highest routing accuracy)

### 7.4 Cost Comparison: Routing vs. Always Running Both

**Scenario: 1000 minutes of student reading audio**

| Strategy | Deepgram Cost | Heavy Engine Cost | Total Cost |
|----------|--------------|-------------------|------------|
| Deepgram only | $4.30 | $0 | $4.30 |
| Heavy engine only (Google STT) | $0 | $16.00 | $16.00 |
| Both engines always | $4.30 | $16.00 | $20.30 |
| **Routing (80/20 split)** | **$4.30** | **$3.20** | **$7.50** |
| **Routing (70/30 split)** | **$4.30** | **$4.80** | **$9.10** |

Even at a 70/30 split (30% of segments going to the heavy engine), routing saves **55% vs. running both engines** and **43% vs. running only the heavy engine**, while likely achieving **better accuracy** than either engine alone on disfluent speech.

### 7.5 Adaptive Compute Allocation (From LLM Research)

The broader AI field is moving toward **adaptive inference-time compute allocation** (surveyed extensively in 2024-2025 for LLMs):

- Simple problems get compressed reasoning; hard problems get full compute
- LLMs can natively adjust response effort to problem difficulty
- Methods include: adaptive sampling, early pruning of unpromising samples, problem-dependent budgeting

**Direct analogy to our use case:** Fluent reading = easy problem (cheap engine). Disfluent reading = hard problem (expensive engine). The oracle model predicts difficulty and allocates compute accordingly.

---

## 8. Synthesis: Proposed Architecture for Our System {#8-synthesis}

Based on all research findings, here is the recommended architecture for intelligent ASR routing in our reading assessment tool:

### Tier 1: Simple Confidence Threshold (Implement First)

```
Audio Stream -> Deepgram Nova-3 (streaming, sub-300ms)
                    |
                    v
              Word-level confidence scores
                    |
                    v
              [Segment confidence < 0.85?] -- No --> Use Deepgram output
                    |
                   Yes
                    |
                    v
              Trigger Google STT / Whisper on same segment
                    |
                    v
              Compare outputs (ROVER or semantic voting)
                    |
                    v
              Best result selected
```

**Cost:** Essentially free (uses existing Deepgram confidence data)
**Estimated routing:** 70-80% handled by Deepgram alone

### Tier 2: VAD-Enhanced Routing (Add Next)

Additional signals to trigger heavy engine:
- **Pause duration > threshold** (student hesitating)
- **Multiple short segments** (repetitions/false starts)
- **Low energy or unusual spectral patterns** (mumbling)
- **Deepgram interim result instability** (confidence fluctuating across interim results for same segment)

These signals are already available or easily computable from our existing VAD pipeline.

### Tier 3: Full AutoMode-ASR Style Router (Future)

- XGBoost classifier trained on:
  - Deepgram confidence features (mean, stddev, min, five-number summary)
  - Audio embeddings (Wav2Vec2 or similar, averaged across segment)
  - VAD features (pause count, mean pause duration, speech rate)
  - Optional: NoRefER quality estimation
- Trained on labeled reading assessment data where we know which engine performed better
- <10ms inference overhead for routing decision

### Tier 4: Prompted Whisper for Miscue Detection (Specialized Heavy Engine)

Based on the Apple research, the ideal "heavy engine" for our use case is not generic Whisper or Google STT, but a **prompted Whisper** that:
- Receives the target reading text as decoder prompt
- Generates verbatim transcription of what was actually read
- Directly outputs miscue tokens (<omit>, <substitute>, <insert>)
- Handles the exact error types we care about

This would be triggered only on segments where the student appears to be struggling, providing both accurate transcription AND miscue classification in a single pass.

### Key Signals for Triggering Heavy Engine

Based on all research, these are the signals that should trigger escalation from cheap to expensive ASR:

| Signal | Source | Weight |
|--------|--------|--------|
| Low word confidence (< 0.85) | Deepgram API | High |
| Long pause (> 1.5s) | VAD pipeline | High |
| Interim result instability | Deepgram streaming | Medium |
| Repetitions detected | Pattern matching on Deepgram output | Medium |
| High spectral variance | Audio features | Low |
| Low SNR | Audio features | Low |
| Deviation from expected text | Alignment with reference passage | High |

### Expected Performance Gains

Based on AutoMode-ASR results scaled to our use case:
- **WER improvement:** 10-16% relative reduction on disfluent segments
- **Cost savings:** 50-65% compared to running both engines on all audio
- **Latency:** Minimal additional overhead (100-200ms for routing decision)
- **Accuracy on fluent segments:** No degradation (Deepgram handles these well)
- **Accuracy on disfluent segments:** Significant improvement from specialized heavy engine

---

## Key References

1. **AutoMode-ASR** -- [arXiv:2409.12476](https://arxiv.org/html/2409.12476) -- The foundational framework for ASR engine routing
2. **Segment-based ROVER** -- [ACL P15-1106](https://aclanthology.org/P15-1106.pdf) -- Segment-level quality estimation for hypothesis ranking
3. **Hybrid+E2E Ensemble** -- [LREC-COLING 2024](https://aclanthology.org/2024.lrec-main.547/) -- Confidence calibration for ROVER voting
4. **SeMaScore** -- [arXiv:2401.07506](https://arxiv.org/html/2401.07506v1) -- Segment-wise semantic similarity scoring
5. **NoRefER** -- [arXiv:2306.12577](https://arxiv.org/html/2306.12577) -- Reference-free ASR quality estimation
6. **Prompted Whisper for Miscues** -- [arXiv:2505.23627](https://arxiv.org/html/2505.23627v1) -- Apple's end-to-end miscue detection
7. **Two-pass Miscue Detection** -- [Interspeech 2024](https://www.isca-archive.org/interspeech_2024/gothi24_interspeech.html) -- Dataset + two-pass system for reading
8. **ASR for Children's Reading** -- [arXiv:2406.07060](https://arxiv.org/abs/2406.07060) -- Model comparison for reading miscue detection
9. **SpecASR** -- [arXiv:2507.18181](https://arxiv.org/abs/2507.18181) -- Speculative decoding for ASR acceleration
10. **Faster Cascades** -- [ICLR 2025](https://arxiv.org/html/2405.19261v1) -- Speculative cascading with optimal deferral rules
11. **Steamroller** -- [arXiv:2601.10223](https://arxiv.org/html/2601.10223) -- Multi-agent system for disfluent speech
12. **Deep Learning for ORF** -- [arXiv:2405.19426](https://arxiv.org/html/2405.19426v2) -- End-to-end oral reading fluency
13. **Inclusive ASR for Disfluency** -- [arXiv:2406.10177](https://arxiv.org/abs/2406.10177) -- Fine-tuning wav2vec2 for disfluent speech
14. **SERDA** -- [PMC12686063](https://pmc.ncbi.nlm.nih.gov/articles/PMC12686063/) -- Speech-enabled reading diagnostics validation
15. **Deepgram vs Whisper** -- [Deepgram blog](https://deepgram.com/learn/whisper-vs-deepgram) -- Cost/latency/accuracy comparison
16. **Whisper vs Deepgram (Modal)** -- [Modal blog](https://modal.com/blog/whisper-vs-deepgram) -- Independent benchmarking
17. **Confidence Calibration** -- [arXiv:2509.07195](https://arxiv.org/html/2509.07195) -- Post-hoc calibration of overconfident ASR
18. **Word-Level QE** -- [arXiv:2401.11268](https://arxiv.org/html/2401.11268v2) -- Word-level quality estimation via NoRefER attention

---
---

# SECOND PASS: Additional Routing Research

**Date:** 2026-02-06
**Scope:** Deep-dive into model routing frameworks, API cascading, early-exit ASR, Deepgram/Google STT specifics, lattice combination, MoE for ASR, implementations, and Whisper timestamp accuracy.

---

## 9. FrugalML and FrugalMCT: Cost-Optimal API Routing Frameworks {#9-frugalml}

### 9.1 FrugalML (NeurIPS 2020)

**Paper:** "FrugalML: How to Use ML Prediction APIs More Accurately and Cheaply"
**Source:** [https://arxiv.org/abs/2006.07512](https://arxiv.org/abs/2006.07512)
**Code:** [https://github.com/lchen001/FrugalML](https://github.com/lchen001/FrugalML)

FrugalML is the foundational framework for cost-optimal ML API routing. It directly addresses our problem: when you have multiple ML APIs (Google, Amazon, Microsoft, IBM, Baidu) with different prices and accuracy profiles, how do you route each input to the best API within a budget?

**Core Technical Approach:**
- Casts API selection as an **integer linear program (ILP)** with a special sparse structure
- Jointly learns the **strength and weakness of each API on different data** -- not just average accuracy, but per-input routing
- Identifies the best **sequential strategy** to adaptively use APIs within a budget
- The ILP has natural sparsity that makes it computationally efficient

**How the Cascade Works:**
1. Start with the cheapest API
2. If a learned scoring function predicts the cheap API is sufficient for this input, accept the result
3. Otherwise, escalate to the next API in the learned sequence
4. Continue until a sufficiently reliable result is obtained or budget is exhausted

**Results:**
- Up to **90% cost reduction** while matching the accuracy of the best single API
- Up to **5% better accuracy** while matching the best API's cost
- Tested on: facial emotion recognition, sentiment analysis, **and speech recognition**

**CRITICAL: FrugalML was tested on speech recognition APIs.** This means the framework has been validated in our exact domain. The per-input routing decision considers acoustic properties that make certain APIs better for certain audio segments.

### 9.2 FrugalMCT (ICLR 2022)

**Paper:** "FrugalMCT: Efficient Online ML API Selection for Multi-Label Classification Tasks"
**Source:** [https://arxiv.org/abs/2102.09127](https://arxiv.org/abs/2102.09127)

Extension of FrugalML to multi-label settings:
- **Online learning** -- adapts the routing strategy as data arrives (no pre-training needed)
- Up to **90% cost reduction** or **8% accuracy improvement**
- Uses budget-aware optimization with real-time performance tracking

**Relevance:** Our reading assessment is inherently multi-label -- each segment can have multiple simultaneous issues (hesitation + mispronunciation + repetition). FrugalMCT's multi-label routing could handle this.

### 9.3 FrugalGPT (Stanford, 2023)

**Paper:** "FrugalGPT: How to Use Large Language Models While Reducing Cost and Improving Performance"
**Source:** [https://arxiv.org/abs/2305.05176](https://arxiv.org/abs/2305.05176)

Built on FrugalML principles, applied to LLM API cascading:

**Architecture:**
1. Query arrives
2. Cheapest LLM (e.g., GPT-J) processes it
3. A **Generation Scoring Function** assigns a reliability score (0 to 1) to the response
4. If reliable, return the response; otherwise, escalate to next LLM (e.g., J1-L, then GPT-4)

**Results:** Matches GPT-4 performance with **up to 98% cost reduction**, or improves accuracy by 4% at the same cost.

**Direct analogy to our system:**
- Step 1: Deepgram Nova processes audio (cheapest)
- Step 2: A scoring function evaluates the transcription reliability (using confidence scores, alignment to expected text)
- Step 3: If unreliable, escalate to Google STT or prompted Whisper
- Expected savings: 70-90% of API costs

---

## 10. Learning to Route and Cascade: Unified Frameworks {#10-learning-to-route}

### 10.1 RouteLLM (LMSYS, ICLR 2025)

**Paper:** "RouteLLM: Learning to Route LLMs with Preference Data"
**Source:** [https://lmsys.org/blog/2024-07-01-routellm/](https://lmsys.org/blog/2024-07-01-routellm/)
**Code:** [https://github.com/lm-sys/RouteLLM](https://github.com/lm-sys/RouteLLM)

**Router architectures tested:**
1. **Matrix Factorization Router** -- learns a scoring function for how well each model handles each query type. Best performer: only 14% of calls need to go to the expensive model to maintain 95% of its quality. **75% cheaper than random routing.**
2. **BERT Classifier Router** -- BERT-base model fine-tuned on preference data to predict which model will give a better answer. Trained on 2xL4 GPUs, ~2000 steps.
3. **Causal LLM Classifier** -- uses a small LLM as the router itself

**Key finding:** Routers trained on one pair of models (e.g., GPT-4 vs GPT-3.5) **generalize to other model pairs** not seen during training. This suggests we could train a router on Deepgram vs. Google STT and it would likely transfer to Deepgram vs. Whisper.

**Configuration:** YAML-based router config, drop-in OpenAI-compatible API server. Could be adapted for ASR routing.

### 10.2 Cascade Routing: Unified Routing + Cascading (ICLR 2025)

**Paper:** "A Unified Approach to Routing and Cascading for LLMs"
**Source:** [https://arxiv.org/html/2410.10347v1](https://arxiv.org/html/2410.10347v1)

**THIS IS A KEY THEORETICAL FRAMEWORK.** It proves that routing and cascading are special cases of a unified strategy called "cascade routing."

**How it works:**
- Models routing + cascading as a linear optimization over "supermodels" (sequences of model calls)
- Deferral decision function: **tau_i(x, lambda) = q_hat_i(x) - lambda * c_hat_i(x)** where lambda controls quality-cost balance
- At each step: estimate quality and cost for each available model, select the one maximizing the tradeoff
- **Negative marginal gain pruning** eliminates branches where adding another model would reduce the quality-cost tradeoff

**Results on RouterBench:**
- **4% absolute improvement** over baselines (80% relative improvement over naive)
- 5-model setting with medium noise: 76.3% AUC vs 75.1% (optimal cascading) vs 74.4% (routing)
- Consistently improves across all noise levels and model set sizes

**Direct application to ASR:**
- Treat engines as specialists: Deepgram (fast/cheap), Google STT (medium), Whisper (accurate but slow)
- Cascade routing would dynamically decide per segment: use Deepgram alone, or escalate to Google STT, or further escalate to Whisper
- The lambda parameter lets us tune the quality-cost tradeoff based on deployment constraints

### 10.3 Agreement-Based Cascading (ABC)

**Paper:** "Agreement-Based Cascading for Efficient Inference"
**Source:** [https://arxiv.org/abs/2407.02348](https://arxiv.org/abs/2407.02348)

**A training-free cascading method** especially useful for black-box APIs:

**Mechanism:**
- Build cascade tiers of increasing model complexity
- At each tier, run an **ensemble** of models and check if they **agree**
- If ensemble members agree (voting threshold exceeded), accept the result
- If they disagree, defer to the next tier

**Two deferral rules:**
1. **Voting-based** (black-box APIs): vote(x; H_1^k) <= theta_v --> defer
2. **Score-based** (with confidence access): s(x; H_1^k) <= theta_s --> defer

**Setup:** Only ~100 validation samples needed to calibrate thresholds. No training required.

**Cost savings:**
- 22-25x average cost reduction vs state-of-the-art cascading methods
- 14x reduction in edge-to-cloud communication costs
- 3x GPU rental cost reduction

**Key advantage over confidence-based methods:** Works with miscalibrated models and benefits from ensemble diversity. Since different ASR engines have differently calibrated confidence scores (see Section 2.2), ABC's agreement-based approach sidesteps the calibration problem entirely.

**Application to our system:**
- Tier 1: Run Deepgram on segment
- Tier 2: If Deepgram output is uncertain, run both Deepgram and Google STT -- do they agree?
- Tier 3: If they disagree, run prompted Whisper as the final authority
- Agreement = both engines produce the same transcription for a segment = high confidence

### 10.4 Awesome AI Model Routing (Curated List)

**Source:** [https://github.com/Not-Diamond/awesome-ai-model-routing](https://github.com/Not-Diamond/awesome-ai-model-routing)

Comprehensive list of 11+ routing tools and 19+ research papers. Notable entries:

| Tool | Approach |
|------|----------|
| RouteLLM | Preference-data trained routers |
| Semantic Router | Uses semantic embeddings for model selection |
| Requesty | Configurable routing for performance/cost/latency |
| Unify | Routes to optimize quality, cost, and speed |
| AutoMix | Routes using approximate correctness from smaller models |
| EcoAssistant | Tries cheaper LLMs first before expensive ones |
| Hybrid LLM | Routes based on predicted query difficulty |

**Notable finding:** No tools in this curated list specifically target ASR/speech routing. This represents an **open niche** where our work could contribute.

---

## 11. Early-Exit Transformers for Adaptive ASR Depth {#11-early-exit}

### 11.1 Early-Exit Architectures for ASR

**Paper:** "Training early-exit architectures for automatic speech recognition: fine-tuning pre-trained models or training from scratch"
**Source:** [https://arxiv.org/html/2309.09546v2](https://arxiv.org/html/2309.09546v2)

**Architecture:** Intermediate CTC decoders attached at multiple encoder layers (typically every other layer in a 12-layer encoder). All exits are trained jointly.

**Models tested:** Conformer-CTC, Conformer-AED, Wav2Vec2-CTC, WavLM-CTC

**Exit decision mechanisms:**
1. **Entropy-based:** Compute average frame entropies at each exit. Stop when entropy < threshold
2. **Sentence confidence:** Uses N-best hypotheses to compute sentence-level confidence. "Provides a better trade-off between saving computation and maintaining performance" vs entropy

**Key finding:** For simpler/cleaner inputs, the model can exit at layer 6 (of 12) with comparable WER to full-depth processing. This means **50% compute savings on easy segments**.

**Training insight:** Models trained from scratch with early-exit objectives outperform fine-tuned pre-trained models at lower layers.

**Relevance:** Rather than routing between separate engines, a single early-exit ASR model could adaptively allocate compute. Fluent reading segments exit early (cheap); disfluent segments use all layers (expensive). However, this requires custom model training, unlike the API-based routing approach.

### 11.2 Splitformer: Improved Early-Exit for Edge ASR (EUSIPCO 2025)

**Paper:** "Splitformer: An improved early-exit architecture for automatic speech recognition on edge devices"
**Source:** [https://arxiv.org/html/2506.18035](https://arxiv.org/html/2506.18035)

**Architecture innovation:**
- 14-layer Conformer encoder (vs 12 baseline)
- Exit decoders every 2 conformer layers
- **Parallel downsampling layers** at first and last encoder exits (U-net inspired)
- 2x downsampling factor for parallel paths
- Total: 36.7M parameters (vs 31.5M baseline, +14.6% overhead)

**WER Results (LibriSpeech test-clean / test-other):**

| Exit Layer | EE-Baseline | Splitformer | Improvement |
|-----------|-------------|-------------|-------------|
| Layer 2 | 31.0 / 51.0 | 28.1 / 48.3 | -2.9 / -2.7 |
| Layer 4 | 11.7 / 27.8 | 10.8 / 26.4 | -0.9 / -1.4 |
| Layer 6 | 7.1 / 19.8 | 6.7 / 19.2 | -0.4 / -0.6 |
| Layer 12 | 5.1 / 14.8 | 4.8 / 14.7 | -0.3 / -0.1 |

**Biggest gains at lowest exits** -- exactly where we need them for cheap/fast processing of easy segments.

**Edge deployment:** Designed for resource-constrained devices. Dynamic computational load adjustment during inference with minimal memory overhead.

### 11.3 Adaptive Context Biasing in Transformer ASR

**Paper:** "Adaptive context biasing in transformer-based ASR systems"
**Source:** [https://pmc.ncbi.nlm.nih.gov/articles/PMC12328576/](https://pmc.ncbi.nlm.nih.gov/articles/PMC12328576/)

Context biasing adapts ASR to domain-specific vocabulary at inference time. Highly relevant for reading assessment where we know the expected words:

- Bias list (expected words from reading passage) is provided at inference time
- System increases recognition probability for these words
- Works with Transformer/Conformer architectures
- **No retraining needed** -- purely inference-time adaptation

---

## 12. Model Cascading and API Cascading in Production {#12-cascading}

### 12.1 Speculative Cascades (Google Research, 2024)

**Source:** [https://research.google/blog/speculative-cascades-a-hybrid-approach-for-smarter-faster-llm-inference/](https://research.google/blog/speculative-cascades-a-hybrid-approach-for-smarter-faster-llm-inference/)

Google's production approach combining cascades with speculative decoding:

- Small model generates draft tokens speculatively
- Large model verifies in parallel
- **Sometimes defers to the small model for efficiency** when draft quality is acceptable
- Delivers "better LLM output quality at lower computational cost than either technique alone"

**ASR application:** Deepgram (small model) generates streaming transcription. When confidence is high, we accept it immediately. When confidence drops, we speculatively also run Google STT and compare outputs -- accepting whichever is better.

### 12.2 CASCADIA: Production Cascade Serving (2025)

**Source:** [https://arxiv.org/pdf/2506.04203](https://arxiv.org/pdf/2506.04203)

A system-level cascade serving framework:
- **Bi-level optimization** for request routing and model deployment
- Schedules cascade placement across GPU resources
- Optimizes for fast, quality-preserving inference while reducing costs
- Handles heterogeneous model deployments

### 12.3 C3PO: Conformally-Controlled Cascades (NeurIPS 2025)

**Source:** [https://arxiv.org/pdf/2511.07396](https://arxiv.org/pdf/2511.07396)

Label-free cascade optimization framework:
- Uses only **self-supervision** from model outputs (no ground truth labels needed)
- Employs **conformal prediction** to guarantee cost bounds with statistical certainty
- User specifies a cost threshold; C3PO guarantees inference cost exceeds it with bounded probability
- **No router training needed** -- uses off-the-shelf model outputs

**Relevance:** For our system, we could set a cost ceiling (e.g., "no more than $8/1000 min") and C3PO would automatically calibrate the routing threshold to stay within budget while maximizing accuracy.

### 12.4 xRouter: Reinforcement Learning for Routing (2025)

**Source:** [https://arxiv.org/html/2510.08439v1](https://arxiv.org/html/2510.08439v1)

Learns routing policy via RL:
- **Answers directly** when confident (cheapest option)
- **Escalates** when necessary
- **Balances performance with budget** in a principled way through reward shaping

---

## 13. Deepgram Interim Results as a Routing Signal {#13-deepgram-interim}

**Sources:** [Deepgram Interim Results Docs](https://developers.deepgram.com/docs/interim-results) | [Using Interim Results](https://developers.deepgram.com/docs/using-interim-results) | [Configure Endpointing](https://developers.deepgram.com/docs/understand-endpointing-interim-results)

### 13.1 How Deepgram Interim Results Work

Deepgram's streaming API provides a rich signal for routing decisions:

**Two-level finalization:**
1. **`is_final: false`** -- Preliminary transcript. Deepgram is still processing and may revise.
2. **`is_final: true`** -- Maximum accuracy reached for this segment. Locked in.
3. **`speech_final: true`** -- Speaker has paused. End of utterance.

**Timeline:**
```
Audio streams in --> interim (is_final=false, ~150ms) --> more interim -->
final (is_final=true) --> [pause detected] --> speech_final=true
```

### 13.2 Word-Level Confidence Structure

Each word in the response includes:
```json
{
  "word": "reading",
  "start": 1.23,
  "end": 1.67,
  "confidence": 0.96
}
```

Confidence values are decimals (observed range: 0.0 to 1.0). The documentation explicitly shows confidence evolving between interim results -- e.g., "confidence for the word 'big' has improved to almost 98%" between updates.

### 13.3 Routing Signal Extraction Strategy

**Signal 1: Confidence instability.** If the same word's confidence fluctuates significantly between interim results (e.g., 0.6 -> 0.8 -> 0.65), the segment is unstable and should be escalated.

**Signal 2: Word-level confidence distribution.** For a segment, compute:
- Mean confidence across all words
- Minimum word confidence (weakest link)
- Stddev of confidence (uniformity measure)
- Count of words with confidence < threshold

**Signal 3: Interim-to-final divergence.** If the final transcript significantly differs from early interim results (many words changed), the audio was ambiguous.

**Signal 4: Endpointing behavior.** Long gaps between `is_final` and `speech_final` may indicate hesitation.

### 13.4 Endpointing Configuration for Routing

| Setting | Value | Use Case |
|---------|-------|----------|
| endpointing=10ms | Default | Rapid responses, chatbots |
| endpointing=300-500ms | Recommended for us | Natural reading with mid-thought pauses |
| endpointing=false | Disabled | Continuous streaming without pause detection |

**Critical configuration note:** For reading assessment, we should use endpointing=300-500ms to allow for natural hesitations without prematurely splitting segments. This gives us better segment-level confidence aggregation.

### 13.5 Practical Implementation

```
Deepgram WebSocket
    |
    +--> Collect interim results for segment
    |     - Track confidence evolution per word
    |     - Compute segment-level statistics
    |
    +--> On is_final=true:
    |     - Compute routing features:
    |       * mean_confidence
    |       * min_confidence
    |       * confidence_stddev
    |       * n_low_confidence_words
    |       * interim_instability_score
    |     - Apply routing decision
    |
    +--> If escalate:
          - Buffer audio for segment
          - Send to Google STT / Whisper
          - Compare and select best output
```

---

## 14. Google STT Adaptation Boost and Phrase Hints {#14-google-adaptation}

**Source:** [https://docs.cloud.google.com/speech-to-text/docs/adaptation-model](https://docs.cloud.google.com/speech-to-text/docs/adaptation-model)

### 14.1 How Phrase Hints Work for Reading Assessment

Google STT's speech adaptation feature is **directly applicable** to reading assessment because we know the expected text.

**Mechanism:**
- Provide a list of expected words/phrases as `PhraseSet` resources
- Google STT increases recognition probability for those words
- Multi-word phrases cause the model to favor recognizing those words **in sequence**
- Words from the reading passage become "biased" in the recognition model

### 14.2 Boost Parameter

- **Range:** Float values > 0, practical maximum of **20**
- **Higher boost** = fewer false negatives (catches more correct reads) but more false positives (may "hear" words that weren't said)
- **Lower boost** = conservative recognition, fewer hallucinations

**For reading assessment, we want moderate boost (5-10):** We want Google STT to recognize the expected words, but we also need to detect when the student says something *different* (substitution errors). Too high a boost would mask substitution errors.

### 14.3 Two Implementation Methods

1. **Inline PhraseSet:** Include phrases directly in each recognition request
   - Simple, no persistent resources
   - Good for per-passage adaptation (each student reads a different passage)

2. **PhraseSet Resources:** Create persistent, reusable resources
   - Better for passages used across many students
   - Can be pre-created and referenced by ID

### 14.4 Custom Classes

Google STT offers pre-built class tokens for common patterns:
- `$ADDRESSNUM` for addresses
- `$MONEY` for monetary amounts
- Numbers, dates, etc.

For reading assessment, we could create **CustomClass** resources for:
- Vocabulary words likely to appear in reading passages
- Common names in children's literature
- Domain-specific terms for each grade level

### 14.5 Strategic Use: Adaptation as a Routing Enhancement

**Key insight:** When Google STT is triggered as the "heavy engine," we should ALWAYS provide the expected passage text as phrase hints. This gives Google STT a significant advantage over running it without hints:

```
Standard Google STT:         WER ~X%
Google STT + phrase hints:   WER ~(X - 3-5)%  (estimated improvement)
```

Combined with Deepgram routing: Deepgram handles easy segments (no adaptation needed for clean speech), Google STT with phrase hints handles hard segments (adaptation helps disambiguate disfluent speech when we know what the student should be reading).

### 14.6 Caution: False Positive Risk

With boost enabled, Google STT may transcribe expected words even when the student said something else. For miscue detection, this is problematic -- we need to detect substitutions, not mask them.

**Mitigation strategy:**
- Use moderate boost (5-10) for the primary transcription
- Run a **second pass without boost** on flagged segments to check for substitutions
- Compare boosted vs. unboosted outputs -- if they differ significantly, a substitution likely occurred

---

## 15. ASR Lattice and Word Graph Combination {#15-lattice-combination}

### 15.1 Word Lattices vs. N-best Lists

**Source:** [https://alecokas.github.io/asr/2019/09/30/lattices-for-asr.html](https://alecokas.github.io/asr/2019/09/30/lattices-for-asr.html)

An ASR lattice (word graph) is a **Directed Acyclic Graph (DAG)** encoding exponentially more hypotheses than n-best lists:

- Each path through the lattice = one possible transcription
- Edges carry words + acoustic/language model scores
- Nodes represent time boundaries
- Lattices can encode thousands of hypotheses compactly

**Confusion Networks (Consensus Networks):**
- Transform the lattice into a **linear graph** where all paths pass through all nodes
- Each "slot" describes competing word hypotheses for a single time period
- Include word confidence scores and epsilon (deletion) alternatives
- Two-stage clustering procedure groups hypotheses into time-synchronous slots

### 15.2 ROVER: Recognizer Output Voting Error Reduction

**Source:** [https://ieeexplore.ieee.org/document/659110/](https://ieeexplore.ieee.org/document/659110/)

The foundational system combination technique:

1. **Word Transition Network (WTN)** alignment of multiple ASR outputs
2. **Voting** across aligned hypotheses using confidence scores or majority rule
3. Composite output typically has **lower error rate** than any individual system

**Relevance to our system:** When we route a segment to multiple engines, ROVER provides the mechanism to combine their outputs at the word level. Rather than choosing Engine A or Engine B's full output, ROVER selects the best words from each.

### 15.3 Word Confusion Networks for Downstream Tasks (2024)

**Paper:** "Towards ASR Robust Spoken Language Understanding Through In-Context Learning With Word Confusion Networks"
**Source:** [https://arxiv.org/html/2401.02921v1](https://arxiv.org/html/2401.02921v1)

Modern extension: feeding word confusion networks (WCNs) directly to LLMs for downstream processing:

- WCNs provide "a compact representation of multiple aligned ASR hypotheses along with word confidence scores"
- Feeding WCN alternatives to an LLM with in-context learning improves SLU robustness
- The LLM can reason about alternative word hypotheses and select the most contextually appropriate one

**Application to reading assessment:** Rather than picking one engine's output, we could construct a WCN from Deepgram + Google STT outputs and feed it to an LLM that knows the expected reading passage. The LLM would select the most plausible word at each position, considering both the passage context and the ASR alternatives.

### 15.4 Practical Limitation: Lattice Access

**Important constraint:** Commercial ASR APIs (Deepgram, Google STT) typically return only n-best lists or single-best outputs, not full lattices. True lattice-level combination requires either:
- Self-hosted models (Kaldi, ESPnet) that expose lattice outputs
- Constructing approximate confusion networks from n-best word lists + confidence scores

For our current architecture, **word-level ROVER on n-best outputs** is more practical than full lattice combination.

---

## 16. Mixture of Experts for ASR {#16-moe-asr}

### 16.1 Omni-Router: Shared Routing for MoE ASR (July 2025)

**Paper:** "Omni-Router: Sharing Routing Decisions in Sparse Mixture-of-Experts for Speech Recognition"
**Source:** [https://arxiv.org/html/2507.05724](https://arxiv.org/html/2507.05724)

**Architecture:**
- Standard Transformer encoder with CTC loss
- Top-1 expert selection per token per layer
- **Shared router across all MoE layers** (same routing weight matrix W^shared)
- Works because transformer residual connections preserve feature similarity across depths

**Why shared routing works for ASR:**
- Exhibits "notably structured and coherent expert assignments across both temporal and depth dimensions"
- Specific experts consistently handle particular acoustic phenomena (silence, alternating speech patterns)
- Lower entropy in routing decisions = higher confidence and decisiveness
- When experts are randomly reassigned, Omni-router shows **significantly larger performance degradation** -- confirming genuine specialization

**Performance:**
- **11.2% relative WER reduction** vs dense models
- **8.2% relative WER reduction** vs Switch Transformer
- Consistent across 2, 4, and 8 expert configurations
- LibriSpeech test-other: 7.3% WER (Omni-router) vs 8.4% (Switch Transformer)

**Insight for our system:** MoE architectures demonstrate that different "experts" naturally specialize in different acoustic conditions. This validates our multi-engine routing approach -- different ASR engines (Deepgram, Google STT, Whisper) are effectively different "experts" that specialize in different speech patterns. The routing question is which expert to activate for each segment.

### 16.2 MoE for Accented Speech Recognition (2025)

**Paper:** "Mixture-of-Experts with Intermediate CTC Supervision for Accented Speech Recognition"
**Source:** [https://arxiv.org/html/2602.01967](https://arxiv.org/html/2602.01967)

Since accent is an **utterance-level attribute**, sequence-level MoE provides a natural fit:
- Different experts specialize in different accents
- Router learns to identify accent from audio features and route accordingly

**Relevance to reading assessment:** Children's speech is often modeled similarly to accented speech -- non-standard pronunciations, inconsistent articulation. MoE routing that specializes experts by speech pattern type (clear speech vs. disfluent speech) mirrors our routing between engines.

### 16.3 MoME/MoHAVE: Audio-Visual MoE (2025)

**Sources:** [https://arxiv.org/html/2510.04136v1](https://arxiv.org/html/2510.04136v1) | [https://arxiv.org/html/2502.10447](https://arxiv.org/html/2502.10447)

Recent MoE architectures for multimodal speech recognition:
- **MoME (Mixture of Matryoshka Experts):** Integrates sparse MoE into Matryoshka representation learning for LLM-based audio-visual ASR
- **MoHAVE (Mixture of Hierarchical Audio-Visual Experts):** Hierarchical expert routing for robust speech recognition

These demonstrate the trend toward **sparse, specialized expert routing** in modern ASR architectures.

---

## 17. GitHub Implementations and Open-Source Code {#17-implementations}

### 17.1 ASR-Specific Repositories

| Repository | Description | Relevance |
|-----------|-------------|-----------|
| [lchen001/FrugalML](https://github.com/lchen001/FrugalML) | Original FrugalML code | API routing framework tested on speech |
| [lm-sys/RouteLLM](https://github.com/lm-sys/RouteLLM) | LLM routing framework | Adaptable router architectures |
| [m-bain/whisperX](https://github.com/m-bain/whisperX) | WhisperX with word-level timestamps | Alignment pipeline |
| [nyrahealth/CrisperWhisper](https://github.com/nyrahealth/CrisperWhisper) | Improved Whisper timestamps + verbatim | Disfluency-aware ASR |
| [linto-ai/whisper-timestamped](https://github.com/linto-ai/whisper-timestamped) | DTW-based word timestamps + confidence | Word confidence scores |
| [espnet/espnet](https://github.com/espnet/espnet) | End-to-end speech toolkit | MoE, ensemble, lattice support |
| [modelscope/FunASR](https://github.com/modelscope/FunASR) | Alibaba's ASR toolkit | VAD, punctuation, ASR pipeline |
| [tencent-ailab/3m-asr](https://github.com/tencent-ailab/3m-asr) | Multi-loss, multi-path, multi-level ASR | Dynamic routing MoE |
| [anyscale/llm-router](https://github.com/anyscale/llm-router) | Tutorial for building LLM routers | Router training tutorial |
| [NVIDIA-AI-Blueprints/llm-router](https://github.com/NVIDIA-AI-Blueprints/llm-router) | NVIDIA's LLM routing blueprint | Production routing patterns |

### 17.2 Most Directly Applicable

**For immediate use:**
- **FrugalML** -- directly tested on speech recognition API routing. Could be adapted to route between Deepgram and Google STT with minimal changes.
- **RouteLLM** -- while designed for LLMs, its router architectures (matrix factorization, BERT classifier) are model-agnostic and could route ASR queries.
- **CrisperWhisper** -- provides verbatim transcription with accurate timestamps, ideal as our "heavy engine" for disfluent segments.

**For reference architecture:**
- **ESPnet** -- supports lattice generation, ROVER combination, and MoE training. Could be used to build a custom MoE ASR model for reading assessment.

### 17.3 Gap in the Ecosystem

**No existing open-source tool specifically implements ASR API routing.** All routing frameworks target LLM text generation. This is an opportunity: building an ASR-specific router (using FrugalML/RouteLLM principles but with audio features) would be a novel contribution.

---

## 18. Whisper Word-Level Timestamp Accuracy {#18-whisper-timestamps}

### 18.1 Whisper's Internal Word Aligner (September 2025)

**Paper:** "Whisper Has an Internal Word Aligner"
**Source:** [https://arxiv.org/html/2509.09987v1](https://arxiv.org/html/2509.09987v1)

**Discovery:** Specific decoder cross-attention heads in Whisper capture accurate word alignments despite never being explicitly trained for alignment.

**Technical details:**
- Only ~20 of 384 total attention heads consistently represent alignments
- These heads appear in 95% of samples when using character tokenization
- Oracle heads are distributed across decoder depths (not concentrated in output-adjacent layers)
- **L2 norm-based filtering** identifies alignment heads by measuring how peaked the attention distribution is

**DTW alignment extraction:**
```
Q(i,j) = min(Q(i-1,j), Q(i,j-1), Q(i-1,j-1)) - A_bar(i,j) / ||A_bar(:,j)||_2
```
Averages filtered heads, normalizes by column norm, extracts monotonic alignment.

**Accuracy comparison (F1 scores):**

| Method | TIMIT (50ms) | LibriSpeech (50ms) | AMI (50ms) |
|--------|-------------|-------------------|-----------|
| **This paper** | **80.7%** | **80.6%** | 61.9% |
| WhisperX | 79.9% | 79.5% | **63.5%** |
| CrisperWhisper | 74.0% | 76.7% | **64.9%** |
| This paper (100ms) | 94.7% | 93.4% | 77.4% |

**Key finding:** Using **character-level tokenization** produces finer and more accurate alignments than wordpieces, because longer output sequences encourage granular temporal correspondence with speech frames.

### 18.2 CrisperWhisper: Verbatim Timestamps (August 2024)

**Paper:** "CrisperWhisper: Accurate Timestamps on Verbatim Speech Transcriptions"
**Source:** [https://arxiv.org/html/2408.16589v1](https://arxiv.org/html/2408.16589v1)
**Code:** [https://github.com/nyrahealth/CrisperWhisper](https://github.com/nyrahealth/CrisperWhisper)

**Three innovations for timestamp accuracy:**

1. **Retokenization:** Strips spaces from token vocabulary (except space token itself). This lets DTW detect inter-word pauses properly. Standard Whisper's tokenizer embeds spaces at token beginnings, creating ambiguous alignment boundaries.

2. **AttentionLoss:** Specifically trains attention scores used for DTW alignment using timestamped data. This directly optimizes the attention heads for alignment accuracy.

3. **Pause heuristics:** Splits pause duration evenly between preceding and subsequent words, capped at 160ms, to prevent DTW from overestimating pause lengths.

**Performance on verbatim speech:**
- F1 at 0.2s collar: **84.7%** (CrisperWhisper) vs 76.7% (WhisperX) on synthetic data
- F1 on noisy data: **79.5%** vs 59.0% (WhisperX) -- much more robust to noise
- AMI WER: **9.72%** vs 16.82% (standard Whisper)

**Disfluency handling:**
- Detects filled pauses ('uh', 'um') by repurposing canonical tokens
- Fine-tuned with noise augmentation for speech artifacts
- 1% noise-only training samples with empty transcriptions to reduce hallucination
- Handles repetitions, false starts, partial words through verbatim transcription

**HIGHLY RELEVANT for our system:** CrisperWhisper is specifically designed for verbatim transcription with disfluency detection and accurate timestamps. Combined with the prompted Whisper approach (Section 5.1), CrisperWhisper could serve as an excellent heavy engine:
- Verbatim transcription captures exactly what the student said (including hesitations)
- Accurate timestamps enable precise alignment with expected text
- Noise robustness handles classroom recording conditions
- Open-source implementation is ready to use

### 18.3 WhisperX: Phoneme-Based Forced Alignment

**Source:** [https://github.com/m-bain/whisperX](https://github.com/m-bain/whisperX)

WhisperX uses a two-step process:
1. Whisper generates the transcript
2. A fine-tuned **Wav2Vec2.0 CTC phoneme model** force-aligns the transcript to audio

**Known issue ([GitHub Issue #1247](https://github.com/m-bain/whisperX/issues/1247)):** Word-level timestamps from WhisperX are inaccurate compared to Montreal Forced Aligner (MFA). Discrepancies between Whisper's transcript and the CTC model can degrade timestamp precision.

**Implication for our system:** For the heavy engine path where accurate timestamps are critical (aligning disfluent speech to expected text), CrisperWhisper's native DTW alignment may be more reliable than WhisperX's two-model approach, especially for non-standard speech.

### 18.4 whisper-timestamped: DTW + Confidence Scores

**Source:** [https://github.com/linto-ai/whisper-timestamped](https://github.com/linto-ai/whisper-timestamped)

Provides:
- Dynamic Time Warping on cross-attention weights
- **Word-level confidence scores** (derived from attention weights)
- Multilingual support

**Unique feature:** Unlike standard Whisper, this implementation provides per-word confidence scores, which could feed into our routing decision.

### 18.5 Timestamp Accuracy Summary for Our Pipeline

For reading assessment, we need accurate word-level timestamps to:
1. Align student speech to expected text
2. Measure reading rate (WCPM)
3. Detect pause locations and durations
4. Identify exactly where disfluencies occur

**Recommended approach:**
- Deepgram (fast engine): Native word timestamps + confidence -- adequate for fluent segments
- CrisperWhisper (heavy engine): Best verbatim timestamps with disfluency detection -- use for flagged segments
- **Do NOT rely on** standard Whisper timestamps for disfluent speech -- they degrade on non-standard utterances

---

## 19. Updated Synthesis: Enhanced Architecture {#19-updated-synthesis}

Incorporating Second Pass findings, the architecture evolves:

### Enhanced Tier 1: Deepgram Confidence + Interim Instability

```
Audio Stream --> Deepgram Nova-3 (streaming, endpointing=400ms)
                    |
                    +-- Track interim result evolution:
                    |     * Word confidence across interim updates
                    |     * Transcript stability (how much it changes)
                    |     * Endpointing timing patterns
                    |
                    +-- On is_final=true:
                          Compute routing features:
                          - mean_confidence (across words)
                          - min_confidence (weakest word)
                          - confidence_stddev
                          - interim_instability_score
                          - n_words_below_threshold
                          |
                          [Route Decision]
                          |
                    +-----+-----+
                    |           |
                 ACCEPT      ESCALATE
                 (>80%)      (<20%)
```

### Enhanced Tier 2: Agreement-Based Cascading (ABC)

When escalated, use the **agreement-based** approach from ABC:

```
Escalated Segment --> Google STT (with phrase hints from passage)
                        |
                        v
                  [Compare Deepgram vs Google STT outputs]
                        |
                  +-----+-----+
                  |           |
               AGREE       DISAGREE
               (accept     (escalate to Tier 3)
                either)
```

- If both engines produce the same transcription, we have high confidence
- If they disagree, the segment is genuinely ambiguous and needs the heavy engine
- **No confidence calibration needed** -- agreement is model-agnostic

### Enhanced Tier 3: CrisperWhisper + Prompted Whisper Fusion

For the hardest segments where Deepgram and Google STT disagree:

```
Disagreed Segment --> CrisperWhisper (verbatim + timestamps)
                        |
                        v
                   Align to expected text using:
                   - DTW on cross-attention (CrisperWhisper)
                   - Passage text as alignment reference
                   - Detect specific miscue types
```

### Cost Projection with Enhanced Architecture

| Tier | % of Segments | Cost per segment | Annual cost (10k min) |
|------|--------------|-----------------|----------------------|
| Tier 1 (Deepgram only) | 75% | $0.0043/min | $32.25 |
| Tier 2 (+ Google STT) | 15% | $0.0203/min | $30.45 |
| Tier 3 (+ CrisperWhisper) | 10% | $0.0203 + GPU | ~$25 + GPU |
| **Total** | 100% | | **~$88/10k min** |
| **vs. all-engines-always** | 100% | | **$203/10k min** |

**Savings: ~57% with better accuracy on hard segments.**

### New Routing Signals (from Second Pass)

| Signal | Source | Implementation Complexity |
|--------|--------|--------------------------|
| Interim confidence evolution | Deepgram streaming | Low -- track across WebSocket messages |
| Interim transcript stability | Deepgram streaming | Low -- diff successive interim results |
| Agreement between engines | Deepgram + Google STT | Medium -- requires running 2nd engine |
| Expected text deviation | Alignment with passage | Medium -- requires text alignment |
| Google STT phrase hint boost mismatch | Google STT adaptation | Medium -- compare boosted vs unboosted |
| Early-exit confidence | Custom ASR model | High -- requires model training |

---

## Updated References (Second Pass)

19. **FrugalML** -- [arXiv:2006.07512](https://arxiv.org/abs/2006.07512) -- Cost-optimal ML API routing framework (tested on speech)
20. **FrugalMCT** -- [arXiv:2102.09127](https://arxiv.org/abs/2102.09127) -- Online multi-label API selection
21. **FrugalGPT** -- [arXiv:2305.05176](https://arxiv.org/abs/2305.05176) -- LLM cascade with 98% cost reduction
22. **RouteLLM** -- [GitHub](https://github.com/lm-sys/RouteLLM) | [arXiv:2406.18665](https://arxiv.org/abs/2406.18665) -- Open-source LLM routing framework (ICLR 2025)
23. **Cascade Routing** -- [arXiv:2410.10347](https://arxiv.org/html/2410.10347v1) -- Unified routing + cascading (ICLR 2025)
24. **Agreement-Based Cascading** -- [arXiv:2407.02348](https://arxiv.org/abs/2407.02348) -- Training-free black-box cascading
25. **Early-Exit ASR** -- [arXiv:2309.09546](https://arxiv.org/html/2309.09546v2) -- Adaptive depth for Conformer/Wav2Vec2 ASR
26. **Splitformer** -- [arXiv:2506.18035](https://arxiv.org/html/2506.18035) -- Improved early-exit for edge ASR (EUSIPCO 2025)
27. **Speculative Cascades** -- [Google Research Blog](https://research.google/blog/speculative-cascades-a-hybrid-approach-for-smarter-faster-llm-inference/) -- Production cascade serving
28. **C3PO** -- [arXiv:2511.07396](https://arxiv.org/pdf/2511.07396) -- Conformally-controlled cascades (NeurIPS 2025)
29. **xRouter** -- [arXiv:2510.08439](https://arxiv.org/html/2510.08439v1) -- RL-based routing
30. **Deepgram Interim Results** -- [Docs](https://developers.deepgram.com/docs/interim-results) -- Streaming confidence and endpointing
31. **Google STT Adaptation** -- [Docs](https://docs.cloud.google.com/speech-to-text/docs/adaptation-model) -- Phrase hints and boost
32. **Omni-Router MoE** -- [arXiv:2507.05724](https://arxiv.org/html/2507.05724) -- Shared routing for MoE ASR
33. **MoE Accented ASR** -- [arXiv:2602.01967](https://arxiv.org/html/2602.01967) -- Expert specialization for accents
34. **Whisper Internal Aligner** -- [arXiv:2509.09987](https://arxiv.org/html/2509.09987v1) -- Attention head alignment discovery
35. **CrisperWhisper** -- [arXiv:2408.16589](https://arxiv.org/html/2408.16589v1) | [GitHub](https://github.com/nyrahealth/CrisperWhisper) -- Verbatim timestamps with disfluency
36. **WCN for SLU** -- [arXiv:2401.02921](https://arxiv.org/html/2401.02921v1) -- Word confusion networks + LLM in-context learning
37. **Awesome AI Model Routing** -- [GitHub](https://github.com/Not-Diamond/awesome-ai-model-routing) -- Curated list of routing tools
38. **Adaptive Context Biasing** -- [PMC12328576](https://pmc.ncbi.nlm.nih.gov/articles/PMC12328576/) -- Inference-time vocabulary adaptation for ASR
