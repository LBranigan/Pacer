# Codebase Structure

**Analysis Date:** 2026-02-06

## Directory Layout

```
googstt/
├── .planning/             # Planning and documentation
│   ├── codebase/          # Codebase analysis documents
│   ├── milestones/        # Milestone tracking
│   ├── phases/            # Phase plans and summaries
│   └── research/          # Research documents
├── Calibration tests/     # Audio test files for calibration
├── css/                   # Stylesheets
│   └── student-playback.css
├── debug/                 # Debug output directory
├── docs/                  # Technical documentation
├── emma tests/            # Test audio files
├── FuturePlans/           # Future feature plans
├── icons/                 # PWA icons
├── js/                    # JavaScript modules (~12k LOC)
│   ├── alignment.js
│   ├── app.js             # Main orchestrator (~1800 LOC)
│   ├── audio-*.js         # Audio handling modules
│   ├── confidence-*.js    # Confidence classification
│   ├── deepgram-api.js    # Deepgram client
│   ├── diagnostics.js     # Error detection (~650 LOC)
│   ├── disfluency-*.js    # Disfluency detection
│   ├── kitchen-sink-merger.js  # Pipeline coordinator
│   ├── metrics.js         # WCPM/accuracy calculation
│   ├── miscue-registry.js # Single source of truth for error types
│   ├── reverb-api.js      # Reverb client
│   ├── sequence-aligner.js # Needleman-Wunsch algorithm
│   ├── storage.js         # LocalStorage CRUD
│   ├── ui.js              # UI rendering (~1300 LOC)
│   ├── vad-*.js           # Voice activity detection
│   └── word-equivalences.js
├── keys/                  # API keys (not committed)
├── services/              # Backend services
│   └── reverb/            # Reverb ASR service
│       ├── server.py      # FastAPI server (~350 LOC)
│       ├── Dockerfile
│       ├── docker-compose.yml
│       ├── requirements.txt
│       └── .env           # Deepgram API key (not committed)
├── index.html             # Main application entry point
├── playback.html          # Student gamified playback view
├── manifest.json          # PWA manifest
├── style.css              # Main stylesheet
├── sw.js                  # Service worker
├── start_services.bat     # Windows service startup script
└── stop_services.bat      # Windows service shutdown script
```

## Directory Purposes

**`.planning/`:**
- Purpose: Project planning and documentation (not runtime code)
- Contains: Phase plans, milestone tracking, research documents
- Key files: `MILESTONES.md`, phase subdirectories with PLAN/SUMMARY/RESEARCH/VERIFICATION

**`css/`:**
- Purpose: Stylesheets for specialized views
- Contains: `student-playback.css` for gamified playback view
- Key files: `student-playback.css`

**`docs/`:**
- Purpose: Technical design documents
- Contains: Architecture plans, research notes
- Key files: `pipeline-architecture.html`, `near-miss-struggle-selfcorrection-plan.md`, `vad-gap-analysis-plan.md`

**`js/`:**
- Purpose: All JavaScript modules (ES6 modules, ~12k LOC total)
- Contains: Application logic, API clients, algorithms, UI rendering
- Key files: `app.js` (orchestrator), `kitchen-sink-merger.js`, `diagnostics.js`, `ui.js`, `alignment.js`

**`services/reverb/`:**
- Purpose: Backend ASR service (Docker container)
- Contains: FastAPI server, model loading, dual-pass transcription
- Key files: `server.py`, `Dockerfile`, `docker-compose.yml`

**`icons/`:**
- Purpose: PWA icons for home screen installation
- Contains: Icon files for various resolutions
- Generated: No, manually created

**`Calibration tests/`, `emma tests/`:**
- Purpose: Test audio files for development and calibration
- Contains: WAV files for testing pipeline
- Committed: Yes

**`debug/`:**
- Purpose: Debug log output directory
- Contains: JSON logs from debug logger
- Committed: No

**`FuturePlans/`:**
- Purpose: Feature ideas and future work
- Contains: Planning documents
- Committed: Yes

**`keys/`:**
- Purpose: API key storage (not committed to git)
- Contains: Google Cloud API keys
- Committed: No (in .gitignore)

## Key File Locations

**Entry Points:**
- `index.html`: Main application entry point
- `playback.html`: Student playback view entry point
- `sw.js`: Service worker registration

**Configuration:**
- `manifest.json`: PWA configuration
- `services/reverb/docker-compose.yml`: Backend service configuration
- `services/reverb/.env`: Deepgram API key (not committed)

**Core Logic:**
- `js/app.js`: Main orchestrator (1800+ lines)
- `js/kitchen-sink-merger.js`: Pipeline coordinator (330+ lines)
- `js/diagnostics.js`: Error detection logic (650+ lines)
- `js/alignment.js`: Word-level alignment (167 lines)
- `js/metrics.js`: Fluency metrics (110 lines)

**ASR Integration:**
- `js/reverb-api.js`: Reverb HTTP client
- `js/deepgram-api.js`: Deepgram HTTP client
- `services/reverb/server.py`: Backend FastAPI server

**UI Rendering:**
- `js/ui.js`: Main UI rendering (1300+ lines)
- `style.css`: Main application styles
- `css/student-playback.css`: Playback view styles

**Data Persistence:**
- `js/storage.js`: LocalStorage CRUD (148 lines)
- `js/audio-store.js`: IndexedDB for audio blobs

**Algorithms:**
- `js/sequence-aligner.js`: Needleman-Wunsch alignment (300+ lines)
- `js/disfluency-tagger.js`: Disfluency classification (250+ lines)
- `js/vad-processor.js`: Voice activity detection (280+ lines)

