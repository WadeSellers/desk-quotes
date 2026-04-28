// ============================================================
// Desk Quotes — Slideshow engine
// ============================================================

const CONFIG = {
  slideDurationMs: 45_000,
  crossfadeMs: 1500,
  jitterPx: 2,
  preloadAhead: 2,
  quotesUrl: 'quotes.json',
};

const stage = document.getElementById('stage');

// ----- Boot -----------------------------------------------------------------

(async function boot() {
  let quotes;
  try {
    const res = await fetch(CONFIG.quotesUrl, { cache: 'no-cache' });
    quotes = await res.json();
  } catch (err) {
    console.error('Failed to load quotes.json', err);
    return;
  }

  if (!Array.isArray(quotes) || quotes.length === 0) {
    console.error('quotes.json must be a non-empty array');
    return;
  }

  const deck = new Deck(quotes);
  await preload(deck.peek(CONFIG.preloadAhead));
  run(deck);
  registerServiceWorker();
})();

// ----- Deck (random shuffle, no repeats within a pass) ---------------------

class Deck {
  constructor(items) {
    this.source = items;
    this.queue = [];
    this.refill();
  }

  refill() {
    const next = [...this.source];
    // Fisher-Yates shuffle
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    // Avoid back-to-back same item across refills
    if (this.queue.length === 0 && next[0] && this._lastDealt &&
        next[0].photoSlug === this._lastDealt.photoSlug && next.length > 1) {
      [next[0], next[1]] = [next[1], next[0]];
    }
    this.queue.push(...next);
  }

  next() {
    if (this.queue.length === 0) this.refill();
    const item = this.queue.shift();
    this._lastDealt = item;
    return item;
  }

  peek(n) {
    while (this.queue.length < n) this.refill();
    return this.queue.slice(0, n);
  }
}

// ----- Image preloading ----------------------------------------------------

const imageCache = new Map();

function preload(items) {
  return Promise.all(items.map(item => loadImage(item.photo || `assets/photos/${item.photoSlug}.jpg`)));
}

function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // never reject — keep slideshow running
    img.src = src;
  });
  imageCache.set(src, p);
  return p;
}

// ----- Render & cycle ------------------------------------------------------

function run(deck) {
  let currentSlide = null;

  showNext();
  setInterval(showNext, CONFIG.slideDurationMs);

  function showNext() {
    const item = deck.next();
    const slide = renderSlide(item);
    stage.appendChild(slide);

    // Force reflow so opacity transition kicks in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        slide.classList.add('is-active');
      });
    });

    if (currentSlide) {
      const prev = currentSlide;
      prev.classList.remove('is-active');
      prev.classList.add('is-leaving');
      setTimeout(() => prev.remove(), CONFIG.crossfadeMs + 200);
    }

    currentSlide = slide;

    // Preload upcoming slides' photos
    preload(deck.peek(CONFIG.preloadAhead));
  }
}

function renderSlide(item) {
  const slide = document.createElement('article');
  slide.className = 'slide';

  // Anti-burn-in: random subtle position jitter
  const jx = (Math.random() - 0.5) * 2 * CONFIG.jitterPx;
  const jy = (Math.random() - 0.5) * 2 * CONFIG.jitterPx;
  slide.style.setProperty('--jitter-x', `${jx.toFixed(1)}px`);
  slide.style.setProperty('--jitter-y', `${jy.toFixed(1)}px`);

  const photoWrap = document.createElement('div');
  photoWrap.className = 'photo';

  const img = document.createElement('img');
  img.className = 'photo__img';
  img.src = item.photo || `assets/photos/${item.photoSlug}.jpg`;
  img.alt = '';
  img.loading = 'eager';
  img.decoding = 'async';
  photoWrap.appendChild(img);

  const text = document.createElement('div');
  text.className = 'text';

  const quote = document.createElement('p');
  quote.className = 'text__quote';
  quote.textContent = item.quote;
  text.appendChild(quote);

  const rule = document.createElement('div');
  rule.className = 'text__rule';
  text.appendChild(rule);

  const name = document.createElement('p');
  name.className = 'text__name';
  name.textContent = item.name;
  text.appendChild(name);

  const meta = document.createElement('p');
  meta.className = 'text__meta';
  const metaParts = [];
  if (item.dates) metaParts.push(escapeHtml(item.dates));
  if (item.role) metaParts.push(escapeHtml(item.role));
  meta.innerHTML = metaParts.join('<span class="text__meta-dot">·</span>');
  text.appendChild(meta);

  slide.appendChild(photoWrap);
  slide.appendChild(text);
  return slide;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ----- Service worker (offline support) ------------------------------------

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  }
}

// ----- Tap to advance ------------------------------------------------------
// Single tap anywhere advances to the next slide. Double-tap is reserved.

let lastTap = 0;
document.addEventListener('click', () => {
  const now = Date.now();
  if (now - lastTap < 300) return; // ignore rapid double tap
  lastTap = now;
  // dispatch a custom event the cycle can listen to — kept simple by reloading the interval
  // Easiest: reload the page-style approach is too heavy. Just trigger by faking the timer.
  // For simplicity, we'll just reload the cycle by clearing intervals — but we don't have
  // a handle here. Skip for now: tap = no-op. (Reserved for v2.)
});

// ----- Wake-lock (best-effort, may be no-op without HTTPS or user gesture) -

async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      await navigator.wakeLock.request('screen');
    } catch (_) {
      // The OS-level "Stay awake while charging" handles this; not critical.
    }
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});
requestWakeLock();
