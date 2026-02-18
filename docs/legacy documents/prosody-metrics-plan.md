# Prosody Metrics Implementation Plan (v6)

**Date:** 2026-02-06
**Replaces:** v5 plan + current `computeProsodyProxy()` (single ratio metric) in diagnostics.js:455-488
**Goal:** Four high-confidence, low-noise prosody metrics computed entirely from existing ASR timestamps. No new dependencies (except syllable-counter.js, already created). No pitch analysis. No alignment view clutter.

**v6 changes from v5:**
1. Source C uses **IQR-based gap detection** (Tukey's fences on the gap distribution) instead of the 2x median multiplier — statistically grounded, internally consistent with Metric 4's word duration outlier method
2. **Word-by-word reader detection** — `readingPattern` classification in Metric 1 catches uniform pathology that self-norming alone misses
3. **Pace Consistency** added as a new metric — coefficient of variation of local reading rates across phrases (Rasinski MFS Dimension 4)
4. **Dialogue punctuation fix** — `getPunctuationPositions()` strips trailing quotes before checking last character
5. **NaN cascade guards** on all metric functions — `median([])` returns null, division-by-zero returns null with label
6. **IQR floor** (50ms/syl) in Metric 4 prevents degenerate fence on very consistent readers
7. **Coverage denominator** filtered to encountered punctuation only — omitted sentences don't deflate the score
8. **Compound word** internal pauses skipped in Source C
9. **Scope transparency** — visible note in expanded prosody section about what timestamps can/can't measure
10. **`isDisfluency` lookup corrected** — lives on `transcriptWords[hypIndex]`, not alignment entries
11. **Read-only safety** — `median()` copies before sorting; `breakSet` passed defensively
12. Citation and line-number corrections throughout

**Retained from v5:**
1. Metric 4 uses **Deepgram timestamps** (`_xvalStartTime`/`_xvalEndTime`) exclusively — eliminates BPE artifact entirely
2. Metric 4 normalizes by **syllable count** instead of character count (via `syllable-counter.js`)
3. Metric 4 uses **IQR outlier detection** (Tukey's fences) instead of arbitrary multiplier threshold
4. Metric 2 adds **punctuation coverage** as primary metric — passage-density-independent
5. Prosody is **read-only** — never modifies existing diagnostics arrays
6. Final phrase is **always included** — no exclusion rule
7. All metrics return **maximum debug data**

---

## Design Principle: PROSODY IS READ-ONLY

Prosody computation reads from `diagnostics.onsetDelays`, `diagnostics.longPauses`, `transcriptWords`, and `alignment` but **NEVER modifies any of them**. All prosody results go into a separate `diagnostics.prosody` container. If the prosody logic wants to skip certain items (e.g., hesitations with high speechPercent), it does so within its own iteration — the source arrays are untouched.

**Defensive copies:** The `median()` helper sorts a copy (`[...arr].sort(...)`) — never the original array. When `breakSet` is passed from Metric 1 to Metric 2, it is either frozen (`Object.freeze(breakSet)`) or the consumer copies it (`new Set(breakSet)`) to prevent accidental mutation.

This means:
- Existing hesitation counts, long pause counts, UI rendering — all unchanged
- Prosody is purely additive
- Removing prosody would leave the rest of the system identical

---

## What's Being Replaced

Currently the only prosody signal is `diagnostics.prosodyProxy.ratio` — the ratio of average pause at punctuation vs mid-sentence (diagnostics.js:455-488). It displays as a single number (e.g., "1.50") in a metric box labeled "Prosody" (ui.js:414-419). This is a blunt instrument — a single ratio that's hard for teachers to interpret and doesn't map to any clinical framework.

The new system replaces this with four actionable metrics in a **collapsible "Prosody" section** — no changes to the word-by-word alignment view. The alignment view already has enough visual indicators; prosody data lives in its own expandable panel.

---

## Metric 1: Phrasing Quality

### What it measures
How fluently the student reads between natural sentence boundaries, plus an explicit classification of the student's reading pattern (word-by-word, choppy, phrase-level, or connected).

### Why two numbers

A student who reads "The cat sat on the mat. [pause] The dog ran." has one pause — at the period. That's correct prosody. If we count that pause as a phrase break, we get two short phrases (6 and 3 words). But the student is reading perfectly fluently.

By classifying that break as "at-punctuation" and excluding it from the fluency metric, we see one long phrase (9 words). That's the real story: the student reads fluently between sentence boundaries. Whether they honored the period is captured separately by Metric 2.

- **Fluency phrasing (primary):** Words per phrase using only unexpected breaks (hesitations, random mid-sentence pauses). This is what the teacher wants to know — "is this student reading in phrases or word-by-word?"
- **Overall phrasing (secondary):** Words per phrase using all breaks. Context for understanding the student's overall rhythm, including appropriate punctuation pauses.

### Reading pattern classification (word-by-word blind spot fix)

**Problem solved:** Self-norming (IQR-based Source C) cannot detect uniform pathology. A student pausing ~400ms between every word (textbook word-by-word reading, NAEP Level 1) has uniform gaps. The IQR is tiny, so the fence is very high. No gaps exceed it. Sources A/B also miss it (400ms < 500ms threshold). The metric would report one giant phrase — appearing like a fluent reader.

**Research basis:** Schwanenflugel et al. (2004) found struggling readers averaged 688ms for intrasentential pauses vs. 365ms for skilled readers. Goldman-Eisler (1968) established 250ms as the boundary between articulatory and cognitive pauses.

**Solution:** The student's `medianGap` (median of all inter-word gaps) is a first-class diagnostic signal, independent of the IQR-based phrase break detection:

```javascript
readingPattern: {
  medianGap: 0.412,        // student's median inter-word gap (seconds)
  classification: 'word-by-word', // or 'choppy', 'phrase-level', 'connected'
  // Thresholds (derived from Goldman-Eisler 250ms cognitive boundary + Schwanenflugel data):
  // medianGap > 0.350 → 'word-by-word' (uniform large gaps)
  // medianGap > 0.250 → 'choppy' (above cognitive pause threshold)
  // medianGap > 0.150 → 'phrase-level' (normal phrase reading)
  // medianGap <= 0.150 → 'connected' (fluent connected speech)
}
```

Note: These thresholds are derived from research but should be calibrated against teacher assessments. They are approximate indicators of reading continuity, not validated clinical cutoffs.

### Why it's strong
- Reports the actual number — teachers instantly understand "reads about 8 words between unexpected pauses"
- Correct punctuation pauses don't deflate the score — a fluent reader who honors periods isn't penalized
- Reading pattern classification catches the primary pathology (word-by-word reading) that self-norming misses
- No arbitrary categorical levels — the continuous value IS the metric
- Reuses existing pause detection — no new threshold tuning needed for Sources A/B
- Source C is self-normed to each student via IQR — no arbitrary absolute threshold

### Phrase break sources (reusing existing diagnostics)

Instead of re-scanning all inter-word gaps with an arbitrary threshold, phrase breaks come from three sources that already exist or are trivially derived:

**Source A: Hesitations (existing `onsetDelays`)**
These are gaps between 500ms-3s (or 800ms after comma, 1200ms after period). They already:
- Skip unconfirmed words (unreliable Reverb timestamps)
- Have been VAD-enriched (`_vadAnalysis.speechPercent`)
- Have been VAD-overhang-adjusted (some removed when adjusted gap fell below threshold)

Within the prosody computation (not modifying the source array), skip any onsetDelay where `_vadAnalysis.speechPercent >= 80`. These gaps had the student speaking through 80%+ of the duration — they're ASR timestamp artifacts, not real pauses. This skip is tracked in `breakSources.vadFiltered` for debug transparency.

**Source B: Long pauses (existing `longPauses`)**
Gaps >= 3s. Already skip unconfirmed words. Already VAD-enriched. Always real phrase breaks — a 3s+ gap is a real pause regardless.

**Source C: Medium pauses (IQR-based general detector)**

Sources A and B have a blind spot. The hesitation detector uses high thresholds after punctuation (1200ms after periods, 800ms after commas) because pausing at punctuation is expected — it's not a hesitation. That's correct for hesitation detection. But it means pauses between ~200ms and ~1200ms at punctuation, and ~200ms to ~500ms mid-sentence, are invisible to Sources A/B.

These are real, audible pauses. A 400ms gap mid-sentence is a phrase break. A 700ms gap at a period is a phrase break. Source C catches them all.

**Algorithm for Source C (IQR-based):**

1. Collect all inter-word gaps between consecutive confirmed word pairs:
   - Skip pairs where either word has `crossValidation === 'unconfirmed'`
   - Skip negative gaps (overlapping timestamps)
   - Skip positions already captured by Source A or B (known pauses, not baseline)
   - Skip positions in `compoundPositions` (compound-internal gaps — see below)

2. Compute gap distribution statistics (IQR method):
   ```
   Q1_gap = 25th percentile of gaps
   Q3_gap = 75th percentile of gaps
   IQR_gap = Q3_gap - Q1_gap
   effectiveIQR_gap = max(IQR_gap, 0.050)  // 50ms floor prevents degenerate fence
   gapFence = max(Q3_gap + 1.5 * effectiveIQR_gap, 0.200)  // 200ms perceptual floor
   ```

3. For each consecutive confirmed word pair (i, i+1) in transcriptWords:
   - gap = startTime[i+1] - endTime[i]
   - if gap < 0 → skip (overlapping timestamps)
   - if gap < gapFence → skip
   - if i in compoundPositions → skip (compound-internal gap)
   - if i not already in breakSet → add i to breakSet

**No punctuation filter.** A pause is detected wherever it occurs. Whether it's at an appropriate boundary is determined by the break classification step below.

**Why IQR instead of 2x median multiplier:** The 2x median multiplier had no published empirical validation — it was a reasonable heuristic but not grounded in statistics. The IQR method is the standard Tukey's fences approach, the same method used for Metric 4's word duration outliers, providing internal consistency. It accounts for gap *variability*, not just central tendency — a variable reader gets a wider fence (tolerates more variation), while a consistent reader gets a tighter fence (catches smaller deviations).

**Self-norming rationale:**

| Student type | Median gap | Q1/Q3 gap | IQR | Fence = max(Q3 + 1.5*IQR, 200ms) |
|-------------|-----------|-----------|-----|-----------------------------------|
| Fast reader | 60ms | 40/80ms | 40ms | max(80+60, 200) = **200ms** (floor) |
| Typical reader | 120ms | 80/160ms | 80ms | max(160+120, 200) = **280ms** |
| Slow reader | 250ms | 200/320ms | 120ms | max(320+180, 200) = **500ms** |
| Variable reader | 150ms | 60/300ms | 240ms | max(300+360, 200) = **660ms** |

**Deduplication:** A position already flagged by Source A or B is not double-counted. The breakSet is a Set<number>.

### Compound word internal pause handling

After compound merging, `transcriptWords` still has two separate words ("every" + "one"). Source C could detect a gap between them as a phrase break inside a correctly-read compound word.

**Fix:** Build a `compoundPositions` Set before Source C scanning:
```javascript
const compoundPositions = new Set();
let hypIdx = 0;
for (const entry of alignment) {
  if (entry.compound && entry.parts) {
    // Mark positions between compound parts as skip zones
    for (let p = 0; p < entry.parts.length - 1; p++) {
      compoundPositions.add(hypIdx + p);
    }
    hypIdx += entry.parts.length;  // compound covers multiple transcriptWords positions
  } else if (entry.type !== 'omission') {
    hypIdx++;
  }
  // (omissions don't consume a hypIndex)
}
```

In Source C's gap scanning, skip positions in `compoundPositions`.

### Break classification

After collecting all breaks from Sources A, B, C into breakSet, classify each break:

1. Build `punctMap` = `getPunctuationPositions(referenceText)` → Map<refIndex, 'period'|'comma'>
2. Build `hypToRef` = `buildHypToRefMap(alignment)` → Map<hypIndex, refIndex>
3. For each break position `i` in breakSet:
   - `refIdx` = `hypToRef.get(i)`
   - If `refIdx` is in `punctMap` → classify as `"at-punctuation"`, record `punctType`
   - Else → classify as `"unexpected"`
4. `unexpectedBreaks` = subset of breakSet where classification is `"unexpected"`

This classification is the bridge between Metric 1 and Metric 2:
- Metric 1 uses `unexpectedBreaks` to compute fluency phrasing (the primary number)
- Metric 2 uses the full classification to compute punctuation coverage and precision

### Excluding non-fluent insertions from word counts

When a student says "cat... cat... catastrophe", the first two "cat" attempts are insertions flagged `_isSelfCorrection` or `_partOfStruggle` by `resolveNearMissClusters()`. A human NAEP rater would hear decoding struggle, not fluent phrasing.

**First-principles decision:** These insertions are decoding noise, not fluent reading. Including them in phrase word counts would inflate phrase lengths and produce misleadingly high phrasing levels. Example:

- WITH counting: "The big cat cat catastrophe happened" → 6-word phrase
- WITHOUT counting: "The big" [struggle] "catastrophe happened" → two 2-word phrases

The second is the correct assessment. The student was struggling.

**Implementation:**
- **Word counting** per phrase excludes: disfluencies (`isDisfluency`), self-corrections (`_isSelfCorrection`), near-miss struggle parts (`_partOfStruggle`), unconfirmed words (`crossValidation === 'unconfirmed'`)
- Build a `Set<hypIndex>` of excluded indices by walking the alignment once before phrase building

**Important:** `_isSelfCorrection` and `_partOfStruggle` are on alignment entries (set by `resolveNearMissClusters()` in diagnostics.js). `isDisfluency` is on `transcriptWords[hypIndex]`, NOT on alignment entries. The pre-step must use the correct lookup:

```
Walk alignment tracking hypIndex:
  if entry.type === 'insertion':
    if transcriptWords[hypIndex].isDisfluency → add hypIndex to set
    if entry._isSelfCorrection → add hypIndex to set
    if entry._partOfStruggle → add hypIndex to set
  Also add any hypIndex where transcriptWords[hypIndex].crossValidation === 'unconfirmed'
```

### End-of-passage handling (no exclusion)

The final phrase (from the last phrase break to the end of reading) is **always included**. It represents real data about how the student read those words. Whether the passage ended naturally or the student stopped, the words between the last pause and the end of reading are a real phrase.

### NaN guards

- If `transcriptWords.length < 2`, return `{ insufficient: true, reason: 'Too few words' }` with all numeric fields as `null`.
- If `median(allGaps)` returns `null` (no valid gaps), use `gapFence = 0.200` (the floor) and flag `medianGap: null`.

### Algorithm

```
Input: diagnostics.onsetDelays[], diagnostics.longPauses[],
       transcriptWords[], referenceText, alignment[]
Output: { fluencyPhrasing, overallPhrasing, breakClassification, readingPattern,
          gapDistribution, breakSources, excludedFromCount }

Pre-step: Build excludeFromCount set
  Walk alignment tracking hypIndex:
    if entry.type === 'insertion':
      if transcriptWords[hypIndex].isDisfluency → add hypIndex to set
      if entry._isSelfCorrection → add hypIndex to set
      if entry._partOfStruggle → add hypIndex to set
    Also add any hypIndex where transcriptWords[hypIndex].crossValidation === 'unconfirmed'

Pre-step: Build compoundPositions set (see Compound word section above)

1. Collect phrase break positions (as "break AFTER word index i"):

   Collect Source A and B first (so we can exclude them from baseline computation):

   a) From onsetDelays (Source A) — READ-ONLY, does not modify the array:
      For each delay in diagnostics.onsetDelays:
        if delay._vadAnalysis && delay._vadAnalysis.speechPercent >= 80 → skip (track in vadFiltered)
        breakAfter = delay.wordIndex - 1
        (hesitation is on delay.wordIndex; break is BEFORE that word = AFTER previous)
        if breakAfter >= 0 → add to breakSet, add to sourceABGapPositions

   b) From longPauses (Source B) — READ-ONLY:
      For each pause in diagnostics.longPauses:
        add pause.afterWordIndex to breakSet, add to sourceABGapPositions

   c) Medium pauses (Source C) — IQR-based general detector:

      // Compute student's gap distribution (excluding Sources A/B and compounds)
      allGaps = []
      For each consecutive confirmed word pair (i, i+1) in transcriptWords:
        (skip unconfirmed words as gap boundaries)
        gap = parseTime(word[i+1].startTime) - parseTime(word[i].endTime)
        if gap < 0 → skip
        if position i is in sourceABGapPositions → skip (don't include known pauses)
        if position i is in compoundPositions → skip (compound-internal gap)
        allGaps.push(gap)

      medianGap = median(allGaps)  // for readingPattern classification
      Q1_gap = percentile(allGaps, 25)
      Q3_gap = percentile(allGaps, 75)
      IQR_gap = Q3_gap - Q1_gap
      effectiveIQR_gap = max(IQR_gap, 0.050)  // 50ms floor
      gapFence = max(Q3_gap + 1.5 * effectiveIQR_gap, 0.200)  // 200ms perceptual floor

      // Scan ALL inter-word positions — no punctuation filter
      For each consecutive confirmed word pair (i, i+1) in transcriptWords:
        gap = parseTime(word[i+1].startTime) - parseTime(word[i].endTime)
        if gap < 0 → skip
        if gap < gapFence → skip
        if i in compoundPositions → skip
        if i not already in breakSet → add i to breakSet

   breakSet is a Set<number> — deduplicated by definition

2. Classify reading pattern (from medianGap):
   if medianGap > 0.350 → 'word-by-word'
   if medianGap > 0.250 → 'choppy'
   if medianGap > 0.150 → 'phrase-level'
   else → 'connected'

3. Classify each break:
   Build punctMap = getPunctuationPositions(referenceText)
   Build hypToRef = buildHypToRefMap(alignment)

   For each break position i in breakSet:
     refIdx = hypToRef.get(i)
     if refIdx is in punctMap → classify as "at-punctuation" (record punctType)
     else → classify as "unexpected"

   unexpectedBreaks = breaks classified as "unexpected"

4. Build phrase lists and compute stats:

   a) Fluency phrasing (PRIMARY — unexpected breaks only):
      Sort unexpectedBreaks. Build phrases: groups of consecutive words between breaks.
      Each phrase = { startHypIndex, endHypIndex, wordCount, words[] }
      wordCount only counts indices NOT in excludeFromCount set
      Compute fluencyMean, fluencyMedian from wordCounts (where wordCount > 0)

   b) Overall phrasing (SECONDARY — all breaks):
      Sort breakSet. Build phrases same way.
      Each phrase = { startHypIndex, endHypIndex, wordCount, words[], gapAfterMs, breakSource, breakType }
      wordCount only counts indices NOT in excludeFromCount set
      Compute overallMean, overallMedian from wordCounts (where wordCount > 0)

   The fluency number is always >= the overall number (fewer breaks = longer phrases).
   A student who pauses only at punctuation gets a very high fluency number (phrases span full sentences)
   and a moderate overall number. That's the correct assessment: they're reading fluently.
```

### Data structure returned

```javascript
{
  // PRIMARY: How fluently the student reads between natural boundaries
  // (correct punctuation pauses excluded — they don't penalize the score)
  fluencyPhrasing: {
    mean: 8.2,                    // words/phrase (unexpected breaks only)
    median: 7,                    // primary display metric
    totalPhrases: 12,
    phraseLengths: [6, 8, 9, 7, ...]
  },

  // SECONDARY: Overall rhythm including all pauses
  overallPhrasing: {
    mean: 3.4,
    median: 3,
    totalPhrases: 28,
    phraseLengths: [2, 4, 3, 5, ...],
    phrases: [                     // full detail for Metric 2, Metric 3, and debug
      {
        startHypIndex: 0,
        endHypIndex: 3,
        wordCount: 4,
        words: ["The", "big", "cat", "sat"],
        gapAfterMs: 342,
        breakSource: "hesitation",
        breakType: "unexpected"    // or "at-punctuation"
      },
      ...
    ]
  },

  // Reading pattern classification (catches word-by-word blind spot)
  readingPattern: {
    medianGap: 0.412,              // student's median inter-word gap (seconds)
    classification: 'word-by-word' // or 'choppy', 'phrase-level', 'connected'
  },

  // Break classification (bridge to Metric 2)
  breakClassification: {
    total: 15,
    atPunctuation: 6,              // correct pauses at sentence/clause boundaries
    unexpected: 9,                  // mid-sentence pauses (the fluency signal)
    breaks: [                       // every break with its classification
      { position: 6, type: "at-punctuation", punctType: "period", source: "mediumPause", gapMs: 620 },
      { position: 10, type: "unexpected", punctType: null, source: "hesitation", gapMs: 780 },
      ...
    ]
  },

  // IQR-based gap analysis (replaces 2x median multiplier)
  gapDistribution: {
    Q1: 0.080,                     // 25th percentile of inter-word gaps
    Q3: 0.160,                     // 75th percentile
    IQR: 0.080,                    // Q3 - Q1
    effectiveIQR: 0.080,           // max(IQR, 0.050) — 50ms floor
    gapFence: 0.280,               // max(Q3 + 1.5*effectiveIQR, 0.200) — the threshold
    isFenceFloored: false,         // true if 200ms floor was applied
    isIQRFloored: false,           // true if 50ms IQR floor was applied
    totalGapsAnalyzed: 87
  },

  // Break provenance (debug)
  breakSources: {
    fromHesitations: 8,            // Source A breaks used
    fromLongPauses: 2,             // Source B breaks used
    fromMediumPauses: 5,           // Source C breaks used
    vadFiltered: 1,                // Source A hesitations skipped (speechPercent >= 80)
    compoundSkipped: 2,            // compound-internal gaps skipped
    totalBreaks: 15
  },

  // Exclusion transparency (debug)
  excludedFromCount: {
    disfluencies: 2,
    selfCorrections: 3,
    struggleParts: 1,
    unconfirmed: 4,
    totalExcluded: 10
  },

  // Internal — passed to Metric 2 (frozen or copied)
  _breakSet: Set<number>
}
```

### Where it lives
- **Computation:** New function `computePhrasingQuality()` in diagnostics.js
- **Called from:** app.js, AFTER VAD enrichment and gap adjustment (needs finalized onsetDelays + longPauses)

---

## Metric 2: Punctuation Awareness

### What it measures
Two complementary questions about the relationship between pauses and punctuation:
1. **Coverage:** "Of all punctuation marks the student encountered, how many did the student pause at?" (Does the student honor text structure?)
2. **Precision:** "Of all pauses, how many landed at punctuation?" (Are the student's pauses meaningful?)

### Dialogue punctuation fix

**Problem:** `getPunctuationPositions()` in diagnostics.js checks only `word[word.length - 1]` — the very last character. For `"Hello!"` the last char is `"`, so `!` is missed. For `"Wait,"` the comma is missed. Middle school passages are dialogue-heavy.

**Fix:** In `getPunctuationPositions()`, strip trailing quotation marks and brackets before checking:
```javascript
// Before checking the last character, strip trailing quotes/brackets
const stripped = w.replace(/["'""\u201C\u201D\u2018\u2019)}\]]+$/, '');
if (stripped.length === 0) continue;
const last = stripped[stripped.length - 1];
```

This fixes both the existing `computeProsodyProxy()` (being removed) and the new Metric 2.

### Why coverage is primary

Coverage answers the teacher's most intuitive question: "Does this student honor periods and commas?" It's also passage-density-independent:
- Lightly punctuated (3 marks): student pauses at 2/3 = 67%
- Heavily punctuated (12 marks): student pauses at 8/12 = 67%
- Both comparable as rates

Precision remains useful as secondary/detail data: it tells you whether the student's pauses are meaningful vs. random. A student with high coverage but low precision is a hesitant reader who at least honors sentence structure. A student with low coverage and high precision reads fluently but ignores text structure.

### Coverage denominator: encountered punctuation only

**Problem:** If a student omits 3 sentences entirely, those punctuation marks have no `refToHyp` mapping. They deflate the coverage ratio by counting as "uncovered" even though the student never reached them.

**Fix:** Filter the coverage denominator to only count punctuation marks where the student produced a word at that position:
```javascript
for (const [refIdx, punctType] of punctMap) {
  const hypIdx = refToHyp.get(refIdx);
  if (hypIdx === undefined) continue; // student didn't read this word — skip
  encounteredPunctuationCount++;
  if (breakSet.has(hypIdx)) coveredCount++;
}
coverageRatio = encounteredPunctuationCount > 0
  ? coveredCount / encounteredPunctuationCount
  : null;
```

Both `totalPunctuationMarks` (all in passage) and `encounteredPunctuationMarks` (those the student read through) are stored for transparency.

### How it works

Metric 2 is a **pure consumer** of Metric 1's break classification. It doesn't detect any pauses itself — it evaluates whether the pauses Metric 1 found align with text structure.

**Coverage:** A punctuation mark is "covered" if ANY phrase break from Metric 1 lands on it, AND the student actually read through that position.

**Precision:** Directly from Metric 1's classification: `breakClassification.atPunctuation / breakClassification.total`.

### NaN guards

- If `breakClassification.total === 0`, set `precision.ratio = null`, `precision.label = "No pauses detected"`.
- If `encounteredPunctuationMarks === 0`, set `coverage.ratio = null`, `coverage.label = "No punctuation encountered"`.

### Algorithm

```
Input: transcriptWords[], referenceText, alignment[],
       breakClassification (from Metric 1), breakSet (from Metric 1)
Output: { coverage, precision, passagePunctuationDensity, details[] }

Uses existing helpers:
  - getPunctuationPositions(referenceText) → Map<refIndex, 'period'|'comma'>
    (with dialogue punctuation fix: strip trailing quotes before checking)
  - buildHypToRefMap(alignment) → Map<hypIndex, refIndex>

Also build: refToHyp = reverse of hypToRef (for coverage lookup)

1. COVERAGE: For each punctuation mark in punctMap:
   refIdx = punctuation position
   hypIdx = refToHyp.get(refIdx)
   if hypIdx === undefined → skip (student didn't read this word)
   encounteredPunctuationCount++
   if hypIdx is in breakSet → coveredCount++

   coverageRatio = encounteredPunctuationCount > 0
     ? coveredCount / encounteredPunctuationCount
     : null

2. PRECISION: From breakClassification:
   precisionRatio = breakClassification.total > 0
     ? breakClassification.atPunctuation / breakClassification.total
     : null

3. Build details[] for tooltip:
   For each phrase break:
     { afterHypIndex, afterWord, beforeWord, gapMs, atPunctuation, punctType, breakSource }
   For each uncovered punctuation mark:
     { refIndex, refWord, punctType, covered: false }
```

### Data structure returned

```javascript
{
  // Primary metric — passage-density-independent, encounter-filtered
  coverage: {
    ratio: 0.83,                  // 83% of encountered punctuation marks had a pause
    label: "Paused at most punctuation marks",
    coveredCount: 5,
    encounteredPunctuationMarks: 6,  // only marks the student read through
    totalPunctuationMarks: 8,        // all marks in passage (for reference)
    uncoveredMarks: [             // debug: which encountered punctuation was skipped
      { refIndex: 28, refWord: "running,", punctType: "comma" }
    ]
  },

  // Secondary metric — passage-dependent but still informative
  precision: {
    ratio: 0.62,                  // 62% of pauses at punctuation
    label: "Most pauses at punctuation",
    atPunctuationCount: 8,
    notAtPunctuationCount: 5,
    totalPauses: 13
  },

  // Passage context (for progress monitoring normalization)
  passagePunctuationDensity: 0.045,  // punctuation marks per word (8 marks / 178 words)

  // Coverage interpretive labels:
  // ratio === null → "No punctuation encountered"
  // ratio < 0.30 → "Rarely pauses at punctuation"
  // ratio < 0.60 → "Pauses at some punctuation"
  // ratio < 0.80 → "Pauses at most punctuation"
  // ratio >= 0.80 → "Consistently pauses at punctuation"

  // Precision interpretive labels:
  // ratio === null → "No pauses detected"
  // ratio < 0.30 → "Pauses rarely align with sentences"
  // ratio < 0.60 → "Some pauses at punctuation, many mid-sentence"
  // ratio < 0.80 → "Most pauses at punctuation"
  // ratio >= 0.80 → "Pauses well-aligned with text structure"

  // Full detail (debug + tooltip)
  details: [
    {
      afterHypIndex: 7,
      afterWord: "the",
      beforeWord: "catastrophe",
      gapMs: 450,
      atPunctuation: false,
      punctType: null,
      breakSource: "hesitation"
    },
    ...
  ]
}
```

### Where it lives
- **Computation:** New function `computePauseAtPunctuation()` in diagnostics.js
- **Called from:** app.js, after Metric 1 (needs phrasing breakClassification and breakSet as input)

---

## Metric 3: Pace Consistency

### What it measures
How consistently the student maintains their reading rate across the passage. Does the student read at a steady pace, or race through easy parts and crawl through hard parts?

### Research basis
The Multidimensional Fluency Scale (Rasinski) Dimension 4 is "Pace":
- Level 1: Reads slowly and laboriously
- Level 2: Reads moderately slowly
- Level 3: Demonstrates **inconsistent speed** throughout reading
- Level 4: Consistently reads at **conversational pace**; appropriate rate throughout

Overall WCPM captures absolute pace. What's missing is **consistency** — variation in reading rate across phrases. This is partially measurable from timestamps.

### Why Coefficient of Variation (CV)
CV is dimensionless (comparable across students regardless of absolute speed), scale-free (a student reading at 80 WCPM with CV=0.2 has the same consistency as one at 160 WCPM with CV=0.2), and standard in statistics.

### Algorithm

```
Input: overallPhrasing.phrases[] (from Metric 1), transcriptWords[]
Output: { cv, localRates[], overallRate, interpretation }

1. For each phrase in overallPhrasing.phrases:
   // Compute local reading rate for this phrase
   startTime = transcriptWords[phrase.startHypIndex].startTime
   endTime = transcriptWords[phrase.endHypIndex].endTime
   durationSec = parseTime(endTime) - parseTime(startTime)
   if durationSec <= 0 → skip
   wordsPerMinute = (phrase.wordCount / durationSec) * 60
   localRates.push({ phraseIndex, wordsPerMinute, wordCount, durationSec })

2. Compute statistics:
   meanRate = mean(localRates.map(r => r.wordsPerMinute))
   sdRate = standardDeviation(localRates.map(r => r.wordsPerMinute))
   cv = sdRate / meanRate  // coefficient of variation (0 = perfectly consistent)

3. Classify:
   cv < 0.15 → 'consistent'    // Very steady pace
   cv < 0.30 → 'mostly-steady' // Normal variation
   cv < 0.50 → 'variable'      // Noticeable speed changes
   cv >= 0.50 → 'highly-variable' // Major pace swings (may indicate difficulty spots)

Guard: If fewer than 3 phrases, return { insufficient: true, reason: 'Too few phrases' }
```

### Data structure returned

```javascript
{
  cv: 0.23,                        // coefficient of variation
  classification: 'mostly-steady',
  label: "Mostly steady pace",
  meanLocalRate: 142,              // mean WPM across phrases
  sdLocalRate: 33,                 // SD of local WPM
  phraseCount: 12,                 // phrases analyzed
  localRates: [                    // per-phrase rates for debug/tooltip
    { phraseIndex: 0, wordsPerMinute: 158, wordCount: 7, durationSec: 2.66 },
    { phraseIndex: 1, wordsPerMinute: 122, wordCount: 4, durationSec: 1.97 },
    ...
  ],

  // Interpretive labels:
  // cv < 0.15 → "Consistent pace throughout"
  // cv < 0.30 → "Mostly steady pace"
  // cv < 0.50 → "Variable pace — speeds up and slows down"
  // cv >= 0.50 → "Highly variable pace — significant speed changes"
}
```

### Where it lives
- **Computation:** New function `computePaceConsistency(overallPhrasing, transcriptWords)` in diagnostics.js
- **Called from:** app.js, AFTER Metric 1 (needs phrase data)
- **Depends on:** Metric 1's `overallPhrasing.phrases[]`

---

## Metric 4: Word Duration Outliers (Self-Normed)

### What it measures
Words that took significantly longer than the student's own average, normalized by syllable count. These are the specific words this student found hard.

### Why Deepgram timestamps + syllable normalization

**Use Deepgram timestamps exclusively.** Each `transcriptWords[i]` has `_xvalStartTime` and `_xvalEndTime` — these are Deepgram/Parakeet timestamps set during cross-validation (cross-validator.js:236-257). They are the primary timekeeper and do NOT have the Reverb 100ms BPE artifact.

For words without cross-validator timestamps (`_xvalStartTime` is null/undefined — meaning `crossValidation === 'unconfirmed'`, `'unavailable'`, `'disagreed'`, or `'recovered'`), skip them entirely. Their Reverb timestamps are unreliable for duration measurement.

This is a cleaner design than the v3 "skip if duration < 150ms" hack:
- v3 reason: Filter out 100ms BPE artifact durations
- v6 reason: Use the right timestamps in the first place. No artifact. No filter.

**Normalize by syllable count, not character count.** Speech is produced in syllable-sized articulatory gestures. "Strength" (8 chars, 1 syllable) takes about the same time as "cat" (3 chars, 1 syllable). Character count conflates orthographic and phonological complexity.

Uses `countSyllables()` from `js/syllable-counter.js` (already created — heuristic algorithm with ~408-word exception dictionary, ~95% accuracy on grade 1-8 vocabulary, dependency-free).

**Research support:**
- Baker & Bradlow (2009, Language and Speech) found phoneme count (which correlates strongly with syllable count) is among the strongest predictors of word duration. European ORF assessments already use syllables-per-second.
- Kim (EJ1205219, ERIC) studied 58 middle schoolers (mean age 13.2) and found that automaticity of word recognition was a unique predictor of reading fluency independent of word knowledge. The effect was strongest for **multisyllabic words (22% unique variance)**. This directly supports flagging slow multisyllabic words as practice targets.

### Why it's strong
- Self-normed: compares each word to the student's OWN baseline, not external norms
- Syllable-normalized: controls for the actual articulatory effort of each word
- Uses Deepgram timestamps: the most reliable timing source in the pipeline
- Produces a concrete "practice these words" list — especially multisyllabic words (highest unique variance for fluency)
- Verifiable: teacher can click any flagged word and hear the audio

### Outlier detection: IQR method (Tukey's fences)

Instead of an arbitrary multiplier threshold (1.7x? 2.0x?), we use the standard statistical outlier definition — the same method used for boxplot whiskers. No magic numbers. Adapts to each student's own variability.

```
Q1 = 25th percentile of ms/syllable values
Q3 = 75th percentile
IQR = Q3 - Q1
effectiveIQR = max(IQR, 50)    // 50ms/syl floor prevents degenerate fence
upperFence = Q3 + 1.5 * effectiveIQR
any word above the fence = outlier
```

**Why the 50ms IQR floor:** A very consistent reader gets IQR near 0. Without the floor, the fence collapses to Q3, and random ASR jitter (+-50ms) causes arbitrary words to be flagged. The floor ensures a minimum reasonable spread. When `IQR < effectiveIQR`, the output includes `isFenceFloored: true`.

**Why this is better than a fixed multiplier:**
- A **consistent reader** (Q1=190, Q3=220, IQR=30, effectiveIQR=50) gets fence = 220 + 75 = **295ms/syl**. Even a mildly slow word gets caught because it's genuinely unusual for them.
- A **variable reader** (Q1=150, Q3=320, IQR=170) gets fence = 320 + 255 = **575ms/syl**. Only truly extreme words get flagged — because this student always has wide variation.
- A **fixed 2.0x multiplier** can't distinguish these two students. The IQR method can.

The 1.5 factor is the standard Tukey convention for "mild outliers" — no tuning needed.

### NaN guards

- If fewer than 4 words analyzed, return `{ insufficient: true, reason: 'Too few words with Deepgram timestamps' }`.
- If `IQR < 50` (ms), use `effectiveIQR = 50` (see above).

### Algorithm

```
Input: transcriptWords[], alignment[]
Output: { baseline, outliers[], outlierCount, allWords[] }

1. For each word in transcriptWords that has a matching alignment entry:
   Skip if: disfluency insertion, _isSelfCorrection, _partOfStruggle
   Skip if: _xvalStartTime is null/undefined (no Deepgram timestamps)

   duration = parseTime(word._xvalEndTime) - parseTime(word._xvalStartTime)
   if duration <= 0 → skip (bad timestamp)

   syllables = countSyllables(word.word)
   normalizedDuration = duration / syllables   // ms-per-syllable

   Store: { hypIndex, word, refWord, refIndex, duration, syllables, normalizedDuration, alignmentType }

2. Compute student baseline distribution from all normalizedDuration values:
   Q1 = 25th percentile
   Q3 = 75th percentile
   IQR = Q3 - Q1
   effectiveIQR = max(IQR, 50)        // 50ms/syl minimum floor
   upperFence = Q3 + 1.5 * effectiveIQR
   Also: median, mean, sd (for debug/display)
   Store both IQR (actual) and effectiveIQR (used for fence) for transparency

3. For each word:
   if normalizedDuration > upperFence AND syllables >= 2 → flag as outlier

   (Monosyllabic words excluded as outliers — function words with unreliable
    per-syllable ratios due to coarticulation. Still included in baseline distribution.)

4. Build outliers[] sorted by normalizedDuration (worst first):
   {
     hypIndex, word, refWord, refIndex,
     durationMs, syllables, normalizedDurationMs,
     aboveFenceBy,    // how far above the fence in ms (e.g., 462 - 430 = 32ms)
     ratio,           // vs median, for display context (e.g., 2.15x)
     alignmentType    // 'correct', 'substitution', 'struggle'
   }

5. Compute passage-level stats:
   Q1, Q3, IQR, effectiveIQR, upperFence, isFenceFloored, median, mean, sd
```

### Edge cases

- **Compound words:** Merged compounds (e.g., "everyone" from "every" + "one") — use `_xvalStartTime` of first part to `_xvalEndTime` of last part (from synthetic sttLookup entry). Syllable count from the merged word.
- **Monosyllabic words:** ("a", "the", "cat") — include in baseline/IQR calculation but don't flag as outliers (syllables < 2). Coarticulation makes per-syllable ratios unreliable for 1-syllable words.
- **Words without Deepgram timestamps:** Skip entirely — not analyzable without reliable timing.
- **Disfluency insertions:** Skip entirely — fillers like "um" have no ref word to practice.
- **Self-correction / struggle insertions:** Skip entirely — they are decoding attempts, not representative of the student's word-level reading speed.
- **Very few words analyzed (< 4):** Return `{ insufficient: true }` — IQR is unreliable with tiny samples.

### Data structure returned

```javascript
{
  baseline: {
    medianDurationPerSyllable: 215,   // ms per syllable
    meanDurationPerSyllable: 238,
    sdDurationPerSyllable: 82,
    Q1: 180,                          // 25th percentile ms/syllable
    Q3: 280,                          // 75th percentile ms/syllable
    IQR: 100,                         // Q3 - Q1 (actual)
    effectiveIQR: 100,                // max(IQR, 50) — used for fence
    upperFence: 430,                  // Q3 + 1.5 * effectiveIQR — THE outlier threshold
    isFenceFloored: false,            // true if effectiveIQR > IQR (50ms floor applied)
    totalWordsAnalyzed: 142,
    wordsSkippedNoTimestamps: 8       // debug: words without Deepgram timestamps
  },
  outliers: [
    {
      hypIndex: 47,
      word: "catastrophe",            // what they said (or attempted)
      refWord: "catastrophe",         // what it should be
      refIndex: 42,                   // position in reference text (for progress tracking)
      durationMs: 1850,
      syllables: 4,                   // from countSyllables()
      normalizedDurationMs: 462,      // per syllable (1850/4)
      aboveFenceBy: 32,              // 462 - 430 = 32ms above the fence
      ratio: 2.15,                    // vs median, for display context
      alignmentType: "correct"        // they got it right, just slow
    },
    ...
  ],
  outlierCount: 8,

  // Full word-level data (debug — every word analyzed, not just outliers)
  allWords: [
    {
      hypIndex: 0,
      word: "The",
      durationMs: 180,
      syllables: 1,
      normalizedDurationMs: 180,
      isOutlier: false,
      timestampSource: "deepgram"     // always "deepgram" in v6
    },
    ...
  ]
}
```

### Where it lives
- **Computation:** New function `computeWordDurationOutliers()` in diagnostics.js
- **Import:** `countSyllables` from `./syllable-counter.js`
- **Called from:** app.js, alongside the other prosody metrics (no VAD dependency — uses word-internal durations)

---

## Session Prosody Summary (for Progress Monitoring)

### What it measures
A snapshot of all four metrics, stored with each assessment for trend tracking.

### What gets stored
Add a `prosody` field to the assessment object in storage.js:124-148. **Important:** the `prosody` field must be added to BOTH `storage.js`'s `saveAssessment()` function AND the app.js call site that passes the results object.

```javascript
// Added to the assessment object in saveAssessment():
prosody: {
  phrasing: {
    fluencyMean: 8.2,             // PRIMARY: words/phrase between unexpected pauses
    fluencyMedian: 7,
    overallMean: 3.4,             // SECONDARY: words/phrase with all pauses
    overallMedian: 3,
    totalPhrasesOverall: 28,
    unexpectedBreaks: 9,
    atPunctuationBreaks: 6,
    readingPattern: 'connected',  // or 'phrase-level', 'choppy', 'word-by-word'
    medianGap: 0.112,             // student's median inter-word gap (seconds)
    gapFence: 0.280               // IQR-based threshold used for Source C
  },
  pauseAtPunctuation: {
    coverageRatio: 0.83,          // PRIMARY: punctuation marks covered
    coveredCount: 5,
    encounteredPunctuationMarks: 6,  // only marks the student read through
    totalPunctuationMarks: 8,        // all marks in passage (for reference)
    precisionRatio: 0.62,         // SECONDARY: pauses at punctuation
    notAtPunctuationCount: 5,
    passagePunctuationDensity: 0.045  // for cross-passage normalization
  },
  paceConsistency: {              // NEW in v6
    cv: 0.23,
    classification: 'mostly-steady',
    meanLocalRate: 142,
    sdLocalRate: 33,
    phraseCount: 12
  },
  wordOutliers: {
    medianDurationPerSyllable: 215,   // ms per syllable
    upperFence: 430,                  // IQR outlier threshold (Q3 + 1.5*effectiveIQR)
    effectiveIQR: 100,                // IQR used (may be floored at 50ms)
    outlierCount: 8,
    outliers: [
      { word: "catastrophe", refIndex: 42, normalizedMs: 462, aboveFenceBy: 32, syllables: 4 },
      { word: "unfortunately", refIndex: 67, normalizedMs: 480, aboveFenceBy: 50, syllables: 5 },
      { word: "beneath", refIndex: 15, normalizedMs: 445, aboveFenceBy: 15, syllables: 2 }
    ]
  },
  passageSnippet: "The cat sat on the mat...",  // first ~50 chars of reference text
  assessedAt: "2026-02-06T10:30:00Z"
}
```

### Why outliers store normalizedMs, aboveFenceBy, and syllables

Previous versions stored `outlierWords: ["catastrophe", "unfortunately", "beneath"]` — just word strings. This loses critical context:
- Can't distinguish "catastrophe at position 42 in passage X" from "catastrophe at position 12 in passage Y"
- Can't track whether the student improved on the same word across re-reads of the same passage
- Can't compute whether the duration decreased over time for a specific word

v6 stores per-outlier: `normalizedMs` (ms/syllable — the actual measurement), `aboveFenceBy` (how far above the IQR fence), and `syllables` (for aggregating by syllable complexity, e.g., "struggles most with 4+ syllable words"). The `upperFence` is stored at the session level so future progress monitoring can see whether the student's variability is tightening over time.

### Progress monitoring queries
With this stored per session, the UI can later show:
- Fluency phrasing trend: [4.2, 5.1, 6.3, 7.0, 8.2] across 5 sessions (the primary number)
- Overall phrasing trend: [2.1, 2.5, 2.8, 3.0, 3.4] (secondary context)
- Punctuation coverage trend: [0.50, 0.67, 0.67, 0.83, 0.83, 1.0]
- Punctuation precision trend: [0.45, 0.52, 0.60, 0.62, 0.72, 0.78]
- Pace consistency trend: [0.52, 0.45, 0.38, 0.30, 0.23] (CV decreasing = more consistent)
- Recurring outlier words (same word + same refIndex across sessions on same passage)
- Per-word improvement (ratio decreasing across re-reads)
- Outlier complexity pattern ("struggles with 4+ syllable words")
- Cross-passage comparison using passagePunctuationDensity for normalization

Progress monitoring UI is NOT part of this implementation — it's a future feature that this data enables. This plan only adds the storage.

---

## Pipeline Ordering

**Critical design:** Prosody metrics are computed AFTER VAD enrichment AND gap adjustment, because they consume the finalized `onsetDelays` and `longPauses` arrays. Prosody is READ-ONLY — it never modifies the source arrays.

Current pipeline (app.js ~816-904):
```
1. runDiagnostics()          → onsetDelays, longPauses, selfCorrections, etc.
2. enrichDiagnosticsWithVAD() → adds _vadAnalysis to pauses/hesitations
3. adjustGapsWithVADOverhang() → corrects onset delay gaps, removes false hesitations
```

New pipeline:
```
1. runDiagnostics()            → onsetDelays, longPauses, selfCorrections, morphErrors, struggleWords
                                  (NO prosodyProxy — removed)
2. enrichDiagnosticsWithVAD()  → adds _vadAnalysis to pauses/hesitations
3. adjustGapsWithVADOverhang() → corrects gaps, removes false hesitations
4. computePhrasingQuality()    → NEW — phrase breaks, classification, reading pattern, gap IQR
5. computePauseAtPunctuation() → NEW — coverage + precision (consumes Metric 1 breakClassification)
6. computePaceConsistency()    → NEW — CV of local reading rates (consumes Metric 1 phrases)
7. computeWordDurationOutliers() → NEW — IQR-based outlier detection (independent, uses Deepgram timestamps)
8. Attach all four to diagnostics.prosody container
```

Steps 4-6 MUST come after step 3 because they consume the finalized, VAD-adjusted hesitation list. If run before adjustment, phantom hesitations would create false phrase breaks.

Step 7 is independent (uses `_xvalStartTime`/`_xvalEndTime`, not inter-word gaps) and could theoretically run in parallel, but sequential execution is fine for clarity.

---

## File Changes

### diagnostics.js — Primary changes

**Remove:** `computeProsodyProxy()` (lines 449-488)

**Fix:** `getPunctuationPositions()` (lines 16-29) — strip trailing quotation marks and brackets before checking the last character (dialogue punctuation fix)

**Add:** Four new exported functions:

1. `computePhrasingQuality(diagnostics, transcriptWords, referenceText, alignment)` — Metric 1
   Note: takes `diagnostics` object (READS `.onsetDelays` and `.longPauses`, does not modify them)
   Returns: fluencyPhrasing, overallPhrasing, breakClassification, readingPattern, gapDistribution, _breakSet
2. `computePauseAtPunctuation(transcriptWords, referenceText, alignment, breakClassification, breakSet)` — Metric 2
3. `computePaceConsistency(overallPhrasing, transcriptWords)` — Metric 3
4. `computeWordDurationOutliers(transcriptWords, alignment)` — Metric 4

**New import:** `import { countSyllables } from './syllable-counter.js';`

**Add helpers:**
- `median(arr)` — returns null for empty/null input, copies before sorting (`[...arr].sort(...)`)
- `percentile(arr, p)` — for Q1/Q3 calculations

**Modify:** `runDiagnostics()` orchestrator — remove `prosodyProxy`:
```javascript
export function runDiagnostics(transcriptWords, alignment, referenceText) {
  return {
    onsetDelays: detectOnsetDelays(transcriptWords, referenceText, alignment),
    longPauses: detectLongPauses(transcriptWords),
    selfCorrections: detectSelfCorrections(transcriptWords, alignment),
    morphologicalErrors: detectMorphologicalErrors(alignment, transcriptWords),
    struggleWords: detectStruggleWords(transcriptWords, referenceText, alignment)
  };
}
```

### miscue-registry.js — Add wordByWord diagnostic

```javascript
{
  id: 'wordByWord',
  description: 'Student reads with uniform pauses between most words, indicating word-by-word decoding rather than phrase-level reading',
  detectorLocation: 'diagnostics.js → computePhrasingQuality() → readingPattern',
  countsAsError: false,  // It's a reading pattern diagnostic, not a per-word error
  config: {
    thresholds: {
      wordByWord: 0.350,  // medianGap > 350ms
      choppy: 0.250,      // medianGap > 250ms
      phraseLevel: 0.150  // medianGap > 150ms
    }
  },
  example: 'Student reads "The... cat... sat... on... the... mat" with ~400ms between every word'
}
```

### app.js — Pipeline integration

After existing VAD enrichment block (around line 904), add prosody computation:

```javascript
// Prosody metrics — computed AFTER VAD enrichment + gap adjustment
// READ-ONLY: these functions consume finalized diagnostics but never modify them
import { computePhrasingQuality, computePauseAtPunctuation, computePaceConsistency, computeWordDurationOutliers } from './diagnostics.js';

const phrasing = computePhrasingQuality(diagnostics, transcriptWords, referenceText, alignment);
const pauseAtPunctuation = computePauseAtPunctuation(
  transcriptWords, referenceText, alignment, phrasing.breakClassification, phrasing._breakSet
);
const paceConsistency = computePaceConsistency(phrasing.overallPhrasing, transcriptWords);
const wordOutliers = computeWordDurationOutliers(transcriptWords, alignment);

// All prosody lives in its own container — additive only
diagnostics.prosody = {
  phrasing,
  pauseAtPunctuation,
  paceConsistency,
  wordOutliers
};
```

Before `saveAssessment()`, assemble the prosody snapshot AND pass it in the call:

```javascript
const prosodySnapshot = {
  phrasing: {
    fluencyMean: diagnostics.prosody.phrasing.fluencyPhrasing.mean,
    fluencyMedian: diagnostics.prosody.phrasing.fluencyPhrasing.median,
    overallMean: diagnostics.prosody.phrasing.overallPhrasing.mean,
    overallMedian: diagnostics.prosody.phrasing.overallPhrasing.median,
    totalPhrasesOverall: diagnostics.prosody.phrasing.overallPhrasing.totalPhrases,
    unexpectedBreaks: diagnostics.prosody.phrasing.breakClassification.unexpected,
    atPunctuationBreaks: diagnostics.prosody.phrasing.breakClassification.atPunctuation,
    readingPattern: diagnostics.prosody.phrasing.readingPattern.classification,
    medianGap: diagnostics.prosody.phrasing.readingPattern.medianGap,
    gapFence: diagnostics.prosody.phrasing.gapDistribution.gapFence
  },
  pauseAtPunctuation: {
    coverageRatio: diagnostics.prosody.pauseAtPunctuation.coverage.ratio,
    coveredCount: diagnostics.prosody.pauseAtPunctuation.coverage.coveredCount,
    encounteredPunctuationMarks: diagnostics.prosody.pauseAtPunctuation.coverage.encounteredPunctuationMarks,
    totalPunctuationMarks: diagnostics.prosody.pauseAtPunctuation.coverage.totalPunctuationMarks,
    precisionRatio: diagnostics.prosody.pauseAtPunctuation.precision.ratio,
    notAtPunctuationCount: diagnostics.prosody.pauseAtPunctuation.precision.notAtPunctuationCount,
    passagePunctuationDensity: diagnostics.prosody.pauseAtPunctuation.passagePunctuationDensity
  },
  paceConsistency: {
    cv: diagnostics.prosody.paceConsistency.cv,
    classification: diagnostics.prosody.paceConsistency.classification,
    meanLocalRate: diagnostics.prosody.paceConsistency.meanLocalRate,
    sdLocalRate: diagnostics.prosody.paceConsistency.sdLocalRate,
    phraseCount: diagnostics.prosody.paceConsistency.phraseCount
  },
  wordOutliers: {
    medianDurationPerSyllable: diagnostics.prosody.wordOutliers.baseline.medianDurationPerSyllable,
    upperFence: diagnostics.prosody.wordOutliers.baseline.upperFence,
    effectiveIQR: diagnostics.prosody.wordOutliers.baseline.effectiveIQR,
    outlierCount: diagnostics.prosody.wordOutliers.outlierCount,
    outliers: diagnostics.prosody.wordOutliers.outliers.map(o => ({
      word: o.refWord || o.word,
      refIndex: o.refIndex,
      normalizedMs: o.normalizedDurationMs,
      aboveFenceBy: o.aboveFenceBy,
      syllables: o.syllables
    }))
  },
  passageSnippet: referenceText.substring(0, 50),
  assessedAt: new Date().toISOString()
};

// Pass prosody snapshot in the saveAssessment call
// (both the app.js call site AND storage.js must handle the prosody field)
```

### ui.js — Collapsible Prosody section (replaces single metric box)

**Remove:** The current prosody box (lines 414-419):
```javascript
if (diagnostics && diagnostics.prosodyProxy) {
  const prosBox = document.createElement('div');
  prosBox.className = 'metric-box';
  prosBox.innerHTML = '<span class="metric-value">' + diagnostics.prosodyProxy.ratio + '</span><span class="metric-label">Prosody</span>';
  metricsBar.appendChild(prosBox);
}
```

**Replace with:** A collapsible prosody section below the metrics bar. Collapsed by default, shows a summary header, expands to reveal all four metrics with detail.

**Reading pattern warning:** When `readingPattern.classification` is `'word-by-word'` or `'choppy'`, show a warning above the four metric boxes in the expanded view, and replace the phrasing number in the collapsed header (since the phrasing number is misleading when the student reads word-by-word):

- word-by-word: "Word-by-word reading pattern (median gap: 412ms)"
- choppy: "Choppy reading pattern (median gap: 268ms)"

```
Collapsed (normal):
+-----------------------------------------------------------------------+
|  > Prosody: 7 words/phrase | 5/6 punct | 8 slow words | steady pace   |
+-----------------------------------------------------------------------+

Collapsed (word-by-word warning replaces phrasing number):
+-----------------------------------------------------------------------+
|  > Prosody: Word-by-word | 5/6 punct | 8 slow words | variable pace   |
+-----------------------------------------------------------------------+

Expanded:
+-----------------------------------------------------------------------+
|  v Prosody                                                            |
|                                                                       |
|  !! Word-by-word reading pattern (median gap: 412ms) !!              |
|  (warning shown only for word-by-word or choppy classifications)      |
|                                                                       |
|  +---------------+  +-----------------+  +-----------+  +------------+|
|  |   7 words     |  |  5 of 6         |  |  8 words  |  | Mostly     ||
|  |   per phrase   |  |  Punctuation    |  |  Duration |  | Steady     ||
|  |   (fluency)   |  |  Coverage       |  |  Outliers |  | Pace       ||
|  +---------------+  +-----------------+  +-----------+  +------------+|
|                                                                       |
|  NOTE: When readingPattern is 'word-by-word' or 'choppy', the        |
|  phrasing box shows the classification instead of the misleading      |
|  words/phrase number (which would show the entire passage as one      |
|  phrase since uniform gaps don't exceed the IQR fence):               |
|  +---------------+                                                    |
|  | Word-by-word  |   ← replaces "134 words per phrase"               |
|  | reading       |                                                    |
|  | (gap: 412ms)  |                                                    |
|  +---------------+                                                    |
|                                                                       |
|  Tooltip on "Phrasing":                                               |
|    "How fluently this student reads between sentence boundaries.      |
|     Fluency: median 7 words/phrase (mean 8.2) — unexpected pauses     |
|     Overall: median 3 words/phrase (mean 3.4) — all pauses            |
|     9 unexpected pauses, 6 at punctuation (correct)                   |
|     Gap analysis: Q3=160ms, IQR=80ms, Fence=280ms (IQR-based)        |
|     Breaks: 8 hesitations, 2 long pauses, 5 medium pauses"           |
|                                                                       |
|  Tooltip on "Punctuation Coverage":                                   |
|    "Of 6 punctuation marks encountered, the student paused at 5.      |
|     (8 total in passage, 6 encountered by student)                    |
|     Missed: comma after 'running' (word 28)                           |
|     Also: 62% of all pauses landed at punctuation (8 of 13)           |
|     Precision note: affected by passage punctuation density."         |
|                                                                       |
|  Tooltip on "Duration Outliers":                                      |
|    "Multisyllabic words above this student's statistical outlier      |
|     fence (IQR method: Q3 + 1.5*IQR = 430ms/syllable).               |
|     Student baseline: median 215ms/syl, Q1=180, Q3=280               |
|     catastrophe (4 syl): 462ms/syl — 32ms above fence                |
|     unfortunately (5 syl): 480ms/syl — 50ms above fence              |
|     Timestamps: Deepgram/Parakeet (142 words analyzed, 8 skipped)"   |
|                                                                       |
|  Tooltip on "Pace":                                                   |
|    "How consistently the student reads across the passage.            |
|     CV = 0.23 (mostly steady — normal variation)                      |
|     Mean local rate: 142 WPM across 12 phrases                       |
|     Fastest phrase: 158 WPM (phrase 1, 7 words)                       |
|     Slowest phrase: 98 WPM (phrase 8, 3 words)                        |
|     Note: Pace is measured within phrases, not word-by-word."         |
|                                                                       |
|  ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──              |
|  Measures phrasing, timing, and pace from word timestamps.            |
|  Does not measure expression, intonation, or stress                   |
|  (requires audio pitch analysis).                                     |
+-----------------------------------------------------------------------+
```

**Scope transparency note:** Always visible at the bottom of the expanded section. Small font, muted color (#999). Single line. Honest and unobtrusive. Research basis: Dowhower (1991) identified 6 prosodic indicators — timestamps can measure pausal intrusions, phrase length, phrase appropriateness, and partially pace. Cannot measure terminal intonation contours, stress, or expression/volume. The MFS has 4 dimensions; we cover Phrasing (Dimension 2), Smoothness (Dimension 3), and partially Pace (Dimension 4). We cannot measure Expression & Volume (Dimension 1).

**No changes to the alignment view.** No phrase break indicators, no word-slow highlighting, no legend additions. The alignment view stays as-is.

### celeration-chart.js — Remove prosody metric

**Remove** prosody from three places:

1. `metricColors` (line 93): remove `prosody: '#b07d3d'`
2. `METRIC_LABELS` (line 110): remove `prosody: 'Prosody'`
3. `getDataPoints()` switch (lines 226-227): remove `case 'prosody':`

This cleanly removes the broken prosody line from the celeration chart. The four new metrics don't map to a single time-series value, so they don't belong on a celeration chart. Progress monitoring (phrasing level trends, etc.) will use a dedicated future UI fed by the stored prosody snapshots.

### storage.js — Add prosody to saved assessments

In `saveAssessment()` (line 124-148), add:
```javascript
prosody: results.prosody ?? null
```

### index.html — CSS for collapsible prosody section + version

```css
/* Collapsible prosody section */
.prosody-section {
  margin-top: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  overflow: hidden;
}

.prosody-header {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  cursor: pointer;
  background: #f8f8f8;
  font-size: 0.9em;
  user-select: none;
}

.prosody-header:hover {
  background: #f0f0f0;
}

.prosody-header .toggle-arrow {
  margin-right: 6px;
  transition: transform 0.2s;
}

.prosody-header.expanded .toggle-arrow {
  transform: rotate(90deg);
}

.prosody-body {
  display: none;
  padding: 8px 10px;
}

.prosody-body.visible {
  display: block;
}

.prosody-metrics {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.prosody-warning {
  color: #b45309;
  font-weight: 500;
  padding: 4px 8px;
  background: #fef3c7;
  border-radius: 3px;
  margin-bottom: 8px;
  font-size: 0.85em;
}

.prosody-scope-note {
  margin-top: 10px;
  font-size: 0.78em;
  color: #999;
  border-top: 1px solid #eee;
  padding-top: 6px;
}
```

Update version timestamp.

---

## Build Order

### Step 1: Metric functions (diagnostics.js)
Write `computePhrasingQuality()`, `computePauseAtPunctuation()`, `computePaceConsistency()`, `computeWordDurationOutliers()`, and `median()`/`percentile()` helpers. Fix `getPunctuationPositions()` for dialogue punctuation. Import `countSyllables` from `syllable-counter.js`. Remove `computeProsodyProxy()`. Update `runDiagnostics()` to remove prosodyProxy.

### Step 2: Miscue registry (miscue-registry.js)
Add `wordByWord` diagnostic type with thresholds.

### Step 3: Pipeline integration (app.js)
Add prosody computation AFTER VAD enrichment + gap adjustment. Import the new functions. Wire up the `diagnostics.prosody` container. Wire up the prosody snapshot before save. Add `prosody: prosodySnapshot` to the saveAssessment call.

### Step 4: Collapsible prosody UI (ui.js)
Replace the single prosody ratio box with the collapsible section. Build the four metric boxes with tooltips (including debug data in tooltips). Add reading pattern warning. Add scope transparency note. No alignment view changes.

### Step 5: Celeration chart cleanup (celeration-chart.js)
Remove prosody metric from colors, labels, and data extraction.

### Step 6: Storage (storage.js)
Add prosody snapshot to saved assessments. Ensure `results.prosody` is accepted.

### Step 7: Version + cleanup (index.html)
Add CSS for collapsible section. Update version timestamp. Remove any remaining references to old `prosodyProxy`.

---

## What This Does NOT Include

- **Pitch/F0 analysis** — deliberately excluded. Noisy on individual students, requires Parselmouth dependency, marginal value for teacher decisions.
- **Progress monitoring UI** — the data is stored (Step 6) but trend visualization is a future feature.
- **Spaced repetition / word banks** — the outlier word list enables this but the repetition system is a separate feature.
- **NAEP rubric levels** — deliberately excluded. The NAEP Oral Reading Fluency Scale (Pinnell et al., 1995) is a holistic rubric for human evaluators that considers phrasing, syntax, and expression simultaneously. Bucketing a single ASR-derived number into NAEP levels would claim false precision. We report the continuous value (median words per phrase) and let the number speak for itself. The reading pattern classification ('word-by-word', 'choppy', 'phrase-level', 'connected') is based on Goldman-Eisler/Schwanenflugel research on inter-word gaps, not on NAEP levels, though it correlates with them.
- **Alignment view indicators** — deliberately excluded. No phrase break pipes, no word-slow highlighting, no legend updates. The alignment view is already information-dense. Prosody data lives in its own collapsible section.
- **Celeration chart prosody line** — removed. The four metrics don't reduce to a single number suitable for celeration charting. Future progress monitoring will use dedicated UI.
- **Modification of existing diagnostics** — v6 is explicitly READ-ONLY. Prosody reads from onsetDelays/longPauses but never modifies them. All results go into `diagnostics.prosody`.

---

## Remaining Concerns (low priority, for future consideration)

1. **Expressive reader false positives:** Deliberate dramatic pauses mid-sentence count as "unexpected" breaks. Low impact for middle school ORF passages (narrative prose, not dramatic monologues). Could extend `getPunctuationPositions` to recognize ellipses (`...`) and em-dashes (`--`) as valid pause positions in a future version.

2. **Bimodal gap distribution:** A student fluent in the first half and struggling in the second gets a blended threshold. The phrase-level data preserves positional information (long phrases early, short phrases late), so a teacher looking at the detail can see the pattern. A sliding window approach would be more sensitive but adds complexity.

3. **Substitution syllable count in Metric 4:** When a student says "cat" (1 syl) instead of "catastrophe" (4 syl), `countSyllables(word.word)` uses the hypothesis word's syllable count. This is correct for baseline computation (reflects actual articulatory effort) but means the duration isn't measuring the target word. Low impact — substitutions are a small fraction of words.

4. **Monosyllabic passage:** If a passage has < 5 multisyllabic words, Metric 4 produces no outliers. The `totalWordsAnalyzed` count should be added to the output. Consider adding monosyllabic content words to outlier detection when multisyllabic count is very low (future enhancement).

5. **IQR gap approach validation:** The IQR approach for Source C gap detection should be empirically validated against teacher-annotated recordings. Run the metric on recordings already assessed by ear and verify the detected phrase breaks match what teachers hear. Adjust the 1.5 IQR factor or the 200ms floor if needed.

6. **ASR timestamp accuracy:** Deepgram timestamps have ~50-100ms accuracy. For very short pauses (200-300ms), this is 33-50% relative error. The 200ms floor helps, but borderline pauses should be treated with appropriate caution. The `aboveFenceBy` field in both gap and duration outlier data helps teachers gauge confidence.

7. **Reading pattern thresholds:** The 150ms/250ms/350ms boundaries for readingPattern classification are research-derived approximations. They should be calibrated against teacher assessments of actual student recordings. These thresholds are not validated clinical cutoffs.
