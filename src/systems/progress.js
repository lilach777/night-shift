// The narrative clock and the current objective — both DERIVED from the real game state
// (story stage, flags, fuses, switches, an active chase), never from timers. Because they
// are derived, they are automatically correct after a death / checkpoint reload.
import { STAGES } from './story.js';
import { audio } from '../audio/audio.js';

// Narrative time (minutes after midnight) at which each stage begins. Within a stage the
// clock runs on (1 game minute per CLOCK_RATE real seconds) but never passes the next
// stage's time, so the night always reaches 6:00 AM exactly at the ending.
export const STAGE_TIME = {
  call: 2 * 60 + 13, dark: 2 * 60 + 16, basement: 2 * 60 + 20, powerroom: 2 * 60 + 48, search: 2 * 60 + 52, return: 3 * 60 + 40,
  restored: 3 * 60 + 52, aux: 3 * 60 + 56, security: 4 * 60 + 18, chase: 4 * 60 + 24, switches: 4 * 60 + 33,
  final: 5 * 60 + 22, containment: 5 * 60 + 41, ending: 6 * 60, end: 6 * 60,
};
const CLOCK_RATE = 12;

export function stageTime(stage) {
  let best = null;
  for (const s of STAGES) { if (STAGE_TIME[s] != null) best = STAGE_TIME[s]; if (s === stage) break; }
  return best;
}
function nextStageTime(stage) {
  const i = STAGES.indexOf(stage);
  for (const s of STAGES.slice(i + 1)) if (STAGE_TIME[s] != null && STAGE_TIME[s] > (stageTime(stage) ?? 0)) return STAGE_TIME[s];
  return 6 * 60;
}

export function formatTime(min) {
  const m = Math.floor(min) % (24 * 60);
  const h = Math.floor(m / 60), mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export class Progress {
  constructor(g) {
    this.g = g;
    this.minutes = null;          // narrative clock; null = not shown yet (before 2:13 AM)
  }

  // ------------------------------------------------------------------ clock
  syncClock() {
    const st = this.g.story.stage;
    const t0 = stageTime(st);
    if (t0 == null || STAGES.indexOf(st) < STAGES.indexOf('call')) { this.minutes = null; return; }
    if (this.minutes == null || this.minutes < t0) this.minutes = t0;
  }
  updateClock(dt) {
    const st = this.g.story.stage;
    this.syncClock();
    if (this.minutes == null) return;
    if (st === 'ending' || st === 'end') { this.minutes = Math.min(6 * 60, this.minutes); return; }
    const cap = nextStageTime(st) - 1;
    if (this.minutes < cap) this.minutes = Math.min(cap, this.minutes + dt / CLOCK_RATE);
  }
  get clockText() { return this.minutes == null ? null : formatTime(this.minutes); }

  // ------------------------------------------------------------------ objective
  // The ONE thing the player has to do right now (or null).
  objective() {
    const g = this.g, S = g.story, st = S.stage, F = S.flags;
    if (!st || STAGES.indexOf(st) < STAGES.indexOf('dark')) return null;
    if (['containment', 'ending', 'end'].includes(st)) return null;
    // any active Koala chase overrides everything else
    if (g.ai?.isChasing?.()) return { text: 'RUN.', chase: true };
    if (st === 'dark') return g.flashlight.has ? null : { text: 'Find the flashlight' };
    if (STAGES.indexOf(st) < STAGES.indexOf('restored')) {
      if (!F.reachedB) return { text: 'Reach the basement' };
      const n = g.fuses.collected;
      if (n < 4) return { text: 'Find the 4 missing fuses', count: `FUSES: ${n}/4` };
      return { text: 'Restore power' };
    }
    if (st === 'restored' || st === 'aux' || st === 'security') return F.auxObjective ? { text: 'Find the source of the auxiliary power' } : null;
    if (st === 'chase') return { text: 'Escape the Koala' };
    if (st === 'switches') return { text: 'Activate the emergency containment system', count: `SWITCHES: ${S.switchCount}/3` };
    if (st === 'final') return { text: 'Return to the basement' };
    return null;
  }

  update(dt) {
    const g = this.g;
    this.updateClock(dt);
    const playing = g.state === 'play' && !g.morning;
    const txt = this.clockText;
    g.ui.setClock(txt || '', !!txt && playing && !g.story.hideHud);
    const obj = g.story.hideHud ? null : this.objective();
    // a subtle confirmation sound when a real objective is completed (not for chase switches)
    const prev = this._lastObj;
    if (prev && !prev.chase && (!obj || obj.text !== prev.text) && !(obj && obj.chase) && this._objectiveDone(prev, obj)) {
      audio.play('ui_confirm', { bus: 'ui', volume: 0.18 });
    }
    this._lastObj = obj;
    g.ui.setObjective(obj);
  }
  // only count real progress (not e.g. a chase interrupting and the objective coming back)
  _objectiveDone(prev, obj) {
    const order = ['Find the flashlight', 'Reach the basement', 'Find the 4 missing fuses', 'Restore power',
      'Find the source of the auxiliary power', 'Escape the Koala', 'Activate the emergency containment system', 'Return to the basement'];
    const a = order.indexOf(prev.text), b = obj ? order.indexOf(obj.text) : order.length;
    return a >= 0 && b > a;
  }
}
