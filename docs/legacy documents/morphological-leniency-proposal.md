# Morphological Leniency: Implementation Proposal

> **UPDATE**: Instead of the narrow morphological-only fix described below, a broader
> "Trust Pk" toggle was implemented (Phase 7b in app.js). When enabled, ALL disagreed
> substitutions where Parakeet heard the correct word are forgiven — not just morphological
> near-misses. This document remains as the research backing for that decision.

## Problem Statement

Reverb's CTC decoder (WeNet) systematically drops inflectional suffixes (-ed, -s, -ing) from words. Single-BPE-token words always get exactly 100ms duration (`g_time_stamp_gap_ms = 100` in ctc_align.py). The suffix token is never decoded — this is a recognition failure, not a timestamp issue.

When CTC outputs "wound" for reference "wounded", and Parakeet (RNNT) outputs "wounded", we cannot reliably distinguish:
- **CTC artifact**: child said "wounded" correctly, CTC dropped the suffix
- **Genuine error**: child said "wound", Parakeet's implicit LM hallucinated the suffix

## Proposal: Give Credit When Parakeet Confirms

When V1 outputs a morphological stem of the reference AND Parakeet independently heard the full reference word — count it as correct. Set `entry.forgiven = true` following the established proper noun forgiveness pattern.

**Rationale**: CTC suffix-dropping is a documented, systematic artifact. Parakeet's RNNT architecture, while it has implicit LM bias, must still attend to acoustic evidence via cross-attention to the encoder. When Parakeet confirms the reference word on a morphological near-miss, the balance of evidence favors the child having spoken the full form.

**Risk acknowledged**: Parakeet's implicit LM can hallucinate suffixes on common inflected forms. This feature will occasionally give credit when the child genuinely dropped a suffix. We accept this tradeoff because CTC suffix-dropping is far more frequent than RNNT suffix-hallucination, and overcounting errors is worse for assessment validity than undercounting them by 1-2 words per passage.

## Evidence from Debug Log

Analysis of `orf-debug-2026-02-17T01-41-19.json` (129 ref words, 15 errors, 88.4% accuracy):

| # | Ref | V1 Hyp | V0 | Pk | Status | Action |
|---|-----|--------|----|----|--------|--------|
| 52 | wounded | wound | wound | wounded | disagreed | **FORGIVE** (Pk confirms ref) |
| 128 | faced | face | face | faced | disagreed | **FORGIVE** (Pk confirms ref) |
| 1 | memories | memory | memory | memory | confirmed | **KEEP AS ERROR** (all engines agree on stem) |
| 64 | thousands | thousand | (omit) | thousands | disagreed | Already forgiven (proper noun) |
| 141 | american | america | america | america | confirmed | Already forgiven (proper noun) |

**Impact**: 2 errors removed. Accuracy: 88.4% → 89.9% (+1.5pp). WCPM: ~+2.

The critical guard: `memories → memory` stays an error because ALL engines agree the child said "memory". Parakeet does NOT confirm the reference. Only when Pk **disagrees** with V1 and confirms the full form does leniency apply.

## Departure from ORF Standards

Standard ORF scoring (DIBELS, AIMSweb, NAEP) counts dropped suffixes as errors. This feature is a **deliberate departure** justified by:

1. PACER is a struggle detector, not a strict WCPM counter
2. The "error" is an ASR artifact, not a student behavior
3. Standard ORF administered by humans wouldn't have this problem — the human would hear "wounded"
4. The downstream AI benefits from knowing the child decoded the root correctly

The accuracy score will include a `morphLeniencyCount` so the departure is transparent.

## Guard Conditions

ALL must be true to forgive:

### Guard 1: Parakeet confirms the reference word
- `entry._pkType === 'correct'` (Parakeet heard the exact reference word)
- If Parakeet unavailable (`_pkType` undefined): do NOT forgive
- This is the primary gate. Without Pk confirmation, we have no evidence the suffix was spoken.

### Guard 2: V1's output is a validated morphological stem of the reference
- Reference must end with a whitelisted inflectional suffix
- After stripping the suffix from ref (with morphological normalization), the result must equal hyp
- Suffix whitelist: `ed`, `d`, `s`, `es`, `ing`, `er`, `est`, `ly`
- Morphological normalization handles:
  - **Consonant doubling**: "running" → strip "ing" → "runn" → also try "run"
  - **Silent-e restoration**: "making" → strip "ing" → "mak" → also try "make"
  - **Y-to-I reversal**: "tried" → strip "ed" → "tri" → also try "try"
  - **Simple concatenation**: "walked" → strip "ed" → "walk" (direct match)

### Guard 3: Minimum stem length ≥ 3 characters
- `hyp.length >= 3`
- Prevents false matches on short function words: "he"→"her", "do"→"doing", "an"→"another"
- 3 characters provides meaningful phonetic content for stem recognition

### Guard 4: Not a known heteronym
- Blocklist of words where the stem form is a different word:
  - `wound` (injury vs past-of-wind), `read`, `lead`, `bow`, `close`, `live`, `tear`, `wind`, `minute`, `bass`, `desert`, `content`, `present`, `object`, `produce`, `refuse`
