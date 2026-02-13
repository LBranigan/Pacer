const CACHE_NAME = 'orf-v69';

const SHELL = [
  // --- HTML pages ---
  './',
  './index.html',
  './dashboard.html',
  './report.html',
  './playback.html',
  './maze.html',
  './illustrator.html',
  './orf_assessment.html',

  // --- CSS ---
  './style.css',
  './css/student-playback.css',
  './css/maze.css',
  './css/illustrator.css',

  // --- Manifest + icons ---
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',

  // --- Data ---
  './data/cmudict-phoneme-counts.json',

  // --- Core pipeline JS ---
  './js/app.js',
  './js/ui.js',
  './js/recorder.js',
  './js/file-handler.js',
  './js/ocr-api.js',
  './js/passage-trimmer.js',
  './js/word-equivalences.js',
  './js/storage.js',
  './js/audio-store.js',
  './js/alignment.js',
  './js/metrics.js',
  './js/diagnostics.js',
  './js/celeration-chart.js',
  './js/audio-playback.js',
  './js/benchmarks.js',
  './js/dashboard.js',
  './js/gamification.js',
  './js/effect-engine.js',
  './js/nl-api.js',
  './js/debug-logger.js',
  './js/backend-config.js',

  // --- Pipeline modules (imported by app.js/diagnostics.js) ---
  './js/text-normalize.js',
  './js/vad-processor.js',
  './js/kitchen-sink-merger.js',
  './js/cross-validator.js',
  './js/audio-padding.js',
  './js/vad-gap-analyzer.js',
  './js/maze-generator.js',
  './js/phoneme-counter.js',

  // --- API + support modules ---
  './js/number-words.js',
  './js/syllable-counter.js',
  './js/deepgram-api.js',
  './js/parakeet-api.js',
  './js/reverb-api.js',
  './js/miscue-registry.js',
  './js/maze-game.js',
  './js/illustrator.js',
  './js/noun-emoji-map.js',

  // --- Post-assessment experiences ---
  './js/movie-trailer.js',
  './js/lofi-engine.js',
  './js/rhythm-remix.js',
  './rhythm-remix.html',
  './css/rhythm-remix.css',

  // --- Other ---
  './js/student-playback.js',
  './js/sprite-animator.js',
  './js/stt-api.js',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(c =>
      Promise.all(SHELL.map(url =>
        fetch(url, { cache: 'no-store' }).then(r => c.put(url, r))
      ))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Skip Google APIs (NL API, etc.) — always go to network
  if (event.request.url.includes('googleapis.com')) {
    return;
  }

  // Always fetch backend-config.json from network (tunnel URL changes on every restart)
  if (event.request.url.includes('backend-config.json')) {
    return;
  }

  // Let navigate requests (new windows, page loads) go to network first
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first with runtime caching for cache misses
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Only cache same-origin, successful, GET requests
        if (response.ok && event.request.method === 'GET' && event.request.url.startsWith(self.location.origin)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
