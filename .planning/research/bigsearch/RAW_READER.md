# Ensemble ASR Research: Extracted Findings for Educational Reading Assessment

**Compiled: 2026-02-06**
**Purpose: Inform ensemble ASR architecture for real-time reading assessment of struggling middle schoolers**

---

## Table of Contents

1. [ROVER and Classic Ensemble Methods](#1-rover-and-classic-ensemble-methods)
2. [Confidence-Based ASR Ensembles](#2-confidence-based-asr-ensembles)
3. [LLM-Based ASR Error Correction](#3-llm-based-asr-error-correction)
4. [Multi-System ASR Combination](#4-multi-system-asr-combination)
5. [Children's Speech Recognition](#5-childrens-speech-recognition)
6. [Reading Assessment and Miscue Detection](#6-reading-assessment-and-miscue-detection)
7. [Whisper Ensemble and Multi-Model Approaches](#7-whisper-ensemble-and-multi-model-approaches)
8. [ASR Disfluency Detection](#8-asr-disfluency-detection)
9. [Streaming/Real-Time ASR Considerations](#9-streamingreal-time-asr-considerations)
10. [Industry ASR Benchmarks and Ensemble Practices](#10-industry-asr-benchmarks-and-ensemble-practices)
11. [GitHub Implementations](#11-github-implementations)
12. [Synthesis: Relevance to Our Reading Assessment System](#12-synthesis-relevance-to-our-reading-assessment-system)

---

## 1. ROVER and Classic Ensemble Methods

### 1.1 Original ROVER (Fiscus, 1997)

**Source:** [NIST ROVER Publication](https://www.nist.gov/publications/post-processing-system-yield-reduced-word-error-rates-recognizer-output-voting-error)

**Method:** ROVER (Recognizer Output Voting Error Reduction) is a two-stage system:
1. **Stage 1 - Alignment:** Aligns the output of two or more hypothesis transcripts from ASR systems to generate a single composite Word Transition Network (WTN).
2. **Stage 2 - Voting:** Scores the composite WTN using voting procedures (majority vote or confidence-weighted vote) to select the best word at each position.

**Architecture:** Multiple ASR systems produce independent transcripts -> pairwise alignment into a unified WTN -> word-level voting/selection -> final composite output.

**Key Property:** ROVER is the gold standard for ASR output combination and continues to be actively used in 2024-2025 research.

---

### 1.2 Ensembles of Hybrid and End-to-End Speech Recognition (LREC-COLING 2024)

**Source:** [ACL Anthology - LREC-COLING 2024](https://aclanthology.org/2024.lrec-main.547/)

**Abstract (extracted):** "We propose a method to combine the hybrid Kaldi-based Automatic Speech Recognition (ASR) system with the end-to-end wav2vec 2.0 XLS-R ASR using confidence measures."

**Method Details:**
- Combines two architecturally distinct ASR systems:
  - **Hybrid system:** Kaldi-based ASR with native confidence scoring
  - **End-to-end system:** wav2vec 2.0 XLS-R model
- Uses **Renyi's entropy-based confidence** approach with **temperature scaling** to align confidence scores from different system types
- Ensembles via ROVER for mutual error correction

**WER Results:**
- Individual systems: No significant WER difference between hybrid and E2E alone
- **After ROVER ensembling: ~14% WERR (Word Error Rate Reduction) on primary test set**
- **~20% WERR on noisy and imbalanced test data**

**Conclusion:** Ensemble learning through ROVER effectively facilitates error correction between complementary ASR systems even when individual systems have comparable performance. The key is calibrating confidence scores across different architectures.

**Real-time/Streaming:** Not addressed.
**Children's/Disfluent Speech:** Not addressed (focused on Irish language, low-resource).

---

### 1.3 LV-ROVER: Lexicon Verified ROVER

**Source:** [arXiv:1707.07432](https://arxiv.org/abs/1707.07432)

**Method:** Extends ROVER by adding lexicon verification step to the voting process, filtering out non-lexical candidates.

---

## 2. Confidence-Based ASR Ensembles

### 2.1 Confidence-based Ensembles of End-to-End Speech Recognition Models (INTERSPEECH 2023)

**Source:** [arXiv:2306.15824](https://arxiv.org/abs/2306.15824)

**Full Abstract:** "The number of end-to-end speech recognition models grows every year. These models are often adapted to new domains or languages resulting in a proliferation of expert systems that achieve great results on target data, while generally showing inferior performance outside of their domain of expertise. We explore combination of such experts via confidence-based ensembles: ensembles of models where only the output of the most-confident model is used. We assume that models' target data is not available except for a small validation set. We demonstrate effectiveness of our approach with two applications. First, we show that a confidence-based ensemble of 5 monolingual models outperforms a system where model selection is performed via a dedicated language identification block. Second, we demonstrate that it is possible to combine base and adapted models to achieve strong results on both original and target data. We validate all our results on multiple datasets and model architectures."

**Method Details:**
- **Selection mechanism:** Uses logistic regression trained on just 100 utterances per dataset to map confidence vectors to model indices
- For 2-model ensemble: decision rule `a*c1 + b*c2 > c` where confidence scores have weighted coefficients
- **Confidence estimation:** Renyi entropy with linear normalization, mean aggregation, T=1.0, alpha=0.25, excluding blank symbols
- Only the output of the **most-confident model** is used (not word-level fusion)

**WER Results:**
- Multilingual (5 languages): ~10% relative WER reduction vs. state-of-the-art LID systems
- Accent/dialect adaptation: 10-50% WERR on target data vs. constrained adaptation
- Computational efficiency: Using intermediate encoder layers (4 of 18) enables 4.5x runtime reduction for model selection

**Key Limitations (critical for our use case):**
- Works poorly for **latency-critical applications** -- needs several seconds of audio for reliable selection
- Computational costs scale linearly with ensemble size
- Utterance-level selection, NOT word-level fusion

**Real-time/Streaming:** Explicitly noted as problematic -- needs multi-second audio segments.
**Children's/Disfluent Speech:** Not addressed.

---

### 2.2 ASR Confidence Score Reliability (2025)

**Source:** [arXiv:2503.15124](https://arxiv.org/html/2503.15124v1)

**Abstract (extracted):** Investigated whether confidence scores from ASR systems can reliably detect transcription errors. Analyzed 120 recordings using nine ASR providers.

**Key Finding - CRITICAL FOR OUR SYSTEM:** Current confidence scores are **"insufficient for automated error detection and can be misleading."**
- Precision: 0.41-0.55 (only half of detected errors were actual errors)
- Recall: 0.36-0.64 (approximately half of errors were missed)
- F1-scores: 0.33-0.55 (poor to moderate)
- Point-biserial correlation between confidence and word correctness was "weak to moderate"

**ASR Systems Evaluated:** Amazon, AssemblyAI, Deepgram, Google, IBM, Rev AI, Speechmatics, SpeechText.AI, Whisper

**Conclusion:** Error highlighting based on confidence scores "neither improved correction efficiency nor was perceived as helpful" by users.

**Implication for our system:** Word-level confidence scores from individual ASR systems should NOT be trusted in isolation. Ensemble agreement across multiple systems may be a more reliable error indicator than any single system's confidence score.

---

## 3. LLM-Based ASR Error Correction

### 3.1 ASR Error Correction using Large Language Models (2024)

**Source:** [arXiv:2409.09554](https://arxiv.org/abs/2409.09554)

**Abstract (extracted):** "Error correction (EC) models play a crucial role in refining Automatic Speech Recognition (ASR) transcriptions, enhancing the readability and quality of transcriptions."

**Method Details:**
1. **N-best list utilization:** Leverages N-best ASR hypotheses (not just 1-best) for improved contextual information
2. **Constrained decoding:** Restricts LLM output based on N-best lists or ASR lattices -- particularly beneficial for unseen domains
3. **Cross-system applicability:** EC models function across different ASR systems without retraining
4. **Zero-shot correction:** Uses ChatGPT without fine-tuning

**Key Property:** Serves as an effective **model ensembling technique** -- the LLM implicitly combines information from multiple hypotheses.

**Real-time/Streaming:** Not addressed.
**Children's/Disfluent Speech:** Not addressed.

---

### 3.2 GenSEC Challenge: LLM-Based Generative Error Correction (NVIDIA, 2024)

**Source:** [NVIDIA Research](https://research.nvidia.com/publication/2024-12_large-language-model-based-generative-error-correction-challenge-and-baselines) | [arXiv:2409.09785](https://arxiv.org/html/2409.09785v3)

**Abstract (extracted):** Introduces the generative speech transcription error correction (GenSEC) challenge with three post-ASR language modeling tasks: transcription correction, speaker tagging, and emotion recognition. Explores "how large language models (LLMs) can enhance acoustic modeling tasks."

**Architecture:** Cascaded ASR-LLM pipeline:
1. First-pass ASR decoding (Whisper-based)
2. Second-pass LLM correction/postprocessing
3. Task-specific inference modules

**WER Results (Task 1 - Post-ASR Correction):**

| System | Train WER | Test WER |
|--------|-----------|----------|
| Whisper-1.5B baseline | 10.43% | 11.82% |
| N-best Oracle | 9.61% | 9.32% |
| T5-750M Correction | 9.21% | 9.05% |
| LLaMA-13B Correction | 8.62% | 8.63% |
| LLaMA2-7B Correction | 8.71% | **8.33%** |

**Key Insight:** LLM correction reduced Whisper WER from 11.82% to 8.33% -- a **29.5% relative improvement**.

**Conclusion:** "By leveraging LLMs, even text-only output from first-pass ASR system might be enriched with paralinguistic and meta-information."

**Real-time/Streaming:** Not addressed -- batch post-processing only.
**Children's/Disfluent Speech:** Not addressed (LibriSpeech, WSJ, SwitchBoard datasets).

---

### 3.3 ProGRes: Prompted Generative Rescoring on ASR N-Best (2024)

**Source:** [arXiv:2409.00217](https://arxiv.org/html/2409.00217)

**Abstract (extracted):** Presents a zero-shot methodology leveraging instruction-tuned LLMs to dynamically expand ASR n-best hypotheses through prompted generation, combining confidence scores, LLM sequence scoring, and hypothesis generation.

**Architecture - Three Core Components:**
1. **Prompted Generation:** Instruction-tuned LLM analyzes N-best list and generates improved transcription hypothesis
2. **LLM Scoring:** Open-weight LLM (Llama-3) computes pseudo-log-likelihood: `LLMscore(w) = Sum log P_LLM(wt|w1...wt-1)`
3. **ASR Scoring:** Evaluates acoustic evidence by negating ASR model's loss function

**Integration:** `score = (1-alpha)*ASRscore + alpha*LLMscore` with alpha tuned on validation data.

**WER Results:**
- ASR1 (mismatched): 42.94% -> 40.84% (4.9% relative improvement with GPT-4)
- ASR2 (matched): 12.38% -> 9.32% (**24.7% relative improvement** with GPT-4)
- 87.5% of experiments showed improvement over baselines

**Key Insight:** LLMs excel at refining near-correct outputs rather than salvaging severely degraded recognition. Best gains when baseline is already reasonable.

**Real-time/Streaming:** Not addressed. Computational complexity noted as limitation.
**Children's/Disfluent Speech:** Not addressed.

---

### 3.4 Confidence-Guided Error Correction for Disordered Speech (2025)

**Source:** [arXiv:2509.25048](https://arxiv.org/abs/2509.25048)

**Abstract (extracted):** Investigates LLMs as post-processing modules for ASR, proposing "confidence-informed prompting, where word-level uncertainty estimates are embedded directly into LLM training."

**Method:** Embeds ASR confidence scores into prompts during fine-tuning, directing the model toward uncertain regions while reducing overcorrection. Uses fine-tuned LLaMA 3.1.

**WER Results:**
- **Speech Accessibility Project: 10% relative WER reduction** vs. naive LLM correction
- **TORGO dataset: 47% relative reduction** -- highly effective on impaired/disordered speech

**Key Relevance:** This paper directly addresses **disordered speech** and shows that confidence-aware LLM correction is particularly effective for atypical speech patterns. This is highly relevant to our use case with struggling readers who may exhibit disfluent speech.

**Real-time/Streaming:** Not addressed.

---

### 3.5 Whisper-LM: Improving ASR with Language Models (2025)

**Source:** [arXiv:2503.23542](https://arxiv.org/abs/2503.23542)

**Method:** Integrates N-gram and LLM language models with fine-tuned Whisper during beam search decoding:
`Q(c|x) = log(P_acoustic(c|x)) + alpha * log(P_LM(c)) + beta * word_count(c)`

**WER Improvements:**
- N-gram LM: Up to **51% improvement** (in-distribution), up to **34%** (out-of-distribution)
- LLM integration: More modest (4-23%) but **superior robustness** across distribution shifts
- LLMs maintained performance more reliably under distribution shifts

**Key Insight for our use case:** N-grams provide maximum accuracy gains when in-domain data is available, but LLMs provide better robustness to unseen conditions. For children's reading (where we may see unexpected speech patterns), LLM-based integration may be more reliable.

---

## 4. Multi-System ASR Combination

### 4.1 Comparative Analysis on ASR System Combination (2025)

**Source:** [arXiv:2508.09880](https://arxiv.org/html/2508.09880v1)

**Abstract (extracted):** Investigates combining multiple ASR architectures through a two-pass methodology using log-linear combination of sequence-level scores.

**Method:** Two-stage approach:
1. Generate N-best hypotheses from individual models using native decoding
2. Merge candidate lists and rescore using both models with weights summing to 1.0 (grid search on dev data)

**Systems Combined:**
- CTC (Connectionist Temporal Classification)
- mRNN-T (monotonic RNN Transducer)
- Factored Hybrid (FH)
- AED (Attention Encoder-Decoder) with LSTM decoder
- All use 12-layer Conformer encoders, 512-dim hidden states, trained on LibriSpeech 960h

**WER Results (LibriSpeech test-other):**

| System | WER |
|--------|-----|
| Standalone FH | 6.0% |
| Standalone AED (10K BPE) | 5.4% |
| FH + AED combined | 5.1% |
| Two identical AED models (different seed) | 5.1% |
| Best (FH + Transformer LM) | **3.7%** |

**Critical Finding:** "Diversity of combined models is **not necessarily correlated** with performance." Two identical AED models differing only in training seed performed comparably to architecturally distinct combinations. The gains come from complementary exploration of the search space, not model diversity per se.

**Hypothesis Overlap:** ~150 utterances showed 15 of 16 different hypotheses across two AED variants, showing even same-architecture models explore different search spaces.

**Real-time/Streaming:** Not addressed.
**Children's/Disfluent Speech:** Not addressed (LibriSpeech adult speech only).

---

### 4.2 Multi-Model Speech Ensemble (Blog/Tutorial)

**Source:** [Arun Baby - Multi-Model Speech Ensemble](https://arunbaby.com/speech-tech/0014-multi-model-speech-ensemble/)

**Methods Described:**

1. **ROVER:** Aligns hypotheses from different models and votes on words at each time position
2. **Confidence-Based Fusion:** Selects highest-confidence word at each position
3. **Voting-Based Fusion:** Majority voting, useful when model quality is similar

**Pipeline Architecture:**
1. Audio preprocessing (resampling, normalization, feature extraction)
2. Parallel execution across N ASR models (Wav2Vec2, Conformer, Whisper, RNN-T)
3. Fusion module combining outputs
4. Optional language model rescoring
5. Confidence aggregation

**Model Selection via Backtracking:** Dynamic selection considering audio SNR, accent, domain, resource constraints, and model specialization.

**Reported Performance Improvements:**

| Organization | WER Reduction |
|---|---|
| Google | 15% |
| Amazon | 12% |
| Microsoft | 20% |
| Apple | 10% |

- Google Voice Search: 2.5% WER ensemble vs. 4.9% single model with 120ms p95 latency

**Key Findings:**
- **3-5 diverse models** capture most ensemble benefits; diminishing returns beyond
- Specialization (accent, noise, domain) outperforms general models
- Dynamic selection based on input characteristics improves efficiency
- **Streaming requires incremental fusion approaches**
- Cost-benefit supports ensembles despite 3x compute increase

---

## 5. Children's Speech Recognition

### 5.1 Kid-Whisper: Bridging Performance Gap (AAAI/ACM AIES 2024)

**Source:** [AAAI Proceedings](https://ojs.aaai.org/index.php/AIES/article/view/31618)

**Focus:** Addresses the significant performance gap in ASR between children's and adults' speech.

**WER Results (MyST testset):**
- Whisper-Small: 13.93% -> **9.11%** (after Kid-Whisper fine-tuning)
- Whisper-Medium: 13.23% -> **8.61%** (after Kid-Whisper fine-tuning)
- Improvements generalize to unseen datasets

**Key Challenge:** Limited availability of suitable child-specific databases and distinct characteristics of children's speech (higher pitch, less consistent pronunciation, more variable speaking rate).

---

### 5.2 Adaptation of Whisper Models to Child Speech (2023)

**Source:** [arXiv:2307.13008](https://arxiv.org/abs/2307.13008)

**Abstract:** "Automatic Speech Recognition (ASR) systems often struggle with transcribing child speech due to the lack of large child speech datasets required to accurately train child-friendly ASR models. However, there are huge amounts of annotated adult speech datasets which were used to create multilingual ASR models, such as Whisper. Our work aims to explore whether such models can be adapted to child speech to improve ASR for children."

**Key Finding:** Fine-tuning Whisper on child speech yields significant improvements. However, **wav2vec2 models fine-tuned on child speech outperformed Whisper fine-tuning**.

**Ensemble Methods:** Not used in this study.

---

### 5.3 Sparsely Shared LoRA (S2-LoRA) on Whisper for Child Speech (2023)

**Source:** [arXiv:2309.11756](https://arxiv.org/html/2309.11756v2)

**Method:** Novel PEFT approach called Sparsely Shared LoRA (S2-LoRA) for adapting Whisper to children's speech with minimal parameters.

**Relevance:** Enables multiple lightweight child-speech-adapted models that could form an ensemble with minimal memory overhead.

---

## 6. Reading Assessment and Miscue Detection

### 6.1 A Dataset and Two-Pass System for Reading Miscue Detection (Interspeech 2024)

**Source:** [ISCA Archive - Interspeech 2024](https://www.isca-archive.org/interspeech_2024/gothi24_interspeech.html)

**Abstract (extracted):** Presents automatic detection of mispronounced words in oral reading assessments. Notes that "accurate detection of mispronounced words, which can be relatively few in number, while limiting false positives, remains challenging."

**Dataset:** 1,110 elementary school children reading connected text in L2 English with wide-ranging proficiencies. Total audio: 19 hours, uniformly distributed across three grades.

**Two-Pass System Architecture:**
1. **First pass:** Hybrid ASR with linguistic context constraints (prior knowledge of reading prompts limits WER)
2. **Second pass:** Refines initial hypotheses using local features from alternate decodings under different linguistic contexts + deep acoustic model

**Miscue Labels:** Ground-truth labels derived by comparing manual transcription with aligned text prompts: Correct/Substitution/Deletion/Insertion (Cor/Sub/Del/Ins)

**Key Relevance:** Directly addresses our use case -- children's oral reading miscue detection. The two-pass architecture with prompt-constrained first pass is highly relevant.

---

### 6.2 Reading Miscue Detection in Primary School through ASR (Interspeech 2024)

**Source:** [arXiv:2406.07060](https://arxiv.org/abs/2406.07060)

**ASR Models Evaluated for Dutch Children's Speech:**
- **HuBERT Large** (fine-tuned on Dutch): Best phoneme-level, PER = 23.1%
- **Whisper** (Faster Whisper Large-v2): Best word-level, WER = 9.8%
- **Wav2Vec2 Large:** Best for miscue detection

**Miscue Detection Performance:**
- Wav2Vec2 Large: **Recall = 0.83** (catches most miscues)
- Whisper: **Precision = 0.52, F1 = 0.52** (fewer false positives)

**Critical Insight for Our System:** Different ASR models excel at different aspects of miscue detection. Wav2Vec2 has high recall (catches errors), Whisper has better precision (fewer false alarms). **An ensemble combining both could achieve high recall AND high precision** -- exactly what we need.

---

### 6.3 Can ASR Generate Valid Measures of Child Reading Fluency? (Interspeech 2025)

**Source:** [ISCA Archive](https://www.isca-archive.org/interspeech_2025/harmsen25_interspeech.html)

**Study:** 244 recordings from 131 Dutch primary school children (ages 6-13), 15 measures for phrasing, smoothness, and pacing.

**Key Finding:** "Strong correlations for 12 out of 15 measures" between ASR-derived and human-derived fluency measures.

**Conclusion:** "Great potential of these measures for more reliable, less time-consuming and sustainable reading assessment."

---

### 6.4 Speech Enabled Reading Fluency Assessment: Validation Study (2025)

**Source:** [Springer - IJAIED](https://link.springer.com/article/10.1007/s40593-025-00480-y)

**System:** SERDA (Speech Enabled Reading Diagnostics App) -- Dutch oral reading fluency assessment for primary school.

**Assessment Components:** Accuracy, speed, automaticity, and prosody.

---

### 6.5 Improving ORF Assessment Through Sub-Sequence Matching (ICASSP 2024)

**Source:** [SMU Publication](https://s2.smu.edu/~eclarson/pubs/2024_icassp_orf.pdf)

**Method:** Uses ASR + sub-sequence matching of stemmed words with neural network embeddings.
**Results:** MAE reduced from baseline 15.1 to 8.4 (50% error reduction vs. ASR-only methods).

---

### 6.6 Deep Learning for Assessment of Oral Reading Fluency (2024)

**Source:** [arXiv:2405.19426](https://arxiv.org/abs/2405.19426)

**Method:** Uses wav2vec2.0 pre-trained model for end-to-end learning of reading fluency from children's audio recordings.

**Focus:** Investigates whether learned embeddings capture lexical and acoustic-prosodic features known to be important to fluency perception.

---

## 7. Whisper Ensemble and Multi-Model Approaches

### 7.1 Current Whisper Model Variants

**Models available for ensembling:**
- Whisper Tiny (39M), Base (74M), Small (244M), Medium (769M), Large-v3 (1.5B)
- Whisper Large-V3-Turbo: optimized for speed
- Kid-Whisper variants: fine-tuned for children's speech

### 7.2 Gladia Whisper-Zero: Commercial Whisper Ensemble

**Source:** [Gladia Blog](https://www.gladia.io/blog/a-review-of-the-best-asr-engines-and-the-models-powering-them-in-2024)

**Architecture:** "An ML ensemble, where each step is powered by the enhanced Whisper architecture combined with several additional AI models."
- Multi-tier approach targeting superior accuracy and speed
- Supports live transcription with timestamps
- "Partial transcripts in <100ms" for real-time conversations

**Relevance:** Demonstrates that Whisper-based ensembles are commercially viable and can achieve real-time performance.

---

## 8. ASR Disfluency Detection

### 8.1 Augmenting ASR Models with Disfluency Detection (2024)

**Source:** [arXiv:2409.10177](https://arxiv.org/abs/2409.10177)

**Abstract:** "Speech disfluency commonly occurs in conversational and spontaneous speech. However, standard ASR models struggle to accurately recognize these disfluencies because they are typically trained on fluent transcripts."

**Method -- Inference-Only Approach (no fine-tuning required):**
1. **Modified CTC-Based Forced Alignment:** Predicts word-level timestamps while preserving information about disfluent speech segments
2. **Gap Classification Model:** Identifies alignment gaps between predicted timestamps, classifying each as containing disfluent speech or silence

**Results:**
- Gap classification accuracy: **81.62%**, F1-score: **80.07%**
- Recovery rate: **74.13%** of words initially missed by transcription were captured

**Key Relevance:** This inference-only approach could be layered on top of ANY ASR system in our ensemble, detecting disfluencies in the gaps between recognized words. Highly relevant for struggling readers who may exhibit repetitions, false starts, and hesitations.

---

### 8.2 FluencyBank Timestamped Dataset (2024)

**Source:** [ASHA Journals](https://pubs.asha.org/doi/10.1044/2024_JSLHR-24-00070)

**Dataset:** Updated transcripts with disfluency annotations and word timings. Targets intended speech recognition for people with high rates of disfluencies.

---

## 9. Streaming/Real-Time ASR Considerations

### 9.1 Key Latency Findings

**From industry benchmarks:**
- Sub-300ms latency is achievable with modern streaming ASR
- Deepgram Nova-3: ~160 audio file seconds per second of processing
- Google Voice Search ensemble: 120ms p95 latency with 2.5% WER

**From NVIDIA NeMo:**
- Cache-aware streaming Parakeet (FastConformer) encoder with RNN-T decoder
- Processes only new audio chunks while reusing cached encoder context
- Real-time factors below 0.2

**Streaming ensemble considerations:**
- Confidence-based model selection needs several seconds of audio -- problematic for real-time
- Word-level ROVER-style fusion can work incrementally
- Dynamic model selection based on input characteristics (SNR, speaking rate) is viable

### 9.2 Latency Budget for Reading Assessment

For reading assessment of middle schoolers:
- Oral reading passages typically 1-3 minutes
- Real-time feedback not strictly necessary (assessment can be post-passage)
- But real-time word tracking improves user experience
- Suggested approach: **streaming primary ASR + batch ensemble correction**

---

## 10. Industry ASR Benchmarks and Ensemble Practices

### 10.1 Current WER Benchmarks (2025-2026)

**Source:** [Deepgram Comparison](https://deepgram.com/learn/best-speech-to-text-apis-2026)

| Provider | WER (batch) | Real-time Latency |
|---|---|---|
| Deepgram Nova-3 | 5.26% | <300ms |
| OpenAI Whisper Large V3 Turbo | ~5.4% | Varies |
| Azure Speech-to-Text | 13-23% (quality-dependent) | WebSocket streaming |
| Google Cloud STT | ~5-7% | Streaming available |

**Important caveat:** "Many published WER statistics represent 'easy' audio. Real-world audio produces significantly different results." For children's speech, expect WER 2-5x higher than published benchmarks.

---

## 11. GitHub Implementations

### 11.1 NIST SCTK/ROVER

**Source:** [GitHub - usnistgov/SCTK](https://github.com/usnistgov/SCTK/blob/master/doc/rover/rover.htm)

Official ROVER implementation with comprehensive documentation. Reference implementation for word transition network alignment and voting.

### 11.2 ROVER Algorithm (Python Gist)

**Source:** [GitHub Gist - kastnerkyle](https://gist.github.com/kastnerkyle/7b6be9cc2d77f1301b75fd2d8c1c894f)

Educational Python implementation of the ROVER algorithm. Useful starting point for custom implementations.

### 11.3 Whisper Child ASR

**Source:** [GitHub - C3Imaging/whisper_child_asr](https://github.com/C3Imaging/whisper_child_asr)

Implementation for adapting Whisper to children's speech recognition.

### 11.4 E2E ASR and Disfluency Removal Evaluator

**Source:** [GitHub - pariajm/e2e-asr-and-disfluency-removal-evaluator](https://github.com/pariajm/e2e-asr-and-disfluency-removal-evaluator)

Evaluation metric for end-to-end speech recognition and disfluency removal systems.

### 11.5 MPS Dataset for Reading Miscue Detection

**Source:** [GitHub - DAP-Lab/mps_dataset](https://github.com/DAP-Lab/mps_dataset)

Dataset from Interspeech 2024 paper on reading miscue detection with 1,110 elementary school children.

---

## 12. Synthesis: Relevance to Our Reading Assessment System

### 12.1 Most Promising Ensemble Architecture

Based on the research surveyed, the most promising architecture for our reading assessment system would be a **hybrid multi-tier ensemble**:

**Tier 1 - Streaming Primary ASR (Real-Time):**
- Google Cloud STT or Deepgram (low latency, word-level timestamps)
- Provides immediate word tracking for the UI

**Tier 2 - Parallel Batch ASR (Near-Real-Time):**
- Whisper Large-v3 (or Kid-Whisper fine-tuned) for high-accuracy transcription
- Wav2Vec2 (fine-tuned on children's speech) for high-recall miscue detection
- Process in overlapping chunks with ~1-2 second delay

**Tier 3 - ROVER/Confidence Fusion:**
- Align outputs from Tier 1 + Tier 2 using word transition networks
- Confidence-weighted voting with calibrated scores (temperature scaling + Renyi entropy)
- Flag disagreements between systems as potential miscues

**Tier 4 - LLM Post-Processing (Optional, Batch):**
- Confidence-guided LLM correction using word-level uncertainty
- Particularly valuable for disordered/disfluent speech (47% improvement on TORGO)
- Can run post-passage for detailed assessment

### 12.2 Key Research-Backed Design Decisions

1. **Use 3-5 diverse models** -- captures most ensemble benefits (diminishing returns beyond 5)
2. **Calibrate confidence scores across systems** using temperature scaling before fusion
3. **Combine high-recall and high-precision models** (Wav2Vec2 + Whisper for miscue detection)
4. **Do NOT rely on single-system confidence scores** for error detection (F1 only 0.33-0.55)
5. **System disagreement is a stronger signal** than any individual confidence score
6. **Two-pass architecture** with prompt-constrained first pass is validated for reading assessment
7. **LLM correction is most effective for near-correct outputs** (24.7% improvement when baseline is reasonable)
8. **Disfluency detection via gap analysis** can be layered on any ASR system without fine-tuning
9. **Even same-architecture models with different seeds explore different search spaces** -- model diversity is not strictly required for ensemble gains

### 12.3 Open Questions for Further Investigation

1. How to best adapt adult-speech-trained ensembles to middle school children's speech?
2. What is the optimal latency/accuracy tradeoff for real-time reading assessment?
3. Can prompt-constrained decoding (knowing the target passage) dramatically reduce WER for our specific use case?
4. How to handle code-switching or dialectal variation in struggling readers?
5. What minimum training data is needed to calibrate confidence scores for our specific student population?

### 12.4 Estimated WER Improvements

Based on the literature:
- Single model on children's speech: ~10-15% WER
- Fine-tuned for children (Kid-Whisper): ~8-9% WER
- Ensemble of 3-5 models with ROVER: Additional 14-20% WERR -> ~6.5-7.7% WER
- With LLM post-processing: Additional 10-25% WERR -> ~5-7% WER
- With passage-constrained decoding: Potentially much lower (reading known text)

---

## Sources Consulted

1. [NIST ROVER](https://www.nist.gov/publications/post-processing-system-yield-reduced-word-error-rates-recognizer-output-voting-error)
2. [Ensembles of Hybrid and E2E ASR - LREC-COLING 2024](https://aclanthology.org/2024.lrec-main.547/)
3. [Confidence-based Ensembles - INTERSPEECH 2023](https://arxiv.org/abs/2306.15824)
4. [ASR Error Correction using LLMs](https://arxiv.org/abs/2409.09554)
5. [GenSEC Challenge - NVIDIA](https://arxiv.org/html/2409.09785v3)
6. [ProGRes: Prompted Generative Rescoring](https://arxiv.org/html/2409.00217)
7. [Confidence-Guided Error Correction for Disordered Speech](https://arxiv.org/abs/2509.25048)
8. [Whisper-LM for Low-Resource Languages](https://arxiv.org/abs/2503.23542)
9. [ASR System Combination Comparative Analysis](https://arxiv.org/html/2508.09880v1)
10. [Multi-Model Speech Ensemble Tutorial](https://arunbaby.com/speech-tech/0014-multi-model-speech-ensemble/)
11. [Kid-Whisper - AAAI/ACM AIES 2024](https://ojs.aaai.org/index.php/AIES/article/view/31618)
12. [Whisper Adaptation for Child Speech](https://arxiv.org/abs/2307.13008)
13. [Two-Pass Reading Miscue Detection - Interspeech 2024](https://www.isca-archive.org/interspeech_2024/gothi24_interspeech.html)
14. [Reading Miscue Detection in Primary School](https://arxiv.org/abs/2406.07060)
15. [ASR for Child Reading Fluency - Interspeech 2025](https://www.isca-archive.org/interspeech_2025/harmsen25_interspeech.html)
16. [Augmenting ASR with Disfluency Detection](https://arxiv.org/abs/2409.10177)
17. [ASR Confidence Scores for Error Detection](https://arxiv.org/html/2503.15124v1)
18. [Gladia ASR Engines Review 2024](https://www.gladia.io/blog/a-review-of-the-best-asr-engines-and-the-models-powering-them-in-2024)
19. [Speech-to-Text API Benchmarks 2026](https://deepgram.com/learn/best-speech-to-text-apis-2026)
20. [NIST SCTK/ROVER Implementation](https://github.com/usnistgov/SCTK/blob/master/doc/rover/rover.htm)
21. [Sparsely Shared LoRA for Child Speech](https://arxiv.org/html/2309.11756v2)
22. [ORF Sub-Sequence Assessment - ICASSP 2024](https://s2.smu.edu/~eclarson/pubs/2024_icassp_orf.pdf)
23. [Deep Learning for ORF Assessment](https://arxiv.org/abs/2405.19426)
24. [ASR Survey: Modern Era](https://arxiv.org/html/2510.12827)
25. [MPS Dataset - GitHub](https://github.com/DAP-Lab/mps_dataset)

---
---

## SECOND PASS: Additional Extracted Sources

**Appended: 2026-02-06**
**Focus: Deep-dive into GFD, CHSER, KidSpeak, Google Two-Pass, Audio LLMs, MBR Decoding, CTC Alignment, and more**

---

## 13. Generative Fusion Decoding (GFD)

### 13.1 Paper: "Let's Fuse Step by Step" (arXiv:2405.14259, 2024)

**Source:** [arXiv Paper](https://arxiv.org/abs/2405.14259) | [GitHub Repo](https://github.com/mtkresearch/generative-fusion-decoding)

**Full Abstract (extracted):** GFD is a "shallow fusion framework" that integrates Large Language Models with ASR/OCR systems by mapping "text token space to byte token space, enabling seamless fusion during the decoding process" without requiring retraining. It addresses token space mismatches between heterogeneous models.

**Architecture -- Three-Step Algorithm:**

1. **Token-to-Byte Transformation:** Converts token-level probabilities to byte-level probabilities through a mapping function, allowing models with different vocabularies to fuse at a common byte representation level.

2. **Delayed Correction Mechanism:** Rather than fusing at every step, "text recognition models propose the next byte/token, while employing LLMs to provide delayed corrective feedback on past tokens," reducing instability in beam search rankings.

3. **Probability Scoring Combination:** The core fusion equation:
   ```
   argmax [(1-r) * log P^TR({B1..Bt}, Z^TR) + r * log P^LM({B1..Bt-k}, Z^LM)]
   ```
   Where r = weighting factor (fixed at 0.2), k = delay offset, Z^TR = audio input, Z^LM = textual prompt.

**WER/MER Results:**

| Dataset | GFD | Whisper Baseline | Improvement |
|---------|-----|------------------|-------------|
| LibriSpeech clean | 1.91% | 2.28% | 16.2% |
| LibriSpeech other | 4.20% | 4.97% | 15.5% |
| LibriSpeech noisy (SNR=0) | 11.66% | 13.54% | 13.9% |
| NTUML2021 (Chinese) | 8.83% MER | -- | State-of-the-art |
| Fleurs-HK (Cantonese) | 5.58% MER | 6.88% | 18.9% |
| ATCO2 (air traffic) | 25.79% | 47.70% | 45.9% |

**Key Finding:** GFD outperforms Generative Error Correction (GER) which actually **degraded** performance. GFD is "more robust for incorporating off-the-shelf LLMs."

**Real-time Capability:** Claims asynchronous parallel execution where "the LLM works in parallel with the ASR decoder." Bounded at O(Z) + O(k * max(S_ASR, S_LLM)). Suitable for near-real-time, not true streaming.

**Failure Modes:** (1) Semantically similar homophones, (2) time-delayed token activation, (3) LLM mode collapse with repeating sequences. Most susceptible at very low SNR (-5 dB).

### 13.2 GitHub Repository Details

**Source:** [github.com/mtkresearch/generative-fusion-decoding](https://github.com/mtkresearch/generative-fusion-decoding)

**GPU Requirements:** A6000 GPU tested. ASR (Whisper Large) ~3GB + LLM (Breeze/Mistral) ~14GB.

**Supported Models:** Whisper (all sizes) + Mistral/Breeze LLMs. Explicitly warns: "has only been tested with the Mistral and Breeze models" -- other LLMs may produce errors.

**License:** Apache-2.0.

**Relevance to Our System:** GFD could replace or augment Tier 4 (LLM post-processing) in our proposed architecture by performing fusion **during** decoding rather than as a post-processing step. The delay mechanism (k tokens) adds modest latency but avoids full two-pass costs. However, it requires running an LLM alongside the ASR model, which increases GPU memory requirements.

---

## 14. CHSER Dataset: Child Speech Error Correction

### 14.1 Paper: CHSER (Interspeech 2025)

**Source:** [arXiv:2505.18463](https://arxiv.org/abs/2505.18463) | [ISCA Archive](https://www.isca-archive.org/interspeech_2025/balajishankar25_interspeech.html)

**Full Abstract (extracted):** "While ASR error correction (AEC) methods have improved adult speech transcription, their effectiveness on child speech remains largely unexplored." CHSER provides 200K hypothesis-transcription pairs spanning ages 4-14 and diverse speaking styles (scripted, spontaneous).

**Dataset Construction:**

- **Source Corpora:** MyST (400h, grades 3-5), CMU Kids (9h, read speech), CSLU OGI Kids (mixed), OCSC Ohio (156h)
- **Hypothesis Generation:** Whisper-base.en in zero-shot beam search, top-5 N-best
- **Filtering:** Removed repeated utterances, excluded < 3-word transcripts, filtered OOV words
- **Split:** Train 154,403 / Dev 21,397 / Test 26,687 pairs

**Error Categorization Framework:**
1. **Error Types (I/S/D):** Insertions, substitutions (most frequent), deletions
2. **Syntactic Analysis:** POS tagging via spaCy (nouns, pronouns, verbs, determiners)
3. **Disfluency Categories:** Filled pauses, partial words, repetitions, revisions, restarts

**WER Results -- Zero-Shot (T5 model):**

| Dataset | Baseline WER | After CHSER | Relative Reduction |
|---------|-------------|-------------|-------------------|
| Overall | 30.5% | 21.8% | **28.5%** |
| MyST | 28.1% | 20.7% | 26.3% |
| OGI Scripted | 26.2% | 13.3% | 49.2% |
| OCSC | 43.1% | 32.2% | 25.3% |

**WER Results -- Fine-Tuned ASR Systems:**

| ASR Model | Before | After | Reduction |
|-----------|--------|-------|-----------|
| WavLM | 10.1% | 9.2% | 8.9% |
| Whisper Small | 11.4% | 10.3% | 9.6% |
| Whisper Tiny | 12.8% | 11.1% | 13.3% |

**CRITICAL LIMITATION for Our System:** "GenSEC improves substitution and deletion errors, but **struggles with insertions and child-specific disfluencies**." The model actually **worsened** detection rates for repetitions and revisions. This means for our struggling readers who exhibit significant disfluency (hesitations, repetitions, false starts), pure text-based error correction may be counterproductive. We need acoustic-aware approaches for disfluency handling.

**Authors:** Natarajan Balaji Shankar, Zilai Wang, Kaiyuan Zhang, Mohan Shi, Abeer Alwan (UCLA).

---

## 15. KidSpeak: Multi-Purpose LLM for Children's Speech

### 15.1 Paper: KidSpeak (arXiv:2512.05994, December 2025)

**Source:** [arXiv:2512.05994](https://arxiv.org/abs/2512.05994) | [OpenReview](https://openreview.net/forum?id=in8qEyM4Xp)

**Full Abstract (extracted):** "KidSpeak addresses a critical gap in AI for children's speech by introducing a multi-task speech-enhanced Foundation Model designed specifically for pediatric speech patterns." Key innovations: two-stage training incorporating phonetic knowledge, and FASA (Flexible and Automatic Speech Aligner) improving data quality by 13.6x vs human annotations.

**Architecture:**

- **Speech Encoder:** Whisper-based, generating audio representations
- **LLM Backbone:** Vicuna 7B
- **Adaptation:** LoRA for parameter-efficient fine-tuning
- **Audio Feature Processing:** Aggregates multiple consecutive features to span 80ms per vector

**Multi-Head Whisper Pretraining (Stage 1):**
- Dual decoders: one for English transcription, one for **phonetic transcription**
- **Contrastive Alignment:** Cross-entropy loss aligning phonetic and English sequences from same audio
- **Cross-Attentive Alignment:** Multi-head attention synchronizing hidden states across decoders
- Ensures "pronunciation (phonetics) and spelling (orthographics) are consistent"

**Stage 2 -- Instruction Fine-Tuning:**
- Multi-turn conversation format
- Frozen Whisper encoder, LoRA-adapted LLM parameters
- Conditional auto-regressive prediction

**FASA (Flexible and Automatic Speech Aligner) -- 5 Modules:**
1. Regex-based transcription cleaning
2. ASR model timestamps for audio segmentation
3. Sliding-window algorithm matching audio to transcriptions
4. Post-generation quality verification (optional)
5. User interface for manual correction (optional)

**FASA handles:** Utterances appearing out of order in transcriptions, untranscribed audio segments, noisy/incomplete data.

**Performance Results:**

| Task | Accuracy |
|------|----------|
| Gender Classification | 73.3% |
| Disorder Classification | **88.8%** |
| Word Transcription | 87.8% |
| Character Transcription | 91.0% |
| Age-Group Classification | **94.1%** |
| **Average Multi-Task** | **87.0%** |

**Phonetic Error Rate:** Baseline Whisper 10.1% -> MH-Whisper 8.6%.

**Seven Disorder Classifications:** Inconsistent phonological disorder, consistent phonological disorder, childhood apraxia of speech, phonological delay, vowel disorder, articulation disorder, no disorder.

**FASA Validation (ENNI dataset):**
- Montreal Forced Aligner: 99.93% aligned WER (fails with incomplete transcriptions)
- FASA: **0.22% aligned WER**
- Human annotation: 3% WER increase; FASA achieves 13.6x lower WER without human labor

**Training Data:** 57+ hours from UPX (20 speakers), CSR (11 speakers), ENNI/CHILDES (352 children ages 4-9), Clinical English (1,540 speakers, 59K utterances).

**Relevance to Our System:** KidSpeak's phonetic-aware encoder could serve as a specialized child-speech ASR component in our ensemble. The dual phonetic/orthographic decoder is particularly relevant for reading miscue detection where we need to distinguish between phonetic errors (mispronunciation) and lexical errors (word substitution). The disorder classification capability could flag students needing referral.

---

## 16. Google Two-Pass Deliberation Architecture

### 16.1 Original Deliberation Model (ICASSP 2020)

**Source:** [arXiv:2003.07962](https://arxiv.org/abs/2003.07962) | [Google Research](https://research.google/pubs/deliberation-model-based-two-pass-end-to-end-speech-recognition/)

**Abstract (extracted):** Proposes a two-pass end-to-end ASR system using a deliberation network that attends to both acoustic signals and initial transcription hypotheses, rather than relying solely on text or audio alone.

**Architecture:**

**First Pass (Streaming):** RNN-T (Recurrent Neural Network Transducer) generates preliminary hypotheses from audio input in real-time. This provides low-latency initial output.

**Second Pass (Deliberation):** A bidirectional encoder processes first-pass output to extract contextual information. The deliberation decoder performs:
- **Dual attention:** Attends to both encoded audio frames AND first-pass text hypotheses
- Generates refined transcription using richer context

**WER Results (Google Voice Search):**
- vs. RNN-T alone: **25% relative WER reduction**
- vs. LAS rescoring: **12% relative WER reduction**
- vs. large conventional baseline: **21% relative reduction**
- On proper noun test sets: **23% reduction** (particularly important for reading named entities)

### 16.2 Transformer-Based Deliberation (2022 improvement)

**Source:** [Google Research](https://research.google/pubs/transformer-based-deliberation-for-two-pass-speech-recognition/)

**Improvement:** Replaces LSTM layers with transformer layers for deliberation rescoring. Generalizes "encoder-decoder" attention to attend to both audio and first-pass text.

**Results vs. LSTM deliberation:** **7% relative WER improvement + 38% computation reduction.**

**Key Insight for Our System:** Google's production two-pass architecture validates our proposed Tier 1 (streaming) + Tier 2 (batch refinement) approach. Their deliberation network attends to both acoustics and text -- we could implement a similar mechanism where the ensemble fusion step considers both the raw audio features and the initial ASR outputs. The first-pass RNN-T provides immediate word tracking, while the second-pass deliberation provides accuracy.

---

## 17. Audio Large Language Models

### 17.1 Qwen2-Audio (Alibaba, 2024)

**Source:** [arXiv:2407.10759](https://arxiv.org/abs/2407.10759) | [GitHub](https://github.com/QwenLM/Qwen2-Audio)

**Architecture:**
- **Audio Encoder:** Initialized from Whisper-large-v3, processes 16kHz audio into 128-channel mel-spectrograms, output frames ~40ms
- **LLM:** Qwen-7B (8.2B total parameters)
- **Training objective:** Maximize next text token probability conditioned on audio representations

**ASR Performance:**

| Dataset | WER |
|---------|-----|
| LibriSpeech test-clean | **1.6%** |
| LibriSpeech test-other | **3.6%** |
| Common Voice English | 8.6% |
| Aishell2 (Chinese) | 2.9-3.0% |

**Supported Tasks:** ASR, speech-to-text translation, speech emotion recognition, vocal sound classification, voice chat, audio analysis.

### 17.2 Qwen3-ASR (Alibaba, September 2025)

**Source:** [GitHub](https://github.com/QwenLM/Qwen3-ASR) | [MarkTechPost](https://www.marktechpost.com/2025/09/09/alibaba-qwen-team-releases-qwen3-asr/)

**Architecture:**
- Two model sizes: **Qwen3-ASR-1.7B** and **Qwen3-ASR-0.6B**
- Built on Qwen3-Omni foundation
- Unified streaming/offline inference with single model
- Includes **Qwen3-ForcedAligner-0.6B** for timestamp prediction (up to 5 min audio, 11 languages)

**Key Capabilities:**
- Language identification + ASR for **52 languages/dialects**
- Robust under noise, low quality, far-field, background music
- Songs/raps with BGM: < 8% WER
- **Contextual biasing:** Users provide background text (keywords, paragraphs, documents) to steer recognition toward domain-specific terms
- **Streaming + Offline** unified in single model
- 0.6B version: 2000x throughput at concurrency 128

**Performance:** State-of-the-art among open-source ASR; competitive with best proprietary APIs (Gemini-2.5-Pro, GPT-4o-Transcribe).

**License:** Open-source (Apache-2.0 for the 0.6B model).

**Relevance to Our System:** Qwen3-ASR's **contextual biasing** feature is directly applicable. Since we know the target reading passage, we can feed it as context to dramatically improve accuracy. The forced aligner component can provide precise word-level timestamps. The 0.6B model offers an excellent efficiency/accuracy tradeoff for ensemble members.

### 17.3 SALMONN (Tsinghua/ByteDance, ICLR 2024)

**Source:** [arXiv:2310.13289](https://arxiv.org/abs/2310.13289) | [GitHub](https://github.com/bytedance/SALMONN)

**Full Abstract (extracted):** SALMONN is a multimodal LLM integrating speech and audio encoders with an LLM to enable perception and understanding of speech, audio events, and music. Achieves competitive performance on trained tasks while demonstrating emergent abilities on untrained cross-modal tasks through novel activation tuning.

**Architecture -- Three Components:**

1. **Dual Encoder System:**
   - **Whisper Encoder:** Pretrained on 680K hours, handles speech + background noise
   - **BEATs Audio Encoder:** Self-supervised, extracts non-speech semantic information
   - Both at 50Hz frame rate, concatenated: `Z = Concat(Encoder_whisper(X), Encoder_beats(X))`

2. **Window-Level Q-Former:**
   - Segments audio into L-sized windows (L=17, ~0.33 seconds)
   - Each window independently generates one trainable query output
   - Produces ceil(T/L) x N textual tokens with high temporal resolution
   - For 30-second audio: ~88 textual tokens

3. **Vicuna 13B LLM + LoRA:**
   - LoRA fine-tunes query/value matrices (~33M trainable params, 0.24% of total)

**Three-Stage Training:**
1. **Pre-training:** 960h LibriSpeech + 1000h GigaSpeech + 2800h WavCaps (ASR + audio captioning)
2. **Instruction Tuning:** ~4400h across 12 tasks
3. **Activation Tuning:** 12 story samples to restore emergent abilities (combats task over-fitting)

**ASR Performance:**

| Dataset | WER |
|---------|-----|
| LibriSpeech test-clean | **2.1%** |
| LibriSpeech test-other | **4.9%** |
| GigaSpeech | 10.0% |

**Critical Finding -- "Task Over-fitting":** Instruction tuning on deterministic tasks like ASR biases the model toward simple outputs. Activation tuning with diverse, lengthy examples rebalances the model. Reducing LoRA scaling factor from 4.0 to 2.0 at test time activates reasoning abilities.

**Children's Speech:** Not addressed.
**Real-time:** Not addressed (batch processing focus).

### 17.4 AudioPaLM (Google, 2023)

**Source:** [arXiv:2306.12925](https://arxiv.org/abs/2306.12925)

**Abstract (extracted):** "A large language model for speech understanding and generation" that "fuses text-based and speech-based language models, PaLM-2 and AudioLM, into a unified multimodal architecture."

**Architecture:**
- Starts with PaLM-2 8B checkpoint
- Expands embedding matrix: (t x m) -> ((t + a) x m) for audio vocabulary
- Standard decoder-only Transformer
- All parameters trained (not frozen)
- Audio tokens initialized to zero

**Audio Tokenization (evaluated three approaches):**
- **w2v-BERT:** Multilingual, 25Hz, vocab size 1024
- **USM-v1:** Universal Speech Model variant
- **USM-v2:** Enhanced with auxiliary ASR loss (best multilingual performance)

Pipeline: Raw waveforms -> self-supervised embeddings (25Hz) -> K-means (vocab 1024) -> SoundStream tokens

**ASR Performance:** VoxPopuli 9.8% WER.

**Key Property:** Unified text+speech token space enables seamless multimodal processing. Audio and text are "just sequences of arbitrary integers."

### 17.5 SpeechGPT (2023)

**Source:** [arXiv:2305.11000](https://arxiv.org/abs/2305.11000)

**Architecture:**
- Converts speech into **discrete HuBERT tokens** via k-means clustering
- Expands LLaMA-13B vocabulary to include speech token representations
- Enables genuine cross-modal understanding and generation within single model

**Three-Stage Training Pipeline:**
1. Modality-adaptation pre-training
2. Cross-modal instruction fine-tuning
3. Chain-of-modality instruction fine-tuning

**Dataset:** SpeechInstruct -- large-scale cross-modal speech instruction dataset.

**Key Difference from Cascaded Approaches:** SpeechGPT processes speech tokens natively in the LLM rather than using an external ASR -> text -> LLM pipeline. This preserves paralinguistic information.

---

## 18. MBR Decoding for ASR

### 18.1 Paper: "Re-evaluating Minimum Bayes Risk Decoding for ASR" (October 2025)

**Source:** [arXiv:2510.19471](https://arxiv.org/abs/2510.19471) | [GitHub](https://github.com/CyberAgentAILab/mbr-for-asr)

**Full Abstract (extracted):** Evaluates sample-based MBR decoding for offline ASR and speech translation on English and Japanese using Whisper models. MBR consistently outperforms beam search across most settings.

**How MBR Differs from Beam Search:**

| Aspect | Beam Search | MBR Decoding |
|--------|------------|--------------|
| Strategy | Highest-probability sequences | Minimizes expected loss |
| Sample Use | Single best path | Multiple hypotheses evaluated jointly |
| Theoretical | Lacks guarantees | O(1/sqrt(N)) improvement rate |
| Compute | O(GB) | O(UN^2 + GN) |

**Method:** Uses epsilon sampling (epsilon=0.01) to generate up to 64 hypotheses. Selects "the hypothesis that lies at the center of the sampled hypotheses."

**Utility Functions:** BLEU (primary), BLEURT (neural), SentBERT (embedding-based). Results robust to choice -- all outperform beam search.

**WER Results Across Model Sizes (LibriSpeech clean):**

| Model | Beam (B=1) | MBR (N=64) | Relative Gain |
|-------|-----------|-----------|---------------|
| whisper-small | 6.7% | 5.0% | **25.4%** |
| whisper-medium | 5.8% | 4.2% | **27.6%** |
| whisper-large-v3 | 4.2% | 3.3% | **21.4%** |
| distil-large-v3.5 | 4.8% | 3.8% | **20.8%** |

**Noise Robustness (whisper-large-v3):**

| SNR (dB) | Beam | MBR | Gain |
|----------|------|-----|------|
| -20 | 59.0% | 53.0% | 10.2% |
| 0 | 8.1% | 5.7% | **29.6%** |
| 20 | 4.5% | 3.4% | 24.4% |

**Sample Efficiency:** MBR achieves strong performance with only **4-8 samples**, matching or exceeding beam search.

**CRITICAL LATENCY LIMITATION:** Average walltime for 64-sample MBR: **30.18 seconds** per instance vs. **0.88 seconds** for beam search. A **50-fold** computational increase. "Developing a fast implementation is left for future work."

**However:** With only 4-8 samples, the latency overhead is ~4-8x, which may be acceptable for near-real-time batch processing in our Tier 2.

### 18.2 GitHub Implementation

**Source:** [github.com/CyberAgentAILab/mbr-for-asr](https://github.com/CyberAgentAILab/mbr-for-asr)

- Supports Whisper family models
- Two-step workflow: sample generation -> MBR decoding + evaluation
- Supports WER, CER, BLEU, ROUGE, METEOR metrics
- Includes Gradio demo for qualitative comparison
- MIT License

**Relevance to Our System:** MBR decoding could replace beam search in our Whisper-based Tier 2 ASR for improved accuracy. With 4-8 samples and a focused known-passage context, the latency overhead may be acceptable. The approach is complementary to ensemble methods -- each model in the ensemble could use MBR internally, and then outputs are combined via ROVER.

---

## 19. CTC Forced Alignment for Reading Assessment

### 19.1 Wav2TextGrid: Tunable Forced Alignment for Child Speech (2025)

**Source:** [PMC Article](https://pmc.ncbi.nlm.nih.gov/articles/PMC12337111/)

**Abstract (extracted):** Trainable, speaker-adaptive neural forced alignment system for children's speech (ages 3-7). Can be directly trained on manual clinical-grade alignments.

**Architecture:**
- Wav2Vec2 feature extractor + encoder (10ms frame intervals)
- X-vector speaker adaptation appended to per-frame features
- Frame-wise softmax layer for phoneme probabilities
- **Dynamic Time Warping (Viterbi decoding)** for frame-to-phoneme assignment
- Uses **per-frame cross-entropy loss** (not CTC)

**Child Speech Accuracy (Leave-One-Speaker-Out):**
- **95.1% midpoint accuracy, 86.6% overlap percentage, 75.4% threshold accuracy (onset < 20ms)**
- Plosives and affricates: >40% improvement over baseline
- Nearly matched interrater agreement (93.6%)

**Training Data:** 10-15% labeled data (~13 minutes) matches MFA baseline. 45-60 minutes yields significant improvement.

**Pronunciation Scoring:** 0.87 Pearson correlation between forced-aligned and manually-aligned scores.

**Relevance:** Could provide precise phoneme-level alignment for reading assessment, enabling detection of specific pronunciation errors beyond word-level miscues.

### 19.2 CTC-Forced-Aligner (Python Package)

**Source:** [GitHub](https://github.com/MahmoudAshraf97/ctc-forced-aligner)

**Features:**
- Uses Wav2Vec2, HuBERT, MMS models for CTC-based alignment
- 5x less memory than TorchAudio's alignment API
- Supports **1,100+ languages**
- Sentence, word, or character-level alignment granularity
- JSON output with start/end timestamps per segment

**Default Model:** MMS-300M-1130 forced aligner (CC-BY-NC 4.0).

**Usage:** `pip install git+https://github.com/MahmoudAshraf97/ctc-forced-aligner.git`

**Relevance:** Plug-and-play forced alignment for our reading assessment. Given the known target text, we can force-align the student's audio to identify exactly which words were spoken, skipped, or substituted. This is complementary to ASR-based approaches.

### 19.3 Torchaudio CTC Forced Alignment

**Source:** [PyTorch Documentation](https://docs.pytorch.org/audio/stable/tutorials/forced_alignment_tutorial.html)

Built-in PyTorch/torchaudio support for CTC forced alignment using Wav2Vec2. Provides official tutorial for text-to-speech alignment.

---

## 20. Wav2Vec2 Fine-Tuning for Children's Reading Diagnosis

### 20.1 Paper: AAAS Workshop 2025

**Source:** [ACL Anthology](https://aclanthology.org/2025.aaas-1.1.pdf)

**Focus:** Fine-tuning Wav2Vec2.0 Large in low-resource settings for children's speech recognition and word-level reading diagnosis.

**Results:**
- Best fine-tuned model: **WER = 10.9%, F1 = 0.49** for miscue detection (with target domain data)
- Using similar out-of-domain non-native read speech enhances performance for unseen speakers

**Key Limitation:** F1 of 0.49 for miscue detection is still low. This reinforces the need for ensemble approaches.

### 20.2 Finetuning Phonetic ASR Models for Reading Miscue Detection (2024)

**Source:** [ResearchGate](https://www.researchgate.net/publication/384887697_Finetuning_Large_Pretrained_Phonetic_ASR_Models_for_Reading_Miscue_Detection_in_Primary_School)

**Method:** Fine-tunes large pretrained phonetic ASR models specifically for primary school reading miscue detection.

**Complementary Models for Miscue Detection (validated across studies):**
- **Wav2Vec2 Large:** Highest recall (0.83) -- catches most errors
- **Whisper:** Highest precision (0.52) -- fewer false alarms
- **HuBERT Large:** Best phoneme-level (PER 23.1%)

**ENSEMBLE INSIGHT:** These three models have complementary strengths. An ensemble that uses Wav2Vec2 for high-sensitivity detection, Whisper for confirmation/filtering, and HuBERT for phonetic-level analysis would create a robust multi-level miscue detection system.

---

## 21. Refined Analysis of Reading Miscues (SLATE 2025)

**Source:** [ISCA Archive - SLATE 2025](https://www.isca-archive.org/slate_2025/montoyagomez25_slate.html)

**Abstract (extracted):** Automated system for Dutch children's reading assessment combining ASR with Weighted Finite-State Transducers (WFST) for alignment.

**Architecture:**
- End-to-end ASR model generates multiple hypotheses
- WFST aligns ASR outputs with expected pronunciations from target text
- Does NOT rely on external forced-alignment tools
- Uses multiple ASR hypotheses

**Key Results:**
- False alarms: **under 5%**
- Accurate word attempt counting
- Miscue classification via external phoneme detection

**New Metrics Proposed:** For evaluating attempt quality and miscue accuracy beyond simple WER.

**Relevance:** The WFST-based alignment approach, using multiple hypotheses from a single ASR model, is an alternative to multi-model ensemble approaches. It could be combined with our ensemble by using WFST alignment on the fused output.

---

## 22. PromptASR: Contextualized ASR for Known-Text Scenarios

### 22.1 Paper: PromptASR (arXiv:2309.07414, 2024)

**Source:** [arXiv:2309.07414](https://arxiv.org/abs/2309.07414)

**Abstract (extracted):** Integrates text prompts into end-to-end ASR for "contextualized ASR with controllable style of transcriptions."

**Architecture:**
- Zipformer-based neural transducer encoder
- Pretrained text encoder processes prompts
- Cross-attention layers inject text embeddings into each speech encoder layer
- Text embeddings serve as key/value, acoustic states as queries
- Beam search (size 4) during inference

**Two Prompt Types:**

1. **Content Prompts:** Semantic context via preceding utterance text or word biasing lists
2. **Style Prompts:** Control formatting via instructions (e.g., "Mixed-cased English with punctuation")

**WER Results (Libriheavy book reading):**
- Baseline: 6.72%
- With content prompts: **6.03% (10.3% relative improvement)**
- Book reading specific: **21.9% relative WER reduction**
- In-house dataset: **6.8% relative WER reduction**

**CRITICAL RELEVANCE:** Since we know the exact target passage the student is reading, we can provide it as a content prompt to PromptASR. This is analogous to Qwen3-ASR's contextual biasing feature. The 21.9% improvement on book reading demonstrates significant value for our exact use case. This could dramatically reduce WER in our system.

---

## 23. Interspeech 2025 ASR Fusion Papers

### 23.1 Better Pseudo-labeling with Multi-ASR Fusion (Interspeech 2025)

**Source:** [arXiv:2506.11089](https://arxiv.org/abs/2506.11089) | [ISCA Archive](https://www.isca-archive.org/interspeech_2025/prakash25_interspeech.html)

**Three Fusion Architectures Compared:**

1. **Multi-ASR Ensemble Pipeline:** ROVER-style word-level voting from Icefall (65M), Nemo Parakeet (1.1B), Whisper-large-v3 (1.5B)

2. **Textual LLM Fusion:** Llama 3.2 1B processes textual confusion networks from three ASR outputs. "Refines uncertain ASR outputs by learned language and world knowledge."

3. **SpeechLLM Fusion (Best):** Qwen2-Audio incorporates BOTH audio AND textual confusion networks. "Considers textual hypotheses along with underlying acoustic evidence."

**Training:** 27K samples for LLM fine-tuning using QLoRA (LoRA rank 32).

**WER Results:**

| Approach | DefinedAI Train | LibriSpeech Clean |
|----------|-----------------|-------------------|
| Ground Truth | 15.63% | 8.15% |
| Multi-ASR Ensemble | 14.36% | 2.22% |
| Textual LLM | 11.60% | 2.96% |
| **SpeechLLM** | **9.30%** | **2.26%** |

**Key Finding:** SpeechLLM fusion (using Qwen2-Audio to consider both acoustics and text hypotheses) outperforms both pure text-based LLM fusion AND traditional ROVER-style ensemble. "By unifying pseudo-labeling into a single-stage instruction-following framework, we significantly simplify the process while avoiding error propagation, information loss and disjoint optimization."

**Relevance:** This paper validates the evolution from ROVER -> textual LLM -> SpeechLLM fusion. For our system, a SpeechLLM approach using Qwen2-Audio (or similar) that considers both the raw audio and multiple ASR hypotheses may outperform our proposed ROVER-based Tier 3.

### 23.2 SKIP-SALSA: Skip Synchronous Fusion of ASR LLM Decoders (Interspeech 2025, IBM)

**Source:** [IBM Research](https://research.ibm.com/publications/skip-salsa-skip-synchronous-fusion-of-asr-llm-decoders)

**Problem Solved:** SALSA (a previous ASR-LLM fusion method) "fails when the ASR and LLM tokenizations have a large token fertility gap" -- the ASR decoder overtokenizes LLM tokens, starving the LLM decoder of sufficient audio context.

**Solution:** SKIP-SALSA "adaptively skips ahead and advances the ASR decoder states to synchronize with the LLM" using a learned skip predictor.

**Architecture:** Cascades ASR decoder into LLM decoder via lightweight projection layers, enabling synchronous decoding despite differing tokenizations.

**Results:** "Up to **20% improvement** over a strong baseline" on low-resource languages.

---

## 24. Updated Synthesis: Second Pass Implications

### 24.1 Revised Architecture Recommendations

Based on the second pass findings, our proposed architecture should be updated:

**Major Update 1 -- Contextual Biasing Is Critical:**
Both PromptASR (21.9% WERR on book reading) and Qwen3-ASR (contextual biasing feature) demonstrate that providing the target passage text dramatically improves ASR accuracy. **This should be the FIRST optimization we implement**, before even building an ensemble.

**Major Update 2 -- SpeechLLM Fusion > ROVER:**
The Interspeech 2025 multi-ASR fusion paper shows SpeechLLM approaches (using audio + text hypotheses jointly) outperform traditional ROVER-style ensembles. Our Tier 3 should evolve from ROVER toward a SpeechLLM fusion approach.

**Major Update 3 -- CHSER Limitation Warning:**
Text-only error correction **worsens** child-specific disfluency handling. Our LLM post-processing (Tier 4) must be acoustic-aware, not text-only. GFD (which operates during decoding with access to acoustics) is preferable to pure text post-processing.

**Major Update 4 -- MBR Decoding as Internal Enhancement:**
MBR with 4-8 samples can improve each ensemble member's output by 20-28% relative WER with manageable latency overhead. This should be applied to each Whisper-based model before ensemble fusion.

**Major Update 5 -- KidSpeak's Phonetic Dual Decoder:**
The phonetic/orthographic dual decoder can detect pronunciation errors that word-level ASR misses. Should be added as a specialized ensemble member for phonetic-level miscue analysis.

### 24.2 Revised Architecture Proposal

**Tier 0 -- Contextual Biasing (Passive):**
- Feed target passage text to all ASR models as context/prompt
- Expected: 20-50% WER reduction from this alone

**Tier 1 -- Streaming Primary ASR (Real-Time):**
- Qwen3-ASR-0.6B (streaming mode, contextual biasing, forced aligner)
- Provides immediate word tracking + timestamps

**Tier 2 -- Parallel Batch ASR (Near-Real-Time, MBR-enhanced):**
- Whisper Large-v3 with MBR decoding (4-8 samples)
- KidSpeak (phonetic + orthographic dual output)
- Wav2Vec2 fine-tuned on children's speech (high recall miscue detection)

**Tier 3 -- SpeechLLM Fusion (replaces ROVER):**
- Qwen2-Audio processes raw audio + confusion networks from all Tier 1/2 outputs
- Single-stage joint optimization avoids error propagation
- Fine-tuned on child reading assessment data (using CHSER + custom data)

**Tier 4 -- CTC Forced Alignment + WFST Miscue Classification:**
- CTC-forced-aligner maps audio to target passage phoneme-by-phoneme
- WFST compares expected vs. produced pronunciations
- Classify miscues: omissions, substitutions, insertions, repetitions, hesitations

### 24.3 Expected WER Trajectory

| Stage | Expected WER (children reading known text) |
|-------|---------------------------------------------|
| Baseline Whisper (no adaptation) | 13-15% |
| + Contextual biasing (Tier 0) | 8-10% |
| + Child speech fine-tuning | 6-8% |
| + MBR decoding per model | 5-6% |
| + SpeechLLM fusion (Tier 3) | 3-5% |
| + CTC forced alignment verification | <3% effective accuracy |

---

## Second Pass Sources Consulted

26. [GFD Paper - arXiv:2405.14259](https://arxiv.org/abs/2405.14259)
27. [GFD GitHub - mtkresearch](https://github.com/mtkresearch/generative-fusion-decoding)
28. [CHSER Paper - arXiv:2505.18463](https://arxiv.org/abs/2505.18463)
29. [CHSER at ISCA Interspeech 2025](https://www.isca-archive.org/interspeech_2025/balajishankar25_interspeech.html)
30. [KidSpeak Paper - arXiv:2512.05994](https://arxiv.org/abs/2512.05994)
31. [Google Deliberation Model - arXiv:2003.07962](https://arxiv.org/abs/2003.07962)
32. [Transformer Deliberation - Google Research](https://research.google/pubs/transformer-based-deliberation-for-two-pass-speech-recognition/)
33. [Qwen2-Audio - arXiv:2407.10759](https://arxiv.org/abs/2407.10759)
34. [Qwen3-ASR GitHub](https://github.com/QwenLM/Qwen3-ASR)
35. [SALMONN - arXiv:2310.13289](https://arxiv.org/abs/2310.13289)
36. [AudioPaLM - arXiv:2306.12925](https://arxiv.org/abs/2306.12925)
37. [SpeechGPT - arXiv:2305.11000](https://arxiv.org/abs/2305.11000)
38. [MBR for ASR - arXiv:2510.19471](https://arxiv.org/abs/2510.19471)
39. [MBR for ASR GitHub](https://github.com/CyberAgentAILab/mbr-for-asr)
40. [Wav2TextGrid Child Alignment - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12337111/)
41. [CTC-Forced-Aligner GitHub](https://github.com/MahmoudAshraf97/ctc-forced-aligner)
42. [Wav2Vec2 Reading Diagnosis - AAAS 2025](https://aclanthology.org/2025.aaas-1.1.pdf)
43. [Refined Reading Miscues - SLATE 2025](https://www.isca-archive.org/slate_2025/montoyagomez25_slate.html)
44. [PromptASR - arXiv:2309.07414](https://arxiv.org/abs/2309.07414)
45. [Multi-ASR Fusion + SpeechLLM - Interspeech 2025](https://arxiv.org/abs/2506.11089)
46. [SKIP-SALSA - IBM Research Interspeech 2025](https://research.ibm.com/publications/skip-salsa-skip-synchronous-fusion-of-asr-llm-decoders)
47. [Finetuning Phonetic ASR for Miscue Detection](https://www.researchgate.net/publication/384887697)
48. [PromptASR v3](https://arxiv.org/html/2309.07414v3)
49. [Qwen3-ASR MarkTechPost](https://www.marktechpost.com/2025/09/09/alibaba-qwen-team-releases-qwen3-asr/)
50. [Child ASR Paper List - GitHub](https://github.com/Diamondfan/Child-ASR-Paper)
