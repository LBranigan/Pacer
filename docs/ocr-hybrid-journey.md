# OCR Hybrid — Everything We Tried

## The Problem

Google Cloud Vision's `DOCUMENT_TEXT_DETECTION` returns paragraphs in wrong order for multi-column reading assessment pages. The canonical failure case: the sentence "But **my favorite** class is phys ed" gets split into 5 separate Cloud Vision paragraphs, and "my favorite" ends up orphaned on its own line in the wrong position.

Three prior heuristic attempts using spatial sorting by bounding box all failed and were reverted before this journey began.

---

## Approach 1: Flat Array Reordering (Pre-existing)

**Idea:** Cloud Vision extracts paragraphs. Gemini returns a flat JSON array of paragraph numbers in correct reading order, e.g. `[3, 1, 5, 2, 4]`. We reassemble by joining paragraphs in that order.

**Prompt:** "Return ALL fragment numbers in the correct reading order as a JSON array."

**Problem:** Gemini was also told to "EXCLUDE any fragments that are clearly line numbers, page numbers, comprehension questions." This gave Gemini permission to drop fragments. Gemini dropped "my favorite" (a 2-word fragment that looked like junk). Result: "But class is phys ed" — missing "my favorite."

**Why it failed:** A flat array can shuffle paragraphs but can't merge them. Cloud Vision's paragraph boundaries are wrong — "my favorite" isn't a paragraph, it's a fragment of a sentence. You need to merge, not just reorder.

**Status:** Replaced.

---

## Approach 2: Forced Complete Permutation (Flat Array, No Exclusion)

**Idea:** Fix Approach 1 by (a) pre-filtering junk ourselves using `isJunkParagraph()` (no letters = junk), and (b) forcing Gemini to return a complete permutation — every fragment number exactly once, no dropping allowed.

**Changes:**
- Added `isJunkParagraph(text)` — filters paragraphs with no letters (pure digits, punctuation)
- Removed "EXCLUDE" instruction from Gemini prompt
- Added validation: `order.length === paragraphs.length`

**Result:** "my favorite" was no longer dropped, but still appeared on its own line. Flat reordering placed it in the right neighborhood but couldn't merge it into its parent sentence.

**Why it failed:** Same fundamental issue as Approach 1 — flat arrays can reorder but not merge. "my favorite" needs to join "But ... class is phys ed" as part of one paragraph, not sit between them as a separate line.

**Commit:** Not committed (replaced immediately).

---

## Approach 3: Nested Array Grouping + Reordering

**Idea:** Change Gemini's output from a flat array to a nested array. Each inner array groups fragments that belong to the same paragraph. Outer array is paragraphs in reading order. Reassembly: join within groups with space, join groups with newline.

**Prompt:** "Return a JSON array of arrays. Each inner array groups fragments that belong to the same paragraph, in reading order."

**Example response:** `[[1, 2], [3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15, 16]]`

**Validation:** Nested array, every number 1..N appears exactly once across all inner arrays.

**Reassembly:**
```javascript
const mergedText = order
  .map(group => group.map(i => paragraphs[i - 1]).join(' '))
  .join('\n');
```

**Result:** Gemini correctly grouped the 5 fragments (8, 9, 10, 11, 12) into one group. But the **within-group ordering** was wrong — Gemini placed "my favorite" second in the group instead of fourth:

```
78 At school I learn Spanish-Mexico's my favorite official language-mathematics,
6ageography, and history. But class is phys ed...
```

Should have been:
```
78 At school I learn Spanish-Mexico's official language-mathematics,
6ageography, and history. But my favorite class is phys ed...
```

**Why it failed:** Gemini orders fragments spatially (top-to-bottom by position on the page), not by sentence flow. "my favorite" appears physically above "official language" on the page, so Gemini places it before "official language" in the group. To get the right within-group order, Gemini would need to understand sentence-level reading comprehension — which it can do when generating text, but not when returning numbers.

