# Phase 13: Confidence Classification - Research

**Researched:** 2026-02-03
**Domain:** ASR confidence scoring, reference text matching, trust classification
**Confidence:** HIGH

## Summary

This phase implements an asymmetric trust policy that classifies word confidence based on ensemble model agreement (`_source` property from Phase 11) and whether words appear in the reference text. The system assigns trust levels (High/Medium/Low/Ghost) to each word before alignment, preventing hallucinations from warping WCPM scores.

The implementation is straightforward as most foundational work already exists:
- Ensemble merger (Phase 11) provides `_source` tags: `'both'`, `'latest_only'`, `'default_only'`
- Ghost detector (Phase 12) provides VAD-based ghost flagging with `vad_ghost_in_reference`
- Word equivalences module already handles contractions, abbreviations, and basic number matching
- Text normalize module provides case normalization and punctuation stripping

The new work involves: (1) a confidence classifier function that applies the asymmetric trust rules, (2) extending word-equivalences.js with homophone and enhanced number/ordinal matching, and (3) a configuration file for tunable thresholds.

**Primary recommendation:** Build a pure function `classifyWordConfidence(word, referenceSet, vadGhostFlag)` that returns `{ confidence, trustLevel, _flags }`. Extend word-equivalences.js with HOMOPHONE_GROUPS and NUMBER_WORDS mappings. Store thresholds in a simple JS config object (not JSON file) for tree-shaking and type safety.

## Standard Stack

### Core (Already in Codebase)
| Module | Purpose | Relevance to Phase 13 |
|--------|---------|----------------------|
| `ensemble-merger.js` | Tags words with `_source` | Input to confidence classifier |
| `ghost-detector.js` | Flags `vad_ghost_in_reference` | Input for Ghost trust level |
| `word-equivalences.js` | Canonical word mapping | Extend with homophones, numbers |
| `text-normalize.js` | Case/punctuation normalization | Use for reference matching |

### New Module
| Module | Purpose | Why Create |
|--------|---------|------------|
| `confidence-classifier.js` | Apply asymmetric trust policy | Core Phase 13 logic |

### Supporting (Claude's Discretion Decisions)
| Solution | Purpose | Why This Approach |
|----------|---------|-------------------|
| Hardcoded HOMOPHONE_GROUPS | Homophone matching | Predictable, no external deps, curated for reading assessment |
| Hardcoded NUMBER_WORDS | Number conversion | Simple 1-100 covers 99% of reading passages, no npm needed |
| JS config object | Threshold storage | Type-safe, tree-shakeable, no I/O needed |

## Architecture Patterns

### Recommended Module Structure
```
js/
├── confidence-classifier.js  # NEW: classifyWordConfidence(), classifyAllWords()
├── confidence-config.js      # NEW: CONFIDENCE_THRESHOLDS, export as frozen object
├── word-equivalences.js      # EXTEND: add HOMOPHONE_GROUPS, NUMBER_WORDS
├── ensemble-merger.js        # UNCHANGED: provides _source tags
├── ghost-detector.js         # UNCHANGED: provides vad_ghost_in_reference
└── app.js                    # MODIFY: insert classification step before alignment
```

