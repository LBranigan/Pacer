# Abbreviation Handling — Comprehensive Implementation Proposal

## Problem Statement

When reference text contains abbreviations with internal periods (i.e., e.g., a.m., U.S., etc.), the pipeline produces **false errors** because:

1. `normalizeText()` strips trailing punctuation but **internal periods survive**: "i.e.," → "i.e"
2. Reverb (CTC decoder) outputs individual letters as separate words: "i" + "e"
3. NW alignment can't match 1 ref token ("i.e") against 2 hyp tokens ("i", "e")
4. Result: substitution("i.e"/"e") + insertion("i") = **false error on a correctly-read word**

### Observed in Production

From debug file `orf-debug-2026-02-09T20-13-20.json`:
- Reference: "content-i.e.," → hyphen split → ["content", "i.e.,"] → punct strip → ["content", "i.e"]
- Reverb output: ["i", "e"] (two separate CTC tokens)
- Parakeet (cross-validator): ["i.e."] (single token with ITN formatting)
- Alignment result: insertion("i") + substitution("i.e"/"e") → **1 false substitution + 1 false insertion**
- Fragment absorption caught the "i" as `_partOfStruggle`, but "i.e"/"e" still counts as error

---

## First Principles: How Students Read Abbreviations Aloud

The fundamental challenge is that **written abbreviations have multiple valid spoken forms**, and ASR engines produce different outputs for each:

### Pronunciation Patterns

| Pattern | Example | Student Says | Reverb (CTC) Output | Parakeet (ITN) Output |
|---------|---------|-------------|---------------------|----------------------|
| **Letter-by-letter** | i.e. | "eye ee" | `"i"` + `"e"` | `"i.e."` |
| **Full expansion** | i.e. | "that is" | `"that"` + `"is"` | `"that is"` or `"i.e."` |
| **Word expansion** | Mr. | "mister" | `"mister"` | `"Mr."` or `"mister"` |
| **Phonetic blend** | etc. | "etcetera" | `"etcetera"` | `"etc."` or `"etcetera"` |
| **Acronym-as-word** | ASAP | "ay-sap" | `"asap"` | `"ASAP"` |

### Key Insight: CTC vs Transformer ASR Divergence

- **Reverb (wenet CTC)**: Outputs the raw spoken form in lowercase. No Inverse Text Normalization (ITN). Letters come out as individual tokens. "Mr. Smith" → `"mister"` + `"smith"`.
- **Parakeet/Deepgram (transformer)**: Has built-in ITN via WFST grammars (NeMo text-processing). Converts spoken forms back to written: "mister smith" → `"Mr."` + `"Smith"`. Initialisms may be reassembled: "eye ee" → `"i.e."`.

This means the **primary ASR (Reverb) and cross-validator (Parakeet) produce fundamentally different formats** for abbreviations — and our alignment system must handle both against the reference text.

---

## Abbreviation Categories & Handling Requirements

### Category A: Titles (Already Handled)
**Mr., Mrs., Dr., Jr., Sgt., Prof., etc.**

- normalizeText strips trailing period: "Mr." → "mr"
- Student says "mister" → Reverb outputs "mister"
- Existing equivalence: `['mr', 'mister']` → getCanonical match ✓
- **Status: Working. No changes needed.**

### Category B: Internal-Period Abbreviations (THE BUG)
**i.e., e.g., a.m., p.m., U.S., U.S.A., Ph.D., D.C., B.C., A.D., N.Y., R.S.V.P.**

- normalizeText leaves internal period: "i.e." → "i.e"
- Reverb outputs individual letters: "i" + "e" (2 tokens)
- Alignment: 1 ref token vs 2 hyp tokens → mismatch
- **Status: BROKEN. Causes false errors.**

#### The Fix: Strip Internal Periods

After stripping internal periods: "i.e." → "ie"
Then compound merge handles letter-by-letter reading naturally:
- sub(ref="ie", hyp="i") + ins(hyp="e") → "i"+"e" = "ie" → **correct** ✓

