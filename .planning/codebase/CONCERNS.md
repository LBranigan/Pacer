# Codebase Concerns

**Analysis Date:** 2026-02-02

## Security Issues

**API Key Exposure in Client-Side Code:**
- Issue: API key is entered directly into the HTML form and sent via client-side JavaScript to Google Cloud. The API key is visible in the browser and can be intercepted or logged in browser history/network logs.
- Files: `orf_assessment.html` (lines 40-42, 130-131, 164)
- Impact: Anyone with access to the browser (or network monitoring) can extract the API key and make unauthorized API calls, incurring charges or accessing private data
- Fix approach: Implement a backend proxy server that holds the API key securely. Frontend sends audio to the proxy, which authenticates using the backend-held credentials and forwards the request to Google Cloud
- Priority: High - this is a critical security flaw for production use

**API Key Persistence in localStorage (Planned Feature):**
- Issue: Phase 4 plans to "Save API key in localStorage" (PLAN.md line 66). Storing API keys in browser storage is a security anti-pattern
- Files: `PLAN.md` (line 66), future implementation in `orf_assessment.html`
- Impact: Compromised browser or stolen device exposes the API key persistently
- Fix approach: Do not implement localStorage for API keys. Instead: (1) Use OAuth2 flow for user authentication, (2) backend maintains per-user API credentials, (3) frontend authenticates via session token
- Priority: High - block this feature from being implemented

**API Error Messages Expose Service Details:**
- Issue: API error messages are displayed directly to the user (line 168: `data.error.message`), which may leak internal Google Cloud error details
- Files: `orf_assessment.html` (line 168)
- Impact: Information disclosure; attackers can use error messages to probe for valid API keys or learn about backend configuration
- Fix approach: Log full errors server-side; show generic messages to users ("An error occurred. Please try again.")
- Priority: Medium

## Performance Bottlenecks

**Synchronous STT Endpoint Limited to ~1 Minute Audio:**
- Issue: Current implementation uses `v1/speech:recognize` which is synchronous and caps at ~1 minute of audio (SETTINGS.md line 62). ORF assessments can run longer than this
- Files: `orf_assessment.html` (line 164), PLAN.md (line 42)
- Impact: Passages longer than ~60 seconds will fail silently or truncate. This blocks assessment of longer reading passages
- Fix approach: Implement `longrunningrecognize` endpoint with polling via `operations.get` (async). Phase 1 task already identified (PLAN.md line 42) but not yet implemented
- Priority: High - blocks core feature for longer passages

**Base64 Encoding of Entire Audio in Memory:**
- Issue: `blobToBase64()` (line 176-181) loads the entire audio file into memory and converts it to base64, which inflates size by ~33%
- Files: `orf_assessment.html` (lines 176-181)
- Impact: Large audio files (>10MB) may cause memory issues on low-end devices; network payload is larger than necessary
- Fix approach: When switching to async endpoint, use streaming request bodies instead of base64 strings. For synchronous endpoint, set a file size limit (e.g., 10MB)
- Priority: Medium

**Speech Context Array Construction Inefficiency:**
- Issue: Line 140 uses regex and multiple array operations (`toLowerCase`, `replace`, `split`, `filter`) to build speech contexts. For large passages, this is done synchronously on every request
- Files: `orf_assessment.html` (lines 139-143)
- Impact: Large passages (e.g., >5000 words) will cause UI lag during the speech contexts extraction
- Fix approach: Debounce or defer the passage processing. For long passages, consider caching processed contexts
- Priority: Low - only affects edge cases with very large passages

## Fragile Areas

**No Error Recovery for Failed API Calls:**
- Issue: `sendToSTT()` function (lines 129-174) catches errors but doesn't retry. If the API call fails due to transient network issues, the user must re-record/re-upload
- Files: `orf_assessment.html` (lines 171-173)
- Impact: Poor UX on unreliable networks; users lose their recording if a temporary network blip occurs
- Fix approach: Implement exponential backoff retry logic (3 retries with increasing delays). Store audio in memory until successful transmission
- Priority: Medium

**Missing Input Validation:**
- Issue: API key input (line 130) only checks for empty string with `.trim()`. No validation that it's a valid API key format
- Files: `orf_assessment.html` (line 130)
- Impact: Invalid keys fail at API call time with poor error messaging. No early feedback to user
- Fix approach: Add client-side validation for API key format (should be alphanumeric + underscore, 40+ chars). Show validation error before attempting API call
- Priority: Low - not critical but improves UX

