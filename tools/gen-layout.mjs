// NIGHT SHIFT â€” St. Mercy Hospital layout generator.
// Single source of truth for the building. Consumed by:
//   - Blender build scripts (blender/scripts/*.py) to model the environment
//   - The browser game (src/data/layout.json) for collision, navigation, fuses, lights.
// Coordinates are three.js world space (Y up, metres).
// Run: node tools/gen-layout.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT_GAME = 'src/data/layout.json';
const OUT_BLENDER = 'blender/layout.json';

// ---------------------------------------------------------------------------
// Constants
export const B = { x0: -22, x1: 22, z0: -9, z1: 9 };
const CORR = 1.5;            // corridor half width
const CEIL = 3.2;            // ceiling height above floor
const FLOOR_H = 4;           // floor-to-floor height
const EXT_T = 0.3, INT_T = 0.18;
const STAIR = { x0: 17, xm: 19.5, x1: 22, zTop: -CORR, zLand: -6.5, zEnd: -9 };

const LEVELS = [
  { id: 'B', name: 'Basement', y: -4 },
  { id: '1', name: 'Floor 1', y: 0 },
  { id: '2', name: 'Floor 2', y: 4 },
  { id: '3', name: 'Floor 3', y: 8 },
  { id: '4', name: 'Floor 4', y: 12 },
];
const LY = Object.fromEntries(LEVELS.map(l => [l.id, l.y]));

// Prop catalogue: footprint (w along x, d along z at rot 0), height, collision.
// Blender builds each model to exactly these dimensions; origin = floor centre.
const CATALOG = {
  bed:            { w: 1.0, d: 2.1, h: 0.62, collide: true },
  bedside:        { w: 0.5, d: 0.45, h: 0.75, collide: true },
  desk:           { w: 1.4, d: 0.7, h: 0.76, collide: true },
  chair:          { w: 0.5, d: 0.5, h: 0.9, collide: false },
  office_chair:   { w: 0.6, d: 0.6, h: 1.0, collide: false },
  cabinet:        { w: 0.9, d: 0.45, h: 1.9, collide: true },
  shelf:          { w: 1.2, d: 0.45, h: 1.9, collide: true },
  iv_stand:       { w: 0.4, d: 0.4, h: 1.8, collide: false },
  monitor_cart:   { w: 0.55, d: 0.5, h: 1.35, collide: true },
  wheelchair:     { w: 0.65, d: 1.0, h: 0.95, collide: true },
  gurney:         { w: 0.7, d: 2.0, h: 0.85, collide: true },
  or_table:       { w: 0.7, d: 2.0, h: 0.95, collide: true },
  or_lamp:        { w: 1.2, d: 1.2, h: 0.9, collide: false, ceiling: true },
  lab_bench:      { w: 2.4, d: 0.8, h: 0.92, collide: true },
  morgue_table:   { w: 0.8, d: 2.1, h: 0.9, collide: true },
  morgue_fridge:  { w: 3.0, d: 0.9, h: 2.2, collide: true },
  crib:           { w: 0.7, d: 1.3, h: 1.0, collide: true },
  teddy:          { w: 0.3, d: 0.25, h: 0.35, collide: false },
  filing_cabinet: { w: 0.5, d: 0.65, h: 1.3, collide: true },
  records_shelf:  { w: 2.0, d: 0.5, h: 2.2, collide: true },
  reception_desk: { w: 4.4, d: 1.0, h: 1.1, collide: true },
  waiting_chairs: { w: 2.2, d: 0.6, h: 0.85, collide: true },
  power_panel:    { w: 2.4, d: 0.4, h: 2.1, collide: true },
  generator:      { w: 2.5, d: 1.4, h: 1.8, collide: true },
  electrical_box: { w: 0.8, d: 0.3, h: 1.2, collide: true },
  boiler:         { w: 1.6, d: 1.6, h: 2.6, collide: true },
  crates:         { w: 1.0, d: 1.0, h: 1.0, collide: true },
  cart:           { w: 0.9, d: 0.5, h: 0.95, collide: true },
  sink:           { w: 0.6, d: 0.5, h: 0.9, collide: true },
  debris:         { w: 1.6, d: 1.4, h: 0.35, collide: false },
  couch:          { w: 2.0, d: 0.85, h: 0.8, collide: true },
  vending:        { w: 1.0, d: 0.8, h: 1.9, collide: true },
  plant:          { w: 0.5, d: 0.5, h: 1.2, collide: true },
  lockers:        { w: 1.6, d: 0.5, h: 1.9, collide: true },
  workbench:      { w: 2.0, d: 0.8, h: 0.9, collide: true },
  washer:         { w: 0.7, d: 0.7, h: 0.95, collide: true },
  toy_blocks:     { w: 0.4, d: 0.4, h: 0.2, collide: false },
  rocking_horse:  { w: 0.35, d: 0.9, h: 0.7, collide: true },
  xray_box:       { w: 1.0, d: 0.1, h: 0.7, collide: false, wall: true },
  pipes_h:        { w: 6.0, d: 0.5, h: 0.4, collide: false, ceiling: true },
  // walk-in storage closet the player can hide in (hollow; colliders = back/sides/top + door)
  closet:         { w: 1.2, d: 0.95, h: 2.25, collide: 'closet' },
};
// Fuse placement rules: ONLY on table tops or inside accessible drawers.
const FUSE_TABLES = new Set(['desk', 'lab_bench', 'workbench', 'or_table']);
const FUSE_DRAWERS = { desk: 3, bedside: 1, filing_cabinet: 4 };

// Small deterministic RNG so the layout is stable between runs.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(2131987);
const rr = (a, b) => a + R() * (b - a);
const pick = a => a[Math.floor(R() * a.length)];
const r2 = v => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------
const rooms = [];
const props = [];
const doors = [];
const walls = [];
const lights = [];
const signs = [];
const decals = [];
const phones = [];
const speakers = [];
const batterySpots = [];
const windows = [];

function room(level, id, name, type, x0, x1, side, opts = {}) {
  const y = LY[level];
  const z0 = side === 'N' ? CORR : B.z0;
  const z1 = side === 'N' ? B.z1 : -CORR;
  const doorX = opts.doorX ?? (x0 + x1) / 2 + (opts.doorOff ?? 0);
  const r = {
    id, name, type, level, side, x0, x1, z0, z1, y,
    door: opts.noDoor ? null : { x: doorX, z: side === 'N' ? CORR : -CORR },
    fuseSpot: null, fuseEligible: opts.fuse !== false,
  };
  rooms.push(r);
  return r;
}

