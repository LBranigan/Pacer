# Phase 19: VAD Gap UI Display - Context

**Gathered:** 2026-02-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Display VAD acoustic context on pause and hesitation indicators so teachers understand what happened during reported gaps. Teachers can hover over indicators to see VAD percentage, duration, and factual description. Indicators with significant VAD activity (>=30%) show visual distinction via orange color.

</domain>

<decisions>
## Implementation Decisions

### Tooltip content & style
- Tooltip shows three pieces of information: VAD percentage, duration, and interpretive hint
- Acoustic label displayed in full form: "VAD: 45% (mixed signal)"
- Tooltip styling matches existing tooltips in the app

### Visual distinction styling
- Pause indicators with VAD >=30% use orange color (instead of red)
- Hesitation indicators with VAD >=30% also use orange (consistent treatment)
- Single orange shade for anything >=30% (no gradient)
- Color only — no additional icons or border changes

### Indicator placement
- Tooltip position: auto/smart based on available space
- Trigger: hover only (no click-to-pin)
- Appears instantly on hover (no delay)
- Touch devices: tap to show, tap elsewhere to hide

### Information hierarchy
- VAD percentage shown first, then duration, then hint
- Interpretive hints use factual descriptions (e.g., "speech detected during gap", "no speech detected")
- Hint text has same visual weight as other tooltip text (not muted)
- All tooltips same color regardless of acoustic label

### Claude's Discretion
- Exact tooltip positioning algorithm
- Factual description wording for each acoustic label
- Animation/transition timing

</decisions>

<specifics>
## Specific Ideas

- Orange chosen specifically to differentiate from red (true silence) while remaining in warm warning color family
- Factual descriptions preferred over behavioral interpretations — let teachers draw conclusions

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 19-vad-gap-ui-display*
*Context gathered: 2026-02-04*
