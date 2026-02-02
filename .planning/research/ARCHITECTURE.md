# Architecture Research

**Domain:** Browser-based Oral Reading Fluency (ORF) assessment
**Researched:** 2026-02-02
**Confidence:** HIGH

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Presentation Layer                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Teacher View  │  │ Student View │  │ Shared Components    │  │
│  │ (Dashboard)   │  │ (Playback)   │  │ (PassageInput, etc.) │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
├─────────┴─────────────────┴─────────────────────┴───────────────┤
│                      Application Layer                          │
│  ┌───────────┐ ┌───────────┐ ┌──────────┐ ┌────────────────┐   │
│  │ Assessment │ │ Alignment │ │ Scoring  │ │   Animation    │   │
│  │ Controller │ │  Engine   │ │  Engine  │ │    Engine      │   │
│  └─────┬─────┘ └─────┬─────┘ └────┬─────┘ └───────┬────────┘   │
├────────┴──────────────┴────────────┴───────────────┴────────────┤
│                      Service Layer                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │
│  │ Audio    │  │ STT      │  │ OCR      │  │ Data         │    │
│  │ Capture  │  │ Service  │  │ Service  │  │ Store        │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│                      External APIs                              │
│  ┌──────────────────────┐  ┌──────────────────────┐             │
│  │ Google Cloud STT     │  │ Google Cloud Vision   │             │
│  └──────────────────────┘  └──────────────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Audio Capture | Record mic audio, handle file uploads, produce blobs | MediaRecorder API wrapper, returns audio blob + encoding |
| STT Service | Send audio to Google STT, return structured word-level results | Fetch wrapper around speech:recognize and longrunningrecognize |
| OCR Service | Send camera photo to Google Vision, return extracted text | Fetch wrapper around Vision API annotateImage |
| Alignment Engine | Diff STT transcript against reference text, classify each word | LCS/edit-distance algorithm producing word-level alignment array |
| Scoring Engine | Compute WCPM, accuracy, error counts, pause detection from alignment | Pure function: alignment + timestamps in, metrics out |
| Animation Engine | Animate character hopping across words synced to timestamps | requestAnimationFrame loop driven by word timestamp array |
| Assessment Controller | Orchestrate full assessment flow: capture -> STT -> align -> score -> display | Glue module connecting services to UI |
| Data Store | Persist assessments, student progress, settings to localStorage | Thin wrapper over localStorage with JSON serialization |
| Teacher View | Dashboard: assessment list, metrics, error breakdown, progress charts | DOM rendering, reads from Data Store |
| Student View | Animated playback with character and word highlighting | Canvas or DOM animation, reads assessment data |

## Recommended Project Structure

```
src/
├── index.html              # Shell HTML, entry point
├── styles/
│   ├── main.css            # Shared styles
│   ├── teacher.css         # Teacher dashboard styles
│   └── student.css         # Student playback styles
├── services/
│   ├── audio-capture.js    # Mic recording + file upload
│   ├── stt-service.js      # Google STT API (sync + async)
│   ├── ocr-service.js      # Google Vision API
│   └── data-store.js       # localStorage persistence
├── engines/
│   ├── alignment.js        # Reference-to-transcript diff (LCS)
│   ├── scoring.js          # WCPM, accuracy, error classification
│   └── animation.js        # Word-hop animation controller
├── views/
│   ├── router.js           # Simple hash-based view switching
│   ├── teacher/
│   │   ├── dashboard.js    # Assessment list + summary
│   │   ├── assessment.js   # Single assessment detail view
│   │   └── progress.js     # Student progress over time
│   └── student/
│       └── playback.js     # Animated reading playback
├── components/
│   ├── passage-input.js    # OCR photo + manual text entry
│   ├── audio-controls.js   # Record/upload UI
│   └── word-display.js     # Color-coded word rendering
└── app.js                  # Bootstrap, wire components together
```

### Structure Rationale

- **services/:** External API wrappers isolated from business logic. Each service has a single external dependency. Testable by mocking fetch.
- **engines/:** Pure computation modules with no DOM or API dependencies. Alignment and scoring are the clinical core -- keeping them pure makes them testable and reusable.
- **views/:** UI rendering grouped by user role (teacher vs student). Each view reads from Data Store and calls engines as needed.
- **components/:** Reusable UI pieces shared across views.
- **No build tool required initially.** Use ES modules (`<script type="module">`) natively supported in all modern browsers. Add a bundler only when file count or performance demands it.

## Architectural Patterns

### Pattern 1: Pipeline Architecture

**What:** The assessment flow is a linear pipeline: Audio -> STT -> Alignment -> Scoring -> Display. Each stage takes the output of the previous stage as input.
**When to use:** This is the core assessment flow. Every assessment runs through this exact pipeline.
**Trade-offs:** Simple to reason about and debug. Rigid -- hard to skip stages or reorder. Good fit here because the stages genuinely depend on each other.

