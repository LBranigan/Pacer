---
phase: 15-safety-checks
verified: 2026-02-04T00:39:33Z
status: gaps_found
score: 3/4 must-haves verified
gaps:
  - truth: "Long sequences (>5 consecutive latest_only words) are flagged as suspicious"
    status: partial
    reason: "Implementation uses split thresholds (7 in-ref, 3 not-in-ref) instead of unified >5 threshold"
    artifacts:
      - path: "js/safety-config.js"
        issue: "UNCORROBORATED_IN_REF_THRESHOLD: 7 (should be >5 per ROADMAP)"
    missing:
      - "Either update ROADMAP to reflect split threshold design decision, OR modify implementation to use unified >5 threshold"
  - truth: "Strong corroboration (source='both' + conf >= 0.9) overrides rate flags"
    status: partial
    reason: "Implementation uses conf >= 0.93 instead of >= 0.9 per ROADMAP"
    artifacts:
      - path: "js/safety-config.js"
        issue: "STRONG_CORROBORATION_CONF: 0.93 (should be >= 0.9 per ROADMAP)"
    missing:
      - "Either update ROADMAP success criteria to conf >= 0.93, OR modify implementation to use 0.9 threshold"
---

# Phase 15: Safety Checks Verification Report

**Phase Goal:** Flag physically impossible or suspicious ASR outputs
**Verified:** 2026-02-04T00:39:33Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Words spoken at >5 words/second are flagged as rate anomalies | ✓ VERIFIED | `MAX_WORDS_PER_SECOND: 5` in safety-config.js, 3-word sliding window in detectRateAnomalies() |
| 2 | Long sequences (>5 consecutive latest_only words) are flagged | ⚠️ PARTIAL | Split thresholds implemented (7 in-ref, 3 not-in-ref) vs. unified >5 in ROADMAP |
| 3 | Flagged words include _flags array supporting multiple anomaly types | ✓ VERIFIED | addFlag() creates _flags array, supports 'rate_anomaly' and 'uncorroborated_sequence' |
| 4 | Strong corroboration (source='both' + conf >= 0.9) overrides rate flags | ⚠️ PARTIAL | Implements >= 0.93 instead of >= 0.9 per ROADMAP |

**Score:** 2/4 fully verified, 2/4 partial (implementation differs from ROADMAP spec)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `js/safety-config.js` | Safety thresholds and flag constants | ✓ VERIFIED | 31 lines, exports SAFETY_THRESHOLDS and SAFETY_FLAGS, no stubs |
| `js/safety-checker.js` | Rate anomaly and sequence detection | ✓ VERIFIED | 321 lines, exports 6 functions (addFlag, detectRateAnomalies, detectUncorroboratedSequences, applyCorroborationOverride, detectConfidenceCollapse, applySafetyChecks), no stubs |
| `js/app.js` integration | Safety checks in pipeline | ✓ VERIFIED | Import on line 21, call on line 245, _safety persistence on lines 289, 640 |

**Artifact Score:** 3/3 artifacts exist, substantive, and wired

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| safety-checker.js | safety-config.js | import thresholds | ✓ WIRED | Line 10: `import { SAFETY_THRESHOLDS, SAFETY_FLAGS } from './safety-config.js'` |
| safety-checker.js | diagnostics.js | parseTime function | ✓ WIRED | Line 9: `import { parseTime } from './diagnostics.js'`, used on lines 52-53 |
| safety-checker.js | confidence-classifier.js | buildReferenceSet | ✓ WIRED | Line 11: `import { buildReferenceSet } from './confidence-classifier.js'`, used on line 294 |
| safety-checker.js | word-equivalences.js | getCanonical | ✓ WIRED | Line 12: `import { getCanonical } from './word-equivalences.js'`, used on line 137 |
| app.js | safety-checker.js | applySafetyChecks | ✓ WIRED | Line 21: import, line 245: call with (words, referenceText, audioDurationMs), result stored in safetyResult |

