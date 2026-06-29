/**
 * ═══════════════════════════════════════════════════════════════
 *  SNAKE RUSH — game.js  (Phase 4: Mega Update)
 *  Vanilla JS + HTML5 Canvas. No dependencies.
 *
 *  NEW FEATURES:
 *   ✓ Screen shake (death/kill/wall)
 *   ✓ Hit-stop on kills
 *   ✓ Kill feed (top-right canvas overlay)
 *   ✓ Combo multiplier with floating text
 *   ✓ Snake trails (ring buffer glow)
 *   ✓ Shield power-up (invincibility + aura)
 *   ✓ Ghost power-up (semi-transparent, pass bodies)
 *   ✓ Mine power-up (explosive traps)
 *   ✓ Speed Boost power-up
 *   ✓ Game modes: Classic / Arena / Time Trial
 *   ✓ AI Personality types (aggressive/coward/hunter/farmer)
 *   ✓ Flock behavior for aggressive AI
 *   ✓ Virtual joystick (touch)
 *   ✓ Gyroscope steering (optional)
 *   ✓ Achievement system (8 achievements)
 *   ✓ Persistent profile stats
 *   ✓ Daily challenge (seeded RNG)
 *   ✓ Player naming
 *   ✓ Animated electric fence border
 *   ✓ Biome zones (3x3 grid tints)
 *   ✓ Death cinematic (fade + glitch)
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

/* ─────────────────────────────────────────────────────────────
   SETTINGS STORE
───────────────────────────────────────────────────────────── */
const Settings = {
  muted:       false,
  sensitivity: 8,
  design:      'multicolour',
  mode:        'classic',   // 'classic' | 'arena' | 'timetrial'
  gyro:        false,
};

/* ─────────────────────────────────────────────────────────────
   PERSISTENCE KEYS
───────────────────────────────────────────────────────────── */
const HS_KEY           = 'snakeRush_bestScore';
const TT_KEY           = 'snakeRush_timeTrial_best';
const PROFILE_KEY      = 'snakeRush_profile';
const ACHIEVEMENTS_KEY = 'snakeRush_achievements';
const PLAYER_NAME_KEY  = 'snakeRush_playerName';
const DAILY_DATE_KEY   = 'snakeRush_dailyDate';
const DAILY_SCORE_KEY  = 'snakeRush_dailyScore';

/* ─────────────────────────────────────────────────────────────
   HIGH SCORE
───────────────────────────────────────────────────────────── */
const HighScore = {
  _cached: null,
  get() {
    if (this._cached === null)
      this._cached = parseInt(localStorage.getItem(HS_KEY) || '0', 10);
    return this._cached;
  },
  save(n) {
    const c = this.get();
    if (n > c) { localStorage.setItem(HS_KEY, String(n)); this._cached = n; }
    return this._cached;
  },
};

/* ─────────────────────────────────────────────────────────────
   PROFILE — persistent stats
───────────────────────────────────────────────────────────── */
const Profile = {
  _data: null,
  _defaults() {
    return {
      totalKills: 0, totalFoodEaten: 0, totalDeaths: 0,
      totalPlaytimeSeconds: 0, totalRuns: 0,
      bestScore: 0, bestScoreTimeTrial: 0,
    };
  },
  get() {
    if (!this._data) {
      try { this._data = JSON.parse(localStorage.getItem(PROFILE_KEY)) || this._defaults(); }
      catch(_) { this._data = this._defaults(); }
      // fill missing keys
      const d = this._defaults();
      for (const k of Object.keys(d)) {
        if (!(k in this._data)) this._data[k] = d[k];
      }
    }
    return this._data;
  },
  save() {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(this._data)); } catch(_) {}
  },
  add(key, val = 1) { this.get()[key] += val; this.save(); },
  set(key, val) { this.get()[key] = val; this.save(); },
};

/* ─────────────────────────────────────────────────────────────
   SEEDED RNG (mulberry32)
───────────────────────────────────────────────────────────── */
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/* ─────────────────────────────────────────────────────────────
   DAILY CHALLENGE
───────────────────────────────────────────────────────────── */
const DailyChallenge = {
  isActive: false,
  aiCount: 10,
  foodCount: 320,
  worldMod: 1.0,
  enabledPowerups: ['magnet','attack','lifeline','shield','ghost','mine','speed'],

  check() {
    const today = new Date().toDateString();
    const stored = localStorage.getItem(DAILY_DATE_KEY);
    if (stored !== today) {
      localStorage.setItem(DAILY_DATE_KEY, today);
      localStorage.removeItem(DAILY_SCORE_KEY);
    }
    // generate today's seed-based parameters
    const rng = mulberry32(hashStr(today));
    this.aiCount    = 8 + Math.floor(rng() * 5);     // 8-12
    this.foodCount  = 280 + Math.floor(rng() * 101); // 280-380
    this.worldMod   = 0.85 + rng() * 0.30;           // 0.85-1.15
    const allPU = ['magnet','attack','lifeline','shield','ghost','mine','speed'];
    this.enabledPowerups = allPU.filter(() => rng() > 0.3);
    if (this.enabledPowerups.length === 0) this.enabledPowerups = allPU;
  },

  saveBest(score) {
    const prev = parseInt(localStorage.getItem(DAILY_SCORE_KEY) || '0', 10);
    if (score > prev) localStorage.setItem(DAILY_SCORE_KEY, String(score));
  },
};
DailyChallenge.check();

/* ─────────────────────────────────────────────────────────────
   SNAKE NAMES
───────────────────────────────────────────────────────────── */
const NAME_ADJECTIVES = [
  'Crimson','Shadow','Neon','Silent','Blazing','Iron','Toxic','Arctic',
  'Phantom','Void','Storm','Venom','Cosmic','Frozen','Electric','Savage',
  'Ancient','Golden','Jade','Obsidian',
];
const NAME_NOUNS = [
  'Viper','Fang','Scale','Coil','Striker','Hydra','Serpent','Cobra',
  'Mamba','Python','Rattler','Asp','Boa','Anaconda','Adder','Racer',
  'King','Sidewinder','Taipan','Bushmaster',
];

function generateName(rng = Math.random.bind(Math)) {
  const adj  = NAME_ADJECTIVES[Math.floor(rng() * NAME_ADJECTIVES.length)];
  const noun = NAME_NOUNS[Math.floor(rng() * NAME_NOUNS.length)];
  return `${adj} ${noun}`;
}

function getPlayerName() {
  let name = localStorage.getItem(PLAYER_NAME_KEY);
  if (!name) {
    name = generateName();
    localStorage.setItem(PLAYER_NAME_KEY, name);
  }
  return name;
}

function setPlayerName(name) {
  localStorage.setItem(PLAYER_NAME_KEY, name.trim() || generateName());
}

/* ─────────────────────────────────────────────────────────────
   KILL FEED
───────────────────────────────────────────────────────────── */
class KillFeed {
  constructor() {
    this._entries = [];
    this._maxEntries = 4;
    this._fadeDuration = 4;
  }

  add(msg) {
    this._entries.unshift({ msg, age: 0 });
    if (this._entries.length > this._maxEntries)
      this._entries.length = this._maxEntries;
  }

  addKill(victimName)      { this.add(`🗡️ You killed ${victimName}`); }
  addEliminated(victimName){ this.add(`💀 ${victimName} eliminated`); }

  update(dt) {
    for (const e of this._entries) e.age += dt;
    this._entries = this._entries.filter(e => e.age < this._fadeDuration);
  }

  draw(ctx, canvasW) {
    // Offset below minimap: on narrow screens the minimap starts lower
    const isNarrow = canvasW < 480;
    const x = canvasW - 16;
    // On narrow screens the minimap is pushed down ~66px from top, so push
    // kill-feed entries below it (110px map + 8px pad + 66px offset ≈ 190)
    let y = isNarrow ? 190 : 74;
    ctx.save();
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'top';
    ctx.font         = `bold ${isNarrow ? 10 : 12}px "Segoe UI", system-ui, sans-serif`;

    for (const e of this._entries) {
      const alpha = Math.max(0, 1 - (e.age / this._fadeDuration) * 1.2);
      ctx.globalAlpha  = alpha;
      ctx.shadowColor  = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur   = 6;
      ctx.fillStyle    = e.msg.startsWith('🗡️') ? '#7effb2' : '#ff8888';
      ctx.fillText(e.msg, x, y);
      y += isNarrow ? 16 : 20;
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;
    ctx.restore();
  }
}

/* ─────────────────────────────────────────────────────────────
   COMBO MULTIPLIER
───────────────────────────────────────────────────────────── */
class ComboManager {
  constructor() {
    this.count     = 0;
    this._timer    = 0;
    this._window   = 3;   // seconds
    this._floats   = [];  // floating text entries
  }

  eat(onCombo) {
    this.count++;
    this._timer = this._window;
    if (this.count >= 3) onCombo(this.count);
  }

  reset() { this.count = 0; this._timer = 0; }

  get multiplier() {
    if (this.count >= 10) return 4;
    if (this.count >= 5)  return 3;
    if (this.count >= 3)  return 2;
    return 1;
  }

  addFloat(x, y, count) {
    let msg = `x${count} COMBO`;
    if (count >= 10) msg = `x${count} MEGA COMBO!!`;
    else if (count >= 5) msg = `x${count} COMBO!`;
    this._floats.push({ x, y, age: 0, life: 1.8, msg });
  }

  update(dt) {
    if (this._timer > 0) {
      this._timer -= dt;
      if (this._timer <= 0) this.reset();
    }
    for (const f of this._floats) f.age += dt;
    this._floats = this._floats.filter(f => f.age < f.life);
  }

  draw(ctx, camX, camY) {
    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this._floats) {
      const t     = f.age / f.life;
      const alpha = 1 - t;
      const sy    = f.y - camY - t * 60;
      const sx    = f.x - camX;
      const size  = 16 + (1 - t) * 8;

      ctx.globalAlpha = alpha;
      ctx.font        = `bold ${Math.round(size)}px "Segoe UI", system-ui, sans-serif`;
      ctx.shadowColor = '#ffd04b';
      ctx.shadowBlur  = 12;
      ctx.fillStyle   = '#ffd04b';
      ctx.fillText(f.msg, sx, sy);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;
    ctx.restore();
  }
}

/* ─────────────────────────────────────────────────────────────
   SCREEN SHAKE
───────────────────────────────────────────────────────────── */
class ScreenShake {
  constructor() {
    this._intensity = 0;
    this._duration  = 0;
    this._timer     = 0;
  }

  trigger(intensity, duration = 0.3) {
    if (intensity > this._intensity) {
      this._intensity = intensity;
      this._duration  = duration;
      this._timer     = duration;
    }
  }

  update(dt) {
    if (this._timer > 0) this._timer = Math.max(0, this._timer - dt);
  }

  getOffset() {
    if (this._timer <= 0) return { x: 0, y: 0 };
    const t = this._timer / this._duration;
    const mag = this._intensity * t;
    return {
      x: (Math.random() - 0.5) * mag * 2,
      y: (Math.random() - 0.5) * mag * 2,
    };
  }
}

/* ─────────────────────────────────────────────────────────────
   ACHIEVEMENT MANAGER
───────────────────────────────────────────────────────────── */
const ACHIEVEMENTS_DEF = [
  { id: 'first_blood',   name: 'First Blood',    desc: 'Get your first kill.' },
  { id: 'big_boi',       name: 'Big Boi',         desc: 'Reach length 80.' },
  { id: 'untouchable',   name: 'Untouchable',     desc: 'Survive 3 minutes without dying.' },
  { id: 'combo_king',    name: 'Combo King',      desc: 'Hit x10 combo.' },
  { id: 'exterminator',  name: 'Exterminator',    desc: 'Kill 5 snakes in one run.' },
  { id: 'speed_demon',   name: 'Speed Demon',     desc: 'Collect Speed Boost 3x in one run.' },
  { id: 'hoarder',       name: 'Hoarder',         desc: 'Eat 200 food in one run.' },
  { id: 'last_stand',    name: 'Last Stand',      desc: 'Win Arena mode.' },
];

class AchievementManager {
  constructor() {
    this._unlocked = new Set();
    this._toasts   = [];
    this._load();

    // Per-run counters
    this.runKills       = 0;
    this.runFood        = 0;
    this.runSpeedBoosts = 0;
    this.surviveTimer   = 0;
    this.died           = false;
  }

  _load() {
    try {
      const data = JSON.parse(localStorage.getItem(ACHIEVEMENTS_KEY) || '[]');
      this._unlocked = new Set(data);
    } catch(_) { this._unlocked = new Set(); }
  }

  _save() {
    try {
      localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify([...this._unlocked]));
    } catch(_) {}
  }

  get unlockedCount() { return this._unlocked.size; }

  unlock(id) {
    if (this._unlocked.has(id)) return;
    const def = ACHIEVEMENTS_DEF.find(a => a.id === id);
    if (!def) return;
    this._unlocked.add(id);
    this._save();
    this._toasts.push({ name: def.name, age: 0, life: 3.5 });
    // Update overlay count
    const el = document.getElementById('achievement-count');
    if (el) el.textContent = `${this._unlocked.size} / ${ACHIEVEMENTS_DEF.length}`;
  }

  resetRun() {
    this.runKills = 0; this.runFood = 0;
    this.runSpeedBoosts = 0; this.surviveTimer = 0; this.died = false;
  }

  onKill()       { this.runKills++; if (this.runKills === 1) this.unlock('first_blood'); if (this.runKills >= 5) this.unlock('exterminator'); }
  onLength(l)    { if (l >= 80) this.unlock('big_boi'); }
  onFood()       { this.runFood++; if (this.runFood >= 200) this.unlock('hoarder'); }
  onCombo10()    { this.unlock('combo_king'); }
  onSpeedBoost() { this.runSpeedBoosts++; if (this.runSpeedBoosts >= 3) this.unlock('speed_demon'); }
  onDeath()      { this.died = true; this.surviveTimer = 0; }
  onArenaWin()   { this.unlock('last_stand'); }

  update(dt) {
    if (!this.died) {
      this.surviveTimer += dt;
      if (this.surviveTimer >= 180) this.unlock('untouchable');
    }
    for (const t of this._toasts) t.age += dt;
    this._toasts = this._toasts.filter(t => t.age < t.life);
  }

