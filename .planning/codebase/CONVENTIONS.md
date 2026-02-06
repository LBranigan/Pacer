# Coding Conventions

**Analysis Date:** 2026-02-06

## Naming Patterns

**Files:**
- Kebab-case for all JavaScript files: `word-equivalences.js`, `disfluency-detector.js`, `vad-processor.js`
- Descriptive compound names: `kitchen-sink-merger.js`, `confidence-classifier.js`
- Python files: Snake_case: `server.py`

**Functions:**
- camelCase for all functions: `computeWCPM()`, `alignWords()`, `parseTime()`
- Prefix patterns:
  - `get` for retrieval: `getCanonical()`, `getStudents()`, `getDebugLog()`
  - `compute` for calculations: `computeAccuracy()`, `computeWCPMRange()`
  - `detect` for analysis: `detectDisfluencies()`, `detectLongPauses()`
  - `build` for construction: `buildHypToRefMap()`, `buildReferenceSet()`
  - `apply` for transformations: `applySafetyChecks()`, `applyCorroborationOverride()`
  - `init` for initialization: `initRecorder()`, `initDebugLog()`, `initDashboard()`
  - `is` for boolean checks: `isNearMiss()`, `isReverbAvailable()`
  - `add` for mutations: `addStudent()`, `addStage()`, `addWarning()`
  - `flag` for marking: `flagGhostWords()`

**Variables:**
- camelCase for local variables: `alignmentResult`, `elapsedSeconds`, `referenceText`
- SCREAMING_SNAKE_CASE for constants: `CODE_VERSION`, `STORAGE_KEY`, `DIFF_DELETE`, `EDGE_TOLERANCE_MS`
- Object constants frozen with `Object.freeze()`: `CONFIDENCE_THRESHOLDS`, `SAFETY_FLAGS`, `SEVERITY_LEVELS`
- Private/internal variables prefixed with underscore: `_model`, `_deepgram_client`, `_partOfStruggle`, `_isSelfCorrection`, `_disfluency`, `_vadAnalysis`

**Types:**
- PascalCase for classes: `SpriteAnimator`, `VADProcessor`
- Pydantic models in Python: `EnsembleRequest`, `DeepgramRequest`, `Word`

## Code Style

**Formatting:**
- No formal config file detected (no `.prettierrc`, `.eslintrc`)
- Indentation: 2 spaces (JavaScript), 4 spaces (Python per PEP 8)
- String quotes: Single quotes in JavaScript (`'text'`), double quotes in Python (`"text"`)
- Template literals for interpolation: `` `[ORF] Code version: ${CODE_VERSION}` ``
- Semicolons: Always used in JavaScript (not optional-semicolon style)

**Linting:**
- No ESLint or standard linter config detected
- Code follows consistent style through manual convention

## Import Organization

**Order:**
1. Framework/library imports (Python): `fastapi`, `torch`, `wenet`, `deepgram`
2. External library imports: None visible in JS (vanilla JS + CDN-loaded ONNX/VAD)
3. Local module imports (relative paths): `import { alignWords } from './alignment.js';`

**Path Aliases:**
- None - all imports use relative paths: `'./module-name.js'`
- Always include `.js` extension in imports

**Pattern:**
```javascript
// Group by feature area, alphabetize within groups
import { initRecorder, setOnComplete as recorderSetOnComplete } from './recorder.js';
import { initFileHandler, setOnComplete as fileHandlerSetOnComplete } from './file-handler.js';
import { sendToSTT, sendToAsyncSTT, sendChunkedSTT, sendEnsembleSTT } from './stt-api.js';
import { alignWords } from './alignment.js';
import { getCanonical } from './word-equivalences.js';
```

**Renamed imports:**
- Use `as` for collision avoidance: `setOnComplete as recorderSetOnComplete`

## Error Handling

**Patterns:**
- Try-catch with fallback behavior:
```javascript
try {
  const padResult = await padAudioWithSilence(appState.audioBlob);
  paddedAudioBlob = padResult.blob;
  addStage('audio_padding', { applied: true, paddingMs: 500 });
} catch (err) {
  console.warn('[ORF] Audio padding failed:', err.message);
  paddedAudioBlob = appState.audioBlob;
  addStage('audio_padding', { applied: false, error: err.message });
}
```