// Local placement helper. u = metres along x from room.x0, v = depth from the
// corridor wall. lr = local rotation (0 = front faces the corridor).
function place(r, type, u, v, lr = 0, extra = {}) {
  const sign = r.side === 'N' ? 1 : -1;
  const zNear = r.side === 'N' ? CORR : -CORR;
  const x = r.x0 + u, z = zNear + sign * v;
  const rot = r.side === 'N' ? Math.PI + lr : -lr;
  return addProp(type, x, r.y + (extra.dy ?? 0), z, rot, r.level, r.id, extra);
}
function addProp(type, x, y, z, rot, level, roomId, extra = {}) {
  const c = CATALOG[type];
  if (!c) throw new Error('unknown prop ' + type);
  const p = { id: props.length, type, x: r2(x), y: r2(y), z: r2(z), rot: r2(normRot(rot)), level, room: roomId };
  if (extra.variant) p.variant = extra.variant;
  if (extra.tilt) p.tilt = extra.tilt;
  props.push(p);
  return p;
}
function normRot(a) { a = a % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a; }
function topOf(p) { return p.y + CATALOG[p.type].h; }
// A visible, reachable resting surface on a prop: tall furniture uses a front-edge
// shelf board at ~1 m (never above eye level); cribs use the mattress.
function surfaceOf(p, du, dv) {
  const c = CATALOG[p.type];
  let y = topOf(p), fwd = 0;
  if (p.type === 'shelf') { y = p.y + 0.995 + 0.025; fwd = c.d / 2 - 0.12; }
  else if (p.type === 'records_shelf') { y = p.y + 0.02; fwd = c.d / 2 + 0.2; }   // binders fill the shelves: on the floor in front
  else if (p.type === 'cabinet') { y = p.y + 0.05 + 0.02; fwd = c.d / 2 + 0.18; }   // on the floor in front
  else if (p.type === 'crib') { y = p.y + 0.56; }
  // local forward (+z at rot 0) rotated into world space
  const fx = Math.sin(p.rot) * fwd, fz = Math.cos(p.rot) * fwd;
  return { x: r2(p.x + du + fx), y: r2(y + 0.02), z: r2(p.z + dv + fz) };
}
// (legacy hook kept so furnishers read naturally; fuse spots are collected from the
// room's tables/drawers after furnishing — see collectFuseSpots)
function fuseOn() {}

// Every table top and every drawer in an eligible room is a candidate fuse spot.
function collectFuseSpots(r) {
  const spots = [];
  if (!r.fuseEligible) return spots;
  for (const p of props.filter(q => q.room === r.id)) {
    const c = CATALOG[p.type];
    if (FUSE_TABLES.has(p.type)) {
      // a few positions spread across the top, kept clear of the edges
      for (const fu of [-0.3, 0.15]) {
        const u = fu * (c.w - 0.5), v = (R() - 0.5) * (c.d - 0.35);
        const x = p.x + Math.cos(p.rot) * u + Math.sin(p.rot) * v;
        const z = p.z - Math.sin(p.rot) * u + Math.cos(p.rot) * v;
        spots.push({ kind: 'top', prop: p.id, x: r2(x), y: r2(topOf(p) + 0.003), z: r2(z), rot: r2(R() * Math.PI) });
      }
    }
    const nd = FUSE_DRAWERS[p.type];
    if (nd) for (let i = 0; i < nd; i++) spots.push({ kind: 'drawer', prop: p.id, drawer: i, x: p.x, y: p.y, z: p.z });
  }
  return spots;
}
function batteryOn(r, p, du = 0, dv = 0) {
  batterySpots.push({ room: r.id, level: r.level, ...surfaceOf(p, du, dv) });
}
function roomLights(r, n = 1) {
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const w = r.x1 - r.x0;
  if (n === 1 || w < 8) lights.push({ level: r.level, room: r.id, x: r2(cx), y: r.y + CEIL - 0.04, z: r2(cz) });
  else for (let i = 0; i < n; i++) lights.push({ level: r.level, room: r.id, x: r2(r.x0 + w * (i + 0.5) / n), y: r.y + CEIL - 0.04, z: r2(cz) });
}

// ---------------------------------------------------------------------------
// Furnishing per room type
const W = r => r.x1 - r.x0;
const D = 7.5;