  draw(ctx, logW, logH) {
    if (this._toasts.length === 0) return;
    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    // Scale toast width to available screen real estate
    const toastW = Math.min(320, logW - 32);
    let iy = logH - 60 - (this._toasts.length - 1) * 46;
    for (const t of this._toasts) {
      const alpha = t.age > t.life - 0.5 ? (t.life - t.age) / 0.5 : 1;
      ctx.globalAlpha = alpha;

      const w = toastW, h = 38, x = (logW - w) / 2, y = iy - h / 2;
      ctx.fillStyle   = 'rgba(5,12,20,0.92)';
      ctx.shadowColor = '#ffd04b';
      ctx.shadowBlur  = 16;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,208,75,0.5)';
      ctx.lineWidth   = 1.5;
      ctx.stroke();
      ctx.shadowBlur  = 0;

      ctx.fillStyle = '#ffd04b';
      // Scale font so long names don't overflow on narrow screens
      const fontSize = logW < 400 ? 11 : 13;
      ctx.font      = `bold ${fontSize}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillText(`🏆 Achievement Unlocked: ${t.name}`, logW / 2, iy);
      iy += 46;
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

/* ─────────────────────────────────────────────────────────────
   MINE
───────────────────────────────────────────────────────────── */
class Mine {
  constructor(x, y) {
    this.pos    = new Vector2(x, y);
    this.age    = 0;
    this.life   = 10;   // 10 second TTL
    this.radius = 14;
    this.active = true;
  }

  get expired() { return !this.active || this.age >= this.life; }

  update(dt) { this.age += dt; }

  draw(ctx, camX, camY) {
    if (this.expired) return;
    const sx = this.pos.x - camX;
    const sy = this.pos.y - camY;
    const dpr  = window._game ? window._game._dpr : 1;
    const logW = ctx.canvas.width  / dpr;
    const logH = ctx.canvas.height / dpr;
    if (sx < -40 || sx > logW + 40 || sy < -40 || sy > logH + 40) return;

    const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.007);
    const r = this.radius + pulse * 3;
    const ttlFrac = 1 - this.age / this.life;

    ctx.save();
    ctx.globalAlpha = 0.5 + ttlFrac * 0.5;
    ctx.shadowColor = '#ff9f40';
    ctx.shadowBlur  = 16 + pulse * 10;

    // Outer glow ring
    ctx.beginPath();
    ctx.arc(sx, sy, r + 6, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,159,64,${(0.25 + pulse * 0.3).toFixed(2)})`;
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Body
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#cc5500';
    ctx.fill();

    // Bomb symbol
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = '#fff';
    ctx.font        = `bold ${Math.round(r * 1.1)}px sans-serif`;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💣', sx, sy + 1);

    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

/* ─────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────── */
const WORLD_W       = 3000;
const WORLD_H       = 3000;
const FOOD_COUNT    = 320;
const AI_COUNT      = 10;
const SEGMENT_GAP   = 8;
const SEGMENT_R_BASE = 9;
const BASE_SPEED    = 130;
const BOOST_SPEED   = 220;
const BOOST_DRAIN   = 0.6;
const SELF_SKIP     = 8;

const SPEED_SMALL_MUL  = 1.13;
const SPEED_LARGE_MUL  = 0.87;
const SPEED_SCALE_MIN  = 10;
const SPEED_SCALE_MAX  = 80;

const H2H_UPSET_THRESHOLD = 15;

/* Power-ups & lives */
const PLAYER_LIVES       = 3;
const IFRAME_DURATION    = 2.5;
const MAGNET_DURATION    = 7;
const MAGNET_RADIUS      = 280;
const MAGNET_PULL_FORCE  = 220;
const ATTACK_DURATION    = 8;
const SHIELD_DURATION    = 4;
const GHOST_DURATION     = 4;
const MINE_DURATION      = 8;    // mine powerup active time
const SPEED_BOOST_DURATION = 5;
const SPEED_BOOST_MUL    = 1.4;
const MINE_DEPLOY_INTERVAL = 2;  // seconds between mine drops
const MINE_MAX           = 3;
const MINE_TRIGGER_R     = 60;
const MINE_KILL_R        = 80;

const POWERUP_SPAWN_RATE     = 0.004;
const LIFELINE_SPAWN_RATE    = 0.002;
const SHIELD_SPAWN_RATE      = 0.003;
const GHOST_SPAWN_RATE       = 0.003;
const MINE_SPAWN_RATE        = 0.003;
const SPEED_SPAWN_RATE       = 0.003;
const LIFELINE_MAX_ON_MAP    = 1;
const SHIELD_MAX_ON_MAP      = 1;
const GHOST_MAX_ON_MAP       = 1;
const MINE_MAX_ON_MAP        = 1;
const SPEED_MAX_ON_MAP       = 1;

const NEAR_SNAKE_RADIUS  = 100;
const DANGER_ZONE_DIST   = 250;

/* Designer palette */
const DESIGNER_PALETTES = [
  ['#a855f7', '#d8b4fe'],
  ['#f97316', '#fdba74'],
  ['#06b6d4', '#67e8f9'],
  ['#ec4899', '#f9a8d4'],
  ['#84cc16', '#bef264'],
];

const MULTICOLOUR_PALETTE = [
  '#ff5e57','#ffa41b','#ffdd00','#7bff6a',
  '#00d2ff','#8c52ff','#ff52c0','#52ffca',
];

/* Biome definitions (3x3 grid) */
const BIOMES = [
  { name: 'Void',      color: 'rgba(0,0,0,0.04)' },
  { name: 'Neon City', color: 'rgba(0,255,255,0.025)' },
  { name: 'Deep Ocean',color: 'rgba(0,40,200,0.035)' },
  { name: 'Lava',      color: 'rgba(220,40,0,0.03)' },
  { name: 'Forest',    color: 'rgba(0,180,0,0.03)' },
  { name: 'Ice',       color: 'rgba(160,220,255,0.03)' },
  { name: 'Desert',    color: 'rgba(210,140,0,0.03)' },
  { name: 'Storm',     color: 'rgba(100,0,200,0.03)' },
  { name: 'Plasma',    color: 'rgba(220,0,180,0.03)' },
];

/* ─────────────────────────────────────────────────────────────
   1. VECTOR2
───────────────────────────────────────────────────────────── */
class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  add(v)     { return new Vector2(this.x + v.x, this.y + v.y); }
  sub(v)     { return new Vector2(this.x - v.x, this.y - v.y); }
  scale(s)   { return new Vector2(this.x * s, this.y * s); }
  dot(v)     { return this.x * v.x + this.y * v.y; }
  lengthSq() { return this.x * this.x + this.y * this.y; }
  length()   { return Math.sqrt(this.lengthSq()); }
  normalize() {
    const l = this.length();
    return l > 0.0001 ? this.scale(1 / l) : new Vector2(0, 0);
  }
  clamp(maxLen) {
    const l = this.length();
    return l > maxLen ? this.scale(maxLen / l) : new Vector2(this.x, this.y);
  }
  lerp(v, t) {
    return new Vector2(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t);
  }
  angle() { return Math.atan2(this.y, this.x); }
  static fromAngle(a, mag = 1) { return new Vector2(Math.cos(a) * mag, Math.sin(a) * mag); }
  static distSq(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
  }
  static dist(a, b) { return Math.sqrt(Vector2.distSq(a, b)); }
}

/* ─────────────────────────────────────────────────────────────
   1b. AUDIO MANAGER
───────────────────────────────────────────────────────────── */
class AudioManager {
  constructor() {
    this._ctx = null;
    this._buffers = {};
    this._bgNode = null;
    this._panicNode = null;
    this._runNode = null;
    this._ready = false;
    this._bgPlaying = false;
    this._panicOn = false;
    this._runOn = false;
    this._nearCooldown = 0;
    this._biteCooldown = 0;
    this._tracks = {
  bg:        'assets/bgmusic.mp3',
  eat:       'assets/eat.mp3',
  panic:     'assets/panic.mp3',
  gameover:  'assets/gameover.mp3',
  magnet:    'assets/magnet.mp3',
  run:       'assets/run.mp3',
  enemybite: 'assets/enemybite.mp3',
  nearsnake: 'assets/nearsnake.mp3',
  kill:      'assets/kill.mp3',
  lifeline:  'assets/lifeline.mp3',
};
    const unlock = () => {
      this._init();
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
  }

  async _init() {
    if (this._ctx) return;
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      await Promise.all(Object.entries(this._tracks).map(([n, u]) => this._load(n, u)));
      this._ready = true;
      this.playBg();
    } catch(e) { console.warn('[AudioManager] init failed:', e); }
  }

  async _load(name, url) {
    try {
      const resp = await fetch(url);
      const arr  = await resp.arrayBuffer();
      this._buffers[name] = await this._ctx.decodeAudioData(arr);
    } catch(e) { console.warn(`[AudioManager] failed to load ${name}:`, e); }
  }

  get _canPlay() { return this._ready && !Settings.muted; }

  _play(name, loop = false, volume = 1) {
    if (!this._canPlay || !this._buffers[name]) return null;
    const src  = this._ctx.createBufferSource();
    const gain = this._ctx.createGain();
    src.buffer      = this._buffers[name];
    src.loop        = loop;
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(this._ctx.destination);
    src.start(0);
    return src;
  }

  playBg() {
    if (!this._canPlay || this._bgPlaying) return;
    this._bgNode    = this._play('bg', true, 0.35);
    this._bgPlaying = !!this._bgNode;
  }
  stopBg() {
    if (this._bgNode) { try { this._bgNode.stop(); } catch(_) {} }
    this._bgNode = null; this._bgPlaying = false;
  }
  playEat()  { this._play('eat', false, 0.7); }
  playMagnet() {
    const n = this._play('magnet', false, 0.8);
    if (n) { try { n.stop(this._ctx.currentTime + 4); } catch(_) {} }
  }
  playKill() { this._play('kill', false, 0.9); }
  playLifeline() {
    const n = this._play('lifeline', false, 0.85);
    if (n) { try { n.stop(this._ctx.currentTime + 4); } catch(_) {} }
  }
  playEnemyBite() {
    if (this._biteCooldown > 0) return;
    this._play('enemybite', false, 0.9);
    this._biteCooldown = 0.8;
  }
  playNearSnake() {
    if (this._nearCooldown > 0) return;
    this._play('nearsnake', false, 0.6);
    this._nearCooldown = 1.5;
  }
  playGameOver() {
    this.stopBg(); this.stopPanic(); this.stopRun();
    this._play('gameover', false, 0.9);
  }
  startPanic() {
    if (this._panicOn) return;
    this._panicNode = this._play('panic', true, 0.55);
    this._panicOn = !!this._panicNode;
  }
  stopPanic() {
    if (this._panicNode) { try { this._panicNode.stop(); } catch(_) {} }
    this._panicNode = null; this._panicOn = false;
  }
  startRun() {
    if (this._runOn) return;
    this._runNode = this._play('run', true, 0.5);
    this._runOn = !!this._runNode;
  }
  stopRun() {
    if (this._runNode) { try { this._runNode.stop(); } catch(_) {} }
    this._runNode = null; this._runOn = false;
  }
  tickCooldowns(dt) {
    if (this._biteCooldown > 0) this._biteCooldown = Math.max(0, this._biteCooldown - dt);
    if (this._nearCooldown > 0) this._nearCooldown = Math.max(0, this._nearCooldown - dt);
  }
  applyMuteSetting() {
    if (Settings.muted) {
      this.stopBg(); this.stopPanic(); this.stopRun();
    } else {
      this.playBg();
      const game = window._game;
      if (game) {
        if (game._inDangerZone) this.startRun();
        if (game.player && game.player.lives === 1 && game.player.alive) this.startPanic();
      }
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   2. SPATIAL GRID
───────────────────────────────────────────────────────────── */
class SpatialGrid {
  constructor(worldW, worldH, cellSize) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(worldW / cellSize);
    this.rows = Math.ceil(worldH / cellSize);
    this.cells = new Array(this.cols * this.rows).fill(null).map(() => new Set());
  }
  _idx(x, y) {
    const cx = Math.max(0, Math.min(Math.floor(x / this.cellSize), this.cols - 1));
    const cy = Math.max(0, Math.min(Math.floor(y / this.cellSize), this.rows - 1));
    return cy * this.cols + cx;
  }
  add(item) {
    const idx = this._idx(item.pos.x, item.pos.y);
    item._gridIdx = idx;
    this.cells[idx].add(item);
  }
  remove(item) {
    if (item._gridIdx !== undefined) {
      this.cells[item._gridIdx].delete(item);
      item._gridIdx = undefined;
    } else {
      this.cells[this._idx(item.pos.x, item.pos.y)].delete(item);
    }
  }
  query(x, y, r, out) {
    out.length = 0;
    const x0 = Math.max(0, Math.floor((x - r) / this.cellSize));
    const y0 = Math.max(0, Math.floor((y - r) / this.cellSize));
    const x1 = Math.min(this.cols - 1, Math.floor((x + r) / this.cellSize));
    const y1 = Math.min(this.rows - 1, Math.floor((y + r) / this.cellSize));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (const item of this.cells[cy * this.cols + cx]) out.push(item);
      }
    }
    return out;
  }
  clear() { for (const c of this.cells) c.clear(); }
}

/* ─────────────────────────────────────────────────────────────
   3. FOOD
───────────────────────────────────────────────────────────── */
const FOOD_TYPE = Object.freeze({
  NORMAL:   'normal',
  MAGNET:   'magnet',
  ATTACK:   'attack',
  LIFELINE: 'lifeline',
  SHIELD:   'shield',
  GHOST:    'ghost',
  MINE:     'mine',
  SPEED:    'speed',
});

class Food {
  constructor(x, y, color, type = FOOD_TYPE.NORMAL, ttl = null) {
    this.pos    = new Vector2(x, y);
    this.type   = type;
    this.radius = type === FOOD_TYPE.NORMAL ? 6 : 9;
    this.phase  = Math.random() * Math.PI * 2;
    this.ttl    = ttl;

    const colors = {
      [FOOD_TYPE.MAGNET]:   '#00ccff',
      [FOOD_TYPE.ATTACK]:   '#ff3f3f',
      [FOOD_TYPE.LIFELINE]: '#ff5f9e',
      [FOOD_TYPE.SHIELD]:   '#a0d8ff',
      [FOOD_TYPE.GHOST]:    '#c8a0ff',
      [FOOD_TYPE.MINE]:     '#ff9f40',
      [FOOD_TYPE.SPEED]:    '#ffff80',
    };
    this.color = colors[type] || color;
  }

  get expired() { return this.ttl !== null && this.ttl <= 0; }

