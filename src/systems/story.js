// NIGHT SHIFT — the story script: stages, scripted sequences, checkpoints.
import * as THREE from 'three';
import { audio } from '../audio/audio.js';
import { say, arman } from './voice.js';
import { poster } from './photos.js';
import { Emergence } from './emergence.js';
import { Act2 } from './act2.js';
import { rand, seededRandom, shuffle } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
class Abort extends Error {}

// After 'restored' (the four fuses are in) the second act runs: aux -> security (CCTV, the report) ->
// chase -> switches (three emergency switches) -> final (back to the basement) -> containment
// (final horror sequence) -> ending (6:00 AM, outside) -> end.
export const STAGES = ['intro', 'reception', 'call', 'dark', 'basement', 'powerroom', 'search', 'return', 'restored', 'aux', 'security', 'chase', 'switches', 'final', 'containment', 'ending', 'end'];

export class Story {
  constructor(g) {
    this.g = g;
    this.stage = 'intro';
    this.token = 0;
    this.flags = {};
    this.t = 0;
    this.stageT = 0;
  }

  // ------------------------------------------------------------------ helpers
  stageAtLeast(s) { return STAGES.indexOf(this.stage) >= STAGES.indexOf(s); }
  setStage(s) {
    this.stage = s; this.stageT = 0;
    if (this.g.debug) this.g.debug.log('stage: ' + s);
  }
  // Guarded, pausable wait for scripted sequences (aborts on restart).
  waiter() {
    const tok = this.token;
    return async s => { await this.g.clock.wait(s); if (tok !== this.token) throw new Abort(); };
  }
  run(fn) {
    const wait = this.waiter();
    fn(wait).catch(e => { if (!(e instanceof Abort)) console.error('[story]', e); });
  }
  thought(t, s) { this.g.ui.thought(t, s); }

  // ------------------------------------------------------------------ world setup (once per session)
  setupStatic() {
    const g = this.g, L = g.layout, R = L.reception;
    // Reception desk phone + handset
    this.phone = g.world.item('phone_desk');
    this.phonePos = V(-15.25, 0.775, -4.35);
    this.phone.position.copy(this.phonePos);
    this.phone.rotation.y = Math.PI;
    g.scene.add(this.phone);
    this.handset = g.world.item('phone_handset');
    this.handset.position.set(0, 0.09, 0.06);
    this.phone.add(this.handset);
    // Wall clock
    this.clockBody = g.world.item('clock_body');
    this.clockBody.position.set(R.clock.x, R.clock.y, R.clock.z + 0.06);
    g.scene.add(this.clockBody);
    this.hourHand = g.world.item('clock_hour'); this.minHand = g.world.item('clock_min');
    for (const h of [this.hourHand, this.minHand]) { h.position.set(0, 0, 0.024); this.clockBody.add(h); }
    // Drawer with flashlight + batteries
    this.drawer = new THREE.Group();
    this.drawerClosedZ = -4.6;
    this.drawer.position.set(-16.6, 0.6, this.drawerClosedZ);
    const dm = g.world.item('drawer'); this.drawer.add(dm);
    this.drawerFlash = g.world.item('flashlight');
    this.drawerFlash.rotation.set(0, 0.4, Math.PI / 2); this.drawerFlash.position.set(-0.08, 0.05, 0.22);
    this.drawerBatt = g.world.item('battery'); this.drawerBatt.position.set(0.12, 0.02, 0.3);
    this.drawer.add(this.drawerFlash, this.drawerBatt);
    g.scene.add(this.drawer);
    this.drawerOpen = 0; this.drawerTarget = 0;
    // Power room wall phone + other phones (finale rings everywhere)
    this.phoneObjs = [];
    for (const p of L.phones) {
      if (p.reception) continue;
      const m = g.world.item(p.wall ? 'phone_wall' : 'phone_desk');
      m.position.set(p.x, p.y, p.z); m.rotation.y = p.rot;
      g.scene.add(m);
      this.phoneObjs.push({ def: p, obj: m });
    }
    // Warning sign
    const ws = L.warningSign;
    this.warning = g.world.item('warning_sign');
    this.warning.position.set(ws.x, ws.y, ws.z + 0.01);
    g.scene.add(this.warning);
    // Key
    const ks = L.morgue.keySpot;
    this.key = g.world.item('key');
    this.key.position.set(ks.x, ks.y, ks.z);
    g.scene.add(this.key);
    // Posters
    const posters = [
      [['WASH YOUR', 'HANDS', 'Infection control', 'saves lives.'], -21.83, 1.6, -5.2, Math.PI / 2],
      [['VISITING', 'HOURS', '2:00 PM - 6:00 PM', 'No visitors after dark.'], -21.83, 1.6, 5.2, Math.PI / 2, { band: '#5a2f2f' }],
      [['CARING', 'SINCE 1952', 'St. Mercy Hospital', 'Our family, your family.'], -10.12, 1.6, 6.0, -Math.PI / 2],
      [['IN CASE OF FIRE', 'USE STAIRS', 'Do not use the', 'elevator.'], 15.0, 1.55, 1.39, Math.PI, { band: '#7a2a1a' }],
      [['QUIET', 'PLEASE', 'Patients are', 'sleeping.'], -3.0, 1.6, 1.39, Math.PI],
      [['NIGHT STAFF', 'REMINDER', 'Remain at your post', 'until 6:00 AM.'], -14.2, 1.65, -8.82, 0, { band: '#222' }],
    ];
    for (const [lines, x, y, z, ry, opt] of posters) {
      const p = poster(lines, opt); p.position.set(x, y, z); p.rotation.y = ry; g.scene.add(p);
    }
    for (const lv of ['2', '3', '4']) {
      const y = L.levels.find(l => l.id === lv).y;
      const p = poster(lv === '4' ? ['CHILDREN\'S', 'WARD', 'Every child', 'deserves a smile.'] : ['QUIET', 'PLEASE', 'Patients are', 'sleeping.'], { band: lv === '4' ? '#6a5a2a' : '#2f5a52' });
      p.position.set(-6 + Number(lv) * 3, y + 1.6, 1.39); p.rotation.y = Math.PI; g.scene.add(p);
    }
    this.setupInteractions();
    this.act2 = new Act2(g, this);
  }
  // fuses can be inserted once the power room is open, until the power is back
  canUsePanel() { return !!this.flags.key && !this.stageAtLeast('restored'); }
  get switchCount() { return this.act2 ? this.act2.switchCount : 0; }

