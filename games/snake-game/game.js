/**
 * ═══════════════════════════════════════════════════════════════
 *  SNAKE RUSH — game.js  (Phase 3: Settings + Audio + Visual)
 *  Vanilla JS + HTML5 Canvas. No dependencies.
 *
 *  NEW IN THIS VERSION:
 *   ✓ Branding  — "Slither" → "Snake Rush" throughout
 *   ✓ Settings  — mute, sensitivity slider, snake design picker
 *   ✓ AudioManager expanded — magnet, run, enemybite, nearsnake,
 *                             kill, lifeline sounds
 *   ✓ Proximity warning — nearsnake.mp3 when enemy <100px from head
 *   ✓ Danger zone audio — run.mp3 while near map boundary
 *   ✓ Snake designs      — Multicolour / Fatty / Thin / Designer
 *
 *  Architecture (unchanged):
 *    Vector2 · Snake · PlayerSnake · AISnake
 *    Food · SpatialGrid · ParticlePool · Game
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

/* ─────────────────────────────────────────────────────────────
   SETTINGS STORE
   Single source of truth for all user-configurable options.
   Values are kept in memory (no localStorage — reset on refresh,
   as requested). The Settings object is populated before Game()
   is created, so Game can read it on construction.
───────────────────────────────────────────────────────────── */
const Settings = {
  muted:       false,
  sensitivity: 8,       // lerp factor (1–20 → mapped to 0.01–0.22)
  design:      'multicolour',  // 'multicolour' | 'fatty' | 'thin' | 'designer'
};

/* ─────────────────────────────────────────────────────────────
   HIGH SCORE — persisted to localStorage
───────────────────────────────────────────────────────────── */
const HS_KEY = 'snakeRush_bestScore';
const HighScore = {
  get()  { return parseInt(localStorage.getItem(HS_KEY) || '0', 10); },
  save(n) {
    if (n > this.get()) localStorage.setItem(HS_KEY, String(n));
  },
};

/* ─────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────── */
const WORLD_W       = 3000;
const WORLD_H       = 3000;
const FOOD_COUNT    = 320;
const AI_COUNT      = 10;
const SEGMENT_GAP   = 8;
const SEGMENT_R_BASE = 9;   // default visual radius; resized by design
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
const POWERUP_SPAWN_RATE     = 0.004;
const LIFELINE_SPAWN_RATE    = 0.002;   // rarer than magnet/attack
const LIFELINE_MAX_ON_MAP    = 1;       // at most 1 lifeline active at once

/* Audio proximity trigger */
const NEAR_SNAKE_RADIUS  = 100;  // px — triggers nearsnake.mp3
const DANGER_ZONE_DIST   = 250;  // px from wall — triggers run.mp3

/* Designer palette — cycles through these body/head pairs */
const DESIGNER_PALETTES = [
  ['#a855f7', '#d8b4fe'],   // violet
  ['#f97316', '#fdba74'],   // orange
  ['#06b6d4', '#67e8f9'],   // cyan
  ['#ec4899', '#f9a8d4'],   // pink
  ['#84cc16', '#bef264'],   // lime
];

/* Multicolour segment cycle */
const MULTICOLOUR_PALETTE = [
  '#ff5e57','#ffa41b','#ffdd00','#7bff6a',
  '#00d2ff','#8c52ff','#ff52c0','#52ffca',
];

/* ─────────────────────────────────────────────────────────────
   1. VECTOR2
───────────────────────────────────────────────────────────── */
class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }

  add(v)     { return new Vector2(this.x + v.x, this.y + v.y); }
  sub(v)     { return new Vector2(this.x - v.x, this.y - v.y); }
  scale(s)   { return new Vector2(this.x * s,   this.y * s);   }
  dot(v)     { return this.x * v.x + this.y * v.y;             }
  lengthSq() { return this.x * this.x + this.y * this.y;       }
  length()   { return Math.sqrt(this.lengthSq());               }

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
   1b. AUDIO MANAGER — expanded for Snake Rush
   Tracks:
     bg        — looping background music
     eat       — player eats normal food
     panic     — last-life warning (looping)
     gameover  — game over sting
     magnet    — magnet power-up collected        [NEW]
     run       — near map boundary (looping)       [NEW]
     enemybite — enemy head hits player body       [NEW]
     nearsnake — enemy within NEAR_SNAKE_RADIUS   [NEW]
     kill      — player kills an enemy snake       [NEW]
     lifeline  — player uses / respawns lifeline  [NEW]
───────────────────────────────────────────────────────────── */
class AudioManager {
  constructor() {
    this._ctx        = null;
    this._buffers    = {};
    this._bgNode     = null;
    this._panicNode  = null;
    this._runNode    = null;     // looping danger-zone track
    this._ready      = false;
    this._bgPlaying  = false;
    this._panicOn    = false;
    this._runOn      = false;

    // Cooldown timers — prevent spamming one-shot SFX
    this._nearCooldown   = 0;  // nearsnake.mp3 cooldown (seconds)
    this._biteCooldown   = 0;  // enemybite.mp3 cooldown

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
      window.removeEventListener('click',      unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('click',      unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
  }

  async _init() {
    if (this._ctx) return;
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      await Promise.all(
        Object.entries(this._tracks).map(([name, url]) => this._load(name, url))
      );
      this._ready = true;
      this.playBg();
    } catch (e) {
      console.warn('[AudioManager] init failed:', e);
    }
  }

  async _load(name, url) {
    try {
      const resp = await fetch(url);
      const arr  = await resp.arrayBuffer();
      this._buffers[name] = await this._ctx.decodeAudioData(arr);
    } catch (e) {
      console.warn(`[AudioManager] failed to load ${name}:`, e);
    }
  }

  /* Returns false if muted or not ready — used to skip playback */
  get _canPlay() {
    return this._ready && !Settings.muted;
  }

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

  /* ── Public API ─────────────────────────────────────────── */

  playBg() {
    if (!this._canPlay || this._bgPlaying) return;
    this._bgNode    = this._play('bg', true, 0.35);
    this._bgPlaying = !!this._bgNode;
  }

  stopBg() {
    if (this._bgNode) { try { this._bgNode.stop(); } catch(_) {} }
    this._bgNode    = null;
    this._bgPlaying = false;
  }

  playEat()      { this._play('eat',      false, 0.7); }

  /**
   * Play magnet SFX and auto-stop after 4 s.
   * We schedule a stop() on the returned source node so the long
   * audio file is trimmed to 4 s without cutting off abruptly.
   */
  playMagnet() {
    const node = this._play('magnet', false, 0.8);
    if (node) {
      try { node.stop(this._ctx.currentTime + 4); } catch (_) {}
    }
  }

  playKill() { this._play('kill', false, 0.9); }

  /**
   * Play lifeline SFX and auto-stop after 4 s.
   * Same trimming approach as playMagnet.
   */
  playLifeline() {
    const node = this._play('lifeline', false, 0.85);
    if (node) {
      try { node.stop(this._ctx.currentTime + 4); } catch (_) {}
    }
  }

  playEnemyBite(dt) {
    this._biteCooldown -= dt || 0;
    if (this._biteCooldown > 0) return;
    this._play('enemybite', false, 0.9);
    this._biteCooldown = 0.8;   // 0.8 s cooldown
  }

  playNearSnake(dt) {
    this._nearCooldown -= dt || 0;
    if (this._nearCooldown > 0) return;
    this._play('nearsnake', false, 0.6);
    this._nearCooldown = 1.5;   // 1.5 s cooldown — not too frequent
  }

  playGameOver() {
    this.stopBg();
    this.stopPanic();
    this.stopRun();
    this._play('gameover', false, 0.9);
  }

  startPanic() {
    if (this._panicOn) return;
    this._panicNode = this._play('panic', true, 0.55);
    this._panicOn   = !!this._panicNode;
  }

  stopPanic() {
    if (this._panicNode) { try { this._panicNode.stop(); } catch(_) {} }
    this._panicNode = null;
    this._panicOn   = false;
  }

  /** Looping danger-zone track — plays while near walls */
  startRun() {
    if (this._runOn) return;
    this._runNode = this._play('run', true, 0.5);
    this._runOn   = !!this._runNode;
  }

  stopRun() {
    if (this._runNode) { try { this._runNode.stop(); } catch(_) {} }
    this._runNode = null;
    this._runOn   = false;
  }

  /**
   * Tick cooldown timers — call every frame with dt so
   * one-shot SFX cooldows drain even when no event fires.
   */
  tickCooldowns(dt) {
    if (this._biteCooldown > 0) this._biteCooldown = Math.max(0, this._biteCooldown - dt);
    if (this._nearCooldown > 0) this._nearCooldown = Math.max(0, this._nearCooldown - dt);
  }

  /** Handle mute toggling mid-game: stop looping tracks if now muted */
  applyMuteSetting() {
    if (Settings.muted) {
      this.stopBg();
      this.stopPanic();
      this.stopRun();
    } else {
      // Re-start ambient tracks that should be playing
      this.playBg();
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
    const cx = Math.min(Math.floor(x / this.cellSize), this.cols - 1);
    const cy = Math.min(Math.floor(y / this.cellSize), this.rows - 1);
    return cy * this.cols + cx;
  }

  add(item)    { this.cells[this._idx(item.pos.x, item.pos.y)].add(item);    }
  remove(item) { this.cells[this._idx(item.pos.x, item.pos.y)].delete(item); }

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
  LIFELINE: 'lifeline',   // replenishes one lost life
});

class Food {
  constructor(x, y, color, type = FOOD_TYPE.NORMAL, ttl = null) {
    this.pos    = new Vector2(x, y);
    this.type   = type;
    this.radius = type === FOOD_TYPE.NORMAL ? 6 : 9;
    this.phase  = Math.random() * Math.PI * 2;

    // TTL (seconds). null = permanent (power-ups & initial map food).
    // Dead-snake remains get a 10-15 s TTL to prevent map clutter.
    this.ttl    = ttl;

    if      (type === FOOD_TYPE.MAGNET)   this.color = '#00ccff';
    else if (type === FOOD_TYPE.ATTACK)   this.color = '#ff3f3f';
    else if (type === FOOD_TYPE.LIFELINE) this.color = '#ff5f9e';
    else                                  this.color = color;
  }

