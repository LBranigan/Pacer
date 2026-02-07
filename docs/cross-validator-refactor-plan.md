# Plan: Cross-Validator Refactor + Parakeet Toggle

## Context

The Kitchen Sink pipeline uses Deepgram Nova-3 as an independent cross-validator against Reverb. The name "Deepgram" is hardcoded in **6 functional locations** and ~20 cosmetic locations across 10 files — property names on word objects (`_deepgramStartTime`), function names (`crossValidateWithDeepgram`), UI tooltip labels, debug stage names, and omission recovery logic.

We want to add Parakeet-TDT 0.6B v2 as a toggleable alternative cross-validator. Rather than bloating the codebase with conditionals or forked files, we first rename all engine-specific internals to engine-agnostic names (pure mechanical change), then adding Parakeet becomes trivial — one thin transport file + one backend endpoint + a radio toggle.

**Related doc:** `docs/local-cross-validator-plan.md` — research & model selection rationale.

---

## What Deepgram Currently Does (6 functional dependencies)

Before refactoring, here's every functional thing the cross-validator provides:

| # | What | Where | How it works |
|---|---|---|---|
| 1 | **Primary timestamps** for confirmed/disagreed words | `deepgram-api.js:210-212` | Deepgram timestamps overwrite Reverb's `startTime`/`endTime` (Reverb CTM hardcodes ~100ms durations) |
| 2 | **Cross-validation status** per word | `deepgram-api.js:132-256` | NW alignment → `confirmed`, `disagreed`, `unconfirmed`, or `unavailable` |
| 3 | **Struggle detection** (Path 3 miscue) | `diagnostics.js:596-616` | `unconfirmed` + near-miss substitution → upgraded to "abandoned attempt" |
| 4 | **Primary confidence scores** | `deepgram-api.js:220` | Deepgram confidence replaces Reverb's for confirmed/disagreed words |
| 5 | **Omission recovery** from unconsumed words | `app.js:687-762` | Words heard by Deepgram but missed by Reverb → recovered into transcript with timestamps |
| 6 | **UI display** (tooltips, coloring, labels) | `ui.js:183-222,282,798,816` | Triple timestamp display, word coloring by status, "Deepgram heard: X" tooltips |

**All 6 of these are engine-agnostic** — they work identically regardless of which ASR engine provides the `{word, startTime, endTime, confidence}` data. The only Deepgram-specific code is the HTTP transport (`sendToDeepgram`) and the backend endpoint (`/deepgram`).

---

## CRITICAL: Saved Assessment Data Migration

**`_deepgramStartTime` and friends ARE saved to localStorage** in the `sttWords` array of every assessment record (via `storage.js` → `JSON.stringify`). When you view a saved assessment, `ui.js` reads these properties by name for tooltips.

**If we rename without migration, old saved assessments break** — tooltips would show "N/A" for all timestamps.

**Fix:** `storage.js` already has a version-based migration system (currently at v5). Phase A adds a **v5→v6 migration** that renames properties on all saved word objects. Runs automatically, once, when old data is loaded by new code.

```javascript
// In storage.js migrate() function:
if (data.version === 5) {
  for (const a of data.assessments) {
    if (Array.isArray(a.sttWords)) {
      for (const w of a.sttWords) {
        // Rename _deepgram* → _xval*
        if ('_deepgramStartTime' in w) { w._xvalStartTime = w._deepgramStartTime; delete w._deepgramStartTime; }
        if ('_deepgramEndTime' in w)   { w._xvalEndTime = w._deepgramEndTime;     delete w._deepgramEndTime; }
        if ('_deepgramConfidence' in w) { w._xvalConfidence = w._deepgramConfidence; delete w._deepgramConfidence; }
        if ('_deepgramWord' in w)       { w._xvalWord = w._deepgramWord;           delete w._deepgramWord; }
        // Add engine tag to migrated words
        if (w._xvalStartTime != null) w._xvalEngine = 'deepgram';
      }
    }
  }
  data.version = 6;
}
```