```javascript
// assessment-controller.js
export async function runAssessment(audioBlob, encoding, referenceText, apiKey) {
  // Stage 1: STT
  const sttResult = await sttService.recognize(audioBlob, encoding, apiKey, referenceText);

  // Stage 2: Align
  const alignment = alignmentEngine.align(referenceText, sttResult.words);

  // Stage 3: Score
  const metrics = scoringEngine.compute(alignment, sttResult.duration);

  // Stage 4: Persist
  const assessment = { sttResult, alignment, metrics, timestamp: Date.now() };
  dataStore.saveAssessment(studentId, assessment);

  return assessment;
}
```

### Pattern 2: Event-Driven View Updates

**What:** Views subscribe to Data Store changes rather than being imperatively updated. When an assessment completes, the store emits an event and any visible view re-renders.
**When to use:** Decouples the pipeline from view rendering. Allows teacher and student views to update independently.
**Trade-offs:** Slight indirection. Worth it because two distinct views (teacher dashboard, student playback) consume the same data differently.

```javascript
// data-store.js
class DataStore {
  #listeners = [];

  onChange(fn) { this.#listeners.push(fn); }

  saveAssessment(studentId, assessment) {
    const data = this.#load();
    data.assessments.push({ studentId, ...assessment });
    localStorage.setItem('orf_data', JSON.stringify(data));
    this.#listeners.forEach(fn => fn('assessment-saved', assessment));
  }
}
```

### Pattern 3: Pure Engine Functions

**What:** Alignment and scoring engines are pure functions with no side effects, no DOM access, no API calls. Input data in, results out.
**When to use:** All computation that transforms data. Alignment, scoring, pause detection, error classification.
**Trade-offs:** Requires careful interface design (what goes in, what comes out). Pays off enormously in testability -- these are the modules most likely to have bugs and most important to get right.

```javascript
// alignment.js
export function align(referenceWords, spokenWords) {
  // Returns: Array<{ ref: string|null, spoken: string|null, type: 'correct'|'substitution'|'omission'|'insertion' }>
  // Pure LCS-based diff, no side effects
}

// scoring.js
export function compute(alignment, durationSeconds) {
  // Returns: { wcpm, accuracy, errorCounts: { substitutions, omissions, insertions }, pauses: [...] }
}
```

## Data Flow

### Primary Assessment Flow

```
[Teacher provides passage]
    │
    ├── OCR Photo ──→ [OCR Service] ──→ referenceText
    │                                        │
    └── Manual Type ─────────────────────────┘
                                             │
[Student reads aloud]                        │
    │                                        │
    ├── Mic Record ──→ [Audio Capture] ──→ audioBlob
    │                                        │
    └── File Upload ─────────────────────────┘
                                             │
                                             ▼
                                    [STT Service]
                                    Google Cloud STT
                                             │
                                             ▼
                                    sttResult: {
                                      words: [{ word, confidence,
                                               startTime, endTime }],
                                      alternatives: [...]
                                    }
                                             │
                             referenceText ──┤
                                             ▼
                                    [Alignment Engine]
                                             │
                                             ▼
                                    alignment: [
                                      { ref, spoken, type,
                                        confidence, timing }
                                    ]
                                             │
                                             ▼
                                    [Scoring Engine]
                                             │
                                             ▼
                                    metrics: {
                                      wcpm, accuracy,
                                      errorCounts, pauses
                                    }
                                             │
                            ┌────────────────┤
                            ▼                ▼
                    [Data Store]     [View Update Event]
                    localStorage      │           │
                                      ▼           ▼
                              [Teacher View] [Student View]
                              metrics/errors  animated playback
```

### Data Store Schema

```javascript
{
  settings: {
    apiKey: string,          // persisted so teacher doesn't re-enter
    defaultStudentId: string
  },
  students: {
    [studentId]: {
      name: string,
      grade: number
    }
  },
  assessments: [
    {
      id: string,            // crypto.randomUUID()
      studentId: string,
      timestamp: number,
      passage: string,       // reference text
      sttResult: { words, alternatives },
      alignment: [...],
      metrics: { wcpm, accuracy, errorCounts, pauses },
      audioBlob: null        // NOT stored (too large for localStorage)
    }
  ]
}
```

### Key Data Flows

1. **OCR Flow:** Camera capture -> base64 encode -> Vision API -> text extraction -> passage input field. Independent of assessment pipeline; runs before student reads.
2. **Assessment Pipeline:** Audio blob -> STT -> alignment -> scoring -> persistence. Linear, each stage depends on previous.
3. **Playback Flow:** Load assessment from store -> word array with timestamps -> animation engine plays through words at recorded pace, highlighting and animating character.
4. **Progress Flow:** Load all assessments for student -> compute trend data (WCPM over time, error pattern changes) -> render charts.

## Build Order (Dependencies)

This is the critical section for roadmap phase structure. Components have natural dependencies:

```
Level 0 (no dependencies):
  - data-store.js        (standalone localStorage wrapper)
  - audio-capture.js     (standalone MediaRecorder wrapper)

Level 1 (depends on Level 0):
  - stt-service.js       (needs audio blob from audio-capture)
  - ocr-service.js       (standalone API wrapper, but needs data-store for API key)

Level 2 (depends on Level 1):
  - alignment.js         (needs STT result + reference text)

Level 3 (depends on Level 2):
  - scoring.js           (needs alignment output)

Level 4 (depends on Level 3):
  - teacher dashboard    (needs scoring output + data-store)
  - animation.js         (needs alignment + STT timestamps)

Level 5 (depends on Level 4):
  - student playback     (needs animation engine + assessment data)
  - progress tracking    (needs multiple assessments in store)
```

