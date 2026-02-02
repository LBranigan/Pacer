# Architecture

**Analysis Date:** 2026-02-02

## Pattern Overview

**Overall:** Client-side single-page application (SPA) with external API integration

**Key Characteristics:**
- Monolithic single-file HTML/CSS/JavaScript application
- Browser-native Web APIs for audio capture and processing
- Direct HTTP integration with Google Cloud Speech-to-Text REST API
- Stateless processing model: record/upload → send to STT → display results
- No backend server, no database, no state persistence

## Layers

**Presentation Layer:**
- Purpose: UI rendering, user input collection, results display
- Location: `orf_assessment.html` (lines 7-72, CSS + HTML markup)
- Contains: HTML structure, CSS styling for buttons/inputs/result boxes, display methods
- Depends on: JavaScript function calls (displayResults, setStatus)
- Used by: User directly through browser

**Audio Acquisition Layer:**
- Purpose: Capture audio from microphone or accept file uploads
- Location: `orf_assessment.html` (lines 79-127, functions: startRecording, stopRecording, handleFile)
- Contains: WebRTC MediaRecorder API, file input handling, audio encoding detection
- Depends on: Web Audio API, File API, MediaRecorder API
- Used by: Main application controller

**Audio Preparation & Encoding Layer:**
- Purpose: Convert audio blob to Base64 for API transmission
- Location: `orf_assessment.html` (lines 176-182, function: blobToBase64)
- Contains: FileReader API, Base64 encoding conversion
- Depends on: JavaScript Blob/FileReader APIs
- Used by: STT integration layer

**Context Building Layer:**
- Purpose: Extract reference passage words and prepare speech contexts for API
- Location: `orf_assessment.html` (lines 136-144, inline in sendToSTT function)
- Contains: Text parsing, word deduplication, speech context array construction
- Depends on: Reference passage textarea input
- Used by: STT API payload construction

**STT Integration Layer:**
- Purpose: Format and send request to Google Cloud Speech-to-Text API, handle response
- Location: `orf_assessment.html` (lines 129-174, function: sendToSTT)
- Contains: API configuration object assembly, HTTP fetch, error handling, response parsing
- Depends on: Google Cloud STT API endpoint, user API key
- Used by: Application controller (triggered on record stop or file upload)

**Results Processing & Display Layer:**
- Purpose: Transform API response into displayable format with confidence visualization
- Location: `orf_assessment.html` (lines 184-232, function: displayResults)
- Contains: Result aggregation, word confidence color coding, JSON serialization
- Depends on: STT API response data structure
- Used by: Presentation layer (DOM updates)

## Data Flow

**Recording Path:**
1. User clicks "Record" button
2. `startRecording()` requests microphone permission via getUserMedia
3. MediaRecorder captures audio as WEBM/Opus chunks
4. User clicks "Stop", mediaRecorder fires `onstop` event
5. Audio chunks assembled into Blob
6. Blob + encoding ("WEBM_OPUS") passed to `sendToSTT()`

**Upload Path:**
1. User selects file via file input
2. `handleFile()` extracts file extension and maps to encoding (WAV→LINEAR16, FLAC→FLAC, etc.)
3. File blob + detected encoding passed to `sendToSTT()`

**STT Processing Path:**
1. `sendToSTT()` validates API key presence
2. Blob converted to Base64 via `blobToBase64()`
3. Reference passage extracted from textarea, unique words collected
4. Speech contexts array built (if passage provided)
5. API payload assembled with config + Base64 audio
6. HTTP POST to `https://speech.googleapis.com/v1/speech:recognize`
7. Response JSON parsed
8. On success, `displayResults()` called
9. On error, error message set via `setStatus()`

**Results Display Path:**
1. `displayResults()` iterates over STT results
2. Each result's primary alternative transcript extracted
3. Word details (confidence, timestamps) extracted
4. Color-coded span elements created (high/mid/low confidence classes)
5. Plain text transcript concatenated
6. JSON structure with word array + alternative transcripts serialized
7. Three output boxes populated: colored words, plain text, JSON

