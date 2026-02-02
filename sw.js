const CACHE_NAME = 'orf-v4';

const SHELL = [
  './',
  './index.html',
  './dashboard.html',
  './style.css',
  './js/app.js',
  './js/ui.js',
  './js/recorder.js',
  './js/file-handler.js',
  './js/stt-api.js',
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
  './js/dashboard.js',
  './manifest.json'
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

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
