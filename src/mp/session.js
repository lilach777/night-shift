// NIGHT SHIFT multiplayer - the running session (both host and clients).
//
// Authority: the HOST simulates the story, the Koala and the ghosts; it owns doors, shared items,
// furniture and every player's life state. Each client simulates only its own body (the normal
// Player), sends its pose, and asks the host to perform interactions ("req") or holds ("hold").
// The host replies with:
//   snap  (15 Hz)  player poses + life states, Koala, ghosts, changed doors, hold progress, story clock,
//                  the emergency shutter
//   state (on change) the multiplayer story state (objectives, items, locks, power, batteries, furniture)
//   fx    one-shot presentation: sounds, voice lines, subtitles, flashes, teleports...
//   cp    the latest checkpoint (every client keeps it, so any of them can take over as host)
// Robustness: players can drop and come back (same slot, place, items, life), new players can join a
// running night, and if the host disappears the lowest remaining slot takes over (see net.js).
import * as THREE from 'three';
import { audio } from '../audio/audio.js';
import { loadGLB } from '../world/world.js';
import { seededRandom, shuffle } from '../core/util.js';
import { MPStory } from './story.js';
import { MPHunter } from './hunter.js';
import { GhostDirector } from './director.js';
import { LINES } from './lines.js';
import { MP_SAVE_KEY } from './mode.js';
import { keyLabel } from '../ui/ui.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const SNAP_DT = 1 / 15;
const BLEED_SECONDS = 45;
const REVIVE_SECONDS = 3.5;
const TAG_RANGE = 14;
const MP_HEAD_SIGN = -1;     // MPFB game_engine rig: +x on the head bone tips the face down

export class MPSession {
  constructor(g, mode, startMsg) {
    this.g = g; this.mode = mode; this.net = mode.net; this.voice = mode.voice;
    this.isHost = this.net.isHost;
    this.meSlot = this.net.me.slot;
    this.players = new Map();       // slot -> player record
    this.doorsSent = new Map();
    this.holds = new Map();         // host: id -> Map(slot -> seconds held)
    this.holdProgress = {};         // id -> 0..1 (host computes, everyone displays)
    this.myHold = null;
    this.t = 0; this.sendT = 0;
    this.ghostObjs = new Map();
    this.checkpoint = startMsg.checkpoint || null;
    this.ended = false;
    for (const r of startMsg.roster) this.addPlayer(r);
    if (!this.players.has(this.meSlot)) this.addPlayer({ slot: this.meSlot, peerId: this.net.peer?.id, name: this.net.me.name });
    this.story = new MPStory(this, startMsg);
    if (this.isHost) this.makeHostSystems();
    this.net.on('msg', (m, from) => this.onMsg(m, from));
    this.net.on('leave', m => this.onLeave(m));
    this.net.on('roster', r => this.syncRoster(r));
    this.ui = {
      list: document.getElementById('mp-obj-list'), team: document.getElementById('mp-team'),
      warn: document.getElementById('mp-warning'), prog: document.getElementById('mp-progress'),
      downed: document.getElementById('mp-downed'), dead: document.getElementById('mp-dead'),
      mic: document.getElementById('mp-voice-mic'), spk: document.getElementById('mp-voice-spk'),
    };
    this.tagsEl = document.getElementById('mp-tags');
    if (!this.tagsEl) { this.tagsEl = document.createElement('div'); this.tagsEl.id = 'mp-tags'; document.getElementById('app').appendChild(this.tagsEl); }
  }

  makeHostSystems() {
    if (!this.hunter) this.hunter = new MPHunter(this.g, this);
    if (!this.director) this.director = new GhostDirector(this.g, this);
  }

  get me() { return this.players.get(this.meSlot); }
  get roster() { return [...this.players.values()]; }
  alivePlayers() { return this.roster.filter(p => p.life === 'alive'); }
  standing() { return this.roster.filter(p => p.life !== 'dead'); }

  addPlayer(r) {
    if (this.players.has(r.slot)) { const p = this.players.get(r.slot); p.peerId = r.peerId; p.name = r.name; return p; }
    const p = {
      slot: r.slot, peerId: r.peerId, name: r.name, model: 'crew_' + (r.slot + 1),
      pos: V(-27, 0, (r.slot - 1.5) * 1.3), yaw: -Math.PI / 2, pitch: 0, speed: 0,
      crouch: false, sprint: false, flash: false, hidden: false, seated: false,
      life: 'alive', bleed: 0, net: { pos: V(-27, 0, (r.slot - 1.5) * 1.3), yaw: -Math.PI / 2, pitch: 0 }, avatar: null, level: '1',
      head: V(), lastNoise: 0, hasFlash: false, battery: 100, spares: 0,
    };
    this.players.set(r.slot, p);
    return p;
  }

  // ------------------------------------------------------------------ start (fresh, late join or rejoin)
  async begin(msg = {}) {
    const g = this.g;
    await g.ensureKoala().catch(() => {});
    await this.story.preload();
    g.seed = this.story.state.seed;
    this.setupSharedBatteries();
    this.syncFurniture();
    await Promise.all(this.roster.map(p => this.loadAvatar(p)));
    await this.loadSelfAvatar();
    this.story.build();
    this.story.applyState();
    this.restrictClosets();
    if (this.isHost && !msg.state?.step && msg.t !== 'resume') { this.story.start(); this.saveCheckpoint('start', true); }
    else if (this.isHost) this.story.start();
    // where do I stand?
    const you = msg.you;
    if (you?.pos) {
      g.player.teleport(you.pos[0], you.pos[1], you.pos[2], you.yaw ?? 0);
      if (you.hasFlash) { g.flashlight.give(); g.flashlight.battery = you.battery ?? 100; g.flashlight.spares = you.spares ?? 0; g.flashlight.toggle(true); }
    } else {
      const sp = this.story.spawnFor(this.meSlot, 'start');
      g.player.teleport(sp.x, sp.y, sp.z, sp.yaw);
    }
    if (msg.players) this.applyLives(msg.players);
    if (msg.koala) this.applyKoala(msg.koala);
    if (msg.t === 'resume' && msg.rejoin) g.ui.toast('RECONNECTED - YOUR SLOT, PLACE AND ITEMS ARE BACK', 3.5);
    if (msg.t === 'start' && !(msg.state?.step > 0)) this.story.startArrival();      // a fresh night opens on the shot
    this.voice.spatial = true;
    this.net.connectVoice();
    this.started = true;
  }

