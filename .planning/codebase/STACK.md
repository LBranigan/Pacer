# Technology Stack

**Analysis Date:** 2026-02-06

## Languages

**Primary:**
- JavaScript (ES6+ modules) - All frontend code in `js/` directory
- Python 3.x - Backend ASR service (`services/reverb/server.py`)

**Secondary:**
- HTML5 - Progressive Web App interface (`index.html`, `dashboard.html`, `report.html`, `playback.html`)
- CSS3 - Styling (`css/` directory)

## Runtime

**Environment:**
- Browser (client-side): Modern browsers with ES6 module support, IndexedDB, MediaRecorder API
- Python server: uvicorn ASGI server with FastAPI
- WSL2/Linux: Reverb ASR service runs in WSL with conda environment

**Package Manager:**
- Python: pip (no `package.json` - browser-native JavaScript with CDN dependencies)
- Lockfile: No lockfile detected (requirements.txt specifies version ranges)

## Frameworks

**Core:**
- FastAPI >=0.115.0 - Python backend HTTP API for ASR services
- Vanilla JavaScript (ES6 modules) - No frontend framework, native browser APIs

**Testing:**
- None detected - no test framework configuration found

**Build/Dev:**
- Python `http.server` - Development web server (port 8080)
- uvicorn[standard] >=0.30.0 - ASGI server for FastAPI backend
- Docker - Container runtime for Reverb ASR service (Dockerfile present)

## Key Dependencies

**Critical:**
- `rev-reverb==0.1.0` - Reverb ASR Python SDK (verbatim transcription with disfluency detection)
- `deepgram-sdk>=5.0.0,<6.0.0` - Deepgram Nova-3 Python SDK (cross-validation transcription)
- `python-multipart>=0.0.9` - FastAPI multipart form data support
- `torch` (PyTorch 2.4.0 with CUDA 11.8) - GPU-accelerated ASR inference
- `wenet` - WeNet ASR model loader for Reverb

**Frontend (CDN):**
- `diff_match_patch` (20121119) - Sequence alignment for reference vs transcript comparison (`js/alignment.js`)
- `onnxruntime-web@1.22.0` - WASM runtime for ONNX models
- `@ricky0123/vad-web@0.0.29` - Silero VAD for ghost word detection (`js/vad-processor.js`)

**Infrastructure:**
- `fastapi.middleware.cors` - CORS support for browser access from file:// or localhost
- Browser APIs: MediaRecorder, IndexedDB, localStorage, sessionStorage, FileReader, Web Audio API

## Configuration

**Environment:**
- `.env` file in `services/reverb/` (contains `DEEPGRAM_API_KEY` and `HF_TOKEN`)
- API keys stored in `keys/` directory (GoogSTT API key.txt, deepgram-api-key.txt, hugface token.txt)
- User-provided Google Cloud API key via browser input (`index.html` line 24)

**Build:**
- No build step - JavaScript served directly as ES6 modules
- Docker: `services/reverb/Dockerfile` - PyTorch base image with CUDA support
- Conda environment: `/home/brani/miniconda3/envs/reverb` for Python dependencies

## Platform Requirements

**Development:**
- Windows with WSL2 (current deployment pattern)
- NVIDIA GPU with CUDA 11.8+ support (8GB+ VRAM recommended)
- Docker with NVIDIA Container Toolkit
- Python 3.x with conda/miniconda
- Modern browser (Chrome, Edge, Firefox) with ES6 module support

**Production:**
- Browser-based PWA (installable via `manifest.json`)
- Requires local Reverb ASR service running on localhost:8765
- Requires local web server (Python http.server or equivalent) on port 8080
- GPU acceleration required for Reverb ASR performance

---

*Stack analysis: 2026-02-06*