**Utilities:**
- `js/word-equivalences.js`: Canonical word forms (260+ lines)
- `js/text-normalize.js`: Text normalization
- `js/nl-api.js`: Google NL API client (205+ lines)
- `js/phonetic-utils.js`: Phonetic comparison utilities
- `js/miscue-registry.js`: Error type definitions (single source of truth)

**Testing:**
- No automated test framework detected
- Manual testing via `Calibration tests/` and `emma tests/` directories

## Naming Conventions

**Files:**
- JavaScript modules: `kebab-case.js` (e.g., `kitchen-sink-merger.js`, `word-equivalences.js`)
- HTML pages: `lowercase.html` (e.g., `index.html`, `playback.html`)
- Python modules: `snake_case.py` (e.g., `server.py`)
- Configuration: `lowercase.json`, `kebab-case.yml`

**Directories:**
- Lowercase with spaces: `Calibration tests/`, `emma tests/`
- Lowercase no spaces: `js/`, `css/`, `docs/`, `icons/`, `services/`
- Leading dot for meta: `.planning/`, `.git/`, `.claude/`

**Functions:**
- camelCase: `alignWords()`, `computeWCPM()`, `runDiagnostics()`
- Exported functions: Named exports (e.g., `export function alignWords()`)

**Variables:**
- camelCase: `transcriptWords`, `alignmentResult`, `kitchenSinkResult`
- Constants: UPPER_SNAKE_CASE: `VAD_THRESHOLD_DEFAULT`, `FILLER_WORDS`, `CODE_VERSION`

**Classes:**
- PascalCase: `VADProcessor`
- Rare in codebase (functional approach preferred)

**Module exports:**
- Named exports preferred over default exports
- Example: `export function alignWords() { ... }` not `export default alignWords`

## Where to Add New Code

**New ASR Engine Integration:**
- Primary code: `js/{engine-name}-api.js` (HTTP client)
- Backend proxy: Add endpoint to `services/reverb/server.py` if needed
- Pipeline integration: Update `js/kitchen-sink-merger.js` to include new engine

**New Error Type (Miscue):**
- **CRITICAL:** Update `js/miscue-registry.js` first (single source of truth)
- Detection logic: Add detector function to `js/diagnostics.js`
- UI rendering: Update `js/ui.js` to handle new miscue type in tooltips/badges
- Legend: Update `index.html` legend section with tooltip explaining the miscue

**New Metric:**
- Implementation: `js/metrics.js`
- Display: Update `js/ui.js` to render metric in results box

**New UI Feature:**
- HTML structure: `index.html`
- Event handlers and rendering: `js/ui.js`
- Styles: `style.css`

**New Diagnostic Check:**
- Implementation: `js/diagnostics.js`
- Call from: `js/app.js` in pipeline flow (around line 550-650)

**New Persistence Field:**
- Schema migration: Add version bump in `js/storage.js` migrate function
- Save logic: Update `saveAssessment()` in `js/storage.js`
- Load logic: Update UI rendering in `js/ui.js`

**New Backend Service:**
- Service directory: `services/{service-name}/`
- Startup script: Update `start_services.bat` and `stop_services.bat`
- Client: `js/{service-name}-api.js`

**New Utility Function:**
- Text processing: `js/text-normalize.js`
- Word comparison: `js/word-equivalences.js`
- Phonetic analysis: `js/phonetic-utils.js`
- Generic helpers: Create new utility module in `js/`

## Special Directories

**`.planning/`:**
- Purpose: GSD (Get Stuff Done) planning framework documents
- Generated: Yes, by Claude Code planning commands
- Committed: Yes

**`debug/`:**
- Purpose: Debug log output from `js/debug-logger.js`
- Generated: Yes, at runtime when debug mode enabled
- Committed: No

**`keys/`:**
- Purpose: API key storage (not committed)
- Generated: No, manually created by user
- Committed: No (in .gitignore)

**`services/reverb/__pycache__/`:**
- Purpose: Python bytecode cache
- Generated: Yes, by Python interpreter
- Committed: No

**`.planning/research/bigsearch/`:**
- Purpose: Research output from deep investigation tasks
- Generated: Yes, by research agents
- Committed: Yes

**`node_modules/`:**
- Purpose: Would contain npm dependencies (if present)
- Generated: Would be generated by npm install
- Committed: No
- **Note:** Not present in this project (no package.json with dependencies)

## Module Import Patterns

**ES6 Module Style:**
```javascript
// Named imports
import { alignWords } from './alignment.js';
import { computeWCPM, computeAccuracy } from './metrics.js';

// Multiple imports from same module
import {
  runDiagnostics,
  computeTierBreakdown,
  resolveNearMissClusters
} from './diagnostics.js';
```

**No Bundler:**
- Native ES6 modules loaded directly by browser
- No webpack, Rollup, or other bundler
- File extensions required in imports (`.js`)

**External Libraries:**
- Loaded via CDN in `index.html`:
  - `diff_match_patch.js` (global variable)
  - ONNX Runtime Web (global `ort`)
  - Silero VAD (global `vad`)

## Code Organization Principles

**Separation of Concerns:**
- UI logic isolated in `js/ui.js`
- Business logic in `js/app.js`
- Algorithms in dedicated modules (`alignment.js`, `sequence-aligner.js`)
- API clients in `*-api.js` modules

**Single Responsibility:**
- Each module has focused purpose
- `miscue-registry.js` is single source of truth for error types
- `metrics.js` only calculates metrics, doesn't render UI
- `storage.js` only handles persistence, no business logic

**Dependency Direction:**
- UI layer depends on Application layer
- Application layer depends on Services layer
- No circular dependencies
- Utilities used by all layers

**Backend Separation:**
- GPU-intensive ASR processing in Docker container
- Browser handles alignment, diagnostics, UI
- Clear HTTP API boundary between frontend and backend

---

*Structure analysis: 2026-02-06*
