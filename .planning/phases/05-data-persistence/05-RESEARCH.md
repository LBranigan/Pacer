# Phase 5: Data Persistence - Research

**Researched:** 2026-02-02
**Domain:** localStorage, student profiles, assessment history
**Confidence:** HIGH

## Summary

This phase adds localStorage-based persistence for student profiles and assessment history. The app currently holds all state in memory (`appState` in app.js) and discards everything on page reload. The data to persist is well-defined: alignment array, wcpm, accuracy, diagnostics, sttWords, allGaps, and transcriptWords -- all JSON-serializable.

localStorage is the correct choice for this use case: synchronous, simple, up to 5-10MB per origin (browser-dependent), and no external dependencies. The data volume is small -- each assessment record is roughly 5-50KB depending on passage length. Even with hundreds of assessments, total storage stays well under limits.

No external libraries are needed. This is pure vanilla JS working with `JSON.stringify`/`JSON.parse` and `localStorage.getItem`/`setItem`.

**Primary recommendation:** Create a `storage.js` module that encapsulates all localStorage access behind a clean API. Use a single top-level key (e.g., `orf_data`) containing `{students: [...], assessments: [...]}` to avoid key proliferation. Generate IDs with `crypto.randomUUID()`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| localStorage (built-in) | Web API | Key-value persistence | Built into every browser, synchronous, zero dependencies |
| crypto.randomUUID() (built-in) | Web API | Unique IDs for students/assessments | Built-in, no library needed, available in all modern browsers |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none needed) | - | - | - |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| localStorage | IndexedDB | More powerful but async, complex API; overkill for <1MB of JSON data |
| localStorage | sessionStorage | Does not persist across sessions -- defeats the purpose |
| crypto.randomUUID() | Date.now() + Math.random() | UUID is cleaner and collision-proof |

**Installation:** None. All built-in browser APIs.

## Architecture Patterns

### Recommended Project Structure
```
js/
├── storage.js        # NEW: all localStorage read/write, student CRUD, assessment save/load
├── app.js            # MODIFIED: wire storage into assessment flow, save results after analysis
├── ui.js             # MODIFIED: add student selector UI, history view
└── (existing files unchanged)
```

### Pattern 1: Single Storage Key with Structured Data
**What:** Store all app data under one localStorage key as a JSON object
**When to use:** Always -- avoids key proliferation, easier to export/debug
**Example:**
```javascript
// storage.js
const STORAGE_KEY = 'orf_data';

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultData();
  } catch {
    return defaultData();
  }
}

function save(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function defaultData() {
  return { students: [], assessments: [] };
}
```

### Pattern 2: Student Profile Schema
**What:** Minimal student record with ID and name
**When to use:** Creating/selecting students
**Example:**
```javascript
// Student object
{
  id: crypto.randomUUID(),     // "a1b2c3d4-..."
  name: "Jane Smith",
  createdAt: "2026-02-02T10:30:00Z"
}
```

### Pattern 3: Assessment Record Schema
**What:** Snapshot of assessment results linked to a student
**When to use:** Saving completed assessments
**Example:**
```javascript
// Assessment record -- store computed results, NOT raw STT response
{
  id: crypto.randomUUID(),
  studentId: "a1b2c3d4-...",
  date: "2026-02-02T10:35:00Z",
  passageText: "The cat sat on the mat...",
  wcpm: { wcpm: 85, correctCount: 42, elapsedSeconds: 30 },
  accuracy: { accuracy: 92, correctCount: 42, totalRefWords: 46, substitutions: 2, omissions: 2, insertions: 1 },
  alignment: [ /* the alignment array */ ],
  diagnostics: { /* prosody, pauses, etc */ }
  // Do NOT store: audioBlob (too large for localStorage), raw STT response (redundant)
}
```

### Pattern 4: Repository-Style API
**What:** Export functions for each operation, hiding localStorage details
**When to use:** Always -- keeps storage logic out of app.js and ui.js
**Example:**
```javascript
// storage.js exports
export function getStudents() { ... }
export function addStudent(name) { ... }
export function deleteStudent(id) { ... }
export function getAssessments(studentId) { ... }
export function saveAssessment(studentId, results) { ... }
export function getAssessment(id) { ... }
```

### Anti-Patterns to Avoid
- **Multiple localStorage keys per student/assessment:** Becomes impossible to manage, export, or debug. Use one key.
- **Storing audio blobs in localStorage:** Blobs are huge and localStorage has a 5-10MB limit. Audio is ephemeral.
- **Storing the raw STT API response:** Redundant with alignment/metrics. Store only computed results.
- **Direct localStorage calls scattered across modules:** Centralise in storage.js for testability and migration.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Unique IDs | Custom ID generator | `crypto.randomUUID()` | Built-in, collision-proof |
| Date formatting | Custom date formatter | `new Date().toISOString()` | ISO 8601 is standard, sortable |
| Deep cloning for storage | Manual object copying | `JSON.parse(JSON.stringify(obj))` | Structurally clones anything JSON-serializable |

**Key insight:** localStorage + JSON covers 100% of this use case. There is no need for any library.

## Common Pitfalls

### Pitfall 1: localStorage Quota Exceeded
**What goes wrong:** `QuotaExceededError` when saving too much data
**Why it happens:** Browser limit is 5-10MB per origin; storing audio or raw STT responses fills it fast
**How to avoid:** Only store computed results (alignment, metrics, diagnostics). Wrap `setItem` in try/catch. Each assessment is ~5-50KB, so hundreds fit easily if you exclude audio.
**Warning signs:** Save silently fails without error handling

