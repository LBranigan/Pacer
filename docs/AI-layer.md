# PACER AI Interpretation Layer — Research & Implementation Proposal

> **Date**: 2026-02-14 (research), 2026-02-14 (codebase audit + syllable analysis implementation)
> **Status**: Research Complete + Codebase-Validated + Syllable Coverage Implemented
> **Purpose**: Add an AI layer on top of PACER's diagnostic pipeline to interpret assessment data and generate teacher-actionable insights — both for individual assessments and longitudinal student tracking.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [PACER's Current Position (ROVER Comparison)](#2-pacers-current-position)
3. [Research: AI-Enhanced ROVER & ASR Fusion](#3-research-ai-enhanced-rover--asr-fusion)
4. [Research: AI for Oral Reading Fluency Assessment](#4-research-ai-for-oral-reading-fluency-assessment)
5. [Research: Competitive Landscape](#5-research-competitive-landscape)
6. [Research: RAG & Data Architecture for Structured Assessment Data](#6-research-rag--data-architecture)
7. [Research: LLM Diagnostic Interpretation](#7-research-llm-diagnostic-interpretation)
8. [The Two AI Layers PACER Needs](#8-the-two-ai-layers-pacer-needs)
9. [Phase 1: Single-Assessment Interpreter (1a: Serialization, 1b: LLM)](#9-phase-1-single-assessment-interpreter)
10. [Phase 2: Session Persistence & Data Architecture](#10-phase-2-session-persistence--data-architecture)
11. [Phase 3: Longitudinal Insights](#11-phase-3-longitudinal-insights)
12. [Phase 4: LLM-Enhanced ASR Error Correction (Deprioritized)](#12-phase-4-llm-enhanced-asr-error-correction-deprioritized)
13. [Implementation Stack Recommendation](#13-implementation-stack-recommendation)
14. [Sources & References](#14-sources--references)

---

## 1. Executive Summary

PACER is a **struggle detector** with the richest per-word diagnostic data in the automated reading assessment market. Its 3-engine consensus pipeline (Reverb dual-pass + Parakeet cross-validation), 24-stage diagnostic pipeline, 3 struggle paths, 7 speed tiers, disfluency classification, proper noun forgiveness, and OOV recovery produce data that no competitor matches.

**The missing piece**: an AI interpretation layer that turns this data into teacher-actionable insight. Something like:

> *"Jayden decoded most single-syllable words fluently but stalled on 4 of 6 multisyllabic words, producing the first syllable correctly before giving up. He self-corrected twice on sight words, suggesting he recognizes errors but loses confidence on longer words."*

This document captures research from ~100 sources across ROVER/ASR fusion, educational AI products, RAG architectures, and LLM diagnostic interpretation, synthesized into a concrete implementation proposal.

**Key conclusions**:
- PACER's 3-way verdict IS a specialized ROVER variant — and the research shows ROVER is being enhanced (not replaced) by AI layers
- Don't use vector RAG for structured data — PostgreSQL + pgvector hybrid is the right architecture
- Phase 1 (single-assessment LLM interpretation) requires zero new infrastructure but needs a **serialization layer** (per-word data lives in 3 separate sources that must be JOINed)
- Markdown table format improves LLM comprehension ~40% over raw JSON for per-word data
- Sending only "interesting words" (errors, struggles, slow pace) + summary stats saves ~60% of tokens vs. all words
- The Stanford "LLMs as Educational Analysts" paper is the closest open-source blueprint
- The miscue registry (`js/miscue-registry.js`) should be included in the LLM system prompt as a domain taxonomy anchor

---

## 2. PACER's Current Position

### PACER vs. Classic ROVER

| Classic ROVER | PACER's 3-Way Verdict |
|---|---|
| Align hypotheses to each other | Align each engine **independently to reference text** |
| Simple majority vote | Graded decision matrix (confirmed / disagreed / recovered / unconfirmed) |
| Output: single best transcript | Output: rich per-word annotation (type, cross-validation, timestamps, disfluencies, struggle paths) |
| No interpretation layer | 24-stage diagnostics pipeline (near-miss, self-correction, compound struggle, prosody) |
| Word-level only | Per-word story: duration, pace tier, phoneme count, engine agreement, struggle path, self-correction, disfluency context |

### What PACER Already Produces Per Word

> **Implementation note (codebase audit)**: Per-word data lives in **3 separate sources** that must be JOINed for full reconstruction. The serialization layer (Phase 1a) must handle this.

**Source 1 — Alignment entries** (`alignment[]`, direct fields):
- **type**: correct / substitution / omission / struggle / insertion (+ `deletion`, treated as omission)
- **crossValidation**: confirmed / disagreed / recovered / confirmed_omission / unconfirmed / unavailable (+ `pending` intermediate)
- **Engine agreement**: `hyp` (V1 heard), `_v0Word` / `_v0Type` (V0 heard/type), `_xvalWord` / `_pkType` (Parakeet heard/type), plus full attempt arrays (`_v1RawAttempt`, `_v0Attempt`, `_xvalAttempt`)
- **Struggle path**: `_strugglePath` = hesitation / decoding / abandoned / compound_fragments
- **Self-correction**: `_isSelfCorrection` boolean + `_partOfStruggle` (implicit — no unified `{attempted, target}` record; must be reconstructed from insertion near-miss analysis)
- **Forgiveness flags** (8 distinct flags): `forgiven`, `_forgivenEvidence`, `_forgivenEvidenceSource`, `_isOOV`, `_oovForgiven`, `_oovRecoveredViaUnknown`, `_functionWordCollateral`, `_postStruggleLeniency`
- **Compound info**: `compound` boolean, `parts[]`, `_abbreviationExpansion`, `_numberExpansion`
- **Confirmed insertion**: `_confirmedInsertion` boolean, `_insertionEngines` count
- **NL annotations**: `nl.tier` (proper / sight / academic / function), `nl.isProperNoun` — **only available when NL API is enabled**; null otherwise
- **Display**: `_displayRef` (cosmetic capitalization), `hypIndex` (index into transcriptWords)

**Source 2 — Word speed array** (`diagnostics.wordSpeed.words[]`, must JOIN by `refIndex`):
- **Word speed tier**: `tier` = quick / steady / slow / struggling / stalled / omitted / no-data
- **Pace ratio**: `ratio` = normalizedMs / medianMs (phoneme-normalized duration vs. student's median)
- **Duration**: `durationMs`, `normalizedMs` (per-phoneme), `phonemes` (CMUdict count)
- **Metadata**: `isOutlier`, `sentenceFinal` (warns duration may be inflated), `_tsSource` (xval / primary / none)

**Source 3 — TranscriptWords** (`transcriptWords[entry.hypIndex]`, accessed by `hypIndex`):
- **Timestamps**: `startTime` / `endTime` (primary), `_xvalStartTime` / `_xvalEndTime` (Parakeet), `_reverbStartTime` / `_reverbEndTime` (Reverb v1)
- **Disfluency**: `isDisfluency` boolean, `disfluencyType` = 'filler' (um/uh/hmm) — **only fillers are explicitly detected; repetitions and false starts are NOT separately classified** (they appear as insertions near struggle words)
- **STT metadata**: `confidence`, `source`, `crossValidation`

**Caveats discovered during audit**:
1. Timestamps are available during pipeline execution but **not persisted** in the saved alignment array — the serializer must pull from `transcriptWords` (which IS saved) or `diagnostics.wordSpeed`
2. `diagnostics.selfCorrections` is computed but **not saved** to `saveAssessment()` — must be fixed before Phase 1 can work on saved assessments
3. NL annotations (`entry.nl`) are null when NL API is unavailable — the serializer needs a graceful fallback

This is the richest per-word dataset in the automated ORF market. No competitor produces anything close.

---

## 3. Research: AI-Enhanced ROVER & ASR Fusion

### 3.1 Classical ROVER

ROVER (Recognizer Output Voting Error Reduction) was proposed by Jonathan Fiscus at NIST in 1997. Two stages:
1. **Word Transition Network (WTN) Construction**: Multiple ASR outputs aligned via dynamic programming into a composite network
2. **Voting**: Each branching point evaluated by majority vote or confidence-weighted scoring

Reference implementation: [NIST SCTK toolkit](https://github.com/usnistgov/SCTK/blob/master/doc/rover/rover.htm)

### 3.2 ML-Enhanced ROVER Variants

**QE-ROVER — ML Quality Estimation for Hypothesis Ranking**
- Paper: [Jalalvand et al., ACL 2015](https://aclanthology.org/P15-1106/) + [arXiv:1706.07238](https://arxiv.org/abs/1706.07238)
- Instead of relying on ASR decoder confidence scores, trains ML models to rank hypotheses at segment level before ROVER fusion
- Learns features that compensate for absent decoder information
- Results: 0.5–7.3% absolute WER improvement over standard ROVER
- **PACER relevance**: Could replace PACER's equal-weight 3-way voting with learned engine trust

**Apple: Neural Word Confidence via HWCN + Bidirectional Lattice RNN**
- Blog: [Apple ML Research](https://machinelearning.apple.com/research/on-modeling-asr-word-confidence)
- Code: [github.com/qiujiali/lattice_rnn](https://github.com/qiujiali/lattice_rnn)
- Proposed Heterogeneous Word Confusion Network (HWCN) scored by bidirectional lattice RNN
- Computes confidence over the full lattice structure (not just 1-best)
- Calibration enables reliable score comparison across different ASR models
- Result: Best-confidence word sequence outperforms default 1-best from any single recognizer
- **PACER relevance**: Could provide better per-word confidence than raw ASR scores

**MOVER — Meeting ROVER (Interspeech 2025)**
- Paper: [arXiv:2508.05055](https://arxiv.org/abs/2508.05055)
- Extends ROVER to meeting recognition where systems differ in both diarization and ASR
- 5-stage process: speaker alignment, segment grouping, word and timing combination
- 9.55% and 8.51% relative tcpWER improvements on CHiME-8 and NOTSOFAR-1 benchmarks

### 3.3 LLM-as-Arbiter (Generation 3)

**Multi-Pass Augmented Generative Error Correction (MPA GER)**
- Paper: [arXiv:2408.16180](https://arxiv.org/abs/2408.16180)
- Architecture: Takes N-best hypotheses from multiple ASR systems → runs each through multiple LLMs for correction → merges LLM-corrected outputs using ROVER
- Key finding: Different LLMs produce different hallucination patterns that cancel out during ROVER voting
- Especially effective for short utterances (<20 characters)
- **PACER relevance**: Natural next step — feed PACER's 3 engine outputs through an LLM for correction, then merge

**Crossmodal ASR Error Correction (SLT 2024)**
- Paper: [arXiv:2405.16677](https://arxiv.org/abs/2405.16677) / [GitHub](https://github.com/yc-li20/SLT2024-Crossmodal_AEC)
- Fuses RoBERTa text embeddings + HuBERT discrete speech units via cross-attention
- Transformer decoder generates corrected tokens
- Effective for low-resource out-of-domain correction
- **PACER relevance**: Audio-aware error correction could catch errors that text-only comparison misses

**Amazon: Generative Speech Recognition Error Correction with LLMs**
- Paper: [Amazon Science PDF](https://assets.amazon.science/77/26/6c265e0a42d7a40d2ee8bdd158e6/generative-speech-recognition-error-correction-with-large-language-models-and-task-activating-prompting.pdf)
- Uses LLM post-processing with N-best ASR hypotheses as input
- Zero/few-shot rescoring with task-activating prompts

**GenSEC Challenge (IEEE SLT 2024)**
- Hub: [HuggingFace GenSEC-LLM](https://huggingface.co/GenSEC-LLM) / [Challenge site](https://sites.google.com/view/gensec-challenge/home)
- Industry-standard benchmark for LLM-based post-ASR correction
- Three tasks: transcription correction, speaker tagging, emotion recognition
- Provides Llama-7b baselines and standardized datasets

**Confidence Module + Non-Autoregressive Decoder (Interspeech 2024)**
- Paper: [arXiv:2407.12817](https://arxiv.org/abs/2407.12817)
- Confidence module measures uncertainty per word, acoustic encoder provides pronunciation references
- Non-autoregressive decoder corrects errors at detected positions
- Result: 21% error rate reduction with fast decoding

### 3.4 ASR Error Correction Landscape (2024–2025)

From the [Emergent Mind survey](https://www.emergentmind.com/topics/asr-error-correction-aec):

| Era | Approach | Results |
|-----|----------|---------|
| Classical (2012) | Bing spelling suggestions, N-gram datasets | 5x error reduction, 89% relative WER reduction |
| Neural seq2seq (2022–2023) | BART + phoneme augmentation, N-best T5 | WER 22.4% → 19.8%, up to 12% relative improvement |
| Retrieval-augmented (2024) | Neural + knowledge bases | 33–39% relative WER reduction for rare entities |
| LLM-based (2024–2025) | Zero-shot (ineffective), LoRA fine-tuning (moderate), multimodal (dominant) | Qwen-Audio: 50%+ CER reduction; CoT: 21% CER reduction |
| **Child speech specific** | LLM-based correction | Up to 28.5% relative WER reduction (persistent gaps for insertions) |

---

## 4. Research: AI for Oral Reading Fluency Assessment

### 4.1 Key Academic Papers

**Prompting Whisper for Miscue Detection (Apple, Interspeech 2025)**
- Paper: [arXiv:2505.23627](https://arxiv.org/abs/2505.23627) / [Apple ML Research](https://machinelearning.apple.com/research/prompting-whisper)
- **Directly relevant to PACER**: Prompts Whisper with the reference text and adds special `<OMIT>`, `<SUBSTITUTE>`, `<INSERT>` tokens for end-to-end miscue detection
- Key finding: Prompting with reference text beats fine-tuning for verbatim transcription accuracy
- End-to-end approach outperforms post-hoc ASR-then-align methods
- Evaluated on children's read-aloud speech and adult atypical speech
- **PACER implication**: Could eventually replace post-hoc NW alignment entirely — ASR directly outputs miscue labels

**Deep Learning for Assessment of Oral Reading Fluency (2024)**
- Paper: [arXiv:2405.19426](https://arxiv.org/abs/2405.19426)
- Uses pre-trained wav2vec2.0 model on children's audio recordings
- W2VAligned architecture: pools wav2vec embeddings at word boundaries (from force-alignment)
- Produces utterance-level comprehensibility scores (0–5 scale)
- Probed for lexical and acoustic-prosodic features important to fluency perception

**Automatic Assessment of Oral Reading Accuracy (2023)**
- Paper: [arXiv:2306.03444](https://arxiv.org/abs/2306.03444)
- Evaluated 6 ASR systems (Kaldi + Whisper) for Dutch reading accuracy
- Key finding: Including reading errors in the language model improves assessment (MCC = .63 with human evaluations)
- Forced decoding confidence scores correlated with word correctness (r = .45)

**Two-Pass System for Reading Miscue Detection (Interspeech 2024)**
- Paper: [ISCA Archive](https://www.isca-archive.org/interspeech_2024/gothi24_interspeech.html)
- Dataset: 1,110 elementary school children reading L2 English
- Architecture: Hybrid ASR first pass → local features + deep acoustic model second pass for miscue refinement

**SERDA: Speech Enabled Reading Diagnostics (2025)**
- Paper: [Springer IJAIED](https://link.springer.com/article/10.1007/s40593-025-00480-y)
- Dutch ORF assessment providing detailed fluency components beyond WCPM
- Validated on 653 children across 19 Dutch primary schools

**Prosody in Automated ORF (2025)**
- Paper: [SAGE Journals](https://journals.sagepub.com/doi/10.1177/02655322251348956)
- Prosody inclusion reduces discrepancies between ELL and native English students
- ASR inaccuracies disproportionately affect certain populations

**Improving ORF Assessment Through Sub-Sequence Matching (ICASSP 2024)**
- Paper: [SMU PDF](https://s2.smu.edu/~eclarson/pubs/2024_icassp_orf.pdf)
- Uses contrastive learning, novel word-level acoustic embeddings, and modern TTS
- Sub-sequence matching to estimate WCPM

### 4.2 The Research Trend

The field is moving from simple WCPM scoring toward richer diagnostic assessment:
- **Miscue classification**: substitutions, omissions, insertions, self-corrections
- **Prosody analysis**: pause patterns, intonation, stress
- **Struggle detection**: hesitations, partial decoding attempts, abandoned words
- **Diagnostic narratives**: LLM-generated explanations of reading patterns

PACER already does the first three better than any system in the literature. The fourth is what this proposal is about.

---

## 5. Research: Competitive Landscape

### 5.1 Product Comparison

| Product | ASR Approach | AI Layer | Insight Depth | Key Feature |
|---|---|---|---|---|
| **Amira Learning** (HMH) | Single proprietary ASR (CMU heritage) | "Reading Rope Report", real-time micro-interventions, dyslexia flags | Medium | Scaffolded prompts during reading |
| **Literably** | Human-scored (<10% ASR) | Running records, error types | Medium | Accuracy over automation |
| **Seesaw** | Single engine (AWS Transcribe) | Basic WCPM + word additions/removals | Shallow | Built in 2 weeks with AWS |
| **Lexia RAPID** | Not ASR-based (adaptive activities) | "Class Action Plan" — automated teacher to-do list | Medium | Tells teachers what to do next |
| **mCLASS/Amplify** | Human administration required | DIBELS scoring + error patterns + small-group recommendations | Medium | Gold standard for DIBELS |
| **Wadhwani AI** | Fine-tuned ASR for Indian languages | 4-stage fluency cohorts + pause analyzer | Medium | 2.5M students in India |
| **NWEA MAP RF** | SRI International EduSpeak | Scaled WCPM + dyslexia screener + AI reading tutor | Medium | 0.99 inter-rater agreement |
| **PACER** | 3-engine consensus (Reverb dual + Parakeet) | 24-stage diagnostic pipeline, NO interpretation layer yet | **Deep** (data), **None** (interpretation) | Richest per-word data in market |

### 5.2 Actionable Patterns from Competitors

**Amira's "Reading Rope Report"**
- Breaks reading mastery into strands (phonological awareness, phonics, fluency, vocabulary, comprehension)
- "360-degree diagnostic profile of a student's reading brain"
- Claims to save teachers 90+ hours/year
- **PACER should emulate**: Multi-strand diagnostic breakdown

**Lexia's "Class Action Plan"**
- Translates data into a specific teacher to-do list
- "Which students need intervention, on what, right now?"
- **PACER should emulate**: Don't just report data — tell the teacher what to do next

**mCLASS Small-Group Recommendations**
- Analyzes error patterns → recommends small groups + explicit multi-sensory activities
- **PACER should emulate**: Group students by shared difficulty pattern

**Wadhwani's 4-Stage Fluency Classification**
- Alphabetic → Sub-lexical → Lexical → Fluent
- **PACER can do better**: 3 struggle paths + 7 speed tiers + self-correction data enable more nuanced classification

### 5.3 PACER's Competitive Advantage

**Nobody combines automated multi-engine ASR with a rich diagnostic pipeline AND an AI interpretation layer.** PACER has the first two; adding the third completes the picture.

The market validates the approach:
- Literably proves accuracy matters (they keep humans in the loop because single-engine ASR isn't reliable enough)
- Seesaw proves demand exists (saved teachers ~8 hours/week with basic ASR)
- Amira proves the AI interpretation layer is the value driver
- mCLASS proves human administration is a bottleneck the market wants eliminated

---

## 6. Research: RAG & Data Architecture

### 6.1 Why Vector RAG Is Wrong for PACER

PACER's data is **structured** (per-word alignment arrays with typed fields), not unstructured documents. The research is clear:

| Approach | Good At | Bad At | PACER Fit |
|---|---|---|---|
| **Vector DB** (Pinecone, Weaviate) | Semantic similarity over prose | Exact filtering, aggregation, relational joins | Wrong tool |
| **Structured DB** (PostgreSQL) | Exact queries, aggregation, time-series, joins | Semantic similarity, fuzzy matching | Core need |
| **Hybrid** (PostgreSQL + pgvector) | Both structured queries AND semantic search in one DB | Nothing major | **Best fit** |
| **Knowledge Graph** (Neo4j/GraphRAG) | Multi-hop relationship queries | Complexity, overkill for initial implementation | Future option |

### 6.2 When RAG DOES Make Sense for PACER

- **Not for single assessments**: The data fits in an LLM context window (~2–5K tokens for a 200-word passage)
- **Not for longitudinal queries**: Use SQL + summarization (text-to-SQL), not vector similarity
- **YES for teaching strategy retrieval**: If you add a knowledge base of reading intervention strategies, phonics scope and sequences, or Common Core standards, THEN RAG retrieves relevant strategies based on diagnosed weaknesses
- **YES for finding similar past sessions**: Embed session narrative summaries, use vector similarity to find "sessions where this student showed a similar pattern"

### 6.3 Feeding Structured Data to LLMs

From research on [prompt engineering for structured data](https://www.preprints.org/manuscript/202506.1937) and [Better Think with Tables (arXiv:2412.17189)](https://arxiv.org/html/2412.17189v2):

- **JSON format**: Best for hierarchical/nested data (PACER's per-word alignment results)
- **Markdown table format**: Improves LLM comprehension by ~40% over raw text for tabular data
- **Hybrid**: Use JSON for metadata/configuration, Markdown tables for per-word data
- **Token budget**: A 150-word PACER assessment ≈ 7,500 tokens of raw JSON, but with "interesting words only" strategy (errors + struggles + slow words as markdown table, correct-at-pace as summary count) ≈ **2,500 tokens** — ~60% savings
- **For longitudinal analysis** (10 sessions): Use summary tables per session, drill into specific words only when needed

### 6.4 Hierarchical Summarization for Long Histories

For students with 20+ sessions, use progressive summarization:
1. **Individual session summaries** (~200 tokens each)
2. **Monthly roll-ups** (summarize 4 weekly sessions into one paragraph)
3. **Semester-level summaries** (summarize monthly roll-ups)

Research on [CoTHSSum](https://link.springer.com/article/10.1007/s44443-025-00041-2) shows hierarchical segmentation + chain-of-thought prompting maintains factual accuracy while achieving 10:1+ compression ratios.

---

## 7. Research: LLM Diagnostic Interpretation

### 7.1 The Stanford Blueprint

**"LLMs as Educational Analysts: Transforming Multimodal Data Traces into Actionable Reading Assessment Reports"**
- Paper: [arXiv:2503.02099](https://arxiv.org/html/2503.02099)
- Authors: Davalos et al. (Stanford SCALE / Vanderbilt VALIANT, March 2025)
- **Open source**: [github.com/edavalosanaya/LLMsAsEducationalAnalysts](https://github.com/edavalosanaya/LLMsAsEducationalAnalysts)

**Architecture (3-stage pipeline)**:
1. **Unsupervised clustering**: K-Means on standardized reading behavior features → identifies patterns ("Steady Comprehenders," "Emerging Readers," "Rapid Scanners")
2. **Report Curator agent**: Structured data + teaching standards + cluster profiles → LLM generates Markdown reports
3. **Report Evaluator agent**: Assesses report quality on 9 dimensions (clarity, relevance, coherence, applicability, depth of insight, specificity, engagement, bias/fairness, use of evidence)

**Results**: Teachers rated 4.20/5, particularly valuing "succinct overviews with identified students" for instructional planning.

**PACER advantage**: Their input data was LESS rich than what PACER produces, and they still got strong results.

### 7.2 Prompt Architecture for Reading Diagnostics

**System prompt (role + constraints + data reliability guide)**:
```
You are a reading diagnostician analyzing an oral reading fluency assessment.
You will receive per-word assessment data including: word text, correctness
status, reading duration, pace relative to median, cross-validation status
across engines, struggle paths (hesitation/decoding/abandoned), self-corrections,
disfluency markers, and proper noun forgiveness flags.

DATA RELIABILITY GUIDE — weight your interpretations accordingly:
- crossValidation 'confirmed': HIGH confidence (2+ engines agree)
- crossValidation 'disagreed': MEDIUM (V1 said error, Parakeet said correct — Parakeet override)
- crossValidation 'unconfirmed': LOW (only V1 heard it — possible ASR artifact)
- crossValidation 'recovered': HIGH (V1 missed the word but Parakeet heard it correctly)
- _postStruggleLeniency: MEDIUM (Parakeet override after a struggle — could be wrong)
- Speed tier on sentence-final words (sentenceFinal=true): UNRELIABLE (duration inflated by natural pause)
- Disfluency fillers: HIGH (detected via dual-pass Reverb comparison)
- Forgiven proper nouns: MEDIUM (phonetic similarity >= 40% — student likely attempted the word)
- NL tier annotations: may be ABSENT (requires NL API) — do not assume word tiers if not provided

READING MISCUE TAXONOMY (from PACER's miscue registry):
- substitution: student said a different word
- omission: student skipped the word entirely
- struggle (hesitation): substitution + long pause (>= 500ms) before/after
- struggle (decoding): substitution + near-miss insertion fragments showing partial decoding
- struggle (abandoned): substitution + cross-validation 'unconfirmed' + near-miss to reference
- confirmed insertion: all engines heard an extra word the student added (counts as error)
- self-correction: student said wrong word then corrected themselves (detected via near-miss insertions)
- proper noun forgiveness: error on a proper noun with phonetic similarity >= 40% (not counted as error)
- OOV forgiveness: error on a word absent from the pronunciation dictionary (not counted as error)

Your output must follow the provided JSON schema exactly. Use evidence-based
reading science terminology. Write for a K-5 teacher audience — clear,
actionable, free of jargon. Never infer beyond what the data shows.
```

**Data injection — condensed assessment profile**:

> **Implementation note**: The profile below requires a serialization function (`buildAssessmentProfile()`) that JOINs data from 3 sources: alignment entries, word speed array, and transcriptWords. Fields like `passage.title` and `passage.level` require new UI inputs (with "Unknown" defaults). Disfluency `repetitions` must be inferred from `diagnostics.selfCorrections` (word-repeat type), as only fillers are explicitly tagged.

```json
{
  "student": "Jayden",
  "grade": 3,
  "passage": { "title": "The Fox and the Grapes", "wordCount": 187, "level": "G" },
  "metrics": { "wcpm": 47, "accuracy": 82, "atPacePercent": 61 },
  "errorBreakdown": {
    "wordErrors": 8,
    "omissions": 2,
    "confirmedInsertions": 1,
    "longPauseErrors": 1,
    "forgiven": 2
  },
  "errorPatterns": {
    "multisyllabicStruggles": ["adventure", "platforms", "enormous"],
    "omittedWords": ["through", "beautiful"],
    "selfCorrections": [{ "attempted": "wented", "target": "went", "corrected": true }],
    "confirmedInsertionWords": ["the"],
    "disfluencies": { "fillers": 3, "repetitions": 2 }
  },
  "paceProfile": {
    "quick": 22, "steady": 45, "slow": 18, "struggling": 8, "stalled": 3, "omitted": 4, "noData": 2
  },
  "strugglePaths": { "hesitation": 2, "decoding": 4, "abandoned": 1, "compoundFragments": 0 },
  "prosody": {
    "punctuationCoverage": 0.67,
    "punctuationPrecision": 0.82,
    "phraseLengthMedian": 4.2,
    "paceConsistency": "variable",
    "readingPattern": "word-by-word",
    "ungrammaticalPausesPer100": 3.2
  },
  "tierBreakdown": {
    "sight": { "correct": 40, "errors": 1 },
    "academic": { "correct": 35, "errors": 5 },
    "function": { "correct": 15, "errors": 0 },
    "proper": { "correct": 5, "errors": 1 }
  }
}
```

**Per-word data — "interesting words only" strategy** (40% better LLM comprehension + 60% token savings):

Instead of sending all 200 words, send:
1. **Summary line**: "147 words correct at pace (quick/steady), 12 correct but slow — omitted from table"
2. **Detail rows**: Only errors, struggles, self-corrections, stalled/struggling pace, forgiven words, confirmed insertions (~20-40 rows)

This saves ~60% of tokens while preserving all diagnostic signal.

```
Correct words at pace: 147 of 187 (quick/steady tier, not shown below)
Correct but slow: 12 words (slow tier, not shown)

| # | Ref       | Heard     | Verdict  | Engines V1/V0/Pk       | Duration | Tier       | Path      | Notes                                    |
|---|-----------|-----------|----------|------------------------|----------|------------|-----------|------------------------------------------|
| 5 | scampered | scamped   | struggle | sub/sub/correct        | 2100ms   | stalled    | decoding  | fragments: "scam-" + "pered"; 0+/2 syl (prefix, partial); Pk correct |
| 6 | through   | though    | sub      | sub/sub/correct        | 450ms    | slow       |           | disagreed — Pk overrode; self-corrected   |
| 9 | beautiful |           | omission | omit/omit/omit         |          | omitted    |           | confirmed omission (all engines)          |
|+11| the       | the       | +insert  | ins/ins/ins            | 120ms    | —          |           | confirmed insertion (3 engines)           |
| 15| Escondido | escaldio  | forgiven | sub/sub/sub            | 890ms    | struggling |           | proper noun, 67% match via Parakeet       |
```

**Few-shot examples**: Include 2–3 complete input→output examples covering:
- A strong reader with minor issues
- A struggling reader with clear patterns
- An edge case (proper noun errors, ASR artifacts)

**Structured output schema** (enforce via OpenAI Structured Outputs or Claude tool-use):
```json
{
  "summary": "string (2-3 sentences)",
  "strengths": ["string"],
  "concerns": ["string"],
  "patterns": [{
    "name": "string",
    "severity": "high | medium | low",
    "evidence_words": ["string"],
    "explanation": "string",
    "reading_science_link": "string",
    "recommendation": "string"
  }],
  "growth_indicators": ["string"],
  "fluency_stage": "alphabetic | sub-lexical | lexical | fluent",
  "next_steps": [{
    "strategy": "string",
    "specifics": "string",
    "priority": "high | medium | low"
  }]
}
```

### 7.3 Key Prompt Engineering Techniques

1. **Structured output enforcement**: Use `response_format` with `strict: true` (OpenAI) or tool-use mode (Claude). Define schema with Pydantic (Python) or Zod (TypeScript).

2. **Few-shot with domain examples**: Clinical NLP research shows few-shot prompting improves both consistency and contextual accuracy.

3. **Chain-of-thought for pattern identification**: Before generating the final report, have the LLM first identify patterns across the per-word data in a "thinking" step.

4. **Evidence grounding**: Every claim must cite specific words. Prompt: "For each concern, list the specific words that demonstrate it."

5. **Tiered output for different audiences**:
   - **Teacher dashboard**: 2–3 sentence summary + top 3 recommendations
   - **Detailed diagnostic**: Full pattern analysis with reading science terminology
   - **Parent report**: Simplified language, strengths-first framing
   - **Cross-session trend**: Comparison with previous sessions, growth tracking

### 7.4 Example LLM Output

Given the condensed profile above, the LLM would produce:

> Jayden reads single-syllable sight words fluently (most in quick/steady tier) but stalls consistently on multisyllabic words — 4 of 6 words with 3+ syllables triggered decoding struggles where he produced the first 1–2 syllables correctly then abandoned (per `_syllableCoverage` data). He self-corrected once ("wented" → "went"), showing morphological awareness. His 3 filler disfluencies clustered around unfamiliar vocabulary, suggesting he uses "um" as a processing buffer rather than a habit.
>
> **Recommendation**: Focus on syllable segmentation strategies for multisyllabic words; his decoding of initial syllables is strong — he needs tools to attack the rest of the word.

*Note: The syllable claims above are now data-grounded via `_syllableCoverage` on each struggle entry (see "Data Precision" section). The LLM can reference `syllablesCovered`, `totalSyllables`, and `position` directly from the condensed profile.*

---

## 8. The Two AI Layers PACER Needs

### Layer A: Single-Assessment Interpreter ("What just happened?")

**Goal**: Take the rich per-word output from one PACER assessment and produce a teacher-readable diagnostic narrative.

**Input**: Three data sources that must be JOINed (not just "the alignment array"):
1. `alignment[]` — per-word error classification, engine agreement, forgiveness, compound info
2. `diagnostics.wordSpeed.words[]` — speed tier, pace ratio, duration (JOIN by `refIndex`)
3. `transcriptWords[]` — timestamps, disfluency flags (JOIN by `entry.hypIndex`)

Plus: `wcpm`, `accuracy`, `tierBreakdown`, `diagnostics.prosody`, `diagnostics.selfCorrections`

**Architecture**:
```
PACER pipeline output (3 sources)
    ↓
Serialization layer: JOIN sources → aggregate patterns → build condensed profile
    ↓                   (new js/ai-serializer.js — ~150 lines)
    ↓
Token optimization: "interesting words only" markdown table + summary stats
    ↓                   (~2,500 tokens vs. ~7,500 for all words)
    ↓
LLM call (Claude/GPT-4) with:
    - System prompt (role + data reliability guide + miscue taxonomy)
    - Condensed profile (JSON + markdown table hybrid)
    - 2–3 few-shot examples
    ↓
Structured output: { narrative, patterns, recommendations, concerns }
```

This does NOT need RAG or a database. The data from a single assessment fits in context (~2,500 tokens with "interesting words only" strategy).

**Cost**: ~$0.01–0.03 per assessment (Haiku/GPT-4o-mini) or ~$0.10 (Opus/GPT-4)

### Layer B: Longitudinal Analyzer ("What's changing over time?")

**Goal**: Look at a child's assessment history across sessions to identify trends, growth, and persistent difficulties.

**Architecture**: SQL + summarization (NOT vector RAG)
```
1. SQL query: Pull assessment summaries for student X (last 6 months)
2. SQL query: Pull words student X has struggled with >2 times
3. Summarize into longitudinal profile (fits in context window)
4. LLM call: "Here are Jayden's 8 assessments from Sept–Feb..."
5. Output: growth narrative + persistent patterns + recommendations
```

---

## 9. Phase 1: Single-Assessment Interpreter

**Effort**: Low (1–2 days for prototype)
**Impact**: High (the single most requested missing feature)
**Infrastructure**: None new — browser calls LLM API directly

### Phase 1a: Serialization Layer (half-day)

Before the LLM can interpret anything, PACER needs a function that reconstructs the full per-word picture from its 3 separate data sources. This is the hardest part of Phase 1 — the LLM call itself is straightforward.

**New file**: `js/ai-serializer.js` (~150 lines)

**Core function**: `buildAssessmentProfile(alignment, diagnostics, transcriptWords, wcpm, accuracy, tierBreakdown, student, referenceText)`

**What it must do**:

1. **3-source JOIN** — For each alignment entry, look up:
   - Speed tier + pace ratio from `diagnostics.wordSpeed.words[]` (by `refIndex`)
   - Timestamps + disfluency flags from `transcriptWords[entry.hypIndex]`
   - Merge into unified per-word records

2. **6 new aggregations** (data exists but is not pre-computed):

   | Aggregation | Input | Logic |
   |-------------|-------|-------|
   | Multisyllabic struggles | `alignment` | Filter `type==='struggle'` + `countSyllables(ref) >= 2` |
   | Self-corrections | `alignment` | Filter insertions with `_isSelfCorrection`, pair with next correct entry |
   | Confirmed insertion words | `alignment` | Filter `_confirmedInsertion === true`, extract `hyp` |
   | Struggle path counts | `alignment` | Count by `_strugglePath` value |
   | Disfluency counts | `transcriptWords` | Count `isDisfluency && disfluencyType==='filler'`; infer repetitions from `diagnostics.selfCorrections` (word-repeat type) |
   | Passage word count | `referenceText` | `normalizeText(referenceText).length` |

3. **"Interesting words only" filter** — Include only:
   - Errors (substitution, omission, struggle)
   - Confirmed insertions
   - Words at struggling/stalled pace tier
   - Self-corrections
   - Forgiven words (proper noun, OOV)
   - Summary line for correct-at-pace words (count only)

4. **NL API fallback** — If `entry.nl` is null, omit `tierBreakdown` and word tier columns rather than showing incorrect data

**Bug fix required**: `diagnostics.selfCorrections` is computed in `diagnostics.js` but **not saved** by `saveAssessment()` in `app.js`. Must add it to the saved assessment object so reports can be generated from saved assessments, not just live pipeline runs.

**Optional UI additions**:
- Passage title input field (text input, optional, defaults to "Untitled")
- Passage reading level input (dropdown: A–Z or grade equivalent, optional)

### Phase 1b: LLM Integration (half-day)

**Implementation follows existing post-assessment button pattern** (same as `showPlaybackButton()`, `showMazeButton()`, etc. in `app.js:56-228`):

1. **Add "Generate AI Report" button** — injected via `insertAdjacentElement('afterend', btn)` after `displayAlignmentResults()`, alongside existing post-assessment buttons

2. **API key management** — follow existing pattern: `localStorage.getItem('orf_ai_api_key')`, with input field in settings area (same pattern as `orf_api_key` for Google Cloud)

3. **Call LLM API** with:
   - System prompt (reading diagnostician role + data reliability guide + miscue taxonomy from `miscue-registry.js`)
   - Condensed profile from Phase 1a (JSON + Markdown table hybrid, ~2,500 tokens)
   - 2–3 few-shot examples covering: strong reader, struggling reader, edge case (proper noun / ASR artifact)
   - Structured output schema (via Claude tool-use or OpenAI Structured Outputs)

4. **Display narrative** in a new collapsible section below metrics (same collapsible pattern as prosody section in `ui.js`)

5. **Cache the report** — store in the assessment object so regeneration isn't needed on revisit

6. **Optional: Two-agent pattern** (Curator generates report, Evaluator scores it on clarity/accuracy/relevance — iterate until quality threshold met)

### Serialization Gap Summary

| Data | Available? | Location | Aggregation Needed? |
|------|-----------|----------|-------------------|
| Student name/grade | Yes | `storage.js` students array | No |
| Passage title/level | **No** | No input fields exist | New UI inputs |
| Passage word count | **No** | Raw text available | `normalizeText().length` |
| WCPM, accuracy | Yes | `metrics.js` return values | No |
| atPacePercent | Yes | `diagnostics.wordSpeed.atPacePercent` | No |
| Error breakdown | Yes | `errorBreakdown` object | No |
| Multisyllabic struggles | **Yes** | `_syllableCoverage` on struggle entries | Filter + use `.syllablesCovered` / `.totalSyllables` |
| Self-corrections | **Not saved** | Computed but not in `saveAssessment()` | Fix persistence + extract pairs |
| Confirmed insertion list | **Partial** | `_confirmedInsertion` flag exists | Filter alignment |
| Struggle path counts | **Partial** | `_strugglePath` on entries | Count by value |
| Pace profile | Yes | `diagnostics.wordSpeed.distribution` | No |
| Prosody metrics | Yes | `diagnostics.prosody.*` | No |
| Disfluency counts (fillers) | **Partial** | `transcriptWords[].isDisfluency` | Count |
| Disfluency counts (repetitions) | **Not aggregated** | `diagnostics.selfCorrections` | Filter for word-repeat type |
| NL tier breakdown | Yes (when NL API on) | `tierBreakdown` | No (but needs null fallback) |

### Cost Estimates

| Model | Cost per 200-word assessment | Latency |
|---|---|---|
| Claude Haiku 4.5 | ~$0.01 | ~2s |
| GPT-4o-mini | ~$0.01 | ~2s |
| Claude Sonnet 4.5 | ~$0.05 | ~4s |
| GPT-4o | ~$0.05 | ~4s |
| Claude Opus 4.6 | ~$0.10 | ~8s |

With "interesting words only" optimization, token usage drops ~60%, keeping costs at the lower end.

For a teacher running 25 assessments, total cost: $0.25–$2.50.

### Data Precision: Syllable-Level Analysis (Implemented)

**The problem**: PACER's `isNearMiss()` detection is character-based (shared prefix/suffix >= 3 chars OR Levenshtein ratio >= 0.4). This means the pipeline knows "the fragment shares a 5-character prefix with the target" but NOT "the student decoded the first 2 of 3 syllables." Without syllable-level data, the LLM must either infer syllable claims from character patterns (unreliable — syllable boundaries don't align with character counts) or avoid syllable-level claims entirely.

**The options evaluated**:

1. **Build syllable coverage analysis** — then the LLM claims are data-grounded
2. **Constrain the LLM** to only make character-level claims ("produced a near-miss with 67% similarity") — accurate but not useful to teachers who think in syllables
3. **Accept the inference gap** and add a disclaimer ("syllable analysis is approximate") — what most competitors do

**Option 1 was implemented** (`js/syllable-analysis.js`, ~475 lines):

- `syllabifyWord(word)` — Rule-based Maximum Onset Principle syllabifier, cross-validated against `countSyllables()` exception dictionary. When counts disagree, falls back to consonant-boundary splitting with the validated count.
- `analyzeSyllableCoverage(fragment, refWord)` — Measures how many complete syllables of a reference word a near-miss fragment covers. Returns `{syllablesCovered, totalSyllables, coverageRatio, position, coveredSyllables, partialNext}`.
- `analyzeFragmentsCoverage(fragments, refWord)` — Same analysis for multiple fragments (concatenated, as in `_nearMissEvidence`).

**Pipeline integration**: After all struggle paths are assigned (Path 2 decoding from `resolveNearMissClusters`, Paths 1/3 hesitation/abandoned from `detectStruggleWords`), every struggle entry with `ref.length >= 4` gets `_syllableCoverage` annotated on it. Visible in the UI tooltip for struggle words.

**What the LLM can now say** (data-grounded):
> "Jayden decoded the first 2 of 3 syllables of 'adventure' (ad|ven|ture → produced 'adven') but abandoned the final syllable."

**What it still cannot say** (would require phoneme-level alignment, not built):
> "Jayden substituted the /ʧ/ in 'ture' with /tər/, suggesting confusion between the -ture and -ter endings."

The system prompt should instruct the LLM to use `_syllableCoverage` data when present and avoid syllable-level claims when it's absent.

---

## 10. Phase 2: Session Persistence & Data Architecture

### Recommended Database: Supabase (PostgreSQL + pgvector)

| Criterion | Supabase | Firestore | SQLite |
|---|---|---|---|
| Relational queries (student → sessions → words) | Native SQL with JOINs | Requires denormalization | Native SQL |
| JSONB for flexible per-word annotations | Built-in with GIN indexes | Native (document store) | JSON1 (limited) |
| Vector embeddings (for RAG over sessions) | pgvector extension | Not built-in | Not available |
| Real-time subscriptions | Built-in | Built-in (superior) | Not available |
| Offline-first | PowerSync add-on | Built-in (superior) | Native |
| Open source / self-hostable | Yes | No | Yes |
| LLM integration | LlamaIndex integration | Manual | Manual |

### Proposed Schema

```sql
-- Core tables
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  grade INTEGER,
  school_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE passages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  grade_level INTEGER,
  word_count INTEGER,
  reference_words JSONB  -- ["The", "little", "dog", ...]
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id) NOT NULL,
  passage_id UUID REFERENCES passages(id) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  audio_url TEXT,
  -- Top-level metrics (fast queries without joining words)
  wcpm NUMERIC(5,1),
  accuracy NUMERIC(5,2),
  total_words INTEGER,
  total_errors INTEGER,
  error_breakdown JSONB,     -- {substitutions: N, omissions: N, ...}
  disfluency_summary JSONB,  -- {fillers: N, repetitions: N, ...}
  median_word_pace_ms NUMERIC,
  -- AI-generated (cached after Phase 1 report generation)
  ai_summary JSONB,
  summary_embedding vector(1536)
);

-- Per-word assessment data
-- NOTE: High-query fields promoted to columns for fast longitudinal queries.
-- Querying JSONB with GIN indexes is fast for existence checks but slow for
-- aggregation (e.g., "count all struggles with path='decoding' across 20 sessions").
-- Promoting verdict, cross_validation, speed_tier, struggle_path to columns
-- enables simple WHERE/GROUP BY without JSONB extraction.
CREATE TABLE word_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) NOT NULL,
  ref_index INTEGER NOT NULL,
  ref_word TEXT NOT NULL,
  verdict TEXT NOT NULL,           -- correct, substitution, omission, struggle, insertion
  hyp_word TEXT,
  cross_validation TEXT,           -- confirmed, disagreed, recovered, unconfirmed, unavailable
  speed_tier TEXT,                 -- quick, steady, slow, struggling, stalled, omitted, no-data
  struggle_path TEXT,              -- hesitation, decoding, abandoned, compound_fragments (NULL if not struggle)
  duration_ms NUMERIC,            -- phoneme-normalized duration
  pace_ratio NUMERIC,             -- ratio to student's median pace
  forgiven BOOLEAN DEFAULT false,  -- any forgiveness path applied
  annotations JSONB NOT NULL DEFAULT '{}',
  /* annotations contains (lower-query fields):
    engines: {v1: {word, type}, v0: {word, type}, pk: {word, type}},
    struggle: {fragments[], self_correction, pause_before_ms},
    disfluency: {type, context[]},
    forgiven_detail: {reason, evidence_source, similarity},
    compound: {parts[], merged, abbreviation_expansion, number_expansion},
    phoneme_count, is_sentence_final, nl_tier
  */
  UNIQUE(session_id, ref_index)
);

-- Derived analytics (computed per-session for fast longitudinal queries)
CREATE TABLE session_analytics (
  session_id UUID REFERENCES sessions(id) PRIMARY KEY,
  student_id UUID NOT NULL,
  multisyllabic_accuracy NUMERIC,
  sight_word_accuracy NUMERIC,
  self_correction_rate NUMERIC,
  struggle_word_count INTEGER,
  avg_pause_at_punctuation_ms NUMERIC,
  pct_words_at_pace NUMERIC,
  error_pattern_tags TEXT[],
  growth_vs_previous JSONB  -- {wcpm_delta: +5, accuracy_delta: +2.1, ...}
);

-- Materialized view for persistent word struggles
CREATE TABLE student_word_history (
  student_id UUID NOT NULL,
  word TEXT NOT NULL,
  total_encounters INTEGER,
  correct_count INTEGER,
  last_type TEXT,
  struggle_paths TEXT[],
  dates TIMESTAMPTZ[],
  PRIMARY KEY (student_id, word)
);

-- Indexes
CREATE INDEX idx_word_assessments_session ON word_assessments(session_id);
CREATE INDEX idx_word_assessments_verdict ON word_assessments(verdict);
CREATE INDEX idx_word_assessments_struggle ON word_assessments(struggle_path) WHERE struggle_path IS NOT NULL;
CREATE INDEX idx_word_assessments_speed ON word_assessments(speed_tier);
CREATE INDEX idx_sessions_student ON sessions(student_id, recorded_at DESC);
CREATE INDEX idx_word_annotations ON word_assessments USING GIN (annotations);
```

### Three-Tier Context Retrieval

**Tier 1 — Session Summaries (always included, ~200 tokens each)**:
```json
{
  "date": "2026-02-10",
  "wcpm": 87,
  "accuracy": 94.2,
  "top_struggles": ["multisyllabic decoding", "vowel teams"],
  "strengths": ["sight word automaticity", "self-correction"],
  "notable_words": [
    {"word": "gathered", "issue": "decoding struggle, self-corrected"},
    {"word": "beautiful", "issue": "abandoned after 'beau-'"}
  ],
  "comparison_to_previous": "WCPM +4, accuracy -1.2%, fewer omissions"
}
```

**Tier 2 — Pattern Aggregations (computed on demand, ~300 tokens)**:
```sql
-- Uses promoted columns (verdict, struggle_path) for fast aggregation
-- No JSONB extraction needed
SELECT ref_word, COUNT(*) as struggle_count,
       array_agg(DISTINCT struggle_path) as struggle_types,
       AVG(pace_ratio) as avg_pace_ratio
FROM word_assessments wa
JOIN sessions s ON wa.session_id = s.id
WHERE s.student_id = $1
  AND wa.verdict IN ('struggle', 'substitution', 'omission')
GROUP BY ref_word
HAVING COUNT(*) >= 2
ORDER BY struggle_count DESC LIMIT 20;
```

**Tier 3 — RAG for Deep Dives (vector similarity over session narratives)**:
When teacher asks: "Has Jayden improved on multisyllabic words?" → vector search retrieves relevant past sessions → include their detailed per-word data in context.

---

## 11. Phase 3: Longitudinal Insights

### Cross-Session Enrichment of Single-Assessment Reports

> **Key insight**: Even Phase 1 reports become dramatically better when the serializer can query `student_word_history`. Knowing "this student has struggled with 'beautiful' in 3 of 4 sessions" transforms a single-assessment observation into a longitudinal pattern. This is a key differentiator over competitors who treat each assessment in isolation.
>
> Once Phase 2 persistence exists, Phase 1's `buildAssessmentProfile()` should optionally include a `persistentStruggles` field: words the student has failed on >= 2 times across sessions. The LLM can then say *"'beautiful' remains a persistent difficulty (failed in 3 of 4 sessions)"* instead of just *"'beautiful' was omitted."*

### Student Profile Generation

After 3+ sessions, generate a longitudinal student profile:

```
1. Retrieve session summaries (Tier 1) for last 6 months
2. Retrieve persistent word struggles (student_word_history)
3. Compute growth trajectories (WCPM trend, accuracy trend, pace improvement)
4. Identify persistent patterns vs. resolved patterns
5. Send to LLM with chain-of-thought prompting
6. Generate longitudinal narrative
```

**Example output**:

> Over 8 sessions from September to January, Jayden's WCPM increased from 42 to 67 (+59%), but his accuracy on words with 4+ phonemes has remained flat at 61%. He consistently decodes the first syllable correctly but abandons attempts on the second syllable. He self-corrects on high-frequency words (12 of 14 attempts) but not on content vocabulary. His pace improved most on function words and sight words, suggesting automaticity is building for familiar words.
>
> **Persistent difficulty**: Multisyllabic word decoding (present in 7 of 8 sessions)
> **Growth area**: Self-correction rate improved from 15% to 42%
> **Recommendation**: Focus on syllable segmentation strategies for multisyllabic content words; his decoding of initial syllables is strong — he needs tools to attack the rest of the word.

### Classroom-Level Analysis

With data from multiple students, generate class-level insights:
- Group students by shared difficulty patterns (like Wadhwani's fluency stages but more granular)
- "Class Action Plan" (like Lexia): Which students need intervention, on what, right now?
- Identify passage-specific difficulties (passages that trip up many students)

---

## 12. Phase 4: LLM-Enhanced ASR Error Correction (Deprioritized)

> **Deprioritization note**: This is the most ambitious phase with the lowest marginal ROI. PACER's 3-way verdict + 24-stage pipeline already handles most edge cases through hand-tuned heuristics (spillover consolidation, compound merge, abbreviation expansion, number expansion, OOV recovery, proper noun forgiveness, etc.). The interpretation gap (Phases 1-3) is far larger than the accuracy gap. Phase 4 should only be pursued after Phases 1-3 are deployed and teacher feedback identifies specific verdict errors the pipeline consistently gets wrong.

This is the most ambitious phase — using an LLM to improve the ASR pipeline itself.

### Concept: MPA GER Pattern for PACER

After PACER's 3-way verdict, add an LLM pass that sees:
- All 3 engine outputs for each reference word
- The current verdict
- The reference text
- Surrounding context (previous/next words, struggle patterns)

The LLM can override decisions the pipeline got wrong, especially for:
- Ambiguous cases where engines disagree
- Edge cases the rule-based heuristics miss
- Context-dependent corrections ("the student clearly said the right word based on surrounding context")

### Requirements
- Labeled data (teacher corrections of PACER's output) for validation
- A/B testing framework to measure improvement
- Latency budget (~2–4s additional per assessment)

### Alternative: Prompted Whisper (Apple Approach)

Instead of post-hoc correction, replace or augment the ASR step itself:
- Prompt Whisper with the reference text
- Add `<OMIT>`, `<SUBSTITUTE>`, `<INSERT>` tokens to vocabulary
- ASR directly outputs miscue classifications
- Could run as a 4th engine alongside Reverb + Parakeet

---

## 13. Implementation Stack Recommendation

### Phase 1a — Serialization (Immediate)
- **New file**: `js/ai-serializer.js` (~150 lines) — 3-source JOIN + 6 aggregation functions
- **Bug fix**: Persist `diagnostics.selfCorrections` in `saveAssessment()` (app.js)
- **Optional UI**: Passage title/level input fields (index.html)

### Phase 1b — LLM Integration (Immediate)
- **LLM**: Claude API (tool-use for structured output) or OpenAI GPT-4o (Structured Outputs)
- **Orchestration**: Direct API calls from browser (no framework needed)
- **Storage**: None (assessment data exists in memory during session); report cached on assessment object
- **UI**: New collapsible section in ui.js + "Generate AI Report" button (follows existing post-assessment button pattern)

### Phase 2 (Near-term)
- **Database**: Supabase (PostgreSQL + pgvector + pg_jsonschema)
- **Schema**: As described in Section 10
- **Data pipeline**: After each assessment → store raw alignment JSON → compute derived analytics → generate session summary → embed narrative

### Phase 3 (Medium-term)
- **Orchestration**: LangChain/LangGraph for multi-step retrieval + analysis, OR direct SQL queries + LLM calls (simpler, fewer dependencies)
- **Agents**: Curator + Evaluator two-agent pattern (from Stanford paper)
- **Teaching strategy RAG**: Vector search over a knowledge base of reading interventions

### Phase 4 (Future)
- **ASR enhancement**: MPA GER pattern or prompted Whisper as 4th engine
- **Training data**: Teacher corrections as labeled examples
- **Evaluation**: GenSEC Challenge benchmarks

---

## 14. Sources & References

### ROVER & ASR Fusion
- [NIST SCTK ROVER Documentation](https://github.com/usnistgov/SCTK/blob/master/doc/rover/rover.htm)
- [Driving ROVER with Segment-based ASR QE — Jalalvand et al., ACL 2015](https://aclanthology.org/P15-1106/)
- [Automatic Quality Estimation for ASR System Combination — arXiv:1706.07238](https://arxiv.org/abs/1706.07238)
- [LV-ROVER: Lexicon Verified ROVER — arXiv:1707.07432](https://arxiv.org/abs/1707.07432)
- [Apple: On Modeling ASR Word Confidence — ICASSP 2020](https://machinelearning.apple.com/research/on-modeling-asr-word-confidence)
- [BiLatticeRNN GitHub](https://github.com/qiujiali/lattice_rnn)
- [MOVER: Meeting ROVER — arXiv:2508.05055](https://arxiv.org/abs/2508.05055)
- [Multi-Pass Augmented GER — arXiv:2408.16180](https://arxiv.org/abs/2408.16180)
- [Amazon: Generative Speech Recognition Error Correction with LLMs](https://assets.amazon.science/77/26/6c265e0a42d7a40d2ee8bdd158e6/generative-speech-recognition-error-correction-with-large-language-models-and-task-activating-prompting.pdf)
- [GenSEC Challenge — HuggingFace](https://huggingface.co/GenSEC-LLM) / [Challenge Site](https://sites.google.com/view/gensec-challenge/home)
- [Crossmodal ASR Error Correction — arXiv:2405.16677](https://arxiv.org/abs/2405.16677) / [GitHub](https://github.com/yc-li20/SLT2024-Crossmodal_AEC)
- [Confidence Module + NAR Decoder — arXiv:2407.12817](https://arxiv.org/abs/2407.12817)
- [Denoising GER — arXiv:2509.04392](https://arxiv.org/abs/2509.04392)
- [ASR Error Correction: Methods & Advances — Emergent Mind](https://www.emergentmind.com/topics/asr-error-correction-aec)

### Oral Reading Fluency Assessment
- [Prompting Whisper for Miscue Detection — arXiv:2505.23627 / Apple ML Research](https://machinelearning.apple.com/research/prompting-whisper)
- [Deep Learning for Assessment of ORF — arXiv:2405.19426](https://arxiv.org/abs/2405.19426)
- [Automatic Assessment of Oral Reading Accuracy — arXiv:2306.03444](https://arxiv.org/abs/2306.03444)
- [Two-Pass System for Reading Miscue Detection — Interspeech 2024](https://www.isca-archive.org/interspeech_2024/gothi24_interspeech.html)
- [SERDA: Speech Enabled Reading Diagnostics — Springer IJAIED 2025](https://link.springer.com/article/10.1007/s40593-025-00480-y)
- [Prosody in Automated ORF — SAGE 2025](https://journals.sagepub.com/doi/10.1177/02655322251348956)
- [ORF Sub-Sequence Matching — ICASSP 2024](https://s2.smu.edu/~eclarson/pubs/2024_icassp_orf.pdf)
- [ASR in the Modern Era Survey — arXiv:2510.12827](https://arxiv.org/html/2510.12827v1)

### Competitors & Products
- [Amira Learning](https://amiralearning.com/how-it-works) / [Science](https://amiralearning.com/science-of-reading) / [Intelligent Growth Engine](https://amiralearning.com/amira-learning-unveils-ai-powered-intelligent-growth-engine)
- [Literably Scoring Methodology](https://literably.zendesk.com/hc/en-us/articles/360046318332)
- [Seesaw AWS Case Study](https://aws.amazon.com/blogs/publicsector/seesaw-builds-ai-powered-reading-assessment-tool-to-support-elementary-literacy-with-aws/) / [Reading Fluency](https://seesaw.com/features/reading-fluency-assessment/)
- [Lexia AI-Powered Insights](https://www.lexialearning.com/resources/guides/ai-powered-insights-lexias-real-time-visibility-into-student-and-school-performance)
- [Amplify mCLASS](https://amplify.com/programs/mclass/) / [DIBELS 8th Edition](https://dibels.amplify.com/assessment/dibels-eighth-edition)
- [Wadhwani AI ORF](https://www.wadhwaniai.org/programs/oral-reading-fluency/) / [MIT Solve](https://solve.mit.edu/challenges/2024-global-learning-challenge/solutions/83943)
- [NWEA MAP Reading Fluency](https://www.nwea.org/map-reading-fluency/)

### RAG & Data Architecture
- [RAG for Educational Applications — ScienceDirect Survey 2025](https://www.sciencedirect.com/science/article/pii/S2666920X25000578)
- [LLM-Powered Automated Assessment — arXiv:2601.06141](https://arxiv.org/abs/2601.06141)
- [RAG Is More Than Just Vector Search](https://www.tigerdata.com/blog/rag-is-more-than-just-vector-search)
- [pgvector 2026 Guide](https://www.instaclustr.com/education/vector-database/pgvector-key-features-tutorial-and-pros-and-cons-2026-guide/)
- [PostgreSQL JSONB Best Practices — AWS](https://aws.amazon.com/blogs/database/postgresql-as-a-json-database-advanced-patterns-and-best-practices/)
- [LlamaIndex Structured Data](https://developers.llamaindex.ai/python/framework/understanding/putting_it_all_together/structured_data/)
- [LangChain Text-to-SQL RAG](https://medium.com/@dharamai2024/building-a-text-to-sql-chatbot-with-rag-langchain-fastapi-and-streamlit-0a8f43488a08)
- [Neo4j Advanced RAG Techniques](https://neo4j.com/blog/genai/advanced-rag-techniques/)

### LLM Diagnostic Interpretation
- [LLMs as Educational Analysts — arXiv:2503.02099 / Stanford SCALE](https://arxiv.org/html/2503.02099) / [GitHub](https://github.com/edavalosanaya/LLMsAsEducationalAnalysts)
- [OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
- [Claude Prompting Best Practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [Better Think with Tables — arXiv:2412.17189](https://arxiv.org/html/2412.17189v2)
- [Prompt Engineering for Structured Data](https://www.preprints.org/manuscript/202506.1937)
- [Clinical NLP Prompt Engineering Study](https://pmc.ncbi.nlm.nih.gov/articles/PMC11036183/)
- [CoTHSSum: Structured Long-Document Summarization](https://link.springer.com/article/10.1007/s44443-025-00041-2)
- [LLMs for Longitudinal Experiential Data — arXiv:2503.21617](https://arxiv.org/html/2503.21617v1)

### Frameworks & Tools
- [LangChain for EdTech](https://edtechinsiders.substack.com/p/how-langchain-can-democratize-llm)
- [LangGraph GitHub](https://github.com/langchain-ai/langgraph)
- [LlamaIndex + Supabase Integration](https://supabase.com/docs/guides/ai/integrations/llamaindex)
- [Supabase vs Firebase Comparison](https://www.bytebase.com/blog/supabase-vs-firebase/)
- [SpeechBrain](https://speechbrain.github.io/)
- [KA-RAG: Knowledge Graph + Agentic RAG](https://www.mdpi.com/2076-3417/15/23/12547)
