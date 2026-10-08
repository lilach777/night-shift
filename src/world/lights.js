// Hospital lighting: per-fixture power/flicker state, a small pool of real
// PointLights assigned to the nearest lit fixtures, emergency red lighting and
// lightning window flashes. Fixture diffusers are GPU-instanced; each instance's
// brightness is driven through instanceColor on an unlit material.
import * as THREE from 'three';
import { rand, clamp } from '../core/util.js';

const FLUOR = new THREE.Color(0xdfe9ff);

export class Lights {
  constructor(scene, layout, opts) {
    this.scene = scene;
    this.layout = layout;
    this.levelY = Object.fromEntries(layout.levels.map(l => [l.id, l.y]));
    this.power = { B: false, 1: true, 2: false, 3: false, 4: false };
    this.emergencyOn = false;
    this.surge = 0;            // global flicker multiplier (power events)
    this.time = 0;
    this.fixtures = layout.lights.map((l, i) => {
      const r = Math.random();
      let state = r < 0.72 ? 'ok' : r < 0.9 ? 'flicker' : 'dead';
      if (l.level === '4') state = r < 0.35 ? 'ok' : r < 0.6 ? 'flicker' : 'dead';
      if (l.room === 'lobby') state = i % 5 === 3 ? 'flicker' : 'ok';
      return { ...l, state, lit: 0, flick: 1, nextFlick: rand(0, 3), inst: null, forced: null };
    });
    this.poolSize = opts.poolSize ?? 6;
    this.pool = [];
    for (let i = 0; i < this.poolSize; i++) {
      const p = new THREE.PointLight(FLUOR, 0, 14, 2);
      p.userData.fix = null; p.userData.fade = 0;
      scene.add(p);
      this.pool.push(p);
    }
    this.hemi = new THREE.HemisphereLight(0x7f8ea3, 0x1a1512, 0.04);
    scene.add(this.hemi);
    // Lightning (window) lights
    this.flashLights = [0, 1].map(() => { const p = new THREE.PointLight(0xcfdcff, 0, 20, 1.6); scene.add(p); return p; });
    this.sky = new THREE.DirectionalLight(0xbfd0ff, 0);
    this.sky.position.set(-40, 50, 20);
    scene.add(this.sky);
    // Porch lamp over the main entrance (on the hospital's power circuit).
    this.porch = new THREE.PointLight(0xffc98a, 0, 16, 1.6);
    this.porch.position.set(layout.bounds.x0 - 2.2, 2.75, 0);
    scene.add(this.porch);
    this.flash = 0;
    this.instanced = [];
    this.emergMats = [];
    this.outside = 0;
  }

