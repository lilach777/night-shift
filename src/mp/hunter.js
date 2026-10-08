// NIGHT SHIFT multiplayer - the Koala as a group hunter (host only).
//
// Reuses the single-player KoalaAI movement/perception primitives (navTo with string-pulled nav
// paths and stairs, door bashing, walkable checks, line of sight) through a subclass, but replaces
// the encounter director: in multiplayer the Koala
//  * perceives every player separately (each one's own view, flashlight, crouch, closet),
//  * hears footsteps / running / loud objectives from any of them,
//  * picks and SWITCHES targets (visible > heard; isolated players and noisy ones are preferred),
//  * chases, loses sight, searches the last known position, re-acquires,
//  * in PERSISTENT hunts never leaves until the objective that ends the hunt is complete,
//  * downs a player instead of killing them (teammates can revive), then goes after someone else.
// It never teleports next to anyone: it spawns out of everyone's sight and walks the real geometry.
import * as THREE from 'three';
import { KoalaAI } from '../monster/ai.js';
import { rand, pick } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class MPHunter extends KoalaAI {
  constructor(g, session) {
    super(g);
    this.S = session;
    this.mode = 'off';            // off | stalk | hunt
    this.target = null;           // player record
    this.views = new Map();       // slot -> PerspectiveCamera (that player's eyes)
    this.st = {};
    this.heardList = [];
    this.phase = 'idle';
    this.cool = rand(70, 110);
    this.stalkCount = 0;
  }

  // ---- the base class reads this.player / this.cam: point them at the current target
  get player() { return this.target ? this.proxy(this.target) : this.g.player; }
  get cam() { return this.target ? this.viewOf(this.target) : this.g.camera; }
  proxy(p) { return { pos: p.pos, yaw: p.yaw, pitch: p.pitch, crouching: p.crouch, sprinting: p.sprint, moving: p.speed > 0.3, level: this.physics.levelOf(p.pos.y + 0.1) }; }
  viewOf(p) {
    let c = this.views.get(p.slot);
    if (!c) { c = new THREE.PerspectiveCamera(72, 16 / 9, 0.05, 60); this.views.set(p.slot, c); }
    c.position.copy(p.head); c.rotation.set(p.pitch, p.yaw, 0, 'YXZ'); c.updateMatrixWorld(); c.updateProjectionMatrix();
    return c;
  }
  // perception of one specific player
  sees(p) {
    const k = this.koala;
    if (!k?.visible || p.hidden || p.life === 'dead') return false;
    const kh = k.headPos, ph = p.head;
    const d = kh.distanceTo(ph);
    let range = p.flash ? 24 : 12;
    if (this.g.world.lights.power[this.physics.levelOf(p.pos.y + 0.1)] || this.g.world.lights.emergencyOn) range += 8;
    if (p.crouch) range *= 0.6;
    if (d > range) return false;
    const yaw = k.root.rotation.y;
    const to = V(ph.x - kh.x, 0, ph.z - kh.z).normalize();
    if (d > 2.5 && Math.sin(yaw) * to.x + Math.cos(yaw) * to.z < Math.cos(1.3)) return false;
    return this.physics.los(kh, ph);
  }
  seenBy(pos) { return this.S.alivePlayers().some(p => { const c = this.viewOf(p); this.target_ = p; return this.inViewFrom(c, pos) && (p.flash || this.g.world.lights.anyPower()); }); }
  inViewFrom(cam, p) {
    this.m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m4);
    if (!this.frustum.intersectsSphere(new THREE.Sphere(p, 0.7))) return false;
    return this.physics.los(cam.position, p);
  }
  hearNoise(pos, radius) {
    const k = this.koala; if (!k?.visible) { this.heardList.push({ pos: pos.clone(), t: this.time, r: radius }); return; }
    if (k.position.distanceTo(pos) < radius && Math.abs(pos.y - k.position.y) < 3) this.heardList.push({ pos: pos.clone(), t: this.time, r: radius });
  }

  // ---------------------------------------------------------------- control from the story
  stalk({ short = true } = {}) { if (this.mode === 'off') { this.mode = 'stalk'; this.persistent = false; this.cool = 0; } }
  hunt({ persistent = true, kind = 'hunt', until } = {}) {
    this.mode = 'hunt'; this.persistent = persistent; this.until = until; this.kind = kind;
    if (!this.koala.visible) this.spawnAway();
    this.phase = 'search'; this.searchT = 0; this.lostT = 0;
    this.g.music.startChase?.();
  }
  release() {
    this.mode = 'off'; this.persistent = false; this.until = null;
    if (this.koala?.visible) this.walkAway = { t: 0, to: this.farNode() };
    this.g.music.stopChase?.(3);
  }
  // SCENE 9: it followed them to the safe room. It walks the real corridor to the door, stays there -
  // sniffing, scratching, trying the handle - then gives up and goes. (Sounds come from the story.)
  besiege(outPos, doorPos, onArrive, onDone) {
    this.mode = 'besiege'; this.persistent = false; this.until = null; this.walkAway = null; this.target = null;
    this.bs = { t: 0, out: outPos.clone(), door: doorPos.clone(), stage: 'go', onArrive, onDone };
    this.koala?.play('walk', { fade: 0.4 });
    this.g.music.stopChase?.(5);
  }
  updateBesiege(dt) {
    const b = this.bs, k = this.koala; b.t += dt;
    if (b.stage === 'go') {
      const left = this.navTo(b.out, 2.4, dt, this.st);
      if (left < 1.0 || b.t > 22) { b.stage = 'at'; b.t = 0; k.speed = 0; k.play('snarl', { fade: 0.35 }); b.onArrive?.(); }
    } else if (b.stage === 'at') {
      k.faceTowards(b.door, dt, 3);
      if (b.t > 0.9 && !b.sniffed) { b.sniffed = true; k.play(k.actions.sniff ? 'sniff' : 'look_around', { fade: 0.35 }); }
      if (b.t > 5.4 && !b.snarled) { b.snarled = true; k.play('snarl', { fade: 0.3 }); }
      if (b.t > 8.5) { const cb = b.onDone; this.bs = null; this.mode = 'off'; this.walkAway = { t: 0, to: this.farNode() }; k.play('walk', { fade: 0.4 }); cb?.(); }
    }
  }
  reset() { this.bs = null; this.mode = 'off'; this.persistent = false; this.until = null; this.walkAway = null; this.target = null; this.koala?.hide(); this.cool = rand(80, 120); this.st = {}; }

  farNode() {
    const pl = this.S.alivePlayers();
    const far = this.nav.nodes.filter(n => pl.every(p => Math.hypot(n.x - p.pos.x, n.z - p.pos.z) > 16 || Math.abs(n.y - p.pos.y) > 3));
    const n = far.length ? pick(far) : pick(this.nav.nodes);
    return V(n.x, n.y, n.z);
  }
  // spawn on the level of a living player, out of everybody's sight, 14-26 m away
  spawnAway(near) {
    const pl = this.S.alivePlayers(); if (!pl.length) return false;
    const ref = near || pick(pl);
    const lvl = this.physics.levelOf(ref.pos.y + 0.1);
    const nodes = this.nav.nodes.filter(n => n.level === lvl).filter(n => {
      const d = Math.hypot(n.x - ref.pos.x, n.z - ref.pos.z);
      if (d < 14 || d > 26) return false;
      const head = V(n.x, n.y + 1.6, n.z);
      if (pl.some(p => p.pos.distanceTo(head) < 10 || this.inViewFrom(this.viewOf(p), head))) return false;
      const probe = V(n.x, n.y, n.z), b = probe.clone(); this.physics.collide(probe, 0.35, 1.9);
      return probe.distanceTo(b) < 0.25;
    });
    if (!nodes.length) return false;
    const n = pick(nodes);
    this.koala.show(V(n.x, n.y, n.z), 0, 'walk');
    this.koala.faceTowards(ref.pos);
    this.lastKnown = ref.pos.clone();
    this.st = {};
    return true;
  }

  // ---------------------------------------------------------------- per frame (host)
  update(dt) {
    this.time += dt;
    const k = this.koala; if (!k) return;
    // footsteps of every player are noise (running carries far)
    for (const p of this.S.alivePlayers()) {
      p.noiseAcc = (p.noiseAcc || 0) + dt * p.speed;
      if (p.noiseAcc > 1.6) { p.noiseAcc = 0; this.hearNoise(p.pos, p.sprint ? 16 : p.crouch ? 2.5 : 6.5); }
    }
    this.heardList = this.heardList.filter(h => this.time - h.t < 2);
    if (this.walkAway) {
      const left = this.navTo(this.walkAway.to, 2.2, dt, this.st);
      this.walkAway.t += dt;
      if (left < 1 || this.walkAway.t > 14 || (this.walkAway.t > 3 && !this.anyoneSees(k.headPos))) { this.walkAway = null; k.hide(); this.cool = rand(60, 100); }
      return;
    }
    if (this.mode === 'besiege') { if (k.visible && this.bs) this.updateBesiege(dt); else { const cb = this.bs?.onDone; this.bs = null; this.mode = 'off'; cb?.(); } return; }
    if (this.mode === 'off') return;
    if (this.mode === 'stalk' && !k.visible) {
      this.cool -= dt;
      if (this.cool > 0) return;
      if (!this.spawnAway()) { this.cool = 8; return; }
      this.phase = 'search'; this.searchT = 0; this.stalkCount++;
    }
    if (!k.visible) { if (this.mode === 'hunt' && !this.spawnAway()) return; return; }
    if (this.persistent && this.until?.()) { this.release(); return; }
    this.think(dt);
  }

  anyoneSees(pos) { return this.S.alivePlayers().some(p => this.inViewFrom(this.viewOf(p), pos)); }

  // choose who to go after: visible players first (closest, isolated, lit), else the freshest noise
  pickTarget() {
    const pl = this.S.alivePlayers(); if (!pl.length) return null;
    let best = null, bestS = -Infinity;
    for (const p of pl) {
      const d = this.koala.position.distanceTo(p.pos);
      const sees = this.sees(p);
      const mate = Math.min(99, ...pl.filter(q => q !== p).map(q => q.pos.distanceTo(p.pos)));
      let s = -d;
      if (sees) s += 40;
      if (mate > 8) s += 10;                 // the isolated one
      if (p.flash) s += 4;
      if (p.sprint) s += 4;
      if (p === this.target) s += 6;         // some commitment (no flip-flopping)
      if (s > bestS) { bestS = s; best = p; }
    }
    return best;
  }

  think(dt) {
    const k = this.koala, S = this.S;
    this.retarget = (this.retarget || 0) - dt;
    if (this.retarget <= 0 || !this.target || this.target.life !== 'alive') { this.retarget = 0.6; this.target = this.pickTarget(); }
    const t = this.target; if (!t) return;
    const sees = this.sees(t);
    const run = k.actions.charge ? 'charge' : 'chase';
    if (sees) { this.lastKnown = t.pos.clone(); this.lostT = 0; }
    else {
      this.lostT = (this.lostT || 0) + dt;
      const h = this.heardList.at(-1);
      if (h && (!this.lastHeard || h.t > this.lastHeard)) { this.lastHeard = h.t; this.lastKnown = h.pos.clone(); }
    }
    if (this.phase === 'attack') {
      this.atkT -= dt;
      if (this.atkT <= 0) { this.phase = 'search'; this.searchT = 0; this.target = null; k.play('walk', { fade: 0.3 }); }
      return;
    }
    if (this.phase !== 'chase' && sees) {
      this.phase = 'chase';
      k.play('scream', { fade: 0.1, vary: false });
      S.fx('kvocal', { id: 'koala_screech', v: 1 });
      this.screamT = 0.9;
      this.speed = this.mode === 'stalk' ? 3.2 : 3.6;
      if (this.mode === 'stalk') this.g.music.startChase?.();
      return;
    }
    if (this.phase === 'chase') {
      if (this.screamT > 0) { this.screamT -= dt; k.faceTowards(t.pos, dt, 6); if (this.screamT <= 0) k.play(run, { fade: 0.2 }); return; }
      this.speed = Math.min(this.mode === 'stalk' ? 4.3 : 4.75, (this.speed || 3.5) + dt * 0.7);
      // lunge at close range
      this.lungeCd = (this.lungeCd || 0) - dt;
      if (this.lungeT > 0) { this.lungeT -= dt; if (this.lungeT <= 0) k.play(run, { fade: 0.15 }); }
      else if (sees && this.lungeCd <= 0 && k.position.distanceTo(t.pos) < 3.3 && k.position.distanceTo(t.pos) > 1.4 && k.actions.lunge) {
        this.lungeT = 0.55; this.lungeCd = 3.4; k.play('lunge', { fade: 0.06, vary: false }); S.fx('kvocal', { id: 'koala_attack', v: 1 });
      }
      this.navTo(this.lastKnown, this.lungeT > 0 ? 6.0 : this.speed, dt, this.st);
      this.growlT = (this.growlT || rand(2, 4)) - dt;
      if (this.growlT <= 0) { this.growlT = rand(2.2, 4.5); S.fx('kvocal', { id: Math.random() < 0.6 ? 'koala_growl' : 'koala_screech', v: 0.6 + Math.random() * 0.25 }); }
      // caught: down them, then go for someone else
      if (sees && k.position.distanceTo(t.pos) < (this.lungeT > 0 ? 1.45 : 1.2) && Math.abs(t.pos.y - k.position.y) < 1.2) {
        S.down(t.slot);
        k.play('attack', { fade: 0.05, timeScale: 1.4 });
        this.phase = 'attack'; this.atkT = 1.6;
        return;
      }
      // unpredictable: having just lost them, it sometimes freezes, head jerking, then bursts forward again
      if (sees) this.stutterRolled = false;
      if (!sees && this.lostT > 0.35 && !this.stutterRolled && !this.stutterT) { this.stutterRolled = true; if (Math.random() < 0.3 && k.actions.twitch) {
        this.stutterT = 0.75; k.play('twitch', { fade: 0.05, vary: false }); k.speed = 0; S.fx('kvocal', { id: 'koala_chitter', v: 0.7 });
      } }
      if (this.stutterT > 0) { this.stutterT -= dt; k.speed = 0; if (this.stutterT <= 0) { this.stutterT = 0; this.speed = 4.6; k.play(run, { fade: 0.08 }); } return; }
      if (!sees && this.lostT > 0.6) {
        const left = k.position.distanceTo(this.lastKnown);
        if (left < 1.2 || this.lostT > 6) { this.phase = 'search'; this.searchT = 0; k.play('walk', { fade: 0.3 }); }
      }
      return;
    }
    // ---- search: go where it last saw / heard someone, look around, try nearby rooms
    this.searchT = (this.searchT || 0) + dt;
    if (!this.searchPts || this.searchT < dt * 1.5) {
      const lk = this.lastKnown || t.pos;
      const near = this.nav.nodes.filter(n => Math.abs(n.y - lk.y) < 1.2 && Math.hypot(n.x - lk.x, n.z - lk.z) < 10);
      this.searchPts = [lk.clone(), ...near.sort(() => Math.random() - 0.5).slice(0, 3).map(n => V(n.x, n.y, n.z))]; this.spi = 0;
    }
    const pt = this.searchPts[this.spi];
    if (this.pause > 0) { this.pause -= dt; if (this.pause <= 0) { this.spi++; k.play('walk', { fade: 0.3 }); } }
    else if (pt) {
      const fresh = this.heardList.at(-1);
      if (fresh && fresh.t === this.time) { this.searchPts.unshift(fresh.pos.clone()); this.spi = 0; }
      // closing on the spot: it drops into a low, slow stalk (and walks normally between spots)
      const close = k.position.distanceTo(pt) < 5 && k.actions.stalk;
      const want = close ? 'stalk' : 'walk';
      if (k.currentName !== want && (k.currentName === 'walk' || k.currentName === 'stalk')) k.play(want, { fade: 0.45 });
      if (this.navTo(pt, close ? 1.05 : 2.4, dt, this.st) < 0.7) {
        this.pause = rand(1.0, 2.4); k.speed = 0;
        const r = Math.random();
        k.play(r < 0.35 && k.actions.sniff ? 'sniff' : r < 0.7 ? 'look_around' : 'snarl', { fade: 0.3 });
        if (Math.random() < 0.4) S.fx('kvocal', { id: Math.random() < 0.5 ? 'koala_growl' : 'koala_chitter', v: 0.55 });
      }
    } else {
      // out of search points: persistent hunts re-acquire someone; short stalks give up
      if (this.persistent) { const p = pick(this.S.alivePlayers()); if (p) { this.lastKnown = p.pos.clone(); this.searchPts = null; this.searchT = 0; } }
      else if (this.searchT > 14) { this.release(); this.mode = this.stalkCount < 3 ? 'stalk' : 'off'; this.cool = rand(90, 150); }
      else { this.searchPts = null; this.searchT = 0; }
    }
  }

  get chasing() { return this.phase === 'chase'; }
  onLightning() {}                    // single-player silhouette scares are not used in multiplayer
}
