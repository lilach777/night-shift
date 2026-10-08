// Procedurally drawn old photographs for the finale's photo wall.
import * as THREE from 'three';
import { seededRandom } from '../core/util.js';

const FIRST = ['D.', 'R.', 'M.', 'T.', 'A.', 'J.', 'E.', 'S.', 'H.', 'L.', 'P.', 'K.', 'N.', 'C.', 'W.', 'G.'];
const LAST = ['KOWALSKI', 'OKAFOR', 'BRANDT', 'ELLISON', 'MORROW', 'HALLOWAY', 'REYES', 'VANCE', 'ADEYEMI', 'NOLAN', 'PETRIE', 'SOUZA', 'LINDQVIST', 'GRAY', 'CHO', 'MARSH', 'OYELARAN', 'DUBOIS', 'QUINN', 'HART', 'IBARRA', 'FENN', 'MOREAU', 'TALBOT'];
const ROLES = ['PATIENT', 'PATIENT', 'PATIENT', 'NURSE', 'DR.', 'SECURITY', 'SECURITY', 'ORDERLY', 'PATIENT', 'NIGHT SHIFT'];

function portrait(rnd, role, label, special = false) {
  const W = 192, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const tone = special ? [205, 200, 190] : [170 + rnd() * 40, 150 + rnd() * 30, 110 + rnd() * 30];
  // border
  g.fillStyle = `rgb(${tone[0] + 30},${tone[1] + 30},${tone[2] + 30})`; g.fillRect(0, 0, W, H);
  // photo area
  const px = 12, py = 12, pw = W - 24, ph = H - 64;
  const grd = g.createLinearGradient(0, py, 0, py + ph);
  grd.addColorStop(0, `rgb(${tone[0] * 0.75},${tone[1] * 0.72},${tone[2] * 0.66})`);
  grd.addColorStop(1, `rgb(${tone[0] * 0.45},${tone[1] * 0.42},${tone[2] * 0.38})`);
  g.fillStyle = grd; g.fillRect(px, py, pw, ph);
  g.save(); g.beginPath(); g.rect(px, py, pw, ph); g.clip();
  const cx = W / 2 + (rnd() - 0.5) * 14, hy = py + ph * 0.42;
  const dark = `rgba(${Math.floor(tone[0] * 0.18)},${Math.floor(tone[1] * 0.16)},${Math.floor(tone[2] * 0.14)},0.92)`;
  const mid = `rgba(${Math.floor(tone[0] * 0.5)},${Math.floor(tone[1] * 0.46)},${Math.floor(tone[2] * 0.4)},1)`;
  // shoulders
  g.fillStyle = role === 'PATIENT' ? mid : dark;
  g.beginPath(); g.ellipse(cx, py + ph + 10, 70, 58, 0, Math.PI, 0); g.fill();
  // neck + head
  g.fillStyle = `rgb(${tone[0] * 0.95},${tone[1] * 0.86},${tone[2] * 0.74})`;
  g.fillRect(cx - 13, hy + 30, 26, 30);
  g.beginPath(); g.ellipse(cx, hy, 30 + rnd() * 6, 38 + rnd() * 5, 0, 0, Math.PI * 2); g.fill();
  // hair
  g.fillStyle = dark;
  g.beginPath(); g.ellipse(cx, hy - 18, 32, 22, 0, Math.PI, 0); g.fill();
  if (rnd() < 0.4) { g.fillRect(cx - 32, hy - 18, 10, 40 + rnd() * 30); g.fillRect(cx + 22, hy - 18, 10, 40 + rnd() * 30); }
  // cap for security / night shift, nurse cap
  if (role === 'SECURITY' || role === 'NIGHT SHIFT' || special) {
    g.fillStyle = dark; g.fillRect(cx - 34, hy - 40, 68, 20); g.fillRect(cx - 40, hy - 22, 80, 6);
    g.fillStyle = `rgba(200,180,120,0.8)`; g.fillRect(cx - 6, hy - 36, 12, 10);
  } else if (role === 'NURSE') {
    g.fillStyle = `rgba(230,225,210,0.9)`; g.fillRect(cx - 24, hy - 44, 48, 14);
  }
  // eyes — dark hollows (time has not been kind to these prints)
  g.fillStyle = 'rgba(10,8,6,0.85)';
  g.beginPath(); g.ellipse(cx - 11, hy - 2, 5, 3.5, 0, 0, Math.PI * 2); g.ellipse(cx + 11, hy - 2, 5, 3.5, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(20,14,10,0.6)'; g.fillRect(cx - 9, hy + 18, 18, 2.5);
  if (role === 'DR.' || role === 'NURSE' || role === 'ORDERLY') { g.fillStyle = 'rgba(230,225,215,0.75)'; g.beginPath(); g.moveTo(cx - 60, py + ph); g.lineTo(cx - 12, hy + 56); g.lineTo(cx + 12, hy + 56); g.lineTo(cx + 60, py + ph); g.fill(); }
  // grain, scratches, water damage
  const id = g.getImageData(px, py, pw, ph);
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (rnd() - 0.5) * 40;
    id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n;
  }
  g.putImageData(id, px, py);
  g.strokeStyle = 'rgba(240,235,220,0.35)'; g.lineWidth = 1;
  for (let i = 0; i < 6; i++) { g.beginPath(); const x = px + rnd() * pw; g.moveTo(x, py); g.lineTo(x + (rnd() - 0.5) * 30, py + ph); g.stroke(); }
  const stain = g.createRadialGradient(px + rnd() * pw, py + rnd() * ph, 2, px + rnd() * pw, py + rnd() * ph, 60 + rnd() * 60);
  stain.addColorStop(0, 'rgba(90,60,20,0.35)'); stain.addColorStop(1, 'rgba(90,60,20,0)');
  g.fillStyle = stain; g.fillRect(px, py, pw, ph);
  if (special) { g.fillStyle = 'rgba(120,0,0,0.25)'; g.fillRect(px, py, pw, ph); }
  g.restore();
  // caption
  g.fillStyle = special ? '#3a0a0a' : '#2a2620';
  g.font = `${special ? 'bold ' : ''}14px "Special Elite", "Courier New", monospace`;
  g.textAlign = 'center';
  const lines = label.split('\n');
  lines.forEach((l, i) => g.fillText(l, W / 2, H - 34 + i * 17));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// featured: [{ name, role, date }] placed among the random faces (the night staff who never left);
// blankLabel: one slot with only a pin and a caption - no photograph yet.
export function buildPhotoWall(scene, layout, { seed = 213, featured = [], blankLabel = null } = {}) {
  const rnd = seededRandom(seed);
  const featuredAt = new Map([[1 * 7 + 1, 0], [0 * 7 + 5, 1], [3 * 7 + 0, 2], [4 * 7 + 4, 3], [2 * 7 + 6, 4]]);
  const group = new THREE.Group();
  const wall = layout.photoWall;
  const geo = new THREE.PlaneGeometry(0.26, 0.346);
  let armanMesh = null;
  const pin = new THREE.MeshStandardMaterial({ color: 0x701010, roughness: 0.4 });
  const pinGeo = new THREE.SphereGeometry(0.008, 6, 4);
  const make = (label, role, special, pos, rotY, tilt) => {
    const mat = new THREE.MeshStandardMaterial({ map: portrait(rnd, role, label, special), roughness: 0.75 });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos); m.rotation.set(0, rotY, tilt);
    group.add(m);
    const p = new THREE.Mesh(pinGeo, pin); p.position.set(0, 0.15, 0.006); m.add(p);
    return m;
  };
  const year = () => 1952 + Math.floor(rnd() * 70);
  const date = () => `${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}.${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}.${year()}`;
  // end wall grid (faces +x)
  const y0 = wall.y + 0.85;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) {
    const z = -1.2 + c * 0.4 + (rnd() - 0.5) * 0.05;
    const y = y0 + r * 0.42 + (rnd() - 0.5) * 0.05;
    const special = r === 2 && c === 3;
    if (special) {
      if (blankLabel) armanMesh = blankSlot(group, blankLabel, new THREE.Vector3(wall.x + 0.012, y, z), Math.PI / 2, pin, pinGeo);
      else armanMesh = make('ARMAN\nNIGHT SHIFT — 2:13 AM', 'NIGHT SHIFT', true, new THREE.Vector3(wall.x + 0.012, y, z), Math.PI / 2, (rnd() - 0.5) * 0.05);
      continue;
    }
    const fi = featuredAt.get(r * 7 + c);
    if (fi != null && featured[fi]) {
      const f = featured[fi];
      make(`${f.name}\n${f.role} — ${f.date}`, 'NIGHT SHIFT', false, new THREE.Vector3(wall.x + 0.011, y, z), Math.PI / 2, (rnd() - 0.5) * 0.12);
      continue;
    }
    const role = ROLES[Math.floor(rnd() * ROLES.length)];
    const name = `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`;
    make(`${name}\n${role === 'DR.' ? 'DOCTOR' : role} — ${date()}`, role, false, new THREE.Vector3(wall.x + 0.01 + rnd() * 0.004, y, z), Math.PI / 2, (rnd() - 0.5) * 0.18);
  }
  // spill onto the corridor side walls near the end
  for (const side of [-1, 1]) for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
    const x = wall.x + 0.5 + c * 0.42 + (rnd() - 0.5) * 0.05;
    const y = y0 + 0.2 + r * 0.42;
    const role = ROLES[Math.floor(rnd() * ROLES.length)];
    const name = `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`;
    const z = side * (1.5 - 0.09 - 0.012);
    make(`${name}\n${role === 'DR.' ? 'DOCTOR' : role} — ${date()}`, role, false, new THREE.Vector3(x, y, z), side > 0 ? Math.PI : 0, (rnd() - 0.5) * 0.18);
  }
  scene.add(group);
  return { group, arman: armanMesh };
}

