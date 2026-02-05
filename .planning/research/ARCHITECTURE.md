# Architecture Research: Kitchen Sink Ensemble Integration

**Domain:** Browser-based oral reading fluency assessment with local GPU backend
**Researched:** 2026-02-05 (Updated from 2026-02-02 original)
**Confidence:** HIGH (based on existing codebase analysis + implementation plan)

## Executive Summary

This document describes the architecture for integrating the Kitchen Sink Ensemble (Reverb v1.0 + v0.0 + Google default) into the existing browser-based ReadingQuest application. The key change is adding a **local Reverb backend** (Python/FastAPI/Docker/GPU) while preserving the existing browser-only Google STT path as fallback.

**Key architectural decisions:**
1. **Service Adapter Pattern** - Normalize Reverb and Google responses to common interface
2. **Graceful Degradation** - Fall back to Google-only when Reverb offline
3. **New Algorithm for Disfluency** - Needleman-Wunsch alignment of v1.0 vs v0.0 (not post-hoc comparison)
4. **Cross-Vendor Validation** - Reverb vs Google disagreement flags hallucinations

---

## Current Architecture (v1.2)

### System Overview

```
                         CURRENT ARCHITECTURE (v1.2)
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BROWSER CLIENT                                     │
│                                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  ┌───────────────┐  │
│  │  recorder   │  │  file-       │  │  audio-        │  │  vad-         │  │
│  │  .js        │  │  handler.js  │  │  padding.js    │  │  processor.js │  │
│  │ (WebRTC)    │  │ (WAV upload) │  │ (500ms pad)    │  │ (Silero ONNX) │  │
│  └─────────┬───┘  └──────┬───────┘  └───────┬────────┘  └───────┬───────┘  │
│            │             │                   │                   │          │
│            └─────────────┴────────┬──────────┴───────────────────┘          │
│                                   │                                         │
│                                   ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                          app.js (Orchestrator)                         │ │
│  │   - Controls pipeline flow                                             │ │
│  │   - Manages app state (audioBlob, encoding, studentId)                 │ │
│  │   - Coordinates STT -> Merge -> Classify -> Filter -> Disfluency -> Align │
│  └─────────────────────────────────┬──────────────────────────────────────┘ │
│                                    │                                        │
│       ┌────────────────────────────┼────────────────────────────────┐       │
│       │                            │                                │       │
│       ▼                            ▼                                ▼       │
│  ┌─────────────┐          ┌─────────────────┐          ┌─────────────────┐  │
│  │  stt-api.js │          │ ensemble-       │          │ alignment.js    │  │
│  │             │          │ merger.js       │          │ (diff-match-    │  │
│  │ - sendToSTT │          │                 │          │  patch)         │  │
│  │ - ensemble  │          │ - Trust hier.   │          │                 │  │
│  │   STT       │          │ - Ref Veto      │          │ - alignWords()  │  │
│  │ - async STT │          │ - Deduplication │          │ - mergeCompound │  │
│  └──────┬──────┘          └────────┬────────┘          └────────┬────────┘  │
│         │                          │                            │           │
└─────────┼──────────────────────────┼────────────────────────────┼───────────┘
          │                          │                            │
          ▼                          │                            │
┌─────────────────────┐              │                            │
│   Google Cloud      │              │                            │
│   Speech-to-Text    │──────────────┘                            │
│                     │                                           │
│   - latest_long     │                                           │
│   - default         │                                           │
│   REST API (browser)│                                           │
└─────────────────────┘                                           │
                                                                  │
                              ┌────────────────────────────────────┘
                              ▼
                     ┌─────────────────────┐
                     │   Reference Text    │
                     │   (textarea/OCR)    │
                     └─────────────────────┘
```

### Component Responsibilities (Current)

