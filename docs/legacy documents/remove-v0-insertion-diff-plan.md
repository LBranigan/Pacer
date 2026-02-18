# Plan: Remove V1/V0 Insertion Diff for Disfluency Classification

## Problem

The pipeline currently compares V1 (verbatim) insertions against V0 (clean) insertions to classify disfluencies. This was built before Plan 6 (3-engine reference alignment) and the near-miss/self-correction system existed. It's now redundant:

1. **Fillers** ("uh", "um"): Already caught by the `FILLER_WORDS` set — no V0 comparison needed.
2. **False starts** ("ca-" before "cat"): Already caught by `resolveNearMissClusters()` and self-correction detection in diagnostics.js — these systems use character-level similarity, which is more robust than V0 suppression guessing.
3. **V0 "suppression" is unreliable**: V0 is the same wenet engine with slightly different output settings. Differences between V1 and V0 insertions are as likely to be BPE/alignment noise as genuine disfluency signal.

The V0 insertion diff adds complexity, a redundant classification path (`disfluencyType: 'false_start'`), and a confusing mental model ("why are we comparing V1 to V0 when we have 3-way reference comparison?").

## What V0 Is Still Good For

V0 is NOT being removed from the pipeline. It remains valuable for:
- **3-way ref-word verdicts**: `_v0Word` / `_v0Type` on alignment entries feed the 3-way comparison and `struggle-correct` bucket classification (`_v0Type === 'substitution'`)
- **Disfluency detection via insertion presence**: V1 insertion present + V0 absent → the word was likely not real speech content. But this is now redundant with `FILLER_WORDS` + near-miss system.

Only the **V0 insertion norm comparison** for disfluency classification is removed.

## Changes

### 1. `js/app.js` — Simplify disfluency classification block (~line 930)

**Before** (current):
```js
const FILLER_WORDS = new Set(['um', 'uh', 'uh-huh', 'mm', 'hmm', 'er', 'ah']);
{
  const v1Insertions = alignment.filter(e => e.type === 'insertion');
  const v0InsertionNorms = new Set();
  if (v0Alignment) {
    for (const e of v0Alignment) {
      if (e.type === 'insertion' && e.hyp) {
        v0InsertionNorms.add(e.hyp.toLowerCase().replace(/[^a-z'-]/g, ''));
      }
    }
  }
  for (const ins of v1Insertions) {
    if (!ins.hyp) continue;
    const norm = ins.hyp.toLowerCase().replace(/[^a-z'-]/g, '');
    const tw = ins.hypIndex >= 0 ? transcriptWords[ins.hypIndex] : null;
    if (FILLER_WORDS.has(norm)) {
      if (tw) { tw.isDisfluency = true; tw.disfluencyType = 'filler'; }
    } else if (v0Alignment && !v0InsertionNorms.has(norm)) {
      if (tw) { tw.isDisfluency = true; tw.disfluencyType = 'false_start'; }
    }
  }
}
```

**After** (simplified):
```js
const FILLER_WORDS = new Set(['um', 'uh', 'uh-huh', 'mm', 'hmm', 'er', 'ah']);
{
  const v1Insertions = alignment.filter(e => e.type === 'insertion');
  for (const ins of v1Insertions) {
    if (!ins.hyp) continue;
    const norm = ins.hyp.toLowerCase().replace(/[^a-z'-]/g, '');
    if (FILLER_WORDS.has(norm)) {
      const tw = ins.hypIndex >= 0 ? transcriptWords[ins.hypIndex] : null;
      if (tw) { tw.isDisfluency = true; tw.disfluencyType = 'filler'; }
    }
  }
}
```

What's removed:
- `v0InsertionNorms` set construction (reading V0 alignment insertions)
- `else if (v0Alignment && !v0InsertionNorms.has(norm))` branch (false_start tagging)
- `disfluencyType: 'false_start'` no longer exists as a classification

What stays:
- `FILLER_WORDS` check → `isDisfluency: true, disfluencyType: 'filler'`
- The pre-filtered disfluency tagger block (lines 955-970) — safety net for re-injected fillers

