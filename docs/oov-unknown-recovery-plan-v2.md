# OOV `<unknown>` Recovery — Implementation Plan v2

*Corrected rewrite of `oov-unknown-recovery-plan.md`. All line numbers, pipeline positions, and code samples verified against the codebase as of 2026-02-14.*

## Problem Statement

When a student attempts an out-of-vocabulary (OOV) word like "cayuco" (Spanish), the ASR engines cannot decode it. Reverb's CTC model emits `<unknown>` tokens as evidence the student vocalized, but NW alignment greedily assigns those `<unknown>` tokens to adjacent reference words instead of the OOV word. This creates a cascade of false errors:

**Current behavior** (from real Student 1 recording):
```
ref="cayuco" → omission          (1 error — OOV, student attempted it)
ref="a"      → hyp="unknown"     (1 error — false! <unknown> was cayuco attempt)
ref="small"  → hyp="unknown"     (error → Parakeet overrode to correct, but fragile)
```
Student punished with 2 errors for ~1 actual event.

**Desired behavior:**
```
ref="cayuco" → hyp="unknown"  (OOV-excluded — excluded from assessment)
ref="a"      → forgiven        (blast radius — function word adjacent to OOV struggle)
ref="small"  → correct          (Parakeet confirmed)
```
Student punished with 0 errors. WCPM credited back the ~2.88s OOV struggle time.

## Design Principles

1. **ASR artifacts are not student errors.** An English ASR cannot decode Spanish/foreign words. This is a tool limitation, not a student limitation.
2. **OOV phonetic match (path 1) stays "correct."** If the ASR heard recognizable fragments and phonetic similarity >= 0.6, the student successfully read the word — counts as correct, time counts normally.
3. **OOV `<unknown>` recovery (path 2) = excluded.** If the ASR couldn't decode at all, we can't credit OR penalize. The word is excluded from assessment, and the student is credited back the struggle time.
4. **Blast radius from existing patterns.** Reuse post-struggle leniency logic for collateral damage to adjacent words.

---

## Verified Pipeline Order

The actual execution order in `runAnalysis()` (app.js), with new stages marked:

```
kitchen-sink                                          (line 303)
  → fragment pre-merge                                (line 520)
  → 3 independent ref alignments (V1, V0, Parakeet)  (lines 712-763)
  → spillover consolidation                           (line 765)
  → compound struggle reclassification                (line 793)
  → 3-way verdict (cross-validation)                  (line 849)
  → filler classification                             (line 1057)
  → confirmed insertion cross-validation              (line 1085)
  → CTC artifact flagging                             (line 1173)
  → omission recovery                                 (line 1229)
  → xval abbreviation confirmation                    (line 1307)
  → near-miss resolution                              (line 1339)
  → fragment absorption                               (line 1360)
  → diagnostics                                       (line 1369)
  → self-correction reclassification                  (line 1441)
  → NL annotation mapping + proper noun forgiveness   (line 1477)
  → OOV detection (CMUdict lookup)                    (line 1721)
  → OOV phonetic forgiveness (path 1)                 (line 1748)
  → [NEW] OOV <unknown> reassignment (Part 1)         ← steals <unknown> from donors
  → [MODIFIED] OOV omission recovery (path 2)         (line 1812) ← now sets _oovExcluded
  → [NEW] OOV <unknown> exclusion (Part 2)            ← catches remaining subs from Part 1
  → timing adjustment                                 (line 1877)
  → [NEW] OOV time credit (Part 2b)                   ← subtract OOV time
  → clear confirmed insertions on excluded types      (line 1899)
  → [NEW] single-letter function word forgiveness (Part 4)
  → post-struggle leniency [MODIFIED] (Part 3)        (line 1915)
  → metrics (WCPM, accuracy)                          (line 1952)
  → prosody metrics                                   (line 1993)
```

**Key ordering facts:**
- CTC artifact flagging runs BEFORE omission recovery (not after as claimed in v1 plan)
- Near-miss resolution runs BEFORE OOV detection (not after as claimed in v1 plan)
- Confirmed insertion xval runs BEFORE omission recovery (not after as claimed in v1 plan)
- Post-struggle leniency runs BEFORE metrics (not after as claimed in v1 plan)
- **Part 1 inserts BEFORE existing path 2** (between line 1806 and 1812) — this is critical so Part 1 can steal donors before existing path 2 forgives the OOV omission
- Part 4 inserts BEFORE post-struggle leniency, so leniency can see the forgiveness

**Why Part 1 must run BEFORE existing path 2:**
If existing path 2 runs first, it finds the OOV omission, detects `<unknown>` tokens in the temporal window (they exist in `transcriptWords` regardless of alignment), and sets `forgiven = true`. Part 1 then sees `forgiven = true` and skips the entry — the donor words (e.g., "a" with `hyp="unknown"`) are never cleaned up and remain as false errors. By running Part 1 first, we steal the `<unknown>` from the donor, converting the OOV omission to a substitution. Existing path 2 then skips it (`type !== 'omission'`), and Part 2 handles exclusion.

---

## Part 1: Post-Alignment `<unknown>` Reassignment

### What
After OOV phonetic forgiveness (path 1) but BEFORE existing OOV omission recovery (path 2), scan for OOV omissions that have nearby alignment entries with `hyp` originating from a `<unknown>` CTC token. Steal the `<unknown>` from the donor and assign it to the OOV word.

### Where
`js/app.js` — new block BETWEEN the OOV phonetic forgiveness loop (after line 1806) and the existing OOV omission recovery loop (before line 1812).