  async loadModel(model) {
    const g = this.g;
    if (!g.world.humans[model]) {
      try { g.world.humans[model] = await loadGLB(`assets/models/${model}.glb`); }
      catch (e) { console.warn('[mp] avatar', model, e.message); return false; }
    }
    return true;
  }
  async loadAvatar(p) {
    const g = this.g;
    if (p.slot === this.meSlot || p.avatar) return;
    if (!(await this.loadModel(p.model))) return;
    if (!this.players.has(p.slot) || p.avatar) return;
    const a = g.world.item(p.model);
    for (const k of ['down', 'interact']) { const ac = a.userData.actions?.[k]; if (ac) { ac.setLoop(THREE.LoopOnce, 1); ac.clampWhenFinished = true; } }
    g.scene.add(a);
    // the teammate's own flashlight (no shadows: up to three of them at once)
    const spot = new THREE.SpotLight(0xffe2bc, 0, 22, 0.46, 0.3, 1.4);
    spot.position.set(0.22, 1.35, 0.3);
    a.add(spot); g.scene.add(spot.target);
    a.position.copy(p.pos);
    p.avatar = a; p.spot = spot;
    // teammates are solid
    g.player.bodies.push(() => (p.avatar && p.life !== 'dead' && p.avatar.visible && this.players.get(p.slot) === p ? p.avatar.position : null));
  }
  // my own body: never drawn by my camera (layer 0), only by the lobby mirror (layer 1) and the
  // security cameras (layer 2) - so the crew sees themselves on CCTV and in the mirror
  async loadSelfAvatar() {
    const me = this.me; if (!me || this.selfAvatar) return;
    if (!(await this.loadModel(me.model))) return;
    const a = this.g.world.item(me.model);
    a.traverse(o => { o.layers.set(1); o.layers.enable(2); });
    this.g.scene.add(a);
    this.selfAvatar = a;
  }
  removePlayer(slot) {
    const p = this.players.get(slot); if (!p) return;
    p.avatar?.removeFromParent(); p.spot?.target.removeFromParent();
    this.tagEl(p)?.remove();
    this.players.delete(slot);
  }

  // the roster changed (join, leave, reconnect, migration): bring the players map in line
  syncRoster(roster) {
    if (!this.started) return;
    for (const r of roster) {
      if (!this.players.has(r.slot)) {
        const p = this.addPlayer(r);
        this.loadAvatar(p).then(() => this.registerReviveTarget(p));
      } else { const p = this.players.get(r.slot); p.peerId = r.peerId; p.name = r.name; }
    }
    if (!this.isHost) for (const p of this.roster) if (p.slot !== this.meSlot && !roster.some(r => r.slot === p.slot)) this.removePlayer(p.slot);
    this.net.connectVoice();
  }

  // ------------------------------------------------------------------ messaging
  request(action, data = {}) { this.net.send({ t: 'req', a: action, d: data }); }

  onMsg(m, from) {
    if (m.t === 'snap' && !this.isHost) return this.applySnap(m);
    if (m.t === 'state' && !this.isHost) { this.story.state = m.s; this.story.applyState(); return; }
    if (m.t === 'fx') { if (m.to == null || m.to === this.meSlot) this.runFx(m.k, m.d || {}); return; }
    if (m.t === 'cp' && !this.isHost) { this.checkpoint = m.cp; return; }
    if (m.t === 'resync' && !this.isHost) { this.story.state = m.state; this.story.applyState(); if (m.cp) this.checkpoint = m.cp; if (m.players) this.applyLives(m.players); this.g.ui.toast('CONNECTION RESTORED', 2.4); return; }
    if (!this.isHost) return;
    const slot = from ? from.slot : this.meSlot;
    const p = this.players.get(slot); if (!p) return;
    if (m.t === 'p') {                               // a client's own pose
      p.net.pos.set(m.x, m.y, m.z); p.net.yaw = m.yw; p.net.pitch = m.pt;
      p.speed = m.sp; p.crouch = !!m.c; p.sprint = !!m.s; p.flash = !!m.f; p.hidden = !!m.h; p.seated = !!m.st;
      p.level = m.lv; p.hasFlash = !!m.hf; if (m.bt != null) p.battery = m.bt; if (m.sx != null) p.spares = m.sx;
      return;
    }
    if (m.t === 'req') return this.handleReq(slot, m.a, m.d || {});
    if (m.t === 'hold') { this.setHold(slot, m.id, m.on); return; }
  }

  // host-side: everything a player asks for goes through here
  handleReq(slot, a, d) {
    const p = this.players.get(slot); if (!p) return;
    if (a === 'endanswer') return this.story.handle(slot, a, d);
    if (p.life !== 'alive') return;
    if (a === 'door') {
      const door = this.g.world.doorById[d.id];
      if (door?.locked && this.story.storyDoor(d.id)) return this.story.handle(slot, a, d);   // keycard / key locks
      if (!door || door.locked) return;
      door.toggle();
      return;
    }
    if (a === 'batt') return this.takeBattery(slot, d.id);
    if (a === 'part') return this.movePart(slot, d.i, d.v);
    this.story.handle(slot, a, d);
  }

  setHold(slot, id, on) {
    if (!this.holds.has(id)) this.holds.set(id, new Map());
    const h = this.holds.get(id);
    if (on) { if (!h.has(slot)) h.set(slot, 0); } else h.delete(slot);
  }
  // host: who is holding what, and for how long (cleared when they let go / move away)
  holding(id) { return this.holds.get(id) || new Map(); }

  // one-shot presentation for everyone (or one player): run here + send
  fx(k, d = {}, to = null) {
    if (to == null || to === this.meSlot) this.runFx(k, d);
    if (this.isHost) this.net.broadcast({ t: 'fx', k, d, to });
  }

