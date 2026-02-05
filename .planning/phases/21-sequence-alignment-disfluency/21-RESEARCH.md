# Phase 21: Sequence Alignment & Disfluency Detection - Research

**Researched:** 2026-02-05
**Domain:** Sequence alignment algorithms, disfluency detection, oral reading fluency assessment
**Confidence:** HIGH

## Summary

This phase implements Needleman-Wunsch global sequence alignment to compare verbatim (v=1.0) and clean (v=0.0) Reverb ASR transcripts, identifying disfluencies as insertions in the alignment. The algorithm is well-documented and straightforward to implement in JavaScript.

The key insight from the project's prior research is that Reverb's dual-pass architecture (same model, same encoder, same CTC clock) produces 10-20ms timestamp drift between passes, far less than the 60ms+ drift that caused the previous disfluency-detector.js to fail. Needleman-Wunsch global alignment absorbs this small drift naturally.

Disfluency classification follows established speech-language pathology categories: fillers (um, uh, er), repetitions (consecutive identical words), and false starts (partial words). Per clinical ORF standards, disfluencies do NOT count against WCPM calculation.

**Primary recommendation:** Implement Needleman-Wunsch with asymmetric gap penalties (insert=-1, delete=-2) to prefer finding insertions (disfluencies) over deletions, then classify each insertion by type.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Pure JavaScript | ES6+ | Algorithm implementation | No external dependencies needed - NW is simple enough |
| Browser native | - | Execution environment | Matches existing codebase architecture |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None required | - | - | Algorithm is self-contained |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom NW | diff-match-patch | DMP is character-level, not word-level; NW gives more control over gap penalties |
| Custom NW | seqdiff npm | Extra dependency for trivial algorithm; NW is ~50 lines |
| Word-level NW | Levenshtein distance | Levenshtein only gives edit count, not the actual alignment |

**Installation:**
```bash
# No installation needed - pure JavaScript implementation
```

## Architecture Patterns

### Recommended Project Structure
```
js/
  sequence-aligner.js     # Needleman-Wunsch implementation (INTG-03)
  disfluency-tagger.js    # Classification logic (INTG-04)
```

### Pattern 1: Needleman-Wunsch Global Alignment

**What:** Dynamic programming algorithm that finds optimal global alignment between two sequences
**When to use:** When you need to align entire sequences end-to-end (vs. local alignment for subsequences)

**Algorithm Overview:**
1. Create (m+1) x (n+1) scoring matrix where m = verbatim length, n = clean length
2. Initialize first row/column with cumulative gap penalties
3. Fill matrix using recurrence: `F[i,j] = max(diagonal + match/mismatch, up + gap, left + gap)`
4. Traceback from bottom-right to top-left to extract alignment

