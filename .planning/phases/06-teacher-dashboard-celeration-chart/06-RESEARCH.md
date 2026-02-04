# Phase 6: Teacher Dashboard & Standard Celeration Chart - Research

**Researched:** 2026-02-02
**Domain:** Canvas semi-log charting, localStorage data bridging, audio playback with sync
**Confidence:** HIGH

## Summary

This phase ports a standalone ~1600-line vanilla JS celeration chart into ReadingQuest as an embedded dashboard view, fed from localStorage instead of JSON file imports. The standalone project (app.js) is well-structured with clear separation: CONFIG, state, drawing functions, celeration math, UI updates, and pattern detection. The port is mostly a refactoring/integration exercise rather than new development.

The critical gap is the data shape mismatch: the standalone chart expects `{ student, assessments[] }` where each assessment has `celeration.calendarDay`, `celeration.correctPerMinute`, `celeration.errorsPerMinute`, `performance.wpm`, `performance.accuracy`, and `prosody.score`. ReadingQuest's `saveAssessment` currently stores a flat object with `wcpm`, `accuracy`, `totalWords`, `errors`, `duration`, `passagePreview` -- missing celeration fields, detailed error breakdown, alignment data, and audio blob.

The audio playback requirement (TCHR-05) requires persisting either the audio blob or a reference to it, plus the STT word timestamps and alignment array, none of which are currently saved.

**Primary recommendation:** Extend `saveAssessment` to store the full assessment payload (alignment array, detailed error breakdown, STT word timestamps, audio as base64 or IndexedDB reference), then adapt the standalone chart's rendering core as an ES module that reads from localStorage via the existing storage API.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Canvas 2D API | native | Semi-log chart rendering | Already used in standalone; no dependencies needed |
| localStorage | native | Assessment persistence | Already the app's storage layer |
| IndexedDB | native | Audio blob storage | localStorage has ~5MB limit; audio blobs need IndexedDB |
| Audio API | native | Playback with seeking | Built-in, no library needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | - | - | This phase needs zero new dependencies |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Canvas 2D | Chart.js with logarithmic plugin | Would lose the custom SCC aesthetic and 6-cycle precision; standalone already works perfectly |
| IndexedDB raw | idb-keyval wrapper | Adds dependency for simple key-value blob storage; raw IndexedDB is fine for this use case |
| base64 audio in localStorage | IndexedDB for blobs | base64 inflates size 33%; a single 60s WAV at 16kHz mono is ~1.9MB raw, ~2.5MB base64; localStorage limit hit fast |

**Installation:** No new packages needed.

## Architecture Patterns

### Recommended Project Structure
```
js/
├── storage.js           # Extended: richer assessment schema, audio ref
├── celeration-chart.js  # NEW: ported chart rendering (ES module)
├── celeration-math.js   # NEW: extracted celeration calculations
├── audio-store.js       # NEW: IndexedDB wrapper for audio blobs
├── dashboard.js         # NEW: dashboard view controller
├── ui.js                # Extended: dashboard tab/view switching
└── app.js               # Extended: save richer assessment data
```

### Pattern 1: Data Schema Migration
**What:** Bump `orf_data.version` to 2, add migration in `storage.js` that backfills missing fields on old assessments with null values.
**When to use:** When extending the assessment object shape.
**Example:**
```javascript
// In storage.js migrate()
function migrate(data) {
  if (!data.version) data.version = 1;
  if (data.version === 1) {
    // v2: add detailed fields to assessments
    for (const a of data.assessments) {
      if (!a.errorBreakdown) a.errorBreakdown = null;
      if (!a.alignment) a.alignment = null;
      if (!a.sttWords) a.sttWords = null;
      if (!a.audioRef) a.audioRef = null;
    }
    data.version = 2;
  }
  return data;
}
```

### Pattern 2: Standalone Chart as ES Module
**What:** Extract the standalone app.js rendering core (drawChart, drawGrid, drawAxes, drawDataSeries, drawCelerationLine, valueToY, calculateCeleration, formatCeleration, pattern detection) into an ES module that accepts a canvas element and data array, removing all file-upload UI and global state.
**When to use:** For the embedded chart component.
**Example:**
```javascript
// celeration-chart.js
export function createChart(canvasEl, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const state = createInitialState(canvasEl);

  return {
    setData(assessments) { /* transform & store */ },
    setMetrics(metrics) { /* toggle metrics */ },
    setZoom(days) { /* zoom control */ },
    destroy() { /* cleanup listeners */ }
  };
}
```