  runFx(k, d) {
    const g = this.g;
    switch (k) {
      case 'sound': {
        if (d.pos) audio.playAt(d.id, V(...d.pos), d.o || {});
        else audio.play(d.id, d.o || {});
        break;
      }
      case 'line': {                                       // a voice line with its subtitle
        const L = LINES[d.id]; if (!L) break;
        // one line at a time per speaker: a new PA / phone line fades the previous one out
        const kind = d.id.startsWith('mp_pa') ? 'pa' : 'phone';
        this.lineH = this.lineH || {};
        this.lineH[kind]?.stop(0.12);
        const opts = { bus: 'voice', volume: L.volume ?? 1, ...(d.o || {}) };
        // the PA is heard everywhere, in the space you are in (reverb); the phone is a point source
        this.lineH[kind] = d.pos ? audio.playAt(d.id, V(...d.pos), { ...opts, refDistance: 4, reverb: 0.15 })
          : audio.play(d.id, { ...opts, reverb: kind === 'pa' ? 0.55 : 0 });
        if (L.text) g.ui.subtitle(L.text, L.who, L.dur || 4);
        break;
      }
      case 'sub': g.ui.subtitle(d.text, d.who || '', d.dur || 4); break;
      case 'thought': g.ui.thought(d.text, d.dur || 4); break;
      case 'toast': g.ui.toast(d.text, d.dur || 2.6); break;
      case 'timecard': g.ui.timecard(d.text, d.dur || 3); break;
      case 'shake': g.player.shake(d.a ?? 0.5, d.t ?? 0.5); break;
      case 'flicker': g.flashlight.flicker(d.t ?? 0.6, d.a ?? 1); if (d.lights) g.world.lights.surgeFlicker(d.lights); break;
      case 'scare': g.breathing.scare(d.a ?? 0.5); g.post.pulse?.(d.p ?? 0.5, 0.4); break;
      case 'flash': g.ui.flash(d.a ?? 0.5, d.c || '#fff'); break;
      case 'fade': g.ui.fade(d.to ?? 1, d.t ?? 1); break;
      case 'kvocal': g.koala?.visible && g.koala.vocal(d.id, d.v ?? 1, d.o || {}); break;
      case 'teleport': g.player.teleport(d.x, d.y, d.z, d.yaw ?? g.player.yaw); g.player.stand?.(); break;
      case 'chill':                                          // a ghost touched you: cold, dark, breathless
        g.ui.flash(0.45, '#bcd3e6'); g.player.shake(0.6, 0.6); g.flashlight.flicker(2.2, 1);
        g.player.stamina = 0; g.player.exhausted = true; g.breathing.scare(0.8);
        audio.play('stinger_hit', { bus: 'sfx', volume: 0.35 });
        break;
      case 'downed': this.onDowned(d); break;
      case 'revived': this.onRevived(d); break;
      case 'respawn': this.onRespawn(d); break;
      case 'wipe': this.onWipe(d); break;
      case 'battery': g.flashlight.addSpare(1); audio.play('pickup', { bus: 'player', volume: 0.7 }); g.ui.toast('BATTERY  +1'); break;
      case 'part': this.applyPart(d.i, d.v, true); break;
      default: this.story.fx(k, d);
    }
  }

  // ------------------------------------------------------------------ shared world objects
  // BATTERIES: the same seeded spots as the hospital uses; one pickup exists once for the whole crew.
  setupSharedBatteries() {
    const g = this.g, L = g.layout;
    const rnd = seededRandom((this.story.state.seed || 1) + 77);
    const spots = shuffle(L.batterySpots, rnd).slice(0, 8);
    this.batteries = new Map();
    spots.forEach((s, i) => {
      const id = `${s.room}_${i}`;
      const m = g.world.item('battery');
      m.position.set(s.x, s.y, s.z); m.rotation.y = rnd() * 3;
      g.scene.add(m);
      this.batteries.set(id, m);
      g.interact.add({
        id: 'batt_' + id, pos: new THREE.Vector3(s.x, s.y + 0.03, s.z), radius: 1.9, cone: 0.35,
        enabled: () => g.flashlight.has && m.visible && !this.story.state.batt?.includes(id) && this.me.life === 'alive',
        prompt: () => '[E] Take Batteries',
        action: () => { m.visible = false; this.request('batt', { id }); },      // hidden at once; the host confirms
      });
    });
  }
  takeBattery(slot, id) {
    const s = this.story.state;
    s.batt = s.batt || [];
    if (!this.batteries.has(id) || s.batt.includes(id)) { this.story.push(); return; }   // already gone: re-sync the asker
    s.batt.push(id);
    this.fx('battery', {}, slot);
    this.story.push();
  }
  // FURNITURE: every drawer / cabinet / locker / closet door goes through the host; the state lives in
  // the story state (late joiners and reconnects get it), each change is broadcast as it happens.
  syncFurniture() {
    const parts = this.g.containers.parts;
    parts.forEach((part, i) => {
      part.onToggle = () => { if (!this._applyingPart) this.request('part', { i, v: part.target }); };
    });
  }
  movePart(slot, i, v) {
    const s = this.story.state; s.parts = s.parts || {};
    const part = this.g.containers.parts[i]; if (!part) return;
    s.parts[i] = v ? 1 : 0;
    this.fx('part', { i, v: s.parts[i] });
  }
  applyPart(i, v, sound) {
    const part = this.g.containers.parts[i]; if (!part) return;
    if ((part.target > 0.5) === (v > 0.5)) return;
    this._applyingPart = true;
    if (sound) part.toggle(); else { part.target = v; part.amount = v; part.update(0); }
    this._applyingPart = false;
  }
  // called by the story whenever a state arrives
  applyWorldSync(s) {
    if (this.batteries) for (const [id, m] of this.batteries) m.visible = !(s.batt || []).includes(id);
    if (s.parts) for (const [i, v] of Object.entries(s.parts)) this.applyPart(+i, v, false);
  }
  // one hider per closet
  restrictClosets() {
    const g = this.g;
    for (const rec of g.hiding.closets) {
      const it = g.interact.get('hide_' + rec.def.prop); if (!it) continue;
      const base = it.enabled;
      it.enabled = () => base() && this.me.life === 'alive' && !this.roster.some(p => p.slot !== this.meSlot && p.hidden && p.pos.distanceTo(rec.inside) < 0.9);
    }
  }

