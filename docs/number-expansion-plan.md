# Plan: Decimal Numbers, Comma-Formatted Numbers, and ALL-CAPS Proper Nouns

## Problem

The number expansion system (`number-words.js` + `mergeNumberExpansions` in `alignment.js`) only handles pure integers 0–9999. Real reading passages contain decimals, comma-formatted numbers, and large numbers that students read aloud correctly but the pipeline marks as errors.

Additionally, ALL-CAPS words like "MASH" need proper noun treatment but the current proper noun detection relies solely on the NL API — it has no ALL-CAPS heuristic.

---

## Debug Evidence (from "Women at War" passage)

### "3.3" — Decimal number (3 false errors)

`normalizeText("3.3")` strips the period → ref becomes `"33"`.
`numberToWordForms("33")` generates `["thirty", "three"]` — but student said "three point three".

Alignment result:
```
ins(hyp="three")    — hypIndex 47, unconfirmed
ins(hyp="point")    — hypIndex 48, unconfirmed
sub(ref="33", hyp="three") — hypIndex 49, crossValidation="disagreed", _xvalWord="33"
```
**3 false errors** (1 sub + 2 insertions). Student read the number correctly.

### "58,000" — Comma number (3 false errors)

Internal comma survives `normalizeText` → ref stays `"58,000"`.
`mergeNumberExpansions` regex `/^\d+$/` rejects it (comma fails match).

Alignment result:
```
sub(ref="58,000", hyp="fifty") — hypIndex 57, crossValidation="disagreed", _xvalWord="58,000"
ins(hyp="eight")               — hypIndex 58, unconfirmed
ins(hyp="thousand")            — hypIndex 59, unconfirmed
```
**3 false errors**. Student read "fifty eight thousand" — perfectly correct.

### "7,000" — Comma number (2 false errors)

Same root cause as 58,000. Comma blocks the regex.

Alignment result:
```
sub(ref="7,000", hyp="seven")  — hypIndex 115, crossValidation="disagreed", _xvalWord="7,000"
ins(hyp="thousand")            — hypIndex 116, unconfirmed
```
**2 false errors**. Student read "seven thousand" — correct.

### "65" — Integer (already partially handled)

`numberToWordForms("65")` generates `["sixty", "five"]`.
`mergeNumberExpansions` Pattern A would match if hyp="sixty" + ins("five").

Actual alignment:
```
sub(ref="65", hyp="five") — hypIndex 105, crossValidation="disagreed", _xvalWord="65"
```
Student appears to have said just "five" (or "six... five" digit-by-digit with "six" absorbed elsewhere). The existing system would handle "sixty five" correctly via Pattern A, but NOT "six five" (digit-by-digit) — `numberToWordForms("65")` doesn't generate `["six", "five"]`.

### "$2.5" — Dollar + decimal (in the passage as "$2.5 million")

`normalizeText("$2.5")` → strips `$` (leading punctuation) → strips `.` (period strip) → `"25"`.
Student likely said "two point five million". The decimal structure is lost — same issue as "3.3".

### "153,000" — Large comma number (in the passage)

Same root cause as 58,000. Comma blocks regex, number > 9999 outside range.

### "MASH" — ALL-CAPS acronym (confirmed substitution, no forgiveness)

All three engines confirmed: student said "matched" for "mash".
```
sub(ref="mash", hyp="matched") — crossValidation="confirmed"
  _xvalWord="matched", _v0Word="matched"
  bucket="definite-struggle"
  _isOOV=false (mash IS in CMUdict)
  _syllableCoverage: 0/1 syllables
```

**Not detected as proper noun** — NL API didn't tag "mash" as proper.
`levenshteinRatio("mash", "matched")` = 1 - 3/7 ≈ 0.57, which IS ≥ 0.4 threshold.
If MASH were treated as a proper noun, it would be **forgiven** through the existing proper noun forgiveness path.

---

## Root Causes

| Issue | Root cause | Where |
|-------|-----------|-------|
| Decimals (3.3, 2.5) | `normalizeText` strips ALL periods unconditionally | text-normalize.js:26 |
| Comma numbers (58,000) | Internal commas survive normalizeText; regex `/^\d+$/` rejects them | text-normalize.js:25, alignment.js:353 |
| Large numbers (>9999) | `numberToWordForms` range capped at 9999 | number-words.js:51 |
| Digit-by-digit (six five) | `numberToWordForms` only generates natural English forms | number-words.js:66-69 |
| ALL-CAPS proper nouns | No ALL-CAPS heuristic; relies solely on NL API `isProperNoun` | app.js:1684 |

