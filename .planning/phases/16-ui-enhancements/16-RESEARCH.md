# Phase 16: UI Enhancements - Research

**Researched:** 2026-02-03
**Domain:** CSS UI patterns, tooltip positioning, badge systems, vanilla JavaScript DOM manipulation
**Confidence:** HIGH

## Summary

Phase 16 surfaces v1.1 backend data (ensemble, disfluency, safety checks) in the existing teacher UI. This is pure presentation layer work - no new data processing. The codebase uses vanilla JavaScript with modular ES6 patterns (`js/ui.js`, `js/app.js`) and plain CSS (`style.css`).

All required data structures already exist and are persisted in assessments:
- `_ensemble` - dual model results with timestamps
- `_disfluency` - severity, attempts, fragments per word
- `_safety` - rate anomalies, collapse state, flags
- `_classification` - trust levels, flags

The implementation follows existing patterns: extend `displayAlignmentResults()` in `ui.js`, add CSS classes to `style.css`, and wire calibration UI in `app.js`.

**Primary recommendation:** Use CSS-only patterns (pseudo-elements, `position: absolute`, `text-decoration`) for all visual elements. No external libraries needed.

## Standard Stack

The existing codebase already provides everything needed:

### Core (Already in Use)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vanilla JS | ES6+ | DOM manipulation | Already used throughout |
| CSS | Modern (CSS3+) | Styling, positioning | Already in `style.css` |
| No framework | - | Keep it simple | Existing pattern |

### Supporting (Already in Place)
| Module | Location | Purpose | Relevant to Phase 16 |
|--------|----------|---------|---------------------|
| `js/ui.js` | Existing | Display functions | Extend `displayAlignmentResults()` |
| `style.css` | Existing | All styles | Add badge/tooltip classes |
| `js/app.js` | Existing | Event wiring | VAD calibration already wired |
| `js/metrics.js` | Existing | WCPM calculation | May need range extension |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CSS tooltips | Tippy.js | Overkill for simple info display |
| CSS badges | External library | Adds dependency, existing CSS is sufficient |
| JavaScript positioning | CSS Anchor API | Not needed - simple hover tooltips work |

**Installation:**
```bash
# No additional packages needed - vanilla CSS and JS
```

## Architecture Patterns

### Recommended File Changes
```
js/
├── ui.js            # Extend displayAlignmentResults()
├── metrics.js       # Add computeWCPMRange() if needed
└── app.js           # Already has VAD calibration wiring

style.css            # Add badge, tooltip, range CSS classes
index.html           # Move VAD slider to dev mode only
```

### Pattern 1: CSS-Only Tooltips with Pseudo-Elements
**What:** Use `::after` pseudo-element for tooltip content, triggered by `:hover`
**When to use:** For word tooltips showing debug info, disfluency traces
**Example:**
```css
/* Source: Codebase pattern from existing .word class */
.word-with-tooltip {
  position: relative;
  cursor: help;
}

.word-with-tooltip::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.5rem 0.75rem;
  background: #333;
  color: #fff;
  font-size: 0.75rem;
  white-space: pre-line;
  border-radius: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
  z-index: 100;
  min-width: 180px;
  max-width: 300px;
}

.word-with-tooltip:hover::after {
  opacity: 1;
}
```

### Pattern 2: Superscript Badge with Position Absolute
**What:** Position badge in top-right corner of parent element
**When to use:** For disfluency severity indicators (dot, double-dot, warning)
**Example:**
```css
/* Source: Standard notification badge pattern */
.word-with-badge {
  position: relative;
  display: inline-block;
}

.disfluency-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  font-size: 0.6rem;
  line-height: 1;
  z-index: 10;
}

/* Severity colors - per CONTEXT.md decisions */
.disfluency-badge.minor { color: #ffc107; }      /* Yellow - single dot */
.disfluency-badge.moderate { color: #ff9800; }   /* Orange - double dot */
.disfluency-badge.significant { color: #f44336; } /* Red - warning icon */
```

