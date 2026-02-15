# Hybrid OCR Reorder — Implementation Plan

## Problem

Google Cloud Vision's `DOCUMENT_TEXT_DETECTION` returns paragraphs in wrong order for multi-column reading assessment pages. The specific failure: "my favorite" gets ripped from "But my favorite class is phys ed" and placed elsewhere, because Cloud Vision creates it as a separate paragraph with incorrect spatial metadata.

Three prior heuristic attempts (spatial sorting by bounding box) all failed and were reverted. Pure Gemini OCR was tried but hallucinated ("chool", "Shbasketball", mangled drop caps).

## Solution: Hybrid with Pre-filtering + Forced Complete Permutation

Cloud Vision extracts text (excellent character accuracy). Gemini reorders paragraphs (understands layout from image). Gemini never generates passage text — it only returns paragraph numbers.

### Current State (what's broken)

The current hybrid prompt tells Gemini: "EXCLUDE any fragments that are clearly line numbers, page numbers, comprehension questions, answer choices, or margin annotations."

This gives Gemini permission to drop fragments. Gemini dropped "my favorite" (a 2-word fragment that looked like junk). Result: "But class is phys ed" — missing "my favorite".

### Fix: Two Changes

**Change 1 — Pre-filter junk before numbering (our code, not Gemini)**

Before sending paragraphs to Gemini, filter out obvious non-passage paragraphs ourselves. A paragraph is junk if its entire text (after stripping whitespace) contains NO letters:

```javascript
function isJunkParagraph(text) {
  return !/[a-zA-Z]/.test(text);
}
```

This catches:
- Pure digit line numbers: "78", "29", "117" → no letters → filtered
- Page numbers: "12", "52" → no letters → filtered
- Stray punctuation: ">", ")", "✓" → no letters → filtered

This does NOT catch (correctly kept):
- "my favorite" → has letters → kept
- "8 A.M. to 2 P.M." → has letters → kept
- "3 km ( 2 miles )" → has letters → kept
- Any passage text with inline numbers → has letters → kept

**Change 2 — Force Gemini to return a complete permutation**

Change the Gemini prompt to require ALL fragments in the response. Remove the "EXCLUDE" instruction entirely. Validate that the response is a complete permutation of [1..N] — every number appears exactly once.

New prompt:
```
These numbered text fragments were extracted via OCR from a reading
assessment page. They may be in the wrong order.

Look at the image and return ALL fragment numbers in the correct
reading order as a JSON array. For two-column layouts, read the left
column top-to-bottom first, then the right column top-to-bottom.

You MUST include every fragment number exactly once.

Fragments:
[1] We Live in Mexico
[2] by Carlos Somonte
[3] A young boy describes growing up in a small...
[4] My father taught me to swim when I was two...
...
[N] and other fish in the river where it's safe.

Return ONLY a JSON array like [3, 1, 5, 2, 4].
```

New validation:
```javascript
// Must be a complete permutation — every number 1..N exactly once
if (order.length !== paragraphs.length) {
  throw new Error(`Expected ${paragraphs.length} numbers, got ${order.length}`);
}
```

### Why This Fixes "my favorite"

1. Cloud Vision extracts paragraphs. "my favorite" is its own paragraph.
2. `isJunkParagraph("my favorite")` → has letters → **kept**.
3. "my favorite" is numbered, say [7].
4. Gemini MUST return [7] in the ordering (complete permutation required).
5. Gemini looks at the image, sees "my favorite" between "But" and "class is phys ed".
6. Gemini places [7] between those fragments.
7. Reassembled text: "...history. But\nmy favorite\nclass is phys ed..." — correct.

## File Changes

### 1. `js/ocr-api.js` — Three modifications

**A. Add `isJunkParagraph()` function**

```javascript
/**
 * A paragraph is junk if it contains no letters (pure digits, punctuation, symbols).
 * Line numbers (78, 117), page numbers (12, 52), stray marks (>, ), ✓) are all junk.
 * Passage text always has letters, even with inline numbers ("8 A.M.", "3 km").
 */
function isJunkParagraph(text) {
  return !/[a-zA-Z]/.test(text);
}
```

**B. Apply pre-filter in `extractTextHybrid()` before numbering**

After `extractParagraphs(annotation)`, filter:

```javascript
const allParagraphs = extractParagraphs(annotation);
const paragraphs = allParagraphs.filter(text => !isJunkParagraph(text));
const filtered = allParagraphs.length - paragraphs.length;
```

Include `filtered` count in the engine info string for visibility.

**C. Update `reorderWithGemini()` prompt + validation**

Remove the "EXCLUDE" instruction. Add "You MUST include every fragment number exactly once."

Change validation from allowing subsets to requiring complete permutation:

```javascript
if (order.length !== paragraphs.length) {
  throw new Error(`Expected ${paragraphs.length} numbers, got ${order.length}`);
}
```

### 2. `index.html` — Version bump only

Update version timestamp.

### 3. No changes to `js/app.js`

The OCR wiring already calls `extractTextHybrid()` and displays the engine info. No changes needed.

## Edge Cases

| Scenario | Behavior |
|---|---|
| Single-column page | Cloud Vision returns paragraphs in correct order. Gemini confirms the order. No harm. |
| Page with no margin junk | Pre-filter removes nothing. All paragraphs numbered. Gemini returns complete permutation. |
| Gemini returns wrong order | Text is wrong but complete — teacher can see and fix in textarea. No worse than Cloud Vision alone. |
| Gemini fails (429, blocked) | Falls back to Cloud Vision's raw `.text` ordering. Existing behavior. |
| Gemini returns incomplete array | Validation fails → falls back to Cloud Vision ordering. |
| Passage with standalone number as a sentence | e.g., "The answer is 42." — "42" would be part of a larger paragraph, not standalone. Safe. |
| Passage titled with just a number | Unusual. Would be filtered. Acceptable loss — teacher fixes in textarea. |

## Verification

1. Upload `student 1.jpg` with hybrid toggle ON
2. Confirm "my favorite" appears between "But" and "class is phys ed" in the output
3. Confirm line numbers (78, 29) are NOT in the output
4. Confirm page number (12) is NOT in the output — unless Cloud Vision groups it with the title
5. Confirm stray punctuation (>, )) is NOT in the output
6. Status bar shows `hybrid (vision + gemini, X paragraphs, Y filtered → X-Y reordered)`
7. Toggle OFF → confirm Cloud Vision only mode still works
8. Test with a clean (no scribbles) page to verify ordering fix is layout-dependent, not scribble-dependent