  // ------------------------------------------------------------------ joining / leaving mid-night (host)
  onJoin(member, resume) {
    if (!this.isHost) return;
    const s = this.story.state;
    let p = this.players.get(member.slot);
    const fresh = !p;
    if (!p) { p = this.addPlayer(member); this.loadAvatar(p).then(() => this.registerReviveTarget(p)); }
    p.peerId = member.peerId; p.name = member.name;
    const data = resume && resume.departed;
    let you;
    if (resume === 'live' && !fresh) {
      // the same player on a new connection (migration or a quick reconnect): just bring them up to date
      this.net.sendTo(member.peerId, { t: 'resync', state: s, cp: this.checkpoint, players: this.livesPacket() });
      return;
    }
    if (data) {
      p.life = data.life === 'dead' ? 'dead' : data.life; p.bleed = data.bleed || 0;
      p.pos.fromArray(data.pos); p.net.pos.fromArray(data.pos); p.yaw = p.net.yaw = data.yaw;
      p.hasFlash = data.hasFlash;
      you = { pos: data.pos, yaw: data.yaw, hasFlash: data.hasFlash, battery: data.battery, spares: data.spares };
    } else {
      // a new crew member: arrives next to a living teammate, with a flashlight if the call is done
      const mate = this.alivePlayers().find(q => q.slot !== p.slot) || this.me;
      const at = this.freeSpotNear(mate.pos);
      p.pos.copy(at); p.net.pos.copy(at); p.life = 'alive';
      const give = s.callDone;
      if (give && !s.flashTaken.includes(p.slot)) s.flashTaken.push(p.slot);
      you = { pos: at.toArray(), yaw: mate.yaw, hasFlash: give, battery: 100, spares: 1 };
      this.fx('toast', { text: `${p.name} JOINED THE NIGHT`, dur: 3 });
    }
    s.n = this.roster.length;
    this.net.sendTo(member.peerId, {
      t: 'resume', rejoin: !!data, seed: s.seed, roster: this.net.pubRoster(), state: s, cp: this.checkpoint,
      checkpoint: this.checkpoint, you, players: this.livesPacket(), koala: this.koalaPacket(),
    });
    this.story.push();
  }
  freeSpotNear(pos) {
    const ph = this.g.world.physics;
    for (let r = 0.9; r < 3; r += 0.5) for (let a = 0; a < 6.28; a += 0.8) {
      const v = V(pos.x + Math.cos(a) * r, pos.y, pos.z + Math.sin(a) * r), q = v.clone(); ph.collide(q, 0.3, 1.7);
      if (q.distanceTo(v) < 0.02 && ph.groundAt(v.x, v.z, pos.y + 0.3) > -Infinity && ph.los(pos.clone().setY(pos.y + 1.2), v.clone().setY(v.y + 1.2))) return v;
    }
    return pos.clone();
  }
  livesPacket() { return this.roster.map(p => [p.slot, p.life, Math.ceil(p.bleed)]); }
  applyLives(list) { for (const [slot, life, bleed] of list) { const p = this.players.get(slot); if (p) { const prev = p.life; p.life = life; p.bleed = bleed; if (slot === this.meSlot && prev !== life) this.lifeChangedLocal(prev, life); } } }
  koalaPacket() { const k = this.g.koala; return k?.visible ? [1, k.position.x, k.position.y, k.position.z, k.root.rotation.y, k.root.rotation.z, k.currentName || 'idle', k.speed || 0] : [0]; }
  applyKoala(K) { this.applySnap({ P: [], K, D: [], G: [], H: {} }); }

  onLeave(m) {
    const p = this.players.get(m.slot);
    if (!p) return;
    // the host remembers where they were and what they had: a reconnect puts all of it back
    if (this.isHost && m.token) this.net.stashDeparted(m.token, { pos: p.pos.toArray(), yaw: p.yaw, life: p.life, bleed: p.bleed, hasFlash: p.hasFlash, battery: p.battery, spares: p.spares });
    this.removePlayer(m.slot);
    this.g.ui.toast(`${m.name} LEFT THE PARTY`, 3);
    if (this.isHost) { this.story.onLeave(m.slot); this.story.state.n = this.roster.length; }
  }

  // ------------------------------------------------------------------ host migration
  async hostLost() {
    if (this.migrating || this.isHost) return;
    if (this.story.state.done && this.story.endPhase === 'over') return;
    const net = this.net;
    const lost = net.roster.find(r => r.host);
    const succ = net.successor(lost?.peerId);
    this.migrating = true;
    if (lost) {
      const lp = this.players.get(lost.slot);
      if (lp) {
        this.g.ui.toast(`${lp.name} (HOST) LEFT - HANDING OVER THE NIGHT...`, 4);
        // whatever they carried falls where they stood
        for (const f of this.story.state.fuses || []) if (f.st === 'carried' && f.by === lost.slot) { f.st = 'dropped'; f.by = -1; f.pos = [lp.pos.x, lp.pos.y + 0.05, lp.pos.z]; f.where = lp.name; }
      }
      this.removePlayer(lost.slot);
    }
    if (!succ) { this.failMigration(); return; }
    if (succ.peerId === net.peer?.id) {
      net.promote();
      this.becomeHost();
    } else {
      const ok = await net.follow(succ, this.me?.name || 'PLAYER');
      if (!ok) { this.failMigration(); return; }
    }
    this.migrating = false;
  }
  failMigration() {
    this.migrating = false;
    this.g.ui.timecard('LOST THE CONNECTION TO THE PARTY', 3.5);
    setTimeout(() => this.mode.exitToMenu(), 3800);
  }
  becomeHost() {
    this.isHost = true;
    this.makeHostSystems();
    for (const p of this.roster) if (p.slot !== this.meSlot) { p.net.pos.copy(p.pos); p.net.yaw = p.yaw; }
    this.holds.clear(); this.doorsSent.clear();
    for (const d of this.g.world.doors) if (d.locked === 'mp' && !['door_103', 'door_B10', this.story.P.safeDoor].includes(d.id)) d.locked = null;
    this.story.resumeAsHost();
    if (this.checkpoint) this.saveCheckpointLocal(this.checkpoint);
    this.g.ui.toast('YOU ARE NOW THE HOST', 3);
  }

  // ------------------------------------------------------------------ life: downed / revive / dead
  // host
  down(slot, cause = 'koala') {
    const p = this.players.get(slot);
    if (!p || p.life !== 'alive' || this.ended) return;
    if (import.meta.env.DEV && this.g.godMode) return;        // dev test runs only
    p.life = 'down'; p.bleed = BLEED_SECONDS;
    this.story.onDowned(slot);
    this.fx('downed', { slot, cause });
  }
  revive(slot, by) {
    const p = this.players.get(slot); if (!p || p.life !== 'down') return;
    p.life = 'alive'; p.bleed = 0;
    this.fx('revived', { slot, by });
  }
  kill(slot) {
    const p = this.players.get(slot); if (!p || p.life === 'dead') return;
    p.life = 'dead';
    this.fx('toast', { text: `${p.name} DIED`, dur: 3 });
  }

