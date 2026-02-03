# Phase 12: VAD Integration - Context

**Gathered:** 2026-02-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Detect hallucinations by checking for actual speech during `latest_only` words using Silero VAD. VAD runs as post-process safety valve on the completed audio file (not during live recording). Flags suspicious words as `vad_ghost_in_reference`. Includes microphone calibration to determine optimal VAD threshold.

</domain>

<decisions>
## Implementation Decisions

### Ghost Detection Logic
- Overlap threshold: Claude's discretion (determines appropriate overlap requirement)
- Short words (<200ms): More lenient detection rules — harder to catch, require less overlap
- Ghost handling: Flag only (keep in transcript) — teacher sees flagged words with visual indicator
- Non-reference ghosts: Claude's discretion on whether to flag words not in reference
- Quiet speech: Trust if VAD sees anything — even weak detection means student spoke
- Audio edges: Be lenient at start/end of recording — don't flag edge words
- Ghost sequences: Escalate 5+ consecutive ghosts with more prominent flagging (no recalibration prompt)
- No reference text: Disable ghost detection entirely when no reference exists
- Skipped word handling: Claude's discretion on distinguishing "inserted hallucination" from ghost
- Ghost metrics: Include count in assessment — teacher sees "X words flagged as potentially hallucinated"
- VAD failure: Warn and continue — show warning that ghost detection unavailable, proceed with assessment

### Calibration UX
- Trigger: Optional anytime — button always available, never forced
- Duration: 2 seconds (not 1.5s)
- UI during calibration: Simple spinner with "Calibrating..." — minimal UI
- Pre-calibration instruction: Minimal — "Click to calibrate microphone"
- Post-calibration feedback: Success + noise level — "Calibrated. Noise level: Low"

### Noise Level Display
- Location: Settings/config area only — not visible during assessment
- Format: Text only with actual number — e.g., "Noise Level: Low (0.23)"
- Uncalibrated state: Show "Default" with default threshold value
- High noise guidance: Subtle note — small text like "Higher background noise detected"

### VAD Threshold Behavior
- Manual control: Available for all teachers (not dev mode only)
- Control type: Slider with presets — slider 0.15-0.60 plus preset buttons ("Quiet Room" / "Normal" / "Noisy")
- Override behavior: Calibration overrides manual — pressing calibrate always resets to measured value
- Location: Settings page with other configuration
- Default value: Middle of range (0.375) if teacher never calibrates
- Persistence: Reset each session — threshold resets to default on page reload
- Impact preview: None — effect seen on next assessment
- Extreme values: No warning — teacher can set any value in range

### Claude's Discretion
- Exact overlap threshold for ghost detection
- Whether to flag non-reference words with no speech
- How to distinguish "inserted hallucination" from regular ghost
- Preset button threshold values (Quiet/Normal/Noisy)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-vad-integration*
*Context gathered: 2026-02-03*
