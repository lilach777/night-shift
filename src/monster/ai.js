// Koala AI director + state machine.
// States: hidden, dormant, watching, stalking, encounter, jumpscare, chase, attack, disappear, cooldown.
// The Koala never continuously chases: an encounter director spaces out short, varied
// appearances with cooldowns, and every spawn is validated (distance window, line of
// sight, navigation node, not inside geometry, not in the player's view when popping in).
import * as THREE from 'three';
import { rand, pick, wrapAngle, clamp } from '../core/util.js';
import { audio } from '../audio/audio.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// shortest distance between two 2D segments (0 if they cross)
function segDist2D(ax, az, bx, bz, cx, cz, dx, dz) {
  const cross = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = cross(cx, cz, dx, dz, ax, az), d2 = cross(cx, cz, dx, dz, bx, bz);
  const d3 = cross(ax, az, bx, bz, cx, cz), d4 = cross(ax, az, bx, bz, dx, dz);
  if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return 0;
  const pt = (px, pz, sx, sz, ex, ez) => {
    const vx = ex - sx, vz = ez - sz, l = vx * vx + vz * vz || 1e-9;
    const t = Math.max(0, Math.min(1, ((px - sx) * vx + (pz - sz) * vz) / l));
    return Math.hypot(px - sx - vx * t, pz - sz - vz * t);
  };
  return Math.min(pt(ax, az, cx, cz, dx, dz), pt(bx, bz, cx, cz, dx, dz), pt(cx, cz, ax, az, bx, bz), pt(dx, dz, ax, az, bx, bz));
}

export class KoalaAI {
  constructor(g) {
    this.g = g;
    this.state = 'hidden';
    this.enabled = false;
    this.cool = 60;
    this.enc = null;
    this.chases = 0;
    this.time = 0;
    this.lastSil = -999;
    this.history = [];
    this.frustum = new THREE.Frustum();
    this.m4 = new THREE.Matrix4();
    g.world.lightning.onFlash(s => this.onLightning(s));
  }

  get koala() { return this.g.koala; }
  get player() { return this.g.player; }
  get cam() { return this.g.camera; }
  get physics() { return this.g.world.physics; }
  get nav() { return this.g.nav; }

  enable(cool = 60) { this.enabled = true; this.state = 'cooldown'; this.cool = cool; }
  disable() { this.enabled = false; this.end(true); this.state = 'hidden'; }

