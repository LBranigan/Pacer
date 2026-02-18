# OOV `<unknown>` Recovery — Comprehensive Implementation Plan

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
ref="cayuco" → hyp="unknown"  (OOV-forgiven — excluded from assessment)
ref="a"      → forgiven        (blast radius — function word adjacent to OOV struggle)
ref="small"  → correct          (Parakeet confirmed)
```
Student punished with 0 errors. WCPM credited back the ~2.88s OOV struggle time.

## Design Principles

1. **ASR artifacts are not student errors.** An English ASR cannot decode Spanish/foreign words. This is a tool limitation, not a student limitation.
2. **OOV phonetic match (path 1) stays "correct."** If the ASR heard recognizable fragments and phonetic similarity ≥ 0.6, the student successfully read the word → counts as correct, time counts normally.
3. **OOV `<unknown>` recovery (path 2) = excluded.** If the ASR couldn't decode at all, we can't credit OR penalize. The word is excluded from assessment, and the student is credited back the struggle time.
4. **Blast radius from existing patterns.** Reuse post-struggle leniency logic for collateral damage to adjacent words.

---

## Part 1: Post-Alignment `<unknown>` Reassignment

### What
After NW alignment, scan for OOV omissions. If an adjacent alignment entry has `hyp` matching a normalized `<unknown>` token, reassign it to the OOV word.

### Where
`js/app.js` — new block between the existing OOV detection loop (line ~1734) and the OOV phonetic forgiveness block (line ~1748). Must run BEFORE phonetic forgiveness so path 1 can use the reassigned hypothesis.

### Logic
```
for each alignment entry where _isOOV === true && type === 'omission':
  scan forward from entry (i+1, i+2, ...) for entries with:
    - hyp normalized to "unknown" (from <unknown> token)
    - NOT already assigned to another OOV word
  if found:
    1. steal the <unknown> hyp from the donor entry
    2. set OOV entry: hyp = "unknown", type = "substitution", hypIndex = donor's hypIndex
    3. set donor entry: hyp = null, type = "omission", hypIndex = -1
    4. flag donor: _oovCollateralOmission = true (for blast radius, Part 4)
  also scan backward (i-1, i-2, ...) for <unknown> tokens before the OOV word
  limit scan radius to ±3 ref positions (prevent long-range misassignment)
```

### Guard Rails
- Only reassign if the donor's `hyp` normalizes to "unknown" (not a real word that happens to sound like "unknown")
- Don't reassign if the donor entry is itself OOV (two OOV words adjacent — each keeps its own alignment)
- Maximum scan radius of 3 positions (OOV impact shouldn't extend far)

### Impact on Downstream
- After reassignment, `ref="cayuco" → hyp="unknown"` is now a substitution, not an omission
- This makes it eligible for path 1 (phonetic forgiveness) — but "unknown" vs "cayuco" Levenshtein will be low, so it won't match
- Path 2 (Part 2 below) will catch it instead

---

## Part 2: OOV-Forgiven Flag (Path 2) — Exclude from Assessment + Time Credit

### What
After Part 1 reassignment, if an OOV entry has `hyp="unknown"` (from `<unknown>` token) and phonetic forgiveness (path 1) didn't fire, trigger a new forgiveness path: **OOV-excluded**.

### Flag
```javascript
entry._oovExcluded = true;    // new flag: word excluded from assessment
entry.forgiven = true;         // existing flag: drives UI + metrics
entry._oovForgiven = true;     // existing flag
```

### Metrics Changes (`js/metrics.js`)

#### `computeAccuracy()`
Currently, `forgiven` substitutions are counted as `correctCount++`. For OOV-excluded words, they should be counted as **neither correct nor error**:

```javascript
case 'substitution':
  if (w._oovExcluded) {
    // Excluded from assessment entirely — not correct, not error
    forgiven++;
    break;
  }
  if (w.forgiven) {
    correctCount++;
    forgiven++;
  } else {
    wordErrors++;
  }
  break;
