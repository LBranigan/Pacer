# Remote Deployment Plan: Making Pacer Accessible From Anywhere

> Research performed 2026-02-08 by 3 parallel agents investigating:
> cloud GPU hosting, security/HTTPS/CORS, and frontend deployment options.
>
> Audited 2026-02-08 by 4 parallel inspection agents verifying every claim
> against the actual codebase (backend security, frontend paths, Docker/server
> architecture, service worker completeness). Corrections applied below.

## Problem Statement

The app currently requires the local backend server (`localhost:8765`) for the
Reverb/Deepgram ASR pipeline. The frontend can be deployed to GitHub Pages, but
the backend needs a GPU (NVIDIA CUDA) and runs on the home PC in WSL2/Docker.
From any device outside the local network, the backend is unreachable.

## What's Already Done

From the previous deployment plan (`docs/deployment-plan.md`):
- `js/backend-config.js` — single source of truth for backend URL + auth token
- `orf_backend_url` / `orf_backend_token` in localStorage
- Backend settings UI in `index.html` (URL input, token input, test connection)
- `ORF_AUTH_TOKEN` env var + Bearer token middleware in `server.py`
- CORS already has `allow_headers=["Content-Type", "Authorization"]`

**What remains:** Actually deploying frontend + backend so they're reachable from any device.

---

## Three Deployment Strategies

### Strategy A: Cloudflare Tunnel (Recommended)
**Keep GPU on your home PC. Expose it to the internet via encrypted tunnel.**

```
Phone/Tablet (anywhere)
  │
  │ HTTPS
  ▼
GitHub Pages ─── serves frontend (HTML/JS/CSS)
  │
  │ HTTPS (fetch calls to backend)
  ▼
Cloudflare Tunnel ─── encrypted tunnel to your home PC
  │
  │ localhost:8765
  ▼
Home PC (WSL2 + Docker + NVIDIA GPU)
  └── FastAPI server (Reverb + Parakeet + Deepgram proxy)
```

| Aspect | Detail |
|--------|--------|
| **Cost** | $0 (free Cloudflare account) or $0 + ~$10/yr for custom domain |
| **Setup** | ~30 minutes |
| **Reliability** | Depends on home PC being on + internet connection |
| **HTTPS** | Automatic — Cloudflare provides SSL termination |
| **Latency** | ~50-100ms overhead on top of inference time |
| **Best for** | Single user, home PC always on, cost-conscious |

#### Setup Steps

**1. Install cloudflared in WSL2:**
```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
```

**2a. Quick tunnel (no account, URL changes each restart):**
```bash
cloudflared tunnel --url http://localhost:8765
# Output: https://some-random-words.trycloudflare.com
```
Paste this URL into the app's Backend URL setting.

**2b. Named tunnel (stable URL, requires free Cloudflare account + domain):**
```bash
cloudflared tunnel login
cloudflared tunnel create pacer-api
cloudflared tunnel route dns pacer-api pacer-api.yourdomain.com
cloudflared tunnel run pacer-api
```
Gives you permanent `https://pacer-api.yourdomain.com`.

**3. Run as Windows service (auto-start on boot):**

Option 1 — Run cloudflared natively on Windows (not WSL):
- Download `cloudflared.exe` from GitHub releases
- Install as service: `cloudflared.exe service install`
- Configure in `%USERPROFILE%\.cloudflared\config.yml`:
```yaml
tunnel: pacer-api
credentials-file: C:\Users\brani\.cloudflared\<tunnel-id>.json
ingress:
  - hostname: pacer-api.yourdomain.com
    service: http://localhost:8765
  - service: http_status:404
```

Option 2 — WSL2 systemd service (if WSL systemd is enabled):
```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
```

**Gotchas:**
- WSL2 IP changes on reboot — but cloudflared connects outbound (no port forwarding needed)
- Home internet upload speed matters — audio files are 5-15MB base64
- If home PC sleeps/restarts, tunnel disconnects until cloudflared restarts
- Quick tunnel URLs change every restart — named tunnel is strongly preferred
- Must apply backend URL auto-detection fix first (see Frontend Deployment section)

---

