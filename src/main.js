// NIGHT SHIFT — main game orchestrator.
import * as THREE from 'three';
import layout from './data/layout.json';
import { settings } from './core/settings.js';
import { save } from './core/save.js';
import { Input } from './core/input.js';
import { Post } from './core/post.js';
import { clock, rand, seededRandom, shuffle } from './core/util.js';
import { World, loadGLB } from './world/world.js';
import { Player } from './player/player.js';
import { Flashlight } from './player/flashlight.js';
import { audio } from './audio/audio.js';
import { CRITICAL } from './audio/manifest.js';
import { music, breathing } from './audio/music.js';
import { UI } from './ui/ui.js';
import { Interactions } from './systems/interact.js';
import { Containers } from './world/containers.js';
import { Hiding } from './systems/hiding.js';
import { Fuses } from './systems/fuses.js';
import { Story } from './systems/story.js';
import { Progress } from './systems/progress.js';
import { Soundscape } from './audio/soundscape.js';
import { HorrorEvents } from './systems/events.js';
import { IntroCinematic } from './systems/cinematic.js';
import { CamTrack, loadCamTrack } from './systems/camtrack.js';
import { Nav } from './monster/nav.js';
import { Koala } from './monster/koala.js';
import { KoalaAI } from './monster/ai.js';
import { MPMode } from './mp/mode.js';
import { LobbyMirror } from './world/mirror.js';
import { buildPhotoWall, NIGHT_STAFF } from './systems/photos.js';
import { WalletUI } from './web3/ui.js';
import { wallet } from './web3/wallet.js';
import { reusableEntry, markUsed } from './web3/entry.js';
import { shortAddr } from './web3/chain.js';

const QUALITY = {
  low: { lightPool: 3, shadows: false, shadowSize: 512, rainCount: 4000, maxPR: 1.0 },
  medium: { lightPool: 4, shadows: true, shadowSize: 512, rainCount: 7000, maxPR: 1.25 },
  high: { lightPool: 6, shadows: true, shadowSize: 1024, rainCount: 10000, maxPR: 1.5 },
};
const INTENT_KEY = 'nightshift.intent';

class Game {
  constructor() {
    this.state = 'loading';
    this.layout = layout;
    this.clock = clock;
    this.music = music;
    this.breathing = breathing;
    this.godMode = false;
    this.koala = null;
    this.debug = null;
  }