// an empty place on the wall: the pin and a typed caption, a pale rectangle where a photo will go
function blankSlot(group, label, pos, rotY, pin, pinGeo) {
  const c = document.createElement('canvas'); c.width = 192; c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 192, 256);
  g.fillStyle = 'rgba(214,206,186,0.22)'; g.fillRect(12, 12, 168, 192);          // where the paint is less faded
  g.strokeStyle = 'rgba(60,50,40,0.35)'; g.setLineDash([5, 4]); g.strokeRect(12, 12, 168, 192);
  g.fillStyle = '#d7cfbd'; g.fillRect(28, 214, 136, 34);                          // a typed slip of paper
  g.fillStyle = '#2a2620'; g.font = '13px "Special Elite", "Courier New", monospace'; g.textAlign = 'center';
  label.split('\n').forEach((l, i) => g.fillText(l, 96, 229 + i * 14));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.346), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.8, depthWrite: false }));
  m.position.copy(pos); m.rotation.set(0, rotY, 0);
  const p = new THREE.Mesh(pinGeo, pin); p.position.set(0, 0.15, 0.006); m.add(p);
  group.add(m);
  return m;
}

// the five night guards in the single-player register (story.js) - the photo wall remembers them
export const NIGHT_STAFF = [
  { name: 'D. KOWALSKI', date: '14.03.1987' }, { name: 'R. OKAFOR', date: '02.11.1994' }, { name: 'M. BRANDT', date: '19.01.2003' },
  { name: 'T. ELLISON', date: '30.09.2011' }, { name: 'J. MORROW', date: '08.02.2019' },
];