### Strategy B: Cloud GPU VM
**Move the backend to a cloud server with a GPU. Home PC no longer needed.**

```
Phone/Tablet (anywhere)
  │
  │ HTTPS
  ▼
GitHub Pages ─── serves frontend
  │
  │ HTTPS
  ▼
Cloud VM (T4/L4 GPU) ─── runs Docker container
  └── FastAPI server (Reverb + Parakeet + Deepgram proxy)
```

| Aspect | Detail |
|--------|--------|
| **Cost** | $70-350+/month (always-on) or $0.20-0.50/hr (on-demand) |
| **Setup** | 2-4 hours |
| **Reliability** | High — cloud uptime SLA, no dependency on home PC |
| **HTTPS** | Via Caddy reverse proxy or Let's Encrypt |
| **Latency** | Lower than tunnel (co-located in data center) |
| **Best for** | Multiple users, production use, home PC unreliable |

#### Cloud GPU Pricing Comparison (T4 16GB — minimum viable GPU)

| Provider | Instance | GPU | Monthly (on-demand) | Monthly (spot/preemptible) | Setup |
|----------|----------|-----|--------------------|-----------------------------|-------|
| **RunPod** | Community Cloud | T4 16GB | ~$110/mo | ~$75/mo | Easy (1/5) |
| **Vast.ai** | Marketplace | T4 16GB | ~$70-90/mo | ~$50-70/mo | Easy (2/5) |
| **Lambda Labs** | GPU Cloud | T4 (A10 min) | ~$150/mo | N/A | Easy (1/5) |
| **AWS EC2** | g4dn.xlarge | T4 16GB | ~$190/mo | ~$60-80/mo (spot) | Medium (3/5) |
| **GCP** | g2-standard-4 | L4 24GB | ~$260/mo | ~$80/mo (preemptible) | Medium (3/5) |
| **Azure** | NC4as T4 v3 | T4 16GB | ~$280/mo | ~$85/mo (spot) | Medium (3/5) |

**Cheapest viable option:** Vast.ai or RunPod community cloud at ~$70-110/mo.

**Cheapest if usage is bursty:** AWS spot g4dn.xlarge at ~$0.16/hr. Turn it on
for a session, turn it off when done. 20 hours/month = ~$3.20/mo.

#### Deployment to Cloud VM

```bash
# 1. Provision VM with GPU (e.g., RunPod or AWS g4dn.xlarge)
# 2. Install Docker + NVIDIA Container Toolkit
# 3. Clone repo or copy services/reverb/ directory
#    IMPORTANT: Do NOT copy .env file to cloud — pass env vars directly
# 4. Build and run:
cd services/reverb
docker build -t pacer-backend .
docker run --gpus all -p 8765:8765 \
  -e DEEPGRAM_API_KEY=xxx \
  -e HF_TOKEN=xxx \
  -e ORF_AUTH_TOKEN=your-secret-token \
  -e PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
  pacer-backend

# Or use docker compose (reads .env automatically):
docker compose up -d

# First request will be slow (30-60s) as models download from HuggingFace.
# Model cache persists in Docker volume (reverb-cache) across restarts.

# 5. Set up HTTPS with Caddy (simplest reverse proxy):
# Install Caddy, create Caddyfile:
#   pacer-api.yourdomain.com {
#     reverse_proxy localhost:8765
#   }
# Caddy auto-provisions Let's Encrypt certificates.
```

---

### Strategy C: Serverless GPU (Pay-Per-Inference)
**No always-on server. GPU spins up only when a request comes in.**

| Aspect | Detail |
|--------|--------|
| **Cost** | ~$0.0005-0.002 per inference second (near-zero for light use) |
| **Setup** | 4-6 hours (refactor needed) |
| **Reliability** | High (managed infrastructure) |
| **Cold start** | 30-60 seconds (model loading) — **major UX issue** |
| **Best for** | Very infrequent use, cost optimization |

#### Serverless GPU Providers