  setupInteractions() {
    const g = this.g, L = g.layout, R = L.reception;
    const I = g.interact;
    I.add({
      id: 'register', pos: V(-17.9, 1.15, -3.95), radius: 2.2,
      prompt: () => '[E] Read Register',
      action: () => this.readRegister(),
    });
    I.add({
      id: 'computer', pos: V(-16.9, 1.0, -4.15), radius: 2.0,
      prompt: () => '[E] Use Computer',
      action: () => this.readComputer(),
    });
    I.add({
      id: 'phone', pos: () => this.phonePos.clone().setY(0.85), radius: 2.0,
      prompt: () => this.stage === 'call' && this.ringing ? '[E] Answer Phone' : (this.stage === 'reception' ? '[E] Telephone' : null),
      action: () => {
        if (this.stage === 'call' && this.ringing) this.answerPhone();
        else if (this.stage === 'reception') { audio.play('phone_pickup', { bus: 'sfx', volume: 0.5 }); this.thought('(No dial tone. Just a faint hiss.)', 3.5); }
      },
    });
    I.add({
      id: 'chair', pos: V(R.chair.x, 0.8, R.chair.z), radius: 1.9, cone: 0.6,
      enabled: () => this.stage === 'reception' && !g.player.seated,
      prompt: () => '[E] Sit Down',
      action: () => this.sitDown(),
    });
    I.add({
      id: 'drawer', pos: () => this.drawer.position.clone().add(V(0, 0.06, -0.05)), radius: 1.7, cone: 0.7,
      enabled: () => this.stageAtLeast('dark') && !g.player.seated,
      prompt: () => {
        if (this.drawerTarget === 0) return '[E] Open Drawer';
        if (this.drawerFlash.visible) return '[E] Take Flashlight';
        if (this.drawerBatt.visible) return '[E] Take Batteries';
        return '[E] Close Drawer';
      },
      action: () => {
        if (this.drawerTarget === 0) { this.drawerTarget = 1; audio.play('drawer_wood_open', { bus: 'sfx', volume: 0.8 }); }
        else if (this.drawerFlash.visible) this.takeFlashlight();
        else if (this.drawerBatt.visible) { this.drawerBatt.visible = false; this.flags.tookBatt = true; g.flashlight.addSpare(2); audio.play('pickup', { bus: 'player', volume: 0.7 }); g.ui.toast('SPARE BATTERIES  +2'); g.ui.thought('(Spare batteries. [R] to replace.)', 3); g.saveCheckpoint(); }
        else { this.drawerTarget = 0; audio.play('drawer_wood_close', { bus: 'sfx', volume: 0.8 }); }
      },
    });
    I.add({
      id: 'entrance', pos: V(L.bounds.x0 + 0.3, 1.3, 0), radius: 2.3, cone: 0.6,
      enabled: () => g.world.entrance.locked && this.stage !== 'intro',
      prompt: () => '[E] Main Doors',
      action: () => { audio.playAt('door_locked', V(L.bounds.x0, 1, 0), { bus: 'environment', volume: 0.9 }); this.thought(this.stageAtLeast('dark') ? '(Locked. They won\'t budge.)' : '(The doors locked behind me. Security protocol, they said.)', 3.5); },
    });
    // locked power room door
    const pd = g.world.doorById['door_' + L.powerRoom.id];
    I.add({
      id: 'door_power_locked', pos: pd.center, radius: 2.0,
      enabled: () => !!pd.locked,
      prompt: () => '[E] Open Door',
      action: () => {
        if (this.flags.key) {
          pd.locked = null; pd.open(1.2, false);
          audio.playAt('entrance_unlock', pd.center, { bus: 'environment', volume: 0.8 });
          audio.playAt('metal_scrape', pd.center, { bus: 'environment', volume: 0.6, delay: 0.3 });
          g.ui.toast('USED MAINTENANCE KEY');
        } else {
          audio.playAt('door_locked', pd.center, { bus: 'environment', volume: 0.9 });
          this.thought(this.stageAtLeast('basement') ? '(Locked. There must be a key somewhere down here.)' : '(Locked.)', 3.5);
          this.flags.powerTried = true;
        }
      },
    });
    I.add({
      id: 'key', pos: () => this.key.position.clone().setY(this.key.position.y + 0.02), radius: 1.9, cone: 0.4,
      enabled: () => this.key.visible && this.stageAtLeast('basement'),
      prompt: () => '[E] Take Key',
      action: () => this.takeKey(),
    });
    I.add({
      id: 'panel_inspect', pos: () => g.fuses.panelPos.clone().setY(g.fuses.panelPos.y + 1.3).add(V(0, 0, 0.3)), radius: 2.4, cone: 0.6,
      enabled: () => this.stage === 'powerroom',
      prompt: () => '[E] Inspect Power Panel',
      action: () => this.inspectPanel(),
    });
    I.add({
      id: 'warning', pos: () => this.warning.position, radius: 2.6, cone: 0.5,
      enabled: () => this.stageAtLeast('restored') && !this.stageAtLeast('containment'),
      prompt: () => '[E] Read Sign',
      action: () => this.readWarning(),
    });
    // generic doors
    for (const d of g.world.doors) {
      I.add({
        id: 'door_' + d.id, pos: () => d.center, radius: 1.9, cone: 0.55,
        enabled: () => !d.locked,
        prompt: () => d.target > 0.5 ? '[E] Close Door' : '[E] Open Door',
        action: () => d.toggle(),
      });
    }
  }

