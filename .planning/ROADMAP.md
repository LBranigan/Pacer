# Roadmap: ReadingQuest

## Milestones

- [x] **v1.0 MVP** — Phases 1-9 (shipped 2026-02-03)
- [x] **v1.1 ASR Ensemble** — Phases 10-17 (shipped 2026-02-04)
- [x] **v1.2 VAD Gap Analysis** — Phases 18-19 (shipped 2026-02-04)
- [ ] **v1.3 Kitchen Sink Ensemble** — Phases 20-24 (active)

## Phases

<details>
<summary>v1.0 MVP (Phases 1-9) — SHIPPED 2026-02-03</summary>

v1.0 shipped with 24 ES modules, teacher dashboard with Standard Celeration Chart, gamified student playback, and full Google Cloud integration (STT, Vision OCR, Natural Language API). See git history for detailed phase breakdown.

</details>

<details>
<summary>v1.1 ASR Ensemble (Phases 10-17) — SHIPPED 2026-02-04</summary>

v1.1 shipped with two-model ensemble STT, VAD-based ghost detection, asymmetric confidence classification, separate disfluency detection, safety checks, and enhanced teacher UI. 22 plans across 8 phases. See `.planning/milestones/v1.1-ROADMAP.md` for full details.

**Phases:**
- Phase 10: Configuration (1 plan)
- Phase 11: Ensemble Core (3 plans)
- Phase 12: VAD Integration (4 plans)
- Phase 13: Confidence Classification (3 plans)
- Phase 14: Disfluency Detection (3 plans)
- Phase 15: Safety Checks (3 plans)
- Phase 16: UI Enhancements (4 plans)
- Phase 17: Integration Bug Fixes (1 plan)

</details>

<details>
<summary>v1.2 VAD Gap Analysis (Phases 18-19) — SHIPPED 2026-02-04</summary>

v1.2 shipped with VAD-based acoustic analysis for pause/gap indicators. Teachers can now see VAD speech percentage and acoustic labels when hovering over pause/hesitation indicators, with orange visual distinction for gaps containing significant speech activity. 3 plans across 2 phases. See `.planning/milestones/v1.2-ROADMAP.md` for full details.

**Phases:**
- Phase 18: VAD Gap Analyzer Core (2 plans)
- Phase 19: VAD Gap UI Display (1 plan)

</details>

<details open>
<summary>v1.3 Kitchen Sink Ensemble (Phases 20-24) — ACTIVE</summary>

Replace Google STT ensemble with Reverb ASR for model-level disfluency detection via verbatimicity diff, with Deepgram Nova-3 cross-validation for hallucination detection.

### Phase 20: Reverb Backend Service

**Goal:** Teacher can run a local Reverb ASR service that transcribes audio with both verbatim and clean passes.

**Dependencies:** None (foundation phase)

**Plans:** 2 plans
- [ ] 20-01-PLAN.md — Docker infrastructure (Dockerfile, docker-compose.yml, requirements.txt)
- [ ] 20-02-PLAN.md — FastAPI server with health and ensemble endpoints

**Requirements:**
- BACK-01: Reverb ASR service runs in Docker container with GPU access
- BACK-02: Service exposes `/ensemble` endpoint returning both v=1.0 (verbatim) and v=0.0 (clean) transcriptions
- BACK-03: Service exposes `/health` endpoint for availability checking
- BACK-04: GPU availability verified at startup with clear error message if unavailable
- BACK-05: CTM output parsed with word-level timestamps and default confidence values

**Success Criteria:**
1. Docker container starts with GPU access verified at startup (nvidia-smi shows GPU activity during inference)
2. `/health` endpoint responds with status and GPU info accessible from browser fetch
3. `/ensemble` endpoint returns both verbatim and clean transcripts with word timestamps for uploaded audio
4. 5-minute audio file processes without VRAM exhaustion (chunking works)
5. CORS configured correctly (browser can call endpoints, not just curl)

---

### Phase 21: Sequence Alignment & Disfluency Detection ✓

**Goal:** Disfluencies (fillers, repetitions, false starts) are reliably identified from the difference between verbatim and clean Reverb transcripts.

**Dependencies:** None (pure algorithm, can develop with mock data in parallel with Phase 20)

**Status:** COMPLETE (2026-02-05)

**Plans:** 1 plan
- [x] 21-01-PLAN.md — Needleman-Wunsch alignment and disfluency classification

**Requirements:**
- DISF-01: Needleman-Wunsch global sequence alignment compares v=1.0 vs v=0.0 transcripts
- DISF-02: Alignment insertions (words in v=1.0 not in v=0.0) identified as disfluencies
- DISF-03: Filler words detected (um, uh, er, ah, mm, hmm)
- DISF-04: Repetitions detected (consecutive identical words or phrases)
- DISF-05: False starts detected (partial words followed by complete word)
- DISF-06: Disfluency rate calculated (disfluencies / total words)
- DISF-07: Disfluencies do NOT affect WCPM calculation (clinical requirement)
- INTG-03: `sequence-aligner.js` implements Needleman-Wunsch algorithm
- INTG-04: `disfluency-tagger.js` classifies disfluency types from alignment

**Success Criteria:**
1. "the the cat" vs "the cat" alignment produces exactly one insertion at index 0
2. Filler words (um, uh, er, ah, mm, hmm) are classified as type "filler"
3. Consecutive repeated words are classified as type "repetition"
4. Partial words followed by complete word are classified as type "false_start"
5. Disfluency rate calculation excludes disfluencies from denominator (WCPM integrity preserved)

