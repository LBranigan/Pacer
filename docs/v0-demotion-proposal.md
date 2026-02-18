# V0 Demotion: From Scoring Engine to Display-Only

## Problem Statement

PACER's pipeline runs Reverb in two passes — V1 (verbatim) and V0 (clean) — plus Parakeet as a cross-validator. The architecture was designed as a "3-engine consensus" system where V0 would serve two purposes:

1. **Third voting engine** for word-level accuracy
2. **Disfluency detector** by comparing V1 insertions to V0's suppressed output

Analysis of 7 IRR log files (884 reference words, 2 students, 5+ passages with Trust Pk enabled) reveals that V0 fulfills neither role effectively:

- **V0 echoes V1 91.3%** of the time on reference words (same architecture = same mistakes)
- **V0 uniquely rescued 1 word with scoring impact** out of 884 (0.1%)
- **V0 was wrong when V1 was correct 42 times** (4.8%) — a 42:1 noise-to-signal ratio
- **V0 disfluency discrimination on insertions: 0 out of 65** — V0 data is absent from all insertion entries, providing zero discriminative power for filler/false-start classification
- When V0 disagrees with V1, it is **further from the reference 62% of the time**

Meanwhile, Parakeet uniquely rescued **46 words** that both V1 and V0 missed — 46x more valuable than V0. The real architecture is **V1 + Parakeet**, not V1 + V0 + Parakeet.

V0 costs a second wenet CTC decode per assessment on the Reverb server, adds ~30 code touchpoints across app.js/ui.js/metrics.js, and creates the misleading impression of 3-engine consensus when the effective ensemble size is ~2.03 (documented in `docs/legacy documents/fix-v0-voting-and-inflection-awareness-plan.md`).

## Evidence

### Scoring Impact Across All IRR Logs

| Metric | Count | % of 884 words |
|--------|-------|----------------|
| V0 matches V1 exactly | 807 | 91.3% |
| V0 correct, V1 wrong | 8 | 0.9% |
| — Pk also correct (V0 redundant) | 6 | 0.7% |
| — Pk wrong (V0 uniquely correct) | 2 | 0.2% |
| — Already forgiven (no scoring impact) | 1 | 0.1% |
| **V0 unique with scoring impact** | **1** | **0.1%** |
| V0 wrong, V1 correct | 42 | 4.8% |
| Pk rescued when both V1+V0 wrong | 46 | 5.2% |

### V0 Disagreement Direction (when V0 ≠ V1)

| Direction | Count | % of 76 disagreements |
|-----------|-------|-----------------------|
| V0 closer to reference | 17 | 22% |
| V0 further from reference | 47 | 62% |
| Same distance | 12 | 16% |

### Insertion/Disfluency Analysis

| Metric | V1 | V0 | Pk |
|--------|----|----|-----|
| Total insertions across all logs | 65 | 37 | — |
| `_v0Word`/`_v0Type` present on insertions | — | **0 of 65** | — |
| Disfluency discrimination from V0 | — | **none** | — |