const furnish = {
  patient(r) {
    const bed = place(r, 'bed', W(r) * 0.5, D - 1.15, 0);
    const bs = place(r, 'bedside', W(r) * 0.5 + 0.85, D - 0.3, 0);
    place(r, 'iv_stand', W(r) * 0.5 - 0.8, D - 1.4);
    place(r, 'monitor_cart', W(r) * 0.5 - 0.9, D - 0.45, 0);
    place(r, 'chair', W(r) - 0.6, 2.4, Math.PI / 2 * 1.3);
    place(r, 'cabinet', 0.55, 3.2, -Math.PI / 2);
    if (R() < 0.5) place(r, 'wheelchair', W(r) - 0.8, 4.2, 0.4);
    place(r, 'closet', W(r) - 0.5, 5.6, Math.PI / 2);          // patient wardrobe (hiding place)
    fuseOn(r, bs, 0, 0);
    if (R() < 0.6) batteryOn(r, bed, 0.2, 0.3);
    roomLights(r);
  },
  ward(r) {
    const n = Math.max(2, Math.floor(W(r) / 2.4));
    let lastBs;
    for (let i = 0; i < n; i++) {
      const u = W(r) * (i + 0.5) / n;
      const b = place(r, R() < 0.2 ? 'gurney' : 'bed', u, D - 1.15, 0);
      if (R() < 0.25) b.tilt = r2(rr(-0.15, 0.15));
      if (i < n - 1) lastBs = place(r, 'bedside', u + 1.2, D - 0.3);
      if (R() < 0.5) place(r, 'iv_stand', u - 0.75, D - 1.6);
    }
    place(r, 'cart', W(r) - 0.6, 2.4, Math.PI / 2);
    place(r, 'closet', 0.5, 3.0, -Math.PI / 2);
    if (r.level === '4') for (let i = 0; i < 2; i++) place(r, 'debris', rr(1.5, W(r) - 1.5), rr(2, 4.5), rr(0, 6));
    if (lastBs) fuseOn(r, lastBs);
    roomLights(r, 2);
  },
  nurses(r) {
    const d = place(r, 'desk', W(r) * 0.4, 2.2, 0);
    const d2 = place(r, 'desk', W(r) * 0.4 + 1.45, 2.2, 0);
    place(r, 'office_chair', W(r) * 0.4, 3.0, Math.PI + 0.3);
    place(r, 'filing_cabinet', 0.4, D - 0.5, 0);
    place(r, 'filing_cabinet', 0.95, D - 0.5, 0);
    const s = place(r, 'shelf', W(r) - 0.8, D - 0.35, 0);
    place(r, 'cart', W(r) - 0.6, 3.5, Math.PI / 2);
    place(r, 'closet', 0.5, 4.2, -Math.PI / 2);
    phones.push({ id: 'phone_' + r.id, level: r.level, x: r2(d2.x + 0.3), y: r2(topOf(d2)), z: r2(d2.z), rot: d2.rot });
    fuseOn(r, d, -0.3, 0);
    batteryOn(r, s, 0, 0);
    roomLights(r);
  },
  storage(r) {
    const n = Math.max(2, Math.floor((W(r) - 1) / 1.3));
    let sh;
    for (let i = 0; i < n; i++) sh = place(r, 'shelf', 0.8 + i * 1.3, D - 0.3, 0);
    place(r, 'shelf', 0.3, 3.5, -Math.PI / 2);
    place(r, 'crates', W(r) - 0.8, 2.6, rr(-0.2, 0.2));
    if (R() < 0.6) place(r, 'crates', W(r) - 0.9, 4.0, rr(-0.3, 0.3));
    place(r, 'cart', W(r) * 0.5, 3.8, rr(0, 1));
    place(r, 'desk', 1.6, 2.2, 0);                              // storage table (with drawers)
    place(r, 'closet', W(r) - 0.5, 5.6, Math.PI / 2);
    fuseOn(r, sh, 0, 0);
    roomLights(r);
  },
  office(r) {
    const d = place(r, 'desk', W(r) * 0.5, D - 1.6, 0);
    place(r, 'office_chair', W(r) * 0.5, D - 0.9, Math.PI + rr(-0.6, 0.6));
    place(r, 'chair', W(r) * 0.5 - 0.5, D - 2.6, rr(-0.5, 0.5));
    place(r, 'filing_cabinet', 0.4, D - 0.5, 0);
    const c = place(r, 'cabinet', W(r) - 0.3, 3.0, Math.PI / 2);
    place(r, 'xray_box', 0.12, 3.2, -Math.PI / 2, { dy: 1.5 });
    place(r, 'plant', W(r) - 0.5, D - 0.5);
    place(r, 'closet', 0.5, 5.6, -Math.PI / 2);
    phones.push({ id: 'phone_' + r.id, level: r.level, x: r2(d.x + 0.45), y: r2(topOf(d)), z: r2(d.z), rot: d.rot });
    fuseOn(r, d, -0.35, 0);
    batteryOn(r, c, 0, 0);
    roomLights(r);
  },
  treatment(r) {
    const g = place(r, 'gurney', W(r) * 0.5, D - 1.6, 0);
    place(r, 'monitor_cart', W(r) * 0.5 + 0.9, D - 0.6);
    const s = place(r, 'sink', 0.4, 3.0, -Math.PI / 2);
    const c = place(r, 'cabinet', W(r) - 0.3, 2.6, Math.PI / 2);
    place(r, 'iv_stand', W(r) * 0.5 - 0.9, D - 1.0);
    place(r, 'cart', W(r) - 0.6, 4.6, Math.PI / 2);
    place(r, 'desk', W(r) * 0.25, 2.0, 0);                      // doctor's writing desk
    fuseOn(r, g, 0, 0.5);
    batteryOn(r, s, 0, 0);
    roomLights(r);
  },
  lab(r) {
    const b1 = place(r, 'lab_bench', W(r) * 0.3, D - 0.5, 0);
    place(r, 'lab_bench', W(r) * 0.72, D - 0.5, 0);
    const b3 = place(r, 'lab_bench', W(r) * 0.5, 3.6, 0);
    place(r, 'chair', W(r) * 0.5 - 0.5, 4.4, Math.PI + 0.3);
    place(r, 'shelf', 0.3, 2.5, -Math.PI / 2);
    place(r, 'cabinet', W(r) - 0.3, 2.4, Math.PI / 2);
    place(r, 'sink', W(r) - 0.35, 4.3, Math.PI / 2);
    fuseOn(r, b1, 0.6, 0);
    batteryOn(r, b3, -0.5, 0);
    roomLights(r, 2);
  },
  medstore(r) { furnish.storage(r); place(r, 'iv_stand', W(r) - 0.6, 5.2); },
  or(r) {
    const t = place(r, 'or_table', W(r) * 0.5, D * 0.55, 0);
    place(r, 'or_lamp', W(r) * 0.5, D * 0.55, 0, { dy: CEIL - 0.9 });
    place(r, 'monitor_cart', W(r) * 0.5 + 1.0, D * 0.55 + 0.6);
    const c = place(r, 'cart', W(r) * 0.5 - 1.2, D * 0.55, Math.PI / 2);
    place(r, 'cabinet', 0.3, D - 1.2, -Math.PI / 2);
    place(r, 'cabinet', W(r) - 0.3, D - 1.2, Math.PI / 2);
    place(r, 'iv_stand', W(r) * 0.5 + 0.9, D * 0.55 - 0.9);
    fuseOn(r, c, 0, 0);
    roomLights(r, 2);
  },
  scrub(r) {
    const s1 = place(r, 'sink', W(r) * 0.3, D - 0.35, 0);
    place(r, 'sink', W(r) * 0.6, D - 0.35, 0);
    place(r, 'lockers', 0.3, 3.5, -Math.PI / 2);
    const b = place(r, 'cart', W(r) - 0.6, 3.0, Math.PI / 2);
    fuseOn(r, b, 0, 0);
    batteryOn(r, s1, 0, 0);
    roomLights(r);
  },
  recovery(r) { furnish.ward(r); },
  restricted(r) {
    const s1 = place(r, 'shelf', 1.0, D - 0.3, 0);
    place(r, 'shelf', 2.3, D - 0.3, 0);
    place(r, 'gurney', W(r) * 0.6, 4.0, 0.8, { tilt: 0.2 });
    place(r, 'crates', W(r) - 1.0, D - 0.8);
    place(r, 'crates', W(r) - 1.2, 2.3, 0.4);
    place(r, 'debris', W(r) * 0.4, 2.5, 1.2);
    place(r, 'electrical_box', W(r) - 0.17, 4.2, Math.PI / 2, { dy: 0.8 });
    place(r, 'monitor_cart', 0.6, 2.8, 0.5);
    place(r, 'desk', W(r) * 0.4, 2.0, 0);
    fuseOn(r, s1, 0, 0);
    roomLights(r, 2);
  },
  sterile(r) {
    const b = place(r, 'lab_bench', W(r) * 0.5, D - 0.5, 0);
    place(r, 'cabinet', 0.3, 3.0, -Math.PI / 2);
    place(r, 'cart', W(r) - 0.7, 3.0, Math.PI / 2);
    place(r, 'sink', W(r) - 0.35, 5.0, Math.PI / 2);
    fuseOn(r, b, 0.6, 0);
    roomLights(r);
  },
  children(r) {
    const n = Math.max(3, Math.floor(W(r) / 1.6));
    let lastCrib;
    for (let i = 0; i < n; i++) {
      lastCrib = place(r, 'crib', W(r) * (i + 0.5) / n, D - 0.9, rr(-0.15, 0.15));
      if (R() < 0.35) lastCrib.tilt = r2(rr(-0.2, 0.2));
    }
    place(r, 'rocking_horse', W(r) * 0.3, 3.4, rr(0, 6));
    place(r, 'teddy', W(r) * 0.62, 3.0, rr(0, 6));
    place(r, 'teddy', W(r) * 0.8, 5.0, rr(0, 6));
    place(r, 'toy_blocks', W(r) * 0.45, 4.2, rr(0, 6));
    place(r, 'cabinet', 0.3, 3.0, -Math.PI / 2);
    place(r, 'debris', W(r) * 0.75, 2.6, 0.6);
    const sh = place(r, 'shelf', W(r) - 0.3, 3.0, Math.PI / 2);
    place(r, 'desk', W(r) - 1.6, 2.0, 0);                       // nurse's desk in the children's ward
    fuseOn(r, sh, 0, 0);
    batteryOn(r, lastCrib, 0, 0);
    roomLights(r, 2);
  },
  playroom(r) {
    place(r, 'rocking_horse', W(r) * 0.5, 4.0, 0.7);
    place(r, 'teddy', W(r) * 0.4, 5.6, 2);
    place(r, 'toy_blocks', W(r) * 0.6, 3.2, 1);
    place(r, 'toy_blocks', W(r) * 0.3, 2.6, 2);
    const d = place(r, 'desk', W(r) * 0.75, D - 0.5, 0);
    place(r, 'chair', W(r) * 0.75, D - 1.2, 0.3);
    place(r, 'couch', 1.2, D - 0.5, 0);
    place(r, 'debris', W(r) * 0.3, 4.4, 0.2);
    fuseOn(r, d, 0.3, 0);
    roomLights(r, 2);
  },
  records(r) {
    const n = Math.max(2, Math.floor((W(r) - 1) / 2.2));
    let s;
    for (let i = 0; i < n; i++) s = place(r, 'records_shelf', 1.3 + i * 2.2, D - 0.3, 0);
    for (let i = 0; i < n - 1; i++) place(r, 'records_shelf', 1.3 + i * 2.2, 3.6, Math.PI);
    place(r, 'filing_cabinet', 0.4, 2.2, -Math.PI / 2);
    const d = place(r, 'desk', W(r) - 1.0, 2.0, Math.PI / 2);
    place(r, 'debris', W(r) * 0.5, 2.3, 1);
    place(r, 'closet', W(r) - 0.5, 5.4, Math.PI / 2);
    fuseOn(r, d, 0, 0);
    batteryOn(r, s, 0.4, 0);
    roomLights(r, 2);
  },
  damaged(r) {
    const b = place(r, 'bed', W(r) * 0.35, D - 1.2, 0.35, { tilt: 0.25 });
    place(r, 'debris', W(r) * 0.6, 3.2, 1.0);
    place(r, 'debris', W(r) * 0.3, 2.2, 2.5);
    place(r, 'wheelchair', W(r) * 0.75, 4.6, 2.2);
    const c = place(r, 'cabinet', W(r) - 0.3, D - 1.4, Math.PI / 2);
    place(r, 'crates', 0.7, 3.2, 0.5);
    fuseOn(r, b, 0, 0.3);
    batteryOn(r, c, 0, 0);
    roomLights(r);
  },
  lounge(r) {
    place(r, 'couch', W(r) * 0.5, D - 0.5, 0);
    const d = place(r, 'desk', W(r) * 0.5, D - 2.2, 0);
    place(r, 'vending', W(r) - 0.6, 2.2, Math.PI / 2);
    place(r, 'lockers', 0.3, 3.4, -Math.PI / 2);
    place(r, 'plant', W(r) - 0.5, D - 0.5);
    place(r, 'chair', W(r) * 0.5 - 0.8, D - 3.0, 0.4);
    place(r, 'closet', W(r) - 0.5, 5.0, Math.PI / 2);
    fuseOn(r, d, 0.3, 0);
    batteryOn(r, d, -0.3, 0.1);
    roomLights(r);
  },
  restroom(r) {
    for (let i = 0; i < 3; i++) place(r, 'sink', 1.0 + i * 1.0, D - 0.35, 0);
    place(r, 'cart', W(r) - 0.8, 3.0, 0.5);
    r.fuseEligible = false;
    roomLights(r);
  },
  // ----- basement
  power(r) {
    const panel = place(r, 'power_panel', W(r) * 0.5, D - 0.25, 0);
    r.panel = { x: panel.x, y: panel.y, z: panel.z, rot: panel.rot };
    place(r, 'generator', 1.6, 3.6, Math.PI / 2);
    place(r, 'electrical_box', W(r) - 0.17, 3.0, Math.PI / 2, { dy: 0.6 });
    place(r, 'electrical_box', W(r) - 0.17, 4.2, Math.PI / 2, { dy: 0.6 });
    place(r, 'workbench', W(r) - 1.6, D - 0.5, 0);
    place(r, 'pipes_h', W(r) * 0.5, 1.0, Math.PI / 2, { dy: CEIL - 0.45 });
    phones.push({ id: 'phone_power', level: r.level, x: r2(r.x0 + 0.15), y: r.y + 1.45, z: r2(-CORR - 2.2), rot: Math.PI / 2, wall: true });
    r.fuseEligible = false;
    roomLights(r, 2);
  },
  electrical(r) {
    place(r, 'electrical_box', 0.17, 3.0, -Math.PI / 2, { dy: 0.6 });
    place(r, 'electrical_box', 0.17, 4.4, -Math.PI / 2, { dy: 0.6 });
    place(r, 'generator', W(r) * 0.5, D - 1.0, 0);
    const wb = place(r, 'workbench', W(r) - 0.45, 3.5, Math.PI / 2);
    place(r, 'crates', 1.0, D - 0.7);
    fuseOn(r, wb, 0, 0);
    roomLights(r);
  },
  maintenance(r) {
    const wb = place(r, 'workbench', W(r) * 0.5, D - 0.45, 0);
    place(r, 'shelf', 0.3, 3.0, -Math.PI / 2);
    place(r, 'lockers', W(r) - 0.3, 3.0, Math.PI / 2);
    place(r, 'crates', 1.0, D - 1.4, 0.2);
    place(r, 'cart', W(r) * 0.4, 3.4, 1.2);
    place(r, 'closet', 0.5, 4.6, -Math.PI / 2);
    fuseOn(r, wb, 0.5, 0);
    batteryOn(r, wb, -0.6, 0);
    roomLights(r);
  },
  boiler(r) {
    place(r, 'boiler', W(r) * 0.3, D - 1.2);
    place(r, 'boiler', W(r) * 0.65, D - 1.2);
    place(r, 'pipes_h', W(r) * 0.5, 2.0, 0, { dy: CEIL - 0.5 });
    place(r, 'pipes_h', W(r) * 0.5, 4.0, 0, { dy: CEIL - 0.8 });
    const s = place(r, 'shelf', W(r) - 0.3, 2.6, Math.PI / 2);
    place(r, 'workbench', 1.5, 2.0, 0);
    fuseOn(r, s, 0, 0);
    roomLights(r, 2);
  },
  laundry(r) {
    for (let i = 0; i < 4; i++) place(r, 'washer', 0.8 + i * 0.8, D - 0.4, 0);
    const c = place(r, 'cart', W(r) * 0.6, 3.4, 0.6);
    place(r, 'shelf', W(r) - 0.3, 3.0, Math.PI / 2);
    place(r, 'crates', W(r) - 1.0, D - 0.7);
    fuseOn(r, c, 0, 0);
    roomLights(r);
  },
  bstorage(r) { furnish.storage(r); },
  morgue(r) {
    // Fridge wall on the facade side, steel tables, blood (decals), key on desk.
    place(r, 'morgue_fridge', W(r) * 0.5, D - 0.45, 0);
    const t1 = place(r, 'morgue_table', W(r) * 0.3, 3.4, 0);
    place(r, 'morgue_table', W(r) * 0.68, 3.6, 0.25, { tilt: 0.06 });
    place(r, 'gurney', W(r) - 0.7, 2.3, Math.PI / 2 + 0.3, { tilt: 0.15 });
    const d = place(r, 'desk', 0.75, 2.3, -Math.PI / 2);
    place(r, 'cabinet', 0.3, 5.3, -Math.PI / 2);
    place(r, 'sink', W(r) - 0.35, 4.9, Math.PI / 2);
    place(r, 'iv_stand', W(r) * 0.5, 2.2);
    r.keySpot = { x: r2(d.x), y: r2(topOf(d) + 0.01), z: r2(d.z + 0.15) };
    // emergence spot: open floor in full view of the key desk, well away from the exit
    r.koalaSpot = { x: r2(r.x0 + W(r) * 0.6), y: r.y, z: r2(-CORR - 5.8) };
    r.fuseEligible = false;
    for (let i = 0; i < 7; i++) decals.push({ kind: 'blood', level: r.level, x: r2(rr(r.x0 + 1, r.x1 - 1)), y: r.y + 0.012, z: r2(rr(-8, -2.5)), rot: r2(rr(0, 6.28)), s: r2(rr(0.6, 1.6)), surface: 'floor' });
    decals.push({ kind: 'blood_trail', level: r.level, x: r2(t1.x + 0.3), y: r.y + 0.013, z: r2(-CORR - 1.6), rot: 0.3, s: 2.5, surface: 'floor' });
    roomLights(r, 2);
  },
};

