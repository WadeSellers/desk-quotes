// ============================================================
// Desk Quotes — Service Worker (offline-first cache)
// ============================================================
// Strategy:
//   - Pre-cache the app shell (HTML, CSS, JS, fonts, icons, manifest, quotes).
//   - For photos: cache-first, lazily filling the cache as slides display.
//   - On version bump, the old cache is purged and the shell re-downloaded.

const VERSION = 'v16';
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
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Bypass the HTTP cache so a freshly-deployed asset isn't masked by
    // a still-warm browser cache entry from the previous version.
    await cache.addAll(SHELL_ASSETS.map((url) => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
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

// Always returns a Response — never null/undefined — so respondWith can't
// crash the page if both cache and network are unavailable.
const networkErrorResponse = () =>
  new Response('', { status: 504, statusText: 'Network error' });

// Fetch with a hard timeout so a stalled request doesn't make the whole
// page hang for 30+ seconds before the browser gives up.
function fetchWithTimeout(request, ms = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fetch timeout')), ms);
    fetch(request).then(
      (response) => { clearTimeout(timer); resolve(response); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetchWithTimeout(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return networkErrorResponse();
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetchWithTimeout(request).then((response) => {
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => networkErrorResponse());

  // Cached if we have it (fast path), else wait for the network.
  return cached || fetchPromise;
}
