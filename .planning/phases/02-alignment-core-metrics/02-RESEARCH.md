# Phase 2: Alignment & Core Metrics - Research

**Researched:** 2026-02-02
**Domain:** Text alignment (diff), oral reading fluency metrics
**Confidence:** HIGH

## Summary

This phase requires aligning a Google STT transcript against a known reference passage to classify each reference word as correct, substitution, omission, or insertion, then computing WCPM and accuracy. The core algorithm is sequence alignment via diff.

Google's diff-match-patch library operates at character level by default but has a well-documented technique for word-level diffs: encode each unique word as a unique Unicode character, diff those encoded strings, then decode back. This is documented on the official wiki. The library is archived (Aug 2024) but stable, dependency-free, and available via CDN -- fitting the project's vanilla JS, no-bundler architecture.

WCPM is a standard educational metric: `WCPM = (Total Words Read - Errors) / Time in Minutes`. Errors are substitutions + omissions. Insertions are traditionally NOT counted as errors in WCPM. Self-corrections count as correct.

**Primary recommendation:** Use diff-match-patch via CDN with word-level encoding technique. Build an `alignment.js` module that takes reference words and STT words, produces a classified word list, then a `metrics.js` module that computes WCPM and accuracy from that list.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| diff-match-patch | 1.0.5 (archived, stable) | Myers diff algorithm | Google's library, battle-tested, zero dependencies, works in browser |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none needed) | - | Metrics are pure arithmetic | WCPM/accuracy are simple formulas |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| diff-match-patch | Custom Levenshtein on word arrays | More control but must handle all edge cases yourself; diff-match-patch's cleanup heuristics are valuable |
| diff-match-patch | `diff` npm package | Would require a bundler; project uses vanilla ES modules + CDN |

**Installation (CDN, no npm):**
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/diff_match_patch/20121119/diff_match_patch.js"></script>
```
Then in ES module code, access `diff_match_patch` from the global scope (loaded before module scripts).

## Architecture Patterns

### Recommended Project Structure
```
js/
├── alignment.js     # alignWords(referenceText, sttWords) -> ClassifiedWord[]
├── metrics.js       # computeWCPM(classifiedWords, durationSec), computeAccuracy(classifiedWords)
├── text-normalize.js # normalizeWord(word) for case/punctuation stripping
├── stt-api.js       # (existing) returns word-level STT data
├── ui.js            # (existing, extended) render alignment results + metrics
└── app.js           # (existing, extended) orchestrate flow
```

### Pattern 1: Word-Level Diff via Character Encoding
**What:** Encode each unique word as a single Unicode character, run character diff, decode results
**When to use:** Always -- this is the core alignment technique
**Example:**
```javascript
// Source: https://github.com/google/diff-match-patch/wiki/Line-or-Word-Diffs
function diffWords(text1, text2) {
  const dmp = new diff_match_patch();

  // Encode words as single characters
  const { chars1, chars2, lineArray } = diffWordsToChars(text1, text2);

  // Diff the encoded strings
  const diffs = dmp.diff_main(chars1, chars2);

  // Decode back to words
  dmp.diff_charsToLines(diffs, lineArray);

  return diffs; // Array of [operation, text] where operation is -1, 0, or 1
}

// Custom word encoder (adapted from diff_linesToChars)
function diffWordsToChars(text1, text2) {
  const wordArray = [''];  // index 0 unused
  const wordHash = {};

  function encode(text) {
    let chars = '';
    const words = text.split(/\s+/);
    for (const word of words) {
      if (word in wordHash) {
        chars += String.fromCharCode(wordHash[word]);
      } else {
        wordArray.push(word);
        wordHash[word] = wordArray.length - 1;
        chars += String.fromCharCode(wordArray.length - 1);
      }
    }
    return chars;
  }

  return {
    chars1: encode(text1),
    chars2: encode(text2),
    lineArray: wordArray
  };
}
```

### Pattern 2: Diff Operations to Word Classifications
**What:** Map diff output to educational categories (correct/substitution/omission/insertion)
**When to use:** After getting diff results, before computing metrics
**Example:**
```javascript
// diff-match-patch operations: DIFF_DELETE=-1, DIFF_INSERT=1, DIFF_EQUAL=0
// In our case: text1=reference, text2=STT transcript
// DIFF_EQUAL (0)  -> word is CORRECT
// DIFF_DELETE (-1) -> word in reference but not in STT -> OMISSION
// DIFF_INSERT (1)  -> word in STT but not in reference -> INSERTION
// Adjacent DELETE+INSERT pair -> SUBSTITUTION

