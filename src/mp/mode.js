// NIGHT SHIFT multiplayer - mode controller: menu, CREATE / JOIN / REJOIN PARTY, lobby, start.
// This whole mode runs only after the page was reloaded into multiplayer (intent 'mp'), so the
// single-player story, objectives and AI are never constructed alongside it.
import { audio } from '../audio/audio.js';
import { settings } from '../core/settings.js';
import { keyLabel } from '../ui/ui.js';
import { Net, MAX_PLAYERS, normCode, lastParty, rememberVerified } from './net.js';
import { Voice } from './voice.js';
import { MPSession } from './session.js';
import { defaultState } from './story.js';
import { wallet } from '../web3/wallet.js';
import { updateEntry, verifyParty } from '../web3/entry.js';
import { safeError } from '../web3/privacy.js';
import { shortAddr } from '../web3/chain.js';

const $ = id => document.getElementById(id);
const NAME_KEY = 'nightshift.mp.name';
export const MP_SAVE_KEY = 'nightshift.mp.save.v2';

export class MPMode {
  constructor(g) {
    this.g = g;
    this.net = new Net();
    this.voice = new Voice(this.net);
    this.session = null;
    this.ready = false;
    this.net.on('roster', () => { this.renderLobby(); this.net.connectVoice(); });
    this.net.on('code', () => this.renderLobby());
    this.net.on('hostlost', () => this.onHostLost());
    this.net.on('msg', m => {
      if ((m.t === 'start' || m.t === 'resume') && !this.session) this.beginGame(m);
    });
    // the host: a player joined while the night is running -> hand them the night
    this.net.on('join', (member, resume) => { if (this.session && this.net.isHost) this.session.onJoin(member, resume); });
    this.bind();
    this.refreshRejoin();
    // DEV-only test hook: sessionStorage 'nightshift.mptest' = 'host' | '<NAME>' auto-creates / auto-joins
    if (import.meta.env.DEV) {
      let t = null; try { t = sessionStorage.getItem('nightshift.mptest'); sessionStorage.removeItem('nightshift.mptest'); } catch { /* ignore */ }
      if (t) setTimeout(async () => {
        if (t === 'host') { $('mp-name').value = 'HOST'; await this.create(); localStorage.setItem('nightshift.mptest.code', this.net.code); }
        else if (t === 'rejoin') { await this.rejoin(); }
        else { $('mp-name').value = t; $('mp-code').value = localStorage.getItem('nightshift.mptest.code') || ''; await this.join(); if (!this.session) { this.ready = true; this.net.setMeta({ ready: true }); } }
      }, 400);
    }
  }

  bind() {
    const ui = this.g.ui;
    let name = '';
    try { name = localStorage.getItem(NAME_KEY) || ''; } catch { /* ignore */ }
    $('mp-name').value = name || 'PLAYER' + Math.floor(Math.random() * 90 + 10);
    $('mp-code').addEventListener('input', e => { e.target.value = normCode(e.target.value); });
    $('mp-code').addEventListener('keydown', e => { if (e.key === 'Enter') this.join(); e.stopPropagation(); });
    $('mp-name').addEventListener('keydown', e => e.stopPropagation());
    ui.on('mp-create', () => this.create());
    ui.on('mp-rejoin', () => this.rejoin());
    ui.on('mp-joinscreen', () => { this.g.startAudio(); ui.show('mp-join', true); this.msg('mp-join-msg', ''); setTimeout(() => $('mp-code').focus(), 50); });
    ui.on('mp-join', () => this.join());
    ui.on('mp-back', () => ui.back());
    ui.on('mp-exit', () => { this.net.leave(); this.g.reloadWith('menu'); });
    ui.on('mp-leave', () => this.exitToMenu());
    ui.on('mp-copy', () => { try { navigator.clipboard.writeText(this.net.code); this.msg('mp-lobby-msg', 'CODE COPIED', true); } catch { /* ignore */ } });
    ui.on('mp-ready', () => { this.ready = !this.ready; this.net.setMeta({ ready: this.ready }); this.renderLobby(); });
    ui.on('mp-mic', async () => { await this.voice.init(); await this.voice.toggleMic(); this.renderLobby(); });
    ui.on('mp-spk', () => { this.voice.toggleSpeaker(); this.renderLobby(); });
    ui.on('mp-start', () => this.hostStart());
    // voice keys (multiplayer only): push-to-talk = HOLD (rebindable), B = speaker on/off
    window.addEventListener('keydown', e => {
      if (!this.net.code || e.repeat) return;
      if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      if (e.code === this.voice.pttKey) { if (this.voice.ptt) this.voice.setPTT(true); else if (this.session) this.voice.toggleMic(); }
      if (e.code === 'KeyB' && this.session && !this.g.mpPaused) this.voice.toggleSpeaker();
    });
    window.addEventListener('keyup', e => { if (e.code === this.voice.pttKey) this.voice.setPTT(false); });
    window.addEventListener('blur', () => this.voice.setPTT(false));
    settings.onChange(() => this.updateHelp());
    this.updateHelp();
  }
  updateHelp() {
    const k = keyLabel(this.voice.pttKey);
    const el = $('mp-help');
    if (el) el.innerHTML = `<span>${k}</span> ${this.voice.ptt ? 'hold to talk' : 'microphone on/off (open mic)'} &nbsp; <span>B</span> speaker on/off &nbsp; <span>E</span> interact / revive (hold) &nbsp; <span>F</span> flashlight<br />Push-to-talk key and open-mic mode: SETTINGS &rsaquo; AUDIO`;
  }

