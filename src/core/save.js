import { readJSON, writeJSON, remove } from './storage.js';

const KEY = 'nightshift.save.v1';

export const save = {
  load() {
    const s = readJSON(KEY);
    if (!s || s.version !== 1) return null;
    return s;
  },
  write(state) { return writeJSON(KEY, { ...state, version: 1, savedAt: Date.now() }); },
  clear() { remove(KEY); },
  exists() { return !!this.load(); },
};
