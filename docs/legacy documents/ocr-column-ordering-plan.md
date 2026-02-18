# OCR Column Ordering Problem

## The Problem

Google Cloud Vision's `DOCUMENT_TEXT_DETECTION` returns `fullTextAnnotation.text` — a flat string where Google concatenates all detected text in its internal order. For multi-column layouts (common in reading assessment booklets), this order can be wrong.

**Concrete example** — the right column of a two-column page contains:

```
geography, and history. But my favorite
class is phys ed, when we play football or
```

But the OCR returns:

```
At school I learn Spanish-Mexico's
my favorite
official language-mathematics,
geography, and history. But
class is phys ed.
```

"my favorite" was ripped from the end of the line "But my favorite" and placed several lines earlier. The sentence "But my favorite class is phys ed" is broken across two non-adjacent locations in the output.

This is NOT a cross-column issue (left vs right column). It's a **within-column paragraph ordering** issue — Google Vision creates "my favorite" as a separate paragraph with a bounding box position that doesn't match its visual position, then concatenates paragraphs in the wrong order.

The page layout that triggers this:
- Title + subtitle spanning full page width
- Two text columns for the passage body (~45% width each)
- Right margin with comprehension questions, checkboxes, form fields
- Margin annotations (line numbers like "78", "117")

## What We Tried

### Attempt 1: Block-level spatial sorting with word-level splitting (v1)

**Approach**: Process the `fullTextAnnotation` hierarchy (pages → blocks → paragraphs → words → symbols). Detect columns by clustering block left-edge x-coordinates. For blocks spanning both columns, split at word level by x-coordinate.

**Result**: Made things much worse. The subtitle ("A young boy describes growing up in a small Mexican fishing village") got fragmented into pieces like "in small Mexican" / "describes growing up a" / "A young boy" because word-level splitting shredded full-width text. UI elements from the margin area were included. "my favorite" was still misplaced.

**Commit**: `c8d86a1` (reverted)

### Attempt 2: Paragraph-level spatial sorting (v2)

**Approach**: Flatten the Vision hierarchy to paragraphs (discard block groupings). Classify paragraphs as full-width (>60% page width) vs narrow. Detect columns from narrow paragraphs only. Full-width paragraphs output first, then left column, then right column. No word-level splitting.

**Result**: Subtitle stayed intact (improvement over v1). But "my favorite" and "twenty-four!" ended up in the "stray" bucket at the end of output. The right column paragraph order was still wrong ("become a fisherman" appeared before "the educational system altogether and"). The fundamental issue: Google Vision's bounding box y-positions for these paragraphs don't match visual line order.

**Commit**: `334a92e` (reverted)

### Attempt 3: Two-pass orphan absorption (v3)

**Approach**: After detecting column clusters, compute each column's full x-range. Orphan paragraphs (not in any cluster) get absorbed into a column if their center-x falls within that column's x-range.

**Result**: "my favorite" still not absorbed — its center-x apparently falls outside the right column's x-range (it sits at the far right edge of the right column, close to the margin area). Fundamentally still a brittle heuristic.

**Commit**: `f2244de` (reverted)

### Current state

Reverted to original: `return fullTextAnnotation.text` — Google's raw concatenation. The "my favorite" issue exists but nothing else is broken. **Commit**: `f2864a6`

## Root Cause Analysis

The heuristic approaches all fail because:

1. **Google Vision's spatial data is unreliable for ordering.** The bounding box positions for paragraphs don't always reflect the correct visual reading order. "my favorite" gets a bounding box that places it far from where it visually appears on the page.

2. **Column detection from bounding boxes is inherently brittle.** Textbook pages have complex layouts (title + subtitle + 2 columns + margin UI + annotations). Any threshold-based heuristic that works for one page breaks on another.

3. **The problem isn't cross-column — it's within-column.** Even if we correctly identify the right column, Google's paragraph ordering within that column is wrong. Spatial sorting by y-position can't fix this when the y-positions themselves are incorrect.

## Ideas to Explore

### 1. Gemini Vision OCR (recommended)

**Concept**: Use Gemini (2.0 Flash or 2.5 Flash) as the primary OCR engine. Send the image with a prompt instructing correct reading order. Gemini understands document layout natively from pixels — no heuristics needed.

**Why it should work**: Gemini's multimodal understanding processes the image holistically. It sees the two-column layout, understands reading flow, and can extract text in correct order. It doesn't rely on bounding box heuristics.

**Implementation**: The Gemini API key already exists in the app (`localStorage.getItem('orf_gemini_key')`), used for TTS. Add a `extractTextWithGemini(base64, mimeType)` function. Try Gemini first, fall back to Cloud Vision if Gemini fails (no key, rate limit, etc.).

**Prompt draft**:
```
This is a page from a reading assessment booklet. Extract the passage
text VERBATIM in correct reading order. For two-column layouts, read
the left column top-to-bottom first, then the right column top-to-bottom.
Include the title and any introductory text. Exclude page numbers, line
numbers, comprehension questions, and answer blanks. Output only the
exact passage text. Do not paraphrase or correct any text.
```

**Concerns**:
- Gemini may "clean up" text (fix spelling, rephrase) instead of extracting verbatim — prompt must be explicit about verbatim extraction
- Rate limits on free tier (1,500 req/day for Flash — should be fine for OCR)
- Latency may be higher than Cloud Vision
- Need to verify Gemini handles scribbles/markings on the page gracefully (should ignore them like Cloud Vision does... mostly)

### 2. Google Document AI

**Concept**: Use Google's dedicated document OCR service which has an ML-based layout model with explicit reading order support (v2.1+).

**Why it should work**: Purpose-built for exactly this problem. Google themselves point to Document AI when Cloud Vision's reading order is insufficient.

**Concerns**:
- Separate API with different pricing (may have free tier)
- May require GCS bucket for input (not just base64)
- More complex setup than Gemini
- Overkill if Gemini Vision works

### 3. Pre-crop columns

**Concept**: Use Cloud Vision's block bounding boxes to detect column boundaries, crop the image into left and right halves, OCR each half separately.

**Why it might work**: Each half-image is single-column, so Cloud Vision's reading order would be correct within each half.

**Concerns**:
- Still requires column boundary detection (heuristic)
- Two API calls instead of one
- Edge cases: text at column boundary gets cut
- Doesn't help if the problem is within a single column

### 4. Hybrid: Cloud Vision OCR + Gemini reorder

**Concept**: Use Cloud Vision for character-level OCR (which it does well), then send the extracted text + image to Gemini asking it to reorder the text into correct reading order.

**Why it might work**: Separates the OCR task (Cloud Vision is good at character recognition) from the ordering task (Gemini is good at layout understanding).

**Concerns**:
- Two API calls, higher latency
- Complex orchestration
- Gemini might still modify text during reordering
- Probably unnecessary if Gemini's own OCR is good enough (idea 1)

## Recommendation

**Try Gemini Vision first (idea 1).** It's the simplest implementation (one API call, already have the key), most robust (no heuristics), and if the prompt is right, should produce correctly-ordered verbatim text. Cloud Vision stays as the fallback for when Gemini is unavailable.
