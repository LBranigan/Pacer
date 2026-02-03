# Phase 14: Disfluency Detection - Research

**Researched:** 2026-02-03
**Domain:** Speech disfluency detection, stutter metrics computation, fragment merging
**Confidence:** HIGH (domain well-understood, algorithms user-specified, codebase established)

## Summary

This research investigates how to implement disfluency detection as a separate signal from ASR confidence. The phase involves computing stutter metrics (attempt count, total duration, max pause), classifying severity levels, and merging orphaned fragments back into their target words.

The key insight from domain research is that **confidence and disfluency are clinically distinct signals**. A student can produce a word correctly (high confidence) but struggle significantly (high disfluency). Combining these into a single score loses critical information for RTI Tier 2/3 intervention planning.

The user has provided clear decisions in CONTEXT.md for:
- Stutter detection rules (prefix matching, length-based criteria, 2s grouping window)
- Severity thresholds (hybrid "Count-First, Duration-Override" model)
- Fragment merging behavior (remove from main array, nearest word wins)
- Data structure design (hoisted metrics + `_disfluency` evidence object)

**Primary recommendation:** Implement a standalone `disfluency-detector.js` module that processes the classified word array after confidence classification but before alignment. The module should scan for stutter patterns, compute metrics, merge eligible fragments, classify severity, and augment word objects with disfluency data.

## Standard Stack

The existing codebase provides everything needed. No new libraries required.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none) | - | Pure JavaScript implementation | Custom domain-specific logic; no general-purpose disfluency libraries exist for this use case |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Existing `ensemble-merger.js` | - | Source of word data with timestamps | Provides input words with `startTime`, `endTime`, `source` |
| Existing `confidence-classifier.js` | - | Source of classified words | Provides `trustLevel`, `confidence` before disfluency processing |
| Existing `diagnostics.js` | - | Time parsing utilities | Reuse `parseTime()` function |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom detection | ML model (FluentNet, StutterNet) | ML models require training data, server-side inference, and address different use cases (developmental stuttering vs. reading disfluency) |
| Time-based grouping | DBSCAN clustering | Overkill for simple 2s threshold grouping; adds dependency |

**Installation:**
```bash
# No new dependencies required
```

## Architecture Patterns

### Recommended Project Structure
```
js/
├── disfluency-detector.js   # NEW: Stutter detection, metrics, fragment merging
├── confidence-classifier.js # Existing: Runs BEFORE disfluency detection
├── ensemble-merger.js       # Existing: Provides word array with timestamps
└── app.js                   # Orchestration: Call disfluency after classification
```

### Pattern 1: Pipeline Integration Point

**What:** Disfluency detection runs as a distinct step in the assessment pipeline, after confidence classification but before alignment.

**When to use:** Always - disfluency must be computed before alignment because:
1. Fragment merging removes words from the array
2. Alignment uses word positions that would be incorrect if fragments aren't merged first

**Current pipeline (from app.js):**
```javascript
// Current flow (Phase 13):
// 1. ensembleResult = sendEnsembleSTT()
// 2. mergedWords = mergeEnsembleResults(ensembleResult)
// 3. classifiedWords = classifyAllWords(mergedWords, referenceText)  // Phase 13
// 4. wordsForAlignment = filterGhosts(classifiedWords)
// 5. alignment = alignWords(referenceText, wordsForAlignment)

// With Phase 14:
// 1. ensembleResult = sendEnsembleSTT()
// 2. mergedWords = mergeEnsembleResults(ensembleResult)
// 3. classifiedWords = classifyAllWords(mergedWords, referenceText)  // Phase 13
// 4. filteredWords = filterGhosts(classifiedWords)
// 5. processedWords = detectDisfluencies(filteredWords, referenceText)  // Phase 14 NEW
// 6. alignment = alignWords(referenceText, processedWords)
```

### Pattern 2: Fragment Merging with Mutation

