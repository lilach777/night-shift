// NIGHT SHIFT multiplayer - environmental storytelling (MULTIPLAYER ONLY).
// Everything here is set dressing: Blender-authored props (mp_dressing.glb, blender/scripts/ns_mpdress.py)
// plus canvas-painted notices, tape, scratches and blood. It tells the story without a word of
// exposition: a rushed evacuation upstairs, a basement someone kept running, and a containment
// room that has failed before. Solid props get real colliders (players and the Koala walk around them).
import * as THREE from 'three';
import { loadGLB } from '../world/world.js';
import { poster } from '../systems/photos.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const PI = Math.PI;

// ---------------------------------------------------------------- canvas painters
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function age(g, w, h, amt = 1) {
  for (let i = 0; i < 1400 * amt; i++) { g.fillStyle = `rgba(70,50,25,${Math.random() * 0.07})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  const s = g.createRadialGradient(w * Math.random(), h * Math.random(), 5, w / 2, h / 2, Math.max(w, h));
  s.addColorStop(0, `rgba(95,70,30,${0.25 * amt})`); s.addColorStop(1, 'rgba(95,70,30,0)'); g.fillStyle = s; g.fillRect(0, 0, w, h);
}
function wrapText(g, text, x, y, maxW, lh) {
  const words = text.split(' '); let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y); line = w; y += lh; } else line = t;
  }
  if (line) g.fillText(line, x, y);
  return y + lh;
}
// a printed notice: header band + bold title + body paragraphs
function noticeTex({ header = 'ST. MERCY HOSPITAL', band = '#7a2a1a', title, body = [], foot = '', w = 512, h = 720 }) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = '#d6cfbd'; g.fillRect(0, 0, w, h);
    g.fillStyle = band; g.fillRect(0, 0, w, 86);
    g.fillStyle = '#eee8da'; g.font = 'bold 30px Arial, sans-serif'; g.textAlign = 'center'; g.fillText(header, w / 2, 56);
    g.fillStyle = '#1e1b17'; g.font = 'bold 46px Arial, sans-serif';
    let y = 160; for (const l of title.split('\n')) { g.fillText(l, w / 2, y); y += 54; }
    g.font = '24px Arial, sans-serif'; g.textAlign = 'left'; y += 16;
    for (const p of body) y = wrapText(g, p, 40, y, w - 80, 32) + 12;
    if (foot) { g.font = 'bold 22px Arial, sans-serif'; g.textAlign = 'center'; g.fillStyle = band; g.fillText(foot, w / 2, h - 40); }
    age(g, w, h);
  });
}
function tapeTex() {
  return canvasTex(512, 48, (g, w, h) => {
    g.fillStyle = '#d9b21c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#16140f'; g.font = 'bold 26px Arial, sans-serif'; g.textBaseline = 'middle';
    for (let x = 6; x < w; x += 250) g.fillText('DO NOT ENTER', x, h / 2 + 1);
    for (let x = 200; x < w; x += 250) { g.beginPath(); g.moveTo(x, 4); g.lineTo(x + 30, 4); g.lineTo(x + 18, h - 4); g.lineTo(x - 12, h - 4); g.fill(); }
    age(g, w, h, 0.5);
  });
}
// claw marks: four parallel gouges, pale plaster showing through, dark edges
function scratchTex(seed = 1) {
  let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let set = 0; set < 2; set++) {
      const ox = 40 + r() * 110, oy = 30 + set * 90 + r() * 30, ang = -0.5 + r() * 0.5;
      for (let k = 0; k < 4; k++) {
        const x0 = ox + k * 16, y0 = oy + k * 4, L = 90 + r() * 70;
        const x1 = x0 + Math.cos(ang + 1.2) * L, y1 = y0 + Math.sin(ang + 1.2) * L;
        g.lineCap = 'round';
        g.strokeStyle = 'rgba(25,18,14,0.75)'; g.lineWidth = 7; g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2 + 6, (y0 + y1) / 2, x1, y1); g.stroke();
        g.strokeStyle = 'rgba(210,200,182,0.55)'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x0 + 1, y0); g.quadraticCurveTo((x0 + x1) / 2 + 7, (y0 + y1) / 2, x1 + 1, y1); g.stroke();
      }
    }
  });
}
function bloodTex(kind = 'smear', seed = 3) {
  let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const col = a => `rgba(${70 + r() * 20},4,4,${a})`;
    if (kind === 'trail') {
      for (let i = 0; i < 26; i++) { const x = 30 + i * 8 + r() * 6, y = 128 + Math.sin(i * 0.4) * 14 + r() * 6; g.fillStyle = col(0.5 + r() * 0.35); g.beginPath(); g.ellipse(x, y, 10 + r() * 10, 6 + r() * 7, r() * 3, 0, PI * 2); g.fill(); }
    } else if (kind === 'hand') {
      g.fillStyle = col(0.75);
      g.beginPath(); g.ellipse(128, 150, 34, 40, 0, 0, PI * 2); g.fill();
      for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(92 + k * 24, 90 - Math.abs(k - 1.5) * 8, 9, 30, (k - 1.5) * 0.12, 0, PI * 2); g.fill(); }
      g.beginPath(); g.ellipse(170, 160, 9, 26, 0.9, 0, PI * 2); g.fill();
      for (let k = 0; k < 4; k++) { g.fillRect(105 + k * 18 + r() * 6, 185, 3 + r() * 3, 40 + r() * 50); }   // runs
    } else {
      for (let i = 0; i < 14; i++) { g.fillStyle = col(0.35 + r() * 0.5); g.beginPath(); g.ellipse(128 + (r() - 0.5) * 120, 128 + (r() - 0.5) * 90, 8 + r() * 34, 5 + r() * 22, r() * 3, 0, PI * 2); g.fill(); }
    }
  });
}
// scratched into the plaster: every year a crew came down here - and a fresh, unfinished one
function tallyTex() {
  return canvasTex(512, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const years = ['1987', '1994', '2003', '2011', '2019'];
    g.font = '52px "Reenie Beanie", "Special Elite", cursive'; g.textAlign = 'center';
    years.forEach((y, i) => {
      const x = 70 + (i % 3) * 170 + (Math.random() - 0.5) * 20, yy = 80 + Math.floor(i / 3) * 90 + (Math.random() - 0.5) * 10;
      g.save(); g.translate(x, yy); g.rotate((Math.random() - 0.5) * 0.15);
      g.fillStyle = 'rgba(28,22,18,0.8)'; g.fillText(y, 2, 2);
      g.fillStyle = 'rgba(205,196,178,0.75)'; g.fillText(y, 0, 0);
      g.restore();
    });
    g.save(); g.translate(410, 172); g.rotate(0.05);                       // the fresh one: just "20"
    g.fillStyle = 'rgba(28,22,18,0.8)'; g.fillText('20', 2, 2); g.fillStyle = 'rgba(232,226,210,0.95)'; g.fillText('20', 0, 0);
    g.restore();
  });
}
// cracked, partly shattered pane: alpha hole where it broke outward, crack lines radiating from it
function crackedGlassTex(hole) {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = 'rgba(150,170,180,0.16)'; g.fillRect(0, 0, w, h);
    if (hole) {
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); const cx = w * 0.45, cy = h * 0.58;
      for (let i = 0; i <= 14; i++) { const a = i / 14 * PI * 2, rr = 120 + Math.random() * 90; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 1.3); }
      g.fill(); g.globalCompositeOperation = 'source-over';
    }
    // radial fractures that wander and fork, a few short broken arcs between them - not a web
    const cx = w * (0.35 + Math.random() * 0.3), cy = h * (hole ? 0.58 : 0.3 + Math.random() * 0.3);
    const crack = (x, y, a, len, wdt, depth) => {
      g.lineWidth = wdt; g.beginPath(); g.moveTo(x, y);
      const n = 4 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        a += (Math.random() - 0.5) * 0.7; x += Math.cos(a) * len / n; y += Math.sin(a) * len / n; g.lineTo(x, y);
        if (depth < 2 && Math.random() < 0.22) { g.stroke(); crack(x, y, a + (Math.random() < 0.5 ? 0.6 : -0.6), len * 0.45, wdt * 0.7, depth + 1); g.lineWidth = wdt; g.beginPath(); g.moveTo(x, y); }
      }
      g.stroke();
    };
    g.strokeStyle = 'rgba(220,230,236,0.42)';
    const spokes = 7 + Math.floor(Math.random() * 4);
    for (let i = 0; i < spokes; i++) crack(cx, cy, (i / spokes) * PI * 2 + Math.random() * 0.5, 120 + Math.random() * 220, 1.3, 0);
    g.strokeStyle = 'rgba(220,230,236,0.22)'; g.lineWidth = 1;
    for (let i = 0; i < 5; i++) { const r = 25 + Math.random() * 90, a0 = Math.random() * PI * 2; g.beginPath(); g.arc(cx, cy, r, a0, a0 + 0.3 + Math.random() * 0.6); g.stroke(); }
  });
}
function textPlate(lines, { bg = '#c9c4b4', fg = '#1c1a16', red = false } = {}) {
  return canvasTex(512, 384, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = red ? '#8e1d14' : '#24322e'; g.fillRect(0, 0, w, 64);
    g.fillStyle = '#ece6d6'; g.font = 'bold 30px Arial, sans-serif'; g.textAlign = 'center'; g.fillText(lines[0], w / 2, 44);
    g.fillStyle = fg; g.font = 'bold 28px Arial, sans-serif';
    let y = 112; for (const l of lines.slice(1)) { y = wrapText(g, l, 32, y, w - 64, 36) + 4; g.textAlign = 'left'; g.font = '25px Arial, sans-serif'; }
    age(g, w, h, 0.7);
  });
}

// ---------------------------------------------------------------- the dressing
export class MPDressing {
  constructor(g) {
    this.g = g;
    this.nodes = {};
    this.beacons = [];
    this.extra = new THREE.Group(); this.extra.name = 'MP_DRESSING';
    g.scene.add(this.extra);
  }

  async load() {
    try {
      const glb = await loadGLB('assets/models/mp_dressing.glb');
      glb.scene.traverse(o => { if (o.parent === glb.scene) this.nodes[o.name] = o; });
      for (const o of Object.values(this.nodes)) o.traverse(c => {
        if (!c.isMesh) return;
        c.castShadow = true; c.receiveShadow = true;
        const m = c.material;
        if (m?.name === 'M_glass_shard') { m.transparent = true; m.opacity = 0.5; m.depthWrite = false; c.castShadow = false; }
        if (m) m.envMapIntensity = 0;
      });
    } catch (e) { console.warn('[mp] dressing', e.message); }
  }

  // clone a dressing node; collide = { w, d, h } adds a solid box (rotated footprint)
  put(name, x, y, z, ry = 0, collide = null) {
    const src = this.nodes[name];
    if (!src) return new THREE.Group();
    const o = src.clone(true); o.position.set(x, y, z); o.rotation.y = ry;
    this.extra.add(o);
    if (collide) this.solid(x, y, z, ry, collide.w, collide.d, collide.h);
    return o;
  }
  solid(x, y, z, ry, w, d, h) {
    const cs = Math.abs(Math.cos(ry)), sn = Math.abs(Math.sin(ry));
    const W = w * cs + d * sn, D = w * sn + d * cs;
    this.g.world.physics.addBox({ x0: x - W / 2, x1: x + W / 2, z0: z - D / 2, z1: z + D / 2, y0: y, y1: y + h, wall: false, prop: 'mp_dressing' });
  }
  // a flat decal on a wall (ry = facing) or the floor (floor: true)
  decal(tex, x, y, z, ry, w, h, { floor = false, opacity = 1 } = {}) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity, depthWrite: false, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    m.position.set(x, y, z);
    if (floor) { m.rotation.x = -PI / 2; m.rotation.z = ry; } else m.rotation.y = ry;
    m.renderOrder = 1; m.receiveShadow = true;
    this.extra.add(m);
    return m;
  }
  wallPoster(lines, x, y, z, ry, opts) { const p = poster(lines, opts); p.position.set(x, y, z); p.rotation.y = ry; this.extra.add(p); return p; }
  notice(spec, x, y, z, ry, w = 0.5, h = 0.7) { return this.decal(noticeTex(spec), x, y, z, ry, w, h); }
  // a strip of caution tape between two points (with a little sag)
  tape(a, b, sag = 0.06) {
    const tex = tapeTex(); tex.wrapS = THREE.RepeatWrapping;
    const len = a.distanceTo(b); tex.repeat.set(len / 1.6, 1);
    const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.6 });
    const seg = 8, geo = new THREE.PlaneGeometry(len, 0.075, seg, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const u = (pos.getX(i) / len) + 0.5; pos.setY(i, pos.getY(i) - Math.sin(u * PI) * sag); }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    m.rotation.z = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
    this.extra.add(m);
    return m;
  }
  placard(lines, x, y, z, ry, red = false) {
    const o = this.put('mp_placard', x, y, z, ry);
    const tex = textPlate(lines, { red });
    o.traverse(c => { if (c.isMesh && c.material?.name === 'M_placard') { c.material = c.material.clone(); c.material.map = tex; c.material.color.setHex(0xffffff); c.material.needsUpdate = true; } });
    return o;
  }
  beacon(x, y, z) {
    const o = this.put('mp_beacon', x, y, z, 0);
    const mats = [];
    o.traverse(c => { if (c.isMesh && c.material?.name === 'M_beacon') { c.material = c.material.clone(); mats.push(c.material); } });
    const light = new THREE.SpotLight(0xff3010, 0, 9, 0.5, 0.6, 1.2); light.position.set(x, y + 0.12, z);
    light.target.position.set(x + 1, y - 0.6, z); this.extra.add(light, light.target);
    const b = { o, mats, light, x, y, z, mode: 'off', a: 0 };
    this.beacons.push(b);
    return b;
  }

  // ================================================================ build everything
  build(story) {
    const g = this.g;
    this.buildArrival(story);
    this.buildBasement(story);
    this.buildB11(story);
    this.buildSwitches(story);
    this.buildFuseAreas(story);
  }

  // SCENE 1 - an evacuation that never finished
  buildArrival() {
    // demolition notice on an A-frame by the entrance
    const nb = this.put('mp_notice_board', -24.2, 0, 3.6, -PI / 2 - 0.25, { w: 0.7, d: 0.5, h: 1.2 });
    const tex = noticeTex({ header: 'NOTICE OF DEMOLITION', band: '#8e1d14', title: 'ST. MERCY\nHOSPITAL', body: ['This building is closed and scheduled for demolition.', 'Demolition begins 6:00 AM.', 'Authorised contractors only beyond this point.'], foot: 'KEEP OUT', w: 512, h: 720 });
    nb.traverse(c => { if (c.isMesh && c.material?.name === 'M_notice') { c.material = c.material.clone(); c.material.map = tex; c.material.color.setHex(0xffffff); } });
    // lobby: papers everywhere, a wheelchair on its side, a chair kicked over, boxes nobody came back for
    this.put('mp_papers', -18.6, 0, -1.6, 0.4);
    this.put('mp_papers', -13.6, 0, 1.4, 2.1);
    this.put('mp_papers', -15.4, 0, 7.4, -0.8);
    this.put('mp_wheelchair_tipped', -21.15, 0, 6.5, 0.4, { w: 0.75, d: 0.95, h: 0.7 });
    this.put('mp_chair_tipped', -17.4, 0, 2.75, 1.15, { w: 0.5, d: 0.9, h: 0.5 });
    this.put('mp_gurney_sheet', -11.5, 0, -5.6, 0.18, { w: 0.85, d: 2.0, h: 0.9 });
    this.put('mp_boxes', -18.9, 0, -7.5, 0.1, { w: 1.0, d: 0.75, h: 0.62 });
    // notices on the walls
    this.notice({ header: 'EVACUATION NOTICE', band: '#7a2a1a', title: 'ALL PATIENTS\nRELOCATED', body: ['By order of the hospital board this facility was evacuated on 13 October.', 'Staff must not return to the building.', 'Sub-Level B remains sealed.'], foot: 'DR. M. HALLOWAY - MEDICAL DIRECTOR' }, -14.6, 1.55, -8.835, 0, 0.55, 0.77);
    this.notice({ header: 'ST. MERCY HOSPITAL', band: '#2f5a52', title: 'EVACUATION\nROUTE', body: ['Leave all belongings.', 'Do not use the stairwell to Sub-Level B.', 'Proceed to the car park.'], foot: 'EXIT  <-' }, -21.835, 1.6, -5.2, PI / 2, 0.5, 0.7);
    this.notice({ header: 'STAFF', band: '#7a2a1a', title: 'NIGHT SHIFT\nCANCELLED', body: ['All night shifts are cancelled until further notice.', 'Do not answer the reception telephone.'], foot: '' }, -12.9, 1.5, 8.835, PI, 0.45, 0.63);
    // a battery exit sign, dying: the only light in the lobby when the crew walks in
    this.exitGlow = new THREE.PointLight(0xff2a14, 0.6, 7, 2); this.exitGlow.position.set(-21.6, 2.75, 0); this.extra.add(this.exitGlow);
    this.exitT = 0;
  }

  // SCENE 4 - someone kept the basement running, and something was not supposed to be reached
  buildBasement() {
    // the generator log on the B10 workbench
    this.genLog = this.put('mp_clipboard', -13.9, -3.1, -8.45, 0.25);
    this.placard(['B-WING FEED', 'KEEP ISOLATED.', 'Do not reconnect without Dr. Halloway.'], -15.6, -2.6, -8.835, 0, true);
    // B11: restricted sign, torn tape on both sides of the frame
    this.notice({ header: 'SUB-LEVEL B', band: '#8e1d14', title: 'B11\nRESTRICTED', body: ['No entry without escort.', 'Keep this door closed.'], foot: 'AUTH: M. HALLOWAY' }, -9.4, -2.45, -1.41, 0, 0.42, 0.58);
    this.tape(V(-8.62, -2.1, -1.36), V(-8.45, -3.3, -1.36), 0.02);
    this.tape(V(-7.38, -2.2, -1.36), V(-7.55, -3.0, -1.36), 0.02);
    // claw marks along the corridor walls near B11 and the stairwell
    this.decal(scratchTex(11), -10.6, -2.5, -1.38, 0, 0.9, 0.9);
    this.decal(scratchTex(17), -5.4, -3.0, 1.38, PI, 0.8, 0.8);
    this.decal(scratchTex(23), 15.6, -2.4, -1.38, 0, 0.7, 0.7);
    this.decal(bloodTex('trail', 5), -8.0, -3.995, -0.4, 0.3, 2.2, 0.9, { floor: true, opacity: 0.8 });
    // the photo wall at the end of the corridor is shared with the single-player hospital (see story)
    // the emergency shutter in the basement corridor (built by the story so it can be networked)
  }

  // SCENE 11 - the chamber has failed before
  buildB11(story) {
    const y = -4, cx = -8;
    // cracked / shattered panes in the full-width containment frame (z = -5.6)
    const pane = (x0, x1, hole) => {
      const w = x1 - x0, m = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.85), new THREE.MeshStandardMaterial({ map: crackedGlassTex(hole), transparent: true, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }));
      m.position.set(cx + (x0 + x1) / 2, y + 0.1 + 1.425, -5.6); m.renderOrder = 2; this.extra.add(m);
      return m;
    };
    pane(-3.95, -2.3, false); pane(-0.72, 1.6, true); pane(1.6, 3.95, false);
    this.put('mp_glass_shards', cx + 0.4, y, -5.25, 0);
    this.put('mp_glass_shards', cx - 2.8, y, -5.35, 0.6);
    // the chamber: more beds than one specimen needs, torn straps, knocked over equipment
    const bed = n => { const o = this.g.world.item('restraint_bed'); o.position.set(...n.p); o.rotation.y = n.r; this.extra.add(o); this.solid(n.p[0], n.p[1], n.p[2], n.r, 0.95, 2.0, 0.9); };
    bed({ p: [-10.4, y, -7.9], r: -0.35 });
    bed({ p: [-5.5, y, -8.0], r: 0.25 });
    this.put('mp_straps', -7.6, y, -7.0, 0.3);
    this.put('mp_straps', -10.1, y, -6.6, 1.9);
    this.put('mp_monitor_tipped', -5.3, y, -3.0, 0.45, { w: 0.6, d: 1.0, h: 0.6 });
    this.put('mp_ivstand_tipped', -10.6, y, -3.4, 1.1);
    // gouges on the chamber walls, a hand on the glass frame, blood dragged to the break
    this.decal(scratchTex(31), -9.6, -2.6, -8.835, 0, 1.0, 1.0);
    this.decal(scratchTex(37), -6.3, -2.2, -8.835, 0, 1.0, 1.0);
    this.decal(scratchTex(41), -11.88, -2.8, -7.3, PI / 2, 1.0, 1.0);
    this.decal(bloodTex('hand', 9), cx - 0.9, -2.65, -5.55, 0, 0.32, 0.32, { opacity: 0.9 });
    this.decal(bloodTex('smear', 13), -7.4, -3.994, -7.6, 1.2, 1.6, 1.3, { floor: true, opacity: 0.85 });
    this.decal(bloodTex('trail', 19), -7.7, -3.993, -6.2, 1.5, 2.0, 0.8, { floor: true, opacity: 0.75 });
    // every year a crew came down here - and a fresh one, unfinished
    this.decal(tallyTex(), -8.0, -2.1, -8.83, 0, 1.6, 0.8);
  }

  // SCENE 10 - original containment infrastructure: procedure plates + warning beacons at each switch
  buildSwitches(story) {
    const S = story.P.sw;
    this.placard(['EMERGENCY CONTAINMENT', 'STAGE 1 - FIELD SWITCH', 'Hold until the lamp turns green.'], S[0].pos.x - 0.75, S[0].pos.y - 0.25, S[0].pos.z - 0.02, PI, true);
    this.placard(['EMERGENCY CONTAINMENT', 'STAGE 2 - B-WING ISOLATION', 'Two keys. Turned together.'], S[1].pos.x - 0.02, S[1].pos.y - 0.25, (S[1].pos.z + S[1].pos2.z) / 2, -PI / 2, true);
    this.placard(['EMERGENCY CONTAINMENT', 'STAGE 3 - CHAMBER SEAL', 'Then purge. Then leave.'], S[2].pos.x + 0.02, S[2].pos.y - 0.25, S[2].pos.z + 0.75, PI / 2, true);
    story.beacons = [
      this.beacon(S[0].pos.x, S[0].pos.y + 0.95, S[0].pos.z - 0.12),
      this.beacon(S[1].pos.x - 0.12, S[1].pos.y + 0.95, (S[1].pos.z + S[1].pos2.z) / 2),
      this.beacon(S[2].pos.x + 0.12, S[2].pos.y + 0.95, S[2].pos.z),
    ];
  }

  // SCENE 5 - the fuse rooms escalate: ordinary -> evacuation -> restricted -> containment
  buildFuseAreas(story) {
    for (const f of story.state.fuses) {
      const [x, y, z] = f.pos, fy = Math.floor((y + 0.6) / 4) * 4;
      const ox = x + (x > 0 ? -0.9 : 0.9), oz = z + (z > 0 ? -0.9 : 0.9);
      if (f.n === 2) { this.put('mp_papers', ox, fy, oz, Math.random() * 6); this.put('mp_boxes', ox, fy, oz + (z > 0 ? -0.6 : 0.6), 0.3, { w: 1.0, d: 0.75, h: 0.62 }); }
      if (f.n === 3) { this.decal(scratchTex(51 + f.n), ox, fy + 1.3, z > 0 ? 8.835 : -8.835, z > 0 ? PI : 0, 0.8, 0.8); this.put('mp_papers', ox, fy, oz, 1.0); }
      if (f.n === 4) { this.put('mp_straps', ox, fy, oz, 0.7); this.decal(bloodTex('smear', 61), ox, fy + 0.006, oz, 0.4, 1.0, 0.8, { floor: true, opacity: 0.7 }); this.decal(scratchTex(67), ox, fy + 1.1, z > 0 ? 8.835 : -8.835, z > 0 ? PI : 0, 0.8, 0.8); }
    }
  }

  update(dt, t) {
    // the dying exit sign: mostly on, the odd stutter, now and then it gives up for a second
    if (this.exitGlow) {
      this.exitT -= dt;
      if (this.exitT <= 0) { this.exitT = 0.05 + Math.random() * (Math.random() < 0.1 ? 1.2 : 0.4); this.exitGlow.intensity = Math.random() < 0.12 ? 0 : 0.45 + Math.random() * 0.3; }
    }
    for (const b of this.beacons) {
      if (b.mode === 'spin') { b.a += dt * 7; b.light.intensity = 26; b.light.color.setHex(0xff3010); b.light.target.position.set(b.x + Math.cos(b.a) * 2, b.y - 0.8, b.z + Math.sin(b.a) * 2); for (const m of b.mats) { m.emissive.setHex(0xff2a08); m.emissiveIntensity = 2 + Math.sin(b.a * 2) * 0.8; } }
      else if (b.mode === 'done') { b.light.intensity = 6; b.light.color.setHex(0x30ff50); b.light.target.position.set(b.x, b.y - 2, b.z); for (const m of b.mats) { m.emissive.setHex(0x30ff40); m.emissiveIntensity = 1.6; m.color.setHex(0x0a4010); } }
      else { b.light.intensity = 0; for (const m of b.mats) m.emissiveIntensity = 0.15; }
    }
  }
}
