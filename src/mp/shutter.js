// NIGHT SHIFT multiplayer - emergency roller shutter (MULTIPLAYER ONLY).
// A real environmental system, not a prop:
//   * slats (Blender: ns_mpdress.py) roll up into the housing one by one; the bottom bar rides below them
//   * collision is the actual opening: the shutter blocks everything taller than the gap under the
//     bottom bar, so a crouching player slips under a half-raised shutter while the Koala (1.9 m) cannot
//   * the HOST simulates it (drop on the purge, crank holds raise it, gravity lowers it when nobody
//     cranks); clients receive the amount 15x per second and only animate + play sounds
import * as THREE from 'three';
import { audio } from '../audio/audio.js';

const H = 2.86;              // opening height under the housing
const PITCH = 0.1;           // slat pitch

export class Shutter {
  // at: { x, y, z } floor centre of the opening; axis 'z' = the shutter spans the corridor along z
  constructor(g, dressing, { id, x, y, z, width = 3.04, ry = Math.PI / 2 }) {
    this.g = g; this.id = id; this.x = x; this.y = y; this.z = z; this.ry = ry; this.width = width;
    this.amount = 1;         // 1 = fully open (rolled up), 0 = down
    this.target = 1;
    this.vel = 0;
    const grp = new THREE.Group(); grp.position.set(x, y, z); grp.rotation.y = ry;
    const frame = dressing.nodes.mp_shutter_frame?.clone(true); if (frame) grp.add(frame);
    const slat = dressing.nodes.mp_shutter_slat;
    const n = Math.ceil(H / PITCH) + 1;
    if (slat) {
      let mesh = null; slat.traverse(c => { if (c.isMesh && !mesh) mesh = c; });
      this.slats = new THREE.InstancedMesh(mesh.geometry, mesh.material, n);
      this.slats.castShadow = true; this.slats.receiveShadow = true;
      this.slats.frustumCulled = false;
      grp.add(this.slats);
    }
    this.n = n;
    this.bar = dressing.nodes.mp_shutter_bar?.clone(true) || new THREE.Group(); grp.add(this.bar);
    g.scene.add(grp);
    this.group = grp;
    this.m4 = new THREE.Matrix4();
    this.layout();
    // collision: a segment across the corridor from the bottom bar up to the housing
    const self = this, half = width / 2;
    const ax = x - Math.sin(ry) * 0 + Math.cos(ry) * -half, az = z - Math.sin(ry) * -half;
    const bx = x + Math.cos(ry) * half, bz = z - Math.sin(ry) * half;
    g.world.physics.dynamic.push({
      segment() { const gap = self.amount * H; return gap > H - 0.05 ? null : { ax, az, bx, bz, y0: y + gap, y1: y + H + 0.3, thick: 0.06 }; },
      blocksSight() { return self.amount < 0.25; },
      box() { const gap = self.amount * H; return { x0: Math.min(ax, bx) - 0.05, x1: Math.max(ax, bx) + 0.05, z0: Math.min(az, bz) - 0.05, z1: Math.max(az, bz) + 0.05, y0: y + gap, y1: y + H }; },
    });
  }

  get gap() { return this.amount * H; }
  // world position of the curtain's bottom edge (for sounds)
  get bottom() { return new THREE.Vector3(this.x, this.y + this.gap, this.z); }

  layout() {
    const lift = this.amount * H;
    if (this.slats) {
      for (let i = 0; i < this.n; i++) {
        const yy = 0.09 + i * PITCH + lift;                      // slats stack above the bottom bar
        const hidden = yy > H - 0.02;                            // rolled into the housing
        this.m4.makeTranslation(0, hidden ? -50 : yy, 0);
        this.slats.setMatrixAt(i, this.m4);
      }
      this.slats.instanceMatrix.needsUpdate = true;
    }
    this.bar.position.set(0, lift, 0);
  }

  // host: physics of the curtain. crank > 0 raises it; let go and the spring-loaded emergency curtain
  // comes back down within about a second (a lone player cannot crank and dive under). In a solo game
  // (latch) the crank's ratchet holds it where it is.
  simulate(dt, { crank = 0, drop = false, latch = false }) {
    if (drop) { this.vel = Math.min(0, this.vel) - dt * 9; }
    else if (crank > 0) this.vel = 0.3 * crank;
    else if (latch) this.vel = 0;
    else this.vel = Math.max(-0.95, Math.min(0, this.vel) - dt * 3.2);
    this.amount = Math.max(0, Math.min(1, this.amount + this.vel * dt));
    if (this.amount <= 0 && this.vel < 0) this.vel = 0;
    return this.amount;
  }

  // every client: animate toward the networked amount + sounds from the motion itself
  update(dt, netAmount) {
    const prev = this.amount;
    if (netAmount != null) this.amount += (netAmount - this.amount) * Math.min(1, dt * 14);
    const v = (this.amount - prev) / Math.max(dt, 1e-4);
    this.layout();
    const pos = this.bottom;
    // falling: a rattling roar, then the slam when it hits the floor
    if (v < -0.4 && !this.fallH) this.fallH = audio.playAt('metal_scrape', pos, { bus: 'environment', loop: true, volume: 0.9, rate: 0.7, occlude: true, reverb: 0.4, refDistance: 3 });
    if (this.fallH) { this.fallH.setPosition(pos); if (v > -0.2) { this.fallH.stop(0.15); this.fallH = null; } }
    if (prev > 0.02 && this.amount <= 0.02 && v < -0.3) {
      audio.playAt('impact_low', pos, { bus: 'environment', volume: 1, occlude: true, reverb: 0.6, refDistance: 4 });
      audio.playAt('door_slam', pos, { bus: 'environment', volume: 0.8, rate: 0.75, occlude: true, reverb: 0.5 });
      this.g.player.pos.distanceTo(pos) < 10 && this.g.player.shake(0.35, 0.4);
    }
    // cranking up: ratchet clicks at the slat rate
    if (v > 0.05) {
      this.tick = (this.tick || 0) + v * dt / 0.03;
      if (this.tick >= 1) { this.tick = 0; audio.playAt('door_latch', pos.clone().setY(this.y + 1.2), { bus: 'environment', volume: 0.35, rate: 1.5 + Math.random() * 0.2, occlude: true }); }
    }
  }
}
