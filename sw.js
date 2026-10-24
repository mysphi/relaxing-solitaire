// Offline support: keep the game's files on the phone so it opens with no signal.
// Bump VERSION whenever the app's files change so phones pick up the update.

const VERSION = 'calm-solitaire-v12';
const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'src/app.js',
  'src/engine.js',
  'src/storage.js',
  'src/sound.js',
  'src/winnable.js',
  'sounds/card-down.m4a',
  'sounds/shuffle.m4a',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(APP_FILES.map((f) => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Try the network first so updates show up straight away, and fall back to the
// saved copy when there's no signal. Fonts are served from the cache first.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isFont = url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com';
  if (url.origin !== self.location.origin && !isFont) return;

  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if (isFont && cached) return cached;
      try {
        // GitHub Pages lets browsers keep files for 10 minutes; always check for a newer copy.
        const res = await fetch(event.request, isFont ? undefined : { cache: 'no-cache' });
        if (res && (res.ok || res.type === 'opaque')) cache.put(event.request, res.clone());
        return res;
      } catch (err) {
        if (cached) return cached;
        throw err;
      }
    }),
  );
});