**Recording State Not Properly Cleaned Up on Errors:**
- Issue: `startRecording()` sets `recording = true` and adds event listeners, but if `getUserMedia()` fails (line 84-106), the UI state is not reset and listeners may remain attached
- Files: `orf_assessment.html` (lines 83-107)
- Impact: If microphone is denied, the "Record" button stays in recording state, causing confusion
- Fix approach: Reset UI state (button text, classes) in the catch block before displaying error
- Priority: Low

**No Handling of Empty/Silent Audio:**
- Issue: `displayResults()` checks if `data.results` is empty (line 190) but doesn't distinguish between silence and actual error. No metadata about audio duration is available to diagnose why transcription failed
- Files: `orf_assessment.html` (lines 184-232)
- Impact: When a child is too quiet or background noise blocks speech, user sees "No speech detected" with no guidance on how to fix it
- Fix approach: Log the raw API response. Add diagnostics to show audio duration, confidence scores from what WAS recognized, suggestions (move away from noise, speak louder)
- Priority: Medium

## Known Bugs

**Timer Not Reset on Successful Upload:**
- Issue: When a file is uploaded instead of recorded (line 119-127), the timer (line 53) is never reset, so it displays the last recording time even though a different audio file was processed
- Files: `orf_assessment.html` (lines 119-127, 53)
- Impact: UI shows confusing/incorrect elapsed time for uploaded files
- Fix approach: Reset `seconds = 0` and update timer display in `handleFile()` function before calling `sendToSTT()`
- Priority: Low - cosmetic, but breaks user trust

**File Input Not Reset After Upload:**
- Issue: `document.getElementById('fileInput')` (line 56) is used in `handleFile()` but the input value is never cleared. If user uploads the same file twice, `onchange` won't fire the second time
- Files: `orf_assessment.html` (lines 56, 119)
- Impact: User can't re-process the same file without clearing browser cache or manually clicking file dialog twice
- Fix approach: After `sendToSTT()` is called, reset the file input: `document.getElementById('fileInput').value = ''`
- Priority: Low

**Missing Null Check on Words Array:**
- Issue: `displayResults()` (line 202) checks `if (alt.words)` but `alt` itself is not guaranteed to have word-level detail. Some API configurations return alternatives without word-level timing data
- Files: `orf_assessment.html` (line 202)
- Impact: If an alternative has no words array, it silently skips the alternative without showing it in the UI
- Fix approach: Add fallback to display transcript text even if word-level data is unavailable
- Priority: Low

## Test Coverage Gaps

**No Automated Testing:**
- Issue: The entire codebase is a single HTML file with no test suite, no unit tests, no integration tests
- Files: `orf_assessment.html` (entire file)
- Impact: Regressions go undetected. Changes to core functions like `displayResults()`, `sendToSTT()`, or alignment logic (planned Phase 2) will break untested
- Recommended approach: Create a test suite for:
  1. Mock Google Cloud API responses and test `displayResults()` parsing
  2. Test speech context extraction with various passage formats
  3. Test audio codec detection and encoding mapping
  4. Test timer display logic
  5. Integration tests for the full flow (record → API → display)
- Priority: High - especially critical before Phase 2 (alignment algorithm) is added

**No Test Plan for Edge Cases:**
- Issue: PLAN.md and SETTINGS.md do not document testing strategy for:
  1. Audio longer than 60 seconds (will fail with current sync endpoint)
  2. Very large passages (>5000 words) in speech contexts
  3. Non-English passages (languageCode is hardcoded to en-US)
  4. API rate limiting / quota exceeded scenarios
  5. Invalid audio files (corrupt WAV, etc.)
- Files: `PLAN.md` (Phase 1 and Phase 3 lack test strategy), `orf_assessment.html`
- Impact: Untested edge cases will fail in production with poor error messages
- Priority: Medium - should be addressed in Phase 1 before going live

## Missing Critical Features

**No Alignment / Diff Algorithm (Core ORF Feature):**
- Issue: Phase 2 (PLAN.md lines 44-52) is not yet implemented. The reference passage is collected but never compared to the transcript. Without alignment, the tool cannot:
  - Classify words as correct/substitution/omission/insertion
  - Compute WCPM (Words Correct Per Minute)
  - Detect self-corrections
  - Flag specific error types for clinical analysis
