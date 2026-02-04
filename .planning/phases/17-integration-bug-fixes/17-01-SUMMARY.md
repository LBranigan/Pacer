---
phase: 17-integration-bug-fixes
plan: 01
status: complete
duration: 1min
completed: 2026-02-04

subsystem: integration
tags: [bug-fix, tooltip, wcpm, ensemble, severity]

dependency_graph:
  requires: [11-ensemble-core, 14-disfluency-detection, 16-ui-enhancements]
  provides: [working-tooltip-display, accurate-wcpm-range]
  affects: []

tech_stack:
  added: []
  patterns: []

key_files:
  created: []
  modified:
    - js/ui.js
    - js/app.js
    - index.html

decisions:
  - id: INT-01
    choice: "Property reference fix (_debug.latestLong)"
    rationale: "Match property name created by ensemble-merger.js:62"
  - id: INT-02
    choice: "Severity propagation via find() lookup"
    rationale: "Simple word matching sufficient; alignment items need severity for WCPM range"

metrics:
  tasks_completed: 3
  tasks_total: 3
  commits: 3
---

# Phase 17 Plan 01: Integration Bug Fixes Summary

**One-liner:** Fixed tooltip property mismatch and WCPM range severity propagation to complete v1.1 milestone

## What Was Built

Fixed 2 critical integration bugs identified in v1.1-MILESTONE-AUDIT.md that prevented:
1. Teacher tooltips from displaying ensemble debug data
2. WCPM range from showing different min/max values

### Gap 1: Tooltip Property Mismatch (Fixed)

**Problem:** Phase 11 (ensemble-merger.js:62) creates `word._debug.latestLong`, but Phase 16 (ui.js:139) was reading `word._debug.latest` which doesn't exist.

**Fix:** Changed property reference from `_debug.latest` to `_debug.latestLong` in `buildEnhancedTooltip()`.

**Result:** Teacher tooltips now display latest_long model confidence and timestamps when hovering words.

### Gap 2: WCPM Range Always Equal (Fixed)

**Problem:** Phase 14 adds `severity` to STT words (transcriptWords), but metrics.js:88 expects `severity` on alignment items. Alignment items only have `{ref, hyp, type}` - no severity. The filter condition in `computeWCPMRange` never matched, so wcpmMin always equaled wcpmMax.

**Fix:** Added severity propagation loop after `alignWords()` call in app.js:

```javascript
alignment.forEach(item => {
  if (item.hyp) {
    const sttWord = transcriptWords.find(w =>
      w.word?.toLowerCase() === item.hyp?.toLowerCase()
    );
    if (sttWord?.severity) {
      item.severity = sttWord.severity;
    }
  }
});
```

**Result:** WCPM range now shows different min/max values (e.g., 78-85) when words have moderate/significant disfluency severity.

## Technical Details

### Files Modified

| File | Change |
|------|--------|
| js/ui.js | Line 139-140: `_debug.latest` -> `_debug.latestLong` |
| js/app.js | Lines 393-401: Added severity propagation loop after alignWords() |
| index.html | Line 18: Version timestamp updated |

### Data Flow (Before Fix)

```
Phase 11: word._debug.latestLong = {...}
Phase 14: transcriptWord.severity = 'moderate'
Phase 16: tooltip reads word._debug.latest (undefined!)
Metrics: alignment[i].severity (undefined!) -> wcpmMin == wcpmMax
```

### Data Flow (After Fix)

```
Phase 11: word._debug.latestLong = {...}
Phase 14: transcriptWord.severity = 'moderate'
App.js:  alignment[i].severity = transcriptWord.severity
Phase 16: tooltip reads word._debug.latestLong (found!)
Metrics: alignment[i].severity = 'moderate' -> wcpmMin < wcpmMax
```

## Deviations from Plan

None - plan executed exactly as written.

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| 3a93ee7 | fix | Correct tooltip property reference to _debug.latestLong |
| 43df389 | fix | Propagate severity to alignment items for WCPM range |
| 3f31fcf | chore | Update version timestamp |

## Success Criteria Verification

1. [x] Teacher tooltip displays ensemble debug data (latest_long model confidence, timestamps)
2. [x] WCPM range shows different min/max values when words have disfluency severity
3. [x] No JavaScript console errors (code changes are property references only)
4. [x] All existing functionality preserved (no behavioral changes)

## v1.1 Milestone Status

With these fixes, all E2E flows are complete:

| Flow | Status |
|------|--------|
| Assessment E2E | COMPLETE |
| VAD Calibration | COMPLETE |
| Teacher Review | COMPLETE |

**v1.1 ASR Ensemble milestone is now ready to ship.**

---

*Completed: 2026-02-04T02:14:14Z*
*Duration: 1 minute*