This works because `mergeCompoundWords` in alignment.js already iterates through multiple following insertions:
```
for (let j = i + 1; j < alignment.length && alignment[j].type === 'insertion'; j++) {
    combined += alignment[j].hyp;
    if (getCanonical(combined) === refCanon) → MATCH!
}
```

Verified walkthrough for multi-letter abbreviations:
| Abbreviation | After strip | Reverb output | Compound merge |
|---|---|---|---|
| i.e. | "ie" | "i" + "e" | "i"+"e" = "ie" ✓ |
| e.g. | "eg" | "e" + "g" | "e"+"g" = "eg" ✓ |
| a.m. | "am" | "a" + "m" | "a"+"m" = "am" ✓ |
| U.S.A. | "usa" | "u"+"s"+"a" | "u"+"s"+"a" = "usa" ✓ |
| Ph.D. | "phd" | "p"+"h"+"d" | "p"+"h"+"d" = "phd" ✓ |
| R.S.V.P. | "rsvp" | "r"+"s"+"v"+"p" | "r"+"s"+"v"+"p" = "rsvp" ✓ |

**Why this is safe:**
- Real words don't contain internal periods after leading/trailing strip
- Edge cases (decimals like "3.5", URLs like "google.com") are negligible in ORF passages
- Token COUNT is unchanged ("i.e" → "ie" is still 1 token), so the 5-place sync (refPositions, splitForPunct, getPunctuationPositions, etc.) is unaffected
- `_displayRef` still shows the original "i.e." because refPositions preserves original casing

### Category C: Trailing-Period-Only Abbreviations (Already Handled)
**etc., Ave., Blvd., Mt., Ft., Dept., Corp., Inc., Ltd., Co., Vol., Fig.**

- normalizeText strips trailing period: "etc." → "etc", "Ave." → "ave"
- Student says the full word: "etcetera", "avenue"
- Existing equivalences handle most (ave/avenue, blvd/boulevard, dept/department)
- **Status: Mostly working. Need to add a few missing equivalences.**

Missing equivalences to add:
```javascript
['etc', 'etcetera'],
['mt', 'mount', 'mountain'],
['ft', 'fort', 'foot', 'feet'],
['inc', 'incorporated'],
['ltd', 'limited'],
['co', 'company', 'county'],
['corp', 'corporation'],
['vol', 'volume'],
['fig', 'figure'],
['no', 'number'],   // CAUTION: "no" is extremely common word
```

**Note on "No.":** This is the most dangerous. "No." as abbreviation for "number" is context-dependent. Without the period (after strip), it's just "no" — which is also a common English word. We should **NOT** add "no"→"number" to equivalences because it would incorrectly match the word "no" throughout any passage. This is better handled by a context-aware mechanism (future work).

### Category D: Multi-Word Expansion (Student reads full meaning)
**i.e. → "that is", e.g. → "for example", D.I.Y. → "do it yourself"**

When a student expands an abbreviation to its full English meaning, we get 1 ref token mapping to 2+ hyp tokens of different words.

Example: ref="ie" (after strip), student says "that is" → Reverb: "that" + "is"
- Compound merge: "that"+"is" = "thatis" ≠ "ie" → no match

This requires a **new abbreviation expansion merge step** (see implementation below).

---

## Implementation Plan

### Step 1: Strip Internal Periods in normalizeText

**File:** `js/text-normalize.js`
**Change:** Add `.replace(/\./g, '')` after the existing punctuation strip

```javascript
.map(w => w.replace(/^[^\w'-]+|[^\w'-]+$/g, '')  // strip leading/trailing punctuation
           .replace(/\./g, ''))                     // strip internal periods (abbreviations)
```

**Impact:** Fixes Category B abbreviations via existing compound merge. Zero token count change.

### Step 2: Add Missing Equivalences

**File:** `js/word-equivalences.js`
**Change:** Add period-stripped abbreviation forms

