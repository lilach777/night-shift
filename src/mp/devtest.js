// DEV ONLY - scripted multiplayer playthrough on the host with bot teammates (never bundled into the
// game: imported manually from the console). Every step goes through the real host code paths
// (requests, holds, positions); it only replaces walking with teleports.
const NS = () => window.NS;
const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function step(sec = 0.5) {
  const n = Math.round(sec * 60);
  for (let i = 0; i < n; i++) { NS().frame(1 / 60); NS().input.endFrame(); if (i % 20 === 0) await sleep(0); }
}
export const obj = () => [...document.querySelectorAll('.mp-obj')].map(e => e.textContent).join(' | ');
const S = () => NS().mp.session;
const st = () => S().story.state;
const at = () => S().story.stepId;
const me = (x, y, z, yaw = 0) => NS().player.teleport(x, y, z, yaw);
let B = [];

export async function start(bots = 1) {
  // creating a party now needs the creator's entry: with the local dev wallet (?devwallet=1) press PAY in the dialog
  for (let i = 0; i < 120 && !(NS() && NS().mp?.net.code); i++) {
    const pay = [...document.querySelectorAll('#w3-modal button')].find(b => /PAY & CREATE|^CREATE PARTY$/.test(b.textContent) && !b.disabled);
    if (pay) pay.click();
    await sleep(250);
  }
  NS().mp.hostStart();
  for (let i = 0; i < 80 && !S()?.started; i++) await sleep(250);
  NS().pause = () => {};
  B = [];
  for (let i = 0; i < bots; i++) B.push(await S().devBot('BOT' + (i + 1)));
  window.B = B;
  await step(0.3);
  return B;
}
const all = (x, y, z, yaw = 0) => { me(x, y, z, yaw); B.forEach((b, i) => b.move(x + 0.9 * (i + 1), y, z + 0.5, yaw)); };
const waitFor = async (fn, sec = 30, label = '') => { for (let i = 0; i < sec * 4; i++) { if (fn()) return true; await step(0.25); } console.warn('[devtest] timeout', label, at(), obj()); return false; };

