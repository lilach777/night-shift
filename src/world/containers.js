// Functional furniture: every drawer, cabinet, locker and morgue-fridge door that looks
// openable is a real movable part (Blender models in items.glb) with open/close animation,
// collision, interaction and its own recorded sounds.
import * as THREE from 'three';
import { audio } from '../audio/audio.js';

// Local layouts per prop type (prop origin = floor centre, front facing +Z).
// Drawers: model origin = bottom-centre of the front panel's back face; slides along +Z.
// Doors: model origin = bottom of the hinge edge; leaf along +X (base rotation flips it).
function partsFor(type, cat) {
  const { w, d, h } = cat;
  const P = [];
  if (type === 'desk') for (let i = 0; i < 3; i++) P.push({ kind: 'drawer', model: 'part_desk_drawer', x: -w / 2 + 0.22, y: 0.08 + i * 0.22, z: (d - 0.04) / 2 + 0.008, slide: 0.4, snd: 'drawer_metal', fw: 0.38, fh: 0.19 });
  if (type === 'filing_cabinet') for (let i = 0; i < 4; i++) P.push({ kind: 'drawer', model: 'part_filing_drawer', x: 0, y: 0.04 + i * (h - 0.06) / 4 + 0.005, z: (d - 0.02) / 2 + 0.008, slide: 0.45, snd: 'drawer_metal', fw: 0.46, fh: 0.27, start: i === 2 ? 0.35 : 0 });
  if (type === 'bedside') P.push({ kind: 'drawer', model: 'part_bedside_drawer', x: 0, y: h - 0.33, z: (d - 0.02) / 2 + 0.008, slide: 0.3, snd: 'drawer_wood', fw: 0.44, fh: 0.17 });
  if (type === 'reception_desk') for (const yy of [0.06, 0.32]) P.push({ kind: 'drawer', model: 'part_reception_drawer', x: -0.95, y: yy + 0.005, z: -0.1 - (d - 0.25) / 2 - 0.008, back: true, slide: 0.42, snd: 'drawer_wood', fw: 0.4, fh: 0.22 });
  if (type === 'cabinet') {
    P.push({ kind: 'door', model: 'part_cabinet_door', x: -w / 2 + 0.01, y: 0.1, z: d / 2 + 0.008, flip: false, leaf: 0.43, max: 1.9, snd: 'cabinet', fh: 1.7 });
    P.push({ kind: 'door', model: 'part_cabinet_door', x: w / 2 - 0.01, y: 0.1, z: d / 2 + 0.008, flip: true, leaf: 0.43, max: 1.9, snd: 'cabinet', fh: 1.7 });
  }
  if (type === 'lockers') for (let i = 0; i < 4; i++) P.push({ kind: 'door', model: 'part_locker_door', x: -w / 2 + w * i / 4 + 0.015, y: 0.05, z: d / 2 + 0.008, flip: false, leaf: 0.37, max: 1.85, snd: 'cabinet', fh: 1.8, start: i === 2 ? 0.55 : 0 });
  if (type === 'closet') P.push({ kind: 'door', model: 'part_closet_door', closet: true, x: -w / 2 + 0.04, y: 0.06, z: d / 2 + 0.02, flip: false, leaf: 1.12, max: 1.75, snd: 'closet', fh: 2.1 });
  if (type === 'morgue_fridge') {
    const cw = (w - 0.1) / 3, rh = (h - 0.25) / 3;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) P.push({ kind: 'door', model: 'part_fridge_door', x: -w / 2 + 0.05 + cw * i + 0.025, y: 0.15 + rh * j + 0.025, z: d / 2 + 0.017, flip: false, leaf: 0.92, max: 1.75, snd: 'fridge', fh: 0.6, start: i === 0 && j === 0 ? 1 : i === 1 && j === 1 ? 0.12 : 0 });
  }
  return P;
}

class Part {
  constructor(def, prop, model, parent) {
    this.def = def;
    this.prop = prop;
    this.amount = def.start || 0;
    this.target = this.amount;
    this.speed = def.kind === 'drawer' ? 2.6 : 1.7;
    this.group = new THREE.Group();                         // prop-local frame
    this.group.position.set(prop.x, prop.y, prop.z);
    this.group.rotation.y = prop.rot;
    this.pivot = new THREE.Object3D();
    this.pivot.position.set(def.x, def.y, def.z);
    this.base = def.back ? Math.PI : def.flip ? Math.PI : 0;
    this.pivot.rotation.y = this.base;
    this.pivot.add(model);
    this.group.add(this.pivot);
    parent.add(this.group);
    this.group.updateMatrixWorld(true);
    this.level = prop.level;
    this.update(0);
  }

  // world point at the handle (for interaction)
  handle() {
    const d = this.def;
    const local = new THREE.Vector3();
    if (d.kind === 'drawer') {
      const s = this.amount * d.slide * (d.back ? -1 : 1);
      local.set(d.x, d.y + d.fh * 0.55, d.z + (d.back ? -0.04 : 0.04) + s);
    } else {
      const a = this.pivot.rotation.y;
      local.set(d.x + Math.cos(a) * (d.leaf - 0.06), d.y + d.fh * 0.5, d.z - Math.sin(a) * (d.leaf - 0.06));
    }
    return local.applyMatrix4(this.group.matrixWorld);
  }