  onDowned(d) {
    const g = this.g, p = this.players.get(d.slot);
    if (d.slot === this.meSlot) {
      audio.play('jumpscare_hit', { bus: 'monster', volume: 0.9 });
      g.player.shake(1.1, 0.9); g.post.pulse?.(1.0, 0.8); g.flashlight.flicker(0.8, 0.8);
      g.breathing.scare(1);
      g.hiding?.current && g.hiding.forceOut();
      if (this.story.inChair) this.story.standUp(); else g.player.stand?.();
    } else if (p) g.ui.toast(`${p.name} IS DOWN - REVIVE THEM`, 3.5);
  }
  onRevived(d) {
    const p = this.players.get(d.slot), by = this.players.get(d.by);
    if (d.slot === this.meSlot) { this.g.ui.toast(`REVIVED${by ? ' BY ' + by.name : ''}`, 2.5); this.g.player.stamina = 0.5; }
    else if (p) this.g.ui.toast(`${p.name} IS BACK UP`, 2.2);
  }
  onRespawn(d) {
    if (d.slot !== this.meSlot) return;
    this.g.player.teleport(d.x, d.y, d.z, d.yaw);
    this.g.ui.toast('YOU REJOIN THE GROUP', 3);
  }
  onWipe() {
    const g = this.g;
    g.ui.fadeInstant(1);
    g.ui.timecard('EVERYONE IS DOWN', 2.4);
    audio.stopAll(0.2, ['ui', 'voice']);
    this.story.klaxon.set(false, true);
    setTimeout(() => { g.ui.fade(0, 2); g.ui.toast('BACK TO THE LAST CHECKPOINT', 3); }, 2600);
  }

  // ------------------------------------------------------------------ checkpoints
  saveCheckpoint(name, quiet = false) {
    if (!this.isHost) return;
    this.checkpoint = { name, state: JSON.parse(JSON.stringify(this.story.state)), at: Date.now() };
    this.saveCheckpointLocal(this.checkpoint);
    this.net.broadcast({ t: 'cp', cp: this.checkpoint });
    // dead players rejoin at a checkpoint
    for (const p of this.roster) {
      if (p.life === 'dead') {
        p.life = 'alive';
        const sp = this.story.spawnFor(p.slot, name);
        this.fx('respawn', sp && { slot: p.slot, ...sp });
      }
    }
    if (!quiet) this.fx('toast', { text: 'CHECKPOINT', dur: 2 });
  }
  saveCheckpointLocal(cp) { try { localStorage.setItem(MP_SAVE_KEY, JSON.stringify({ ...cp, code: this.net.code })); } catch { /* storage off */ } }

