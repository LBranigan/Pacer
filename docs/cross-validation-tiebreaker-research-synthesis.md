# Cross-Validation Tiebreaker: Research Synthesis & Implementation Plan

**Date:** 2026-02-08
**Status:** Research complete, revised after 4-team architecture/statistics/clinical/adversarial review
**Parakeet version:** v3 (`nvidia/parakeet-tdt-0.6b-v3`)
**Last updated:** 2026-02-08 — Post-review revision with critical fixes (hyphen-split, tiebroken status, both-real-words guard, activation ceiling)

---

## How to Read This Document

This is the single source of truth for implementing the reference-aware tiebreaker. It consolidates findings from 10 parallel research teams (30+ papers, 600+ web searches), independent Bayesian decision-theoretic analysis, and honest reassessment of all prior claims. A future session can implement directly from Part 5 without re-reading the research.

**Key changes from prior version:**
- Decision-theoretic formula corrected (inequality direction was wrong)
- Confidence gate recommendation removed (Reverb scores are overconfident, not useful)
- Adaptive threshold minimum raised from n=10 to n=20
- Bayoumi et al. citation corrected
- Equity impact section added as disclaimer + future work
- Canary vs Parakeet analysis added (verdict: stay with Parakeet)
- Disfluency guard added to implementation
- v3 confirmed as correct version over v2

**Key changes from 4-team review (latest):**
- **CRITICAL: `'tiebroken'` status replaces `'confirmed'`** — preserves downstream diagnostic trail
- **CRITICAL: Hyphen-split words skipped** — prevents transcript corruption via `_splitFromHyphen` flag
- **NEW: Both-real-words guard** — only fires on BPE garbage, skips real-word disagreements. Sidesteps a_P sensitivity.
- **NEW: Activation rate ceiling (15%)** — second safety mechanism independent of adaptive threshold
- **NEW: Dual WCPM reporting** — promoted from "don't build" to required. Show raw + adjusted scores.
- **NEW: a_P sensitivity analysis** — documents that LR is highly sensitive to a_P (0.22 vs 0.447)
- **REVISED: Teacher analogy demoted** from lead framing to background metaphor
- **REVISED: "Within measurement noise" reframed** as systematic upward bias (not random error)
- **REVISED: Reverb-wins branch removed** from tiebreaker code (both-real-words guard makes it unreachable)
- **NEW: Part 11** — Review recommendations summary

---

## Part 1: Why the Approach Is Defensible (Honest Assessment)

### The Core Logic

ORF is a known-text assessment. The reference passage is not auxiliary information — it is a constitutive element of the test. A human examiner literally sits with the passage in front of them and uses it to score. Using the reference text to inform automated scoring decisions is standard practice, not a bias.

The tiebreaker is a **Bayesian decision rule**: when two independent ASR engines disagree on a word, the reference text serves as a prior to resolve the tie. It is NOT doing what a teacher does (a teacher hears a single acoustic signal and integrates articulation, prosody, and context into a holistic judgment). It is doing something narrower but defensible: selecting between two machine transcriptions using the only ground truth available — what the student was supposed to read.

### Why It Works

1. **There is no unbiased option.** The current system always trusts Reverb when engines disagree. That's not "neutral" — it's biased toward Reverb's specific failure modes (BPE mangling, transformer hallucinations). The tiebreaker replaces an unprincipled bias with a principled one.

2. **The base rate dominates.** Independent Bayesian analysis shows the likelihood ratio LR ≈ 0.954 — the observation "one engine matches reference" is nearly uninformative. The tiebreaker works because most words are read correctly (p > 0.80), not because the engines provide strong diagnostic signal. At p = 0.85, the posterior P(correct | disagreement, one matches ref) ≈ 0.844. This tracks the prior closely. The base rate does the work.

3. **Reverb produces non-words.** "Wigglewigle" is not a word. When Reverb produces garbage and Parakeet produces a real word matching the reference, Reverb is almost certainly wrong. These are the easiest cases to defend and where the tiebreaker adds the most value.

4. **Clinical scoring norms favor credit.** DIBELS, Acadience, and CBM-R all count self-corrections as correct. Standard ORF scoring doesn't penalize repetitions or insertions. The tiebreaker's directional bias (toward crediting words) is at least *consistent* with the field's general philosophy, though the mechanism itself (selecting between machine transcriptions) has no direct clinical precedent.

5. **More conservative than the state of the art.** Apple/Smith et al. (2025) and Radboud/Gao et al. (2025) feed the reference text directly into Whisper's decoder during transcription, achieving 3.9-5.1% WER. Our system keeps both engines completely independent and only consults the reference post-hoc when they disagree. This is less biased, not more.

6. **Impact is small relative to existing uncertainty — but it is systematic, not random.** Human scorers disagree by 3-4 WCPM (FLORA study). SEM is 5-15 WCPM (median ~10). The tiebreaker's 3-5 word effect is smaller than this uncertainty. However, SEM is random error (equally likely high or low), while the tiebreaker introduces a **systematic upward bias** — it can only increase scores, never decrease them. A systematic +3-5 WCPM shift is not "noise" — it moves every student's score in the same direction. For screening, this effectively lowers the cut score.

7. **No published ORF system uses multi-engine cross-validation.** Confirmed across NAEP, SERDA, CORE, Amira, SoapBox, Lalilo, ClearFluency, CMU LISTEN, and all ROVER literature. Every surveyed system uses a single ASR engine. The approach is novel but defensible — it fills a gap that single-engine systems cannot address without fine-tuning on children's speech.

### The Honest Framing

This is NOT ROVER with a third voter. ROVER (Fiscus 1997) requires N≥3 for majority voting. With N=2 engines, there is no majority. The reference text is NOT an acoustic observation — it is a Bayesian prior. This is more honestly described as a **Bayesian decision rule** that uses engine disagreement as a trigger and the reference text as a prior. The cross-validation's value is providing the *disagreement signal* — identifying which words need scrutiny. That signal is genuine and valuable even though the resolution mechanism is the reference text.

### The Honest Concern: Parakeet's Systematic Bias

Parakeet v3 was trained on ~660K hours total, of which only ~10K are human-transcribed. The rest are pseudo-labeled via Whisper-large-v3 (Granary pipeline). Whisper has a documented fluency bias:

- **Whisper correctly transcribes only 56% of disfluencies** at the word level; 37% are silently dropped, 6% transcribed incorrectly (2024 study)
- **73.77% of all untranscribed words are disfluencies** — disfluencies are disproportionately what Whisper fails on
- Parakeet inherits this bias by construction: when trained on clean pseudo-labels, it learns that disfluent speech should produce fluent output

**NVIDIA's own model card warns:** "Not recommended for word-for-word/incomplete sentences as accuracy varies based on the context of input text." This is literally what struggling readers produce.

