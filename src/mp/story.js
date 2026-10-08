// NIGHT SHIFT multiplayer - its OWN story (the single-player story is not used in this mode).
//
// THE STORY (told in play, never in one dump):
//   A night crew of up to four is sent to St. Mercy, a hospital closed after an evacuation, to bring
//   the power back so the records can be wiped before the building is demolished at 6:00 AM.
//   (WORK ORDER on the van.) The caretaker phones the front desk and sounds like he knows more than he
//   says - and the line drops mid-warning. The staff log, the generator log and the fuse tags show the
//   evacuation, the scratching, the corridor locked from inside, and that the power was cut ON PURPOSE.
//   When the crew restores main power the building wakes up... and the security office's containment
//   file says why: main power releases the chamber locks of Specimen K-7 - and night crews have been
//   sent to do exactly this before. "they knew." K-7 gets out. The crew hides, then tries to contain
//   what they released, purges B11, and runs. At 6:00 AM they are outside... all but one. The hospital
//   keeps the one who first answered its phone, "for the next shift".
//
// Every objective names the exact action and place, appears only when it becomes possible, and is
// completed only by real game state (an interaction, a position, an item, a co-op hold) - never a timer.
// The host runs the logic; every client builds the same props/interactions and renders the shared
// state. Scripted beats are frame-timed (not setTimeout), so they stay in step with the simulation.
import * as THREE from 'three';
import { audio } from '../audio/audio.js';
import { seededRandom, shuffle } from '../core/util.js';
import { workOrder, MAINT_LOG, GEN_LOG, FUSE_TAGS, k7File, PLACARDS } from './docs.js';
import { MPDressing } from './dressing.js';
import { Shutter } from './shutter.js';
import { Klaxon } from './klaxon.js';
import { LINES } from './lines.js';
import { CamTrack, loadCamTrack } from '../systems/camtrack.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const PI = Math.PI;

// ---------------------------------------------------------------- places
export const P = {
  van: V(-36, 0, 5),
  desk: V(-16.2, 0, -4.2),
  chair: { x: -16.6, y: 0, z: -5.15, yaw: PI },
  phone: V(-15.25, 0.775, -4.35),
  drawer: V(-16.6, 0.6, -4.6),
  computer: V(-16.9, 1.0, -4.15),
  log: V(6.75, 0.775, 3.78),
  bkey: V(12.7, 0.775, 3.62),
  gate: { x0: 19.5, x1: 22, z: -1.42, y: 0 },
  gateRelease: [V(22.0, 1.15, -0.9), V(21.95, 0.55, -2.4)],
  gen: V(-20.4, -4, -5.1),
  genLog: V(-13.9, -3.1, -8.45),
  primer: V(-19.75, -3.05, -5.85),
  cord: V(-19.75, -3.05, -4.35),
  panel: V(-17, -4, -8.75),
  override: [V(-15.75, -2.85, -8.82), V(-16.95, 1.05, -4.05)],     // power room wall / reception computer
  breakerA: V(-16.0, -2.5, -8.5),                                    // the panel's main lever
  breakerB: V(-21.84, -2.55, 3.2),                                   // maintenance B01, west wall
  cctvDesk: V(12.5, 12.78, -7.35),
  cctvRack: V(14.8, 12, -8.55),
  file: V(12.05, 12.78, -7.45),
  safeDoor: 'door_405',
  safeOut: V(-17, 12, -0.4),                                         // the corridor side of the safe-room door
  sw: [
    { name: 'CONTROL ROOM (403, FLOOR 4)', pos: V(3.4, 13.05, 8.85), rot: PI },
    { name: 'ELECTRICAL ROOM (309, FLOOR 3)', pos: V(16.91, 9.05, -7.35), rot: -PI / 2, pos2: V(16.91, 9.05, -4.6) },
    { name: 'CONTAINMENT (B11, BASEMENT)', pos: V(-11.91, -2.95, -3.0), rot: PI / 2 },
  ],
  purge: V(-4.15, -2.6, -2.2),
  exitRelease: V(-21.75, 1.2, 1.9),
  cont: { x: -8, zGlass: -5.6 },
  chamber: V(-7.5, -4, -6.6),                                        // where K-7 stands on the B11 camera (behind the broken pane)
  shutter: { x: 4.0, y: -4, z: 0 },
  crank: [{ pos: V(1.6, -3.0, 1.42), ry: PI }, { pos: V(6.4, -3.0, -1.42), ry: 0 }],      // 2.4 m from the curtain: nobody cranks and dives under alone
};

// rooms used for "everyone inside" checks
const AREA = {
  inside: p => p.x > -21.6 && p.x < 22 && p.z > -9 && p.z < 9,
  basement: p => p.y < -2.5,
  b10: p => p.y < -2.5 && p.x > -22 && p.x < -12 && p.z < -1.5,
  b11: p => p.y < -2.5 && p.x > -12 && p.x < -4 && p.z < -1.5,
  sec: p => p.y > 11.5 && p.x > 8 && p.x < 17 && p.z < -1.5,
  safe: p => p.y > 11.5 && p.x > -22 && p.x < -12 && p.z < -1.5,
  lobby: p => p.y > -0.5 && p.y < 2 && p.x < -10 && p.x > -21.8,
  outside: p => p.x < -22.6,
  westOfShutter: p => p.y < -2.5 && p.x < P.shutter.x - 0.2,
};

const SPAWNS = {
  start: [-28.5, 0, 0, -PI / 2], arrive: [-15.5, 0, -2.2, PI / 2], generator: [-17.5, -4, -5, 0],
  fuses2: [-16.5, -4, -4.5, 0], fuses4: [-16.5, -4, -4.5, 0], power: [-16.5, -4, -4.5, 0],
  breach: [12.2, 12, -4.8, 0], safe: [-17, 12, -3.2, PI / 2], switches: [-15.5, 12, -3.2, PI / 2],
  final: [-8, -4, -2.6, 0],
};

const CCTV = [
  { name: 'CAM 1 - FLOOR 4 CORRIDOR', pos: V(16.4, 14.7, 1.2), look: V(-6, 13, -0.3) },
  { name: 'CAM 2 - FLOOR 3 CORRIDOR', pos: V(16.4, 10.7, 1.2), look: V(-6, 9, -0.3) },
  { name: 'CAM 3 - STAIRWELL', pos: V(21.6, 5.6, -8.6), look: V(18.4, 2.2, -3.2) },
  { name: 'CAM 4 - BASEMENT CORRIDOR', pos: V(16.7, -1.5, -1.25), look: V(-12, -3.5, 0.7) },
  { name: 'CAM 5 - B11 CONTAINMENT', pos: V(-4.6, -1.45, -2.0), look: V(-9, -3.3, -6.6) },
  { name: 'CAM 6 - LOBBY', pos: V(-10.6, 2.7, 8.4), look: V(-20, 0.8, -2) },
];

// story clock (minutes after midnight) each step brings the night to: 1:40 AM ... 6:00 AM
const fmtClock = m => { const h = Math.floor(m / 60), mm = Math.floor(m % 60); return `${h}:${String(mm).padStart(2, '0')} AM`; };

export function defaultState(seed, n) {
  return {
    v: 2, seed, step: 0, n, clock: 100,
    orderRead: false,
    entranceOpen: true, entranceLocked: false,
    seated: -1, satT: 0, ringing: false, answered: false, answeredBy: -1, callDone: false,
    flashTaken: [], drawerOpen: false, keycard: false, door103: true,
    logRead: false, bkey: false, gateLocked: true, gateOpen: 0, b10: true,
    gen: false, power: 'off', panelSeen: false,
    fuses: [], picked: 0, inserted: 0, lockdown: false, lockdownDone: false,
    breakers: false, secVisited: false, cctv: false, fileRead: false, b11Seen: false,
    chase: null, safeLocked: false, besiege: null, switches: [0, 0, 0], purge: false, purgedBy: -1,
    shutterDown: false, exitOpen: false,
    ending: false, missing: -1, done: false,
    batt: [], parts: {},
  };
}

export class MPStory {
  constructor(session, startMsg) {
    this.S = session; this.g = session.g;
    this.P = P;
    this.state = startMsg.state || defaultState(startMsg.seed, startMsg.roster.length);
    this.objects = {};
    this.cctvIdx = 0; this.inCCTV = false;
    this.t = 0;
    this.timers = [];           // host: frame-timed beats
    this.ctimers = [];          // every client: frame-timed presentation
    this.dressing = new MPDressing(this.g);
    this.klaxon = new Klaxon();
  }
  get host() { return this.S.isHost; }

  // frame-timed scheduling (pauses with the simulation, survives no setTimeout drift)
  after(sec, fn) { this.timers.push({ t: this.t + sec, fn }); }
  later(sec, fn) { this.ctimers.push({ t: this.t + sec, fn }); }
  runTimers(list) {
    for (let i = list.length - 1; i >= 0; i--) if (list[i].t <= this.t) { const tm = list.splice(i, 1)[0]; try { tm.fn(); } catch (e) { console.error('[mp story]', e); } }
  }

