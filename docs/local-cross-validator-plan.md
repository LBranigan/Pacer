# Plan: Local ASR Cross-Validator (Deepgram Replacement/Toggle)

## Goal

Add a toggleable local ASR model alongside Deepgram as the "independent clean transcript" cross-validator in the Kitchen Sink pipeline. The user should be able to switch between Deepgram (cloud) and a local model via feature flag, with the same downstream pipeline consuming either source identically.

## Current Architecture

```
Audio → Reverb v=1.0 (verbatim) ──┐
Audio → Reverb v=0.0 (clean)   ──┤ NW diff → disfluency detection (Job 1)
                                   ↓
                          Merged Reverb words
                                   ↓
Audio → Deepgram Nova-3 ──────── NW cross-validation (Job 2)
                                   ↓
                          Final validated words
```

**Job 1** (disfluency detection) stays unchanged — Reverb dual-pass owns this.
**Job 2** (cross-validation) is where the local model replaces or toggles with Deepgram.

## Research Summary

Three parallel research agents evaluated: all Parakeet variants, 10+ alternative models, and noisy classroom/child speech benchmarks.

### The Two Viable Candidates

Every other model was eliminated. Full elimination reasons at the bottom of this document.

#### Candidate A: NVIDIA Parakeet-TDT 0.6B v2

| Attribute | Detail |
|---|---|
| Architecture | FastConformer XL encoder (24 layers) + TDT decoder |
| Parameters | 600M |
| Training data | ~120,000 hours (10k human-transcribed + 110k pseudo-labeled) |
| VRAM (batch 1, offline) | **~3 GB** (NVIDIA Riva support matrix) |
| VRAM (ONNX int8) | **~640 MB** (sherpa-onnx export available) |
| WER (LibriSpeech clean) | **1.69%** |
| WER (LibriSpeech other) | **3.19%** |
| WER (AMI meeting) | 11.16% |
| WER (average, 8 benchmarks) | **6.05%** |
| WER (noisy, 10dB SNR) | 6.95% (+15% relative) |
| WER (noisy, 5dB SNR) | 8.23% (+36% relative) |
| WER (noisy, 0dB SNR) | **11.88%** (+96% relative) |
| WER (noisy, -5dB SNR) | 20.26% (+235% relative) |
| Timestamps | **TDT native** — Token-and-Duration Transducer predicts both token identity AND duration in a single forward pass. No separate alignment step. Frame-level precision. |
| Confidence scores | Entropy-based (Tsallis α=1/3) — **4x better at detecting incorrect words** than raw probability method. NeMo has official tutorial. |
| Clean output | **Yes** — outputs punctuation and capitalization natively (PnC). |
| License | CC-BY-4.0 (commercial OK) |
| Deployment | NeMo toolkit or sherpa-onnx (ONNX int8, no NeMo dependency) |
| Child speech | No specific benchmarks, but trained on diverse data |
| ONNX/sherpa-onnx | Available — `sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8` (622MB encoder). |
| Inference speed | RTFx 3,380 — a 2-minute passage transcribes in <50ms |
| Max audio length | 24 min (full attention), 3 hours (local attention) |
| Disk size | 2.47 GB checkpoint |

**Key strengths:** Best-in-class accuracy (6.05% avg WER), best timestamps (TDT native), best confidence estimation (entropy-based), punctuated/capitalized output, excellent inference speed.

**Key weaknesses:** Heavier deployment (NeMo or sherpa-onnx), Conformer architecture shares some DNA with Reverb's WeNet backbone (though decoder and training are very different). VRAM scales with audio length in full attention mode (use local attention for long files).

**Why v2 over v3?** v3 is a multilingual extension (25 European languages) trained on 670k hours. It sacrifices English accuracy (6.34% avg vs 6.05%) for multilingual support not needed here. v3 also loses PnC output (lowercase only). v2 is strictly better for English-only cross-validation.

#### Candidate B: Whisper Large-v3-Turbo via faster-whisper