### Complete list of saved properties that are renamed

| Saved in `sttWords` | Old name | New name | Read by |
|---|---|---|---|
| Yes | `_deepgramStartTime` | `_xvalStartTime` | `ui.js:183`, `app.js:248` |
| Yes | `_deepgramEndTime` | `_xvalEndTime` | `ui.js:184`, `app.js:250` |
| Yes | `_deepgramConfidence` | `_xvalConfidence` | `app.js:520,554` |
| Yes | `_deepgramWord` | `_xvalWord` | `ui.js:201`, `ui.js:816`, `app.js:680` |
| Yes | `crossValidation` | `crossValidation` | **NO CHANGE** — already engine-agnostic |
| Yes | `_reverbStartTime` | `_reverbStartTime` | **NO CHANGE** — Reverb-specific, correct |
| Yes | `_reverbEndTime` | `_reverbEndTime` | **NO CHANGE** |
| Yes | `_reverbConfidence` | `_reverbConfidence` | **NO CHANGE** |
| Yes | `_reverbCleanStartTime` | `_reverbCleanStartTime` | **NO CHANGE** |
| Yes | `_reverbCleanEndTime` | `_reverbCleanEndTime` | **NO CHANGE** |

Only the 4 `_deepgram*` properties need renaming. All `_reverb*` and `crossValidation` stay as-is.

### Migration edge cases (verified)

