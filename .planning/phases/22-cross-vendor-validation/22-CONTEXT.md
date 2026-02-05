# Phase 22: Cross-Vendor Validation - Context

**Gathered:** 2026-02-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Deepgram Nova-3 provides architecturally-decorrelated cross-validation to catch Reverb hallucinations. This phase adds a secondary ASR (Deepgram) to validate Reverb's output — flagging words that may be hallucinated. It does NOT replace Reverb as primary; it provides a confidence/validation layer.

</domain>

<decisions>
## Implementation Decisions

### Disagreement Handling
- When Reverb and Deepgram disagree on word TEXT → Keep both alternatives in the data structure
- Word presence disagreement (Reverb has word, Deepgram doesn't) → Flag as "uncertain" — don't presume whether it's hallucination or disfluency
- Word matching uses case-insensitive comparison + fuzzy tolerance (small edit distance) — goal is catching phantom words, not auditing transcription precision
- Use text-based Needleman-Wunsch global alignment for comparing outputs, NOT timestamp-based windowing (learned from failed disfluency-detector.js: 50ms windows broke with 60ms+ drift)

### Cross-Validation Status
- Primary output is agreement status, not combined confidence scores
- Status values: `"confirmed"` (both agree), `"unconfirmed"` (Reverb-only), `"disputed"` (both have word, different text)
- Reverb remains the primary model — its confidence value is the canonical `confidence` field
- Both model confidences stored in `_debug` for tooltip display

### Tooltip Display
- When models disagree: show both with labels — "Reverb: 'cat' (92%) | Deepgram: 'bat' (88%)"
- CrossValidation status shown subtly (one line among debug info, not prominent)
- When Deepgram unavailable (fallback mode): show "Reverb: 92% (Deepgram unavailable)"

### Claude's Discretion
- Exact edit distance threshold for fuzzy matching
- Needleman-Wunsch gap penalty tuning for cross-vendor alignment
- How to handle Deepgram-only words (rare case — Nova-3 tends to delete, not hallucinate)

</decisions>

<specifics>
## Specific Ideas

- "Agreement pattern is the main output of cross-validation" — the individual confidence numbers are secondary signals
- Follow existing ensemble-merger.js pattern: don't combine scores, pick the trustworthy source and store alternatives in `_debug`
- Research showed Deepgram Nova-3 is architecturally different (pure Transformer vs Reverb's CTC/Attention hybrid) — errors are decorrelated, which is exactly what we want for catching hallucinations

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 22-cross-vendor-validation*
*Context gathered: 2026-02-05*
