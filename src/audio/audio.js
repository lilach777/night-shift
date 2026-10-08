// NIGHT SHIFT audio engine (Web Audio API).
// Created only after a user gesture (browser autoplay policy). Every failure is
// non-fatal: a missing or undecodable file simply plays nothing.
import { MANIFEST } from './manifest.js';
import { settings } from '../core/settings.js';

const BUS_DEFAULTS = { music: 0.1, ambience: 0.6, environment: 0.6, sfx: 0.8, player: 0.7, monster: 1.0, voice: 1.0, ui: 0.6 };

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();     // url -> AudioBuffer | null
    this.pending = new Map();     // url -> Promise
    this.bus = {};
    this.handles = new Set();
    this.listenerPos = { x: 0, y: 0, z: 0 };
    this.occluder = null;         // (from, to) => boolean line of sight
    this.paused = false;
    this.failed = new Set();
    this.duck = 1;
  }

  get ready() { return !!this.ctx; }

  // Must be called from a user gesture handler.
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { console.warn('[audio] Web Audio not supported — running silent.'); return false; }
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      console.warn('[audio] could not create AudioContext', e); return false;
    }
    const ctx = this.ctx;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 12; this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004; this.comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.connect(this.comp); this.comp.connect(ctx.destination);
    // Reverb send = "the space you are in". One send bus feeds four acoustic spaces whose
    // levels crossfade with the listener's location (setSpace): a small room, a long tiled
    // corridor, the concrete basement / stairwell, and outdoors (a short slap off the facade).
    this.reverb = ctx.createGain();
    this.reverbOut = ctx.createGain(); this.reverbOut.gain.value = 0.6;
    this.reverbOut.connect(this.master);
    this.spaces = {};
    const SPACES = {
      room: { len: 0.9, rt: 0.55, hf: 0.35, er: [0.006, 0.011, 0.017, 0.023], erGain: 0.5, color: 0.45 },
      corridor: { len: 2.6, rt: 1.6, hf: 0.9, er: [0.004, 0.009, 0.021, 0.034, 0.05, 0.072], erGain: 0.45, color: 0.55 },
      concrete: { len: 3.6, rt: 2.4, hf: 0.9, er: [0.007, 0.015, 0.028, 0.041, 0.063], erGain: 0.55, color: 0.7 },
      outside: { len: 0.7, rt: 0.25, hf: 0.15, er: [0.042, 0.088], erGain: 0.35, color: 0.6 },
    };
    for (const [name, p] of Object.entries(SPACES)) {
      const conv = ctx.createConvolver(); conv.buffer = this.makeSpaceImpulse(p);
      const g = ctx.createGain(); g.gain.value = name === 'room' ? 1 : 0;
      this.reverb.connect(conv); conv.connect(g); g.connect(this.reverbOut);
      this.spaces[name] = g;
    }
    this.bigReverb = ctx.createConvolver();
    this.bigReverb.buffer = this.makeImpulse(6.5, 1.8);
    this.bigReverbOut = ctx.createGain(); this.bigReverbOut.gain.value = 0.7;
    this.bigReverb.connect(this.bigReverbOut); this.bigReverbOut.connect(this.master);
    // Mix priority: ambience / music / environment pass through a duck stage that pulls them
    // down while someone speaks (and a little under close monster vocals).
    this.duckGain = ctx.createGain(); this.duckGain.connect(this.master);
    this.duckTarget = 1;
    for (const name of Object.keys(BUS_DEFAULTS)) {
      const g = ctx.createGain();
      g.connect(['ambience', 'music', 'environment'].includes(name) ? this.duckGain : this.master);
      this.bus[name] = g;
    }
    // Music bus goes through a ducking gain so chases can pull it down.
    this.applySettings();
    settings.onChange((sec) => { if (sec === 'audio' || sec === '*') this.applySettings(); });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend().catch(() => {});
      else if (!this.paused) this.ctx.resume().catch(() => {});
    });
    return true;
  }

  makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // low-passed noise with exponential decay + early reflections
        lp = lp * 0.55 + (Math.random() * 2 - 1) * 0.45;
        d[i] = lp * Math.pow(1 - t, decay) * (i < rate * 0.02 ? 0.3 : 1);
      }
      for (let k = 0; k < 6; k++) {
        const at = Math.floor(rate * (0.011 + k * 0.017 + Math.random() * 0.01));
        if (at < len) d[at] += (Math.random() < 0.5 ? -1 : 1) * 0.5 * (1 - k / 6);
      }
    }
    return buf;
  }

  // A physically-flavoured room impulse: discrete early reflections, then a diffuse tail
  // whose highs die faster than its lows (so it sounds like a space, not a noise burst).
  makeSpaceImpulse({ len, rt, hf, er, erGain, color }) {
    const rate = this.ctx.sampleRate, n = Math.floor(rate * len);
    const buf = this.ctx.createBuffer(2, n, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lpA = 0, lpB = 0;
      const kLow = Math.log(1000) / (rt * rate), kHigh = Math.log(1000) / (rt * hf * rate);
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        lpA = lpA * color + w * (1 - color);              // dark component
        const hi = w - lpA;                                 // bright component
        lpB = lpB * 0.3 + (lpA * Math.exp(-kLow * i) + hi * Math.exp(-kHigh * i) * 0.6) * 0.7;
        const onset = Math.min(1, i / (rate * 0.012));     // diffuse tail builds up after the early reflections
        d[i] = lpB * onset * 0.9;
      }
      er.forEach((t, k) => {
        const at = Math.floor(rate * (t + (c ? 0.0013 * (k + 1) : 0)));
        if (at < n) d[at] += (k % 2 ? -1 : 1) * erGain * Math.pow(0.78, k);
      });
    }
    // calibrate: same energy as the original hall reverb, scaled by how big the space is,
    // so every reverb send level used across the game keeps sitting where it was tuned
    if (!this._refEnergy) {
      const ref = this.makeImpulse(3.2, 2.6); let e = 0;
      for (let c = 0; c < 2; c++) for (const v of ref.getChannelData(c)) e += v * v;
      this._refEnergy = e;
    }
    let e = 0;
    for (let c = 0; c < 2; c++) for (const v of buf.getChannelData(c)) e += v * v;
    const want = this._refEnergy * Math.min(1.25, 0.35 + rt * 0.4);
    const k = Math.sqrt(want / Math.max(e, 1e-9));
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) d[i] *= k; }
    return buf;
  }

  // Where the listener is: weights for room / corridor / concrete / outside (smoothed).
  setSpace(w) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const [k, g] of Object.entries(this.spaces)) g.gain.setTargetAtTime(w[k] || 0, t, 0.35);
  }

  applySettings() {
    if (!this.ctx) return;
    const a = settings.data.audio;
    const t = this.ctx.currentTime;
    const set = (g, v) => g.gain.setTargetAtTime(v, t, 0.05);
    set(this.master, a.master);
    set(this.bus.music, a.music * this.duck);
    set(this.bus.voice, a.voice);
    set(this.bus.sfx, a.sfx);
    set(this.bus.ambience, a.ambience);
    // Buses without their own slider follow the closest slider relative to its default.
    set(this.bus.environment, BUS_DEFAULTS.environment * (a.ambience / 0.6) * 0.5 + BUS_DEFAULTS.environment * (a.sfx / 0.8) * 0.5);
    set(this.bus.player, BUS_DEFAULTS.player * (a.sfx / 0.8));
    set(this.bus.monster, BUS_DEFAULTS.monster * Math.min(1.25, a.sfx / 0.8));
    set(this.bus.ui, BUS_DEFAULTS.ui * (a.sfx / 0.8));
  }

  setMusicDuck(v, time = 2) {
    this.duck = v;
    if (!this.ctx) return;
    this.bus.music.gain.setTargetAtTime(settings.data.audio.music * v, this.ctx.currentTime, time / 3);
  }

  // ------------------------------------------------------------------ loading
  urlsFor(id) { return MANIFEST[id] || []; }

  loadUrl(url) {
    if (this.buffers.has(url)) return Promise.resolve(this.buffers.get(url));
    if (this.pending.has(url)) return this.pending.get(url);
    const p = fetch(url)
      .then(r => { if (!r.ok) throw new Error(r.status + ' ' + url); return r.arrayBuffer(); })
      .then(ab => new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej)))
      .then(buf => { this.buffers.set(url, buf); return buf; })
      .catch(e => {
        if (!this.failed.has(url)) console.warn('[audio] failed to load', url, e?.message || e);
        this.failed.add(url);
        this.buffers.set(url, null);
        return null;
      })
      .finally(() => this.pending.delete(url));
    this.pending.set(url, p);
    return p;
  }

  preload(ids, onProgress) {
    if (!this.ctx) return Promise.resolve();
    const urls = ids.flatMap(id => this.urlsFor(id));
    let done = 0;
    return Promise.all(urls.map(u => this.loadUrl(u).then(() => { done++; onProgress && onProgress(done / urls.length); })));
  }

  preloadAll() {
    return this.preload(Object.keys(MANIFEST));
  }

  pickUrl(id, index) {
    const urls = this.urlsFor(id);
    if (!urls.length) { if (!this.failed.has(id)) { console.warn('[audio] unknown sound id', id); this.failed.add(id); } return null; }
    return urls[index != null ? index % urls.length : Math.floor(Math.random() * urls.length)];
  }

  // ------------------------------------------------------------------ playback
  /**
   * opts: bus, volume, rate, loop, pos {x,y,z}, refDistance, maxDistance, rolloff, hrtf,
   *       reverb (0..1 send), bigReverb, lowpass (Hz), occlude (bool), delay, fadeIn, index, offset
   */
  play(id, opts = {}) {
    const h = new SoundHandle(this, id, opts);
    if (!this.ctx) return h;
    const url = this.pickUrl(id, opts.index);
    if (!url) return h;
    const buf = this.buffers.get(url);
    if (buf) h.start(buf);
    else if (buf === undefined) this.loadUrl(url).then(b => { if (b && !h.stopped) h.start(b); });
    return h;
  }

  playAt(id, pos, opts = {}) { return this.play(id, { ...opts, pos }); }

  setListener(camera) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const p = camera.position;
    const e = camera.matrixWorld.elements;
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const ux = e[4], uy = e[5], uz = e[6];
    this.listenerPos = { x: p.x, y: p.y, z: p.z };
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.setTargetAtTime(fx, t, 0.02); L.forwardY.setTargetAtTime(fy, t, 0.02); L.forwardZ.setTargetAtTime(fz, t, 0.02);
      L.upX.setTargetAtTime(ux, t, 0.02); L.upY.setTargetAtTime(uy, t, 0.02); L.upZ.setTargetAtTime(uz, t, 0.02);
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  update(dt) {
    if (!this.ctx) return;
    this._occT = (this._occT || 0) + dt;
    const doOcc = this._occT > 0.15;
    if (doOcc) this._occT = 0;
    let speaking = 0, monsterNear = 0;
    const L = this.listenerPos;
    for (const h of this.handles) {
      if (h.opts.bus === 'voice' && !h.opts.loop) speaking++;
      if (h.opts.bus === 'monster' && h.pos && !h.opts.loop && Math.hypot(h.pos.x - L.x, h.pos.z - L.z) < 6) monsterNear++;
      if (doOcc && h.pos && h.filter) {
        // air absorption: distant sources lose their top end; walls muffle further
        const d = Math.hypot(h.pos.x - L.x, h.pos.y - L.y, h.pos.z - L.z);
        let target = Math.min(h.opts.lowpass || 20000, 20000 * Math.exp(-d / 22) + 2600);
        if (h.occlude && this.occluder) {
          const blocked = !this.occluder(L, h.pos);
          const dy = Math.abs(L.y - h.pos.y);
          if (blocked) target = Math.min(target, dy > 2.5 ? 380 : 900);
          if (h.occGain) h.occGain.gain.setTargetAtTime(blocked ? 0.55 : 1, this.ctx.currentTime, 0.12);
        }
        h.filter.frequency.setTargetAtTime(target, this.ctx.currentTime, 0.12);
      }
    }
    // ducking: voices pull the bed down ~5 dB; a monster vocal right next to you ~2.5 dB
    const duck = speaking ? 0.56 : monsterNear ? 0.75 : 1;
    if (duck !== this.duckTarget) {
      this.duckTarget = duck;
      this.duckGain.gain.setTargetAtTime(duck, this.ctx.currentTime, duck < 1 ? 0.06 : 0.35);
    }
  }

  pauseAll(paused) {
    this.paused = paused;
    if (!this.ctx) return;
    // World sounds pause by suspending; UI/menu keeps working because menus re-resume.
    if (paused) this.ctx.suspend().catch(() => {});
    else this.ctx.resume().catch(() => {});
  }

  stopAll(fade = 0.5, except = []) {
    for (const h of [...this.handles]) if (!except.includes(h.opts.bus)) h.stop(fade);
  }
}

