# Parakeet-Primary Unified Plan

## The Problem

The current pipeline uses Reverb (CTC decoder) as the primary transcript and Parakeet as a cross-validator. This is backwards. Reverb is the messier engine — BPE fragmentation, 100ms quantized timestamps, hallucinated tokens. We spend enormous effort cleaning up Reverb's mess, and that cleanup creates worse bugs than the ones it fixes.

### Bug #1: "you'llbecrere"

Student said: "you will be creating"

```
Reverb heard:   "you'll"  "be"   "crere"           "creating"
                 15.39s    15.69s  16.11s             18.99s

Parakeet heard: "you"  "will"  "be"  "creating"
                 15.68s  15.84s  16.08s  18.80s
```

What went wrong:
1. NW cross-validation force-paired: you'll<->you, be<->will, crere<->be (all "disagreed")
2. Fragment merge concatenated the 3 disagreed words: "you'llbecrere"
3. Final alignment: "you" = substitution, "will" = OMISSION, "be" = OMISSION

Result: 2 false omissions, 1 false substitution. The student said every word correctly.

### Bug #2: "orand"

Student said: "etc. or you can expand"

```
Reverb heard:   "et"   "cetera"  "or"   "and"     "expand"
                 19.31s  19.47s    20.03s  20.62s    21.18s

Parakeet heard: "etc."  "Or"   "you"  "can"  "expand"
                 19.12s   20.08s  20.32s  20.56s  20.80s
```

What went wrong:
1. Fragment merge combined "or" + "and" -> "orand"
2. NW cross-validation paired: cetera<->Or, orand<->you (both wrong)
3. Final alignment: "or" = substitution, "you" = OMISSION, "can" = substitution

Result: 1 false omission, 2 false substitutions. The student said everything correctly.

### Root Cause

Both bugs share the same pattern: Reverb produces garbled output -> NW pairing matches it to the wrong Parakeet words -> fragment merge makes it worse -> downstream alignment can't recover.

The fundamental mistake: using the messier engine as primary and the cleaner engine as cross-check.

---

## The Fix: Flip It

**Parakeet provides the word sequence + timestamps for scoring.**
**Reverb provides disfluency detection, recovery, and struggle signal.**

| | CTC (Reverb) | TDT (Parakeet) |
|---|---|---|
| **Strength** | Literal -- transcribes what it hears acoustically | Accurate -- strong language model produces clean words |
| **Weakness** | BPE fragments, 100ms timestamps, garbled tokens | Smooths over errors, hallucinates expected words, mangles proper nouns |
| **Good at** | Catching disfluencies (um, uh, repetitions, false starts) | Knowing what word the student was trying to say |
| **Bad at** | Producing a clean word sequence | Preserving the raw mess of how they said it |

They're complementary. Currently we use them wrong. Flip it.

---

## Architecture: Three Layers, Not Two Phases

The work is three layers, not two phases. The distinction matters because "Phase 2" implies a second big release with a design cycle and regression window. In reality, the overlay infrastructure is small (~100 lines) and should ship the same week as the pipeline flip. The diagnostic features are independent 1-2 day tasks off that infrastructure.

```
Layer 1: Pipeline Flip (Parakeet primary, V=0 recovery, scoring fix)
   | produces three data streams:
   |   1. Parakeet words (primary transcript + timestamps)
   |   2. Reverb V=0 words (clean CTC recovery pool)
   |   3. Reverb V=1/V=0 disfluencies (classified by tagDisfluencies)
   |
Layer 2: Reverb Overlay (temporal mapper -- shared infrastructure, ~100 lines)
   | for each Parakeet word: what did Reverb hear in this time region?
   |
Layer 3: Diagnostic Features (independent, ship one at a time)
   A. Correct-but-disputed  (ship WITH Layer 1)
   B. Disfluency context    (ship week 2)
   C. Hallucination flag    (ship week 2)
   D. Struggle enrichment   (ship week 3)
   E. Gap word analysis     (ship as needed)
```

This eliminates the value regression window. Teachers see *more* useful data than today on day one, not less.

---

## Current Pipeline (9 stages)

```
Reverb V=1 + V=0 (two passes)
    |
NW alignment: V=1 vs V=0 -> disfluency tags
    |
Kitchen Sink Merger -> merged transcript (Reverb-primary)
    |
NW cross-validation: Reverb vs Parakeet -> confirmed/disagreed/unconfirmed
    |
Pre-alignment fragment merge (rejoin BPE tokens -- BUG SOURCE)
    |
NW alignment: merged transcript vs reference -> scoring
    |
Post-alignment merges (compound, abbreviation, contraction)
    |
Omission recovery (from unconsumedXval pool)
    |
Near-miss resolution + fragment absorption
    |
Diagnostics
```

Fragment merge and NW cross-validation are the two most fragile stages and the source of both bugs.

## New Pipeline (6 stages + overlay)

```
Reverb V=1 + V=0 --+
                    +-- parallel
Parakeet ----------+
    |                  |
    |                  v
    |          V=1/V=0 NW alignment -> disfluency tags (unchanged)
    |                  |
    |          +-------+-------+
    |          |               |
    |      V=0 words     Disfluencies
    |     (clean CTC)    (V=1 insertions, classified)
    |          |               |
    v          v               v (stored for overlay)
NW alignment: Parakeet vs reference -> scoring
    |
Post-alignment merges (compound, abbreviation, contraction -- unchanged)
    |
V=0 recovery (proper nouns + omissions + near-miss struggle signal)
    |
Correct-but-disputed check (V=0 heard different word on "correct" entries)
    |
Near-miss resolution (simplified -- no fragment absorption)
    |
Reverb overlay (temporal mapper -- Layer 2)
    |
Diagnostics (simplified -- no unconfirmed skip-guards)
```

**What's gone:** Fragment merge, cross-validation-as-merge, `absorbStruggleFragments()`, three-tier classification (confirmed/disagreed/unconfirmed), the entire `crossValidation` field.

**What's new:** V=0 recovery (replaces proper noun forgiveness + omission recovery + struggle Path 3), correct-but-disputed check, Reverb overlay mapper.

---

## Layer 1: Pipeline Flip

