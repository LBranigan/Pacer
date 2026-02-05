# Phase 24: Disfluency UI Display - Research

**Researched:** 2026-02-05
**Domain:** Vanilla JS DOM manipulation, CSS styling, UI patterns for speech disfluency visualization
**Confidence:** HIGH

## Summary

This phase adds a visual layer to display disfluency data that already flows through the pipeline from Phase 23 (Kitchen Sink integration). The Phase 23 pipeline produces per-word properties: `isDisfluency` (boolean), `disfluencyType` (filler/repetition/false_start/unknown), and `crossValidation` (confirmed/unconfirmed/unavailable). These properties are available on every word in the `kitchenSinkResult.words` array but are currently ignored by the UI rendering code.

The codebase uses a pure vanilla JS approach -- no React, no framework. All UI is built via `document.createElement()` in `js/ui.js` and styled via `style.css`. The existing patterns for word-level indicators (hesitation borders, disfluency badges, struggle word styling) and collapsible sections (Confidence View) provide exact templates to follow. Tooltips use the native `title` attribute throughout.

The main work involves: (1) adding a dot marker above disfluent words in the word rendering loop of `displayAlignmentResults`, (2) adding hover tooltips with disfluency type, (3) creating a new collapsible Disfluencies section in the diagnostics area, (4) threading the Kitchen Sink `disfluencyStats` data through to the UI function, and (5) updating `miscue-registry.js` with the new disfluency types from Phase 23.

**Primary recommendation:** Follow existing patterns exactly -- use `title` attribute for tooltips, clone the Confidence View collapsible pattern for the diagnostics section, and use CSS `::before` pseudo-element for the dot marker to avoid altering word DOM structure.

## Standard Stack

This phase uses no external libraries. The entire codebase is vanilla JS + CSS.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vanilla JS | ES2020+ modules | DOM manipulation, event handling | Existing codebase pattern -- no framework |
| CSS3 | N/A | Styling, pseudo-elements, animations | All styling in `style.css` |
| HTML5 | N/A | Semantic structure | Single-page app in `index.html` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | N/A | N/A | This is a pure CSS/JS UI task |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `title` attribute tooltips | Custom tooltip library (Tippy.js) | Overkill -- existing codebase uses `title` everywhere; consistency > polish |
| CSS `::before` pseudo-element for dot | Extra `<span>` element for dot | Pseudo-element avoids DOM clutter and doesn't affect text selection |
| CSS `max-height` transition | JS-driven animation | CSS is simpler; matches existing Confidence View pattern |

**Installation:**
```bash
# No installation needed -- pure vanilla JS/CSS
```

## Architecture Patterns

### Relevant Project Structure
```
js/
  ui.js                  # Word rendering + displayAlignmentResults() -- PRIMARY CHANGE
  app.js                 # Pipeline orchestrator -- THREADING CHANGE
  diagnostics.js         # Diagnostic analyzers (not changed, but data flows through)
  kitchen-sink-merger.js # Produces isDisfluency/disfluencyType per word (Phase 23)
  disfluency-tagger.js   # Classifications: filler/repetition/false_start/unknown (Phase 23)
  miscue-registry.js     # MUST be updated per CLAUDE.md
style.css                # All CSS -- NEW STYLES added here
index.html               # HTML structure -- NEW SECTION for disfluency diagnostics
```

### Pattern 1: Word-Level Indicator (Dot Marker)
**What:** A small dot above disfluent words, implemented via CSS `::before` pseudo-element on a class added to the word `<span>`.
**When to use:** When the word has `isDisfluency === true` in the pipeline data.
**How it works in the existing codebase:**

The word rendering loop in `displayAlignmentResults()` (ui.js line ~427-595) already checks for various conditions and adds CSS classes. The pattern is:
1. Check a condition on `sttWord` or `item`
2. Add a CSS class to `span` via `span.classList.add('word-xyz')`
3. Append tooltip info to `span.title`