### Pitfall 2: Corrupt JSON Crashes the App
**What goes wrong:** `JSON.parse` throws on corrupted or manually edited localStorage
**Why it happens:** User clears partial data, extension modifies storage, or dev makes a typo
**How to avoid:** Always wrap `JSON.parse` in try/catch, fall back to default empty data
**Warning signs:** App fails on load with no visible error

### Pitfall 3: No Data Migration Path
**What goes wrong:** Schema change in a future version makes old data unreadable
**Why it happens:** No version field in stored data
**How to avoid:** Include a `version: 1` field in the top-level stored object. Check on load and migrate if needed.
**Warning signs:** Users lose data after an app update

### Pitfall 4: Forgetting to Save After Assessment
**What goes wrong:** User completes assessment but navigates away before save
**Why it happens:** Save only triggered by explicit button click
**How to avoid:** Auto-save immediately when analysis completes (in runAnalysis flow). No separate "save" step needed.
**Warning signs:** Users report lost assessments

### Pitfall 5: Student Deletion Orphans Assessments
**What goes wrong:** Deleting a student leaves their assessments in storage
**Why it happens:** No cascade delete
**How to avoid:** When deleting a student, also delete all assessments with that studentId
**Warning signs:** Storage grows indefinitely, orphaned data

## Code Examples

### Complete Storage Module Skeleton
```javascript
// storage.js
const STORAGE_KEY = 'orf_data';
const CURRENT_VERSION = 1;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const data = JSON.parse(raw);
    return migrate(data);
  } catch {
    return defaultData();
  }
}

function save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Storage save failed:', e);
  }
}

function defaultData() {
  return { version: CURRENT_VERSION, students: [], assessments: [] };
}

function migrate(data) {
  // Future: handle version migrations here
  if (!data.version) data.version = CURRENT_VERSION;
  return data;
}

export function getStudents() {
  return load().students;
}

export function addStudent(name) {
  const data = load();
  const student = {
    id: crypto.randomUUID(),
    name: name.trim(),
    createdAt: new Date().toISOString()
  };
  data.students.push(student);
  save(data);
  return student;
}

export function deleteStudent(id) {
  const data = load();
  data.students = data.students.filter(s => s.id !== id);
  data.assessments = data.assessments.filter(a => a.studentId !== id);
  save(data);
}

export function saveAssessment(studentId, results) {
  const data = load();
  const record = {
    id: crypto.randomUUID(),
    studentId,
    date: new Date().toISOString(),
    passageText: results.passageText || '',
    wcpm: results.wcpm,
    accuracy: results.accuracy,
    alignment: results.alignment,
    diagnostics: results.diagnostics || null
  };
  data.assessments.push(record);
  save(data);
  return record;
}

export function getAssessments(studentId) {
  return load().assessments
    .filter(a => a.studentId === studentId)
    .sort((a, b) => b.date.localeCompare(a.date)); // newest first
}
```

### Student Selector UI Pattern
```javascript
// In ui.js -- simple <select> dropdown
export function renderStudentSelector(students, selectedId, onChange) {
  const select = document.getElementById('studentSelect');
  select.innerHTML = '<option value="">-- Select Student --</option>';
  for (const s of students) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    if (s.id === selectedId) opt.selected = true;
    select.appendChild(opt);
  }
  select.onchange = () => onChange(select.value);
}
```

### History View Pattern
```javascript
// Simple table of past assessments
export function renderHistory(assessments) {
  const container = document.getElementById('historyList');
  if (!assessments.length) {
    container.textContent = 'No assessments yet.';
    return;
  }
  const table = document.createElement('table');
  // Header row
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Date</th><th>WCPM</th><th>Accuracy</th></tr>';
  table.appendChild(thead);
  // Data rows
  const tbody = document.createElement('tbody');
  for (const a of assessments) {
    const tr = document.createElement('tr');
    const date = new Date(a.date).toLocaleDateString();
    tr.innerHTML = `<td>${date}</td><td>${a.wcpm?.wcpm ?? 'N/A'}</td><td>${a.accuracy?.accuracy ?? 'N/A'}%</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.innerHTML = '';
  container.appendChild(table);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cookies for client-side data | localStorage | 2010+ | More storage, no HTTP overhead |
| Custom serialization | JSON.stringify/parse | Always standard | No library needed |
| Math.random() IDs | crypto.randomUUID() | 2021+ (all browsers) | Collision-proof UUIDs |

**Deprecated/outdated:**
- WebSQL: Removed from spec, don't use
- Application Cache: Replaced by Service Workers (already using SW)

## Open Questions

1. **Should assessment detail view allow re-viewing the full alignment?**
   - What we know: The alignment array can be stored and re-rendered
   - What's unclear: Whether the UI should show a full re-render or just summary metrics
   - Recommendation: Store full alignment so it's possible; start with summary table, add detail view if time permits

2. **Should there be a "guest" or "no student" mode?**
   - What we know: Current app works without any student concept
   - What's unclear: Whether to require student selection before assessment
   - Recommendation: Allow assessment without student selected (don't save), prompt to select/create student to enable saving

## Sources

### Primary (HIGH confidence)
- localStorage is a well-established Web API, stable since 2010+, documented on MDN
- crypto.randomUUID() supported in all modern browsers since 2021
- JSON.stringify/parse: core JS, no version concerns

### Secondary (MEDIUM confidence)
- localStorage quota: commonly cited as 5MB (Chrome, Firefox) to 10MB (some browsers). Exact limits vary but 5MB is the safe minimum.

### Tertiary (LOW confidence)
- None -- this domain is well-established with no ambiguity

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - built-in browser APIs, no library decisions to make
- Architecture: HIGH - repository pattern over localStorage is well-established
- Pitfalls: HIGH - quota limits, JSON corruption, and cascade deletes are well-known issues

**Research date:** 2026-02-02
**Valid until:** 2026-06-01 (extremely stable domain, browser APIs don't change)