```

Also update `totalRefWords` to exclude OOV-excluded entries:
```javascript
const oovExcluded = alignmentResult.filter(w => w._oovExcluded).length;
const totalRefWords = correctCount + wordErrors + omissions - oovExcluded;
```

Wait — simpler approach: just don't count them at all. Skip OOV-excluded entries entirely:
```javascript
for (const w of alignmentResult) {
  if (w._oovExcluded) { forgiven++; continue; }  // excluded from all counts
  // ... existing switch
}
```

#### `computeWCPMRange()`
The `elapsedSeconds` parameter must be adjusted BEFORE passing to this function. See time credit below.

### Time Credit (`js/app.js`)

After the OOV forgiveness block, calculate total OOV-excluded time and subtract from `effectiveElapsedSeconds`:

```javascript
// ── OOV time credit ──────────────────────────────────────────────────
// For OOV-excluded words (path 2: <unknown> only), credit back the
// struggle time. Use Parakeet timestamps for clean boundaries.
let oovTimeCreditSeconds = 0;
for (let i = 0; i < alignment.length; i++) {
  const entry = alignment[i];
  if (!entry._oovExcluded) continue;

  // Find temporal boundaries: last confirmed word before, first confirmed word after
  let gapStart = null, gapEnd = null;
  for (let j = i - 1; j >= 0; j--) {
    if (alignment[j].type === 'insertion') continue;
    if (alignment[j].hypIndex >= 0 && !alignment[j]._oovExcluded) {
      gapStart = parseT(transcriptWords[alignment[j].hypIndex].endTime);
      break;
    }
  }
  for (let j = i + 1; j < alignment.length; j++) {
    if (alignment[j].type === 'insertion') continue;
    if (alignment[j].hypIndex >= 0 && !alignment[j]._oovExcluded) {
      gapEnd = parseT(transcriptWords[alignment[j].hypIndex].startTime);
      break;
    }
  }
  if (gapStart !== null && gapEnd !== null && gapEnd > gapStart) {
    oovTimeCreditSeconds += (gapEnd - gapStart);
  }
}
effectiveElapsedSeconds -= oovTimeCreditSeconds;
```

**Placement**: after OOV forgiveness block, before `computeWCPMRange()` call.

**Guard**: if multiple adjacent OOV words exist, they share one time window (don't double-count). The forward/backward scan for boundaries already handles this — `_oovExcluded` entries are skipped.

### UI Changes (`js/ui.js`)

Currently `classifyWord()` returns `'correct'` for all forgiven entries (line 617). Replace with bucket routing:

```javascript
if (entry.forgiven) {
  if (entry._oovExcluded) return 'oov-excluded';
  if (entry._functionWordCollateral) return 'function-word-forgiven';
  return 'proper-noun-forgiven';  // proper noun or OOV phonetic match
}
```

All three forgiven buckets use the existing `.word-forgiven` CSS class (dashed green border + checkmark, already defined in style.css line 125-126 but currently unused). Each gets a distinct tooltip:
- **oov-excluded**: "OOV word excluded — student attempted but ASR could not decode. Time credited back."
- **function-word-forgiven**: "Function word forgiven — adjacent to OOV/struggle, no engine detected it"
- **proper-noun-forgiven**: "Proper noun forgiven — phonetically close (X% match)"

**Note**: This also fixes the existing bug where proper noun forgiveness has no visual distinction from correct words. The `.word-forgiven` class was defined in CSS but never applied.

---

## Part 3: Blast Radius — Post-OOV Leniency

### What
Extend the existing post-struggle leniency (app.js line ~1915) to recognize OOV-excluded words as error triggers. Currently, `prevRefWasError` is set when `type === 'substitution' || type === 'struggle' || type === 'omission'` and `!entry.forgiven`. Since OOV-excluded entries ARE forgiven, the leniency trigger doesn't fire.

### Fix
In the `prevRefWasError` update (line ~1942):

```javascript
// Update trigger for next word
prevRefWasError = (entry.type === 'substitution' || entry.type === 'struggle'
                   || entry.type === 'omission') && !entry.forgiven;
