// Layout-driven physics: static AABB colliders, dynamic door segments,
// walkable surfaces (floors, stair ramps, landings) and line-of-sight queries.
const CELL = 4;
const STEPS = 12;   // steps per stair flight (must match blender/scripts/ns_hospital.py STEP_COUNT)

export class Physics {
  constructor(layout) {
    this.layout = layout;
    this.static = [];       // {x0,x1,z0,z1,y0,y1, wall:bool}
    this.grid = new Map();
    this.dynamic = [];      // objects with segment() and blocking()
    this.surfaces = [];
    this.levelY = Object.fromEntries(layout.levels.map(l => [l.id, l.y]));
    this.buildColliders();
    this.buildSurfaces();
  }

  // ------------------------------------------------------------------ build
  addBox(b) {
    this.static.push(b);
    const cx0 = Math.floor(b.x0 / CELL), cx1 = Math.floor(b.x1 / CELL);
    const cz0 = Math.floor(b.z0 / CELL), cz1 = Math.floor(b.z1 / CELL);
    for (let i = cx0; i <= cx1; i++) for (let j = cz0; j <= cz1; j++) {
      const k = i * 100000 + j;
      let arr = this.grid.get(k);
      if (!arr) this.grid.set(k, arr = []);
      arr.push(b);
    }
  }

  buildColliders() {
    const L = this.layout;
    for (const w of L.walls) {
      const t = w.t;
      const cuts = w.openings.filter(o => o.type === 'door' || o.type === 'entrance').sort((a, b) => a.at - b.at);
      let cur = w.a;
      const pieces = [];
      for (const o of cuts) { pieces.push([cur, o.at - o.w / 2]); cur = o.at + o.w / 2; }
      pieces.push([cur, w.b]);
      let y1 = w.y1;
      if (w.axis === 'z' && Math.abs(w.c - 17) < 0.01 && w.b <= -1.4) y1 = w.y0 + 4;
      for (const [p0, p1] of pieces) {
        if (p1 - p0 < 0.01) continue;
        if (w.axis === 'x') this.addBox({ x0: p0, x1: p1, z0: w.c - t / 2, z1: w.c + t / 2, y0: w.y0, y1, wall: true });
        else this.addBox({ x0: w.c - t / 2, x1: w.c + t / 2, z0: p0, z1: p1, y0: w.y0, y1, wall: true });
      }
      // door lintels block LOS above the door
      for (const o of cuts) {
        const a = o.at - o.w / 2, b = o.at + o.w / 2;
        const ly = w.y0 + o.y1;
        if (w.axis === 'x') this.addBox({ x0: a, x1: b, z0: w.c - t / 2, z1: w.c + t / 2, y0: ly, y1, wall: true });
        else this.addBox({ x0: w.c - t / 2, x1: w.c + t / 2, z0: a, z1: b, y0: ly, y1, wall: true });
      }
    }
    // Stair landings / flights undersides block sight between floors (rough slabs)
    for (const p of L.props) {
      const c = L.catalog[p.type];
      if (!c.collide) continue;
      if (c.collide === 'closet') { this.addClosetColliders(p, c); continue; }
      const cs = Math.abs(Math.cos(p.rot)), sn = Math.abs(Math.sin(p.rot));
      const w = (c.w * cs + c.d * sn) * 0.92, d = (c.w * sn + c.d * cs) * 0.92;
      this.addBox({ x0: p.x - w / 2, x1: p.x + w / 2, z0: p.z - d / 2, z1: p.z + d / 2, y0: p.y, y1: p.y + c.h, wall: false, prop: p.type });
    }
    // Stair balustrades along each flight's inner edge (x = 19.5), matching the Blender
    // geometry: sloped, so they are approximated by short stepped boxes (soffit -> tread + 1 m).
    for (const s of L.stairs) {
      for (const f of [s.flightA, s.flightB]) {
        const inner = 19.5, T = 0.12, N = 10;
        const gx0 = f.x1 === inner ? inner - T : inner, gx1 = gx0 + T;
        for (let i = 0; i < N; i++) {
          const za = f.z0 + (f.z1 - f.z0) * i / N, zb = f.z0 + (f.z1 - f.z0) * (i + 1) / N;
          const yAt = z => { const t = f.lowAt === 'z1' ? (f.z1 - z) / (f.z1 - f.z0) : (z - f.z0) / (f.z1 - f.z0); return f.yLow + (f.yHigh - f.yLow) * t; };
          const ya = yAt(za), yb = yAt(zb);
          this.addBox({ x0: gx0, x1: gx1, z0: za, z1: zb, y0: Math.min(ya, yb) - 0.3, y1: Math.max(ya, yb) + 1.0, wall: true, prop: 'stair_guard' });
        }
      }
    }
    // Exterior bounds (only reachable in the ending) — keep the player near the building.
    const add = (x0, x1, z0, z1) => this.addBox({ x0, x1, z0, z1, y0: -1, y1: 6, wall: false });
    add(-80, -70, -40, 40); add(-80, -22, 26, 27); add(-80, -22, -27, -26);
    add(-23, -22.2, 9.2, 27); add(-23, -22.2, -27, -9.2);
    // Canopy columns
    for (const cz of [-2.9, 2.9]) add(-26.4, -26.0, cz - 0.2, cz + 0.2);
  }