function classifyWords(diffs) {
  const result = [];
  for (let i = 0; i < diffs.length; i++) {
    const [op, text] = diffs[i];
    const words = text.trim().split(/\s+/).filter(Boolean);

    if (op === 0) { // EQUAL
      words.forEach(w => result.push({ word: w, type: 'correct' }));
    } else if (op === -1) { // DELETE (from reference)
      // Check if next diff is INSERT (substitution pattern)
      if (i + 1 < diffs.length && diffs[i + 1][0] === 1) {
        const insertWords = diffs[i + 1][1].trim().split(/\s+/).filter(Boolean);
        // Pair deletions with insertions as substitutions
        const pairs = Math.min(words.length, insertWords.length);
        for (let j = 0; j < pairs; j++) {
          result.push({ word: words[j], type: 'substitution', actual: insertWords[j] });
        }
        // Remaining deletions are omissions
        for (let j = pairs; j < words.length; j++) {
          result.push({ word: words[j], type: 'omission' });
        }
        // Remaining insertions are insertions
        for (let j = pairs; j < insertWords.length; j++) {
          result.push({ word: insertWords[j], type: 'insertion' });
        }
        i++; // skip the INSERT we already processed
      } else {
        words.forEach(w => result.push({ word: w, type: 'omission' }));
      }
    } else if (op === 1) { // INSERT (in STT only, not preceded by DELETE)
      words.forEach(w => result.push({ word: w, type: 'insertion' }));
    }
  }
  return result;
}
```

### Pattern 3: Text Normalization Before Diff
**What:** Normalize both reference and STT text before alignment
**When to use:** Always, as the pre-processing step
```javascript
function normalizeForAlignment(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, '')  // strip punctuation except apostrophes/hyphens
    .replace(/\s+/g, ' ')
    .trim();
}
```

### Anti-Patterns to Avoid
- **Diffing raw text with punctuation:** Causes "the." != "the" false mismatches. Always normalize first.
- **Using confidence scores as the alignment mechanism:** STT confidence is unreliable for children. Use diff for alignment, confidence only as supplemental data.
- **Character-level diff without word encoding:** Produces character-granularity changes that are meaningless for reading assessment.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sequence alignment | Custom Levenshtein/LCS on word arrays | diff-match-patch with word encoding | Myers algorithm + cleanup heuristics handle transpositions and semantic grouping |
| Unicode-safe word encoding | Manual char code mapping | Adapt diff_linesToChars pattern | Already handles the encoding/decoding lifecycle |
| WCPM formula edge cases | Ad-hoc timing logic | Standard formula: (correct words * 60) / seconds | Well-established educational standard |

**Key insight:** The word-encoding trick in diff-match-patch converts a hard problem (word-level sequence alignment) into a solved problem (character-level Myers diff). The cleanup heuristics (`diff_cleanupSemantic`) also help produce human-sensible groupings.

## Common Pitfalls

### Pitfall 1: Punctuation Causing False Mismatches
**What goes wrong:** "the" in STT != "the," in reference, flagged as substitution
**Why it happens:** STT returns words without punctuation; reference text has commas, periods, etc.
**How to avoid:** Strip all punctuation from both texts before alignment. Keep original reference for display.
**Warning signs:** High error rates on passages with lots of punctuation

### Pitfall 2: Case Sensitivity
**What goes wrong:** "The" != "the" flagged as error
**Why it happens:** Reference has sentence-case; STT may return lowercase
**How to avoid:** Lowercase both texts before alignment
**Warning signs:** First word of every sentence marked as error

### Pitfall 3: Contractions and Possessives
**What goes wrong:** STT returns "don't" vs reference "don't" (curly vs straight apostrophe), or STT splits "don't" into "don" + "t"
**Why it happens:** Different apostrophe characters; STT tokenization varies
**How to avoid:** Normalize apostrophes to straight quotes. Handle known contraction splits.
**Warning signs:** All contractions marked as errors

### Pitfall 4: STT Merging/Splitting Words
**What goes wrong:** STT returns "gonna" for reference "going to", or splits "something" into "some thing"
**Why it happens:** STT models reflect spoken language, not written
**How to avoid:** This is inherently hard. Accept some false errors here. Could add a post-processing pass for common merges/splits but keep it simple initially.
**Warning signs:** Compound words consistently wrong

### Pitfall 5: Insertions Counted as WCPM Errors
**What goes wrong:** WCPM inflated or deflated by counting insertions as errors
**Why it happens:** Misunderstanding the standard formula
**How to avoid:** Standard WCPM: errors = substitutions + omissions ONLY. Insertions are tracked separately but do NOT reduce the correct count.
**Warning signs:** WCPM seems too low relative to manual assessment

### Pitfall 6: Short Passages and Timing
**What goes wrong:** Student finishes a short passage in 20 seconds; WCPM extrapolation to 60 seconds is inaccurate
**Why it happens:** Dividing by fractional minutes amplifies small timing errors
**How to avoid:** Use formula `(correctWords * 60) / actualSeconds`. Display actual reading time prominently so teacher can validate.
**Warning signs:** Very high WCPM on short passages

## Code Examples

### Complete Alignment Flow
```javascript
// alignment.js
function alignTranscript(referenceText, sttWords) {
  // 1. Normalize
  const refNorm = normalizeForAlignment(referenceText);
  const sttNorm = normalizeForAlignment(sttWords.map(w => w.word).join(' '));

  // 2. Word-level diff (reference = text1, STT = text2)
  const diffs = diffWords(refNorm, sttNorm);

  // 3. Optional: cleanup for semantic grouping
  // (already done at character level, but helps readability)

  // 4. Classify
  const classified = classifyWords(diffs);

  return classified;
}
```

### Metrics Computation
```javascript
// metrics.js
function computeMetrics(classifiedWords, durationSeconds) {
  const correct = classifiedWords.filter(w => w.type === 'correct').length;
  const substitutions = classifiedWords.filter(w => w.type === 'substitution').length;
  const omissions = classifiedWords.filter(w => w.type === 'omission').length;
  const insertions = classifiedWords.filter(w => w.type === 'insertion').length;
  const totalRefWords = correct + substitutions + omissions; // reference word count

  const wcpm = durationSeconds > 0 ? Math.round((correct * 60) / durationSeconds) : 0;
  const accuracy = totalRefWords > 0 ? Math.round((correct / totalRefWords) * 100) : 0;

  return { wcpm, accuracy, correct, substitutions, omissions, insertions, totalRefWords, durationSeconds };
}
```

### Timer for Assessment Duration
```javascript
// Already have timer display in index.html (#timer element)
// Track start/end times:
let assessmentStartTime = null;

