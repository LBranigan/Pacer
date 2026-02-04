# Phase 16: UI Enhancements - Context

**Gathered:** 2026-02-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Surface ensemble data, disfluency signals, and calibration controls in the existing teacher UI. This is the visual layer that makes all v1.1 backend work (Phases 10-15) visible and actionable for teachers. No new data processing — only displaying what's already computed.

</domain>

<decisions>
## Implementation Decisions

### Word tooltip content
- Full debug info visible to ALL teachers (not gated behind dev mode)
- Show both model results with timestamps
- Timestamps display: offset range AND duration (e.g., "0.5s - 0.8s (300ms)")
- Flags appear as text list: "Flags: rate_anomaly, ghost" — no icons in tooltip

### Disfluency visual language
- Hybrid badge system based on severity:
  - Minor (yellow): • single dot — "a small bump" (2 attempts)
  - Moderate (orange): •• double dot — "a struggle" (3-4 attempts)
  - Significant (red): ⚠️ warning icon — "a blockage" (5+ attempts or >2s)
- Badge position: superscript (top-right of word)
- Color interaction: BOTH visible — word keeps correctness color (green/yellow/red), badge has its own severity color
- Rate anomaly flags use DIFFERENT visual: border/underline (dashed underline or dotted border), not badges

### WCPM range display
- Format: dash range "85-92 WCPM"
- Layout: primary value prominent above, range shown smaller below
- Primary value: CONSERVATIVE (min) — show 85 as main, "85-92" below
- Fluency concerns summary appears directly BELOW the WCPM range
- Summary format: counts by severity (e.g., "3 significant, 5 moderate, 8 minor")

### Calibration UX flow
- Button location: Settings page (not near record button)
- Calibration feedback: simple spinner with "Calibrating..." text
- Result display: full technical — noise level + threshold value + slider to adjust
- Dev mode only shows slider — normal users see noise level and threshold value, dev mode adds the slider for manual adjustment

### Claude's Discretion
- Exact tooltip styling and positioning
- Specific CSS for dashed underline on rate-flagged words
- Typography and spacing choices
- How to handle edge cases (e.g., word with both disfluency AND rate anomaly)

</decisions>

<specifics>
## Specific Ideas

- Badge hierarchy creates reading flow: "eye skips over yellow dot, pauses on orange dots, stops at red icon"
- Tooltip on disfluency badge should reveal the "trace" (fragments): "Attempts: b, ba, ball"
- Conservative WCPM value = underpromise philosophy — better to report lower and be accurate

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 16-ui-enhancements*
*Context gathered: 2026-02-03*
