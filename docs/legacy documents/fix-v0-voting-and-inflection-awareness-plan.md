# Plan: Fix V0 Voting Weight + LLM Judge for Ambiguous Words

**Date:** 2026-02-16
**Addresses:** The correlated-voter problem + brittle heuristic resolution of ASR disagreements

## Problem Statement

### The Correlated Voter Problem

V0 (Reverb clean, verbatim=0.0) and V1 (Reverb verbatim, verbatim=1.0) share the same underlying WeNet model. They differ only in prompting — V0 suppresses disfluencies, V1 preserves them. For **word correctness** decisions, they are nearly identical: if V1 mishears "faced" as "face", V0 almost always does too.

**Empirical evidence** (from 2026-02-16 test, 156 ref words):
- 14 "disagreed" entries where V1 was wrong
- In 12 of 14 cases, V0 agreed with V1's wrong answer
- In 12 of 14 cases, Parakeet had the right answer
- Effective ensemble size: ~2.03 (not 3) per N_eff = N / (1 + (N-1) * rho) with rho ~0.95

**Current code** (app.js line 971):
```javascript
const correctCount = (v1Correct ? 1 : 0) + (v0Correct ? 1 : 0) + (pkCorrect ? 1 : 0);
```

V0 gets a full vote equal to Parakeet. When V1+V0 both say "correct" (which they almost always do together), `correctCount >= 2` → "confirmed" — even if Parakeet disagrees. This means Parakeet's independent signal is outvoted by a correlated pair.

### The Heuristic Pileup Problem

The current pipeline resolves engine disagreements through a stack of heuristics that have accumulated over time:

| Heuristic | Location | What it does |
|-----------|----------|-------------|
| Post-struggle leniency | app.js ~line 2276 | If previous word was an error AND Parakeet says correct → promote substitution to correct |
| Compound struggle reclassification | app.js ~line 794 | If word is "correct" but was produced as 2+ fragments → reclassify as struggle |
| Near-miss cluster resolution | diagnostics.js ~line 195 | If insertion near a substitution is phonetically similar → group as struggle |
| Fragment absorption | diagnostics.js ~line 326 | If short insertion overlaps a substitution temporally → hide from count |
| Proper noun forgiveness | app.js ~line 1714 | If substitution on proper noun + NL API + dictionary guard → forgive |
| OOV forgiveness | app.js ~line 2057 | If omission near `<unknown>` token → forgive |

Each heuristic was a reasonable fix in isolation, but together they form a brittle chain where the order matters, edge cases compound, and adding new patterns (inflection drops, morphological awareness) means adding more heuristics forever.

## Solution: 2-Vote System + LLM Judge

### Architecture

```
V0/V1 (Reverb) ─── 1 vote ───┐
                               ├── Agree? → Done (confirmed)
Parakeet ──────── 1 vote ─────┘
                               │
                               ├── Disagree? → LLM Judge decides
                               │
                               └── One absent? → LLM Judge decides
```

**Three layers:**

1. **Mechanical pipeline** (code) — alignment, compound/abbreviation/number merging, disfluency classification, confirmed insertion detection. Deterministic, fast, no judgment needed.

2. **Binary consensus** (code) — V1 = 1 Reverb vote, Parakeet = 1 independent vote. When they agree → done. When they disagree or one is absent → mark as "ambiguous."

3. **LLM judge** (API call) — receives ALL ambiguous words from the assessment in a single batched call. Returns per-word verdict + reasoning. Replaces post-struggle leniency, inflection detection, and any future morphological heuristics.

### Why This Is Better

- **Eliminates `isInflectionDrop()`** and its false positives/misses — the LLM naturally understands "face"/"faced" AND "try"/"tried" without prefix heuristics
- **Eliminates post-struggle leniency** — the LLM reasons about context ("the student just struggled on the previous word, so this Reverb error is likely cascade artifact")
- **Handles cases no heuristic anticipated** — the LLM can reason about any pattern, not just the ones we've coded
- **One integration point** instead of a growing stack of special cases
- **Gemini is already integrated** in the codebase (`ocr-api.js`) — API key management, error handling, deterministic calls all exist

---

## Part 1: Demote V0 from Word-Correctness Voting

### What Changes

**V0/V1 become 1 Reverb vote.** V1 is the Reverb representative for word correctness. V0 stops voting. V0 remains a full participant for:
- Disfluency detection (V1 insertion present + V0 absent → filler/false_start)
- Confirmed insertion detection (3-engine consensus on extra words)
- Display in the 3-way table (UI Step 1)
- Compound confirmation (structural question, not correctness vote)
- Omission recovery fallback (when Parakeet unavailable)

### Code Changes (app.js)

