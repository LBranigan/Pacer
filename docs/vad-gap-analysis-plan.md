# VAD Gap Analysis Plan

> **Status:** Proposal
> **Date:** 2026-02-04
> **Purpose:** Add VAD-based acoustic analysis to pause/gap indicators without changing detection logic

---

## Problem Statement

When STT reports a long gap before a word (e.g., 3.1 seconds before "unnerved"), we don't know what actually happened acoustically:

| Scenario | What STT sees | What actually happened |
|----------|---------------|------------------------|
| True hesitation | 3s gap → word | Student paused silently, then spoke |
| Sounding out | 3s gap → word | Student said "un" [pause] "nerved" |
| Timestamp drift | 3s gap → word | STT timestamps are inaccurate |

Currently, all three scenarios look identical. VAD can help distinguish them by revealing whether there was speech during the supposed "silence."

---

## Solution: Informational VAD Overlay

Add VAD acoustic analysis to gap/pause indicators as **hover information only**. No detection logic changes.

**User sees:** When hovering over a pause indicator `[3.1s]`, tooltip shows:
```
Long pause: 3100ms (error: >= 3000ms)
Acoustic: 42% speech detected (mixed signal)
```

This tells the teacher: "STT reported a 3.1s gap, but VAD detected speech for 42% of that time—the student may have been sounding out the word."

---

## Acoustic Labels

| VAD Speech % | Label | Interpretation | Color hint |
|--------------|-------|----------------|------------|
| 0-10% | "silence confirmed" | True hesitation—student was quiet | — |
| 10-30% | "mostly silent" | Brief noise or very short utterance | — |
| 30-60% | "mixed signal" | Possible sounding out, partial attempts | amber |
| 60-90% | "speech detected" | Significant vocalization during "gap" | amber |
| 90-100% | "continuous speech" | STT timestamps likely drifted | red |

**Design principle:** Labels are descriptive, not judgmental. "Mixed signal" doesn't say the detection is wrong—it provides additional acoustic context.

---

## Data Flow

### Current Flow
```
Audio → VAD → vadResult.segments
                    ↓
              flagGhostWords() only
                    ↓
              result._vad.segments (stored but unused for gaps)

Audio → STT → diagnostics.longPauses [{afterWordIndex, gap, ...}]
                    ↓
              UI: pauseSpan.title = "Long pause: Xms"
```

### New Flow
```
Audio → VAD → vadResult.segments
                    ↓
              flagGhostWords()
                    ↓
              analyzeGapsWithVAD(diagnostics, vadResult.segments) ← NEW
                    ↓
              diagnostics.longPauses [{..., _vadAnalysis: {speechPercent, label}}]
                    ↓
              UI: pauseSpan.title = "Long pause: Xms\nAcoustic: X% (label)"
```

---

## Implementation

### Part 1: VAD Gap Analyzer Module

Create `js/vad-gap-analyzer.js`:

```javascript
/**
 * VAD Gap Analyzer - Acoustic analysis of gaps between words
 *
 * Analyzes gaps/pauses to determine VAD speech activity percentage.
 * Purely informational - does not change detection decisions.
 */

/**
 * Acoustic label thresholds and descriptions
 */
export const VAD_GAP_LABELS = {
  SILENCE_CONFIRMED: { max: 10, label: 'silence confirmed', description: 'VAD confirms silence during gap' },
  MOSTLY_SILENT: { max: 30, label: 'mostly silent', description: 'Brief noise or very short utterance' },
  MIXED_SIGNAL: { max: 60, label: 'mixed signal', description: 'Possible sounding out or partial attempts' },
  SPEECH_DETECTED: { max: 90, label: 'speech detected', description: 'Significant vocalization during gap' },
  CONTINUOUS_SPEECH: { max: 100, label: 'continuous speech', description: 'STT timestamps may have drifted' }
};

/**
 * Calculate VAD speech overlap percentage for a time range.
 *
 * @param {number} startMs - Gap start time in milliseconds
 * @param {number} endMs - Gap end time in milliseconds
 * @param {Array<{start: number, end: number}>} vadSegments - VAD speech segments
 * @returns {number} Percentage of gap duration with VAD speech (0-100)
 */
export function calculateSpeechPercent(startMs, endMs, vadSegments) {
  const gapDuration = endMs - startMs;
  if (gapDuration <= 0) return 0;

  let speechOverlap = 0;

  for (const seg of vadSegments) {
    const overlapStart = Math.max(startMs, seg.start);
    const overlapEnd = Math.min(endMs, seg.end);

    if (overlapStart < overlapEnd) {
      speechOverlap += (overlapEnd - overlapStart);
    }
  }

  return Math.round((speechOverlap / gapDuration) * 1000) / 10; // One decimal place
}

/**
 * Get acoustic label for a speech percentage.
 *
 * @param {number} speechPercent - VAD speech percentage (0-100)
 * @returns {{label: string, description: string}}
 */
export function getAcousticLabel(speechPercent) {
  if (speechPercent <= VAD_GAP_LABELS.SILENCE_CONFIRMED.max) {
    return VAD_GAP_LABELS.SILENCE_CONFIRMED;
  } else if (speechPercent <= VAD_GAP_LABELS.MOSTLY_SILENT.max) {
    return VAD_GAP_LABELS.MOSTLY_SILENT;
  } else if (speechPercent <= VAD_GAP_LABELS.MIXED_SIGNAL.max) {
    return VAD_GAP_LABELS.MIXED_SIGNAL;
  } else if (speechPercent <= VAD_GAP_LABELS.SPEECH_DETECTED.max) {
    return VAD_GAP_LABELS.SPEECH_DETECTED;
  } else {
    return VAD_GAP_LABELS.CONTINUOUS_SPEECH;
  }
}

/**
 * Analyze a single gap and return VAD analysis object.
 *
 * @param {number} gapStartMs - When previous word ended
 * @param {number} gapEndMs - When next word started
 * @param {Array} vadSegments - VAD speech segments
 * @returns {{speechPercent: number, label: string, description: string}}
 */
export function analyzeGap(gapStartMs, gapEndMs, vadSegments) {
  const speechPercent = calculateSpeechPercent(gapStartMs, gapEndMs, vadSegments);
  const { label, description } = getAcousticLabel(speechPercent);

  return {
    speechPercent,
    label,
    description
  };
}

/**
 * Enrich diagnostics with VAD gap analysis.
 *
 * NOTE: Intentionally mutates diagnostics.longPauses and diagnostics.onsetDelays
 * in place by adding _vadAnalysis properties. This avoids creating copies of
 * potentially large diagnostic arrays and keeps the enrichment transparent to
 * downstream consumers who simply see additional properties on existing objects.
 *
 * @param {Object} diagnostics - Diagnostics object from runDiagnostics()
 * @param {Array} transcriptWords - STT words with startTime/endTime
 * @param {Array} vadSegments - VAD speech segments (ms timestamps)
 */
export function enrichDiagnosticsWithVAD(diagnostics, transcriptWords, vadSegments) {
  if (!vadSegments || vadSegments.length === 0) {
    console.log('[VAD Gap] No VAD segments available, skipping gap analysis');
    return;
  }

  // Helper to parse STT time strings
  const parseTimeMs = (t) => {
    if (typeof t === 'number') return t * 1000;
    return (parseFloat(String(t).replace('s', '')) || 0) * 1000;
  };

  // Analyze long pauses
  if (diagnostics.longPauses) {
    for (const pause of diagnostics.longPauses) {
      const afterWord = transcriptWords[pause.afterWordIndex];
      const beforeWord = transcriptWords[pause.afterWordIndex + 1];

      if (afterWord && beforeWord) {
        const gapStartMs = parseTimeMs(afterWord.endTime);
        const gapEndMs = parseTimeMs(beforeWord.startTime);

        pause._vadAnalysis = analyzeGap(gapStartMs, gapEndMs, vadSegments);
      }
    }
  }

  // Analyze onset delays (hesitations)
  if (diagnostics.onsetDelays) {
    for (const delay of diagnostics.onsetDelays) {
      const word = transcriptWords[delay.wordIndex];
      const prevWord = transcriptWords[delay.wordIndex - 1];

      if (word && prevWord) {
        const gapStartMs = parseTimeMs(prevWord.endTime);
        const gapEndMs = parseTimeMs(word.startTime);

        delay._vadAnalysis = analyzeGap(gapStartMs, gapEndMs, vadSegments);
      }
    }
  }

  console.log('[VAD Gap] Enriched diagnostics with VAD analysis');
}
```