| Provider | Cold Start | Pricing | Docker Support | Notes |
|----------|-----------|---------|----------------|-------|
| **RunPod Serverless** | 30-60s (can configure active workers) | $0.00026/s (T4) | Yes | Best fit — custom Docker, health endpoint |
| **Modal.com** | 10-30s (warm containers) | $0.000164/s (T4) | Yes (Dockerfile) | Python-native, good DX |
| **Replicate** | 30-120s | ~$0.000225/s (T4) | Yes (Cog format) | Public model hosting |
| **Banana.dev** | Acquired/sunset | N/A | N/A | No longer available |

**The cold start problem:** Reverb model loading takes 30-60 seconds. First
request after idle spins up the GPU, loads PyTorch + WeNet model, then runs
inference. Subsequent requests are fast (5-15s). For a classroom session where
you run 5-20 assessments in a row, the first one is slow but the rest are fast.

**Mitigation:** RunPod Serverless lets you configure "active workers" (min=1)
that stay warm. Cost: ~$0.02/hr idle = ~$15/mo for 24/7 warm worker. Still
cheaper than an always-on VM.

**Refactor required:** The server currently uses FastAPI HTTP endpoints. RunPod
Serverless expects a specific handler format:
```python
import runpod

def handler(event):
    audio_b64 = event["input"]["audio_base64"]
    # ... run inference ...
    return {"output": result}

runpod.serverless.start({"handler": handler})
```
This means refactoring `server.py` into a RunPod worker format, or using RunPod's
"pod-first development" dual-mode approach that supports both HTTP and serverless.

---

## Strategy Comparison

| Factor | A: Tunnel | B: Cloud VM | C: Serverless |
|--------|-----------|-------------|---------------|
| **Monthly cost** | $0 | $70-350 | $0-15 |
| **Setup effort** | 30 min | 2-4 hrs | 4-6 hrs |
| **Code changes** | Minor (auto-detect) | Minor (auto-detect) | Moderate |
| **Home PC required** | Yes (must be on) | No | No |
| **Cold start** | None (always running) | None (always running) | 30-60s first request |
| **Reliability** | Depends on home internet | High (cloud SLA) | High |
| **Multiple users** | Poor (single GPU lock) | Good | Excellent (auto-scale) |
| **Best scenario** | Solo teacher, home PC always on | School deployment | Occasional use |

---

## Frontend Deployment

### GitHub Pages (Recommended)

Nearly compatible — one small code change required (backend URL auto-detection):
1. Go to repo Settings > Pages > Source: Deploy from branch `master`, root `/`
2. Site goes live at `https://lbranigan.github.io/googstt/`
3. Auto-deploys on every `git push`

**Verified compatible:**
- All HTML/JS paths use relative `./` notation (works under `/googstt/` subpath)
- All `<script>` tags use `type="module"` for ES6 modules
- `data/cmudict-phoneme-counts.json` (1.6MB) well within 1GB limit
- Service worker registration with `./sw.js` scopes correctly
- `manifest.json` uses relative `start_url: "./index.html"`
- Page navigation uses dynamic base URL extraction (`window.location.href.replace(/[^/]*$/, '')`)
- All `fetch()` calls use `BACKEND_URL` variable or relative paths — none hardcoded

**Requires code change:** `backend-config.js` currently hardcodes fallback to
`http://localhost:8765`. When deployed to GitHub Pages (HTTPS), this causes a
mixed-content block (HTTPS frontend -> HTTP backend) that silently fails. Three
locations need the auto-detection fix described below:
- `js/backend-config.js` line 13 (module-level default)
- `js/app.js` line 1824 (connection test button fallback)
- `js/app.js` line 1851 (auto-test on page load fallback)

**Alternative: Cloudflare Pages** — unlimited bandwidth (vs GitHub's soft 100GB
limit), custom `Cache-Control` headers for `sw.js`, HTTP/3. Setup: connect GitHub
repo, select root directory, no build command. 5 minutes.

### Backend URL Auto-Detection (Required Before Deploy)

Currently `backend-config.js` line 13 defaults to `http://localhost:8765`. On
GitHub Pages this causes a **mixed-content block** (HTTPS -> HTTP) that silently
fails — users see "Failed to fetch" with no explanation.

**Fix — replace the current export in `js/backend-config.js`:**