For disfluencies, the data is on `sttWord` (which comes from the STT pipeline words). Each word has:
- `sttWord.isDisfluency` -- boolean, true if this word is a disfluency
- `sttWord.disfluencyType` -- string: 'filler', 'repetition', 'false_start', 'unknown', or null
- `sttWord.crossValidation` -- string: 'confirmed', 'unconfirmed', 'unavailable'

**Example:**
```javascript
// Source: Existing pattern in ui.js (hesitation overlay, line ~517)
// Adapted for disfluency dot marker
if (sttWord?.isDisfluency) {
  span.classList.add('word-disfluency');
  // Build tooltip
  const typeLabels = {
    filler: 'Filler (um, uh)',
    repetition: 'Repetition',
    false_start: 'False start',
    unknown: 'Disfluency'
  };
  const label = typeLabels[sttWord.disfluencyType] || 'Disfluency';
  span.title += `\n${label} — not an error`;
}
```

```css
/* Dot marker via ::before pseudo-element */
.word-disfluency {
  position: relative;
}

.word-disfluency::before {
  content: '\u2022';       /* bullet dot */
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.5rem;
  color: #9e9e9e;          /* subtle gray */
  line-height: 1;
  pointer-events: none;
}
```

### Pattern 2: Collapsible Section (Diagnostics Panel)
**What:** A collapsible section with header, toggle arrow, collapsed summary, and expanded details.
**When to use:** The Disfluencies section in the diagnostics area.
**Existing pattern:** The Confidence View section in `index.html` (lines 125-138) and `style.css` (lines 276-338).

**Example (from existing codebase):**
```html
<!-- Source: index.html lines 125-138 (Confidence View) -->
<div class="confidence-section" id="confidenceSection">
  <div class="confidence-header" onclick="document.getElementById('confidenceSection').classList.toggle('expanded')">
    <h4>Confidence View</h4>
    <span class="confidence-toggle">&#9660;</span>
  </div>
  <div class="confidence-body">
    <!-- Content here -->
  </div>
</div>
```

The disfluency section should follow this exact pattern:
```html
<div class="disfluency-section" id="disfluencySection">
  <div class="disfluency-header" onclick="document.getElementById('disfluencySection').classList.toggle('expanded')">
    <h4>Disfluencies</h4>
    <span class="disfluency-toggle">&#9660;</span>
  </div>
  <div class="disfluency-body">
    <div class="disfluency-summary" id="disfluencySummaryText"></div>
    <div class="disfluency-details" id="disfluencyDetails"></div>
  </div>
</div>
```

### Pattern 3: Data Threading (app.js to ui.js)
**What:** Passing Kitchen Sink disfluency stats through to the UI display function.
**Current state:** `displayAlignmentResults` already receives `disfluencySummary` as parameter 8 (line 252 of ui.js, called at line 890 of app.js). However, this currently passes `data._disfluency?.summary` which is the OLD Phase 14 severity-based summary (`{none, minor, moderate, significant, totalWordsWithDisfluency}`).

Phase 23's Kitchen Sink pipeline produces `kitchenSinkResult.disfluencyStats` with:
```javascript
{
  total: 3,           // Total disfluency count
  contentWords: 42,   // Non-disfluency word count (for WCPM)
  rate: '7.1%',       // Disfluency rate
  byType: {
    filler: 2,        // um, uh, etc.
    repetition: 1,    // repeated word
    false_start: 0,   // partial word attempts
    unknown: 0        // unclassified
  }
}
```

**Threading plan:** Pass `kitchenSinkResult.disfluencyStats` alongside or replacing the existing disfluency summary. The UI function needs `byType` breakdown for the expanded view and `total` + dominant type for the collapsed summary.

