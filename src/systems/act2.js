// NIGHT SHIFT — Act II (after the four fuses are in and the power is back):
//   restored -> aux        "AUXILIARY SYSTEM ONLINE", the old containment warning, the intercom,
//                          basement doors slam, partial power. Find the source of the aux power.
//   aux -> security        Security office (floor 4): live CCTV — one feed shows the Koala standing
//                          right behind you. You turn. Nothing. The containment report.
//   security -> chase      It is at the end of the corridor. A pause. It screams. RUN.
//   chase -> switches      Three emergency containment switches (4F control, 3F electrical, B containment).
//   switches -> final      Return to the basement.
//   final -> containment   The containment chamber, the phone, "It was you.", the reflection.
//   containment -> ending  6:00 AM. The doors unlock. Outside: the morning, the employee... THE END.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { audio } from '../audio/audio.js';
import { say, arman } from './voice.js';
import { rand, wrapAngle } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- placements (three.js coords)
const SEC = {
  room: '408', y: 12,
  rack: { x: 14.8, z: -8.55 },                          // CCTV rack against the south wall, facing +z
  camA: { pos: [16.75, 14.62, -1.75], look: [12.6, 12.9, -6.6] },   // office camera (shows you)
  camB: { pos: [8.25, 14.62, -1.75], look: [14.2, 12.8, -6.6] },    // second office camera
  camCorr: { pos: [16.2, 14.75, 1.3], look: [-6, 13.0, -0.4] },        // floor-4 corridor (from the stair end)
  camStairs: { pos: [17.4, 14.95, -1.35], look: [20.8, 12.6, -5.0] }, // top of the stairs
  folder: { x: 12.35, z: -7.25 },
};
const SWITCHES = [
  { id: 'control', name: 'Control Room', level: '4', pos: [3.4, 12 + 1.05, 8.85], rot: Math.PI },
  { id: 'electrical', name: 'Electrical Room', level: '3', pos: [16.91, 8 + 1.05, -7.35], rot: -Math.PI / 2 },
  { id: 'containment', name: 'Containment', level: 'B', pos: [-11.91, -4 + 1.05, -3.0], rot: Math.PI / 2 },
];
const CONT = { room: 'B11', x: -8, y: -4, zGlass: -5.6, door: { x: -8, z: -1.5 }, phone: [-4.09, -4 + 1.45, -2.65], chamber: [-8, -4, -7.25] };

// ---------------------------------------------------------------- small canvas textures
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function scratchTex(seed = 1) {
  let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let set = 0; set < 3; set++) {
      const x0 = 30 + r() * 150, y0 = 20 + r() * 80, a = 1.2 + r() * 0.5, len = 90 + r() * 90;
      for (let k = 0; k < 4; k++) {
        g.strokeStyle = `rgba(${200 + r() * 40},${190 + r() * 40},${180 + r() * 40},${0.55 + r() * 0.3})`;
        g.lineWidth = 2 + r() * 2.5; g.lineCap = 'round';
        g.beginPath();
        let x = x0 + k * 13, y = y0 + k * 4;
        g.moveTo(x, y);
        for (let i = 1; i <= 8; i++) { x += Math.cos(a) * len / 8 + (r() - 0.5) * 3; y += Math.sin(a) * len / 8 + (r() - 0.5) * 3; g.lineTo(x, y); }
        g.stroke();
      }
    }
  });
}
function bloodTex(seed = 2, drag = false) {
  let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const col = a => `rgba(${70 + r() * 30},${4 + r() * 6},${4 + r() * 6},${a})`;
    if (drag) {
      for (let i = 0; i < 26; i++) { g.fillStyle = col(0.35 + r() * 0.4); g.beginPath(); g.ellipse(128 + (r() - 0.5) * 40, i * 10, 14 + r() * 10, 9, 0, 0, Math.PI * 2); g.fill(); }
      return;
    }
    g.fillStyle = col(0.85); g.beginPath(); g.ellipse(128, 128, 70 + r() * 20, 50 + r() * 20, r(), 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 40; i++) { const a = r() * 6.28, d = 60 + r() * 60; g.fillStyle = col(0.5 + r() * 0.4); g.beginPath(); g.arc(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 2 + r() * 7, 0, 6.28); g.fill(); }
  });
}
function decal(tex, w, h, opts = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({
    map: tex, transparent: true, depthWrite: false, roughness: opts.rough ?? 0.4, polygonOffset: true, polygonOffsetFactor: -3,
  }));
  return m;
}

export class Act2 {
  constructor(g, story) {
    this.g = g; this.story = story;
    this.switchState = { control: false, electrical: false, containment: false };
    this.feeds = [];
    this.build();
  }
  get flags() { return this.story.flags; }
  get switchCount() { return Object.values(this.switchState).filter(Boolean).length; }
  thought(t, s) { this.story.thought(t, s); }
  run(fn) { this.story.run(fn); }
  levelRoot(lv) { return this.g.world.levels[lv] || this.g.scene; }

