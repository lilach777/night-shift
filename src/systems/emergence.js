// The Koala clawing its way up through the morgue floor: a crack spreads across the tiles,
// the floor breaks open, dust and concrete chunks are thrown up, claws come first, then the
// arms plant on the floor, the head and shoulders, and finally the whole body.
// Pure visuals + the creature's root height; the story drives timing and audio.
import * as THREE from 'three';
import { rand } from '../core/util.js';

function crackTexture() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2, cy = S / 2;
  // dark broken hole in the middle (irregular)
  g.fillStyle = 'rgba(0,0,0,1)';
  g.beginPath();
  for (let i = 0; i <= 22; i++) {
    const a = (i / 22) * Math.PI * 2, r = S * (0.14 + Math.random() * 0.06);
    i ? g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.fill();
  // radial fractures with branches
  g.strokeStyle = 'rgba(8,6,5,0.95)'; g.lineCap = 'round';
  const branch = (x, y, a, len, w, depth) => {
    let px = x, py = y;
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      a += (Math.random() - 0.5) * 0.7;
      const nx = px + Math.cos(a) * len / steps, ny = py + Math.sin(a) * len / steps;
      g.lineWidth = w * (1 - i / steps) + 0.6;
      g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
      px = nx; py = ny;
      if (depth > 0 && Math.random() < 0.25) branch(px, py, a + (Math.random() < 0.5 ? 0.7 : -0.7), len * 0.45, w * 0.55, depth - 1);
    }
  };
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + Math.random() * 0.4;
    branch(cx + Math.cos(a) * S * 0.15, cy + Math.sin(a) * S * 0.15, a, S * rand(0.22, 0.34), 7, 2);
  }
  // scuffed rubble ring
  for (let i = 0; i < 260; i++) {
    const a = Math.random() * Math.PI * 2, r = S * (0.15 + Math.random() * 0.12);
    g.fillStyle = `rgba(${40 + Math.random() * 40},${36 + Math.random() * 30},${30 + Math.random() * 25},${0.5 + Math.random() * 0.5})`;
    g.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2 + Math.random() * 5, 2 + Math.random() * 5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function dustSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Emergence {
  constructor(scene, pos, floorMat) {
    this.scene = scene;
    this.pos = pos.clone();
    this.t = 0;
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    scene.add(this.group);
    // crack decal: grows from a point to ~2.6 m
    this.crack = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshStandardMaterial({
      map: crackTexture(), transparent: true, roughness: 0.95, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, opacity: 0,
    }));
    this.crack.rotation.x = -Math.PI / 2;
    this.crack.position.y = 0.006;
    this.crack.scale.setScalar(0.05);
    this.group.add(this.crack);
    this.crackGrow = 0; this.crackTarget = 0;
    // dust
    const N = 260;
    this.dust = { n: N, p: new Float32Array(N * 3), v: new Float32Array(N * 3), life: new Float32Array(N), next: 0 };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.dust.p, 3));
    this.dustPts = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.32, map: dustSprite(), color: 0x6d655c, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true,
    }));
    this.dustPts.frustumCulled = false;
    for (let i = 0; i < N; i++) this.dust.p[i * 3 + 1] = -50;
    this.group.add(this.dustPts);
    // concrete / tile chunks
    this.chunks = [];
    this.chunkMat = new THREE.MeshStandardMaterial({ color: 0x4a4741, roughness: 0.97, flatShading: true });
    this.tileMat = floorMat || new THREE.MeshStandardMaterial({ color: 0x5d5a55, roughness: 0.7, flatShading: true });
    this.chunkGeo = [new THREE.DodecahedronGeometry(1, 0), new THREE.IcosahedronGeometry(1, 0), new THREE.TetrahedronGeometry(1, 0)];
  }

  // radius of the open hole (m) — used to spawn effects at the rim
  setCrack(target) { this.crackTarget = target; }

  puff(n, strength = 1, radius = 0.6) {
    const D = this.dust;
    for (let k = 0; k < n; k++) {
      const i = D.next; D.next = (D.next + 1) % D.n;
      const a = Math.random() * Math.PI * 2, r = Math.random() * radius;
      D.p[i * 3] = Math.cos(a) * r; D.p[i * 3 + 1] = 0.05; D.p[i * 3 + 2] = Math.sin(a) * r;
      D.v[i * 3] = Math.cos(a) * rand(0.1, 0.6) * strength; D.v[i * 3 + 1] = rand(0.4, 1.6) * strength; D.v[i * 3 + 2] = Math.sin(a) * rand(0.1, 0.6) * strength;
      D.life[i] = rand(1.6, 3.2);
    }
  }

  burst(n, strength = 1) {
    for (let k = 0; k < n; k++) {
      const s = rand(0.018, 0.06);
      const m = new THREE.Mesh(this.chunkGeo[k % 3], Math.random() < 0.35 ? this.tileMat : this.chunkMat);
      m.scale.set(s * rand(0.7, 1.4), s * rand(0.35, 0.8), s * rand(0.7, 1.3));
      const a = Math.random() * Math.PI * 2, r = rand(0.1, 0.5);
      m.position.set(Math.cos(a) * r, 0.02, Math.sin(a) * r);
      m.castShadow = true;
      this.group.add(m);
      this.chunks.push({ m, v: new THREE.Vector3(Math.cos(a) * rand(0.4, 2.2), rand(1.4, 4.2), Math.sin(a) * rand(0.4, 2.2)).multiplyScalar(strength), w: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)), rest: false });
    }
    this.puff(Math.round(n * 3), strength * 1.2, 0.5);
  }

  // the dead ceiling lamp above sputters with the quake (a lighting fixture, forced on/off)
  setLamp(fixture, level) { this.lamp = fixture; this.lampLevel = level; this.lampT = 0; }
  releaseLamp() { if (this.lamp) this.lamp.forced = null; this.lamp = null; }

  update(dt) {
    this.t += dt;
    if (this.lamp) {
      this.lampT -= dt;
      if (this.lampT <= 0) {
        const on = Math.random() < 0.55 + this.lampLevel * 0.4;
        this.lamp.forced = on ? this.lampLevel * rand(0.6, 1.1) : rand(0, 0.04);
        this.lampT = on ? rand(0.08, 0.6) : rand(0.04, 0.25);
      }
    }
    // crack spreading
    this.crackGrow += (this.crackTarget - this.crackGrow) * Math.min(1, dt * 2.2);
    const s = Math.max(0.05, this.crackGrow);
    this.crack.scale.set(s, s, s);
    this.crack.material.opacity = Math.min(1, this.crackGrow * 3);
    // dust
    const D = this.dust;
    for (let i = 0; i < D.n; i++) {
      if (D.life[i] <= 0) continue;
      D.life[i] -= dt;
      D.v[i * 3 + 1] -= 0.25 * dt;
      D.v[i * 3] *= 1 - dt * 0.8; D.v[i * 3 + 2] *= 1 - dt * 0.8; D.v[i * 3 + 1] *= 1 - dt * 0.9;
      D.p[i * 3] += D.v[i * 3] * dt; D.p[i * 3 + 1] += D.v[i * 3 + 1] * dt; D.p[i * 3 + 2] += D.v[i * 3 + 2] * dt;
      if (D.life[i] <= 0) D.p[i * 3 + 1] = -50;
    }
    this.dustPts.geometry.attributes.position.needsUpdate = true;
    // chunks with gravity and a couple of bounces on the floor
    for (const c of this.chunks) {
      if (c.rest) continue;
      c.v.y -= 9.8 * dt;
      c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += c.w.x * dt; c.m.rotation.y += c.w.y * dt; c.m.rotation.z += c.w.z * dt;
      const inHole = Math.hypot(c.m.position.x, c.m.position.z) < 0.35 * this.crackGrow / 1.0;
      if (c.m.position.y < 0.02 && c.v.y < 0 && !inHole) {
        c.m.position.y = 0.02;
        if (Math.abs(c.v.y) < 0.8) { c.rest = true; c.m.rotation.x = 0; c.m.rotation.z = 0; }
        c.v.y *= -0.3; c.v.x *= 0.5; c.v.z *= 0.5; c.w.multiplyScalar(0.5);
      }
      if (c.m.position.y < -1.5) { c.rest = true; c.m.visible = false; }
    }
  }
}
