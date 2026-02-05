# Requirements: ReadingQuest v1.2

**Defined:** 2026-02-04
**Core Value:** Acoustic context on pause/gap indicators — helping teachers distinguish true hesitation from sounding out or timestamp drift.

## v1.2 Requirements

Requirements for VAD Gap Analysis feature. Each maps to roadmap phases.

### VAD Analysis Module

- [x] **VAD-01**: System calculates VAD speech overlap percentage for any time range
- [x] **VAD-02**: System classifies speech percentage into acoustic labels (silence confirmed, mostly silent, mixed signal, speech detected, continuous speech)
- [x] **VAD-03**: System enriches diagnostics.longPauses with _vadAnalysis property
- [x] **VAD-04**: System enriches diagnostics.onsetDelays with _vadAnalysis property

### UI Display

- [ ] **UI-01**: Teacher can hover over pause indicator to see VAD speech percentage and acoustic label
- [ ] **UI-02**: Teacher can hover over hesitation indicator to see VAD speech percentage and acoustic label
- [ ] **UI-03**: Pause indicators with significant VAD activity (>=30%) show visual distinction

### Debug & Observability

- [x] **DBG-01**: Debug log includes VAD gap analysis stage with counts by acoustic label

## Out of Scope

Explicitly excluded per the plan document.

| Feature | Reason |
|---------|--------|
| Change detection logic | Informational overlay only — no changes to hesitation/pause detection |
| Affect error counts or WCPM | No scoring changes — purely additive |
| New settings/configuration | Works automatically with existing VAD infrastructure |
| Differentiated struggle classification | Future consideration — "Hesitation" vs "Sounding out" as separate categories |
| Teacher dashboard aggregation | Future consideration — aggregate VAD analysis across students |
| Threshold tuning UI | Future consideration — let teachers adjust "significant" activity threshold |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| VAD-01 | Phase 18 | Complete |
| VAD-02 | Phase 18 | Complete |
| VAD-03 | Phase 18 | Complete |
| VAD-04 | Phase 18 | Complete |
| DBG-01 | Phase 18 | Complete |
| UI-01 | Phase 19 | Pending |
| UI-02 | Phase 19 | Pending |
| UI-03 | Phase 19 | Pending |

**Coverage:**
- v1.2 requirements: 8 total
- Mapped to phases: 8
- Unmapped: 0

---
*Requirements defined: 2026-02-04*
*Last updated: 2026-02-05 after Phase 18 completion*