### Logic
```javascript
// ── OOV <unknown> reassignment ────────────────────────────────────
// After NW alignment, <unknown> tokens may be assigned to wrong ref
// words (e.g., ref="a" gets hyp="unknown" instead of ref="cayuco").
// Multiple <unknown> tokens near an OOV word are fragments of the
// SAME vocalization attempt — they all belong to the OOV word.
// Steal ALL <unknown> donors within ±3, not just the closest.
// MUST run before existing OOV omission recovery (line 1812) so that
// donors are cleaned up before path 2 forgives the OOV entry.
for (let i = 0; i < alignment.length; i++) {
  const entry = alignment[i];
  if (!entry._isOOV || entry.type !== 'omission' || entry.forgiven) continue;

  // Find ALL <unknown> donors within ±3 ref positions
  const SCAN_RADIUS = 3;
  const donors = [];

  for (let d = -SCAN_RADIUS; d <= SCAN_RADIUS; d++) {
    if (d === 0) continue;
    const j = i + d;
    if (j < 0 || j >= alignment.length) continue;
    const candidate = alignment[j];
    if (candidate.type === 'insertion') continue;
    if (candidate.type === 'correct') continue; // already resolved as correct — don't undo
    // If another engine heard this word correctly, the <unknown> is V1's CTC confusion,
    // not the OOV word's vocalization. The 3-way verdict sets crossValidation='disagreed'
    // but does NOT change V1's type — so we must check engine types directly.
    if (candidate._pkType === 'correct' || candidate._v0Type === 'correct') continue;
    if (candidate._isOOV) continue;             // don't steal from another OOV word
    if (candidate.forgiven) continue;            // don't steal from already-resolved entries
    if (candidate.hyp !== 'unknown') continue;

    // CRITICAL: verify the hyp actually came from a <unknown> CTC token,
    // not the English word "unknown"
    if (candidate.hypIndex < 0) continue;
    const tw = transcriptWords[candidate.hypIndex];
    if (!(typeof tw?.word === 'string' && tw.word.startsWith('<') && tw.word.endsWith('>'))) continue;
    // Skip CTC artifacts — these are false onsets, not student speech
    if (tw._ctcArtifact) continue;

    donors.push({ candidate, dist: Math.abs(d) });
  }

  if (donors.length === 0) continue;

  // Sort by distance — assign closest donor's hypIndex to the OOV entry
  donors.sort((a, b) => a.dist - b.dist);
  const closest = donors[0].candidate;

  // OOV entry gets one <unknown> hyp (enough to trigger Part 2 exclusion)
  entry.hyp = 'unknown';
  entry.type = 'substitution';
  entry.hypIndex = closest.hypIndex;

  // ALL donors lose their hyp — become omissions.
  // Multiple <unknown> tokens near an OOV word are fragments of the
  // same vocalization attempt, not independent hearings of different words.
  for (const { candidate } of donors) {
    candidate.hyp = null;
    candidate.type = 'omission';
    candidate.hypIndex = -1;
    // Clear cross-validation metadata that no longer applies
    delete candidate._v0Word;
    delete candidate._v0Type;
    delete candidate._xvalWord;
    delete candidate._pkType;
    delete candidate.crossValidation;
    candidate._oovCollateralOmission = true;
  }
}
```

### Guard Rails
- **Raw token check**: Verify `transcriptWords[hypIndex].word` matches `<...>` pattern. Prevents stealing the real English word "unknown" from a passage containing it.
- **CTC artifact check**: Skip `<unknown>` tokens flagged `_ctcArtifact` (<=120ms, overlapping confirmed word). These are false CTC onsets, not evidence of student speech.
- **No correct donors**: Skip entries where `type === 'correct'`, OR where `_pkType === 'correct'` / `_v0Type === 'correct'`. The 3-way verdict sets `crossValidation='disagreed'` but does NOT change V1's `type` from 'substitution' — so checking `type === 'correct'` alone misses disagreed entries where Parakeet/V0 heard the word correctly. If any engine confirmed the word at this ref position, the `<unknown>` hyp is V1's CTC confusion, not evidence of the OOV word's vocalization.
- **No cross-OOV theft**: Skip candidates that are themselves `_isOOV`. Two adjacent OOV words each keep their own alignment.
- **Scan radius of 3**: OOV impact shouldn't extend far.
- **No forgiven donors**: Don't undo work from proper noun forgiveness or other paths.

### Why Steal ALL Donors, Not Just the Closest
Multiple `<unknown>` tokens near an OOV word are fragments of the **same vocalization attempt**. When a student says "cayuco," Reverb's CTC decoder may emit 2-3 `<unknown>` tokens spanning the duration of the attempt. NW then greedily distributes these across adjacent ref slots. Each `<unknown>` donor represents a piece of the OOV attempt, not an independent hearing of the donor's ref word.

Only one `<unknown>` is assigned to the OOV entry (closest, for the hypIndex). But ALL donors are converted to omissions because their hyps were never about their own ref words — they were all fragments of the OOV attempt.

### Donor Metadata Cleanup
When converting a donor to an omission, its `_v0Word`, `_v0Type`, `_xvalWord`, `_pkType`, and `crossValidation` fields are stale (they described the donor's original ref-hyp pairing, which was based on NW's incorrect `<unknown>` assignment). These are deleted to prevent downstream code from acting on obsolete data.

### Impact on Downstream
- After reassignment, `ref="cayuco" → hyp="unknown"` is now a substitution
- The OOV entry is now `type='substitution'`, so existing path 2 (line 1812, checks `type !== 'omission'`) skips it
- Part 2 catches it instead and sets `_oovExcluded`
- ALL donor entries (e.g., `ref="a"`, `ref="small"`) are now omissions with `_oovCollateralOmission`:
  - Part 4 may forgive single-letter function words ("a", "I")
  - Post-struggle leniency (Part 3) does NOT help omissions (it only promotes substitutions) — but omissions from multi-donor stealing are genuinely unheard words (V1 had `<unknown>`, which was the OOV attempt). If Parakeet heard the word correctly, the 3-way verdict already set `type='correct'` and the `type === 'correct'` guard prevented stealing.
  - Donors that remain as unforgiven omissions are words no engine confidently heard — a conservative but defensible outcome