| Component | Responsibility | File |
|-----------|----------------|------|
| **recorder.js** | WebRTC audio capture, WAV encoding | `js/recorder.js` |
| **file-handler.js** | WAV file upload handling | `js/file-handler.js` |
| **audio-padding.js** | Add 500ms silence to help ASR resolve final word | `js/audio-padding.js` |
| **vad-processor.js** | Silero VAD via ONNX for ghost detection | `js/vad-processor.js` |
| **stt-api.js** | Google Cloud STT REST client (latest_long + default ensemble) | `js/stt-api.js` |
| **ensemble-merger.js** | Two-pass word association, Reference Veto, deduplication | `js/ensemble-merger.js` |
| **ghost-detector.js** | Flag latest_only words with no VAD speech overlap | `js/ghost-detector.js` |
| **confidence-classifier.js** | Classify word confidence levels, filter ghosts | `js/confidence-classifier.js` |
| **disfluency-detector.js** | Tag morphological breaks (simplified from prior attempts) | `js/disfluency-detector.js` |
| **alignment.js** | Needleman-Wunsch alignment via diff-match-patch | `js/alignment.js` |
| **diagnostics.js** | Hesitation detection, long pauses, prosody proxy | `js/diagnostics.js` |
| **app.js** | Pipeline orchestration, state management | `js/app.js` |

### Current Data Flow

```
Audio Blob
    │
    ├──▶ padAudioWithSilence() -> LINEAR16 WAV
    │
    ├──▶ sendEnsembleSTT() ──▶ Google Cloud (parallel: latest_long + default)
    │         │
    │         ▼
    │    mergeEnsembleResults(referenceText)
    │         │
    │         ├─ Two-pass word association
    │         ├─ Reference Veto (when models disagree)
    │         ├─ Phantom filtering (<10ms duration)
    │         ├─ Deduplication (timestamp drift)
    │         └─ Morphological prefix absorption
    │
    ├──▶ vadProcessor.processAudio() -> VAD segments
    │         │
    │         ▼
    │    flagGhostWords() -> mark vad_ghost_in_reference
    │
    └──▶ classifyAllWords() -> trustLevel (high/medium/low/ghost)
              │
              ▼
         filterGhosts() -> remove confidence=0.0 words
              │
              ▼
         detectDisfluencies() -> tag morphological breaks
              │
              ▼
         applySafetyChecks() -> rate anomalies, collapse detection
              │
              ▼
         alignWords(referenceText, processedWords)
              │
              ▼
         runDiagnostics() -> hesitations, long pauses, prosody
              │
              ▼
         computeWCPM(), computeAccuracy()
              │
              ▼
         displayAlignmentResults()
```

---

## Proposed Architecture (v1.3 Kitchen Sink)

### System Overview