**Example:**
```javascript
// Source: Standard NW algorithm (Needleman & Wunsch, 1970)

/**
 * Needleman-Wunsch global sequence alignment.
 *
 * @param {string[]} verbatim - Words from v=1.0 transcript
 * @param {string[]} clean - Words from v=0.0 transcript
 * @param {object} options - Scoring parameters
 * @returns {object} Alignment result with aligned sequences and operations
 */
function needlemanWunsch(verbatim, clean, options = {}) {
  const {
    match = 2,
    mismatch = -1,
    gapInsert = -1,   // Cost of insertion (word in verbatim, not in clean)
    gapDelete = -2    // Cost of deletion (word in clean, not in verbatim) - more expensive
  } = options;

  const m = verbatim.length;
  const n = clean.length;

  // Initialize scoring matrix
  const F = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  const P = Array(m + 1).fill(null).map(() => Array(n + 1).fill(null));

  // Fill first row and column with cumulative gap penalties
  for (let i = 1; i <= m; i++) {
    F[i][0] = F[i-1][0] + gapInsert;  // Insertions along first column
    P[i][0] = 'up';
  }
  for (let j = 1; j <= n; j++) {
    F[0][j] = F[0][j-1] + gapDelete;  // Deletions along first row
    P[0][j] = 'left';
  }

  // Fill rest of matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const verbatimWord = normalizeWord(verbatim[i-1]);
      const cleanWord = normalizeWord(clean[j-1]);

      const scoreDiag = F[i-1][j-1] + (verbatimWord === cleanWord ? match : mismatch);
      const scoreUp = F[i-1][j] + gapInsert;   // Insert verbatim word
      const scoreLeft = F[i][j-1] + gapDelete; // Delete clean word

      const maxScore = Math.max(scoreDiag, scoreUp, scoreLeft);
      F[i][j] = maxScore;

      if (maxScore === scoreDiag) P[i][j] = 'diag';
      else if (maxScore === scoreUp) P[i][j] = 'up';
      else P[i][j] = 'left';
    }
  }

  // Traceback
  const alignment = [];
  let i = m, j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && P[i][j] === 'diag') {
      const verbatimWord = verbatim[i-1];
      const cleanWord = clean[j-1];
      alignment.unshift({
        verbatim: verbatimWord,
        clean: cleanWord,
        type: normalizeWord(verbatimWord) === normalizeWord(cleanWord) ? 'match' : 'mismatch'
      });
      i--; j--;
    } else if (i > 0 && (j === 0 || P[i][j] === 'up')) {
      alignment.unshift({
        verbatim: verbatim[i-1],
        clean: null,
        type: 'insertion'  // Word in verbatim, not in clean = DISFLUENCY
      });
      i--;
    } else {
      alignment.unshift({
        verbatim: null,
        clean: clean[j-1],
        type: 'deletion'  // Word in clean, not in verbatim (rare with Reverb)
      });
      j--;
    }
  }

  return { alignment, score: F[m][n] };
}

function normalizeWord(word) {
  if (!word) return '';
  return word.toLowerCase().replace(/[^a-z'-]/g, '');
}
```

### Pattern 2: Disfluency Type Classification

**What:** Categorize each alignment insertion as a specific disfluency type
**When to use:** After alignment, to provide clinically meaningful disfluency labels

**Example:**
```javascript
// Source: Speech-language pathology literature on disfluency types

const FILLER_WORDS = new Set([
  'um', 'uh', 'er', 'ah', 'mm', 'hmm', 'hm', 'erm'
]);

/**
 * Classify a disfluency by type.
 *
 * @param {object} alignedWord - Alignment entry with type='insertion'
 * @param {object[]} context - Surrounding alignment entries
 * @param {number} index - Position in alignment
 * @returns {string} Disfluency type: 'filler' | 'repetition' | 'false_start' | 'unknown'
 */
function classifyDisfluency(alignedWord, context, index) {
  const word = normalizeWord(alignedWord.verbatim);

  // DISF-03: Filler words (um, uh, er, ah, mm, hmm)
  if (FILLER_WORDS.has(word)) {
    return 'filler';
  }

  // DISF-04: Repetitions (consecutive identical words)
  const prevWord = index > 0 ? context[index - 1] : null;
  const nextWord = index < context.length - 1 ? context[index + 1] : null;

  // Check if this word matches adjacent word (repetition)
  if (prevWord && normalizeWord(prevWord.verbatim) === word) {
    return 'repetition';
  }
  if (nextWord && normalizeWord(nextWord.verbatim) === word) {
    return 'repetition';
  }

  // DISF-05: False starts (partial word followed by complete word)
  // Short word (1-3 chars) followed by longer word starting with same prefix
  if (word.length <= 3 && nextWord && nextWord.verbatim) {
    const nextNorm = normalizeWord(nextWord.verbatim);
    if (nextNorm.startsWith(word) && nextNorm.length > word.length) {
      return 'false_start';
    }
  }

  // Unknown disfluency type
  return 'unknown';
}
```

### Pattern 3: Disfluency Rate Calculation (DISF-06, DISF-07)

**What:** Calculate disfluency rate while preserving WCPM integrity
**When to use:** After alignment and classification, for clinical reporting

