# Feature Research: Disfluency Detection via Reverb Verbatimicity

**Domain:** Oral Reading Fluency Assessment for RTI Tier 2 Struggling Readers
**Milestone:** Reverb ASR Integration - Disfluency Detection
**Researched:** 2026-02-05
**Confidence:** MEDIUM (Reverb API verified via official docs; clinical distinctions verified via ASHA; some implementation details require validation)

## Executive Summary

Reverb's verbatimicity parameter (0.0-1.0) enables model-level disfluency detection by comparing verbatim (v=1.0) and clean (v=0.0) transcripts. Words present in verbatim but absent in clean are disfluencies: fillers (um, uh), repetitions ("the the cat"), and false starts ("I w- I went").

**Critical clinical distinction:** Disfluencies are NOT reading errors. A child who says "the the the dog" read ONE word correctly with disfluency markers. WCPM should count this as 1 correct word, not 3 errors. Current ORF tools often conflate these, penalizing struggling readers unfairly.

**Why this matters for ReadingQuest:** The existing codebase already noted in `disfluency-detector.js` that "STT converts acoustic events into words, losing the original signal needed to reliably detect stutters." Reverb's dual-pass approach solves this at the model level.

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist when disfluency detection is advertised. Missing these = feature feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Filler word detection (um, uh, er, ah)** | Standard in verbatim ASR; teachers expect to see what student actually said | LOW | Reverb verbatim mode captures these; diff with clean reveals them |
| **Repetition detection ("the the cat")** | Core disfluency type; indicates decoding struggle or self-correction attempt | MEDIUM | Diff-based detection is reliable; classifying as self-correction vs error requires context |
| **Disfluency vs Error separation in UI** | Clinical standard; disfluencies and errors serve different diagnostic purposes | MEDIUM | Must display separately; disfluencies inform fluency, errors inform accuracy |
| **Disfluency count/rate metrics** | Teachers need quantitative data for progress monitoring | LOW | Count disfluencies per minute, percentage of words with disfluencies |
| **Visual distinction in word-synced playback** | Existing feature uses color-coding; disfluencies need their own visual treatment | LOW | Different color/style from errors; consider dimmed/italicized styling |
| **WCPM unaffected by disfluencies** | Per DIBELS/ORF standards: self-corrections and repetitions are NOT errors | LOW | Disfluencies must NOT decrement WCPM; only first instance of repeated word counts |

### Differentiators (Competitive Advantage)

Features that set ReadingQuest apart. Not expected, but valued in RTI Tier 2 context.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Disfluency type classification** | Distinguish fillers vs repetitions vs false starts; each has different clinical significance | MEDIUM | Reverb doesn't classify types; must infer from word patterns post-diff |
| **False start detection ("I w- I went")** | Rare in competing products; indicates word attack strategy issues | HIGH | Partial words are hard to detect; relies on Reverb capturing them |
| **Stutter severity integration** | Existing VAD-based stutter severity + Reverb disfluencies = richer diagnostic picture | MEDIUM | Combine signals in diagnostics panel; don't replace one with other |
| **Disfluency trend over time** | Track whether disfluency rate decreases with intervention | MEDIUM | Requires session history; valuable for RTI progress monitoring |
| **Reading difficulty vs speech fluency distinction** | Distinguish reading-specific disfluency from underlying speech disorder | HIGH | If disfluencies disappear on easier text, it's reading difficulty not stuttering |
| **Disfluency heat map** | Visual showing where in passage disfluencies cluster | LOW | Helps teachers identify specific word types or positions causing struggle |
| **Export disfluency data for SLP referral** | Generate report suitable for speech-language pathologist | MEDIUM | Structured data format for clinical handoff if speech disorder suspected |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems in clinical/educational context.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Count all repetitions as errors** | Seems to capture "mistakes" comprehensively | Violates ORF standards; unfairly penalizes struggling readers; conflates fluency with accuracy | Track disfluencies separately; report as fluency metric, not accuracy |
| **Automatic stuttering diagnosis** | Parents/teachers want definitive answers | Diagnosing speech disorders requires licensed SLP; legal/ethical liability | Flag for referral only; provide data for SLP, not diagnosis |
| **Filler word removal from display** | "Cleaner" transcript looks more professional | Loses diagnostic information; teachers need to see actual speech | Show fillers with distinct visual treatment (dimmed, italicized) |
| **Real-time disfluency feedback to student** | Immediate correction seems helpful | Increases anxiety; proven to worsen disfluency in struggling readers | Show to teacher only; student sees encouragement |
| **Penalize reading rate for disfluencies** | "True" reading speed should account for hesitations | WCPM is words correct, not time efficiency; disfluency is separate metric | Report disfluency rate as separate metric alongside WCPM |
| **Replace VAD stutter detection with Reverb** | Single source of truth seems cleaner | Two signals measure different things; VAD detects acoustic patterns, Reverb detects word-level events | Keep both; compare in diagnostics panel for richer clinical insight |