**Key insight:** The difference between "return numbers" and "generate text" is the difference between spatial reasoning and reading comprehension. Gemini can do the latter but the flat/nested array approach only lets it do the former.

**Commit:** `4a27030`

**Plan doc:** `docs/hybrid-ocr-fragment-merging-plan.md`

---

## Approach 4: Gemini Text Assembly (Current Solution)

**Idea:** Stop asking Gemini to return numbers. Instead, give Gemini the Cloud Vision fragments + the image, and ask it to output the fully reassembled passage text directly. Gemini uses reading comprehension (not just spatial reasoning) to place fragments correctly.

**Anti-hallucination guard:** Subset word-bag validation — every word in Gemini's output must exist in Cloud Vision's input (with sufficient count). Gemini can DROP words (junk filtering) but cannot ADD words. This catches hallucination while allowing Gemini to clean up line numbers, page numbers, and other non-passage content.

**Prompt (key parts):**
```
Look at the image and reassemble ONLY the reading passage in the correct
reading order. For two-column layouts, read the left column top-to-bottom
first, then the right column top-to-bottom.

CRITICAL RULES:
- Output ONLY the reading passage — drop line numbers, page numbers,
  comprehension questions, answer choices, and margin annotations
- Use ONLY the exact text from these fragments for passage words
- Do NOT correct any words, even if they look like OCR errors
- Do NOT add any words that aren't in the fragments
- Merge fragments that belong to the same paragraph
- Separate distinct paragraphs with a blank line
```

**Result:** "But my favorite class is phys ed" — correct! Gemini reads the image, understands the sentence, and places "my favorite" in the right position.

**Remaining issues (acceptable — teacher fixes in textarea):**
- OCR artifacts: "6ageography" (digit fused with word)
- Embedded line numbers: "78 At school", ")29"
- Stray punctuation: "have/", ")", ">"
- Missing period: "taller Until" (should be "taller. Until")
- Fused line number: "21 P.M." (should be "2 P.M.")

**Why this works:** Gemini generates text using reading comprehension, not spatial sorting. When it sees fragments containing "But", "my favorite", and "class is phys ed", it knows from the sentence structure that "my favorite" goes between "But" and "class." It couldn't know this from fragment numbers alone.

**Commit:** `551a2a5` (initial), `5386bf9` (superset validation), `67dc729` (removed junk filter), `034d7f1` (subset validation)

---

## Approach 4a: Junk Pre-Filtering (Sub-attempt, Reverted)

During Approach 4, we initially pre-filtered "junk" paragraphs (no-letter paragraphs) before sending to Gemini. This caused a word-bag validation failure: Cloud Vision had 578 words after filtering, but Gemini's output had 605 words because Gemini read the image and included words from fragments we had stripped.

**Fix:** Removed the junk filter entirely. Give Gemini ALL fragments. Let the prompt instruction ("output ONLY the reading passage") handle junk removal. Subset validation catches any hallucination.

**Commit:** `67dc729`

---

## Approach 4b: Subset Validation Flip (Sub-attempt)

Initially used exact word-bag matching (input count = output count). Failed because Gemini legitimately drops junk. Tried superset (output is superset of input) — wrong direction. Finally settled on subset (output is subset of input) — Gemini can drop words but not add them.

**Commit:** `5386bf9` → `034d7f1`

---

## Approach 5: OOV Cleanup Pass (Tried and Reverted)

**Idea:** After Gemini assembly, run a second pass to fix OCR artifacts. Use CMUdict (125K-word dictionary) to find out-of-vocabulary words, then send those specific words to Gemini (text-only, no image) for targeted correction. Gemini classifies each OOV word as:
- **correct**: OCR artifact — fix it (e.g., "6ageography" → "geography")
- **keep**: foreign word or proper noun — leave it (e.g., "cayuco", "jaiberos")
- **remove**: stray line number or junk — delete it

