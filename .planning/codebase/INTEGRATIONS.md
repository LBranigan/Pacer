# External Integrations

**Analysis Date:** 2026-02-18

## APIs & External Services

**ASR / Transcription:**
- Reverb ASR (rev-reverb) - Dual-pass verbatim/clean transcription for disfluency detection
  - Access: Local Docker container via `http://localhost:8765/ensemble`
  - Client: `js/reverb-api.js`
  - Auth: None (local), or Bearer token via `ORF_AUTH_TOKEN` env var
- Parakeet TDT 0.6B v2 (NVIDIA NeMo, English-only) - Primary correctness engine, sub-second word timestamps
  - Access: Same backend at `http://localhost:8765/parakeet`
  - Client: `js/parakeet-api.js`
  - Auth: Same Bearer token as above
  - Requires: `nemo_toolkit[asr]` installed on backend host
- Deepgram Nova-3 - Alternative secondary ASR engine (optional)
  - Access: Proxied via backend at `http://localhost:8765/deepgram` (no direct browser CORS)
  - Client: `js/deepgram-api.js`
  - Auth: `DEEPGRAM_API_KEY` env var on backend

**Google Cloud AI:**
- Google Cloud Vision API - Book page OCR (`DOCUMENT_TEXT_DETECTION`)
  - Endpoint: `https://vision.googleapis.com/v1/images:annotate?key={apiKey}`
  - Client: `js/ocr-api.js` (`extractTextFromImage`, `extractTextHybrid`)
  - Auth: GCP API key entered by user in UI, stored in localStorage
- Google Cloud Natural Language API - POS tagging, entity detection, proper noun classification
  - Endpoints: `https://language.googleapis.com/v1/documents:analyzeSyntax`, `analyzeEntities`
  - Client: `js/nl-api.js` (`analyzePassageText`)
  - Auth: Same GCP API key as Vision
  - Caching: Results cached in `sessionStorage` with text hash key

**Google Gemini:**
- Gemini 2.0 Flash (`gemini-2.0-flash`) - OCR text assembly and artifact correction
  - Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={key}`
  - Client: `js/ocr-api.js` (`assembleWithGemini`, `correctWithGemini`)
  - Auth: Gemini API key entered by user in UI
- Gemini 2.5 Flash TTS (`gemini-2.5-flash-preview-tts`) - Movie Trailer voiceover synthesis
  - Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent`
  - Client: `js/movie-trailer.js` (`callGeminiTTS`)
  - Auth: Same Gemini API key
  - Voice: `Charon` (deep/authoritative narrator)
- Gemini 2.5 Flash TTS - Rhythm Remix DJ intro ("Study Beats FM")
  - Client: `js/rhythm-remix.js`
  - Auth: `orf_gemini_key` from localStorage
  - Voice: `Kore`

**Dictionary:**
- Free Dictionary API - Guards proper noun forgiveness (distinguishes common words from exotic names)
  - Endpoint: `https://api.dictionaryapi.dev/api/v2/entries/en/{word}`
  - Client: inline in `js/app.js` (~line 1692, `isCommonDictionaryWord()`)
  - Auth: None (public API)
  - Caching: Responses cached in `sessionStorage` (key: `dict_{word}`)

## Data Storage

**Primary Data Store:**
- localStorage (`orf_data`) - Student roster and assessment results
  - Schema: `{ version: 6, students: [], assessments: [] }`
  - Versioned with migration path v1→v6
  - Client: `js/storage.js`

**Audio Storage:**
- IndexedDB (`orf_audio` database, `blobs` object store) - Audio blobs per assessment
  - Client: `js/audio-store.js`
  - Keys: assessment IDs

**NL API Cache:**
- sessionStorage - NL API passage annotations keyed by text hash
  - Client: `js/nl-api.js`

**File Storage:**
- None (no server-side file storage; audio stays in browser IndexedDB)

**Caching:**
- Service Worker Cache (`orf-v72`) - Offline-capable PWA shell cache
  - Config: `sw.js`
  - Strategy: cache-first with runtime caching for GET requests
  - Bypasses: `googleapis.com` URLs, `backend-config.json`

## Authentication & Identity

**Auth Provider:**
- None (no user authentication)
- API keys entered manually by teacher/admin in the UI, stored in localStorage
- Backend auth: optional Bearer token (`ORF_AUTH_TOKEN` / `orf_backend_token`) for protecting the Docker backend when exposed over a tunnel

## Voice Activity Detection

**Silero VAD (ONNX):**
- Runtime: `onnxruntime-web@1.22.0` (WASM, loaded from jsDelivr CDN)
- Wrapper: `@ricky0123/vad-web@0.0.29` (loaded from jsDelivr CDN)
- Client: `js/vad-processor.js`
- Purpose: Ghost word detection — flags ASR-reported words in segments VAD identifies as silence

## Monitoring & Observability

**Error Tracking:**
- None (no external error tracking service)

**Logs:**
- `console.warn` / `console.log` with `[module-name]` prefixes throughout pipeline
- `js/debug-logger.js` — optional structured debug logging module

## CI/CD & Deployment

**Hosting:**
- GitHub Pages (`https://lbranigan.github.io`) — static HTML/JS/CSS
- No build step; source files deployed directly

**CI Pipeline:**
- None detected

**Backend Deployment:**
- Docker container (`services/reverb/Dockerfile`) with NVIDIA GPU runtime
- Start scripts: `start_services.sh` (Linux), `start_services.bat` (Windows)
- Model cache persisted in Docker named volume `reverb-cache`
- Base image: `pytorch/pytorch:2.4.0-cuda11.8-cudnn9-runtime`

## Environment Configuration

**Required env vars (backend Docker container):**
- `HF_TOKEN` - HuggingFace token for Reverb/Parakeet model download
- `DEEPGRAM_API_KEY` - Optional; enables `/deepgram` proxy endpoint
- `ORF_AUTH_TOKEN` - Optional; enables Bearer token auth on all endpoints
- `ORF_CORS_ORIGINS` - Optional; overrides default allowed CORS origins

**Required user config (localStorage / UI input):**
- GCP API key (Google Cloud Vision + Natural Language APIs)
- Gemini API key (OCR hybrid, Movie Trailer, Rhythm Remix DJ)
- Backend URL (auto-populated from `backend-config.json` on non-localhost)

**Secrets location:**
- `env.js` (gitignored) — dev-only API key file, never committed
- Docker: env vars passed via `docker-compose.yml` environment section

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None

---

*Integration audit: 2026-02-18*