```
                         PROPOSED ARCHITECTURE (v1.3)
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BROWSER CLIENT                                     │
│                                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  ┌───────────────┐  │
│  │  recorder   │  │  file-       │  │  audio-        │  │  vad-         │  │
│  │  .js        │  │  handler.js  │  │  padding.js    │  │  processor.js │  │
│  └─────────┬───┘  └──────┬───────┘  └───────┬────────┘  └───────┬───────┘  │
│            │             │                   │                   │          │
│            └─────────────┴────────┬──────────┴───────────────────┘          │
│                                   │                                         │
│                                   ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    kitchen-sink-orchestrator.js [NEW]                  │ │
│  │   - Coordinates parallel API calls                                     │ │
│  │   - Handles Reverb availability check                                  │ │
│  │   - Falls back to Google-only if Reverb offline                        │ │
│  └─────────────────────────────────┬──────────────────────────────────────┘ │
│                                    │                                        │
│       ┌────────────────────────────┼────────────────────────────────────┐   │
│       │                            │                                    │   │
│       ▼                            ▼                                    ▼   │
│  ┌─────────────┐          ┌─────────────────┐          ┌─────────────────┐ │
│  │ reverb-     │          │ stt-api.js      │          │ sequence-       │ │
│  │ api.js      │          │ (existing)      │          │ aligner.js      │ │
│  │ [NEW]       │          │                 │          │ [NEW]           │ │
│  │             │          │ - sendToSTT     │          │                 │ │
│  │ - checkHlth │          │   (Google)      │          │ - Needleman-    │ │
│  │ - transcrib │          │                 │          │   Wunsch        │ │
│  │   Ensemble  │          │                 │          │ - findDisfluency│ │
│  │   (v1+v0)   │          │                 │          │   Indices       │ │
│  └──────┬──────┘          └────────┬────────┘          └────────┬────────┘ │
│         │                          │                            │          │
│         │                          │                            ▼          │
│         │                          │          ┌─────────────────────────┐  │
│         │                          │          │ disfluency-tagger.js    │  │
│         │                          │          │ [NEW]                   │  │
│         │                          │          │                         │  │
│         │                          │          │ - tagDisfluencies()     │  │
│         │                          │          │ - classify: filler,     │  │
│         │                          │          │   repetition, false_    │  │
│         │                          │          │   start, other          │  │
│         │                          │          └────────────┬────────────┘  │
│         │                          │                       │               │
│         └──────────────────┬───────┴───────────────────────┘               │
│                            │                                               │
│                            ▼                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐│
│  │                    kitchen-sink-merger.js [NEW]                        ││
│  │                                                                        ││
│  │   - Combine Reverb + Google results                                    ││
│  │   - Cross-vendor validation (disagreement = flag for review)           ││
│  │   - Trust hierarchy: Reverb text > Reverb timestamps > Google conf     ││
│  │   - Output: words[] with isDisfluency, disfluencyType, crossValidation ││
│  └─────────────────────────────────┬──────────────────────────────────────┘│
│                                    │                                       │
│                                    ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐│
│  │               EXISTING PIPELINE (mostly unchanged)                     ││
│  │                                                                        ││
│  │   confidence-classifier.js -> ghost-detector.js -> disfluency-detector.js
│  │            -> alignment.js -> diagnostics.js -> metrics.js -> ui.js    ││
│  └────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
          │                          │
          ▼                          ▼
┌─────────────────────┐    ┌─────────────────────┐
│   Reverb Backend    │    │   Google Cloud      │
│   [NEW]             │    │   Speech-to-Text    │
│                     │    │   (existing)        │
│   - FastAPI server  │    │                     │
│   - Docker + GPU    │    │   - latest_long     │
│   - /ensemble       │    │   - default         │
│     endpoint        │    │                     │
│   - Returns v=1.0   │    │                     │
│     and v=0.0       │    │                     │
│                     │    │                     │
│   localhost:8765    │    │   REST API          │
└─────────────────────┘    └─────────────────────┘
```

### New Components

| Component | Responsibility | Integration Points |
|-----------|----------------|-------------------|
| **reverb-api.js** [NEW] | HTTP client for local Reverb service | Calls localhost:8765/ensemble |
| **sequence-aligner.js** [NEW] | Needleman-Wunsch text alignment (v1.0 vs v0.0) | Pure function, no external deps |
| **disfluency-tagger.js** [NEW] | Classify disfluencies (filler, repetition, false_start) | Uses sequence-aligner output |
| **kitchen-sink-merger.js** [NEW] | Combine Reverb + Google, cross-validation | Replaces ensemble-merger.js for new flow |
| **kitchen-sink-orchestrator.js** [NEW] | Coordinate parallel API calls, fallback logic | Replaces sendEnsembleSTT for new flow |
| **services/reverb/server.py** [NEW] | FastAPI server wrapping Reverb model | Docker container with GPU |

### Existing Components (Modifications)

| Component | Modification Required |
|-----------|----------------------|
| **app.js** | Add feature flag to switch between Google-only and Kitchen Sink modes |
| **stt-api.js** | None - still used for Google fallback and validation |
| **ensemble-merger.js** | None - becomes fallback when Reverb unavailable |
| **disfluency-detector.js** | None - Kitchen Sink uses new tagger, old code remains for fallback |
| **alignment.js** | None - still used for reference alignment |
| **diagnostics.js** | None - still used for hesitations, pauses |

