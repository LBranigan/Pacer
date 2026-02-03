# Phase 14: Disfluency Detection - Context

**Gathered:** 2026-02-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Detect stutters and reading disfluencies as a separate signal from ASR confidence. Compute stutter metrics (attempt count, duration, max pause), classify severity, and merge orphaned fragments back into their target words. This phase does NOT include UI display (Phase 16) or safety checks (Phase 15).

</domain>

<decisions>
## Implementation Decisions

### Stutter Detection Rules
- **Partial word match** identifies stutter attempts (fragment starts with same letters as target)
- **Length-based matching:**
  - Short fragments (1-3 chars): must match prefix of target word
  - Long fragments (4+ chars): must be exact repetition OR long prefix match (e.g., "beauti-" → "beautiful")
- **Full word repetitions count** as stutter attempts ("ball ball ball" = 3 attempts)
- **2 second gap** is the max time between attempts to group as same stutter event
- Substitutions vs stutters: If fragment is 3+ chars and doesn't match target exactly, it's a substitution (wrong word), not a stutter

### Severity Thresholds
- **Hybrid "Count-First, Duration-Override" model:**
  - `none`: 1 attempt (clean read)
  - `minor`: 2 attempts (yellow) — "the double take"
  - `moderate`: 3-4 attempts (orange) — "the struggle"
  - `significant`: 5+ attempts OR totalDuration >= 2.0s (red) — "the block/loop"
- **maxPause is a signal:** maxPause >= 0.5s with 2+ attempts bumps to at least 'moderate'
- **Every word gets scored** (including clean words with severity:'none')
- **Thresholds configurable in dev mode** via slider, fixed for users

### Fragment Merging Behavior
- **Remove merged fragments from main word array** — fragment only exists in target's _disfluency data
- **Fragments visible in tooltip** for teacher clinical detail ("Attempts: p, p, please")
- **Nearest word wins** if fragment could match multiple targets (by time proximity)
- **Length-dependent merge eligibility:**
  - Short (1-3 chars): prefix match required
  - Long (4+ chars): exact match or long prefix required

### Data Structure Design
- **Hoist critical metrics to root** for easy access:
  - `word.attempts` — direct access for conditionals
  - `word.severity` — direct access for CSS classes
- **Evidence in flat `_disfluency` object:**
  - `maxPause`, `totalDuration`, `fragments[]`
- **`_disfluency` only present when meaningful** (attempts >= 2 or severity != 'none')
- **Full persistence** — all disfluency data saved in assessments for historical analysis
- **Document-level `_disfluencySummary`** — pre-computed counts by severity for sorting/filtering

### Claude's Discretion
- Exact algorithm for time-based fragment grouping
- Edge case handling for overlapping fragments
- Performance optimization for fragment scanning

</decisions>

<specifics>
## Specific Ideas

- Severity algorithm pseudocode provided:
```javascript
function calculateSeverity(attempts, totalDuration, maxPause) {
  if (attempts >= 5 || totalDuration >= 2.0) return 'significant';
  if (maxPause >= 0.5 && attempts >= 2) return 'moderate';
  if (attempts >= 3) return 'moderate';
  if (attempts === 2) return 'minor';
  return 'none';
}
```

- Merge eligibility pseudocode provided:
```javascript
function isMergeEligible(fragment, target) {
  const f = fragment.word.toLowerCase();
  const t = target.word.toLowerCase();
  if (!t.startsWith(f.charAt(0))) return false;
  if (f.length <= 3) return t.startsWith(f);
  return (f === t) || (t.startsWith(f) && f.length >= 4);
}
```

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 14-disfluency-detection*
*Context gathered: 2026-02-03*