| Attribute | Detail |
|---|---|
| Architecture | Transformer encoder-decoder (32 enc + 4 dec layers) |
| Parameters | 809M |
| VRAM (int8) | **1.5 GB** (benchmarked: 1,545MB for 13min audio) |
| VRAM (fp16) | ~2.5 GB |
| WER (mixed benchmarks) | 7.7% |
| WER (LibriSpeech clean) | ~2-3% |
| WER (noisy, Ionio) | **29.8%** |
| Noise degradation | 2-3% clean → 29.8% noisy (**~27pp increase**) |
| Timestamps | DTW on cross-attention weights — moderate quality. Known drift issues around disfluencies and silence. |
| Confidence scores | Per-word probability field when `word_timestamps=True` — raw softmax (overconfident, not calibrated). |
| Clean output | **Yes** — naturally removes disfluencies, produces punctuated/capitalized text. This is Whisper's default behavior. |
| License | MIT (unrestricted commercial use) |
| Deployment | `pip install faster-whisper` — trivial, one-line install |
| Child speech | ~25% WER on child speech vs ~3% on adults (base Whisper). Middle school (11-14) closer to adult range. |
| ONNX/CTranslate2 | CTranslate2 built-in (that's what faster-whisper IS). |

**Key strengths:** Trivially small VRAM (1.5GB), clean punctuated output by default, completely different architecture from Reverb (maximum error diversity), simplest deployment, MIT license.

**Key weaknesses:** Poor noise robustness (29.8% WER noisy — nearly 10x worse than Parakeet), mediocre timestamps (DTW drift), uncalibrated confidence scores, worse on child speech.

### Head-to-Head: The Decisive Factors

| Factor | Parakeet-TDT 0.6B v2 | Whisper Turbo (faster-whisper) | Winner |
|--------|----------------------|-------------------------------|--------|
| VRAM alongside Reverb (~5-8GB) | ~3GB native, 640MB ONNX | 1.5GB int8 | **Whisper** (but both fit) |
| **Noise robustness (classrooms)** | 6.95% at 10dB, 11.88% at 0dB | 29.8% noisy | **Parakeet by 3-4x** |
| Timestamp quality | TDT native (excellent) | DTW cross-attention (moderate) | **Parakeet** |
| Confidence quality | Entropy-based (4x better detection) | Raw softmax (overconfident) | **Parakeet** |
| Clean output (punctuated) | Yes (PnC natively) | Yes (default behavior) | **Tie** |
| Error diversity vs Reverb | Moderate (both Conformer-based) | High (Transformer enc-dec vs WeNet) | **Whisper** |
| Deployment simplicity | NeMo or sherpa-onnx | `pip install faster-whisper` | **Whisper** |
| WER (clean speech) | **1.69%** | ~2-3% | **Parakeet** |
| WER (average, 8 benchmarks) | **6.05%** | 7.7% | **Parakeet** |
| License | CC-BY-4.0 | MIT | Whisper (slightly more permissive) |

### Classroom Noise Context

Research on classroom acoustics shows typical SNR of 5-15dB (but can drop to -7 to +5dB during group work). At those levels:
- **Parakeet v2**: 6.95% WER at 10dB, 8.23% at 5dB — modest degradation from 6.05% baseline
- **Whisper**: Significant degradation — the 29.8% noisy figure comes from a mixed-noise benchmark

Middle school classroom speech has been measured at 0.84-0.95 WER with general cloud ASR engines. Any model will struggle here, but Parakeet's noise robustness gives it a significant edge.

Children's babble noise (background chatter from other students) is specifically noted in research as "more challenging as it is less likely to occur in public datasets that most current ASR models are trained on." Parakeet's SpecAugment-heavy training gives it better resilience here.

## Recommendation

**Primary: Parakeet-TDT 0.6B v2 via sherpa-onnx**

The noise robustness difference is too significant to ignore for a classroom deployment. A cross-validator that degrades to 29.8% WER in noise is essentially useless — it would generate so many false disagreements that the cross-validation signal becomes noise itself. Parakeet v2 at 6.95-11.88% WER in the 0-10dB SNR range typical of classrooms is still providing a meaningful second opinion.

v2 also outputs punctuation and capitalization natively — no text normalization needed. (Your NW alignment normalizes to lowercase anyway via `_normalizeWord`, so this is cosmetic but nice to have for debugging/display.)

v2 is preferred over v3 because it has better English accuracy (6.05% vs 6.34% avg WER, 1.69% vs 1.93% LS clean) and PnC output. v3's multilingual support (25 languages) is unnecessary overhead.

**Secondary: faster-whisper large-v3-turbo as toggle option**

Keep this as a second local option for when:
- VRAM is tight (running Reverb on a large file)
- You want maximum architecture diversity for a specific test
- Classroom is quiet and noise isn't a factor

**Tertiary: Deepgram Nova-3 stays as cloud option**

Keep Deepgram as the third option. Sometimes you want a completely independent cloud opinion, and the API cost is minimal for occasional use.

## Architecture Design

### Toggle System

```
localStorage key: 'orf_cross_validator'
Values: 'deepgram' (default) | 'parakeet' | 'whisper-turbo'
```

### Abstraction Layer

Create `js/cross-validator.js` that wraps all three options behind a common interface:

```javascript
// Common interface: takes audio blob, returns { words, transcript, model }
// where words = [{ word, startTime, endTime, confidence }]

export async function crossValidate(blob) {
  const engine = getCrossValidatorEngine(); // reads localStorage
  switch (engine) {
    case 'parakeet':  return await sendToParakeet(blob);
    case 'whisper-turbo': return await sendToWhisperTurbo(blob);
    case 'deepgram':
    default:          return await sendToDeepgram(blob);
  }
}
```

### Backend Additions

Add two new endpoints to `server.py`:

```
POST /parakeet     — transcribes via Parakeet-TDT (sherpa-onnx)
POST /whisper      — transcribes via faster-whisper large-v3-turbo int8
```

Both return the same JSON contract as the existing `/deepgram` endpoint:

```json
{
  "words": [
    { "word": "the", "startTime": "0.12s", "endTime": "0.25s", "confidence": 0.97 }
  ],
  "transcript": "the cat sat on the mat",
  "model": "parakeet-tdt-0.6b-v2"
}
```

### Pipeline Changes

`kitchen-sink-merger.js` line 205 currently calls `sendToDeepgram(blob)`. Replace with:

```javascript
import { crossValidate } from './cross-validator.js';

// Step 2: Run Reverb + cross-validator in parallel
const [reverbResult, xvalResult] = await Promise.allSettled([
  sendToReverbEnsemble(blob),
  crossValidate(blob)  // dispatches to parakeet/whisper/deepgram based on toggle
]);
```

`deepgram-api.js` function `crossValidateWithDeepgram` gets renamed to `crossValidateTranscripts` (engine-agnostic) and moves to `cross-validator.js`. The NW alignment logic is identical regardless of which engine provided the words.

### UI Toggle

Add a dropdown in the dev tools panel (alongside existing VAD threshold slider):

```
Cross-Validator: [Deepgram v] [Parakeet] [Whisper Turbo]
Status: ● Connected (model loaded)
```

## Implementation Phases

### Phase 1: Abstraction Layer (no new models)

1. Create `js/cross-validator.js` with the toggle interface
2. Move `crossValidateWithDeepgram` out of `deepgram-api.js` into `cross-validator.js` as `crossValidateTranscripts`
3. Update `kitchen-sink-merger.js` to use the new abstraction
4. Add `orf_cross_validator` localStorage flag
5. Deepgram remains the only available engine — no functional change
6. Add UI toggle (disabled options grayed out with "not configured" tooltip)

### Phase 2: Parakeet Backend

1. Install sherpa-onnx in the Reverb Docker container (or a separate container)
2. Download `sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8` model files (~640MB)
3. Add `/parakeet` endpoint to `server.py` with same JSON contract
4. Handle GPU sharing with Reverb (sequential processing via `gpu_lock` already exists)
5. Add health check for Parakeet model availability
6. Wire up `sendToParakeet` in `cross-validator.js`

### Phase 3: Whisper Backend

1. Install `faster-whisper` in the Docker container
2. Download `large-v3-turbo` model (auto-downloaded on first use, ~1.5GB)
3. Add `/whisper` endpoint to `server.py`
4. Wire up `sendToWhisperTurbo` in `cross-validator.js`

### Phase 4: Comparison Testing

1. Collect 10-20 recordings with known teacher annotations
2. Run all three cross-validators on same recordings
3. Compare: which produces the most accurate cross-validation (fewer false disagreements, catches real Reverb errors)
4. Test in actual classroom noise conditions
5. Measure VRAM usage with Reverb + each model running simultaneously

## VRAM Budget (12GB total)

| Configuration | Reverb | Cross-validator | Total | Headroom |
|---|---|---|---|---|
| Reverb + Deepgram (current) | ~5-8GB | 0 (cloud) | 5-8GB | 4-7GB |
| Reverb + Parakeet ONNX int8 | ~5-8GB | ~1-2GB | 6-10GB | 2-6GB |
| Reverb + Parakeet NeMo | ~5-8GB | ~3GB | 8-11GB | 1-4GB |
| Reverb + Whisper Turbo int8 | ~5-8GB | ~1.5GB | 6.5-9.5GB | 2.5-5.5GB |
| Reverb + Parakeet + Whisper | ~5-8GB | ~3-4GB | 8-12GB | 0-4GB (tight) |

Recommended: Parakeet via sherpa-onnx int8 (~1-2GB) keeps total under 10GB with comfortable headroom.

## Eliminated Models (with reasons)

| Model | Reason for elimination |
|---|---|
| Parakeet-TDT 0.6B v3 | Multilingual (25 langs) — sacrifices English accuracy (6.34% vs 6.05% avg WER), loses PnC output. No benefit for English-only use. |
| NVIDIA Canary-1B-v2 | 8-10GB VRAM with timestamps — won't fit alongside Reverb |
| Parakeet-TDT 1.1B | 7GB VRAM for >15min audio — too tight |
| Parakeet 1.1B RNNT | 11.4GB VRAM — exceeds 12GB budget with Reverb |
| wav2vec2-large | 54.69% WER in noisy conditions — catastrophically bad |
| HuBERT | Same CTC architecture issues, no clean output |
| Moonshine Base | No word-level timestamps, no confidence scores |
| SenseVoice Small | Sketchy license ("reference and learning purposes only"), no confidence scores, immature timestamps |
| Distil-Whisper | Strictly worse than Whisper Turbo on every dimension (higher WER, slower) |
| Whisper Medium | Strictly worse than Turbo (higher WER, slower, similar VRAM) |
| NeMo Conformer-CTC | Superseded by Parakeet-TDT, no clean output |
| Vosk | 10-15% WER — too inaccurate to be a useful cross-validator |

## Known Issues & Caveats

- **NeMo on Windows not officially supported** — use WSL2 with CUDA passthrough (which you already have) or sherpa-onnx (Windows-native)
- **VRAM scales with audio length** in full attention mode — a 40-min file caused OOM on 24GB A5000. Fix: use local attention (`rel_pos_local_attn`) + `bfloat16`. For 1-5 min reading passages, this is not an issue.
- **Phrase boosting is broken** in NeMo ([#14500](https://github.com/NVIDIA-NeMo/NeMo/issues/14500)) — WER gets worse. Not relevant for cross-validation (we don't want biasing anyway).
- **No child speech benchmarks** for Parakeet specifically. Expect elevated WER (15-30% range depending on age). Acceptable for cross-validation since we compare two transcripts rather than relying on Parakeet alone.
- **Speech enhancement preprocessing makes things WORSE** — research shows ALL 40 tested denoiser+ASR configurations degraded accuracy. Modern models handle noise better directly. Do NOT add a denoising step.

## Key Research Sources

- [Parakeet-TDT 0.6B v2 HuggingFace](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2) — model card with noise benchmarks (MUSAN)
- [NVIDIA Riva ASR Support Matrix](https://docs.nvidia.com/nim/riva/asr/latest/support-matrix.html) — official VRAM numbers for Parakeet
- [NVIDIA TDT Architecture Blog](https://developer.nvidia.com/blog/turbocharge-asr-accuracy-and-speed-with-nvidia-nemo-parakeet-tdt) — TDT deep-dive
- [Canary-1B-v2 & Parakeet-TDT-0.6B-v3 paper (arXiv 2509.14128)](https://arxiv.org/html/2509.14128v1) — noise robustness benchmarks
- [Ionio 2025 Edge STT Benchmark](https://www.ionio.ai/blog/2025-edge-speech-to-text-model-benchmark-whisper-vs-competitors) — Whisper vs Parakeet in noisy conditions
- [NeMo Entropy-Based Confidence (NVIDIA blog)](https://developer.nvidia.com/blog/entropy-based-methods-for-word-level-asr-confidence-estimation/) — 4x better error detection
- [NeMo Confidence Estimation Tutorial](https://github.com/NVIDIA-NeMo/NeMo/blob/main/tutorials/asr/ASR_Confidence_Estimation.ipynb)
- [faster-whisper benchmark (GitHub #1030)](https://github.com/SYSTRAN/faster-whisper/issues/1030) — VRAM measurements
- [sherpa-onnx Parakeet models](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html) — ONNX int8 deployment
- [SaladCloud Parakeet-TDT 1.1B benchmark](https://blog.salad.com/parakeet-tdt-1-1b/) — 1.1B VRAM measurements
- [Classroom noise and child speech ASR (EDM 2022)](https://educationaldatamining.org/edm2022/proceedings/2022.EDM-long-papers.26/) — 0.84-0.95 WER on middle school classroom speech
- [Causal analysis of ASR errors for children (2025)](https://www.sciencedirect.com/science/article/pii/S0885230825000841) — age effects, 2-5x worse WER than adults
- [CPT-Boosted Wav2vec2.0 for Classroom Environments](https://arxiv.org/html/2409.14494v1) — classroom-specific fine-tuning
- [NeMo Forced Aligner](https://research.nvidia.com/labs/conv-ai/blogs/2023/2023-08-nfa/) — best word alignment accuracy
- [When De-noising Hurts (arXiv 2512.17562)](https://arxiv.org/abs/2512.17562) — speech enhancement degrades modern ASR
- [Benchmarking Children's ASR (Interspeech 2024)](https://arxiv.org/html/2406.10507v1) — child speech WER across models
- [K-12 Classroom Noise Levels (JASA 2021)](https://pubs.aip.org/asa/jasa/article/150/2/864/615561/Speech-and-noise-levels-measured-in-occupied-K-12) — measured SNR data
