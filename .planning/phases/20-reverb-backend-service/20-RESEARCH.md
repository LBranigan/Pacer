# Phase 20: Reverb Backend Service - Research

**Researched:** 2026-02-05
**Domain:** Python backend service for Reverb ASR with GPU acceleration
**Confidence:** HIGH

## Summary

This phase establishes a local Reverb ASR service in Docker with GPU access that the browser client can call for speech transcription. The service exposes two endpoints: `/ensemble` (returns both verbatim v=1.0 and clean v=0.0 transcriptions) and `/health` (availability checking with GPU status).

Reverb ASR is Rev.ai's open-source model trained on 200k hours of human-transcribed audio. Its key feature is the verbatimicity parameter (0.0-1.0) which controls whether disfluencies are preserved. This enables model-level disfluency detection that post-hoc STT analysis cannot achieve.

The phase has four critical requirements validated by prior project research:
1. **Docker GPU passthrough** - Silent fallback to CPU is a documented failure mode
2. **CORS configuration** - Browser-based smoke testing required (curl success is insufficient)
3. **VRAM management** - 8GB VRAM limit requires chunking for long audio
4. **CTM parsing** - Phase 0 verified 6-field format with confidence=0.00

**Primary recommendation:** Use PyTorch official Docker image with explicit GPU verification at startup. Fail fast if GPU unavailable rather than silently degrading to CPU.

## Standard Stack

The established libraries/tools for this domain:

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| rev-reverb | 0.1.0 | Reverb ASR model | Only available version; installs modified wenet toolkit |
| FastAPI | >=0.115.0 | HTTP REST framework | Industry standard for Python APIs, native async, Pydantic v2 |
| uvicorn | >=0.30.0 | ASGI server | Standard for FastAPI, `[standard]` includes uvloop |
| Python | 3.10-3.11 | Runtime | Reverb requires 3.10+; 3.11 recommended for PyTorch 2.x |
| PyTorch | 2.0+ | Deep learning | Installed by rev-reverb; GPU inference ~5x faster |

### Docker/GPU

| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| pytorch/pytorch base image | 2.4.0-cuda11.8-cudnn9-runtime | Container base | Pre-configured CUDA, PyTorch compatibility |
| NVIDIA Container Toolkit | Latest | GPU passthrough | Required for Docker GPU access; replaces deprecated nvidia-docker |
| CUDA | 11.8 | GPU acceleration | Broadest PyTorch wheel compatibility |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| python-multipart | >=0.0.9 | Form data parsing | Required if adding file upload endpoints |
| pydantic | >=2.0 | Request validation | Included with FastAPI 0.115+; do NOT install v1 |
| ffmpeg | system package | Audio conversion | May be needed for non-WAV inputs |
| git-lfs | system package | Model download | Required for HuggingFace model fetch |

### Alternatives Considered

| Recommended | Could Use | Tradeoff |
|-------------|-----------|----------|
| FastAPI | Flask | Flask is older; FastAPI has native async, better validation |
| Single uvicorn worker | Gunicorn + workers | Multiple workers duplicate GPU memory; single worker sufficient |
| pytorch/pytorch image | nvidia/cuda base | PyTorch image includes PyTorch; fewer install steps |
| Direct uvicorn | Nginx reverse proxy | Nginx overkill for single-user localhost service |

**Installation:**

```bash
# requirements.txt for Reverb service
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
python-multipart>=0.0.9
rev-reverb==0.1.0
```

```dockerfile
# Dockerfile base
FROM pytorch/pytorch:2.4.0-cuda11.8-cudnn9-runtime
```

```yaml
# docker-compose.yml GPU reservation
services:
  reverb:
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

## Architecture Patterns

### Recommended Project Structure

```
services/
└── reverb/
    ├── server.py           # FastAPI application
    ├── Dockerfile          # Container definition
    ├── docker-compose.yml  # GPU orchestration
    └── requirements.txt    # Python dependencies
```

### Pattern 1: Startup GPU Verification

**What:** Verify GPU availability at service startup, fail fast if unavailable
**When to use:** Any GPU-dependent service where CPU fallback is unacceptable
**Example:**
```python
# Source: Project PITFALLS.md V1.3-2
import torch

@app.on_event("startup")
async def verify_gpu():
    if not torch.cuda.is_available():
        raise RuntimeError(
            "GPU not available - check Docker --gpus flag and NVIDIA Container Toolkit"
        )
    device_name = torch.cuda.get_device_name(0)
    vram_mb = torch.cuda.get_device_properties(0).total_memory / 1024 / 1024
    print(f"[reverb] GPU verified: {device_name} ({vram_mb:.0f}MB)")