### Anti-Patterns to Avoid
- **Modifying word text or content for disfluency display:** The user decided "Word text stays normal appearance -- only the dot indicates disfluency." Never change `span.textContent`.
- **Using color/background changes on disfluent words:** The user explicitly decided "No color changes, background tints, or text styling for disfluent words."
- **Building a custom tooltip system:** Use `title` attribute, same as every other tooltip in the codebase.
- **Putting disfluency section inside the metrics bar:** It should be a separate collapsible section, not embedded in the WCPM/Accuracy metrics area.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Collapsible section | Custom accordion component | Clone Confidence View HTML/CSS pattern | Already exists and works; consistency |
| Tooltip rendering | Custom tooltip div with positioning | Native `title` attribute | Every tooltip in the app uses `title`; no reason to diverge |
| Disfluency type labels | Hardcoded strings scattered in code | Centralized label map object | Maintainability; easy to update wording |
| Dot marker | Extra DOM `<span>` element per word | CSS `::before` pseudo-element | Cleaner DOM, no interference with text selection |
| Dominant type calculation | Complex sorting logic | Simple max-count from byType object | At most 4 types; no need for anything fancy |

**Key insight:** This is a UI-only phase. The data pipeline is complete from Phase 23. The work is purely DOM manipulation and CSS, following patterns already established in the codebase.

## Common Pitfalls

### Pitfall 1: Disfluent Words Appear as Both Insertions AND Disfluencies
**What goes wrong:** Words marked `isDisfluency: true` in the Kitchen Sink pipeline are "insertions" from the verbatim-vs-clean alignment. But the ORF alignment (`alignment.js → alignWords()`) operates on the raw transcript words and may also classify some disfluent words as insertions. This means a filler word like "um" could appear in the "Inserted words" section at the bottom of results AND have a disfluency dot above it.
**Why it happens:** The Kitchen Sink disfluency detection and the ORF alignment are two separate systems operating on the same word list.
**How to avoid:** In the word rendering loop, check `sttWord.isDisfluency` and if true, consider whether it should be visually distinguished from regular insertions. The Phase 23 pipeline marks `isDisfluency` on the word itself, so the rendering code can check this property. Filler words ("um", "uh") that are disfluencies should NOT appear in the "Inserted words" section since they are expected disfluencies, not unexpected extra words.
**Warning signs:** "um" or "uh" appearing in both the disfluency count AND the insertions list.

### Pitfall 2: Disfluency Data Missing in Long Recording Path
**What goes wrong:** The Kitchen Sink pipeline only runs for recordings <= 55 seconds (the short recording path in `app.js` line 151-345). Long recordings (> 55 seconds) go through `sendToAsyncSTT` or `sendChunkedSTT` which do NOT produce `isDisfluency`/`disfluencyType` properties.
**Why it happens:** Long recordings use a different STT pipeline that doesn't include the Reverb verbatim/clean comparison.
**How to avoid:** The UI code must gracefully handle the case where `isDisfluency` is undefined on words. Use optional chaining: `sttWord?.isDisfluency`. The disfluency section in diagnostics should show "Not available" or simply not render when no disfluency data exists.
**Warning signs:** Errors or undefined values when processing long recordings.

### Pitfall 3: Dot Marker Overlapping Adjacent Word Text
**What goes wrong:** The CSS `::before` dot positioned with `position: absolute; top: -8px` can overlap with the previous line's text or be clipped by container overflow.
**Why it happens:** Words are `display: inline-block` with minimal margins (2px). The dot extends above the word's bounding box.
**How to avoid:** Add sufficient `padding-top` or `margin-top` to the word container (or the parent `.result-box`) to accommodate the dot. The existing `.word-with-disfluency` pattern (Phase 16) already uses `position: relative` on a wrapper -- but the user wants the dot directly on the word span, not a separate wrapper.
**Warning signs:** Dots invisible on the first line of words, or dots overlapping descenders of the line above.

### Pitfall 4: Forgetting to Update miscue-registry.js
**What goes wrong:** New disfluency types (filler, repetition, false_start as detected by Phase 23 Kitchen Sink pipeline) are displayed in UI but not registered in `miscue-registry.js`.
**Why it happens:** CLAUDE.md explicitly requires all miscue types to be in the registry, but it is easy to forget this housekeeping step when focused on UI work.
**How to avoid:** Task verification must check that `miscue-registry.js` includes entries for: `kitchenSinkFiller`, `kitchenSinkRepetition`, `kitchenSinkFalseStart` (or similar names). Each must have description, detector location (`kitchen-sink-merger.js` / `disfluency-tagger.js`), `countsAsError: false`, and uiClass.
**Warning signs:** Grep for "filler" or "false_start" in miscue-registry.js returns no results after implementation.

