/**
 * ═══════════════════════════════════════════════════════════════
 *  SLITHER CLONE — game.js  (Phase 2: Core Mechanics Upgrade)
 *  Vanilla JS + HTML5 Canvas. No dependencies.
 *
 *  CHANGES FROM PHASE 1:
 *   ✓ Delta-time loop  — speed is Hz-independent
 *   ✓ Speed boost      — hold mouse / long-press (shrinks snake)
 *   ✓ Snake rendering  — single path per snake (10× faster)
 *   ✓ Self-collision   — fixed logic (was always skipped)
 *   ✓ Food iteration   — safe snapshot prevents mutation bugs
 *   ✓ Segment follow   — squared-dist early-exit saves sqrt
 *   ✓ Growth           — interpolated tail insertion (no teleport)
 *   ✓ Death FX         — food burst when snake dies
 *   ✓ Minimap          — top-right corner overview
 *   ✓ Danger ring      — visual warning near walls
 *   ✓ Score multiplier — longer snake = more points per food
 *
 *  Class hierarchy (unchanged from Phase 1):
 *    Vector2          — 2D math helper
 *    Snake            — Base class
 *    PlayerSnake      — Mouse/touch steering + boost
 *    AISnake          — State machine + steering behaviors
 *    Food             — Pellet
 *    SpatialGrid      — Fast O(1) neighbour lookup
 *    ParticlePool     — Object pool for death burst particles
 *    Game             — Main loop, collision, spawning, camera
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

/* ─────────────────────────────────────────────────────────────
   CONSTANTS — top-level so they're easy to tune
───────────────────────────────────────────────────────────── */
const WORLD_W       = 3000;
const WORLD_H       = 3000;
const FOOD_COUNT    = 320;      // pellets alive at once
const AI_COUNT      = 10;       // enemy snakes
const SEGMENT_GAP   = 8;        // px between segment centres
const SEGMENT_R     = 9;        // visual radius of each circle
const BASE_SPEED    = 130;      // world-px per second (was 2.2 × ~60fps)
const BOOST_SPEED   = 220;      // speed while boosting
const BOOST_DRAIN   = 0.6;      // segments lost per second while boosting
// Self-collision is now disabled; constant kept so Phase-2 comment refs compile.
const SELF_SKIP     = 8;        // (legacy) neck segments once ignored for self-collision

// ── Velocity scaling by length ────────────────────────────
// Speed multiplier is lerped between these two extremes based
// on snake length.  A 10-segment snake gets SPEED_SMALL_MUL;
// a SPEED_SCALE_MAX-segment snake gets SPEED_LARGE_MUL;
// anything in between is linearly interpolated.
const SPEED_SMALL_MUL  = 1.13;   // +13 % for tiny snakes
const SPEED_LARGE_MUL  = 0.87;   // −13 % for very large snakes
const SPEED_SCALE_MIN  = 10;     // segments at which small bonus applies
const SPEED_SCALE_MAX  = 80;     // segments at which large penalty applies

// ── Head-to-head collision ────────────────────────────────
// If the LARGER snake is at least this many segments bigger,
// it dies instead of the smaller one (David-and-Goliath rule).
const H2H_UPSET_THRESHOLD = 15;

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

  // distSq — no sqrt, safe for hot comparison paths
  static distSq(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
  }
  static dist(a, b) { return Math.sqrt(Vector2.distSq(a, b)); }
}

/* ─────────────────────────────────────────────────────────────
   NEW CONSTANTS — Power-ups & Lives
───────────────────────────────────────────────────────────── */
const PLAYER_LIVES       = 3;     // starting lives
const IFRAME_DURATION    = 2.5;   // seconds of post-respawn invincibility
const MAGNET_DURATION    = 7;     // seconds the magnet effect lasts
const MAGNET_RADIUS      = 280;   // world-px pull radius
const MAGNET_PULL_FORCE  = 220;   // world-px/s² toward head
const ATTACK_DURATION    = 8;     // seconds of attack (sword) mode
const POWERUP_SPAWN_RATE = 0.004; // chance per normal food spawn to be a powerup