  readRegister() {
    const g = this.g;
    g.ui.read('NIGHT SECURITY REGISTER', `
      <div style="font-size:14px">
      D. KOWALSKI &mdash; 14 MAR 1987 &mdash; IN 23:51 &mdash; OUT ______<br>
      R. OKAFOR &mdash; 02 NOV 1994 &mdash; IN 23:48 &mdash; OUT ______<br>
      M. BRANDT &mdash; 19 JAN 2003 &mdash; IN 23:55 &mdash; OUT ______<br>
      T. ELLISON &mdash; 30 SEP 2011 &mdash; IN 23:57 &mdash; OUT ______<br>
      J. MORROW &mdash; 08 FEB 2019 &mdash; IN 23:50 &mdash; OUT ______<br>
      <span style="color:#fff">ARMAN &mdash; TONIGHT &mdash; IN 23:58 &mdash; OUT ______</span><br><br>
      <i style="color:#8a837a">Nobody ever signed out.</i></div>`);
    this.readingOpen = true;
  }
  readComputer() {
    this.g.ui.read('ST. MERCY INTERNAL &mdash; NIGHT SECURITY', `
      Welcome to your first shift.<br><br>
      &bull; Patrols are NOT required. Remain at reception until 6:00 AM.<br>
      &bull; Do not go to Sub-Level B.<br>
      &bull; If the reception telephone rings after 2:00 AM, do n&#9618;&#9618;&#9618;&#9618;&#9618;&#9618;<br>
      &bull; Under no circumstances re&#9618;&#9618;&#9618;&#9618;&#9618; auxiliary po&#9618;&#9618;&#9618;<br><br>
      <span style="color:#8a837a">[FILE CORRUPTED]</span>`);
    this.readingOpen = true;
  }
  readWarning() {
    const g = this.g;
    g.ui.read('<span style="color:#b33">DANGER</span>', `
      <div style="font-size:19px;letter-spacing:0.05em">DO NOT RESTORE AUXILIARY POWER WITHOUT AUTHORIZATION.</div><br>
      <div style="font-size:21px;color:#e8c84a;letter-spacing:0.12em">CONTAINMENT SYSTEM &mdash; ACTIVE</div><br>
      <span style="color:#8a837a;font-size:13px">ST. MERCY HOSPITAL &middot; SUB-LEVEL B &middot; 1987</span>`);
    this.readingOpen = true;
  }