### Stage 1: Parallel API Calls (unchanged)

`kitchen-sink-merger.js` orchestrates three parallel calls:
- Reverb `/ensemble` -> `{ verbatim: { words }, clean: { words } }`
- Parakeet `/parakeet` -> `{ words }`

No changes to API calls or endpoints.

### Stage 2: V=1/V=0 Disfluency Detection (unchanged)

```
alignTranscripts(reverb.verbatim.words, reverb.clean.words)
    |
tagDisfluencies(alignment)
```

Produces tagged alignment with `type: 'insertion'` entries classified as `filler`, `repetition`, `false_start`, or `unknown`. Proven, keep it.

### Stage 3: Extract Three Data Streams (changed)

Currently `buildMergedWordsFromAlignment()` produces a flat array mixing disfluencies with speech words, then `crossValidateTranscripts()` annotates each with a three-tier status.

**Replace with:** Extract three separate streams from the V=1/V=0 alignment:

```javascript
function extractStreams(taggedAlignment, reverbCleanWords) {
  const disfluencies = [];

  for (const entry of taggedAlignment) {
    if (entry.type === 'insertion') {
      disfluencies.push({
        word: entry.verbatimData.word,
        startTime: entry.verbatimData.startTime,
        endTime: entry.verbatimData.endTime,
        disfluencyType: entry.disfluencyType,
        confidence: entry.verbatimData.confidence
      });
    }
  }

  return {
    reverbV0Words: reverbCleanWords,  // Clean CTC pool for recovery
    disfluencies                       // For overlay enrichment
  };
}
```

**Why V=0 words directly instead of matched V=1 words:** V=0 is simpler -- no need to walk the alignment extracting matches. V=0 words come directly from `reverb.clean.words`. V=0 is also cleaner than V=1 (no disfluencies mixed in), which matters for recovery: using V=1 risks matching a repeated disfluency token ("the the the" -> three V=1 tokens) against a genuine omission.

**Kitchen Sink Merger return shape changes:**

```javascript
// BEFORE:
{
  words: crossValidatedReverbWords,
  unconsumedXval: parakeetWordsNotMatchedToReverb,
  source: 'kitchen_sink',
  reverb, xvalRaw, disfluencyStats, alignment, _debug
}

// AFTER:
{
  parakeetWords: parakeetRaw.words,       // Primary transcript
  reverbV0Words: reverb.clean.words,      // Clean CTC recovery pool
  reverbV1Words: reverb.verbatim.words,   // Raw verbatim (for overlay)
  disfluencies: extractedDisfluencies,    // V=1 leftovers (classified)
  disfluencyStats: stats,                 // Counts by type
  source: 'kitchen_sink',
  _debug: { reverb, parakeetRaw, v1v0Alignment }
}
```

### Stage 4: Parakeet-vs-Reference Alignment (changed input, same algorithm)

```javascript
// BEFORE: alignment input was Reverb merged+validated transcript
const alignment = alignWords(referenceText, transcriptWords);

// AFTER: alignment input is Parakeet words directly
const transcriptWords = parakeetWords.map(w => ({
  word: w.word,
  startTime: w.startTime,
  endTime: w.endTime,
  confidence: w.confidence
}));
const alignment = alignWords(referenceText, transcriptWords);
```