// ---------------------------------------------------------------------------
// Building definition
const plan = {
  B: {
    N: [['maintenance', 'Maintenance', -22, -10, 'B01'], ['boiler', 'Boiler Room', -10, 2, 'B02'], ['laundry', 'Laundry', 2, 10, 'B03'], ['maintenance', 'Workshop', 10, 17, 'B04']],
    S: [['power', 'Power Room', -22, -12, 'B10', { doorX: -17 }], ['electrical', 'Electrical', -12, -4, 'B11'], ['bstorage', 'Storage', -4, 8, 'B12'], ['morgue', 'Morgue', 8, 17, 'B13', { doorX: 14.6 }]],
  },
  1: {
    N: [['patient', 'Patient Room 101', -10, -3, '101'], ['patient', 'Patient Room 102', -3, 4, '102'], ['nurses', "Nurses' Station", 4, 11, '103'], ['storage', 'Storage', 11, 17, '104']],
    S: [['patient', 'Patient Room 105', -10, -3, '105'], ['lounge', 'Staff Lounge', -3, 4, '106'], ['storage', 'Supply Storage', 4, 11, '107'], ['restroom', 'Restroom', 11, 17, '108']],
  },
  2: {
    N: [['ward', 'Ward 201', -22, -12, '201'], ['treatment', 'Treatment 202', -12, -4, '202'], ['office', 'Dr. Halloway', -4, 3, '203'], ['office', 'Dr. Reyes', 3, 10, '204'], ['medstore', 'Medical Storage', 10, 17, '205']],
    S: [['ward', 'Ward 206', -22, -12, '206'], ['lab', 'Laboratory', -12, -1, '207'], ['treatment', 'Treatment 208', -1, 6, '208'], ['nurses', "Nurses' Station", 6, 17, '209']],
  },
  3: {
    N: [['or', 'Operating Room 1', -22, -12, '301'], ['scrub', 'Scrub Room', -12, -6, '302'], ['or', 'Operating Room 2', -6, 4, '303'], ['recovery', 'Recovery', 4, 11, '304'], ['restricted', 'Restricted Storage', 11, 17, '305']],
    S: [['or', 'Surgical Suite', -22, -12, '306'], ['sterile', 'Sterilization', -12, -4, '307'], ['medstore', 'Medical Storage', -4, 4, '308'], ['restricted', 'Restricted Area', 4, 17, '309']],
  },
  4: {
    N: [['ward', 'Old Ward 401', -22, -10, '401'], ['children', "Children's Ward", -10, 2, '402'], ['damaged', 'Room 403', 2, 10, '403'], ['records', 'Records', 10, 17, '404']],
    S: [['records', 'Records Archive', -22, -12, '405'], ['damaged', 'Damaged Ward', -12, -2, '406'], ['playroom', 'Playroom', -2, 8, '407'], ['office', 'Old Office', 8, 17, '408']],
  },
};

