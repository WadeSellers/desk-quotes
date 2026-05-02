// ============================================================
// Desk Quotes — slideshow + pomodoro + settings
// ============================================================

const QUOTES_URL = 'quotes.json';
const STORAGE = {
  settings: 'dq:settings',
  pomodoro: 'dq:pomodoro',
  deck:     'dq:deck',
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
  showClock: true,        // top-right day + time display
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

// ----- Clock (top-right, day + time) --------------------------------------
//
// Updates on the minute boundary so the display is never more than a few
// milliseconds off. Passes through taps (pointer-events:none on the element).

const clock = (() => {
  const el = document.getElementById('clock');

  function render() {
    const visible = settings.get('showClock');
    el.classList.toggle('is-hidden', !visible);
    if (!visible) return;
    const now  = new Date();
    const day  = now.toLocaleDateString('en-US', { weekday: 'long' });
    const time = now.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
    // Two-line layout: small day label above a larger readable time.
    // Using innerHTML is safe here — both values come from the Date API,
    // never from user input.
    el.innerHTML =
      `<span class="clock__day">${day}</span>` +
      `<span class="clock__time">${time}</span>`;
  }

  // Fire once immediately, then align to the start of every minute.
  function scheduleMinute() {
    const now = new Date();
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50;
    setTimeout(() => { render(); scheduleMinute(); }, msToNextMinute);
  }

  render();
  scheduleMinute();

  return { render };
})();

// ----- Constellation long-break ceremony -----------------------------------
//
// During a long break the slideshow pauses and a calm night-sky canvas fades
// in. Background stars twinkle continuously; six real constellations draw
// themselves in hairline over the course of the break, one at a time on a
// schedule scaled to longBreakMinutes. When the break ends — timer expiry
// or user-tap-to-cancel — the canvas fades out and the slideshow resumes.
//
// All star positions are in normalized 0..1 coords within each constellation's
// bounding box, which is itself in 0..1 coords across the canvas. Lines are
// pairs of star indices. Hand-positioned to fit a portrait tablet without
// overlap and to leave the bottom 14% clear of the corner controls.

const CONSTELLATIONS = [
  {
    name: 'Cassiopeia',
    bbox: { x: 0.07, y: 0.07, w: 0.34, h: 0.13 },
    stars: [
      { x: 0.00, y: 0.50, mag: 0.70 }, // Caph
      { x: 0.25, y: 0.92, mag: 0.80 }, // Schedar
      { x: 0.50, y: 0.30, mag: 0.60 }, // Gamma Cas
      { x: 0.78, y: 0.85, mag: 0.70 }, // Ruchbah
      { x: 1.00, y: 0.45, mag: 0.50 }, // Segin
    ],
    lines: [[0,1],[1,2],[2,3],[3,4]],
    labelAt: { x: 0.45, y: 1.30 },
  },
  {
    name: 'Cygnus',
    bbox: { x: 0.56, y: 0.07, w: 0.36, h: 0.22 },
    stars: [
      { x: 0.95, y: 0.05, mag: 0.95 }, // Deneb
      { x: 0.60, y: 0.45, mag: 0.70 }, // Sadr (heart of cross)
      { x: 0.05, y: 0.95, mag: 0.60 }, // Albireo (foot)
      { x: 0.18, y: 0.65, mag: 0.50 }, // Gienah (left wing)
      { x: 0.92, y: 0.65, mag: 0.50 }, // Delta (right wing)
    ],
    lines: [[0,1],[1,2],[1,3],[1,4]],
    labelAt: { x: 0.50, y: 1.12 },
  },
  {
    name: 'Big Dipper',
    bbox: { x: 0.15, y: 0.33, w: 0.65, h: 0.13 },
    stars: [
      { x: 0.00, y: 0.05, mag: 0.85 }, // Dubhe
      { x: 0.05, y: 0.85, mag: 0.75 }, // Merak
      { x: 0.25, y: 0.95, mag: 0.70 }, // Phecda
      { x: 0.22, y: 0.30, mag: 0.60 }, // Megrez
      { x: 0.45, y: 0.40, mag: 0.85 }, // Alioth
      { x: 0.68, y: 0.55, mag: 0.70 }, // Mizar
      { x: 0.95, y: 0.75, mag: 0.85 }, // Alkaid
    ],
    lines: [[0,1],[1,2],[2,3],[3,0],[3,4],[4,5],[5,6]],
    labelAt: { x: 0.40, y: 1.30 },
  },
  {
    name: 'Lyra',
    bbox: { x: 0.10, y: 0.50, w: 0.20, h: 0.13 },
    stars: [
      { x: 0.55, y: 0.00, mag: 1.00 }, // Vega
      { x: 0.78, y: 0.30, mag: 0.50 }, // Zeta
      { x: 0.05, y: 0.55, mag: 0.50 }, // Sheliak
      { x: 0.55, y: 0.55, mag: 0.50 }, // Delta
      { x: 0.20, y: 0.95, mag: 0.55 }, // Sulafat
    ],
    lines: [[0,1],[1,3],[3,4],[4,2],[2,1]],
    labelAt: { x: 0.45, y: 1.30 },
  },
  {
    name: 'Leo',
    bbox: { x: 0.40, y: 0.50, w: 0.50, h: 0.16 },
    stars: [
      { x: 0.05, y: 0.20, mag: 0.60 }, // Algenubi
      { x: 0.10, y: 0.45, mag: 0.50 }, // Eta
      { x: 0.20, y: 0.10, mag: 0.60 }, // Adhafera
      { x: 0.22, y: 0.32, mag: 0.70 }, // Algieba
      { x: 0.27, y: 0.65, mag: 0.95 }, // Regulus (heart, brightest)
      { x: 0.65, y: 0.32, mag: 0.65 }, // Zosma
      { x: 0.62, y: 0.55, mag: 0.60 }, // Chertan
      { x: 0.95, y: 0.50, mag: 0.85 }, // Denebola (tail)
    ],
    lines: [[4,3],[3,2],[2,0],[0,1],[1,4],[3,5],[5,7],[7,6],[6,4]],
    labelAt: { x: 0.45, y: 1.20 },
  },
  {
    name: 'Orion',
    bbox: { x: 0.20, y: 0.69, w: 0.52, h: 0.17 },
    stars: [
      { x: 0.45, y: 0.00, mag: 0.40 }, // Meissa (head)
      { x: 0.18, y: 0.20, mag: 0.85 }, // Betelgeuse
      { x: 0.78, y: 0.20, mag: 0.70 }, // Bellatrix
      { x: 0.32, y: 0.60, mag: 0.70 }, // Mintaka (belt)
      { x: 0.48, y: 0.60, mag: 0.70 }, // Alnilam (belt)
      { x: 0.65, y: 0.60, mag: 0.70 }, // Alnitak (belt)
      { x: 0.30, y: 0.95, mag: 0.70 }, // Saiph
      { x: 0.82, y: 0.95, mag: 1.00 }, // Rigel
    ],
    lines: [[1,0],[2,0],[1,3],[2,5],[3,4],[4,5],[3,6],[5,7]],
    labelAt: { x: 0.50, y: 1.12 },
  },
];

const constellationSky = (() => {
  let canvas, ctx;
  let bgStars = [];
  let raf = null;
  let active = false;
  let phaseStartTime = 0;
  let schedule = [];
  let dpr = 1;
  let cssW = 0, cssH = 0;

  function init() {
    canvas = document.getElementById('constellation-sky');
    if (!canvas) return false;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    return true;
  }

  function resize() {
    if (!canvas) return;
    // Cap DPR at 2 — beyond that the perf cost outweighs the visual gain.
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width  = cssW + 'px';
    canvas.style.height = cssH + 'px';
    bgStars = generateStars(cssW, cssH, 220);
  }

  function generateStars(w, h, count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 0.7 + 0.3,
        baseAlpha: Math.random() * 0.5 + 0.25,
        twinkleSpeed: Math.random() * 0.0012 + 0.0004,
        twinklePhase: Math.random() * Math.PI * 2,
        warm: Math.random() < 0.25,    // a quarter are warm-colored
      });
    }
    return out;
  }

  // Schedule scales to whatever longBreakMinutes is set to: 30s lead-in,
  // staggered constellation entries, ~18% ambient tail at the end.
  function buildSchedule() {
    const totalSec = settings.get('longBreakMinutes') * 60;
    const startOffset  = 30;
    const ambientTail  = Math.max(60, totalSec * 0.18);
    const drawingWindow = Math.max(60, totalSec - startOffset - ambientTail);
    const stagger = drawingWindow / CONSTELLATIONS.length;
    return CONSTELLATIONS.map((c, i) => ({
      ...c,
      startAt: startOffset + i * stagger,
      drawDuration: Math.min(stagger * 0.55, 35),
    }));
  }

  function start() {
    if (active) return;
    if (!canvas && !init()) return;
    active = true;
    // Anchor to absolute time so a reload mid-break resumes the schedule
    // at the correct visual state instead of starting from the beginning.
    phaseStartTime = pomodoro.endTime - pomodoro.totalDurationMs;
    schedule = buildSchedule();
    document.body.classList.add('is-constellation');
    canvas.classList.add('is-visible');
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    if (!active) return;
    active = false;
    document.body.classList.remove('is-constellation');
    if (canvas) canvas.classList.remove('is-visible');
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  function loop(timestamp) {
    if (!active) return;
    render(timestamp);
    raf = requestAnimationFrame(loop);
  }

  function render(time) {
    ctx.save();
    ctx.scale(dpr, dpr);

    // Solid sky fill — keeps the fade-in crisp instead of revealing the
    // slide through a half-transparent canvas.
    ctx.fillStyle = 'rgb(8, 10, 22)';
    ctx.fillRect(0, 0, cssW, cssH);

    // Background star field — twinkles continuously.
    for (const s of bgStars) {
      const tw = Math.sin(time * s.twinkleSpeed + s.twinklePhase) * 0.35 + 0.65;
      const a = s.baseAlpha * tw;
      ctx.fillStyle = s.warm
        ? `rgba(255, 240, 220, ${a})`
        : `rgba(220, 232, 255, ${a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw each constellation that's reached its scheduled start time.
    const elapsedSec = (Date.now() - phaseStartTime) / 1000;
    for (const c of schedule) {
      if (elapsedSec < c.startAt) continue;
      const cElapsed = elapsedSec - c.startAt;
      const progress = Math.min(cElapsed / c.drawDuration, 1);
      drawConstellation(c, progress, time);
    }

    ctx.restore();
  }

  function drawConstellation(c, progress, time) {
    // First 30% of progress: stars fade in sequentially.
    // Next 70%: lines trace from star to star.
    // Last 22%: label fades in.
    const STAR_PHASE = 0.30;
    const xs = c.stars.map(s => (c.bbox.x + s.x * c.bbox.w) * cssW);
    const ys = c.stars.map(s => (c.bbox.y + s.y * c.bbox.h) * cssH);

    for (let i = 0; i < c.stars.length; i++) {
      const stagger = i / c.stars.length;
      const sp = Math.max(0, Math.min(1, (progress / STAR_PHASE - stagger) * 2));
      if (sp <= 0) continue;

      const star = c.stars[i];
      const mag = star.mag ?? 0.7;
      const r = 1.1 + mag * 1.4;
      const tw = Math.sin(time * 0.0007 + i * 1.7) * 0.12 + 0.88;
      const alpha = sp * tw;

      // Soft halo on the brightest stars only — cheap fill, not a gradient.
      if (mag > 0.8) {
        ctx.fillStyle = `rgba(255, 248, 232, ${alpha * 0.18})`;
        ctx.beginPath();
        ctx.arc(xs[i], ys[i], r * 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = `rgba(255, 248, 232, ${alpha})`;
      ctx.beginPath();
      ctx.arc(xs[i], ys[i], r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (progress > STAR_PHASE) {
      const lp = (progress - STAR_PHASE) / (1 - STAR_PHASE);
      drawLines(c, lp, xs, ys);
    }

    if (progress > 0.78) {
      const labelAlpha = Math.min((progress - 0.78) / 0.18, 1) * 0.45;
      drawLabel(c, labelAlpha);
    }
  }

  // Trace lines segment-by-segment so each one appears to draw across the sky.
  function drawLines(c, lineProgress, xs, ys) {
    const numLines = c.lines.length;
    const total = lineProgress * numLines;
    const fullSegs = Math.floor(total);
    const partial  = total - fullSegs;

    ctx.strokeStyle = 'rgba(232, 220, 198, 0.32)';
    ctx.lineWidth = 0.6;
    ctx.lineCap = 'round';
    ctx.beginPath();

    for (let i = 0; i < Math.min(fullSegs, numLines); i++) {
      const [a, b] = c.lines[i];
      ctx.moveTo(xs[a], ys[a]);
      ctx.lineTo(xs[b], ys[b]);
    }

    if (fullSegs < numLines && partial > 0) {
      const [a, b] = c.lines[fullSegs];
      const ax = xs[a], ay = ys[a];
      const bx = xs[b], by = ys[b];
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + (bx - ax) * partial, ay + (by - ay) * partial);
    }

    ctx.stroke();
  }

  function drawLabel(c, alpha) {
    const x = (c.bbox.x + (c.labelAt?.x ?? 0.5) * c.bbox.w) * cssW;
    const y = (c.bbox.y + (c.labelAt?.y ?? 1.10) * c.bbox.h) * cssH;
    ctx.fillStyle = `rgba(232, 220, 198, ${alpha})`;
    ctx.font = '11px "EB Garamond", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // Canvas has no letter-spacing — fake the tracking with double spaces.
    const text = c.name.toUpperCase().split('').join('  ');
    ctx.fillText(text, x, y);
  }

  if (init()) {
    pomodoro.on((state) => {
      if (state.phase === POM.LONG) start();
      else if (active) stop();
    });
    // Survive a reload mid-long-break: kick straight into the ceremony.
    // The endTime guard skips a stale-LONG state whose timer has already
    // expired (avoids a brief flash before the pomodoro tick advances).
    if (pomodoro.phase === POM.LONG &&
        pomodoro.endTime && pomodoro.endTime > Date.now()) {
      start();
    }
  }
})();

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
  // Pomodoro start: three rising ticks for 3-2-1, then a four-note
  // arpeggio on Go. Synced to the visual countdown timing (800ms steps).
  start: [
    { freq: NOTES.E5, time: 0.00, duration: 0.35 }, // 3
    { freq: NOTES.G5, time: 0.80, duration: 0.35 }, // 2
    { freq: NOTES.A5, time: 1.60, duration: 0.35 }, // 1
    // GO! ascending C major arpeggio
    { freq: NOTES.C5, time: 2.40, duration: 0.50 },
    { freq: NOTES.E5, time: 2.55, duration: 0.55 },
    { freq: NOTES.G5, time: 2.70, duration: 0.65 },
    { freq: NOTES.C6, time: 2.85, duration: 1.40 },
  ],
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
  // Cancel: quick descending two-tone — brief "never mind, going back"
  cancel: [
    { freq: NOTES.G5, time: 0.00, duration: 0.18 },
    { freq: NOTES.C5, time: 0.10, duration: 0.50 },
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
    this._restore();                 // resume mid-deck across reloads
  }

  // Persist queue as photoSlugs so the file is small and survives quote edits
  // (unknown slugs are silently dropped on restore).
  _save() {
    try {
      localStorage.setItem(STORAGE.deck, JSON.stringify({
        queue:     this.queue.map((q) => q.photoSlug),
        lastDealt: this.lastDealt?.photoSlug ?? null,
        lastMood:  this.lastMood,
      }));
    } catch {}
  }

  _restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE.deck));
      if (!saved || !Array.isArray(saved.queue)) return;
      const bySlug = new Map(this.allItems.map((q) => [q.photoSlug, q]));
      const queue  = saved.queue.map((s) => bySlug.get(s)).filter(Boolean);
      if (queue.length === 0) return;   // stale / empty — let _refill() take over
      this.queue     = queue;
      this.lastDealt = bySlug.get(saved.lastDealt) ?? null;
      this.lastMood  = saved.lastMood ?? null;
    } catch {}
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
    this.queue    = items;
    this.lastMood = mood;
    this._save();
  }

  next() {
    const mood = this.getMood();
    if (mood !== this.lastMood || this.queue.length === 0) this._refill();
    const item = this.queue.shift();
    this.lastDealt = item;
    this._save();
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

    // Body palette for break — short BREAK only. LONG break gets the
    // is-constellation class instead (managed by the constellation IIFE),
    // which forces a deep night-sky palette regardless of the user's
    // theme.
    document.body.classList.toggle('is-break', phase === POM.BREAK);

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

  let _countdownRunning = false;
  ctrlPom.addEventListener('click', async () => {
    if (_countdownRunning) return;
    if (pomodoro.phase === POM.IDLE) {
      _countdownRunning = true;
      try {
        await runCountdown();
        pomodoro.start();
      } finally {
        _countdownRunning = false;
      }
    } else {
      chime('cancel');
      pomodoro.cancel();
    }
  });
  ctrlSet.addEventListener('click', () => settingsPanel.open());

  pomodoro.on(update);
  update();
  return { update };
})();

// ----- Countdown overlay (3-2-1-Go before a pomodoro starts) ---------------

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function runCountdown() {
  const overlay = document.createElement('div');
  overlay.className = 'countdown';
  document.body.appendChild(overlay);

  // Force initial paint, then trigger fade-in
  // eslint-disable-next-line no-unused-expressions
  overlay.offsetHeight;
  overlay.classList.add('is-visible');

  // Fire the start chime immediately (audio runs in parallel with visuals)
  chime('start');

  async function showNumeral(text, opts = {}) {
    const el = document.createElement('span');
    el.className = 'countdown__numeral' + (opts.final ? ' countdown__numeral--final' : '');
    el.textContent = text;
    overlay.appendChild(el);
    await wait(opts.holdMs);
    el.remove();
  }

  await showNumeral('3',  { holdMs: 800 });
  await showNumeral('2',  { holdMs: 800 });
  await showNumeral('1',  { holdMs: 800 });
  await showNumeral('Go', { holdMs: 1100, final: true });

  overlay.classList.remove('is-visible');
  await wait(320);
  overlay.remove();
}

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
          <div class="settings__row">
            <span class="settings__label">Clock</span>
            <span class="settings__value" data-key="showClock"
              data-options="true:On|false:Off"></span>
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
          if (key === 'showClock') clock.render();
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

  // Cancellable timer so a tap-to-advance can reset the countdown cleanly.
  // Also picks up slideDurationMs changes made in settings without a reload.
  let _slideTimer = null;
  function scheduleNext() {
    if (_slideTimer) clearTimeout(_slideTimer);
    _slideTimer = setTimeout(() => {
      _slideTimer = null;
      const phase = pomodoro.phase;
      const pausedForWork = settings.get('pauseDuringWork') && phase === POM.WORK;
      const pausedForLong = phase === POM.LONG;     // constellation ceremony
      if (!pausedForWork && !pausedForLong) {
        showNext(deck, ctx);
      }
      scheduleNext();
    }, settings.get('slideDurationMs'));
  }
  scheduleNext();

  // Tap anywhere on the stage (except the corner controls or settings overlay)
  // to jump to the next slide immediately and reset the auto-advance timer.
  // Skipped during LONG since the constellation canvas covers the stage.
  stage.addEventListener('click', (e) => {
    if (e.target.closest('#ctrl-pomodoro, #ctrl-settings, .settings')) return;
    if (pomodoro.phase === POM.LONG) return;
    showNext(deck, ctx);
    scheduleNext();
  });
})();