`alignWords()` in `alignment.js` is unchanged. It already:
- Normalizes reference via `normalizeText()`
- Filters disfluency fillers via `filterDisfluencies()` (Parakeet shouldn't produce fillers, but the guard is harmless)
- Scores via `scorePair()` which calls `getCanonical()` for equivalences -- **ITN is already handled** ("23"<->"twenty-three", "1st"<->"first" are already in `word-equivalences.js`)
- Post-processes via `mergeCompoundWords()`, `mergeAbbreviationExpansions()`, `mergeContractions()`

### Stage 5: V=0 Recovery (new, replaces three current mechanisms)

This single stage replaces:
1. Current proper noun forgiveness (NL API + dictionary guard)
2. Current omission recovery (unconsumedXval pool)
3. Current struggle Path 3 (unconfirmed + near-miss)

**Critical implementation note:** Do NOT `splice()` into `transcriptWords` during iteration. Collect all recoveries in a first pass, then apply them in a second pass sorted by position, adjusting indices. The current omission recovery code (`app.js:793-878`) splices during iteration which is fragile; the new code should fix this pattern.

**Algorithm (two-pass):**

```javascript
function reverbRecovery(alignment, transcriptWords, reverbV0Words) {
  // Build V=0 pool: normalized text + timestamps
  const v0Pool = reverbV0Words.map(w => ({
    word: w.word,
    norm: w.word.toLowerCase().replace(/[^a-z']/g, '').replace(/\./g, ''),
    startS: parseFloat(w.start_time || w.startTime),
    endS: parseFloat(w.end_time || w.endTime),
    startTime: w.startTime || (w.start_time + 's'),
    endTime: w.endTime || (w.end_time + 's'),
    consumed: false
  }));

  // --- PASS 1: Collect recoveries (don't mutate transcriptWords yet) ---
  const substitutionRecoveries = [];  // { alignIdx, v0Word }
  const omissionRecoveries = [];      // { alignIdx, v0Word, insertPosition }
  let hypIndex = 0;

  for (let i = 0; i < alignment.length; i++) {
    const entry = alignment[i];

    if (entry.type === 'substitution') {
      const pkWord = transcriptWords[hypIndex];
      const pkStartS = parseTime(pkWord.startTime);
      const pkEndS = parseTime(pkWord.endTime);
      const refNorm = normalize(entry.ref);

      // Exact match: V=0 heard the reference word
      const v0Match = findV0Match(v0Pool, refNorm, pkStartS, pkEndS, 0.5);
      if (v0Match) {
        substitutionRecoveries.push({ alignIdx: i, v0Word: v0Match, hypIndex });
        v0Match.consumed = true;
        if (v0Match._parts) v0Match._parts.forEach(p => p.consumed = true);
      } else {
        // Near-miss: V=0 heard something close (struggle signal)
        const v0NearMiss = findV0NearMiss(v0Pool, refNorm, pkStartS, pkEndS, 0.5);
        if (v0NearMiss) {
          entry._v0NearMiss = v0NearMiss.word;
          entry._v0Similarity = v0NearMiss.similarity;
        }
      }
      hypIndex += (entry.compound && entry.parts) ? entry.parts.length : 1;

    } else if (entry.type === 'omission') {
      const { beforeS, afterS } = getOmissionTimeRegion(alignment, transcriptWords, i, hypIndex);
      const refNorm = normalize(entry.ref);
      const v0Match = findV0MatchInRegion(v0Pool, refNorm, beforeS, afterS);
      if (v0Match) {
        // Determine insert position from surrounding timestamps
        const insertPos = findInsertPosition(transcriptWords, v0Match.startS);
        omissionRecoveries.push({ alignIdx: i, v0Word: v0Match, insertPosition: insertPos });
        v0Match.consumed = true;
        if (v0Match._parts) v0Match._parts.forEach(p => p.consumed = true);
      }
      // Omission: don't advance hypIndex

    } else {
      if (entry.hyp != null) {
        hypIndex += (entry.compound && entry.parts) ? entry.parts.length : 1;
      }
    }
  }

  // --- PASS 2: Apply recoveries ---

  // Apply substitution recoveries (alignment-only, no splice needed)
  for (const rec of substitutionRecoveries) {
    const entry = alignment[rec.alignIdx];
    entry.type = 'correct';
    entry._reverbRecovery = true;
    entry._reverbWord = rec.v0Word.word;
    const pkWord = transcriptWords[rec.hypIndex];
    pkWord._reverbRecovery = true;
    pkWord._reverbWord = rec.v0Word.word;
    pkWord._reverbStartTime = rec.v0Word.startTime;
    pkWord._reverbEndTime = rec.v0Word.endTime;
  }

  // Apply omission recoveries (requires splice -- do in reverse order to preserve indices)
  omissionRecoveries.sort((a, b) => b.insertPosition - a.insertPosition);
  for (const rec of omissionRecoveries) {
    const entry = alignment[rec.alignIdx];
    const recoveredWord = {
      word: rec.v0Word.word,
      startTime: rec.v0Word.startTime,
      endTime: rec.v0Word.endTime,
      _recovered: true,
      _reverbRecovery: true,
      isDisfluency: false,
      disfluencyType: null
    };
    entry.type = 'correct';
    entry.hyp = rec.v0Word.word;
    entry._recovered = true;
    entry._reverbRecovery = true;
    transcriptWords.splice(rec.insertPosition, 0, recoveredWord);
  }

  return { substitutionRecoveries, omissionRecoveries };
}
```

**Helper: findV0Match** -- exact text match with temporal proximity + adjacent pair concatenation for BPE:

```javascript
function findV0Match(v0Pool, refNorm, pkStartS, pkEndS, toleranceS) {
  // Single word match
  let best = null;
  for (const v0 of v0Pool) {
    if (v0.consumed) continue;
    if (v0.norm !== refNorm) continue;
    if (v0.endS < pkStartS - toleranceS || v0.startS > pkEndS + toleranceS) continue;
    const dist = Math.abs(v0.startS - pkStartS);
    if (!best || dist < best.dist) best = { ...v0, dist };
  }
  if (best) return best;

  // Adjacent pair match (handles V=0 BPE fragmentation)
  // e.g., V=0 says "mal" + "lon", reference says "mallon"
  for (let j = 0; j < v0Pool.length - 1; j++) {
    const a = v0Pool[j], b = v0Pool[j + 1];
    if (a.consumed || b.consumed) continue;
    const combined = a.norm + b.norm;
    if (combined !== refNorm) continue;
    if (b.endS < pkStartS - toleranceS || a.startS > pkEndS + toleranceS) continue;
    return {
      word: a.word + b.word,
      norm: combined,
      startTime: a.startTime,
      endTime: b.endTime,
      startS: a.startS,
      endS: b.endS,
      consumed: false,
      _parts: [a, b]
    };
  }
  return null;
}
```

**Why this replaces three mechanisms:**

| Current mechanism | What it detected | V=0 recovery equivalent |
|---|---|---|
| Proper noun forgiveness (NL API + dictionary) | Parakeet mangled a proper noun | V=0 heard the correct word -> exact match recovery |
| Omission recovery (unconsumedXval pool) | Parakeet missed a word entirely | V=0 heard the word -> omission recovery |
| Struggle Path 3 (unconfirmed + near-miss) | Student attempted but didn't produce full word | V=0 heard a near-miss -> `_v0NearMiss` flag |

**Why V=0 is more principled than current proper noun forgiveness:**
- Current: NL API says "might be a proper noun" + Free Dictionary API says "word doesn't exist" -> forgive. Two external API calls, heuristic.
- New: A CTC decoder literally heard the correct word in the audio -> recover. Direct acoustic evidence.

**Keep NL API proper noun forgiveness as a fallback.** V=0 recovery fires first (acoustic evidence is stronger). If V=0 also fragmented the proper noun (same model, correlated errors), fall back to the existing NL API + dictionary guard path. This preserves a safety net that's already built and tested, at the cost of ~0 extra complexity (the code already exists, just run it after V=0 recovery on remaining substitutions).

### Stage 6: Correct-but-Disputed Check (new -- ships with Layer 1)

This is the false-negative early warning system. It doesn't change scores -- it adds a flag that gives visibility into how often Parakeet smooths over genuine errors.

```javascript
// After V=0 recovery, before near-miss resolution
let hypIndex = 0;
for (let i = 0; i < alignment.length; i++) {
  const entry = alignment[i];
  if (entry.type === 'omission') continue;

  if (entry.type === 'correct' && !entry._reverbRecovery) {
    const pkWord = transcriptWords[hypIndex];
    const pkStartS = parseTime(pkWord.startTime);
    const pkEndS = parseTime(pkWord.endTime);
    const refNorm = normalize(entry.ref);

    // Find what V=0 heard in this time region
    const v0InRegion = findV0InRegion(v0Pool, pkStartS, pkEndS, 0.3);
    if (v0InRegion && v0InRegion.norm !== refNorm) {
      // V=0 heard something different from the reference word
      // AND different from what Parakeet said (Parakeet matched ref, V=0 didn't)
      const similarity = levenshteinRatio(v0InRegion.norm, refNorm);
      if (similarity < 0.6) {
        // Substantially different -- flag as disputed
        entry._disputed = true;
        entry._v0Heard = v0InRegion.word;
        entry._v0Similarity = similarity;
      }
    }
  }

  if (entry.hyp != null) {
    hypIndex += (entry.compound && entry.parts) ? entry.parts.length : 1;
  }
}
```

**What this gives you:**
1. **Data on false-negative rate.** Log `_disputed` count per assessment. If struggling readers show 15%+ disputed-correct words, the architecture needs adjustment.
2. **AI layer signal.** "Parakeet said correct, but CTC heard 'crere' -- possible smoothed error."
3. **Teacher tooltip.** "Note: Reverb heard 'crere' -- student may have struggled with this word."
4. **No scoring impact.** The word stays "correct." This is purely informational.

### Stage 7: Near-Miss Resolution (simplified)

`resolveNearMissClusters()` in `diagnostics.js` is **unchanged**. It operates purely on alignment entry types and text similarity -- no cross-validation dependency.

`absorbStruggleFragments()` is **deleted**. It existed to absorb BPE fragments (unconfirmed insertions near struggles) by temporal containment. Parakeet doesn't produce BPE fragments, so there are no orphan fragments to absorb.

### Stage 8: Diagnostics (simplified)

**`detectStruggleWords()` changes:**

| Path | Before | After |
|---|---|---|
| Path 1 (hesitation) | substitution + 3s+ pause + >3 chars | **Unchanged** -- no xval dependency |
| Path 2 (decoding) | `resolveNearMissClusters()` | **Unchanged** -- no xval dependency |
| Path 3 (abandoned) | `crossValidation === 'unconfirmed'` + near-miss | **Changed:** `_v0NearMiss` flag from Stage 5 + near-miss |

New Path 3 condition:
```javascript
// BEFORE:
if (sttWord.crossValidation === 'unconfirmed' && isNearMiss(entry.hyp, entry.ref))

// AFTER:
if (entry._v0NearMiss && isNearMiss(entry.hyp, entry.ref))
```

The signal changes from "cross-validator heard nothing" (absence) to "V=0 heard a near-miss" (positive evidence). This is a stronger signal.

**Skip-guard removal:** Five functions currently skip `unconfirmed` words to avoid Reverb's 100ms BPE timestamps. All skip-guards are removed -- Parakeet timestamps don't have 100ms quantization:

- `detectOnsetDelays()` -- remove `crossValidation === 'unconfirmed'` checks (~10 lines)
- `detectLongPauses()` -- remove `crossValidation === 'unconfirmed'` checks (~10 lines)
- `computePhrasingQuality()` -- remove `crossValidation === 'unconfirmed'` from excludeFromCount + gap scanning (~15 lines)
- `computeWordDurationOutliers()` -- remove xval-first/Reverb-fallback logic, use `startTime`/`endTime` directly (~20 lines)
- `computeWordSpeedTiers()` -- remove `xvalRawWords` parameter, use `transcriptWords` timestamps directly (~30 lines)

### How Layer 1 fixes the bugs

**Bug #1 ("you'llbecrere"):** Parakeet gives `["you", "will", "be", "creating"]`. Align against reference. All four match. Score: 4 correct. Done. Reverb's "crere" never enters the scoring path.

**Bug #2 ("orand"):** Parakeet gives `["etc.", "Or", "you", "can", "expand"]`. Align against reference. All five match (with word equivalence for "etc."). Score: 5 correct. Done. Reverb's "or" + "and" never enter the scoring path.

### Why keep V=0?

Kid stutters "the the the elephant":
- V=1: "the the the elephant" / V=0: "the elephant" -> 2 repetitions detected. **Correct.**
- V=1 vs Parakeet: all three "the" tokens overlap Parakeet's single "the" window -> 0 repetitions. **Wrong.**

V=1/V=0 catches repetitions because it's a controlled experiment -- same model, same audio, one variable (verbatim flag). Cross-model comparison can't reliably detect within-word repetitions. V=0 adds ~2-4 seconds to the Reverb pass (same model, already loaded). Worth it.

---

## Layer 2: Reverb Overlay

The temporal mapper is the shared infrastructure all Layer 3 features consume. It's ~100 lines and should ship the same week as Layer 1.

**Key insight: overlay mistakes don't affect scoring.** A wrong disfluency placement in the tooltip is a cosmetic annoyance. A wrong dispute flag is a false alert. Neither changes WCPM or accuracy. This means the simplest possible approach is fine.

```javascript
/**
 * Build overlay: for each Parakeet word, what did Reverb V=1 hear in that time region?
 *
 * Simple time-window filter with 200ms tolerance. Mistakes are cosmetic-only
 * (overlay is informational, not scoring-critical). Start simple, refine
 * based on real recordings if needed.
 *
 * @param {Array} parakeetWords - Primary transcript words with timestamps
 * @param {Array} reverbV1Words - Raw verbatim Reverb words with timestamps
 * @param {Array} disfluencies - Classified V=1 insertions from tagDisfluencies
 * @returns {Map<number, object>} parakeetIndex -> { reverbWords, disfluencies, gapWords }
 */
function buildReverbOverlay(parakeetWords, reverbV1Words, disfluencies) {
  const TOLERANCE_S = 0.2;
  const overlay = new Map();

  // Map Reverb V=1 words to Parakeet words by temporal overlap
  for (const rv of reverbV1Words) {
    const rvStartS = parseTime(rv.startTime);
    const rvEndS = parseTime(rv.endTime);

    let bestIdx = -1;
    let bestOverlap = 0;

    for (let i = 0; i < parakeetWords.length; i++) {
      const pkStartS = parseTime(parakeetWords[i].startTime);
      const pkEndS = parseTime(parakeetWords[i].endTime);

      const overlapStart = Math.max(rvStartS, pkStartS - TOLERANCE_S);
      const overlapEnd = Math.min(rvEndS, pkEndS + TOLERANCE_S);
      const overlap = Math.max(0, overlapEnd - overlapStart);

      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      if (!overlay.has(bestIdx)) {
        overlay.set(bestIdx, { reverbWords: [], disfluencies: [], gapWords: [] });
      }
      overlay.get(bestIdx).reverbWords.push(rv);
    }
  }

  // Map disfluencies to nearest Parakeet word
  for (const disf of disfluencies) {
    const disfStartS = parseTime(disf.startTime);

    let nearest = -1;
    let nearestDist = Infinity;
    for (let i = 0; i < parakeetWords.length; i++) {
      const dist = Math.abs(parseTime(parakeetWords[i].startTime) - disfStartS);
      if (dist < nearestDist) { nearest = i; nearestDist = dist; }
    }

    if (nearest >= 0 && nearestDist < 1.0) {
      if (!overlay.has(nearest)) {
        overlay.set(nearest, { reverbWords: [], disfluencies: [], gapWords: [] });
      }
      overlay.get(nearest).disfluencies.push(disf);
    }
  }

  // Identify gap words: Reverb V=1 words that don't overlap any Parakeet word
  // These are sounds Reverb heard but Parakeet ignored (sub-word attempts, breaths, etc.)
  for (const rv of reverbV1Words) {
    const rvStartS = parseTime(rv.startTime);
    const rvEndS = parseTime(rv.endTime);

    let hasOverlap = false;
    for (let i = 0; i < parakeetWords.length; i++) {
      const pkStartS = parseTime(parakeetWords[i].startTime);
      const pkEndS = parseTime(parakeetWords[i].endTime);
      if (rvStartS < pkEndS + TOLERANCE_S && rvEndS > pkStartS - TOLERANCE_S) {
        hasOverlap = true;
        break;
      }
    }

    if (!hasOverlap) {
      // This is a gap word -- find nearest Parakeet word for attachment
      let nearest = -1;
      let nearestDist = Infinity;
      for (let i = 0; i < parakeetWords.length; i++) {
        const dist = Math.abs(parseTime(parakeetWords[i].startTime) - rvStartS);
        if (dist < nearestDist) { nearest = i; nearestDist = dist; }
      }
      if (nearest >= 0 && nearestDist < 2.0) {
        if (!overlay.has(nearest)) {
          overlay.set(nearest, { reverbWords: [], disfluencies: [], gapWords: [] });
        }
        overlay.get(nearest).gapWords.push(rv);
      }
    }
  }

  return overlay;
}
```

**Store the overlay on the data object** so UI and diagnostics can consume it:

```javascript
data._kitchenSink.reverbOverlay = buildReverbOverlay(
  transcriptWords,
  data._kitchenSink.reverbV1Words,
  data._kitchenSink.disfluencies
);
```

---

## Layer 3: Diagnostic Feature Backlog

Each feature is independent, 1-2 days of work, and consumes the overlay from Layer 2. Ship them one at a time based on what real recordings reveal.

### Feature A: Correct-but-Disputed (ship WITH Layer 1)

Already described in Stage 6 above. Ships as part of Layer 1 because it's the false-negative early warning system. Uses V=0 pool directly (doesn't need the overlay).

