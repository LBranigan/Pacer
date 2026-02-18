# Architecture

**Analysis Date:** 2026-02-18

## Pattern Overview

**Overall:** Pipeline-Oriented Single-Page Application with Dual-Engine ASR Ensemble

**Key Characteristics:**
- One dominant orchestrator (`js/app.js`, ~1800+ lines) coordinates the full assessment pipeline
- Three independent ASR engine alignments per assessment (V1 Reverb verbatim, V0 Reverb clean, Parakeet)
- Staged pipeline: audio capture → STT → fragment merge → 3-way alignment → scoring → diagnostics → UI render
- All state held in-memory during a session; persistence via localStorage (metadata) and IndexedDB (audio blobs)
- All modules are native ES modules with `import`/`export`; no bundler

## Layers

**Audio Capture Layer:**
- Purpose: Record or import student audio, pad with silence, detect speech activity
- Location: `js/recorder.js`, `js/file-handler.js`, `js/audio-padding.js`, `js/vad-processor.js`
- Contains: MediaRecorder wrapper, WAV silence padding, Silero VAD (via ONNX)
- Depends on: Browser MediaRecorder API, `@ricky0123/vad-web` CDN, `onnxruntime-web` CDN
- Used by: `js/app.js` (sets `appState.audioBlob`)

**STT Invocation Layer:**
- Purpose: Send audio to multiple ASR engines in parallel; return raw word arrays
- Location: `js/kitchen-sink-merger.js`, `js/reverb-api.js`, `js/parakeet-api.js`, `js/cross-validator.js`, `js/deepgram-api.js`
- Contains: `runKitchenSinkPipeline()` — calls Reverb dual-pass + Parakeet simultaneously
- Depends on: `js/backend-config.js` (URL + auth token), local Docker backend (`services/reverb/`)
- Used by: `js/app.js` `runAnalysis()`
- Fallback: Reverb offline → Parakeet-only (no disfluency detection); both offline → error

**Alignment Layer:**
- Purpose: Map each engine's word array against the reference passage using Needleman-Wunsch
- Location: `js/alignment.js`, called 3× in `js/app.js` (V1, V0, Parakeet)
- Contains: NW graded alignment, `mergeCompoundWords()`, `mergeAbbreviationExpansions()`, `mergeNumberExpansions()`, `mergeContractions()`, `consolidateSpilloverFragments()`
- Depends on: `js/text-normalize.js`, `js/word-equivalences.js`, `js/nl-api.js` (levenshteinRatio)
- Used by: `js/app.js` (pipeline phases 4a/4b/4c)

**3-Way Verdict Layer:**
- Purpose: Compare V1, V0, Parakeet alignment results per reference word; apply Trust Pk overrides
- Location: `js/app.js` (~lines 862–1245, the "3-way per-ref-word comparison" block)
- Contains: Per-ref-word decision matrix, `crossValidation` status assignment, omission recovery, fragment guard, confirmed-insertion logic
- Depends on: All three alignment arrays, `js/nl-api.js` (levenshteinRatio, isNearMiss)
- Used by: Scoring and diagnostics layers

**Forgiveness / Annotation Layer:**
- Purpose: Post-verdict leniency passes (proper nouns, inflectional variants, OOV exclusions)
- Location: `js/app.js` (~lines 1680–1900, Phase 1 / Phase 1.5 blocks)
- Contains: Proper noun forgiveness (NL API + dictionary guard), inflectional morphology leniency
- Depends on: `js/nl-api.js` (Google Cloud Natural Language API), Free Dictionary API (`api.dictionaryapi.dev`)
- Used by: Scoring layer

**Scoring Layer:**
- Purpose: Compute WCPM, accuracy, and error breakdown from the final alignment
- Location: `js/metrics.js`
- Contains: `computeWCPM()`, `computeAccuracy()`, `computeWCPMRange()`
- Depends on: Alignment array with `type`, `forgiven`, `_notAttempted`, `_pkTrustOverride` flags
- Used by: `js/app.js` (results assembly), `js/ui.js` (display)

**Diagnostics Layer:**
- Purpose: Detect hesitations, struggles, self-corrections, pacing anomalies, disfluencies
- Location: `js/diagnostics.js` (~82K bytes), orchestrated from `js/app.js`
- Contains: `runDiagnostics()`, `resolveNearMissClusters()`, `absorbMispronunciationFragments()`, `computeWordSpeedTiers()`, `computePauseAtPunctuation()`, `computePaceConsistency()`, `computeWordDurationOutliers()`, `computeFunctionWordCompression()`
- Depends on: `js/syllable-counter.js`, `js/phoneme-counter.js`, `js/nl-api.js`, `js/vad-gap-analyzer.js`
- Used by: `js/app.js` (collects `diagnostics` object), `js/ui.js` (renders word speed map, hesitation markers)

