# Fix: V3 Reference Alignment Gap Penalty Mismatch

## Bug

V3 reference-anchor collapsing catastrophically fails when the reference text contains OCR noise (junk words from adjacent columns/margins). Instead of aligning the student's spoken words to the correct reference region, the aligner anchors on wrong words in the OCR preamble, then creates a massive divergence block that expands 4 spoken fragments into 33 phantom reference words.

**Example:** Student reads "However, it's perfectly fine to start out..." but the OCR reference starts with 28 junk words (`ack in / goals / Hience / nning / ... / THE CONTENT CALENDAR / However, ...`). The aligner mismatches "however" with the OCR fragment "how" at position ~6 instead of matching it with "however" at position ~30.

**Result:** 2.9% accuracy (should be ~80%), 33 false struggles, 14 false insertions, "however" classified as insertion.

## Root Cause

V3 (`app.js:549`) calls `alignTranscripts(v2Pseudo, refPseudo)` from `sequence-aligner.js` **with default parameters**:

```javascript
const v3Alignment = alignV3(v2Pseudo, refPseudo);  // uses default options
```

The default options were tuned for **V0/V1 alignment** (two similar-length Reverb transcripts):

```javascript
const DEFAULT_OPTIONS = {
  match: 2,
  mismatch: -1,
  gapInsert: -1,   // V2 word not in ref = disfluency (expected, cheap)
  gapDelete: -2    // Ref word not in V2 = rare, penalize more
};
```

But V3's use case is **fundamentally different** — it aligns ~30 spoken words against ~368 reference words:

| Gap type | V0/V1 meaning | V3 meaning | Correct cost |
|----------|---------------|------------|--------------|
| gapInsert (V2 word unmatched) | Disfluency — expected | Student said a non-ref word — rare | Higher |
| gapDelete (ref word unmatched) | Word missing from verbatim — rare | Student didn't read this ref word — **expected, massive** | **Lower** |

The asymmetry is backwards for V3. With `gapDelete = -2`:
- Skipping 28 OCR junk words to reach "however" = 28 × (-2) = **-56 penalty**
- Mismatching "however" ↔ "how" (OCR fragment at position ~6) = 5 × (-2) + (-1) = **-11 penalty**
- The aligner prefers the wrong match by **45 points**

Once "however" anchors at the wrong position, every subsequent word cascades into the wrong alignment. The entire student transcript becomes insertions, and the final divergence block expands 4 fragments into 33 phantom words.

## Why This Hasn't Happened Before

Two conditions must coincide:
1. **OCR reference text** with junk words preceding the actual passage (provides false match targets)
2. **Student reads only a small portion** of a long reference (30 words vs 368 = 8% coverage)

Clean teacher-typed reference text wouldn't have the OCR preamble, so even with `gapDelete = -2`, there would be no false targets to anchor on.

## Fix

### 1. Custom gap penalties for V3 alignment

**File:** `js/app.js`, line 549

Pass V3-appropriate scoring to the aligner. Since most ref words SHOULD be skipped (student reads a fraction of the reference), ref-word-deletion must be cheap:

```javascript
// BEFORE:
const v3Alignment = alignV3(v2Pseudo, refPseudo);

// AFTER:
const v3Alignment = alignV3(v2Pseudo, refPseudo, {
  gapDelete: -0.5   // Ref deletions are expected (student reads a portion)
});
```

**Why -0.5:**
- With `gapDelete = -0.5`, skipping 28 OCR junk words costs **-14** (not -56)
- Matching "however" ↔ "however" at ref position 30: cost = 29 × (-0.5) + 2 = **-12.5**
- Mismatching "however" ↔ "how" at ref position 6: cost = 5 × (-0.5) + (-1) = **-3.5**
- But from position 6, subsequent matches are much harder (real words are at position 30+)
- The global optimal path clearly favors skipping to position 30 and matching the real content

**Normal V3 cases are unaffected:** For "cone"+"tent" vs "content", the anchors ("your", "in") are adjacent — no junk to skip. Lower gapDelete doesn't change anchor positions when the sequences already align well.

### 2. Ratio guard as safety net

**File:** `js/app.js`, line 584

Add a guard against catastrophic expansion even if the alignment somehow still produces a bad divergence block:

```javascript
// BEFORE:
if (refTargets.length > 0 && frags.length >= 2) {

// AFTER:
if (refTargets.length > 0 && frags.length >= 2 && refTargets.length <= frags.length * 3) {
```

**Rationale:** A legitimate V3 collapse maps N spoken fragments to ~N reference words (e.g., 2 fragments → 1-2 ref words). A ratio above 3:1 means the alignment found a divergence block where the reference has 3× more words than the student spoke — this is never a real word-splitting scenario. Pass fragments through unchanged and let the main NW alignment handle them normally.

### 3. Version bumps

- `index.html` — version timestamp
- `sw.js` — cache version

## Files to Modify

1. `js/app.js` (~line 549) — pass `{ gapDelete: -0.5 }` to V3 alignment call
2. `js/app.js` (~line 584) — add ratio guard `refTargets.length <= frags.length * 3`
3. `index.html` — version bump
4. `sw.js` — cache version bump

## Verification

1. **OCR noise case** (this bug): Re-run the "However, it's perfectly fine..." passage with the OCR-junk reference. "However" should anchor correctly. No phantom words. Accuracy should be ~80%+.
2. **Normal V3 case** ("cone"+"tent" → "content"): Should still collapse correctly. Anchor coverage unchanged.
3. **V2+V3 mixed case** ("throughout year" / "throughout your"): V2 collapse + V3 collapse should still work, and Step 1 table should show V0/V1 differences correctly.
4. **Long reference, partial read** (student reads 1 paragraph of a 3-page passage): V3 should skip unread reference gracefully without creating phantom words.

## Alternatives Considered

| Option | Verdict | Reason |
|--------|---------|--------|
| Equalize penalties (gapDelete = -1) | Partial fix | Better but may not be sufficient for very long references |
| Boost match score (+4) | Rejected | Global change, could cause false anchors on common words |
| Trim reference before V3 | Over-engineered | Requires "how far did the reader get" heuristic; gap penalty fix achieves the same effect more simply |
| Anchor coverage gate (skip V3 if < 40% anchors) | Rejected alone | Doesn't fix the alignment; just skips V3 entirely when it could still provide useful collapses |
| Semi-global alignment (no end-gap penalties) | Theoretically ideal | Requires new NW variant; gapDelete = -0.5 approximates this cheaply |
