# Ensemble ASR Research Findings for Educational Reading Assessment

## Search Summary

Over 20 distinct queries were executed covering: confidence-based ASR ensembles, ROVER and modern variants, multi-engine ASR fusion, LLM-based ASR error correction, MBR decoding for ASR combination, children's speech recognition, disfluency detection, oral reading fluency assessment, commercial/practical ensemble approaches, and open-source frameworks.

---

## Section 1: Multi-Engine ASR Fusion and Ensemble Methods

### 1.1 Better Pseudo-labeling with Multi-ASR Fusion and Error Correction by SpeechLLM
- **Authors:** Jeena Prakash, Blessingh Kumar, Kadri Hacioglu, et al.
- **Venue:** InterSpeech 2025
- **Year:** 2025
- **URLs:**
  - https://arxiv.org/abs/2506.11089
  - https://www.isca-archive.org/interspeech_2025/prakash25_interspeech.pdf
- **Key Contribution:** Proposes a unified multi-ASR prompt-driven framework that replaces traditional ROVER-style voting with LLM-based arbitration. Three approaches are introduced: (1) a multi-ASR ensemble pipeline integrating three large-scale end-to-end ASR models, (2) a multi-ASR textual LLM architecture where prompts include confusion sets from three ASR models, and (3) a novel multi-ASR speechLLM-based architecture that leverages both textual hypotheses and acoustic evidence. The speechLLM variant is fine-tuned to learn from disagreements among the ASR ensemble, producing superior pseudo-labels for semi-supervised ASR training. **This is the most directly relevant paper for our multi-engine ensemble use case.**

### 1.2 SKIP-SALSA: Skip Synchronous Fusion of ASR LLM Decoders
- **Authors:** Mittal et al. (IBM Research)
- **Venue:** InterSpeech 2025
- **Year:** 2025
- **URLs:**
  - https://research.ibm.com/publications/skip-salsa-skip-synchronous-fusion-of-asr-llm-decoders
  - https://www.isca-archive.org/interspeech_2025/mittal25_interspeech.pdf
- **Key Contribution:** Builds on SALSA (Speedy ASR-LLM Synchronous Aggregation), which cascades an ASR decoder into an LLM decoder via lightweight projection layers for synchronous decoding. SKIP-SALSA adds an adaptive skipping mechanism to handle tokenization mismatches between ASR and LLM, particularly important for low-resource languages. Outperforms all baselines in low-resource settings. Demonstrates a practical architecture for fusing ASR acoustic models with LLM language understanding in real-time.

### 1.3 SALSA: Speedy ASR-LLM Synchronous Aggregation
- **Authors:** IBM Research
- **Venue:** InterSpeech 2024
- **Year:** 2024
- **URLs:**
  - https://arxiv.org/abs/2408.16542
  - https://research.ibm.com/publications/salsa-speedy-asr-llm-synchronous-aggregation
- **Key Contribution:** The predecessor to SKIP-SALSA. Proposes cascading an ASR decoder into an LLM decoder via lightweight projection layers, enabling synchronous decoding despite differing tokenizations. Provides the foundational architecture for real-time ASR+LLM fusion.

### 1.4 Let's Fuse Step by Step: A Generative Fusion Decoding Algorithm with LLMs for Robust ASR and OCR
- **Authors:** MediaTek Research (mtkresearch)
- **Venue:** ACL 2025 Findings (originally arXiv May 2024)
- **Year:** 2024-2025
- **URLs:**
  - https://arxiv.org/abs/2405.14259
  - https://aclanthology.org/2025.findings-acl.1281/
  - https://github.com/mtkresearch/generative-fusion-decoding
- **Key Contribution:** Generative Fusion Decoding (GFD) is a plug-and-play shallow fusion framework that integrates LLMs into ASR systems without re-training. It operates across mismatched token spaces by calculating likelihood at the byte level, enabling real-time error correction during decoding. Achieves up to 17.7% WER reduction through in-context learning and supports instruction-aware ASR. **Open-source implementation available on GitHub.**

### 1.5 Improving Contextual ASR via Multi-grained Fusion with Large Language Models
- **Authors:** (not specified in search results)
- **Venue:** arXiv
- **Year:** 2025 (July)
- **URL:** https://arxiv.org/abs/2507.12252
- **Key Contribution:** Proposes a late-fusion strategy combining ASR acoustic information with LLM contextual knowledge, jointly leveraging token-level and phrase-level fusion. Achieves state-of-the-art performance on keyword-related metrics while preserving high accuracy on non-keyword text, tested on Chinese and English datasets.

---

## Section 2: ROVER and System Combination Methods

### 2.1 ROVER (Recognizer Output Voting Error Reduction) -- Original and Variants
- **Original Authors:** J. Fiscus (NIST)
- **Year:** 1997 (original), variants through 2017
- **URLs:**
  - Original: https://ieeexplore.ieee.org/document/659110/
  - NIST tool (SCTK): https://github.com/usnistgov/SCTK/blob/master/doc/rover.1
  - LV-ROVER: https://arxiv.org/abs/1707.07432
- **Key Contribution:** The foundational post-recognition system that models outputs from multiple ASR systems as independent knowledge sources, combining them via word confusion networks and majority voting to reduce error rates. Modern variants include LV-ROVER (lexicon-verified, reduced complexity, can combine hundreds of recognizers), Quality-Estimation-informed ROVER (segment-level ranking instead of confidence scores), and pattern-matching-based voting schemes.

### 2.2 Re-evaluating Minimum Bayes Risk Decoding for ASR
- **Authors:** (not specified)
- **Venue:** arXiv
- **Year:** 2024-2025
- **URL:** https://arxiv.org/abs/2510.19471
- **Key Contribution:** Evaluates sample-based MBR decoding for speech-to-text tasks, finding it outperforms beam search across all model sizes tested. MBR decoding is robust to the choice of utility function and epsilon values. The algorithm can take as input either a single lattice or multiple lattices for system combination, making it a viable alternative to ROVER for multi-system fusion.

### 2.3 Automatic Quality Estimation for ASR System Combination
- **Authors:** (not specified)
- **Venue:** ScienceDirect (Computer Speech & Language)
- **Year:** 2016 (foundational reference)
- **URL:** https://www.sciencedirect.com/science/article/abs/pii/S0885230816300328
- **Key Contribution:** A novel ROVER variant that uses ASR quality estimation (QE) for ranking transcriptions at the segment level instead of relying on confidence scores or random ordering. Relevant as a methodological foundation for confidence-based routing between ASR engines.

### 2.4 Word Confusion Networks for ASR Robustness (2024)
- **Authors:** (not specified)
- **Venue:** NAACL/arXiv
- **Year:** 2024
- **URL:** https://arxiv.org/abs/2401.02921
- **Key Contribution:** Uses word confusion networks derived from ASR lattices in in-context learning experiments for spoken question answering and intent classification. Demonstrates that WCNs provide a compact representation of multiple aligned ASR hypotheses with confidence scores, achieving 6-10% absolute F-measure improvements for named entity detection.

---

## Section 3: Confidence-Based Approaches and Word-Level Scoring

### 3.1 Confidence-Based ASR Ensemble with Entropy Scoring (LREC-COLING 2024)
- **Authors:** (not specified)
- **Venue:** LREC-COLING 2024
- **Year:** 2024
- **URL:** https://aclanthology.org/2024.lrec-main.547.pdf
- **Key Contribution:** Applied confidence measures to merge hybrid Kaldi ASR and end-to-end XLS-R models using Renyi's entropy-based confidence approach tuned with temperature scaling. Achieved approximately 14% WER reduction on the primary test set and 20% on noisy test data. Demonstrates that confidence-based ensemble voting can significantly outperform individual systems.

### 3.2 Confidence-Guided Error Correction for Disordered Speech Recognition
- **Authors:** (not specified)
- **Venue:** arXiv
- **Year:** 2025
- **URL:** https://arxiv.org/abs/2509.25048
- **Key Contribution:** Proposes a confidence-guided framework where entropy-based confidence scores identify low-confidence regions in ASR transcripts, which then guide LLM corrections (fine-tuned LLaMA). Achieves 10% relative WER reduction on Speech Accessibility Project spontaneous speech and 47% on TORGO. Demonstrates that confidence-informed prompting reduces overcorrection.

