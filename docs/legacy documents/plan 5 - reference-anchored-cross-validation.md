# Plan 5: Reference-Anchored Cross-Validation

## Core Idea

Replace the fragile engine-to-engine NW alignment (Reverb ↔ Parakeet) with two independent reference-anchored alignments. Instead of pairing two imperfect transcripts against each other, align each engine to the **reference text** independently, then compare their verdicts per reference word.

**What stays the same**: Everything except cross-validation. Reverb remains primary. The kitchen sink pipeline structure, disfluency detection, NW alignment, diagnostics, UI — all unchanged.

**What changes**: How cross-validation works. Instead of `crossValidateTranscripts()` doing NW alignment between Reverb and Parakeet word sequences, we run `alignWords()` twice (once for Reverb, once for Parakeet) and compare their per-reference-word verdicts.

---

## Why This Works

### Current approach (fragile)
```
Reverb words:   [the, elefant, sat, the, the]    ← 5 words (includes disfluencies)
Parakeet words: [the, elephant, sat]              ← 3 words (no disfluencies)
                          ↕
            NW align these two lists
            (hope word 2 pairs with word 2)
```
The engine-to-engine NW aligner must figure out that Reverb's "elefant" corresponds to Parakeet's "elephant", while the two extra "the" entries are disfluencies with no Parakeet counterpart. When BPE fragments, compound splits, or disfluency clusters appear, positional pairing goes wrong — which is why we need fragment pre-merge, absorbStruggleFragments, and healing loops.

### New approach (stable)
```
Reference text: "The elephant sat on the mat."
                         ↓                    ↓
Alignment R (Reverb→Ref):    [correct, substitution, correct, ...]
Alignment P (Parakeet→Ref):  [correct, correct,      correct, ...]
                                       ↕
                        Compare at ref word #2:
                        Reverb says substitution ("elefant")
                        Parakeet says correct ("elephant")
                        → disagreed (Parakeet thinks student got it right)
```
The reference text is perfect — no BPE fragments, no disfluencies, no hallucinations. Each alignment is clean. Comparison is a simple zip by reference word index.

---

## What Gets Deleted or Replaced

| Code | Location | Lines | Action | Why |
|------|----------|-------|--------|-----|
| `crossValidateTranscripts()` | cross-validator.js:126-306 | ~180 | **Deleted** | Engine-to-engine NW alignment — replaced by reference-anchored comparison |
| Fragment pre-merge | app.js:484-578 | ~95 | **Replaced** (~40 lines) | Old version depended on crossValidation status. New reference-aware version uses ref word set instead. See Stage 5. |
| `absorbStruggleFragments()` | diagnostics.js:231-388 | ~160 | **Replaced** (~35 lines) | Old version needed cross-engine timestamp propagation and complex pairing. New `absorbMispronunciationFragments()` is a simple temporal containment check — substitutions already have Parakeet timestamps from Stage 3. See Stage 6. |
| absorbStruggleFragments call | app.js:949-955 | ~7 | **Updated** | Call site updated to use new function name + simplified args |
| **Total deleted** | | **~400** | | |
| **Total added (replacements)** | | **~75** | | |
| **Net reduction** | | **~325** | | |

---

## What Stays Exactly The Same

- **Kitchen sink pipeline structure**: Reverb ensemble + Parakeet in parallel (kitchen-sink-merger.js)
- **V=1/V=0 disfluency detection**: `alignTranscripts()` + `tagDisfluencies()` (unchanged)
- **Reverb→Reference NW alignment**: `alignWords(referenceText, transcriptWords)` (unchanged, still the primary)
- **Post-alignment pipeline**: compound merge, abbreviation merge, contraction merge (unchanged on Reverb alignment)
- **Omission recovery**: still uses Parakeet words to recover omissions (mechanism simplified)
- **All diagnostics**: struggle detection, word speed map, pause analysis (unchanged)
- **All UI rendering**: tooltips, word speed map, confidence view (unchanged)
- **sttLookup**: same construction, same keys (unchanged)
- **Proper noun forgiveness**: NL API + dictionary guard (unchanged)
- **All `crossValidation` field values**: confirmed, disagreed, unconfirmed, unavailable, recovered — same strings, same meaning
- **All `_xvalStartTime`/`_xvalEndTime` fields**: still set, still used for timestamps and tooltips
- **All `crossValidation === 'unconfirmed'` guards in diagnostics.js**: ~20 skip-guards, all still work

The downstream code sees the same fields with the same values. It doesn't know or care that cross-validation is now reference-anchored instead of engine-to-engine.

---

## Implementation

### Stage 1: Modify kitchen-sink-merger.js

Remove the `crossValidateTranscripts()` call. Return merged Reverb words **without** cross-validation status, plus raw Parakeet words separately.

**Before** (lines 237-240):
```js
const xvalWords = xvalRaw?.words || null;
const xvalCrossResult = crossValidateTranscripts(mergedWords, xvalWords);
const validatedWords = xvalCrossResult.words;
const unconsumedXval = xvalCrossResult.unconsumedXval;
```

**After**:
```js
const validatedWords = mergedWords.map(w => ({
  ...w,
  crossValidation: 'pending',   // will be set by reference-anchored comparison in app.js
  _reverbStartTime: w.startTime,
  _reverbEndTime: w.endTime
}));
```

Return shape changes:
- `words`: Reverb words with `crossValidation: 'pending'` (no longer 'confirmed'/'unconfirmed')
- `unconsumedXval`: removed (no longer needed — omission recovery uses Parakeet alignment instead)
- `xvalRaw`: still returned (Parakeet raw words needed for Parakeet→Reference alignment)

Remove `crossValidateTranscripts` from imports.

---

### Stage 2: Add Parakeet→Reference alignment in app.js

After the existing Reverb→Reference alignment (`alignWords(referenceText, transcriptWords)`, line 728), run a second alignment for Parakeet.

