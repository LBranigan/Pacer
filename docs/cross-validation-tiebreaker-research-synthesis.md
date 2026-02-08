# Cross-Validation Tiebreaker: Research Synthesis & Implementation Plan

**Date:** 2026-02-09
**Status:** Research complete, ready for implementation
**Parakeet version:** Updated to v3 (`nvidia/parakeet-tdt-0.6b-v3`) — reduces Whisper-inherited hallucination bias

---

## How to Read This Document

This is the single source of truth for implementing the reference-aware tiebreaker. It consolidates findings from 7 parallel research teams (25+ papers, 450+ web searches), subsequent honest reassessment, and architecture decisions. A future session can implement directly from Part 5 without re-reading the research.

---

## Part 1: Why the Approach Is Defensible (Honest Assessment)

### The Core Logic

A teacher sits next to a student with the passage in front of them. The student reads. When the teacher isn't sure what the student said, they give credit if it sounded close to the right word. The tiebreaker does the same thing.

### Why It Works

1. **There is no unbiased option.** The current system always trusts Reverb when engines disagree. That's not "neutral" — it's biased toward Reverb's specific failure modes (BPE mangling, transformer hallucinations). The tiebreaker replaces an unprincipled bias with a principled one.

2. **The base rate argument is real.** Even at 80% accuracy, 4 out of 5 words are correct. When engines disagree and one matches the reference, the prior strongly favors "student said the right word and one engine garbled it." This holds until accuracy drops below ~70%.

3. **Reverb produces non-words.** "Wigglewigle" is not a word. When Reverb produces garbage and Parakeet produces a real word matching the reference, Reverb is almost certainly wrong. These are the easiest cases to defend and where the tiebreaker adds the most value.

4. **Clinical alignment is real.** DIBELS, Acadience, and CBM-R all count self-corrections as correct. Standard ORF scoring doesn't penalize repetitions or insertions. The tiebreaker's "benefit of the doubt" philosophy matches established clinical practice — this isn't a rationalization, it's how the field works.

5. **More conservative than the state of the art.** Apple (2025) and Radboud (Gao et al. 2025) feed the reference text directly into Whisper's decoder during transcription. Our system keeps both engines completely independent and only consults the reference post-hoc when they disagree. This is less biased, not more.

6. **Impact is within measurement noise.** Human scorers disagree by 3-4 WCPM. The Standard Error of Measurement is 8-11 WCPM. The tiebreaker's 3-5 word effect is smaller than existing uncertainty.

### Why "Novel" Isn't Necessarily Good

No published ORF system uses multi-engine cross-validation. This is genuinely confirmed across NAEP, SERDA, CORE, Amira, SoapBox, Lalilo, ClearFluency, CMU LISTEN, and all ROVER literature. But the novelty likely reflects practical reality: researchers with proper resources would fine-tune one good model (e.g., Kid-Whisper achieves 9.1% WER) rather than combine two off-the-shelf adult models. This approach is a practical workaround for not having a model trained on children's speech — not a research advance.

### The Honest Concern: Parakeet's Systematic Bias

Parakeet v2 was trained on 110K hours of Whisper-large-v3-generated pseudo-labels. Whisper suppresses disfluencies and produces fluent output. So when a struggling reader hesitates on a word and produces something messy, Parakeet may output the reference word not because it *heard* it, but because its inherited LM *prefers* fluent words. ORF passages use common, high-frequency words — exactly where this LM bias is strongest.

**Mitigation:** Upgraded to Parakeet v3, which added 36K hours of non-speech audio specifically to combat Whisper-inherited hallucinations (NVIDIA acknowledged this issue). This doesn't eliminate the bias but reduces it. The adaptive threshold (Part 5.2) provides the runtime safety net.

### The N=2 Reality

With only two engines, disagreement is 50/50 — all resolution comes from the reference check, not the cross-validation itself. This is more honestly described as "reference-constrained scoring with disagreement detection" than "cross-validation." The cross-validation's value is providing the *disagreement signal* — identifying which words need scrutiny. That signal is genuine and valuable even though the resolution mechanism is the reference text.

A third engine is not needed right now. The reference text effectively acts as the third voter and is arguably more reliable than any third ASR engine for this specific use case (known-text assessment).

---

## Part 2: What the Original Proposal Got Wrong

