# Disfluency Suppression Risk: Fine-Tuning ASR on Clean Transcriptions

**Date:** 2026-02-08
**Context:** Risk assessment for the Parakeet TDT 0.6B v3 LoRA fine-tuning proposal (see `parakeet-lora-finetuning-proposal.md`)
**Core concern:** MyST has STANDARD transcriptions — fine-tuning on them may suppress the disfluency detection that the ORF pipeline depends on

---

## 1. What the Research Says: Clean Transcripts Suppress Disfluency Detection

### The Problem Is Real and Well-Documented

Standard ASR models are trained overwhelmingly on clean/edited transcripts. This creates a systematic bias: the model learns that disfluencies (partial words, repetitions, filled pauses, false starts) are noise to be suppressed rather than signal to be preserved.

**Key evidence:**

- **Whisper transcribes only 56% of disfluent words correctly** (Romana et al. 2024). Of the words Whisper fails to transcribe, 74% are disfluencies. The model actively suppresses them.

- **CrisperWhisper** (Zusag et al., Interspeech 2024) demonstrated that Whisper's standard training causes it to "omit filler words such as uh and um" and "automatically correct disfluencies to produce intelligible output." Their fix required explicit re-training on verbatim-annotated data.

- **Acoustically Precise Hesitation Tagging** (2025) showed that the transcription scheme matters enormously: the "Extra" scheme where filled pauses are precisely labeled yields 11.3% relative WER improvement over the "Pure" (clean) scheme, even on Whisper Large V3 Turbo. Clean labels actively hurt.

- The Interspeech 2025 paper by Vidal et al. on children's reading assessment specifically addresses this: they build **disfluency-aware language models** because standard ASR systematically fails on reading miscues.

### The Mechanism

When you fine-tune on transcripts where "the the the cat" is transcribed as "the cat," you are literally training the model to:
1. Map repeated audio frames to a single output token
2. Suppress partial-word emissions (CTC blank vs token decisions shift toward blank)
3. Reduce confidence on filled-pause tokens ("um", "uh")
4. Bias the decoder/LM toward fluent sequences

For a CTC/TDT model like Parakeet, this means the token-and-duration transducer learns to assign longer durations to blank tokens during disfluent segments, effectively "erasing" the disfluency from the output.

### Direct Relevance to the ORF Pipeline

The pipeline depends on Parakeet to capture:
- **Partial words** (false starts like "b- b- butterfly") — drives struggle detection
- **Repetitions** ("the the the") — drives hesitation/disfluency counting
- **Self-corrections** ("cat... no, cap") — drives near-miss resolution
- **Filled pauses** ("um", "uh") — drives prosody analysis

If fine-tuning on MyST's clean transcripts suppresses any of these, the downstream detectors in `diagnostics.js` lose their input signal. This is not a graceful degradation — it is a silent failure where the model produces fluent-looking output for disfluent speech, and the pipeline reports fewer errors than actually occurred.

---

## 2. Does LoRA's Parameter Efficiency Reduce This Risk?

### Yes, Significantly — But Does Not Eliminate It

The landmark paper **"LoRA Learns Less and Forgets Less"** (Biderman et al., TMLR 2024) establishes the fundamental tradeoff:

> LoRA substantially underperforms full finetuning on target domains but significantly better preserves base model capabilities.

Key findings relevant to disfluency preservation:

- **LoRA acts as an implicit regularizer** that is more effective than weight decay or dropout at preventing forgetting. By constraining updates to a low-rank subspace, it forces the fine-tuned model to stay behaviorally closer to the base model.
- **Forgetting decreases monotonically with decreasing rank.** Lower rank = less forgetting. Rank is "a knob to navigate the learning-forgetting tradeoffs."
- **LoRA mitigates distribution collapse.** Full fine-tuning often causes the model to lose diversity in its outputs; LoRA preserves it.

However, the paper studied code and math domains, not speech. The specific question of whether LoRA preserves disfluency sensitivity has not been directly studied.

### Why LoRA Still Poses a Risk

Even with LoRA (rank 8, ~1% of parameters), the adapted weights modify the encoder's attention and feed-forward layers. If the MyST training signal consistently rewards suppressing disfluencies (because the reference transcripts lack them), even small perturbations to attention patterns can shift the model's behavior at inference time. The encoder's representation of disfluent speech segments may be subtly altered to look more like the clean-transcript targets.