```javascript
function getDefaultBackendUrl() {
  const saved = localStorage.getItem('orf_backend_url');
  if (saved) return saved;
  // If running locally, use localhost
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    return 'http://localhost:8765';
  }
  // If deployed remotely, no default — force user to configure
  return '';
}

export const BACKEND_URL = getDefaultBackendUrl();
```

**Also update both fallbacks in `js/app.js`** (lines ~1824 and ~1851):
```javascript
// Change: const url = backendUrlInput.value.trim() || 'http://localhost:8765';
// To:
const url = backendUrlInput.value.trim()
  || (['localhost','127.0.0.1'].includes(location.hostname) ? 'http://localhost:8765' : '');
```

**Optional UX improvement — mixed-content warning:** When a user enters an `http://`
backend URL from an HTTPS page, show a warning:
```javascript
if (location.protocol === 'https:' && url.startsWith('http://') && !url.includes('localhost')) {
  backendStatusText.textContent = 'Warning: HTTPS page cannot call HTTP backend. Use HTTPS URL.';
}
```

When `BACKEND_URL` is empty, the connection test in the UI shows "Not configured"
and the teacher pastes their tunnel/cloud URL. This is a one-time setup per device.

---

## Security Checklist

### Already in place (verified against codebase):
- [x] `ORF_AUTH_TOKEN` env var + Bearer middleware (`server.py` lines 50-60)
- [x] `orf_backend_token` in localStorage + `backendHeaders()` (`backend-config.js` lines 17-27)
- [x] CORS `allow_headers` includes `Authorization` (`server.py` line 47)
- [x] `/health` endpoint exempt from auth (`server.py` line 56)
- [x] Deepgram API key stays server-side — never in responses or frontend code
- [x] `gpu_lock` serializes GPU operations (`server.py` line 67) — prevents VRAM contention
- [x] `torch.cuda.empty_cache()` after each inference (`server.py` lines 303, 453)
- [x] Graceful degradation — Deepgram/Parakeet return 503 if not configured, not crash
- [x] GPU check at startup — `torch.cuda.is_available()` fails fast if no GPU (`server.py` line 131)

### Needed for remote deployment:

- [ ] **HTTPS on backend** — Required. Mixed content (HTTPS frontend → HTTP backend)
  is blocked by all modern browsers. Cloudflare Tunnel provides HTTPS automatically.
  For cloud VM, use Caddy reverse proxy (auto Let's Encrypt).

- [ ] **Tighten CORS origins** — Current `allow_origins=["*"]` (`server.py` line 45)
  works but is broad. For production, change to:
  ```python
  allow_origins=[
      "https://lbranigan.github.io",
      "http://localhost:8080",  # local dev
  ]
  ```
  Note: `allow_origins=["*"]` with `allow_credentials=False` (the default) still
  allows `Authorization` headers when explicitly listed in `allow_headers`. The
  `Authorization` header is not a "credential" in CORS terms (only cookies and
  HTTP auth are). So the current config works, but tightening origins is best practice.

- [ ] **Rate limiting** — `gpu_lock` serializes requests but does NOT rate-limit
  them. A compromised token could queue hundreds of requests, saturating the GPU
  for hours. Add `slowapi`:
  ```python
  from slowapi import Limiter
  limiter = Limiter(key_func=lambda: "global")
  # 10 requests per minute (generous for single-user)
  @app.post("/ensemble")
  @limiter.limit("10/minute")
  async def ensemble(req, request: Request): ...
  ```
  For single-user with a strong token, the risk is low but not zero.

- [ ] **Request size limit** — Audio files are 5-15MB as base64. FastAPI default is
  unlimited — a DoS attack could send a 1GB payload and crash the server. Add:
  ```python
  from starlette.middleware.base import BaseHTTPMiddleware
  MAX_BODY_SIZE = 25 * 1024 * 1024  # 25MB

  class LimitBodySize(BaseHTTPMiddleware):
      async def dispatch(self, request, call_next):
          if request.headers.get('content-length'):
              if int(request.headers['content-length']) > MAX_BODY_SIZE:
                  return JSONResponse(status_code=413, content={"error": "payload too large"})
          return await call_next(request)

  app.add_middleware(LimitBodySize)
  ```

- [ ] **Bearer token format validation** — Current code (`server.py` line 57)
  uses `.replace("Bearer ", "")` which silently accepts malformed headers.
  Stricter approach:
  ```python
  auth_header = request.headers.get("Authorization", "")
  if not auth_header.startswith("Bearer "):
      return JSONResponse(status_code=401, content={"error": "invalid auth format"})
  token = auth_header[7:]
  ```

- [ ] **Auth failure logging** — Currently returns 401 silently (`server.py` line
  59). For visibility into attack attempts, add:
  ```python
  print(f"[AUTH] Unauthorized: {request.method} {request.url.path} from {request.client.host}")
  ```

- [ ] **Server-side request timeout** — The 120-second timeout on `/ensemble` is
  **client-side only** (`reverb-api.js` line 110). If the client disconnects, the
  GPU inference continues indefinitely. Add uvicorn timeout:
  ```bash
  uvicorn server:app --host 0.0.0.0 --port 8765 --timeout-keep-alive 120
  ```

- [ ] **Mixed-content detection in frontend** — When deployed to HTTPS, users who
  enter an `http://` backend URL get a cryptic "Failed to fetch" error. Add
  client-side detection (see Backend URL Auto-Detection section above).

### Credential security:

- [x] **`.env` file is in `.gitignore`** — `services/reverb/.env` contains real
  API keys (`DEEPGRAM_API_KEY`, `HF_TOKEN`). Already excluded via `.gitignore`
  line 3. Never commit this file.

- [ ] **HF_TOKEN in Dockerfile layer history** — `Dockerfile` line 19 writes a git
  credential helper script that references `${HF_TOKEN}` at runtime. The token
  value itself is NOT baked into the image (it's resolved at container runtime via
  env var), but the script pattern is visible in layer history. If the image is
  ever shared publicly, consider using Docker build secrets:
  ```dockerfile
  RUN --mount=type=secret,id=hf_token \
    git config --global credential.helper '!f() { echo "username=hf"; echo "password=$(cat /run/secrets/hf_token)"; }; f'
  ```

### Mobile-specific notes:
- **iOS Safari:** getUserMedia works in standalone PWA since iOS 13.4. Permissions
  may need re-granting after app restart (known WebKit limitation, not fixable).
- **Android Chrome:** Works reliably for microphone access over HTTPS.
- **Cellular data:** Audio uploads are 5-15MB (base64 inflates WAV by ~33%). On
  slow connections, the 120-second client-side timeout on `/ensemble` may not be
  enough. Consider compressing audio to WebM/Opus before upload (already supported
  by MediaRecorder).

---

## Recommended Path

**For immediate use (today):**

1. Apply backend URL auto-detection fix to `backend-config.js` + `app.js` (5 min)
2. Enable GitHub Pages (2 min)
3. Run `cloudflared tunnel --url http://localhost:8765` on home PC (5 min)
4. Open app on phone, paste tunnel URL into Backend URL field
5. Set an auth token in `.env` and the app's token field

**Total time: ~15 minutes. Total cost: $0.**

**For reliable long-term use:**

1. Get a domain (~$10/yr) and set up a named Cloudflare Tunnel
2. Install cloudflared as a Windows service (auto-starts on boot)
3. Tighten CORS origins in `server.py` to GitHub Pages domain
4. Add request size limit + auth failure logging to `server.py`
5. Update `sw.js` SHELL list to precache all JS modules (better offline/slow network)

**If home PC dependency is a problem:**

1. Deploy Docker container to RunPod community cloud (~$75/mo spot T4)
2. Or use RunPod Serverless with 1 warm worker (~$15/mo)
3. Point frontend to cloud backend URL
4. Home PC no longer needed

---

## Service Worker Gaps

The `sw.js` SHELL array precaches 30 files but is missing **25+ JS modules**
that are imported by cached files. The fetch handler (`caches.match || fetch`)
never calls `cache.put()`, so non-SHELL resources are fetched fresh every time.

**Current SHELL (30 files):** HTML pages, `style.css`, `manifest.json`, and 22
JS files including `app.js`, `ui.js`, `alignment.js`, `diagnostics.js`, etc.

**Missing modules that SHOULD be in SHELL (25 files):**
```javascript
// Direct pipeline dependencies (imported by app.js/diagnostics.js)
'./js/text-normalize.js',
'./js/vad-processor.js',
'./js/ghost-detector.js',
'./js/confidence-classifier.js',
'./js/disfluency-detector.js',
'./js/safety-checker.js',
'./js/kitchen-sink-merger.js',
'./js/cross-validator.js',
'./js/phonetic-utils.js',
'./js/audio-padding.js',
'./js/vad-gap-analyzer.js',
'./js/maze-generator.js',
'./js/phoneme-counter.js',

// Config files (dependencies of above)
'./js/safety-config.js',
'./js/disfluency-config.js',
'./js/confidence-config.js',

// API + support modules
'./js/syllable-counter.js',
'./js/deepgram-api.js',
'./js/parakeet-api.js',
'./js/sequence-aligner.js',
'./js/disfluency-tagger.js',
'./js/reverb-api.js',
'./js/ensemble-merger.js',
'./js/miscue-registry.js',
'./js/maze-game.js',              // imported by maze.html
```

**Also missing (non-JS resources):**
```javascript
'./maze.html',
'./css/maze.css',
'./data/cmudict-phoneme-counts.json',   // 1.6MB — re-downloaded every session
'./icons/icon-192.png',
'./icons/icon-512.png',
```

**Impact:** Without these, the app cannot function offline at all. Even with a
network connection, 25+ modules + 1.6MB data file are fetched fresh every session
instead of being served from cache. On cellular networks this is significant.

**External CDN dependencies** (not cacheable by SW, rely on browser cache):
- `diff_match_patch.js` (cdnjs)
- `ort.wasm.min.js` (jsdelivr) — required by VAD
- `vad-web/bundle.min.js` (jsdelivr)
- Google Fonts CSS (student-playback.css)

**Fix (separate task):** Add all missing files to SHELL list, and add runtime
caching in the fetch handler. Replace the current fetch handler:
```javascript
// Current (no runtime caching):
//   event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));

// New (cache-first with runtime caching for cache misses):
event.respondWith(
  caches.match(event.request).then(cached => {
    if (cached) return cached;
    return fetch(event.request).then(response => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return response;
    });
  })
);
```

---

## Operational Notes

### Docker Configuration Details
- **Base image:** `pytorch/pytorch:2.4.0-cuda11.8-cudnn9-runtime`
- **System deps:** `ffmpeg`, `git-lfs`, `libsndfile1`, `sox`
- **Python deps:** `requirements.txt` (6 packages: fastapi, uvicorn, python-multipart,
  rev-reverb==0.1.0, deepgram-sdk>=5.0<6.0, nemo_toolkit[asr]>=2.2)
- **docker-compose.yml** includes model cache volume (`reverb-cache:/root/.cache`)
  that persists HuggingFace models across container restarts — avoids 30-60s model
  re-download on each restart
- **`PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`** in docker-compose.yml
  prevents VRAM fragmentation out-of-memory errors

### Server Endpoints (server.py)
| Endpoint | Method | Auth | GPU Lock | Timeout (client) |
|----------|--------|------|----------|-------------------|
| `/health` | GET | No | No | 3-5s |
| `/ensemble` | POST | Yes | Yes | 120s |
| `/deepgram` | POST | Yes | No | 30s |
| `/parakeet` | POST | Yes | Yes | 40s |
| `/deepgram-maze` | POST | Yes | No | 30s |

### Lazy Model Loading
Models are NOT pre-loaded at startup. The first request to each endpoint triggers
model download from HuggingFace (30-60s). Subsequent requests are fast (5-15s).
The model cache Docker volume ensures this only happens once per container lifetime,
not per restart.

---

*Plan authored 2026-02-08. Based on research by 3 parallel agents analyzing cloud
GPU hosting, security/HTTPS/CORS, and frontend deployment options.*

*Audited 2026-02-08 by 4 parallel inspection agents. All claims verified against
actual codebase with exact file/line references. Corrections and additions applied.*
