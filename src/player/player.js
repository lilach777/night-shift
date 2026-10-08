import * as THREE from 'three';
import { settings } from '../core/settings.js';
import { clamp, damp, wrapAngle } from '../core/util.js';
import { audio } from '../audio/audio.js';
import { MANIFEST } from '../audio/manifest.js';
import { Track } from '../core/curves.js';

const STAND = 1.62, CROUCH = 1.02;
export const STAMINA_SECONDS = 14;        // seconds of sprint from full
const STAMINA_REGEN_DELAY = 1.1;          // pause before stamina starts to come back
// distance per footstep -> cadence: walk 2.45 m/s / 1.1 m = 2.2 steps/s (brisk walk),
// sprint 5.1 m/s / 1.75 m = 2.9 steps/s, crouch 1.25 m/s / 0.62 m = 2 steps/s
const STRIDE = { walk: 1.1, run: 1.75, crouch: 0.62 };

export class Player {
  constructor(camera, physics, input) {
    this.camera = camera;
    this.physics = physics;
    this.input = input;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.eye = STAND;
    this.crouching = false;
    this.stamina = 1;
    this.exhausted = false;
    this.canMove = true; this.canLook = true;
    this.seated = null;          // {yaw, range}
    this.stepDist = 0; this.bobPhase = 0; this.bobAmt = 0;
    this.shakeT = 0; this.shakeAmp = 0;
    this.vy = 0;
    this.level = '1';
    this.sprinting = false; this.moving = false;
    this.lookOverride = null;    // {yaw, pitch, speed}
    this.extraRoll = 0;
    this.speedMul = 1;
    this.bodies = [];            // () => Vector3 | null : solid bodies to collide with
  }

  teleport(x, y, z, yaw = this.yaw, pitch = 0) {
    this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.yaw = yaw; this.pitch = pitch; this.vy = 0;
    this.level = this.physics.levelOf(y);
  }

  shake(amp = 0.5, time = 0.4) {
    if (!settings.data.gameplay.screenShake) return;
    const scale = settings.data.accessibility.cameraShake ? 1 : 0.25;
    this.shakeAmp = Math.max(this.shakeAmp, amp * scale); this.shakeT = Math.max(this.shakeT, time);
  }

  sit(chair) {
    this.seated = { yaw: chair.yaw, range: 1.3 };
    this.pos.set(chair.x, chair.y, chair.z);
    this.yaw = chair.yaw; this.pitch = -0.12;
  }
  stand() { this.seated = null; }

