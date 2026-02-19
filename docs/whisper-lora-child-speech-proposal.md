# Whisper LoRA Fine-Tuning for Child Speech: Implementation Proposal

**Date:** 2026-02-17
**Status:** Proposal
**Replaces:** `parakeet-lora-finetuning-proposal.md` (Parakeet LoRA path is not viable — see rationale below)

---

## Why Whisper Instead of Parakeet

The original prompt proposed LoRA fine-tuning of NVIDIA Parakeet RNN-T 0.6B. Research revealed three fatal blockers:

1. **NeMo does not support LoRA for ASR models.** LoRA/PEFT in NeMo is LLM-only (Megatron Bridge path). ASR models only get LinearAdapter, which is architecturally different.
2. **Even LinearAdapter is broken for Parakeet.** [GitHub Issue #14848](https://github.com/NVIDIA-NeMo/NeMo/issues/14848) — adapters trained on `parakeet-tdt-0.6b-v3` fail during inference. Unresolved as of Feb 2026.
3. **12GB VRAM is insufficient for Parakeet full fine-tuning.** V100 16GB OOMs at batch_size > 2. The 0.6B model needs ~7.2GB before activations.

**Whisper solves all three:**
- HuggingFace PEFT has battle-tested LoRA support for all Whisper variants
- Whisper Large-v2 LoRA trains in <8GB VRAM with INT8 quantization
- Proven on child speech: Kid-Whisper, S2-LoRA, CBA-Whisper all published results

---

## What Is Kid-Whisper (And Can You Use It?)

**Kid-Whisper** is a family of Whisper models fine-tuned on MyST child speech data by Ahmed Adel Attia et al. ([arXiv:2309.07927](https://arxiv.org/abs/2309.07927), AAAI/ACM AIES 2024).

### Available Models on HuggingFace (6 variants)

| Model | Base | Training Data | MyST WER | CSLU Scripted | LibriSpeech | License |
|-------|------|---------------|----------|---------------|-------------|---------|
| [kid-whisper-small-myst](https://huggingface.co/aadel4/kid-whisper-small-myst) | whisper-small | MyST | 11.80% | — | 6.23% | Apache 2.0 |
| [kid-whisper-small-en-myst](https://huggingface.co/aadel4/kid-whisper-small-en-myst) | whisper-small.en | MyST | 9.11% | 33.85% | 4.18% | Apache 2.0 |
| [kid-whisper-small-myst_cslu](https://huggingface.co/aadel4/kid-whisper-small-myst_cslu) | whisper-small | MyST+CSLU | — | — | — | Apache 2.0 |
| [kid-whisper-small-en-myst_cslu](https://huggingface.co/aadel4/kid-whisper-small-en-myst_cslu) | whisper-small.en | MyST+CSLU | 9.21% | 2.59% | 4.74% | Apache 2.0 |
| [kid-whisper-medium-en-myst](https://huggingface.co/aadel4/kid-whisper-medium-en-myst_cslu) | whisper-medium.en | MyST | 8.91% | 47.94% | 3.95% | Apache 2.0 |
| **[kid-whisper-medium-en-myst_cslu](https://huggingface.co/aadel4/kid-whisper-medium-en-myst_cslu_cslu)** | whisper-medium.en | **MyST+CSLU** | **8.85%** | **2.38%** | **3.52%** | Apache 2.0 |

All models under HuggingFace namespace `aadel4/`.

### Key Details
- **Full fine-tune** (not LoRA) — all weights updated
- **Training data:** ~179 hours of MyST after filtering (removed WER>50%, <3 words, >30s clips) + CSLU scripted data for `_cslu` variants
- **Adult speech regression:** Only ~1% WER increase on LibriSpeech (2.76% → 3.52% for medium.en)
- **Generalization:** MyST+CSLU models improved dramatically on CSLU scripted (18.57% → 2.38%). MyST-only models showed CSLU scripted **regression** (18.57% → 47.94%) because MyST is conversational, not read speech.
- **Training:** Converged at ~1K-2.5K steps, A6000 50GB GPU
- **Best all-around:** `kid-whisper-medium-en-myst_cslu` — lowest MyST WER (8.85%), best CSLU scripted (2.38%), minimal LibriSpeech regression (3.52%)

### Licensing Note
Model checkpoints are Apache 2.0, but the training data has restrictions:
- **MyST:** CC BY-NC-SA 4.0 (non-commercial). Commercial use requires a separate license from [Boulder Learning](https://boulderlearning.com/resources/myst-corpus/).
- **CSLU Kids:** Separate licensing through Oregon Health & Science University.
The tension between Apache 2.0 model weights and non-commercial training data is a grey area — evaluate with legal counsel if commercial use is intended.

### Can You Use It?

**Yes — and you should consider it as your starting point.** Options:

1. **Use Kid-Whisper directly as cross-validator** (zero training, immediate integration)
2. **Apply LoRA on top of Kid-Whisper** (further domain adaptation for your specific ORF recordings)
3. **Start from base Whisper and train yourself** (maximum control, more work)

**Recommendation: Option 2** — Start from `kid-whisper-medium-en-myst_cslu`, apply LoRA with childrenized LibriSpeech + your own ORF recordings (when available). This gives you:
- Kid-Whisper's child speech improvements as the foundation (8.85% WER on MyST)
- CSLU training data already included (no read-speech regression)
- LoRA's efficiency for domain-specific adaptation
- No risk of catastrophic forgetting (Kid-Whisper already handles child + adult well)

---

## Childrenization vs Speed Perturbation

**They are fundamentally different techniques.** Not interchangeable, and they are complementary (use both).

### Speed Perturbation
- **What it does:** Changes playback speed to 0.9x, 1.0x, 1.1x. Both pitch AND duration change together.
- **Effect:** 3x data multiplication. ~1-2% WER improvement.
- **Limitation:** Does NOT simulate child acoustics — a sped-up adult still sounds like an adult, just faster and slightly higher.
- **Built into:** NeMo, torchaudio, HuggingFace datasets. Trivial to add.

### Childrenization (Formant Warping / VTLP)
- **What it does:** Modifies the *spectral envelope* of adult speech to simulate a child's shorter vocal tract. Shifts formant frequencies upward independently while optionally raising F0 (pitch).
- **Effect:** Makes adult speech acoustically resemble child speech. Up to **5% absolute / 21% relative WER reduction** (Graave et al., Interspeech 2024).
- **Key difference from speed perturbation:** Formants shift independently (not uniformly), preserving linguistic content. Speed perturbation scales everything linearly.
- **NOT built into standard pipelines** — requires custom preprocessing.

### Acoustic Differences: Child vs Adult

| Parameter | Adult Male | Adult Female | Child (age 8) | Child (age 5) |
|-----------|-----------|-------------|---------------|---------------|
| F0 (pitch) | ~125 Hz | ~200 Hz | ~245 Hz | ~257 Hz |
| Vocal tract length | ~17 cm | ~14.5 cm | ~12 cm | ~10.5 cm |
| Formant bandwidth | ~50-200 Hz | ~50-200 Hz | ~190 Hz (B1,B2) | ~300+ Hz |

### Implementation Approaches (Ranked by Practicality)

#### Tier 1: Simple, Proven (Recommended)

**SoX pitch shifting** — Used by Zhang et al. (Interspeech 2024) for child speech augmentation.
```bash
# Raise pitch by 250-370 cents (simulates child voice from adult)
sox input.wav output.wav pitch 300
```
- Shifts pitch + formants together (not independent, but effective)
- Applied to each utterance 2x with different shift values → 2x data multiplication
- **Result:** 3.3% absolute WER reduction when applied to teenager speech

**VTLP via nlpaug** — Vocal Tract Length Perturbation, frequency-domain warping.
```python
import nlpaug.augmenter.audio as naa
aug = naa.VtlpAug(sampling_rate=16000, factor=(0.8, 0.95))  # compress → child-like
augmented = aug.augment(audio_data)
```
- Factor < 1.0 compresses spectral envelope → simulates shorter vocal tract
- Factor range [0.8, 0.95] for adult→child conversion
- Built-in Python library, no custom code needed

#### Tier 2: Higher Quality, More Complex

**PyWorld vocoder** — Independent F0 and formant manipulation.
```python
import pyworld as pw
f0, t = pw.dio(x, fs)
f0 = pw.stonemask(x, f0, t, fs)
sp = pw.cheaptrick(x, f0, t, fs)
ap = pw.d4c(x, f0, t, fs)

# Raise pitch (F0) by factor of 1.8 (adult male → child)
f0_child = f0 * 1.8

# Compress spectral envelope (simulate shorter vocal tract)
# Interpolate sp to shift formants upward by ~20%
import numpy as np
freq_axis = np.arange(sp.shape[1])
new_axis = freq_axis * 0.8  # compress by 20%
sp_child = np.array([np.interp(freq_axis, new_axis, row) for row in sp])

y = pw.synthesize(f0_child, sp_child, ap, fs)
```
- Independent control over pitch and formants
- Highest quality but requires more engineering

#### Tier 3: Research-Grade

**ChildAugment (LPC-SWP)** — Per-formant warping via LPC coefficient manipulation.
- Warping factors: α₁ ∈ [0.6, 0.85], α₂ ∈ [0.7, 0.85], α₃ ∈ [0.75, 0.95], α₄ ∈ [0.85, 1.0]
- Optimal augmentation ratio: 1:3 (original:augmented)
- GitHub: [vpspeech/ChildAugment](https://github.com/vpspeech/ChildAugment)
- Tied to SpeechBrain/ECAPA-TDNN framework — significant adaptation needed for HuggingFace pipeline

### Recommendation

**Use Tier 1 (SoX + VTLP) for the initial training run.** These are proven, easy to implement, and provide most of the benefit. Add speed perturbation on top (they're complementary). Research confirms combining augmentation methods yields the highest gains — SpecAugment + speed perturbation + voice conversion together achieved **7.44% WER reduction** (vs 5.58% for voice conversion alone).

---

## Training Strategy

### Base Model Selection

| Model | Params | VRAM (LoRA INT8) | WER (adult) | WER (child, zero-shot) | Recommendation |
|-------|--------|------------------|-------------|----------------------|----------------|
| whisper-small.en | 244M | ~3 GB | ~5% | ~14% | Too small |
| kid-whisper-medium.en | 769M | ~5-6 GB | ~3.5% | ~9% | **Best starting point** |
| whisper-large-v3 | 1.55B | ~7-8 GB | ~3% | ~13% | Fits, but no child advantage |
| CrisperWhisper | 1.55B | ~7-8 GB | ~3% | Unknown | Verbatim-focused, but CC-BY-NC |

**Primary recommendation: `aadel4/kid-whisper-medium-en-myst_cslu_cslu`**
- Already adapted to child speech (8.85% WER on MyST vs 13.23% base)
- Trained on CSLU scripted data too — no read-speech regression (2.38% vs 47.94% for MyST-only)
- 769M params — comfortable on 12GB with INT8 LoRA
- English-only model (.en) — better for monolingual ORF
- Apache 2.0 license (model weights; training data is CC BY-NC-SA)
- Only ~0.8% regression on adult speech (2.76% → 3.52%)

### LoRA Configuration

Based on the HuggingFace PEFT reference implementation and S2-LoRA child speech paper:

```python
from peft import LoraConfig

lora_config = LoraConfig(
    r=32,                              # Rank (32 is standard for Whisper)
    lora_alpha=64,                     # Alpha = 2x rank
    target_modules=["q_proj", "v_proj"],  # Attention projections
    lora_dropout=0.05,
    bias="none",
)
# Result: ~1% of params trainable (~7.7M of 769M)
# Checkpoint size: ~30 MB (adapter only)
```

**Why `q_proj` and `v_proj` only:**
- S2-LoRA research found `W_q` and `W_k` allocated near-zero rank — `W_v` and `W_o` are most important
- Standard Whisper LoRA convention targets `q_proj` + `v_proj`
- Adding more modules increases VRAM without proportional benefit

### Training Arguments

```python
from transformers import Seq2SeqTrainingArguments

training_args = Seq2SeqTrainingArguments(
    output_dir="./whisper-child-lora",
    per_device_train_batch_size=8,     # Fits on 12GB with INT8
    gradient_accumulation_steps=4,     # Effective batch = 32
    learning_rate=1e-3,                # Higher LR for LoRA (standard)
    warmup_steps=500,
    num_train_epochs=3,
    eval_strategy="steps",
    eval_steps=500,
    save_steps=500,
    fp16=True,                         # fp16 for training (bf16 also works)
    per_device_eval_batch_size=8,
    generation_max_length=225,
    logging_steps=25,
    load_best_model_at_end=True,
    metric_for_best_model="wer",
    greater_is_better=False,
    dataloader_num_workers=4,
)
```

### VRAM Budget (RTX 4070 Super, 12GB)

| Component | VRAM |
|-----------|------|
| Base model (INT8 quantized, 769M) | ~1.0 GB |
| LoRA adapter weights + optimizer | ~0.2 GB |
| Activations (batch=8, 30s audio) | ~3-4 GB |
| PyTorch/CUDA overhead | ~1.5 GB |
| **Total estimated** | **~6-7 GB** |
| **Headroom** | **~5 GB** |

This is comfortable. No cloud GPU needed for training.

---

## Data Pipeline

### Stage 1: MyST Preprocessing (~133-179 usable hours)

**Download:** [myst.cemantix.org](https://myst.cemantix.org) (free, CC BY-NC-SA 4.0)

**Format:** FLAC audio (16kHz mono) + plain text `.trn` files (NOT XML/TextGrid)

**Preprocessing steps** (following Kid-Whisper's proven filtering):
1. Load all `<partition>/<student_id>/<session_id>.flac` + `.trn` pairs
2. Filter out: files with no transcription, tutor utterances (keep student-only)
3. Remove utterances < 3 words (too short for meaningful training)
4. Remove utterances > 30 seconds (Whisper's context window limit)
5. Normalize text: lowercase, expand contractions, spell out digits
6. Split: 80% train / 10% dev / 10% test
7. Generate HuggingFace Dataset format (audio + text columns)

**Reference implementation:** [Kid-Whisper's preprocessing](https://github.com/Kaldi_myST) and ESPnet's `egs2/myst/asr1/`

**Expected yield:** ~125-150 hours after filtering (matching Kid-Whisper's 125h)

### Stage 2: Childrenized LibriSpeech (~100 hours → ~200-300 hours augmented)

**Download:** [OpenSLR train-clean-100](https://www.openslr.org/12/) (free)

**Childrenization pipeline:**

```python
# For each LibriSpeech utterance, generate 2 childrenized variants:

import nlpaug.augmenter.audio as naa
import subprocess

def childrenize_vtlp(audio, sr=16000):
    """VTLP: compress spectral envelope to simulate shorter vocal tract"""
    aug = naa.VtlpAug(sampling_rate=sr, factor=(0.80, 0.92))
    return aug.augment(audio)

def childrenize_pitch(input_path, output_path):
    """SoX: raise pitch 250-370 cents"""
    import random
    cents = random.randint(250, 370)
    subprocess.run(['sox', input_path, output_path, 'pitch', str(cents)])
```

**Process:**
1. Apply VTLP variant → childrenized_v1 (formant compression)
2. Apply SoX pitch shift → childrenized_v2 (pitch raising)
3. Keep originals as adult regularization data (~20% of final mix)

**Final dataset composition:**

| Source | Hours | Purpose |
|--------|-------|---------|
| MyST (child conversational) | ~125h | Primary child speech signal |
| Childrenized LibriSpeech (VTLP) | ~100h | Pseudo-child read-aloud |
| Childrenized LibriSpeech (pitch) | ~100h | Pseudo-child read-aloud (different acoustic profile) |
| Original LibriSpeech | ~25h | Adult speech regularization |
| **Total** | **~350h** | |

### Stage 3: Speed Perturbation (Online, During Training)

Applied on-the-fly during training (not pre-generated):
- Rates: {0.9, 1.0, 1.1}
- Effectively 3x data multiplication
- Standard ASR augmentation, complementary to childrenization

### Stage 4: SpecAugment (Online, During Training)

Whisper's default augmentation — frequency masking + time masking on mel spectrograms. Already built into the HuggingFace training pipeline.

---

## Training Time Estimates

### Local (RTX 4070 Super)

Based on scaling from the HuggingFace PEFT reference (12h data → 3.5h on T4, RTX 4070 Super is ~2x faster than T4):

| Dataset | Steps/Epoch (eff. batch 16) | Total Steps (3 epochs) | Estimated Time |
|---------|-------------|----------------------|----------------|
| ~350h total | ~1,500 | ~4,500 | **80-100 hours** |

This is a significant time commitment. Training can be interrupted and resumed. Consider:
- **1 epoch only** (~25-35 hours) — often sufficient for domain adaptation with LoRA
- **10% subset first** (~8-10 hours) — validates the pipeline before full run
- **Cloud GPU** — dramatically faster (see below)

**Note:** Batch size on 12GB with Kid-Whisper-medium (769M) INT8: expect `per_device_train_batch_size=4` with `gradient_accumulation_steps=4` (effective batch 16). With NF4 quantization, batch_size=8 may fit.

### Cloud (Vast.ai A100, ~$0.33/hr)

| Approach | Time | Cost |
|----------|------|------|
| A100 40GB, batch_size=32 | ~8-12 hours | **$3-4** |
| RTX 4090, batch_size=16 | ~15-25 hours | **$5-8** |

**Recommendation:** Train locally first with a 10% subset to validate the pipeline. Then run the full training on a rented A100 overnight for ~$4, or locally over a weekend.

---

## Integration into PACER Pipeline

### Option A: Replace Parakeet as Cross-Validator

Fine-tuned Whisper replaces Parakeet in the 3-engine consensus:
- **Reverb V1** (verbatim) — primary engine
- **Reverb V0** (clean) — disfluency detection only (already demoted from voting)
- **Whisper-Child** (fine-tuned) — cross-validator, timestamps, second opinion

**Pros:** Better child speech recognition, maintains verbatim output
**Cons:** Whisper is ~2800x slower than Parakeet (3.3s vs 0.02s per minute of audio). For 60-second ORF passages this means ~3-4 seconds vs near-instant.

### Option B: Add as 4th Engine Alongside Parakeet

Keep Parakeet for speed, add Whisper-Child for accuracy when engines disagree:
- Run Parakeet + Whisper-Child in parallel
- Use Whisper-Child's verdict when Parakeet and Reverb disagree
- Parakeet provides fast timestamps; Whisper-Child provides accurate word verification

**Pros:** Best of both worlds — speed + accuracy
**Cons:** More VRAM, more complexity, longer pipeline

### Option C: Whisper-Child as Offline Validator (Recommended for Phase 1)

Run fine-tuned Whisper only on disputed words / struggling segments:
- Pipeline runs normally (Reverb + Parakeet)
- When 3-way verdict is "disagreed", send that segment to Whisper-Child for tiebreaking
- Minimizes latency impact (only ~5-15% of words need revalidation)

**Implementation:** Add `whisperChild` field to kitchen-sink response. Call Whisper inference only for segments where V1 and Parakeet disagree. Return word-level timestamps + transcription for just those segments.

### Inference Setup

```python
from transformers import WhisperForConditionalGeneration, WhisperProcessor
from peft import PeftModel

# Load base model + LoRA adapter
base_model = WhisperForConditionalGeneration.from_pretrained(
    "aadel4/kid-whisper-medium-en-myst_cslu",
    load_in_8bit=True,
    device_map="auto"
)
model = PeftModel.from_pretrained(base_model, "path/to/lora-adapter")
processor = WhisperProcessor.from_pretrained("openai/whisper-medium.en")

# Inference with timestamps
result = model.generate(
    input_features,
    return_timestamps=True,
    language="en",
    task="transcribe",
)
```

**VRAM for inference:** ~1.5 GB (INT8) — runs alongside Reverb + Parakeet comfortably.

---

## Disfluency Preservation: The Critical Risk

### The Problem

MyST transcriptions are cleaned (no "um", "uh", false starts). Training on cleaned transcripts teaches the model to suppress disfluencies — exactly opposite to PACER's core belief that "disfluencies are signal, not noise."

### Why It's Less Dangerous for Whisper Than Parakeet

1. **Reverb V1 handles disfluency detection, not the cross-validator.** The dual-pass V1(verbatim)/V0(clean) comparison is PACER's disfluency mechanism. The cross-validator's job is word-correctness voting.

2. **Whisper is already biased toward suppressing disfluencies** (base model trained on subtitles). Fine-tuning on MyST doesn't make this meaningfully worse.

3. **LoRA preserves most of the base model's behavior.** Only 1% of parameters change. The encoder's acoustic representations (which capture disfluency evidence) remain largely frozen.

### Mitigation Plan

1. **Build disfluency test set BEFORE training** — 20-30 recordings with known disfluencies (fillers, repetitions, false starts). Score baseline vs fine-tuned model on this set.

2. **Monitor insertion detection** — If Whisper-Child stops hearing insertions that base Whisper hears, the fine-tuning is suppressing evidence. Roll back.

3. **CrisperWhisper as separate disfluency engine** — If verbatim transcription is critical for the cross-validator, CrisperWhisper (which is specifically trained for verbatim output with disfluency markers) could serve that role independently. CrisperWhisper and Whisper-Child solve different problems.

---

## Evaluation Plan

### Metric 1: WER on Children's Speech

| Test Set | Baseline (Kid-Whisper-medium-en-myst_cslu) | Target (After LoRA) |
|----------|---------------------------------------------|---------------------|
| MyST test | 8.85% | ≤8.5% |
| CSLU scripted | ~20% (estimated) | ≤17% |
| Your ORF recordings (10+ samples) | Measure | 10-20% improvement |

### Metric 2: Adult Speech Regression

| Test Set | Baseline | Maximum Acceptable |
|----------|----------|-------------------|
| LibriSpeech test-clean | ~3.52% | ≤4.5% (≤1% regression) |

### Metric 3: Pipeline WCPM Accuracy

| Metric | Current (Parakeet xval) | Target (Whisper-Child xval) |
|--------|------------------------|-----------------------------|
| WCPM accuracy vs human scoring | Measure | 2-5 WCPM improvement |
| Tiebreaker activation rate | Measure | ≥15% reduction |
| Cross-validator agreement rate | Measure | ≥5% improvement |

### Metric 4: Disfluency Preservation

| Metric | Baseline | Threshold |
|--------|----------|-----------|
| Filler detection rate (um/uh) | Measure | No decrease |
| Repetition detection rate | Measure | No decrease |
| False start detection rate | Measure | No decrease |

### Metric 5: Latency Impact

| Scenario | Acceptable Latency |
|----------|-------------------|
| Full pipeline (Option C: disputed words only) | ≤1s additional |
| Full pipeline (Option A: replace Parakeet) | ≤5s total |

---

## Phase Plan

### Phase 0: Smoke Test (0.5 days)
- [ ] Download `kid-whisper-medium-en-myst_cslu` from HuggingFace
- [ ] Run inference on 5 ORF recordings, compare WER to Parakeet
- [ ] Verify word-level timestamps work
- [ ] Measure VRAM usage and inference speed
- **GO/NO-GO:** If Kid-Whisper alone is already better than Parakeet on your recordings, proceed. If not, reconsider.

### Phase 1: Data Preparation (2-3 days)
- [ ] Download MyST from cemantix.org
- [ ] Write manifest generator (FLAC + .trn → HuggingFace Dataset)
- [ ] Apply Kid-Whisper's filtering (WER>50%, <3 words, >30s)
- [ ] Download LibriSpeech train-clean-100
- [ ] Run childrenization pipeline (VTLP + SoX pitch shift)
- [ ] Create combined training dataset with correct mix ratios
- [ ] Build disfluency test set from existing ORF recordings

### Phase 2: Training (1-2 days)
- [ ] Set up HuggingFace training pipeline with PEFT
- [ ] Run validation on 10% subset first (sanity check)
- [ ] Full training run (local overnight or cloud A100 ~$2)
- [ ] Evaluate on all test sets

### Phase 3: Evaluation & Integration (2-3 days)
- [ ] WER evaluation: MyST, CSLU, LibriSpeech, ORF recordings
- [ ] Disfluency preservation check
- [ ] Integrate as cross-validator (Option C: disputed words)
- [ ] A/B compare pipeline accuracy: Parakeet-xval vs Whisper-Child-xval
- [ ] Measure latency impact

### Phase 4: Decision Point
Based on Phase 3 results:
- If ≥3 WCPM improvement with no disfluency regression → **Ship it** (replace Parakeet)
- If 1-3 WCPM improvement → **Use alongside Parakeet** (Option B or C)
- If <1 WCPM or disfluency regression → **Keep Parakeet**, use Kid-Whisper as-is without LoRA

**Total estimated time:** 7-14 days (training is the bottleneck — 1-4 days depending on local vs cloud)
**Total estimated cost:** $0-8 (cloud GPU if needed)

---

## Advanced: Reference-Passage Prompting (Apple/Smith et al.)

The [Apple/Smith et al. Interspeech 2025 paper](https://arxiv.org/abs/2505.23627) demonstrates a technique directly applicable to ORF: **prompting Whisper with the reading passage**.

**How it works:**
- The target reading text is tokenized and prepended to the `<sot>` (start of transcript) marker in the decoder input
- The model sees the reference passage as context before generating the transcription
- Training loss is computed only on the predicted transcription, not the prompt tokens

**Results on child speech (ages 5-9, 124K utterances):**
- WER of ~3.9% with prompted+tuned medium.en
- Miscue detection F1: substitutions 0.541, omissions 0.604, insertions 0.645
- **Prompting + tuning outperformed tuning alone** for verbatim transcription

**Why this matters for PACER:** You already have the reference passage — it's what the child is reading. Feeding it to Whisper as a prompt would dramatically reduce false substitution/omission errors because the model "knows" what's expected. This is an enhancement to explore in Phase 2 after validating basic LoRA works.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Disfluency suppression from clean MyST labels | Medium | High | Disfluency test set built FIRST; LoRA only touches 1% of params |
| Domain mismatch (MyST conversational → ORF read-aloud) | High | Medium | Childrenized LibriSpeech (read-aloud) compensates; expect 10-20% improvement not 30% |
| Whisper hallucination on silence/pauses | Medium | Medium | `condition_on_previous_text=False`; VAD pre-filtering; no_repeat_ngram_size penalty |
| Latency impact on pipeline | Low | Medium | Option C (disputed words only) limits calls to ~5-15% of words |
| Kid-Whisper-medium.en already sufficient (LoRA adds nothing) | Medium | Low | Phase 0 smoke test determines this; worst case you skip LoRA and use Kid-Whisper directly |

---

## Sources

### Papers
- [Kid-Whisper (Attia et al., AAAI/ACM AIES 2024)](https://arxiv.org/abs/2309.07927)
- [S2-LoRA: Sparsely Shared LoRA for Child Speech (2023)](https://arxiv.org/abs/2309.11756)
- [Graave et al.: Mixed Children/Adult/Childrenized Fine-Tuning (Interspeech 2024)](https://www.isca-archive.org/interspeech_2024/graave24_interspeech.html)
- [Zhang et al.: Improving Child Speech with Augmented Child-Like Speech (Interspeech 2024)](https://arxiv.org/abs/2406.10284)
- [ChildAugment: Data Augmentation for Zero-Resource Children's SV (JASA 2024)](https://arxiv.org/abs/2402.15214)
- [Kathania et al.: Formant Modification for Children ASR](https://www.sciencedirect.com/science/article/pii/S0167639321001278)
- [Smith et al.: Prompting Whisper for Miscue Detection (Interspeech 2025)](https://arxiv.org/abs/2505.23627)
- [MyST Corpus (arXiv:2309.13347)](https://arxiv.org/abs/2309.13347)

### Tools & Models
- [HuggingFace PEFT: Whisper INT8 LoRA Training](https://github.com/huggingface/peft/blob/main/examples/int8_training/peft_bnb_whisper_large_v2_training.ipynb)
- [Fast Whisper Finetuning (Vaibhavs10)](https://github.com/Vaibhavs10/fast-whisper-finetuning)
- [Kid-Whisper Models on HuggingFace (aadel4)](https://huggingface.co/aadel4)
- [MyST Corpus (free download)](https://myst.cemantix.org)
- [nlpaug VTLP](https://nlpaug.readthedocs.io/en/stable/augmenter/audio/vtlp.html)
- [PyWorld Vocoder](https://github.com/JeremyCCHsu/Python-Wrapper-for-World-Vocoder)
- [ChildAugment (LPC-SWP)](https://github.com/vpspeech/ChildAugment)

### Technical References
- [NeMo does NOT support LoRA for ASR (PEFT docs)](https://docs.nvidia.com/nemo-framework/user-guide/latest/sft_peft/supported_methods.html)
- [NeMo LinearAdapter broken for Parakeet (Issue #14848)](https://github.com/NVIDIA-NeMo/NeMo/issues/14848)
- [Whisper PEFT Discussion #988](https://github.com/openai/whisper/discussions/988)
- [Parakeet vs Whisper speed benchmarks (Northflank)](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks)