  // ================================================================ static world pieces
  build() {
    const g = this.g, L = g.layout, P = L.powerRoom.panel;
    // ---- power panel display ("AUXILIARY SYSTEM ONLINE")
    this.panelCanvas = document.createElement('canvas'); this.panelCanvas.width = 512; this.panelCanvas.height = 192;
    this.panelTex = new THREE.CanvasTexture(this.panelCanvas); this.panelTex.colorSpace = THREE.SRGBColorSpace;
    this.panelScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.27), new THREE.MeshBasicMaterial({ map: this.panelTex, toneMapped: false }));
    this.panelScreen.position.set(P.x, P.y + 2.02, P.z + 0.33);
    this.levelRoot('B').add(this.panelScreen);
    this.drawPanel(false);

    // ---- security office: CCTV rack, cameras, the report
    const R = SEC.rack, sy = SEC.y;
    this.rack = g.world.item('cctv_rack'); this.rack.position.set(R.x, sy, R.z); this.levelRoot('4').add(this.rack);
    g.world.physics.addBox({ x0: R.x - 0.84, x1: R.x + 0.84, z0: R.z - 0.27, z1: R.z + 0.52, y0: sy, y1: sy + 1.95, wall: false, prop: 'cctv' });
    for (const c of [SEC.camA, SEC.camB]) {
      const m = g.world.item('cctv_camera');
      m.position.set(...c.pos); m.position.y += 0.15;
      m.rotation.y = Math.atan2(c.look[0] - c.pos[0], c.look[2] - c.pos[2]);
      this.levelRoot('4').add(m);
    }
    const desk = L.catalog.desk;
    this.folder = g.world.item('document_folder');
    this.folder.position.set(SEC.folder.x, sy + desk.h + 0.002, SEC.folder.z); this.folder.rotation.y = 0.25;
    this.levelRoot('4').add(this.folder);
    // 4 CRT feeds: 0 = office cam A (you), 1 = corridor, 2 = stairs, 3 = static -> office cam B
    const screens = [[-0.36, 1.545], [0.36, 1.545], [-0.36, 1.025], [0.36, 1.025]];
    const labels = ['CAM 07  SEC OFFICE', 'CAM 03  CORRIDOR 4', 'CAM 05  STAIRWELL', 'CAM 08  SEC OFFICE'];
    this.noiseCanvas = document.createElement('canvas'); this.noiseCanvas.width = 160; this.noiseCanvas.height = 120;
    this.noiseTex = new THREE.CanvasTexture(this.noiseCanvas);
    screens.forEach(([x, y], i) => {
      const rt = new THREE.WebGLRenderTarget(320, 240, { samples: 0 });
      rt.texture.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: i === 3 ? this.noiseTex : rt.texture, color: 0xd2e6d6, toneMapped: false });
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.27), mat);
      scr.position.set(R.x + x, sy + y, R.z + 0.338);
      this.levelRoot('4').add(scr);
      // overlay: scanlines + camera label + REC
      const ov = canvasTex(320, 240, (cg, w, h) => {
        cg.clearRect(0, 0, w, h);
        for (let yy = 0; yy < h; yy += 3) { cg.fillStyle = 'rgba(0,0,0,0.28)'; cg.fillRect(0, yy, w, 1); }
        cg.font = '15px monospace'; cg.fillStyle = 'rgba(230,235,225,0.85)'; cg.fillText(labels[i], 10, 22);
        cg.fillStyle = 'rgba(200,30,20,0.9)'; cg.beginPath(); cg.arc(w - 46, 16, 5, 0, 6.28); cg.fill();
        cg.fillStyle = 'rgba(230,235,225,0.85)'; cg.fillText('REC', w - 36, 21);
        const gr = cg.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.75);
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.55)'); cg.fillStyle = gr; cg.fillRect(0, 0, w, h);
      });
      const ovm = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.27), new THREE.MeshBasicMaterial({ map: ov, transparent: true, toneMapped: false, depthWrite: false }));
      ovm.position.copy(scr.position); ovm.position.z += 0.002;
      this.levelRoot('4').add(ovm);
      const mk = c => { const cam = new THREE.PerspectiveCamera(62, 4 / 3, 0.1, 40); cam.position.set(...c.pos); cam.lookAt(...c.look); cam.layers.enable(2); return cam; };
      const cam = mk([SEC.camA, SEC.camCorr, SEC.camStairs, SEC.camB][i]);
      this.feeds.push({ rt, mat, scr, cam, live: i !== 3 });
      scr.visible = false; ovm.visible = false;
      this.feeds[i].ov = ovm;
    });
    this.feedIdx = 0; this.noiseT = 0;
    // first person has no body: the cameras see Arman's double (layer 2 = CCTV only)
    this.cctvBody = g.world.item('arman');
    this.cctvBody.traverse(o => o.layers.set(2));
    this.cctvBody.visible = false;
    this.levelRoot('4').add(this.cctvBody);

    // ---- emergency switches
    this.switches = SWITCHES.map(sw => {
      const box = g.world.item('switch_box');
      box.position.set(...sw.pos); box.position.y -= 1.05; box.position.y += 0.75;   // box origin is its bottom
      box.rotation.y = sw.rot;
      const handle = g.world.item('switch_handle');
      handle.position.set(0, 0.38, 0.2); box.add(handle);
      const lamp = g.world.item('switch_lamp');
      const lampMat = new THREE.MeshStandardMaterial({ color: 0x220806, emissive: 0x000000, roughness: 0.3 });
      lamp.traverse(o => { if (o.isMesh) o.material = lampMat; });
      lamp.position.set(0.17, 0.16, 0.185); box.add(lamp);
      this.levelRoot(sw.level).add(box);
      const rec = { ...sw, box, handle, lamp, lampMat };
      g.interact.add({
        id: 'switch_' + sw.id, pos: () => box.localToWorld(V(0, 0.4, 0.25)), radius: 2.0, cone: 0.45,
        enabled: () => this.story.stage === 'switches' && !this.switchState[sw.id],
        prompt: () => '[E] Activate Emergency Switch',
        action: () => this.activateSwitch(rec),
      });
      return rec;
    });
    // control console next to switch 1
    const cc = g.world.item('control_console'); cc.position.set(2.55, 12, 6.0); cc.rotation.y = Math.PI / 2; this.levelRoot('4').add(cc);
    g.world.physics.addBox({ x0: 2.1, x1: 3.0, z0: 5.2, z1: 6.8, y0: 12, y1: 13.5, wall: false, prop: 'console' });

    // ---- containment room: partition, sliding door, chamber
    const C = CONT;
    this.frame = g.world.item('containment_frame'); this.frame.position.set(C.x, C.y, C.zGlass); this.levelRoot('B').add(this.frame);
    this.glassMat = new THREE.MeshPhysicalMaterial({ color: 0xa8bcc4, transparent: true, opacity: 0.16, roughness: 0.06, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
    for (const [a, b] of [[-3.92, -2.48], [-2.32, -0.86], [0.86, 2.32], [2.48, 3.92]]) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(b - a, 2.2), this.glassMat);
      pane.position.set(C.x + (a + b) / 2, C.y + 1.32, C.zGlass);
      this.levelRoot('B').add(pane);
    }
    g.world.physics.addBox({ x0: -12, x1: C.x - 0.7, z0: C.zGlass - 0.12, z1: C.zGlass + 0.12, y0: C.y, y1: C.y + 3.2, wall: false, prop: 'glass' });
    g.world.physics.addBox({ x0: C.x + 0.7, x1: -4, z0: C.zGlass - 0.12, z1: C.zGlass + 0.12, y0: C.y, y1: C.y + 3.2, wall: false, prop: 'glass' });
    this.cdoor = g.world.item('containment_door');
    const dglass = new THREE.Mesh(new THREE.PlaneGeometry(1.28, 1.98), this.glassMat);
    dglass.position.set(0, 1.29, 0); this.cdoor.add(dglass);
    this.cdoor.position.set(C.x, C.y, C.zGlass + 0.17); this.levelRoot('B').add(this.cdoor);
    this.cdoorOpen = 0; this.cdoorTarget = 0;
    g.world.physics.dynamic.push({
      segment: () => this.cdoorOpen > 0.85 ? null : { ax: C.x - 0.72 - this.cdoorOpen * 1.5, az: C.zGlass + 0.17, bx: C.x + 0.72 - this.cdoorOpen * 1.5, bz: C.zGlass + 0.17, y0: C.y, y1: C.y + 2.4, thick: 0.05 },
      blocksSight: () => false,
    });
    // chamber contents: restraint bed, toppled equipment, blood, claw marks (also on the glass)
    const bed = g.world.item('restraint_bed'); bed.position.set(...C.chamber); bed.position.z -= 0.35; this.levelRoot('B').add(bed);
    g.world.physics.addBox({ x0: C.x - 0.48, x1: C.x + 0.48, z0: C.chamber[2] - 1.37, z1: C.chamber[2] + 0.67, y0: C.y, y1: C.y + 0.82, wall: false, prop: 'bed' });
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.35, metalness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.5, metalness: 0.4 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.9, 8), steel);
    pole.rotation.z = Math.PI / 2 - 0.08; pole.rotation.y = 0.6; pole.position.set(C.x - 2.2, C.y + 0.06, -7.9); this.levelRoot('B').add(pole);
    const cart = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.85, 0.45), dark);
    cart.rotation.set(0.15, 0.5, Math.PI / 2); cart.position.set(C.x + 2.4, C.y + 0.28, -8.2); this.levelRoot('B').add(cart);
    const crt = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.4), new THREE.MeshStandardMaterial({ color: 0x6b6862, roughness: 0.6 }));
    crt.rotation.set(-0.4, 0.9, 0.2); crt.position.set(C.x + 1.7, C.y + 0.2, -7.2); this.levelRoot('B').add(crt);
    const B = this.levelRoot('B');
    const put = (m, x, y, z, ry = 0, rx = 0) => { m.position.set(x, y, z); m.rotation.set(rx, ry, 0); B.add(m); return m; };
    put(decal(bloodTex(7), 2.2, 2.2), C.x - 0.3, C.y + 0.004, -7.6, 0, -Math.PI / 2);
    put(decal(bloodTex(11, true), 0.9, 2.2), C.x + 0.1, C.y + 0.005, -6.3, 0.15, -Math.PI / 2);
    put(decal(bloodTex(5), 1.3, 1.3), C.x + 2.6, C.y + 0.004, -8.3, 0, -Math.PI / 2);
    put(decal(scratchTex(3), 1.6, 1.6), C.x - 1.5, C.y + 1.6, -8.9);
    put(decal(scratchTex(9), 1.4, 1.4), C.x + 1.9, C.y + 1.2, -8.9);
    put(decal(scratchTex(13), 1.4, 1.4), -11.9, C.y + 1.5, -7.6, Math.PI / 2);
    put(decal(scratchTex(17), 1.2, 1.2), -4.1, C.y + 1.4, -7.0, -Math.PI / 2);
    put(decal(bloodTex(19), 0.8, 0.8), C.x - 1.5, C.y + 1.1, -8.89);
    // claw marks on the INSIDE of the glass (seen from the antechamber)
    for (const [x, y, s] of [[C.x - 1.6, C.y + 1.5, 0.9], [C.x + 1.7, C.y + 1.1, 1.0], [C.x - 3.0, C.y + 0.9, 0.7]]) put(decal(scratchTex(23 + x | 0), s, s, { rough: 0.1 }), x, y, C.zGlass - 0.015);
    // red emergency light in the chamber (off until the end)
    this.chamberLight = new THREE.PointLight(0xff2412, 0, 7.5, 1.6);
    this.chamberLight.position.set(C.x, C.y + 2.6, -7.3); B.add(this.chamberLight);
    // the old phone in the dark corner of the antechamber
    this.oldPhone = g.world.item('phone_wall'); this.oldPhone.position.set(...C.phone); this.oldPhone.rotation.y = -Math.PI / 2; B.add(this.oldPhone);
    g.interact.add({
      id: 'old_phone', pos: () => V(C.phone[0] - 0.12, C.phone[1], C.phone[2]), radius: 2.0, cone: 0.6,
      enabled: () => !!this.finalRinging,
      prompt: () => '[E] Answer Phone',
      action: () => this.answerFinalPhone(),
    });
    // sealed containment room door (after the intercom, until the switches stage)
    const cd = g.world.doorById['door_' + C.room];
    this.containDoor = cd;
    g.interact.add({
      id: 'door_containment_sealed', pos: () => cd.center, radius: 2.0,
      enabled: () => !!cd.locked,
      prompt: () => '[E] Open Door',
      action: () => { audio.playAt('door_locked', cd.center, { bus: 'environment', volume: 0.9 }); this.thought('(Sealed. Some kind of magnetic lock — it hums.)', 3.5); },
    });
    // the report on the security office desk
    g.interact.add({
      id: 'report', pos: () => this.folder.getWorldPosition(V(0, 0, 0)).add(V(0, 0.05, 0)), radius: 2.0, cone: 0.5,
      enabled: () => this.story.stageAtLeast('security') && this.folder.visible,
      prompt: () => '[E] Read Containment Report',
      action: () => this.readReport(),
    });
  }

  // ================================================================ panel display
  drawPanel(on, line2 = '') {
    const c = this.panelCanvas.getContext('2d'), w = 512, h = 192;
    c.fillStyle = '#020604'; c.fillRect(0, 0, w, h);
    if (on) {
      c.fillStyle = '#5dff9a'; c.font = 'bold 34px monospace'; c.textAlign = 'center';
      c.fillText('AUXILIARY SYSTEM', w / 2, 70); c.fillText('ONLINE', w / 2, 112);
      c.font = '20px monospace'; c.fillStyle = '#38c46e'; c.fillText(line2, w / 2, 160);
      for (let y = 0; y < h; y += 4) { c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, y, w, 2); }
    }
    this.panelTex.needsUpdate = true;
    this.panelScreen.visible = on;
  }

  // ================================================================ lights: partial power
  partialPower() {
    const L = this.g.world.lights;
    L.setPower('all', true);
    L.fixtures.forEach((f, i) => {
      if (f.origState === undefined) f.origState = f.state;
      const r = ((i * 9301 + 49297) % 233280) / 233280;
      const dead = f.level === 'B' ? 0.45 : 0.33, flick = f.level === 'B' ? 0.3 : 0.3;
      f.state = f.origState === 'dead' || r < dead ? 'dead' : r < dead + flick ? 'flicker' : 'on';
    });
  }

  // ================================================================ restored -> aux
  restorePower() {
    const g = this.g, S = this.story, P = g.layout.powerRoom.panel;
    S.setStage('restored');
    g.ai.disable();
    g.events.enabled = false;
    this.run(async wait => {
      await wait(0.6);
      const lv = g.fuses.lever;
      for (let i = 0; i <= 10; i++) { lv.rotation.x = -i * 0.18; await wait(0.03); }
      audio.play('lever', { bus: 'environment', volume: 1 });
      await wait(0.3);
      audio.play('power_up', { bus: 'environment', volume: 1 });
      g.world.lights.surgeFlicker(1.2);
      await wait(1.0);
      g.world.lights.setPower('all', true);
      S.roomTone?.stop(3);
      S.hum = audio.play('hum_electric', { bus: 'ambience', loop: true, volume: 0.3, fadeIn: 1 });
      g.breathing.fear = Math.min(g.breathing.fear, 0.2);
      // "Restore power" is done the moment the lights come back
      this.flags.powerOn = true;
      g.saveCheckpoint({ stage: 'aux', pos: V(P.x, P.y, P.z + 1.9), yaw: Math.PI });
      await wait(2.4);
      this.thought('(Light. Finally... it\'s over.)', 4);
      await wait(3.2);
      // the panel display wakes up on its own
      audio.playAt('ui_confirm', V(P.x, P.y + 2, P.z + 0.3), { bus: 'environment', volume: 0.5 });
      this.drawPanel(true, 'AUX FEED: FLOOR 4  -  SECURITY');
      await wait(0.4);
      audio.playAt('light_buzz', V(P.x, P.y + 2, P.z + 0.3), { bus: 'environment', volume: 0.35 });
      g.player.lookOverride = { yaw: g.player.yaw, pitch: 0.28, speed: 2.5 };
      await wait(0.9);
      g.player.lookOverride = null;
      this.thought('(Auxiliary system...? And that sign — "WARNING. CONTAINMENT SYSTEM.")', 4.5);
      await wait(4.4);
      // the intercom
      const spk = audio.play('pa_click', { bus: 'environment', volume: 0.9, bigReverb: 0.5 });
      const st = audio.play('pa_static', { bus: 'environment', volume: 0.25, loop: true, bigReverb: 0.4 });
      await wait(1.0);
      await say(g.ui, 'vo_intercom', { volume: 1, bigReverb: 0.55, reverb: 0.3, wait });
      st.stop(0.4); audio.play('pa_click', { bus: 'environment', volume: 0.6 });
      // lights flicker... and every door down here slams shut
      g.world.lights.surgeFlicker(2.0);
      audio.play('light_flicker', { bus: 'environment', volume: 0.8 });
      await wait(0.8);
      const pd = g.world.doorById['door_' + g.layout.powerRoom.id];
      const bdoors = g.world.doors.filter(d => d.level === 'B' && d !== pd);
      for (const d of bdoors) { this.run(async w => { await w(rand(0, 1.4)); if (d.target > 0.1) d.slam(); else audio.playAt('door_bang', d.center, { bus: 'environment', volume: 0.6, occlude: true }); }); }
      pd.slam();
      g.player.shake(0.6, 0.6);
      await wait(1.6);
      this.containDoor.locked = 'sealed';
      this.partialPower();
      g.breathing.scare(0.5);
      await wait(1.2);
      pd.open(1.0, false);                      // the power room door eases back open
      this.flags.auxObjective = true;
      S.setStage('aux');
      g.events.enabled = true;
      g.saveCheckpoint({ pos: V(P.x, P.y, P.z + 1.9), yaw: Math.PI });
      await wait(1.5);
      this.thought('(The auxiliary feed comes from upstairs. Floor four. Security.)', 5);
    });
  }

  // ================================================================ security office
  inSecurity() { const p = this.g.player.pos; return this.g.player.level === '4' && p.x > 8 && p.x < 17 && p.z < -1.5 && p.z > -9; }

  startSecurity() {
    const g = this.g;
    this.story.setStage('security');
    this.cctv = { phase: 'idle', t: 0, lookT: 0 };
    this.thought('(The monitors... they\'re running on the auxiliary line.)', 4);
  }

  updateCCTV(dt) {
    const g = this.g;
    const near = this.story.stageAtLeast('aux') && g.player.level === '4' && g.player.pos.distanceTo(V(SEC.rack.x, SEC.y, SEC.rack.z)) < 12;
    for (const f of this.feeds) { f.scr.visible = near; f.ov.visible = near; }
    if (!near) return;
    // static on the 4th monitor
    this.noiseT -= dt;
    if (this.noiseT <= 0 && this.feeds[3].mat.map === this.noiseTex) {
      this.noiseT = 0.07;
      const c = this.noiseCanvas.getContext('2d'), img = c.createImageData(160, 120);
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 200; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
      c.putImageData(img, 0, 0); c.fillStyle = '#ddd'; c.font = '13px monospace'; c.fillText('NO SIGNAL', 48, 64);
      this.noiseTex.needsUpdate = true;
    }
    // render one live feed per frame (round robin)
    const live = this.feeds.filter(f => f.live);
    if (!live.length) return;
    const f = live[this.feedIdx++ % live.length];
    const P = g.player;
    this.cctvBody.visible = !g.hiding?.current;                 // not when he is inside a closet
    this.cctvBody.position.copy(P.pos).sub(this.levelRoot('4').position || V(0, 0, 0));
    this.cctvBody.rotation.y = P.yaw + Math.PI;
    this.cctvBody.scale.y = P.crouching ? 0.68 : 1;
    const r = g.renderer;
    const prevTarget = r.getRenderTarget(), prevAuto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    this.feeds.forEach(x => { x.scr.visible = false; x.ov.visible = false; });   // no feedback loops
    g.flashlight.model && (g.flashlight.model.visible = false);
    r.setRenderTarget(f.rt);
    r.render(g.scene, f.cam);
    r.setRenderTarget(prevTarget);
    g.flashlight.model && (g.flashlight.model.visible = g.flashlight.has);
    this.feeds.forEach(x => { x.scr.visible = true; x.ov.visible = true; });
    r.shadowMap.autoUpdate = prevAuto;
  }

  // the moment: the 4th camera comes on — the Koala is standing right behind you
  updateSecurityBeat(dt) {
    const g = this.g, C = this.cctv;
    if (!C || this.story.stage !== 'security') return;
    C.t += dt;
    const scrPos = V(SEC.rack.x, SEC.y + 1.3, SEC.rack.z + 0.34);
    const looking = g.player.pos.distanceTo(V(SEC.rack.x, SEC.y, SEC.rack.z)) < 3.6 && g.ai.inView?.(scrPos) !== false && this.camLooksAt(scrPos, 0.8);
    if (C.phase === 'idle') {
      C.lookT = looking ? C.lookT + dt : Math.max(0, C.lookT - dt * 0.5);
      if (C.lookT > 2.2) { C.phase = 'watch'; C.t = 0; }
    } else if (C.phase === 'watch' && C.t > 2.6) {
      // monitor 4 flickers to a second office camera... and it is there, behind him
      C.phase = 'behind'; C.t = 0;
      const k = g.koala;
      if (!k) { C.phase = 'done'; return; }
      const p = g.player.pos, fwd = V(-Math.sin(g.player.yaw), 0, -Math.cos(g.player.yaw));
      const at = p.clone().addScaledVector(fwd, -1.05);
      const q = at.clone(); g.world.physics.collide(q, 0.3, 1.9);
      k.show(q, 0, 'idle'); k.faceTowards(p); k.lookTarget = g.camera.position;
      k.root.traverse(o => o.layers.set(2));                   // only the cameras can see it
      this.feeds[3].live = true; this.feeds[3].mat.map = this.feeds[3].rt.texture; this.feeds[3].mat.needsUpdate = true;
      audio.play('stinger_reveal', { bus: 'sfx', volume: 0.45 });
      audio.playAt('koala_breath', q.clone().setY(q.y + 1.6), { bus: 'monster', volume: 0.35, hrtf: true });
      g.breathing.scare(0.6);
    } else if (C.phase === 'behind') {
      const k = g.koala;
      const toK = k.position.clone().setY(g.camera.position.y).sub(g.camera.position).normalize();
      const camF = V(0, 0, -1).applyQuaternion(g.camera.quaternion).setY(0).normalize();
      if (camF.dot(toK) > 0.2 || C.t > 6) {
        // he turns. Nothing.
        k.hide(); k.root.traverse(o => o.layers.set(0));
        C.phase = 'after'; C.t = 0;
        g.world.lights.surgeFlicker(0.25);
        arman(g, 'wait_what', { force: true, delay: 0.5 });
      }
    } else if (C.phase === 'after' && C.t > 3.2) {
      C.phase = 'done';
      this.thought('(...There\'s a folder on the desk.)', 3.5);
    }
  }
  camLooksAt(p, minDot) {
    const cam = this.g.camera;
    const f = V(0, 0, -1).applyQuaternion(cam.quaternion);
    return f.dot(p.clone().sub(cam.position).normalize()) > minDot;
  }

  readReport() {
    const g = this.g;
    g.ui.read('INCIDENT FILE 87-114 &mdash; CONFIDENTIAL', `
      <div style="font-size:14px;line-height:1.65">
      <b>ST. MERCY HOSPITAL &middot; SUB-LEVEL B &middot; CONTAINMENT 01</b><br>
      Specimen recovered 11 Mar 1987. Origin: unknown. Responds to light and to noise. Does not sleep.<br>
      Containment field and chamber locks run on the <b>AUXILIARY</b> circuit &mdash; independent of mains.<br><br>
      14 Mar 1987: auxiliary line cut during the storm. Night guard D. Kowalski on duty.<br>
      Chamber found open at 06:00. Kowalski was not found.<br>
      Facility closed. <b>Specimen not recovered.</b><br><br>
      <i style="color:#c9b98a">(handwritten) If the aux ever comes back on, the field will try to re-seal. It won't hold.
      Three emergency switches &mdash; control room 4F, electrical 3F, containment B. Pull all three.
      And don't let it see you.</i></div>`);
    this.story.readingOpen = true;
    this.story.onReaderClosed = () => this.afterReport();
  }

  afterReport() {
    const g = this.g;
    if (this.story.stageAtLeast('chase')) return;          // re-reading later
    this.flags.reportRead = true;
    this.story.setStage('chase');
    // checkpoint BEFORE the major chase — inside the office, facing the door
    g.saveCheckpoint({ pos: V(13.2, SEC.y, -4.4), yaw: Math.PI });
    this.armChase();
    this.run(async wait => {
      await wait(1.2);
      audio.play('pa_click', { bus: 'environment', volume: 0.6, bigReverb: 0.5 });
      g.world.lights.surgeFlicker(0.6);
    });
  }

  // ================================================================ the major chase
  armChase() { this.chaseArmed = true; this.chaseT = 0; this.chaseStarted = false; }

  async startMajorChase() {
    const g = this.g;
    this.chaseStarted = true;
    await g.ensureKoala();
    const p = g.player.pos;
    // it stands at the far end of the corridor, under a working light
    const cands = g.nav.nodes.filter(n => n.level === '4' && n.tag === 'corridor' && Math.abs(n.x - p.x) > 13 && Math.abs(n.x - p.x) < 24 && g.world.physics.los(V(n.x, n.y + 1.6, n.z), g.camera.position));
    const n = cands.sort((a, b) => Math.abs(b.x - p.x) - Math.abs(a.x - p.x))[0] || g.nav.nodes.filter(n => n.level === '4' && n.tag === 'corridor').sort((a, b) => Math.abs(b.x - p.x) - Math.abs(a.x - p.x))[0];
    const start = V(n.x, n.y, n.z);
    const k = g.koala;
    k.show(start, 0, 'idle'); k.faceTowards(p); k.lookTarget = g.camera.position;
    audio.play('stinger_reveal', { bus: 'sfx', volume: 0.6 });
    g.breathing.scare(0.7);
    g.world.lights.surgeFlicker(0.3);
    this.run(async wait => {
      await wait(1.8);                                    // a brief, terrible pause
      k.vocal('koala_screech', 1, { bigReverb: 0.4 });
      g.ai.lastKnown = g.player.pos.clone();
      g.ai.enc_chase('4', {
        start: k.position.clone(), scripted: true, startSpeed: 3.2, maxSpeed: 4.35, screamTime: 1.25,
        maxTime: 85, searchTime: 22, cool: 60, onEnd: () => this.onChaseEnd(),
      });
    });
  }

  onChaseEnd() {
    const g = this.g;
    if (g.dying || this.story.stage !== 'chase') return;
    this.chaseArmed = false;
    this.flags.chaseDone = true;
    this.story.setStage('switches');
    this.containDoor.locked = null;                       // the emergency override frees the containment room
    g.saveCheckpoint();
    g.ensureKoala().then(() => g.ai.enable(rand(35, 55)));
    this.run(async wait => {
      await wait(4.5);
      this.thought('(It\'s gone... for now. Three emergency switches. Control room, electrical, containment.)', 5.5);
    });
  }

  // ================================================================ switches
  activateSwitch(rec) {
    const g = this.g;
    if (this.switchState[rec.id]) return;
    this.switchState[rec.id] = true;
    this.flags['sw_' + rec.id] = true;
    this.run(async wait => {
      for (let i = 0; i <= 8; i++) { rec.handle.rotation.x = (i / 8) * 2.4; await wait(0.03); }
      audio.playAt('lever', rec.box.getWorldPosition(V(0, 0, 0)), { bus: 'environment', volume: 1 });
      await wait(0.25);
      this.setLamp(rec, true);
      audio.playAt('ui_confirm', rec.box.getWorldPosition(V(0, 0, 0)), { bus: 'environment', volume: 0.4 });
      g.player.shake(0.25, 0.3);
      g.ui.toast(`EMERGENCY SWITCH  ${this.switchCount}/3`);
      if (this.switchCount >= 3) this.allSwitches();
      else g.saveCheckpoint();
    });
  }
  setLamp(rec, on) {
    rec.lampMat.color.setHex(on ? 0x0b3a14 : 0x3a0806);
    rec.lampMat.emissive.setHex(on ? 0x21ff5a : 0xff2a14);
    rec.lampMat.emissiveIntensity = on ? 1.4 : 0.9;
  }
  allSwitches() {
    const g = this.g;
    this.story.setStage('final');
    g.ai.disable();
    g.saveCheckpoint();
    this.run(async wait => {
      await wait(1.0);
      audio.play('impact_low', { bus: 'environment', volume: 0.9, bigReverb: 0.5 });
      audio.play('emerge_rumble', { bus: 'environment', volume: 0.35 });
      g.player.shake(0.4, 1.2);
      g.world.lights.surgeFlicker(1.0);
      await wait(2.5);
      this.thought('(Something down in the basement just... unlocked.)', 4.5);
    });
  }

  // ================================================================ the final sequence (containment)
  inContainment() { const p = this.g.player.pos; return this.g.player.level === 'B' && p.x > -12 && p.x < -4 && p.z < -1.6 && p.z > CONT.zGlass + 0.1; }

  startContainment() {
    const g = this.g, C = CONT;
    this.story.setStage('containment');
    g.ai.disable();
    g.music.setSilent(true);
    const L = g.world.lights;
    L.setPower('B', false);
    L.setEmergency(true);
    this.story.hum?.setVolume(0.08, 2);
    this.run(async wait => {
      await wait(1.5);
      // something inside the dark chamber
      audio.playAt('koala_scratch', V(C.x + 1.2, C.y + 1.2, C.zGlass - 0.2), { bus: 'monster', volume: 0.8, hrtf: true });
      await wait(1.3);
      arman(g, 'whos_there', { force: true });
      // wait until he is close to the glass
      let t = 0;
      while (t < 14 && g.player.pos.distanceTo(V(C.x, C.y, C.zGlass)) > 3.4) { await wait(0.2); t += 0.2; }
      // the red chamber light stutters on: it is standing behind the glass
      await this.koalaBehindGlass(wait, 3.2);
      await wait(2.0);
      this.finalRinging = audio.playAt('phone_ring', V(...C.phone), { bus: 'environment', loop: true, volume: 0.85, refDistance: 2.2, reverb: 0.35 });
    });
  }

  async koalaBehindGlass(wait, stare) {
    const g = this.g, C = CONT, k = g.koala;
    await g.ensureKoala();
    this.chamberLight.intensity = 0;
    for (let i = 0; i < 4; i++) { this.chamberLight.intensity = i % 2 ? 0 : 7; audio.play('light_flicker', { bus: 'environment', volume: 0.35 }); await wait(0.08 + Math.random() * 0.1); }
    this.chamberLight.intensity = 7;
    k.show(V(C.x + 0.35, C.y, C.zGlass - 1.0), 0, 'breathe'); k.faceTowards(g.player.pos); k.lookTarget = g.camera.position;
    audio.play('stinger_reveal', { bus: 'sfx', volume: 0.55 });
    g.breathing.scare(0.7);
    await wait(stare);
    for (let i = 0; i < 3; i++) { this.chamberLight.intensity = i % 2 ? 7 : 0; await wait(0.07); }
    k.hide();
    this.chamberLight.intensity = 2.5;
  }

  answerFinalPhone() {
    const g = this.g;
    this.finalRinging?.stop(0.05); this.finalRinging = null;
    audio.play('phone_pickup', { bus: 'sfx', volume: 0.9 });
    g.player.canMove = false;
    this.run(async wait => {
      const stat = audio.play('phone_static', { bus: 'voice', volume: 0.4, loop: true });
      await wait(1.4);
      stat.setVolume(0.12, 0.4);
      await say(g.ui, 'vo_phone_trapped', { volume: 1, reverb: 0.04, wait });
      await wait(1.6);
      // the Koala behind the glass again
      await this.koalaBehindGlassSilent(wait);
      await say(g.ui, 'vo_phone_was_you', { volume: 1, reverb: 0.04, wait });
      stat.setVolume(0.5, 0.1); await wait(0.6); stat.stop(0.05);
      audio.play('phone_hangup', { bus: 'sfx', volume: 0.9 });
      const busy = audio.play('phone_busy', { bus: 'voice', volume: 0.3, delay: 0.3 });
      await wait(1.6); busy.stop(0.1);
      g.player.canMove = true;
      await this.chamberOpens(wait);
    });
  }
  async koalaBehindGlassSilent(wait) {
    const g = this.g, C = CONT, k = g.koala;
    for (let i = 0; i < 3; i++) { this.chamberLight.intensity = i % 2 ? 0 : 7; await wait(0.07); }
    this.chamberLight.intensity = 7;
    k.show(V(C.x - 0.2, C.y, C.zGlass - 0.7), 0, 'idle'); k.faceTowards(g.player.pos); k.lookTarget = g.camera.position;
    g.breathing.scare(0.6);
    await wait(1.2);
  }

  // the chamber opens. It walks out. It walks right past him.
  async chamberOpens(wait) {
    const g = this.g, C = CONT, k = g.koala;
    await wait(1.2);
    audio.playAt('entrance_unlock', V(C.x, C.y + 2.2, C.zGlass), { bus: 'environment', volume: 1 });
    audio.playAt('metal_scrape', V(C.x, C.y + 1, C.zGlass), { bus: 'environment', volume: 0.8, delay: 0.3 });
    this.cdoorTarget = 1;
    await wait(2.2);
    if (!k.visible) { k.show(V(C.x, C.y, C.zGlass - 0.7), 0, 'idle'); }
    k.lookTarget = g.camera.position;
    g.player.canMove = false;
    const path = [V(C.x, C.y, C.zGlass - 0.3), V(C.x, C.y, -3.4), V(C.door.x, C.y, -1.0), V(C.door.x, C.y, 0.2), V(C.door.x + 5, C.y, 0.2)];
    k.play('walk', { fade: 0.4 });
    for (const wp of path) {
      while (true) {
        const to = wp.clone().sub(k.position).setY(0); const d = to.length();
        if (d < 0.08) break;
        const step = Math.min(d, 1.05 / 30);
        k.position.addScaledVector(to.normalize(), step); k.speed = 1.05;
        k.faceTowards(wp, 1 / 30, 6);
        if (k.position.distanceTo(g.player.pos) < 4) k.lookTarget = g.camera.position; else k.lookTarget = null;
        await wait(1 / 30);
        if (k.position.z > -0.6 && !this.camLooksAt(k.headPos, 0.5)) break;
      }
      if (k.position.z > -0.6 && !this.camLooksAt(k.headPos, 0.5)) break;
    }
    k.hide();
    g.player.canMove = true;
    this.cdoorTarget = 0;
    audio.playAt('metal_scrape', V(C.x, C.y + 1, C.zGlass), { bus: 'environment', volume: 0.5 });
    await wait(2.2);
    await this.reflectionBeat(wait);
  }

  // the reflection in the chamber glass does not copy Arman. It smiles.
  async reflectionBeat(wait) {
    const g = this.g, C = CONT;
    this.chamberLight.intensity = 1.2;
    const mirror = new Reflector(new THREE.PlaneGeometry(1.28, 1.98), { textureWidth: 640, textureHeight: 960, color: 0x7d8288, clipBias: 0.003 });
    mirror.position.set(C.x, C.y + 1.29, C.zGlass + 0.235);
    this.levelRoot('B').add(mirror);
    mirror.getReflectionCamera?.(g.camera)?.layers.enable(1);
    if (mirror.camera) mirror.camera.layers.enable(1);
    const dbl = g.world.item('arman');
    const smile = g.world.item('arman_smile'); g.world.attachToBone(dbl, 'head', smile, V(0, 1.689, 0.181)); smile.scale.setScalar(0.001);
    dbl.traverse(o => o.layers.set(1));
    this.levelRoot('B').add(dbl);
    this.refl = { mirror, dbl, smile, copy: true, s: 0.001, tilt: 0 };
    // turn him toward the glass, then give the view back
    const p = g.player;
    p.lookOverride = { yaw: Math.atan2(-(C.x - p.pos.x), -(C.zGlass - p.pos.z)), pitch: 0.02, speed: 1.8 };
    await wait(1.4);
    p.lookOverride = null;
    p.canMove = false;
    await wait(2.6);
    this.refl.copy = false;                                   // it stops copying
    audio.play('stinger_reveal', { bus: 'sfx', volume: 0.35 });
    g.breathing.scare(0.6);
    await wait(1.5);
    this.refl.smileOn = true;
    await wait(3.4);
    await say(g.ui, 'vo_see_tonight', { volume: 0.95, reverb: 0.15, wait });
    await wait(0.3);
    // lights go out
    audio.play('power_down', { bus: 'environment', volume: 0.9 });
    g.world.lights.setEmergency(false);
    g.world.lights.setPower('all', false);
    this.chamberLight.intensity = 0;
    g.flashlight.toggle(false);
    this.story.hum?.stop(0.3);
    mirror.visible = false; dbl.visible = false;
    await wait(3.0);
    this.toEnding(wait);
  }
  updateReflection(dt) {
    const R = this.refl; if (!R || !R.dbl.visible) return;
    const p = this.g.player;
    R.dbl.position.copy(p.pos);
    const U = R.dbl.userData;
    if (R.copy) { R.dbl.rotation.set(0, p.yaw + Math.PI, 0); R.frozenYaw = p.yaw + Math.PI; U.gait?.(Math.hypot(p.vel.x, p.vel.z)); }
    else {
      R.dbl.rotation.y += (Math.PI - R.dbl.rotation.y) * Math.min(1, dt * 0.6);   // keeps staring at the glass
      if (U.play) { if (!R.tilted) { R.tilted = true; U.restPose = 'stare'; U.play('head_tilt', 0.8); } }   // Blender-keyed slow tilt + twitch
      else { R.tilt = Math.min(0.14, R.tilt + dt * 0.03); R.dbl.rotation.z = R.tilt; }
    }
    if (R.smileOn) { R.s = Math.min(1, R.s + dt * 0.3); R.smile.scale.set(R.s * 1.1, R.s * 1.0, R.s); }
  }

  // ================================================================ 6:00 AM
  toEnding(wait) {
    const g = this.g, L = g.layout;
    this.story.setStage('ending');                       // the clock reaches 6:00 AM
    g.world.lights.setEmergency(true);
    g.player.canMove = true;
    g.flashlight.toggle(true);
    audio.play('entrance_unlock', { bus: 'environment', volume: 0.35, bigReverb: 0.8 });
    this.thought('(6:00 AM... The doors upstairs. I heard them unlock.)', 5);
    this.endingArmed = true;
  }

  exitSequence() {
    const g = this.g, L = g.layout, S = this.story;
    this.endingArmed = false;
    S.hideHud = true;
    this.run(async wait => {
      g.player.canMove = false;
      await g.ui.fade(1, 1.4);
      g.world.lights.setEmergency(false);
      g.music.stop();
      g.setMorning();
      g.flashlight.toggle(false);
      g.flashlight.has = false; if (g.flashlight.model) g.flashlight.model.visible = false;
      g.player.teleport(L.bounds.x0 - 2.6, 0, 0.2, Math.PI / 2 + 0.05);
      this.morningAmb = audio.play('morning_wind', { bus: 'ambience', loop: true, volume: 0.5, fadeIn: 3 });
      await wait(0.6);
      g.ui.fade(0, 2.2);
      g.player.canMove = true;
      g.player.speedMul = 0.9;
      await wait(2.6);
      // an employee walks over from the empty car park
      const emp = g.world.item('employee');
      const smile = g.world.item('arman_smile'); g.world.attachToBone(emp, 'head', smile, V(0, 1.385, 0.151)); smile.scale.setScalar(0.001);
      g.scene.add(emp);
      const from = V(L.bounds.x0 - 17, 0, 7.5);
      emp.position.copy(from);
      emp.rotation.y = Math.atan2(g.player.pos.x - from.x, g.player.pos.z - from.z);
      let stepAcc = 0, steps = 0;
      const step = async () => {
        const t0 = g.clock.time; let last = t0;
        for (let i = 0; g.clock.time - t0 < 25; i++) {
          const dt = Math.min(0.1, g.clock.time - last); last = g.clock.time;
          const target = g.player.pos.clone().add(V(-2.1, 0, 0.3));
          const to = target.clone().sub(emp.position).setY(0); const d = to.length();
          const face = Math.atan2(g.player.pos.x - emp.position.x, g.player.pos.z - emp.position.z);
          emp.rotation.y += wrapAngle(face - emp.rotation.y) * Math.min(1, dt * 4);
          if (d < 0.1) break;
          // eases in from a stop and slows down over the last metre and a half (no constant glide)
          const sp = 1.25 * Math.min(1, (last - t0 + 0.05) / 0.8) * Math.min(1, 0.35 + d / 1.5);
          emp.position.addScaledVector(to.normalize(), Math.min(d, sp * dt));
          if (emp.userData.gait) emp.userData.gait(sp);
          else emp.position.y = Math.abs(Math.sin(i * 0.42)) * 0.025;
          // footfalls follow the actual stride (0.71 m per step at 1.3 m/s cadence)
          stepAcc += sp * dt;
          if (stepAcc > 0.71) { stepAcc = 0; audio.playAt('step_outside', emp.position.clone(), { bus: 'environment', volume: 0.35, index: steps++ % 3 }); }
          await wait(1 / 30);
        }
        emp.position.y = 0;
        emp.userData.gait?.(0);
      };
      await step();
      g.player.lookOverride = { yaw: Math.atan2(-(emp.position.x - g.player.pos.x), -(emp.position.z - g.player.pos.z)), pitch: 0.03, speed: 2 };
      await wait(0.8);
      g.player.lookOverride = null;
      g.player.canMove = false;
      emp.userData.play?.('talk', 0.4);
      await say(g.ui, 'vo_employee', { volume: 0.9, reverb: 0.02, pos: emp.position.clone().setY(1.6), refDistance: 3, wait });
      await wait(0.5);
      emp.userData.restPose = 'stare'; emp.userData.play?.('stare', 0.6);
      arman(g, 'night_guard', { force: true });
      await wait(2.0);
      // the employee smiles...
      for (let i = 0; i < 45; i++) { const s = i / 45; smile.scale.set(s * 1.0, s * 0.9, s); await wait(1 / 30); }
      await wait(1.4);
      // ...and is gone
      g.ui.fadeInstant(1); await wait(0.18); emp.removeFromParent(); g.ui.fadeInstant(0);
      audio.play('stinger_hit', { bus: 'sfx', volume: 0.3 });
      await wait(2.2);
      // the hospital doors slowly close
      g.player.lookOverride = { yaw: -Math.PI / 2, pitch: 0.05, speed: 1.2 };
      await wait(1.6);
      g.world.entrance.close(0.22);
      audio.playAt('door_creak', V(L.bounds.x0, 1.2, 0), { bus: 'environment', volume: 0.7 });
      await wait(4.0);
      // CUT TO BLACK
      g.ui.fadeInstant(1);
      audio.stopAll(0.05, ['ui', 'voice']);
      this.morningAmb?.stop(0.05);
      await wait(1.8);
      const ring = audio.play('phone_ring', { bus: 'environment', volume: 0.9 });
      await wait(3.4);
      ring.stop(0.1);
      audio.play('phone_pickup', { bus: 'sfx', volume: 0.6 });
      await wait(0.8);
      await say(g.ui, 'vo_phone_threat', { volume: 1, reverb: 0.04, wait });
      await wait(1.6);
      this.story.setStage('end');
      g.endGame();
    });
  }

  // ================================================================ per-frame + save
  update(dt) {
    const g = this.g, S = this.story;
    // sliding chamber door
    if (this.cdoorOpen !== this.cdoorTarget) {
      const s = dt / 2.2;
      this.cdoorOpen = this.cdoorTarget > this.cdoorOpen ? Math.min(this.cdoorTarget, this.cdoorOpen + s) : Math.max(this.cdoorTarget, this.cdoorOpen - s);
      const e = this.cdoorOpen * this.cdoorOpen * (3 - 2 * this.cdoorOpen);
      this.cdoor.position.x = CONT.x - e * 1.5;
    }
    if (!S.stageAtLeast('restored')) return;
    this.updateCCTV(dt);
    this.updateReflection(dt);
    if (S.stage === 'aux' && this.inSecurity()) this.startSecurity();
    this.updateSecurityBeat(dt);
    if (S.stage === 'chase' && this.chaseArmed && !this.chaseStarted) {
      this.chaseT += dt;
      // when he steps out of the office into the corridor (or lingers too long)
      const p = g.player.pos;
      if ((g.player.level === '4' && p.z > -1.2) || this.chaseT > 35) this.startMajorChase();
    }
    // (after the 'something unlocked' beat — even if he pulled the last switch down there)
    if (S.stage === 'final' && S.stageT > 5.5 && this.inContainment()) this.startContainment();
    if (S.stage === 'ending' && this.endingArmed) {
      const p = g.player.pos, B = g.layout.bounds;
      if (g.player.level === '1' && p.x < B.x0 + 4 && Math.abs(p.z) < 3 && g.world.entrance.target < 0.5) {
        g.world.entrance.locked = false; g.world.entrance.open(0.6);
        audio.playAt('entrance_open', V(B.x0, 1.2, 0), { bus: 'environment', volume: 0.8 });
      }
      if (p.x < B.x0 - 0.6) this.exitSequence();
    }
  }

  // restore the second-act world state from a checkpoint
  applySave(s) {
    const g = this.g, S = this.story, st = S.stage;
    for (const id of Object.keys(this.switchState)) this.switchState[id] = !!this.flags['sw_' + id];
    this.switches.forEach(rec => { if (this.switchState[rec.id]) { rec.handle.rotation.x = 2.4; this.setLamp(rec, true); } else if (S.stageAtLeast('switches')) this.setLamp(rec, false); });
    this.flags.auxObjective = true;
    this.flags.powerOn = true;
    this.partialPower();
    this.drawPanel(true, 'AUX FEED: FLOOR 4  -  SECURITY');
    g.fuses.lever.rotation.x = -1.8;
    S.roomTone?.stop(0.5);
    S.hum = audio.play('hum_electric', { bus: 'ambience', loop: true, volume: 0.3, fadeIn: 2 });
    g.events.enabled = true;
    this.containDoor.locked = S.stageAtLeast('switches') ? null : 'sealed';
    if (st === 'security') S.setStage('aux');          // replay the CCTV moment on return
    if (st === 'chase') { this.armChase(); g.ensureKoala(); }
    if (st === 'switches') g.ensureKoala().then(() => g.ai.enable(rand(35, 55)));
    if (S.stage === 'aux' || S.stage === 'chase') this.switches.forEach(rec => this.setLamp(rec, false));
  }
}