### 3.3 Error Correction by Paying Attention to Both Acoustic and Confidence References
- **Authors:** (not specified)
- **Venue:** arXiv
- **Year:** 2024
- **URL:** https://arxiv.org/abs/2407.12817
- **Key Contribution:** Combines both acoustic features and confidence references in a unified attention-based error correction framework, showing that integrating multiple signal types improves ASR post-processing.

### 3.4 Evaluating ASR Confidence Scores for Automated Error Detection
- **Authors:** (not specified)
- **Venue:** arXiv
- **Year:** 2025
- **URL:** https://arxiv.org/abs/2503.15124
- **Key Contribution:** Evaluates ASR confidence scores for automated error detection in user-assisted correction interfaces. Relevant for understanding how to use confidence scores from multiple ASR engines to identify and flag errors.

---

## Section 4: LLM-Based ASR Error Correction (Post-Processing)

### 4.1 ASR Error Correction using Large Language Models
- **Authors:** (not specified)
- **Venue:** arXiv
- **Year:** 2024
- **URL:** https://arxiv.org/abs/2409.09554
- **Key Contribution:** Extends zero-shot error correction using LLMs (ChatGPT) and introduces constrained decoding based on N-best lists or ASR lattices. GPT-3.5 matches the performance of 10-best T5 for Transducer ASR, while GPT-4 exceeds it across all test sets. Demonstrates that LLMs can effectively arbitrate among multiple ASR hypotheses.

### 4.2 N-best T5: Robust ASR Error Correction using Multiple Input Hypotheses
- **Authors:** (not specified)
- **Venue:** arXiv
- **Year:** 2023
- **URL:** https://arxiv.org/abs/2303.00456
- **Key Contribution:** Fine-tunes T5 on N-best ASR hypotheses with constrained decoding, demonstrating that multiple hypotheses provide richer context for error correction than single-best. The constrained decoding process based on either the N-best list or an ASR lattice allows additional information to propagate. **Foundational method for using multiple ASR outputs as input.**

### 4.3 Evolutionary Prompt Design for LLM-Based Post-ASR Error Correction
- **Authors:** Sachdev et al.
- **Venue:** IEEE SLT 2024 / GenSEC Challenge
- **Year:** 2024
- **URL:** https://arxiv.org/abs/2407.16370
- **Key Contribution:** Develops a genetic algorithm to automatically generate and optimize prompts for LLM-based post-ASR error correction. Evaluated on the CHiME-4 subset of the GenSEC Challenge, showing that evolutionary algorithms can systematically improve prompt design for ASR correction tasks.

### 4.4 Large Language Model Based Generative Error Correction (GenSEC)
- **Authors:** (not specified)
- **Venue:** arXiv
- **Year:** 2024
- **URL:** https://arxiv.org/abs/2409.09785
- **Key Contribution:** Establishes the GenSEC challenge and baselines for speech recognition error correction, speaker tagging, and emotion recognition using LLMs. Provides a standardized framework (HyPoradise dataset) for evaluating N-best hypothesis correction with LLMs.

### 4.5 Towards Robust Dysarthric Speech Recognition: LLM-Agent Post-ASR Correction
- **Authors:** (not specified)
- **Venue:** arXiv
- **Year:** 2025
- **URL:** https://arxiv.org/html/2601.21347
- **Key Contribution:** Proposes a hybrid correction pipeline chaining pre-detection, chain-of-thought iterative correction, and answer verification in an LLM agent, achieving up to 21% relative CER reduction. Mitigates hallucinations and guarantees semantic preservation for disordered speech.

### 4.6 Game-Oriented ASR Error Correction via RAG-Enhanced LLM
- **Authors:** (not specified)
- **Venue:** arXiv
- **Year:** 2025
- **URL:** https://arxiv.org/html/2509.23630
- **Key Contribution:** Uses N-best hypothesis-based LLM correction combined with Retrieval-Augmented Generation (RAG) and supervised fine-tuning. Demonstrates that domain-specific knowledge retrieval can improve ASR error correction accuracy.

### 4.7 Multi-stage Large Language Model Correction for Speech Recognition
- **Authors:** (not specified)
- **Venue:** arXiv
- **Year:** 2023-2024
- **URL:** https://arxiv.org/html/2310.11532v2
- **Key Contribution:** Proposes a multi-stage LLM correction pipeline for ASR, showing that iterative refinement with LLMs improves transcription quality beyond single-pass correction.

---

## Section 5: Children's Speech Recognition and Disfluency Detection

### 5.1 Prompting Whisper for Improved Verbatim Transcription and End-to-end Miscue Detection
- **Authors:** Smith et al. (Apple Machine Learning Research)
- **Venue:** InterSpeech 2025
- **Year:** 2025
- **URLs:**
  - https://arxiv.org/abs/2505.23627
  - https://machinelearning.apple.com/research/prompting-whisper
- **Key Contribution:** Proposes fine-tuning Whisper with target reading text prompts for both improved verbatim transcription and direct miscue detection. Augments the tokenizer vocabulary with miscue tokens ({<omit>, <substitute>, <insert>}) so the system predicts both transcriptions and miscue annotations end-to-end. Tested on children's read-aloud and adult atypical speech, showing improvements over current state-of-the-art. **Extremely relevant to our reading assessment use case -- demonstrates how to adapt Whisper for miscue detection.**

### 5.2 Improving Child Speech Recognition and Reading Mistake Detection by Using Prompts
- **Authors:** Gao et al.
- **Venue:** InterSpeech 2025
- **Year:** 2025
- **URL:** https://www.isca-archive.org/interspeech_2025/gao25c_interspeech.pdf
- **Key Contribution:** Investigates using text prompts with Whisper and LLMs (GPT-4o-mini) for Dutch child read speech recognition and reading mistake detection. Achieves WER of 5.1% (down from 9.4% baseline) and increases reading mistake detection F1 from 0.39 to 0.73. Prompts integrate: (1) the target reading text for name/infrequent word correction, (2) examples of common children's reading mistakes, (3) CTC hypothesis checking against the read text.

### 5.3 Augmenting Automatic Speech Recognition Models with Disfluency Detection
- **Authors:** (not specified)
- **Venue:** ICASSP 2025 / arXiv
- **Year:** 2024
- **URLs:**
  - https://arxiv.org/abs/2409.10177
  - https://ieeexplore.ieee.org/document/10832349/
- **Key Contribution:** An inference-only approach to augment any ASR model with open-set disfluency detection. Uses a modified CTC-based forced alignment algorithm to predict word-level timestamps while capturing disfluent speech, then classifies alignment gaps as containing disfluent speech or silence (81.62% accuracy, 80.07% F1). Captures 74.13% of words initially missed by transcription. **Directly applicable to our system -- inference-only augmentation means it works with any ASR engine.**

### 5.4 CHSER: A Dataset and Case Study on Generative Speech Error Correction for Child ASR
- **Authors:** Natarajan Balaji Shankar, Zilai Wang, Kaiyuan Zhang, Mohan Shi, Abeer Alwan
- **Venue:** InterSpeech 2025
- **Year:** 2025
- **URLs:**
  - https://arxiv.org/abs/2505.18463
  - https://www.isca-archive.org/interspeech_2025/balajishankar25_interspeech.html
- **Key Contribution:** Introduces the CHSER dataset with 200K hypothesis-transcription pairs for child speech (ages 4-14) across diverse speaking styles. Fine-tuning on CHSER achieves up to 28.5% relative WER reduction in zero-shot and 13.3% when applied to fine-tuned ASR. Error analysis reveals GenSEC improves substitution and deletion errors but struggles with insertions and child-specific disfluencies.

### 5.5 Inclusive ASR for Disfluent Speech: Cascaded Self-Supervised Learning with Targeted Fine-Tuning
- **Authors:** Mujtaba et al.
- **Venue:** InterSpeech 2024
- **Year:** 2024
- **URLs:**
  - https://arxiv.org/abs/2406.10177
  - https://www.isca-archive.org/interspeech_2024/mujtaba24_interspeech.html
- **Key Contribution:** Leverages large-scale self-supervised learning on standard speech followed by targeted fine-tuning and data augmentation with synthesized disfluencies. Even relatively small labeled datasets of disfluent speech combined with data augmentation significantly reduce WER for disfluent speech using wav2vec 2.0. Addresses the scarcity of annotated disfluent speech datasets.

