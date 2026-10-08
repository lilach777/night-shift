import * as THREE from 'three';
import { audio } from '../audio/audio.js';
import { damp, rand, clamp } from '../core/util.js';
import { settings } from '../core/settings.js';

// Light cookie modelled on a real incandescent reflector torch (like the Poly Haven plastic torch):
//  - a hot core with a fairly sharp edge (the reflector's focused image of the filament)
//  - the dark "donut" a slightly defocused bulb leaves in the middle of the hot spot
//  - concentric reflector rings / facet banding in the corona
//  - a much dimmer, wide spill halo with a hard outer cut-off (the bezel)
//  - lens dirt, a scratch, faint asymmetry (no two torches are perfectly aligned)
function makeCookie() {
  const S = 512, C = S / 2;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S), d = img.data;
  const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const ox = 0.025, oy = -0.018;                                       // slight mis-centred bulb
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x - C) / C, v = (y - C) / C;
    const r = Math.hypot(u, v), rh = Math.hypot(u - ox, v - oy);
    const ang = Math.atan2(v, u);
    const core = 1 / (1 + Math.exp((rh - 0.2) / 0.018));                // hot spot, sharp-ish edge
    const donut = 1 - 0.32 * Math.exp(-((((rh - 0.0) / 0.055)) ** 2));     // bulb shadow in the centre
    const rings = 0.85 + 0.15 * Math.cos(rh * 95) * Math.exp(-((((rh - 0.33) / 0.12)) ** 2));
    const facets = 1 + 0.05 * Math.cos(ang * 18) * Math.exp(-((((rh - 0.3) / 0.1)) ** 2));
    const corona = 0.42 * Math.exp(-((((rh - 0.22) / 0.13)) ** 2));
    const spill = 0.2 * (1 / (1 + Math.exp((r - 0.9) / 0.025)));       // wide dim halo, bezel cut-off
    let I = (core * donut + corona) * rings * facets + spill;
    I *= 1 - 0.06 * Math.max(0, Math.sin(ang * 3 + 1.2)) * Math.min(1, r * 3);
    const i = (y * S + x) * 4;
    // incandescent: the core is whiter, the corona/spill warmer
    d[i] = Math.min(255, 255 * I); d[i + 1] = Math.min(255, 255 * I * (0.93 - 0.06 * (1 - core)));
    d[i + 2] = Math.min(255, 255 * I * (0.8 - 0.12 * (1 - core))); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // lens dirt and a scratch
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(0,0,0,${0.025 + rnd() * 0.06})`;
    g.beginPath(); g.arc(C + (rnd() - 0.5) * S * 0.7, C + (rnd() - 0.5) * S * 0.7, 3 + rnd() * 22, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(C - 120, C - 40); g.quadraticCurveTo(C - 20, C + 10, C + 90, C + 70); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The beam in the air: an open cone with an additive shader - brightest near the lens, fading
// with distance and toward the edge, with slow-drifting dust motes. Very faint (it should read
// as haze in a dusty, humid building, not a lightsaber).
function makeBeam(angle, length) {
  const r1 = Math.tan(angle) * length;
  const geo = new THREE.CylinderGeometry(0.025, r1, length, 40, 24, true);
  geo.translate(0, -length / 2, 0); geo.rotateX(Math.PI / 2);          // apex at the lens, opening toward -Z
  const mat = new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 }, uTime: { value: 0 }, uLen: { value: length }, uColor: { value: new THREE.Color(1.0, 0.86, 0.68) } },
    vertexShader: /* glsl */`
      varying vec3 vW; varying vec3 vN; varying float vZ;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal); vZ = -position.z;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uI; uniform float uTime; uniform float uLen; uniform vec3 uColor;
      varying vec3 vW; varying vec3 vN; varying float vZ;
      float h(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float n3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        float edge = pow(abs(dot(normalize(vN), V)), 1.6);              // thicker-looking in the middle
        float t = clamp(vZ / uLen, 0.0, 1.0);
        float along = smoothstep(0.0, 0.06, t) * pow(1.0 - t, 1.8);     // fade in from the lens, out with distance
        float dust = 0.55 + 0.45 * n3(vW * 2.2 + vec3(0.0, uTime * 0.05, uTime * 0.02));
        float motes = smoothstep(0.82, 0.96, n3(vW * 14.0 + vec3(uTime * 0.12, uTime * -0.06, 0.0))) * 1.8;
        float a = uI * edge * along * (dust + motes);
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false; m.renderOrder = 5;
  return m;
}

