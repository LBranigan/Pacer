# Hybrid Forced Alignment with CTC Acoustic Verification — Implementation Plan

**Date:** 2026-02-16 (updated 2026-02-16)
**Status:** Prototype-first — Phase 1 is a GO/NO-GO gate before any pipeline integration
**Depends on:** Kitchen Sink pipeline (V1/V0/Parakeet), NW alignment (alignment.js), word speed map (diagnostics.js)
**Affects:** `server.py` (new endpoint), `app.js` (pipeline integration), `diagnostics.js` (new features), `ui.js` (display), debug JSON

---

## Honest Summary: What This Can and Cannot Do

### What this adds

This plan adds a **4th independent signal** to PACER's pipeline: CTC forced alignment using wav2vec2, a completely different model architecture from Reverb (WeNet) or Parakeet (FastConformer). It provides two things the current pipeline lacks:

1. **Per-word acoustic confidence scores** — a 0.0-1.0 measurement of how well the audio physically matches each expected word. This is direct acoustic evidence, not an ASR engine's guess about what was said.

2. **Dual-hypothesis acoustic testing** — for disputed words, compute `P("faced" | audio)` vs `P("face" | audio)` using the CTC forward algorithm on the same emission matrix. This measures whether a specific phoneme (like the /d/ in "faced") is physically present in the audio. One forward pass through wav2vec2, then test unlimited hypotheses at near-zero cost.

### What this can do (with confidence)

- **Resolve the inflection-dropping ambiguity** ("faced" vs "face", "tried" vs "try") with actual acoustic evidence instead of guessing between text transcripts
- **Verify filler classifications** ("um" vs "one") by comparing CTC probabilities for each hypothesis against the same audio
- **Verify fragment reality** — determine whether V1's reported fragments (during sounding-out) correspond to real speech or are BPE tokenization artifacts
- **Provide ~20ms-precision timestamps** from an independent model, improving pause measurement beyond Reverb's 100ms quantization
- **Detect omission false positives** — find cases where the student spoke a word but both ASR engines missed it (acoustic score for the reference word is moderate-to-high despite engines reporting an omission)

### What this cannot do (be honest about limitations)

- **Not a silver bullet for children's speech.** Cao et al. (Interspeech 2023) showed that acoustic confidence distributions are significantly wider for children than adults. Absolute scores like "0.72" don't mean the same thing for a 7-year-old as for an adult. The dual-hypothesis COMPARISON (which is right, not how right) is more robust than absolute thresholds.
- **Single-phoneme resolution is noisy.** The difference between "face" and "faced" is one phoneme (~50ms, 2-4 frames). The signal is real but thin — and wav2vec2-base (95M params, trained on adult Librispeech) may not have enough capacity to resolve it on children's speech. For longer differences ("platforms" vs "plat"), confidence is much higher. **Phase 1 must validate that the signal exists for single-phoneme pairs before committing to pipeline integration.**
- **Cannot replace disfluency detection.** This tool does not classify disfluency types (fillers, repetitions, false starts). The V1/V0 dual-pass comparison remains the primary disfluency signal.
- **Cannot generate hypotheses.** This only VERIFIES hypotheses that V1 and Parakeet already produced. It cannot detect words that no engine heard.
- **Frame windowing imprecision.** Dual-hypothesis testing requires knowing the time window for the disputed word. Those timestamps come from Reverb (100ms quantized) or Parakeet. If the window is off by a few frames, phoneme-level signals degrade. A ±100ms buffer helps but adds noise from neighboring words.
- **Viterbi alignment drift.** The full-sequence forced alignment uses Viterbi decoding across the entire utterance. If the hybrid text contains a wrong word (V1 hallucination, compound not properly expanded), the Viterbi path shifts to compensate, **distorting timestamps and scores for neighboring words**. This is not a localized error — it cascades. Careful hybrid text construction is critical.
- **Calibration required.** The `_ctcDelta` threshold for artifact-vs-genuine decisions is initially arbitrary. CTC loss values scale with character count, so the threshold may need per-character normalization. It needs empirical tuning on labeled data from your actual recordings. Until calibrated, all acoustic scores should be advisory (displayed in tooltips and debug) but should NOT change WCPM scoring.

### What the research says

This hybrid approach (free-form ASR + reference-anchored forced alignment) is well-supported:

- **Apple (Smith et al., Interspeech 2025)**: Post-hoc alignment of ASR output to reference — the architecture PACER uses — OUTPERFORMS end-to-end miscue detection. Validates PACER's overall design.
- **IIT Bombay (Gothi et al., Interspeech 2024)**: Features derived from the discrepancy between reference-constrained and free-form decodings are highly informative for miscue detection. This is precisely what the dual-hypothesis test provides — the most directly relevant citation.
- **Molenaar et al. (Interspeech 2023)**: Forced decoding confidence scores correlate with word correctness (MCC = 0.63, r = 0.45). The signal is real but not perfect.
- **SRI FLORA (Bolanos et al., 2011-2013)**: The foundational ORF system achieved WCPM within 3-4 words of human scorers using reference-constrained ASR.
- **Cao et al. (Interspeech 2023)**: Acoustic confidence scores are less reliable for children. Use relative comparisons (hypothesis A vs B), not absolute thresholds.

---

## The Problem from First Principles

### What PACER cannot currently answer

PACER's 3-engine consensus tells you WHAT was spoken (Reverb V1, V0, Parakeet all produce text). But it cannot answer:

1. **"Did the student really say 'face' or 'faced'?"** — When both Reverb and Parakeet agree on "face" for reference "faced", is it a genuine error or are both CTC/TDT engines systematically dropping the final /d/? There is no way to know from text alone. The difference is a ~50ms phoneme.

2. **"Was that really 'um' or 'one'?"** — Reverb sometimes decodes children's filled pauses ("um" at ~300Hz) as function words ("one", "on", "a"). V1/V0 diff suggests disfluency, but there's no independent acoustic verification.

3. **"How confident should we be in each fragment?"** — When V1 reports syllable fragments during a sounding-out attempt ("e" + "nor" + "enormous"), we don't know if those fragments genuinely match the audio or are BPE artifacts. V1's confidence scores are unreliable (high confidence even on wrong words).

4. **"What are the real pause durations between attempts?"** — Reverb's 100ms BPE timestamp quantization (WeNet `g_time_stamp_gap_ms = 100`) means all single-token words show ~100ms duration. Sub-100ms hesitation pauses are invisible. Parakeet timestamps are better but only available for words Parakeet detected.

### Why this matters — honest prevalence assessment

These problems are real but **prevalence is not yet measured**. Estimates based on pipeline observation:

- **Inflection dropping** (faced→face, tried→try, others→other) is a SYSTEMATIC error in both CTC and TDT architectures. We believe it affects ~3-5% of words but **this has not been validated on a labeled dataset**. The `diagnostics.js` morphological error detector explicitly skips single-character differences (`if (diffLen <= 1) continue`), which is exactly this case. The NW graded alignment correctly aligns these (levenshteinRatio("face","faced") = 0.80) but marks them as substitutions. The 3-way verdict confirms them as errors when both engines agree.

- **Filler misclassification** — V1/V0 diff already handles the primary case (V1 hears "one", V0 suppresses it → classified as disfluency). Acoustic verification would provide independent confirmation but is partially redundant with the existing V1/V0 mechanism. Main value: cases where V1/V0 diff is ambiguous.

- **Fragment verification** — existing guards (temporal containment ±150ms, `isNearMiss` prefix/suffix check, CTC artifact filter ≤120ms) handle most BPE noise. Acoustic scores would add a stronger signal but are not the first line of defense.

- **Hesitation timing** — Parakeet is already the primary timekeeper (`_xvalStartTime`/`_xvalEndTime`). The 100ms quantization problem is specific to Reverb timestamps on single-BPE-token words. A 3rd timestamp source helps most for words Parakeet didn't detect (unconfirmed words, which the system already skips in gap calculations).

### What's missing: independent acoustic evidence

All three current engines (Reverb V1, V0, Parakeet) output WORDS. None expose per-frame acoustic probabilities. Reverb gives word-level confidence (unreliable). Parakeet gives confidence=1.0 always. V0 gives word-level confidence (same model as V1, same biases).

CTC forced alignment with a wav2vec2-based model provides exactly this missing signal: **frame-level emission probabilities for each character**, from a completely independent model architecture (wav2vec2 Transformer, trained on different data with different objectives than either Reverb or Parakeet).

---

## The Key Insight: Hybrid Alignment Text

### Why plain forced alignment fails on disfluent speech

Standard forced alignment takes audio + text and finds where each word occurs. If you force-align the **reference text** against disfluent audio, it fails:

```
Reference:  "The enormous elephant"          (3 words)
Audio:      "the... um... e-nor... uh... enormous elephant"  (7+ segments)
```

The aligner must stretch 3 words across 7 segments. It produces garbage timestamps and meaningless scores because the aligner doesn't know about the fillers and fragments.

### The hybrid approach: reference + V1 insertions

PACER's V1 alignment already tells us WHAT is in the audio (including insertions, fillers, and fragments). We construct a **hybrid alignment text** that includes reference words plus V1's detected insertions in their aligned positions:

```
Hybrid:     "the um e nor uh enormous elephant"   (7 words)
Audio:      "the... um... e-nor... uh... enormous elephant"  (7 segments)
```

Now the forced aligner can find all 7 segments because it knows what to look for. V1 provides the **map**. The forced aligner provides **independent acoustic verification** of each point on that map.

### Critical requirement: expanding merged entries

The alignment array contains merged entries (compounds, abbreviation expansions, number expansions) where multiple spoken words have been collapsed into a single entry. The hybrid text must **expand these back into individual words**, because the forced aligner operates on the character sequence and needs to know about word boundaries. See `buildHybridText()` in the Implementation section for details.

### What this produces per word/fragment

For each token in the hybrid text, the forced aligner returns:

| Field | Meaning | Example |
|-------|---------|---------|
| `startTime` | Where this token begins in the audio (~20ms precision) | 0.52s |
| `endTime` | Where this token ends | 0.71s |
| `score` | Mean CTC frame probability that this audio matches this text | 0.86 (high match) |
| `charScores[]` | Per-character CTC probabilities | [{char: 'u', score: 0.91}, {char: 'm', score: 0.88}] |

---

## The Dual-Hypothesis CTC Trellis Test

### Why this replaces traditional GOP

Traditional Goodness of Pronunciation (GOP) is a Kaldi-era metric that computes per-phoneme log-likelihood ratios using GMM-HMM forced alignment. It's outdated for three reasons:

1. **GMM acoustic models** are far less accurate than modern neural CTC models
2. **Per-phoneme independence** ignores sequence context
3. **Absolute thresholds** are unreliable for children's speech (Cao et al., 2023)

The modern replacement: use the **CTC emission matrix** directly. One forward pass through wav2vec2 produces a `(T frames x C characters)` probability grid. Then use `torch.nn.functional.ctc_loss` (the CTC forward algorithm) to compute the **total sequence probability** for competing hypotheses — summing over ALL possible alignments, not just the best one (Viterbi).

### How it works

```python
# One forward pass — computed ONCE, reused for ALL hypotheses
with torch.inference_mode():
    emission, _ = wav2vec2_model(waveform)  # (1, T, C) log-prob grid

# For a disputed word, extract the time window from existing timestamps
start_frame = int(start_time * frames_per_second)
end_frame = int(end_time * frames_per_second)
word_emission = emission[:, start_frame:end_frame, :]  # just this word's frames

# Test hypothesis A: "face" → [f, a, c, e]
tokens_a = encode("face")
loss_a = torch.nn.functional.ctc_loss(
    word_emission.transpose(0, 1), tokens_a,
    input_lengths=torch.tensor([end_frame - start_frame]),
    target_lengths=torch.tensor([len(tokens_a)])
)

# Test hypothesis B: "faced" → [f, a, c, e, d]
tokens_b = encode("faced")
loss_b = torch.nn.functional.ctc_loss(
    word_emission.transpose(0, 1), tokens_b,
    input_lengths=torch.tensor([end_frame - start_frame]),
    target_lengths=torch.tensor([len(tokens_b)])
)

# Lower loss = higher probability = better acoustic match
# loss_b < loss_a means "faced" is more probable than "face"
delta = loss_a.item() - loss_b.item()  # positive = ref "faced" wins
```

### Why this is better than running forced alignment twice

1. **One forward pass.** The emission matrix is computed once (~1-2s for 60s audio). Testing each hypothesis against it costs microseconds (just matrix indexing + dynamic programming).
2. **Full forward algorithm.** `ctc_loss` sums over ALL possible alignments through the trellis. Viterbi (what `forced_align` uses) only finds the single best path. The forward algorithm gives the true marginal probability P(text | audio).
3. **Relative comparison.** You don't need absolute thresholds. You just compare: `P("faced" | audio) > P("face" | audio)?` This is more robust for children's speech than absolute scores.
4. **Unlimited hypotheses.** You could test "face", "faced", "facing", "faces" all against the same emission window if needed. Each test is near-free.

---

## Concrete Use Cases

### Use Case 1: Inflection Tiebreaker ("face" vs "faced")

Both Reverb and Parakeet output "face" for reference "faced".

**Current system:** Both engines agree → `crossValidation: 'confirmed'` → scored as substitution. The NW graded scoring gives this a low penalty (-0.30, since levenshteinRatio = 0.80) but it is still classified as `type: 'substitution'`. The morphological error detector skips it (`diffLen <= 1`). Post-struggle leniency doesn't help (Parakeet also says "face", so `crossValidation` is 'confirmed', not 'disagreed'). **No existing mechanism can resolve this.**

