# Requirements: ReadingQuest v1.3 Kitchen Sink Ensemble

**Defined:** 2026-02-05
**Core Value:** Accurate, word-level fluency error detection powered by ensemble ASR with hallucination filtering

## v1.3 Requirements

Requirements for Kitchen Sink Ensemble milestone. Each maps to roadmap phases.

### Backend Service

- [ ] **BACK-01**: Reverb ASR service runs in Docker container with GPU access
- [ ] **BACK-02**: Service exposes `/ensemble` endpoint returning both v=1.0 (verbatim) and v=0.0 (clean) transcriptions
- [ ] **BACK-03**: Service exposes `/health` endpoint for availability checking
- [ ] **BACK-04**: GPU availability verified at startup with clear error message if unavailable
- [ ] **BACK-05**: CTM output parsed with word-level timestamps and default confidence values

### Disfluency Detection

- [ ] **DISF-01**: Needleman-Wunsch global sequence alignment compares v=1.0 vs v=0.0 transcripts
- [ ] **DISF-02**: Alignment insertions (words in v=1.0 not in v=0.0) identified as disfluencies
- [ ] **DISF-03**: Filler words detected (um, uh, er, ah, mm, hmm)
- [ ] **DISF-04**: Repetitions detected (consecutive identical words or phrases)
- [ ] **DISF-05**: False starts detected (partial words followed by complete word)
- [ ] **DISF-06**: Disfluency rate calculated (disfluencies / total words)
- [ ] **DISF-07**: Disfluencies do NOT affect WCPM calculation (clinical requirement)

### Cross-Vendor Validation

- [ ] **XVAL-01**: Deepgram Nova-3 called in parallel for cross-validation
- [ ] **XVAL-02**: Reverb ↔ Nova-3 disagreement flags words as uncertain
- [ ] **XVAL-03**: Graceful fallback to Deepgram-only when Reverb service unavailable

### Browser Integration

- [ ] **INTG-01**: `reverb-api.js` client calls local Reverb service
- [ ] **INTG-02**: `deepgram-api.js` client calls Deepgram Nova-3 API
- [ ] **INTG-03**: `sequence-aligner.js` implements Needleman-Wunsch algorithm
- [ ] **INTG-04**: `disfluency-tagger.js` classifies disfluency types from alignment
- [ ] **INTG-05**: `kitchen-sink-merger.js` combines Reverb + Deepgram results
- [ ] **INTG-06**: Existing Google STT ensemble replaced with Kitchen Sink ensemble

### UI Display

- [ ] **UI-01**: Disfluencies visually distinct from reading errors (different color/style)
- [ ] **UI-02**: Per-word disfluency type indicator (filler, repetition, false start)
- [ ] **UI-03**: Disfluency tooltip shows classification details on hover
- [ ] **UI-04**: Disfluency count and rate displayed in diagnostics panel
- [ ] **UI-05**: `miscue-registry.js` updated with disfluency types (per CLAUDE.md)

## Future Requirements

Deferred to later milestones.

### Performance & Scale

- **PERF-01**: Audio chunking for recordings >5 minutes (8GB VRAM limit)
- **PERF-02**: Model warm-up on service startup for faster first request

### Advanced Features

- **ADV-01**: Disfluency trend tracking across assessments
- **ADV-02**: Reading difficulty vs speech disorder indicators

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real-time disfluency feedback to student | Increases anxiety for struggling readers |
| Automatic stuttering diagnosis | Requires SLP, not appropriate for teacher tool |
| Counting disfluencies as reading errors | ASHA/DIBELS guidelines: repetitions are not errors |
| Google STT as cross-validator | Same Conformer architecture as Reverb = correlated errors |
| Nova-2 option | Nova-3 recommended for children's speech accuracy |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BACK-01 | TBD | Pending |
| BACK-02 | TBD | Pending |
| BACK-03 | TBD | Pending |
| BACK-04 | TBD | Pending |
| BACK-05 | TBD | Pending |
| DISF-01 | TBD | Pending |
| DISF-02 | TBD | Pending |
| DISF-03 | TBD | Pending |
| DISF-04 | TBD | Pending |
| DISF-05 | TBD | Pending |
| DISF-06 | TBD | Pending |
| DISF-07 | TBD | Pending |
| XVAL-01 | TBD | Pending |
| XVAL-02 | TBD | Pending |
| XVAL-03 | TBD | Pending |
| INTG-01 | TBD | Pending |
| INTG-02 | TBD | Pending |
| INTG-03 | TBD | Pending |
| INTG-04 | TBD | Pending |
| INTG-05 | TBD | Pending |
| INTG-06 | TBD | Pending |
| UI-01 | TBD | Pending |
| UI-02 | TBD | Pending |
| UI-03 | TBD | Pending |
| UI-04 | TBD | Pending |
| UI-05 | TBD | Pending |

**Coverage:**
- v1.3 requirements: 26 total
- Mapped to phases: 0
- Unmapped: 26 (pending roadmap creation)

---
*Requirements defined: 2026-02-05*
*Last updated: 2026-02-05 after initial definition*