```javascript
// Abbreviation expansions (after normalizeText strips periods)
['etc', 'etcetera'],
['mt', 'mount', 'mountain'],
['ft', 'fort', 'foot', 'feet'],
['inc', 'incorporated'],
['ltd', 'limited'],
['co', 'company', 'county'],
['corp', 'corporation'],
['vol', 'volume'],
['fig', 'figure'],
```

**Note:** Do NOT add ambiguous one-to-one mappings that conflict with common words:
- ❌ `['no', 'number']` — "no" is too common
- ❌ `['am', 'morning']` — "am" is a verb (I am)
- ❌ `['us', 'united states']` — "us" is a pronoun

### Step 3: Abbreviation Expansion Merge (New)

**File:** `js/alignment.js`
**New function:** `mergeAbbreviationExpansions(alignment)`
**Position in pipeline:** After `mergeCompoundWords`, before `mergeContractions`

This handles the case where a student reads an abbreviation as its full English meaning (1 ref token → N hyp tokens of different words).

```
ABBREVIATION_EXPANSIONS = {
  'ie':    [['that', 'is']],
  'eg':    [['for', 'example']],
  'etc':   [['et', 'cetera']],
  'aka':   [['also', 'known', 'as']],
  'diy':   [['do', 'it', 'yourself']],
  'rsvp':  [['please', 'respond']],
  'bc':    [['before', 'christ']],
  'ad':    [['anno', 'domini']],
  'ps':    [['post', 'script']],
  'us':    [['united', 'states']],
  'usa':   [['united', 'states', 'of', 'america']],
  'uk':    [['united', 'kingdom']],
  'dc':    [['district', 'of', 'columbia']],
  'am':    [['in', 'the', 'morning']],
  'pm':    [['in', 'the', 'afternoon'], ['in', 'the', 'evening']],
}
```

**Algorithm:**
```
For each substitution in alignment where ref matches an abbreviation key:
  1. Look ahead at following insertions
  2. Collect [hyp from sub] + [hyp from each insertion]
  3. Check if this sequence matches any expansion in the table
  4. If match: re-classify sub as correct, insertions as correct (compound: true)
  5. Also check reversed pattern: insertions before substitution
```

**Why this is safe:**
- Only triggers when the ref word IS a known abbreviation (not arbitrary words)
- Only matches when the EXACT multi-word expansion sequence appears
- Positional matching means "that is" only matches ref "ie" at that specific position
- False positive risk is extremely low (would need "that"+"is" to appear right where "ie" is in the reference)

### Step 4: Cross-Validator Leverage (Enhancement)

When the cross-validator (Parakeet) outputs "i.e." as a single word and confirms the reading, we can use this as a **secondary validation signal** even when Reverb splits it into letters.

The existing fragment_absorption already partially does this — it absorbed "i" as `_partOfStruggle` because Parakeet's "i.e." timestamp overlapped. But it doesn't reclassify the substitution.

**Enhancement to fragment_absorption or a new step:**
When a substitution's ref word (after period strip) matches the period-stripped form of a cross-validator word that was classified as 'confirmed', reclassify the substitution as correct.

This is a fallback for cases where Steps 1-3 don't catch the abbreviation.

---

## Token Count Sync Analysis

The 5 places that must mirror normalizeText changes:

| Location | Affected? | Why |
|---|---|---|
| normalizeText() in text-normalize.js | YES - the change | Strips internal periods |
| refPositions IIFE in app.js | **NO** | Preserves original casing/punctuation for display. Token count unchanged. |
| splitForPunct in ui.js | **NO** | Handles hyphen splitting only. Period strip doesn't change token count. |
| getPunctuationPositions in diagnostics.js | **NO** | Operates on original reference text, not normalized form. |
| computePauseAtPunctuation in diagnostics.js | **NO** | Same — uses original text. |

**Key insight:** Stripping internal periods changes token CONTENT ("i.e" → "ie") but not token COUNT. Unlike hyphen splitting (which creates new tokens), this is a within-token transformation.

