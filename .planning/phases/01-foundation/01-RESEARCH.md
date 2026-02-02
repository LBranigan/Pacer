# Phase 1: Foundation - Research

**Researched:** 2026-02-02
**Domain:** ES modules, PWA (manifest + service worker), vanilla JS modularization
**Confidence:** HIGH

## Summary

Phase 1 converts a 236-line monolithic HTML file into ES modules and adds PWA support. The existing app uses inline CSS and a single `<script>` block with globals for mic recording, file upload, and Google Cloud STT v1 REST calls.

The modularization is straightforward: extract the inline JS into separate ES module files, extract CSS to an external stylesheet, and load via `<script type="module">`. PWA requires adding a `manifest.json` and a `sw.js` service worker. Both are well-documented standards with no library dependencies.

**Primary recommendation:** Split inline JS into 4-5 ES modules (ui, recorder, file-handler, stt-api, app), extract CSS, add manifest.json + sw.js. Use `npx serve` or VS Code Live Server for development since ES modules cannot load via `file://`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ES Modules (native) | ES2015+ | Code modularization | Built into all modern browsers, no build tool needed |
| Service Worker API (native) | N/A | PWA offline/installability | Web platform standard |
| Web App Manifest (native) | N/A | PWA metadata | Web platform standard |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| `npx serve` | Local dev server | Development - ES modules require HTTP, not file:// |
| VS Code Live Server | Alternative dev server | If using VS Code |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ES modules (no build) | Vite/esbuild | Adds build step complexity unnecessary at this scale |
| npx serve | python -m http.server | Python server doesn't set correct MIME types for .mjs |

**Installation:**
```bash
# No npm dependencies needed. For local dev server:
npx serve .
```

## Architecture Patterns

### Recommended Project Structure
```
/
├── index.html              # Entry point (was orf_assessment.html)
├── style.css               # Extracted from inline <style>
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker (root scope)
├── icons/                  # PWA icons (192x192, 512x512)
│   ├── icon-192.png
│   └── icon-512.png
└── js/
    ├── app.js              # Main entry, imports others, registers SW
    ├── ui.js               # DOM manipulation, status updates, result display
    ├── recorder.js         # MediaRecorder logic (mic capture)
    ├── file-handler.js     # File upload + format detection
    └── stt-api.js          # Google Cloud STT API call + base64 encoding
```

### Pattern 1: Module Entry Point
**What:** Single `<script type="module" src="js/app.js">` replaces inline script block
**When to use:** Always - this is the ES module entry pattern
**Example:**
```html
<!-- index.html -->
<script type="module" src="js/app.js"></script>
```
```javascript
// js/app.js
import { initUI } from './ui.js';
import { initRecorder } from './recorder.js';
import { initFileHandler } from './file-handler.js';

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// Initialize app
initUI();
initRecorder();
initFileHandler();
```

### Pattern 2: Removing Global Functions
**What:** The current code uses `onclick="toggleRecord()"` with global functions. ES modules are scoped, so globals don't work. Replace with `addEventListener` in the module code.
**When to use:** Every inline event handler must be converted.
**Example:**
```javascript
// js/recorder.js - instead of global toggleRecord()
export function initRecorder() {
  document.getElementById('recordBtn').addEventListener('click', toggleRecord);
}

function toggleRecord() { /* ... */ }
```

### Pattern 3: Minimal Service Worker (Cache-First for App Shell)
**What:** Cache the app shell (HTML, CSS, JS) on install; serve from cache, update in background.
**Example:**
```javascript
// sw.js
const CACHE_NAME = 'orf-v1';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './js/app.js',
  './js/ui.js',
  './js/recorder.js',
  './js/file-handler.js',
  './js/stt-api.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL)));
});

self.addEventListener('fetch', e => {
  // Network-first for API calls, cache-first for app shell
  if (e.request.url.includes('googleapis.com')) return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
});
```

### Anti-Patterns to Avoid
- **Leaving onclick attributes in HTML:** ES modules are scoped; inline handlers cannot call module functions. Must convert ALL to addEventListener.
- **Caching the STT API response:** API calls must always go to network. Only cache static app shell files.
- **Putting sw.js inside js/ folder:** Service worker scope is limited to its directory and children. Must be at root for full app scope.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PWA icons | Manual icon creation | Any PNG resizer or favicon generator | Need exact 192x192 and 512x512 sizes with maskable support |
| Dev server | Custom Node server | `npx serve` | One command, correct MIME types, zero config |
| Module bundling | Concatenation script | Nothing - native ES modules work fine | Browser handles module loading natively at this scale |

## Common Pitfalls