The risk is proportional to:
1. **How consistently MyST cleans disfluencies** (if MyST sometimes preserves them, the signal is mixed and less damaging)
2. **The LoRA rank** (rank 4 is safer than rank 8, which is safer than rank 16)
3. **Training duration** (more epochs = more adaptation = more risk)

---

## 3. LoRA Rank: Would Rank 4 Meaningfully Reduce the Risk?

### Yes — Lower Rank = Stronger Regularization

The paper **"How Much is Too Much? Exploring LoRA Rank Trade-offs"** (2024) confirms:

- Higher ranks correlate with increased parameter modification (Frobenius norm grows approximately logarithmically with rank)
- **Intermediate ranks (32-64) are recommended for general tasks**, but for our case where preservation is paramount, lower ranks are preferred
- Catastrophic forgetting was observed in dissimilar domains at higher ranks (e.g., medical fine-tuning degraded math performance by 10%)

**Adaptive Rank approaches** (DyRaLoRA, 2024) dynamically adjust rank per layer, allocating capacity where it matters most. This could allow acoustic adaptation in lower layers while preserving disfluency-sensitive behavior in higher layers.

### Practical Recommendation

For the ORF pipeline, the priority ordering is:

| Rank | Acoustic Adaptation | Disfluency Risk | Recommendation |
|------|-------------------|-----------------|----------------|
| 4    | Moderate          | Lowest          | Start here for safety |
| 8    | Good              | Moderate        | Current proposal default |
| 16   | Strong            | Higher          | Only if rank 8 insufficient |
| 32+  | Diminishing returns | Significant   | Avoid for this use case |

Starting at rank 4 and measuring disfluency preservation before increasing rank is the safest protocol.

---

## 4. Techniques to Preserve Disfluency Sensitivity During Fine-Tuning

### 4a. Data Mixing (Most Practical)

Mix the MyST clean data with a smaller corpus of disfluent speech to create a balanced training signal:

- **Ratio:** 80% MyST (acoustic adaptation) + 20% disfluent data (disfluency preservation)
- **Effect:** The model sees both clean and disfluent targets, preventing it from learning that disfluencies should always be suppressed
- **Precedent:** CrisperWhisper used a deliberate mix of verbatim-annotated corpora (AMI Meeting Corpus, PodcastFillers) alongside cleaner data. Their 3-stage training pipeline first adapts to a new tokenizer, then trains exclusively on verbatim data, then continues on the mixture.

### 4b. Multi-Task Learning (ASR + Disfluency Detection)

Joint training on both transcription and disfluency classification:

- **Approach:** Add a secondary classification head that predicts disfluency tags (filled pause, repetition, partial word, revision) alongside the primary ASR output
- **Research:** Wang et al. (AAAI 2020) showed multi-task self-supervised learning improves disfluency detection. The pre-trained network is fine-tuned using human-annotated disfluency detection training data.
- **Limitation:** Requires disfluency-annotated training data and modifications to the NeMo training pipeline. More complex than data mixing.

### 4c. Regularization Approaches

**Elastic Weight Consolidation (EWC):**
- Identifies which model parameters are most important for the base model's capabilities using the Fisher Information Matrix
- Penalizes changes to those parameters during fine-tuning
- **Directly studied for children's ASR:** Ahadzi et al. (Interspeech 2025) applied EWC to children's ASR on the MyST corpus, achieving 5.21% relative WER reduction compared to standard fine-tuning. The paper specifically addresses catastrophic forgetting in children's ASR.
- **Implementation:** Modify the loss function: L(theta) = L_new(theta) + lambda/2 * sum(F_i * (theta_i - theta*_i)^2)
- **Practical consideration:** Requires computing the Fisher Information Matrix on a representative disfluent dataset before fine-tuning on MyST

**Orthogonal Projection LoRA (OPLoRA):**
- Constrains LoRA updates to avoid interference with the dominant subspaces of pre-trained weights
- Theoretically ideal for preserving disfluency sensitivity while allowing acoustic adaptation
- **Status:** Very recent (2025), not yet proven for ASR

**LoRA Initialization Strategy:**
- "Put the Space of LoRA Initialization to the Extreme to Preserve Pre-trained Knowledge" (2025) argues that initialization space is more important than residual weights for knowledge preservation
- SVD-based initialization (initializing LoRA matrices from the SVD of existing weights) helps constrain adaptation to stay near the original weight manifold

### 4d. Curriculum / Staged Training