### Feature B: Disfluency Context (ship week 2)

Attach V=1 disfluencies to Parakeet words via overlay. Tooltip shows: "Before 'elephant': [the] [the] [um]"

```javascript
// After buildReverbOverlay, walk alignment and attach
for (let i = 0; i < alignment.length; i++) {
  const entry = alignment[i];
  if (entry.type === 'omission') continue;

  const overlayData = overlay.get(hypIndex);
  if (overlayData && overlayData.disfluencies.length > 0) {
    entry._disfluencyContext = overlayData.disfluencies.map(d => ({
      word: d.word,
      type: d.disfluencyType,
      startTime: d.startTime
    }));
  }
  if (entry.hyp != null) hypIndex++;
}
```

UI change: tooltip shows disfluency context when present. ~30 lines of tooltip code.

### Feature C: Hallucination Flag (ship week 2)

Parakeet word with zero Reverb support (no V=0 word AND no V=1 word anywhere near its time window). Flag as potentially hallucinated.

```javascript
for (let i = 0; i < alignment.length; i++) {
  if (alignment[i].type !== 'correct') continue;
  const overlayData = overlay.get(hypIndex);
  const pkWord = transcriptWords[hypIndex];

  // No Reverb words at all in this time region
  if (!overlayData || overlayData.reverbWords.length === 0) {
    // Additional check: is this a short function word with compressed duration?
    const durationMs = (parseTime(pkWord.endTime) - parseTime(pkWord.startTime)) * 1000;
    const isShortFunctionWord = pkWord.word.length <= 3 && durationMs < 150;
    if (isShortFunctionWord) {
      alignment[i]._unsupported = true;
      alignment[i]._possibleHallucination = true;
    }
  }
}
```