### Pattern 3: Audio Blob in IndexedDB, Reference in localStorage
**What:** Store audio blobs in IndexedDB keyed by assessment ID. Store only the assessment ID reference in localStorage. On playback, fetch blob from IndexedDB.
**When to use:** For TCHR-05 audio playback.
**Example:**
```javascript
// audio-store.js
const DB_NAME = 'orf_audio';
const STORE_NAME = 'blobs';

export async function saveAudioBlob(assessmentId, blob) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(blob, assessmentId);
  await tx.complete;
}

export async function getAudioBlob(assessmentId) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  return tx.objectStore(STORE_NAME).get(assessmentId);
}
```

### Pattern 4: Word-Synced Audio Playback
**What:** Use saved STT word timestamps to highlight words during audio playback. Use `requestAnimationFrame` loop checking `audio.currentTime` against word start/end times.
**When to use:** For TCHR-05 teacher review.
**Example:**
```javascript
function syncPlayback(audioEl, sttWords, wordElements) {
  function tick() {
    const t = audioEl.currentTime;
    wordElements.forEach((el, i) => {
      const w = sttWords[i];
      const start = parseFloat(w.startTime?.replace('s', '')) || 0;
      const end = parseFloat(w.endTime?.replace('s', '')) || 0;
      el.classList.toggle('speaking', t >= start && t < end);
    });
    if (!audioEl.paused) requestAnimationFrame(tick);
  }
  audioEl.addEventListener('play', () => requestAnimationFrame(tick));
}
```

### Anti-Patterns to Avoid
- **Porting the entire standalone HTML/CSS:** Only port the JS rendering logic. The dashboard UI should use ReadingQuest's existing style patterns, not the standalone's separate HTML page.
- **Keeping global state:** The standalone uses `window.state`, `window.CONFIG` globals. The ES module version must encapsulate state.
- **Storing audio as base64 in localStorage:** Will hit the ~5MB storage limit after 2-3 assessments.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Semi-log chart | A new chart from scratch | Port the existing standalone app.js | Already has correct 6-cycle SCC math, grid rendering, celeration calculations |
| Celeration calculation | New regression math | Port `calculateCeleration()` and `formatCeleration()` from standalone | Log-linear regression already implemented and tested with real data |
| Pattern detection | New decline detection | Port `detectPatterns()` and `detectConsecutiveDeclines()` from standalone | Already handles edge cases |
| IndexedDB boilerplate | Full abstraction layer | Simple open/get/put helper (~30 lines) | Only need blob storage by key |

**Key insight:** The standalone celeration chart is production-quality with ~1600 lines of tested rendering code. The task is adaptation, not creation.

## Common Pitfalls

### Pitfall 1: Calendar Day Calculation
**What goes wrong:** The SCC x-axis is "successive calendar days" from first assessment. If you use absolute dates, points cluster wrong.
**Why it happens:** ReadingQuest stores ISO date strings; the chart needs integer day offsets from first assessment.
**How to avoid:** Compute `calendarDay` as `Math.floor((assessmentDate - firstAssessmentDate) / 86400000)` when transforming data for the chart.
**Warning signs:** All data points stacked at x=0 or huge gaps between points.

### Pitfall 2: Zero Values on Log Scale
**What goes wrong:** `Math.log10(0) = -Infinity`, crashes chart rendering.
**Why it happens:** Students can have 0 errors per minute (good!) but log scale cannot represent zero.
**How to avoid:** The standalone already handles this with `?` symbol for zero values and filtering `value > 0` for celeration lines. Preserve this behavior.
**Warning signs:** Canvas rendering stops, NaN coordinates.

### Pitfall 3: localStorage Size Limits
**What goes wrong:** Saving alignment arrays + STT word arrays + audio makes localStorage exceed ~5MB.
**Why it happens:** Each assessment's alignment array can be 200+ items; STT words another 200+; audio is megabytes.
**How to avoid:** Audio goes to IndexedDB. Alignment/STT words in localStorage are reasonable (~5-10KB per assessment). Monitor total size.
**Warning signs:** `QuotaExceededError` on `localStorage.setItem`.

### Pitfall 4: Canvas DPI Scaling
**What goes wrong:** Chart looks blurry on retina/high-DPI displays.
**Why it happens:** Canvas pixel dimensions differ from CSS dimensions.
**How to avoid:** The standalone already handles this in `resizeCanvas()` with `devicePixelRatio`. Port this function exactly.
**Warning signs:** Fuzzy lines, text looks pixelated.