**With CTC trellis test:**

```
CTC forward on disputed window:
  P("face"  | audio) = loss 12.3
  P("faced" | audio) = loss 10.8  <- lower loss = higher probability

  Delta: 1.5 log-prob units in favor of "faced"
  -> Audio genuinely contains the /d/ suffix
  -> Both engines dropped it (shared CTC/TDT artifact)
  -> Child said the right word
```

Or, for a genuine student error:

```
  P("face"  | audio) = loss 10.2  <- lower loss = "face" wins
  P("faced" | audio) = loss 14.7

  Delta: -4.5 in favor of "face"
  -> Audio does NOT contain the /d/
  -> Child genuinely said "face" — real inflection error
```

The delta magnitude is itself informative: large delta = clear evidence, small delta = genuinely ambiguous.

**Caveat:** This is the primary use case but also the hardest. The /d/ in "faced" is ~50ms of audio and 1 character. wav2vec2-base (95M params, adult speech) may not resolve this on children's speech. Phase 1 must test this specifically. If the delta distributions for known-artifact vs known-genuine cases overlap significantly, this use case fails, and the plan should be reconsidered.

**Impact:** If validated, directly resolves the inflection-dropping false positive. No other approach in the current pipeline can answer this question with acoustic evidence.

### Use Case 2: Filler Verification ("um" vs "one")

V1 decoded "one" as an insertion. V0 did not include it. Current V1/V0 diff classifies it as a disfluency.

**Current system:** The V1/V0 diff already handles the primary case well — "one" in V1 but absent in V0 → classified as disfluency. The disfluency filter strips fillers before NW alignment and re-injects them as insertions with `_preFilteredDisfluency: true` (alignment.js lines 732-752).

**With CTC trellis test (additional confirmation):**

```
  P("um"  | audio segment) = loss 2.1  <- much lower = "um" wins
  P("one" | audio segment) = loss 8.7

  Delta: 6.6 — strong acoustic evidence for "um"
  -> The child said a filler, Reverb mapped it to nearest real word
```

**Honest assessment:** This is partially redundant with V1/V0 diff. Main value is for ambiguous cases where V1 and V0 disagree about whether a word is real vs. disfluent. Likely the easiest use case to validate (fillers vs function words have very different acoustic signatures).

### Use Case 3: Fragment Verification (Sounding Out)

V1 reports "e" + "nor" as insertions before "enormous". Are these genuine syllable-level attempts?

**Current system:** Temporal containment (±150ms via `absorbMispronunciationFragments`), near-miss checking (`isNearMiss` requires prefix/suffix ≥3 chars or Levenshtein ≥0.4), and CTC artifact filter (≤120ms overlapping tokens) already provide multiple guard layers.

**With hybrid forced alignment (full-sequence, not dual-hypothesis):**

```
"e"   -> 0.85-0.98s, score = 0.72  <- audio has an /i/ sound here
"nor" -> 1.01-1.24s, score = 0.65  <- audio has /nor/ here
```

vs. BPE artifact:

```
"e"   -> 0.85-0.91s, score = 0.15  <- no clear vowel at this position
"nor" -> 0.91-0.98s, score = 0.12  <- audio doesn't match
```

**Caveat:** Single-character fragments ("e") have very few frames to score against. Scores will be noisy. This adds a supporting signal to existing guards rather than replacing them.

### Use Case 4: Precise Hesitation Timing

**Current system:** Parakeet is already the primary timekeeper (`_xvalStartTime`/`_xvalEndTime`). The system already works around Reverb's 100ms limitation — `detectOnsetDelays` in diagnostics.js skips unconfirmed words because their Reverb timestamps are unreliable.

**With forced alignment:** Adds a 3rd timestamp source at ~20ms precision. Main value is for words where Parakeet didn't provide timestamps (unconfirmed words, currently skipped in gap calculations).

**Honest assessment:** Marginal improvement over Parakeet timestamps for most words. The system's hesitation thresholds (500ms minimum, 1200ms at sentence boundaries) are well above 100ms quantization. Sub-100ms precision is not currently actionable.

### Use Case 5: Pronunciation Quality on "Correct" Words

For the ~80% of words where all engines agree the word is correct, the forced aligner provides an acoustic quality score.

```
"beautiful" -> score = 0.94 (crisp, confident pronunciation)
"beautiful" -> score = 0.61 (garbled but recognizable — engines called it correct but it was effortful)
```

**Caveat:** Standard ORF assessment does not measure pronunciation quality — only accuracy, rate, and prosody. This is a novel metric with no established norms and uncertain educational value. Cao et al. (2023) showed absolute scores are unreliable for children; compare to the student's own median (relative scoring), not to a fixed threshold.

**Impact:** Interesting diagnostic data for the downstream AI narrative ("this word was technically correct but effortful"). But **defer implementing until Use Case 1 is validated** — this is a nice-to-have, not a must-have.

---

## Architecture

### Pipeline Position

```
Audio Blob
  |
  +-> Kitchen Sink (existing: Reverb V1+V0, Parakeet)
  |     +-> transcriptWords, xvalRawWords, reverbCleanWords
  |
  +-> NW Alignment (existing: 3 independent alignments)
  |     +-> alignment[], v0Alignment[], parakeetAlignment[]
  |
  +-> 3-Way Verdict (existing: crossValidation status per word)
  |     +-> confirmed/disagreed/unconfirmed/recovered
  |
  +-> *** HYBRID FORCED ALIGNMENT (NEW) ***
  |     |
  |     |  Step 1: Build hybrid text from alignment array
  |     |          (expand compounds, abbreviations, numbers to individual words)
  |     |  Step 2: Full-sequence forced alignment -> per-token scores + timestamps
  |     |  Step 3: CTC trellis hypothesis testing for disputed words
  |     |          (reuses emission matrix from step 2 -- near-zero extra cost)
  |     |
  |     +-> Acoustic scores + precise timestamps mapped onto alignment entries
  |
  +-> Filler classification, CTC artifact flagging, omission recovery, etc. (existing)
  |
  +-> Diagnostics (existing + enhanced)
  |     +-> struggle detection, word speed, pause analysis (now with acoustic scores)
  |
  +-> UI (existing + enhanced)
        +-> acoustically-informed tooltips
```

### Why this position in the pipeline

The hybrid forced alignment runs AFTER the 3-way verdict because:
1. It needs V1's alignment to construct the hybrid text (needs insertions in position)
2. It needs the crossValidation status to know which words are disputed (for hypothesis testing)
3. Its output enriches — not replaces — the existing verdicts

