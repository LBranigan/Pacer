# Codebase Structure

**Analysis Date:** 2026-02-18

## Directory Layout

```
googstt/                          # Project root
├── index.html                    # Main assessment app entry point
├── style.css                     # Main app stylesheet (all non-satellite styles)
├── sw.js                         # Service worker (PWA caching)
├── manifest.json                 # PWA manifest
├── env.js                        # Runtime env vars (loaded by index.html)
├── backend-config.json           # Backend URL/token (auto-written by start_services.bat)
├── rhythm-remix.html             # Satellite: bouncing-ball lo-fi playback
├── playback.html                 # Satellite: animated student reading adventure
├── maze.html                     # Satellite: post-assessment maze comprehension game
├── illustrator.html              # Satellite: AI illustration generator
├── future-you.html               # Satellite: future career motivator
├── dashboard.html                # Teacher dashboard + celeration chart
├── orf_assessment.html           # Legacy ORF assessment page (not primary)
├── report.html                   # Standalone printable report
├── js/                           # All JavaScript modules (ES modules)
├── css/                          # Satellite page stylesheets
├── data/                         # Static data files (CMUdict JSON)
├── services/                     # Backend service (Docker + Python)
│   └── reverb/                   # FastAPI ASR backend
├── icons/                        # PWA icons (icon-192.png, icon-512.png)
├── docs/                         # Design documents and proposals
│   └── legacy documents/         # Archived design docs
├── .planning/                    # GSD planning artifacts
│   ├── codebase/                 # Codebase analysis documents (this dir)
│   ├── milestones/               # Milestone definitions
│   └── phases/                   # Phase implementation plans
├── mockups/                      # HTML mockup prototypes
├── outputs/                      # Debug run outputs (pipeline JSON logs)
├── audio files/                  # Sample audio for manual testing
├── Calibration tests/            # Calibration test files
├── FuturePlans/                  # Future feature research notes
├── start_services.bat            # Windows: start Docker backend
├── start_services.sh             # Linux: start Docker backend
├── stop_services.bat             # Windows: stop Docker backend
└── CLAUDE.md                     # Project-specific AI coding instructions
```

## Directory Purposes

**`js/`:**
- Purpose: All application JavaScript — pipeline, UI, API clients, utilities
- Contains: ES modules only; no bundler, no build step
- Key files:
  - `js/app.js` — main orchestrator (~1800 lines); entire assessment pipeline lives here
  - `js/alignment.js` — Needleman-Wunsch aligner with graded substitution costs
  - `js/diagnostics.js` — all fluency detectors (~82K bytes); largest module after ui.js
  - `js/ui.js` — all DOM rendering (~119K bytes); largest module
  - `js/kitchen-sink-merger.js` — parallel Reverb + Parakeet invocation
  - `js/cross-validator.js` — engine-agnostic second-engine orchestrator
  - `js/reverb-api.js` — Reverb HTTP client (`/ensemble` endpoint)
  - `js/parakeet-api.js` — Parakeet HTTP client (`/parakeet` endpoint)
  - `js/deepgram-api.js` — Deepgram Nova-3 HTTP client (alternative cross-validator)
  - `js/storage.js` — localStorage CRUD for students and assessments (v6 schema)
  - `js/audio-store.js` — IndexedDB CRUD for audio blobs
  - `js/text-normalize.js` — canonical text normalization (`normalizeText()`, `splitHyphenParts()`)
  - `js/word-equivalences.js` — canonical form mapping (`getCanonical()`)
  - `js/miscue-registry.js` — single source of truth for all miscue types (~47K bytes)
  - `js/metrics.js` — WCPM and accuracy computation
  - `js/nl-api.js` — Google Cloud Natural Language API + Levenshtein utilities
  - `js/vad-processor.js` — Silero VAD wrapper (speech activity detection)
  - `js/vad-gap-analyzer.js` — VAD-based gap enrichment for hesitations
  - `js/phoneme-counter.js` — CMUdict phoneme lookup with syllable fallback
  - `js/recorder.js` — MediaRecorder wrapper
  - `js/audio-padding.js` — WAV silence padding
  - `js/backend-config.js` — backend URL/token resolution
  - `js/debug-logger.js` — structured pipeline stage logging
  - `js/rhythm-remix.js` — Rhythm Remix orchestrator (~49K bytes)
  - `js/lofi-engine.js` — Web Audio lo-fi synthesizer (~65K bytes)
  - `js/mountain-range.js` — canvas audio waveform visualization
  - `js/passage-trimmer.js` — trim passage to attempted words
  - `js/number-words.js` — number-to-spoken-form expansion (0–999,999)
  - `js/syllable-counter.js` — syllable counting
  - `js/syllable-analysis.js` — syllable coverage analysis
  - `js/ocr-api.js` — OCR extraction from images (~23K bytes)
  - `js/maze-generator.js` / `js/maze-game.js` — maze comprehension game
  - `js/illustrator.js` — AI illustration page
  - `js/future-you.js` — future-you motivator page
  - `js/student-playback.js` — animated student playback
  - `js/celeration-chart.js` — progress celeration chart
  - `js/dashboard.js` — teacher dashboard init
  - `js/benchmarks.js` — ORF grade-level benchmarks
  - `js/gamification.js` — score/badge computation
  - `js/noun-emoji-map.js` — noun→emoji mapping for illustrator
  - `js/effect-engine.js` / `js/sprite-animator.js` — visual effects
  - `js/movie-trailer.js` — Gemini TTS movie trailer feature
  - `js/audio-playback.js` — shared audio playback utilities

