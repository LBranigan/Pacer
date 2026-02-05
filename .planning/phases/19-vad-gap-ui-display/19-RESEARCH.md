# Phase 19: VAD Gap UI Display - Research

**Researched:** 2026-02-04
**Domain:** CSS styling, JavaScript DOM manipulation, tooltip patterns, vanilla JS UI
**Confidence:** HIGH

## Summary

Phase 19 displays VAD acoustic context on existing pause and hesitation indicators so teachers understand what happened during reported gaps. The data infrastructure is complete from Phase 18 - diagnostics already contain `_vadAnalysis` properties with `speechPercent` (0-100) and `label` (acoustic classification). This phase is pure UI presentation work.

The implementation follows existing codebase patterns: native `title` attribute tooltips, CSS classes for visual distinction, and extending the existing `displayAlignmentResults()` function in `ui.js`. No external libraries needed.

Per CONTEXT.md decisions:
- Tooltips use native `title` attribute (matching existing app patterns)
- Orange color (#ff9800) for indicators with VAD >= 30%
- Factual descriptions like "speech detected during gap" rather than behavioral interpretations

**Primary recommendation:** Extend existing tooltip strings in `ui.js` to include VAD data; add CSS class for orange color when VAD >= 30%.

## Standard Stack

The existing codebase already provides everything needed:

### Core (Already in Use)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vanilla JS | ES6+ | DOM manipulation | Already used throughout codebase |
| CSS | Modern (CSS3+) | Styling | Already in `style.css` |
| Native `title` attr | Browser | Tooltips | Existing pattern in codebase |

### Supporting (Already in Place)
| Module | Location | Purpose | Relevant to Phase 19 |
|--------|----------|---------|---------------------|
| `js/ui.js` | Existing | Display functions | Extend pause/hesitation rendering |
| `style.css` | Existing | All styles | Add orange indicator class |
| `js/vad-gap-analyzer.js` | Existing | VAD data source | Provides `_vadAnalysis` data |
| `js/diagnostics.js` | Existing | Pause/hesitation data | Contains enriched diagnostics |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native title | CSS pseudo-element tooltips | Would break existing tooltip pattern |
| Native title | Tippy.js/Popper.js | Overkill, adds dependency |
| CSS class toggle | Inline style | CSS class is cleaner, existing pattern |

**Installation:**
```bash
# No additional packages needed - vanilla CSS and JS
```

## Architecture Patterns

### Recommended File Changes
```
js/
└── ui.js            # Extend pause indicator and hesitation tooltip logic

style.css            # Add .pause-indicator-vad and .word-hesitation-vad classes
```

### Pattern 1: Native Title Attribute for Tooltips
**What:** Use the browser's native `title` attribute for hover tooltips
**When to use:** All tooltips in this codebase (per established pattern)
**Example:**
```javascript
// Source: Existing ui.js pattern (line 527)
pauseSpan.title = 'Long pause: ' + pauseMs + 'ms (error: >= 3000ms)';

// Extended with VAD:
let tooltip = 'Long pause: ' + pauseMs + 'ms (error: >= 3000ms)';
if (pause._vadAnalysis) {
  tooltip += '\nVAD: ' + pause._vadAnalysis.speechPercent + '% (' + pause._vadAnalysis.label + ')';
}
pauseSpan.title = tooltip;
```

### Pattern 2: Conditional CSS Class for Color Distinction
**What:** Add CSS class when VAD percentage >= 30%
**When to use:** Visual distinction for pause/hesitation indicators with significant speech
**Example:**
```javascript
// Source: Existing class toggle pattern in ui.js
if (pause._vadAnalysis && pause._vadAnalysis.speechPercent >= 30) {
  pauseSpan.classList.add('pause-indicator-vad');
}
```

```css
/* Orange color for VAD >= 30% */
.pause-indicator-vad {
  color: #ff9800;  /* Orange instead of default red/gray */
}

.word-hesitation-vad {
  border-left-color: #ff9800;  /* Orange left border instead of default */
}
```

### Pattern 3: Factual Description Mapping
**What:** Map acoustic labels to factual descriptions for tooltip hints
**When to use:** Providing interpretive hints in tooltips
**Example:**
```javascript
// Source: CONTEXT.md decision - factual descriptions
const FACTUAL_HINTS = {
  'silence confirmed': 'no speech detected',
  'mostly silent': 'minimal speech detected',
  'mixed signal': 'partial speech during gap',
  'speech detected': 'speech detected during gap',
  'continuous speech': 'continuous speech during gap'
};

function getFactualHint(label) {
  return FACTUAL_HINTS[label] || label;
}
```

### Anti-Patterns to Avoid
- **Custom tooltip positioning:** The existing codebase uses `title` attr - don't add CSS tooltips
- **Behavioral interpretations:** Don't say "student was sounding out" - say "speech detected"
- **Gradient colors:** Per CONTEXT.md, single orange shade for >= 30%, not gradients
- **Click-to-pin tooltips:** Per CONTEXT.md, hover only

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tooltip display | CSS pseudo-element system | Native `title` attribute | Matches existing pattern |
| Color theme | Custom color system | Existing color variables (#ff9800) | Consistency |
| Touch support | Custom tap handlers | Browser default (tap shows title) | Standard behavior |
| Data access | Custom data plumbing | Existing `_vadAnalysis` object | Already implemented in Phase 18 |

**Key insight:** Phase 18 did the hard work. This phase just displays what's already computed.

## Common Pitfalls

### Pitfall 1: Tooltip Not Showing VAD Data
**What goes wrong:** Tooltip shows pause duration but not VAD information
**Why it happens:** `_vadAnalysis` property not checked or VAD segments were unavailable
**How to avoid:** Always check `pause._vadAnalysis` existence before accessing properties
**Warning signs:** Pause tooltip only shows duration, no VAD percentage

### Pitfall 2: Wrong Threshold for Color Change
**What goes wrong:** Color changes at wrong percentage (e.g., > 30 instead of >= 30)
**Why it happens:** Off-by-one error in comparison
**How to avoid:** Use `>= 30` as specified in CONTEXT.md
**Warning signs:** 30% exactly doesn't trigger orange color

### Pitfall 3: Hesitation vs Pause Index Mismatch
**What goes wrong:** VAD data displayed on wrong indicator
**Why it happens:** `onsetDelays` use `wordIndex`, `longPauses` use `afterWordIndex`
**How to avoid:** Match index access pattern from existing code (already correct in Phase 18)
**Warning signs:** Tooltip shows wrong VAD percentage for indicator position

### Pitfall 4: Missing Touch Device Support
**What goes wrong:** Tooltips don't work on mobile/tablet
**Why it happens:** Native `title` doesn't show on tap by default on some browsers
**How to avoid:** Per CONTEXT.md decision: "Touch devices: tap to show, tap elsewhere to hide" - this is browser default behavior for `title` on most mobile browsers. No custom JS needed.
**Warning signs:** Mobile users can't see VAD info

### Pitfall 5: Color Contrast Issues
**What goes wrong:** Orange text is hard to read
**Why it happens:** Orange (#ff9800) may have poor contrast on certain backgrounds
**How to avoid:** Test against the result box background (#fafafa) - existing pause indicator color scheme works
**Warning signs:** Accessibility complaints about readability

### Pitfall 6: Inconsistent Tooltip Format
**What goes wrong:** Pause and hesitation tooltips show VAD info differently
**Why it happens:** Each indicator built in separate code blocks
**How to avoid:** Use shared helper function for building VAD tooltip portion
**Warning signs:** "VAD: 45% (mixed signal)" on pause vs "45% speech" on hesitation

## Code Examples

Verified patterns for this phase:

### Build VAD Tooltip Portion
```javascript
// Source: CONTEXT.md decisions + existing tooltip pattern
/**
 * Build tooltip portion for VAD analysis.
 * Returns formatted string or empty if no VAD data.
 */
function buildVADTooltipInfo(vadAnalysis) {
  if (!vadAnalysis) return '';

  const factualHints = {
    'silence confirmed': 'no speech detected',
    'mostly silent': 'minimal speech detected',
    'mixed signal': 'partial speech during gap',
    'speech detected': 'speech detected during gap',
    'continuous speech': 'continuous speech during gap'
  };

  const hint = factualHints[vadAnalysis.label] || vadAnalysis.label;

  // Format: VAD: 45% (mixed signal)
  // Per CONTEXT.md: percentage first, then duration (duration already shown), then hint
  return `\nVAD: ${vadAnalysis.speechPercent}% - ${hint}`;
}
```

### Updated Pause Indicator Rendering
```javascript
// Source: ui.js line ~519-532, extended
// Insert pause indicator before this word if previous hyp word had a long pause
if (currentHypIndex !== null && currentHypIndex > 0) {
  const hasPause = longPauseMap.has(currentHypIndex - 1);
  if (hasPause) {
    const pause = longPauseMap.get(currentHypIndex - 1);
    const pauseSpan = document.createElement('span');
    pauseSpan.className = 'pause-indicator';

    // Check for VAD activity >= 30% for orange color
    if (pause._vadAnalysis && pause._vadAnalysis.speechPercent >= 30) {
      pauseSpan.classList.add('pause-indicator-vad');
    }

    const pauseMs = Math.round(pause.gap * 1000);

    // Build tooltip with VAD info
    let tooltip = 'Long pause: ' + pauseMs + 'ms (error: >= 3000ms)';
    tooltip += buildVADTooltipInfo(pause._vadAnalysis);
    pauseSpan.title = tooltip;

    pauseSpan.textContent = '[' + pause.gap + 's]';
    wordsDiv.appendChild(pauseSpan);
    wordsDiv.appendChild(document.createTextNode(' '));
  }
}
```

### Updated Hesitation Indicator Rendering
```javascript
// Source: ui.js line ~494-509, extended
// Hesitation overlay (for items that have a hyp word)
if (currentHypIndex !== null && onsetDelayMap.has(currentHypIndex)) {
  const delay = onsetDelayMap.get(currentHypIndex);

  // Base hesitation class
  span.classList.add('word-hesitation');

  // Check for VAD activity >= 30% for orange color
  if (delay._vadAnalysis && delay._vadAnalysis.speechPercent >= 30) {
    span.classList.add('word-hesitation-vad');
  }

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

  // Add VAD info to tooltip
  hesitationNote += buildVADTooltipInfo(delay._vadAnalysis);
  span.title += hesitationNote;
}
```

### CSS for Visual Distinction
```css
/* Source: CONTEXT.md decisions + existing style.css patterns */

/* Pause indicator with VAD activity >= 30% - orange color */
.pause-indicator-vad {
  color: #ff9800;  /* Orange - differentiates from red (true silence) */
}

/* Hesitation indicator with VAD activity >= 30% - orange border */
.word-hesitation-vad {
  border-left-color: #ff9800;  /* Orange left border */
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No acoustic context | VAD enrichment on gaps | Phase 18 (2026-02-05) | Teachers can understand gap cause |
| Single pause color | Color varies by VAD | This phase | Visual distinction for speech-filled gaps |
| Behavioral labels | Factual descriptions | CONTEXT.md decision | Teachers draw own conclusions |

**Deprecated/outdated:**
- N/A - this is a new feature building on existing infrastructure

## Open Questions

Things that couldn't be fully resolved:

1. **Touch Device Tooltip Behavior**
   - What we know: Native `title` varies by browser on touch devices
   - What's unclear: Exact behavior on iOS Safari vs Chrome for Android
   - Recommendation: Accept browser default behavior per CONTEXT.md decision; monitor user feedback

2. **Tooltip Delay**
   - What we know: CONTEXT.md says "appears instantly on hover (no delay)"
   - What's unclear: Native `title` has browser-controlled delay (~300-800ms)
   - Recommendation: Accept browser default; custom instant tooltips would require CSS/JS changes that break existing pattern

## Sources

### Primary (HIGH confidence)
- Existing codebase files: `ui.js`, `style.css`, `vad-gap-analyzer.js`, `diagnostics.js`
- Phase 18 implementation: `_vadAnalysis` data structure verified in code
- CONTEXT.md: Explicit decisions on colors, content format, tooltip behavior

### Secondary (MEDIUM confidence)
- Phase 16 Research: Established tooltip pattern (native `title`) for this codebase
- [MDN title attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/title) - Browser tooltip behavior

### Tertiary (LOW confidence)
- WebSearch results on tooltip positioning - not applicable since we use native `title`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Uses only existing patterns from codebase
- Architecture: HIGH - Extends established ui.js structure with minimal changes
- Pitfalls: MEDIUM - Touch device behavior varies by browser (browser default, not our control)

**Research date:** 2026-02-04
**Valid until:** 2026-03-04 (30 days - stable domain, simple UI changes)