---

## Integration Points

### 1. Audio Input (Unchanged)

```
recorder.js / file-handler.js
    │
    ▼
appState.audioBlob (Blob, WAV or WebM)
```

No changes needed. Kitchen Sink orchestrator receives the same `audioBlob`.

### 2. API Abstraction Layer (New)

**Pattern: Service Adapter**

```javascript
// reverb-api.js
export async function checkHealth() { ... }
export async function transcribeEnsemble(audioBlob) {
  // Returns: { verbatim: {...}, clean: {...} }
}

// stt-api.js (existing)
export async function sendToSTT(blob, encoding) { ... }
export async function sendEnsembleSTT(blob, encoding, sampleRate) { ... }
```

Both APIs return normalized word structures:
```typescript
interface Word {
  word: string;
  startTime: string;  // "1.400s"
  endTime: string;    // "1.600s"
  confidence: number; // 0.0-1.0
}
```

### 3. Disfluency Detection (New Algorithm)

**Previous approach (failed):** Compare words from two Google models, flag differences
**Problem:** STT loses acoustic signal; timestamp drift caused false positives

**New approach:** Needleman-Wunsch global alignment of Reverb v1.0 vs v0.0
**Why it works:**
- Same model, same encoder, same CTC clock
- v=0.0 explicitly removes disfluencies during decoding
- Text match provides "gravity" - drift becomes irrelevant
- Insertions in v1.0 (not in v0.0) = disfluencies

```javascript
// sequence-aligner.js
export function alignSequences(cleanWords, verbatimWords) {
  // Returns: { operations: [...], stats: {...} }
}

export function findDisfluencyIndices(cleanWords, verbatimWords) {
  // Returns: Set<number> of verbatim indices that are disfluencies
}
```

### 4. Cross-Vendor Validation (New)

**Purpose:** Catch hallucinations that Reverb might introduce

```javascript
// kitchen-sink-merger.js
function crossValidate(reverbWord, googleWords) {
  // Find Google word at same timestamp
  // Agreement -> high confidence
  // Disagreement -> flag for review, apply Reference Veto logic
}
```

### 5. Fallback Chain

```
┌───────────────────────────────────────────────────────────────┐
│                      Availability Check                       │
└───────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┴─────────────────────┐
        │                                           │
        ▼                                           ▼
   Reverb Online                              Reverb Offline
        │                                           │
        ▼                                           ▼
  Kitchen Sink Mode                         Google-Only Mode
  (Reverb + Google)                         (existing pipeline)
        │                                           │
        ├──▶ Reverb ensemble (v1.0 + v0.0)         │
        ├──▶ Google STT (parallel)                 │
        ├──▶ N-W disfluency tagging                │
        ├──▶ Cross-validation                      │
        └──▶ Merge to unified format ──────────────┴──▶ Continue pipeline
```

---

## Data Flow (Proposed v1.3)

```
Audio Blob
    │
    ├──▶ checkReverbHealth()
    │         │
    │    ┌────┴────┐
    │    │         │
    │    ▼         ▼
    │  Online   Offline -> Fall back to Google-only (existing)
    │    │
    │    ▼
    ├──▶ PARALLEL CALLS:
    │    ├─▶ transcribeEnsemble(audioBlob) -> Reverb (localhost:8765)
    │    │       └─▶ { verbatim: words[], clean: words[] }
    │    │
    │    └─▶ sendToSTT(audioBlob) -> Google Cloud
    │            └─▶ { results: [...] }
    │
    ├──▶ alignSequences(clean, verbatim)
    │         │
    │         ▼
    │    findDisfluencyIndices() -> Set<index>
    │
    ├──▶ tagDisfluencies(verbatim, clean)
    │         │
    │         ▼
    │    words[] with isDisfluency, disfluencyType
    │
    ├──▶ crossValidate(reverb, google)
    │         │
    │         ▼
    │    words[] with crossValidation status
    │
    └──▶ EXISTING PIPELINE:
         │
         ├─▶ classifyAllWords() -> trustLevel
         ├─▶ filterGhosts() -> remove ghosts
         ├─▶ alignWords(reference, words)
         ├─▶ runDiagnostics() -> hesitations, pauses
         ├─▶ computeMetrics()
         └─▶ displayResults()
```

