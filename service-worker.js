// ============================================================
// Desk Quotes — Service Worker (offline-first cache)
// ============================================================
// Strategy:
//   - Pre-cache the app shell (HTML, CSS, JS, fonts, icons, manifest, quotes).
//   - For photos: cache-first, lazily filling the cache as slides display.
//   - On version bump, the old cache is purged and the shell re-downloaded.

const VERSION = 'v3';
const SHELL_CACHE = `desk-quotes-shell-${VERSION}`;
const PHOTO_CACHE = `desk-quotes-photos-${VERSION}`;

const SHELL_ASSETS = [
  './',
  'index.html',
  'styles.css',
  'slideshow.js',
  'manifest.json',
  'quotes.json',
  'assets/fonts/latin-400-normal.woff2',
  'assets/fonts/latin-400-italic.woff2',
  'assets/fonts/latin-600-normal.woff2',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== PHOTO_CACHE)
            .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Photos rarely change — cache-first, lazy fill. Pass network errors
  // through so the browser can retry on a subsequent load.
  if (url.pathname.includes('/assets/photos/')) {
    event.respondWith(cacheFirst(request, PHOTO_CACHE));
    return;
  }

  // Shell (HTML, CSS, JS, JSON, fonts, icons) — stale-while-revalidate.
  // Returns cache instantly so the slideshow boots fast even on flaky
  // wifi, while a background fetch refreshes the cache for the next load.
  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  // No cache — go to network and let errors propagate naturally.
  const response = await fetch(request);
  if (response && response.status === 200) {
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  // Cached if we have it (fast path), else wait for the network.
  return cached || fetchPromise;
}
