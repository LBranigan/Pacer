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