/* ─────────────────────────────────────────────────────────────
   1b. AUDIO MANAGER
   Handles bgmusic / eat / panic / gameover.
   • AudioContext starts (resumed) on first user interaction.
   • All buffers are decoded once at load; playback is instant.
   • panic track loops and is triggered when lives drop to 1;
     it stops when the player regains safety or dies.
───────────────────────────────────────────────────────────── */
class AudioManager {
  constructor() {
    this._ctx        = null;   // AudioContext — created lazily on first gesture
    this._buffers    = {};     // decoded AudioBuffers keyed by name
    this._bgNode     = null;   // BufferSourceNode for looping music
    this._panicNode  = null;   // BufferSourceNode for looping panic track
    this._ready      = false;
    this._bgPlaying  = false;
    this._panicOn    = false;

    // Map name → URL (paths relative to HTML file)
    this._tracks = {
      bg:       'bgmusic.mp3',
      eat:      'eat.mp3',
      panic:    'panic.mp3',
      gameover: 'gameover.mp3',
    };

    // Bootstrap on first user gesture (click / touch)
    const unlock = () => {
      this._init();
      window.removeEventListener('click',      unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('click',      unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
  }

  /* Create context + decode all tracks */
  async _init() {
    if (this._ctx) return;
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      await Promise.all(
        Object.entries(this._tracks).map(([name, url]) =>
          this._load(name, url)
        )
      );
      this._ready = true;
      this.playBg();   // auto-start music once unlocked
    } catch (e) {
      console.warn('[AudioManager] init failed:', e);
    }
  }

  async _load(name, url) {
    try {
      const resp   = await fetch(url);
      const arr    = await resp.arrayBuffer();
      this._buffers[name] = await this._ctx.decodeAudioData(arr);
    } catch (e) {
      console.warn(`[AudioManager] failed to load ${name}:`, e);
    }
  }

  /* Internal: play a buffer once, return the node */
  _play(name, loop = false, volume = 1) {
    if (!this._ready || !this._buffers[name]) return null;
    const src  = this._ctx.createBufferSource();
    const gain = this._ctx.createGain();
    src.buffer = this._buffers[name];
    src.loop   = loop;
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(this._ctx.destination);
    src.start(0);
    return src;
  }

  /* ── Public API ─────────────────────────────────────────── */

  playBg() {
    if (!this._ready || this._bgPlaying) return;
    this._bgNode    = this._play('bg', true, 0.35);
    this._bgPlaying = !!this._bgNode;
  }

  stopBg() {
    if (this._bgNode) { try { this._bgNode.stop(); } catch(_) {} }
    this._bgNode    = null;
    this._bgPlaying = false;
  }

  playEat() { this._play('eat', false, 0.7); }

  playGameOver() {
    this.stopBg();
    this.stopPanic();
    this._play('gameover', false, 0.9);
  }

  /** Call when player is on last life; stops when safe */
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
}

/* ─────────────────────────────────────────────────────────────
   2. SPATIAL GRID
   Cell size = 2× largest detection radius so a range query
   touches at most 4 cells.
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
   NEW: type field — 'normal' | 'magnet' | 'attack'
───────────────────────────────────────────────────────────── */
const FOOD_TYPE = Object.freeze({
  NORMAL: 'normal',
  MAGNET: 'magnet',
  ATTACK: 'attack',
});

class Food {
  constructor(x, y, color, type = FOOD_TYPE.NORMAL) {
    this.pos    = new Vector2(x, y);
    this.type   = type;
    this.radius = type === FOOD_TYPE.NORMAL ? 6 : 9;
    this.phase  = Math.random() * Math.PI * 2;

    if      (type === FOOD_TYPE.MAGNET) this.color = '#00ccff';
    else if (type === FOOD_TYPE.ATTACK) this.color = '#ff3f3f';
    else                                this.color = color;
  }

  draw(ctx, camX, camY) {
    const sx = this.pos.x - camX;
    const sy = this.pos.y - camY;

    if (sx < -24 || sx > ctx.canvas.width  + 24 ||
        sy < -24 || sy > ctx.canvas.height + 24) return;

    const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.003 + this.phase);
    const r     = this.radius + pulse * 2;

    if (this.type === FOOD_TYPE.NORMAL) {
      // ── Standard pellet ─────────────────────────────────
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
      // ── Magnet powerup — teal core + spinning orbit ──────
      const spin = Date.now() * 0.003;
      ctx.shadowColor = '#00ccff';
      ctx.shadowBlur  = 18 + pulse * 10;

      // Orbit ring
      ctx.beginPath();
      ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,200,255,0.4)';
      ctx.lineWidth   = 2;
      ctx.stroke();

      // 6 orbiting dots
      for (let i = 0; i < 6; i++) {
        const a  = spin + (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(sx + Math.cos(a) * (r + 5), sy + Math.sin(a) * (r + 5), 2, 0, Math.PI * 2);
        ctx.fillStyle = '#52ddff';
        ctx.fill();
      }

      // Core
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#00ccff';
      ctx.fill();

      // Magnet U-shape icon
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, r * 0.5, Math.PI, 0, false);
      ctx.stroke();

    } else if (this.type === FOOD_TYPE.ATTACK) {
      // ── Attack powerup — red core + sword ────────────────
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

      // Blade
      ctx.beginPath();
      ctx.moveTo(sx, sy - r * 0.7);
      ctx.lineTo(sx, sy + r * 0.4);
      ctx.stroke();

      // Guard
      ctx.beginPath();
      ctx.moveTo(sx - r * 0.45, sy + r * 0.1);
      ctx.lineTo(sx + r * 0.45, sy + r * 0.1);
      ctx.stroke();

      ctx.lineCap = 'butt';
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   4. PARTICLE POOL — death burst FX
   Pre-allocates MAX_PARTICLES objects; reuses them via an
   active/inactive flag. No heap allocation during gameplay.
───────────────────────────────────────────────────────────── */
const MAX_PARTICLES = 400;

class ParticlePool {
  constructor() {
    // Pre-allocate all particle objects at startup
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

  /** Emit a burst of particles from a snake's segments */
  burst(segments, color) {
    // Sample at most every 4th segment to keep particle count sane
    for (let i = 0; i < segments.length; i += 4) {
      const seg = segments[i];
      const p   = this._getFree();
      if (!p) break;  // pool exhausted — gracefully skip
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 120;
      p.active  = true;
      p.x       = seg.x;
      p.y       = seg.y;
      p.vx      = Math.cos(angle) * speed;
      p.vy      = Math.sin(angle) * speed;
      p.life    = 0;
      p.maxLife = 0.6 + Math.random() * 0.5;   // seconds
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
      // Simple kinematic integration with drag
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
      // Cull off-screen
      if (sx < -20 || sx > ctx.canvas.width  + 20 ||
          sy < -20 || sy > ctx.canvas.height + 20) continue;
      const t = p.life / p.maxLife;           // 0 → 1 as particle dies
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
   FIX: Rendering now uses a single path per snake instead of
        ctx.save/restore per segment — reduces state changes
        from O(n) to O(1) per snake per frame.
   FIX: _moveSegments uses squared distance early-exit.
   FIX: _grow interpolates tail position to avoid teleport.
───────────────────────────────────────────────────────────── */
class Snake {
  constructor(x, y, bodyColor, headColor, initLen = 8) {
    this.pos       = new Vector2(x, y);
    this.dir       = new Vector2(1, 0);
    this.speed     = BASE_SPEED;     // world-px per second
    this.alive     = true;
    this.bodyColor = bodyColor;
    this.headColor = headColor;
    this.score     = 0;

    // Segments array: index 0 = head, last = tail
    this.segments = [];
    for (let i = 0; i < initLen; i++) {
      this.segments.push(new Vector2(x - i * SEGMENT_GAP, y));
    }

    this._growBuffer = 0;   // pending segments to add

    // Pre-allocated scratch to avoid per-frame allocation
    this._tmpVec = new Vector2(0, 0);
  }

  get length() { return this.segments.length; }
  get head()   { return this.segments[0]; }

  /* Advance head along current direction by dt seconds */
  _applyDirection(dt) {
    const head = this.segments[0];
    head.x += this.dir.x * this.speed * dt;
    head.y += this.dir.y * this.speed * dt;
    this.pos.x = head.x;
    this.pos.y = head.y;
  }

  /**
   * Chain-follow: each segment moves toward the one ahead.
   * FIX: squared-distance early-exit skips the expensive
   *      normalise when segments are already close enough.
   */
  _moveSegments() {
    const gapSq = SEGMENT_GAP * SEGMENT_GAP;
    for (let i = 1; i < this.segments.length; i++) {
      const seg  = this.segments[i];
      const prev = this.segments[i - 1];
      const dx   = prev.x - seg.x;
      const dy   = prev.y - seg.y;
      const dSq  = dx * dx + dy * dy;

      // Early exit: if already within gap, no movement needed
      if (dSq <= gapSq) continue;

      // Only call sqrt when we actually need to normalise
      const dist = Math.sqrt(dSq);
      const t    = (dist - SEGMENT_GAP) / dist;
      seg.x += dx * t;
      seg.y += dy * t;
    }
  }

  eat(points = 1) {
    this._growBuffer += 4;   // queue 4 new segments per food
    this.score += points;
  }

  /**
   * Add a segment behind the tail.
   * FIX: interpolate position between tail and its predecessor
   *      so the new segment appears at exactly SEGMENT_GAP
   *      behind tail — no visible teleport / gap spike.
   */
  _grow() {
    if (this._growBuffer <= 0) return;
    this._growBuffer--;

    const segs = this.segments;
    const tail = segs[segs.length - 1];

    if (segs.length >= 2) {
      const prev = segs[segs.length - 2];
      // Place new segment one gap behind the current tail
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

  /**
   * _calcSpeed — returns a length-scaled speed for `baseSpeed`.
   *
   * Uses a simple linear interpolation between SPEED_SMALL_MUL
   * and SPEED_LARGE_MUL over the range [SPEED_SCALE_MIN,
   * SPEED_SCALE_MAX].  Snakes shorter than the minimum get the
   * full small-snake bonus; snakes longer than the maximum get
   * the full large-snake penalty.
   *
   * Both PlayerSnake and AISnake call this so the curve is
   * consistent.  Boost is applied on top of the scaled base,
   * so even a huge snake gets a meaningful boost burst.
   *
   * @param {number} baseSpeed  The un-scaled reference speed.
   * @returns {number}          The adjusted speed in world-px/s.
   */
  _calcSpeed(baseSpeed) {
    const len = this.segments.length;
    // t=0 → small bonus, t=1 → large penalty
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
   * RENDER — single path per body, then separate head + eyes.
   * NEW: i-frame flicker (skip every other render during invincibility)
   *      attack mode → red head glow
   */
  draw(ctx, camX, camY) {
    if (!this.alive) return;

    // ── I-frame flicker: only the player has iFrameTimer ─────
    if (this.iFrameTimer !== undefined && this.iFrameTimer > 0) {
      // Flicker at ~8 Hz — skip render on odd 62ms intervals
      if (Math.floor(Date.now() / 62) % 2 === 0) return;
    }

    const segs = this.segments;
    const len  = segs.length;

    // ── Attack mode → shift body color to red tint ───────────
    const inAttack  = this.attackTimer !== undefined && this.attackTimer > 0;
    const bodyFill  = inAttack ? '#8b1a1a' : this.bodyColor;
    const headFill  = inAttack ? '#ff2222' : this.headColor;
    const glowColor = inAttack ? '#ff2222' : this.headColor;

    // ── 1. Body segments (tail → neck, skip head) ──────────
    ctx.beginPath();
    for (let i = len - 1; i >= 1; i--) {
      const sx = segs[i].x - camX;
      const sy = segs[i].y - camY;

      // Cull off-screen segments (huge win for long snakes)
      if (sx < -SEGMENT_R * 2 || sx > ctx.canvas.width  + SEGMENT_R * 2 ||
          sy < -SEGMENT_R * 2 || sy > ctx.canvas.height + SEGMENT_R * 2) continue;

      ctx.moveTo(sx + SEGMENT_R, sy);
      ctx.arc(sx, sy, SEGMENT_R, 0, Math.PI * 2);
    }
    ctx.fillStyle = bodyFill;
    ctx.fill();

    // ── 2. Head (slightly larger, with glow) ───────────────
    const hx = segs[0].x - camX;
    const hy = segs[0].y - camY;

    ctx.save();
    ctx.shadowColor = glowColor;
    ctx.shadowBlur  = inAttack ? 28 : 16;
    ctx.beginPath();
    ctx.arc(hx, hy, SEGMENT_R * 1.35, 0, Math.PI * 2);
    ctx.fillStyle = headFill;
    ctx.fill();
    ctx.restore();

    // Attack mode: extra pulsing outer ring
    if (inAttack) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.01);
      ctx.save();
      ctx.strokeStyle = `rgba(255,50,50,${(0.4 + pulse * 0.4).toFixed(2)})`;
      ctx.lineWidth   = 3;
      ctx.shadowColor = '#ff2222';
      ctx.shadowBlur  = 14;
      ctx.beginPath();
      ctx.arc(hx, hy, SEGMENT_R * 1.9 + pulse * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ── 3. Eyes ────────────────────────────────────────────
    this._drawEyes(ctx, hx, hy);
  }

  _drawEyes(ctx, hx, hy) {
    const eyeOff  = SEGMENT_R * 0.55;
    const fwdDist = SEGMENT_R * 0.4;
    // Perpendicular to direction
    const perpX = -this.dir.y * eyeOff;
    const perpY =  this.dir.x * eyeOff;
    const fwdX  = this.dir.x * fwdDist;
    const fwdY  = this.dir.y * fwdDist;

    // Two eyes — draw both in one pass to avoid extra save/restore
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(hx + fwdX + perpX, hy + fwdY + perpY, 3.2, 0, Math.PI * 2);
    ctx.arc(hx + fwdX - perpX, hy + fwdY - perpY, 3.2, 0, Math.PI * 2);
    ctx.fill();

    // Pupils
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
   UPGRADED:
   • Boost mechanic (unchanged)
   • lives + iFrameTimer  — lose a life instead of instant death
   • magnetTimer          — pulls nearby food to head
   • attackTimer          — aggressive mode; killing body segments
───────────────────────────────────────────────────────────── */
class PlayerSnake extends Snake {
  constructor(x, y) {
    super(x, y, '#2dd87a', '#7effb2', 12);
    this.pointer        = new Vector2(0, 0);
    this.boosting       = false;
    this._boostDrainAcc = 0;

    // ── Lives system ──────────────────────────────────────
    this.lives      = PLAYER_LIVES;
    this.iFrameTimer = 0;     // seconds remaining of invincibility

    // ── Power-up timers ───────────────────────────────────
    this.magnetTimer = 0;     // > 0 while magnet is active
    this.attackTimer = 0;     // > 0 while attack mode is active
  }

  update(dt, camX, camY) {
    if (!this.alive) return;

    // ── Tick down timers ──────────────────────────────────
    if (this.iFrameTimer  > 0) this.iFrameTimer  = Math.max(0, this.iFrameTimer  - dt);
    if (this.magnetTimer  > 0) this.magnetTimer  = Math.max(0, this.magnetTimer  - dt);
    if (this.attackTimer  > 0) this.attackTimer  = Math.max(0, this.attackTimer  - dt);

    // ── Speed selection ───────────────────────────────────
    const scaledBase  = this._calcSpeed(BASE_SPEED);
    const scaledBoost = this._calcSpeed(BOOST_SPEED);
    this.speed = (this.boosting && this.segments.length > 6)
      ? scaledBoost : scaledBase;

    // ── Tail drain while boosting ─────────────────────────
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

    // ── Steer toward pointer ──────────────────────────────
    const worldX = this.pointer.x + camX;
    const worldY = this.pointer.y + camY;
    const dx     = worldX - this.head.x;
    const dy     = worldY - this.head.y;
    const dSq    = dx * dx + dy * dy;

    if (dSq > 100) {
      const dist    = Math.sqrt(dSq);
      const desired = new Vector2(dx / dist, dy / dist);
      const lerpT   = Math.min(1, 0.14 * dt * 60);
      this.dir = this.dir.lerp(desired, lerpT).normalize();
    }

    this._applyDirection(dt);
    this._moveSegments();
    this._grow();
  }

  /**
   * Activate the magnet power-up.
   * The actual food-pulling logic lives in Game._update()
   * so it can access the foods array directly.
   */
  activateMagnet() {
    this.magnetTimer = MAGNET_DURATION;
  }

  /** Activate the attack (sword) power-up. */
  activateAttack() {
    this.attackTimer = ATTACK_DURATION;
  }

  /** @returns {boolean} true if currently immune to collision damage */
  get invincible() {
    return this.iFrameTimer > 0;
  }
}

/* ─────────────────────────────────────────────────────────────
   7. AI SNAKE  ·  Phase 3: Tactical AI
   ═══════════════════════════════════════════════════════════

   FSM STATE PRIORITY (low → high, higher wins):
     WANDER < SEEK_FOOD < AVOID < FLEE < PURSUE

   Anti-jitter architecture:
   • Each state has a HYSTERESIS timer. A state can only be
     ENTERED after its trigger condition holds for at least
     ENTER_HOLD seconds, and can only be EXITED after its
     exit condition holds for EXIT_HOLD seconds.
   • State weights (force magnitudes) also differ — AVOID is
     10× stronger than WANDER so force blending itself
     expresses priority without hard snapping.
   • PURSUE / FLEE share an evade() / pursue() pair that uses
     predictive intercept so the AI aims at where the target
     WILL BE, not where it is now. This feels smarter and
     naturally prevents oscillation because the intercept
     point moves smoothly.

   Neighbour sensing:
   • The AI now queries a second buffer (_nearbySegBuf) for
     body segments of OTHER snakes within BODY_SENSE_R.
     This powers AVOID — it ray-marches 3 lookahead steps
     and triggers if any step hits a foreign segment.
───────────────────────────────────────────────────────────── */

const AI_STATE = Object.freeze({
  WANDER:    'WANDER',
  SEEK_FOOD: 'SEEK_FOOD',
  AVOID:     'AVOID',
  FLEE:      'FLEE',
  PURSUE:    'PURSUE',
});

// ── Hysteresis thresholds (seconds) ─────────────────────────
// A state flip only fires after the trigger has been true for
// this long. Keeps the FSM stable when snakes pass just inside
// the detection radius for a single frame.
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

    // ── Wander state ──────────────────────────────────────
    this._wanderAngle  = Math.random() * Math.PI * 2;
    this._wanderDist   = 55;
    this._wanderRadius = 30;
    this._wanderJitter = 1.2;

    // ── Detection radii ───────────────────────────────────
    this.FOOD_RADIUS      = 180;   // food sense range (px)
    this.SNAKE_SENSE_R    = 220;   // range to notice other snake HEADS
    this.BODY_SENSE_R     = 90;    // range to notice body segments (AVOID)
    this.LOOKAHEAD_STEPS  = 3;     // ray-march steps for body obstacle check
    this.LOOKAHEAD_DIST   = 30;    // px per lookahead step

    // ── Steering physics ──────────────────────────────────
    this.MAX_FORCE  = 0.12;
    this.STEER_LERP = 6.0;

    // ── Hysteresis accumulators ───────────────────────────
    // Each tracks how long the trigger condition has been
    // continuously true (positive) or false (negative).
    this._hyst = {
      PURSUE:    0,
      FLEE:      0,
      AVOID:     0,
      SEEK_FOOD: 0,
    };

    // ── Cached sense results (set each update, used in force) ──
    this._fleeTarget   = null;   // Vector2 — head of threat
    this._pursueTarget = null;   // ref to smaller AISnake / PlayerSnake
    this._avoidNormal  = null;   // Vector2 — escape direction for AVOID

    // Reusable scratch arrays — zero allocation in hot path
    this._nearby        = [];
    this._nearbySnakes  = [];
  }

  /* ═══════════════════════════════════════════════════════
     UPDATE — called every frame
  ═══════════════════════════════════════════════════════ */
  update(dt) {
    if (!this.alive) return;

    // ── STEP 1 — Sense ────────────────────────────────────
    const { nearbyFood, fleeTarget, pursueTarget, avoidNormal }
      = this._sense(dt);

    // ── STEP 2 — State transitions (with hysteresis) ──────
    this.state = this._evalFSM(dt, nearbyFood, fleeTarget,
                                pursueTarget, avoidNormal);

    // ── STEP 3 — Steering force ───────────────────────────
    let force = this._computeForce(dt, nearbyFood, fleeTarget,
                                    pursueTarget, avoidNormal);

    // ── STEP 4 — Wall avoidance (always added) ────────────
    // Wall force is applied on top of everything and is NOT
    // gated by state — the snake must always avoid the wall.
    const wallForce = this._wallAvoidForce();
    if (wallForce) force = force.add(wallForce);

    // ── STEP 5 — Clamp & blend ────────────────────────────
    const clamped = force.clamp(this.MAX_FORCE);
    const lerpT   = Math.min(1, this.STEER_LERP * dt);
    this.dir = this.dir.lerp(this.dir.add(clamped), lerpT).normalize();

    // ── STEP 6 — Move ─────────────────────────────────────
    // Refresh length-scaled speed each tick so it tracks growth.
    this.speed = this._calcSpeed(BASE_SPEED);
    this._applyDirection(dt);
    this._moveSegments();
    this._grow();
  }

  /* ═══════════════════════════════════════════════════════
     STEP 1: SENSE — gather environment data
     Returns a plain object so _evalFSM and _computeForce
     can both read the same snapshot without re-querying.
  ═══════════════════════════════════════════════════════ */
  _sense(dt) {
    // ── Food ──────────────────────────────────────────────
    const nearbyFood = this.foodGrid.query(
      this.head.x, this.head.y,
      this.FOOD_RADIUS,
      this._nearby
    );

    // ── Nearby snake heads ────────────────────────────────
    // Walk the shared snakes array directly (no second grid
    // needed — AI_COUNT is small, O(n) is fine here).
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
        // Noticeably larger → potential threat
        if (dsq < closestFleeDistSq) {
          closestFleeDistSq = dsq;
          fleeTarget = other;
        }
      } else if (sizeDiff < -8) {
        // Noticeably smaller → potential prey
        if (dsq < closestPursueDistSq) {
          closestPursueDistSq = dsq;
          pursueTarget = other;
        }
      }
    }

    // ── Body obstacle detection (ray-march) ───────────────
    // Cast LOOKAHEAD_STEPS rays ahead along current direction.
    // If any step lands within SEGMENT_R*2 of a foreign body
    // segment, compute an escape normal (perpendicular to dir).
    let avoidNormal = null;

    outerLoop:
    for (let step = 1; step <= this.LOOKAHEAD_STEPS; step++) {
      const probeX = this.head.x + this.dir.x * this.LOOKAHEAD_DIST * step;
      const probeY = this.head.y + this.dir.y * this.LOOKAHEAD_DIST * step;
      const hitRadSq = (SEGMENT_R * 2.2) * (SEGMENT_R * 2.2);

      for (const other of this.snakes) {
        if (other === this || !other.alive) continue;

        // Quick head-distance cull before scanning all segments
        if (Vector2.distSq(this.head, other.head) >
            (this.BODY_SENSE_R + other.length * SEGMENT_GAP) *
            (this.BODY_SENSE_R + other.length * SEGMENT_GAP)) continue;

        for (const seg of other.segments) {
          const dx  = probeX - seg.x;
          const dy  = probeY - seg.y;
          if (dx * dx + dy * dy < hitRadSq) {
            // Escape normal: perpendicular to current direction.
            // Pick left/right based on which side the segment is on.
            const dot = -this.dir.y * dx + this.dir.x * dy;
            const sign = dot >= 0 ? 1 : -1;
            avoidNormal = new Vector2(-this.dir.y * sign, this.dir.x * sign);
            break outerLoop;
          }
        }
      }
    }

    // Cache for use in _computeForce (avoids duplicate sensing)
    this._fleeTarget   = fleeTarget;
    this._pursueTarget = pursueTarget;
    this._avoidNormal  = avoidNormal;

    return { nearbyFood, fleeTarget, pursueTarget, avoidNormal };
  }

  /* ═══════════════════════════════════════════════════════
     STEP 2: EVALUATE FSM
     Uses hysteresis timers to prevent jitter between states.
     Each trigger condition accumulates time while true;
     a state transition only fires once the threshold is met.

     Priority (descending):
       AVOID > FLEE > PURSUE > SEEK_FOOD > WANDER
  ═══════════════════════════════════════════════════════ */
  _evalFSM(dt, nearbyFood, fleeTarget, pursueTarget, avoidNormal) {

    // ── Accumulate hysteresis timers ──────────────────────
    // Positive = condition was true this frame (tick up).
    // Negative = condition was false (tick down toward 0).

    const tick = (key, condition) => {
      if (condition) {
        this._hyst[key] = Math.min(
          this._hyst[key] + dt,
          HYSTERESIS[key].enter + 0.1   // cap prevents runaway accumulation
        );
      } else {
        this._hyst[key] = Math.max(0, this._hyst[key] - dt);
      }
    };

    tick('AVOID',     avoidNormal  !== null);
    tick('FLEE',      fleeTarget   !== null);
    tick('PURSUE',    pursueTarget !== null);
    tick('SEEK_FOOD', nearbyFood.length > 0);

    // ── Check entry thresholds (priority order) ───────────
    // Highest-priority check wins; lower checks not reached.

    if (this._hyst['AVOID'] >= HYSTERESIS.AVOID.enter) {
      return AI_STATE.AVOID;
    }

    if (this._hyst['FLEE'] >= HYSTERESIS.FLEE.enter) {
      return AI_STATE.FLEE;
    }

    if (this._hyst['PURSUE'] >= HYSTERESIS.PURSUE.enter) {
      return AI_STATE.PURSUE;
    }

    if (this._hyst['SEEK_FOOD'] >= HYSTERESIS.SEEK_FOOD.enter) {
      return AI_STATE.SEEK_FOOD;
    }

    // ── Exit hysteresis: stay in current state for exit period ──
    // If we're in a tactical state but no longer trigger it,
    // hold briefly before dropping back to WANDER/SEEK_FOOD.
    // (The tick() above already drains the accumulator; by the
    //  time it reaches 0 the exit threshold has passed.)

    return AI_STATE.WANDER;
  }

  /* ═══════════════════════════════════════════════════════
     STEP 3: COMPUTE FORCE
     Each state contributes a weighted steering vector.
     Weights encode priority: AVOID (2.0) > FLEE (1.8) >
     PURSUE (1.2) > SEEK_FOOD (1.0) > WANDER (0.6).
     These are intentionally different so force.clamp() in
     Step 5 also acts as a soft priority filter.
  ═══════════════════════════════════════════════════════ */
  _computeForce(dt, nearbyFood, fleeTarget, pursueTarget, avoidNormal) {

    switch (this.state) {

      // ── AVOID — forced perpendicular turn ─────────────────
      // Strongest weight (2.0) so it overrides everything except
      // wall avoidance (which is added on top afterwards).
      case AI_STATE.AVOID: {
        if (!avoidNormal) return this.wander(dt).scale(0.6); // defensive fallback
        return avoidNormal.scale(2.0);
      }

      // ── FLEE — evade the threatening snake ────────────────
      // evade() is the inverse of pursue(): we predict where
      // the threat is moving TOWARD us and steer away from that
      // future position, not just away from their current head.
      case AI_STATE.FLEE: {
        if (!fleeTarget) return this.wander(dt).scale(0.6);
        return this.evade(fleeTarget).scale(1.8);
      }

      // ── PURSUE — intercept a smaller snake ────────────────
      // pursue() projects the target's future position and seeks
      // that intercept point. Aiming ahead of them naturally
      // "cuts off" their path without needing extra logic.
      case AI_STATE.PURSUE: {
        if (!pursueTarget) return this.wander(dt).scale(0.6);
        return this.pursue(pursueTarget).scale(1.2);
      }

      // ── SEEK_FOOD — nearest food target ───────────────────
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

      // ── WANDER — default organic movement ─────────────────
      default:
        return this.wander(dt).scale(0.6);
    }
  }

  /* ═══════════════════════════════════════════════════════
     STEERING BEHAVIOURS
  ═══════════════════════════════════════════════════════ */

  /**
   * seek — steer toward a world-space position.
   * Standard Reynolds formula: desired_dir - current_dir.
   */
  seek(targetPos) {
    const desired = targetPos.sub(this.head).normalize();
    return desired.sub(this.dir);
  }

  /**
   * flee — steer directly away from a position. Inverse seek.
   * Used internally; FLEE state uses evade() instead.
   */
  flee(targetPos) {
    return this.seek(targetPos).scale(-1);
  }

  /**
   * pursue — predictive intercept toward a moving target.
   *
   * Algorithm:
   *  1. Compute the Euclidean distance to the target head.
   *  2. Estimate time-to-reach: dist / this.speed  (in seconds).
   *  3. Project the target's future position: head + dir*speed*t.
   *  4. Seek that future position.
   *
   * Why this cuts off the target:
   *  Instead of chasing their current position (which always
   *  lags behind), we aim at where they'll BE. Because we're
   *  steering toward a point AHEAD of them, our arc naturally
   *  crosses their path — a geometric cut-off.
   *
   * Jitter prevention:
   *  When the target is very close (dist < 60px) the lookahead
   *  collapses to ~0 s and we just seek directly. This avoids
   *  the intercept point oscillating when the target is nearly
   *  stationary relative to us.
   *
   * @param {Snake} target  The snake to pursue.
   */
  pursue(target) {
    const toTarget = target.head.sub(this.head);
    const dist     = toTarget.length();

    // Predict ahead proportional to distance / our own speed.
    // Cap at 1.5 s so intercept doesn't fly too far off-screen.
    const lookAheadT = Math.min(dist / (this.speed || BASE_SPEED), 1.5);

    // If target is nearly stationary or very close, just seek its head.
    const futurePos = dist > 60
      ? target.head.add(target.dir.scale(target.speed * lookAheadT))
      : target.head;

    return this.seek(futurePos);
  }

  /**
   * evade — predictive escape from a moving threat.
   *
   * Mirrors pursue(): we project where the threat WILL be, then
   * flee from that future position instead of their current one.
   *
   * Why not just flee(threat.head)?
   *  A naive flee aims directly away from the current head, but
   *  a smart pursuer will have steered since last frame. Evading
   *  the predicted position steers AWAY from where they're heading,
   *  which is consistently more effective and feels more natural.
   *
   * @param {Snake} threat  The snake to evade.
   */
  evade(threat) {
    const toThreat    = threat.head.sub(this.head);
    const dist        = toThreat.length();
    const lookAheadT  = Math.min(dist / (this.speed || BASE_SPEED), 1.5);

    const futurePos = dist > 60
      ? threat.head.add(threat.dir.scale(threat.speed * lookAheadT))
      : threat.head;

    return this.flee(futurePos);
  }

  /**
   * wander — smooth organic movement via Reynolds wander circle.
   * (Unchanged from Phase 2 — it works; don't break it.)
   */
  wander(dt) {
    this._wanderAngle += (Math.random() - 0.5) * this._wanderJitter * dt * 60;

    const circleCentre = this.dir.scale(this._wanderDist);
    const displacement = Vector2.fromAngle(this._wanderAngle, this._wanderRadius);

    const target = this.head.add(circleCentre).add(displacement);
    return this.seek(target);
  }

  /**
   * _wallAvoidForce — repulsion from world boundaries.
   * Unchanged from Phase 2. Applied on top of FSM force
   * in Step 4 so it cannot be suppressed by any state.
   */
  _wallAvoidForce() {
    const MARGIN_OUTER = 160;
    const MARGIN_INNER = 60;

    let px = 0, py = 0;
    const hx = this.head.x, hy = this.head.y;

    const push = (dist) =>
      dist < MARGIN_OUTER
        ? (1 - Math.max(0, (dist - MARGIN_INNER) / (MARGIN_OUTER - MARGIN_INNER)))
        : 0;

    px +=  push(hx);              // near left wall  → push right
    px -=  push(WORLD_W - hx);   // near right wall  → push left
    py +=  push(hy);              // near top wall    → push down
    py -=  push(WORLD_H - hy);   // near bottom wall → push up

    if (px === 0 && py === 0) return null;

    const len = Math.sqrt(px * px + py * py);
    return new Vector2(px / len, py / len).scale(0.3);
  }
}

/* ─────────────────────────────────────────────────────────────
   8. GAME — orchestrates everything
───────────────────────────────────────────────────────────── */

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

    // DOM refs
    this.overlay      = document.getElementById('overlay');
    this.scoreDisplay = document.getElementById('score-display');
    this.finalScore   = document.getElementById('final-score');
    this.startBtn     = document.getElementById('start-btn');
    this.hudScore     = document.getElementById('hud-score');
    this.hudLength    = document.getElementById('hud-length');

    // NEW: heart elements for lives HUD
    this._heartEls = [
      document.getElementById('heart-1'),
      document.getElementById('heart-2'),
      document.getElementById('heart-3'),
    ];

    // Camera: top-left of viewport in world coords
    this.camX = 0;
    this.camY = 0;

    this.running  = false;
    this.snakes   = [];
    this.foods    = [];
    this.foodGrid = null;
    this.particles = new ParticlePool();

    // NEW: AudioManager (lazy-inits on first click)
    this.audio = new AudioManager();

    // Delta-time tracking
    this._lastTime  = 0;
    this._rafId     = null;
    this._boundLoop = this._loop.bind(this);

    // Scratch arrays — allocated once, reused every frame
    this._foodQueryBuf = [];
    this._killList     = [];

    window._GAME_WORLD = { w: WORLD_W, h: WORLD_H };

    this._setupResize();
    this._setupInput();
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

    // Mouse move
    this.canvas.addEventListener('mousemove', e => {
      this._pointer.x = e.clientX;
      this._pointer.y = e.clientY;
    });

    // Boost: hold left mouse / touch
    this.canvas.addEventListener('mousedown',  () => { if (this.player) this.player.boosting = true;  });
    this.canvas.addEventListener('mouseup',    () => { if (this.player) this.player.boosting = false; });
    this.canvas.addEventListener('mouseleave', () => { if (this.player) this.player.boosting = false; });

    // Touch steer + boost (long-touch threshold not needed — any touch = boost in Slither)
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

  /* ── START / RESET ──────────────────────────────────────── */
  startGame() {
    this.overlay.classList.add('hidden');
    this.scoreDisplay.style.display = 'none';
    this.startBtn.textContent = 'Play Again';

    // Reset lives HUD
    this._heartEls.forEach(el => el.classList.remove('lost'));

    // Spatial grid: cell = 2× food detection radius
    this.foodGrid = new SpatialGrid(WORLD_W, WORLD_H, 360);

    this.snakes = [];
    this.player = new PlayerSnake(WORLD_W / 2, WORLD_H / 2);
    this.snakes.push(this.player);

    for (let i = 0; i < AI_COUNT; i++) {
      const [body, head] = AI_PALETTES[i % AI_PALETTES.length];
      const x = 300 + Math.random() * (WORLD_W - 600);
      const y = 300 + Math.random() * (WORLD_H - 600);
      this.snakes.push(new AISnake(x, y, body, head, this.foodGrid, this.snakes));
    }

    this.foods = [];
    for (let i = 0; i < FOOD_COUNT; i++) this._spawnFood();

    // Restart background music
    this.audio.stopBg();
    this.audio.stopPanic();
    this.audio.playBg();

    this.running   = true;
    this._lastTime = performance.now();
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = requestAnimationFrame(this._boundLoop);
  }

  /* ── FOOD ───────────────────────────────────────────────── */
  /**
   * Spawn a food pellet, with a rare chance to be a powerup.
   * @param {string|null} forceType  — pass FOOD_TYPE.MAGNET etc. to override
   * @param {number|null} x
   * @param {number|null} y
   */
  _spawnFood(forceType = null, x = null, y = null) {
    const fx  = x  ?? (50 + Math.random() * (WORLD_W - 100));
    const fy  = y  ?? (50 + Math.random() * (WORLD_H - 100));
    const col = FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)];

    let type = forceType;
    if (!type) {
      const roll = Math.random();
      if      (roll < POWERUP_SPAWN_RATE)             type = FOOD_TYPE.MAGNET;
      else if (roll < POWERUP_SPAWN_RATE * 2)         type = FOOD_TYPE.ATTACK;
      else                                             type = FOOD_TYPE.NORMAL;
    }

    const f = new Food(fx, fy, col, type);
    this.foods.push(f);
    this.foodGrid.add(f);
    return f;
  }

  _removeFood(food) {
    this.foodGrid.remove(food);
    // Swap-remove: O(1) instead of O(n) splice
    const idx = this.foods.indexOf(food);
    if (idx !== -1) {
      this.foods[idx] = this.foods[this.foods.length - 1];
      this.foods.pop();
    }
  }

  /* ── MAIN LOOP ──────────────────────────────────────────── */
  _loop(timestamp) {
    if (!this.running) return;

    // ── Delta time ──────────────────────────────────────────
    // Cap at 100ms to prevent spiral-of-death on tab switch/lag
    const rawDt = (timestamp - this._lastTime) / 1000;
    const dt    = Math.min(rawDt, 0.1);
    this._lastTime = timestamp;

    this._update(dt);
    this._render();

    this._rafId = requestAnimationFrame(this._boundLoop);
  }

  /* ── UPDATE ─────────────────────────────────────────────── */
  _update(dt) {

    // ── Player ──────────────────────────────────────────────
    if (this.player.alive) {
      this.player.pointer.x = this._pointer.x;
      this.player.pointer.y = this._pointer.y;
      this.player.update(dt, this.camX, this.camY);
    }

    // ── AI ──────────────────────────────────────────────────
    for (let i = 1; i < this.snakes.length; i++) {
      this.snakes[i].update(dt);
    }

    // ── Smooth camera follow ─────────────────────────────────
    if (this.player.alive) {
      const targetX = this.player.head.x - this.canvas.width  / 2;
      const targetY = this.player.head.y - this.canvas.height / 2;
      const camT = Math.min(1, 7 * dt);
      this.camX += (targetX - this.camX) * camT;
      this.camY += (targetY - this.camY) * camT;
    }

    // ── MAGNET: pull nearby food toward player head ───────────
    if (this.player.alive && this.player.magnetTimer > 0) {
      this.foodGrid.query(
        this.player.head.x, this.player.head.y,
        MAGNET_RADIUS,
        this._foodQueryBuf
      );
      for (const food of this._foodQueryBuf) {
        // Only pull normal food (powerups stay put)
        if (food.type !== FOOD_TYPE.NORMAL) continue;

        const dx   = this.player.head.x - food.pos.x;
        const dy   = this.player.head.y - food.pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;

        // Pull strength falls off with distance
        const strength = (1 - dist / MAGNET_RADIUS) * MAGNET_PULL_FORCE * dt;

        // Remove from old grid cell, update position, re-insert
        this.foodGrid.remove(food);
        food.pos.x += (dx / dist) * strength;
        food.pos.y += (dy / dist) * strength;
        this.foodGrid.add(food);
      }
    }

    // ── Food collision ───────────────────────────────────────
    const eaten = [];
    for (const snake of this.snakes) {
      if (!snake.alive) continue;
      const isPlayer = snake === this.player;
      // Powerups have larger radius so widen the query a bit
      const queryR = isPlayer ? 40 : 30;
      this.foodGrid.query(snake.head.x, snake.head.y, queryR, this._foodQueryBuf);

      for (const food of this._foodQueryBuf) {
        const dsq  = Vector2.distSq(snake.head, food.pos);
        const rSum = SEGMENT_R + food.radius;
        if (dsq >= rSum * rSum) continue;

        // ── Player eating a powerup ────────────────────────
        if (isPlayer) {
          if (food.type === FOOD_TYPE.MAGNET) {
            this.player.activateMagnet();
            eaten.push(food);
            this._spawnFood(FOOD_TYPE.NORMAL);   // replace with a normal food
            continue;
          }
          if (food.type === FOOD_TYPE.ATTACK) {
            this.player.activateAttack();
            eaten.push(food);
            this._spawnFood(FOOD_TYPE.NORMAL);
            continue;
          }
        }

        // ── Regular food consumption ───────────────────────
        const mult = 1 + Math.floor(snake.length / 20);
        snake.eat(mult);
        eaten.push(food);

        // Play eat SFX only for player
        if (isPlayer) this.audio.playEat();
      }
    }
    for (const f of eaten) {
      this._removeFood(f);
      // Only respawn if it was a normal food (powerups were already replaced above)
      if (f.type === FOOD_TYPE.NORMAL) this._spawnFood();
    }

    // ── Wall collision ───────────────────────────────────────
    for (const snake of this.snakes) {
      if (!snake.alive) continue;
      const h = snake.head;
      if (h.x < 0 || h.x > WORLD_W || h.y < 0 || h.y > WORLD_H) {
        this._killSnake(snake);
      }
    }

    // ── Snake-vs-snake collision ─────────────────────────────
    this._checkSnakeCollisions();

    // ── Particles ────────────────────────────────────────────
    this.particles.update(dt);

    // ── Respawn dead AI ──────────────────────────────────────
    for (let i = 1; i < this.snakes.length; i++) {
      if (!this.snakes[i].alive) {
        const [body, head] = AI_PALETTES[i % AI_PALETTES.length];
        const x = 300 + Math.random() * (WORLD_W - 600);
        const y = 300 + Math.random() * (WORLD_H - 600);
        this.snakes[i] = new AISnake(x, y, body, head, this.foodGrid, this.snakes);
      }
    }

    // ── Panic audio — last life warning ──────────────────────
    if (this.player.alive && this.player.lives === 1) {
      this.audio.startPanic();
    } else {
      this.audio.stopPanic();
    }

    // ── HUD ─────────────────────────────────────────────────
    if (this.player.alive) {
      this.hudScore.textContent  = `Score: ${this.player.score}`;
      this.hudLength.textContent = `Length: ${this.player.length}`;
      this._updateLivesHUD();
    }
  }

  /** Sync heart icons with player.lives */
  _updateLivesHUD() {
    const lives = this.player.lives;
    this._heartEls.forEach((el, i) => {
      if (i < lives) {
        el.classList.remove('lost');
      } else {
        el.classList.add('lost');
      }
    });
  }

  /**
   * Flash the game canvas to signal a life lost.
   * Adds a red-flash CSS class and removes it after the animation.
   */
  _flashLifeLost() {
    document.body.classList.remove('life-lost-flash');
    // Force reflow so re-adding the class restarts animation
    void document.body.offsetWidth;
    document.body.classList.add('life-lost-flash');
  }

  /**
   * Respawn player after losing a life.
   * Resets position to a safe zone near world centre and grants i-frames.
   */
  _respawnPlayer() {
    const p = this.player;

    // Pick a random point within the safe centre band
    const safeX = WORLD_W / 2 + (Math.random() - 0.5) * 400;
    const safeY = WORLD_H / 2 + (Math.random() - 0.5) * 400;

    // Reset segments around the new spawn point
    p.segments = [];
    for (let i = 0; i < 12; i++) {
      p.segments.push(new Vector2(safeX - i * SEGMENT_GAP, safeY));
    }
    p.pos.x   = safeX;
    p.pos.y   = safeY;
    p.dir     = new Vector2(1, 0);
    p.alive   = true;

    // Reset power-ups on respawn (keeps things fair)
    p.magnetTimer = 0;
    p.attackTimer = 0;

    // Grant invincibility frames
    p.iFrameTimer = IFRAME_DURATION;
  }

  /* ── KILL SNAKE (with death FX) ─────────────────────────── */
  /**
   * NEW BEHAVIOUR for the player:
   *   • If lives > 1: lose a life, flash screen, respawn with i-frames.
   *   • If lives === 1 (last life): actual game over.
   * AI snakes still die instantly and drop food as before.
   */
  _killSnake(snake) {
    if (!snake.alive) return;

    // ── Player: lives system ──────────────────────────────
    if (snake === this.player) {
      // If currently invincible, ignore the kill
      if (this.player.invincible) return;

      this.player.lives--;
      this._updateLivesHUD();
      this._flashLifeLost();

      if (this.player.lives <= 0) {
        // No more lives → true game over
        snake.alive = false;
        this.particles.burst(snake.segments, snake.headColor);
        this.audio.playGameOver();
        this._gameOver();
      } else {
        // Lives remaining → respawn
        this._respawnPlayer();
      }
      return;
    }

    // ── AI / normal death ─────────────────────────────────
    snake.alive = false;
    this.particles.burst(snake.segments, snake.headColor);

    // Drop food pellets along the body (every 3rd segment)
    for (let i = 0; i < snake.segments.length; i += 3) {
      const seg = snake.segments[i];
      if (seg.x > 10 && seg.x < WORLD_W - 10 &&
          seg.y > 10 && seg.y < WORLD_H - 10) {
        const col = FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)];
        const f   = new Food(
          seg.x + (Math.random() - 0.5) * 10,
          seg.y + (Math.random() - 0.5) * 10,
          col,
          FOOD_TYPE.NORMAL
        );
        this.foods.push(f);
        this.foodGrid.add(f);
      }
    }
  }

  /* ── SNAKE VS SNAKE COLLISION ───────────────────────────── */
  /**
   * Rules (everything from Phase 2 retained, two additions):
   *
   * NEW 1 — I-FRAMES
   *   Player with active iFrameTimer is immune to all collisions.
   *
   * NEW 2 — ATTACK MODE (player.attackTimer > 0)
   *   When the player's head hits a body segment of an AI snake,
   *   instead of the player dying, a "segment shatter" occurs:
   *   all segments from the hit point to the tail are severed
   *   and converted to food.  The AI snake survives but shrinks.
   *   If it would be reduced below 5 segments it is fully killed.
   *
   * Original rules (unchanged for non-attack, non-i-frame cases):
   *   1. Self-collision disabled.
   *   2. Head-vs-Body → head's owner dies.
   *   3. Head-to-Head size upset via H2H_UPSET_THRESHOLD.
   */
  _checkSnakeCollisions() {
    const KILL_DSQ = (SEGMENT_R * 1.8) * (SEGMENT_R * 1.8);
    const HEAD_DSQ = (SEGMENT_R * 2.8) * (SEGMENT_R * 2.8);

    const killSet    = new Set();
    // Segments-to-shatter: { snake, fromIndex } — attack mode hit
    const shatterList = [];

    const playerInAttack = this.player.alive && this.player.attackTimer > 0;

    for (let a = 0; a < this.snakes.length; a++) {
      const sa = this.snakes[a];
      if (!sa.alive || killSet.has(sa)) continue;

      // Player with i-frames is immune
      if (sa === this.player && this.player.invincible) continue;

      for (let b = 0; b < this.snakes.length; b++) {
        if (a === b) continue;
        const sb = this.snakes[b];
        if (!sb.alive || killSet.has(sb)) continue;

        const headDsq = Vector2.distSq(sa.head, sb.head);
        if (headDsq > 1000 * 1000) continue;

        // ── Head-to-Head ──────────────────────────────────
        if (headDsq <= HEAD_DSQ) {
          if (a < b) {
            const sizeDiff = sa.segments.length - sb.segments.length;
            if (sizeDiff > H2H_UPSET_THRESHOLD) {
              killSet.add(sa);
            } else if (sizeDiff < -H2H_UPSET_THRESHOLD) {
              killSet.add(sb);
            } else {
              killSet.add(sa);
              killSet.add(sb);
            }
          }
          continue;
        }

        // ── Head-vs-Body ──────────────────────────────────
        for (let s = 1; s < sb.segments.length; s++) {
          if (Vector2.distSq(sa.head, sb.segments[s]) >= KILL_DSQ) continue;

          // ATTACK MODE: player's head hits AI body → shatter that AI
          if (sa === this.player && playerInAttack && sb !== this.player) {
            shatterList.push({ snake: sb, fromIndex: s });
          } else {
            // Normal rule: sa (the head) dies
            killSet.add(sa);
          }
          break;
        }
      }
    }

    // ── Apply kills ───────────────────────────────────────
    for (const s of killSet) this._killSnake(s);

    // ── Apply attack shatters ─────────────────────────────
    for (const { snake, fromIndex } of shatterList) {
      if (!snake.alive) continue;

      const MIN_SURVIVE = 5;
      if (fromIndex <= MIN_SURVIVE) {
        // Hit so close to the head that the whole snake dies
        this._killSnake(snake);
        continue;
      }

      // Sever tail from fromIndex onward → drop as food
      const severed = snake.segments.splice(fromIndex);
      this.particles.burst(severed, snake.headColor);

      for (let i = 0; i < severed.length; i += 2) {
        const seg = severed[i];
        if (seg.x > 10 && seg.x < WORLD_W - 10 &&
            seg.y > 10 && seg.y < WORLD_H - 10) {
          const col = FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)];
          this.foods.push(new Food(
            seg.x + (Math.random() - 0.5) * 8,
            seg.y + (Math.random() - 0.5) * 8,
            col,
            FOOD_TYPE.NORMAL
          ));
          this.foodGrid.add(this.foods[this.foods.length - 1]);
        }
      }
    }
  }

  /* ── GAME OVER ──────────────────────────────────────────── */
  _gameOver() {
    this.running = false;
    this.finalScore.textContent = this.player.score;
    this.scoreDisplay.style.display = 'block';
    this.overlay.classList.remove('hidden');
    // Stop looping audio
    this.audio.stopBg();
    this.audio.stopPanic();
  }

  /* ── RENDER ─────────────────────────────────────────────── */
  _render() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    this._drawBackground();
    this._drawWorldBorder();

    // Magnet aura ring (drawn under food so it feels ambient)
    if (this.player && this.player.alive && this.player.magnetTimer > 0) {
      this._drawMagnetAura();
    }

    // Food — one ctx.save wraps all pellets
    ctx.save();
    for (const food of this.foods) food.draw(ctx, this.camX, this.camY);
    ctx.restore();

    // Snakes
    for (const snake of this.snakes) snake.draw(ctx, this.camX, this.camY);

    // Particles
    this.particles.draw(ctx, this.camX, this.camY);

    // Minimap + wall warning last (always on top)
    this._drawMinimap();
    if (this.player.alive) this._drawWallWarning();
  }