for (const [lvl, sides] of Object.entries(plan)) {
  for (const side of ['N', 'S']) {
    for (const [type, name, x0, x1, id, opts] of sides[side]) {
      const r = room(lvl, id, name, type, x0, x1, side, opts);
      furnish[type](r);
    }
  }
}

// Lobby (Floor 1 west half) â€” special.
const lobby = { id: 'lobby', name: 'Reception', type: 'lobby', level: '1', side: 'X', x0: -22, x1: -10, z0: -9, z1: 9, y: 0, door: null, fuseEligible: false };
rooms.push(lobby);
const reception = {
  desk: addProp('reception_desk', -16.2, 0, -4.2, 0, '1', 'lobby'),
};
reception.chair = { x: -16.6, y: 0, z: -5.15, yaw: 0 };   // seated looks toward +z
reception.drawer = { x: -16.6, y: 0.78, z: -4.55 };
reception.phone = { x: -15.2, y: 1.1, z: -4.15 };
reception.computer = { x: -16.9, y: 1.1, z: -4.2 };
reception.register = { x: -17.9, y: 1.1, z: -3.95 };
reception.clock = { x: -12.6, y: 2.55, z: -8.83 };
phones.push({ id: 'phone_reception', level: '1', x: reception.phone.x, y: reception.phone.y, z: reception.phone.z, rot: 0, reception: true });
addProp('office_chair', reception.chair.x, 0, reception.chair.z, 0, '1', 'lobby');
addProp('filing_cabinet', -20.2, 0, -8.5, 0, '1', 'lobby');
addProp('filing_cabinet', -19.6, 0, -8.5, 0, '1', 'lobby');
addProp('cabinet', -13.0, 0, -8.6, 0, '1', 'lobby');
addProp('shelf', -11.0, 0, -8.6, 0, '1', 'lobby');
for (let i = 0; i < 3; i++) {
  addProp('waiting_chairs', -19.2 + i * 3.0, 0, 4.0, 0, '1', 'lobby');
  addProp('waiting_chairs', -19.2 + i * 3.0, 0, 6.0, Math.PI, '1', 'lobby');
}
addProp('vending', -11.0, 0, 8.4, Math.PI, '1', 'lobby');
addProp('plant', -21.4, 0, 8.4, 0, '1', 'lobby');
addProp('plant', -21.4, 0, -2.6, 0, '1', 'lobby');
addProp('plant', -21.4, 0, 2.6, 0, '1', 'lobby');
addProp('wheelchair', -12.2, 0, 2.6, 2.4, '1', 'lobby');
addProp('couch', -12.0, 0, 6.2, -Math.PI / 2, '1', 'lobby');
for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) lights.push({ level: '1', room: 'lobby', x: -20 + i * 4, y: CEIL - 0.04, z: -6 + j * 6 });

