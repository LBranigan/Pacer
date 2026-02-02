# Coding Conventions

**Analysis Date:** 2026-02-02

## Naming Patterns

**Files:**
- Single file application: `orf_assessment.html` (HTML/CSS/JS combined)
- Kebab-case for multi-word filenames: `orf_assessment`, not `orfAssessment`
- Document files use UPPERCASE: `PLAN.md`, `SETTINGS.md`

**Functions:**
- Camel case for all functions: `toggleRecord()`, `startRecording()`, `stopRecording()`, `handleFile()`, `sendToSTT()`, `blobToBase64()`, `displayResults()`, `setStatus()`
- Action-based naming: prefixes like `toggle`, `start`, `stop`, `handle`, `send`, `display`, `set`
- Single responsibility implied by name clarity

**Variables:**
- Camel case throughout: `mediaRecorder`, `audioChunks`, `recording`, `timerInterval`, `seconds`, `apiKey`, `passageText`, `speechContexts`, `allWords`, `plainParts`, `altTranscripts`, `base64`, `blob`, `encoding`
- Boolean flags use clear state names: `recording` (not `isRecording`)
- DOM element references: `wordsDiv`, `plainDiv`, `jsonDiv` (descriptive suffixes indicating element type)

**Types/Constants:**
- Encoding map uses UPPERCASE keys: `LINEAR16`, `FLAC`, `OGG_OPUS`, `WEBM_OPUS`, `MP3`
- Configuration fields use lowercase: `config`, `encoding`, `languageCode`, `enableAutomaticPunctuation`
- Confidence level thresholds hard-coded with clear intent: `0.9` and `0.7`

## Code Style

**Formatting:**
- No explicit formatter configured (Prettier/ESLint not in use)
- Tabs and spaces: appears to use spaces (2-3 char indentation in JavaScript)
- HTML uses consistent 2-space indentation (lines 7-72)
- JavaScript uses consistent indentation (lines 75-233)
- Single-line style preferred where practical: `recording ? stopRecording() : startRecording()`

**Linting:**
- No linting configuration detected (no `.eslintrc`, `eslint.config.js`)
- No automated linting applied (relies on manual consistency)

## Import Organization

**Not applicable** - Single file application with no module imports. All code resides in `<script>` tag in `orf_assessment.html` (lines 74-233).

**Path Aliases:**
- Not used - no build system or module resolution configured

## Error Handling

**Patterns:**
- **Try-catch blocks** for async operations: `startRecording()` (lines 83-108) wraps `getUserMedia()` in try-catch
  ```javascript
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // ... recording setup
  } catch (e) {
    setStatus('Microphone access denied: ' + e.message);
  }
  ```

- **API error response checking**: `sendToSTT()` (lines 129-174) checks for error object in response
  ```javascript
  if (data.error) {
    setStatus('API Error: ' + data.error.message);
    return;
  }
  ```

- **Validation before operations**: `handleFile()` (lines 119-127) validates file exists before processing
  ```javascript
  if (!file) return;
  ```

- **User-facing status messages** via `setStatus()` (line 77) function replaces error logging with UI feedback

- **Fallback/default values** in data extraction: `parseFloat(w.startTime?.replace('s','')) || 0` (line 207) provides `0` if time not available

## Logging

**Framework:** No logging library - `console` methods not used. All feedback goes through UI status messages.

**Patterns:**
- **Status messages** replace logging: `setStatus()` function (line 77) updates DOM element `#status` (line 59) with user-facing messages
- **Incremental feedback**:
  - Recording start: "Recording..."
  - Upload start: "Uploading {filename}..."
  - API call: "Sending to Google Cloud STT..."
  - Success: "Done."
  - Error: "API Error: {message}" or "Request failed: {message}"

## Comments

**When to Comment:**
- **Architectural decisions documented in SETTINGS.md** not inline (see `SETTINGS.md` for detailed rationale on each STT configuration)
- **Minimal inline comments** - code is self-documenting through function and variable names
- **No commented-out code** detected

**JSDoc/TSDoc:**
- Not used - no TypeScript, no JSDoc annotations
- Single-file context makes function purpose clear from usage

## Function Design

**Size:**
- **Small, focused functions**: Most functions 5-20 lines
  - `toggleRecord()` - 1 line (line 80)
  - `setStatus()` - 1 line (line 77)
  - `stopRecording()` - 6 lines (lines 110-117)
  - `handleFile()` - 8 lines (lines 119-127)
  - `blobToBase64()` - 5 lines (lines 176-182)

- **Medium functions** for complex operations:
  - `startRecording()` - 26 lines (lines 83-108) with clear subsections
  - `sendToSTT()` - 45 lines (lines 129-174) with logical blocks
  - `displayResults()` - 49 lines (lines 184-232) with separate data gathering and rendering

**Parameters:**
- **Minimal parameter passing**: Most functions take 0-2 parameters
- **Event-driven**: Many functions receive event objects implicitly: `toggleRecord()` called from button click
- **Document reference**: Functions access DOM elements via `getElementById()` rather than passing element references

**Return Values:**
- **Async functions return Promises**: `startRecording()`, `sendToSTT()`, `blobToBase64()`
- **Void functions** for UI updates: `toggleRecord()`, `setStatus()`, `displayResults()`
- **Boolean functions for state**: `recording` is a flag variable, not a function return

## Module Design

**Exports:**
- Not applicable - single file with global scope
- All functions in global scope accessible from HTML event handlers: `onclick="toggleRecord()"`, `onchange="handleFile(event)"`
- DOM elements selected by ID as the primary interface: `document.getElementById('apiKey')`, `document.getElementById('status')`

**Barrel Files:**
- Not applicable - no modular structure

---

*Convention analysis: 2026-02-02*