```

### Pattern 2: GPU Lock for VRAM Protection

**What:** Use asyncio lock to serialize GPU operations and prevent OOM
**When to use:** Consumer GPUs (8GB VRAM) with memory-hungry models
**Example:**
```python
# Source: Project implementation plan
import asyncio

gpu_lock = asyncio.Lock()

@app.post("/ensemble")
async def ensemble_endpoint(req: EnsembleRequest):
    async with gpu_lock:
        verbatim = transcribe(audio, verbatimicity=1.0)
        clean = transcribe(audio, verbatimicity=0.0)
    return {"verbatim": verbatim, "clean": clean}
```

### Pattern 3: CORS for Browser Access

**What:** Configure CORSMiddleware with explicit localhost origins including file:// protocol
**When to use:** Any backend serving browser clients
**Example:**
```python
# Source: FastAPI CORS documentation
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://localhost:8080",
        "http://127.0.0.1",
        "http://127.0.0.1:8080",
        "null",  # file:// protocol sends "null" as origin
    ],
    allow_credentials=False,  # Required when using explicit origins
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)
```

### Pattern 4: CTM Parsing with Dynamic Field Count

**What:** Parse CTM format handling variable field counts and default confidence
**When to use:** Processing Reverb ASR output
**Example:**
```python
# Source: Phase 0 verification results
FILLERS = {'um', 'uh', 'er', 'ah', 'mm', 'hmm', 'hm'}

def parse_ctm(ctm_text: str) -> list[dict]:
    """
    CTM format: <file> <channel> <start> <duration> <word> [<confidence>]
    Phase 0 verified: 6 fields present but confidence always 0.00
    """
    words = []
    for line in ctm_text.strip().split('\n'):
        parts = line.split()
        if len(parts) < 5:
            continue

        word_text = parts[4]
        start = float(parts[2])
        duration = float(parts[3])

        # Default confidence since CTM values are 0.00
        conf = 0.7 if word_text.lower() in FILLERS else 0.9

        words.append({
            "word": word_text,
            "start_time": start,
            "end_time": start + duration,
            "confidence": conf
        })
    return words