  // ------------------------------------------------------------------ stage entry points
  startReception() {
    const g = this.g;
    this.setStage('reception');
    g.world.lights.setPower('all', false);
    g.world.lights.setPower('1', true);
    this.hum = audio.play('hum_electric', { bus: 'ambience', loop: true, volume: 0.25, fadeIn: 2 });
    this.clockTime = 23 * 60 + 58;
    this.clockRunning = true;
    g.music.start();
    g.ui.hud(true);
    this.receptionHintT = 0;
    // no opening monologue — the hospital speaks for itself
    this.run(async wait => { await wait(6); if (this.stage === 'reception') this.thought('(Just sit at reception and wait for morning.)', 4.5); });
  }

  sitDown() {
    const g = this.g, R = g.layout.reception;
    g.player.sit({ x: R.chair.x, y: 0, z: R.chair.z, yaw: Math.PI });
    audio.play('cloth', { bus: 'player', volume: 0.6 });
    this.run(async wait => {
      await wait(4.5);
      if (this.stage !== 'reception') return;
      // time passes...
      await g.ui.fade(1, 1.8);
      this.clockTime = 2 * 60 + 13; this.clockRunning = false;
      g.ui.timecard('2:13 AM', 2.6);
      await wait(3.6);
      g.ui.fade(0, 2);
      this.startCall();
    });
  }

  startCall() {
    const g = this.g;
    this.setStage('call');
    this.ringing = audio.playAt('phone_ring', this.phonePos.clone().setY(0.9), { bus: 'environment', loop: true, volume: 0.9, refDistance: 2.5, reverb: 0.3 });
    g.breathing.scare(0.3);
    this.ringT = 0;
  }

  answerPhone() {
    const g = this.g;
    this.ringing.stop(0.05); this.ringing = null;
    audio.play('phone_pickup', { bus: 'sfx', volume: 0.9 });
    // lift the handset toward the camera
    this.handset.visible = false;
    g.player.canMove = false;
    g.music.setSilent(true);
    this.run(async wait => {
      // pickup -> static -> voice -> pause -> laugh -> static -> disconnect
      const stat = audio.play('phone_static', { bus: 'voice', volume: 0.5, loop: true });
      await wait(1.5);
      stat.setVolume(0.14, 0.4);                               // line noise ducks under the voice
      await say(g.ui, 'vo_phone_threat', { volume: 1, reverb: 0.05, wait });
      await wait(1.4);
      await say(g.ui, 'vo_phone_laugh', { volume: 0.95, reverb: 0.05, wait });
      stat.setVolume(0.55, 0.15);                              // static swells back up...
      await wait(1.0);
      stat.stop(0.05);
      audio.play('phone_hangup', { bus: 'sfx', volume: 0.9 }); // ...and the line goes dead
      const busy = audio.play('phone_busy', { bus: 'voice', volume: 0.35, delay: 0.35 });
      await wait(1.6);
      busy.stop(0.1);
      this.handset.visible = true;
      arman(g, 'what_was_that', { force: true });
      await wait(1.9);
      this.blackout();
    });
  }

  blackout() {
    const g = this.g;
    this.setStage('dark');
    audio.play('power_down', { bus: 'environment', volume: 1 });
    g.world.lights.surgeFlicker(0.7);
    this.hum?.stop(0.4);
    this.run(async wait => {
      await wait(0.55);
      g.world.lights.setPower('all', false);
      g.breathing.scare(0.75);
      g.player.shake(0.3, 0.3);
      this.roomTone = audio.play('room_tone', { bus: 'ambience', loop: true, volume: 0.5, fadeIn: 3 });
      await wait(1.6);
      g.player.stand();
      g.player.canMove = true;
      g.music.setSilent(false);
      arman(g, 'shit', { force: true });
      await wait(1.6);
      this.thought('(The power... everything just died.)', 4);
      // checkpoint: after the initial blackout (at the reception desk)
      g.saveCheckpoint();
      await wait(8);
      if (!g.flashlight.has) this.thought('(I can\'t see a thing. The desk drawer — maybe there\'s a torch.)', 5);
    });
  }