  draw(ctx, camX, camY) {
    if (this.expired) return;
    const sx = this.pos.x - camX;
    const sy = this.pos.y - camY;
    // Use logical dimensions for culling (ctx transform is dpr-scaled)
    const dpr  = window._game ? window._game._dpr : 1;
    const logW = ctx.canvas.width  / dpr;
    const logH = ctx.canvas.height / dpr;
    if (sx < -24 || sx > logW + 24 || sy < -24 || sy > logH + 24) return;

    const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.003 + this.phase);
    const r     = this.radius + pulse * 2;

    let alpha = 1;
    if (this.ttl !== null && this.ttl < 3) alpha = Math.max(0, this.ttl / 3);
    ctx.globalAlpha = alpha;

    if (this.type === FOOD_TYPE.NORMAL) {
      ctx.shadowColor = this.color; ctx.shadowBlur = 8 + pulse * 6;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = this.color; ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(sx, sy, r * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();

    } else if (this.type === FOOD_TYPE.MAGNET) {
      const spin = Date.now() * 0.003;
      ctx.shadowColor = '#00ccff'; ctx.shadowBlur = 18 + pulse * 10;
      ctx.beginPath(); ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,200,255,0.4)'; ctx.lineWidth = 2; ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = spin + (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(sx + Math.cos(a) * (r + 5), sy + Math.sin(a) * (r + 5), 2, 0, Math.PI * 2);
        ctx.fillStyle = '#52ddff'; ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#00ccff'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, r * 0.5, Math.PI, 0, false); ctx.stroke();

    } else if (this.type === FOOD_TYPE.ATTACK) {
      ctx.shadowColor = '#ff3f3f'; ctx.shadowBlur = 18 + pulse * 12;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ff3f3f'; ctx.fill();
      ctx.shadowBlur = 0; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx, sy - r * 0.7); ctx.lineTo(sx, sy + r * 0.4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx - r * 0.45, sy + r * 0.1); ctx.lineTo(sx + r * 0.45, sy + r * 0.1); ctx.stroke();
      ctx.lineCap = 'butt';

    } else if (this.type === FOOD_TYPE.LIFELINE) {
      ctx.shadowColor = '#ff5f9e'; ctx.shadowBlur = 20 + pulse * 12;
      ctx.beginPath(); ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,95,158,0.4)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ff5f9e'; ctx.fill();
      ctx.save();
      ctx.shadowBlur = 0; ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(r * 1.3)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('♥', sx, sy + 1);
      ctx.restore();

    } else if (this.type === FOOD_TYPE.SHIELD) {
      ctx.shadowColor = '#a0d8ff'; ctx.shadowBlur = 20 + pulse * 12;
      // Rotating ring
      const spin2 = Date.now() * 0.002;
      ctx.strokeStyle = `rgba(160,216,255,${(0.3 + pulse * 0.3).toFixed(2)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, r + 5, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 5; i++) {
        const a = spin2 + (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(sx + Math.cos(a) * (r + 5), sy + Math.sin(a) * (r + 5), 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#a0d8ff'; ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#a0d8ff'; ctx.fill();
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(r * 1.2)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🛡️', sx, sy + 1);
      ctx.restore();

    } else if (this.type === FOOD_TYPE.GHOST) {
      ctx.shadowColor = '#c8a0ff'; ctx.shadowBlur = 18 + pulse * 10;
      ctx.beginPath(); ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(200,160,255,${(0.25 + pulse * 0.25).toFixed(2)})`;
      ctx.lineWidth = 2; ctx.stroke();
      ctx.globalAlpha = (0.5 + pulse * 0.35) * alpha;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#c8a0ff'; ctx.fill();
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowBlur = 0; ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(r * 1.2)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('👻', sx, sy + 1);
      ctx.restore();

    } else if (this.type === FOOD_TYPE.MINE) {
      ctx.shadowColor = '#ff9f40'; ctx.shadowBlur = 18 + pulse * 10;
      ctx.beginPath(); ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,159,64,${(0.3 + pulse * 0.3).toFixed(2)})`;
      ctx.lineWidth = 2; ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#cc5500'; ctx.fill();
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(r * 1.2)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('💣', sx, sy + 1);
      ctx.restore();

    } else if (this.type === FOOD_TYPE.SPEED) {
      ctx.shadowColor = '#ffff80'; ctx.shadowBlur = 20 + pulse * 12;
      ctx.beginPath(); ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,128,${(0.3 + pulse * 0.3).toFixed(2)})`;
      ctx.lineWidth = 2; ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#cccc00'; ctx.fill();
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(r * 1.2)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('⚡', sx, sy + 1);
      ctx.restore();
    }

    ctx.globalAlpha = 1;
  }
}

/* ─────────────────────────────────────────────────────────────
   4. PARTICLE POOL
───────────────────────────────────────────────────────────── */
const MAX_PARTICLES = 500;