```js
// Existing: Reverb → Reference alignment (unchanged — full post-processing)
const alignment = alignWords(referenceText, transcriptWords);

// NEW: Parakeet → Reference alignment (full post-processing including contraction merge)
const parakeetWords = data._kitchenSink?.xvalRaw?.words || [];
const parakeetAlignment = parakeetWords.length > 0
  ? alignWords(referenceText, parakeetWords)
  : null;
```

`alignWords()` is already stateless and reusable — it takes a reference string and an array of word objects with `.word` property. Parakeet words (`{word, startTime, endTime, confidence}`) satisfy this interface. The same post-processing (compound merge, abbreviation merge, contraction merge) runs on both alignments.

**Contraction merge does NOT cause ref-entry count desync.** An earlier draft of this plan proposed skipping contraction merge on the Parakeet alignment to prevent desync. This was based on a wrong assumption that contraction merge collapses ref entries. In fact, `mergeContractions()` converts `sub + omission` (2 entries) into `correct + correct` (still 2 entries) — the ref-entry count is preserved. Both alignments always produce the same number of ref entries because they process the same reference text with the same deterministic pipeline.

Furthermore, skipping contraction merge on one alignment would **introduce a bug**: if Reverb hears "won't" and contraction merge converts it to `correct("will") + correct("not")`, but Parakeet also hears "won't" and contraction merge is skipped, Parakeet shows `sub("will"/"won't") + omission("not")`. The zip would produce a false recovery for "not" — a word that was never omitted.

**Implementation:** One change to `alignWords()` in alignment.js:

**Add `hypIndex` to every alignment entry (~3 lines in traceback).**

The NW traceback already knows which hyp word each entry corresponds to (`j - 1`). Emit it:

```js
// alignment.js traceback — add hypIndex to each entry
result.unshift({ ref: refWords[i-1], hyp: hypWords[j-1], type, hypIndex: j - 1 });       // diag (correct/substitution)
result.unshift({ ref: refWords[i-1], hyp: null, type: 'omission', hypIndex: -1 });        // up (omission — no hyp word)
result.unshift({ ref: null, hyp: hypWords[j-1], type: 'insertion', hypIndex: j - 1 });    // left (insertion)
```

This eliminates all text-based `transcriptWords` lookups downstream. Instead of `sttLookup.get(norm)` queue consumption or `.find(w => w.word === hyp)`, code can use `transcriptWords[entry.hypIndex]` directly. No ambiguity, no consumption ordering bugs, no duplicate-text confusion.

Post-processing merges (`mergeCompoundWords`, `mergeAbbreviationExpansions`, `mergeContractions`) must propagate `hypIndex` when creating new entries. **These functions build new objects with explicit field lists — they do NOT spread originals.** `hypIndex` will be silently dropped unless explicitly listed at each merge site.

**6 sites require explicit `hypIndex` addition:**