It runs BEFORE filler classification and omission recovery because:
1. Those stages mutate alignment entries (changing types, splicing `transcriptWords`) — the `_ctc*` fields survive these mutations since they're stored directly on the entry objects
2. Diagnostics can use the precise timestamps for pause analysis
3. Struggle detection can use acoustic scores as evidence strength

### Ordering risk

Between the 3-way verdict and diagnostics, there are ~8 mutation stages (filler classification, CTC artifact flagging, omission recovery, near-miss resolution, fragment absorption, etc.). The `_ctc*` fields are stored directly on alignment entry objects, so in-place mutations (changing `type`, adding flags) are safe — the fields survive. But stages that change entry semantics (omission recovery changing `type` from 'omission' to 'correct', OOV reassignment changing `hyp`) mean the `_ctc*` data was computed for a different word than the entry now represents. This is acceptable because `_ctc*` data is advisory, but should be documented.

---

## Implementation

### 1. Backend: Single `/force-align` Endpoint

**File:** `services/reverb/server.py`

One endpoint that does everything: full-sequence forced alignment + dual-hypothesis testing. The emission matrix is computed once and reused.

```python
import torchaudio
import torch

# -- wav2vec2 Forced Alignment setup --
_fa_model = None
_fa_labels = None

def _load_forced_aligner():
    global _fa_model, _fa_labels
    if _fa_model is not None:
        return _fa_model, _fa_labels
    # wav2vec2-base: MIT license, 95M params, ~400MB VRAM (FP32 weights + activations)
    # For better accuracy at ~1GB VRAM, use WAV2VEC2_ASR_LARGE_960H (300M params, also MIT)
    bundle = torchaudio.pipelines.WAV2VEC2_ASR_BASE_960H
    _fa_model = bundle.get_model().to("cuda:0")
    _fa_labels = bundle.get_labels()
    return _fa_model, _fa_labels


@app.post("/force-align")
@limiter.limit("10/minute")
async def force_align_endpoint(request: Request):
    """
    Hybrid forced alignment + dual-hypothesis CTC testing.

    Input JSON:
      - audio_base64: base64-encoded audio
      - hybrid_words: list of strings (reference + V1 insertions, in order)
      - hypotheses: optional list of {index, start_time, end_time, candidates: [str]}
                    for dual-hypothesis testing on disputed words

    Output JSON:
      - alignments: [{word, start_time, end_time, score, char_scores}]
      - hypothesis_results: [{index, candidates: [{text, loss}]}]  (if hypotheses provided)
    """
    body = await request.json()
    async with gpu_lock:
        model, labels = _load_forced_aligner()
        audio_bytes = base64.b64decode(body['audio_base64'])

        # Decode audio to 16kHz mono
        waveform, sr = torchaudio.load(io.BytesIO(audio_bytes))
        if sr != 16000:
            waveform = torchaudio.functional.resample(waveform, sr, 16000)
        waveform = waveform.mean(dim=0, keepdim=True).to("cuda:0")

        # === STEP 1: Compute emission matrix (ONE forward pass) ===
        with torch.inference_mode():
            emission, _ = model(waveform)  # (1, T, C)

        # === STEP 2: Full-sequence forced alignment ===
        label_to_idx = {l: i for i, l in enumerate(labels)}
        tokens = []
        word_boundaries = []  # (start_token_idx, end_token_idx) per word
        for word in body['hybrid_words']:
            start = len(tokens)
            for char in word.upper():  # wav2vec2 uses uppercase labels
                if char in label_to_idx:
                    tokens.append(label_to_idx[char])
            end = len(tokens)
            if end > start:  # skip words that produced no valid tokens
                word_boundaries.append((start, end, word))
                tokens.append(label_to_idx.get('|', 0))  # word separator

        if tokens and tokens[-1] == label_to_idx.get('|', 0):
            tokens.pop()  # remove trailing separator

        # Run Viterbi forced alignment for timestamps + per-frame scores
        aligned, scores = torchaudio.functional.forced_align(
            emission, torch.tensor([tokens]).to("cuda:0"), blank=0
        )

        # Aggregate per-word: timestamps + scores
        frames_per_sec = 16000 / 320  # wav2vec2 hop length
        word_results = []
        for ws, we, word_text in word_boundaries:
            frame_start = None
            frame_end = None
            word_scores = []
            for frame_idx in range(aligned.shape[1]):
                tok = aligned[0, frame_idx].item()
                if ws <= tok < we:
                    if frame_start is None:
                        frame_start = frame_idx
                    frame_end = frame_idx
                    word_scores.append(scores[0, frame_idx].exp().item())  # convert log-prob to prob

            if frame_start is not None:
                word_results.append({
                    "word": word_text,
                    "start_time": round(frame_start / frames_per_sec, 3),
                    "end_time": round((frame_end + 1) / frames_per_sec, 3),
                    "score": round(sum(word_scores) / len(word_scores), 4) if word_scores else 0,
                    "char_scores": [round(s, 4) for s in word_scores]
                })
            else:
                word_results.append({
                    "word": word_text,
                    "start_time": 0, "end_time": 0,
                    "score": 0, "char_scores": []
                })

        # === STEP 3: Dual-hypothesis CTC trellis test ===
        hypothesis_results = []
        hypotheses = body.get('hypotheses', [])
        for hyp_req in hypotheses:
            start_frame = int(hyp_req['start_time'] * frames_per_sec)
            end_frame = int(hyp_req['end_time'] * frames_per_sec)
            # +/-5 frame buffer (~100ms) for timestamp imprecision
            start_frame = max(0, start_frame - 5)
            end_frame = min(emission.shape[1], end_frame + 5)
            window = emission[:, start_frame:end_frame, :]

            candidate_results = []
            for candidate_text in hyp_req['candidates']:
                cand_tokens = [label_to_idx[c] for c in candidate_text.upper()
                               if c in label_to_idx]
                if not cand_tokens or window.shape[1] < len(cand_tokens):
                    candidate_results.append({"text": candidate_text, "loss": 999.0})
                    continue

                loss = torch.nn.functional.ctc_loss(
                    window.transpose(0, 1).contiguous(),  # (T, 1, C)
                    torch.tensor([cand_tokens]),
                    input_lengths=torch.tensor([window.shape[1]]),
                    target_lengths=torch.tensor([len(cand_tokens)]),
                    reduction='mean'  # normalize by target length for cross-word comparison
                )
                candidate_results.append({
                    "text": candidate_text,
                    "loss": round(loss.item(), 4)
                })

            hypothesis_results.append({
                "index": hyp_req['index'],
                "candidates": sorted(candidate_results, key=lambda x: x["loss"])
            })

        return {
            "alignments": word_results,
            "hypothesis_results": hypothesis_results,
            "model": "wav2vec2-base-960h",
            "frames": emission.shape[1],
            "frames_per_sec": frames_per_sec
        }
```

**Key design decisions:**

