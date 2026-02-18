# Codebase Concerns

**Analysis Date:** 2026-02-18

## Tech Debt

**VAD Overhang Adjustment Disabled — Masking Real Hesitations:**
- Issue: `adjustGapsWithVADOverhang()` is disabled in `js/app.js` (line 1513) because VAD segments without a cap can produce 1000ms+ overhang, eliminating genuine hesitations. A 1.28s gap was reduced to 144ms and dismissed as false.
- Files: `js/app.js` (line 1512 TODO), `js/vad-gap-analyzer.js` (contains full logic but unused)
- Impact: Hesitation detection is incomplete; large VAD segments mask student struggles between words. Teacher cannot see when a student pauses even though the child actually spoke.
- Fix approach: Re-enable with a cap (300–500ms max overhang). Requires empirical tuning to find the right threshold that prevents overhang from obscuring real pauses but doesn't create false hesitations.

**Large Monolithic Files — Complexity & Maintainability:**
- Issue: Core pipeline functions are tightly coupled in large files, making changes risky:
  - `js/app.js`: 4,111 lines (alignment setup, NL annotation, diagnosis orchestration, metrics, UI integration all in one file)
  - `js/ui.js`: 2,759 lines (alignment rendering, tooltips, audio playback, form handling)
  - `js/diagnostics.js`: 2,115 lines (pause detection, near-miss resolution, struggle classification, all orchestrators)
  - `js/lofi-engine.js`: 1,862 lines (Web Audio synth with 7 styles, each with drum variants)
  - `js/rhythm-remix.js`: 1,494 lines (orchestrator + state machine)
- Files: Multiple files listed above
- Impact: Bug fixes in one area often require reviewing entire file. Testing is difficult because functions depend on shared state. New contributors struggle to locate where logic lives.
- Fix approach: Split files along domain boundaries. Suggested splits: `app.js` → split into `alignment-setup.js`, `diagnosis-orchestrator.js`, `metrics-calculator.js`. `diagnostics.js` → split into `pause-detector.js`, `struggle-resolver.js`. Requires careful dependency injection to avoid circular imports.

**Reverb/Parakeet Fallback Logic Implicit — No Clear Degradation Path:**
- Issue: When Reverb or Parakeet backends are unavailable, fallback is silent. `isReverbAvailable()` returns false but code doesn't explicitly log why or guide user recovery.
- Files: `js/reverb-api.js` (line 133 catch block), `js/parakeet-api.js` (line 72), `js/app.js` (lines 283, 492 error handlers)
- Impact: User submits audio, gets "No STT results" error but doesn't know if backend is down, network is bad, or audio was corrupted. No helpful error message guides troubleshooting.
- Fix approach: Enhance error messages with backend status checks. When kitchen-sink fails, probe which engine(s) failed (Reverb, Parakeet, Deepgram) and return specific guidance.

**Cross-Validator Engine Naming Confusion — "Parakeet as cross-validator":**
- Issue: Code still uses term "cross-validator" in filenames (`cross-validator.js`) and variable names (`_xvalEngine`, `_xvalWord`) even though Parakeet is now the primary correctness engine (overrides Reverb on disagreement).
- Files: `js/cross-validator.js`, `js/app.js` (multiple `_xval*` variable names), `js/storage.js` (v5→v6 migration renames `_deepgram*` → `_xval*`)
- Impact: Developers misunderstand role. Parakeet IS the primary engine, not a cross-check. Comments and variable names perpetuate old architecture. Future maintainers will make wrong assumptions about trust hierarchy.
- Fix approach: Rename `cross-validator.js` → `parakeet-orchestrator.js`. Rename `_xvalEngine` → `_primaryEngine`. Update all comments to clarify Parakeet's role as primary correctness source.

