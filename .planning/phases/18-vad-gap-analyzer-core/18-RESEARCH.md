# Phase 18: VAD Gap Analyzer Core - Research

**Researched:** 2026-02-04
**Domain:** VAD acoustic analysis for diagnostic gap enrichment
**Confidence:** HIGH

## Summary

Phase 18 creates a new VAD Gap Analyzer module that enriches existing diagnostic gap/pause indicators with acoustic context. The system already has comprehensive VAD infrastructure (vad-processor.js) and diagnostics (diagnostics.js). This phase adds a new module (vad-gap-analyzer.js) that analyzes time ranges using existing VAD segments and enriches diagnostics objects with `_vadAnalysis` properties.

The implementation is straightforward because all building blocks exist. VAD segments are already captured during the pipeline (`vadResult.segments`), and diagnostics already calculate `longPauses` and `onsetDelays` with precise timing data. The new module computes speech overlap percentages and applies acoustic label classification.

**Primary recommendation:** Create `vad-gap-analyzer.js` with three core functions: `calculateSpeechPercent()` for overlap calculation, `getAcousticLabel()` for classification, and `enrichDiagnosticsWithVAD()` for integration. Follow existing codebase patterns (ES6 modules, exported functions, in-place mutation with underscore-prefixed properties).

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@ricky0123/vad-web` | 0.0.29 | Already integrated - provides VAD segments | Existing infrastructure from Phase 12 |
| Native JavaScript | ES6+ | Overlap calculation, classification logic | No dependencies needed for math operations |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Existing `vad-processor.js` | N/A | Provides `vadResult.segments` array | Already called in pipeline |
| Existing `diagnostics.js` | N/A | Provides `longPauses` and `onsetDelays` arrays | Already called in pipeline |
| Existing `debug-logger.js` | N/A | `addStage()` for debug logging | DBG-01 requirement |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New module | Inline in app.js | Violates separation of concerns; module is cleaner and testable |
| Return new object | Mutate in place | Existing pattern uses underscore-prefix mutation (see `_vadAnalysis`, `_debug`, `_flags`) |
| Multiple overlap checks | Single overlap function | Single function covers both longPauses and onsetDelays |

**Installation:**
No new dependencies. Uses existing infrastructure.

## Architecture Patterns

### Recommended Project Structure
```
js/
  vad-gap-analyzer.js    # NEW: Gap analysis module (this phase)
  vad-processor.js       # EXISTING: VAD segment extraction
  diagnostics.js         # EXISTING: Gap/pause detection
  ghost-detector.js      # EXISTING: Ghost word flagging (similar patterns)
  app.js                 # UPDATE: Call enrichDiagnosticsWithVAD() after runDiagnostics()
  ui.js                  # UPDATE: Display _vadAnalysis in tooltips (Phase 19)
  debug-logger.js        # UPDATE: Add vad_gap_analysis stage
```

### Pattern 1: Time Range Overlap Calculation
**What:** Calculate percentage of speech in a time range by checking VAD segment overlap
**When to use:** VAD-01 requirement - core calculation function
**Example:**
```javascript
// Source: ghost-detector.js computeMaxOverlap() pattern adapted for percentage
export function calculateSpeechPercent(startMs, endMs, vadSegments) {
  const rangeDuration = endMs - startMs;
  if (rangeDuration <= 0) return 0;

  let totalSpeechMs = 0;
  for (const seg of vadSegments) {
    const overlapStart = Math.max(startMs, seg.start);
    const overlapEnd = Math.min(endMs, seg.end);
    if (overlapStart < overlapEnd) {
      totalSpeechMs += (overlapEnd - overlapStart);
    }
  }

  return Math.round((totalSpeechMs / rangeDuration) * 1000) / 10; // One decimal place
}
```

### Pattern 2: Acoustic Label Classification
**What:** Map speech percentage to descriptive acoustic labels
**When to use:** VAD-02 requirement - classification function
**Example:**
```javascript
// Source: docs/vad-gap-analysis-plan.md thresholds (adjusted per requirements)
// Note: Requirements specify slightly different thresholds than original doc
export const ACOUSTIC_LABELS = {
  SILENCE_CONFIRMED: { max: 10, label: 'silence confirmed' },
  MOSTLY_SILENT: { max: 29, label: 'mostly silent' },      // 10-29%
  MIXED_SIGNAL: { max: 49, label: 'mixed signal' },        // 30-49%
  SPEECH_DETECTED: { max: 79, label: 'speech detected' },  // 50-79%
  CONTINUOUS_SPEECH: { max: 100, label: 'continuous speech' }  // >=80%
};