**Link Score:** 5/5 key links verified

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| SAFE-01: Rate anomaly detection flags >5 words/second | ✓ SATISFIED | None - MAX_WORDS_PER_SECOND: 5 implemented |
| SAFE-02: Long uncorroborated sequences (>5 consecutive latest_only) flagged | ⚠️ PARTIAL | Split thresholds (7 in-ref, 3 not-in-ref) vs. >5 in spec |
| SAFE-03: Flagged words have _flags array for multiple anomaly types | ✓ SATISFIED | None - _flags array with addFlag() deduplication |
| SAFE-04: Strong corroboration (source='both' + conf >= 0.9) overrides flags | ⚠️ PARTIAL | Implements >= 0.93 instead of >= 0.9 |

**Requirements Score:** 2/4 satisfied, 2/4 partial

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| - | - | - | - | No anti-patterns detected |

**Anti-Pattern Score:** 0 blockers, 0 warnings, 0 info

## Detailed Findings

### Truth 1: Rate Anomaly Detection (✓ VERIFIED)

**Evidence:**
- `js/safety-config.js` line 12: `MAX_WORDS_PER_SECOND: 5`
- `js/safety-checker.js` lines 39-85: `detectRateAnomalies()` function
- 3-word sliding window algorithm (lines 48-82)
- Edge tolerance implemented (lines 61-64): skips first/last 300ms
- Rate calculation: `rate = RATE_WINDOW_SIZE / windowDurationSec` (line 68)
- Flags all words in window when `rate > MAX_WORDS_PER_SECOND` (lines 70-79)
- Stores debug metadata: `word._rateAnomaly = { rate, windowIndex }` (lines 75-78)

**Wiring:**
- `parseTime()` imported from diagnostics.js (line 9)
- Used in app.js line 245: `applySafetyChecks(wordsWithDisfluency, referenceText, audioDurationMs)`
- Results persisted in `_safety.rateAnomalies` (line 289)

**Verdict:** VERIFIED - Rate anomaly detection fully functional per physiological limit.

### Truth 2: Long Uncorroborated Sequences (⚠️ PARTIAL)

**Evidence:**
- `js/safety-config.js` lines 17-18:
  - `UNCORROBORATED_IN_REF_THRESHOLD: 7` (ROADMAP says >5)
  - `UNCORROBORATED_NOT_IN_REF_THRESHOLD: 3` (stricter for hallucinations)
- `js/safety-checker.js` lines 111-186: `detectUncorroboratedSequences()` function
- Split threshold logic (lines 144-174): separate counters for in-ref vs. not-in-ref
- Back-flags all words in sequence (lines 150-158, 164-173)
- Corroborated words (`source === 'both'`) reset both counters (lines 128-133)

**Gap Analysis:**
- ROADMAP success criteria #2: "Long sequences (>5 consecutive `latest_only` words)"
- Implementation: 7+ for in-reference, 3+ for not-in-reference
- This is a MORE SOPHISTICATED design (split thresholds based on context), NOT a bug
- Context documented in 15-CONTEXT.md lines 23-27
- But ROADMAP was never updated to reflect this design decision

**Missing:**
- Update ROADMAP.md Phase 15 success criteria #2 to reflect split threshold design
- OR modify implementation to use unified >5 threshold per original spec

**Verdict:** PARTIAL - Implementation is substantive and correct for split threshold design, but doesn't match ROADMAP spec.

### Truth 3: _flags Array for Multiple Anomaly Types (✓ VERIFIED)

**Evidence:**
- `js/safety-checker.js` lines 20-28: `addFlag(word, flag)` helper
- Initializes `word._flags = []` if not exists (lines 21-23)
- Deduplicates before adding (lines 24-25)
- Two flag types in SAFETY_FLAGS (safety-config.js lines 27-30):
  - `RATE_ANOMALY: 'rate_anomaly'`
  - `UNCORROBORATED_SEQUENCE: 'uncorroborated_sequence'`
- Flags added in detectRateAnomalies (line 73) and detectUncorroboratedSequences (lines 152, 167)
- Ghost flags preserved by override logic (line 212: explicit `!== 'vad_ghost'` check)