class SoundHandle {
  constructor(engine, id, opts) {
    this.engine = engine; this.id = id; this.opts = opts;
    this.stopped = false; this.started = false;
    this.pos = opts.pos ? { x: opts.pos.x, y: opts.pos.y, z: opts.pos.z } : null;
    this.occlude = !!opts.occlude;
    this.endedCbs = [];
    this.ended = new Promise(r => this.endedCbs.push(r));
  }

  start(buf) {
    const E = this.engine, ctx = E.ctx, o = this.opts;
    if (this.stopped) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = !!o.loop;
    src.playbackRate.value = o.rate ?? 1;
    if (o.detune) src.detune.value = o.detune;
    const gain = ctx.createGain();
    const vol = o.volume ?? 1;
    const t0 = ctx.currentTime + (o.delay || 0);
    // never start with a hard edge: at least a 4 ms ramp (longer when asked)
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + Math.max(0.004, o.fadeIn || 0));
    let node = src;
    if (o.lowpass || this.occlude || this.pos) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lowpass || 20000; f.Q.value = 0.5;
      node.connect(f); node = f; this.filter = f;
      if (this.occlude) { const og = ctx.createGain(); node.connect(og); node = og; this.occGain = og; }
    }
    node.connect(gain);
    let out = gain;
    if (this.pos) {
      const p = ctx.createPanner();
      p.panningModel = o.hrtf ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = o.refDistance ?? 2;
      p.maxDistance = o.maxDistance ?? 60;
      p.rolloffFactor = o.rolloff ?? 1.2;
      if (p.positionX) { p.positionX.value = this.pos.x; p.positionY.value = this.pos.y; p.positionZ.value = this.pos.z; }
      else p.setPosition(this.pos.x, this.pos.y, this.pos.z);
      gain.connect(p); out = p; this.panner = p;
    }
    const bus = E.bus[o.bus || 'sfx'] || E.bus.sfx;
    out.connect(bus);
    if (o.reverb) { const s = ctx.createGain(); s.gain.value = o.reverb; out.connect(s); s.connect(E.reverb); this.send = s; }
    if (o.bigReverb) { const s = ctx.createGain(); s.gain.value = o.bigReverb; out.connect(s); s.connect(E.bigReverb); this.send2 = s; }
    this.src = src; this.gain = gain;
    src.onended = () => this.finish();
    try { src.start(t0, o.offset || 0); } catch { src.start(); }
    this.started = true;
    this.startTime = t0;
    this.duration = buf.duration / (o.rate ?? 1);
    E.handles.add(this);
  }

  finish() {
    this.stopped = true;
    this.engine.handles.delete(this);
    try { this.src && this.src.disconnect(); this.gain && this.gain.disconnect(); this.panner && this.panner.disconnect(); this.send && this.send.disconnect(); this.send2 && this.send2.disconnect(); } catch { /* ignore */ }
    for (const cb of this.endedCbs) cb();
    this.endedCbs.length = 0;
  }

  stop(fade = 0.05) {
    if (this.stopped) return;
    this.stopped = true;
    if (!this.started) { this.finish(); return; }
    const ctx = this.engine.ctx;
    const t = ctx.currentTime;
    try {
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.setValueAtTime(this.gain.gain.value, t);
      this.gain.gain.linearRampToValueAtTime(0, t + Math.max(0.01, fade));
      this.src.stop(t + Math.max(0.01, fade) + 0.02);
    } catch { this.finish(); }
  }

  setVolume(v, time = 0.1) {
    this.opts.volume = v;
    if (!this.started || this.stopped) return;
    this.gain.gain.setTargetAtTime(v, this.engine.ctx.currentTime, Math.max(0.01, time / 3));
  }

  setRate(r, time = 0.1) {
    if (!this.started || this.stopped) return;
    this.src.playbackRate.setTargetAtTime(r, this.engine.ctx.currentTime, Math.max(0.01, time / 3));
  }

  setPosition(p) {
    if (!this.pos) return;
    this.pos.x = p.x; this.pos.y = p.y; this.pos.z = p.z;
    if (!this.panner) return;
    const t = this.engine.ctx.currentTime;
    if (this.panner.positionX) {
      this.panner.positionX.setTargetAtTime(p.x, t, 0.03); this.panner.positionY.setTargetAtTime(p.y, t, 0.03); this.panner.positionZ.setTargetAtTime(p.z, t, 0.03);
    } else this.panner.setPosition(p.x, p.y, p.z);
  }

  setLowpass(hz, time = 0.2) {
    if (this.filter) this.filter.frequency.setTargetAtTime(hz, this.engine.ctx.currentTime, time / 3);
  }

  get playing() { return this.started && !this.stopped; }
}

export const audio = new AudioEngine();