### Pattern 1: Pure Classifier Function
**What:** A stateless function that classifies a single word based on inputs
**When to use:** For testable, composable confidence logic
**Example:**
```javascript
// confidence-classifier.js
import { CONFIDENCE_THRESHOLDS } from './confidence-config.js';
import { isInReference } from './word-equivalences.js';

/**
 * Classify a single word's confidence based on asymmetric trust policy.
 * @param {object} word - Merged word from ensemble-merger with _source, confidence, _debug
 * @param {Set<string>} referenceSet - Set of normalized reference words (canonical forms)
 * @param {boolean} isVadGhost - Whether ghost-detector flagged this as vad_ghost_in_reference
 * @returns {object} { confidence, trustLevel, _flags, _debug }
 */
export function classifyWordConfidence(word, referenceSet, isVadGhost) {
  // VAD ghost detection overrides everything
  if (isVadGhost) {
    return {
      confidence: 0.0,
      trustLevel: 'ghost',
      _flags: ['vad_ghost'],
      _debug: { ...word._debug, classificationReason: 'VAD detected no speech' }
    };
  }

  const inReference = isInReference(word.word, referenceSet);
  const source = word._source || word.source;
  let confidence = word.confidence;
  let trustLevel;
  const flags = [];

  // Apply asymmetric trust rules based on CONTEXT.md decisions
  switch (source) {
    case 'both':
      // Use default model's confidence as-is (no boosting for agreement)
      confidence = word._debug?.default?.confidence ?? word.confidence;
      break;

    case 'latest_only':
      if (inReference) {
        // Benefit of doubt: student likely mumbled correctly
        confidence = 0.85;
      } else {
        // Hallucination risk: flag as possible insertion
        confidence = 0.50;
        flags.push('possible_insertion');
      }
      break;

    case 'default_only':
      if (inReference) {
        // Use default's confidence, but cap trust at MEDIUM
        confidence = word.confidence;
        // Trust level capped below
      } else {
        // Phantom from weaker model
        confidence = word.confidence;
        flags.push('phantom_default_only');
      }
      break;
  }

  // Determine trust level from confidence (inclusive thresholds per CONTEXT.md)
  if (confidence >= CONFIDENCE_THRESHOLDS.high) {
    trustLevel = 'high';
  } else if (confidence >= CONFIDENCE_THRESHOLDS.medium) {
    trustLevel = 'medium';
  } else {
    trustLevel = 'low';
  }

  // Apply default_only cap: trust level cannot exceed MEDIUM
  if (source === 'default_only' && trustLevel === 'high') {
    trustLevel = 'medium';
    flags.push('trust_capped');
  }

  return {
    confidence,
    trustLevel,
    _flags: flags.length > 0 ? flags : undefined,
    _debug: {
      ...word._debug,
      classificationReason: `${source}, inRef=${inReference}`,
      originalConfidence: word.confidence
    }
  };
}
```

### Pattern 2: Batch Classification with Ghost Filtering
**What:** Process all words and filter ghosts in one pass
**When to use:** In app.js pipeline before alignment
**Example:**
```javascript
// confidence-classifier.js
/**
 * Classify all merged words and optionally filter ghosts.
 * @param {Array} mergedWords - From mergeEnsembleResults()
 * @param {string} referenceText - Reference passage text
 * @param {object} ghostResult - From flagGhostWords()
 * @param {object} options - { filterGhosts: boolean }
 * @returns {Array} Classified words with confidence, trustLevel, _flags
 */
export function classifyAllWords(mergedWords, referenceText, ghostResult, options = {}) {
  const { filterGhosts = true } = options;
  const referenceSet = buildReferenceSet(referenceText);
  const ghostIndices = new Set(ghostResult?.ghostIndices || []);

  const classified = mergedWords.map((word, idx) => {
    const isGhost = ghostIndices.has(idx) || word.vad_ghost_in_reference;
    const classification = classifyWordConfidence(word, referenceSet, isGhost);

    return {
      ...word,
      confidence: classification.confidence,
      trustLevel: classification.trustLevel,
      _flags: classification._flags,
      _debug: classification._debug
    };
  });

  if (filterGhosts) {
    return classified.filter(w => w.confidence !== 0.0);
  }

  return classified;
}
```

### Pattern 3: Reference Set Builder with Equivalences
**What:** Build a Set of canonical word forms from reference text
**When to use:** For O(1) lookup during classification
**Example:**
```javascript
// word-equivalences.js (new export)
import { normalizeText } from './text-normalize.js';

/**
 * Build a Set of canonical word forms from reference text.
 * Includes original words plus all equivalent forms (homophones, numbers).
 * @param {string} referenceText
 * @returns {Set<string>}
 */
export function buildReferenceSet(referenceText) {
  const words = normalizeText(referenceText);
  const set = new Set();

  for (const word of words) {
    // Add the word itself
    set.add(word);

    // Add canonical form
    const canon = getCanonical(word);
    set.add(canon);

    // Add all equivalent forms
    const equivalents = getAllEquivalents(word);
    for (const eq of equivalents) {
      set.add(eq);
    }
  }

  return set;
}

/**
 * Check if a word (or its equivalents) appears in the reference set.
 * Handles: case-insensitive, punctuation stripped, homophones, numbers, compounds.
 * @param {string} word - Word to check
 * @param {Set<string>} referenceSet - From buildReferenceSet()
 * @returns {boolean}
 */
export function isInReference(word, referenceSet) {
  const normalized = normalizeWord(word);

  // Direct match
  if (referenceSet.has(normalized)) return true;

  // Canonical form match
  if (referenceSet.has(getCanonical(normalized))) return true;

  // Hyphen variations: "well-known" matches "wellknown" and "well known"
  if (normalized.includes('-')) {
    const noHyphen = normalized.replace(/-/g, '');
    if (referenceSet.has(noHyphen)) return true;
  }

  return false;
}
```