  open() { if (this.target < 0.5) this.toggle(); }
  close() { if (this.target > 0.5) this.toggle(); }

  toggle() {
    const opening = this.target < 0.5;
    this.target = opening ? 1 : 0;
    const d = this.def;
    const pos = this.handle();
    const o = { bus: 'environment', volume: 0.8, occlude: true, reverb: 0.25, refDistance: 1.8 };
    if (this.onToggle) this.onToggle(opening);
    if (d.snd === 'closet') {
      // wardrobe door: latch + a deeper, larger cabinet swing
      if (opening) audio.playAt('door_latch', pos, { ...o, volume: 0.6 });
      audio.playAt(opening ? 'cabinet_open' : 'cabinet_close', pos, { ...o, rate: 0.82, volume: 0.9, delay: opening ? 0.08 : 0 });
    } else if (d.snd === 'fridge') {
      // heavy refrigerated compartment door: latch + cabinet swing, pitched down
      if (opening) audio.playAt('door_latch', pos, { ...o, volume: 0.7, rate: 0.85 });
      audio.playAt(opening ? 'cabinet_open' : 'cabinet_close', pos, { ...o, rate: 0.78, delay: opening ? 0.1 : 0 });
    } else {
      audio.playAt(`${d.snd}_${opening ? 'open' : 'close'}`, pos, o);
    }
  }

  update(dt) {
    if (this.amount !== this.target) {
      const step = this.speed * dt;
      if (Math.abs(this.target - this.amount) <= step) this.amount = this.target;
      else this.amount += Math.sign(this.target - this.amount) * step;
    }
    const d = this.def;
    if (d.kind === 'drawer') {
      const e = this.amount * this.amount * (3 - 2 * this.amount);
      this.pivot.position.z = d.z + e * d.slide * (d.back ? -1 : 1);
    } else {
      const e = this.amount * this.amount * (3 - 2 * this.amount);
      // swing outward (toward +Z of the furniture)
      this.pivot.rotation.y = d.flip ? this.base + e * d.max : this.base - e * d.max;
    }
  }

  // collision: the open drawer's front edge / the door leaf, as a segment in world space
  segment() {
    if (this.amount < 0.2) return null;
    const d = this.def;
    const m = this.group.matrixWorld;
    let a, b;
    if (d.kind === 'drawer') {
      const z = this.pivot.position.z + (d.back ? -0.02 : 0.02);
      a = new THREE.Vector3(d.x - d.fw / 2, 0, z).applyMatrix4(m);
      b = new THREE.Vector3(d.x + d.fw / 2, 0, z).applyMatrix4(m);
    } else {
      const ang = this.pivot.rotation.y;
      a = new THREE.Vector3(d.x, 0, d.z).applyMatrix4(m);
      b = new THREE.Vector3(d.x + Math.cos(ang) * d.leaf, 0, d.z - Math.sin(ang) * d.leaf).applyMatrix4(m);
    }
    return { ax: a.x, az: a.z, bx: b.x, bz: b.z, y0: this.prop.y + d.y, y1: this.prop.y + d.y + d.fh, thick: 0.04 };
  }
  // closed closet doors block line of sight (so a hidden player can't be seen)
  blocksSight() { return !!this.def.closet && this.amount < 0.15; }
  box() {
    const d = this.def, m = this.group.matrixWorld;
    const a = new THREE.Vector3(d.x, 0, d.z).applyMatrix4(m);
    const b = new THREE.Vector3(d.x + d.leaf, 0, d.z).applyMatrix4(m);
    return { x0: Math.min(a.x, b.x) - 0.03, x1: Math.max(a.x, b.x) + 0.03, z0: Math.min(a.z, b.z) - 0.03, z1: Math.max(a.z, b.z) + 0.03, y0: this.prop.y + d.y, y1: this.prop.y + d.y + d.fh };
  }
}

export class Containers {
  constructor(g) {
    this.g = g;
    this.parts = [];
    this.byProp = new Map();          // prop id -> [parts] (fuses in drawers, closets)
    const L = g.layout;
    for (const p of L.props) {
      const defs = partsFor(p.type, L.catalog[p.type]);
      if (!defs.length) continue;
      const parent = g.world.levels[p.level] || g.scene;
      for (const def of defs) {
        const part = new Part(def, p, g.world.item(def.model), parent);
        this.parts.push(part);
        if (!this.byProp.has(p.id)) this.byProp.set(p.id, []);
        this.byProp.get(p.id).push(part);
        g.world.physics.dynamic.push(part);
        if (def.closet) continue;     // closets are driven by the hiding system
        const id = `ct_${this.parts.length}`;
        g.interact.add({
          id, pos: () => part.handle(), radius: 1.7, cone: 0.32,
          prompt: () => (part.target > 0.5 ? '[E] Close' : '[E] Open'),
          action: () => part.toggle(),
        });
      }
    }
  }
  update(dt) {
    for (const p of this.parts) if (p.amount !== p.target) p.update(dt);
  }
}
