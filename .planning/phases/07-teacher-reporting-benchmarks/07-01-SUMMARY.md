# Phase 7 Plan 1: Benchmarks Module and Grade Field Summary

**One-liner:** Hasbrouck-Tindal 2017 norms module (grades 1-6, seasonal) with storage v3 migration adding grade to student profiles

## What Was Done

### Task 1: Create benchmarks module and migrate storage to v3
Created `js/benchmarks.js` exporting HT_NORMS data object (grades 1-6, fall/winter/spring percentiles), `getSeason(date)` for seasonal detection, and `getBenchmarkStatus(wcpm, grade, season)` returning risk classification with color codes. Updated `js/storage.js` with v2->v3 migration adding `grade` field to existing students (defaulting to null), updated `defaultData()` to version 3, and added `updateStudentGrade()` export.

### Task 2: Add grade field to student creation and update service worker
Added grade `<select>` dropdown (optional, grades 1-6) to student creation bar in `index.html`. Updated `app.js` to pass selected grade to `addStudent()`. Added `js/benchmarks.js` to SW shell cache and bumped cache to `orf-v12`.

## Commits

| Hash | Message |
|------|---------|
| 8e6afa0 | feat(07-01): create benchmarks module and migrate storage to v3 |
| e16cdc5 | feat(07-01): add grade selector to student creation UI and update SW |

## Deviations from Plan

None - plan executed exactly as written.

## Key Files

- **Created:** `js/benchmarks.js` - HT norms data, getSeason(), getBenchmarkStatus()
- **Modified:** `js/storage.js` - v3 migration, grade field, updateStudentGrade()
- **Modified:** `index.html` - grade dropdown in student creation
- **Modified:** `js/app.js` - pass grade to addStudent()
- **Modified:** `sw.js` - cache benchmarks.js, bump to v12

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Grade 1 fall returns 'unknown' | HT 2017 norms don't include grade 1 fall data |
| Grade stored as integer or null | Simple type; null means unset, enables benchmark lookup when set |

## Duration

~2 minutes