### 5.6 KidSpeak: A General Multi-purpose LLM for Kids' Speech Recognition and Screening
- **Authors:** (not specified)
- **Venue:** arXiv / OpenReview
- **Year:** 2025
- **URL:** https://arxiv.org/abs/2512.05994
- **Key Contribution:** A multi-task speech-enhanced Foundation Model for children's speech, handling ASR, gender/dialect identification, and speech pathology classification through instruction tuning. Achieves 87% average accuracy across four tasks. Includes FASA (Flexible and Automatic Speech Aligner) tool that improves alignment quality by 13.6x compared to human annotations on CHILDES dataset.

### 5.7 Improving Automatic Speech Recognition for Children's Reading Assessment (with Disfluency-aware Language Models)
- **Authors:** Vidal et al.
- **Venue:** InterSpeech 2025
- **Year:** 2025
- **URL:** https://www.isca-archive.org/interspeech_2025/vidal25_interspeech.pdf
- **Key Contribution:** Achieves SOTA phoneme-level child speech recognition (PER 23.1% with HuBERT Large fine-tuned on Dutch speech) and SOTA word-level performance (WER 9.8% with Faster Whisper Large-v2). Uses disfluency-aware language models specifically designed for reading assessment.

### 5.8 FluencyBank Timestamped: An Updated Data Set for Disfluency Detection
- **Authors:** (not specified)
- **Venue:** Journal of Speech, Language, and Hearing Research
- **Year:** 2024
- **URL:** https://pubs.asha.org/doi/10.1044/2024_JSLHR-24-00070
- **Key Contribution:** Updated dataset with transcripts, timestamps, and disfluency labels capturing filled pauses, repetitions, revisions, and partial words. Benchmarks for intended speech recognition, text-based and audio-based disfluency detection show Whisper transcribes filled pauses and partial words at higher rates for people who stutter, and isWER increases with stuttering severity. **Useful as a training/evaluation resource.**

---

## Section 6: Oral Reading Fluency Assessment

### 6.1 Can ASR Generate Valid Measures of Child Reading Fluency?
- **Authors:** Harmsen et al.
- **Venue:** InterSpeech 2025
- **Year:** 2025
- **URLs:**
  - https://www.isca-archive.org/interspeech_2025/harmsen25_interspeech.pdf
  - https://www.isca-archive.org/interspeech_2025/harmsen25_interspeech.html
- **Key Contribution:** Evaluates ASR-computed measures for phrasing, smoothness, and pacing of oral reading fluency on 244 recordings from 131 Dutch primary school children (ages 6-13). Found strong correlations for 12 out of 15 measures compared to expert human scorers, demonstrating great potential for reliable, less time-consuming reading assessment.

### 6.2 Improving Oral Reading Fluency Assessment Through Sub-Sequence Alignment
- **Authors:** Yihao Wang, Zhongdi Wu, Joseph Nese, Akihito Kamata, Vedant Nilabh, Eric C. Larson
- **Venue:** ICASSP 2024
- **Year:** 2024
- **URL:** https://s2.smu.edu/~eclarson/pubs/2024_icassp_orf.pdf
- **Key Contribution:** Designs a novel method for calculating WCPM using contrastive learning, novel word-level acoustic embeddings, and modern TTS technology. Uses sub-sequence matching to estimate WCPM, aligning more closely with human raters than baseline methods. **Relevant for alignment techniques that could complement our ensemble approach.**

### 6.3 Automated Evaluation of Children's Speech Fluency for Low-Resource Languages
- **Authors:** Bowen Zhang et al.
- **Venue:** InterSpeech 2025
- **Year:** 2025
- **URLs:**
  - https://arxiv.org/abs/2505.19671
  - https://www.isca-archive.org/interspeech_2025/zhang25m_interspeech.pdf
- **Key Contribution:** Proposes combining a fine-tuned multilingual ASR model with objective metrics extraction (phonetic/word error rates, speech rate, speech-pause duration ratio) and a GPT-based classifier for fluency scoring. Achieves greater than 90% accuracy in Malay. Demonstrates a pipeline approach combining ASR + metrics + LLM evaluation.

### 6.4 Speech Enabled Reading Fluency Assessment: A Validation Study
- **Authors:** (not specified)
- **Venue:** International Journal of Artificial Intelligence in Education (Springer)
- **Year:** 2025
- **URL:** https://link.springer.com/article/10.1007/s40593-025-00480-y
- **Key Contribution:** Validates the Speech Enabled Reading Diagnostics App (SERDA) for Dutch oral reading fluency assessment. Uses speech recognition and speech-based diagnostics to provide individualized feedback on children's reading performance with automatic scoring to reduce teacher testing burden.

---

## Section 7: Commercial/Practical Ensemble Approaches

### 7.1 Telnyx Multi-ASR Unified API
- **Year:** 2024-2025
- **URL:** https://telnyx.com/products/speech-to-text-api
- **Key Contribution:** Offers access to Telnyx STT (Whisper), Google STT, Azure STT, Deepgram Nova 2, Deepgram Nova 3, and Deepgram Flux through a single unified API. Developers can switch between ASR engines based on cost, accuracy, or language requirements without changing code. **The most directly relevant commercial platform for our multi-engine approach -- proves the concept of routing between Google and Deepgram via a single API.**

### 7.2 Gladia: Whisper-Zero and Ensemble Transcription
- **Year:** 2024-2025
- **URL:** https://www.gladia.io
- **Key Contribution:** Gladia's proprietary engine operates as an ML ensemble where each stage is powered by one or several AI models. Whisper-Zero combines a complete rework of Whisper with multiple state-of-the-art models, trained on 1.5M+ hours of diverse audio. Achieves 10-15% better WER than Whisper Large v2/v3. Real-time transcription at 300ms latency. $16M Series A funding (Oct 2024). **Proves commercial viability of ensemble ASR approach.**

### 7.3 AssemblyAI Universal-2
- **Year:** 2024
- **URL:** https://www.assemblyai.com/universal-2
- **Key Contribution:** Uses a 600M parameter Conformer RNN-T model pre-trained on 12.5M hours of multilingual audio, then fine-tuned with supervised + pseudo-labeled data. Text formatting uses a modular multi-component architecture (multi-objective token classifier + seq2seq model) rather than a traditional multi-model ensemble. Not a true ensemble of independent ASR engines, but demonstrates the scale of modern single-engine architectures.

### 7.4 Speechmatics Ursa / Ursa 2
- **Year:** 2023-2025
- **URLs:**
  - https://www.speechmatics.com/company/articles-and-news/introducing-ursa-the-worlds-most-accurate-speech-to-text
  - https://www.speechmatics.com/company/articles-and-news/ursa-2-elevating-speech-recognition-across-52-languages
- **Key Contribution:** Three-module architecture: (1) 2B-parameter self-supervised model trained on 1M+ hours across 49 languages, (2) acoustic model trained on paired audio-transcript data, (3) language model. Ursa 2 further scales pre-training and body model size. Demonstrates the modular approach to ASR system design.

### 7.5 Rev.ai Reverb
- **Year:** 2024
- **URL:** https://www.rev.com/blog/introducing-reverb-open-source-asr-diarization
- **Key Contribution:** Open-source ASR and diarization models with scripts for combining ASR and diarization output into a single diarized transcript. Provides a full pipeline for production environments. Benchmarked against major cloud providers with consistently low WER.

---

## Section 8: Open-Source Tools and Frameworks

### 8.1 Generative Fusion Decoding (GFD) -- Open Source
- **URL:** https://github.com/mtkresearch/generative-fusion-decoding
- **Key Contribution:** Open-source implementation of the GFD framework for integrating LLMs into ASR systems. Plug-and-play, compatible with various auto-regressive models without re-training. **Potentially usable in our pipeline.**

### 8.2 NIST SCTK (ROVER Implementation)
- **URL:** https://github.com/usnistgov/SCTK
- **Key Contribution:** The official NIST implementation of ROVER for combining multiple ASR system outputs. Standard tool for ASR system combination research.

### 8.3 FunASR (Alibaba/ModelScope)
- **URL:** https://github.com/modelscope/FunASR
- **Key Contribution:** End-to-end speech recognition toolkit with pretrained models supporting ASR, VAD, text post-processing, and combined ASR-SpeakersDiarization pipelines (Paraformer-VAD-SPK).

