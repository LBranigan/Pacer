# Testing Patterns

**Analysis Date:** 2026-02-02

## Test Framework

**Runner:**
- Not configured - no test runner detected (no Jest, Vitest, Mocha, Jasmine config files)

**Assertion Library:**
- Not applicable - no testing framework installed

**Run Commands:**
```bash
# No test commands configured
# Manual testing only - open orf_assessment.html in browser
```

## Test File Organization

**Location:**
- Not applicable - no test files present

**Naming:**
- No test files detected (no `*.test.js`, `*.spec.js` files)

**Structure:**
- Not established - testing infrastructure not implemented

## Test Structure

**Suite Organization:**
- Not applicable - no tests written

**Patterns:**
- Not established

## Mocking

**Framework:**
- Not applicable - no mocking library configured

**Patterns:**
- Manual mocking for development: Users must provide their own GCP API key (line 40-42 in `orf_assessment.html`)
- Local audio input testing possible via file upload (line 56 accepts `.wav`, `.flac`, `.ogg`, `.mp3`, `.webm`)

**What to Mock (for future implementation):**
- Google Cloud Speech-to-Text API responses - currently requires live API calls with valid key
- MediaRecorder API - for testing audio recording logic without actual microphone
- Fetch requests - to simulate API responses and error conditions
- navigator.mediaDevices.getUserMedia() - to test microphone permission flows

**What NOT to Mock (for future implementation):**
- DOM manipulation - test actual DOM updates for display correctness
- Audio encoding logic - test actual blob-to-base64 conversion
- UI state transitions - test recording state changes (toggle, status updates, timer)

## Fixtures and Factories

**Test Data:**
- Not established - no test data fixtures created

**Mock Response Data** (for future tests):
```javascript
// Sample Google Cloud STT response structure for tests
const mockSTTResponse = {
  results: [
    {
      alternatives: [
        {
          transcript: "the cat sat on the mat",
          confidence: 0.95,
          words: [
            {
              word: "the",
              startTime: "0s",
              endTime: "0.5s",
              confidence: 0.98
            },
            {
              word: "cat",
              startTime: "0.5s",
              endTime: "1.0s",
              confidence: 0.92
            }
            // ... more words
          ]
        }
      ]
    }
  ]
};
```

**Location:**
- Would belong in a `test/fixtures/` directory (not yet created)

## Coverage

**Requirements:**
- Not enforced - no coverage targets set
- Coverage tooling not configured

**View Coverage:**
```bash
# Not applicable - no coverage tooling installed
```

## Test Types

**Unit Tests (Not Yet Implemented):**
- **Audio encoding**: `blobToBase64()` function - verify base64 output format
- **Status updates**: `setStatus()` function - verify DOM element update
- **File handling**: `handleFile()` - verify correct encoding type selected for each file extension
- **Timer logic**: Recording duration calculation and display formatting
- **Confidence classification**: Word color assignment logic (lines 206-207)
  ```javascript
  // Test these classifications:
  // confidence >= 0.9 → "high" (green)
  // 0.7 <= confidence < 0.9 → "mid" (yellow)
  // confidence < 0.7 → "low" (red)
  ```

**Integration Tests (Not Yet Implemented):**
- **Recording to API flow**: Microphone input → MediaRecorder → base64 → API call → display results
- **File upload to API flow**: File input → encoding detection → base64 → API call → display results
- **UI state transitions**: Start recording → timer runs → stop recording → status updates
- **API error handling**: Invalid API key → error message displayed
- **Speech context building**: Reference passage text → unique words extraction → speech contexts array

**E2E Tests (Not Yet Implemented):**
- **Browser-based**: Open HTML file in browser, interact with UI
- **Manual testing protocol** (currently the only QA method):
  1. Open `orf_assessment.html` in browser
  2. Enter valid GCP API key
  3. Paste reference passage
  4. Record audio or upload file
  5. Verify transcript displays with confidence coloring
  6. Verify JSON output contains word details
  7. Test error scenarios (missing key, invalid audio, API errors)

## Common Patterns (for future tests)