### Feature D: Struggle Enrichment (ship week 3)

Parakeet scored "correct" but Reverb overlay shows fragments, garbled tokens, or a word with low similarity. This catches cases where Parakeet's LM smoothed a genuine struggle.

```javascript
for (let i = 0; i < alignment.length; i++) {
  if (alignment[i].type !== 'correct') continue;
  const overlayData = overlay.get(hypIndex);
  if (!overlayData) continue;

  // Check if Reverb heard something substantially different
  for (const rv of overlayData.reverbWords) {
    const rvNorm = rv.word.toLowerCase().replace(/[^a-z']/g, '');
    const refNorm = normalize(alignment[i].ref);
    if (rvNorm !== refNorm && !isNearMiss(rvNorm, refNorm)) {
      alignment[i]._struggled = true;
      alignment[i]._reverbHeard = rv.word;
      break;
    }
  }

  // Check for gap words that are near-misses (abandoned attempts)
  for (const gw of overlayData.gapWords) {
    const gwNorm = gw.word.toLowerCase().replace(/[^a-z']/g, '');
    const refNorm = normalize(alignment[i].ref);
    if (isNearMiss(gwNorm, refNorm)) {
      alignment[i]._nearMissAttempt = gw.word;
    }
  }
}
```

### Feature E: Gap Word Analysis (ship as needed)

