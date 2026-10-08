// Loads the Blender-built hospital + items, prepares materials, levels, doors,
// lights and weather.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Physics } from './physics.js';
import { Lights } from './lights.js';
import { Door, EntranceDoors } from './doors.js';
import { Rain, Lightning, makeRainGlassNormal } from './weather.js';

export const loader = new GLTFLoader();

export function loadGLB(url, onProgress) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, e => { if (onProgress && e.total) onProgress(e.loaded / e.total); }, err => reject(new Error(`Failed to load ${url}: ${err?.message || err}`)));
  });
}

const HUMAN_SCALE = { arman: 0.94, employee: 1.08, ghost: 1.08 };

export class World {
  constructor(scene, renderer, layout, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.layout = layout;
    this.quality = quality;
    this.physics = new Physics(layout);
    this.levels = {};
    this.doors = [];
    this.doorById = {};
    this.items = {};
    this.humans = {};          // rigged characters (arman.glb, employee.glb)
    this.animated = new Set();
    this.time = 0;
  }

  async load(progress) {
    const p = { hosp: 0, items: 0 };
    const report = () => progress && progress(p.hosp * 0.85 + p.items * 0.15);
    const [hosp, items] = await Promise.all([
      loadGLB('assets/models/hospital.glb', v => { p.hosp = v; report(); }),
      loadGLB('assets/models/items.glb', v => { p.items = v; report(); }),
    ]);
    this.setupHospital(hosp.scene);
    this.setupItems(items.scene);
    // leafy exterior trees (ns_trees.py; CC0 ambientCG leaf scans), instanced at trees.json spots
    await Promise.all([loadGLB('assets/models/trees.glb'), fetch('assets/models/trees.json').then(r => r.json())])
      .then(([t, spots]) => this.setupTrees(t.scene, spots)).catch(e => console.warn('[world] trees', e.message));
    // the flashlight: Poly Haven "Small Plastic Torch" (CC0), re-oriented in Blender (Props/torch.blend)
    await loadGLB('assets/models/torch.glb').then(t => {
      const m = t.scene.getObjectByName('flashlight') || t.scene.children[0];
      if (m) { m.removeFromParent(); m.position.set(0, 0, 0); this.items.flashlight = m; }
    }).catch(e => console.warn('[world] torch model', e.message));
    // rigged human characters (Blender + MPFB: ns_mpfb.py, CC0 animations retargeted by ns_retarget.py);
    // the old static figures in items.glb stay as fallback
    await Promise.all(['arman', 'employee', 'ghost'].map(n => loadGLB('assets/models/' + n + '.glb')
      .then(g => { this.humans[n] = g; }).catch(e => console.warn('[world] human model', n, e.message))));
    this.setupDoors();
    this.lights = new Lights(this.scene, this.layout, { poolSize: this.quality.lightPool });
    this.lights.bindInstances(this.root);
    this.lights.bindEmergency(this.emergencyMats);
    this.rain = new Rain(this.scene, this.layout.bounds, this.quality.rainCount);
    this.lightning = new Lightning();
  }

