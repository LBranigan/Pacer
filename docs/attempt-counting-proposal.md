# Proposal: Explicit Per-Word Attempt Counting

**Inspired by:** Montoya-Gomez et al., "Refined Analysis of Reading Miscues" (SLaTE 2025)
**Status:** Proposal
**Date:** 2026-02-17

---

## 1. What the Paper Does

The SLaTE 2025 paper presents a WFST-based (Weighted Finite-State Transducer) system for Dutch reading miscue analysis that works at the **phoneme level**. It introduces two metrics:

- **AD.Err (Attempt Detection Error Rate):** Measures how accurately the system counts the number of oral attempts a student makes at each word, compared to human annotations.

  ```
  AD.Err = sum(|h_w - r_w|) / sum(r_w)
  ```

  where `h_w` = system's attempt count for word w, `r_w` = human-annotated attempt count.

- **AC.Err (Attempt Class Error Rate):** Measures whether each attempt is correctly classified (correct beginning, incorrect ending, full-word match, etc.).

Their WFST prompt model has explicit **repetition arcs** that allow a word to be re-entered after completion, directly modeling multiple attempts. Their results: AD.Err ranges from **5.5% to 14.6%** across difficulty levels (best on harder texts where readers are more fluent, worst on SRT-1 where young readers produce many fragmented attempts).

## 2. What PACER Currently Captures

PACER already captures rich per-word attempt data, but it's scattered across multiple flags rather than surfaced as a single count. Here's what exists:

### Data Already on Alignment Entries

| Flag | What It Represents | Example |
|---|---|---|
| `_partOfStruggle` | Insertion is a failed attempt fragment for an adjacent ref word | "bar" before "barracuda" |
| `_nearMissEvidence[]` | Array of near-miss insertion fragments on the struggle entry | `["bar", "bara"]` for ref "barracuda" |
| `_fullAttempt[]` | Reconstructed multi-part attempt (struggle fragments + final hyp) | `["bar", "a", "coda"]` |
| `_fullAttemptJoined` | Concatenated attempt string | `"baracoda"` |
| `_fullAttemptRatio` | Levenshtein similarity to reference (0-1) | `0.75` |
| `_syllableCoverage` | Which syllables the student produced | `{covered: [1,2,4], total: 4}` |
| `compound: true` / `parts[]` | Multi-token word (ASR split, not necessarily struggle) | `["every", "one"]` for "everyone" |
| `_v1RawAttempt[]` | Full V1 token sequence at this ref position | `["the", "ther", "there"]` |
| `_hesitationGap` | Pause duration before the word (seconds) | `3.2` |
| `_abandonedAttempt` | Student started but gave up | `true` |
| `_recovered` | V1 omitted but cross-validator heard it | `true` |
| `_isSelfCorrection` | Insertion is a successful retry of a previous word | `true` |

### What's Missing

The data exists but there's **no single `attemptCount` field** and **no aggregate metric**. A teacher looking at the results can see struggle annotations and syllable coverage, but cannot quickly answer: "How many times did this student try to say 'barracuda'?"

## 3. Proposed Feature: `_attemptCount` Per Word

### 3.1 Derivation Logic

For each reference word in the alignment, compute:

```javascript
function countAttempts(entry, alignment, index) {
  // Base: 1 attempt for the final word (correct, substitution, or struggle)
  // Exception: omission = 0 attempts (student skipped)
  if (entry.type === 'omission' && !entry._recovered) return 0;

  let count = 1; // the final attempt (whatever the ASR heard as the primary hyp)

  // Count preceding _partOfStruggle insertions
  for (let j = index - 1; j >= 0; j--) {
    const e = alignment[j];
    if (e.type === 'insertion' && e._partOfStruggle) count++;
    else break;
  }

  // Count following _partOfStruggle insertions
  for (let j = index + 1; j < alignment.length; j++) {
    const e = alignment[j];
    if (e.type === 'insertion' && e._partOfStruggle) count++;
    else break;
  }

  // Self-corrections: if a _isSelfCorrection insertion exists for this word,
  // it means the student said the word again after an error — that's another attempt
  for (let j = index + 1; j < alignment.length; j++) {
    const e = alignment[j];
    if (e.type === 'insertion' && e._isSelfCorrection && e._nearMissTarget === entry.ref) {
      count++;
    }
    if (e.type !== 'insertion') break;
  }

  return count;
}
```

