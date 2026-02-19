# Technology Stack

**Analysis Date:** 2026-02-18

## Languages

**Primary:**
- JavaScript (ES2022+) - All frontend pipeline logic, UI, API clients (`js/`)
- Python 3.x - Backend ASR service (`services/reverb/server.py`)

**Secondary:**
- HTML5 - Application pages (`index.html`, `rhythm-remix.html`, `dashboard.html`, `report.html`, `playback.html`, `maze.html`, `illustrator.html`, `orf_assessment.html`)
- CSS3 - Styling (`style.css`, `css/rhythm-remix.css`, `css/student-playback.css`, `css/maze.css`, `css/illustrator.css`)

## Runtime

**Frontend:**
- Browser (no build step — raw ES modules loaded directly via `type="module"`)
- Service Worker (`sw.js`, cache name `orf-v72`) — cache-first PWA strategy

**Backend:**
- Python with uvicorn ASGI server on port 8765
- CUDA 11.8 + PyTorch 2.4.0 (GPU required for Reverb/Parakeet models)
- Containerized via Docker

**Package Manager:**
- pip (Python backend)
- No Node.js / npm — frontend has no build toolchain

**Lockfile:**
- `services/reverb/requirements.txt` (pinned versions for some packages)

## Frameworks

**Backend:**
- FastAPI >= 0.115.0 - HTTP API server for ASR services
- uvicorn >= 0.30.0 - ASGI runner
- slowapi >= 0.1.9 - Rate limiting middleware

**Frontend:**
- No framework — vanilla JS ES modules throughout
- PWA with Web App Manifest (`manifest.json`)

**Build/Dev:**
- No build step — source files served directly
- Cache busting via `?v=` query strings on ES module imports
- `start_services.sh` / `start_services.bat` — shell scripts to start Docker backend

## Key Dependencies

**Critical (Python backend):**
- `rev-reverb==0.1.0` - Reverb ASR model (dual-pass verbatim/clean transcription)
- `nemo_toolkit[asr]>=2.2` - NVIDIA NeMo for Parakeet TDT 0.6B v2 local ASR (English-only; v2 preferred over v3 for better English WER)
- `deepgram-sdk>=5.0.0,<6.0.0` - Deepgram Nova-3 API client (proxied from backend)
- `torch==2.4.0` + `torchaudio==2.4.0` (CUDA 11.8) - GPU tensor computation
- `wenet` - CTC alignment (imported directly in `server.py`)

**Critical (Frontend CDN):**
- `onnxruntime-web@1.22.0` - ONNX runtime for Silero VAD model inference
- `@ricky0123/vad-web@0.0.29` - Silero VAD wrapper for browser speech detection

**Data:**
- `data/cmudict-phoneme-counts.json` (1.6MB, 125,940 words) - CMUdict phoneme count lookup for word speed normalization

## Configuration

**Environment (Docker backend):**
- `DEEPGRAM_API_KEY` - Deepgram Nova-3 API key (optional, enables `/deepgram` endpoint)
- `HF_TOKEN` - HuggingFace token for model download
- `ORF_AUTH_TOKEN` - Bearer token for backend auth (optional)
- `ORF_CORS_ORIGINS` - Comma-separated allowed origins override
- `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` - GPU memory tuning

**Frontend (localStorage keys):**
- `orf_backend_url` - Backend URL (default `http://localhost:8765`)
- `orf_backend_token` - Bearer auth token
- `orf_gemini_key` - Gemini API key (used by Rhythm Remix DJ intro)
- `orf_data` - Student/assessment data (JSON, versioned schema v1-v6)

**Frontend (user-entered on page):**
- Google Cloud API Key (GCP) - used for Vision OCR and Natural Language API
- Gemini API Key - used for OCR hybrid assembly, Movie Trailer TTS, Rhythm Remix DJ

**Build:**
- `backend-config.json` - Auto-written by `start_services.bat` with backend URL + token; fetched by `js/backend-config.js` on non-localhost origins
- `env.js` - Gitignored file with API keys for local dev (never committed)

## Platform Requirements

**Development:**
- Modern browser with ES module support (Chrome, Firefox, Safari, Edge)
- NVIDIA GPU with CUDA 11.8+ support for local ASR backend
- Docker with NVIDIA Container Toolkit
- 8GB+ VRAM recommended

**Production:**
- Hosted as static files on GitHub Pages (`https://lbranigan.github.io`)
- Backend (Docker container) must be separately deployed and tunneled for remote access
- Backend port: 8765 (uvicorn)

---

*Stack analysis: 2026-02-18*