**Example:**
```javascript
// Source: ORF clinical standards (Hasbrouck & Tindal)

/**
 * Calculate disfluency rate excluding disfluencies from denominator.
 *
 * CRITICAL: Disfluencies do NOT affect WCPM calculation.
 * Per clinical ORF standards, self-corrections and repetitions are NOT errors.
 *
 * @param {object[]} alignment - Alignment result with disfluency classifications
 * @returns {object} Disfluency statistics
 */
function calculateDisfluencyRate(alignment) {
  const disfluencies = alignment.filter(a => a.type === 'insertion');
  const contentWords = alignment.filter(a => a.type !== 'insertion');

  // Count by type
  const byType = {
    filler: 0,
    repetition: 0,
    false_start: 0,
    unknown: 0
  };

  for (const d of disfluencies) {
    byType[d.disfluencyType || 'unknown']++;
  }

  // Rate calculation: disfluencies / (total words - disfluencies)
  // This ensures WCPM integrity - disfluencies excluded from denominator
  const totalContent = contentWords.length;
  const totalDisfluencies = disfluencies.length;
  const rate = totalContent > 0
    ? (totalDisfluencies / totalContent * 100).toFixed(1)
    : 0;

  return {
    totalDisfluencies,
    totalContentWords: totalContent,
    disfluencyRate: `${rate}%`,
    byType,
    // For WCPM calculation - ONLY content words count
    wordsForWCPM: contentWords.length
  };
}
```

### Anti-Patterns to Avoid

- **Timestamp-based matching first:** The previous disfluency-detector.js failed because it tried to match words by timestamp before checking identity. Needleman-Wunsch doesn't need timestamps - it aligns by word identity.
- **Local alignment (Smith-Waterman):** Local alignment finds best matching subsequence, but we need global alignment to find ALL disfluencies throughout the transcript.
- **Symmetric gap penalties:** Using same penalty for insert/delete loses the asymmetry we need. Insertions (disfluencies) should be cheaper than deletions.
- **Counting disfluencies as errors:** Per clinical standards, repetitions and false starts are NOT reading errors - they show effort to self-correct.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Word normalization | Custom regex | Existing `normalizeWord()` in text-normalize.js | Consistency with existing codebase |
| Filler word detection | Pattern matching | Static Set lookup | Performance, maintainability |
| Complex alignment scoring | Custom heuristics | Standard NW algorithm | Proven, well-understood, optimal |

**Key insight:** The Needleman-Wunsch algorithm is simple enough (50-100 lines) that using an external library adds more complexity than it saves. The algorithm is well-documented and has been stable since 1970.

## Common Pitfalls

### Pitfall 1: Symmetric Gap Penalties

**What goes wrong:** Using same penalty for insertions and deletions treats them as equally likely, but in this domain insertions (disfluencies) are expected while deletions (clean transcript missing words) are rare.

**Why it happens:** Standard NW tutorials use symmetric penalties because they're simpler.

**How to avoid:** Use asymmetric penalties: `gapInsert = -1, gapDelete = -2`. This biases the algorithm to prefer insertions when the choice is ambiguous.

**Warning signs:** Clean transcript words appearing as "deletions" when they should match verbatim words.

### Pitfall 2: Case/Punctuation Sensitivity

**What goes wrong:** "The" doesn't match "the", or "dog." doesn't match "dog", causing false mismatches.

**Why it happens:** Direct string comparison without normalization.

**How to avoid:** Always normalize words before comparison: lowercase, strip punctuation.

**Warning signs:** Alignment shows mismatches for words that are clearly the same.

### Pitfall 3: Treating Disfluencies as Errors

**What goes wrong:** WCPM calculation penalizes students for disfluencies, violating clinical ORF standards.

**Why it happens:** Natural assumption that "extra words" are errors.

**How to avoid:** Explicitly exclude alignment insertions from error counts. The existing `metrics.js` already handles this correctly for insertions.

**Warning signs:** Students with more disfluencies getting unfairly lower WCPM scores.

### Pitfall 4: Not Handling Edge Cases in Alignment

**What goes wrong:** Empty transcripts, single-word transcripts, or identical transcripts cause index errors or infinite loops.

**Why it happens:** Algorithm assumes non-trivial input.

