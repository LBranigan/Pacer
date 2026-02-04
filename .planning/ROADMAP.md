# Roadmap: ReadingQuest

## Milestones

- [x] **v1.0 MVP** - Phases 1-9 (shipped 2026-02-03)
- [ ] **v1.1 ASR Ensemble** - Phases 10-16 (in progress)

## Phases

<details>
<summary>v1.0 MVP (Phases 1-9) - SHIPPED 2026-02-03</summary>

v1.0 shipped with 24 ES modules, teacher dashboard with Standard Celeration Chart, gamified student playback, and full Google Cloud integration (STT, Vision OCR, Natural Language API). See git history for detailed phase breakdown.

</details>

### v1.1 ASR Ensemble (In Progress)

**Milestone Goal:** Improve ASR accuracy and reliability using a two-model ensemble (`latest_long` + `default`) with VAD-based hallucination detection, separate disfluency classification, and safety checks.

## Phase Details

### Phase 10: Configuration
**Goal**: Tune speech boosting parameters for ensemble-ready ASR
**Depends on**: Phase 9 (v1.0 complete)
**Requirements**: CFG-01, CFG-02, CFG-03
**Success Criteria** (what must be TRUE):
  1. `latest_long` boost level is reduced from 5 to 3
  2. Proper nouns receive highest boost (5), uncommon words receive medium boost (3), common words receive no boost (0)
  3. `default` model configuration exists with lower boost values (proper nouns: 3, uncommon: 2)
**Plans**: 1 plan

Plans:
- [x] 10-01-PLAN.md — Tiered speech context boosting

### Phase 11: Ensemble Core
**Goal**: Run two STT models in parallel with temporal word association
**Depends on**: Phase 10
**Requirements**: ENS-01, ENS-02, ENS-03, ENS-04
**Success Criteria** (what must be TRUE):
  1. Both `latest_long` and `default` models are called in parallel for every assessment
  2. Words from both models are associated by time overlap (50ms jitter tolerance), not text matching
  3. Merged transcript includes `_debug` property showing both model results for each word
  4. Words are tagged with source: `both`, `latest_only`, or `default_only`
**Plans**: 3 plans (2 waves)

Plans:
- [x] 11-01-PLAN.md — Parallel model API calls (Wave 1)
- [x] 11-02-PLAN.md — Temporal word association algorithm (Wave 1)
- [x] 11-03-PLAN.md — Transcript merger with app.js integration (Wave 2)

### Phase 12: VAD Integration
**Goal**: Detect hallucinations by checking for actual speech during `latest_only` words
**Depends on**: Phase 11
**Requirements**: VAD-01, VAD-02, VAD-03, VAD-04, VAD-05, VAD-06, VAD-07
**Architecture Decision**: VAD runs as "Post-Process Safety Valve" — NOT during live recording:
  - Record: Just record audio (low CPU, Chromebook-safe)
  - Stop: User clicks "Stop"
  - Process: Run VAD on completed recording while "Processing..." spinner shows (~0.5s)
  - Send: Upload to Google STT
  This approach adds ~0.5s latency but is 100% safe — no CPU spike during recording.
**Success Criteria** (what must be TRUE):
  1. Silero VAD runs in browser via ONNX runtime (no backend required)
  2. VAD processes the COMPLETED audio file, not live during recording
  3. Words that are `latest_only + IN REFERENCE` but have no speech overlap are flagged as `vad_ghost_in_reference`
  4. Dedicated "Calibrate Microphone" button measures 2s of ambient noise
  5. Calibration determines optimal VAD threshold (0.15-0.60) and displays noise level (Low/Moderate/High)
  6. UI shows calibrated threshold value with slider and presets
**Plans**: 4 plans (3 waves)

Plans:
- [x] 12-01-PLAN.md — ONNX runtime + Silero VAD setup (Wave 1)
- [x] 12-02-PLAN.md — Ghost detection logic (Wave 2)
- [x] 12-03-PLAN.md — App integration with VAD flow (Wave 3)
- [x] 12-04-PLAN.md — Calibration system + Settings UI (Wave 2)