  // Hollow walk-in closet: back + two sides are solid (and block sight); the open front is
  // closed by its door (a dynamic part). The interior stays free for the player to hide in.
  addClosetColliders(p, c) {
    const t = 0.05, { w, d, h } = c;
    const local = [
      [-w / 2, w / 2, -d / 2, -d / 2 + t],          // back
      [-w / 2, -w / 2 + t, -d / 2, d / 2],          // left side
      [w / 2 - t, w / 2, -d / 2, d / 2],            // right side
    ];
    const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
    for (const [x0, x1, z0, z1] of local) {
      const pts = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(([x, z]) => [p.x + x * cs + z * sn, p.z - x * sn + z * cs]);
      const xs = pts.map(q => q[0]), zs = pts.map(q => q[1]);
      this.addBox({ x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), y0: p.y, y1: p.y + h, wall: true, prop: 'closet' });
    }
  }

  buildSurfaces() {
    const L = this.layout, B = L.bounds;
    for (const lv of L.levels) {
      const y = lv.y;
      if (lv.id === 'B') this.surfaces.push({ x0: B.x0, x1: B.x1, z0: B.z0, z1: B.z1, y, level: lv.id });
      else {
        this.surfaces.push({ x0: B.x0, x1: 17, z0: B.z0, z1: B.z1, y, level: lv.id });
        this.surfaces.push({ x0: 17, x1: B.x1, z0: -1.5, z1: B.z1, y, level: lv.id });
      }
    }
    for (const s of L.stairs) {
      for (const f of [s.flightA, s.flightB]) this.surfaces.push({ ...f, ramp: true, level: s.level });
      this.surfaces.push({ ...s.landing, level: s.level });
    }
    // Exterior ground around the building footprint
    const E = 0.15;
    this.surfaces.push({ x0: -160, x1: B.x0 - E, z0: -120, z1: 120, y: 0, level: 'X' });
    this.surfaces.push({ x0: B.x1 + E, x1: 120, z0: -120, z1: 120, y: 0, level: 'X' });
    this.surfaces.push({ x0: B.x0 - E, x1: B.x1 + E, z0: B.z1 + E, z1: 120, y: 0, level: 'X' });
    this.surfaces.push({ x0: B.x0 - E, x1: B.x1 + E, z0: -120, z1: B.z0 - E, y: 0, level: 'X' });
    // threshold under the main entrance
    this.surfaces.push({ x0: B.x0 - 0.4, x1: B.x0 + 0.4, z0: -1.4, z1: 1.4, y: 0, level: '1' });
  }

  // ------------------------------------------------------------------ queries
  // Stairs are real steps: the walkable height is the tread of the step under the
  // foot (12 steps per flight, matching the Blender geometry), not a smooth ramp.
  surfaceHeight(s, x, z) {
    if (!s.ramp) return s.y;
    const span = s.z1 - s.z0;
    const t = s.lowAt === 'z1' ? (s.z1 - z) / span : (z - s.z0) / span;
    const n = STEPS;
    const i = Math.min(n - 1, Math.max(0, Math.floor(Math.min(0.99999, Math.max(0, t)) * n)));
    return s.yLow + (s.yHigh - s.yLow) * (i + 1) / n;
  }

  groundAt(x, z, feetY, stepUp = 0.5) {
    let best = -Infinity;
    for (const s of this.surfaces) {
      if (x < s.x0 - 0.02 || x > s.x1 + 0.02 || z < s.z0 - 0.02 || z > s.z1 + 0.02) continue;
      const h = this.surfaceHeight(s, x, z);
      if (h <= feetY + stepUp && h > best) best = h;
    }
    return best;
  }

  levelOf(y) {
    let best = 'B', bd = Infinity;
    for (const l of this.layout.levels) {
      const d = y - l.y;
      if (d > -0.6 && d < bd) { bd = d; best = l.id; }
    }
    return best;
  }

  nearby(x, z, r) {
    const out = new Set();
    const cx0 = Math.floor((x - r) / CELL), cx1 = Math.floor((x + r) / CELL);
    const cz0 = Math.floor((z - r) / CELL), cz1 = Math.floor((z + r) / CELL);
    for (let i = cx0; i <= cx1; i++) for (let j = cz0; j <= cz1; j++) {
      const arr = this.grid.get(i * 100000 + j);
      if (arr) for (const b of arr) out.add(b);
    }
    return out;
  }

  // Resolve a vertical cylinder (feet y, height h) against colliders. Mutates pos.
  collide(pos, radius, height = 1.7) {
    const yA = pos.y + 0.35, yB = pos.y + height;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const b of this.nearby(pos.x, pos.z, radius + 0.5)) {
        if (b.y1 <= yA || b.y0 >= yB) continue;
        const cx = Math.max(b.x0, Math.min(pos.x, b.x1));
        const cz = Math.max(b.z0, Math.min(pos.z, b.z1));
        let dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        if (d2 < 1e-8) {
          // centre inside the box: push out along the smallest axis
          const ox = Math.min(pos.x - b.x0, b.x1 - pos.x), oz = Math.min(pos.z - b.z0, b.z1 - pos.z);
          if (ox < oz) pos.x = (pos.x - b.x0 < b.x1 - pos.x) ? b.x0 - radius : b.x1 + radius;
          else pos.z = (pos.z - b.z0 < b.z1 - pos.z) ? b.z0 - radius : b.z1 + radius;
        } else {
          const d = Math.sqrt(d2);
          const push = radius - d;
          pos.x += dx / d * push; pos.z += dz / d * push;
        }
        moved = true;
      }
      for (const dyn of this.dynamic) {
        const s = dyn.segment && dyn.segment();
        if (!s) continue;
        if (s.y1 <= yA || s.y0 >= yB) continue;
        const r = radius + (s.thick ?? 0.04);
        const ex = s.bx - s.ax, ez = s.bz - s.az;
        const L2 = ex * ex + ez * ez;
        let t = L2 > 0 ? ((pos.x - s.ax) * ex + (pos.z - s.az) * ez) / L2 : 0;
        t = Math.max(0, Math.min(1, t));
        const px = s.ax + ex * t, pz = s.az + ez * t;
        const dx = pos.x - px, dz = pos.z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          pos.x += dx / d * (r - d); pos.z += dz / d * (r - d);
          moved = true;
        }
      }
      if (!moved) break;
    }
    return pos;
  }

  // Segment vs AABB (slab test). Returns true if blocked.
  static segBox(ax, ay, az, bx, by, bz, b) {
    let t0 = 0, t1 = 1;
    const d = [bx - ax, by - ay, bz - az], o = [ax, ay, az];
    const mn = [b.x0, b.y0, b.z0], mx = [b.x1, b.y1, b.z1];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return false; continue; }
      let ta = (mn[i] - o[i]) / d[i], tb = (mx[i] - o[i]) / d[i];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
    return true;
  }

  // Line of sight between two points through walls/closed doors (props ignored unless includeProps).
  los(a, b, includeProps = false) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / 2));
    const seen = new Set();
    // floors between levels
    if (Math.abs(a.y - b.y) > 2.2) {
      const la = this.levelOf(a.y), lb = this.levelOf(b.y);
      if (la !== lb && !this.inStairwell(a) && !this.inStairwell(b)) return false;
    }
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      for (const box of this.nearby(a.x + dx * t, a.z + dz * t, 1.2)) {
        if (seen.has(box)) continue;
        seen.add(box);
        if (!box.wall && !includeProps) continue;
        if (Physics.segBox(a.x, a.y, a.z, b.x, b.y, b.z, box)) return false;
      }
    }
    for (const dyn of this.dynamic) {
      if (!dyn.blocksSight || !dyn.blocksSight()) continue;
      const box = dyn.box();
      if (box && Physics.segBox(a.x, a.y, a.z, b.x, b.y, b.z, box)) return false;
    }
    return true;
  }

  inStairwell(p) { return p.x > 16.9 && p.z < -1.4; }
}
