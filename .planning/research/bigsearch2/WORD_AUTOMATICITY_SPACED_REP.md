# Word Automaticity Mapping & Spaced Repetition for Reading Fluency

## Deep Research Report — Phase 2

**Date:** 2026-02-06
**Focus:** Per-word timing analysis, spaced repetition for struggled words, adaptive practice, visual progress tracking
**Target population:** Struggling middle schoolers (grades 6-8)

---

## Table of Contents

1. [Word Automaticity Timing Research](#1-word-automaticity-timing-research)
2. [ASR Timestamps as Reading Speed Proxies](#2-asr-timestamps-as-reading-speed-proxies)
3. [Duolingo Half-Life Regression (HLR)](#3-duolingo-half-life-regression-hlr)
4. [Struggled Word Banks](#4-struggled-word-banks)
5. [Adaptive Passage Selection](#5-adaptive-passage-selection)
6. [Visual Progress Tracking](#6-visual-progress-tracking)
7. [Novel "Word Automaticity Map" Concept](#7-novel-word-automaticity-map-concept)
8. [Implementation Roadmap](#8-implementation-roadmap)

---

## 1. Word Automaticity Timing Research

### 1.1 The Dual-Route Cascaded (DRC) Model

Coltheart's Dual-Route Cascaded model (Coltheart et al., 2001) is the dominant computational theory of word recognition. It posits two parallel routes:

- **Lexical route (direct):** Whole-word recognition via orthographic lexicon. Fast. Used for familiar words. Processes 3-8 letter words with no word-length effect when fully developed.
- **Sublexical route (indirect):** Grapheme-phoneme conversion (GPC) rules applied letter-by-letter. Slower. Used for novel/unfamiliar words and nonwords. The GPC module admits a new letter every 17 processing cycles.

**Key insight for our tool:** When a student reads a word slowly, they're using the sublexical route (serial decoding). When they read it fast, the lexical route has kicked in (whole-word recognition). The transition from sublexical to lexical IS automaticity. Our ASR timestamps can detect which route is being used.

### 1.2 Established Timing Thresholds

#### Eye-tracking fixation durations (the gold standard)

**Skilled adult readers:**
- Fixation duration: 175-350ms, with primary range 200-250ms for silent reading
- ~275ms average for reading aloud (longer due to articulatory planning)
- 4-5 fixations per second
- High-frequency words: 20-50ms shorter fixation than low-frequency words

**8th-grade students by reading efficiency quartile** (from PMC7141082, a large eye-tracking study across grade levels):

| Quartile | Fixation Duration (ms) | Fixations/Word | Regressions/Word |
|----------|----------------------|----------------|-------------------|
| Q1 (lowest) | 313 | 1.83 | 0.38 |
| Q2 | 282 | 1.50 | 0.25 |
| Q3 | 268 | 1.33 | 0.22 |
| Q4 (highest) | 242 | 1.15 | 0.16 |

**Critical finding:** The lowest-quartile 8th graders fixate ~70ms longer per word than the highest quartile (313ms vs 242ms). With 1.83 fixations per word, the total per-word processing time for struggling 8th graders is ~573ms vs ~278ms for strong readers — a 2x difference.

#### Oral reading fluency norms (words per minute)

**Hasbrouck & Tindal (2017) norms, 50th percentile:**
- Grade 6: 146 WCPM → ~411ms per word
- Grade 7: ~150 WCPM → ~400ms per word
- Grade 8: ~150 WCPM → ~400ms per word

**Converting WCPM to ms/word:** `ms_per_word = 60,000 / WCPM`

| Percentile | Grade 6 WCPM | ms/word | Grade 8 WCPM | ms/word |
|------------|-------------|---------|-------------|---------|
| 90th | 195 | 308ms | ~185 | 324ms |
| 75th | 171 | 351ms | ~167 | 359ms |
| 50th | 146 | 411ms | ~150 | 400ms |
| 25th | 115 | 522ms | ~124 | 484ms |
| 10th | 89 | 674ms | ~97 | 619ms |

### 1.3 Proposed Timing Thresholds for Word Automaticity

Based on the convergence of eye-tracking data, WCPM norms, and pause analysis, we propose these thresholds for individual word production time in connected oral reading:

| Category | Duration | Interpretation | Color Code |
|----------|----------|---------------|------------|
| **Automatic** | <350ms | Lexical route. Instant recognition. No decoding load. | Green |
| **Fluent** | 350-500ms | Normal range for grade-level readers. Minimal effort. | Light green |
| **Hesitant** | 500-800ms | Possible sublexical processing. Some cognitive load. | Yellow |
| **Labored** | 800-1200ms | Definite decoding struggle. Heavy cognitive load. | Orange |
| **Blocked** | >1200ms | Severe difficulty. May include false starts, pauses. | Red |

**Rationale for 800ms threshold:** A 50th-percentile 6th grader averages ~411ms/word in connected text. At 800ms, a word is taking 2x the average — clearly indicating that word specifically is problematic. The 25th-percentile reader averages ~522ms, so 800ms is still well above even struggling-reader average pace.

### 1.4 Word Frequency Effect

High-frequency words are recognized 20-50ms faster than low-frequency words in eye-tracking studies (Brysbaert et al., 2018). This means:

- A student who is slow on HIGH-frequency words (e.g., "the", "said", "because") has a serious automaticity deficit
- A student who is slow only on LOW-frequency words (e.g., "phosphorescent", "lieutenant") may simply lack exposure
- Our tool should weight word frequency when flagging struggles — slow on "the" is much more diagnostic than slow on "xylophone"

### 1.5 Automaticity as an Independent Predictor (Middle School Data)

A key study (PMC8559868) tested 444 middle schoolers (grades 6-8, mean age 13) using masked word presentation (80ms exposure + visual mask):

- Automaticity (masked recognition) uniquely explained 6.5-22% of variance in reading fluency
- This was INDEPENDENT of general decoding knowledge
- Effect was stronger for multisyllabic words (10-22% variance) than monosyllabic (6.5-6.7%)
- Test-retest reliability: r = 0.75 over one month — automaticity is a stable trait

**Implication:** Automaticity is not just "fast decoding" — it's a separate cognitive skill. A student can know HOW to decode a word (untimed test) but still fail to recognize it automatically (timed/masked test). This is exactly what our ASR timestamps measure.

---

## 2. ASR Timestamps as Reading Speed Proxies

### 2.1 How ASR Word Timestamps Work

Our tool uses two ASR systems with different timestamp mechanisms:

**Reverb (CTC-based):**
- Uses CTC alignment with `g_time_stamp_gap_ms = 100`
- Single-BPE-token words always show ~100ms (a known limitation)
- Multi-token words get variable, more accurate durations
- CTM output format: word, start_time, duration, confidence

**Deepgram/Parakeet (attention-based):**
- End-to-end model with word-level timestamps
- Generally more accurate for word boundaries in connected speech
- Typical prediction error: 20-120ms range across languages

### 2.2 Accuracy of ASR Timestamps for Reading Assessment

**Forced alignment accuracy (Montreal Forced Aligner benchmark):**
- MFA temporal resolution: 10ms
- Median word boundary error: <30ms
- MFA outperforms WhisperX and MMS at all time resolutions
- For children's speech: performance slightly degraded but still usable

**ASR for oral reading fluency assessment (Harmsen et al., Interspeech 2025):**
- Strong correlations for 12/15 fluency measures between ASR and human scoring
- Pearson correlation ~0.86 for passages, ~0.80 for word lists
- ASR can generate valid word decoding and passage reading measures (accuracy, speed, automaticity)

**Key validation study (Speech Enabled Reading Fluency Assessment, PMC12686063):**
- Forced alignment reveals information on how specific words and sentences are read
- Enables computation of prosodic measures by measuring duration, amplitude, F0 at word/sentence/text level
- System can identify mispronounced words using forced alignment features

### 2.3 Limitations and Mitigations

#### Coarticulation effects
In connected speech, words blend together. Coarticulation is heightened in connected phrases compared to isolated utterances. Faster speech rates increase gesture overlap, compressing temporal windows.

**Mitigation:** Our tool measures TOTAL word production time (onset to offset), which inherently includes coarticulation. This is actually MORE ecologically valid than isolated-word timing because it captures how the word is produced in real reading context.

#### ASR timestamp jitter
- CTC-based systems (Reverb): 100ms minimum duration for single-token words
- End-to-end systems (Deepgram): 20-120ms prediction error

**Mitigation strategies:**
1. Use Deepgram timestamps as primary (more accurate for word boundaries)
2. Cross-validate with Reverb timestamps when both agree
3. Apply a smoothing window: if word duration is implausibly short (<80ms for a content word), use the average of neighboring word durations as a sanity check
4. Aggregate across multiple readings: a word's automaticity score should be based on 3+ readings, not a single instance

#### Pause vs. word duration
A long "word duration" might include a pause BEFORE the word (planning time) rather than slow articulation.

**Mitigation:**
1. Our pipeline already detects pauses via silence/gap detection
2. If there's a detected gap >200ms before a word, attribute only the portion after the gap to the word
3. Alternatively, decompose word timing into: `gap_before + articulation_time`
   - Both are informative: gap_before = retrieval difficulty, articulation_time = decoding difficulty

### 2.4 Syllable Normalization

Multi-syllable words inherently take longer to produce. "Hippopotamus" at 800ms is normal; "cat" at 800ms is labored.

**Normative Word Syllable Duration (WSD) from PMC10721249:**
- Neurotypical mean: 237-238ms per syllable (SD=32-38ms)
- Median: 241ms per syllable
- Range: 169-282ms per syllable
- 95th percentile (abnormal threshold): 303-316ms per syllable

**Implementation:**
```
normalized_duration = word_duration_ms / syllable_count
```

**Proposed syllable-normalized thresholds:**

| Category | ms/syllable | Interpretation |
|----------|-------------|---------------|
| Automatic | <250ms | Normal WSD range |
| Fluent | 250-350ms | Slightly slow but acceptable |
| Hesitant | 350-500ms | Elevated processing time |
| Labored | >500ms | Definite difficulty |

**Syllable count source:** Use a lookup table (CMU Pronouncing Dictionary has syllable counts for 130k+ words) or compute via the simple heuristic: count vowel clusters.

---

## 3. Duolingo Half-Life Regression (HLR)

### 3.1 The Core Model

**Paper:** Settles & Meeder, "A Trainable Spaced Repetition Model for Language Learning," ACL 2016.

**Recall probability (exponential decay):**
```
p = 2^(-delta / h)
```
Where:
- `p` = probability of correctly recalling an item (0 to 1)
- `delta` = lag time since last practice (in days/seconds)
- `h` = half-life of the memory (the time at which recall probability drops to 50%)

**Half-life estimation (log-linear model):**
```
h = 2^(theta * x)
```
Where:
- `theta` = learned weight vector
- `x` = feature vector for this student-item pair

### 3.2 Feature Vector Components

The original HLR uses these features:
- `history_seen`: total number of times this item was practiced
- `history_correct`: total number of correct responses
- `delta`: time since last practice
- **Lexeme features:** one-hot encoding of the specific word/item (captures inherent difficulty)
- **User features:** (optional) user-level difficulty modifiers

The lexeme features are the key insight — they allow the model to learn that "irregular" words or rare words have shorter half-lives (are forgotten faster) than common, regular words.

### 3.3 Training Objective

HLR optimizes a combined loss:
1. Cross-entropy loss between predicted recall `p_hat` and observed recall `p` (binary: 0 or 1)
2. L2 regularization on model weights

Results: 45%+ error reduction over Leitner and Pimsleur baselines.

### 3.4 Open-Source Implementations

1. **Official Duolingo repo:** https://github.com/duolingo/halflife-regression
   - Python, runs with PyPy
   - 13M training traces included
   - Features: `experiment.py` with full HLR + baselines

2. **PyTorch replication:** https://github.com/phcavelar/duolingo-spaced-repetition
   - `duohl.py` — PyTorch-based reimplementation
   - Easier to integrate with modern ML pipelines

3. **FSRS (Free Spaced Repetition Scheduler):** A more modern alternative
   - https://github.com/open-spaced-repetition/free-spaced-repetition-scheduler
   - 20-30% fewer reviews needed vs SM-2 for same retention
   - Benchmark: FSRS 89.6% vs HLR 76.6% success rate
   - 21 optimizable parameters, DSR memory model
   - Multiple language ports available (JS, Python, Rust, Go)

### 3.5 Adapting HLR/FSRS for Word Automaticity

The original HLR predicts RECALL (can you remember the word?). For reading, we need to predict AUTOMATICITY (can you read the word fast enough?). This requires a reframing:

**Original HLR (vocabulary):**
```
p_recall = 2^(-delta / h)          # Binary: recalled or not
```

**Adapted for automaticity:**
```
p_automatic = 2^(-delta / h)       # Probability word is read automatically
observed_automatic = 1 if word_duration < threshold else 0
```

**Key adaptations:**

| HLR Parameter | Vocabulary Learning | Reading Automaticity Adaptation |
|---------------|--------------------|---------------------------------|
| Item | Foreign word | English word from passage |
| Correct response | Student recalls meaning | Student reads word in <threshold ms (syllable-normalized) |
| Lag time (delta) | Days since last vocab review | Days since last reading session where word appeared |
| Half-life (h) | How long until student forgets meaning | How long until word reverts to non-automatic |
| Features | Word difficulty, grammar type | Word length, frequency, regularity, morphological complexity |

**Automaticity-specific features to add:**
- `syllable_count`: multi-syllable words are harder to automatize
- `word_frequency_rank`: Zipf frequency from SUBTLEXus corpus
- `decodability_score`: how many irregular grapheme-phoneme correspondences
- `morphological_complexity`: number of morphemes (prefix + root + suffix)
- `exposure_count`: total times encountered across all reading sessions
- `best_duration_ratio`: best-ever duration / expected duration (captures personal best)
- `trend`: are durations improving, stable, or regressing?

### 3.6 FSRS: The Better Algorithm Choice

Given the benchmark data showing FSRS significantly outperforms HLR (89.6% vs 76.6%), and FSRS has active community development with JavaScript ports, **FSRS is the recommended algorithm** for our tool.

**FSRS core formulas:**

```
Retrievability:     R(t) = (1 + F * t/S)^C     where F=19/81, C=-0.5
Stability update:   S' = S * SInc               where SInc >= 1 on success
Difficulty:         D in [1, 10]                 updated per review
```

**FSRS-6 has 21 parameters** (19 in the main model + 2 short-term memory):
```javascript
// Default parameter values (from borretti.me implementation)
const W = [0.4026, 1.1839, 3.173, 15.691, 7.195, 0.535, 1.460,
           0.005, 1.546, 0.119, 1.019, 1.940, 0.11, 0.296,
           2.270, 0.232, 2.990, 0.517, 0.662];
```

**For our use case:** We'd train the optimizer on our student reading data. The "review" is encountering a word in a passage. The "grade" is:
- **Again (1):** word_duration > labored_threshold (definite struggle)
- **Hard (2):** word_duration > hesitant_threshold
- **Good (3):** word_duration in fluent range
- **Easy (4):** word_duration < automatic_threshold

---

## 4. Struggled Word Banks

### 4.1 Research on Repetitions Needed for Automaticity

- **Average reader:** 4-14 exposures for automaticity (Ehri, 2005)
- **Struggling reader:** up to 40 exposures needed
- **General guideline:** 10-15 print exposures for developing automaticity
- **Transfer effect:** Fluency gains on practiced words transfer to new, unpracticed text

### 4.2 Word Lists for Middle Schoolers

**Fry Instant Word List (1,000 words):**
- Ranked by frequency in written English
- First 100 words = 50% of all written material
- First 300 words = 65% of all written material
- First 1,000 words = ~90% coverage
- Organized in groups of 100

**Dolch List (220 words):**
- Primarily K-3 focused
- Less relevant for middle school, but struggling middle schoolers often lack automaticity on these

**CPB Sight Words (Green et al., 2024):**
- Newest research-based list from 2,146 children's picture books
- Uses mean text frequency weighted by dispersion (better methodology)
- Freely available
- First 100-300 words most useful for instruction

**For middle schoolers specifically:**
The relevant word bank is NOT just sight words. Middle school struggling readers often stumble on:
1. Multi-syllable academic vocabulary ("consequently", "experiment", "revolutionary")
2. Irregular high-frequency words they never automatized ("through", "enough", "although")
3. Domain-specific content words ("photosynthesis", "denominator", "amendment")

### 4.3 Design Pattern for Cross-Session Word Tracking

```javascript
// Proposed schema for struggled word tracking
const wordRecord = {
  word: "experiment",                    // canonical form
  syllable_count: 4,
  frequency_rank: 2341,                  // SUBTLEXus rank

  // FSRS state
  fsrs: {
    stability: 1.2,                      // days until R drops to 90%
    difficulty: 5.3,                      // 1-10 scale
    last_review: "2026-02-05T14:30:00",
    due_date: "2026-02-06T09:00:00",
    reps: 7,                             // total encounters
    lapses: 2                            // times it reverted to non-automatic
  },

  // Timing history
  readings: [
    { date: "2026-02-01", passage_id: "p_12", duration_ms: 1240, normalized_ms: 310, automatic: false },
    { date: "2026-02-03", passage_id: "p_15", duration_ms: 890, normalized_ms: 223, automatic: false },
    { date: "2026-02-05", passage_id: "p_18", duration_ms: 620, normalized_ms: 155, automatic: true },
  ],

  // Diagnostics
  first_seen: "2026-01-15",
  times_automatic: 3,
  times_struggled: 4,
  automaticity_rate: 0.43,               // 3/7
  best_duration_ms: 520,
  best_normalized_ms: 130,
  trend: "improving",                    // improving | stable | regressing

  // Miscue types observed
  miscue_history: ["substitution", "hesitation", "self-correction"],

  // Context
  in_fry_1000: true,
  fry_group: 7,                          // 7th hundred of Fry list
  morphemes: ["ex", "peri", "ment"],
  decodability: "irregular"              // regular | irregular | sight
};
```

### 4.4 Word Bank Architecture

```
localStorage (per student):
  struggled_words: {
    [canonical_word]: wordRecord,
    ...
  }

  // Aggregate stats
  word_bank_summary: {
    total_unique_words: 47,
    automatic_words: 23,
    struggling_words: 18,
    improving_words: 6,
    mastered_and_retained: 15,    // automatic + FSRS says retained
    due_for_review: 8             // FSRS says review needed
  }

  // Session log
  reading_sessions: [
    { date, passage_id, wcpm, accuracy, words_automatic_pct, new_struggles, resolved_struggles }
  ]
```

### 4.5 Mastery Criteria

A word should be considered "mastered" when:
1. Read automatically (below threshold) in 3+ consecutive sessions
2. FSRS stability > 7 days (memory is durable)
3. No lapse in last 3 encounters
4. Successfully read in at least 2 different passage contexts (not just memorized in one context)

---

## 5. Adaptive Passage Selection

### 5.1 Research on Targeted Word Exposure

**Key finding (from reading research):** Students who read about related topics learned more vocabulary words and comprehended better than students who read varied topics. Simple changes to texts — using sets of texts with overlapping words and related concepts — can improve reading skills. This supports the strategy of selecting passages that contain a student's struggled words.

**Multiple exposures principle:** Robust vocabulary instruction includes multiple exposures to targets and integrates explanation of word meanings within meaningful contexts. Words encountered in context (not isolation) are more likely to be retained and automatized.

### 5.2 The Decodable vs. Authentic Text Debate (Middle School)

**Research consensus for middle schoolers:**
- Pure decodable text is age-inappropriate and demotivating for adolescents
- Pure authentic text may be too frustrating for severely struggling readers
- A multicomponent approach is best: content-rich instruction with a variety of texts at grade level plus scaffolded text
- The INSTRUCTION around the text matters more than the text type itself
- Phonics instruction trumped text type in controlled studies

**For our tool:** We should NOT generate "decodable text" for middle schoolers. Instead:
1. Select authentic, age-appropriate passages that happen to contain target struggled words
2. Pre-teach the struggled words before reading (brief exposure, not drill)
3. Track which words in the passage are "target words" from the student's word bank
4. After reading, specifically highlight performance on target words

### 5.3 LLM-Based Passage Generation

**Bezirhan & von Davier (2023)** demonstrated GPT-3 can generate reading passages that:
- Closely resemble human-authored passages for coherence and appropriateness
- Match target Lexile levels when prompted correctly
- Achieve higher engagement ratings than original assessment passages (94% vs 74%)
- Require only minor human editing for grammar/factual corrections

**Sidwell et al. (2024)** showed ChatGPT can create customizable ORF probes comparable with standard oral reading fluency passages, tailored to specific grade levels.

**For our tool — passage generation algorithm:**

```
Input:
  - student's top 10 due-for-review words (from FSRS scheduler)
  - target grade level (6-8)
  - target Lexile range (e.g., 800-1000L for grade 6)
  - topic preference (optional)

Prompt engineering:
  "Write a 150-200 word narrative passage at a [grade] grade reading level
   (Lexile [range]). The passage must naturally include ALL of the following
   words: [word1, word2, ..., word10]. The topic should be [topic or
   'age-appropriate for middle schoolers']. Do NOT highlight or emphasize
   the target words — they should appear naturally in context."

Validation:
  1. Check all target words are present
  2. Run readability check (Flesch-Kincaid, Lexile estimate)
  3. Verify word count is in range
  4. Human review queue for quality assurance
```

**POINTER algorithm (Zhang et al., EMNLP 2020)** is an alternative for hard-constrained text generation:
- Starts with constraint words, progressively inserts words between them
- Achieves state-of-the-art on constrained generation tasks
- Code available: https://github.com/dreasysnail/POINTER
- Could generate passages guaranteed to contain target words

### 5.4 Passage-Word Matching (Existing Passages)

If using a passage library rather than generating new passages:

```javascript
function scorePassage(passage, studentWordBank) {
  const words = tokenize(passage.text);
  const uniqueWords = new Set(words.map(w => getCanonical(w)));

  let targetWordCount = 0;
  let dueWords = studentWordBank.getDueForReview();

  for (const word of dueWords) {
    if (uniqueWords.has(word.canonical)) {
      targetWordCount++;
    }
  }

  // Score factors:
  // 1. Number of target words present (higher = better)
  // 2. Passage difficulty match (Lexile within student's range)
  // 3. Not recently read (avoid boredom)
  // 4. Topic variety (don't repeat same theme)

  const targetCoverage = targetWordCount / dueWords.length;
  const difficultyMatch = 1 - Math.abs(passage.lexile - student.targetLexile) / 500;
  const novelty = daysSinceLastRead(passage) / 30; // 0-1 scale

  return 0.5 * targetCoverage + 0.3 * difficultyMatch + 0.2 * Math.min(novelty, 1);
}
```

---

## 6. Visual Progress Tracking

### 6.1 Research on Self-Monitoring Effect Sizes

**Hattie's Visible Learning meta-analysis:**
- Self-reported grades / student expectations: d = 1.44 (highest of all interventions)
- Self-monitoring: d = 0.79 (Tau-U = 0.79, p < 0.0001) for K-12 reading performance
- Studies meeting What Works Clearinghouse criteria: Tau-U = 0.93

**Key meta-analysis (School Psychology Quarterly, 2018):**
- 19 studies, 67 participants (ages 7-18)
- Self-monitoring had a large positive effect on reading performance
- Effect was even LARGER when studies met rigorous WWC criteria

**Data Mountain program** (Didion & Toste, 2022):
- Combined self-monitoring + goal-setting + positive attributions
- Showed early promise specifically for students with or at risk for reading disabilities

### 6.2 What Works for Adolescents

**Effective visualization approaches:**

1. **Line graphs of WCPM over time** — Classic, proven effective
   - Students who plot their own scores show increased motivation and investment
   - Simple, easy to understand
   - Shows trend clearly

2. **Goal-line charting** — Sets a visible target
   - Student sets a WCPM goal
   - Chart shows progress toward goal
   - "Cold read" baseline vs "hot read" after practice

3. **Word mastery counters** — Gamification element
   - "You've mastered 23 words this month!"
   - "Only 5 more words to reach your goal of 30!"
   - Counter/progress bar format works well for adolescents

4. **Streak tracking** — Borrowed from Duolingo
   - "5-day reading streak!"
   - Streak mechanics are extremely motivating for adolescents
   - Simple to implement, powerful psychologically

### 6.3 Visualizations to Avoid / Use Carefully

- **Red/green word clouds** in view of peers — potentially stigmatizing
- **Leaderboards** — can demotivate struggling readers if they're always at bottom
- **Percentile ranks** compared to class — focus on individual growth, not comparison
- **Complex dashboards** — overwhelming for students; simplify

### 6.4 Design Principles for Stigma-Free Feedback

1. **Frame as growth, not deficit:** "Words you're learning" not "Words you failed"
2. **Celebrate improvement:** "This word is 200ms faster than last week!" not "This word is still slow"
3. **Use private dashboards:** Student sees their own data; teacher has separate view
4. **Process praise over ability praise:** "You practiced consistently" not "You're getting smarter"
5. **Normalizing struggle:** "Every reader has words they're still learning — even adults"
6. **Agency:** Let students choose which words to practice, set their own goals

---

## 7. Novel "Word Automaticity Map" Concept

### 7.1 Core Design

The Word Automaticity Map overlays per-word reading speed directly onto the passage text, creating a visual "heat map" of the student's reading performance.

```
Passage text with color-coded words:

  The [green]little[/green] [green]fox[/green] [yellow]crept[/yellow]
  [green]through[/green] [green]the[/green] [red]labyrinth[/red] [green]of[/green]
  [orange]narrow[/orange] [yellow]passages[/yellow] [green]until[/green]
  [green]he[/green] [orange]discovered[/orange] [green]a[/green]
  [red]magnificent[/red] [yellow]underground[/yellow] [green]cave[/green].
```

**Color scheme:**
- Green (#4CAF50): Automatic (<250ms/syllable) — "You nailed this!"
- Light green (#8BC34A): Fluent (250-350ms/syllable) — "Good pace"
- Yellow (#FFC107): Hesitant (350-500ms/syllable) — "Getting there"
- Orange (#FF9800): Labored (500-700ms/syllable) — "Keep practicing"
- Red (#F44336): Blocked (>700ms/syllable) — "Focus word"

### 7.2 Interaction Design

**Hover/tap on any word reveals a tooltip:**
```
"magnificent" (4 syllables)
  Your time:    1,240ms (310ms/syllable)
  Target:       <1,000ms (250ms/syllable)
  Your best:    980ms (Feb 3)
  Times seen:   6 across 3 sessions
  Status:       Improving! (was 1,800ms first time)
  [Practice this word]
```

**Click "[Practice this word]" adds it to the student's manual review queue.**

### 7.3 Teacher View vs Student View

**Teacher view (detailed, analytical):**
- Full heat map with exact durations
- Aggregate statistics per passage
- Class-wide patterns (which words trip up multiple students?)
- Export data for IEP documentation
- Sortable word list by: most struggled, most improved, longest duration, frequency
- Diagnostic categories: "decoding issues" vs "fluency issues" vs "vocabulary gaps"

**Student view (motivational, growth-focused):**
- Simplified heat map with friendly labels ("Keep going!" instead of duration numbers)
- "Words I've Mastered" counter prominently displayed
- "Words I'm Learning" shown as a queue, not a deficit list
- Personal best highlights: "You read 'experiment' faster than ever!"
- "Speed Run" option: re-read a passage and see words change color as you improve
- Streak counter: "You've practiced 5 days in a row!"

### 7.4 Comparison View (Across Sessions)

Show the SAME passage read at two different times, side by side:

```
February 1st:                    February 8th:
The little fox [red]crept        The little fox [green]crept
through the [red]labyrinth       through the [yellow]labyrinth
of [orange]narrow passages       of [green]narrow passages
until he [orange]discovered      until he [green]discovered
a [red]magnificent               a [yellow]magnificent
underground cave.                underground cave.
```

**This is the "money shot" for motivation.** Students can literally SEE their reading getting better as words shift from red to green across sessions.

### 7.5 Implementation Sketch

```javascript
function renderAutomaticityMap(passage, alignmentResults, wordBank) {
  const container = document.getElementById('automaticity-map');

  for (const item of alignmentResults) {
    if (item.type === 'match' || item.type === 'substitution') {
      const syllables = getSyllableCount(item.ref);
      const normalizedDuration = item.duration_ms / syllables;
      const color = getAutomaticityColor(normalizedDuration);

      const span = document.createElement('span');
      span.className = `word automaticity-${color}`;
      span.textContent = item.ref;
      span.dataset.duration = item.duration_ms;
      span.dataset.normalized = normalizedDuration;
      span.dataset.syllables = syllables;

      // Update word bank
      if (wordBank[item.ref]) {
        wordBank[item.ref].readings.push({
          date: new Date().toISOString(),
          duration_ms: item.duration_ms,
          normalized_ms: normalizedDuration,
          automatic: normalizedDuration < 250
        });
      }

      // Tooltip
      span.addEventListener('click', () => showWordDetail(item, wordBank));

      container.appendChild(span);
    }
  }
}

function getAutomaticityColor(normalizedMs) {
  if (normalizedMs < 250) return 'automatic';       // green
  if (normalizedMs < 350) return 'fluent';           // light-green
  if (normalizedMs < 500) return 'hesitant';         // yellow
  if (normalizedMs < 700) return 'labored';          // orange
  return 'blocked';                                   // red
}
```

### 7.6 Preventing Stigma

1. **Opt-in display:** Student chooses when to see the heat map; it's not forced
2. **Private by default:** Only the student and teacher see it; not peers
3. **"Speed Run" framing:** "Want to beat your record?" — gamifies without labeling
4. **No public display:** Never project on classroom screen
5. **Teacher training note:** Emphasize growth narrative: "Every red word is a LEARNING OPPORTUNITY, not a failure"
6. **Celebration triggers:** When a word shifts from red/orange to green, play a subtle animation. Accumulate "level up" moments.

### 7.7 Why This Is Novel

No existing ORF tool provides per-word automaticity mapping with:
- Real-time ASR-derived timing (not eye-tracking hardware)
- Cross-session word tracking with spaced repetition scheduling
- Color-coded passage overlay showing individual word speeds
- Before/after comparison views
- Integrated word bank with FSRS-based review scheduling

The closest tools (NWEA MAP Reading Fluency, Read Naturally, FlowFluency) measure WCPM but don't break it down to individual word timing. Eye-tracking research tools (like EyeLink) do per-word analysis but cost $20,000+ and require hardware. Our approach delivers eye-tracking-grade per-word analysis using a laptop microphone and ASR.

---

## 8. Implementation Roadmap

### Phase 1: Word Duration Extraction (build on existing pipeline)

**Already have:**
- Per-word timestamps from Deepgram and Reverb
- Alignment pipeline (NW alignment, compound word merging)
- Word-level miscue detection (substitutions, omissions, etc.)

**Need to add:**
1. Syllable count lookup table (CMU Pronouncing Dictionary or simple heuristic)
2. Syllable-normalized duration calculation per word
3. Automaticity classification per word (green/yellow/orange/red)
4. Word frequency lookup (SUBTLEXus Zipf scores)

**Effort:** Small. Mostly computation on data we already have.

### Phase 2: Word Automaticity Map UI

1. Color-coded passage overlay in alignment view
2. Word detail tooltip with duration, history, trend
3. Toggle between "miscue view" (existing) and "automaticity view" (new)
4. Summary bar: "X% of words read automatically"

**Effort:** Medium. New UI component, but builds on existing tooltip system.

### Phase 3: Cross-Session Word Bank

1. `localStorage` schema for per-student word tracking
2. Word record creation/update on each reading session
3. Word bank browse/search UI
4. "Words I'm Learning" dashboard with progress indicators
5. Manual "add to practice" and "mark as mastered" actions

**Effort:** Medium. New storage layer and UI, but straightforward.

### Phase 4: Spaced Repetition Scheduling

1. Integrate FSRS algorithm (JS port: https://github.com/open-spaced-repetition/ts-fsrs)
2. After each reading session, update FSRS state for each encountered word
3. Compute "due for review" word list
4. Display review recommendations: "These 8 words need practice today"
5. Optional: flash-card-style isolated word practice mode

**Effort:** Medium-High. FSRS integration requires careful state management.

### Phase 5: Adaptive Passage Selection

1. Build/curate a passage library (or integrate LLM generation)
2. Passage-word matching algorithm
3. "Recommended next passage" feature
4. Track which passages contain which target words

**Effort:** High. Content creation/curation is the bottleneck, not code.

### Phase 6: Visual Progress & Gamification

1. Before/after comparison view for same passage
2. Word mastery counter with animations
3. Reading streak tracker
4. Personal best highlights
5. Weekly/monthly progress summary
6. Teacher dashboard with class-wide analytics

**Effort:** Medium. UI-heavy but conceptually straightforward.

---

## Key References

### Cognitive Science & Reading

- Coltheart, M. et al. (2001). DRC: A dual route cascaded model of visual word recognition and reading aloud. *Psychological Review*. [PubMed](https://pubmed.ncbi.nlm.nih.gov/11212628/)
- Brysbaert, M. et al. (2018). The Word Frequency Effect in Word Processing: An Updated Review. *Current Directions in Psychological Science*. [SAGE](https://journals.sagepub.com/doi/10.1177/0963721417727521)
- PMC8559868 — Automaticity as an Independent Trait in Predicting Reading Outcomes in Middle-School. [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC8559868/)
- PMC7141082 — Eye Movement Measures across Reading Efficiency Quartile Groups. [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7141082/)
- PMC2748352 — Becoming a Fluent Reader: Reading Skill and Prosodic Features. [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC2748352/)
- PMC10721249 — Normative Values for Word Syllable Duration. [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10721249/)
- PMC3382728 — The time-course of single-word reading. [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3382728/)

### ORF Norms & Assessment

- Hasbrouck, J. & Tindal, G. (2017). Fluency Norms Chart. [Reading Rockets](https://www.readingrockets.org/topics/fluency/articles/fluency-norms-chart-2017-update)
- PMC12686063 — Speech Enabled Reading Fluency Assessment: a Validation Study. [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12686063/)
- Harmsen et al. (2025). Can ASR generate valid measures of child reading fluency? *Interspeech 2025*. [PDF](https://www.isca-archive.org/interspeech_2025/harmsen25_interspeech.pdf)
- arxiv 2306.03444 — Automatic Assessment of Oral Reading Accuracy for Reading Diagnostics. [arXiv](https://arxiv.org/abs/2306.03444)

### ASR & Forced Alignment

- arxiv 2406.19363 — Tradition or Innovation: A Comparison of Modern ASR Methods for Forced Alignment. [arXiv](https://arxiv.org/html/2406.19363v1)
- arxiv 2505.15646 — Word Level Timestamp Generation for ASR and Translation. [arXiv](https://arxiv.org/html/2505.15646v1)
- Montreal Forced Aligner documentation. [MFA Docs](https://montreal-forced-aligner.readthedocs.io/en/stable/user_guide/index.html)

### Spaced Repetition

- Settles, B. & Meeder, B. (2016). A Trainable Spaced Repetition Model for Language Learning. *ACL 2016*. [PDF](https://research.duolingo.com/papers/settles.acl16.pdf)
- Duolingo HLR repo. [GitHub](https://github.com/duolingo/halflife-regression)
- FSRS algorithm wiki. [GitHub](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm)
- FSRS technical explanation. [Expertium](https://expertium.github.io/Algorithm.html)
- Implementing FSRS in 100 lines. [Blog](https://borretti.me/article/implementing-fsrs-in-100-lines)
- FSRS benchmark results. [GitHub](https://github.com/open-spaced-repetition/srs-benchmark)
- ts-fsrs (TypeScript port). [GitHub](https://github.com/open-spaced-repetition/ts-fsrs)

### Sight Words & Word Banks

- Green, C. et al. (2024). The CPB Sight Words: A New Research-Based High-Frequency Wordlist. *The Reading Teacher*. [Wiley](https://ila.onlinelibrary.wiley.com/doi/full/10.1002/trtr.2309)
- PMC2805254 — Becoming a fluent and automatic reader in the early elementary school years. [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC2805254/)
- PMC4299759 — Teaching Word Identification to Students with Reading Difficulties. [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4299759/)

### Self-Monitoring & Motivation

- Hattie's Visible Learning effect sizes. [Visible Learning](https://visible-learning.org/hattie-ranking-influences-effect-sizes-learning-achievement/)
- ERIC EJ1175469 — Meta-Analysis of Self-Monitoring on Reading Performance of K-12 Students. [ERIC](https://eric.ed.gov/?id=EJ1175469)
- Didion & Toste (2022). Data Mountain: Self-Monitoring, Goal Setting, and Positive Attributions. [SAGE](https://journals.sagepub.com/doi/abs/10.1177/00222194211043482)

### Passage Generation

- Bezirhan & von Davier (2023). Automated reading passage generation with OpenAI's large language model. [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S2666920X23000401)
- Sidwell et al. (2024). Utilizing Text-Generative AI for Creating Oral Reading Fluency Probes. [SAGE](https://journals.sagepub.com/doi/10.1177/10534512241235896)
- Zhang et al. (2020). POINTER: Constrained Progressive Text Generation. *EMNLP 2020*. [ACL Anthology](https://aclanthology.org/2020.emnlp-main.698/)

---

## Summary: The Big Picture

What we're building is a **closed-loop reading improvement system**:

```
Read Passage → ASR timestamps → Per-word automaticity scoring
     ↓                                        ↓
Color-coded Word Map ← ← ← ← ← ← ← ← Classify each word
     ↓                                        ↓
Student sees progress ← ← ← ← ← ← ← Update word bank
     ↓                                        ↓
Motivated to practice ← ← ← ← ← ← ← FSRS schedules review
     ↓                                        ↓
Next passage selected ← ← ← ← ← ← ← Contains target words
     ↓
Read Passage (loop)
```

Each cycle:
1. **Diagnoses** which specific words lack automaticity (not just overall WCPM)
2. **Tracks** those words across sessions with a forgetting curve model
3. **Schedules** review at optimal intervals (FSRS: 20-30% fewer reviews needed)
4. **Selects** passages that naturally contain words due for review
5. **Visualizes** progress in a way that motivates adolescents (growth framing, streaks, personal bests)
6. **Feeds data** to the teacher for targeted intervention decisions

This is genuinely novel. No existing ORF tool combines per-word ASR timing with spaced repetition scheduling and adaptive passage selection. The research base is solid: automaticity is measurable, trainable, and a unique predictor of reading outcomes in middle school.