// ---------------------------------------------------------------------------
// Corridors, stair and elevator zones
const corridors = [];
for (const L of LEVELS) {
  const x0 = L.id === '1' ? -10 : B.x0;
  corridors.push({ level: L.id, x0, x1: B.x1, z0: -CORR, z1: CORR, y: L.y });
  for (let x = x0 + 2.5; x < 21; x += 5) lights.push({ level: L.id, room: 'corridor', x: r2(x), y: L.y + CEIL - 0.04, z: 0 });
  // PA speakers
  speakers.push({ level: L.id, x: x0 + 6, y: L.y + CEIL - 0.1, z: 0 });
  speakers.push({ level: L.id, x: 12, y: L.y + CEIL - 0.1, z: 0 });
}
// Stair lights (landing)
for (const L of LEVELS.slice(0, 4)) lights.push({ level: L.id, room: 'stair', x: 19.5, y: L.y + 2 + CEIL - 0.3, z: -7.8 });

// Stairs: flight A goes up (south) from level y, landing, flight B returns north to y+4.
const stairs = [];
for (const L of LEVELS.slice(0, 4)) {
  stairs.push({
    level: L.id, y: L.y,
    flightA: { x0: STAIR.x0, x1: STAIR.xm, z0: STAIR.zLand, z1: STAIR.zTop, yLow: L.y, yHigh: L.y + 2, lowAt: 'z1' },
    landing: { x0: STAIR.x0, x1: STAIR.x1, z0: STAIR.zEnd, z1: STAIR.zLand, y: L.y + 2 },
    flightB: { x0: STAIR.xm, x1: STAIR.x1, z0: STAIR.zLand, z1: STAIR.zTop, yLow: L.y + 2, yHigh: L.y + 4, lowAt: 'z0' },
  });
}

// ---------------------------------------------------------------------------
// Walls. Each wall: axis 'x' => runs along x at fixed z; 'z' => runs along z at fixed x.
// openings: doors (full to 2.2m) and windows.
function wall(level, axis, c, a, b, opts = {}) {
  const y = LY[level];
  const w = { level, axis, c: r2(c), a: r2(Math.min(a, b)), b: r2(Math.max(a, b)), y0: y, y1: y + (opts.h ?? CEIL), t: opts.t ?? INT_T, ext: !!opts.ext, kind: opts.kind ?? 'int', openings: [] };
  walls.push(w);
  return w;
}
const wallsByKey = {};

for (const L of LEVELS) {
  const lv = L.id, y = L.y;
  const isB = lv === 'B';
  const h = FLOOR_H; // exterior walls run full storey height
  // Exterior
  const north = wall(lv, 'x', B.z1, B.x0, B.x1, { ext: true, t: EXT_T, h, kind: 'ext' });
  const south = wall(lv, 'x', B.z0, B.x0, B.x1, { ext: true, t: EXT_T, h, kind: 'ext' });
  const west = wall(lv, 'z', B.x0, B.z0, B.z1, { ext: true, t: EXT_T, h, kind: 'ext' });
  const east = wall(lv, 'z', B.x1, B.z0, B.z1, { ext: true, t: EXT_T, h, kind: 'ext' });
  wallsByKey[lv] = { north, south, west, east };
  // Corridor walls
  const cx0 = lv === '1' ? -10 : B.x0;
  const cn = wall(lv, 'x', CORR, cx0, STAIR.x0);
  const cs = wall(lv, 'x', -CORR, cx0, STAIR.x0);
  // Elevator lobby back wall + its west separator
  const elev = wall(lv, 'x', 4.5, STAIR.x0, B.x1);
  elev.elevator = { x: 19.5 };
  wall(lv, 'z', STAIR.x0, CORR, B.z1);       // separator last north room / elevator
  wall(lv, 'z', STAIR.x0, B.z0, -CORR);      // stairwell west wall
  // (no full-height stair spine: each flight has its own waist-high balustrade along the
  //  inner edge x = STAIR.xm, generated from layout.stairs in Blender and physics, so the
  //  stairwell stays open and both flights are visible)
  if (lv === '4') wall(lv, 'x', -CORR, STAIR.x0, STAIR.xm, { h: 1.05, t: 0.08, kind: 'rail' });
  if (lv === 'B') {
    // Block the void under flight B (it is above the basement floor).
    wall(lv, 'x', -CORR, STAIR.xm, B.x1, { h: 1.9, t: 0.25, kind: 'int' });
  }
  // Room separators and door openings
  const lvRooms = rooms.filter(r => r.level === lv && r.side !== 'X');
  for (const side of ['N', 'S']) {
    const rs = lvRooms.filter(r => r.side === side).sort((a, b) => a.x0 - b.x0);
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i];
      if (r.x0 > (lv === '1' ? -10 : B.x0) - 0.01 && (i > 0 || lv === '1')) {
        const zA = side === 'N' ? CORR : B.z0, zB = side === 'N' ? B.z1 : -CORR;
        wall(lv, 'z', r.x0, zA, zB);
      }
      if (r.door) {
        const cw = side === 'N' ? cn : cs;
        cw.openings.push({ type: 'door', at: r.door.x, w: 1.2, y0: 0, y1: 2.2, room: r.id });
        const isPower = r.type === 'power';
        const isMorgue = r.type === 'morgue';
        doors.push({
          id: 'door_' + r.id, room: r.id, level: lv, x: r.door.x, y, z: r.door.z,
          axis: 'x', side, w: 1.1, h: 2.15,
          // swing into the room
          state: isMorgue ? 'ajar' : (isPower ? 'closed' : pick(['open', 'open', 'closed', 'ajar', 'closed'])),
          locked: isPower ? 'key_maintenance' : null,
          kind: isPower ? 'metal' : (isMorgue ? 'metal' : 'wood'),
        });
      }
      // Windows on facade
      if (!isB) {
        const fw = side === 'N' ? north : south;
        const w = r.x1 - r.x0;
        const n = Math.max(1, Math.round(w / 4));
        for (let k = 0; k < n; k++) {
          const at = r.x0 + w * (k + 0.5) / n;
          fw.openings.push({ type: 'window', at: r2(at), w: 1.5, y0: 1.0, y1: 2.5 });
          windows.push({ level: lv, axis: 'x', c: fw.c, at: r2(at), w: 1.5, y0: y + 1.0, y1: y + 2.5, room: r.id });
        }
      }
    }
  }
  // West end corridor window (upper floors) â€” lightning silhouettes.
  if (!isB && lv !== '1') {
    west.openings.push({ type: 'window', at: 0, w: 1.6, y0: 0.9, y1: 2.7 });
    windows.push({ level: lv, axis: 'z', c: B.x0, at: 0, w: 1.6, y0: y + 0.9, y1: y + 2.7, room: 'corridor' });
  }
  // East end: stairwell window on landings.
  if (!isB) {
    east.openings.push({ type: 'window', at: -7.75, w: 1.2, y0: 2.6, y1: 3.8 });
    // stairwell landing window: lets moonlight/lightning onto the stairs
    windows.push({ level: lv, axis: 'z', c: B.x1, at: -7.75, w: 1.2, y0: y + 2.6, y1: y + 3.8, room: 'stair' });
  }
}
// Lobby walls: east wall of lobby with corridor opening (north/south of corridor already handled by room separators at x=-10)
{
  const w1 = wallsByKey['1'];
  // Main entrance
  w1.west.openings.push({ type: 'entrance', at: 0, w: 2.6, y0: 0, y1: 2.6 });
  for (const at of [-6.5, -3.6, 3.6, 6.5]) {
    w1.west.openings.push({ type: 'window', at, w: 1.8, y0: 0.9, y1: 2.6 });
    windows.push({ level: '1', axis: 'z', c: B.x0, at, w: 1.8, y0: 0.9, y1: 2.6, room: 'lobby' });
  }
  for (const at of [-19, -15.5, -12.5]) {
    w1.north.openings.push({ type: 'window', at, w: 1.8, y0: 0.9, y1: 2.6 });
    windows.push({ level: '1', axis: 'x', c: B.z1, at, w: 1.8, y0: 0.9, y1: 2.6, room: 'lobby' });
  }
  for (const at of [-20.5, -12.5]) {
    w1.south.openings.push({ type: 'window', at, w: 1.6, y0: 1.2, y1: 2.6 });
    windows.push({ level: '1', axis: 'x', c: B.z0, at, w: 1.6, y0: 1.2, y1: 2.6, room: 'lobby' });
  }
}