### Pitfall 5: Data Shape Mismatch
**What goes wrong:** Chart expects `assessment.celeration.correctPerMinute`; ReadingQuest saves `assessment.wcpm`.
**Why it happens:** Two different data schemas from two different projects.
**How to avoid:** Create a transformer function that maps ReadingQuest assessments to the chart's expected format. Map `wcpm` to `correctPerMinute`, compute `errorsPerMinute` from `errors / (duration / 60)`, compute `calendarDay` from date.
**Warning signs:** No data points appearing on chart despite having assessments.

## Code Examples

### Transform ReadingQuest Assessment to Chart Format
```javascript
// Source: analysis of both codebases
function toChartAssessment(a, firstDate) {
  const date = new Date(a.date);
  const calendarDay = Math.floor((date - firstDate) / 86400000);
  const durationMin = (a.duration || 60) / 60;

  return {
    celeration: {
      date: a.date,
      calendarDay,
      countingTimeSec: a.duration || 60,
      countingTimeMin: durationMin,
      correctCount: a.totalWords - (a.errors || 0),
      errorCount: a.errors || 0,
      correctPerMinute: a.wcpm || 0,
      errorsPerMinute: durationMin > 0 ? (a.errors || 0) / durationMin : 0
    },
    performance: {
      totalWords: a.totalWords || 0,
      correctCount: a.totalWords - (a.errors || 0),
      accuracy: a.accuracy || 0,
      wpm: a.wcpm || 0
    }
  };
}
```

### Extended saveAssessment
```javascript
// Source: analysis of current storage.js + requirements
export function saveAssessment(studentId, results) {
  if (!studentId || !results) return null;
  const data = load();
  const assessment = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    studentId,
    date: new Date().toISOString(),
    wcpm: results.wcpm ?? null,
    accuracy: results.accuracy ?? null,
    totalWords: results.totalWords ?? null,
    errors: results.errors ?? null,
    duration: results.duration ?? null,
    passagePreview: results.passagePreview ?? null,
    // Phase 6 additions:
    errorBreakdown: results.errorBreakdown ?? null,  // {substitutions, omissions, insertions}
    alignment: results.alignment ?? null,              // [{ref, hyp, type}]
    sttWords: results.sttWords ?? null,                // [{word, startTime, endTime, confidence}]
    audioRef: results.audioRef ?? null                 // assessment ID key for IndexedDB lookup
  };
  data.assessments.push(assessment);
  save(data);
  return assessment;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Import JSON files into standalone chart | Auto-populate from localStorage | This phase | No manual data transfer needed |
| Audio not persisted | Audio in IndexedDB with assessment reference | This phase | Enables teacher audio review |
| Flat error count | Detailed error breakdown (sub/omit/insert + locations) | This phase | Enables TCHR-01 full error display |

## Open Questions

1. **How much of the standalone HTML/CSS to port?**
   - What we know: The chart canvas rendering is pure JS. The surrounding UI (sidebar controls, metric toggles, zoom buttons) is HTML/CSS specific to standalone.
   - What's unclear: Whether the dashboard should replicate the standalone's control panel or use simpler controls.
   - Recommendation: Build minimal controls (student selector already exists, add zoom buttons and metric toggles) using ReadingQuest's existing style. Do NOT port the standalone's HTML.

2. **Should old assessments (pre-Phase 6) appear on the chart?**
   - What we know: Old assessments have `wcpm` and `errors` but lack `errorsPerMinute` as a computed field.
   - What's unclear: Whether the transformer can derive enough data from old fields.
   - Recommendation: Yes -- the transformer function can compute `correctPerMinute` from `wcpm` and `errorsPerMinute` from `errors / (duration/60)`. Old assessments will have null alignment/audio but will chart fine.

3. **Audio blob cleanup policy?**
   - What we know: IndexedDB has much larger limits (hundreds of MB) but no auto-cleanup.
   - What's unclear: Whether to delete audio when assessment is deleted.
   - Recommendation: Delete audio blob from IndexedDB when its assessment is deleted. Add cleanup to `deleteStudent()`.

## Sources

### Primary (HIGH confidence)
- Standalone celeration chart app.js (1578 lines) - direct code analysis
- ReadingQuest storage.js, app.js, ui.js - direct code analysis
- Canvas 2D API - well-established browser API, no version concerns

### Secondary (MEDIUM confidence)
- localStorage 5MB limit - widely documented browser constraint
- IndexedDB for blob storage - standard pattern, browser support universal

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no external libraries needed, all browser-native APIs
- Architecture: HIGH - both codebases fully analyzed, integration path clear
- Pitfalls: HIGH - derived from concrete code analysis of both projects

**Research date:** 2026-02-02
**Valid until:** 2026-03-04 (stable; no external dependencies to drift)