export class Flashlight {
  constructor(camera, scene, model, quality) {
    this.camera = camera;
    this.has = false; this.on = false;
    this.battery = 100; this.spares = 0;
    this.drainPerSec = 100 / 330;
    this.flickerT = 0; this.flickerAmt = 0;
    this.holder = new THREE.Object3D();
    camera.add(this.holder);
    this.rest = new THREE.Vector3(0.23, -0.25, -0.46);
    this.holder.position.copy(this.rest);
    this.model = model;
    model.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    model.scale.setScalar(1.15);
    this.holder.add(model);
    this.lens = null;
    model.traverse(o => { if (o.isMesh && o.material?.name === 'M_flash_lens') { o.material = o.material.clone(); this.lens = o.material; } });

    // warm incandescent bulb (~3200 K); the cookie shapes hot spot, corona and spill, so the cone edge is the bezel
    const spot = new THREE.SpotLight(0xffe2bc, 0, 28, 0.5, 0.18, 1.25);
    spot.position.set(0, 0, -0.2);
    spot.castShadow = !!quality.shadows;
    if (spot.castShadow) {
      spot.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
      spot.shadow.bias = -0.0006;
      spot.shadow.normalBias = 0.02;
      spot.shadow.camera.near = 0.15; spot.shadow.camera.far = 26;
      spot.map = makeCookie();
    }
    this.holder.add(spot);
    this.target = new THREE.Object3D(); this.target.position.set(0, -0.02, -6);
    this.holder.add(this.target);
    spot.target = this.target;
    this.spot = spot;
    // soft bounce fill so walls right in front feel lit
    this.fill = new THREE.PointLight(0xffe8cc, 0, 5, 2);
    this.fill.position.set(0, 0, -0.6);
    this.holder.add(this.fill);
    // visible beam in the air (haze + dust motes)
    this.beam = makeBeam(0.42, 7.5);
    this.beam.position.set(0, 0, -0.17);
    this.holder.add(this.beam);
    this.lag = new THREE.Vector2();
    this.prevYaw = 0; this.prevPitch = 0;
    this.visible = false;
    this.model.visible = false;
    this.time = 0;
    this.extraIntensity = 1;
  }

  give() { this.has = true; this.model.visible = true; this.visible = true; }

  toggle(force) {
    if (!this.has) return;
    const next = force ?? !this.on;
    if (next === this.on) return;
    this.on = next;
    audio.play('flashlight_click', { bus: 'player', volume: 0.7 });
  }

  addSpare(n = 1) { this.spares += n; }

  replaceBattery() {
    if (!this.has || this.spares <= 0 || this.battery > 95) return false;
    this.spares -= 1; this.battery = 100;
    audio.play('battery_swap', { bus: 'player', volume: 0.8 });
    this.flicker(0.4, 0.8);
    return true;
  }

  flicker(seconds = 0.8, amount = 1) { this.flickerT = Math.max(this.flickerT, seconds); this.flickerAmt = Math.max(this.flickerAmt, amount); }

  update(dt, player) {
    this.time += dt;
    // sway: lag behind camera rotation + bob
    const dyaw = player.yaw - this.prevYaw, dp = player.pitch - this.prevPitch;
    this.prevYaw = player.yaw; this.prevPitch = player.pitch;
    const sway = settings.data.accessibility.cameraShake ? 1 : 0.3;
    this.lag.x = damp(this.lag.x, clamp(-dyaw * 4, -0.12, 0.12) * sway, 8, dt);
    this.lag.y = damp(this.lag.y, clamp(-dp * 4, -0.1, 0.1) * sway, 8, dt);
    const bob = player.bobAmt * sway;
    const bx = Math.cos(player.bobPhase) * 0.012 * bob, by = Math.abs(Math.sin(player.bobPhase)) * 0.014 * bob;
    const breathe = Math.sin(this.time * 1.3) * 0.004;
    this.holder.position.set(this.rest.x + bx - this.lag.x * 0.25, this.rest.y + by + breathe + this.lag.y * 0.2, this.rest.z);
    this.holder.rotation.set(this.lag.y * 0.6 + breathe * 0.5, this.lag.x * 0.8, 0);
    this.holder.visible = this.has && !this.suppressed;     // suppressed: the view is a security camera

    // battery
    if (this.on) this.battery = Math.max(0, this.battery - this.drainPerSec * dt);
    if (this.on && this.battery <= 0 && this.spares > 0) this.replaceBattery();
    let f = 1;
    const b = this.battery;
    if (b < 20) {
      f = b <= 0 ? 0.09 : 0.35 + 0.65 * (b / 20);
      if (Math.random() < dt * (b <= 0 ? 6 : 1.2)) this.flicker(rand(0.08, 0.35), 0.8);
    }
    if (this.flickerT > 0) {
      this.flickerT -= dt;
      const ff = Math.random() < 0.5 ? rand(0, 0.3) : 1;
      f *= 1 - this.flickerAmt * (1 - ff);
      if (this.flickerT <= 0) this.flickerAmt = 0;
    }
    // subtle continuous unsteadiness
    f *= 0.96 + 0.04 * Math.sin(this.time * 23.0) * Math.sin(this.time * 7.1);
    const on = this.on && this.has && !this.suppressed;
    const I = on ? 330 * f * this.extraIntensity : 0;
    this.spot.intensity = I;
    this.spot.visible = true;
    this.fill.intensity = on ? 2.2 * f : 0;
    this.beam.visible = on && settings.data.graphics?.quality !== 'low';
    this.beam.material.uniforms.uI.value = on ? 0.045 * f * this.extraIntensity : 0;
    this.beam.material.uniforms.uTime.value = this.time;
    if (this.lens) { this.lens.emissiveIntensity = on ? 2.5 * f : 0; }
  }
}