**`css/`:**
- Purpose: Satellite page stylesheets (main app uses `style.css` in root)
- Contains: `rhythm-remix.css`, `student-playback.css`, `maze.css`, `illustrator.css`, `future-you.css`

**`data/`:**
- Purpose: Static reference data shipped with app
- Key files: `cmudict-phoneme-counts.json` (125,940-word phoneme count map, ~1.6MB)

**`services/reverb/`:**
- Purpose: Local GPU ASR backend (Docker container)
- Contains: `server.py` (FastAPI), `Dockerfile`, `docker-compose.yml`, `requirements.txt`
- Key endpoints: `POST /ensemble`, `POST /parakeet`, `GET /health`

**`docs/`:**
- Purpose: Design rationale and proposals for major architectural decisions
- Contains: `system-architecture.html`, `pwa-student-app-design.md`, various `*-plan.md` and `*-proposal.md` files

**`.planning/`:**
- Purpose: GSD planning artifacts (not shipped)
- Generated: No
- Committed: Yes (planning files)

**`outputs/`:**
- Purpose: Debug pipeline JSON logs from past runs (`run_YYYYMMDD_HHMMSS_*/iter_N/`)
- Generated: Yes
- Committed: No (in `.gitignore`)

## Key File Locations

**Entry Points:**
- `index.html`: Main app — teacher-facing assessment interface
- `rhythm-remix.html`: Lo-fi reading playback satellite
- `playback.html`: Student adventure playback satellite
- `maze.html`: Maze comprehension game satellite
- `dashboard.html`: Teacher progress dashboard
- `services/reverb/server.py`: GPU backend service

**Configuration:**
- `backend-config.json`: Backend URL/token (auto-written by startup scripts; read by `js/backend-config.js`)
- `manifest.json`: PWA manifest (icons, theme, start_url)
- `services/reverb/docker-compose.yml`: Docker GPU configuration

**Core Logic:**
- `js/app.js`: Full pipeline orchestrator — read this first to understand the system
- `js/alignment.js`: NW alignment — word-to-reference mapping
- `js/diagnostics.js`: All fluency detectors — hesitations, struggles, pace, disfluencies
- `js/kitchen-sink-merger.js`: Parallel ASR invocation with fallback