// Small canvas posters for the lobby / corridors.
export function poster(lines, opts = {}) {
  const W = 256, H = 352;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = opts.bg || '#cfc8b4'; g.fillRect(0, 0, W, H);
  g.fillStyle = opts.band || '#2f5a52'; g.fillRect(0, 0, W, 64);
  g.fillStyle = '#e9e4d6'; g.font = 'bold 22px Arial, sans-serif'; g.textAlign = 'center';
  g.fillText(opts.header || 'ST. MERCY', W / 2, 42);
  g.fillStyle = '#26221d';
  lines.forEach((l, i) => { g.font = `${i === 0 ? 'bold 26' : '17'}px Arial, sans-serif`; g.fillText(l, W / 2, 120 + i * (i === 0 ? 46 : 30)); });
  // ageing
  for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(80,60,30,${Math.random() * 0.08})`; g.fillRect(Math.random() * W, Math.random() * H, 3, 3); }
  const st = g.createRadialGradient(W * Math.random(), H * Math.random(), 5, W / 2, H / 2, 260);
  st.addColorStop(0, 'rgba(100,70,30,0.35)'); st.addColorStop(1, 'rgba(100,70,30,0)');
  g.fillStyle = st; g.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.69), new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 }));
  m.receiveShadow = true;
  return m;
}
