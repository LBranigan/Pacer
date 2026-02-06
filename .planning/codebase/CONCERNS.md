# Codebase Concerns

**Analysis Date:** 2026-02-06

## Tech Debt

**Legacy Google STT Code (Unused but Present):**
- Issue: Google STT code remains in codebase despite Kitchen Sink pipeline replacement
- Files: `js/stt-api.js`, `js/ensemble-merger.js` (887 lines, marked legacy in comments)
- Impact: Code confusion, maintenance burden, 1000+ lines of dead code
- Fix approach: Remove `js/stt-api.js` and `js/ensemble-merger.js` after confirming Kitchen Sink stability. Update `js/app.js` line 4 comment that references ensemble-merger.

**Hardcoded API Key in Production Code:**
- Issue: Google Cloud API key hardcoded in `js/app.js` line 1256 for "dev/testing" but shipped in production
- Files: `js/app.js`
- Impact: API key exposure in public codebase, potential quota abuse
- Current mitigation: Key appears to be for Vision API (OCR feature)
- Recommendations: Move to environment variable or remove auto-fill entirely, use .env file pattern like Reverb service

**Inconsistent Timestamp Format:**
- Issue: Three different timestamp representations across codebase (string "X.XXs", float seconds, milliseconds)
- Files: `js/reverb-api.js` (normalizes both formats), `js/diagnostics.js` (parseTime helper), `js/ghost-detector.js` (parseTimeMs helper)
- Impact: Conversion bugs, performance overhead, error-prone calculations
- Fix approach: Standardize on single format (recommend float seconds) across entire pipeline

**sttLookup Canonical Mismatch:**
- Issue: sttLookup uses canonical forms but lookup often uses raw hyp text, causing compound word failures
- Files: `js/app.js` lines 613-618 (builds lookup), `js/ui.js` (performs lookups)
- Impact: Compound words fail metadata lookup, requiring synthetic entry workaround (app.js ~line 620)
- Fix approach: Refactor sttLookup to use consistent keys or normalize at lookup time

**No Service Worker Cache Versioning:**
- Issue: Service worker (sw.js) lacks cache invalidation strategy when CODE_VERSION changes
- Files: `js/app.js` line 29 (CODE_VERSION), `index.html` line 33-35 (SW registration)
- Impact: Users may run stale JavaScript after updates
- Fix approach: Inject CODE_VERSION into service worker, clear cache on version mismatch

**Debug Logging Always Enabled:**
- Issue: DEBUG_LOGGING flag hardcoded to `true` in production
- Files: `js/ensemble-merger.js` line 57
- Impact: Console pollution, potential performance overhead
- Fix approach: Tie to localStorage flag or remove entirely for dead code

## Known Bugs

**Reverb 100ms Timestamp Limitation:**
- Symptoms: Single-BPE-token words always show ~100ms duration regardless of actual speech
- Files: `services/reverb/server.py` (CTM parser), noted in MEMORY.md
- Trigger: Any short word transcribed by Reverb ASR
- Workaround: Multi-token words get accurate durations; system uses Deepgram timestamps as primary source
- Root cause: Inherent to wenet's CTC alignment (g_time_stamp_gap_ms = 100)

**Compound Word Tooltip Index Misalignment:**
- Symptoms: Tooltips for compound words may show wrong metadata
- Files: `js/ui.js` (tooltip rendering), `js/app.js` lines 648-660 (synthetic sttLookup entries)
- Trigger: Student says compound word split (e.g., "every one" for "everyone")
- Workaround: Synthetic sttLookup entries created after compound merge
- Safe modification: Test tooltip display after any alignment.js changes

**VAD Edge Tolerance Gaps:**
- Symptoms: Words within first/last 300ms of audio may be incorrectly flagged as ghosts or missed
- Files: `js/ghost-detector.js` lines 7, 30-35 (EDGE_TOLERANCE_MS)
- Trigger: Speech starts immediately or ends at recording boundary
- Current mitigation: Edge tolerance skips flagging, but may miss real issues

## Security Considerations

**API Key Exposure:**
- Risk: Google Cloud API key hardcoded in client-side JavaScript
- Files: `js/app.js` line 1256, `index.html` line 24 (API key input field)
- Current mitigation: Key is for Vision API only (OCR feature), limited scope
- Recommendations: Implement backend proxy for Vision API like Deepgram/Reverb pattern, remove client-side key storage

**LocalStorage Data Exposure:**
- Risk: Student data stored in browser localStorage without encryption
- Files: `js/storage.js` (STORAGE_KEY 'orf_data'), `js/audio-store.js` (IndexedDB for audio blobs)
- Current mitigation: Data remains on device, no server transmission
- Recommendations: Add export/import with encryption for sensitive deployments, warn users about shared device risks

