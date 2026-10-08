// NIGHT SHIFT multiplayer - networking (WebRTC via PeerJS, MIT).
//
// Topology: one player's browser is the HOST (authoritative). Every client opens one reliable data
// connection to the host; the host relays/broadcasts. Voice is a full mesh of WebRTC audio calls
// (at most 4 players -> at most 6 calls).
//
// The party code is a peer address on the public PeerJS signalling broker ("nsmp-<CODE>"). That broker
// only introduces browsers to each other: there is NO game server. Everything below is what can be made
// robust on top of that honestly:
//   * identity     every player has a private token (per browser tab) -> rejoining restores YOUR slot
//   * reconnect    a dropped/reloaded player rejoins with the same code: same slot, character, story,
//                  inventory, life state (the host keeps a departed player's record for 10 minutes)
//   * join late    a new player can join a running night while there is a free slot
//   * duplicates   the same token connecting twice replaces the old connection - never two of you
//   * migration    if the host disappears, the lowest remaining slot becomes host with the shared state
//                  every client already holds; the others reconnect to it; the new host re-claims the
//                  party code so late joiners / reconnects keep working (or takes a fresh one)
//   * stale peers  heartbeats both ways; silent peers are dropped after HEARTBEAT_DROP seconds
// The transport is isolated here (create / join / send / broadcast / events), so a dedicated relay or
// game server can replace PeerJS later without touching the game code.
import { Peer } from 'peerjs';

export const MAX_PLAYERS = 4;
const PREFIX = 'nsmp-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';     // no 0/O/1/I confusion
const TOKEN_KEY = 'nightshift.mp.token';
const LAST_KEY = 'nightshift.mp.last';
const HEARTBEAT = 1.0;          // seconds between keep-alives when nothing else is sent
const HEARTBEAT_DROP = 12;      // a peer silent this long is gone
const DEPARTED_TTL = 10 * 60 * 1000;

export function makeCode(n = 5) {
  let s = ''; for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}
export const normCode = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
const err = (msg, type) => Object.assign(new Error(msg), { type });

function myToken() {
  try {
    let t = sessionStorage.getItem(TOKEN_KEY);
    if (!t) { t = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join(''); sessionStorage.setItem(TOKEN_KEY, t); }
    return t;
  } catch { return 'anon-' + Math.random().toString(36).slice(2); }
}
export function lastParty() { try { return JSON.parse(sessionStorage.getItem(LAST_KEY) || 'null'); } catch { return null; } }
function rememberParty(v) { try { if (v) sessionStorage.setItem(LAST_KEY, JSON.stringify(v)); else sessionStorage.removeItem(LAST_KEY); } catch { /* ignore */ } }
// this tab verified the party's on-chain entry under its original code (REJOIN checks against it)
export function rememberVerified(code) { const lp = lastParty(); if (lp) rememberParty({ ...lp, verified: code }); }

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }];
let iceCache = null;   // { servers, until }