  setupHospital(root) {
    this.root = root;
    this.scene.add(root);
    const maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.rainNormal = makeRainGlassNormal();
    this.glassMat = new THREE.MeshStandardMaterial({
      color: 0x1a2228, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.38,
      normalMap: this.rainNormal, normalScale: new THREE.Vector2(0.9, 0.9), depthWrite: false,
      emissive: 0x8fa6c4, emissiveIntensity: 0, side: THREE.DoubleSide,
    });
    this.glassMat.name = 'glass_rain';
    this.emergencyMats = [];
    const seen = new Set();
    root.traverse(o => {
      if (o.parent === root && /^LEVEL_(B|\d)$/.test(o.name)) this.levels[o.name.slice(6)] = o;
      if (o.parent === root && o.name === 'EXTERIOR') this.exterior = o;
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i];
        if (!m) continue;
        if (m.name === 'M_glass') {
          if (Array.isArray(o.material)) o.material[i] = this.glassMat; else o.material = this.glassMat;
          o.castShadow = false; o.renderOrder = 2;
          continue;
        }
        if (seen.has(m)) continue;
        seen.add(m);
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (m[k]) m[k].anisotropy = maxAniso;
        if (m.name === 'M_decals') {
          m.transparent = true; m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
          m.alphaTest = 0.02;
          this.decalMat = m;
        }
        if (m.name === 'M_sign_red') this.emergencyMats.push(m);
        if (m.name === 'M_screen') { m.roughness = 0.12; m.metalness = 0.2; }
        if (m.name === 'M_steel') { m.metalness = 0.75; }
        m.envMapIntensity = 0.0;
      }
      if (mats.some(m => m && m.name === 'M_decals')) { o.castShadow = false; o.renderOrder = 1; }
    });
    // Exterior: no shadow casting for the huge ground plane; trees cast.
    if (this.exterior) this.exterior.traverse(o => { if (o.isMesh && o.name.includes('ground')) o.castShadow = false; });
    // Ceiling meshes don't need to cast (saves shadow work)
    root.traverse(o => { if (o.isMesh && /ceiling|decals|signs/.test(o.parent?.name + o.name)) o.castShadow = false; });
  }

  setupItems(root) {
    root.traverse(o => {
      if (o.parent === root) this.items[o.name] = o;
    });
    for (const o of Object.values(this.items)) {
      o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    }
  }

  // Clone an item model by name (deep clone, shares geometry/materials).
  // Rigged humans come back as skinned clones with their own mixer:
  //   obj.userData.play('walk' | 'idle' | 'stare' | 'head_tilt', fade), obj.userData.gait(speed)
  item(name) {
    if (this.humans[name]) return this.human(name);
    const src = this.items[name];
    if (!src) { console.warn('[world] missing item model', name); return new THREE.Group(); }
    const c = src.clone(true);
    c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); c.scale.set(1, 1, 1);
    return c;
  }

  // One InstancedMesh per tree part (wood, two leaf cards) per variant. Leaves are alpha cut-outs,
  // double-sided, and sway in the wind in the vertex shader (more at the canopy edge, gusting).
  setupTrees(root, spots) {
    this.windUniforms = { uTime: { value: 0 }, uWind: { value: 1 } };
    const group = new THREE.Group(); group.name = 'TREES';
    (this.exterior || this.scene).add(group);
    const U = this.windUniforms;
    for (let v = 0; v < 3; v++) {
      const node = root.getObjectByName('tree_' + v); if (!node) continue;
      const mine = spots.filter(s => s.variant === v);
      if (!mine.length) continue;
      node.updateMatrixWorld(true);
      node.traverse(o => {
        if (!o.isMesh) return;
        const leaves = /leaves/.test(o.name);
        const m = o.material;
        if (leaves) {
          m.alphaTest = 0.5; m.transparent = false; m.side = THREE.DoubleSide; m.alphaToCoverage = true;
          m.onBeforeCompile = sh => {
            Object.assign(sh.uniforms, U);
            sh.vertexShader = 'uniform float uTime; uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
              vec4 wp = instanceMatrix * vec4(position, 1.0);
              float edge = clamp(length(position.xz) / 4.0, 0.0, 1.0) * clamp(position.y / 6.0, 0.0, 1.2);
              float gust = 0.6 + 0.4 * sin(uTime * 0.7 + wp.x * 0.05) * sin(uTime * 0.31 + wp.z * 0.04);
              float f = uWind * gust * edge;
              transformed.x += (sin(uTime * 1.9 + wp.x * 0.6 + position.y) * 0.12 + 0.18) * f;
              transformed.z += sin(uTime * 2.3 + wp.z * 0.5 + position.x) * 0.1 * f;
              transformed.y += sin(uTime * 3.1 + position.x * 2.0 + position.z * 2.0) * 0.04 * f;`);
          };
          m.customProgramCacheKey = () => 'tree_leaves_wind';
        } else { m.roughness = 0.95; }
        const im = new THREE.InstancedMesh(o.geometry, m, mine.length);
        const local = o.matrixWorld.clone();
        const mtx = new THREE.Matrix4(), q = new THREE.Quaternion();
        mine.forEach((s, i) => {
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot);
          mtx.compose(new THREE.Vector3(s.x, 0, s.z), q, new THREE.Vector3(s.scale, s.scale, s.scale)).multiply(local);
          im.setMatrixAt(i, mtx);
        });
        im.castShadow = !leaves; im.receiveShadow = true;
        im.computeBoundingSphere();
        group.add(im);
      });
    }
    this.trees = group;
  }

  human(name) {
    const g = this.humans[name];
    const c = SkeletonUtils.clone(g.scene);
    c.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      // MPFB materials arrive alpha-blended + double-sided, which breaks depth sorting (eyes and
      // teeth draw through the face). Hair/brows/lashes become alpha cut-outs, the rest solid.
      const m = o.material;
      if (m.userData.fixed) return;
      m.userData.fixed = true;
      const cards = /eyebrow|eyelash|long0|short0|ponytail|bob0|braid|afro|hair/i.test(m.name);
      m.transparent = false; m.depthWrite = true; m.opacity = 1;
      if (cards) { m.alphaTest = 0.45; m.side = THREE.DoubleSide; m.alphaToCoverage = true; }
      else { m.alphaTest = 0; m.side = THREE.FrontSide; }
      m.needsUpdate = true;
    });
    const mixer = new THREE.AnimationMixer(c);
    const actions = {};
    for (const clip of g.animations) actions[clip.name.replace(name + '_', '')] = mixer.clipAction(clip);
    for (const k of ['head_tilt', 'reach']) if (actions[k]) { actions[k].setLoop(THREE.LoopOnce, 1); actions[k].clampWhenFinished = true; }
    // MPFB bodies are modelled at real size; match the player's 1.62 m eye line / natural heights
    c.scale.setScalar(HUMAN_SCALE[name] ?? 1);
    const U = c.userData;
    U.mixer = mixer; U.actions = actions; U.current = null;
    U.play = (n, fade = 0.35) => {
      const a = actions[n]; if (!a || U.current === a) return a;
      a.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
      if (U.current) U.current.crossFadeTo(a, fade, false);
      U.current = a; U.currentName = n;
      return a;
    };
    // walk <-> idle by ground speed, cadence matched to speed (authored for 1.3 m/s)
    U.gait = speed => {
      if (speed > 0.25) { U.play('walk', 0.3); U.current.setEffectiveTimeScale(Math.min(2.1, Math.max(0.6, speed / 1.3))); }
      else if (U.currentName === 'walk') U.play(U.restPose || 'idle', 0.45);
    };
    U.play('idle', 0);
    mixer.update(Math.random() * 3);
    this.animated.add(c);
    return c;
  }

  // parent obj to a bone of a rigged clone, keeping a given rest-pose position in the clone's space
  attachToBone(root, boneName, obj, pos) {
    let bone = null;
    root.traverse(o => { if (!bone && o.isBone && o.name === boneName) bone = o; });
    if (!bone) { obj.position.copy(pos); root.add(obj); return obj; }
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const boneInRoot = new THREE.Matrix4().multiplyMatrices(inv, bone.matrixWorld);
    const local = new THREE.Matrix4().copy(boneInRoot).invert();
    obj.position.copy(pos).applyMatrix4(local);
    obj.quaternion.setFromRotationMatrix(local);
    bone.add(obj);
    return obj;
  }

  setupDoors() {
    for (const d of this.layout.doors) {
      const model = this.item(d.kind === 'metal' ? 'door_metal' : 'door_wood');
      const variant = d.room === this.layout.powerRoom.id ? 'heavy'
        : d.room === this.layout.morgue.id ? 'morgue'
        : d.level === 'B' ? 'basement' : 'wood';
      const door = new Door(d, model, this.scene, this.physics, variant);
      this.doors.push(door);
      this.doorById[d.id] = door;
    }
    this.entrance = new EntranceDoors([this.item('door_entrance'), this.item('door_entrance')], this.scene, this.physics, this.layout.entrance);
  }

  doorsNear(pos, radius, level) {
    return this.doors.filter(d => (!level || d.level === level) && d.center.distanceTo(pos) < radius);
  }

  setLevelVisibility(level, camPos) {
    const order = this.layout.levels.map(l => l.id);
    const i = order.indexOf(level);
    const B = this.layout.bounds;
    // From outside the building every floor is visible through/around the facade.
    const outside = camPos && (camPos.x < B.x0 - 0.3 || camPos.x > B.x1 || camPos.z < B.z0 || camPos.z > B.z1);
    for (const [id, obj] of Object.entries(this.levels)) {
      const j = order.indexOf(id);
      obj.visible = outside ? id !== 'B' : Math.abs(i - j) <= 1;
    }
    for (const d of this.doors) d.pivot.visible = this.levels[d.level]?.visible ?? true;
    if (this.exterior) this.exterior.visible = level !== 'B';
  }

  update(dt, camPos, level, flashScale) {
    this.time += dt;
    if (this.windUniforms) this.windUniforms.uTime.value = this.time;
    for (const h of this.animated) { if (!h.parent) { this.animated.delete(h); continue; } if (h.visible) h.userData.mixer.update(dt); }
    for (const d of this.doors) d.update(dt);
    this.entrance.update(dt);
    const basement = level === 'B';
    const flash = this.lightning.update(dt, basement) ;
    if (flash > 0) this.lights.lightningFlash(flash);
    const B = this.layout.bounds;
    const outside = camPos.x < B.x0 - 0.2 || camPos.x > B.x1 || camPos.z < B.z0 || camPos.z > B.z1;
    this.lights.outside = outside ? 1 : 0;
    this.lights.update(dt, camPos, level, flashScale);
    this.rain.update(dt, camPos, flash * flashScale);
    this.rainNormal.offset.y -= dt * 0.05;
    this.glassMat.emissiveIntensity = flash * flashScale * 1.6;
    this.flash = flash * flashScale;
  }
}