- Files: `orf_assessment.html` (line 46 references passage but doesn't use it), `PLAN.md`
- Impact: Tool currently only transcribes and shows confidence; it does NOT assess reading fluency. This is the entire clinical value proposition
- Priority: Critical - Phase 2 must be completed for the tool to be functional as an ORF assessment
- Fix approach: Implement Levenshtein distance or longest-common-subsequence diff algorithm to align passage words to transcript words

**No ORF Scoring Metrics (WCPM, Accuracy, Error Breakdown):**
- Issue: Phase 3 (PLAN.md lines 54-59) not implemented. Tool cannot compute:
  - Words Correct Per Minute (WCPM) — the primary ORF metric
  - Accuracy percentage
  - Error counts by type (substitutions, omissions, insertions)
  - Reading rate (words per minute regardless of accuracy)
  - Pause/hesitation detection
- Files: `orf_assessment.html` (word timestamps are collected but not analyzed), `PLAN.md`
- Impact: Without these metrics, teachers cannot interpret results or compare against grade-level benchmarks
- Priority: Critical - Phase 3 must be completed for clinical usability
- Fix approach: After alignment is implemented, add scoring functions to compute each metric from the diff results

**No Reporting / Export Functionality:**
- Issue: Phase 4 (PLAN.md lines 61-66) not implemented. Tool cannot:
  - Show summary dashboard with WCPM, accuracy %, error breakdown
  - Export results as JSON/CSV
  - Generate print-friendly reports
  - Save assessment history
- Files: `orf_assessment.html`, `PLAN.md`
- Impact: Teachers cannot save assessment records or share results with students/parents
- Priority: High - needed before tool can be used in production classroom

## Dependencies at Risk

**Synchronous Google Cloud STT API May Fail:**
- Risk: `enableSpokenPunctuation` may not work on v1 endpoint; may require `v1p1beta1` (PLAN.md line 32, SETTINGS.md line 64). This setting is currently hardcoded as false but future phases may need it
- Files: `orf_assessment.html` (line 153), `PLAN.md` (line 32)
- Impact: If API rejects the config, requests fail with cryptic error message
- Mitigation: Document the v1p1beta1 fallback strategy. Test with a real API key before going live
- Priority: Medium - should test during Phase 1

**Google Cloud Speech-to-Text API Rate Limits:**
- Risk: No handling of rate limit errors (429, 503 responses from Google Cloud)
- Files: `orf_assessment.html` (lines 162-173), `PLAN.md`
- Impact: Under heavy load (e.g., classroom of 30 students all uploading simultaneously), users get cryptic errors with no retry mechanism
- Mitigation: Implement exponential backoff retry logic; show user "Please wait, service is busy"
- Priority: Medium - becomes issue with school-wide deployment

**Browser API Compatibility:**
- Risk: `navigator.mediaDevices.getUserMedia()` (line 85) requires browser support. Older browsers (IE, very old Safari) will fail
- Files: `orf_assessment.html` (line 85)
- Impact: Tool doesn't work on older devices commonly found in schools
- Mitigation: Add feature detection and graceful fallback; show clear message if microphone API is not available
- Priority: Low - affects accessibility but not core functionality

## Scaling Limits

**Single-File Architecture:**
- Limit: All HTML, CSS, JavaScript in one 236-line file. As features are added (Phase 2 alignment, Phase 3 metrics, Phase 4 reporting), the file will become unmaintainable
- Files: `orf_assessment.html`
- Impact: Future developers cannot find code; changes risk breaking unrelated features
- Scaling path: Modularize into separate files (alignment.js, scoring.js, ui.js, api.js) with a build step (Webpack/Vite) to bundle for deployment
- Priority: Medium - becomes urgent after Phase 2 implementation

**No Backend Infrastructure:**
- Current state: Entire tool runs client-side. All API keys, all audio processing happens in browser
- Limit: Cannot implement secure key storage, per-user session management, persistent storage of assessments, or server-side validation
- Impact: Cannot deploy to production classroom without solving the API key security issue (#1)
- Scaling path: Build a simple Node.js/Python backend that (1) authenticates users via OAuth, (2) holds API credentials server-side, (3) proxies requests to Google Cloud, (4) stores assessment history in a database
- Priority: High - critical for production deployment

## Security Considerations

**CSRF Vulnerability (If Backend is Added):**
- Risk: When backend is added, ensure all POST requests include CSRF tokens
- Files: `orf_assessment.html` (currently no backend)
- Current mitigation: Not applicable yet (no backend)
- Recommendations: When backend is added, implement SameSite cookie policy and CSRF token validation
- Priority: Future concern - address in Phase 4 when backend is created

**Cross-Origin Audio Upload:**
- Risk: If audio is uploaded to a different domain (e.g., CDN), ensure CORS headers are properly configured
- Files: `orf_assessment.html` (line 163-165 already uses cross-origin Google Cloud API)
- Current mitigation: Google Cloud API uses API key authentication, not cookies, so CSRF risk is low. However, API key is still exposed in URL
- Recommendations: Switch to backend proxy to hide API key in Authorization header
- Priority: Medium

---

*Concerns audit: 2026-02-02*