**State Management:**
- Recording state: `recording` boolean, `timerInterval` reference, `audioChunks` array
- UI state: button text, CSS classes, timer display
- All state is ephemeral (session-based, no persistence)

## Key Abstractions

**Config Object:**
- Purpose: Encapsulate Google Cloud STT API configuration parameters
- Examples: Lines 147-158 in orf_assessment.html
- Pattern: Declarative object with encoding, languageCode, model, feature flags (enableWordTimeOffsets, enableWordConfidence, etc.), speechContexts array

**Word Object (from API):**
- Purpose: Represent a single recognized word with metadata
- Structure: `{ word: string, confidence: number, startTime: string, endTime: string }`
- Used by: displayResults for confidence-based coloring and tooltip generation

**Result Object (API Response):**
- Purpose: Structure Google Cloud STT response with utterance-level data
- Structure: `{ results: [{ alternatives: [{ transcript: string, words: Array<WordObject> }] }] }`
- Pattern: Array of results (one per utterance), each with alternatives array

**Speech Context Array:**
- Purpose: Encode passage-aware vocabulary boosting for STT
- Structure: `[{ phrases: string[], boost: number }]`
- Pattern: Dynamic construction from reference passage textarea, with static boost value of 5

## Entry Points

**Browser Load:**
- Location: `orf_assessment.html` (entire file)
- Triggers: User opens file in browser or double-clicks HTML file
- Responsibilities: Page load, CSS application, form initialization, event handler attachment

**Record Button Click:**
- Location: `orf_assessment.html` (line 52, onclick="toggleRecord()")
- Triggers: User clicks "Record" button
- Responsibilities: Toggle recording state, start/stop MediaRecorder, update UI timer

**File Upload:**
- Location: `orf_assessment.html` (line 56, onchange="handleFile(event)")
- Triggers: User selects file from file input
- Responsibilities: Detect file type, map to encoding, initiate STT call

**STT Response Processing:**
- Location: `orf_assessment.html` (function displayResults, called from sendToSTT line 169)
- Triggers: Successful API response reception
- Responsibilities: Parse word-level data, color-code by confidence, render three output formats

## Error Handling

**Strategy:** Graceful degradation with user-visible status messages

**Patterns:**

1. **Microphone Access Denial:**
   - Location: Line 105-106
   - Caught: try/catch around getUserMedia
   - Response: Set status message "Microphone access denied: [error]"

2. **Missing API Key:**
   - Location: Line 131
   - Check: Trim and validate apiKey input
   - Response: Set status "Please enter your API key."

3. **API Error Response:**
   - Location: Line 168
   - Check: data.error object present in response
   - Response: Set status "API Error: [error message]"

4. **Network Request Failure:**
   - Location: Line 171-172
   - Caught: try/catch around fetch
   - Response: Set status "Request failed: [error message]"

5. **No Speech Detected:**
   - Location: Line 190-192
   - Check: Empty results array
   - Response: Display "No speech detected." in result box

## Cross-Cutting Concerns

**Logging:**
- Approach: User-visible status messages via `setStatus()` function (line 77)
- Status updates: recording start, file upload progress, STT processing, completion, errors
- No server-side logging or debugging output

**Validation:**
- API key: Non-empty string check before API call (line 131)
- File selection: Handled implicitly by file input accept attribute (line 56: .wav,.flac,.ogg,.mp3,.webm)
- Audio encoding: Mapped from file extension, with fallback to ENCODING_UNSPECIFIED (line 123-124)

**Authentication:**
- Approach: User-provided Google Cloud API key passed as URL parameter
- Implementation: Stored in DOM input field, injected into API URL as query parameter (line 164)
- Security model: Client-side only, no token refresh, no session management

---

*Architecture analysis: 2026-02-02*