### Pitfall 5: Collapsible Section Default State
**What goes wrong:** The disfluency section starts expanded, cluttering the view for teachers who mainly care about errors.
**Why it happens:** The `expanded` class is added by default in HTML or JS.
**How to avoid:** Default to collapsed (no `expanded` class). The Confidence View section is also collapsed by default. Follow the same pattern.
**Warning signs:** Teachers see expanded disfluency details immediately, overwhelming the diagnostics area.

## Code Examples

### Example 1: Disfluency Dot Marker CSS
```css
/* Source: style.css existing patterns (.word-forgiven::after, .disfluency-badge) */

/* Phase 24: Disfluency dot marker */
.word-disfluency {
  position: relative;
}

.word-disfluency::before {
  content: '\u2022';          /* bullet character */
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.55rem;
  color: #9e9e9e;             /* subtle gray - unobtrusive */
  line-height: 1;
  pointer-events: none;       /* don't interfere with word hover */
}
```

### Example 2: Disfluency Tooltip in Word Rendering Loop
```javascript
// Source: ui.js displayAlignmentResults() -- insert after existing sttWord checks (~line 574)

// Phase 24: Disfluency indicator (Kitchen Sink pipeline)
if (sttWord?.isDisfluency) {
  span.classList.add('word-disfluency');
  const typeLabels = {
    filler: 'Filler (um, uh) — not an error',
    repetition: 'Repetition — not an error',
    false_start: 'False start — not an error',
    unknown: 'Disfluency — not an error'
  };
  const tooltip = typeLabels[sttWord.disfluencyType] || 'Disfluency — not an error';
  span.title += '\n' + tooltip;
}
```

### Example 3: Collapsible Disfluency Section (clone of Confidence View)
```html
<!-- Source: index.html -- place after Confidence View section, before Metrics -->
<div class="disfluency-section" id="disfluencySection">
  <div class="disfluency-header" onclick="document.getElementById('disfluencySection').classList.toggle('expanded')">
    <h4>Disfluencies</h4>
    <span class="disfluency-toggle">&#9660;</span>
  </div>
  <div class="disfluency-body">
    <div id="disfluencySummaryText"></div>
    <div id="disfluencyDetails"></div>
  </div>
</div>
```

### Example 4: Populating Disfluency Section in JS
```javascript
// Source: ui.js -- add new function, called from displayAlignmentResults

function renderDisfluencySection(disfluencyStats) {
  const section = document.getElementById('disfluencySection');
  const summaryEl = document.getElementById('disfluencySummaryText');
  const detailsEl = document.getElementById('disfluencyDetails');

  if (!section || !disfluencyStats || disfluencyStats.total === 0) {
    if (section) section.style.display = 'none';
    return;
  }

  section.style.display = '';

  // Collapsed summary: "Disfluencies: 3 (mostly fillers)"
  const byType = disfluencyStats.byType;
  const dominantType = Object.entries(byType)
    .filter(([_, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])[0];

  const typeNames = { filler: 'fillers', repetition: 'repetitions', false_start: 'false starts', unknown: 'other' };
  const dominantLabel = dominantType ? typeNames[dominantType[0]] || dominantType[0] : '';
  const summaryText = dominantLabel
    ? `Disfluencies: ${disfluencyStats.total} (mostly ${dominantLabel})`
    : `Disfluencies: ${disfluencyStats.total}`;
  summaryEl.textContent = summaryText;

  // Expanded details: each type on its own line
  detailsEl.innerHTML = '';
  const typeDetails = [
    { key: 'filler', label: 'Fillers (um, uh, er)' },
    { key: 'repetition', label: 'Repetitions' },
    { key: 'false_start', label: 'False starts' },
    { key: 'unknown', label: 'Other' }
  ];
  for (const { key, label } of typeDetails) {
    if (byType[key] > 0) {
      const line = document.createElement('div');
      line.textContent = `${label}: ${byType[key]}`;
      detailsEl.appendChild(line);
    }
  }
}
```

