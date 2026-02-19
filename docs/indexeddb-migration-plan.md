# Plan: Move Bulk Assessment Data from localStorage to IndexedDB

## Context
`localStorage` has a ~5MB limit. Each assessment stores full `alignment`, `sttWords`, `nlAnnotations`, `prosody`, `passageText` arrays — hundreds of KB each. After ~10-20 assessments, `QuotaExceededError` on save. Audio blobs already use IndexedDB (`audio-store.js`). Same pattern for assessment bulk data.

## Design
- **Summary fields stay in localStorage** (sync): id, studentId, date, wcpm, accuracy, totalWords, errors, duration, passagePreview, audioRef, gamification, errorBreakdown, mazeResults, illustratorResults
- **Bulk fields move to IndexedDB** (async): alignment, sttWords, nlAnnotations, passageText, prosody, _ensemble
- `getAssessments()` (plural) stays **sync** — returns summaries only (no callers need bulk)
- `getAssessment(id)` (singular) becomes **async** — merges summary + bulk from IndexedDB
- `saveAssessment()` becomes **async** — splits data between localStorage + IndexedDB

## Steps

### 1. Create `js/assessment-store.js` (new file)
Clone `audio-store.js` pattern. DB `orf_assessments`, store `bulk`, keyed by assessmentId.
Exports: `saveBulkData(id, data)`, `getBulkData(id)`, `deleteBulkData(id)`, `deleteBulkDataForStudent(ids)`

### 2. Modify `js/storage.js`
- Import from `assessment-store.js`
- `saveAssessment()` → async: save summary to localStorage, bulk to IndexedDB
- `getAssessment()` → async: merge summary (localStorage) + bulk (IndexedDB)
- `getAssessments()` → stays sync, returns summaries only
- `deleteStudent()` → add `await deleteBulkDataForStudent(ids)` alongside audio cleanup
- Add `patchAssessment(id, fields)` — sync, updates summary fields only (replaces direct localStorage writes in maze/illustrator)
- Add `save()` try/catch for quota errors
- Add v6→v7 migration: `migrateV6ToV7IfNeeded()` async — extracts bulk from existing localStorage assessments into IndexedDB, then `migrate()` strips them. Idempotent via `orf_v7_migrated` flag.

### 3. Update callers — add `await` (already async)
- `js/app.js:2757` — `await saveAssessment(...)` (inside async `runAnalysis`)
- `js/maze-game.js` `init()` — `await getAssessment(...)`
- `js/future-you.js` `init()` — `await getAssessment(...)`
- `js/illustrator.js` `init()` — `await getAssessment(...)`

### 4. Update callers — make async
- `js/student-playback.js` `initStudentPlayback()` → `async function`, add `await getAssessment(...)`
- `js/rhythm-remix.js` `initRhythmRemix()` → `async function`, add `await getAssessment(...)`
- Both called via `DOMContentLoaded` — fire-and-forget is fine for async handlers

### 5. Replace direct localStorage bypasses
- `js/maze-game.js` `saveMazeResults()` → use `patchAssessment(id, {mazeResults: ...})`
- `js/illustrator.js` `saveIllustratorResults()` → use `patchAssessment(id, {illustratorResults: ...})`

### 6. Update `dashboard.html`
- Add `getAssessment` to imports
- `showAudioPlayback(a)` → `async function`, fetch `await getAssessment(a.id)` for bulk data (sttWords, alignment) before creating playback

### 7. Run migration at app startup
- `js/app.js` — call `await migrateV6ToV7IfNeeded()` early (top-level await in module)

### 8. Update version timestamp in `index.html`

## Files Modified
- `js/assessment-store.js` — NEW
- `js/storage.js` — core split
- `js/app.js` — await + migration
- `js/student-playback.js` — async init
- `js/rhythm-remix.js` — async init
- `js/maze-game.js` — await + patchAssessment
- `js/future-you.js` — await
- `js/illustrator.js` — await + patchAssessment
- `dashboard.html` — async playback
- `index.html` — version timestamp

## No changes needed
- `report.html` — only uses summary fields
- `js/miscue-registry.js` — no miscue type changes

## Verification
1. Clear localStorage, load app, create student, run assessment → no quota error
2. Refresh page → assessment history shows (summary from localStorage)
3. Click assessment in dashboard → audio playback loads (bulk from IndexedDB)
4. Student playback page loads correctly
5. Delete student → both localStorage and IndexedDB cleaned up
6. Existing users with v6 data → bulk migrated to IndexedDB transparently
