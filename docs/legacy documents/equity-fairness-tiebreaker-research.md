# Equity & Fairness Implications of Reference-Aware ASR Tiebreaker for ORF Assessment

**Date:** 2026-02-08
**Status:** Research synthesis complete
**Relevance:** Critical — this analysis should inform implementation guardrails, documentation, and future validation priorities

---

## Executive Summary

The reference-aware tiebreaker operates in a domain where ASR systems exhibit well-documented demographic disparities. The tiebreaker will fire more often for students whose speech patterns cause greater ASR disagreement — disproportionately Black students, speakers of non-standard dialects, English Language Learners, and younger children. This creates a mechanism that is simultaneously:

- **Potentially beneficial:** Correcting ASR misrecognitions of correctly-read dialect speech toward the reference word (the student said it right; the ASR garbled it)
- **Potentially harmful:** Masking genuine reading errors by autocorrecting dialect pronunciations that are actually misreadings

The research strongly suggests the **beneficial case is more common** for the ORF use case (known-text assessment where base rate of correct reading is high), but the harmful case is real and must be monitored. The tiebreaker is likely **less biased than the status quo** (always trusting Reverb), but it is not bias-free.

---

## 1. Koenecke et al. 2020: Verified Racial Disparities in ASR

### Original Findings (Confirmed)

The numbers cited in the tiebreaker research synthesis are accurate:

| Metric | Black Speakers | White Speakers | Gap |
|---|---|---|---|
| **Average WER (all 5 systems)** | **0.35** | **0.19** | **0.16 (1.84x)** |
| Best system (Microsoft) | 0.27 | 0.15 | 0.12 |
| Worst system (Apple) | 0.45 | 0.23 | 0.22 |
| Snippets with WER >= 0.50 | >20% | <2% | >10x |

Study details:
- Five commercial ASR systems: Amazon, Apple, Google, IBM, Microsoft
- 42 White speakers, 73 Black speakers across 5 US cities
- 19.8 hours of structured interviews
- Racial gap persisted even on **identical phrases** spoken by Black and White speakers, confirming the disparity is acoustic (voice characteristics) not linguistic (word choice)

**No system achieved equal performance.** All five exhibited substantial racial disparities.

