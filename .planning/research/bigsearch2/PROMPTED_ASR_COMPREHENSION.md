# Phase 2 Research: Prompted ASR, Comprehension, Passage Control & Equity

**Research Date:** 2026-02-06
**Status:** Complete deep dive across 6 domains

---

## Table of Contents
1. [Prompted / Constrained ASR](#1-prompted--constrained-asr)
2. [Forced Alignment Tools](#2-forced-alignment-tools)
3. [Comprehension Measurement](#3-comprehension-measurement)
4. [Passage Difficulty Control](#4-passage-difficulty-control)
5. [Dialect-Aware / Equity-Conscious Scoring](#5-dialect-aware--equity-conscious-scoring)
6. [Hasbrouck-Tindal Norms](#6-hasbrouck-tindal-norms)
7. [Implementation Recommendations](#7-implementation-recommendations-for-this-project)

---

## 1. Prompted / Constrained ASR

### 1.1 Apple's "Prompted Whisper" (2025)

**Paper:** "Prompting Whisper for Improved Verbatim Transcription and End-to-end Miscue Detection"
**Authors:** Apple ML Research team
**Published:** May 2025, arXiv:2505.23627, presented at Interspeech 2025

#### How It Works (Technical Details)

The system modifies Whisper's decoder architecture in two key ways:

1. **Reference text as decoder prompt:** The target reading passage is tokenized and prepended to Whisper's `<sot>` (Start of Token) marker. The model sees the expected text before generating its transcription. Critically, the computed loss considers ONLY predicted verbatim transcriptions and miscue detections — preventing the model from simply learning to parrot back the prompt.

2. **Special miscue tokens added to vocabulary:** Three new tokens augment the Whisper tokenizer:
   - `<omit>` — word in reference that was not read aloud
   - `<substitute>` — a different word was read instead
   - `<insert>` — a word was added that wasn't in the reference
   - `<correct>` — word was read properly (used during evaluation)

#### Results on Children's Speech

Using Whisper medium.en on children's dataset (Xc = 124,000+ utterances, 367 children aged 5-9):

| Configuration | WER |
|---|---|
| Untuned, unprompted | 9.7% +/- 1.4 |
| Tuned, prompted | 7.9% +/- 1.3 |
| **End-to-end (tuned + prompted + miscue tokens)** | **3.9% +/- 0.4** |

Generalization on CMU Kids Corpus (5,000+ utterances, ages 6-11):
- Tuned + prompted: 15.0% WER
- End-to-end: 11.9% +/- 0.3 WER

#### Miscue Detection F1 Scores (medium.en on Xc)
- Substitution F1: 0.519
- Omission F1: 0.518
- Insertion F1: 0.616

**Important finding:** Post-hoc calculation from E2E transcripts outperformed direct E2E prediction for miscue detection. This means even with prompted ASR, post-hoc alignment (what our tool currently does) may still be the best approach for miscue classification.

#### Model Sizes Tested
- tiny.en, small.en, medium.en (all trained on 680k hours)
- Larger models performed better overall
- Smaller models benefited MORE from the miscue detection task (suggesting it acts as a regularizer)

#### Training Details
- 70/10/20 train/validation/test split, no speaker overlap
- 3 trials with randomized splits, results averaged
- Loss excludes prompt tokens (model doesn't learn to reproduce the reference)

### 1.2 Can This Be Replicated with Open-Source Models?

**Short answer: Yes, with significant engineering effort.**

#### Whisper (OpenAI) — Most Promising Path

Whisper already supports `prompt_ids` via `get_prompt_ids()` in HuggingFace Transformers. The reference text can be passed as a "previous context window" using `<|startofprev|>` token:

```python
from transformers import WhisperProcessor, WhisperForConditionalGeneration

processor = WhisperProcessor.from_pretrained("openai/whisper-medium.en")
model = WhisperForConditionalGeneration.from_pretrained("openai/whisper-medium.en")

# Feed reference text as prompt
prompt_ids = processor.get_prompt_ids("The dog ran across the yard")
generated_ids = model.generate(
    input_features,
    prompt_ids=prompt_ids,
    prompt_condition_type="all-segments"
)
```

**What's needed to replicate Apple's approach:**
1. Fine-tune Whisper with reference text prepended to decoder input
2. Add special tokens (`<omit>`, `<substitute>`, `<insert>`) to tokenizer
3. Train with loss masking on prompt tokens
4. Need labeled read-aloud dataset with miscue annotations

**Available tools:**
- HuggingFace `transformers` for fine-tuning (`WhisperForConditionalGeneration`)
- SpeechBrain's `S2SWhisperBeamSearcher` for beam search with prompting
- `prefix_allowed_tokens_fn` for constrained beam search at each step

#### Parakeet (NVIDIA NeMo) — Strong Alternative

- Parakeet TDT 0.6B v3 sits atop HuggingFace OpenASR leaderboard (as of May 2025)
- NeMo Forced Aligner (NFA) provides word-level and token-level timestamps using CTC
- NFA can accept user-provided reference text for alignment
- However: no native "prompted decoding" like Whisper — would need custom work

#### Reverb (wenet) — Current System

- No prompted decoding support
- CTC-based, so forced alignment is possible but not native
- The 100ms timestamp granularity issue (single BPE tokens) limits precision
- **Verdict:** Keep as-is for now; prompted Whisper would be a future upgrade path

### 1.3 Constrained Decoding Approaches

#### Weighted Finite-State Transducer (WFST) Constrained Decoding

The most sophisticated approach for reading assessment, used in research systems:

1. **Unconstrained phoneme recognizer** produces a phoneme lattice
2. **WFST models the expected sentence** at phoneme level
3. The WFST includes paths for:
   - Correct reading (expected phonemes)
   - Substitutions (alternative phoneme sequences)
   - Insertions (extra phonemes between expected words)
   - Omissions (skip paths)
   - Hesitations and repetitions
4. **Viterbi search** finds the best path through the lattice given the WFST constraints

**Two-Pass System (Gothi et al., Interspeech 2024):**
- First pass: Hybrid ASR generates initial hypotheses
- Second pass: Local features from alternate decodings under different linguistic constraints
- Deep acoustic model provides additional scoring
- Dataset: 1,110 elementary students reading L2 English

**Dutch Children Study (Gao et al., 2024):**
- HuBERT Large finetuned: 23.1% PER (phoneme error rate) — best phoneme-level
- Whisper Large-v2: 9.8% WER — best word-level
- Wav2Vec2 Large: 0.83 recall for miscue detection
- Whisper: 0.52 precision and F1 for miscue detection
- **Key finding:** Wav2Vec2 and Whisper are complementary — one excels at recall, the other at precision

#### Comparison: Constrained vs. Unconstrained + Post-Hoc Alignment

| Approach | Pros | Cons |
|---|---|---|
| **Unconstrained ASR + post-hoc alignment** (our current approach) | Simple pipeline, model-agnostic, easy to debug, works with any ASR | 2-step error propagation, ASR errors cascade to alignment |
| **Prompted ASR (Apple)** | 3.9% WER (60% reduction), model sees reference context | Requires fine-tuning, may hallucinate reference text |
| **WFST constrained decoding** | Phoneme-level precision, models expected errors directly | Complex to implement, requires phoneme recognizer, slow |
| **Forced alignment with reference** | Direct timestamp alignment, phoneme-level fit scores | Cannot detect insertions well, assumes mostly correct reading |

**Recommendation for this project:** Our current unconstrained + post-hoc approach is pragmatic and working. The highest-impact upgrade would be adding prompted Whisper as a third ASR source (alongside Reverb and Deepgram), then cross-validating across all three.

---

## 2. Forced Alignment Tools

### 2.1 Tool Comparison

| Tool | Basis | Phoneme-Level | Word-Level | Speed | Children Tested | Notes |
|---|---|---|---|---|---|---|
| **Montreal Forced Aligner (MFA)** | Kaldi (HMM-DNN) | Yes | Yes | ~1x real-time | Yes (ages 3-7) | Gold standard for research |
| **NeMo Forced Aligner (NFA)** | CTC neural models | Yes (token) | Yes | Fast (GPU) | Not specifically | Best for NeMo/Parakeet users |
| **WhisperX** | Whisper + wav2vec2 | Yes (phoneme) | Yes | Batch parallel | Limited testing | Best for Whisper users |
| **Gentle** | Kaldi (TDNN, ASpIRE) | No | Yes | ~1x real-time | Not tested | "Robust yet lenient" |
| **Kaldi (raw)** | HMM-GMM/DNN | Yes | Yes | Variable | Research only | Maximum flexibility, steep learning curve |

### 2.2 Montreal Forced Aligner (MFA) — Deep Dive

**Study: "Performance of Forced-Alignment Algorithms on Children's Speech" (Mahr et al., 2021)**

Tested 5 algorithms on 42 children aged 3-7 years:

| Algorithm | Overall Accuracy | Notes |
|---|---|---|
| **MFA with SAT** | **86%** | Best performer, approaches human reliability |
| MFA without SAT | ~80% | Still strong |
| Kaldi triphone | ~75% | Decent baseline |
| P2FA (Penn) | ~70% | Older system |
| Prosodylab-Aligner | ~68% | Weakest |

**Key findings:**
- MFA-SAT (Speaker Adaptive Training) achieved 70-89% agreement with human raters
- Human inter-rater agreement was 85-96%
- Vowels: 90% accuracy (best)
- Fricatives: lowest accuracy, but improves with age
- Recommendation: Use "semi-automated workflow" — auto-align first, then manually correct ~1 min per min of speech

**MFA 3.X Features:**
- Pretrained acoustic models and G2P models for 14+ languages
- Can train custom models on new data
- Outputs TextGrid files with phone/word boundaries
- Built on Kaldi toolkit

### 2.3 NeMo Forced Aligner (NFA) — Most Relevant for This Project

NFA is NVIDIA's neural forced aligner, directly compatible with Parakeet/Deepgram-like models:

**How it works:**
1. CTC model outputs probability distribution over vocabulary tokens per audio timestep
2. Viterbi decoding finds the most probable alignment path
3. Ensures temporal monotonicity and reproducibility
4. Token-level alignments are grouped into word-level alignments

**Key advantages:**
- Can use YOUR reference text (not just ASR output)
- Works with any NeMo CTC checkpoint (14+ languages)
- Produces token-, word-, and segment-level timestamps
- Claimed to be more accurate and faster than MFA for non-trivial audio

**Integration path for this project:**
```python
# NFA can accept reference text directly
# If student reads "The dog ran" but says "The cat ran"
# NFA would show poor alignment score for "dog" region
# This directly indicates a substitution
```

### 2.4 WhisperX — Practical Choice

WhisperX refines Whisper timestamps using forced phoneme alignment via wav2vec 2.0:

**Pipeline:**
1. Voice Activity Detection (VAD) segments audio
2. Whisper transcribes each chunk in parallel
3. Wav2Vec2 phoneme model force-aligns to get word boundaries
4. Produces accurate word-level timestamps

**Known issue (GitHub #1247):** WhisperX word-level timestamps can be less accurate than MFA, particularly for edge cases.

### 2.5 Can Forced Alignment Detect Miscues Directly?

**Yes, through several mechanisms:**

1. **Goodness of Pronunciation (GOP) scores:** Forced alignment produces log-likelihood scores per phoneme. A substitution shows as poor phoneme fit — the acoustic signal doesn't match expected phonemes. GOP < threshold = likely miscue.

2. **Alignment confidence:** If aligning reference text to audio produces low-confidence regions, those regions likely contain errors.

3. **Duration anomalies:** Forced alignment shows expected vs. actual phoneme durations. Stretched phonemes = hesitation. Missing phonemes = omission.

**Limitations:**
- GOP has ~19% error rate minimum due to labeling/segmentation variability
- Stops have 16.2% onset error, fricatives 12.0%, approximants 11.4%
- Works best for substitutions and omissions; insertions are harder to detect
- Children's speech has higher acoustic variability than adults

---

## 3. Comprehension Measurement

### 3.1 Maze Tasks

#### How Maze Tasks Work

A Maze task is a multiple-choice cloze assessment:
1. First sentence of the passage is left intact
2. Every 7th word thereafter is replaced with 3 choices in parentheses
3. One correct word + two distractors
4. Student silently reads and selects correct words
5. Timed: 3 minutes
6. Score = correct selections minus incorrect selections

**Example:**
> The boy walked to (school / purple / jumped) and sat down at (his / cloud / running) desk.

#### Psychometric Properties for Middle School (Grades 6-8)

**From Tolar et al., 2012 (PMC3485695):**
- Passage accounts for 6.2-13.3% of performance variance across grades
- Test-retest reliability: .86 (familiar passages), .74 (novel passages)
- Concurrent validity with TOWRE: .55-.56
- Concurrent validity with WJPC/GRADE comprehension: .60-.63
- Predictive validity shows similar patterns

**Maze vs. ORF for comprehension:**
> "Maze tasks may measure reading comprehension more directly than ORF because correct word selection involves language-based processes that help to build a mental model of the text."

This is critical: for grades 4+, maze tasks are a BETTER predictor of comprehension than WCPM alone.

#### Auto-Generating Maze Tasks with LLMs

**A-Maze (Boyce et al., 2020):** Used NLP technology to automate distractor generation, achieving "dramatically superior statistical power and localization" compared to manually created distractors.

**LLM-based approaches (2024-2025):**
- GPT-4 can generate distractors that are contextually inappropriate but syntactically plausible
- Key requirements for maze distractors:
  - Same part of speech as target
  - Similar word length
  - Semantically incompatible with context
  - Not a grammatical fit in the sentence
- LLMs excel at this because they understand both semantics and syntax

**Implementation approach for this tool:**

```javascript
// Maze task generation prompt for GPT-4 / Claude
const prompt = `Given this passage, create a maze task:
1. Keep the first sentence intact
2. Every 7th word, provide 3 options: the correct word and 2 distractors
3. Distractors must be:
   - Same part of speech as the target word
   - Similar length (within 2 characters)
   - Semantically incompatible with the context
   - Grade-appropriate vocabulary
4. Format: correct word in position 1, distractors in positions 2-3
   (shuffle at presentation time)

Passage: "${passageText}"`;
```

### 3.2 Retell Fluency Scoring

#### How DIBELS Retell Works

After reading a passage aloud:
1. Student retells what they read in their own words
2. 1 point per word related to the passage
3. If retell score >= 50% of ORF score: ORF validated
4. If retell score < 25% of ORF score: ORF NOT validated (student may be "word calling")
5. Student must read >= 40 WCPM to qualify for retell

**Research validity:** Moderate correlation with comprehension measures (r = .46 across 23 studies). Not great as standalone, but useful as a comprehension check/filter.

#### Automating Retell Scoring

**Current state of the art:**
- Caimber (commercial): Uses ASR + NLP to auto-score retell
- Literably: Does NOT auto-score retell — "have not found an objective and satisfactory way"
- Research (SLATE 2025, Shankar et al.): "Leveraging ASR and LLMs for Automated Scoring and Feedback in Children's Spoken Language Assessments"

**Practical approach for this tool:**
1. ASR transcribes the retell
2. LLM extracts key propositions from the original passage
3. LLM scores retell transcript against proposition checklist
4. Score = number of key propositions mentioned / total propositions

### 3.3 Comprehension Questions via LLMs

#### Research on LLM-Generated Questions

**GPT-4o for reading comprehension items (2024-2025):**
- 93.8% of generated questions rated "good quality" suitable for operational use (grades 3-12)
- Few-shot prompting with chain-of-thought yields best results
- Inter-rater agreement above 0.90 for item quality evaluation
- System-generated materials can surpass quality of human-written ones

**For automated scoring:**
- GPT-4 as scorer: QWK 0.67-0.80 range (compared to human raters)
- Best for: short constructed responses, multiple-choice
- Weaker for: complex essay scoring, nuanced comprehension

**Types of questions LLMs can generate:**
1. **Literal recall:** "What did the character do after..."
2. **Bridging inference:** "Why did the character decide to..."
3. **Vocabulary in context:** "What does the word ___ mean in paragraph 2?"
4. **Main idea:** "What is the main idea of this passage?"

#### Minimum Viable Comprehension Check

For a fluency tool targeting struggling middle schoolers, the minimum viable comprehension check should include:

1. **Retell prompt** (free recall) — transcribed by ASR, scored by LLM
   - "Tell me what the passage was about in your own words"
   - Score: proportion of key ideas mentioned (0-100%)
   - Threshold: >= 50% = adequate comprehension

2. **3 auto-generated comprehension questions** — displayed on screen after reading
   - 1 literal, 1 inferential, 1 vocabulary
   - Multiple choice (4 options) — auto-generated and auto-scored
   - Threshold: 2/3 correct = adequate comprehension

3. **Maze task** (optional, for progress monitoring)
   - Auto-generated from passage
   - 3-minute timed
   - Compare to grade-level norms

---

## 4. Passage Difficulty Control

### 4.1 The Problem

**Passage difficulty causes up to 22 WCPM variance** (approximately 10% of score) even within same grade-level materials.

From Petscher & Kim (2011): "A student may have different WCPM scores by reading an easy or hard passage at the same grade level, and two students with the same ORF ability may yield different WCPM scores due to reading passages with different difficulty levels."

This directly threatens the validity of:
- Progress monitoring (growth vs. passage effect?)
- Screening (above/below benchmark?)
- Goal-setting (is the target achievable?)

### 4.2 Traditional Readability Measures

#### Flesch-Kincaid

**Formula:** 0.39 * (total words / total sentences) + 11.8 * (total syllables / total words) - 15.59

**Limitations:**
- Only considers sentence length and syllable count
- Ignores vocabulary difficulty, conceptual complexity, text structure
- "The same passage may yield a different readability index score based on which specific index is used"
- Poor at distinguishing difficulty within narrow grade bands (e.g., 6th vs. 7th grade)
- Can be gamed: short sentences with short words score "easy" even if conceptually dense

#### Lexile Framework

**How it works:**
- Two components: text complexity (Lexile measure) and reader ability (Lexile measure)
- Uses sentence length + word frequency (based on large corpus)
- Maps to a single number (e.g., 1000L)
- Instructional level = reader can comprehend 75% of text at that Lexile

**Grade 6-8 Lexile ranges:**
- Grade 6: 925L-1070L
- Grade 7: 970L-1120L
- Grade 8: 1010L-1185L

**Limitations:**
- Still primarily surface-level features
- Doesn't capture narrative structure, prior knowledge requirements, or cultural context
- A technical manual and a novel can have the same Lexile but very different difficulty

### 4.3 LLM-Based Readability Assessment

#### "Beyond Flesch-Kincaid" (2024)

**Paper:** "Beyond Flesch-Kincaid: Prompt-based Metrics Improve Difficulty Classification of Educational Texts" (arXiv:2405.09482)

**Key findings:**
- 63 prompt-based metrics derived from LLM queries (education level, lexical complexity, syntactic complexity, topic relevance)
- 46 static metrics (vocabulary, sentence length, word frequency)
- Combined approach: **macro-F1 of 0.86** vs. 0.81 for static metrics alone
- Elementary classification: **macro-F1 of 0.95**
- Models tested: Llama2, Mistral, Gemma (7B-13B parameters)

**Important caveat:** "Prompt-based metrics by themselves may not be a good-enough basis" — they must be COMBINED with traditional metrics.

#### GPT-4 Turbo as Readability Judge (Trott, 2024)

- GPT-4 Turbo readability ratings: **r = 0.76** correlation with human judgments
- Best single predictor tested (beat Flesch-Kincaid, psycholinguistic variables)
- However: "not free and takes much more time than calculating FK scores"

#### "Readability Formulas, Systems and LLMs are Poor Predictors of Reading Ease" (2025)

**A contrarian finding:** None of these tools — traditional formulas, readability systems, or LLMs — reliably predict actual reading ease for individual readers. The gap between population-level trends and individual-level prediction remains large.

### 4.4 Passage Equivalence for Progress Monitoring

#### The Core Challenge

Readability indices are insufficient for establishing passage equivalence:
- Passages matched on Flesch-Kincaid can differ by 20+ WCPM
- The rank ordering of passages varies depending on which index you use
- Content familiarity, text structure, and vocabulary all matter independently

#### Equating Methods (from DIBELS research)

**Three approaches tested (Cummings et al., 2013):**

1. **Mean equating:** Adjust scores by the difference in mean difficulty between forms. Simplest but assumes parallel forms.

2. **Linear equating:** Models the linear relationship between forms. Better than mean equating.

3. **Equipercentile equating:** Maps percentile distributions across forms. Most sophisticated and effective.

**Result:** "Explicit equating is essential — forms can vary in difficulty despite high correlations and apparent equivalence through readability indices."

#### Practical Approach for This Tool

1. **Pre-calibrate passages:** Have 10+ students read each passage; compute mean WCPM and standard deviation
2. **Use equating:** After calibration, apply equipercentile equating to make scores comparable across passages
3. **LLM difficulty screening:** Before using a passage, have GPT-4 rate it on:
   - Vocabulary difficulty (1-5)
   - Sentence complexity (1-5)
   - Topic familiarity for target demographic (1-5)
   - Narrative vs. expository structure
4. **Match by multiple features:** When selecting equivalent passages for progress monitoring, match on Lexile AND LLM ratings AND calibrated difficulty
5. **Use 3 passages per session:** Median WCPM across 3 passages reduces passage effects

### 4.5 Instructional Level Determination

| Level | Accuracy | Characteristics |
|---|---|---|
| **Independent** | 99-100% | Student reads fluently, self-corrects, strong comprehension |
| **Instructional** | 92-98% | Challenging but manageable, some errors, adequate comprehension |
| **Frustration** | < 92% | Too many errors, poor comprehension, may give up |

**For ORF assessment:** Passages should be at the student's instructional level (92-98% accuracy). If a student reads below 92% accuracy, the passage may be too hard, and WCPM becomes unreliable as a growth measure.

---

## 5. Dialect-Aware / Equity-Conscious Scoring

### 5.1 The ASR Bias Problem

#### Koenecke et al. (2020) — Landmark Study

**"Racial disparities in automated speech recognition" (PNAS)**

Tested 5 commercial ASR systems (Amazon, Apple, Google, IBM, Microsoft) on CORAAL corpus:

| Group | Average WER |
|---|---|
| White speakers | 0.19 |
| **Black speakers** | **0.35** |
| Black men | 0.41 |
| Black women | 0.30 |
| White men | 0.21 |
| White women | 0.17 |

**By system:**
- Microsoft (best): 0.27 (Black) vs. 0.15 (White)
- Apple (worst): 0.45 (Black) vs. 0.23 (White)

**Root cause analysis:**
- Language models: NO significant disparity (slightly better perplexity on Black speakers)
- **Acoustic models: SUBSTANTIAL gap** — same phrases with Black speakers had ~2x error rate
- The problem is in how the acoustic model processes pronunciation and prosody differences

#### Child AAVE Speakers — Even Worse

**From PMC12490741 (2025):**
- ASR inaccuracies for child AAE speakers: **~40%** — markedly higher than the 30% for adult AAE speakers
- Younger children had even higher error rates
- Double penalty: child speech variability + dialect variability

### 5.2 AAVE Features That Cause ASR Errors

#### Phonological Features

| Feature | AAVE Example | Standard Example | ASR Impact |
|---|---|---|---|
| **Th-fronting** | "brovver" / "mouf" | "brother" / "mouth" | ASR transcribes wrong word |
| **Th-stopping** | "dem" / "dat" | "them" / "that" | May transcribe as "dem", "dat" |
| **Consonant cluster reduction** | "tes" / "col" | "test" / "cold" | Final consonants dropped, ASR may miss word |
| **R-deletion (r-lessness)** | "sto-y" / "fo" | "story" / "four" | Wrong word or partial match |
| **L-vocalization** | "hep" | "help" | Different phoneme sequence |
| **Final consonant deletion** | "han" | "hand" | Short words become ambiguous |

#### Morphosyntactic Features

| Feature | AAVE Example | Standard Example | Reading Impact |
|---|---|---|---|
| **Copula deletion** | "She nice" | "She's nice" | May appear as omission |
| **Habitual be** | "He be working" | "He is always working" | Substitution of "be" for "is" |
| **Possessive -s deletion** | "John hat" | "John's hat" | Appears as omission |
| **Third person -s deletion** | "He walk" | "He walks" | Appears as substitution |
| **Double negation** | "ain't no" | "isn't any" | Complex substitution |
| **Zero past tense** | "He walk home yesterday" | "He walked home yesterday" | Appears as substitution |

### 5.3 Holly Craig's Research

**Key work: "African American English and the Achievement Gap: The Role of Dialectal Code Switching" (Routledge)**

**Craig et al. (2009)** — "African American English-Speaking Students: An Examination of the Relationship Between Dialect Shifting and Reading Outcomes":

- Studied 165 typically developing African American students (grades 1-5)
- AAE production rates were **inversely related** to reading achievement scores
- Students who could "dialect shift" (use SAE in literacy contexts) outperformed peers who didn't
- Dialect shifting was a significant predictor of reading achievement even after controlling for SES and general language ability

**Critical implication:** Dialect density is NOT the same as reading difficulty. A student who reads fluently in AAVE is demonstrating strong decoding — the dialect features should not be counted as errors.

### 5.4 Wheeler & Swords' Contrastive Analysis Approach

**Rebecca Wheeler and Rachel Swords (2012)** — "Factoring AAVE into Reading Assessment and Instruction" (The Reading Teacher)

**The core problem:**
> "If teachers conflate dialect influence with reading error in Standard English, they may inaccurately assess students' reading performance and propose inappropriate instructional plans."

**Contrastive analysis approach:**
1. Identify which "errors" are actually dialect features
2. Create a chart: AAVE pattern vs. Standard English pattern
3. Student learns to recognize BOTH as valid systems
4. Code-switching: choosing the appropriate variety for the context

**For automated scoring:**
> Teachers' awareness of students' dialect differences is necessary to (a) accurately assess decoding abilities, (b) appropriately place students within leveled texts, and (c) develop apt instructional interventions.

### 5.5 Building Dialect-Aware Scoring for This Tool

#### Approach: AAVE Feature Registry

Create a registry of AAVE phonological and morphosyntactic features. When a "miscue" is detected, check if it matches a known dialect pattern:

```javascript
const aaveFeatures = {
  phonological: {
    thFronting: {
      // "th" -> "f" (voiceless) or "v" (voiced)
      patterns: [
        { standard: /^th/i, aave: /^[fd]/i, position: 'initial' },
        { standard: /th$/i, aave: /[fv]$/i, position: 'final' },
      ],
      examples: ['mouth->mouf', 'brother->bruvver', 'the->de', 'that->dat']
    },
    consonantClusterReduction: {
      // Final consonant clusters simplified
      patterns: [
        { standard: /[stkd]$/i, aave: '' }, // test->tes, cold->col
      ],
      examples: ['test->tes', 'cold->col', 'hand->han', 'desk->des']
    },
    rDeletion: {
      patterns: [{ standard: /r/i, aave: '' }],
      examples: ['story->stoy', 'four->fo', 'more->mo']
    },
    lVocalization: {
      patterns: [{ standard: /l$/i, aave: '' }],
      examples: ['help->hep', 'bell->bew']
    }
  },
  morphosyntactic: {
    copulaDeletion: { examples: ["she nice", "they playing"] },
    habitualBe: { examples: ["he be working"] },
    possessiveSDelection: { examples: ["John hat"] },
    thirdPersonSDelection: { examples: ["he walk"] },
    zeroPastTense: { examples: ["he walk home yesterday"] }
  }
};
```

#### Scoring Modes

Offer three scoring modes:

1. **Standard scoring:** All errors counted (traditional ORF)
2. **Dialect-neutral scoring:** AAVE features NOT counted as errors (recommended)
3. **Detailed analysis:** Shows both counts, highlights which "errors" are dialect features

#### Implementation in Miscue Registry

Add to `miscue-registry.js`:
```javascript
{
  type: 'dialect-feature',
  description: 'AAVE or other dialect feature, not a reading error',
  countsAsError: false, // KEY: does not count against accuracy
  countsAsDialectFeature: true,
  ui: {
    color: 'blue', // distinct from error colors
    tooltip: 'Dialect feature (not an error): {featureType}'
  }
}
```

### 5.6 Improving ASR for AAVE Speakers

**Koenecke et al. recommendations:**
1. More diverse training datasets incorporating AAVE
2. Regular public auditing of ASR performance by demographics
3. Separate acoustic model adaptation for dialectal speech

**Practical steps for this tool:**
1. Cross-validate across multiple ASR engines (already doing this with Reverb + Deepgram)
2. If all engines agree on a "substitution" that matches an AAVE pattern, classify as dialect feature
3. Consider fine-tuning one ASR engine on AAVE children's speech (future work)
4. Flag when ASR disagreement correlates with known AAVE features

---

## 6. Hasbrouck-Tindal Norms

### 6.1 Overview

Jan Hasbrouck and Gerald Tindal have published compiled ORF norms based on approximately 250,000+ students. Two key publications:
- **2006:** Grades 1-8 norms (The Reading Teacher, 59, 636-644)
- **2017:** Updated norms for grades 1-6 (Technical Report #1702)

**Important:** The 2017 update only covers grades 1-6. For grades 7-8, the 2006 norms remain the reference.

### 6.2 Norms Table (Grades 6-8)

**Source: Hasbrouck & Tindal (2006/2017 combined)**

#### Grade 6

| Percentile | Fall WCPM | Winter WCPM | Spring WCPM |
|---|---|---|---|
| 90th | 177 | 195 | 204 |
| 75th | 153 | 167 | 177 |
| **50th** | **127** | **140** | **150** |
| 25th | 98 | 111 | 122 |
| 10th | 68 | 82 | 93 |

*Avg. weekly improvement: 0.6 WCPM/week (2017 update for grade 6)*

#### Grade 7 (2006 data)

| Percentile | Fall WCPM | Winter WCPM | Spring WCPM |
|---|---|---|---|
| 90th | 180 | 192 | 202 |
| 75th | 156 | 165 | 177 |
| **50th** | **128** | **136** | **150** |
| 25th | 102 | 109 | 123 |
| 10th | 79 | 88 | 98 |

#### Grade 8 (2006 data)

| Percentile | Fall WCPM | Winter WCPM | Spring WCPM |
|---|---|---|---|
| 90th | 185 | 199 | 199 |
| 75th | 161 | 173 | 177 |
| **50th** | **133** | **146** | **151** |
| 25th | 106 | 115 | 124 |
| 10th | 77 | 84 | 97 |

### 6.3 Using Norms for Goal-Setting

**Hasbrouck & Tindal's guideline:** Students reading 10+ WCPM below the 50th percentile for their grade level need a fluency-building intervention.

#### Risk Categories

| Category | Definition | Action |
|---|---|---|
| **At/Above Benchmark** | >= 50th percentile | Monitor quarterly |
| **Strategic** | 25th-49th percentile | Weekly progress monitoring |
| **Intensive** | < 25th percentile | Intensive intervention + weekly monitoring |
| **Urgent** | < 10th percentile | Immediate intensive intervention |

#### Calculating Growth Goals

Average weekly improvement rates (from norms):
- Grade 6: ~0.6 WCPM/week
- Grade 7: ~0.6 WCPM/week
- Grade 8: ~0.5 WCPM/week

**Ambitious goal:** 1.5-2.0 WCPM/week (realistic with intensive intervention)

**Example:** A 7th grader scoring 100 WCPM in fall (below 25th percentile):
- Target: 50th percentile by spring = 150 WCPM
- Weeks remaining (fall to spring): ~32 weeks
- Required growth: 50 WCPM / 32 weeks = 1.6 WCPM/week
- Assessment: Ambitious but achievable with intervention

### 6.4 Updated Norms Beyond 2017

- **Acadience Reading (formerly DIBELS):** Provides K-6 norms, updated periodically. Does NOT include grades 7-8.
- **DIBELS 8th Edition (2020):** Benchmark goals and percentiles available for K-8, but primarily designed for K-5.
- **No comprehensive update for grades 7-8** has been published beyond the 2006 Hasbrouck-Tindal data as of 2026.
- **Lexile Framework for Oral Reading (NWEA, 2020):** Provides a developmental scale that maps WCPM + accuracy to Lexile measures, allowing cross-grade comparison. This is the most modern approach.

### 6.5 Percentile Interpretation Guide

For this tool's reporting:

```
Student: [Name]
Grade: 7
Assessment Date: Winter
WCPM: 112

Compared to National Norms (Hasbrouck & Tindal, 2006):
- 50th percentile (grade 7, winter): 136 WCPM
- Student is 24 WCPM below the 50th percentile
- Student falls between the 25th percentile (109) and 50th percentile (136)
- Risk category: STRATEGIC — recommend weekly progress monitoring
- Growth target: 150 WCPM by spring (1.6 WCPM/week needed)
```

---

## 7. Implementation Recommendations for This Project

### 7.1 Short-Term (Next Sprint)

1. **Dialect-aware scoring mode:** Add AAVE feature registry to miscue-registry.js. When a substitution/omission matches a known dialect pattern, flag it as `dialect-feature` with `countsAsError: false`.

2. **Norms-based reporting:** Add percentile lookup table from Hasbrouck-Tindal. After each assessment, show where student falls relative to grade-level norms.

3. **Comprehension check (minimal):** After reading, display 3 auto-generated multiple-choice questions (1 literal, 1 inferential, 1 vocabulary). Use GPT-4 to generate from the passage text. Threshold: 2/3 correct = adequate comprehension.

### 7.2 Medium-Term (Next Quarter)

4. **Maze task generator:** Build LLM-based maze task generator. Every 7th word replaced with 3 options (1 correct + 2 distractors). Auto-score. Compare to grade-level maze norms.

5. **Passage difficulty calibration:** For each passage used, track mean WCPM across all students. Apply equipercentile equating after collecting data from 10+ students. Supplement with LLM difficulty ratings.

6. **Retell scoring:** After reading + comprehension questions, prompt student for oral retell. ASR transcribes. LLM extracts key propositions from passage and scores retell coverage.

### 7.3 Long-Term (Future Architecture)

7. **Prompted Whisper integration:** Fine-tune Whisper medium.en with reference text prompting for the specific passage bank. Add special miscue tokens. Use as third ASR source alongside Reverb and Deepgram.

8. **NeMo Forced Aligner:** Use NFA with reference text to get phoneme-level alignment scores. Low GOP scores flag potential miscues before ASR even generates words. Cross-validate with existing pipeline.

9. **Multi-ASR cross-validation with dialect awareness:** When Reverb says "dat" and Deepgram says "that" and the reference says "that" — check AAVE feature registry before calling it an error. If 2/3 ASR engines agree on a dialect variant, mark as dialect feature.

10. **Passage bank with calibrated difficulty:** Build a bank of 100+ passages per grade level, each calibrated with:
    - Lexile measure
    - LLM difficulty ratings (vocabulary, syntax, conceptual)
    - Empirical WCPM data from 10+ students
    - Equipercentile equating applied
    - Equivalent-difficulty groups for progress monitoring

---

## Key Sources

### Prompted ASR
- [Apple "Prompted Whisper" (arXiv:2505.23627)](https://arxiv.org/abs/2505.23627)
- [Apple ML Research page](https://machinelearning.apple.com/research/prompting-whisper)
- [Reading Miscue Detection in Primary School (arXiv:2406.07060)](https://arxiv.org/abs/2406.07060)
- [Two-Pass System for Reading Miscue Detection (Interspeech 2024)](https://www.isca-archive.org/interspeech_2024/gothi24_interspeech.html)
- [Improving ASR for Children's Reading Assessment (Interspeech 2025)](https://www.isca-archive.org/interspeech_2025/vidal25_interspeech.pdf)
- [Whisper HuggingFace documentation](https://huggingface.co/docs/transformers/en/model_doc/whisper)

### Forced Alignment
- [MFA on Children's Speech (PMC8740721)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8740721/)
- [Wav2TextGrid: Tunable Forced Alignment for Child Speech (PMC12337111)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12337111/)
- [NeMo Forced Aligner documentation](https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/tools/nemo_forced_aligner.html)
- [NFA Interspeech 2023 paper](https://www.isca-archive.org/interspeech_2023/rastorgueva23_interspeech.html)
- [WhisperX GitHub](https://github.com/m-bain/whisperX)
- [How Forced Alignment Works (NVIDIA blog)](https://research.nvidia.com/labs/conv-ai/blogs/2023/2023-08-forced-alignment/)
- [MFA Documentation](https://montreal-forced-aligner.readthedocs.io/en/latest/user_guide/index.html)

### Comprehension Measurement
- [Maze Tasks in Middle School (PMC3485695)](https://pmc.ncbi.nlm.nih.gov/articles/PMC3485695/)
- [Maze Tests and Reading Comprehension (Reading Rockets)](https://www.readingrockets.org/blogs/shanahan-on-literacy/progress-monitoring-maze-tests-and-reading-comprehension-assessment)
- [Retell as Indicator of Comprehension (PMC3485692)](https://pmc.ncbi.nlm.nih.gov/articles/PMC3485692/)
- [Acadience ORF and Retell](https://acadiencelearning.org/help-center/oral-reading-fluency-orf-and-retell/)
- [LLM Reading Comprehension Question Generation (arXiv:2404.07720)](https://arxiv.org/html/2404.07720v1)
- [Inference Question Generation (arXiv:2506.08260)](https://arxiv.org/html/2506.08260)
- [A-Maze Automated Distractor Generation](https://www.sciencedirect.com/science/article/abs/pii/S0749596X19301147)
- [ASR + LLM Automated Scoring (SLATE 2025)](https://www.isca-archive.org/slate_2025/shankar25_slate.pdf)

### Passage Difficulty
- [Beyond Flesch-Kincaid: Prompt-based Metrics (arXiv:2405.09482)](https://arxiv.org/html/2405.09482v1)
- [LLMs as Poor Predictors of Reading Ease (2025)](https://arxiv.org/html/2502.11150v3)
- [Measuring Readability with LLMs (Trott)](https://seantrott.substack.com/p/measuring-the-readability-of-texts)
- [Measuring and Modifying Readability with GPT-4 (arXiv:2410.14028)](https://arxiv.org/html/2410.14028v1)
- [Equating ORF Scores (PMC10795571)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10795571/)
- [Form Effects on DIBELS ORF (PMC2396583)](https://pmc.ncbi.nlm.nih.gov/articles/PMC2396583/)
- [Lexile Framework](https://hub.lexile.com/for-educators/)

### Equity / AAVE
- [Racial Disparities in ASR — Koenecke et al. 2020 (PNAS)](https://www.pnas.org/doi/10.1073/pnas.1915768117)
- [Child AAE ASR Inaccuracies (PMC12490741)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12490741/)
- [Wheeler & Swords: Factoring AAVE into Assessment (2012)](https://ila.onlinelibrary.wiley.com/doi/abs/10.1002/TRTR.01063)
- [Craig et al.: Dialect Shifting and Reading Outcomes (2009)](https://pubs.asha.org/doi/10.1044/1092-4388(2009/08-0056))
- [Craig: AAE and the Achievement Gap (Routledge)](https://www.routledge.com/African-American-English-and-the-Achievement-Gap-The-Role-of-Dialectal-Code-Switching/Craig/p/book/9780367194260)
- [ASHA: Informed Lens on AAE](https://leader.pubs.asha.org/doi/10.1044/leader.FTR1.25012020.46)
- [Modeling Gender and Dialect Bias in ASR (EMNLP 2024)](https://aclanthology.org/2024.findings-emnlp.890.pdf)

### Fluency Norms
- [Hasbrouck & Tindal 2017 Norms (Reading Rockets)](https://www.readingrockets.org/topics/fluency/articles/fluency-norms-chart-2017-update)
- [Hasbrouck & Tindal Technical Report #1702](https://files.eric.ed.gov/fulltext/ED594994.pdf)
- [Read Naturally: Hasbrouck-Tindal Chart](https://www.readnaturally.com/article/hasbrouck-tindal-oral-reading-fluency-chart)
- [DIBELS 8 Benchmark Goals](https://dibels.uoregon.edu/sites/default/files/2024-01/dibels8_benchmark_goals.pdf)
- [Lexile Framework for Oral Reading (NWEA)](https://cdn.nwea.org/docs/Lexile+Framework+for+Oral+Reading+FAQ+OCT20.pdf)
- [NAEP Oral Reading Study](https://nces.ed.gov/nationsreportcard/studies/orf/results.aspx)