**Async Testing:**
```javascript
// Pattern to test async functions like startRecording() and sendToSTT()
// Would use Jest/Vitest async test syntax:

test('startRecording should initialize MediaRecorder', async () => {
  // Mock navigator.mediaDevices.getUserMedia
  // Call toggleRecord()
  // Assert MediaRecorder was created
  // Assert recording flag is true
  // Assert UI updated with "Stop" button
});

test('sendToSTT should call fetch with correct payload', async () => {
  // Mock fetch
  // Call sendToSTT(blob, 'WEBM_OPUS')
  // Assert fetch called with correct URL and body
  // Assert response handling
});
```

**Error Testing:**
```javascript
// Pattern to test error scenarios
// Would test these current error cases:

test('startRecording should handle microphone permission denied', async () => {
  // Mock getUserMedia to reject with permission error
  // Call toggleRecord()
  // Assert error message displayed via setStatus()
});

test('sendToSTT should handle missing API key', async () => {
  // Leave API key field empty
  // Call sendToSTT()
  // Assert "Please enter your API key." message shown
});

test('sendToSTT should handle API error response', async () => {
  // Mock fetch to return error object
  // Verify error message displays from response.error.message
});

test('displayResults should handle no speech detected', async () => {
  // Call displayResults({ results: [] })
  // Assert "No speech detected." message shown
});
```

**DOM Testing Pattern:**
```javascript
// For testing DOM updates like displayResults()
test('displayResults should render color-coded words', () => {
  const data = {
    results: [{
      alternatives: [{
        transcript: "test word",
        words: [
          { word: "test", confidence: 0.95, startTime: "0s", endTime: "0.5s" },
          { word: "word", confidence: 0.65, startTime: "0.5s", endTime: "1.0s" }
        ]
      }]
    }]
  };
  displayResults(data);

  // Assert high confidence word has class "word high"
  // Assert low confidence word has class "word low"
  // Assert tooltip text contains confidence percentage
});
```

## Manual Testing Checklist

Since no automated tests exist, manual testing is the current QA method:

**Basic Functionality:**
- [ ] Open `orf_assessment.html` in browser (no server required)
- [ ] Test with valid GCP API key for Speech-to-Text API
- [ ] Record audio via microphone, verify timer counts up
- [ ] Verify transcript displays with color-coded confidence
- [ ] Verify JSON output contains all word details (word, confidence, startTime, endTime)

**Audio Input Methods:**
- [ ] Test microphone recording (WebM/Opus format)
- [ ] Test WAV file upload and encoding detection
- [ ] Test FLAC file upload
- [ ] Test OGG file upload
- [ ] Test MP3 file upload
- [ ] Test WebM file upload

**Reference Passage Feature:**
- [ ] Enter reference passage text
- [ ] Verify unique words extracted and sent as speechContexts
- [ ] Verify boost value set to 5
- [ ] Test with and without reference passage

**Error Scenarios:**
- [ ] Missing API key - should show "Please enter your API key."
- [ ] Invalid API key - should show API error message
- [ ] Microphone permission denied - should show "Microphone access denied"
- [ ] Empty audio file - should show "No speech detected."

**Display Accuracy:**
- [ ] Confidence >= 0.9 words show green background
- [ ] Confidence 0.7-0.9 words show yellow background
- [ ] Confidence < 0.7 words show red background
- [ ] Hover tooltip shows correct confidence percentage and timestamps
- [ ] Plain text output matches transcript (space-separated words)
- [ ] JSON output valid and formatted with 2-space indent

## Future Testing Strategy

**Recommended approach** when tests are implemented:

1. **Framework choice**: Jest or Vitest for JavaScript unit/integration tests
2. **Mock setup**: Mock `fetch()` for API calls, `navigator.mediaDevices` for audio
3. **Test coverage targets**: Start with core functions (60% minimum)
4. **CI/CD integration**: Add test script to npm or build process
5. **Browser automation** (optional): Playwright or Cypress for E2E testing of actual HTML file

---

*Testing analysis: 2026-02-02*
