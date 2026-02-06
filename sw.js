const CACHE_NAME = 'orf-v37';

const SHELL = [
  './',
  './index.html',
  './dashboard.html',
  './style.css',
  './js/app.js',
  './js/ui.js',
  './js/recorder.js',
  './js/file-handler.js',
  // './js/stt-api.js',  // Google STT — no longer used
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
  './report.html',
  './manifest.json',
  './playback.html',
  './css/student-playback.css',
  './js/student-playback.js',
  './js/gamification.js',
  './js/effect-engine.js',
  './js/nl-api.js',
  './js/debug-logger.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(SHELL))
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
  if (event.request.url.includes('googleapis.com')) {
    return;
  }

  // Let navigate requests (new windows, page loads) go to network first
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
