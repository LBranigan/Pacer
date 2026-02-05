# Phase 24: Disfluency UI Display - Context

**Gathered:** 2026-02-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Teachers see disfluencies visually distinct from reading errors, with classification details on hover. The pipeline already provides isDisfluency, disfluencyType, and crossValidation properties per word (Phase 23). This phase adds the visual layer only.

</domain>

<decisions>
## Implementation Decisions

### Visual styling
- Disfluencies marked with small dot above the word (superscript-style marker)
- Same marker style for all disfluency types (filler, repetition, false start)
- Word text stays normal appearance — only the dot indicates disfluency
- No color changes, background tints, or text styling for disfluent words

### Tooltip design
- Tooltip appears on hover (consistent with existing VAD/confidence tooltips)
- Shows type + brief explanation, minimal/terse tone
- Always mentions that disfluencies don't count as errors
- Examples:
  - "Filler (um, uh) — not an error"
  - "Repetition — not an error"
  - "False start — not an error"

### Diagnostics panel
- Own section for disfluencies (separate from errors/accuracy)
- Collapsible section with expand/collapse toggle
- Collapsed summary: count + dominant type (e.g., "Disfluencies: 3 (mostly fillers)")
- Expanded view: full breakdown with each type on its own line
- No icon in section header — text label "Disfluencies" matches other sections

### Claude's Discretion
- Exact dot size, position, and CSS styling
- Expand/collapse animation and default state
- Exact wording for each disfluency type explanation
- Placement of disfluency section relative to other diagnostics sections

</decisions>

<specifics>
## Specific Ideas

- Marker should be unobtrusive — teachers focusing on errors shouldn't be distracted by disfluency markers
- "Mostly fillers" summary helps teachers quickly understand the pattern without expanding

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 24-disfluency-ui-display*
*Context gathered: 2026-02-05*