---

## Modification to Existing Path 2 (line 1812)

### What
The existing OOV omission recovery (lines 1812-1867) handles OOV omissions where Part 1 couldn't find a donor — e.g., all `<unknown>` tokens are insertions in the alignment or beyond ±3 positions. Currently it sets `forgiven = true` (counted as `correctCount++`). This must also set `_oovExcluded = true` to align with the design principle: "we can't credit OR penalize."

### Change
At line 1861, add `_oovExcluded`:

```javascript
if (unknownCount > 0) {
  entry.forgiven = true;
  entry._oovExcluded = true;       // ADD: exclude from assessment, not count as correct
  entry._oovForgiven = true;
  entry._oovRecoveredViaUnknown = true;
  entry._unknownTokenCount = unknownCount;
  oovLog.push({ ref: entry.ref, type: 'omission_recovered', unknownTokens: unknownCount, forgiven: true });
}
```

### Why This Is Needed
Without this change, two identical situations get different treatment:
- **Path A** (Part 1 found donor): OOV entry → Part 2 → `_oovExcluded` (excluded from assessment)
- **Path B** (no donor found): OOV entry → existing path 2 → `forgiven` only (counted as correct)

Both represent the same reality: ASR couldn't decode, student vocalized. Principle 3 says both should be excluded.

---

## Part 2: OOV-Excluded Flag — Exclude from Assessment

### What
After existing path 2, catch any remaining OOV substitutions with `hyp="unknown"` that were created by Part 1 (reassignment) but not yet handled by existing path 2 (which only handles omissions). Mark them as **excluded from assessment**.

### Where
`js/app.js` — immediately after the existing OOV forgiveness block (after line 1875), before timing adjustment (line 1877).

### Logic
```javascript
// ── OOV exclusion (Part 2) ───────────────────────────────────────
// Catch OOV substitutions created by Part 1 (reassignment).
// Existing path 2 only handles omissions — this handles subs.
// ASR couldn't decode → can't credit or penalize. Exclude entirely.
for (const entry of alignment) {
  if (!entry._isOOV) continue;
  if (entry.type !== 'substitution') continue;
  if (entry.forgiven) continue;
  if (entry.hyp !== 'unknown') continue;

  // Verify hyp is from <unknown> token (same guard as Part 1)
  if (entry.hypIndex >= 0) {
    const tw = transcriptWords[entry.hypIndex];
    if (!(typeof tw?.word === 'string' && tw.word.startsWith('<') && tw.word.endsWith('>'))) continue;
  }

  entry._oovExcluded = true;
  entry.forgiven = true;
  entry._oovForgiven = true;
}
```

### Flags
```javascript
entry._oovExcluded = true;    // new: word excluded from assessment entirely
entry.forgiven = true;         // existing: drives UI + metrics skip
entry._oovForgiven = true;     // existing: OOV forgiveness family
```

### Part 2b: Time Credit

After OOV exclusion, subtract the struggle time from `effectiveElapsedSeconds`. Insert AFTER the timing adjustment block (line 1897), BEFORE the clear-confirmed-insertions block (line 1899).

```javascript
// ── OOV time credit ───────────────────────────────────────────────
// For OOV-excluded words, credit back the time the student spent
// struggling with a word the ASR couldn't decode.
let oovTimeCreditSeconds = 0;
{
  let i = 0;
  while (i < alignment.length) {
    const entry = alignment[i];
    if (!entry._oovExcluded) { i++; continue; }

    // Find the OOV cluster: contiguous _oovExcluded entries
    let clusterEnd = i;
    while (clusterEnd + 1 < alignment.length && alignment[clusterEnd + 1]._oovExcluded) {
      clusterEnd++;
    }

    // Find temporal boundaries: last confirmed word before cluster,
    // first confirmed word after cluster
    let gapStart = null, gapEnd = null;

    for (let j = i - 1; j >= 0; j--) {
      if (alignment[j].type === 'insertion') continue;
      if (alignment[j].hypIndex >= 0 && !alignment[j]._oovExcluded) {
        gapStart = parseT(transcriptWords[alignment[j].hypIndex].endTime);
        break;
      }
    }
    for (let j = clusterEnd + 1; j < alignment.length; j++) {
      if (alignment[j].type === 'insertion') continue;
      if (alignment[j].hypIndex >= 0 && !alignment[j]._oovExcluded) {
        gapEnd = parseT(transcriptWords[alignment[j].hypIndex].startTime);
        break;
      }
    }

    if (gapStart !== null && gapEnd !== null && gapEnd > gapStart) {
      oovTimeCreditSeconds += (gapEnd - gapStart);
    }

    // Skip past the entire cluster to avoid double-counting
    i = clusterEnd + 1;
  }
}
if (oovTimeCreditSeconds > 0) {
  effectiveElapsedSeconds -= oovTimeCreditSeconds;
  addStage('oov_time_credit', {
    creditSeconds: Math.round(oovTimeCreditSeconds * 100) / 100,
    adjustedElapsed: Math.round(effectiveElapsedSeconds * 100) / 100
  });
}
```

**Double-counting fix**: The outer `while` loop advances `i` past the entire OOV cluster (`i = clusterEnd + 1`), so adjacent OOV words share one time window. This was a bug in v1 where each OOV entry independently scanned for the same boundaries.

### Metrics Changes (`js/metrics.js`)

#### `computeAccuracy()` (line 27)

Skip `_oovExcluded` entries entirely — they count as neither correct nor error:

```javascript
for (const w of alignmentResult) {
  if (w._oovExcluded) { forgiven++; continue; }  // excluded from all counts
  switch (w.type) {
    // ... existing cases unchanged
  }
}
```