// Main entrance (double glass doors) â€” locked until the ending.
const entrance = { level: '1', x: B.x0, y: 0, z: 0, w: 2.6, h: 2.6, locked: true };

// Act II rooms (after the power is restored). Renamed only (furnishing is unchanged so the
// rest of the generated hospital stays identical); story props are placed by the game.
const ACT2 = {
  '408': 'Security Office',     // CCTV, the containment report
  '403': 'Control Room',        // emergency switch 1 (floor 4)
  '309': 'Electrical Room',     // emergency switch 2 (floor 3)
  'B11': 'Containment',         // emergency switch 3 + the containment chamber
};
for (const r of rooms) if (ACT2[r.id]) r.name = ACT2[r.id];// ---------------------------------------------------------------------------
// Signs (modelled in Blender as text meshes on boards)
for (const r of rooms) {
  if (!r.door) continue;
  const off = r.side === 'N' ? -0.11 : 0.11;
  signs.push({ text: r.id.startsWith('B') ? r.name.toUpperCase() : `${r.id}  ${r.name.toUpperCase()}`, level: r.level, x: r2(r.door.x + 1.25), y: r.y + 1.65, z: r2(r.door.z + off), rot: r.side === 'N' ? Math.PI : 0, size: 'small' });
}
for (const L of LEVELS) {
  signs.push({ text: L.id === 'B' ? 'BASEMENT' : `FLOOR ${L.id}`, level: L.id, x: 15.6, y: L.y + 2.35, z: -1.385, rot: 0, size: 'large' });
  signs.push({ text: 'STAIRS', level: L.id, x: 19.5, y: L.y + 2.7, z: -1.4, rot: 0, size: 'medium', hang: true });
}
signs.push({ text: 'RECEPTION', level: '1', x: -16.2, y: 2.35, z: -8.82, rot: 0, size: 'large' });
signs.push({ text: 'ST. MERCY HOSPITAL', level: '1', x: -22.4, y: 3.85, z: 0, rot: -Math.PI / 2, size: 'facade' });
signs.push({ text: 'POWER ROOM - BASEMENT', level: '1', x: 13.4, y: 1.75, z: -1.385, rot: 0, size: 'small', arrow: true });
signs.push({ text: 'AUTHORIZED PERSONNEL ONLY', level: '3', x: 10.5, y: 2.45, z: -1.385, rot: 0, size: 'small' });
signs.push({ text: 'MORGUE', level: 'B', x: 14.6, y: 2.55, z: -1.385, rot: 0, size: 'medium' });

// Warning sign in the power room (revealed when power is restored)
const powerRoom = rooms.find(r => r.type === 'power');
const warningSign = { x: powerRoom.x0 + 1.2, y: powerRoom.y + 1.7, z: B.z0 + 0.17, rot: 0 };

// Photo wall (finale) â€” west end of basement corridor.
const photoWall = { level: 'B', x: B.x0 + 0.17, y: -4, z0: -1.4, z1: 1.4, rot: Math.PI / 2 };

// Generic decals (blood, grime, handprints) sprinkled through the building.
for (const L of LEVELS) {
  const n = L.id === '4' ? 18 : L.id === 'B' ? 14 : 8;
  for (let i = 0; i < n; i++) {
    const r = pick(rooms.filter(r => r.level === L.id));
    decals.push({ kind: pick(['grime', 'grime', 'stain', 'blood']), level: L.id, x: r2(rr(r.x0 + 0.8, r.x1 - 0.8)), y: L.y + 0.011 + i * 0.0003, z: r2(rr(r.z0 + 0.8, r.z1 - 0.8)), rot: r2(rr(0, 6.28)), s: r2(rr(0.8, 2.2)), surface: 'floor' });
  }
  for (let i = 0; i < 6; i++) {
    const cx = rr(L.id === '1' ? -9 : -21, 16);
    decals.push({ kind: pick(['grime', 'stain', 'water']), level: L.id, x: r2(cx), y: L.y + 0.011 + i * 0.0003, z: r2(rr(-1, 1)), rot: r2(rr(0, 6.28)), s: r2(rr(1, 2.4)), surface: 'floor' });
  }
}

