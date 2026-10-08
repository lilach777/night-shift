// Intro cinematic: storm, hospital exterior, Arman's car arriving, walking in,
// the main doors closing behind him. Short (~26 s) and skippable (SPACE).
import * as THREE from 'three';
import { audio } from '../audio/audio.js';
import { CamTrack, loadCamTrack } from './camtrack.js';
import { Track } from '../core/curves.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ease = t => t * t * (3 - 2 * t);

export class IntroCinematic {
  constructor(g) {
    this.g = g;
    this.t = 0;
    this.done = false;
    const L = g.layout;
    this.car = g.world.item('car');
    g.scene.add(this.car);
    const pts = L.exterior.carPath.map(([x, z]) => V(x, 0, z));
    this.carCurve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.headlight = g.carLight;
    this.engine = null;
    this.events = new Set();
    this.walkFrom = V(-35.2, 0, 3.4);
    this.door = V(L.bounds.x0 - 0.6, 0, 0);
    this.inside = V(L.exterior.playerStart.x, 0, L.exterior.playerStart.z);
    this.duration = 27;
    this.baseFov = g.camera.fov;
    // shots A-C are authored in Blender (ns_camera.py) and baked; the code below is the fallback
    this.track = null;
    loadCamTrack('intro').then(d => { if (d) this.track = new CamTrack(d); });
    // shot E: glance back at the closing doors - cubic ease-in-out out, hold, sine settle home
    this.glance = new Track([
      { t: 0, v: 0, interp: 'CUBIC', easing: 'EASE_IN_OUT' },
      { t: 0.95, v: 2.3, interp: 'SINE', easing: 'EASE_OUT' },
      { t: 1.15, v: 2.2, interp: 'CONSTANT' },
      { t: 1.55, v: 2.2, interp: 'CUBIC', easing: 'EASE_IN_OUT' },
      { t: 2.5, v: 0 },
    ]);
  }

  once(name, at, fn) { if (this.t >= at && !this.events.has(name)) { this.events.add(name); fn(); } }

  start() {
    const g = this.g;
    g.ui.letterbox(true);
    g.ui.hud(false);
    g.player.canMove = false; g.player.canLook = false;
    this.car.position.copy(this.carCurve.getPoint(0));
    this.rainOut = audio.play('rain_outside', { bus: 'ambience', loop: true, volume: 0.9, fadeIn: 2 });
    this.wind = audio.play('wind', { bus: 'ambience', loop: true, volume: 0.5, fadeIn: 2 });
    g.world.lightning.next = 999;
  }

  carAt(u) {
    const p = this.carCurve.getPoint(Math.min(1, u));
    const tan = this.carCurve.getTangent(Math.min(0.999, u));
    this.car.position.copy(p);
    this.car.rotation.y = Math.atan2(tan.x, tan.z);
    if (this.headlight) {
      this.headlight.position.copy(p).add(new THREE.Vector3(tan.x * 2.4, 0.7, tan.z * 2.4));
      this.headlight.target.position.copy(p).add(new THREE.Vector3(tan.x * 14, -0.6, tan.z * 14));
    }
    if (this.engine) this.engine.setPosition(p);
  }

  skip() { this.t = this.duration; this.finish(); }