  /** True when this food particle has outlived its TTL */
  get expired() { return this.ttl !== null && this.ttl <= 0; }

  draw(ctx, camX, camY) {
    if (this.expired) return;
    const sx = this.pos.x - camX;
    const sy = this.pos.y - camY;

    if (sx < -24 || sx > ctx.canvas.width  + 24 ||
        sy < -24 || sy > ctx.canvas.height + 24) return;

    const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.003 + this.phase);
    const r     = this.radius + pulse * 2;

    // Fade out during last 3 seconds of TTL
    let alpha = 1;
    if (this.ttl !== null && this.ttl < 3) {
      alpha = Math.max(0, this.ttl / 3);
    }
    ctx.globalAlpha = alpha;

    if (this.type === FOOD_TYPE.NORMAL) {
      ctx.shadowColor = this.color;
      ctx.shadowBlur  = 8 + pulse * 6;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = this.color;
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(sx, sy, r * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fill();

    } else if (this.type === FOOD_TYPE.MAGNET) {
      const spin = Date.now() * 0.003;
      ctx.shadowColor = '#00ccff';
      ctx.shadowBlur  = 18 + pulse * 10;

      ctx.beginPath();
      ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,200,255,0.4)';
      ctx.lineWidth   = 2;
      ctx.stroke();

      for (let i = 0; i < 6; i++) {
        const a  = spin + (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(sx + Math.cos(a) * (r + 5), sy + Math.sin(a) * (r + 5), 2, 0, Math.PI * 2);
        ctx.fillStyle = '#52ddff';
        ctx.fill();
      }

      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#00ccff';
      ctx.fill();

      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, r * 0.5, Math.PI, 0, false);
      ctx.stroke();

    } else if (this.type === FOOD_TYPE.ATTACK) {
      ctx.shadowColor = '#ff3f3f';
      ctx.shadowBlur  = 18 + pulse * 12;

      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ff3f3f';
      ctx.fill();

      ctx.shadowBlur  = 0;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 2.5;
      ctx.lineCap     = 'round';

      ctx.beginPath();
      ctx.moveTo(sx, sy - r * 0.7);
      ctx.lineTo(sx, sy + r * 0.4);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(sx - r * 0.45, sy + r * 0.1);
      ctx.lineTo(sx + r * 0.45, sy + r * 0.1);
      ctx.stroke();

      ctx.lineCap = 'butt';

    } else if (this.type === FOOD_TYPE.LIFELINE) {
      // Pulsing pink heart-glow orb with a ❤ symbol
      ctx.shadowColor = '#ff5f9e';
      ctx.shadowBlur  = 20 + pulse * 12;

      // Outer ring
      ctx.beginPath();
      ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,95,158,0.4)';
      ctx.lineWidth   = 2;
      ctx.stroke();

      // Body
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ff5f9e';
      ctx.fill();

      // Heart icon via text
      ctx.shadowBlur  = 0;
      ctx.fillStyle   = '#fff';
      ctx.font        = `bold ${Math.round(r * 1.3)}px sans-serif`;
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('♥', sx, sy + 1);
      ctx.textAlign    = 'start';
      ctx.textBaseline = 'alphabetic';
    }

    ctx.globalAlpha = 1;  // always restore after drawing
  }
}

/* ─────────────────────────────────────────────────────────────
   4. PARTICLE POOL
───────────────────────────────────────────────────────────── */
const MAX_PARTICLES = 400;

