# Phase 15: Safety Checks - Context

**Gathered:** 2026-02-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Flag physically impossible or suspicious ASR outputs before presenting to teachers. This phase adds rate anomaly detection, uncorroborated sequence flagging, and flag resolution rules. UI display of flags is Phase 16.

</domain>

<decisions>
## Implementation Decisions

### Rate Anomaly Behavior
- Threshold: 5 words/second (strict — only flag truly impossible speeds)
- Detection method: 3-word sliding window (average over 3 words, catches bursts while tolerating variation)
- Flagged words are kept but visually de-emphasized (gray, italic) in Phase 16
- Rapid stutters/repetitions are NOT exempt — rate anomaly is independent of disfluency

### Uncorroborated Sequences
- Split threshold based on reference presence:
  - Words IN reference: flag at 7+ consecutive latest_only words
  - Words NOT in reference: flag at 3+ consecutive latest_only words
- Flag each word in the suspicious sequence (not just first/last)
- A single corroborated word (`_source === 'both'`) resets the sequence count

### Flag Resolution Rules
- Multiple flags are additive — show all flags that apply (teacher sees complete picture)
- Strong corroboration (`_source === 'both'` with conf >= 0.93) overrides BOTH rate and sequence flags
- Use existing HIGH confidence threshold (0.93) for consistency
- Ghost flags take priority — show ghost flag but still track other flags in data for debugging
- Flag priority for display: ghost > rate_anomaly > uncorroborated_sequence

### Edge Cases
- Short recordings (<5 seconds): check normally, no special handling
- Edge tolerance: first/last 300ms of audio get relaxed rate thresholds
- Single-word utterances: basic checks only (ghost/VAD), skip rate and sequence checks
- Confidence Collapse state (>40% words have trustLevel 'none' or `_flags`):
  - Banner: "Low Confidence Assessment. High background noise or audio issues detected."
  - Hide WCPM score (show as `---`)
  - Primary button: "Discard & Re-record"
  - Secondary action: "View Transcript (Diagnostic Mode)"

### Claude's Discretion
- Exact sliding window implementation details
- How to calculate word rate from timestamps
- Internal data structure for `_flags` array

</decisions>

<specifics>
## Specific Ideas

- "Don't Hide the Crime" — when everything fails, show the flagged transcript so teachers learn why (background TV, loud room) rather than just prompting re-record with no explanation
- Teachers should see the sea of red/gray flags to understand what went wrong
- Diagnostic mode lets teachers view problematic transcripts even when confidence collapsed

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 15-safety-checks*
*Context gathered: 2026-02-03*