### 3.2 Where to Surface It

1. **Alignment entry:** `entry._attemptCount = N` (computed in diagnostics.js or app.js post-alignment)
2. **Tooltip:** Add line like `Attempts: 3` (or omit if 1 — most words are 1)
3. **Word speed map:** Could color-code or annotate high-attempt words
4. **Summary metric:** Total attempts / total words = Attempt Density (analogous to paper's metric)
5. **AI layer:** The `_attemptCount` field feeds directly into per-word story generation

### 3.3 Aggregate Metric: Attempt Density

```javascript
const totalAttempts = alignment
  .filter(e => e.type !== 'insertion')
  .reduce((sum, e) => sum + (e._attemptCount || 1), 0);
const totalWords = alignment.filter(e => e.type !== 'insertion').length;
const attemptDensity = totalAttempts / totalWords;
// 1.0 = perfect fluency (every word read once)
// 1.3 = 30% more attempts than words (moderate struggle)
```

## 4. Honest Assessment

### What Works Well

**Low implementation cost.** The data already exists in PACER's pipeline. This is essentially a counting pass over existing flags, plus a tooltip line and maybe a summary stat. Estimated effort: a few hours of coding, mostly in diagnostics.js and ui.js.

**Teacher-friendly output.** "3 attempts at this word" is immediately understandable. Teachers already think in terms of "how many tries did they need?" — this maps directly to their mental model.

**AI layer value.** An explicit attempt count per word is exactly the kind of structured data that makes AI-generated reading narratives more precise. Instead of "the student struggled with 'barracuda'", the AI can say "the student made 3 attempts at 'barracuda', producing the first syllable correctly twice before completing the word on the third try."

### What's Genuinely Difficult

**ASR artifacts inflate attempt counts.** This is the fundamental problem. PACER's ASR engines (Reverb/Parakeet) produce artifacts that look like attempts but aren't:

- **BPE fragmentation:** "platforms" → "plat" + "forms" looks like 2 attempts but is just tokenization
- **CTC repetition:** Reverb's CTC decoder sometimes emits the same token twice due to frame-level alignment, not because the student said it twice
- **Hallucinated insertions:** The ASR might insert a phantom word that looks like a partial attempt
- **Compound splitting:** "everyone" → "every" + "one" is correct reading, not 2 attempts

PACER already filters most of these (compound merging, CTC artifact detection, disfluency classification), but the filtering isn't perfect. **An attempt count of 3 might really be 2 attempts + 1 artifact.** The paper's own AD.Err of 5-14% shows that even purpose-built systems with phoneme-level WFST alignment can't get this perfectly right.

**No ground-truth validation.** The paper had CHOREC annotations with human-labeled attempt counts per word. PACER has no equivalent — we'd be building the feature without a way to measure its accuracy. We'd know the number is *plausible* but not whether it's *correct*.

**Word-level vs. phoneme-level granularity.** The paper works at the phoneme level, which means it can detect partial attempts within a word (e.g., producing just the first two phonemes before restarting). PACER works at the word level — it sees "bar" as a separate token, not as "the first 3 phonemes of barracuda." This means:

- PACER can count how many *tokens* the student produced near a word
- But it can't distinguish between a genuine partial attempt ("bar...barracuda") and an unrelated insertion that happens to be phonetically similar

The `_nearMissEvidence` and `_fullAttemptRatio` filters help, but they're heuristic, not phoneme-aligned.

**Silent/unclear attempts are invisible.** If a student mouths a word silently, whispers, or produces a very brief vocalization that the ASR doesn't pick up, that attempt is lost. The paper acknowledges the same problem (their AD.Err is worst for young readers who produce many sub-phonemic attempts).

### What's Different from the Paper

| Aspect | Paper (WFST) | PACER |
|---|---|---|
| Level | Phoneme | Word/token |
| Alignment | Purpose-built WFST with repetition arcs | Needleman-Wunsch + post-hoc struggle detection |
| Attempt detection | Built into the aligner's grammar | Inferred from insertion patterns after alignment |
| Language | Dutch (phonetically regular) | English (phonetically irregular) |
| Validation | CHOREC human annotations | None available |
| Engine count | 1 ASR model | 3 engines (consensus) |

PACER's multi-engine consensus is actually an advantage here: if two engines independently hear "bar" before "barracuda", it's almost certainly a real attempt, not an artifact. The paper's single-engine approach has no such cross-check.

### Net Verdict

**Worth doing, with caveats displayed.** The attempt count should be surfaced with appropriate uncertainty signaling:

- Show the count but don't overstate its precision
- In tooltips, show the evidence (the actual fragments that contributed to the count)
- In the summary metric, present Attempt Density as approximate ("~1.2 attempts/word")
- For the AI layer, provide both the count and the raw evidence so the AI can reason about confidence

The feature is **most useful for words with >= 3 attempts**, where the signal is unambiguous — multiple fragments that clearly show the student trying the word repeatedly. For 2-attempt words, there's more noise, but the `_fullAttemptRatio` and cross-validation data help distinguish real attempts from artifacts.

## 5. Implementation Plan

### Step 1: Compute `_attemptCount` (diagnostics.js)

Add a pass after `resolveNearMissClusters()` and `absorbMispronunciationFragments()` that walks the alignment and counts attempts per ref word using the logic in 3.1. Store as `entry._attemptCount`.

### Step 2: Surface in Tooltip (ui.js)

For words with `_attemptCount >= 2`, add a tooltip line:
```
Attempts: 3 (bar + bara + barracuda)
```
showing the count and the evidence fragments.

### Step 3: Summary Metric (metrics.js)

Compute Attempt Density and add to the metrics output:
```
Attempt Density: 1.15 (~15% retry rate)
Words with multiple attempts: 7/142
```

### Step 4: Miscue Registry (miscue-registry.js)

Add `multipleAttempts` entry tracking words with `_attemptCount >= 2`.

### Step 5: AI Layer Annotation

Ensure `_attemptCount` is included in the per-word data passed to the AI summarizer, alongside `_fullAttempt` and `_syllableCoverage` for narrative generation.

## 6. What This Does NOT Do

- **Does not replicate the paper's phoneme-level WFST approach.** That would require a fundamentally different ASR pipeline.
- **Does not guarantee accurate counts.** ASR artifacts will occasionally inflate or deflate the count.
- **Does not add a new detection mechanism.** It repackages existing struggle/self-correction data into a more accessible format.
- **Does not require new ASR models or engines.** Pure post-processing of existing alignment data.

## 7. Open Questions

1. **Should compound words count as multi-attempt?** "every" + "one" → "everyone" is correct reading, not struggle. Current plan: exclude compounds that resolved to `type: 'correct'`. But what about `compound: true` with `type: 'struggle'`? Those parts *are* attempts.

2. **Should recovered omissions count as 1 attempt?** The student produced something (Parakeet heard it), but V1 missed it. Is that 1 attempt or 0? Current plan: count as 1.

3. **Should self-corrections at a distance count?** If a student says "the" (wrong), reads 2 more words, then goes back and says "they" (correct), is that 2 attempts at word N? Current plan: only count adjacent insertions, not distant self-corrections.

4. **Attempt Density vs. WCPM — which matters more?** WCPM is the standard clinical metric. Attempt Density captures something WCPM misses (a student who eventually gets every word right but takes 3 tries each time will have high WCPM error count but the *pattern* of attempts reveals more about their decoding strategy). They're complementary, not competing.

---

## References

- Montoya-Gomez, G.M., Ghesquiere, P., & Van hamme, H. (2025). "Refined Analysis of Reading Miscues." *10th Workshop on Speech and Language Technology in Education (SLaTE)*, Nijmegen, Netherlands. DOI: 10.21437/SLaTE.2025-41
