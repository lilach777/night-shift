// Hiding in walk-in closets: [E] Hide -> step inside, pull the door shut, peek through the
// louvres. [E] Exit -> push the door open and step out. The Koala does not know where you
// are — it only knows what it saw or heard (see monster/ai.js).
import * as THREE from 'three';
import { audio } from '../audio/audio.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Hiding {
  constructor(g) {
    this.g = g;
    this.closets = [];
    this.current = null;       // closet the player is in
    this.busy = false;         // entering / leaving transition
    for (const c of g.layout.closets) {
      const part = g.containers.byProp.get(c.prop)?.[0];
      if (!part) continue;
      const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
      const toWorld = (lx, lz) => V(c.x + lx * cs + lz * sn, c.y, c.z - lx * sn + lz * cs);
      const rec = {
        def: c, part,
        inside: toWorld(0.15, -0.06),
        outside: toWorld(0, 0.95 / 2 + 0.75),
        front: toWorld(0, 0.95 / 2 + 0.25),
        yaw: c.rot + Math.PI,          // looking out through the door
        level: c.level,
      };
      this.closets.push(rec);
      g.interact.add({
        id: 'hide_' + c.prop, pos: () => rec.front.clone().setY(c.y + 1.2), radius: 1.9, cone: 0.6,
        enabled: () => !this.current && !this.busy,
        prompt: () => '[E] Hide',
        action: () => this.enter(rec),
      });
    }
  }

  get hidden() { return !!this.current && !this.busy; }

  async enter(rec) {
    const g = this.g, p = g.player;
    if (this.current || this.busy) return;
    if (g.koala?.visible && g.koala.position.distanceTo(rec.front) < 1.3) return;   // it's right there
    this.busy = true;
    this.current = rec;
    this.enteredAt = g.clock.time;
    this.sawEnter = !!g.ai?.koalaSeesPlayer?.();   // did the Koala watch you get in?
    p.canMove = false;
    p.lookOverride = { yaw: rec.yaw, pitch: -0.05, speed: 6 };
    rec.part.open();
    await g.clock.wait(0.3);
    // step inside
    const from = p.pos.clone();
    p.seated = { yaw: rec.yaw, range: 0.75, eye: 1.55, lock: true };
    for (let i = 1; i <= 12; i++) {
      p.pos.lerpVectors(from, rec.inside, i / 12);
      await g.clock.wait(1 / 30);
    }
    audio.play('cloth', { bus: 'player', volume: 0.5 });
    rec.part.close();                         // pull the door shut from inside
    await g.clock.wait(0.35);
    p.lookOverride = null;
    this.busy = false;
    g.ui.toast('HIDING', 1.6);
  }

  async exit() {
    const g = this.g, p = g.player, rec = this.current;
    if (!rec || this.busy) return;
    this.busy = true;
    rec.part.open();
    await g.clock.wait(0.35);
    const from = p.pos.clone();
    for (let i = 1; i <= 10; i++) {
      p.pos.lerpVectors(from, rec.outside, i / 10);
      await g.clock.wait(1 / 30);
    }
    p.seated = null;
    p.canMove = true;
    this.current = null;
    this.busy = false;
  }

  // Called by the Koala when it rips a closet open.
  forceOut() {
    const g = this.g, rec = this.current;
    if (!rec) return;
    rec.part.open();
    this.current = null; this.busy = false;
    g.player.seated = null;
  }

  update() {
    const g = this.g;
    if (!this.current || this.busy) return;
    g.ui.setPrompt('[E] Exit');
    if (g.input.wasPressed('KeyE') && g.clock.time - this.enteredAt > 0.6) this.exit();
  }
}