1. `mergeCompoundWords` **Pattern A** (line ~51): `{ ref, hyp, type, compound, parts }` — add `hypIndex: current.hypIndex` (substitution is the first consumed entry)
2. `mergeCompoundWords` **Pattern B** (line ~95): `{ ref, hyp, type, compound, parts }` — add `hypIndex: alignment[subIdx].hypIndex` (substitution carries the primary hyp)
3. `mergeAbbreviationExpansions` **Pattern A** (line ~202): `{ ref, hyp, type, compound, _abbreviationExpansion, parts }` — add `hypIndex: current.hypIndex`
4. `mergeAbbreviationExpansions` **Pattern B** (line ~265): `{ ref, hyp, type, compound, _abbreviationExpansion, parts }` — add `hypIndex: alignment[subIdx].hypIndex`
5. `mergeContractions` **Pattern A** (lines ~343-356): Creates TWO entries from sub+omission → correct+correct. First entry: `hypIndex: current.hypIndex` (the sub's hyp word). Second entry: `hypIndex: current.hypIndex` (same hyp word — both ref words were spoken as one contraction).
6. `mergeContractions` **Pattern B** (lines ~375-388): Creates TWO entries from omission+sub. First entry: `hypIndex: next.hypIndex`. Second entry: `hypIndex: next.hypIndex` (the sub's hyp word in both cases).

Non-matching entries pass through via `result.push(current)` or `result.push(alignment[k])` which preserves the original object (including `hypIndex`) by reference.

This is a ~8-10 line change to alignment.js. Default behavior is unchanged.

**No `parakeetLookup` needed.** An earlier draft built a text-based queue (mirroring sttLookup), but this is inconsistent with the `hypIndex` approach and breaks for compound-merged Parakeet entries (queue has "every"+"one" but not "everyone"). Since Parakeet alignment entries also get `hypIndex` from the traceback change, timestamps are accessed directly via `parakeetWords[pEntry.hypIndex]`. See `_consumeParakeetTimestamp` in Stage 3.

---

### Stage 3: Reference-anchored cross-validation

New function that replaces `crossValidateTranscripts()`:

```js
/**
 * Cross-validate by comparing per-reference-word verdicts from two independent alignments.
 *
 * Both alignments run the full post-processing pipeline (compound merge, abbreviation merge,
 * contraction merge). mergeContractions() preserves ref-entry count (converts sub+omission
 * into correct+correct — still 2 entries), so no expansion or skipping is needed.
 *
 * @param {Array} reverbAlignment  - Reverb→Reference alignment entries
 * @param {Array} parakeetAlignment - Parakeet→Reference alignment entries (or null)
 * @param {Array} transcriptWords  - Reverb transcript words (mutated: crossValidation set)
 * @param {Array} parakeetWords    - Raw Parakeet word array (timestamps accessed via hypIndex)
 */
function crossValidateByReference(reverbAlignment, parakeetAlignment, transcriptWords, parakeetWords) {
  // If Parakeet unavailable, mark all as unavailable (same as today's graceful degradation)
  if (!parakeetAlignment) {
    for (const entry of reverbAlignment) {
      if (entry.type === 'insertion') continue;
      _setCrossValidation(entry, transcriptWords, 'unavailable', null);
    }
    return { recoveredOmissions: [] };
  }

  // Extract reference-word entries (skip insertions) from each alignment.
  // Both alignments run the same full pipeline (including contraction merge),
  // and mergeContractions preserves ref-entry count (sub+omission → correct+correct),
  // so the ref-entry lists are the same length — no expansion needed.
  const reverbRef = reverbAlignment.filter(e => e.type !== 'insertion');
  const parakeetRef = parakeetAlignment.filter(e => e.type !== 'insertion');

  // INVARIANT: ref-entry counts MUST match. Both alignments process the same
  // reference text through the same normalizeText() and the same post-processing
  // pipeline. NW guarantees every ref word appears exactly once. All merge functions
  // preserve ref-entry count (compound: 1→1, abbreviation: 1→1, contraction: 2→2).
  // A mismatch means a bug in a merge function — and a corrupted zip would produce
  // confident-but-wrong statuses for every word after the divergence point, which is
  // WORSE than no cross-validation at all.
  if (reverbRef.length !== parakeetRef.length) {
    console.error(`[xval-ref] INVARIANT VIOLATION: ref-entry count mismatch: Reverb=${reverbRef.length}, Parakeet=${parakeetRef.length}. Falling back to unavailable.`);
    // Safe degradation: mark all as unavailable rather than corrupt the zip
    for (const entry of reverbAlignment) {
      if (entry.type === 'insertion') continue;
      _setCrossValidation(entry, transcriptWords, 'unavailable', null);
    }
    return { recoveredOmissions: [] };
  }

  const len = reverbRef.length;
  const recoveredOmissions = [];

  for (let i = 0; i < len; i++) {
    const rEntry = reverbRef[i];
    const pEntry = parakeetRef[i];

    // Sanity: both should have the same ref word (or close)
    if (rEntry.ref !== pEntry.ref) {
      console.warn(`[xval-ref] Ref word mismatch at index ${i}: "${rEntry.ref}" vs "${pEntry.ref}"`);
    }

    // --- Decision logic ---
    let status;
    let parakeetTimestamps = _consumeParakeetTimestamp(pEntry, parakeetWords);

    if (rEntry.type === 'correct' && pEntry.type === 'correct') {
      // Both agree: student read the word correctly
      status = 'confirmed';
    }
    else if (rEntry.type === 'correct' && pEntry.type !== 'correct') {
      // Reverb says correct, Parakeet doesn't — Reverb wins (it's primary)
      // Could be Parakeet ITN issue (e.g., ref "twenty-three", Parakeet heard "23")
      status = 'confirmed';
    }
    else if (rEntry.type === 'substitution' && pEntry.type === 'correct') {
      // Reverb heard wrong word, but Parakeet heard the right word
      // Parakeet's LM may have autocorrected — flag as disagreed for teacher review
      status = 'disagreed';
    }
    else if (rEntry.type === 'substitution' && pEntry.type === 'substitution') {
      // Both heard a wrong word
      const normR = rEntry.hyp?.toLowerCase().replace(/[^a-z'-]/g, '') || '';
      const normP = pEntry.hyp?.toLowerCase().replace(/[^a-z'-]/g, '') || '';
      if (normR === normP) {
        // Same substitution — both engines agree the student said this wrong word
        status = 'confirmed';
      } else {
        // Different substitutions — genuine confusion
        status = 'disagreed';
      }
    }
    else if (rEntry.type === 'omission' && pEntry.type !== 'omission') {
      // Reverb missed it, but Parakeet heard something → recover the omission
      status = 'recovered';
      recoveredOmissions.push({ refIndex: i, entry: rEntry, parakeetEntry: pEntry, timestamps: parakeetTimestamps });
    }
    else if (rEntry.type !== 'omission' && pEntry.type === 'omission') {
      // Reverb heard something, Parakeet missed it — Reverb-only word
      status = 'unconfirmed';
      parakeetTimestamps = null; // no Parakeet data for this word
    }
    else if (rEntry.type === 'omission' && pEntry.type === 'omission') {
      // Both agree the student skipped this word — confirmed omission
      // (no crossValidation to set — omissions don't carry this field)
      continue;
    }
    else {
      // Catch-all (shouldn't happen)
      status = 'unconfirmed';
    }

    // Apply cross-validation status + Parakeet timestamps to the Reverb alignment entry
    // and its corresponding transcriptWord via hypIndex.
    _setCrossValidation(rEntry, transcriptWords, status, parakeetTimestamps);
    // Set _xvalWord separately — use pEntry.hyp (the aligned/merged form), not
    // parakeetTs.word (the raw first fragment). For compound-merged Parakeet entries
    // these differ: hyp="everyone" vs raw="every". pEntry.hyp is what matters.
    if (pEntry.hyp) {
      rEntry._xvalWord = pEntry.hyp;
      if (rEntry.hypIndex != null && rEntry.hypIndex >= 0) {
        const tw = transcriptWords[rEntry.hypIndex];
        if (tw) tw._xvalWord = pEntry.hyp;
      }
    }
  }

  return { recoveredOmissions };
}
```

Helper to get Parakeet timestamps via `hypIndex` (no text-based queue):
```js
function _consumeParakeetTimestamp(parakeetEntry, parakeetWords) {
  if (!parakeetEntry || parakeetEntry.type === 'omission') return null;
  if (parakeetEntry.hypIndex == null || parakeetEntry.hypIndex < 0) return null;
  const pw = parakeetWords[parakeetEntry.hypIndex];
  if (!pw) return null;
  return { word: pw.word, startTime: pw.startTime, endTime: pw.endTime };
  // Note: for compound-merged Parakeet entries (rare — Parakeet's transformer LM
  // rarely fragments like Reverb's CTC), hypIndex points to the first consumed
  // fragment. startTime is correct; endTime covers only that fragment (~100ms short).
  // Acceptable because (a) Parakeet compound merges are extremely rare, and
  // (b) the timestamp error is one BPE token (~100ms), well within tolerance.
}
```

Helper to set crossValidation status and timestamps on the alignment entry and its transcriptWord.
`_xvalWord` is NOT set here — callers set it explicitly using the appropriate form
(`pEntry.hyp` for ref-word entries which may be compound-merged, `ts.word` for insertions).
```js
function _setCrossValidation(entry, transcriptWords, status, parakeetTs) {
  entry.crossValidation = status;

  // Set Parakeet timestamps if available
  if (parakeetTs) {
    entry._xvalStartTime = parakeetTs.startTime;
    entry._xvalEndTime = parakeetTs.endTime;
  }

  // Also set on the corresponding transcriptWord — using hypIndex for direct access.
  // No text-based queue lookup needed. hypIndex is set by alignWords() traceback
  // and propagated through compound/abbreviation/contraction merges.
  if (entry.hypIndex != null && entry.hypIndex >= 0) {
    const tw = transcriptWords[entry.hypIndex];
    if (tw) {
      tw.crossValidation = status;
      if (parakeetTs) {
        tw.startTime = parakeetTs.startTime;   // Parakeet as primary timekeeper
        tw.endTime = parakeetTs.endTime;
        tw._xvalStartTime = parakeetTs.startTime;
        tw._xvalEndTime = parakeetTs.endTime;
      }
    }
  }
}
```

### Diagnostic logging (stolen from Plan 6)

At the end of `crossValidateByReference()`, log a per-reference-word comparison table for empirical observation:

```js
// Diagnostic: per-reference-word comparison table
if (reverbRef.length > 0) {
  const table = [];
  for (let i = 0; i < len; i++) {
    const r = reverbRef[i];
    const p = parakeetRef[i];
    table.push({
      ref: r.ref,
      reverb: r.type === 'correct' ? '✓' : r.type === 'omission' ? '—' : `✗(${r.hyp})`,
      parakeet: p.type === 'correct' ? '✓' : p.type === 'omission' ? '—' : `✗(${p.hyp})`,
      status: r.crossValidation || '?'
    });
  }
  console.table(table);
  const agreed = table.filter(t => t.reverb === t.parakeet).length;
  console.log(`[xval-ref] Agreement: ${agreed}/${len} (${(100 * agreed / len).toFixed(0)}%)`);
}
```

This gives the observational data from Plan 6's three-panel concept without the UI development overhead. You can inspect it naturally in the browser console as you test recordings.

---

### Stage 4: Simplify omission recovery

Current omission recovery (app.js:798-868) searches an `unconsumedXval` pool for matching words. With reference-anchored comparison, omission recovery falls out naturally from Stage 3: when Reverb has an omission but Parakeet has a match/substitution, we already know the recovery.

The `recoveredOmissions` array from `crossValidateByReference()` replaces the current pool-search loop:

```js
// Replace current omission recovery (lines 798-868) with:
for (const recovery of xvalResult.recoveredOmissions) {
  const entry = recovery.entry;
  const ts = recovery.timestamps;

  if (!ts) continue;

  const recoveredWord = {
    word: ts.word,
    startTime: ts.startTime,
    endTime: ts.endTime,
    crossValidation: 'recovered',
    _xvalStartTime: ts.startTime,
    _xvalEndTime: ts.endTime,
    _xvalWord: ts.word,
    _recovered: true,
    isDisfluency: false,
    disfluencyType: null
  };

  // Insert into transcriptWords at correct timestamp position
  const xvStart = parseT(ts.startTime);
  let insertIdx = transcriptWords.length;
  for (let k = 0; k < transcriptWords.length; k++) {
    if (parseT(transcriptWords[k].startTime) > xvStart) {
      insertIdx = k;
      break;
    }
  }
  transcriptWords.splice(insertIdx, 0, recoveredWord);

  // Heal alignment: omission → correct
  entry.type = 'correct';
  entry.hyp = ts.word;
  entry.hypIndex = insertIdx;  // Point to the newly spliced transcriptWord
  entry._recovered = true;

  // Add to sttLookup
  const lookupKey = ts.word.toLowerCase().replace(/[^a-z'-]/g, '').replace(/\./g, '');
  if (!sttLookup.has(lookupKey)) sttLookup.set(lookupKey, []);
  sttLookup.get(lookupKey).push(recoveredWord);

  // Track splice position for hypIndex adjustment below
  splicePositions.push(insertIdx);
}

// Flag last-ref-word recovery: Reverb's CTC often truncates the final word of an
// utterance. When the last reference word was recovered (Reverb=omission, Parakeet=correct),
// it's a known CTC limitation, not weak evidence. The _isLastRefWord flag suppresses the
// recovery warning badge and adjusts tooltip text in ui.js.
// (Current code: app.js lines 861-868)
const lastRefIdx = alignment.reduce((acc, e, i) => e.ref != null ? i : acc, -1);
if (lastRefIdx >= 0 && alignment[lastRefIdx]._recovered) {
  alignment[lastRefIdx]._isLastRefWord = true;
  // Also flag the transcriptWord so the STT confidence view can see it
  const recHyp = alignment[lastRefIdx].hyp;
  if (recHyp) {
    const recKey = recHyp.toLowerCase().replace(/[^a-z'-]/g, '').replace(/\./g, '');
    const recQueue = sttLookup.get(recKey);
    if (recQueue) recQueue.forEach(w => { w._isLastRefWord = true; });
  }
}

// Fix stale hypIndex values: each splice shifted subsequent indices by 1.
// Stage 6 (absorbMispronunciationFragments) runs after recovery and uses
// transcriptWords[entry.hypIndex] — without this adjustment, spliced-in
// recovery words shift all subsequent indices and hypIndex points to the
// wrong transcriptWord.
if (splicePositions.length > 0) {
  // Sort ascending so displacement counting is correct
  splicePositions.sort((a, b) => a - b);
  for (const entry of alignment) {
    if (entry.hypIndex == null || entry.hypIndex < 0) continue;
    let displacement = 0;
    for (const pos of splicePositions) {
      if (pos <= entry.hypIndex + displacement) displacement++;
      else break;  // sorted, no more relevant positions
    }
    entry.hypIndex += displacement;
  }
}
```

Note: `splicePositions` must be initialized before the recovery loop: `const splicePositions = [];`

This is structurally identical to the current recovery code — same fields, same insertion logic, same sttLookup update. The only difference is where the recovered words come from (reference-index comparison vs. pool search), plus the `hypIndex` adjustment at the end.

---

### Stage 5: Replace fragment pre-merge with reference-aware version

The old fragment pre-merge (app.js:484-578, ~95 lines) depends on `crossValidation` and `_xvalStartTime` to identify and stitch BPE fragments. It is deleted.

**Why not just rely on compound merge?** Compound merge (`mergeCompoundWords()`) handles BPE fragments during alignment — but only if the fragments stay adjacent in the NW alignment output. When a fragment is a common short word (e.g., "i" from "ideation"), NW may align it to a different reference word instead of leaving it as an insertion, scattering the fragments. Compound merge can't recover scattered fragments.

**Replacement:** A reference-aware fragment pre-merge that checks concatenation against reference words. No crossValidation dependency — uses the known reference text as authority. ~25 lines.

```js
// Reference-aware fragment pre-merge (replaces lines 484-578)
// Detects adjacent short words in transcriptWords whose concatenation
// matches a reference word. Merges them into a single token before
// NW alignment, preventing NW from scattering fragments.
//
// IMPORTANT: Uses normalized forms (lowercase + strip non-alpha), NOT getCanonical().
// getCanonical() was abandoned for sttLookup because it causes misses
// ("volume"→"vol", "and"→"&") and false matches. Same reasoning applies here.
{
  const refNormSet = new Set(normalizeText(referenceText).map(w => w.toLowerCase().replace(/[^a-z'-]/g, '')));
  const MAX_FRAG_LEN = 4;       // BPE tokens are short (1-4 chars typically)
  const MAX_GAP_S = 0.3;        // BPE splits are nearly contiguous (<300ms)
  const merged = [];
  let i = 0;

  while (i < transcriptWords.length) {
    const w = transcriptWords[i];
    const wStripped = w.word.replace(/[^a-zA-Z']/g, '');

    if (wStripped.length <= MAX_FRAG_LEN) {
      // Scan forward for adjacent short words
      const group = [i];
      for (let j = i + 1; j < transcriptWords.length; j++) {
        const next = transcriptWords[j];
        const nextStripped = next.word.replace(/[^a-zA-Z']/g, '');
        if (nextStripped.length > MAX_FRAG_LEN) break;

        // Temporal proximity check
        const prevEnd = parseT(transcriptWords[j - 1].endTime);
        const nextStart = parseT(next.startTime);
        if (nextStart - prevEnd > MAX_GAP_S) break;

        group.push(j);
      }

      // Check if any sub-sequence concatenation matches a reference word
      if (group.length >= 2) {
        let matched = false;
        // Try concatenating from the start of the group
        let concat = '';
        for (let k = 0; k < group.length; k++) {
          concat += transcriptWords[group[k]].word;
          const concatNorm = concat.toLowerCase().replace(/[^a-z'-]/g, '');
          if (k > 0 && refNormSet.has(concatNorm)) {
            // Merge group[0..k] into one token
            const parts = group.slice(0, k + 1).map(idx => transcriptWords[idx].word);
            const first = transcriptWords[group[0]];
            const last = transcriptWords[group[k]];
            merged.push({
              ...first,
              word: concat,
              endTime: last.endTime,
              _mergedFragments: parts,
              _mergedFrom: 'pre-alignment-fragment-merge'
            });
            i = group[k] + 1;
            matched = true;
            break;
          }
        }
        if (matched) continue;
      }
    }

    merged.push(w);
    i++;
  }

  transcriptWords.length = 0;
  transcriptWords.push(...merged);
}
```

**Key differences from the old pre-merge:**
- **No crossValidation dependency.** Uses `refNormSet` (normalized reference words) as the authority.
- **No `_xvalStartTime`/`_xvalEndTime` dependency.** Uses Reverb's own timestamps for gap check.
- **Uses normalized forms, NOT `getCanonical()`.** `getCanonical()` was abandoned for `sttLookup` because it causes misses ("volume"→"vol", "and"→"&") and false equivalences. Same reasoning applies here — BPE fragments concatenate to the literal word, so normalized matching (lowercase + strip non-alpha) is both sufficient and more reliable.
- **Stronger guard against false merges.** Only merges when concatenation matches an actual reference word (the old pre-merge used temporal containment with a Parakeet anchor, which could match non-reference words).
- **Simpler.** ~40 lines vs ~95 lines.
- **Known limitation: greedy-first concatenation.** The inner loop breaks on the first ref-word match as it extends the concatenation. If 5 adjacent short words contain two separate ref words (e.g., positions 0-1 form word A, positions 2-4 form word B), the outer `while` loop handles this correctly — after merging 0-1, the next iteration starts at position 2. But if a *shorter* concatenation matches a ref word while a *longer* one is the correct match, greedy-first picks the shorter one. In practice, BPE fragments are 2-3 pieces, so this is theoretical.

---

### Stage 6: Replace absorbStruggleFragments with simplified version

Delete the current `absorbStruggleFragments()` in diagnostics.js (~160 lines) and its call site in app.js (lines 949-955).

**Why the current version is oversized:** The 160-line function exists because engine-to-engine cross-validation creates complex pairing problems — it has to do cross-engine timestamp propagation, build struggle↔fragment pairings using Parakeet windows, and handle cases where the engine-to-engine alignment mispaired fragments. In Plan 5's world, every substitution entry already has Parakeet timestamps from `crossValidateByReference()`, so most of that machinery is unnecessary.

**Why we can't just delete it entirely:** The reference-aware pre-merge (Stage 5) and compound merge only handle BPE fragments that concatenate to a **reference word**. They don't handle fragments of **mispronounced words** — what the student actually said, which doesn't match the reference.

Example:
- Reference: "elephant"
- Student says something garbled like "elefa"
- Reverb BPE splits: "el" + "efa"
- NW alignment: "elephant" → "el" (substitution), "efa" (insertion)
- Reference-aware pre-merge: "el" + "efa" = "elefa" ≠ any reference word → no merge
- Compound merge: "el" + "efa" ≠ "elephant" → no merge
- `resolveNearMissClusters()`: "efa" vs "elephant" — shared prefix is 1 char (< 3 threshold) → no near-miss
- Without absorption: "efa" stays as a standalone insertion, inflating insertion count and cluttering the UI

**Replacement (~30-40 lines):** A simplified temporal containment check that absorbs short insertions near substitutions. No cross-engine timestamp propagation needed — substitutions already have Parakeet timestamps from Stage 3.

```js
/**
 * Absorb BPE fragments of mispronounced words into their parent struggle/substitution.
 * Simplified version: uses temporal containment only. The full cross-engine pairing
 * machinery from the old absorbStruggleFragments() is unnecessary because substitution
 * entries already carry Parakeet timestamps from crossValidateByReference().
 */
function absorbMispronunciationFragments(alignment, transcriptWords) {
  const TOLERANCE_S = 0.15;  // 150ms window margin
  const MAX_FRAG_LEN = 4;   // BPE tokens are short

  // Collect substitutions with their timestamp windows.
  // _xvalStartTime/_xvalEndTime live on alignment entries (set by _setCrossValidation in Stage 3).
  // _reverbStartTime/_reverbEndTime live on transcriptWords (set by Stage 1 in kitchen-sink-merger),
  // NOT on alignment entries — so we must look them up via hypIndex.
  const subs = [];
  for (let i = 0; i < alignment.length; i++) {
    const entry = alignment[i];
    if (entry.type !== 'substitution' && entry.type !== 'struggle') continue;
    // Primary: Parakeet timestamps (on alignment entry, set by Stage 3)
    // Fallback: Reverb timestamps (on transcriptWord, accessed via hypIndex)
    const tw = (entry.hypIndex != null && entry.hypIndex >= 0) ? transcriptWords[entry.hypIndex] : null;
    const startS = parseSttTime(entry._xvalStartTime || tw?._reverbStartTime || tw?.startTime);
    const endS = parseSttTime(entry._xvalEndTime || tw?._reverbEndTime || tw?.endTime);
    if (startS == null || endS == null) continue;
    subs.push({ index: i, entry, startS, endS });
  }

  if (subs.length === 0) return;

  // Check each insertion: if it's a short fragment temporally inside a substitution's window, absorb it
  for (const entry of alignment) {
    if (entry.type !== 'insertion') continue;
    if (entry._partOfStruggle || entry._isSelfCorrection) continue;
    const hyp = entry.hyp || '';
    if (hyp.replace(/[^a-zA-Z]/g, '').length > MAX_FRAG_LEN) continue;

    // Get the insertion's Reverb timestamp via hypIndex (direct array access).
    // No text-based lookup needed — hypIndex is set by alignWords() traceback.
    if (entry.hypIndex == null || entry.hypIndex < 0) continue;
    const tw = transcriptWords[entry.hypIndex];
    if (!tw) continue;
    const fragStartS = parseSttTime(tw._reverbStartTime || tw.startTime);
    if (fragStartS == null) continue;

    // Check temporal containment against any substitution
    for (const sub of subs) {
      if (fragStartS >= sub.startS - TOLERANCE_S && fragStartS <= sub.endS + TOLERANCE_S) {
        entry._partOfStruggle = true;
        break;
      }
    }
  }

}
```

**Key differences from old version:**
- **~30 lines vs ~160 lines** — no cross-engine pairing, no timestamp propagation, no Parakeet window construction
- **No `xvalRawWords` parameter** — substitutions already carry `_xvalStartTime`/`_xvalEndTime` from Stage 3
- **Direct `hypIndex` access** — uses `transcriptWords[entry.hypIndex]` instead of text-based `.find()`. No duplicate-text ambiguity, no consumption ordering bugs. `hypIndex` is set by `alignWords()` traceback (see Stage 2).
- **Same `_partOfStruggle` flag** — downstream code (insertion count, UI filtering) works identically
- **Same temporal containment logic** — if a short insertion's Reverb timestamp falls inside a substitution's timestamp window (±150ms), mark it as part of the struggle

---

### Stage 7: Handle remaining crossValidation field on insertions

Insertion entries (words the student said that aren't in the reference) don't participate in the reference-word comparison. They need a crossValidation status for downstream guards.

After `crossValidateByReference()`, cross-validate insertion entries by matching Reverb insertions against Parakeet insertions, then sweep any remaining as unconfirmed:

```js
// Step 1: Confirm insertions that both engines heard.
// Both alignments produce insertion entries (words not in the reference).
// If both Reverb and Parakeet heard the same extra word, it's confirmed —
// the student really said it (e.g., added "big" in "the big elephant").
if (parakeetAlignment) {
  const parakeetInsertions = parakeetAlignment.filter(e => e.type === 'insertion');
  const pInsNorms = new Map();
  for (const ins of parakeetInsertions) {
    const norm = (ins.hyp || '').toLowerCase().replace(/[^a-z'-]/g, '');
    if (!pInsNorms.has(norm)) pInsNorms.set(norm, []);
    pInsNorms.get(norm).push(ins);
  }

  for (const entry of alignment) {
    if (entry.type !== 'insertion') continue;
    if (entry.crossValidation && entry.crossValidation !== 'pending') continue;
    const norm = (entry.hyp || '').toLowerCase().replace(/[^a-z'-]/g, '');
    const matches = pInsNorms.get(norm);
    if (matches && matches.length > 0) {
      const match = matches.shift();  // consume in order
      // Grab Parakeet timestamps via hypIndex on the matched Parakeet insertion entry
      // (no text-based parakeetLookup needed — consistent with Stage 3's approach)
      const ts = _consumeParakeetTimestamp(match, parakeetWords);
      _setCrossValidation(entry, transcriptWords, 'confirmed', ts);
      // For insertions, raw word is fine (no compound-merge ambiguity)
      if (ts) {
        entry._xvalWord = ts.word;
        if (entry.hypIndex != null && entry.hypIndex >= 0) {
          const tw = transcriptWords[entry.hypIndex];
          if (tw) tw._xvalWord = ts.word;
        }
      }
    }
  }
}

// Step 2: Sweep remaining pending insertions as unconfirmed (Reverb-only).
for (const entry of alignment) {
  if (entry.type !== 'insertion') continue;
  if (!entry.crossValidation || entry.crossValidation === 'pending') {
    entry.crossValidation = 'unconfirmed';
    if (entry.hypIndex != null && entry.hypIndex >= 0) {
      const tw = transcriptWords[entry.hypIndex];
      if (tw) tw.crossValidation = 'unconfirmed';
    }
  }
}

// Step 3: Final sweep — catch any transcriptWords still pending.
for (const w of transcriptWords) {
  if (w.crossValidation === 'pending') {
    w.crossValidation = 'unconfirmed';
  }
}
```

---

### Stage 8: Three-panel STT Transcript view

Expand the existing STT Transcript section to show all three engine transcripts side by side. This is a diagnostic tool — it shows what each engine heard, independent of the scoring pipeline.

**Implementation:** Modify the existing STT Transcript collapsible section in ui.js. Instead of one word list, show three columns:

```
▼ STT Transcript

Parakeet:      The  elephant  sat  on  the  mat
Reverb V=0:    The  ele·phant sat  on  the  mat
Reverb V=1:    um   The  the  the  ele·phant  sat  on  the  mat

Agreement: 6/6 (Parakeet vs V=0 on reference words)
```

**What each row shows:**
- **Parakeet:** Raw Parakeet word sequence. Words colored by Alignment P verdict (green=correct, red=substitution, gray=omission).
- **Reverb V=0:** Raw V=0 word sequence. Words colored by Alignment S verdict. BPE fragments shown with `·` separator when compound-merged.
- **Reverb V=1:** Raw V=1 word sequence. Disfluencies highlighted (fillers in purple, repetitions in orange, false starts in yellow).

**Data source:** All three word lists are already available after Stage 1 (kitchen-sink-merger returns `parakeetRaw`, `reverb.clean`, `reverb.verbatim`). The alignment verdicts come from Alignment P and Alignment S (Stage 2). The disfluency tags come from the existing V=1/V=0 alignment.

**Click-to-play:** Each word is clickable. Parakeet timestamps are used for audio slicing (more accurate than Reverb's 100ms CTC). Words without Parakeet timestamps fall back to Reverb timestamps.

**Scope:** ~80-100 lines in ui.js. This replaces/expands the existing STT Transcript view — not a new section. The existing single-row transcript becomes a three-row comparison.

---

## Edge Cases

### 1. Contraction merge (non-issue)

An earlier draft of this plan assumed `mergeContractions()` collapses ref entries (e.g., "you will" → 1 entry), which would cause ref-entry count desync between the two alignments. This was wrong.

`mergeContractions()` converts `sub(ref="you", hyp="you'll") + omission(ref="will")` into `correct(ref="you") + correct(ref="will")` — two entries in, two entries out. **The ref-entry count is preserved.** Both alignments run the full pipeline (including contraction merge) and always produce the same number of ref entries.

Skipping contraction merge on one alignment would actually **introduce a bug**: if Reverb's contraction merge converts sub+omission into correct+correct for "won't", but Parakeet's raw alignment still shows sub+omission, the zip would produce a false recovery for the omitted component — a word that was never actually omitted.

### 2. Parakeet ITN (Inverse Text Normalization)
Parakeet may output "23" when the reference says "twenty-three". After `normalizeText()`, the reference becomes "twentythree". Parakeet's "23" won't match → substitution in Parakeet alignment. Meanwhile Reverb (CTC-based) likely says "twenty three" → compound merge → correct.

Result: Reverb=correct, Parakeet=substitution → **confirmed** (Row 2 in decision logic: Reverb correct wins). This is the correct outcome — the student read the word correctly.

### 3. Parakeet LM autocorrection
Parakeet may hear "elephant" when the student said "elefant" (LM corrects toward real words). Reverb (CTC, literal) hears "elefant" → substitution.

Result: Reverb=substitution, Parakeet=correct → **disagreed**. This is the correct outcome — the teacher sees a flag that the engines disagree, and the student's actual pronunciation (from Reverb) is preserved as primary.

### 4. BPE fragmentation
Reverb splits "platforms" into "pla" + "forms". The reference-aware fragment pre-merge (Stage 5) checks if "pla"+"forms" matches a reference word via normalized form matching (lowercase + strip non-alpha). If "platforms" is in the reference, the fragments are merged before alignment. If not (shouldn't happen — the fragments came from a reference word), compound merge handles it during alignment: sub("platforms"/"pla") + ins("forms") → correct("platforms").

**Two safety nets:** Reference-aware pre-merge catches fragments before alignment. Compound merge catches any that slip through during alignment. Both use normalized text matching — BPE tokens concatenate exactly to the original word by definition.

### 5. Parakeet service unavailable
All entries get `crossValidation: 'unavailable'`. Same as today. `parakeetAlignment` is null, the early-return path in `crossValidateByReference()` handles it.

### 6. Compound words
Reverb: "every" + "one" → compound merge → "everyone" = correct.
Parakeet: "everyone" → correct.
Both correct → **confirmed**. The compound merge happens independently within each alignment.

---

## Migration Checklist

- [ ] Modify kitchen-sink-merger.js: remove `crossValidateTranscripts()` call, return words with `crossValidation: 'pending'`, expose `parakeetRaw` and `reverb.clean`/`reverb.verbatim` in return
- [ ] Add `hypIndex` field to alignment entries in `alignWords()` traceback (~3 lines in alignment.js)
- [ ] Propagate `hypIndex` through 6 explicit merge sites: `mergeCompoundWords` (2 patterns), `mergeAbbreviationExpansions` (2 patterns), `mergeContractions` (2 patterns × 2 entries each). These functions create new objects with explicit field lists — `hypIndex` must be added to each. See Stage 2 for per-site values.
- [ ] Add Parakeet→Reference alignment call in app.js (full post-processing, same as Reverb)
- [ ] Add `crossValidateByReference()` function in app.js (or new module) — takes `parakeetWords` array, NOT a text-based lookup map
- [ ] Add diagnostic `console.table` logging at end of `crossValidateByReference()`
- [ ] Add `_setCrossValidation()` and `_consumeParakeetTimestamp()` helpers
- [ ] Replace omission recovery loop (pool search → recoveredOmissions from Stage 3)
- [ ] Replace fragment pre-merge with reference-aware version (~40 lines replaces ~95 lines)
- [ ] Replace `absorbStruggleFragments()` (diagnostics.js ~160 lines) with `absorbMispronunciationFragments()` (~35 lines) + update call site (app.js:949-955)
- [ ] Add insertion cross-validation: match Reverb insertions against Parakeet insertions by normalized text (~15 lines)
- [ ] Add insertion sweep for remaining `pending` → `unconfirmed`
- [ ] Delete `crossValidateTranscripts()` from cross-validator.js
- [ ] Remove `crossValidateTranscripts` import from kitchen-sink-merger.js
- [ ] Expand STT Transcript section to three-panel view (~80-100 lines in ui.js)
- [ ] Keep `sendToCrossValidator`, `getCrossValidatorEngine`, `getCrossValidatorName` (still used)
- [ ] Preserve `_isLastRefWord` flag: set on last ref entry + sttLookup word after recovery loop (currently app.js:861-868, moved into Stage 4)
- [ ] Update version timestamp in index.html
- [ ] Bump SW cache version in sw.js
- [ ] Update miscue-registry.js if any miscue types change (likely none)

---

## What This Does NOT Change

This plan is deliberately minimal. It changes **one thing**: how cross-validation compares the two engines. Everything upstream (ASR calls, disfluency detection) and downstream (diagnostics, UI, scoring) is untouched.

If you later want to explore making Parakeet primary (better timestamps, LM word sequence) instead of Reverb, that's a **separate, independent decision** that can be evaluated on its own merits without being tangled into the cross-validation topology fix. The three-panel STT Transcript view and diagnostic logging provide empirical data to inform that decision.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Ref-entry count desync | **Non-issue (guarded)** | Structurally guaranteed by NW (every ref word emitted exactly once) + all merge functions preserving ref-entry count (compound 1→1, abbreviation 1→1, contraction 2→2). If a future merge bug breaks this invariant, `crossValidateByReference()` detects the mismatch and falls back to `'unavailable'` for all words (safe degradation) rather than producing a corrupted zip with confident-but-wrong statuses. |
| BPE fragment scattering (reference words) | **Low** | Reference-aware pre-merge catches fragments before alignment. Compound merge catches rest during alignment. Two safety nets. |
| BPE fragments of mispronounced words | **Low-Medium** | Simplified `absorbMispronunciationFragments()` (~35 lines) replaces the full 160-line version. Same temporal containment logic, same `_partOfStruggle` flag. Simpler because substitutions already carry Parakeet timestamps from Stage 3. Risk: if a mispronunciation fragment falls outside the ±150ms window (e.g., long pause mid-attempt), it won't be absorbed — same limitation as the current version. |
| Parakeet ITN false substitution | None | Reverb=correct wins in decision logic. Same outcome as today. |
| Self-correction detection regression | None | Self-correction uses `crossValidation === 'unconfirmed'` which is still set the same way. |
| Struggle detection regression | None | Path 3 uses `crossValidation === 'unconfirmed'`, still works. Path 1/2 don't use crossValidation. |
| Word speed map regression | None | Falls back to Reverb timestamps if Parakeet unavailable (existing logic). |
| Omission recovery regression | Low | Reference-anchored recovery is strictly more reliable than pool search (positional, not text-only). |
| Insertion cross-validation loss | **Eliminated** | Stage 7 now cross-validates insertions by matching Reverb insertions against Parakeet insertions (normalized text match). Insertions both engines heard get `'confirmed'` with Parakeet timestamps. Only truly Reverb-only insertions become `'unconfirmed'` — same discrimination as the current engine-to-engine approach. |
| Contraction sttLookup queue exhaustion | **Non-issue** | No contraction expansion needed (mergeContractions preserves ref-entry count). Each ref entry has its own `hypIndex`. No queue consumption. |
| Text-based transcriptWord lookup bugs | **Eliminated** | `hypIndex` on every alignment entry (set by `alignWords()` traceback, propagated through 6 explicit merge sites) replaces all text-based `.find()` and sttLookup queue consumption for cross-validation and fragment absorption. Merge functions create new objects with explicit field lists (NOT spread), so `hypIndex` must be listed at each site — see Stage 2 for per-site values. |
| hypIndex staleness after omission recovery | **Eliminated** | `transcriptWords.splice()` during recovery shifts subsequent indices. Fixed by tracking splice positions and adjusting all `hypIndex` values after recovery completes (~10 lines). Stage 3 (`_setCrossValidation`) runs before recovery so is unaffected. Stage 6 (`absorbMispronunciationFragments`) runs after recovery and benefits from the adjustment. |

**Net risk**: Low. The change surface is small (~440 lines deleted, ~220 lines added), the field names and values are identical, and downstream code doesn't know the difference. The three-panel view and diagnostic logging provide immediate visibility into the new cross-validation behavior.