This is the correct approach. The alternative (counting in `correctCount` then subtracting from `totalRefWords`) creates an inconsistency where `correctCount` includes the entry but `totalRefWords` doesn't.

#### `computeWCPMRange()` (line 85)

No changes needed. It filters for `w.type === 'correct'`, and `_oovExcluded` entries have `type: 'substitution'`, so they're already excluded from WCPM numerator. The adjusted `effectiveElapsedSeconds` (with OOV time credit subtracted) is passed as the denominator.

---

## Part 3: Post-Struggle Leniency Extension

### What
Extend the existing post-struggle Parakeet leniency (app.js lines 1915-1950) to recognize OOV-excluded words as error triggers. Currently, `prevRefWasError` is set when `(type === 'substitution' || type === 'struggle' || type === 'omission') && !entry.forgiven`. Since OOV-excluded entries ARE forgiven, the leniency trigger doesn't fire.

### Where
`js/app.js` line 1942-1943 — modify the `prevRefWasError` update.

### Fix
```javascript
// Update trigger for next word
// Collateral damage entries (function word / OOV collateral) are transparent —
// they were caught in the blast radius and shouldn't consume the leniency window.
if (!entry._functionWordCollateral && !entry._oovCollateralOmission) {
  prevRefWasError = (entry.type === 'substitution' || entry.type === 'struggle'
                     || entry.type === 'omission') && !entry.forgiven;
  // OOV-excluded words also trigger leniency — Reverb was off-track during OOV struggle
  if (entry._oovExcluded) prevRefWasError = true;
}
```

### What This Gives
The word after an OOV-excluded word gets the same one-word leniency as after any other error. Conditions for promotion (line 1932-1935):
1. `prevRefWasError` is true
2. Entry is a `substitution`
3. `crossValidation === 'disagreed'` (Parakeet disagreed with Reverb)
4. Parakeet's alignment entry is `type: 'correct'`

If all four hold, entry is promoted to `type: 'correct'` with `_postStruggleLeniency: true`.

### Collateral Transparency
Collateral damage entries (`_functionWordCollateral`, `_oovCollateralOmission`) are **transparent** to the leniency trigger — `prevRefWasError` passes through them unchanged. This is correct because:

1. Collateral entries are part of the OOV blast zone, not separate CTC recovery events
2. The leniency distance should be measured from the OOV to the first *real* word outside the blast zone
3. Promotion still requires Parakeet confirmation — extending the window just gives the *opportunity*, Parakeet is still the gatekeeper
4. Bounded scope: only "a"/"I" get `_functionWordCollateral`; only Part 1 donors get `_oovCollateralOmission`

Without transparency: cayuco → "a" (forgiven, resets trigger) → "small" gets NO leniency (wrong).
With transparency: cayuco → "a" (transparent) → "small" gets leniency → Parakeet confirms → promoted (correct).