Reverb V=1 words in gaps between Parakeet words -- already classified by disfluency tagger. Features:
- Near-miss check: is the gap word an abandoned attempt at the next word?
- Struggle sequence grouping: multiple gap fragments before one word = decoding struggle
- Self-correction detection: gap word matches previous word then next word differs

Build when real recordings demonstrate the need.

---

## sttLookup Construction (changed source)

```javascript
// BEFORE: built from Reverb cross-validated words
for (const w of transcriptWords) {  // Reverb merged+xval
  const norm = w.word.toLowerCase().replace(...);
  sttLookup.set(norm, [...]);
}

// AFTER: built from Parakeet words (same normalization, different source)
for (const w of transcriptWords) {  // Parakeet words
  const norm = w.word.toLowerCase()
    .replace(/^[^\w'-]+|[^\w'-]+$/g, '')
    .replace(/\./g, '')
    .replace(/-+$/, '');
  if (!sttLookup.has(norm)) sttLookup.set(norm, []);
  sttLookup.get(norm).push(w);
}
```

Compound word synthetic entries (app.js ~lines 756-791) work identically.

**Parakeet words are cleaner keys.** No BPE fragments like "pla" or "crere" polluting the lookup.

---

## Field Changes

### Fields REMOVED from transcriptWords

| Field | Why it existed | Why it's gone |
|---|---|---|
| `crossValidation` | Three-tier merge status | No merge operation |
| `_xvalStartTime` / `_xvalEndTime` | Cross-validator timestamps (secondary) | Parakeet timestamps are now primary |
| `_xvalWord` | What cross-validator heard | Parakeet IS the transcript |
| `_xvalEngine` | Which cross-validator | No cross-validator |
| `_mergedFragments` / `_mergedFrom` | Fragment merge tracking | No fragment merge |
| `_fuzzyMatch` / `_nearMatch` | Cross-validation similarity metadata | No cross-validation |
| `_reverbCleanStartTime` / `_reverbCleanEndTime` | V=0 timestamps on Reverb words | V=0 words stored separately now |

### Fields KEPT on transcriptWords

| Field | Source | Purpose |
|---|---|---|
| `word` | Parakeet | Primary word text |
| `startTime` / `endTime` | Parakeet | Primary timestamps (no longer secondary xval timestamps) |
| `confidence` | Parakeet (always 1.0) | Preserved for interface consistency |

### Fields ADDED to transcriptWords

| Field | When set | Purpose |
|---|---|---|
| `_reverbRecovery: true` | V=0 exact-match recovery | Marks word as recovered via Reverb |
| `_reverbWord: string` | V=0 exact-match recovery | What V=0 actually heard |
| `_reverbStartTime` / `_reverbEndTime` | V=0 recovery | V=0 timestamps for recovered word |
| `_recovered: true` | Omission recovery | Marks word as recovered from omission |

### Fields ADDED to alignment entries

| Field | When set | Purpose |
|---|---|---|
| `_reverbRecovery: true` | V=0 substitution recovery | Reverb heard the correct word |
| `_reverbWord: string` | V=0 substitution recovery | What V=0 heard |
| `_v0NearMiss: string` | V=0 near-miss detection | V=0 heard something close (struggle signal) |
| `_v0Similarity: number` | V=0 near-miss detection | How close (0-1) |
| `_disputed: true` | Correct-but-disputed check | V=0 heard something substantially different |
| `_v0Heard: string` | Correct-but-disputed check | What V=0 heard |
| `_disfluencyContext: Array` | Layer 3 Feature B | Nearby disfluencies from overlay |
| `_unsupported: true` | Layer 3 Feature C | No Reverb support (possible hallucination) |
| `_struggled: true` | Layer 3 Feature D | Reverb heard different word (smoothed struggle) |

---

## Fallback Strategy

**If Parakeet is unavailable (API error, GPU failure, timeout):**

Fall back to Reverb V=0 as primary transcript:

```javascript
if (!parakeetAvailable) {
  // V=0 is clean CTC -- no disfluencies, literal acoustic transcription
  transcriptWords = reverb.clean.words;
  // Skip V=0 recovery (can't recover using your own source)
  // Skip overlay (only one engine available)
  // Disfluencies still available from V=1/V=0 alignment
}
```

V=0 is always available when Reverb is available (same API call). It's cleaner than V=1 (no disfluencies) and produces a usable transcript. It has BPE fragmentation issues, but the post-alignment merges handle most of those.

**Do NOT keep the old pipeline as dead code.** 140 `crossValidation` references across 35 files is not maintainable as a fallback. The V=0 fallback is simpler and covers the failure case.

---

## Migration Strategy

### Saved assessments

`storage.js` needs a v7 migration:

```javascript
if (version < 7) {
  for (const word of assessment.transcriptWords || []) {
    delete word.crossValidation;
    delete word._xvalStartTime;
    delete word._xvalEndTime;
    delete word._xvalWord;
    delete word._xvalEngine;
    delete word._mergedFragments;
    delete word._mergedFrom;
  }
  assessment._storageVersion = 7;
}
```

Old saved assessments loaded in the new UI will have missing fields. The UI handles `undefined` gracefully via `?.` chaining.

### Feature flag for comparison

For the first deployment, add a URL parameter `?pipeline=reverb` that runs the old pipeline alongside and logs WCPM/accuracy disagreements:

```javascript
const useOldPipeline = new URLSearchParams(location.search).get('pipeline') === 'reverb';
```

Run both for at least 1 week, compare results on 20+ recordings across reading levels. Pay special attention to below-grade-level readers (highest false-negative risk).

---