### Pattern 3: Dashed Underline for Rate Anomaly
**What:** Use `text-decoration: dashed underline` for rate-flagged words
**When to use:** Visually distinguish rate anomalies from disfluency badges
**Example:**
```css
/* Source: MDN text-decoration-style docs */
.word-rate-anomaly {
  text-decoration: underline dashed;
  text-decoration-color: #e65100;
  text-underline-offset: 3px;
}

/* Alternative: dotted border bottom */
.word-rate-anomaly-border {
  border-bottom: 2px dotted #e65100;
  padding-bottom: 1px;
}
```

### Pattern 4: WCPM Range Display
**What:** Primary value prominent, range below in smaller text
**When to use:** Display conservative WCPM with confidence range
**Example:**
```css
.wcpm-container {
  text-align: center;
}

.wcpm-primary {
  font-size: 1.8rem;
  font-weight: 700;
  color: #333;
  line-height: 1.2;
}

.wcpm-range {
  font-size: 0.85rem;
  color: #666;
  margin-top: 0.15rem;
}

.fluency-summary {
  font-size: 0.8rem;
  color: #666;
  margin-top: 0.5rem;
}
```

### Anti-Patterns to Avoid
- **JavaScript tooltip positioning:** CSS-only is simpler, works for this use case
- **External tooltip library:** Adds dependency for simple hover text
- **Putting all logic in CSS:** Data binding still requires JavaScript
- **Modifying data structures:** UI layer only - don't change backend data

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tooltip positioning | Manual JS calculations | CSS `position: absolute` + `:hover` | Built-in, performant |
| Badge positioning | Calculate coordinates | CSS `position: absolute` | Standard pattern |
| Dashed underlines | Border hacks | `text-decoration: dashed underline` | Native CSS3 property |
| Data-driven content | Template strings | `data-*` attributes + `attr()` | CSS-accessible, accessible |

**Key insight:** Modern CSS handles all visual requirements. JavaScript only bridges data to attributes.

## Common Pitfalls

### Pitfall 1: Tooltip Overflow
**What goes wrong:** Tooltip renders outside viewport on edge words
**Why it happens:** Absolute positioning doesn't account for container bounds
**How to avoid:** Use `left: 50%; transform: translateX(-50%)` for centering; accept that edge words may have clipped tooltips (acceptable for this use case)
**Warning signs:** Users report unreadable tooltips on first/last words

### Pitfall 2: Z-Index Stacking Issues
**What goes wrong:** Tooltips appear behind other elements
**Why it happens:** Z-index only works within stacking contexts
**How to avoid:** Set tooltip z-index high (100+); ensure parent has `position: relative`
**Warning signs:** Tooltips hidden behind metrics bar or other UI elements

### Pitfall 3: Data Attribute Escaping
**What goes wrong:** Special characters break `attr()` content
**Why it happens:** HTML entities in data attributes need escaping
**How to avoid:** Use JavaScript `textContent` instead of `innerHTML` for tooltip updates, or escape quotes/special chars
**Warning signs:** Tooltips show `&quot;` or break on punctuation

### Pitfall 4: Badge Collision with Word Spacing
**What goes wrong:** Badges overlap or crowd adjacent words
**Why it happens:** `inline-block` elements with `position: relative` can overlap
**How to avoid:** Add slight right margin (`margin-right: 2px`) to badged words; or use transform instead of position offset
**Warning signs:** Reading flow disrupted by crowded badges

### Pitfall 5: VAD Slider Dev Mode Gating
**What goes wrong:** Slider visible to all users instead of dev mode only
**Why it happens:** Current code shows slider to everyone
**How to avoid:** Wrap slider in `class="dev-mode-only"` with `display: none` default; toggle via `body.dev-mode .dev-mode-only { display: block }`
**Warning signs:** Teachers confused by technical slider

### Pitfall 6: Missing Data Graceful Degradation
**What goes wrong:** UI crashes when `_disfluency` or `_safety` is undefined
**Why it happens:** Older assessments lack new fields
**How to avoid:** Always check `assessment._disfluency?.summary` with optional chaining
**Warning signs:** Console errors on older assessment load