## Feature Dependencies

```
[Reverb API Backend Service]
    |
    +--requires--> [Dual-pass transcription (v=1.0 + v=0.0)]
                       |
                       +--requires--> [Word-level timestamp alignment between passes]
                                         |
                                         +--enables--> [Diff-based disfluency extraction]
                                                          |
                                                          +--enables--> [Filler detection]
                                                          +--enables--> [Repetition detection]
                                                          +--enables--> [False start detection]
                                                          |
                                                          +--feeds--> [Disfluency type classification]
                                                                         |
                                                                         +--displays--> [UI visual distinction]
                                                                         +--feeds--> [Metrics calculation]
                                                                         +--feeds--> [Progress tracking]

[Existing VAD stutter detection] --parallel-to-- [Reverb disfluency detection]
                                                        |
                                        (both feed diagnostic panel; complementary signals)

[Existing miscue-registry.js] <--MUST UPDATE-- [New disfluency types]
```

### Dependency Notes

- **Reverb API requires dual-pass:** Single pass won't reveal disfluencies; need both v=1.0 and v=0.0
- **Diff-based detection requires word alignment:** Must align verbatim and clean outputs by timestamp
- **Disfluency classification requires diff output:** Can't classify until you know what's a disfluency
- **UI requires classification:** Need to know type (filler/repetition/false start) for color-coding
- **VAD detection is parallel, not upstream:** Don't gate Reverb features on VAD; they're complementary
- **Miscue registry MUST be updated:** Per CLAUDE.md, new miscue types require registry entry in `js/miscue-registry.js`

## MVP Definition

### Launch With (v1)

Minimum viable disfluency detection: what's needed to validate Reverb approach works.

- [ ] Reverb backend service running (already designed in Reverb-ASR-Integration-Proposal.md)
- [ ] Dual-pass transcription (v=1.0, v=0.0) via `/ensemble` endpoint
- [ ] Diff-based disfluency extraction (words in verbatim but not clean)
- [ ] Basic disfluency classification (filler vs repetition vs other)
- [ ] UI: disfluencies shown in word timeline with distinct visual style
- [ ] Metrics: disfluency count and rate displayed in results panel
- [ ] WCPM calculation unchanged (disfluencies explicitly excluded from error count)
- [ ] Miscue registry updated with new disfluency types (`reverb_filler`, `reverb_repetition`, `reverb_false_start`)

### Add After Validation (v1.x)

Features to add once core disfluency detection is proven accurate.

- [ ] Disfluency trend tracking across sessions -- trigger: teachers request progress data
- [ ] False start detection refinement -- trigger: verify Reverb reliably captures partial words
- [ ] Disfluency heat map visualization -- trigger: teachers request location-based analysis
- [ ] Integration with existing VAD stutter severity -- trigger: compare signal quality

### Future Consideration (v2+)

Features to defer until Reverb integration is production-stable.