- When hyp is on this list, skip forgiveness (stem could be a completely different word)
- **Note**: This is conservative. "wound"/"wounded" would NOT be forgiven by this feature due to the heteronym block. It would still be rescued by post-struggle leniency if the previous word was an error, or by the existing dual-gate (`_pkType === 'correct' && _v0Type === 'correct'`).
- The heteronym list can be relaxed later with empirical data showing false positive rate is low.

### Guard 5: Not already forgiven
- `!entry.forgiven` (avoid double-counting)

### Guard 6: Entry is a substitution with disagreed status
- `entry.type === 'substitution'`
- `entry.crossValidation === 'disagreed'`
- Confirmed substitutions (all engines agree) are genuine errors, not CTC artifacts

## Stem Validation Function

```javascript
const INFLECTIONAL_SUFFIXES = ['ing', 'ed', 'es', 'er', 'est', 'ly', 's', 'd'];

// Ordered longest-first so "ing" matches before "g", "ed" before "d", "es" before "s"
const SUFFIXES_BY_LENGTH = [...INFLECTIONAL_SUFFIXES].sort((a, b) => b.length - a.length);

const HETERONYM_BLOCKLIST = new Set([
  'wound', 'read', 'lead', 'bow', 'close', 'live', 'tear', 'wind',
  'minute', 'bass', 'desert', 'content', 'present', 'object', 'produce', 'refuse'
]);

/**
 * Check if `hyp` is a morphological stem of `ref`.
 * Returns { isStem: true, suffix, stem } or { isStem: false }.
 */
function checkMorphologicalStem(hyp, ref) {
  const hypN = hyp.toLowerCase();
  const refN = ref.toLowerCase();

  if (hypN === refN) return { isStem: false }; // same word, not a stem
  if (hypN.length < 3) return { isStem: false }; // Guard 3
  if (HETERONYM_BLOCKLIST.has(hypN)) return { isStem: false }; // Guard 4

  for (const suffix of SUFFIXES_BY_LENGTH) {
    if (!refN.endsWith(suffix)) continue;

    const stripped = refN.slice(0, -suffix.length);

    // Direct match: "walked" - "ed" = "walk" === hyp "walk"
    if (stripped === hypN) return { isStem: true, suffix, stem: hypN };

    // Consonant doubling: "running" - "ing" = "runn", try "run"
    if (stripped.length >= 2 && stripped[stripped.length - 1] === stripped[stripped.length - 2]) {
      if (stripped.slice(0, -1) === hypN) return { isStem: true, suffix, stem: hypN };
    }

    // Silent-e restoration: "hoping" - "ing" = "hop", try "hope"
    if (stripped + 'e' === hypN) return { isStem: true, suffix, stem: hypN };

    // Y-to-I: "happily" - "ly" = "happi", try "happy"
    if (stripped.endsWith('i') && stripped.slice(0, -1) + 'y' === hypN) {
      return { isStem: true, suffix, stem: hypN };
    }

    // IE-to-Y: "dying" - "ing" = "dy", try "die"
    if (suffix === 'ing' && stripped + 'ie' === hypN) {
      return { isStem: true, suffix, stem: hypN };
    }
  }

  return { isStem: false };
}
```

## Implementation Plan

### Files to modify

1. **`js/alignment.js`** — Add `checkMorphologicalStem()` as an exported utility
2. **`js/app.js`** — Add morphological leniency block after proper noun forgiveness
3. **`js/miscue-registry.js`** — Add `morphologicalLeniency` entry
4. **`js/ui.js`** — Add tooltip text for morphological leniency
5. **`js/metrics.js`** — Add `morphLeniencyCount` to return value (no scoring change needed — `w.forgiven` already handled)
6. **`index.html`** — Update version timestamp

### Pipeline placement

```
... → 3-way verdict → disfluency classification → proper noun forgiveness
    → OOV phonetic forgiveness → function word forgiveness
    → *** MORPHOLOGICAL LENIENCY (new) ***
    → post-struggle leniency → diagnostics → computeAccuracy
```

After proper noun / OOV forgiveness (so we don't double-forgive), before post-struggle leniency (so morphological leniency doesn't consume the leniency window), before `computeAccuracy()` (so forgiven words count as correct).

### app.js forgiveness block (pseudocode)