- **`unavailable` words** (Deepgram offline): have NO `_deepgram*` keys at all — `if ('_deepgramStartTime' in w)` correctly skips them.
- **`unconfirmed` words**: DO have `_deepgramStartTime: null` etc — `in` returns `true` (key exists), migration correctly renames.
- **Fallback words** (Deepgram-only, Reverb offline): have NO `_deepgram*` keys — migration correctly skips.
- **`recovered` words**: have all `_deepgram*` keys with values — migration correctly renames.
- **`_kitchenSink.unconsumedDeepgram`**: NOT saved to localStorage (`saveAssessment()` doesn't include `_kitchenSink`) — no migration needed.
- **`defaultData()` version bump to 6**: safe for fresh installs (empty arrays, migration skipped).
- **No `_xval*` naming collisions** exist anywhere in the codebase — rename is safe.
- **Only `orf_data` localStorage key** contains deepgram data — no other keys need migration.

---

## Phase A: Pure Rename (`_deepgram*` → `_xval*`) + Data Migration

**Goal:** Mechanical find-and-replace + localStorage migration. Zero behavior change. One commit.

### Property renames on word objects

| Old | New | Purpose |
|---|---|---|
| `_deepgramStartTime` | `_xvalStartTime` | Cross-validator timestamp start |
| `_deepgramEndTime` | `_xvalEndTime` | Cross-validator timestamp end |
| `_deepgramConfidence` | `_xvalConfidence` | Cross-validator confidence score |
| `_deepgramWord` | `_xvalWord` | What the cross-validator heard |
| *(new)* | `_xvalEngine` | `'deepgram'` or `'parakeet'` — which engine produced this data |

### Function and variable renames

| Old | New | File |
|---|---|---|
| `crossValidateWithDeepgram()` | `crossValidateTranscripts()` | `deepgram-api.js` |
| `unconsumedDeepgram` | `unconsumedXval` | `kitchen-sink-merger.js`, `app.js` |
| `deepgram_raw` (stage name) | `xval_raw` | `app.js` |
| `deepgram_unconsumed` (stage name) | `xval_unconsumed` | `app.js` |
| `deepgramAvailable` (debug flag) | `xvalAvailable` | `kitchen-sink-merger.js:127,150,259`, `app.js:191` |

### UI label changes

Tooltips currently hardcode "Deepgram:". After rename, they read `word._xvalEngine` dynamically:
- `"Deepgram: 0.12s–0.45s"` → `"Deepgram: 0.12s–0.45s"` (same output, but dynamic)
- `"Deepgram heard: \"jumped\""` → `"Deepgram heard: \"jumped\""` (same, reads `_xvalEngine`)
- `"Deepgram heard nothing"` → reads `_xvalEngine` for label
- Subtitle: `"Reverb + Deepgram"` stays for now (updated dynamically in Phase C)

**Additional hardcoded tooltip strings that must become dynamic:**

| File:Line | Current string | Fix |
|---|---|---|
| `ui.js:195` | `"  Deepgram:    ${fmtTs(...)}"` | Read label from `_xvalEngine` or `getCrossValidatorName()` |
| `ui.js:218` | `' (Reverb only — Deepgram heard nothing)'` | Dynamic engine name |
| `ui.js:219` | `' (Deepgram offline)'` | Dynamic engine name |
| `ui.js:165` | `'(Deepgram N/A, verbatim-only)'` | Dynamic engine name |

### Internal variables also renamed (for consistency, not strictly required)

These are local variables inside functions — not on word objects, not saved. But renaming them avoids confusion.

| Old | New | File:Line | Notes |
|---|---|---|---|
| `dgWord` | `xvWord` | `deepgram-api.js:176` | Internal to crossValidateTranscripts |
| `unconsumedDg` | `unconsumedXv` | `deepgram-api.js:149` | Internal array |
| `deepgramStart` | `xvalStart` | `deepgram-api.js:201` | In timestampComparison object |
| `deepgramEnd` | `xvalEnd` | `deepgram-api.js:202` | In timestampComparison object |
| `deepgramDurMs` | `xvalDurMs` | `deepgram-api.js:204` | In timestampComparison object |
| `deepgramGap` / `deepgramGapMs` | `xvalGap` / `xvalGapMs` | `deepgram-api.js:238` | In gap comparison |
| `dgPool` | `xvPool` | `app.js:696` | In omission recovery |
| `deepgramResult` | `xvalResult` | `kitchen-sink-merger.js:203,209` | Variable holding allSettled result |
| `deepgramWords` | `xvalWords` | `kitchen-sink-merger.js:237` | Variable passed to crossValidateTranscripts |
| `deepgram` (bare variable) | `xvalRaw` | `kitchen-sink-merger.js:209,237,246,254` | Holds raw cross-validator response |
| `dgWord` | `xvWord` | `app.js:705` | Omission recovery extracted word |
| `dg` (lambda param) | `xv` | `app.js:702` | findIndex callback parameter |
| `dgStart` | `xvStart` | `app.js:727` | Omission recovery insertion position |
| `dgStart` | `xvStart` | `ui.js:183` | Triple timestamp tooltip |
| `dgEnd` | `xvEnd` | `ui.js:184` | Triple timestamp tooltip |
| `deepgramWord` | `xvalWord` | `ui.js:201` | "Deepgram heard" tooltip variable |
| `dgWord` | `xvWord` | `ui.js:816` | Confidence view tooltip variable |

### Return object keys also renamed

These are object keys on the result returned by `kitchen-sink-merger.js` and consumed by `app.js`.

| Old key | New key | File:Line | Notes |
|---|---|---|---|
| `deepgram: deepgramResult` (return key) | `xvalRaw: xvalResult` | `kitchen-sink-merger.js:146` | Fallback success return path |
| `deepgram: deepgram` (return key) | `xvalRaw: xvalRaw` | `kitchen-sink-merger.js:254` | Main Kitchen Sink return path |
| `kitchenSinkResult.deepgram` | `kitchenSinkResult.xvalRaw` | `app.js:213,215,216` | 3 reads of raw cross-validator words |
| `entry.deepgram` | `entry.xval` | `app.js:251,253` | `timestamp_sources` debug stage key |
| `_debug.deepgramAvailable` | `_debug.xvalAvailable` | `kitchen-sink-merger.js:127,150,259` | All 3 return paths have this key |
| `kitchenSinkResult._debug?.deepgramAvailable` | `...xvalAvailable` | `app.js:191` | Consumer of debug flag |

### Things that do NOT get renamed (Deepgram-specific transport)

| Name | File | Why kept |
|---|---|---|
| `sendToDeepgram()` | `deepgram-api.js:67` | IS the Deepgram transport function |
| `isDeepgramAvailable()` | `deepgram-api.js:44` | IS the Deepgram health check |
| `extractWordsFromDeepgram()` | `deepgram-api.js:95` | IS the Deepgram response parser |
| `runDeepgramFallback()` | `kitchen-sink-merger.js:113` | Renamed in Phase B to `runXvalFallback()` |
| `/deepgram` endpoint | `server.py:268` | IS the Deepgram backend proxy |
| `deepgram_configured` | `server.py:126` | IS the Deepgram health flag |
| `DEEPGRAM_API_KEY` | `.env` | IS the Deepgram API key |

### Files modified (in order)

1. **`js/storage.js`** — Add v5→v6 migration renaming `_deepgram*` → `_xval*` on all saved `sttWords`, update `defaultData()` version to 6
2. **`js/deepgram-api.js`** — Rename function, all `_deepgram*` property assignments, add `_xvalEngine: 'deepgram'` to every emitted word, update internal variable names, update diagnostic logging labels
3. **`js/kitchen-sink-merger.js`** — Update import (`crossValidateTranscripts`), call site, `unconsumedDeepgram` → `unconsumedXval`, internal variables, debug metadata key
4. **`js/app.js`** — Update ~12 property reads (`w._deepgramStartTime` → `w._xvalStartTime` etc.), 3 `kitchenSinkResult.deepgram` reads (→ `.xvalRaw`, lines 213-216), 2 `entry.deepgram` keys (→ `entry.xval`, lines 251,253), 1 `deepgramAvailable` read (→ `xvalAvailable`, line 191), stage names, `unconsumedDeepgram` references (lines 227, 451, 692), omission recovery variables (`dgWord`, `dg`, `dgStart`, `dgPool`), ~15 comments mentioning "Deepgram"
5. **`js/ui.js`** — Update property reads, 4 local variables (`dgStart`, `dgEnd`, `deepgramWord`, `dgWord`), 4 hardcoded "Deepgram" tooltip strings (→ dynamic via `_xvalEngine`), make tooltip labels dynamic
6. **`index.html`** — Update legend tooltips ("Deepgram N/A" → "cross-validator N/A"), version timestamp
7. **`js/diagnostics.js`** — Comments only (functional code already uses `crossValidation` which is engine-agnostic)
8. **`js/audio-playback.js`** — Comment only (line 228)
9. **`js/miscue-registry.js`** — Comments/descriptions only (Path 3 descriptions)

### Verification

```bash
# Must return ZERO results (catches ALL deepgram refs except intentionally-kept transport):
grep -rn "deepgram" js/ | grep -vi "sendToDeepgram\|isDeepgramAvailable\|extractWordsFromDeepgram\|blobToBase64\|from.*deepgram-api"

# Also verify specific patterns are gone:
grep -r "_deepgram" js/              # zero
grep -r "crossValidateWithDeepgram" js/  # zero
grep -r "unconsumedDeepgram" js/     # zero

# Saved data migration:
# - Load app with old assessments in localStorage
# - Confirm version updated from 5 to 6
# - Confirm old assessment tooltips still show timestamps (not N/A)
# - Confirm _xvalEngine: 'deepgram' added to migrated words

# Functional: Record NEW audio, run pipeline, confirm:
# - Words have _xvalStartTime, _xvalEndTime, _xvalConfidence, _xvalWord, _xvalEngine
# - Tooltips show "Deepgram" (read from _xvalEngine)
# - Cross-validation statuses work identically
# - Omission recovery works
```

---

## Phase B: Extract Cross-Validation Logic into `js/cross-validator.js`

**Goal:** Separate "what engine to call" from "how to cross-validate". One new file, two modified files. One commit.

### New file: `js/cross-validator.js`

Contains:
- **Toggle logic:** `getCrossValidatorEngine()` / `setCrossValidatorEngine()` — reads/writes `orf_cross_validator` localStorage key
- **Dispatcher:** `sendToCrossValidator(blob)` — switch on engine, calls `sendToDeepgram()` or `sendToParakeet()`
- **Health check:** `isCrossValidatorAvailable()` — delegates to engine-specific check
- **Cross-validation:** `crossValidateTranscripts()` — **moved from deepgram-api.js** (the NW alignment logic, `_normalizeWord`, `XVAL_OPTIONS`, `_parseTs`)
- **Display helper:** `getCrossValidatorName()` — returns "Deepgram" or "Parakeet" for UI

### Slimmed `js/deepgram-api.js` (after extraction)

Retains only the Deepgram-specific transport (~50 lines):
- `blobToBase64()` (private)
- `isDeepgramAvailable()` (exported)
- `sendToDeepgram()` (exported)
- `extractWordsFromDeepgram()` (exported)

Removes: `crossValidateTranscripts`, `_normalizeWord`, `XVAL_OPTIONS`, `_parseTs`, `alignSequences` import, `levenshteinRatio` import.

### Updated `js/kitchen-sink-merger.js`

```javascript
// Before:
import { sendToDeepgram, crossValidateTranscripts } from './deepgram-api.js';

// After:
import { sendToCrossValidator, crossValidateTranscripts } from './cross-validator.js';
```

- `sendToDeepgram(blob)` → `sendToCrossValidator(blob)` (parallel call, line 205)
- `runDeepgramFallback()` → `runXvalFallback()` using `sendToCrossValidator()`
- `source: 'deepgram_fallback'` → `'xval_fallback'` (lines 123, 145 — result-level source identifier)
- `source: 'deepgram'` on words → dynamic engine ID from selected engine (line 140)

### Verification

```bash
# Only cross-validator.js should import from deepgram-api.js:
grep -r "from './deepgram-api.js'" js/

# Functional: Pipeline works identically. Default engine is still 'deepgram'.
```

---

## Phase C: Add Parakeet

**Goal:** One new transport file, one backend endpoint, one UI toggle. One commit.

### New file: `js/parakeet-api.js` (~40 lines)

Mirrors `deepgram-api.js` structure:
```javascript
export async function isParakeetAvailable() {
  // GET /health → check parakeet_configured
}

export async function sendToParakeet(blob) {
  // POST /parakeet with base64 audio, 30s timeout
  // Returns { words: [{word, startTime, endTime, confidence}], transcript, model }
}
```

### Wire into `js/cross-validator.js`

```javascript
import { sendToParakeet, isParakeetAvailable } from './parakeet-api.js';

// In sendToCrossValidator():
case 'parakeet': return sendToParakeet(blob);

// In isCrossValidatorAvailable():
case 'parakeet': return isParakeetAvailable();
```

### Backend: `services/reverb/server.py`

**New endpoint: `POST /parakeet`**
- Same JSON contract as `/deepgram`: `{ words: [...], transcript: "...", model: "parakeet-tdt-0.6b-v2" }`
- Lazy-loads model on first request (avoids 600MB+ memory if unused)
- Shares existing `gpu_lock` with Reverb (serializes GPU access, prevents OOM)
- Word timestamps from TDT native duration prediction
- Confidence: `1.0` for all words (TDT standard output doesn't expose per-word confidence; documented limitation)
- Temp file workflow: decode base64 → write WAV → transcribe → delete

**Update `/health`:**
```python
"parakeet_configured": parakeet_available  # True if nemo importable
```

**Note:** Parakeet requires `nemo_toolkit[asr]` or `sherpa-onnx` in the Python environment. This is a setup step, not a code change. Document in README or setup script.

### Toggle UI in `index.html` (dev-mode-only)

Place after VAD settings, inside existing dev-mode-only panel:

```html
<div class="xval-engine dev-mode-only">
  <label>Cross-Validator Engine</label>
  <div class="xval-engine-options">
    <label><input type="radio" name="xvalEngine" value="deepgram" checked> Deepgram Nova-3</label>
    <label><input type="radio" name="xvalEngine" value="parakeet"> Parakeet TDT 0.6B</label>
  </div>
</div>
```

### Wire toggle in `js/app.js`

```javascript
import { getCrossValidatorEngine, setCrossValidatorEngine } from './cross-validator.js';

// Near VAD settings wiring (~line 1460):
const xvalRadios = document.querySelectorAll('input[name="xvalEngine"]');
// Restore saved selection, persist on change
// Update subtitle dynamically: "Reverb + Deepgram" / "Reverb + Parakeet"
```

### Verification

1. Dev mode OFF → toggle invisible, pipeline uses saved engine (defaults to Deepgram)
2. Dev mode ON → toggle visible, switch to Parakeet
3. Run analysis → words have `_xvalEngine: 'parakeet'`, tooltips say "Parakeet heard: ..."
4. Switch back to Deepgram → everything reverts
5. Reverb offline + Parakeet selected → fallback uses Parakeet-only (not hardcoded Deepgram)
6. `GET /health` → reports both `deepgram_configured` and `parakeet_configured`

---

## Files Summary

| File | Phase A | Phase B | Phase C |
|---|---|---|---|
| `js/storage.js` | **v5→v6 migration** (rename saved `_deepgram*` props) | — | — |
| `js/deepgram-api.js` | Rename properties + function | Remove cross-val logic (moved out) | — |
| `js/cross-validator.js` | — | **CREATE** — toggle + cross-val logic | Add Parakeet dispatch |
| `js/parakeet-api.js` | — | — | **CREATE** — thin transport |
| `js/kitchen-sink-merger.js` | Update imports + property names + variables | Change import source | — |
| `js/app.js` | Update ~12 property reads + 3 return key reads + 2 debug stage keys + 1 debug flag read + stage names + variables + ~15 comments | — | Wire toggle UI |
| `js/ui.js` | Update property reads + 4 local vars + 4 hardcoded tooltip strings → dynamic | — | — |
| `index.html` | Update tooltips + version | — | Add radio toggle HTML |
| `style.css` | — | — | Add toggle CSS |
| `services/reverb/server.py` | — | — | Add `/parakeet` endpoint + health |
| `js/diagnostics.js` | Comments only | — | — |
| `js/audio-playback.js` | Comments only | — | — |
| `js/miscue-registry.js` | Comments only | — | — |

## Key Design Decisions

1. **`_xvalEngine` on every word** — Essential for knowing which engine produced data, especially in saved assessments. One string per word, negligible cost.

2. **`orf_cross_validator` localStorage key** — Follows existing `orf_*` convention (`orf_use_kitchen_sink`, `orf_dev_mode`).

3. **Toggle in dev-mode-only** — Teachers see whatever is selected, only devs can switch. Matches VAD threshold pattern.

4. **Shared GPU lock** — Reverb and Parakeet serialize on same lock. Latency is additive (Reverb finishes, then Parakeet runs). Fine for classroom tool.

5. **Fallback respects toggle** — If Reverb offline and Parakeet selected, fallback uses Parakeet-only (not hardcoded Deepgram).

6. **No code duplication** — The NW alignment logic exists once in `cross-validator.js`. Both engines feed into the same cross-validation function. Adding a third engine is one thin transport file + two switch cases.

7. **Parakeet confidence = 1.0** — TDT standard output doesn't expose per-word confidence. Documented limitation. The cross-validation status (confirmed/disagreed/unconfirmed) matters more than the numeric confidence.

8. **Model lazy-loading** — Parakeet model loads on first `/parakeet` request, not at server startup. Avoids 600MB memory if user never selects Parakeet.
