// NIGHT SHIFT multiplayer - voice chat.
//  * microphone with echo cancellation / noise suppression; mute toggle; mic level meter
//  * PUSH-TO-TALK (default, hold V - rebindable in Settings > Audio) or OPEN MIC. With push-to-talk the
//    mic track is only enabled while the key is held; the speaking indicator lights from the real level
//  * speaker (incoming voice) on/off + teammates' volume
//  * PROXIMITY: each teammate's voice comes from their avatar's head through an HRTF panner with
//    distance falloff (clear up close, faint across the floor, ~silent far away), and is low-passed
//    + attenuated when walls / closed doors are between you (the game's occlusion test).
//  * In the lobby (no positions yet) and for spectating dead players voices are flat and clear.
// Without a microphone (denied / none / insecure page) the player still hears everyone: a silent track
// keeps the call two-way, and the UI says MIC UNAVAILABLE instead of pretending.
import { audio } from '../audio/audio.js';
import { settings } from '../core/settings.js';

export class Voice {
  constructor(net) {
    this.net = net;
    this.micOn = false;          // user intent: mic enabled (not muted)
    this.micAvailable = null;    // null = not asked yet, true/false after the prompt
    this.pttHeld = false;
    this.speakerOn = true;
    this.remotes = new Map();    // peerId -> { el, src, gain, panner, lp, analyser, level }
    this.levels = new Map();     // peerId -> 0..1 (speaking indicator)
    this.myLevel = 0;
    this.spatial = false;
    net.on('voice', (peerId, stream) => this.attach(peerId, stream));
    net.on('voiceend', peerId => this.detach(peerId));
    net.on('leave', m => this.detach(m.peerId));
    settings.onChange((sec, key) => { if (sec === 'audio' || sec === '*') { this.applyTransmit(); this.applySpeaker(); } });
  }

  get ptt() { return settings.data.audio.voiceMode !== 'open'; }
  get pttKey() { return settings.data.audio.pttKey || 'KeyV'; }
  // am I actually sending audio right now?
  get transmitting() { return !!this.mic && this.micOn && (!this.ptt || this.pttHeld); }

  // a stream that always exists: the mic track when allowed, else a silent track
  async init() {
    if (!audio.ready) audio.init();
    const ctx = audio.ctx;
    if (!this.silent && ctx) {
      const dst = ctx.createMediaStreamDestination();
      const o = ctx.createConstantSource(); const g = ctx.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(dst); o.start();
      this.silent = dst.stream;
    }
    this.net.localStream = this.mic || this.silent || new MediaStream();
  }