export function getAcousticLabel(speechPercent) {
  if (speechPercent < 10) return ACOUSTIC_LABELS.SILENCE_CONFIRMED;
  if (speechPercent < 30) return ACOUSTIC_LABELS.MOSTLY_SILENT;
  if (speechPercent < 50) return ACOUSTIC_LABELS.MIXED_SIGNAL;
  if (speechPercent < 80) return ACOUSTIC_LABELS.SPEECH_DETECTED;
  return ACOUSTIC_LABELS.CONTINUOUS_SPEECH;
}
```

### Pattern 3: Diagnostics Enrichment (Mutation Pattern)
**What:** Add `_vadAnalysis` property to existing diagnostic objects
**When to use:** VAD-03 and VAD-04 requirements - enrich longPauses and onsetDelays
**Example:**
```javascript
// Source: app.js patterns for _debug, _flags, _disfluency mutations
// Existing pattern: mutate in place with underscore-prefixed properties
export function enrichDiagnosticsWithVAD(diagnostics, transcriptWords, vadSegments) {
  if (!vadSegments || vadSegments.length === 0) return;

  // Parse time helper
  const parseTimeMs = (t) => {
    if (typeof t === 'number') return t * 1000;
    return (parseFloat(String(t).replace('s', '')) || 0) * 1000;
  };

  // Enrich longPauses
  for (const pause of diagnostics.longPauses || []) {
    const afterWord = transcriptWords[pause.afterWordIndex];
    const nextWord = transcriptWords[pause.afterWordIndex + 1];
    if (afterWord && nextWord) {
      const startMs = parseTimeMs(afterWord.endTime);
      const endMs = parseTimeMs(nextWord.startTime);
      const speechPercent = calculateSpeechPercent(startMs, endMs, vadSegments);
      pause._vadAnalysis = {
        speechPercent,
        label: getAcousticLabel(speechPercent).label
      };
    }
  }

  // Enrich onsetDelays (same pattern)
  for (const delay of diagnostics.onsetDelays || []) {
    const word = transcriptWords[delay.wordIndex];
    const prevWord = transcriptWords[delay.wordIndex - 1];
    if (word && prevWord) {
      const startMs = parseTimeMs(prevWord.endTime);
      const endMs = parseTimeMs(word.startTime);
      const speechPercent = calculateSpeechPercent(startMs, endMs, vadSegments);
      delay._vadAnalysis = {
        speechPercent,
        label: getAcousticLabel(speechPercent).label
      };
    }
  }
}
```

### Pattern 4: Debug Stage Logging
**What:** Add VAD gap analysis summary to debug log
**When to use:** DBG-01 requirement - counts by acoustic label
**Example:**
```javascript
// Source: app.js addStage() pattern
import { addStage } from './debug-logger.js';