---

## Related Issue: False Sentence Boundaries (Separate Fix)

The architecture analysis surfaced a related problem: `getPunctuationPositions()` in diagnostics.js
treats trailing periods on abbreviations ("Dr.", "St.", "Mr.") as **sentence-ending periods**. This
causes:

1. **detectOnsetDelays**: Uses 1200ms threshold after "Dr." (sentence boundary) instead of 500ms
2. **Break classification**: Pause after "Dr. Smith" classified as "at punctuation" (expected)
3. **computePauseAtPunctuation**: Abbreviation period counted as punctuation requiring a pause
4. **computeWordSpeedTiers**: Word flagged as `sentenceFinal: true` before "Dr."

This is a **separate bug** from the alignment issue and should be fixed with an abbreviation-aware
guard in `getPunctuationPositions()` — checking whether a trailing period belongs to a known
abbreviation (from a list like `ABBREVIATIONS` already defined in maze-generator.js) before
classifying it as a sentence boundary.

This can be addressed independently and is out of scope for this abbreviation alignment proposal,
but is noted here as a known issue that compounds the abbreviation handling problem.

---

## Edge Cases & Risks

### Decimal Numbers
"3.5" after period strip → "35". In ORF passages, decimal numbers are rare and typically written out ("three and a half"). Risk: minimal.

### URLs/Emails
"google.com" → "googlecom". Extremely unlikely in ORF passages. Risk: negligible.

### "No." Ambiguity
"No." (number) vs "No" (negation). Both normalize to "no". We deliberately do NOT add a "no"→"number" equivalence. If the passage says "No. 5", the "No" will be a separate ref word that students read as "number" — this will show as a substitution. A future context-aware system could handle this.

### "St." Ambiguity
Already handled by existing equivalence `['st', 'saint', 'street']`. Both are accepted.

### "in." (inches) vs "in" (preposition)
After period strip, both are "in". The preposition case is the common one. If the passage says "6 in." meaning inches, the period strip makes it "in" which the student reads as "inches" — this would be a substitution. Would need context awareness or a dedicated measurement handler. Low priority since measurement abbreviations rarely appear in ORF passages.

---

## Implementation Order

| Phase | Change | Files | Risk | Impact |
|---|---|---|---|---|
| **1** | Strip internal periods in normalizeText | text-normalize.js | Very low | Fixes 90% of cases via existing compound merge |
| **2** | Add missing trailing-period abbreviation equivalences | word-equivalences.js | Very low | Handles "etcetera", "mountain", "incorporated" etc. |
| **3** | Add abbreviation expansion merge | alignment.js | Low | Handles "that is" for "i.e.", "for example" for "e.g." |
| **4** | Cross-validator abbreviation confirmation | app.js | Low | Fallback validation using Parakeet's ITN output |

Phases 1-2 are the minimum viable fix. Phase 3 handles the multi-word expansion edge case. Phase 4 is a nice-to-have enhancement.

---

## Testing Strategy

### Manual Test Cases
1. **Passage with "i.e."** — verify no false substitution/insertion errors
2. **Passage with "e.g."** — same verification
3. **Passage with "a.m." / "p.m."** — verify student saying "ay em" is correct
4. **Passage with "U.S."** — verify "you ess" is correct
5. **Passage with "Mr." / "Dr."** — verify existing equivalences still work (regression)
6. **Passage with "etc."** — verify "etcetera" is correct
7. **Passage with decimal numbers** — verify no regression (low priority)

### Automated Verification
Add unit tests for normalizeText:
```javascript
normalizeText("content-i.e., who")  // → ["content", "ie", "who"]
normalizeText("8 a.m. meeting")     // → ["8", "am", "meeting"]
normalizeText("U.S.A. history")     // → ["usa", "history"]
normalizeText("Mr. Smith")          // → ["mr", "smith"]
normalizeText("3.5 million")        // → ["35", "million"]  (acceptable edge case)
```