- Graceful degradation for optional features:
```python
def get_deepgram_client():
    global _deepgram_client
    if _deepgram_client is None:
        api_key = os.environ.get("DEEPGRAM_API_KEY")
        if not api_key:
            return None  # Graceful degradation
        _deepgram_client = DeepgramClient(api_key=api_key)
    return _deepgram_client
```

- FastAPI automatic HTTP exceptions:
```python
@app.post("/ensemble")
async def ensemble(req: EnsembleRequest):
    # Validation errors return 422 automatically
    # Unhandled exceptions return 500
```

**Error propagation:**
- JavaScript: Async functions throw, caller catches
- Python: FastAPI middleware handles exceptions
- No custom error classes - using built-in `Error` and `HTTPException`

## Logging

**Framework:** Console API + custom debug logger

**Patterns:**
- Structured console logging with prefixes:
```javascript
console.log('[ORF] Code version:', CODE_VERSION);
console.warn('[ORF] Audio padding failed:', err.message);
console.error('[ORF Debug]', message, data);
```

- Debug logger for assessment tracking (see `js/debug-logger.js`):
```javascript
initDebugLog();
addStage('start', { codeVersion: CODE_VERSION, timestamp: new Date().toISOString() });
addWarning('message', { data });
addError('message', { data });
finalizeDebugLog(assessmentData);
```

- Python logging with print statements (simple service):
```python
print("[reverb] Loading model reverb_asr_v1...")
print(f"[reverb] GPU verified: {device_name} ({vram_mb:.0f}MB)")
```

**When to Log:**
- Startup/initialization: Code version, service registration
- Major pipeline stages: `addStage('audio_padding', { ... })`
- Warnings: Feature failures with fallback (not fatal)
- Errors: Unexpected failures requiring attention
- Debug mode: Pipeline state snapshots (mostly commented out in production)

## Comments

**When to Comment:**
- File-level purpose headers:
```javascript
/**
 * Word-level alignment engine using diff-match-patch.
 * Diffs STT transcript against reference text to classify each word.
 */
```

- Algorithm explanations:
```javascript
// Pad audio with 500ms silence to help ASR resolve final word
// (Models use lookahead window; if audio ends abruptly, last word suffers)
```

- Non-obvious business logic:
```javascript
// Proper noun forgiveness: count as correct if flagged as forgiven
if (w.forgiven) {
  correctCount++;
  forgiven++;
}
```

- Deprecation notices:
```javascript
// NOTE: Removed phonetic-utils imports - no longer needed
// after removing unreliable fragment/repetition detection
```

**JSDoc/TSDoc:**
- Used for public API functions:
```javascript
/**
 * Compute Words Correct Per Minute (WCPM).
 * @param {Array<{type: string}>} alignmentResult - From alignWords()
 * @param {number} elapsedSeconds - Reading duration in seconds
 * @returns {{ wcpm: number, correctCount: number, elapsedSeconds: number }}
 */
export function computeWCPM(alignmentResult, elapsedSeconds) { ... }
```

- Includes type annotations (no TypeScript, JSDoc provides type hints)
- Python uses docstrings:
```python
def parse_ctm(ctm_text: str) -> list:
    """
    Parse CTM format output from Reverb ASR.

    CTM format: <file> <channel> <start> <duration> <word> <confidence>

    Args:
        ctm_text: Raw CTM output from model.transcribe(format="ctm")

    Returns:
        List of word dictionaries with word, start_time, end_time, confidence
    """
```

## Function Design

**Size:**
- Most functions 20-100 lines
- Large orchestrator functions (e.g., `runAnalysis()` in `js/app.js`) up to 300 lines
- Single-purpose helpers kept small: `parseTime()` is 3 lines

**Parameters:**
- Positional parameters for core data: `alignWords(referenceText, transcriptWords)`
- Options object for configuration: `computeAccuracy(alignmentResult, options = {})`
- Named parameters in Python: `def parse_ctm(ctm_text: str) -> list`

**Return Values:**
- Objects for multiple values: `return { wcpm, correctCount, elapsedSeconds };`
- Null for "not found": `return info ? info.detector : null;`
- Arrays for collections: `return words;`
- Boolean for predicates: `return prefixLen >= 3;`

