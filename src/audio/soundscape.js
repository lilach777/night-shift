// Living-building soundscape + the "fear emitter".
//
// * Ambient one-shots placed in 3D around the listener (creaking structure, pipe knocks, vent
//   gusts, distant metal, relay clicks) chosen per zone, at irregular intervals, never the same
//   take twice in a row - the building is never quite silent and never predictably noisy.
// * Fear emitter (after Alien: Isolation): when the Koala is hunting nearby but NOT seen and not
//   chasing, two drone layers swell with its proximity - a low bowed-metal bed from ~24 m and a
//   high, thin layer inside ~10 m. The player hears danger before they see it. During chases,
//   cutscenes and the final act the layer steps aside.
import * as THREE from 'three';
import { audio } from './audio.js';
import { MANIFEST } from './manifest.js';
import { rand, clamp } from '../core/util.js';

const ZONES = {
  //            id          weight  height above floor   min..max distance  volume
  building: [['amb_creak', 1.3, [0.2, 2.6], [5, 13], 0.55], ['amb_pipe', 1.0, [2.4, 2.9], [5, 15], 0.5],
             ['amb_vent', 0.7, [2.6, 2.9], [4, 10], 0.45], ['amb_metal', 0.45, [0.3, 1.2], [10, 20], 0.5],
             ['amb_relay', 0.5, [2.5, 2.9], [3, 8], 0.3]],
  basement: [['amb_pipe', 1.4, [2.2, 3.0], [4, 14], 0.6], ['amb_metal', 0.8, [0.3, 1.5], [8, 18], 0.55],
             ['amb_vent', 0.6, [2.4, 3.0], [4, 10], 0.5], ['amb_creak', 0.4, [0.5, 2.5], [6, 12], 0.4]],
};

export class Soundscape {
  constructor(g) {
    this.g = g;
    this.next = rand(6, 12);
    this.last = {};
    this.fear = null;
    this.fearLevel = 0;
  }

  zone() {
    const p = this.g.player, B = this.g.layout.bounds;
    if (p.pos.x < B.x0 - 0.2 || p.pos.x > B.x1 || p.pos.z < B.z0 || p.pos.z > B.z1) return null;
    return p.level === 'B' ? 'basement' : 'building';
  }

  scripted() {
    const g = this.g, st = g.story?.stage;
    return g.state !== 'play' || g.story?.hideHud || st === 'intro' || st === 'containment' || st === 'ending' || st === 'end';
  }

  oneShot() {
    const z = this.zone(); if (!z) return;
    const list = ZONES[z].filter(e => MANIFEST[e[0]]);
    if (!list.length) return;
    let r = Math.random() * list.reduce((s, e) => s + e[1], 0), pick = list[0];
    for (const e of list) { r -= e[1]; if (r <= 0) { pick = e; break; } }
    const [id, , [h0, h1], [d0, d1], vol] = pick;
    const n = MANIFEST[id].length;
    let idx = Math.floor(Math.random() * n);
    if (n > 1 && idx === this.last[id]) idx = (idx + 1) % n;
    this.last[id] = idx;
    const p = this.g.player.pos, a = Math.random() * Math.PI * 2, d = rand(d0, d1);
    const floorY = this.g.world.physics.levelY?.[this.g.player.level] ?? p.y;
    const pos = new THREE.Vector3(p.x + Math.cos(a) * d, floorY + rand(h0, h1), p.z + Math.sin(a) * d);
    audio.playAt(id, pos, { bus: 'environment', index: idx, volume: vol * rand(0.75, 1), rate: rand(0.9, 1.06), occlude: true, refDistance: 3, reverb: 0.35 });
  }

  updateFear(dt) {
    const g = this.g, k = g.koala, ai = g.ai;
    let target = 0, high = 0;
    if (k?.visible && ai && !this.scripted() && !ai.isChasing?.() && !g.hiding?.current) {
      const d = k.position.distanceTo(g.player.pos);
      const sameFloor = Math.abs(k.position.y - g.player.pos.y) < 2.5;
      const seen = ai.canSee?.(k.position.clone().setY(k.position.y + 1.1)) ?? false;
      const near = clamp((24 - d) / 18, 0, 1) * (sameFloor ? 1 : 0.45);
      target = near * near * (seen ? 0.35 : 1);
      high = clamp((10 - d) / 7, 0, 1) * (seen ? 0.2 : 1) * (sameFloor ? 1 : 0.3);
    }
    if (target > 0.01 && !this.fear && MANIFEST.fear_low) {
      this.fear = {
        low: audio.play('fear_low', { bus: 'ambience', loop: true, volume: 0, fadeIn: 0.01 }),
        high: MANIFEST.fear_high ? audio.play('fear_high', { bus: 'ambience', loop: true, volume: 0, fadeIn: 0.01 }) : null,
        idle: 0,
      };
    }
    if (!this.fear) return;
    // slow attack (it creeps in), slower release (it lingers after it has gone)
    this.fearLevel += (target - this.fearLevel) * Math.min(1, dt * (target > this.fearLevel ? 0.6 : 0.25));
    this.fear.low.setVolume(0.55 * this.fearLevel, 0.25);
    this.fear.high?.setVolume(0.32 * high * this.fearLevel, 0.4);
    this.fear.idle = this.fearLevel < 0.005 ? this.fear.idle + dt : 0;
    if (this.fear.idle > 6) { this.fear.low.stop(1); this.fear.high?.stop(1); this.fear = null; this.fearLevel = 0; }
  }

  stopAll() {
    if (this.fear) { this.fear.low.stop(0.5); this.fear.high?.stop(0.5); this.fear = null; this.fearLevel = 0; }
  }

  update(dt) {
    this.updateFear(dt);
    if (this.scripted()) return;
    this.next -= dt;
    if (this.next > 0) return;
    // denser once the night has turned (power restored onwards), sparse early on
    const late = ['restored', 'aux', 'security', 'chase', 'switches', 'final'].includes(this.g.story?.stage);
    this.next = late ? rand(6, 15) : rand(9, 22);
    if (this.g.ai?.isChasing?.()) return;   // the chase is loud enough
    this.oneShot();
  }
}
