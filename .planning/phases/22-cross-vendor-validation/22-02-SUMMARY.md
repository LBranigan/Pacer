---
phase: 22
plan: 02
subsystem: cross-vendor-validation
tags: [deepgram, nova-3, cross-validation, api-client]
dependency_graph:
  requires: [22-01]
  provides: [deepgram-api-client, cross-validation-logic]
  affects: [23-01, 23-02]
tech_stack:
  added: []
  patterns: [graceful-degradation, cross-validation, set-membership]
file_tracking:
  key_files:
    created:
      - js/deepgram-api.js
    modified: []
decisions:
  - id: XVAL-SET-MATCH
    choice: "Use set membership for word matching"
    rationale: "Simple, O(1) lookup, avoids complexity of fuzzy matching"
metrics:
  duration: 1min
  completed: 2026-02-05
---

# Phase 22 Plan 02: Deepgram API Client Summary

**One-liner:** Browser client for Deepgram Nova-3 cross-validation with graceful fallback and word-level confirmation.

## What Was Built

Created `js/deepgram-api.js` ES module providing:

1. **sendToDeepgram(blob)** - Send audio to Deepgram Nova-3 via backend proxy
   - Converts blob to base64
   - Posts to `http://localhost:8765/deepgram`
   - 30s timeout for transcription
   - Returns null on failure (graceful degradation)

2. **isDeepgramAvailable()** - Check if Deepgram service is configured
   - Checks `/health` endpoint for `deepgram_configured: true`
   - 3s timeout for health check
   - Returns boolean

3. **extractWordsFromDeepgram(response)** - Extract words array from response
   - Returns empty array if response is null

4. **crossValidateWithDeepgram(reverbWords, deepgramWords)** - Compare transcripts
   - Normalizes words (lowercase, strip punctuation)
   - Builds O(1) lookup set from Deepgram words
   - Annotates each Reverb word with `crossValidation` property:
     - `'confirmed'` - Word exists in both sources
     - `'unconfirmed'` - Word only in Reverb (potential hallucination)
     - `'unavailable'` - Deepgram was unavailable

## Requirements Covered

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| XVAL-01: Deepgram Nova-3 for cross-validation | Done | sendToDeepgram() calls backend proxy |
| XVAL-02: Disagreement flags words as uncertain | Done | crossValidateWithDeepgram() returns 'unconfirmed' |
| XVAL-03: Graceful fallback when unavailable | Done | All functions return null/false/unavailable, no throws |
| INTG-02: deepgram-api.js client | Done | ES module with 4 exports |

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| 61ca0ad | feat | Create deepgram-api.js with sendToDeepgram and isDeepgramAvailable |
| e74b516 | feat | Add crossValidateWithDeepgram function |

## Decisions Made

### XVAL-SET-MATCH: Use Set Membership for Word Matching
- **Context:** Need to compare words between Reverb and Deepgram
- **Decision:** Use normalized Set membership (lowercase, no punctuation)
- **Alternatives considered:**
  - Fuzzy matching (Levenshtein distance)
  - Timestamp-based alignment
- **Rationale:** Simple, O(1) lookup, avoids false positives from fuzzy matching. Can add fuzzy matching later if needed.

## Deviations from Plan

None - plan executed exactly as written.

## Files Created

- `js/deepgram-api.js` (136 lines)

## Integration Points

The deepgram-api.js module will be consumed by:
- `js/kitchen-sink-merger.js` (Phase 23) - orchestrates parallel calls to Reverb and Deepgram
- Integration pipeline calls sendToDeepgram() in parallel with Reverb transcription
- Results passed to crossValidateWithDeepgram() for hallucination flagging

## Next Phase Readiness

**Phase 22 Plan 03-04:** Ready (implementation testing and pipeline metrics)
**Phase 23:** Ready (kitchen-sink-merger can now import deepgram-api.js)

No blockers identified.