### 8.4 MBR Decoding for HuggingFace Transformers
- **URL:** https://github.com/ZurichNLP/mbr
- **Key Contribution:** Open-source implementation of Minimum Bayes Risk decoding for HuggingFace Transformers. Can be used for system combination with multiple lattice inputs.

---

## Section 9: Comprehensive ASR Surveys

### 9.1 Automatic Speech Recognition in the Modern Era: Architectures, Training, and Evaluation
- **Venue:** arXiv (comprehensive survey)
- **Year:** 2025
- **URL:** https://arxiv.org/html/2510.12827
- **Key Contribution:** Comprehensive survey covering the evolution from GMM-HMM and DNN-HMM hybrid systems to end-to-end neural architectures (CTC, AED, RNN-T, Transformer/Conformer). Covers self-supervised learning (wav2vec 2.0), multilingual models, and modern evaluation practices.

### 9.2 Gladia Review: Best ASR Engines and Models in 2024
- **URL:** https://www.gladia.io/blog/a-review-of-the-best-asr-engines-and-the-models-powering-them-in-2024
- **Key Contribution:** Practical comparison of commercial ASR engines including performance benchmarks. Notes that leading organizations implementing multi-model strategies can reduce error rates by an additional 35-40% compared to single-model approaches.

---

## Key Takeaways for Our Ensemble Reading Assessment System

### Most Promising Architectural Approaches:

1. **Multi-ASR + LLM Arbitration (Prakash et al., 2025):** Instead of ROVER-style voting, use an LLM to reconcile outputs from Google STT and Deepgram. The speechLLM variant that uses both text hypotheses and audio is most powerful but resource-intensive; the textual LLM variant (prompting with confusion sets from both engines) is more practical for real-time use.

2. **Confidence-Based Ensemble Voting (LREC-COLING 2024):** Use entropy-based confidence scores from each ASR engine with temperature scaling to create weighted voting. Achieves 14-20% WER reduction.

3. **Whisper + Prompted Miscue Detection (Apple, 2025):** Fine-tune Whisper with reading text prompts and augmented tokenizer for end-to-end miscue detection. Could serve as a third engine in our ensemble.

4. **N-best + LLM Correction:** Feed N-best hypotheses from both engines to an LLM (GPT-4 or fine-tuned T5) for error correction with constrained decoding.

5. **GFD (Generative Fusion Decoding):** Open-source plug-and-play framework for real-time ASR+LLM fusion, compatible with various models.

### Practical Recommendations:

- **Telnyx** already offers a unified API routing between Google STT and Deepgram -- worth evaluating as infrastructure.
- **Gladia** proves that ensemble ASR with 300ms latency is commercially viable.
- For children's disfluent speech specifically, the **CHSER dataset** and **disfluency-aware language models** should be incorporated.
- **CTC-based forced alignment gap classification** (arXiv 2409.10177) can augment any ASR model with disfluency detection at inference time.
- Consider a **two-tier approach**: (1) real-time ensemble of Google + Deepgram with confidence-based selection, (2) offline LLM-based correction using N-best hypotheses from both engines for final scoring.

---
---

# SECOND PASS: Additional High-Impact Sources

## Search Summary (Second Pass)

12 additional targeted queries were executed covering: GenSEC-2 challenge, NIST/CHiME evaluation campaigns, Whisper v3 Turbo benchmarks, NVIDIA Parakeet/Canary models, Moonshine ASR, w2v-BERT, Google USM, audio language models (Qwen-Audio, SALMONN), WCPM automation, forced alignment for reading assessment, hybrid vs end-to-end ASR comparisons, and multi-channel classroom ASR. Follow-up queries further explored WhisperKit, Whisper-LM, Deepgram Nova-3, speech foundation model benchmarks on child speech, SERDA, Amira Learning, FlanEC, DARAG, and the Open ASR Leaderboard.

---

## Section 10: GenSEC Challenge and Post-ASR Correction Advances

### 10.1 GenSEC Challenge (IEEE SLT 2024)
- **Organizers:** Chen et al.
- **Venue:** IEEE SLT 2024 Workshop
- **Year:** 2024
- **URLs:**
  - Official site: https://sites.google.com/view/gensec-challenge/home
  - HuggingFace: https://huggingface.co/GenSEC-LLM
  - Paper: https://arxiv.org/abs/2409.09785
- **Key Contribution:** The GenSEC challenge comprises three post-ASR language modeling tasks: (i) post-ASR transcription correction, (ii) speaker tagging (correcting speaker diarization labels), and (iii) emotion recognition. Uses the HyPoradise dataset with N-best hypothesis lists from multiple ASR systems. The challenge provides a standardized framework for evaluating LLM-based correction of ASR outputs. Speaker tagging (Track 2) uses contextual beam search with LLMs to correct speaker labels. **No confirmed GenSEC-2 (second edition) found at time of search -- the original challenge at SLT 2024 appears to be the primary event, with ongoing community activity on HuggingFace.**

### 10.2 FlanEC: Exploring Flan-T5 for Post-ASR Error Correction
- **Authors:** Moreno La Quatra, Sabato Marco Sinerchia
- **Venue:** IEEE SLT 2024 / GenSEC Challenge (arXiv Jan 2025)
- **Year:** 2025
- **URLs:**
  - https://arxiv.org/abs/2501.12979
  - https://github.com/MorenoLaQuatra/FlanEC
- **Key Contribution:** An encoder-decoder model leveraging Flan-T5 (250M to 3B parameters) for post-ASR generative speech error correction. Maps N-best hypotheses to a single corrected output. Training combines diverse datasets (ATIS, Tedlium3, Switchboard) to enhance cross-domain generalization. Evaluated on the HyPoradise dataset. **Open-source implementation available. Practical for our pipeline as a post-processing step that takes N-best from Google + Deepgram.**

### 10.3 Failing Forward (DARAG): Improving Generative Error Correction for ASR with Synthetic Data and Retrieval Augmentation
- **Authors:** (not specified)
- **Venue:** ACL 2025 Findings
- **Year:** 2025
- **URLs:**
  - https://arxiv.org/abs/2410.13198
  - https://aclanthology.org/2025.findings-acl.125.pdf
- **Key Contribution:** Proposes DARAG (Data- and Retrieval-Augmented Generative Error Correction). Augments GEC training with synthetic data from LLMs and TTS models to simulate domain-specific errors. Introduces retrieval-augmented correction using entity databases. Achieves 8-30% relative WER improvement in-domain and 10-33% out-of-domain. **The retrieval augmentation concept is directly applicable -- we could retrieve from the target reading passage to improve correction accuracy.**

### 10.4 DeRAGEC: Denoising Named Entity Candidates with Synthetic Rationale for ASR Error Correction
- **Authors:** (not specified)
- **Venue:** ACL 2025 Findings
- **Year:** 2025
- **URL:** https://aclanthology.org/2025.findings-acl.786/
- **Key Contribution:** Extends RAGEC framework with synthetic denoising rationales to filter noisy Named Entity candidates before correction. Uses phonetic similarity and augmented definitions to refine retrieved NEs via in-context learning, requiring no additional training. **Relevant for correcting proper nouns and character names in reading passages.**

### 10.5 Vosk Blog: Practical Experiments with LLM-based ASR Error Correction
- **Authors:** Alpha Cephei (Vosk developers)
- **Year:** 2025
- **URL:** https://alphacephei.com/nsh/2025/03/15/generative-error-correction.html
- **Key Contribution:** Practical engineering blog evaluating GenSEC-style LLM correction on real-world ASR outputs. Provides hands-on insights into deploying LLM post-correction in production systems using open-source tools. Useful as a practitioner's guide to implementing these techniques.

---

## Section 11: NIST and CHiME Evaluation Campaigns

### 11.1 NIST Rich Transcription (RT) Evaluation Series
- **Organizer:** NIST (National Institute of Standards and Technology)
- **Year:** 2002-2009 (historical), OpenASR 2020+
- **URLs:**
  - https://www.nist.gov/itl/iad/mig/rich-transcription-evaluation
  - https://www.nist.gov/itl/iad/mig/openasr-challenge
  - Eval plan: https://www.nist.gov/system/files/documents/2021/08/03/OpenASR20_EvalPlan_v1_5.pdf