**UI Rendering Layer:**
- Purpose: Render alignment table, word-level tooltips, audio playback, history
- Location: `js/ui.js` (~119K bytes)
- Contains: `displayAlignmentResults()`, `displayResults()`, `showWordTooltip()`, `renderStudentSelector()`, `renderHistory()`
- Depends on: `js/diagnostics.js` (recomputeWordSpeedWithPauses), `js/text-normalize.js`
- Used by: `js/app.js` (called at end of `runAnalysis()`)

**Persistence Layer:**
- Purpose: Store and retrieve students, assessments, and audio blobs
- Location: `js/storage.js` (localStorage), `js/audio-store.js` (IndexedDB)
- Contains: CRUD for students/assessments with versioned migration (v1–v6), audio blob store keyed by assessmentId
- Depends on: Browser localStorage and IndexedDB APIs
- Used by: `js/app.js`, `js/dashboard.js`, `js/rhythm-remix.js`, `js/illustrator.js`

**Backend Service:**
- Purpose: GPU-accelerated ASR — Reverb dual-pass (wenet) + Parakeet TDT (NeMo)
- Location: `services/reverb/server.py` (FastAPI), `services/reverb/Dockerfile`
- Contains: `/ensemble` (dual-pass Reverb), `/parakeet` (Parakeet TDT), `/health`, optional `/deepgram` proxy
- Depends on: CUDA GPU, PyTorch, wenet, nemo_toolkit, FastAPI, slowapi
- Used by: `js/reverb-api.js`, `js/parakeet-api.js` (via configurable `BACKEND_URL`)

**Satellite Pages:**
- Purpose: Post-assessment engagement features (separate HTML entry points)
- Location: `rhythm-remix.html` + `js/rhythm-remix.js`, `playback.html`, `maze.html` + `js/maze-game.js`, `illustrator.html` + `js/illustrator.js`, `future-you.html` + `js/future-you.js`
- Contains: Independent pages opened in popups; read assessment data from storage
- Depends on: `js/storage.js`, `js/audio-store.js`, `js/diagnostics.js` (for punctuation positions)

## Data Flow

**Primary Assessment Flow:**

1. User records audio (MediaRecorder) or uploads file → `appState.audioBlob`
2. `padAudioWithSilence()` adds 500ms silence; re-encodes as WAV LINEAR16
3. `runKitchenSinkPipeline()` sends audio to Reverb (`/ensemble`) + Parakeet (`/parakeet`) in parallel
4. Returns: raw V1 words (Reverb verbatim), raw V0 words (Reverb clean), raw Parakeet words
5. Reference-aware fragment pre-merge: BPE fragments glued to match reference words
6. Three independent `alignWords()` calls: V1 → `alignment`, V0 → `v0Alignment`, Parakeet → `parakeetAlignment`
7. `consolidateSpilloverFragments()` runs on each alignment independently
8. Compound struggle reclassification on V1 alignment
9. 3-way per-ref-word comparison: assigns `crossValidation` status (`confirmed`, `disagreed`, `unconfirmed`, `recovered`)
10. Trust Pk overrides: Parakeet correct + V1 wrong → `forgiven=true`, `_pkTrustOverride=true`
11. Proper noun forgiveness (Phase 1): NL API → dictionary guard → `entry.forgiven=true`
12. Inflectional leniency (Phase 1.5): suffix match → `entry.forgiven=true`
13. End-of-reading detection (Phase 8): trailing non-attempts marked `_notAttempted`
14. `runDiagnostics()`: hesitation detection, near-miss clusters, word speed tiers, VAD gap enrichment
15. `computeWCPM()` / `computeAccuracy()` → metrics
16. `displayAlignmentResults()` renders 6-column table + per-word tooltips with click-to-play audio

**State Management:**
- `appState` object in `js/app.js` holds `audioBlob`, `audioEncoding`, `elapsedSeconds`, `selectedStudentId`
- Pipeline-intermediate data flows via local variables within `runAnalysis()` async function
- Assessment results saved to localStorage via `js/storage.js` after display
- Audio blobs saved to IndexedDB via `js/audio-store.js`
- Engine selection persisted to `localStorage` keys: `orf_cross_validator`, `orf_use_kitchen_sink`
- Backend URL/token persisted to `localStorage` keys: `orf_backend_url`, `orf_backend_token`

## Key Abstractions

**Alignment Entry:**
- Purpose: Per-word result of NW alignment against the reference passage
- Properties: `ref` (reference word), `hyp` (student word), `type` ('correct'|'substitution'|'omission'|'insertion'), `hypIndex` (index into transcriptWords), `crossValidation` status, `forgiven`, `_isStruggle`, `_notAttempted`, `nl` (NL annotations), `_displayRef`
- Compound entries additionally carry: `compound: true`, `parts: string[]`

