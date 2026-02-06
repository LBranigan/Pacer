# External Integrations

**Analysis Date:** 2026-02-06

## APIs & External Services

**Speech-to-Text (Primary):**
- Reverb ASR - Local self-hosted service for verbatim transcription with disfluency detection
  - SDK/Client: `rev-reverb==0.1.0` (Python), `js/reverb-api.js` (browser)
  - Endpoint: `http://localhost:8765/ensemble` (dual-pass v=1.0 verbatim + v=0.0 clean)
  - Auth: None (local service)
  - Model: `reverb_asr_v1` via WeNet (HuggingFace model download)

**Speech-to-Text (Cross-Validation):**
- Deepgram Nova-3 - Cloud API for cross-validation against Reverb
  - SDK/Client: `deepgram-sdk>=5.0.0,<6.0.0` (Python), `js/deepgram-api.js` (browser)
  - Endpoint: `http://localhost:8765/deepgram` (proxy through local backend)
  - Auth: `DEEPGRAM_API_KEY` environment variable
  - Direct API: Not used (browser cannot call Deepgram directly due to CORS)

**Speech-to-Text (Legacy):**
- Google Cloud Speech-to-Text - Historical integration, still present in code but replaced by Kitchen Sink pipeline
  - SDK/Client: Direct REST API calls via `fetch()` in `js/stt-api.js`
  - Endpoints: `https://speech.googleapis.com/v1/speech:recognize`, `https://speech.googleapis.com/v1/speech:longrunningrecognize`
  - Auth: User-provided API key via browser input (stored in `keys/GoogSTT API key.txt`)
  - Models: `latest_long` (primary), `default` (confidence oracle in ensemble mode)
  - Status: Code present but Kitchen Sink pipeline (`runKitchenSinkPipeline()`) is now default

**Natural Language API:**
- Google Cloud Natural Language API - Syntax and entity analysis for passage text
  - SDK/Client: Direct REST API calls via `fetch()` in `js/nl-api.js`
  - Endpoints: `https://language.googleapis.com/v1/documents:analyzeSyntax`, `https://language.googleapis.com/v1/documents:analyzeEntities`
  - Auth: Same Google Cloud API key as STT
  - Purpose: POS tagging, proper noun detection, word tier classification (sight/academic/function/proper)
  - Caching: sessionStorage by text hash

**OCR:**
- Google Cloud Vision API - Text extraction from photographed book pages
  - SDK/Client: Direct REST API calls via `fetch()` in `js/ocr-api.js`
  - Endpoint: `https://vision.googleapis.com/v1/images:annotate`
  - Auth: Same Google Cloud API key as STT
  - Features: `DOCUMENT_TEXT_DETECTION`
  - Usage: Optional - allows photographing passage instead of manual typing

**Voice Activity Detection:**
- Silero VAD - Ghost word detection (hallucinated words where ASR heard speech but VAD detected silence)
  - SDK/Client: `@ricky0123/vad-web@0.0.29` via CDN (ONNX model via WASM)
  - Endpoint: Browser-local inference (no API calls)
  - Auth: None
  - Integration: `js/vad-processor.js` processes audio blobs to flag ghost words

## Data Storage

**Databases:**
- None - all storage is browser-local

**Client Storage:**
- localStorage - Student records and assessment metadata
  - Key: `orf_data` (JSON object with version, students[], assessments[])
  - Implementation: `js/storage.js`
- IndexedDB - Audio blob storage for playback
  - Database: `orf_audio`, Store: `blobs`
  - Implementation: `js/audio-store.js`
- sessionStorage - NL API response caching
  - Keys: `nl_<hash>` (passage text hash)
  - Implementation: `js/nl-api.js`

**File Storage:**
- Local filesystem only - no cloud storage
- API keys stored in `keys/` directory (not committed to git)

**Caching:**
- Service Worker - PWA offline support
  - Implementation: `sw.js`
  - Registration: `js/app.js` line 32-36
- sessionStorage - NL API response caching (see above)

## Authentication & Identity

**Auth Provider:**
- None - single-user local application

**API Key Management:**
- Google Cloud API key (user-provided via browser input)
  - Input: `index.html` line 24 (`#apiKey` field)
  - Stored: Browser DOM only (not persisted)
  - Backup storage: `keys/GoogSTT API key.txt` (local file, not accessed by code)
- Deepgram API key (server-side environment variable)
  - Variable: `DEEPGRAM_API_KEY` in `services/reverb/.env`
  - Access: Backend only (`services/reverb/server.py`)
- HuggingFace token (server-side environment variable)
  - Variable: `HF_TOKEN` for model download
  - Access: Docker git config at build time
  - Storage: `services/reverb/.env`

## Monitoring & Observability

**Error Tracking:**
- Console logging only (`console.log`, `console.warn`, `console.error`, `console.table`)
- No external error tracking service

**Logs:**
- Browser console - client-side operations
- Python uvicorn stdout - server-side ASR operations
- Debug logger: `js/debug-logger.js` (in-memory diagnostic log, not sent externally)

## CI/CD & Deployment

**Hosting:**
- Local development server (`python -m http.server 8080`)
- PWA installable via `manifest.json` (runs from browser cache)

**CI Pipeline:**
- None - no automated testing or deployment

**Deployment Process:**
- Manual: Run `start_services.bat` (Windows) or `start_services.sh` (Linux)
  1. Starts Reverb ASR service in WSL via conda environment
  2. Starts Python http.server on port 8080
  3. Opens browser to `http://localhost:8080/index.html`

## Environment Configuration

**Required env vars (backend):**
- `DEEPGRAM_API_KEY` - Deepgram Nova-3 API key (optional, for cross-validation)
- `HF_TOKEN` - HuggingFace token for Reverb model download

**Required user input (frontend):**
- Google Cloud API key (entered in browser UI, not persisted)

**Secrets location:**
- `services/reverb/.env` - Backend environment variables (DEEPGRAM_API_KEY, HF_TOKEN)
- `keys/` directory - Local API key backups (not accessed by code, manual reference only)
- Note: `.env` and `keys/` are NOT committed to git (.gitignore entry assumed)

## Webhooks & Callbacks

**Incoming:**
- None - no webhook endpoints

**Outgoing:**
- None - no webhook calls to external services

## Model Downloads

**HuggingFace:**
- Reverb ASR model (`reverb_asr_v1`) downloaded on first request
  - Auth: `HF_TOKEN` environment variable
  - Client: `wenet.load_model()` in `services/reverb/server.py`
  - Storage: HuggingFace cache directory (managed by `wenet` library)

**ONNX Models:**
- Silero VAD model downloaded by `@ricky0123/vad-web` on first use
  - Auth: None (public CDN)
  - Storage: Browser cache

---

*Integration audit: 2026-02-06*