  name() {
    const n = ($('mp-name').value || 'PLAYER').trim().toUpperCase().slice(0, 16) || 'PLAYER';
    try { localStorage.setItem(NAME_KEY, n); } catch { /* ignore */ }
    return n;
  }
  msg(id, text, ok = false) { const el = $(id); if (el) { el.textContent = text; el.classList.toggle('ok', ok); } }

  showMenu() { this.g.ui.show('mp-menu'); this.refreshRejoin(); }
  refreshRejoin() {
    const lp = lastParty();
    const ok = lp && lp.code && Date.now() - (lp.at || 0) < 10 * 60 * 1000;
    const b = $('mp-rejoin'); if (!b) return;
    b.classList.toggle('hidden', !ok);
    if (ok) b.textContent = `REJOIN LAST PARTY (${lp.code})`;
  }

  // CREATE PARTY: wallet + Hemi + the creator pays the entry ONCE for this party (an unused confirmed
  // entry - e.g. the lobby was closed before the night began - is reused, never charged again)
  async create() {
    this.g.startAudio();
    if (this.creating || !this.g.web3.requireReady()) return;
    this.creating = true;
    try {
      const entry = await this.g.web3.confirmEntry('party');
      if (!entry) return;
      this.partyEntry = entry;
      // what travels with the party: the code, the commitment's secret and a block hint - never an address or tx hash
      this.net.partyInfo = { code: entry.partyCode, secret: entry.partySecret, block: entry.block ?? null };
      this.msg('mp-menu-msg', 'CREATING PARTY...', true);
      await this.voice.init();
      await this.net.create(this.name(), entry.partyCode);         // exactly the code the payment is bound to
      updateEntry(entry, { party: this.net.code });
      this.ready = true;
      this.g.ui.show('mp-lobby');
      this.renderLobby();
      this.voice.enableMic(true).then(() => this.renderLobby());
    } catch (e) {
      console.warn('[mp] create failed', safeError(e));
      this.msg('mp-menu-msg', (e.message || 'COULD NOT CREATE A PARTY').toUpperCase() + ' (YOUR ENTRY IS KEPT - NO NEW PAYMENT)');
    } finally { this.creating = false; }
  }