**Suggested build order for phases:**

1. **Extract and modularize** -- Pull existing code into modules (audio-capture, stt-service, data-store). No new features, just structure.
2. **OCR pipeline** -- Add ocr-service.js and passage-input component. Teacher can now photograph a page.
3. **Alignment engine** -- Core diff algorithm. This is the hardest, most important module. Build it with thorough test cases.
4. **Scoring engine** -- WCPM, accuracy, error counts. Straightforward once alignment exists.
5. **Teacher dashboard** -- Display metrics, error breakdown, assessment history. Reads from data-store.
6. **Animation engine + student playback** -- Most complex UI work, but no dependency on earlier stages being perfect.
7. **Progress tracking** -- Requires multiple assessments to exist. Build last.

## Anti-Patterns

### Anti-Pattern 1: Storing Audio in localStorage

**What people do:** Base64-encode audio blobs and stuff them into localStorage alongside assessment data.
**Why it's wrong:** A 60-second WebM file is ~500KB-1MB. localStorage has a ~5MB limit. Five assessments and you're full. Silently fails or corrupts all stored data.
**Do this instead:** Store only structured data (alignment, metrics, timestamps) in localStorage. Audio is ephemeral -- used during the assessment pipeline then discarded. If audio replay is needed later, use IndexedDB (which has much higher storage limits) as a separate concern.

### Anti-Pattern 2: Monolithic Assessment Function

**What people do:** One giant function that records audio, calls STT, aligns, scores, and updates the DOM.
**Why it's wrong:** Untestable, impossible to reuse stages independently, difficult to debug which stage failed.
**Do this instead:** Pipeline pattern with discrete stages. Each engine is a pure function. The controller orchestrates but doesn't compute.

### Anti-Pattern 3: Synchronous DOM Manipulation During Pipeline

**What people do:** Update the DOM at every pipeline stage (show spinner, show STT result, show alignment, show score) inside the pipeline function.
**Why it's wrong:** Couples business logic to presentation. Makes it impossible to run the pipeline in tests or reuse it for batch processing.
**Do this instead:** Pipeline returns a result object. Views subscribe to events or receive the result and render independently. Status updates go through a status emitter, not direct DOM calls.

### Anti-Pattern 4: Hardcoded Thresholds

**What people do:** Scatter magic numbers (0.9 for high confidence, 3s for pause detection, 150 WCPM for grade level) throughout the code.
**Why it's wrong:** ORF thresholds vary by grade level, student, and research basis. Changing them means hunting through code.
**Do this instead:** Centralize all thresholds in a config object (or in data-store settings). Reference them by name.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Google Cloud STT (sync) | POST to speech:recognize, returns inline | Max ~60s audio. Use for typical ORF passages. |
| Google Cloud STT (async) | POST to longrunningrecognize, poll operations.get | For passages >60s. Need polling logic with backoff. |
| Google Cloud Vision | POST to images:annotate with TEXT_DETECTION | Returns full text + bounding boxes. Use DOCUMENT_TEXT_DETECTION for better paragraph structure. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Services -> Engines | Function call (data in, data out) | Services produce structured data, engines consume it. No coupling. |
| Engines -> Views | Via Data Store events | Engines never touch DOM. Results go to store, store notifies views. |
| Views -> Services | Via Assessment Controller | Views don't call APIs directly. Controller orchestrates. |
| Router -> Views | Hash-change event | Simple #teacher / #student routing. Each view mounts/unmounts. |

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1 teacher, few students | Current design. localStorage is fine. Single HTML file origin. |
| Multiple teachers/classrooms | localStorage is per-browser. No data sharing. Add export/import JSON for portability. |
| School-wide deployment | Outgrows localStorage. Need a backend with database. This is explicitly out of scope for now but the modular architecture makes it a clean migration: swap data-store.js from localStorage to fetch-based API client. |

### Scaling Priorities

1. **First bottleneck: localStorage 5MB limit.** At roughly 2-5KB per assessment, that is ~1000-2500 assessments before hitting the wall. Mitigation: prune old assessments, offer JSON export, or migrate to IndexedDB for 50MB+ storage.
2. **Second bottleneck: API key management.** Every teacher enters their own key. For school-wide use, need a thin proxy or shared key management. Out of scope for now.

## Sources

- Google Cloud Speech-to-Text v1 REST API (existing integration in codebase)
- Google Cloud Vision API documentation (TEXT_DETECTION / DOCUMENT_TEXT_DETECTION)
- Existing codebase analysis: orf_assessment.html (236 lines)
- PROJECT.md requirements and constraints
- Web Speech API and MediaRecorder API (MDN, browser-native)

---
*Architecture research for: Browser-based ORF Assessment*
*Researched: 2026-02-02*