1. **Single endpoint, single forward pass.** The emission matrix is computed once and reused for both full-sequence alignment AND hypothesis testing. No second model invocation.

2. **`WAV2VEC2_ASR_BASE_960H` (MIT license)**, not `MMS_FA` (CC-BY-NC-4.0). The base model is ~95M params and commercially licensable. If you need better accuracy, swap in `WAV2VEC2_ASR_LARGE_960H` (~300M params, ~1GB VRAM, also MIT). See Open Question #1.

3. **`ctc_loss` with `reduction='mean'`** for hypothesis testing. This normalizes loss by target length, making delta values comparable across word pairs of different lengths ("face"/"faced" vs "platform"/"platforms"). Without normalization, longer words would naturally have higher loss.

4. **±5 frame buffer** (~100ms) on hypothesis windows to handle timestamp imprecision from Reverb/Parakeet.

**GPU management:** Uses existing `gpu_lock` to serialize with Reverb/Parakeet. Called after ASR is complete, so no concurrent GPU contention.

**VRAM budget:**
- Reverb idle after transcription: ~2.5GB resident
- Parakeet idle after transcription: ~0.6GB resident
- wav2vec2-base inference: ~0.4GB (95M params FP32 + activations)
- Total during forced alignment: ~3.5GB (well within 12GB RTX 4070 SUPER)

**Backend dependencies:** `torchaudio` is already installed in our Dockerfile (`services/reverb/Dockerfile` line 33 — explicitly pinned alongside torch for CUDA 11.8 compatibility after NeMo install). No new packages needed. The wav2vec2-base model (~360MB) downloads on first use, cached in the existing HuggingFace cache volume.

**Latency:** Forward pass <1s for 60s audio. Hypothesis testing microseconds each. Total endpoint latency ~1-2s including audio transfer.

### 2. Frontend: API Client

**New file:** `js/forced-align-api.js`

```javascript
import { BACKEND_URL, backendHeaders } from './backend-config.js';

/**
 * Run hybrid forced alignment + optional dual-hypothesis testing.
 *
 * @param {Blob} blob - Audio blob
 * @param {string[]} hybridWords - Reference + V1 insertions in temporal order
 * @param {Array} hypotheses - Optional: [{index, start_time, end_time, candidates: [str]}]
 * @returns {Object} {alignments: [...], hypothesis_results: [...]}
 */
export async function sendToForcedAligner(blob, hybridWords, hypotheses = []) {
  const base64 = await blobToBase64(blob);
  try {
    const resp = await fetch(`${BACKEND_URL}/force-align`, {
      method: 'POST',
      headers: backendHeaders('application/json'),
      body: JSON.stringify({
        audio_base64: base64,
        hybrid_words: hybridWords,
        hypotheses
      }),
      signal: AbortSignal.timeout(15000)  // 15s timeout
    });
    return resp.ok ? resp.json() : null;
  } catch (err) {
    console.warn('[ForcedAlign] Endpoint unavailable:', err.message);
    return null;  // Graceful degradation
  }
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}
```

### 3. Pipeline Integration

**File:** `js/app.js`

After the 3-way verdict and before filler classification:

```javascript
// === STAGE: Hybrid Forced Alignment + CTC Acoustic Verification ===

const hybridResult = buildHybridText(alignment);

if (hybridResult.words.length > 0 && appState.audioBlob) {
  // Build hypothesis tests for disputed words — uses Parakeet/Reverb timestamps
  const hypotheses = buildHypothesisTests(v1Ref);

  const faResult = await sendToForcedAligner(
    appState.audioBlob,
    hybridResult.words.map(h => h.text),
    hypotheses
  );

  if (faResult) {
    // Map acoustic scores back onto alignment entries
    mapAcousticScores(alignment, hybridResult, faResult.alignments);

    // Map hypothesis test results onto disputed entries
    if (faResult.hypothesis_results) {
      mapHypothesisResults(v1Ref, faResult.hypothesis_results);
    }

    addStage('forced_alignment', {
      wordsAligned: faResult.alignments.length,
      hypothesesTested: faResult.hypothesis_results?.length || 0,
      avgScore: faResult.alignments.reduce((s, a) => s + a.score, 0) / faResult.alignments.length,
      model: faResult.model
    });
  }
}
```

#### `buildHybridText(alignment)` — the critical function

This is the highest-risk component. The alignment array contains merged entries (compounds, abbreviation expansions, number expansions, contractions) where multiple spoken words have been collapsed into a single entry. These must be expanded for the forced aligner, which needs one word per entry with `|` separators between them.

```javascript
/**
 * Build the hybrid word list for forced alignment from the V1 alignment array.
 *
 * CRITICAL: Must expand merged entries (compounds, abbreviation/number expansions)
 * back into individual spoken words. The forced aligner tokenizes each word into
 * characters separated by '|'. Multi-word hyps like "that is" would lose the space
 * (it's not in wav2vec2's label set), producing garbage alignment.
 *
 * Returns { words: [{text, source, alignIdx}], expansionMap: Map<alignIdx, range> }
 * The expansionMap tracks which hybrid word indices correspond to each alignment entry
 * so we can aggregate scores back after alignment.
 */
function buildHybridText(alignment) {
  const words = [];
  const expansionMap = new Map();  // alignIdx -> { startHybridIdx, endHybridIdx }

  for (let i = 0; i < alignment.length; i++) {
    const entry = alignment[i];

    if (entry.type === 'insertion' && entry.hyp) {
      // Include V1's insertions (fillers, fragments, extra words)
      // Disfluencies filtered before NW are re-injected here with _preFilteredDisfluency
      words.push({ text: entry.hyp, source: 'insertion', alignIdx: i });

    } else if (entry._mergedInto) {
      // Contraction: second ref word absorbed into first (e.g., "will" in "you'll")
      // The first entry already emitted the spoken form. Skip the second.
      // Copy _ctc* fields from first entry during mapAcousticScores.
      continue;

    } else if (entry.ref) {
      if (entry.type === 'omission') {
        // For omissions: include the reference word.
        // Low score = silence (true omission). Moderate score = student attempted it.
        words.push({ text: entry.ref, source: 'omission', alignIdx: i });

      } else if (entry.hyp) {
        // Compound/expansion entries: expand parts back to individual words
        if (entry.compound && entry.parts && entry.parts.length > 1) {
          const startIdx = words.length;
          for (const part of entry.parts) {
            words.push({ text: part, source: entry.type, alignIdx: i });
          }
          expansionMap.set(i, { start: startIdx, end: words.length });

        } else {
          // Regular correct/substitution: use V1's hypothesis (what was spoken)
          words.push({ text: entry.hyp, source: entry.type, alignIdx: i });
        }
      }
    }
  }

  return { words, expansionMap };
}
```

**Edge cases handled:**

