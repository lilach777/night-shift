// Reusable horror-event manager. Events are rare, spaced by a global gap plus
// per-event cooldowns — silence is part of the design.
import * as THREE from 'three';
import { audio } from '../audio/audio.js';
import { say } from './voice.js';
import { save } from '../core/save.js';
import { rand, pick } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class HorrorEvents {
  constructor(g) {
    this.g = g;
    this.enabled = false;
    this.next = rand(30, 50);
    this.cool = {};
    this.time = 0;
    this.active = [];
    this.decals = [];
    this.EVENTS = {
      door_slam: { cd: 150, w: 3, run: () => this.doorSlam() },
      door_open: { cd: 160, w: 2, run: () => this.doorCreak() },
      footsteps_distant: { cd: 120, w: 2.5, run: () => this.footstepsDistant() },
      shadow_cross: { cd: 240, w: 1.2, run: () => this.g.ai.enabled && !this.g.ai.enc && this.g.ai.enc_crawl(this.g.player.level) },
      object_fall: { cd: 120, w: 2.5, run: () => this.objectFall() },
      phone_ring: { cd: 260, w: 1.5, run: () => this.phoneRing() },
      distant_scream: { cd: 300, w: 1, run: () => this.distantScream() },
      machine: { cd: 220, w: 1.5, run: () => this.machine() },
      light_flicker: { cd: 140, w: 2, run: () => this.lightFlicker() },
      handprint: { cd: 260, w: 1.4, run: () => this.handprint() },
      breathing: { cd: 200, w: 1.5, run: () => this.breathing() },
      pa: { cd: 300, w: 1, run: () => this.pa() },
      elevator: { cd: 280, w: 1.2, run: () => this.elevator() },
      false_jumpscare: { cd: 360, w: 0.8, run: () => this.falseScare() },
      footsteps_behind: { cd: 260, w: 1.3, run: () => this.footstepsBehind() },
      go_back: { cd: 1e9, w: 1.4, run: () => this.goBack() },   // once only
      apparition: { cd: 420, w: 1.1, run: () => this.apparition() },   // max twice per night
    };
  }

  get p() { return this.g.player.pos; }
  get lvl() { return this.g.player.level; }
  levelY(l = this.lvl) { return this.g.layout.levels.find(x => x.id === l).y; }

  update(dt) {
    this.time += dt;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      a.t += dt;
      if (a.update(dt) === false) this.active.splice(i, 1);
    }
    if (!this.enabled || this.g.ai.enc) return;
    // the finale and the morning are fully scripted: no random scares on top of them
    const st = this.g.story?.stage;
    if (st === 'containment' || st === 'ending' || st === 'end') return;
    this.next -= dt;
    if (this.next > 0) return;
    const late = this.g.fuses?.collected >= 2;
    this.next = late ? rand(22, 50) : rand(30, 65);
    const avail = Object.entries(this.EVENTS).filter(([k, e]) => (this.cool[k] ?? -1e9) + e.cd < this.time);
    for (let tries = 0; tries < 4 && avail.length; tries++) {
      const total = avail.reduce((s, [, e]) => s + e.w, 0);
      let r = Math.random() * total, chosen = avail[0];
      for (const a of avail) { r -= a[1].w; if (r <= 0) { chosen = a; break; } }
      const ok = chosen[1].run();
      if (ok !== false) { this.cool[chosen[0]] = this.time; if (this.g.debug) this.g.debug.log('event: ' + chosen[0]); return; }
      avail.splice(avail.indexOf(chosen), 1);
    }
  }

  trigger(name) { const e = this.EVENTS[name]; if (e) { this.cool[name] = this.time; return e.run(); } }

  // ------------------------------------------------------------------ events
  doorSlam() {
    const ds = this.g.world.doors.filter(d => d.level === this.lvl && d.amount > 0.5 && !d.locked && d.center.distanceTo(this.p) > 5 && d.center.distanceTo(this.p) < 20);
    if (!ds.length) return false;
    pick(ds).slam();
    this.g.breathing.scare(0.35);
  }
  doorCreak() {
    const ds = this.g.world.doors.filter(d => d.level === this.lvl && d.amount < 0.2 && !d.locked && d.center.distanceTo(this.p) > 4 && d.center.distanceTo(this.p) < 16);
    if (!ds.length) return false;
    pick(ds).creakOpen(rand(0.4, 0.9));
  }
  footstepsDistant() {
    const nodes = this.g.nav.nodes.filter(n => Math.abs(n.y - this.p.y) < 5 && Math.hypot(n.x - this.p.x, n.z - this.p.z) > 10 && Math.hypot(n.x - this.p.x, n.z - this.p.z) < 22);
    if (!nodes.length) return false;
    const n = pick(nodes);
    const dir = Math.random() < 0.5 ? 1 : -1;
    let i = 0, acc = 0;
    const pos = V(n.x, n.y + 0.1, n.z);
    this.active.push({ t: 0, update: dt => {
      acc += dt;
      if (acc > 0.62) { acc = 0; pos.x += dir * 0.75; audio.playAt('step_tile', pos, { bus: 'environment', volume: 0.55, occlude: true, rate: 0.82, refDistance: 3 }); if (++i > 8) return false; }
    } });
  }
  objectFall() {
    const props = this.g.layout.props.filter(pr => pr.level === this.lvl && ['cart', 'shelf', 'cabinet', 'lab_bench', 'monitor_cart', 'iv_stand'].includes(pr.type));
    const c = props.filter(pr => Math.hypot(pr.x - this.p.x, pr.z - this.p.z) > 5 && Math.hypot(pr.x - this.p.x, pr.z - this.p.z) < 18);
    if (!c.length) return false;
    const pr = pick(c);
    audio.playAt('object_fall', V(pr.x, pr.y + 0.8, pr.z), { bus: 'environment', volume: 1, occlude: true, reverb: 0.5 });
    this.g.breathing.scare(0.25);
  }
  phoneRing() {
    const phones = this.g.story.phoneObjs.filter(p => p.def.level === this.lvl && p.obj.position.distanceTo(this.p) > 6 && p.obj.position.distanceTo(this.p) < 28);
    if (!phones.length) return false;
    const ph = pick(phones);
    const pos = ph.obj.position.clone().setY(ph.obj.position.y + 0.3);
    const ring = audio.playAt('phone_ring', pos, { bus: 'environment', loop: true, volume: 0.85, occlude: true, refDistance: 2.5, reverb: 0.4 });
    const id = 'evphone_' + ph.def.id;
    let answered = false;
    this.g.interact.add({
      id, pos, radius: 2, prompt: () => '[E] Answer Phone',
      action: () => {
        answered = true; ring.stop(0.05); this.g.interact.remove(id);
        audio.play('phone_pickup', { bus: 'sfx', volume: 0.8 });
        const st = audio.play('phone_static', { bus: 'voice', volume: 0.45 });
        audio.play('koala_breath', { bus: 'voice', volume: 0.6, lowpass: 2400, delay: 0.6 });
        setTimeout(() => { st.stop(0.2); audio.play('phone_hangup', { bus: 'sfx', volume: 0.8 }); this.g.breathing.scare(0.4); }, 4200);
      },
    });
    const dur = rand(8, 13);
    const interact = this.g.interact;
    this.active.push({ t: 0, update() {
      if (answered) return false;
      if (this.t > dur) { ring.stop(0.1); interact.remove(id); return false; }
    } });
  }
  distantScream() {
    const ly = this.g.layout.levels.filter(l => l.id !== this.lvl);
    const l = pick(ly);
    audio.playAt('distant_scream', V(rand(-18, 16), l.y + 1.5, rand(-6, 6)), { bus: 'environment', volume: 0.8, occlude: true, refDistance: 8, bigReverb: 0.6 });
    this.g.breathing.scare(0.25);
  }
  machine() {
    const ms = this.g.layout.props.filter(pr => pr.level === this.lvl && pr.type === 'monitor_cart' && Math.hypot(pr.x - this.p.x, pr.z - this.p.z) < 20 && Math.hypot(pr.x - this.p.x, pr.z - this.p.z) > 3);
    if (!ms.length) return false;
    const m = pick(ms);
    const pos = V(m.x, m.y + 1.1, m.z);
    const s = audio.playAt('monitor_beep', pos, { bus: 'environment', loop: true, volume: 0.7, occlude: true, refDistance: 2.5 });
    const light = this.g.monitorGlow;
    light.position.copy(pos).add(V(0, 0.1, 0));
    const dur = rand(7, 11);
    this.active.push({ t: 0, update() {
      light.intensity = this.t < dur ? 1.2 * (0.6 + 0.4 * Math.sin(this.t * 6)) : 0;
      if (this.t > dur) { s.stop(0.4); light.intensity = 0; return false; }
    } });
  }
  lightFlicker() {
    const fx = this.g.world.lights.fixtures.filter(f => f.level === this.lvl && Math.hypot(f.x - this.p.x, f.z - this.p.z) < 12 && !this.g.world.lights.power[f.level]);
    if (!fx.length) return false;
    const f = pick(fx);
    const buzz = audio.playAt('light_buzz', V(f.x, f.y, f.z), { bus: 'environment', volume: 0.7, loop: true, occlude: true });
    const dur = rand(1.8, 3.5);
    this.active.push({ t: 0, update() {
      f.forced = Math.random() < 0.45 ? 0 : rand(0.4, 1);
      if (this.t > dur) { f.forced = null; buzz.stop(0.05); audio.playAt('light_flicker', V(f.x, f.y, f.z), { bus: 'environment', volume: 0.6 }); return false; }
    } });
  }
  handprint() {
    const g = this.g;
    if (!g.world.decalMat) return false;
    // a bloody handprint appears on a corridor wall behind the player
    const fwd = new THREE.Vector3(-Math.sin(g.player.yaw), 0, -Math.cos(g.player.yaw));
    const x = this.p.x - fwd.x * rand(2.5, 5);
    if (Math.abs(this.p.z) > 1.4 || x < -21 || x > 16.5) return false;
    const side = Math.random() < 0.5 ? 1 : -1;
    const z = side * (1.5 - 0.09 - 0.006);
    const geo = new THREE.PlaneGeometry(0.34, 0.34);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.75 + uv.getX(i) * 0.25, 0.5 + uv.getY(i) * 0.5);
    const m = new THREE.Mesh(geo, g.world.decalMat);
    m.position.set(x, this.levelY() + rand(1.0, 1.5), z);
    m.rotation.y = side > 0 ? Math.PI : 0;
    m.rotation.z = rand(-0.4, 0.4);
    g.scene.add(m);
    this.decals.push(m);
    audio.playAt('wet_slap', m.position, { bus: 'environment', volume: 0.45 });
  }
  breathing() {
    const nodes = this.g.nav.nodes.filter(n => n.level === this.lvl && (n.tag || '').startsWith('room:') && Math.hypot(n.x - this.p.x, n.z - this.p.z) < 9 && Math.hypot(n.x - this.p.x, n.z - this.p.z) > 3);
    if (!nodes.length) return false;
    const n = pick(nodes);
    audio.playAt('koala_breath', V(n.x, n.y + 1.4, n.z), { bus: 'monster', volume: 0.75, occlude: true, hrtf: true, refDistance: 1.5 });
    this.g.breathing.scare(0.3);
  }
  pa() {
    const sp = this.g.layout.speakers.filter(s => s.level === this.lvl).sort((a, b) => Math.hypot(a.x - this.p.x, a.z - this.p.z) - Math.hypot(b.x - this.p.x, b.z - this.p.z))[0];
    if (!sp) return false;
    const pos = V(sp.x, sp.y, sp.z);
    audio.playAt('pa_click', pos, { bus: 'environment', volume: 0.8 });
    audio.playAt('pa_static', pos, { bus: 'environment', volume: 0.5, delay: 0.2 });
  }
  elevator() {
    const pos = V(19.5, this.levelY() + 1.2, 4.3);
    if (pos.distanceTo(this.p) > 26) return false;
    audio.playAt('elevator_motor', pos, { bus: 'environment', volume: 0.7, occlude: true, refDistance: 3 });
    audio.playAt('elevator_ding', pos, { bus: 'environment', volume: 0.8, occlude: true, delay: 4.2, reverb: 0.5 });
  }
  // The woman in the corridor (MPFB ghost model). Far down the corridor he is facing, under a
  // failing tube; she twitches or lurches toward him. The moment she has been seen long enough,
  // or he gets close, the tube cuts out - and when it catches again she is gone. Max twice per night.
  apparition() {
    const g = this.g, F = g.story.flags, p = this.p;
    if ((F.apparitions || 0) >= 2 || !g.world.humans.ghost) return false;
    if (Math.abs(p.z) > 1.4 || p.x > 16.5 || p.x < -21) return false;            // corridor only
    const fwd = -Math.sin(g.player.yaw), dirX = Math.sign(fwd);
    if (Math.abs(fwd) < 0.7) return false;                                       // must be looking along it
    const y = this.levelY();
    const fx = g.world.lights.fixtures.filter(f => f.level === this.lvl && Math.abs(f.z) < 1 &&
      (f.x - p.x) * dirX > 10 && (f.x - p.x) * dirX < 17 && f.x > -20.5 && f.x < 16);
    if (!fx.length) return false;
    const f = pick(fx);
    const at = V(f.x, y, rand(-0.35, 0.35));
    if (!g.world.physics.los(p.clone().setY(y + 1.6), at.clone().setY(y + 1.5))) return false;
    F.apparitions = (F.apparitions || 0) + 1;
    const ghost = g.world.item('ghost');
    ghost.position.copy(at); ghost.rotation.y = Math.atan2(p.x - at.x, p.z - at.z);
    g.scene.add(ghost);
    const U = ghost.userData, lurch = Math.random() < 0.4;
    U.play(lurch ? 'lurch' : 'twitch', 0);
    let seen = 0, gone = false, out = 0, sting = false;
    const cam = g.camera, tmp = new THREE.Vector3();
    this.active.push({ t: 0, update: dt => {
      if (gone) { f.forced = null; return false; }
      // the tube she stands under is failing the whole time
      f.forced = out > 0 ? 0 : (Math.random() < 0.12 ? rand(0.05, 0.3) : rand(0.55, 0.9));
      if (out > 0) { out -= dt; if (out <= 0) { ghost.removeFromParent(); gone = true; audio.playAt('light_flicker', V(f.x, f.y, f.z), { bus: 'environment', volume: 0.5 }); } return; }
      const d = ghost.position.distanceTo(p);
      cam.getWorldDirection(tmp);
      const to = ghost.position.clone().setY(y + 1.4).sub(cam.position).normalize();
      if (tmp.dot(to) > 0.95) {
        seen += dt;
        if (!sting && seen > 0.25) { sting = true; audio.play('stinger_reveal', { bus: 'sfx', volume: 0.32 }); g.breathing.scare(0.45); }
      }
      if (lurch && seen > 0.3) {                                   // she comes toward him, slowly
        tmp.set(p.x - ghost.position.x, 0, p.z - ghost.position.z).normalize();
        ghost.position.addScaledVector(tmp, 0.75 * dt);
        U.current?.setEffectiveTimeScale(0.62);
      }
      ghost.rotation.y = Math.atan2(p.x - ghost.position.x, p.z - ghost.position.z);
      if (seen > (lurch ? 2.6 : 1.4) || d < 6.5 || (this._appT = (this._appT || 0) + dt) > 9) {
        out = rand(0.35, 0.6);                                     // the light dies... and she with it
        audio.playAt('amb_relay', V(f.x, f.y, f.z), { bus: 'environment', volume: 0.6, index: 0 });
        this._appT = 0;
      }
    } });
  }
  falseScare() {
    const behind = this.p.clone().add(new THREE.Vector3(Math.sin(this.g.player.yaw), 1.2, Math.cos(this.g.player.yaw)).multiplyScalar(2));
    audio.playAt('impact_low', behind, { bus: 'environment', volume: 1, hrtf: true });
    this.g.flashlight.flicker(0.5, 0.9);
    this.g.breathing.scare(0.5);
    this.g.player.shake(0.3, 0.25);
  }
  footstepsBehind() {
    const g = this.g;
    if (!g.player.moving) return false;
    let n = 0, acc = 0, stop = false;
    this.active.push({ t: 0, update: dt => {
      if (!g.player.moving) stop = true;
      if (stop) return false;
      acc += dt;
      if (acc > 0.55) {
        acc = 0;
        const back = g.player.pos.clone().add(new THREE.Vector3(Math.sin(g.player.yaw), 0.1, Math.cos(g.player.yaw)).multiplyScalar(3.6));
        audio.playAt(g.player.surface(), back, { bus: 'environment', volume: 0.45, hrtf: true, rate: 0.85 });
        if (++n > 6) return false;
      }
    } });
  }
  // "GO BACK!" — happens ONCE per playthrough (remembered in checkpoints): a loud scream from
  // right behind him, the flashlight stutters, the camera jolts. Never repeats.
  goBack() {
    const g = this.g, F = g.story.flags;
    if (F.goBack) return false;
    F.goBack = true;
    const s = save.load();                     // remembered even if he dies before the next checkpoint
    if (s) { s.flags = { ...(s.flags || {}), goBack: true }; save.write(s); }
    const behind = this.p.clone().add(new THREE.Vector3(Math.sin(g.player.yaw), 0, Math.cos(g.player.yaw)).multiplyScalar(2.2)).setY(this.p.y + 1.6);
    say(g.ui, 'vo_go_back', { volume: 1, pos: behind, refDistance: 6, reverb: 0.25, bigReverb: 0.35 });
    g.flashlight.flicker(1.0, 1.4);
    g.player.shake(0.9, 0.7);
    g.post.pulse(0.8, 0.3);
    g.breathing.scare(0.9);
  }
}
