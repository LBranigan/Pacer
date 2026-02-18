# Plan: CrisperWhisper as True 3rd ASR Engine

**Date:** 2026-02-16
**Status:** Needs additional thought — deployment and practical concerns documented below

## What is CrisperWhisper?

CrisperWhisper is a **free-form ASR transcriber**, NOT a forced aligner. It does not take reference text as input. You give it audio, it produces:

- Full verbatim transcription including fillers ("um", "uh"), stutters, false starts, repetitions
- Word-level timestamps (DTW on decoder cross-attention, 25ms frame precision)
- Disfluency detection as natural byproduct of verbatim transcription

**Based on:** Whisper large-v3 (1.55B parameters), fine-tuned with modified tokenizer + custom attention loss.

**Performance:**
- AMI dataset: 8.72 WER (vs Whisper large-v3's 16.01)
- TED-LIUM: 3.26 WER (vs 4.01)
- 1st place on OpenASR Leaderboard for verbatim datasets
- Disfluency detection: F1=0.90
- Noise robustness: F1 0.795 (vs WhisperX 0.590 under noise)

**License:** CC-BY-NC-4.0 (non-commercial only). This is a significant constraint for any future commercial use.

## Why CrisperWhisper for PACER?

After removing V0 from word-correctness voting (see fix-v0-voting-and-inflection-awareness-plan.md), the pipeline becomes effectively 2-engine: V1 (Reverb) vs Parakeet. CrisperWhisper would be a genuinely independent 3rd engine:

- **Different model family** (Whisper vs WeNet vs Parakeet) — uncorrelated errors
- **Verbatim-native** — preserves exactly the signals PACER needs (fillers, stutters, false starts)
- **Accurate word-level timestamps** — could serve as secondary timestamp source
- **Noise-robust** — better than both Reverb and standard Whisper in noisy conditions

With 3 truly independent engines, majority voting (2-of-3) becomes statistically valid.

## Known Deployment Issues (WSL2)

### Issue 1: VRAM Spike with Word-Level Timestamps (CRITICAL)

The HuggingFace transformers pipeline with `return_timestamps="word"` causes massive VRAM spikes:

| Config | VRAM Usage |
|--------|-----------|
| `batch_size=24` + `return_timestamps="word"` | >20GB |
| `batch_size=24` + `return_timestamps=True` (segment-level) | <7GB |
| CrisperWhisper issue #13: 2-minute audio | 40GB+ on A100 |

**Root cause:** Cross-attention weight retention for DTW timestamp computation + memory leak in batch processing.

**Mitigations:**
- Reduce `batch_size` to 1 (default `transcribe.py` uses 16 — too high)
- Set `num_beams=1` (disable beam search)
- Process shorter audio segments (pre-clip to passage duration)
- ORF recordings are typically 60s — not the multi-hour files that cause the worst spikes

### Issue 2: WSL2 CUDA OOM Bug

`faster-whisper` issue #442 documents sporadic `RuntimeError: CUDA failed with error out of memory` on WSL2 even with plenty of free VRAM (RTX 4070 12GB, RTX 3090 24GB):

- **Root cause:** WSL2 kernel bug, not the application
- **Fix:** `wsl --update --pre-release` to get WSL2 version 2.0.7.0+
- Windows Task Manager showed VRAM never exceeding 5GB despite the crash

### Issue 3: CTranslate2 CUDA Compilation

The `faster_CrisperWhisper` variant may fail with `"This CTranslate2 package was not compiled with CUDA support"`:

- CTranslate2 >= 4.5.0 requires CUDA >= 12.3 + cuDNN v9
- For CUDA 11 + cuDNN 8: pin `ctranslate2==3.24.0`
- For CUDA 12 + cuDNN 8: pin `ctranslate2==4.4.0`

### Issue 4: Tensor Dimension Errors

Issue #43: Some audio files cause `"Expected 3D or 4D tensor... but got: [10, 0, 1500]"` — unresolved, no workaround posted. Appears to affect certain audio files unpredictably.

## Two Deployment Variants

### Option A: HuggingFace Transformers (Accurate Timestamps)

This is the ONLY way to get CrisperWhisper's accurate word-level timestamps. Requires their custom transformers fork:

```bash
pip install git+https://github.com/nyrahealth/transformers.git@crisper_whisper
```

```python
from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline
import torch

device = "cuda:0"
dtype = torch.float16

model = AutoModelForSpeechSeq2Seq.from_pretrained(
    "nyrahealth/CrisperWhisper", torch_dtype=dtype,
    low_cpu_mem_usage=True, use_safetensors=True
).to(device)
processor = AutoProcessor.from_pretrained("nyrahealth/CrisperWhisper")

pipe = pipeline(
    "automatic-speech-recognition", model=model,
    tokenizer=processor.tokenizer, feature_extractor=processor.feature_extractor,
    chunk_length_s=30, batch_size=1,  # batch_size=1 for VRAM safety
    return_timestamps='word', torch_dtype=dtype, device=device,
)
result = pipe("audio.wav")
```

**GPU requirements:** 8-12GB minimum with `batch_size=1`, but peak can spike higher. Model itself is ~3.5GB.

### Option B: faster_CrisperWhisper (CTranslate2, Faster)

Faster inference but **timestamp accuracy degrades** (their own warning). Transcription accuracy and filler detection are preserved.

```python
from faster_whisper import WhisperModel

model = WhisperModel("nyrahealth/faster_CrisperWhisper",
                     device="cuda", compute_type="float16")
segments, info = model.transcribe("audio.wav", beam_size=1,
                                  language="en", word_timestamps=True)
```

**For PACER's use case:** Since Parakeet already provides authoritative timestamps, Option B's transcript accuracy + filler detection may be sufficient. We'd use CrisperWhisper for word correctness votes and disfluency signals, not timestamps.

## Should CrisperWhisper Run on All Audio or Selectively?

### Option 1: Run on Everything (Recommended)

Run CrisperWhisper on every recording alongside Reverb and Parakeet. This gives true 3-engine consensus for every word.

**Pros:**
- Uniform 3-way voting on all words
- Disfluency detection from a second verbatim-native engine
- No special-case logic to decide "problem" vs "non-problem" sentences

**Cons:**
- Adds ~5-15s latency per recording (Whisper large-v3 on GPU, 60s audio)
- VRAM contention with Reverb/Parakeet (need GPU lock serialization)
- Total pipeline time increases from ~15s to ~25s

### Option 2: Run Selectively on Problem Words/Sentences

Only invoke CrisperWhisper when the V1-vs-Parakeet verdict is "disagreed" or "unconfirmed".

**Pros:**
- Saves GPU time on recordings where V1 and Pk agree
- Could pre-clip audio to just the disputed time ranges

**Cons:**
- Requires a second pipeline pass (run V1+Pk first, identify disputes, then run CW)
- Pre-clipping requires accurate timestamps, which is the thing under dispute
- CrisperWhisper context is degraded without surrounding words
- Adds pipeline complexity and a conditional code path
- Latency for disputed recordings would actually be HIGHER (sequential instead of parallel)

**Recommendation:** Run on everything. The 5-15s additional latency is acceptable for an assessment tool where results are not time-critical. Parallel execution via `Promise.allSettled()` means CrisperWhisper runs during the same wall-clock time as Reverb + Parakeet.

## No Built-In Server — You Must Build a Wrapper

CrisperWhisper has NO official REST API, no Docker image, and no production tooling. The only interfaces are `transcribe.py` (CLI) and `app.py` (Streamlit UI with known bugs).

### Minimal FastAPI Wrapper

Add a `/crisperwhisper` endpoint to the existing `services/reverb/server.py`:

```python
# ── CrisperWhisper setup ──
_cw_pipe = None

def _load_crisperwhisper():
    global _cw_pipe
    if _cw_pipe is not None:
        return _cw_pipe
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline as hf_pipeline
    device = "cuda:0"
    dtype = torch.float16
    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        "nyrahealth/CrisperWhisper", torch_dtype=dtype,
        low_cpu_mem_usage=True, use_safetensors=True
    ).to(device)
    processor = AutoProcessor.from_pretrained("nyrahealth/CrisperWhisper")
    _cw_pipe = hf_pipeline(
        "automatic-speech-recognition", model=model,
        tokenizer=processor.tokenizer, feature_extractor=processor.feature_extractor,
        chunk_length_s=30, batch_size=1, return_timestamps='word',
        torch_dtype=dtype, device=device,
    )
    return _cw_pipe

@app.post("/crisperwhisper")
@limiter.limit("10/minute")
async def crisperwhisper_transcribe(req: AudioRequest, request: Request):
    async with gpu_lock:  # Serialize with Reverb/Parakeet
        pipe = _load_crisperwhisper()
        # Save audio to temp file
        audio_bytes = base64.b64decode(req.audio_base64)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(audio_bytes)
            tmp_path = f.name
        try:
            result = pipe(tmp_path)
            words = []
            for chunk in result.get("chunks", []):
                ts = chunk.get("timestamp", [None, None])
                words.append({
                    "word": chunk["text"].strip(),
                    "startTime": ts[0],
                    "endTime": ts[1],
                    "confidence": 1.0  # CrisperWhisper doesn't output confidence
                })
            return {
                "words": words,
                "transcript": result.get("text", ""),
                "model": "crisperwhisper"
            }
        finally:
            os.unlink(tmp_path)
```

### Docker Changes

The Dockerfile would need additional dependencies:

```dockerfile
# Add CrisperWhisper's custom transformers fork
RUN pip install git+https://github.com/nyrahealth/transformers.git@crisper_whisper

# Pre-download model weights (~3.5GB)
RUN python -c "from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor; \
    AutoModelForSpeechSeq2Seq.from_pretrained('nyrahealth/CrisperWhisper'); \
    AutoProcessor.from_pretrained('nyrahealth/CrisperWhisper')"
```

**VRAM concern:** Reverb (~2GB) + Parakeet (~600MB) + CrisperWhisper (~3.5GB) = ~6GB minimum in VRAM just for model weights. With inference buffers, you need at least 10-12GB GPU. The `gpu_lock` ensures only one model runs at a time, but all stay resident in VRAM.

### Alternative: Separate Docker Container

If VRAM is tight, run CrisperWhisper in its own container on a separate GPU or as a CPU fallback:

```yaml
# docker-compose.yml
services:
  reverb:
    # ... existing (Reverb + Parakeet on GPU 0)

  crisperwhisper:
    build:
      context: ./services/crisperwhisper
    ports: ["8766:8766"]
    deploy:
      resources:
        devices:
          - driver: nvidia, count: 1, capabilities: [gpu]
    environment:
      - CUDA_VISIBLE_DEVICES=1  # Second GPU, if available
```

This avoids VRAM contention but requires routing logic on the frontend.

## Frontend Integration

### New API Wrapper (js/crisperwhisper-api.js)

```javascript
import { BACKEND_URL, backendHeaders } from './backend-config.js';

export async function sendToCrisperwhisper(blob) {
  const base64 = await blobToBase64(blob);
  const resp = await fetch(`${BACKEND_URL}/crisperwhisper`, {
    method: 'POST',
    headers: backendHeaders('application/json'),
    body: JSON.stringify({ audio_base64: base64 }),
    signal: AbortSignal.timeout(60000)  // 60s timeout (Whisper is slower)
  });
  return resp.ok ? resp.json() : null;
}
```

### Kitchen-Sink Integration

Add CrisperWhisper to the parallel execution in `kitchen-sink-merger.js`:

```javascript
const [reverbResult, xvalResult, cwResult] = await Promise.allSettled([
  sendToReverbEnsemble(blob),
  sendToCrossValidator(blob),   // Parakeet
  sendToCrisperwhisper(blob),   // CrisperWhisper (NEW)
]);
```

### 3-Way Verdict Update

With V0 demoted from voting (Plan 1), the verdict becomes V1 vs Parakeet vs CrisperWhisper:

```javascript
const v1Correct = v1Entry.type === 'correct' && !v1Entry.compound;
const pkCorrect = pkType === 'correct';
const cwCorrect = cwType === 'correct';  // NEW
const correctCount = (v1Correct ? 1 : 0) + (pkCorrect ? 1 : 0) + (cwCorrect ? 1 : 0);
```

Now `correctCount >= 2` means 2 of 3 genuinely independent engines agree. This is true majority voting with uncorrelated voters.

## Open Questions

### 1. VRAM Budget

What GPU do you have? The total VRAM requirement depends on whether all models coexist:
- **Single GPU, 12GB:** Tight. May need to unload Reverb before loading CrisperWhisper (adds latency).
- **Single GPU, 24GB:** Comfortable. All three models can coexist.
- **Two GPUs:** Ideal. Reverb+Parakeet on GPU 0, CrisperWhisper on GPU 1.

### 2. Latency Tolerance

CrisperWhisper on GPU for a 60s recording: ~5-15 seconds. On CPU: ~30-60 seconds. Is the added latency acceptable? (The pipeline already takes ~10-15s for Reverb+Parakeet.)

### 3. Non-Commercial License

CC-BY-NC-4.0 means no commercial use without a separate license from nyrahealth. Is this acceptable for your use case?

### 4. faster_CrisperWhisper vs Full CrisperWhisper

The faster variant (CTranslate2) loses timestamp accuracy but preserves transcription accuracy and filler detection. Since PACER already uses Parakeet for authoritative timestamps, the faster variant might be sufficient — and would have lower VRAM usage and faster inference.

### 5. CrisperWhisper Replacing V0's Disfluency Role

Currently V0 helps detect disfluencies (V1 insertion present + V0 absent → filler). CrisperWhisper natively outputs fillers in its transcript. Could CrisperWhisper eventually replace V0's disfluency detection role entirely? This would mean:
- Reverb runs single-pass (V1 only, verbatim=1.0) — faster
- CrisperWhisper provides independent disfluency confirmation
- V0 eliminated entirely

This is a future consideration, not part of the initial integration.

### 6. Stability Concerns

CrisperWhisper has known stability issues:
- Tensor dimension errors on some audio files (issue #43, unresolved)
- VRAM spikes (issue #13)
- CTranslate2 CUDA compatibility (issue #36)

The integration should treat CrisperWhisper as **optional/degraded-graceful**: if it fails or times out, the pipeline falls back to V1-vs-Parakeet (same as today minus V0 voting).

## Implementation Phases

### Phase 1: Standalone Testing (No Code Changes)
- Install CrisperWhisper locally (outside Docker)
- Run it on 10-20 existing ORF recordings
- Compare word-for-word against V1 and Parakeet
- Verify VRAM behavior on your specific GPU
- Identify any crash-prone audio patterns

### Phase 2: Server Integration
- Add `/crisperwhisper` endpoint to `server.py`
- Update Dockerfile with CrisperWhisper dependencies
- Add `crisperwhisper_configured` to `/health` response
- Test GPU lock behavior with 3 models

### Phase 3: Frontend Integration
- Create `js/crisperwhisper-api.js`
- Add CrisperWhisper to kitchen-sink parallel execution
- Add CrisperWhisper alignment (4th `alignWords()` call)
- Update 3-way verdict to 3-way voting (V1 + Pk + CW)
- Add CW column to debug table
- Graceful fallback when CrisperWhisper unavailable

### Phase 4: Evaluation
- Run on a corpus of 50+ recordings
- Compare accuracy with and without CrisperWhisper
- Measure latency impact
- Identify false-positive/false-negative patterns
- Decide whether to keep V0 disfluency role or let CrisperWhisper replace it