## Code Examples

Verified patterns for this phase:

### Word Tooltip with Debug Info
```javascript
// Source: Existing ui.js pattern, extended
function buildWordTooltip(item, sttWord) {
  const lines = [];

  // Type info (existing)
  if (item.type === 'substitution') {
    lines.push(`Expected: ${item.ref}, Said: ${item.hyp}`);
  }

  // Timestamps with duration (per CONTEXT.md)
  if (sttWord) {
    const start = parseTime(sttWord.startTime);
    const end = parseTime(sttWord.endTime);
    const duration = Math.round((end - start) * 1000);
    lines.push(`Time: ${start.toFixed(2)}s - ${end.toFixed(2)}s (${duration}ms)`);

    // Dual model info
    if (sttWord._debug) {
      if (sttWord._debug.latest) {
        lines.push(`latest_long: "${sttWord._debug.latest.word}" (${(sttWord._debug.latest.confidence * 100).toFixed(1)}%)`);
      }
      if (sttWord._debug.default) {
        lines.push(`default: "${sttWord._debug.default.word}" (${(sttWord._debug.default.confidence * 100).toFixed(1)}%)`);
      }
    }
  }

  // Flags (per CONTEXT.md: text list)
  if (item._flags && item._flags.length > 0) {
    lines.push(`Flags: ${item._flags.join(', ')}`);
  }

  return lines.join('\n');
}
```

### Disfluency Badge Rendering
```javascript
// Source: CONTEXT.md decisions + standard badge pattern
function renderDisfluencyBadge(word) {
  const severity = word.severity || 'none';
  if (severity === 'none') return '';

  const badges = {
    minor: '<span class="disfluency-badge minor" title="2 attempts">&#8226;</span>',
    moderate: '<span class="disfluency-badge moderate" title="3-4 attempts">&#8226;&#8226;</span>',
    significant: '<span class="disfluency-badge significant" title="5+ attempts">&#9888;</span>'
  };

  return badges[severity] || '';
}

// Build tooltip for badge hover (show fragments)
function buildDisfluencyTooltip(word) {
  if (!word._disfluency) return '';

  const frags = word._disfluency.fragments || [];
  if (frags.length === 0) return `${word.attempts} attempts`;

  const trace = frags.map(f => f.word).join(', ');
  return `Attempts: ${trace}, ${word.word}`;
}
```

### WCPM Range Display
```javascript
// Source: CONTEXT.md decision - conservative primary value
function renderWCPMRange(wcpmMin, wcpmMax) {
  // wcpmMin is the conservative value (primary)
  // wcpmMax reflects uncertainty upper bound

  const container = document.createElement('div');
  container.className = 'wcpm-container';

  const primary = document.createElement('div');
  primary.className = 'wcpm-primary';
  primary.textContent = wcpmMin;

  const range = document.createElement('div');
  range.className = 'wcpm-range';
  range.textContent = `${wcpmMin}-${wcpmMax} WCPM`;

  container.appendChild(primary);
  container.appendChild(range);

  return container;
}
```

### Fluency Concerns Summary
```javascript
// Source: CONTEXT.md decision - counts by severity
function renderFluencySummary(disfluencySummary) {
  if (!disfluencySummary || disfluencySummary.totalWordsWithDisfluency === 0) {
    return null;
  }

  const parts = [];
  if (disfluencySummary.significant > 0) {
    parts.push(`${disfluencySummary.significant} significant`);
  }
  if (disfluencySummary.moderate > 0) {
    parts.push(`${disfluencySummary.moderate} moderate`);
  }
  if (disfluencySummary.minor > 0) {
    parts.push(`${disfluencySummary.minor} minor`);
  }

  const summary = document.createElement('div');
  summary.className = 'fluency-summary';
  summary.textContent = parts.join(', ');
  return summary;
}
```

