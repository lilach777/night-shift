import { readJSON, writeJSON } from './storage.js';

const KEY = 'nightshift.settings.v1';

export const DEFAULTS = {
  graphics: { quality: 'high', resolutionScale: 1.0, shadows: true, effects: true, viewDistance: 45 },
  audio: { master: 0.9, music: 0.10, voice: 1.0, sfx: 0.8, ambience: 0.6, voiceMode: 'ptt', pttKey: 'KeyV', chatVolume: 1.0 },
  gameplay: { sensitivity: 1.0, invertY: false, headBob: true, screenShake: true },
  accessibility: { subtitles: true, subtitleSize: 'medium', flashIntensity: 1.0, cameraShake: true },
};

function merge(base, over) {
  const out = structuredClone(base);
  if (!over || typeof over !== 'object') return out;
  for (const sec of Object.keys(base)) {
    if (!over[sec]) continue;
    for (const k of Object.keys(base[sec])) {
      if (over[sec][k] !== undefined && typeof over[sec][k] === typeof base[sec][k]) out[sec][k] = over[sec][k];
    }
  }
  return out;
}

class Settings {
  constructor() {
    this.data = merge(DEFAULTS, readJSON(KEY));
    this.listeners = new Set();
  }
  get(sec, key) { return this.data[sec][key]; }
  set(sec, key, value) {
    this.data[sec][key] = value;
    writeJSON(KEY, this.data);
    for (const fn of this.listeners) fn(sec, key, value);
  }
  reset() {
    this.data = structuredClone(DEFAULTS);
    writeJSON(KEY, this.data);
    for (const fn of this.listeners) fn('*', '*', null);
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

export const settings = new Settings();