### Phase 13: Confidence Classification
**Goal**: Apply asymmetric trust policy based on reference presence and model agreement
**Depends on**: Phase 12
**Requirements**: CONF-01, CONF-02, CONF-03, CONF-04
**Success Criteria** (what must be TRUE):
  1. `latest_only` words that appear in reference are trusted (stronger model caught quiet speech)
  2. `latest_only` words NOT in reference are distrusted (hallucination risk)
  3. Confidence thresholds use research-backed values: 0.93 (high confidence), 0.70 (low confidence)
  4. Word confidence classification considers both model agreement and reference presence
**Plans**: 3 plans (3 waves)

Plans:
- [x] 13-01-PLAN.md — Word equivalences extension + confidence config (Wave 1)
- [x] 13-02-PLAN.md — Confidence classifier core (Wave 2)
- [x] 13-03-PLAN.md — App integration with classification flow (Wave 3)

### Phase 14: Disfluency Detection
**Goal**: Detect stutters and reading disfluencies as a separate signal from confidence
**Depends on**: Phase 13
**Requirements**: DIS-01, DIS-02, DIS-03, DIS-04, DIS-05
**Success Criteria** (what must be TRUE):
  1. Stutter metrics are computed separately: attempt count, total duration, max pause
  2. Disfluency severity is classified: none | minor | moderate | significant
  3. Significant disfluency is flagged when maxPause >= 0.5s OR totalDuration >= 2.0s
  4. Orphaned stutter fragments (<=3 chars, <=2s gap, startsWith match) are merged into their target word
  5. Confidence and disfluency remain independent signals (not combined into single score)
**Plans**: 3 plans (3 waves)

Plans:
- [x] 14-01-PLAN.md — Stutter metrics calculation (Wave 1)
- [x] 14-02-PLAN.md — Disfluency severity classification (Wave 2)
- [x] 14-03-PLAN.md — Fragment merger and app integration (Wave 3)

### Phase 15: Safety Checks
**Goal**: Flag physically impossible or suspicious ASR outputs
**Depends on**: Phase 14
**Requirements**: SAFE-01, SAFE-02, SAFE-03, SAFE-04
**Success Criteria** (what must be TRUE):
  1. Words spoken at >5 words/second are flagged as rate anomalies (physically impossible)
  2. Long sequences (>5 consecutive `latest_only` words) are flagged as suspicious uncorroborated output
  3. Flagged words include `_flags` array supporting multiple anomaly types
  4. Strong corroboration (`_source === 'both'` with conf >= 0.9) overrides rate flags
**Plans**: TBD

Plans:
- [ ] 15-01: Rate anomaly detection
- [ ] 15-02: Uncorroborated sequence detection
- [ ] 15-03: Flag resolution with corroboration override

### Phase 16: UI Enhancements
**Goal**: Surface ensemble data, disfluency badges, and calibration controls in the UI
**Depends on**: Phase 15
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, CFG-04
**Success Criteria** (what must be TRUE):
  1. Word hover tooltip shows both model results with timestamps
  2. Disfluency badges (~, ~~, warning icon) display alongside word colors
  3. WCPM displays as a range (e.g., 85-92) instead of single value to reflect uncertainty
  4. Fluency concerns summary shows counts: significant/moderate/minor disfluencies
  5. Rate anomaly indicators visually highlight flagged words
  6. VAD calibration UI includes button and status display
  7. Dev mode includes manual VAD threshold slider for testing
**Plans**: TBD

Plans:
- [ ] 16-01: Word tooltip enhancements
- [ ] 16-02: Disfluency badges and WCPM range
- [ ] 16-03: Fluency concerns summary
- [ ] 16-04: VAD calibration UI and dev slider

## Progress

**Execution Order:** Phases execute in numeric order: 10 -> 11 -> 12 -> 13 -> 14 -> 15 -> 16

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 10. Configuration | 1/1 | Complete | 2026-02-03 |
| 11. Ensemble Core | 3/3 | Complete | 2026-02-03 |
| 12. VAD Integration | 4/4 | Complete | 2026-02-03 |
| 13. Confidence Classification | 3/3 | Complete | 2026-02-03 |
| 14. Disfluency Detection | 3/3 | Complete | 2026-02-03 |
| 15. Safety Checks | 0/3 | Not started | - |
| 16. UI Enhancements | 0/4 | Not started | - |

---
*Roadmap created: 2026-02-03*
*Milestone: v1.1 ASR Ensemble*