// After enrichDiagnosticsWithVAD() call:
const vadGapSummary = computeVADGapSummary(diagnostics);
addStage('vad_gap_analysis', {
  longPausesAnalyzed: vadGapSummary.longPausesAnalyzed,
  hesitationsAnalyzed: vadGapSummary.hesitationsAnalyzed,
  byLabel: {
    silenceConfirmed: vadGapSummary.silenceConfirmed,
    mostlySilent: vadGapSummary.mostlySilent,
    mixedSignal: vadGapSummary.mixedSignal,
    speechDetected: vadGapSummary.speechDetected,
    continuousSpeech: vadGapSummary.continuousSpeech
  }
});
```

### Anti-Patterns to Avoid
- **Creating new diagnostic objects:** Follow existing pattern of mutation with `_vadAnalysis` prefix
- **Complex classes:** Use plain functions - matches ghost-detector.js, disfluency-detector.js patterns
- **Rounding issues:** Round percentages to one decimal place consistently
- **Assuming VAD availability:** Always check for empty/null vadSegments array before processing

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Time parsing | Custom time parser | Existing `parseTimeMs()` pattern from ghost-detector.js | Consistent with codebase |
| VAD segment format | Custom segment handling | Use `vadResult.segments` directly | Already standardized as `{start, end}` in ms |
| Diagnostic structure | Custom objects | Mutate existing `diagnostics.longPauses`, `diagnostics.onsetDelays` | Maintains downstream compatibility |
| Debug logging | Custom log format | Use `addStage()` from debug-logger.js | Consistent debug output format |

**Key insight:** All infrastructure exists. This phase is pure composition - combining existing VAD segments with existing diagnostic timing data to produce enrichment properties.

## Common Pitfalls

### Pitfall 1: Timestamp Unit Confusion
**What goes wrong:** Mixing seconds and milliseconds causes wrong calculations
**Why it happens:** diagnostics.js uses seconds (from STT), VAD uses milliseconds
**How to avoid:**
- Convert STT timestamps to milliseconds immediately: `parseTimeMs(word.endTime)`
- Use clear variable names: `startMs`, `endMs` (not just `start`, `end`)
- Follow ghost-detector.js pattern exactly
**Warning signs:** Speech percentages always 0% or 100%

### Pitfall 2: Missing Diagnostic Entries
**What goes wrong:** Some longPauses or onsetDelays don't get `_vadAnalysis`
**Why it happens:** Word index lookup fails (transcriptWords may be filtered differently)
**How to avoid:**
- Always null-check `afterWord`, `nextWord`, `prevWord` before accessing properties
- Log warning when lookup fails (but don't throw)
**Warning signs:** Some gaps have `_vadAnalysis`, others don't

### Pitfall 3: Empty VAD Segments
**What goes wrong:** Division by zero or undefined results when VAD failed
**Why it happens:** VAD may not load or may return no segments
**How to avoid:**
- Check `vadSegments && vadSegments.length > 0` before processing
- Skip enrichment silently when VAD unavailable (matches existing pattern)
**Warning signs:** Console errors about undefined, NaN percentages

### Pitfall 4: Debug Log Bloat
**What goes wrong:** Debug log too large to be useful
**Why it happens:** Logging full _vadAnalysis for every gap
**How to avoid:**
- Log only summary counts (by acoustic label)
- Full details already in diagnostics JSON if needed
**Warning signs:** Debug log files grow significantly larger

## Code Examples

Verified patterns from codebase analysis:

### Complete Module Structure
```javascript
// js/vad-gap-analyzer.js
// Source: ghost-detector.js module pattern, codebase conventions

/**
 * VAD Gap Analyzer - Acoustic analysis of pause/gap indicators
 *
 * Analyzes time ranges during diagnosed pauses and hesitations to determine
 * what portion contained VAD-detected speech. Enriches diagnostics with
 * _vadAnalysis properties containing speechPercent and acoustic label.
 */

// Acoustic label thresholds per requirements
// Note: Success criteria specifies exact thresholds
export const ACOUSTIC_LABELS = {
  SILENCE_CONFIRMED: { max: 10, label: 'silence confirmed' },
  MOSTLY_SILENT: { max: 29, label: 'mostly silent' },
  MIXED_SIGNAL: { max: 49, label: 'mixed signal' },
  SPEECH_DETECTED: { max: 79, label: 'speech detected' },
  CONTINUOUS_SPEECH: { max: 100, label: 'continuous speech' }
};

/**
 * Calculate speech overlap percentage for a time range.
 * VAD-01: System calculates VAD speech overlap percentage for any time range
 *
 * @param {number} startMs - Range start in milliseconds
 * @param {number} endMs - Range end in milliseconds
 * @param {Array<{start: number, end: number}>} vadSegments - VAD speech segments (ms)
 * @returns {number} Speech percentage 0-100, one decimal place
 */
export function calculateSpeechPercent(startMs, endMs, vadSegments) {
  const rangeDuration = endMs - startMs;
  if (rangeDuration <= 0) return 0;

  let totalSpeechMs = 0;
  for (const seg of vadSegments) {
    const overlapStart = Math.max(startMs, seg.start);
    const overlapEnd = Math.min(endMs, seg.end);
    if (overlapStart < overlapEnd) {
      totalSpeechMs += (overlapEnd - overlapStart);
    }
  }

  // Round to one decimal place
  return Math.round((totalSpeechMs / rangeDuration) * 1000) / 10;
}