## Risk Assessment (honest)

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Parakeet smooths over real errors (false negatives) | **HIGH** | Correct-but-disputed flag (Layer 1) provides visibility; Layer 3D enriches further | Medium -- some false negatives will slip through until overlay features mature |
| Parakeet mangles proper nouns | HIGH | V=0 exact-match recovery (acoustic evidence) + NL API fallback (existing code) | Low |
| V=0 also fragments proper nouns (same model, correlated errors) | MODERATE | Adjacent-pair concatenation in `findV0Match()` + NL API fallback | Low |
| Parakeet ITN ("23" for "twenty-three") | LOW | `getCanonical()` already handles this in NW scoring | None |
| Parakeet hallucinations (false function words) | LOW-MOD | Layer 3C `_unsupported` flag | Medium until Feature C ships |
| Parakeet unavailable | MODERATE | V=0 fallback (clean CTC as primary) | Low |
| Disfluency detection regression | NONE | V=1/V=0 mechanism unchanged | None |
| WCPM regression | HIGH | Feature flag comparison mode; run both pipelines for 1 week | Low after validation |
| 140 `crossValidation` references broken | HIGH | Systematic removal; skip-guards deleted not renamed; `?.` chaining prevents crashes | Medium during implementation |
| Saved assessment loading | LOW | v7 migration strips deprecated fields | Low |
| `transcriptWords.splice()` desync | MODERATE | Two-pass algorithm (collect then apply in reverse order) | Low |
| Value regression (less diagnostic data) | MODERATE | Ship correct-but-disputed + overlay in same week as pipeline flip | Low if timeline holds |

**The honest central risk: Parakeet smoothing over real errors.** A student who says "crere" for "creating" may score as correct because Parakeet heard "creating." The correct-but-disputed check (Layer 1) gives you data on how often this happens. If after a week of real recordings you see `_disputed` firing on 15%+ of correct words for struggling readers, the false-negative rate is too high and you need to rethink (maybe scoring uses a weighted combination of Parakeet and Reverb evidence instead of Parakeet-only).

The current system's false positives (marking correct words as errors) erode teacher trust faster than false negatives (missing an error). Net: this architecture is better for teachers, but the trade-off is real.

---

## File-by-File Change List

### `js/kitchen-sink-merger.js` (~310 lines -> ~180 lines)

**Remove:**
- `crossValidateTranscripts()` call and result handling
- `buildMergedWordsFromAlignment()` (replaced by `extractStreams()`)
- `unconsumedXval` construction

**Change:**
- Return shape: `{ parakeetWords, reverbV0Words, reverbV1Words, disfluencies, disfluencyStats }`
- Still runs Reverb + Parakeet in parallel
- Still runs V=1/V=0 alignment + disfluency tagging

**Keep:**
- All API call orchestration
- V=1/V=0 NW alignment
- `tagDisfluencies()` call
- `computeDisfluencyStats()`
- Fallback logic (Reverb unavailable)

### `js/cross-validator.js` (~312 lines -> deleted or minimal)

**Phase 1:** Delete `crossValidateTranscripts()` and the three-tier classification logic. Keep `getCrossValidatorEngine()` / `sendToCrossValidator()` (used by kitchen-sink-merger to call Parakeet).

**Later:** Evaluate if file should be renamed to `parakeet-api-router.js` or similar since it's no longer a "cross-validator."

### `js/app.js` (~1560 lines, ~250 lines changed)

**Remove:**
- Pre-alignment fragment merge block (~80 lines, ~lines 484-578)
- Fragment merge constraints and guards
- `unconsumedXval` omission recovery (~80 lines, ~lines 793-878)
- `absorbStruggleFragments()` call (~10 lines, ~lines 945-955)
- xval abbreviation confirmation (~40 lines, ~lines 886-922)
- `data._kitchenSink.xvalRawWords` usage in `computeWordSpeedTiers()` call
- CTC artifact filter that checks `crossValidation === 'confirmed'` (~15 lines, ~lines 698-715)
- "healed" word marking that checks `crossValidation` (~35 lines, ~lines 1422-1458)
- `crossValidation` references in debug stage logging

**Change:**
- Kitchen Sink result destructuring: extract `parakeetWords`, `reverbV0Words`, `reverbV1Words`, `disfluencies`
- `transcriptWords` source: Parakeet words instead of Reverb merged words
- sttLookup construction: same normalization, different source
- `computeWordSpeedTiers()` call: remove `xvalRawWords` parameter

**Add:**
- `reverbRecovery()` function (~120 lines): two-pass V=0 recovery
- Correct-but-disputed check (~30 lines)
- `buildReverbOverlay()` call (~5 lines)
- Disfluency storage: `data._kitchenSink.disfluencies` and `data._kitchenSink.reverbOverlay`

**Keep:**
- Reference text processing (`normalizeText()`)
- `alignWords()` call (same function, different input)
- Post-alignment merges (compound, abbreviation, contraction)
- sttLookup compound word synthesis
- NL API annotation flow + proper noun forgiveness (as fallback after V=0 recovery)
- `resolveNearMissClusters()` call
- `runDiagnostics()` call
- `_displayRef` / refPositions IIFE
- All five hyphen-split-sync points
- VAD processing

### `js/diagnostics.js` (~1900 lines, ~250 lines changed)

**Remove:**
- `absorbStruggleFragments()` (~180 lines, ~lines 231-388)
- All `crossValidation === 'unconfirmed'` skip-guards in:
  - `detectOnsetDelays()` (~10 lines)
  - `detectLongPauses()` (~10 lines)
  - `computePhrasingQuality()` (~15 lines)

**Change:**
- `detectStruggleWords()` Path 3: `crossValidation === 'unconfirmed'` -> `entry._v0NearMiss` (~5 lines)
- `computeWordSpeedTiers()`: remove `xvalRawWords` parameter, remove `consumeXvalAt()` helper, use `transcriptWords` timestamps directly (~80 lines simplified)
- `computeWordDurationOutliers()`: remove xval-first/Reverb-fallback logic, use `startTime`/`endTime` directly (~30 lines simplified)

**Keep:**
- `resolveNearMissClusters()` (no xval dependency)
- `detectStruggleWords()` Paths 1 and 2
- All prosody/punctuation analysis
- Phoneme normalization
- `isNearMiss()`, `levenshteinRatio()` usage

### `js/ui.js` (~2200 lines, ~150 lines changed)

**Remove:**
- Cross-validation status display in tooltips
- Three-timestamp-source display
- `crossValidation`-based CSS class assignment
- Model Disagreements section categorization by xval status
- Unconsumed xval words section

**Change:**
- Tooltip: show Parakeet timestamps + recovery info if `_reverbRecovery` + disputed info if `_disputed`
- Model Disagreements: simplify to recovery + disputed + V=0 near-miss categories

**Add:**
- Disfluency context display (Layer 3 Feature B, when it ships)

