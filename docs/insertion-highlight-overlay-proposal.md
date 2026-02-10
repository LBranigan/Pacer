# Insertion & Self-Correction Highlight Overlay

## Problem

When the user clicks an insertion word (e.g., "gous") or a self-correction (e.g., the repeated "the") in their respective sections below the analyzed words, there's no visual connection back to **where in the passage** that speech event occurred. The user has to mentally map timestamps to figure out "gous" happened between "pro-" and "feeling".

## Proposed Feature

**Click an insertion or self-correction word** -> **a colored highlight overlay appears in the main analyzed-words section** spanning the neighboring words where the speech event was temporally located, plus an enhanced tooltip showing timestamp, model source, and context.

### Concrete Example (from test `orf-debug-2026-02-10T16-45-33.json`)

Alignment:
```
giving  those  who  [are]  observe/serve  him  a  pronounced/pro  [gous]  feeling  of  [the]  the  utmost  respect.
                     ^^^                                           ^^^^              ^^^
                  insertion                                     insertion     near-miss self-correction
```

- **"gous"** (insertion, 6.67s-7.13s): clicking it highlights "pro" through "feeling" in the main word view with a blue outline/glow
- **"the"** (near-miss self-correction, 8.51s-8.61s): clicking it highlights "of" through "the" (the correct one) with a purple outline/glow
- **"are"** (insertion, 2.43s-2.53s): clicking it highlights "who" through "serve" with a blue outline/glow

---

## Three Clickable Categories

Research revealed three distinct data types that need highlight behavior, each with different data characteristics:

### Category 1: Regular Insertions
- **Source:** Alignment entries with `type: 'insertion'`, `_isSelfCorrection: false`, `_partOfStruggle: false`
- **UI location:** "Inserted words (not in passage):" section
- **Timestamps:** Available via `sttLookup` (already consumed at ui.js ~line 1070)
- **Already clickable:** Yes, has click-to-play audio
- **Work needed:** Add highlight-on-click behavior to existing click handler

### Category 2: Near-Miss Self-Corrections
- **Source:** Alignment entries where `_isSelfCorrection === true`
- **UI location:** "Near-miss self-corrections (not counted as errors):" section
- **Timestamps:** Available in alignment data but **NOT currently looked up** from sttLookup
- **Already clickable:** No (just static text today)
- **Work needed:** Add sttLookup consumption + click handler + highlight behavior

### Category 3: Self-Corrections (Repeated Words)
- **Source:** `diagnostics.selfCorrections` array (from `detectSelfCorrections()`)
- **UI location:** "Self-corrections (not counted as errors):" section
- **Timestamps:** **NOT available** - only has `startIndex` (hypothesis word index)
- **Already clickable:** No (just static text today)
- **Work needed:** Map `startIndex` -> `transcriptWords[startIndex]` -> timestamps, then add click handler + highlight behavior

---

## Implementation Design

### 1. Store timestamp anchors on rendered alignment spans

Currently the main alignment word `<span>` elements carry `data-tooltip` but no structured timestamp attributes. Add `data-start-time` and `data-end-time` using `parseSttTime()` for consistent formatting:

```js
// In the main alignment rendering loop (ui.js ~line 858, after sttWord is resolved)
if (sttWord) {
  span.dataset.startTime = parseSttTime(sttWord.startTime).toFixed(3);
  span.dataset.endTime = parseSttTime(sttWord.endTime).toFixed(3);
}
```

**Note:** Omission spans (`item.type === 'omission'`) have no `sttWord` and will NOT get these attributes. This is correct — omissions weren't spoken, so they have no temporal position. The `querySelectorAll('[data-start-time]')` selector naturally excludes them. Pause indicator spans (`<span class="pause-indicator">`) also lack these attributes and are likewise excluded.

### 2. Make all three categories clickable with timestamps

