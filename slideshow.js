// ============================================================
// Desk Quotes — slideshow + pomodoro + settings
// ============================================================

const QUOTES_URL = 'quotes.json';
const STORAGE = {
  settings: 'dq:settings',
  pomodoro: 'dq:pomodoro',
  deck:     'dq:deck',
};

// ============================================================
// TEST MODE — quick-cycle preview of the constellation ceremony.
// Tap pomodoro → 3-2-1-Go countdown → 3s "work" → straight into a
// 2-minute long break with the full constellation show.
// Set TEST_MODE = false (or delete this block) when done previewing.
// ============================================================
const TEST_MODE = true;
const TEST_OVERRIDES = {
  workMinutes: 0.05,         // 3 seconds of "work"
  breakMinutes: 0.05,        // 3 seconds (unused with cyclesBeforeLongBreak=1)
  longBreakMinutes: 2,       // 2-minute long break — fits all 6 constellations
  cyclesBeforeLongBreak: 1,  // first cycle goes straight to long break
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
    get: (k) => (TEST_MODE && k in TEST_OVERRIDES) ? TEST_OVERRIDES[k] : state[k],
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

// ----- Meteor shower long-break ceremony -----------------------------------
//
// During a long break the slideshow pauses and a calm night-sky canvas fades
// in. Background stars twinkle continuously while a steady meteor shower
// streaks across the sky — most are subtle small streaks, with occasional
// medium meteors and rare fireballs (slower, brighter, with a soft glow at
// the head). Streaks come from a "radiant" direction with small angular
// variation, the way real showers do, so the scene reads as one shower
// rather than scatter. When the break ends — timer expiry or tap-to-cancel
// — the canvas fades out and the slideshow resumes.
//
// IIFE name and CSS class is-constellation are preserved from the previous
// iteration to keep the surface area of this change small. Read them as
// "long-break night sky" — the contents are now meteors, not constellations.

// Real-meteor color palettes, by what's burning. Close approaches sample
// from this for visual variety; smaller meteors stay in the white/warm/cool
// range. Each entry is the rgb() prefix only — alpha is appended per draw.
const METEOR_COLORS = {
  white:  'rgba(255,250,240,',
  warm:   'rgba(255,225,180,',
  gold:   'rgba(255,210,140,',
  cool:   'rgba(180,210,255,',
  copper: 'rgba(150,255,170,',  // copper burning — green
  mag:    'rgba(150,200,255,',  // magnesium — vivid blue
  ca:     'rgba(255,140,100,',  // calcium — red-orange
};

class Meteor {
  constructor(canvasW, canvasH) {
    this.canvasW = canvasW;
    this.canvasH = canvasH;
    this.spawnAge = 0;          // seconds since spawn — used by trail emission

    // Pick the type first — it determines speed, length, and (for the close
    // approach) overrides the angle to a tighter cone for drama.
    const sizeRand = Math.random();
    let speed;
    let useRadiant = true;
    let radiantSpread = 0.45;

    if (sizeRand < 0.04) {
      // CLOSE APPROACH — rare, fast, thick, glowing, multi-layer trail.
      // Trail is now long enough to span much of the canvas at peak.
      this.length     = 600 + Math.random() * 400;
      this.brightness = 0.98;
      this.headRadius = 3.5 + Math.random() * 2.0;
      this.glow       = 0.95;
      this.lineWidth  = 5.0 + Math.random() * 3.0;
      this.coreWidth  = 1.5 + Math.random() * 1.0;
      speed           = 1700 + Math.random() * 700;
      radiantSpread   = 0.30;
      this.kind       = 'close';
    } else if (sizeRand < 0.13) {
      this.length     = 150 + Math.random() * 90;
      this.brightness = 0.85 + Math.random() * 0.15;
      this.headRadius = 2.2 + Math.random() * 0.6;
      this.glow       = 0.55;
      this.lineWidth  = 1.5 + Math.random() * 0.7;
      speed           = 280 + Math.random() * 200;
      this.kind       = 'fireball';
    } else if (sizeRand < 0.38) {
      this.length     = 90 + Math.random() * 60;
      this.brightness = 0.55 + Math.random() * 0.20;
      this.headRadius = 1.4 + Math.random() * 0.4;
      this.glow       = 0.20;
      this.lineWidth  = 1.0 + Math.random() * 0.4;
      speed           = 400 + Math.random() * 240;
      this.kind       = 'medium';
    } else {
      this.length     = 50 + Math.random() * 40;
      this.brightness = 0.32 + Math.random() * 0.20;
      this.headRadius = 0.9 + Math.random() * 0.3;
      this.glow       = 0;
      this.lineWidth  = 0.6 + Math.random() * 0.4;
      speed           = 500 + Math.random() * 220;
      this.kind       = 'small';
    }

    // ~9% of regular meteors are sporadic — random angle, not from the
    // radiant. Close approaches stay on-radiant for drama.
    if (this.kind !== 'close' && Math.random() < 0.09) useRadiant = false;

    const angle = useRadiant
      ? Math.PI * 0.30 + (Math.random() - 0.5) * radiantSpread
      : Math.random() * Math.PI * 2;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.angle = angle;

    // Spawn just outside the edge that the velocity points away from.
    const padding = this.length + 40;
    if (Math.abs(this.vx) > Math.abs(this.vy)) {
      this.x = this.vx > 0 ? -padding : canvasW + padding;
      this.y = Math.random() * canvasH;
    } else {
      this.x = Math.random() * canvasW;
      this.y = this.vy > 0 ? -padding : canvasH + padding;
    }

    // Color — close approaches sample from real meteor-burning palettes
    // for variety. Other types stay in the white/warm/cool range.
    const c = Math.random();
    if (this.kind === 'close') {
      // 40% white, 20% warm gold, 15% copper-green, 15% mag-blue, 10% calcium
      if (c < 0.40)      this.colorBase = METEOR_COLORS.white;
      else if (c < 0.60) this.colorBase = METEOR_COLORS.warm;
      else if (c < 0.75) this.colorBase = METEOR_COLORS.copper;
      else if (c < 0.90) this.colorBase = METEOR_COLORS.mag;
      else               this.colorBase = METEOR_COLORS.ca;
    } else if (this.kind === 'fireball') {
      this.colorBase = c < 0.65 ? METEOR_COLORS.white : METEOR_COLORS.warm;
    } else if (c < 0.78) this.colorBase = 'rgba(255,248,232,';
    else if (c < 0.90)   this.colorBase = METEOR_COLORS.gold;
    else                 this.colorBase = METEOR_COLORS.cool;

    // Per-meteor flags used by the outer update loop.
    this.flashTriggered = false;
    this.trainSpawned = false;
  }

  update(dt) {
    this.spawnAge += dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  isDead() {
    const margin = this.length + 40;
    return this.x > this.canvasW + margin
        || this.y > this.canvasH + margin
        || this.x < -margin
        || this.y < -margin;
  }

  // Returns whether the head is currently within the visible canvas.
  isOnCanvas() {
    return this.x >= 0 && this.x <= this.canvasW
        && this.y >= 0 && this.y <= this.canvasH;
  }

  draw(ctx) {
    const speed = Math.hypot(this.vx, this.vy);
    if (speed === 0) return;

    const dirX = this.vx / speed;
    const dirY = this.vy / speed;
    const tailX = this.x - dirX * this.length;
    const tailY = this.y - dirY * this.length;

    if (this.kind === 'close') {
      // Outer halo stroke — wide, dim, soft. Gives the trail volume.
      const haloGrad = ctx.createLinearGradient(tailX, tailY, this.x, this.y);
      haloGrad.addColorStop(0, `${this.colorBase}0)`);
      haloGrad.addColorStop(1, `${this.colorBase}${(this.brightness * 0.30).toFixed(3)})`);
      ctx.strokeStyle = haloGrad;
      ctx.lineWidth = this.lineWidth * 2.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();

      // Mid stroke
      const midGrad = ctx.createLinearGradient(tailX, tailY, this.x, this.y);
      midGrad.addColorStop(0, `${this.colorBase}0)`);
      midGrad.addColorStop(1, `${this.colorBase}${this.brightness.toFixed(3)})`);
      ctx.strokeStyle = midGrad;
      ctx.lineWidth = this.lineWidth;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();

      // Bright core — thin, near-white, sits on top
      const coreGrad = ctx.createLinearGradient(tailX, tailY, this.x, this.y);
      coreGrad.addColorStop(0, 'rgba(255,255,255,0)');
      coreGrad.addColorStop(1, 'rgba(255,255,255,0.95)');
      ctx.strokeStyle = coreGrad;
      ctx.lineWidth = this.coreWidth;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
    } else {
      // Single trail for non-close meteors.
      const grad = ctx.createLinearGradient(tailX, tailY, this.x, this.y);
      grad.addColorStop(0, `${this.colorBase}0)`);
      grad.addColorStop(1, `${this.colorBase}${this.brightness.toFixed(3)})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = this.lineWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
    }

    // Bright head.
    ctx.fillStyle = `${this.colorBase}${this.brightness.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.headRadius, 0, Math.PI * 2);
    ctx.fill();

    // Glow halo.
    if (this.glow > 0) {
      const glowR = this.headRadius * (this.kind === 'close' ? 12 : 6);
      const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, glowR);
      g.addColorStop(0, `${this.colorBase}${(this.brightness * this.glow).toFixed(3)})`);
      g.addColorStop(1, `${this.colorBase}0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.x, this.y, glowR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Spark — small glowing particle shed from close approaches. Drifts
// slightly outward of the meteor's path with drag, fades as it travels.
// Always moving (drag scales velocity, never zeroes it instantly), so
// this respects the no-pause-fade constraint.
class Spark {
  constructor(x, y, vx, vy, colorBase) {
    this.x = x;
    this.y = y;
    // Inherit a fraction of the meteor's velocity, plus random scatter.
    this.vx = vx * 0.25 + (Math.random() - 0.5) * 140;
    this.vy = vy * 0.25 + (Math.random() - 0.5) * 140;
    this.life = 0;
    this.maxLife = 0.50 + Math.random() * 0.45;
    this.brightness = 0.55 + Math.random() * 0.40;
    this.colorBase = colorBase;
    this.r = 0.7 + Math.random() * 0.7;
  }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // Aerodynamic drag — slows over time but keeps moving.
    this.vx *= Math.pow(0.30, dt);
    this.vy *= Math.pow(0.30, dt);
    this.life += dt;
  }
  isDead() { return this.life >= this.maxLife; }
  draw(ctx) {
    const a = (1 - this.life / this.maxLife) * this.brightness;
    if (a <= 0.01) return;
    ctx.fillStyle = `${this.colorBase}${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// PersistentTrain — a wide, soft, drifting glow that lingers behind the
// brightest meteors after they pass. Drifts horizontally (atmospheric
// "high-altitude wind") so it's never stationary, and fades over a few
// seconds. Real phenomenon, sometimes seen for minutes after a fireball.
class PersistentTrain {
  constructor(x1, y1, x2, y2, colorBase, brightness) {
    this.x1 = x1; this.y1 = y1;
    this.x2 = x2; this.y2 = y2;
    this.colorBase = colorBase;
    this.brightness = brightness;
    this.life = 0;
    this.maxLife = 4.0 + Math.random() * 3.5;
    // Slow horizontal drift — stratospheric wind direction varies a bit.
    this.driftX = (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 14);
    this.driftY = (Math.random() - 0.5) * 4;
  }
  update(dt) {
    this.life += dt;
    this.x1 += this.driftX * dt;
    this.x2 += this.driftX * dt;
    this.y1 += this.driftY * dt;
    this.y2 += this.driftY * dt;
  }
  isDead() { return this.life >= this.maxLife; }
  draw(ctx) {
    const t = this.life / this.maxLife;
    const a = (1 - t) * this.brightness * 0.55;
    if (a <= 0.01) return;
    // Wide soft stroke.
    const grad = ctx.createLinearGradient(this.x1, this.y1, this.x2, this.y2);
    grad.addColorStop(0,   `${this.colorBase}0)`);
    grad.addColorStop(0.5, `${this.colorBase}${a.toFixed(3)})`);
    grad.addColorStop(1,   `${this.colorBase}0)`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 12 + (1 - t) * 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(this.x1, this.y1);
    ctx.lineTo(this.x2, this.y2);
    ctx.stroke();
  }
}

const constellationSky = (() => {
  let canvas, ctx;
  let bgStars = [];
  let meteors = [];
  let sparks = [];
  let trains = [];
  let raf = null;
  let active = false;
  let dpr = 1;
  let cssW = 0, cssH = 0;
  let lastFrameMs = 0;
  let spawnAccumulator = 0;
  // Brief screen-brightness pulse triggered by close approaches near center.
  // Stored as the timestamp (ms) of the trigger; the render code computes a
  // 200ms decay overlay from that.
  let lastFlashMs = -1e9;
  let lastFlashStrength = 0;

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
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width  = cssW + 'px';
    canvas.style.height = cssH + 'px';
    // Star field generated slightly outside the viewport so subtle drift
    // doesn't reveal a star-less edge.
    bgStars = generateStars(cssW, cssH, 240);
    for (const m of meteors) { m.canvasW = cssW; m.canvasH = cssH; }
  }

  function generateStars(w, h, count) {
    const out = [];
    const padX = 60, padY = 60;
    for (let i = 0; i < count; i++) {
      out.push({
        x: -padX + Math.random() * (w + padX * 2),
        y: -padY + Math.random() * (h + padY * 2),
        r: Math.random() * 0.7 + 0.3,
        baseAlpha: Math.random() * 0.5 + 0.25,
        twinkleSpeed: Math.random() * 0.0012 + 0.0004,
        twinklePhase: Math.random() * Math.PI * 2,
        warm: Math.random() < 0.25,
        // Per-star "flash" state — cooldown timer + active flash time.
        // When flashCooldown reaches 0, the star may flare; flashTimer
        // tracks the active flare's progress so it always moves through
        // its full cycle (no pause-fade).
        flashCooldown: 30 + Math.random() * 90,  // seconds until next flare
        flashTimer: 0,
      });
    }
    return out;
  }

  function start() {
    if (active) return;
    if (!canvas && !init()) return;
    active = true;
    meteors = [];
    sparks = [];
    trains = [];
    spawnAccumulator = 0;
    lastFlashMs = -1e9;
    lastFrameMs = 0;
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
    const dt = lastFrameMs ? Math.min((timestamp - lastFrameMs) / 1000, 0.05) : 0.016;
    lastFrameMs = timestamp;
    update(dt, timestamp);
    render(timestamp);
    raf = requestAnimationFrame(loop);
  }

  function update(dt, time) {
    // Continuous shower: ~2.6 meteors/sec average.
    const baseRate = 2.6;
    spawnAccumulator += dt * baseRate;
    while (spawnAccumulator >= 1) {
      spawnAccumulator -= 1;
      meteors.push(new Meteor(cssW, cssH));
    }

    // Bursts — sudden flurries roughly every 18s.
    if (Math.random() < dt * 0.055) {
      const burstSize = 6 + Math.floor(Math.random() * 7);
      for (let i = 0; i < burstSize; i++) {
        meteors.push(new Meteor(cssW, cssH));
      }
    }

    // Update meteors and emit sparks/trains/flashes from special ones.
    for (const m of meteors) {
      m.update(dt);

      // Close approaches: shed sparks every ~25-50ms while on canvas.
      if (m.kind === 'close' && m.isOnCanvas()) {
        m._sparkAcc = (m._sparkAcc || 0) + dt;
        const interval = 0.025 + Math.random() * 0.025;
        while (m._sparkAcc >= interval) {
          m._sparkAcc -= interval;
          // 2-3 sparks per emission for density
          const n = 2 + Math.floor(Math.random() * 2);
          for (let i = 0; i < n; i++) {
            sparks.push(new Spark(m.x, m.y, m.vx, m.vy, m.colorBase));
          }
        }
      }

      // Screen flash — fired once per close approach, when its head
      // passes through the central 60% of the canvas.
      if (m.kind === 'close' && !m.flashTriggered && m.isOnCanvas()) {
        const cx = cssW * 0.5, cy = cssH * 0.5;
        const dist = Math.hypot(m.x - cx, m.y - cy);
        if (dist < Math.min(cssW, cssH) * 0.30) {
          m.flashTriggered = true;
          lastFlashMs = time;
          lastFlashStrength = 0.18 + Math.random() * 0.08;
        }
      }

      // Persistent train — close approaches and bright fireballs leave
      // one when their head reaches roughly mid-canvas. Fired once.
      if (!m.trainSpawned && m.isOnCanvas()) {
        const reachedMidpoint =
          (m.vx > 0 && m.x > cssW * 0.40) ||
          (m.vx < 0 && m.x < cssW * 0.60) ||
          (Math.abs(m.vx) < Math.abs(m.vy) && Math.abs(m.y - cssH * 0.5) < cssH * 0.20);
        if (reachedMidpoint) {
          if (m.kind === 'close' || (m.kind === 'fireball' && Math.random() < 0.55)) {
            m.trainSpawned = true;
            const speed = Math.hypot(m.vx, m.vy);
            const dirX = m.vx / speed, dirY = m.vy / speed;
            // Train spans the bulk of the trail behind the head.
            const trailLen = m.length * (m.kind === 'close' ? 0.85 : 0.75);
            const x1 = m.x - dirX * trailLen;
            const y1 = m.y - dirY * trailLen;
            const x2 = m.x;
            const y2 = m.y;
            const trainBright = m.kind === 'close' ? 0.9 : 0.55;
            trains.push(new PersistentTrain(x1, y1, x2, y2, m.colorBase, trainBright));
          }
        }
      }
    }

    for (const s of sparks) s.update(dt);
    for (const t of trains) t.update(dt);

    if (meteors.length > 120) meteors = meteors.filter((m) => !m.isDead()).slice(-120);
    else                       meteors = meteors.filter((m) => !m.isDead());
    if (sparks.length > 400)   sparks = sparks.filter((s) => !s.isDead()).slice(-400);
    else                       sparks = sparks.filter((s) => !s.isDead());
    trains = trains.filter((t) => !t.isDead());

    // Background star twinkle-flashes. Each star carries its own cooldown,
    // and once a flash starts it always animates through its full ~0.6s
    // cycle (no static fades).
    for (const s of bgStars) {
      if (s.flashTimer > 0) {
        s.flashTimer = Math.max(0, s.flashTimer - dt);
      } else if (s.flashCooldown > 0) {
        s.flashCooldown -= dt;
      } else {
        s.flashTimer = 0.55 + Math.random() * 0.30;
        s._flashDuration = s.flashTimer;
        s.flashCooldown = 30 + Math.random() * 100;
      }
    }
  }

  function render(time) {
    ctx.save();
    ctx.scale(dpr, dpr);

    // Atmospheric vertical gradient — deep navy at top, slightly warmer
    // and faintly purplish toward the bottom. Subtle but adds real depth.
    const skyGrad = ctx.createLinearGradient(0, 0, 0, cssH);
    skyGrad.addColorStop(0,    'rgb(5, 7, 18)');
    skyGrad.addColorStop(0.55, 'rgb(8, 9, 22)');
    skyGrad.addColorStop(1,    'rgb(14, 11, 28)');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, cssW, cssH);

    // Subtle slow drift of the entire star field — sin/cos give an
    // elliptical sway. The stars are generated with a 60px padding, so
    // up to ±30px drift never reveals a star-less edge.
    const driftX = Math.sin(time * 0.000035) * 22;
    const driftY = Math.cos(time * 0.000022) * 12;

    ctx.save();
    ctx.translate(driftX, driftY);

    // Background star field. Each star has continuous twinkle plus an
    // occasional bright flare.
    for (const s of bgStars) {
      const tw = Math.sin(time * s.twinkleSpeed + s.twinklePhase) * 0.35 + 0.65;
      let a = s.baseAlpha * tw;
      let r = s.r;
      // Flash boost — a bell-shaped pulse over the flash duration.
      if (s.flashTimer > 0 && s._flashDuration > 0) {
        const t = 1 - s.flashTimer / s._flashDuration;        // 0 → 1
        const bell = Math.sin(t * Math.PI);                   // 0 → 1 → 0
        a = Math.min(1, a + bell * 0.85);
        r = s.r + bell * 1.4;
      }
      ctx.fillStyle = s.warm
        ? `rgba(255, 240, 220, ${a})`
        : `rgba(220, 232, 255, ${a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Persistent trains under meteors so the active heads always look
    // brighter than their afterglow.
    for (const t of trains) t.draw(ctx);

    // Meteors and sparks.
    for (const m of meteors) m.draw(ctx);
    for (const s of sparks)  s.draw(ctx);

    // Screen flash — brief full-canvas brightness pulse from a close
    // approach. Decays in 200ms.
    const flashAge = time - lastFlashMs;
    if (flashAge >= 0 && flashAge < 220) {
      const fa = (1 - flashAge / 220) * lastFlashStrength;
      ctx.fillStyle = `rgba(255, 250, 235, ${fa.toFixed(3)})`;
      ctx.fillRect(0, 0, cssW, cssH);
    }

    ctx.restore();
  }

  if (init()) {
    pomodoro.on((state) => {
      if (state.phase === POM.LONG) start();
      else if (active) stop();
    });
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
