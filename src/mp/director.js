// NIGHT SHIFT multiplayer - the ghost director (host only; MULTIPLAYER ONLY).
// Ghosts never kill (only the Koala downs people). Each kind has a job:
//   watcher   stands at the far end of a corridor; gone when approached or stared at
//   behind    appears right behind an ISOLATED player - their teammates see it, they do not
//   follower  trails an isolated player, moving only while nobody is looking at it
//   cctv      visible ONLY on the security cameras, standing behind a teammate
//   blocker   stands in a route; when someone comes close, the nearest door slams and locks (splits the group)
//   rusher    a short ghost chase down a corridor; contact chills you (stamina gone, light dies)
//   sound     false sounds near an isolated player: knocks, running feet, a door creaking open
// Pacing follows the story's intensity (0 quiet ... 4 final), so it builds instead of spamming.
import * as THREE from 'three';
import { rand, pick } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const KINDS = [
  ['sound', 0], ['watcher', 1], ['behind', 2], ['follower', 2], ['cctv', 2], ['blocker', 3], ['rusher', 3],
];

export class GhostDirector {
  constructor(g, S) {
    this.g = g; this.S = S;
    this.intensity = 0;
    this.next = rand(45, 70);
    this.ghosts = [];
    this.ids = 0;
    this.lastKind = {};
    this.time = 0;
  }
  setIntensity(i) { this.intensity = i; this.next = Math.min(this.next, rand(12, 25)); }
  reset() { this.ghosts = []; }
  snapshot() { return this.ghosts.map(gh => [gh.id, +gh.pos.x.toFixed(3), +gh.pos.y.toFixed(3), +gh.pos.z.toFixed(3), +gh.ry.toFixed(3), gh.anim, gh.layer, 1]); }