- [ ] SLP referral report export -- requires clinical validation of data format
- [ ] Reading difficulty vs speech disorder distinction -- requires multi-passage assessment workflow
- [ ] Real-time disfluency detection (streaming Reverb) -- performance/latency concerns

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Filler detection (um, uh) | HIGH | LOW | P1 |
| Repetition detection | HIGH | LOW | P1 |
| Disfluency vs error separation in UI | HIGH | MEDIUM | P1 |
| WCPM unaffected by disfluencies | HIGH | LOW | P1 |
| Disfluency metrics (count/rate) | HIGH | LOW | P1 |
| Disfluency type classification | MEDIUM | MEDIUM | P1 |
| Visual distinction in playback | MEDIUM | LOW | P1 |
| Miscue registry updates | HIGH | LOW | P1 |
| False start detection | MEDIUM | HIGH | P2 |
| Stutter severity integration | MEDIUM | MEDIUM | P2 |
| Disfluency trend tracking | MEDIUM | MEDIUM | P2 |
| Disfluency heat map | LOW | LOW | P3 |
| SLP referral export | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for milestone completion (validates Reverb disfluency detection)
- P2: Should have, add when core is stable
- P3: Nice to have, future consideration

## Clinical Context: Disfluency vs Error

### Why This Distinction Matters

