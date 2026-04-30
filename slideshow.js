// ============================================================
// Desk Quotes — slideshow + pomodoro + settings
// ============================================================

const QUOTES_URL = 'quotes.json';
const STORAGE = {
  settings: 'dq:settings',
  pomodoro: 'dq:pomodoro',
};

// ----- Settings -------------------------------------------------------------

const DEFAULTS = {
  slideDurationMs: 45_000,
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  cyclesBeforeLongBreak: 4,
  soundEnabled: true,
  pauseDuringWork: false, // slideshow keeps cycling during work by default
  themeMode: 'day',       // day | evening | night (manual choice)
};

const settings = (() => {
  let state;
  try {
    state = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORAGE.settings)) || {}) };
  } catch {
    state = { ...DEFAULTS };
  }
  return {
    get: (k) => state[k],
    set: (k, v) => {
      state[k] = v;
      try { localStorage.setItem(STORAGE.settings, JSON.stringify(state)); } catch {}
    },
    all: () => ({ ...state }),
  };
})();

// ----- Pomodoro state machine ----------------------------------------------

const POM = { IDLE: 'idle', WORK: 'work', BREAK: 'break', LONG: 'long_break' };

const pomodoro = (() => {
  const todayKey = () => new Date().toISOString().slice(0, 10);
  let state;
  try {
    state = JSON.parse(localStorage.getItem(STORAGE.pomodoro)) || {};
  } catch { state = {}; }

  // Reset cycle count on a new day
  if (state.lastDay !== todayKey()) {
    state = { phase: POM.IDLE, endTime: null, completedToday: 0, lastDay: todayKey() };
  } else if (!state.phase) {
    state = { phase: POM.IDLE, endTime: null, completedToday: 0, lastDay: todayKey() };
  }

  const listeners = new Set();
  const save = () => { try { localStorage.setItem(STORAGE.pomodoro, JSON.stringify(state)); } catch {} };
  const emit = () => { for (const l of listeners) l(state); };

  function start() {
    state.phase = POM.WORK;
    state.endTime = Date.now() + settings.get('workMinutes') * 60_000;
    save(); emit();
  }
  function cancel() {
    state.phase = POM.IDLE;
    state.endTime = null;
    save(); emit();
  }
  function advance() {
    if (state.phase === POM.WORK) {
      state.completedToday += 1;
      const isLong = state.completedToday > 0 &&
                     state.completedToday % settings.get('cyclesBeforeLongBreak') === 0;
      state.phase = isLong ? POM.LONG : POM.BREAK;
      const mins = isLong ? settings.get('longBreakMinutes') : settings.get('breakMinutes');
      state.endTime = Date.now() + mins * 60_000;
    } else if (state.phase === POM.BREAK || state.phase === POM.LONG) {
      state.phase = POM.IDLE;
      state.endTime = null;
    }
    save(); emit();
  }

  // Tick every second to detect phase end
  setInterval(() => {
    if (state.phase !== POM.IDLE && state.endTime && Date.now() >= state.endTime) {
      chime(state.phase === POM.WORK ? 'work' : 'break');
      advance();
    } else if (state.phase !== POM.IDLE) {
      // Periodic emit so UI can update progress bar
      emit();
    }
  }, 1000);

  return {
    get state() { return state; },
    get phase() { return state.phase; },
    get endTime() { return state.endTime; },
    get completedToday() { return state.completedToday; },
    get totalDurationMs() {
      const mins = state.phase === POM.WORK ? settings.get('workMinutes')
                 : state.phase === POM.LONG ? settings.get('longBreakMinutes')
                 : state.phase === POM.BREAK ? settings.get('breakMinutes')
                 : 0;
      return mins * 60_000;
    },
    get currentMood() {
      if (state.phase === POM.WORK) return 'work';
      if (state.phase === POM.BREAK || state.phase === POM.LONG) return 'rest';
      return 'any';
    },
    start, cancel, advance,
    toggle: () => state.phase === POM.IDLE ? start() : cancel(),
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();

// ----- Theme palette (manual) ----------------------------------------------

const THEME_MODES = ['day', 'evening', 'night'];

function applyTheme() {
  const setting = settings.get('themeMode');
  // Fall back to day for any unexpected value (covers older settings
  // that had the now-removed 'auto' option).
  const mode = THEME_MODES.includes(setting) ? setting : 'day';
  const body = document.body;
  for (const m of THEME_MODES) body.classList.toggle(`is-${m}`, m === mode);
}

applyTheme();

// ----- Audio (synthesized chime sequences, no asset) -----------------------
//
// Each chime is a short melodic phrase rather than a single tone — friendlier
// and easier to recognize at a distance. Notes are sine + a quieter octave
// harmonic with a fast attack and exponential decay, giving a bell/marimba
// character. All synthesized at runtime, no audio files required.

// C major triad spread + the octave above, in Hz.
const NOTES = {
  C5: 523.25,
  E5: 659.25,
  G5: 783.99,
  A5: 880.00,
  C6: 1046.50,
};

// Each entry: { freq, time (s offset from start), duration (s) }
const CHIME_SEQUENCES = {
  // Work-end: bright ascending major arpeggio — "you did it!"
  work: [
    { freq: NOTES.C5, time: 0.00, duration: 0.50 },
    { freq: NOTES.E5, time: 0.13, duration: 0.55 },
    { freq: NOTES.G5, time: 0.26, duration: 0.65 },
    { freq: NOTES.C6, time: 0.39, duration: 1.40 },
  ],
  // Break-end: gentle two-tone "doorbell" — calling you back
  break: [
    { freq: NOTES.E5, time: 0.00, duration: 0.55 },
    { freq: NOTES.A5, time: 0.28, duration: 1.30 },
  ],
};

let _audioCtx;

function _ensureCtx() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

function _playNote(ctx, freq, startTime, duration, peakGain) {
  // Fundamental sine
  const osc1 = ctx.createOscillator();
  const g1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.value = freq;
  osc1.connect(g1);
  g1.connect(ctx.destination);
  g1.gain.setValueAtTime(0, startTime);
  g1.gain.linearRampToValueAtTime(peakGain, startTime + 0.008);
  g1.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc1.start(startTime);
  osc1.stop(startTime + duration + 0.05);

  // Octave harmonic — quieter, decays faster — gives the note a bell-like
  // shimmer instead of a flat sine tone.
  const osc2 = ctx.createOscillator();
  const g2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 2;
  osc2.connect(g2);
  g2.connect(ctx.destination);
  g2.gain.setValueAtTime(0, startTime);
  g2.gain.linearRampToValueAtTime(peakGain * 0.32, startTime + 0.005);
  g2.gain.exponentialRampToValueAtTime(0.0001, startTime + duration * 0.55);
  osc2.start(startTime);
  osc2.stop(startTime + duration + 0.05);
}

function playChime(which) {
  const sequence = CHIME_SEQUENCES[which];
  if (!sequence) return;
  try {
    const ctx = _ensureCtx();
    const start = ctx.currentTime + 0.02;
    const peakGain = 0.28;
    for (const n of sequence) {
      _playNote(ctx, n.freq, start + n.time, n.duration, peakGain);
    }
  } catch {}
}

// chime() respects the user's sound preference; playChime() always plays
// (used by the Preview buttons in settings).
function chime(which) {
  if (!settings.get('soundEnabled')) return;
  playChime(which);
}

// ----- Mood-aware deck -----------------------------------------------------

class Deck {
  constructor(allItems, getMood) {
    this.allItems = allItems;
    this.getMood = getMood;          // function returning 'work' | 'rest' | 'any'
    this.queue = [];
    this.lastDealt = null;
    this.lastMood = null;
  }

  _refill() {
    const mood = this.getMood();
    const items = mood === 'any'
      ? this.allItems.slice()
      : this.allItems.filter((q) => q.mood === mood || q.mood === 'any');
    if (items.length === 0) {
      // Fallback if a mood has zero matches: use everything
      items.push(...this.allItems);
    }
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    if (this.lastDealt && items[0]?.photoSlug === this.lastDealt.photoSlug && items.length > 1) {
      [items[0], items[1]] = [items[1], items[0]];
    }
    this.queue = items;
    this.lastMood = mood;
  }

  next() {
    const mood = this.getMood();
    if (mood !== this.lastMood || this.queue.length === 0) this._refill();
    const item = this.queue.shift();
    this.lastDealt = item;
    return item;
  }

  peek(n) {
    const out = [];
    let i = 0;
    while (out.length < n && i < this.queue.length) out.push(this.queue[i++]);
    return out;
  }
}

// ----- Image preload -------------------------------------------------------

const imageCache = new Map();
function loadImage(src) {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const p = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => { imageCache.delete(src); resolve(null); };
    img.src = src;
  });
  imageCache.set(src, p);
  return p;
}

// ----- Slideshow renderer --------------------------------------------------

const stage = document.getElementById('stage');

async function showNext(deck, ctx, retryDepth = 0) {
  const item = deck.next();
  const photoSrc = item.photo || `assets/photos/${item.photoSlug}.jpg`;
  const img = await loadImage(photoSrc);
  if (!img && retryDepth < 5) return showNext(deck, ctx, retryDepth + 1);

  const slide = renderSlide(item);
  stage.appendChild(slide);

  requestAnimationFrame(() => requestAnimationFrame(() => slide.classList.add('is-active')));

  if (ctx.current) {
    const prev = ctx.current;
    prev.classList.remove('is-active');
    prev.classList.add('is-leaving');
    setTimeout(() => prev.remove(), 1700);
  }
  ctx.current = slide;

  // Preload next two
  const upcoming = deck.peek(2);
  for (const u of upcoming) loadImage(u.photo || `assets/photos/${u.photoSlug}.jpg`);
}

function renderSlide(item) {
  const slide = document.createElement('article');
  slide.className = 'slide';

  const jx = (Math.random() - 0.5) * 4;
  const jy = (Math.random() - 0.5) * 4;
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
  if (item.objectPosition) img.style.objectPosition = item.objectPosition;
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
  const parts = [];
  if (item.dates) parts.push(escapeHtml(item.dates));
  if (item.role) parts.push(escapeHtml(item.role));
  meta.innerHTML = parts.join('<span class="text__meta-dot">·</span>');
  text.appendChild(meta);

  slide.appendChild(photoWrap);
  slide.appendChild(text);
  return slide;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ----- UI: corner dots, progress bar, cycle dots, body palette ------------

const ui = (() => {
  const ctrlPom = document.getElementById('ctrl-pomodoro');
  const ctrlSet = document.getElementById('ctrl-settings');
  const phaseEl = document.getElementById('pom-phase');
  const timeEl = document.getElementById('pom-time');
  const cyclesEl = document.getElementById('cycles');

  function formatTime(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function phaseLabel(phase) {
    if (phase === POM.WORK) return 'Work';
    if (phase === POM.BREAK) return 'Break';
    if (phase === POM.LONG) return 'Long break';
    return 'Pomodoro';
  }

  function update() {
    const phase = pomodoro.phase;

    // Pomodoro button class state
    ctrlPom.classList.toggle('is-idle', phase === POM.IDLE);
    ctrlPom.classList.toggle('is-work', phase === POM.WORK);
    ctrlPom.classList.toggle('is-break', phase === POM.BREAK || phase === POM.LONG);
    ctrlPom.setAttribute('aria-label',
      phase === POM.IDLE ? 'Start pomodoro' : 'Cancel pomodoro');

    // Phase label + countdown
    phaseEl.textContent = phaseLabel(phase);
    if (phase === POM.IDLE) {
      timeEl.textContent = '';
      ctrlPom.classList.remove('is-urgent');
    } else {
      const remaining = Math.max(0, pomodoro.endTime - Date.now());
      timeEl.textContent = formatTime(remaining);
      ctrlPom.classList.toggle('is-urgent', remaining > 0 && remaining <= 30_000);
    }

    // Body palette for break
    document.body.classList.toggle('is-break',
      phase === POM.BREAK || phase === POM.LONG);

    // Cycle dots
    const max = settings.get('cyclesBeforeLongBreak');
    const filled = pomodoro.completedToday % max;
    const showCycles = phase !== POM.IDLE || filled > 0;
    cyclesEl.classList.toggle('is-visible', showCycles);
    if (cyclesEl.children.length !== max) {
      cyclesEl.innerHTML = '';
      for (let i = 0; i < max; i++) {
        const d = document.createElement('span');
        d.className = 'cycles__dot';
        cyclesEl.appendChild(d);
      }
    }
    [...cyclesEl.children].forEach((d, i) => {
      d.classList.toggle('is-filled', i < filled);
    });
  }

  ctrlPom.addEventListener('click', () => pomodoro.toggle());
  ctrlSet.addEventListener('click', () => settingsPanel.open());

  pomodoro.on(update);
  update();
  return { update };
})();

// ----- Settings panel (built lazily on first open) -------------------------

const settingsPanel = (() => {
  let root = null;

  function build() {
    root = document.createElement('div');
    root.className = 'settings';
    root.innerHTML = `
      <div class="settings__panel" role="dialog" aria-label="Settings">
        <button class="settings__close" type="button" aria-label="Close">×</button>
        <h2 class="settings__title">Settings</h2>

        <div class="settings__section">
          <div class="settings__section-title">Slideshow</div>
          <div class="settings__row">
            <span class="settings__label">Slide duration</span>
            <span class="settings__value" data-key="slideDurationMs"
              data-options="30000:30s|45000:45s|60000:1m|90000:90s"></span>
          </div>
        </div>

        <div class="settings__section">
          <div class="settings__section-title">Pomodoro</div>
          <div class="settings__row">
            <span class="settings__label">Work</span>
            <span class="settings__value" data-key="workMinutes"
              data-options="25:25m|50:50m|90:90m"></span>
          </div>
          <div class="settings__row">
            <span class="settings__label">Break</span>
            <span class="settings__value" data-key="breakMinutes"
              data-options="5:5m|10:10m|15:15m"></span>
          </div>
          <div class="settings__row">
            <span class="settings__label">Long break</span>
            <span class="settings__value" data-key="longBreakMinutes"
              data-options="15:15m|20:20m|30:30m"></span>
          </div>
          <div class="settings__row">
            <span class="settings__label">Cycles before long break</span>
            <span class="settings__value" data-key="cyclesBeforeLongBreak"
              data-options="3:3|4:4|5:5"></span>
          </div>
          <div class="settings__row">
            <span class="settings__label">Sound on transitions</span>
            <span class="settings__value" data-key="soundEnabled"
              data-options="true:On|false:Off"></span>
          </div>
          <div class="settings__row">
            <span class="settings__label">Preview</span>
            <span class="settings__value">
              <button class="settings__chip" type="button" data-preview="work">Work end</button>
              <button class="settings__chip" type="button" data-preview="break">Break end</button>
            </span>
          </div>
        </div>

        <div class="settings__section">
          <div class="settings__section-title">Display</div>
          <div class="settings__row">
            <span class="settings__label">Theme</span>
            <span class="settings__value" data-key="themeMode"
              data-options="day:Light|evening:Warm|night:Dark"></span>
          </div>
        </div>

        <p class="settings__hint">
          Tap the dot in the upper-right corner to start a pomodoro.
          The slideshow keeps cycling but shifts to a working mood; on the
          break the palette warms and the quotes turn reflective.
        </p>

        <button class="settings__refresh" type="button">Reload app</button>
      </div>`;

    // Wire chips. Filter to rows that actually declare data-options;
    // action-only rows (e.g. the Preview row) wire themselves below.
    root.querySelectorAll('.settings__value[data-options]').forEach((wrap) => {
      const key = wrap.dataset.key;
      const opts = wrap.dataset.options.split('|').map((s) => {
        const [v, label] = s.split(':');
        return { v, label };
      });
      for (const { v, label } of opts) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'settings__chip';
        btn.textContent = label;
        btn.dataset.value = v;
        btn.addEventListener('click', () => {
          let parsed;
          if (v === 'true') parsed = true;
          else if (v === 'false') parsed = false;
          else if (/^\d+$/.test(v)) parsed = Number(v);
          else parsed = v; // string keys (e.g. theme: 'auto', 'day', ...)
          settings.set(key, parsed);
          syncChips();
          ui.update();
          if (key === 'themeMode') applyTheme();
        });
        wrap.appendChild(btn);
      }
    });

    function syncChips() {
      root.querySelectorAll('.settings__value[data-options]').forEach((wrap) => {
        const key = wrap.dataset.key;
        const current = String(settings.get(key));
        wrap.querySelectorAll('.settings__chip').forEach((b) => {
          b.classList.toggle('is-on', b.dataset.value === current);
        });
      });
    }
    root._sync = syncChips;

    // Wire up Preview chime buttons — these play unconditionally so a
    // user can hear the chimes even if Sound is currently set to Off.
    root.querySelectorAll('[data-preview]').forEach((btn) => {
      btn.addEventListener('click', () => {
        playChime(btn.dataset.preview);
      });
    });

    // Reload — flush only the shell cache (HTML/CSS/JS/JSON, ~70KB)
    // so a freshly-deployed version is fetched immediately. The photo
    // cache is left intact so we don't have to redownload ~24MB worth
    // of portraits over potentially flaky wifi.
    root.querySelector('.settings__refresh').addEventListener('click', async () => {
      try {
        const keys = await caches.keys();
        for (const k of keys) {
          if (k.startsWith('desk-quotes-shell-')) await caches.delete(k);
        }
      } catch {}
      window.location.reload();
    });

    // Close interactions
    root.querySelector('.settings__close').addEventListener('click', close);
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root.classList.contains('is-open')) close();
    });

    document.body.appendChild(root);
  }

  function open() {
    if (!root) build();
    root._sync();
    root.classList.add('is-open');
  }
  function close() {
    if (root) root.classList.remove('is-open');
  }
  return { open, close };
})();

// ----- Service worker ------------------------------------------------------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(() => {});
}

// ----- Wake lock (best-effort) ---------------------------------------------

async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try { await navigator.wakeLock.request('screen'); } catch {}
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});
requestWakeLock();

// ----- Boot ----------------------------------------------------------------

(async function boot() {
  let quotes;
  try {
    const res = await fetch(QUOTES_URL, { cache: 'no-cache' });
    quotes = await res.json();
  } catch (err) {
    console.error('Failed to load quotes.json', err);
    return;
  }
  if (!Array.isArray(quotes) || quotes.length === 0) return;

  const deck = new Deck(quotes, () => pomodoro.currentMood);
  const ctx = { current: null };

  await loadImage(`assets/photos/${quotes[0].photoSlug}.jpg`);
  showNext(deck, ctx);

  // Recursive setTimeout so a slide-duration change in settings takes
  // effect on the next cycle without needing a reload.
  function scheduleNext() {
    setTimeout(() => {
      if (!(settings.get('pauseDuringWork') && pomodoro.phase === POM.WORK)) {
        showNext(deck, ctx);
      }
      scheduleNext();
    }, settings.get('slideDurationMs'));
  }
  scheduleNext();
})();
