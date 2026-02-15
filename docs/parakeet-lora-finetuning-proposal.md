# Parakeet TDT 0.6B v3 — Fine-Tuning on Children's Speech

**Date:** 2026-02-08 (revised)
**Status:** Proposal — not yet implemented
**Priority:** HIGHEST single-impact improvement for the ORF pipeline
**Estimated effort:** 1-2 weeks (setup + training + evaluation)
**Estimated training time:** 35-83 hours on RTX 4070 SUPER (12GB); 2-4 hours on cloud A100
**Target GPU:** RTX 4070 SUPER (Ada Lovelace, 12GB GDDR6X, ~71 TFLOPS bf16 Tensor)

---

## TL;DR — Key Recommendations

1. **Don't use LoRA — freeze the encoder instead.** Parakeet's decoder is an LSTM, not a transformer, so LoRA doesn't apply cleanly. The proven approach is to freeze the big encoder (608M params) and retrain only the small decoder + joint network (~9M params). Same memory savings, no compatibility headaches, and multiple NeMo users have confirmed this works.

2. **Your GPU can handle it, but it'll be slow.** The original batch size of 32 needs 50+ GB VRAM — way beyond your 12GB. Drop to batch size 2 with gradient accumulation. Training takes 1.5-3.5 days locally. Alternatively, rent a cloud GPU on Vast.ai for $1-5 and finish in a few hours.

3. **MyST is the right dataset, but temper expectations.** It's the biggest free children's speech corpus (~180 usable hours) with published 23-35% WER improvements. But MyST is kids having science conversations; your tool processes kids reading passages aloud. That domain gap means you'll probably see **10-20% improvement on your actual recordings**, not the full 23-35%. Expect ~2-5 WCPM accuracy gain.

4. **The biggest risk is losing disfluency detection.** MyST transcriptions are cleaned up — no "uh"s, false starts, or repetitions. Training on that teaches the model to skip disfluencies, which is exactly what your ORF tool needs to catch. Build a disfluency test set *before* training so you can measure if it gets worse. If it does, fall back to BitFit (bias-only tuning — minimal forgetting).

5. **Test two things before investing days in training.** (a) Verify that NeMo can actually load a fine-tuned Parakeet checkpoint — there's an open bug where adapters silently fail. (b) Start with fp32 precision, not bf16 — there's a report of bf16 producing garbage output with TDT models.

6. **Consider cloud training seriously.** For $1-5 total on Vast.ai (RTX 4090 at $0.28/hr), you avoid VRAM headaches, OOM crashes, and the 3-day wait. The whole training run finishes in 2-4 hours.

---

## 1. Why This Matters

Fine-tuning is consistently identified as the **single highest-impact improvement** for children's speech ASR. Every research team in the 10-agent review independently reached this conclusion.

### Published Evidence

| Study | Model | Before | After | Relative Reduction |
|-------|-------|--------|-------|-------------------|
| Kid-Whisper (Jain et al. 2024) | Whisper-small.en → MyST | 13.93% | 9.11% | **34.6%** |
| Kid-Whisper (Jain et al. 2024) | Whisper-medium.en → MyST | 13.23% | 8.61% | **34.9%** |
| Fan et al. 2024 | Parakeet-RNNT → MyST | 11.1% | 8.5% | **23.4%** |
| Jann et al. 2024 | Various → child data | 39.64% | near-adult | **"gap completely disappears"** |
| ICASSP 2024 | Various → MyST | — | 9.2% | **38% relative** |
| Takahashi et al. 2025 | Parakeet-TDT → dysarthric | 36.3% | 23.7% | **34.7%** |
| GRAPAM 2025 | Group-aware → MyST | — | 9.31% | — |

### Realistic Expectations for the ORF Pipeline

Published numbers are **in-domain** (trained and tested on MyST). Our pipeline has a significant **domain gap**: MyST is conversational science tutoring (grades 3-5); ORF is read-aloud passages (grades 3-8). Expect 60-70% of in-domain benefit to transfer:

| Metric | Optimistic | Conservative |
|--------|-----------|-------------|
| MyST test set WER | ~8.5% | ~9.5% |
| Out-of-domain ORF WER reduction | ~20% relative | ~10% relative |
| WCPM MAE improvement | ~5 words | ~2 words |
| Tiebreaker activation reduction | ~25% | ~15% |