**What:** Fragment merging mutates the word array in place (removes merged fragments, updates target word's `_disfluency`).

**When to use:** When processing fragments that need to be removed from the main array. The user decision states: "Remove merged fragments from main word array - fragment only exists in target's _disfluency data."

**Example:**
```javascript
// Input: ["p", "p", "please", "help"]
// Output: ["please", "help"] where please._disfluency.fragments = ["p", "p"]

function processFragments(words) {
  const result = [];
  let i = 0;

  while (i < words.length) {
    const word = words[i];

    // Collect any fragments that should merge into next target word
    // ... (see implementation pattern below)

    result.push(processedWord);
    i++;
  }

  return result;
}
```

### Pattern 3: Two-Pass Detection

**What:** First pass identifies all potential stutter events by grouping temporally close words. Second pass computes metrics and severity for each event.

**When to use:** When stutter events may span multiple fragments before a target word.

**Example:**
```javascript
// Pass 1: Group into stutter events
// ["p" @ 0.0s, "p" @ 0.5s, "please" @ 1.2s, "help" @ 2.0s]
// Groups: [["p", "p", "please"], ["help"]]  (2s window)

// Pass 2: For each group with >1 word, compute metrics
// Group 1: attempts=3, totalDuration=1.4s, maxPause=0.7s -> severity='moderate'
```

### Anti-Patterns to Avoid

- **Mutating during iteration:** Don't use `splice()` while iterating forward. Either iterate backwards, build a new array, or collect indices to remove afterward.

- **Coupling with alignment:** Don't try to detect disfluencies during alignment. The alignment module uses diff-match-patch which operates on text, not timestamps. Keep them separate.

- **Modifying confidence:** Per user decision, disfluency is a SEPARATE signal from confidence. Never change `word.confidence` based on disfluency metrics.

- **Over-matching fragments:** A fragment like "st" could match "still" or "story". Use nearest-word-wins rule to prevent false merges.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Time parsing | Custom parser | `diagnostics.js:parseTime()` | Already handles "1.200s" format reliably |
| Word normalization | Custom lowercase | `text-normalize.js:normalizeText()` | Handles punctuation, case, consistent with rest of codebase |
| Canonical forms | String comparison | `word-equivalences.js:getCanonical()` | Handles homophones, contractions, numbers |

**Key insight:** The codebase already has time parsing, normalization, and canonicalization utilities. Reuse them for consistency and to avoid subtle bugs.

## Common Pitfalls

### Pitfall 1: Overlapping Fragments
**What goes wrong:** A fragment "th" at time 0.5s could potentially match "the" at 1.0s or "that" at 1.5s. If not handled correctly, the fragment might merge into the wrong target.
**Why it happens:** Simple prefix matching without temporal proximity consideration.
**How to avoid:** Implement "nearest word wins" - for each fragment, find the closest eligible target by time. Per user decision: fragments are processed looking forward in time to find their target.
**Warning signs:** Words getting merged into targets that are temporally distant despite a closer valid target existing.

### Pitfall 2: Chain Stutters
**What goes wrong:** "p p p please" could be processed incorrectly if the algorithm only looks at pairs.
**Why it happens:** Iterating forward and merging one fragment at a time can miss that all three "p"s should merge into "please".
**How to avoid:** Collect ALL fragments within the 2s window before a target, then merge them all at once.
**Warning signs:** Only the immediately preceding fragment gets merged; earlier ones in the chain remain as "insertions".

### Pitfall 3: Substitution vs. Stutter Confusion
**What goes wrong:** "sat" before "sit" is treated as a stutter fragment instead of a word substitution.
**Why it happens:** "sat" starts with "s" which matches "sit".
**How to avoid:** Per user decision: "If fragment is 3+ chars and doesn't match target exactly, it's a substitution (wrong word), not a stutter." Apply the length-based matching rules strictly.
**Warning signs:** Obvious substitution errors being hidden inside disfluency data.

### Pitfall 4: Full Word Repetitions Not Counted
**What goes wrong:** "ball ball ball" is treated as separate words, not as 3 attempts at "ball".
**Why it happens:** Fragment detection focuses on partial words, missing exact repetitions.
**How to avoid:** Per user decision: "Full word repetitions count as stutter attempts." Check for exact word matches within the 2s window, not just prefix matches.
**Warning signs:** Word repetitions appearing as insertions instead of contributing to disfluency severity.

### Pitfall 5: Severity Threshold Order
**What goes wrong:** A word with 5 attempts and 0.4s maxPause gets classified as 'moderate' (by attempts) instead of checking duration first.
**Why it happens:** Threshold checks are in wrong order.
**How to avoid:** Follow the user-specified algorithm exactly:
```javascript
function calculateSeverity(attempts, totalDuration, maxPause) {
  if (attempts >= 5 || totalDuration >= 2.0) return 'significant';  // Check first
  if (maxPause >= 0.5 && attempts >= 2) return 'moderate';          // Duration override
  if (attempts >= 3) return 'moderate';
  if (attempts === 2) return 'minor';
  return 'none';
}
```
**Warning signs:** Words with long durations not being flagged as 'significant'.

## Code Examples

Verified patterns adapted from codebase and user decisions.

### Time Parsing (from diagnostics.js)
```javascript
// Source: diagnostics.js
function parseTime(t) {
  return parseFloat(String(t).replace('s', '')) || 0;
}
```

### Merge Eligibility Check (from CONTEXT.md)
```javascript
// Source: User decision in CONTEXT.md
function isMergeEligible(fragment, target) {
  const f = fragment.word.toLowerCase();
  const t = target.word.toLowerCase();

  // First char must match
  if (!t.startsWith(f.charAt(0))) return false;

  // Short fragments (1-3 chars): must match prefix of target
  if (f.length <= 3) return t.startsWith(f);

  // Long fragments (4+ chars): must be exact OR long prefix
  return (f === t) || (t.startsWith(f) && f.length >= 4);
}
```

### Severity Classification (from CONTEXT.md)
```javascript
// Source: User decision in CONTEXT.md
function calculateSeverity(attempts, totalDuration, maxPause) {
  if (attempts >= 5 || totalDuration >= 2.0) return 'significant';
  if (maxPause >= 0.5 && attempts >= 2) return 'moderate';
  if (attempts >= 3) return 'moderate';
  if (attempts === 2) return 'minor';
  return 'none';
}
```

### Temporal Grouping Pattern
```javascript
// Pattern: Group words within 2s gap into potential stutter events
const MAX_STUTTER_GAP_SEC = 2.0;

function groupByStutterEvents(words) {
  if (words.length === 0) return [];

  const groups = [];
  let currentGroup = [words[0]];

  for (let i = 1; i < words.length; i++) {
    const prevEnd = parseTime(words[i - 1].endTime);
    const currStart = parseTime(words[i].startTime);
    const gap = currStart - prevEnd;

    if (gap <= MAX_STUTTER_GAP_SEC) {
      currentGroup.push(words[i]);
    } else {
      groups.push(currentGroup);
      currentGroup = [words[i]];
    }
  }
  groups.push(currentGroup);

  return groups;
}
```

### Computing Pause Metrics
```javascript
// Pattern: Compute pauses between consecutive words
function computePauses(words) {
  const pauses = [];
  for (let i = 1; i < words.length; i++) {
    const prevEnd = parseTime(words[i - 1].endTime);
    const currStart = parseTime(words[i].startTime);
    pauses.push(Math.max(0, currStart - prevEnd));
  }
  return pauses;
}

function computeDisfluencyMetrics(attempts) {
  if (attempts.length <= 1) return null;

  const sorted = [...attempts].sort(
    (a, b) => parseTime(a.startTime) - parseTime(b.startTime)
  );

  const pauses = computePauses(sorted);
  const firstStart = parseTime(sorted[0].startTime);
  const lastEnd = parseTime(sorted[sorted.length - 1].endTime);

  return {
    attempts: sorted.length,
    totalDuration: Math.round((lastEnd - firstStart) * 100) / 100,
    maxPause: pauses.length > 0 ? Math.round(Math.max(...pauses) * 100) / 100 : 0,
    fragments: sorted.slice(0, -1).map(w => ({
      word: w.word,
      startTime: w.startTime,
      endTime: w.endTime
    }))
  };
}
```

### Data Structure Output Pattern
```javascript
// Pattern: Word object with disfluency data
// Per CONTEXT.md: hoist critical metrics to root, evidence in _disfluency

// Clean word (no disfluency - _disfluency not present):
{
  word: "cat",
  startTime: "1.0s",
  endTime: "1.3s",
  confidence: 0.95,
  trustLevel: "high",
  source: "both",
  attempts: 1,
  severity: "none"
}

// Word with disfluency (attempts >= 2):
{
  word: "please",
  startTime: "0.0s",  // Start of first fragment
  endTime: "1.4s",    // End of final word
  confidence: 0.92,
  trustLevel: "high",
  source: "both",
  attempts: 3,        // Hoisted to root
  severity: "moderate", // Hoisted to root
  _disfluency: {
    maxPause: 0.5,
    totalDuration: 1.4,
    fragments: [
      { word: "p", startTime: "0.0s", endTime: "0.2s" },
      { word: "p", startTime: "0.5s", endTime: "0.7s" }
    ]
  }
}
```

### Document-Level Summary
```javascript
// Pattern: Pre-computed summary for sorting/filtering
const summary = {
  _disfluencySummary: {
    none: 45,
    minor: 3,
    moderate: 2,
    significant: 1,
    totalWordsWithDisfluency: 6
  }
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ML-based stutter detection (FluentNet, StutterNet) | Rule-based with timestamps | N/A | ML requires training on stuttering speech datasets; our use case is reading disfluency which has different patterns |
| Text-based repetition detection | Temporal grouping | This project | Timestamps from ASR enable more accurate detection than text pattern matching |
| Combined confidence+disfluency score | Separate signals | User decision | Clinical nuance preserved for RTI intervention planning |

**Deprecated/outdated:**
- `detectSelfCorrections()` in `diagnostics.js`: Partially overlaps with this phase but operates on aligned words post-alignment. The new disfluency detection operates pre-alignment and is more comprehensive. Keep both for now; they serve different purposes (self-corrections in aligned text vs. ASR-detected stutters).

## Open Questions

Things that couldn't be fully resolved (marked as "Claude's Discretion" in CONTEXT.md):

1. **Exact algorithm for time-based fragment grouping**
   - What we know: 2s max gap, prefix matching rules
   - What's unclear: Should we scan forward from each word, or backward from each target? Forward scanning is simpler but backward (from target) matches the conceptual model better.
   - Recommendation: **Forward scanning with lookahead** - for each potential fragment, look ahead to find the nearest eligible target within 2s. This handles chains naturally.

2. **Edge case: overlapping fragments**
   - What we know: "Nearest word wins" is the rule
   - What's unclear: What if a fragment is equidistant from two targets?
   - Recommendation: **Prefer the later target** - stutters naturally precede the word being attempted. If "p" is at 1.0s and both "please" and "put" are at 2.0s, choose whichever appears first in the word sequence (lower index).

3. **Performance optimization for fragment scanning**
   - What we know: O(n^2) worst case if every word checks every other word
   - What's unclear: Is optimization needed for typical passage lengths?
   - Recommendation: **Don't premature optimize** - typical passages are 50-200 words, processed once per assessment. O(n^2) is ~40,000 comparisons worst case, trivial for modern browsers. If profiling shows issues, add early-exit when gap exceeds 2s (words are time-ordered).

## Sources

### Primary (HIGH confidence)
- `CONTEXT.md` - User decisions defining stutter detection rules, severity thresholds, fragment merging behavior, data structure design
- `FuturePlans/ASR Ensemble Strategy and wav2vec2 Fine-Tuning Plan.md` - Detailed pseudocode for disfluency detection and orphan merging from project planning
- Existing codebase: `ensemble-merger.js`, `confidence-classifier.js`, `diagnostics.js`, `app.js` - Established patterns and pipeline

### Secondary (MEDIUM confidence)
- [Automatic Syllable Repetition Detection](https://link.springer.com/chapter/10.1007/978-3-319-26227-7_28) - Confirms prefix matching approach for repetition detection
- [Speech Disfluency Detection with Contextual Representation](https://dl.acm.org/doi/10.1145/3539490.3539601) - Background on disfluency classification approaches
- [Reading Fluency in Children Who Stutter](https://pmc.ncbi.nlm.nih.gov/articles/PMC8699115/) - Clinical context for disfluency in reading assessment

### Tertiary (LOW confidence)
- [YOLO-Stutter](https://arxiv.org/abs/2408.15297) - ML approach, not directly applicable but confirms temporal detection is valid
- [FluentNet](https://ieeexplore.ieee.org/document/9528931/) - End-to-end ML detection, not applicable to our use case

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies; pure JavaScript implementation using existing utilities
- Architecture: HIGH - Pipeline integration point is clear; patterns match existing codebase
- Pitfalls: HIGH - User decisions explicitly address most edge cases; remaining gaps are minor

**Research date:** 2026-02-03
**Valid until:** 2026-03-03 (30 days - stable domain, user decisions locked)
