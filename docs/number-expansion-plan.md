# Decimal Numbers and Comma-Formatted Numbers (Implemented)

## Problem

The number expansion system (`number-words.js` + `mergeNumberExpansions` in `alignment.js`) only handled pure integers 0–9999. Real reading passages contain decimals, comma-formatted numbers, and large numbers that students read aloud correctly but the pipeline marked as errors.

---

## Debug Evidence (from "Women at War" passage)

### "3.3" — Decimal number (3 false errors)

`normalizeText("3.3")` stripped the period → ref became `"33"`.
`numberToWordForms("33")` generated `["thirty", "three"]` — but student said "three point three".

Alignment result:
```
ins(hyp="three")    — hypIndex 47, unconfirmed
ins(hyp="point")    — hypIndex 48, unconfirmed
sub(ref="33", hyp="three") — hypIndex 49, crossValidation="disagreed", _xvalWord="33"
```
**3 false errors** (1 sub + 2 insertions). Student read the number correctly.

### "58,000" — Comma number (3 false errors)

Internal comma survived `normalizeText` → ref stayed `"58,000"`.
`mergeNumberExpansions` regex `/^\d+$/` rejected it (comma failed match).

Alignment result:
```
sub(ref="58,000", hyp="fifty") — hypIndex 57, crossValidation="disagreed", _xvalWord="58,000"
ins(hyp="eight")               — hypIndex 58, unconfirmed
ins(hyp="thousand")            — hypIndex 59, unconfirmed
```
**3 false errors**. Student read "fifty eight thousand" — perfectly correct.

### "7,000" — Comma number (2 false errors)

Same root cause as 58,000. Comma blocked the regex.

Alignment result:
```
sub(ref="7,000", hyp="seven")  — hypIndex 115, crossValidation="disagreed", _xvalWord="7,000"
ins(hyp="thousand")            — hypIndex 116, unconfirmed
```
**2 false errors**. Student read "seven thousand" — correct.

### "$2.5" — Dollar + decimal (in the passage as "$2.5 million")

`normalizeText("$2.5")` → stripped `$` (leading punctuation) → stripped `.` (period strip) → `"25"`.
Student likely said "two point five million". The decimal structure was lost — same issue as "3.3".

### "153,000" — Large comma number (in the passage)

Same root cause as 58,000. Comma blocked regex, number > 9999 was outside range.

---

## Root Causes

| Issue | Root cause | Where |
|-------|-----------|-------|
| Decimals (3.3, 2.5) | `normalizeText` stripped ALL periods unconditionally | text-normalize.js:26 |
| Comma numbers (58,000) | Internal commas survived normalizeText; regex `/^\d+$/` rejected them | text-normalize.js:25, alignment.js:353 |
| Large numbers (>9999) | `numberToWordForms` range capped at 9999 | number-words.js:51 |

---

## Changes Implemented

### Change 1: `js/text-normalize.js` — Preserve decimals, strip commas

**Two additions to the normalization pipeline:**

**A) Comma stripping** (new line, BEFORE period stripping):
```js
.map(w => w.replace(/(\d),(?=\d)/g, '$1'))  // "58,000" → "58000"
```
- Lookahead `/(?=\d)/` handles multiple commas in one pass: "1,000,000" → "1000000"
- Only matches commas BETWEEN digits — "hello, world" unaffected

**B) Decimal preservation** (modified existing period strip):
```js
.map(w => /^\d[\d.]*\d$/.test(w) ? w : w.replace(/\./g, ''))
```
- Preserves periods in number-like tokens: "3.3" → "3.3", "2.5" → "2.5"
- Still strips periods from abbreviations: "i.e." → "ie", "U.S.A." → "usa"
- Pattern: starts and ends with digit, only digits and dots inside

**Token count impact**: Both changes modify content, not count. **No 5-place sync needed.**

### Change 2: `js/number-words.js` — Extend range + decimal support

**A) Extended `numberToWordForms` to 0–999,999:**
- 10,000–999,999 handling: splits into thousands part + remainder
- "58000" → `["fifty", "eight", "thousand"]`
- "153000" → `["one", "hundred", "fifty", "three", "thousand"]` + British "and" variant
- Extracted `addHundredsForms(n, add)` helper for reuse

