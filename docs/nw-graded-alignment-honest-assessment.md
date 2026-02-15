# Honest Assessment: Needleman-Wunsch with Graded Substitution for ORF Alignment

## What This Document Is

An honest, evidence-based evaluation of Pacer's alignment algorithm — what it does well, what it borrows from, where it's novel, and where it has real weaknesses. Written for anyone who needs to understand whether the approach is sound or whether we're fooling ourselves.

---

## 1. The Claim Under Scrutiny

> "NW with graded substitution is mathematically equivalent to what NIST SCLITE, texterrors, and JiWER do — the only difference is your substitution cost is character-similarity-weighted instead of uniform."

**Verdict: Mostly true, with a meaningful caveat.**

All four tools (SCLITE, texterrors, JiWER, and Pacer's `alignment.js`) solve the same dynamic programming problem: find the global alignment of two word sequences that optimizes a cost function. The DP recurrence is identical in all four:

```
F[i][j] = optimal(
    F[i-1][j-1] + score(ref[i], hyp[j]),   // diagonal: match or substitution
    F[i-1][j]   + gap_cost,                 // up: deletion (omission)
    F[i][j-1]   + gap_cost                  // left: insertion
)
```

The differences are entirely in the cost parameters and tie-breaking:

| Tool | Match | Insertion | Deletion | Substitution | Tie-Break |
|------|-------|-----------|----------|--------------|-----------|
| **SCLITE** | 0 | 3 | 3 | 4 (uniform) | diagonal > del > ins |
| **texterrors** | 0 | 1.0 | 1.0 | `(charDist / maxLen) × 1.5` | diagonal > up > left |
| **JiWER** | 0 | 1 | 1 | 1 (uniform) | del > ins > sub |
| **Pacer** | +2.0 | -1.0 | -1.0 | `-1.5 × (1 - levenshteinRatio)` | diagonal > up > left |

Pacer's formula is texterrors' formula reframed for NW maximization instead of Levenshtein minimization. The math is equivalent:

```
texterrors (minimize cost):    sub_cost = (editDist / maxLen) × 1.5
Pacer (maximize score):        sub_score = -1.5 × (1 - (1 - editDist/maxLen))
                                         = -1.5 × (editDist / maxLen)
```

Same number. Different sign convention.

**The caveat:** "mathematically equivalent" applies to the DP structure. The alignment *results* differ because the cost functions differ. SCLITE and JiWER use uniform substitution costs, so they treat "cat"→"bat" the same as "cat"→"elephant." texterrors and Pacer don't — and that's the whole point.

---

## 2. The Problem Graded Substitution Solves (With Example)

### The Setup

A Grade 2 student reads the passage: *"The mission was dangerous."*

Reverb (the primary STT) transcribes: `"the"  "the"  "misson"`

The student actually said: *"the... the mission was dangerous"* — they hesitated, repeated "the," then read correctly. But Reverb heard the attempt at "mission" as `"misson"` (a near-miss), and the repeated "the" is a disfluency that gets filtered, leaving:

```
Reference:  ["the", "mission", "was", "dangerous"]
Hypothesis: ["the", "misson"]
```

(The student stopped reading early — "was" and "dangerous" are omissions.)

### What Uniform-Cost Alignment Does (SCLITE / JiWER style)

With uniform substitution cost, the aligner sees:

```
sub("the", "the")     = 0  (correct match)
sub("the", "misson")  = 4  (substitution — SAME cost as any other sub)
sub("mission","the")   = 4
sub("mission","misson") = 4  (SAME cost! uniform doesn't care about similarity)
```

Two optimal alignments exist with identical total cost:

**Alignment A (correct):**
| Ref | Hyp | Type | Cost |
|-----|-----|------|------|
| the | the | correct | 0 |
| mission | misson | substitution | 4 |
| was | — | omission | 3 |
| dangerous | — | omission | 3 |
| **Total** | | | **10** |

**Alignment B (wrong but equally optimal):**
| Ref | Hyp | Type | Cost |
|-----|-----|------|------|
| the | — | omission | 3 |
| mission | the | substitution | 4 |
| was | misson | substitution | 4 |
| dangerous | — | omission | 3 |
| **Total** | | | **14** |

Wait — B actually costs more (14 vs 10). Bad example. Let me construct the real failure case from the plan document:

### The Real Failure Case: Function Word Insertion Before Struggle

```
Reference:  ["mission"]
Hypothesis: ["the", "misson"]
```

The student inserted "the" before attempting "mission" (common struggling reader pattern — they say a function word while decoding).

**Uniform-cost alignment** (SCLITE-style, sub=4, ins=3, del=3):

**Option A — "the" is insertion, "misson" is substitution for "mission":**
```
ins("the") + sub("mission", "misson") = 3 + 4 = 7
```

**Option B — "the" is substitution for "mission", "misson" is insertion:**
```
sub("mission", "the") + ins("misson") = 4 + 3 = 7
```

**Identical cost. The aligner picks arbitrarily based on tie-breaking.**

SCLITE's diagonal-first preference would pick Option B — the wrong one. The teacher sees: *"Student said 'the' instead of 'mission'"* — a nonsensical error report.

JiWER's deletion-first preference might pick differently, but neither tool *knows* that "misson" is closer to "mission" than "the" is.

### What Graded Substitution Does (texterrors / Pacer)

Pacer computes character-level similarity before deciding:

**"the" vs "mission":**
```
levenshtein("the", "mission") = 7 edits (completely different)
maxLen = max(3, 7) = 7
ratio = 1 - 7/7 = 0.0
score = -1.5 × (1 - 0.0) = -1.50  (maximum penalty)
```

**"misson" vs "mission":**
```
levenshtein("misson", "mission") = 1 edit (one missing 'i')
maxLen = max(6, 7) = 7
ratio = 1 - 1/7 = 0.857
score = -1.5 × (1 - 0.857) = -0.214  (very cheap substitution)
```

Now the options have different costs:

**Option A — "the" is insertion, "misson" is substitution for "mission":**
```
gap("the") + sub("mission", "misson") = -1.0 + (-0.214) = -1.214
```

**Option B — "the" is substitution for "mission", "misson" is insertion:**
```
sub("mission", "the") + gap("misson") = -1.50 + (-1.0) = -2.50
```

**Option A wins by a mile (-1.214 > -2.50).** The aligner correctly identifies "misson" as the student's attempt at "mission" and "the" as an inserted function word. No ambiguity. No reliance on tie-breaking heuristics.

---

## 3. The Scoring Formula, Explained Honestly

### Pacer's Implementation (alignment.js, lines 247-257)

```javascript
const MATCH_BONUS  =  2.0;   // Exact canonical match reward
const GAP_PENALTY  = -1.0;   // Insertion or omission
const MAX_MISMATCH = -1.5;   // Worst-case substitution

function scorePair(refWord, hypWord) {
  const refCanon = getCanonical(refWord).replace(/'/g, '');
  const hypCanon = getCanonical(hypWord).replace(/'/g, '');
  if (refCanon === hypCanon) return MATCH_BONUS;  // +2.0
  const ratio = levenshteinRatio(refCanon, hypCanon);
  return MAX_MISMATCH * (1 - ratio);              // -1.5 × (1 - similarity)
}
```

### The Levenshtein Ratio (nl-api.js, lines 76-82)

```javascript
function levenshteinRatio(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const dist = levenshtein(a.toLowerCase(), b.toLowerCase());
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}
```

- Returns a value in [0, 1] where 1 = identical, 0 = completely different
- Case-insensitive (`.toLowerCase()`)
- Normalized by the longer word's length

### The Score Range

```
+2.0  ← exact canonical match (best possible)
 0.0  ← never happens (gap between match and mismatch)
-0.214 ← "misson" vs "mission" (near-miss, 1 edit in 7 chars)
-0.375 ← "elephant" vs "elefant" (phonetic confusion, 2 edits in 8 chars)
-0.50  ← "bark" vs "barked" (suffix error, 2 edits in 6 chars)
-0.643 ← "because" vs "becuz" (phonetic spelling, 3 edits in 7 chars)
-1.0   ← gap penalty (insertion or omission)
-1.50  ← "the" vs "mission" (completely different — worst substitution)
-2.0   ← insertion + omission pair (two gaps)
```

### The Critical Inequality

```
worst substitution (-1.50)  >  insertion + omission (-1.0 + -1.0 = -2.0)
```

This means: **a substitution is ALWAYS preferred over splitting the same word pair into an insertion and an omission.** Even if the words are completely unrelated, the aligner will still pair them rather than create two separate gaps.

Why this matters: without this guarantee, the aligner could "break" word pairs by deciding it's cheaper to delete the reference word and insert the hypothesis word separately. The texterrors author (Rua Braun) and the Borgholt 2025 paper both identify this as the key constraint.

### The 1.5× Multiplier: Why Not 1.0? Why Not 2.0?

**If multiplier = 1.0:**
- Worst substitution = -1.0 × 1.0 = -1.0
- This equals the gap penalty (-1.0)
- Problem: sub("the", "mission") costs -1.0, same as a single gap
- The aligner can't distinguish "expensive substitution" from "cheap gap" — ties everywhere

**If multiplier = 2.0:**
- Worst substitution = -2.0 × 1.0 = -2.0
- This equals the gap pair cost (-1.0 + -1.0 = -2.0)
- Problem: for completely dissimilar words, substitution cost equals gap pair cost — ties again
- Worse: any ratio > 0.0 makes substitution cheaper than gap pair, so "the"→"mission" (ratio ≈ 0) would still be preferred as substitution

**At 1.5×:**
- Worst substitution (-1.50) is firmly between single gap (-1.0) and gap pair (-2.0)
- Substitution always beats gap pair (no false splits)
- But a bad substitution (-1.50) is worse than a single gap (-1.0)
- This means: inserting a stray word is cheap, but the aligner won't pair it with an unrelated reference word

This is exactly the texterrors design. The 1.5 is not arbitrary — it's the unique multiplier that satisfies both `max_sub > gap_pair` and `max_sub > single_gap` simultaneously.

---

## 4. Worked Examples: ORF-Specific Scenarios

### Example A: Child reads "barked" as "bark" (morphological error)

```
Reference:  "The dog barked loudly"
Hypothesis: "The dog bark loudly"
```

```
scorePair("barked", "bark"):
  levenshtein("barked", "bark") = 2  (delete 'e', delete 'd')
  maxLen = 6
  ratio = 1 - 2/6 = 0.667
  score = -1.5 × 0.333 = -0.50
```

The aligner correctly pairs them (-0.50 is much better than -2.0 gap pair). Downstream diagnostics detect this as a **morphological error** (shared root "bark" ≥ 3 chars).

### Example B: Child says "she" where reference says "the" (short-word magnet effect)

```
Reference:  "the cat"
Hypothesis: "she cat"
```

```
scorePair("the", "she"):
  levenshtein("the", "she") = 1  (substitute 't' → 's')
  maxLen = 3
  ratio = 1 - 1/3 = 0.667
  score = -1.5 × 0.333 = -0.50
```

**Honest concern:** This is a cheap substitution (-0.50), so the aligner strongly prefers pairing "the" with "she." In this case that's correct — the child did substitute. But what if the reference were `"the she cat"` and hypothesis were `"she cat"`? The aligner might pair "she" with "the" (cost -0.50 + omit "she" at -1.0 = -1.50 total) instead of omitting "the" and matching "she" correctly (cost -1.0 + 0 = -1.0 total). Actually — the second option wins (-1.0 > -1.50), so the correct alignment prevails. The graded scoring doesn't create a problem here.

### Example C: Child reads "giraffe" as "griaffe" (letter transposition)

```
scorePair("giraffe", "griaffe"):
  levenshtein("giraffe", "griaffe") = 2  (transpose 'i' and 'r')
  maxLen = max(7, 8) = 8
  ratio = 1 - 2/8 = 0.75
  score = -1.5 × 0.25 = -0.375
```

Very cheap substitution. The aligner will never confuse this with a different word. Downstream diagnostics can flag it as a near-miss attempt (struggle pathway).

### Example D: Child says "a" where reference says "I" (single-char edge case)

```
scorePair("a", "i"):
  levenshtein("a", "i") = 1
  maxLen = 1
  ratio = 1 - 1/1 = 0.0
  score = -1.5 × 1.0 = -1.50
```

**This is the worst possible score** — identical to "the"→"mission." A single character that doesn't match gets maximum penalty because the ratio is 0. This is technically correct (the words share zero characters), but it means single-char words are always treated as maximally dissimilar unless they match exactly. For ORF, this is acceptable because single-char substitutions ("a" for "I", etc.) are rare and genuinely errors.

### Example E: Child reads "elephant" as "elefant" (phonetic spelling)

```
scorePair("elephant", "elefant"):
  levenshtein("elephant", "elefant") = 2  (ph→f, dropped 'h')
  maxLen = 8
  ratio = 1 - 2/8 = 0.75
  score = -1.5 × 0.25 = -0.375
```

The aligner strongly pairs these. This is the textbook case graded substitution was designed for — the child attempted the word, got close, and the scoring reflects that proximity.

### Example F: The "competition" scenario (the whole reason this exists)

```
Reference:  ["mission", "was"]
Hypothesis: ["the", "misson", "was"]
```

Child said "the misson was" — inserted "the" before attempting "mission."

Without graded scoring, "the" might consume the "mission" slot (both are equally bad substitutions at cost 1). With graded scoring:

```
Path A: ins("the"), sub("mission","misson"), match("was")
  = -1.0 + (-0.214) + 2.0 = +0.786

Path B: sub("mission","the"), sub("was","misson"), ???
  = -1.50 + (-1.50) + ??? = much worse
```

Path A wins. "misson" correctly aligns with "mission." "the" is flagged as an insertion. The teacher sees an accurate error report.

---

## 5. How Each Tool Would Handle the ORF Competition Scenario

Using the same example: ref=`["mission"]`, hyp=`["the", "misson"]`

| Tool | "mission"↔"the" cost | "mission"↔"misson" cost | ins("the") cost | ins("misson") cost | Winner | Correct? |
|------|---------------------|------------------------|----------------|-------------------|--------|----------|
| **SCLITE** | sub=4 | sub=4 | ins=3 | ins=3 | Tied (4+3=7 either way). Diagonal-first tie-break picks sub("mission","the") + ins("misson"). **Wrong.** | No |
| **JiWER** | sub=1 | sub=1 | ins=1 | ins=1 | Tied (1+1=2 either way). Del-first tie-break — outcome depends on traceback direction. **Unreliable.** | Maybe |
| **texterrors** | sub=1.5 | sub=0.214 | ins=1.0 | ins=1.0 | ins("the")+sub("misson")=1.214 vs sub("the")+ins("misson")=2.5. **Correct.** | Yes |
| **asr_eval** | sub=1 | sub=1 | ins=1 | ins=1 | n_errors tied. n_correct tied. char_errors breaks tie: charDist("mission","misson")=1 vs charDist("mission","the")=7. **Correct.** | Yes |
| **Pacer** | sub=-1.50 | sub=-0.214 | gap=-1.0 | gap=-1.0 | ins("the")+sub("misson")=-1.214 vs sub("the")+ins("misson")=-2.50. **Correct.** | Yes |

**Key insight:** SCLITE and JiWER genuinely cannot distinguish these. texterrors, asr_eval, and Pacer all can — through different mechanisms (graded cost, tuple tie-breaking, graded cost respectively).

---

## 6. Where This Approach Has Real Weaknesses

### Weakness 1: Function-Word Magnet Effect

Short common words share characters with other short words. The grading makes these substitutions cheaper than they "should" be:

| Pair | Edit Distance | Ratio | Score |
|------|--------------|-------|-------|
| "the" ↔ "she" | 1 | 0.667 | -0.50 |
| "the" ↔ "he" | 1 | 0.667 | -0.50 |
| "an" ↔ "in" | 1 | 0.50 | -0.75 |
| "a" ↔ "I" | 1 | 0.0 | -1.50 |
| "is" ↔ "it" | 1 | 0.50 | -0.75 |

"the"↔"she" at -0.50 means the aligner treats this substitution as equally plausible as "bark"↔"barked." For ORF, this is usually fine (both are genuine single-character errors), but it could cause surprising alignment in edge cases where a function word competes with a content word for the same slot.

**Mitigation (not currently implemented):** For words ≤ 2 characters, fall back to binary scoring (match or max penalty). This would prevent single-character words from being "magnetically" attracted to other short words.

### Weakness 2: Levenshtein ≠ Phonetic Similarity

Levenshtein operates on orthography (spelling), not phonology (sound). This means:

- "knight" ↔ "nite": edit distance = 3/6 → ratio = 0.50 → score = -0.75
- "knight" ↔ "night": edit distance = 1/6 → ratio = 0.833 → score = -0.25

The first pair sounds identical but gets a harsh score. The second pair sounds identical and gets a lenient score. The aligner doesn't "know" that both pairs represent correct pronunciation — it only sees character patterns.

For ORF this is partially mitigated by `getCanonical()` (word-equivalences.js), which maps known homophones to canonical forms. But the equivalence list is finite and manually maintained. POWER-ASR (Ruiz & Federico, 2015) addresses this properly with phoneme-level re-alignment, at significant additional complexity.

### Weakness 3: No Awareness of Reading Direction or Context

NW alignment is context-free — it doesn't know that in ORF, the child reads left-to-right and certain error patterns are more likely than others. For example:

- Repetitions ("the the the dog") follow a pattern: the repeated word appears immediately before the correct instance
- Self-corrections ("bog... dog") follow a pattern: the incorrect attempt appears before the correction
- Inserted function words ("the mission" → "the the mission") cluster around difficult words

The aligner treats all positions equally. Downstream diagnostics (near-miss resolution, self-correction detection) partially compensate, but the alignment itself doesn't benefit from these priors.

### Weakness 4: The "No Behavioral Change" Claim Is Overconfident

The original plan document states: *"Only behavioral change is better assignment of which hypothesis word fills each reference slot."*

This undersells the impact. Different word pairings cascade into:
- Different near-miss cluster boundaries (diagnostics.js)
- Different struggle pathway triggers (was this insertion part of a struggle?)
- Different omission recovery anchors (which cross-validator words match omitted ref words?)
- Different self-correction classifications (is this insertion a repeat or a self-correction?)

The format is identical (`{ref, hyp, type}`), but the content can differ substantially. Any downstream logic that depends on *which* words are paired — and all the diagnostic detectors do — will produce different results.

**This is not necessarily bad.** The different results should be *more correct* (because the alignment is more correct). But the plan document should have acknowledged this cascade rather than claiming no behavioral change.

### Weakness 5: Cross-Validation Uses a Different Aligner

`deepgram-api.js` uses `sequence-aligner.js` for cross-validation alignment (Reverb vs Parakeet). `alignment.js` uses graded NW for the main alignment (ref vs hyp). Two different alignment strategies on overlapping data could produce conflicting word pairings. If Parakeet hears "misson" and the cross-validator aligns it differently than the main aligner, timestamps and confirmation status may not correspond.

---

## 7. Comparison to asr_eval's Approach (January 2026)

The most advanced recent alternative is asr_eval (arXiv:2601.20992), which uses a **lexicographic 3-tuple** instead of a single scalar cost:

```
score = (n_errors, -n_correct, char_errors)
```

Compared lexicographically: minimize errors first, then maximize correct matches, then minimize character errors. This achieves the same tie-breaking effect as graded substitution but without modifying the substitution cost itself.

**Advantages of asr_eval over Pacer's approach:**
- WER number is always standard (errors / ref_length) — no non-standard scoring
- Multi-reference support (`{multivariate|multi-variate}`)
- Wildcard insertions (`<*>` matches any sequence at zero cost) — useful for disfluencies
- Relaxed insertion penalty (caps consecutive insertions at 4) — handles ASR hallucinations

**Advantages of Pacer's approach over asr_eval:**
- Simpler implementation (single scalar score, standard NW)
- Browser-compatible (JavaScript, no Python dependency)
- Graded cost directly feeds downstream diagnostics (near-miss detection uses the same similarity ratio)
- Already integrated with the full ORF pipeline (compound merging, struggle detection, etc.)

**Honest take:** asr_eval's tuple approach is more principled for WER computation. But Pacer isn't computing WER — it's computing a diagnostic alignment for ORF assessment. The graded substitution cost does double duty: it produces better alignments AND feeds the downstream near-miss/struggle detection pipeline. Switching to asr_eval's approach would require reimplementing all downstream similarity checks.

---

## 8. Summary Verdict

| Aspect | Assessment |
|--------|-----------|
| **Core algorithm** | Sound. Standard NW, well-understood, O(m×n). |
| **Graded substitution** | Proven technique (texterrors). Solves a real problem. |
| **1.5× multiplier** | Mathematically justified. Satisfies the critical inequality. |
| **ORF suitability** | Good. Compound merging + struggle detection go beyond any standard tool. |
| **Short-word edge cases** | Minor weakness. Could be mitigated with binary fallback for ≤2 chars. |
| **Phonetic vs orthographic** | Real limitation. Partially mitigated by getCanonical() equivalences. |
| **Downstream cascade** | Underacknowledged. Different alignments produce different diagnostics. |
| **Cross-validator divergence** | Unaddressed. Two aligners on overlapping data could conflict. |
| **Performance** | Fine for ORF passages (<300 words). Would not scale to full documents. |
| **vs. SCLITE** | Pacer handles the competition scenario that SCLITE cannot. |
| **vs. asr_eval** | asr_eval is more principled for WER. Pacer is more practical for ORF diagnostics. |

**Bottom line:** The approach is well-founded, solves a real problem that uniform-cost tools cannot, and is appropriate for the ORF use case. The weaknesses are real but manageable. The biggest risk isn't the algorithm — it's the underacknowledged downstream cascade when alignment pairings change.
