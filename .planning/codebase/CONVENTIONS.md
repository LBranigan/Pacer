# Coding Conventions

**Analysis Date:** 2026-02-18

## Naming Patterns

**Files:**
- kebab-case for all JS modules: `text-normalize.js`, `kitchen-sink-merger.js`, `cross-validator.js`
- kebab-case for HTML pages: `rhythm-remix.html`, `orf_assessment.html` (legacy underscore in a few older files)
- kebab-case for CSS: `rhythm-remix.css`, `style.css`

**Functions:**
- camelCase for all exported and internal functions: `normalizeText()`, `alignWords()`, `computeWCPM()`
- Verb-noun pattern for action functions: `computeWCPM`, `detectStruggleWords`, `buildHypToRefMap`, `parseTime`
- Boolean-returning functions use `is` prefix: `isNearMiss()`, `isKitchenSinkEnabled()`, `isParakeetAvailable()`
- Async API-calling functions use `send` prefix: `sendToParakeet()`, `sendToReverb()`, `sendToCrossValidator()`

**Variables:**
- camelCase for local variables: `refWords`, `hypWords`, `insertionsConsumed`
- SCREAMING_SNAKE_CASE for module-level constants: `PHONEME_FLOOR`, `GAP_PENALTY`, `FILLER_WORDS`, `ENGINE_KEY`
- Single-letter loop variables: `i`, `j`, `m`, `n`, `k` (standard for DP matrices and tight loops)
- Private module state uses underscore prefix: `_phonemeCounts`, `_loadPromise`, `_tooltipEl`, `_highlightedSpans`
- Internal (non-exported) private metadata on objects uses underscore prefix: `_isStruggle`, `_notAttempted`, `_pkTrustOverride`, `_confirmedInsertion`, `_xvalWord`, `_reverbStartTime`

**Types/Classes:**
- PascalCase for class names: `LoFiEngine` (in `js/lofi-engine.js`)
- Object keys stay camelCase: `{ startTime, endTime, crossValidation }`

**Constants:**
- Module-level config constants: SCREAMING_SNAKE_CASE at top of file
- Named sets use plural + `_SET` or descriptive name: `DISFLUENCIES`, `SIGHT_WORDS`, `FUNCTION_POS`, `PROPER_ENTITY_TYPES`

## Code Style

**Formatting:**
- No Prettier/ESLint config detected — style is enforced by convention only
- 2-space indentation throughout all JS files
- Single quotes for strings in most files; template literals for interpolation
- Trailing commas in multi-line array/object literals
- Arrow functions for short callbacks; `function` keyword for named functions
- Semicolons required

**Linting:**
- No lint tooling configured. Consistency maintained manually.

## Import Organization

**Order (observed pattern):**
1. Relative module imports grouped by functional area
2. No third-party npm imports — all dependencies are browser-native or CDN-loaded in HTML

**Path style:**
- Always relative: `import { foo } from './bar.js'`
- Always includes `.js` extension (required for ES modules in browser)
- No path aliases; direct relative paths only

**Named exports only:**
- No default exports observed — all exports are named: `export function foo()`, `export const BAR`
- Imports always use named destructuring: `import { foo, bar } from './module.js'`

## Error Handling

**Strategy:** Graceful degradation over throwing errors to the user.

**Patterns:**
- API calls return `null` on failure (never throw to caller): `sendToParakeet()` returns `null` if unavailable
- Availability checks before use: `isParakeetAvailable()` called before `sendToParakeet()`
- `try/catch` used at API boundaries with `console.warn` or `console.error` logging:
```javascript
try {
  const resp = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(3000) });
  if (!resp.ok) return false;
  const data = await resp.json();
  return data.parakeet_configured === true;
} catch {
  return false;
}
```
- Guard clauses at function entry: `if (!text || typeof text !== 'string') return [];`
- Null-safe chaining: `sw._reverbStartTime || sw.startTime`
- Empty array/object returns for "no data" cases: `return []`, `return {}`

