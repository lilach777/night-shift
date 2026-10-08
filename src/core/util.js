export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, t) => { const x = clamp((t - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const wrapAngle = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Seeded RNG (mulberry32) — used for fuse placement so runs are reproducible.
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Simple pausable game clock used by timers so pausing freezes scripted events.
export class GameClock {
  constructor() { this.time = 0; this.timers = []; }
  update(dt) {
    this.time += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      if (this.time >= t.at) { this.timers.splice(i, 1); try { t.fn(); } catch (e) { console.error(e); } }
    }
  }
  after(sec, fn) { const t = { at: this.time + sec, fn }; this.timers.push(t); return t; }
  cancel(t) { const i = this.timers.indexOf(t); if (i >= 0) this.timers.splice(i, 1); }
  wait(sec) { return new Promise(r => this.after(sec, r)); }
  clear() { this.timers.length = 0; }
}
export const clock = new GameClock();
