// NIGHT SHIFT multiplayer - the building's alarm (MULTIPLAYER ONLY).
// A two-tone hospital klaxon synthesised in Web Audio (no recording needed, no licence question):
// two detuned square/saw voices alternating ~0.55 s apart, band-passed like a ceiling horn, a little
// grit, fed into the game's reverb so it fills whatever space the listener is in. It ducks under
// voice lines through the environment bus like every other world sound.
import { audio } from '../audio/audio.js';

export class Klaxon {
  constructor() { this.on = false; this.node = null; this.burstT = 0; }

  build() {
    const ctx = audio.ctx; if (!ctx || this.node) return;
    const out = ctx.createGain(); out.gain.value = 0;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1150; bp.Q.value = 1.6;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 280;
    const shaper = ctx.createWaveShaper(); const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.2); } shaper.curve = curve;
    const mix = ctx.createGain(); mix.gain.value = 0.22;
    const a = ctx.createOscillator(); a.type = 'square';
    const b = ctx.createOscillator(); b.type = 'sawtooth'; b.detune.value = 9;
    a.connect(mix); b.connect(mix); mix.connect(shaper); shaper.connect(hp); hp.connect(bp); bp.connect(out);
    out.connect(audio.bus.environment || audio.master);
    const send = ctx.createGain(); send.gain.value = 0.45; out.connect(send); send.connect(audio.reverb);
    // the two tones (hi-lo), scheduled ahead
    const t0 = ctx.currentTime;
    for (const o of [a, b]) {
      o.frequency.setValueAtTime(620, t0);
      for (let k = 0; k < 4000; k++) o.frequency.setValueAtTime(k % 2 ? 470 : 620, t0 + k * 0.55);
      o.start();
    }
    this.node = { out, a, b };
  }

  // continuous (on/off) or a short warning burst
  set(on, hardStop = false) {
    this.on = on; this.burstT = 0; this.build();
    const ctx = audio.ctx; if (!this.node || !ctx) return;
    const g = this.node.out.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.setTargetAtTime(on ? 0.5 : 0, t, on ? 0.08 : hardStop ? 0.01 : 0.35);
  }
  burst(sec = 1.5) { if (this.on) return; this.set(true); this.burstT = sec; }

  update(dt) {
    if (this.burstT > 0) { this.burstT -= dt; if (this.burstT <= 0 && this.on) this.set(false); }
  }
}