// one action per story step (what a real crew would do there)
const ACT = {
  order: async () => S().handleReq(0, 'read', { doc: 'order' }),
  enter: async () => all(-18, 0, 0.5, Math.PI / 2),
  desk: async () => me(-16.2, 0, -2.6, Math.PI),
  sit: async () => { const b = B[0]; if (b) { b.p.seated = true; b.move(-16.6, 0, -5.15); b.req('sit'); } else S().story.sitDown(); },
  wait: async () => waitFor(() => st().ringing, 10, 'ring'),
  answer: async () => { S().handleReq(0, 'answer'); await waitFor(() => st().callDone, 40, 'call'); },
  flash: async () => { S().handleReq(0, 'flash', { i: 0 }); B.forEach((b, i) => b.req('flash', { i: i + 1 })); },
  stand: async () => { B.forEach(b => { b.p.seated = false; b.move(-15.5, 0, -2.5); }); if (S().story.inChair) S().story.standUp(); },
  drawer: async () => S().handleReq(0, 'drawer'),
  keycard: async () => S().handleReq(0, 'keycard'),
  door103: async () => S().handleReq(0, 'door', { id: 'door_103' }),
  log: async () => S().handleReq(0, 'read', { doc: 'log' }),
  bkey: async () => S().handleReq(0, 'bkey'),
  gate: async () => S().handleReq(0, 'gate'),
  down: async () => { await step(1.5); all(20.4, -4, 0, Math.PI / 2); },
  b10: async () => S().handleReq(0, 'b10'),
  locate: async () => all(-19.0, -4, -4.6, Math.PI / 2),
  gen: async () => {
    const b = B[0]; if (b) b.hold('mp_primer', true); else S().setHold(0, 'mp_primer', true);
    await step(0.8); for (let i = 0; i < 3; i++) { S().handleReq(0, 'cord'); await step(0.3); }
    if (b) b.hold('mp_primer', false); else S().setHold(0, 'mp_primer', false);
  },
  panel: async () => S().handleReq(0, 'panel'),
  fuses: async () => {
    for (const f of st().fuses) {
      if (f.st === 'inserted') continue;
      me(f.pos[0], Math.floor((f.pos[1] + 0.6) / 4) * 4, f.pos[2]); await step(0.2);
      S().handleReq(0, 'fuse', { n: f.n }); await step(0.3);
      S().story.closeReader?.();
      if (st().lockdown) {             // the gate locked: release + override together
        all(21.3, 0, -1.0); const b = B[0];
        S().setHold(0, 'mp_override_0', true); if (b) b.hold('mp_release_0', true); else S().setHold(0, 'mp_release_0', true);
        await waitFor(() => !st().lockdown, 8, 'lockdown');
        S().setHold(0, 'mp_override_0', false); if (b) b.hold('mp_release_0', false); else S().setHold(0, 'mp_release_0', false);
      }
      all(-17, -4, -7.4); await step(0.2);
      S().handleReq(0, 'insert'); await step(0.3);
    }
  },
  main: async () => { const b = B[0]; S().setHold(0, 'mp_breakerA', true); if (b) b.hold('mp_breakerB', true); else S().setHold(0, 'mp_breakerB', true); await waitFor(() => st().power === 'main', 6, 'main'); S().setHold(0, 'mp_breakerA', false); if (b) b.hold('mp_breakerB', false); else S().setHold(0, 'mp_breakerB', false); },
  sec: async () => all(12.4, 12, -5.6, 0),
  cctv: async () => S().handleReq(0, 'cctv'),
  file: async () => S().handleReq(0, 'read', { doc: 'file' }),
  b11cam: async () => S().handleReq(0, 'b11cam'),
  safe: async () => { await step(12); all(-17.5, 12, -4.0, Math.PI / 2); await step(0.3); S().handleReq(0, 'safelock'); },
  quiet: async () => waitFor(() => st().besiege === 'done', 50, 'besiege'),
  switches: async () => {
    const b = B[0], P = S().story.P;
    me(P.sw[0].pos.x, 12, P.sw[0].pos.z - 1); S().setHold(0, 'mp_sw_0', true); await waitFor(() => st().switches[0], 9, 'sw0'); S().setHold(0, 'mp_sw_0', false);
    me(P.sw[1].pos.x - 1, 8, P.sw[1].pos.z); S().setHold(0, 'mp_sw_1', true); if (b) b.hold('mp_sw_1b', true); else S().setHold(0, 'mp_sw_1b', true);
    await waitFor(() => st().switches[1], 6, 'sw1'); S().setHold(0, 'mp_sw_1', false); if (b) b.hold('mp_sw_1b', false); else S().setHold(0, 'mp_sw_1b', false);
    me(P.sw[2].pos.x + 1, -4, P.sw[2].pos.z); S().setHold(0, 'mp_sw_2', true); await waitFor(() => st().switches[2], 9, 'sw2'); S().setHold(0, 'mp_sw_2', false);
  },
  return: async () => all(-8, -4, -3.0, 0),
  purge: async () => S().handleReq(0, 'purge'),
  lobby: async () => {
    await step(2);
    // the shutter: one cranks from the west, the bot crouches under, then cranks from the east for the host
    const b = B[0];
    me(1.6, -4, 0.9); if (b) b.move(2.5, -4, 0);
    S().setHold(0, 'mp_crank_0', true); await waitFor(() => S().story.shutter.amount > 0.45, 6, 'crank west');
    if (b) { b.p.crouch = true; b.move(6.0, -4, 0); await step(0.2); b.p.crouch = false; }
    S().setHold(0, 'mp_crank_0', false); await step(1.5);
    if (b) { b.move(6.4, -4, -0.9); b.hold('mp_crank_1', true); await waitFor(() => S().story.shutter.amount > 0.7, 6, 'crank east'); }
    else { S().setHold(0, 'mp_crank_0', true); await waitFor(() => S().story.shutter.amount > 0.7, 6, 'crank solo'); S().setHold(0, 'mp_crank_0', false); }
    me(6.0, -4, 0); await step(0.3);
    if (b) b.hold('mp_crank_1', false);
    all(-15, 0, 0, Math.PI / 2);
  },
  exit: async () => { const b = B[0]?.p.life === 'alive' ? B[0] : null; S().setHold(0, 'mp_code', true); if (b) b.hold('mp_exitRelease', true); else S().setHold(0, 'mp_exitRelease', true); await waitFor(() => st().exitOpen, 6, 'exit'); S().setHold(0, 'mp_code', false); if (b) b.hold('mp_exitRelease', false); else S().setHold(0, 'mp_exitRelease', false); },
  out: async () => all(-26, 0, 0, -Math.PI / 2),
};

// play forward until the story reaches step `upTo` (or the end); returns a log of objectives
export async function run(upTo = 'end', log = []) {
  for (let guard = 0; guard < 60; guard++) {
    const id = at();
    if (!id || id === upTo || id === 'end') break;
    const before = st().step;
    log.push(`${id} @ ${S().story.clockText()} :: ${obj()}`);
    await ACT[id]?.();
    await waitFor(() => st().step !== before, 20, id);
    await step(0.2);
  }
  log.push(`now: ${at()} @ ${S().story.clockText()} :: ${obj()}`);
  return log;
}

export const life = {
  down: slot => S().down(slot),
  state: () => S().roster.map(p => `${p.name}:${p.life}:${Math.ceil(p.bleed)}`).join(' '),
};
