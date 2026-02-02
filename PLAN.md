# Oral Reading Fluency (ORF) Assessment Tool — Project Plan

## Project Goal
Build a browser-based Oral Reading Fluency assessment tool for middle school students using Google Cloud Speech-to-Text, producing raw/verbatim transcripts that preserve disfluencies (um, uh, false starts, repetitions) for clinical-quality analysis.

---

## What Has Been Done

### 1. Created `orf_assessment.html` (single-file web app)
- **Double-click to open** in any browser, no server needed
- **Audio input**: Record via microphone (WebM/Opus) or upload WAV/FLAC/MP3/OGG/WebM
- **API key input**: User provides their own GCP API key
- **Reference passage field**: Text area for pasting the passage the student reads (not yet used programmatically)
- **Results display**:
  - Color-coded words by confidence (green ≥0.9, yellow 0.7–0.9, red <0.7)
  - Hover tooltip shows per-word confidence % and start/end timestamps
  - Plain text output
  - Full JSON word details (word, confidence, startTime, endTime)

### 2. Google Cloud STT Config (finalized)
All settings documented in detail in **`SETTINGS.md`**. Summary:
- `model: "latest_long"` + `useEnhanced: true` — best verbatim fidelity
- `enableAutomaticPunctuation: false` — no inserted commas/periods
- `enableSpokenPunctuation: false` — "period" stays as the word "period"
- `enableWordTimeOffsets: true` — timestamps for alignment
- `enableWordConfidence: true` — flags stutters/mumbles
- `maxAlternatives: 2` — second-best transcript catches missed repetitions/mispronunciations
- `speechContexts` with `boost: 5` — dynamically built from reference passage to boost expected vocabulary

### 3. Known Potential Issues
- `enableSpokenPunctuation` may error on the v1 endpoint; may need `v1p1beta1`.
- `speechContexts` has a limit of 500 phrases and 100 characters per phrase.

---

## What Still Needs To Be Done

### Phase 1: API Robustness
- [ ] **Test with a real API key** — confirm all config fields are accepted without error
- [ ] **Switch to `v1p1beta1` endpoint if needed** — for `enableSpokenPunctuation` support
- [ ] **Add `longrunningrecognize` support** — current synchronous endpoint caps at ~1 minute of audio; ORF passages can run longer. Need async polling via `operations.get`.

### Phase 2: Alignment / Diff Engine (the clinical core)
- [ ] **Implement passage-to-transcript alignment** — compare the reference passage (what the student *should* read) against the STT verbatim output (what they *actually* said)
- [ ] **Diff algorithm** — use word-level diff (e.g., Levenshtein / longest common subsequence) to classify each word as:
  - **Correct** — matches expected word
  - **Substitution** — said a different word
  - **Omission** — skipped a word
  - **Insertion** — added a word not in the passage (includes fillers like "um", "uh", repetitions)
  - **Self-correction** — said wrong word then corrected (detectable via sequence patterns)
- [ ] **Display diff visually** — color-coded side-by-side or inline view showing correct/substituted/omitted/inserted words

### Phase 3: ORF Scoring Metrics
- [ ] **Words Correct Per Minute (WCPM)** — standard ORF metric: (total correct words) / (elapsed time in minutes)
- [ ] **Accuracy rate** — correct words / total words attempted
- [ ] **Error counts by type** — substitutions, omissions, insertions
- [ ] **Reading rate** — total words attempted per minute (fluency regardless of accuracy)
- [ ] **Use word timestamps** to compute per-word pacing, detect long pauses (hesitations)

### Phase 4: Reporting & UX
- [ ] **Summary dashboard** — WCPM, accuracy %, error breakdown, pacing chart
- [ ] **Pause/hesitation detection** — flag gaps between words exceeding a threshold (e.g., >1s)
- [ ] **Export results** — JSON and/or CSV download for record-keeping
- [ ] **Print-friendly view** — for teacher records
- [ ] **Save API key in localStorage** — so user doesn't re-enter each session

### Phase 5: Optional Enhancements
- [ ] **Alternative STT backends** — AssemblyAI (with `disfluencies=true`), Whisper, for comparison
- [ ] **Benchmark mode** — grade-level norms (e.g., 6th grade median WCPM ~150) with percentile display
- [ ] **Multiple student sessions** — save/load past assessments
- [ ] **Audio playback with word highlighting** — sync playback to word timestamps

---

## File Structure
```
Googstt/
├── PLAN.md                 ← this file (project status & roadmap)
├── SETTINGS.md             ← all STT settings with explanations
└── orf_assessment.html     ← the app (single file, double-click to run)
```

## Prerequisites
- Google Cloud project with **Speech-to-Text API** enabled
- API key from GCP Console → APIs & Services → Credentials