**Testing:**
- No automated test files found; testing is manual via browser + debug log output
- `outputs/` directory contains past pipeline run JSON for analysis
- `audio files/` and `Calibration tests/` contain sample audio for manual testing

## Naming Conventions

**Files:**
- All lowercase with hyphens: `kitchen-sink-merger.js`, `vad-gap-analyzer.js`, `audio-padding.js`
- Feature-grouped: `[feature]-api.js` for HTTP clients, `[feature]-[role].js` for complex features
- Satellite page files match their HTML: `rhythm-remix.html` ↔ `js/rhythm-remix.js` ↔ `css/rhythm-remix.css`

**Directories:**
- Lowercase or Title Case for non-code dirs (`docs/`, `data/`, `FuturePlans/`, `Calibration tests/`)
- Lowercase for code dirs (`js/`, `css/`, `services/`)

**Functions:**
- camelCase throughout: `runKitchenSinkPipeline()`, `alignWords()`, `computeWCPM()`
- Prefix pattern for API clients: `sendTo[Engine]()`, `isAvailable[Engine]()`
- Prefix pattern for compute functions: `compute[Metric]()`, `detect[Phenomenon]()`

**Variables / Properties:**
- Public alignment entry properties: camelCase (`crossValidation`, `hypIndex`, `forgiven`)
- Internal/debug properties: underscore prefix (`_isStruggle`, `_pkTrustOverride`, `_notAttempted`, `_xvalWord`, `_reverbStartTime`)
- Feature flags in localStorage: `orf_[feature_name]` prefix (e.g., `orf_use_kitchen_sink`, `orf_cross_validator`)

## Where to Add New Code

**New ASR engine:**
- Add client: `js/[engine]-api.js` following `js/parakeet-api.js` pattern
- Register in engine router: `js/cross-validator.js` (add `case '[engine]':` to `sendToCrossValidator`)
- Add availability check: `js/cross-validator.js` `isCrossValidatorAvailable()`
- Add UI radio button: `index.html` `#xvalEngineSection`

**New miscue type:**
- Implement detector in `js/diagnostics.js`
- Register in `js/miscue-registry.js` (REQUIRED per CLAUDE.md)
- Add UI rendering in `js/ui.js`

**New forgiveness / leniency pass:**
- Add Phase N block in `js/app.js` after the 3-way verdict section (~line 1680+)
- Add flag naming convention: `entry._[name]Variant`, `entry.forgiven = true`
- Register miscue type in `js/miscue-registry.js`

**New diagnostic metric:**
- Add `compute[Metric]()` function in `js/diagnostics.js`
- Call from `runDiagnostics()` or add as standalone call in `js/app.js` after `runDiagnostics()`
- Add rendering in `js/ui.js`

**New satellite page:**
- Create `[feature].html` at root
- Create `js/[feature].js` (ES module)
- Create `css/[feature].css` if needed
- Add launcher button function in `js/app.js` following `showPlaybackButton()` pattern
- Read assessment data via `getAssessment()` from `js/storage.js`

**Shared utilities:**
- Text normalization: `js/text-normalize.js` (caution: 5 places must stay in sync)
- Word equivalences: `js/word-equivalences.js`
- Phoneme data: `js/phoneme-counter.js` + `data/cmudict-phoneme-counts.json`

## Special Directories

**`.planning/`:**
- Purpose: GSD orchestration artifacts, phase plans, codebase maps
- Generated: Partially (written by GSD tools)
- Committed: Yes

**`outputs/`:**
- Purpose: Debug pipeline JSON snapshots from past assessment runs
- Generated: Yes (by debug-logger export)
- Committed: No (`.gitignore`)

**`services/reverb/__pycache__/`:**
- Purpose: Python bytecode cache
- Generated: Yes
- Committed: No

---

*Structure analysis: 2026-02-18*
