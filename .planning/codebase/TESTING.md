# Testing Patterns

**Analysis Date:** 2026-02-06

## Test Framework

**Runner:**
- None detected - no Jest, Vitest, Mocha, or other test framework present
- No `test/` directory
- No `.test.js` or `.spec.js` files found

**Assertion Library:**
- None detected

**Run Commands:**
```bash
# No test commands available
```

## Test File Organization

**Location:**
- No formal tests present

**Naming:**
- N/A

**Structure:**
```
No test files detected
```

## Test Structure

**Suite Organization:**
- No formal test suites

**Patterns:**
- Testing appears to be manual/integration-based
- Debug logger (`js/debug-logger.js`) captures runtime state for post-hoc analysis
- Debug log downloadable as JSON for inspection

**Manual testing artifacts:**
```javascript
// Debug logging used for verification
initDebugLog();
addStage('audio_padding', { applied: true, paddingMs: 500 });
addWarning('Audio padding failed', err.message);
finalizeDebugLog(assessmentData);
saveDebugLog(); // Downloads JSON
```

## Mocking

**Framework:**
- None detected

**Patterns:**
- No mocks in codebase
- Real services used during development (Google Cloud STT, Reverb Docker service, Deepgram API)

**What to Mock:**
- N/A - no test infrastructure

**What NOT to Mock:**
- N/A - no test infrastructure

## Fixtures and Factories

**Test Data:**
- No fixtures directory or factory functions detected

**Location:**
- N/A

**Pattern:**
- Manual testing likely uses real audio files and passages
- Reference texts entered via UI (`#transcript` textarea in `index.html`)
- Audio captured via browser MediaRecorder API (`js/recorder.js`)

## Coverage

**Requirements:**
- None enforced

**View Coverage:**
```bash
# No coverage tooling
```

**Current state:**
- No formal unit test coverage
- System tested end-to-end via UI
- Debug logger provides runtime validation

## Test Types

**Unit Tests:**
- None present

**Integration Tests:**
- None present in automated form
- Manual integration testing via browser UI

**E2E Tests:**
- None present

## Testing Approach (Inferred)

**Manual verification workflow:**
1. User records or uploads audio via UI
2. Reference passage entered manually or via OCR
3. Click "Analyze" button to run full pipeline
4. System processes through multiple stages:
   - Audio padding: `js/audio-padding.js`
   - ASR transcription: Kitchen Sink pipeline (Reverb + Deepgram)
   - Word alignment: `js/alignment.js`
   - Disfluency detection: `js/disfluency-detector.js`
   - Diagnostics: `js/diagnostics.js`
   - Metrics calculation: `js/metrics.js`
5. Results displayed in UI via `js/ui.js`
6. Debug log downloadable for detailed inspection

**Validation mechanisms:**
- Console logging with structured prefixes: `[ORF]`, `[Pipeline]`, `[reverb]`
- Debug logger tracks all pipeline stages: `addStage(name, data)`
- Version tracking for cache verification: `CODE_VERSION` constant
- Safety checks built into pipeline: `js/safety-checker.js`

**Production safeguards:**
- Error handling with fallback behavior (graceful degradation)
- Input validation via FastAPI Pydantic models (Python backend)
- Frozen configuration constants prevent runtime mutation
- Service worker for offline resilience

## Common Patterns

**Async Testing:**
- N/A - no async test patterns (no test framework)

**Error Testing:**
- N/A - no error test patterns (no test framework)

**Runtime verification:**
```javascript
// Typical error handling pattern that would need testing
try {
  const result = await someAsyncOperation();
  addStage('operation_success', result);
  return result;
} catch (err) {
  console.warn('[ORF] Operation failed:', err.message);
  addError('Operation failed', { error: err.message });
  return fallbackValue;
}
```

**Validation pattern (would be testable):**
```javascript
// Pure function suitable for unit testing
export function computeAccuracy(alignmentResult, options = {}) {
  let correctCount = 0, substitutions = 0, omissions = 0;
  for (const w of alignmentResult) {
    switch (w.type) {
      case 'correct': correctCount++; break;
      case 'substitution': substitutions++; break;
      case 'omission': omissions++; break;
    }
  }
  const totalRefWords = correctCount + substitutions + omissions;
  const accuracy = totalRefWords === 0 ? 0 : Math.round((correctCount / totalRefWords) * 1000) / 10;
  return { accuracy, correctCount, totalRefWords, substitutions, omissions };
}
```

## Testability Characteristics

**Well-structured for testing:**
- Pure functions in `js/metrics.js`: `computeWCPM()`, `computeAccuracy()`
- Stateless utilities: `js/word-equivalences.js`, `js/text-normalize.js`
- Clear input/output contracts with JSDoc type annotations
- Modular design: each file has single responsibility
- Configuration separated from implementation

**Challenges for testing:**
- Heavy browser API dependencies: `MediaRecorder`, `AudioContext`, `localStorage`, `IndexedDB`
- External service integration: Google Cloud STT, Deepgram, Docker-hosted Reverb
- Complex pipeline orchestration in `js/app.js`
- No dependency injection - services imported directly
- Global state in some modules: `_model` singleton (Python), `debugLog` (JS)

**Testable modules (if tests were added):**
- `js/alignment.js` - Pure diff algorithm
- `js/metrics.js` - Pure calculations
- `js/word-equivalences.js` - Pure lookups
- `js/diagnostics.js` - Analysis functions (given mock data)
- `js/text-normalize.js` - String transformations

**Requires mocking for testing:**
- `js/stt-api.js` - HTTP calls to Google Cloud
- `js/reverb-api.js` - HTTP calls to local Docker service
- `js/deepgram-api.js` - HTTP calls to Deepgram
- `js/recorder.js` - MediaRecorder API
- `js/storage.js` - localStorage API
- `js/vad-processor.js` - ONNX Runtime + Web Audio API
- `services/reverb/server.py` - PyTorch + CUDA GPU

## Recommendations (if adding tests)

**Start with:**
1. Unit tests for pure functions:
   - `js/metrics.js`: `computeWCPM()`, `computeAccuracy()`
   - `js/word-equivalences.js`: `getCanonical()`, `getAllEquivalents()`
   - `js/text-normalize.js`: `normalizeText()`, `filterDisfluencies()`
   - `js/diagnostics.js`: `isNearMiss()`, `parseTime()`

2. Integration tests for pipeline stages (with mocked I/O):
   - `js/alignment.js`: Word alignment with known inputs
   - `js/disfluency-detector.js`: Disfluency detection patterns
   - `js/confidence-classifier.js`: Confidence classification logic

3. E2E tests (Playwright/Cypress):
   - Record → Analyze → View Results workflow
   - Student management (add/delete/history)
   - OCR passage extraction
   - Audio playback synchronization

**Framework recommendation:**
- **Vitest** - Fast, ESM-native, works with browser APIs via `happy-dom` or `jsdom`
- **Jest** - Mature ecosystem, good mocking support
- **Playwright** - For E2E tests requiring real browser + Media APIs

**Mocking strategy:**
- Mock external APIs: `fetch()` calls to Google/Deepgram/Reverb
- Mock browser APIs: `MediaRecorder`, `AudioContext`, `localStorage`
- Use real implementations for pure functions (no mocking needed)

**Coverage goals:**
- Pure functions: 100% (easy to test)
- API/service layers: 80%+ (mock HTTP)
- UI rendering: 60%+ (E2E tests)
- Overall target: 70%+ line coverage

---

*Testing analysis: 2026-02-06*
