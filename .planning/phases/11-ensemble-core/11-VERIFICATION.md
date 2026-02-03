---
phase: 11-ensemble-core
verified: 2026-02-03T21:45:00Z
status: passed
score: 4/4 must-haves verified
---

# Phase 11: Ensemble Core Verification Report

**Phase Goal:** Run two STT models in parallel with temporal word association
**Verified:** 2026-02-03T21:45:00Z
**Status:** passed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Both `latest_long` and `default` models are called in parallel for every assessment | VERIFIED | sendEnsembleSTT uses Promise.allSettled at line 306 of stt-api.js, calls both buildSTTConfig (latest_long) and getDefaultModelConfig (default) |
| 2 | Words from both models are associated by time overlap (50ms jitter tolerance), not text matching | VERIFIED | timeOverlap function (line 25-33 of ensemble-merger.js) uses Math.max/Math.min interval overlap, JITTER_MS=50, no text comparison in mergeEnsembleResults |
| 3 | Merged transcript includes `_debug` property showing both model results for each word | VERIFIED | createMergedWord (line 41-75 of ensemble-merger.js) adds _debug object with latestLong and default properties containing word, timestamps, confidence |
| 4 | Words are tagged with source: `both`, `latest_only`, or `default_only` | VERIFIED | createMergedWord (line 43-50) sets source based on presence of latestWord/defaultWord; computeEnsembleStats counts each category |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `js/stt-api.js` | sendEnsembleSTT function | VERIFIED | 319 lines, exports sendEnsembleSTT (line 288), fetchSTTRaw helper (line 74), uses Promise.allSettled (line 306) |
| `js/ensemble-merger.js` | Temporal word association | VERIFIED | 177 lines, exports mergeEnsembleResults (line 103), extractWordsFromSTT (line 83), computeEnsembleStats (line 157), implements timeOverlap with JITTER_MS=50 |
| `js/app.js` | Integration in assessment flow | VERIFIED | Modified, imports sendEnsembleSTT and mergeEnsembleResults (lines 3-4), calls in runAnalysis (lines 124-166), saves _ensemble data (line 509) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| app.js | sendEnsembleSTT | import and call | WIRED | Imported at line 3, called at line 124 in sync path of runAnalysis |
| app.js | mergeEnsembleResults | import and call | WIRED | Imported at line 4, called at line 142 after ensemble API call |
| sendEnsembleSTT | Promise.allSettled | parallel API calls | WIRED | Line 306-309 of stt-api.js fires both models with Promise.allSettled |
| sendEnsembleSTT | getDefaultModelConfig | default model config | WIRED | Line 303 of stt-api.js calls getDefaultModelConfig for default model |
| mergeEnsembleResults | timeOverlap | temporal matching | WIRED | Line 129 of ensemble-merger.js calls timeOverlap in matching loop |
| createMergedWord | _debug | debug data | WIRED | Lines 61-74 of ensemble-merger.js populate _debug with both model data |
| app.js saveAssessment | _ensemble | persist data | WIRED | Line 509 of app.js preserves data._ensemble in saved assessment |

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| ENS-01: System calls both `latest_long` and `default` STT models in parallel | SATISFIED | sendEnsembleSTT calls buildSTTConfig (latest_long) and getDefaultModelConfig (default) via Promise.allSettled |
| ENS-02: Temporal word association maps words by time overlap (not text equality) | SATISFIED | timeOverlap function uses interval math (Math.max/min), no text comparison in merge logic |
| ENS-03: 50ms asymmetric jitter buffer handles CTC vs Conformer timestamp drift | SATISFIED | JITTER_MS constant set to 50, applied in timeOverlap by expanding word2 window (+/- jitterMs) |
| ENS-04: Merged transcript preserves `_debug` data showing both model results | SATISFIED | createMergedWord adds _debug property, app.js preserves in _ensemble field of saved assessments |

### Anti-Patterns Found

None found.

**Anti-pattern scan results:**
- No TODO/FIXME comments in implementation files
- No placeholder content or stub patterns
- No empty implementations or console.log-only handlers
- All functions have substantive implementations with proper logic
- 319 lines in stt-api.js (well above component threshold)
- 177 lines in ensemble-merger.js (well above module threshold)

### Human Verification Required

#### 1. Parallel API Call Performance

**Test:** Run an assessment with a valid API key and audio recording
**Expected:** 
- Status message shows "Running ensemble STT analysis..."
- Processing time should be approximately the same as single-model (not 2x longer)
- Debug log should show ensemble_raw stage with hasLatestLong: true and hasDefault: true
**Why human:** Need to verify actual API calls complete and timing is acceptable

#### 2. Merged Transcript Quality

**Test:** Run an assessment and check the debug log
**Expected:**
- ensemble_merged stage shows totalWords count
- agreementRate percentage displayed (e.g., 85%)
- both, latestOnly, defaultOnly counts sum to totalWords
- Words have source tags visible in debug output
**Why human:** Need to verify merged data structure is correct and stats compute properly

#### 3. Model Failure Graceful Degradation

**Test:** Temporarily break API key or network, run assessment
**Expected:**
- If both models fail: "Both STT models failed. Check API key."
- If one model fails: Assessment continues with available model
- _ensemble.errors property shows which model failed
**Why human:** Need to verify error handling works in real failure scenarios

#### 4. Temporal Word Association Accuracy

**Test:** Record a passage with disfluencies (e.g., "th-th-the cat")
**Expected:**
- Stuttered fragments matched to target words by timing
- Words that overlap temporally are tagged as "both"
- No duplicate words caused by timestamp misalignment
**Why human:** Need to verify temporal matching handles real speech patterns correctly

---

## Verification Complete

**Status:** passed
**Score:** 4/4 must-haves verified

All automated checks passed. Phase goal achieved:
- Both models called in parallel (verified via Promise.allSettled pattern)
- Temporal word association implemented with 50ms jitter tolerance (verified via timeOverlap algorithm)
- Debug data preserved in _debug property (verified in createMergedWord)
- Source tags applied correctly (verified in computeEnsembleStats)

Human verification recommended for:
1. Actual API call performance and timing
2. Merged transcript data structure correctness
3. Error handling in failure scenarios
4. Temporal matching accuracy with real disfluent speech

Implementation is complete and ready for Phase 12 (VAD Integration).

---
_Verified: 2026-02-03T21:45:00Z_
_Verifier: Claude (gsd-verifier)_
