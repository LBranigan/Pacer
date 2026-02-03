---
phase: 13-confidence-classification
plan: 02
subsystem: api
tags: [confidence-classifier, asymmetric-trust, hallucination-detection, reference-matching]

# Dependency graph
requires:
  - phase: 13-01
    provides: Confidence thresholds, trust levels, word equivalences
  - phase: 11-ensemble-merger
    provides: Word merging with source field (both/latest_only/default_only)
  - phase: 12-vad-integration
    provides: Ghost detection with vad_ghost_in_reference flag
provides:
  - buildReferenceSet() for O(1) reference word lookup
  - classifyWordConfidence() implementing asymmetric trust policy
  - classifyAllWords() for batch processing merged words
  - filterGhosts() for removing ghost words before alignment
  - computeClassificationStats() for trust level distribution
affects: [13-03, 16-ui-confidence]

# Tech tracking
tech-stack:
  added: []
  patterns: [Immutable array processing, Set-based O(1) lookup]

key-files:
  created:
    - js/confidence-classifier.js

key-decisions:
  - "VAD ghost override is highest priority (confidence 0.0, trustLevel ghost)"
  - "Reference matching expands homophones and number forms for complete coverage"
  - "Hyphenated compounds match multiple forms (well-known = wellknown = well known)"
  - "No mutation of input data - all functions return new arrays/objects"

patterns-established:
  - "Reference set built once per classification batch for efficiency"
  - "Switch statement for source-based classification logic"
  - "Flag arrays for tracking special conditions (possible_insertion, etc.)"

# Metrics
duration: 2min
completed: 2026-02-03
---

# Phase 13 Plan 02: Confidence Classifier Summary

**Asymmetric trust policy classifier that adjusts confidence based on model agreement and reference presence - latest_only+ref=0.85, latest_only+noref=0.50+flag**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-03T23:02:40Z
- **Completed:** 2026-02-03T23:04:21Z
- **Tasks:** 3
- **Files created:** 1

## Accomplishments
- Created confidence-classifier.js with full asymmetric trust policy
- buildReferenceSet() expands all reference words to homophones and number equivalents
- classifyWordConfidence() implements all trust rules from CONTEXT.md
- classifyAllWords() provides batch processing without mutation
- filterGhosts() removes ghost words before alignment
- computeClassificationStats() provides trust level distribution

## Trust Policy Implementation

| Source | In Reference | Confidence | Trust Level | Flags |
|--------|--------------|------------|-------------|-------|
| both | - | default's conf | getTrustLevel() | - |
| latest_only | YES | 0.85 | medium | - |
| latest_only | NO | 0.50 | low | possible_insertion |
| default_only | YES | default's conf | capped at medium | - |
| default_only | NO | default's conf | low | default_only_not_in_ref |
| any | vad_ghost=true | 0.0 | ghost | vad_ghost |

## Task Commits

Each task was committed atomically:

1. **Task 1: Create buildReferenceSet function** - `dc85c80` (feat)
2. **Task 2: Create classifyWordConfidence function** - `e0f09bf` (feat)
3. **Task 3: Create classifyAllWords batch function** - `1f77fdd` (feat)

## Files Created
- `js/confidence-classifier.js` - 241 lines, exports 5 functions

## API

```javascript
// Build reference set for O(1) lookup
const refSet = buildReferenceSet("The cat sat there.");
// refSet contains: the, cat, sat, there, their, they're (homophones expanded)

// Classify single word
const result = classifyWordConfidence(word, refSet);
// Returns: { confidence: 0.85, trustLevel: 'medium', _flags: undefined }

// Classify all words (batch)
const classified = classifyAllWords(mergedWords, referenceText);
// Returns new array with confidence, trustLevel, _flags added

// Filter ghosts before alignment
const forAlignment = filterGhosts(classified);

// Get statistics
const stats = computeClassificationStats(classified);
// Returns: { total, high, medium, low, ghost, possibleInsertions }
```

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - module not yet integrated into app flow (integration in 13-03).

## Next Phase Readiness
- Classifier ready for integration in 13-03
- All functions exported and documented
- Reference matching handles homophones, numbers, hyphenated compounds
- Ghost filtering ready for pipeline use

---
*Phase: 13-confidence-classification*
*Completed: 2026-02-03*
