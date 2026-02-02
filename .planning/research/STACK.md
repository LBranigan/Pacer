# Stack Research

**Domain:** Browser-based Oral Reading Fluency (ORF) Assessment Tool
**Researched:** 2026-02-02
**Confidence:** MEDIUM-HIGH

## Constraints

The existing app is a **single HTML file with vanilla JS** calling Google Cloud STT v1 REST API with an API key. No build system, no framework, no npm. All recommendations must work within this constraint: either vanilla JS, or libraries loadable via CDN `<script>` tags.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| Google Cloud STT v1 REST API | v1 | Speech recognition with word timestamps | Already integrated. v1 REST with API key is still supported (confirmed active as of Dec 2025). v2 requires service accounts/OAuth which conflicts with client-only architecture. Stick with v1. | HIGH |
| Google Cloud Vision REST API | v1 | OCR of passage images | Same auth model as STT (API key via query param). POST to `vision.googleapis.com/v1/images:annotate` with base64 image. Use `DOCUMENT_TEXT_DETECTION` for printed passages -- returns word-level bounding boxes and full text. Already using GCP so no new vendor. | HIGH |
| diff-match-patch | latest (CDN) | Transcript-to-reference text alignment | Google's own library. Uses Myers diff with pre/post-processing optimizations. Character-level diff that can be post-processed to word-level alignment. Battle-tested (powers Google Docs). Single file, no dependencies, works in browser. | HIGH |
| localStorage | Browser native | Session metadata, scores, settings | Already decided. Fine for JSON data (student profiles, WCPM scores, timestamps). 5MB limit is plenty for structured data. | HIGH |
| IndexedDB (via localForage) | localForage 1.10.x | Audio recordings, large datasets | localStorage caps at 5MB and is strings-only. Audio blobs from recordings need IndexedDB. localForage provides a Promise-based localStorage-like API that uses IndexedDB under the hood. Available on CDN. | HIGH |
| CSS Animations + vanilla JS | Native | Word-by-word animated playback | For the core word highlight/hop animation, CSS transitions on DOM elements are sufficient and align with the no-framework approach. Character sprite can be a positioned `<div>` or `<img>` that transitions between word positions. No canvas library needed for MVP. | MEDIUM |

### Supporting Libraries

| Library | CDN Load | Purpose | When to Use |
|---------|----------|---------|-------------|
| localForage | `<script src="https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.min.js">` | IndexedDB wrapper | Storing audio blobs, large assessment records. Drop-in replacement for localStorage API but backed by IndexedDB. |
| diff-match-patch | `<script src="https://cdn.jsdelivr.net/npm/diff-match-patch@1.0.5/index.js">` | Text diff/alignment | Aligning STT transcript words against reference passage words. |
| Chart.js | `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4/dist/chart.umd.min.js">` | Teacher dashboard charts | WCPM trends, accuracy over time, progress visualization. Lightweight, no dependencies, works from CDN. |
| Lottie-web | `<script src="https://cdn.jsdelivr.net/npm/lottie-web@5.12/build/player/lottie.min.js">` | Character animations | If CSS animations feel too limited for the game character. Lottie renders After Effects animations as lightweight SVG/canvas. Good middle ground before full game engine. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Browser DevTools | Debugging, performance profiling | Primary dev tool for single-file app |
| Live Server (VS Code) | Local dev server with hot reload | `npx live-server` or VS Code extension. Needed for microphone access (requires HTTPS/localhost). |
| Google Cloud Console | API key management, usage monitoring | Restrict API key by HTTP referrer for security |

---

## Installation

No npm install -- this is a single HTML file. Add to `<head>`:

```html
<!-- IndexedDB wrapper for audio/blob storage -->
<script src="https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.min.js"></script>

<!-- Text alignment (transcript vs reference) -->
<script src="https://cdn.jsdelivr.net/npm/diff-match-patch@1.0.5/index.js"></script>

<!-- Dashboard charts (teacher view) -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js"></script>

<!-- Optional: rich character animation -->
<script src="https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js"></script>
```