**How to avoid:** Add explicit checks at function start:
- If both empty, return empty alignment
- If one empty, return all insertions/deletions
- If identical, return all matches

**Warning signs:** Crashes on very short or empty audio.

### Pitfall 5: Repetition Detection Scope

**What goes wrong:** Detecting "the the" as two repetitions instead of one.

**Why it happens:** Checking each word independently without grouping.

**How to avoid:** When classifying repetitions, mark the first occurrence as the "kept" word and subsequent occurrences as repetitions. Don't double-count.

**Warning signs:** Repetition count is inflated (2 for "the the" instead of 1).

## Code Examples

### Complete sequence-aligner.js Structure

```javascript
/**
 * Sequence alignment using Needleman-Wunsch algorithm.
 * Compares v=1.0 (verbatim) against v=0.0 (clean) Reverb transcripts.
 *
 * Pipeline: Reverb /ensemble → sequence-aligner.js → disfluency-tagger.js
 */

// Scoring parameters - tuned for disfluency detection
const DEFAULT_OPTIONS = {
  match: 2,
  mismatch: -1,
  gapInsert: -1,   // Insertion = disfluency in verbatim
  gapDelete: -2    // Deletion = missing from verbatim (rare, penalize more)
};

/**
 * Align verbatim and clean transcripts.
 *
 * @param {object[]} verbatimWords - Words from v=1.0 transcript [{word, start_time, end_time}]
 * @param {object[]} cleanWords - Words from v=0.0 transcript [{word, start_time, end_time}]
 * @param {object} options - Scoring parameters
 * @returns {object[]} Alignment result
 */
export function alignTranscripts(verbatimWords, cleanWords, options = {}) {
  // Edge cases
  if (!verbatimWords?.length && !cleanWords?.length) return [];
  if (!verbatimWords?.length) return cleanWords.map(w => ({ type: 'deletion', clean: w }));
  if (!cleanWords?.length) return verbatimWords.map(w => ({ type: 'insertion', verbatim: w }));

  // Extract word strings
  const verbatim = verbatimWords.map(w => w.word);
  const clean = cleanWords.map(w => w.word);

  // Run NW alignment
  const { alignment } = needlemanWunsch(verbatim, clean, { ...DEFAULT_OPTIONS, ...options });

  // Attach timing data to alignment
  let vIdx = 0, cIdx = 0;
  return alignment.map(entry => {
    const result = { ...entry };
    if (entry.verbatim !== null) {
      result.verbatimData = verbatimWords[vIdx++];
    }
    if (entry.clean !== null) {
      result.cleanData = cleanWords[cIdx++];
    }
    return result;
  });
}

// ... needlemanWunsch implementation from Pattern 1 above ...
```

### Complete disfluency-tagger.js Structure