**Async patterns:**
- `async`/`await` throughout: `export async function sendToSTT(blob, encoding)`
- No callbacks (except legacy `setOnComplete` for recorder)
- FastAPI async handlers: `async def ensemble(req: EnsembleRequest)`

## Module Design

**Exports:**
- Named exports only (no default exports): `export function alignWords() {}`
- Export at declaration site (not end-of-file export block)
- Constants exported explicitly: `export const SEVERITY_LEVELS = { ... };`

**Barrel Files:**
- Not used - each module imported directly
- No `index.js` files aggregating exports

**Module patterns:**
- Single-purpose modules: `js/alignment.js` does word alignment, nothing else
- Shared utilities: `js/word-equivalences.js`, `js/text-normalize.js`
- Singleton pattern for stateful resources: `_model` in Python, `debugLog` in `js/debug-logger.js`
- Service workers: `sw.js` registered conditionally

**Configuration modules:**
- Separate config from implementation:
  - `js/disfluency-config.js` → used by `js/disfluency-detector.js`
  - `js/confidence-config.js` → used by `js/confidence-classifier.js`
  - `js/safety-config.js` → used by `js/safety-checker.js`
- All thresholds defined as frozen constants: `Object.freeze({ ... })`

## Registry Pattern

**Miscue Registry** (`js/miscue-registry.js`):
- Single source of truth for all reading error types
- Structured metadata:
```javascript
export const MISCUE_REGISTRY = {
  omission: {
    description: 'Student skipped a word from the reference text',
    detector: 'alignment.js → alignWords()',
    countsAsError: true,
    config: null,
    example: { reference: 'the big dog', spoken: 'the dog', result: '"big" is an omission' },
    uiClass: 'word-omission'
  },
  // ... all other types
};
```
- Utility functions: `getErrorTypes()`, `getDiagnosticTypes()`, `getMiscueInfo(type)`
- **Critical rule:** When adding/modifying miscue types, MUST update registry

## Version Tracking

**Code version constant:**
```javascript
const CODE_VERSION = 'v37-2026-02-06';
console.log('[ORF] Code version:', CODE_VERSION);
```

**UI version display:**
```html
<div id="version">v 2026-02-06 19:45</div>
```

**Caching strategy:**
- Service worker for offline support
- Debug logger includes version for verification

## Data Structures

**Alignment format:**
```javascript
{
  ref: 'word',           // Reference text word
  hyp: 'word',           // Hypothesis (spoken) word
  type: 'correct',       // 'correct' | 'substitution' | 'omission' | 'insertion' | 'struggle'
  compound: true,        // Optional: merged compound word
  parts: ['every', 'one'], // Optional: original parts before merge
  forgiven: true,        // Optional: error forgiven (proper noun)
  _partOfStruggle: true, // Optional: insertion claimed by struggle
  _isSelfCorrection: true // Optional: near-miss self-correction
}
```

**Word metadata:**
```javascript
{
  word: 'text',
  start_time: 1.2,
  end_time: 1.5,
  confidence: 0.95,
  _disfluency: { fragments: [...], ... }, // Optional
  _vadAnalysis: { speechPercent: 80, label: 'speech detected' }, // Optional
  _flags: ['possible_insertion'] // Optional: safety/confidence flags
}
```

**Storage schema:**
```javascript
{
  version: 5,
  students: [{ id: 'uuid', name: 'Name', grade: 3 }],
  assessments: [{
    id: 'uuid',
    studentId: 'uuid',
    date: 'ISO8601',
    wcpm: 120,
    accuracy: 95.5,
    alignment: [...],
    sttWords: [...],
    audioRef: 'uuid',
    gamification: { ... },
    nlAnnotations: { ... }
  }]
}
```

**Migration pattern:**
```javascript
function migrate(data) {
  if (!data.version) data.version = 1;
  if (data.version === 1) {
    // Add v2 fields
    data.version = 2;
  }
  if (data.version === 2) {
    // Add v3 fields
    data.version = 3;
  }
  // ...
}
```

---

*Convention analysis: 2026-02-06*
