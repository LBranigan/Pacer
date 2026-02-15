# Plan 6: Independent Reference Alignment Architecture

## Context

The current pipeline compares V1 (Reverb verbatim) to V0 (Reverb clean) to detect divergence blocks, then collapses fragments using V0 as authority (V2), then again using reference as authority (V3), before finally aligning to reference. This V0→V1→V2→V3 chain is fragile: when V0 gets word boundaries wrong (e.g., merging "your" + student's "content's" attempt into "yourense"), V2 propagates that error and destroys fragment information before V3 can fix it.

Plan 5 already proved the better paradigm: align each engine independently to reference (the only ground truth) and compare per-ref-word. This plan extends that paradigm to ALL three engines (V1, V0, Parakeet), eliminating the legacy V2/V3 chain entirely.

### Current pipeline (being replaced)
```
V1 ──┐
     ├─ align V1 to V0 ─→ divergence blocks ─→ V2 collapse ─→ V3 collapse ─→ NW align to ref
V0 ──┘                                                                            │
                                                                              compare per-ref-word
Parakeet ─────────────────────────────────── NW align to ref ──────────────────────┘
```

### New architecture
```
V1 (Reverb verbatim) ─── alignWords(ref) ───┐
V0 (Reverb clean)    ─── alignWords(ref) ───┼── per-ref-word 3-way verdict ── final alignment
Parakeet             ─── alignWords(ref) ───┘
```

Each engine independently aligned to the one thing that IS ground truth. No chain of engine-vs-engine comparisons. No V2, no V3. V0/V1 comparison becomes a per-ref-word annotation (disfluency type classification) rather than a structural grouping step.

### The "yourense" bug that motivated this

The student said: `"your" [1s pause] "con...tense"` (attempting "content's")

| Engine | Heard | Correct? |
|---|---|---|
| V1 (verbatim) | `your` + `conense` | Correct split — 2 words for 2 ref words |
| V0 (clean) | `yourense` | **Wrong** — merged across a 1s gap |
| Parakeet | `your` + `con` + `tense` | Correct split |

V2 trusted V0, collapsed V1's `your`+`conense` → `yourense`, destroying the correct "your". The new architecture avoids this: each engine aligned to reference independently, V1 and Parakeet both show "your" as correct, V0 is outvoted.

---

## Phase 1: Fix `hypIndex` to return original indices

**File:** `js/alignment.js` (line 453-541)

**Problem:** `alignWords()` calls `filterDisfluencies()` on line 455, which strips fillers from the word array. The NW traceback sets `hypIndex = j - 1` (line 522), which indexes into the **filtered** array. Currently this works because V2/V3 collapse already removed fillers from `transcriptWords`. With raw V1 words (which include "uh", "um"), `hypIndex` would point to wrong positions.

**Fix:** Track original indices through the filter:

```js
// Current (line 455):
const hypWords = filterDisfluencies(
  (transcriptWords || []).map(w => normalizeText(w.word)[0]).filter(Boolean)
);

// New:
const rawNormed = (transcriptWords || []).map((w, i) => ({
  norm: normalizeText(w.word)[0], origIdx: i
})).filter(p => p.norm);
const filtered = rawNormed.filter(p => !DISFLUENCIES.has(p.norm));
const hypWords = filtered.map(p => p.norm);

// In traceback, replace `hypIndex: j - 1` with:
//   hypIndex: filtered[j - 1].origIdx
```

All three alignment calls benefit from this fix. No downstream code changes needed — `hypIndex` already indexes into the word array passed to `alignWords()`.

---

## Phase 2: Simplify kitchen-sink merger

**File:** `js/kitchen-sink-merger.js`

### Delete:
- `buildMergedWordsFromAlignment()` (lines 72-188) — divergence block builder
- The `alignTranscripts(V1, V0)` call (line 311) — V0/V1 alignment
- Divergence block stats computation (lines 320-333)
- All `_divergence`, `isDisfluency`, `disfluencyType` tagging

### Replace with:
Return raw V1 words directly. The function becomes essentially a pass-through:

```js
// V1 words = primary transcript (with disfluencies preserved)
const validatedWords = reverb.verbatim.words.map(w => ({
  ...w,
  crossValidation: 'pending',
  _reverbStartTime: w.startTime,
  _reverbEndTime: w.endTime
}));
```

### Keep unchanged:
- `runKitchenSinkPipeline()` entry point and Reverb + Parakeet parallel calls
- The return contract: `{ words, source, reverb, xvalRaw, disfluencyStats }`
- Raw V0/V1/Parakeet data preserved in `_kitchenSink` (already exists at app.js line 383-388)
- `runXvalFallback()` (Reverb-offline fallback)
- `disfluencyStats` — recompute after alignment in app.js instead

---

## Phase 3: Delete V2/V3 collapse from app.js

**File:** `js/app.js`

### Delete entirely:
- **V2 collapse block** (lines 431-520): The `while (i < transcriptWords.length)` loop that merges `_divergence` fragments using V0's `cleanTarget`
- **V3 collapse block** (lines 522-637): The `alignTranscripts(v2Pseudo, refPseudo)` and divergence block collapse using reference targets
- **Path 4 divergence struggle** (lines 1217-1260): The `_v2Merged`/`_v3Merged` check that reclassifies compound collapses as struggle. Replaced by multi-engine comparison.

### Keep:
- **Fragment pre-merge** (lines 639-704): Apply to V1 words before alignment. Handles ≤4-char adjacent words ≤300ms apart whose concatenation matches a reference word. No changes needed.
- **`parseT()` helper** (line 429)

---

## Phase 4: Three independent reference alignments

**File:** `js/app.js` — replace the single `alignWords()` call (line 833) with three

### 4a. V1 alignment (primary — drives display, tooltips, audio)
```js
const v1Alignment = alignWords(referenceText, transcriptWords); // transcriptWords = raw V1
```
- Fragment pre-merge runs BEFORE this (already in place)
- Compound merge, abbreviation merge, contraction merge all run inside `alignWords()`
- `hypIndex` maps to V1 word objects (for sttLookup, audio playback)

### 4b. V0 alignment
```js
const v0Words = data._kitchenSink?.reverbCleanWords || [];
const v0Alignment = v0Words.length > 0 ? alignWords(referenceText, v0Words) : null;
```

### 4c. Parakeet alignment (already exists — line 902-903)
```js
const parakeetWords = data._kitchenSink?.xvalRawWords || [];
const parakeetAlignment = parakeetWords.length > 0
  ? alignWords(referenceText, parakeetWords) : null;
```

### 4d. Per-ref-word 3-way comparison

Filter insertions from each alignment to get ref-entry arrays (same invariant as Plan 5):
```js
const v1Ref = v1Alignment.filter(e => e.type !== 'insertion');
const v0Ref = v0Alignment?.filter(e => e.type !== 'insertion') || [];
const pkRef = parakeetAlignment?.filter(e => e.type !== 'insertion') || [];
// All three arrays have same length (= ref word count)
```

**Decision matrix per ref word:**

| Scenario | Final Type | Rationale |
|---|---|---|
| 2+ engines correct | `correct` + `confirmed` | Majority agrees |
| V1 correct only | `correct` + `unconfirmed` | Only V1 heard it |
| V1 sub + Pk correct | `correct` + `disagreed` | Pk is strong engine; mark potential struggle |
| V1 sub + V0 correct + Pk sub | `correct` + `disagreed` | V0 provides tiebreak |
| All sub (same word) | `substitution` + `confirmed` | Consensus wrong word |
| All sub (diff words) | `substitution` + `disagreed` | Use V1's hyp, flag disagreement |
| 2+ engines omitted | `omission` | Consensus: student skipped it |
| V1 omitted + Pk heard | `correct` + `recovered` | Splice Parakeet's word (existing recovery logic) |
| V1 heard + Pk omitted | keep V1's type + `unconfirmed` | |

**Struggle detection (replaces Path 4):**
A word is `struggle` if it's ultimately correct BUT V1 shows evidence of difficulty:
- V1's alignment needed compound merge (fragments combined to correct word)
- V1 has a substitution for this ref word while V0 or Pk have correct
- V1 has insertions temporally adjacent to this ref word that V0 doesn't have (disfluency fragments)

### 4e. Override V1 alignment types with 3-way verdicts

Walk `v1Ref` array and override each entry's `type` and `crossValidation` based on the decision matrix. This produces the **final alignment** used for metrics and display.

Set on each entry:
- `crossValidation`: confirmed / disagreed / recovered / unconfirmed
- `_xvalStartTime`, `_xvalEndTime`: from Parakeet (best timestamps)
- `_xvalWord`: what Parakeet heard
- `_v0Word`: what V0 heard (new field, for tooltips)
- `_v0Type`: V0's alignment type for this ref word (new field)

### 4f. Disfluency classification (replaces kitchen-sink divergence blocks)

After all 3 alignments, classify V1 insertions:
```
V1 insertions = v1Alignment.filter(e => e.type === 'insertion')
V0 insertions = v0Alignment?.filter(e => e.type === 'insertion') || []
```
- V1 insertion present + V0 insertion absent → **filler/false-start** (V0's clean decoder suppressed it)
- V1 insertion present + V0 insertion present → **genuine extra word**
- V1 insertion is a known filler ("uh", "um") → **filler** (already filtered from alignment, tracked separately)
- V1 insertion is near-miss to adjacent ref word → **false start / struggle fragment**

Set `isDisfluency` and `disfluencyType` on the corresponding V1 transcriptWord.

### 4g. Omission recovery (keep existing logic)

Existing recovery logic (app.js ~line 1100-1165) splices recovered words into transcriptWords and adjusts hypIndex. Works the same way — just driven by the 3-way comparison instead of 2-way.

---

## Phase 5: Update sttLookup and downstream

**File:** `js/app.js`

### sttLookup (line 822-831)
No changes needed — it's built from `transcriptWords` (now raw V1) before alignment. Key normalization already strips trailing hyphens. Works as-is.

### Diagnostics (near-miss resolution, fragment absorption)
- `resolveNearMissClusters()`: operates on alignment entries. No changes — alignment entries have same shape.
- `absorbMispronunciationFragments()`: uses `hypIndex` for temporal containment. Works as-is with corrected `hypIndex`.
- `detectStruggleWords()`: Path 1 (hesitation) and Path 3 (abandoned) still work. Path 4 (divergence) is replaced by Phase 4 struggle detection.

### Metrics computation
- Accuracy: count correct / ref words from final alignment (overridden types). No changes.
- WCPM: uses timing from alignment. No changes.
- Word speed map: uses xval timestamps. No changes.

---

## Phase 6: Redesign STT Transcript UI

**File:** `js/ui.js` (lines 1405-2154)

### Delete:
- **Step 1** (lines 1483-1742): V0/V1/V2 comparison table with v2div/v3div blocks
- All references to `_divergence`, `_v2Merged`, `_v3Merged`, `_v2OriginalFragments`, `_v3OriginalFragments`

### New Step 1: Three-Engine Consensus Table

Single table showing all engines' alignment to reference:

| # | Reference | V1 (Verbatim) | V0 (Clean) | Parakeet | Verdict |
|---|-----------|----------------|------------|----------|---------|
| 1 | however | however | however | however | confirmed |
| 2 | spreadsheet | spread [+sheet] | spreadsheet | spreadsheet | struggle |
| 3 | your | yourense | yourense | your | correct (Pk) |
| 4 | content's | — (omitted) | — (absorbed) | con+tense | recovered |

Cell colors:
- Green: engine matched reference (correct)
- Orange: engine produced different word (substitution) — show what it heard
- Red: engine missed the word (omission)
- Purple: compound merge (fragments combined to correct) — show fragments

Verdict column: badge with confirmed/disagreed/recovered/unconfirmed + struggle icon if applicable.

Data source: pass `v1Alignment`, `v0Alignment`, `parakeetAlignment` (all ref-filtered) plus the final verdicts to the rendering function via `rawSttSources`.

### New Step 2: Disfluency Detection

Table showing V1-specific insertions classified by V0 comparison:

| Word | Time | Type | Evidence |
|------|------|------|----------|
| ex- | 11.55s | false start | V0 suppressed; near-miss to "excel" |
| uh | 20.58s | filler | V0 suppressed |
| uh | 31.58s | filler | V0 suppressed |

### New Step 3: Post-Processing (keep similar to current Step 4)

- Compound merges
- Self-corrections
- Struggle words with multi-engine evidence
- Near-miss fragments

### Delete CSS:
- `.pipeline-td-v0-match`, `.pipeline-td-v1-diff`, `.pipeline-td-v2-result`, `.pipeline-td-v3-frag`
- `.pipeline-v012-badge-v2`, `.pipeline-v012-badge-v3`
- `.pipeline-v012-ref-note`, `.pipeline-v012-frag-sep`

### Add CSS:
- `.engine-correct` (green), `.engine-sub` (orange), `.engine-omit` (red)
- `.engine-compound` (purple, for compound-merged fragments)
- `.verdict-badge` variants for confirmed/disagreed/recovered/unconfirmed
- `.verdict-struggle` icon/badge

---

## Phase 7: Update tooltips

**File:** `js/ui.js` — `buildEnhancedTooltip()` (lines 261-428)

### Remove:
- `_divergence` block tooltip text (lines 351-365, 383-398)
- V2/V3 merge references

### Add:
- **Multi-engine view**: "V1 heard: X | V0 heard: Y | Parakeet heard: Z"
- **Verdict**: "confirmed by 3/3 engines" or "V1 disagreed; Parakeet confirmed"
- **Struggle evidence**: if compound merge, show "V1 produced [fragments] for this word"

Data: read from new fields on alignment entries (`_v0Word`, `_v0Type`, `_xvalWord`, `crossValidation`).

---

## Phase 8: Update miscue registry

**File:** `js/miscue-registry.js`

Update the `struggle` entry to document the new multi-engine fragment detection replacing V2/V3 divergence Path 4. Update detector location from "app.js Path 4 + V2/V3" to "app.js 3-way comparison".

---

## Phase 9: Clean up dead code

### Delete from fields/flags (all files):
- `_divergence`, `_v2Merged`, `_v2OriginalFragments`, `_v3Merged`, `_v3OriginalFragments`, `_v3RefTarget`
- `_divergenceSource` on alignment entries
- `disfluencyType: 'struggle' | 'mismatch'` from kitchen-sink (replaced by per-word disfluency classification)

### Delete from `js/kitchen-sink-merger.js`:
- `buildMergedWordsFromAlignment()` function
- Import of `alignTranscripts` from sequence-aligner.js (if no longer used elsewhere)

### Delete from `js/app.js`:
- `v2_divergence_collapse` debug stage
- `v3_reference_anchor` debug stage
- `divergence_struggle` debug stage

### Add debug stages:
- `v1_alignment`: V1-to-ref alignment summary
- `v0_alignment`: V0-to-ref alignment summary
- `three_way_verdict`: per-ref-word comparison results

---

## Verification

1. **Run the same recording from the debug JSON** — the "yourense" case:
   - Verify "your" is now correctly identified (V1 + Parakeet both say "your")
   - Verify "content's" shows as struggled/substitution (V1: "conense", Pk: "con"+"tense")
   - Verify "spreadsheet" still detected as struggle (V1 compound merge: "spread"+"sheet")
   - Verify "shareable" struggle detected (V1: sub("share") + insertions, Pk: correct)

2. **Check disfluencies**: "uh" and "ex-" insertions properly classified as fillers/false-starts

3. **Check metrics**: accuracy should improve (fewer false errors from V0 boundary mistakes)

4. **Check STT Transcript UI**: new 3-engine table renders correctly with color-coded cells

5. **Test fallback**: disable Reverb → Parakeet-only fallback still works (1-engine alignment)

6. **Test with a clean reading** (no errors): all 3 engines agree, all confirmed, no false struggles

---

## Files Modified (summary)

| File | Action |
|------|--------|
| `js/alignment.js` | Fix `hypIndex` to map through disfluency filter to original indices |
| `js/kitchen-sink-merger.js` | Delete `buildMergedWordsFromAlignment()`, V0/V1 alignment; return raw V1 |
| `js/app.js` | Delete V2/V3/Path4; add 3 independent alignments + decision matrix + disfluency classification |
| `js/ui.js` | Replace Step 1 V0/V1/V2 table with 3-engine consensus table; update tooltips |
| `style.css` | Replace pipeline CSS classes |
| `js/miscue-registry.js` | Update struggle detector documentation |
| `index.html` | Update version timestamp |
