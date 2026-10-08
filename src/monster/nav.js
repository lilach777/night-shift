// Navigation graph (from layout) with A* pathfinding.
export class Nav {
  constructor(layout) {
    this.nodes = layout.nav.nodes.map(n => ({ ...n, adj: [] }));
    for (const [a, b] of layout.nav.edges) {
      const A = this.nodes[a], B = this.nodes[b];
      const d = Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z);
      A.adj.push([b, d]); B.adj.push([a, d]);
    }
  }

  nearest(p, maxDist = 6, filter) {
    let best = null, bd = maxDist;
    for (const n of this.nodes) {
      if (Math.abs(n.y - p.y) > 2.2) continue;
      if (filter && !filter(n)) continue;
      const d = Math.hypot(n.x - p.x, n.z - p.z) + Math.abs(n.y - p.y) * 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  path(fromNode, toNode) {
    if (!fromNode || !toNode) return null;
    if (fromNode === toNode) return [fromNode];
    const open = new Map([[fromNode.id, 0]]);
    const g = new Map([[fromNode.id, 0]]);
    const came = new Map();
    const h = n => Math.hypot(n.x - toNode.x, n.y - toNode.y, n.z - toNode.z);
    const f = new Map([[fromNode.id, h(fromNode)]]);
    let guard = 0;
    while (open.size && guard++ < 4000) {
      let cur = null, cf = Infinity;
      for (const id of open.keys()) { const v = f.get(id); if (v < cf) { cf = v; cur = id; } }
      if (cur === toNode.id) {
        const out = [this.nodes[cur]];
        while (came.has(cur)) { cur = came.get(cur); out.unshift(this.nodes[cur]); }
        return out;
      }
      open.delete(cur);
      for (const [nb, d] of this.nodes[cur].adj) {
        const ng = g.get(cur) + d;
        if (ng < (g.get(nb) ?? Infinity)) {
          came.set(nb, cur); g.set(nb, ng); f.set(nb, ng + h(this.nodes[nb])); open.set(nb, true);
        }
      }
    }
    return null;
  }

  onLevel(level, tagPrefix) {
    return this.nodes.filter(n => n.level === level && (!tagPrefix || (n.tag || '').startsWith(tagPrefix)));
  }
}