**Implementation:**
- `findOOVWords(text)` — splits text into tokens, checks each against CMUdict via `getPhonemeCount()`, returns OOV words with surrounding context
- `correctOOVWithGemini(oovWords, geminiKey)` — text-only Gemini call with structured JSON response
- `applyCorrections(text, correctionMap)` — string replacement
- `cleanupOOV(text, geminiKey)` — orchestrator

**Result:** Fixed "6ageography" → "geography" and removed line numbers 78, 29. But also changed "phys" → "physical" — a false correction. The book says "phys ed" (abbreviation for "physical education"), but "phys" isn't in CMUdict, so it got flagged as OOV. Gemini "corrected" it to "physical."

**Why it was reverted:**
1. **False corrections are worse than artifacts.** "6ageography" is obviously wrong — a teacher spots and fixes it in seconds. "phys" → "physical" is a silent change that could go unnoticed and cause false errors during assessment (student reads "phys" from the book but reference says "physical").
2. **Gemini without the image can't distinguish intentional abbreviations from OCR artifacts.** Both "phys" and "6ageography" are OOV. Only a human (or Gemini with the image) can tell which is intentional.
3. **Many remaining issues are punctuation artifacts** ("have/", ")", ">") that CMUdict can't detect because they're not words at all.
4. **Net negative.** The few fixes it made correctly were cosmetic; the one false correction it made was harmful.

**Commit:** `08b2af6` (added), `717e6e7` (reverted)

---

## Final Architecture (Current)

```
Image file
  │
  ├─→ Cloud Vision DOCUMENT_TEXT_DETECTION
  │     └─→ fullTextAnnotation (paragraph hierarchy)
  │           └─→ extractParagraphs() → array of text strings
  │
  └─→ Gemini 2.0 Flash (image + fragments)
        └─→ assembleWithGemini()
              ├─→ Prompt: reassemble reading passage only
              ├─→ Subset validation (output words ⊆ input words)
              └─→ Assembled text
```

**Cloud Vision provides:** character-perfect text extraction, paragraph boundaries (sometimes wrong).

**Gemini provides:** reading comprehension to merge fragments correctly, layout understanding for column ordering, junk filtering (drops line numbers, page numbers, questions).

**Subset validation provides:** hallucination prevention. Every word Gemini outputs must come from Cloud Vision's input. Gemini can drop words but cannot add words.

**Teacher provides:** final cleanup of remaining OCR artifacts in the textarea (minor — "6ageography", stray punctuation, embedded line numbers).

---

## Key Lessons

1. **Reordering ≠ merging.** When Cloud Vision's paragraph boundaries are wrong, no amount of reordering (flat or nested arrays) can fix it. You need to merge fragments, which requires text generation.

2. **Spatial reasoning ≠ reading comprehension.** Gemini ordering fragment numbers uses spatial reasoning (where is this fragment on the page?). Gemini generating text uses reading comprehension (where does this phrase fit in the sentence?). The latter is strictly more powerful for this problem.

3. **Subset validation is the right constraint.** Output ⊆ Input catches hallucination while allowing junk removal. Exact match fails (Gemini must drop junk). Superset fails (wrong direction — allows hallucination).

4. **Don't give AI permission to drop things.** Approach 1 told Gemini to "EXCLUDE" junk fragments, which caused it to drop "my favorite." Better: handle junk filtering in the prompt as a directive ("output ONLY the reading passage") and validate the output.

5. **Don't auto-correct what you can't verify.** The OOV cleanup pass (Approach 5) could fix obvious artifacts but also silently changed correct text. The risk of a false correction in a reading assessment (where the reference text must exactly match the book) outweighs the convenience of auto-fixing a few OCR artifacts.

6. **Let humans handle the long tail.** Cloud Vision + Gemini assembly gets ~95% of the text right. The remaining 5% (OCR artifacts, stray punctuation) are obvious enough for a teacher to fix in seconds. Trying to auto-fix that last 5% introduces more risk than it removes.
