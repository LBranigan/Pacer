# Word Speed Map — Implementation Plan (v2)

**Date:** 2026-02-06
**Depends on:** Prosody Metrics Plan v6, specifically Metric 4 (`computeWordDurationOutliers()`).
**Goal:** A color-coded passage overlay showing per-word reading speed relative to the student's own pace, in its own collapsible section (like Confidence View). Each word is colored by how long the student took to read it compared to their own median.

**v2 changes:** Renamed from "Automaticity Map" — the feature measures *relative word speed for this student*, not automaticity in the cognitive/psycholinguistic sense. All labels, tiers, CSS classes, and function names updated to reflect what is actually being measured. Monosyllabic words get a visually distinct tier. Omission matching fully specified. Dev mode change removed (separate commit). Tooltips show all data for debugging.

---

## Prerequisite: Commit syllable-counter.js

`js/syllable-counter.js` is currently **untracked** in git. It's actively imported by Metric 4 (`diagnostics.js` line 4) and working correctly — 719 lines, 408-word exception dictionary, ~95% accuracy on grade 1-8 vocabulary. No bugs found; it simply needs to be committed before this plan is built. This should be its own commit.

---

## Relationship to Prosody Plan v6

Metric 4 of the prosody plan already computes everything the word speed map needs. There is no shared helper to extract — Metric 4's output IS the input.

### What Metric 4 provides

Metric 4 (`computeWordDurationOutliers()`) returns:
- **`allWords[]`** — every analyzed word with `{ hypIndex, word, durationMs, syllables, normalizedDurationMs }` (ms per syllable, using Deepgram timestamps)
- **`baseline`** — `{ medianDurationPerSyllable, Q1, Q3, IQR, effectiveIQR, upperFence }`
- **`outliers[]`** — words above the IQR fence (the "practice these words" list for the prosody section)

### What the word speed map adds

One thin function that takes Metric 4's output and classifies every word in `allWords[]` into a visual tier for the heat map. That's it.

```
computeWordDurationOutliers()          -> { allWords[], baseline, outliers[] }
                                                |
                                                v
computeWordSpeedTiers(wordOutliers, alignment)  -> { words[] with tier, distribution, atPacePercent }
```

### Key design decisions inherited from prosody v6

| Decision | Prosody v6 | Word speed map inherits |
|----------|-----------|----------------------|
| Timestamps | Deepgram only (`_xvalStartTime`/`_xvalEndTime`) | Same — no Reverb BPE artifacts |
| Normalization | Syllables (via `syllable-counter.js`) | Same — ms/syllable, not ms/char |
| Baseline | Median of ms/syllable values | Same |
| Words without Deepgram timestamps | Skipped entirely | No tier — show as neutral grey in UI |
| Monosyllabic words | In baseline, not flagged as outliers | Own distinct tier (`short-word`) — not mixed with measured tiers |
| Skip conditions | Disfluencies, self-corrections, struggle parts | Same |

---

## Part 1: Per-Word Speed Tier Classification

### What it computes

