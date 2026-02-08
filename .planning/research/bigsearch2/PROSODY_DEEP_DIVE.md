# Prosody Analysis for Oral Reading Fluency: Deep Dive Research Report

**Date:** 2026-02-06
**Context:** ORF assessment tool for struggling middle schoolers (grades 6-8)
**Motivation:** WCPM plateaus after grade 6 (~150 WCPM ceiling at 50th percentile). Prosody assessment is the highest-impact enhancement for differentiating fluent from disfluent readers in this population.

---

## Table of Contents

1. [Parselmouth/Praat for Prosody](#1-parselmouthpraat-for-prosody)
2. [Browser-Based Pitch Tracking](#2-browser-based-pitch-tracking)
3. [Automated Prosody Rubrics](#3-automated-prosody-rubrics)
4. [Pause Analysis for Fluency](#4-pause-analysis-for-fluency)
5. [Prosody + Comprehension Link](#5-prosody--comprehension-link)
6. [Implementation Architecture](#6-implementation-architecture)
7. [Recommended Implementation Plan](#7-recommended-implementation-plan)

---

## 1. Parselmouth/Praat for Prosody

### 1.1 What is Parselmouth?

Parselmouth is a Python interface to Praat that directly accesses Praat's C/C++ code via pybind11 -- meaning the algorithms and their output are exactly the same as in Praat, but callable from Python. It eliminates the need for Praat scripting or subprocess calls.

- **Repository:** https://github.com/YannickJadoul/Parselmouth
- **Documentation:** https://parselmouth.readthedocs.io/en/stable/
- **License:** GPL v3
- **Install:** `pip install praat-parselmouth`
- **Key paper:** Jadoul et al. (2018), "Introducing Parselmouth: A Python interface to Praat"

### 1.2 Specific Features to Extract

#### A. Fundamental Frequency (F0) Contour

The most critical prosody feature. F0 is the acoustic correlate of perceived pitch.

```python
import parselmouth
from parselmouth.praat import call

sound = parselmouth.Sound("reading.wav")

# Extract pitch (F0) -- children's voices: 100-600 Hz range
pitch = sound.to_pitch(
    time_step=0.01,        # 10ms intervals
    pitch_floor=75.0,      # Hz minimum (adults: 75, children: 100)
    pitch_ceiling=600.0    # Hz maximum (children go higher)
)

# Get F0 values and timestamps
pitch_values = pitch.selected_array['frequency']
pitch_times = pitch.xs()

# Key derived metrics:
# - F0 mean: overall pitch level
# - F0 standard deviation: pitch variation (monotone vs expressive)
# - F0 range (max - min): expressiveness indicator
# - F0 slope at sentence boundaries: declination pattern
# - F0 contour similarity to adult model: prosodic maturity
```

**Thresholds for expressive vs monotone reading:**
- F0 standard deviation > 52 Hz at passage level = "high expressiveness" (SoapBox Labs threshold)
- F0 standard deviation > 26 Hz at word level = "expressive word" (SoapBox Labs threshold)
- Sentence-final F0 declination > 15 Hz = appropriate declarative intonation
- Skilled readers: 56.22 Hz sentence-final F0 declination (average)
- Struggling readers: 39.67 Hz sentence-final F0 declination (average)
- Perceptual threshold for pitch focus: 3 semitones above baseline
- Perceptual threshold for surprise: 5 semitones above baseline

**Children's F0 ranges (grades 6-8):**
- Children's voices: 215-400 Hz typical range
- F0 pitch ceiling tends to vary with expressivity; for non-emphatic speech use 1.5x the 3rd quartile

#### B. Intensity (Loudness)

```python
intensity = sound.to_intensity(
    minimum_pitch=100.0,   # Hz
    time_step=0.01         # 10ms intervals
)

# Derived metrics:
# - Mean intensity per word/phrase
# - Intensity variation (SD) -- correlates with expression/volume
# - Intensity contour at phrase boundaries
```

#### C. Speech Rate and Duration

```python
# Using word-level timestamps from ASR (Reverb/Deepgram)
# Calculate:
# - Words per minute (WPM)
# - Syllables per second
# - Articulation rate (excluding pauses)
# - Word duration normalized by speaker baseline
```

#### D. Pause Patterns

```python
# From ASR timestamps, calculate:
# - Inter-word silence duration
# - Intra-sentence pause count and duration
# - Inter-sentence pause count and duration
# - Pause-to-speech ratio
# - Pause variability (SD of pause durations)
```

#### E. Voice Quality Measures

```python
# Harmonics-to-Noise Ratio (voice clarity)
hnr = call(sound, "To Harmonics (cc)", 0.01, 1, 0.1, 1.0)

# Jitter (pitch perturbation -- can indicate struggle/tension)
point_process = call(sound, "To PointProcess (periodic, cc)", 75, 600)
jitter = call(point_process, "Get jitter (local)", 0, 0, 0.0001, 0.02, 1.3)

# Shimmer (amplitude perturbation)
shimmer = call([sound, point_process], "Get shimmer (local)", 0, 0, 0.0001, 0.02, 1.3, 1.6)
```

#### F. Formants (Optional, for pronunciation quality)

```python
formants = sound.to_formant_burg(
    time_step=0.01,
    max_number_of_formants=5.0,
    maximum_formant=5500.0,  # children: higher than adults
    window_length=0.025,
    pre_emphasis_from=50.0
)

# F1, F2 for vowel quality assessment
f1 = formants.get_value_at_time(1, time_point)
f2 = formants.get_value_at_time(2, time_point)
```

### 1.3 Segmentation by Sentence/Phrase

Two approaches for aligning prosody features to text structure:

**Approach 1: Use ASR timestamps + passage text**
Since our tool already has per-word timestamps from Reverb and Deepgram, we can:
1. Parse passage text for sentence boundaries (periods, question marks, exclamation marks)
2. Map sentence boundaries to word timestamps
3. Extract prosody features per sentence/phrase

**Approach 2: Montreal Forced Aligner (MFA)**
- Produces word-level and phone-level TextGrid alignments
- Uses Kaldi ASR under the hood
- Install: `conda install -c conda-forge montreal-forced-aligner`
- Outputs Praat TextGrid files with precise time boundaries
- Good for phone-level analysis but REDUNDANT given we already have word timestamps

**Approach 3: PraatIO library for TextGrid manipulation**
- Repository: https://github.com/timmahrt/praatIO
- Install: `pip install praatio`
- Can read/write TextGrid files
- Useful if we want to create TextGrids from our ASR timestamps for Praat analysis

**Recommended: Approach 1** -- we already have high-quality per-word timestamps from Reverb and Deepgram. No need for additional forced alignment.

### 1.4 Existing Python Libraries for Education/Prosody

#### myprosody
- **Repository:** https://github.com/Shahabks/myprosody
- **PyPI:** `pip install myprosody`
- **Features:** F0 metrics, articulation rate, syllable pause duration, number of long pauses, speaking time, words per minute, formants, intonation index, pronunciation scoring, TOEFL/CEFR level estimation
- **Status:** Initial/active development; aimed at L2 proficiency assessment
- **Caveat:** Requires 48kHz/24-32bit WAV input; designed for adult speech, not children

#### openSMILE (Python)
- **Repository:** https://github.com/audeering/opensmile-python
- **PyPI:** `pip install opensmile`
- **Features:** ComParE 2016 (6k+ features), GeMAPS/eGeMAPS (minimal standard feature sets)
- **Prosody features:** Energy, voicing probability, F0, spectral energy, psychoacoustic sharpness
- **Key advantage:** The ComParE feature set is the standard benchmark for speech analysis competitions
- **Used in:** Wang et al. (2024) prosody classification achieving 62.5% cross-domain accuracy on NAEP scale

```python
import opensmile
smile = opensmile.Smile(
    feature_set=opensmile.FeatureSet.eGeMAPSv02,
    feature_level=opensmile.FeatureLevel.Functionals,
)
features = smile.process_file("reading.wav")
```

#### ProPer (Prosody Proper)
- **Repository:** https://github.com/finkelbert/ProPer_Projekt
- **Features:** Continuous F0 and periodic energy measurements, pitch contours, prominence, speech rate, syllabic structure
- **Output:** Rich visual representations of prosody

---

## 2. Browser-Based Pitch Tracking

### 2.1 Web Audio API Capabilities

The Web Audio API provides real-time audio processing through:
- **AnalyserNode:** FFT-based frequency/time-domain analysis (real-time)
- **AudioWorklet:** Custom audio processing off the main thread (replaced deprecated ScriptProcessorNode)
- **MediaStream API:** Microphone input capture

Key architecture: `MediaStream -> AudioWorklet -> AnalyserNode -> Canvas visualization`

### 2.2 JavaScript Pitch Detection Libraries

#### A. pitchfinder (Most Practical)
- **Repository:** https://github.com/peterkhayes/pitchfinder
- **NPM:** `npm install pitchfinder`
- **Algorithms included:**
  - **YIN** -- Best balance of accuracy and speed for speech; autocorrelation-based
  - **AMDF** -- Slow, ~2% accuracy, but finds frequency more consistently
  - **Dynamic Wavelet** -- Very fast, struggles with lower frequencies
  - **Macleod** -- Good general-purpose detector
- **Usage:** Can combine multiple detectors for improved accuracy at cost of speed

```javascript
import { YIN } from 'pitchfinder';

const detectPitch = YIN({ sampleRate: 44100 });
// In AudioWorklet or AnalyserNode callback:
const pitch = detectPitch(float32AudioBuffer); // Returns frequency in Hz or null
```

#### B. CREPE via ml5.js / TensorFlow.js (Most Accurate)
- **Original paper:** Kim et al. (2018), ICASSP -- "CREPE: A Convolutional Representation for Pitch Estimation"
- **Browser demo:** https://marl.github.io/crepe/
- **ml5.js integration:** Uses CREPE CNN model via TensorFlow.js
- **Accuracy:** ~100% on RWC dataset, >90% within 10 cents on MDB dataset; outperforms pYIN and SWIPE by 8%+ at 10-cent threshold
- **Caveats:**
  - Full model is large; browser demo uses a stripped-down version (<3% of parameters)
  - Stripped model makes more octave errors
  - TensorFlow.js has reported issues on Linux Chrome
  - Computationally expensive -- needs GPU for real-time

```javascript
// ml5.js approach
const audioContext = new AudioContext();
const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
const pitchDetection = ml5.pitchDetection('./crepe_model/', audioContext, mic.stream, () => {
  pitchDetection.getPitch((err, frequency) => {
    // frequency in Hz
  });
});
```

#### C. Essentia.js (Most Feature-Rich)
- **Website:** https://mtg.github.io/essentia.js/
- **Repository:** https://github.com/MTG/essentia.js
- **Technology:** Essentia C++ compiled to WebAssembly via Emscripten
- **Features:** Pitch extraction, loudness metering, onset detection, beat tracking, tempo estimation, MFCC, spectral features, rhythm analysis
- **License:** AGPLv3
- **Key advantage:** Near-native performance via WASM; comprehensive feature set beyond just pitch
- **Supports:** Both real-time and offline analysis

```javascript
import { Essentia, EssentiaWASM } from 'essentia.js';

const essentia = new Essentia(EssentiaWASM);
// Extract pitch from audio frame
const pitchResult = essentia.PitchYin(audioFrame, { sampleRate: 44100 });
```

### 2.3 Accuracy: Browser vs Praat

| Method | Accuracy | Latency | Features |
|--------|----------|---------|----------|
| Praat/Parselmouth (server) | Gold standard | Offline only | Full prosody suite |
| CREPE full (server/Python) | ~100% RWC, 90%+ MDB | ~50ms/frame on GPU | Pitch only |
| CREPE stripped (browser) | Degraded (octave errors) | ~100-200ms/frame | Pitch only |
| YIN (browser, pitchfinder) | Good for clean speech | <10ms/frame | Pitch only |
| Essentia.js WASM (browser) | Near-Praat for basics | ~20-50ms/frame | Multi-feature |

**Verdict:** Browser-based pitch tracking is viable for real-time visualization feedback during reading, but NOT reliable enough for assessment scoring. Assessment-grade prosody analysis should run server-side with Parselmouth.

### 2.4 Live Prosody Visualization During Reading

**Feasible architecture:**
1. Capture microphone audio via MediaStream API
2. Process in AudioWorklet with YIN or Essentia.js WASM
3. Send pitch/intensity values to main thread via MessagePort
4. Render real-time pitch contour on Canvas/SVG overlay
5. Show pitch line rising/falling as student reads
6. Color-code: green = good variation, red = monotone, blue = appropriate pauses

**Reference tools:**
- **Web-Pitcher:** Computer-assisted prosody training tool that shows real-time pitch contour relative to a reference model
- **The Prosodic Marionette:** Software for visualizing prosody with block-based display of F0 and duration (research tool, not web-based)
- **Visual Prosody research:** Studies show that when children see visual prosody cues, they read aloud with greater vocal inflection

**Implementation complexity:** Medium. The core pitch tracking works; the challenge is making the visualization pedagogically useful and not distracting during oral reading.

---

## 3. Automated Prosody Rubrics

### 3.1 NAEP Oral Reading Fluency Scale (4 Levels)

The gold standard, developed for the 1992 National Assessment of Educational Progress. Measures "ease or naturalness of reading" through phrasing, syntax adherence, and expressiveness.

**Level 1 (Non-fluent):** Reads primarily word-by-word. Occasional two-word or three-word phrases may occur but are infrequent and/or do not preserve meaningful syntax.

**Level 2 (Non-fluent):** Reads primarily in two-word phrases with some three- or four-word groupings. Some word-by-word reading may be present. Word groupings may seem awkward and unrelated to larger context of sentence or passage.

**Level 3 (Fluent):** Reads primarily in three- or four-word phrase groups. Some small groupings may be present. However, the majority of phrasing seems appropriate and preserves the syntax of the author. Little or no expressive interpretation is present.

**Level 4 (Fluent):** Reads primarily in larger, meaningful phrase groups. Although some regressions, repetitions, and deviations from text may be present, these do not appear to detract from overall structure. Preservation of author's syntax is consistent. Some or most of the story is read with expressive interpretation.

**2018 NAEP extension:** Used a 6-point scale for "passage reading expression" scored by trained humans. Expression was the ONLY measure NOT automated in 2018 -- all other ORF measures were scored automatically.

### 3.2 Multidimensional Fluency Scale (Rasinski/Zutell)

Evaluates prosody on a 1-4 scale across four dimensions. Total score: 4-16. Scores below 8 = fluency concern.

**Dimension 1: Expression and Volume**
- 1: Reads words just to get them out. Little sense of natural language. Quiet voice.
- 2: Begins to use voice to make text sound natural in some areas. Focus on pronouncing words. Still quiet.
- 3: Makes text sound like natural language throughout most of the passage. Occasional expressionless reading. Generally appropriate volume.
- 4: Reads with good expression and enthusiasm throughout. Varies expression and volume to match interpretation.

**Dimension 2: Phrasing**
- 1: Monotone with little sense of boundaries; frequently word-by-word.
- 2: Frequently two- and three-word phrases; choppy reading; improper stress and intonation.
- 3: Mixture of run-ons, mid-sentence pauses, and appropriate phrasing. Reasonable stress and intonation.
- 4: Generally well-phrased, mostly in clause and sentence units, with adequate attention to expression.

**Dimension 3: Smoothness**
- 1: Frequent extended pauses, hesitations, false starts, sound-outs, repetitions, and/or multiple attempts.
- 2: Several rough spots. Difficulty with specific words and/or structures.
- 3: Occasional breaks in smoothness from difficulty with words/structures.
- 4: Generally smooth with some breaks, but resolves difficulties quickly through self-correction.

**Dimension 4: Pace**
- 1: Reads slowly and laboriously.
- 2: Reads moderately slowly (or moderately fast).
- 3: Uneven mixture of fast and slow pace.
- 4: Consistently reads at conversational pace; appropriate rate throughout.

### 3.3 Mapping Audio Features to Rubric Dimensions

Based on SoapBox Labs' published methodology and research literature:

| Rubric Dimension | Audio Features | Thresholds |
|-----------------|---------------|------------|
| **Expression/Volume** | F0 standard deviation (passage-level), intensity variation | F0 SD > 52 Hz = expressive; per-word F0 SD > 26 Hz = expressive word |
| **Phrasing** | Pause duration at punctuation, pause presence between non-boundary words, phrase length (words between pauses) | Correct pause at period: > 200ms; incorrect mid-phrase pause: > 200ms between words |
| **Smoothness** | Count of long pauses (>1s), false starts, repetitions, pause variability | Skilled: 369ms inter-sentence, 365ms intra-sentence; Struggling: 661ms / 688ms respectively |
| **Pace** | Words per minute, articulation rate, pace variability | Grade 6-8 norms: 127-150 WCPM at 50th percentile |
| **Intonation** | F0 slope at sentence boundaries, F0 rise for questions, F0 fall for declaratives | Pitch slope > 130 Hz for questions; < -90 Hz for declaratives (SoapBox thresholds) |

### 3.4 Research on Automated Prosody Scoring Accuracy

#### Wang et al. (2024) -- Deep learning for NAEP prosody classification
- **Model:** X-vectors + self-attention CNN
- **Features:** 9 prosodic + spectral features from openSMILE (ComParE 2016)
- **Cross-domain accuracy:** 62.5% (binary: fluent vs non-fluent on NAEP scale)
- **Improvement over prior:** 57% baseline (Sammit et al., 2022)
- **Dataset:** 5,841 recordings from 1,811 students (grades 2-4)

#### Bosch et al. (2024) -- wav2vec2 for ORF assessment
- **Model:** wav2vec2-large-960h with Gaussian pooling (W2Vanilla)
- **Performance:** Pearson r = 0.827, CCC = 0.808 on comprehensibility scale (0-5)
- **Baseline:** Random Forest on handcrafted features: r = 0.794
- **Dataset:** 1,447 children's recordings (ages 10-14, ESL), ~10 hours
- **Key finding:** End-to-end wav2vec2 outperforms handcrafted features WITHOUT needing text alignment
- **Layer analysis:** Transformer layer 17 most predictive for prosody

#### Bolanos et al. (2013) -- FLORA system
- Fully automated assessment of WCPM and expressive reading on NAEP 4-point scale
- Achieved 73.24% lexical and 69.73% prosodic accuracy (76.05% overall)

#### Summary of automated vs human accuracy

| System | Task | Accuracy/Correlation | Human Agreement |
|--------|------|---------------------|-----------------|
| Wang 2024 (DL) | NAEP binary (fluent/non-fluent) | 62.5% | ~85-90% |
| Bolanos 2013 (FLORA) | NAEP 4-point | 69.73% prosodic | ~80% |
| Bosch 2024 (wav2vec2) | Comprehensibility 0-5 | r = 0.827 | r = 0.76 (inter-rater) |
| Handcrafted baseline | Comprehensibility 0-5 | r = 0.794 | r = 0.76 |

**Key insight:** The wav2vec2 model actually achieves HIGHER correlation with mean human ratings (0.827) than the inter-rater agreement (0.76), suggesting it is learning a more stable central tendency than any individual human rater.

---

## 4. Pause Analysis for Fluency

### 4.1 Pause Types and Definitions

| Pause Type | Definition | Threshold |
|-----------|-----------|-----------|
| **Micro-pause** | Brief hesitation, possible phonetic stop | < 150ms |
| **Short pause** | Within-phrase pause, possible decoding hesitation | 150-250ms |
| **Medium pause** | Between-phrase or clause boundary pause | 250-600ms |
| **Long pause** | Between-sentence or paragraph boundary pause | 600-1200ms |
| **Extended pause** | Struggle/disengagement indicator | > 1200ms |
| **Filled pause** | "um", "uh", "er" -- disfluency marker | Any duration |

**Common threshold choices in research:**
- Goldman-Eisler (1968): 250ms minimum for hesitation pauses (vs phonetic stops)
- Heldner & Edlund (2010): 180ms minimum (minimizes confusion with stop closures)
- Minimum psychologically functional duration: ~100ms
- SoapBox Labs: 200ms threshold for "incorrect pause" between words
- Most reading fluency research: 150ms as significant marker

### 4.2 Pause Duration in Fluent vs Disfluent Readers

From Miller & Schwanenflugel (2008), studying young readers:

| Pause Metric | Skilled Readers | Struggling Readers | Ratio |
|-------------|----------------|-------------------|-------|
| Inter-sentence pause (mean) | 369ms | 661ms | 1.8x |
| Intra-sentence pause (mean) | 365ms | 688ms | 1.9x |
| Pause variability (ms) | 54,024 | 155,751 | 2.9x |
| Reading rate (WCPM) | 176 | 92 | 1.9x |

**Key finding:** Struggling readers' pauses are nearly TWICE as long on average, and THREE TIMES more variable. The high variability creates the characteristic "hesitant, start-stop quality" of disfluent reading.

### 4.3 Pause Distribution Patterns

Research shows pause durations follow a bimodal distribution:
- **Mode 1:** 100-150ms (brief articulatory pauses, phonetic boundaries)
- **Mode 2:** 500-600ms (deliberate/processing pauses)

Multimodal breakdown:
- Brief pauses: < 200ms (articulatory/phonetic)
- Medium pauses: 200-1000ms (processing/phrasing)
- Long pauses: > 1000ms (struggle/planning)

### 4.4 What's "Normal" for Grades 6-8?

**WCPM norms (Hasbrouck & Tindal, 2017):**

| Grade | Fall 50th %ile | Winter 50th %ile | Spring 50th %ile |
|-------|---------------|-----------------|-----------------|
| 6 | 127 | 133 | 140 |
| 7 | 128 | 132 | 136 |
| 8 | 133 | 140 | 146 |

WCPM plateaus near 150 -- approximately the average adult speaking rate (150 wpm). A score falling more than 10 words below the 50th percentile = concern.

**Expected pause patterns for fluent grade 6-8 readers:**
- Inter-sentence pauses: 300-500ms (similar to adult norms)
- Intra-sentence pauses at clause boundaries: 200-400ms
- Inappropriate mid-phrase pauses: rare, < 200ms if present
- Pause-to-speech ratio: < 0.25 (skilled), > 0.40 (struggling)

**For naturalness perception:**
- Optimal within-sentence pause: ~600ms
- Optimal between-sentence pause: 600-1200ms
- Pauses > 2s between words = likely struggle/disengagement

### 4.5 Pause Analysis Metrics for Our Tool

Given that we already have per-word timestamps from Reverb and Deepgram, we can compute:

```
For each word pair (word_i, word_{i+1}):
  gap = word_{i+1}.start - word_i.end

Metrics:
1. pause_count_total         -- total pauses > 200ms
2. pause_count_appropriate   -- pauses at sentence/clause boundaries
3. pause_count_inappropriate -- pauses mid-phrase (not at punctuation)
4. mean_pause_duration       -- average of all pauses
5. pause_duration_variability -- SD of pause durations
6. pause_to_speech_ratio     -- total pause time / total speech time
7. long_pause_count          -- pauses > 1000ms (struggle indicators)
8. phrase_length_mean         -- average words per phrase (between pauses)
9. phrase_length_variability  -- SD of phrase lengths
```

**Mapping to rubric:**
- NAEP Level 1: phrase_length_mean ~1-2 words; many inappropriate pauses
- NAEP Level 2: phrase_length_mean ~2-3 words; some inappropriate pauses
- NAEP Level 3: phrase_length_mean ~3-4 words; mostly appropriate pauses
- NAEP Level 4: phrase_length_mean ~5+ words; pauses aligned with syntax

---

## 5. Prosody + Comprehension Link

### 5.1 Meta-Analytic Evidence

**Bree &"; (2022) meta-analysis** (35 studies, K=98, N=9,349, Grades 1-9, 8 languages):
- **Overall correlation:** r = 0.51 (moderate) between reading prosody and comprehension
- **By measurement method:**
  - Rating scales: r = 0.53 (66 effect sizes)
  - Spectrographic (F0 declination): r = 0.34
  - Grammatical pauses: r = 0.31
  - Ungrammatical pauses: r = 0.38
  - Adult-like contour: r = 0.32

**By grade level:**
- Grade 2-3 (spectrographic): r = 0.11-0.30
- Grade 4 (holistic rating): r = 0.59
- Grade 5: r = 0.22-0.73
- Grade 9 (analytic rating): r = 0.71

**Critical pattern: The prosody-comprehension correlation STRENGTHENS with age.** This is precisely why prosody is the highest-impact enhancement for our grade 6-8 tool -- the correlation is strongest at exactly this age range.

### 5.2 Prosody for High School Students

Wolters et al. (2024) studied prosody in high school students:
- Reading comprehension skill correlates with prosodic fluency **independent of decoding ability and vocabulary**
- Better comprehenders produced stronger prosodic cues to syntactic and semantic structure
- Prosodic effects appeared primarily on **syntactically complex structures**
- This means prosody becomes MORE important as texts grow more complex (exactly what happens in grades 6-8+)

**Specific prosodic markers of comprehension:**
- Yes-no questions: F0 slope differentiation (p = .028)
- Wh-questions: F0 slope differentiation (p = .002)
- Contrastive focus: F0 and intensity differences (p = .046, p = .013)
- Phrasing at clause boundaries: F0 change and duration (p < .001)

### 5.3 Prosody vs WCPM for Older Students

**The case for prosody over WCPM for grades 6-8:**

1. **WCPM ceiling effect:** At 50th percentile, WCPM stabilizes at ~150 by grade 6. Prosody continues to differentiate readers who all decode at similar speeds.

2. **Comprehension variance:** WCPM captures speed and accuracy but misses HOW a student reads. Two students reading at 140 WCPM can have vastly different comprehension -- prosody captures this gap.

3. **Text complexity:** As passages become syntactically complex in middle school, prosody reflects whether a student is parsing the syntax correctly. Word-by-word reading at 140 WCPM vs phrased reading at 135 WCPM -- the slower, phrased reader likely comprehends better.

4. **DIBELS and similar tools "only measure speed and accuracy"** (direct quote from meta-analysis). They miss the expressive dimension entirely.

### 5.4 Prosody and ELL/Dialect Bias Reduction

#### Hannah et al. (2025) -- Critical finding

This study investigated automated, prosody-inclusive ORF assessment with ELLs in a post-secondary setting:

**Three ways prosody improves automated ORF for ELLs:**
1. **Reduces bias:** ASR-based scoring shows larger bias against ELLs (due to differential ASR accuracy for accented speech). Prosody-inclusive scoring significantly reduces this disparity.
2. **Better comprehension prediction:** Prosody was a stronger predictor of reading comprehension for Japanese L1 speakers, comparable for Chinese L1 speakers, and less strong for Arabic L1 speakers.
3. **Improved diagnostics:** Prosody provides diagnostic information about reading that is invisible to WCPM alone.

**Why this matters for our tool:**
- Our Reverb ASR may have higher word error rates for ELL students
- WCPM scores are directly impacted by ASR accuracy -- if the ASR misrecognizes an accented pronunciation, WCPM drops unfairly
- Prosody features (F0 contour, pause patterns, intensity variation) are LESS dependent on accurate word recognition
- A student who reads expressively with appropriate phrasing is demonstrating comprehension even if the ASR struggles with their accent

**Specific findings:**
- ASR-based WCPM showed larger gaps between ELL and EL1 students than human-scored WCPM
- Adding prosody features partially compensated for this gap
- Prosody scores were more equitable across L1 backgrounds than accuracy-only scores

---

## 6. Implementation Architecture

### 6.1 Architecture Options

#### Option A: Server-Side Only (Parselmouth alongside Reverb)

```
Browser (audio recording)
    |
    v
Upload WAV to server
    |
    +---> Reverb ASR (existing) ---> word timestamps, transcription
    |
    +---> Parselmouth prosody analysis
    |         |
    |         +---> F0 contour extraction
    |         +---> Intensity analysis
    |         +---> Pause computation (from ASR timestamps)
    |         +---> Prosody scoring
    |
    v
Return combined results: miscues + prosody scores + per-word features
```

**Pros:**
- Gold-standard accuracy (Praat algorithms)
- Full feature set (F0, intensity, formants, jitter, shimmer, HNR)
- Easy integration with existing Reverb server
- Can use openSMILE for feature extraction alongside Parselmouth
- Deterministic, reproducible results

**Cons:**
- No real-time feedback during reading
- Additional server processing time
- Requires audio upload (already happening for Reverb)

**Processing time estimate for 1-minute audio:**
- Parselmouth pitch extraction: ~1-2 seconds
- Parselmouth intensity: < 1 second
- Parselmouth formants: ~1-2 seconds
- Pause computation from timestamps: < 100ms
- Prosody scoring: < 100ms
- **Total: ~3-5 seconds** (Parselmouth runs at near-native Praat speed via C++ bindings)
- This runs in parallel with Reverb processing, so adds minimal wall-clock time

#### Option B: Client-Side Only (Web Audio API)

```
Browser
    |
    +---> MediaStream (microphone)
    |
    +---> AudioWorklet (YIN/Essentia.js pitch tracking)
    |
    +---> Real-time visualization (Canvas)
    |
    +---> Accumulated features -> prosody score (local)
```

**Pros:**
- Real-time pitch visualization during reading
- No additional server load
- Works offline
- Immediate feedback

**Cons:**
- Limited accuracy (especially for children's voices)
- No access to full Praat algorithms
- CPU-intensive (may affect recording quality)
- Browser compatibility concerns (AudioWorklet not in all browsers)
- Cannot compute some features (formants, HNR) reliably

#### Option C: Hybrid (RECOMMENDED)

```
Browser
    |
    +---> MediaStream (microphone)
    |         |
    |         +---> AudioWorklet: lightweight YIN pitch tracking
    |         |         |
    |         |         v
    |         |     Real-time pitch contour visualization (Canvas)
    |         |     "Prosody monitor" -- shows pitch going up/down
    |         |     Color feedback: monotone warning
    |         |
    |         +---> Record full audio (MediaRecorder)
    |
    +---> Upload WAV to server (existing flow)
    |
    +---> Server: Reverb ASR + Parselmouth prosody
    |         |
    |         +---> Assessment-grade prosody scores
    |         +---> Per-word prosody features
    |         +---> Rubric-aligned dimensional scores
    |
    v
Return to browser: full assessment with prosody
```

**This is the recommended approach because:**
1. Real-time visualization provides immediate prosody feedback during reading (motivation/awareness)
2. Server-side analysis provides assessment-grade accuracy for scoring
3. The client-side pitch tracking is lightweight (YIN) and tolerant of errors (it's just for visualization)
4. The server-side analysis is definitive and uses gold-standard algorithms
5. Fits naturally into the existing Reverb server pipeline

### 6.2 Server-Side Implementation Plan

#### New Python module: `services/reverb/prosody.py`

```python
import parselmouth
from parselmouth.praat import call
import numpy as np

class ProsodyAnalyzer:
    """Analyze prosody features from audio with word-level timestamps."""

    def __init__(self, audio_path, word_timestamps, passage_text):
        self.sound = parselmouth.Sound(audio_path)
        self.words = word_timestamps  # [{word, start, end}, ...]
        self.passage = passage_text
        self.sentences = self._segment_sentences()

    def extract_all(self):
        """Extract comprehensive prosody features."""
        return {
            'pitch': self._extract_pitch(),
            'intensity': self._extract_intensity(),
            'pauses': self._analyze_pauses(),
            'phrasing': self._analyze_phrasing(),
            'speech_rate': self._compute_speech_rate(),
            'rubric_scores': self._compute_rubric_scores(),
        }

    def _extract_pitch(self):
        """Extract F0 contour and derived metrics."""
        pitch = self.sound.to_pitch(
            time_step=0.01,
            pitch_floor=100.0,   # children
            pitch_ceiling=600.0
        )
        f0_values = pitch.selected_array['frequency']
        f0_values[f0_values == 0] = np.nan  # unvoiced -> NaN

        # Per-word pitch
        word_pitches = []
        for w in self.words:
            word_f0 = self._get_f0_in_range(pitch, w['start'], w['end'])
            word_pitches.append({
                'word': w['word'],
                'f0_mean': np.nanmean(word_f0),
                'f0_sd': np.nanstd(word_f0),
                'f0_min': np.nanmin(word_f0) if len(word_f0) > 0 else None,
                'f0_max': np.nanmax(word_f0) if len(word_f0) > 0 else None,
            })

        # Passage-level metrics
        voiced_f0 = f0_values[~np.isnan(f0_values)]
        return {
            'per_word': word_pitches,
            'passage_f0_mean': float(np.mean(voiced_f0)),
            'passage_f0_sd': float(np.std(voiced_f0)),
            'passage_f0_range': float(np.max(voiced_f0) - np.min(voiced_f0)),
            'expressiveness': 'high' if np.std(voiced_f0) > 52 else 'low',
            'sentence_final_declinations': self._compute_declinations(pitch),
        }

    def _analyze_pauses(self):
        """Analyze pause patterns from word timestamps."""
        pauses = []
        for i in range(len(self.words) - 1):
            gap = self.words[i+1]['start'] - self.words[i]['end']
            is_boundary = self._is_sentence_boundary(i)
            pauses.append({
                'after_word': self.words[i]['word'],
                'duration_ms': gap * 1000,
                'is_boundary': is_boundary,
                'is_appropriate': is_boundary or gap < 0.2,
                'type': self._classify_pause(gap, is_boundary),
            })

        durations = [p['duration_ms'] for p in pauses if p['duration_ms'] > 150]
        return {
            'all_pauses': pauses,
            'total_count': len([p for p in pauses if p['duration_ms'] > 200]),
            'appropriate_count': len([p for p in pauses if p['is_appropriate'] and p['duration_ms'] > 200]),
            'inappropriate_count': len([p for p in pauses if not p['is_appropriate'] and p['duration_ms'] > 200]),
            'mean_duration_ms': float(np.mean(durations)) if durations else 0,
            'sd_duration_ms': float(np.std(durations)) if durations else 0,
            'long_pause_count': len([p for p in pauses if p['duration_ms'] > 1000]),
            'pause_to_speech_ratio': self._pause_to_speech_ratio(pauses),
        }

    def _compute_rubric_scores(self):
        """Map features to NAEP and MFS rubric dimensions."""
        pitch_data = self._extract_pitch()
        pause_data = self._analyze_pauses()
        rate_data = self._compute_speech_rate()

        # Expression (1-4): based on F0 variation
        f0_sd = pitch_data['passage_f0_sd']
        if f0_sd > 60: expression = 4
        elif f0_sd > 45: expression = 3
        elif f0_sd > 30: expression = 2
        else: expression = 1

        # Phrasing (1-4): based on phrase length and pause appropriateness
        phrase_data = self._analyze_phrasing()
        mean_phrase_len = phrase_data['mean_phrase_length']
        if mean_phrase_len >= 5: phrasing = 4
        elif mean_phrase_len >= 3.5: phrasing = 3
        elif mean_phrase_len >= 2: phrasing = 2
        else: phrasing = 1

        # Smoothness (1-4): based on inappropriate pauses and long pauses
        inappropriate_ratio = pause_data['inappropriate_count'] / max(1, pause_data['total_count'])
        long_pauses = pause_data['long_pause_count']
        if inappropriate_ratio < 0.1 and long_pauses <= 1: smoothness = 4
        elif inappropriate_ratio < 0.2 and long_pauses <= 3: smoothness = 3
        elif inappropriate_ratio < 0.35: smoothness = 2
        else: smoothness = 1

        # Pace (1-4): based on WCPM and pace variability
        wcpm = rate_data['wcpm']
        if 120 <= wcpm <= 160 and rate_data['pace_variability'] < 0.2: pace = 4
        elif 100 <= wcpm <= 180: pace = 3
        elif 80 <= wcpm <= 200: pace = 2
        else: pace = 1

        mfs_total = expression + phrasing + smoothness + pace

        return {
            'naep_level': self._compute_naep_level(phrasing, expression),
            'mfs': {
                'expression': expression,
                'phrasing': phrasing,
                'smoothness': smoothness,
                'pace': pace,
                'total': mfs_total,
                'concern': mfs_total < 8,
            }
        }
```

#### Integration with existing Reverb server

```python
# In services/reverb/server.py, after Reverb ASR processing:

from prosody import ProsodyAnalyzer

@app.route('/analyze', methods=['POST'])
def analyze():
    audio_file = request.files['audio']
    passage_text = request.form['passage']

    # Existing: Reverb ASR
    reverb_result = run_reverb(audio_file)

    # New: Prosody analysis (runs in parallel or sequentially)
    prosody = ProsodyAnalyzer(
        audio_path=audio_file,
        word_timestamps=reverb_result['words'],
        passage_text=passage_text
    )
    prosody_result = prosody.extract_all()

    return jsonify({
        'reverb': reverb_result,
        'prosody': prosody_result,
    })
```

### 6.3 Client-Side Implementation Plan

#### Lightweight real-time pitch visualization

```javascript
// js/prosody-viz.js

class ProsodyVisualizer {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.pitchHistory = [];
    this.maxHistory = 300; // ~3 seconds at 10ms intervals

    // YIN pitch detector from pitchfinder
    this.detectPitch = Pitchfinder.YIN({ sampleRate: 44100 });
  }

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioContext = new AudioContext({ sampleRate: 44100 });
    const source = this.audioContext.createMediaStreamSource(stream);

    // Use AnalyserNode for simplicity (ScriptProcessor fallback)
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    source.connect(this.analyser);

    this.buffer = new Float32Array(this.analyser.fftSize);
    this.draw();
  }

  draw() {
    requestAnimationFrame(() => this.draw());

    this.analyser.getFloatTimeDomainData(this.buffer);
    const pitch = this.detectPitch(this.buffer);

    if (pitch && pitch > 80 && pitch < 600) {
      this.pitchHistory.push(pitch);
    } else {
      this.pitchHistory.push(null); // silence/unvoiced
    }

    if (this.pitchHistory.length > this.maxHistory) {
      this.pitchHistory.shift();
    }

    this.renderContour();
  }

  renderContour() {
    const { ctx, canvas, pitchHistory } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = '#f8f8f8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw pitch contour
    ctx.beginPath();
    ctx.strokeStyle = '#2196F3';
    ctx.lineWidth = 2;

    const step = canvas.width / this.maxHistory;
    const minPitch = 100, maxPitch = 500; // Hz range for children

    for (let i = 0; i < pitchHistory.length; i++) {
      if (pitchHistory[i] === null) continue;

      const x = i * step;
      const y = canvas.height - ((pitchHistory[i] - minPitch) / (maxPitch - minPitch)) * canvas.height;

      if (i === 0 || pitchHistory[i-1] === null) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Monotone warning zone
    const recentPitches = pitchHistory.slice(-50).filter(p => p !== null);
    if (recentPitches.length > 10) {
      const sd = this.standardDeviation(recentPitches);
      if (sd < 15) {
        ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
        ctx.fillRect(canvas.width - 50 * step, 0, 50 * step, canvas.height);
      }
    }
  }

  standardDeviation(arr) {
    const mean = arr.reduce((a, b) => a + b) / arr.length;
    return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
  }
}
```

### 6.4 Processing Time Budget

For a 1-minute reading audio clip:

| Component | Where | Time |
|-----------|-------|------|
| Reverb ASR (existing) | Server (Python) | ~5-10s |
| Parselmouth F0 extraction | Server (Python) | ~1-2s |
| Parselmouth intensity | Server (Python) | ~0.5s |
| Pause computation | Server (Python) | ~0.1s |
| Prosody scoring | Server (Python) | ~0.1s |
| **Total prosody** | **Server** | **~2-3s** |
| Deepgram ASR (existing) | Cloud API | ~3-5s |
| **Real-time pitch (YIN)** | **Browser** | **<10ms/frame** |

**The prosody analysis adds only ~2-3 seconds to server processing and runs in parallel with existing Reverb/Deepgram processing. Net wall-clock impact: minimal.**

---

## 7. Recommended Implementation Plan

### Phase 1: Server-Side Prosody (Weeks 1-2)

**Goal:** Add prosody scoring to existing pipeline alongside Reverb.

1. Install Parselmouth on Reverb server: `pip install praat-parselmouth`
2. Create `services/reverb/prosody.py` with `ProsodyAnalyzer` class
3. Extract: F0 contour (per-word + passage), intensity, pause metrics
4. Compute: MFS scores (expression, phrasing, smoothness, pace), NAEP level
5. Return prosody data in existing API response
6. Display prosody scores in UI (new section in results view)

**Dependencies:** None beyond pip install. Uses existing ASR timestamps.

### Phase 2: Pause Analysis Enhancement (Week 2)

**Goal:** Leverage existing per-word timestamps for detailed pause analysis.

1. Compute all pause metrics from Reverb + Deepgram timestamps
2. Classify pauses: appropriate (at punctuation) vs inappropriate (mid-phrase)
3. Calculate phrase lengths and phrasing quality score
4. Map pause patterns to NAEP phrasing levels
5. Show pause analysis in alignment view (color-coded gaps)

**Dependencies:** Phase 1 for the scoring framework. Can partly run client-side using existing timestamp data.

### Phase 3: Real-Time Pitch Visualization (Weeks 3-4)

**Goal:** Show live pitch contour while student reads for immediate feedback.

1. Install pitchfinder: `npm install pitchfinder`
2. Create `js/prosody-viz.js` with real-time YIN pitch tracking
3. Add Canvas element overlaying or adjacent to passage text
4. Show scrolling pitch contour in real time
5. Color feedback: green = varied pitch, yellow = flat, red = monotone section
6. This is MOTIVATIONAL/AWARENESS only -- not used for scoring

**Dependencies:** None. Standalone browser feature.

### Phase 4: Deep Learning Prosody (Future)

**Goal:** wav2vec2-based prosody scoring for maximum accuracy.

1. Evaluate pre-trained wav2vec2 models on our reading data
2. Fine-tune on child reading data if available
3. Compare to Parselmouth handcrafted features
4. Potentially replace or supplement Phase 1 scoring

**Dependencies:** GPU server, training data, significant ML engineering.

### Key Libraries Summary

| Library | Where | Purpose | Install |
|---------|-------|---------|---------|
| **Parselmouth** | Server (Python) | Gold-standard prosody extraction | `pip install praat-parselmouth` |
| **openSMILE** | Server (Python) | Standard feature sets (eGeMAPS, ComParE) | `pip install opensmile` |
| **praatio** | Server (Python) | TextGrid manipulation | `pip install praatio` |
| **pitchfinder** | Browser (JS) | Real-time YIN pitch detection | `npm install pitchfinder` |
| **Essentia.js** | Browser (JS) | Advanced WASM audio analysis | `npm install essentia.js` |
| **ml5.js** | Browser (JS) | CREPE neural pitch detection | cdn/npm |
| **MFA** | Server (Python) | Forced alignment (if needed) | `conda install montreal-forced-aligner` |

---

## Appendix A: Key Research Papers

1. **Bree &"; (2022)** -- "Is reading prosody related to reading comprehension? A meta-analysis" -- PMC8916711. 35 studies, N=9,349. Overall r=0.51 prosody-comprehension link.

2. **Wolters et al. (2024)** -- "Prosodic features in production reflect reading comprehension skill in high school students" -- PMC11493852. Prosody predicts comprehension independent of decoding.

3. **Miller & Schwanenflugel (2008)** -- "Becoming a Fluent Reader: Reading Skill and Prosodic Features in the Oral Reading of Young Readers" -- PMC2748352. Pause duration and F0 declination data.

4. **Wang et al. (2024)** -- "Improving automated scoring of prosody in oral reading fluency using deep learning" -- Frontiers in Education. 62.5% cross-domain NAEP accuracy.

5. **Bosch et al. (2024)** -- "Deep Learning for Assessment of Oral Reading Fluency" -- arXiv 2405.19426. wav2vec2 r=0.827 on comprehensibility.

6. **Hannah et al. (2025)** -- "Investigating construct representativeness and linguistic equity of automated ORF assessment with prosody" -- SAGE. Prosody reduces ELL bias.

7. **Kim et al. (2018)** -- "CREPE: A Convolutional Representation for Pitch Estimation" -- ICASSP. Neural pitch detection, 90%+ accuracy.

8. **Jadoul et al. (2018)** -- "Introducing Parselmouth: A Python interface to Praat" -- Journal of Phonetics.

9. **Rasinski (2004)** -- Multidimensional Fluency Scale. Four dimensions of prosody, 1-4 scale.

10. **NAEP (1992, 2018)** -- Oral Reading Fluency Scale and 2018 ORF Study. National gold standard rubric.

## Appendix B: SoapBox Labs Prosody Thresholds Reference

SoapBox Labs (commercial API specifically tuned for children's speech) publishes these prosody thresholds:

| Feature | Metric | Threshold | Meaning |
|---------|--------|-----------|---------|
| Word expressiveness | F0 SD per word | > 26 Hz | "High expressiveness" for that word |
| Passage expressiveness | F0 SD across passage | > 52 Hz | "High expressiveness" overall |
| Incorrect pause | Gap between non-boundary words | > 200ms | Inappropriate hesitation |
| Question intonation | F0 slope at "?" | > 130 Hz rise | Correct question prosody |
| Declarative intonation | F0 slope at "." | < -90 Hz fall | Correct statement prosody |
| Final score | Average of dimension scores | 1-5 scale | Overall prosody rating |

Children's voice pitch range: 215-400 Hz. Their engine is tuned for sensitivity in this range.

## Appendix C: WCPM Norms for Reference

Hasbrouck & Tindal (2017) norms showing the WCPM plateau:

| Grade | Fall 50%ile | Spring 50%ile | Delta |
|-------|-----------|-------------|-------|
| 3 | 92 | 120 | +28 |
| 4 | 110 | 133 | +23 |
| 5 | 121 | 139 | +18 |
| 6 | 127 | 140 | +13 |
| 7 | 128 | 136 | +8 |
| 8 | 133 | 146 | +13 |

Growth decelerates sharply after grade 5. By grade 7, annual WCPM growth is only 8 words. Prosody is where the meaningful differentiation happens at these levels.