  // ------------------------------------------------------------------ perception
  inView(p, margin = 0) {
    const cam = this.cam;
    cam.updateMatrixWorld();
    this.m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m4);
    const s = new THREE.Sphere(p, 0.6 + margin);
    if (!this.frustum.intersectsSphere(s)) return false;
    return this.physics.los(cam.position, p);
  }
  lit(p) {
    const fl = this.g.flashlight;
    const cam = this.cam.position;
    const d = cam.distanceTo(p);
    if (fl.on && fl.has && fl.battery > 0 && d < 20) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.cam.quaternion);
      const to = new THREE.Vector3().subVectors(p, cam).normalize();
      if (fwd.dot(to) > Math.cos(0.5)) return true;
    }
    if (this.g.world.flash > 0.3) return true;
    if (this.g.world.lights.anyPower() && this.g.world.lights.power[this.player.level]) return true;
    if (this.g.world.lights.emergencyOn) return d < 18;
    return d < 4.5;
  }
  canSee(p) { return this.inView(p) && this.lit(p); }
  dist() { return this.koala.position.distanceTo(this.player.pos); }
  camFwd() { return new THREE.Vector3(-Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw)); }

  nodeOk(n, { minD = 8, maxD = 28, los = true, unseen = true, dirDot = null } = {}) {
    const pp = this.player.pos;
    if (Math.abs(n.y - pp.y) > 1.2) return false;
    const d = Math.hypot(n.x - pp.x, n.z - pp.z);
    if (d < minD || d > maxD) return false;
    const head = V(n.x, n.y + 1.6, n.z);
    if (los && !this.physics.los(this.cam.position, head)) return false;
    if (unseen && this.inView(head) && this.lit(head) && d < 16) return false;
    if (dirDot != null) {
      const f = this.camFwd();
      const to = V(n.x - pp.x, 0, n.z - pp.z).normalize();
      const dd = f.dot(to);
      if (dirDot > 0 ? dd < dirDot : dd > dirDot) return false;
    }
    // never inside geometry
    const probe = V(n.x, n.y, n.z);
    const before = probe.clone();
    this.physics.collide(probe, 0.35, 1.9);
    if (probe.distanceTo(before) > 0.25) return false;
    return true;
  }

  // ------------------------------------------------------------------ lifecycle
  update(dt) {
    this.time += dt;
    if (this.enc) {
      this.enc.t += dt;
      try { this.enc.update(dt); } catch (e) { console.error('[ai] encounter error', e); this.end(true); }
    } else if (this.enabled) {
      if (this.state === 'cooldown') {
        this.cool -= dt;
        if (this.cool <= 0) this.state = 'dormant';
      } else if (this.state === 'dormant') {
        const late = this.g.fuses?.collected >= 3;
        if (Math.random() < dt / (late ? 12 : 20)) this.tryEncounter();
      }
    }
    const k = this.koala;
    if (k.visible) k.update(dt, this.cam.position, this.lit(k.headPos));
  }

  begin(type, enc, state = 'encounter') {
    this.enc = { type, t: 0, ...enc };
    this.state = state;
    this.history.push({ type, at: Math.round(this.time) });
    if (this.g.debug) this.g.debug.log(`koala: ${type}`);
  }

  end(silent = false, cool) {
    if (this.enc?.cleanup) this.enc.cleanup();
    this.enc = null;
    this.suspicion = 0;
    this.bash = null;
    this.koala.hide();
    this.koala.speed = 0;
    if (this.state === 'chase' || this.g.music.state === 'chase') this.g.music.stopChase();
    if (!this.enabled) { this.state = 'hidden'; return; }
    const late = this.g.fuses?.collected >= 3;
    this.state = 'cooldown';
    this.cool = cool ?? rand(50, 110) * (late ? 0.65 : 1);
  }

  // Disappear: hide in a flicker if the player is looking, silently otherwise.
  vanish(cool) {
    const k = this.koala;
    if (!k.visible) return this.end(true, cool);
    this.state = 'disappear';
    if (this.inView(k.headPos)) {
      this.g.flashlight.flicker(0.55, 1);
      this.g.world.lights.surgeFlicker(0.35);
      audio.play('light_flicker', { bus: 'environment', volume: 0.5 });
      const enc = this.enc || { t: 0 };
      this.enc = { ...enc, type: 'vanish', t: 0, update: () => { if (this.enc.t > 0.16) this.end(false, cool); } };
    } else this.end(true, cool);
  }

  tryEncounter() {
    const lvl = this.player.level;
    const pz = this.player.pos.z;
    const inCorridor = Math.abs(pz) < 1.6 && !(this.player.pos.x > 16.9 && pz < -1.4);
    const late = this.g.fuses?.collected >= 2;
    const opts = [];
    if (inCorridor) opts.push(['corridor', 3], ['crawl', 1.4]);
    opts.push(['behind', 2], ['doorway', inCorridor ? 2 : 0.6]);
    if (this.chases < 3 && late && this.time > 120) opts.push(['chase', 0.9]);
    else if (this.chases < 1) opts.push(['chase', 0.35]);
    let total = opts.reduce((s, o) => s + o[1], 0);
    let r = Math.random() * total;
    let type = opts[0][0];
    for (const [t, w] of opts) { r -= w; if (r <= 0) { type = t; break; } }
    const ok = this[`enc_${type}`]?.(lvl);
    if (!ok) { this.state = 'cooldown'; this.cool = rand(6, 14); }
  }

  // ------------------------------------------------------------------ encounters
  enc_corridor(lvl) {
    const nodes = this.nav.onLevel(lvl, 'corridor').filter(n => this.nodeOk(n, { minD: 12, maxD: 28, dirDot: 0.2 }));
    if (!nodes.length) return false;
    const n = pick(nodes);
    const k = this.koala;
    k.show(V(n.x, n.y, n.z), 0, Math.random() < 0.5 ? 'idle' : 'breathe');
    k.faceTowards(this.player.pos);
    k.lookTarget = this.cam.position;
    let seenT = 0, reacted = false;
    this.begin('corridor_watch', {
      update: dt => {
        if (this.detect(dt)) return;          // it noticed you: the hunt begins
        k.faceTowards(this.player.pos, dt, 1.5);
        const seen = this.canSee(k.headPos);
        if (seen) {
          if (seenT === 0) { this.g.breathing.scare(0.45); if (Math.random() < 0.35) audio.play('stinger_reveal', { bus: 'sfx', volume: 0.5 }); }
          seenT += dt;
          this.state = 'watching';
        }
        if (seenT > 0.5 && !reacted) {
          reacted = true;
          if (Math.random() < 0.5) { k.play('head_tilt', { fade: 0.4 }); k.headRoll = -0.4; }
          else k.play('look_around', { fade: 0.3 });
          if (Math.random() < 0.4) k.vocal('koala_chitter', 0.6);
        }
        const d = this.dist();
        if (d < 8 || seenT > rand(2.6, 4.2) || this.enc.t > 25) {
          if (seenT > 0 && Math.random() < 0.3) this.retreat();
          else this.vanish();
        }
      },
    }, 'watching');
    return true;
  }

  retreat() {
    // Turn away and walk into the dark / nearest room; vanish when out of sight.
    const k = this.koala;
    const lvl = this.player.level;
    const rooms = this.nav.onLevel(lvl, 'room:').filter(n => n.x !== undefined)
      .map(n => [Math.hypot(n.x - k.position.x, n.z - k.position.z), n]).filter(([d]) => d < 8).sort((a, b) => a[0] - b[0]);
    const target = rooms[0]?.[1];
    k.lookTarget = null; k.headRoll = 0;
    k.play('walk', { fade: 0.3 });
    const from = this.nav.nearest(k.position, 4);
    const path = target && from ? this.nav.path(from, target) : null;
    let i = 0;
    this.state = 'stalking';
    this.enc = {
      type: 'retreat', t: 0,
      update: dt => {
        const wp = path?.[Math.min(i, path.length - 1)];
        if (wp) {
          const to = V(wp.x - k.position.x, 0, wp.z - k.position.z);
          if (to.length() < 0.3) i++;
          else { to.normalize(); k.position.addScaledVector(to, 1.15 * dt); k.speed = 1.15; k.faceTowards(V(wp.x, 0, wp.z), dt, 5); }
        }
        if ((!this.inView(k.headPos) && this.enc.t > 1.2) || this.enc.t > 9 || this.dist() < 5) this.vanish();
      },
    };
  }

  enc_behind(lvl) {
    const pp = this.player.pos;
    const nodes = this.nav.nodes.filter(n => n.level === lvl && this.nodeOk(n, { minD: 3.5, maxD: 7, dirDot: -0.45, unseen: true }));
    if (!nodes.length) return false;
    const n = pick(nodes);
    const k = this.koala;
    k.show(V(n.x, n.y, n.z), 0, 'breathe');
    k.faceTowards(pp);
    k.lookTarget = this.cam.position;
    let scared = false;
    const growlAt = rand(0.8, 2.2);
    let growled = false;
    this.begin('behind', {
      update: dt => {
        k.faceTowards(this.player.pos, dt, 3);
        if (!growled && this.enc.t > growlAt) { growled = true; k.vocal('koala_growl', 0.55); }
        if (!scared && this.inView(k.headPos) && this.dist() < 9) {
          scared = true;
          this.state = 'jumpscare';
          k.vocal('koala_screech', 1);
          k.play('attack', { fade: 0.05, timeScale: 1.4 });
          this.player.shake(0.9, 0.5);
          this.g.breathing.scare(0.85);
          this.g.post.pulse(0.7);
          this.scareT = 0;
        }
        if (scared && (this.scareT += dt) > 0.42) this.vanish();
        if (!scared && this.enc.t > 6.5) {
          // it never revealed itself — leave footsteps running away
          const away = k.position.clone();
          audio.playAt('koala_step', away, { bus: 'monster', volume: 0.6, hrtf: true, occlude: true });
          audio.playAt('koala_step', away, { bus: 'monster', volume: 0.45, delay: 0.3, hrtf: true, occlude: true });
          audio.playAt('koala_step', away, { bus: 'monster', volume: 0.3, delay: 0.6, hrtf: true, occlude: true });
          this.end(true);
        }
      },
    });
    return true;
  }

  enc_doorway(lvl) {
    const pp = this.player.pos;
    const cands = [];
    for (const door of this.g.world.doors) {
      if (door.level !== lvl || door.amount < 0.5 || door.locked) continue;
      const d = door.def;
      const s = d.side === 'N' ? 1 : -1;
      // hidden spawn just inside the room; it then steps out into the doorway
      const hide = { x: d.x + 0.15, y: d.y, z: d.z + s * 1.4, tag: 'door:' + d.room };
      const stand = { x: d.x, y: d.y, z: d.z - s * 0.2 };   // half out into the corridor
      if (!this.nodeOk(hide, { minD: 6, maxD: 17, dirDot: 0.3, los: false })) continue;
      if (!this.physics.los(this.cam.position, V(stand.x, stand.y + 1.6, stand.z))) continue;
      if (this.canSee(V(hide.x, hide.y + 1.6, hide.z))) continue;
      cands.push([hide, stand, door]);
    }
    if (!cands.length) return false;
    const [n, stand, door] = pick(cands);
    const roomNode = this.nav.nodes.find(m => m.tag === 'room:' + n.tag.slice(5));
    const k = this.koala;
    k.show(V(n.x, n.y, n.z), 0, 'walk');
    k.faceTowards(V(stand.x, 0, stand.z));
    k.headRoll = -0.5;
    let seenT = 0, leaving = false, emerged = false;
    this.begin('doorway', {
      update: dt => {
        if (!emerged) {
          const to = V(stand.x - k.position.x, 0, stand.z - k.position.z);
          if (to.length() > 0.08) { to.normalize(); k.position.addScaledVector(to, 1.1 * dt); k.speed = 1.1; }
          else { emerged = true; k.speed = 0; k.play('idle', { fade: 0.4 }); k.lookTarget = this.cam.position; }
          if (this.enc.t > 3) emerged = true;
          return;
        }
        if (!leaving) {
          if (this.detect(dt)) return;
          k.faceTowards(this.player.pos, dt, 2);
          if (this.canSee(k.headPos)) { if (seenT === 0) { this.g.breathing.scare(0.5); k.play('head_tilt', { fade: 0.3 }); } seenT += dt; }
          if (seenT > 1.1 || this.enc.t > 18) {
            leaving = true; k.lookTarget = null; k.headRoll = 0;
            k.play('walk', { fade: 0.25, timeScale: 1.2 });
          }
          if (this.dist() < 5) this.vanish();
        } else if (roomNode) {
          const to = V(roomNode.x - k.position.x, 0, roomNode.z - k.position.z);
          if (to.length() > 0.2) { to.normalize(); k.position.addScaledVector(to, 1.4 * dt); k.speed = 1.4; k.faceTowards(V(roomNode.x, 0, roomNode.z), dt, 6); }
          if (!this.inView(k.headPos)) {
            if (Math.random() < 0.6) setTimeout(() => door.slam(), rand(200, 900));
            this.end(true);
          } else if (this.enc.t > 12 || this.dist() < 5) this.vanish();
        } else this.vanish();
      },
    });
    return true;
  }

  enc_crawl(lvl) {
    const pp = this.player.pos;
    const ahead = this.nav.onLevel(lvl, 'corridor').filter(n => this.nodeOk(n, { minD: 11, maxD: 20, dirDot: 0.75, unseen: false }));
    if (!ahead.length) return false;
    const a = pick(ahead);
    // crawl from a doorway on one side across to the other side, or away down the corridor
    const doorsNear = this.nav.onLevel(lvl, 'door:').filter(n => Math.abs(n.x - a.x) < 3.5);
    let path;
    const N = doorsNear.filter(n => n.z > 0), S = doorsNear.filter(n => n.z < 0);
    if (N.length && S.length) path = this.nav.path(pick(N), pick(S));
    if (!path || path.length < 2) {
      const dir = Math.sign(a.x - pp.x) || 1;
      const far = this.nav.onLevel(lvl, 'corridor').filter(n => (n.x - a.x) * dir > 5 && (n.x - a.x) * dir < 10);
      if (!far.length) return false;
      path = this.nav.path(a, pick(far));
    }
    if (!path || path.length < 2) return false;
    const k = this.koala;
    const s = path[0];
    k.show(V(s.x, s.y, s.z), 0, 'crawl');
    let i = 1;
    this.begin('crawl', {
      update: dt => {
        const wp = path[i];
        if (!wp) return this.end(true);
        const to = V(wp.x - k.position.x, 0, wp.z - k.position.z);
        if (to.length() < 0.25) { i++; return; }
        to.normalize();
        k.position.addScaledVector(to, 2.9 * dt); k.speed = 2.9;
        k.faceTowards(V(wp.x, 0, wp.z), dt, 8);
        if (this.canSee(k.headPos) && !this.enc.seen) { this.enc.seen = true; this.g.breathing.scare(0.5); }
        if (this.dist() < 5 || this.enc.t > 12) this.vanish();
      },
    });
    return true;
  }

  // ------------------------------------------------------------------ the Koala perceiving the player
  playerHead() { return this.player.pos.clone().setY(this.player.pos.y + (this.player.crouching ? 1.0 : 1.5)); }

  // Real sight only: range (bigger if the flashlight is on / lights are on, smaller when
  // crouching), a field of view around where it faces, and true line of sight through the
  // level geometry (walls, closed doors, closets). Never through walls.
  koalaSeesPlayer() {
    const k = this.koala;
    if (!k?.visible || this.g.hiding?.current) return false;
    const kh = k.headPos, ph = this.playerHead();
    const d = kh.distanceTo(ph);
    const fl = this.g.flashlight;
    const lightOn = fl.on && fl.has && fl.battery > 0;
    let range = lightOn ? 24 : 12;
    if (this.g.world.lights.power[this.player.level] || this.g.world.lights.emergencyOn) range += 8;
    if (this.player.crouching) range *= 0.6;
    if (d > range) return false;
    const yaw = k.root.rotation.y;
    const to = V(ph.x - kh.x, 0, ph.z - kh.z).normalize();
    if (d > 2.5 && Math.sin(yaw) * to.x + Math.cos(yaw) * to.z < Math.cos(1.3)) return false;
    return this.physics.los(kh, ph);
  }

  // Footsteps (and other noises) give a position, not a lock-on: running carries far.
  noise(pos, radius) {
    if (!this.koala?.visible || this.g.hiding?.current) return;
    const d = this.koala.position.distanceTo(pos);
    if (d > radius || Math.abs(pos.y - this.koala.position.y) > 2.5) return;
    this.suspicion = Math.min(1.3, (this.suspicion || 0) + (1 - d / radius) * 0.55);
    this.heard = { pos: pos.clone(), t: this.time };
  }

  // Detection meter: fills faster when close, when the player runs, or shines the light at it.
  perceive(dt) {
    this.suspicion = this.suspicion || 0;
    if (this.koalaSeesPlayer()) {
      const d = this.koala.position.distanceTo(this.player.pos);
      let rate = 1.4 / Math.max(1, d / 4);
      if (this.player.sprinting) rate *= 2.4;
      else if (this.player.moving && !this.player.crouching) rate *= 1.3;
      else if (this.player.crouching) rate *= 0.5;
      const fl = this.g.flashlight;
      if (fl.on && fl.has && this.lit(this.koala.headPos) && this.inView(this.koala.headPos)) rate *= 1.6;
      this.suspicion += dt * rate * 1.25;          // it is hungrier now: notices faster
      this.lastKnown = this.player.pos.clone();
    } else this.suspicion = Math.max(0, this.suspicion - dt * 0.12);
    return this.suspicion >= 1;
  }

  // an active pursuit (not the search afterwards) — the HUD shows "RUN." while this is true
  isChasing() { return !!this.enc && this.enc.type === 'chase' && (this.state === 'chase' || this.state === 'attack'); }

  canChase() { return this.enabled && this.time - (this.lastChaseEnd ?? -999) > 28; }

  // Used by idle encounters: escalate to a hunt when the Koala has noticed the player.
  detect(dt) {
    if (!this.perceive(dt) || !this.canChase()) return false;
    this.hunt({ scream: true });
    return true;
  }

  // ------------------------------------------------------------------ movement that obeys geometry
  moveTo(target, speed, dt) {
    const k = this.koala;
    const to = V(target.x - k.position.x, 0, target.z - k.position.z);
    const d = to.length();
    // A door the player shut in its face costs it time: it stops and hammers on it
    // (or, when only searching, pushes it open slowly) before getting through.
    if (this.bash) {
      const b = this.bash;
      b.t += dt; k.speed = 0; this.moveSpeed = 0;
      k.faceTowards(b.door.center, dt, 8);
      if (b.hits < b.need && b.t > 0.2 + b.hits * 0.42) {
        b.hits++;
        audio.playAt('door_bang', b.door.center, { bus: 'environment', volume: 1, index: b.hits % 3, occlude: true, refDistance: 3 });
        if (k.actions.attack) k.play('attack', { fade: 0.05, timeScale: 1.6 });
      }
      if (b.t >= b.dur) {
        b.door.open(speed > 3 ? 7 : 1.6, false);
        if (speed > 3) audio.playAt('door_slam', b.door.center, { bus: 'environment', volume: 1, occlude: true });
        this.bash = null;
        k.play(speed > 3 ? (k.actions.charge ? 'charge' : 'chase') : 'walk', { fade: 0.15 });
      }
      return d;
    }
    for (const door of this.g.world.doorsNear(k.position, 1.35)) {
      if (door.amount >= 0.3 || door.locked) continue;
      // only if the door is ahead of it (toward where it's going)
      const dc = V(door.center.x - k.position.x, 0, door.center.z - k.position.z);
      if (d > 0.1 && dc.lengthSq() > 0.01 && dc.normalize().dot(to.clone().normalize()) < 0.2) continue;
      const fast = speed > 3;
      this.bash = { door, t: 0, hits: 0, need: fast ? 3 : 0, dur: fast ? 1.5 : 0.6 };
      if (!fast) audio.playAt('door_wood_open', door.center, { bus: 'environment', volume: 0.7, occlude: true });
      return d;
    }
    // physical gait: it accelerates / brakes with its mass and cannot corner at full speed -
    // the sharper the turn still ahead of its body, the more it slows into it
    const accel = speed > 3 ? 7.5 : 3.2;
    let ms = this.moveSpeed ?? 0;
    if (d > 0.04) {
      to.multiplyScalar(1 / d);
      const fy = k.root.rotation.y, align = Math.sin(fy) * to.x + Math.cos(fy) * to.z;   // cos(heading error)
      const want = speed * Math.min(1, Math.max(0.3, 0.3 + 0.7 * (align + 0.2) / 1.2));
      ms += Math.max(-accel * 1.6 * dt, Math.min(accel * dt, want - ms));
      k.position.addScaledVector(to, Math.min(d, ms * dt));
      k.faceTowards(target, dt, 7);
    } else ms = Math.max(0, ms - accel * 2 * dt);
    this.moveSpeed = ms;
    const p = k.position.clone();
    this.physics.collide(p, 0.32, 1.9);
    k.position.x = p.x; k.position.z = p.z;
    const gy = this.physics.groundAt(k.position.x, k.position.z, k.position.y + 0.3, 0.7);
    if (gy > -Infinity) k.position.y += (gy - k.position.y) * Math.min(1, dt * 12);
    k.speed = ms;
    return d;
  }

  // Follow the nav graph toward a goal; direct steering once in clear sight of it.
  // can the Koala's body walk straight from a to b? (clear at knee and chest height:
  // tables, beds and gurneys block it even where it could see over them)
  walkable(a, b) {
    if (Math.abs(a.y - b.y) > 1.2) return false;
    // (includeProps: tables, beds and cabinets block its body even where it could see over them)
    if (!this.physics.los(V(a.x, a.y + 0.35, a.z), V(b.x, b.y + 0.35, b.z), true) || !this.physics.los(V(a.x, a.y + 1.0, a.z), V(b.x, b.y + 1.0, b.z), true)) return false;
    // open door leaves / drawers (moving parts) are not in the sight test: keep the body clear of them
    for (const d of this.physics.dynamic) {
      const s = d.segment?.();
      if (!s || s.y1 < a.y + 0.2 || s.y0 > a.y + 1.8) continue;
      if (segDist2D(a.x, a.z, b.x, b.z, s.ax, s.az, s.bx, s.bz) < 0.36) return false;
    }
    return true;
  }
  nearestReachable(p) {
    const c = this.nav.nodes.filter(n => Math.abs(n.y - p.y) < 1.2 && Math.hypot(n.x - p.x, n.z - p.z) < 9)
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    for (const n of c.slice(0, 8)) if (this.walkable(p, V(n.x, n.y, n.z))) return n;
    return this.nav.nearest(p, 6);
  }

  // Follow the nav graph toward a goal (string-pulled), straight when the way is clear, and
  // sidestep around furniture when it stops making progress.
  navTo(goal, speed, dt, st) {
    const k = this.koala;
    const remaining = () => Math.hypot(goal.x - k.position.x, goal.z - k.position.z);
    st.repath = (st.repath ?? 0) - dt;
    st.blockedT = Math.max(0, (st.blockedT ?? 0) - dt);
    if (st.detour) {
      st.detour.t -= dt;
      if (this.moveTo(st.detour.p, speed * 0.8, dt) < 0.15 || st.detour.t <= 0) { st.detour = null; st.repath = 0; }
      return remaining();
    }
    let target, direct = false;
    if (!st.blockedT && this.walkable(k.position, goal)) { st.path = null; target = goal; direct = true; }
    else {
      if (!st.path || st.repath <= 0 || st.goal?.distanceTo(goal) > 1.5) {
        st.path = this.nav.path(this.nearestReachable(k.position), this.nav.nearest(goal, 6)) || [];
        st.wi = 0; st.repath = 1.2; st.goal = goal.clone();
      }
      // skip ahead to the furthest waypoint it can walk to directly
      while (st.wi < st.path.length - 1 && this.walkable(k.position, V(st.path[st.wi + 1].x, st.path[st.wi + 1].y, st.path[st.wi + 1].z))) st.wi++;
      const wp = st.path[st.wi];
      target = wp ? V(wp.x, wp.y, wp.z) : goal;
      if (wp && Math.hypot(wp.x - k.position.x, wp.z - k.position.z) < 0.4) st.wi = Math.min(st.wi + 1, st.path.length - 1);
      if (st.wi >= st.path.length - 1 && wp && Math.hypot(wp.x - k.position.x, wp.z - k.position.z) < 0.4) target = goal;
    }
    // progress check -> sidestep
    st.prog = st.prog || { t: 0, p: k.position.clone() };
    st.prog.t += dt;
    if (st.prog.t > 0.7) {
      const moved = st.prog.p.distanceTo(k.position);
      st.prog = { t: 0, p: k.position.clone() };
      if (moved < speed * 0.7 * 0.3 && remaining() > 0.8) {
        if (direct) st.blockedT = 3;
        const dir = V(target.x - k.position.x, 0, target.z - k.position.z).normalize();
        let best = null, bestD = Infinity;
        for (const s of [1, -1]) for (const reach of [0.9, 1.5]) {
          const p = k.position.clone().add(V(dir.z * s * reach, 0, -dir.x * s * reach)).addScaledVector(dir, 0.25);
          const q = p.clone(); this.physics.collide(q, 0.34, 1.9);
          if (q.distanceTo(p) > 0.05 || !this.walkable(k.position, p)) continue;
          const d = p.distanceTo(target);
          if (d < bestD) { bestD = d; best = p; }
        }
        if (best) st.detour = { p: best, t: 1.2 };
        else st.repath = 0;
      }
    }
    this.moveTo(target, speed, dt);
    return remaining();
  }

  // ------------------------------------------------------------------ the hunt
  enc_chase(lvl, opts = {}) {
    let start = opts.start;
    if (!start) {
      const nodes = this.nav.nodes.filter(n => n.level === lvl && this.nodeOk(n, { minD: 13, maxD: 24, unseen: false }));
      if (!nodes.length) return false;
      const n = pick(nodes);
      start = V(n.x, n.y, n.z);
    }
    this.koala.show(start, 0, 'idle');
    this.koala.faceTowards(this.player.pos);
    this.lastKnown = this.player.pos.clone();
    this.hunt({ scream: true, ...opts });
    return true;
  }

  // Phases: scream -> chase (while it can see you, or toward where it last saw/heard you)
  // -> search (last known area, nearby rooms, maybe a closet) -> leave.
  hunt(opts = {}) {
    const k = this.koala, g = this.g;
    this.chases++;
    this.suspicion = 1;
    this.lastKnown = this.lastKnown || this.player.pos.clone();
    k.lookTarget = this.cam.position;
    let phase = opts.scream ? 'scream' : 'chase';
    let speed = opts.startSpeed ?? 3.5;
    const charge = k.actions.charge ? 'charge' : 'chase';
    let lungeCd = 0, lungeT = 0, growlT = rand(1.5, 3);
    const st = {};
    const S = { lostT: 0, points: [], pt: 0, pause: 0, closet: null, closetT: 0, searchT: 0 };
    const huntStart = this.time;
    if (opts.scream) {
      k.play('scream', { fade: 0.1, vary: false });
      k.vocal('koala_scream', 1, { bigReverb: 0.4 });
      this.player.shake(0.5, 0.6);
    }
    g.music.startChase();
    g.breathing.scare(1);
    const toChase = () => {
      phase = 'chase'; k.lookTarget = null; k.play(charge, { fade: 0.2 }); this.state = 'chase';
      if (g.music.state !== 'chase') g.music.startChase();
    };
    const toSearch = () => {
      phase = 'search'; this.state = 'stalking'; S.searchT = 0; S.pt = 0; S.pause = 0;
      g.music.stopChase(3);
      k.play('walk', { fade: 0.3 });
      const lk = this.lastKnown;
      // nearby search points (rooms and corridor spots around the last known position)
      const near = this.nav.nodes.filter(n => Math.abs(n.y - lk.y) < 1.2 && Math.hypot(n.x - lk.x, n.z - lk.z) < 9);
      S.points = [lk.clone(), ...near.sort(() => Math.random() - 0.5).slice(0, 3).map(n => V(n.x, n.y, n.z))];
      // closets near where it lost you: maybe investigate one
      const hid = g.hiding?.current;
      const closets = (g.hiding?.closets || []).filter(c => Math.abs(c.front.y - lk.y) < 1.2 && c.front.distanceTo(lk) < 7);
      S.closet = null;
      if (hid && closets.includes(hid) && Math.random() < (g.hiding.sawEnter ? 0.7 : 0.3)) S.closet = hid;
      else if (closets.length && Math.random() < 0.35) S.closet = pick(closets);   // it checks closets you're NOT in too
      if (S.closet) S.points.splice(1, 0, 'closet');
    };
    const toLeave = () => {
      phase = 'leave'; this.state = 'stalking'; k.play('walk', { fade: 0.4 }); k.lookTarget = null;
      g.music.stopChase(4);
      const far = this.nav.nodes.filter(n => Math.abs(n.y - k.position.y) < 1.2 && Math.hypot(n.x - this.player.pos.x, n.z - this.player.pos.z) > 15);
      S.leaveTo = far.length ? (n => V(n.x, n.y, n.z))(pick(far)) : k.position.clone();
      S.leaveT = 0;
    };
    const finish = () => {
      this.lastChaseEnd = this.time;
      this.suspicion = 0;
      this.end(true, opts.cool);
      opts.onEnd && opts.onEnd();
    };
    this.begin('chase', {
      scripted: !!opts.scripted,
      cleanup: () => { g.music.stopChase(); },
      update: dt => {
        const sees = this.koalaSeesPlayer();
        if (sees) { this.lastKnown = this.player.pos.clone(); }
        else if (this.heard && this.time - this.heard.t < 0.5) { this.lastKnown = this.heard.pos.clone(); }
        if (phase === 'scream') {
          k.faceTowards(this.player.pos, dt, 6);
          if (this.enc.t > (opts.screamTime ?? 1.35)) toChase();
          return;
        }
        if (phase === 'chase') {
          speed = Math.min(opts.maxSpeed ?? 4.85, speed + dt * 0.8);
          // lunge: when it is close and can see him it leaps - a short burst it cannot keep up
          lungeCd -= dt;
          if (lungeT > 0) {
            lungeT -= dt;
            if (lungeT <= 0) k.play(charge, { fade: 0.15 });
          } else if (sees && lungeCd <= 0 && this.dist() < 3.4 && this.dist() > 1.4 && k.actions.lunge) {
            lungeT = 0.55; lungeCd = 3.2;
            k.play('lunge', { fade: 0.06, vary: false });
            k.vocal('koala_attack', 1, { refDistance: 3 });
            this.player.shake(0.25, 0.3);
          }
          const left = this.navTo(this.lastKnown, lungeT > 0 ? 6.2 : speed, dt, st);
          // it never stops making noise while it runs you down
          growlT -= dt;
          if (growlT <= 0) { growlT = rand(2.2, 4.2); k.vocal(Math.random() < 0.6 ? 'koala_growl' : 'koala_screech', 0.6 + Math.random() * 0.25); }
          if (sees && this.dist() < (lungeT > 0 ? 1.45 : 1.2) && Math.abs(this.player.pos.y - k.position.y) < 1.2) {
            this.state = 'attack'; this.enc.update = () => {};
            g.music.stopChase(0.5); g.caught();
            return;
          }
          S.lostT = sees ? 0 : S.lostT + dt;
          if (!sees && (left < 0.9 || S.lostT > 6)) toSearch();
          if (this.time - huntStart > (opts.maxTime ?? 70)) toLeave();
          return;
        }
        if (phase === 'search') {
          S.searchT += dt;
          if (this.perceive(dt) && sees) { k.vocal('koala_screech', 0.9); toChase(); return; }
          const pt = S.points[S.pt];
          if (pt === undefined || S.searchT > (opts.searchTime ?? 24)) { toLeave(); return; }
          if (pt === 'closet') { this.investigate(S, dt); if (S.closetDone) { S.pt++; S.closetDone = false; } return; }
          if (S.pause > 0) {
            S.pause -= dt;
            if (S.pause <= 0) { S.pt++; k.play('walk', { fade: 0.3 }); }
            return;
          }
          if (this.navTo(pt, 2.6, dt, st) < 0.6) {
            S.pause = rand(1.4, 2.6); k.speed = 0;
            k.play(Math.random() < 0.5 ? 'look_around' : 'breathe', { fade: 0.3 });
            if (Math.random() < 0.35) k.vocal(Math.random() < 0.5 ? 'koala_growl' : 'koala_chitter', 0.55);
          }
          return;
        }
        if (phase === 'leave') {
          S.leaveT += dt;
          if (this.perceive(dt) && sees && this.time - huntStart < (opts.maxTime ?? 70)) { toChase(); return; }
          const left = this.navTo(S.leaveTo, 2.0, dt, st);
          if (left < 1 || S.leaveT > 14 || (!this.inView(k.headPos) && S.leaveT > 4)) finish();
        }
      },
    }, 'encounter');
  }

  // Walk to a closet, listen at the door... and sometimes tear it open.
  investigate(S, dt) {
    const k = this.koala, g = this.g, c = S.closet;
    if (!c) { S.closetDone = true; return; }
    if (!S.atCloset) {
      if (this.navTo(c.outside, 2.0, dt, S) < 0.5) {
        S.atCloset = true; S.closetT = 0; k.speed = 0;
        k.faceTowards(c.inside);
        k.play('breathe', { fade: 0.4 });
        k.vocal('koala_breath', 0.9, { refDistance: 1 });
      }
      return;
    }
    S.closetT += dt;
    k.faceTowards(c.inside, dt, 4);
    if (S.closetT > 1.6 && !S.sniffed) { S.sniffed = true; k.play('head_tilt', { fade: 0.3 }); k.vocal('koala_growl', 0.6); }
    if (S.closetT < 3.6) return;
    const inside = g.hiding.current === c;
    const fl = g.flashlight;
    let rip;
    if (inside) rip = Math.random() < (g.hiding.sawEnter ? 0.5 : (fl.on && fl.has ? 0.4 : 0.15));
    else rip = Math.random() < 0.3;               // sometimes it yanks an empty one open anyway
    if (rip) {
      c.part.open();
      audio.playAt('door_bang', c.front, { bus: 'environment', volume: 1 });
      if (inside) {
        g.hiding.forceOut();
        this.state = 'attack'; this.enc.update = () => {};
        g.caught();
        return;
      }
      k.vocal('koala_chitter', 0.6);
    }
    S.atCloset = false; S.sniffed = false; S.closetDone = true;
    k.play('walk', { fade: 0.3 });
  }

  // Scripted chase (morgue) — called by the story.
  scriptedChase(start, opts) { this.enc_chase(this.player.level, { ...opts, start, scripted: true }); }

  // A koala crouched in the corner of a room the player just entered (near fuses).
  onEnterRoom(room) {
    if (!this.enabled || this.enc || this.state !== 'dormant' && !(this.state === 'cooldown' && this.cool < 20)) return;
    if (Math.random() > 0.3) return;
    const corners = [
      [room.x0 + 0.8, room.side === 'N' ? room.z1 - 0.8 : room.z0 + 0.8],
      [room.x1 - 0.8, room.side === 'N' ? room.z1 - 0.8 : room.z0 + 0.8],
    ];
    const pp = this.player.pos;
    const c = corners.map(c => [Math.hypot(c[0] - pp.x, c[1] - pp.z), c]).filter(([d]) => d > 4).sort((a, b) => b[0] - a[0])[0];
    if (!c) return;
    const pos = V(c[1][0], room.y, c[1][1]);
    const probe = pos.clone(); this.physics.collide(probe, 0.4, 1.2);
    if (probe.distanceTo(pos) > 0.3) return;
    const k = this.koala;
    k.show(probe, 0, 'observe');
    k.faceTowards(pp);
    k.lookTarget = this.cam.position;
    let seen = false;
    this.begin('observe', {
      update: dt => {
        if (!seen && this.canSee(k.headPos)) {
          seen = true; this.enc.seenAt = this.enc.t;
          k.play('head_turn', { fade: 0.05 });
          k.vocal('koala_screech', 0.9);
          this.g.breathing.scare(0.9);
          this.player.shake(0.4, 0.3);
        }
        if (seen && this.enc.t - this.enc.seenAt > 0.6) this.vanish();
        if (!seen && (this.enc.t > 14 || this.dist() < 2.5)) this.vanish();
      },
    }, 'watching');
  }

  onLightning(strength) {
    if (!this.enabled || this.enc || strength < 0.55) return;
    if (this.time - this.lastSil < 150) return;
    const p = this.player.pos, lvl = this.player.level;
    if (!['2', '3', '4'].includes(lvl)) return;
    if (Math.abs(p.z) > 1.4 || p.x > 8) return;
    const f = this.camFwd();
    if (f.x > -0.8) return;
    if (Math.random() > 0.55) return;
    const y = this.g.world.layout.levels.find(l => l.id === lvl).y;
    const pos = V(-20.7, y, rand(-0.5, 0.5));
    if (pos.distanceTo(p) < 10) return;
    this.lastSil = this.time;
    const k = this.koala;
    k.show(pos, Math.PI / 2, 'idle');
    k.lookTarget = this.cam.position;
    this.begin('lightning_silhouette', {
      update: () => {
        if (this.enc.t > 0.1 && this.canSee(k.headPos) && !this.enc.s) { this.enc.s = true; this.g.breathing.scare(0.6); }
        if (this.enc.t > 0.75) this.end(true, rand(40, 80));
      },
    }, 'watching');
  }
}