// Relay (TURN) credentials from the site's own /api/turn (a Vercel function holding the Cloudflare key).
// WebRTC still tries direct connections first and only relays when players cannot reach each other.
// Without the endpoint (local dev, other hosts, not configured) the game uses direct connections only.
async function iceServers() {
  if (iceCache && Date.now() < iceCache.until) return iceCache.servers;
  try {
    const r = await fetch('/api/turn', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (r.ok && (r.headers.get('content-type') || '').includes('application/json')) {
      const j = await r.json();
      if (Array.isArray(j.iceServers) && j.iceServers.length) {
        const ttl = Number(j.ttl) || 3600;
        iceCache = { servers: [...j.iceServers, ...STUN], until: Date.now() + Math.max(60, ttl - 1800) * 1000 };   // refresh well before expiry
        return iceCache.servers;
      }
    }
  } catch { /* no relay available: direct connections only */ }
  iceCache = { servers: STUN, until: Date.now() + 60 * 1000 };   // look for the relay again in a minute
  return STUN;
}

async function peerOpts() {
  // optional own signalling server: ?peerhost=host:port (e.g. a local "peerjs --port 9000")
  const q = new URLSearchParams(location.search).get('peerhost');
  const base = { debug: 1, config: { iceServers: await iceServers() } };
  if (!q) return base;
  const [host, port] = q.split(':');
  return { ...base, host, port: Number(port || 9000), path: '/', secure: location.protocol === 'https:' };
}

export class Net {
  constructor() {
    this.peer = null;            // my own peer (random id; stays the same through a migration)
    this.alias = null;           // host only: the "nsmp-CODE" peer that late joiners connect to
    this.isHost = false;
    this.code = null;
    this.token = myToken();
    this.me = null;              // { slot, name, peerId, ... }
    this.roster = [];            // [{ slot, name, peerId, ready, mic, spk, host }]
    this.conns = new Map();      // host: peerId -> conn ; client: 'host' -> conn
    this.tokens = new Map();     // host: peerId -> token
    this.lastSeen = new Map();   // host: peerId -> ms ; client: 'host' -> ms
    this.departed = new Map();   // host: token -> { slot, name, at, data }
    this.handlers = {};
    this.calls = new Map();      // peerId -> MediaConnection
    this.localStream = null;
    this.status = 'idle';        // idle | lobby | game
    this.sinceSend = 0;
    this.migrating = false;
    // broker keep-alive that does not depend on frames: a hidden / background tab stops requestAnimationFrame
    // (tick), but the party code must stay registered while the host is e.g. sending the code to a friend
    setInterval(() => this._keepBroker(), 3000);
    const now = () => this._keepBroker();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) now(); });
    window.addEventListener('online', now);
  }

  // re-register with the signalling broker. When a broker socket drops (background tab, network blip)
  // PeerJS destroys that peer for good if it had never been disconnected before - so the host claims the
  // party code again (retrying while the broker may still hold it), and my own id is registered again.
  _keepBroker() {
    if (this.leaving || this.status === 'idle') return;
    for (const p of [this.peer, this.alias]) if (p && p.disconnected && !p.destroyed) { try { p.reconnect(); } catch { /* retried next time */ } }
    // my own peer was destroyed (a broker socket that closed before ever disconnecting is destroyed by
    // PeerJS): register the SAME id again - the roster, voice calls and host migration address me by it.
    // Existing game links are direct WebRTC connections and keep running meanwhile.
    const myId = this.me?.peerId;
    if (this.peer && this.peer.destroyed && myId && !this._reopening) {
      this._reopening = true;
      const dead = this.peer;
      this._open(myId).then(p => {
        if (this.leaving || this.status === 'idle' || this.peer !== dead) { try { p.destroy(); } catch { /* ignore */ } return; }
        this.peer = p; this._wirePeer(p);
        if (this.isHost) p.on('connection', conn => this._hostAccept(conn));
      }).catch(() => { /* id not released yet: retried next time */ }).finally(() => { this._reopening = false; });
    }
    if (this.isHost && this.code && (!this.alias || this.alias.destroyed) && !this._reclaiming && !this._promoting) {
      this._reclaiming = true;
      const code = this.code;
      this._claimCode(code, 1).catch(() => false)
        .then(ok => { if (ok && (this.leaving || this.status === 'idle' || this.code !== code)) { try { this.alias?.destroy(); } catch { /* ignore */ } } })
        .finally(() => { this._reclaiming = false; });
    }
  }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); }
  emit(type, ...a) { for (const f of this.handlers[type] || []) { try { f(...a); } catch (e) { console.error('[net]', type, e); } } }

  async _open(id) {
    const opts = await peerOpts();
    return new Promise((resolve, reject) => {
      const p = new Peer(id, opts);
      const t = setTimeout(() => { try { p.destroy(); } catch { /* ignore */ } reject(err('Could not reach the matchmaking server. Check your connection.', 'network')); }, 12000);
      p.on('open', () => { clearTimeout(t); resolve(p); });
      p.on('error', e => { clearTimeout(t); try { p.destroy(); } catch { /* ignore */ } reject(e); });
    });
  }

  // ================================================================== HOST
  // code: the party code the creator's entry is bound to (the payment commitment includes it)
  async create(name, code = null) {
    this.peer = await this._open(undefined);
    this._wirePeer(this.peer);
    this.peer.on('connection', conn => this._hostAccept(conn));
    const ok = await this._claimCode(code || null);
    if (!ok || !this.code) { try { this.peer.destroy(); } catch { /* ignore */ } this.peer = null; throw err(code ? 'Your party code is still in use. Try again in a minute.' : 'Could not create a party. Try again.', 'network'); }
    this.isHost = true; this.status = 'lobby';
    this.me = { slot: 0, name, peerId: this.peer.id, ready: true, mic: false, spk: true, host: true };
    this.roster = [this.me];
    rememberParty({ code: this.code, name, at: Date.now(), host: true, verified: this.partyInfo?.code });   // my own payment
    this.emit('roster', this.roster);
    return this.code;
  }

  // the party code is a second peer that only accepts connections (same host, same handler)
  async _claimCode(want = null, tries = 4) {
    for (let attempt = 0; attempt < tries; attempt++) {
      const code = want || makeCode();
      try {
        const a = await this._open(PREFIX + code);
        a.on('connection', conn => this._hostAccept(conn));
        // deferred: PeerJS fires 'disconnected' from inside destroy() before marking the peer destroyed - an
        // immediate reconnect there would revive the socket of a dead peer that then holds the code forever
        a.on('disconnected', () => setTimeout(() => { if (!this.leaving && !a.destroyed && a.disconnected && this.alias === a) { try { a.reconnect(); } catch { /* ignore */ } } }, 0));
        this.alias = a; this.code = code;
        return true;
      } catch (e) {
        if (e.type !== 'unavailable-id') throw e;  // network trouble: let the caller report it
        if (want) return false;                    // the old code is still held: caller retries later
      }                                            // random code collided: try another
    }
    return false;
  }

  _hostAccept(conn) {
    conn.on('open', () => {
      const meta = conn.metadata || {};
      const token = String(meta.token || '');
      const name = String(meta.name || 'Player').slice(0, 16);
      const reject = (why) => { try { conn.send({ t: 'reject', why }); } catch { /* ignore */ } setTimeout(() => conn.close(), 400); };
      if (this.status === 'ended') return reject('ended');
      let member = null, resume = null;
      // 1) the same player again (reload / dropped link / host migration): their old slot
      const live = this.roster.find(r => r.token === token || (meta.migrate && r.peerId === conn.peer));
      if (live && !live.host) {
        const old = this.conns.get(live.peerId); if (old && old !== conn) { this.conns.delete(live.peerId); try { old.close(); } catch { /* ignore */ } }
        live.peerId = conn.peer; live.token = token; live.name = name || live.name;
        member = live; resume = 'live';
      } else if (this.departed.has(token) && Date.now() - this.departed.get(token).at < DEPARTED_TTL) {
        if (this.roster.length >= MAX_PLAYERS) return reject('full');
        const d = this.departed.get(token); this.departed.delete(token);
        const slot = this.roster.some(r => r.slot === d.slot) ? this.freeSlot() : d.slot;   // their own slot when free
        member = { slot, name, peerId: conn.peer, token, ready: true, mic: false, spk: true, host: false };
        this.roster.push(member); resume = { departed: d.data || null };
      } else {
        // 2) someone new: the lobby, or a running night with a free slot (join in progress)
        if (this.roster.length >= MAX_PLAYERS) return reject('full');
        member = { slot: this.freeSlot(), name, peerId: conn.peer, token, ready: this.status === 'game', mic: false, spk: true, host: false };
        this.roster.push(member); resume = this.status === 'game' ? 'new' : null;
      }
      this.roster.sort((a, b) => a.slot - b.slot);
      this.conns.set(conn.peer, conn);
      this.tokens.set(conn.peer, token);
      this.lastSeen.set(conn.peer, performance.now());
      conn.on('data', m => this._hostRecv(conn.peer, m));
      conn.on('close', () => this._drop(conn.peer, conn));
      conn.on('error', () => this._drop(conn.peer, conn));
      conn.send({ t: 'welcome', code: this.code, you: this.pub(member), roster: this.pubRoster(), status: this.status, party: this.partyInfo || null });
      this.broadcast({ t: 'roster', roster: this.pubRoster() });
      this.emit('roster', this.roster);
      this.emit('join', member, resume);
    });
  }
  freeSlot() { const used = new Set(this.roster.map(r => r.slot)); let s = 0; while (used.has(s)) s++; return s; }
  pub(r) { const { token, ...rest } = r; return rest; }
  pubRoster() { return this.roster.map(r => this.pub(r)); }

  // host: a connection went away -> keep their record (reconnect) and tell the game
  _drop(peerId, conn) {
    if (conn && this.conns.get(peerId) !== conn) return;             // an old, replaced connection
    if (!this.conns.has(peerId)) return;
    if (this.leaving) return;   // we are closing everything ourselves: never broadcast a half-empty roster on the way out
    this.conns.delete(peerId); this.lastSeen.delete(peerId);
    const m = this.roster.find(r => r.peerId === peerId);
    this.roster = this.roster.filter(r => r.peerId !== peerId);
    this.calls.get(peerId)?.close(); this.calls.delete(peerId);
    if (m && this.status === 'game' && m.token) this.departed.set(m.token, { slot: m.slot, name: m.name, at: Date.now(), data: null });
    this.broadcast({ t: 'roster', roster: this.pubRoster() });
    this.emit('roster', this.roster);
    if (m) this.emit('leave', m);
  }
  // the game hands the host a departed player's in-world data (position, life, inventory)
  stashDeparted(token, data) { const d = this.departed.get(token); if (d) d.data = data; }

  _hostRecv(from, m) {
    this.lastSeen.set(from, performance.now());
    const member = this.roster.find(r => r.peerId === from);
    if (!member) return;
    if (m.t === 'hb') return;
    if (m.t === 'meta') {                                     // lobby status from a client
      // only lobby state is accepted - a wallet (or anything else) a client tries to add is ignored, never relayed
      Object.assign(member, { ready: !!m.ready, mic: !!m.mic, spk: !!m.spk, ptt: !!m.ptt, name: String(m.name || member.name).slice(0, 16) });
      this.broadcast({ t: 'roster', roster: this.pubRoster() });
      this.emit('roster', this.roster);
      return;
    }
    this.emit('msg', m, member);
  }

  broadcast(m, except) {
    this.sinceSend = 0;
    for (const [id, c] of this.conns) if (id !== except && c.open) { try { c.send(m); } catch { /* closing */ } }
  }
  sendTo(peerId, m) { const c = this.conns.get(peerId); if (c?.open) { try { c.send(m); } catch { /* closing */ } } }
  sendToSlot(slot, m) { const r = this.roster.find(x => x.slot === slot); if (r) this.sendTo(r.peerId, m); }

  // ================================================================== CLIENT
  async join(code, name, { migrate = false, peerId = null } = {}) {
    code = normCode(code);
    if (!peerId && code.length !== 5) throw err('Party codes have 5 characters.', 'invalid');
    if (!this.peer || this.peer.destroyed) { this.peer = await this._open(undefined); this._wirePeer(this.peer); }
    const target = peerId || PREFIX + code;
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = (e) => { if (done) return; done = true; clearTimeout(t); try { conn.close(); } catch { /* ignore */ } reject(e); };
      // the broker answers "peer-unavailable" at once when no such party is registered; a party that exists
      // but cannot be reached (networks blocking a direct connection) only shows up as this timeout
      const t = setTimeout(() => fail(err('Could not connect to the host.', 'unreachable')), 10000);
      const onErr = e => { if (e.type === 'peer-unavailable') fail(err('No party found with that code. It may have ended.', 'invalid')); };
      this.peer.on('error', onErr);
      const conn = this.peer.connect(target, { reliable: true, serialization: 'json', metadata: { name, token: this.token, migrate } });
      conn.on('data', m => {
        if (m.t === 'reject') {
          const why = { full: 'PARTY FULL (4/4)', ended: 'THAT NIGHT IS OVER - THE PARTY HAS ENDED', nothost: 'NOT THE HOST' }[m.why] || 'COULD NOT JOIN';
          fail(err(why, m.why)); return;
        }
        if (m.t === 'welcome' && !done) {
          clearTimeout(t); done = true;
          this.code = m.code || this.code; this.me = m.you; this.roster = m.roster; this.status = m.status === 'game' ? 'game' : 'lobby';
          if (m.party) this.partyInfo = m.party;          // the creator's entry reference travels with the party (host migration keeps it)
          this.isHost = false;
          const old = this.conns.get('host'); if (old && old !== conn) { old.__replaced = true; try { old.close(); } catch { /* ignore */ } }
          this.conns.set('host', conn);
          this.hostPeer = conn.peer;
          this.lastSeen.set('host', performance.now());
          // keep `verified` (the original code this player checked on-chain) only while it is still the same party
          const prev = lastParty();
          const verified = prev?.verified && prev.verified === m.party?.code ? prev.verified : undefined;
          rememberParty({ code: this.code, name, at: Date.now(), host: false, verified });
          this.emit('roster', this.roster);
          resolve(m);
          return;
        }
        this.lastSeen.set('host', performance.now());
        if (m.t === 'hb') return;
        if (m.t === 'roster') { this.roster = m.roster; this.me = this.roster.find(r => r.peerId === this.peer.id) || this.me; this.emit('roster', this.roster); return; }
        if (m.t === 'code') { this.code = m.code; rememberParty({ ...(lastParty() || {}), code: m.code, at: Date.now() }); this.emit('code', m.code); return; }
        this.emit('msg', m, null);
      });
      conn.on('close', () => { if (done && !conn.__replaced && this.conns.get('host') === conn && !this.isHost) this.emit('hostlost'); });
      conn.on('error', e => fail(e));
    });
  }

  send(m) {                     // client -> host (the host handles its own messages locally)
    if (this.isHost) { this.emit('msg', m, this.me); return; }
    this.sinceSend = 0;
    const c = this.conns.get('host'); if (c?.open) { try { c.send(m); } catch { /* closing */ } }
  }

  setMeta(meta) {
    if (!this.me) return;
    Object.assign(this.me, meta);
    if (this.isHost) { this.broadcast({ t: 'roster', roster: this.pubRoster() }); this.emit('roster', this.roster); }
    else this.send({ t: 'meta', ...this.me });
  }

  // ================================================================== heartbeats / stale peers (call often)
  tick(dt) {
    this.sinceSend += dt;
    // the signalling broker drops sockets it has not heard from (background tabs throttle PeerJS's own
    // keep-alive): keep my peer and the party-code peer registered so joins / reconnects keep working
    this._brokerT = (this._brokerT || 0) - dt;
    if (this._brokerT <= 0 && !this.leaving) {
      this._brokerT = 4;
      for (const p of [this.peer, this.alias]) if (p && p.disconnected && !p.destroyed) { try { p.reconnect(); } catch { /* retried next tick */ } }
    }
    if (this.sinceSend > HEARTBEAT) { if (this.isHost) this.broadcast({ t: 'hb' }); else this.send({ t: 'hb' }); }
    const now = performance.now();
    if (this.isHost) {
      for (const [id, ts] of this.lastSeen) if (now - ts > HEARTBEAT_DROP * 1000) { const c = this.conns.get(id); console.warn('[net] dropping silent peer', id); this._drop(id, c); try { c?.close(); } catch { /* ignore */ } }
      for (const [t, d] of this.departed) if (Date.now() - d.at > DEPARTED_TTL) this.departed.delete(t);
    } else if (this.conns.get('host') && !this.migrating) {
      const ts = this.lastSeen.get('host') || now;
      if (now - ts > HEARTBEAT_DROP * 1000) { this.lastSeen.set('host', now); console.warn('[net] host silent'); this.emit('hostlost'); }
    }
  }

  // ================================================================== HOST MIGRATION
  // Everyone holds the same roster. The lowest remaining slot (excluding the lost host) becomes host.
  successor(excludePeer) {
    const rest = this.roster.filter(r => r.peerId !== excludePeer && !r.host);
    return rest.sort((a, b) => a.slot - b.slot)[0] || null;
  }
  // I am the successor: start accepting connections on my own peer, then re-claim the party code
  async promote() {
    const lost = this.roster.find(r => r.host);
    this.isHost = true; this.migrating = false;
    this.conns.clear(); this.lastSeen.clear(); this.tokens.clear();
    this.roster = this.roster.filter(r => r !== lost && r.peerId !== lost?.peerId);
    for (const r of this.roster) r.host = r.peerId === this.peer.id;
    this.me = this.roster.find(r => r.peerId === this.peer.id) || this.me;
    this.me.token = this.token;
    this.peer.on('connection', conn => this._hostAccept(conn));
    // members who do not reconnect within a while are treated as departed (they can still rejoin)
    const waiting = this.roster.filter(r => !r.host);
    setTimeout(() => { for (const r of waiting) if (!this.conns.has(r.peerId) && this.roster.includes(r)) { this.roster = this.roster.filter(x => x !== r); this.emit('leave', r); this.emit('roster', this.roster); } }, 25000);
    this.emit('roster', this.roster);
    // the old code: the broker frees it once the old host's socket is gone; keep trying, then a new one
    const old = this.code;
    let ok = false;
    this._promoting = true;          // the broker keep-alive must not race this reclaim
    try {
      for (let i = 0; i < 12 && !ok && this.isHost; i++) {
        ok = await this._claimCode(old, 1).catch(() => false);
        if (!ok) await new Promise(r => setTimeout(r, 5000));
      }
      if (!ok && this.isHost) { await this._claimCode(null, 4).catch(() => false); }
    } finally { this._promoting = false; }
    if (this.isHost && this.code) { this.broadcast({ t: 'code', code: this.code }); rememberParty({ ...(lastParty() || {}), code: this.code, at: Date.now(), host: true }); this.emit('code', this.code); }
  }
  // I am not the successor: reconnect to whoever is (retrying while they set up)
  async follow(succ, name) {
    this.migrating = true;
    const deadline = performance.now() + 25000;
    while (performance.now() < deadline) {
      try { await this.join(this.code, name, { migrate: true, peerId: succ.peerId }); this.migrating = false; return true; }
      catch (e) { if (e.type === 'full' || e.type === 'ended') break; await new Promise(r => setTimeout(r, 1500)); }
    }
    this.migrating = false;
    return false;
  }

  // ================================================================== voice (mesh of audio calls)
  _wirePeer(peer) {
    peer.on('call', call => {
      call.answer(this.localStream || undefined);
      this._wireCall(call);
    });
    // the broker connection dropped (not the game links): re-register - unless we are leaving on purpose
    // (deferred for the same reason as the party-code peer: never reconnect a peer that is being destroyed)
    peer.on('disconnected', () => setTimeout(() => { if (!this.leaving && !peer.destroyed && peer.disconnected && this.peer === peer) { try { peer.reconnect(); } catch { /* ignore */ } } }, 0));
  }
  _wireCall(call) {
    this.calls.set(call.peer, call);
    call.on('stream', s => this.emit('voice', call.peer, s));
    call.on('close', () => { if (this.calls.get(call.peer) === call) this.calls.delete(call.peer); this.emit('voiceend', call.peer); });
    call.on('error', () => { if (this.calls.get(call.peer) === call) this.calls.delete(call.peer); });
  }
  // the lower peer id calls the higher one, so each pair has exactly one call
  connectVoice() {
    if (!this.peer) return;
    for (const r of this.roster) {
      if (r.peerId === this.peer.id || this.calls.has(r.peerId)) continue;
      if (this.peer.id < r.peerId) {
        const call = this.peer.call(r.peerId, this.localStream || new MediaStream());
        if (call) this._wireCall(call);
      }
    }
    for (const id of [...this.calls.keys()]) if (!this.roster.some(r => r.peerId === id)) { this.calls.get(id)?.close(); this.calls.delete(id); }
  }

  // clean exit: tell nobody (the host notices the closed connection), close everything, forget the party
  leave({ forget = true } = {}) {
    this.leaving = true;
    try { for (const c of this.calls.values()) c.close(); } catch { /* ignore */ }
    try { for (const c of this.conns.values()) c.close(); } catch { /* ignore */ }
    try { this.alias?.destroy(); } catch { /* ignore */ }
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.peer = null; this.alias = null; this.conns.clear(); this.calls.clear(); this.roster = []; this.status = 'idle';
    setTimeout(() => { this.leaving = false; }, 2000);
    if (forget) rememberParty(null);
  }
}
