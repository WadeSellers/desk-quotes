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
  themeMode: 'day',       // day | evening | night (visual palette)
  showClock: true,        // top-right day + time display
  quoteTheme: 'thinkers', // thinkers | acting (which quote collection)
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
    let radiantSpread = 0.40;

    if (sizeRand < 0.18) {
      // CLOSE APPROACH — common now, fast, thick, multi-layer trail. Built
      // for "flying through the shower" feel: long enough to span most of
      // the canvas, thick enough to read as a burning rock not a line.
      this.length     = 800 + Math.random() * 600;
      this.brightness = 0.98;
      this.headRadius = 3.8 + Math.random() * 2.2;
      this.glow       = 1.0;
      this.lineWidth  = 6.0 + Math.random() * 4.0;
      this.coreWidth  = 1.6 + Math.random() * 1.2;
      speed           = 1700 + Math.random() * 700;
      radiantSpread   = 0.28;
      this.kind       = 'close';
    } else if (sizeRand < 0.30) {
      this.length     = 150 + Math.random() * 90;
      this.brightness = 0.85 + Math.random() * 0.15;
      this.headRadius = 2.2 + Math.random() * 0.6;
      this.glow       = 0.55;
      this.lineWidth  = 1.5 + Math.random() * 0.7;
      speed           = 280 + Math.random() * 200;
      this.kind       = 'fireball';
    } else if (sizeRand < 0.55) {
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

    // All meteors come from the same radiant — no sporadic counter-direction
    // streaks. Slight per-meteor jitter keeps them from being parallel.
    const angle = Math.PI * 0.30 + (Math.random() - 0.5) * radiantSpread;
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

// Comet — a different beast than meteors. Slow, large, with a wide
// triple-layered diffuse tail and a luminous nucleus. Crosses the sky
// over many seconds, giving "look up there" moments. Always moving (no
// pause) at constant velocity until off-canvas.
class Comet {
  constructor(canvasW, canvasH) {
    this.canvasW = canvasW;
    this.canvasH = canvasH;
    // Slow speed — comets drift, they don't streak.
    const speed = 80 + Math.random() * 80;
    // Same radiant cone as meteors so the directionality stays coherent.
    const angle = Math.PI * 0.30 + (Math.random() - 0.5) * 0.35;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.length     = 280 + Math.random() * 220;
    this.headRadius = 4.0 + Math.random() * 2.0;
    this.brightness = 0.85;

    const padding = this.length + 80;
    if (Math.abs(this.vx) > Math.abs(this.vy)) {
      this.x = this.vx > 0 ? -padding : canvasW + padding;
      this.y = Math.random() * canvasH * 0.7;
    } else {
      this.x = Math.random() * canvasW * 0.85;
      this.y = this.vy > 0 ? -padding : canvasH + padding;
    }

    // Comets lean blue-white (ion tail) or warm cream (dust tail).
    this.colorBase = Math.random() < 0.5
      ? 'rgba(220,235,255,'   // cool ion-tail blue-white
      : 'rgba(255,238,210,';  // warm dust-tail cream
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  isDead() {
    const margin = this.length + 80;
    return this.x > this.canvasW + margin
        || this.y > this.canvasH + margin
        || this.x < -margin
        || this.y < -margin;
  }

  draw(ctx) {
    const speed = Math.hypot(this.vx, this.vy);
    if (speed === 0) return;
    const dirX = this.vx / speed;
    const dirY = this.vy / speed;
    const tailX = this.x - dirX * this.length;
    const tailY = this.y - dirY * this.length;

    // Three layered tails — wide outer haze, mid body, narrow bright core.
    // Combined they read as a soft diffuse plume rather than a sharp line.
    const layer = (lineWidth, alphaScale) => {
      const grad = ctx.createLinearGradient(tailX, tailY, this.x, this.y);
      grad.addColorStop(0, `${this.colorBase}0)`);
      grad.addColorStop(1, `${this.colorBase}${(this.brightness * alphaScale).toFixed(3)})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
    };
    layer(34, 0.18);   // outer haze
    layer(14, 0.45);   // mid body
    layer(3.5, 1.0);   // bright core

    // Nucleus glow halo
    const glowR = this.headRadius * 9;
    const glowGrad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, glowR);
    glowGrad.addColorStop(0, `${this.colorBase}${(this.brightness * 0.45).toFixed(3)})`);
    glowGrad.addColorStop(1, `${this.colorBase}0)`);
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(this.x, this.y, glowR, 0, Math.PI * 2);
    ctx.fill();

    // Bright nucleus
    ctx.fillStyle = `${this.colorBase}${this.brightness.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.headRadius, 0, Math.PI * 2);
    ctx.fill();

    // White-hot core dot in the very center of the nucleus
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.headRadius * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ============================================================================
// Standing Ovation scene — long-break ceremony for the Acting theme.
// Endless curtain calls: velvet curtains part, silhouettes on stage take bows,
// applause ripples flow forward from the audience, bouquets arc onto the
// stage, petals drift, curtains close, brief darkness, repeat — with per-cycle
// variation so it never feels metronomic.
// ============================================================================

class BowActor {
  constructor(stagePos, gender) {
    this.stagePos = stagePos;          // 0..1 horizontal position on stage
    this.gender = gender;              // 'masc' | 'fem' — affects silhouette shape
    this.bowPhase = 0;                 // 0=upright, 1=full bow (~37° forward tilt)
    this.bowTarget = 0;
    this.lerpRate = 2.8 + Math.random() * 1.2;
    this.heightJitter = 0.92 + Math.random() * 0.16;  // slight per-actor scale
  }

  setBow(target) { this.bowTarget = target; }

  update(dt) {
    this.bowPhase += (this.bowTarget - this.bowPhase) * Math.min(1, dt * this.lerpRate);
  }

  // Draws a silhouette at the given stage rect. Hip is the pivot for the bow:
  // legs stay vertical, torso rotates forward, head follows the torso.
  draw(ctx, stageX, stageY, stageW, stageH) {
    const px = stageX + this.stagePos * stageW;
    const baseScale = (stageH / 320) * this.heightJitter;
    const tilt = this.bowPhase * 0.65;  // up to ~37 degrees forward

    const headR     = 9 * baseScale;
    const torsoLen  = 52 * baseScale;
    const legLen    = 38 * baseScale;
    const shoulderW = 24 * baseScale;
    const hipX = px;
    const hipY = stageY + stageH * 0.96 - legLen;

    ctx.fillStyle = 'rgb(0, 0, 0)';

    // Legs (vertical)
    ctx.fillRect(hipX - 6 * baseScale, hipY, 12 * baseScale, legLen);

    // For fem silhouette, add a gown/skirt below the hips
    if (this.gender === 'fem') {
      ctx.beginPath();
      ctx.moveTo(hipX - 6 * baseScale,  hipY + legLen * 0.05);
      ctx.lineTo(hipX + 6 * baseScale,  hipY + legLen * 0.05);
      ctx.lineTo(hipX + 14 * baseScale, hipY + legLen);
      ctx.lineTo(hipX - 14 * baseScale, hipY + legLen);
      ctx.closePath();
      ctx.fill();
    }

    // Torso — rectangle pivoting at the hip, tilted forward by `tilt`.
    ctx.save();
    ctx.translate(hipX, hipY);
    ctx.rotate(tilt);
    ctx.fillRect(-shoulderW * 0.5, -torsoLen, shoulderW, torsoLen);
    // Subtle shoulder rounding
    ctx.beginPath();
    ctx.arc(-shoulderW * 0.5, -torsoLen, 3 * baseScale, 0, Math.PI * 2);
    ctx.arc( shoulderW * 0.5, -torsoLen, 3 * baseScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Head — at the end of the rotated torso.
    const headX = hipX + Math.sin(tilt) * (torsoLen + headR);
    const headY = hipY - Math.cos(tilt) * (torsoLen + headR);
    ctx.beginPath();
    ctx.arc(headX, headY, headR, 0, Math.PI * 2);
    ctx.fill();

    // Arm-to-chest gesture during deep bow — single stroke from shoulder.
    if (this.bowPhase > 0.3) {
      const armAlpha = (this.bowPhase - 0.3) / 0.7;
      const shoulderX = hipX + Math.sin(tilt) * torsoLen * 0.85;
      const shoulderY = hipY - Math.cos(tilt) * torsoLen * 0.85;
      const handX = hipX + Math.sin(tilt) * torsoLen * 0.55;
      const handY = hipY - Math.cos(tilt) * torsoLen * 0.55;
      ctx.strokeStyle = `rgba(0, 0, 0, ${armAlpha.toFixed(2)})`;
      ctx.lineWidth = 6 * baseScale;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(shoulderX, shoulderY);
      ctx.lineTo(handX, handY);
      ctx.stroke();
    }
  }
}

class AudienceMember {
  constructor(x, baseY, scale) {
    this.x = x;
    this.baseY = baseY;
    this.scale = scale;                // bigger near front (lower y), smaller in back
    this.headSize     = (10 + Math.random() * 4) * scale;
    this.shoulderWidth = (28 + Math.random() * 12) * scale;
    this.standOffset = 0;              // 0=sitting, +ve=standing (head lifts)
    this.standTarget = 0;
    this.standPhase  = Math.random() * Math.PI * 2;
    this.standSpeed  = 1.4 + Math.random() * 1.0;
  }
  update(dt) {
    this.standOffset += (this.standTarget - this.standOffset) * Math.min(1, dt * this.standSpeed);
    // A subtle continuous breathing sway so silhouettes are never frozen.
    this.standPhase += dt * 1.2;
  }
  draw(ctx) {
    const sway = Math.sin(this.standPhase) * 0.6;
    const y = this.baseY - this.standOffset + sway;
    ctx.fillStyle = 'rgb(0, 0, 0)';
    // Shoulders / upper torso — a rounded trapezoid.
    ctx.beginPath();
    ctx.moveTo(this.x - this.shoulderWidth * 0.5, y + this.headSize * 2.6);
    ctx.lineTo(this.x + this.shoulderWidth * 0.5, y + this.headSize * 2.6);
    ctx.lineTo(this.x + this.shoulderWidth * 0.32, y + this.headSize * 0.7);
    ctx.lineTo(this.x - this.shoulderWidth * 0.32, y + this.headSize * 0.7);
    ctx.closePath();
    ctx.fill();
    // Head
    ctx.beginPath();
    ctx.arc(this.x, y, this.headSize, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Soft golden glow arc that travels from the audience toward the stage —
// the visual of applause flowing forward. Always moving (no pause-fade).
class ApplauseRipple {
  constructor(canvasW, canvasH, intensity) {
    this.startY  = canvasH * (0.85 + Math.random() * 0.10);
    this.targetY = canvasH * 0.58;
    this.y = this.startY;
    this.x = canvasW * (0.30 + Math.random() * 0.40);
    this.halfWidth = canvasW * (0.22 + Math.random() * 0.15);
    this.speed  = 70 + Math.random() * 60;
    this.alpha  = 0;            // ramp up briefly so origin doesn't pop in
    this.peakAlpha = (0.18 + Math.random() * 0.18) * intensity;
    this.life   = 0;
  }
  update(dt) {
    this.life += dt;
    this.y -= this.speed * dt;
    // 0..0.3 of travel: fade in. Then linear fade as it climbs.
    const total = this.startY - this.targetY;
    const traveled = this.startY - this.y;
    const t = traveled / total;
    if (t < 0.15) {
      this.alpha = (t / 0.15) * this.peakAlpha;
    } else {
      this.alpha = (1 - (t - 0.15) / 0.85) * this.peakAlpha;
    }
  }
  isDead() { return this.y < this.targetY || this.alpha <= 0.005; }
  draw(ctx) {
    const grad = ctx.createLinearGradient(this.x - this.halfWidth, 0, this.x + this.halfWidth, 0);
    grad.addColorStop(0,   'rgba(255, 200, 130, 0)');
    grad.addColorStop(0.5, `rgba(255, 200, 130, ${this.alpha.toFixed(3)})`);
    grad.addColorStop(1,   'rgba(255, 200, 130, 0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(this.x - this.halfWidth, this.y);
    ctx.quadraticCurveTo(this.x, this.y - 12, this.x + this.halfWidth, this.y);
    ctx.stroke();
  }
}

// A tossed bouquet — parabolic arc from the audience onto the stage. Drawn
// as a cluster of red rose blobs with green stems trailing the motion.
class Bouquet {
  constructor(canvasW, canvasH, stageY) {
    this.canvasH = canvasH;
    this.x = canvasW * (0.20 + Math.random() * 0.60);
    this.y = canvasH * (0.85 + Math.random() * 0.10);
    const targetX = canvasW * (0.30 + Math.random() * 0.40);
    const targetY = stageY + (canvasH - stageY) * (0.30 + Math.random() * 0.20);
    const flightTime = 0.95 + Math.random() * 0.45;
    this.vx = (targetX - this.x) / flightTime;
    // y_t = y_0 + vy*t + 0.5*g*t² → solve for vy given target, g
    this.gravity = 1700;
    this.vy = (targetY - this.y - 0.5 * this.gravity * flightTime * flightTime) / flightTime;
    this.angle = Math.random() * Math.PI * 2;
    this.angularVel = (Math.random() - 0.5) * 7;
    this.size = 9 + Math.random() * 4;
    this.life = 0;
    this.maxLife = flightTime + 0.6;   // slight grace after landing
  }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += this.gravity * dt;
    this.angle += this.angularVel * dt;
    this.life += dt;
  }
  isDead() { return this.life > this.maxLife || this.y > this.canvasH + 30; }
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    // Stems (drawn first, behind roses)
    ctx.strokeStyle = 'rgb(40, 50, 28)';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, this.size * 0.4);
    ctx.lineTo(0, this.size * 1.8);
    ctx.moveTo(this.size * 0.2, this.size * 0.4);
    ctx.lineTo(this.size * 0.4, this.size * 1.6);
    ctx.moveTo(-this.size * 0.2, this.size * 0.4);
    ctx.lineTo(-this.size * 0.4, this.size * 1.6);
    ctx.stroke();
    // Roses — cluster of red blobs
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.PI * 0.15;
      const cx = Math.cos(a) * this.size * 0.4;
      const cy = Math.sin(a) * this.size * 0.4 - this.size * 0.15;
      ctx.fillStyle = i % 2 === 0 ? 'rgb(170, 30, 38)' : 'rgb(200, 50, 55)';
      ctx.beginPath();
      ctx.arc(cx, cy, this.size * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
    // Center rose
    ctx.fillStyle = 'rgb(220, 60, 65)';
    ctx.beginPath();
    ctx.arc(0, -this.size * 0.15, this.size * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Drifting petal — small ellipse with random tumble. Used for petal showers
// and confetti streamers. Always falling, never stationary.
class Petal {
  constructor(canvasW, canvasH) {
    this.canvasH = canvasH;
    this.x = Math.random() * canvasW;
    this.y = -10;
    this.vx = (Math.random() - 0.5) * 40;
    this.vy = 70 + Math.random() * 60;
    this.angle = Math.random() * Math.PI * 2;
    this.angularVel = (Math.random() - 0.5) * 5;
    this.size = 3.5 + Math.random() * 3.5;
    const c = Math.random();
    if (c < 0.65)      this.color = 'rgb(180, 40, 50)';
    else if (c < 0.85) this.color = 'rgb(210, 55, 65)';
    else               this.color = 'rgb(150, 30, 40)';
    this.swayPhase = Math.random() * Math.PI * 2;
  }
  update(dt) {
    this.swayPhase += dt * 2.4;
    this.x += this.vx * dt + Math.sin(this.swayPhase) * 18 * dt;
    this.y += this.vy * dt;
    this.angle += this.angularVel * dt;
  }
  isDead() { return this.y > this.canvasH + 20; }
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, this.size, this.size * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

const constellationSky = (() => {
  let canvas, ctx;
  let raf = null;
  let active = false;
  let dpr = 1;
  let cssW = 0, cssH = 0;
  let lastFrameMs = 0;

  // The IIFE drives one of two long-break scenes depending on the active
  // quote theme: the meteor shower (Thinkers) or the standing ovation
  // (Acting). Each has its own state; start() picks one.
  let activeScene = 'meteor';   // 'meteor' | 'ovation'

  // ----- Meteor scene state -----
  let bgStars = [];
  let meteors = [];
  let sparks = [];
  let trains = [];
  let comets = [];
  let spawnAccumulator = 0;
  let lastFlashMs = -1e9;
  let lastFlashStrength = 0;
  let moonOffsetX = 0, moonOffsetY = 0;

  // ----- Ovation scene state -----
  let ovation = null;

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
        twinkleSpeed: Math.random() * 0.0014 + 0.0004,
        twinklePhase: Math.random() * Math.PI * 2,
        warm: Math.random() < 0.25,
        // Frequent random flash events — every 4-18 seconds per star.
        // Each flash always animates through its full bell curve (no
        // static pause-fade).
        flashCooldown: 4 + Math.random() * 14,
        flashTimer: 0,
      });
    }
    return out;
  }

  function start() {
    if (active) return;
    if (!canvas && !init()) return;
    active = true;
    lastFrameMs = 0;

    // Pick the scene that matches the user's current quote theme.
    activeScene = settings.get('quoteTheme') === 'acting' ? 'ovation' : 'meteor';

    if (activeScene === 'ovation') {
      initOvation();
      document.body.classList.add('is-ovation');
    } else {
      meteors = [];
      sparks = [];
      trains = [];
      comets = [];
      spawnAccumulator = 0;
      lastFlashMs = -1e9;
      // Randomize moon position slightly per session.
      moonOffsetX = (Math.random() - 0.5) * 0.10;
      moonOffsetY = (Math.random() - 0.5) * 0.04;
      document.body.classList.add('is-constellation');
    }

    canvas.classList.add('is-visible');
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    if (!active) return;
    active = false;
    document.body.classList.remove('is-constellation');
    document.body.classList.remove('is-ovation');
    if (canvas) canvas.classList.remove('is-visible');
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  function loop(timestamp) {
    if (!active) return;
    const dt = lastFrameMs ? Math.min((timestamp - lastFrameMs) / 1000, 0.05) : 0.016;
    lastFrameMs = timestamp;
    if (activeScene === 'ovation') {
      updateOvation(dt, timestamp);
      renderOvation(timestamp);
    } else {
      update(dt, timestamp);
      render(timestamp);
    }
    raf = requestAnimationFrame(loop);
  }

  function update(dt, time) {
    // Heavy continuous shower: ~4.5 meteors/sec average. With 18% close
    // approach rate that's roughly one close approach every 1.2s — multiple
    // visible at once, "flying through it" feel.
    const baseRate = 4.5;
    spawnAccumulator += dt * baseRate;
    while (spawnAccumulator >= 1) {
      spawnAccumulator -= 1;
      meteors.push(new Meteor(cssW, cssH));
    }

    // Bursts — sudden flurries every ~12s. 10-20 meteors at once, so the
    // sky regularly lights up with multiple streaks tearing across.
    if (Math.random() < dt * 0.080) {
      const burstSize = 10 + Math.floor(Math.random() * 11);
      for (let i = 0; i < burstSize; i++) {
        meteors.push(new Meteor(cssW, cssH));
      }
    }

    // Storm — rare but huge. Once every ~90s a 30-50 meteor avalanche.
    // The peak chaos moment.
    if (Math.random() < dt * 0.011) {
      const stormSize = 30 + Math.floor(Math.random() * 21);
      for (let i = 0; i < stormSize; i++) {
        meteors.push(new Meteor(cssW, cssH));
      }
    }

    // Comets — slow, large, ~once every 80s.
    if (Math.random() < dt * 0.0125) {
      comets.push(new Comet(cssW, cssH));
    }

    // Update meteors and emit sparks/trains/flashes from special ones.
    for (const m of meteors) {
      m.update(dt);

      // Close approaches shed sparks every ~40-80ms while on canvas.
      if (m.kind === 'close' && m.isOnCanvas()) {
        m._sparkAcc = (m._sparkAcc || 0) + dt;
        const interval = 0.04 + Math.random() * 0.04;
        while (m._sparkAcc >= interval) {
          m._sparkAcc -= interval;
          const n = 1 + Math.floor(Math.random() * 2);
          for (let i = 0; i < n; i++) {
            sparks.push(new Spark(m.x, m.y, m.vx, m.vy, m.colorBase));
          }
        }
      }

      // Screen flash — fired once per close approach passing through the
      // central area. Rate-limited (min 700ms apart) so back-to-back ones
      // don't oversaturate, and intensity scales with how central it is.
      if (m.kind === 'close' && !m.flashTriggered && m.isOnCanvas()) {
        const cx = cssW * 0.5, cy = cssH * 0.5;
        const dist = Math.hypot(m.x - cx, m.y - cy);
        const flashRadius = Math.min(cssW, cssH) * 0.28;
        if (dist < flashRadius && (time - lastFlashMs) > 700) {
          m.flashTriggered = true;
          const closeness = 1 - (dist / flashRadius);
          lastFlashMs = time;
          lastFlashStrength = 0.10 + closeness * 0.20;
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
    for (const c of comets) c.update(dt);

    // Hard caps as safety nets — should rarely be hit in practice. Higher
    // ceiling now to accommodate storms.
    if (meteors.length > 220) meteors = meteors.filter((m) => !m.isDead()).slice(-220);
    else                       meteors = meteors.filter((m) => !m.isDead());
    if (sparks.length > 500)   sparks = sparks.filter((s) => !s.isDead()).slice(-500);
    else                       sparks = sparks.filter((s) => !s.isDead());
    trains = trains.filter((t) => !t.isDead());
    comets = comets.filter((c) => !c.isDead());

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

    // Aurora bands — slow undulating green and violet ribbons across the
    // upper sky. Low opacity so they read as ambient atmosphere.
    drawAurora(ctx, time, cssW, cssH);

    // Subtle slow drift of the entire star field — sin/cos give an
    // elliptical sway. Stars + moon both translate together.
    const driftX = Math.sin(time * 0.000035) * 22;
    const driftY = Math.cos(time * 0.000022) * 12;

    ctx.save();
    ctx.translate(driftX, driftY);

    // Background star field. Continuous twinkle + frequent random flares.
    for (const s of bgStars) {
      const tw = Math.sin(time * s.twinkleSpeed + s.twinklePhase) * 0.35 + 0.65;
      let a = s.baseAlpha * tw;
      let r = s.r;
      if (s.flashTimer > 0 && s._flashDuration > 0) {
        const t = 1 - s.flashTimer / s._flashDuration;
        const bell = Math.sin(t * Math.PI);
        a = Math.min(1, a + bell * 0.85);
        r = s.r + bell * 1.6;
      }
      ctx.fillStyle = s.warm
        ? `rgba(255, 240, 220, ${a})`
        : `rgba(220, 232, 255, ${a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Moon — drifts with the star field.
    drawMoon(ctx, cssW, cssH);

    ctx.restore();

    // Persistent trains, then comets, then meteors+sparks. Meteors render
    // last (well, before flash) so their heads sit on top of any afterglow.
    for (const t of trains) t.draw(ctx);
    for (const c of comets) c.draw(ctx);
    for (const m of meteors) m.draw(ctx);
    for (const s of sparks)  s.draw(ctx);

    // Screen flash — brief full-canvas brightness pulse from a close
    // approach. Decays in 220ms.
    const flashAge = time - lastFlashMs;
    if (flashAge >= 0 && flashAge < 220) {
      const fa = (1 - flashAge / 220) * lastFlashStrength;
      ctx.fillStyle = `rgba(255, 250, 235, ${fa.toFixed(3)})`;
      ctx.fillRect(0, 0, cssW, cssH);
    }

    ctx.restore();
  }

  // Two soft undulating aurora bands across the upper sky — green and
  // violet. The wave shape is recomputed each frame from sin(x*freq + t).
  function drawAurora(ctx, time, w, h) {
    const band = (color, yBase, amp, freqX, freqT, phase, thickness, opacity) => {
      const segments = 80;
      ctx.beginPath();
      for (let i = 0; i <= segments; i++) {
        const x = (i / segments) * w;
        const y = yBase + Math.sin(x * freqX + time * freqT + phase) * amp;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      for (let i = segments; i >= 0; i--) {
        const x = (i / segments) * w;
        const y = yBase + Math.sin(x * freqX + time * freqT + phase) * amp + thickness;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, yBase - amp, 0, yBase + amp + thickness);
      grad.addColorStop(0,    `${color}0)`);
      grad.addColorStop(0.45, `${color}${opacity})`);
      grad.addColorStop(1,    `${color}0)`);
      ctx.fillStyle = grad;
      ctx.fill();
    };
    // Green (lower, wider, brighter)
    band('rgba(120, 240, 180,', h * 0.20, 24, 0.005,  0.00018, 0,   100, 0.10);
    // Violet (higher, slightly narrower)
    band('rgba(180, 130, 255,', h * 0.11, 18, 0.0065, 0.00012, 1.5,  70, 0.07);
  }

  // Waning crescent moon with a soft halo. Position randomized slightly
  // per session via moonOffsetX/Y so it's not always in the same spot.
  function drawMoon(ctx, w, h) {
    const cx = w * (0.78 + moonOffsetX);
    const cy = h * (0.13 + moonOffsetY);
    const r = 26;

    // Soft halo (3-stop radial gradient for a smooth falloff).
    const haloR = r * 4.2;
    const haloGrad = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, haloR);
    haloGrad.addColorStop(0,   'rgba(245, 240, 215, 0.20)');
    haloGrad.addColorStop(0.4, 'rgba(245, 240, 215, 0.07)');
    haloGrad.addColorStop(1,   'rgba(245, 240, 215, 0)');
    ctx.fillStyle = haloGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
    ctx.fill();

    // Bright moon disk — soft cream.
    ctx.fillStyle = 'rgb(232, 226, 196)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Crescent shadow disk — matches the upper sky color for clean blend.
    ctx.fillStyle = 'rgb(7, 9, 20)';
    ctx.beginPath();
    ctx.arc(cx + r * 0.55, cy - r * 0.04, r * 0.94, 0, Math.PI * 2);
    ctx.fill();
  }

  // ==========================================================================
  // Ovation scene — initialization + update + render
  // ==========================================================================

  // Geometry of the theater within the canvas — recomputed whenever needed
  // from cssW/cssH so it adapts to resize.
  function ovationGeometry() {
    return {
      // Stage occupies upper ~half of the canvas, framed by a proscenium.
      stageX: cssW * 0.07,
      stageY: cssH * 0.10,
      stageW: cssW * 0.86,
      stageH: cssH * 0.46,
      // Audience starts below a dark gap (orchestra pit equivalent).
      audienceTop: cssH * 0.68,
    };
  }

  function generateAudience() {
    const g = ovationGeometry();
    const out = [];
    // 5 rows. Front rows (lower y, larger heads) have fewer members but
    // dominate the silhouette; back rows are denser but smaller.
    const rows = [
      { y: cssH * 1.04, count: 14, scale: 1.30 },   // front (mostly off-screen)
      { y: cssH * 0.95, count: 18, scale: 1.10 },
      { y: cssH * 0.86, count: 24, scale: 0.88 },
      { y: cssH * 0.78, count: 30, scale: 0.72 },
      { y: cssH * 0.71, count: 36, scale: 0.60 },   // back (smallest)
    ];
    for (const row of rows) {
      for (let i = 0; i < row.count; i++) {
        // Slight horizontal jitter so heads don't line up perfectly.
        const x = ((i + 0.5) / row.count) * cssW + (Math.random() - 0.5) * (cssW / row.count) * 0.45;
        out.push(new AudienceMember(x, row.y, row.scale));
      }
    }
    // Avoid overdrawing front rows on top of back rows visually — back rows
    // first so they sit behind in stacking order.
    out.sort((a, b) => a.baseY - b.baseY);
    return out;
  }

  function initOvation() {
    ovation = {
      cyclePhase: 'opening',
      cyclePhaseT: 0,
      cycleNum: 0,
      curtainOpenness: 0,
      bowers: [],
      audience: generateAudience(),
      ripples: [],
      bouquets: [],
      petals: [],
      rippleSpawnAcc: 0,
      petalSpawnAcc: 0,
      bouquetsRemaining: 0,
      bouquetSpawnAcc: 0,
      // Per-cycle variation — set on each entry into 'opening'.
      bowerCount: 3,
      bowChoreo: 'sync',
      bouquetsThisCycle: 8,
      petalShower: false,
      isEncore: false,
      spotlightColor: [255, 230, 180],
      spotlightOnT: 0,
    };
    seedNewCycle();
  }

  // Pick variation parameters for the next curtain call. Sometimes "encore"
  // (no darkness pause) and sometimes a major petal shower.
  function seedNewCycle() {
    const o = ovation;
    o.bowerCount = 1 + Math.floor(Math.random() * 5);     // 1..5 actors
    o.bowers = [];
    for (let i = 0; i < o.bowerCount; i++) {
      // Spread bowers across the central 80% of the stage.
      const stagePos = o.bowerCount === 1
        ? 0.5
        : 0.10 + (i / (o.bowerCount - 1)) * 0.80;
      const gender = Math.random() > 0.55 ? 'fem' : 'masc';
      o.bowers.push(new BowActor(stagePos, gender));
    }
    // Choreography
    const choreoR = Math.random();
    if (choreoR < 0.50)      o.bowChoreo = 'sync';
    else if (choreoR < 0.85) o.bowChoreo = 'sequential';
    else                     o.bowChoreo = 'wave';
    // Bouquet count
    o.bouquetsThisCycle = 4 + Math.floor(Math.random() * 8);
    // Occasional petal shower (~20% of cycles)
    o.petalShower = Math.random() < 0.20;
    // Spotlight color — usually warm white, occasionally gold or red-tinted
    const c = Math.random();
    if (c < 0.75)      o.spotlightColor = [255, 230, 180];   // warm white
    else if (c < 0.92) o.spotlightColor = [255, 210, 130];   // gold
    else               o.spotlightColor = [255, 175, 140];   // red-tinted
  }

  function updateOvation(dt, time) {
    const o = ovation;
    if (!o) return;
    const g = ovationGeometry();
    o.cyclePhaseT += dt;

    // Cycle state machine
    switch (o.cyclePhase) {
      case 'opening': {
        const dur = 3.5;
        o.curtainOpenness = Math.min(1, o.cyclePhaseT / dur);
        o.spotlightOnT = Math.min(1, o.cyclePhaseT / 1.5);
        if (o.cyclePhaseT >= dur) {
          o.cyclePhase = 'bowing';
          o.cyclePhaseT = 0;
          // First bow: actors stand upright, ready
          for (const b of o.bowers) b.setBow(0);
        }
        break;
      }
      case 'bowing': {
        // Three rounds of bows in this phase, with variation by choreography.
        // Each round ~3s. Phase total ~9-12s.
        const roundDur = 3.0;
        const bowsRound = Math.floor(o.cyclePhaseT / roundDur);
        const within = (o.cyclePhaseT % roundDur) / roundDur;   // 0..1
        for (let i = 0; i < o.bowers.length; i++) {
          const b = o.bowers[i];
          let phaseShift = 0;
          if (o.bowChoreo === 'sequential') {
            phaseShift = i * 0.18;
          } else if (o.bowChoreo === 'wave') {
            phaseShift = Math.sin((i / Math.max(1, o.bowers.length - 1)) * Math.PI) * 0.25;
          }
          const t = Math.max(0, Math.min(1, within - phaseShift));
          // Bell curve: rise to full bow at t=0.5, return to 0 at t=1.
          const bell = Math.sin(t * Math.PI);
          b.setBow(bell);
          b.update(dt);
        }
        if (o.cyclePhaseT >= roundDur * 3 + 0.5) {
          o.cyclePhase = 'showering';
          o.cyclePhaseT = 0;
          o.bouquetsRemaining = o.bouquetsThisCycle;
          o.bouquetSpawnAcc = 0;
        }
        break;
      }
      case 'showering': {
        // Bouquets spawn over ~5s, paced.
        const spawnWindow = 4.0;
        const spawnInterval = spawnWindow / Math.max(1, o.bouquetsThisCycle);
        o.bouquetSpawnAcc += dt;
        while (o.bouquetSpawnAcc >= spawnInterval && o.bouquetsRemaining > 0) {
          o.bouquetSpawnAcc -= spawnInterval;
          o.bouquetsRemaining--;
          o.bouquets.push(new Bouquet(cssW, cssH, g.stageY));
        }
        // One last shallow bow during the bouquet shower
        for (const b of o.bowers) {
          b.setBow(0.4 + 0.15 * Math.sin(o.cyclePhaseT * 1.6));
          b.update(dt);
        }
        if (o.cyclePhaseT >= 6.0) {
          o.cyclePhase = 'closing';
          o.cyclePhaseT = 0;
        }
        break;
      }
      case 'closing': {
        const dur = 3.5;
        o.curtainOpenness = Math.max(0, 1 - o.cyclePhaseT / dur);
        o.spotlightOnT = Math.max(0, 1 - o.cyclePhaseT / 2.0);
        // Actors return upright as the curtain falls
        for (const b of o.bowers) {
          b.setBow(0);
          b.update(dt);
        }
        if (o.cyclePhaseT >= dur) {
          o.cyclePhase = 'darkness';
          o.cyclePhaseT = 0;
          // ~12% encore — skip darkness, jump straight back to opening
          o.isEncore = Math.random() < 0.12;
        }
        break;
      }
      case 'darkness': {
        const dur = o.isEncore ? 0.4 : 2.5;
        if (o.cyclePhaseT >= dur) {
          o.cycleNum++;
          o.cyclePhase = 'opening';
          o.cyclePhaseT = 0;
          seedNewCycle();
        }
        break;
      }
    }

    // Audience standing — during peak applause (bowing/showering), some
    // members stand up; otherwise gradually return to seated.
    let standChance = 0;
    if (o.cyclePhase === 'bowing' || o.cyclePhase === 'showering') {
      standChance = 0.012;
    } else if (o.cyclePhase === 'opening') {
      standChance = 0.005;
    }
    for (const m of o.audience) {
      // Roll for stand changes.
      if (Math.random() < standChance) {
        m.standTarget = m.standTarget > 0 ? 0 : (8 + Math.random() * 8) * m.scale;
      }
      // During closing/darkness, settle back to sitting.
      if (o.cyclePhase === 'closing' || o.cyclePhase === 'darkness') {
        m.standTarget *= Math.pow(0.5, dt);
      }
      m.update(dt);
    }

    // Applause ripples — rate scales with phase intensity.
    let rippleRate;
    if (o.cyclePhase === 'bowing')         rippleRate = 5.0;
    else if (o.cyclePhase === 'showering') rippleRate = 6.0;
    else if (o.cyclePhase === 'opening')   rippleRate = 2.5 * o.cyclePhaseT / 3.5;
    else if (o.cyclePhase === 'closing')   rippleRate = 1.5 * o.curtainOpenness;
    else                                   rippleRate = 0.0;
    const intensity = o.cyclePhase === 'showering' ? 1.4 : 1.0;
    o.rippleSpawnAcc += dt * rippleRate;
    while (o.rippleSpawnAcc >= 1) {
      o.rippleSpawnAcc -= 1;
      o.ripples.push(new ApplauseRipple(cssW, cssH, intensity));
    }

    // Petal shower (rare, dramatic) — spawn from above during bowing/showering
    // when this cycle was flagged.
    if (o.petalShower &&
        (o.cyclePhase === 'bowing' || o.cyclePhase === 'showering')) {
      o.petalSpawnAcc += dt * 22;   // ~22 petals/sec
      while (o.petalSpawnAcc >= 1) {
        o.petalSpawnAcc -= 1;
        o.petals.push(new Petal(cssW, cssH));
      }
    }

    // Update + cull all particle systems
    for (const r of o.ripples)  r.update(dt);
    for (const b of o.bouquets) b.update(dt);
    for (const p of o.petals)   p.update(dt);
    o.ripples  = o.ripples.filter((r) => !r.isDead());
    o.bouquets = o.bouquets.filter((b) => !b.isDead());
    o.petals   = o.petals.filter((p) => !p.isDead());
  }

  function renderOvation(time) {
    if (!ovation) return;
    const o = ovation;
    const g = ovationGeometry();

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Theater background — very dark with a faint warm undertone.
    const bgGrad = ctx.createLinearGradient(0, 0, 0, cssH);
    bgGrad.addColorStop(0,   'rgb(8, 4, 6)');
    bgGrad.addColorStop(0.6, 'rgb(12, 6, 9)');
    bgGrad.addColorStop(1,   'rgb(18, 8, 11)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, cssW, cssH);

    // 2. Stage interior backdrop — slightly lighter than the surrounding theater.
    const stageGrad = ctx.createLinearGradient(0, g.stageY, 0, g.stageY + g.stageH);
    stageGrad.addColorStop(0, 'rgb(14, 9, 12)');
    stageGrad.addColorStop(1, 'rgb(20, 13, 12)');
    ctx.fillStyle = stageGrad;
    ctx.fillRect(g.stageX, g.stageY, g.stageW, g.stageH);

    // 3. Spotlight beam from above — wide cone, low alpha.
    if (o.spotlightOnT > 0.02) {
      drawSpotlightBeam(ctx, g, o.spotlightColor, o.spotlightOnT);
    }

    // 4. Spotlight pool on stage floor.
    if (o.spotlightOnT > 0.02) {
      const px = g.stageX + g.stageW * 0.5;
      const py = g.stageY + g.stageH * 0.78;
      const radius = g.stageW * 0.42;
      const grad = ctx.createRadialGradient(px, py, 0, px, py, radius);
      const [r, gn, bl] = o.spotlightColor;
      grad.addColorStop(0,   `rgba(${r}, ${gn}, ${bl}, ${(0.40 * o.spotlightOnT).toFixed(3)})`);
      grad.addColorStop(0.5, `rgba(${r}, ${gn}, ${bl}, ${(0.14 * o.spotlightOnT).toFixed(3)})`);
      grad.addColorStop(1,   `rgba(${r}, ${gn}, ${bl}, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(g.stageX - 20, g.stageY - 20, g.stageW + 40, g.stageH + 40);
    }

    // 5. Bow actors on stage — drawn before the curtain so the curtain
    //    can actually conceal them on close.
    for (const b of o.bowers) {
      b.draw(ctx, g.stageX, g.stageY, g.stageW, g.stageH);
    }

    // 6. Velvet curtain — covers stage when openness=0, pulled to sides
    //    when openness=1.
    drawCurtain(ctx, o.curtainOpenness, g);

    // 7. Proscenium frame — subtle dark vertical bars at the stage edges
    //    plus a top valance, draws on top of the curtain so it acts like
    //    the architectural frame in front.
    drawProscenium(ctx, g);

    // 8. Bouquets in flight — drawn over stage but under audience so they
    //    can fly through the air realistically.
    for (const b of o.bouquets) b.draw(ctx);

    // 9. Audience silhouettes — heads-from-below.
    for (const a of o.audience) a.draw(ctx);

    // 10. Applause ripples — soft golden arcs rising from the audience.
    for (const r of o.ripples) r.draw(ctx);

    // 11. Petals — drift in front of everything.
    for (const p of o.petals) p.draw(ctx);

    ctx.restore();
  }

  // Cone of soft warm light from a hidden source above the proscenium down
  // to a pool on the stage. Composed of a narrow inner cone and a wider
  // diffuse outer cone for a softer falloff.
  function drawSpotlightBeam(ctx, g, color, intensity) {
    const sourceX = g.stageX + g.stageW * 0.5;
    const sourceY = g.stageY - g.stageH * 0.10;     // just above proscenium
    const targetX = g.stageX + g.stageW * 0.5;
    const targetY = g.stageY + g.stageH * 0.78;
    const [r, gn, bl] = color;

    const cone = (halfWidthRatio, alpha) => {
      const dy = targetY - sourceY;
      const halfWidth = dy * halfWidthRatio;
      ctx.beginPath();
      ctx.moveTo(sourceX, sourceY);
      ctx.lineTo(targetX + halfWidth, targetY);
      ctx.lineTo(targetX - halfWidth, targetY);
      ctx.closePath();
      const grad = ctx.createLinearGradient(sourceX, sourceY, targetX, targetY);
      grad.addColorStop(0, `rgba(${r}, ${gn}, ${bl}, ${(alpha * intensity).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${r}, ${gn}, ${bl}, 0)`);
      ctx.fillStyle = grad;
      ctx.fill();
    };
    cone(0.55, 0.05);   // outer diffuse
    cone(0.30, 0.10);   // inner core
  }

  // Two velvet curtain halves that meet in the middle when openness=0 and
  // get squeezed to the sides as openness→1. Each half is drawn as vertical
  // bands with sinusoidal lightness for a folded-velvet look.
  function drawCurtain(ctx, openness, g) {
    const center = g.stageX + g.stageW * 0.5;
    const stageL = g.stageX;
    const stageR = g.stageX + g.stageW;

    // Min half-width when fully open (curtain is "tied back" but still visible
    // as a sliver at the sides), max half-width when closed.
    const minHalfW = g.stageW * 0.07;
    const maxHalfW = g.stageW * 0.50;
    const halfW = minHalfW + (maxHalfW - minHalfW) * (1 - openness);

    const numFolds = 16;

    const drawHalf = (anchorX, dir) => {
      // dir = +1 for left half (extends right toward center)
      // dir = -1 for right half (extends left toward center)
      for (let i = 0; i < numFolds; i++) {
        const t = i / (numFolds - 1);            // 0..1 within the half
        const bandX = anchorX + dir * halfW * t;
        const bandW = (halfW / numFolds) * 1.15;  // tiny overlap to hide seams
        // Folded velvet — alternating light and dark vertical strips with a
        // subtle gradient toward the bunched edge for added depth.
        const fold = Math.sin(t * Math.PI * 11) * 0.5 + 0.5;          // 0..1
        const edgeBoost = (1 - Math.abs(t - 0.5) * 1.6) * 0.3 + 0.7;  // mid is brightest
        const lightness = (0.35 + fold * 0.55) * edgeBoost;
        const r = Math.round(40 + lightness * 95);
        const gn = Math.round(6  + lightness * 22);
        const bl = Math.round(10 + lightness * 18);
        ctx.fillStyle = `rgb(${r}, ${gn}, ${bl})`;
        const x = dir === 1 ? bandX : bandX - bandW;
        ctx.fillRect(x, g.stageY, bandW + 1, g.stageH);
      }
      // Bottom hem highlight — slightly lighter band at the very bottom edge.
      const grad = ctx.createLinearGradient(0, g.stageY + g.stageH - 8, 0, g.stageY + g.stageH);
      grad.addColorStop(0, 'rgba(140, 30, 35, 0)');
      grad.addColorStop(1, 'rgba(140, 30, 35, 0.6)');
      ctx.fillStyle = grad;
      const xStart = dir === 1 ? anchorX : anchorX - halfW;
      ctx.fillRect(xStart, g.stageY + g.stageH - 8, halfW, 8);
    };

    drawHalf(stageL, +1);
    drawHalf(stageR, -1);
  }

  // The architectural frame around the stage — vertical pillars at the sides,
  // a top valance, and a thin sill at the bottom. Pure black/very dark to
  // sit cleanly on top of the curtain regardless of openness.
  function drawProscenium(ctx, g) {
    ctx.fillStyle = 'rgb(4, 2, 4)';
    // Side pillars
    ctx.fillRect(0, g.stageY - 4, g.stageX, g.stageH + 8);
    ctx.fillRect(g.stageX + g.stageW, g.stageY - 4, cssW - (g.stageX + g.stageW), g.stageH + 8);
    // Top valance — a dark beam across the top, slightly thicker
    const valanceH = g.stageY * 0.55;
    const valGrad = ctx.createLinearGradient(0, 0, 0, g.stageY);
    valGrad.addColorStop(0,   'rgb(2, 1, 2)');
    valGrad.addColorStop(0.7, 'rgb(8, 4, 6)');
    valGrad.addColorStop(1,   'rgb(18, 6, 10)');
    ctx.fillStyle = valGrad;
    ctx.fillRect(g.stageX - 8, 0, g.stageW + 16, valanceH);
    // Subtle gold piping along the inside edge of the proscenium top
    ctx.fillStyle = 'rgba(180, 140, 60, 0.18)';
    ctx.fillRect(g.stageX, valanceH - 1, g.stageW, 2);
    // Bottom sill — thin dark band at stage floor level
    ctx.fillStyle = 'rgb(3, 2, 2)';
    ctx.fillRect(g.stageX - 8, g.stageY + g.stageH, g.stageW + 16, 4);
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
  constructor(allItems, getMood, storageKey) {
    this.allItems = allItems;
    this.getMood = getMood;          // function returning 'work' | 'rest' | 'any'
    // Each quote theme has its own persisted deck key so switching themes
    // resumes each one where it left off rather than blowing them away.
    this.storageKey = storageKey || STORAGE.deck;
    this.queue = [];
    this.lastDealt = null;
    this.lastMood = null;
    this._restore();                 // resume mid-deck across reloads
  }

  // Persist queue as photoSlugs so the file is small and survives quote edits
  // (unknown slugs are silently dropped on restore).
  _save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({
        queue:     this.queue.map((q) => q.photoSlug),
        lastDealt: this.lastDealt?.photoSlug ?? null,
        lastMood:  this.lastMood,
      }));
    } catch {}
  }

  _restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.storageKey));
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
          <div class="settings__section-title">Content</div>
          <div class="settings__row">
            <span class="settings__label">Theme</span>
            <span class="settings__value" data-key="quoteTheme"
              data-options="thinkers:Thinkers|acting:Acting"></span>
          </div>
        </div>

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
            <span class="settings__label">Palette</span>
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
          if (key === 'themeMode')  applyTheme();
          if (key === 'showClock')  clock.render();
          if (key === 'quoteTheme') onQuoteThemeChanged();
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

// Module-level slideshow state so the settings panel can rebuild the deck
// when the user switches themes without tearing down the whole boot flow.
let allQuotes = [];
let deck = null;
const slideCtx = { current: null };
let _slideTimer = null;

function buildDeckForCurrentTheme() {
  const theme = settings.get('quoteTheme');
  const themeQuotes = allQuotes.filter((q) => q.theme === theme);
  if (themeQuotes.length === 0) {
    console.warn(`No quotes found for theme: ${theme}`);
    return false;
  }
  // Per-theme storage key so switching themes resumes each deck where it
  // left off rather than overwriting one with the other.
  const storageKey = `${STORAGE.deck}:${theme}`;
  deck = new Deck(themeQuotes, () => pomodoro.currentMood, storageKey);
  return true;
}

function scheduleNext() {
  if (_slideTimer) clearTimeout(_slideTimer);
  _slideTimer = setTimeout(() => {
    _slideTimer = null;
    const phase = pomodoro.phase;
    const pausedForWork = settings.get('pauseDuringWork') && phase === POM.WORK;
    const pausedForLong = phase === POM.LONG;     // constellation ceremony
    if (!pausedForWork && !pausedForLong) {
      showNext(deck, slideCtx);
    }
    scheduleNext();
  }, settings.get('slideDurationMs'));
}

// Called by the settings panel after the user picks a different theme.
// Rebuilds the deck against the new theme and immediately advances to a
// fresh slide so the change is visible right away.
function onQuoteThemeChanged() {
  if (!buildDeckForCurrentTheme()) return;
  showNext(deck, slideCtx);
  scheduleNext();
}

(async function boot() {
  try {
    const res = await fetch(QUOTES_URL, { cache: 'no-cache' });
    allQuotes = await res.json();
  } catch (err) {
    console.error('Failed to load quotes.json', err);
    return;
  }
  if (!Array.isArray(allQuotes) || allQuotes.length === 0) return;

  if (!buildDeckForCurrentTheme()) return;

  // Preload the next photo from the active theme so the first transition
  // is instant rather than waiting on the first network round-trip.
  const themeQuotes = allQuotes.filter((q) => q.theme === settings.get('quoteTheme'));
  await loadImage(`assets/photos/${themeQuotes[0].photoSlug}.jpg`);
  showNext(deck, slideCtx);
  scheduleNext();

  // Tap anywhere on the stage (except the corner controls or settings overlay)
  // to jump to the next slide immediately and reset the auto-advance timer.
  // Skipped during LONG since the constellation canvas covers the stage.
  stage.addEventListener('click', (e) => {
    if (e.target.closest('#ctrl-pomodoro, #ctrl-settings, .settings')) return;
    if (pomodoro.phase === POM.LONG) return;
    showNext(deck, slideCtx);
    scheduleNext();
  });
})();