---

## File Structure

### New Files

```
js/
├── reverb-api.js           # NEW: HTTP client for Reverb service
├── sequence-aligner.js     # NEW: Needleman-Wunsch for v1.0 vs v0.0
├── disfluency-tagger.js    # NEW: Classify disfluencies from alignment
├── kitchen-sink-merger.js  # NEW: Combine Reverb + Google results
├── kitchen-sink-orchestrator.js  # NEW: Coordinate parallel API calls
│
├── stt-api.js              # EXISTING: Google STT client (unchanged)
├── ensemble-merger.js      # EXISTING: Google ensemble merger (fallback)
├── alignment.js            # EXISTING: Reference text alignment (unchanged)
├── diagnostics.js          # EXISTING: Hesitations, pauses (unchanged)
├── app.js                  # MODIFIED: Feature flag for Kitchen Sink mode
└── ...

services/
└── reverb/
    ├── server.py           # NEW: FastAPI server
    ├── Dockerfile          # NEW: Container config
    ├── docker-compose.yml  # NEW: Service orchestration
    └── requirements.txt    # NEW: Python dependencies
```

### Existing Files (24 JS modules)

```
js/
├── alignment.js            # Reference-to-transcript diff (unchanged)
├── app.js                  # Main orchestrator (modified: add mode switch)
├── audio-padding.js        # Silence padding (unchanged)
├── audio-playback.js       # Audio controls (unchanged)
├── audio-store.js          # IndexedDB audio storage (unchanged)
├── benchmarks.js           # Grade-level benchmarks (unchanged)
├── celeration-chart.js     # Progress charts (unchanged)
├── confidence-classifier.js # Trust levels (unchanged)
├── confidence-config.js    # Threshold config (unchanged)
├── dashboard.js            # Teacher dashboard (unchanged)
├── debug-logger.js         # Debug log utility (unchanged)
├── diagnostics.js          # Hesitations, pauses (unchanged)
├── disfluency-config.js    # Disfluency thresholds (unchanged)
├── disfluency-detector.js  # Existing detector (fallback)
├── effect-engine.js        # Visual effects (unchanged)
├── ensemble-merger.js      # Google ensemble (fallback)
├── file-handler.js         # File upload (unchanged)
├── gamification.js         # Achievement system (unchanged)
├── ghost-detector.js       # VAD ghost flagging (unchanged)
├── metrics.js              # WCPM calculation (unchanged)
├── miscue-registry.js      # Miscue type registry (unchanged)
├── nl-api.js               # Natural Language API (unchanged)
├── ocr-api.js              # Vision OCR (unchanged)
├── passage-trimmer.js      # OCR passage trim (unchanged)
├── phonetic-utils.js       # Phonetic matching (unchanged)
├── recorder.js             # Audio recording (unchanged)
├── safety-checker.js       # Rate anomalies (unchanged)
├── safety-config.js        # Safety thresholds (unchanged)
├── sprite-animator.js      # Character animation (unchanged)
├── storage.js              # localStorage wrapper (unchanged)
├── student-playback.js     # Playback UI (unchanged)
├── stt-api.js              # Google STT client (unchanged)
├── text-normalize.js       # Text normalization (unchanged)
├── ui.js                   # DOM rendering (unchanged)
├── vad-gap-analyzer.js     # VAD gap analysis (unchanged)
├── vad-processor.js        # Silero VAD (unchanged)
└── word-equivalences.js    # Synonym mapping (unchanged)
```

---

## Architectural Patterns

### Pattern 1: Service Adapter

