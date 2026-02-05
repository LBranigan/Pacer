"""
Reverb ASR HTTP API Server

Endpoints:
  POST /ensemble - Dual-pass transcription (v=1.0 verbatim + v=0.0 clean)
  POST /deepgram - Deepgram Nova-3 transcription proxy (cross-validation)
  GET  /health   - Health check with GPU status and model info

Requirements:
  - NVIDIA GPU with CUDA support
  - Docker with NVIDIA Container Toolkit
  - 8GB+ VRAM recommended for long audio
  - DEEPGRAM_API_KEY environment variable (optional, for /deepgram endpoint)
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
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

# CORS Configuration (critical for browser access)
# Allow all origins — this is a local dev service running in Docker,
# accessed from file:// (origin "null"), localhost, or 127.0.0.1
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

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
        "deepgram_configured": get_deepgram_client() is not None
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
async def ensemble(req: EnsembleRequest):
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

    async with gpu_lock:
        # Write to temp file (wenet requires file path)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(audio)
            temp_path = f.name

        try:
            model = get_model()

            # Pass 1: Verbatim (v=1.0) - preserves disfluencies
            # attention_rescoring mode: CTC beam search + attention decoder rescoring
            # Returns real per-word confidence scores (attention log-softmax probs)
            # ~20-50% slower but more accurate transcription + real confidence
            verbatim_ctm = model.transcribe(temp_path, verbatimicity=1.0, format="ctm",
                                            mode="attention_rescoring")
            verbatim_words = parse_ctm(verbatim_ctm)

            # Pass 2: Clean (v=0.0) - removes disfluencies
            clean_ctm = model.transcribe(temp_path, verbatimicity=0.0, format="ctm",
                                         mode="attention_rescoring")
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
async def deepgram_transcribe(req: DeepgramRequest):
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