**Fragment Guard Logic Complex & Undocumented:**
- Issue: Phase 7b in `js/app.js` (~line 1407) has a fragment guard that checks `pkInsGroups[refIdx]` and `pkInsGroups[refIdx+1]` for near-miss insertions. The logic is: if Parakeet heard fragments that are near-miss of the ref word, block Trust Pk override because fragments suggest the student struggled with the word, not that Reverb was wrong.
- Files: `js/app.js` (lines 1407–1450)
- Impact: This logic is subtle. If not documented, future changes to `isNearMiss()` thresholds or insertion grouping will silently break fragment guard, causing Trust Pk to override legitimate struggles flagged as fragments.
- Fix approach: Add a detailed comment block explaining the guard's purpose. Create a standalone function `isLikelyFragmentReconstruction()` that documents the heuristic. Add a debug log when guard blocks override.

**Phoneme Normalization Fallback Heuristic — No Empirical Validation:**
- Issue: `js/phoneme-counter.js` uses fallback `syllables × PHONEMES_PER_SYLLABLE_RATIO (2.5837)` for words not in CMUdict (125K words). The ratio is derived from aggregate CMUdict stats but not validated against real reading data.
- Files: `js/phoneme-counter.js` (lines 88–89), `js/diagnostics.js` (word speed tier calculation)
- Impact: Fallback may over/underestimate phoneme counts for OOV words, causing incorrect word speed classifications (stalled vs. struggling). A student reading a rare word may be incorrectly flagged as stalled if fallback overestimates phoneme load.
- Fix approach: Collect word speed outlier data from real student sessions. Compare fallback estimates to CMUdict words of similar syllable count. Adjust ratio or implement syllable-phoneme mapping table.

**Storage Migration Chain Not Future-Proof:**
- Issue: `js/storage.js` has 6 migration steps (v1→v6). Each step is a monolithic if-block that cascades through all previous upgrades. Adding a new field requires modifying `defaultData()`, adding a new v→v+1 migration block, and bumping version everywhere.
- Files: `js/storage.js` (lines 12–67)
- Impact: Migration logic is fragile. If a migration step fails (e.g., JSON.parse error), entire storage is lost. No rollback. If a field is added but migration is not updated, old users never get the field.
- Fix approach: Implement a schema-based migration system with per-field versioning. Use a declarative schema that specifies which version introduced each field and what its default is.

---

## Known Bugs

**Trailing-Hyphen Merge Timing — OCR Line Break Artifacts Not Always Joined:**
- Symptoms: OCR text splits words at line breaks with trailing hyphens (e.g., "spread-" + "sheet"). If normalization happens before merge, two separate tokens are created; if merge happens first, they join correctly. State-dependent behavior.
- Files: `js/text-normalize.js` (normalizeText), `js/app.js` (refPositions IIFE, ~line 994), `js/ui.js` (splitForPunct), `js/diagnostics.js` (getPunctuationPositions, computePauseAtPunctuation), `js/passage-trimmer.js` (trimPassageToAttempted)
- Trigger: Upload OCR text from multi-page document with word splits at line breaks. Alignment will create extra insertions/omissions.
- Workaround: Manually remove trailing hyphens from OCR text before upload. Or re-export OCR as single-line text.
- Root cause: Five separate code paths handle hyphen splitting. Trailing-hyphen merge must run FIRST in all five places, but current code order is inconsistent.

**WCPM Not Counting Forgiven Substitutions — Inflectional Variants & Proper Nouns:**
- Symptoms: A student correctly reads "school" for "schools" (inflectional forgiveness) or pronounces a proper noun phonetically correctly but different spelling (proper noun forgiveness). Student's WCPM is lower than it should be because the correct-but-forgiven words are not counted toward words read.
- Files: `js/metrics.js` (computeWCPM, computeWCPMRange), `js/app.js` (Phase 1.5, inflectional forgiveness)
- Trigger: Any session with inflectional variants or proper nouns.
- Workaround: Count forgiven substitutions as correct for WCPM only (not error rate).
- Root cause: WCPM logic does not check `entry.forgiven` flag when counting words. Pre-existing gap (inflectional forgiveness was added but metrics.js was not updated).