class ParticlePool {
  constructor() {
    this._pool = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this._pool.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, radius: 0, color: '#fff' });
    }
  }

  burst(segments, color, countMul = 1) {
    for (let i = 0; i < segments.length; i += 4) {
      const seg = segments[i];
      const p = this._getFree();
      if (!p) break;
      const angle = Math.random() * Math.PI * 2;
      const speed = (60 + Math.random() * 120) * countMul;
      p.active = true;
      p.x = seg.x; p.y = seg.y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = 0;
      p.maxLife = 0.6 + Math.random() * 0.5;
      p.radius = 2 + Math.random() * 4;
      p.color = color;
    }
  }

  burstAt(x, y, color, count = 20) {
    for (let i = 0; i < count; i++) {
      const p = this._getFree();
      if (!p) break;
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 150;
      p.active = true;
      p.x = x; p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = 0;
      p.maxLife = 0.5 + Math.random() * 0.6;
      p.radius = 2 + Math.random() * 5;
      p.color = color;
    }
  }

  _getFree() {
    for (const p of this._pool) if (!p.active) return p;
    return null;
  }

  update(dt) {
    for (const p of this._pool) {
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) { p.active = false; continue; }
      p.vx *= (1 - dt * 3); p.vy *= (1 - dt * 3);
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
  }

  draw(ctx, camX, camY) {
    const dpr  = window._game ? window._game._dpr : 1;
    const logW = ctx.canvas.width  / dpr;
    const logH = ctx.canvas.height / dpr;
    for (const p of this._pool) {
      if (!p.active) continue;
      const sx = p.x - camX, sy = p.y - camY;
      if (sx < -20 || sx > logW + 20 || sy < -20 || sy > logH + 20) continue;
      const t = p.life / p.maxLife;
      ctx.globalAlpha = 1 - t;
      ctx.beginPath();
      ctx.arc(sx, sy, p.radius * (1 - t * 0.5), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/* ─────────────────────────────────────────────────────────────
   5. SNAKE (base class)
───────────────────────────────────────────────────────────── */
function getSegmentR(isPlayer = false) {
  if (!isPlayer) return SEGMENT_R_BASE;
  switch (Settings.design) {
    case 'fatty':  return Math.round(SEGMENT_R_BASE * 1.45);
    case 'thin':   return Math.round(SEGMENT_R_BASE * 0.60);
    default:       return SEGMENT_R_BASE;
  }
}

let _designerPaletteIdx = 0;
let _designerTimer      = 0;
const DESIGNER_CYCLE    = 4;

function tickDesignerPalette(dt) {
  if (Settings.design !== 'designer') return;
  _designerTimer += dt;
  if (_designerTimer >= DESIGNER_CYCLE) {
    _designerTimer = 0;
    _designerPaletteIdx = (_designerPaletteIdx + 1) % DESIGNER_PALETTES.length;
  }
}

class Snake {
  constructor(x, y, bodyColor, headColor, initLen = 8, isPlayer = false) {
    this.pos       = new Vector2(x, y);
    this.dir       = new Vector2(1, 0);
    this.speed     = BASE_SPEED;
    this.alive     = true;
    this.bodyColor = bodyColor;
    this.headColor = headColor;
    this.score     = 0;
    this.isPlayer  = isPlayer;
    this.name      = '';

    this.segments = [];
    for (let i = 0; i < initLen; i++) {
      this.segments.push(new Vector2(x - i * SEGMENT_GAP, y));
    }

    this._growBuffer = 0;
    this._tmpVec     = new Vector2(0, 0);

    // Trail ring buffer: 8 recent head positions
    this._trailBuf = [];
    this._trailMax = 8;
  }

  get length() { return this.segments.length; }
  get head()   { return this.segments[0]; }

  _applyDirection(dt) {
    const head = this.segments[0];
    head.x += this.dir.x * this.speed * dt;
    head.y += this.dir.y * this.speed * dt;
    this.pos.x = head.x;
    this.pos.y = head.y;

    // Record trail
    this._trailBuf.push({ x: head.x, y: head.y });
    if (this._trailBuf.length > this._trailMax) this._trailBuf.shift();
  }

  _moveSegments() {
    const gapSq = SEGMENT_GAP * SEGMENT_GAP;
    for (let i = 1; i < this.segments.length; i++) {
      const seg  = this.segments[i];
      const prev = this.segments[i - 1];
      const dx = prev.x - seg.x, dy = prev.y - seg.y;
      const dSq = dx * dx + dy * dy;
      if (dSq <= gapSq) continue;
      const dist = Math.sqrt(dSq);
      const t = (dist - SEGMENT_GAP) / dist;
      seg.x += dx * t;
      seg.y += dy * t;
    }
  }

  eat(points = 1) { this._growBuffer += 4; this.score += points; }

  _grow() {
    if (this._growBuffer <= 0) return;
    this._growBuffer--;
    const segs = this.segments;
    const tail = segs[segs.length - 1];
    if (segs.length >= 2) {
      const prev = segs[segs.length - 2];
      const dx = tail.x - prev.x, dy = tail.y - prev.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      segs.push(new Vector2(tail.x + (dx / dist) * SEGMENT_GAP, tail.y + (dy / dist) * SEGMENT_GAP));
    } else {
      segs.push(new Vector2(tail.x, tail.y));
    }
  }

  _calcSpeed(baseSpeed) {
    const len = this.segments.length;
    const t   = Math.max(0, Math.min(1, (len - SPEED_SCALE_MIN) / (SPEED_SCALE_MAX - SPEED_SCALE_MIN)));
    const mul = SPEED_SMALL_MUL + (SPEED_LARGE_MUL - SPEED_SMALL_MUL) * t;
    return baseSpeed * mul;
  }

  shrink(count) {
    const minLen = 5;
    const remove = Math.min(count, this.segments.length - minLen);
    if (remove > 0) this.segments.splice(this.segments.length - remove, remove);
  }

  _drawTrail(ctx, camX, camY) {
    if (this._trailBuf.length < 2) return;
    const color = this.headColor;
    ctx.save();
    for (let i = 0; i < this._trailBuf.length; i++) {
      const p = this._trailBuf[i];
      const sx = p.x - camX, sy = p.y - camY;
      const alpha = (i / this._trailBuf.length) * 0.35;
      const r = SEGMENT_R_BASE * (i / this._trailBuf.length) * 0.8;
      if (r < 0.5) continue;
      ctx.globalAlpha  = alpha;
      ctx.shadowColor  = color;
      ctx.shadowBlur   = 8;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;
    ctx.restore();
  }

  draw(ctx, camX, camY) {
    if (!this.alive) return;

    // I-frame flicker
    if (this.iFrameTimer !== undefined && this.iFrameTimer > 0) {
      if (Math.floor(Date.now() / 62) % 2 === 0) return;
    }

    // Ghost mode semi-transparency
    const isGhost = this.ghostTimer !== undefined && this.ghostTimer > 0;
    if (isGhost) ctx.globalAlpha = 0.4;

    // Draw trail first
    this._drawTrail(ctx, camX, camY);

    const segR       = getSegmentR(this.isPlayer);
    const segs       = this.segments;
    const len        = segs.length;
    const inAttack   = this.attackTimer !== undefined && this.attackTimer > 0;
    const inShield   = this.shieldTimer !== undefined && this.shieldTimer > 0;
    const inSpeed    = this.speedBoostTimer !== undefined && this.speedBoostTimer > 0;

    let bodyFill  = inAttack ? '#8b1a1a' : this._resolveBodyColor();
    let headFill  = inAttack ? '#ff2222' : this._resolveHeadColor();
    const glowColor = inAttack ? '#ff2222' : (inShield ? '#a0d8ff' : (inSpeed ? '#ffff80' : headFill));
    const isMulticolour = this.isPlayer && Settings.design === 'multicolour' && !inAttack;

    // Body
    const _dpr  = window._game ? window._game._dpr : 1;
    const _logW = ctx.canvas.width  / _dpr;
    const _logH = ctx.canvas.height / _dpr;

    if (isMulticolour) {
      for (let i = len - 1; i >= 1; i--) {
        const sx = segs[i].x - camX, sy = segs[i].y - camY;
        if (sx < -segR * 2 || sx > _logW + segR * 2 || sy < -segR * 2 || sy > _logH + segR * 2) continue;
        ctx.beginPath();
        ctx.arc(sx, sy, segR, 0, Math.PI * 2);
        ctx.fillStyle = MULTICOLOUR_PALETTE[i % MULTICOLOUR_PALETTE.length];
        ctx.fill();
      }
    } else {
      ctx.beginPath();
      for (let i = len - 1; i >= 1; i--) {
        const sx = segs[i].x - camX, sy = segs[i].y - camY;
        if (sx < -segR * 2 || sx > _logW + segR * 2 || sy < -segR * 2 || sy > _logH + segR * 2) continue;
        ctx.moveTo(sx + segR, sy);
        ctx.arc(sx, sy, segR, 0, Math.PI * 2);
      }
      ctx.fillStyle = bodyFill;
      ctx.fill();
    }

    // Head
    const hx = segs[0].x - camX, hy = segs[0].y - camY;
    ctx.save();
    ctx.shadowColor = glowColor;
    ctx.shadowBlur  = inAttack ? 28 : (inShield ? 22 : (inSpeed ? 20 : 16));
    ctx.beginPath();
    ctx.arc(hx, hy, segR * 1.35, 0, Math.PI * 2);
    ctx.fillStyle = headFill;
    ctx.fill();
    ctx.restore();

    // Attack ring
    if (inAttack) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.01);
      ctx.save();
      ctx.strokeStyle = `rgba(255,50,50,${(0.4 + pulse * 0.4).toFixed(2)})`;
      ctx.lineWidth = 3; ctx.shadowColor = '#ff2222'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(hx, hy, segR * 1.9 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // Shield aura
    if (inShield) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.006);
      ctx.save();
      ctx.strokeStyle = `rgba(160,216,255,${(0.5 + pulse * 0.4).toFixed(2)})`;
      ctx.lineWidth = 3.5; ctx.shadowColor = '#a0d8ff'; ctx.shadowBlur = 20;
      ctx.beginPath(); ctx.arc(hx, hy, segR * 2.1 + pulse * 4, 0, Math.PI * 2); ctx.stroke();
      // Inner fill glow
      ctx.globalAlpha = 0.1 + pulse * 0.08;
      ctx.beginPath(); ctx.arc(hx, hy, segR * 2.0, 0, Math.PI * 2);
      ctx.fillStyle = '#a0d8ff'; ctx.fill();
      ctx.restore();
    }

    // Speed glow
    if (inSpeed) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.015);
      ctx.save();
      ctx.strokeStyle = `rgba(255,255,128,${(0.4 + pulse * 0.4).toFixed(2)})`;
      ctx.lineWidth = 2.5; ctx.shadowColor = '#ffff80'; ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.arc(hx, hy, segR * 1.8 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    this._drawEyes(ctx, hx, hy, segR);

    if (isGhost) ctx.globalAlpha = 1;
  }

  _resolveBodyColor() {
    if (this.isPlayer && Settings.design === 'designer') return DESIGNER_PALETTES[_designerPaletteIdx][0];
    return this.bodyColor;
  }
  _resolveHeadColor() {
    if (this.isPlayer && Settings.design === 'designer') return DESIGNER_PALETTES[_designerPaletteIdx][1];
    return this.headColor;
  }

  _drawEyes(ctx, hx, hy, segR = SEGMENT_R_BASE) {
    const eyeOff  = segR * 0.55;
    const fwdDist = segR * 0.4;
    const perpX = -this.dir.y * eyeOff, perpY = this.dir.x * eyeOff;
    const fwdX  = this.dir.x * fwdDist, fwdY  = this.dir.y * fwdDist;

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(hx + fwdX + perpX, hy + fwdY + perpY, 3.2, 0, Math.PI * 2);
    ctx.arc(hx + fwdX - perpX, hy + fwdY - perpY, 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(hx + fwdX + perpX + this.dir.x * 1.2, hy + fwdY + perpY + this.dir.y * 1.2, 1.6, 0, Math.PI * 2);
    ctx.arc(hx + fwdX - perpX + this.dir.x * 1.2, hy + fwdY - perpY + this.dir.y * 1.2, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ─────────────────────────────────────────────────────────────
   6. PLAYER SNAKE
───────────────────────────────────────────────────────────── */
class PlayerSnake extends Snake {
  constructor(x, y) {
    super(x, y, '#2dd87a', '#7effb2', 12, true);
    this.pointer        = new Vector2(0, 0);
    this.boosting       = false;
    this._boostDrainAcc = 0;

    this.lives          = PLAYER_LIVES;
    this.iFrameTimer    = 0;
    this.magnetTimer    = 0;
    this.attackTimer    = 0;
    this.shieldTimer    = 0;
    this.ghostTimer     = 0;
    this.mineTimer      = 0;
    this.speedBoostTimer = 0;

    this._mineDeployAcc  = 0;
    this.activeMines     = [];  // Mine objects
  }

  update(dt, camX, camY, joystickDir = null, gyroDir = null) {
    if (!this.alive) return;

    if (this.iFrameTimer   > 0) this.iFrameTimer   = Math.max(0, this.iFrameTimer   - dt);
    if (this.magnetTimer   > 0) this.magnetTimer   = Math.max(0, this.magnetTimer   - dt);
    if (this.attackTimer   > 0) this.attackTimer   = Math.max(0, this.attackTimer   - dt);
    if (this.shieldTimer   > 0) this.shieldTimer   = Math.max(0, this.shieldTimer   - dt);
    if (this.ghostTimer    > 0) this.ghostTimer    = Math.max(0, this.ghostTimer    - dt);
    if (this.speedBoostTimer > 0) this.speedBoostTimer = Math.max(0, this.speedBoostTimer - dt);
    if (this.mineTimer     > 0) this.mineTimer     = Math.max(0, this.mineTimer     - dt);

    // Mine deployment
    if (this.mineTimer > 0 && this.activeMines.length < MINE_MAX) {
      this._mineDeployAcc += dt;
      if (this._mineDeployAcc >= MINE_DEPLOY_INTERVAL) {
        this._mineDeployAcc = 0;
        this.activeMines.push(new Mine(this.head.x, this.head.y));
      }
    }
    // Tick mines
    for (const m of this.activeMines) m.update(dt);
    this.activeMines = this.activeMines.filter(m => !m.expired);

    const speedMul = this.speedBoostTimer > 0 ? SPEED_BOOST_MUL : 1;
    const scaledBase  = this._calcSpeed(BASE_SPEED  * speedMul);
    const scaledBoost = this._calcSpeed(BOOST_SPEED * speedMul);
    this.speed = (this.boosting && this.segments.length > 6) ? scaledBoost : scaledBase;

    if (this.boosting && this.segments.length > 6 && this.speedBoostTimer <= 0) {
      this._boostDrainAcc += BOOST_DRAIN * dt;
      const toRemove = Math.floor(this._boostDrainAcc);
      if (toRemove > 0) { this.shrink(toRemove); this._boostDrainAcc -= toRemove; }
    } else {
      this._boostDrainAcc = 0;
    }

    // Steering: joystick > gyro > mouse/touch
    if (joystickDir && (joystickDir.x !== 0 || joystickDir.y !== 0)) {
      const lerpT = Math.min(1, 0.12 * dt * 60);
      this.dir = this.dir.lerp(joystickDir.normalize(), lerpT).normalize();
    } else if (gyroDir && (gyroDir.x !== 0 || gyroDir.y !== 0)) {
      const lerpT = Math.min(1, 0.10 * dt * 60);
      this.dir = this.dir.lerp(gyroDir.normalize(), lerpT).normalize();
    } else {
      const sens = Settings.sensitivity;
      const lerpBase = 0.01 + (sens / 20) * 0.21;
      const worldX = this.pointer.x + camX, worldY = this.pointer.y + camY;
      const dx = worldX - this.head.x, dy = worldY - this.head.y;
      const dSq = dx * dx + dy * dy;
      if (dSq > 100) {
        const dist = Math.sqrt(dSq);
        const desired = new Vector2(dx / dist, dy / dist);
        const lerpT = Math.min(1, lerpBase * dt * 60);
        this.dir = this.dir.lerp(desired, lerpT).normalize();
      }
    }

    this._applyDirection(dt);
    this._moveSegments();
    this._grow();
  }

  activateMagnet()     { this.magnetTimer   = MAGNET_DURATION; }
  activateAttack()     { this.attackTimer   = ATTACK_DURATION; }
  activateShield()     { this.shieldTimer   = SHIELD_DURATION; }
  activateGhost()      { this.ghostTimer    = GHOST_DURATION; }
  activateMine()       { this.mineTimer = MINE_DURATION; this._mineDeployAcc = MINE_DEPLOY_INTERVAL; }
  activateSpeedBoost() { this.speedBoostTimer = SPEED_BOOST_DURATION; }

  get invincible() { return this.iFrameTimer > 0 || this.shieldTimer > 0; }
  get isGhost()    { return this.ghostTimer > 0; }
}

/* ─────────────────────────────────────────────────────────────
   7. AI SNAKE
───────────────────────────────────────────────────────────── */
const AI_STATE = Object.freeze({
  WANDER: 'WANDER', SEEK_FOOD: 'SEEK_FOOD',
  AVOID: 'AVOID',   FLEE: 'FLEE',   PURSUE: 'PURSUE',
});

const HYSTERESIS = {
  PURSUE:    { enter: 0.25, exit: 0.40 },
  FLEE:      { enter: 0.15, exit: 0.50 },
  AVOID:     { enter: 0.05, exit: 0.20 },
  SEEK_FOOD: { enter: 0.0,  exit: 0.10 },
};

const AI_PERSONALITIES = ['aggressive', 'coward', 'hunter', 'farmer'];

class AISnake extends Snake {
  constructor(x, y, bodyColor, headColor, foodGrid, snakes) {
    super(x, y, bodyColor, headColor, 8);
    this.foodGrid = foodGrid;
    this.snakes   = snakes;
    this.state    = AI_STATE.WANDER;
    this.name     = generateName();

    // Assign personality
    this.personality = AI_PERSONALITIES[Math.floor(Math.random() * AI_PERSONALITIES.length)];

    this._wanderAngle  = Math.random() * Math.PI * 2;
    this._wanderDist   = 55;
    this._wanderRadius = 30;
    this._wanderJitter = 1.2;

    // Personality-adjusted parameters
    this.FOOD_RADIUS     = 180;
    this.SNAKE_SENSE_R   = 220;
    this.BODY_SENSE_R    = 90;
    this.LOOKAHEAD_STEPS = 3;
    this.LOOKAHEAD_DIST  = 30;
    this.MAX_FORCE  = 0.12;
    this.STEER_LERP = 6.0;
    this.pursueThreshold = 8;   // sizeDiff needed to pursue
    this.fleeThreshold   = 8;   // sizeDiff needed to flee

    this._applyPersonality();

    this._hyst = { PURSUE: 0, FLEE: 0, AVOID: 0, SEEK_FOOD: 0 };
    this._fleeTarget = null; this._pursueTarget = null; this._avoidNormal = null;
    this._nearby = []; this._nearbySnakes = [];
  }

  _applyPersonality() {
    switch (this.personality) {
      case 'aggressive':
        this.pursueThreshold = 4;
        this.fleeThreshold   = 25;
        this.speed = BASE_SPEED * 1.08;
        break;
      case 'coward':
        this.pursueThreshold = 30;
        this.fleeThreshold   = 4;
        this.speed = BASE_SPEED * 0.95;
        break;
      case 'hunter':
        this.SNAKE_SENSE_R = 380;
        this.speed = BASE_SPEED * 1.05;
        break;
      case 'farmer':
        this.FOOD_RADIUS   = 320;
        this.SNAKE_SENSE_R = 80;
        this.pursueThreshold = 999;
        break;
    }
  }

  update(dt) {
    if (!this.alive) return;
    const { nearbyFood, fleeTarget, pursueTarget, avoidNormal } = this._sense();
    this.state = this._evalFSM(dt, nearbyFood, fleeTarget, pursueTarget, avoidNormal);
    let force = this._computeForce(dt, nearbyFood, fleeTarget, pursueTarget, avoidNormal);
    const wallForce = this._wallAvoidForce();
    if (wallForce) force = force.add(wallForce);
    const clamped = force.clamp(this.MAX_FORCE);
    const lerpT   = Math.min(1, this.STEER_LERP * dt);
    this.dir = this.dir.lerp(this.dir.add(clamped), lerpT).normalize();
    this.speed = this._calcSpeed(BASE_SPEED * (this.personality === 'aggressive' ? 1.08 : this.personality === 'coward' ? 0.95 : this.personality === 'hunter' ? 1.05 : 1));
    this._applyDirection(dt);
    this._moveSegments();
    this._grow();
  }

  _sense() {
    const nearbyFood = this.foodGrid.query(this.head.x, this.head.y, this.FOOD_RADIUS, this._nearby);
    let fleeTarget = null, pursueTarget = null;
    let closestFleeDistSq = Infinity, closestPursueDistSq = Infinity;

    for (const other of this.snakes) {
      if (other === this || !other.alive) continue;
      const dsq = Vector2.distSq(this.head, other.head);
      if (dsq > this.SNAKE_SENSE_R * this.SNAKE_SENSE_R) continue;
      const sizeDiff = other.length - this.length;

      // Hunter always targets player if in range and player is smaller
      if (this.personality === 'hunter' && other.isPlayer && other.length < this.length) {
        if (dsq < closestPursueDistSq) { closestPursueDistSq = dsq; pursueTarget = other; }
        continue;
      }

      if (sizeDiff > this.fleeThreshold) {
        if (dsq < closestFleeDistSq) { closestFleeDistSq = dsq; fleeTarget = other; }
      } else if (sizeDiff < -this.pursueThreshold) {
        if (dsq < closestPursueDistSq) { closestPursueDistSq = dsq; pursueTarget = other; }
      }
    }

    let avoidNormal = null;
    outerLoop:
    for (let step = 1; step <= this.LOOKAHEAD_STEPS; step++) {
      const probeX = this.head.x + this.dir.x * this.LOOKAHEAD_DIST * step;
      const probeY = this.head.y + this.dir.y * this.LOOKAHEAD_DIST * step;
      const hitRadSq = (SEGMENT_R_BASE * 2.2) * (SEGMENT_R_BASE * 2.2);
      for (const other of this.snakes) {
        if (other === this || !other.alive) continue;
        if (Vector2.distSq(this.head, other.head) > (this.BODY_SENSE_R + other.length * SEGMENT_GAP) * (this.BODY_SENSE_R + other.length * SEGMENT_GAP)) continue;
        for (const seg of other.segments) {
          const dx = probeX - seg.x, dy = probeY - seg.y;
          if (dx * dx + dy * dy < hitRadSq) {
            const dot  = -this.dir.y * dx + this.dir.x * dy;
            const sign = dot >= 0 ? 1 : -1;
            avoidNormal = new Vector2(-this.dir.y * sign, this.dir.x * sign);
            break outerLoop;
          }
        }
      }
    }

    this._fleeTarget = fleeTarget; this._pursueTarget = pursueTarget; this._avoidNormal = avoidNormal;
    return { nearbyFood, fleeTarget, pursueTarget, avoidNormal };
  }

  _evalFSM(dt, nearbyFood, fleeTarget, pursueTarget, avoidNormal) {
    const tick = (key, cond) => {
      if (cond) this._hyst[key] = Math.min(this._hyst[key] + dt, HYSTERESIS[key].enter + 0.1);
      else      this._hyst[key] = Math.max(0, this._hyst[key] - dt);
    };
    tick('AVOID',     avoidNormal  !== null);
    tick('FLEE',      fleeTarget   !== null);
    tick('PURSUE',    pursueTarget !== null);
    tick('SEEK_FOOD', nearbyFood.length > 0);

    if (this._hyst['AVOID']     >= HYSTERESIS.AVOID.enter)     return AI_STATE.AVOID;
    if (this._hyst['FLEE']      >= HYSTERESIS.FLEE.enter)      return AI_STATE.FLEE;
    if (this._hyst['PURSUE']    >= HYSTERESIS.PURSUE.enter)    return AI_STATE.PURSUE;
    if (this._hyst['SEEK_FOOD'] >= HYSTERESIS.SEEK_FOOD.enter) return AI_STATE.SEEK_FOOD;
    return AI_STATE.WANDER;
  }

  _computeForce(dt, nearbyFood, fleeTarget, pursueTarget, avoidNormal) {
    // Farmer heavily prefers food
    if (this.personality === 'farmer' && this.state !== AI_STATE.FLEE && nearbyFood.length > 0) {
      let bestDsq = Infinity, target = null;
      for (const f of nearbyFood) {
        const dsq = Vector2.distSq(this.head, f.pos);
        if (dsq < bestDsq) { bestDsq = dsq; target = f; }
      }
      if (target) return this.seek(target.pos).scale(1.2);
    }

    // Flock behavior — aggressive snakes coordinate
    if (this.personality === 'aggressive' && pursueTarget && this.state === AI_STATE.PURSUE) {
      const allies = this.snakes.filter(s =>
        s !== this && s.alive && s instanceof AISnake &&
        s.personality === 'aggressive' && s._pursueTarget === pursueTarget &&
        Vector2.distSq(this.head, s.head) < 200 * 200
      );
      if (allies.length > 0) {
        // This snake flanks (90° offset)
        const baseDir = this.pursue(pursueTarget);
        const perpAngle = baseDir.angle() + Math.PI / 2;
        return Vector2.fromAngle(perpAngle, 1).sub(this.dir);
      }
    }

    switch (this.state) {
      case AI_STATE.AVOID:    return avoidNormal  ? avoidNormal.scale(2.0)       : this.wander(dt).scale(0.6);
      case AI_STATE.FLEE:     return fleeTarget   ? this.evade(fleeTarget).scale(1.8) : this.wander(dt).scale(0.6);
      case AI_STATE.PURSUE:   return pursueTarget ? this.pursue(pursueTarget).scale(1.2) : this.wander(dt).scale(0.6);
      case AI_STATE.SEEK_FOOD: {
        let bestDsq = Infinity, target = null;
        for (const f of nearbyFood) {
          const dsq = Vector2.distSq(this.head, f.pos);
          if (dsq < bestDsq) { bestDsq = dsq; target = f; }
        }
        return target ? this.seek(target.pos).scale(1.0) : this.wander(dt).scale(0.6);
      }
      default: return this.wander(dt).scale(0.6);
    }
  }

  seek(targetPos) { return targetPos.sub(this.head).normalize().sub(this.dir); }
  flee(targetPos) { return this.seek(targetPos).scale(-1); }

  pursue(target) {
    const toTarget   = target.head.sub(this.head);
    const dist       = toTarget.length();
    const lookAheadT = Math.min(dist / (this.speed || BASE_SPEED), 1.5);
    const futurePos  = dist > 60 ? target.head.add(target.dir.scale(target.speed * lookAheadT)) : target.head;
    return this.seek(futurePos);
  }

  evade(threat) {
    const toThreat   = threat.head.sub(this.head);
    const dist       = toThreat.length();
    const lookAheadT = Math.min(dist / (this.speed || BASE_SPEED), 1.5);
    const futurePos  = dist > 60 ? threat.head.add(threat.dir.scale(threat.speed * lookAheadT)) : threat.head;
    return this.flee(futurePos);
  }

  wander(dt) {
    this._wanderAngle += (Math.random() - 0.5) * this._wanderJitter * dt * 60;
    const circleCentre = this.dir.scale(this._wanderDist);
    const displacement = Vector2.fromAngle(this._wanderAngle, this._wanderRadius);
    const target = this.head.add(circleCentre).add(displacement);
    return this.seek(target);
  }

  _wallAvoidForce() {
    const MARGIN_OUTER = 160, MARGIN_INNER = 60;
    let px = 0, py = 0;
    const hx = this.head.x, hy = this.head.y;
    const push = (dist) => dist < MARGIN_OUTER ? (1 - Math.max(0, (dist - MARGIN_INNER) / (MARGIN_OUTER - MARGIN_INNER))) : 0;
    px +=  push(hx); px -= push(WORLD_W - hx);
    py +=  push(hy); py -= push(WORLD_H - hy);
    if (px === 0 && py === 0) return null;
    const len = Math.sqrt(px * px + py * py);
    return new Vector2(px / len, py / len).scale(0.3);
  }
}

/* ─────────────────────────────────────────────────────────────
   8. GAME
───────────────────────────────────────────────────────────── */
let _lastAIPaletteIdx = -1;
const AI_PALETTES = [
  ['#f56a6a', '#ff9a9a'], ['#a56aff', '#d0a5ff'],
  ['#ffb347', '#ffd78a'], ['#6ae0ff', '#a8eeff'],
  ['#ff6ab8', '#ffa8d8'], ['#c8ff6a', '#e5ff9a'],
  ['#ff6a6a', '#ffaaaa'], ['#6affcc', '#a8ffe0'],
  ['#ff8c6a', '#ffba9a'], ['#6a8cff', '#9ab0ff'],
];

function randomAIPalette() {
  let idx;
  do { idx = Math.floor(Math.random() * AI_PALETTES.length); }
  while (idx === _lastAIPaletteIdx && AI_PALETTES.length > 1);
  _lastAIPaletteIdx = idx;
  return AI_PALETTES[idx];
}

const FOOD_COLORS = [
  '#ff5e57','#ffa41b','#ffdd00','#7bff6a',
  '#00d2ff','#8c52ff','#ff52c0','#52ffca',
];

class Game {
  constructor() {
    this.canvas  = document.getElementById('game-canvas');
    this.ctx     = this.canvas.getContext('2d');

    // ── High-DPI / Retina scaling ──────────────────────────────
    // _dpr: the device pixel ratio we committed to on the last resize.
    // All coordinate logic (pointer, camera, joystick) continues to use
    // CSS / logical pixels. Only the backing buffer is scaled up.
    this._dpr = Math.min(window.devicePixelRatio || 1, 3); // cap at 3× for perf

    this.overlay      = document.getElementById('overlay');
    this.scoreDisplay = document.getElementById('score-display');
    this.finalScore   = document.getElementById('final-score');
    this.startBtn     = document.getElementById('start-btn');
    this.hudNameScore = document.getElementById('hud-name-score');
    // backward compat for existing HUD wiring (tickloop uses hud-score via window._game.player)
    this.hudScore     = this.hudNameScore;
    this.hudLength    = document.getElementById('hud-length');

    this._heartEls = [
      document.getElementById('heart-1'),
      document.getElementById('heart-2'),
      document.getElementById('heart-3'),
    ];

    this.hudBestScore = document.getElementById('hud-best-score');

    this.camX = 0; this.camY = 0;
    this.running = false;
    this.snakes  = [];
    this.foods   = [];
    this.foodGrid  = null;
    this.particles = new ParticlePool();
    this.audio     = new AudioManager();
    this.killFeed  = new KillFeed();
    this.combo     = new ComboManager();
    this.shake     = new ScreenShake();
    this.achievements = new AchievementManager();

    this._lastTime     = 0;
    this._rafId        = null;
    this._boundLoop    = this._loop.bind(this);
    this._foodQueryBuf = [];
    this._killList     = [];

    // Hit-stop
    this._hitStopTimer = 0;

    // Mode
    this._mode = 'classic';
    this._ttTimer = 120;   // Time Trial countdown
    this._worldW = WORLD_W;
    this._worldH = WORLD_H;

    // Run stats (for achievements)
    this._runStartTime = 0;

    // Joystick state
    this._joystick = {
      active: false,
      originX: 0, originY: 0,
      thumbX: 0,  thumbY: 0,
      maxR: 50,
    };
    this._joystickDir = new Vector2(0, 0);

    // Gyro state
    this._gyroDir = new Vector2(0, 0);
    this._gyroListening = false;

    window._GAME_WORLD = { w: WORLD_W, h: WORLD_H };

    this._setupResize();
    this._setupInput();
    this._setupSettings();
    this._setupPlayerName();
    this._setupStats();
    this._updateAchievementCount();
    this.startBtn.addEventListener('click', () => this.startGame());
    window._game = this;

    // Show daily badge if applicable
    this._checkDaily();
  }

  /* ── DAILY CHALLENGE ────────────────────────────────────── */
  _checkDaily() {
    const badge = document.getElementById('daily-badge');
    if (DailyChallenge.isActive && badge) badge.classList.remove('hidden');
  }

  /* ── PLAYER NAME ────────────────────────────────────────── */
  _setupPlayerName() {
    const display = document.getElementById('player-name-display');
    const input   = document.getElementById('player-name-input');
    if (!display || !input) return;

    display.textContent = getPlayerName();

    display.addEventListener('click', () => {
      input.value = getPlayerName();
      display.classList.add('hidden');
      input.classList.remove('hidden');
      input.focus();
      input.select();
    });

    const commit = () => {
      const n = input.value.trim() || getPlayerName();
      setPlayerName(n);
      display.textContent = n;
      input.classList.add('hidden');
      display.classList.remove('hidden');
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') { input.classList.add('hidden'); display.classList.remove('hidden'); }
    });
  }

  /* ── STATS PANEL ────────────────────────────────────────── */
  _setupStats() {
    const toggle = document.getElementById('stats-toggle');
    const body   = document.getElementById('stats-body');
    const arrow  = toggle ? toggle.querySelector('.stats-arrow') : null;
    if (toggle) {
      toggle.addEventListener('click', () => {
        body.classList.toggle('hidden');
        if (arrow) arrow.classList.toggle('open', !body.classList.contains('hidden'));
        if (!body.classList.contains('hidden')) this._updateStats();
      });
    }
  }

  _updateStats() {
    const p = Profile.get();
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set('stat-runs',          p.totalRuns);
    set('stat-kills',         p.totalKills);
    set('stat-food',          p.totalFoodEaten);
    set('stat-deaths',        p.totalDeaths);
    set('stat-time',          `${Math.floor(p.totalPlaytimeSeconds / 60)}m ${Math.floor(p.totalPlaytimeSeconds % 60)}s`);
    set('stat-best-classic',  p.bestScore);
    set('stat-best-tt',       p.bestScoreTimeTrial);
  }

  _updateAchievementCount() {
    const el = document.getElementById('achievement-count');
    if (el) el.textContent = `${this.achievements.unlockedCount} / ${ACHIEVEMENTS_DEF.length}`;
  }

  /* ── RESIZE ─────────────────────────────────────────────── */
  _setupResize() {
    // _resizeCanvas: sets the canvas *buffer* size to CSS size × dpr so
    // every pixel in the backing store maps to exactly one physical pixel.
    // All game-logic coordinates remain in CSS (logical) pixels — we only
    // scale the ctx transform once after each resize.
    const _resizeCanvas = () => {
      // Re-read dpr each time (can change when dragging between monitors)
      this._dpr = Math.min(window.devicePixelRatio || 1, 3);

      // Logical (CSS) dimensions — what all coordinate math uses
      const logW = window.innerWidth;
      const logH = window.innerHeight;

      // Physical buffer dimensions
      const physW = Math.round(logW * this._dpr);
      const physH = Math.round(logH * this._dpr);

      // Only reallocate if the buffer size actually changed (avoids
      // unnecessary work on orientation events that fire multiple times)
      if (this.canvas.width !== physW || this.canvas.height !== physH) {
        this.canvas.width  = physW;
        this.canvas.height = physH;
      }

      // Scale the ctx so every draw call uses logical pixels
      this.ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);

      // Invalidate the cached background tile so it is regenerated at the
      // correct logical size after the next render tick
      this._bgTile = null;
    };

    // Debounce: orientation changes fire several resize events in quick
    // succession; wait 120 ms after the last one before reacting.
    let _resizeTimer = null;
    const _debouncedResize = () => {
      clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(_resizeCanvas, 120);
    };

    window.addEventListener('resize', _debouncedResize);
    // Also listen for explicit orientation-change events (Safari)
    window.addEventListener('orientationchange', _debouncedResize);

    // Run immediately so the canvas is correctly sized before the first frame
    _resizeCanvas();
  }

  /* ── INPUT ──────────────────────────────────────────────── */
  _setupInput() {
    this._pointer = new Vector2(window.innerWidth / 2, window.innerHeight / 2);
    const isTouchDevice = 'ontouchstart' in window;

    this.canvas.addEventListener('mousemove', e => {
      this._pointer.x = e.clientX;
      this._pointer.y = e.clientY;
    });

    this.canvas.addEventListener('mousedown',  () => { if (this.running && this.player) this.player.boosting = true;  });
    this.canvas.addEventListener('mouseup',    () => { if (this.player) this.player.boosting = false; });
    this.canvas.addEventListener('mouseleave', () => { if (this.player) this.player.boosting = false; });

    if (isTouchDevice) {
      // NOTE: touchstart MUST be { passive: false } so that the browser
      // does not emit a console warning about "Ignored attempt to cancel
      // a touchstart event with cancelable=false".  The canvas already has
      // touch-action:none in CSS which lets us call preventDefault safely.
      this.canvas.addEventListener('touchstart', e => {
        // Don't intercept taps on the overlay/menu (running guard)
        if (!this.running) return;
        e.preventDefault(); // prevent click-delay ghost tap on iOS
        const t = e.touches[0];
        // Start virtual joystick
        this._joystick.active  = true;
        this._joystick.originX = t.clientX;
        this._joystick.originY = t.clientY;
        this._joystick.thumbX  = t.clientX;
        this._joystick.thumbY  = t.clientY;
        this._joystickDir = new Vector2(0, 0);
        // Second finger = boost
        if (e.touches.length > 1 && this.player) this.player.boosting = true;
      }, { passive: false }); // <-- non-passive so preventDefault works

      this.canvas.addEventListener('touchmove', e => {
        e.preventDefault(); // suppress scroll / rubber-banding
        if (!this._joystick.active) return;
        const t = e.touches[0];
        const dx = t.clientX - this._joystick.originX;
        const dy = t.clientY - this._joystick.originY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxR = this._joystick.maxR;
        const clamp = Math.min(dist, maxR);
        const nx = dist > 0 ? dx / dist : 0;
        const ny = dist > 0 ? dy / dist : 0;
        this._joystick.thumbX = this._joystick.originX + nx * clamp;
        this._joystick.thumbY = this._joystick.originY + ny * clamp;
        if (dist > 10) this._joystickDir = new Vector2(nx, ny);
      }, { passive: false });

      this.canvas.addEventListener('touchend', e => {
        // All fingers lifted → deactivate joystick and boost
        if (e.touches.length === 0) {
          this._joystick.active = false;
          this._joystickDir = new Vector2(0, 0);
          if (this.player) this.player.boosting = false;
        }
      }, { passive: true });

      this.canvas.addEventListener('touchcancel', () => {
        this._joystick.active = false;
        this._joystickDir = new Vector2(0, 0);
        if (this.player) this.player.boosting = false;
      }, { passive: true });

    } else {
      // Desktop fallback touch (e.g. Chrome DevTools device emulation)
      this.canvas.addEventListener('touchstart', e => {
        const t = e.touches[0];
        this._pointer.x = t.clientX; this._pointer.y = t.clientY;
        if (this.running && this.player) this.player.boosting = true;
      }, { passive: true });
      this.canvas.addEventListener('touchmove', e => {
        e.preventDefault();
        const t = e.touches[0];
        this._pointer.x = t.clientX; this._pointer.y = t.clientY;
      }, { passive: false });
      this.canvas.addEventListener('touchend', () => {
        if (this.player) this.player.boosting = false;
      }, { passive: true });
    }
  }

  _setupGyro() {
    if (this._gyroListening) return;
    const start = () => {
      window.addEventListener('deviceorientation', e => {
        if (!Settings.gyro) return;
        const gamma = Math.max(-45, Math.min(45, e.gamma || 0));
        const beta  = Math.max(-45, Math.min(45, (e.beta || 0) - 30)); // offset for natural hold
        this._gyroDir = new Vector2(gamma / 45, beta / 45);
      });
      this._gyroListening = true;
    };

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(r => { if (r === 'granted') start(); }).catch(() => {});
    } else {
      start();
    }
  }

  /* ── SETTINGS UI ────────────────────────────────────────── */
  _setupSettings() {
    // Mute toggle
    const muteBtn = document.getElementById('setting-mute');
    muteBtn.addEventListener('click', () => {
      Settings.muted = !Settings.muted;
      muteBtn.textContent = Settings.muted ? 'OFF' : 'ON';
      muteBtn.classList.toggle('active', !Settings.muted);
      muteBtn.setAttribute('aria-pressed', String(Settings.muted));
      this.audio.applyMuteSetting();
    });

    // Sensitivity slider
    const sensSlider = document.getElementById('setting-sensitivity');
    const sensVal    = document.getElementById('sensitivity-val');
    sensSlider.value = Settings.sensitivity;
    sensVal.textContent = Settings.sensitivity;
    sensSlider.addEventListener('input', () => {
      Settings.sensitivity = parseInt(sensSlider.value, 10);
      sensVal.textContent  = Settings.sensitivity;
    });

    // Design buttons
    const designBtns = document.querySelectorAll('.design-btn');
    designBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        designBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Settings.design = btn.dataset.design;
      });
    });

    // Mode buttons
    const modeBtns = document.querySelectorAll('.mode-btn');
    const modeDescEl = document.getElementById('mode-desc');
    const modeDescs = {
      classic:   'Eat food, grow big, outlast 10 AI snakes. 3 lives.',
      arena:     '900×900 arena. 5 AI snakes. Last snake standing wins!',
      timetrial: '120 second sprint. No lives. Eat as much as possible.',
    };
    modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Settings.mode = btn.dataset.mode;
        if (modeDescEl) modeDescEl.textContent = modeDescs[Settings.mode] || '';
      });
    });

    // Gyro toggle — only show on touch devices
    if ('ontouchstart' in window) {
      const gyroRow = document.getElementById('gyro-row');
      const gyroBtn = document.getElementById('setting-gyro');
      if (gyroRow) gyroRow.style.display = '';
      if (gyroBtn) {
        gyroBtn.addEventListener('click', () => {
          Settings.gyro = !Settings.gyro;
          gyroBtn.textContent = Settings.gyro ? 'ON' : 'OFF';
          gyroBtn.classList.toggle('active', Settings.gyro);
          if (Settings.gyro) this._setupGyro();
        });
      }
    }
  }

  /* ── START / RESET ──────────────────────────────────────── */
  startGame() {
    this.overlay.classList.add('hidden');
    this.scoreDisplay.style.display = 'none';
    const bestDisplay = document.getElementById('best-score-display');
    if (bestDisplay) bestDisplay.style.display = 'none';
    const titleEl = document.getElementById('overlay-title');
    if (titleEl) { titleEl.classList.remove('victory'); titleEl.textContent = '🐍 SNAKE RUSH'; }
    this.startBtn.textContent = 'Play Again';

    this._heartEls.forEach(el => el.classList.remove('lost'));

    // Mode setup
    this._mode = Settings.mode;
    let worldW = WORLD_W, worldH = WORLD_H;
    let foodCount = FOOD_COUNT, aiCount = AI_COUNT;

    if (DailyChallenge.isActive) {
      foodCount = DailyChallenge.foodCount;
      aiCount   = DailyChallenge.aiCount;
      worldW    = Math.round(WORLD_W * DailyChallenge.worldMod);
      worldH    = Math.round(WORLD_H * DailyChallenge.worldMod);
    }

    if (this._mode === 'arena') {
      worldW = 900; worldH = 900; foodCount = 80; aiCount = 5;
    } else if (this._mode === 'timetrial') {
      foodCount = 400; aiCount = 0;
      this._ttTimer = 120;
    }

    this._worldW = worldW;
    this._worldH = worldH;
    window._GAME_WORLD = { w: worldW, h: worldH };

    this.foodGrid = new SpatialGrid(worldW, worldH, 360);
    this.snakes   = [];
    this.player   = new PlayerSnake(worldW / 2, worldH / 2);
    this.player.name = getPlayerName();
    this.snakes.push(this.player);

    for (let i = 0; i < aiCount; i++) {
      const [body, head] = randomAIPalette();
      const x = 300 + Math.random() * (worldW - 600);
      const y = 300 + Math.random() * (worldH - 600);
      this.snakes.push(new AISnake(x, y, body, head, this.foodGrid, this.snakes));
    }

    this.foods = [];
    this._lifelineCount  = 0;
    this._shieldCount    = 0;
    this._ghostCount     = 0;
    this._mineCount      = 0;
    this._speedCount     = 0;

    for (let i = 0; i < foodCount; i++) this._spawnFood();

    _designerPaletteIdx = 0;
    _designerTimer      = 0;

    this.audio.stopBg(); this.audio.stopPanic(); this.audio.stopRun();
    this.audio.playBg();
    this.audio._nearCooldown = 0;
    this.audio._biteCooldown = 0;

    this._inDangerZone  = false;
    this._nearSnakeLast = false;
    this._hitStopTimer  = 0;
    this._runStartTime  = performance.now();
    this._arenaPulsed   = 0;

    this.killFeed  = new KillFeed();
    this.combo.reset();
    this.shake     = new ScreenShake();
    this.achievements.resetRun();

    Profile.add('totalRuns');

    this.running   = true;
    this._lastTime = performance.now();
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = requestAnimationFrame(this._boundLoop);
  }

  /* ── FOOD SPAWNING ───────────────────────────────────────── */
  _spawnFood(forceType = null, x = null, y = null) {
    const W = this._worldW || WORLD_W, H = this._worldH || WORLD_H;
    const fx  = x  ?? (50 + Math.random() * (W - 100));
    const fy  = y  ?? (50 + Math.random() * (H - 100));
    const col = FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)];

    let type = forceType;
    if (!type) {
      const roll = Math.random();
      const daily = DailyChallenge.isActive ? DailyChallenge.enabledPowerups : null;
      const ok = (name) => !daily || daily.includes(name);

      if      (roll < LIFELINE_SPAWN_RATE && this._lifelineCount < LIFELINE_MAX_ON_MAP && ok('lifeline'))    type = FOOD_TYPE.LIFELINE;
      else if (roll < LIFELINE_SPAWN_RATE + POWERUP_SPAWN_RATE && ok('magnet'))                              type = FOOD_TYPE.MAGNET;
      else if (roll < LIFELINE_SPAWN_RATE + POWERUP_SPAWN_RATE * 2 && ok('attack'))                          type = FOOD_TYPE.ATTACK;
      else if (roll < LIFELINE_SPAWN_RATE + POWERUP_SPAWN_RATE * 2 + SHIELD_SPAWN_RATE
               && this._shieldCount < SHIELD_MAX_ON_MAP && ok('shield'))                                     type = FOOD_TYPE.SHIELD;
      else if (roll < LIFELINE_SPAWN_RATE + POWERUP_SPAWN_RATE * 2 + SHIELD_SPAWN_RATE + GHOST_SPAWN_RATE
               && this._ghostCount < GHOST_MAX_ON_MAP && ok('ghost'))                                        type = FOOD_TYPE.GHOST;
      else if (roll < LIFELINE_SPAWN_RATE + POWERUP_SPAWN_RATE * 2 + SHIELD_SPAWN_RATE + GHOST_SPAWN_RATE + MINE_SPAWN_RATE
               && this._mineCount < MINE_MAX_ON_MAP && ok('mine'))                                           type = FOOD_TYPE.MINE;
      else if (roll < LIFELINE_SPAWN_RATE + POWERUP_SPAWN_RATE * 2 + SHIELD_SPAWN_RATE + GHOST_SPAWN_RATE + MINE_SPAWN_RATE + SPEED_SPAWN_RATE
               && this._speedCount < SPEED_MAX_ON_MAP && ok('speed'))                                        type = FOOD_TYPE.SPEED;
      else                                                                                                    type = FOOD_TYPE.NORMAL;
    }

    const f = new Food(fx, fy, col, type);
    this.foods.push(f);
    this.foodGrid.add(f);
    if (type === FOOD_TYPE.LIFELINE) this._lifelineCount++;
    if (type === FOOD_TYPE.SHIELD)   this._shieldCount++;
    if (type === FOOD_TYPE.GHOST)    this._ghostCount++;
    if (type === FOOD_TYPE.MINE)     this._mineCount++;
    if (type === FOOD_TYPE.SPEED)    this._speedCount++;
    return f;
  }

  _removeFood(food) {
    this.foodGrid.remove(food);
    if (food.type === FOOD_TYPE.LIFELINE) this._lifelineCount--;
    if (food.type === FOOD_TYPE.SHIELD)   this._shieldCount--;
    if (food.type === FOOD_TYPE.GHOST)    this._ghostCount--;
    if (food.type === FOOD_TYPE.MINE)     this._mineCount--;
    if (food.type === FOOD_TYPE.SPEED)    this._speedCount--;
    const idx = this.foods.indexOf(food);
    if (idx !== -1) {
      this.foods[idx] = this.foods[this.foods.length - 1];
      this.foods.pop();
    }
  }

  /* ── MAIN LOOP ──────────────────────────────────────────── */
  _loop(timestamp) {
    if (!this.running) return;

    // Re-apply the DPI scale transform on every frame.
    // canvas.width changes reset ctx.setTransform to identity, so after a
    // debounced resize the very next frame would draw at 1× until the next
    // explicit setTransform call.  Calling it here (cheaply) keeps rendering
    // crisp regardless of when the resize fires relative to rAF.
    this.ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);

    const rawDt = (timestamp - this._lastTime) / 1000;
    const dt    = Math.min(rawDt, 0.1);
    this._lastTime = timestamp;

    // Hit-stop: skip update
    if (this._hitStopTimer > 0) {
      this._hitStopTimer = Math.max(0, this._hitStopTimer - dt);
    } else {
      this._update(dt);
    }
    this._render();
    this._rafId = requestAnimationFrame(this._boundLoop);
  }

  /* ── UPDATE ─────────────────────────────────────────────── */
  _update(dt) {
    tickDesignerPalette(dt);
    this.audio.tickCooldowns(dt);
    this.killFeed.update(dt);
    this.combo.update(dt);
    this.shake.update(dt);
    this.achievements.update(dt);

    // Time Trial countdown
    if (this._mode === 'timetrial') {
      this._ttTimer -= dt;
      if (this._ttTimer <= 0) {
        this._ttTimer = 0;
        this._timeTrialEnd();
        return;
      }
    }

    if (this.player.alive) {
      this.player.pointer.x = this._pointer.x;
      this.player.pointer.y = this._pointer.y;
      const jd = this._joystick.active ? this._joystickDir : null;
      const gd = Settings.gyro ? this._gyroDir : null;
      this.player.update(dt, this.camX, this.camY, jd, gd);

      // Achievement checks
      this.achievements.onLength(this.player.length);
    }

    // AI
    for (let i = 1; i < this.snakes.length; i++) this.snakes[i].update(dt);

    // Camera — must use LOGICAL pixel dimensions, not canvas.width/height
    // (canvas.width is now physW = logW × dpr; dividing by dpr gives logW)
    if (this.player.alive) {
      const logW = this.canvas.width  / this._dpr;
      const logH = this.canvas.height / this._dpr;
      const targetX = this.player.head.x - logW / 2;
      const targetY = this.player.head.y - logH / 2;
      const camT = Math.min(1, 7 * dt);
      this.camX += (targetX - this.camX) * camT;
      this.camY += (targetY - this.camY) * camT;
    }

    // Danger zone audio
    if (this.player.alive) {
      const hx = this.player.head.x, hy = this.player.head.y;
      const W = this._worldW, H = this._worldH;
      const nearest = Math.min(hx, W - hx, hy, H - hy);
      const inDanger = nearest < DANGER_ZONE_DIST;
      if (inDanger && !this._inDangerZone)  { this._inDangerZone = true;  this.audio.startRun(); }
      if (!inDanger && this._inDangerZone)  { this._inDangerZone = false; this.audio.stopRun(); }

      // Screen shake near wall
      if (nearest < 80) this.shake.trigger(3, 0.1);
    }

    // Near snake audio
    if (this.player.alive) {
      const nearSq = NEAR_SNAKE_RADIUS * NEAR_SNAKE_RADIUS;
      let anyNear = false;
      for (let i = 1; i < this.snakes.length; i++) {
        if (!this.snakes[i].alive) continue;
        if (Vector2.distSq(this.player.head, this.snakes[i].head) < nearSq) { anyNear = true; break; }
      }
      if (anyNear) this.audio.playNearSnake();
    }

    // Magnet pull
    if (this.player.alive && this.player.magnetTimer > 0) {
      this.foodGrid.query(this.player.head.x, this.player.head.y, MAGNET_RADIUS, this._foodQueryBuf);
      for (const food of this._foodQueryBuf) {
        if (food.type !== FOOD_TYPE.NORMAL) continue;
        const dx = this.player.head.x - food.pos.x, dy = this.player.head.y - food.pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const strength = (1 - dist / MAGNET_RADIUS) * MAGNET_PULL_FORCE * dt;
        this.foodGrid.remove(food);
        food.pos.x += (dx / dist) * strength;
        food.pos.y += (dy / dist) * strength;
        this.foodGrid.add(food);
      }
    }

    // Mine collision check
    if (this.player.activeMines) {
      for (const mine of this.player.activeMines) {
        for (let i = 1; i < this.snakes.length; i++) {
          const ai = this.snakes[i];
          if (!ai.alive) continue;
          if (Vector2.dist(mine.pos, ai.head) < MINE_TRIGGER_R) {
            // Explosion
            mine.active = false;
            this.particles.burstAt(mine.pos.x, mine.pos.y, '#ff9f40', 30);
            this.shake.trigger(6, 0.25);
            this.audio.playKill();
            // Kill anything in radius
            for (let j = 1; j < this.snakes.length; j++) {
              const victim = this.snakes[j];
              if (!victim.alive) continue;
              if (Vector2.dist(mine.pos, victim.head) < MINE_KILL_R) {
                this._killSnake(victim, true);
              }
            }
            break;
          }
        }
      }
    }

    // Food TTL garbage collection
    {
      const toRemove = [];
      for (const food of this.foods) {
        if (food.ttl === null) continue;
        food.ttl -= dt;
        if (food.ttl <= 0) toRemove.push(food);
      }
      for (const food of toRemove) this._removeFood(food);
    }

    // Food collision
    const eaten = [];
    for (const snake of this.snakes) {
      if (!snake.alive) continue;
      const isPlayer = snake === this.player;
      const queryR   = isPlayer ? 40 : 30;
      this.foodGrid.query(snake.head.x, snake.head.y, queryR, this._foodQueryBuf);

      for (const food of this._foodQueryBuf) {
        const dsq  = Vector2.distSq(snake.head, food.pos);
        const rSum = getSegmentR(isPlayer) + food.radius;
        if (dsq >= rSum * rSum) continue;

        if (isPlayer) {
          if (food.type === FOOD_TYPE.MAGNET) {
            this.player.activateMagnet(); this.audio.playMagnet();
            eaten.push(food); this._spawnFood(FOOD_TYPE.NORMAL); continue;
          }
          if (food.type === FOOD_TYPE.ATTACK) {
            this.player.activateAttack();
            eaten.push(food); this._spawnFood(FOOD_TYPE.NORMAL); continue;
          }
          if (food.type === FOOD_TYPE.SHIELD) {
            this.player.activateShield(); this.audio.playMagnet();
            eaten.push(food); this._spawnFood(FOOD_TYPE.NORMAL); continue;
          }
          if (food.type === FOOD_TYPE.GHOST) {
            this.player.activateGhost(); this.audio.playMagnet();
            eaten.push(food); this._spawnFood(FOOD_TYPE.NORMAL); continue;
          }
          if (food.type === FOOD_TYPE.MINE) {
            this.player.activateMine(); this.audio.playMagnet();
            eaten.push(food); this._spawnFood(FOOD_TYPE.NORMAL); continue;
          }
          if (food.type === FOOD_TYPE.SPEED) {
            this.player.activateSpeedBoost(); this.audio.playMagnet();
            this.achievements.onSpeedBoost();
            eaten.push(food); this._spawnFood(FOOD_TYPE.NORMAL); continue;
          }
          if (food.type === FOOD_TYPE.LIFELINE) {
            if (this.player.lives < PLAYER_LIVES) {
              this.player.lives++;
              this._updateLivesHUD();
              this.audio.playLifeline();
              eaten.push(food);
            }
            continue;
          }
        }

        const comboMul = isPlayer ? this.combo.multiplier : 1;
        const mult = (1 + Math.floor(snake.length / 20)) * comboMul;
        snake.eat(mult);
        eaten.push(food);

        if (isPlayer) {
          this.audio.playEat();
          Profile.add('totalFoodEaten');
          this.achievements.onFood();
          this.combo.eat((count) => {
            this.combo.addFloat(this.player.head.x, this.player.head.y, count);
            if (count >= 10) this.achievements.onCombo10();
          });
        }
      }
    }

    for (const f of eaten) {
      this._removeFood(f);
      if (f.type === FOOD_TYPE.NORMAL) this._spawnFood();
    }

    // Wall collision
    const W = this._worldW, H = this._worldH;
    for (const snake of this.snakes) {
      if (!snake.alive) continue;
      const h = snake.head;
      if (h.x < 0 || h.x > W || h.y < 0 || h.y > H) {
        this._killSnake(snake);
        if (snake === this.player) this.shake.trigger(12, 0.4);
      }
    }

    // Snake vs snake
    this._checkSnakeCollisions();

    // Particles
    this.particles.update(dt);

    // Arena: check win condition
    if (this._mode === 'arena' && this.player.alive) {
      const aliveAI = this.snakes.filter(s => s !== this.player && s.alive);
      if (aliveAI.length === 0) {
        this._arenaVictory();
        return;
      }
    }

    // Respawn dead AI (not in arena mode — they stay dead)
    if (this._mode !== 'arena') {
      for (let i = 1; i < this.snakes.length; i++) {
        if (!this.snakes[i].alive) {
          const [body, head] = randomAIPalette();
          const x = 300 + Math.random() * (W - 600);
          const y = 300 + Math.random() * (H - 600);
          this.snakes[i] = new AISnake(x, y, body, head, this.foodGrid, this.snakes);
        }
      }
    }

    // Panic audio
    if (this._mode !== 'timetrial') {
      if (this.player.alive && this.player.lives === 1) this.audio.startPanic();
      else this.audio.stopPanic();
    }

    // HUD
    if (this.player.alive) {
      const pname = this.player.name || getPlayerName();
      if (this.hudNameScore) this.hudNameScore.textContent = `${pname}: ${this.player.score}`;
      if (this.hudLength) this.hudLength.textContent = `Length: ${this.player.length}`;
      if (this.hudBestScore) this.hudBestScore.textContent = `Best: ${HighScore.get()}`;
      this._updateLivesHUD();
    }

    // Playtime
    Profile.add('totalPlaytimeSeconds', dt);
  }

  _updateLivesHUD() {
    const lives = this.player.lives;
    this._heartEls.forEach((el, i) => {
      if (i < lives) el.classList.remove('lost');
      else           el.classList.add('lost');
    });
    // In time trial, hide hearts
    const hudLives = document.getElementById('hud-lives');
    if (hudLives) hudLives.style.visibility = this._mode === 'timetrial' ? 'hidden' : '';
  }

  _flashLifeLost() {
    document.body.classList.remove('life-lost-flash');
    void document.body.offsetWidth;
    document.body.classList.add('life-lost-flash');
  }

  _respawnPlayer() {
    const p = this.player;
    const W = this._worldW, H = this._worldH;
    const safeX = W / 2 + (Math.random() - 0.5) * 400;
    const safeY = H / 2 + (Math.random() - 0.5) * 400;
    p.segments = [];
    for (let i = 0; i < 12; i++) p.segments.push(new Vector2(safeX - i * SEGMENT_GAP, safeY));
    p.pos.x = safeX; p.pos.y = safeY;
    p.dir   = new Vector2(1, 0);
    p.alive = true;
    p._growBuffer = 0;
    p.magnetTimer = 0; p.attackTimer = 0; p.shieldTimer = 0;
    p.ghostTimer  = 0; p.mineTimer   = 0; p.speedBoostTimer = 0;
    p.iFrameTimer = IFRAME_DURATION;
    this.audio.playEat();
  }

  /* ── KILL SNAKE ─────────────────────────────────────────── */
  _killSnake(snake, triggeredByPlayer = false) {
    if (!snake.alive) return;

    if (snake === this.player) {
      if (this.player.invincible) {
        // Shield breaks
        if (this.player.shieldTimer > 0) {
          this.player.shieldTimer = 0;
          this.shake.trigger(4, 0.2);
        }
        return;
      }

      if (this._mode === 'timetrial') {
        snake.alive = false;
        this.particles.burst(snake.segments, snake.headColor);
        this.audio.playGameOver();
        this.shake.trigger(12, 0.4);
        this.achievements.onDeath();
        this._runGameOver();
        return;
      }

      this.player.lives--;
      this._updateLivesHUD();
      this._flashLifeLost();
      this.shake.trigger(12, 0.4);
      this.achievements.onDeath();
      Profile.add('totalDeaths');

      if (this.player.lives <= 0) {
        snake.alive = false;
        this.particles.burst(snake.segments, snake.headColor);
        this.audio.playGameOver();
        this._runGameOver();
      } else {
        this._respawnPlayer();
      }
      return;
    }

    // AI death
    snake.alive = false;
    this.particles.burst(snake.segments, snake.headColor);
    this.shake.trigger(6, 0.25);

    if (triggeredByPlayer) {
      this.audio.playKill();
      this._hitStopTimer = 0.08;
      this.killFeed.addKill(snake.name || 'Unknown');
      Profile.add('totalKills');
      this.achievements.onKill();
    } else {
      this.killFeed.addEliminated(snake.name || 'Unknown');
    }

    // Drop food from dead snake
    const W = this._worldW, H = this._worldH;
    for (let i = 0; i < snake.segments.length; i += 3) {
      const seg = snake.segments[i];
      if (seg.x > 10 && seg.x < W - 10 && seg.y > 10 && seg.y < H - 10) {
        const col = FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)];
        const ttl = 10 + Math.random() * 5;
        const f   = new Food(seg.x + (Math.random() - 0.5) * 10, seg.y + (Math.random() - 0.5) * 10, col, FOOD_TYPE.NORMAL, ttl);
        this.foods.push(f);
        this.foodGrid.add(f);
      }
    }
  }

  /* ── SNAKE VS SNAKE ─────────────────────────────────────── */
  _checkSnakeCollisions() {
    const segR    = getSegmentR(true);
    const KILL_DSQ = (segR * 1.8) * (segR * 1.8);
    const HEAD_DSQ = (segR * 2.8) * (segR * 2.8);

    const killSet     = new Set();
    const shatterList = [];
    const playerKillSet = new Set();

    const playerInAttack = this.player.alive && this.player.attackTimer > 0;

    const BUCKET_SIZE = 1100;
    const headBuckets = new Map();
    for (let a = 0; a < this.snakes.length; a++) {
      const sa = this.snakes[a];
      if (!sa.alive) continue;
      const bx = Math.floor(sa.head.x / BUCKET_SIZE);
      const by = Math.floor(sa.head.y / BUCKET_SIZE);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = `${bx + dx},${by + dy}`;
          if (!headBuckets.has(key)) headBuckets.set(key, []);
          headBuckets.get(key).push(a);
        }
      }
    }

    const checkedPairs = new Set();
    for (let a = 0; a < this.snakes.length; a++) {
      const sa = this.snakes[a];
      if (!sa.alive || killSet.has(sa)) continue;
      if (sa === this.player && this.player.invincible) continue;

      const bx = Math.floor(sa.head.x / BUCKET_SIZE);
      const by = Math.floor(sa.head.y / BUCKET_SIZE);
      const candidates = headBuckets.get(`${bx},${by}`) || [];

      for (const b of candidates) {
        if (a === b) continue;
        const pairKey = a < b ? `${a},${b}` : `${b},${a}`;
        if (checkedPairs.has(pairKey)) continue;
        checkedPairs.add(pairKey);

        const sb = this.snakes[b];
        if (!sb.alive || killSet.has(sb)) continue;

        const headDsq = Vector2.distSq(sa.head, sb.head);
        if (headDsq > 1000 * 1000) continue;

        if (headDsq <= HEAD_DSQ) {
          if (a < b) {
            const sizeDiff = sa.segments.length - sb.segments.length;
            if (sizeDiff > H2H_UPSET_THRESHOLD) {
              killSet.add(sb); if (sa === this.player) playerKillSet.add(sb);
            } else if (sizeDiff < -H2H_UPSET_THRESHOLD) {
              killSet.add(sa); if (sb === this.player) playerKillSet.add(sa);
            } else {
              killSet.add(sa); killSet.add(sb);
            }
          }
          continue;
        }

        // Head-vs-body (sa → sb)
        for (let s = 1; s < sb.segments.length; s++) {
          if (Vector2.distSq(sa.head, sb.segments[s]) >= KILL_DSQ) continue;
          // Ghost: skip body collision
          if (sa === this.player && this.player.isGhost) break;
          if (sa === this.player && playerInAttack && sb !== this.player) {
            shatterList.push({ snake: sb, fromIndex: s });
          } else if (sb === this.player && sa !== this.player && !this.player.invincible) {
            this.audio.playEnemyBite();
            killSet.add(sa);
          } else {
            killSet.add(sa);
          }
          break;
        }

        // Head-vs-body (sb → sa)
        for (let s = 1; s < sa.segments.length; s++) {
          if (Vector2.distSq(sb.head, sa.segments[s]) >= KILL_DSQ) continue;
          if (sb === this.player && this.player.isGhost) break;
          if (sb === this.player && playerInAttack && sa !== this.player) {
            shatterList.push({ snake: sa, fromIndex: s });
          } else if (sa === this.player && sb !== this.player && !this.player.invincible) {
            this.audio.playEnemyBite();
            killSet.add(sb);
          } else {
            killSet.add(sb);
          }
          break;
        }
      }
    }

    for (const s of killSet) this._killSnake(s, playerKillSet.has(s));

    const W = this._worldW, H = this._worldH;
    for (const { snake, fromIndex } of shatterList) {
      if (!snake.alive) continue;
      const MIN_SURVIVE = 5;
      if (fromIndex <= MIN_SURVIVE) {
        this._killSnake(snake, true); continue;
      }
      const severed = snake.segments.splice(fromIndex);
      this.particles.burst(severed, snake.headColor);
      this.audio.playKill();
      for (let i = 0; i < severed.length; i += 2) {
        const seg = severed[i];
        if (seg.x > 10 && seg.x < W - 10 && seg.y > 10 && seg.y < H - 10) {
          const col = FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)];
          const f = new Food(seg.x + (Math.random() - 0.5) * 8, seg.y + (Math.random() - 0.5) * 8, col, FOOD_TYPE.NORMAL, 10 + Math.random() * 5);
          this.foods.push(f);
          this.foodGrid.add(f);
        }
      }
    }
  }

  /* ── GAME OVER FLOW ─────────────────────────────────────── */
  _runGameOver() {
    this.running = false;
    this._inDangerZone = false;

    const score = this.player.score;
    const elapsed = (performance.now() - this._runStartTime) / 1000;

    // Persist
    const best = HighScore.save(score);
    const p = Profile.get();
    if (score > p.bestScore) { p.bestScore = score; Profile.save(); }

    if (DailyChallenge.isActive) DailyChallenge.saveBest(score);
    if (this._mode === 'timetrial') {
      const prevBest = parseInt(localStorage.getItem(TT_KEY) || '0', 10);
      if (score > prevBest) localStorage.setItem(TT_KEY, String(score));
      const profBest = Profile.get();
      if (score > profBest.bestScoreTimeTrial) { profBest.bestScoreTimeTrial = score; Profile.save(); }
    }

    this._showGameOverCinematic(() => {
      this.finalScore.textContent = score;
      const bestEl = document.getElementById('best-score-value');
      if (bestEl) bestEl.textContent = best;
      const bestDisplay = document.getElementById('best-score-display');
      if (bestDisplay) bestDisplay.style.display = 'block';
      this.scoreDisplay.style.display = 'block';
      this.overlay.classList.remove('hidden');
    });
  }

  _timeTrialEnd() {
    this.running = false;
    this._inDangerZone = false;
    this.audio.playGameOver();

    const score = this.player.score;
    const prevBest = parseInt(localStorage.getItem(TT_KEY) || '0', 10);
    if (score > prevBest) localStorage.setItem(TT_KEY, String(score));
    const p = Profile.get();
    if (score > p.bestScoreTimeTrial) { p.bestScoreTimeTrial = score; Profile.save(); }

    const titleEl = document.getElementById('overlay-title');
    if (titleEl) { titleEl.classList.remove('victory'); titleEl.textContent = `⏱ TIME'S UP!`; }

    this.finalScore.textContent = score;
    const bestEl = document.getElementById('best-score-value');
    if (bestEl) bestEl.textContent = prevBest > score ? prevBest : score;
    const bestDisplay = document.getElementById('best-score-display');
    if (bestDisplay) bestDisplay.style.display = 'block';
    this.scoreDisplay.style.display = 'block';
    this.overlay.classList.remove('hidden');
  }

  _arenaVictory() {
    this.running = false;
    const score = this.player.score;
    HighScore.save(score);
    this.achievements.onArenaWin();
    this._updateAchievementCount();

    const titleEl = document.getElementById('overlay-title');
    if (titleEl) { titleEl.textContent = '🏆 VICTORY!'; titleEl.classList.add('victory'); }

    this.finalScore.textContent = score;
    this.scoreDisplay.style.display = 'block';
    this.overlay.classList.remove('hidden');
    this.audio.stopBg();
  }

  /* ── DEATH CINEMATIC ────────────────────────────────────── */
  _showGameOverCinematic(onComplete) {
    this.audio.playGameOver();

    const canvas = this.canvas;
    const ctx    = this.ctx;
    let startTime = null;
    const DURATION = 1200; // ms

    const animate = (ts) => {
      if (!startTime) startTime = ts;
      const elapsed = ts - startTime;
      const t = Math.min(elapsed / DURATION, 1);

      // Logical dimensions for UI placement
      const logW = canvas.width  / this._dpr;
      const logH = canvas.height / this._dpr;

      // Redraw last frame (world) then overlay fade
      this._render();

      ctx.fillStyle = `rgba(0,0,0,${t * 0.85})`;
      ctx.fillRect(0, 0, logW, logH);

      if (t > 0.3) {
        const textAlpha = Math.min(1, (t - 0.3) / 0.4);
        const glitch    = Math.floor(elapsed / 60) % 2 === 0 ? (Math.random() - 0.5) * 16 : 0;
        ctx.save();
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        // Scale font relative to screen width so it's readable on all devices
        const fontSize = Math.max(36, Math.min(72, logW * 0.14));
        ctx.font         = `bold ${Math.round(fontSize)}px "Segoe UI", system-ui, sans-serif`;
        ctx.globalAlpha  = textAlpha;
        ctx.fillStyle    = '#ff2222';
        ctx.shadowColor  = '#ff0000';
        ctx.shadowBlur   = 30;
        ctx.fillText('GAME OVER', logW / 2 + glitch, logH / 2);
        ctx.restore();
      }

      if (elapsed < DURATION) {
        requestAnimationFrame(animate);
      } else {
        onComplete();
      }
    };

    requestAnimationFrame(animate);
  }

  /* ── RENDER ─────────────────────────────────────────────── */
  _render() {
    const { ctx, canvas } = this;
    // Logical (CSS) pixel dimensions — all draw calls use these because
    // ctx.setTransform(dpr,0,0,dpr,0,0) is in effect from _setupResize.
    const logW = canvas.width  / this._dpr;
    const logH = canvas.height / this._dpr;

    const shake = this.shake ? this.shake.getOffset() : { x: 0, y: 0 };

    ctx.save();
    ctx.translate(shake.x, shake.y);

    ctx.clearRect(-10, -10, logW + 20, logH + 20);

    this._drawBackground(logW, logH);
    this._drawWorldBorder();
    this._drawBiomes();

    if (this.player && this.player.alive && this.player.magnetTimer > 0) this._drawMagnetAura();

    ctx.save();
    for (const food of this.foods) food.draw(ctx, this.camX, this.camY);
    ctx.restore();

    // Draw mines
    if (this.player && this.player.activeMines) {
      for (const mine of this.player.activeMines) mine.draw(ctx, this.camX, this.camY);
    }

    for (const snake of this.snakes) snake.draw(ctx, this.camX, this.camY);

    this.particles.draw(ctx, this.camX, this.camY);

    if (this._mode === 'arena') this._drawArenaPulse(logW, logH);
    this._drawMinimap(logW, logH);
    if (this.player && this.player.alive) this._drawWallWarning(logW, logH);

    // Joystick
    if (this._joystick && this._joystick.active) this._drawJoystick(ctx);

    ctx.restore();

    // Canvas-space overlays (not shaken)
    this.killFeed.draw(ctx, logW);
    this.combo.draw(ctx, this.camX, this.camY);
    this.achievements.draw(ctx, logW, logH);
  }

  _drawJoystick(ctx) {
    const j = this._joystick;
    ctx.save();
    ctx.globalAlpha = 0.45;

    // Outer ring
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.arc(j.originX, j.originY, j.maxR, 0, Math.PI * 2);
    ctx.stroke();

    // Inner thumb
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(j.thumbX, j.thumbY, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _drawMagnetAura() {
    const { ctx } = this;
    const hx = this.player.head.x - this.camX, hy = this.player.head.y - this.camY;
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.004);
    ctx.save();
    ctx.strokeStyle = `rgba(0,200,255,${(0.12 + pulse * 0.12).toFixed(2)})`;
    ctx.lineWidth   = 2;
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -Date.now() * 0.05;
    ctx.shadowColor = '#00ccff'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(hx, hy, MAGNET_RADIUS, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  _drawBackground(logW, logH) {
    const { ctx } = this;
    ctx.fillStyle = '#050a0f';
    ctx.fillRect(-10, -10, logW + 20, logH + 20);

    const gridSpacing = 40;
    if (!this._bgTile ||
        this._bgTile.width  !== logW  + gridSpacing * 2 ||
        this._bgTile.height !== logH + gridSpacing * 2) {
      const tw = logW  + gridSpacing * 2;
      const th = logH + gridSpacing * 2;
      const oc  = new OffscreenCanvas(tw, th);
      const oc2 = oc.getContext('2d');
      oc2.fillStyle = 'rgba(80,140,200,0.11)';
      for (let x = 0; x < tw; x += gridSpacing) {
        for (let y = 0; y < th; y += gridSpacing) {
          oc2.beginPath(); oc2.arc(x, y, 1.2, 0, Math.PI * 2); oc2.fill();
        }
      }
      this._bgTile = oc;
    }

    const offX = (-(this.camX % gridSpacing) + gridSpacing) % gridSpacing;
    const offY = (-(this.camY % gridSpacing) + gridSpacing) % gridSpacing;
    ctx.drawImage(this._bgTile, offX - gridSpacing, offY - gridSpacing);
  }

  _drawBiomes() {
    const { ctx } = this;
    const W = this._worldW, H = this._worldH;
    const bw = W / 3, bh = H / 3;
    ctx.save();
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const biome = BIOMES[row * 3 + col];
        const wx = col * bw - this.camX;
        const wy = row * bh - this.camY;
        ctx.fillStyle = biome.color;
        ctx.fillRect(wx, wy, bw, bh);
      }
    }
    ctx.restore();
  }

  /* ── ANIMATED ELECTRIC FENCE BORDER ─────────────────────── */
  _drawWorldBorder() {
    const { ctx } = this;
    const W = this._worldW, H = this._worldH;
    const x = -this.camX, y = -this.camY;
    const now = Date.now();

    // Danger proximity
    let isRed = false;
    if (this.player && this.player.alive) {
      const hx = this.player.head.x, hy = this.player.head.y;
      isRed = Math.min(hx, W - hx, hy, H - hy) < 200;
    }

    ctx.save();

    const DASH_COUNT = 200;
    // Draw dashes along each edge
    const edges = [
      { x1: 0, y1: 0, x2: W, y2: 0 },
      { x1: W, y1: 0, x2: W, y2: H },
      { x1: W, y1: H, x2: 0, y2: H },
      { x1: 0, y1: H, x2: 0, y2: 0 },
    ];

    for (const edge of edges) {
      const len = Math.sqrt((edge.x2 - edge.x1) ** 2 + (edge.y2 - edge.y1) ** 2);
      const dashCount = Math.round(DASH_COUNT * (len / (W * 2 + H * 2)));
      const nx = (edge.x2 - edge.x1) / len;
      const ny = (edge.y2 - edge.y1) / len;

      for (let i = 0; i < dashCount; i++) {
        const t = i / dashCount;
        const px = edge.x1 + nx * len * t;
        const py = edge.y1 + ny * len * t;
        const brightness = 0.5 + 0.5 * Math.sin(now * 0.005 + i * 0.3);

        if (isRed) {
          const flash = 0.5 + 0.5 * Math.sin(now * 0.008);
          ctx.strokeStyle = `rgba(255,${Math.round(50 * flash)},${Math.round(50 * flash)},${(0.5 + brightness * 0.5).toFixed(2)})`;
          ctx.shadowColor = `rgba(255,50,50,0.8)`;
        } else {
          ctx.strokeStyle = `rgba(126,255,178,${(0.2 + brightness * 0.6).toFixed(2)})`;
          ctx.shadowColor = '#7effb2';
        }
        ctx.shadowBlur = 12 + brightness * 8;
        ctx.lineWidth  = 2 + brightness;

        const dashLen = 8;
        ctx.beginPath();
        ctx.moveTo(x + px - nx * dashLen / 2, y + py - ny * dashLen / 2);
        ctx.lineTo(x + px + nx * dashLen / 2, y + py + ny * dashLen / 2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  _drawArenaPulse(logW, logH) {
    const { ctx } = this;
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.003);
    const alpha = pulse * 0.08;
    ctx.save();
    ctx.fillStyle = `rgba(255,40,40,${alpha.toFixed(3)})`;
    ctx.fillRect(0, 0, logW, logH);
    ctx.restore();
  }

  _drawWallWarning(logW, logH) {
    const { ctx } = this;
    if (!this.player.alive) return;
    const W = this._worldW, H = this._worldH;
    const hx = this.player.head.x, hy = this.player.head.y;
    const nearest = Math.min(hx, W - hx, hy, H - hy);
    if (nearest >= DANGER_ZONE_DIST) return;

    const intensity = (1 - nearest / DANGER_ZONE_DIST) * 0.5;
    const grad = ctx.createRadialGradient(
      logW / 2, logH / 2, logH * 0.3,
      logW / 2, logH / 2, logH * 0.8
    );
    grad.addColorStop(0, 'rgba(255,40,40,0)');
    grad.addColorStop(1, `rgba(255,40,40,${intensity.toFixed(2)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, logW, logH);
  }

  _drawMinimap(logW, logH) {
    const { ctx } = this;

    // ── Responsive minimap sizing ─────────────────────────────
    // On narrow portrait phones (< 480px wide) shrink the minimap so it
    // cannot collide with the HUD pill or overflow the right edge.
    const isNarrow   = logW < 480;
    const MAP_W      = isNarrow ? 110 : 150;
    const MAP_H      = isNarrow ? 110 : 150;
    // Keep minimap clear of the safe-area right edge
    const safeRight  = 0; // canvas ctx is already in logical coords; CSS safe-area handled by body padding
    const MAP_PAD    = isNarrow ? 8 : 14;
    const MAP_X      = logW - MAP_W - MAP_PAD;
    // Top: push below safe-area inset + HUD height headroom
    // HUD sits at ~max(10px, safeTop+6px) + ~30px height = ~50px worst case
    const HUD_CLEARANCE = isNarrow ? 52 : 14;
    const MAP_Y      = HUD_CLEARANCE + MAP_PAD;

    const W = this._worldW, H = this._worldH;
    const SCALE_X = MAP_W / W, SCALE_Y = MAP_H / H;

    ctx.save();
    ctx.fillStyle   = 'rgba(5,10,15,0.7)';
    ctx.strokeStyle = 'rgba(126,255,178,0.25)';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.roundRect(MAP_X, MAP_Y, MAP_W, MAP_H, 6); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(MAP_X, MAP_Y, MAP_W, MAP_H, 6); ctx.clip();

    ctx.fillStyle = 'rgba(126,255,178,0.3)';
    for (const f of this.foods) {
      if (f.expired) continue;
      ctx.fillRect(MAP_X + f.pos.x * SCALE_X - 0.5, MAP_Y + f.pos.y * SCALE_Y - 0.5, 1.5, 1.5);
    }

    for (let i = 1; i < this.snakes.length; i++) {
      const s = this.snakes[i];
      if (!s.alive) continue;
      ctx.fillStyle = s.headColor;
      ctx.beginPath();
      ctx.arc(MAP_X + s.head.x * SCALE_X, MAP_Y + s.head.y * SCALE_Y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (this.player && this.player.alive) {
      ctx.fillStyle = '#7effb2'; ctx.shadowColor = '#7effb2'; ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(MAP_X + this.player.head.x * SCALE_X, MAP_Y + this.player.head.y * SCALE_Y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur  = 0; ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
      ctx.strokeRect(
        MAP_X + this.camX * SCALE_X,
        MAP_Y + this.camY * SCALE_Y,
        logW * SCALE_X,
        logH * SCALE_Y
      );
    }

    ctx.restore();
  }
}

/* ─────────────────────────────────────────────────────────────
   BOOT
───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => { new Game(); });
