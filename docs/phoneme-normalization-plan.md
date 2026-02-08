# Phoneme-Based Duration Normalization — Implementation Plan

**Date:** 2026-02-07 (updated with research findings)
**Depends on:** Word Speed Map (implemented), Metric 4 `computeWordDurationOutliers()`, `syllable-counter.js`
**Affects:** `diagnostics.js` (Metric 4 + word speed tiers), `ui.js` (tooltip), debug JSON

---

## The Problem from First Principles

### What we are measuring

The word speed map answers one question per word: **"Did this student read this word slower or faster than their own typical pace?"** We answer it by computing a ratio:

```
ratio = (actual duration of this word) / (student's median duration per unit)
```

The ratio depends entirely on what "per unit" means. We need a unit that normalizes for the intrinsic length of the word — otherwise long words always look slow and short words always look fast, regardless of fluency.

### Why we need normalization at all

"Spreadsheet" naturally takes longer to say than "cat" even at identical fluency. Without normalization, every polysyllabic word would skew slow and every monosyllable would skew fast. The normalizer's job is to divide out the word's intrinsic articulatory cost so the ratio reflects only the student's speed, not the word's length.

### What our current normalizer does

We normalize by **syllable count** (via `syllable-counter.js`):

```
normalizedMs = durationMs / syllableCount
```

Syllable count is a reasonable first-order approximation. Speech is produced in syllable-sized articulatory gestures — each syllable is roughly one jaw open-close cycle. For most words, this works well. "Elephant" (3 syllables) should take roughly 3x as long as "cat" (1 syllable), and it does.

### Where it breaks down

Syllables are not all the same size. A syllable is a vowel nucleus plus optional onset and coda consonants. The consonant structure varies enormously:

| Word | Syllables | Phonemes | Phonemes/syllable | Structure |
|------|-----------|----------|-------------------|-----------|
| "baby" | 2 | 4 (/b.eɪ.b.i/) | 2.0 | Simple CV.CV |
| "cat" | 1 | 3 (/k.æ.t/) | 3.0 | Simple CVC |
| "spreadsheet" | 2 | 8 (/s.p.r.ɛ.d.ʃ.iː.t/) | 4.0 | Dense CCCVC.CVVC |
| "strengths" | 1 | 8 (/s.t.r.ɛ.ŋ.k.θ.s/) | 8.0 | Extreme CCCVCCCCC |

Each consonant requires articulatory effort — lip closure, tongue placement, airflow coordination. Onset clusters like /spr/ require three separate gestural targets sequenced in ~150-200ms. A syllable with a /spr/ onset and /d/ coda is intrinsically longer than a simple CV syllable, even at identical speaking rate — though the exact per-consonant addition is complicated by gestural overlap (see research notes below).

**The practical consequence:** "Spreadsheet" said fluently at 1120ms = 560ms/syllable. With a student median of 320ms/syllable, that's a 1.75x ratio — exactly at the "struggling" threshold (orange). But those 2 syllables contain 8 phonemes. At 140ms/phoneme, compared to an estimated median of ~119ms/phoneme, the ratio would be ~1.18x — solidly in "steady" territory (green). The student read the word fluently, but the syllable-based metric penalizes it for being phonetically dense.

### The core issue

**Syllable count is a coarse-grained proxy for articulatory cost.** It works when phonemes-per-syllable is roughly constant across the vocabulary (which it is for most words — English averages ~2.7 phonemes/syllable based on CMUdict mean). It fails for outlier words with high consonant density. These words are not rare — "strengths", "spreadsheet", "scratched", "splashed", "glimpsed" are all common in grade 1-8 passages.

### What the research says

- **Baker & Bradlow (2009)** used phoneme count (not syllable count) as their control for word length, noting that *"syllables fail to capture the variation in length between words with the same syllable count."* (Verified — exact quote from the paper.)
- **Bell et al. (2009)** found the best single predictor of word duration is a phoneme-weighted expected duration — once you account for phoneme-level length, syllable count adds little further explanatory power. (Their measure is technically "log of averaged word length from a pronunciation dictionary," which correlates strongly with phoneme count.)
- **Klatt (1976, 1979)** established that each phoneme has an intrinsic duration (INHDUR) with contextual multipliers (PRCNT): vowels ~130ms stressed, ~70ms unstressed; fricatives ~90ms; stops ~70ms including closure. These intrinsic durations are the atomic units of speech timing. The Klatt model also accounts for cluster compression — consonants surrounded by other consonants are shortened by ~50% (PRCNT=0.5), which is why raw phoneme count is a better normalizer than weighted-phoneme duration (see "Why not weighted phonemes?" below).
- **Pouplier & Marin (2014)** studied consonant cluster timing using articulatory data. Their work shows that clusters exhibit significant gestural overlap — consonants in clusters do add duration, but less than their isolated intrinsic duration would predict due to coarticulatory compression. The per-consonant addition is not a fixed constant but varies with cluster composition.