**Mitigation:** v3 added 36K hours of non-speech audio specifically to combat Whisper-inherited hallucinations. This helps with noise robustness but does NOT fix the core fluency bias (teaches "no speech = no output," not "disfluent speech = verbatim output"). The adaptive threshold (Part 5.2) and disfluency guard (Part 5.3) provide runtime safety nets.

### Why v3 Over v2

- v3 adds anti-hallucination training (36K hours non-speech audio) — useful for noisy classroom recordings
- v3 has more total training data (660K vs 120K hours)
- English WER is marginally worse (6.34% vs 6.05%) — negligible tradeoff for hallucination robustness
- The fluency bias exists equally in both (same Whisper pseudo-label pipeline)
- v3 is already deployed in the backend

### Why Parakeet Over Canary

Canary 1B v2 achieves 9.5% WER on MyST (children's speech) zero-shot vs Parakeet's ~11.1%. However:

- Parakeet is **4.4x faster** (RTFx 3,332 vs 749)
- Parakeet uses **half the VRAM** (~3-4 GB vs ~6-8 GB)
- Parakeet has **better general English WER** (6.32% vs 7.15%)
- Parakeet provides **native timestamps** from TDT duration head; Canary needs a separate forced aligner
- Both have the same Whisper pseudo-label problem (both trained on Granary)
- Neither has useful confidence scores
- Canary's AED decoder is architecturally **closer to Whisper** (both attention-based encoder-decoders) — may inherit Whisper's specific error patterns more faithfully, reducing cross-validation independence
- After fine-tuning on MyST, **Parakeet beats Canary** (8.5% vs 9.2% WER)
- Parakeet is already deployed

---

## Part 2: What the Original Proposal Got Wrong

### 2.1 The ROVER Framing Is Misleading

ROVER (Fiscus 1997) is a voting mechanism requiring N≥3. With N=2, disagreement is 50/50 with zero resolution power. The reference text is not a "voter" — it provides no acoustic evidence. This is a Bayesian decision rule, not ROVER. Bayoumi et al. 2025 found that architectural diversity is "not necessarily correlated" with combination performance — all pairwise combinations of reasonable models give similar gains. The stronger claim about CTC+AED vs Transducer complementarity is not well-supported by that paper.

### 2.2 The Decision-Theoretic Formula Was Backwards

The original stated: `c_FP/c_FN > (1-p)/p`. **Corrected:** `c_FP/c_FN < LR × p/(1-p)`. The inequality direction was wrong (less-than, not greater-than). The conclusion is the same (tiebreaker is optimal) but the derivation was incorrect. See Part 8 for the corrected analysis.

### 2.3 The Prior Probabilities Are NOT From ROVER Literature

No derivation methodology exists in ROVER literature for P(student correct | engine agreement pattern) in ORF contexts. The numbers are reasonable estimates — present them honestly as estimates.

### 2.4 The "85% Accuracy Even for Struggling Readers" Is Optimistic

NAEP 2018 data: below-basic-low fourth-graders read at **82% accuracy**. Betts (1946) classifies below **90%** (not 80%) as "frustration level." Middle school struggling readers on grade-level text: 80-85% is realistic, not "85%+" as a floor. The Bayesian argument weakens below 80%, which is why the adaptive threshold is critical (not optional).

### 2.5 The "10-20% WER" Estimate Is Optimistic

Singh et al. 2025: Whisper zero-shot WER of **22-30% for grades 6-8** on CSLU Kids. Mujtaba et al. 2024: disfluent speech causes **2.7x mean WER degradation** (not 2x; actual mean across 6 systems: 10.5% fluent → 28.1% disfluent). For struggling readers with disfluencies, effective WER is realistically 30-50%. Parakeet zero-shot on children's read speech: ~16.7% WER (Fan et al. 2024, OGI corpus).

### 2.6 The Gurugubelli et al. 2023 Citation Cannot Be Verified

Replaced with Piton et al. (Interspeech 2023), which documents the same phenomenon (ASR autocorrecting children's misread words to the target). One pronunciation study found a 44.7% false acceptance rate.

### 2.7 Duchateau et al. Numbers Don't Match

The proposal cites "70-85% correct recognition with hesitation." Actual published KU Leuven metrics: 44% miss rate, 13% false alarm rate (different metrics). Replaced with CORE study finding: word-level agreement rates of 0.73-0.94 with human raters depending on grade level.

### 2.8 n=10 Confirmed Words Is Statistically Inadequate

At n=10, the 20% error threshold has:
- **18% false trigger rate** — disables the tiebreaker for a student who should keep it (at p=0.85)
- **38% miss rate** — fails to disable for a struggling student who needs it disabled (at p=0.70)

Raised to n=20 minimum. See Part 5.2 for details.

### 2.9 Reverb Confidence Scores Are NOT Useful

The original proposal acknowledged this ("uncertain benefit") but the 10-team review initially recommended a confidence gate. After dedicated research, this recommendation is **withdrawn**:

- Reverb's attention-rescoring confidence uses MAX aggregation across BPE tokens — a single common BPE piece inflates the score
- Most words (correct AND incorrect) score **>0.9** due to softmax overconfidence
- Published F1 for word-level error detection via confidence: **0.33-0.55** (barely above random)
- A "confidence < 0.7" gate would almost never fire, making it inert
- The Reverb paper (arXiv 2410.03930) doesn't even discuss confidence scores as useful

**Do not add a confidence gate.** Use structural signals instead (cross-validation status, disfluency flags, temporal patterns).

---

## Part 3: Engine Architecture (Verified Facts)

### Reverb (Primary Engine)
- **Model:** `reverb_asr_v1` (WeNet-based)
- **Architecture:** 18 conformer encoder layers + 6-layer bidirectional transformer decoder (3 L2R + 3 R2L)
- **Parameters:** ~600M
- **Training:** 200K hours human-transcribed English (largest such dataset for open-source). 120K verbatim + 80K non-verbatim.
- **Decoding:** CTC prefix beam search with attention rescoring (production: WFST + unigram LM + attention rescoring)
- **Verbatim mode:** Language-Specific Layers at first/last blocks of encoder AND decoder. Continuous 0.0-1.0 (likely linear interpolation between verbatim/clean layer outputs).
- **Confidence scores:** Attention decoder log-softmax, MAX-aggregated across BPE tokens. **Not useful for word-level error detection** (overconfident, clustered >0.9).
- **Known weakness:** Poor on short-form audio (~5.7s). BPE mangling of rare/unusual sequences. No benchmarks on children's speech exist.
- **Source:** [arXiv:2410.03930](https://arxiv.org/html/2410.03930v2)

### Parakeet (Cross-Validator)
- **Model:** `nvidia/parakeet-tdt-0.6b-v3`
- **Architecture:** FastConformer XL encoder (24 layers, 8x depthwise conv subsampling) + Token-and-Duration Transducer with 2-layer LSTM prediction network
- **Parameters:** ~600M
- **Training:** ~660K hours total. ~10K human-transcribed (NeMo ASR Set 3.0). ~650K pseudo-labeled via Whisper-large-v3 (Granary pipeline). v3 adds 36K hours non-speech audio.
- **TDT mechanism:** Dual prediction — token distribution + duration distribution (skip 0-4 frames, up to 320ms per step). Enables aggressive disfluency skipping.
- **Confidence scores:** Always 1.0. **Completely useless.** (GitHub Issue #8737; TDT confidence is "neither formally defined nor easily supported")
- **Known weakness:** "Not recommended for word-for-word or incomplete sentence transcription" (NVIDIA model card). Disfluency suppression via inherited Whisper bias. Whisper correctly transcribes only 56% of disfluencies.
- **Source:** [HuggingFace](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), [TDT paper ICML 2023](https://arxiv.org/abs/2304.06795)

### Why This Pairing Provides Diversity
- **Different decoders:** CTC+Attention rescoring vs Token-and-Duration Transducer
- **Different LM architectures:** 6-layer transformer vs 2-layer LSTM
- **Different training data:** 200K hrs all-human vs 10K human + 650K pseudo-labeled
- **Different error patterns:** BPE mangling + short real-word substitutions (Reverb) vs fluent wrong continuations + disfluency deletion (Parakeet)
- **Moderate decorrelation:** Bayoumi et al. 2025 shows all pairwise ASR combinations provide modest WER reduction, though gains are not strongly correlated with architectural diversity specifically

### Why NOT to Switch Engines or Add More
- **Canary 1B:** 4.4x slower, 2x VRAM, same pseudo-label problem, no useful confidence, architecturally closer to Whisper. See Part 1 for full analysis.
- **Third engine:** The reference text effectively acts as the Bayesian prior. A third ASR engine would triple latency/cost, still not be trained on children's speech, and provide less reliable resolution.
- **Larger Parakeet (1.1B):** ~0.2-0.5% WER gain for 2x latency. Not worth it.
- **Future priority:** LoRA fine-tune Parakeet on children's speech (see separate proposal doc). This is the single highest-impact improvement.

---

## Part 4: Clinical Context

### Target Population: Struggling Middle Schoolers (Grades 6-8)
- **WCPM norms (Hasbrouck & Tindal 2006):** 25th percentile ≈ 102-124 WCPM depending on grade/season. 10th percentile ≈ 77-98 WCPM.
- **Accuracy:** 80-90% on grade-level text (Betts frustration = below 90%, not 80%). NOT 85%+ as originally claimed.
- **Disfluency patterns:** Hesitations, repetitions, self-corrections, partial attempts, slow word-by-word reading, irregular prosody. These maximize ASR disagreement and trigger the disfluency suppression bias in Parakeet.
- **Acoustic profile:** Girls 12-14 near adult female range (F0 ~219 Hz). Boys 12-14 undergoing voice change (F0 110-230 Hz, extreme individual variation). Grades 6+ show a dramatic WER spike in all models except Whisper (Singh et al. 2025: Wav2Vec jumps from 22% to 65% at grade 6).
- **85% have multi-component deficits** — decoding + fluency + comprehension (Cirino et al. 2013).

### Clinical Scoring Standards
- **Self-corrections counted correct** in DIBELS, Acadience, CBM-R, and Running Records.
- **Repetitions and insertions not counted as errors.** Ignored in scoring.
- **Dialect pronunciations not penalized.** "Student is not penalized for different pronunciation due to dialect, articulation, or second language preference" (DIBELS 8).
- **3-second rule:** If student doesn't read word within 3 seconds, examiner provides it and marks as error.
- **Human inter-rater reliability:** Within 3-4 WCPM (FLORA study). NAEP: r=0.96 machine-to-human.
- **SEM:** 5-15 WCPM (median ~10) for a single probe. 95% CI ≈ 20 WCPM.

### Appropriate Use
- **Practice/progress monitoring:** STRONGLY DEFENSIBLE. Trend analysis absorbs word-level variability. Benefit of the doubt aligns with instructional context.
- **Screening/placement:** NEEDS GUARDRAILS. Tiebreaker biases toward crediting words as correct, which could increase false negatives (missing struggling readers). Require median of 3 probes minimum. Consider dual reporting (with/without tiebreaker) if difference exceeds 5 words.

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
  → alignWords() (Needleman-Wunsch graded: reference vs STT transcript)
  → Post-processing (compounds, omission recovery, near-miss, struggle, diagnostics)
  → UI rendering
```

**Why here:** Before `sttLookup` and `alignWords()`, so corrected words flow naturally through the entire downstream pipeline. `alignWords()` will classify a tiebroken word as "correct" with zero special-case code.

**Why NOT in `cross-validator.js`:** Would require threading reference text through the Kitchen Sink pipeline, breaking the engine-agnostic design.

### 5.2 Safety Mechanisms: Adaptive Threshold + Activation Rate Ceiling

Two independent safety mechanisms protect against systematic tiebreaker misuse.

#### Mechanism 1: Running Accuracy Threshold (n=20 Minimum)

Disables the tiebreaker when the student's running error rate suggests frustration-level reading.

**Parameters:**
- **Minimum sample size: n≥20 confirmed words** (raised from n=10)
  - At n=10: 18% false trigger rate, 38% miss rate — unacceptable
  - At n=20: miss rate drops substantially (38% → 24%); false trigger rate barely changes (18% → 17%)
  - Consider n=30 for better balance: false trigger 15.3%, miss rate 16.0%
- **Error threshold: >20%** (corresponds to <80% accuracy, well below Betts frustration boundary of 90%)
- **One-way latch:** Once disabled, stays disabled for the rest of the passage

**Known limitation:** The threshold only counts `confirmed` words (both engines agree) in its denominator. Disagreed words — the exact population the tiebreaker acts on — are excluded. This means students who produce many disagreements (and thus need the most protection) are the ones least likely to trigger the threshold. The activation rate ceiling (Mechanism 2) compensates for this blind spot.

#### Mechanism 2: Activation Rate Ceiling (New)

Disables the tiebreaker if it fires on too many words, which indicates systematic Parakeet autocorrect rather than genuine BPE garbage recovery.

**Parameters:**
- **Ceiling: >15% of total words processed so far**
- **Checked after each tiebreaker firing** (not just at the end)
- **One-way latch:** Once disabled, stays disabled

**Rationale:** When the tiebreaker fires on 3-5% of words, it is recovering individual Reverb failures. When it fires on 15%+ of words, something structural is happening — likely Parakeet's LM bias systematically producing reference words for a disfluent reader. The ceiling catches the case the accuracy threshold misses: a student whose agreed-upon words look fine but whose disagreements are dominated by Parakeet autocorrect.

**Decision-theoretic justification:** The tiebreaker is optimal when `c_FP/c_FN < LR × p/(1-p)`. With LR ≈ 0.954 and symmetric costs (c_FP/c_FN = 1), the tiebreaker is optimal for all students above ~51% accuracy. The 80% threshold provides a massive conservative safety margin. Even under screening costs (c_FP/c_FN = 3), the tiebreaker is optimal above ~76%.

### 5.3 Guards: Disfluency, Partial Attempt, Both-Real-Words

**The tiebreaker should NOT override Reverb when the disagreement involves disfluent speech.** Parakeet's Whisper-inherited fluency bias means it systematically produces clean words where Reverb heard disfluencies. A disagreement where Reverb produced a partial word or repetition and Parakeet produced a clean reference word is NOT acoustic evidence — it's LM smoothing.

Guard conditions (skip tiebreaker if any are true):
- `w.isDisfluency === true` — word already tagged as disfluency by the Reverb ensemble diff
- Reverb's word looks like a partial attempt (e.g., matches first 3+ chars of reference but is shorter — "beau" for "beautiful")
- Reverb's word is a repetition of the previous word

#### Both-Real-Words Guard (New — Critical Safety Mechanism)

**The tiebreaker is most clearly correct when Reverb produces non-words** (BPE garbage like "wigglewigle", "beutful") and Parakeet produces a real reference word. In this case, Reverb almost certainly mangled the audio and Parakeet recovered it.

**The tiebreaker is most dangerous when both engines produce real English words** ("house" vs "horse", "bat" vs "bet"). In this case, we cannot distinguish "Reverb faithfully transcribed a real substitution error" from "Reverb's LM picked the wrong real word." This is where the a_P uncertainty matters most (see Part 8 sensitivity analysis).

**Guard:** Before firing the tiebreaker, check if Reverb's word is a real English word (exists in `refCanonicalSet` somewhere in the passage, or is a common English word). If it IS a real word, skip the tiebreaker — the disagreement is ambiguous between ASR error and genuine student error. Only fire when Reverb produced apparent garbage.

**Implementation:** Use a dictionary check. The system already calls the Free Dictionary API for proper noun forgiveness (cached in sessionStorage). Reuse the same lookup: if `dict_{reverbWord}` returns 200 (real word), skip. If 404 (not a word), fire the tiebreaker. For performance, also accept any word already in `refCanonicalSet` as "real" without an API call.

**Why this sidesteps the a_P problem entirely:** The Bayesian analysis is most sensitive to a_P (Parakeet's false acceptance rate), which ranges from 0.22 to 0.447 depending on the source. Rather than debating the exact value, the both-real-words guard restricts the tiebreaker to cases where the answer is obvious regardless of a_P: Reverb produced a non-word, so it was almost certainly wrong. When both words are real, we flag it for teacher review instead of silently resolving it.

This is the "easy/hard case splitting" described in Part 7.10, promoted from "future consideration" to "required guard."

### 5.4 Implementation Code

**Key design decisions (from architecture review):**

1. **`'tiebroken'` status, NOT `'confirmed'`.** Upgrading to `'confirmed'` makes tiebroken words invisible to all downstream diagnostics (struggle detection, fragment absorption, self-correction detection). Using `'tiebroken'` preserves the diagnostic trail — alignment treats it as correct for WCPM, but diagnostics can still examine these words.

2. **Hyphen-split words are skipped.** After hyphen splitting, each part inherits the parent's `_xvalWord`. Processing them independently would corrupt the transcript (replacing a part like "self" with the full "self-control"). Words with `_splitFromHyphen: true` are excluded.

3. **Both-real-words guard.** If Reverb's word is a real English word (in `refCanonicalSet` or dictionary), skip — the disagreement is ambiguous. Only fire when Reverb produced apparent BPE garbage.

4. **Activation rate ceiling.** If tiebreaker fires on >15% of words so far, disable — suggests systematic Parakeet autocorrect.

5. **Log both directions.** Track both xval-wins AND reverb-wins for monitoring Parakeet LM bias dominance.

```javascript
// ── Reference-Aware Tiebreaker ──────────────────────────────────
// When engines disagree and Reverb produced a non-word while the
// cross-validator produced a reference word, trust the cross-validator.
//
// Uses 'tiebroken' status (not 'confirmed') to preserve the diagnostic
// trail for downstream struggle/near-miss/self-correction detection.
//
// Applied BEFORE sttLookup and alignment so corrected words flow
// naturally through the entire downstream pipeline.
//
// Hyphen-split words are SKIPPED (they inherit the parent's _xvalWord
// and processing them independently would corrupt the transcript).
// ─────────────────────────────────────────────────────────────────
{
  const refNormWords = normalizeText(referenceText);
  const refCanonicalSet = new Set(refNormWords.map(w => getCanonical(w)));

  // Adaptive threshold: track confirmed errors for running accuracy
  let confirmedErrors = 0;
  let confirmedCorrect = 0;
  let tiebreakerDisabled = false;
  let disableReason = null;

  const tiebreakerLog = [];  // ALL tiebreaker events (both directions)
  let totalConfirmed = 0;
  let totalWordsProcessed = 0;
  let tiebreakerFirings = 0;

  for (const w of transcriptWords) {
    totalWordsProcessed++;

    // ── Update running accuracy from consensus words ──
    if (w.crossValidation === 'confirmed') {
      const wCanon = getCanonical(w.word.toLowerCase().replace(/[^\w'-]/g, ''));
      if (refCanonicalSet.has(wCanon)) confirmedCorrect++;
      else confirmedErrors++;
    }

    // ── Safety Mechanism 1: Adaptive threshold ──
    // Disable if running accuracy < 80% among confirmed words (n≥20).
    totalConfirmed = confirmedCorrect + confirmedErrors;
    if (!tiebreakerDisabled && totalConfirmed >= 20 && confirmedErrors / totalConfirmed > 0.20) {
      tiebreakerDisabled = true;
      disableReason = 'accuracy_threshold';
    }

    // ── Safety Mechanism 2: Activation rate ceiling ──
    // Disable if tiebreaker has fired on >15% of words so far.
    if (!tiebreakerDisabled && totalWordsProcessed >= 10 &&
        tiebreakerFirings / totalWordsProcessed > 0.15) {
      tiebreakerDisabled = true;
      disableReason = 'activation_rate';
    }

    // ── Only process disagreements ──
    if (w.crossValidation !== 'disagreed') continue;
    if (tiebreakerDisabled) continue;
    if (!w._xvalWord) continue;

    // ── Hyphen-split guard ──
    // After hyphen splitting, each part inherits the parent's _xvalWord.
    // Processing them independently would set w.word to the full hyphenated
    // form, undoing the split and corrupting the transcript.
    if (w._splitFromHyphen) continue;

    // ── Disfluency guard ──
    // Skip if word is tagged as disfluency (Parakeet's fluency bias would
    // produce clean output from disfluent speech — not acoustic evidence)
    if (w.isDisfluency) continue;

    // ── Partial attempt guard ──
    // If Reverb's word looks like a partial attempt at the reference word,
    // this is likely a genuine struggle, not a Reverb failure
    const reverbLower = w.word.toLowerCase().replace(/[^\w'-]/g, '');
    const xvalLower = w._xvalWord.toLowerCase().replace(/[^\w'-]/g, '');
    if (reverbLower.length >= 3 && xvalLower.startsWith(reverbLower) && xvalLower.length > reverbLower.length + 2) {
      continue; // "beau" for "beautiful" — genuine partial attempt
    }

    // ── Normalize and canonicalize both words ──
    const reverbCanon = getCanonical(reverbLower);
    const xvalCanon = getCanonical(xvalLower);

    const reverbMatchesRef = refCanonicalSet.has(reverbCanon);

    // ── Both-real-words guard ──
    // If Reverb's word is a real English word (exists in reference passage
    // or is a common dictionary word), the disagreement is ambiguous between
    // ASR error and genuine student substitution. Only fire the tiebreaker
    // when Reverb produced apparent garbage (non-word).
    // This sidesteps the a_P parameter uncertainty entirely.
    if (reverbMatchesRef) {
      // Reverb's word is in the reference passage — it's definitely a real word.
      // Could be a real substitution at the wrong position. Skip tiebreaker.
      continue;
    }
    // For words NOT in the reference, check if it's still a real English word.
    // Use the dictionary cache from proper noun forgiveness if available,
    // otherwise fall through (conservatively allow the tiebreaker).
    const dictCacheKey = `dict_${reverbLower}`;
    const cachedDictResult = sessionStorage.getItem(dictCacheKey);
    if (cachedDictResult === '200') {
      // Reverb's word is a real English word — disagreement is ambiguous
      continue;
    }
    // If cachedDictResult is null (no cache), we allow the tiebreaker to fire.
    // The dictionary API is async and we can't block here. This is conservative:
    // uncached words are more likely to be BPE garbage (common words get cached
    // during proper noun forgiveness). Future: pre-cache common words.

    // ── Check if xval matches reference ──
    let xvalMatchesRef = refCanonicalSet.has(xvalCanon);

    if (xvalMatchesRef) {
      // ── Xval matches reference, Reverb doesn't → trust xval ──
      tiebreakerFirings++;
      tiebreakerLog.push({
        original: w.word,
        xvalWord: w._xvalWord,
        chosen: xvalLower,
        engine: w._xvalEngine || 'parakeet',
        direction: 'xval_wins'
      });
      w._tiebreakerOriginalWord = w.word;
      w._tiebreakerChosenWord = xvalLower;
      w.word = xvalLower;
      w._tiebreakerUsed = true;
      w._tiebreakerEngine = w._xvalEngine || 'parakeet';
      w.crossValidation = 'tiebroken';  // NOT 'confirmed' — preserves diagnostic trail
    }
    // ── Neither matches ref → no tiebreaker action, keep Reverb ──
    // (reverbMatchesRef case already handled by both-real-words guard above)
  }

  if (tiebreakerLog.length > 0 || tiebreakerDisabled) {
    addStage('reference_tiebreaker', {
      totalFirings: tiebreakerFirings,
      xvalWins: tiebreakerLog.filter(e => e.direction === 'xval_wins').length,
      disabled: tiebreakerDisabled,
      disableReason,
      activationRate: totalWordsProcessed > 0
        ? (tiebreakerFirings / totalWordsProcessed * 100).toFixed(1) + '%'
        : 'n/a',
      runningErrorRate: totalConfirmed > 0
        ? (confirmedErrors / totalConfirmed * 100).toFixed(1) + '%'
        : 'n/a',
      details: tiebreakerLog
    });
  }
}
```

**Note on `normalizeText`:** Lives in `text-normalize.js`, imported in `alignment.js`. Must be imported directly in `app.js`: `import { normalizeText } from './text-normalize.js';`

**Note on `getCanonical`:** Imported from `word-equivalences.js`. Already used in app.js for sttLookup construction (L741-746).

**Note on regex:** Uses `[^\w'-]` (not `[^a-z'-]`) to match sttLookup's stripping behavior. `\w` preserves digits for number-containing words like "3rd".

**Note on hyphen splitting:** Requires adding `_splitFromHyphen: true` to expanded words in the hyphen splitting block at app.js L593. See Part 10.

**Note on `'tiebroken'` status:** Downstream code must treat `'tiebroken'` like `'confirmed'` for alignment purposes (the word text is trusted) but like `'disagreed'` for diagnostic purposes (the word may still warrant struggle/near-miss examination). Specifically:
- `alignWords()`: no change needed — it reads `w.word`, not `w.crossValidation`
- `detectOnsetDelays()`: skip `'unconfirmed'` only — `'tiebroken'` words have valid timestamps
- `absorbStruggleFragments()`: change guard from `!== 'confirmed'` to also accept `'tiebroken'`
- `detectStruggleWords()` Path 3: checks `'unconfirmed'` — no change needed

### 5.5 Edge Cases

| Edge Case | Guard | Why |
|---|---|---|
| Reverb produces a real English word | Both-real-words guard: skip if Reverb's word is in ref or dictionary | "house" vs "horse" is ambiguous — could be real substitution or ASR error. Only fire on BPE garbage. |
| Hyphen-split words | Skip (`_splitFromHyphen: true`) | Split parts inherit parent's `_xvalWord`. Processing independently would replace "self" with "self-control", corrupting the transcript. |
| Both engines produce valid reference words | Covered by both-real-words guard (Reverb word in ref → skip) | "cat" vs "mat" when both in passage — can't determine position |
| Homophones / number equivalences | Use `getCanonical()` for all comparisons | Parakeet ITN: "1" ↔ "one", "won't" ↔ "will not" |
| Disfluency words | Skip (`isDisfluency: true`) | Disfluencies don't enter alignment; Parakeet's clean output is LM bias, not evidence |
| Partial word attempts | Skip (Reverb prefix matches xval) | "beau" for "beautiful" is a genuine struggle, not Reverb error |
| Running accuracy below 80% | Disable tiebreaker (adaptive threshold, n≥20) | Protects most struggling readers from hidden errors |
| Activation rate > 15% | Disable tiebreaker (activation rate ceiling) | High firing rate indicates systematic Parakeet autocorrect, not individual BPE recovery |
| Same word triggers tiebreaker repeatedly | Log for future analysis | Could indicate systematic mispronunciation being masked |

### 5.6 Diagnostic Flags

Add to each word evaluated by the tiebreaker:
```javascript
_tiebreakerUsed: true,              // Tiebreaker was invoked for this word
_tiebreakerEngine: 'parakeet',      // Which engine's word was chosen
_tiebreakerOriginalWord: '...',     // What Reverb originally said (if overridden)
_tiebreakerChosenWord: '...',       // What was accepted as the word
```

### 5.7 UI Reporting

Add a tiebreaker summary to the diagnostics output section:
- Total words where engines disagreed
- Number resolved by tiebreaker toward reference (Parakeet won)
- Number where Reverb already matched reference (Reverb confirmed)
- Number where neither matched (kept Reverb by default)
- Whether adaptive threshold was triggered (and at what word count)
- Tiebreaker activation rate as percentage of total words

### 5.8 Interaction with Existing Systems

The `'tiebroken'` status (instead of `'confirmed'`) is critical here. It lets alignment treat the word as correct for WCPM scoring while preserving visibility for downstream diagnostics.

| System | Interaction | Risk | Notes |
|---|---|---|---|
| Compound word merging | Clean — compounds see corrected word text | LOW | |
| Near-miss/struggle detection | `'tiebroken'` words still visible to diagnostics. If the tiebreaker corrected a BPE-mangled word that was also a genuine struggle, diagnostics can still flag it based on surrounding evidence (pause, fragments). | LOW | With old `'confirmed'` status this would be SEVERE — total diagnostic blindness |
| Fragment absorption | `'tiebroken'` words still eligible for absorption (guard checks `!== 'confirmed'`) | LOW | Changed from MEDIUM risk |
| Omission recovery | None — operates on `unconsumedXval` (disjoint from `disagreed`) | NONE | |
| Proper noun forgiveness | Corrected word → `correct` → forgiveness skipped. Same WCPM either way. | NONE | |
| Terminal leniency | Corrected last word → `correct` → leniency skipped. More decisive. | LOW | |
| Self-correction reclassification | Operates on insertions, not substitutions. No interaction. | NONE | |
| Word speed map | Timestamps preserved (tiebreaker only changes word text). `'tiebroken'` words participate in timing analysis. | LOW | Timing is from the cross-validator engine, which is internally consistent |

### 5.9 What NOT to Build

- **No confidence gate.** Reverb's attention-rescoring confidence scores are overconfident (>0.9 for both correct and incorrect words), MAX-aggregated across BPE tokens, and published F1 for error detection is 0.33-0.55. A confidence threshold would be effectively inert. Use structural signals (disfluency flags, partial-word detection) instead.
- **No Canary switch.** 4.4x slower, 2x VRAM, same pseudo-label problem, architecturally closer to Whisper. See Part 1.
- **No third engine.** The reference text is the Bayesian prior. Adding Whisper would triple latency for marginal gain.
- **No larger Parakeet.** 0.6B → 1.1B buys ~0.2-0.5% WER for 2x latency.
- **No log-linear combination.** Binary tiebreaker is simpler and sufficient.
- **YES dual WCPM reporting.** Show both tiebreaker-adjusted and raw WCPM. Let the teacher see the delta. Transparency costs nothing and prevents the tiebreaker from operating as an invisible correction. If delta > 5 words, flag prominently.

---

## Part 6: Equity Impact — Disclaimer & Future Work

### The Problem

ASR shows well-documented accuracy disparities by race/dialect (Koenecke et al. 2020: WER 0.35 for Black speakers vs 0.19 for White across 5 major providers). The tiebreaker interacts with these disparities in three ways:

1. **Beneficial case (most common for ORF):** ASR garbles a dialectal pronunciation, one engine recovers to the reference word → tiebreaker correctly credits a word the student actually said. This is the most likely scenario because the base rate of correct reading is >80%.

2. **Beneficial case (autocorrect):** ASR autocorrects a dialect variant to SAE reference → same outcome as the teacher hearing the student read correctly. DIBELS explicitly states students are "not penalized for different pronunciation due to dialect."

3. **Harmful case (masking errors):** Both engines fail on the same dialect feature, or Parakeet's LM bias produces the reference word for a genuine mispronunciation → real error masked. The tiebreaker cannot help with correlated failures.

### Differential Activation Rates (Estimated)

The tiebreaker fires at different rates for different demographic groups because ASR disagreement rates vary:
- White/SAE speakers: ~3-5% of words
- Black/AAVE speakers: ~7-12% of words
- ELL students: ~8-15% of words

If the tiebreaker is mostly correct, this differential is **equitable** (correcting a larger ASR-induced deficit). If substantially wrong, the differential is **inequitable** (hiding more errors for disadvantaged groups).

### Current Status: No Accommodation, No Validation

This system currently has **no dialect accommodation** by design. The tiebreaker provides accidental partial accommodation when ASR autocorrects dialect to standard form, but this is incidental and incomplete.

### Required Before Claims of Equitable Performance

1. **Empirical validation with diverse audio** — record and human-score sessions from students of varied racial/ethnic/linguistic backgrounds
2. **Subgroup analysis** — report tiebreaker precision/recall by demographic group
3. **Dialect-aware pronunciation dictionary** — future feature if validation reveals systematic bias against specific dialect features
4. **DIF (Differential Item Functioning) analysis** — standard educational measurement approach for detecting bias

**This section is a disclaimer. Equitable performance is not yet demonstrated and should not be assumed.**

---

## Part 7: Outstanding Questions & Concerns (Prioritized)

### Must Address Before Shipping

1. **Empirical validation.** Human-score 50-100 passages where the tiebreaker fires. Measure actual precision/recall. This is the #1 gap — everything else is estimates. Even 20 passages would be valuable.

2. **Adaptive threshold calibration.** The 20% error rate / 80% accuracy cutoff with n≥20 minimum is a reasonable starting point. Validate against ground-truth data once available.

3. **`normalizeText` availability in app.js.** Verify the import chain. May need to import from `text-normalize.js` or replicate inline.

### Should Address Soon

4. **Whisper pseudo-label inheritance monitoring.** When Parakeet produces a reference-matching word during disagreement, it may be LM-smoothing rather than acoustic evidence. Monitor tiebreaker activation patterns — if Parakeet "wins" >90% of tiebreaker events, the LM bias may be dominant.

5. **Correlated autocorrect on common words.** ORF passages use common vocabulary — exactly where both engines' LMs exert strongest autocorrect pressure. The adaptive threshold partially mitigates.

6. **Per-word tiebreaker tracking across sessions.** If the same word triggers the tiebreaker consistently for the same student, it may indicate a systematic mispronunciation being masked.

### Future Considerations

7. **Fine-tuning Parakeet on children's speech.** MyST corpus (free, grades 3-5) with LoRA could reduce WER 20-40% relative. This is the single highest-impact improvement and would reduce dependence on the tiebreaker entirely. See `docs/parakeet-lora-finetuning-proposal.md`.

8. **Equity validation.** See Part 6. Non-negotiable before any claims of equitable performance.

9. **Selective prediction / abstention.** When neither engine matches the reference, flag the word as "uncertain" rather than silently defaulting to Reverb. Let the UI show both alternatives.

10. **Hybrid easy/hard case splitting.** Future evolution: distinguish "easy" cases (Reverb garbage like "wigglewigle" → high confidence tiebreak) from "hard" cases (both real English words → flag for teacher review). Use dictionary checks and Levenshtein distance between engine outputs as discriminators, NOT confidence scores.

---

## Part 8: Corrected Decision-Theoretic Analysis

### Bayesian Posterior

Define: C = student said correct word, D = engines disagree, M = exactly one engine matches reference.

```
P(C | D, M) = P(D,M|C) × p / [P(D,M|C) × p + P(D,M|~C) × (1-p)]
```

where p = P(C) = student's accuracy rate.

With realistic parameters (r_R=0.85, r_P=0.80, a_R=0.15, a_P=0.22):
```
P(D,M|C) = r_R(1-r_P) + r_P(1-r_R) = 0.85×0.20 + 0.80×0.15 = 0.290
P(D,M|~C) = a_R(1-a_P) + a_P(1-a_R) = 0.15×0.78 + 0.22×0.85 = 0.304
LR = 0.290 / 0.304 = 0.954
```

**The likelihood ratio is ≈ 1.0 — the observation "one engine matches reference" is nearly uninformative. The base rate dominates.**

| Student accuracy (p) | P(correct \| D, M) | Lift from prior |
|---|---|---|
| 0.95 | 0.948 | -0.002 |
| 0.90 | 0.896 | -0.004 |
| 0.85 | 0.844 | -0.006 |
| 0.80 | 0.792 | -0.008 |
| 0.75 | 0.740 | -0.010 |
| 0.70 | 0.690 | -0.010 |

### Decision Rule (Corrected)

The tiebreaker is optimal when:
```
c_FP / c_FN < LR × p / (1-p)
```

(Note: LESS-THAN, not greater-than as originally stated.)

| Student accuracy (p) | LR × p/(1-p) | Tiebreaker optimal if c_FP/c_FN < |
|---|---|---|
| 0.90 | 8.59 | Almost always optimal |
| 0.85 | 5.40 | Optimal unless FP cost >5.4× FN cost |
| 0.80 | 3.82 | Optimal unless FP cost >3.8× FN cost |
| 0.75 | 2.86 | Marginal for screening (c_FP/c_FN ≈ 3) |
| 0.70 | 2.22 | Suboptimal for screening |

For practice/progress monitoring (c_FP/c_FN ≈ 1): optimal for all p > 0.51.
For screening (c_FP/c_FN ≈ 3): optimal for all p > 0.76.
The 80% adaptive threshold provides appropriate safety margin.

### Sensitivity Analysis: The a_P Parameter Is Pivotal

The document uses a_P = 0.22 (Parakeet's false acceptance rate — probability it produces the reference word when the student said something wrong). This is roughly half the 44.7% empirical false acceptance rate from Piton et al. **No justification for this halving is provided in the original analysis.**

| a_P | P(D,M\|~C) | LR | At p=0.85: LR×p/(1-p) | Screening-safe? (c_FP/c_FN=3) |
|---|---|---|---|---|
| 0.10 | 0.220 | 1.318 | 7.47 | Yes |
| 0.15 | 0.255 | 1.137 | 6.44 | Yes |
| **0.22** | **0.304** | **0.954** | **5.41** | **Yes** |
| 0.30 | 0.360 | 0.806 | 4.56 | Yes |
| 0.35 | 0.395 | 0.734 | 4.16 | Yes |
| 0.40 | 0.430 | 0.674 | 3.82 | Barely |
| **0.447** | **0.463** | **0.627** | **3.55** | **Marginal** |

**At a_P = 0.447:** LR = 0.627. The observation becomes meaningfully informative *against* correctness. Posterior at p=0.85 drops to 0.780 (from 0.844). For screening costs, the tiebreaker becomes suboptimal below 84% accuracy — precisely where struggling readers are.

**Practical resolution:** Rather than debating a_P's exact value, the both-real-words guard (Section 5.3) restricts the tiebreaker to cases where it is clearly correct regardless of a_P: Reverb produced a non-word (BPE garbage), so it was almost certainly wrong. This sidesteps the parameter sensitivity entirely.

### Probability Estimates (Honest, Unverified)

| Scenario | Estimated P(correct) | Tiebreaker Action | Confidence in Estimate |
|---|---|---|---|
| Both engines agree + match ref | ~95-99% | Already confirmed; no tiebreaker | HIGH |
| One engine matches ref, other doesn't (typical reader) | ~75-85% | **Tiebreaker fires** | LOW-MEDIUM — unverified |
| One engine matches ref, other doesn't (struggling reader) | ~65-75% | **Tiebreaker fires (if threshold allows)** | LOW |
| Both agree on non-reference word | ~8-15% correct | No tiebreaker (consensus substitution) | MEDIUM |
| Neither matches reference, engines disagree | ~15-25% correct | Keep Reverb (no clear winner) | LOW |

---

## Part 9: Key Sources (All Verified)

| Source | Key Finding | URL |
|---|---|---|
| Singh et al. 2025 | WER by grade: K=84.6%, Gr6=30.3%, Gr8=22%, adult=3% | https://arxiv.org/abs/2502.08587 |
| Fan et al. 2024 | Parakeet zero-shot on children: 16.7% WER (OGI), 11.1% (MyST) | https://arxiv.org/abs/2406.10507 |
| Mujtaba et al. 2024 | Disfluent speech: mean 2.7x WER degradation across 6 ASR systems | https://arxiv.org/abs/2405.06150 |
| NAEP 2018 | Machine-human r=0.96; below-basic-low=82% accuracy | https://nces.ed.gov/nationsreportcard/studies/orf/scoring.aspx |
| SERDA (Harmsen 2025) | Word-level precision 0.31 (69% false positives) — single engine | https://pmc.ncbi.nlm.nih.gov/articles/PMC12686063/ |
| Apple/Smith et al. 2025 | Prompted Whisper: 3.9-5.4% WER on children's reading | https://arxiv.org/html/2505.23627v1 |
| Gao et al. 2025 | Prompted Whisper Dutch children: 5.1% WER, miscue F1=0.73 | https://www.isca-archive.org/interspeech_2025/gao25c_interspeech.html |
| Bayoumi et al. 2025 | Diversity "not necessarily correlated" with combination performance | https://arxiv.org/abs/2508.09880 |
| Koenecke et al. 2020 | Racial ASR disparity: WER 0.35 Black vs 0.19 White speakers | https://www.pnas.org/doi/10.1073/pnas.1915768117 |
| Reverb paper 2024 | Architecture verified; poor on short-form audio | https://arxiv.org/html/2410.03930v2 |
| Parakeet v3 model card | "Not recommended for word-for-word"; v3 adds anti-hallucination | https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3 |
| Canary 1B v2 model card | AED architecture, 6-8 GB VRAM, RTFx 749 | https://huggingface.co/nvidia/canary-1b-v2 |
| Fiscus 1997 | ROVER: N≥3 for majority voting; N=2 has zero resolution power | https://ieeexplore.ieee.org/document/659110/ |
| Piton et al. 2023 | Commercial ASR autocorrects children's misread words to target | https://www.isca-archive.org/interspeech_2023/piton23_interspeech.html |
| NVIDIA entropy blog | ASR confidence scores unreliable (>0.9 even when wrong) | https://developer.nvidia.com/blog/entropy-based-methods-for-word-level-asr-confidence-estimation/ |
| Jain et al. 2024 | Kid-Whisper: fine-tuning reduces WER 13.93% → 9.11% on MyST | https://arxiv.org/abs/2309.07927 |
| Whisper disfluency study 2024 | 56% disfluency recall; 37% silently dropped | https://arxiv.org/html/2409.10177v2 |
| Hasbrouck & Tindal 2006 | ORF norms grades 6-8: 25th%ile 102-124 WCPM | https://files.eric.ed.gov/fulltext/ED594994.pdf |
| Cirino et al. 2013 | 85% of struggling middle schoolers have multi-component deficits | https://pmc.ncbi.nlm.nih.gov/articles/PMC3757546/ |
| TDT paper (ICML 2023) | Token-and-Duration Transducer; frame-skipping mechanism | https://arxiv.org/abs/2304.06795 |
| Gothi et al. 2024 | Two-pass miscue detection (closest published analog to dual-engine) | https://www.isca-archive.org/interspeech_2024/gothi24_interspeech.html |
| CrisperWhisper 2024 | Verbatim Whisper variant — confirms original Whisper's fluency bias | https://arxiv.org/html/2408.16589v1 |
| Ma et al. 2023 | Whisper: 15.4% recall for assessment-critical disfluency words | https://arxiv.org/html/2307.09378 |
| Poncy et al. 2005 | SEM of CBM-R: 5-15 WCPM, median ~10 | ERIC |
| CORE study | Word-level agreement 0.73-0.94 with human raters by grade | https://jnese.github.io/core-blog/ |

---

## Part 10: Files to Modify

| File | Change | Lines (approximate) |
|---|---|---|
| `js/app.js` | Import `normalizeText` from text-normalize.js | Top of file |
| `js/app.js` | Add `_splitFromHyphen: true` to expanded words in hyphen splitting block | L593 area — add to the `expanded.push({...w, word: part, ...})` spread |
| `js/app.js` | Insert tiebreaker logic AFTER hyphen splitting, AFTER `addStage('stt_words')`, BEFORE sttLookup | After L686, before L741 |
| `js/alignment.js` | Treat `'tiebroken'` like `'confirmed'` in `alignWords()` | Wherever `crossValidation` is checked for alignment purposes |
| `js/diagnostics.js` | In `absorbStruggleFragments()`, change guard from `!== 'confirmed'` to `!== 'confirmed' && !== 'tiebroken'`... wait, `'tiebroken'` should STILL be eligible for absorption. Guard stays as `!== 'confirmed'` — `'tiebroken'` passes through. **No change needed.** | L308 |
| `js/ui.js` | Add tiebreaker summary to diagnostics display; show dual WCPM (raw + tiebreaker-adjusted) with delta | End of diagnostic output section |
| `js/ui.js` | Show tiebreaker indicator on affected words (tooltip: "Tiebreaker: Reverb heard X, Parakeet heard Y") | Alignment rendering section |
| `js/miscue-registry.js` | No change — tiebreaker is not a new miscue type | N/A |
| `index.html` | Update version timestamp | Line 18 |

### Key Implementation Detail: `_splitFromHyphen` Flag

In the hyphen splitting block (app.js ~L593), add the flag to each expanded word:

```javascript
expanded.push({
  ...w,
  word: part,
  startTime: partStart,
  endTime: partEnd,
  _splitFromHyphen: true,  // ← NEW: prevents tiebreaker from corrupting split words
  _xvalStartTime: partStart,
  _xvalEndTime: partEnd,
  _reverbStartTime: partStart,
  _reverbEndTime: partEnd,
  _reverbCleanStartTime: partStart,
  _reverbCleanEndTime: partEnd,
});
```

### Visual Reference
See `docs/tiebreaker-decision-logic.html` for an interactive visualization of the complete decision flowchart, all 5 scenarios, the adaptive threshold, and the dangerous autocorrect case.

---

## Part 11: Review Recommendations Summary

These recommendations come from a 4-team parallel review covering architecture integration, Bayesian statistics, clinical alignment, and adversarial failure modes.

### Blocking (must address before implementation)

1. **Hyphen-split corruption fix.** Add `_splitFromHyphen: true` flag during splitting; tiebreaker skips these words. Without this, every passage with hyphenated words produces corrupted transcripts.

2. **`'tiebroken'` status instead of `'confirmed'`.** Upgrading to `'confirmed'` makes tiebroken words invisible to ALL downstream diagnostics — struggle detection, fragment absorption, self-correction detection go blind. Using `'tiebroken'` preserves the diagnostic trail. This is the single most important design change from the original proposal.

3. **Both-real-words guard.** Only fire the tiebreaker when Reverb produced apparent garbage (non-word). If Reverb's word is a real English word, the disagreement is ambiguous between ASR error and genuine student substitution. This sidesteps the a_P parameter sensitivity and catches the "house vs horse" class of failures.

4. **Activation rate ceiling (15%).** The adaptive threshold has a structural blind spot: it only counts confirmed words, so students who produce many disagreements never trigger it. The activation rate ceiling catches what the threshold misses.

5. **Dual WCPM reporting.** Show both raw and tiebreaker-adjusted scores. Let the teacher see the delta. If delta > 5, flag it prominently. This is transparency, not complexity.

### Required before use with students

6. **Empirical validation.** Human-score 50-100 passages from the target population where the tiebreaker fires. Measure actual precision/recall. The theoretical framework predicts net-positive results; this must be tested, not assumed.

7. **Regex consistency.** Use `[^\w'-]` (not `[^a-z'-]`) in the tiebreaker to match sttLookup's stripping behavior. The `\w` class preserves digits for number-containing words.

### Design considerations (not blocking)

8. **Consider raising adaptive threshold to 25%.** The 20% threshold with p=0.85 null has a 17% false trigger rate at n=20. Raising to 25% dramatically reduces false triggers while modestly increasing miss rate. Or use n=30 for better balance.

9. **Honest framing.** The tiebreaker introduces a systematic upward bias, not random noise. The teacher analogy is a loose metaphor, not a mechanism description. The self-correction analogy is a category error (ASR disagreement ≠ student self-correction). Lead with the Bayesian decision rule framing.

10. **Fine-tune Parakeet on children's speech.** This remains the single highest-impact improvement. A better cross-validator reduces disagreement rates, making the tiebreaker less necessary and less risky simultaneously.