  async enableMic(on) {
    this.micOn = on;
    if (on && !this.mic) {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia unavailable (needs https or localhost)');
        this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        this.micAvailable = true;
        const track = this.mic.getAudioTracks()[0];
        // swap the silent track for the mic on every open call
        for (const c of this.net.calls.values()) {
          const sender = c.peerConnection?.getSenders().find(s => s.track?.kind === 'audio');
          if (sender) await sender.replaceTrack(track);
        }
        this.net.localStream = this.mic;
        if (audio.ctx) { const s = audio.ctx.createMediaStreamSource(this.mic); this.myAnalyser = audio.ctx.createAnalyser(); this.myAnalyser.fftSize = 512; s.connect(this.myAnalyser); }
      } catch (e) {
        console.warn('[voice] microphone unavailable', e);
        this.micAvailable = false; this.micOn = false;
      }
    }
    this.applyTransmit();
    this.net.setMeta({ mic: this.micOn && !!this.mic });
    return this.micOn;
  }
  toggleMic() { return this.enableMic(!this.micOn); }

  setPTT(held) {
    if (this.pttHeld === held) return;
    this.pttHeld = held;
    this.applyTransmit();
    if (held && this.ptt && this.micOn && this.mic) audio.play('ui_click', { bus: 'ui', volume: 0.12, rate: 1.6 });   // a soft "radio key" click
  }
  applyTransmit() { if (this.mic) for (const t of this.mic.getAudioTracks()) t.enabled = this.transmitting; }

  setSpeaker(on) { this.speakerOn = on; this.applySpeaker(); this.net.setMeta({ spk: on }); }
  applySpeaker() {
    const v = this.speakerOn ? settings.data.audio.chatVolume ?? 1 : 0;
    for (const r of this.remotes.values()) if (!r.cut) r.out.gain.setTargetAtTime(v, audio.ctx.currentTime, 0.05);
  }
  toggleSpeaker() { this.setSpeaker(!this.speakerOn); }
  // the ending: a voice is cut off entirely (nobody hears them / they hear no one)
  cut(peerId) { const r = this.remotes.get(peerId); if (r) { r.cut = true; r.out.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.25); } }
  cutAll() { for (const id of this.remotes.keys()) this.cut(id); }

  attach(peerId, stream) {
    if (!audio.ready) audio.init();
    const ctx = audio.ctx; if (!ctx) return;
    this.detach(peerId);
    // Chrome only feeds remote WebRTC audio into Web Audio when an element is also playing it
    const el = new Audio(); el.srcObject = stream; el.muted = true; el.play().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser(); analyser.fftSize = 512;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000;
    const gain = ctx.createGain(); gain.gain.value = 1;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
    panner.refDistance = 2.2; panner.maxDistance = 60; panner.rolloffFactor = 1.35;
    const out = ctx.createGain(); out.gain.value = this.speakerOn ? settings.data.audio.chatVolume ?? 1 : 0;
    const flat = ctx.createGain(); flat.gain.value = 0;              // lobby / spectator path
    src.connect(analyser); src.connect(lp); lp.connect(gain);
    gain.connect(panner); panner.connect(out);
    gain.connect(flat); flat.connect(out);
    out.connect(audio.bus.voice || audio.master);
    this.remotes.set(peerId, { el, src, gain, panner, lp, analyser, out, flat, buf: new Uint8Array(analyser.fftSize) });
  }
  detach(peerId) {
    const r = this.remotes.get(peerId); if (!r) return;
    try { r.src.disconnect(); r.out.disconnect(); r.el.srcObject = null; } catch { /* ignore */ }
    this.remotes.delete(peerId); this.levels.delete(peerId);
  }

  static rms(an, buf) {
    an.getByteTimeDomainData(buf);
    let s = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
    return Math.sqrt(s / buf.length);
  }

  // positions: peerId -> { pos: Vector3 (head), dead?:bool } ; listenerPos from the camera
  update(positions, listenerPos, occluded) {
    const ctx = audio.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    for (const [id, r] of this.remotes) {
      this.levels.set(id, Math.min(1, Voice.rms(r.analyser, r.buf) * 6));
      const p = positions?.get(id);
      const spatial = this.spatial && p && !p.dead;
      r.flat.gain.setTargetAtTime(spatial ? 0 : 1, t, 0.1);
      r.gain.gain.setTargetAtTime(spatial ? 1 : 0, t, 0.1);
      if (spatial) {
        if (r.panner.positionX) { r.panner.positionX.setTargetAtTime(p.pos.x, t, 0.05); r.panner.positionY.setTargetAtTime(p.pos.y, t, 0.05); r.panner.positionZ.setTargetAtTime(p.pos.z, t, 0.05); }
        else r.panner.setPosition(p.pos.x, p.pos.y, p.pos.z);
        // walls / closed doors between you: muffled and quieter, still audible (you shout)
        const blocked = occluded ? occluded(listenerPos, p.pos) : false;
        r.lp.frequency.setTargetAtTime(blocked ? 900 : 20000, t, 0.12);
        r.gain.gain.setTargetAtTime(blocked ? 0.55 : 1, t, 0.12);
      } else r.lp.frequency.setTargetAtTime(p?.dead ? 2600 : 20000, t, 0.12);   // spectators sound like a radio
    }
    if (this.myAnalyser) { this.myBuf ||= new Uint8Array(this.myAnalyser.fftSize); this.myLevel = this.transmitting ? Math.min(1, Voice.rms(this.myAnalyser, this.myBuf) * 6) : 0; }
  }

  destroy() {
    for (const id of [...this.remotes.keys()]) this.detach(id);
    this.mic?.getTracks().forEach(t => t.stop());
  }
}