```javascript
/**
 * Disfluency classification from sequence alignment.
 * Classifies insertions as: filler, repetition, false_start, unknown.
 *
 * Pipeline: sequence-aligner.js → disfluency-tagger.js → metrics integration
 */

const FILLER_WORDS = new Set(['um', 'uh', 'er', 'ah', 'mm', 'hmm', 'hm', 'erm']);

/**
 * Tag disfluencies in alignment result.
 *
 * @param {object[]} alignment - From alignTranscripts()
 * @returns {object[]} Alignment with disfluencyType field on insertions
 */
export function tagDisfluencies(alignment) {
  return alignment.map((entry, index) => {
    if (entry.type !== 'insertion') return entry;

    return {
      ...entry,
      disfluencyType: classifyDisfluency(entry, alignment, index)
    };
  });
}

/**
 * Calculate disfluency statistics.
 * CRITICAL: Does not affect WCPM - disfluencies are NOT errors.
 *
 * @param {object[]} taggedAlignment - From tagDisfluencies()
 * @returns {object} Statistics for clinical reporting
 */
export function computeDisfluencyStats(taggedAlignment) {
  const disfluencies = taggedAlignment.filter(a => a.type === 'insertion');
  const content = taggedAlignment.filter(a => a.type !== 'insertion');

  const byType = { filler: 0, repetition: 0, false_start: 0, unknown: 0 };
  disfluencies.forEach(d => byType[d.disfluencyType]++);

  return {
    total: disfluencies.length,
    contentWords: content.length,
    rate: content.length > 0 ? (disfluencies.length / content.length * 100).toFixed(1) + '%' : '0%',
    byType
  };
}

// ... classifyDisfluency implementation from Pattern 2 above ...
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Timestamp-based matching (disfluency-detector.js) | Sequence alignment (NW) | Phase 21 | Eliminates 60ms+ drift failures |
| Two-model ensemble (Google STT) | Single-model dual-pass (Reverb) | Phase 20 | 10-20ms drift vs 60ms+ |
| Fragment detection via STT timing | Alignment-based insertion detection | Phase 21 | More reliable, no false positives |
| Complex phonetic matching | Simple word identity | Phase 21 | Simpler, more accurate |

**Deprecated/outdated:**
- `disfluency-detector.js` fragment/repetition detection: Removed because STT timing was unreliable. New approach uses alignment.
- `checkForFragment()`, `checkForRepetition()`: Functions removed, replaced by alignment-based detection.

## Open Questions

Things that couldn't be fully resolved:

1. **Phrase-level repetitions**
   - What we know: Word-level repetitions ("the the") are detected by alignment
   - What's unclear: Multi-word repetitions ("the cat the cat") - should we detect these?
   - Recommendation: Start with word-level only per requirements; phrase-level can be added later

2. **Affine gap penalties**
   - What we know: Standard NW uses linear gap penalties
   - What's unclear: Would affine (open + extend) penalties improve alignment quality?
   - Recommendation: Start with linear; affine is more complex and may not be needed

3. **Partial word detection accuracy**
   - What we know: False starts like "p- p- please" require detecting partial words
   - What's unclear: Does Reverb transcribe partial words, or only complete words?
   - Recommendation: Test with real data; may need acoustic analysis if partials aren't transcribed

## Sources

### Primary (HIGH confidence)
- [Needleman-Wunsch Wikipedia](https://en.wikipedia.org/wiki/Needleman%E2%80%93Wunsch_algorithm) - Algorithm definition and complexity
- [Interactive NW Demo](https://bioboot.github.io/bimm143_W20/class-material/nw/) - Visualization of matrix fill and traceback
- [Python NW Implementation](https://gist.github.com/slowkow/06c6dba9180d013dfd82bec217d22eb5) - Reference implementation with gap penalties
- Existing codebase: `js/alignment.js` (diff-match-patch approach), `js/disfluency-detector.js` (deprecated), `js/metrics.js` (WCPM calculation)
- `FuturePlans/Reverb-ASR-Integration-Proposal.md` - Reverb dual-pass architecture documentation
- `services/reverb/server.py` - Actual Reverb API implementation

### Secondary (MEDIUM confidence)
- [Gap Penalty Wikipedia](https://en.wikipedia.org/wiki/Gap_penalty) - Asymmetric gap penalty theory
- [ORF Fluency Norms](https://www.readingrockets.org/topics/fluency/articles/fluency-norms-chart-2017-update) - Clinical WCPM standards
- [Speech Disfluency Wikipedia](https://en.wikipedia.org/wiki/Speech_disfluency) - Disfluency type definitions

### Tertiary (LOW confidence)
- [CrisperWhisper GitHub](https://github.com/nyrahealth/CrisperWhisper) - Alternative approach to disfluency detection
- [Azure Disfluency Removal Q&A](https://learn.microsoft.com/en-us/answers/questions/2106744/how-to-disable-the-default-disfluency-removal-of-f) - Industry context on verbatim vs. intended transcription

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Algorithm is well-documented, pure JS implementation straightforward
- Architecture: HIGH - Clear two-file structure matches existing codebase patterns
- Pitfalls: HIGH - Based on actual failures documented in current disfluency-detector.js comments
- Disfluency types: MEDIUM - Standard categories well-defined, but detection accuracy depends on Reverb output quality

**Research date:** 2026-02-05
**Valid until:** 2026-03-05 (30 days - stable algorithm, unlikely to change)