---

### Part 2: Integration in app.js

After `runDiagnostics()` call, add VAD enrichment:

```javascript
// In processRecording(), after line ~610 where runDiagnostics is called

import { enrichDiagnosticsWithVAD } from './vad-gap-analyzer.js';

// ... existing code ...
const diagnostics = runDiagnostics(transcriptWords, alignment, referenceText, sttLookup);

// NEW: Enrich gaps with VAD acoustic analysis
if (vadResult.segments && vadResult.segments.length > 0) {
  enrichDiagnosticsWithVAD(diagnostics, transcriptWords, vadResult.segments);
}
```

**Location:** After the `runDiagnostics()` call around line 610 in `app.js`, before diagnostics are passed to the UI.

---

### Part 3: UI Updates in ui.js

Update pause indicator tooltip to show VAD analysis:

```javascript
// In renderResults(), around line 523-529 where pause indicators are created

if (hasPause) {
  const pause = longPauseMap.get(currentHypIndex - 1);
  const pauseSpan = document.createElement('span');
  pauseSpan.className = 'pause-indicator';
  const pauseMs = Math.round(pause.gap * 1000);

  // Build tooltip with VAD analysis if available
  let tooltip = 'Long pause: ' + pauseMs + 'ms (error: >= 3000ms)';

  if (pause._vadAnalysis) {
    const vad = pause._vadAnalysis;
    tooltip += '\nAcoustic: ' + vad.speechPercent + '% speech (' + vad.label + ')';

    // Add visual indicator for notable cases
    if (vad.speechPercent >= 30) {
      pauseSpan.classList.add('pause-vad-activity');
    }
  }

  pauseSpan.title = tooltip;
  pauseSpan.textContent = '[' + pause.gap.toFixed(1) + 's]';
  wordsDiv.appendChild(pauseSpan);
}
```

Similarly for hesitation indicators (around line 497-508):

```javascript
if (onsetDelayMap.has(hypIdx)) {
  const delay = onsetDelayMap.get(hypIdx);
  span.classList.add('word-hesitation');
  const gapMs = Math.round(delay.gap * 1000);
  const threshMs = Math.round(delay.threshold * 1000);

  let hesitationNote = '\nHesitation: ' + gapMs + 'ms';
  if (delay.punctuationType === 'period') {
    hesitationNote += ' (threshold ' + threshMs + 'ms after sentence end)';
  } else if (delay.punctuationType === 'comma') {
    hesitationNote += ' (threshold ' + threshMs + 'ms after comma)';
  } else {
    hesitationNote += ' (threshold ' + threshMs + 'ms)';
  }

  // NEW: Add VAD analysis if available
  if (delay._vadAnalysis) {
    const vad = delay._vadAnalysis;
    hesitationNote += '\nAcoustic: ' + vad.speechPercent + '% speech (' + vad.label + ')';
  }

  span.title += hesitationNote;
}
```

---

### Part 4: CSS Styling (Optional)

Add subtle visual indicator for pauses with significant VAD activity:

```css
/* In style.css */

/* Pause indicator with VAD-detected speech activity */
.pause-indicator.pause-vad-activity {
  background-color: rgba(255, 193, 7, 0.2);  /* Subtle amber background */
  border-color: #ffc107;
}
```

This provides a visual cue that the "pause" may not be pure silence, prompting the teacher to hover for details.

---

### Part 5: Debug Logging

Add VAD gap analysis to the debug log:

```javascript
// In app.js debug logging, after diagnostics stage

addStage('vad_gap_analysis', {
  longPausesAnalyzed: diagnostics.longPauses?.filter(p => p._vadAnalysis).length || 0,
  hesitationsAnalyzed: diagnostics.onsetDelays?.filter(d => d._vadAnalysis).length || 0,
  summary: {
    silenceConfirmed: countByLabel(diagnostics, 'silence confirmed'),
    mostlySilent: countByLabel(diagnostics, 'mostly silent'),
    mixedSignal: countByLabel(diagnostics, 'mixed signal'),
    speechDetected: countByLabel(diagnostics, 'speech detected'),
    continuousSpeech: countByLabel(diagnostics, 'continuous speech')
  }
});

// Helper function
function countByLabel(diagnostics, label) {
  let count = 0;
  if (diagnostics.longPauses) {
    count += diagnostics.longPauses.filter(p => p._vadAnalysis?.label === label).length;
  }
  if (diagnostics.onsetDelays) {
    count += diagnostics.onsetDelays.filter(d => d._vadAnalysis?.label === label).length;
  }
  return count;
}
```

---

## What This Does NOT Do

| Not included | Reason |
|--------------|--------|
| Change hesitation detection | Purely informational |
| Remove or veto any detections | Additive only |
| Affect error counts or WCPM | No scoring changes |
| Require new dependencies | Uses existing VAD infrastructure |
| Add new settings/configuration | Works automatically |

---

## Example Output

### Debug Log Entry
```json
{
  "stage": "vad_gap_analysis",
  "data": {
    "longPausesAnalyzed": 1,
    "hesitationsAnalyzed": 7,
    "summary": {
      "silenceConfirmed": 4,
      "mostlySilent": 2,
      "mixedSignal": 1,
      "speechDetected": 1,
      "continuousSpeech": 0
    }
  }
}
```

### Long Pause with VAD Analysis
```json
{
  "afterWordIndex": 11,
  "afterWord": "quite",
  "beforeWord": "unnerved",
  "gap": 3.1,
  "_vadAnalysis": {
    "speechPercent": 42.3,
    "label": "mixed signal",
    "description": "Possible sounding out or partial attempts"
  }
}
```

### UI Tooltip
```
Long pause: 3100ms (error: >= 3000ms)
Acoustic: 42.3% speech (mixed signal)
```

---

## Implementation Phases

### Phase 1: Core Module
- [ ] Create `js/vad-gap-analyzer.js` with analysis functions
- [ ] Add unit tests for `calculateSpeechPercent()` and `getAcousticLabel()`
- [ ] Test with known VAD segment data

### Phase 2: Integration
- [ ] Import and call `enrichDiagnosticsWithVAD()` in `app.js`
- [ ] Verify `_vadAnalysis` appears in diagnostics objects
- [ ] Add debug log stage for VAD gap analysis

### Phase 3: UI Display
- [ ] Update pause indicator tooltip in `ui.js`
- [ ] Update hesitation tooltip in `ui.js`
- [ ] Add optional CSS styling for visual indicator

### Phase 4: Validation
- [ ] Test with "unnerved" recording to verify mixed signal detection
- [ ] Test with true silence recordings to verify silence confirmed
- [ ] Review tooltip formatting and label clarity

---

## Success Criteria

- [ ] Hovering over any pause indicator shows VAD speech percentage
- [ ] Labels are clear and non-judgmental
- [ ] No changes to existing detection logic or error counts
- [ ] Debug log includes VAD gap analysis summary
- [ ] Works gracefully when VAD data is unavailable (no errors, just omits VAD info)

---

## Future Considerations

If this proves valuable, future enhancements could include:

1. **Differentiated struggle classification:** "Hesitation" vs "Sounding out" as separate diagnostic categories
2. **Teacher dashboard:** Aggregate VAD analysis across students to identify common sounding-out words
3. **Threshold tuning:** Let teachers adjust what counts as "significant" VAD activity

These are out of scope for this plan but noted for future reference.