Train in two phases:
1. **Phase 1:** Fine-tune on MyST for acoustic adaptation (children's voice characteristics)
2. **Phase 2:** Continue training on a disfluent dataset to restore/reinforce disfluency sensitivity

This is the hybrid approach discussed in Section 7 below.

---

## 5. Children's Speech Datasets WITH Disfluent Transcriptions

### Datasets with Disfluency Annotations

| Dataset | Size | Age | Language | Disfluency Types | Availability |
|---------|------|-----|----------|-------------------|-------------|
| **FluencyBank Timestamped** | 5.3 hrs (adults who stutter) | Adults | English | Filled pauses, repetitions, revisions, partial words | Free (CC) |
| **FluencyBank (children)** | Variable | Children + Adults | English | General disfluencies | Free via TalkBank |
| **UCLASS** | 457 recordings | School-age children | English | Stuttering disfluencies | Free (UCL) |
| **SEP-28k** (Apple) | 28K 3-second clips | Mostly adults | English | Blocks, prolongations, sound/word repetitions, interjections | CC BY-NC 4.0 |
| **Portuguese ORF Corpus** | 20 hrs, 284 children | Ages 6-10 | Portuguese | Intra-word pauses, false starts, repetitions, mispronunciations | Research access |
| **Spanish ORF Corpus** (Vidal et al.) | 1,327 speakers | Ages 8-13 | Spanish | Manually annotated disfluencies + labeled miscues | Research access |

### Key Gaps

- **No large-scale English children's reading-aloud corpus with verbatim disfluency transcriptions exists publicly.** This is the critical missing piece.
- **UCLASS** has children's stuttered speech but annotations are not publicly labeled (previous researchers created their own).
- **FluencyBank** has timestamped disfluency labels but the updated version covers adults who stutter, not children reading aloud.
- **MyST** used "rich transcription guidelines" in Phase I (possibly capturing some disfluencies) but Phase II used "reduced guidelines" (likely cleaning them). The exact conventions are not publicly documented in detail.

### The MyST Transcription Question

The MyST corpus paper (Pradhan et al., LREC 2024) states:
- Phase I used "rich (slow, expensive) transcription guidelines — the ones typically used by speech recognition researchers"
- Phase II used "a reduced (quick, cheaper) version of those guidelines"
- "We tried to retain explicitly mispronounced words as much as possible"

This suggests Phase I may retain some disfluencies while Phase II likely does not. If training manifests can be filtered to Phase I data, the disfluency suppression risk may be reduced.

---

## 6. The Switchboard Question: Can Adult Disfluency Data Help?

### Switchboard NXT Disfluency Annotations

Switchboard (300+ hours of adult telephone conversations) has the most extensive disfluency annotations in English:
- **Disfluency types:** Filled pauses (uh, um), partial words (w- well), repetitions, revisions, restarts
- **Format:** Treebank-style annotations with reparandum/interregnum/repair structure
- **Corrected re-annotations** available (Zayats et al., GitHub)

### Can Mixing Switchboard Help?

**Pros:**
- Provides the disfluency-preserving training signal that MyST lacks
- Extensive, well-studied annotations
- Would teach the model to output disfluent tokens rather than suppress them

**Cons:**
- Adult speech acoustics differ from children's (fundamental frequency, formant frequencies, speaking rate)
- Conversational telephone speech differs from read-aloud speech
- Switchboard's disfluencies (topic changes, conversational hedging) differ from reading disfluencies (decoding struggles, word-level hesitations)

**Verdict:** Useful as a supplement but not ideal as the primary disfluency source. The acoustic mismatch means the model may learn to preserve disfluencies only when the acoustic characteristics match adult telephone speech. A smaller dataset of children's disfluent read-aloud speech would be more effective per hour of training data.

**Practical mixing strategy:**
- 70% MyST (children's acoustic adaptation)
- 20% Switchboard disfluent segments (disfluency pattern preservation)
- 10% FluencyBank/SEP-28k (stuttering-specific patterns)

---

## 7. The Hybrid Approach: Acoustic Adaptation Then Disfluency Restoration

### Two-Stage Fine-Tuning Strategy

**Stage 1: Acoustic Adaptation on MyST**
- LoRA rank 4 (conservative)
- 1 epoch on MyST train split
- Goal: Adapt encoder features to children's vocal tract characteristics (higher F0, shorter vocal tract, different formant ratios)
- Expected outcome: Better phoneme recognition for children's speech, possible disfluency degradation

**Stage 2: Disfluency Restoration**
- Continue training (same LoRA adapter) on a disfluent dataset
- Smaller learning rate (1e-5 vs 1e-4 in Stage 1)
- Goal: Restore the model's ability to output partial words, repetitions, filled pauses
- Data sources: FluencyBank Timestamped + Switchboard disfluent segments + any available children's disfluent data

### Why This Could Work

The insight from CrisperWhisper's 3-stage training is that models can learn to produce verbatim transcriptions even after initially training on clean data, as long as they subsequently see verbatim targets. The key is that acoustic features for disfluencies (irregular pitch, unusual durations, glottal stops for partial words) are already encoded in the base model's representations. Stage 1 adapts the acoustic front-end; Stage 2 teaches the output head to preserve disfluency tokens.

### Why This Might Not Work

If Stage 1 fundamentally alters the encoder's representation of disfluent audio segments (mapping them to the same latent space as fluent segments), Stage 2 may not have enough information to recover the distinction. This is more likely with higher LoRA ranks and more training.

### Recommended Protocol

1. After Stage 1, measure disfluency recall on a held-out set
2. If recall has degraded, proceed to Stage 2
3. If recall is preserved (LoRA was conservative enough), skip Stage 2
4. After Stage 2, verify both children's WER and disfluency recall

---

## 8. Catastrophic Forgetting of Specific Capabilities

### The Literature Supports This Concern

Catastrophic forgetting is well-studied in the context of losing entire tasks (e.g., losing French after training on German). But the question of losing a **specific sub-capability** (disfluency detection) while the overall task (English ASR) remains functional is a more nuanced form of the same problem.

**EWC for Children's ASR** (Ahadzi et al., Interspeech 2025) directly demonstrates that standard fine-tuning on children's speech causes catastrophic forgetting, and that EWC mitigates it. Their finding of 5.21% WER reduction with EWC vs standard fine-tuning on MyST confirms that the risk is real even for parameter-efficient methods.

**The "LoRA Learns Less and Forgets Less" framework** (TMLR 2024) shows that LoRA trades off learning for preservation. For our specific case:
- We WANT to learn children's acoustic patterns (this helps WER)
- We do NOT want to learn disfluency suppression (this hurts the pipeline)
- These two learning objectives are entangled in the MyST training signal

This entanglement is the core problem. MyST provides a training signal where "recognize children's speech" and "suppress disfluencies" are bundled together in the same labels. LoRA cannot selectively learn one without the other unless the training data is modified.

### Depth-Aware Adaptation (DAMA)

Recent work on depth-aware model adaptation suggests that different layers serve different functions:
- Lower encoder layers: Acoustic features (pitch, formants, spectral characteristics)
- Higher encoder layers: Linguistic features (word boundaries, language model-like patterns)
- Decoder/joint network: Output generation (which tokens to emit)

Disfluency sensitivity likely resides primarily in the higher encoder layers and decoder, while children's acoustic adaptation primarily requires lower encoder layers. **Applying LoRA only to lower encoder layers** could theoretically provide acoustic adaptation while preserving disfluency sensitivity in the untouched upper layers.

---

## 9. Metrics for Measuring Disfluency Preservation

### Beyond WER: A Disfluency-Specific Evaluation Framework

WER alone is insufficient because:
- A model that suppresses "b- b- butterfly" to "butterfly" has LOWER WER against a clean reference but has LOST critical information for the ORF pipeline
- WER against a verbatim reference would capture this, but MyST's references are not verbatim

### Recommended Metrics

| Metric | What It Measures | How to Compute |
|--------|-----------------|----------------|
| **Disfluency Recall** | Of all actual disfluencies in the audio, what fraction does the model output? | Manual annotation of test set disfluencies; check model output for each |
| **Disfluency Precision** | Of all disfluency-like tokens the model outputs, what fraction are real? | Inverse of false disfluency detection rate |
| **Disfluency F1** | Harmonic mean of recall and precision | Standard F1 formula |
| **Per-Type Recall** | Recall broken down by type: partial words, repetitions, filled pauses, false starts | Critical because some types may be suppressed more than others |
| **Insertion Count Delta** | Change in insertion count between base and fine-tuned model on disfluent audio | Increase suggests hallucination; decrease suggests suppression |
| **Pipeline Miscue Delta** | Change in detected miscues (struggles, hesitations, self-corrections) between base and fine-tuned model | End-to-end measure of pipeline impact |
| **WCPM Delta on Disfluent Readers** | Change in WCPM accuracy specifically for struggling readers | The population that matters most |

### Practical Evaluation Protocol

1. **Curate a disfluency test set:** 20-30 recordings of children reading with known disfluencies, manually annotated for:
   - Each partial word (with intended word)
   - Each repetition (with word and count)
   - Each filled pause (with location)
   - Each self-correction (with original and corrected word)

2. **Run base model:** Record all output tokens, especially insertions and partial words

3. **Run fine-tuned model:** Same recordings, same metrics

4. **Compare per-type recall:** If any type drops more than 10% relative, the fine-tuning has caused disfluency suppression

5. **Run full pipeline comparison:** Feed both outputs through the complete ORF pipeline (alignment, cross-validation, diagnostics) and compare the downstream metrics

---

## 10. Post-Hoc Techniques to Restore Disfluency Sensitivity

If fine-tuning has already been performed and disfluency degradation is detected, several recovery options exist:

### 10a. Inference-Only Disfluency Detection (No Model Changes)

The approach from **Romana et al. (2024)** augments any ASR model with disfluency detection without modifying the model:

1. Run the ASR model to get a transcript
2. Apply modified CTC forced alignment to locate **alignment gaps** (segments where audio exists but no transcript was produced)
3. Classify each gap as speech or silence using a fine-tuned Wav2Vec2 classifier (81.6% accuracy, 80.1% F1)
4. Detected speech gaps are flagged as potential disfluencies

This captured 74.13% of initially missed words with an 8.6% false positive rate. **This is directly applicable to the ORF pipeline** as a post-hoc layer that detects disfluencies the fine-tuned Parakeet may have suppressed.

### 10b. LoRA Adapter Weight Interpolation

Since LoRA adapters are additive (base weights + low-rank delta), you can **scale the adapter weights**:

```python
# Reduce adapter influence to preserve more base behavior
alpha_scale = 0.5  # Apply only 50% of the LoRA adaptation
for param in adapter_params:
    param.data *= alpha_scale
```

This trades off some children's speech WER improvement for better disfluency preservation. The optimal scale factor can be found by binary search on the disfluency recall metric.

### 10c. Merge Two LoRA Adapters

Train two separate adapters:
1. **Adapter A:** MyST acoustic adaptation (clean transcripts)
2. **Adapter B:** Disfluency preservation (trained on disfluent data with verbatim transcripts)

At inference time, apply both:
```
output = base_weights + alpha_A * adapter_A + alpha_B * adapter_B
```

This is analogous to the "Mixture of LoRA Experts" approach used for multi-accent ASR, where separate adapters capture different aspects of speech variation.

### 10d. Prompt-Based Disfluency Preservation (For Encoder-Decoder Models)

For models with a decoder (like Whisper), prompting can encourage verbatim transcription. The Interspeech 2025 paper on prompting Whisper for miscue detection showed that "prompting outperformed fine-tuning alone for verbatim transcription."

**Not directly applicable to Parakeet TDT** (which is encoder-only with a transducer head), but relevant if the pipeline ever switches to an encoder-decoder model.

### 10e. The CrisperWhisper Approach: Retokenization + Verbatim Re-Training

If disfluency suppression is severe, the nuclear option is to follow CrisperWhisper's approach:
1. Strip spaces from the tokenizer vocabulary (enables better pause detection)
2. Re-purpose specific tokens for filled pauses ("um", "uh")
3. Fine-tune on verbatim-annotated corpora (AMI, PodcastFillers, etc.)

CrisperWhisper achieved 9.72 WER (vs Whisper's 16.82) with near-perfect filled pause detection. But this is a significant engineering effort and may not be feasible for Parakeet's TDT architecture.

---

## 11. Synthesis: Risk Assessment and Recommended Strategy

### Risk Level: MODERATE-HIGH

The risk of disfluency suppression from MyST fine-tuning is real but manageable with proper mitigation. The risk is highest for:
- **Partial words** (most likely to be cleaned from MyST transcripts)
- **Repetitions** (likely transcribed as single occurrences in MyST)
- **Filled pauses** (likely omitted from MyST transcripts entirely)

The risk is lowest for:
- **Self-corrections** (may be transcribed as the corrected word only, but the attempt is often phonetically distinct enough to survive)
- **General word recognition** (MyST will improve this across the board)

### Recommended Mitigation Stack (Ordered by Priority)

1. **Start with LoRA rank 4** (not 8) to minimize adaptation magnitude
2. **Curate the disfluency test set BEFORE fine-tuning** (20-30 annotated recordings)
3. **Measure baseline disfluency recall** on the test set with the unmodified Parakeet
4. **Fine-tune on MyST** with rank 4, 1 epoch
5. **Immediately measure disfluency recall** on the same test set
6. **If recall degraded >10%:** Proceed with hybrid Stage 2 training on disfluent data (FluencyBank + Switchboard segments)
7. **If recall degraded >25%:** Also apply adapter weight scaling (Section 10b) and consider the inference-only disfluency detection layer (Section 10a)
8. **If recall preserved:** Consider cautiously increasing to rank 8 for better WER

### Minimum Viable Disfluency Safety Check

Before any production deployment of the fine-tuned model, run this check:

1. Take 10 recordings with known disfluencies (partial words, repetitions, self-corrections)
2. Run base Parakeet: record all insertions and partial-word tokens
3. Run fine-tuned Parakeet: record same
4. If the fine-tuned model produces fewer disfluency tokens on 3+ of the 10 recordings, the adapter is suppressing disfluencies
5. Apply mitigation (reduce rank, Stage 2 training, or adapter scaling) before deployment

---

## Sources

### Primary Research Papers

- [Augmenting ASR Models with Disfluency Detection](https://arxiv.org/abs/2409.10177) — Romana et al. 2024, inference-only disfluency detection via modified CTC forced alignment
- [Inclusive ASR for Disfluent Speech](https://arxiv.org/abs/2406.10177) — Cascaded self-supervised learning + data augmentation for stuttered speech
- [LoRA Learns Less and Forgets Less](https://arxiv.org/abs/2405.09673) — Biderman et al., TMLR 2024, the definitive LoRA forgetting tradeoff study
- [How Much is Too Much? LoRA Rank Trade-offs](https://arxiv.org/html/2512.15634v1) — Rank vs knowledge retention analysis
- [CrisperWhisper: Verbatim Speech Transcriptions](https://arxiv.org/abs/2408.16589) — Zusag et al., Interspeech 2024, tokenizer + verbatim fine-tuning for disfluency-preserving ASR
- [Prompting Whisper for Verbatim Transcription and Miscue Detection](https://arxiv.org/abs/2505.23627) — Interspeech 2025, prompt-based approach for reading error detection
- [Acoustically Precise Hesitation Tagging](https://arxiv.org/abs/2506.04076) — 2025, showing precise filled-pause tagging improves WER by 11.3%
- [Continuous Learning for Children's ASR with EWC](https://arxiv.org/abs/2505.20216) — Ahadzi et al., Interspeech 2025, EWC applied to MyST corpus
- [Improving ASR for Children's Reading Assessment with Disfluency-Aware LMs](https://www.researchgate.net/publication/396811753) — Vidal et al., Interspeech 2025
- [OPLoRA: Orthogonal Projection LoRA](https://arxiv.org/abs/2510.13003) — Constraining LoRA to preserve pre-trained weight subspaces

### Disfluency Datasets

- [FluencyBank Timestamped](https://pubs.asha.org/doi/10.1044/2024_JSLHR-24-00070) — 5.3 hrs, adults who stutter, timestamped disfluency labels
- [SEP-28k: Stuttering Event Detection from Podcasts](https://github.com/apple/ml-stuttering-events-dataset) — Apple, 28K clips, 6 disfluency types
- [UCLASS: UCL Archive of Stuttered Speech](https://www.uclass.psychol.ucl.ac.uk/) — 457 recordings, school-age children
- [Switchboard Corrected Re-annotated](https://github.com/vickyzayats/switchboard_corrected_reannotated) — Disfluency annotations for Switchboard
- [MyST Corpus](https://arxiv.org/abs/2309.13347) — 393 hrs children's conversational speech, standard transcription

### Catastrophic Forgetting and Regularization

- [Analyzing and Reducing Catastrophic Forgetting in Parameter Efficient Tuning](https://arxiv.org/abs/2402.18865) — 2024
- [CURLoRA: Stable Continual Fine-Tuning](https://huggingface.co/papers/2408.14572) — 2024
- [Adaptive Rank, Reduced Forgetting (DyRaLoRA)](https://arxiv.org/abs/2412.01004) — 2024
- [Elastic Weight Consolidation for Self-Supervised Learning](https://arxiv.org/abs/2210.16365) — Apple ML Research