---

### Phase 22: Cross-Vendor Validation ✓

**Goal:** Deepgram Nova-3 provides architecturally-decorrelated cross-validation to catch Reverb hallucinations.

**Dependencies:** None (API integration, can develop in parallel with Phases 20-21)

**Status:** COMPLETE (2026-02-05)

**Plans:** 2 plans
- [x] 22-01-PLAN.md — Add /deepgram endpoint to Reverb backend (proxy for CORS)
- [x] 22-02-PLAN.md — Browser client (deepgram-api.js) with cross-validation logic

**Requirements:**
- XVAL-01: Deepgram Nova-3 called in parallel for cross-validation
- XVAL-02: Reverb <-> Nova-3 disagreement flags words as uncertain
- XVAL-03: Graceful fallback to Deepgram-only when Reverb service unavailable
- INTG-02: `deepgram-api.js` client calls Deepgram Nova-3 API

**Success Criteria:**
1. Deepgram Nova-3 API returns word-level timestamps and confidence in normalized format
2. Words present in Reverb but absent in Nova-3 are flagged with crossValidation: "unconfirmed"
3. Words present in both with matching text are flagged with crossValidation: "confirmed"
4. When Reverb service unavailable, pipeline falls back to Deepgram-only mode with warning
5. API key stored securely (not in source, follows existing key management pattern)

---

### Phase 23: Kitchen Sink Integration ✓

**Goal:** Reverb + Deepgram results are merged into unified pipeline, replacing Google STT ensemble for primary transcription.

**Dependencies:** Phase 20 (Reverb backend), Phase 21 (alignment/tagging), Phase 22 (Deepgram API)

**Status:** COMPLETE (2026-02-05)

**Plans:** 2 plans
- [x] 23-01-PLAN.md — Reverb API client and Kitchen Sink orchestrator
- [x] 23-02-PLAN.md — app.js integration and human verification

**Requirements:**
- INTG-01: `reverb-api.js` client calls local Reverb service
- INTG-05: `kitchen-sink-merger.js` combines Reverb + Deepgram results
- INTG-06: Existing Google STT ensemble replaced with Kitchen Sink ensemble (fully removed, not just alternative)

**Success Criteria:**
1. Browser successfully calls local Reverb service and receives normalized word array
2. Merged output includes isDisfluency, disfluencyType, and crossValidation properties per word
3. Pipeline uses Kitchen Sink ensemble when Reverb online, falls back to Deepgram-only when offline (no Google dependency)
4. Existing downstream components (alignment, diagnostics, metrics) work unchanged with new word format
5. Feature flag allows toggling Kitchen Sink (when disabled, uses Deepgram-only)

---

### Phase 24: Disfluency UI Display

**Goal:** Teachers see disfluencies visually distinct from reading errors, with classification details on hover.

**Dependencies:** Phase 23 (Kitchen Sink integration provides disfluency data)

**Plans:** 2 plans
- [ ] 24-01-PLAN.md — Miscue registry entries, CSS styles, HTML structure
- [ ] 24-02-PLAN.md — Word rendering logic, diagnostics section, data threading

**Requirements:**
- UI-01: Disfluencies visually distinct from reading errors (different color/style)
- UI-02: Per-word disfluency type indicator (filler, repetition, false start)
- UI-03: Disfluency tooltip shows classification details on hover
- UI-04: Disfluency count and rate displayed in diagnostics panel
- UI-05: `miscue-registry.js` updated with disfluency types (per CLAUDE.md)

**Success Criteria:**
1. Disfluency words have distinct CSS styling (not red like errors, not green like correct)
2. Hovering on disfluency word shows tooltip with type classification ("filler: um", "repetition: the the")
3. Diagnostics panel shows "Disfluencies: 3 (2.1%)" with breakdown by type
4. miscue-registry.js includes reverb_filler, reverb_repetition, reverb_false_start entries with countsAsError: false
5. WCPM display unchanged (disfluencies do not count as errors per DISF-07)

</details>

## Progress

| Milestone | Phases | Plans | Status | Shipped |
|-----------|--------|-------|--------|---------|
| v1.0 MVP | 1-9 | 21 | Complete | 2026-02-03 |
| v1.1 ASR Ensemble | 10-17 | 22 | Complete | 2026-02-04 |
| v1.2 VAD Gap Analysis | 18-19 | 3 | Complete | 2026-02-04 |
| v1.3 Kitchen Sink Ensemble | 20-24 | 9 | **Active** | — |

**Total shipped:** 19 phases, 46 plans
**Active:** 5 phases (v1.3), Phases 20-24 planned (9 plans)

## Dependency Graph

```
Phase 20 (Backend) ──────────────┐
                                 │
Phase 21 (Alignment) ────────────┼───> Phase 23 (Integration) ───> Phase 24 (UI)
                                 │
Phase 22 (Cross-Validation) ─────┘
```

Phases 20, 21, 22 can execute in parallel. Phase 23 depends on all three. Phase 24 depends on 23.

---
*Roadmap created: 2026-02-02*
*v1.0 shipped: 2026-02-03*
*v1.1 shipped: 2026-02-04*
*v1.2 shipped: 2026-02-04*
*v1.3 roadmap created: 2026-02-05*
*Phase 20 planned: 2026-02-05*
*Phase 21 planned: 2026-02-05*
*Phase 22 planned: 2026-02-05*
*Phase 22 complete: 2026-02-05*
*Phase 23 planned: 2026-02-05*
*Phase 23 complete: 2026-02-05*
*Phase 24 planned: 2026-02-05*