// OOV-excluded words also trigger leniency — Reverb was off-track during OOV struggle
if (entry._oovExcluded) prevRefWasError = true;
```

### What This Gives
The word immediately after an OOV-excluded word gets the same leniency as after any other error: if Parakeet heard it correctly but Reverb disagreed, promote to correct. One word of leniency only (existing `oneWordRule` resets automatically).

### Interaction with Part 4
If the word after the OOV is a single-letter function word that got turned into an omission by Part 1's reassignment, Part 4 (below) handles it before post-struggle leniency even runs. If both apply, Part 4 takes priority (forgiven > leniency promotion).

---

## Part 4: Single-Letter Function Word Forgiveness

### What
When a single-letter function word (`a`, `I`) is omitted by ALL engines — and is adjacent to a struggle or OOV word — forgive it as collateral damage. These words are too short for ASR to reliably capture when the student is struggling with a nearby word.

### Where
`js/app.js` — new block after OOV forgiveness, before post-struggle leniency.

### Logic
```javascript
const FUNCTION_LETTERS = new Set(['a', 'i']);

for (let i = 0; i < alignment.length; i++) {
  const entry = alignment[i];
  if (entry.type !== 'omission') continue;
  if (entry.forgiven) continue;
  if (!FUNCTION_LETTERS.has(entry.ref.toLowerCase())) continue;

  // Must be adjacent to a struggle, OOV, or error
  const prev = alignment[i - 1];
  const next = alignment[i + 1];
  const adjacentStruggle =
    (prev && (prev._isOOV || prev.type === 'struggle' ||
              prev.type === 'substitution' || prev._oovExcluded)) ||
    (next && (next._isOOV || next.type === 'struggle' ||
              next.type === 'substitution' || next._oovExcluded));

  if (!adjacentStruggle) continue;

  // Verify ALL engines missed it (no engine heard this word at this position)
  const pkEntry = data._threeWay?.pkRef?.[refIdx];  // need ref index tracking
  const v0Entry = data._threeWay?.v0Ref?.[refIdx];
  const v1Entry = entry;  // already an omission in V1

  const allMissed = v1Entry.type === 'omission'
    && (!v0Entry || v0Entry.type === 'omission')
    && (!pkEntry || pkEntry.type === 'omission');

  if (allMissed) {
    entry.forgiven = true;
    entry._functionWordCollateral = true;
  }
}
```

### Guard Rails
- **Only omissions** — if any engine produced a substitution for "a" (e.g., "the"), it's a real error
- **Only adjacent to struggle/OOV** — if "a" is omitted in the middle of fluent reading, it IS a real omission
- **All engines must agree** — if even one engine heard the word, it shouldn't be auto-forgiven
- **Only single-letter function words** — not "the", "is", etc. (those are long enough for ASR to catch reliably)

### UI
Use the same forgiven cutout visual as OOV-excluded (Part 2) and proper noun forgiveness. Tooltip:
```
"a" — Forgiven (function word collateral)
Adjacent to OOV/struggle word, no engine detected it
```

---

## Pipeline Order

```
kitchen-sink
  → fragment pre-merge
  → 3 independent ref alignments (V1, V0, Parakeet)
  → spillover consolidation
  → compound struggle reclassification
  → 3-way verdict (cross-validation)
  → disfluency classification
  → omission recovery
  → CTC artifact filter
  → OOV detection (CMUdict lookup)
  → [NEW] OOV <unknown> reassignment (Part 1)    ← assigns <unknown> to OOV words
  → OOV phonetic forgiveness (path 1)              ← existing, works on reassigned hyp
  → [MODIFIED] OOV <unknown> forgiveness (path 2)  ← fires when phonetic didn't match
  → near-miss resolution
  → fragment absorption
  → [NEW] single-letter function word forgiveness (Part 4)
  → confirmed insertion cross-validation
  → post-struggle leniency [MODIFIED] (Part 3)     ← OOV-excluded triggers leniency
  → [NEW] OOV time credit                          ← subtract OOV time from elapsed
  → metrics (WCPM, accuracy)
  → diagnostics