**Kitchen Sink Result:**
- Purpose: Raw output from parallel ASR engine calls, before alignment
- Properties: `words` (V1 merged words), `_kitchenSink.reverbCleanWords` (V0), `_kitchenSink.xvalRawWords` (Parakeet), `_kitchenSink.reverb` (full Reverb response)
- Location: Returned by `runKitchenSinkPipeline()` in `js/kitchen-sink-merger.js`

**STT Word Object:**
- Purpose: Single word from any ASR engine with timestamps and cross-validation metadata
- Properties: `word`, `startTime` (string "X.XXXs"), `endTime` (string "X.XXXs"), `crossValidation` status, `_xvalStartTime`, `_xvalEndTime`, `_xvalWord`, `_reverbStartTime`, `_reverbEndTime`, `severity`

**Diagnostics Object:**
- Purpose: All fluency signals collected post-alignment
- Properties: `longPauses[]`, `onsetDelays[]` (hesitations), `wordSpeedTiers[]`, `nearMissClusters[]`, `phrasingQuality`, `pauseAtPunctuation`, `paceConsistency`, `functionWordCompression`
- Location: Built by `runDiagnostics()` in `js/diagnostics.js`

## Entry Points

**Main Assessment App:**
- Location: `index.html` + `js/app.js` (ES module, `<script type="module">`)
- Triggers: Page load; `analyzeBtn` click calls `runAnalysis()`
- Responsibilities: Full pipeline orchestration from audio to rendered results

**Rhythm Remix:**
- Location: `rhythm-remix.html` + `js/rhythm-remix.js`
- Triggers: Opened as popup from main app's "Rhythm Remix" button
- Responsibilities: Bouncing-ball reading playback with lo-fi beats; reads assessment from localStorage key `orf_playback_assessment`

**Playback Adventure:**
- Location: `playback.html` + `js/student-playback.js`
- Triggers: Opened as popup from main app
- Responsibilities: Student-facing animated reading playback

**Maze Game:**
- Location: `maze.html` + `js/maze-game.js` + `js/maze-generator.js`
- Triggers: Opened as popup with `?student=&assessment=&difficulty=` query params
- Responsibilities: Post-assessment comprehension game using passage words

**Dashboard:**
- Location: `dashboard.html` + `js/dashboard.js` + `js/celeration-chart.js`
- Triggers: Standalone page
- Responsibilities: Multi-student progress tracking and celeration chart

**Backend Service:**
- Location: `services/reverb/server.py`
- Triggers: `start_services.bat` / `start_services.sh` (via Docker)
- Responsibilities: GPU ASR — Reverb dual-pass + Parakeet + optional Deepgram proxy

## Error Handling

**Strategy:** Graceful degradation at each pipeline stage; errors logged to debug log, never crash the UI

**Patterns:**
- STT failures: `runKitchenSinkPipeline()` falls back from Reverb+Parakeet → Parakeet-only → error state
- API client failures: `reverb-api.js`, `parakeet-api.js` return `null` on timeout/network error; callers check for null
- Alignment with no reference text: `displayResults(data)` called with raw STT output; no alignment rendered
- Audio padding failure: caught, original blob used, pipeline continues
- NL API / dictionary API failures: `try/catch` → fail open (proper nouns not forgiven rather than crash)
- Debug log: `initDebugLog()` / `addStage()` / `addWarning()` / `addError()` in `js/debug-logger.js` captures all pipeline stages for diagnostics

## Cross-Cutting Concerns

**Logging:** `js/debug-logger.js` — `addStage(name, data)` records each pipeline phase; `saveDebugLog()` exports JSON

**Normalization:** `js/text-normalize.js` — `normalizeText()` is canonical; must be mirrored in 5 places (`refPositions`, `splitForPunct`, `getPunctuationPositions`, `computePauseAtPunctuation`, and normalizeText itself)

**Text Equivalence:** `js/word-equivalences.js` — `getCanonical()` maps word variants to canonical forms (abbreviations, numbers, contractions); used by `alignment.js`

**Miscue Registry:** `js/miscue-registry.js` — single source of truth for all miscue types; must be updated whenever a miscue type is added/changed/removed

**Authentication:** No server-side auth for the main app; backend token optional (`BACKEND_TOKEN` in `backend-config.js`), passed as `Authorization: Bearer` header

**Cache Busting:** Query string versioning (`?v=YYYYMMDD...`) on ES module imports in `rhythm-remix.html` and `js/rhythm-remix.js`

**Service Worker:** `sw.js` — registered in `app.js` for PWA caching; `updateViaCache: 'none'` to prevent stale caching

---

*Architecture analysis: 2026-02-18*
