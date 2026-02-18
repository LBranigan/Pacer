# Plan: LLM Semantic Judge for Disputed Words

**Date:** 2026-02-16
**Prerequisite:** V0 voting demotion (`fix-v0-voting-and-inflection-awareness-plan.md`) must be implemented first
**Relationship to AI Layer:** This is Phase 4 from `AI-layer.md` pulled forward and narrowed in scope. Uses the same infrastructure as Phase 1 (serialization + LLM call). After this works, Phase 1 (teacher interpretation narrative) is a second prompt on the same data.

---

## Problem Statement

After V0 is demoted from word-correctness voting, the pipeline becomes V1-vs-Parakeet (2-engine). When both agree, the verdict is reliable. When they disagree, the current pipeline has limited tools:

1. **Post-struggle leniency** (app.js:2274-2281): If the previous word was an error AND the current word is `crossValidation === 'disagreed'` AND Parakeet heard it correctly → promote to correct. One-word window only.
2. **`_inflectionDrop` flag** (from V0 plan): Metadata-only. Detects "face"→"faced" pattern but doesn't auto-correct.
3. **No other tiebreaker**: Everything else stays as V1's verdict with a "disagreed" label.

An LLM can reason about **why** the engines disagree — morphological patterns, contextual plausibility, known ASR artifact patterns — and make better decisions than a 1-word-window heuristic.

## The Critical Design Constraint

**Standard ASR error correction tries to make the transcript more correct. PACER needs the opposite for genuine student errors.**

The LLM must preserve the child's real reading mistakes while fixing only ASR artifacts. This is a fundamentally different objective from what GenSEC/HyPoradise/MPA-GER optimize for. The prompt must be explicit: "You are NOT correcting the transcript. You are deciding whether each mismatch is the student's real error or the ASR's fault."

---

## Architecture

```
Pipeline runs normally through 3-way verdict
    ↓
Collect disputed words (status = 'disagreed' or 'unconfirmed')
    ↓
If 0 disputed words → skip LLM entirely
    ↓
Build context: reference passage + disputed word table + surrounding words
    ↓
Single LLM API call (batched, all disputed words in one request)
    ↓
Parse structured response: per-word verdict override
    ↓
Apply overrides to alignment entries (change type + set flags)
    ↓
Pipeline continues: diagnostics, metrics, UI rendering
```

### Integration Point: After 3-way verdict, before filler classification

**Where:** app.js, after line 1055 (after `addStage('three_way_verdict', ...)`) and before line 1057 (filler classification).

**Why here, not later:**
- All engine outputs and initial verdicts are available
- Downstream stages (filler classification, insertion cross-validation, omission recovery, near-miss resolution, struggle detection, post-struggle leniency) all run on the LLM-corrected data
- Post-struggle leniency (line 2274) still applies — if the LLM doesn't override a disagreed word, the existing heuristic gets a second chance

**Why not after diagnostics:**
- Would require re-running downstream logic if verdicts change
- Diagnostics depend on `entry.type` — changing it after diagnostics would invalidate hesitation/pause calculations

### Async Integration

The LLM call is async (API call). The pipeline is already async (`async function processAudio()`). The call fits naturally:

```javascript
// After 3-way verdict, before filler classification
const disputedEntries = v1Ref.filter(e =>
  e.crossValidation === 'disagreed' || e.crossValidation === 'unconfirmed'
);

if (disputedEntries.length > 0) {
  const overrides = await queryLLMJudge(disputedEntries, alignment, referenceText, data);
  applyLLMOverrides(overrides, alignment, transcriptWords);
  addStage('llm_judge', { queried: disputedEntries.length, overrides: overrides.length });
}
```

---

## Data Available Per Disputed Word

For each disputed word sent to the LLM, include:

| Field | Source | Example | Why |
|-------|--------|---------|-----|
| `ref` | alignment entry | `"faced"` | What the passage says |
| `v1Heard` | `entry.hyp` | `"face"` | What Reverb heard |
| `v0Heard` | `entry._v0Word` | `"face"` | What Reverb clean heard |
| `pkHeard` | `entry._xvalWord` | `"faced"` | What Parakeet heard |
| `v1Type` | `entry.type` | `"substitution"` | V1's verdict |
| `pkType` | `entry._pkType` | `"correct"` | Parakeet's verdict |
| `status` | `entry.crossValidation` | `"disagreed"` | Current 3-way status |
| `prevWord` | alignment[ri-1] | `{ref: "he", type: "correct"}` | Context: was previous word an error? |
| `nextWord` | alignment[ri+1] | `{ref: "the", type: "correct"}` | Context: is next word affected? |
| `inflectionDrop` | `entry._inflectionDrop` | `true` | V0 plan's detection |
| `levenshtein` | computed | `0.83` | Similarity between V1 hyp and ref |
| `refIndex` | loop index | `14` | Position in passage |

**NOT sent** (to keep tokens low and avoid confusing the LLM):
- Raw timestamps (not meaningful to the LLM)
- Confidence scores (unreliable, documented in AI-layer.md)
- `hypIndex` (internal array pointer)
- Full alignment array (only disputed + context words)

---

## Prompt Design

### System Prompt (~400 tokens)

```
You are a reading assessment arbiter. You will receive words from an oral
reading fluency assessment where two ASR engines disagree.

YOUR TASK: For each disputed word, decide whether the mismatch between the
ASR transcript and the reference text is:
- A genuine reading error by the student (the child actually said the wrong word)
- An ASR artifact (the ASR misheard but the child likely said the correct word)

CRITICAL: You are NOT correcting the transcript. You are NOT trying to make
it "more correct." You are deciding whether the CHILD made an error. If the
child genuinely said "face" instead of "faced," that IS a real error — do not
fix it just because "faced" makes more grammatical sense.

KNOWN ASR ARTIFACT PATTERNS (trust the cross-validator engine when you see these):
- Inflection dropping: CTC models systematically drop word-final morphemes
  ("faced"→"face", "tried"→"try", "others"→"other", "running"→"run")
- BPE fragmentation: "platforms" heard as "plat" + "forms" (compound split)
- CTC decoder derailment: After a genuine student error, the primary engine
  often mishears the NEXT 1-2 words. If the previous word was a real error
  and the cross-validator heard the current word correctly, trust the
  cross-validator.
- Homophone confusion: "there"/"their"/"they're" — ASR picks wrong spelling
  but child said it correctly

WHEN TO KEEP THE ERROR (child genuinely read it wrong):
- Both engines heard the same wrong word
- The substituted word is a real word that sounds different from the reference
- The error is consistent with a common reading mistake (visual similarity,
  semantic substitution, function word swap)

Respond with a JSON array. For each word, provide:
- refIndex: the word's position number
- verdict: "trust_crossvalidator" or "keep_error"
- confidence: "high" or "low"
- reasoning: one sentence explaining your decision
```

### User Prompt Template (~50 + ~30 per disputed word)

```
Reference passage: "{referenceText}"

Disputed words (the two engines disagree on these):

| # | Reference | Primary ASR | Cross-validator | Status | Context (prev → next) | Notes |
|---|-----------|-------------|-----------------|--------|----------------------|-------|
| 5 | faced     | face        | faced           | disagreed | "he" → "the"      | inflection_drop |
| 8 | tried     | try         | tried           | disagreed | "and" → "to"       | inflection_drop |
| 12| platforms | plat        | platforms       | disagreed | "the" → "were"     | prev_was_error |
| 19| often     | opted       | often           | disagreed | "was" → "seen"     |  |
```

### Expected Response (~50 tokens per word)

```json
[
  {"refIndex": 5, "verdict": "trust_crossvalidator", "confidence": "high",
   "reasoning": "Inflection drop — CTC models systematically drop '-ed' suffix."},
  {"refIndex": 8, "verdict": "trust_crossvalidator", "confidence": "high",
   "reasoning": "Inflection drop — 'try' is the stem of 'tried'."},
  {"refIndex": 12, "verdict": "trust_crossvalidator", "confidence": "high",
   "reasoning": "Previous word was an error — CTC decoder likely derailed."},
  {"refIndex": 19, "verdict": "keep_error", "confidence": "low",
   "reasoning": "'opted' and 'often' sound different — ambiguous but 'opted' is a real word the child may have read."}
]
```

### Token Budget

For a typical 200-word passage with 10-20 disputed words:
- System prompt: ~400 tokens
- User prompt: ~200 + (30 × N_disputed) = ~500-800 tokens
- Response: ~50 × N_disputed = ~500-1000 tokens
- **Total: ~1,400-2,200 tokens per assessment**