### Anti-Patterns to Avoid
- **Modifying word objects in place during classification** - Always create new objects with spread operator to preserve immutability
- **Using confidence thresholds as magic numbers** - Always import from confidence-config.js
- **Checking homophones with double-nested loops** - Build lookup maps once at module load time
- **Filtering ghosts inside the classifier function** - Separation of concerns: classify returns all, caller filters

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Homophone matching | Phonetic algorithm (Soundex, Metaphone) | Curated homophone groups | Phonetic algorithms match too broadly; we need exact reading-assessment-relevant pairs |
| Number-to-word conversion | Full library (number-to-words npm) | Simple 0-100 mapping object | Reading passages rarely have numbers > 100; no npm dependency needed |
| Ordinal matching | Complex regex | Hardcoded ordinal map (1st-20th, plus tens) | Limited set for reading assessment; predictable behavior |
| Case-insensitive matching | Custom toLowerCase calls | Use text-normalize.js normalizeText() | Already exists and handles edge cases |
| Word punctuation stripping | Custom regex | Use text-normalize.js | Already handles apostrophes/hyphens correctly |

**Key insight:** The codebase already has robust text normalization. Phase 13 adds domain-specific equivalences (homophones, numbers) without changing core normalization.

## Common Pitfalls

### Pitfall 1: Forgetting Inclusive Thresholds
**What goes wrong:** Using `> 0.70` instead of `>= 0.70` makes 0.70 exactly become Low instead of Medium
**Why it happens:** Off-by-one intuition from array indexing
**How to avoid:** Per CONTEXT.md: "Thresholds are **inclusive** (0.70 exactly = Medium, not Low)"
**Warning signs:** Edge case test fails where word has exactly 0.70 confidence

### Pitfall 2: Using latest_long Confidence for Both Sources
**What goes wrong:** When `_source === 'both'`, using the merged word's confidence (which comes from latest_long) instead of default's confidence
**Why it happens:** The ensemble-merger.js sets primary = latestWord when both exist
**How to avoid:** Per CONTEXT.md: "Use `default` model confidence ONLY"
**Warning signs:** Confidence values appear too high for `both` words; look at `_debug.default.confidence`

### Pitfall 3: Not Handling Missing _debug Data
**What goes wrong:** `word._debug.default.confidence` throws when `_debug` or `_debug.default` is null
**Why it happens:** Edge cases where one model failed but ensembleResult still returns partial data
**How to avoid:** Use optional chaining: `word._debug?.default?.confidence ?? word.confidence`
**Warning signs:** "Cannot read property 'confidence' of null" errors

### Pitfall 4: Homophones Not Working for Reference Words
**What goes wrong:** Reference has "their" but ASR returns "there", doesn't match because only checking one direction
**Why it happens:** Only expanding ASR word, not reference words
**How to avoid:** buildReferenceSet() must expand ALL reference words to ALL equivalent forms
**Warning signs:** Known homophone pairs still showing as substitution errors

### Pitfall 5: Ghost Filter Removing Words Before Classification
**What goes wrong:** Ghosts filtered out before confidence classification, losing audit trail
**Why it happens:** Premature optimization in pipeline
**How to avoid:** Per CONTEXT.md pipeline order: "Classify -> Filter ghosts -> Align"
**Warning signs:** Ghost words have no `trustLevel` or `_flags` in saved assessment data

### Pitfall 6: Mutating Word Objects
**What goes wrong:** Original ensemble-merger output modified, breaking debug log integrity
**Why it happens:** Direct property assignment instead of spread operator
**How to avoid:** Always `return { ...word, confidence: newConf }` not `word.confidence = newConf`
**Warning signs:** `_ensemble.raw` in saved assessment shows modified confidence values

## Code Examples