### 2. `js/app.js` — Remove `_groupInsertions` for V0 (~line 750)

The `_groupInsertions()` helper groups insertion entries by ref position. It's called for V0 and Parakeet to build `v0InsGroups` and `pkInsGroups`. Check if `v0InsGroups` is used anywhere besides the disfluency diff. If it's only used for V0 insertion comparison, the V0 call can be removed (keep the Parakeet call if used).

### 3. `js/miscue-registry.js` — Remove `reverb_false_start` entry

The `reverb_false_start` miscue type no longer exists. Remove the entry from `REVERB_DISFLUENCY_MISCUES`. Update `reverb_filler` note to reflect the simplified single detection path.

### 4. `js/ui.js` — Remove false_start references

**Line ~944**: The tooltip code that separates `fillers` from `nonFillers` can be simplified — without `false_start`, all `isDisfluency` insertions are fillers. But non-disfluency insertions (like self-corrections, struggle fragments) still exist and use different labels, so the filler/non-filler split is still useful. Just update the `nonFillers` label from "False start" to something more accurate like "Attempted" or keep as-is since the near-miss system tags those with `_isSelfCorrection` / `_partOfStruggle`.

**Line ~2298**: Pipeline verdict column shows `tw.disfluencyType || 'disfluency'`. Since `false_start` no longer exists, this will only ever show `'filler'`. No code change needed, just natural simplification.

### 5. `js/ui.js` — Legacy rendering disfluency check (line ~1586)

```js
const hasDisfluency = sttWord?.severity && sttWord.severity !== 'none' && !('isDisfluency' in (sttWord || {}));
```

This checks `isDisfluency` existence to differentiate Kitchen Sink disfluencies from older severity-based ones. Still valid — `isDisfluency` still exists for fillers.

### 6. `js/diagnostics.js` — No changes needed

All three consumption sites check `isDisfluency` (boolean), not `disfluencyType`. They work identically whether the disfluency is a filler or false_start. Fillers are the only remaining disfluency type, so these continue to work.

### 7. `js/alignment.js` — Update re-injection comment

The comment on the re-injection block references "V1/V0 disfluency classifier in app.js". Update to just "filler classifier in app.js" since V0 comparison is removed.

## Files Modified

| File | Change |
|------|--------|
| `js/app.js` | Remove V0 insertion norm comparison, simplify to FILLER_WORDS only |
| `js/alignment.js` | Update comment on re-injection block |
| `js/miscue-registry.js` | Remove `reverb_false_start`, update `reverb_filler` note |
| `js/ui.js` | Update tooltip label (minor) |
| `index.html` | Version bump |

## What Does NOT Change

- `v0Alignment` creation — still needed for 3-way ref-word verdicts
- `_v0Word` / `_v0Type` on alignment entries — still used by struggle-correct classification
- `DISFLUENCIES` set in text-normalize.js — still used for pre-filtering before NW alignment
- `FILLER_WORDS` set — still the source of truth for filler detection
- Pre-filtered disfluency re-injection in alignment.js — still needed for UI visibility
- All `isDisfluency` consumers in diagnostics.js and ui.js — still work (fillers only now)

## What Gets Removed

- `v0InsertionNorms` set construction in app.js
- `disfluencyType: 'false_start'` as a concept
- `reverb_false_start` miscue registry entry
- The mental model of "V1/V0 insertion comparison" for disfluency detection

## Impact

- **False starts** that were previously tagged `isDisfluency: true, disfluencyType: 'false_start'` will now be regular insertions. But most of these are ALREADY caught by the near-miss system as `_isSelfCorrection` or `_partOfStruggle`, which are excluded from counts and rendered with appropriate labels.
- **Edge case**: A non-near-miss false start (e.g., student starts saying "the" then says "cat" for ref "cat") would previously be tagged `false_start` via V0 suppression. After this change, "the" would be a regular insertion. This is acceptable — V0's detection of this was unreliable anyway, and a single extra insertion doesn't count as an error per ORF standards.
- **Net effect**: Simpler code, clearer mental model, same accuracy for the cases that matter.
