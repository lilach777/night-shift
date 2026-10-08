// Safe localStorage wrapper — never throws (private mode, quota, disabled storage).
let memory = {};
let available = null;

function check() {
  if (available !== null) return available;
  try {
    const k = '__ns_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    available = true;
  } catch {
    available = false;
    console.warn('[storage] localStorage unavailable — settings/progress will not persist this session.');
  }
  return available;
}

export function readJSON(key, fallback = null) {
  try {
    const raw = check() ? window.localStorage.getItem(key) : memory[key];
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[storage] failed to read', key, e);
    return fallback;
  }
}

export function writeJSON(key, value) {
  const raw = JSON.stringify(value);
  try {
    if (check()) window.localStorage.setItem(key, raw);
    else memory[key] = raw;
    return true;
  } catch (e) {
    console.warn('[storage] failed to write', key, e);
    memory[key] = raw;
    return false;
  }
}

export function remove(key) {
  try {
    if (check()) window.localStorage.removeItem(key);
  } catch { /* ignore */ }
  delete memory[key];
}