Total additional payload: ~250KB minified+gzipped (localForage ~8KB, diff-match-patch ~20KB, Chart.js ~70KB, Lottie ~150KB).

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| STT v1 REST + API key | STT v2 + Chirp 2/3 | If you add a backend proxy later. v2 has better models (Chirp 3) but requires OAuth/service account, not API key. Consider migrating when accuracy isn't good enough with v1. |
| Google Vision OCR | Tesseract.js (client-side) | If you want zero API costs and offline OCR. But accuracy is significantly worse for printed text, and WASM load is ~15MB. Not worth the tradeoff for this use case. |
| diff-match-patch | jsdiff (kpdecker) | If you need word-level or line-level diff granularity out of the box. jsdiff has `diffWords()` built in. However, for ORF alignment you want character-level diff post-processed to word mapping, which diff-match-patch handles better. |
| CSS animations | PixiJS (~450KB) | If character animations become complex (multiple sprites, particle effects, physics). PixiJS is the lightest canvas renderer. Only add if CSS feels limiting. |
| CSS animations | Phaser (~1.2MB) | If you're building a full game with scenes, physics, collision. Overkill for word-hop animation. |
| localForage (IndexedDB) | Dexie.js | If you need complex queries on IndexedDB (indexes, compound keys). localForage is simpler and sufficient for key-value blob storage. |
| Chart.js | D3.js | If you need highly custom visualizations. D3 has a steep learning curve and is overkill for trend lines and bar charts. |
| localStorage (scores) | Firebase Firestore | If you need cross-device sync or multi-student data. But adds a backend dependency. Defer unless requested. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| React/Vue/Angular | Project is single-file vanilla JS. Adding a framework means adding a build system, which contradicts the architecture. The app's complexity doesn't warrant it. | Vanilla JS with clean module patterns (IIFE or ES module `<script type="module">`) |
| npm/Webpack/Vite build system | Single HTML file is the explicit architecture. Build tooling adds complexity with no benefit for this scale. | CDN script tags |
| Google STT v2 API | Requires OAuth 2.0 or service account tokens. Cannot use API key from browser. Would need a backend proxy, violating client-only constraint. | STT v1 REST with API key |
| Tesseract.js for OCR | 15MB+ WASM download, slower, less accurate than Cloud Vision for printed English text. Student is uploading a passage image once -- the API call cost is negligible. | Google Cloud Vision REST API |
| Web Audio API for prosody analysis | Complex, requires DSP knowledge, no out-of-box prosody metrics. STT timestamps + pause detection via word timing gaps is sufficient for MVP prosody signals. | Derive prosody indicators from STT word timestamps (pause length, speech rate variability) |
| Full game engine (Phaser, Unity WebGL) | 1.2MB+ for Phaser, much more for Unity. Overkill for character-hops-on-words animation. | CSS transitions + Lottie for character sprite |
| WebSQL | Deprecated and removed from web standards. | IndexedDB (via localForage) |

---

## Stack Patterns by Variant

**If accuracy of v1 STT becomes a problem:**
- Add a lightweight proxy (Cloudflare Worker or Netlify Function) to call STT v2 with Chirp 3
- Proxy holds the service account key, browser sends audio to proxy
- Minimal architecture change -- just swap the fetch URL

**If the app grows beyond single-file:**
- Split into ES modules: `<script type="module" src="app.js">`
- No build system needed -- modern browsers handle ES modules natively
- Module structure: `stt.js`, `ocr.js`, `alignment.js`, `scoring.js`, `playback.js`, `storage.js`, `dashboard.js`

**If offline support is needed:**
- Add a Service Worker for caching the HTML + CDN scripts
- Tesseract.js as fallback OCR (but not primary)
- Audio can be queued in IndexedDB and sent to STT when online

---

## Version Compatibility

| Package | Version | Notes |
|---------|---------|-------|
| localForage | 1.10.0 | Stable, last release 2022 but actively maintained. Works in all modern browsers. |
| diff-match-patch | 1.0.5 | npm version. Google's canonical JS version also works as standalone. |
| Chart.js | 4.4.x | Major version 4. Do NOT use Chart.js v2 or v3 -- APIs changed significantly. |
| Lottie-web | 5.12.x | Stable. Renders Lottie JSON animations. |
| Google STT v1 REST | v1 | Confirmed still active and documented as of 2025. Not officially deprecated. |
| Google Vision v1 REST | v1 | Stable, actively maintained. |

---

## Key Architecture Decisions Driven by Stack

1. **Alignment algorithm**: diff-match-patch gives character-level edit distance. Post-process to word-level: tokenize reference and transcript, run diff, map each diff segment back to words. This produces the word-correct/word-error classification needed for WCPM.

2. **Storage split**: localStorage for small JSON (settings, student profiles, score history as arrays of numbers). IndexedDB via localForage for large objects (audio blobs, full assessment records with word arrays).

3. **Animation approach**: CSS `transition` on `transform: translateX/Y()` for character position. `requestAnimationFrame` loop synced to audio playback time for word highlighting. This avoids canvas and keeps text in DOM (accessible, selectable).

4. **No build step means no TypeScript**: Accept vanilla JS. Use JSDoc comments for type hints if desired. The simplicity tradeoff is worth it for a single-file app.

---

## Sources

- [Google Cloud STT v1 word timestamps docs](https://docs.cloud.google.com/speech-to-text/docs/v1/async-time-offsets) -- confirmed v1 active, enableWordTimeOffsets
- [Google Cloud STT release notes](https://docs.cloud.google.com/speech-to-text/docs/release-notes) -- Chirp 3 GA in v2 only
- [Google Cloud Vision REST API reference](https://docs.cloud.google.com/vision/docs/reference/rest) -- v1 endpoint, DOCUMENT_TEXT_DETECTION
- [diff-match-patch GitHub](https://github.com/google/diff-match-patch) -- Myers diff with speedups, multi-language
- [npm-compare: diff libraries](https://npm-compare.com/deep-diff,diff,diff-match-patch,diff2html,react-diff-view) -- adoption comparison
- [MDN Storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) -- localStorage 5MB, IndexedDB up to 50% disk
- [web.dev Storage for the web](https://web.dev/articles/storage-for-the-web) -- IndexedDB for blobs recommendation
- [Phaser vs PixiJS comparison](https://generalistprogrammer.com/comparisons/phaser-vs-pixijs) -- size and feature comparison
- [Deep Learning for ORF Assessment (arxiv)](https://arxiv.org/html/2405.19426) -- automated WCPM state of art
- [Frontiers: Prosody in ORF](https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2024.1440760/full) -- prosody gap in automated assessment

---
*Stack research for: Browser-based ORF Assessment Tool*
*Researched: 2026-02-02*