**CORS Wildcard in Reverb Service:**
- Risk: Reverb service allows all origins (allow_origins=["*"])
- Files: `services/reverb/server.py` lines 40-45
- Current mitigation: Service runs locally on localhost:8765, not exposed to internet
- Recommendations: Restrict to specific origins (localhost, 127.0.0.1, file://) for production deployments

**Unvalidated Base64 Audio Input:**
- Risk: Reverb/Deepgram endpoints accept arbitrary base64 without size limits
- Files: `services/reverb/server.py` line 219 (base64 decode), `js/reverb-api.js`, `js/deepgram-api.js`
- Current mitigation: Timeout limits (120s Reverb, 30s Deepgram) prevent infinite processing
- Recommendations: Add MAX_AUDIO_SIZE validation in backend before decode

## Performance Bottlenecks

**Large File Monoliths:**
- Problem: app.js (1478 lines), ui.js (1151 lines) contain too much logic
- Files: `js/app.js`, `js/ui.js`
- Cause: God object anti-pattern, insufficient separation of concerns
- Improvement path: Extract alignment pipeline to dedicated orchestrator, split UI into view modules

**Synchronous Alignment Operations:**
- Problem: alignWords, mergeCompoundWords, resolveNearMissClusters run synchronously on main thread
- Files: `js/alignment.js`, `js/diagnostics.js`
- Cause: No Web Worker usage for CPU-intensive diff-match-patch operations
- Improvement path: Move alignment pipeline to Web Worker, post results back to main thread

**Excessive Console Logging:**
- Problem: 92 console.log/warn/error statements in production build
- Files: All JS files (grep showed 18 occurrences across 11 files for try/catch alone)
- Cause: No logging abstraction, debug code left in production
- Improvement path: Implement log level system, strip debug logs in production build

**VAD Reprocessing on Threshold Change:**
- Problem: Changing VAD threshold requires full audio reprocessing
- Files: `js/vad-processor.js` (processAudio method)
- Cause: VAD detection runs per-request, no cached segment data
- Improvement path: Cache raw VAD probabilities, recalculate thresholds without re-decoding audio

## Fragile Areas

**Near-Miss Resolution Pipeline Order:**
- Files: `js/app.js` lines 680-750 (pipeline orchestration), `js/diagnostics.js` (resolveNearMissClusters)
- Why fragile: Pipeline order matters - omission recovery MUST run before near-miss resolution
- Safe modification: Always test full pipeline after changing any step order, check for self-correction detection
- Test coverage: None - manual testing required

**Compound Word Detection:**
- Files: `js/alignment.js` lines 10-60 (mergeCompoundWords), `js/app.js` lines 648-660 (synthetic lookup)
- Why fragile: Multi-step detection with canonical form matching, easy to break with normalization changes
- Safe modification: Test with passages containing "everyone", "hotdog", "football" after changes
- Test coverage: None

**Disfluency Classification Logic:**
- Files: `js/disfluency-detector.js` (258 lines), `js/disfluency-tagger.js`, `js/disfluency-config.js`
- Why fragile: Complex state machine with lookahead, temporal windows, confidence thresholds
- Safe modification: Update `js/miscue-registry.js` first, use debug logger to trace classification
- Test coverage: None - relies on real-world audio testing

**Cross-Validation Alignment:**
- Files: `js/deepgram-api.js` (crossValidateWithDeepgram), `js/sequence-aligner.js` (Needleman-Wunsch)
- Why fragile: Sequence alignment with fuzzy matching, disagreement detection affects confidence display
- Safe modification: Test with known disagreement cases (proper nouns, rare words) after changes
- Test coverage: None

**VAD Gap Analysis:**
- Files: `js/vad-gap-analyzer.js` (289 lines), `js/diagnostics.js` (hesitation detection)
- Why fragile: Adjusts hesitation gaps based on VAD overhang, can remove valid hesitations if threshold wrong
- Safe modification: Check diagnostics.onsetDelays filtering logic (line 212) after VAD threshold changes
- Test coverage: None

## Scaling Limits

**Browser LocalStorage (5-10MB):**
- Current capacity: Unlimited number of students/assessments until quota hit
- Limit: Browser-dependent (5-10MB for localStorage, larger for IndexedDB audio)
- Scaling path: Implement quota monitoring, auto-delete old assessments, migrate to server-side storage

**Reverb GPU Memory (8GB VRAM Recommended):**
- Current capacity: Single concurrent request via gpu_lock
- Limit: Long audio files (>5 minutes) may exceed VRAM, causing OOM
- Scaling path: Add audio chunking for long files, implement queue system for multiple users

**Client-Side Processing (Single-Threaded):**
- Current capacity: One assessment at a time, 30-60 second passages
- Limit: CPU-bound alignment/diagnostics blocks UI on slow devices
- Scaling path: Migrate to Web Workers, implement progressive rendering

**IndexedDB Audio Storage:**
- Current capacity: 50MB-hundreds of MB depending on browser
- Limit: Audio blobs consume ~1-2MB per minute of recording
- Scaling path: Compress audio (reduce sample rate), implement LRU eviction policy

## Dependencies at Risk

**diff-match-patch (Unmaintained):**
- Risk: Library last updated 2018, no active maintenance
- Impact: Core alignment engine depends on this library
- Migration plan: Consider alternative diff algorithms (Myers, Patience), or vendor library into codebase

**VAD Web Library (@ricky0123/vad-web):**
- Risk: Relatively new library (v0.0.29), API may change
- Impact: Ghost detection and VAD gap analysis depend on this
- Migration plan: Pin version, monitor for breaking changes, consider Silero VAD direct integration

**ONNX Runtime Web (CDN Dependency):**
- Risk: CDN availability affects VAD functionality (loaded from jsdelivr)
- Impact: Ghost detection fails if CDN unreachable
- Migration plan: Self-host ONNX runtime files, add offline fallback

**Deepgram API (External Service):**
- Risk: Pricing changes, rate limits, service deprecation
- Impact: Cross-validation unavailable, falls back to Reverb-only (no disfluency detection)
- Migration plan: Make Deepgram fully optional, document Reverb-only mode

## Missing Critical Features

**No Test Suite:**
- Problem: Zero automated tests for 11,921 lines of JavaScript
- Blocks: Confident refactoring, regression detection, CI/CD implementation
- Priority: High - critical for maintaining complex alignment/diagnostic logic

**No Error Boundary/Recovery:**
- Problem: Pipeline failures crash entire assessment, no partial result recovery
- Blocks: Using app in unreliable network conditions
- Priority: Medium - add try/catch checkpoints, save intermediate results

**No Audio Preprocessing:**
- Problem: Background noise, volume normalization not handled before ASR
- Blocks: Accurate transcription in noisy environments
- Priority: Medium - add WebRTC audio processing (noise suppression, AGC)

**No Offline Mode:**
- Problem: Requires internet for Deepgram, local server for Reverb
- Blocks: Use in schools without reliable internet
- Priority: Low - requires bundling models locally

**No Multi-User Concurrency:**
- Problem: Reverb service processes one request at a time (gpu_lock)
- Blocks: Multiple simultaneous assessments
- Priority: Low - acceptable for single-teacher use case

## Test Coverage Gaps

**Alignment Edge Cases:**
- What's not tested: Empty reference, all omissions, all insertions, Unicode characters
- Files: `js/alignment.js`, `js/word-equivalences.js`
- Risk: Alignment crashes or produces incorrect results on edge cases
- Priority: High

**Pipeline Order Invariants:**
- What's not tested: Correct execution order (alignment → compound → omission recovery → near-miss → diagnostics)
- Files: `js/app.js` lines 600-800 (processAudio function)
- Risk: Reordering pipeline steps breaks self-correction detection
- Priority: High

**VAD Threshold Boundary Conditions:**
- What's not tested: Minimum (0.15), maximum (0.60), rapid threshold changes
- Files: `js/vad-processor.js`, `js/ghost-detector.js`
- Risk: Ghost detection fails or flags valid words incorrectly
- Priority: Medium

**Cross-Validation Disagreement Resolution:**
- What's not tested: All disagreement types (text mismatch, timing mismatch, one-sided detection)
- Files: `js/deepgram-api.js` (crossValidateWithDeepgram)
- Risk: Words incorrectly marked as confirmed/disagreed/unconfirmed
- Priority: Medium

**Error Recovery Paths:**
- What's not tested: Reverb failure → Deepgram fallback, Deepgram unavailable, VAD failure
- Files: `js/kitchen-sink-merger.js`, `js/app.js`
- Risk: Fallback paths untested, may fail in production
- Priority: Medium

**LocalStorage Migration:**
- What's not tested: Storage version upgrades (v1→v2→v3→v4→v5)
- Files: `js/storage.js` lines 12-52 (migrate function)
- Risk: Data loss during version migration
- Priority: Low - migrations are append-only

---

*Concerns audit: 2026-02-06*