- **Key Contribution:** The foundational ASR evaluation series, covering STT tasks for broadcast news, conversational telephone speech, and meeting room speech. The OpenASR Challenge (2020+) continued this tradition, evaluating ASR systems under controlled conditions. Historical ROVER and system combination methods were largely developed in this context. **The methodology for scoring (SCTK tools, WER computation) remains the standard used today.**

### 11.2 CHiME-8 Challenge (2024)
- **Organizers:** CHiME Challenge Committee
- **Venue:** InterSpeech 2024
- **Year:** 2024
- **URLs:**
  - https://www.chimechallenge.org/challenges/chime8/index
  - DASR task: https://www.chimechallenge.org/challenges/chime8/task1/index
  - NOTSOFAR task: https://www.chimechallenge.org/challenges/chime8/task2/index
- **Key Contribution:** Three sub-tasks: DASR (Distant ASR with diarization), NOTSOFAR-1 (Natural Office Talkers in Settings Of Far-field Audio Recordings), and MMCSG. Ran February-July 2024. Key finding: **Whisper was extremely popular among participants, but the 2nd and 3rd place winners in the multi-channel track used ensembles of multiple ASR models.** The USTC team won with a Dia-Sep-ASR (diarization-separation-ASR) pipeline approach. Demonstrates that multi-model ensembles remain competitive at the highest evaluation levels.

### 11.3 NOTSOFAR-1 Challenge: Summary of Highlights and Learnings
- **Authors:** Microsoft Research et al.
- **Venue:** InterSpeech 2024 / ScienceDirect
- **Year:** 2024-2025
- **URLs:**
  - https://arxiv.org/html/2501.17304
  - https://www.sciencedirect.com/science/article/abs/pii/S088523082500021X
  - GitHub: https://github.com/microsoft/NOTSOFAR1-Challenge
- **Key Contribution:** Distant diarization and ASR challenge with ~280 meetings across ~30 conference rooms. Features single-channel and multi-channel tracks. NTT system achieved 63% relative tcpWER improvement by developing multiple ASR models exploiting Whisper and WavLM speech foundation models as an ensemble. Open-source challenge toolkit available on GitHub. **Demonstrates that foundation model ensembles (Whisper + WavLM) are state-of-the-art for distant/noisy ASR.**

### 11.4 NTT Multi-Speaker ASR System for CHiME-8 DASR
- **Authors:** NTT team
- **Venue:** CHiME 2024 Workshop
- **Year:** 2024-2025
- **URLs:**
  - https://arxiv.org/html/2502.09859
  - https://www.researchgate.net/publication/385154085
- **Key Contribution:** Microphone array geometry-independent multi-talker distant ASR system. Exploits ensembles of Whisper and WavLM foundation models. Achieved state-of-the-art among geometry-independent systems on NOTSOFAR-1. **Provides a concrete architecture for combining multiple speech foundation models in challenging acoustic environments.**

---

## Section 12: Modern ASR Model Architectures

### 12.1 NVIDIA Parakeet ASR Family
- **Developer:** NVIDIA (with Suno.ai collaboration)
- **Year:** 2024-2025
- **URLs:**
  - Blog: https://developer.nvidia.com/blog/pushing-the-boundaries-of-speech-recognition-with-nemo-parakeet-asr-models/
  - Parakeet-TDT-0.6b-v3: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
  - Performance blog: https://developer.nvidia.com/blog/nvidia-speech-and-translation-ai-models-set-records-for-speed-and-accuracy/
  - NeMo: https://github.com/NVIDIA-NeMo/NeMo
- **Key Contribution:** Family of ASR models with FastConformer encoder and CTC, RNN-T, or TDT (Token-and-Duration Transducer) decoder. Available in 0.6B and 1.1B parameter sizes. **Parakeet-TDT was the first model to achieve average WER below 7.0% on the HuggingFace Open ASR Leaderboard.** Parakeet v2 offers 6.05% WER at 50x faster than alternatives. V3 extends to 25 European languages. The TDT decoder can perform multiple predictions per step, making it faster at inference. Deployed via NVIDIA Riva NIM microservices. **Open-source via NeMo framework -- a strong candidate as a third engine in our ensemble.**

### 12.2 NVIDIA Canary Multilingual ASR
- **Developer:** NVIDIA
- **Year:** 2024-2025
- **URLs:**
  - Blog: https://developer.nvidia.com/blog/new-standard-for-speech-recognition-and-translation-from-the-nvidia-nemo-canary-model/
  - Overview: https://tech-now.io/en/blogs/nvidia-speech-ai-transforming-multilingual-voice-technology-with-granary-canary-parakeet
- **Key Contribution:** Encoder-decoder model with FastConformer Encoder and Transformer Decoder supporting 25 EU languages + translation. Canary-1b-v2 trained on NVIDIA's Granary dataset. **Canary-Qwen-2.5B currently tops the HuggingFace Open ASR Leaderboard at 5.63% WER for English.** Represents the fusion of ASR encoder with LLM decoder (Qwen). **This LLM-decoder approach is architecturally significant -- it shows the trend of integrating LLMs directly into ASR models rather than as post-processing.**

### 12.3 Moonshine: Fast ASR for Edge Devices
- **Developer:** Useful Sensors / Moonshine AI
- **Year:** 2024-2025
- **URLs:**
  - GitHub: https://github.com/moonshine-ai/moonshine
  - Paper: https://arxiv.org/html/2410.15608v1
  - Flavors paper: https://arxiv.org/html/2509.02523v1