**What:** Abstract external API differences behind consistent interface
**When:** Multiple backends with different response formats

```javascript
// reverb-api.js
function normalizeWord(w) {
  return {
    word: w.word,
    startTime: `${w.start_time}s`,
    endTime: `${w.end_time}s`,
    confidence: w.confidence
  };
}

// stt-api.js (existing pattern)
// Already returns normalized format with startTime: "1.400s"
```

### Pattern 2: Graceful Degradation

**What:** Fallback to reduced functionality when service unavailable
**When:** Optional backend service (Reverb) may be offline

```javascript
// kitchen-sink-orchestrator.js
export async function runKitchenSinkEnsemble(audioBlob, encoding) {
  const reverbUp = await checkHealth();

  if (!reverbUp) {
    console.log('[Kitchen Sink] Reverb offline, using Google-only mode');
    return runGoogleOnlyEnsemble(audioBlob, encoding);  // Existing path
  }

  // Full Kitchen Sink path
  ...
}
```

### Pattern 3: Parallel Execution with Independent Failure

**What:** Run multiple async operations in parallel, handle failures independently
**When:** Multiple API calls that don't depend on each other

```javascript
const [reverbResult, googleResult] = await Promise.allSettled([
  transcribeEnsemble(audioBlob),
  sendToSTT(audioBlob, encoding)
]);

// Handle each result independently
if (reverbResult.status === 'rejected') {
  errors.push(`Reverb: ${reverbResult.reason}`);
}
```

### Pattern 4: Pure Engine Functions (Existing)

**What:** Alignment and scoring engines are pure functions with no side effects
**When:** All computation that transforms data

