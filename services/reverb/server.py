"""
Reverb ASR HTTP API Server

Endpoints:
  POST /ensemble - Dual-pass transcription (v=1.0 verbatim + v=0.0 clean)
  POST /deepgram - Deepgram Nova-3 transcription proxy (cross-validation)
  POST /parakeet - Parakeet TDT 0.6B v2 local transcription (cross-validation)
  GET  /health   - Health check with GPU status and model info

Requirements:
  - NVIDIA GPU with CUDA support
  - Docker with NVIDIA Container Toolkit
  - 8GB+ VRAM recommended for long audio
  - DEEPGRAM_API_KEY environment variable (optional, for /deepgram endpoint)
  - nemo_toolkit[asr] (optional, for /parakeet endpoint)
"""

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
import asyncio
import base64
import tempfile
import os
import torch
import wenet
from deepgram import DeepgramClient

# =============================================================================
# Application Setup
# =============================================================================

app = FastAPI(
    title="Reverb ASR Service",
    description="Dual-pass ASR with verbatimicity control for disfluency detection",
    version="1.0.0"
)

# CORS Configuration — allow GitHub Pages + local dev origins.
# ORF_CORS_ORIGINS env var can override (comma-separated list).
_default_origins = [
    "https://lbranigan.github.io",
    "http://localhost:8080",
    "http://localhost:3000",
    "http://127.0.0.1:8080",
    "http://127.0.0.1:3000",
    "null",  # file:// origin
]
_cors_origins = os.environ.get("ORF_CORS_ORIGINS")
ALLOWED_ORIGINS = _cors_origins.split(",") if _cors_origins else _default_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# --- Request size limit middleware (25MB max) ---
MAX_BODY_SIZE = 25 * 1024 * 1024  # 25MB — covers base64-encoded audio (~15MB WAV)

