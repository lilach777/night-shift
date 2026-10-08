// The lobby mirror: a real planar reflection (three.js Reflector) in a framed wall mirror.
// The first-person player has no visible body, so the reflection shows a stand-in body that lives
// on layer 1: the main camera never draws it, only the mirror's reflection camera does.
// It renders only while the viewer is in the lobby and facing it (a second scene pass is not free).
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class LobbyMirror {
  // spot: { x, y, z, ry, w, h } - centre of the glass, facing direction ry (0 = +z)
  constructor(scene, spot, quality = 'high') {
    this.spot = spot;
    const size = quality === 'low' ? 384 : quality === 'medium' ? 512 : 640;
    const group = new THREE.Group();
    group.position.set(spot.x, spot.y, spot.z); group.rotation.y = spot.ry;
    // frame: dark lacquered wood with a thin steel inner lip, standing 2 cm off the wall
    const wood = new THREE.MeshStandardMaterial({ color: 0x17110c, roughness: 0.55, metalness: 0.05 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x6b6d70, roughness: 0.35, metalness: 0.8 });
    const fw = 0.07, W = spot.w, H = spot.h;
    const bar = (w, h, x, y, m, d = 0.04) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, d / 2 - 0.01); b.castShadow = true; b.receiveShadow = true; group.add(b); };
    bar(W + fw * 2, fw, 0, H / 2 + fw / 2, wood); bar(W + fw * 2, fw, 0, -H / 2 - fw / 2, wood);
    bar(fw, H, -W / 2 - fw / 2, 0, wood); bar(fw, H, W / 2 + fw / 2, 0, wood);
    bar(W + 0.01, 0.012, 0, H / 2, steel, 0.03); bar(W + 0.01, 0.012, 0, -H / 2, steel, 0.03);
    // backing plate (seen at grazing angles)
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.3 }));
    back.position.z = -0.005; group.add(back);
    // the glass: slightly dark, very slightly green like old mirror silvering; a little age at the edges
    this.glass = new Reflector(new THREE.PlaneGeometry(W, H), { textureWidth: size, textureHeight: Math.round(size * H / W), color: 0x8e9590, clipBias: 0.003 });
    this.glass.position.z = 0.012;
    group.add(this.glass);
    const age = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: ageTexture(), transparent: true, depthWrite: false }));
    age.position.z = 0.0135; age.renderOrder = 3; group.add(age);
    scene.add(group);
    this.group = group;
    this.normal = V(Math.sin(spot.ry), 0, Math.cos(spot.ry));
    this.center = V(spot.x, spot.y, spot.z);
    this._camInit = new WeakSet();
  }

  // only draw the reflection pass when it can actually be seen
  update(camera, enabled = true) {
    if (!this._camInit.has(camera)) { this.glass.getReflectionCamera(camera).layers.enable(1); this._camInit.add(camera); }
    const to = camera.position.clone().sub(this.center);
    const d = to.length();
    const fwd = V(0, 0, -1).applyQuaternion(camera.quaternion);
    const facing = to.dot(this.normal) > 0.05;                          // in front of the glass
    const looking = fwd.dot(this.center.clone().sub(camera.position).normalize()) > 0.15;
    this.glass.visible = enabled && facing && looking && d < 16 && Math.abs(camera.position.y - this.center.y) < 3;
  }
}

// a faint vignette of desilvering + dust so the glass reads as an old hospital mirror
function ageTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 384;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 192, 80, 128, 192, 230);
  grd.addColorStop(0, 'rgba(20,18,14,0)'); grd.addColorStop(1, 'rgba(20,18,14,0.55)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 384);
  for (let i = 0; i < 26; i++) {                                         // desilvered spots near the edges
    const edge = Math.random() < 0.5;
    const x = edge ? (Math.random() < 0.5 ? Math.random() * 30 : 226 + Math.random() * 30) : Math.random() * 256;
    const y = edge ? Math.random() * 384 : (Math.random() < 0.5 ? Math.random() * 30 : 354 + Math.random() * 30);
    const r = 2 + Math.random() * 9;
    const s = g.createRadialGradient(x, y, 0, x, y, r);
    s.addColorStop(0, 'rgba(10,9,7,0.7)'); s.addColorStop(1, 'rgba(10,9,7,0)');
    g.fillStyle = s; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(200,195,180,${Math.random() * 0.05})`; g.fillRect(Math.random() * 256, Math.random() * 384, 1, 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