---

## Applying Overrides

```javascript
function applyLLMOverrides(overrides, alignment, transcriptWords) {
  const v1Ref = alignment.filter(e => e.type !== 'insertion');
  for (const override of overrides) {
    if (override.verdict !== 'trust_crossvalidator') continue;
    const entry = v1Ref[override.refIndex];
    if (!entry) continue;
    // Only override substitutions where Parakeet was correct
    if (entry.type !== 'substitution') continue;
    if (entry._pkType !== 'correct') continue;

    entry._originalType = entry.type;
    entry.type = 'correct';
    entry._llmJudgeOverride = true;
    entry._llmJudgeReasoning = override.reasoning;
    entry._llmJudgeConfidence = override.confidence;

    // Update transcriptWord's crossValidation to reflect the override
    if (entry.hypIndex != null && entry.hypIndex >= 0) {
      const tw = transcriptWords[entry.hypIndex];
      if (tw) tw._llmJudgeOverride = true;
    }
  }
}
```

### Safety Guards

1. **Only override substitutions → correct.** The LLM cannot create new errors, change omissions, or override confirmed words. It can only upgrade disputed substitutions.
2. **Only when Parakeet was correct.** The LLM arbitrates between V1 (wrong) and Parakeet (correct). It cannot side with a hypothesis neither engine produced.
3. **Never override `confirmed` or `recovered` words.** These already have 2+ engine agreement.
4. **Preserve `_originalType`.** The original V1 verdict is always kept for diagnostics and display.
5. **`_llmJudgeOverride` flag.** Makes every LLM decision traceable and auditable. UI can show "LLM overrode V1" in tooltip.

---

## API Integration

### New File: `js/llm-judge.js` (~150 lines)

```javascript
import { backendHeaders } from './backend-config.js';

const LLM_JUDGE_SYSTEM_PROMPT = `...`; // System prompt from above

/**
 * Query an LLM to arbitrate disputed words.
 * @param {Array} disputedEntries - Alignment entries with disagreed/unconfirmed status
 * @param {Array} alignment - Full alignment array (for context words)
 * @param {string} referenceText - Original passage text
 * @param {object} data - Pipeline data object
 * @returns {Array} Override decisions [{refIndex, verdict, confidence, reasoning}]
 */
export async function queryLLMJudge(disputedEntries, alignment, referenceText, data) {
  const apiKey = localStorage.getItem('orf_llm_api_key');
  const provider = localStorage.getItem('orf_llm_provider') || 'openai'; // 'openai' | 'anthropic'
  if (!apiKey) {
    console.log('[LLM Judge] No API key configured — skipping');
    return [];
  }

  const table = buildDisputedTable(disputedEntries, alignment, data);
  if (table.length === 0) return [];

  const userPrompt = formatUserPrompt(referenceText, table);

  try {
    const response = await callLLMAPI(provider, apiKey, userPrompt);
    return parseResponse(response);
  } catch (err) {
    console.warn('[LLM Judge] API call failed — falling back to existing verdict:', err.message);
    return []; // Graceful fallback: no overrides
  }
}
```

### API Call Pattern

```javascript
async function callLLMAPI(provider, apiKey, userPrompt) {
  const timeout = AbortSignal.timeout(10000); // 10s timeout

  if (provider === 'openai') {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: LLM_JUDGE_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1, // Low temperature for consistent classification
        max_tokens: 2000
      }),
      signal: timeout
    });
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || '[]';
  }

  if (provider === 'anthropic') {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: LLM_JUDGE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }]
      }),
      signal: timeout
    });
    const data = await resp.json();
    return data.content?.[0]?.text || '[]';
  }

  throw new Error(`Unknown LLM provider: ${provider}`);
}
```

### API Key Management

Follow existing pattern from `backend-config.js`:
- **localStorage key**: `orf_llm_api_key` (the API key)
- **localStorage key**: `orf_llm_provider` (openai | anthropic)
- **UI**: Add to settings area in `index.html`, same pattern as backend URL input
- **No key = no LLM**: Pipeline runs exactly as before. The LLM judge is purely opt-in.

---

## UI Changes

### Settings: LLM Provider Selection

Add to the settings section in `index.html`:

```html
<div class="setting-group">
  <label>LLM Judge (optional)</label>
  <select id="llm-provider">
    <option value="">Disabled</option>
    <option value="openai">OpenAI (GPT-4o-mini)</option>
    <option value="anthropic">Anthropic (Claude Haiku)</option>
  </select>
  <input type="password" id="llm-api-key" placeholder="API key">
</div>
```

### Tooltip: LLM Override Indicator

In `ui.js`, when `entry._llmJudgeOverride`:

```
LLM Judge: Overrode V1 → correct
Reason: "Inflection drop — CTC models systematically drop '-ed' suffix."
Confidence: high
```

### 3-Way Debug Table: LLM Column

Add a 7th column to the debug table showing LLM decisions:
`# | Ref | V1 | V0 | Pk | Verdict | LLM`

Only populated for rows where the LLM was consulted.

### Pipeline Stage Log

Add `llm_judge` to the pipeline stages (displayed in debug output):
```javascript
addStage('llm_judge', {
  queried: disputedEntries.length,
  overridden: overrides.filter(o => o.verdict === 'trust_crossvalidator').length,
  kept: overrides.filter(o => o.verdict === 'keep_error').length,
  latencyMs: elapsed,
  model: provider === 'openai' ? 'gpt-4o-mini' : 'claude-haiku-4.5'
});
```

---

## Interaction with Post-Struggle Leniency

Post-struggle leniency (app.js:2274-2281) runs AFTER the LLM judge. Two scenarios:

1. **LLM already overrode the word**: `entry.type` is now `'correct'` with `_llmJudgeOverride = true`. Post-struggle leniency skips it (condition requires `entry.type === 'substitution'`). No conflict.

2. **LLM kept the error**: `entry.type` remains `'substitution'` with `crossValidation === 'disagreed'`. Post-struggle leniency may still promote it if `prevRefWasError`. This is intentional — the LLM might have low confidence, and the positional heuristic provides a second chance.

This two-layer approach (LLM first, positional heuristic second) is strictly better than either alone.

---

## Interaction with Existing AI Layer Plan

The `AI-layer.md` plan has 4 phases:

| Phase | What | Status after this plan |
|-------|------|----------------------|
| Phase 1a: Serialization | `js/ai-serializer.js` — JOIN 3 data sources | **Shares infrastructure** with LLM judge. The `buildDisputedTable()` function is a subset of `buildAssessmentProfile()`. Build them together. |
| Phase 1b: Interpretation | "Generate Report" button → LLM narrative | **Same API call pattern.** After the judge works, adding interpretation is a second prompt on the same data. Same API key, same provider, same `callLLMAPI()` function. |
| Phase 2: Persistence | Supabase schema for longitudinal data | Independent. No interaction. |
| Phase 3: Longitudinal | Cross-session analysis | Independent. No interaction. |
| Phase 4: ASR correction | LLM-enhanced verdict | **This IS Phase 4, scoped down.** The judge only handles disputed words, not all words. Lower ambition, higher ROI. |

**Implementation synergy:** Build `js/llm-judge.js` and `js/ai-serializer.js` together. The serializer serves both the judge (disputed words table) and the interpreter (full assessment profile). Same file can export both `buildDisputedTable()` and `buildAssessmentProfile()`.

---

## Cost & Latency

### Per-Assessment Cost

| Model | Input (1.5K tokens) | Output (0.8K tokens) | Total |
|-------|---------------------|---------------------|-------|
| GPT-4o-mini | $0.000225 | $0.00048 | **~$0.0007** |
| Claude Haiku 4.5 | $0.00012 | $0.00050 | **~$0.0006** |
| GPT-4o | $0.00375 | $0.0080 | **~$0.012** |
| Claude Sonnet 4.5 | $0.0045 | $0.0080 | **~$0.013** |

At $0.0007/assessment with GPT-4o-mini: **1,400 assessments per dollar.**

### Latency

| Model | Expected | Worst Case |
|-------|----------|-----------|
| GPT-4o-mini | 0.5-1.5s | 3s |
| Claude Haiku 4.5 | 0.5-2s | 4s |

Current pipeline: ~10-15s. Added latency is 5-15% of total.

### Timeout & Fallback