class LimitBodySize(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > MAX_BODY_SIZE:
            return JSONResponse(status_code=413, content={"error": "payload too large (25MB limit)"})
        return await call_next(request)

app.add_middleware(LimitBodySize)

# --- Rate limiting (slowapi) ---
limiter = Limiter(key_func=lambda: "global")
app.state.limiter = limiter

@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(status_code=429, content={"error": "rate limit exceeded — try again shortly"})

# Optional auth token — set ORF_AUTH_TOKEN env var to require Bearer token.
# /health is always public (needed for connection testing).
AUTH_TOKEN = os.environ.get("ORF_AUTH_TOKEN")

@app.middleware("http")
async def check_auth(request: Request, call_next):
    if AUTH_TOKEN and request.url.path != "/health" and request.method != "OPTIONS":
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            print(f"[AUTH] Rejected (bad format): {request.method} {request.url.path} from {request.client.host}")
            return JSONResponse(status_code=401, content={"error": "invalid auth format — use Bearer token"})
        token = auth_header[7:]
        if token != AUTH_TOKEN:
            print(f"[AUTH] Rejected (bad token): {request.method} {request.url.path} from {request.client.host}")
            return JSONResponse(status_code=401, content={"error": "unauthorized"})
    return await call_next(request)

# =============================================================================
# GPU and Model Management
# =============================================================================

# GPU lock for VRAM protection - serializes GPU operations
gpu_lock = asyncio.Lock()

# Model singleton - loads once on first request
_model = None


def get_model():
    """Get or load the Reverb ASR model singleton."""
    global _model
    if _model is None:
        print("[reverb] Loading model reverb_asr_v1...")
        _model = wenet.load_model("reverb_asr_v1")
        print("[reverb] Model loaded successfully")
    return _model


# Deepgram client singleton - initialized lazily
_deepgram_client = None


def get_deepgram_client():
    """Get or initialize Deepgram client. Returns None if not configured."""
    global _deepgram_client
    if _deepgram_client is None:
        api_key = os.environ.get("DEEPGRAM_API_KEY")
        if not api_key:
            return None  # Graceful degradation
        _deepgram_client = DeepgramClient(api_key=api_key)
    return _deepgram_client


# Parakeet TDT model - lazy loaded on first /parakeet request
_parakeet_model = None
_parakeet_available = None


def check_parakeet_available():
    """Check if nemo_toolkit is importable (Parakeet dependency)."""
    global _parakeet_available
    if _parakeet_available is None:
        try:
            import nemo.collections.asr  # noqa: F401
            _parakeet_available = True
        except ImportError:
            _parakeet_available = False
    return _parakeet_available


def get_parakeet_model():
    """Get or load the Parakeet TDT 0.6B v2 model singleton. ~600MB VRAM.

    v2 (English-only) is used instead of v3 (multilingual) because:
      - v2 wins on 6/8 English benchmarks (LibriSpeech clean: 1.69% vs 1.93% WER)
      - v2's 1,024-token English-optimized BPE produces fewer fragmentation artifacts
        than v3's 8,192-token multilingual tokenizer
      - v3 has no way to force English-only mode and occasionally outputs non-English
        characters (NVIDIA GitHub #14799), which would corrupt the alignment pipeline
      - This tool only needs English — v3's 25-language support is unnecessary overhead
    """
    global _parakeet_model
    if _parakeet_model is None:
        import nemo.collections.asr as nemo_asr
        print("[parakeet] Loading model nvidia/parakeet-tdt-0.6b-v2...")
        _parakeet_model = nemo_asr.models.ASRModel.from_pretrained("nvidia/parakeet-tdt-0.6b-v2")
        print("[parakeet] Model loaded successfully")
    return _parakeet_model


# =============================================================================
# Startup Event (BACK-04: GPU verification)
# =============================================================================

@app.on_event("startup")
async def startup():
    """Verify GPU availability at startup. Fails fast if GPU unavailable."""
    if not torch.cuda.is_available():
        raise RuntimeError(
            "GPU not available - check Docker --gpus flag and NVIDIA Container Toolkit"
        )
    device_name = torch.cuda.get_device_name(0)
    vram_mb = torch.cuda.get_device_properties(0).total_memory / 1024 / 1024
    print(f"[reverb] GPU verified: {device_name} ({vram_mb:.0f}MB)")
    # Do NOT pre-load model here - let first request trigger load
    # This keeps startup fast and allows health checks before model is ready


# =============================================================================
# Health Endpoint (BACK-03: Health check with GPU info)
# =============================================================================

@app.get("/health")
async def health():
    """
    Health check endpoint with GPU status and model info.

    Returns:
        status: "ok" if model loaded, "ready" if waiting for first request
        model_loaded: boolean indicating if model is in memory
        gpu: GPU information (name, memory_mb, memory_used_mb) or null
    """
    gpu_info = None
    if torch.cuda.is_available():
        gpu_info = {
            "name": torch.cuda.get_device_name(0),
            "memory_mb": torch.cuda.get_device_properties(0).total_memory // 1024 // 1024,
            "memory_used_mb": torch.cuda.memory_allocated(0) // 1024 // 1024
        }
    return {
        "status": "ok" if _model else "ready",
        "model_loaded": _model is not None,
        "gpu": gpu_info,
        "deepgram_configured": get_deepgram_client() is not None,
        "parakeet_configured": check_parakeet_available()
    }


# =============================================================================
# CTM Parser (BACK-05: Word timestamps and confidence)
# =============================================================================

def parse_ctm(ctm_text: str) -> list:
    """
    Parse CTM format output from Reverb ASR.

    CTM format: <file> <channel> <start> <duration> <word> <confidence>
    With mode="attention_rescoring", confidence contains real attention decoder
    log-softmax probabilities (0.0-1.0). For multi-BPE-token words, confidence
    is the max of constituent token confidences.

    Args:
        ctm_text: Raw CTM output from model.transcribe(format="ctm")

    Returns:
        List of word dictionaries with word, start_time, end_time, confidence
    """
    words = []
    for line in ctm_text.strip().split('\n'):
        if not line.strip():
            continue
        parts = line.split()
        if len(parts) < 5:
            continue

        word_text = parts[4]
        start = float(parts[2])
        duration = float(parts[3])

        # Real confidence from attention_rescoring mode
        # Falls back to 0.0 if field missing (shouldn't happen)
        conf = float(parts[5]) if len(parts) >= 6 else 0.0

        words.append({
            "word": word_text,
            "start_time": start,
            "end_time": start + duration,
            "confidence": conf
        })
    return words


# =============================================================================
# Pydantic Models
# =============================================================================

class EnsembleRequest(BaseModel):
    """Request model for /ensemble endpoint."""
    audio_base64: str


class DeepgramRequest(BaseModel):
    """Request model for /deepgram endpoint."""
    audio_base64: str


class ParakeetRequest(BaseModel):
    """Request model for /parakeet endpoint."""
    audio_base64: str


class MazeRequest(BaseModel):
    """Request model for /deepgram-maze endpoint."""
    audio_base64: str
    keyterms: list[str]  # The 3 option words to boost


class Word(BaseModel):
    """Word with timing and confidence."""
    word: str
    start_time: float
    end_time: float
    confidence: float


# =============================================================================
# Ensemble Endpoint (BACK-02: Dual-pass transcription)
# =============================================================================

@app.post("/ensemble")
@limiter.limit("10/minute")
async def ensemble(req: EnsembleRequest, request: Request):
    """
    Dual-pass transcription with verbatimicity control.

    Pass 1: verbatimicity=1.0 preserves disfluencies (um, uh, false starts)
    Pass 2: verbatimicity=0.0 removes disfluencies (clean transcript)

    Comparing the two reveals where disfluencies occurred.

    Args:
        req: EnsembleRequest with audio_base64 (WAV file as base64 string)

    Returns:
        verbatim: Word-level transcript with disfluencies preserved
        clean: Word-level transcript with disfluencies removed
    """
    # Decode base64 audio
    try:
        audio = base64.b64decode(req.audio_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64: {e}")

    # Write to temp file outside the lock (no GPU needed)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audio)
        temp_path = f.name

    async with gpu_lock:
        try:
            # Run blocking GPU work in executor so the event loop stays responsive.
            # Without this, concurrent requests (e.g. Parakeet) can't even be accepted
            # while Reverb is transcribing, causing tunnel/client timeouts.
            loop = asyncio.get_event_loop()

            model = get_model()

            # Pass 1: Verbatim (v=1.0) - preserves disfluencies
            verbatim_ctm = await loop.run_in_executor(
                None, lambda: model.transcribe(temp_path, verbatimicity=1.0, format="ctm",
                                               mode="attention_rescoring"))
            print(f"[reverb] Raw CTM v=1.0 (verbatim):\n{verbatim_ctm}")
            verbatim_words = parse_ctm(verbatim_ctm)

            # Pass 2: Clean (v=0.0) - removes disfluencies
            clean_ctm = await loop.run_in_executor(
                None, lambda: model.transcribe(temp_path, verbatimicity=0.0, format="ctm",
                                               mode="attention_rescoring"))
            print(f"[reverb] Raw CTM v=0.0 (clean):\n{clean_ctm}")
            clean_words = parse_ctm(clean_ctm)

            # Clear GPU memory after processing
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


# =============================================================================
# Deepgram Endpoint (Cross-vendor validation)
# =============================================================================

@app.post("/deepgram")
@limiter.limit("10/minute")
async def deepgram_transcribe(req: DeepgramRequest, request: Request):
    """
    Transcribe audio using Deepgram Nova-3 via backend proxy.

    Returns normalized word-level timestamps matching project format.
    Browser cannot call Deepgram directly (no CORS support).
    """
    client = get_deepgram_client()
    if client is None:
        raise HTTPException(
            status_code=503,
            detail="Deepgram service not configured (missing DEEPGRAM_API_KEY)"
        )

    try:
        audio_bytes = base64.b64decode(req.audio_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64: {e}")

    try:
        response = client.listen.v1.media.transcribe_file(
            request=audio_bytes,
            model="nova-3",
            language="en-US",
            smart_format=True,
        )

        # Normalize to project format (matching Google STT structure)
        words = []
        for word_data in response.results.channels[0].alternatives[0].words:
            words.append({
                "word": word_data.punctuated_word or word_data.word,
                "startTime": f"{word_data.start}s",
                "endTime": f"{word_data.end}s",
                "confidence": word_data.confidence
            })

        return {
            "words": words,
            "transcript": response.results.channels[0].alternatives[0].transcript,
            "model": "nova-3"
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Deepgram error: {e}")


# =============================================================================
# Parakeet Endpoint (Local GPU cross-validation)
# =============================================================================

@app.post("/parakeet")
@limiter.limit("10/minute")
async def parakeet_transcribe(req: ParakeetRequest, request: Request):
    """
    Transcribe audio using Parakeet TDT 0.6B v2 (local GPU, English-only).

    Returns normalized word-level timestamps matching project format.
    Model lazy-loads on first request (~600MB VRAM).
    Shares gpu_lock with Reverb to prevent VRAM contention.

    Confidence is 1.0 for all words (TDT standard output doesn't expose
    per-word confidence — documented limitation).
    """
    if not check_parakeet_available():
        raise HTTPException(
            status_code=503,
            detail="Parakeet not available (nemo_toolkit[asr] not installed)"
        )

    try:
        audio_bytes = base64.b64decode(req.audio_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64: {e}")

    # Prep temp file and ffmpeg conversion outside the lock (no GPU needed)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audio_bytes)
        temp_path = f.name

    # Parakeet requires mono audio — convert with ffmpeg if needed
    import subprocess
    mono_path = temp_path.replace(".wav", "_mono.wav")
    subprocess.run(
        ["ffmpeg", "-y", "-i", temp_path, "-ac", "1", "-ar", "16000", mono_path],
        capture_output=True
    )
    if os.path.exists(mono_path):
        os.unlink(temp_path)
        temp_path = mono_path

    async with gpu_lock:
        try:
            model = get_parakeet_model()

            # Run blocking GPU work in executor so the event loop stays responsive.
            loop = asyncio.get_event_loop()
            output = await loop.run_in_executor(
                None, lambda: model.transcribe([temp_path], timestamps=True, batch_size=1))

            words = []
            transcript = ""

            # NeMo returns list of results; extract first
            if isinstance(output, list) and len(output) > 0:
                result = output[0]

                # Extract transcript text
                if hasattr(result, 'text'):
                    transcript = result.text
                elif isinstance(result, str):
                    transcript = result

                # Extract word-level timestamps from TDT output
                if hasattr(result, 'timestamp') and result.timestamp:
                    ts = result.timestamp
                    word_timestamps = ts.get('word', [])
                    for w in word_timestamps:
                        words.append({
                            "word": w.get('word', ''),
                            "startTime": f"{w.get('start', 0):.3f}s",
                            "endTime": f"{w.get('end', 0):.3f}s",
                            "confidence": 1.0
                        })

            # Fallback: if no word timestamps, split transcript into words without timing
            if not words and transcript:
                print("[parakeet] Warning: no word timestamps available, falling back to transcript-only")
                for word_text in transcript.split():
                    words.append({
                        "word": word_text,
                        "startTime": "0s",
                        "endTime": "0s",
                        "confidence": 1.0
                    })

            if not transcript and words:
                transcript = " ".join(w["word"] for w in words)

            # Clear GPU memory after processing
            torch.cuda.empty_cache()

            return {
                "words": words,
                "transcript": transcript,
                "model": "parakeet-tdt-0.6b-v2"
            }

        except Exception as e:
            import traceback
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"Parakeet error: {e}")
        finally:
            os.unlink(temp_path)


# =============================================================================
# Maze Game Endpoint (Short-audio keyterm-boosted recognition)
# =============================================================================

@app.post("/deepgram-maze")
@limiter.limit("20/minute")
async def deepgram_maze(req: MazeRequest, request: Request):
    """
    Short-audio transcription optimized for maze game.
    Uses Nova-3 keyterm prompting to boost recognition of the 3 option words.
    Expects 1-3 second audio clips (single spoken word).
    """
    client = get_deepgram_client()
    if client is None:
        raise HTTPException(
            status_code=503,
            detail="Deepgram service not configured (missing DEEPGRAM_API_KEY)"
        )

    try:
        audio_bytes = base64.b64decode(req.audio_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64: {e}")

    try:
        # keyterm (singular) is the Nova-3 API param; accepts list for multiple terms
        response = client.listen.v1.media.transcribe_file(
            request=audio_bytes,
            model="nova-3",
            language="en-US",
            smart_format=False,
            keyterm=req.keyterms,
        )

        transcript = response.results.channels[0].alternatives[0].transcript
        confidence = response.results.channels[0].alternatives[0].confidence

        print(f"[maze] Deepgram heard: '{transcript}' (conf={confidence:.2f}, options={req.keyterms})")

        return {
            "transcript": transcript,
            "confidence": confidence,
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        # Retry without keyterm boosting as fallback
        try:
            print("[maze] Retrying without keyterm boosting...")
            response = client.listen.v1.media.transcribe_file(
                request=audio_bytes,
                model="nova-3",
                language="en-US",
                smart_format=False,
            )
            transcript = response.results.channels[0].alternatives[0].transcript
            confidence = response.results.channels[0].alternatives[0].confidence
            print(f"[maze] Fallback heard: '{transcript}' (conf={confidence:.2f})")
            return {"transcript": transcript, "confidence": confidence}
        except Exception as e2:
            raise HTTPException(status_code=500, detail=f"Deepgram maze error: {e2}")
