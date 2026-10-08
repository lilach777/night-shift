// Generative creepy piano + tension/chase layers + player breathing.
import { audio } from './audio.js';
import { rand, clamp } from '../core/util.js';

// piano sample index -> semitone label (A minor, with dissonant D#/B)
// 0 A2 1 C3 2 E3 3 F3 4 A3 5 B3 6 C4 7 D#4 8 E4 9 F4 10 A4 11 C5
const MOTIFS = [
  [[4], 0], [[6], 0], [[8], 0], [[3], 0], [[10], 0], [[0], 0], [[7], 0],
  [[4, 9], 0],          // A3 + F4  (minor sixth, uneasy)
  [[6, 7], 0],          // C4 + D#4 (dissonant)
  [[8, 9], 0],          // E4 + F4  (minor second)
  [[5, 9], 0],          // B3 + F4  (tritone)
  [[10, 8, 6], 1.3],    // descending, slow
  [[11, 9, 8], 1.6],
  [[4, 6, 7], 1.1],     // ascending into the wrong note, unresolved
];

export class Music {
  constructor() {
    this.state = 'off';      // off | calm | chase | silent
    this.nextNote = 4;
    this.pianoLevel = 1;     // fades to 0 during chases
    this.tension = null; this.chase = null;
    this.queue = [];
  }

  start() { this.state = 'calm'; this.nextNote = rand(2, 5); }
  stop() { this.state = 'off'; this.stopChase(3); }

  setSilent(s) { this.state = s ? 'silent' : 'calm'; }

  startChase() {
    if (this.state === 'chase') return;
    this.state = 'chase';
    audio.play('stinger_hit', { bus: 'sfx', volume: 0.75 });
    this.chase = audio.play('chase_loop', { bus: 'ambience', loop: true, volume: 0.95, fadeIn: 0.4 });
    this.tension?.stop(1); this.tension = null;
  }

  stopChase(fade = 4) {
    if (this.chase) { this.chase.stop(fade); this.chase = null; }
    if (this.state === 'chase') {
      this.state = 'calm';
      this.nextNote = rand(14, 22); // let silence breathe before the piano returns
      this.tension = audio.play('tension_loop', { bus: 'ambience', loop: true, volume: 0.0 });
      this.tension.setVolume(0.45, 2);
      setTimeout(() => { this.tension?.setVolume(0, 10); }, 9000);
      setTimeout(() => { this.tension?.stop(1); this.tension = null; }, 21000);
    }
  }

  update(dt) {
    const target = this.state === 'calm' ? 1 : 0;
    this.pianoLevel += (target - this.pianoLevel) * Math.min(1, dt * (target ? 0.08 : 1.5));
    if (this.state === 'off') return;
    // play queued notes of a motif
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      q.t -= dt;
      if (q.t <= 0) { this.queue.splice(i, 1); this.note(q.idx, q.vol); }
    }
    if (this.state !== 'calm') return;
    this.nextNote -= dt;
    if (this.nextNote <= 0) {
      const [notes, spacing] = MOTIFS[Math.floor(Math.random() * MOTIFS.length)];
      const vol = rand(0.35, 0.8) * this.pianoLevel;
      notes.forEach((n, i) => this.queue.push({ idx: n, t: spacing ? i * spacing * rand(0.85, 1.25) : i * rand(0, 0.04), vol: vol * (spacing ? 1 - i * 0.12 : 0.8) }));
      // Long, irregular pauses — the piano should be almost subliminal.
      this.nextNote = rand(6, 16) + (Math.random() < 0.25 ? rand(8, 18) : 0);
    }
  }

  note(idx, vol) {
    if (vol < 0.01) return;
    audio.play('piano', { bus: 'music', index: idx, volume: vol, detune: rand(-18, 12), bigReverb: 0.9, reverb: 0.3 });
  }
}

export class Breathing {
  constructor() {
    this.fear = 0;        // 0..1 (monster encounters)
    this.exertion = 0;    // 0..1 (sprinting)
    this.loops = null;
    this.enabled = false;
  }
  start() {
    if (this.loops) return;
    // Arman has NO breathing audio (by design). Fear/exertion are still tracked for other
    // systems; the only body sound kept is a faint heartbeat at high fear.
    this.loops = {
      heart: audio.play('heartbeat', { bus: 'player', loop: true, volume: 0 }),
    };
    this.enabled = true;
  }
  stop() {
    if (!this.loops) return;
    for (const l of Object.values(this.loops)) l.stop(1);
    this.loops = null; this.enabled = false;
  }
  scare(amount = 0.6) {
    const before = this.fear;
    this.fear = clamp(this.fear + amount, 0, 1);
  }
  update(dt, { sprinting, moving, safe }) {
    // Running builds exertion within ~3 s; after stopping it eases back over ~12-15 s
    // (faster while standing still than while walking).
    const recover = moving ? 15 : 11;
    this.exertion = clamp(this.exertion + (sprinting ? dt / 3 : -dt / recover), 0, 1);
    // Fear decays only after several seconds of safety.
    this.safeTime = safe ? (this.safeTime || 0) + dt : 0;
    if (this.safeTime > 6) this.fear = Math.max(0, this.fear - dt / 25);
    if (!this.loops) return;
    this.loops.heart.setVolume(0.5 * clamp((this.fear - 0.3) / 0.5, 0, 1), 1);
  }
}

export const music = new Music();
export const breathing = new Breathing();