| Case | Alignment entry | Hybrid text emitted |
|------|----------------|-------------------|
| Regular word | `{ref: "the", hyp: "the", type: "correct"}` | `"the"` |
| Substitution | `{ref: "faced", hyp: "face", type: "substitution"}` | `"face"` (spoken form) |
| Omission | `{ref: "the", type: "omission"}` | `"the"` (ref, to test if audio has it) |
| Insertion/filler | `{hyp: "um", type: "insertion"}` | `"um"` |
| Compound | `{ref: "everyone", hyp: "everyone", compound: true, parts: ["every", "one"]}` | `"every"`, `"one"` (two entries) |
| Abbreviation expansion | `{ref: "ie", hyp: "that is", _abbreviationExpansion: true, parts: ["that", "is"]}` | `"that"`, `"is"` (two entries) |
| Number expansion | `{ref: "2014", hyp: "twenty fourteen", _numberExpansion: true, parts: ["twenty", "fourteen"]}` | `"twenty"`, `"fourteen"` (two entries) |
| Contraction (1st entry) | `{ref: "you", hyp: "you'll", _mergedFrom: "you will", compound: true}` | `"you'll"` (one entry) |
| Contraction (2nd entry) | `{ref: "will", hyp: "you'll", _mergedInto: "you'll"}` | *(skipped — absorbed into first)* |

**Why contraction handling differs:** Contractions are the REVERSE of compounds — the student spoke ONE word ("you'll") that maps to TWO reference words. We emit the single spoken form because that's what the audio contains.

#### `buildHypothesisTests(v1Ref)`

Identifies disputed words and builds hypothesis test requests. Uses Parakeet timestamps (primary) or Reverb timestamps (fallback) for the audio window.

```javascript
function buildHypothesisTests(v1Ref) {
  const tests = [];
  for (let ri = 0; ri < v1Ref.length; ri++) {
    const entry = v1Ref[ri];
    if (!entry.ref || !entry.hyp) continue;
    const hypNorm = entry.hyp.toLowerCase().replace(/[^a-z'-]/g, '');
    const refNorm = entry.ref.toLowerCase().replace(/[^a-z'-]/g, '');
    if (hypNorm === refNorm) continue;  // same word, no dispute

    // Test disputed words: confirmed substitutions (potential shared artifact)
    // and disagreed entries (V1 wrong, Pk correct)
    const dominated =
      (entry.type === 'substitution' && entry.crossValidation === 'confirmed') ||
      entry.crossValidation === 'disagreed';

    if (!dominated) continue;

    // Timestamps: prefer cross-validator (Parakeet), fall back to Reverb
    const startTime = parseFloat(entry._xvalStartTime) || parseFloat(entry.startTime);
    const endTime = parseFloat(entry._xvalEndTime) || parseFloat(entry.endTime);
    if (isNaN(startTime) || isNaN(endTime)) continue;

    tests.push({
      index: ri,
      start_time: startTime,
      end_time: endTime,
      candidates: [hypNorm, refNorm]  // V1's word vs reference word
    });
  }
  return tests;
}
```

**Note:** Hypothesis tests use Parakeet/Reverb timestamps (available at this pipeline point), not `_ctcStart`/`_ctcEnd` (which don't exist yet — they're computed by the same API call). The ±5 frame buffer on the server side compensates for timestamp imprecision.

#### `mapAcousticScores(alignment, hybridResult, faAlignments)`

Maps the forced alignment output back onto the alignment entries. Handles expanded compounds by aggregating scores across their parts.

```javascript
function mapAcousticScores(alignment, hybridResult, faAlignments) {
  const { words, expansionMap } = hybridResult;

  // First pass: map 1:1 entries
  for (let i = 0; i < words.length && i < faAlignments.length; i++) {
    const hw = words[i];
    const fa = faAlignments[i];

    // Skip expanded entries — handled in second pass
    if (expansionMap.has(hw.alignIdx)) continue;

    const entry = alignment[hw.alignIdx];
    entry._ctcScore = fa.score;
    entry._ctcStart = fa.start_time;
    entry._ctcEnd = fa.end_time;
    entry._ctcCharScores = fa.char_scores;

    if (entry.type === 'omission' && fa.score > 0.4) {
      entry._ctcSuggestsAttempt = true;
    }
  }

  // Second pass: aggregate expanded compound/expansion entries
  for (const [alignIdx, range] of expansionMap) {
    const entry = alignment[alignIdx];
    const partResults = faAlignments.slice(range.start, range.end);
    if (partResults.length === 0) continue;

    // Score = average across parts
    const scores = partResults.map(p => p.score).filter(s => s > 0);
    entry._ctcScore = scores.length > 0
      ? scores.reduce((a, b) => a + b) / scores.length : 0;

    // Timestamps = first part start to last part end
    entry._ctcStart = partResults[0].start_time;
    entry._ctcEnd = partResults[partResults.length - 1].end_time;

    // Char scores = concatenated from all parts
    entry._ctcCharScores = partResults.flatMap(p => p.char_scores);
  }

  // Third pass: copy _ctc* to contraction partners (_mergedInto entries)
  for (let i = 0; i < alignment.length; i++) {
    const entry = alignment[i];
    if (entry._mergedInto && i > 0) {
      // Find the first entry of this contraction pair
      const partner = alignment[i - 1];
      if (partner._ctcScore != null) {
        entry._ctcScore = partner._ctcScore;
        entry._ctcStart = partner._ctcStart;
        entry._ctcEnd = partner._ctcEnd;
      }
    }
  }
}
```

#### `mapHypothesisResults(v1Ref, hypothesisResults)`

Maps dual-hypothesis test results onto disputed entries:

```javascript
function mapHypothesisResults(v1Ref, hypothesisResults) {
  for (const result of hypothesisResults) {
    const entry = v1Ref[result.index];
    if (!entry || !result.candidates || result.candidates.length < 2) continue;

    const hypNorm = entry.hyp?.toLowerCase().replace(/[^a-z'-]/g, '');
    const refNorm = entry.ref?.toLowerCase().replace(/[^a-z'-]/g, '');
    const hypResult = result.candidates.find(c => c.text === hypNorm);
    const refResult = result.candidates.find(c => c.text === refNorm);

    if (hypResult && refResult) {
      entry._ctcLossHyp = hypResult.loss;     // CTC loss for V1's word
      entry._ctcLossRef = refResult.loss;     // CTC loss for reference word
      entry._ctcDelta = hypResult.loss - refResult.loss;  // Positive = ref wins

      // Classify based on delta
      // IMPORTANT: These thresholds are UNCALIBRATED starting points.
      // They need empirical validation on labeled data before influencing scoring.
      // CTC loss with reduction='mean' normalizes by target length, so
      // thresholds are comparable across word pairs of different lengths.
      if (entry._ctcDelta > 1.0) {
        entry._ctcVerdict = 'likely_artifact';    // Ref fits audio much better
      } else if (entry._ctcDelta < -1.0) {
        entry._ctcVerdict = 'likely_genuine';     // V1's hyp fits audio better
      } else {
        entry._ctcVerdict = 'ambiguous';          // Too close to call
      }
    }
  }
}
```