  update(dt) {
    if (this.done) return;
    const g = this.g, cam = g.camera, L = g.layout;
    this.t += dt;
    const t = this.t;
    if (g.input.wasPressed('Space') || g.input.wasPressed('Enter')) { this.skip(); return; }
    // --- Shot A (0-6.5): wide exterior in the storm
    this.once('titleA', 0.8, () => g.ui.timecard('ST. MERCY HOSPITAL  ·  11:52 PM', 3.2));
    this.once('strike0', 0.6, () => g.world.lightning.strike(0.7, false));
    this.once('strike1', 2.6, () => g.world.lightning.strike(1, true));
    this.once('car', 4.5, () => {
      if (this.headlight) this.headlight.intensity = 60;
      this.engine = audio.playAt('car_engine', this.car.position, { bus: 'environment', loop: true, volume: 0.9, refDistance: 6, fadeIn: 1 });
    });
    const authored = t < 16.5 && !!this.track && this.track.apply(cam, Math.min(t, this.track.end));
    if (!authored && t < 6.5) {
      const u = ease(t / 6.5);
      cam.position.lerpVectors(V(-80, 9, -30), V(-70, 6.5, -21), u);
      cam.lookAt(-14, 7.5 - u * 2, 0);
    }
    // --- Shot B (6.5-13): car tracking along the road into the car park
    const carU = t < 4.5 ? 0 : Math.min(1, (t - 4.5) / 10.5);
    this.carAt(ease(carU));
    if (!authored && t >= 6.5 && t < 13) {
      const u = (t - 6.5) / 6.5;
      cam.position.lerpVectors(V(-55, 1.3, 17), V(-48, 1.6, 15), u);
      cam.lookAt(this.car.position.x, 1.0, this.car.position.z);
    }
    this.once('strike2', 10.8, () => g.world.lightning.strike(0.8, false));
    // --- Shot C (13-16.5): car stops, engine off, door
    this.once('engineOff', 15.0, () => { this.engine?.stop(1.2); if (this.headlight) this.headlight.intensity = 0; });
    this.once('carDoor', 15.9, () => { audio.playAt('car_door', this.car.position, { bus: 'environment', volume: 1 }); });
    if (!authored && t >= 13 && t < 16.5) {
      const u = ease((t - 13) / 3.5);
      cam.position.lerpVectors(V(-43, 1.8, 10), V(-41, 1.7, 8.5), u);
      cam.lookAt(V(-36, 1.0, 5).lerp(V(-22, 2.2, 0), u));
    }
    // --- Shot D (16.5-24.5): POV walk to the entrance and inside
    this.once('doorsOpen', 20.2, () => { g.world.entrance.open(0.9); audio.playAt('entrance_open', V(L.bounds.x0, 1.2, 0), { bus: 'environment', volume: 0.8 }); });
    if (t >= 16.5 && cam.fov !== this.baseFov) { cam.fov = this.baseFov; cam.updateProjectionMatrix(); }
    if (t >= 16.5 && t < 24.5) {
      const u = (t - 16.5) / 8;
      const p = u < 0.62 ? this.walkFrom.clone().lerp(this.door, ease(u / 0.62)) : this.door.clone().lerp(this.inside, ease((u - 0.62) / 0.38));
      const bob = Math.sin(t * 9.5) * 0.03;
      cam.position.set(p.x, 1.62 + bob, p.z);
      cam.lookAt(p.x + 6, 1.55 + bob * 0.5, p.z * 0.6);
      this.stepAcc = (this.stepAcc || 0) + dt;
      if (this.stepAcc > 0.58) { this.stepAcc = 0; audio.play(p.x < L.bounds.x0 ? 'step_outside' : 'step_tile', { bus: 'player', volume: 0.5, rate: 0.95 + Math.random() * 0.1 }); }
      if (p.x > L.bounds.x0 + 0.5 && this.rainOut) { this.rainOut.setVolume(0.35, 1.5); this.rainOut.setLowpass?.(900); }
    }
    // --- Shot E (24.5-27): the doors close behind him
    this.once('doorsClose', 24.3, () => { g.world.entrance.close(1.6); });
    this.once('slam', 25.0, () => { audio.play('entrance_slam', { bus: 'environment', volume: 1, reverb: 0.6 }); g.player.shake(0.3, 0.3); });
    if (t >= 24.5) {
      cam.position.set(this.inside.x, 1.62, this.inside.z);
      // glance back at the doors then forward
      const back = this.glance.sample(t - 24.5);
      cam.rotation.set(0, -Math.PI / 2 + back, 0, 'YXZ');
    }
    if (t >= this.duration) this.finish();
  }

  finish() {
    if (this.done) return;
    this.done = true;
    const g = this.g, L = g.layout;
    this.engine?.stop(0.5);
    this.rainOut?.stop(2); this.wind?.stop(2);
    if (this.headlight) this.headlight.intensity = 0;
    if (g.camera.fov !== this.baseFov) { g.camera.fov = this.baseFov; g.camera.updateProjectionMatrix(); }
    // the car stays parked all night (gone in the morning)
    this.carAt(1);
    g.parkedCar = this.car;
    g.world.entrance.amount = 0; g.world.entrance.target = 0; g.world.entrance.locked = true;
    g.world.lightning.next = 12;
    g.ui.letterbox(false);
    const s = L.exterior.playerStart;
    g.player.teleport(s.x, s.y, s.z, s.yaw, 0);
    g.input.consumeMouse();   // discard mouse motion made during the cinematic
    g.player.canMove = true; g.player.canLook = true;
    if (this.onDone) this.onDone();
  }
}
