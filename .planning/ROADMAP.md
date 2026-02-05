# Roadmap: ReadingQuest

## Milestones

- [x] **v1.0 MVP** — Phases 1-9 (shipped 2026-02-03)
- [x] **v1.1 ASR Ensemble** — Phases 10-17 (shipped 2026-02-04)
- [ ] **v1.2 VAD Gap Analysis** — Phases 18-19 (in progress)

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

<details open>
<summary>v1.2 VAD Gap Analysis (Phases 18-19) — IN PROGRESS</summary>

VAD-based acoustic analysis for pause/gap indicators, giving teachers visibility into what actually happened during reported "silences."

### Phase 18: VAD Gap Analyzer Core

**Goal:** System can analyze VAD speech activity within any time range and enrich diagnostics with acoustic context.

**Dependencies:** v1.1 VAD infrastructure (vad.js, vadCalibration.js)

**Requirements:**
- VAD-01: System calculates VAD speech overlap percentage for any time range
- VAD-02: System classifies speech percentage into acoustic labels
- VAD-03: System enriches diagnostics.longPauses with _vadAnalysis property
- VAD-04: System enriches diagnostics.onsetDelays with _vadAnalysis property
- DBG-01: Debug log includes VAD gap analysis stage with counts by acoustic label

**Success Criteria:**
1. Given a time range, system returns speech percentage (0-100%) calculated from VAD segments
2. Speech percentages map to acoustic labels: silence confirmed (<10%), mostly silent (10-29%), mixed signal (30-49%), speech detected (50-79%), continuous speech (>=80%)
3. After diagnostics processing, each longPause object has `_vadAnalysis` with `speechPercent` and `label`
4. After diagnostics processing, each onsetDelay object has `_vadAnalysis` with `speechPercent` and `label`
5. Debug panel shows VAD Gap Analysis summary with counts per acoustic label category

**Plans:** 2 plans

Plans:
- [ ] 18-01-PLAN.md — Create VAD gap analyzer module with core functions
- [ ] 18-02-PLAN.md — Integrate into app.js pipeline with debug logging

---

### Phase 19: VAD Gap UI Display

**Goal:** Teachers can see VAD acoustic context when reviewing pause and hesitation indicators.

**Dependencies:** Phase 18 (VAD gap analyzer must enrich diagnostics first)

**Requirements:**
- UI-01: Teacher can hover over pause indicator to see VAD speech percentage and acoustic label
- UI-02: Teacher can hover over hesitation indicator to see VAD speech percentage and acoustic label
- UI-03: Pause indicators with significant VAD activity (>=30%) show visual distinction

**Success Criteria:**
1. Hovering over a pause indicator shows tooltip with "VAD: X% (label)" information
2. Hovering over a hesitation indicator shows tooltip with "VAD: X% (label)" information
3. Pause indicators with >=30% VAD activity have distinct visual style (e.g., orange vs red)
4. Visual distinction helps teachers identify pauses that may be sounding-out vs true silence

**Estimated plans:** 2 (tooltip integration, visual distinction)

</details>

## Progress

| Milestone | Phases | Plans | Status | Shipped |
|-----------|--------|-------|--------|---------|
| v1.0 MVP | 1-9 | 21 | Complete | 2026-02-03 |
| v1.1 ASR Ensemble | 10-17 | 22 | Complete | 2026-02-04 |
| v1.2 VAD Gap Analysis | 18-19 | ~5 | In Progress | — |

**Total:** 17 phases shipped, 43 plans shipped
**Active:** 2 phases, ~5 plans

---
*Roadmap created: 2026-02-02*
*v1.0 shipped: 2026-02-03*
*v1.1 shipped: 2026-02-04*
*v1.2 started: 2026-02-04*
