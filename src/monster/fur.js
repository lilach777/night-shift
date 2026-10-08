// Real-time SHELL FUR for a skinned mesh.
// N copies ("shells") of the skinned body are pushed out along their skinned normals; each shell
// keeps only the fragments where a strand is still taller than that shell (3D strand grid in the
// mesh's REST-pose space, so strands stay glued to the skin while it animates). Vertex colour
// carries the coat: RGB = colour, A = fur length (0 = bare skin, 1 = long tufts). Roots are darker
// (self-shadowing), tips droop slightly with gravity and lift with motion.
import * as THREE from 'three';

const HEAD = /* glsl */`
  uniform float uShell; uniform float uLen; uniform float uDensity; uniform vec3 uFlow;
  varying vec3 vRest; varying float vFurLen;
`;
const HASH = /* glsl */`
  float furHash(vec3 p) { p = fract(p * vec3(443.897, 441.423, 437.195)); p += dot(p, p.yzx + 19.19); return fract((p.x + p.y) * p.z); }
`;

export function shellMaterial(base, i, n, opts) {
  const shell = (i + 1) / n;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true });
  m.name = 'koala_fur_shell';
  m.userData.uniforms = {
    uShell: { value: shell }, uLen: { value: opts.length }, uDensity: { value: opts.density },
    uFlow: { value: opts.flow },
  };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, m.userData.uniforms);
    sh.vertexShader = HEAD + 'attribute float furLen;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vRest = position; vFurLen = furLen;`)
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
        // out along the skinned normal, droop + motion lag on the outer shells
        float s = uShell * uLen * vFurLen;
        transformed += normalize(objectNormal) * s;
        transformed += uFlow * (uShell * uShell) * uLen * vFurLen;`);
    sh.fragmentShader = HEAD + HASH + sh.fragmentShader
      .replace('#include <color_fragment>', `
        if (vFurLen < 0.04) discard;                                // bare skin: nose, lips, palms, mange
        vec3 q = vRest * uDensity;
        vec3 cell = floor(q);
        vec3 f = fract(q) - 0.5;
        float h = mix(0.45, 1.0, furHash(cell));                   // this strand's height (0..1 of fur length)
        float rel = uShell / max(h, 1e-3);                         // how far up the strand this shell is
        if (rel > 1.0) discard;
        float rad = 0.62 * (1.0 - rel);                            // tapering strand
        if (dot(f, f) > rad * rad) discard;
        float ao = mix(0.32, 1.0, pow(uShell, 0.7));               // dark roots, light tips
        // clumps: neighbouring strands share a tone, a few stray light/dark hairs
        float clump = furHash(floor(q * 0.25));
        diffuseColor.rgb *= vColor.rgb * ao * (0.72 + 0.3 * clump + 0.18 * furHash(cell + 7.0)) * vec3(0.8, 0.82, 0.86);`);
  };
  m.customProgramCacheKey = () => 'koala_fur_shell_v1';
  return m;
}

export class ShellFur {
  constructor(mesh, { shells = 16, length = 0.05, density = 240 } = {}) {
    this.mesh = mesh;
    const g = mesh.geometry;
    if (!g.getAttribute('furLen')) g.setAttribute('furLen', g.getAttribute('_furlen') || new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(0.6), 1));
    this.flow = new THREE.Vector3(0, -0.35, 0);
    this.shells = [];
    for (let i = 0; i < shells; i++) {
      const mat = shellMaterial(mesh.material, i, shells, { length, density, flow: this.flow });
      const s = new THREE.SkinnedMesh(mesh.geometry, mat);
      s.name = 'fur_shell_' + i;
      s.bind(mesh.skeleton, mesh.bindMatrix);
      s.position.copy(mesh.position); s.quaternion.copy(mesh.quaternion); s.scale.copy(mesh.scale);
      s.castShadow = false; s.receiveShadow = true; s.frustumCulled = false;
      s.renderOrder = 1;
      mesh.parent.add(s);
      this.shells.push(s);
    }
    this.prev = new THREE.Vector3();
  }

  // motion lag: tips trail behind the body when it moves fast (object space), gravity always
  update(dt, worldVel, rootQuat) {
    const lag = worldVel.clone().multiplyScalar(-0.06);
    if (rootQuat) lag.applyQuaternion(rootQuat.clone().invert());
    lag.clampLength(0, 0.6);
    this.flow.lerp(new THREE.Vector3(lag.x, -0.35 + lag.y, lag.z), Math.min(1, dt * 6));
  }

  setVisible(v) { for (const s of this.shells) s.visible = v; }
}