### Pitfall 1: file:// Protocol Breaks ES Modules
**What goes wrong:** Opening index.html by double-clicking gives CORS errors; modules fail to load.
**Why it happens:** Browsers enforce CORS for ES module imports; `file://` has no origin.
**How to avoid:** Always use a local server for development (`npx serve`). Document this in README.
**Warning signs:** Console error "CORS request not HTTP" or "Failed to resolve module specifier."

### Pitfall 2: Service Worker Scope
**What goes wrong:** SW only controls pages in its directory or below.
**Why it happens:** SW scope defaults to the directory containing sw.js.
**How to avoid:** Place sw.js at the project root, next to index.html.
**Warning signs:** `navigator.serviceWorker.controller` is null on the page.

### Pitfall 3: Forgetting to Update SW Cache Version
**What goes wrong:** Users see stale app after code changes.
**Why it happens:** Browser only re-downloads SW if sw.js bytes change. Cached resources serve forever until cache name changes.
**How to avoid:** Bump `CACHE_NAME` version string (e.g., 'orf-v1' to 'orf-v2') whenever app files change. The activate event cleans old caches.
**Warning signs:** Changes deployed but not visible; hard refresh fixes it.

### Pitfall 4: Shared Mutable State Between Modules
**What goes wrong:** Variables like `mediaRecorder`, `recording`, `audioChunks` are currently globals. Splitting into modules requires deciding where state lives.
**Why it happens:** Monolith used script-scope globals freely.
**How to avoid:** Keep state private within each module. Export functions, not variables. The recorder module owns recording state; the UI module reads it through function calls.
**Warning signs:** Circular imports, modules importing state variables from each other.

### Pitfall 5: Manifest Must Be Linked in HTML
**What goes wrong:** PWA install prompt never appears.
**Why it happens:** Missing `<link rel="manifest" href="manifest.json">` in HTML head.
**How to avoid:** Add the link tag. Also add `<meta name="theme-color">` for status bar color on mobile.

## Code Examples

### Minimal manifest.json
```json
{
  "name": "Oral Reading Fluency Assessment",
  "short_name": "ORF Assess",
  "start_url": "./index.html",
  "display": "standalone",
  "background_color": "#f5f5f5",
  "theme_color": "#d32f2f",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### HTML Head Additions
```html
<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#d32f2f">
<link rel="apple-touch-icon" href="icons/icon-192.png">
```

### Module Export/Import Pattern
```javascript
// js/stt-api.js
export async function sendToSTT(blob, encoding, apiKey, speechContexts) {
  const base64 = await blobToBase64(blob);
  const body = { config: { encoding, languageCode: 'en-US', /* ... */ }, audio: { content: base64 } };
  const resp = await fetch(
    `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(apiKey)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  return resp.json();
}

function blobToBase64(blob) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `<script>` with globals | `<script type="module">` | Supported since ~2018 | Must convert onclick to addEventListener |
| AppCache for offline | Service Worker + Cache API | AppCache removed ~2021 | Service Worker is the only option |
| manifest.json only | manifest.json or .webmanifest | Both work, .json more common | Either extension works; use .json for simplicity |

## Open Questions

1. **PWA Icons:** Placeholder icons needed for development. Real icons can come later but manifest requires valid icon paths for installability.
   - Recommendation: Create simple colored-square PNG placeholders during this phase.

2. **"Double-click to open" requirement vs ES modules needing a server:**
   - What we know: ES modules require HTTP, not file://. This is a hard browser security constraint.
   - Recommendation: Accept that dev workflow changes from "double-click" to "run `npx serve` then open localhost." Document in README. The PWA requirement (HTTPS for classroom) already implies server-based access.

## Sources

### Primary (HIGH confidence)
- [MDN - JavaScript Modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) - ES module syntax, CORS requirements
- [MDN - Web App Manifest](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest) - manifest.json spec
- [MDN - Service Workers Tutorial](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Tutorials/CycleTracker/Service_workers) - SW lifecycle
- [web.dev - Web App Manifest](https://web.dev/learn/pwa/web-app-manifest) - PWA installability criteria

### Secondary (MEDIUM confidence)
- [DigitalOcean - Build a PWA in Vanilla JS](https://www.digitalocean.com/community/tutorials/js-vanilla-pwa) - patterns verified against MDN
- [Plain English - Modularize Vanilla JS](https://plainenglish.io/blog/how-to-modularize-code-with-vanilla-javascript-use-import-export-ce41c5481957) - module structure patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - native web platform APIs, no third-party libraries
- Architecture: HIGH - well-established patterns from MDN documentation
- Pitfalls: HIGH - well-known issues (file:// CORS, SW scope) documented extensively

**Research date:** 2026-02-02
**Valid until:** 2026-06-01 (stable web platform APIs, unlikely to change)