  // JOIN PARTY: wallet + Hemi only. Joiners NEVER pay and this path never touches payEntry().
  // verifiedCode (REJOIN only): the party's original code this player already verified on-chain - the
  // code a successor host falls back to after a migration is not part of the payment commitment
  async join(codeOverride, verifiedCode = null) {
    this.g.startAudio();
    if (!this.g.web3.requireReady()) return;
    const code = normCode(codeOverride || $('mp-code').value);
    const msgId = codeOverride ? 'mp-menu-msg' : 'mp-join-msg';
    if (code.length !== 5) return this.msg(msgId, 'ENTER THE 5-CHARACTER PARTY CODE');
    this.msg(msgId, 'JOINING ' + code + '...', true);
    try {
      await this.voice.init();
      const w = await this.net.join(code, this.name());
      // the party must be backed by a confirmed creator entry on Hemi (one free read, no transaction)
      // checked against the code THIS player typed (or verified earlier), never one the host reports   // null = Hemi unreachable: allow
      const paid = await verifyParty(w.party, verifiedCode || code).catch(() => null);
      if (paid === false) { this.net.leave({ forget: false }); throw Object.assign(new Error('THIS PARTY HAS NO CONFIRMED ENTRY ON HEMI TESTNET.'), { type: 'unpaid' }); }
      if (paid) rememberVerified(w.party.code);
      if (w.status === 'game') {
        // the night is already running: the host sends the whole state right after the welcome
        this.msg(msgId, 'JOINING THE NIGHT IN PROGRESS...', true);
        this.waitResume = setTimeout(() => { if (!this.session) { this.msg(msgId, 'THE HOST DID NOT RESPOND - TRY AGAIN'); this.net.leave({ forget: false }); } }, 12000);
      } else {
        this.g.ui.show('mp-lobby');
        this.renderLobby();
      }
      this.voice.enableMic(true).then(() => this.renderLobby());
    } catch (e) {
      console.warn('[mp] join failed', safeError(e));
      try { this.net.leave({ forget: false }); } catch { /* ignore */ }
      const t = e.type === 'full' ? 'PARTY FULL (4/4)' : e.type === 'invalid' ? 'NO PARTY WITH THAT CODE - IT MAY HAVE ENDED'
        : e.type === 'ended' ? 'THAT NIGHT IS OVER - THE PARTY HAS ENDED' : (e.message || 'COULD NOT JOIN').toUpperCase();
      this.msg(msgId, t);
    }
  }
  // same browser tab = same identity token: the host gives back your slot, position, items and life
  async rejoin() {
    const lp = lastParty(); if (!lp?.code) return;
    if (!this.g.web3.requireReady()) return;
    $('mp-name').value = lp.name || $('mp-name').value;
    await this.join(lp.code, lp.verified || null);
    this.refreshRejoin();
  }