---

## Changes

### Change 1: `js/text-normalize.js` — Preserve decimals, strip commas

**Line 26 area — two additions:**

**A) Comma stripping** (new line, BEFORE period stripping):
```js
.map(w => w.replace(/(\d),(\d)/g, '$1$2'))  // "58,000" → "58000"
```
- Global `/g` handles multiple commas: "1,000,000" → "1000000"
- Only matches commas BETWEEN digits — "hello, world" unaffected
- Repeat the replace for back-to-back groups: `"1,000,000"` → first pass `"1000,000"` → need to loop or use a while. Actually: `/(\d),(?=\d)/g` with replace `'$1'` works in one pass since the lookahead doesn't consume. Or simpler: just do two passes of the same replace.

**B) Decimal preservation** (modify existing period strip on line 26):
```js
// Before:
.map(w => w.replace(/\./g, ''))
// After:
.map(w => /^\d[\d.]*\d$/.test(w) || /^\d$/.test(w) ? w : w.replace(/\./g, ''))
```
- Preserves periods in number-like tokens: "3.3" → "3.3", "2.5" → "2.5"
- Still strips periods from abbreviations: "i.e." → "ie", "U.S.A." → "usa"
- Pattern: starts and ends with digit, only digits and dots inside
- Single digits pass through unchanged (already do)

**Token count impact**: Both changes modify content, not count. **No 5-place sync needed.**

### Change 2: `js/number-words.js` — Extend range + decimal support

**A) Extend `numberToWordForms` to 0–999,999:**

Change range guard (line 51):
```js
// Before: if (isNaN(n) || n < 0 || n > 9999) return [];
// After:  if (isNaN(n) || n < 0 || n > 999999) return [];
```

Add 10,000–999,999 handling after existing thousands block:
- `n >= 10000`: split into thousands part + remainder
- "58000" → `["fifty", "eight", "thousand"]`
- "58000" with remainder: "58500" → `["fifty", "eight", "thousand", "five", "hundred"]`
- "153000" → `["one", "hundred", "fifty", "three", "thousand"]` + British "and" variant
- "100000" → `["one", "hundred", "thousand"]` / `["a", "hundred", "thousand"]`

**B) Add digit-by-digit forms for 2-digit numbers:**

In the `n < 100` branch (line 68), add:
```js
// Digit-by-digit: "65" → ["six", "five"]
if (n >= 10 && n <= 99) {
  const d1 = Math.floor(n / 10);
  const d2 = n % 10;
  if (d2 > 0) add([ONES[d1], ONES[d2]]);
}
```
- Only for 10-99 where second digit is non-zero
- "65" → also generates `["six", "five"]` alongside `["sixty", "five"]`
- Covers case where student reads digits individually

**C) New function `decimalToWordForms(str)`:**

```js
function decimalToWordForms(str) {
  const [leftStr, rightStr] = str.split('.');
  if (!leftStr || !rightStr) return [];

  const leftN = parseInt(leftStr, 10);
  const forms = new Set();

  // Left side: standard number words
  const leftForms = leftN === 0 ? [['zero']] : numberToWordForms(leftStr);
  if (leftForms.length === 0 && leftN !== 0) return [];

  // Right side options:
  // 1) Digit-by-digit: "25" → "two five"
  const digitByDigit = rightStr.split('').map(d => ONES[parseInt(d, 10)] || 'zero');
  // 2) Standard: "25" → "twenty five" (only if > 1 digit)
  const rightN = parseInt(rightStr, 10);
  const standardForms = rightStr.length > 1 ? numberToWordForms(rightStr) : [];

  for (const left of leftForms.length ? leftForms : [[]]) {
    // "three point three"
    forms.add(JSON.stringify([...left, 'point', ...digitByDigit]));
    // "three point twenty five" (for multi-digit decimals)
    for (const right of standardForms) {
      forms.add(JSON.stringify([...left, 'point', ...right]));
    }
  }

  return Array.from(forms).map(s => JSON.parse(s));
}
window.decimalToWordForms = decimalToWordForms;
```

Examples:
- "3.3" → `[["three", "point", "three"]]`
- "2.5" → `[["two", "point", "five"]]`
- "3.25" → `[["three", "point", "two", "five"], ["three", "point", "twenty", "five"]]`

### Change 3: `js/alignment.js` `mergeNumberExpansions()` — Accept decimals + stripped commas

**Expand ref pattern regex** (lines 353 and 412):
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