**Debug logging:**
- All pipeline stages log via `debug-logger.js` (`js/debug-logger.js`): `addStage()`, `addWarning()`, `addError()`
- Internal `console.log` tagged with module prefix: `console.log('[phoneme-counter] ...')`, `console.log('[ORF] ...')`
- Structured debug JSON saved to downloadable file via `saveDebugLog()` — not thrown to UI

## Logging

**Framework:** `debug-logger.js` module for structured pipeline logging; `console.*` for lightweight module-level messages.

**Patterns:**
- Pipeline stages: `addStage('stageName', { data })` — serialized via `JSON.parse(JSON.stringify(data))` (deep clone)
- Warnings: `addWarning(message, data)` — also echoes to `console.warn`
- Errors: `addError(message, data)` — also echoes to `console.error`
- Module init: `console.log('[module-name] description', value)` at load time
- All `console.log` calls in app logic use `[ORF]` prefix: `console.log('[ORF] Code version:', CODE_VERSION)`

## Comments

**When to Comment:**
- Every exported function gets a JSDoc block with `@param` and `@returns`
- Non-obvious algorithms get inline explanation (e.g., NW traceback, spillover consolidation)
- Section dividers use Unicode box-drawing: `// ── Section Name ──────────────────────`
- Module-level file header is either a `/** ... */` JSDoc block or a `// filename.js — description` one-liner
- Inline comments explain "why" not "what": `// Prefer diagonal for ties (minimizes gaps)`
- Data shape assumptions documented where they'd surprise a reader

**JSDoc usage:**
- Present on all exported public-API functions
- Pattern: description paragraph, then `@param {Type} name - description`, then `@returns {Type} description`
- Types use JSDoc inline notation: `{string}`, `{number}`, `{Array<{type: string}>}`, `{Promise<boolean>}`

## Function Design

**Size:** Functions range from 5–100 lines. Large algorithmic functions (NW fill, diagnostics orchestrator) can reach 200+ lines with clear internal section comments.

**Parameters:**
- Positional parameters for primary data; optional config as last `options = {}` argument
- Example: `computeAccuracy(alignmentResult, options = {})`
- Long parameter lists avoided — prefer passing the canonical data structures (alignment array, transcriptWords array)

**Return Values:**
- Pure computation functions return plain objects: `{ wcpm, correctCount, elapsedSeconds }`
- Boolean-returning predicates used for checks
- Functions that can fail return `null` (not throws): `getPhonemeCount()` returns `null` if not in CMUdict

## Module Design

**Exports:**
- Each module exports only its public API (named exports)
- Internal helpers are non-exported `function` declarations
- Module-level mutable state is module-private (no export): `let _phonemeCounts = null`

**Barrel Files:**
- No barrel/index files. Consumers import directly from the module that owns the function.

## Data Object Conventions

**Alignment entry shape:**
```javascript
{
  ref: string | null,      // normalized reference word (null for insertions)
  hyp: string | null,      // normalized hypothesis word (null for omissions)
  type: 'correct' | 'substitution' | 'omission' | 'insertion',
  hypIndex: number,        // index into original transcriptWords array
  // Optional flags (underscore prefix = internal metadata):
  _isStruggle: true,       // compound struggle
  _notAttempted: true,     // post-reading, excluded from scoring
  _pkTrustOverride: true,  // Parakeet correctness override applied
  forgiven: true,          // word counted as correct despite mismatch
  compound: true,          // ASR-split compound word
  parts: string[]          // compound word fragments
}
```

**Spread-and-override for object extension:**
```javascript
result.push({
  ref: current.ref,
  hyp: combined,
  type: 'correct',
  compound: true,
  hypIndex: current.hypIndex,
  parts: [...],
  ...(isAbbrExpansion && { _abbreviationExpansion: true })
});
```

## Version Management

- `js/app.js` top of file: `const CODE_VERSION = 'v39-2026-02-07'`
- `index.html` `#version` element updated on every change: `v YYYY-MM-DD HH:MM`
- Cache-busting query strings on all module imports: `import './module.js?v=...'`

---

*Convention analysis: 2026-02-18*