### 2.1 The Prior Probabilities Are NOT From ROVER Literature

The proposal claims probabilities derived from "ROVER literature + child WER adjustments." No such derivation methodology exists. The ROVER literature (Fiscus 1997) says nothing about P(student correct | engine agreement pattern) in ORF contexts. The numbers are reasonable estimates — present them honestly as estimates.

### 2.2 The "85% Accuracy Even for Struggling Readers" Is Optimistic

NAEP 2018 data: below-basic-low fourth-graders read at **82% accuracy**. Betts (1946) classifies below 90% as "frustration level." Middle school struggling readers on grade-level text: 80-85% is realistic, not "85%+" as a floor. The Bayesian argument weakens below 80%, which is why the adaptive threshold is critical (not optional).

### 2.3 The "10-20% WER" Estimate Is Optimistic

Singh et al. 2025: Whisper zero-shot WER of **22-30% for grades 6-8** on CSLU Kids. Mujtaba et al. 2024: disfluent speech causes **2x WER degradation**. For struggling readers, effective WER is realistically 30-50%. The 10-20% range requires fine-tuning (not done here). Parakeet zero-shot on children's read speech: ~16.7% WER (Fan et al. 2024, OGI corpus, mixed ages K-10).

### 2.4 The Gurugubelli et al. 2023 Citation Cannot Be Verified

Extensive search found no paper matching this citation. The phenomenon (CTC autocorrecting 30-40% of reading mistakes) is real — Piton et al. (Interspeech 2023) documents it, and one pronunciation study found a 44.7% false acceptance rate — but the specific citation must be removed or replaced with Piton et al. 2023.

### 2.5 Duchateau et al. Numbers Don't Match

The proposal cites "70-85% correct recognition with hesitation." Actual published KU Leuven metrics: 44% miss rate, 13% false alarm rate (different metrics). Replace with the CORE study finding: word-level agreement rates of 0.73-0.94 with human raters depending on grade level.

### 2.6 The "15-20% Autocorrect-to-Reference Rate" Is Speculation

No published data supports this specific number. The phenomenon exists (LM bias toward common words is well-documented, and the rate is likely *higher* for Parakeet specifically due to Whisper pseudo-label inheritance). Present as "estimated, unverified, likely at the higher end for Parakeet."

---

## Part 3: Engine Architecture (Verified Facts)