**Abbreviation Expansion Compound Skips Struggle Reclassification:**
- Symptoms: Student reads "et cetera" correctly for "etc." — compound merge creates synthetic entry with `_abbreviationExpansion: true`. Compound struggle reclassification skips this entry (line 2157 in app.js), so it stays as `type: 'correct'` instead of being reclassified if it's actually part of a struggle cluster.
- Files: `js/app.js` (line 2157 skip guard), `js/alignment.js` (mergeAbbreviationExpansions, line 371)
- Trigger: Session with abbreviations followed by word that would normally be reclassified as struggle.
- Workaround: None. Guard is intentional but creates edge case.
- Root cause: Guard assumes abbreviation expansions are inherently not struggles, but they can be if preceded/followed by hesitation or fragments.

**NL Lowercase Guard Runs After Sentence-Start Block — Proper Noun Inconsistency:**
- Symptoms: A word like "Visuals" (proper noun at sentence start or heading) gets `isProperNoun: true` from NL annotation. But the lowercase guard (`refLowercaseSet`) should also mark it as non-proper if "visuals" (lowercase) appears elsewhere. Currently, the guard runs AFTER the sentence-start block, so "Visuals" at heading keeps `tier: 'proper'` even if "visuals" is common.
- Files: `js/app.js` (NL annotation mapping, lines ~1125–1160)
- Trigger: Passage with heading like "Visual Exploration" and later "the visual design."
- Workaround: Edit NL override in debug UI to remove proper noun flag.
- Root cause: Two-pass NL annotation: sentence-start block adds proper noun flag, then lowercase guard tries to undo it, but guard logic is insufficient (checks `refLowercaseSet` but that's after filtering, indices may not match).

**Hyphen Split Index Drift — displayRef Mismatch Across Functions:**
- Symptoms: `normalizeText()` splits hyphens, producing fewer words than original text. But `refPositions` IIFE in app.js (~line 994) doesn't always match this split behavior. Result: `_displayRef` on alignment entries points to wrong original word. UI shows misaligned reference (e.g., "spread-sheet" as two words but displayed as "spreadsheet").
- Files: `js/text-normalize.js` (normalizeText), `js/app.js` (refPositions IIFE, line 994+), `js/ui.js` (displayAlignmentResults), `js/diagnostics.js` (getPunctuationPositions, computePauseAtPunctuation)
- Trigger: Passage with internal hyphens (e.g., "soft-on-skin", "e-mail").
- Workaround: Avoid hyphens in OCR passage; use single words.
- Root cause: Five code paths handle hyphen splitting (normalizeText, refPositions, splitForPunct, getPunctuationPositions, computePauseAtPunctuation). Each has slightly different split logic. CRITICAL: all five must be synchronized whenever normalization rules change.

**sttLookup Trailing-Hyphen Norm Bug — Key Mismatch:**
- Symptoms: Old code normalized STT words with `w.word.toLowerCase().replace(...)` but did NOT strip trailing hyphens. New alignment returns `hyp: "apo"` from hyphenated "apo-phony". sttLookup keys are created synthetically for compounds but also have trailing hyphens stripped. Lookup fails, synthetic entry not found.
- Files: `js/app.js` (sttLookup creation, ~line 620), (lookup usage, ~line 689)
- Trigger: Compound word where first part ends with hyphen in old transcript.
- Workaround: Re-record or re-analyze.
- Root cause: Normalization was updated to strip trailing hyphens for lookup, but synthetic sttLookup entry creation was not updated.

---

## Security Considerations

**API Keys in localStorage — Exposed to XSS & Storage Access:**
- Risk: Gemini API key, GCP STT key, and backend token are stored in plain text in browser localStorage. If the page is compromised via XSS, attacker can steal keys and make API calls on the user's quota.
- Files: `js/app.js` (lines 3033–3046), `js/movie-trailer.js` (line 362)
- Current mitigation: HTTPS ensures localStorage is not exposed over network. No XSS filtering in place.
- Recommendations:
  1. Implement Content Security Policy (CSP) to prevent inline script execution
  2. Move API keys to backend; have frontend request operations via backend (e.g., POST /transcribe instead of direct API call)
  3. If keys must be in frontend, use sessionStorage (cleared on page close) instead of localStorage
  4. Implement rate limiting on backend to prevent quota abuse

**Revoked Keys List Hardcoded — No Revocation Endpoint:**
- Risk: `_revokedKeys` list in app.js (line 3041) is hardcoded. If a key is exposed, the only fix is to push a code update. No runtime revocation mechanism.
- Files: `js/app.js` (line 3041)
- Current mitigation: None beyond manual hardcoding.
- Recommendations:
  1. Implement a revocation endpoint that returns a list of invalid keys (check at app startup)
  2. Add a "Revoke All Keys" button in settings that clears localStorage for all API keys
  3. Log key usage attempts (first 8 chars only) so user can audit key activity

**Dictionary API Lookup Has No Quota Protection — Potential DOS:**
- Risk: `isCommonDictionaryWord()` in app.js (line 1702) makes uncached API calls to Free Dictionary API. If a passage has 100+ unique words and many are OOV, could trigger 100+ API requests in sequence. No backoff or quota limit.
- Files: `js/app.js` (lines 1696–1710)
- Current mitigation: sessionStorage caching (key: `dict_{word}`) prevents re-checking same word in same session.
- Recommendations:
  1. Implement exponential backoff if API returns 429 (rate limited)
  2. Add a max-requests-per-session limit (e.g., 20 dict checks per assessment)
  3. Fall back to local word list (common English words) instead of API for basic checks
  4. Log API failures with timestamp so user knows when rate limiting kicked in

**Backend URL & Token Configuration — No Validation:**
- Risk: User can set `backendUrl` to any URL (e.g., attacker's server), and backend token is passed in plaintext Authorization header (even over HTTPS, token is visible to anyone with network access to that endpoint).
- Files: `js/backend-config.js`, `js/app.js` (backend settings form)
- Current mitigation: Requires user to manually enter URL. Token is sent over HTTPS.
- Recommendations:
  1. Validate backend URL against a whitelist of known trusted servers
  2. Use mTLS (client certificate) for backend auth instead of bearer token
  3. Implement CORS headers on backend to prevent requests from untrusted origins
  4. Log all backend requests (URL, timestamp, operation) for audit trail

---

## Performance Bottlenecks

**Alignment Algorithm Quadratic in Word Count — O(m×n) Space & Time:**
- Problem: Needleman-Wunsch alignment in `js/alignment.js` (lines 535–537) allocates F and P matrices of size (m+1) × (n+1). For a 1000-word passage, this is 1,000,000+ cells. Memory usage is O(m×n), time is also O(m×n).
- Files: `js/alignment.js` (lines 535–590, Needleman-Wunsch), `js/app.js` (line 842, called for every reference text)
- Impact: Long passages (>1000 words) will cause browser to freeze or run out of memory. Each new passage requires re-running alignment.
- Improvement path:
  1. Implement Hirschberg's algorithm (linear space, same time) for long passages
  2. Cache alignment results by passage hash so re-analysis doesn't re-align
  3. Implement early-termination heuristic: if alignment confidence drops below threshold, stop and return partial result
  4. Use typed arrays (Float64Array) instead of generic Array for DP matrices

**Per-Frame Waveform Computation — Rendering Every Animation Frame:**
- Problem: `js/mountain-range.js` recomputes waveform visualization on every frame (canvas requestAnimationFrame). With 2000 HI_RES_PEAKS and color lookup for each bar, this is O(n) per frame × 60fps = thousands of operations per second.
- Files: `js/mountain-range.js` (rendering loop), `js/rhythm-remix.js` (calls update() on every frame)
- Impact: High CPU usage, battery drain on mobile, frame drops if other work is happening. Noticeable on older devices.
- Improvement path:
  1. Cache waveform computation; only re-render if data changes (word finished, color changed)
  2. Use OffscreenCanvas to render in worker thread (non-blocking)
  3. Implement level-of-detail (LOD): use fewer bars for passages with 100+ words
  4. Use WebGL instead of 2D canvas for large waveforms

**NL Annotation Synchronous API Calls — Blocks UI During Analysis:**
- Problem: `analyzePassageText()` in app.js (line 679) makes a synchronous fetch to NL API and waits for response before continuing. If network is slow (500ms–2s), UI freezes during analysis.
- Files: `js/app.js` (lines 676–681), `js/nl-api.js`
- Impact: User sees frozen analyze button; no loading indicator. On slow network, appears broken.
- Improvement path:
  1. Implement async/await with timeout (5–10 seconds max)
  2. Show progress indicator during analysis ("Analyzing passage...")
  3. Queue NL annotation as background task; continue pipeline without it (degrade gracefully)
  4. Cache NL annotations by passage hash (unlikely user uploads exact same passage twice, but hash check is cheap)

**Word Speed Tier Computation — O(n log n) Sorting Every Session:**
- Problem: `computeWordSpeedTiers()` in diagnostics.js sorts all words by duration, computes outliers, then re-sorts. With 500+ words, this is noticeable but not critical.
- Files: `js/diagnostics.js` (word speed tier calculation)
- Impact: Minimal on normal passages. On very long passages (1000+ words), adds 100–200ms to analysis time.
- Improvement path:
  1. Use quickselect instead of full sort to find median/quartiles (O(n) expected instead of O(n log n))
  2. Cache result if word list hasn't changed

---

## Fragile Areas

**Spillover Fragment Consolidation — Complex State Transitions:**
- Files: `js/alignment.js` (consolidateSpilloverFragments, lines 653–726), `js/app.js` (Phase 6, absorbMispronunciationFragments, line 1250+)
- Why fragile: Spillover consolidation has two steps: (1) greedy reassignment of fragments to correct ref slots using near-miss heuristic, (2) absorption of remaining fragments into pronunciation errors. The transition between steps depends on exact hypIndex ordering and temporal containment (±150ms). If timestamps are off by 100ms, fragment absorption may fail silently, leaving fragments in output.
- Safe modification:
  1. Add comprehensive test suite for spillover edge cases: multiple fragments per word, fragments crossing word boundaries, fragments at passage boundaries
  2. Add debug logging in consolidateSpilloverFragments to trace fragment reassignment decisions
  3. Validate hypIndex continuity before and after consolidation
- Test coverage gaps:
  - No tests for fragments from CTC alignment failure (BPE tokenization)
  - No tests for temporal overlap between fragments and speech in other words
  - No tests for cascading fragment absorption (fragment absorbed creates new insertion that gets flagged)

**Inflectional Morphology Forgiveness Regex — Whitelist Incomplete:**
- Files: `js/app.js` (Phase 1.5, lines 1770–1780)
- Why fragile: Inflectional suffix whitelist is `['s', 'es', 'ed', 'd', 'ing', 'er', 'est', 'ly']`. This covers common cases but misses consonant-doubling ("run" → "running"), y→i ("carry" → "carried"), and vowel shifts. If a word like "run" → "running" is read, it won't be forgiven, causing false error.
- Safe modification:
  1. Extend whitelist based on morphology rules (not just suffixes)
  2. Implement consonant-doubling rule: if `shorter + suffix_char + suffix` matches longer, forgive
  3. Add y→i rule: if `shorter.replace(/y$/, 'i') + suffix` matches longer, forgive
  4. Test against all 1000 most common English words with their inflected forms
- Test coverage gaps:
  - No tests for consonant-doubling (run→running, sit→sitting)
  - No tests for y→i (carry→carried, try→tried)
  - No tests for vowel shifts (sing→sang, go→went)

**Three-Way Verdict Disagree-Then-Override Pattern — Silent Type Changes:**
- Files: `js/app.js` (Phase 5, 3-way verdict, lines 1075–1100), (Phase 7b, Trust Pk override, lines 1407–1450)
- Why fragile: Phase 5 sets `crossValidation='disagreed'` but does NOT change V1's `type` field. Phase 7b then checks if `_pkTrustOverride: true` should be set, which depends on fragment guard. If fragment guard logic changes or `isNearMiss()` threshold changes, the override behavior changes silently. No warning if override is not applied.
- Safe modification:
  1. Create explicit test for each Trust Pk override case: disagreed sub with correct Pk word, abandoned attempt with fragments, sentence-start word with low confidence
  2. Add debug output: "Overriding V1 sub '{word}' with Pk correct" / "Blocking override due to fragments"
  3. Create integration test with recorded student samples to verify override decisions match teacher expectations
- Test coverage gaps:
  - No tests for fragment guard blocking override
  - No tests for near-miss threshold changes affecting override decisions
  - No end-to-end tests with real student audio showing override behavior

**Phoneme Fallback & Outlier Threshold — Hardcoded Constants:**
- Files: `js/phoneme-counter.js` (line 13, PHONEME_FLOOR = 3), `js/diagnostics.js` (word speed outlier threshold)
- Why fragile: PHONEME_FLOOR is hardcoded to 3 based on "cost of one CVC syllable." But if CMUdict data is updated or word corpus changes, this threshold may no longer be appropriate. Similarly, outlier detection uses `phonemes > 3` to decide if a word is "short" (no normalization). If a student is asked to read more multi-syllabic passages, threshold needs adjustment.
- Safe modification:
  1. Make PHONEME_FLOOR configurable (dev settings UI)
  2. Compute PHONEME_FLOOR empirically from word speed data: find the point where per-phoneme duration becomes stable
  3. Add comment explaining why 3 was chosen (reference paper/study)
  4. Log word speed tier assignment with phoneme count so teacher can see if classification seems off
- Test coverage gaps:
  - No tests with passages of varying difficulty (1st grade vs. 6th grade)
  - No tests validating phoneme normalization against real reading speed data
  - No sensitivity analysis for threshold changes

**End-of-Reading Backward Walk — Off-by-One Risks:**
- Files: `js/diagnostics.js` (end-of-reading detection, lines ~2400–2450, described in Phase 8 in MEMORY.md)
- Why fragile: End-of-reading walks backward from alignment end, marking trailing non-near-miss subs as `_notAttempted`. The logic depends on exact array bounds and `isNearMiss()` threshold. If alignment length is off by 1 or near-miss threshold is off, detection boundary shifts, incorrectly classifying end-of-reading words.
- Safe modification:
  1. Add explicit bounds checking: ensure loop never reads alignment[i-1] without checking i > 0
  2. Add test cases for edge passages: 5-word passage (all read), 5-word passage (only 3 attempted)
  3. Verify `isNearMiss()` threshold is consistent across all detectors (Phase 8 uses same threshold as near-miss resolution)
- Test coverage gaps:
  - No tests for passages where student reads 50%, 75%, 100%
  - No tests for passages where student reads everything but last word is omitted (boundary case)
  - No tests validating that not-attempted words are excluded from accuracy metrics

**Cache Busting Version Strings — Manual Synchronization:**
- Files: `rhythm-remix.html` (line 7), `js/rhythm-remix.js` (import statements), CSS imports in HTML
- Why fragile: Cache busting requires updating three places: (1) `<link>` and `<script>` tags in HTML, (2) ES module imports inside `js/rhythm-remix.js`, (3) files imported by those modules. If any version string is missed, old code is cached and new changes don't appear. User must hard refresh (Ctrl+Shift+R) to see updates.
- Safe modification:
  1. Implement automatic version string generator: parse current code and compute hash of all imported files
  2. Generate a single `version.js` file that exports all cache-bust strings
  3. Import this from HTML and all JS files (single source of truth)
  4. Add a "Check for updates" button that fetches version.js and notifies user if code is stale
- Test coverage gaps:
  - No automated test that verifies all version strings match
  - No test that detects when new files are added and not cache-busted

---

## Scaling Limits

**Passage Length — 1000+ Words Causes Quadratic Slowdown:**
- Current capacity: ~500 words analyzed in <5 seconds
- Limit: ~1000 words; alignment becomes slow (5–10s), waveform rendering may lag. >2000 words: browser freezes or runs out of memory.
- Scaling path:
  1. Implement Hirschberg's algorithm (line-space NW) — enables 5000+ word passages
  2. Implement passage chunking: analyze 500-word chunks independently, merge results
  3. Move alignment to Web Worker to avoid blocking UI during long analyses
  4. Use IndexedDB to cache alignment results by passage hash

**Audio File Size — IndexedDB Quota Limited:**
- Current capacity: ~100 assessments at 2–3 MB audio each = ~200–300 MB before quota exceeded
- Limit: Browser IndexedDB quota is typically 50 MB (Chrome) to 500 MB (Firefox). Depends on device storage and browser.
- Scaling path:
  1. Implement audio compression (WebM/Opus instead of WAV) to reduce file size by 5–10×
  2. Implement partial audio retention: store only the analyzed passage audio, discard pre/post-reading noise
  3. Add storage quota monitoring and warning ("You've used 80% of available storage")
  4. Implement cloud sync (upload to server) for long-term archival

**NL Annotation API Rate Limiting — 100+ Words Hits Quota:**
- Current capacity: ~50 NL annotations per minute (free tier limit)
- Limit: If 10 users each submit a 300-word passage, they'll hit rate limit after ~15 analyses total.
- Scaling path:
  1. Implement NL annotation caching by passage hash
  2. Queue NL requests (don't block analysis) and process asynchronously
  3. Move NL annotation to backend (batch process overnight) instead of per-user on-demand
  4. Fall back to simpler POS tagging (local, no API) if NL API is rate-limited

**Simultaneous Audio Playback — Web Audio Context Limited:**
- Current capacity: ~3 simultaneous playbacks before audio context context hits buffer exhaustion
- Limit: Playing back multiple assessments at once causes stuttering or fails silently.
- Scaling path:
  1. Implement audio context pooling: reuse a single AudioContext instead of creating new ones
  2. Queue playback requests if context is busy
  3. Add max-playback limit to settings (e.g., "max 1 playback at a time")

---

## Dependencies at Risk

**@ricky0123/vad-web (ONNX Runtime) — Large Download, Complex Build Chain:**
- Risk: VAD model (ONNX) is downloaded from CDN on first use (~10 MB). If CDN is slow or unavailable, VAD init fails silently, and ghost detection doesn't run. Build requires WASM support; older browsers fail silently.
- Impact: Ghost detection is optional, so graceful degradation works. But user has no way to know VAD failed (no error message).
- Migration plan: Implement local VAD fallback (simple energy-based voice detection). If ONNX fails, fall back to energy-based detector instead of disabling ghost detection entirely.

**Free Dictionary API (api.dictionaryapi.dev) — No SLA, Free Tier Unstable:**
- Risk: Used for proper noun forgiveness (`isCommonDictionaryWord()`). API is free, community-maintained, no guaranteed uptime. If API goes down, all proper noun checks fail.
- Impact: Proper nouns are not forgiven (false errors). Reading accuracy score is too low for students with names or place names in passage.
- Migration plan: Replace with local word list (1000 most common English words + proper name database). Use API only as fallback if local check is ambiguous.

**Reverb Backend (localhost:8765) — Docker Container Dependency:**
- Risk: Requires locally-running Docker container with Wenet/Parakeet models. If container is not running or network is down, all dual-engine transcription fails.
- Impact: Kitchen-sink falls back to Deepgram only, losing Reverb's disfluency detection.
- Migration plan: Implement containerless deployment (pre-compute Reverb models as static files, load in browser or cloud function). Or implement web socket fallback so frontend can reconnect if backend is briefly unavailable.

**Parakeet TDT Backend (localhost:8765 /parakeet) — Model Inference Dependency:**
- Risk: Parakeet is the primary correctness engine. If backend is down or model crashes, entire pipeline fails. No offline fallback.
- Impact: Cannot assess reading; analysis fails.
- Migration plan: Pre-load smaller Parakeet model in browser (ONNX) as fallback. Degrade to Reverb-only scoring if server-side Parakeet unavailable.

**Gemini API (Movie Trailer) — Quota & Deprecation Risk:**
- Risk: Gemini API is used for Movie Trailer DJ intro (TTS). API is in public preview, subject to change. Quota limits are per-user; if user hits limit, Movie Trailer fails.
- Impact: Movie Trailer feature breaks (no DJ intro). Not critical, but degrades gamification engagement.
- Migration plan: Make Movie Trailer optional feature. If Gemini API fails, skip DJ intro but still show reading animation. Cache TTS results by passage hash to avoid re-generating intros.

---

## Missing Critical Features

**Offline-First Architecture Not Implemented:**
- Problem: All backend features (Reverb, Parakeet, NL annotation) require network. If user loses connection mid-assessment, analysis cannot complete.
- Blocks: Cannot deploy to schools with unreliable WiFi or offline classrooms.
- Implementation gap: No service worker caching for API responses. No offline mode that degrades gracefully.

**Classroom Multi-Student Workflow Not Supported:**
- Problem: App is designed for single-student, single-teacher use. No bulk upload of student list, no class-level reports, no teacher dashboard showing all students' progress.
- Blocks: Teachers want to assess entire class in one session; current app requires entering each student individually.
- Implementation gap: No student roster import/export. No batch analysis job queue. No class-level metrics aggregation.

**Accessibility (A11y) Not Implemented:**
- Problem: App does not have ARIA labels, keyboard navigation, or screen reader support. Audio playback has no transcription. Visualizations (waveform, mountain range) are not described in text.
- Blocks: Blind students cannot use app. Deaf students cannot understand audio feedback.
- Implementation gap: No ARIA landmarks. No alt text for canvas visualizations. No keyboard shortcuts for common actions.

**Export/Report Generation Incomplete:**
- Problem: Assessment results can be viewed in-app but cannot be easily exported for teacher records or parent communication. No PDF report, no CSV export for grade books.
- Blocks: Teachers cannot share results with administrators or parents in standard format.
- Implementation gap: No PDF generation library. No CSV formatter for metrics.

---

## Test Coverage Gaps

**Alignment Edge Cases Not Covered:**
- What's not tested: BPE fragmentation (ASR tokenization errors), hyphenated words, abbreviation expansions, number word expansions
- Files: `js/alignment.js` (mergeCompoundWords, mergeAbbreviationExpansions, mergeNumberExpansions)
- Risk: Changes to merge logic may silently break edge cases. Example: merging "et"+"cetera" to "etcetera" for ref "etc." was added but no tests verify the merge produces correct hypIndex.
- Coverage goal: 100 test cases covering all merge patterns and hypIndex propagation

**Near-Miss Struggle Resolution Not Validated:**
- What's not tested: Multi-part struggles (hesitation + fragments + self-correction), struggle clusters crossing word boundaries, near-miss threshold sensitivity
- Files: `js/diagnostics.js` (resolveNearMissClusters, ~500 lines)
- Risk: Changes to `isNearMiss()` threshold affect struggle classification silently. No validation that students flagged as struggling match teacher observations.
- Coverage goal: 50+ real student samples with struggles annotated, compare algorithm output to annotations

**Proper Noun Forgiveness Validation Missing:**
- What's not tested: Proper nouns at sentence start, lowercase common words capitalized in passage, foreign names, brand names
- Files: `js/app.js` (NL annotation mapping, proper noun forgiveness logic)
- Risk: Proper nouns are inconsistently forgiven depending on NL API accuracy and presence in dictionary. No validation against real name diversity.
- Coverage goal: Test with 100+ proper names from diverse origins (African, Asian, Hispanic, etc.)

**Metrics Calculation Not Validated Against Published ORF Benchmarks:**
- What's not tested: WCPM calculation against official DIBELS benchmarks, accuracy percentages against published scoring rules
- Files: `js/metrics.js` (computeWCPM, computeAccuracy)
- Risk: Reported metrics may be off by 5–10% compared to official scoring, making results unusable for educational decisions.
- Coverage goal: Validate against 20 official ORF samples with known correct metrics

**VAD Ghost Detection Not Validated:**
- What's not tested: VAD threshold sensitivity, hallucinated word detection accuracy, false positive rate in noisy environments
- Files: `js/vad-processor.js`, `js/app.js` (VAD integration)
- Risk: Ghost detection may be too sensitive (false positives) or too loose (missed ghosts). No baseline established.
- Coverage goal: Test with 100 samples from quiet/noisy environments, compare VAD ghosts to manual annotation

---

*Concerns audit: 2026-02-18*