V0 suppresses insertions at the alignment level (37 vs V1's 65), confirming the clean pass is more aggressive. But this suppression is never mapped back to per-insertion disfluency classification. Filler detection is keyword-based on V1 alone (`FILLER_WORDS` set at app.js:1078). Self-correction detection is structural pattern matching on V1 alone (app.js:2562-2622). Neither uses V0.

### The "Woodened" Pattern

V0's disagreements often introduce non-words: "woodened" for "wooden", "killeded" for "killed", "patientpatients" for "patients". These are CTC decoder artifacts from the clean pass — extra tokens emitted during beam search — not genuine phonetic captures. V1 and Pk agree on the correct form in these cases.

## Current V0 Code Touchpoints

### Scoring (metrics.js)

```
Line 18:  w._v0Type === 'correct'  →  counts word as correct in WCPM
Line 50:  w._v0Type === 'correct'  →  counts substitution as correct in accuracy
Line 107: w._v0Type === 'correct'  →  counts word as correct in WCPM range
```

**Impact of removal**: 1 word per 884 might change score. With Trust Pk on, `w.forgiven` already covers the 6 of 8 cases where V0 was correct and Pk was too.

### 3-Way Verdict (app.js:924-1038)

```
Line 994:  Confirmed omission check includes V0
Line 998:  V0 can trigger omission recovery (but Pk is checked first)
Line 1003: correctCount includes V0 for majority voting
Line 1008: V0 correct confirms V1 compound match
Line 1013: hasV0 affects unconfirmed vs unavailable status
Line 1020: V0-only correct → disagreed (fires 2 times per 884 words)
Line 1031: V0 agreeing with V1's wrong answer → confirmed sub
```

**Impact of removal**: The verdict simplifies to V1 vs Pk. The code already handles `hasV0 = false` gracefully — V0 absence is a supported code path (line 910-913 checks and warns).

### Confirmed Insertions (app.js:1178-1186)

```
Line 1181: enginesAvailable counts V0
Line 1182: enginesHeard counts V0
Line 1183: All-engines-heard gate includes V0
```

**Impact of removal**: Confirmed insertions require V1 + Pk (2 engines). Currently requires V1 + V0 + Pk when all three are available. Removing V0 makes confirmed insertions easier to trigger (2 engines instead of 3). This is a minor loosening — could increase confirmed insertion count slightly.

### Word Classification (ui.js:490-536)

```
Line 494:  V0 sub on correct → 'struggle-correct' (light green)
Line 508:  V0 correct on struggle → 'attempted-struggled'
Line 518:  V0 correct on sub → 'struggle-correct'
Line 525:  V0 near-miss → 'definite-struggle'
Line 533:  V0 ≠ V1 → 'definite-struggle' (vs 'confirmed-substitution')
```

**Impact of removal**: Some words lose the "struggle" texture. Line 533-535 is the most meaningful — when V0 and V1 hear different wrong words, it escalates to "definite-struggle." But Pk on the same line (`pk && pk !== v1`) provides the same escalation independently. From the data, V0's escalation is noise 62% of the time.

### OOV Forgiveness (app.js:2031-2032)

```
Line 2031: V0 attempt included in phonetic hearings
Line 2032: V0 word included in phonetic hearings
```

**Impact of removal**: OOV phonetic matching uses one fewer hearing. Pk still provides its hearing. Minimal impact.

### Self-Correction Detection (app.js:2518, 2578)

```
Line 2518: V0 word included in engine list for self-correction evidence
Line 2578: V0 correct → entry is "correctish" for self-correction gate
```

**Impact of removal**: Self-correction detection loses V0 path. `entry.forgiven` (from Trust Pk) already covers the correctish gate. Minimal impact.

### Display (ui.js:873-906, 1704-1877, 2040-2050)

```
Lines 873-906:   Tooltip shows V0 word/attempt
Lines 1704-1877: 6-column alignment table (Step 1) shows V0 column
Lines 2040-2050: Step 2 alignment view shows V0 table
```

**Impact of removal**: The 6-column table becomes 5 columns. Tooltips lose V0 data. This is the main user-visible change.

## Proposal: Two Options

### Option A: Demote V0 to Display-Only (Recommended)

Keep running V0 on the Reverb server. Keep the 6-column table. But remove V0 from all scoring and classification paths:

1. **metrics.js**: Remove `_v0Type === 'correct'` from accuracy/WCPM calculations
2. **app.js 3-way verdict**: Simplify to V1 vs Pk. Remove V0 from `correctCount`, omission majority, confirmed substitution checks. Keep `_v0Word`/`_v0Type` as display-only metadata.
3. **ui.js classifyWord**: Remove V0 conditions from classification logic. Use only V1 + Pk for word coloring.
4. **app.js confirmed insertions**: Remove V0 from engine count. Require V1 + Pk only.
5. **app.js OOV/self-correction**: Remove V0 hearings from these paths.
6. **Keep**: V0 alignment stored on `data._threeWay.v0Ref`, `_v0Word`/`_v0Type` on entries, 6-column table rendering, tooltip V0 display.

**Benefit**: Scoring and classification become honest 2-engine (V1 + Pk). The 6-column table remains as a diagnostic/debugging tool. Teachers and developers can still see what V0 heard without it affecting the score.

**Risk**: Minimal. The 1 word per 884 that V0 uniquely rescued would be lost from scoring. The `_v0Type === 'correct'` scoring path in metrics.js (which operates independently of Trust Pk) would be removed — but Trust Pk already covers 6 of 8 V0-correct cases, and the remaining 2 are negligible.

**Effort**: ~2-3 hours. Remove V0 from ~15 scoring/classification lines across 3 files. Keep ~15 display lines untouched.

### Option B: Remove V0 Entirely

Stop running the V0 decode pass on the Reverb server. Remove all V0 code from the pipeline.

1. **Reverb server**: Remove the clean-pass decode (saves ~30-50% of Reverb server time per assessment)
2. **app.js**: Remove V0 alignment, V0 spillover, all V0 references
3. **ui.js**: Remove V0 column from 6-column table (becomes 5-column: # / Ref / V1 / Pk / Verdict). Remove V0 from tooltips.
4. **metrics.js**: Remove V0 scoring paths.

**Benefit**: Simpler code, faster pipeline, honest architecture. Removes ~50 lines of V0-specific code across 3 files plus server-side changes.

**Risk**: Lose the 6-column diagnostic view. During development and debugging, seeing what V0 heard (even if noisy) provides a "second CTC opinion" for understanding alignment issues. Once the architecture is mature, this is less valuable.

**Effort**: ~4-6 hours. Server changes + client-side code removal + UI table restructure.

## Recommendation

**Option A (display-only demotion)** is recommended because:

1. The diagnostic value of seeing V0 in the table is nonzero for development, even though V0's scoring contribution is near-zero
2. The code changes are smaller and lower-risk
3. It honestly separates "what V0 heard" (display) from "what V0 decides" (scoring)
4. The Reverb server compute cost is low (V0 runs on the same model already loaded for V1)
5. It's easily reversible — if future data shows V0 has more value than current evidence suggests, re-enabling is trivial

## Implementation Plan

### Files to Modify

1. **`js/metrics.js`** — Remove `_v0Type === 'correct'` from `computeWCPM()` (line 18), `computeAccuracy()` (line 50), and `computeWCPMRange()` (line 107)

2. **`js/app.js`** — 3-way verdict simplification:
   - Line 990: Remove V0 from `omitCount`
   - Line 994: Remove V0 from confirmed omission gate (just V1 + Pk)
   - Line 998: Remove V0 recovery path (Pk-only recovery)
   - Line 1003: Remove V0 from `correctCount`
   - Line 1008: Remove V0 from compound confirmation
   - Line 1013/1016/1037: Replace `hasPk || hasV0` with `hasPk`
   - Line 1020-1022: Remove V0-only correct path entirely
   - Line 1031: Remove V0 from confirmed substitution check
   - Line 1181-1182: Remove V0 from confirmed insertion engine count
   - Line 1131: Remove V0 from insertion cross-validation (keep Pk only)
   - **Keep**: Lines 936-937 (`_v0Word`/`_v0Type` assignment), line 964-969 (`_v0Attempt`), line 1058 (`_threeWay.v0Ref`), line 2878 (`v0Alignment` on return data)

3. **`js/ui.js`** — classifyWord simplification:
   - Line 494: Remove `_v0Type === 'substitution'` struggle-correct path
   - Line 498: Remove `_v0Compound` struggle-correct path
   - Line 508: Remove `norm(entry._v0Word) === refN` from attempted-struggled check
   - Line 516-518: Remove V0 correct → struggle-correct path
   - Line 525: Remove `entry._v0Word && isNearMiss(...)` from near-miss check
   - Line 533-535: Remove V0 from the disagreement escalation (keep Pk check only)
   - **Keep**: All display code (tooltip V0 data, 6-column table rendering, Step 2 V0 table)

4. **`js/app.js`** — Other paths:
   - Line 1475: Remove V0 from struggle detection `anyCorrect` check
   - Line 2031-2032: Remove V0 from OOV phonetic hearings
   - Line 2113: Remove V0 from spillover guard
   - Line 2518: Remove V0 from self-correction engine list
   - Line 2578: Remove `_v0Type === 'correct'` from self-correction correctish gate

5. **`js/miscue-registry.js`** — Update any entries that reference V0's scoring role

6. **`index.html`** — Update version timestamp

### What Does NOT Change

- Reverb server still runs dual-pass (V1 + V0)
- V0 alignment still computed and stored
- `_v0Word`, `_v0Type`, `_v0Attempt` still populated on alignment entries
- 6-column table still displays V0 data
- Tooltips still show V0 hearing
- Step 2 alignment view still shows V0 table
- Debug logs still include V0 alignment data

### Testing

1. Re-run all 7 IRR passages with the change
2. Compare accuracy/WCPM scores before and after
3. Expected change: 0-1 words per passage (the rare V0-only-correct cases)
4. Verify 6-column table still renders correctly
5. Verify tooltips still show V0 data
6. Verify classifyWord coloring changes are appropriate (some "struggle-correct" → "correct", some "definite-struggle" → "confirmed-substitution" where only V0 disagreed)

## Future Considerations

With V0 demoted, the honest architecture is:

```
Reverb V1 (CTC verbatim) → primary transcript + filler keywords
Parakeet (RNNT via Deepgram) → cross-validation + timestamps + Trust Pk override
V0 (CTC clean) → display only
```

The identified gaps from IRR analysis (92-98% agreement with Trust Pk enabled):

| Gap | Cause | Potential Fix |
|-----|-------|---------------|
| All-engines-wrong subs | LM bias, acoustic ambiguity | LLM judge with passage context |
| Short word confusion | CTC peaky behavior, acoustic similarity | Function word leniency rules |
| Fast reader penalty | Phonetic reduction at high articulation rate | Speed-aware leniency using per-word ms/phoneme |
| No phoneme-level data | Architecture limitation | wav2vec2 phoneme model (future) |
| Raw data, no narrative | No interpretation layer | Template-based + LLM-powered reports (future) |

None of these gaps are addressed by V0. The next architectural improvements are orthogonal to the V0 question.

## Open Questions

1. **Should confirmed insertions require 2 or 3 engines?** Currently requires all available engines. With V0 demoted, V1 + Pk = 2 engines. This slightly loosens the threshold. Monitor whether confirmed insertion count increases meaningfully.

2. **Should the 6-column table header change?** Currently labeled "V0 (clean)". Could add "(display only)" or a muted style to indicate V0 doesn't affect scoring.

3. **Should V0 demotion be a toggle?** A `localStorage` setting could allow comparison of scores with and without V0 scoring influence, similar to Trust Pk toggle. This adds complexity but enables A/B validation on future recordings.