### Homophone Groups (extend word-equivalences.js)
```javascript
// word-equivalences.js - Add after EQUIVALENCE_GROUPS

/**
 * Homophone groups for reading assessment.
 * Groups where ASR commonly confuses words that sound identical.
 * These are kept separate from EQUIVALENCE_GROUPS because the semantic
 * relationship is different: homophones are interchangeable for SOUND,
 * not for MEANING.
 */
const HOMOPHONE_GROUPS = [
  // Common confusions in children's reading
  ['their', 'there', "they're"],
  ['to', 'too', 'two'],
  ['your', "you're"],
  ['its', "it's"],
  ['by', 'bye', 'buy'],
  ['for', 'four', 'fore'],
  ['hear', 'here'],
  ['know', 'no'],
  ['knew', 'new', 'gnu'],
  ['write', 'right', 'rite'],
  ['read', 'red'],  // past tense "read" sounds like "red"
  ['see', 'sea'],
  ['be', 'bee'],
  ['one', 'won'],
  ['son', 'sun'],
  ['eye', 'i', 'aye'],
  ['our', 'hour'],
  ['would', 'wood'],
  ['wait', 'weight'],
  ['way', 'weigh'],
  ['week', 'weak'],
  ['meet', 'meat'],
  ['piece', 'peace'],
  ['pair', 'pear', 'pare'],
  ['flower', 'flour'],
  ['tail', 'tale'],
  ['sale', 'sail'],
  ['mail', 'male'],
  ['pale', 'pail'],
  ['rain', 'reign', 'rein'],
  ['plain', 'plane'],
  ['role', 'roll'],
  ['hole', 'whole'],
  ['soul', 'sole'],
  ['threw', 'through'],
  ['break', 'brake'],
  ['wear', 'where', 'ware'],
  ['bear', 'bare'],
  ['hair', 'hare'],
  ['fair', 'fare'],
  ['stair', 'stare'],
  ['dear', 'deer'],
  ['steel', 'steal'],
  ['heel', 'heal', 'he\'ll'],
  ['real', 'reel'],
  ['need', 'knead'],
  ['seem', 'seam'],
  ['scene', 'seen'],
  ['made', 'maid'],
  ['ate', 'eight'],
  ['great', 'grate'],
  ['which', 'witch'],
  ['weather', 'whether'],
  ['principal', 'principle'],
  ['stationary', 'stationery'],
  ['affect', 'effect'],  // Often confused even if not true homophones
];

// Build bidirectional lookup for homophones
const homophoneMap = new Map();
for (const group of HOMOPHONE_GROUPS) {
  for (const word of group) {
    const normalized = word.toLowerCase();
    if (!homophoneMap.has(normalized)) {
      homophoneMap.set(normalized, new Set());
    }
    for (const equiv of group) {
      homophoneMap.get(normalized).add(equiv.toLowerCase());
    }
  }
}

/**
 * Get all homophone equivalents of a word.
 * @param {string} word - Normalized word
 * @returns {Set<string>} Set of equivalent homophones (includes the word itself)
 */
export function getHomophones(word) {
  return homophoneMap.get(word.toLowerCase()) || new Set([word.toLowerCase()]);
}
```

### Number-to-Word Mapping (extend word-equivalences.js)
```javascript
// word-equivalences.js - Add number matching

/**
 * Number words mapping for reading assessment.
 * Covers 0-100 plus common ordinals.
 */
const NUMBER_WORDS = {
  // Cardinals 0-20
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
  '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
  '10': 'ten', '11': 'eleven', '12': 'twelve', '13': 'thirteen',
  '14': 'fourteen', '15': 'fifteen', '16': 'sixteen', '17': 'seventeen',
  '18': 'eighteen', '19': 'nineteen', '20': 'twenty',

  // Tens
  '30': 'thirty', '40': 'forty', '50': 'fifty', '60': 'sixty',
  '70': 'seventy', '80': 'eighty', '90': 'ninety', '100': 'hundred',

  // Common ordinals
  '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth',
  '5th': 'fifth', '6th': 'sixth', '7th': 'seventh', '8th': 'eighth',
  '9th': 'ninth', '10th': 'tenth', '11th': 'eleventh', '12th': 'twelfth',
  '13th': 'thirteenth', '14th': 'fourteenth', '15th': 'fifteenth',
  '16th': 'sixteenth', '17th': 'seventeenth', '18th': 'eighteenth',
  '19th': 'nineteenth', '20th': 'twentieth'
};

// Build reverse lookup (word -> digit)
const wordToNumber = new Map();
for (const [digit, word] of Object.entries(NUMBER_WORDS)) {
  wordToNumber.set(word, digit);
  // Handle compound numbers like "twenty-one" -> 21
}

/**
 * Get number equivalent of a word (digit <-> word).
 * @param {string} word - Either a digit string or word
 * @returns {string|null} The equivalent form, or null if not a number
 */
export function getNumberEquivalent(word) {
  const normalized = word.toLowerCase();
  if (NUMBER_WORDS[normalized]) {
    return NUMBER_WORDS[normalized];
  }
  if (wordToNumber.has(normalized)) {
    return wordToNumber.get(normalized);
  }
  return null;
}
```