```

### Anti-Patterns to Avoid

- **Testing CORS with curl only:** CORS is browser-enforced; curl bypasses it entirely. Always test with actual browser fetch calls.
- **Assuming GPU access without verification:** Container starts successfully but inference silently runs on CPU (10-20x slower).
- **Loading model per request:** Model load takes ~5 seconds; must load once at startup.
- **Using `allow_origins=["*"]` with credentials:** Does not work; must specify explicit origins if using credentials.
- **Expecting meaningful CTM confidence:** Phase 0 verified all values are 0.00; use defaults based on word type.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP API framework | Custom socket server | FastAPI | Battle-tested, automatic docs, Pydantic validation |
| GPU memory management | Manual tensor cleanup | asyncio.Lock + empty_cache() | Prevents OOM on consumer GPUs |
| CORS handling | Custom headers | CORSMiddleware | Handles preflight OPTIONS, all edge cases |
| Audio format conversion | Custom parsers | ffmpeg (if needed) | Handles all formats, battle-tested |
| Model loading | Custom download | wenet.load_model() | Handles HuggingFace auth, caching |
| Container GPU access | Runtime flags only | Docker Compose deploy.resources | Declarative, version-controlled |

**Key insight:** Docker GPU access has multiple failure modes (missing toolkit, wrong CUDA version, WSL2 issues). Use explicit verification at startup rather than trusting configuration.

## Common Pitfalls

### Pitfall 1: Docker GPU Access Silent Failure (CRITICAL)

**What goes wrong:** Container starts successfully, model loads, but inference runs on CPU instead of GPU. No error thrown - just 10-20x slower inference.

**Why it happens:**
- Missing `--gpus` flag or deploy.resources in docker-compose
- NVIDIA Container Toolkit not installed
- CUDA version mismatch between image and host drivers
- WSL2-specific GPU passthrough not configured

**How to avoid:**
1. Add explicit GPU check at startup (see Pattern 1 above)
2. Include GPU reservation in docker-compose.yml
3. Test inference speed immediately (should be >3x realtime)
4. Check nvidia-smi shows GPU activity during transcription

**Warning signs:**
- Inference taking >0.5x realtime (1 min audio > 2 min processing)
- `torch.cuda.is_available()` returns False inside container
- nvidia-smi shows 0% GPU utilization during transcription

### Pitfall 2: VRAM Exhaustion on Long Audio (CRITICAL)

**What goes wrong:** Model loads fine, short clips transcribe successfully, but longer recordings (>3-5 minutes) cause CUDA OOM errors.

**Why it happens:**
- ASR model memory grows with audio length
- CTC decoder accumulates hidden states
- PyTorch memory allocator fragments VRAM

**How to avoid:**
1. Implement chunked processing: split audio into 60-90 second segments with 1-2 second overlap
2. Set `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`
3. Call `torch.cuda.empty_cache()` between chunks
4. Add request timeout (60s) to prevent blocking
5. Use GPU lock to serialize requests

**Warning signs:**
- First few transcriptions succeed, then random failures
- `CUDA out of memory` errors in logs
- Service becoming unresponsive after processing long files

### Pitfall 3: CORS Blocking Browser Requests (MODERATE)

**What goes wrong:** FastAPI server running, health check passes via curl, but browser JavaScript gets CORS policy errors.

**Why it happens:**
- CORS is browser-enforced, not server-enforced
- Default CORSMiddleware is restrictive
- file:// protocol sends "null" as origin
- Docker networking adds complexity

**How to avoid:**
1. Configure explicit CORS origins including "null" for file:// protocol
2. Set `allow_credentials=False` when using broad origins
3. Test with actual browser, not just curl
4. Check browser DevTools Network tab for preflight OPTIONS failures

**Warning signs:**
- curl works, browser doesn't
- `Access-Control-Allow-Origin` errors in console
- Health check shows "offline" despite service running

### Pitfall 4: CTM Parsing Assumptions (MODERATE)

**What goes wrong:** Parser assumes 5-field CTM format but Reverb outputs 6 fields. Or assumes confidence values are meaningful but they're always 0.00.

**Why it happens:**
- CTM format has variations across tools
- Documentation may not match actual output
- Phase 0 verified Reverb's actual output differs from generic CTM docs

**How to avoid:**
1. Parse by minimum required fields, not exact positions
2. Treat confidence=0.00 as "unknown" (use type-based defaults)
3. Validate against actual Reverb output, not documentation assumptions

**Warning signs:**
- IndexError during parsing
- All words showing identical confidence
- Word text appearing in wrong field

## Code Examples

Verified patterns from Phase 0 testing and official documentation:

### Complete FastAPI Server Structure

```python
# Source: Project implementation plan (verified Phase 0)
"""
Reverb ASR HTTP API Server
Endpoints:
  POST /ensemble - Dual-pass (v=1.0 + v=0.0)
  GET  /health   - Health check with GPU status
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import asyncio
import base64
import tempfile
import os
import torch
import wenet

app = FastAPI(title="Reverb ASR Service")

# CORS for browser access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost", "http://localhost:8080",
                   "http://127.0.0.1", "http://127.0.0.1:8080", "null"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

# GPU lock for VRAM protection
gpu_lock = asyncio.Lock()

# Model singleton
_model = None

def get_model():
    global _model
    if _model is None:
        _model = wenet.load_model("reverb_asr_v1")
    return _model

@app.on_event("startup")
async def startup():
    # Verify GPU before loading model
    if not torch.cuda.is_available():
        raise RuntimeError("GPU not available")
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    get_model()

# ... endpoint implementations ...
```

### Health Endpoint with GPU Info

```python
# Source: Requirements BACK-03, BACK-04
@app.get("/health")
async def health():
    gpu_info = None
    if torch.cuda.is_available():
        gpu_info = {
            "name": torch.cuda.get_device_name(0),
            "memory_mb": torch.cuda.get_device_properties(0).total_memory // 1024 // 1024,
            "memory_used_mb": torch.cuda.memory_allocated(0) // 1024 // 1024
        }
    return {
        "status": "ok" if _model else "loading",
        "model_loaded": _model is not None,
        "gpu": gpu_info
    }
```

### Ensemble Endpoint

```python
# Source: Requirements BACK-02, BACK-05
class EnsembleRequest(BaseModel):
    audio_base64: str

class Word(BaseModel):
    word: str
    start_time: float
    end_time: float
    confidence: float

@app.post("/ensemble")
async def ensemble(req: EnsembleRequest):
    try:
        audio = base64.b64decode(req.audio_base64)
    except Exception as e:
        raise HTTPException(400, f"Invalid base64: {e}")

    async with gpu_lock:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(audio)
            temp_path = f.name

        try:
            model = get_model()

            # Pass 1: Verbatim (v=1.0)
            verbatim_ctm = model.transcribe(temp_path, verbatimicity=1.0, format="ctm")
            verbatim_words = parse_ctm(verbatim_ctm)

            # Pass 2: Clean (v=0.0)
            clean_ctm = model.transcribe(temp_path, verbatimicity=0.0, format="ctm")
            clean_words = parse_ctm(clean_ctm)

            # Clear GPU memory
            torch.cuda.empty_cache()

            return {
                "verbatim": {
                    "words": verbatim_words,
                    "transcript": " ".join(w["word"] for w in verbatim_words),
                    "verbatimicity": 1.0
                },
                "clean": {
                    "words": clean_words,
                    "transcript": " ".join(w["word"] for w in clean_words),
                    "verbatimicity": 0.0
                }
            }
        finally:
            os.unlink(temp_path)
```

### docker-compose.yml with GPU

```yaml
# Source: Docker Compose GPU documentation
version: '3.8'
services:
  reverb:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8765:8765"
    volumes:
      - reverb-cache:/root/.cache  # Model cache persistence
    environment:
      - PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    restart: unless-stopped

volumes:
  reverb-cache:
```

### Dockerfile

```dockerfile
# Source: STACK.md, verified patterns
FROM pytorch/pytorch:2.4.0-cuda11.8-cudnn9-runtime

# System dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    git \
    git-lfs \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

RUN git lfs install

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Reverb ASR
RUN pip install --no-cache-dir rev-reverb==0.1.0

# Pre-download model (optional - can also download at runtime)
RUN python -c "import wenet; wenet.load_model('reverb_asr_v1')" || echo "Model will download at runtime"

COPY server.py .

EXPOSE 8765
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8765"]
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| nvidia-docker | NVIDIA Container Toolkit | 2022 | Use `deploy.resources.reservations.devices` in compose |
| FastAPI <0.100 with Pydantic v1 | FastAPI >=0.115 with Pydantic v2 | 2023 | Different validation patterns, v1 deprecated |
| Manual GPU flags | Docker Compose GPU support | 2023 | Declarative GPU reservation in compose files |

**Deprecated/outdated:**
- nvidia-docker: Replaced by NVIDIA Container Toolkit
- Pydantic v1: Incompatible with FastAPI 0.115+
- `@app.on_event("startup")`: Will be deprecated in favor of lifespan in future FastAPI versions (still works in 0.115)

## Open Questions

Things that need validation during implementation:

1. **Optimal chunk size for long audio**
   - What we know: 60-90s is suggested; 8GB VRAM is limit
   - What's unclear: Exact size before OOM; overlap strategy
   - Recommendation: Test with 5+ minute recordings in Phase 20 verification

2. **Reverb Turbo/INT8 variant**
   - What we know: Mentioned in paper as smaller model
   - What's unclear: Availability, installation method
   - Recommendation: Use standard model; Turbo is optimization for later

3. **WSL2-specific GPU configuration**
   - What we know: GPU passthrough works differently in WSL2
   - What's unclear: Teacher's exact environment (native Linux vs WSL2)
   - Recommendation: Document both paths in startup instructions

## Sources

### Primary (HIGH confidence)

- [Reverb ASR GitHub](https://github.com/revdotcom/reverb) - Installation, verbatimicity parameter, CLI usage
- [rev-reverb PyPI](https://pypi.org/project/rev-reverb/) - Version 0.1.0, Python 3.10+ requirement
- [FastAPI CORS Documentation](https://fastapi.tiangolo.com/tutorial/cors/) - CORSMiddleware configuration
- [Docker Compose GPU Support](https://docs.docker.com/compose/how-tos/gpu-support/) - deploy.resources.reservations.devices syntax
- [PyTorch Docker Images](https://hub.docker.com/r/pytorch/pytorch) - CUDA 11.8/12.x variants
- Project Phase 0 verification (2026-02-05) - CTM format, verbatimicity behavior confirmed

### Secondary (MEDIUM confidence)

- [Reverb arXiv Paper](https://arxiv.org/html/2410.03930) - Table 5 verbatimicity behavior, 200k hours training
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) - Docker GPU setup
- [CTM Format Specification](https://www.researchgate.net/figure/Fields-in-the-CTM-format_tbl5_267954055) - `<file> <channel> <start> <duration> <word> [<confidence>]`

### Tertiary (LOW confidence - Needs Validation)

- GPU VRAM usage for Reverb model (~1.6GB estimated) - Measure during implementation
- Optimal audio chunk size - Requires testing with real long recordings

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Reverb 0.1.0 verified in Phase 0; FastAPI/Docker patterns well-documented
- Architecture: HIGH - Patterns verified in existing project research
- Pitfalls: HIGH - GPU silent failure and CORS issues documented in project PITFALLS.md

**Research date:** 2026-02-05
**Valid until:** ~60 days (stable stack, no expected breaking changes)
