// Heavy rain (GPU line streaks wrapped around the camera, culled inside the
// building), rain-on-glass normal map, and the lightning/thunder scheduler.
import * as THREE from 'three';
import { audio } from '../audio/audio.js';
import { rand } from '../core/util.js';

export class Rain {
  constructor(scene, bounds, count = 9000) {
    const box = new THREE.Vector3(70, 30, 70);
    const pos = new Float32Array(count * 2 * 3);
    const end = new Float32Array(count * 2);
    const spd = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = Math.random() * box.x, y = Math.random() * box.y, z = Math.random() * box.z, s = 0.8 + Math.random() * 0.4;
      for (let k = 0; k < 2; k++) {
        pos.set([x, y, z], (i * 2 + k) * 3);
        end[i * 2 + k] = k;
        spd[i * 2 + k] = s;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    g.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1));
    this.uniforms = {
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: box },
      uWind: { value: new THREE.Vector2(-2.5, 1.0) }, uFlash: { value: 0 },
      uB: { value: new THREE.Vector4(bounds.x0 - 0.3, bounds.x1 + 0.3, bounds.z0 - 0.3, bounds.z1 + 0.3) },
      uOpacity: { value: 0.32 },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        attribute float aEnd; attribute float aSpeed;
        uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec2 uWind;
        varying float vA; varying vec3 vW;
        void main(){
          vec3 vel = vec3(uWind.x, -16.0 * aSpeed, uWind.y);
          vec3 p = position + vel * uTime;
          vec3 base = uCam - uBox * 0.5;
          p = mod(p - base, uBox) + base;
          p.y = max(p.y, -0.1);
          p += vel * 0.045 * aEnd;
          vW = p;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vA = aEnd;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec4 uB; uniform float uFlash; uniform float uOpacity; uniform vec3 uCam;
        varying float vA; varying vec3 vW;
        void main(){
          if (vW.x > uB.x && vW.x < uB.y && vW.z > uB.z && vW.z < uB.w && vW.y < 16.4) discard;
          float d = distance(vW, uCam);
          float fade = smoothstep(34.0, 6.0, d) * smoothstep(0.4, 1.5, d);
          float a = uOpacity * fade * mix(0.25, 1.0, vA);
          gl_FragColor = vec4(vec3(0.62, 0.68, 0.75) * (1.0 + uFlash * 4.0), a);
        }`,
    });
    this.mesh = new THREE.LineSegments(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }
  update(dt, cam, flash) {
    this.uniforms.uTime.value += dt;
    if (this.uniforms.uTime.value > 1000) this.uniforms.uTime.value = 0;
    this.uniforms.uCam.value.copy(cam);
    this.uniforms.uFlash.value = flash;
  }
}

// Procedural rain-on-glass normal map (droplets + trickles), scrolled over time.
export function makeRainGlassNormal() {
  const S = 256;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, S, S);
  const drop = (x, y, r) => {
    const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    grd.addColorStop(0, 'rgb(90,90,255)'); grd.addColorStop(0.6, 'rgb(150,160,255)'); grd.addColorStop(1, 'rgba(128,128,255,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  for (let i = 0; i < 260; i++) drop(Math.random() * S, Math.random() * S, 1 + Math.random() * 3.5);
  for (let i = 0; i < 26; i++) {
    let x = Math.random() * S, y = Math.random() * S; const len = 30 + Math.random() * 120;
    for (let k = 0; k < len; k += 2) { drop(x, (y + k) % S, 1.6); x += (Math.random() - 0.5) * 1.2; }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.4, 1.4);
  return t;
}

export class Lightning {
  constructor() {
    this.next = rand(6, 14);
    this.seq = [];
    this.listeners = new Set();
    this.level = 0;
    this.enabled = true;
  }
  onFlash(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  strike(strength = 1, near = false) {
    const t = 0;
    this.seq = [[t, strength], [t + 0.09, 0.15], [t + 0.16, strength * 0.8], [t + 0.33, strength * 0.45]];
    if (Math.random() < 0.4) this.seq.push([t + 0.6, strength * 0.6]);
    this.seqT = 0;
    for (const fn of this.listeners) fn(strength);
    const delay = near ? rand(0.05, 0.35) : rand(0.6, 2.8);
    const vol = near ? 1 : rand(0.45, 0.85);
    audio.play(near ? 'thunder_near' : 'thunder', { bus: 'environment', volume: vol, delay, reverb: 0.2 });
  }
  update(dt, indoorsBasement) {
    if (!this.enabled) return 0;
    this.next -= dt;
    if (this.next <= 0) {
      this.next = rand(14, 42);
      this.strike(rand(0.6, 1), Math.random() < 0.15);
    }
    let v = 0;
    if (this.seq.length) {
      this.seqT += dt;
      for (const [t, s] of this.seq) {
        const d = this.seqT - t;
        if (d >= 0 && d < 0.12) v = Math.max(v, s * (1 - d / 0.12));
      }
      if (this.seqT > 1.2) this.seq = [];
    }
    this.level = indoorsBasement ? 0 : v;
    return this.level;
  }
}