Apply to both Pattern A (line 353-399) and Pattern B (line 411-465).

No other changes to the merge logic — the Pattern A/B matching (sub + insertions) works the same regardless of number type.

### Change 4: `js/app.js` — ALL-CAPS proper noun detection

**Location**: NL annotation mapping section (~line 1684)

Currently:
```js
let isProperViaNL = entry.nl && entry.nl.isProperNoun;
```

Add ALL-CAPS heuristic after the NL check:
```js
let isProperViaNL = entry.nl && entry.nl.isProperNoun;

// ALL-CAPS words (2+ letters) are acronyms/proper nouns in reading passages
if (!isProperViaNL && entry._displayRef) {
  const raw = entry._displayRef;
  if (raw.length >= 2 && raw === raw.toUpperCase() && /^[A-Z]+$/.test(raw)) {
    isProperViaNL = true;
    entry._allCapsProperNoun = true;
  }
}
```

**Guard design:**
- Minimum 2 letters (skips "A", "I")
- Must be ALL uppercase letters (no digits, no punctuation)
- `_displayRef` has the original casing from the reference text
- `_allCapsProperNoun` flag for debugging/UI

**Dictionary guard**: ALL-CAPS words should **skip** the dictionary guard. Rationale: "MASH" is both a common word AND an acronym. In a reading passage, ALL-CAPS is a deliberate typographic choice — the author intended it as an acronym/proper noun. The dictionary guard (which checks if the lowercase form is a common word) would incorrectly block forgiveness for words like MASH, NASA, AIDS, STEM.

```js
// Skip dictionary guard for ALL-CAPS acronyms
if (isProperViaNL && !entry._allCapsProperNoun) {
  isDictionaryCommon = await isCommonDictionaryWord(entry.ref);
  if (isDictionaryCommon) {
    isProperViaNL = false;
  }
}
```

**Impact for MASH**: `levenshteinRatio("mash", "matched")` ≈ 0.57 ≥ 0.4 → forgiven. The student's attempt "matched" is close enough to "mash" — she likely tried to read "MASH" and the engines heard "matched".

### Change 5: `js/miscue-registry.js`

No new miscue types needed. Number expansion is a recognition feature, not a miscue type. Proper noun forgiveness already exists in the registry (`properNounForgiveness`).

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
| "65" | "65" (unchanged) | numberToWordForms | ["sixty", "five"], ["six", "five"] |
| "1,000,000" | "1000000" (commas stripped) | beyond 999,999 — not handled | falls through (acceptable: rare in ORF) |
| "i.e." | "ie" (periods stripped) | N/A | unchanged behavior |
| "U.S.A." | "usa" (periods stripped) | N/A | unchanged behavior |
| "3.3.3" | "3.3.3" (preserved by regex) | fails decimal parse (2+ dots) | falls through as substitution |
| "MASH" | "mash" (lowercased) | N/A | proper noun forgiveness via ALL-CAPS |
| "NASA" | "nasa" (lowercased) | N/A | proper noun forgiveness via ALL-CAPS |

---

## Verification Checklist

1. "3.3" + "three point three" → correct (`_numberExpansion: true`)
2. "58,000" + "fifty eight thousand" → correct
3. "7,000" + "seven thousand" → correct
4. "65" + "sixty five" → correct (already works via Pattern A)
5. "65" + "six five" → correct (new digit-by-digit form)
6. "$2.5" + "two point five" → correct ($ stripped, decimal preserved)
7. "153,000" + "one hundred fifty three thousand" → correct
8. "i.e." still normalizes to "ie"
9. "U.S.A." still normalizes to "usa"
10. "2014" → "twenty fourteen" still works
11. "MASH" + student says "matched" → proper noun forgiven (ratio 0.57 ≥ 0.4)
12. "A" and "I" (single-letter ALL-CAPS) → NOT treated as acronym proper nouns
13. Existing number equivalences (1-100 in word-equivalences.js) still work
14. Comma in non-number context ("hello, world") unaffected

---

## Files Modified

| File | Change | Lines affected |
|------|--------|---------------|
| `js/text-normalize.js` | Add comma strip + decimal preservation | ~line 26 (2 new lines) |
| `js/number-words.js` | Extend to 999,999 + digit-by-digit + `decimalToWordForms` | ~lines 51, 68, new function |
| `js/alignment.js` | Decimal regex + routing in `mergeNumberExpansions` | lines 353, 412 |
| `js/app.js` | ALL-CAPS proper noun heuristic + skip dictionary guard | ~line 1684 |