  get forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  update(dt) {
    const inp = this.input;
    const gp = settings.data.gameplay;
    // ---------------------------------------------------------------- look
    const [mx, my] = inp.consumeMouse();
    if (this.lookOverride) {
      this.updateLookCurve(this.lookOverride, dt);
    } else if (this._look?.track && this._look.t < this._look.track.duration && Math.abs(mx) + Math.abs(my) < 0.5) {
      // released mid-move: let the authored move land instead of freezing (mouse input takes over)
      this.updateLookCurve(this._lookFor, dt);
    } else if (this.canLook) {
      if (this._look) { this._look = null; this._lookFor = null; }
      const s = 0.0021 * gp.sensitivity;
      this.yaw -= mx * s;
      this.pitch -= my * s * (gp.invertY ? -1 : 1);
      this.pitch = clamp(this.pitch, -1.45, 1.45);
      if (this.seated) {
        const d = wrapAngle(this.yaw - this.seated.yaw);
        this.yaw = this.seated.yaw + clamp(d, -this.seated.range, this.seated.range);
        this.pitch = clamp(this.pitch, -0.9, 0.6);
      }
    }
    // ---------------------------------------------------------------- move
    let fx = 0, fz = 0;
    if (this.canMove && !this.seated) {
      if (inp.down('KeyW')) fz -= 1;
      if (inp.down('KeyS')) fz += 1;
      if (inp.down('KeyA')) fx -= 1;
      if (inp.down('KeyD')) fx += 1;
    }
    const wantCrouch = this.canMove && (inp.down('ControlLeft') || inp.down('ControlRight') || inp.down('KeyC'));
    this.crouching = wantCrouch && !this.seated;
    const len = Math.hypot(fx, fz);
    this.moving = len > 0;
    const wantSprint = this.moving && !this.crouching && inp.down('ShiftLeft') && fz < 0 && !this.exhausted && this.stamina > 0;
    this.sprinting = wantSprint;
    // Stamina: ~14 s of continuous sprinting from full. Walking neither drains nor (quickly)
    // refills it; after sprinting there is a short delay before it starts to recover.
    // Empty -> exhausted: no sprinting until it has recovered to 30 %.
    if (this.sprinting) {
      this.stamina -= dt / STAMINA_SECONDS;
      this.staminaDelay = STAMINA_REGEN_DELAY;
      if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; this.staminaDelay = STAMINA_REGEN_DELAY * 1.6; }
    } else if ((this.staminaDelay = Math.max(0, (this.staminaDelay || 0) - dt)) <= 0) {
      const regen = !this.moving ? 1 / 7 : this.crouching ? 1 / 9 : 1 / 13;   // full in 7 s still / 13 s walking
      this.stamina = Math.min(1, this.stamina + dt * regen);
    }
    if (this.exhausted && this.stamina > 0.3) this.exhausted = false;
    const speed = (this.crouching ? 1.25 : this.sprinting ? 5.1 : 2.45) * this.speedMul;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    let wx = 0, wz = 0;
    if (len > 0) { const nx = fx / len, nz = fz / len; wx = nx * cy + nz * sy; wz = -nx * sy + nz * cy; }
    const accel = this.moving ? 11 : 9;
    this.vel.x = damp(this.vel.x, wx * speed, accel, dt);
    this.vel.z = damp(this.vel.z, wz * speed, accel, dt);
    if (this.seated) { this.vel.set(0, 0, 0); }
    const before = this.pos.clone();
    if (this.seated) { /* no movement */ }
    else {
      // sub-stepped sweep: never advance more than 0.12 m between collision solves, so a long
      // frame at sprint speed cannot tunnel through a thin wall or a door edge
      const h = this.crouching ? 1.15 : 1.75;
      const dist = Math.hypot(this.vel.x, this.vel.z) * dt;
      const n = Math.min(8, Math.max(1, Math.ceil(dist / 0.12)));
      for (let i = 0; i < n; i++) {
        this.pos.x += this.vel.x * dt / n;
        this.pos.z += this.vel.z * dt / n;
        this.physics.collide(this.pos, 0.3, h);
      }
      // keep only the velocity that actually happened: no stored momentum into walls, and
      // a natural slide along them (with a little contact friction)
      if (dt > 0 && dist > 1e-5) {
        const ax = (this.pos.x - before.x) / dt, az = (this.pos.z - before.z) / dt;
        const lost = 1 - Math.hypot(ax, az) / Math.hypot(this.vel.x, this.vel.z);
        const fr = lost > 0.05 ? 0.975 : 1;
        this.vel.x = ax * fr; this.vel.z = az * fr;
      }
      // solid creature bodies (the Koala): he bumps into it instead of walking through it
      for (const fn of this.bodies) {
        const b = fn(); if (!b || Math.abs(b.y - this.pos.y) > 1.5) continue;
        const dx = this.pos.x - b.x, dz = this.pos.z - b.z, d = Math.hypot(dx, dz), r = 0.68;
        if (d < r && d > 1e-4) { this.pos.x += dx / d * (r - d); this.pos.z += dz / d * (r - d); this.physics.collide(this.pos, 0.3, h); }
      }
    }
    // ---------------------------------------------------------------- ground
    if (!this.seated) {
      const g = this.physics.groundAt(this.pos.x, this.pos.z, this.pos.y);
      if (g === -Infinity) {
        // no surface: revert horizontal move (never fall out of the world)
        this.pos.x = before.x; this.pos.z = before.z;
      } else if (this.pos.y - g > 0.55) {
        this.vy -= 18 * dt; this.pos.y = Math.max(g, this.pos.y + this.vy * dt);
        if (this.pos.y === g) this.vy = 0;
      } else {
        this.vy = 0;
        this.pos.y = damp(this.pos.y, g, 22, dt);
        if (Math.abs(this.pos.y - g) < 0.002) this.pos.y = g;
      }
    }
    this.level = this.physics.levelOf(this.pos.y + 0.1);
    // ---------------------------------------------------------------- camera
    this.eye = damp(this.eye, this.seated ? (this.seated.eye ?? 1.18) : this.crouching ? CROUCH : STAND, this.seated ? 3 : 10, dt);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    this.bobAmt = damp(this.bobAmt, hs > 0.3 ? Math.min(1.4, hs / 2.45) : 0, 6, dt);
    // one vertical bob per footstep, one side-sway cycle per two steps
    this.bobPhase += moved * Math.PI / (this.sprinting ? STRIDE.run : this.crouching ? STRIDE.crouch : STRIDE.walk);
    const bobOn = gp.headBob && settings.data.accessibility.cameraShake;
    const bobY = bobOn ? Math.sin(this.bobPhase * 2) * 0.032 * this.bobAmt : 0;
    const bobX = bobOn ? Math.cos(this.bobPhase) * 0.022 * this.bobAmt : 0;
    // footsteps
    this.stepDist += moved;
    const stride = this.sprinting ? STRIDE.run : this.crouching ? STRIDE.crouch : STRIDE.walk;
    if (this.stepDist > stride) {
      this.stepDist = 0;
      this.footstep();
    }
    let shX = 0, shY = 0, shR = 0;
    if (this.shakeT > 0) {
      // trauma-style shake: smooth layered noise (not per-frame white noise), squared falloff
      this.shakeT -= dt;
      this._shT = (this._shT || 0) + dt;
      const a = this.shakeAmp * Math.min(1, this.shakeT * 3) ** 2, t = this._shT;
      const n = (f, p) => Math.sin(t * f + p) * 0.6 + Math.sin(t * f * 2.37 + p * 1.7) * 0.3 + Math.sin(t * f * 5.1 + p * 0.3) * 0.1;
      shX = n(23, 1.3) * a * 0.035; shY = n(27, 4.1) * a * 0.035; shR = n(17, 2.7) * a * 0.018;
      if (this.shakeT <= 0) this.shakeAmp = 0;
    }
    // idle drift: a living, hand-held stillness when he is not walking (strongest in cutscenes,
    // where the player has no control), never applied on top of walking bob
    this._idleT = (this._idleT || 0) + dt;
    const still = bobOn ? Math.max(0, 1 - this.bobAmt * 2) * (this.canMove ? 0.5 : 1) : 0;
    const it = this._idleT;
    shY += still * (Math.sin(it * 1.1) * 0.0022 + Math.sin(it * 2.3 + 1.7) * 0.0009);
    shX += still * (Math.sin(it * 0.7 + 0.4) * 0.0026 + Math.sin(it * 1.9 + 2.2) * 0.0008);
    const cam = this.camera;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    cam.position.set(this.pos.x, this.pos.y + this.eye + bobY, this.pos.z).addScaledVector(right, bobX);
    cam.rotation.set(this.pitch + shY, this.yaw + shX, (bobOn ? -bobX * 0.6 : 0) + shR + this.extraRoll, 'YXZ');
  }

  // Scripted look-at as an authored head move instead of an exponential chase:
  // cubic ease-in-out into a slight overshoot that settles back (SINE ease-out), or for
  // fast reflex turns (speed >= 6) a BACK ease-out whip. Duration scales with the angle.
  updateLookCurve(o, dt) {
    if (this._lookFor !== o) {
      this._lookFor = o;
      const dy = wrapAngle(o.yaw - this.yaw), dp = o.pitch - this.pitch;
      const ang = Math.hypot(dy, dp);
      const fast = (o.speed ?? 3) >= 6;
      const dur = o.dur ?? clamp((0.32 + ang * 0.5) * Math.sqrt(3 / (o.speed ?? 3)), 0.16, 2.4);
      const y0 = this.yaw, p0 = this.pitch;
      const keys = fast
        ? [{ t: 0, v: [y0, p0], interp: 'BACK', easing: 'EASE_OUT', back: 1.2 }, { t: dur, v: [y0 + dy, p0 + dp] }]
        : [{ t: 0, v: [y0, p0], interp: 'CUBIC', easing: 'EASE_IN_OUT' },
           { t: dur * 0.82, v: [y0 + dy * 1.045, p0 + dp * 1.03], interp: 'SINE', easing: 'EASE_OUT' },
           { t: dur, v: [y0 + dy, p0 + dp] }];
      this._look = { track: ang < 0.01 ? null : new Track(keys), t: 0 };
    }
    const L = this._look;
    if (!L.track) return;
    L.t += dt;
    const [y, p] = L.track.sample(Math.min(L.t, L.track.duration));
    this.yaw = y; this.pitch = clamp(p, -1.45, 1.45);
  }

  // 'tile' (hospital vinyl/tile), 'concrete' (basement), 'stairs' (stairwell flights), 'outside'
  surfaceType() {
    const p = this.pos, B = this.physics.layout.bounds;
    if (p.x < B.x0 - 0.2 || p.x > B.x1 || p.z < B.z0 || p.z > B.z1) return 'outside';
    if (p.x > 16.9 && p.z < -1.5) return 'stairs';
    if (this.level === 'B') return 'concrete';
    return 'tile';
  }
  surface() {
    const s = this.surfaceType();
    return s === 'outside' ? 'step_outside' : s === 'stairs' ? 'step_stairs' : s === 'concrete' ? 'step_concrete' : 'step_tile';
  }

  footstep() {
    const s = this.surfaceType();
    let id;
    if (s === 'outside') id = 'step_outside';
    else if (this.sprinting) id = s === 'tile' ? 'run_tile' : 'run_concrete';      // heavier, faster set
    else id = s === 'stairs' ? 'step_stairs' : s === 'concrete' ? 'step_concrete' : 'step_tile';
    // never the same take twice in a row; slight pitch/level variation on top
    const n = MANIFEST[id]?.length || 1;
    let idx = Math.floor(Math.random() * n);
    if (idx === this._lastStep) idx = (idx + 1 + Math.floor(Math.random() * (n - 1))) % n;
    this._lastStep = idx;
    const v = (this.sprinting ? 0.95 : this.crouching ? 0.3 : 0.62) * (0.9 + Math.random() * 0.15);
    audio.play(id, { bus: 'player', index: idx, volume: v, rate: (this.sprinting ? 1.05 : 0.96) + Math.random() * 0.08, reverb: s === 'stairs' ? 0.35 : 0.2 });
    if (this.onStep) this.onStep(this.sprinting, this.crouching);
  }
}
