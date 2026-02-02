# External Integrations

**Analysis Date:** 2026-02-02

## APIs & External Services

**Speech Recognition:**
- Google Cloud Speech-to-Text API v1
  - Purpose: Convert audio (microphone recording or uploaded files) into verbatim transcripts with word-level confidence, timing, and alternative hypotheses
  - SDK/Client: REST API via browser Fetch API (no SDK)
  - Auth: API key authentication (user-provided)
  - Endpoint: `https://speech.googleapis.com/v1/speech:recognize?key={API_KEY}`
  - Configuration file reference: `orf_assessment.html` lines 163-165

## Data Storage

**Databases:**
- None - Stateless application

**File Storage:**
- None - Completely client-side, no persistence layer
- Audio blobs are processed in memory and sent directly to Google Cloud
- Results are displayed in browser memory only

**Caching:**
- None - Each request is fresh

## Authentication & Identity

**Auth Provider:**
- Google Cloud (via API key)
  - Implementation: User provides GCP API key manually via form input (`#apiKey`)
  - API key handling: Stored in DOM, not persisted to localStorage
  - Scope: Speech-to-Text API v1 endpoint access
  - Reference: `orf_assessment.html` lines 40-41, 130-131, 164

**Planned Enhancement:**
- Save API key in localStorage (not yet implemented) - See PLAN.md Phase 4

## Monitoring & Observability

**Error Tracking:**
- None - Errors logged to UI status field only

**Logs:**
- Status messages displayed in DOM element `#status`
- Error messages from API returned to user via `setStatus()` function
- No external logging or telemetry

## CI/CD & Deployment

**Hosting:**
- Client-side static file
- No server required
- Can be served from:
  - Local filesystem (double-click to open)
  - Any HTTP/HTTPS server (e.g., GitHub Pages, S3, Firebase Hosting)
  - Email attachment or file sharing

**CI Pipeline:**
- None - Single .html file, no build or deployment automation

## Environment Configuration

**Required env vars:**
- Google Cloud API Key (not an environment variable - user input via form)

**Secrets location:**
- Not stored - User must provide API key each session
- Future plan: Store in browser localStorage (Phase 4)

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- One-way requests to Google Cloud Speech-to-Text API
- No callback/webhook mechanism used

## Request/Response Format

**Google Cloud Request:**
- Method: POST
- Content-Type: application/json
- Body structure (from `orf_assessment.html` lines 146-160):
  ```json
  {
    "config": {
      "encoding": "[WEBM_OPUS|LINEAR16|FLAC|OGG_OPUS|MP3]",
      "languageCode": "en-US",
      "model": "latest_long",
      "useEnhanced": true,
      "enableAutomaticPunctuation": false,
      "enableSpokenPunctuation": false,
      "enableWordTimeOffsets": true,
      "enableWordConfidence": true,
      "maxAlternatives": 2,
      "speechContexts": [{"phrases": [...], "boost": 5}]
    },
    "audio": {
      "content": "<base64-encoded audio data>"
    }
  }
  ```

**Google Cloud Response:**
- Format: JSON
- Key fields parsed:
  - `results[].alternatives[].transcript` - Full text transcription
  - `results[].alternatives[].words[]` - Word array with confidence and timing
  - `error.message` - Error details if API call fails
- Response parsing: `orf_assessment.html` lines 167-169, 184-231

## API Rate Limiting & Quotas

**Constraints:**
- Synchronous endpoint limit: ~1 minute of audio per request
- speechContexts: Max 500 phrases, 100 characters per phrase (documented in PLAN.md)
- Standard Google Cloud API quotas apply (depends on project tier)

**Future Workaround:**
- Switch to `longrunningrecognize` async endpoint for longer passages (planned Phase 1)

## Audio Encoding Details

**Supported Formats:**
- WAV → LINEAR16 encoding
- FLAC → FLAC encoding
- OGG → OGG_OPUS encoding
- MP3 → MP3 encoding
- WebM → WEBM_OPUS encoding
- Microphone recording → WEBM_OPUS encoding

Reference: `orf_assessment.html` lines 119-126

---

*Integration audit: 2026-02-02*