```javascript
// ── Morphological leniency ────────────────────────────────────────
// When CTC outputs a morphological stem of the reference word
// (e.g., "wound" for "wounded") and Parakeet confirms the full form,
// forgive the substitution — the CTC decoder dropped the suffix,
// not the child.
{
  const morphLeniencyLog = [];
  for (const entry of alignment) {
    if (!entry.ref || entry.type !== 'substitution') continue;
    if (entry.forgiven) continue;                    // Guard 5
    if (entry.crossValidation !== 'disagreed') continue; // Guard 6
    if (entry._pkType !== 'correct') continue;       // Guard 1

    const result = checkMorphologicalStem(entry.hyp, entry.ref);
    if (!result.isStem) continue;                    // Guard 2, 3, 4

    entry.forgiven = true;
    entry._morphLeniency = true;
    entry._morphStem = result.stem;
    entry._morphSuffix = result.suffix;

    morphLeniencyLog.push({
      ref: entry.ref, hyp: entry.hyp,
      suffix: result.suffix, pkWord: entry._xvalWord
    });
  }

  addStage('morphological_leniency', {
    candidates: morphLeniencyLog.length,
    forgiven: morphLeniencyLog.filter(l => true).length,
    details: morphLeniencyLog
  });
}
```

### Flags set on alignment entries

| Flag | Type | Purpose |
|------|------|---------|
| `entry.forgiven` | boolean | Gate for metrics.js (existing pattern) |
| `entry._morphLeniency` | boolean | Discriminator for UI tooltip |
| `entry._morphStem` | string | The stem that V1 heard |
| `entry._morphSuffix` | string | The suffix that was dropped |

### UI tooltip addition (ui.js)

After the existing proper noun tooltip block:

```javascript
if (entry.forgiven && entry._morphLeniency) {
  tip.push(`Morphological leniency: "${entry._morphStem}" + "-${entry._morphSuffix}" → CTC dropped suffix, Parakeet confirmed`);
}
```

### Miscue registry entry

```javascript
morphologicalLeniency: {
  description: 'CTC decoder dropped an inflectional suffix but Parakeet confirmed the full form',
  detector: 'app.js → morphological leniency block',
  countsAsError: false,
  config: {
    suffixes: ['ing', 'ed', 'es', 'er', 'est', 'ly', 's', 'd'],
    min_stem_length: 3,
    requires_pk_correct: true,
    requires_disagreed: true,
    heteronym_blocklist: true,
  },
  example: {
    reference: 'wounded',
    spoken: 'wound (V1) / wounded (Pk)',
    result: 'CTC dropped "-ed", Parakeet confirmed full form → forgiven'
  },
  guards: [
    'Parakeet must hear the exact reference word (_pkType === correct)',
    'V1 hyp must be a validated morphological stem of ref',
    'Stem must be ≥ 3 characters',
    'Hyp must not be a known heteronym (wound, read, lead, etc.)',
    'Entry must be disagreed (not confirmed — confirmed means all engines agree)',
    'Not already forgiven by another mechanism',
  ],
  uiClass: 'word-forgiven',
}
```

### metrics.js addition

Add `morphLeniencyCount` to the return value:

```javascript
const morphLeniencyCount = alignmentResult.filter(w => w._morphLeniency).length;
// ... existing return
return { accuracy, correctCount, totalRefWords, totalErrors, wordErrors, omissions,
         insertionErrors, forgiven, longPauseErrors, morphLeniencyCount };
```

## What This Does NOT Cover

1. **All-engines-agree cases** (memories → memory): These are genuine student errors. If V1, V0, and Pk all hear the stem, the child said the stem. No leniency.

2. **Heteronym cases** (wound for wounded): Blocked by the heteronym blocklist. These could be different words entirely. Conservative by design — can relax later with data.

3. **Parakeet-unavailable cases**: No Pk = no evidence = no leniency. The feature explicitly requires multi-engine consensus.

4. **Derivational suffixes** (-tion, -ment, -ness, -ful, -less, -able): These change word class and meaning fundamentally. "act" for "action" is a different word, not a suffix drop. Only inflectional suffixes that preserve meaning are whitelisted.

5. **Reverse direction** (child says "wounded" but ref is "wound"): Not covered. The child adding a suffix the reference doesn't have is a different problem (insertion/substitution).

## Expected Impact

Based on the debug log analysis:
- **Per passage**: 0-3 words rescued (morphological disagreements with Pk confirmation)
- **Accuracy improvement**: +1-2 percentage points per passage with suffix truncation
- **False forgiveness risk**: Low for disagreed entries (Pk must independently confirm). Unknown for Pk hallucination rate on suffixes — no published data exists.
- **Net effect**: More accurate than current scoring for CTC-artifact cases; slightly lenient for rare Pk-hallucination cases. Net positive for assessment validity.

## Open Questions

1. **Should the heteronym blocklist include "wound"?** The debug log shows "wound"/"wounded" as the most common case. Blocking it is safe but reduces impact. Could add a context heuristic (if ref is "wounded" the adjective, not "wound" the noun) using NL API POS tags.

2. **Should V0 confirmation be required?** Currently only Pk is required. Adding V0 as a second gate (`_v0Type === 'correct'`) would be more conservative but would block most cases (V0 is the same CTC model as V1 and usually agrees with V1 on suffix drops).

3. **Should this be a toggle?** A localStorage setting (`orf_morphological_leniency`) would let users compare scores with and without the feature.

4. **Should "struggle" entries also be eligible?** Currently only substitutions. Compound struggle words with morphological stems could also benefit, but the interaction with struggle reclassification is complex.