/**
 * Get acoustic label for speech percentage.
 * VAD-02: System classifies speech percentage into acoustic labels
 *
 * @param {number} speechPercent - Speech percentage 0-100
 * @returns {{label: string, max: number}}
 */
export function getAcousticLabel(speechPercent) {
  if (speechPercent < 10) return ACOUSTIC_LABELS.SILENCE_CONFIRMED;
  if (speechPercent < 30) return ACOUSTIC_LABELS.MOSTLY_SILENT;
  if (speechPercent < 50) return ACOUSTIC_LABELS.MIXED_SIGNAL;
  if (speechPercent < 80) return ACOUSTIC_LABELS.SPEECH_DETECTED;
  return ACOUSTIC_LABELS.CONTINUOUS_SPEECH;
}

/**
 * Parse STT timestamp to milliseconds.
 * @param {string|number} t - Timestamp like "1.400s" or number (seconds)
 * @returns {number} Milliseconds
 */
function parseTimeMs(t) {
  if (typeof t === 'number') return t * 1000;
  return (parseFloat(String(t).replace('s', '')) || 0) * 1000;
}

/**
 * Enrich diagnostics with VAD gap analysis.
 * VAD-03: System enriches diagnostics.longPauses with _vadAnalysis property
 * VAD-04: System enriches diagnostics.onsetDelays with _vadAnalysis property
 *
 * Mutates diagnostics in place (existing codebase pattern).
 *
 * @param {Object} diagnostics - From runDiagnostics()
 * @param {Array} transcriptWords - STT words with startTime/endTime
 * @param {Array<{start: number, end: number}>} vadSegments - VAD speech segments (ms)
 */
export function enrichDiagnosticsWithVAD(diagnostics, transcriptWords, vadSegments) {
  if (!vadSegments || vadSegments.length === 0) {
    console.log('[VAD Gap] No VAD segments available, skipping enrichment');
    return;
  }

  // Enrich longPauses (VAD-03)
  if (diagnostics.longPauses) {
    for (const pause of diagnostics.longPauses) {
      const afterWord = transcriptWords[pause.afterWordIndex];
      const nextWord = transcriptWords[pause.afterWordIndex + 1];

      if (afterWord && nextWord) {
        const startMs = parseTimeMs(afterWord.endTime);
        const endMs = parseTimeMs(nextWord.startTime);
        const speechPercent = calculateSpeechPercent(startMs, endMs, vadSegments);

        pause._vadAnalysis = {
          speechPercent,
          label: getAcousticLabel(speechPercent).label
        };
      }
    }
  }

  // Enrich onsetDelays (VAD-04)
  if (diagnostics.onsetDelays) {
    for (const delay of diagnostics.onsetDelays) {
      const word = transcriptWords[delay.wordIndex];
      const prevWord = delay.wordIndex > 0 ? transcriptWords[delay.wordIndex - 1] : null;

      if (word && prevWord) {
        const startMs = parseTimeMs(prevWord.endTime);
        const endMs = parseTimeMs(word.startTime);
        const speechPercent = calculateSpeechPercent(startMs, endMs, vadSegments);

        delay._vadAnalysis = {
          speechPercent,
          label: getAcousticLabel(speechPercent).label
        };
      }
    }
  }

  console.log('[VAD Gap] Enriched diagnostics with VAD analysis');
}

/**
 * Compute summary counts by acoustic label for debug logging.
 * DBG-01: Debug log includes VAD gap analysis stage with counts by acoustic label
 *
 * @param {Object} diagnostics - Diagnostics with _vadAnalysis enrichment
 * @returns {Object} Summary counts
 */
export function computeVADGapSummary(diagnostics) {
  const counts = {
    longPausesAnalyzed: 0,
    hesitationsAnalyzed: 0,
    silenceConfirmed: 0,
    mostlySilent: 0,
    mixedSignal: 0,
    speechDetected: 0,
    continuousSpeech: 0
  };

  const countLabel = (label) => {
    switch (label) {
      case 'silence confirmed': counts.silenceConfirmed++; break;
      case 'mostly silent': counts.mostlySilent++; break;
      case 'mixed signal': counts.mixedSignal++; break;
      case 'speech detected': counts.speechDetected++; break;
      case 'continuous speech': counts.continuousSpeech++; break;
    }
  };

  if (diagnostics.longPauses) {
    for (const p of diagnostics.longPauses) {
      if (p._vadAnalysis) {
        counts.longPausesAnalyzed++;
        countLabel(p._vadAnalysis.label);
      }
    }
  }

  if (diagnostics.onsetDelays) {
    for (const d of diagnostics.onsetDelays) {
      if (d._vadAnalysis) {
        counts.hesitationsAnalyzed++;
        countLabel(d._vadAnalysis.label);
      }
    }
  }

  return counts;
}
```

### Integration in app.js
```javascript
// Source: app.js existing pipeline pattern around line 610