Takes `wordOutliers` (Metric 4's full output) and `alignment` (to identify omissions), and classifies every reference word into a visual tier based on how long the student took to read it compared to their own median speed.

### How tiers work

Each word gets a **ratio**: its ms/syllable divided by the student's median ms/syllable. A ratio of 1.0 means "exactly this student's average speed." Below 1.0 = faster. Above 1.0 = slower.

The ratio maps to a tier:

| Ratio | Tier | Color | Label | What it means |
|-------|------|-------|-------|--------------|
| < 0.75 | `quick` | dark green | "Quick" | Read notably faster than their own average |
| 0.75 - 1.25 | `steady` | light green | "Steady" | Near the student's typical pace |
| 1.25 - 1.75 | `slow` | yellow | "Slow" | Noticeably slower than average |
| 1.75 - 2.50 | `struggling` | orange | "Struggling" | Significantly slower — clear difficulty |
| >= 2.50 | `stalled` | red | "Stalled" | Extreme outlier — major slowdown on this word |
| (1 syllable) | `short-word` | faint blue-grey | "1-syl word" | Monosyllabic — timing unreliable per-syllable |
| (omitted) | `omitted` | grey + strikethrough | "Omitted" | Student skipped this word entirely |
| (no timestamps) | `no-data` | neutral grey | "No data" | No Deepgram timing available |

### Why tier names say what they measure

The old plan used "automatic" / "fluent" / "hesitant" / "labored" / "blocked" — terms that imply cognitive states we aren't measuring. What we actually have is: *relative word duration compared to this student's median*. The new tier names describe the observable behavior:
- "Quick" — read faster than their own average (observable)
- "Steady" — at their own typical pace (observable)
- "Slow" / "Struggling" / "Stalled" — progressively slower than their own average (observable)

### Monosyllabic words: distinct tier, not hidden

**Problem:** Per-syllable normalization is unreliable for single-syllable words, so we can't meaningfully classify them. The old plan forced them to 'fluent' (light green), making them visually identical to genuinely measured fluent words. This is dishonest — ~40-50% of the passage would be green for the wrong reason.

**Solution:** Monosyllabic words get their own `short-word` tier with a distinct visual treatment:
- **Background:** very faint blue-grey (`#eceff1`) — clearly different from the green/yellow/orange/red spectrum
- **Text color:** medium grey (`#78909c`)
- **No border or underline** — stays subtle, doesn't draw the eye
- **Tooltip explains:** "1-syllable word — per-syllable timing unreliable, not classified"

This way a teacher can instantly distinguish "green because we measured it" from "grey-blue because we couldn't measure it." The signal words (multisyllabic content words) pop out clearly against the neutral monosyllabic backdrop.

### Why these thresholds are student-relative

The ratio is always against THIS student's OWN median. A word at 2.5x is "stalled" regardless of whether the student's baseline is fast (100ms/syl) or slow (300ms/syl). This answers the right question: "which words were hard FOR THIS STUDENT in THIS reading?"

**Caveat:** The thresholds (0.75, 1.25, 1.75, 2.50) are reasonable but unvalidated. After implementation, eyeball real readings and tune if colors don't match teacher intuition. In particular, the `quick` tier (< 0.75x) may be too generous for struggling readers whose median is already high — watch for this and consider tightening or collapsing to 4 tiers if `quick` doesn't carry useful signal.

### Algorithm

```
Input: wordOutliers (from computeWordDurationOutliers), alignment[]
Output: { words[], baseline, distribution, atPacePercent }

1. If wordOutliers.insufficient === true:
     return { insufficient: true }

2. medianMs = wordOutliers.baseline.medianDurationPerSyllable

3. Build hypIndex → allWords lookup:
     allWordsMap = new Map()
     for each word in wordOutliers.allWords:
       allWordsMap.set(word.hypIndex, word)

4. Walk alignment[], tracking hypIndex and refIndex:
     hypIndex = 0, refIndex = 0, words = []

     for each entry in alignment:
       if entry.type === 'insertion':
         // Insertions: not in reference passage, skip for map
         // Advance hypIndex but not refIndex
         hypIndex += (entry.compound ? entry.parts.length : 1)
         continue

       if entry.type === 'omission' || entry.type === 'deletion':
         // Omission: in reference but not spoken — no hypIndex advance
         words.push({
           refIndex, refWord: entry.ref, tier: 'omitted',
           hypIndex: null, durationMs: null, syllables: null,
           normalizedMs: null, ratio: null, alignmentType: 'omission',
           isOutlier: false
         })
         refIndex++
         continue

       // Correct, substitution, struggle — has a spoken word
       partsCount = entry.compound && entry.parts ? entry.parts.length : 1
       autoWord = allWordsMap.get(hypIndex)

       if autoWord AND autoWord.normalizedDurationMs != null:
         ratio = autoWord.normalizedDurationMs / medianMs

         if autoWord.syllables < 2:
           tier = 'short-word'
         else if ratio < 0.75:   tier = 'quick'
         else if ratio < 1.25:   tier = 'steady'
         else if ratio < 1.75:   tier = 'slow'
         else if ratio < 2.50:   tier = 'struggling'
         else:                   tier = 'stalled'

         words.push({
           refIndex, refWord: entry.ref,
           hypIndex, word: autoWord.word,
           durationMs: autoWord.durationMs,
           syllables: autoWord.syllables,
           normalizedMs: autoWord.normalizedDurationMs,
           ratio, tier,
           alignmentType: entry.type,
           isOutlier: autoWord.isOutlier || false,
           // Debug fields:
           _upperFence: wordOutliers.baseline.upperFence,
           _medianMs: medianMs
         })
       else:
         // No Deepgram timestamps for this word
         words.push({
           refIndex, refWord: entry.ref,
           hypIndex, word: entry.hyp,
           durationMs: null, syllables: null,
           normalizedMs: null, ratio: null,
           tier: 'no-data', alignmentType: entry.type,
           isOutlier: false
         })

       hypIndex += partsCount
       refIndex++

5. Count distribution per tier.
   atPacePercent = (quick + steady) / (total - omitted - noData - shortWord) * 100
   // Denominator is only words we could actually classify
```

### Why atPacePercent excludes monosyllabic and no-data words

`atPacePercent` answers: "Of the words we could meaningfully measure, what fraction did the student read at or above their typical pace?" Including monosyllabic words (which we *can't* classify) or no-data words would inflate the denominator and dilute the signal. Omitted words are excluded for the same reason — they weren't read, so they have no speed.

### Data structure

```javascript
// Returned by computeWordSpeedTiers(wordOutliers, alignment)
{
  words: [
    {
      refIndex: 0,
      refWord: "The",
      hypIndex: 0,
      word: "the",
      durationMs: 180,
      syllables: 1,
      normalizedMs: 180,            // ms per syllable
      ratio: null,                  // not computed for monosyllabic
      tier: 'short-word',           // quick|steady|slow|struggling|stalled|short-word|omitted|no-data
      alignmentType: 'correct',
      isOutlier: false,
      _upperFence: 485,             // debug: IQR upper fence from Metric 4
      _medianMs: 215                // debug: student's median ms/syl
    },
    {
      refIndex: 3,
      refWord: "catastrophe",
      hypIndex: 3,
      word: "catastofee",
      durationMs: 1850,
      syllables: 4,
      normalizedMs: 462,
      ratio: 2.15,
      tier: 'struggling',
      alignmentType: 'substitution',
      isOutlier: true,
      _upperFence: 485,
      _medianMs: 215
    },
    // ... one entry per reference word in passage
  ],
  baseline: {
    medianMs: 215,                  // ms per syllable (from Metric 4)
    totalWords: 142,
    upperFence: 485                 // IQR fence (from Metric 4)
  },
  distribution: {
    quick: 12,
    steady: 48,
    slow: 15,
    struggling: 7,
    stalled: 3,
    'short-word': 55,
    omitted: 2,
    'no-data': 0
  },
  atPacePercent: 70.6               // (quick + steady) / (quick+steady+slow+struggling+stalled) * 100
}
```

### Where it lives

New function `computeWordSpeedTiers(wordOutliers, alignment)` in diagnostics.js. ~50 lines — alignment walk + tier classification on top of Metric 4's data.

---

## Part 2: Word Speed Map Section (Collapsible)

### Design

A new collapsible section in the results area, positioned below Confidence View. Follows the same visual pattern as the existing Confidence View and Disfluency sections: collapsed by default, click header to expand, contains a color-coded passage rendering.

### Section layout in index.html

```
#resultWords          (existing miscue/alignment view — UNCHANGED)

Confidence View       (existing collapsible section)
Disfluency            (existing collapsible section)
Prosody               (from prosody plan)
Word Speed Map        (NEW — this plan)

Metrics               (existing result boxes)
```

The miscue alignment view (`#resultWords`) is completely untouched. The word speed map lives in its own section.

### HTML structure

```html
<!-- Word Speed Map (collapsed by default) -->
<div class="word-speed-section" id="wordSpeedSection" style="display:none;">
  <div class="word-speed-header" onclick="document.getElementById('wordSpeedSection').classList.toggle('expanded')">
    <h4>Word Speed Map</h4>
    <span class="word-speed-summary-inline" id="wordSpeedSummaryInline"></span>
    <span class="word-speed-toggle">&#9660;</span>
  </div>
  <div class="word-speed-body">
    <div class="word-speed-legend" id="wordSpeedLegend"></div>
    <div class="word-speed-words" id="wordSpeedWords"></div>
    <div class="word-speed-summary" id="wordSpeedSummary"></div>
  </div>
</div>
```

Placed in index.html after the prosody container (`#prosodyContainer`), before the Metrics label. Hidden by default (`style="display:none;"`), shown by ui.js when word speed data is available.

### Collapsed header

Shows a one-line summary:

```
> Word Speed Map — 71% at pace | 15 slow | 7 struggling | 3 stalled
```

"At pace" = quick + steady as a percentage of classifiable words (excludes monosyllabic, omitted, no-data from denominator).

### Expanded body

**Legend row:**
```
[Quick] [Steady] [Slow] [Struggling] [Stalled] [1-syl word] [Omitted] [No data]
```
Each label colored with its tier background.

**Passage text:**
The full passage rendered with each word colored by its tier. Omitted words shown greyed out with strikethrough. Words without Deepgram timestamps shown in neutral grey. Monosyllabic words shown in faint blue-grey.

**Summary bar (below passage):**
```
+-------------------------------------------------------------------+
|  71% at pace | 15 slow | 7 struggling | 3 stalled                 |
|  ████████████████░░░░░░  85 classifiable words (55 short, 2 omit) |
|  Student baseline: 215 ms/syllable                                |
+-------------------------------------------------------------------+
```

Horizontal stacked bar showing tier distribution (only the 5 classifiable tiers). Text summary with counts, short-word/omitted counts in parenthetical, and baseline.

### Passage rendering

Walks the `words[]` array from `computeWordSpeedTiers()` output (which already walked alignment):
- Each entry has `refWord` and `tier` — render `refWord` with the tier's CSS class
- Insertions were already excluded during the alignment walk (not in `words[]`)
- Shows reference word text (not hypothesis text)
- Omitted words: greyed out with strikethrough
- No-data words: neutral grey
- Monosyllabic words: faint blue-grey

### Tooltips — show everything for debugging

Separate `buildWordSpeedTooltip(wordData)` function. Tooltips are the debug surface — show all available data.

**Multisyllabic word tooltip (the full-data case):**
```
"catastrophe" (ref) → "catastofee" (heard)
Type: substitution
Duration: 1850ms | 4 syllables | 462 ms/syl
Ratio: 2.15x student median (215 ms/syl)
Tier: struggling (1.75x - 2.50x range)
IQR outlier: yes (fence: 485 ms/syl)
```

**Monosyllabic word tooltip:**
```
"the" (ref) → "the" (heard)
Type: correct
Duration: 180ms | 1 syllable | 180 ms/syl
Tier: short-word — single-syllable, timing not classified
Student median: 215 ms/syl
```

**Omitted word tooltip:**
```
"catastrophe"
Omitted — student did not read this word
```

**No-data word tooltip:**
```
"catastrophe" (ref) → "catastofee" (heard)
Type: substitution
No Deepgram timing data — word not classified
```

### What the word speed section does NOT show

- No hesitation indicators
- No long pause brackets
- No disfluency badges
- No morphological squiggles
- No NL tier coloring

Deliberately clean: just the passage text, colored by relative speed. One signal, no noise.

### CSS

```css
/* ───────────────────────────────────────────────────────────────────────────
   Word Speed Map section — clones Confidence View pattern
   ─────────────────────────────────────────────────────────────────────────── */
.word-speed-section {
  margin-top: 1rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  overflow: hidden;
}

.word-speed-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  background: #f5f5f5;
  user-select: none;
}

.word-speed-header:hover { background: #eee; }

.word-speed-header h4 {
  font-size: 0.9rem;
  font-weight: 600;
  color: #555;
  margin: 0;
}

.word-speed-summary-inline {
  font-size: 0.8rem;
  color: #888;
  flex: 1;
  margin-left: 0.75rem;
}

.word-speed-toggle {
  font-size: 0.7rem;
  color: #999;
  transition: transform 0.2s;
}

.word-speed-section.expanded .word-speed-toggle {
  transform: rotate(180deg);
}

.word-speed-body {
  display: none;
  padding: 0.75rem;
  background: #fafafa;
}

.word-speed-section.expanded .word-speed-body {
  display: block;
}

/* Legend */
.word-speed-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  font-size: 0.8rem;
}

.word-speed-legend span {
  padding: 2px 6px;
  border-radius: 3px;
}

/* Word line height for passage readability */
.word-speed-words { line-height: 2; }

/* Tier colors — names describe observable behavior, not cognitive states */
.ws-quick       { background: #c8e6c9; color: #1b5e20; border-radius: 2px; padding: 1px 2px; }
.ws-steady      { background: #e8f5e9; color: #2e7d32; border-radius: 2px; padding: 1px 2px; }
.ws-slow        { background: #fff9c4; color: #f57f17; border-radius: 2px; padding: 1px 2px; }
.ws-struggling  { background: #ffe0b2; color: #e65100; border-radius: 2px; padding: 1px 2px; }
.ws-stalled     { background: #ffcdd2; color: #b71c1c; border-radius: 2px; padding: 1px 2px; }
.ws-short-word  { background: #eceff1; color: #78909c; border-radius: 2px; padding: 1px 2px; }
.ws-omitted     { background: #e0e0e0; color: #9e9e9e; border-radius: 2px; padding: 1px 2px;
                  text-decoration: line-through; }
.ws-no-data     { background: #f5f5f5; color: #bdbdbd; border-radius: 2px; padding: 1px 2px; }

/* Summary bar */
.word-speed-summary {
  margin-top: 8px;
  padding: 8px;
  background: #fff;
  border: 1px solid #eee;
  border-radius: 4px;
  font-size: 0.85em;
}

.ws-dist-bar {
  height: 8px;
  display: flex;
  border-radius: 4px;
  overflow: hidden;
  margin: 4px 0;
}

.ws-dist-bar .seg-quick       { background: #4caf50; }
.ws-dist-bar .seg-steady      { background: #8bc34a; }
.ws-dist-bar .seg-slow        { background: #ffc107; }
.ws-dist-bar .seg-struggling  { background: #ff9800; }
.ws-dist-bar .seg-stalled     { background: #f44336; }
```

---

## File Changes

### diagnostics.js

**Add:** `computeWordSpeedTiers(wordOutliers, alignment)` — walks alignment, matches to Metric 4's `allWords[]` by `hypIndex`, classifies each reference word into a tier. ~50 lines.

**Export:** Add to the module's exports.

No changes to Metric 4's API. No shared helper needed.

### app.js — Pipeline integration

After Metric 4, one additional call:

```javascript
// Existing prosody pipeline (from prosody plan):
const wordOutliers = computeWordDurationOutliers(transcriptWords, alignment);

// Word speed map (consumes Metric 4's output + alignment):
const wordSpeedTiers = computeWordSpeedTiers(wordOutliers, alignment);

diagnostics.prosody = { phrasing, pauseAtPunctuation, paceConsistency, wordOutliers };
diagnostics.wordSpeed = wordSpeedTiers;
```

### ui.js — Word speed section rendering

**Add:** `renderWordSpeedSection(wordSpeedData)` — populates the collapsible section. Shows section, sets inline summary, renders legend + passage + summary bar. Uses `wordSpeedData.words[]` directly (already walked alignment).

**Add:** `buildWordSpeedTooltip(wordData)` — tooltip showing all debug data for a word.

**Add:** `renderWordSpeedSummary(container, wordSpeedData)` — stacked distribution bar + stats.

**No changes to `displayAlignmentResults()`** — the miscue view is untouched.

### index.html — HTML + CSS

**Add:** Word speed section HTML (after prosody container, before Metrics label).

**Add:** CSS for word speed section, tier colors, legend, summary bar (listed above).

---

## Build Order

**Prerequisite 0:** Commit `js/syllable-counter.js` (separate commit — it's used by Metric 4 but untracked).

**Prerequisite 1:** Prosody plan must be built first (all 4 metrics). The word speed map consumes Metric 4's `allWords[]` and `baseline`.

### Step 1: Word speed scorer (diagnostics.js)
Write `computeWordSpeedTiers(wordOutliers, alignment)`. ~50 lines. Alignment walk + tier classification.

### Step 2: Pipeline wiring (app.js)
Call `computeWordSpeedTiers()` after Metric 4, attach to `diagnostics.wordSpeed`.

### Step 3: Section HTML + CSS (index.html)
Add collapsible section HTML. Add CSS for section + tier colors + summary bar.

### Step 4: Section rendering (ui.js)
Add `renderWordSpeedSection()` to populate the section when data is available. Add tooltip + summary bar rendering.

### Step 5: Version timestamp (index.html)
Update version timestamp.

---

## Design Decisions Log

### Why "Word Speed Map" and not "Automaticity Map"
Automaticity is a cognitive construct (Samuels, 1994; LaBerge & Samuels, 1974) referring to effortless word recognition. We're measuring *relative word duration* — a behavioral proxy, not the construct itself. A word could be slow for reasons unrelated to automaticity (unfamiliar pronunciation, distraction, end-of-breath). Honest naming prevents over-interpretation.

### Why monosyllabic words get their own tier
Per-syllable normalization divides by 1 for monosyllabic words, making the normalized value equal to raw duration. This means "the" at 200ms and "cat" at 200ms look identical, but a 200ms function word is normal while a 200ms content word might be slow. Rather than misclassify these, we visually flag them as "measurement not applicable" with a distinct neutral color.

### Why atPacePercent excludes short-word/omitted/no-data from denominator
The percentage answers: "Of the words we could meaningfully classify, how many were at or above the student's typical pace?" Including unclassifiable words would dilute the signal. A passage with 50% monosyllabic words would always show ~85%+ "at pace" regardless of student performance on the hard words.

### Why tooltips show everything
This is a diagnostic tool, not a consumer product. Teachers and researchers need to understand *why* a word is colored a certain way. The tooltip is the debug surface — it shows raw duration, syllable count, ms/syllable, ratio, tier thresholds, IQR fence status, alignment type, and what was heard vs. what was expected. Hide nothing.

---

## Open Questions / Concerns

### 1. The ratio thresholds are unvalidated
0.75, 1.25, 1.75, 2.50 are intuitive breakpoints. The `quick` tier (< 0.75x median) may be too generous for struggling readers — if the median is already slow, 0.75x might not represent genuine quick recognition. Watch for this after implementation and be ready to tighten or collapse to 4 tiers.

### 2. Words without Deepgram timestamps
These get neutral grey (`ws-no-data`). Usually < 5% of words, but in a noisy recording could be more. If many words are grey the map loses value.

### 3. Compound words during alignment walk
Compound words (e.g., "everyone" = "every" + "one") advance `hypIndex` by `parts.length`. The algorithm handles this, but compound words are also monosyllabic in their merged form — need to check whether Metric 4's `allWords[]` has the compound's syllable count from the merged form or from the parts. If merged "everyone" → 3 syllables, this is correct. If it somehow gets 1, it'll be misclassified as `short-word`.

---

## What This Does NOT Include

- **Dev mode default flip** — separate housekeeping commit, not part of this feature
- **Cross-session word bank** — deferred to a separate plan
- **Click-to-seek audio playback** — current audio-playback.js is play/pause, not click-to-seek
- **Prosody metrics** — computed by the prosody plan; this plan only adds tier classification
- **Progress monitoring** — atPacePercent could be trended over sessions, but that UI is future work