  // ================================================================ objectives (one step at a time)
  get steps() {
    const S = this.S, s = this.state;
    const standing = () => S.standing();
    const count = (pred) => { const st = standing(); return [st.filter(p => pred(p.pos)).length, st.length]; };
    const all = (pred) => { const [a, b] = count(pred); return b > 0 && a === b; };
    const near = (v, r) => S.alivePlayers().some(p => p.pos.distanceTo(v) < r);
    const fuseLines = () => {
      const out = [];
      for (const f of s.fuses) {
        if (f.st === 'inserted') continue;
        const who = f.st === 'carried' ? S.players.get(f.by)?.name : null;
        out.push(f.st === 'carried' ? { text: `INSERT FUSE #${f.n} INTO THE POWER PANEL (B10)`, count: who ? `${who} HAS IT` : '' }
          : f.st === 'dropped' ? { text: `PICK UP FUSE #${f.n} - DROPPED NEAR ${f.where}` }
          : { text: `FIND FUSE #${f.n} - ${f.roomName}` });
      }
      return out;
    };
    const nSw = s.switches.filter(Boolean).length;
    return [
      // ---------------- SCENE 1 - ARRIVAL
      { id: 'order', t: 101, lines: () => [{ text: 'READ THE WORK ORDER (ON THE CAR)' }], done: () => s.orderRead },
      { id: 'enter', t: 103, lines: () => [{ text: 'ENTER THE HOSPITAL', count: count(AREA.inside).join('/') }], done: () => all(AREA.inside), exit: () => this.closeEntrance() },
      { id: 'desk', t: 105, lines: () => [{ text: 'GO TO THE RECEPTION DESK' }], done: () => near(P.desk, 2.6) },
      // ---------------- SCENE 2 - THE CARETAKER
      { id: 'sit', t: 106, lines: () => [{ text: 'SIT ON THE RECEPTION CHAIR' }], done: () => s.seated >= 0 },
      { id: 'wait', t: 108, lines: () => [{ text: 'WAIT FOR THE PHONE TO RING' }], done: () => s.ringing },
      { id: 'answer', t: 110, lines: () => [{ text: s.answered ? 'LISTEN TO THE CALLER' : 'ANSWER THE PHONE' }], done: () => s.callDone, cp: 'arrive' },
      { id: 'flash', t: 113, lines: () => [{ text: 'PICK UP A FLASHLIGHT FROM THE RECEPTION DESK', count: `${s.flashTaken.length}/${standing().length}` }], done: () => standing().every(p => s.flashTaken.includes(p.slot)) },
      { id: 'stand', t: 114, lines: () => [{ text: 'STAND UP FROM THE RECEPTION CHAIR' }], done: () => !S.roster.some(p => p.seated && !p.hidden && Math.hypot(p.pos.x - P.chair.x, p.pos.z - P.chair.z) < 0.9) },
      { id: 'drawer', t: 115, lines: () => [{ text: 'OPEN THE RECEPTION DESK DRAWER' }], done: () => s.drawerOpen },
      { id: 'keycard', t: 116, lines: () => [{ text: 'TAKE THE STAFF KEYCARD' }], done: () => s.keycard },
      // ---------------- SCENE 3 - STAFF RECORDS
      { id: 'door103', t: 119, lines: () => [{ text: "UNLOCK THE NURSES' STATION DOOR (103)" }], done: () => !s.door103 },
      { id: 'log', t: 122, lines: () => [{ text: "READ THE MAINTENANCE LOG IN THE NURSES' STATION (103)" }], done: () => s.logRead },
      { id: 'bkey', t: 127, lines: () => [{ text: 'TAKE THE MAINTENANCE KEYS FROM THE STORAGE ROOM DESK (104)' }], done: () => s.bkey },
      { id: 'gate', t: 131, lines: () => [{ text: 'UNLOCK THE BASEMENT GATE (STAIRWELL, FLOOR 1)' }], done: () => !s.gateLocked },
      // ---------------- SCENE 4 - THE BASEMENT
      { id: 'down', t: 136, lines: () => [{ text: 'EVERYONE: GO DOWN TO THE BASEMENT', count: count(AREA.basement).join('/') }], done: () => all(AREA.basement), exit: () => this.basementBeats() },
      { id: 'b10', t: 140, lines: () => [{ text: 'UNLOCK THE POWER ROOM DOOR (B10)' }], done: () => !s.b10 },
      { id: 'locate', t: 143, lines: () => [{ text: 'LOCATE THE EMERGENCY GENERATOR (POWER ROOM B10)' }], done: () => near(P.gen, 2.8) },
      { id: 'gen', t: 151, lines: () => [{ text: 'START THE GENERATOR: HOLD THE FUEL PRIMER', coop: true }, { text: '...WHILE A TEAMMATE PULLS THE START CORD', coop: true }], done: () => s.gen, cp: 'generator' },
      // ---------------- SCENE 5 - FOUR FUSES
      { id: 'panel', t: 157, lines: () => [{ text: 'INSPECT THE ELECTRICAL PANEL (B10)' }], done: () => s.panelSeen },
      { id: 'fuses', t: () => 165 + s.inserted * 15, lines: () => [...fuseLines().slice(0, 3)].map((l, i) => i ? l : { ...l, count: `FUSES ${s.inserted}/4` }), done: () => s.inserted >= 4 && !s.lockdown, cp: 'fuses4',
        sub: () => s.lockdown ? [{ text: 'REOPEN THE BASEMENT GATE: HOLD THE GATE RELEASE (STAIRWELL)', coop: true }, { text: '...WHILE A TEAMMATE PRESSES THE OVERRIDE (RECEPTION COMPUTER OR B10)', coop: true }] : null },
      // ---------------- SCENE 6 - MAIN POWER
      { id: 'main', t: 229, lines: () => [{ text: 'RESTORE THE MAIN POWER: PULL BOTH MAIN BREAKERS AT THE SAME TIME', coop: true }, { text: 'BREAKER 1: POWER ROOM (B10)  -  BREAKER 2: MAINTENANCE (B01)' }], done: () => s.power === 'main', cp: 'power' },
      // ---------------- SCENE 7 - THE SECURITY OFFICE
      { id: 'sec', t: 241, lines: () => [{ text: 'GO TO THE SECURITY OFFICE (408, FLOOR 4)' }], done: () => near(P.cctvDesk.clone().setY(12), 3.5) || s.secVisited },
      { id: 'cctv', t: 247, lines: () => [{ text: 'LOG IN TO THE CCTV TERMINAL' }], done: () => s.cctv },
      { id: 'file', t: 252, lines: () => [{ text: 'READ THE CONTAINMENT FILE ON THE SECURITY DESK' }], done: () => s.fileRead, cp: 'breach' },
      { id: 'b11cam', t: 257, lines: () => [{ text: 'CHECK THE B11 CONTAINMENT CAMERA ON THE CCTV' }], done: () => s.b11Seen, exit: () => this.b11Reveal() },
      // ---------------- SCENE 8/9 - BREACH, SAFE ROOM
      { id: 'safe', t: 265, lines: () => [{ text: 'GET EVERYONE INTO THE SAFE ROOM: RECORDS ARCHIVE (405, FLOOR 4)', count: count(AREA.safe).join('/') }, { text: 'THEN LOCK THE SAFE ROOM DOOR' }], done: () => s.safeLocked, cp: 'safe', exit: () => this.besiege() },
      { id: 'quiet', t: 274, lines: () => [{ text: 'STAY QUIET. IT IS RIGHT OUTSIDE THE DOOR.' }], done: () => s.besiege === 'done' },
      // ---------------- SCENE 10 - CONTAINMENT
      { id: 'switches', t: () => 284 + nSw * 12, lines: () => {
        const L = [{ text: 'CONTAIN IT: ENGAGE THE EMERGENCY CONTAINMENT SWITCHES', count: `SWITCHES ${nSw}/3` }];
        if (!s.switches[0]) L.push({ text: `HOLD THE FIELD SWITCH IN THE ${P.sw[0].name}` });
        if (!s.switches[1]) L.push({ text: `TURN BOTH KEYS TOGETHER: ${P.sw[1].name}`, coop: true });
        if (!s.switches[2]) L.push({ text: `HOLD THE SEAL SWITCH IN ${P.sw[2].name}` });
        return L;
      }, done: () => s.switches.every(Boolean), cp: 'switches', enter: () => this.startHunt('switches') },
      // ---------------- SCENE 11/12 - B11, PURGE
      { id: 'return', t: 323, lines: () => [{ text: 'RETURN TO THE BASEMENT: CONTAINMENT ROOM (B11)', count: count(AREA.b11).join('/') }], done: () => all(AREA.b11), enter: () => this.endChase(), cp: 'final' },
      { id: 'purge', t: 331, lines: () => [{ text: 'PULL THE CONTAINMENT PURGE LEVER (B11)' }], done: () => s.purge, exit: () => this.finalChase() },
      // ---------------- SCENE 13 - ESCAPE
      { id: 'lobby', t: 342, lines: () => [{ text: 'ESCAPE: REACH THE LOBBY (FLOOR 1)', count: count(AREA.lobby).join('/') }], done: () => S.alivePlayers().some(p => AREA.lobby(p.pos)),
        sub: () => this.shutterLines() },
      { id: 'exit', t: 350, lines: () => [{ text: 'OPEN THE MAIN ENTRANCE: HOLD THE DOOR RELEASE BY THE ENTRANCE', coop: true }, { text: '...WHILE A TEAMMATE ENTERS THE CODE AT THE RECEPTION COMPUTER', coop: true }], done: () => s.exitOpen, sub: () => this.shutterLines() },
      { id: 'out', t: 356, lines: () => [{ text: 'EVERYONE: GET OUTSIDE', count: count(AREA.outside).join('/') }], done: () => all(AREA.outside), exit: () => this.escape() },
      { id: 'end', t: 360, lines: () => [], done: () => false },
    ];
  }

  // the purge drops the basement shutter between B11 and the stairs: a real co-op crossing
  shutterLines() {
    const s = this.state, S = this.S;
    if (!s.shutterDown) return null;
    const west = S.standing().filter(p => AREA.westOfShutter(p.pos) && p.life === 'alive');
    if (!west.length) return null;
    const east = S.alivePlayers().filter(p => p.pos.y < -2.5 && p.pos.x > P.shutter.x + 0.2);
    const L = [{ text: 'THE EMERGENCY SHUTTER IS DOWN (BASEMENT CORRIDOR)', count: `${west.length} STILL BEHIND IT` },
      { text: 'HOLD THE CRANK TO RAISE IT - THE OTHERS CROUCH UNDER', coop: true }];
    if (east.length) L.push({ text: '...THEN CRANK FROM THE FAR SIDE FOR THE LAST ONE', coop: true });
    return L;
  }

  objectiveLines() {
    const s = this.state;
    if (s.ending) return [];
    const st = this.steps[s.step]; if (!st) return [];
    const sub = st.sub?.();
    return sub || st.lines(s);
  }
  clockText() { return fmtClock(this.state.clock ?? 100); }
  runWarning() { const s = this.state; return !!s.chase && this.g.koala?.visible && this.S.hunter?.chasing !== false && (s.chase === 'breach' || s.chase === 'final' || s.chase === 'switches'); }
  speedMul() { return 1; }
  get lockMove() { return this.inCCTV || !!this.standing || !!this.arrival; }
  // intense moments: the HUD name tags fade away
  get intense() { const s = this.state; return !!s.chase || this.stepId === 'quiet' || s.ending; }

  // ================================================================ world props (every client)
  async preload() { await this.dressing.load(); }

  build() {
    const g = this.g, w = g.world;
    const add = (name, pos, ry = 0, parent = g.scene) => { const o = w.item(name); o.position.copy(pos); o.rotation.y = ry; parent.add(o); return o; };
    // the crew's car in the car park, the work order on its hood
    const van = w.item('car'); van.position.set(-36, 0, 5); van.rotation.y = PI * 0.55; g.scene.add(van); g.parkedCar = van;
    van.updateMatrixWorld(true);
    this.objects.order = this.dressing.put('mp_clipboard', 0, 0, 0, 0);
    this.objects.order.position.copy(this.hoodSpot(van)); this.objects.order.rotation.y = PI * 0.55 + 0.2;
    // reception: phone, chair, flashlights on the counter, the drawer with the keycard
    this.objects.phone = add('phone_desk', P.phone, PI);
    const hs = w.item('phone_handset'); hs.position.set(0, 0.09, 0.06); this.objects.phone.add(hs); this.objects.handset = hs;
    this.objects.flashes = [];
    for (let i = 0; i < 4; i++) {
      const f = w.item('flashlight');
      f.position.set(-17.2 + i * 0.38, 1.115, -3.98); f.rotation.set(0, 0.3 + i * 0.4, PI / 2);
      g.scene.add(f); this.objects.flashes.push(f);
    }
    const dr = new THREE.Group(); dr.position.copy(P.drawer); dr.add(w.item('drawer')); g.scene.add(dr);
    const card = w.item('key'); card.position.set(0.04, 0.05, 0.18); dr.add(card);
    this.objects.drawer = dr; this.objects.card = card; this.drawerAmt = 0;
    // documents and keys
    this.objects.log = add('document_folder', P.log, 0.3);
    this.objects.bkey = add('key', P.bkey, 1.1);
    this.objects.file = add('document_folder', P.file, -0.2);
    // the basement gate (floor 1 stairwell): bars + a real collider that blocks players and the Koala
    this.buildGate();
    // generator controls (on the existing B10 generator)
    this.objects.primer = this.marker(P.primer, 0x8a1d12); this.objects.cord = this.marker(P.cord, 0xc9a227, 'cord');
    // power panel fuse slots + main breaker (B10) + second breaker (B01)
    this.objects.slots = [];
    for (let i = 0; i < 4; i++) {
      const m = w.item('fuse'); m.rotation.z = PI / 2;
      m.position.set(P.panel.x - 0.75 + i * 0.5 + 0.07, P.panel.y + 1.32, P.panel.z + 0.3); m.visible = false;
      g.scene.add(m); this.objects.slots.push(m);
    }
    this.objects.leverA = add('power_lever', V(P.panel.x + 1.0, P.panel.y + 1.5, P.panel.z + 0.25));
    this.objects.leverB = add('power_lever', P.breakerB.clone().setY(P.breakerB.y + 0.05), PI / 2);
    this.objects.override = P.override.map(p => this.marker(p, 0xb3261e, 'button'));
    this.objects.release = P.gateRelease.map(p => this.marker(p, 0xd0a02a));
    this.objects.exitRelease = this.marker(P.exitRelease, 0xd0a02a);
    // CCTV in the security office: the rack's screens wake with the main power
    this.objects.rack = add('cctv_rack', P.cctvRack, 0);
    this.objects.rackScreens = [];
    this.objects.rack.traverse(c => { if (c.isMesh && c.material?.name === 'M_screen') { c.material = c.material.clone(); this.objects.rackScreens.push(c.material); } });
    // emergency switches
    this.objects.switches = P.sw.map((sw) => {
      const box = add('switch_box', sw.pos, sw.rot);
      const lamp = w.item('switch_lamp'); box.add(lamp);
      const h = w.item('switch_handle'); box.add(h);
      let box2 = null;
      if (sw.pos2) { box2 = add('switch_box', sw.pos2, sw.rot); box2.add(w.item('switch_handle')); }
      return { box, lamp, handle: h, box2 };
    });
    // containment room: frame, open chamber door, the original restraint bed
    add('containment_frame', V(P.cont.x, -4, P.cont.zGlass), 0);
    add('containment_door', V(P.cont.x - 1.5, -4, P.cont.zGlass), 0);
    add('restraint_bed', V(P.cont.x + 0.2, -4, -7.6), 0.25);
    this.objects.purge = add('power_lever', P.purge, -PI / 2);
    this.chamberLight = new THREE.PointLight(0xff2a1a, 0, 7, 2); this.chamberLight.position.set(P.cont.x, -1.6, -7); g.scene.add(this.chamberLight);
    // fuses (seeded so every machine agrees)
    this.chooseFuses();
    this.fuseObjs = new Map();
    for (const f of this.state.fuses) {
      const m = w.item('fuse'); m.position.copy(V(...f.pos)); m.rotation.y = f.yaw;
      g.scene.add(m); this.fuseObjs.set(f.n, m);
    }
    // environmental storytelling + the emergency shutter + crank
    this.dressing.build(this);
    this.shutter = new Shutter(g, this.dressing, { id: 'b_corridor', ...P.shutter });
    this.objects.cranks = P.crank.map(c => {
      this.dressing.put('mp_crank_base', c.pos.x, c.pos.y - 0.13, c.pos.z, c.ry);
      const wheel = this.dressing.put('mp_crank_wheel', c.pos.x, c.pos.y, c.pos.z, c.ry);
      wheel.position.add(V(Math.sin(c.ry), 0, Math.cos(c.ry)).multiplyScalar(0.055));
      return wheel;
    });
    this.setupInteractions();
    this.setupCCTV();
    this.S.registerReviveTargets();
  }