**Note on thresholds:** The `_ctcDelta` threshold of ±1.0 is a starting point. `ctc_loss` with `reduction='mean'` normalizes by target length, making deltas comparable across word pairs of different lengths. But the optimal threshold still needs empirical tuning. **Do not change WCPM scoring based on these verdicts until thresholds are validated on labeled data.**

### 4. Diagnostics Integration

**File:** `js/diagnostics.js`

#### Enhanced struggle detection (all paths)

```javascript
// In detectStruggleWords():
// Use acoustic scores as SUPPORTING evidence — never as the sole signal

// Path 1 (hesitation): Use _ctcStart/_ctcEnd for precise pause measurement
// when available, falling back to Parakeet timestamps
if (entry._ctcStart != null && prevEntry._ctcEnd != null) {
  pauseBefore = entry._ctcStart - prevEntry._ctcEnd;  // 20ms precision
}

// Path 2 (decoding): Use fragment acoustic scores to verify fragments are real speech
// Guard: only override if _ctcScore is available; default to existing behavior otherwise
const fragmentsVerified = nearMissInsertions.every(ins =>
  ins._ctcScore == null || ins._ctcScore > 0.4
);

// Path 3 (abandoned attempt): Use acoustic score to detect omission false positives
if (entry._ctcScore != null && entry._ctcScore > 0.4 && entry.type === 'omission') {
  entry._ctcSuggestsAttempt = true;
}
```

### 5. UI Integration

**File:** `js/ui.js`

#### Tooltip enhancement

Add acoustic data to the word tooltip when available:

For regular words:
```
enormous  |  1.80s - 2.41s  |  confirmed
--------------------------------------------
V1: enormous  |  V0: enormous  |  Pk: enormous
Acoustic: 0.91
--------------------------------------------
> Play    [Academic]
```

For disputed words with hypothesis testing:
```
face  |  2.10s - 2.45s  |  confirmed (sub)
--------------------------------------------
V1: face  |  V0: face  |  Pk: face
Acoustic: "faced" fits audio better (delta 1.5)
  Likely ASR artifact -- engines may have dropped /d/
--------------------------------------------
> Play    [Common]
```

### 6. Data Model: New Fields on Alignment Entries

```javascript
{
  // Existing fields unchanged...

  // Full-sequence forced alignment (all words):
  _ctcScore: number,         // 0.0-1.0, mean frame probability for this token
  _ctcStart: number,         // Start time from wav2vec2 (~20ms precision)
  _ctcEnd: number,           // End time from wav2vec2 (~20ms precision)
  _ctcCharScores: [number],  // Per-character frame probabilities

  // Dual-hypothesis CTC test (disputed words only):
  _ctcLossHyp: number,       // CTC forward loss for V1's hypothesis (mean-normalized)
  _ctcLossRef: number,       // CTC forward loss for reference word (mean-normalized)
  _ctcDelta: number,         // lossHyp - lossRef (positive = ref fits audio better)
  _ctcVerdict: string,       // 'likely_artifact' | 'likely_genuine' | 'ambiguous'

  // Derived flags:
  _ctcSuggestsAttempt: boolean,  // Omission where acoustic evidence found speech
}
```

### 7. Graceful Degradation

The forced alignment is **additive** — it never replaces existing pipeline decisions. If the `/force-align` endpoint is unavailable:

- All `_ctc*` fields remain `undefined`
- Diagnostics fall back to existing timestamp sources (Parakeet primary, Reverb secondary)
- Struggle detection uses existing heuristics
- UI tooltips omit acoustic data
- No scoring changes — WCPM, accuracy unaffected

This matches the existing graceful degradation pattern (Parakeet offline -> Reverb-only, V0 mismatch -> ignore V0).

---

## Performance Budget

| Metric | Value | Notes |
|--------|-------|-------|
| Model VRAM | ~0.4 GB | wav2vec2-base (95M params FP32 + activations) |
| Forward pass (60s audio) | <1s | Single pass, produces entire emission matrix |
| Hypothesis testing | microseconds each | `ctc_loss` on pre-computed emission window |
| API round-trip | ~1-2s | Including audio base64 encoding + transfer |
| Total pipeline impact | +1.5-2.5s | After ASR (not parallel -- needs alignment first) |

Current pipeline takes 10-15s. This adds ~1.5-2.5s. Total: ~12-18s.

---

## What This Solves vs. What It Doesn't

### Solves

| Problem | How | Confidence |
|---------|-----|------------|
| Inflection dropping ambiguity (faced->face) | CTC trellis: compare P("faced" \| audio) vs P("face" \| audio) | Medium -- needs Phase 1 validation |
| Filler misclassification (um->one) | CTC trellis: compare hypotheses against audio segment | High -- strong acoustic difference |
| Fragment verification (BPE artifact vs real speech) | Per-fragment acoustic score: >0.4 likely real, <0.2 likely noise | Medium -- single-char fragments are noisy |
| Reverb 100ms timestamp quantization | Independent ~20ms-precision timestamps from wav2vec2 | High -- standard capability |
| Omission false positives | Acoustic score on omitted positions: low = silence, moderate = attempted | Medium -- depends on model quality |
| "Correct but effortful" pronunciation | Acoustic score relative to student's median | Low -- novel metric, unvalidated on children |

### Does NOT Solve

| Problem | Why Not |
|---------|---------|
| Disfluency detection (V1/V0 diff) | Forced alignment doesn't classify disfluency types. V1/V0 diff remains primary. |
| Confirmed insertions (3-engine agreement) | Acoustic scores verify what's in the audio but don't replace multi-engine consensus. |
| Self-correction sequencing | Scores confirm fragments are real but don't determine correction order. Existing near-miss resolution handles this. |
| Downstream AI narrative | Provides richer per-word data but doesn't generate teacher-facing explanations. |
| Hypotheses that no engine produced | Can only test words that V1 or Parakeet already heard. Cannot discover unheard words. |

---

## Evaluation Plan

### Phase 1: Backend Prototype + Signal Validation (GO/NO-GO Gate) — 3-5 days

**This phase determines whether the entire plan is viable. Do not proceed to Phase 2 unless Phase 1 passes.**