  renderLobby() {
    if (!this.net.code || this.session) return;
    $('mp-code-show').textContent = this.net.code;
    const r = this.net.roster;
    $('mp-count').textContent = `PLAYERS ${r.length}/${MAX_PLAYERS}`;
    const rows = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const m = r.find(x => x.slot === i);
      if (!m) { rows.push(`<div class="mp-slot empty"><span class="n">PLAYER ${i + 1}/${MAX_PLAYERS}</span><span>WAITING FOR PLAYER...</span><span></span><span></span><span></span></div>`); continue; }
      const you = m.peerId === this.net.peer?.id;
      const talk = you ? this.voice.myLevel > 0.08 : (this.voice.levels.get(m.peerId) || 0) > 0.08;
      rows.push(`<div class="mp-slot"><span class="n">PLAYER ${i + 1}/${MAX_PLAYERS}</span>
        <span class="who"><b>${esc(m.name)}</b> <span class="wal">${you && wallet.address ? esc(shortAddr(wallet.address)) : ''}</span>${m.host ? '<span class="host">HOST</span>' : ''}${you ? '<span class="you">YOU</span>' : ''}</span>
        <span class="st ${m.ready || m.host ? 'ready' : ''}">${m.host ? 'HOST' : m.ready ? 'READY' : 'NOT READY'}</span>
        <span class="ico ${m.mic ? (talk ? 'talk' : 'on') : ''}">${m.mic ? 'MIC' : 'MIC X'}</span>
        <span class="ico ${m.spk ? 'on' : ''}">${m.spk ? 'SPK' : 'SPK X'}</span></div>`);
    }
    $('mp-slots').innerHTML = rows.join('');
    $('mp-mic').textContent = this.voice.micAvailable === false ? 'MIC: UNAVAILABLE' : `MIC: ${this.voice.micOn ? 'ON' : 'OFF'}`;
    $('mp-spk').textContent = `SPEAKER: ${this.voice.speakerOn ? 'ON' : 'OFF'}`;
    $('mp-ready').style.display = this.net.isHost ? 'none' : '';
    $('mp-ready').textContent = this.ready ? 'READY ✓' : 'READY';
    const allReady = r.every(m => m.host || m.ready);
    $('mp-start').style.display = this.net.isHost ? '' : 'none';
    $('mp-start').disabled = !allReady;
    if (this.net.isHost) this.msg('mp-lobby-msg', r.length < 2 ? 'SHARE THE CODE - 2-4 PLAYERS (YOU CAN ALSO START ALONE)' : allReady ? 'EVERYONE IS READY' : 'WAITING FOR EVERYONE TO BE READY', true);
    else this.msg('mp-lobby-msg', 'WAITING FOR THE HOST TO START...', true);
    clearTimeout(this._lvlT);
    this._lvlT = setTimeout(() => { if (!this.session && this.g.ui.current === 'mp-lobby') { this.voice.update(null, null, null); this.renderLobby(); } }, 400);
  }

  hostStart() {
    if (!this.net.isHost || this.session) return;
    if (!this.net.roster.every(m => m.host || m.ready)) return;
    let state = null;
    try {
      const s = JSON.parse(localStorage.getItem(MP_SAVE_KEY) || 'null');
      // continue only when the same party (code) is still together; otherwise a new night
      if (s && s.code === this.net.code && s.state?.v === 2) state = s.state;
    } catch { /* ignore */ }
    const seed = Math.floor(Math.random() * 1e9);
    const msg = { t: 'start', seed, roster: this.net.pubRoster(), state: state || defaultState(seed, this.net.roster.length) };
    this.net.status = 'game';
    if (this.partyEntry) updateEntry(this.partyEntry, { used: true, usedAt: Date.now(), started: this.net.code });   // this party's night has begun
    this.net.broadcast(msg);
    this.beginGame(msg);
  }

  async beginGame(msg) {
    const g = this.g;
    clearTimeout(this.waitResume);
    this.net.status = 'game';
    g.ui.hideAll();
    if (msg.t === 'resume') g.ui.timecard(msg.rejoin ? 'BACK INSIDE' : 'ST. MERCY HOSPITAL', 2.5);
    else g.ui.timecard('ST. MERCY HOSPITAL  ·  1:40 AM', 3.5);
    g.beginSession();
    g.ui.hud(true);
    document.getElementById('mp-hud').classList.remove('hidden');
    g.world.lights.setPower('all', false);
    g.world.lights.setEmergency(false);
    this.session = new MPSession(g, this, msg);
    g.mp.session = this.session;
    await this.session.begin(msg);
    g.state = 'play';
    g.input.requestLock();
    g.ui.clickToPlay(!g.input.locked, () => { g.ui.clickToPlay(false); g.input.requestLock(); });
    audio.play('ui_confirm', { bus: 'ui', volume: 0.4 });
  }

  // the host vanished. In a running night the session migrates; in the lobby the lowest slot takes over.
  async onHostLost() {
    if (this.session) return this.session.hostLost();
    if (!this.net.code || this.net.migrating) return;
    const lostHost = this.net.roster.find(r => r.host);
    const succ = this.net.successor(lostHost?.peerId);
    if (!succ) { this.msg('mp-lobby-msg', 'THE HOST CLOSED THE PARTY'); setTimeout(() => this.exitToMenu(), 2500); return; }
    this.msg('mp-lobby-msg', 'THE HOST LEFT - MOVING THE PARTY...', true);
    if (succ.peerId === this.net.peer?.id) { await this.net.promote(); this.ready = true; this.renderLobby(); }
    else if (!(await this.net.follow(succ, this.name()))) { this.msg('mp-lobby-msg', 'COULD NOT RECONNECT TO THE PARTY'); setTimeout(() => this.exitToMenu(), 3000); }
    else { this.net.setMeta({ ready: this.ready }); this.renderLobby(); }
  }

  onWalletChanged() { this.renderLobby(); }       // only my own lobby row shows (my own) wallet; nothing is sent

  exitToMenu() {
    try { this.voice.destroy(); this.net.leave(); } catch { /* ignore */ }
    this.g.reloadWith('mp');
  }

  // per frame (only while a session runs)
  update(dt) { this.net.tick(dt); this.session?.update(dt); }
  // lobby heartbeats (the session's update covers in-game)
  lobbyTick(dt) { if (!this.session && this.net.code) this.net.tick(dt); }
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