- 10-second hard timeout via `AbortSignal.timeout(10000)`
- On timeout/error: `return []` — no overrides, pipeline continues with existing verdicts
- Console warning logged for debugging
- No user-visible error — the pipeline simply runs without LLM enhancement

---

## Miscue Registry Update

Add to `js/miscue-registry.js`:

```javascript
llmJudgeOverride: {
  description: 'LLM semantic judge overrode V1 substitution to correct based on cross-validator agreement + linguistic reasoning',
  detector: 'js/llm-judge.js → queryLLMJudge()',
  countsAsError: false, // The override changes type to 'correct'
  config: {
    providers: ['openai (gpt-4o-mini)', 'anthropic (claude-haiku-4.5)'],
    timeout: '10 seconds',
    fallback: 'No override — existing verdict preserved'
  },
  example: 'ref="faced", V1="face", Pk="faced" → LLM: inflection drop, trust cross-validator'
}
```

---

## Files Changed / Created

| File | Change | Lines |
|------|--------|-------|
| `js/llm-judge.js` | **NEW** — LLM API call, prompt builder, response parser, override applier | ~150 |
| `js/app.js` | Import + call `queryLLMJudge()` after 3-way verdict (~line 1055) | ~10 |
| `js/ui.js` | Tooltip: show `_llmJudgeOverride` + reasoning; debug table: LLM column | ~20 |
| `js/miscue-registry.js` | Add `llmJudgeOverride` entry | ~10 |
| `index.html` | LLM provider dropdown + API key input in settings; version bump | ~10 |

**Total new/changed lines: ~200**

## Implementation Order

1. Create `js/llm-judge.js` with `queryLLMJudge()`, `buildDisputedTable()`, `applyLLMOverrides()`
2. Add LLM settings UI to `index.html` (provider dropdown + API key)
3. Wire into `app.js` after 3-way verdict: collect disputed → call judge → apply overrides
4. Add tooltip display for `_llmJudgeOverride` in `ui.js`
5. Add LLM column to debug table in `ui.js`
6. Add `llm_judge` pipeline stage logging
7. Update `miscue-registry.js`
8. Update version in `index.html`
9. Test with existing recordings — compare overrides against known-correct answers

## What Does NOT Change

- 3-way verdict logic (still runs, produces disagreed/unconfirmed as before)
- Post-struggle leniency (still runs after LLM, catches anything LLM missed)
- V0 alignment and disfluency detection (unchanged)
- Metrics calculation (still reads `entry.type` — LLM changes `type`, so metrics automatically reflect overrides)
- Confirmed insertions (LLM does not touch insertions)
- Omission recovery (LLM does not touch omissions)
- Near-miss resolution, struggle detection, compound merge (all unchanged)
- Pipeline without API key (runs exactly as today)

## Risk Assessment

**Very low risk.** The LLM judge is:
- **Opt-in**: No API key = no LLM call = identical behavior to current pipeline
- **Additive**: Only promotes substitutions → correct, never creates new errors
- **Auditable**: Every override has `_llmJudgeOverride`, `_llmJudgeReasoning`, `_llmJudgeConfidence`
- **Fallback-safe**: API timeout/error returns empty overrides, pipeline continues normally
- **Post-validated**: Post-struggle leniency still runs after, providing a second layer

**The only risk**: LLM incorrectly promotes a genuine student error to "correct" (overcorrection). Mitigated by:
- Low temperature (0.1) for consistent classification
- Explicit prompt: "You are NOT correcting the transcript"
- `confidence: "low"` flag on uncertain decisions (future: could skip low-confidence overrides)
- Manual review via debug table and tooltip

## Future Extensions

1. **Batch with Phase 1 interpreter**: Same API call sends both the disputed word table AND the full assessment profile. One call, two outputs: verdict overrides + diagnostic narrative. Saves a round-trip.
2. **Fine-tuned local model**: Collect LLM judge decisions over time → fine-tune a small model (Phi-3, Llama-3-3B) on the accumulated (input, decision) pairs → replace API call with local inference → $0 cost.
3. **Teacher feedback loop**: Add "Was this override correct?" button in tooltip → builds labeled dataset → improves prompt or fine-tuning.
4. **Expanded scope**: Currently only handles disputed substitutions. Could extend to: (a) disputed omissions (V1 omitted but Pk heard it — is it a false omission?), (b) ambiguous insertions (is this an extra word or a self-correction fragment?).