1. Add `/force-align` endpoint to `server.py` using wav2vec2-base + `forced_align()` + `ctc_loss()`
2. Verify VRAM budget: Reverb + Parakeet + wav2vec2-base coexist. Measure actual VRAM.
3. Measure latency: forward pass time on 60s audio clips
4. **Critical validation — inflection tiebreaker:**
   - Collect 10+ recordings where you KNOW whether the student said "faced" vs "face" (or similar inflection pairs: tried/try, helped/help, played/play, walked/walk)
   - For each: feed the correct word and the dropped-inflection form as hypotheses
   - Measure `_ctcDelta` for known-artifact cases (student said "faced", engines heard "face") vs known-genuine cases (student genuinely said "face")
   - **Pass criterion:** The delta distributions must be separable. If they overlap substantially, the primary use case fails and the plan should be reconsidered.
5. **Secondary validation — filler verification:**
   - Find 5+ recordings with known fillers ("um"/"uh") that V1 decoded as real words
   - Compare CTC loss for filler hypothesis vs V1's hypothesis
   - Expected: large delta (fillers and real words sound very different acoustically)
6. **Model comparison (if base fails):** If wav2vec2-base doesn't resolve inflection pairs, test `WAV2VEC2_ASR_LARGE_960H` (300M params, ~1GB VRAM, MIT license). If neither works, the approach is dead for Use Case 1.

**Output of Phase 1:** A document with delta distributions, sample sizes, and a clear GO/NO-GO recommendation. Share with stakeholders before proceeding.

### Phase 2: Pipeline Integration (2-3 days) — only if Phase 1 passes

1. Implement `buildHybridText()` with compound/expansion handling (the hardest part)
2. Implement `mapAcousticScores()` with expansion aggregation
3. Add `_ctc*` fields to alignment entries, verify in debug JSON
4. Verify graceful degradation when endpoint unavailable
5. Test with 5+ full pipeline runs — verify hybrid text is correct by comparing word count with expected

### Phase 3: Dual-Hypothesis Integration (2-3 days) — only if Phase 1 passes

1. Implement `buildHypothesisTests()` + `mapHypothesisResults()`
2. Display `_ctcDelta` and `_ctcVerdict` in debug table — **advisory only, no scoring changes**
3. Verify on the same recordings used in Phase 1 validation

### Phase 4: Diagnostics + UI (2-3 days)

1. Integrate acoustic scores into struggle detection paths (supporting evidence only)
2. Integrate precise timestamps into pause analysis (where Parakeet timestamps are absent)
3. Add acoustic data to tooltips
4. Optional: pronunciation quality in word speed map (defer unless Phase 1 showed strong signal)

### Phase 5: Threshold Calibration (ongoing, weeks)

1. Collect 50+ assessments with acoustic data
2. For inflection-dropping cases: does `_ctcDelta` correctly separate artifacts from genuine errors?
3. Plot delta distributions, find optimal decision boundary
4. Only after validation with sufficient labeled data: consider allowing `_ctcVerdict = 'likely_artifact'` to influence scoring
5. This phase may run concurrently with the LLM judge plan — see Open Question #5

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| wav2vec2-base too weak for single-phoneme inflection discrimination on children's speech | **High** | High | Phase 1 is a GO/NO-GO gate. If base fails, try large (also MIT). If both fail, approach is dead for Use Case 1. |
| Hybrid text construction wrong (compounds/expansions not properly expanded) | Medium | High | `buildHybridText()` explicitly handles compounds (`parts` array), abbreviation/number expansions (split `hyp`), contractions (`_mergedInto` skip). Must be tested thoroughly against debug JSON. |
| Viterbi alignment drift from wrong token in hybrid text | Medium | Medium | If V1 hallucinated a word, the forced aligner tries to find it, producing low score (useful) but potentially shifting neighboring timestamps. Partially mitigated by: (a) low scores flagging the problem, (b) dual-hypothesis tests using independent per-word windows. |
| VRAM contention with Reverb+Parakeet | Very Low | Medium | wav2vec2-base is ~400MB VRAM. Uses `gpu_lock` serialization. Well within 12GB budget. |
| CTC delta threshold poorly calibrated | **High** | Medium | Start advisory-only (tooltip + debug). Never change scoring until threshold validated on labeled data. Use `reduction='mean'` to normalize across word lengths. |
| Frame windowing imprecision for hypothesis tests | Medium | Medium | ±5 frame buffer (~100ms) helps. For single-phoneme differences (face/faced), signal is thin. For multi-phoneme differences, signal is strong. |
| CTC "peaky" behavior limits score discrimination | Medium | Medium | CTC models produce sharp spikes at emission positions. May compress score distributions, making thresholds harder to calibrate. Relative comparison (delta) is more robust than absolute scores. |
| Latency exceeds acceptable threshold | Low | Low | Forward pass <1s. Hypothesis tests are microseconds. Total ~1.5-2.5s. Can skip for >120s recordings if needed. |
| Maintenance burden: every new pipeline feature must consider hybrid text interaction | Medium | Low | Document hybrid text construction rules. Same pattern as existing 5-place hyphen-split sync — manageable but needs discipline. |

---

## Open Questions

1. **wav2vec2-base vs wav2vec2-large?** Base (95M, ~400MB VRAM, MIT) is cheaper. Large (300M, ~1GB VRAM, MIT) may capture fine phonetic distinctions better — critical for the "face"/"faced" single-phoneme test. Phase 1 should test both if base fails. The `ctc-forced-aligner` package (uses HuggingFace Transformers, actively maintained, claims 5x less memory) is an alternative to raw torchaudio if torchaudio's maintenance-mode status becomes a concern.

2. **CTC delta threshold calibration.** The ±1.0 threshold is arbitrary. `reduction='mean'` normalizes by target length, making deltas comparable across word pairs. But optimal threshold still needs systematic approach: collect 100+ labeled dispute cases, plot delta distributions, find decision boundary. Until then, all verdicts are advisory.

3. **Should acoustic verdicts influence WCPM scoring?** Currently proposed as advisory only. If dual-hypothesis testing reliably detects inflection artifacts, reclassifying affected words from 'substitution' to 'correct' changes the student's score. This requires careful validation and possibly teacher buy-in before enabling.

4. **Relationship to LLM judge plan.** The LLM judge (`docs/llm-judge-implementation-plan.md`) reasons about text — engine disagreements, contextual plausibility, word frequency. The CTC trellis test provides acoustic evidence. They're complementary: acoustic scores answer "what does the audio contain?" while the LLM answers "does this mismatch pattern match a known artifact or a known reading error?" If both are implemented, the LLM judge should receive `_ctcDelta` and `_ctcVerdict` as input, making its decisions grounded in acoustic reality rather than guessing between transcripts. The LLM judge is likely faster to implement and validate — consider prioritizing it and using acoustic verification as a later enhancement.

5. **torchaudio maintenance mode.** torchaudio is in maintenance mode (no new features). The `forced_align` API was preserved after community feedback (GitHub issue #3902) but won't receive improvements. If bugs are found, consider migrating to `ctc-forced-aligner` package (same models via HuggingFace Transformers, actively maintained).