### Example 5: CSS for Disfluency Section (clone of Confidence View)
```css
/* Source: style.css -- clone of .confidence-section pattern (lines 276-338) */

.disfluency-section {
  margin-top: 1rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  overflow: hidden;
}

.disfluency-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  background: #f5f5f5;
  cursor: pointer;
  user-select: none;
}

.disfluency-header:hover {
  background: #eee;
}

.disfluency-header h4 {
  font-size: 0.9rem;
  font-weight: 600;
  color: #555;
  margin: 0;
}

.disfluency-toggle {
  font-size: 0.8rem;
  color: #888;
  transition: transform 0.2s;
}

.disfluency-section.expanded .disfluency-toggle {
  transform: rotate(180deg);
}

.disfluency-body {
  display: none;
  padding: 0.75rem;
  background: #fafafa;
}

.disfluency-section.expanded .disfluency-body {
  display: block;
}
```

### Example 6: Data Threading in app.js
```javascript
// Source: app.js line ~890 -- modify displayAlignmentResults call

// Current call (passes Phase 14 severity summary):
displayAlignmentResults(alignment, wcpm, accuracy, sttLookup, diagnostics,
  transcriptWords, tierBreakdown,
  data._disfluency?.summary || null,
  data._safety || null
);

// Updated call (also pass Kitchen Sink disfluency stats):
displayAlignmentResults(alignment, wcpm, accuracy, sttLookup, diagnostics,
  transcriptWords, tierBreakdown,
  data._disfluency?.summary || null,
  data._safety || null,
  kitchenSinkResult?.disfluencyStats || null  // NEW: Phase 24 disfluency stats by type
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 14 severity-based disfluency (minor/moderate/significant) | Phase 23 type-based disfluency (filler/repetition/false_start) | Phase 23 (2026-02) | UI should display TYPE not severity |
| Google STT ensemble disfluency detection | Reverb verbatim/clean diff disfluency detection | Phase 23 (2026-02) | More reliable classification via dual-transcript comparison |
| Disfluency badges (dot/double-dot/warning per severity) | Simple dot marker for all types | Phase 24 (user decision) | Simpler, more uniform visual |

**Deprecated/outdated:**
- Phase 14/16 severity-based disfluency badges (`disfluency-badge.minor/moderate/significant`): The old severity system (minor=dot, moderate=double-dot, significant=warning) is still rendered in `ui.js` via `createDisfluencyBadge()`. Phase 24 replaces this with a simpler dot-for-all approach using Phase 23's type-based classification. The old `createDisfluencyBadge` function and related code should be removed or guarded to prevent double-rendering.

## Key Data Flow (Pipeline to UI)

This is the critical path for understanding where disfluency data comes from:

```
1. kitchen-sink-merger.js::runKitchenSinkPipeline()
   -> Reverb transcription (verbatim + clean)
   -> sequence-aligner.js::alignTranscripts() -- diff verbatim vs clean
   -> disfluency-tagger.js::tagDisfluencies() -- classify insertions
   -> buildMergedWordsFromAlignment() -- sets isDisfluency, disfluencyType per word
   -> deepgram-api.js::crossValidateWithDeepgram() -- adds crossValidation
   -> Returns: { words: [...], disfluencyStats: { total, byType, ... } }

2. app.js::runAnalysis()
   -> kitchenSinkResult = await runKitchenSinkPipeline(...)
   -> Words flow through: classify -> filter ghosts -> detect disfluencies -> safety -> align
   -> displayAlignmentResults(alignment, ..., disfluencyStats)
   -> isDisfluency/disfluencyType properties remain on each sttWord through pipeline