**correctCount — remove V0 (line 971):**
```javascript
// Before:
const correctCount = (v1Correct ? 1 : 0) + (v0Correct ? 1 : 0) + (pkCorrect ? 1 : 0);

// After:
// V0/V1 = 1 Reverb vote, Parakeet = 1 independent vote
// Disagreements go to LLM judge
const correctCount = (v1Correct ? 1 : 0) + (pkCorrect ? 1 : 0);
```

**omitCount — remove V0 (line 976):**
```javascript
// Before:
const omitCount = (v1Omitted ? 1 : 0) + (v0Omitted ? 1 : 0) + (pkOmitted ? 1 : 0);

// After:
const omitCount = (v1Omitted ? 1 : 0) + (pkOmitted ? 1 : 0);
```

**V0 tiebreak — demote to unconfirmed (lines 1004-1006):**
```javascript
// Before:
} else if (!v1Correct && !pkCorrect && v0Correct) {
  status = 'disagreed';  // V0 tiebreak

// After:
} else if (!v1Correct && !pkCorrect && v0Correct) {
  // V0 alone correct — unreliable (same model as V1). Send to LLM judge.
  status = 'unconfirmed';
```

**Recovery path — KEEP V0 as fallback (line 984):**
```javascript
// No change — V0 stays for degraded-mode omission recovery when Parakeet is unavailable
} else if (v1Omitted && (pkCorrect || (!hasPk && v0Correct))) {
  // V0 excluded from correctness voting (correlated), but kept as
  // last-resort omission recovery when Parakeet is unavailable
  status = 'recovered';
```

**Compound confirmation — KEEP V0 (line 992):**
```javascript
// No change — "did the student say one word or two?" is structural, not a correctness vote
} else if (v1Compound && (v0Correct || pkCorrect)) {
  status = 'confirmed';
```

### Decision Matrix After Change

| V1 | Pk | correctCount | Status | Next Step |
|----|-----|-------------|--------|-----------|
| correct | correct | 2 | confirmed | Done |
| correct | wrong | 1 | **ambiguous** | LLM judge |
| correct | omitted | 1 | **ambiguous** | LLM judge |
| wrong | correct | 1 | **ambiguous** | LLM judge |
| wrong | wrong (same) | 0 | confirmed sub | Done |
| wrong | wrong (diff) | 0 | **ambiguous** | LLM judge |
| omitted | correct | 1 | recovered | Done |
| omitted | omitted | 0 | confirmed omission | Done |

"Ambiguous" = `crossValidation` of `'unconfirmed'` or `'disagreed'`. These are collected for the LLM judge.

---

## Part 2: LLM Judge for Ambiguous Words

### When It Fires

After the mechanical 3-way verdict loop completes, collect all entries where `crossValidation` is `'disagreed'` or `'unconfirmed'`. These are words where Reverb and Parakeet did not reach consensus.

Typical volume: ~5-15 ambiguous words per 150-word passage (~7-10%).

### What Data the LLM Receives

One batched call per assessment. The LLM gets:

1. **Full reference text** — the passage the student was reading
2. **Per-ambiguous-word evidence packet:**
   - Reference word and its position in the passage
   - V1 hypothesis + classification (what Reverb verbatim heard)
   - V0 hypothesis + classification (what Reverb clean heard)
   - Parakeet hypothesis + classification (what Parakeet heard)
   - Raw attempt from each engine (insertions + main word)
   - Timestamps from each engine
   - `crossValidation` status from mechanical verdict
3. **Surrounding context** — the 2-3 words before and after in the reference text, with their mechanical verdicts (confirmed/error), so the LLM knows if the student was struggling in context

### What the LLM Decides

For each ambiguous word, the LLM returns:
- **verdict**: `'correct'` | `'substitution'` | `'omission'` | `'struggle'`
- **reasoning**: 1-2 sentence explanation (stored on entry, displayed in tooltip, fed to AI diagnostic layer)
- **confidence**: `'high'` | `'medium'` | `'low'`

### What the LLM Replaces

| Current Heuristic | Replaced By | Example |
|-------------------|-------------|---------|
| Post-struggle leniency | LLM sees "previous word was error + Pk says correct" → promotes to correct with reasoning | "Student struggled on 'beautiful', so Reverb's 'face' for 'faced' is likely CTC cascade. Parakeet confirmed 'faced'." |
| `isInflectionDrop()` | LLM naturally recognizes morphological patterns | "Reverb heard 'try' for 'tried' — classic CTC inflection drop. Parakeet confirmed 'tried'." |
| Future morphology heuristics | Preempted — LLM handles "try"/"tried", "face"/"facing", etc. without code | No heuristic needed |

### What the LLM Does NOT Replace

These stay as code — they're mechanical, not judgment calls:

| Keep as Code | Why |
|-------------|-----|
| Alignment (NW) | Deterministic algorithm |
| Compound/abbreviation/number merging | Structural pattern matching |
| Disfluency classification | Set membership (filler word list) |
| Confirmed insertion detection | 3-engine consensus counting |
| OOV forgiveness | `<unknown>` token detection |
| Spillover consolidation | Alignment-level fragment reassignment |
| Near-miss cluster resolution | Temporal + phonetic grouping (pre-verdict) |
| Fragment absorption | Temporal containment (pre-verdict) |
| Proper noun forgiveness | Dictionary API + NL API guard (separate concern) |

### Prompt Design

```
You are an Oral Reading Fluency (ORF) assessment expert. A student read a passage aloud
and two independent ASR engines transcribed their reading. The engines disagree on the
following words. For each word, decide whether the student read it correctly.

## Passage
{referenceText}

## Ambiguous Words

{For each ambiguous word:}
Word #{position}: "{refWord}"
- Reverb (V1) heard: "{v1Hyp}" → classified as {v1Type}
- Reverb (V0/clean) heard: "{v0Hyp}" → classified as {v0Type}
- Parakeet heard: "{pkHyp}" → classified as {pkType}
- Context: ...{prevWord} [{refWord}] {nextWord}...
- Previous word status: {prevStatus}

## Decision Guide
- If one engine heard the correct word and the other heard something phonetically similar
  (e.g., "face" for "faced"), the student likely said it correctly and the ASR dropped
  an inflection or suffix.
- If the student just struggled on the previous word, the current word's ASR error is
  more likely artifact than genuine error.
- If both engines heard a different word entirely, the student likely said the wrong word.
- An omission confirmed by only one engine may be a false omission (ASR missed the word).

For each word, respond with:
- verdict: correct | substitution | omission | struggle
- reasoning: 1-2 sentences explaining your decision
- confidence: high | medium | low
```

### API Integration

Use the existing Gemini infrastructure from `ocr-api.js`:

```javascript
// In app.js, after 3-way verdict loop completes:
const ambiguousEntries = v1Ref.filter(e =>
  e.crossValidation === 'disagreed' || e.crossValidation === 'unconfirmed'
);

if (ambiguousEntries.length > 0 && geminiKeyAvailable) {
  const llmVerdicts = await judgAmbiguousWords(ambiguousEntries, referenceText);
  applyLlmVerdicts(llmVerdicts, ambiguousEntries);
} else {
  // Fallback: leave mechanical verdicts as-is (no heuristic overrides)
  console.log(`[LLM judge] Skipped — ${ambiguousEntries.length} ambiguous words, key=${!!geminiKeyAvailable}`);
}
```

### Fallback When LLM Unavailable

If no API key, network failure, or rate limit:
- Ambiguous words keep their mechanical verdict (`'disagreed'` / `'unconfirmed'`)
- No heuristic overrides applied (no post-struggle leniency, no inflection detection)
- `entry._llmJudgeSkipped = true` flag set for downstream awareness
- This is **more honest** than the current system where V0 fake-confirms everything
- The AI diagnostic layer (future Phase 1) can still reason about these words using the raw engine evidence

### Storage

LLM verdicts are stored on the alignment entry:
```javascript
entry._llmVerdict = 'correct';           // The LLM's decision
entry._llmReasoning = '...';             // 1-2 sentence explanation
entry._llmConfidence = 'high';           // high/medium/low
entry._llmJudged = true;                 // Flag that LLM was consulted
```

These feed:
- **Tooltip** (ui.js): Shows LLM reasoning instead of generic "disagreed" label
- **AI diagnostic layer** (future): Rich per-word reasoning for narrative generation
- **Teacher review**: Transparent reasoning for why a word was marked correct/incorrect

---

## Part 3: Post-Struggle Leniency — Remove or Keep?

With the LLM judge handling ambiguous words, post-struggle leniency (app.js ~line 2276) becomes redundant for LLM-judged entries. Two options:

**Option A: Remove post-struggle leniency entirely.** The LLM judge subsumes this logic — it receives `previousWordStatus` as context and can make the same decision with better reasoning.

**Option B: Keep post-struggle leniency as LLM fallback.** When LLM is unavailable, post-struggle leniency still fires as a degraded heuristic for `'disagreed'` entries.

**Recommendation: Option B.** Keep the heuristic but gate it behind `!entry._llmJudged`:
```javascript
// Post-struggle leniency — only fires when LLM judge was not available
if (prevRefWasError
    && entry.type === 'substitution'
    && entry.crossValidation === 'disagreed'
    && !entry._llmJudged                      // ← NEW GUARD
    && pkEntry?.type === 'correct') {
  entry.type = 'correct';
  entry._postStruggleLeniency = true;
}
```

This gives the best of both worlds: LLM reasoning when available, heuristic fallback when not.

---