### Why non-single-letter words don't need transparency
If the word between the OOV and the target is a multi-letter word like "the":
- If all engines missed it: it's an unforgiven omission → `(omission && !forgiven)` = true → **propagates leniency naturally**
- If Parakeet heard it: it gets promoted to correct via leniency (it's first in line) → resets trigger for the next word

Only forgiven collateral entries (single-letter function words from Part 4) would otherwise consume the trigger without propagating it. That's why transparency is scoped to `_functionWordCollateral` and `_oovCollateralOmission`.

### Interaction with Part 4
Part 4 (function word forgiveness) runs BEFORE post-struggle leniency. If the word after the OOV is a single-letter function word forgiven by Part 4, Part 4 sets `_functionWordCollateral = true`. Post-struggle leniency then treats it as transparent — `prevRefWasError` carries through to the next word.

---

## Part 4: Single-Letter Function Word Forgiveness

### What
When a single-letter function word (`a`, `I`) is omitted by ALL engines — and is adjacent to a struggle or OOV word — forgive it as collateral damage. These words are too short for ASR to reliably capture when the student is struggling with a nearby word.

### Where
`js/app.js` — new block AFTER the clear-confirmed-insertions block (line 1913), BEFORE post-struggle leniency (line 1915).

### Logic
```javascript
// ── Single-letter function word forgiveness ───────────────────────
// "a" and "I" are too short for ASR to capture when student is
// struggling with an adjacent word. Forgive if ALL engines missed it.
{
  const FUNCTION_LETTERS = new Set(['a', 'i']);
  const pkRefEntries = data._threeWay?.pkRef;
  const v0RefEntries = data._threeWay?.v0Ref;

  let refIdx = 0;
  for (let i = 0; i < alignment.length; i++) {
    const entry = alignment[i];
    if (entry.type === 'insertion') continue;
    // Track refIdx for _threeWay lookup (same pattern as post-struggle leniency)
    const currentRefIdx = refIdx;
    refIdx++;

    if (entry.type !== 'omission') continue;
    if (entry.forgiven) continue;
    if (!FUNCTION_LETTERS.has(entry.ref.toLowerCase())) continue;

    // Must be adjacent to a struggle, OOV, or error (in ref-word space, skip insertions)
    let prev = null;
    for (let j = i - 1; j >= 0; j--) {
      if (alignment[j].type !== 'insertion') { prev = alignment[j]; break; }
    }
    let next = null;
    for (let j = i + 1; j < alignment.length; j++) {
      if (alignment[j].type !== 'insertion') { next = alignment[j]; break; }
    }
    const adjacentStruggle =
      (prev && (prev._isOOV || prev.type === 'struggle' ||
                prev.type === 'substitution' || prev._oovExcluded)) ||
      (next && (next._isOOV || next.type === 'struggle' ||
                next.type === 'substitution' || next._oovExcluded));

    if (!adjacentStruggle) continue;

    // Verify ALL engines missed it (no engine heard this word at this position)
    const v0Entry = v0RefEntries?.[currentRefIdx];
    const pkEntry = pkRefEntries?.[currentRefIdx];
    const v1Omission = entry.type === 'omission';
    const v0Omission = !v0Entry || v0Entry.type === 'omission';
    const pkOmission = !pkEntry || pkEntry.type === 'omission';

    if (v1Omission && v0Omission && pkOmission) {
      entry.forgiven = true;
      entry._functionWordCollateral = true;
    }
  }
}
```

### refIdx Tracking
The plan uses the same `refIdx` counter pattern as post-struggle leniency (app.js line 1923-1944): increment for each non-insertion entry. This gives direct positional access into `data._threeWay.pkRef[refIdx]` and `data._threeWay.v0Ref[refIdx]` because all three arrays have identical length after filtering insertions (validated at line 901-903).

### Adjacent Entry Lookup
Uses backward/forward loops to find the nearest non-insertion entry, matching the codebase's standard pattern. This ensures adjacency is measured in reference-word space, not raw alignment-array space.

### Guard Rails
- **Only omissions** — if any engine produced a substitution for "a" (e.g., "the"), it's a real error
- **Only adjacent to struggle/OOV** — if "a" is omitted in fluent reading, it IS a real omission
- **All engines must agree** — if even one engine heard the word, don't auto-forgive
- **Only single-letter function words** — not "the", "is", etc. (those are long enough for ASR to catch reliably)

---

## UI Changes (`js/ui.js`)

### classifyWord() (line 615)

Currently returns `'correct'` for ALL forgiven entries (line 617). Replace with bucket routing:

```javascript
function classifyWord(entry, group, nextGroup) {
  if (group._isConfirmedInsertion) return 'confirmed-insertion';
  if (entry.forgiven) {
    if (entry._oovExcluded) return 'oov-excluded';
    if (entry._functionWordCollateral) return 'function-word-forgiven';
    return 'correct';  // proper noun forgiven, OOV phonetic match → still "correct"
  }
  if (entry.type === 'omission') return 'omitted';
  // ... rest unchanged
}
```

**Note**: Proper noun forgiveness and OOV phonetic forgiveness stay in the `'correct'` bucket — the student DID read the word, it just needed forgiveness for scoring. Only OOV-excluded and function-word-collateral get their own visual treatment because they represent assessment exclusions, not correct reads.

### BUCKET Map (line 678)

Add two new buckets:

```javascript
const BUCKET = {
  'correct':                 { label: 'Correct',                   color: '#2e7d32' },
  'oov-excluded':            { label: 'OOV Excluded',              color: '#4caf50' },  // NEW
  'function-word-forgiven':  { label: 'Forgiven',                  color: '#4caf50' },  // NEW
  'struggle-correct':        { label: 'Struggle but Correct',      color: '#558b2f' },
  'omitted':                 { label: 'Omitted',                   color: '#757575' },
  'attempted-struggled':     { label: 'Attempted but Struggled',   color: '#e65100' },
  'definite-struggle':       { label: 'Definite Struggle',         color: '#c62828' },
  'confirmed-substitution':  { label: 'Confirmed Substitution',    color: '#1565c0' },
  'confirmed-insertion':     { label: 'Confirmed Insertion',       color: '#6a1b9a' }
};
```

### CSS Classes

Both new buckets use the existing `.word-forgiven` class (style.css lines 125-126: dashed green border + checkmark) in addition to their bucket-specific background color. Apply `.word-forgiven` when rendering:

```javascript
if (bucket === 'oov-excluded' || bucket === 'function-word-forgiven') {
  span.classList.add('word-forgiven');
}
```

### LEGEND_TIPS

```javascript
'oov-excluded': 'OOV EXCLUDED\n' +
  'Out-of-vocabulary word excluded from scoring.\n\n' +
  'The reference word is not in the ASR vocabulary (not in CMUdict).\n' +
  'ASR emitted [unknown] tokens — student attempted the word but\n' +
  'ASR could not decode it. Time credited back to WCPM.\n\n' +
  'Does NOT count as correct or error — excluded entirely.',

'function-word-forgiven': 'FUNCTION WORD FORGIVEN\n' +
  'Single-letter word ("a", "I") forgiven as collateral.\n\n' +
  'All three engines missed this word, and it is adjacent to a\n' +
  'struggle or OOV word. Too short for ASR to capture reliably\n' +
  'when the student was struggling with a nearby word.\n\n' +
  'Does NOT count as an error.',
```

### WCPM Tooltip

Show the OOV time credit in the WCPM hover tooltip:

```
WCPM: 42.3  (XX correct / 57.12s × 60)
OOV time excluded: 2.88s
```

---

## Miscue Registry Updates (`js/miscue-registry.js`)

### Update existing entry: `oovOmissionRecovery`

Update to reflect that this path now sets `_oovExcluded` (excluded from assessment, not counted as correct):

```javascript
oovOmissionRecovery: {
  description: 'Out-of-vocabulary reference word scored as omission, but <unknown> CTC tokens exist in the temporal window — student vocalized something but ASR could not decode it. Excluded from assessment (neither correct nor error).',
  // ... existing config unchanged ...
  note: 'Now sets _oovExcluded: true in addition to forgiven: true. Word is excluded from assessment entirely (not counted as correct). Part 1 (reassignment) runs first and may convert the omission to a substitution by stealing a <unknown> from a donor — in that case this path skips the entry and Part 2 handles exclusion instead.'
}
```

### New entry: `oovExcluded`

```javascript
oovExcluded: {
  description: 'OOV word with <unknown> token that phonetic forgiveness could not match. Excluded from assessment entirely — neither correct nor error. Student attempted the word but ASR could not decode it.',
  detector: 'app.js → OOV exclusion block (Part 2, after existing OOV omission recovery)',
  countsAsError: false,
  config: {
    mechanism: 'OOV entry has hyp="unknown" from <unknown> token + phonetic match < 0.6',
    timeCredit: 'Gap between last confirmed word before and first confirmed word after OOV cluster',
    adjacentClustering: 'Adjacent OOV-excluded entries share one time window (no double-counting)'
  },
  example: {
    reference: 'cayuco',
    spoken: 'Reverb → <unknown> tokens, Parakeet → speech detected but undecodable',
    result: 'OOV-excluded (_oovExcluded: true), forgiven, time credited back'
  },
  guards: [
    'Reference word must be OOV (_isOOV: true)',
    'Entry must have hyp="unknown" from verified <unknown> CTC token',
    'Phonetic forgiveness (path 1) must not have fired',
    'Raw transcriptWords[hypIndex].word must match <...> pattern',
    'CTC artifacts excluded (_ctcArtifact tokens skipped in Part 1)'
  ],
  uiClass: 'word-forgiven',
  note: 'Appears with dashed green border + checkmark in analyzed words view. Tooltip explains OOV exclusion. Time credit reflected in WCPM tooltip. Two entry points: (1) Part 1 reassigns donor → Part 2 excludes the OOV substitution, (2) existing path 2 excludes the OOV omission directly when no donor found.'
}
```

### New entry: `functionWordCollateral`

```javascript
functionWordCollateral: {
  description: 'Single-letter function word ("a", "I") omitted by all engines and adjacent to OOV/struggle word. Forgiven as collateral damage — word too short for ASR when student struggling nearby.',
  detector: 'app.js → function word forgiveness block (Part 4, after clear-confirmed-insertions, before post-struggle leniency)',
  countsAsError: false,
  config: {
    FUNCTION_LETTERS: ['a', 'i'],
    requirement: 'Omitted by ALL engines (V1, V0, Parakeet) at this ref position',
    adjacency: 'Adjacent non-insertion ref entry must be OOV, struggle, substitution, or _oovExcluded'
  },
  example: {
    reference: 'cayuco a small',
    spoken: 'Reverb → [unknown tokens], Parakeet → no "a" detected',
    result: '"a" forgiven — all engines missed it, adjacent to OOV struggle'
  },
  guards: [
    'Reference word must be single letter: "a" or "I"',
    'Entry type must be omission',
    'ALL three engines must have omission at this ref position (checked via _threeWay)',
    'Must be adjacent (in ref-word space, skipping insertions) to OOV or struggle entry',
    'Entry must not already be forgiven'
  ],
  uiClass: 'word-forgiven',
  note: 'Uses _threeWay.pkRef[refIdx] and _threeWay.v0Ref[refIdx] for per-engine verification. refIdx tracked by incrementing counter for each non-insertion alignment entry (same pattern as post-struggle leniency at line 1923).'
}
```

---

## Files Changed

| File | Change |
|------|--------|
| `js/app.js` | Part 1: OOV `<unknown>` reassignment (between line 1806 and 1812). Existing path 2: add `_oovExcluded` (line 1861). Part 2: OOV exclusion for reassigned subs (after line 1875). Part 2b: OOV time credit (after line 1897). Part 3: extend leniency trigger (line 1942). Part 4: function word forgiveness (after line 1913). |
| `js/metrics.js` | `computeAccuracy()`: skip `_oovExcluded` entries with `continue` (line 30). |
| `js/ui.js` | `classifyWord()`: route forgiven entries to `oov-excluded` / `function-word-forgiven` buckets (line 617). Add buckets to BUCKET map + LEGEND_TIPS. Apply `.word-forgiven` class. WCPM tooltip shows time credit. |
| `js/miscue-registry.js` | Update `oovOmissionRecovery` entry (now sets `_oovExcluded`). Add `oovExcluded` and `functionWordCollateral` entries. |
| `style.css` | No changes needed — `.word-forgiven` already defined (lines 125-126). May need `.word-bucket-oov-excluded` and `.word-bucket-function-word-forgiven` background colors. |

---

## Test Cases

### Case 1: "cayuco" — OOV with `<unknown>` tokens (the motivating bug)
- **Before**: cayuco=omission (error), a=sub(hyp="unknown") (error), small=sub(hyp="unknown") (error) → 3 errors
- **After**: Part 1 steals `<unknown>` from "a" (donor). "small" has `_pkType='correct'` (Parakeet heard it) → `_pkType` guard skips it. cayuco=sub(hyp="unknown"). Part 2 marks cayuco=OOV-excluded. Part 4 forgives "a" (function word collateral, all engines missed it). Part 3: cayuco triggers leniency → "a" is transparent (collateral) → "small" promoted to correct via post-struggle leniency (Parakeet confirmed). → 0 errors, ~2.88s time credit

### Case 2: "jaiberos" — OOV with phonetic match
- **Before**: ASR heard "high-bear-os" → phonetic match >= 0.6 → forgiven (correct)
- **After**: No change. Path 1 fires first, word counts as correct. No time credit. Part 1 skips because `entry.forgiven` is already true.

### Case 3: OOV word student genuinely skipped (no vocalization)
- No `<unknown>` tokens, no Parakeet speech → Part 1 finds no donor, existing path 2 finds no `<unknown>` in window → remains omission (error)
- Correct — student actually skipped it.

### Case 4: "Mallon" — proper noun (NOT OOV-excluded)
- Proper noun forgiveness handles this separately (NL API + dictionary guard)
- If forgiven, `entry.forgiven = true` already set → Parts 1-2 skip it.

### Case 5: Single-letter "a" omitted in fluent reading (no adjacent struggle)
- Part 4 guard: `adjacentStruggle` is false → not forgiven → remains omission (error)
- Correct — genuine omission in fluent reading.

### Case 6: Single-letter "a" omitted but one engine substituted "the"
- In `_threeWay`, one engine has `type !== 'omission'` → `allMissed` is false → not forgiven
- Correct — this is a real error.

### Case 7: Multiple adjacent OOV words ("cayuco grande")
- Each gets its own Part 1 reassignment (closest `<unknown>` donor wins)
- Part 2b time credit: outer `while` loop finds cluster [cayuco, grande], scans for boundaries ONCE, credits one window. Advances `i` past cluster. No double-counting.

### Case 8: Reference passage contains the word "unknown"
- Part 1 guard: checks `transcriptWords[hypIndex].word` matches `<...>` pattern
- Real word "unknown" has raw `word: "unknown"` (no angle brackets) → guard rejects → no reassignment
- Correct — passage word scored normally.

### Case 9: CTC artifact `<unknown>` near OOV word
- CTC artifact filter (line 1173) flagged the token as `_ctcArtifact: true`
- Part 1 explicitly skips CTC artifacts: `if (tw._ctcArtifact) continue;`
- Existing path 2 also skips CTC artifacts (line 1854)
- Correct — CTC artifacts are false onsets, not evidence of student speech.

### Case 10: OOV-excluded word triggers leniency through collateral
- Part 3: cayuco `_oovExcluded` → `prevRefWasError = true`
- "a" between cayuco and target: `_functionWordCollateral` → transparent, `prevRefWasError` carries through
- Target word: if it's a substitution with `crossValidation === 'disagreed'` and Parakeet heard correct → promoted to correct with `_postStruggleLeniency`
- Correct — Reverb was off-track during OOV struggle, collateral entries are part of the same blast zone, Parakeet is more reliable here.

### Case 11: OOV omission with `<unknown>` in window but no donor in ±3
- Part 1 finds no donor → OOV entry stays as omission
- Existing path 2 fires: finds `<unknown>` tokens in temporal window + Parakeet speech → sets `forgiven = true` AND `_oovExcluded = true`
- `computeAccuracy()` skips it entirely (not counted as correct or error)
- Correct — same outcome as the donor case, just via different path.

### Case 12: OOV with 3 `<unknown>` tokens on 3 different donors
- Part 1 steals ALL 3 donors → all converted to omissions with `_oovCollateralOmission`
- OOV entry gets closest donor's hypIndex → Part 2 excludes
- Donor entries that the 3-way verdict already resolved as `type='correct'` are skipped (guard prevents stealing from resolved words)
- Remaining donor omissions: Part 4 forgives single-letter function words; others remain as omissions (no engine confidently heard them — conservative but defensible)

### Case 13: OOV with `<unknown>` on donor where Parakeet heard correctly
- NW assigned `<unknown>` to ref="small", but Parakeet heard "small" correctly
- 3-way verdict set `crossValidation='disagreed'` on "small" but did NOT change `type` (stays 'substitution')
- Part 1 guard: `candidate._pkType === 'correct'` → SKIP "small"
- "small" keeps its `<unknown>` hyp but is later promoted to correct via post-struggle leniency (Parakeet confirmed it, `prevRefWasError` carried through transparent collateral)
- Correct — Parakeet independently confirmed the student said "small"

**CRITICAL LEARNING**: The 3-way verdict sets `crossValidation='disagreed'` but does NOT change V1's `type` from 'substitution' to 'correct'. Checking `type === 'correct'` alone is insufficient — must also check `_pkType === 'correct'` and `_v0Type === 'correct'` directly.

---

## Edge Case Interactions (Verified Safe)

| Interaction | Status | Reason |
|-------------|--------|--------|
| Spillover consolidation moves `<unknown>` | Safe | `isNearMiss("unknown", anyRef)` fails — too dissimilar |
| Compound merge absorbs `<unknown>` | Safe | `getCanonical("unknown")` won't match any ref (unless ref IS "unknown") |
| CTC artifact filter removes evidence | Safe | Part 1 explicitly skips `_ctcArtifact` tokens. Existing path 2 also skips them (line 1854). |
| Part 1 + existing path 2 ordering | Sound | Part 1 runs BEFORE existing path 2. If Part 1 steals donors, OOV becomes sub → path 2 skips it → Part 2 handles. If Part 1 finds no donor, OOV stays omission → path 2 handles it directly with `_oovExcluded`. Both paths converge on the same outcome. |
| Part 1 multi-donor + 3-way verdict | Sound | Part 1 skips donors with `type === 'correct'` OR `_pkType === 'correct'` OR `_v0Type === 'correct'`. The 3-way verdict does NOT change V1's `type` for disagreed entries — only sets `crossValidation`. Must check per-engine types directly. |
| Function word forgiveness + post-struggle leniency | Sound | Part 4 runs before leniency. Forgiven collateral entries (`_functionWordCollateral`) are transparent to `prevRefWasError` — leniency carries through to the next real word. |
| Collateral transparency scope | Bounded | Only `_functionWordCollateral` ("a"/"I") and `_oovCollateralOmission` (Part 1 donors) are transparent. Multi-letter unforgiven omissions propagate leniency naturally. Parakeet confirmation still required for promotion. |
| `computeWCPMRange` counts OOV-excluded as correct | Safe | `_oovExcluded` entries have `type: 'substitution'` or `type: 'omission'`, never `'correct'`. WCPM filters for `type === 'correct'` only. |

---

## Execution Trace: Motivating Case ("cayuco a small")

Step-by-step trace through the pipeline for the motivating bug, verified against actual debug log (`orf-debug-2026-02-14T17-45-31.json`):

**State at OOV pipeline entry** (after 3-way verdict, CTC flagging, diagnostics, proper noun forgiveness — all ran earlier):
```
alignment[i-1]: ref="my"      type=correct   hypIndex=64  crossValidation=confirmed
alignment[i]:   ref="cayuco"  type=omission  _isOOV=true  hypIndex=-1
alignment[i+1]: ref="a"       type=sub       hyp="unknown"  hypIndex=65  (transcriptWords[65].word = "<unknown>")
alignment[i+2]: ref="small"   type=sub       hyp="unknown"  hypIndex=66  crossValidation=disagreed  _pkType=correct  _xvalWord="small"
```
**CRITICAL**: The 3-way verdict set `crossValidation='disagreed'` on "small" but did NOT change `type` from 'substitution' — it stays `type='substitution'`. Only `_pkType='correct'` records that Parakeet heard it correctly.

**OOV Phonetic Forgiveness (line 1748):**
- cayuco: `type='omission'` → line 1753 checks `type !== 'substitution' && type !== 'struggle'` → SKIP

**Part 1 — `<unknown>` Reassignment (NEW, between 1806-1812):**
- cayuco: `_isOOV=true`, `type='omission'`, `!forgiven` → enters loop
- Scan ±3 for ALL `<unknown>` donors:
  - `alignment[i+1]` (ref="a", hyp="unknown", hypIndex=65): type=sub ✓, `_pkType` not 'correct' ✓, `transcriptWords[65].word = "<unknown>"` ✓, `!_ctcArtifact` ✓ → **donor** (dist=1)
  - `alignment[i+2]` (ref="small", hyp="unknown"): `_pkType === 'correct'` → **SKIP** (Parakeet heard "small" correctly — the `<unknown>` is V1's CTC confusion, not the OOV vocalization)
- 1 donor found. Closest = "a" (dist=1)
- Steal: cayuco gets `hyp="unknown"`, `type='substitution'`, `hypIndex=65`
- Donor "a" gets `hyp=null`, `type='omission'`, `hypIndex=-1`, `_oovCollateralOmission=true`

**After Part 1:**
```
alignment[i]:   ref="cayuco"  type=sub       hyp="unknown"  hypIndex=65  _isOOV=true
alignment[i+1]: ref="a"       type=omission  _oovCollateralOmission=true
alignment[i+2]: ref="small"   type=sub       hyp="unknown"  _pkType=correct  crossValidation=disagreed  (unchanged)
```

**Existing Path 2 — OOV Omission Recovery (line 1812):**
- cayuco: `type='substitution'` → line 1814 checks `type !== 'omission'` → SKIP ✓

**Part 2 — OOV Exclusion (NEW, after line 1875):**
- cayuco: `_isOOV=true`, `type='substitution'`, `!forgiven`, `hyp='unknown'`
- Verify: `transcriptWords[65].word = "<unknown>"` → matches ✓
- Set: `_oovExcluded=true`, `forgiven=true`, `_oovForgiven=true`

**Timing Adjustment (line 1877):** Standard calculation.

**Part 2b — OOV Time Credit (NEW, after line 1897):**
- cayuco has `_oovExcluded` → cluster = [cayuco] (only one)
- gapStart: `transcriptWords[64].endTime` (ref="my", the word before cayuco)
- gapEnd: `transcriptWords[66].startTime` (ref="small", first non-excluded after cluster)
- Credit: `gapEnd - gapStart` = 2.88s
- `effectiveElapsedSeconds -= 2.88`

**Part 4 — Function Word Forgiveness (NEW, after line 1913):**
- ref="a": `type='omission'`, `!forgiven`, `FUNCTION_LETTERS.has('a')` ✓
- Adjacent: prev is cayuco (`_oovExcluded=true`) → `adjacentStruggle=true`
- All engines: V1=omission (entry.type), V0=omission (`v0RefEntries[refIdx]`), Pk=omission (`pkRefEntries[refIdx]`) → all missed
- Set: `forgiven=true`, `_functionWordCollateral=true`

**Part 3 — Post-Struggle Leniency (line 1915):**
- cayuco: `_oovExcluded=true` → `prevRefWasError = true`
- "a": `_functionWordCollateral=true` → **transparent** (prevRefWasError unchanged, still true)
- "small": `prevRefWasError=true`, `type='substitution'`, `crossValidation='disagreed'`, `pkEntry.type='correct'` → ALL conditions met → **promoted to `type='correct'`**, `_postStruggleLeniency=true`

**After Part 3:**
```
alignment[i]:   ref="cayuco"  type=sub       _oovExcluded=true  forgiven=true
alignment[i+1]: ref="a"       type=omission  _functionWordCollateral=true  forgiven=true
alignment[i+2]: ref="small"   type=correct   _postStruggleLeniency=true  bucket=struggle-correct
```

**Metrics (line 1952):**
- cayuco: `_oovExcluded` → `continue` (skipped entirely — neither correct nor error)
- "a": `forgiven` omission → `correctCount++`
- "small": `type='correct'` → `correctCount++`
- Final: 0 errors from this region, time adjusted by 2.88s

---

## Resolved Design Decisions

1. **Time credit UI**: WCPM tooltip shows "2.88s OOV time excluded". The WCPM number itself reflects the adjusted elapsed time.

2. **OOV-excluded visual**: Dashed green border + checkmark (`.word-forgiven` class, style.css lines 125-126). Same visual language as would-be proper noun forgiveness. Tooltip explains why excluded.

3. **Blast radius**: Exact same post-struggle leniency mechanism (app.js line 1915). OOV-excluded sets `prevRefWasError = true`, feeding into the existing one-word promotion chain.

4. **Teacher visibility**: OOV-excluded words remain visible in analyzed words view with forgiven visual and tooltip. Teacher sees the student struggled but scoring wasn't affected.

5. **Proper noun forgiven words stay in 'correct' bucket**: Unlike OOV-excluded, proper noun forgiveness means the student DID read the word correctly — it just needed forgiveness because it's a proper noun. No new visual treatment needed for proper nouns (they remain green).

6. **Existing path 2 now excludes instead of crediting**: OOV omissions recovered via `<unknown>` tokens are excluded from assessment (`_oovExcluded = true`), not counted as correct. This aligns with Principle 3: "we can't credit OR penalize" when ASR couldn't decode.
