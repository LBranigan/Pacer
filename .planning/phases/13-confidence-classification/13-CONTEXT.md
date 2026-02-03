# Phase 13: Confidence Classification - Context

**Gathered:** 2026-02-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Apply asymmetric trust policy based on reference presence and model agreement. Classify words by confidence and trust level before alignment, so hallucinations don't warp WCPM scores. This phase does NOT add UI changes (that's Phase 16).

</domain>

<decisions>
## Implementation Decisions

### Trust Policy (Asymmetric Rules)

**Confidence source:** Use `default` model confidence ONLY — `latest_long` is for detection/coverage, not confidence scoring. No boosting for model agreement.

**Both models agree (`_source: 'both'`):**
- Use `default` model's confidence as-is
- No special treatment for high agreement

**latest_only (latest_long detected, default missed):**
- IN REFERENCE: Assign 0.85 (benefit of doubt — student likely mumbled correctly)
- NOT IN REFERENCE: Assign 0.50 (hallucination risk — flag as "Possible Insertion")
- Subject to VAD veto — if VAD sees silence, drops to 0.0 (Ghost)

**default_only (default detected, latest_long missed):**
- IN REFERENCE: Use default's confidence, but CAP trust level at MEDIUM (student said it but unclearly)
- NOT IN REFERENCE: Mark as LOW trust (phantom from weaker model)

### Trust Levels (Four Tiers)

| Level | Confidence | Meaning |
|-------|------------|---------|
| High | >= 0.93 | Crystal clear |
| Medium | >= 0.70 | Acceptable |
| Low | < 0.70 | Uncertain |
| Ghost | 0.0 | VAD detected no speech |

- Thresholds are **inclusive** (0.70 exactly = Medium, not Low)
- Thresholds stored in config file (developer-tunable, not user-facing)

### Processing Pipeline

**Order:** Classify → Filter ghosts → Align

1. Run `associateByTime` (ensemble merge from Phase 11)
2. Apply `classifyWordConfidence` (this phase's asymmetric trust)
3. Apply VAD ghost detection (from Phase 12)
4. Filter words with confidence === 0.0 (ghosts)
5. Pass clean list to `alignWordsToText`

This prevents hallucinations from warping alignment and WCPM.

### Reference Matching Rules

**Case:** Case-insensitive ('The' matches 'the')

**Punctuation:** Strip all punctuation EXCEPT apostrophes and hyphens
- 'don't' stays intact
- 'hello!' becomes 'hello'

**Word forms:**
- Exact match only — 'cat' does NOT match 'cats'
- No contraction expansion — 'cannot' does NOT match 'can't'
- No lemmatization — 'running' does NOT match 'run'

**Numbers:** Allow conversion — '2' matches 'two', '1st' matches 'first'

**Compounds:** Allow splits — 'butterfly' matches 'butter fly'

**Hyphens:** Match multiple forms — 'well-known' matches 'wellknown' and 'well known'

**Homophones:** Match common homophones — 'their'/'there'/'they're' all match each other

**Multiple occurrences:** If word appears anywhere in reference, ALL detected instances count as "in reference"

### Output Structure

**Top-level properties (the data):**
- `confidence` — Numeric 0.0-1.0 score
- `trustLevel` — Categorical: 'high' | 'medium' | 'low' | 'ghost'

**Metadata properties (the trace):**
- `_source` — Already exists: 'both' | 'latest_only' | 'default_only'
- `_flags` — Array of strings: ['vad_ghost', 'possible_insertion', etc.]
- `_debug` — Raw data for tooltip

**Possible Insertion flag:**
- Words with `latest_only` + NOT in reference get `_flags: ['possible_insertion']`
- Kept in results with Low trust (not filtered)
- UI will display visual indicator (Phase 16)

### Claude's Discretion

- Exact implementation of homophone matching (dictionary or hardcoded list)
- Exact implementation of number conversion (library or regex)
- Whether to include `classificationReason` in `_debug` or as separate property

</decisions>

<specifics>
## Specific Ideas

- "Classify before alignment to prevent hallucinations from warping your WCPM score"
- The 0.85 value for "valid mumble" is high enough to count but acknowledges it wasn't crystal clear
- The 0.50 value for "hallucination" is deliberately below the Medium threshold (0.70)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 13-confidence-classification*
*Context gathered: 2026-02-03*
