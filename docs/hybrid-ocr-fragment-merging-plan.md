# Hybrid OCR Fragment Merging — Implementation Plan

## The Problem

Cloud Vision's paragraph detector sometimes breaks a single sentence into multiple "paragraphs." On the student 1 page, the sentence:

> "But **my favorite** class is phys ed"

gets split into 5 separate Cloud Vision paragraphs:

| # | Cloud Vision "paragraph" |
|---|---|
| A | "78 At school I learn Spanish-Mexico's" |
| B | "my favorite" |
| C | "official language-mathematics," |
| D | "6ageography, and history. But" |
| E | "class is phys ed. when we play football or basketball." |

These are not paragraphs — they're fragments of the same sentence.

## Why the Current Approach Can't Fix This

The current hybrid prompt asks Gemini: "Return ALL fragment numbers in the correct reading order as a JSON array."

Gemini returns a **flat array**: `[..., A, B, C, D, E, ...]`

A flat array can **shuffle** fragments but can't **merge** them. No matter what order Gemini returns A, B, C, D, E — when we join them with newlines, "my favorite" remains an orphaned line between two other orphaned lines. Gemini can reorder paragraphs correctly (left column first, right column second), but when 5 fragments are all in the same area of the page, a 2-word fragment like "my favorite" has no spatial context to pin it precisely. It ends up one position off.

The fundamental issue: **reordering assumes Cloud Vision's paragraph boundaries are correct. They aren't.** "my favorite" isn't a paragraph — it's a fragment of a sentence. You need to merge, not just reorder.

## The Fix: Grouped Fragment Merging

Change the Gemini prompt from "return a flat array" to "return a nested array where inner arrays group fragments that belong together."

### Current (flat — can only reorder)

```
Return ONLY a JSON array of integers, e.g. [3, 1, 5, 2, 4].
```

Gemini returns:
```json
[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
```

Reassembly: each number becomes a line → "my favorite" is its own line.

### New (nested — can reorder AND merge)

```
Return a JSON array of arrays. Each inner array groups fragments that
belong to the same paragraph, in reading order. The outer array is
paragraphs in reading order.
```

Gemini returns:
```json
[[1, 2], [3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15, 16]]
```

Where `[6, 7, 8, 9, 10]` groups fragments A–E together because they're all part of the same paragraph about school subjects.

Reassembly: join fragments **within** each group with spaces, join **groups** with newlines. "my favorite" merges into its parent sentence.

### Why This Works

Gemini does two jobs in one call:

1. **Grouping** — uses reading comprehension to understand that "my favorite" belongs to the sentence "But my favorite class is phys ed." Cloud Vision's spatial algorithm can't do this. Gemini reads the image and understands sentence boundaries.

2. **Ordering** — uses layout understanding to read left column first, right column second. Same as before.

Gemini still only outputs **numbers**. Cloud Vision's character-perfect text is used verbatim. Zero hallucination risk.

## File Changes

### 1. `js/ocr-api.js` — Three modifications

**A. Rename `reorderWithGemini()` → `groupAndReorderWithGemini()`**

Update the function signature and JSDoc to reflect the new behavior.

**B. Update the Gemini prompt**

New prompt:

```
These numbered text fragments were extracted via OCR from a reading
assessment page. The OCR sometimes splits one paragraph into multiple
fragments incorrectly.

Look at the image and:
1. Group fragments that belong to the same paragraph
2. Order fragments correctly within each group
3. Order the groups in reading order (for two-column layouts: left
   column top-to-bottom first, then right column top-to-bottom)

You MUST include every fragment number exactly once. Do not skip any.

Fragments:
[1] We Live in Mexico
[2] by Carlos Somonte
...

Return ONLY a JSON array of arrays, e.g. [[3, 1], [5], [2, 4]].
Each inner array = one paragraph (fragments in reading order).
Outer array = paragraphs in reading order.
```

**C. Update validation**

Current validation checks for a flat array permutation of [1..N].

New validation checks for a **nested** array where:
- Outer array contains only arrays
- Each inner array contains only integers in range [1..N]
- Every number 1..N appears exactly once across all inner arrays
- No duplicates

```javascript
// Validate: nested array, complete permutation of [1..N]
if (!Array.isArray(order) || order.length === 0) {
  throw new Error('Expected non-empty array of arrays');
}

const seen = new Set();
for (const group of order) {
  if (!Array.isArray(group) || group.length === 0) {
    throw new Error('Each group must be a non-empty array');
  }
  for (const n of group) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > maxN) {
      throw new Error(`Invalid fragment number: ${n} (max: ${maxN})`);
    }
    if (seen.has(n)) {
      throw new Error(`Duplicate fragment number: ${n}`);
    }
    seen.add(n);
  }
}
if (seen.size !== maxN) {
  throw new Error(`Expected ${maxN} fragments, got ${seen.size}`);
}
```

**D. Update reassembly in `extractTextHybrid()`**

Current: `order.map(i => paragraphs[i - 1]).join('\n')`

New: join within groups with space, join groups with newline:

```javascript
const mergedText = order
  .map(group => group.map(i => paragraphs[i - 1]).join(' '))
  .join('\n');
```

**E. Update engine info string**

Show group count vs fragment count for visibility:

```javascript
engine: `hybrid (${paragraphs.length} fragments → ${order.length} paragraphs${junkCount ? `, ${junkCount} junk filtered` : ''})`
```

### 2. `index.html` — Version bump only

### 3. No changes to `js/app.js`

The OCR wiring calls `extractTextHybrid()` and displays the engine info. No changes needed.

## Fallback Behavior

If Gemini returns invalid nested array → fall back to Cloud Vision's raw `.text` ordering (same as current fallback).

If Gemini returns a **flat** array (old format) instead of nested → detect it (first element is a number, not an array) → wrap each number in its own array `[n]` → treat as "no merging, just reordering." This provides graceful degradation.

## Expected Result for Student 1

Cloud Vision fragments for the school-subjects area:
```
[8] 78 At school I learn Spanish-Mexico's
[9] my favorite
[10] official language-mathematics,
[11] 6ageography, and history. But
[12] class is phys ed. when we play football or basketball.
```

Gemini groups them: `[..., [8, 10, 11, 9, 12], ...]`

Reassembly: "78 At school I learn Spanish-Mexico's official language-mathematics, 6ageography, and history. But my favorite class is phys ed. when we play football or basketball."

"my favorite" is now part of the sentence, not an orphan line.

## Edge Cases

| Scenario | Behavior |
|---|---|
| Single-column page, no fragmentation | Each inner array has one element. Same as flat reordering. |
| Gemini returns flat array (regression) | Detect (first element is number not array), wrap each in `[n]`. |
| Fragment starts with line number ("78 At school...") | Still present — line numbers embedded in paragraph text are a Cloud Vision character issue, not an ordering issue. Teacher fixes in textarea. |
| Very short passage (1-2 paragraphs) | Skip Gemini entirely (existing behavior). |
| Gemini groups incorrectly | Text is wrong but complete — teacher can edit in textarea. No worse than current. |

## Verification

1. Upload student 1 image with Hybrid toggle ON
2. Confirm "my favorite" appears WITHIN a sentence, not on its own line
3. Confirm passage reads: "...history. But my favorite class is phys ed..."
4. Confirm column ordering still correct (left column first, right column second)
5. Status shows `hybrid (N fragments → M paragraphs, K junk filtered)`
6. Toggle OFF → Cloud Vision only still works
7. Test with a clean single-column page to verify no regression
