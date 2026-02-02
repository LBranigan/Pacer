# 04-01 Summary: Google Vision OCR + Passage Trimming + Analyze Button

## What was built
- `js/ocr-api.js`: Google Vision OCR with image resizing
- `js/passage-trimmer.js`: Semi-global alignment (findSpokenRangeInOCR) to trim OCR text to attempted words
- `js/word-equivalences.js`: Word equivalence map (vs→versus, abbreviations, contractions, numbers)
- Restructured `js/app.js`: Deferred processing with appState, Analyze button, OCR flag tracking
- Enriched JSON output with per-word timestamps, confidence, and all inter-word gaps

## Deviations from plan
- Passage trimmer rewritten from Sellers' algorithm to multi-start-position DP (ported from Word Analyzer iPad app's findSpokenRangeInOCR) after initial approach failed on real OCR pages
- Buffer removed (was 3 words) — caused false omissions on dense OCR pages
- Added normToOrigIndex mapping to fix index mismatch between normalized and original tokens
- Added OCR confusion handling and richer similarity scoring
- Word equivalences module added (not in original plan) to handle vs→versus and similar

## Commits
- d071d45 feat(04-01): add Google Vision OCR for book page text extraction
- c5f34b6 feat(04-01): add Analyze button, OCR passage trimming, word equivalences, enriched JSON