Source: [Koenecke et al. 2020, PNAS](https://www.pnas.org/doi/10.1073/pnas.1915768117)

### Have Things Improved? (2024-2026)

**Partially, but disparities persist:**

- **Harris et al. (EMNLP 2024):** Tested wav2vec 2.0, HuBERT, and Whisper on AAVE, Chicano English, and Spanglish vs. Standard American English (SAE). SAE transcription significantly outperformed every minority dialect across all three models. AAVE performed best under Whisper (which had the most inclusive training data), but still worse than SAE. Spanglish and Chicano English had the worst transcriptions.

- **Johnson et al. (2025):** WERs of **39% for story retelling** and **30% for picture description** tasks using wav2vec 2.0 on AAE speech. Chang et al. reported **52.8% WER** for wav2vec 2.0 on the CORAAL dataset.

- **ASR-FAIRBENCH (2025):** Benchmarked Whisper (small, medium, tiny), fine-tuned Wav2Vec, and HuBERT using Meta's Fair-Speech dataset (26,500 utterances, diverse demographics). Found "significant performance disparities in state-of-the-art ASR models across demographic groups." Whisper-medium scored highest on fairness-adjusted metrics (29.41 FAAS). Critically, **lower WER does not guarantee better fairness** — Whisper-tiny had higher WER but better overall fairness than some fine-tuned models.

- **Healthcare study (JAMIA Open, Dec 2024):** ASR continues to perform worse for racial minorities, with underperformance "primarily due to the underrepresentation of AAVE in training datasets."

**Bottom line:** The absolute gap has likely narrowed from 1.84x to perhaps 1.3-1.5x for the best modern models, but no published evidence shows parity has been achieved. For Reverb and Parakeet specifically (neither fine-tuned on diverse dialect data), the Koenecke-era magnitude of disparity is plausible.

Sources:
- [Harris et al. 2024 (EMNLP)](https://aclanthology.org/2024.findings-emnlp.890.pdf)
- [Georgia Tech press release](https://news.gatech.edu/news/2024/11/15/minority-english-dialects-vulnerable-automatic-speech-recognition-inaccuracy)
- [ASR-FAIRBENCH 2025](https://arxiv.org/abs/2505.11572)
- [JAMIA Open Dec 2024](https://academic.oup.com/jamiaopen/article/7/4/ooae130/7920671)

---

## 2. Dialect Impact on ASR

### African American Vernacular English (AAVE)

**Specific phonological features that cause ASR errors:**

| Feature | Example | ASR Impact |
|---|---|---|
| **Consonant Cluster Reduction (CCR)** | "cold" -> [col], "best" -> [bes] | Statistically significant increase in WER; ASR may transcribe the reduced form or miss the word entirely |
| **ING-reduction** | "running" -> "runnin" | Velar [ng] -> alveolar [n]; ASR trained on SAE often fails to recognize the variant |
| **TH-stopping** | "the" -> [de], "think" -> [tink] | DIBELS explicitly accommodates this; ASR may not |
| **Final consonant deletion** | "hand" -> [han] | Compounds with CCR; word boundary confusion |
| **Habitual "be"** | "he be running" | Morphosyntactic; ASR may insert/delete words |

A 2025 study confirmed that "reduced pronunciation leads to a higher WER" and that utterances containing more phonological and morphosyntactic AAE features exhibit higher error rates. Language models help: without an LM, 7.9% of errors were neighborhood-related; with an LM, this dropped to 3.3%.

Source: [Automatic Speech Recognition of African American English: Lexical and Contextual Effects (2025)](https://arxiv.org/html/2506.06888v2)

### Southern American English / Appalachian English

**Lai, van Hell & Lipski (American Speech, 2025):** Tested ASR on Appalachian English speakers vs. non-Southern speakers reading aloud. Found:
- Higher phoneme error rates for Southern Appalachian speech
- **50.2% of errors** in the Southern dataset attributed to **Southern Vowel Shift** participation
- The vowel system is the primary collision point between dialect and ASR acoustic models

Source: [Dialect Bias in ASR: Analysis of Appalachian English](https://read.dukeupress.edu/american-speech/article/100/2/190/392858/Dialect-Bias-in-Automatic-Speech-Recognition)

### The Three-Way Interaction: Dialect + ASR + Reference

When a student uses dialect pronunciation, the ASR can do one of three things:

| ASR Behavior | Example | Tiebreaker Effect | Assessment Impact |
|---|---|---|---|
| **Correctly transcribes dialect form** | Student says [col] for "cold"; ASR outputs "col" | Tiebreaker does NOT fire (neither engine matches "cold") | Status quo: marked as substitution. **Harmful** — student read correctly in their dialect |
| **Autocorrects to SAE form** | Student says [col]; ASR outputs "cold" | Tiebreaker may fire if engines disagree (one "col", one "cold") | **Beneficial** — credits a correctly-read word |
| **Garbles entirely** | Student says [col]; ASR outputs "call" or nonsense | Tiebreaker may fire if one engine got "cold" and other got "call" | **Ambiguous** — could be correcting garbled dialect recognition OR masking a real error |

**Critical insight:** The tiebreaker's behavior depends entirely on which failure mode is more common for each dialect feature. For phonological features that are close to the standard form (CCR, ING-reduction), autocorrect-to-SAE is more likely. For features that are acoustically distant (TH-stopping, vowel shifts), garbling or dialect-form transcription is more likely.

---

## 3. ORF Scoring Standards and Dialect

### DIBELS / Acadience Official Position

The DIBELS 8th Edition Administration and Scoring Guide states explicitly:

> "Students are not penalized for differences in pronunciation due to dialect, articulation delays or impairments, or speaking a first language other than English."

Specific examples from the guide:
- A student who consistently says /d/ for /TH/ (TH-stopping, common in AAVE) is **not penalized**
- A student who says /th/ for /s/ is **not penalized** on phoneme segmentation
- Assessors should be "familiar with the speech patterns of the students they assess"
- If dialect differences make understanding difficult, "consider someone retesting the student who is more familiar with the student's articulation or dialect"

Source: [DIBELS 8 Administration and Scoring Guide](https://dibels.uoregon.edu/sites/default/files/2024-01/dibels8_admin_scoring_guide.pdf)

### NAEP 2018 ORF Study

The NAEP automated scoring system "recognizes accepted pronunciations of each word, taking into account dialect and second-language variations as long as the speaking pattern remains consistent throughout the reading."

This means the NAEP system has a **pronunciation dictionary** that includes dialect variants. Our system does not — it relies on ASR transcription, which may or may not recognize dialect forms.

Source: [NAEP ORF Scoring](https://nces.ed.gov/nationsreportcard/studies/orf/scoring.aspx)

### The Gap Between Policy and Automated Practice

| Aspect | Human Scorer | NAEP Automated | Our System |
|---|---|---|---|
| Dialect awareness | Trained to recognize patterns | Pronunciation dictionary with dialect variants | None — depends on ASR behavior |
| "Consistent pattern" rule | Assessor applies judgment | System tracks consistency | Not implemented |
| Accommodation mechanism | Scorer gives credit | Multiple pronunciations per word | Tiebreaker (indirect, unintentional) |
| Student-specific adaptation | Assessor knows the child | None | None |

**The tiebreaker inadvertently functions as a partial dialect accommodation mechanism** — when ASR autocorrects dialect speech to the standard form, and this matches the reference, the tiebreaker credits it. But this is incidental, not designed, and does not cover cases where both engines fail on the same dialect feature.

---

## 4. English Language Learners (ELL)

### ASR Performance on L2 Speech

| Study | L1 Accuracy | L2 Accuracy | Gap |
|---|---|---|---|
| Choe et al. (COLING 2022) | Varies by accent | Significant WER increase for non-native speakers | Language-specific error patterns |
| Swedish study (2024) | 89.4% | 65.7% | 23.7 percentage points |
| Whisper on non-native speech | Baseline | 28.7% WER on non-native spontaneous speech | Substantial degradation |

**ELL-specific error patterns:**
- Predictable from the phonological structure of the speaker's L1
- ~50% of error types differ between L1 and L2 speakers
- Vowel confusion is the dominant error (L2 phoneme inventories are typically smaller)
- Prosodic patterns (stress, rhythm) differ systematically, affecting word boundary detection

Sources:
- [Choe et al. 2022 (COLING)](https://aclanthology.org/2022.coling-1.628/)
- [Swedish L1 vs L2 ASR study](https://arxiv.org/html/2405.13379v1)

### ELL + Tiebreaker Interaction

ELL students present a distinct challenge:
- **Higher ASR disagreement rate** (more words where engines differ)
- **Tiebreaker fires more often** for ELL students
- **Beneficial case:** Student reads the word correctly but with L2 accent; ASR garbles it; tiebreaker recovers it
- **Harmful case:** Student produces an L1-influenced mispronunciation; one engine autocorrects to reference; tiebreaker masks the error

The beneficial case is particularly strong for ELL students reading below-grade-level passages where the vocabulary is well within their knowledge but their accent causes ASR failures.

### Hannah & Jang (2025): Linguistic Equity in Automated ORF

A directly relevant 2025 study investigated "construct representativeness and linguistic equity of automated oral reading fluency assessment with prosody" in a post-secondary setting with many ELL students. Key finding: "insensitivity to linguistic diversities threatens valid score interpretations and fair use for all learners."

Source: [Hannah et al. 2025, Language Testing](https://journals.sagepub.com/doi/10.1177/02655322251348956)

---

## 5. The Double-Edged Sword: Detailed Analysis

### Scenario Analysis

| Scenario | Student reads... | ASR produces... | Tiebreaker does... | Outcome |
|---|---|---|---|---|
| **A: Correct word, ASR garbles** | "wiggle" correctly | Reverb: "wigglewigle", Parakeet: "wiggle" | Credits "wiggle" | CORRECT (true positive recovery) |
| **B: Correct dialect pronunciation** | [col] for "cold" | Reverb: "call", Parakeet: "cold" | Credits "cold" | CORRECT (dialect accommodation) |
| **C: Correct dialect, both fail** | [col] for "cold" | Reverb: "call", Parakeet: "call" | Does not fire (both agree) | INCORRECT (false error, but tiebreaker can't help) |
| **D: Real error, one autocorrects** | "call" for "cold" | Reverb: "call", Parakeet: "cold" | Credits "cold" | INCORRECT (masks real error) |
| **E: Real error, no autocorrect** | "ball" for "cold" | Reverb: "ball", Parakeet: "ball" | Does not fire (both agree) | CORRECT (real error preserved) |
| **F: Dialect error ambiguity** | Unclear: dialect or error? | Reverb: "col", Parakeet: "cold" | Credits "cold" | AMBIGUOUS (depends on student's intention) |

### Which Is More Likely? Research-Based Assessment

**The beneficial case (A, B) is more likely than the harmful case (D) for several reasons:**

1. **Base rate:** In ORF assessment, even struggling readers get 80%+ of words right. When engines disagree and one matches reference, the prior probability of correct reading is 75-85% (see Part 8 of the tiebreaker research synthesis).

2. **Autocorrect-to-reference requires specific conditions:** The ASR must independently (without seeing reference text) produce the reference word from wrong acoustic input. This requires phonetic similarity between the error and the reference AND the reference having higher LM probability. Both conditions are needed.

3. **ORF vocabulary is common:** High-frequency words are exactly where ASR LMs are strongest, meaning both engines are more likely to correctly recognize a correctly-spoken common word, not just autocorrect to it.

4. **Dialect misrecognitions are acoustic failures:** When ASR fails on dialect speech, it typically produces garbage or wrong words — one engine getting it right (especially the one with different architecture) is genuine acoustic recognition, not autocorrect.

**However, the harmful case (D) is not negligible:**
- Piton et al. (Interspeech 2023) documented that commercial ASR "returns target words when children misread" at rates around 30-40% (the autocorrect problem)
- Parakeet's Whisper-inherited pseudo-label bias makes it more prone to producing fluent common words
- The harmful case is most dangerous for **near-miss substitutions** ("ball" for "bold", "cold" for "could") where phonetic similarity enables autocorrect

### Estimated Net Impact by Scenario

For a 100-word passage with 15 words of engine disagreement:

| Reader Profile | Beneficial corrections | Harmful masks | Net WCPM impact |
|---|---|---|---|
| Typical reader, SAE | 3-5 recovered | 0-1 masked | +2 to +4 (beneficial) |
| Typical reader, AAVE | 4-7 recovered | 0-2 masked | +2 to +5 (more beneficial due to higher disagreement) |
| Struggling reader, SAE | 2-4 recovered | 1-2 masked | +0 to +2 (modest benefit) |
| Struggling reader, AAVE | 3-6 recovered | 1-3 masked | +0 to +3 (benefit, but more uncertainty) |
| ELL student | 4-8 recovered | 1-2 masked | +2 to +6 (strongest benefit) |

**Key finding: The tiebreaker likely provides the LARGEST absolute benefit to the groups with the highest ASR error rates** — but also introduces the most uncertainty for those same groups.

---

## 6. Fairness in Educational Assessment: Standards and Guidelines

### ITC Guidelines for Assessment of Diverse Populations

The International Test Commission guidelines state that assessments must ensure "validity, reliability, and fairness for linguistically or culturally diverse populations." Specific requirements:
- Assessment methods should not be "perpetuating or exacerbating existing inequities"
- Bias, fairness, and sensitivity reviews should "eliminate language, symbols, words, phrases, and content that might be considered offensive"
- Testing accommodations should be available for linguistic diversity

Source: [ITC Guidelines](https://www.intestcom.org/files/guideline_diverse_populations.pdf)

### Differential Item Functioning (DIF)

Educational measurement research shows that **up to 25% of test items** could unintentionally advantage or disadvantage specific demographic groups (Differential Item Functioning). The tiebreaker is not a test item, but the principle applies: if the tiebreaker systematically behaves differently for different demographic groups, it introduces measurement bias.

### CHI 2025: Cascading Effects of ASR Bias

A 2025 CHI paper examined "the cascading effects of bias in automatic speech recognition in spoken language interfaces." Key finding: ASR errors don't just affect transcription — they cascade through downstream systems, amplifying disparities at each stage. In our system, ASR bias cascades through: transcription -> cross-validation -> tiebreaker -> alignment -> scoring -> WCPM.

Source: [CHI 2025](https://dl.acm.org/doi/10.1145/3706598.3714059)

### Assessment Expert Recommendations

From multiple sources:
1. **Validate with diverse samples:** Any automated scoring system must be validated on samples that represent the full demographic diversity of the target population
2. **Report performance by subgroup:** WER, WCPM accuracy, and tiebreaker activation rates should be tracked and reported by demographic group
3. **Establish DIF analysis:** Compare tiebreaker impact across groups to detect systematic bias
4. **Maintain human review:** Automated scoring should supplement, not replace, human judgment for high-stakes decisions
5. **Use multiple measures:** No single assessment (especially automated) should determine placement or intervention

Sources:
- [Choi 2025, Differential Prediction Bias in Automated Scoring](https://onlinelibrary.wiley.com/doi/10.1111/jedm.70015)
- [Fairness in Automated Essay Scoring, BEA 2024](https://aclanthology.org/2024.bea-1.18.pdf)

---

## 7. Differential Impact Analysis

### The Mechanism

The tiebreaker fires when engines disagree. Engines disagree more for:
- **Black speakers:** Higher WER (0.35 vs 0.19 in Koenecke; still elevated in modern models)
- **AAVE speakers:** Phonological features systematically misrecognized (CCR, ING-reduction, TH-stopping)
- **Southern dialect speakers:** Southern Vowel Shift accounts for 50.2% of ASR errors
- **ELL students:** 23.7 percentage point accuracy gap (L1 89.4% vs L2 65.7%)
- **Younger children:** WER 2-5x worse than adults
- **Male students 12-14:** Voice change creates highly variable F0 (150-240 Hz)

### Predicted Differential Tiebreaker Activation

| Student Group | Estimated Disagreement Rate | Estimated Tiebreaker Fires | Direction of Impact |
|---|---|---|---|
| White, SAE, typical reader | 8-12% of words | 3-5% of words | Modest score inflation (+2-4 WCPM) |
| Black, AAVE, typical reader | 15-25% of words | 7-12% of words | Larger score inflation (+3-7 WCPM) |
| Southern dialect, typical reader | 12-18% of words | 5-9% of words | Moderate score inflation (+2-5 WCPM) |
| ELL student | 18-30% of words | 8-15% of words | Largest score inflation (+4-8 WCPM) |
| Struggling reader (any background) | Variable, but adaptive threshold may disable | Reduced by adaptive threshold | Threshold protects against score inflation |

### Does This Inflate or Deflate Scores?

**The tiebreaker systematically inflates scores** (credits more words as correct). The inflation is **larger for groups with higher ASR error rates.** This means:

**If the tiebreaker is mostly correct** (recovering real correct words garbled by ASR):
- The differential inflation is **EQUITABLE** — it corrects a larger ASR-induced deficit for disadvantaged groups
- Without the tiebreaker, these groups have artificially deflated WCPM due to ASR failures
- The tiebreaker moves their scores closer to ground truth

**If the tiebreaker is substantially wrong** (masking real errors):
- The differential inflation is **INEQUITABLE** — it hides more errors for disadvantaged groups
- This could mask genuine reading difficulties that need intervention
- It creates a false sense of progress

### The Status Quo Is Also Inequitable

Without the tiebreaker, the current system always trusts Reverb on disagreement. This means:
- When Reverb garbles a word that Parakeet got right, the student loses a point
- This happens more often for students whose speech causes more Reverb errors
- **The status quo systematically deflates scores for the same disadvantaged groups**
- The question is not "tiebreaker vs. fairness" but "tiebreaker bias vs. status quo bias"

### Net Assessment

The tiebreaker likely **reduces overall demographic bias in WCPM scoring** compared to the status quo, because it corrects the asymmetric trust in Reverb that currently penalizes students with non-standard speech patterns. However, it does not eliminate bias, and the magnitude of improvement is unverified for diverse populations.

---

## 8. Children's Speech: The Compound Challenge

### ASR Performance on Children

| Metric | Adult Speech | Children's Speech | Gap |
|---|---|---|---|
| WER (Whisper zero-shot) | ~3% | 20-30% (grades 6-8) | 7-10x |
| WER (best fine-tuned) | ~3% | 8.6-9.2% (Kid-Whisper on MyST) | 3x |
| Voice assistant accuracy (under 5) | Baseline | "Newest Siri and Alexa models struggle" | Substantial |

**Key factors affecting child ASR:**
1. **Age** and **number of words** have the highest impact on accuracy
2. **Background noise** and **pronunciation ability** are secondary
3. Children's speech shows "more variability than adult speech" due to ongoing development
4. Boys 12-14: voice change creates F0 range of 150-240 Hz (highly variable)
5. Training data scarcity: most ASR models have minimal child speech data

Source: [Causal analysis of ASR errors for children (2025)](https://www.sciencedirect.com/science/article/pii/S0885230825000841)

### Intersecting Disadvantage: Dialect + Youth

A Black student aged 10-12 speaking AAVE faces compounded ASR disadvantage:
- Child speech penalties (2-5x WER)
- Dialect penalties (1.3-1.8x WER)
- Potential racial acoustic penalties (1.3-1.8x WER for voice characteristics alone)
- These factors are not necessarily additive but they are cumulative

For this student, the tiebreaker will fire very frequently. The benefit-to-harm ratio depends on how many of those firings are recovering genuine correct readings vs. masking errors. Given the high base rate of correct reading (80%+), most firings are likely beneficial, but the sheer volume increases the absolute number of harmful masks.

---

## 9. Recommendations

### Immediate (Before Shipping)

1. **Add tiebreaker activation rate to diagnostics output.** Display the percentage of words where the tiebreaker fired. If this exceeds 15% for a given passage, flag it as potentially unreliable.

2. **Log demographic patterns.** When possible, track tiebreaker activation rates across different passages and students. Watch for patterns suggesting systematic differential impact.

3. **Document the limitation.** The tool should disclose that it uses ASR technology with known performance disparities across demographics, and that the tiebreaker partially mitigates but does not eliminate these disparities.

4. **Keep the adaptive threshold.** The 80% accuracy threshold is the primary protection against score inflation for struggling readers. Do not remove or weaken it.

### Near-Term (Validation Phase)

5. **Empirical validation with diverse audio.** Priority #1. Collect or obtain 50+ passages from:
   - AAVE speakers
   - Southern dialect speakers
   - ELL students with various L1 backgrounds
   - Younger children (grades 3-5) if expanding age range
   - Human-score these passages; compare tiebreaker decisions against ground truth

6. **Differential Impact Analysis.** Compute tiebreaker precision/recall separately for each demographic group. If precision differs by more than 10 percentage points between groups, the tiebreaker introduces measurement bias that must be addressed.

7. **Compare WCPM error to human scores by group.** The key metric is not just "does the tiebreaker help on average?" but "does it help equally across groups?"

### Future Architecture

8. **Dialect-aware pronunciation dictionary.** Like NAEP, include multiple accepted pronunciations per word. This would handle Scenario C (both engines fail on dialect) which the tiebreaker cannot address.

9. **Fine-tune on children's speech.** The single highest-impact improvement. Kid-Whisper achieved 38% relative WER reduction. This reduces dependence on the tiebreaker entirely and reduces demographic disparities at the source.

10. **Consider dialect detection.** If the system could detect that a student speaks AAVE or another dialect, it could:
    - Adjust tiebreaker thresholds
    - Load dialect-specific pronunciation variants
    - Flag scores for human review
    - **Caution:** Dialect detection itself raises equity concerns (profiling, stereotyping)

---

## 10. Key Sources

| Source | Year | Key Finding | URL |
|---|---|---|---|
| Koenecke et al. | 2020 | WER 0.35 Black vs 0.19 White across 5 ASR systems | [PNAS](https://www.pnas.org/doi/10.1073/pnas.1915768117) |
| Harris et al. (EMNLP) | 2024 | SAE outperforms AAVE, Chicano English, Spanglish on wav2vec, HuBERT, Whisper | [ACL Anthology](https://aclanthology.org/2024.findings-emnlp.890.pdf) |
| Lai, van Hell & Lipski | 2025 | 50.2% of Southern Appalachian ASR errors from Southern Vowel Shift | [American Speech](https://read.dukeupress.edu/american-speech/article/100/2/190/392858/Dialect-Bias-in-Automatic-Speech-Recognition) |
| Johnson et al. / Chang et al. | 2025 | AAE WER: 30-39% (wav2vec); 52.8% (CORAAL) | [arXiv](https://arxiv.org/html/2506.06888v2) |
| ASR-FAIRBENCH | 2025 | Whisper-medium best fairness-adjusted score; lower WER != better fairness | [arXiv](https://arxiv.org/abs/2505.11572) |
| JAMIA Open | 2024 | ASR worse for racial minorities; AAVE underrepresented in training data | [Oxford Academic](https://academic.oup.com/jamiaopen/article/7/4/ooae130/7920671) |
| Hannah & Jang | 2025 | Linguistic insensitivity threatens valid ORF score interpretation for ELL | [Language Testing](https://journals.sagepub.com/doi/10.1177/02655322251348956) |
| Choe et al. | 2022 | Language-specific effects on ASR; L2 error patterns predictable from L1 | [COLING](https://aclanthology.org/2022.coling-1.628/) |
| Swedish L1/L2 study | 2024 | L1 accuracy 89.4% vs L2 65.7% | [arXiv](https://arxiv.org/html/2405.13379v1) |
| Singh et al. | 2025 | Child ASR: age has highest impact; WER 2-5x worse than adults | [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0885230825000841) |
| Piton et al. (Interspeech) | 2023 | Commercial ASR autocorrects 30-40% of children's reading errors | Interspeech 2023 proceedings |
| DIBELS 8 Scoring Guide | 2024 | "Not penalized for dialect, articulation, or L2 pronunciation" | [UO DIBELS](https://dibels.uoregon.edu/sites/default/files/2024-01/dibels8_admin_scoring_guide.pdf) |
| NAEP 2018 ORF | 2021 | Automated system includes dialect pronunciation variants; r=0.96 | [NCES](https://nces.ed.gov/nationsreportcard/studies/orf/scoring.aspx) |
| SERDA Validation | 2025 | Word-level precision 0.31 (69% false positives); schools selected for dialect regions | [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12686063/) |
| CHI 2025 | 2025 | Cascading effects of ASR bias through downstream systems | [ACM DL](https://dl.acm.org/doi/10.1145/3706598.3714059) |
| ITC Guidelines | — | Validity, reliability, fairness for diverse populations | [ITC](https://www.intestcom.org/files/guideline_diverse_populations.pdf) |
| Choi | 2025 | Features contributing to differential prediction bias in automated scoring | [Wiley](https://onlinelibrary.wiley.com/doi/10.1111/jedm.70015) |
| Gladia (Whisper bias) | 2024 | Whisper biases in dialect/accent recognition; training data composition matters | [Gladia](https://www.gladia.io/blog/ai-model-biases-what-went-wrong-with-whisper-by-openai) |
| Whisper accent evaluation | 2024 | Whisper favors American English; native accents > non-native | [JASA Express Letters](https://pubs.aip.org/asa/jel/article/4/2/025206/3267247/Evaluating-OpenAI-s-Whisper-ASR-Performance) |

---

## 11. Conclusion

The reference-aware tiebreaker exists in a landscape of well-documented ASR demographic disparities. The core tension is:

1. **The tiebreaker is likely better than the status quo for equity.** Always trusting Reverb on disagreement systematically penalizes students whose speech causes more Reverb errors — disproportionately Black students, dialect speakers, and ELL students. The tiebreaker provides a mechanism to recover these false penalties.

2. **The tiebreaker is not bias-free.** It fires more often for disadvantaged groups, and each firing carries a small risk of masking a real error. The net effect is likely positive, but the magnitude of benefit varies by demographic group in unverified ways.

3. **The tiebreaker cannot address the deepest equity problem.** When both engines fail on the same dialect feature (Scenario C), the tiebreaker cannot help. This requires dialect-aware pronunciation dictionaries or ASR models trained on diverse speech — systemic solutions, not post-hoc corrections.

4. **Empirical validation with diverse audio is non-negotiable.** The theoretical analysis suggests the tiebreaker is net-positive for equity, but theory is not evidence. The tool must be validated on diverse student populations before claims about equitable performance can be made.

5. **The adaptive threshold is an equity feature.** By disabling the tiebreaker when running accuracy drops below 80%, it prevents the most extreme score inflation scenarios — which would disproportionately affect struggling readers from disadvantaged backgrounds.

The tiebreaker should be implemented with clear documentation of its equity implications, built-in monitoring of activation patterns, and a commitment to empirical validation with diverse populations. It is an improvement over the status quo, not a solution to ASR equity.