  wipe() {
    if (!this.isHost || this.wiping) return;
    this.wiping = true;
    this.fx('wipe', {});
    setTimeout(() => {
      const cp = this.checkpoint;
      this.hunter?.reset(); this.director?.reset();
      if (cp) this.story.restore(cp.state);
      for (const p of this.roster) {
        p.life = 'alive'; p.bleed = 0;
        const sp = this.story.spawnFor(p.slot, cp?.name || 'start');
        this.fx('teleport', sp, p.slot);
      }
      for (const [, h] of this.holds) h.clear();
      this.wiping = false;
    }, 2400);
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const g = this.g;
    this.t += dt;
    const me = this.me; if (!me) return;
    // ---- my own pose
    const pl = g.player;
    me.pos.copy(pl.pos); me.yaw = pl.yaw; me.pitch = pl.pitch;
    me.speed = Math.hypot(pl.vel.x, pl.vel.z); me.crouch = pl.crouching; me.sprint = pl.sprinting;
    me.flash = g.flashlight.on && g.flashlight.has; me.hidden = !!g.hiding?.hidden; me.seated = !!pl.seated;
    me.level = pl.level; me.hasFlash = g.flashlight.has; me.battery = Math.round(g.flashlight.battery); me.spares = g.flashlight.spares;
    me.head.set(pl.pos.x, pl.pos.y + pl.eye, pl.pos.z);
    this.applyLifeToLocal(dt);
    // ---- network out
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = SNAP_DT;
      if (this.isHost) this.sendSnap();
      else this.net.send({ t: 'p', x: +me.pos.x.toFixed(3), y: +me.pos.y.toFixed(3), z: +me.pos.z.toFixed(3), yw: +me.yaw.toFixed(3), pt: +me.pitch.toFixed(3), sp: +me.speed.toFixed(2), c: me.crouch ? 1 : 0, s: me.sprint ? 1 : 0, f: me.flash ? 1 : 0, h: me.hidden ? 1 : 0, st: me.seated ? 1 : 0, lv: me.level, hf: me.hasFlash ? 1 : 0, bt: me.battery, sx: me.spares });
    }
    // ---- hold-to-interact (co-op tasks, revives)
    this.updateHold(dt);
    // ---- host simulation
    if (this.isHost) {
      for (const p of this.roster) if (p.slot !== this.meSlot) { p.pos.copy(p.net.pos); p.yaw = p.net.yaw; p.pitch = p.net.pitch; }
      for (const p of this.roster) p.head.set(p.pos.x, p.pos.y + (p.life === 'down' ? 0.45 : p.crouch ? 1.02 : 1.62), p.pos.z);
      this.updateLifeHost(dt);
      this.story.update(dt);
      this.hunter.update(dt);
      this.director.update(dt);
    } else {
      // smooth teammates toward their last networked pose
      const k = Math.min(1, dt * 12);
      for (const p of this.roster) if (p.slot !== this.meSlot) {
        p.pos.lerp(p.net.pos, k); p.yaw += (((p.net.yaw - p.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * k; p.pitch += (p.net.pitch - p.pitch) * k;
        p.head.set(p.pos.x, p.pos.y + (p.life === 'down' ? 0.45 : p.crouch ? 1.02 : 1.62), p.pos.z);
      }
      this.updateKoalaClient(dt);
      this.story.update(dt);
    }
    this.updateAvatars(dt);
    this.updateGhostObjs(dt);
    // the Koala animates / sounds on every machine from the same pose
    const kk = g.koala;
    if (kk?.visible) kk.update(dt, g.listenerPos || g.camera.position, this.litLocal(kk.headPos));
    // ---- voice: proximity from avatars
    const pos = new Map();
    for (const p of this.roster) if (p.slot !== this.meSlot) pos.set(p.peerId, { pos: p.head, dead: p.life === 'dead' || this.me.life === 'dead' });
    this.voice.update(pos, g.listenerPos || g.camera.position, (a, b) => !g.world.physics.los(a, b));
    this.updateHUD(dt);
    this.updateTags(dt);
    this.postCamera();
  }

  litLocal(p) {
    const g = this.g, fl = g.flashlight, cam = g.camera;
    if (fl.on && fl.has && cam.position.distanceTo(p) < 20) {
      const fwd = V(0, 0, -1).applyQuaternion(cam.quaternion);
      if (fwd.dot(p.clone().sub(cam.position).normalize()) > Math.cos(0.5)) return true;
    }
    return g.world.flash > 0.3;
  }

  sendSnap() {
    const g = this.g;
    const P = this.roster.map(p => [p.slot, +p.pos.x.toFixed(3), +p.pos.y.toFixed(3), +p.pos.z.toFixed(3), +p.yaw.toFixed(3), +p.pitch.toFixed(3),
      (p.crouch ? 1 : 0) | (p.sprint ? 2 : 0) | (p.flash ? 4 : 0) | (p.hidden ? 8 : 0) | (p.seated ? 16 : 0) | (p.hasFlash ? 32 : 0),
      +p.speed.toFixed(2), p.life, Math.ceil(p.bleed)]);
    const k = g.koala;
    const K = k && k.visible ? [1, +k.position.x.toFixed(3), +k.position.y.toFixed(3), +k.position.z.toFixed(3), +k.root.rotation.y.toFixed(3), +k.root.rotation.z.toFixed(3), k.currentName || 'idle', +(k.speed || 0).toFixed(2)] : [0];
    const D = [];
    for (const d of g.world.doors) {
      const key = `${d.target.toFixed(2)}|${d.locked ? 1 : 0}`;
      if (this.doorsSent.get(d.id) !== key) { this.doorsSent.set(d.id, key); D.push([d.id, +d.target.toFixed(2), d.locked ? 1 : 0, +(d.speed || 1.2).toFixed(2)]); }
    }
    if (this.t % 2 < SNAP_DT) this.doorsSent.clear();          // periodic full door resync
    const G = this.director.snapshot();
    const C = Math.round((this.story.state.clock ?? 100) * 10) / 10;
    const SH = this.story.shutter ? +this.story.shutter.amount.toFixed(3) : 1;
    this.net.broadcast({ t: 'snap', P, K, D, G, H: this.holdProgress, C, SH });
    this.g.ui.setClock(this.story.clockText(), !this.story.state.ending);
  }

  applySnap(m) {
    const g = this.g;
    for (const [slot, x, y, z, yw, pt, fl, sp, life, bleed] of m.P) {
      const p = this.players.get(slot); if (!p) continue;
      const prevLife = p.life;
      p.life = life; p.bleed = bleed;
      if (slot === this.meSlot) { if (prevLife !== life) this.lifeChangedLocal(prevLife, life); continue; }
      p.net.pos.set(x, y, z); p.net.yaw = yw; p.net.pitch = pt;
      p.crouch = !!(fl & 1); p.sprint = !!(fl & 2); p.flash = !!(fl & 4); p.hidden = !!(fl & 8); p.seated = !!(fl & 16); p.hasFlash = !!(fl & 32);
      p.speed = sp;
    }
    // Koala
    const k = g.koala;
    if (k && m.K) {
      if (m.K[0]) {
        const [, x, y, z, ry, rz, anim, sp] = m.K;
        if (!k.visible) { k.show(V(x, y, z), ry, anim); this.kNet = V(x, y, z); }
        this.kNet = this.kNet || V(); this.kNet.set(x, y, z); this.kRy = ry; k.root.rotation.z = rz;
        if (k.currentName !== anim && k.actions[anim]) k.play(anim, { fade: 0.2, vary: false });
        k.speed = sp;
      } else if (k.visible) k.hide();
    }
    for (const [id, target, locked, speed] of m.D || []) {
      const d = g.world.doorById[id]; if (!d) continue;
      d.locked = locked ? (d.locked || 'mp') : null;
      if (Math.abs(d.target - target) > 0.01) { if (target > d.target) d.open(speed); else d.close(speed); }
    }
    this.ghostSnap = m.G || [];
    this.holdProgress = m.H || {};
    if (m.C != null && this.story.state) { this.story.state.clock = m.C; this.g.ui.setClock(this.story.clockText(), !this.story.state.ending); }
    if (m.SH != null) this.story.netShutter = m.SH;
  }

  updateKoalaClient(dt) {
    const k = this.g.koala;
    if (!k?.visible || !this.kNet) return;
    k.position.lerp(this.kNet, Math.min(1, dt * 10));
    let d = this.kRy - k.root.rotation.y; d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    k.root.rotation.y += d * Math.min(1, dt * 10);
  }

  updateGhostObjs(dt) {
    const g = this.g;
    const list = this.isHost ? this.director.snapshot() : (this.ghostSnap || []);
    const seen = new Set();
    for (const [id, x, y, z, ry, anim, layer, sc] of list) {
      seen.add(id);
      let o = this.ghostObjs.get(id);
      if (!o) {
        o = g.world.item('ghost'); o.position.set(x, y, z); o.rotation.y = ry;
        if (layer === 2) o.traverse(c => c.layers.set(2));
        g.scene.add(o); this.ghostObjs.set(id, o);
        o.userData.play?.(anim, 0);
      }
      o.position.lerp(V(x, y, z), this.isHost ? 1 : Math.min(1, dt * 10));
      o.rotation.y = ry;
      if (sc) o.scale.setScalar(sc * 1.08);
      if (o.userData.currentName !== anim) o.userData.play?.(anim, 0.15);
    }
    for (const [id, o] of this.ghostObjs) if (!seen.has(id)) { o.removeFromParent(); this.ghostObjs.delete(id); }
  }

  // body animation from the networked pose: speed-matched gait, crouch, downed, seated, torch idle
  animateBody(a, p, dt) {
    const U = a.userData;
    let clip = 'idle', ts = 1;
    if (p.life !== 'alive') clip = 'down';
    else if (p.seated) clip = 'crouch';
    else if (p.crouch) { clip = p.speed > 0.25 ? 'crouchwalk' : 'crouch'; ts = Math.max(0.6, p.speed / 1.2); }
    else if (p.speed > 4.0) { clip = 'sprint'; ts = p.speed / 5.4; }
    else if (p.speed > 1.9) { clip = 'jog'; ts = p.speed / 3.2; }
    else if (p.speed > 0.25) { clip = 'walk'; ts = p.speed / 1.3; }
    else if (p.flash) clip = 'torch';
    if (U.currentName !== clip) U.play?.(clip, clip === 'down' ? 0.2 : 0.3);
    U.current?.setEffectiveTimeScale(Math.min(2.2, Math.max(0.5, ts)));
    // turning in place: the body follows the view with a little lag and lean instead of snapping
    const want = p.yaw + Math.PI;
    let d = want - (a.userData.bodyYaw ?? want); d = Math.atan2(Math.sin(d), Math.cos(d));
    a.userData.bodyYaw = (a.userData.bodyYaw ?? want) + d * Math.min(1, dt * (p.speed > 0.3 ? 14 : 7));
    a.rotation.y = a.userData.bodyYaw;
    a.rotation.z += ((p.speed > 2 ? Math.max(-0.08, Math.min(0.08, -d * 0.35)) : 0) - a.rotation.z) * Math.min(1, dt * 6);
    // where they look: the head (and a little of the neck) follows the networked view pitch, layered
    // on top of the animation clip (the mixer has already posed the bones this frame)
    if (U.headBone === undefined) { U.headBone = a.getObjectByName('head') || null; U.neckBone = a.getObjectByName('neck_01') || null; }
    if (U.headBone && p.life === 'alive') {
      U.lookPitch = (U.lookPitch ?? 0) + ((Math.max(-0.9, Math.min(0.9, p.pitch)) * MP_HEAD_SIGN) - (U.lookPitch ?? 0)) * Math.min(1, dt * 10);
      U.headBone.rotation.x += U.lookPitch * 0.65;
      if (U.neckBone) U.neckBone.rotation.x += U.lookPitch * 0.3;
    }
  }

  updateAvatars(dt) {
    for (const p of this.roster) {
      const a = p.avatar; if (!a) continue;
      a.visible = !p.hidden && this.story.hideMissing !== p.slot;
      a.position.copy(p.pos);
      this.animateBody(a, p, dt);
      // their flashlight
      const on = p.flash && p.life === 'alive' && !p.hidden && a.visible;
      p.spot.intensity = on ? 150 : 0;
      if (on) {
        const dir = V(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
        p.spot.target.position.copy(p.head).addScaledVector(dir, 6);
      }
    }
    // my own body for the mirror and the cameras
    const a = this.selfAvatar, me = this.me;
    if (a && me) { a.visible = !me.hidden && me.life !== 'dead'; a.position.copy(me.pos); this.animateBody(a, me, dt); }
  }

  // ------------------------------------------------------------------ teammate name tags
  // small, distance limited, hidden behind walls (line of sight), faded out in intense moments
  tagEl(p) { return this.tagsEl?.querySelector(`[data-slot="${p.slot}"]`); }
  updateTags(dt) {
    const g = this.g, cam = g.camera;
    this._tagT = (this._tagT || 0) - dt;
    const checkLos = this._tagT <= 0; if (checkLos) this._tagT = 0.2;
    const hideAll = this.story.inCCTV || this.story.intense || g.mpPaused || this.story.taken || this.me?.life === 'dead';
    for (const p of this.roster) {
      if (p.slot === this.meSlot) continue;
      let el = this.tagEl(p);
      if (!el) { el = document.createElement('div'); el.className = 'mp-tag'; el.dataset.slot = p.slot; this.tagsEl.appendChild(el); }
      if (el.textContent !== p.name + (p.life === 'down' ? ' · DOWN' : '')) el.textContent = p.name + (p.life === 'down' ? ' · DOWN' : '');
      el.classList.toggle('down', p.life === 'down');
      const head = p.head.clone().setY(p.head.y + 0.24);
      const d = head.distanceTo(cam.position);
      let vis = !hideAll && p.avatar?.visible && p.life !== 'dead' && d < TAG_RANGE;
      if (vis && checkLos) p.tagLos = g.world.physics.los(cam.position, head);
      vis = vis && p.tagLos !== false;
      const v = head.project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) vis = false;
      const alpha = vis ? Math.min(1, (TAG_RANGE - d) / 4) * (d < 1.4 ? 0.3 : 0.85) : 0;
      el.style.opacity = alpha.toFixed(2);
      if (alpha > 0) el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2 * innerWidth).toFixed(1)}px, ${((1 - v.y) / 2 * innerHeight).toFixed(1)}px) scale(${Math.max(0.75, 1.1 - d / 20).toFixed(2)})`;
    }
    for (const el of [...this.tagsEl.children]) if (!this.players.has(+el.dataset.slot)) el.remove();
  }

  // ------------------------------------------------------------------ local life presentation
  lifeChangedLocal(prev, life) {
    const g = this.g;
    if (life === 'dead') { g.ui.toast('YOU DIED', 3); this.specIdx = 0; }
    if (life === 'alive' && prev !== 'alive') { g.player.eye = 1.62; }
  }

  applyLifeToLocal(dt) {
    const g = this.g, me = this.me, pl = g.player;
    const life = me.life;
    if (life === 'down') {
      pl.speedMul = 0.18; pl.crouching = true;
      pl.eye = Math.max(0.42, pl.eye - dt * 2);
      g.interact.enabled = false;
      g.post.update?.(0, 1);
      if (!pl.seated) pl.canMove = !g.mpPaused;
    } else if (life === 'dead') {
      pl.canMove = false;
      g.interact.enabled = false;
      // spectate a living teammate: first-person at their head (E / Space to switch)
      const mates = this.roster.filter(p => p.slot !== this.meSlot && p.life !== 'dead');
      if (mates.length) {
        if (!g.mpPaused && (g.input.wasPressed('KeyE') || g.input.wasPressed('Space'))) this.specIdx = (this.specIdx + 1) % mates.length;
        const t = mates[(this.specIdx || 0) % mates.length];
        this.spectating = t;
      }
    } else {
      pl.speedMul = this.story.speedMul?.(this.meSlot) ?? 1;
      if (!pl.seated) pl.canMove = !this.story.lockMove && !g.mpPaused;
    }
  }

  // main.js asks right after the player moved the camera: whose eyes is this frame rendered from?
  // (security camera, or - when dead - the teammate being spectated). Level visibility, the light pool
  // and culling then follow the view, while the audio listener stays with the player.
  cameraOverride() {
    const s = this.story.cameraOverride(); if (s) return s;
    const t = this.spectating;
    if (this.me?.life === 'dead' && t && this.players.get(t.slot) === t) {
      this._specQ = this._specQ || new THREE.Quaternion(); this._specE = this._specE || new THREE.Euler();
      this._specE.set(t.pitch, t.yaw, 0, 'YXZ'); this._specQ.setFromEuler(this._specE);
      return { pos: t.head, quat: this._specQ, fov: 72, level: this.g.world.physics.levelOf(t.pos.y + 0.1) };
    }
    return null;
  }
  postCamera() {}

  updateHold(dt) {
    const g = this.g, inp = g.input;
    const cur = g.interact.current;
    let id = null;
    if (this.me.life === 'alive' && !g.mpPaused && cur?.hold && inp.down('KeyE')) id = cur.id;
    if (id !== this.myHold) {
      if (this.myHold) this.net.send({ t: 'hold', id: this.myHold, on: false });
      if (id) this.net.send({ t: 'hold', id, on: true });
      this.myHold = id;
    }
  }

  updateLifeHost(dt) {
    // hold timers
    for (const [, h] of this.holds) for (const [slot, s] of h) {
      const p = this.players.get(slot);
      if (!p || p.life !== 'alive') { h.delete(slot); continue; }
      h.set(slot, s + dt);
    }
    // revives: a teammate holds E on a downed player
    for (const p of this.roster) {
      if (p.life !== 'down') continue;
      const h = this.holds.get('revive_' + p.slot);
      let best = 0, by = null;
      if (h) for (const [slot, s] of h) {
        const r = this.players.get(slot);
        if (r && r.pos.distanceTo(p.pos) < 2.2 && s > best) { best = s; by = slot; }
      }
      this.holdProgress['revive_' + p.slot] = best / REVIVE_SECONDS;
      if (best >= REVIVE_SECONDS) { h.clear(); this.revive(p.slot, by); continue; }
      // bleeding out (slower while someone is working on you)
      p.bleed -= dt * (best > 0 ? 0.25 : 1);
      if (p.bleed <= 0) this.kill(p.slot);
    }
    // team wipe: nobody left standing
    if (this.started && !this.ended && this.roster.length && !this.roster.some(p => p.life === 'alive')) this.wipe();
  }

  // ------------------------------------------------------------------ HUD
  updateHUD(dt) {
    const g = this.g, U = this.ui;
    // objectives (current only; finished ones disappear)
    const lines = this.story.objectiveLines();
    const key = JSON.stringify(lines);
    if (key !== this._objKey) {
      const prev = new Set((this._objLines || []).map(l => l.text));
      U.list.innerHTML = lines.map((l, i) => `<div class="mp-obj${i ? ' sec' : ''}${l.coop ? ' coop' : ''}${prev.has(l.text) ? '' : ' new'}">${l.text}${l.count ? `<span class="cnt">${l.count}</span>` : ''}</div>`).join('');
      if (this._objKey !== undefined && lines.length && !prev.has(lines[0].text)) audio.play('ui_confirm', { bus: 'ui', volume: 0.35 });
      this._objKey = key; this._objLines = lines;
    }
    document.getElementById('mp-objectives').classList.toggle('hidden', !lines.length);
    // on the CCTV terminal the screen belongs to the cameras: HUD away, the objective as one line in the overlay
    document.body.classList.toggle('cctv-on', !!this.story.inCCTV);
    const co = document.getElementById('mp-cctv-obj'); if (co && lines[0] && co.textContent !== lines[0].text) co.textContent = lines[0].text;
    U.warn.classList.toggle('hidden', !this.story.runWarning());
    // team list
    const tkey = this.roster.map(p => `${p.slot}${p.name}${p.life}${(this.voice.levels.get(p.peerId) || 0) > 0.08 ? 't' : ''}${p.slot === this.meSlot && this.voice.myLevel > 0.08 ? 't' : ''}`).join(',');
    if (tkey !== this._teamKey) {
      this._teamKey = tkey;
      U.team.innerHTML = this.roster.sort((a, b) => a.slot - b.slot).map(p => {
        const talk = p.slot === this.meSlot ? this.voice.myLevel > 0.08 : (this.voice.levels.get(p.peerId) || 0) > 0.08;
        const st = p.life === 'down' ? '<span class="tag2">DOWN</span>' : p.life === 'dead' ? '<span class="tag2">DEAD</span>' : '';
        return `<div class="mp-mate ${p.life === 'alive' ? '' : p.life}">${esc(p.name)}${p.slot === this.meSlot ? ' (YOU)' : ''}${st}<span class="dot${talk ? ' talk' : ''}"></span></div>`;
      }).join('');
    }
    const v = this.voice;
    const micText = v.micAvailable === false ? 'MIC UNAVAILABLE' : !v.micOn ? 'MIC MUTED' : v.ptt ? (v.pttHeld ? 'TALKING' : `HOLD ${keyLabel(v.pttKey)} TO TALK`) : 'OPEN MIC';
    if (U.mic.textContent !== micText) U.mic.textContent = micText;
    U.mic.className = v.transmitting ? (v.myLevel > 0.06 ? 'talk' : 'on') : '';
    U.spk.textContent = v.speakerOn ? 'SPK ON' : 'SPK OFF';
    U.spk.className = v.speakerOn ? 'on' : '';
    // hold progress (mine)
    const hp = this.myHold ? (this.holdProgress[this.myHold] ?? null) : null;
    U.prog.classList.toggle('hidden', hp == null);
    if (hp != null) {
      U.prog.querySelector('.label').textContent = this.myHold.startsWith('revive_') ? 'REVIVING...' : (g.interact.current?.holdLabel || 'HOLD...');
      U.prog.querySelector('.bar span').style.width = Math.min(100, hp * 100) + '%';
    }
    // downed / dead overlays
    const me = this.me;
    U.downed.classList.toggle('hidden', me.life !== 'down');
    if (me.life === 'down') U.downed.querySelector('.bar span').style.width = (me.bleed / BLEED_SECONDS * 100) + '%';
    U.dead.classList.toggle('hidden', me.life !== 'dead');
  }

  // DEV ONLY: a scripted teammate on the host (same code paths as a networked player)
  async devBot(name) {
    if (!import.meta.env.DEV || !this.isHost) return null;
    let slot = 0; while (this.players.has(slot)) slot++;
    if (slot >= 4) return null;
    const p = this.addPlayer({ slot, peerId: 'bot' + slot, name });
    p.net.pos.copy(this.g.player.pos).add(V(1, 0, 1));
    await this.loadAvatar(p);
    this.registerReviveTarget(p);
    return { p, move: (x, y, z, yaw = 0) => { p.net.pos.set(x, y, z); p.net.yaw = yaw; }, req: (a, d) => this.handleReq(slot, a, d), hold: (id, on) => this.setHold(slot, id, on) };
  }

  // revive prompts are interactables on every client
  registerReviveTargets() { for (const p of this.roster) this.registerReviveTarget(p); }
  registerReviveTarget(p) {
    const g = this.g;
    if (p.slot === this.meSlot || g.interact.get('revive_' + p.slot)) return;
    g.interact.add({
      id: 'revive_' + p.slot, hold: true, holdLabel: 'REVIVING ' + p.name,
      pos: () => (this.players.get(p.slot) || p).pos.clone().setY(p.pos.y + 0.5), radius: 2.2, cone: 0.8,
      enabled: () => { const q = this.players.get(p.slot); return !!q && q.life === 'down' && this.me.life === 'alive'; },
      prompt: () => `[HOLD E] Revive ${(this.players.get(p.slot) || p).name}`,
      action: () => {},
    });
  }
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