Per [ASHA guidelines](https://www.asha.org/practice-portal/clinical-topics/fluency-disorders/), disfluencies are fundamentally different from reading errors:

**Disfluencies (NOT errors):**
- Fillers: "um", "uh", "er", "ah", "mm"
- Repetitions: "the the the dog"
- False starts: "I w- I went"
- Self-corrections: "the dog... the cat ran"
- Prolongations: "aaaaaand then"

**Reading Errors (count against accuracy):**
- Omissions: skipped a word entirely
- Substitutions: said a different word
- Mispronunciations: phonetically incorrect
- Long pauses (3+ seconds): indicates being stuck (per DIBELS)

### Scoring Implications

Per [DIBELS ORF scoring guidelines](https://dibels.uoregon.edu/resources/scoring-practice-oral-reading-fluency-orf):
- Self-corrections within 3 seconds are NOT errors
- Repetitions are NOT errors
- Only omissions, substitutions, and 3+ second hesitations count as errors

**Current problem in ORF tools:** Many conflate disfluency with error, unfairly penalizing RTI Tier 2 students who struggle but ultimately read correctly.

**Reverb solution:** Dual-pass transcription explicitly separates disfluencies (in verbatim only) from content words (in both transcripts).

### Clinical Assessment Guidance

Per [SpeechPathology.com expert guidance](https://www.speechpathology.com/ask-the-experts/reading-disfluency-versus-stuttering-781):

> "Have the student read material significantly below their reading level. If disfluencies disappear during easier text, this suggests reading difficulties rather than stuttering."

This informs a potential v2 feature: compare disfluency rates across passages of different difficulty to distinguish reading-specific disfluency from underlying speech disorder.

## Existing Codebase Integration Points

Based on analysis of current code:

| File | Current Function | Reverb Integration Point |
|------|------------------|-------------------------|
| `js/miscue-registry.js` | Source of truth for miscue types | **MUST ADD** new disfluency types (see below) |
| `js/disfluency-detector.js` | Simplified; notes STT limitations | **ENHANCE** with Reverb detection; currently returns severity=NONE |
| `js/diagnostics.js` | Hesitation, self-correction detection | **COMPLEMENT** with Reverb; don't replace existing detectors |
| `js/ensemble-merger.js` | Merges Google STT models | **PARALLEL**: reverb-merger.js per proposal |
| `FuturePlans/Reverb-ASR-Integration-Proposal.md` | Full architecture spec | **IMPLEMENT** per proposal; this research informs requirements |

### Miscue Registry Updates Required

Per CLAUDE.md: "When adding, modifying, or removing any miscue/error type, you MUST update `js/miscue-registry.js`."

New entries needed:

```javascript
// Add to DISFLUENCY_MISCUES or create new REVERB_DISFLUENCY_MISCUES section

reverb_filler: {
  description: 'Filler word (um, uh, er, ah) detected via Reverb verbatimicity diff',
  detector: 'reverb-merger.js -> classifyDisfluency()',
  countsAsError: false,  // CRITICAL: fillers are NOT errors
  config: null,
  example: {
    verbatim: 'the um dog',
    clean: 'the dog',
    result: '"um" detected as filler'
  },
  uiClass: 'word-filler'
},

reverb_repetition: {
  description: 'Word repetition detected via Reverb verbatimicity diff',
  detector: 'reverb-merger.js -> classifyDisfluency()',
  countsAsError: false,  // CRITICAL: repetitions are NOT errors
  config: null,
  example: {
    verbatim: 'the the the dog',
    clean: 'the dog',
    result: 'First two "the" instances detected as repetitions'
  },
  uiClass: 'word-repetition'
},

reverb_false_start: {
  description: 'False start/partial word detected via Reverb verbatimicity diff',
  detector: 'reverb-merger.js -> classifyDisfluency()',
  countsAsError: false,  // CRITICAL: false starts are NOT errors
  config: null,
  example: {
    verbatim: 'I w- I went',
    clean: 'I went',
    result: '"w" detected as false start'
  },
  uiClass: 'word-false-start'
}
```

## Technical Constraints

### What Reverb Provides (verified via official docs)

- **Verbatimicity parameter:** 0.0-1.0 scale, continuous
- **Verbatim (v=1.0):** "transcribes all spoken content" including fillers, repetitions, false starts
- **Non-verbatim (v=0.0):** "removes unnecessary phrases to improve readability"
- **Word-level timestamps:** CTM format with start time, duration, confidence
- **Confidence scores:** Per-word confidence values

### What Reverb Does NOT Provide

- Explicit disfluency type labels (must infer from diff patterns)
- Phonetic transcription of partial words (relies on acoustic capture)
- Prosody/pitch information
- Child-specific acoustic model (trained on general speech)

### Implementation Risk: Children's Speech

**LOW-MEDIUM confidence:** Reverb is trained on 200,000 hours of general speech. Performance on children's oral reading is unverified. The existing proposal includes A/B testing phase specifically to validate accuracy on student recordings.

**Mitigation:** Phase 3 of Reverb-ASR-Integration-Proposal.md includes side-by-side comparison with Google ensemble on real student audio.

## Competitor Feature Analysis

| Feature | AmiraLearning | ReadNaturally | DIBELS | ReadingQuest (Proposed) |
|---------|---------------|---------------|--------|------------------------|
| WCPM calculation | Yes | Yes | Yes | Yes (existing) |
| Error classification | Yes | Limited | Manual | Yes (existing) |
| Disfluency detection | Limited | No | Manual | **Yes (Reverb-based)** |
| Disfluency type classification | No | No | No | **Yes (differentiator)** |
| Disfluency vs error separation | Unclear | No | Manual | **Yes (differentiator)** |
| Filler word capture | No | No | No | **Yes (differentiator)** |
| False start detection | No | No | No | **Yes (differentiator)** |
| Stutter severity | No | No | No | Yes (existing + enhanced) |
| Progress trend tracking | Yes | Yes | Yes | Yes (to be enhanced) |

## Sources

**HIGH confidence (official documentation):**
- [Reverb ASR GitHub README](https://github.com/revdotcom/reverb/blob/main/asr/README.md) - verbatimicity parameter specification
- [Reverb Hugging Face Model Card](https://huggingface.co/Revai/reverb-asr) - training data and capabilities
- [ASHA Fluency Disorders](https://www.asha.org/practice-portal/clinical-topics/fluency-disorders/) - clinical distinction disfluency vs error
- [DIBELS ORF Scoring Guide](https://dibels.uoregon.edu/resources/scoring-practice-oral-reading-fluency-orf) - what counts as error in ORF

**MEDIUM confidence (verified with multiple sources):**
- [Reading Disfluency vs Stuttering - SpeechPathology.com](https://www.speechpathology.com/ask-the-experts/reading-disfluency-versus-stuttering-781) - clinical assessment guidance
- [Reading Rockets RTI Best Practices](https://www.readingrockets.org/topics/rti-and-mtss/articles/best-practice-rti-monitor-progress-tier-2-students) - progress monitoring expectations
- [Springer: Speech Enabled Reading Fluency Assessment](https://link.springer.com/article/10.1007/s40593-025-00480-y) - ASR in education validation study

**LOW confidence (single source or needs validation):**
- Reverb performance on children's speech (no published benchmarks found)
- Optimal verbatimicity threshold for ORF (Rev suggests 0.5 for captioning; ORF may need 1.0)
- False start capture reliability (depends on acoustic clarity of partial words)

---
*Feature research for: Disfluency Detection via Reverb Verbatimicity*
*Milestone: Reverb ASR Integration*
*Researched: 2026-02-05*
*Downstream consumer: Requirements definition and roadmap creation*