// ---------------------------------------------------------------------------
// Navigation graph for the Koala
const nav = { nodes: [], edges: [] };
function node(level, x, z, tag) {
  const y = LY[level];
  nav.nodes.push({ id: nav.nodes.length, level, x: r2(x), y, z: r2(z), tag: tag ?? null });
  return nav.nodes.length - 1;
}
function nodeY(level, x, y, z, tag) {
  nav.nodes.push({ id: nav.nodes.length, level, x: r2(x), y: r2(y), z: r2(z), tag: tag ?? null });
  return nav.nodes.length - 1;
}
const edge = (a, b) => nav.edges.push([a, b]);
const corrNodes = {};
for (const L of LEVELS) {
  const c = corridors.find(c => c.level === L.id);
  const xs = new Set();
  for (let x = c.x0 + 1.2; x <= 21; x += 3) xs.add(r2(x));
  for (const r of rooms.filter(r => r.level === L.id && r.door)) xs.add(r2(r.door.x));
  xs.add(18.25); xs.add(20.75); xs.add(19.5);
  const sorted = [...xs].sort((a, b) => a - b);
  const ids = sorted.map(x => node(L.id, x, 0, 'corridor'));
  for (let i = 1; i < ids.length; i++) edge(ids[i - 1], ids[i]);
  corrNodes[L.id] = sorted.map((x, i) => ({ x, id: ids[i] }));
  // Rooms
  for (const r of rooms.filter(r => r.level === L.id && r.door)) {
    const cid = corrNodes[L.id].find(n => n.x === r2(r.door.x)).id;
    const sign = r.side === 'N' ? 1 : -1;
    const th = node(L.id, r.door.x, r.door.z + sign * 0.8, 'door:' + r.id);
    const mid = node(L.id, r.door.x, r.door.z + sign * 2.6, 'room:' + r.id);
    edge(cid, th); edge(th, mid);
    // two more points inside larger rooms
    const w = r.x1 - r.x0;
    if (w >= 7) {
      const a = node(L.id, r.x0 + w * 0.25, r.door.z + sign * 3.0, 'room:' + r.id);
      const b2 = node(L.id, r.x1 - w * 0.25, r.door.z + sign * 3.0, 'room:' + r.id);
      edge(mid, a); edge(mid, b2);
    }
  }
}
// Lobby grid
{
  const lobbyIds = [];
  for (const x of [-20.5, -17, -13.5, -11]) for (const z of [-1.5, 1.5]) lobbyIds.push(node('1', x, z, 'room:lobby'));
  for (let i = 0; i < lobbyIds.length; i++) for (let j = i + 1; j < lobbyIds.length; j++) {
    const a = nav.nodes[lobbyIds[i]], b = nav.nodes[lobbyIds[j]];
    if (Math.hypot(a.x - b.x, a.z - b.z) < 4.2) edge(lobbyIds[i], lobbyIds[j]);
  }
  const first = corrNodes['1'][0].id;
  const near = lobbyIds.filter(id => nav.nodes[id].x === -11);
  for (const id of near) edge(first, id);
}
// Stairs
for (const s of stairs) {
  const lv = s.level;
  const up = LEVELS[LEVELS.findIndex(l => l.id === lv) + 1].id;
  const bottom = corrNodes[lv].find(n => n.x === 18.25).id;
  const aMid = nodeY(lv, 18.25, s.y + 1, -4, 'stair');
  const land = nodeY(lv, 19.5, s.y + 2, -7.75, 'stair');
  const bMid = nodeY(lv, 20.75, s.y + 3, -4, 'stair');
  const top = corrNodes[up].find(n => n.x === 20.75).id;
  edge(bottom, aMid); edge(aMid, land); edge(land, bMid); edge(bMid, top);
}

// ---------------------------------------------------------------------------

// The back of the containment room is the chamber behind a glass partition (z < -5.6):
// keep it clear of the old electrical-room furniture.
const CHAMBER = { room: 'B11', zGlass: -5.6 };
for (let i = props.length - 1; i >= 0; i--) {
  const p = props[i];
  if (p.room === CHAMBER.room && p.z < CHAMBER.zGlass + 0.4) props.splice(i, 1);
}
for (let i = batterySpots.length - 1; i >= 0; i--) {
  const s = batterySpots[i];
  if (s.room === CHAMBER.room && s.z < CHAMBER.zGlass + 0.4) batterySpots.splice(i, 1);
}

// ---------------------------------------------------------------------------
// Fuse candidate locations â€” every eligible room with a spot is a location.
// A room is a fuse location if it has at least one table top or drawer.
const fuseLocations = rooms
  .map(r => ({ r, spots: collectFuseSpots(r) }))
  .filter(({ spots }) => spots.length)
  .map(({ r, spots }) => ({ room: r.id, name: r.name, level: r.level, spots }));

// Hiding closets (for the Koala AI to investigate): front position + facing.
const closets = props.filter(p => p.type === 'closet').map(p => ({
  prop: p.id, room: p.room, level: p.level, x: p.x, y: p.y, z: p.z, rot: p.rot,
  front: { x: r2(p.x + Math.sin(p.rot) * 1.05), z: r2(p.z + Math.cos(p.rot) * 1.05) },
}));

const morgue = rooms.find(r => r.type === 'morgue');
// Red emergency lights (finale) — wall-mounted on the basement corridor + power room.
const emergencyLights = [
  ...[-19, -10, 0, 9, 16].map((x, i) => ({ level: 'B', x, y: -4 + 2.7, z: i % 2 ? -1.38 : 1.38, face: i % 2 ? 0 : Math.PI })),
  { level: 'B', x: -14.5, y: -4 + 2.7, z: -8.82, face: 0 },
  ...['1', '2', '3', '4'].map(l => ({ level: l, x: 16.4, y: LY[l] + 2.85, z: 1.38, face: Math.PI })),
];
const layout = {
  version: 3,
  constants: { CORR, CEIL, FLOOR_H, EXT_T, INT_T },
  bounds: B,
  levels: LEVELS,
  catalog: CATALOG,
  rooms: rooms.map(r => ({ ...r })),
  corridors, stairs, walls, doors, windows, props, lights, signs, decals, phones, speakers, emergencyLights,
  entrance,
  reception,
  powerRoom: { id: powerRoom.id, x0: powerRoom.x0, x1: powerRoom.x1, z0: powerRoom.z0, z1: powerRoom.z1, y: powerRoom.y, panel: powerRoom.panel, door: powerRoom.door },
  morgue: { id: morgue.id, x0: morgue.x0, x1: morgue.x1, z0: morgue.z0, z1: morgue.z1, y: morgue.y, door: morgue.door, keySpot: morgue.keySpot, koalaSpot: morgue.koalaSpot },
  warningSign, photoWall,
  fuseLocations, batterySpots, closets,
  nav,
  exterior: {
    ground: { x0: -90, x1: 60, z0: -60, z1: 60, y: -0.02 },
    carPark: { x: -36, z: 5, rot: Math.PI / 2 },
    carPath: [[-95, 30], [-62, 30], [-58, 22], [-50, 9], [-40, 5.5], [-36, 5]],
    playerStart: { x: -20.6, y: 0, z: 0, yaw: -Math.PI / 2 },
    endingStand: { x: -28.5, z: 0 },
  },
};

mkdirSync('src/data', { recursive: true });
mkdirSync('blender', { recursive: true });
const json = JSON.stringify(layout);
writeFileSync(OUT_GAME, json);
writeFileSync(OUT_BLENDER, JSON.stringify(layout, null, 1));
console.log(`layout: ${rooms.length} rooms, ${props.length} props, ${walls.length} walls, ${doors.length} doors, ${lights.length} lights, ${fuseLocations.length} fuse locations, ${batterySpots.length} battery spots, ${nav.nodes.length} nav nodes`);
const perFloor = {};
for (const f of fuseLocations) perFloor[f.level] = (perFloor[f.level] || 0) + 1;
console.log('fuse locations per floor', perFloor);

