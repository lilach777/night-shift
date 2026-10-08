// Developer-only debug panel. Only available in dev builds (vite dev server);
// stripped from production by the import.meta.env.DEV guard in main.js.
import * as THREE from 'three';

export class Debug {
  constructor(g) {
    this.g = g;
    this.el = document.getElementById('debug');
    this.logs = [];
    this.visible = false;
    this.frames = 0; this.acc = 0; this.fps = 0;
    this.fuseMarkers = null;
    window.addEventListener('keydown', e => {
      if (e.code === 'Backquote') { this.visible = !this.visible; this.el.classList.toggle('hidden', !this.visible); if (this.visible) g.input.exitLock(); }
    });
    this.el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      e.stopPropagation();
      this.action(b.dataset.a, b.dataset.v);
    });
    window.NS = g;   // console access in dev
    // Dev-only free inspection camera: NSinspect(level, x, y, z, yaw, pitch, power)
    window.NSinspect = (lvl, x, y, z, yaw, pitch = 0, power = true) => {
      g.world.lights.setPower('all', power);
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      if (!g._origFrame) {
        g._origFrame = g.frame.bind(g);
        g.frame = function (dt) {
          if (!this._inspect) return this._origFrame(dt);
          const L = this._inspect;
          this.world.setLevelVisibility(L.lvl);
          this.world.update(dt, this.camera.position, L.lvl, 1);
          if (this.koala?.visible) this.koala.update(dt, this.camera.position, true);
          this.post.update(dt, 0);
          this.post.render(this.scene, this.camera);
        };
      }
      g._inspect = { lvl };
      g.camera.position.set(x, y, z);
      g.camera.rotation.set(pitch, yaw, 0, 'YXZ');
      return 'ok';
    };
    window.NSinspectOff = () => { g._inspect = null; };
    // Dev-only: start a run immediately (optionally skipping the intro) for automated testing.
    window.NSstart = (skip = true) => { g.startAudio(); g.newGame(); if (skip) g.intro.skip(); return g.story.stage; };
    // Dev-only: advance the simulation synchronously (rendering skipped) — for automated tests
    // while the tab is throttled. Waits on setTimeout-based UI promises between chunks.
    window.NSstep = async (seconds, dt = 1 / 30) => {
      const render = g.post.render;
      g.post.render = () => {};
      try {
        let t = 0;
        while (t < seconds) {
          for (let i = 0; i < 15 && t < seconds; i++) { g.frame(dt); g.input.endFrame(); t += dt; }
          await new Promise(r => setTimeout(r, 0));
        }
      } finally { g.post.render = render; }
      return { stage: g.story.stage, t: g.clock.time.toFixed(1) };
    };
    // Dev-only test harness: write a checkpoint for any stage and reload into it (exercises
    // the real Continue / checkpoint path), then NSboot() to start playing without input.
    window.NSload = (stage, pos, yaw = 0, flags = {}, extra = {}) => {
      const s = {
        version: 1, stage, seed: 12345, fuses: [], inserted: 4, flashlight: { has: true, battery: 100, spares: 2 },
        flags: { key: true, reachedB: true, morgueDone: true, stairScare: true, tookBatt: true, auxObjective: true, powerOn: true, ...flags },
        batteries: [], pos: { x: pos[0], y: pos[1], z: pos[2] }, yaw, deaths: 0, lives: 3, clock: null, savedAt: Date.now(), ...extra,
      };
      g.fuses.setup(12345); s.fuses = [...g.fuses.rooms];
      localStorage.setItem('nightshift.save.v1', JSON.stringify(s));
      sessionStorage.setItem('nightshift.intent', 'continue'); location.reload();
    };
    window.NSboot = async () => {
      for (let i = 0; i < 60 && g.state !== 'menu'; i++) await new Promise(r => setTimeout(r, 500));
      window.SUBS = [];
      const o = g.ui.subtitle.bind(g.ui); g.ui.subtitle = (t, w, s) => { window.SUBS.push(`${g.clock.time.toFixed(1)} [${w}] ${t}`); o(t, w, s); };
      g.input.onLockChange = () => {}; g.reloadWith = i => { window.__reload = i; };
      g.ui.clickToPlay(false); g.startAudio(); g.continueGame(); await window.NSstep(0.5, 1 / 60);
      g.ui.hideAll(); document.getElementById('click-to-play')?.classList.add('hidden'); g.state = 'play';
      await g.ensureKoala();
      return window.NShud();
    };
    window.NShud = () => {
      const q = s => document.querySelector(s), hid = s => q(s).classList.contains('hidden');
      return { stage: g.story.stage, obj: hid('#hud-objective') ? null : q('#hud-objective .text').textContent + (q('#hud-objective .count').textContent ? ' | ' + q('#hud-objective .count').textContent : ''),
        clock: hid('#hud-clock') ? null : q('#hud-clock').textContent, lives: hid('#hud-lives') ? null : q('#hud-lives b').textContent };
    };
    // Dev-only: measure average CPU+GPU frame time over n frames.
    window.NSbench = (n = 60) => {
      const gl = g.renderer.getContext();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { g.frame(1 / 60); g.input.endFrame(); }
      gl.finish();
      const ms = (performance.now() - t0) / n;
      return { msPerFrame: +ms.toFixed(2), fps: Math.round(1000 / ms), calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles };
    };
  }
  log(s) { this.logs.unshift(`${Math.round(this.g.clock.time)}s ${s}`); this.logs.length = Math.min(this.logs.length, 8); }

  action(a, v) {
    const g = this.g, L = g.layout;
    const levelY = id => L.levels.find(l => l.id === id).y;
    switch (a) {
      case 'tp': {
        const [lv, x, z] = v.split(',');
        g.player.teleport(Number(x), levelY(lv), Number(z), g.player.yaw);
        break;
      }
      case 'tpfuse': {
        const room = g.fuses.rooms.find(r => !g.fuses.collectedRooms.has(r));
        const f = L.fuseLocations.find(x => x.room === room);
        if (f) { const r = L.rooms.find(x => x.id === room); g.player.teleport(r.door.x, r.y, r.door.z + (r.side === 'N' ? 1 : -1), g.player.yaw); }
        break;
      }
      case 'fusemarks': this.toggleFuseMarkers(); break;
      case 'koala': g.ensureKoala().then(() => { g.ai.enabled = true; g.ai.end(true, 0); g.ai[`enc_${v}`]?.(g.player.level); }); break;
      case 'blackout': g.story.blackout(); break;
      case 'restore': g.world.lights.setPower('all', true); break;
      case 'phone': g.story.startCall(); break;
      case 'flash': g.flashlight.give(); g.flashlight.toggle(true); if (g.story.stage === 'reception' || g.story.stage === 'dark') g.story.setStage('basement'); break;
      case 'morgue': {
        g.flashlight.give(); g.flashlight.toggle(true);
        g.story.setStage('basement');
        const M = L.morgue; g.player.teleport(M.door.x, M.y, M.door.z - 1.5, Math.PI);
        break;
      }
      case 'allfuses': g.fuses.active = true; for (const r of [...g.fuses.rooms]) if (!g.fuses.collectedRooms.has(r)) g.fuses.collect(r); break;
      case 'final': {
        g.flashlight.give(); g.flashlight.toggle(true);
        g.story.flags.key = true;
        const pd = g.world.doorById['door_' + L.powerRoom.id]; pd.locked = null; pd.open();
        g.story.setStage('return'); g.fuses.active = true;
        for (const r of [...g.fuses.rooms]) if (!g.fuses.collectedRooms.has(r)) g.fuses.collect(r);
        const P = L.powerRoom.panel; g.player.teleport(P.x, P.y, P.z + 2.2, 0);
        break;
      }
      case 'event': g.events.trigger(v); break;
      case 'ending': g.story.act2.toEnding(); break;
      case 'god': g.godMode = !g.godMode; break;
    }
  }

  toggleFuseMarkers() {
    const g = this.g;
    if (this.fuseMarkers) { g.scene.remove(this.fuseMarkers); this.fuseMarkers = null; return; }
    this.fuseMarkers = new THREE.Group();
    for (const room of g.fuses.rooms) {
      const f = g.layout.fuseLocations.find(x => x.room === room);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6, 6), new THREE.MeshBasicMaterial({ color: 0x00ff66, depthTest: false }));
      m.position.set(f.x, f.y + 3, f.z); m.renderOrder = 99;
      this.fuseMarkers.add(m);
    }
    g.scene.add(this.fuseMarkers);
  }

  update(dt) {
    this.frames++; this.acc += dt;
    if (this.acc >= 0.5) { this.fps = Math.round(this.frames / this.acc); this.frames = 0; this.acc = 0; this.render(); }
  }

  render() {
    if (!this.visible) return;
    const g = this.g, p = g.player.pos;
    const info = g.renderer.info;
    const fuses = g.fuses.rooms.map(r => `${r}${g.fuses.collectedRooms.has(r) ? '✓' : ''}`).join(' ');
    this.el.innerHTML = `
      <b>NIGHT SHIFT DEBUG</b> (\` to toggle)<br>
      FPS ${this.fps} &middot; calls ${info.render.calls} &middot; tris ${(info.render.triangles / 1000).toFixed(0)}k<br>
      pos ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} lvl ${g.player.level}<br>
      stage <b>${g.story.stage}</b> &middot; ai <b>${g.ai?.state ?? '-'}</b> cool ${g.ai ? g.ai.cool.toFixed(0) : '-'}<br>
      seed ${g.fuses.seed} &middot; fuses ${fuses}<br>
      fear ${g.breathing.fear.toFixed(2)} &middot; batt ${g.flashlight.battery.toFixed(0)}% +${g.flashlight.spares}<br>
      <div>
        ${['B', '1', '2', '3', '4'].map(l => `<button data-a="tp" data-v="${l},0,0">TP ${l}</button>`).join('')}
        <button data-a="tp" data-v="1,-16,-2">TP RECEPTION</button><button data-a="tpfuse">TP FUSE</button><button data-a="fusemarks">FUSE MARKERS</button>
      </div>
      <div>
        <button data-a="phone">PHONE CALL</button><button data-a="blackout">BLACKOUT</button><button data-a="restore">RESTORE POWER</button>
        <button data-a="flash">GIVE FLASHLIGHT</button><button data-a="morgue">MORGUE SEQ</button><button data-a="allfuses">ALL FUSES</button><button data-a="final">FINAL SEQ</button><button data-a="god">GOD ${g.godMode ? 'ON' : 'OFF'}</button>
      </div>
      <div>SPAWN: ${['corridor', 'behind', 'doorway', 'crawl', 'chase'].map(t => `<button data-a="koala" data-v="${t}">${t}</button>`).join('')}</div>
      <div>EVENT: ${Object.keys(g.events.EVENTS).map(t => `<button data-a="event" data-v="${t}">${t}</button>`).join('')}</div>
      <div style="color:#9c9">${this.logs.join('<br>')}</div>`;
  }
}