### Impact on the Tiebreaker

Fine-tuning reduces the number of engine disagreements (fewer garbled words → fewer tiebreaker events). This makes:
- The remaining disagreements harder (easy garbage cases go away; what remains is genuinely ambiguous)
- The tiebreaker less critical but still valuable for the remaining hard cases
- The overall system more reliable regardless of tiebreaker behavior

---

## 2. Available Training Data

### MyST (My Science Tutor) — Primary Candidate

- **Size:** ~393 hours total, **~197 hours transcribed, ~133-179 hours usable** after filtering
- **Speakers:** Children grades 3-5 (ages 8-11), conversational speech
- **Content:** Science tutoring dialogues (~50/50 tutor/student speech by duration)
- **Availability:** Free via **myst.cemantix.org** (CC BY-NC-SA 4.0) or LDC (LDC2021S05, paid)
- **Format:** 16kHz mono FLAC audio + text transcriptions (**no resampling needed**)
- **NeMo manifests:** Do not exist — must write custom preprocessing (Kid-Whisper's `create_dataset.py` is closest reference)
- **Pros:** Largest public children's speech corpus, free, well-studied
- **Cons:** Conversational (not read-aloud), grades 3-5 only (not middle school), standard transcription (not verbatim — disfluencies cleaned)

> **NOTE:** The original proposal incorrectly listed MyST as available on OpenSLR. It is NOT on OpenSLR. The free download is at myst.cemantix.org.

### SpeechOcean762 — Evaluation + Supplementary Training

- **Size:** 5,000 utterances (~12.5 hours) from 250 speakers (including children)
- **Content:** Read-aloud with **phoneme-level mispronunciation labels**
- **Availability:** Free (open-source)
- **Pros:** Phoneme-level annotations, includes children, read-aloud format
- **Cons:** Short utterances, small size

### CHSER (Children's Speech Error Recognition)

- **Size:** 200,000 hypothesis-transcription pairs, ages 4-14
- **Content:** Children's speech with error annotations
- **Availability:** Open-source
- **Pros:** Large, includes error annotations, wide age range
- **Cons:** Hypothesis-transcription format (not raw audio + transcript)

### PF-STAR

- **Size:** ~47 hours children's read-aloud English
- **Content:** Read-aloud speech
- **Availability:** Research license
- **Pros:** Read-aloud format (closer to ORF than MyST), substantial size
- **Cons:** May require license negotiation

### CSLU Kids Corpus — Secondary

- **Size:** ~100-150 hours, ~1,100 children K-10
- **Content:** Scripted/prompted speech (single words and short sentences)
- **Availability:** LDC (LDC2007S18) — requires license
- **Pros:** Covers K-10 (includes middle school ages), scripted speech closer to read-aloud
- **Cons:** Not connected passage reading, not free, prompted single-word format

### CMU Kids — Evaluation Only

- **Size:** 9 hours, 76 speakers ages 6-11
- **Content:** Read-aloud sentences
- **Availability:** Free
- **Verdict:** Too small for fine-tuning alone, but useful for evaluation

### Domain Gap: What's Missing

No publicly available corpus covers **middle school students (grades 6-8) reading connected passages aloud with disfluencies**. No large English children's read-aloud corpus with disfluency annotations exists. The closest options:

- MyST: right age range (lower end) but conversational, not read-aloud
- PF-STAR: read-aloud but younger children, may need license
- CSLU Kids: right format (prompted) but not connected passages

**Recommendation:** Start with MyST (proven results). Supplement with SpeechOcean762 for evaluation. Include ~20% adult speech data (LibriSpeech) in training mix to prevent regression. If results are promising, consider collecting a small custom dataset (20-50 hours) of middle school read-aloud to close the domain gap.

### Data Augmentation (No New Data Required)

| Technique | Expected Gain | Effort | Notes |
|-----------|--------------|--------|-------|
| Speed perturbation {0.9, 1.0, 1.1} | ~1-2% WER | Trivial | NeMo built-in |
| Classroom noise augmentation (MUSAN/RIR) | Up to 38% relative | Low | Add realistic noise |
| Pitch shifting ±2 semitones | ~1-3% WER | Trivial | sox/torchaudio |
| Voice conversion (adult→child) | 3-5% WER | Medium | Requires VC model |
| TTS disfluency simulation | High potential | High | LLM generates disfluent text + zero-shot TTS |

---

## 3. Fine-Tuning Approach

### Strategy: Frozen Encoder + Decoder/Joint Fine-Tuning

> **IMPORTANT ARCHITECTURAL NOTE:** Parakeet TDT's decoder is a simple LSTM/embedding-based prediction network, not a transformer. Standard LoRA (rank-decomposition of attention weight matrices) is designed for transformers. NeMo's LoRA support for ASR focuses on LLM decoders (e.g., Canary-Qwen), not LSTM prediction networks.
>
> The more practical and proven approach for Parakeet TDT is **freezing the encoder and fine-tuning the decoder + joint network** (~9M trainable params out of 617M). This achieves LoRA-level parameter efficiency without compatibility concerns.
>
> **Known NeMo issue:** A GitHub issue reports adapters trained on parakeet-tdt-0.6b-v3 fail during inference with "No adapter compatible" warning — unresolved as of 2026-02. Test adapter loading before investing in full training.

### Primary Approach: Frozen Encoder

- **Trainable parameters:** ~9M (decoder + joint network) out of 617M total (~1.5%)
- **Memory profile:** Similar to LoRA — base encoder weights are frozen
- **No catastrophic forgetting on encoder features** — acoustic representations preserved
- **Proven:** Multiple users on NeMo GitHub successfully fine-tuned Parakeet this way
- **Easy rollback:** Swap back the original decoder checkpoint

### Alternative: LoRA (If NeMo Compatibility Is Resolved)

If NeMo adds proper LoRA support for the TDT prediction network, this remains attractive:
- **Parameter efficiency:** ~3-6M adapter params at rank 4
- **Adapter size:** ~10-25 MB
- **Easy rollback:** Remove adapter = original model
- **Start with rank 4** (not 8) to reduce disfluency suppression risk

### Alternative: BitFit (Bias-Only Tuning)

Proven on 600M Conformer models, trains only bias parameters (~0.4% of total):
- Lowest risk of catastrophic forgetting
- Smallest VRAM footprint
- Good fallback if disfluency suppression is severe with decoder fine-tuning

### Hyperparameters (Corrected for RTX 4070 SUPER 12GB)

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Trainable modules | Decoder + joint network (encoder frozen) | Only ~9M params; avoids LoRA compatibility issues |
| Learning rate | 1e-4 | Kid-Whisper best configuration |
| **Batch size** | **2** | **12GB VRAM constraint** (was 32 — see VRAM section) |
| **Gradient accumulation** | **16** | Effective batch size = 32 |
| Epochs | 1 (possibly 2) | Avoid overfitting on small corpus |
| Warmup steps | 50 | Linear warmup |
| LR schedule | Linear decay | Standard for NeMo ASR fine-tuning |
| Max audio length | 15-20 seconds | Truncate longer segments |
| Optimizer | AdamW | NeMo default |
| Precision | bf16-mixed (test fp32 fallback) | Native Ada Lovelace support; see bf16 caveat below |
| fused_batch_size | 1 | **Critical** — splits joint network sub-batches for VRAM |
| Gradient checkpointing | Enabled | ~38% activation memory reduction |

### VRAM Reality Check: Why batch_size=32 Is Infeasible

The bottleneck is NOT model weights (~1.2GB bf16) or trainable params — it's the **RNN-T/TDT joint network tensor** (B×T×U×V) during training:

```
Joint tensor per sample = 1 × 150 × 50 × 8192 × 2 bytes (bf16) × 2 (activations + gradients)
                        ≈ 245 MB per sample
```

| Configuration | Estimated VRAM | Fits in 12GB? |
|--------------|---------------|---------------|
| Full fine-tune, batch_size=32 | 50+ GB | No |
| Encoder frozen, batch_size=4 | ~11 GB | Barely (OOM risk on long clips) |
| **Encoder frozen, batch_size=2** | **~7-9 GB** | **Yes** |
| Encoder frozen, batch_size=2, gradient checkpointing | ~5-7 GB | Yes, comfortable |

Real-world confirmation: Users on NeMo GitHub report ~11GB at batch_size=4 with frozen encoder on similar models.

> **bf16 caveat:** NeMo Issue #14140 reports that bf16 precision caused gibberish output during TDT validation decoding on RTX 4090 (Persian, older NeMo version). Start with **fp32** and only switch to bf16 after confirming decoding quality on a small validation set. fp32 doubles VRAM for model weights (~2.4GB → ~4.8GB) but the joint tensor dominates regardless.

### Required VRAM Optimizations

```bash
# Set before training — helps with CUDA memory fragmentation
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
```

- `fused_batch_size=1`: Splits joint network computation into sub-batches (critical)
- Gradient checkpointing: `activation_checkpointing: true`
- Lhotse dynamic batching with bucketing (prevents OOM from variable-length audio)
- `max_duration=15-20s` in data config (truncate long segments)

### NeMo Training Configuration

```yaml
# parakeet-tdt-myst-finetune.yaml
trainer:
  precision: bf16
  accumulate_grad_batches: 16
  max_epochs: 1
  accelerator: gpu
  devices: 1

model:
  # Freeze encoder — only train decoder + joint network
  encoder:
    freeze: true

  train_ds:
    manifest_filepath: /data/myst/train_manifest.json
    sample_rate: 16000
    batch_size: 2
    max_duration: 15.0
    # Consider Lhotse dynamic batching:
    # use_lhotse: true
    # batch_duration: 600
    # use_bucketing: true
    # num_buckets: 30

  validation_ds:
    manifest_filepath: /data/myst/dev_manifest.json
    sample_rate: 16000
    batch_size: 2
    max_duration: 15.0

  optim:
    name: adamw
    lr: 1.0e-4
    weight_decay: 0.01
    sched:
      name: LinearWarmup
      warmup_steps: 50

  # Critical for 12GB VRAM
  joint:
    fused_batch_size: 1

# Initialize from pretrained
init_from_pretrained_model: nvidia/parakeet-tdt-0.6b-v3
```

> **Note on model initialization:** NeMo temporarily holds two copies of the model when loading from `+init_from_pretrained_model` (~2.4GB). This fits in 12GB but be aware of the spike.

### Data Preparation: MyST Manifest

NeMo requires a JSON-lines manifest file. Each line:
```json
{"audio_filepath": "/data/myst/audio/session_001_turn_042.flac", "text": "the water evaporated from the cup", "duration": 3.2}
```

MyST data preparation steps:
1. Download from **myst.cemantix.org** (free, CC BY-NC-SA 4.0)
2. Audio is already 16kHz mono FLAC — **no conversion needed**
3. Filter to student-only utterances (exclude tutor speech, ~50% of data)
4. Split into train/dev/test (80/10/10)
5. Generate NeMo manifest files (reference: Kid-Whisper's `create_dataset.py`)
6. Filter out segments longer than 15-20 seconds
7. Optionally filter out very short segments (<0.5s)
8. Expected usable data: ~133-179 hours after filtering

---

## 4. Evaluation Plan

### Metrics

| Metric | Target | Measured On |
|--------|--------|-------------|
| WER on MyST test set | <9.5% (match published results) | Held-out MyST data |
| WER on in-pipeline recordings | ≥10% relative improvement over base | Recorded student sessions |
| Tiebreaker activation rate | ≥15% reduction from baseline | Side-by-side comparison |
| Disfluency preservation | No degradation | Dedicated disfluency test set |
| Adult speech WER | No degradation | LibriSpeech test-clean |
| WCPM accuracy | ≥2 WCPM closer to human scoring | In-pipeline test set |

### Evaluation Protocol

1. **Before fine-tuning:** Record baseline WER on MyST test, SpeechOcean762, and 20+ in-pipeline recordings
2. **After fine-tuning:** Measure all metrics above
3. **A/B comparison:** Run the full ORF pipeline with base model vs fine-tuned model on the same recordings. Compare:
   - Number of engine disagreements (should decrease)
   - Tiebreaker activations (should decrease)
   - WCPM accuracy vs human scoring (should improve)
4. **Regression testing:** Verify adult speech WER is not degraded
5. **Disfluency regression testing:** Dedicated test set of recordings with known disfluencies

### Critical Risk: Disfluency Suppression

MyST transcriptions are **standard (not verbatim)** — disfluencies are cleaned from the reference transcripts. Fine-tuning on these labels could reinforce Parakeet's existing fluency bias, making it WORSE at preserving disfluencies.

**Evidence of risk:** Research shows Whisper transcribes only 56% of disfluent words correctly. Standard-transcript fine-tuning reinforces this bias. LoRA / partial fine-tuning reduces but does not eliminate the risk.

**Mitigation strategy (ordered by priority):**

1. **Build disfluency test set FIRST** (before any training) — 20-30 recordings from existing pipeline with known disfluencies, manually verified
2. **Start with frozen encoder** (decoder-only fine-tuning limits adaptation magnitude)
3. **Consider EWC regularization** — Elastic Weight Consolidation is proven for children's ASR on MyST (5.21% additional WER reduction while preserving base capabilities)
4. **Include ~20% adult/general data** in training mix (LibriSpeech subset) to anchor base capabilities
5. **If disfluency degrades:** Fall back to BitFit (bias-only, 0.4% of params — even less forgetting risk)
6. **Two-stage approach if needed:** Stage 1 = MyST acoustic adaptation; Stage 2 = small disfluent dataset restoration (using pipeline recordings)
7. **Known disfluency corpora for evaluation:** FluencyBank (stuttering), SEP-28k (speech errors), UCLASS (stuttered speech) — all small but useful for targeted testing

---

## 5. Deployment

### Model Loading in Production

The fine-tuned decoder loads alongside the base encoder at inference time:

```python
# In server.py get_parakeet_model()
def get_parakeet_model():
    global _parakeet_model
    if _parakeet_model is None:
        import nemo.collections.asr as nemo_asr
        print("[parakeet] Loading model nvidia/parakeet-tdt-0.6b-v3...")

        use_finetuned = os.environ.get("ORF_PARAKEET_FINETUNED", "true").lower() == "true"
        finetuned_path = "/models/parakeet-tdt-0.6b-v3-myst/model.nemo"

        if use_finetuned and os.path.exists(finetuned_path):
            print("[parakeet] Loading fine-tuned model (MyST children's speech)...")
            _parakeet_model = nemo_asr.models.ASRModel.restore_from(finetuned_path)
            print("[parakeet] Fine-tuned model loaded")
        else:
            _parakeet_model = nemo_asr.models.ASRModel.from_pretrained("nvidia/parakeet-tdt-0.6b-v3")
            print("[parakeet] Base model loaded (no fine-tuning)")

        print("[parakeet] Model loaded successfully")
    return _parakeet_model
```

### VRAM Impact

Fine-tuned model has identical size to base model (~2.4 GB). No change to deployment requirements.

### Inference Latency Impact

Zero — the model architecture is unchanged. The decoder weights are simply different values, not additional computation. Given Parakeet's RTFx of 3,332, performance remains vastly faster than real-time.

### Toggle / Rollback

```python
# Environment variable
ORF_PARAKEET_FINETUNED=true   # Use fine-tuned model
ORF_PARAKEET_FINETUNED=false  # Use base model
```

This allows instant rollback if the fine-tuned model causes regression in production.

---

## 6. Additional Corpora and Future Directions

### Data Augmentation (Apply to MyST Before Training)

1. **Speed perturbation {0.9, 1.0, 1.1}:** Standard 3x data multiplication. NeMo built-in. Trivial effort.
2. **Classroom noise augmentation (MUSAN/RIR):** Up to 38% relative WER reduction for in-classroom recordings. Low effort.
3. **Pitch shifting ±2 semitones:** Simulates wider age/voice range. ~1-3% WER gain. Trivial.
4. **Mixed adult/child training data:** Include ~20% LibriSpeech to prevent adult WER regression.

### Custom Middle School Read-Aloud Dataset

If MyST fine-tuning proves valuable but leaves a domain gap for middle school read-aloud:

1. **Record 20-50 hours** of middle school students (grades 6-8) reading ORF passages aloud
2. **Human-transcribe verbatim** (including all disfluencies, partial words, repetitions)
3. **Annotate miscues** (substitutions, omissions, self-corrections)
4. **Fine-tune on this data** — closes the specific domain gap

Cost: ~$1,200-3,000 for transcription (at ~$1/minute for 20-50 hours). This would be the most impactful single improvement for the target population.

### Other Corpora to Monitor

- **CommonVoice Kids:** Growing children's speech collection. Free, quality varies.
- **Libri-Light Filtered:** Select segments matching children's pitch (F0 > 200 Hz) for pseudo-labeling. Experimental.
- **L2-ARCTIC:** Phone-level substitution/deletion annotations. Useful for mispronunciation detection research.

---

## 7. Timeline

| Phase | Duration | Description |
|-------|----------|-------------|
| **Adapter compatibility test** | 2-4 hours | Verify NeMo fine-tuned model loading works (known bug) |
| **Setup** | 1-2 days | Download MyST from myst.cemantix.org, write manifest preprocessing, configure NeMo |
| **Disfluency baseline** | 1 day | Build disfluency test set from existing pipeline recordings |
| **Baseline measurement** | 1 day | Record WER on MyST test, SpeechOcean762, in-pipeline recordings |
| **Training (local)** | 1.5-3.5 days | RTX 4070 SUPER, batch_size=2, 1 epoch (~35-83 hours) |
| **Training (cloud alt.)** | 2-4 hours | Vast.ai A100 at $0.33/hr or RTX 4090 at $0.28/hr ($1-5 total) |
| **Evaluation** | 2-3 days | All metrics from Section 4, disfluency regression testing |
| **Integration** | 1 day | Add fine-tuned model loading to server.py, toggle configuration |
| **A/B testing** | 3-5 days | Run both versions on real student recordings, compare results |
| **Total** | ~1.5-2.5 weeks | |

### Cloud GPU Option

Given the tight 12GB VRAM constraints and 35-83 hour local training time, cloud training is worth considering:

| Provider | GPU | $/hr | Estimated Total |
|----------|-----|------|----------------|
| Vast.ai | RTX 4090 (24GB) | $0.28 | $1-2 |
| Vast.ai | A100 40GB | $0.33 | $1-5 |
| RunPod | A100 80GB | $1-2 | $3-10 |

Cloud allows batch_size=8-32, reducing training to 2-4 hours with much lower OOM risk.

---

## 8. Success Criteria

| Criterion | Threshold | Must/Should |
|-----------|-----------|-------------|
| MyST test WER | <9.5% | MUST |
| No adult speech regression | LibriSpeech WER within +0.5% of base | MUST |
| Disfluency preservation | No measurable degradation vs base | MUST |
| Reduced tiebreaker activations | >15% reduction in disagreement count | SHOULD |
| Improved WCPM accuracy | ≥2 WCPM closer to human scoring on test set | SHOULD |
| Out-of-domain ORF WER | ≥10% relative improvement | SHOULD |

---

## 9. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| NeMo adapter loading bug blocks deployment | Medium | High | Test adapter/model loading in Phase 1 before any training |
| Disfluency suppression from clean MyST labels | High | High | Disfluency test set first; fallback to BitFit; EWC regularization |
| OOM on RTX 4070 SUPER during training | Medium | Medium | fused_batch_size=1, gradient checkpointing, max_duration=15s; cloud fallback |
| Domain gap limits ORF improvement | High | Medium | Expected; augmentation + future custom dataset |
| MyST tutor/student separation errors | Low | Low | Manual spot-check during preprocessing |
| Training instability at bf16 | Low | Low | Ada Lovelace native bf16; fallback to fp32 |

---

## 10. Recommended Action Plan

### Phase 0 — Smoke Tests (half a day, do this first)
Before investing any real time, confirm two things:

1. **Test model loading roundtrip.** Fine-tune Parakeet on a tiny dataset (10 utterances, 1 step), save the checkpoint, reload it, and run inference. If the known adapter bug (NeMo Issue #14848) blocks loading, stop and investigate before going further.
2. **Test precision.** Run that same tiny fine-tune in both fp32 and bf16. Decode a few samples with each. If bf16 produces garbage (as reported in NeMo Issue #14140), stick with fp32 for the real run.

If either test fails, you've lost half a day instead of a week. If both pass, proceed with confidence.

### Phase 1 — Data Preparation (1-2 days)
3. **Download MyST** from myst.cemantix.org (free, CC BY-NC-SA 4.0). Audio is already 16kHz mono FLAC — no conversion needed.
4. **Write NeMo manifest preprocessing.** Filter to student-only utterances (exclude tutor), remove segments >15s and <0.5s, split into train/dev/test using the official speaker-disjoint splits. Reference: Kid-Whisper's `create_dataset.py`.
5. **Build a disfluency test set.** Pick 20-30 recordings from your existing pipeline where you know students stumbled, repeated words, or self-corrected. This is your canary in the coal mine — if fine-tuning hurts disfluency detection, you'll see it here first.

### Phase 2 — Baseline Measurement (1 day)
6. **Record all baselines** with the unmodified Parakeet model: WER on MyST test set, disfluency recall on your test set, WCPM accuracy on 20+ in-pipeline recordings. You need these numbers to know if fine-tuning actually helped.

### Phase 3 — Training (local: 1.5-3.5 days; cloud: 2-4 hours)
7. **Train with frozen encoder.** Freeze the encoder (608M params), train only the decoder + joint network (~9M params). Use batch_size=2 with gradient accumulation 16 (effective batch 32), fused_batch_size=1, max_duration=15s, 1 epoch. Start with fp32 unless Phase 0 confirmed bf16 is safe.
8. **Strongly consider cloud training.** Vast.ai RTX 4090 at $0.28/hr or A100 at $0.33/hr. Total cost $1-5. Avoids OOM headaches, finishes in hours not days, and lets you use a comfortable batch size of 8-16.

### Phase 4 — Evaluation (2-3 days)
9. **Measure everything against baselines.** MyST test WER, disfluency recall, WCPM accuracy, tiebreaker activation rate, adult speech regression (LibriSpeech test-clean).
10. **If disfluency detection got worse:** Fall back to BitFit (bias-only tuning, 0.4% of params). Or try EWC regularization. Or mix in ~20% LibriSpeech to anchor base capabilities.
11. **If disfluency detection is fine but WER improvement is modest:** Add speed perturbation {0.9, 1.0, 1.1} and classroom noise augmentation to the training data and retrain.

### Phase 5 — Integration (1 day)
12. **Add fine-tuned model loading** to server.py with an environment variable toggle (`ORF_PARAKEET_FINETUNED=true/false`) so you can switch between base and fine-tuned models instantly.

### Phase 6 — A/B Testing (3-5 days)
13. **Run both models** on real student recordings side-by-side. Compare engine disagreement counts, tiebreaker activations, and WCPM accuracy vs human scoring. This is the real test.

---

## Sources

- [Kid-Whisper (Jain et al. 2024)](https://arxiv.org/abs/2309.07927)
- [Benchmarking Children's ASR (Fan et al. 2024)](https://arxiv.org/abs/2406.10507)
- [Fine-tuning Parakeet-TDT for Dysarthric Speech (Takahashi et al. 2025)](https://www.isca-archive.org/interspeech_2025/takahashi25_interspeech.pdf)
- [ASR Tuned for Child Speech in the Classroom (ICASSP 2024)](https://www.colorado.edu/research/ai-institute/sites/default/files/attached-files/childasr_icassp24_camera-ready_0.pdf)
- [Finetuning ASR Models for Child Voices (The Learning Agency)](https://the-learning-agency.com/guides-resources/finetuning-asr-models-for-child-voices/)
- [Group-Aware Partial Model Merging (GRAPAM 2025)](https://arxiv.org/html/2511.23098)
- [MyST Corpus — Free Download](https://myst.cemantix.org)
- [MyST Corpus (LDC2021S05)](https://catalog.ldc.upenn.edu/LDC2021S05)
- [CSLU Kids Corpus (LDC2007S18)](https://catalog.ldc.upenn.edu/LDC2007S18)
- [SpeechOcean762](https://www.openslr.org/101/)
- [Parakeet TDT 0.6B v3 Model Card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
- [NeMo ASR Fine-Tuning Documentation](https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/asr/asr_all.html)
- [Canary/Parakeet v3 Technical Report (arXiv 2509.14128)](https://arxiv.org/html/2509.14128v1)
- [NeMo Issue #15037: OOM during Parakeet-TDT fine-tuning](https://github.com/NVIDIA-NeMo/NeMo/issues/15037)
- [NeMo Issue #13825: Parakeet fine-tuning on P100 16GB](https://github.com/NVIDIA-NeMo/NeMo/issues/13825)
- [HuggingFace: Parakeet TDT fine-tuning discussion](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2/discussions/45)
- [Vast.ai Cloud GPU Marketplace](https://vast.ai/)
