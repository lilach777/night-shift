// Reusable interaction targets: proximity + view cone + line of sight.
import * as THREE from 'three';

export class Interactions {
  constructor(camera, physics) {
    this.camera = camera;
    this.physics = physics;
    this.items = new Map();
    this.current = null;
    this.enabled = true;
  }

  // def: { id, pos:Vector3, radius, prompt:()=>string|null, action:()=>void, enabled?:()=>bool, cone? }
  add(def) {
    const d = { radius: 1.9, cone: 0.5, enabled: () => true, ...def };
    this.items.set(d.id, d);
    return d;
  }
  remove(id) { this.items.delete(id); if (this.current?.id === id) this.current = null; }
  get(id) { return this.items.get(id); }

  update(ui, input) {
    if (!this.enabled) { this.current = null; ui.setPrompt(null); return; }
    const cam = this.camera.position;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    let best = null, bestScore = -Infinity;
    const to = new THREE.Vector3();
    for (const it of this.items.values()) {
      const p = typeof it.pos === 'function' ? it.pos() : it.pos;
      const d = p.distanceTo(cam);
      if (d > it.radius) continue;
      if (!it.enabled()) continue;
      to.subVectors(p, cam).normalize();
      const dot = fwd.dot(to);
      // wider cone when very close
      const need = Math.cos(Math.min(1.1, it.cone + Math.atan(0.25 / Math.max(0.2, d))));
      if (dot < need) continue;
      const score = dot * 2 - d * 0.35;
      if (score <= bestScore) continue;
      const pp = p.clone().addScaledVector(to, -0.25);
      if (!this.physics.los(cam, pp)) continue;
      best = it; bestScore = score;
    }
    this.current = best;
    const text = best ? best.prompt() : null;
    ui.setPrompt(text);
    if (best && text && input.wasPressed('KeyE')) best.action();
  }
}