```

---

## Files Changed

| File | Change |
|------|--------|
| `js/app.js` | Part 1: new OOV reassignment block. Part 2: modify OOV forgiveness + time credit. Part 3: extend leniency trigger. Part 4: new function word forgiveness block. |
| `js/metrics.js` | Part 2: `computeAccuracy()` skips `_oovExcluded` entries entirely. `computeWCPMRange()` receives adjusted elapsed time. |
| `js/ui.js` | Fix forgiven bucket routing (proper noun, OOV-excluded, function word collateral). Apply `.word-forgiven` class. Add forgiven buckets to BUCKET map + legend. Tooltip text per bucket. WCPM tooltip shows OOV time credit. |
| `js/miscue-registry.js` | Update `oovOmissionRecovery` entry. Add `oovExcluded`, `functionWordCollateral` entries. |
| `style.css` | `.word-forgiven` already exists (line 125-126). May need bucket-specific variants or the existing class suffices for all forgiven types. |

---

## Test Cases

### Case 1: "cayuco" — OOV with `<unknown>` tokens (the motivating bug)
- **Before**: cayuco=omission (error), a=sub (error), small=correct → 2 errors
- **After**: cayuco=OOV-excluded (forgiven), a=forgiven (function word collateral), small=correct → 0 errors, ~2.88s time credit

### Case 2: "jaiberos" — OOV with phonetic match
- **Before**: If ASR heard "high-bear-os" → phonetic match ≥ 0.6 → forgiven (correct)
- **After**: No change. Path 1 fires, word counts as correct. No time credit.

### Case 3: OOV word student genuinely skipped (no vocalization)
- No `<unknown>` tokens, no Parakeet speech → Part 1 finds nothing to reassign → remains omission (error)
- Correct — student actually skipped it.

### Case 4: "Mallon" — proper noun (NOT OOV-excluded)
- Proper noun forgiveness handles this separately (NL API + dictionary guard)
- Student IS expected to sound it out. No time credit even if forgiven.

### Case 5: Single-letter "a" omitted in fluent reading (no adjacent struggle)
- Part 4 guard: `adjacentStruggle` is false → not forgiven → remains omission (error)
- Correct — genuine omission in fluent reading.

### Case 6: Single-letter "a" omitted but one engine substituted "the"
- Part 4 guard: `allMissed` is false (one engine heard "the") → not forgiven
- Correct — this is a real substitution.

### Case 7: Multiple adjacent OOV words
- Each gets its own `<unknown>` reassignment
- Time credit uses shared window boundaries (skip adjacent `_oovExcluded` entries)
- No double-counting.

---

## Resolved Design Decisions

1. **Time credit UI**: Show the adjustment in display and on-hover tooltip. E.g., WCPM tooltip: "2.88s OOV time excluded from calculation". The WCPM number itself reflects the adjusted value.

2. **OOV-excluded visual**: Use a **forgiven cutout effect** — same visual language as proper noun forgiveness (dashed green border + checkmark, `.word-forgiven` class in style.css). Both OOV-excluded and function word collateral use this same cutout. On-hover tooltip explains why the word was excluded.

3. **Blast radius**: Use the **exact same post-struggle leniency** already in the codebase (app.js line ~1915). No custom scope — OOV-excluded entries set `prevRefWasError = true`, which feeds into the existing one-word leniency chain.

4. **Teacher visibility**: OOV-excluded words **remain visible** in the analyzed words view with the forgiven cutout visual and on-hover explanation. The teacher can see the student struggled but the word didn't affect scoring.

---

## Pre-existing Bug: Proper Noun Forgiven UI Migration

**Finding**: The `.word-forgiven` CSS class exists in `style.css` (dashed green border + checkmark) but is **never applied** in `js/ui.js`. Currently:
- `classifyWord()` returns `'correct'` for ALL forgiven entries (line 617) — no visual distinction
- Proper noun forgiven words render as plain green (indistinguishable from genuinely correct words)
- The "Forgiven Proper Nouns" list exists in the pipeline debug section (line 2157) but NOT in the teacher-facing analyzed words view

**Required fix** (as part of this implementation):
- In `classifyWord()`, check `entry.forgiven` BEFORE returning `'correct'` and route to appropriate forgiven bucket:
  ```javascript
  if (entry.forgiven) {
    if (entry._oovExcluded) return 'oov-excluded';
    if (entry._functionWordCollateral) return 'function-word-forgiven';
    return 'proper-noun-forgiven';  // existing proper noun / OOV phonetic match
  }
  ```
- All forgiven buckets use the `.word-forgiven` cutout visual (already defined in CSS)
- Each bucket gets its own tooltip text explaining why it was forgiven
- Add these buckets to the BUCKET map and legend in ui.js