**Category 1 (Regular Insertions):** Already has `meta` from sttLookup. Store timestamps on the insertion span:
```js
// ui.js ~line 1085, after meta is resolved via queue.shift()
if (meta) {
  span.dataset.startTime = parseSttTime(meta.startTime).toFixed(3);
  span.dataset.endTime = parseSttTime(meta.endTime).toFixed(3);
}
```

**Category 2 (Near-Miss Self-Corrections):** Currently rendered at ui.js ~1191-1198 with NO sttLookup. Add lookup:
```js
// ui.js ~line 1191, inside the nearMissSC loop
let scMeta = null;
if (sc.hyp && sttLookup) {
  const queue = sttLookup.get(sc.hyp);
  if (queue && queue.length > 0) {
    scMeta = queue.shift();
  }
}
if (scMeta) {
  span.dataset.startTime = parseSttTime(scMeta.startTime).toFixed(3);
  span.dataset.endTime = parseSttTime(scMeta.endTime).toFixed(3);
  // Enable click-to-play + highlight
  span.classList.add('word-clickable');
}
```

**Important sttLookup note:** Near-miss self-corrections are filtered OUT of `regularInsertions` (ui.js line 1054: `if (ins._isSelfCorrection) return false`), so their sttLookup entries are **never consumed** by regular insertion rendering. They remain in the queue and are safely available here.

**sttLookup key compatibility:** The lookup uses `sc.hyp` directly (e.g., `sttLookup.get(sc.hyp)`). This works because sttLookup is keyed by `w.word.toLowerCase().replace(...)` (normalized form — see app.js line 689), and `sc.hyp` comes from the alignment pipeline which already lowercases and normalizes words during the NW alignment step. Both sides produce the same normalized form.

**Category 3 (Self-Corrections / Repeated Words):** These have `sc.startIndex` (hyp word index) but no timestamps. Map through `transcriptWords` (parameter 6 of `displayAlignmentResults`, confirmed passed from app.js line ~1427):
```js
// ui.js ~line 1170, inside the selfCorrections loop
// transcriptWords is the 6th parameter of displayAlignmentResults()
const scWord = transcriptWords?.[sc.startIndex];
if (scWord) {
  span.dataset.startTime = parseSttTime(scWord.startTime).toFixed(3);
  span.dataset.endTime = parseSttTime(scWord.endTime).toFixed(3);
  span.classList.add('word-clickable');
}
```

### 3. Highlight overlay mechanism — CSS class toggle (no background override)

**Critical refinement from vetting:** The original proposal used `background: rgba(...) !important` which would **destroy the existing word-type color coding** (green for correct, orange for substitution, etc.). The highlight must NOT override backgrounds.

**Use outline + box-shadow only:**

```css
/* Blue glow for insertion highlights */
.word-highlight-insertion {
  box-shadow: 0 0 0 3px rgba(21, 101, 192, 0.4);
  outline: 2px solid #1565c0;
  outline-offset: 2px;
  /* NO background — preserves word-correct green, word-substitution orange, etc. */
}

/* Purple glow for self-correction highlights */
.word-highlight-self-correction {
  box-shadow: 0 0 0 3px rgba(106, 27, 154, 0.3);
  outline: 2px solid #6a1b9a;
  outline-offset: 2px;
  /* NO background — preserves existing type colors */
}

/* Smooth transition for highlight appearance */
.word[data-start-time] {
  transition: box-shadow 0.2s ease, outline 0.2s ease;
}
```

**CSS compatibility with existing overlays:**
- `.word-hesitation` (border-left: 3px solid orange) — compatible, different property
- `.word-morphological` (wavy underline) — compatible, different property
- `.word-disfluency` (`::before` dot) — compatible, pseudo-element independent
- `.word-recovered-badge` (`::after` warning) — compatible, pseudo-element independent
- `.word-forgiven` (dashed 2px border + `::after` checkmark) — **mild visual overlap** with outline; acceptable since both borders convey useful info
- `.word-struggle` (gradient background + dotted border) — compatible since we don't touch background

### 4. Highlight lifecycle — integrated with tooltip system

