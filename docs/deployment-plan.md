# Deployment Plan: GitHub Pages + Cloudflare Tunnel

## Current State

Everything runs on the home machine:
- Frontend served via `python -m http.server`
- Backend (Reverb/Parakeet/Deepgram proxy) via Docker on `localhost:8765`
- Only accessible from that machine

## Goal

- Access and test from **any device** (phone, tablet, work computer)
- Keep GPU inference running on **home computer**
- Minimal code changes, minimal cost

## Why GitHub Pages (not Firebase)

Firebase Hosting does the same thing as GitHub Pages (static file hosting) but adds complexity: CLI tooling, deploy commands, a separate account. The repo is already on GitHub — GitHub Pages is free, zero-config, and auto-deploys on push. Firebase offers no advantage here.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  ANY DEVICE (phone, laptop, work PC)                │
│  Browser → https://yourusername.github.io/googstt   │
└──────────────────────┬──────────────────────────────┘
                       │ HTTPS
                       ▼
┌──────────────────────────────────────────────────────┐
│  GITHUB PAGES (free)                                 │
│  Serves: index.html, style.css, js/*.js, etc.        │
│  Auto-deploys on git push to master                  │
└──────────────────────────────────────────────────────┘

                       │ HTTPS (fetch calls)
                       ▼
┌──────────────────────────────────────────────────────┐
│  CLOUDFLARE TUNNEL (free)                            │
│  https://orf-api.yourdomain.com → localhost:8765     │
│  OR                                                  │
│  https://xxx.trycloudflare.com → localhost:8765      │
└──────────────────────┬──────────────────────────────┘
                       │ localhost
                       ▼
┌──────────────────────────────────────────────────────┐
│  HOME PC (Docker, NVIDIA GPU)                        │
│  FastAPI server on :8765                             │
│  Reverb + Parakeet + Deepgram proxy                  │
└──────────────────────────────────────────────────────┘
```

---

## Codebase Research Findings

> Research performed 2026-02-07 by 5 parallel agents analyzing every JS file,
> the server, service worker, module system, storage patterns, and git state.

### Module System: CONFIRMED COMPATIBLE

The codebase is **pure ES6 modules** — no bundler, no build step. `index.html` loads a single entry point:
```html
<script type="module" src="js/app.js"></script>
```
All 48 JS files use `import`/`export`. The proposed `backend-config.js` with `export const` is fully idiomatic and matches existing patterns (e.g., `confidence-config.js`).

### Backend URL References: COMPLETE INVENTORY

| File | Line | Current Code | Needs Update |
|------|------|--------------|--------------|
| `js/reverb-api.js` | 14 | `window.REVERB_API_URL \|\| 'http://localhost:8765'` | YES |
| `js/deepgram-api.js` | 11 | `const BACKEND_BASE_URL = 'http://localhost:8765'` | YES |
| `js/parakeet-api.js` | 13 | `const BACKEND_BASE_URL = 'http://localhost:8765'` | YES |
| `js/maze-game.js` | 14 | `const BACKEND_BASE_URL = 'http://localhost:8765'` | YES |
| `js/kitchen-sink-merger.js` | — | No URL references (delegates to other modules) | NO |

**Total: 4 files need updating. `kitchen-sink-merger.js` does NOT reference URLs directly — it delegates to `cross-validator.js` which imports from `deepgram-api.js` / `parakeet-api.js`.**

### Backend Endpoints (from server.py)

| Endpoint | Method | Purpose | GPU Lock | Timeout (client) |
|----------|--------|---------|----------|-------------------|
| `/health` | GET | Status + GPU info + model availability | No | 3s |
| `/ensemble` | POST | Dual-pass Reverb (verbatim + clean) | Yes | 120s |
| `/deepgram` | POST | Deepgram Nova-3 proxy | No | 30s |
| `/parakeet` | POST | Parakeet TDT local GPU | Yes | 40s |
| `/deepgram-maze` | POST | Keyterm-boosted maze transcription | No | 8s |

No WebSocket or EventSource endpoints — all HTTP request/response. Cloudflare Tunnel handles this perfectly.

### Service Worker: NEEDS ATTENTION

`sw.js` caches 33 files in `SHELL` but is **missing 19 JS modules** that are imported by cached files. Currently works because uncached modules are fetched from network as a fallback. But the cache-first strategy (`caches.match → fetch`) means:
- If a user visits once and the SW caches the shell, then the app is updated on GitHub Pages, **cached files serve stale versions** until `CACHE_NAME` version is bumped.
- **New `backend-config.js` must be added to the SHELL list.**

### CORS: WORKS AS-IS (with caveat for auth)

```python
# server.py lines 42-47
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],  # ← ONLY Content-Type allowed
)
```

`allow_origins=["*"]` works for GitHub Pages. **BUT** if the auth token feature is added, `Authorization` header must be added to `allow_headers` or browsers will block the CORS preflight.

---

## Implementation Tasks

### Task 1: Create shared backend config module

**Create `js/backend-config.js`:**
```javascript
// Single source of truth for backend URL and optional auth token.
// Values read from localStorage once at module load time.
// Changing the URL requires a page reload (acceptable for infra config).

export const BACKEND_URL = localStorage.getItem('orf_backend_url')
  || 'http://localhost:8765';

export const BACKEND_TOKEN = localStorage.getItem('orf_backend_token') || '';
```

> **Note on module evaluation timing:** ES module top-level code runs once at
> import time. If the user changes the backend URL input, the new value must be
> saved to `localStorage` and the page reloaded.
>
> **Design choice:** Existing config modules (`cross-validator.js`,
> `kitchen-sink-merger.js`) use a **function-based** pattern —
> `getCrossValidatorEngine()` re-reads localStorage on every call, avoiding
> reload. The `export const` pattern chosen here diverges from that convention
> but is justified: the backend URL is infrastructure config that changes
> rarely (once per session at most), and all 4 consuming modules read it at
> import time for their own `const` declarations. A function-based pattern
> would add indirection without benefit since each fetch call would still
> use the cached module-level variable.

**Update these 4 files to import from it:**

1. **`js/reverb-api.js`** (line 14) — replace:
   ```javascript
   const REVERB_URL = window.REVERB_API_URL || 'http://localhost:8765';
   ```
   with:
   ```javascript
   import { BACKEND_URL } from './backend-config.js';
   ```
   Then use `BACKEND_URL` in place of `REVERB_URL` throughout.

2. **`js/deepgram-api.js`** (line 11) — replace:
   ```javascript
   const BACKEND_BASE_URL = 'http://localhost:8765';
   ```
   with:
   ```javascript
   import { BACKEND_URL } from './backend-config.js';
   ```
   Then use `BACKEND_URL` in place of `BACKEND_BASE_URL`.

3. **`js/parakeet-api.js`** (line 13) — same pattern as deepgram-api.js.

4. **`js/maze-game.js`** (line 14) — same pattern.

**NOT needed:** `kitchen-sink-merger.js` does not reference backend URLs (confirmed by research — it delegates to `cross-validator.js` → `deepgram-api.js` / `parakeet-api.js`).

### Task 2: Add backend URL input to UI

Add a collapsible connection settings section to `index.html`, positioned after the API Key field (line 25) and before Ghost Detection Settings. Match the existing `.section` layout pattern.

**Fields:**
- Backend URL input (text, placeholder `http://localhost:8765`)
- Auth token input (password, placeholder `Optional — leave blank for local use`)
- Connection status indicator (shows `/health` response: Reverb/Parakeet/Deepgram availability)

**Behavior:**
- On change → save to `localStorage('orf_backend_url')` / `localStorage('orf_backend_token')`
- Show "Reload required" notice if URL changed after initial load
- On page load → pre-fill from localStorage, auto-run `/health` check
- Pattern: matches existing `orf_cross_validator` persistence in `cross-validator.js`

**Existing localStorage keys for reference:**
| Key | Purpose |
|-----|---------|
| `orf_data` | Students + assessments |
| `orf_dev_mode` | Dev mode toggle |
| `orf_use_kitchen_sink` | Pipeline feature flag |
| `orf_cross_validator` | Cross-validator engine (parakeet/deepgram) |
| `orf_playback_theme` | Playback adventure theme |
| `orf_playback_student` | Student ID for playback window |
| `orf_playback_assessment` | Assessment ID for playback window |
| `orf_dashboard_student` | Student ID for dashboard window |
| `orf_report_student` | Student ID for report window |
| `orf_report_chart` | Canvas chart snapshot (data URL) |
| **`orf_backend_url`** | **(NEW)** Backend base URL |
| **`orf_backend_token`** | **(NEW)** Optional auth bearer token |

### Task 3: Create `.gitignore`

> **CRITICAL FIX:** The original plan proposed gitignoring `data/`. This would
> **BREAK THE APP** because `data/cmudict-phoneme-counts.json` (1.6MB, 125K
> words) is a runtime dependency fetched by `phoneme-counter.js` via
> `fetch('data/cmudict-phoneme-counts.json')`. Without it, phoneme
> normalization in the word speed map silently degrades to a less accurate
> syllable-based fallback. This file is already tracked in git and MUST remain
> tracked.

```gitignore
# API keys and credentials (CRITICAL — never commit)
keys/
services/reverb/.env
.env
.env.local

# Audio test files (large, user-specific)
audio files/

# Python build artifacts
*.pyc
__pycache__/
services/reverb/__pycache__/

# OS artifacts
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
```

**What is NOT gitignored (and why):**
| Path | Reason to KEEP |
|------|----------------|
| `data/cmudict-phoneme-counts.json` | Runtime dependency — fetched by browser at analysis time |
| `.planning/` | Development documentation — tracked in git history |
| `docs/` | Project documentation |
| `services/reverb/server.py` | Backend source code |
| `services/reverb/Dockerfile` | Deployment config |
| `services/reverb/docker-compose.yml` | Deployment config |

> **Security note:** `keys/` directory currently contains 5 plaintext API key
> files (Google, Deepgram, Brave, HuggingFace) that are untracked. The
> `.gitignore` must be committed BEFORE any `git add .` to prevent accidental
> exposure. Also `services/reverb/.env` contains live `DEEPGRAM_API_KEY` and
> `HF_TOKEN`.

### Task 4: Update service worker cache

Add `backend-config.js` to the `sw.js` SHELL list and bump the cache version:

```javascript
const CACHE_NAME = 'orf-v38';  // was v37

const SHELL = [
  // ... existing entries ...
  './js/backend-config.js',     // NEW
  // ... rest of list ...
];
```

> **Note:** The service worker uses cache-first for non-navigate requests. On
> GitHub Pages, every `git push` deploys new files but cached files remain stale
> until the SW itself updates (which triggers `install` → new cache → `activate`
> → delete old). This works correctly as long as `CACHE_NAME` is bumped with
> each release. The existing `skipWaiting()` + `clients.claim()` pattern ensures
> the new SW takes over immediately.
>
> **Broader cache gap:** 19 JS modules imported by cached files are NOT in the
> SHELL list (e.g., `reverb-api.js`, `deepgram-api.js`, `parakeet-api.js`,
> `cross-validator.js`, `phoneme-counter.js`, `confidence-config.js`,
> `syllable-counter.js`, `miscue-registry.js`, `word-equivalences.js`, etc.).
> These are fetched on demand from network. This is fine for online use but
> means the app won't work fully offline. Consider adding all JS modules to
> SHELL in a future update if offline support matters.

### Task 5: Enable GitHub Pages (one-time)

1. Ensure `.gitignore` is committed first (Task 3)
2. Push repo to GitHub
3. Go to Settings → Pages → Source: Deploy from branch `master`, root `/`
4. App is live at `https://yourusername.github.io/googstt`
5. Every `git push` auto-deploys

> **GitHub Pages serves `data/cmudict-phoneme-counts.json` as a static file.**
> The browser fetches it at runtime just like from `python -m http.server`.
> No special configuration needed — the relative path `data/...` resolves
> correctly because the app is served from the repo root.

### Task 6: Set up Cloudflare Tunnel on home PC

**Option A: Quick tunnel (no account needed, URL changes each restart)**
```bash
# Install cloudflared
# Then just run:
cloudflared tunnel --url http://localhost:8765
# Gives you: https://some-random-words.trycloudflare.com
```

**Option B: Named tunnel (free Cloudflare account, stable URL)**
```bash
cloudflared tunnel create orf-api
cloudflared tunnel route dns orf-api orf-api.yourdomain.com
cloudflared tunnel run orf-api
```
Permanent `https://orf-api.yourdomain.com` that always points to home PC's `:8765`.

**Option C: Tailscale (private access, your devices only)**
Tailscale creates a private VPN mesh. Only devices signed into your Tailscale account can reach the backend. Free for personal use. No domain needed — access via the Tailscale IP. Most secure option but requires Tailscale installed on every device.

---

## Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Backend exposed to internet | Cloudflare Tunnel has DDoS protection built-in. Add auth token (see below) for access control. |
| API keys in .env | Stay on server, never sent to browser. `.gitignore` prevents pushing. |
| Google API keys | User enters at runtime, never stored in code — unchanged. |
| GPU abuse | Backend already has `asyncio.Lock()` serializing GPU ops on `/ensemble` and `/parakeet`. Add rate limiting if needed. |
| CORS | Backend already allows all origins via `allow_origins=["*"]` — works as-is for GitHub Pages origin. |
| Mixed content (HTTPS→HTTP) | Cloudflare Tunnel provides HTTPS endpoint — no mixed content issues. |
| Plaintext key files in `keys/` | `.gitignore` prevents accidental commit. Already untracked. |

## Optional: Simple Auth Token

If you want to prevent random people from hitting your backend (even through Cloudflare), add a simple bearer token check.

### server.py changes (2 modifications):

**1. Add auth middleware:**
```python
AUTH_TOKEN = os.environ.get("ORF_AUTH_TOKEN")

@app.middleware("http")
async def check_auth(request, call_next):
    if AUTH_TOKEN and request.url.path != "/health":
        token = request.headers.get("Authorization", "").replace("Bearer ", "")
        if token != AUTH_TOKEN:
            return JSONResponse(status_code=401, content={"error": "unauthorized"})
    return await call_next(request)
```

**2. CRITICAL — Update CORS to allow Authorization header:**
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],  # ← ADD Authorization
)
```

> **Without this CORS change, browsers will block the preflight OPTIONS request
> for any fetch that includes an `Authorization` header.** The current config
> only allows `Content-Type`. This was identified during codebase research and
> is a silent failure — the fetch would error with a cryptic CORS message, not
> a 401.

**Frontend: `backend-config.js` already exports `BACKEND_TOKEN`** (see Task 1). Each API file adds the header to fetch calls:
```javascript
import { BACKEND_URL, BACKEND_TOKEN } from './backend-config.js';

const headers = { 'Content-Type': 'application/json' };
if (BACKEND_TOKEN) {
  headers['Authorization'] = `Bearer ${BACKEND_TOKEN}`;
}
```

**docker-compose.yml: Add the env var:**
```yaml
environment:
  - PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
  - DEEPGRAM_API_KEY=${DEEPGRAM_API_KEY}
  - HF_TOKEN=${HF_TOKEN}
  - ORF_AUTH_TOKEN=${ORF_AUTH_TOKEN}  # NEW — optional auth token
```

---

## Cost

| Component | Cost |
|-----------|------|
| GitHub Pages | Free |
| Cloudflare Tunnel (quick) | Free, no account |
| Cloudflare Tunnel (named) | Free (need a domain, ~$10/yr) |
| Tailscale | Free for personal use |
| Home PC electricity | Already running |

**Total: $0 – $10/yr**

## What Stays the Same

- All frontend code (vanilla JS, ES6 modules, no build step, no bundler)
- Docker setup for Reverb/Parakeet
- All pipeline logic (alignment, diagnostics, near-miss resolution, etc.)
- localStorage/IndexedDB for student data (per-device)
- Service Worker / PWA support (with cache version bump)
- Google API key entry at runtime
- `data/cmudict-phoneme-counts.json` served as static file (works identically on GitHub Pages)

---

## Research-Identified Issues & Resolutions

### ISSUE 1: `.gitignore` would break phoneme normalization (CRITICAL)
- **Original plan:** gitignore `data/`
- **Problem:** `data/cmudict-phoneme-counts.json` (1.6MB) is fetched at runtime by `phoneme-counter.js`. Without it, word speed normalization silently degrades.
- **Resolution:** Remove `data/` from `.gitignore`. Only ignore secrets and build artifacts.

### ISSUE 2: CORS blocks Authorization header (CRITICAL if auth used)
- **Original plan:** Add `Authorization: Bearer` header to fetch calls
- **Problem:** `server.py` CORS config only has `allow_headers=["Content-Type"]`. Browser preflight for `Authorization` would fail silently.
- **Resolution:** Add `"Authorization"` to `allow_headers` in CORS middleware.

### ISSUE 3: `kitchen-sink-merger.js` does NOT need updating (MINOR)
- **Original plan:** "if it references the URL directly"
- **Finding:** It does not. It delegates to `cross-validator.js` which imports from `deepgram-api.js` / `parakeet-api.js`. No changes needed.
- **Resolution:** Removed from task list.

### ISSUE 4: Service worker missing new module (MODERATE)
- **Original plan:** Did not mention service worker.
- **Problem:** Adding `backend-config.js` without adding it to `sw.js` SHELL means it won't be cached for offline use.
- **Resolution:** Added Task 4 to bump SW cache version and add new file to SHELL.

### ISSUE 5: Module evaluation timing (INFORMATIONAL)
- **Original plan:** `export const BACKEND_URL = localStorage.getItem(...)`
- **Behavior:** This runs once when the module is first imported. Changing localStorage after page load has no effect until reload.
- **Resolution:** Document "reload required" behavior in UI. This matches existing patterns (`orf_xval_engine`, `orf_dev_mode`).

### ISSUE 6: No existing `.gitignore` — keys at risk (SECURITY)
- **Finding:** The repo has NO `.gitignore`. `keys/` directory contains 5 plaintext API key files. `services/reverb/.env` contains Deepgram and HuggingFace tokens. All currently untracked but at risk from `git add .` or `git add -A`.
- **Resolution:** `.gitignore` must be the FIRST file committed before any bulk add.

---

## Task Execution Order

1. **Task 3 FIRST** — Create `.gitignore` and commit it before any other changes to prevent accidental secret exposure
2. **Task 1** — Create `backend-config.js` and update 4 API files
3. **Task 2** — Add backend URL input to UI
4. **Task 4** — Update service worker cache
5. **Task 5** — Enable GitHub Pages
6. **Task 6** — Set up Cloudflare Tunnel

---

## Post-Review Notes (2026-02-07)

> Review performed by 7 parallel inspection agents analyzing: backend URLs,
> service worker, server.py/CORS/auth, localStorage patterns, index.html
> structure, git state/.gitignore, and fetch call patterns across all API files.

### Corrections Applied

1. **localStorage key names fixed** — `orf_kitchen_sink_enabled` → `orf_use_kitchen_sink`,
   `orf_xval_engine` → `orf_cross_validator` (the former was the HTML radio button name,
   not the actual storage key)
2. **localStorage inventory completed** — Added 5 missing keys used for cross-window
   communication (`orf_playback_student`, `orf_playback_assessment`, `orf_dashboard_student`,
   `orf_report_student`, `orf_report_chart`)
3. **Service worker missing module count corrected** — "~15" → actual count of **19**
4. **Cloudflare command typo fixed** — `cloudflare` → `cloudflared` (Option B)
5. **Design choice documented** — `export const` vs function-based pattern rationale
   added to Task 1

### Verified Correct (No Changes Needed)

- Backend URL inventory: 4 files, exact lines, kitchen-sink-merger.js excluded ✓
- CORS config: lines 42-47, exact match ✓
- All 5 endpoints: methods, purposes, GPU lock usage ✓
- .gitignore proposal: covers all secrets, preserves `data/cmudict-phoneme-counts.json` ✓
- Auth middleware placement: correct FastAPI ordering, `/health` exemption ✓
- docker-compose.yml: ready for `ORF_AUTH_TOKEN` ✓
- No circular dependency risk: all 4 API files are leaf modules ✓
- All fetch calls use JSON (no FormData): uniform refactoring ✓
- index.html: clean insertion point between API Key (line 25) and Ghost Detection (line 27) ✓
- Service worker lifecycle: `skipWaiting()` + `clients.claim()` + versioned cache ✓
