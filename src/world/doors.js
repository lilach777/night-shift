// Hinged interactive doors with physics segments and sight blocking.
// Each door type has its own real recordings (CC0): wooden hospital doors, the heavy
// power-room door, heavy basement doors and the morgue door. Sounds are synchronised to
// the animation: handle/latch + swing when opening; the closing recording is scheduled so
// its impact lands exactly when the leaf reaches the frame.
import * as THREE from 'three';
import { audio } from '../audio/audio.js';

// open: sound id, delay after the handle; close: id + seconds from clip start to impact.
const SOUNDS = {
  wood: { latch: true, open: 'door_wood_open', openDelay: 0.1, close: 'door_wood_close', closeLead: 0.1, speed: 1.5, vol: 0.85 },
  heavy: { latch: false, open: 'door_heavy_open', openDelay: 0, close: 'door_heavy_close', closeLead: 0.3, speed: 1.0, vol: 0.95 },
  basement: { latch: true, open: 'door_basement_open', openDelay: 0.12, close: 'door_basement_close', closeLead: 0.2, speed: 0.6, vol: 0.9 },
  morgue: { latch: false, open: 'door_morgue_open', openDelay: 0, close: 'door_morgue_close', closeLead: 0.08, speed: 0.75, vol: 0.95 },
};

export class Door {
  constructor(def, model, scene, physics, variant = 'wood') {
    this.def = def;
    this.id = def.id;
    this.level = def.level;
    this.locked = def.locked;
    this.kind = def.kind;
    this.variant = variant;
    this.snd = SOUNDS[variant] || SOUNDS.wood;
    this.width = def.w;
    this.amount = def.state === 'open' ? 1 : def.state === 'ajar' ? 0.16 : 0;
    this.target = this.amount;
    this.speed = this.snd.speed;
    this.dir = def.side === 'N' ? -1 : 1;   // swing into the room
    this.maxAngle = 1.5;
    this.pivot = new THREE.Object3D();
    this.pivot.position.set(def.x - 0.55, def.y, def.z);
    this.leaf = model;
    this.pivot.add(model);
    scene.add(this.pivot);
    this.physics = physics;
    physics.dynamic.push(this);
    this.center = new THREE.Vector3(def.x, def.y + 1.1, def.z);
    this.creak = null;
    this.closeSound = null;   // pending closing sound: { id, lead, vol }
    this.update(0);
  }

  get angle() { return this.dir * this.amount * this.maxAngle; }
  get isOpen() { return this.amount > 0.5; }

  segment() {
    const a = this.angle;
    const ax = this.pivot.position.x, az = this.pivot.position.z;
    return { ax, az, bx: ax + Math.cos(a) * 1.1, bz: az - Math.sin(a) * 1.1, y0: this.def.y, y1: this.def.y + 2.15, thick: 0.05 };
  }
  blocksSight() { return this.amount < 0.12; }
  box() {
    const d = this.def;
    return { x0: d.x - 0.6, x1: d.x + 0.6, z0: d.z - 0.05, z1: d.z + 0.05, y0: d.y, y1: d.y + 2.2 };
  }

  play(id, opts = {}) {
    return audio.playAt(id, this.center, { bus: 'environment', occlude: true, reverb: 0.3, refDistance: 2.5, ...opts });
  }

  open(speed, sound = true) {
    if (this.target === 1) return;
    this.target = 1; this.speed = speed ?? this.snd.speed;
    this.closeSound = null;
    if (sound) {
      if (this.snd.latch) this.play('door_latch', { volume: 0.7 * this.snd.vol });
      this.play(this.snd.open, { volume: this.snd.vol, delay: this.snd.openDelay });
    }
  }
  close(speed, sound = true) {
    if (this.target === 0) return;
    this.target = 0; this.speed = speed ?? this.snd.speed;
    this.closeSound = sound ? { id: this.snd.close, lead: this.snd.closeLead, vol: this.snd.vol } : null;
  }
  toggle() { if (this.target > 0.5) this.close(); else this.open(); }
  slam() {
    this.target = 0; this.speed = 7;
    this.closeSound = { id: 'door_slam', lead: 0.2, vol: 1, slam: true };
  }
  creakOpen(to = 0.85) {
    this.target = to; this.speed = 0.18;
    this.closeSound = null;
    this.creak = this.play('door_creak', { volume: 0.95, reverb: 0.4 });
  }

  update(dt) {
    if (this.amount !== this.target) {
      const step = this.speed * dt;
      // fire the closing recording early so its impact coincides with the leaf hitting the frame
      if (this.closeSound && this.target === 0) {
        const remaining = this.amount / Math.max(0.01, this.speed);
        if (remaining <= this.closeSound.lead) {
          const c = this.closeSound; this.closeSound = null;
          this.play(c.id, { volume: c.vol, reverb: c.slam ? 0.5 : 0.3, refDistance: c.slam ? 4 : 2.5 });
        }
      }
      if (Math.abs(this.target - this.amount) <= step) this.amount = this.target;
      else this.amount += Math.sign(this.target - this.amount) * step;
      if (this.amount === 0 && this.closeSound) {
        const c = this.closeSound; this.closeSound = null;
        this.play(c.id, { volume: c.vol, reverb: c.slam ? 0.5 : 0.3 });
      }
    }
    this.pivot.rotation.y = this.angle;
  }
}

export class EntranceDoors {
  constructor(models, scene, physics, def) {
    this.def = def;
    this.locked = true;
    this.amount = 0; this.target = 0; this.speed = 1;
    this.leaves = [];
    const hz = def.w / 2;
    // left leaf hinged at z=-1.3 extending toward +z; right at z=+1.3 toward -z. Open outward (-x).
    const mk = (model, z, base) => {
      const pivot = new THREE.Object3D();
      pivot.position.set(def.x, def.y, z);
      pivot.add(model);
      scene.add(pivot);
      this.leaves.push({ pivot, base });
    };
    mk(models[0], -hz, -Math.PI / 2);
    mk(models[1], hz, Math.PI / 2);
    physics.dynamic.push(this);
    this.center = new THREE.Vector3(def.x, 1.2, 0);
    this.update(0);
  }
  segment() {
    if (this.amount > 0.6) return null;
    return { ax: this.def.x, az: -1.35, bx: this.def.x, bz: 1.35, y0: 0, y1: 2.6, thick: 0.08 };
  }
  blocksSight() { return false; }
  open(speed = 0.8) { this.target = 1; this.speed = speed; }
  close(speed = 1.2) { this.target = 0; this.speed = speed; }
  update(dt) {
    if (this.amount !== this.target) {
      const step = this.speed * dt;
      if (Math.abs(this.target - this.amount) <= step) this.amount = this.target;
      else this.amount += Math.sign(this.target - this.amount) * step;
    }
    const a = this.amount * 1.35;
    this.leaves[0].pivot.rotation.y = this.leaves[0].base - a;
    this.leaves[1].pivot.rotation.y = this.leaves[1].base + a;
  }
}
