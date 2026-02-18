# Testing Patterns

**Analysis Date:** 2026-02-18

## Test Framework

**Runner:** None detected.

No `jest.config.*`, `vitest.config.*`, `mocha`, or any test runner configuration file exists in the project root or any subdirectory.

**Assertion Library:** None.

**Test Files:** None found. No `*.test.js`, `*.spec.js`, `__tests__/` directories, or equivalent exist anywhere in the codebase.

**Run Commands:** No test commands defined. `package.json` is not present — project has no npm scripts.

## Test File Organization

No test files exist. The project has no testing infrastructure.

## How the Codebase Is Verified Today

In the absence of automated tests, correctness is validated through these mechanisms:

**1. Debug Logger (`js/debug-logger.js`):**
- Every pipeline run produces a structured JSON log downloadable as `orf-debug-TIMESTAMP.json`
- Log includes all pipeline stages, warnings, and errors with timestamps
- `addStage(name, data)` called at each significant pipeline step in `js/app.js`
- Used for manual post-hoc inspection of pipeline behavior

**2. The 6-Column Alignment Table (UI step 1):**
- `js/ui.js` renders a `# / Ref / V1 / V0 / Parakeet / Verdict` table after every assessment
- This is a manual verification tool — teachers and developers can visually inspect each word's alignment decisions
- Color-coded engine outputs make per-word disagreements immediately visible

**3. Miscue Registry (`js/miscue-registry.js`):**
- Acts as a specification document for what each detector is supposed to do
- Includes `example` field per miscue type showing expected input → output
- No executable examples — documentation only

**4. `Calibration tests/` Directory:**
- A directory named `Calibration tests` exists at the project root
- Contents not explored (audio/assessment data for manual regression testing)

**5. PLAN.md / docs/ design documents:**
- Architecture decisions recorded in `docs/` and `PLAN.md` (not automated tests)
- Used for design review, not automated verification

## Critical Untested Areas

Every module in `js/` is untested by automated tooling. The highest-risk areas are:

**`js/alignment.js`** — Needleman-Wunsch with graded substitution, compound merge, spillover consolidation. No unit tests for edge cases in DP traceback or compound-word patterns.

**`js/text-normalize.js`** — Hyphen-split logic used in 5 synchronized places. Any drift between the 5 consumers is not caught automatically. High regression risk.

**`js/diagnostics.js`** — 2115-line module with 20+ exported functions. Near-miss resolution, struggle detection, word speed tiers — all manually verified only.

**`js/metrics.js`** — WCPM and accuracy formulas. Edge cases (all omissions, zero elapsed time, forgiven substitutions) have no regression tests.

**`js/storage.js`** — Migration chain (v1→v6). Each migration step is straightforward but untested; a missed field rename could silently corrupt stored assessments.

## Adding Tests (Guidance for Future Work)

The modules are ES modules (`export function ...`) and contain no browser-specific code in the algorithmic core. They are testable with any ES module-compatible test runner (Vitest recommended for zero-config ESM support).

**High-value test targets (in priority order):**

1. `js/text-normalize.js` — `normalizeText()`, `splitHyphenParts()`: Pure functions with well-defined inputs and outputs. Cover hyphen edge cases, OCR line-break merge, single-letter prefix join.

2. `js/alignment.js` — `alignWords()`: Pure function. Cover: exact match, substitution, omission, insertion, compound merge (Pattern A + B), reversed compound, spillover consolidation.

3. `js/metrics.js` — `computeWCPM()`, `computeAccuracy()`: Pure functions. Cover: zero elapsed time, all correct, all omitted, forgiven subs, `_notAttempted` exclusion.

4. `js/diagnostics.js` — `isNearMiss()`, `getPunctuationPositions()`, `parseTime()`: These are pure and small enough to test in isolation before tackling the larger orchestrators.

**Example test structure (Vitest):**
```javascript
// text-normalize.test.js
import { describe, it, expect } from 'vitest';
import { normalizeText, splitHyphenParts } from '../js/text-normalize.js';

describe('normalizeText', () => {
  it('joins single-letter hyphen prefix', () => {
    expect(normalizeText('e-mail')).toEqual(['email']);
  });
  it('splits multi-letter hyphen compound', () => {
    expect(normalizeText('soft-on-skin')).toEqual(['soft', 'on', 'skin']);
  });
  it('merges trailing-hyphen OCR line breaks', () => {
    expect(normalizeText('spread- sheet')).toEqual(['spreadsheet']);
  });
});

describe('splitHyphenParts', () => {
  it('returns null for words without hyphens', () => {
    expect(splitHyphenParts('hello')).toBeNull();
  });
  it('returns join for single-letter prefix', () => {
    expect(splitHyphenParts('e-mail')).toEqual({ type: 'join', parts: ['e', 'mail'] });
  });
  it('returns split for multi-letter prefix', () => {
    expect(splitHyphenParts('soft-spoken')).toEqual({ type: 'split', parts: ['soft', 'spoken'] });
  });
});
```

**Recommended setup:**
```bash
npm init -y
npm install --save-dev vitest
# vitest.config.js: { test: { environment: 'jsdom' } }  # only if needed for DOM
npx vitest run
```

## Mocking

No mocking infrastructure exists. If tests were added:

**What to Mock:**
- `fetch` calls in API modules (`js/reverb-api.js`, `js/parakeet-api.js`, `js/deepgram-api.js`, `js/ocr-api.js`)
- `localStorage` in `js/storage.js`, `js/cross-validator.js`, `js/kitchen-sink-merger.js`
- `FileReader` in `blobToBase64()` helpers

**What NOT to Mock:**
- `js/alignment.js`, `js/text-normalize.js`, `js/metrics.js`, `js/diagnostics.js` — pure computation, no mocking needed

## Coverage

**Requirements:** None enforced.

**Current coverage:** 0% automated.

---

*Testing analysis: 2026-02-18*
