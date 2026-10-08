// Scripted voice lines (pre-rendered TTS audio shipped with the game) + subtitles.
import { audio } from '../audio/audio.js';
import { MANIFEST } from '../audio/manifest.js';

export const LINES = {
  vo_phone_threat: { text: '"I will kill you... tonight."', who: 'PHONE' },
  vo_phone_laugh: { text: '(distorted laughter)', who: 'PHONE' },
  vo_see_tonight: { text: '"See you tonight."', who: 'REFLECTION' },
  vo_intercom: { text: '"You shouldn\'t have turned it back on."', who: 'INTERCOM' },
  vo_phone_trapped: { text: '"You really thought I was the one trapped here?"', who: 'PHONE' },
  vo_phone_was_you: { text: '"It was you."', who: 'PHONE' },
  vo_employee: { text: '"You\'re the new night guard, right?"', who: 'EMPLOYEE' },
  vo_go_back: { text: '"GO BACK!"', who: '???' },
  // the protagonist — short, natural reactions at important moments only
  vo_arman_what_was_that: { text: 'What the hell was that?', who: 'ARMAN' },
  vo_arman_shit: { text: 'Shit.', who: 'ARMAN' },
  vo_arman_wait_what: { text: 'Wait... what was that?', who: 'ARMAN' },
  vo_arman_wtf: { text: 'What the fuck?!', who: 'ARMAN' },
  vo_arman_fuse_one: { text: 'One.', who: 'ARMAN' },
  vo_arman_another_one: { text: "That's another one.", who: 'ARMAN' },
  vo_arman_last_one: { text: "That's the last one.", who: 'ARMAN' },
  vo_arman_come_on: { text: 'Come on!', who: 'ARMAN' },
  vo_arman_run: { text: 'Run!', who: 'ARMAN' },
  vo_arman_get_away: { text: 'Get away from me!', who: 'ARMAN' },
  vo_arman_jesus: { text: 'Jesus...', who: 'ARMAN' },
  vo_arman_whos_there: { text: "Who's there?", who: 'ARMAN' },
  vo_arman_night_guard: { text: 'Night guard?', who: 'ARMAN' },
};

// Where Arman is decides how his voice sits in the space: a light room reverb at reception,
// a natural hospital reflection in the corridors, a slightly bigger one in the stairwell and
// the concrete basement, almost none outdoors. Panicked lines stay a little drier (closer).
function voiceSpace(g, key) {
  const p = g.player?.pos;
  const surf = g.player?.surfaceType?.() || 'tile';
  const panic = ['wtf', 'run', 'get_away', 'come_on'].includes(key) ? 0.7 : 1;
  if (surf === 'outside') return { reverb: 0.03 };
  if (surf === 'concrete') return { reverb: 0.28 * panic, bigReverb: 0.1 * panic };
  if (surf === 'stairs') return { reverb: 0.3 * panic, bigReverb: 0.04 };
  if (p && g.player.level === '1' && p.x < -10) return { reverb: 0.1 * panic };          // reception lobby
  if (p && Math.abs(p.z) < 1.5) return { reverb: 0.2 * panic, bigReverb: 0.03 };       // corridor
  return { reverb: 0.12 * panic };                                                       // rooms
}

// Never two of his lines on top of each other.
let armanBusyUntil = 0;
export function arman(g, key, opts = {}) {
  const now = performance.now();
  if (now < armanBusyUntil && !opts.force) return null;
  const id = 'vo_arman_' + key;
  const env = voiceSpace(g, key);
  armanBusyUntil = now + 1800;
  const delay = opts.delay ?? 0;
  const go = () => say(g.ui, id, { ...env, volume: opts.volume ?? 0.95 });
  if (delay > 0) (g.clock ? g.clock.wait(delay) : new Promise(r => setTimeout(r, delay * 1000))).then(go);
  else go();
  return true;
}

export async function say(ui, id, opts = {}) {
  const line = LINES[id];
  const url = MANIFEST[id]?.[0];
  let dur = Math.max(2.2, (line?.text.length || 20) * 0.07);
  let buf = null;
  if (audio.ready && url) {
    buf = await audio.loadUrl(url);
    if (buf) dur = buf.duration / (opts.rate ?? 1);
  }
  const h = audio.play(id, { bus: 'voice', volume: opts.volume ?? 1, reverb: opts.reverb ?? 0.15, bigReverb: opts.bigReverb, pos: opts.pos, hrtf: !!opts.pos, refDistance: opts.refDistance ?? 3, rate: opts.rate });
  if (line) ui.subtitle(line.text, line.who, dur + 0.6);
  const waitFn = opts.wait || (s => new Promise(res => setTimeout(res, s * 1000)));
  await waitFn(dur);
  return h;
}
