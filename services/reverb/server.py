"""
Reverb ASR HTTP API Server

Endpoints:
  POST /ensemble - Dual-pass transcription (v=1.0 verbatim + v=0.0 clean)
  GET  /health   - Health check with GPU status and model info

Requirements:
  - NVIDIA GPU with CUDA support
  - Docker with NVIDIA Container Toolkit
  - 8GB+ VRAM recommended for long audio
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

# =============================================================================
# Application Setup
# =============================================================================

app = FastAPI(
    title="Reverb ASR Service",
    description="Dual-pass ASR with verbatimicity control for disfluency detection",
    version="1.0.0"
)

# CORS Configuration (critical for browser access)
# file:// protocol sends "null" as origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://localhost:8080",
        "http://127.0.0.1",
        "http://127.0.0.1:8080",
        "null",  # file:// protocol sends "null" as origin
    ],
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
        "gpu": gpu_info
    }


# =============================================================================
# CTM Parser (BACK-05: Word timestamps and confidence)
# =============================================================================

# Filler words for confidence defaults
FILLERS = {'um', 'uh', 'er', 'ah', 'mm', 'hmm', 'hm'}


def parse_ctm(ctm_text: str) -> list:
    """
    Parse CTM format output from Reverb ASR.

    CTM format: <file> <channel> <start> <duration> <word> [<confidence>]
    Phase 0 verified: 6 fields present but confidence always 0.00
    Use type-based defaults instead.

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

        # Default confidence: 0.7 for fillers, 0.9 for content words
        # (CTM confidence from Reverb is always 0.00)
        conf = 0.7 if word_text.lower() in FILLERS else 0.9

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
            verbatim_ctm = model.transcribe(temp_path, verbatimicity=1.0, format="ctm")
            verbatim_words = parse_ctm(verbatim_ctm)

            # Pass 2: Clean (v=0.0) - removes disfluencies
            clean_ctm = model.transcribe(temp_path, verbatimicity=0.0, format="ctm")
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