function startAssessment() {
  assessmentStartTime = Date.now();
}

function endAssessment() {
  const durationMs = Date.now() - assessmentStartTime;
  return durationMs / 1000; // seconds
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual teacher marking on paper | Automated STT + alignment | Recent (this app) | Same WCPM formula, automated word classification |
| Levenshtein distance on word arrays | Myers diff via diff-match-patch | Stable for years | Better performance, semantic cleanup |
| Full custom alignment code | diff-match-patch word encoding trick | Documented in wiki | 90% less code to write |

**Deprecated/outdated:**
- diff-match-patch repo archived Aug 2024, but library is stable and complete. No replacement needed for this use case.

## Open Questions

1. **How well does diff_cleanupSemantic work at word level?**
   - What we know: It is designed for character-level grouping
   - What's unclear: Whether it improves or worsens word-level alignment results
   - Recommendation: Try with and without; if it causes weird groupings, skip it

2. **Handling STT disfluencies (um, uh, false starts)**
   - What we know: STT may transcribe "um" and "uh" as words
   - What's unclear: How consistently Google STT includes these
   - Recommendation: Filter common disfluency words ("um", "uh", "hmm") from STT output before alignment

3. **How to display alignment results in UI**
   - What we know: Need color-coded reference words (green=correct, red=omission, orange=substitution, blue=insertion)
   - What's unclear: Best UX for showing substitution pairs and insertion placement
   - Recommendation: Defer detailed UX decisions to planning; basic color-coded word display is sufficient for Phase 2

## Sources

### Primary (HIGH confidence)
- [google/diff-match-patch GitHub](https://github.com/google/diff-match-patch) - Library overview, archive status
- [Line or Word Diffs wiki](https://github.com/google/diff-match-patch/wiki/Line-or-Word-Diffs) - Word-level diff technique
- [Language: JavaScript wiki](https://github.com/google/diff-match-patch/wiki/Language:-JavaScript) - JS usage, CDN availability

### Secondary (MEDIUM confidence)
- [WCPM calculation sources](https://www.readingrockets.org/topics/fluency/articles/fluency-norms-chart-2017-update) - Standard formula and norms
- [Reading Rockets - Timed Readings](https://www.readingrockets.org/classroom/classroom-strategies/timed-repeated-readings) - Error classification standards
- [cdnjs diff-match-patch](https://cdnjs.com/libraries/diff_match_patch) - CDN hosting confirmed

### Tertiary (LOW confidence)
- diff-match-patch-line-and-word npm package exists but is 4 years old and unnecessary given the wiki technique

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - diff-match-patch is well-documented, stable, archived (won't change)
- Architecture: HIGH - word encoding technique is officially documented; classification logic follows standard diff semantics
- Pitfalls: HIGH - punctuation/case/contraction issues are well-known in text comparison
- Metrics (WCPM/accuracy): HIGH - standard educational formulas with multiple corroborating sources

**Research date:** 2026-02-02
**Valid until:** 2026-03-02 (stable domain, archived library)