**B) New function `decimalToWordForms(str)`:**
- "3.3" → `[["three", "point", "three"]]`
- "2.5" → `[["two", "point", "five"]]`
- "3.25" → `[["three", "point", "two", "five"], ["three", "point", "twenty", "five"]]`
- Left side uses `numberToWordForms`, right side generates both digit-by-digit and standard forms

Both functions exposed globally: `window.numberToWordForms`, `window.decimalToWordForms`.

### Change 3: `js/alignment.js` `mergeNumberExpansions()` — Accept decimals

**Expanded ref pattern regex** (both Pattern A and Pattern B):
```js
// Before: /^\d+$/.test(current.ref)
// After:  /^\d+(\.\d+)?$/.test(current.ref)
```

**Route to correct generator:**
```js
const isDecimal = current.ref.includes('.');
const expansions = isDecimal
  ? (window.decimalToWordForms ? window.decimalToWordForms(current.ref) : [])
  : window.numberToWordForms(current.ref);
```

No other changes to the merge logic — Pattern A/B matching works the same regardless of number type.

---

## 5-Place Sync Analysis

Both comma stripping and decimal preservation modify word CONTENT, not word COUNT:
- "58,000" (1 token) → "58000" (1 token)
- "3.3" (1 token) → "3.3" (1 token, preserved)
- "7,000" (1 token) → "7000" (1 token)

**No token count changes → no 5-place sync needed.**

---

## Pipeline Order (unchanged)

```
normalizeText → alignment → compound merge → abbreviation expansion merge
  → NUMBER EXPANSION MERGE → contraction merge → ...
```

The number expansion merge position stays the same. It now handles decimals and larger integers in addition to 0–9999.

---

## Edge Cases

| Input | normalizeText output | Generator | Expected forms |
|-------|---------------------|-----------|---------------|
| "3.3" | "3.3" (preserved) | decimalToWordForms | ["three", "point", "three"] |
| "$2.5" | "2.5" ($ stripped, decimal preserved) | decimalToWordForms | ["two", "point", "five"] |
| "58,000" | "58000" (comma stripped) | numberToWordForms | ["fifty", "eight", "thousand"] |
| "7,000" | "7000" (comma stripped) | numberToWordForms | ["seven", "thousand"] |
| "153,000" | "153000" (comma stripped) | numberToWordForms | ["one", "hundred", "fifty", "three", "thousand"] |
| "65" | "65" (unchanged) | numberToWordForms | ["sixty", "five"] |
| "1,000,000" | "1000000" (commas stripped) | beyond 999,999 — not handled | falls through (acceptable: rare in ORF) |
| "i.e." | "ie" (periods stripped) | N/A | unchanged behavior |
| "U.S.A." | "usa" (periods stripped) | N/A | unchanged behavior |
| "3.3.3" | "3.3.3" (preserved by regex) | fails decimal parse (2+ dots) | falls through as substitution |

---

## Verification Checklist

1. "3.3" + "three point three" → correct (`_numberExpansion: true`)
2. "58,000" + "fifty eight thousand" → correct
3. "7,000" + "seven thousand" → correct
4. "65" + "sixty five" → correct (already works via Pattern A)
5. "$2.5" + "two point five" → correct ($ stripped, decimal preserved)
6. "153,000" + "one hundred fifty three thousand" → correct
7. "i.e." still normalizes to "ie"
8. "U.S.A." still normalizes to "usa"
9. "2014" → "twenty fourteen" still works
10. Existing number equivalences (1-100 in word-equivalences.js) still work
11. Comma in non-number context ("hello, world") unaffected

---

## Deferred

- **ALL-CAPS proper noun detection** (e.g., MASH, NASA): Not implemented. Would require ALL-CAPS heuristic in app.js + dictionary guard bypass. Deferred pending more test cases.
- **Digit-by-digit forms** (e.g., "six five" for "65"): Not implemented. In observed cases, the student misread the number rather than reading digits individually.

---

## Files Modified

| File | Change |
|------|--------|
| `js/text-normalize.js` | Add comma strip + decimal preservation |
| `js/number-words.js` | Extend to 999,999 + `decimalToWordForms` |
| `js/alignment.js` | Decimal regex + routing in `mergeNumberExpansions` |
