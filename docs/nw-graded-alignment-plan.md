# Replace diff-match-patch with Needleman-Wunsch Graded Alignment

## Problem

The alignment engine (`js/alignment.js`) uses Google's diff-match-patch library with a binary cost model: two words either match exactly (via canonical form) or they don't. When the aligner encounters a region with both deletions and insertions, it pairs them left-to-right with no consideration of which hypothesis word is more similar to the reference word.

**Concrete failure mode**: A student says "the mission" where the reference has "mission" (inserting "the"). Reverb transcribes "the" + "\<unknown\>". The aligner consumes "the" as a substitution for "mission" (wrong — it's an insertion) and pushes the actual attempt ("\<unknown\>") into an orphan insertion. The teacher sees "student said 'the' instead of 'mission'" which is misleading.

This is not a niche case. Struggling readers routinely insert function words before words they're sounding out.

## Root Cause

diff-match-patch uses Myers diff on Unicode-encoded word characters. Substitution cost is binary: match (0) or mismatch (1). "the" → "mission" costs the same as "unknown" → "mission". The library cannot be modified to support graded costs — it has no configuration surface for per-pair scoring.

## Solution

Replace diff-match-patch with **Needleman-Wunsch using graded substitution costs** based on character-level Levenshtein similarity.

### Why NW

- NW natively supports arbitrary substitution cost functions (this is its defining advantage — it was designed for exactly this in bioinformatics via BLOSUM matrices)
- A working NW implementation already exists in `js/sequence-aligner.js`
- `levenshteinRatio()` already exists in `js/nl-api.js`
- The `getCanonical()` equivalence system (homophones, numbers) is preserved

### Scoring Model

Based on [texterrors](https://github.com/RuABraun/texterrors), an ASR evaluation tool that solved this exact problem:

```
Match (exact canonical):  +2.0
Gap (insertion/omission): -1.0
Mismatch (graded):        -1.5 × (1 - levenshteinRatio(ref, hyp))
```

The **1.5× multiplier** ensures:
- Near-miss ("bark"→"barked", ratio 0.67): cost = -0.50 → cheap substitution ✓
- Distant ("the"→"mission", ratio ~0): cost = -1.50 → expensive substitution ✓
- Substitution is ALWAYS preferred over ins+del pair (-1.5 < -2.0) → no false gap pairs ✓
- When two hyp words compete for the same ref slot, the MORE SIMILAR one wins ✓

### Validation (Borgholt et al. 2025)

A [Corti paper](https://arxiv.org/abs/2509.24478) independently identified this exact failure mode and confirmed that graded substitution costs resolve it. Their key insight: `sub_cost ≥ ins_cost + del_cost` for very dissimilar words ensures the aligner doesn't force bad substitutions.

With our scoring: max sub cost (1.5) < ins+del cost (2.0), so substitution is always preferred — but the BETTER substitution wins. This matches the Borgholt recommendation.

## Changes

### File: `js/alignment.js`

**Remove**: diff-match-patch Unicode encoding trick (lines 159-259)
**Add**: Needleman-Wunsch DP with graded `scorePair()` function
**Keep**: `mergeCompoundWords()`, `mergeContractions()`, same function signature

```javascript
import { levenshteinRatio } from './nl-api.js';

const MATCH_BONUS = 2;
const GAP_PENALTY = -1;
const MAX_MISMATCH = -1.5;

function scorePair(refWord, hypWord) {
  const refCanon = getCanonical(refWord).replace(/'/g, '');
  const hypCanon = getCanonical(hypWord).replace(/'/g, '');
  if (refCanon === hypCanon) return MATCH_BONUS;
  const ratio = levenshteinRatio(refCanon, hypCanon);
  return MAX_MISMATCH * (1 - ratio);
}
```

### File: `js/miscue-registry.js`

Update alignment mechanism description from "diff-match-patch" to "Needleman-Wunsch with graded Levenshtein similarity".

### File: `index.html`

The diff-match-patch CDN script tag can be removed (no other code uses it). Version timestamp updated.

## Performance

NW is O(m×n) where m, n are word counts. Each cell computes `levenshteinRatio` at O(|w1|×|w2|) ≈ O(225) for typical words. For a 300-word ORF passage: ~300 × 300 × 225 ≈ 20M operations. Completes in < 100ms in browser JavaScript.

## What Doesn't Change

- `mergeCompoundWords()` and `mergeContractions()` — same post-processing
- `getCanonical()` equivalence matching — exact matches still get full bonus
- `filterDisfluencies()` — disfluencies still filtered before alignment
- `normalizeText()` — same text normalization
- All downstream consumers of alignment output — same `{ref, hyp, type}` format
- `sequence-aligner.js` — untouched, still used for Reverb v1.0/v0.0 and cross-validation

## Risk

Low. The alignment output format is identical. Post-alignment corrections (compound merge, contraction merge, omission recovery, near-miss clusters, fragment absorption) all operate on the same `{ref, hyp, type}` entries. The only behavioral change is better assignment of which hypothesis word fills each reference slot.
