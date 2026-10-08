// DOM UI: screens, settings, HUD, prompts, subtitles, thoughts, reader, fades.
import { settings, DEFAULTS } from '../core/settings.js';
import { audio } from '../audio/audio.js';

const $ = id => document.getElementById(id);

const SETTINGS_SCHEMA = {
  graphics: [
    ['quality', 'Quality', 'select', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]],
    ['resolutionScale', 'Resolution scale', 'range', [0.5, 1, 0.05], v => Math.round(v * 100) + '%'],
    ['shadows', 'Shadows', 'check'],
    ['effects', 'Post effects (grain, vignette)', 'check'],
    ['viewDistance', 'View distance', 'range', [20, 70, 5], v => v + ' m'],
  ],
  audio: [
    ['master', 'Master', 'range', [0, 1, 0.01], v => Math.round(v * 100) + '%'],
    ['music', 'Music', 'range', [0, 1, 0.01], v => Math.round(v * 100) + '%'],
    ['voice', 'Voice', 'range', [0, 1, 0.01], v => Math.round(v * 100) + '%'],
    ['sfx', 'SFX', 'range', [0, 1, 0.01], v => Math.round(v * 100) + '%'],
    ['ambience', 'Ambience', 'range', [0, 1, 0.01], v => Math.round(v * 100) + '%'],
    ['voiceMode', 'Voice chat (multiplayer)', 'select', [['ptt', 'Push to talk'], ['open', 'Open mic']]],
    ['pttKey', 'Push-to-talk key', 'key'],
    ['chatVolume', 'Teammates\' voices', 'range', [0, 1.5, 0.05], v => Math.round(v * 100) + '%'],
  ],
  gameplay: [
    ['sensitivity', 'Mouse sensitivity', 'range', [0.2, 3, 0.05], v => v.toFixed(2)],
    ['invertY', 'Invert Y', 'check'],
    ['headBob', 'Head bob', 'check'],
    ['screenShake', 'Camera shake (impacts, scares)', 'check'],
  ],
  accessibility: [
    ['subtitles', 'Subtitles', 'check'],
    ['subtitleSize', 'Subtitle size', 'select', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]],
    ['flashIntensity', 'Flash intensity (lightning, scares)', 'range', [0, 1, 0.05], v => Math.round(v * 100) + '%'],
    ['cameraShake', 'Camera sway & motion', 'check'],
  ],
};
const RELOAD_KEYS = new Set(['quality', 'shadows']);
export const keyLabel = code => (code || '').replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'NUM ').replace('Left', ' L').replace('Right', ' R').toUpperCase() || '-';