**Critical refinement from vetting:** Highlights must be coupled to the tooltip lifecycle, not managed independently. Otherwise highlights can become orphaned when tooltips are dismissed.

Track highlighted spans alongside the tooltip:

```js
// At the top of ui.js, alongside existing tooltip state
let _highlightedSpans = [];

function clearHighlightOverlay() {
  for (const s of _highlightedSpans) {
    s.classList.remove('word-highlight-insertion', 'word-highlight-self-correction');
  }
  _highlightedSpans = [];
}

// Modify hideWordTooltip() to also clear highlights
function hideWordTooltip() {
  if (_tooltipEl) { _tooltipEl.remove(); _tooltipEl = null; }
  if (_tooltipOwner) { _tooltipOwner.classList.remove('word-active-tooltip'); _tooltipOwner = null; }
  clearHighlightOverlay();  // <-- ADD THIS
}
```

This means:
- Clicking a main alignment word → hides tooltip → clears highlight
- Clicking away → global dismiss → hides tooltip → clears highlight
- Clicking another insertion → hides old tooltip → clears old highlight → shows new

### 5. Scroll behavior — conditional, not forced

**Critical refinement from vetting:** Calling `scrollIntoView()` unconditionally would scroll the clicked insertion span OUT of view (since it's below the highlighted region). Only scroll if the highlight target is off-screen. Check both ends of the highlighted range, since a long range could have its first span visible but the bulk off-screen:

```js
function scrollToHighlightIfNeeded(firstSpan, lastSpan) {
  // Check if either end of the highlighted range is off-screen
  const first = firstSpan || lastSpan;
  const last = lastSpan || firstSpan;
  const firstRect = first.getBoundingClientRect();
  const lastRect = last.getBoundingClientRect();
  const firstVisible = firstRect.top >= 0 && firstRect.bottom <= window.innerHeight;
  const lastVisible = lastRect.top >= 0 && lastRect.bottom <= window.innerHeight;
  if (!firstVisible || !lastVisible) {
    // Scroll to whichever end is off-screen, preferring the start
    const target = !firstVisible ? first : last;
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}
```

### 6. Anchor-finding algorithm — midpoint-based

**Design rationale:** The original tolerance-based approach (`spanEnd <= startTime + TOLERANCE`) expands the search window *inward* toward the insertion. With overlapping CTC timestamps (common: a word ending at 7.0s while the insertion starts at 6.67s), this can cause `prevSpan` and `nextSpan` to collapse to the same word, or even select the wrong word as "next".

**Solution: use temporal midpoints.** Each span's midpoint (`(start + end) / 2`) is a single well-ordered value that avoids the overlap ambiguity entirely. No tolerance constant needed.

- `prevSpan`: last alignment word whose midpoint is at or before the insertion's midpoint
- `nextSpan`: first alignment word whose midpoint is after the insertion's midpoint
- Every span is classified into exactly one category (`<=` vs `>`), so there are no gaps or overlaps in classification

```js
function findBracketingSpans(wordsDiv, startTime, endTime) {
  // Guard: skip if no valid timestamps
  if (startTime === 0 && endTime === 0) return { prevSpan: null, nextSpan: null };

  const allSpans = [...wordsDiv.querySelectorAll('[data-start-time]')];
  const insMid = (startTime + endTime) / 2;
  let prevSpan = null;
  let nextSpan = null;

  for (const span of allSpans) {
    const spanStart = parseFloat(span.dataset.startTime) || 0;
    const spanEnd = parseFloat(span.dataset.endTime) || 0;
    const spanMid = (spanStart + spanEnd) / 2;

    if (spanMid <= insMid) {
      prevSpan = span;   // keeps updating → last span before insertion
    } else if (!nextSpan) {
      nextSpan = span;   // first span after insertion → stop looking
    }
  }

  return { prevSpan, nextSpan };
}

function highlightSpanRange(wordsDiv, prevSpan, nextSpan, highlightClass) {
  const allSpans = [...wordsDiv.querySelectorAll('[data-start-time]')];
  const startIdx = prevSpan ? allSpans.indexOf(prevSpan) : 0;
  const endIdx = nextSpan ? allSpans.indexOf(nextSpan) : allSpans.length - 1;

  for (let i = startIdx; i <= endIdx; i++) {
    allSpans[i].classList.add(highlightClass);
    _highlightedSpans.push(allSpans[i]);
  }

  return { firstSpan: allSpans[startIdx], lastSpan: allSpans[endIdx] };
}
```

### 7. Click handler for insertion highlight

```js
// In the insertion rendering loop (ui.js ~line 1090-1140)
// Replace existing click handler with enhanced version:
span.addEventListener('click', (e) => {
  e.stopPropagation();

  // 1. Show tooltip (with play button if available)
  showWordTooltip(span, playFn || null);

  // 2. Apply highlight overlay
  const start = parseFloat(span.dataset.startTime) || 0;
  const end = parseFloat(span.dataset.endTime) || 0;
  if (start > 0 || end > 0) {
    const wordsDiv = document.getElementById('resultWords');
    const { prevSpan, nextSpan } = findBracketingSpans(wordsDiv, start, end);
    if (prevSpan || nextSpan) {
      const { firstSpan, lastSpan } = highlightSpanRange(wordsDiv, prevSpan, nextSpan, 'word-highlight-insertion');
      scrollToHighlightIfNeeded(firstSpan, lastSpan);
    }
  }
});
```

Same pattern for near-miss self-corrections (using `'word-highlight-self-correction'`) and repeated-word self-corrections.

### 8. Enhanced tooltip for insertion clicks

Currently insertion tooltips show minimal info:
```
gous
6.67s - 7.13s  |  disagreed
```

Enhance to show:
```
Inserted word: "gous"
6.67s - 7.13s (460ms)
Located between: "pro" -> [gous] -> "feeling"
Cross-validation: disagreed
Reverb (verbatim): "gous" 6.67s-7.13s
Parakeet: "pronounced" 6.48s-7.60s
```

For near-miss self-corrections:
```
Near-miss self-correction: "the" -> "the"
8.51s - 8.61s (100ms)
Located between: "of" -> [the] -> "the"
Student said "the" twice; second matched reference
```

The "Located between" line uses the `_prevRef` already stored on insertions plus the next alignment word. For near-miss self-corrections, use `_nearMissTarget` as the next word.

### 9. Data requirements (revised)

| Data | Source | Available? | Notes |
|------|--------|-----------|-------|
| Regular insertion timestamps | `sttLookup` via `meta.startTime/endTime` | Yes | Already consumed at ui.js ~1070 |
| Near-miss SC timestamps | `sttLookup` via `sc.hyp` key | Yes, but not consumed | Must add lookup step (entries never consumed today) |
| Repeated-word SC timestamps | `transcriptWords[sc.startIndex]` | Yes | Map through startIndex |
| Alignment word timestamps | `sttWord.startTime/endTime` | Yes (except omissions) | Omissions have no sttWord — correct to skip |
| Cross-validation status | `meta.crossValidation` | Yes | |
| Model identity | `sttWord._xvalEngine` | Yes | |
| Reverb timestamps | `sttWord._reverbStartTime/EndTime` | Yes | For enhanced tooltip |
| Previous ref word | `item._prevRef` | Yes | Already set during alignment loop |
| Near-miss target | `_nearMissTarget` | Yes | Set by `resolveNearMissClusters()` |

### 10. Files to modify

1. **`js/ui.js`** — Main changes:
   - Add `data-start-time`, `data-end-time` to main alignment span rendering (~line 858)
   - Add `data-start-time`, `data-end-time` to insertion span rendering (~line 1085)
   - Add sttLookup consumption + timestamps to near-miss self-correction rendering (~line 1191)
   - Add `transcriptWords[startIndex]` timestamp mapping to repeated-word self-correction rendering (~line 1170)
   - Add `clearHighlightOverlay()`, `findBracketingSpans()`, `highlightSpanRange()`, `scrollToHighlightIfNeeded()` helpers
   - Modify `hideWordTooltip()` to call `clearHighlightOverlay()`
   - Enhance insertion/SC click handlers to call highlight functions
   - Enhance tooltip content for all three categories

2. **`style.css`** — Add highlight overlay CSS classes:
   - `.word-highlight-insertion` (outline + box-shadow, no background)
   - `.word-highlight-self-correction` (outline + box-shadow, no background)
   - Transition on `.word[data-start-time]` for smooth highlight appearance

3. **`index.html`** — Version bump only

### 11. Edge cases (expanded)

| Edge Case | Behavior | Notes |
|-----------|----------|-------|
| Insertion at passage start | Highlight from first span to next anchor | `prevSpan = null` -> `startIdx = 0` |
| Insertion at passage end | Highlight from previous anchor to last span | `nextSpan = null` -> `endIdx = last` |
| Multiple insertions between same pair | Same region highlighted for each click | Correct behavior |
| Omitted words in bracket range | Skipped (no `data-start-time`) | Correct — omissions weren't spoken |
| Null/zero timestamps on insertion | Skip highlight entirely | Guard: `if (start === 0 && end === 0) return` |
| sttLookup miss (queue exhausted) | No highlight, tooltip-only | Graceful degradation |
| Insertion temporally within a single word | That word's midpoint < insertion midpoint → becomes prevSpan; next word becomes nextSpan | Midpoint comparison handles naturally |
| Compound words | Synthetic sttLookup entries have merged timestamps | Verified in app.js ~line 742 |
| `.word-forgiven` with highlight | Mild visual overlap of dashed border + outline | Acceptable — both convey info |

### 12. Visual mockup (ASCII)

**Before click:**
```
Analyzed words:
  giving  those  who  observe/serve  him  a  pronounced/pro  feeling  of  the  utmost  respect.

Inserted words (not in passage):  are  gous
Near-miss self-corrections:       "the" -> "the"
```

**After clicking "gous":**
```
Analyzed words:
                                             |=================|
  giving  those  who  observe/serve  him  a  |pronounced/pro|  |feeling|  of  the  utmost  respect.
                                             |=================|
                                             blue outline + glow region
                                             (original colors preserved inside)

Inserted words (not in passage):  are  >>gous<<  <- active tooltip with enhanced info
Near-miss self-corrections:       "the" -> "the"
```

The `|===|` represents the blue outline + box-shadow glow that groups the region. The original green (correct) and orange (substitution) backgrounds remain visible inside the glow.

### 13. Non-goals (out of scope)

- Inline rendering of insertions within the main word flow (would require major layout rework)
- Audio waveform visualization of the highlighted region
- Connecting lines or arrows between the insertion and its highlighted region
- Highlight for `_partOfStruggle` fragments (they aren't rendered in a separate section today — they're referenced in struggle tooltips only)

### 14. Assumptions

- **Linear reading order:** The anchor-finding algorithm assumes the student reads the passage in order. If a student skips ahead and re-reads, DOM order (reference order) may not match temporal order. This is acceptable for ORF assessments where passages are read sequentially.
- **Consistent timestamp source:** All timestamps stored on spans come from `parseSttTime(sttWord.startTime)`, which is the primary source (Parakeet when available, Reverb fallback). Insertion timestamps also come from the same source via sttLookup. The midpoint-based anchor-finding algorithm is robust to minor timestamp overlaps between adjacent words (common with CTC alignment boundaries) without requiring a magic tolerance constant.
- **sttLookup key format:** The lookup map is keyed by `w.word.toLowerCase().replace(...)` (normalized form, NOT `getCanonical()` — see app.js line 689). Alignment `hyp` values pass through the same normalization during the NW alignment step, so `sttLookup.get(sc.hyp)` works correctly for all three categories.