## What Does NOT Change

- V0 alignment (still computed, still displayed in 3-way table)
- V0 disfluency detection (V1 insertion + V0 absent → filler)
- V0 confirmed insertion participation (still counts for 3-engine insertion consensus)
- V0 omission recovery fallback (when Parakeet unavailable)
- V0 compound confirmation (structural question, not correctness vote)
- `_v0Word` / `_v0Type` on alignment entries (still set for display/diagnostics)
- Metrics calculation (`computeAccuracy()` reads only `entry.type` and `entry.forgiven`)
- Self-correction detection (`resolveNearMissClusters`, `absorbMispronunciationFragments`)
- Word speed map tier classification
- Proper noun forgiveness (separate concern — dictionary API + NL API guard)
- OOV forgiveness (mechanical — `<unknown>` token detection)

## Downstream Impact

1. **`computeAccuracy()` (metrics.js:27-71):** Safe. Reads only `entry.type`, `entry.forgiven`, `entry._confirmedInsertion`. Does NOT read `crossValidation`. If the LLM changes `entry.type` from `'substitution'` to `'correct'`, accuracy improves — this is the intended effect.

2. **Hesitation/pause detection (diagnostics.js, 13 locations):** More words becoming "unconfirmed" are skipped in gap calculations. This is correct — if Parakeet didn't confirm the word, using Reverb's 100ms BPE timestamps for fluency analysis is unreliable. LLM-judged words that get promoted to `'correct'` could optionally have their `crossValidation` updated to `'llm_confirmed'` to re-enable timestamp usage.

3. **UI rendering (ui.js):** Words with `_llmJudged` get LLM reasoning in their tooltip instead of generic "disagreed"/"unconfirmed" labels. Verdict table shows LLM icon or label for judged words.

4. **Confirmed insertions (app.js ~line 1148):** V0 still participates. Unchanged.

5. **AI layer / data export:** `_llmReasoning` on entries gives the future diagnostic AI per-word explanations pre-computed. This is directly aligned with PACER's stated goal of feeding an AI.

## Implementation Order

1. **Change `correctCount` calculation** — remove V0 from vote (line 971)
2. **Change `omitCount` calculation** — remove V0 from vote (line 976)
3. **Change V0 tiebreak** — status from 'disagreed' to 'unconfirmed' (lines 1004-1006)
4. **Keep V0 in recovery path** (line 984) — add explanatory comment
5. **Keep V0 in compound confirmation** (line 992) — add explanatory comment
6. **Add diagnostic logging** — confirmed/unconfirmed/disagreed counts after verdict loop
7. **Build LLM judge function** — `judgeAmbiguousWords(entries, referenceText)` using Gemini API
8. **Build verdict applicator** — `applyLlmVerdicts(verdicts, entries)` that mutates entry types
9. **Gate post-struggle leniency** — add `!entry._llmJudged` guard
10. **Update tooltip** — show LLM reasoning for judged words
11. **Update version** — bump index.html version timestamp

## Risk Assessment

**Low risk.** The V0 voting change is a pure simplification — fewer moving parts, more honest labels. The LLM judge is additive and gated behind API key availability.

**No accuracy regression possible without LLM.** Without an API key, the pipeline is strictly more honest than before (no V0 fake-confirming). With an API key, the LLM provides better judgment than any heuristic stack.

| Risk | Severity | Mitigation |
|------|----------|-----------|
| LLM unavailable (no key, network) | Low | Fallback to mechanical verdicts + post-struggle leniency heuristic |
| LLM gives wrong verdict | Low | Temperature=0 deterministic; confidence field flags uncertain judgments; teacher can override |
| Latency from LLM call | Low | Single batched call for ~10 words; Gemini Flash is fast (~1-2s) |
| Cost per assessment | Negligible | ~10 words × ~100 tokens = ~1K tokens per call; Gemini Flash ≈ $0.001 |
| More words become "unconfirmed" | Cosmetic | More honest — only affects UI colors, not accuracy calculation |

## CrisperWhisper Compatibility

This architecture creates ideal scaffolding for CrisperWhisper integration (see `crisperwhisper-integration-plan.md`). After V0 is demoted:

- **Pre-CrisperWhisper:** 2-vote system (Reverb vs Parakeet) + LLM judge for ties
- **Post-CrisperWhisper:** 3-vote system (Reverb vs Parakeet vs CrisperWhisper) + LLM judge for ties

```javascript
// Post-CrisperWhisper:
const correctCount = (v1Correct ? 1 : 0) + (pkCorrect ? 1 : 0) + (cwCorrect ? 1 : 0);
```

With 3 independent engines, `correctCount >= 2` becomes true majority voting. The LLM judge then only fires for the rare case where all 3 disagree or 2 engines are unavailable. The architecture scales naturally.