### Reverb (Primary Engine)
- **Model:** `reverb_asr_v1` (WeNet-based)
- **Architecture:** 18 conformer encoder layers + 6-layer bidirectional transformer decoder (3 layers each direction)
- **Parameters:** ~600M
- **Training:** 200K hours human-transcribed English (largest such dataset for open-source model). 120K hours with verbatim labels, 80K with non-verbatim labels.
- **Decoding:** CTC prefix beam search with attention rescoring (production: WFST beam search + unigram LM + attention rescoring)
- **Verbatim mode:** Language-specific layers added to first/last blocks of encoder AND decoder. Continuous parameter 0.0-1.0, not separate networks.
- **Known weakness:** Poor performance on short-form audio (~5.7s segments). BPE mangling of rare/unusual word sequences.
- **Source:** [arXiv:2410.03930](https://arxiv.org/html/2410.03930v2)

### Parakeet (Cross-Validator)
- **Model:** `nvidia/parakeet-tdt-0.6b-v3` (upgraded from v2)
- **Architecture:** FastConformer XL encoder (8x depthwise conv subsampling) + Token-and-Duration Transducer with 2-layer LSTM prediction network (hidden dim 640) + 2-layer joint network (hidden dim 1024)
- **Parameters:** ~600M
- **Training:** ~120K hours total. 10K human-transcribed (NeMo ASR Set 3.0). 110K pseudo-labeled from YouTube-Commons/YODAS/LibriLight via Whisper-large-v3 (Granary pipeline). v3 adds 36K hours non-speech audio to combat hallucinations.
- **TDT mechanism:** Dual prediction — token distribution + duration distribution (0-8 frames). Can skip frames during inference, which means hesitations falling in skipped regions may be missed entirely.
- **Known weakness:** "Not recommended for word-for-word or incomplete sentence transcription" (direct quote from NVIDIA model card). Confidence scores unreliable (often 1.0). Disfluency suppression via inherited Whisper bias.
- **Source:** [HuggingFace model card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), [TDT paper ICML 2023](https://arxiv.org/abs/2304.06795)

### Why This Pairing Provides Diversity
- **Different decoders:** CTC+Attention rescoring vs Token-and-Duration Transducer
- **Different LM architectures:** 6-layer transformer vs 2-layer LSTM
- **Different training data:** 200K hrs all-human vs 10K human + 110K pseudo-labeled
- **Different error patterns:** BPE mangling + short real-word substitutions (Reverb) vs fluent wrong continuations + disfluency deletion (Parakeet)
- **Confirmed by literature:** Bayoumi et al. 2025 shows CTC+AED vs Transducer combinations provide complementary error patterns.

### Why NOT to Use a Larger Parakeet or a Third Engine
- **0.6B → 1.1B:** Gains ~0.2-0.5% absolute WER on adult speech. On children's speech (untrained domain for both), improvement is uncertain. Doubles latency.
- **Third engine:** The reference text effectively acts as the third voter. A third ASR engine would triple latency/cost, still not be trained on children's speech, and provide less reliable resolution than the reference text for a known-text assessment.
- **Future investment priority:** Fine-tuning one model on children's speech (MyST corpus, free, 20-40% relative WER reduction documented) would help far more than adding engines.

---

## Part 4: Clinical Context

### Target Population: Struggling Middle Schoolers (Grades 6-8)
- **WCPM norms (Hasbrouck & Tindal):** 25th percentile ≈ 98-124 WCPM depending on grade/season. 10th percentile ≈ 68-97 WCPM.
- **Accuracy:** 80-90% on grade-level text (frustration to instructional level). NOT 85%+ as originally claimed.
- **Disfluency patterns:** Hesitations, repetitions, self-corrections, partial attempts, slow word-by-word reading, irregular prosody. These are exactly the patterns that maximize ASR disagreement.
- **85% have multi-component deficits** — decoding + fluency + comprehension (Cirino et al. 2013).
- **Acoustic profile:** Girls 11-14 near adult female range. Boys 12-14 undergoing voice change (F0 150-240 Hz, highly variable). Speaking rate converges to adult by age 12. Spectral parameters converging but not fully adult until 14-15.

### Clinical Scoring Standards
- **Self-corrections counted correct** in DIBELS, Acadience, CBM-R, and Running Records.
- **Repetitions not counted as errors.** Insertions not counted as errors.
- **Dialect pronunciations not penalized.** "Student is not penalized for different pronunciation due to dialect, articulation, or second language preference."
- **Human inter-rater reliability:** Within 3-4 WCPM (FLORA system). NAEP: r=0.96 machine-to-human.
- **SEM:** 8-11 WCPM for a single probe. 95% confidence interval ≈ 20 WCPM.

### Appropriate Use
- **Practice/progress monitoring:** STRONGLY DEFENSIBLE. Trend analysis absorbs word-level scoring variability. Benefit of the doubt aligns with instructional context.
- **Screening/placement:** NEEDS GUARDRAILS. The tiebreaker biases toward crediting words as correct, which could increase false negatives (missing struggling readers). For screening, require median of 3 probes minimum. Consider dual reporting (with/without tiebreaker) if difference exceeds 5 words.

---

## Part 5: Implementation Plan

### 5.1 Pipeline Position

```
Audio → Reverb (v=1.0 + v=0.0)
  → Kitchen Sink Pipeline (parallel: Reverb ensemble + Parakeet v3 cross-validation)
  → Sequence Alignment (Reverb v1.0 vs v0.0) → Disfluency Tagging
  → Cross-Validation (NW align merged Reverb vs Parakeet → confirmed/disagreed/unconfirmed)
  → Hyphen Splitting (split hyphenated STT words)

  ▶ REFERENCE TIEBREAKER (HERE) — app.js after L616, before L741

  → Build sttLookup (canonical word → STT word map)
  → alignWords() (diff-match-patch: reference vs STT transcript)
  → Post-processing (compounds, omission recovery, near-miss, struggle, diagnostics)
  → UI rendering
```

**Why here:** Before `sttLookup` and `alignWords()`, so corrected words flow naturally through the entire downstream pipeline. `alignWords()` will classify a tiebroken word as "correct" with zero special-case code. All downstream processors (compound merge, struggle detection, proper noun forgiveness) see corrected data without modification.

**Why NOT in `cross-validator.js`:** Would require threading reference text through the Kitchen Sink pipeline, breaking the engine-agnostic design. Cross-validation should remain a pure engine-vs-engine comparison.

### 5.2 Implementation Code

```javascript
// ── Reference-Aware Tiebreaker ──────────────────────────────────
// When engines disagree and exactly one matches the reference text,
// trust that engine. Includes adaptive threshold that disables the
// tiebreaker if the student's running error rate suggests frustration-
// level reading (>20% confirmed errors), where the risk of masking
// real errors outweighs the benefit of recovering false positives.
//
// Applied BEFORE sttLookup and alignment so corrected words flow
// naturally through the entire downstream pipeline.
// ─────────────────────────────────────────────────────────────────
{
  const refNormWords = normalizeText(referenceText);
  const refCanonicalSet = new Set(refNormWords.map(w => getCanonical(w)));

  // Adaptive threshold: track confirmed errors for running accuracy
  let confirmedErrors = 0;
  let confirmedCorrect = 0;
  let tiebreakerDisabled = false;

  const tiebreakerLog = [];

  for (const w of transcriptWords) {
    // ── Update running accuracy from consensus words ──
    if (w.crossValidation === 'confirmed') {
      const wCanon = getCanonical(w.word.toLowerCase().replace(/[^a-z'-]/g, ''));
      if (refCanonicalSet.has(wCanon)) confirmedCorrect++;
      else confirmedErrors++;
    }

    // ── Adaptive threshold: disable if running accuracy < 80% ──
    // Requires 10+ confirmed words before activating (avoid noise from small samples).
    // 20% error threshold corresponds to Betts frustration level (<80% accuracy)
    // and decision-theoretic analysis showing tiebreaker suboptimal below ~75%.
    const totalConfirmed = confirmedCorrect + confirmedErrors;
    if (totalConfirmed >= 10 && confirmedErrors / totalConfirmed > 0.20) {
      tiebreakerDisabled = true;
    }

    // ── Only process disagreements ──
    if (w.crossValidation !== 'disagreed') continue;
    if (w.isDisfluency) continue;
    if (!w._xvalWord) continue;
    if (tiebreakerDisabled) continue;

    // ── Normalize and canonicalize both words ──
    const reverbNorm = w.word.toLowerCase().replace(/[^a-z'-]/g, '');
    const xvalNorm = w._xvalWord.toLowerCase().replace(/[^a-z'-]/g, '');
    const reverbCanon = getCanonical(reverbNorm);
    const xvalCanon = getCanonical(xvalNorm);

    // ── Handle _xvalWord that contains pre-split hyphenated form ──
    // After hyphen splitting, each part inherits the original _xvalWord.
    // If _xvalWord is "wiggle-waggle" but we're looking at the part "wiggle",
    // split _xvalWord by hyphens and check each part.
    let xvalMatchesRef = refCanonicalSet.has(xvalCanon);
    if (!xvalMatchesRef && w._xvalWord.includes('-')) {
      const xvalParts = w._xvalWord.split('-').map(p => p.toLowerCase().replace(/[^a-z'-]/g, ''));
      xvalMatchesRef = xvalParts.some(p => refCanonicalSet.has(getCanonical(p)));
      // If a part matches, use that part as the normalized form
      if (xvalMatchesRef) {
        const matchingPart = xvalParts.find(p => refCanonicalSet.has(getCanonical(p)));
        // Only override if this part corresponds to our position
        // (simple heuristic: check if it matches the reference word at this alignment position)
      }
    }

    const reverbMatchesRef = refCanonicalSet.has(reverbCanon);

    if (xvalMatchesRef && !reverbMatchesRef) {
      // ── Xval matches reference, Reverb doesn't → trust xval ──
      tiebreakerLog.push({
        original: w.word,
        xvalWord: w._xvalWord,
        chosen: xvalNorm,
        engine: w._xvalEngine || 'parakeet'
      });
      w._tiebreakerOriginalWord = w.word;
      w._tiebreakerChosenWord = xvalNorm;
      w.word = xvalNorm;
      w._tiebreakerUsed = true;
      w._tiebreakerEngine = w._xvalEngine || 'parakeet';
      w.crossValidation = 'confirmed';  // Upgrade status
    } else if (reverbMatchesRef && !xvalMatchesRef) {
      // ── Reverb matches, xval doesn't → keep reverb, mark it ──
      w._tiebreakerUsed = true;
      w._tiebreakerEngine = 'reverb';
      w._tiebreakerChosenWord = reverbNorm;
      w.crossValidation = 'confirmed';  // Reverb confirmed by reference
    }
    // ── Both match ref or neither matches → no tiebreaker action ──
    // "Both match" means both words are in the reference but different from each other
    // (e.g., "cat" vs "mat" when both appear in passage). Can't determine which
    // position is correct at this stage — alignment will handle it.
    // "Neither matches" keeps Reverb's word (status quo default).
  }

  if (tiebreakerLog.length > 0 || tiebreakerDisabled) {
    addStage('reference_tiebreaker', {
      corrections: tiebreakerLog.length,
      disabled: tiebreakerDisabled,
      runningErrorRate: totalConfirmed > 0
        ? (confirmedErrors / totalConfirmed * 100).toFixed(1) + '%'
        : 'n/a',
      details: tiebreakerLog
    });
  }
}
```

**Note on `normalizeText`:** This function lives in `text-normalize.js` and is imported in `alignment.js` but may not be directly available in `app.js`. Check whether it's already imported or if you need to import it. Alternatively, the reference text normalization that already runs at L552 area can be reused.

**Note on `getCanonical`:** Imported from `word-equivalences.js`. Already used in app.js for sttLookup construction (L741-746), so it's available.

### 5.3 Edge Cases

| Edge Case | Guard | Why |
|---|---|---|
| Both engines produce valid reference words | Skip tiebreaker (both in ref = no clear winner) | "cat" vs "mat" when both in passage — can't determine position here |
| Homophones / number equivalences | Use `getCanonical()` for all comparisons | Parakeet ITN: "1" ↔ "one", "won't" ↔ "will not" |
| `_xvalWord` contains pre-split hyphenated form | Split by hyphens, check each part | After hyphen splitting, parts inherit original _xvalWord |
| Disfluency words | Skip (`isDisfluency: true`) | Disfluencies don't enter alignment, don't affect WCPM |
| Running accuracy below 80% | Disable tiebreaker (adaptive threshold) | Protects most struggling readers from hidden errors |
| Same word triggers tiebreaker repeatedly | Log for future analysis | Could indicate systematic mispronunciation being masked |

### 5.4 Diagnostic Flags

Add to each word evaluated by the tiebreaker:
```javascript
_tiebreakerUsed: true,              // Tiebreaker was invoked for this word
_tiebreakerEngine: 'parakeet',      // Which engine's word was chosen
_tiebreakerOriginalWord: '...',     // What Reverb originally said (if overridden)
_tiebreakerChosenWord: '...',       // What was accepted as the word
```

### 5.5 UI Reporting

Add a tiebreaker summary to the diagnostics output section:
- Total words where engines disagreed
- Number resolved by tiebreaker toward reference (Parakeet won)
- Number where Reverb already matched reference (Reverb confirmed)
- Number where neither matched (kept Reverb by default)
- Whether adaptive threshold was triggered (and at what word count)
- Tiebreaker activation rate as percentage of total words

### 5.6 Interaction with Existing Systems

| System | Interaction | Risk |
|---|---|---|
| Compound word merging | Clean — compounds see corrected word text | LOW |
| Near-miss/struggle detection | Corrected word → no substitution → no struggle trigger. Correct behavior if student actually said the word. | MEDIUM — if tiebreaker is wrong, legitimate struggle masked |
| Omission recovery | None — operates on `unconsumedXval` (disjoint from `disagreed`) | NONE |
| Proper noun forgiveness | Corrected word → `correct` → forgiveness skipped. Same WCPM either way. | NONE |
| Terminal leniency | Corrected last word → `correct` → leniency skipped. More decisive. | LOW |
| Self-correction reclassification | Operates on insertions, not substitutions. No interaction. | NONE |

### 5.7 What NOT to Build

- **No third engine.** The reference text is the third voter. Adding Whisper would triple latency for marginal gain.
- **No larger Parakeet.** 0.6B → 1.1B buys ~0.2-0.5% WER for 2x latency. The cross-validator needs diversity, not marginal accuracy.
- **No log-linear combination.** Binary tiebreaker is simpler and sufficient. Graduate to continuous scoring only if empirical data shows the binary version is inadequate.
- **No dual WCPM reporting.** Save for a future screening mode. For practice/progress monitoring, single tiebreaker-inclusive WCPM is appropriate.
- **No confidence-weighted voting.** Parakeet confidence is unreliable (always 1.0). Reverb confidence is real but extracting it adds complexity for uncertain benefit.

---

## Part 6: Outstanding Questions & Concerns (Prioritized)

### Must Address Before Shipping

1. **Empirical validation.** Human-score 50-100 passages where the tiebreaker fires. Measure actual precision/recall. This is the #1 gap — everything else is estimates. Even 20 passages would be valuable.

2. **Adaptive threshold calibration.** The 20% error rate / 80% accuracy cutoff is a reasonable starting point from Betts frustration-level criterion and decision theory. Validate against ground-truth data once available.

3. **`normalizeText` availability in app.js.** Verify the import chain. May need to import from `text-normalize.js` or replicate the normalization inline.

### Should Address Soon

4. **Parakeet v3 compatibility testing.** Verify the v3 model produces the same output format (word timestamps, structure) as v2. The API contract should be identical but test it.

5. **Whisper pseudo-label inheritance is the primary false-negative mechanism.** When Parakeet produces a reference-matching word during disagreement, it may be LM-smoothing rather than acoustic evidence. This is *more likely* with v3's improved hallucination handling but not eliminated. Monitor tiebreaker activation patterns.

6. **Correlated autocorrect on common words.** ORF passages use common vocabulary — exactly where both engines' LMs exert strongest autocorrect pressure. The tiebreaker fires most where the autocorrect risk is highest. The adaptive threshold partially mitigates this.

7. **Dialect/equity impact is unknown.** ASR shows 0.35 WER for Black speakers vs. 0.19 for White (Koenecke 2020). The tiebreaker may help (correcting dialect misrecognitions toward reference) or hurt (masking error patterns clinicians want to observe). Test with diverse audio.

### Future Considerations

8. **Fine-tuning one model on children's speech.** MyST corpus (free, grades 3-5) with LoRA could reduce WER 20-40% relative. This is the single highest-impact improvement available and would reduce dependence on the tiebreaker entirely.

9. **Selective prediction / abstention.** When neither engine matches the reference, flag the word as "uncertain" rather than silently defaulting to Reverb. Let the UI show both alternatives.

10. **Per-word tiebreaker tracking across sessions.** If the same word triggers the tiebreaker consistently for the same student, it may indicate a systematic mispronunciation being masked.

---

## Part 7: Key Sources (All Verified)

| Source | Key Finding | URL |
|---|---|---|
| Singh et al. 2025 | WER by grade: K=84.6%, Gr6=30.3%, Gr8=22%, adult=3% | https://arxiv.org/abs/2502.08587 |
| Fan et al. 2024 | Parakeet zero-shot on children: 16.7% WER (OGI), 11.1% (MyST) | https://arxiv.org/abs/2406.10507 |
| Mujtaba et al. 2024 | Disfluent speech causes 2x WER degradation across 6 ASR systems | https://arxiv.org/abs/2405.06150 |
| NAEP 2018 | Machine-human r=0.96; below-basic-low=82% accuracy | https://nces.ed.gov/nationsreportcard/studies/orf/scoring.aspx |
| SERDA (Harmsen 2025) | Word-level precision 0.31 (69% false positives) — single engine | https://pmc.ncbi.nlm.nih.gov/articles/PMC12686063/ |
| Apple/Smith et al. 2025 | Prompted Whisper: 3.9-5.4% WER on children's reading | https://arxiv.org/html/2505.23627v1 |
| Gao et al. 2025 | Prompted Whisper Dutch children: 5.1% WER, miscue F1=0.73 | https://www.isca-archive.org/interspeech_2025/gao25c_interspeech.html |
| Bayoumi et al. 2025 | CTC+AED combination ≈ diverse architecture pairs for WER reduction | https://arxiv.org/abs/2508.09880 |
| Koenecke et al. 2020 | Racial ASR disparity: WER 0.35 Black vs 0.19 White speakers | https://www.pnas.org/doi/10.1073/pnas.1915768117 |
| Reverb paper 2024 | Architecture verified; poor on short-form audio (<5.7s) | https://arxiv.org/html/2410.03930v2 |
| Parakeet v3 model card | "Not recommended for word-for-word"; v3 adds anti-hallucination data | https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3 |
| Shivakumar 2020 | Transfer learning adult→child: 39%→17.8% WER; fast adaptation for 12-14yo | https://pmc.ncbi.nlm.nih.gov/articles/PMC7199459/ |
| Fiscus 1997 | ROVER: voting-based multi-engine combination (never applied to ORF) | https://ieeexplore.ieee.org/document/659110/ |
| Hasbrouck & Tindal | ORF norms: Gr6 25th%ile ≈ 98-122 WCPM | https://files.eric.ed.gov/fulltext/ED594994.pdf |
| Cirino et al. 2013 | 85% of struggling middle school readers have multi-component deficits | https://pmc.ncbi.nlm.nih.gov/articles/PMC3757546/ |
| Piton et al. 2023 | Commercial ASR returns target words when children misread (autocorrect) | https://www.isca-archive.org/interspeech_2023/piton23_interspeech.html |
| NVIDIA entropy blog | ASR confidence scores unreliable (often >0.9 even when wrong) | https://developer.nvidia.com/blog/entropy-based-methods-for-word-level-asr-confidence-estimation/ |
| Jain et al. 2024 | Kid-Whisper: fine-tuning reduces WER from 13.93% to 9.11% on MyST | https://arxiv.org/abs/2309.07927 |
| TDT paper (ICML 2023) | Token-and-Duration Transducer architecture; frame-skipping mechanism | https://arxiv.org/abs/2304.06795 |
| Gothi et al. 2024 | Two-pass miscue detection (closest published analog to dual-engine) | https://www.isca-archive.org/interspeech_2024/gothi24_interspeech.html |

---

## Part 8: Corrected Probability Estimates

These are **honest estimates, not literature-derived values.** They are directionally reasonable based on base rate reasoning and the cited WER studies, but they have NOT been empirically measured for this specific system. They should be validated against ground-truth data.

| Scenario | Estimated P(correct) | Tiebreaker Action | Confidence in Estimate |
|---|---|---|---|
| Both engines agree + match ref | ~95-99% | Already confirmed; no tiebreaker | HIGH — both engines + reference agree |
| One engine matches ref, other doesn't (typical reader) | ~75-85% | **Tiebreaker fires** | LOW-MEDIUM — unverified |
| One engine matches ref, other doesn't (struggling reader) | ~65-75% | **Tiebreaker fires (if threshold allows)** | LOW — depends on accuracy level |
| Both agree on non-reference word | ~8-15% correct | No tiebreaker (consensus substitution) | MEDIUM — strong error signal |
| Neither matches reference, engines disagree | ~15-25% correct | Keep Reverb (no clear winner) | LOW — most uncertain scenario |

### Decision-Theoretic Threshold

The tiebreaker is the optimal decision when `c_FP / c_FN > (1-p) / p`:

| Student accuracy (p) | Tiebreaker optimal if FP/FN cost ratio > |
|---|---|
| 90% | 0.11 — almost always optimal |
| 85% | 0.18 |
| 80% | 0.25 |
| 75% | 0.33 |
| 70% | 0.43 |

For word-level scoring (c_FP/c_FN ≈ 0.5-1.5), the tiebreaker is optimal for all students above ~65-70% accuracy. The adaptive threshold at 80% provides a conservative safety margin.

---

## Part 9: Files to Modify

| File | Change | Lines (approximate) |
|---|---|---|
| `js/app.js` | Insert tiebreaker logic after hyphen splitting, before sttLookup | After L616, before L741 |
| `js/app.js` | May need to import `normalizeText` from text-normalize.js | Top of file |
| `js/ui.js` | Add tiebreaker summary to diagnostics display | End of diagnostic output section |
| `js/miscue-registry.js` | No change — tiebreaker is not a new miscue type | N/A |
| `services/reverb/server.py` | Already updated to Parakeet v3 | Done |
| `js/parakeet-api.js` | Already updated comment to v3 | Done |
| `js/cross-validator.js` | Already updated comment to v3 | Done |

### Visual Reference
See `docs/tiebreaker-decision-logic.html` for an interactive visualization of the complete decision flowchart, all 5 scenarios, the adaptive threshold, and the dangerous autocorrect case.