**Wiring:**
- Used throughout safety-checker.js for flagging
- Checked in detectConfidenceCollapse (line 247): counts words with `_flags.length > 0`
- Preserved in saved assessments via app.js line 640

**Verdict:** VERIFIED - Multi-flag support fully implemented with deduplication.

### Truth 4: Strong Corroboration Override (⚠️ PARTIAL)

**Evidence:**
- `js/safety-config.js` line 21: `STRONG_CORROBORATION_CONF: 0.93`
- `js/safety-checker.js` lines 198-224: `applyCorroborationOverride()` function
- Check on line 206: `source === 'both' && confidence >= STRONG_CORROBORATION_CONF`
- Removes rate_anomaly and uncorroborated_sequence flags (lines 209-211)
- NEVER removes vad_ghost flag (line 212)
- Cleans up empty _flags arrays (lines 216-218)

**Gap Analysis:**
- ROADMAP success criteria #4: "conf >= 0.9"
- Implementation: `conf >= 0.93` (matches CONFIDENCE_THRESHOLDS.HIGH)
- Design decision: Use HIGH threshold for consistency (safety-config.js line 21 comment)
- More conservative = safer (requires higher confidence before removing flags)

**Missing:**
- Update ROADMAP.md Phase 15 success criteria #4 to "conf >= 0.93"
- OR modify STRONG_CORROBORATION_CONF to 0.9 per original spec

**Verdict:** PARTIAL - Implementation uses higher threshold (0.93) than ROADMAP spec (0.9).

## Pipeline Integration

**Order Verified:**
1. Confidence classification (app.js lines 192-215)
2. Ghost filtering (app.js line 216)
3. Disfluency detection (app.js lines 219-236)
4. **Safety checks** (app.js lines 239-256) ← THIS PHASE
5. Alignment (app.js line 264+)

**Status Message:** "Running safety checks..." (line 239)

**Data Flow:**
- Input: `wordsWithDisfluency` (fragments already merged)
- Process: `applySafetyChecks(wordsWithDisfluency, referenceText, audioDurationMs)`
- Output: `wordsWithSafety` (used for alignment on line 264)

**Persistence:**
- `_safety` field added to data object (line 289)
- Saved in assessments (line 640)
- Debug log stage 'safety_checks' (lines 248-252)

**Collapse Warning:**
- Logs warning when >40% flagged (lines 254-256)
- Collapse state available for Phase 16 UI

## Summary

### Gaps Summary

Phase 15 implementation is **functionally complete** with all safety checks working correctly, but has **2 specification mismatches**:

1. **Uncorroborated sequence threshold:** Implements split thresholds (7 in-ref, 3 not-in-ref) instead of unified >5 per ROADMAP. This is a MORE SOPHISTICATED design documented in CONTEXT.md, but ROADMAP was never updated.

2. **Corroboration confidence threshold:** Implements >= 0.93 instead of >= 0.9 per ROADMAP. This is a MORE CONSERVATIVE choice aligned with CONFIDENCE_THRESHOLDS.HIGH, but doesn't match spec.

**Both gaps are design improvements, not bugs.** The code works correctly for the implemented thresholds. The issue is documentation drift between ROADMAP and implementation.

### Recommended Resolution

**Option A (Preferred):** Update ROADMAP.md to match implementation
- Success criteria #2: "Long sequences (7+ consecutive `latest_only` IN reference, OR 3+ NOT in reference) are flagged"
- Success criteria #4: "Strong corroboration (`_source === 'both'` with conf >= 0.93) overrides rate flags"

**Option B:** Modify implementation to match ROADMAP
- Change `UNCORROBORATED_IN_REF_THRESHOLD: 5` and `UNCORROBORATED_NOT_IN_REF_THRESHOLD: 5`
- Change `STRONG_CORROBORATION_CONF: 0.9`

**Recommendation:** Option A — the split thresholds and 0.93 confidence are better design decisions backed by research (CONTEXT.md).

---

*Verified: 2026-02-04T00:39:33Z*
*Verifier: Claude (gsd-verifier)*