### What we want instead

Normalize by **phoneme count** — a finer-grained measure of articulatory cost that captures consonant density. This preserves the self-relative design (ratio to student's own median) while eliminating the bias against phonetically dense words.

```
Current:   normalizedMs = durationMs / syllableCount       → ms/syllable
Proposed:  normalizedMs = durationMs / phonemeCount         → ms/phoneme
```

The tier thresholds and the rest of the system stay the same — only the normalizer changes.

### Why not weighted phonemes?

A natural question: if different phonemes have different intrinsic durations (Klatt 1976), shouldn't we weight them accordingly? For example, normalize "cat" by the sum of intrinsic durations for /k/+/æ/+/t/ rather than just dividing by 3?

**We investigated this and decided against it.** The reason:

1. **Klatt's model includes cluster compression rules** (PRCNT=0.5 for C→CC context). Consonants in clusters are 30-50% shorter than in isolation. A naive weighting using isolated-phoneme durations would *overestimate* the expected duration of cluster-heavy words, introducing a new bias in the opposite direction.
2. **Implementing compression-aware weighting** requires knowing the full phoneme sequence (not just the count) and applying context-dependent rules — significantly more complexity for marginal gain.
3. **Raw phoneme count already captures the key variance.** The syllable→phoneme switch fixes the ~2-4:1 ratio bias between sparse and dense syllables. Weighting would further correct a ~1.3:1 residual bias — diminishing returns.
4. **Self-relative design absorbs systematic bias.** Since we compare to the student's own median, any consistent per-phoneme overcount or undercount cancels out in the ratio. The normalizer doesn't need to be *accurate in absolute terms* — it needs to be *consistent across words*.

**Bottom line:** Raw phoneme count is the sweet spot between accuracy and complexity. It captures the consonant-density variance that syllable count misses, without requiring the full complexity of a duration model.

---

## Solution: CMUdict Phoneme Lookup

The **CMU Pronouncing Dictionary** (CMUdict) is a machine-readable pronunciation dictionary mapping English words to sequences of ARPAbet phonemes with stress markers. It has 134,000+ entries covering essentially all words that appear in grade 1-8 reading passages.

### Why CMUdict over alternatives

| Approach | Accuracy | Cost | Drawback |
|----------|----------|------|----------|
| Syllable count (current) | Perfect syllable count, wrong normalizer | Zero | Penalizes consonant-dense words |
| Character count | ~85% correlation with phoneme count | Zero | Silent letters, digraphs; "through"=7 chars, 3 phonemes |
| Rule-based G2P heuristic | ~90% phoneme accuracy | Small code | Errors on irregular words; estimating count is easier than exact pronunciation but still noisy |
| **CMUdict lookup** | **Exact phoneme count** | **~800KB uncompressed, ~200-400KB gzipped** | Misses rare words — needs fallback |
| Full neural G2P | ~98% | Heavy (model weights) | Overkill for counting phonemes |

CMUdict gives exact phoneme counts with zero ambiguity for its 134K vocabulary. Combined with a fallback for unknown words, this is the right tradeoff for a client-side tool.

### Coverage verification

We tested CMUdict coverage against words from grade 2, 5, and 8 reading passages. **Hit rate: 100%.** All words in the tested passages were found in CMUdict, including words like "splashed", "scratched", "glimpsed", and other consonant-dense words that motivated this change. Proper nouns and invented words are the main gap, but these are rare in standardized reading passages and are handled by the fallback.

### What we extract from CMUdict

We only need the **phoneme count** per word — not the actual phoneme sequence, stress pattern, or pronunciation variants. This dramatically simplifies the integration: we precompute a word → count lookup.

Example CMUdict entries:
```
SPREADSHEET  S P R EH1 D SH IY1 T          → 8 phonemes
BABY         B EY1 B IY0                    → 4 phonemes
CAT          K AE1 T                        → 3 phonemes
STRENGTHS    S T R EH1 NG K TH S           → 8 phonemes
PERFECTLY    P ER0 F AH0 K T L IY0         → 8 phonemes
SHAREABLE    SH EH1 R AH0 B AH0 L          → 7 phonemes
```

### Empirical phonemes-per-syllable statistics (from CMUdict)

These numbers inform the fallback heuristic:

| Statistic | Value | Notes |
|-----------|-------|-------|
| Type-weighted mean (each word counted once) | 2.71 | Standard least-squares estimator |
| Type-weighted median | 2.50 | Robust to outliers but biased low for prediction |
| Ratio of totals (Σphonemes / Σsyllables) | 2.5837 | 799853 / 309581 — minimizes total squared estimation error |

**Which statistic to use as the fallback multiplier?** The fallback formula `estimatedPhonemes = syllables * X` is a prediction of a sum (total phonemes in the word). Sums scale with means, not medians. The median (2.50) systematically underestimates phoneme count, making fallback words look artificially slower. The mean (2.71) is the correct estimator.

**The most principled approach:** Compute the exact ratio `Σphonemes / Σsyllables` across all CMUdict entries during the one-time data extraction step, and hard-code that value as `PHONEMES_PER_SYLLABLE_RATIO` in `phoneme-counter.js`. This is the regression-through-origin slope — the single number that minimizes total squared phoneme-count estimation error. It is computed from data, not chosen by hand, and is self-documenting.

---

## Implementation Plan

### Phase 1: Add CMUdict phoneme count module

**New file:** `js/phoneme-counter.js`

**Contents:**
1. A phoneme count lookup — either:
   - **(a)** Ship a pre-extracted `word → phonemeCount` JSON map (smaller than full dict; ~200-400KB gzipped since we only need one integer per word)
   - **(b)** Ship the full CMUdict and count phonemes at runtime (`entry.split(' ').length`)
   - **(c)** Use the `cmu-pronouncing-dictionary` npm package if we have a build step, or vendor the data directly

   Recommendation: **(a)** — precompute a `{ "spreadsheet": 8, "baby": 4, ... }` JSON map offline, ship it as a static asset. Smallest size, fastest lookup, no parsing at runtime.

2. A `getPhonemeCount(word)` export function:
   ```
   getPhonemeCount("spreadsheet")  → 8
   getPhonemeCount("baby")         → 4
   getPhonemeCount("xyzzy")        → null  (not in CMUdict)
   ```

3. A `PHONEMES_PER_SYLLABLE_RATIO` constant, computed during data extraction as `Σphonemes / Σsyllables` across all CMUdict entries (~2.7). Hard-coded alongside the lookup data.

4. A fallback heuristic for words not in CMUdict:
   - Use `countSyllables(word) * PHONEMES_PER_SYLLABLE_RATIO` (empirical mean from CMUdict)
   - This degrades gracefully to approximately the current behavior for unknown words
   - Log a console warning for unknown words so we can expand coverage over time

**Data preparation (offline, one-time):**
- Download CMUdict from `https://github.com/cmusphinx/cmudict`
- Parse `cmudict.dict`, extract first pronunciation variant per word
- Count phonemes (space-separated tokens, excluding comments)
- Handle multi-word entries and variants (take first pronunciation)
- Compute `PHONEMES_PER_SYLLABLE_RATIO = Σphonemes / Σsyllables` across all entries (expected ~2.7)
- Output: `data/cmudict-phoneme-counts.json` — a flat `{ word: count }` object, plus the computed ratio
- Strip stress markers from count (they don't affect count, only quality)

### Phase 2: Integrate into Metric 4 and Word Speed Tiers

**File:** `js/diagnostics.js`

**Changes to `computeWordDurationOutliers()` (Metric 4):**

Currently (line 1158-1159):
```js
const syllables = countSyllables(wordText);
const normalizedDurationMs = durationMs / Math.max(syllables, 1);
```

Change to:
```js
const phonemes = getPhonemeCount(wordText);
const syllables = countSyllables(wordText);
const normalizer = phonemes || Math.round(syllables * PHONEMES_PER_SYLLABLE_RATIO); // fallback
const normalizedDurationMs = durationMs / Math.max(normalizer, 1);
```

**Changes to `computeWordSpeedTiers()`:**

Currently (line 1381-1382):
```js
const syllables = countSyllables(refText);
const normalizedMs = Math.round(durationMs / Math.max(syllables, 1));
```

Change to:
```js
const phonemes = getPhonemeCount(refText);
const syllables = countSyllables(refText);
const normalizer = phonemes || Math.round(syllables * PHONEMES_PER_SYLLABLE_RATIO); // fallback
const normalizedMs = Math.round(durationMs / Math.max(normalizer, 1));
```

**Key invariant:** Both functions must use the same normalizer so that Metric 4 baseline and word speed tiers are consistent. The baseline median becomes ms/phoneme instead of ms/syllable.

**Short-word tier threshold change:**

Currently, words with `syllables < 2` get the `short-word` tier (monosyllables are unreliable per-syllable). With phoneme normalization, monosyllabic words have much more meaningful normalization — "strengths" (8 phonemes) is genuinely different from "a" (1 phoneme).

New threshold: `phonemes <= 3` → `short-word` tier. This catches:
- Function words with 1-2 phonemes: "a" (1), "I" (2), "oh" (2)
- Bare CV/VC/CVC words with 3 phonemes: "cat" (3), "the" (2), "to" (2)

And allows monosyllables with 4+ phonemes to be meaningfully classified:
- "strengths" (8), "jumped" (5), "think" (4), "world" (4)

**Note:** The `<= 3` threshold (not `< 3`) ensures that simple CVC words like "cat" are still classified as short-word, since their durations are dominated by coarticulation and provide little meaningful speed signal.

### Phase 3: Recalibrate tier thresholds

The tier thresholds were tuned for ms/syllable ratios. Ms/phoneme ratios will have a different distribution because phoneme counts are higher (and less variable) than syllable counts. The ratio variance should be **smaller** with phoneme normalization (more precise normalizer → less noise).

**Approach:**
1. Run the updated pipeline against existing test recordings
2. Check the distribution of ratios — the median should still be ~1.0 by construction
3. The current thresholds (0.75, 1.25, 1.75, 2.50) may still work if the variance compression isn't dramatic
4. If needed, tighten thresholds (e.g., 0.80, 1.20, 1.60, 2.25) based on empirical data
5. The key test: "spreadsheet" at 1120ms should land in steady or slow, not struggling

**Expected effect on the "spreadsheet" case:**
- Phoneme count: 8
- Duration: 1120ms
- Normalized: 1120 / 8 = 140ms/phoneme
- Student median: previously 320ms/syl → with phonemes at ~2.7 phonemes/syl, estimated ~119ms/phoneme (320ms/syl / 2.7)
- Ratio: 140 / 119 = 1.18x → **steady** (currently: 1.75x → struggling)

### Phase 4: Update tooltip and debug output

**Tooltip changes** (`buildWordSpeedTooltip` in `ui.js`):
- Show both phoneme count and syllable count: `"spreadsheet" — 8 phonemes, 2 syllables`
- Show normalized duration: `140ms/phoneme (vs median 119ms/phoneme)`
- Keep ratio display: `1.18x median`
- **New:** Flag sentence-final words: `"(sentence-final — duration may be inflated)"` (see Known Confounds)

**Debug JSON changes** (`app.js` timestamp_sources stage):
- Add `phonemes` field per word alongside existing data
- Add `normalizerUsed: 'cmudict' | 'fallback'` to indicate source

**Metric 4 baseline output changes:**
- Rename `medianDurationPerSyllable` → `medianDurationPerPhoneme` (or add alongside)
- Add `normalizationUnit: 'phoneme'` to baseline metadata

### Phase 5: Sentence-final lengthening flag

**The problem:** Research shows that utterance-final words are lengthened by approximately 59% in English (Wightman et al., 1992; Turk & Shattuck-Hufnagel, 2007). This is a prosodic effect independent of word length or reading fluency — the speaker naturally slows at phrase and sentence boundaries. This is a **larger confound than consonant density** and affects every passage.

**What this means for the word speed map:** The last word of each sentence will consistently register as "slow" or "struggling" even when the student is reading fluently. This is a false positive caused by normal prosody, not a reading difficulty.

**Approach — flag, don't correct:**
We flag sentence-final position in the tooltip rather than attempting mathematical correction. The correction factor varies with speaking rate, sentence length, and prosodic phrasing, making it unreliable to estimate from a single ratio. Flagging is honest and informative.

**Implementation:**
1. In `computeWordSpeedTiers()`, detect sentence-final words by checking if the reference word is followed by sentence-ending punctuation (`.`, `?`, `!`) in the passage text.
2. Add a `sentenceFinal: true` flag to the word's speed tier data.
3. In the tooltip, append: `"(sentence-final — duration may be inflated)"` when the flag is set.
4. Do NOT exclude sentence-final words from tier classification or from the atPacePercent denominator — they are still valid data, just annotated.

**Why not exclude or correct?**
- Exclusion would remove ~15-20% of words (every sentence-final word), significantly reducing data density.
- Mathematical correction requires knowing the student's sentence-final lengthening factor, which varies by student, sentence length, and reading proficiency.
- Flagging preserves all data while giving the assessor context to interpret it.

### Phase 6: Update syllable-counter.js header comment

The header comment in `syllable-counter.js` (lines 1-27) argues that syllable count is the correct normalizer. This was true as a first-order approximation. Update the comment to note that phoneme count is now the primary normalizer, with syllable count used as the fallback estimator (via the `PHONEMES_PER_SYLLABLE_RATIO` multiplier) for words not in CMUdict.

---

## Known Confounds (Not Addressed in This Plan)

The phoneme normalization change addresses the largest source of per-word measurement error (consonant density bias). Two additional confounds are documented here for future consideration but are **not in scope** for this implementation:

### Word frequency effect
High-frequency words are read 20-60ms faster per fixation than low-frequency words of the same length (Rayner, 1998; Balota et al., 2004). Common words like "the", "said", "was" will consistently register as "quick" not because the student reads them exceptionally fast, but because everyone reads frequent words faster.

**Why not address now:** Requires a word-frequency database and a frequency-dependent correction factor. The self-relative design already partially absorbs this (frequent words dominate the median, so the baseline reflects a frequency-weighted speaking rate). The remaining bias is small and consistent across students.

### Pre-word pause duration
Goldman-Eisler (1968) found that pause time accounts for 40-60% of total reading time and correlates r=-.94 with fluency, compared to r=-.17 for articulation rate alone. Long pauses before words are a stronger signal of decoding difficulty than slow articulation of the word itself.

**Why not address now:** The current word speed map measures word articulation duration, not pre-word pause. These are complementary signals. Adding pause analysis would be a separate feature (potentially a "hesitation map"), not a modification to the word speed map's normalization.

---

## What does NOT change

- **Tier names and colors.** Quick/steady/slow/struggling/stalled remain the same.
- **Self-relative design.** The ratio is still actual/median for this student. We are not comparing to population norms.
- **Timestamp source.** Cross-validator (Parakeet) timestamps remain primary.
- **Omission/insertion handling.** Unchanged.
- **Disfluency/self-correction skipping.** Unchanged.
- **The word speed map UI.** Same layout, same legend, same rendering. Only the underlying numbers change.

---

## File change summary

| File | Change |
|------|--------|
| `js/phoneme-counter.js` | **New.** `getPhonemeCount(word)` with CMUdict lookup + fallback. |
| `data/cmudict-phoneme-counts.json` | **New.** Pre-extracted `{ word: phonemeCount }` map (~800KB uncompressed). |
| `js/diagnostics.js` | Replace `countSyllables()` normalizer with `getPhonemeCount()` in Metric 4 and word speed tiers. Update short-word threshold to `phonemes <= 3`. |
| `js/ui.js` | Update tooltip to show phoneme count. Add sentence-final flag to tooltip. |
| `js/app.js` | Add phoneme count to debug JSON timestamp_sources. |
| `js/syllable-counter.js` | Update header comment only. |
| `js/miscue-registry.js` | No change — this is not a miscue type. |

---

## Risks and mitigations

**Risk: CMUdict missing words in reading passages.**
Children's reading passages may include proper nouns, invented words, or rare vocabulary not in CMUdict. Mitigation: the fallback heuristic (`syllables * PHONEMES_PER_SYLLABLE_RATIO`) degrades gracefully to approximately current behavior. Coverage testing showed 100% hit rate on grade 2, 5, and 8 passages. We can also add a small exception dictionary for common passage words not in CMUdict, similar to the syllable counter's exception dictionary.

**Risk: Baseline shift breaks existing assessments.**
Switching from ms/syllable to ms/phoneme changes all normalized values. Historical debug JSON becomes harder to compare. Mitigation: add `normalizationUnit` to debug output so the reader knows which system produced the numbers. The tier assignments (the user-facing output) will be more accurate, which is the goal.

**Risk: Bundle size increase.**
The pre-extracted phoneme-count map is just `{ word: number }` with no pronunciation strings. Estimated ~800KB uncompressed, ~200-400KB gzipped. For a local tool this is negligible.

**Risk: Tier threshold recalibration needed.**
The ratio distribution will be different with phoneme normalization (tighter variance). Mitigation: run against existing test recordings before shipping. The thresholds may not need changing at all — the ratio is still self-relative, so the median is still 1.0 by construction.

**Risk: Sentence-final words flagged but not corrected.**
Assessors may wonder why sentence-final words are flagged but still colored. Mitigation: the tooltip text explains this clearly. Full correction would require per-student prosodic modeling, which is out of scope.

---

## Verification

After implementation, verify with these test cases:

1. **"spreadsheet" (1120ms, 8 phonemes, 2 syllables):** Should be steady or slow, not struggling.
2. **"cat" (250ms, 3 phonemes, 1 syllable):** Should be `short-word` tier (`phonemes <= 3`).
3. **"strengths" (800ms, 8 phonemes, 1 syllable):** Should be meaningfully classified (NOT short-word). Previously would have been short-word as a monosyllable. With 8 phonemes, 800/8=100ms/phoneme gives a meaningful ratio.
4. **"perfectly" (2640ms, 8 phonemes, 3 syllables):** Ratio should reflect genuine struggle. With phonemes: 2640/8=330ms/phoneme, 330/119=2.77x. Stalled — correctly identified. Phoneme normalization doesn't rescue genuinely slow words.
5. **A word NOT in CMUdict:** Should fall back to `syllables * PHONEMES_PER_SYLLABLE_RATIO` estimate without crashing.
6. **Sentence-final word:** Tooltip should show the sentence-final flag. Duration may register as slow — the flag contextualizes this for the assessor.
7. **Overall atPacePercent:** Should be comparable to or slightly higher than current (fewer false-positive "struggling" words from consonant-dense vocabulary).

---

## Research references

- Baker, R. E., & Bradlow, A. R. (2009). Variability in word duration as a function of probability, speech style, and prosody. *Language and Speech*, 52(4), 391-413. — Used phoneme count as word length control; confirmed syllable count is inadequate.
- Bell, A., Brenier, J. M., Gregory, M., Girand, C., & Jurafsky, D. (2009). Predictability effects on durations of content and function words in conversational English. *Journal of Memory and Language*, 60(1), 92-111. — Best single predictor of word duration is phoneme-weighted length.
- Goldman-Eisler, F. (1968). *Psycholinguistics: Experiments in Spontaneous Speech.* London: Academic Press. — Pause proportion correlates r=-.94 with fluency vs r=-.17 for articulation rate.
- Klatt, D. H. (1976). Linguistic uses of segmental duration in English: Acoustic and perceptual evidence. *JASA*, 59(5), 1208-1221. — Established intrinsic phoneme durations (INHDUR) and contextual rules (PRCNT).
- Klatt, D. H. (1979). Synthesis by rule of segmental durations in English sentences. In *Frontiers of Speech Communication Research* (pp. 287-299). — Extended duration model with cluster compression rules.
- Pouplier, M., & Marin, S. (2014). The role of sonority in the articulation of onset clusters. *Proceedings of the 10th ISSP*. — Gestural overlap in consonant clusters; per-consonant duration is not a fixed additive constant.
- Turk, A. E., & Shattuck-Hufnagel, S. (2007). Multiple targets of phrase-final lengthening in American English words. *Journal of Phonetics*, 35(4), 445-472. — Sentence-final lengthening affects multiple segments.
- Wightman, C. W., Shattuck-Hufnagel, S., Ostendorf, M., & Price, P. J. (1992). Segmental durations in the vicinity of prosodic phrase boundaries. *JASA*, 91(3), 1707-1717. — Quantified ~59% lengthening at utterance boundaries.