**Keep:**
- Click-to-play audio (uses `sttWord.startTime`/`endTime` -- now Parakeet timestamps directly)
- `showWordTooltip()` / `hideWordTooltip()` mechanism
- All CSS classes for alignment types
- Word speed map display
- Diagnostic badges

### `js/word-equivalences.js`

**No changes needed for Layer 1.** ITN equivalences (ordinals, numbers) already exist. Add gaps (ordinals 21st-99th, currency) incrementally as real passages expose them.

### `js/miscue-registry.js`

**Update** to reflect new pipeline:
- Remove fragment merge entry
- Remove cross-validation references in struggle type
- Update omission recovery description (V=0 pool instead of unconsumedXval)
- Add V=0 near-miss as struggle signal
- Add correct-but-disputed as informational annotation

### `js/storage.js`

**Add** v6->v7 migration for field renames.

### `index.html`

**Version bump.**

### `sw.js`

**Cache version bump.**

---

## Implementation Order

### Week 1: Pipeline Flip (Layer 1)

1. **Kitchen Sink Merger refactor** -- change return shape, remove cross-validation call, add `extractStreams()`
2. **app.js transcript source** -- switch from Reverb to Parakeet, remove fragment merge
3. **sttLookup rebuild** -- same normalization, new source
4. **V=0 recovery** -- new `reverbRecovery()` function (two-pass)
5. **Correct-but-disputed check** -- false-negative early warning
6. **Diagnostics cleanup** -- remove skip-guards, update Path 3, simplify speed tiers + outlier detection
7. **Feature flag comparison mode** -- `?pipeline=reverb` runs old pipeline alongside

Steps 1-5 are the critical path (scoring correctness). Step 6 is cleanup. Step 7 is validation.

### Week 1 (parallel): Overlay Infrastructure (Layer 2)

8. **`buildReverbOverlay()`** -- temporal mapper, ~100 lines
9. **Store overlay on data object** -- `data._kitchenSink.reverbOverlay`

### Week 1 (end): UI + Migration

10. **UI cleanup** -- remove xval display, simplify tooltips and disagreements section
11. **Miscue registry + storage migration** -- update documentation, add v7 migration
12. **Version bump** -- `index.html` + `sw.js`

### Week 2: First diagnostic features (Layer 3 A-C)

13. **Disfluency context** (Feature B) -- attach V=1 disfluencies to Parakeet words via overlay
14. **Hallucination flag** (Feature C) -- flag unsupported Parakeet words
15. **Tooltip enrichment** -- display disfluency context and disputed/unsupported flags

### Week 3: Struggle enrichment (Layer 3 D)

16. **Overlay-based struggle detection** (Feature D) -- Reverb heard different word on "correct" entries
17. **Gap word analysis** (Feature E) -- if real recordings show the need

### Ongoing: Comparison and calibration

18. **Run feature flag comparison** for 1+ week on 20+ recordings
19. **Monitor `_disputed` rate** by reading level -- if >15% on struggling readers, reassess
20. **Expand ITN equivalences** as Parakeet output patterns reveal gaps

---

## Testing Strategy

### Required test recordings

| Scenario | What to verify | Count |
|---|---|---|
| Clean reading (no errors) | WCPM matches between pipelines | 5 |
| Passage with proper nouns | V=0 recovery fires, correct WCPM; NL API fallback works when V=0 misses | 3 |
| Passage with numbers/ordinals | Existing `getCanonical()` equivalences work | 2 |
| Student with repetitions ("the the the") | Disfluencies still detected via V=1/V=0 | 3 |
| Student with false starts ("cre- creating") | Disfluencies classified correctly | 3 |
| Student with omissions | V=0 omission recovery fires | 3 |
| Student with substitutions (real errors) | Errors correctly scored; `_disputed` does NOT fire (V=0 agrees) | 3 |
| Student with struggles | Path 1 + Path 3 (V=0 near-miss) fire | 3 |
| Struggling reader (garbled attempts) | `_disputed` fires appropriately; measure false-negative rate | 5 |
| Parakeet unavailable | V=0 fallback produces reasonable WCPM | 2 |

### Regression checks

1. Both documented bugs ("you'llbecrere", "orand") are eliminated
2. WCPM never differs by more than +/-2 words from current pipeline on clean readings
3. Disfluency counts match current pipeline (same V=1/V=0 mechanism)
4. Word speed map still produces 8 tiers with correct phoneme normalization
5. Proper noun forgiveness still works (V=0 recovery + NL API fallback)
6. `_disputed` rate is logged per assessment for ongoing monitoring

---

## Pre-Implementation Checklist

Before writing code, answer these empirically:

1. **Run 5-10 struggling-reader recordings through Parakeet alone.** Does Parakeet smooth "crere" -> "creating"? What's the false-negative rate? If >20%, rethink the architecture.

2. **Check Parakeet's API for ITN options.** Does it have `with_itn=False`? If yes, use it (simpler than equivalences). If it outputs "$5.00" for "five dollars", add equivalences.

3. **Run proper-noun-heavy passages through Reverb V=0.** Does V=0 produce "Mallon" as one token, or "mal" + "lon"? How often does adjacent-pair concatenation fire? Do you need 3-part handling?

4. **Verify Parakeet's confidence field.** Is it always 1.0? If it varies, it could be useful for hallucination detection (low-confidence short function words = likely hallucinated).

---

## Summary

**Current architecture:** 9 stages, Reverb-primary, fragment merge + NW cross-validation create cascading false errors. 140 `crossValidation` references across 35 files.

**New architecture:** 6 stages + overlay, Parakeet-primary, V=0 recovery for proper nouns and omissions, correct-but-disputed check for false-negative visibility. Fragment merge and cross-validation-as-merge are deleted. Reverb overlay maps diagnostic texture onto Parakeet timeline as informational annotations.

**The key architectural change:** Cross-validation stops being a merge operation (two transcripts -> one, where merge mistakes cascade into scoring) and becomes an overlay operation (one transcript + supplementary signal, where overlay mistakes are cosmetic). This is the single most important insight.

**The key operational change:** No regression window. Correct-but-disputed + overlay ship the same week as the pipeline flip. Teachers see more useful data on day one, not less.
