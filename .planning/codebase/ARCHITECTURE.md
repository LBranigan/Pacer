# Architecture

**Analysis Date:** 2026-02-06

## Pattern Overview

**Overall:** Pipeline-based data flow architecture with multi-stage ASR processing

**Key Characteristics:**
- Kitchen Sink pipeline combining multiple ASR sources (Reverb + Deepgram)
- Sequence alignment for disfluency detection and cross-validation
- Browser-based SPA with backend microservices for GPU-intensive ASR
- Event-driven UI updates with modular rendering
- LocalStorage persistence with IndexedDB for audio blobs

## Layers

**Presentation Layer:**
- Purpose: User interface rendering and interaction handling
- Location: `index.html`, `js/ui.js`, `style.css`, `playback.html`
- Contains: DOM manipulation, event handlers, result visualization
- Depends on: Application layer for data, metrics layer for calculations
- Used by: End users (teachers/students)

**Application Layer:**
- Purpose: Core orchestration and business logic
- Location: `js/app.js` (main orchestrator, ~1800 lines)
- Contains: Pipeline coordination, state management, feature flag control
- Depends on: All service modules (STT, alignment, diagnostics, storage)
- Used by: UI layer

**ASR Services Layer:**
- Purpose: Speech-to-text transcription via multiple engines
- Location: `js/reverb-api.js`, `js/deepgram-api.js`, `js/kitchen-sink-merger.js`, `services/reverb/`
- Contains: HTTP clients for ASR APIs, dual-pass transcription (verbatim + clean), cross-validation logic
- Depends on: Backend services (Docker container at localhost:8765)
- Used by: Application layer

**Alignment & Analysis Layer:**
- Purpose: Word-level alignment, disfluency detection, error classification
- Location: `js/alignment.js`, `js/sequence-aligner.js`, `js/disfluency-tagger.js`, `js/diagnostics.js`
- Contains: Needleman-Wunsch algorithm, diff-match-patch integration, near-miss resolution, struggle detection
- Depends on: Word equivalences, NL API for linguistic analysis
- Used by: Application layer, metrics layer

**Metrics Layer:**
- Purpose: Fluency metrics computation (WCPM, accuracy)
- Location: `js/metrics.js`
- Contains: WCPM calculation, accuracy computation, error breakdown
- Depends on: Alignment results
- Used by: Application layer, UI layer

**Utilities Layer:**
- Purpose: Cross-cutting concerns and helper functions
- Location: `js/word-equivalences.js`, `js/text-normalize.js`, `js/nl-api.js`, `js/phonetic-utils.js`, `js/miscue-registry.js`
- Contains: Canonical word forms, text normalization, POS tagging, Levenshtein distance
- Depends on: External APIs (Google NL API)
- Used by: All layers

**Persistence Layer:**
- Purpose: Data storage and retrieval
- Location: `js/storage.js`, `js/audio-store.js`
- Contains: LocalStorage CRUD for students/assessments, IndexedDB for audio blobs
- Depends on: Browser storage APIs
- Used by: Application layer

**Backend Services:**
- Purpose: GPU-accelerated ASR processing
- Location: `services/reverb/server.py`
- Contains: Reverb ASR model (WeNet), Deepgram API proxy, dual-pass transcription
- Depends on: CUDA, Docker, NVIDIA Container Toolkit
- Used by: ASR services layer

## Data Flow

**Assessment Recording Flow:**

1. User clicks Record button → `js/recorder.js` captures audio via MediaRecorder API
2. Audio blob stored in `appState.audioBlob` → Analyze button enabled
3. User clicks Analyze → `js/app.js` orchestrates pipeline
4. VAD processing (optional) → `js/vad-processor.js` detects speech segments
5. Kitchen Sink pipeline invoked → `js/kitchen-sink-merger.js`
6. Reverb dual-pass transcription → `js/reverb-api.js` → `services/reverb/server.py`
   - v=1.0 (verbatim): includes disfluencies
   - v=0.0 (clean): disfluencies removed
7. Sequence alignment → `js/sequence-aligner.js` (Needleman-Wunsch)
8. Disfluency tagging → `js/disfluency-tagger.js` (fillers, repetitions, false starts)
9. Deepgram cross-validation → `js/deepgram-api.js` → `services/reverb/server.py` (proxy)
10. Merged words array created with disfluency and cross-validation metadata
11. Word-level alignment → `js/alignment.js` (diff-match-patch)
12. Omission recovery → unconsumed Deepgram words matched to reference gaps
13. Near-miss resolution → `js/diagnostics.js` resolves struggle clusters
14. Diagnostics → `js/diagnostics.js` detects hesitations, pauses, morphological errors
15. Metrics computation → `js/metrics.js` calculates WCPM, accuracy
16. Results stored → `js/storage.js` (LocalStorage), `js/audio-store.js` (IndexedDB)
17. UI rendering → `js/ui.js` displays alignment, confidence view, disfluencies

**State Management:**
- Centralized in `appState` object in `js/app.js`
- Properties: `audioBlob`, `audioEncoding`, `elapsedSeconds`, `referenceIsFromOCR`, `selectedStudentId`
- No reactive framework - direct DOM manipulation

