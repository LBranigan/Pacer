# Requirements: ReadingQuest v1.1

**Defined:** 2026-02-03
**Core Value:** Accurate, word-level fluency error detection with reliable confidence scores

## v1.1 Requirements

Requirements for the ASR Ensemble milestone. Each maps to roadmap phases.

### Ensemble Core

- [x] **ENS-01**: System calls both `latest_long` and `default` STT models in parallel
- [x] **ENS-02**: Temporal word association maps words by time overlap (not text equality)
- [x] **ENS-03**: 50ms asymmetric jitter buffer handles CTC vs Conformer timestamp drift
- [x] **ENS-04**: Merged transcript preserves `_debug` data showing both model results

### Confidence Classification

- [ ] **CONF-01**: Asymmetric trust policy classifies `latest_only` words based on reference presence
- [ ] **CONF-02**: Words in reference + `latest_only` are trusted (stronger model caught quiet speech)
- [ ] **CONF-03**: Words NOT in reference + `latest_only` are distrusted (hallucination risk)
- [ ] **CONF-04**: Confidence thresholds use research-backed values (0.93 high, 0.70 low)

### VAD Integration

- [ ] **VAD-01**: Silero VAD runs in browser via ONNX runtime
- [ ] **VAD-02**: VAD processes COMPLETED audio file (post-record, during upload spinner) — NOT live during recording (Chromebook-safe)
- [ ] **VAD-03**: VAD "Ghost Buster" checks `latest_only + IN REFERENCE` words for 50ms speech overlap
- [ ] **VAD-04**: Words with no speech overlap are flagged as `vad_ghost_in_reference`
- [ ] **VAD-05**: Dedicated "Calibrate Microphone" button measures 1.5s ambient noise
- [ ] **VAD-06**: Calibration finds optimal threshold (0.15-0.60 range) for environment
- [ ] **VAD-07**: UI shows calibrated threshold and noise level (Low/Moderate/High)

### Disfluency Detection

- [ ] **DIS-01**: Stutter metrics computed separately from confidence (attempts, duration, max pause)
- [ ] **DIS-02**: Disfluency severity classified: none | minor | moderate | significant
- [ ] **DIS-03**: Significant disfluency = maxPause >= 0.5s OR totalDuration >= 2.0s
- [ ] **DIS-04**: Orphaned stutter fragments (≤3 chars, ≤2s gap, startsWith match) merged into target
- [ ] **DIS-05**: Confidence and disfluency remain separate signals (not combined)

### Safety Checks

- [ ] **SAFE-01**: Rate anomaly detection flags >5 words/second as physically impossible
- [ ] **SAFE-02**: Long uncorroborated sequences (>5 consecutive `latest_only`) flagged as suspicious
- [ ] **SAFE-03**: Flagged words have `_flags` array for multiple anomaly types
- [ ] **SAFE-04**: Strong corroboration (`_source === 'both'` + conf >= 0.9) overrides rate flags

### UI Enhancements

- [ ] **UI-01**: Word hover tooltip shows both model results and timestamps
- [ ] **UI-02**: Disfluency badges (~, ~~, ⚠️) display alongside word colors
- [ ] **UI-03**: WCPM shows range instead of single value (accounts for uncertainty)
- [ ] **UI-04**: Fluency concerns summary shows significant/moderate/minor counts
- [ ] **UI-05**: Rate anomaly indicators highlight flagged words
- [ ] **UI-06**: VAD calibration UI with button and status display

### Configuration

- [ ] **CFG-01**: `latest_long` boost reduced from 5 to 3
- [ ] **CFG-02**: Tiered boosting: proper nouns (5), uncommon words (3), common words (0)
- [ ] **CFG-03**: `default` model uses lower boost (proper nouns: 3, uncommon: 2)
- [ ] **CFG-04**: Dev mode includes manual VAD threshold slider

## v1.2+ Requirements

Deferred to future releases. Tracked but not in current roadmap.

### Prosody & Audio

- **PROS-01**: Full prosody scoring from audio waveform analysis (NAEP-aligned)
- **PROS-02**: Pitch contour extraction for expression assessment

### Backend & Auth

- **BACK-01**: Backend server with secure API key management
- **BACK-02**: User authentication (teacher accounts)
- **BACK-03**: Cloud-based assessment storage (multi-device sync)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| wav2vec2 fine-tuning | Requires 5-10 hours transcribed child speech + GPU infrastructure — deferred |
| Text-based transcript alignment | Fails on stutters ("please" vs "p-p-please") — use temporal association |
| Combining confidence + disfluency into single score | Loses clinical nuance — keep separate |
| Whisper as ensemble partner | Also hallucinates (40% rate) — use `default` model instead |
| VAD as universal filter | Only scoped for `latest_only + IN REFERENCE` blind spot |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CFG-01 | Phase 10 | Complete |
| CFG-02 | Phase 10 | Complete |
| CFG-03 | Phase 10 | Complete |
| ENS-01 | Phase 11 | Complete |
| ENS-02 | Phase 11 | Complete |
| ENS-03 | Phase 11 | Complete |
| ENS-04 | Phase 11 | Complete |
| VAD-01 | Phase 12 | Pending |
| VAD-02 | Phase 12 | Pending |
| VAD-03 | Phase 12 | Pending |
| VAD-04 | Phase 12 | Pending |
| VAD-05 | Phase 12 | Pending |
| VAD-06 | Phase 12 | Pending |
| VAD-07 | Phase 12 | Pending |
| CONF-01 | Phase 13 | Pending |
| CONF-02 | Phase 13 | Pending |
| CONF-03 | Phase 13 | Pending |
| CONF-04 | Phase 13 | Pending |
| DIS-01 | Phase 14 | Pending |
| DIS-02 | Phase 14 | Pending |
| DIS-03 | Phase 14 | Pending |
| DIS-04 | Phase 14 | Pending |
| DIS-05 | Phase 14 | Pending |
| SAFE-01 | Phase 15 | Pending |
| SAFE-02 | Phase 15 | Pending |
| SAFE-03 | Phase 15 | Pending |
| SAFE-04 | Phase 15 | Pending |
| UI-01 | Phase 16 | Pending |
| UI-02 | Phase 16 | Pending |
| UI-03 | Phase 16 | Pending |
| UI-04 | Phase 16 | Pending |
| UI-05 | Phase 16 | Pending |
| UI-06 | Phase 16 | Pending |
| CFG-04 | Phase 16 | Pending |

**Coverage:**
- v1.1 requirements: 32 total
- Mapped to phases: 32
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-03*
*Last updated: 2026-02-03 after initial definition*