  // ------------------------------------------------------------------ boot
  async boot() {
    this.ui = new UI();
    const canvas = document.getElementById('game');
    if (!this.webglOK(canvas)) {
      this.ui.bootError('Your browser or GPU does not support WebGL 2, which NIGHT SHIFT needs.<br>Please use an up-to-date Chrome, Edge or Firefox with hardware acceleration enabled.');
      return;
    }
    const gs = settings.data.graphics;
    this.quality = { ...QUALITY[gs.quality] || QUALITY.high };
    if (!gs.shadows) this.quality.shadows = false;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: gs.quality !== 'low', powerPreference: 'high-performance', stencil: false });
    } catch (e) {
      this.ui.bootError('Could not create a WebGL context: ' + (e.message || e));
      return;
    }
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.15;
    r.shadowMap.enabled = this.quality.shadows;
    r.shadowMap.type = THREE.PCFShadowMap;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.ui.bootError('The graphics context was lost. Please reload the page.'); this.state = 'error'; });

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x010203);
    this.fogColor = new THREE.Color(0x020304);
    this.scene.fog = new THREE.FogExp2(this.fogColor, 0.05);
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 80);
    this.scene.add(this.camera);
    this.input = new Input(canvas);
    this.post = new Post(r, this.scene, this.camera);
    this.applyGraphics();
    window.addEventListener('resize', () => this.applyGraphics());
    settings.onChange((sec, key) => { if (sec === 'graphics' || sec === '*') this.applyGraphics(key); });

    // ---- load critical assets (hospital + items). Koala/audio stream in later.
    this.ui.setLoading(0.02, 'Loading...');
    this.world = new World(this.scene, r, layout, this.quality);
    try {
      await this.world.load(p => this.ui.setLoading(0.05 + p * 0.85));
    } catch (e) {
      console.error(e);
      this.ui.bootError('Failed to load the hospital. Check your connection and reload.<br><small>' + e.message + '</small>');
      return;
    }
    this.ui.setLoading(0.92, 'Preparing the night shift...');
    const intent = this.consumeIntent();
    this.mode = intent === 'mp' ? 'mp' : 'sp';
    this.physics = this.world.physics;
    this.nav = new Nav(layout);
    this.player = new Player(this.camera, this.physics, this.input);
    // footsteps are noise the Koala can hear (sprinting carries far, crouching barely)
    this.player.onStep = (run, crouch) => this.ai.noise?.(this.player.pos, run ? 16 : crouch ? 2.5 : 6.5);
    this.flashlight = new Flashlight(this.camera, this.scene, this.world.item('flashlight'), this.quality);
    this.interact = new Interactions(this.camera, this.physics);
    this.containers = new Containers(this);
    this.hiding = new Hiding(this);
    this.fuses = new Fuses(this);
    if (this.mode === 'mp') {
      // MULTIPLAYER: the single-player story, objectives and horror events are NOT created.
      // Shared systems get inert stand-ins; the multiplayer mode drives everything (src/mp/).
      const g = this;
      this.story = {
        stage: 'mp', flags: {}, hideHud: false,
        get readingOpen() { return !!g.mp?.session?.story.readingOpen; },
        stageAtLeast: () => true, update() {}, setupStatic() {}, canUsePanel: () => false, onFuseCollected() {}, onFuseInserted() {},
      };
      this.progress = { update() {}, minutes: 0 };
      this.events = { update() {}, enabled: false, trigger() {}, EVENTS: {} };
    } else {
      this.story = new Story(this);
      this.progress = new Progress(this);
      this.events = new HorrorEvents(this);
    }
    this.soundscape = new Soundscape(this);
    this.lives = 3;
    this.monitorGlow = new THREE.PointLight(0x4dff88, 0, 3.5, 2); this.scene.add(this.monitorGlow);
    this.carLight = new THREE.SpotLight(0xfff3d6, 0, 45, 0.45, 0.5, 1.4); this.scene.add(this.carLight, this.carLight.target);
    this.world.setLevelVisibility('2');
    this.story.setupStatic();
    // the basement photo wall (both modes): the night staff who never signed out, and one empty place
    buildPhotoWall(this.world.levels.B || this.scene, layout, this.mode === 'mp'
      ? { featured: NIGHT_STAFF.map(f => ({ ...f, role: 'NIGHT CREW' })), blankLabel: 'NIGHT CREW\n— — —' }
      : { featured: NIGHT_STAFF.map(f => ({ ...f, role: 'NIGHT SHIFT' })), blankLabel: 'NIGHT SHIFT\n— — —' });
    this.setupReflection();
    this._listen = new THREE.Object3D();          // where the ears are (the player), even when the view is a CCTV camera
    this.battery = [];
    audio.occluder = (a, b) => this.physics.los(a, b);
    this.ai = { enabled: false, state: 'hidden', enc: null, update() {}, enable() {}, disable() {}, end() {}, inView: () => false, canSee: () => false, koalaSeesPlayer: () => false, isChasing: () => false, noise() {}, onEnterRoom() {}, cool: 0 };

    // Precompile shaders to avoid hitches on first view.
    try { r.compile(this.scene, this.camera); } catch { /* ignore */ }
    this.ui.setLoading(1, '');

    if (import.meta.env.DEV) {
      const { Debug } = await import('./debug.js');
      this.debug = new Debug(this);
    }

    // the wallet / entry layer (both modes): panels on the menus, event-driven state, no RPC polling
    this.web3 = new WalletUI(this);
    this.web3.attachPanel(document.querySelector('#menu .menu-inner'));
    this.web3.attachPanel(document.querySelector('#mp-menu .menu-inner'));
    this.web3.attachPanel(document.querySelector('#mp-join .menu-inner'), { compact: true });
    this.bindUI();
    if (this.mode === 'mp') { this.mp = new MPMode(this); this.startHiddenTicker(); }
    this.last = performance.now();
    requestAnimationFrame(t => this.loop(t));

    // Lazy-load the Koala in the background so the menu appears fast.
    this.ensureKoala().catch(e => console.warn('[koala] load failed', e));

    if (this.mode === 'mp') this.toMenu();
    else if (intent === 'continue' && save.exists()) {
      this.toMenu(true);
      this.ui.clickToPlay(true, () => { this.ui.clickToPlay(false); this.startAudio(); this.continueGame(); });
    } else if (intent === 'new') {
      this.toMenu(true);
      this.ui.clickToPlay(true, () => { this.ui.clickToPlay(false); this.startAudio(); this.newGame(); });
    } else this.toMenu();
  }

  webglOK(canvas) {
    try { return !!(window.WebGL2RenderingContext && document.createElement('canvas').getContext('webgl2')); } catch { return false; }
  }

  // Multiplayer: a browser stops animation frames in a background tab. A host that alt-tabs would freeze
  // the night for everybody (and a client would stop sending its pose). A tiny worker clock keeps the
  // simulation and the network ticking at 20 Hz while the tab is hidden (no rendering).
  startHiddenTicker() {
    try {
      const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 50);'], { type: 'text/javascript' }));
      this.ticker = new Worker(url);
      this.ticker.onmessage = () => {
        if (!document.hidden || this.state === 'loading' || this.state === 'error') return;
        const now = performance.now(), dt = Math.min(0.05, (now - this.last) / 1000);
        this.last = now;
        this.skipRender = true;
        try { this.frame(dt); } catch (e) { console.error('[frame/hidden]', e); }
        this.skipRender = false;
        this.input.endFrame();
      };
    } catch (e) { console.warn('[mp] background ticker unavailable', e); }
  }

  consumeIntent() {
    try { const v = sessionStorage.getItem(INTENT_KEY); sessionStorage.removeItem(INTENT_KEY); return v; } catch { return null; }
  }
  reloadWith(intent) {
    console.info('[game] reload ->', intent);
    try { sessionStorage.setItem(INTENT_KEY, intent); } catch { /* ignore */ }
    location.reload();
  }

  applyGraphics(key) {
    const gs = settings.data.graphics;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.maxPR) * gs.resolutionScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.post.setSize(innerWidth, innerHeight, pr);
    this.post.enabled = gs.effects;
    this.viewDist = gs.viewDistance;
    this.camera.far = gs.viewDistance + 25;
    this.camera.updateProjectionMatrix();
    if (!this.morning) this.scene.fog.density = 2.3 / gs.viewDistance;
    if (key === 'quality' || key === 'shadows') this.pendingReload = true;
  }

  async ensureKoala() {
    if (this.koala) return this.koala;
    if (!this._koalaP) {
      this._koalaP = loadGLB('assets/models/koala.glb').then(gltf => {
        this.koala = new Koala(gltf, this.scene);
        // multiplayer: the host's group hunter (src/mp/hunter.js) drives the Koala; no single-player AI
        if (this.mode === 'mp') this.ai = { ...this.ai, isChasing: () => !!this.mp?.session?.story.runWarning(), canSee: () => false };
        else this.ai = new KoalaAI(this);
        this.player.bodies.push(() => (this.koala.visible && !this.dying ? this.koala.position : null));
        return this.koala;
      });
    }
    return this._koalaP;
  }

  startAudio() {
    if (!audio.init()) return;
    if (!this._audioStarted) {
      this._audioStarted = true;
      audio.preload(CRITICAL).then(() => audio.preloadAll());
    }
  }

  // ------------------------------------------------------------------ UI wiring
  bindUI() {
    const ui = this.ui;
    // NEW GAME = wallet + Hemi + a confirmed entry transaction. CONTINUE = wallet + Hemi, never a fee.
    ui.on('new', async () => {
      this.startAudio();
      if (!this.web3.requireReady()) return;
      const entry = await this.web3.confirmEntry('sp');
      if (!entry) return;                                         // cancelled / failed: the game does not start
      if (this.sessionStarted) return this.reloadWith('new');     // the confirmed entry is used after the reload
      this.newGame();
    });
    ui.on('continue', () => {
      this.startAudio();
      if (!save.exists()) return;
      if (!this.web3.requireReady()) return;
      if (!this.saveOwnedByWallet()) return;
      if (this.sessionStarted) return this.reloadWith('continue');
      this.continueGame();
    });
    ui.on('wallet', () => { this.startAudio(); this.web3.toggleConnection(); });
    ui.on('resume', () => this.resume());
    ui.on('restart', () => this.reloadWith(save.exists() ? 'continue' : 'new'));
    ui.on('mainmenu', () => (this.mode === 'mp' ? this.mp.exitToMenu() : this.reloadWith('menu')));
    ui.on('multiplayer', () => { this.startAudio(); if (!this.web3.requireReady()) return; this.reloadWith('mp'); });
    // Game over -> RETRY: back to the latest checkpoint with three fresh lives
    ui.on('retry', () => { const s = save.load(); if (s) { s.lives = 3; s.justDied = false; save.write(s); this.reloadWith('continue'); } else this.reloadWith('new'); });
    ui.onSettingsClosed = () => {
      if (this.pendingReload) {
        this.pendingReload = false;
        if (this.state === 'menu') this.reloadWith('menu');
        else ui.toast('Quality & shadow changes apply after restart', 3.5);
      }
    };
    // Any click on the menu wakes audio (browser autoplay policy) and starts the menu ambience.
    document.addEventListener('pointerdown', () => {
      if (this.state === 'menu') { this.startAudio(); this.menuAmbience(); }
    });
    // ESC normally releases pointer lock (-> pause). When the browser refused pointer
    // lock (drag-to-look fallback), handle ESC ourselves.
    window.addEventListener('keydown', e => {
      if (e.code !== 'Escape') return;
      if (this.state === 'lockpaused') { this.ui.clickToPlay(false); this.state = 'play'; this.pause(); }
      else if (this.state === 'play' && !this.input.locked) this.pause();
      else if (this.state === 'paused' && ui.current === 'settings') ui.back();
      else if (this.state === 'paused' && ui.current === 'pause' && this._pausedAt && performance.now() - this._pausedAt > 400) this.resume();
    });
    // Losing pointer lock (ESC / focus change) shows a small "CLICK TO RESUME" prompt;
    // one click re-acquires the lock. Gameplay is paused meanwhile.
    this.input.onLockChange = locked => {
      if (locked) { this.ui.clickToPlay(false); if (this.state === 'lockpaused') { this.state = 'play'; audio.pauseAll(false); this.last = performance.now(); } return; }
      if (this.state === 'play') this.pause();       // ESC / focus loss -> pause menu
    };
    document.getElementById('game').addEventListener('click', () => {
      if (this.state === 'play' && !this.input.locked) this.input.requestLock();
    });
    this.refreshMenu();
  }

  refreshMenu() {
    document.getElementById('btn-continue').disabled = !save.exists();
  }

  menuAmbience() {
    if (this.menuAmb || !audio.ready) return;
    this.menuAmb = [
      audio.play('rain_inside', { bus: 'ambience', loop: true, volume: 1.0, fadeIn: 2 }),
      audio.play('menu_drone', { bus: 'ambience', loop: true, volume: 0.35, fadeIn: 4 }),
    ];
    music.start();
  }
  stopMenuAmbience() { if (this.menuAmb) { this.menuAmb.forEach(h => h.stop(1.5)); this.menuAmb = null; } }

  toMenu(silent = false) {
    this.state = 'menu';
    this.ui.show(this.mode === 'mp' ? 'mp-menu' : 'menu');
    this.ui.hud(false);
    this.refreshMenu();
    this.input.enabled = false;
    // menu backdrop: dark Floor 2 corridor, lightning through the west window
    this.world.lights.setPower('all', false);
    // the failing tube hangs between the camera's dolly path and the far (dark) end of the corridor
    const f = this.world.lights.fixtures.filter(x => x.level === '2' && x.room === 'corridor').sort((a, b) => Math.abs(a.x + 4) - Math.abs(b.x + 4))[0];
    if (f) { f.state = 'flicker'; this.menuFixture = f; f.forced = null; this.world.lights.power['2'] = false; }
    this.menuT = 0;
    this.world.lightning.next = 2;
    this._mf = 1.5; this._mfState = 'on';
    this.ensureKoala().catch(() => {});
    if (!this.menuTrack) loadCamTrack('menu').then(d => { if (d) this.menuTrack = new CamTrack(d); });
  }

  // Title-screen fixture: a failing tube that is mostly ON, with stutters and the odd long
  // blackout. During a long blackout the Koala may be standing at the far end of the corridor -
  // lit only by the lightning - and is gone when the tube catches again.
  updateMenuFixture(dt) {
    const f = this.menuFixture;
    this._mf -= dt;
    if (this._mfStutter > 0) {                       // rapid stutter burst
      this._mfStutter -= dt;
      f.forced = Math.random() < 0.5 ? 0 : rand(0.25, 0.8);
      if (this._mfStutter <= 0) { f.forced = 0.85; this._mf = rand(4, 9); }
      return;
    }
    if (this._mf > 0) return;
    if (this._mfState === 'dark') {                  // the tube catches again
      this._mfState = 'on'; this._mfStutter = rand(0.25, 0.6);
      if (this.koala?.visible && this.menuKoala) { this.koala.hide(); this.menuKoala = false; }
      return;
    }
    const r = Math.random();
    if (r < 0.62) { this._mfStutter = rand(0.12, 0.45); }
    else {
      this._mfState = 'dark'; f.forced = 0; this._mf = rand(1.6, 3.2);
      if (this.koala && !this.koala.visible && Math.random() < 0.45 && this.menuT > 12) {
        this.koala.show(new THREE.Vector3(-10.5, 4, rand(-0.4, 0.4)), Math.PI / 2, 'observe');
        this.koala.lookTarget = this.camera.position; this.menuKoala = true;
        this.world.lightning.next = Math.min(this.world.lightning.next, rand(0.4, 1.0));   // let the storm reveal it
      }
    }
  }

  // ------------------------------------------------------------------ game flow
  beginSession() {
    this.sessionStarted = true;
    this.stopMenuAmbience();
    music.stop();
    this.ui.hideAll();
    this.input.enabled = true;
    if (this.menuFixture) { this.menuFixture.forced = null; this.menuFixture = null; }
    if (this.menuKoala) { this.koala?.hide(); this.menuKoala = false; }
    if (this.camera.fov !== 72) { this.camera.fov = 72; this.camera.updateProjectionMatrix(); }
    this.ambience = {
      rainIn: audio.play('rain_inside', { bus: 'ambience', loop: true, volume: 0.9, fadeIn: 3 }),
      rainOut: audio.play('rain_outside', { bus: 'ambience', loop: true, volume: 0.33, lowpass: 900, fadeIn: 3 }),
      basement: audio.play('basement_air', { bus: 'ambience', loop: true, volume: 0, fadeIn: 3 }),
      wind: audio.play('wind', { bus: 'ambience', loop: true, volume: 0.15, fadeIn: 3 }),
    };
    breathing.start();
  }

  newGame() {
    // the confirmed, unused entry for this wallet is spent here (paid on the menu, or before a reload)
    const entry = wallet.ready ? reusableEntry('sp') : null;
    if (!entry) { this.toMenu(); this.web3.requireReady() && this.ui.toast('NEW GAME NEEDS A CONFIRMED ENTRY', 3); return; }
    markUsed(entry, { started: 'single-player' });
    this.walletAtStart = wallet.address.toLowerCase();
    save.clear();
    this.lives = 3;
    this.input.requestLock();     // one click: START GAME -> pointer lock for the whole session
    this.beginSession();
    this.seed = Math.floor(Math.random() * 1e9);
    const qs = new URLSearchParams(location.search);
    if (import.meta.env.DEV && qs.get('seed')) this.seed = Number(qs.get('seed'));
    this.fuses.setup(this.seed);
    this.setupBatteries([]);
    this.story.stage = 'intro';
    this.world.lights.setPower('all', false);
    this.world.lights.setPower('1', true);
    this.state = 'intro';
    this.intro = new IntroCinematic(this);
    this.intro.onDone = () => {
      this.state = 'play';
      this.ui.hud(true);
      this.story.startReception();
      this.input.requestLock();
      this.ui.clickToPlay(!this.input.locked, () => { this.ui.clickToPlay(false); this.input.requestLock(); });
    };
    this.intro.start();
    // park the car where it ends up (it stays there all night)
  }

  // wallet events while playing: the run continues (gameplay never depends on the chain after entry),
  // and progress stays with the wallet that started it - another account is never silently attached
  onWalletAccountChanged() {
    if (this.state === 'menu') return;
    if (this.mode === 'mp') this.mp?.onWalletChanged();
    this.ui.toast(this.walletAtStart ? `WALLET CHANGED - THIS RUN STAYS WITH ${shortAddr(this.walletAtStart)}` : 'WALLET CHANGED', 3.5);
  }
  onWalletDisconnected() { if (this.state !== 'menu') this.ui.toast('WALLET DISCONNECTED - RECONNECT FROM THE MENU', 3.5); if (this.mode === 'mp') this.mp?.onWalletChanged(); }
  onWalletWrongNetwork() { if (this.state !== 'menu') this.ui.toast('WALLET LEFT HEMI TESTNET - THE GAME CONTINUES', 3); }

  // a save belongs to the wallet that started that run; never load someone else's progress
  saveOwnedByWallet() {
    const s = save.load(); if (!s) return true;
    if (s.wallet && wallet.address && s.wallet !== wallet.address.toLowerCase()) {
      this.web3.openGate('This save belongs to another wallet.\n' + shortAddr(s.wallet), null, null);
      return false;
    }
    return true;
  }

  continueGame() {
    const s = save.load();
    if (!s) return this.toMenu();
    if (!wallet.ready) { this.toMenu(); this.web3.requireReady(); return; }
    if (!this.saveOwnedByWallet()) { this.toMenu(); return; }
    // a run saved before wallets existed is adopted by the wallet that continues it (written at the next checkpoint)
    this.walletAtStart = s.wallet || wallet.address.toLowerCase();
    this.input.requestLock();
    this.beginSession();
    this.seed = s.seed;
    this.fuses.setup(s.seed, s.fuses || [], s.inserted || 0);
    this.setupBatteries(s.batteries || []);
    this.deaths = s.deaths || 0;
    this.lives = s.lives ?? 3;
    if (s.clock != null) this.progress.minutes = s.clock;
    const car = this.world.item('car');
    const end = layout.exterior.carPath.at(-1);
    car.position.set(end[0], 0, end[1]); car.rotation.y = Math.PI * 0.55;
    this.scene.add(car); this.parkedCar = car;
    this.story.applySave(s);
    const p = s.pos || layout.exterior.playerStart;
    this.player.teleport(p.x, p.y, p.z, s.yaw ?? -Math.PI / 2);
    this.state = 'play';
    this.ui.hud(true);
    if (this.story.stageAtLeast('powerroom') && s.flags?.morgueDone) this.ensureKoala();
    if (s.justDied) {
      this.ui.toast(`LIVES: ${this.lives}`, 3.5);
      s.justDied = false; save.write(s);
    } else this.ui.thought('(Where was I...)', 3.5);
    this.input.requestLock();
    this.ui.clickToPlay(!this.input.locked, () => { this.ui.clickToPlay(false); this.input.requestLock(); });
  }

  setupBatteries(taken) {
    const rnd = seededRandom((this.seed || 1) + 77);
    const spots = shuffle(layout.batterySpots, rnd).slice(0, 8);
    this.batteryTaken = new Set(taken);
    spots.forEach((s, i) => {
      const id = `${s.room}_${i}`;
      if (this.batteryTaken.has(id)) return;
      const m = this.world.item('battery');
      m.position.set(s.x, s.y, s.z); m.rotation.y = rnd() * 3;
      this.scene.add(m);
      this.interact.add({
        id: 'batt_' + id, pos: new THREE.Vector3(s.x, s.y + 0.03, s.z), radius: 1.9, cone: 0.35,
        enabled: () => this.flashlight.has,
        prompt: () => '[E] Take Batteries',
        action: () => {
          this.scene.remove(m); this.interact.remove('batt_' + id); this.batteryTaken.add(id);
          this.flashlight.addSpare(1);
          audio.play('pickup', { bus: 'player', volume: 0.7 });
          this.ui.toast('BATTERY  +1');
        },
      });
    });
  }

  // Checkpoint = the full progress (story stage, flags, fuses, switches, items, clock, lives)
  // plus a SAFE respawn position. Never written during the final sequence.
  saveCheckpoint(extra = {}) {
    if (this.story.stageAtLeast('containment')) return;
    if (this.dying) return;
    const p = extra.pos || this.player.pos;
    save.write({
      wallet: this.walletAtStart || null,
      stage: extra.stage || this.story.stage,
      seed: this.seed,
      fuses: [...this.fuses.collectedRooms],
      inserted: this.fuses.inserted,
      flashlight: { has: this.flashlight.has, battery: Math.max(25, this.flashlight.battery), spares: this.flashlight.spares },
      flags: { ...this.story.flags },
      batteries: [...(this.batteryTaken || [])],
      pos: { x: p.x, y: p.y, z: p.z },
      yaw: extra.yaw ?? this.player.yaw,
      deaths: this.deaths || 0,
      lives: this.lives ?? 3,
      clock: this.progress?.minutes ?? null,
    });
    if (this.debug) this.debug.log(`checkpoint: ${extra.stage || this.story.stage}`);
  }

  onFuseCollected(room) { this.story.onFuseCollected(room); }
  onFuseInserted(n) { this.story.onFuseInserted(n); }

  pause() {
    if (this.state !== 'play' || this.dying) return;
    if (this.mode === 'mp') { this.input.exitLock?.(); this.ui.setPrompt(null); this.mpPaused = true; this.ui.show('pause'); document.querySelector('#pause [data-action=restart]').style.display = 'none'; return; }
    this.input.exitLock?.();
    this.ui.clickToPlay(false);
    this.ui.setPrompt(null);
    this.state = 'paused';
    this._pausedAt = performance.now();
    this.ui.show('pause');
    audio.pauseAll(true);
  }
  resume() {
    if (this.mode === 'mp' && this.mpPaused) { this.mpPaused = false; this.ui.hideAll(); this.input.requestLock(); return; }
    if (this.state !== 'paused') return;
    this.ui.hideAll();
    this.state = 'play';
    audio.pauseAll(false);
    this.input.requestLock();
    this.last = performance.now();
    // the browser may refuse an immediate re-lock (e.g. right after ESC): one click fixes it
    setTimeout(() => {
      if (this.state === 'play' && !this.input.locked) {
        this.state = 'lockpaused'; audio.pauseAll(true);
        this.ui.clickToPlay(true, () => { this.ui.clickToPlay(false); this.input.requestLock(); });
        document.querySelector('#click-to-play div').textContent = 'CLICK TO RESUME';
      }
    }, 350);
  }

  // The Koala caught the player: jumpscare -> checkpoint.
  caught() {
    if (this.dying) return;
    if (this.godMode) { this.ai.vanish(); return; }
    this.dying = true;
    const k = this.koala, cam = this.camera, p = this.player;
    p.canMove = false; p.canLook = false;
    const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const at = p.pos.clone().addScaledVector(fwd, 1.75);
    if (!k.visible) k.show(at, 0, 'jumpscare');
    k.position.copy(at);
    k.faceTowards(p.pos);
    k.lookTarget = cam.position;
    k.play('jumpscare', { fade: 0.02, vary: false });
    p.lookOverride = { yaw: p.yaw, pitch: 0.06, speed: 10 };
    this.flashlight.toggle(true);
    audio.play('jumpscare_hit', { bus: 'monster', volume: 1 });
    k.vocal('koala_scream', 1);
    p.shake(1.4, 1.2);
    this.post.pulse(1.2, 1.0);
    this.flashlight.flicker(1.2, 0.8);
    breathing.scare(1);
    this.deaths = (this.deaths || 0) + 1;
    this.lives = Math.max(0, (this.lives ?? 3) - 1);
    setTimeout(() => {
      this.ui.fadeInstant(1);
      audio.stopAll(0.1, ['ui']);
      // progress is kept: only the life counter changes; we go back to the latest checkpoint
      const s = save.load();
      if (s) { s.deaths = this.deaths; s.lives = this.lives; s.justDied = true; save.write(s); }
      if (this.lives > 0) {
        this.ui.timecard(`LIVES: ${this.lives}`, 1.2);
        setTimeout(() => this.reloadWith('continue'), 2200);
      } else {
        // third death: GAME OVER -> RETRY (last checkpoint, 3 lives) or MAIN MENU
        setTimeout(() => {
          this.state = 'gameover';
          this.input.exitLock();
          this.ui.hud(false);
          this.ui.show('gameover');
          this.ui.fade(0.6, 1);
          audio.play('stinger_hit', { bus: 'ui', volume: 0.5 });
        }, 900);
      }
    }, 1150);
  }

  // ------------------------------------------------------------------ ending helpers
  setMorning() {
    this.morning = true;
    const w = this.world;
    w.lightning.enabled = false;
    w.rain.mesh.visible = false;
    for (const h of Object.values(this.ambience || {})) h.stop(2);
    w.lights.setPower('all', false);
    w.lights.daylight = 1.1;
    w.lights.sky.color.setHex(0xfff0dc);
    w.lights.sky.position.set(-60, 25, 8);
    w.lights.sky.intensity = 2.2;
    this.fogColor.setHex(0x9ea6ac);
    this.scene.fog.color.copy(this.fogColor);
    this.scene.fog.density = 0.06;
    this.scene.background = new THREE.Color(0x9ea6ac);
    this.renderer.toneMappingExposure = 1.0;
    this.post.baseDesat = 0.45;
    w.glassMat.opacity = 0.25;
    if (this.parkedCar) { this.scene.remove(this.parkedCar); this.parkedCar = null; }
    this.koala?.hide();
  }

  // The lobby mirror (north wall, facing the reception desk). A real reflection pass; the player's own
  // body exists only on layer 1 for it. Multiplayer: the crew member's own avatar (session) is that body.
  setupReflection() {
    this.mirror = new LobbyMirror(this.scene, { x: -17.6, y: 1.5, z: 8.84, ry: Math.PI, w: 1.0, h: 1.6 }, settings.data.graphics.quality);
    if (this.mode !== 'sp') return;
    const dbl = this.world.item('arman');
    dbl.traverse(o => o.layers.set(1));
    this.scene.add(dbl);
    this.reflection = { dbl, hist: [], lag: 0, lagDone: false };
  }

  updateReflection(dt) {
    if (!this.mirror) return;
    this.mirror.update(this.camera, !this._camOverride);
    const R = this.reflection; if (!R) return;
    const p = this.player, now = this.clock.time;
    R.hist.push({ t: now, x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, v: Math.hypot(p.vel.x, p.vel.z) });
    while (R.hist.length > 2 && now - R.hist[0].t > 1.5) R.hist.shift();
    // once, after the lights went out: from across the lobby, the reflection is half a second behind him
    if (!R.lagDone && this.mirror.glass.visible && this.story.stageAtLeast?.('dark') && !this.story.stageAtLeast?.('containment')) {
      const d = this.camera.position.distanceTo(this.mirror.center);
      if (d > 2.6 && d < 9 && this.flashlight.on) { R.lagDone = true; R.lag = 4.5; }
    }
    R.lag = Math.max(0, R.lag - dt);
    const pose = R.lag > 0 ? (R.hist.find(h => h.t >= now - 0.5) || R.hist[0]) : R.hist[R.hist.length - 1];
    R.dbl.position.set(pose.x, pose.y, pose.z);
    R.dbl.rotation.set(0, pose.yaw + Math.PI, 0);
    R.dbl.userData.gait?.(pose.v);                    // it walks when he walks
    R.dbl.visible = !p.seated;
  }

  endGame() {
    this.state = 'ending';
    this.input.exitLock();
    this.ui.hud(false);
    save.clear();
    this.ui.ending(true);
    setTimeout(() => {
      this.ui.clickToPlay(true, () => this.reloadWith('menu'));
      document.querySelector('#click-to-play div').textContent = 'RETURN TO MENU';
    }, 7000);
  }

  // Which acoustic space is the listener in? (drives the reverb crossfade)
  updateAcousticSpace() {
    const c = (this.state === 'play' && this._listen ? this._listen : this.camera).position, B = layout.bounds;
    let w;
    if (c.x < B.x0 - 0.2 || c.x > B.x1 || c.z < B.z0 || c.z > B.z1) w = { outside: 1 };
    else if (this.physics.levelOf(c.y - 1.2) === 'B' || this.physics.inStairwell(c)) w = { concrete: 1 };
    else if (Math.abs(c.z) < 1.55) w = { corridor: 1 };
    else if (c.x < -10 && this.physics.levelOf(c.y - 1.2) === '1') w = { corridor: 0.6, room: 0.4 };   // the big lobby
    else w = { room: 1 };
    const key = JSON.stringify(w);
    if (key !== this._spaceKey) { this._spaceKey = key; audio.setSpace(w); }
  }

  // ------------------------------------------------------------------ loop
  loop(now) {
    requestAnimationFrame(t => this.loop(t));
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.state === 'error' || this.state === 'loading') return;
    try { this.frame(dt); } catch (e) { console.error('[frame]', e); }
    this.input.endFrame();
  }

  frame(dt) {
    const s = this.state;
    const flashScale = 0.1 + 0.9 * settings.data.accessibility.flashIntensity;
    if (s === 'menu') {
      this.menuT += dt;
      const t = this.menuT;
      // Blender-authored 40 s camera loop (ns_camera.build_menu); procedural drift as fallback
      if (!(this.menuTrack && this.menuTrack.apply(this.camera, t % this.menuTrack.end))) {
        this.camera.position.set(-3 + Math.sin(t * 0.05) * 1.2, 4 + 1.6 + Math.sin(t * 0.4) * 0.02, Math.sin(t * 0.07) * 0.25);
        this.camera.rotation.set(-0.02 + Math.sin(t * 0.13) * 0.015, Math.PI / 2 + Math.sin(t * 0.09) * 0.06, 0, 'YXZ');
      }
      if (this.menuFixture) this.updateMenuFixture(dt);
      if (this.mode === 'mp') this.mp?.lobbyTick(dt);
      if (this.menuKoala && this.koala?.visible) this.koala.update(dt, this.camera.position, true);
      this.world.setLevelVisibility('2');
      this.world.update(dt, this.camera.position, '2', flashScale);
      music.update(dt);
      this.post.update(dt, 0);
      audio.setListener(this.camera);
      if (!this.skipRender) this.post.render(this.scene, this.camera);
      this.ui.update(dt);
      return;
    }
    if (s === 'paused' || s === 'ending' || s === 'lockpaused' || s === 'gameover') {
      this.post.render(this.scene, this.camera);
      return;
    }
    // play / intro
    clock.update(dt);
    if (s === 'intro') {
      this.intro.update(dt);
      this.world.setLevelVisibility('1', this.camera.position);
      this.world.update(dt, this.camera.position, '1', flashScale);
      if (!this.intro.done && this.intro.t > 15 && !this.parkedCar) { this.parkedCar = this.intro.car; }
    } else {
      // player
      if (this.dying) this.player.update(dt);
      else this.player.update(dt);
      if (!this.dying && !this.mpPaused) {
        if (this.input.wasPressed('KeyF')) this.flashlight.toggle();
        if (this.input.wasPressed('KeyR')) this.flashlight.replaceBattery();
      }
      // the ears stay with the player; the view may belong to a security camera or a spectated teammate
      this._listen.position.copy(this.camera.position); this._listen.quaternion.copy(this.camera.quaternion); this._listen.updateMatrixWorld();
      this.listenerPos = this._listen.position;
      const ov = this.mode === 'mp' ? this.mp.session?.cameraOverride() : null;
      this._camOverride = !!ov;
      if (ov) {
        this.camera.position.copy(ov.pos); this.camera.quaternion.copy(ov.quat);
        if (this.camera.fov !== ov.fov) { this.camera.fov = ov.fov; this.camera.updateProjectionMatrix(); }
        this.camera.updateMatrixWorld();
      } else if (this.mode === 'mp' && this.camera.fov !== 72) { this.camera.fov = 72; this.camera.updateProjectionMatrix(); }
      this.flashlight.suppressed = !!ov?.cctv;
      this.flashlight.update(dt, this.player);
      const viewLevel = ov ? ov.level : this.player.level;
      this.world.setLevelVisibility(viewLevel, this.camera.position);
      this.world.update(dt, this.camera.position, viewLevel, flashScale);
      this.interact.enabled = !this.story.readingOpen && !this.dying && this.player.canMove && !ov && !(this.mode === 'mp' && (this.mpPaused || this.mp.session?.me?.life !== 'alive'));
      this.interact.update(this.ui, this.input);
      if (!this.mpPaused) this.hiding.update();
      this.containers.update(dt);
      this.story.update(dt);
      this.events.update(dt);
      this.ai.update(dt);
      if (this.mode === 'mp') this.mp.update(dt);
      this.updateReflection(dt);
      // ambience: rain louder near windows, muffled in the basement
      if (this.ambience?.rainIn) {
        const b = this.player.level === 'B';
        const out = this.player.surfaceType() === 'outside';
        this.ambience.rainIn.setVolume(b ? 0.16 : out ? 0.25 : 0.9, 1.5);
        this.ambience.basement?.setVolume(b ? 0.55 : 0, 2.5);
        this.ambience.rainIn.setLowpass?.(b ? 500 : 20000, 1.5);
        this.ambience.rainOut.setVolume(b ? 0.05 : out ? 1.0 : 0.33, 1.5);
        this.ambience.rainOut.setLowpass?.(out ? 20000 : 900, 1.5);
        this.ambience.wind.setVolume(b ? 0.03 : 0.15, 1.5);
      }
      breathing.update(dt, { sprinting: this.player.sprinting, moving: this.player.moving, safe: !this.ai.enc });
      this.soundscape.update(dt);
      this.ui.setBattery(this.flashlight.battery, this.flashlight.spares, this.flashlight.has && !this.morning);
      const hudOn = !this.morning && !this.story.hideHud && this.story.stageAtLeast('dark');
      this.ui.setLives(this.lives, hudOn && this.mode !== 'mp');
      this.ui.setStamina(this.player.stamina, { sprinting: this.player.sprinting, exhausted: this.player.exhausted, show: hudOn });
    }
    // Thin fog outdoors so the building reads in the storm; thick, close fog inside.
    if (!this.morning) {
      const B = layout.bounds, c = this.camera.position;
      const outside = c.x < B.x0 - 0.3 || c.x > B.x1 || c.z < B.z0 || c.z > B.z1;
      const target = outside ? 0.0105 : 2.3 / this.viewDist;
      const k = Math.min(1, dt * 2.5);
      this.scene.fog.density += (target - this.scene.fog.density) * k;
      // storm sky: dark blue-grey outside so the building silhouettes; near-black inside
      this._skyCol = this._skyCol || new THREE.Color();
      this._skyCol.setHex(outside ? 0x18212c : 0x020304);   // moonlit storm clouds
      this.fogColor.lerp(this._skyCol, k);
      this.scene.fog.color.copy(this.fogColor);
      this.scene.background.copy(this.fogColor).lerp(new THREE.Color(0x8a96a8), this.world.flash * 0.25);
      const far = outside ? 180 : this.viewDist + 25;
      if (Math.abs(this.camera.far - far) > 1) { this.camera.far = far; this.camera.updateProjectionMatrix(); }
    }
    if (s === 'play') this.progress.update(dt);
    else if (s === 'intro') { this.ui.setClock('', false); this.ui.setObjective(null); }
    music.update(dt);
    audio.update(dt);
    audio.setListener(s === 'play' && this._listen ? this._listen : this.camera);
    this.updateAcousticSpace();
    this.post.update(dt, breathing.fear);
    this.ui.update(dt);
    if (this.debug && this.mode !== 'mp') this.debug.update(dt);
    if (!this.skipRender) this.post.render(this.scene, this.camera);
  }
}

const game = new Game();
game.boot().catch(e => {
  console.error(e);
  document.getElementById('boot-error').classList.remove('hidden');
  document.getElementById('boot-error').textContent = 'Failed to start: ' + (e.message || e);
});