  takeFlashlight() {
    const g = this.g;
    this.drawerFlash.visible = false;
    g.flashlight.give();
    g.flashlight.toggle(true);
    audio.play('pickup', { bus: 'player', volume: 0.8 });
    g.ui.toast('FLASHLIGHT  [F]');
    g.ui.setBattery(g.flashlight.battery, g.flashlight.spares);
    this.setStage('basement');
    this.run(async wait => {
      await wait(3);
      this.thought('(The breaker must be in the basement. The power room.)', 5);
    });
    g.saveCheckpoint();
  }

  // ~1 s: it is suddenly right there, screams, and is gone in a flashlight flicker.
  firstScare() {
    const g = this.g, k = g.koala, p = g.player;
    this.scareRunning = true;
    this.flags.stairScare = true;
    const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const at = p.pos.clone().addScaledVector(fwd, 1.45);
    at.y = p.pos.y;
    k.show(at, 0, 'jumpscare');
    k.faceTowards(p.pos);
    k.lookTarget = g.camera.position;
    k.play('jumpscare', { fade: 0, vary: false });
    audio.play('jumpscare_hit', { bus: 'monster', volume: 1 });
    k.vocal('koala_screech', 1, { refDistance: 3 });
    p.shake(1.0, 0.6);
    g.post.pulse(1.0, 0.45);
    g.flashlight.flicker(1.1, 0.7);
    g.breathing.scare(1);
    this.run(async wait => {
      await wait(0.85);
      g.flashlight.flicker(0.3, 1);       // a dark blink — and it's gone
      await wait(0.08);
      k.hide();
      this.scareRunning = false;
      arman(g, 'wtf', { force: true });
      await wait(1.6);
      g.saveCheckpoint();
    });
  }

  takeKey() {
    const g = this.g;
    this.key.visible = false;
    this.flags.key = true;
    audio.play('key_pickup', { bus: 'player', volume: 1 });
    g.ui.toast('MAINTENANCE KEY');
    this.setStage('powerroom');
    this.morgueSequence();
  }