export class UI {
  constructor() {
    this.screenStack = [];
    this.handlers = {};
    this.toastT = 0; this.thoughtT = 0;
    this.subs = [];
    this.tab = 'graphics';
    this.needsReloadNote = false;
    document.querySelectorAll('[data-action]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        this.click();
        const a = b.dataset.action;
        if (a === 'settings') return this.openSettings();
        if (a === 'credits') return this.show('credits', true);
        if (a === 'back') return this.back();
        if (a === 'reset-settings') { settings.reset(); this.renderSettings(); return; }
        this.handlers[a] && this.handlers[a]();
      });
      b.addEventListener('mouseenter', () => audio.play('ui_hover', { bus: 'ui', volume: 0.35 }));
    });
    document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
      this.click();
      this.tab = b.dataset.tab;
      document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
      this.renderSettings();
    }));
    this.applySubtitleSize();
    settings.onChange(() => this.applySubtitleSize());
  }

  on(action, fn) { this.handlers[action] = fn; }
  click() { audio.play('ui_click', { bus: 'ui', volume: 0.5 }); }

  // ---------------------------------------------------------------- screens
  show(id, push = false) {
    if (!push) { this.screenStack = []; document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); }
    else if (this.screenStack.length) $(this.screenStack[this.screenStack.length - 1]).classList.remove('active');
    if (id) { $(id).classList.add('active'); this.screenStack.push(id); }
  }
  hideAll() { this.show(null); }
  back() {
    const cur = this.screenStack.pop();
    if (cur) $(cur).classList.remove('active');
    const prev = this.screenStack[this.screenStack.length - 1];
    if (prev) $(prev).classList.add('active');
    if (cur === 'settings' && this.onSettingsClosed) this.onSettingsClosed();
  }
  get current() { return this.screenStack[this.screenStack.length - 1] || null; }

  openSettings() { this.show('settings', true); this.renderSettings(); }

  renderSettings() {
    const body = $('settings-body');
    body.innerHTML = '';
    for (const [key, label, type, opt, fmt] of SETTINGS_SCHEMA[this.tab]) {
      const row = document.createElement('div'); row.className = 'row';
      const lab = document.createElement('label'); lab.textContent = label.toUpperCase();
      const out = document.createElement('output');
      let input;
      const val = settings.get(this.tab, key);
      if (type === 'range') {
        input = document.createElement('input'); input.type = 'range';
        [input.min, input.max, input.step] = opt; input.value = val;
        out.textContent = fmt(val);
        input.addEventListener('input', () => { const v = parseFloat(input.value); settings.set(this.tab, key, v); out.textContent = fmt(v); });
      } else if (type === 'key') {
        // key binding: click, then press the key you want (Esc cancels)
        input = document.createElement('button'); input.className = 'keybind'; input.type = 'button';
        input.textContent = keyLabel(val);
        input.addEventListener('click', e => {
          e.stopPropagation(); this.click();
          input.textContent = 'PRESS A KEY...'; input.classList.add('wait');
          const onKey = ev => {
            ev.preventDefault(); ev.stopPropagation();
            window.removeEventListener('keydown', onKey, true);
            input.classList.remove('wait');
            const reserved = ['Escape', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyR', 'ShiftLeft', 'ControlLeft', 'Space'];
            if (ev.code !== 'Escape' && !reserved.includes(ev.code)) settings.set(this.tab, key, ev.code);
            input.textContent = keyLabel(settings.get(this.tab, key));
          };
          window.addEventListener('keydown', onKey, true);
        });
      } else if (type === 'check') {
        input = document.createElement('input'); input.type = 'checkbox'; input.checked = val;
        input.addEventListener('change', () => { settings.set(this.tab, key, input.checked); this.click(); this.reloadNote(key, out); });
      } else {
        input = document.createElement('select');
        for (const [v, t] of opt) { const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === val) o.selected = true; input.appendChild(o); }
        input.addEventListener('change', () => { settings.set(this.tab, key, input.value); this.click(); this.reloadNote(key, out); });
      }
      lab.htmlFor = input.id = 'set-' + key;
      row.append(lab, input, out);
      body.appendChild(row);
    }
  }
  reloadNote(key, out) {
    if (RELOAD_KEYS.has(key) && this.onNeedsRestartRender) this.onNeedsRestartRender();
  }

  // ---------------------------------------------------------------- loading
  setLoading(p, text) {
    $('loading-bar').style.width = Math.round(p * 100) + '%';
    if (text) $('loading-text').textContent = text;
  }
  bootError(msg) {
    const e = $('boot-error'); e.classList.remove('hidden'); e.innerHTML = msg;
    $('loading-text').textContent = '';
  }

  // ---------------------------------------------------------------- HUD
  hud(show) { $('hud').classList.toggle('hidden', !show); }
  setPrompt(text) {
    const p = $('prompt');
    if (!text) { p.classList.add('hidden'); this._prompt = null; return; }
    if (text !== this._prompt) {
      this._prompt = text;
      p.innerHTML = text.replace(/^\[(\w+)\]\s*/, '<b>$1</b>');
    }
    p.classList.remove('hidden');
  }
  // (legacy: the fuse count now lives in the objective panel)
  setFuses() {}

  // Current objective. Same text -> only the counter updates in place. A different objective
  // -> the old one fades out, a short pause, then the new one fades in. null -> fades away.
  setObjective(obj) {
    const key = obj ? obj.text : null;
    const el = $('hud-objective');
    if (key === this._objKey) {
      if (obj && el.querySelector('.count').textContent !== (obj.count || '')) {
        el.querySelector('.count').textContent = obj.count || '';
        if (this._objPending) this._objPending.count = obj.count;
      }
      return;
    }
    const first = this._objKey === undefined;
    this._objKey = key;
    clearTimeout(this._objT1); clearTimeout(this._objT2);
    const show = () => {
      if (!obj) { el.classList.add('hidden'); return; }
      el.querySelector('.text').textContent = obj.text;
      el.querySelector('.count').textContent = obj.count || '';
      el.classList.remove('hidden');
      el.classList.add('fade');
      void el.offsetWidth;
      el.classList.remove('fade');
    };
    if (first || el.classList.contains('hidden')) { show(); return; }
    el.classList.add('fade');                                   // fade the completed one out
    const urgent = obj?.chase || this._objChase;                // a chase: switch almost instantly
    this._objChase = !!obj?.chase;
    this._objT1 = setTimeout(() => {
      el.classList.add('hidden');
      this._objT2 = setTimeout(show, obj ? (urgent ? 80 : 650) : 0);   // brief pause, then the next one
    }, urgent ? 250 : 700);
    if (obj && !first && this.onObjectiveChanged) this.onObjectiveChanged();
  }
  resetObjective() { this._objKey = undefined; clearTimeout(this._objT1); clearTimeout(this._objT2); $('hud-objective').classList.add('hidden'); }

  setClock(text, show = true) {
    const el = $('hud-clock');
    el.classList.toggle('hidden', !show);
    if (el.textContent !== text) el.textContent = text;
  }
  setLives(n, show = true) {
    const el = $('hud-lives');
    el.classList.toggle('hidden', !show);
    el.querySelector('b').textContent = String(n);
  }
  // shown while sprinting, recovering or low; fades out when full and idle
  setStamina(v, { sprinting = false, exhausted = false, show = true } = {}) {
    const el = $('hud-stamina');
    if (!show) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.querySelector('.fill').style.width = `${Math.round(v * 100)}%`;
    el.classList.toggle('low', v < 0.25 && !exhausted);
    el.classList.toggle('out', exhausted);
    if (sprinting || v < 0.999) this._stamFull = 0; else this._stamFull = (this._stamFull || 0) + 1;
    el.classList.toggle('fade', this._stamFull > 90);
  }
  setBattery(pct, spares, show = true) {
    const el = $('hud-battery');
    el.classList.toggle('hidden', !show);
    el.querySelector('b').textContent = `${Math.ceil(pct)}%`;
    el.classList.toggle('low', pct < 20);
    $('hud-spares').textContent = spares > 0 ? `+${spares}` : '';
  }
  toast(text, seconds = 2.6) {
    const t = $('toast'); t.textContent = text; t.classList.remove('hidden'); t.style.opacity = 1; this.toastT = seconds;
  }
  thought(text, seconds = 4.5) {
    const t = $('thought'); t.textContent = text; t.classList.remove('hidden'); t.style.opacity = 1; this.thoughtT = seconds;
  }
  read(title, html, close = '[E] CLOSE') {
    const r = $('reader');
    if (title == null) { r.classList.add('hidden'); this.reading = false; return; }
    r.innerHTML = `${title ? `<h3>${title}</h3>` : ''}${html}<span class="close">${close}</span>`;
    r.classList.remove('hidden');
    this.reading = true;
  }

  // ---------------------------------------------------------------- subtitles
  applySubtitleSize() {
    const s = $('subtitles');
    s.className = 'size-' + settings.data.accessibility.subtitleSize;
  }
  subtitle(text, who, seconds) {
    if (!settings.data.accessibility.subtitles) return;
    const box = $('subtitles');
    const line = document.createElement('div');
    line.className = 'line';
    line.innerHTML = (who ? `<span class="who">[${who}]</span>` : '') + text;
    box.appendChild(document.createElement('br'));
    box.appendChild(line);
    requestAnimationFrame(() => line.classList.add('show'));
    this.subs.push({ el: line, t: seconds });
  }
  clearSubtitles() { $('subtitles').innerHTML = ''; this.subs = []; }

  // ---------------------------------------------------------------- overlays
  fade(to, seconds = 1) {
    const f = $('fade');
    f.style.transition = `opacity ${seconds}s`;
    f.style.opacity = to;
    return new Promise(r => setTimeout(r, seconds * 1000));
  }
  fadeInstant(v) { const f = $('fade'); f.style.transition = 'none'; f.style.opacity = v; void f.offsetWidth; }
  flash(strength = 0.6, color = '#fff') {
    const f = $('flash');
    f.style.background = color;
    f.style.transition = 'none'; f.style.opacity = strength;
    void f.offsetWidth;
    f.style.transition = 'opacity 0.5s'; f.style.opacity = 0;
  }
  timecard(text, seconds = 3) {
    const t = $('timecard');
    t.textContent = text; t.classList.remove('hidden'); t.style.opacity = 0;
    requestAnimationFrame(() => { t.style.opacity = 1; });
    return new Promise(r => setTimeout(() => { t.style.opacity = 0; setTimeout(() => { t.classList.add('hidden'); r(); }, 1200); }, seconds * 1000));
  }
  letterbox(on) { $('letterbox').classList.toggle('hidden', !on); }
  clickToPlay(show, onClick) {
    const el = $('click-to-play');
    el.classList.toggle('hidden', !show);
    el.onclick = show ? (e) => { e.stopPropagation(); onClick && onClick(); } : null;
  }
  ending(show) { $('ending').classList.toggle('hidden', !show); }

  update(dt) {
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) { $('toast').style.opacity = 0; } }
    if (this.thoughtT > 0) { this.thoughtT -= dt; if (this.thoughtT <= 0) { $('thought').style.opacity = 0; } }
    for (let i = this.subs.length - 1; i >= 0; i--) {
      const s = this.subs[i];
      s.t -= dt;
      if (s.t <= 0) {
        s.el.classList.remove('show');
        const el = s.el;
        setTimeout(() => { const br = el.previousSibling; el.remove(); if (br && br.tagName === 'BR') br.remove(); }, 400);
        this.subs.splice(i, 1);
      }
    }
  }
}
