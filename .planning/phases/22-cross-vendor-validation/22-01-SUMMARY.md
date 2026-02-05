---
phase: 22-cross-vendor-validation
plan: 01
subsystem: api
tags: [deepgram, nova-3, asr, cross-validation, fastapi]

# Dependency graph
requires:
  - phase: 20-reverb-backend-service
    provides: FastAPI server.py with /health and /ensemble endpoints
provides:
  - /deepgram endpoint for Nova-3 transcription proxy
  - Deepgram SDK integration with lazy initialization
  - Health endpoint deepgram_configured status
affects: [23-kitchen-sink-integration, js/deepgram-api.js]

# Tech tracking
tech-stack:
  added: [deepgram-sdk>=3.0.0]
  patterns: [lazy-client-initialization, graceful-degradation-503]

key-files:
  created: []
  modified:
    - services/reverb/server.py
    - services/reverb/requirements.txt
    - services/reverb/docker-compose.yml

key-decisions:
  - "Lazy Deepgram client initialization allows service to start without API key"
  - "Missing API key returns 503 (not 500) for graceful degradation"
  - "Response format normalized to Google STT structure (startTime/endTime with 's' suffix)"

patterns-established:
  - "Lazy client pattern: get_deepgram_client() returns None if not configured, caller handles gracefully"
  - "Proxy endpoint pattern: Browser sends base64 audio to backend, backend calls external API"

# Metrics
duration: 2min
completed: 2026-02-05
---

# Phase 22 Plan 01: Deepgram Backend Proxy Summary

**Deepgram Nova-3 proxy endpoint added to Reverb backend for cross-vendor ASR validation with lazy client initialization and graceful 503 on missing API key**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-05T18:00:52Z
- **Completed:** 2026-02-05T18:02:24Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Added /deepgram endpoint that accepts base64 audio and returns normalized word-level timestamps
- Integrated Deepgram SDK v3 with lazy initialization (service starts without API key)
- Updated /health endpoint to report deepgram_configured status
- Configured docker-compose to pass DEEPGRAM_API_KEY from host environment

## Task Commits

Each task was committed atomically:

1. **Task 1: Add deepgram-sdk to requirements.txt** - `0466782` (chore)
2. **Task 2: Add DEEPGRAM_API_KEY to docker-compose.yml** - `6b66f07` (chore)
3. **Task 3: Add /deepgram endpoint and update /health** - `2275bf1` (feat)

## Files Created/Modified
- `services/reverb/requirements.txt` - Added deepgram-sdk>=3.0.0 dependency
- `services/reverb/docker-compose.yml` - Added DEEPGRAM_API_KEY environment passthrough
- `services/reverb/server.py` - Added /deepgram endpoint, DeepgramClient singleton, updated /health

## Decisions Made
- **Lazy initialization:** Deepgram client initializes on first request, not at startup. This allows the service to start and serve /health and /ensemble even without a Deepgram API key.
- **503 vs 500:** Missing API key returns HTTP 503 (Service Unavailable) rather than 500 (Internal Server Error). This signals the service is configured correctly but the external dependency is not available.
- **Response normalization:** Deepgram response is normalized to match project word format (startTime/endTime with "s" suffix, matching Google STT structure).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

**External service requires manual configuration:**
- Create Deepgram account at https://console.deepgram.com/
- Generate API key: Settings -> API Keys -> Create Key
- Set environment variable before running docker-compose:
  ```bash
  export DEEPGRAM_API_KEY=$(cat keys/deepgram-api-key.txt)
  # OR add to .env file
  ```

## Next Phase Readiness
- Backend /deepgram endpoint ready for browser client integration
- Next: js/deepgram-api.js client to call the proxy endpoint
- Integration test after docker container rebuild with new requirements

---
*Phase: 22-cross-vendor-validation*
*Completed: 2026-02-05*