  // Key pickup -> silence -> rumble -> the floor cracks open -> claws -> arms -> head ->
  // the whole Koala drags itself up, looks at the player, screams -> hunt.
  // The player keeps control the whole time (only a short look-assist toward the crack).
  async morgueSequenceInner(wait) {
    const g = this.g, M = g.layout.morgue, p = g.player;
    await g.ensureKoala();
    const spot = V(M.koalaSpot.x, M.y, M.koalaSpot.z);
    const at = (id, o = {}) => audio.playAt(id, spot.clone().setY(M.y + 0.3), { bus: 'environment', occlude: false, refDistance: 4, reverb: 0.35, ...o });
    // 1. silence: music and room tone fall away
    g.music.setSilent(true);
    this.roomTone?.setVolume(0.08, 1.2);
    await wait(1.6);
    // 2. something deep under the floor
    const rumble = at('emerge_rumble', { volume: 0.95, refDistance: 9, bigReverb: 0.2 });
    for (let i = 0; i < 6; i++) { p.shake(0.12 + i * 0.04, 0.5); await wait(0.3); }
    g.flashlight.flicker(0.4, 0.6);
    g.world.lights.surgeFlicker?.(0.3);
    // 3. the floor cracks
    const fx = this.emergeFx = new Emergence(g.world.levels.B || g.scene, spot.clone().sub((g.world.levels.B || g.scene).position || V(0, 0, 0)));
    at('emerge_crack', { volume: 1 });
    fx.setCrack(0.35); fx.puff(30, 0.6, 0.4);
    const lamp = g.world.lights.fixtures.filter(f => f.level === 'B').sort((a, b) => Math.hypot(a.x - spot.x, a.z - spot.z) - Math.hypot(b.x - spot.x, b.z - spot.z))[0];
    if (lamp) fx.setLamp(lamp, 0.22);
    audio.playAt('light_buzz', V(lamp?.x ?? spot.x, M.y + 2.8, lamp?.z ?? spot.z), { bus: 'environment', volume: 0.5 });
    g.breathing.scare(0.6);
    // brief look assist toward the sound, then hands control straight back
    const toYaw = Math.atan2(-(spot.x - p.pos.x), -(spot.z - p.pos.z));
    p.lookOverride = { yaw: toYaw, pitch: -0.32, speed: 3.2 };
    await wait(0.75);
    p.lookOverride = null;
    for (let i = 0; i < 4; i++) { p.shake(0.35, 0.4); fx.puff(10, 0.7, 0.5); await wait(0.35); }
    fx.setCrack(0.8);
    at('emerge_break', { index: 0, volume: 1 });
    fx.burst(10, 0.8);
    p.shake(0.6, 0.5);
    await wait(0.6);
    fx.setCrack(1.0);
    at('emerge_debris', { index: 0, volume: 0.9 });
    // 4. claws first
    const k = g.koala;
    const yaw = Math.atan2(p.pos.x - spot.x, p.pos.z - spot.z);
    k.show(spot.clone().setY(M.y - 2.45), yaw, 'emerge');
    k.play('emerge', { fade: 0, vary: false, timeScale: 1 });
    k.speed = 0;
    let te = 0;
    // root height over the 4.8 s clip: hidden -> claws (0-1.2) -> arms plant, head + shoulders (1.2-2.5)
    // -> strain (2.5-3.4) -> push up (3.4-4.4) -> standing
    const keys = [[0, -2.45], [1.2, -1.75], [2.5, -0.9], [3.4, -0.65], [4.4, 0], [9, 0]];
    this.emergeRise = dt => {
      te += dt;
      let y = 0;
      for (let i = 0; i < keys.length - 1; i++) {
        const [t0, y0] = keys[i], [t1, y1] = keys[i + 1];
        if (te <= t1) { const u = Math.max(0, (te - t0) / (t1 - t0)); y = y0 + (y1 - y0) * u * u * (3 - 2 * u); break; }
      }
      k.position.y = M.y + y;
      if (te > 4.8) this.emergeRise = null;
    };
    at('emerge_break', { index: 2, volume: 0.9, delay: 0.1 });
    fx.burst(8, 1.0);
    await wait(1.2);
    // arms come down onto the floor: wet, cracking joints, more of the floor gives
    at('emerge_wet', { volume: 0.9 });
    at('emerge_joints', { volume: 0.85, delay: 0.35 });
    at('emerge_break', { index: 1, volume: 0.95, delay: 0.25 });
    at('emerge_debris', { index: 1, volume: 0.9, delay: 0.3 });
    fx.burst(12, 1.1);
    p.shake(0.5, 0.6);
    await wait(1.3);
    k.vocal('koala_breath', 0.9, { refDistance: 2 });
    fx.puff(30, 0.5, 0.7);
    await wait(0.9);
    // pushes the rest of the way up
    at('emerge_debris', { index: 2, volume: 0.85 });
    at('emerge_joints', { volume: 0.7, delay: 0.2, rate: 0.85 });
    k.vocal('koala_growl', 0.75);
    fx.burst(9, 0.9);
    p.shake(0.4, 0.6);
    await wait(1.2);
    at('emerge_debris', { index: 3, volume: 0.6 });
    rumble?.stop?.(2.5);
    await wait(0.8);
    // 5. it looks at you. Nothing moves.
    k.play('breathe', { fade: 0.6 });
    k.lookTarget = g.camera.position;
    k.faceTowards(p.pos);
    g.breathing.scare(1);
    await wait(1.5);
    // 6. scream -> chase
    k.vocal('emerge_roar', 1, { bigReverb: 0.3 });
    fx.lampLevel = 0.35;
    this.run(async w => { await w(7); fx.releaseLamp(); });
    // the Koala is loose from here on. Checkpoint BEFORE the chase, with a safe respawn
    // point out in the basement corridor (never in front of the Koala).
    this.flags.morgueDone = true;
    g.saveCheckpoint({ pos: V(5.0, -4, 0.3), yaw: Math.PI / 2 });
    g.ai.scriptedChase(k.position.clone(), {
      maxSpeed: 3.9, startSpeed: 2.2, screamTime: 2.1, cool: 70, maxTime: 24, searchTime: 14,
      onEnd: () => this.afterMorgueChase(),
    });
    g.music.setSilent(false);
    this.roomTone?.setVolume(0.5, 4);
  }  morgueSequence() { this.run(wait => this.morgueSequenceInner(wait)); }

  afterMorgueChase() {
    const g = this.g;
    this.flags.morgueDone = true;
    // from now on the Koala roams: encounters, detection, real chases
    g.ai.enable(rand(45, 70));
    g.saveCheckpoint({ pos: g.player.pos, yaw: g.player.yaw });
    this.run(async wait => {
      await wait(5);
      if (!this.stageAtLeast('restored')) this.thought('(The key. The power room — I need those fuses, then get the lights back on.)', 5);
    });
  }

  inspectPanel() {
    const g = this.g;
    this.setStage('search');
    audio.play('stinger_reveal', { bus: 'sfx', volume: 0.4 });
    const n = g.fuses.collected;
    this.thought(n === 0 ? '(Four fuses are missing. They must be somewhere in the building.)'
      : n < 4 ? `(Four fuse slots. I have ${n}... ${4 - n} more somewhere in the building.)` : '(All four slots are empty. I have the fuses.)', 6);
    g.saveCheckpoint();
  }