  /**
   * Draw a pulsing teal ring at the magnet pull radius
   * centred on the player head.
   */
  _drawMagnetAura() {
    const { ctx } = this;
    const hx = this.player.head.x - this.camX;
    const hy = this.player.head.y - this.camY;
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.004);

    ctx.save();
    ctx.strokeStyle = `rgba(0,200,255,${(0.12 + pulse * 0.12).toFixed(2)})`;
    ctx.lineWidth   = 2;
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -Date.now() * 0.05; // animated marching ants
    ctx.shadowColor = '#00ccff';
    ctx.shadowBlur  = 10;
    ctx.beginPath();
    ctx.arc(hx, hy, MAGNET_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* ── BACKGROUND ─────────────────────────────────────────── */
  _drawBackground() {
    const { ctx, canvas } = this;
    ctx.fillStyle = '#050a0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Dot grid scrolls with camera for parallax feel
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

  /* ── WORLD BORDER ───────────────────────────────────────── */
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

  /**
   * WALL WARNING — red vignette when player is near the edge.
   * Intensity scales with proximity so it ramps up gradually.
   */
  _drawWallWarning() {
    const { ctx, canvas } = this;
    if (!this.player.alive) return;

    const DANGER_ZONE = 250;
    const hx = this.player.head.x;
    const hy = this.player.head.y;

    const nearest = Math.min(hx, WORLD_W - hx, hy, WORLD_H - hy);
    if (nearest >= DANGER_ZONE) return;

    const intensity = (1 - nearest / DANGER_ZONE) * 0.5;

    const grad = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, canvas.height * 0.3,
      canvas.width / 2, canvas.height / 2, canvas.height * 0.8
    );
    grad.addColorStop(0, 'rgba(255,40,40,0)');
    grad.addColorStop(1, `rgba(255,40,40,${intensity.toFixed(2)})`);

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * MINIMAP — top-right corner.
   * Shows all snakes + foods at 1:MAP_SCALE scale.
   * Only the player gets a bright marker.
   */
  _drawMinimap() {
    const { ctx, canvas } = this;
    const MAP_W    = 150;
    const MAP_H    = 150;
    const MAP_PAD  = 14;
    const MAP_X    = canvas.width  - MAP_W - MAP_PAD;
    const MAP_Y    = MAP_PAD;
    const SCALE_X  = MAP_W / WORLD_W;
    const SCALE_Y  = MAP_H / WORLD_H;

    ctx.save();

    // Background
    ctx.fillStyle   = 'rgba(5,10,15,0.7)';
    ctx.strokeStyle = 'rgba(126,255,178,0.25)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.roundRect(MAP_X, MAP_Y, MAP_W, MAP_H, 6);
    ctx.fill();
    ctx.stroke();

    // Clip to map bounds so snakes don't bleed outside
    ctx.beginPath();
    ctx.roundRect(MAP_X, MAP_Y, MAP_W, MAP_H, 6);
    ctx.clip();

    // Foods as tiny dots
    ctx.fillStyle = 'rgba(126,255,178,0.3)';
    for (const f of this.foods) {
      ctx.fillRect(
        MAP_X + f.pos.x * SCALE_X - 0.5,
        MAP_Y + f.pos.y * SCALE_Y - 0.5,
        1.5, 1.5
      );
    }

    // AI snakes as coloured dots
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

    // Player — bright + larger
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

      // Viewport rectangle on minimap
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
