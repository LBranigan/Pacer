# Google Cloud Speech-to-Text Models: Research Findings

This document contains comprehensive research on Google Cloud Speech-to-Text models, specifically focusing on the differences between `latest_long` and `default` models for ensemble transcription.

## Table of Contents

1. [Model Overview](#model-overview)
2. [Architecture Differences](#architecture-differences)
3. [Confidence Score Reliability](#confidence-score-reliability)
4. [Phantom Word Insertions (Hallucinations)](#phantom-word-insertions-hallucinations)
5. [Timestamp Accuracy](#timestamp-accuracy)
6. [Non-Deterministic Results](#non-deterministic-results)
7. [Practical Implications for Ensemble Merging](#practical-implications-for-ensemble-merging)
8. [Best Practices](#best-practices)
9. [Sources](#sources)

---

## Model Overview

### latest_long Model

| Attribute | Value |
|-----------|-------|
| Architecture | Conformer Speech Model |
| Optimized For | Long-form content, media, spontaneous speech, conversations |
| Intended Replacement | `video` and `default` models |
| Confidence Scores | **NOT RELIABLE** - API returns values but they are not true confidence scores |
| Languages | 20+ languages, 50+ variants |
| Billing | Standard tier |

### default Model

| Attribute | Value |
|-----------|-------|
| Architecture | Traditional (likely RNN-based or hybrid) |
| Optimized For | General audio transcription, high-fidelity audio (16kHz+) |
| Confidence Scores | **RELIABLE** - True confidence scores (0.0-1.0) |
| Languages | Broad language support |
| Billing | Standard tier |

### latest_short Model

| Attribute | Value |
|-----------|-------|
| Architecture | Conformer Speech Model |
| Optimized For | Brief utterances (few seconds), commands, single-shot directed speech |
| Intended Replacement | `command_and_search` model |
| Confidence Scores | **NOT RELIABLE** |

---

## Architecture Differences

### Conformer Architecture (latest_long, latest_short)

The Conformer is a **convolution-augmented transformer** architecture developed by Google Brain in 2020. It combines:

1. **Self-attention modules** - Capture global context and long-range dependencies
2. **Convolution modules** - Capture local patterns and fine-grained acoustic features
3. **Feed-forward modules** - In a "macaron-like" structure with half-step residual connections

**Processing Pipeline:**
1. Input: Log-mel spectrogram of speech signal
2. Convolutional sub-sampling
3. Series of Conformer blocks
4. Projection layer for final embeddings
5. Decoder (CTC, RNN-T, or LAS)

**Key Characteristics:**
- State-of-the-art accuracy for many ASR benchmarks
- Better vocabulary coverage due to larger language model component
- Can produce "hallucinated" outputs that are fluent but acoustically unfounded
- May generate zero-duration "phantom" words (language model insertions)

### Traditional Architecture (default)

The default model likely uses an older but proven architecture:

- More conservative acoustic modeling
- Tighter coupling between acoustic evidence and word output
- More accurate word boundary detection
- Genuine confidence scores based on acoustic likelihood

---

## Confidence Score Reliability

### Critical Finding

From [Google's official documentation](https://docs.cloud.google.com/speech-to-text/docs/v1/latest-models):

> **"The API will return a value, but it is not truly a confidence score."**

This applies to:
- `latest_long` model
- `latest_short` model
- Chirp models (Chirp 2, Chirp 3)

### Why Latest Models Have Fake Confidence Scores

The Conformer architecture with attention-based decoding produces outputs differently from traditional ASR:

1. **Attention mechanism** doesn't produce per-word acoustic probabilities in the same way
2. **Language model integration** heavily influences output, making it impossible to isolate acoustic confidence
3. **End-to-end training** optimizes for final output, not intermediate confidence measures

### Which Models Have Real Confidence Scores

| Model | Confidence Reliability |
|-------|----------------------|
| `default` | **REAL** - Can be trusted |
| `phone_call` | **REAL** - Can be trusted |
| `enhanced` variants | **REAL** - Can be trusted |
| `latest_long` | **FAKE** - Do not use |
| `latest_short` | **FAKE** - Do not use |
| `chirp_2` | **FAKE** - Do not use |
| `chirp_3` | **FAKE** - Do not use |

### Practical Implication

When using ensemble transcription:
- **ALWAYS** use confidence scores from the `default` model
- **NEVER** use confidence scores from `latest_long` for any decision-making
- If only `latest_long` data is available for a word, treat confidence as `null`

---

## Phantom Word Insertions (Hallucinations)

### What Are ASR Hallucinations?

ASR hallucinations are **transcriptions that are semantically unrelated to the source utterance, yet still fluent and coherent**. Unlike simple phonetic errors, hallucinations:

- Appear plausible and grammatically correct
- Have no acoustic basis in the input audio
- Are not detected by traditional WER metrics (because they're coherent text)

### Types of ASR Errors

| Error Type | Description | Detection |
|------------|-------------|-----------|
| **Phonetic errors** | Misheard words with phonetic similarity to actual speech | High WER, moderate semantic similarity |
| **Hallucinations** | Fabricated content with no acoustic basis | Low WER (coherent), low semantic similarity |
| **Oscillations** | Correct transcription + repeating n-grams | High semantic similarity, visible patterns |

### Zero-Duration Phantom Words

In our observations, `latest_long` can produce words with **zero duration** (startTime === endTime):

```
Word: "my"
latest_long: startTime=9.9s, endTime=9.9s (0ms duration!)
default: Not detected at this timestamp
```

**This is a strong indicator of a hallucinated/phantom word.** Real spoken words always have non-zero duration.

### Why Conformer Models Hallucinate More

1. **Stronger language model** - Can "fill in" expected words even without acoustic evidence
2. **Attention mechanism** - May attend to wrong parts of the input
3. **Training data effects** - Label mismatches in training data correlate with hallucination susceptibility
4. **Optimization target** - Optimized for coherent output, not acoustic fidelity

### Detection Strategies

1. **Zero-duration check**: Words with `endTime - startTime === 0` are likely phantom insertions
2. **Cross-model validation**: Words only in `latest_long` (not `default`) need scrutiny
3. **Confidence threshold**: If default model has the word with high confidence (>0.93), it's acoustically grounded
4. **Semantic coherence**: Check if word makes sense in context (but hallucinations are often coherent!)

---

## Timestamp Accuracy

### Timestamp Precision

Both models return timestamps with **100ms precision** as per Google's specification.

### Observed Differences

| Aspect | latest_long | default |
|--------|-------------|---------|
| Word boundaries | May extend beyond actual speech | More precise acoustic boundaries |
| Zero-duration words | Can occur (phantom insertions) | Very rare |
| Timestamp drift | Can drift from acoustic reality | Stays closer to acoustic events |
| Gap handling | May compress pauses | Preserves natural pauses |

### Jitter Tolerance

When comparing timestamps between models, use a **50ms jitter tolerance** to account for:
- Different alignment algorithms
- Frame boundary quantization
- Processing pipeline differences

---

## Non-Deterministic Results

### Critical Finding: Same Audio, Different Results

**Google Cloud STT does not guarantee deterministic results.** The same audio file submitted multiple times can produce different transcriptions, timestamps, and confidence scores.

### Observed Example

We submitted identical audio twice and received different results for the word "back":

| Run | Model | Start | End | Duration |
|-----|-------|-------|-----|----------|
| Run 1 | latest_long | 9.900s | 9.900s | **0ms** (phantom) |
| Run 2 | latest_long | 9.800s | 9.900s | **100ms** (real) |
| Run 1 | default | 10.0s | 10.1s | 100ms |
| Run 2 | default | 10.0s | 10.2s | 200ms |

Even confidence scores varied between runs (e.g., 0.55 vs 0.53 for the same word).

### Why This Happens

1. **GPU floating-point variance** - Different server hardware produces slightly different floating-point calculations
2. **Server-side batching** - Your request may be processed alongside others, affecting computation order
3. **Model updates** - Google updates models without notice; V1 API has no version pinning
4. **Beam search non-determinism** - Decoding algorithms may have stochastic elements
5. **Load balancing** - Requests may hit different model replicas with slight variations

### Implications

1. **Test results may vary** - Running the same test twice may produce different accuracy scores
2. **Phantom words are random** - A word may appear as a 0ms phantom in one run but not another
3. **Ensemble merging helps** - Cross-validating between models catches some variance
4. **Don't over-optimize** - Small accuracy differences between runs may be noise, not signal

### Mitigation Strategies

1. **Run multiple times** - Average results across 3+ API calls for critical assessments
2. **Use ensemble approach** - Two models catching each other's variance
3. **Focus on patterns** - Look for consistent errors across runs, not one-off differences
4. **Log raw responses** - Save debug data to analyze variance over time

---

## Practical Implications for Ensemble Merging

### Current Architecture

Our ensemble merger uses **temporal word association**:
1. Use `latest_long` as primary source (better vocabulary)
2. Match words between models by timestamp overlap
3. Use `default` model confidence for scoring
4. Tag each word with source: `both`, `latest_only`, `default_only`

### Recommended Improvements

Based on this research:

1. **Filter zero-duration words** from `latest_long` before merging
   ```javascript
   // Words with 0ms duration are language model insertions
   if (parseTimeMs(word.endTime) - parseTimeMs(word.startTime) < 10) {
     // Skip this word - likely a phantom insertion
   }
   ```

2. **Trust `default_only` words for confidence-based decisions**
   - If a word only appears in `default` with high confidence, it's acoustically real
   - If a word only appears in `latest_long`, treat with skepticism

3. **Use `latest_long` primarily for vocabulary**
   - Better at rare words, proper nouns, technical terms
   - But verify acoustic grounding via `default` model

4. **Never use `latest_long` confidence for**:
   - Disfluency detection thresholds
   - Quality scoring
   - Any decision-making logic

### Word Source Trust Hierarchy

| Source | Trust Level | Use Case |
|--------|-------------|----------|
| `both` models agree | **HIGH** | Full trust, use for all metrics |
| `default_only` | **MEDIUM-HIGH** | Acoustically grounded, may be missed by latest_long |
| `latest_only` with duration >100ms | **MEDIUM** | Likely real, but verify context |
| `latest_only` with duration <50ms | **LOW** | Possibly phantom, require additional validation |
| `latest_only` with duration 0ms | **VERY LOW** | Almost certainly phantom insertion, consider filtering |

---

## Best Practices

### Audio Quality

From Google's documentation and community best practices:

1. **Sampling rate**: 16,000 Hz or higher
2. **Codec**: Lossless (FLAC, LINEAR16); avoid MP3
3. **Microphone placement**: Close to speaker
4. **Background noise**: Minimize significantly
5. **Volume**: Intelligible to human listeners

### Model Selection

- **For accuracy**: Use `latest_long` for vocabulary, `default` for confidence
- **For reading fluency assessment**: Ensemble approach captures both vocabulary and acoustic confidence
- **For voice commands**: Use `latest_short` or `command_and_search`

### Testing

- Gather at least 20 hours of test data for statistically significant results
- Use WER (Word Error Rate) as primary accuracy metric
- Don't rely solely on confidence scores for quality assessment

---

## Sources

### Official Google Documentation

- [Introduction to Latest Models](https://docs.cloud.google.com/speech-to-text/docs/v1/latest-models)
- [Compare Transcription Models](https://docs.cloud.google.com/speech-to-text/docs/transcription-model)
- [Word Confidence Documentation](https://docs.cloud.google.com/speech-to-text/docs/word-confidence)
- [Measure and Improve Speech Accuracy](https://cloud.google.com/speech-to-text/docs/speech-accuracy)
- [Chirp 2 Model](https://docs.cloud.google.com/speech-to-text/docs/models/chirp-2)
- [Get Word Timestamps](https://docs.cloud.google.com/speech-to-text/docs/async-time-offsets)

### Research Papers

- [Conformer: Convolution-augmented Transformer for Speech Recognition](https://www.isca-archive.org/interspeech_2020/gulati20_interspeech.pdf) - Google Brain, 2020
- [Hallucinations in Neural ASR: Identifying Errors and Hallucinatory Models](https://arxiv.org/abs/2401.01572) - 2024
- [Demystifying Hallucination in Speech Foundation Models](https://aclanthology.org/2025.findings-acl.1190.pdf)
- [Universal Speech Model (USM)](https://research.google/blog/universal-speech-model-usm-state-of-the-art-speech-ai-for-100-languages/)

### Community Resources

- [How to Get Best Results from Google STT APIs](https://bbookman.github.io/ImprovedOutcomesGoogleSTT/) - Bruce Bookman, Google Cloud Solutions Engineer

---

## Changelog

- **2026-02-05**: Added section on non-deterministic API results with observed evidence
- **2026-02-04**: Initial research compilation for ORF Assessment project