  // ------------------------------------------------------------------ fuses
  onFuseCollected() {
    const g = this.g;
    const n = g.fuses.collected;
    arman(g, n >= 4 ? 'last_one' : n === 1 ? 'fuse_one' : 'another_one', { delay: 0.5, force: true, volume: n >= 4 ? 0.95 : 0.8 });
    if (n >= 4) {
      if (this.stage === 'search') this.setStage('return');
      this.run(async wait => { await wait(2.6); this.thought(this.flags.key ? '(Back to the power room.)' : '(The power room is still locked. There has to be a key down there.)', 4.5); });
    }
    g.saveCheckpoint();
  }
  onFuseInserted(n) {
    if (n >= 4) this.restorePower();
  }

  // All four fuses are in: the lever, the lights... and the second act begins (act2.js).
  restorePower() { this.act2.restorePower(); }

  // ------------------------------------------------------------------ per-frame
  update(dt) {
    this.emergeFx?.update(dt);
    if (this.emergeRise) this.emergeRise(dt);
    const g = this.g;
    this.t += dt; this.stageT += dt;
    // reader closes with E / Esc
    if (this.readingOpen && this.stageT >= 0) {
      if (g.input.wasPressed('KeyE') && this._readerFrames > 0) {
        g.ui.read(null); this.readingOpen = false;
        const cb = this.onReaderClosed; this.onReaderClosed = null;
        cb && cb();
        g.input.pressed.delete('KeyE');
      }
      this._readerFrames = (this._readerFrames || 0) + 1;
    } else this._readerFrames = 0;
    // drawer animation
    this.drawerOpen += (this.drawerTarget - this.drawerOpen) * Math.min(1, dt * 6);
    this.drawer.position.z = this.drawerClosedZ - 0.36 * this.drawerOpen;
    // wall clock
    if (this.clockRunning) this.clockTime += dt / 60;
    const mins = this.clockTime % (12 * 60);
    this.minHand.rotation.z = -(mins % 60) / 60 * Math.PI * 2;
    this.hourHand.rotation.z = -(mins / 60) / 12 * Math.PI * 2;
    // stage specific
    if (this.stage === 'reception' && !g.player.seated) {
      this.receptionHintT += dt;
      if (this.receptionHintT > 120) { this.receptionHintT = 60; this.thought('(I should sit down at the desk and wait out the shift.)', 4.5); }
    }
    if (this.stage === 'call' && this.ringing) {
      this.ringT += dt;
      if (this.ringT > 25 && !this.flags.ringHint) { this.flags.ringHint = true; this.thought('(Who would call at this hour...?)', 4); }
    }
    // First Koala appearance: scripted jumpscare as Arman reaches the basement staircase.
    if (this.stage === 'basement' && !this.flags.stairScare && g.koala && g.player.level === '1' && !this.scareRunning) {
      const p = g.player.pos;
      if (p.x > 15.6 && p.z < 1.0) this.firstScare();
    }
    if (this.stage === 'basement' || this.stage === 'powerroom') {
      const md = g.layout.morgue.door;
      const dd = Math.hypot(g.player.pos.x - md.x, g.player.pos.z - md.z);
      if (g.player.level === 'B' && !this.flags.drips) {
        this.flags.drips = true;
        this.drips = audio.play('basement_drips', { bus: 'ambience', loop: true, volume: 0.5, fadeIn: 3 });
      }
      if (g.player.level === 'B' && dd < 8 && !this.flags.morgueSounds && this.stage === 'basement') {
        this.flags.morgueSounds = true;
        this.morgueSounds();
      }
      if (g.player.level === 'B' && dd < 5 && !this.flags.morgueHint && this.stage === 'basement' && this.flags.powerTried) {
        this.flags.morgueHint = true;
        this.thought('(The morgue. If there\'s a key down here...)', 4);
      }
    }
    if (g.player.level !== 'B' && this.drips && this.flags.drips) { this.drips.stop(2); this.drips = null; this.flags.drips = false; }
    // Reaching the basement for the first time: the fuse hunt begins (fuses can be picked up
    // anywhere from now on; inserting them needs the power room).
    if (!this.flags.reachedB && g.player.level === 'B' && this.stageAtLeast('basement') && !this.stageAtLeast('restored')) {
      this.flags.reachedB = true;
      g.fuses.active = true;
      g.events.enabled = true;
      g.saveCheckpoint();
    }
    this.updateChaseVoice(dt);
    this.act2.update(dt);
    // Rooms (for koala observe encounters near fuses)
    if (this.flags.morgueDone && !this.stageAtLeast('restored')) {
      const room = this.roomAt(g.player.pos);
      if (room && room.id !== this.lastRoom) {
        this.lastRoom = room.id;
        if (g.fuses.rooms.includes(room.id) && !g.fuses.collectedRooms.has(room.id)) g.ai.onEnterRoom(room);
      }
      if (!room) this.lastRoom = null;
    }
  }