- **Key Contribution:** Family of speech-to-text models optimized for edge devices. Tiny model (27M params, ~190MB) and Base model (62M params, ~400MB). Processes audio 5-15x faster than Whisper. WER 48% lower than similarly-sized Whisper Tiny. 27M-parameter Moonshine Tiny matches or outperforms the 28x-larger Whisper Medium across 6 languages. Compute scales with input audio length (unlike Whisper's fixed 30s chunks). Supports ONNX runtime for on-device deployment. Currently supports 8 languages. **Potentially useful for real-time streaming in our reading assessment tool, where low latency matters for immediate feedback.**

### 12.4 WhisperKit: On-device Real-time ASR on Apple Silicon
- **Authors:** Argmax Inc.
- **Venue:** ICML 2025 (TTODLer-FM Workshop, oral)
- **Year:** 2025
- **URLs:**
  - https://arxiv.org/abs/2507.10860
  - https://github.com/argmaxinc/WhisperKit
- **Key Contribution:** Optimized on-device inference system deploying Whisper models for real-time streaming transcription on Apple devices. Whisper Large v3 Turbo (1B params) matches or exceeds gpt-4o-transcribe accuracy while running on-device. Achieves lowest latency (0.46s) with highest accuracy (2.2% WER), outperforming cloud-based systems including Deepgram nova-3 and gpt-4o-transcribe. Leverages Apple Neural Engine. **Demonstrates that on-device Whisper can beat cloud APIs -- relevant for privacy-sensitive school deployments where student audio shouldn't leave the device.**

### 12.5 Whisper Large V3 Turbo
- **Developer:** OpenAI
- **Year:** October 2024
- **URLs:**
  - https://github.com/openai/whisper
  - Medium analysis: https://medium.com/axinc-ai/whisper-large-v3-turbo-high-accuracy-and-fast-speech-recognition-model-be2f6af77bdc
  - Benchmarks: https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks
- **Key Contribution:** Reduces decoder layers from 32 to 4, achieving 5.4x speedup while maintaining similar accuracy to Whisper Large V2. 2.7% WER on English clean audio. For most languages, Large-v2 and Large-v3 have lower WER than Turbo, but Turbo is significantly faster. No specific child speech benchmarks published. Included in MLPerf Inference v5.1 benchmarks (Sept 2025). **The speed improvement makes it viable for real-time streaming assessment, where the original Large model was too slow.**

### 12.6 Whisper-LM: Improving ASR with Language Model Integration
- **Authors:** HiTZ research group
- **Venue:** arXiv (March 2025)
- **Year:** 2025
- **URLs:**
  - https://arxiv.org/abs/2503.23542
  - https://huggingface.co/HiTZ/whisper-lm-ngrams
- **Key Contribution:** Integrates traditional and LLM language models with fine-tuned Whisper by merging internal scores at inference time (not prompting). Achieves up to 51% improvement on in-distribution and 34% on out-of-distribution data. Reveals a key trade-off: traditional n-gram LMs provide better raw performance gains while LLMs provide stronger robustness across domains. **For our reading assessment, integrating a domain-specific language model (built from the target reading passage) could substantially improve Whisper's accuracy on known text.**

---

## Section 13: Self-Supervised and Foundation Models for Speech

### 13.1 W2v-BERT (Google Brain)
- **Authors:** Chung, Zhang et al. (Google Brain)
- **Year:** 2021 (original), continued use through 2025
- **URLs:**
  - https://arxiv.org/abs/2108.06209
  - https://anwarvic.github.io/speech-recognition/w2v-BERT
- **Key Contribution:** Combines contrastive learning and masked language modeling for self-supervised speech pre-training, optimized end-to-end (unlike HuBERT or vq-wav2vec which require separate steps). Achieves 5-10% relative WER reduction over conformer-based wav2vec 2.0 and HuBERT on LibriSpeech. On Google Voice Search, outperforms wav2vec 2.0 by 30%+ relatively. **Forms the encoder backbone for Google's USM and is used in the SeamlessM4T architecture.**

### 13.2 Wav2Vec2-BERT (Meta, SeamlessM4T)
- **Developer:** Meta AI
- **Year:** 2023
- **Key Contribution:** 580M-parameter audio model pre-trained on 4.5M hours of unlabeled audio across 143+ languages. Part of the SeamlessM4T speech translation pipeline. Distinct from Google's w2v-BERT. Provides robust multilingual speech representations.

### 13.3 Google Universal Speech Model (USM)
- **Developer:** Google Research
- **Year:** 2023 (published), 2024-2025 (continued development)
- **URLs:**
  - Blog: https://research.google/blog/universal-speech-model-usm-state-of-the-art-speech-ai-for-100-languages/
  - Site: https://sites.research.google/usm/
  - Paper: https://arxiv.org/abs/2303.01037
- **Key Contribution:** 2B-parameter model trained on 12M hours of speech spanning 300+ languages. Uses Conformer encoder with CTC/RNN-T/LAS decoders. Achieves <30% WER average across 73 languages. 32.7% relative lower WER vs Whisper for 18 languages; 65.8% relative lower WER on FLEURS. Pre-trained via large-scale unlabeled multilingual audio, fine-tuned on smaller labeled sets. **Currently only available via private Google Cloud API with restricted access. Not yet practical for our system, but represents the ceiling of what a single large-scale model can achieve.**

### 13.4 Benchmarking Children's ASR with Supervised and Self-supervised Speech Foundation Models
- **Authors:** (not specified)
- **Venue:** arXiv
- **Year:** 2024
- **URL:** https://arxiv.org/html/2406.10507v1
- **Key Contribution:** Comprehensive benchmark of speech foundation models on child speech. Key findings: (1) **NVIDIA Canary and Parakeet outperform Whisper on child speech despite less training data**, indicating data quality > quantity. (2) **Supervised SFMs outperform self-supervised SFMs after finetuning on child speech.** (3) wav2vec2 slightly outperforms Whisper on child speech and generalizes better within distribution. (4) Whisper finetuning works better for unseen datasets. (5) WavLM achieves best performance among SSL models due to noisy/multi-talker pretraining. **Critical finding for our system: we should consider NVIDIA Parakeet as a potential engine, and wav2vec2/WavLM for auxiliary tasks like forced alignment and disfluency detection.**

---

## Section 14: Audio Language Models and Multimodal Speech Understanding

### 14.1 Qwen2-Audio (Alibaba Cloud)
- **Developer:** Alibaba Cloud
- **Year:** August 2024
- **URLs:**
  - Paper: https://arxiv.org/abs/2407.10759
  - GitHub: https://github.com/QwenLM/Qwen2-Audio
- **Key Contribution:** Large Audio-Language Model (LALM) processing audio + text inputs to generate text outputs. Supports two modes: voice chat (free-form voice interaction without text) and audio analysis (audio + text instructions). 7B parameter model. Capable of ASR, audio understanding, speech emotion recognition, and sound event classification in a single model. **Relevant as a potential all-in-one replacement for separate ASR + disfluency detection + prosody analysis components, though latency may be prohibitive for real-time use.**

### 14.2 SALMONN (Bytedance/Tsinghua)
- **Venue:** ICLR 2024
- **Year:** 2024
- **URLs:**
  - Paper: https://arxiv.org/pdf/2310.13289
  - OpenReview: https://openreview.net/forum?id=yuuyPlywuO
- **Key Contribution:** Speech Audio Language Music Open Neural Network -- a single audio-text multimodal LLM that perceives speech, audio events, and music. Uses a dual encoder structure: Whisper speech encoder + BEATs audio encoder, feeding into an LLM. Published at ICLR 2024. Video-SALMONN extends to audio-visual understanding. **The dual-encoder design (speech + audio) is interesting for classroom settings where background noise classification could inform ASR confidence adjustments.**

### 14.3 Gemini 2.5 Flash Native Audio (Google)
- **Developer:** Google DeepMind
- **Year:** 2025
- **URLs:**
  - https://deepmind.google/models/gemini-audio/
  - https://blog.google/products/gemini/gemini-audio-model-updates/
  - Cloud docs: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/audio-understanding
- **Key Contribution:** Multimodal model processing audio natively without stripping emotional content or vocal cues. Supports 70+ languages with live speech-to-speech translation. Outperforms all other models on non-native accented speech and specialized speech domains. Maintains richness of human speech throughout processing pipeline. **The native audio processing (vs. ASR-then-NLU pipeline) represents the next paradigm -- could eventually replace separate ASR+LLM correction pipelines for reading assessment, though currently too expensive/slow for real-time per-student use.**

### 14.4 IBM Granite Speech 3.3 8B
- **Developer:** IBM Research
- **Year:** 2025
- **URLs:**
  - https://research.ibm.com/blog/granite-speech-recognition-hugging-face-chart
  - HuggingFace leaderboard: https://huggingface.co/spaces/hf-audio/open_asr_leaderboard
- **Key Contribution:** 8B-parameter speech model achieving 5.85% WER, #2 on the HuggingFace Open ASR Leaderboard behind NVIDIA Canary-Qwen. Combines ASR encoder with LLM decoder. Part of the growing trend of LLM-integrated ASR models. **Open-source and available for deployment.**

---

## Section 15: Forced Alignment and Reading Assessment

### 15.1 Wav2TextGrid: A Tunable Forced Alignment System Based on Deep Learning for Child Speech
- **Authors:** Kadambi et al.
- **Venue:** Journal of Speech, Language, and Hearing Research (ASHA)
- **Year:** 2025
- **URLs:**
  - Paper: https://pubs.asha.org/doi/abs/10.1044/2024_JSLHR-24-00347
  - PubMed: https://pubmed.ncbi.nlm.nih.gov/40163771/
  - GitHub: https://github.com/pkadambi/Wav2TextGrid
- **Key Contribution:** A trainable, speaker-adaptive phonetic forced aligner using Wav2Vec2, specifically developed for children's speech (ages 3-6). Initialized on CommonVoice/LibriSpeech, fine-tuned on TOCS (Test of Childhood Stuttering) corpus with 42 neurotypical children. Performance matches existing methods with ~13 min of labeled data; 45-60 min yields significant improvement. Plosive and affricate alignment accuracy improved 40%+ over baseline. **Open-source with GUI. Directly applicable for word/phoneme-level alignment in our reading assessment pipeline.**

### 15.2 A Dataset and Two-Pass System for Reading Miscue Detection
- **Authors:** Raj Gothi, Rahul Kumar, Mildred Pereira, Nagesh Nayak, Preeti Rao
- **Venue:** InterSpeech 2024
- **Year:** 2024
- **URLs:**
  - https://www.isca-archive.org/interspeech_2024/gothi24_interspeech.html
  - Paper: https://www.ee.iitb.ac.in/course/~daplab/publications/2024/IS2024_Reading_Miscues_camera.pdf
  - Dataset: https://github.com/DAP-Lab/mps_dataset
- **Key Contribution:** Introduces a large children's oral reading corpus (19 hours, L2 English, uniformly distributed across 3 grades) with manual transcriptions and miscue labels. The two-pass system: Pass 1 uses ASR to transcribe, Pass 2 compares against target text to identify miscues. Proposes an end-to-end architecture incorporating target reading text via prompting, trained for both verbatim transcription and direct miscue detection. **Open-source dataset (MPS Dataset on GitHub). Extremely relevant -- provides both a methodology and training data for our exact use case.**

### 15.3 Deep Learning for Assessment of Oral Reading Fluency
- **Authors:** (not specified)
- **Venue:** arXiv
- **Year:** 2024-2025
- **URL:** https://arxiv.org/html/2405.19426v2
- **Key Contribution:** Proposes the first end-to-end trained solution for oral reading fluency prediction using pre-trained wav2vec models. Proves more informative than hand-crafted features. Introduces intermediate hierarchical pooling stages at word level via forced alignment from ASR decoders, including pauses after words to detect phrase breaks (a key prosodic event). **Demonstrates the wav2vec approach to holistic fluency scoring, not just word accuracy.**

### 15.4 A Unified Model for Oral Reading Fluency and Student Prosody
- **Authors:** Yihao Wang, Zhongdi Wu, Joseph Nese, Akihito Kamata, Vedant Nilabh, Eric C. Larson
- **Venue:** ICASSP 2025
- **Year:** 2025
- **URL:** https://s2.smu.edu/~eclarson/pubs/2025_ICASSP.pdf
- **Key Contribution:** Unified model combining contrastive self-supervised embedding with transfer learning suffix network. The embedding model generates student voice embeddings trained on oral reading fluency data. Achieves 19.6% improvement over previous studies (best prior Cohen's Kappa was 0.46). Addresses generalization across students and passages. **From the SMU/Oregon State team that has been publishing consistently in this space -- they provide the most mature pipeline for automated prosody assessment.**

### 15.5 Improving Automated Scoring of Prosody in Oral Reading Fluency Using Deep Learning
- **Authors:** (not specified)
- **Venue:** Frontiers in Education
- **Year:** November 2024
- **URL:** https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2024.1440760/full
- **Key Contribution:** Addresses the difficulty of quantifying prosody in oral reading fluency through deep learning. Part of the growing body of work replacing hand-crafted prosodic features with learned representations.

### 15.6 Self-Supervised Models for Phoneme Recognition: Applications in Children's Speech for Reading Learning
- **Authors:** (not specified)
- **Venue:** arXiv
- **Year:** March 2025
- **URL:** https://arxiv.org/abs/2503.04710
- **Key Contribution:** Evaluates self-supervised models (wav2vec2, HuBERT, WavLM) for phoneme recognition in children's speech for reading education. Uses KidsTALC dataset (German children). Best model achieves PER of 14.3% and WER of 31.6% on unseen child speech with data augmentation (pitch shifting, formant shifting, speed variation). **Demonstrates that SSL models can be adapted for phoneme-level tracking in reading assessment.**

---

## Section 16: WCPM Automation and Reading Assessment Tools

### 16.1 SERDA: Speech Enabled Reading Diagnostics App
- **Developer:** Cito (Dutch testing organization)
- **Year:** 2025
- **URLs:**
  - Validation: https://pmc.ncbi.nlm.nih.gov/articles/PMC12686063/
  - Paper: https://link.springer.com/article/10.1007/s40593-025-00480-y
  - Framework: https://cito.nl/kennisbank-stichting-cito/the-framework-and-development-of-serda-speech-enabled-reading-fluency-assessment-for-dutch/
- **Key Contribution:** Digital automatic fluency assessment tool for early primary education. Incorporates ASR for automatic scoring of word reading, passage reading, and prosody. Validated on 176 hours of speech from 653 children (grades 2-3, Dutch primary education). Reduces teacher testing burden through automatic scoring. Provides individualized feedback on all fluency components. **The most mature deployed reading assessment system using ASR, though specific to Dutch.**

### 16.2 Amira Learning (HMH)
- **Developer:** Amira Learning (acquired by Houghton Mifflin Harcourt)
- **Year:** 2024-2025
- **URLs:**
  - https://amiralearning.com/
  - https://www.hmhco.com/programs/amira
  - Science: https://amiralearning.com/science-of-reading
- **Key Contribution:** AI-powered reading assessment and tutoring platform used by 4+ million students worldwide. Listens to students read aloud, analyzes each word, diagnoses foundational skills, identifies reading difficulties in 20 minutes or less. Uses Claude AI (Anthropic) for AI features. Statistically significant effects: +0.26 effect size in kindergarten, +0.06 in first grade on DIBELS. Iowa invested $5.5M+ for statewide deployment (2024-2025). **The leading commercial competitor in our space. Uses ASR + AI to detect when students are struggling and provides tailored suggestions. Worth studying their approach to miscue detection.**

### 16.3 CORE: Computerized Oral Reading Evaluation (IES-funded)
- **Funder:** Institute of Education Sciences (IES), US Dept of Education
- **Year:** Active research
- **URL:** https://ies.ed.gov/use-work/awards/measuring-oral-reading-fluency-computerized-oral-reading-evaluation-core
- **Key Contribution:** Federally funded project to develop computerized oral reading evaluation measuring WCPM. Part of IES's broader investment in technology-enabled reading assessment. **Indicates federal interest and funding in this space.**

### 16.4 Supporting Literacy Assessment in West Africa: Using State-of-the-Art Speech Models
- **Authors:** (not specified)
- **Venue:** International Journal of Artificial Intelligence in Education (Springer)
- **Year:** 2024
- **URL:** https://link.springer.com/article/10.1007/s40593-024-00435-9
- **Key Contribution:** Applies state-of-the-art speech models (Whisper V2, no fine-tuning) to assess oral reading fluency of Ghanaian primary school students. Achieves 10.3% WER on children reading aloud. Demonstrates that modern ASR models work reasonably well on child speech even without fine-tuning, particularly in read-aloud contexts where the speech is more structured than spontaneous. **Important baseline -- shows that zero-shot Whisper is already usable for reading assessment.**

### 16.5 Whisper Fine-tuning for Child Speech: Key Benchmarks
- **Various Authors**
- **Year:** 2024-2025
- **URLs:**
  - MyST results: https://www.colorado.edu/research/ai-institute/sites/default/files/attached-files/childasr_icassp24_camera-ready_0.pdf
  - Adaptation: https://arxiv.org/pdf/2307.13008
  - Edge: https://arxiv.org/abs/2507.14451
- **Key Benchmarks Compiled:**
  - **MyST dataset:** Fine-tuned Whisper achieves 9.2% WER (38% relative reduction from baseline). Zero-shot Whisper Large: 12.5% WER.
  - **Read-aloud speech:** American children reading a book had only 7% baseline WER.
  - **British children fine-tuning:** WER reduced from 74% to 3% (96% reduction) with domain-matched fine-tuning.
  - **Classroom speech (ISAT):** 54% WER even after fine-tuning (7% relative improvement), showing spontaneous classroom speech remains very challenging.
  - **On-device (Raspberry Pi):** Whisper tiny.en achieves 15.9% WER on MyST, with low-rank compression reducing encoder by 0.51M params at 11% relative WER increase.
  - **Key insight:** Fine-tuning dataset distribution match is more important than size. Combining diverse child speech datasets (native + non-native) yields best generalization.

---

## Section 17: Hybrid vs End-to-End ASR

### 17.1 Practical Comparison: Kaldi vs Whisper vs Wav2Vec2 (2025)
- **URLs:**
  - Deepgram comparison: https://deepgram.com/learn/benchmarking-top-open-source-speech-models
  - GraphLogic benchmark: https://graphlogic.ai/blog/ai-trends-insights/voice-technology-trends/benchmarking-top-open-source-speech-recognition-models-whisper-facebook-wav2vec2-and-kaldi/
  - Market analysis: https://speechtechjobs.com/blog/kaldi-vs-whisper-vs-wav2vec-2026.html
- **Key Findings:**
  - **Accuracy:** Whisper is the clear winner. Kaldi produces "pathologically bad WERs" on long-form audio -- the hybrid pipeline "simply cannot compete."
  - **Speed:** wav2vec 2.0 is an order of magnitude faster than Whisper. Kaldi/Vosk provide native streaming APIs; Whisper requires custom streaming implementations.
  - **Deployment:** Kaldi is in gradual decline but still dominant in production legacy systems. Whisper shows rapid adoption for new products. wav2vec2 occupies a middle ground.
  - **Hybrid advantages:** Kaldi's modularity allows blending symbolic + neural approaches. Hybrids may outperform pure E2E in efficiency. Customizable language models and pronunciation dictionaries.
  - **Trend:** Migration from hybrid to end-to-end is accelerating. Fine-tuning Whisper is becoming the standard practice.
  - **For our system:** End-to-end models (Whisper, Deepgram) are clearly superior for accuracy. Kaldi-style hybrid approaches may still be relevant for the forced alignment component (pronunciation dictionary lookup for reading passages).

---

## Section 18: Multi-Channel ASR and Classroom Deployment

### 18.1 Advances in Microphone Array Processing and Multichannel Speech Enhancement (2025 Survey)
- **Venue:** arXiv (February 2025)
- **Year:** 2025
- **URL:** https://arxiv.org/html/2502.09037v1
- **Key Contribution:** Comprehensive review of microphone array processing including all-neural beamformers. Deep learning has shifted multichannel speech enhancement toward data-driven approaches. Covers beamforming, source separation, acoustic echo cancellation, and multi-channel speech enhancement. **Relevant for classroom deployment where multiple students may be reading simultaneously or where ambient noise is significant.**

### 18.2 HSCMA 2024: Hands-free Speech Communication and Microphone Arrays
- **Year:** 2024
- **URL:** https://sites.google.com/view/hscma2024
- **Key Contribution:** Workshop covering microphone array processing, beamforming, source separation. Bridges researchers and industry practitioners. **Relevant venue for staying current on classroom-deployable audio capture technology.**

### 18.3 In-Car Multi-Channel ASR Challenge (ICMC-ASR) at ICASSP 2024
- **Venue:** ICASSP 2024
- **Year:** 2024
- **URL:** https://signalprocessingsociety.org/publications-resources/data-challenges/car-multi-channel-automatic-speech-recognition-challenge-icmc
- **Key Contribution:** While focused on in-car environments, the multi-channel ASR techniques (beamforming, channel selection, multi-channel fusion) are directly transferable to classroom settings with similar noise challenges (multiple speakers, reverberation, background noise). **The channel selection techniques are analogous to our ASR engine selection problem.**

### 18.4 Distant Multichannel Speech Recognition Using Cloud-Based Beamforming with Self-Attention Channel Combinator
- **Venue:** ICASSP 2024
- **Year:** 2024
- **URL:** https://ieeexplore.ieee.org/document/10476930/
- **Key Contribution:** Presents multichannel speech coding schemes that preserve phase relationships for cloud-based spatial processing. Self-attention channel combinator learns optimal channel weighting. **The self-attention weighting over channels is architecturally similar to attention-based weighting over multiple ASR engine outputs.**

---

## Section 19: Deepgram Nova-3 and Commercial ASR Benchmarks

### 19.1 Deepgram Nova-3
- **Developer:** Deepgram
- **Year:** 2025
- **URLs:**
  - https://deepgram.com/learn/introducing-nova-3-speech-to-text-api
  - Benchmarks: https://deepgram.com/learn/speech-to-text-benchmarks
  - Comparison: https://deepgram.com/learn/model-comparison-when-to-use-nova-2-vs-nova-3-for-devs
- **Key Contribution:** 54.2% WER reduction for streaming and 47.4% for batch vs competitors. Median WER between 5.26% and 6.84% in production across 9 domains. Specifically designed to filter background noise including "chatter of children." Tested on 2,703 files / 81 hours across podcast, video/media, meeting, phone, finance, medical, drive-thru, ATC, voicemail. **No specific classroom or child speech benchmark published, but children's chatter noise filtering is explicitly mentioned. We should request child-speech-specific benchmarks from Deepgram.**

### 19.2 Open ASR Leaderboard (HuggingFace, November 2025)
- **URL:** https://huggingface.co/spaces/hf-audio/open_asr_leaderboard
- **Paper:** https://arxiv.org/html/2510.06961v1
- **Key Rankings (English, as of late 2025):**
  1. NVIDIA Canary-Qwen-2.5B: 5.63% WER
  2. IBM Granite-Speech-3.3-8B: 5.85% WER
  3. Microsoft Phi-4-Multimodal-Instruct: (top tier)
  4. NVIDIA Parakeet-TDT-1.1B: <7.0% WER
  5. OpenAI Whisper Large v3: (best among purely open-source non-LLM models)
- **Key Insight:** Models combining Conformer/FastConformer encoders with LLM decoders (Qwen, Granite) currently lead. The leaderboard evaluates on 11 datasets across English, multilingual, and long-form tracks. **The trend is clear: ASR+LLM fusion models dominate the leaderboard, validating the ensemble/fusion approach for our system.**

---

## Section 20: Investigating Construct Representativeness and Prosody in ORF

### 20.1 Investigating Construct Representativeness and Linguistic Equity of Automated ORF Assessment with Prosody
- **Authors:** Liam Hannah, Eunice Eunhee Jang, Meng-Hsun Lee, Bruce Russell
- **Venue:** Language Learning & Technology (SAGE)
- **Year:** 2025
- **URL:** https://journals.sagepub.com/doi/10.1177/02655322251348956
- **Key Contribution:** Including prosody in automated oral reading fluency assessment (1) reduces discrepancies between English language learners (ELLs) and first-language speakers, (2) leads to better prediction of reading comprehension, and (3) provides meaningful diagnostic information. **Critical for our system serving struggling middle schoolers who may include ELLs -- prosody assessment makes the tool more equitable and diagnostically useful.**

---

## Updated Key Takeaways (Second Pass)

### New Models to Consider for Our Ensemble:

1. **NVIDIA Parakeet-TDT-1.1B:** Open-source, outperforms Whisper on child speech (per benchmarks in Section 13.4), first model <7% WER on Open ASR Leaderboard. Available via NeMo framework. Strong candidate as a third engine alongside Google STT and Deepgram.

2. **NVIDIA Canary-Qwen-2.5B:** Currently #1 on Open ASR Leaderboard (5.63% WER). Represents ASR+LLM fusion architecture. Could serve as a high-accuracy offline reference engine.

3. **Moonshine Tiny/Base:** For real-time streaming with minimal latency on edge devices. 5-15x faster than Whisper. Could provide instant preliminary transcription while heavier models process in parallel.

4. **WhisperKit (on-device):** Achieves 2.2% WER on-device, beating cloud APIs. Relevant for privacy-sensitive school deployments on iPad/Mac.

### Critical Findings for Our Architecture:

1. **Child speech benchmarks show supervised models (Parakeet, Canary) > self-supervised models (wav2vec2, HuBERT, WavLM) after fine-tuning.** But wav2vec2 generalizes better within distribution. WavLM is most robust to noise.

2. **Two commercial systems already dominate reading assessment:** SERDA (Dutch, academic) and Amira Learning (English, HMH, 4M+ students). Amira uses Claude AI. Both validate our approach.

3. **The forced alignment + two-pass paradigm (Gothi et al., InterSpeech 2024) with open-source dataset** is the most directly applicable methodology. First pass: ASR transcription. Second pass: alignment against target text for miscue detection.

4. **DARAG's retrieval augmentation** can be adapted for reading assessment -- retrieve from the target reading passage to constrain and improve ASR correction.

5. **Prosody assessment improves equity** for ELLs and struggling readers, and better predicts reading comprehension. Should be incorporated beyond just WCPM.

6. **On-device deployment** is becoming practical (WhisperKit, Moonshine) and may be preferable for student privacy in K-12 settings.

### Recommended Next Steps:

- Evaluate NVIDIA Parakeet-TDT on our reading passage audio alongside Google STT and Deepgram
- Implement the two-pass miscue detection pipeline (Gothi et al.) with our existing engines
- Test FlanEC as a post-processing layer that takes N-best from both engines
- Explore passage-specific language model integration (Whisper-LM approach) using the known reading text
- Investigate Wav2TextGrid for word-level forced alignment in our pipeline
- Consider adding prosody assessment (SMU/Larson group methodology) for holistic fluency scoring
