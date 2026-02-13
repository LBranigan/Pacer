# Legacy Word Miscue UI — ARCHIVED / INACTIVE

> **Status: INACTIVE.** This code has been removed from the PACER codebase. It is preserved here as a reference for future development. Do NOT re-integrate without review.

## What This Was

The original "Analyzed Words" section displayed every word from the alignment as a color-coded span inside a single `#resultWords` div. Each word received a CSS class based on its raw alignment `type` field:

- **Green** (.word-correct) — correct words
- **Orange** (.word-substitution) — substitutions
- **Red strikethrough** (.word-omission) — omissions
- **Blue** (.word-insertion) — insertions
- **Purple** (.word-self-correction) — self-corrections
- **Teal gradient** (.word-struggle) — struggle words

The rendering was a single sequential loop over alignment entries, interspersed with pause indicators, hesitation borders, morphological squiggles, and recovery badges. Tooltips were built per-word via `buildEnhancedTooltip()`.

## Why It Was Replaced

This was replaced by the bucket-based `renderNewAnalyzedWords()` system in ui.js. The legacy approach mapped 1:1 from alignment `type` to display class, which could not represent finer distinctions (e.g., a word that was a struggle but ultimately read correctly vs. a struggle that was abandoned). The bucket system (`classifyWord()`) separates scoring logic (metrics.js, based on `type`) from display logic (ui.js, based on semantic bucket).

---

## Archived Code

### HTML (from index.html lines 143-164)

The legacy analyzed section wrapper with its legend:

```html
<!-- Legacy Analyzed Words (collapsible) -->
<div class="legacy-analyzed-section" id="legacyAnalyzedSection" style="display:none;">
  <div class="legacy-analyzed-header" onclick="document.getElementById('legacyAnalyzedSection').classList.toggle('expanded')">
    <h4>Legacy Analyzed Words</h4>
    <span class="legacy-analyzed-toggle">&#9660;</span>
  </div>
  <div class="legacy-analyzed-body">
    <div class="legend">
      <span class="word-correct">Correct</span>
      <span class="word-substitution">Substitution</span>
      <span class="word-omission">Omission</span>
      <span class="word-insertion">Insertion</span>
      <span class="word-self-correction">Self-corr.</span>
      <span class="word-struggle">Struggle</span>
      <span class="pause-indicator">[pause]</span>
      <span class="word-hesitation">Hesit.</span>
      <span class="word-morphological">Morph.</span>
      <span class="word-forgiven">Forgiven ✓</span>
    </div>
    <div class="result-box" id="resultWords">Awaiting audio...</div>
  </div>
</div>
```

(Note: the full legend spans had extensive title tooltips with detection logic descriptions.)

### CSS (from style.css)

```css
/* Legacy word type classes */
.word-correct { background: #c8e6c9; color: #2e7d32; }
.word-substitution { background: #ffe0b2; color: #e65100; }
.word-omission { background: #ffcdd2; color: #c62828; text-decoration: line-through; }
.word-insertion { background: #bbdefb; color: #1565c0; }
.word-self-correction { background: #e1bee7; color: #6a1b9a; }
.word-struggle {
  background: linear-gradient(135deg, #e0f7fa 0%, #b2ebf2 100%);
  color: #00838f;
  border-bottom: 2px solid #00acc1;
}
.word-hesitation.word-struggle {
  border-left: 3px solid #ff9800;
}

/* Legacy section chrome */
.legacy-analyzed-section { margin-top: 1rem; border: 1px solid #ddd; border-radius: 6px; overflow: hidden; }
.legacy-analyzed-header { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.75rem; background: #f5f5f5; cursor: pointer; user-select: none; }
.legacy-analyzed-header h4 { margin: 0; font-size: 0.9rem; color: #666; }
.legacy-analyzed-toggle { font-size: 0.75rem; color: #999; transition: transform 0.2s; }
.legacy-analyzed-section.expanded .legacy-analyzed-toggle { transform: rotate(180deg); }
.legacy-analyzed-body { display: none; padding: 0.75rem; background: #fafafa; }
.legacy-analyzed-section.expanded .legacy-analyzed-body { display: block; }
```

### JS -- Legacy rendering block (from ui.js, inside displayAlignmentResults())

This was a ~525-line block that:

- Built a `sttToHypIndex` mapping (transcriptWords index to alignment render position)
- Created diagnostic lookup maps (`onsetDelayMap`, `longPauseMap`, `morphErrorMap`)
- Rendered each alignment entry as a colored span (`.word-correct`, `.word-substitution`, etc.)
- Rendered pause indicators `[3.2s]` between words
- Rendered hesitation borders, morphological squiggles, recovery badges
- Rendered "Inserted words" section
- Rendered "Self-corrections" section
- Rendered "Near-miss self-corrections" section
- Used `buildEnhancedTooltip()` for detailed per-word tooltips
- Used `applyHighlightOverlay()` for click-to-highlight in self-correction/insertion sections

The rendering was a single sequential loop over alignment entries, appending spans to the `#resultWords` div. Each word got a CSS class based on its raw `type` field (correct, substitution, omission, struggle). This was replaced by the bucket-based classification in `classifyWord()` which provides finer granularity (e.g., struggle-correct, attempted-struggled, definite-struggle, confirmed-insertion).

### JS -- Helper functions (still defined in ui.js but no longer called)

These functions were used exclusively by the legacy rendering:

- **`buildEnhancedTooltip(item, sttWord, extras)`** -- consolidated tooltip builder for legacy word spans
- **`buildVADTooltipInfo(vadAnalysis)`** -- VAD analysis tooltip fragment
- **`createDisfluencyBadge(word)`** -- Phase 16 disfluency badge DOM element
- **`isSpecialASTToken(word)`** -- checks for `<unknown>` CTC tokens
- **`applyHighlightOverlay(span, highlightClass)`** -- highlights timestamp-bracketed spans in legacy resultWords div

Note: These function definitions remain in ui.js as dead code. They can be removed in a future cleanup.

### What Replaced This

The `renderNewAnalyzedWords()` function (ui.js line 482) with the `classifyWord()` bucket system provides:

- **6 semantic buckets**: correct, struggle-correct, omitted, attempted-struggled, definite-struggle, confirmed-insertion
- Each bucket has its own color, CSS class (`.word-bucket-*`), and detailed legend tooltip
- Insertions, self-corrections, and struggle fragments are grouped inline with their parent word
- The bucket system separates scoring (metrics.js, based on `type`) from display (ui.js, based on bucket)