  // a spot on the car's hood: raycast down on the front of the body
  hoodSpot(car) {
    const ray = new THREE.Raycaster();
    const local = V(0, 3, 1.55), world = local.clone().applyMatrix4(car.matrixWorld);
    ray.set(world, V(0, -1, 0));
    const hit = ray.intersectObject(car, true)[0];
    return hit ? hit.point.add(V(0, 0.004, 0)) : V(-35, 1.0, 5.4);
  }

  marker(pos, color, kind = 'valve') {
    const g = this.g;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.4, emissive: new THREE.Color(color), emissiveIntensity: 0.12 });
    const geo = kind === 'button' ? new THREE.CylinderGeometry(0.045, 0.045, 0.04, 20).rotateX(PI / 2)
      : kind === 'cord' ? new THREE.TorusGeometry(0.05, 0.012, 8, 16) : new THREE.CylinderGeometry(0.06, 0.06, 0.03, 20).rotateX(PI / 2);
    const m = new THREE.Mesh(geo, mat); m.position.copy(pos); g.scene.add(m);
    return m;
  }

  buildGate() {
    const g = this.g, G = P.gate;
    const grp = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.55, metalness: 0.7 });
    for (let x = G.x0 + 0.1; x < G.x1; x += 0.24) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 2.3, 6), mat); b.position.set(x, G.y + 1.15, G.z); grp.add(b); }
    for (const y of [0.15, 1.15, 2.25]) { const b = new THREE.Mesh(new THREE.BoxGeometry(G.x1 - G.x0, 0.05, 0.05), mat); b.position.set((G.x0 + G.x1) / 2, G.y + y, G.z); grp.add(b); }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.22), new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.6 }));
    sign.position.set((G.x0 + G.x1) / 2, G.y + 1.5, G.z + 0.03); grp.add(sign);
    g.scene.add(grp);
    this.objects.gate = grp; this.gateAmt = 0;
    const self = this;
    g.world.physics.dynamic.push({
      segment() { return self.gateAmt > 0.85 ? null : { ax: G.x0, az: G.z, bx: G.x1, bz: G.z, y0: G.y - 2.5, y1: G.y + 2.4, thick: 0.05 }; },
      blocksSight() { return false; },
      box() { return null; },
    });
  }

  chooseFuses() {
    const s = this.state, L = this.g.layout;
    if (s.fuses.length) return;
    const rnd = seededRandom(s.seed + 911);
    const skip = new Set(['103', '104', 'B10', 'B11', '405', '408', '403', '309']);
    const byLevel = {};
    for (const f of L.fuseLocations) {
      if (skip.has(f.room)) continue;
      const tops = f.spots.filter(sp => sp.kind === 'top');
      if (!tops.length) continue;
      (byLevel[f.level] ||= []).push({ ...f, tops });
    }
    const levels = shuffle(['1', '2', '3', '4'].filter(l => byLevel[l]), rnd);
    s.fuses = levels.slice(0, 4).map((lv, i) => {
      const f = byLevel[lv][Math.floor(rnd() * byLevel[lv].length)];
      const sp = f.tops[Math.floor(rnd() * f.tops.length)];
      return { n: i + 1, room: f.room, roomName: `${f.room} ${f.name.toUpperCase()} (FLOOR ${lv})`, pos: [sp.x, sp.y, sp.z], yaw: sp.rot || 0, st: 'hidden', by: -1, tag: -1 };
    });
  }

  // ---------------------------------------------------------------- interactions (all clients)
  setupInteractions() {
    const g = this.g, I = g.interact, S = this.S, s = () => this.state, L = g.layout;
    const req = (a, d) => () => S.request(a, d);
    const alive = () => S.me.life === 'alive' && !this.taken;
    I.add({ id: 'mp_order', pos: () => this.objects.order.position.clone().add(V(0, 0.03, 0)), radius: 2.0, cone: 0.5,
      enabled: () => alive() && !s().ending, prompt: () => '[E] Read Work Order',
      action: () => { this.readDoc('order'); S.request('read', { doc: 'order' }); } });
    I.add({ id: 'mp_chair', pos: V(P.chair.x, 0.8, P.chair.z), radius: 1.9, cone: 0.6,
      enabled: () => alive() && !g.player.seated && s().seated < 0 && this.stepId === 'sit', prompt: () => '[E] Sit Down',
      action: () => this.sitDown() });
    I.add({ id: 'mp_phone', pos: () => P.phone.clone().setY(0.9), radius: 2.0,
      enabled: () => alive() && s().ringing && !s().answered, prompt: () => '[E] Answer Phone', action: req('answer') });
    this.objects.flashes.forEach((f, i) => I.add({ id: 'mp_flash_' + i, pos: () => f.position, radius: 1.9, cone: 0.35,
      enabled: () => alive() && f.visible && s().callDone && !g.flashlight.has, prompt: () => '[E] Pick Up Flashlight', action: req('flash', { i }) }));
    I.add({ id: 'mp_drawer', pos: () => this.objects.drawer.position.clone().add(V(0, 0.06, -0.05)), radius: 1.7, cone: 0.7,
      enabled: () => alive() && s().callDone && !g.player.seated && (!s().drawerOpen || !s().keycard),
      prompt: () => s().drawerOpen ? '[E] Take Staff Keycard' : '[E] Open Drawer', action: () => S.request(s().drawerOpen ? 'keycard' : 'drawer') });
    I.add({ id: 'mp_log', pos: () => P.log, radius: 1.8, cone: 0.45, enabled: () => alive() && !s().door103, prompt: () => '[E] Read Maintenance Log',
      action: () => { this.readDoc('log'); S.request('read', { doc: 'log' }); } });
    I.add({ id: 'mp_genlog', pos: () => P.genLog, radius: 1.8, cone: 0.45, enabled: () => alive() && !s().b10, prompt: () => '[E] Read Generator Log',
      action: () => this.readDoc('genlog') });
    P.sw.forEach((sw, i) => I.add({ id: 'mp_placard_' + i, pos: () => this.placardPos(i), radius: 1.6, cone: 0.35, enabled: () => alive() && s().fileRead, prompt: () => '[E] Read Procedure',
      action: () => this.readDoc('placard', i) }));
    I.add({ id: 'mp_bkey', pos: () => P.bkey, radius: 1.8, cone: 0.45, enabled: () => alive() && s().logRead && !s().bkey, prompt: () => '[E] Take Maintenance Keys', action: req('bkey') });
    I.add({ id: 'mp_gate', pos: V(20.75, 1.1, P.gate.z + 0.2), radius: 2.4, cone: 0.6,
      enabled: () => alive() && s().gateLocked && !s().lockdown, prompt: () => s().bkey ? '[E] Unlock Gate' : '[E] Gate (locked)', action: req('gate') });
    P.gateRelease.forEach((p, i) => I.add({ id: 'mp_release_' + i, hold: true, holdLabel: 'HOLDING THE GATE RELEASE', pos: p, radius: 1.8, cone: 0.6,
      enabled: () => alive() && s().lockdown, prompt: () => '[HOLD E] Gate Release', action: () => {} }));
    P.override.forEach((p, i) => I.add({ id: 'mp_override_' + i, hold: true, holdLabel: 'GATE OVERRIDE', pos: p, radius: 1.8, cone: 0.6,
      enabled: () => alive() && s().lockdown, prompt: () => '[HOLD E] Gate Override', action: () => {} }));
    I.add({ id: 'mp_b10', pos: () => g.world.doorById.door_B10.center, radius: 2.0, enabled: () => alive() && s().b10,
      prompt: () => s().bkey ? '[E] Unlock Power Room' : '[E] Power Room (locked)', action: req('b10') });
    I.add({ id: 'mp_primer', hold: true, holdLabel: 'HOLDING THE FUEL PRIMER', pos: P.primer, radius: 1.8, cone: 0.6,
      enabled: () => alive() && this.stepId === 'gen' && !s().gen, prompt: () => '[HOLD E] Fuel Primer', action: () => {} });
    I.add({ id: 'mp_cord', pos: P.cord, radius: 1.8, cone: 0.6, enabled: () => alive() && this.stepId === 'gen' && !s().gen, prompt: () => '[E] Pull Start Cord', action: req('cord') });
    I.add({ id: 'mp_panel', pos: () => P.panel.clone().add(V(0, 1.3, 0.3)), radius: 2.4, cone: 0.6,
      enabled: () => alive() && s().gen && (this.stepId === 'panel' || this.myFuse()),
      prompt: () => this.myFuse() ? `[E] Insert Fuse #${this.myFuse().n}` : '[E] Inspect Electrical Panel',
      action: () => S.request(this.myFuse() ? 'insert' : 'panel') });
    for (const f of this.state.fuses) I.add({ id: 'mp_fuse_' + f.n, pos: () => this.fuseObjs.get(f.n).position.clone().setY(this.fuseObjs.get(f.n).position.y + 0.04), radius: 2.0, cone: 0.35,
      enabled: () => alive() && s().panelSeen && (this.fuse(f.n).st === 'world' || this.fuse(f.n).st === 'dropped') && !this.myFuse(), prompt: () => `[E] Pick Up Fuse #${f.n}`, action: req('fuse', { n: f.n }) });
    I.add({ id: 'mp_breakerA', hold: true, holdLabel: 'PULLING BREAKER 1', pos: () => this.objects.leverA.position, radius: 2.0, cone: 0.6,
      enabled: () => alive() && this.stepId === 'main', prompt: () => '[HOLD E] Main Breaker 1', action: () => {} });
    I.add({ id: 'mp_breakerB', hold: true, holdLabel: 'PULLING BREAKER 2', pos: () => this.objects.leverB.position, radius: 2.0, cone: 0.6,
      enabled: () => alive() && this.stepId === 'main', prompt: () => '[HOLD E] Main Breaker 2', action: () => {} });
    I.add({ id: 'mp_cctv', pos: P.cctvDesk, radius: 2.2, cone: 0.6, enabled: () => alive() && s().power === 'main' && !this.inCCTV,
      prompt: () => s().cctv ? '[E] Use CCTV' : '[E] Log In to CCTV', action: () => { if (!s().cctv) S.request('cctv'); this.enterCCTV(); } });
    I.add({ id: 'mp_file', pos: P.file, radius: 1.8, cone: 0.5, enabled: () => alive() && s().cctv, prompt: () => '[E] Read Containment File',
      action: () => { this.readDoc('file'); S.request('read', { doc: 'file' }); } });
    I.add({ id: 'mp_safe', pos: () => g.world.doorById[P.safeDoor].center, radius: 2.2, cone: 0.6,
      enabled: () => alive() && this.stepId === 'safe' && !s().safeLocked, prompt: () => '[E] Lock Safe Room Door', action: req('safelock') });
    P.sw.forEach((sw, i) => {
      I.add({ id: 'mp_sw_' + i, hold: true, holdLabel: i === 2 ? 'HOLDING THE SEAL SWITCH' : 'HOLDING THE FIELD SWITCH', pos: () => sw.pos.clone().add(V(0, 0.1, 0)), radius: 2.0, cone: 0.6,
        enabled: () => alive() && this.stepId === 'switches' && !s().switches[i], prompt: () => i === 1 ? '[HOLD E] Turn Key A' : '[HOLD E] Containment Switch', action: () => {} });
      if (sw.pos2) I.add({ id: 'mp_sw_1b', hold: true, holdLabel: 'TURNING KEY B', pos: () => sw.pos2.clone().add(V(0, 0.1, 0)), radius: 2.0, cone: 0.6,
        enabled: () => alive() && this.stepId === 'switches' && !s().switches[1], prompt: () => '[HOLD E] Turn Key B', action: () => {} });
    });
    this.g.interact.get('mp_sw_1').holdLabel = 'TURNING KEY A';
    I.add({ id: 'mp_purge', pos: P.purge, radius: 2.0, cone: 0.6, enabled: () => alive() && this.stepId === 'purge', prompt: () => '[E] Pull Purge Lever', action: req('purge') });
    P.crank.forEach((c, i) => I.add({ id: 'mp_crank_' + i, hold: true, holdLabel: 'CRANKING THE SHUTTER', pos: () => c.pos, radius: 1.8, cone: 0.6,
      enabled: () => alive() && s().shutterDown, prompt: () => '[HOLD E] Shutter Crank', action: () => {} }));
    I.add({ id: 'mp_exitRelease', hold: true, holdLabel: 'HOLDING THE DOOR RELEASE', pos: P.exitRelease, radius: 2.0, cone: 0.6,
      enabled: () => alive() && this.stepId === 'exit', prompt: () => '[HOLD E] Door Release', action: () => {} });
    I.add({ id: 'mp_code', hold: true, holdLabel: 'ENTERING THE DOOR CODE', pos: P.computer, radius: 2.0, cone: 0.6,
      enabled: () => alive() && this.stepId === 'exit', prompt: () => '[HOLD E] Enter Door Code', action: () => {} });
    I.add({ id: 'mp_entrance', pos: V(L.bounds.x0 + 0.3, 1.3, 0), radius: 2.3, cone: 0.6,
      enabled: () => (alive() || this.taken) && this.state.entranceLocked && !this.state.exitOpen || (this.taken && this.g.player.pos.x > L.bounds.x0),
      prompt: () => '[E] Main Doors',
      action: () => { audio.playAt('door_locked', V(L.bounds.x0, 1, 0), { bus: 'environment', volume: 0.9 }); g.ui.thought(this.taken ? '(Locked. They can\'t hear me.)' : '(Locked. Something sealed them behind us.)', 3); } });
    // the ending: only the one the hospital kept can answer
    I.add({ id: 'mp_endphone', pos: () => P.phone.clone().setY(0.9), radius: 2.2,
      enabled: () => !!this.taken && this.endRinging && !this.endAnswered, prompt: () => '[E] Answer Phone', action: () => { this.endAnswered = true; S.request('endanswer'); } });
    // doors go through the host (locks, Koala, everyone sees the same)
    for (const d of g.world.doors) I.add({ id: 'door_' + d.id, pos: () => d.center, radius: 1.9, cone: 0.55,
      enabled: () => alive() && (!d.locked || this.storyDoor(d.id)),
      prompt: () => d.locked ? (s().keycard ? '[E] Unlock (Staff Keycard)' : '[E] Door (keycard lock)') : d.target > 0.5 ? '[E] Close Door' : '[E] Open Door',
      action: () => S.request('door', { id: d.id }) });
  }
  placardPos(i) {
    const sw = P.sw[i];
    if (i === 0) return V(sw.pos.x - 0.75, sw.pos.y - 0.08, sw.pos.z - 0.03);
    if (i === 1) return V(sw.pos.x - 0.03, sw.pos.y - 0.08, (sw.pos.z + sw.pos2.z) / 2);
    return V(sw.pos.x + 0.03, sw.pos.y - 0.08, sw.pos.z + 0.75);
  }

  get stepId() { return this.steps[this.state.step]?.id; }
  // a locked door the story itself opens (the Nurses' Station keycard lock)
  storyDoor(id) { return id === 'door_103' && this.state.door103; }

  // ---------------------------------------------------------------- the reception chair (local)
  sitDown() {
    const g = this.g;
    if (g.player.seated) return;
    this.preSit = g.player.pos.clone();                 // where they stood: a known-free spot
    g.player.sit({ x: P.chair.x, y: 0, z: P.chair.z, yaw: P.chair.yaw });
    this.inChair = true;
    audio.play('cloth', { bus: 'player', volume: 0.6 });
    g.ui.toast('[E] STAND UP', 2.2);
    this.S.request('sit');
  }
  // a free standing spot next to the chair: collision-tested, on the floor, in plain sight of the seat
  standSpot() {
    const g = this.g, ph = g.world.physics, c = V(P.chair.x, 0, P.chair.z);
    const cands = [V(c.x - 0.85, 0, c.z - 0.2), V(c.x + 0.85, 0, c.z - 0.2), V(c.x, 0, c.z - 0.85), V(c.x - 0.75, 0, c.z - 0.75), V(c.x + 0.75, 0, c.z - 0.75)];
    if (this.preSit) cands.push(this.preSit.clone());
    for (const v of cands) {
      const q = v.clone(); ph.collide(q, 0.3, 1.75);
      if (q.distanceTo(v) > 0.02) continue;                                     // inside furniture / wall
      if (ph.groundAt(v.x, v.z, 0.3) === -Infinity) continue;
      if (!ph.los(V(c.x, 1.2, c.z), V(v.x, 1.2, v.z))) continue;                // never through the desk
      return v;
    }
    return this.preSit || V(c.x - 0.85, 0, c.z);
  }
  standUp() {
    const g = this.g, p = g.player;
    if (!this.inChair) return;
    const to = this.standSpot();
    p.stand();
    this.inChair = false;
    this.standing = { from: p.pos.clone(), to, t: 0 };
    p.canMove = false; p.vel.set(0, 0, 0);
    audio.play('cloth', { bus: 'player', volume: 0.5 });
    g.input.pressed.delete('KeyE');
    this.S.request('stand');
  }
  updateChair(dt) {
    const g = this.g, p = g.player;
    if (this.standing) {                                 // short, smooth step out of the chair
      const st = this.standing; st.t = Math.min(1, st.t + dt / 0.35);
      const e = st.t * st.t * (3 - 2 * st.t);
      p.pos.lerpVectors(st.from, st.to, e); p.vel.set(0, 0, 0);
      if (st.t >= 1) { this.standing = null; p.canMove = true; }
      return;
    }
    if (!this.inChair) return;
    if (!p.seated) { this.inChair = false; return; }   // something else stood us up (downed, teleport)
    if (this.g.mpPaused) return;
    // E stands up whenever nothing else is targeted (phone, flashlight... still work from the chair)
    if (!g.interact.current) g.ui.setPrompt('[E] Stand Up');
    if ((g.input.wasPressed('KeyE') && !g.interact.current) || g.input.wasPressed('Space')) this.standUp();
  }
  fuse(n) { return this.state.fuses.find(f => f.n === n); }
  myFuse() { return this.state.fuses.find(f => f.st === 'carried' && f.by === this.S.meSlot); }

  // ---------------------------------------------------------------- documents (local reader, paged)
  readDoc(doc, i = 0) {
    const names = this.S.roster.map(p => p.name);
    const D = doc === 'order' ? workOrder(names) : doc === 'log' ? MAINT_LOG : doc === 'genlog' ? GEN_LOG
      : doc === 'file' ? k7File(this.S.roster.length) : doc === 'placard' ? { title: PLACARDS[i].title, pages: [PLACARDS[i].html] }
      : doc === 'fusetag' ? { title: FUSE_TAGS[i].title, pages: [FUSE_TAGS[i].html] } : null;
    if (!D) return;
    this.reader = { D, page: 0, doc, i };
    this.showPage();
    audio.play('pickup', { bus: 'player', volume: 0.35, rate: 1.3 });
  }
  showPage() {
    const r = this.reader, n = r.D.pages.length;
    const html = (n > 1 ? `<span class="page">${r.page + 1}/${n}</span>` : '') + r.D.pages[r.page];
    this.g.ui.read(r.D.title, html, r.page < n - 1 ? '[E] NEXT PAGE' : '[E] CLOSE');
    this.readingOpen = true; this._rf = 0;
  }
  closeReader() {
    const r = this.reader; this.reader = null;
    this.g.ui.read(null); this.readingOpen = false; this.g.input.pressed.delete('KeyE');
    // a thought after the important ones
    if (r?.doc === 'order' && !this._orderThought) { this._orderThought = true; this.g.ui.thought('(Get the lights on, wipe the records, out by six. Easy money.)', 4); }
    if (r?.doc === 'log' && !this._logThought) { this._logThought = true; this.g.ui.thought('(Why would anyone take the fuses?)', 3.5); }
    if (r?.doc === 'genlog' && !this._genThought) { this._genThought = true; this.g.ui.thought('(They cut the power on purpose. And we were sent to turn it back on.)', 4.5); }
    if (r?.doc === 'fusetag') this.g.ui.thought(FUSE_TAGS[r.i].thought, 3.5);
    if (r?.doc === 'file' && !this._fileThought) { this._fileThought = true; this.g.ui.thought('(They knew. They sent us down here to let it out.)', 4.5); }
  }

  // ---------------------------------------------------------------- CCTV (local view mode)
  setupCCTV() {
    this.cctvCams = CCTV.map(c => { const cam = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 80); cam.position.copy(c.pos); cam.lookAt(c.look); cam.updateMatrixWorld(); return cam; });
    let ov = document.getElementById('mp-cctv');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'mp-cctv';
      ov.innerHTML = '<div class="cc-name" id="mp-cctv-name"></div><div class="cc-rec">&#9679; REC</div><div class="cc-time" id="mp-cctv-time"></div>'
        + '<div class="cc-obj" id="mp-cctv-obj"></div><div class="cc-lost hidden" id="mp-cctv-lost">SIGNAL LOST</div><div class="cc-static" id="mp-cctv-static"></div><div class="cc-help">[A] / [D] CAMERA &nbsp; [E] LEAVE TERMINAL</div>';
      document.getElementById('app').appendChild(ov);
    }
    this.cctvOv = ov;
  }
  enterCCTV() {
    this.inCCTV = true; this.cctvT = 0; this.g.player.canMove = false; this.cctvOv.style.display = 'block'; this.g.camera.layers.enable(2);
    if (!this._bootShown) { this._bootShown = true; this.camStatic(0.6); }
    this.showCam();
  }
  exitCCTV() { this.inCCTV = false; this.g.player.canMove = true; this.cctvOv.style.display = 'none'; this.g.camera.layers.disable(2); if (this.g.camera.fov !== 72) { this.g.camera.fov = 72; this.g.camera.updateProjectionMatrix(); } this.S.request('cctvcam', { i: -1 }); }
  showCam() {
    document.getElementById('mp-cctv-name').textContent = CCTV[this.cctvIdx].name;
    audio.play('ui_click', { bus: 'ui', volume: 0.4 });
    this.camStatic(0.18);
    if (this.cctvIdx === 4) this.S.request('b11cam');
    this.S.request('cctvcam', { i: this.cctvIdx });
  }
  camStatic(sec) { const el = document.getElementById('mp-cctv-static'); if (!el) return; el.style.opacity = 1; this.staticT = sec; audio.play('phone_static', { bus: 'ui', volume: 0.12 }); }
  updateCCTV(dt) {
    if (this.staticT > 0) { this.staticT -= dt; if (this.staticT <= 0) document.getElementById('mp-cctv-static').style.opacity = 0; }
    if (!this.inCCTV) return;
    const g = this.g, inp = g.input;
    this.cctvT += dt;
    if (!g.mpPaused) {
      if (inp.wasPressed('KeyD')) { this.cctvIdx = (this.cctvIdx + 1) % CCTV.length; this.showCam(); }
      if (inp.wasPressed('KeyA')) { this.cctvIdx = (this.cctvIdx + CCTV.length - 1) % CCTV.length; this.showCam(); }
      if ((inp.wasPressed('KeyE') && this.cctvT > 0.3)) { this.exitCCTV(); return; }
    }
    if (this.S.me.life !== 'alive') { this.exitCCTV(); return; }
    const lost = this.cctvIdx === 4 && this.state.b11Lost;
    document.getElementById('mp-cctv-lost').classList.toggle('hidden', !lost);
    document.getElementById('mp-cctv-time').textContent = `${this.clockText()}  ·  ${CCTV[this.cctvIdx].name.slice(0, 5)}`;
  }
  // main.js asks for this right after the player moved the camera: the whole frame (level visibility,
  // light pool, culling) is then built for the security camera, not for the player's head
  // SCENE 1 opening shot (Blender: ns_camera.build_mp_arrival), local to every player on a fresh night
  async startArrival() {
    const d = await loadCamTrack('mp_arrival'); if (!d) return;
    this.arrival = { track: new CamTrack(d), t: 0, cam: new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 200) };
    this.g.ui.letterbox(true); document.body.classList.add('cine-on');
  }
  updateArrival(dt) {
    const A = this.arrival; if (!A) return;
    A.t += dt;
    if (A.t > A.track.end || (A.t > 1 && this.g.input.wasPressed('Space'))) {
      this.arrival = null; this.g.ui.letterbox(false); document.body.classList.remove('cine-on');
      this.g.player.yaw = -PI / 2; this.g.player.pitch = 0;
      this.g.ui.thought('(St. Mercy. Closed since the evacuation.)', 3.5);
    }
  }
  cameraOverride() {
    if (this.arrival) { const A = this.arrival; A.track.apply(A.cam, Math.min(A.t, A.track.end)); return { pos: A.cam.position, quat: A.cam.quaternion, fov: A.cam.fov, level: '1', cctv: true }; }
    if (!this.inCCTV) return null;
    const c = this.cctvCams[this.cctvIdx];
    return { pos: c.position, quat: c.quaternion, fov: 70, level: this.g.world.physics.levelOf(c.position.y - 2.4), cctv: true };
  }
  get cctvViewing() { return this.inCCTV ? this.cctvIdx : -1; }
  cctvCam(i) { return this.cctvCams?.[i]; }

  // ================================================================ host: requests
  handle(slot, a, d) {
    const s = this.state, g = this.g, S = this.S, p = S.players.get(slot);
    const id = this.stepId;
    let changed = true;
    switch (a) {
      case 'sit': if (id === 'sit' && s.seated < 0) { s.seated = slot; s.satT = 0; } else changed = false; break;
      case 'stand': changed = false; break;     // progress reads the live seated flags
      case 'answer':
        if (s.ringing && !s.answered) { s.answered = true; s.answeredBy = slot; s.ringing = false; this.phoneCall(); }
        else changed = false; break;
      case 'flash': {
        if (!s.callDone || s.flashTaken.includes(slot)) { changed = false; break; }
        s.flashTaken.push(slot); s.flashIdx = s.flashIdx || []; s.flashIdx.push(d.i);
        S.fx('giveFlash', {}, slot);
        S.fx('sound', { id: 'pickup', o: { bus: 'player', volume: 0.7 } }, slot);
        break;
      }
      case 'drawer': if (s.callDone && !s.drawerOpen) { s.drawerOpen = true; S.fx('sound', { id: 'drawer_wood_open', pos: P.drawer.toArray(), o: { bus: 'environment', volume: 0.8 } }); } else changed = false; break;
      case 'keycard': if (s.drawerOpen && !s.keycard) { s.keycard = true; S.fx('toast', { text: `${p.name} TOOK THE STAFF KEYCARD` }); S.fx('sound', { id: 'key_pickup', o: { bus: 'player', volume: 0.7 } }, slot); } else changed = false; break;
      case 'door':
        if (d.id === 'door_103' && s.door103) {
          if (s.keycard) { s.door103 = false; const dd = g.world.doorById.door_103; dd.locked = null; dd.open(1.1, false); S.fx('sound', { id: 'entrance_unlock', pos: dd.center.toArray(), o: { bus: 'environment', volume: 0.8 } }); S.fx('toast', { text: 'NURSES\' STATION UNLOCKED' }); }
          else { S.fx('thought', { text: '(Keycard lock. Locked.)', dur: 2.5 }, slot); changed = false; }
        } else changed = false;
        break;
      case 'read':
        if (d.doc === 'order' && !s.orderRead) s.orderRead = true;
        else if (d.doc === 'log' && !s.door103) s.logRead = true;
        else if (d.doc === 'file' && s.cctv) s.fileRead = true;
        else changed = false; break;
      case 'bkey': if (s.logRead && !s.bkey) { s.bkey = true; S.fx('toast', { text: `${p.name} TOOK THE MAINTENANCE KEYS` }); S.fx('sound', { id: 'key_pickup', o: { bus: 'player', volume: 0.7 } }, slot); } else changed = false; break;
      case 'gate':
        if (s.bkey && s.gateLocked && !s.lockdown) { s.gateLocked = false; S.fx('sound', { id: 'metal_scrape', pos: [20.75, 1, P.gate.z], o: { bus: 'environment', volume: 0.9 } }); S.fx('sound', { id: 'entrance_unlock', pos: [20.75, 1, P.gate.z], o: { bus: 'environment', volume: 0.8 } }); }
        else { S.fx('sound', { id: 'door_locked', pos: [20.75, 1, P.gate.z], o: { bus: 'environment', volume: 0.9 } }); changed = false; }
        break;
      case 'b10':
        if (s.bkey && s.b10) { s.b10 = false; const dd = g.world.doorById.door_B10; dd.locked = null; dd.open(1.2, false); S.fx('sound', { id: 'entrance_unlock', pos: dd.center.toArray(), o: { bus: 'environment', volume: 0.8 } }); }
        else { S.fx('sound', { id: 'door_locked', pos: g.world.doorById.door_B10.center.toArray(), o: { bus: 'environment', volume: 0.9 } }); changed = false; }
        break;
      case 'cord': {
        if (id !== 'gen' || s.gen) { changed = false; break; }
        const primed = S.holding('mp_primer').size > 0 && [...S.holding('mp_primer').values()].some(t => t > 0.5);
        const solo = S.alivePlayers().length === 1 && (this.soloPrimer || 0) > 0;
        S.fx('sound', { id: 'metal_scrape', pos: P.cord.toArray(), o: { bus: 'environment', volume: 0.6, rate: 1.6 } });
        if (primed || solo) {
          this.cordPulls = (this.cordPulls || 0) + 1;
          if (this.cordPulls >= 3) { s.gen = true; s.power = 'gen'; this.cordPulls = 0; this.generatorOn(); }
          else S.fx('sound', { id: 'elevator_motor', pos: P.gen.toArray(), o: { bus: 'environment', volume: 0.5, rate: 0.7 } });
        } else S.fx('thought', { text: '(It coughs and dies. Someone has to hold the fuel primer.)', dur: 3 });
        changed = !!s.gen;
        break;
      }
      case 'panel': if (s.gen && !s.panelSeen) { s.panelSeen = true; for (const f of s.fuses) if (f.st === 'hidden') f.st = 'world'; S.fx('timecard', { text: 'FOUR FUSES MISSING', dur: 2.6 }); S.fx('thought', { text: '(Pulled out by hand. Somebody really didn\'t want this panel live.)', dur: 4 }); } else changed = false; break;
      case 'fuse': {
        const f = this.fuse(d.n);
        if (!f || (f.st !== 'world' && f.st !== 'dropped') || s.fuses.some(x => x.st === 'carried' && x.by === slot)) { changed = false; break; }
        f.st = 'carried'; f.by = slot;
        if (f.tag < 0) { f.tag = Math.min(3, s.picked); s.picked++; S.fx('fusetag', { i: f.tag }, slot); }
        S.fx('sound', { id: 'pickup', o: { bus: 'player', volume: 0.8 } }, slot);
        S.fx('toast', { text: `${p.name} FOUND FUSE #${f.n}` });
        this.onFusePicked(f);
        break;
      }
      case 'insert': {
        const f = s.fuses.find(x => x.st === 'carried' && x.by === slot);
        if (!f) { changed = false; break; }
        f.st = 'inserted'; f.by = -1; s.inserted++;
        S.fx('sound', { id: 'fuse_insert', pos: [P.panel.x, P.panel.y + 1.3, P.panel.z], o: { bus: 'environment', volume: 0.9 } });
        S.fx('toast', { text: `FUSE #${f.n} INSERTED  -  FUSES ${s.inserted}/4` });
        if (s.inserted === 2) S.saveCheckpoint('fuses2');
        break;
      }
      case 'cctv': if (s.power === 'main' && !s.cctv) { s.cctv = true; s.secVisited = true; this.cctvFirstLogin(); } else changed = false; break;
      case 'cctvcam': this.cctvViewers = this.cctvViewers || new Map(); if (d.i < 0) this.cctvViewers.delete(slot); else this.cctvViewers.set(slot, d.i); changed = false; break;
      case 'b11cam': if (s.fileRead && !s.b11Seen) { s.b11Seen = true; } else changed = false; break;
      case 'safelock': {
        const door = g.world.doorById[P.safeDoor];
        const out = S.standing().filter(q => !AREA.safe(q.pos));
        if (out.length) { S.fx('thought', { text: `(Not everyone is inside. ${out.map(q => q.name).join(', ')}...)`, dur: 3 }, slot); changed = false; break; }
        door.close(2); door.locked = 'mp_safe'; s.safeLocked = true;
        S.fx('sound', { id: 'entrance_unlock', pos: door.center.toArray(), o: { bus: 'environment', volume: 1 } });
        break;
      }
      case 'purge': if (id === 'purge') { s.purge = true; s.purgedBy = slot; } else changed = false; break;
      case 'endanswer': if (this.endPhase === 'ringing' && slot === s.missing) this.endCall(); changed = false; break;
      default: changed = false;
    }
    if (changed) this.push();
  }

  // ================================================================ host: per frame
  start() {
    const s = this.state;
    s.n = this.S.roster.length;
    this.push();
  }

  update(dt) {
    this.t += dt;
    if (this.readingOpen && this.reader) {            // reader pages / closes with E
      if (this.g.input.wasPressed('KeyE') && this._rf > 0 && !this.g.mpPaused) {
        this.g.input.pressed.delete('KeyE');
        if (this.reader.page < this.reader.D.pages.length - 1) { this.reader.page++; this.showPage(); audio.play('pickup', { bus: 'player', volume: 0.2, rate: 1.6 }); }
        else this.closeReader();
      }
      this._rf++;
    }
    this.runTimers(this.ctimers);
    this.updateArrival(dt);
    this.updateCCTV(dt);
    this.updateChair(dt);
    this.animateProps(dt);
    this.dressing.update(dt, this.t);
    this.shutter?.update(dt, this.host ? null : this.netShutter);
    this.klaxon.update(dt);
    if (!this.host) return;
    const s = this.state, S = this.S;
    this.runTimers(this.timers);
    // the story clock: walks toward the time this step of the night belongs to (never real time alone)
    const st = this.steps[s.step];
    const target = typeof st?.t === 'function' ? st.t() : st?.t ?? 360;
    if (s.clock < target) s.clock = Math.min(target, s.clock + Math.max(dt / 2.2, (target - s.clock) * dt / 30));   // a quick crew: the night catches up
    // the phone rings once someone has sat at the desk for a moment (they are waiting for the call)
    if (this.stepId === 'wait' && s.seated >= 0) {
      s.satT += dt;
      const sitter = S.players.get(s.seated);
      if (!sitter || !sitter.seated && s.satT > 1) { s.seated = -1; s.satT = 0; this.stepBack('sit'); }
      else if (s.satT > 3.5 && !s.ringing) { s.ringing = true; this.ring(true); this.push(); }
    }
    // co-op holds
    this.updateHolds(dt);
    // the shutter (host simulation)
    if (this.shutter) {
      const crank = (S.holding('mp_crank_0').size ? 1 : 0) || (S.holding('mp_crank_1').size ? 1 : 0);
      const solo = S.alivePlayers().length <= 1;
      // only the purge releases the curtain; before that (and once everyone is through) its motor holds it rolled up
      if (s.shutterDown) this.shutter.simulate(dt, { crank, drop: this.shutterDropping, latch: solo && this.shutter.amount > 0.05 });
      else this.shutter.amount = Math.min(1, this.shutter.amount + dt * 0.25);
      if (this.shutterDropping && this.shutter.amount <= 0) this.shutterDropping = false;
      S.holdProgress.mp_crank_0 = S.holding('mp_crank_0').size ? this.shutter.amount : undefined;
      S.holdProgress.mp_crank_1 = S.holding('mp_crank_1').size ? this.shutter.amount : undefined;
      // everyone made it east (or upstairs): the shutter no longer matters
      if (s.shutterDown && !S.standing().some(p => AREA.westOfShutter(p.pos))) { s.shutterDown = false; this.push(); }
    }
    // advance steps while their condition holds
    let guard = 0;
    while (guard++ < 4) {
      const cur = this.steps[s.step];
      if (!cur || !cur.done(s)) break;
      cur.exit?.();
      if (cur.cp) S.saveCheckpoint(cur.cp);
      s.step++;
      this.steps[s.step]?.enter?.();
      this.push();
      this.onStep(this.steps[s.step]?.id);
    }
    // the fuse carrier went down: the fuse drops where they fell
    for (const f of s.fuses) {
      if (f.st !== 'carried') continue;
      const c = S.players.get(f.by);
      if (!c || c.life !== 'alive') { f.st = 'dropped'; f.by = -1; f.pos = [c ? c.pos.x : P.panel.x, (c ? c.pos.y : P.panel.y) + 0.05, c ? c.pos.z : P.panel.z]; f.where = c ? c.name : 'THE PANEL'; this.push(); }
    }
    this.soloPrimer = Math.max(0, (this.soloPrimer || 0) - dt);
    // the purge: the building turns on them - doors slam around the crew while they run
    if (s.chase === 'final' && !s.ending) {
      this.slamT = (this.slamT ?? 4) - dt;
      if (this.slamT <= 0) {
        this.slamT = 5 + Math.random() * 6;
        const p = S.alivePlayers()[Math.floor(Math.random() * S.alivePlayers().length)];
        const doors = p ? this.g.world.doors.filter(d => !d.locked && d.target > 0.3 && Math.abs(d.center.y - 1.1 - p.pos.y) < 1.5 && d.center.distanceTo(p.pos) > 2.5 && d.center.distanceTo(p.pos) < 12) : [];
        if (doors.length) S.fx('doorslam', { id: doors[Math.floor(Math.random() * doors.length)].id });
        S.fx('flicker', { t: 0.5, a: 0.8, lights: 0.8 });
      }
    }
  }

  stepBack(id) { const i = this.steps.findIndex(x => x.id === id); if (i >= 0) { this.state.step = i; this.push(); } }

  // simultaneous holds (with a single-player fallback so a solo host can still finish)
  updateHolds(dt) {
    const S = this.S, s = this.state, id = this.stepId;
    const held = (k, min = 0) => [...S.holding(k).values()].some(t => t > min);
    const prog = S.holdProgress;
    const solo = S.alivePlayers().length <= 1;
    // generator primer: solo hosts get a latch (primer stays primed briefly after letting go)
    if (id === 'gen' && held('mp_primer', 0.5)) this.soloPrimer = solo ? 8 : 0.4;
    prog.mp_primer = held('mp_primer') ? 1 : 0;
    // lockdown: release + override at the same time
    if (s.lockdown) {
      const rel = held('mp_release_0', 0) || held('mp_release_1', 0), ovr = held('mp_override_0', 0) || held('mp_override_1', 0);
      if (rel) this.latchRel = solo ? 10 : 0.2; if (ovr) this.latchOvr = solo ? 10 : 0.2;
      this.latchRel = Math.max(0, (this.latchRel || 0) - dt); this.latchOvr = Math.max(0, (this.latchOvr || 0) - dt);
      this.lockT = (this.latchRel > 0 && this.latchOvr > 0) ? (this.lockT || 0) + dt : 0;
      for (const k of ['mp_release_0', 'mp_release_1', 'mp_override_0', 'mp_override_1']) prog[k] = held(k) ? Math.min(1, (this.lockT || 0) / 1.2) || 0.05 : undefined;
      if (this.lockT > 1.2) { s.lockdown = false; s.lockdownDone = true; s.gateLocked = false; this.lockT = 0; S.fx('sound', { id: 'metal_scrape', pos: [20.75, 1, P.gate.z], o: { bus: 'environment', volume: 1 } }); S.fx('toast', { text: 'BASEMENT GATE OPEN' }); this.push(); }
    }
    // main breakers
    if (id === 'main') {
      const a = held('mp_breakerA'), b = held('mp_breakerB');
      if (a) this.latchA = solo ? 10 : 0.2; if (b) this.latchB = solo ? 10 : 0.2;
      this.latchA = Math.max(0, (this.latchA || 0) - dt); this.latchB = Math.max(0, (this.latchB || 0) - dt);
      this.mainT = (this.latchA > 0 && this.latchB > 0) ? (this.mainT || 0) + dt : 0;
      prog.mp_breakerA = a ? Math.max(0.05, this.mainT / 1.5) : undefined; prog.mp_breakerB = b ? Math.max(0.05, this.mainT / 1.5) : undefined;
      if (this.mainT > 1.5) { s.power = 'main'; this.mainPower(); this.push(); }
    }
    // containment switches: hold 6 s (switch 2 = both keys together for 2 s); the beacons spin while held
    if (id === 'switches') {
      for (const i of [0, 2]) {
        if (s.switches[i]) continue;
        const h = Math.max(0, ...S.holding('mp_sw_' + i).values());
        prog['mp_sw_' + i] = h > 0 ? h / 6 : undefined;
        if (h > 0 && Math.random() < dt * 0.6) this.S.hunter?.hearNoise(P.sw[i].pos, 22);   // the switch is loud
        if (h >= 6) this.switchOn(i);
      }
      if (!s.switches[1]) {
        const a = held('mp_sw_1'), b = held('mp_sw_1b');
        if (a) this.latchK1 = solo ? 10 : 0.2; if (b) this.latchK2 = solo ? 10 : 0.2;
        this.latchK1 = Math.max(0, (this.latchK1 || 0) - dt); this.latchK2 = Math.max(0, (this.latchK2 || 0) - dt);
        this.keyT = (this.latchK1 > 0 && this.latchK2 > 0) ? (this.keyT || 0) + dt : 0;
        prog.mp_sw_1 = a ? Math.max(0.05, this.keyT / 2) : undefined; prog.mp_sw_1b = b ? Math.max(0.05, this.keyT / 2) : undefined;
        if (this.keyT >= 2) this.switchOn(1);
      }
      const spin = [held('mp_sw_0'), held('mp_sw_1') || held('mp_sw_1b'), held('mp_sw_2')];
      const key = spin.map(Number).join('');
      if (key !== this._spinKey) { this._spinKey = key; S.fx('beacons', { spin }); }
    }
    // main entrance: release + code together
    if (id === 'exit') {
      const a = held('mp_exitRelease'), b = held('mp_code');
      if (a) this.latchE = solo ? 12 : 0.2; if (b) this.latchC = solo ? 12 : 0.2;
      this.latchE = Math.max(0, (this.latchE || 0) - dt); this.latchC = Math.max(0, (this.latchC || 0) - dt);
      this.exitT = (this.latchE > 0 && this.latchC > 0) ? (this.exitT || 0) + dt : 0;
      prog.mp_exitRelease = a ? Math.max(0.05, this.exitT / 2.5) : undefined; prog.mp_code = b ? Math.max(0.05, this.exitT / 2.5) : undefined;
      if (this.exitT > 2.5) { s.exitOpen = true; s.entranceLocked = false; s.entranceOpen = true; this.S.fx('sound', { id: 'entrance_open', pos: [this.g.layout.bounds.x0, 1.2, 0], o: { bus: 'environment', volume: 1 } }); this.S.fx('thought', { text: '(Daylight. Go - GO!)', dur: 2.5 }); this.push(); }
    }
  }

  // ================================================================ host: the beats
  // SCENE 1: the doors lock behind the crew
  closeEntrance() {
    const s = this.state, S = this.S;
    s.entranceOpen = false; s.entranceLocked = true;
    S.fx('sound', { id: 'entrance_slam', o: { bus: 'environment', volume: 1, reverb: 0.6 } });
    S.fx('shake', { a: 0.3, t: 0.3 });
    S.fx('thought', { text: '(The doors... they locked behind us.)', dur: 3.5 });
  }
  ring(on) { this.S.fx('ring', { on }); }
  // SCENE 2: the caretaker. Breaths of real silence between his lines; he stops himself; the line dies.
  phoneCall() {
    const S = this.S, ph = P.phone.toArray();
    this.ring(false);
    S.fx('sound', { id: 'phone_pickup', pos: ph, o: { bus: 'sfx', volume: 0.7 } });
    S.fx('sound', { id: 'phone_static', pos: ph, o: { bus: 'voice', volume: 0.12, refDistance: 1.5 } });
    const seq = [[1.1, 'mp_call_1'], [4.7, 'mp_call_2'], [8.4, 'mp_call_3'], [14.4, 'mp_call_4'], [17.9, 'mp_call_5'], [22.4, 'mp_call_6']];
    for (const [t, id] of seq) this.after(t, () => S.fx('line', { id, pos: ph }));
    // the line drops mid-word: a burst of interference, then the dead tone
    this.after(24.6, () => { S.fx('sound', { id: 'phone_static', pos: ph, o: { bus: 'voice', volume: 0.55, refDistance: 2 } }); S.fx('sound', { id: 'phone_busy', pos: ph, o: { bus: 'sfx', volume: 0.35, refDistance: 1.5 } }); });
    this.after(27.6, () => { S.fx('sound', { id: 'phone_hangup', pos: ph, o: { bus: 'sfx', volume: 0.7 } }); this.state.callDone = true; this.push(); });
    // ...and then nothing. A long breath of the building, before anyone moves.
    this.after(31.5, () => S.fx('sound', { id: 'amb_creak', pos: [-13, 3.4, 2], o: { bus: 'environment', volume: 0.5, occlude: true, reverb: 0.6 } }));
    this.after(34, () => S.fx('thought', { text: '(Don\'t open the... what?)', dur: 3.5 }, this.state.answeredBy));
  }
  // SCENE 4: before the generator: the basement is not empty - nothing you can point a light at
  basementBeats() {
    const S = this.S, pick = () => { const pl = S.alivePlayers().filter(p => p.pos.y < -2.5); return pl[Math.floor(Math.random() * pl.length)]; };
    this.after(3, () => S.fx('sound', { id: 'amb_metal', pos: [-8, -3, -4], o: { bus: 'environment', volume: 0.75, occlude: true, reverb: 0.7, refDistance: 3 } }));
    this.after(10, () => { const p = pick(); if (!p) return; const z = p.pos.z > 0 ? 1.65 : -1.65; S.fx('sound', { id: 'koala_scratch', pos: [p.pos.x + 1.2, p.pos.y + 1.1, z], o: { bus: 'environment', volume: 0.32, occlude: true, lowpass: 1600 } }); });
    this.after(18, () => { const p = pick(); if (!p) return; for (let i = 0; i < 7; i++) this.after(i * 0.52, () => S.fx('sound', { id: 'step_tile', pos: [p.pos.x - 4 + i * 0.75, -0.2, p.pos.z + 0.4], o: { bus: 'environment', volume: 0.45, index: i % 10, occlude: true, lowpass: 900 } })); });
    this.after(26, () => { for (let i = 0; i < 4; i++) this.after(i * 0.4, () => S.fx('sound', { id: 'amb_pipe', pos: [-17 + i * 2.5, -1.4, -2.4], o: { bus: 'environment', volume: 0.5, index: i % 3, occlude: true } })); });
    this.after(33, () => this.S.director?.crosser(3));
    this.after(48, () => S.fx('sound', { id: 'koala_breath', pos: [-8.5, -3, -5.5], o: { bus: 'environment', volume: 0.22, occlude: true, lowpass: 1200 } }));
  }
  generatorOn() {
    const S = this.S;
    S.fx('sound', { id: 'power_up', pos: P.gen.toArray(), o: { bus: 'environment', volume: 1 } });
    S.fx('genloop', {});
    S.fx('toast', { text: 'GENERATOR RUNNING  -  EMERGENCY POWER' });
    S.fx('shake', { a: 0.2, t: 0.6 });
    this.S.director?.setIntensity(1);
  }
  // SCENE 5: the fuses - the third one wakes the building up
  onFusePicked(f) {
    const s = this.state, S = this.S;
    const picked = s.fuses.filter(x => x.st !== 'world' && x.st !== 'hidden').length;
    if (picked === 2) { S.hunter?.stalk({ short: true }); S.director?.setIntensity(2); }
    if (picked === 3 && !s.lockdownDone) {
      s.lockdown = true; s.gateLocked = true;
      S.fx('flicker', { t: 1.2, a: 1, lights: 1.4 });
      S.fx('sound', { id: 'power_down', o: { bus: 'environment', volume: 0.5 } });
      this.after(0.9, () => { S.fx('sound', { id: 'pa_click', o: { bus: 'environment', volume: 0.6 } }); S.fx('line', { id: 'mp_pa_lockdown' }); });
      this.after(1.4, () => S.fx('sound', { id: 'door_slam', pos: [20.75, 1, P.gate.z], o: { bus: 'environment', volume: 1, reverb: 0.6 } }));
      // every open door near each of them shuts, one after another, as if the building knew where they stood
      let k = 0;
      for (const p of S.alivePlayers()) {
        const doors = this.g.world.doors.filter(d => !d.locked && d.target > 0.3 && Math.abs(d.center.y - 1.1 - p.pos.y) < 1.5 && d.center.distanceTo(p.pos) < 14).sort((a, b) => a.center.distanceTo(p.pos) - b.center.distanceTo(p.pos)).slice(0, 2);
        for (const d of doors) this.after(2 + (k++) * 0.55, () => S.fx('doorslam', { id: d.id }));
      }
      this.after(5.5, () => S.fx('thought', { text: '(It locked us in. Something knows we\'re here.)', dur: 4 }));
    }
  }
  // SCENE 6: main power. The building wakes floor by floor... and so does something else.
  mainPower() {
    const S = this.S;
    S.fx('scene', { id: 'mainPower' });
    this.after(9.2, () => S.director?.setIntensity(2));
  }
  // SCENE 7: the first login - the cameras show the crew to themselves, and one thing that should not be there
  cctvFirstLogin() {
    // someone standing at the foot of the stairwell - on CAM 3 only, gone before anyone gets there
    this.after(9, () => this.S.director?.apparition(V(18.3, 0, -2.4), PI * 0.85, 10));
    this.after(16, () => this.S.director?.make('cctv'));
  }
  // SCENE 8: the B11 camera. It is standing in the chamber. It looks up at the lens.
  b11Reveal() {
    const s = this.state, S = this.S, k = this.g.koala;
    S.hunter?.reset();
    if (k) { k.show(P.chamber.clone(), 0, 'idle'); k.faceTowards(V(-4.6, -4, -2.0)); }
    S.fx('sound', { id: 'koala_breath', pos: [P.chamber.x, -3, P.chamber.z], o: { bus: 'monster', volume: 0.6 } });
    S.fx('chamberRed', { t: 5 });
    this.after(2.6, () => { if (k?.visible) { k.play('snarl', { fade: 0.3 }); S.fx('kvocal', { id: 'koala_growl', v: 0.5 }); } });
    this.after(4.2, () => { s.b11Lost = true; this.push(); S.fx('camcut', {}); });
    this.after(4.6, () => this.breach());
  }
  breach() {
    const S = this.S;
    this.state.chase = 'breach-wait'; this.push();
    S.fx('sound', { id: 'pa_click', o: { bus: 'environment', volume: 0.7 } });
    S.fx('line', { id: 'mp_pa_breach' });
    // then silence. Then something, far below.
    this.after(8.4, () => S.fx('sound', { id: 'emerge_roar', pos: [P.chamber.x, -3, P.chamber.z], o: { bus: 'monster', volume: 1, occlude: true, reverb: 0.8, refDistance: 8, rolloff: 0.6 } }));
    this.after(9.6, () => { S.fx('alarm', { on: true }); S.fx('lights', { power: 'breach' }); S.fx('scare', { a: 0.7, p: 0.6 }); });
    this.after(11, () => S.fx('thought', { text: '(We did this. We turned the power on... we let it out.)', dur: 4.5 }));
    this.after(11.5, () => { this.startHunt('breach'); S.director?.setIntensity(3); });
  }
  startHunt(kind) {
    this.state.chase = kind;
    this.S.hunter?.hunt({ persistent: true, kind, until: () => (kind === 'breach' ? this.state.safeLocked : kind === 'switches' ? this.state.switches.every(Boolean) : this.state.ending) });
    this.push();
  }
  endChase() {
    this.state.chase = null;
    this.S.hunter?.release();
    this.S.fx('alarm', { on: false });
    this.S.fx('lights', { power: 'main' });
    this.push();
  }
  // SCENE 9: the safe room. Silence... and then it is at the door.
  besiege() {
    const s = this.state, S = this.S;
    s.chase = null; s.besiege = 'coming'; this.push();
    S.fx('alarm', { on: false });
    const door = this.g.world.doorById[P.safeDoor];
    const sounds = () => {
      const dp = door.center.toArray(), out = P.safeOut.toArray();
      S.fx('sound', { id: 'koala_sniff', pos: out, o: { bus: 'monster', volume: 0.8, occlude: true } });
      this.after(1.6, () => S.fx('sound', { id: 'koala_scratch', pos: dp, o: { bus: 'monster', volume: 0.9, occlude: true } }));
      this.after(2.4, () => S.fx('rattle', { id: P.safeDoor }));
      this.after(3.6, () => S.fx('sound', { id: 'koala_breath', pos: out, o: { bus: 'monster', volume: 0.75, occlude: true } }));
      this.after(5.0, () => S.fx('rattle', { id: P.safeDoor, hard: true }));
      this.after(5.3, () => S.fx('sound', { id: 'door_bang', pos: dp, o: { bus: 'environment', volume: 0.9, index: 1 } }));
      this.after(6.8, () => S.fx('sound', { id: 'koala_growl', pos: out, o: { bus: 'monster', volume: 0.5, occlude: true } }));
    };
    const finish = () => { if (s.besiege === 'done') return; s.besiege = 'done'; this.push(); S.fx('thought', { text: '(It\'s gone... for now. The file - the containment switches. We have to lock it back in.)', dur: 5 }); };
    if (S.hunter && this.g.koala?.visible) {
      S.hunter.besiege(P.safeOut, door.center, () => sounds(), () => this.after(4, finish));
    } else {
      this.after(4, sounds); this.after(17, finish);
    }
    // a hard stop so the scene can never hang
    this.after(45, finish);
  }
  // SCENE 10: each switch changes the building
  switchOn(i) {
    const s = this.state, S = this.S;
    s.switches[i] = 1;
    const k = s.switches.filter(Boolean).length;
    S.fx('sound', { id: 'lever', pos: P.sw[i].pos.toArray(), o: { bus: 'environment', volume: 1 } });
    S.fx('sound', { id: 'power_up', pos: P.sw[i].pos.toArray(), o: { bus: 'environment', volume: 0.5, rate: 0.6 } });
    S.fx('toast', { text: `CONTAINMENT SWITCH ${k}/3` });
    S.fx('beaconDone', { i });
    S.fx('scene', { id: 'switch' + k });
    if (k === 3) { this.after(6, () => S.fx('thought', { text: '(Something in B11 just unlocked. The purge.)', dur: 4 })); }
    this.push();
  }
  // SCENE 12: the purge - the whole building turns on them
  finalChase() {
    const S = this.S, s = this.state;
    S.fx('scene', { id: 'purge' });
    S.director?.setIntensity(4);
    S.director?.clearKind('b11');
    s.shutterDown = true; this.shutterDropping = true;
    this.push();
    this.after(2.5, () => this.startHunt('final'));
  }
  // SCENE 13: out. For a moment, it is over.
  escape() {
    const s = this.state, S = this.S;
    s.chase = null; S.hunter?.release(); S.hunter?.reset(); S.director?.setIntensity(0); S.director?.reset();
    s.ending = true; s.clock = 360;
    // the hospital keeps one: the one who answered its phone. (Absent? the one who pulled the purge.)
    const cand = S.standing();
    const pick = [s.answeredBy, s.purgedBy].find(x => x >= 0 && cand.some(p => p.slot === x));
    s.missing = cand.length > 1 ? (pick ?? cand[Math.floor(Math.random() * cand.length)].slot) : -1;
    s.done = true; S.ended = true;
    this.push();
    S.fx('scene', { id: 'escape' });
    this.endPhase = 'calm';
    this.after(15, () => { S.fx('taken', { missing: s.missing }); this.endPhase = 'taken'; });
    this.after(21, () => { this.endPhase = 'ringing'; S.fx('endring', {}); });
    this.after(33, () => this.endCall());                    // nobody answered: it answers itself
  }
  endCall() {
    if (this.endPhase === 'call' || this.endPhase === 'over') return;
    this.endPhase = 'call';
    this.S.fx('endcall', { missing: this.state.missing });
    this.after(9.5, () => { this.endPhase = 'over'; this.S.fx('endtitle', {}); });
  }
  onStep(id) {
    const S = this.S;
    if (id === 'flash') S.fx('thought', { text: '(Flashlights on the counter. One each.)', dur: 3 });
    if (id === 'locate') S.director?.setIntensity(1);
    if (id === 'return') { S.director?.setIntensity(2); S.director?.b11Ghosts(); S.fx('scene', { id: 'b11' }); }
    if (id === 'purge') { S.fx('flicker', { t: 1.2, a: 1, lights: 1 }); S.fx('scare', { a: 0.7 }); }
  }
  onDowned(slot) { if (this.state.seated === slot) this.state.seated = -1; }
  onLeave(slot) { const s = this.state; for (const f of s.fuses) if (f.st === 'carried' && f.by === slot) { f.st = 'dropped'; f.by = -1; f.where = 'THE STAIRWELL'; } this.push(); }

  restore(st) {
    this.state = JSON.parse(JSON.stringify(st));
    this.state.chase = null;
    this.timers = [];
    this.cordPulls = 0; this.mainT = 0; this.keyT = 0; this.exitT = 0; this.lockT = 0;
    this.push();
    // resume the persistent hunt this checkpoint belongs to
    const id = this.stepId;
    if (id === 'safe') this.startHunt('breach');
    if (id === 'switches') this.startHunt('switches');
    if (['lobby', 'exit', 'out'].includes(id)) this.startHunt('final');
    if (id === 'quiet') { this.state.besiege = 'done'; this.push(); }
  }
  // a new host takes over mid-night: continue every persistent thing from the shared state
  resumeAsHost() {
    const s = this.state, id = this.stepId;
    this.timers = [];
    if (s.chase === 'breach' || s.chase === 'breach-wait') this.startHunt('breach');
    else if (s.chase === 'switches') this.startHunt('switches');
    else if (s.chase === 'final') this.startHunt('final');
    if (id === 'quiet' && s.besiege !== 'done') this.after(3, () => { s.besiege = 'done'; this.push(); });
    if (s.ending && this.endPhase !== 'over') this.after(2, () => this.endCall());
    if (s.ringing && !s.answered) this.ring(true);
    if (s.answered && !s.callDone) this.after(1, () => { s.callDone = true; this.push(); });
    if (s.shutterDown && this.shutter) this.shutter.amount = Math.min(this.shutter.amount, 0.6);
    this.push();
  }

  push() { if (this.host) { this.S.net.broadcast({ t: 'state', s: this.state }); this.applyState(); } }

  spawnFor(slot, name) {
    const sp = SPAWNS[name] || SPAWNS.start;
    const off = [[0, 0], [1.1, 0], [0, 1.1], [1.1, 1.1]][slot % 4];
    return { x: sp[0] + off[0], y: sp[1], z: sp[2] + off[1], yaw: sp[3] };
  }

  // ================================================================ every client: show the state
  applyState() {
    const s = this.state, g = this.g, w = g.world, o = this.objects;
    if (!o.phone) return;
    // entrance
    if (s.entranceOpen && w.entrance.target < 0.5) w.entrance.open(0.9);
    if (!s.entranceOpen && w.entrance.target > 0.5) w.entrance.close(1.4);
    w.entrance.locked = s.entranceLocked;
    // reception
    const taken = s.flashIdx || [];
    o.flashes.forEach((f, i) => { f.visible = !taken.includes(i) && i < Math.max(s.n, 1) + 0; });
    o.card.visible = !s.keycard;
    o.log.visible = true;
    o.bkey.visible = !s.bkey;
    // locks
    const lock = (id, on) => { const d = w.doorById[id]; if (d) { if (on) { d.locked = d.locked || 'mp'; if (d.target > 0) d.close(2, false); } else if (d.locked) d.locked = null; } };
    lock('door_103', s.door103);
    lock('door_B10', s.b10);
    lock(P.safeDoor, s.safeLocked && s.besiege !== 'done');
    // fuses
    for (const f of s.fuses) {
      const m = this.fuseObjs?.get(f.n); if (!m) continue;
      m.visible = f.st === 'world' || f.st === 'dropped' || f.st === 'hidden';
      if (f.st === 'dropped') m.position.set(...f.pos);
    }
    o.slots.forEach((m, i) => { m.visible = i < s.inserted; });
    // switches' lamps
    o.switches.forEach((sw, i) => { sw.lamp.traverse(c => { if (c.isMesh) { c.material = c.material.clone(); c.material.emissive = new THREE.Color(s.switches[i] ? 0x30ff40 : 0x601010); c.material.emissiveIntensity = 1.4; } }); sw.handle.rotation.x = s.switches[i] ? -0.9 : 0; });
    (this.beacons || []).forEach((b, i) => { if (s.switches[i]) b.mode = 'done'; });
    if (s.power === 'main' && !this._mainApplied) { this._mainApplied = true; if (!this._mainScene) this.runLights('main'); for (const m of o.rackScreens) { m.emissive = new THREE.Color(0x6fa37a); m.emissiveIntensity = 0.5; } }
    if (s.gen && !this._genApplied) { this._genApplied = true; g.world.lights.setEmergency(true); }
    if (s.ending && !this._endingStarted) { /* the ending fx drives the sequence */ }
    this.g.ui.setClock(this.clockText(), !s.ending);
    // shared batteries and furniture
    this.S.applyWorldSync?.(s);
  }

  animateProps(dt) {
    const s = this.state, o = this.objects;
    if (!o.drawer) return;
    this.drawerAmt += ((s.drawerOpen ? 1 : 0) - this.drawerAmt) * Math.min(1, dt * 6);
    o.drawer.position.z = P.drawer.z - 0.32 * this.drawerAmt;
    const gateTarget = s.gateLocked ? 0 : 1;
    this.gateAmt += (gateTarget - this.gateAmt) * Math.min(1, dt * (gateTarget ? 0.9 : 4));
    o.gate.position.x = this.gateAmt * 2.55;
    const hot = s.chase || this.stepId === 'purge' || this.stepId === 'return' || s.switches[2];
    this.chamberLight.intensity = hot ? 1.4 + Math.sin(this.t * 3) * 0.6 : this.chamberPulse > 0 ? 2.5 : 0;
    this.chamberPulse = Math.max(0, (this.chamberPulse || 0) - dt);
    // the handset lifts when answered (and, at the end, by itself)
    o.handset.position.y = (s.answered && !s.callDone) || this.handsetUp ? 0.35 : 0.09;
    // cranks turn with the shutter
    if (this.shutter && o.cranks) { const a = this.shutter.amount * 40; o.cranks.forEach(w => { w.rotation.z = a; }); }
  }

  runLights(kind) {
    const L = this.g.world.lights;
    if (kind === 'main') { L.setEmergency(false); L.setPower('all', true); }
    if (kind === 'breach') { L.setPower('all', false); L.setEmergency(true); }
  }

  // ================================================================ story-specific fx (presentation on every client)
  fx(k, d) {
    const g = this.g, S = this.S;
    if (k === 'giveFlash') { g.flashlight.give(); g.flashlight.toggle(true); g.ui.thought('(Flashlight: [F] on/off, [R] new battery.)', 3); g.flashlight.addSpare(1); }
    if (k === 'ring') {
      if (d.on && !this.ringH) this.ringH = audio.playAt('phone_ring', P.phone, { bus: 'environment', loop: true, volume: 0.95, refDistance: 3 });
      if (!d.on && this.ringH) { this.ringH.stop(0.1); this.ringH = null; }
    }
    if (k === 'genloop' && !this.genH) this.genH = audio.playAt('hum_electric', P.gen.clone().setY(-3), { bus: 'environment', loop: true, volume: 0.9, refDistance: 3, rate: 0.6 });
    if (k === 'lights') this.runLights(d.power);
    if (k === 'alarm') this.klaxon.set(d.on);
    if (k === 'fusetag') { this.readDoc('fusetag', d.i); }
    if (k === 'doorslam') { const door = g.world.doorById[d.id]; if (door) door.slam(); }
    if (k === 'rattle') this.rattle(d.id, d.hard);
    if (k === 'beacons') (this.beacons || []).forEach((b, i) => { if (b.mode !== 'done') b.mode = d.spin[i] ? 'spin' : 'off'; });
    if (k === 'beaconDone') { const b = this.beacons?.[d.i]; if (b) b.mode = 'done'; }
    if (k === 'chamberRed') this.chamberPulse = d.t;
    if (k === 'camcut') { if (this.inCCTV && this.cctvIdx === 4) { this.camStatic(1.2); audio.play('phone_static', { bus: 'ui', volume: 0.35 }); } }
    if (k === 'scene') this.scene(d.id, d);
    if (k === 'taken') this.taken0(d.missing);
    if (k === 'endring') this.endRing();
    if (k === 'endcall') this.endCallLocal(d.missing);
    if (k === 'endtitle') this.endTitle();
  }

  // a locked door shaken from the other side
  rattle(id, hard) {
    const door = this.g.world.doorById[id]; if (!door) return;
    const kick = hard ? 0.05 : 0.025;
    for (let i = 0; i < (hard ? 4 : 3); i++) this.later(i * 0.17, () => { door.amount = kick * (i % 2 ? 0.5 : 1); door.target = 0; door.speed = 0.6; audio.playAt('door_latch', door.center, { bus: 'environment', volume: hard ? 0.9 : 0.6, rate: 0.8 + Math.random() * 0.2, occlude: true, index: i }); });
  }

  // client-side scripted presentation (identical on every machine)
  scene(id) {
    const g = this.g, L = g.world.lights, me = this.S.me;
    const at = (t, fn) => this.later(t, fn);
    if (id === 'mainPower') {
      // breakers bite; the building wakes floor by floor from the basement up
      this._mainScene = true;
      audio.play('lever', { bus: 'environment', volume: 0.9 });
      audio.play('power_up', { bus: 'environment', volume: 1 });
      g.player.shake(0.3, 0.6);
      L.setEmergency(false);
      ['B', '1', '2', '3', '4'].forEach((lv, i) => at(0.6 + i * 0.6, () => { L.setPower(lv, true); L.surgeFlicker(0.4); if (g.player.level === lv) audio.play('light_buzz', { bus: 'environment', volume: 0.35 }); }));
      // the old monitors upstairs boot
      at(1.1, () => { for (const m of this.objects.rackScreens) { m.emissive = new THREE.Color(0x6fa37a); m.emissiveIntensity = 0.5; } audio.playAt('monitor_beep', P.cctvRack.clone().setY(13.2), { bus: 'environment', volume: 0.8, occlude: true }); });
      // containment systems wake briefly: red in B11, the beacons turn once - and die
      at(3.6, () => { this.chamberPulse = 1.4; (this.beacons || []).forEach(b => { if (b.mode === 'off') { b.mode = 'spin'; this.later(1.6, () => { if (b.mode === 'spin' && !this.state.switches[this.beacons.indexOf(b)]) b.mode = 'off'; }); } }); audio.playAt('hum_electric', V(-8, -2.5, -6), { bus: 'environment', volume: 0.9, rate: 1.4, occlude: true }); });
      // far below: heavy mechanical locks letting go, one after another
      for (let i = 0; i < 3; i++) at(4.6 + i * 0.55, () => { audio.playAt('entrance_unlock', V(-8, -3, -5.8), { bus: 'environment', volume: 1, rate: 0.7, occlude: true, reverb: 0.7, refDistance: 5 }); audio.playAt('metal_scrape', V(-8.5, -3, -6.4), { bus: 'environment', volume: 0.6, rate: 0.8, occlude: true, refDistance: 4 }); });
      at(6.3, () => { audio.playAt('impact_low', V(-8, -3, -6), { bus: 'environment', volume: 1, occlude: true, reverb: 0.8, refDistance: 8 }); g.player.shake(0.2, 0.4); });
      at(6.9, () => this.klaxon.burst(1.6));
      at(8.8, () => audio.play('pa_click', { bus: 'environment', volume: 0.6 }));
      at(9.1, () => this.S.runFx('line', { id: 'mp_pa_power_a' }));
      at(11.9, () => { audio.play('pa_static', { bus: 'environment', volume: 0.25 }); this.S.runFx('line', { id: 'mp_pa_power_b' }); });
      at(15.6, () => g.ui.thought('(Containment systems...? What did we just turn back on?)', 4.5));
    }
    if (id === 'switch1') {
      audio.play('pa_click', { bus: 'environment', volume: 0.6 });
      at(0.4, () => this.S.runFx('line', { id: 'mp_pa_field' }));
      at(0.8, () => { if (!this.fieldH) this.fieldH = audio.playAt('hum_electric', V(-8, -2.5, -6.5), { bus: 'environment', loop: true, volume: 0.7, rate: 0.45, occlude: true, refDistance: 3 }); });
      at(4.5, () => g.ui.thought('(We\'re not fixing this place anymore. We\'re trying to lock it back in.)', 4.5));
    }
    if (id === 'switch2') {
      L.surgeFlicker(2.8); g.flashlight.flicker(1.2, 0.8);
      audio.play('power_down', { bus: 'environment', volume: 0.6 });
      this.klaxon.burst(1.2);
      at(0.9, () => { audio.play('pa_static', { bus: 'environment', volume: 0.35 }); this.S.runFx('line', { id: 'mp_pa_unstable' }); });
      at(2.5, () => audio.playAt('koala_screech', g.player.pos.clone().add(V(0, 0, 0)).setY(g.player.pos.y + (g.player.level === 'B' ? 6 : -6)), { bus: 'monster', volume: 0.5, occlude: true, lowpass: 900 }));
    }
    if (id === 'switch3') {
      audio.playAt('impact_low', V(-8, -3, -6), { bus: 'environment', volume: 1, bigReverb: 0.6, refDistance: 30, rolloff: 0.3 });
      audio.playAt('metal_scrape', V(-8, -3, -6), { bus: 'environment', volume: 0.8, rate: 0.6, refDistance: 25, rolloff: 0.3 });
      audio.playAt('entrance_unlock', V(-8, -3, -6), { bus: 'environment', volume: 1, rate: 0.6, refDistance: 25, rolloff: 0.3 });
      g.player.shake(0.4, 0.8);
      at(1.6, () => { audio.play('pa_click', { bus: 'environment', volume: 0.6 }); this.S.runFx('line', { id: 'mp_pa_unlock' }); });
    }
    if (id === 'b11') {
      // the chamber has failed before: red light, and three of the ones who never left
      audio.playAt('koala_breath', V(-8, -3, -8), { bus: 'environment', volume: 0.3, rate: 0.7, occlude: true });
      at(1.5, () => g.ui.thought('(How many times has this happened?)', 4));
    }
    if (id === 'purge') {
      audio.play('pa_click', { bus: 'environment', volume: 0.7 });
      this.S.runFx('line', { id: 'mp_pa_purge' });
      at(0.6, () => { this.runLights('breach'); L.surgeFlicker(2); });
      at(1.2, () => this.klaxon.set(true));
      at(1.6, () => { audio.playAt('impact_low', V(P.shutter.x, -3, 0), { bus: 'environment', volume: 1, occlude: true, reverb: 0.7, refDistance: 6 }); });
      this.fieldH?.stop(1); this.fieldH = null;
    }
    if (id === 'escape') this.escapeLocal();
  }

  // ================================================================ the multiplayer ending
  // 1) out. The alarm dies, the doors shut behind them, the building goes dark. Silence. Dawn.
  escapeLocal() {
    const g = this.g, L = g.layout, S = this.S;
    const at = (t, fn) => this.later(t, fn);
    S.voice.spatial = true;
    this.klaxon.set(false, true);
    g.world.entrance.close(5); g.world.entrance.locked = true;
    audio.playAt('entrance_slam', V(L.bounds.x0, 1.2, 0), { bus: 'environment', volume: 1, reverb: 0.5 });
    at(0.4, () => { audio.play('power_down', { bus: 'environment', volume: 0.7 }); g.world.lights.setPower('all', false); g.world.lights.setEmergency(false); });
    g.koala?.hide();
    at(4.5, () => g.ui.fade(1, 3.2));
    at(8, () => {
      audio.stopAll(1.2, ['ui', 'voice']);
      g.setMorning();
      g.ui.fade(0, 3);
      g.ui.timecard('6:00 AM', 3.5);
      this.morningAmb = audio.play('morning_wind', { bus: 'ambience', loop: true, volume: 0.5, fadeIn: 3 });
    });
    at(12.5, () => g.ui.thought('(It\'s over. It\'s actually over.)', 3.2));
  }
  // 2) the hospital chooses. The one who answered its phone is back inside, by the desk.
  taken0(missing) {
    const g = this.g, S = this.S, me = S.meSlot, L = g.layout;
    const mp = S.players.get(missing), name = mp?.name || '';
    this.missingSlot = missing;
    audio.playAt('phone_ring', P.phone, { bus: 'environment', volume: 0.5, refDistance: me === missing ? 2 : 0.6 });
    if (me === missing) {
      audio.play('heartbeat', { bus: 'player', volume: 0.7 });
      g.post.pulse?.(0.9, 0.7);
      g.ui.fadeInstant(1);
      this.taken = true;
      this.later(0.9, () => {
        g.player.stand?.(); g.player.teleport(-17.2, 0, -2.6, PI / 2);
        g.world.entrance.close(6); g.world.entrance.locked = true;
        S.voice.cutAll();   // you hear no one
        g.ui.fade(0, 1.6);
        audio.play('room_tone', { bus: 'ambience', loop: true, volume: 0.35, fadeIn: 1 });
      });
      this.later(3.4, () => g.ui.thought('(I was outside. I was outside with them.)', 3.5));
      this.later(8.0, () => g.ui.thought('(They\'re right there. Why can\'t they hear me?)', 4));
    } else {
      // everyone else blinks - and one of them is simply not there any more
      g.ui.fadeInstant(0.85); g.ui.fade(0, 0.5);
      if (mp) S.voice.cut(mp.peerId);   // nobody hears them
      if (mp?.avatar) mp.avatar.visible = false;
      this.hideMissing = missing;
      this.later(2.2, () => g.ui.subtitle(`Where's ${name}?`, '', 3.5));
      this.later(5.8, () => g.ui.thought(`(${name} was right behind us...)`, 4));
    }
  }
  // 3) the phone rings. Loud for the one inside; through the glass for the rest.
  endRing() {
    const g = this.g, me = this.S.meSlot, inside = me === this.missingSlot;
    this.endRinging = true;
    this.endRingH = audio.playAt('phone_ring', P.phone, { bus: 'environment', loop: true, volume: inside ? 1 : 0.55, refDistance: inside ? 3 : 0.8 });
    if (inside) g.ui.thought('(The phone. It\'s ringing for me.)', 3);
  }
  endCallLocal(missing) {
    const g = this.g, me = this.S.meSlot, inside = me === missing;
    this.endRinging = false;
    this.endRingH?.stop(0.08); this.endRingH = null;
    this.handsetUp = true;
    audio.playAt('phone_pickup', P.phone, { bus: 'sfx', volume: inside ? 0.7 : 0.3 });
    if (inside) {
      this.later(1.0, () => this.S.runFx('line', { id: 'mp_end_1' }));
      this.later(4.2, () => this.S.runFx('line', { id: 'mp_end_2' }));
    } else {
      this.later(1.0, () => { audio.playAt('mp_end_1', P.phone, { bus: 'voice', volume: 0.55, refDistance: 1.0 }); g.ui.subtitle('(a voice, faint, from inside)', '', 3); });
      this.later(4.2, () => audio.playAt('mp_end_2', P.phone, { bus: 'voice', volume: 0.55, refDistance: 1.0 }));
    }
    this.later(7.4, () => audio.playAt('phone_hangup', P.phone, { bus: 'sfx', volume: inside ? 0.7 : 0.25 }));
  }
  endTitle() {
    const g = this.g, S = this.S;
    g.ui.fadeInstant(1);
    audio.stopAll(0.05, ['ui']);
    this.morningAmb?.stop(0.1);
    this.later(1.6, () => {
      g.input.exitLock();
      document.getElementById('mp-hud').classList.add('hidden');
      document.getElementById('mp-ending').classList.remove('hidden');
      g.ui.setClock('', false);
      g.state = 'ending';
      try { localStorage.removeItem('nightshift.mp.save.v2'); } catch { /* ignore */ }
      setTimeout(() => {
        g.ui.clickToPlay(true, () => S.mode.exitToMenu());
        document.querySelector('#click-to-play div').textContent = 'RETURN TO MENU';
      }, 6000);
    });
  }
}