  get H() { return this.S.hunter; }
  levelY(p) { return this.g.layout.levels.find(l => l.id === this.g.world.physics.levelOf(p.y + 0.1))?.y ?? p.y; }
  isolated() {
    const pl = this.S.alivePlayers();
    return pl.filter(p => !p.hidden && pl.every(q => q === p || q.pos.distanceTo(p.pos) > 7));
  }
  looking(p, pos, cos = 0.93) {
    const fwd = V(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
    const to = pos.clone().setY(pos.y + 1.4).sub(p.head).normalize();
    return fwd.dot(to) > cos && this.g.world.physics.los(p.head, pos.clone().setY(pos.y + 1.4));
  }
  seenByAnyone(pos, cos = 0.8) { return this.S.alivePlayers().some(p => this.looking(p, pos, cos)); }
  clear(pos) { const q = pos.clone(), b = q.clone(); this.g.world.physics.collide(q, 0.32, 1.7); return q.distanceTo(b) < 0.15; }
  spawn(kind, pos, ry, extra = {}) {
    const gh = { id: ++this.ids, kind, pos: pos.clone(), ry, anim: 'idle', layer: 0, t: 0, seen: 0, ...extra };
    this.ghosts.push(gh); this.lastKind[kind] = this.time;
    return gh;
  }
  kill(gh, { flicker = true } = {}) {
    this.ghosts = this.ghosts.filter(x => x !== gh);
    if (flicker && gh.layer === 0) {
      for (const p of this.S.alivePlayers()) if (p.pos.distanceTo(gh.pos) < 22 && this.looking(p, gh.pos, 0.6)) this.S.fx('flicker', { t: 0.4, a: 1 }, p.slot);
      this.S.fx('sound', { id: 'light_flicker', pos: gh.pos.toArray(), o: { bus: 'environment', volume: 0.5 } });
    }
  }
  face(gh, p) { gh.ry = Math.atan2(p.pos.x - gh.pos.x, p.pos.z - gh.pos.z); }

  // ---------------------------------------------------------------- scheduling
  update(dt) {
    this.time += dt;
    for (const gh of [...this.ghosts]) { gh.t += dt; this['tick_' + gh.kind]?.(gh, dt); }
    if (this.intensity <= 0 && this.time < 600) { this.next -= dt; if (this.next <= 0) { this.next = rand(60, 100); this.make('sound'); } return; }
    const maxAlive = this.intensity >= 4 ? 3 : this.intensity >= 3 ? 2 : 1;
    this.next -= dt;
    if (this.next > 0 || this.ghosts.length >= maxAlive) return;
    const base = [999, rand(45, 70), rand(26, 44), rand(18, 32), rand(12, 22)][Math.min(4, this.intensity)];
    const opts = KINDS.filter(([k, min]) => min <= this.intensity && this.time - (this.lastKind[k] ?? -999) > 40);
    for (let tries = 0; tries < 4 && opts.length; tries++) {
      const [k] = opts.splice(Math.floor(Math.random() * opts.length), 1)[0];
      if (this.make(k)) { this.next = base; return; }
    }
    this.next = 6;
  }

  make(kind) {
    const pl = this.S.alivePlayers(); if (!pl.length) return false;
    const nav = this.g.nav, phys = this.g.world.physics;
    if (kind === 'sound') {
      const p = pick(this.isolated().length ? this.isolated() : pl);
      const r = Math.random();
      if (r < 0.35) {
        const doors = this.g.world.doors.filter(d => d.center.distanceTo(p.pos) < 9 && d.center.distanceTo(p.pos) > 3 && Math.abs(d.center.y - p.pos.y - 1) < 2);
        if (!doors.length) return false;
        const d = pick(doors);
        if (d.target < 0.2 && !d.locked && Math.random() < 0.5) d.creakOpen(rand(0.3, 0.7));
        else for (let i = 0; i < 3; i++) this.S.fx('sound', { id: 'door_bang', pos: d.center.toArray(), o: { bus: 'environment', volume: 0.55, index: i, delay: i * 0.45, occlude: true } });
      } else if (r < 0.7) {
        const back = V(Math.sin(p.yaw), 0, Math.cos(p.yaw));
        for (let i = 0; i < 6; i++) {
          const pos = p.pos.clone().addScaledVector(back, 5 + i * 0.6).setY(p.pos.y + 0.1);
          setTimeout(() => this.S.fx('sound', { id: 'run_tile', pos: pos.toArray(), o: { bus: 'environment', volume: 0.5, index: i % 4, occlude: true } }), i * 330);
        }
      } else {
        const pos = p.pos.clone().add(V(rand(-6, 6), 1, rand(-6, 6)));
        this.S.fx('sound', { id: Math.random() < 0.5 ? 'object_fall' : 'metal_scrape', pos: pos.toArray(), o: { bus: 'environment', volume: 0.6, occlude: true } });
      }
      return true;
    }
    if (kind === 'watcher') {
      const p = pick(pl);
      const lvl = phys.levelOf(p.pos.y + 0.1);
      const fwd = V(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      const nodes = nav.nodes.filter(n => n.level === lvl).map(n => V(n.x, n.y, n.z)).filter(v => {
        const d = v.distanceTo(p.pos); if (d < 11 || d > 18) return false;
        const to = v.clone().sub(p.pos).setY(0).normalize();
        return to.dot(fwd) > 0.75 && phys.los(p.head, v.clone().setY(v.y + 1.4)) && this.clear(v) && pl.every(q => q.pos.distanceTo(v) > 9);
      });
      if (!nodes.length) return false;
      const gh = this.spawn('watcher', pick(nodes), 0, { anim: Math.random() < 0.5 ? 'twitch' : 'idle' });
      this.face(gh, p);
      return true;
    }
    if (kind === 'behind' || kind === 'follower') {
      const iso = this.isolated(); if (!iso.length) return false;
      const p = pick(iso);
      const back = V(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      const pos = p.pos.clone().addScaledVector(back, kind === 'behind' ? 2.3 : 8).setY(this.levelY(p.pos));
      if (!this.clear(pos) || !phys.los(p.head, pos.clone().setY(pos.y + 1.4))) return false;
      if (this.looking(p, pos, 0.3)) return false;
      const gh = this.spawn(kind, pos, 0, { target: p.slot, anim: kind === 'behind' ? 'idle' : 'walk' });
      this.face(gh, p);
      if (kind === 'behind') this.S.fx('sound', { id: 'amb_creak', pos: pos.toArray(), o: { bus: 'environment', volume: 0.45 } }, p.slot);
      return true;
    }
    if (kind === 'cctv') {
      const views = this.S.story.cctvViewers; if (!views?.size) return false;
      for (const [viewer, cam] of views) {
        const watcher = this.S.players.get(viewer); if (!watcher || watcher.life !== 'alive') continue;
        const c = this.S.story.cctvCam(cam); if (!c) continue;
        const onCam = pl.filter(p => p.slot !== viewer && this.H?.inViewFrom(c, p.head));
        if (!onCam.length) continue;
        const p = pick(onCam);
        const back = V(Math.sin(p.yaw), 0, Math.cos(p.yaw));
        const pos = p.pos.clone().addScaledVector(back, 1.2).setY(this.levelY(p.pos));
        if (!this.clear(pos)) continue;
        const gh = this.spawn('cctv', pos, 0, { layer: 2, target: p.slot, anim: 'twitch' });
        this.face(gh, p);
        return true;
      }
      return false;
    }
    if (kind === 'blocker') {
      const iso = this.isolated(); const p = pick(iso.length ? iso : pl);
      const doors = this.g.world.doors.filter(d => !d.locked && Math.abs(d.center.y - 1 - p.pos.y) < 1.5 && d.center.distanceTo(p.pos) > 6 && d.center.distanceTo(p.pos) < 15);
      if (!doors.length) return false;
      const d = pick(doors);
      const pos = d.center.clone().setY(this.levelY(p.pos));
      const out = V(Math.sign(-pos.z) * 0, 0, Math.sign(-pos.z) * 0.9); pos.add(out);
      if (!this.clear(pos)) return false;
      const gh = this.spawn('blocker', pos, 0, { door: d.id, anim: 'idle', target: p.slot });
      this.face(gh, p);
      return true;
    }
    if (kind === 'rusher') {
      const p = pick(pl);
      const lvl = phys.levelOf(p.pos.y + 0.1);
      const nodes = nav.nodes.filter(n => n.level === lvl).map(n => V(n.x, n.y, n.z)).filter(v => {
        const d = v.distanceTo(p.pos); return d > 10 && d < 15 && phys.los(p.head, v.clone().setY(v.y + 1.4)) && this.clear(v) && !this.looking(p, v, 0.6);
      });
      if (!nodes.length) return false;
      const gh = this.spawn('rusher', pick(nodes), 0, { target: p.slot, anim: 'lurch' });
      this.face(gh, p);
      this.S.fx('sound', { id: 'distant_scream', pos: gh.pos.toArray(), o: { bus: 'environment', volume: 0.7, occlude: true } });
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- behaviours
  tick_watcher(gh) {
    const pl = this.S.alivePlayers();
    if (pl.some(p => p.pos.distanceTo(gh.pos) < 7)) return this.kill(gh);
    if (pl.some(p => this.looking(p, gh.pos))) gh.seen += 1 / 60;
    if (gh.seen > 1.6 || gh.t > 14) this.kill(gh);
  }
  tick_behind(gh) {
    const p = this.S.players.get(gh.target);
    if (!p || p.life !== 'alive') return this.kill(gh, { flicker: false });
    this.face(gh, p);
    if (this.looking(p, gh.pos, 0.55)) {
      this.S.fx('sound', { id: 'stinger_reveal', o: { bus: 'sfx', volume: 0.45 } }, p.slot);
      this.S.fx('scare', { a: 0.6, p: 0.6 }, p.slot);
      return this.kill(gh);
    }
    if (gh.t > 7) this.kill(gh, { flicker: false });
  }
  tick_follower(gh, dt) {
    const p = this.S.players.get(gh.target);
    if (!p || p.life !== 'alive' || gh.t > 26) return this.kill(gh, { flicker: false });
    const near = this.S.alivePlayers().some(q => q !== p && q.pos.distanceTo(p.pos) < 4);
    if (near) return this.kill(gh);
    const seen = this.seenByAnyone(gh.pos);
    this.face(gh, p);
    if (seen) { gh.anim = 'idle'; return; }
    gh.anim = 'walk';
    const to = p.pos.clone().sub(gh.pos).setY(0); const d = to.length();
    if (d < 1.4) { this.S.fx('chill', {}, p.slot); return this.kill(gh); }
    const step = to.normalize().multiplyScalar(Math.min(d, 1.7 * dt));
    const np = gh.pos.clone().add(step);
    if (this.g.world.physics.los(gh.pos.clone().setY(gh.pos.y + 1), np.clone().setY(np.y + 1))) gh.pos.copy(np);
  }
  tick_cctv(gh) {
    const p = this.S.players.get(gh.target);
    if (!p || gh.t > 9 || p.pos.distanceTo(gh.pos) > 3.5) return this.kill(gh, { flicker: false });
    this.face(gh, p);
  }
  tick_blocker(gh) {
    const pl = this.S.alivePlayers();
    const close = pl.find(p => p.pos.distanceTo(gh.pos) < 4.5);
    if (close && !gh.fired) {
      gh.fired = true; gh.anim = 'reach';
      const d = this.g.world.doorById[gh.door];
      this.S.fx('sound', { id: 'koala_screech', pos: gh.pos.toArray(), o: { bus: 'environment', volume: 0.8, rate: 1.3 } });
      this.S.fx('flash', { a: 0.35, c: '#cfd8e0' }, close.slot);
      if (d) { d.close(6); d.locked = 'ghost'; setTimeout(() => { if (d.locked === 'ghost') d.locked = null; }, 15000); }
      setTimeout(() => this.kill(gh), 700);
    }
    if (gh.t > 25) this.kill(gh, { flicker: false });
  }
  tick_rusher(gh, dt) {
    const p = this.S.players.get(gh.target);
    if (!p || p.life !== 'alive' || gh.t > 6) return this.kill(gh);
    this.face(gh, p);
    const to = p.pos.clone().sub(gh.pos).setY(0); const d = to.length();
    if (d < 1.2) { this.S.fx('chill', {}, p.slot); return this.kill(gh); }
    gh.pos.addScaledVector(to.normalize(), Math.min(d, 3.4 * dt));
  }

  // SCENE 11: three of the ones who never left, standing in the containment chamber behind the broken
  // glass. They do not chase and do not vanish when looked at; the purge takes them (clearKind).
  b11Ghosts() {
    if (this.ghosts.some(g => g.kind === 'b11')) return;
    for (const [x, z, ry] of [[-10.3, -7.6, 0.25], [-8.1, -8.35, 0], [-5.9, -7.3, -0.3]]) this.spawn('b11', V(x, -4, z), ry, { anim: Math.random() < 0.5 ? 'idle' : 'twitch' });
  }
  tick_b11(gh) {
    const pl = this.S.alivePlayers().filter(p => p.pos.y < -2.5);
    const p = pl.sort((a, b) => a.pos.distanceTo(gh.pos) - b.pos.distanceTo(gh.pos))[0];
    if (p) { const want = Math.atan2(p.pos.x - gh.pos.x, p.pos.z - gh.pos.z); let d = want - gh.ry; d = Math.atan2(Math.sin(d), Math.cos(d)); gh.ry += d * 0.02; }
  }
  clearKind(kind) { for (const gh of [...this.ghosts]) if (gh.kind === kind) this.kill(gh); }

  // SCENE 4: something crosses the far end of the basement corridor, in the dark, where nobody is.
  // Only when someone is actually looking down the corridor; retried a few times otherwise.
  crosser(tries = 3) {
    const pl = this.S.alivePlayers().filter(p => p.pos.y < -2.5 && Math.abs(p.pos.z) < 1.4);
    for (const p of pl) {
      const dir = Math.sign(-Math.sin(p.yaw)); if (Math.abs(Math.sin(p.yaw)) < 0.85) continue;   // facing along the corridor
      const x = p.pos.x + dir * (12 + Math.random() * 4);
      if (x < -21 || x > 16) continue;
      const from = V(x, -4, -1.25), to = V(x, -4, 1.25);
      if (!this.clear(from) || !this.g.world.physics.los(p.head, from.clone().setY(-2.6))) continue;
      const gh = this.spawn('crosser', from, 0, { anim: 'walk', to, target: p.slot });
      gh.ry = 0; return true;
    }
    if (tries > 1) setTimeout(() => this.crosser(tries - 1), 6000);
    return false;
  }
  tick_crosser(gh, dt) {
    const d = gh.to.clone().sub(gh.pos); const L = d.length();
    if (L < 0.05 || gh.t > 4) return this.kill(gh, { flicker: false });
    gh.pos.addScaledVector(d.normalize(), Math.min(L, 1.25 * dt));
    gh.ry = Math.atan2(d.x, d.z);
  }
  // SCENE 7: a figure only the security cameras can see
  apparition(pos, ry, secs = 8) { return this.spawn('appar', pos, ry, { layer: 2, anim: 'idle', life: secs }); }
  tick_appar(gh) { if (gh.t > gh.life) this.kill(gh, { flicker: false }); }
}
