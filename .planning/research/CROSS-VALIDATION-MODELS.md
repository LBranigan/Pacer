# Cross-Validation Model Research: Adversarial Conflict for Ensemble ASR

**Researched:** 2026-02-05
**Context:** Three-model ensemble for oral reading fluency assessment
**Primary model:** Reverb ASR (verbatim and clean modes)
**Goal:** Select cross-validation model with uncorrelated errors to Reverb

---

## Executive Summary

**Recommendation: Deepgram Nova-3 provides better adversarial conflict with Reverb ASR than Google Cloud STT "default" model.**

Reverb ASR uses a **joint CTC/attention architecture** (Conformer encoder + bidirectional attention decoder). For maximum error decorrelation, the cross-validator should use a fundamentally different architecture and training paradigm.

| Model | Architecture | Training Data | Error Decorrelation with Reverb |
|-------|--------------|---------------|--------------------------------|
| **Deepgram Nova-3** | Pure Transformer encoder-decoder | Proprietary curated corpus (~47B tokens) | **HIGH** - Different architecture family |
| Google STT (V1/default) | Conformer-based | Google's proprietary data | **MEDIUM** - Similar encoder architecture |
| Google Chirp/USM | Conformer encoder + flexible decoder | 12M hours, 300+ languages | **MEDIUM** - Similar to Reverb's Conformer |

---

## Architecture Deep Dive

### Reverb ASR Architecture