import { enrichDiagnosticsWithVAD, computeVADGapSummary } from './vad-gap-analyzer.js';

// ... existing code ...

// Run diagnostics (existing)
const diagnostics = runDiagnostics(transcriptWords, alignment, referenceText, sttLookup);

// NEW: Enrich diagnostics with VAD gap analysis (after runDiagnostics)
if (vadResult.segments && vadResult.segments.length > 0) {
  enrichDiagnosticsWithVAD(diagnostics, transcriptWords, vadResult.segments);

  // Debug logging (DBG-01)
  const vadGapSummary = computeVADGapSummary(diagnostics);
  addStage('vad_gap_analysis', {
    longPausesAnalyzed: vadGapSummary.longPausesAnalyzed,
    hesitationsAnalyzed: vadGapSummary.hesitationsAnalyzed,
    byLabel: {
      silenceConfirmed: vadGapSummary.silenceConfirmed,
      mostlySilent: vadGapSummary.mostlySilent,
      mixedSignal: vadGapSummary.mixedSignal,
      speechDetected: vadGapSummary.speechDetected,
      continuousSpeech: vadGapSummary.continuousSpeech
    }
  });
}

// ... existing code continues ...
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Gap = silence assumed | VAD confirms acoustic content | Current phase | Teachers get acoustic context |
| Binary ghost detection | Percentage-based analysis | Current phase | More nuanced gap information |
| Post-hoc VAD analysis | Integrated in diagnostic flow | Phase 12 | VAD segments always available |

**Deprecated/outdated:**
- Assuming gaps are pure silence
- Treating all hesitations identically regardless of acoustic content

## Open Questions

Things that couldn't be fully resolved:

1. **UI Display of VAD Analysis (Phase 19)**
   - What we know: `_vadAnalysis` will be available on diagnostic objects
   - What's unclear: Exact tooltip formatting, CSS styling for visual indicators
   - Recommendation: Defer UI implementation to Phase 19; this phase focuses on data layer

2. **Edge case: Overlapping VAD segments**
   - What we know: VAD segments should not overlap
   - What's unclear: Whether vad-web ever produces overlapping segments
   - Recommendation: Current algorithm handles overlaps correctly (no double-counting)

3. **Threshold boundary behavior**
   - What we know: Requirements specify exact thresholds (10%, 30%, 50%, 80%)
   - What's unclear: Whether boundaries should be `<` or `<=`
   - Recommendation: Use `<` consistently (e.g., <10% = silence confirmed, 10-29% = mostly silent)

## Sources

### Primary (HIGH confidence)
- `/mnt/c/Users/brani/desktop/googstt/js/ghost-detector.js` - Overlap calculation pattern
- `/mnt/c/Users/brani/desktop/googstt/js/diagnostics.js` - longPauses, onsetDelays structure
- `/mnt/c/Users/brani/desktop/googstt/js/vad-processor.js` - VAD segment format
- `/mnt/c/Users/brani/desktop/googstt/js/app.js` - Pipeline integration patterns
- `/mnt/c/Users/brani/desktop/googstt/docs/vad-gap-analysis-plan.md` - Design specification

### Secondary (MEDIUM confidence)
- `/mnt/c/Users/brani/desktop/googstt/.planning/phases/12-vad-integration/12-RESEARCH.md` - VAD architecture

### Tertiary (LOW confidence)
- None - all sources are codebase and project documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Uses only existing infrastructure
- Architecture patterns: HIGH - Follows established codebase conventions exactly
- Implementation details: HIGH - Clear requirements, existing patterns to follow
- Edge cases: MEDIUM - Some boundary conditions need validation during testing

**Research date:** 2026-02-04
**Valid until:** 2026-03-04 (30 days - stable module design)