  // Map GPU-instanced fixture diffusers to layout fixtures.
  bindInstances(root) {
    root.updateMatrixWorld(true);
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    const basic = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: true });
    root.traverse(o => {
      if (!o.isInstancedMesh) return;
      const mat = o.material;
      if (!mat || mat.name !== 'M_light_panel') return;
      o.material = basic;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        p.setFromMatrixPosition(m).applyMatrix4(o.matrixWorld);
        let best = null, bd = 0.6;
        for (const f of this.fixtures) {
          const d = Math.abs(f.x - p.x) + Math.abs(f.z - p.z) + Math.abs(f.y - p.y) * 0.5;
          if (d < bd) { bd = d; best = f; }
        }
        if (best) best.inst = { mesh: o, index: i };
        o.setColorAt(i, new THREE.Color(0, 0, 0));
      }
      o.instanceColor.needsUpdate = true;
      this.instanced.push(o);
    });
  }

  bindEmergency(materials) { this.emergMats = materials; }

  setPower(level, on) {
    if (level === 'all') for (const k of Object.keys(this.power)) this.power[k] = on;
    else this.power[level] = on;
  }

  anyPower() { return Object.values(this.power).some(Boolean); }

  // Global flicker burst (power surge / blackout)
  surgeFlicker(seconds = 1.5) { this.surgeT = seconds; }

  setEmergency(on) {
    this.emergencyOn = on;
    for (const m of this.emergMats) { m.emissive?.setHex(0xff1a0a); m.emissiveIntensity = on ? 3 : 0; }
  }

  lightningFlash(strength = 1) { this.flash = Math.max(this.flash, strength); }

  update(dt, camPos, level, flashScale = 1) {
    this.time += dt;
    const t = this.time;
    if (this.surgeT > 0) this.surgeT -= dt;
    // Fixture brightness
    for (const f of this.fixtures) {
      let target = 0;
      if (this.power[f.level] && f.state !== 'dead') {
        target = 1;
        if (f.state === 'flicker') {
          f.nextFlick -= dt;
          if (f.nextFlick <= 0) {
            f.flick = Math.random() < 0.5 ? rand(0, 0.25) : 1;
            f.nextFlick = f.flick < 1 ? rand(0.03, 0.18) : rand(0.2, 4);
          }
          target = f.flick;
        }
      }
      if (f.forced != null) target = f.forced;
      if (this.surgeT > 0) target *= Math.random() < 0.45 ? 0 : 1;
      f.lit = target > f.lit ? Math.min(target, f.lit + dt * 30) : Math.max(target, f.lit - dt * 40);
      if (f.inst) {
        const v = f.lit;
        f.inst.mesh.setColorAt(f.inst.index, new THREE.Color(v * 1.4, v * 1.45, v * 1.5));
      }
    }
    for (const o of this.instanced) if (o.instanceColor) o.instanceColor.needsUpdate = true;

    // Assign pool lights to the nearest lit fixtures (every frame is cheap at this size)
    this._assignT = (this._assignT || 0) - dt;
    if (this.emergencyOn) {
      // Pool lights become red emergency lamps near the camera.
      const near = this.layout.emergencyLights.filter(e => Math.abs(this.levelY[e.level] + 1.6 - camPos.y) < 3);
      const es = near.map(e => [Math.hypot(e.x - camPos.x, e.z - camPos.z), e]).sort((a, b) => a[0] - b[0]);
      // optionally keep one lamp on a point of interest (e.g. the Koala at the end of the corridor)
      if (this.redFocus) {
        const f = this.redFocus;
        const best = near.map(e => [Math.hypot(e.x - f.x, e.z - f.z), e]).sort((a, b) => a[0] - b[0])[0];
        if (best && !es.slice(0, 2).some(x => x[1] === best[1])) es.splice(2, 0, [0, best[1]]);
      }
      this.pool.forEach((p, i) => {
        const e = i < 3 ? es[i]?.[1] : null;
        p.userData.fix = null;
        p.color.setHex(0xff1a0a);
        if (e) p.position.set(e.x, e.y - 0.2, e.z + (Math.abs(e.face) < 0.1 ? 0.35 : -0.35));
        p.intensity = e ? 16 * (0.75 + 0.25 * Math.sin(t * 3.2 + i)) : 0;
      });
      this.hemi.intensity = 0.03; this.hemi.color.setHex(0x553030);
      this.flash = Math.max(0, this.flash - dt * 4.5);
      this.flashLights.forEach(p => { p.intensity = 0; });
      this.sky.intensity = 0;
      return;
    } else if (this.pool[0].color.getHex() !== FLUOR.getHex()) this.pool.forEach(p => p.color.copy(FLUOR));
    if (this._assignT <= 0) {
      this._assignT = 0.2;
      const cands = [];
      for (const f of this.fixtures) {
        if (f.lit < 0.02 && (f.state === 'dead' || !this.power[f.level]) && f.forced == null) continue;
        const dy = Math.abs(f.y - camPos.y);
        if (dy > 4.5) continue;
        const d = Math.hypot(f.x - camPos.x, f.z - camPos.z) + dy * 2;
        if (d < 20) cands.push([d, f]);
      }
      cands.sort((a, b) => a[0] - b[0]);
      const chosen = cands.slice(0, this.poolSize).map(c => c[1]);
      // keep existing assignments when still chosen
      const free = [];
      for (const p of this.pool) {
        if (p.userData.fix && chosen.includes(p.userData.fix)) chosen.splice(chosen.indexOf(p.userData.fix), 1);
        else free.push(p);
      }
      for (const p of free) {
        const f = chosen.shift() || null;
        p.userData.fix = f; p.userData.fade = 0;
        if (f) p.position.set(f.x, f.y - 0.25, f.z);
      }
    }
    let litNear = 0;
    for (const p of this.pool) {
      const f = p.userData.fix;
      p.userData.fade = Math.min(1, p.userData.fade + dt * 4);
      const v = f ? f.lit * p.userData.fade : 0;
      p.intensity = v * 32;
      if (f && f.lit > 0.5) litNear += 1;
    }
    // Fake bounce / ambient: brighter when nearby fixtures are lit
    const amb = clamp(litNear / 3, 0, 1);
    this._amb = (this._amb ?? 0) + (amb - (this._amb ?? 0)) * Math.min(1, dt * 3);
    this.flash = Math.max(0, this.flash - dt * 4.5);
    const fl = this.flash * flashScale;
    // very dim cool "moon" ambience so silhouettes of doors/furniture/floor stay readable
    const moon = level === 'B' ? 1.25 : 0.1;   // basement: no windows (dark concrete), but never fully black
    this.hemi.intensity = moon + this._amb * 0.55 + fl * 0.35 * (level === 'B' ? 0 : 1);
    this.hemi.color.setHex(this.emergencyOn ? 0x553030 : 0x7f8ea3);
    if (this.daylight) { this.hemi.intensity = this.daylight; this.hemi.color.setHex(0xc9d1d8); this.hemi.groundColor.setHex(0x4a4640); }
    // Lightning through the nearest windows on this level
    if (level !== 'B') {
      if (!this._wins || this._winLevel !== level || (this._winT = (this._winT || 0) - dt) <= 0) {
        this._winLevel = level; this._winT = 0.5;
        const ws = this.layout.windows.filter(w => w.level === level)
          .map(w => {
            const wx = w.axis === 'x' ? w.at : w.c + (w.c > 0 ? -1.2 : 1.2);
            const wz = w.axis === 'x' ? w.c + (w.c > 0 ? -1.2 : 1.2) : w.at;
            return { x: wx, y: (w.y0 + w.y1) / 2, z: wz, d: Math.hypot(wx - camPos.x, wz - camPos.z) };
          })
          .sort((a, b) => a.d - b.d);
        this._wins = ws.slice(0, 2);
      }
      this.flashLights.forEach((p, i) => {
        const w = this._wins[i];
        if (w) p.position.set(w.x, w.y, w.z);
        // faint cool moonlight always spills in through the nearest windows; lightning adds on top
        p.intensity = w ? fl * 260 + (this.daylight ? 0 : 5.5) : 0;
      });
    } else this.flashLights.forEach(p => { p.intensity = 0; });
    if (!this.daylight) {
      // moonlight + lightning outside; nothing direct indoors
      this.sky.intensity = (1.55 + fl * 4.2) * this.outside;      // brighter moon/cloud light; still night
      this.hemi.intensity += (0.38 + fl * 0.4) * this.outside;
    }
    const porchOn = this.power['1'] && !this.daylight;
    const pf = porchOn ? (Math.random() < 0.015 ? 0.3 : 1) : 0;
    this.porch.intensity += (pf * 22 - this.porch.intensity) * Math.min(1, dt * 20);
  }
}