```javascript
// sequence-aligner.js (NEW - follows existing pattern)
export function alignSequences(cleanWords, verbatimWords) {
  // Pure function: arrays in, alignment out
  // No DOM, no API calls, no side effects
}
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Synchronous Service Calls

**What people do:** Await Reverb, then await Google sequentially
**Why it's wrong:** Doubles latency unnecessarily
**Do this instead:** `Promise.allSettled([reverb, google])`

### Anti-Pattern 2: Tight Coupling to Backend Response Format

**What people do:** Access `response.verbatim.words[0].start_time` directly throughout codebase
**Why it's wrong:** Backend format change requires changes everywhere
**Do this instead:** Normalize at API boundary (reverb-api.js), use consistent internal format

### Anti-Pattern 3: Feature Flag Sprawl

**What people do:** Add `if (kitchenSinkEnabled)` checks throughout app.js
**Why it's wrong:** Makes code unreadable, increases maintenance burden
**Do this instead:** Create kitchen-sink-orchestrator.js that encapsulates the mode decision

### Anti-Pattern 4: Assuming Backend Always Available

**What people do:** Call Reverb without checking health first
**Why it's wrong:** User sees cryptic error on ECONNREFUSED
**Do this instead:** Health check with fallback message: "Reverb offline, using Google-only"

### Anti-Pattern 5: Storing Audio in localStorage (Existing Warning)

**What people do:** Base64-encode audio blobs in localStorage
**Why it's wrong:** localStorage has ~5MB limit; audio fills it quickly
**Do this instead:** Already solved - using IndexedDB via audio-store.js

---

## Build Order Recommendation

### Phase 1: Backend Service (Foundation)

**Why first:** Can't develop JS integration without working backend
**Deliverables:**
1. `services/reverb/server.py` - FastAPI server
2. `services/reverb/Dockerfile` - Container
3. `services/reverb/docker-compose.yml` - GPU support
4. Health check endpoint working

**Verification:** `curl localhost:8765/health` returns `{"status": "ok"}`

**Dependencies:** None (standalone)

### Phase 2: Browser API Client

**Why second:** Needs backend to test against
**Deliverables:**
1. `js/reverb-api.js` - HTTP client with normalized response
2. Health check integration
3. Error handling

**Verification:** Browser console shows Reverb responses

**Dependencies:** Phase 1 (backend running)

### Phase 3: Sequence Aligner

**Why third:** Pure function, can test independently
**Deliverables:**
1. `js/sequence-aligner.js` - Needleman-Wunsch implementation
2. Unit tests for alignment edge cases

**Verification:** Test cases from implementation plan pass

**Dependencies:** None (pure function)

### Phase 4: Disfluency Tagger

**Why fourth:** Depends on sequence aligner
**Deliverables:**
1. `js/disfluency-tagger.js` - Classify disfluencies
2. Integration with sequence aligner

**Verification:** Fillers, repetitions, false starts correctly tagged

**Dependencies:** Phase 3 (sequence-aligner.js)

### Phase 5: Kitchen Sink Merger

**Why fifth:** Needs all pieces above
**Deliverables:**
1. `js/kitchen-sink-merger.js` - Combine Reverb + Google
2. Cross-validation logic
3. Trust hierarchy implementation

**Verification:** Merged output has expected properties

**Dependencies:** Phases 2, 3, 4

### Phase 6: Orchestrator + Integration

**Why last:** Ties everything together
**Deliverables:**
1. `js/kitchen-sink-orchestrator.js` - Coordinate flow
2. `app.js` modifications - Feature flag
3. Fallback logic
4. UI updates (disfluency display)

**Verification:** Full end-to-end test with real audio

**Dependencies:** All previous phases

---

## Trust Hierarchy (v1.3)

| Property | v1.2 Source | v1.3 Source | Rationale |
|----------|-------------|-------------|-----------|
| **Word text** | latest_long (Google) | Reverb v=1.0 | 200k hours training, Conformer architecture |
| **Timestamps** | default (Google) | Reverb v=1.0 | Same model for consistency |
| **Confidence** | default (Google) | Defaults (0.9/0.7) | Reverb CTM has 0.00 values |
| **Disfluencies** | (none reliable) | N-W diff(v1.0, v0.0) | Model-level decision, not post-hoc |
| **Hallucination check** | VAD + ghost detector | Reverb vs Google disagreement | Cross-vendor = uncorrelated errors |

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Single user (current) | Docker container, single GPU, synchronous requests |
| 10 concurrent users | GPU lock prevents OOM; queue requests |
| 100+ users | Out of scope - would need cloud deployment |

**First bottleneck:** GPU memory (8GB VRAM limits concurrent requests)
**Mitigation:** `gpu_lock = asyncio.Lock()` in server.py

**Second bottleneck:** localStorage 5MB limit (existing concern)
**Mitigation:** Already using IndexedDB for audio; consider for assessments if needed

---

## Sources

### Existing Codebase (HIGH confidence)
- `js/app.js` - Current pipeline orchestration (1265 lines)
- `js/stt-api.js` - Google STT client (338 lines)
- `js/ensemble-merger.js` - Current two-model merge (888 lines)
- `js/alignment.js` - Needleman-Wunsch via diff-match-patch (163 lines)
- `js/disfluency-detector.js` - Why previous approach was abandoned (259 lines)
- `js/vad-processor.js` - Silero VAD integration (270 lines)
- `js/ghost-detector.js` - VAD-based hallucination detection (174 lines)

### Implementation Plan (HIGH confidence)
- `FuturePlans/0 Kitchen-Sink-Ensemble-Implementation-Plan.md` (1014 lines)
- Phase 0 verification results (2026-02-05)
- Reverb paper verbatimicity findings

### Reverb ASR (MEDIUM confidence - paper claims, not production tested)
- [arXiv paper](https://arxiv.org/html/2410.03930v2) - Table 5 verbatimicity behavior
- CTM format verified via Phase 0 testing
- "gonna" preservation confirmed (no normalization in v0.0)

---

*Architecture research for: Kitchen Sink Ensemble Integration*
*Researched: 2026-02-05*
*Updates: Added Reverb backend, new disfluency algorithm, cross-vendor validation*
