// Keyframe curve engine mirroring Blender's F-curve interpolation modes:
//   CONSTANT, LINEAR, BEZIER (auto-clamped handles) and the "dynamic effects"
//   SINE / QUAD / CUBIC / QUART / QUINT / EXPO / CIRC / BACK / BOUNCE / ELASTIC
//   with easing IN / OUT / IN_OUT (Blender's AUTO = OUT for BACK/BOUNCE/ELASTIC, IN otherwise).
// Like Blender, a key's interpolation governs the segment from that key to the next.

const PI = Math.PI;
const bounceOut = t => {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};
// "in" forms; out/inOut are derived
const IN = {
  LINEAR: t => t,
  SINE: t => 1 - Math.cos(t * PI / 2),
  QUAD: t => t * t,
  CUBIC: t => t * t * t,
  QUART: t => t ** 4,
  QUINT: t => t ** 5,
  EXPO: t => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  CIRC: t => 1 - Math.sqrt(Math.max(0, 1 - t * t)),
  BACK: (t, k = {}) => { const s = k.back ?? 1.70158; return t * t * ((s + 1) * t - s); },
  BOUNCE: t => 1 - bounceOut(1 - t),
  ELASTIC: (t, k = {}) => {
    if (t <= 0 || t >= 1) return t;
    const p = k.period ?? 0.3, a = Math.max(1, k.amplitude ?? 1), s = p / (2 * PI) * Math.asin(1 / a);
    return -(a * Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1 - s) * 2 * PI / p));
  },
};

export function ease(type = 'SINE', easing = 'AUTO', t, opts) {
  t = Math.min(1, Math.max(0, t));
  const f = IN[type] || IN.LINEAR;
  if (easing === 'AUTO') easing = (type === 'BACK' || type === 'BOUNCE' || type === 'ELASTIC') ? 'EASE_OUT' : 'EASE_IN';
  if (easing === 'EASE_IN') return f(t, opts);
  if (easing === 'EASE_OUT') return 1 - f(1 - t, opts);
  return t < 0.5 ? f(t * 2, opts) / 2 : 1 - f((1 - t) * 2, opts) / 2;
}

// shorthand used by gameplay code: e('CUBIC.IN_OUT', t), e('BACK.OUT', t)
export function e(spec, t, opts) {
  const [type, how = 'IN_OUT'] = spec.toUpperCase().split('.');
  return ease(type, how === 'IN' ? 'EASE_IN' : how === 'OUT' ? 'EASE_OUT' : 'EASE_IN_OUT', t, opts);
}

/**
 * A keyframed channel.  keys: [{t, v, interp?='BEZIER', easing?='AUTO', back?, amplitude?, period?}]
 * v may be a number or an array (all keys must share the shape).  BEZIER segments use
 * auto-clamped handles (tangent = neighbour slope, zero at local extrema), like Blender's default.
 */
export class Track {
  constructor(keys, { wrap = false } = {}) {
    this.keys = keys.slice().sort((a, b) => a.t - b.t);
    this.wrap = wrap;
    this.arr = Array.isArray(this.keys[0].v);
    this.dim = this.arr ? this.keys[0].v.length : 1;
    this.tan = this.keys.map((k, i) => this._tangent(i));
  }
  get duration() { return this.keys[this.keys.length - 1].t; }
  comp(k, c) { return this.arr ? k.v[c] : k.v; }
  _tangent(i) {
    const K = this.keys, out = [];
    for (let c = 0; c < this.dim; c++) {
      const p = K[i - 1], k = K[i], n = K[i + 1];
      if (!p || !n) { out.push(0); continue; }
      const a = this.comp(p, c), b = this.comp(k, c), d = this.comp(n, c);
      // auto-clamped: flat at extremes so the curve never overshoots its keys
      if ((b - a) * (d - b) <= 0) { out.push(0); continue; }
      out.push((d - a) / (n.t - p.t));
    }
    return out;
  }
  sample(t, out) {
    const K = this.keys;
    if (this.wrap) t = ((t % this.duration) + this.duration) % this.duration;
    let i = 0;
    while (i < K.length - 2 && t >= K[i + 1].t) i++;
    const a = K[i], b = K[Math.min(K.length - 1, i + 1)];
    const span = b.t - a.t;
    const u = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 1;
    const res = out || (this.arr ? new Array(this.dim) : null);
    const mode = a.interp || 'BEZIER';
    let w = u;
    if (mode === 'CONSTANT') w = t >= b.t ? 1 : 0;
    else if (mode !== 'LINEAR' && mode !== 'BEZIER') w = ease(mode, a.easing || 'AUTO', u, a);
    let single = 0;
    for (let c = 0; c < this.dim; c++) {
      const va = this.comp(a, c), vb = this.comp(b, c);
      let v;
      if (mode === 'BEZIER') {
        // cubic Hermite with the clamped handles (Blender's handle length = 1/3 span)
        const m0 = this.tan[i][c] * span, m1 = this.tan[Math.min(K.length - 1, i + 1)][c] * span;
        const u2 = u * u, u3 = u2 * u;
        v = (2 * u3 - 3 * u2 + 1) * va + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * vb + (u3 - u2) * m1;
      } else v = va + (vb - va) * w;
      if (this.arr) res[c] = v; else single = v;
    }
    return this.arr ? res : single;
  }
}