  // Arman reacts during real chases — sparingly: maybe "Run!" as it starts (always in the big
  // chase), "Get away from me!" once if it gets close, "Come on!" once when his legs give
  // out, and "Jesus..." after getting away. Never all of them every time.
  updateChaseVoice(dt) {
    const g = this.g;
    const chasing = g.ai.isChasing?.();
    if (chasing && !this._chase) {
      const major = this.stage === 'chase';
      this._chase = { major, near: Math.random() > (major ? 0.85 : 0.55), tired: Math.random() > (major ? 0.9 : 0.6) };
      if (major || Math.random() < 0.3) arman(g, 'run', { force: true, delay: 0.25 });
    }
    const c = this._chase;
    if (!c) return;
    if (chasing && !g.dying) {
      if (!c.near && g.ai.dist() < 3.0) { c.near = true; arman(g, 'get_away', { force: true }); }
      if (!c.tired && g.player.exhausted) { c.tired = true; arman(g, 'come_on', { force: true }); }
    }
    if (!g.ai.enc && !g.dying) {             // the hunt is over and he's still alive
      if (c.major || Math.random() < 0.45) arman(g, 'jesus', { force: true, delay: 1.4 });
      this._chase = null;
    }
  }

  roomAt(p) {
    const lvl = this.g.player.level;
    return this.g.layout.rooms.find(r => r.level === lvl && r.side !== 'X' && p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1);
  }

  morgueSounds() {
    const g = this.g, M = g.layout.morgue;
    const c = V((M.x0 + M.x1) / 2, M.y + 1.2, (M.z0 + M.z1) / 2);
    this.run(async wait => {
      audio.playAt('metal_scrape', c, { bus: 'environment', volume: 0.8, occlude: true, reverb: 0.5 });
      await wait(2.2);
      audio.playAt('impact_low', c, { bus: 'environment', volume: 0.7, occlude: true });
      await wait(1.5);
      audio.playAt('koala_breath', c, { bus: 'monster', volume: 0.5, occlude: true, hrtf: true });
      await wait(3.0);
      audio.playAt('drip', c, { bus: 'environment', volume: 0.7, occlude: true });
      audio.playAt('koala_scratch', c, { bus: 'monster', volume: 0.5, occlude: true, delay: 1.2 });
      await wait(3.5);
      audio.playAt('impact_low', c, { bus: 'environment', volume: 0.5, occlude: true });
      g.breathing.scare(0.3);
    });
  }

  // ------------------------------------------------------------------ restore from save
  applySave(s) {
    const g = this.g;
    this.flags = { ...(s.flags || {}) };
    this.flags.drips = false;                 // runtime-only (ambience restarts when he is down there)
    this.clockTime = 2 * 60 + 13; this.clockRunning = false;
    const st = s.stage;
    if (STAGES.indexOf(st) <= STAGES.indexOf('call')) { this.startReception(); return; }
    // dark or later: blackout state
    g.world.lights.setPower('all', false);
    this.roomTone = audio.play('room_tone', { bus: 'ambience', loop: true, volume: 0.5, fadeIn: 3 });
    g.music.start();
    g.ui.hud(true);
    this.drawerTarget = 1;
    if (s.flashlight?.has) { this.drawerFlash.visible = false; g.flashlight.give(); g.flashlight.toggle(true); }
    if (s.drawerBatt === false || s.flags?.tookBatt) this.drawerBatt.visible = false;
    g.flashlight.battery = s.flashlight?.battery ?? 100;
    g.flashlight.spares = s.flashlight?.spares ?? 0;
    if (s.spareTaken) this.drawerBatt.visible = false;
    if (this.flags.key) { this.key.visible = false; const pd = g.world.doorById['door_' + g.layout.powerRoom.id]; pd.locked = null; }
    // the second act restores its own world state (power, doors, switches, the chase...)
    if (STAGES.indexOf(st) >= STAGES.indexOf('restored')) {
      this.setStage(st === 'restored' ? 'aux' : st);
      this.act2.applySave(s);
      return;
    }
    if (this.flags.reachedB) { g.fuses.active = true; g.events.enabled = true; }
    if (this.flags.morgueDone) g.ensureKoala().then(() => g.ai.enable(rand(40, 70)));
    this.setStage(st);
  }
}
