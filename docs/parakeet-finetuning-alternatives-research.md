# Alternative Fine-Tuning Approaches for Parakeet TDT 0.6B v3

**Date:** 2026-02-08
**Context:** Supplements `parakeet-lora-finetuning-proposal.md` with research on approaches more practical for a consumer GPU (RTX 4070 SUPER, 12 GB VRAM).

---

## Table of Contents

1. [HuggingFace PEFT + Parakeet](#1-huggingface-peft--parakeet)
2. [QLoRA (Quantized LoRA)](#2-qlora-quantized-lora)
3. [Adapter Alternatives (IA3, BitFit, Prefix Tuning)](#3-adapter-alternatives)
4. [Knowledge Distillation](#4-knowledge-distillation)
5. [Prompt Tuning / Soft Prompts for ASR](#5-prompt-tuning--soft-prompts-for-asr)
6. [Fine-Tuning Only the Decoder](#6-fine-tuning-only-the-decoder)
7. [Gradient Checkpointing Specifics](#7-gradient-checkpointing-specifics)
8. [Cloud GPU Alternatives](#8-cloud-gpu-alternatives)
9. [Pre-Built Fine-Tuned Models](#9-pre-built-fine-tuned-models)
10. [ONNX/TensorRT Export with LoRA](#10-onnxtensorrt-export-with-lora)
11. [Recommendation Summary](#11-recommendation-summary)

---

## 1. HuggingFace PEFT + Parakeet

### Current State of HF Transformers Support

Parakeet was added to HuggingFace Transformers (v5.x) on **2025-09-25**. However, there is a critical limitation:

- **Only `ParakeetForCTC` is implemented** in HF Transformers. The classes available are `ParakeetEncoder`, `ParakeetForCTC`, `ParakeetProcessor`, `ParakeetTokenizer`, and `ParakeetFeatureExtractor`.
- **No `ParakeetForTDT` class exists** in HF Transformers. The TDT decoder (Token-and-Duration Transducer) is architecturally different from CTC and requires a joint network + prediction network + duration head, none of which are implemented in the HF `transformers` library.
- The HF Transformers Parakeet implementation only supports CTC-based models like `nvidia/parakeet-ctc-0.6b` and `nvidia/parakeet-ctc-1.1b`.

### What This Means for PEFT/LoRA

If you used `ParakeetForCTC` from HF Transformers + HF PEFT:
- You would get the standard HF ecosystem: `Trainer`, `PEFT`, `bitsandbytes` quantization, `accelerate` -- the full toolkit.
- You could apply LoRA with `peft.get_peft_model()` trivially.
- `bitsandbytes` 4-bit/8-bit loading would work out of the box.
- But **you would lose the TDT decoder**, meaning no native duration predictions, no word-level timestamps from the model itself. You would get CTC-quality output, not TDT-quality output.

### Could You Fine-Tune CTC Instead?

The Parakeet CTC and TDT variants share the **same Fast Conformer encoder** (which is where ~95% of the model's 600M parameters live). The difference is only in the decoder head:
- CTC: simple 1D conv projection to vocab size (~1M params)
- TDT: joint network + prediction network + duration predictor (~20-30M params)

**Option:** Fine-tune `ParakeetForCTC` via HF PEFT/LoRA on the encoder, then transfer the adapted encoder weights back to the NeMo TDT model. This is theoretically possible but:
- Requires manual weight surgery (loading HF encoder weights into NeMo FastConformer)
- CTC loss vs TDT loss train slightly different encoder representations
- No one has published results doing this specific transfer

### Verdict

**Not directly viable for TDT.** The HF Transformers integration only covers CTC. You cannot load `parakeet-tdt-0.6b-v3` into `AutoModel` -- the model card explicitly states NeMo is required. HF PEFT cannot be applied to NeMo models. The NeMo-native path remains necessary for TDT fine-tuning.

However, if you are willing to sacrifice TDT's timestamp quality and use CTC instead, the HF PEFT path is fully functional and would give you the memory-efficiency benefits of the HF ecosystem.

---

## 2. QLoRA (Quantized LoRA)

### Does NeMo Support QLoRA / bitsandbytes?

**No.** As of NeMo 25.02 and the current NeMo 2.0 migration:
- NeMo's PEFT implementation (LoRA, IA3, P-Tuning, Adapters) does not integrate with `bitsandbytes` for quantized base model training.
- NeMo's LoRA implementation freezes the base model weights in their original precision (typically bf16 or fp32). There is no NF4 or INT8 quantized training path.
- The NeMo PEFT documentation makes no mention of quantization during training.

### Why This Matters

QLoRA's key innovation is loading the base model in 4-bit NF4 format during training, reducing VRAM by ~75% for the frozen weights while keeping LoRA adapter weights in bf16. For a 600M model:

| Configuration | Base Model VRAM | Optimizer + Gradients | Total Estimate |
|--------------|-----------------|----------------------|----------------|
| bf16 (NeMo default) | ~1.2 GB | ~1.5 GB (LoRA only) | ~4-6 GB + activations |
| NF4 (QLoRA) | ~0.3 GB | ~1.5 GB (LoRA only) | ~3-4 GB + activations |

The savings from QLoRA on a 600M model are modest (~1 GB) because the model is already relatively small. QLoRA's dramatic savings (10-20x) are primarily seen on 7B+ models where the frozen base weights dominate VRAM.

### Could bitsandbytes Be Hacked In?

Theoretically, you could:
1. Load the NeMo model
2. Manually quantize encoder layers using `bitsandbytes.nn.Linear4bit`
3. Apply NeMo's LoRA on top

This would require significant custom code, is unsupported, and risks numerical instability in the Conformer attention/convolution blocks which were not designed for 4-bit operation.

### Verdict

**Not practical.** NeMo does not support QLoRA. The VRAM savings on a 600M model would be marginal anyway (~1 GB). Standard bf16 LoRA with gradient checkpointing is the more practical path within NeMo's ecosystem.

---

## 3. Adapter Alternatives

### IA3 (Infused Adapter by Inhibiting and Amplifying Inner Activations)

**NeMo supports IA3** for its NLP/LLM models. IA3 works by learning three scaling vectors that rescale:
- Key projections in attention
- Value projections in attention
- Feed-forward intermediate activations

Key characteristics:
- **Even fewer parameters than LoRA**: IA3 trains vectors, not matrices. For a 600M model, IA3 might add only ~0.01-0.05% parameters (60K-300K) vs LoRA's 0.1-1% (~600K-6M).
- **No hyperparameters to tune**: Unlike LoRA (rank, alpha), IA3 has no configuration knobs.
- **Lower VRAM than LoRA**: Fewer trainable parameters means smaller optimizer state.

**However**: IA3 support in NeMo is documented only for NLP/LLM models (Megatron GPT, etc.). Whether it works with NeMo's ASR `EncDecCTCModelBPE` or `EncDecRNNTBPEModel` classes is undocumented. The underlying PEFT infrastructure in NeMo may or may not expose ASR model internals to IA3's injection points.

**ASR-specific evidence**: No published results exist for IA3 on ASR models (Conformer, Whisper, or otherwise). IA3 was designed for and validated on language models.

### BitFit (Bias-Only Fine-Tuning)

BitFit is the most parameter-efficient method: it trains **only the bias terms** of the model, which are typically <0.5% of total parameters.

**Strong ASR evidence exists**: A 2024 paper ("Differentially Private PEFT for Large ASR Models", arXiv:2410.01948) tested BitFit on a **600M Conformer encoder** -- the exact same architecture as Parakeet's encoder:
- DP-BitFit trained only **0.4% of parameters**
- Achieved competitive WER (7.8% clean / 10.9% other on LibriSpeech)
- **Outperformed LoRA** on this task under differential privacy constraints
- Important caveat: freezing bias terms in layer normalization is necessary to prevent training divergence

**Implementation**: BitFit does not require framework support -- it is trivially implementable:
```python
# Freeze everything except bias terms
for name, param in model.named_parameters():
    if 'bias' in name and 'layernorm' not in name.lower():
        param.requires_grad = True
    else:
        param.requires_grad = False
```

**VRAM**: Minimal. Only bias gradients and optimizer states are stored. For a 600M model, this is ~2.4M parameters -- negligible memory overhead.

### Prefix Tuning

Prefix tuning prepends learnable "virtual tokens" to the input of each attention layer. NeMo supports this as "P-Tuning" for LLM models.

**Not suitable for ASR**: Prefix tuning assumes a text-like token sequence at the attention input. ASR models process mel-spectrogram features through convolutional subsampling before attention, making the "virtual prefix" concept architecturally awkward. No published work demonstrates prefix tuning for CTC/TDT models.

### Verdict

| Method | ASR Evidence | NeMo Support | Parameter Count | Practical? |
|--------|-------------|--------------|-----------------|------------|
| IA3 | None for ASR | LLM only (undocumented for ASR) | ~0.01-0.05% | Uncertain |
| BitFit | Strong (600M Conformer, 2024) | Manual implementation (trivial) | ~0.4% | **Yes -- best alternative** |
| Prefix Tuning | None for CTC/TDT | LLM only | ~0.1% | No |

**BitFit is the most promising alternative adapter approach.** It has direct evidence on the exact architecture (600M Conformer), requires no framework support, and uses the least VRAM of any method.

---

## 4. Knowledge Distillation

### Concept

Use an existing fine-tuned model (e.g., Kid-Whisper fine-tuned on MyST) as a "teacher" to generate soft labels, then train Parakeet TDT as the "student" to match those soft labels.

### Available Teacher Models

The Kid-Whisper project publishes fine-tuned models on HuggingFace:

| Model | HuggingFace ID | Training Data |
|-------|---------------|---------------|
| Kid-Whisper Small (MyST) | `aadel4/kid-whisper-small-en-myst` | MyST |
| Kid-Whisper Small (MyST+CSLU) | `aadel4/kid-whisper-small-en-myst_cslu` | MyST + CSLU |
| Kid-Whisper Medium (MyST) | `aadel4/kid-whisper-medium-en-myst` | MyST |
| Kid-Whisper Medium (MyST+CSLU) | `aadel4/kid-whisper-medium-en-myst_cslu` | MyST + CSLU |

### Challenges

1. **Architecture mismatch**: Whisper (encoder-decoder with cross-attention) and Parakeet TDT (FastConformer + transducer) have fundamentally different architectures. Distillation would need to be at the output level (text/logits), not at the hidden-state level.

2. **Output space mismatch**: Whisper uses an autoregressive decoder with a text vocabulary; Parakeet TDT uses a transducer with BPE tokens + duration predictions. The logit distributions are not directly comparable.

3. **Practical distillation path**: The only viable approach is "pseudo-labeling":
   - Run Kid-Whisper Medium on MyST audio to generate transcriptions
   - Use these transcriptions as training labels for Parakeet TDT
   - This is really just "training on MyST with slightly different labels" -- not true knowledge distillation

4. **Marginal benefit**: Since MyST already has human transcriptions, pseudo-labels from Kid-Whisper would be strictly worse than the ground truth. The only scenario where this helps is if you lack transcribed data and need to create labels for unlabeled audio.

### Verdict

**Not practical for this use case.** True knowledge distillation requires compatible architectures. Pseudo-labeling with Kid-Whisper offers no advantage over training on MyST's existing human transcriptions. The MyST corpus already has labels; use them directly.

---

## 5. Prompt Tuning / Soft Prompts for ASR

### Applicability to CTC/TDT Models

Soft prompt tuning works by prepending learned continuous vectors to the input of a language model, which then "steers" the model's behavior.

**This is not applicable to CTC or TDT models** for several reasons:

1. **No autoregressive text decoder**: Prompt tuning assumes a model that generates text sequentially, conditioned on a prompt. CTC models produce frame-level posterior distributions; TDT models produce joint token+duration predictions. Neither has a text prompt input.

2. **Input is audio, not text**: The "input" to Parakeet is a mel spectrogram. There is no text input to prepend prompts to.

3. **Transducer prediction network**: The TDT decoder's prediction network does process previous tokens, but it is a small LSTM/embedding network, not a large language model. Prompt tuning's effectiveness depends on the capacity of the prompted model.

4. **No published work**: No papers demonstrate prompt tuning for CTC, RNN-T, or TDT architectures.

### Could "Audio Prompts" Work?

Some researchers have explored prepending learned audio embeddings (analogous to soft prompts but in the acoustic feature space) to condition ASR models. This is an active research area but:
- No implementations exist for NeMo/Parakeet
- Results are preliminary and mostly on Whisper-style models
- Not a production-ready technique

### Verdict

**Not applicable.** Prompt tuning is designed for autoregressive language models, not CTC/TDT ASR architectures.

---

## 6. Fine-Tuning Only the Decoder

### Parakeet TDT Architecture Breakdown

| Component | Parameters (Approx.) | % of Total |
|-----------|---------------------|------------|
| FastConformer Encoder | ~570M | ~95% |
| TDT Joint Network | ~10-15M | ~2% |
| TDT Prediction Network | ~10-15M | ~2% |
| Duration Predictor | ~5M | ~1% |
| **Total** | **~600M** | **100%** |

### Would Decoder-Only Fine-Tuning Work?

Fine-tuning only the TDT decoder (joint + prediction + duration predictor, ~25-30M params) while freezing the encoder:

**Pros:**
- Dramatically reduced VRAM: only ~30M trainable parameters vs 600M
- Optimizer states for 30M params: ~120 MB (vs ~2.4 GB for full model)
- No gradient computation through the encoder -- massive memory savings
- The encoder is already very good at acoustic feature extraction; the domain gap for children's speech might be addressable primarily through decoder adaptation

**Cons:**
- **The encoder IS the bottleneck for children's speech**: The acoustic characteristics of children's speech (higher pitch, different formant frequencies, less precise articulation) affect the mel-spectrogram and therefore the encoder's feature extraction. Simply adjusting the decoder cannot compensate for encoder-level misrepresentation.
- Published child ASR fine-tuning studies (Kid-Whisper, Fan et al., Takahashi et al.) all fine-tune the encoder (or the full model). None show decoder-only fine-tuning achieving comparable results.
- The TDT decoder is already quite small and may not have enough capacity for meaningful domain adaptation on its own.

### Hybrid Approach: LoRA on Encoder + Full Decoder Fine-Tuning

A practical middle ground:
- Apply LoRA (rank 8) to the encoder attention layers: ~6M trainable params
- Fully unfreeze the decoder: ~30M trainable params
- Total trainable: ~36M params (<6% of model)
- This captures both acoustic adaptation (encoder LoRA) and label/duration adaptation (decoder)
- VRAM: significantly less than full fine-tuning, comparable to LoRA-only

### Verdict

**Decoder-only is insufficient** because the domain gap for children's speech is primarily acoustic (encoder-level). However, **LoRA-encoder + full-decoder** is a viable hybrid that reduces VRAM while addressing both acoustic and linguistic adaptation.

---

## 7. Gradient Checkpointing Specifics

### How It Works

Gradient checkpointing (activation checkpointing) discards intermediate activations during the forward pass and recomputes them during the backward pass. This trades computation time for memory.

### VRAM Savings for a 600M Model

NVIDIA's NeMo documentation provides benchmarks on an H100 with a 1B parameter model:

| Configuration | Peak VRAM | Savings |
|--------------|-----------|---------|
| Baseline (no optimization) | 53 GB | -- |
| + FSDP (sharding) | 48 GB | 10% |
| + Gradient Checkpointing | 33 GB | **38%** |
| + Linear Cross-Entropy | 7.3 GB | 86% |

For our 600M model, the proportional savings from gradient checkpointing alone would be approximately **30-40% of activation memory**.

### VRAM Budget Estimate for RTX 4070 SUPER (12 GB)

| Component | Without GC | With GC |
|-----------|-----------|---------|
| Base model weights (bf16) | ~1.2 GB | ~1.2 GB |
| LoRA adapter weights (bf16) | ~12 MB | ~12 MB |
| LoRA optimizer states (AdamW) | ~24 MB | ~24 MB |
| LoRA gradients | ~12 MB | ~12 MB |
| Activations (batch=1, 20s audio) | ~4-6 GB | ~2-3 GB |
| PyTorch/CUDA overhead | ~1-2 GB | ~1-2 GB |
| **Total** | **~7-10 GB** | **~5-7 GB** |

**Key insight**: With LoRA (not full fine-tuning), the optimizer states and gradients are tiny because only ~6M parameters are trained. The dominant memory consumers are the base model weights and the activations. Gradient checkpointing targets the activations.

### Training Speed Penalty

NVIDIA's documentation states the overhead is **approximately 5-10% wall-clock time** for transformer models. Each checkpointed segment requires one additional forward pass during backward. For practical training:
- A 4-hour training run becomes ~4.2-4.4 hours
- The penalty is nearly negligible compared to the memory savings

### Can 12 GB VRAM Work?

**Likely yes**, with these settings:
- bf16 mixed precision
- LoRA rank 8 (not full fine-tuning)
- Gradient checkpointing enabled
- Batch size 1 (with gradient accumulation over 16-32 steps to simulate larger batch)
- Max audio length 15-20 seconds

The estimated ~5-7 GB with gradient checkpointing leaves headroom on a 12 GB card. However, this is a tight fit and depends heavily on:
- NeMo's own memory overhead (framework metadata, graph compilation)
- CUDA context size (~300-500 MB)
- Whether NeMo's ASR training pipeline has memory-hungry preprocessing steps

**Risk**: NeMo is not optimized for consumer GPUs. Its training infrastructure assumes data-center GPUs (A100/H100). Unexpected memory spikes from NeMo internals could push past 12 GB.

---

## 8. Cloud GPU Alternatives

If 12 GB proves insufficient, here are the cheapest cloud options for a 4-8 hour training run:

### Pricing Comparison (as of February 2026)

| Provider | GPU | VRAM | $/hour | 4h Cost | 8h Cost |
|----------|-----|------|--------|---------|---------|
| **Vast.ai** | RTX 4090 | 24 GB | $0.28 | $1.12 | $2.24 |
| **Vast.ai** | A100 PCIe 40 GB | 40 GB | $0.33 | $1.32 | $2.64 |
| **Vast.ai** | A6000 | 48 GB | $0.39 | $1.56 | $3.12 |
| **Vast.ai** | A100 SXM 80 GB | 80 GB | $0.68 | $2.72 | $5.44 |
| **RunPod** | RTX 4090 | 24 GB | ~$0.39 | $1.56 | $3.12 |
| **RunPod** | A100 80 GB | 80 GB | ~$1.74 | $6.96 | $13.92 |
| **Thunder Compute** | A100 | 80 GB | $0.78 | $3.12 | $6.24 |
| **Lambda Labs** | A100 40 GB | 40 GB | $1.29 | $5.16 | $10.32 |
| **Lambda Labs** | A100 80 GB | 80 GB | $1.79 | $7.16 | $14.32 |
| **Google Colab Pro+** | A100 40 GB | 40 GB | ~$6.20 (CU) | $24.80 | $49.60 |

### Best Value Recommendations

1. **Cheapest option**: Vast.ai RTX 4090 at $0.28/hr. A 4090 has 24 GB VRAM -- more than enough for LoRA fine-tuning with batch size 4-8. Total cost: **$1-2 for the entire training run.**

2. **Most reliable option**: Vast.ai A100 40 GB at $0.33/hr or RunPod community RTX 4090. Slight premium for reliability.

3. **Maximum headroom**: Vast.ai A100 SXM 80 GB at $0.68/hr if you want to use larger batch sizes for faster convergence. Still only **$3-6 total**.

### Practical Considerations

- **Vast.ai** is a marketplace (variable availability, community hosts) -- check reliability scores before renting
- **RunPod** offers both community (cheaper, less reliable) and secure (pricier, guaranteed) tiers
- **Lambda Labs** has the best setup experience but higher prices; may have waitlists
- **Colab Pro+** is the worst value for this use case ($50/month subscription, A100 access not guaranteed, session time limits)
- All providers support NeMo/PyTorch; Docker containers with CUDA pre-installed are standard

### Recommendation

**Vast.ai RTX 4090 or A100 40 GB** is the clear winner. For $1-3 total, you get a GPU with 24-40 GB VRAM for 4-8 hours -- enough for multiple training runs with hyperparameter sweeps. This is cheaper than a single cup of coffee and eliminates all VRAM concerns.

---

## 9. Pre-Built Fine-Tuned Models

### Parakeet TDT Models on HuggingFace

As of February 2026, there are **7 fine-tuned derivatives** of `nvidia/parakeet-tdt-0.6b-v3`:

| Model | Domain | Children's Speech? |
|-------|--------|--------------------|
| `qenneth/parakeet-tdt-0.6b-v3-finetuned-for-ATC` | Air Traffic Control | No |
| `johannhartmann/parakeet_de_med` | German Medical | No |
| `mrfakename/parakeet-elise` | Unknown | No |
| `mrfakename/parakeet-tagger-v1` | ASR tagging | No |
| `NeurologyAI/neuro-parakeet-mlx` | Neurology/Medical | No |
| `Archime/parakeet-tdt-0.6b-v3-fr-tv-media` | French TV/Media | No |
| `mlx-community/parakeet-tdt-0.6b-v3` | General (MLX conversion) | No |

**No children's speech fine-tuned Parakeet model exists.**

The NVIDIA model card for `parakeet-tdt-0.6b-v3` also lists **1 adapter** and **9 quantizations**, but none are children's-speech-specific.

### Kid-Whisper Models (Alternative Architecture)

The Kid-Whisper project offers pre-built children's speech models:

| Model | HuggingFace ID | WER (MyST test) |
|-------|---------------|-----------------|
| Kid-Whisper Small (MyST) | `aadel4/kid-whisper-small-en-myst` | 9.11% |
| Kid-Whisper Small (MyST+CSLU) | `aadel4/kid-whisper-small-en-myst_cslu` | Lower |
| Kid-Whisper Medium (MyST) | `aadel4/kid-whisper-medium-en-myst` | 8.61% |
| Kid-Whisper Medium (MyST+CSLU) | `aadel4/kid-whisper-medium-en-myst_cslu` | Lower |

These are Whisper models, not Parakeet. They cannot be used as drop-in replacements for the TDT cross-validator. However, they could serve as:
- A **benchmark** to measure Parakeet's fine-tuned performance against
- A **teacher model** for pseudo-labeling (see Section 4)
- An **alternative cross-validator** if swapping out Parakeet for Whisper is acceptable

### NGC Catalog

NVIDIA's NGC catalog hosts the base Parakeet models but no children's-speech-adapted variants.

### Verdict

**No pre-built children's speech Parakeet adapter exists.** You would be the first to create one. The Kid-Whisper models are available but are Whisper-based, not Parakeet-based.

---

## 10. ONNX/TensorRT Export with LoRA

### Can LoRA Adapters Be Baked into ONNX/TensorRT?

**Yes, through a two-step process:**

1. **Merge LoRA weights into the base model**: NeMo provides a merge script (`scripts/nlp_language_modeling/merge_lora_weights/merge.py`) that folds the low-rank matrices (A, B) back into the original weight matrices: `W_merged = W_base + alpha * (B @ A)`. The result is a standard model with the same architecture but updated weights.

2. **Export the merged model to ONNX**: NeMo's `Exportable` class supports ONNX export for ASR models, including FastConformer/Parakeet CTC, RNN-T, and TDT variants. The merged model exports exactly like an unmodified base model.

3. **Convert ONNX to TensorRT**: Standard ONNX-to-TensorRT conversion via `trtexec` or TensorRT Python API.

### Workflow

```
LoRA Adapter (.nemo) + Base Model (.nemo)
    |
    v  [merge_lora_weights.py]
Merged Model (.nemo)  -- same architecture, updated weights
    |
    v  [model.export("model.onnx")]
ONNX Model (.onnx)
    |
    v  [trtexec --onnx=model.onnx --saveEngine=model.trt]
TensorRT Engine (.trt)
```

### Important Caveats

- The NeMo merge script is documented for NLP/Megatron models. Whether it works out-of-the-box for ASR LoRA adapters depends on NeMo's ASR PEFT implementation sharing the same adapter format.
- After merging, the model is a standard NeMo model -- no LoRA overhead at inference time, no additional matrix multiplications. Inference speed is identical to the base model.
- The merged ONNX model is larger than the base model by the size of the adapter (~10-50 MB out of 2.4 GB total -- negligible).
- Alternative: `sherpa-onnx` (by k2-fsa) already has ONNX export pipelines for NeMo transducer models and could potentially handle the merged model.

### Verdict

**Yes, fully viable.** Merge LoRA weights into the base model, then export to ONNX/TensorRT as usual. The adapter "disappears" into the merged weights, so production deployment is identical to serving the base model. No runtime LoRA overhead.

---

## 11. Recommendation Summary

### Tier 1: Do This First

| Approach | Why | Effort |
|----------|-----|--------|
| **NeMo LoRA (from original proposal) + gradient checkpointing + bf16 + batch=1** | Most proven path. Try on your local RTX 4070 SUPER first. Estimated 5-7 GB VRAM with all optimizations. | Low |
| **Vast.ai RTX 4090 ($0.28/hr)** as fallback | If 12 GB is not enough, rent a 4090 for $1-2 total. Eliminates all VRAM concerns. | Trivial |

### Tier 2: If LoRA VRAM Is Still Tight

| Approach | Why | Effort |
|----------|-----|--------|
| **BitFit (bias-only fine-tuning)** | Proven on 600M Conformer (same architecture). Only 0.4% trainable params. Trivial to implement. Lowest possible VRAM. | Low |
| **LoRA encoder + full decoder unfreeze** | Captures both acoustic and label-space adaptation. ~36M trainable params. | Medium |

### Tier 3: Not Recommended

| Approach | Why Not |
|----------|---------|
| HF PEFT + ParakeetForCTC | Loses TDT decoder (timestamps, duration predictions) |
| QLoRA / bitsandbytes | NeMo does not support it; marginal savings on 600M model |
| IA3 | No ASR evidence, NeMo ASR support undocumented |
| Knowledge distillation | Architecture mismatch; MyST already has labels |
| Prompt tuning / soft prompts | Not applicable to CTC/TDT architectures |
| Decoder-only fine-tuning | Domain gap is acoustic (encoder-level), not linguistic |
| Prefix tuning | Not applicable to ASR |

### ONNX/TensorRT Deployment

Regardless of which fine-tuning method you choose, the path to production is the same:
1. Merge adapter/fine-tuned weights into base model
2. Export to ONNX
3. Optionally convert to TensorRT
4. Deploy with zero runtime overhead vs. base model

### Cloud GPU: Best Deal

If your local 12 GB GPU is insufficient: **Vast.ai RTX 4090 at $0.28/hr**. Budget $2-5 for the entire fine-tuning experiment including multiple training runs.

---

## Sources

- [Parakeet TDT 0.6B v3 Model Card (HuggingFace)](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
- [HuggingFace Transformers Parakeet Documentation](https://huggingface.co/docs/transformers/en/model_doc/parakeet)
- [Fine-tuned Models for parakeet-tdt-0.6b-v3](https://huggingface.co/models?other=base_model%3Afinetune%3Anvidia%2Fparakeet-tdt-0.6b-v3)
- [NeMo Supported PEFT Methods](https://docs.nvidia.com/nemo-framework/user-guide/24.09/nemotoolkit/nlp/nemo_megatron/peft/supported_methods.html)
- [NeMo Gradient Checkpointing Guide](https://docs.nvidia.com/nemo/automodel/latest/guides/gradient-checkpointing.html)
- [NeMo Model Export Documentation](https://docs.nvidia.com/nemo-framework/user-guide/25.02/nemotoolkit/core/export.html)
- [NeMo ASR Configuration Files](https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/asr/configs.html)
- [QLoRA Paper (Dettmers et al. 2023)](https://arxiv.org/abs/2305.14314)
- [DP-BitFit for Large ASR Models (arXiv:2410.01948)](https://arxiv.org/html/2410.01948)
- [Kid-Whisper (Jain et al. 2024)](https://arxiv.org/abs/2309.07927)
- [Kid-Whisper GitHub](https://github.com/ahmedadelattia/Kid-Whisper)
- [Kid-Whisper Models on HuggingFace](https://huggingface.co/aadel4)
- [Vast.ai GPU Pricing](https://vast.ai/pricing)
- [RunPod GPU Pricing](https://www.runpod.io/pricing)
- [Lambda Labs GPU Pricing](https://lambda.ai/pricing)
- [Google Colab Pricing](https://cloud.google.com/colab/pricing)
- [Cloud GPU Pricing Comparison (ComputePrices)](https://computeprices.com/providers/vast)
- [NeMo LoRA Merge Script](https://raw.githubusercontent.com/NVIDIA/NeMo/main/scripts/nlp_language_modeling/merge_lora_weights/merge.py)
- [sherpa-onnx NeMo Transducer Models](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html)
- [Parakeet Fine-Tuning Discussion (HuggingFace)](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2/discussions/18)
- [BitFit Paper (Ben Zaken et al. 2022)](https://arxiv.org/abs/2106.10199)