**Source:** [arXiv:2410.03930v2](https://arxiv.org/html/2410.03930v2)

| Component | Details |
|-----------|---------|
| **Architecture type** | Joint CTC/Attention hybrid |
| **Encoder** | 18 Conformer layers |
| **Decoder** | Bidirectional attention decoder (6 transformer layers, 3 each direction) |
| **Parameters** | ~600M |
| **Framework** | Modified WeNet toolkit |
| **Training data** | 200,000 hours English (120K verbatim, 80K non-verbatim) |
| **Special feature** | Language-specific layer mechanism for verbatimicity control |

**Decoding modes supported:**
- Greedy CTC decoding
- CTC prefix beam search (with/without attention rescoring)
- Attention decoding
- Joint CTC/attention decoding

**Error patterns (joint CTC/attention):**
- CTC component enforces monotonic alignment, reducing insertion/deletion errors
- Attention component allows flexible alignment for better accuracy
- Hybrid approach regularizes attention's "over-flexibility"
- Prone to errors when audio-text alignment is ambiguous

### Deepgram Nova-3 Architecture

**Sources:** [Deepgram Nova-3 Introduction](https://deepgram.com/learn/introducing-nova-3-speech-to-text-api), [Neurlcreators Review](https://neurlcreators.substack.com/p/nova-3-deepgram-review)

| Component | Details |
|-----------|---------|
| **Architecture type** | Pure Transformer encoder-decoder |
| **Encoder** | Acoustic Transformer (audio embedding framework) |
| **Decoder** | Language Transformer with universal attention |
| **Backbone** | Transformer-XL-style for long-range context |
| **Parameters** | Not disclosed (proprietary) |
| **Training data** | ~47 billion tokens, 9 domains, curated corpus |
| **Special feature** | In-context learning (Keyterm Prompting) |

**Key architectural differences from Reverb:**
- **No CTC component** - Pure attention-based decoding
- **Latent space compression** - Audio projected to compressed latent space
- **Transformer-XL backbone** - Different attention mechanism for long context
- **No Conformer encoder** - Standard Transformer architecture

**Error patterns (attention-only):**
- More prone to insertion/deletion errors than CTC hybrids
- May prematurely predict end-of-sequence (deletions)
- May repeat by attending to same positions (insertions/hallucinations)
- Different failure modes than CTC-constrained systems

### Google Cloud STT Architecture

**Sources:** [Google USM Research](https://research.google/blog/universal-speech-model-usm-state-of-the-art-speech-ai-for-100-languages/), [arXiv:2303.01037](https://arxiv.org/abs/2303.01037)

| Component | Details |
|-----------|---------|
| **Architecture type (V2/Chirp)** | Conformer encoder + flexible decoder (CTC/RNN-T/LAS) |
| **Architecture type (V1/legacy)** | Conformer-based (similar to Chirp but older) |
| **Encoder** | Conformer (convolution-augmented transformer) |
| **Decoder options** | CTC, RNN-T, or LAS |
| **Parameters** | 2B (USM) |
| **Training data** | 12M hours speech, 28B sentences, 300+ languages |
| **Special feature** | Chunk-wise attention for long-form audio |

**Key architectural similarities to Reverb:**
- **Same encoder family** - Both use Conformer
- **CTC capability** - Both can use CTC decoding
- **Similar training scale** - Large-scale supervised data
- **Attention mechanism** - Similar attention components

**Error patterns:**
- Similar to Reverb due to architectural overlap
- Conformer encoders share similar feature extraction biases
- CTC constraints produce similar alignment behavior
- Errors likely to correlate on ambiguous audio

---

## Error Correlation Analysis

### Why Architectural Diversity Matters

From [ASR ensemble diversity research](https://www.isca-archive.org/interspeech_2025/ko25_interspeech.pdf):

> "Diversity or complementarity of ASR systems is crucial for achieving a reduction in word error rate upon fusion."

**Key insight:** Models with similar architectures trained on similar data will make correlated errors. For cross-validation to catch hallucinations, the validator must fail differently than the primary model.

### Error Pattern Comparison

| Error Type | Reverb (CTC/Attention) | Nova-3 (Pure Attention) | Google (Conformer/CTC) |
|------------|------------------------|------------------------|------------------------|
| **Insertions** | Moderate (CTC constrains) | Higher (no CTC constraint) | Moderate (CTC constrains) |
| **Deletions** | Moderate | Higher (premature EOS) | Moderate |
| **Substitutions** | Dependent on acoustic model | Different acoustic bias | Similar to Reverb |
| **Hallucinations** | Controlled by CTC alignment | More prone | Controlled by CTC alignment |
| **Repetitions** | Rare (CTC prevents) | More possible | Rare (CTC prevents) |

### Architectural Decorrelation Score

| Pairing | Shared Components | Decorrelation |
|---------|-------------------|---------------|
| **Reverb + Nova-3** | Neither encoder nor decoder family | **HIGH** |
| Reverb + Google Chirp | Conformer encoder, potentially CTC | LOW |
| Reverb + Google V1 | Conformer encoder | LOW-MEDIUM |

---

## Practical Considerations

### Cost Comparison

| Provider | Model | Cost per Minute | Cost per Hour | Notes |
|----------|-------|-----------------|---------------|-------|
| **Deepgram** | Nova-3 | $0.0077 | $0.46 | Pay-as-you-go |
| **Deepgram** | Nova-3 (Growth) | $0.0065 | $0.39 | Volume plan |
| **Google** | Standard (V1) | $0.024 | $1.44 | 60 min/month free |
| **Google** | Enhanced | $0.036 | $2.16 | - |

**Winner: Deepgram Nova-3** - 3x cheaper than Google standard

### Latency Comparison

| Provider | Streaming Latency | Batch Performance |
|----------|-------------------|-------------------|
| **Deepgram Nova-3** | <300ms | Fast |
| **Google STT** | ~650ms average | Standard |

**Winner: Deepgram Nova-3** - 2x faster streaming latency

### API Feature Comparison

| Feature | Deepgram Nova-3 | Google STT |
|---------|-----------------|------------|
| **Word timestamps** | Yes (high precision) | Yes |
| **Confidence scores** | Yes (word-level) | Yes (word-level, optional) |
| **Diarization** | Yes (built-in) | Yes |
| **Streaming** | Yes | Yes (5 min limit) |
| **Custom vocabulary** | Yes (Keyterm Prompting) | Yes (phrases) |
| **Billing granularity** | Per second | Per 15 seconds |

**Winner: Deepgram Nova-3** - Comparable features, better billing granularity

### Integration Complexity

| Aspect | Deepgram | Google STT |
|--------|----------|------------|
| **Auth** | API key | Service account / OAuth |
| **SDK** | Simple REST/WebSocket | Client libraries |
| **Setup** | Quick | GCP project setup required |

**Winner: Deepgram** - Simpler integration

---

## Recommendation

### Nova-2 vs Nova-3 Comparison

Both Nova-2 and Nova-3 are **pure Transformer architectures** (no CTC component), making both architecturally decorrelated from Reverb's CTC/Attention hybrid.

| Aspect | Nova-2 | Nova-3 |
|--------|--------|--------|
| **Architecture** | Lean Transformer, optimized for speed | Larger Transformer-XL, optimized for accuracy |
| **Parameters** | Smaller model weights | Larger model |
| **Streaming WER** | ~9.09% | Sub-6% in challenging conditions |
| **Noise handling** | Standard | 54% lower WER in noisy/far-field |
| **Cost** | Lower | Higher |
| **Latency** | 25% faster spinup | Standard |
| **Training data** | 47B tokens | 47B tokens + domain variants |
| **Special features** | Basic | Keyterm prompting, code-switching |

### Recommendation for ORF Cross-Validation

**Primary: Nova-3** (for production)
- Better accuracy on children's speech (challenging audio)
- Keyterm prompting can boost passage vocabulary recognition
- More robust on hesitant, disfluent reading patterns
- Sub-6% WER threshold appropriate for clinical tool

**Alternative: Nova-2** (for more aggressive adversarial conflict)
- Smaller model = different error distribution than Reverb
- If Reverb hallucinates, Nova-2's errors are less likely to correlate
- Cheaper for testing/validation during development

**Recommendation:** Start with Nova-3 for production quality. If hallucination detection is too conservative (both models agree too often), consider Nova-2 as more aggressive adversary.

### Why Not Google?

| Factor | Deepgram (Nova-2/3) | Google STT |
|--------|---------------------|------------|
| **Architecture vs Reverb** | Pure Transformer (different) | Conformer-based (similar) |
| **Error decorrelation** | HIGH | LOW-MEDIUM |
| **Cost** | $0.0043-0.0077/min | $0.024/min |
| **Integration** | API key | GCP project setup |

Google STT uses Conformer encoder — same architecture family as Reverb. Errors will correlate.

### Fallback: Google STT V1 (not Chirp)

If Google is required for other reasons:
- Use V1 API with standard model, not Chirp/USM
- V1 is slightly more architecturally distinct from Reverb than Chirp
- Still expect moderate error correlation due to Conformer encoder

**Avoid:** Google Chirp/USM for cross-validation - too architecturally similar to Reverb

---

## Implementation Notes

### For Hallucination Detection

When using Nova-3 to cross-validate Reverb:

1. **Compare word presence** - If Nova-3 doesn't transcribe a word that Reverb produced, flag as potential hallucination
2. **Compare word counts** - Reverb's CTC prevents repetition; if Nova-3 shows repetition where Reverb doesn't, investigate
3. **Use confidence scores** - Nova-3 word-level confidence can weight disagreements
4. **Weight by architecture bias** - Nova-3 is more likely to have deletions; weight Reverb's extra words as higher-confidence hallucination signals

### Ensemble Fusion Strategy

| Scenario | Reverb v=1.0 | Nova-3 | Action |
|----------|--------------|--------|--------|
| Agreement | "the cat sat" | "the cat sat" | High confidence |
| Reverb extra word | "the big cat sat" | "the cat sat" | Flag "big" for review |
| Nova-3 extra word | "the cat sat" | "the big cat sat" | Less likely hallucination (attention over-generation) |
| Major disagreement | "the cat sat" | "a dog stood" | Low confidence, manual review |

---

## Sources

### Primary Sources (HIGH confidence)

- [Reverb ASR Paper (arXiv:2410.03930v2)](https://arxiv.org/html/2410.03930v2) - Architecture details
- [Google USM Paper (arXiv:2303.01037)](https://arxiv.org/abs/2303.01037) - Chirp/USM architecture
- [Google USM Research Blog](https://research.google/blog/universal-speech-model-usm-state-of-the-art-speech-ai-for-100-languages/) - USM details
- [Joint CTC/Attention Paper (ACL)](https://aclanthology.org/P17-1048/) - Error patterns in hybrid models

### Secondary Sources (MEDIUM confidence)

- [Deepgram Nova-3 Introduction](https://deepgram.com/learn/introducing-nova-3-speech-to-text-api) - Nova-3 capabilities
- [Deepgram Nova-3 Review](https://neurlcreators.substack.com/p/nova-3-deepgram-review) - Architecture overview
- [Deepgram Pricing](https://deepgram.com/pricing) - Cost information
- [Google STT Pricing](https://cloud.google.com/speech-to-text/pricing) - Cost information
- [Google STT Word Timestamps](https://docs.cloud.google.com/speech-to-text/docs/v1/async-time-offsets) - API features
- [Deepgram Timestamps Documentation](https://deepgram.com/learn/working-with-timestamps-utterances-and-speaker-diarization-in-deepgram) - API features

### Tertiary Sources (LOW confidence - for context only)

- [ASR Ensemble Diversity Research](https://www.isca-archive.org/interspeech_2025/ko25_interspeech.pdf) - Error correlation theory
- [Hybrid CTC/Attention Paper (MERL)](https://www.merl.com/publications/docs/TR2017-190.pdf) - Error pattern analysis

---

## Confidence Assessment

| Finding | Confidence | Reason |
|---------|------------|--------|
| Reverb architecture | HIGH | Direct from arXiv paper |
| Nova-3 general architecture | MEDIUM | Official blog, no detailed paper |
| Nova-3 specific components | LOW | Proprietary, not publicly documented |
| Google Chirp/USM architecture | HIGH | arXiv paper + official docs |
| Error correlation theory | MEDIUM | Academic research, applied inference |
| Cost comparison | HIGH | Official pricing pages |
| Feature comparison | HIGH | Official documentation |

---

## Open Questions

1. **Nova-3 exact architecture** - Deepgram doesn't publish detailed architecture papers; the Transformer-XL claim is from marketing materials
2. **Google V1 vs V2 internal differences** - Google doesn't clearly document V1 architecture
3. **Real-world error correlation** - Theory suggests decorrelation; empirical testing on reading fluency data would confirm

---

**Conclusion:** Deepgram Nova-3 is the recommended cross-validation model for the Reverb-based ensemble due to architectural diversity (pure Transformer vs. CTC/Attention hybrid), different training paradigm, complementary error patterns, lower cost, and faster latency.