class ParticlePool {
  constructor() {
    this._pool = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this._pool.push({
        active: false,
        x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 0,
        radius: 0, color: '#fff',
      });
    }
  }

  burst(segments, color) {
    for (let i = 0; i < segments.length; i += 4) {
      const seg = segments[i];
      const p   = this._getFree();
      if (!p) break;
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 120;
      p.active  = true;
      p.x       = seg.x;
      p.y       = seg.y;
      p.vx      = Math.cos(angle) * speed;
      p.vy      = Math.sin(angle) * speed;
      p.life    = 0;
      p.maxLife = 0.6 + Math.random() * 0.5;
      p.radius  = 2 + Math.random() * 4;
      p.color   = color;
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
      p.vx *= (1 - dt * 3);
      p.vy *= (1 - dt * 3);
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
    }
  }

  draw(ctx, camX, camY) {
    for (const p of this._pool) {
      if (!p.active) continue;
      const sx = p.x - camX;
      const sy = p.y - camY;
      if (sx < -20 || sx > ctx.canvas.width  + 20 ||
          sy < -20 || sy > ctx.canvas.height + 20) continue;
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
   Design-aware rendering:
     • Multicolour — each segment cycles through MULTICOLOUR_PALETTE
     • Fatty       — SEGMENT_R_BASE × 1.45
     • Thin        — SEGMENT_R_BASE × 0.6
     • Designer    — custom palette, cycles every DESIGNER_CYCLE ms
   The effective segment radius is accessed via segmentR getter
   and driven by the global Settings.design.
───────────────────────────────────────────────────────────── */

/** Returns visual segment radius. Pass isPlayer=true to honour Settings.design. */
function getSegmentR(isPlayer = false) {
  if (!isPlayer) return SEGMENT_R_BASE;
  switch (Settings.design) {
    case 'fatty':  return Math.round(SEGMENT_R_BASE * 1.45);
    case 'thin':   return Math.round(SEGMENT_R_BASE * 0.60);
    default:       return SEGMENT_R_BASE;
  }
}

/** Designer palette index — cycles every 4 seconds */
let _designerPaletteIdx = 0;
let _designerTimer      = 0;
const DESIGNER_CYCLE    = 4;   // seconds per palette

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
    this.isPlayer  = isPlayer;  // drives design-aware rendering

    this.segments = [];
    for (let i = 0; i < initLen; i++) {
      this.segments.push(new Vector2(x - i * SEGMENT_GAP, y));
    }

    this._growBuffer = 0;
    this._tmpVec     = new Vector2(0, 0);
  }

  get length() { return this.segments.length; }
  get head()   { return this.segments[0]; }

  _applyDirection(dt) {
    const head = this.segments[0];
    head.x += this.dir.x * this.speed * dt;
    head.y += this.dir.y * this.speed * dt;
    this.pos.x = head.x;
    this.pos.y = head.y;
  }

  _moveSegments() {
    const gapSq = SEGMENT_GAP * SEGMENT_GAP;
    for (let i = 1; i < this.segments.length; i++) {
      const seg  = this.segments[i];
      const prev = this.segments[i - 1];
      const dx   = prev.x - seg.x;
      const dy   = prev.y - seg.y;
      const dSq  = dx * dx + dy * dy;
      if (dSq <= gapSq) continue;
      const dist = Math.sqrt(dSq);
      const t    = (dist - SEGMENT_GAP) / dist;
      seg.x += dx * t;
      seg.y += dy * t;
    }
  }

  eat(points = 1) {
    this._growBuffer += 4;
    this.score += points;
  }

  _grow() {
    if (this._growBuffer <= 0) return;
    this._growBuffer--;
    const segs = this.segments;
    const tail = segs[segs.length - 1];
    if (segs.length >= 2) {
      const prev = segs[segs.length - 2];
      const dx   = tail.x - prev.x;
      const dy   = tail.y - prev.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      segs.push(new Vector2(
        tail.x + (dx / dist) * SEGMENT_GAP,
        tail.y + (dy / dist) * SEGMENT_GAP,
      ));
    } else {
      segs.push(new Vector2(tail.x, tail.y));
    }
  }

  _calcSpeed(baseSpeed) {
    const len = this.segments.length;
    const t   = Math.max(0, Math.min(1,
      (len - SPEED_SCALE_MIN) / (SPEED_SCALE_MAX - SPEED_SCALE_MIN)
    ));
    const mul = SPEED_SMALL_MUL + (SPEED_LARGE_MUL - SPEED_SMALL_MUL) * t;
    return baseSpeed * mul;
  }

  shrink(count) {
    const minLen = 5;
    const remove = Math.min(count, this.segments.length - minLen);
    if (remove > 0) this.segments.splice(this.segments.length - remove, remove);
  }

  /**
   * RENDER — design-aware.
   *
   * Multicolour: each segment gets a colour from the cycle palette.
   * Fatty / Thin: segmentR reads from getSegmentR(), adjusting all
   *   hit tests and visual sizes simultaneously.
   * Designer: body + head colour overridden by current palette entry.
   */
  draw(ctx, camX, camY) {
    if (!this.alive) return;

    // ── I-frame flicker ───────────────────────────────────
    if (this.iFrameTimer !== undefined && this.iFrameTimer > 0) {
      if (Math.floor(Date.now() / 62) % 2 === 0) return;
    }

    const segR = getSegmentR(this.isPlayer);
    const segs = this.segments;
    const len  = segs.length;

    // ── Design: resolve colors ────────────────────────────
    const inAttack  = this.attackTimer !== undefined && this.attackTimer > 0;
    let bodyFill  = inAttack ? '#8b1a1a' : this._resolveBodyColor();
    let headFill  = inAttack ? '#ff2222' : this._resolveHeadColor();
    const glowColor = inAttack ? '#ff2222' : headFill;

    // Only the player snake gets multicolour treatment
    const isMulticolour = this.isPlayer && Settings.design === 'multicolour' && !inAttack;

    // ── 1. Body segments ──────────────────────────────────
    if (isMulticolour) {
      // Draw each segment individually to cycle colour.
      // Still use a single arc per segment for performance.
      for (let i = len - 1; i >= 1; i--) {
        const sx = segs[i].x - camX;
        const sy = segs[i].y - camY;
        if (sx < -segR * 2 || sx > ctx.canvas.width  + segR * 2 ||
            sy < -segR * 2 || sy > ctx.canvas.height + segR * 2) continue;
        ctx.beginPath();
        ctx.arc(sx, sy, segR, 0, Math.PI * 2);
        ctx.fillStyle = MULTICOLOUR_PALETTE[i % MULTICOLOUR_PALETTE.length];
        ctx.fill();
      }
    } else {
      // Single path — fast
      ctx.beginPath();
      for (let i = len - 1; i >= 1; i--) {
        const sx = segs[i].x - camX;
        const sy = segs[i].y - camY;
        if (sx < -segR * 2 || sx > ctx.canvas.width  + segR * 2 ||
            sy < -segR * 2 || sy > ctx.canvas.height + segR * 2) continue;
        ctx.moveTo(sx + segR, sy);
        ctx.arc(sx, sy, segR, 0, Math.PI * 2);
      }
      ctx.fillStyle = bodyFill;
      ctx.fill();
    }

    // ── 2. Head ───────────────────────────────────────────
    const hx = segs[0].x - camX;
    const hy = segs[0].y - camY;

    ctx.save();
    ctx.shadowColor = glowColor;
    ctx.shadowBlur  = inAttack ? 28 : 16;
    ctx.beginPath();
    ctx.arc(hx, hy, segR * 1.35, 0, Math.PI * 2);
    ctx.fillStyle = headFill;
    ctx.fill();
    ctx.restore();

    // Attack outer ring
    if (inAttack) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.01);
      ctx.save();
      ctx.strokeStyle = `rgba(255,50,50,${(0.4 + pulse * 0.4).toFixed(2)})`;
      ctx.lineWidth   = 3;
      ctx.shadowColor = '#ff2222';
      ctx.shadowBlur  = 14;
      ctx.beginPath();
      ctx.arc(hx, hy, segR * 1.9 + pulse * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ── 3. Eyes ───────────────────────────────────────────
    this._drawEyes(ctx, hx, hy, segR);
  }

  /** Resolve body color — designer palette only applies to the player */
  _resolveBodyColor() {
    if (this.isPlayer && Settings.design === 'designer') {
      return DESIGNER_PALETTES[_designerPaletteIdx][0];
    }
    return this.bodyColor;
  }

  /** Resolve head color — designer palette only applies to the player */
  _resolveHeadColor() {
    if (this.isPlayer && Settings.design === 'designer') {
      return DESIGNER_PALETTES[_designerPaletteIdx][1];
    }
    return this.headColor;
  }

  _drawEyes(ctx, hx, hy, segR = SEGMENT_R_BASE) {
    const eyeOff  = segR * 0.55;
    const fwdDist = segR * 0.4;
    const perpX = -this.dir.y * eyeOff;
    const perpY =  this.dir.x * eyeOff;
    const fwdX  = this.dir.x * fwdDist;
    const fwdY  = this.dir.y * fwdDist;

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(hx + fwdX + perpX, hy + fwdY + perpY, 3.2, 0, Math.PI * 2);
    ctx.arc(hx + fwdX - perpX, hy + fwdY - perpY, 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(hx + fwdX + perpX + this.dir.x * 1.2,
            hy + fwdY + perpY + this.dir.y * 1.2, 1.6, 0, Math.PI * 2);
    ctx.arc(hx + fwdX - perpX + this.dir.x * 1.2,
            hy + fwdY - perpY + this.dir.y * 1.2, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ─────────────────────────────────────────────────────────────
   6. PLAYER SNAKE
───────────────────────────────────────────────────────────── */
class PlayerSnake extends Snake {
  constructor(x, y) {
    super(x, y, '#2dd87a', '#7effb2', 12, /* isPlayer */ true);
    this.pointer        = new Vector2(0, 0);
    this.boosting       = false;
    this._boostDrainAcc = 0;

    this.lives       = PLAYER_LIVES;
    this.iFrameTimer = 0;
    this.magnetTimer = 0;
    this.attackTimer = 0;
  }

  update(dt, camX, camY) {
    if (!this.alive) return;

    if (this.iFrameTimer  > 0) this.iFrameTimer  = Math.max(0, this.iFrameTimer  - dt);
    if (this.magnetTimer  > 0) this.magnetTimer  = Math.max(0, this.magnetTimer  - dt);
    if (this.attackTimer  > 0) this.attackTimer  = Math.max(0, this.attackTimer  - dt);

    const scaledBase  = this._calcSpeed(BASE_SPEED);
    const scaledBoost = this._calcSpeed(BOOST_SPEED);
    this.speed = (this.boosting && this.segments.length > 6)
      ? scaledBoost : scaledBase;

    if (this.boosting && this.segments.length > 6) {
      this._boostDrainAcc += BOOST_DRAIN * dt;
      const toRemove = Math.floor(this._boostDrainAcc);
      if (toRemove > 0) {
        this.shrink(toRemove);
        this._boostDrainAcc -= toRemove;
      }
    } else {
      this._boostDrainAcc = 0;
    }

    // ── Sensitivity-driven steering ───────────────────────
    // Settings.sensitivity (1–20) → lerp factor (0.01–0.22)
    const sens = Settings.sensitivity;
    const lerpBase = 0.01 + (sens / 20) * 0.21;   // linear map

    const worldX = this.pointer.x + camX;
    const worldY = this.pointer.y + camY;
    const dx     = worldX - this.head.x;
    const dy     = worldY - this.head.y;
    const dSq    = dx * dx + dy * dy;

    if (dSq > 100) {
      const dist    = Math.sqrt(dSq);
      const desired = new Vector2(dx / dist, dy / dist);
      const lerpT   = Math.min(1, lerpBase * dt * 60);
      this.dir = this.dir.lerp(desired, lerpT).normalize();
    }

    this._applyDirection(dt);
    this._moveSegments();
    this._grow();
  }

  activateMagnet() { this.magnetTimer = MAGNET_DURATION; }
  activateAttack() { this.attackTimer = ATTACK_DURATION; }

  get invincible() { return this.iFrameTimer > 0; }
}

/* ─────────────────────────────────────────────────────────────
   7. AI SNAKE
───────────────────────────────────────────────────────────── */
const AI_STATE = Object.freeze({
  WANDER:    'WANDER',
  SEEK_FOOD: 'SEEK_FOOD',
  AVOID:     'AVOID',
  FLEE:      'FLEE',
  PURSUE:    'PURSUE',
});

const HYSTERESIS = {
  PURSUE:    { enter: 0.25, exit: 0.40 },
  FLEE:      { enter: 0.15, exit: 0.50 },
  AVOID:     { enter: 0.05, exit: 0.20 },
  SEEK_FOOD: { enter: 0.0,  exit: 0.10 },
};

class AISnake extends Snake {
  constructor(x, y, bodyColor, headColor, foodGrid, snakes) {
    super(x, y, bodyColor, headColor, 8);

    this.foodGrid = foodGrid;
    this.snakes   = snakes;

    this.state = AI_STATE.WANDER;

    this._wanderAngle  = Math.random() * Math.PI * 2;
    this._wanderDist   = 55;
    this._wanderRadius = 30;
    this._wanderJitter = 1.2;

    this.FOOD_RADIUS      = 180;
    this.SNAKE_SENSE_R    = 220;
    this.BODY_SENSE_R     = 90;
    this.LOOKAHEAD_STEPS  = 3;
    this.LOOKAHEAD_DIST   = 30;

    this.MAX_FORCE  = 0.12;
    this.STEER_LERP = 6.0;

    this._hyst = {
      PURSUE:    0,
      FLEE:      0,
      AVOID:     0,
      SEEK_FOOD: 0,
    };

    this._fleeTarget   = null;
    this._pursueTarget = null;
    this._avoidNormal  = null;

    this._nearby       = [];
    this._nearbySnakes = [];
  }

  update(dt) {
    if (!this.alive) return;

    const { nearbyFood, fleeTarget, pursueTarget, avoidNormal }
      = this._sense(dt);

    this.state = this._evalFSM(dt, nearbyFood, fleeTarget, pursueTarget, avoidNormal);

    let force = this._computeForce(dt, nearbyFood, fleeTarget, pursueTarget, avoidNormal);

    const wallForce = this._wallAvoidForce();
    if (wallForce) force = force.add(wallForce);

    const clamped = force.clamp(this.MAX_FORCE);
    const lerpT   = Math.min(1, this.STEER_LERP * dt);
    this.dir = this.dir.lerp(this.dir.add(clamped), lerpT).normalize();

    this.speed = this._calcSpeed(BASE_SPEED);
    this._applyDirection(dt);
    this._moveSegments();
    this._grow();
  }

  _sense(dt) {
    const nearbyFood = this.foodGrid.query(
      this.head.x, this.head.y,
      this.FOOD_RADIUS,
      this._nearby
    );

    let fleeTarget   = null;
    let pursueTarget = null;
    let closestFleeDistSq   = Infinity;
    let closestPursueDistSq = Infinity;

    for (const other of this.snakes) {
      if (other === this || !other.alive) continue;

      const dsq = Vector2.distSq(this.head, other.head);
      if (dsq > this.SNAKE_SENSE_R * this.SNAKE_SENSE_R) continue;

      const sizeDiff = other.length - this.length;

      if (sizeDiff > 8) {
        if (dsq < closestFleeDistSq) {
          closestFleeDistSq = dsq;
          fleeTarget = other;
        }
      } else if (sizeDiff < -8) {
        if (dsq < closestPursueDistSq) {
          closestPursueDistSq = dsq;
          pursueTarget = other;
        }
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

        if (Vector2.distSq(this.head, other.head) >
            (this.BODY_SENSE_R + other.length * SEGMENT_GAP) *
            (this.BODY_SENSE_R + other.length * SEGMENT_GAP)) continue;

        for (const seg of other.segments) {
          const dx  = probeX - seg.x;
          const dy  = probeY - seg.y;
          if (dx * dx + dy * dy < hitRadSq) {
            const dot  = -this.dir.y * dx + this.dir.x * dy;
            const sign = dot >= 0 ? 1 : -1;
            avoidNormal = new Vector2(-this.dir.y * sign, this.dir.x * sign);
            break outerLoop;
          }
        }
      }
    }

    this._fleeTarget   = fleeTarget;
    this._pursueTarget = pursueTarget;
    this._avoidNormal  = avoidNormal;

    return { nearbyFood, fleeTarget, pursueTarget, avoidNormal };
  }

  _evalFSM(dt, nearbyFood, fleeTarget, pursueTarget, avoidNormal) {
    const tick = (key, condition) => {
      if (condition) {
        this._hyst[key] = Math.min(
          this._hyst[key] + dt,
          HYSTERESIS[key].enter + 0.1
        );
      } else {
        this._hyst[key] = Math.max(0, this._hyst[key] - dt);
      }
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
    switch (this.state) {
      case AI_STATE.AVOID: {
        if (!avoidNormal) return this.wander(dt).scale(0.6);
        return avoidNormal.scale(2.0);
      }
      case AI_STATE.FLEE: {
        if (!fleeTarget) return this.wander(dt).scale(0.6);
        return this.evade(fleeTarget).scale(1.8);
      }
      case AI_STATE.PURSUE: {
        if (!pursueTarget) return this.wander(dt).scale(0.6);
        return this.pursue(pursueTarget).scale(1.2);
      }
      case AI_STATE.SEEK_FOOD: {
        let bestDsq = Infinity, target = null;
        for (const f of nearbyFood) {
          const dsq = Vector2.distSq(this.head, f.pos);
          if (dsq < bestDsq) { bestDsq = dsq; target = f; }
        }
        return target
          ? this.seek(target.pos).scale(1.0)
          : this.wander(dt).scale(0.6);
      }
      default:
        return this.wander(dt).scale(0.6);
    }
  }

  seek(targetPos) {
    const desired = targetPos.sub(this.head).normalize();
    return desired.sub(this.dir);
  }

  flee(targetPos) {
    return this.seek(targetPos).scale(-1);
  }

  pursue(target) {
    const toTarget  = target.head.sub(this.head);
    const dist      = toTarget.length();
    const lookAheadT = Math.min(dist / (this.speed || BASE_SPEED), 1.5);
    const futurePos = dist > 60
      ? target.head.add(target.dir.scale(target.speed * lookAheadT))
      : target.head;
    return this.seek(futurePos);
  }

  evade(threat) {
    const toThreat   = threat.head.sub(this.head);
    const dist       = toThreat.length();
    const lookAheadT = Math.min(dist / (this.speed || BASE_SPEED), 1.5);
    const futurePos  = dist > 60
      ? threat.head.add(threat.dir.scale(threat.speed * lookAheadT))
      : threat.head;
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
    const MARGIN_OUTER = 160;
    const MARGIN_INNER = 60;

    let px = 0, py = 0;
    const hx = this.head.x, hy = this.head.y;

    const push = (dist) =>
      dist < MARGIN_OUTER
        ? (1 - Math.max(0, (dist - MARGIN_INNER) / (MARGIN_OUTER - MARGIN_INNER)))
        : 0;

    px +=  push(hx);
    px -=  push(WORLD_W - hx);
    py +=  push(hy);
    py -=  push(WORLD_H - hy);

    if (px === 0 && py === 0) return null;

    const len = Math.sqrt(px * px + py * py);
    return new Vector2(px / len, py / len).scale(0.3);
  }
}

/* ─────────────────────────────────────────────────────────────
   8. GAME
─────────────────────────────────────────────────────────────
   Helper: returns a random [bodyColor, headColor] pair for an
   enemy snake, guaranteeing it never repeats the same palette
   index twice in a row. Called on spawn & respawn.
───────────────────────────────────────────────────────────── */
let _lastAIPaletteIdx = -1;
function randomAIPalette() {
  let idx;
  do {
    idx = Math.floor(Math.random() * AI_PALETTES.length);
  } while (idx === _lastAIPaletteIdx && AI_PALETTES.length > 1);
  _lastAIPaletteIdx = idx;
  return AI_PALETTES[idx];
}
const AI_PALETTES = [
  ['#f56a6a', '#ff9a9a'],  ['#a56aff', '#d0a5ff'],
  ['#ffb347', '#ffd78a'],  ['#6ae0ff', '#a8eeff'],
  ['#ff6ab8', '#ffa8d8'],  ['#c8ff6a', '#e5ff9a'],
  ['#ff6a6a', '#ffaaaa'],  ['#6affcc', '#a8ffe0'],
  ['#ff8c6a', '#ffba9a'],  ['#6a8cff', '#9ab0ff'],
];

const FOOD_COLORS = [
  '#ff5e57','#ffa41b','#ffdd00','#7bff6a',
  '#00d2ff','#8c52ff','#ff52c0','#52ffca',
];

class Game {
  constructor() {
    this.canvas  = document.getElementById('game-canvas');
    this.ctx     = this.canvas.getContext('2d');

    this.overlay      = document.getElementById('overlay');
    this.scoreDisplay = document.getElementById('score-display');
    this.finalScore   = document.getElementById('final-score');
    this.startBtn     = document.getElementById('start-btn');
    this.hudScore     = document.getElementById('hud-score');
    this.hudLength    = document.getElementById('hud-length');

    this._heartEls = [
      document.getElementById('heart-1'),
      document.getElementById('heart-2'),
      document.getElementById('heart-3'),
    ];

    this.hudBestScore = document.getElementById('hud-best-score');

    this.camX = 0;
    this.camY = 0;

    this.running   = false;
    this.snakes    = [];
    this.foods     = [];
    this.foodGrid  = null;
    this.particles = new ParticlePool();
    this.audio     = new AudioManager();

    this._lastTime     = 0;
    this._rafId        = null;
    this._boundLoop    = this._loop.bind(this);
    this._foodQueryBuf = [];
    this._killList     = [];

    window._GAME_WORLD = { w: WORLD_W, h: WORLD_H };

    this._setupResize();
    this._setupInput();
    this._setupSettings();
    this.startBtn.addEventListener('click', () => this.startGame());
    window._game = this;
  }

  /* ── RESIZE ─────────────────────────────────────────────── */
  _setupResize() {
    const resize = () => {
      this.canvas.width  = window.innerWidth;
      this.canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();
  }

  /* ── INPUT ──────────────────────────────────────────────── */
  _setupInput() {
    this._pointer = new Vector2(window.innerWidth / 2, window.innerHeight / 2);

    this.canvas.addEventListener('mousemove', e => {
      this._pointer.x = e.clientX;
      this._pointer.y = e.clientY;
    });

    this.canvas.addEventListener('mousedown',  () => { if (this.player) this.player.boosting = true;  });
    this.canvas.addEventListener('mouseup',    () => { if (this.player) this.player.boosting = false; });
    this.canvas.addEventListener('mouseleave', () => { if (this.player) this.player.boosting = false; });

    this.canvas.addEventListener('touchstart', e => {
      const t = e.touches[0];
      this._pointer.x = t.clientX;
      this._pointer.y = t.clientY;
      if (this.player) this.player.boosting = true;
    }, { passive: true });

    this.canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      const t = e.touches[0];
      this._pointer.x = t.clientX;
      this._pointer.y = t.clientY;
    }, { passive: false });

    this.canvas.addEventListener('touchend', () => {
      if (this.player) this.player.boosting = false;
    }, { passive: true });
  }

  /* ── SETTINGS UI ────────────────────────────────────────── */
  _setupSettings() {
    // ── Mute toggle ───────────────────────────────────────
    const muteBtn = document.getElementById('setting-mute');
    muteBtn.addEventListener('click', () => {
      Settings.muted = !Settings.muted;
      muteBtn.textContent = Settings.muted ? 'OFF' : 'ON';
      muteBtn.classList.toggle('active', !Settings.muted);
      this.audio.applyMuteSetting();
    });

    // ── Sensitivity slider ────────────────────────────────
    const sensSlider = document.getElementById('setting-sensitivity');
    const sensVal    = document.getElementById('sensitivity-val');
    sensSlider.value = Settings.sensitivity;
    sensVal.textContent = Settings.sensitivity;

    sensSlider.addEventListener('input', () => {
      Settings.sensitivity = parseInt(sensSlider.value, 10);
      sensVal.textContent  = Settings.sensitivity;
    });

    // ── Design buttons ────────────────────────────────────
    const designBtns = document.querySelectorAll('.design-btn');
    designBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        designBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Settings.design = btn.dataset.design;
      });
    });
  }

  /* ── START / RESET ──────────────────────────────────────── */
  startGame() {
    this.overlay.classList.add('hidden');
    this.scoreDisplay.style.display = 'none';
    const bestDisplay = document.getElementById('best-score-display');
    if (bestDisplay) bestDisplay.style.display = 'none';
    this.startBtn.textContent = 'Play Again';

    this._heartEls.forEach(el => el.classList.remove('lost'));

    this.foodGrid = new SpatialGrid(WORLD_W, WORLD_H, 360);

    this.snakes = [];
    this.player = new PlayerSnake(WORLD_W / 2, WORLD_H / 2);
    this.snakes.push(this.player);

    for (let i = 0; i < AI_COUNT; i++) {
      const [body, head] = randomAIPalette();
      const x = 300 + Math.random() * (WORLD_W - 600);
      const y = 300 + Math.random() * (WORLD_H - 600);
      this.snakes.push(new AISnake(x, y, body, head, this.foodGrid, this.snakes));
    }

    this.foods = [];
    for (let i = 0; i < FOOD_COUNT; i++) this._spawnFood();

    // Reset designer palette
    _designerPaletteIdx = 0;
    _designerTimer      = 0;

    this.audio.stopBg();
    this.audio.stopPanic();
    this.audio.stopRun();
    this.audio.playBg();

    // Reset audio cooldowns
    this.audio._nearCooldown = 0;
    this.audio._biteCooldown = 0;

    // Danger-zone state tracking
    this._inDangerZone  = false;
    this._nearSnakeLast = false;

    this.running   = true;
    this._lastTime = performance.now();
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = requestAnimationFrame(this._boundLoop);
  }

  /* ── FOOD ───────────────────────────────────────────────── */
  _spawnFood(forceType = null, x = null, y = null) {
    const fx  = x  ?? (50 + Math.random() * (WORLD_W - 100));
    const fy  = y  ?? (50 + Math.random() * (WORLD_H - 100));
    const col = FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)];

    let type = forceType;
    if (!type) {
      const roll = Math.random();
      // Count active lifelines to enforce the cap
      const lifelineCount = this.foods.filter(f => f.type === FOOD_TYPE.LIFELINE).length;
      if (roll < LIFELINE_SPAWN_RATE && lifelineCount < LIFELINE_MAX_ON_MAP) {
        type = FOOD_TYPE.LIFELINE;
      } else if (roll < LIFELINE_SPAWN_RATE + POWERUP_SPAWN_RATE) {
        type = FOOD_TYPE.MAGNET;
      } else if (roll < LIFELINE_SPAWN_RATE + POWERUP_SPAWN_RATE * 2) {
        type = FOOD_TYPE.ATTACK;
      } else {
        type = FOOD_TYPE.NORMAL;
      }
    }

    const f = new Food(fx, fy, col, type);
    this.foods.push(f);
    this.foodGrid.add(f);
    return f;
  }

  _removeFood(food) {
    this.foodGrid.remove(food);
    const idx = this.foods.indexOf(food);
    if (idx !== -1) {
      this.foods[idx] = this.foods[this.foods.length - 1];
      this.foods.pop();
    }
  }

  /* ── MAIN LOOP ──────────────────────────────────────────── */
  _loop(timestamp) {
    if (!this.running) return;

    const rawDt = (timestamp - this._lastTime) / 1000;
    const dt    = Math.min(rawDt, 0.1);
    this._lastTime = timestamp;

    this._update(dt);
    this._render();

    this._rafId = requestAnimationFrame(this._boundLoop);
  }

  /* ── UPDATE ─────────────────────────────────────────────── */
  _update(dt) {
    // ── Designer palette ticker ───────────────────────────
    tickDesignerPalette(dt);

    // ── Audio cooldown tick ───────────────────────────────
    this.audio.tickCooldowns(dt);

    // ── Player ────────────────────────────────────────────
    if (this.player.alive) {
      this.player.pointer.x = this._pointer.x;
      this.player.pointer.y = this._pointer.y;
      this.player.update(dt, this.camX, this.camY);
    }

    // ── AI ────────────────────────────────────────────────
    for (let i = 1; i < this.snakes.length; i++) {
      this.snakes[i].update(dt);
    }

    // ── Camera ────────────────────────────────────────────
    if (this.player.alive) {
      const targetX = this.player.head.x - this.canvas.width  / 2;
      const targetY = this.player.head.y - this.canvas.height / 2;
      const camT = Math.min(1, 7 * dt);
      this.camX += (targetX - this.camX) * camT;
      this.camY += (targetY - this.camY) * camT;
    }

    // ── DANGER ZONE audio — run.mp3 ───────────────────────
    if (this.player.alive) {
      const hx = this.player.head.x;
      const hy = this.player.head.y;
      const nearest = Math.min(hx, WORLD_W - hx, hy, WORLD_H - hy);
      const inDanger = nearest < DANGER_ZONE_DIST;

      if (inDanger && !this._inDangerZone) {
        this._inDangerZone = true;
        this.audio.startRun();
      } else if (!inDanger && this._inDangerZone) {
        this._inDangerZone = false;
        this.audio.stopRun();
      }
    }

    // ── NEAR SNAKE audio — nearsnake.mp3 ─────────────────
    if (this.player.alive) {
      const nearSq = NEAR_SNAKE_RADIUS * NEAR_SNAKE_RADIUS;
      let anyNear  = false;
      for (let i = 1; i < this.snakes.length; i++) {
        const ai = this.snakes[i];
        if (!ai.alive) continue;
        if (Vector2.distSq(this.player.head, ai.head) < nearSq) {
          anyNear = true;
          break;
        }
      }
      if (anyNear) this.audio.playNearSnake(dt);
    }

    // ── MAGNET pull ───────────────────────────────────────
    if (this.player.alive && this.player.magnetTimer > 0) {
      this.foodGrid.query(
        this.player.head.x, this.player.head.y,
        MAGNET_RADIUS,
        this._foodQueryBuf
      );
      for (const food of this._foodQueryBuf) {
        if (food.type !== FOOD_TYPE.NORMAL) continue;   // skip powerups + lifeline
        const dx   = this.player.head.x - food.pos.x;
        const dy   = this.player.head.y - food.pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const strength = (1 - dist / MAGNET_RADIUS) * MAGNET_PULL_FORCE * dt;
        this.foodGrid.remove(food);
        food.pos.x += (dx / dist) * strength;
        food.pos.y += (dy / dist) * strength;
        this.foodGrid.add(food);
      }
    }

    // ── Food TTL garbage collection ───────────────────────
    // Tick TTL on all foods that have one; remove expired ones.
    // We sweep backwards so splice-swap-pop via _removeFood is safe.
    {
      const toRemove = [];
      for (const food of this.foods) {
        if (food.ttl === null) continue;
        food.ttl -= dt;
        if (food.ttl <= 0) toRemove.push(food);
      }
      for (const food of toRemove) {
        this._removeFood(food);
        // Do NOT respawn — dead-snake remains vanish permanently
      }
    }

    // ── Food collision ────────────────────────────────────
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
            this.player.activateMagnet();
            this.audio.playMagnet();   // ← magnet.mp3
            eaten.push(food);
            this._spawnFood(FOOD_TYPE.NORMAL);
            continue;
          }
          if (food.type === FOOD_TYPE.ATTACK) {
            this.player.activateAttack();
            eaten.push(food);
            this._spawnFood(FOOD_TYPE.NORMAL);
            continue;
          }
          if (food.type === FOOD_TYPE.LIFELINE) {
            // Only replenish if at least one life was lost
            if (this.player.lives < PLAYER_LIVES) {
              this.player.lives++;
              this._updateLivesHUD();
            }
            this.audio.playLifeline();   // ← lifeline.mp3
            eaten.push(food);
            // Do NOT respawn another lifeline — let the lottery handle it
            continue;
          }
        }

        const mult = 1 + Math.floor(snake.length / 20);
        snake.eat(mult);
        eaten.push(food);

        if (isPlayer) this.audio.playEat();
      }
    }
    for (const f of eaten) {
      this._removeFood(f);
      if (f.type === FOOD_TYPE.NORMAL) this._spawnFood();
    }

    // ── Wall collision ────────────────────────────────────
    for (const snake of this.snakes) {
      if (!snake.alive) continue;
      const h = snake.head;
      if (h.x < 0 || h.x > WORLD_W || h.y < 0 || h.y > WORLD_H) {
        this._killSnake(snake);
      }
    }

    // ── Snake-vs-snake ────────────────────────────────────
    this._checkSnakeCollisions();

    // ── Particles ─────────────────────────────────────────
    this.particles.update(dt);

    // ── Respawn dead AI ───────────────────────────────────
    for (let i = 1; i < this.snakes.length; i++) {
      if (!this.snakes[i].alive) {
        const [body, head] = randomAIPalette();
        const x = 300 + Math.random() * (WORLD_W - 600);
        const y = 300 + Math.random() * (WORLD_H - 600);
        this.snakes[i] = new AISnake(x, y, body, head, this.foodGrid, this.snakes);
      }
    }

    // ── Panic audio ───────────────────────────────────────
    if (this.player.alive && this.player.lives === 1) {
      this.audio.startPanic();
    } else {
      this.audio.stopPanic();
    }

    // ── HUD ───────────────────────────────────────────────
    if (this.player.alive) {
      this.hudScore.textContent  = `Score: ${this.player.score}`;
      this.hudLength.textContent = `Length: ${this.player.length}`;
      if (this.hudBestScore) {
        this.hudBestScore.textContent = `Best: ${HighScore.get()}`;
      }
      this._updateLivesHUD();
    }
  }

  _updateLivesHUD() {
    const lives = this.player.lives;
    this._heartEls.forEach((el, i) => {
      if (i < lives) el.classList.remove('lost');
      else           el.classList.add('lost');
    });
  }

  _flashLifeLost() {
    document.body.classList.remove('life-lost-flash');
    void document.body.offsetWidth;
    document.body.classList.add('life-lost-flash');
  }

  _respawnPlayer() {
    const p = this.player;

    const safeX = WORLD_W / 2 + (Math.random() - 0.5) * 400;
    const safeY = WORLD_H / 2 + (Math.random() - 0.5) * 400;

    p.segments = [];
    for (let i = 0; i < 12; i++) {
      p.segments.push(new Vector2(safeX - i * SEGMENT_GAP, safeY));
    }
    p.pos.x = safeX;
    p.pos.y = safeY;
    p.dir   = new Vector2(1, 0);
    p.alive = true;

    p.magnetTimer = 0;
    p.attackTimer = 0;
    p.iFrameTimer = IFRAME_DURATION;

    this.audio.playLifeline();   // ← lifeline.mp3
  }

  /* ── KILL SNAKE ─────────────────────────────────────────── */
  _killSnake(snake, triggeredByPlayer = false) {
    if (!snake.alive) return;

    if (snake === this.player) {
      if (this.player.invincible) return;

      this.player.lives--;
      this._updateLivesHUD();
      this._flashLifeLost();

      if (this.player.lives <= 0) {
        snake.alive = false;
        this.particles.burst(snake.segments, snake.headColor);
        this.audio.playGameOver();
        this._gameOver();
      } else {
        this._respawnPlayer();
      }
      return;
    }

    // AI death
    snake.alive = false;
    this.particles.burst(snake.segments, snake.headColor);

    // Play kill SFX if the player caused this death
    if (triggeredByPlayer) {
      this.audio.playKill();   // ← kill.mp3
    }

    for (let i = 0; i < snake.segments.length; i += 3) {
      const seg = snake.segments[i];
      if (seg.x > 10 && seg.x < WORLD_W - 10 &&
          seg.y > 10 && seg.y < WORLD_H - 10) {
        const col = FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)];
        // TTL: 10–15 s so remains disappear and don't cause lag
        const ttl = 10 + Math.random() * 5;
        const f   = new Food(
          seg.x + (Math.random() - 0.5) * 10,
          seg.y + (Math.random() - 0.5) * 10,
          col,
          FOOD_TYPE.NORMAL,
          ttl
        );
        this.foods.push(f);
        this.foodGrid.add(f);
      }
    }
  }

  /* ── SNAKE VS SNAKE ─────────────────────────────────────── */
  _checkSnakeCollisions() {
    // Use player's segment radius as the reference for hit detection
    const segR    = getSegmentR(true);
    const KILL_DSQ = (segR * 1.8)  * (segR * 1.8);
    const HEAD_DSQ = (segR * 2.8)  * (segR * 2.8);

    const killSet    = new Set();
    const shatterList = [];

    // Track which kills were caused by the player (for kill.mp3)
    const playerKillSet = new Set();

    const playerInAttack = this.player.alive && this.player.attackTimer > 0;

    for (let a = 0; a < this.snakes.length; a++) {
      const sa = this.snakes[a];
      if (!sa.alive || killSet.has(sa)) continue;
      if (sa === this.player && this.player.invincible) continue;

      for (let b = 0; b < this.snakes.length; b++) {
        if (a === b) continue;
        const sb = this.snakes[b];
        if (!sb.alive || killSet.has(sb)) continue;

        const headDsq = Vector2.distSq(sa.head, sb.head);
        if (headDsq > 1000 * 1000) continue;

        // ── Head-to-Head ────────────────────────────────────
        if (headDsq <= HEAD_DSQ) {
          if (a < b) {
            const sizeDiff = sa.segments.length - sb.segments.length;
            if (sizeDiff > H2H_UPSET_THRESHOLD) {
              killSet.add(sa);
              if (sb === this.player) playerKillSet.add(sa);
            } else if (sizeDiff < -H2H_UPSET_THRESHOLD) {
              killSet.add(sb);
              if (sa === this.player) playerKillSet.add(sb);
            } else {
              killSet.add(sa);
              killSet.add(sb);
            }
          }
          continue;
        }

        // ── Head-vs-Body ─────────────────────────────────────
        for (let s = 1; s < sb.segments.length; s++) {
          if (Vector2.distSq(sa.head, sb.segments[s]) >= KILL_DSQ) continue;

          if (sa === this.player && playerInAttack && sb !== this.player) {
            // Attack mode: shatter AI body
            shatterList.push({ snake: sb, fromIndex: s });
          } else if (sb === this.player && sa !== this.player && !this.player.invincible) {
            // Enemy head hit player body → enemybite.mp3
            this.audio.playEnemyBite(0);
            killSet.add(sa);
          } else {
            killSet.add(sa);
          }
          break;
        }
      }
    }

    // ── Apply kills ──────────────────────────────────────
    for (const s of killSet) {
      this._killSnake(s, playerKillSet.has(s));
    }

    // ── Apply attack shatters ────────────────────────────
    for (const { snake, fromIndex } of shatterList) {
      if (!snake.alive) continue;

      const MIN_SURVIVE = 5;
      if (fromIndex <= MIN_SURVIVE) {
        this._killSnake(snake, true);   // player caused it
        continue;
      }

      // Sever tail from fromIndex onward
      const severed = snake.segments.splice(fromIndex);
      this.particles.burst(severed, snake.headColor);

      // Play kill sound for a shatter too
      this.audio.playKill();   // ← kill.mp3

      for (let i = 0; i < severed.length; i += 2) {
        const seg = severed[i];
        if (seg.x > 10 && seg.x < WORLD_W - 10 &&
            seg.y > 10 && seg.y < WORLD_H - 10) {
          const col = FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)];
          const ttl = 10 + Math.random() * 5;   // 10–15 s TTL for shatter remains
          this.foods.push(new Food(
            seg.x + (Math.random() - 0.5) * 8,
            seg.y + (Math.random() - 0.5) * 8,
            col,
            FOOD_TYPE.NORMAL,
            ttl
          ));
          this.foodGrid.add(this.foods[this.foods.length - 1]);
        }
      }
    }
  }

  /* ── GAME OVER ──────────────────────────────────────────── */
  _gameOver() {
    this.running = false;
    this._inDangerZone = false;

    // Persist high score before showing final screen
    HighScore.save(this.player.score);
    const best = HighScore.get();

    this.finalScore.textContent = this.player.score;
    // Show best score line
    const bestEl = document.getElementById('best-score-value');
    if (bestEl) bestEl.textContent = best;
    const bestDisplay = document.getElementById('best-score-display');
    if (bestDisplay) bestDisplay.style.display = 'block';

    this.scoreDisplay.style.display = 'block';
    this.overlay.classList.remove('hidden');
    this.audio.stopBg();
    this.audio.stopPanic();
    this.audio.stopRun();
  }

  /* ── RENDER ─────────────────────────────────────────────── */
  _render() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    this._drawBackground();
    this._drawWorldBorder();

    if (this.player && this.player.alive && this.player.magnetTimer > 0) {
      this._drawMagnetAura();
    }

    ctx.save();
    for (const food of this.foods) food.draw(ctx, this.camX, this.camY);
    ctx.restore();

    for (const snake of this.snakes) snake.draw(ctx, this.camX, this.camY);

    this.particles.draw(ctx, this.camX, this.camY);

    this._drawMinimap();
    if (this.player.alive) this._drawWallWarning();
  }

  _drawMagnetAura() {
    const { ctx } = this;
    const hx = this.player.head.x - this.camX;
    const hy = this.player.head.y - this.camY;
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.004);

    ctx.save();
    ctx.strokeStyle = `rgba(0,200,255,${(0.12 + pulse * 0.12).toFixed(2)})`;
    ctx.lineWidth   = 2;
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -Date.now() * 0.05;
    ctx.shadowColor = '#00ccff';
    ctx.shadowBlur  = 10;
    ctx.beginPath();
    ctx.arc(hx, hy, MAGNET_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  _drawBackground() {
    const { ctx, canvas } = this;
    ctx.fillStyle = '#050a0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const gridSpacing = 40;
    ctx.fillStyle = 'rgba(80,140,200,0.11)';

    const offX = (-(this.camX % gridSpacing) + gridSpacing) % gridSpacing;
    const offY = (-(this.camY % gridSpacing) + gridSpacing) % gridSpacing;

    for (let x = offX - gridSpacing; x < canvas.width + gridSpacing; x += gridSpacing) {
      for (let y = offY - gridSpacing; y < canvas.height + gridSpacing; y += gridSpacing) {
        ctx.beginPath();
        ctx.arc(x, y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _drawWorldBorder() {
    const { ctx } = this;
    const x = -this.camX;
    const y = -this.camY;

    ctx.save();
    ctx.strokeStyle = 'rgba(126,255,178,0.35)';
    ctx.lineWidth   = 3;
    ctx.shadowColor = '#7effb2';
    ctx.shadowBlur  = 20;
    ctx.strokeRect(x, y, WORLD_W, WORLD_H);
    ctx.restore();
  }

  _drawWallWarning() {
    const { ctx, canvas } = this;
    if (!this.player.alive) return;

    const hx = this.player.head.x;
    const hy = this.player.head.y;

    const nearest = Math.min(hx, WORLD_W - hx, hy, WORLD_H - hy);
    if (nearest >= DANGER_ZONE_DIST) return;

    const intensity = (1 - nearest / DANGER_ZONE_DIST) * 0.5;

    const grad = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, canvas.height * 0.3,
      canvas.width / 2, canvas.height / 2, canvas.height * 0.8
    );
    grad.addColorStop(0, 'rgba(255,40,40,0)');
    grad.addColorStop(1, `rgba(255,40,40,${intensity.toFixed(2)})`);

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  _drawMinimap() {
    const { ctx, canvas } = this;
    const MAP_W   = 150;
    const MAP_H   = 150;
    const MAP_PAD = 14;
    const MAP_X   = canvas.width  - MAP_W - MAP_PAD;
    const MAP_Y   = MAP_PAD;
    const SCALE_X = MAP_W / WORLD_W;
    const SCALE_Y = MAP_H / WORLD_H;

    ctx.save();

    ctx.fillStyle   = 'rgba(5,10,15,0.7)';
    ctx.strokeStyle = 'rgba(126,255,178,0.25)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.roundRect(MAP_X, MAP_Y, MAP_W, MAP_H, 6);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.roundRect(MAP_X, MAP_Y, MAP_W, MAP_H, 6);
    ctx.clip();

    ctx.fillStyle = 'rgba(126,255,178,0.3)';
    for (const f of this.foods) {
      ctx.fillRect(
        MAP_X + f.pos.x * SCALE_X - 0.5,
        MAP_Y + f.pos.y * SCALE_Y - 0.5,
        1.5, 1.5
      );
    }

    for (let i = 1; i < this.snakes.length; i++) {
      const s = this.snakes[i];
      if (!s.alive) continue;
      ctx.fillStyle = s.headColor;
      ctx.beginPath();
      ctx.arc(
        MAP_X + s.head.x * SCALE_X,
        MAP_Y + s.head.y * SCALE_Y,
        2.5, 0, Math.PI * 2
      );
      ctx.fill();
    }

    if (this.player.alive) {
      ctx.fillStyle = '#7effb2';
      ctx.shadowColor = '#7effb2';
      ctx.shadowBlur  = 6;
      ctx.beginPath();
      ctx.arc(
        MAP_X + this.player.head.x * SCALE_X,
        MAP_Y + this.player.head.y * SCALE_Y,
        4, 0, Math.PI * 2
      );
      ctx.fill();

      ctx.shadowBlur  = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth   = 1;
      ctx.strokeRect(
        MAP_X + this.camX * SCALE_X,
        MAP_Y + this.camY * SCALE_Y,
        this.canvas.width  * SCALE_X,
        this.canvas.height * SCALE_Y
      );
    }

    ctx.restore();
  }
}

/* ─────────────────────────────────────────────────────────────
   BOOT
───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => { new Game(); });