**OCR Flow (Optional):**

1. User uploads book page image → `js/file-handler.js`
2. Image resized if >2048px → `js/ocr-api.js`
3. Google Vision API called → text extracted
4. Text inserted into reference passage textarea

## Key Abstractions

**Kitchen Sink Result:**
- Purpose: Unified output from multi-engine ASR pipeline
- Examples: `kitchenSinkResult` in `js/app.js`, returned by `runKitchenSinkPipeline()`
- Pattern: Contains `mergedWords`, `disfluencyStats`, `unconsumedDeepgram`, `verbatim`, `clean`, `deepgram`

**Alignment Entry:**
- Purpose: Represents word-level comparison between reference and transcript
- Examples: Output of `alignWords()` in `js/alignment.js`
- Pattern: `{ ref: string|null, hyp: string|null, type: 'correct'|'substitution'|'omission'|'insertion', compound?: boolean }`

**Merged Word:**
- Purpose: Single word with timestamps, confidence, disfluency flags, cross-validation status
- Examples: Elements in `mergedWords` array throughout pipeline
- Pattern:
  ```javascript
  {
    word: string,
    startTime: string,  // "1.234s"
    endTime: string,
    confidence: number,
    isDisfluency: boolean,
    disfluencyType: 'filler'|'repetition'|'false_start'|null,
    crossValidation: 'confirmed'|'disagreed'|'unconfirmed'|'unavailable',
    _deepgramStartTime: string,
    _reverbStartTime: string,
    _reverbCleanStartTime: string,
    _vadAnalysis: object
  }
  ```

**Diagnostic Result:**
- Purpose: Detected reading issues (hesitations, pauses, morphological errors, struggles)
- Examples: Output of `runDiagnostics()` in `js/diagnostics.js`
- Pattern: Array of objects with `{ type: string, wordIndex: number, gap?: number, severity?: string }`

**Assessment Record:**
- Purpose: Persisted student assessment with full metadata
- Examples: Stored by `saveAssessment()` in `js/storage.js`
- Pattern:
  ```javascript
  {
    id: string,
    studentId: string,
    date: ISO8601,
    wcpm: number,
    accuracy: number,
    errorBreakdown: object,
    alignment: array,
    sttWords: array,
    audioRef: string,
    gamification: object,
    nlAnnotations: array
  }
  ```

## Entry Points

**Main Application:**
- Location: `index.html` → loads `js/app.js` as ES module
- Triggers: Page load
- Responsibilities: Initialize app, register service worker, set up event listeners

**Service Worker:**
- Location: `sw.js`
- Triggers: Registered on first page load
- Responsibilities: PWA support, offline caching

**Backend Service:**
- Location: `services/reverb/server.py`
- Triggers: Started via `start_services.bat` (Windows) or direct Docker command
- Responsibilities: FastAPI server on localhost:8765, ASR endpoints (/ensemble, /deepgram, /health)

**Student Playback:**
- Location: `playback.html`
- Triggers: Opened in popup window from "Watch Your Reading Adventure!" button
- Responsibilities: Animated gamified playback of assessment results

**Dashboard:**
- Location: Referenced by `js/dashboard.js`, opened via "Dashboard" button
- Triggers: User navigation from history section
- Responsibilities: Student progress visualization, celeration charts

## Error Handling

**Strategy:** Graceful degradation with fallbacks

**Patterns:**
- ASR service unavailable → fallback to alternative engine (Reverb fails → Deepgram-only)
- API key missing → disable optional features (OCR, NL API)
- Storage full → warn user but continue session
- Network timeout → retry with exponential backoff (not implemented, fail fast)
- Invalid audio format → display user-friendly error message
- Reference text missing → skip alignment, show raw transcription only

**Error propagation:**
- Backend services return `null` on failure → caller checks and falls back
- UI layer displays errors via `setStatus()` and result boxes
- Debug logger (`js/debug-logger.js`) captures full pipeline state for troubleshooting

## Cross-Cutting Concerns

**Logging:**
- Console logging throughout (`console.log`, `console.warn`, `console.error`)
- Debug logger in `js/debug-logger.js` captures pipeline stages
- VAD calibration logs in `js/vad-processor.js`

**Validation:**
- Input sanitization in `js/text-normalize.js`
- API key presence checks before external calls
- Audio format validation in recorder/file handler
- Student name trimming and deduplication in `js/storage.js`

**Authentication:**
- No user authentication system
- API keys stored in localStorage (Google Cloud API key for Vision/NL APIs)
- Backend Deepgram key in `.env` file (not committed)

**Caching:**
- Service worker caches static assets
- NL API results cached in sessionStorage (keyed by text hash)
- Audio blobs stored in IndexedDB for playback
- VAD calibration results persisted in localStorage

**Feature Flags:**
- Kitchen Sink enabled by default (`localStorage.getItem('orf_use_kitchen_sink') !== 'false'`)
- Dev mode toggle for VAD threshold controls (`#devModeToggle` button)

---

*Architecture analysis: 2026-02-06*
