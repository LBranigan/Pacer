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

### Phase 6: Google Cloud Natural Language API Integration (2026-02-03)
- [x] **Created `js/nl-api.js`** — Calls Google Cloud NL API (`analyzeSyntax` + `analyzeEntities`) to label each reference word with POS tag, entity type, and word tier (sight/academic/proper/function). Results cached in sessionStorage.
- [x] **Proper noun ASR healing** — Substitutions on proper nouns with >50% Levenshtein similarity are reclassified as correct (healed), reducing false errors on names like "Hermione"
- [x] **Proper noun forgiveness in metrics** — `computeAccuracy()` gains optional forgiveness mode; forgiven proper nouns counted as correct with `forgiven` counter
- [x] **Tier breakdown diagnostics** — New `computeTierBreakdown()` in diagnostics.js computes per-tier (sight/academic/proper/function) correct/error rates
- [x] **UI enhancements** — Word tier CSS classes (purple dotted underline for proper nouns), healed word indicator (green dashed underline), NL info in tooltips (POS/entity/tier), tier breakdown row in metrics bar
- [x] **Storage v5 migration** — Added `nlAnnotations` field to assessment persistence
- [x] **Service worker** — Added `nl-api.js` to cache, bumped to `orf-v21`

## File Structure
```
Googstt/
├── PLAN.md                 ← this file (project status & roadmap)
├── SETTINGS.md             ← all STT settings with explanations
├── index.html              ← main app entry point
├── js/
│   ├── app.js              ← main pipeline orchestrator
│   ├── nl-api.js           ← Google Cloud NL API integration (NEW)
│   ├── alignment.js        ← transcript-to-reference alignment
│   ├── metrics.js          ← WCPM, accuracy computation
│   ├── diagnostics.js      ← fluency diagnostics + tier breakdown
│   ├── ui.js               ← result display and rendering
│   ├── storage.js          ← localStorage persistence (v5)
│   ├── stt-api.js          ← Google Cloud STT API calls
│   ├── ocr-api.js          ← Google Vision OCR
│   ├── recorder.js         ← audio recording
│   ├── file-handler.js     ← audio file upload
│   ├── word-equivalences.js← word normalization
│   ├── passage-trimmer.js  ← OCR passage trimming
│   ├── audio-store.js      ← IndexedDB audio blob storage
│   ├── dashboard.js        ← teacher dashboard
│   ├── celeration-chart.js ← Standard Celeration Chart
│   ├── benchmarks.js       ← Hasbrouck-Tindal norms
│   ├── audio-playback.js   ← teacher audio playback
│   ├── student-playback.js ← student animated playback
│   ├── gamification.js     ← gamification scoring
│   └── effect-engine.js    ← animation effects
├── style.css               ← all styles
├── sw.js                   ← service worker (v21)
└── manifest.json           ← PWA manifest
```

## Prerequisites
- Google Cloud project with **Speech-to-Text API** enabled
- API key from GCP Console → APIs & Services → Credentials