### CSS for All New Elements
```css
/* Source: Codebase style.css patterns + research findings */

/* Disfluency badges - superscript position */
.word-with-disfluency {
  position: relative;
  display: inline-block;
}

.disfluency-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  font-size: 0.65rem;
  line-height: 1;
  z-index: 10;
  pointer-events: auto;
  cursor: help;
}

.disfluency-badge.minor { color: #ffc107; }
.disfluency-badge.moderate { color: #ff9800; }
.disfluency-badge.significant { color: #f44336; }

/* Rate anomaly - dashed underline (different from badges) */
.word-rate-anomaly {
  text-decoration: underline dashed;
  text-decoration-color: #e65100;
  text-underline-offset: 3px;
}

/* WCPM range display */
.wcpm-container {
  text-align: center;
}

.wcpm-primary {
  font-size: 1.8rem;
  font-weight: 700;
  color: #333;
}

.wcpm-range {
  font-size: 0.85rem;
  color: #666;
  margin-top: 0.1rem;
}

.fluency-summary {
  font-size: 0.8rem;
  color: #888;
  margin-top: 0.5rem;
}

/* Dev mode gating for VAD slider */
.dev-mode-only {
  display: none;
}

body.dev-mode .dev-mode-only {
  display: block;
}

/* Collapse warning banner */
.collapse-banner {
  background: #fff3e0;
  border: 1px solid #ff9800;
  border-radius: 4px;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  color: #e65100;
  font-weight: 600;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| JS tooltip positioning | CSS `:hover` + `::after` | CSS3 era | Simpler, no event listeners |
| Manual underline borders | `text-decoration-style` | CSS3 | Native browser support |
| JS badge positioning | CSS `position: absolute` | Always | Standard pattern |
| Single WCPM value | Range with confidence | This phase | Better accuracy representation |

**Deprecated/outdated:**
- `title` attribute for tooltips: Poor accessibility, inconsistent styling
- JavaScript-heavy tooltip libraries for simple use cases: Unnecessary overhead

## Open Questions

Things that couldn't be fully resolved:

1. **WCPM Range Calculation**
   - What we know: Need min/max values representing uncertainty
   - What's unclear: Is range already computed? May need to add `computeWCPMRange()` to metrics.js
   - Recommendation: Check if ensemble stats provide this, or calculate from disfluency impact

2. **Collapse State UI**
   - What we know: When `_safety.collapse.collapsed === true`, hide WCPM
   - What's unclear: Exact banner message wording
   - Recommendation: Use "Results may be unreliable due to poor audio quality" per safety-checker context

3. **Edge Case: Disfluency + Rate Anomaly on Same Word**
   - What we know: Both visuals need to appear (badge + underline)
   - What's unclear: Does this create visual clutter?
   - Recommendation: Test with real data; both should be visible (badge on top, underline below)

## Sources

### Primary (HIGH confidence)
- Existing codebase files: `ui.js`, `style.css`, `app.js`, `disfluency-detector.js`, `safety-checker.js`
- [MDN text-decoration-style](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/text-decoration-style)
- [MDN text-underline-offset](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/text-underline-offset)

### Secondary (MEDIUM confidence)
- [CSS-Tricks Tooltip Best Practices](https://css-tricks.com/tooltip-best-practices/)
- [W3Schools CSS Tooltip](https://www.w3schools.com/css/css_tooltip.asp)
- [Smashing Magazine Modern CSS Tooltips](https://www.smashingmagazine.com/2024/03/modern-css-tooltips-speech-bubbles-part1/)
- [CSS Notification Badge Patterns](https://mavtipi.medium.com/sample-css-for-notification-badges-6048b314a2b0)

### Tertiary (LOW confidence)
- General CSS patterns from web search - verified against MDN

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All patterns from existing codebase
- Architecture: HIGH - Extends established ui.js/style.css structure
- Pitfalls: MEDIUM - Some edge cases need testing with real data

**Research date:** 2026-02-03
**Valid until:** 2026-03-03 (30 days - stable domain, CSS patterns don't change rapidly)
