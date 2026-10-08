// Post-processing: vignette + film grain + chromatic aberration (scares) +
// red pulse + desaturation, in a single cheap full-screen pass.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const HorrorShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.018 }, uVignette: { value: 1.0 },
    uAberr: { value: 0 }, uRed: { value: 0 }, uDesat: { value: 0.15 }, uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette, uAberr, uRed, uDesat; uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * uAberr * 0.025 * (0.4 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l), uDesat);
      float vig = smoothstep(0.85, 0.18, r2 * 1.6 * uVignette);
      col *= mix(1.0, vig, 0.85);
      col = mix(col, col * vec3(1.6, 0.35, 0.3) + vec3(0.12, 0.0, 0.0), uRed * (0.4 + r2 * 2.0));
      float n = hash(vUv * uRes + fract(uTime * 7.13)) - 0.5;
      col += n * uGrain * (0.6 + 0.8 * (1.0 - l));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.horror = new ShaderPass(HorrorShader);
    this.composer.addPass(this.horror);
    this.composer.addPass(new OutputPass());
    this.enabled = true;
    this.aberr = 0; this.red = 0; this.time = 0;
    this.baseDesat = 0.15;
  }
  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.horror.uniforms.uRes.value.set(w * pr, h * pr);
  }
  pulse(aberr = 0.6, red = 0) { this.aberr = Math.max(this.aberr, aberr); this.red = Math.max(this.red, red); }
  update(dt, fear = 0) {
    this.time += dt;
    this.aberr = Math.max(0, this.aberr - dt * 1.4);
    this.red = Math.max(0, this.red - dt * 0.9);
    const u = this.horror.uniforms;
    u.uTime.value = this.time;
    u.uAberr.value = this.aberr + fear * 0.12;
    u.uRed.value = this.red;
    u.uVignette.value = 1.0 + fear * 0.35;
    u.uDesat.value = this.baseDesat;
  }
  render(scene, camera) {
    if (this.enabled) this.composer.render();
    else this.renderer.render(scene, camera);
  }
}
