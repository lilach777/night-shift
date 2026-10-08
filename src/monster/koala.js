// The Bloody Koala: model, animation mixer, procedural head tracking, sounds.
import * as THREE from 'three';
import { audio } from '../audio/audio.js';
import { rand, wrapAngle, damp } from '../core/util.js';
import { ShellFur } from './fur.js';
import { settings } from '../core/settings.js';

const LOOPING = new Set(['idle', 'breathe', 'walk', 'crawl', 'run', 'chase', 'observe', 'charge', 'snarl', 'stalk']);
// ground speed (m/s) each gait cycle was authored for: playback follows real speed (no foot sliding)
const GAIT = { walk: 1.15, crawl: 2.9, run: 3.6, chase: 4.4, charge: 4.6, stalk: 0.7 };

export class Koala {
  constructor(gltf, scene) {
    this.root = new THREE.Group();
    this.root.name = 'KOALA';
    this.model = gltf.scene;
    this.root.add(this.model);
    scene.add(this.root);
    let furMesh = null;
    this.model.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        const m = o.material;
        if (m.name === 'M_koala_eye') { m.roughness = 0.03; m.metalness = 0.0; m.emissive = new THREE.Color(1.0, 0.5, 0.12); m.emissiveIntensity = 0; this.eyeMat = m; }
        if (m.name === 'M_koala_fur') {
          // the skin under the coat (coat colour, darker); the visible fur is the shell layer below
          o.material = new THREE.MeshPhysicalMaterial({
            name: 'M_koala_fur', color: new THREE.Color(0.32, 0.31, 0.31), vertexColors: true, roughness: 1.0, metalness: 0,
            specularIntensity: 0.05, sheen: 0.6, sheenRoughness: 0.9, sheenColor: new THREE.Color(0x15110f),
          });
          if (o.isSkinnedMesh) furMesh = o;
        }
        if (m.name === 'M_koala_skin') { m.roughness = 0.24; m.vertexColors = false; }        // leathery nose / lips
        if (m.name === 'M_koala_gum') { m.roughness = 0.12; m.vertexColors = false; }         // wet gums
        if (m.name === 'M_koala_teeth') { m.roughness = 0.38; m.vertexColors = false; }
        if (m.name === 'M_koala_claw') { m.roughness = 0.3; m.vertexColors = false; }
      }
      if (o.isBone && o.name === 'head') this.head = o;
      if (o.isBone && o.name === 'neck') this.neck = o;
      if (o.isBone && o.name === 'jaw') this.jaw = o;
      if (o.isBone && o.name === 'chest') this.chest = o;
    });
    // real-time shell fur over the coat (fewer shells on low quality)
    if (furMesh) {
      const q = settings.data?.graphics?.quality;
      this.fur = new ShellFur(furMesh, { shells: q === 'low' ? 8 : q === 'medium' ? 12 : 18, length: 0.07, density: 190 });
    }
    this.prevPos = new THREE.Vector3();
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const clip of gltf.animations) {
      const name = clip.name.replace(/^koala_/, '');
      const a = this.mixer.clipAction(clip);
      if (!LOOPING.has(name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[name] = a;
    }
    this.current = null;
    this.root.visible = false;
    this.lookTarget = null;      // Vector3 to track with the head
    this.lookAmount = 0;
    this.headRoll = 0;
    this.breath = null;
    this.speed = 0;
    this.time = 0;
    this.stepAcc = 0;
    this.headQ = new THREE.Quaternion();
  }

  get position() { return this.root.position; }
  get visible() { return this.root.visible; }
  get headPos() { const p = new THREE.Vector3(); (this.head || this.root).getWorldPosition(p); return p; }

  show(pos, yaw = 0, anim = 'idle') {
    this.root.position.copy(pos);
    this.root.rotation.y = yaw; this.root.rotation.z = 0; this.yawVel = 0;
    this.root.visible = true;
    this.play(anim, { fade: 0 });
    this.mixer.update(0.01);
    if (!this.breath) this.breath = audio.playAt('koala_breath', this.headPos, { bus: 'monster', loop: true, volume: 0.0, hrtf: true, occlude: true, refDistance: 1.5, rolloff: 1.6 });
  }

  hide() {
    this.root.visible = false;
    this.lookTarget = null;
    if (this.breath) { this.breath.stop(0.3); this.breath = null; }
    if (this.current) { this.current.stop(); this.current = null; }
    this.speed = 0;
  }

  play(name, { fade = 0.25, timeScale, vary = true } = {}) {
    const a = this.actions[name];
    if (!a) { console.warn('[koala] missing anim', name); return null; }
    if (this.current === a && a.isRunning()) return a;
    a.reset();
    a.enabled = true;
    a.setEffectiveWeight(1);
    // subtle random variation in pacing so it never feels canned
    a.setEffectiveTimeScale(timeScale ?? (vary ? rand(0.88, 1.12) : 1));
    if (this.current && fade > 0) a.crossFadeFrom(this.current, fade, false);
    else if (this.current) this.current.stop();
    a.play();
    this.current = a; this.currentName = name;
    return a;
  }

  playOnce(name, fade = 0.15) {
    const a = this.play(name, { fade });
    if (!a) return Promise.resolve();
    return new Promise(res => {
      const cb = e => { if (e.action === a) { this.mixer.removeEventListener('finished', cb); res(); } };
      this.mixer.addEventListener('finished', cb);
      setTimeout(res, (a.getClip().duration / Math.max(0.1, a.getEffectiveTimeScale())) * 1000 + 400);
    });
  }

  faceTowards(p, dt, rate = 6) {
    const yaw = Math.atan2(p.x - this.root.position.x, p.z - this.root.position.z);
    if (dt == null) { this.root.rotation.y = yaw; this.yawVel = 0; return; }
    // turn with angular momentum: rate-limited, eased in and out (no snapping on path corners)
    const err = wrapAngle(yaw - this.root.rotation.y);
    const maxTurn = 2.2 + rate * 0.45;                       // rad/s
    const wantVel = Math.max(-maxTurn, Math.min(maxTurn, err * rate));
    this.yawVel = (this.yawVel || 0) + (wantVel - (this.yawVel || 0)) * Math.min(1, dt * 12);
    this.root.rotation.y += Math.abs(this.yawVel * dt) > Math.abs(err) ? err : this.yawVel * dt;
    this._turned = true;
  }

  vocal(id, volume = 1, opts = {}) {
    return audio.playAt(id, this.headPos, { bus: 'monster', volume, hrtf: true, occlude: true, refDistance: 2.5, reverb: 0.35, ...opts });
  }

  update(dt, listenerPos, lit) {
    if (!this.root.visible) return;
    this.time += dt;
    // gait playback rate follows the actual ground speed (smoothed): no skating feet,
    // and it visibly accelerates / decelerates with its body
    const nominal = GAIT[this.currentName];
    if (nominal && this.current && this.speed != null) {
      const want = this.speed > 0.05 ? Math.min(1.7, Math.max(0.5, this.speed / nominal)) : 0.35;
      const ts = this.current.getEffectiveTimeScale();
      this.current.setEffectiveTimeScale(ts + (want - ts) * Math.min(1, dt * 5));
    }
    // lean into turns at speed (body mass), settle upright when it stops turning
    if (!this._turned) this.yawVel = (this.yawVel || 0) * Math.max(0, 1 - dt * 8);
    this._turned = false;
    const bank = Math.max(-0.13, Math.min(0.13, -(this.yawVel || 0) * (this.speed || 0) * 0.03));
    this.root.rotation.z += (bank - this.root.rotation.z) * Math.min(1, dt * 6);
    this.mixer.update(dt);
    // breathing layered over every clip: slow and deep when it has been still, fast and shallow after
    // running (exertion decays over ~8 s) - the ribcage never stops moving
    this.exert = damp(this.exert || 0, Math.min(1, (this.speed || 0) / 4.4), (this.speed || 0) > 2 ? 0.8 : 0.12, dt);
    this.breathPh = (this.breathPh || 0) + dt * (1.1 + this.exert * 2.6) * Math.PI * 2;
    if (this.chest) this.chest.rotation.x += Math.sin(this.breathPh) * (0.035 + this.exert * 0.03);
    // Procedural head tracking layered over the animation (unnatural, slightly too far).
    if (this.head) {
      this.lookAmount = damp(this.lookAmount, this.lookTarget ? 1 : 0, 4, dt);
      if (this.lookAmount > 0.01 && this.lookTarget) {
        const hp = this.headPos;
        const to = new THREE.Vector3().subVectors(this.lookTarget, hp);
        const yawWorld = Math.atan2(to.x, to.z);
        let rel = wrapAngle(yawWorld - this.root.rotation.y);
        rel = Math.max(-1.9, Math.min(1.9, rel));   // owls could only dream
        const pitch = -Math.atan2(to.y, Math.hypot(to.x, to.z));
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * 0.6 * this.lookAmount, 0, 0));
        const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rel * this.lookAmount * 0.85);
        const qr = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.headRoll * this.lookAmount);
        // apply in head's parent space approximately (bone local Y is up the head)
        this.head.quaternion.premultiply(qy).multiply(q).multiply(qr);
      }
    }
    // eye-shine: like a night animal, the eyes throw the flashlight back (amber tapetum)
    if (this.eyeMat) {
      this._shine = damp(this._shine || 0, lit ? 2.4 : 0.04, lit ? 14 : 4, dt);
      this.eyeMat.emissiveIntensity = this._shine;
    }
    // fur: tips trail behind fast movement
    if (this.fur) {
      const vel = this.root.position.clone().sub(this.prevPos).divideScalar(Math.max(dt, 1e-3));
      this.prevPos.copy(this.root.position);
      this.fur.update(dt, vel.clampLength(0, 8), this.root.quaternion);
    }
    if (this.breath) {
      this.breath.setPosition(this.headPos);
      const d = listenerPos ? listenerPos.distanceTo(this.root.position) : 10;
      this.breath.setVolume(Math.min(1, 6 / Math.max(1, d)) * 0.8, 0.3);
    }
    // footsteps / claw scrapes while moving
    if (this.speed > 0.4) {
      this.stepAcc += this.speed * dt;
      const stride = this.speed > 3 ? 1.1 : 0.8;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        audio.playAt('koala_step', this.root.position, { bus: 'monster', volume: Math.min(1, 0.4 + this.speed * 0.12), hrtf: true, occlude: true, refDistance: 2, rate: rand(0.85, 1.1) });
        if (Math.random() < 0.18) audio.playAt('koala_scratch', this.root.position, { bus: 'monster', volume: 0.5, hrtf: true, occlude: true });
      }
    }
  }
}