### Confidence Config (new file)
```javascript
// confidence-config.js
/**
 * Confidence classification thresholds.
 * Developer-tunable values (not user-facing).
 * Based on research: 0.93 for high precision, 0.70 for balanced detection.
 */
export const CONFIDENCE_THRESHOLDS = Object.freeze({
  high: 0.93,    // >= 0.93 = Crystal clear
  medium: 0.70,  // >= 0.70 = Acceptable
  // < 0.70 = Low (uncertain)
  // 0.0 = Ghost (VAD detected no speech)
});

/**
 * Fixed confidence values for asymmetric trust policy.
 */
export const ASYMMETRIC_CONFIDENCE = Object.freeze({
  latestOnlyInReference: 0.85,    // Benefit of doubt for mumbled words
  latestOnlyNotInReference: 0.50, // Below medium threshold = Low trust
});
```

### App.js Integration Point
```javascript
// In app.js runAnalysis() - after ghost detection, before alignment

// Classification step (Phase 13)
const classifiedWords = classifyAllWords(
  mergedWords,
  referenceText,
  ghostResult,
  { filterGhosts: true }  // Remove ghosts before alignment
);

addStage('confidence_classification', {
  totalWords: mergedWords.length,
  afterFiltering: classifiedWords.length,
  trustLevels: {
    high: classifiedWords.filter(w => w.trustLevel === 'high').length,
    medium: classifiedWords.filter(w => w.trustLevel === 'medium').length,
    low: classifiedWords.filter(w => w.trustLevel === 'low').length
  },
  possibleInsertions: classifiedWords.filter(w => w._flags?.includes('possible_insertion')).length
});

// Pass classified words to alignment
const alignment = alignWords(referenceText, classifiedWords);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single model confidence | Ensemble with asymmetric trust | Phase 13 | More accurate WCPM by distrusting hallucinations |
| Binary correct/incorrect | Four trust levels (High/Medium/Low/Ghost) | Phase 13 | Nuanced confidence for later UI display |
| Post-alignment ghost removal | Pre-alignment classification + filtering | Phase 13 | Prevents hallucinations from warping alignment |

**Current in codebase:**
- Ensemble merger returns `_source` tags but no trust classification
- Ghost detector flags `vad_ghost_in_reference` but doesn't set confidence to 0
- Word equivalences handles contractions/abbreviations but not homophones/numbers

## Open Questions

1. **Compound Number Handling**
   - What we know: "21" should match "twenty-one" or "twenty one"
   - What's unclear: How far to go with compound numbers (21-99? 100+?)
   - Recommendation: Implement 21-99 as hyphenated compounds. Reading passages rarely have larger numbers.

2. **Partial Homophone Matches**
   - What we know: "they're" should match "there" and "their"
   - What's unclear: Should we match across contraction boundaries? ("they are" = "there"?)
   - Recommendation: No. Contraction expansion is already handled by EQUIVALENCE_GROUPS. Homophones should only match single tokens.

3. **Debug Log Size**
   - What we know: `_debug` is preserved through the pipeline for tooltip display
   - What's unclear: Will adding `classificationReason` to every word bloat saved assessments?
   - Recommendation: Only add `_debug` properties when classification is non-trivial (not for `both` with high confidence).

## Sources

### Primary (HIGH confidence)
- **CONTEXT.md (Phase 13)** - User decisions document with specific threshold values, trust rules, and pipeline order
- **ensemble-merger.js** - Existing `_source` tagging implementation
- **ghost-detector.js** - Existing VAD ghost flagging implementation
- **word-equivalences.js** - Existing canonical form mapping

### Secondary (MEDIUM confidence)
- [Google Cloud Speech-to-Text Word Confidence Documentation](https://docs.cloud.google.com/speech-to-text/docs/word-confidence) - Confirms confidence range 0.0-1.0, word-level availability
- [Research on ASR Confidence Thresholds](https://arxiv.org/html/2410.20564v1) - Confirms 0.93 threshold for balanced sensitivity/specificity
- [EnglishClub Homophones List](https://www.englishclub.com/pronunciation/homophones-list.php) - Common homophone pairs reference

### Tertiary (LOW confidence - for reference only)
- [Homophonizer npm](https://github.com/jimkang/homophonizer) - Phonetic algorithm approach (NOT recommended for this use case)
- [number-to-words npm](https://www.npmjs.com/package/number-to-words) - Full library (overkill for our needs)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All modules already exist in codebase, only need extension
- Architecture: HIGH - Pattern follows existing ensemble/ghost modules exactly
- Pitfalls: HIGH - Based on direct codebase analysis and CONTEXT.md requirements
- Homophones: MEDIUM - Curated list based on web research, may need tuning
- Numbers: HIGH - Simple mapping, well-understood domain

**Research date:** 2026-02-03
**Valid until:** 2026-03-03 (30 days - stable domain, no external API changes expected)