3. ui.js::displayAlignmentResults()
   -> Word rendering loop accesses sttWord via sttLookup
   -> NEW: Check sttWord.isDisfluency, add dot + tooltip
   -> NEW: renderDisfluencySection(disfluencyStats) populates diagnostics panel
```

**Important caveat:** The `sttLookup` map (ui.js line 443) is keyed by normalized word text. When multiple instances of the same word exist (e.g., two "the" words, one disfluency and one not), the queue-based lookup (`queue.shift()`) returns them in order. The `isDisfluency` flag should be on the correct word because the pipeline preserves word order.

## Open Questions

1. **Conflict between Phase 16 disfluency badges and Phase 24 dot markers**
   - What we know: Phase 16 added `createDisfluencyBadge()` which renders minor/moderate/significant badges based on `sttWord.severity`. Phase 24 adds a new dot based on `sttWord.isDisfluency` from the Kitchen Sink pipeline. Both could render on the same word.
   - What's unclear: Should the old Phase 16 severity badges be removed entirely, or should they coexist with the new Phase 24 type-based dot markers?
   - Recommendation: Remove/skip the old Phase 16 disfluency badge rendering when Kitchen Sink data is present (i.e., when `sttWord.isDisfluency !== undefined`). The Phase 16 severity system is superseded by the Phase 23 type-based system. However, preserve the Phase 16 code path as fallback for long recordings that don't go through Kitchen Sink.

2. **Scope of `kitchenSinkResult` variable in app.js**
   - What we know: `kitchenSinkResult` is declared inside the `else` block of the recording-length check (line 151). It's not available at the point where `displayAlignmentResults` is called (line 890), which is outside that block.
   - What's unclear: The exact scoping -- need to verify whether `disfluencyStats` can be threaded through `data._disfluency` or needs separate handling.
   - Recommendation: Store `kitchenSinkResult.disfluencyStats` on `data._kitchenSink = { disfluencyStats }` inside the Kitchen Sink branch, then access it as `data._kitchenSink?.disfluencyStats` at the display call.

3. **Disfluent words in insertion rendering**
   - What we know: Words with `isDisfluency: true` may also appear as "insertions" in the ORF alignment. The "Inserted words (not in passage)" section at the bottom renders these.
   - What's unclear: Whether disfluent insertions (fillers like "um") should be excluded from the insertion list entirely, or displayed differently.
   - Recommendation: Filter disfluent words out of the insertions display. Fillers like "um" are expected speech events, not reading errors. Display them only via the disfluency dot and the diagnostics section.

## Sources

### Primary (HIGH confidence)
- `js/ui.js` -- Direct codebase inspection: word rendering loop, tooltip patterns, `displayAlignmentResults` signature
- `js/kitchen-sink-merger.js` -- Direct codebase inspection: `isDisfluency`, `disfluencyType`, `crossValidation` properties
- `js/disfluency-tagger.js` -- Direct codebase inspection: `classifyDisfluency()`, `computeDisfluencyStats()`, type taxonomy
- `js/app.js` -- Direct codebase inspection: pipeline flow, `displayAlignmentResults` call, data threading
- `js/miscue-registry.js` -- Direct codebase inspection: existing registry structure, required fields
- `style.css` -- Direct codebase inspection: existing `.confidence-section`, `.disfluency-badge`, `.word-forgiven::after` patterns
- `index.html` -- Direct codebase inspection: Confidence View collapsible section template

### Secondary (MEDIUM confidence)
- N/A -- This is a UI-only task working with existing codebase patterns. No external libraries or APIs to research.

### Tertiary (LOW confidence)
- N/A

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Pure codebase inspection, no external dependencies
- Architecture: HIGH -- All patterns observed directly in existing code
- Pitfalls: HIGH -- Identified through reading actual data flow and variable scoping
- Code examples: HIGH -- Derived from existing patterns in the same files

**Research date:** 2026-02-05
**Valid until:** 2026-03-05 (stable -- no external dependency changes expected)
