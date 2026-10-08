// Smoke test for a running build (vite preview / any static host):
//   node tools/smoke-test.mjs http://localhost:4173/
// Fetches the page, its bundle, all models and every audio file in the manifest.
import { MANIFEST } from '../src/audio/manifest.js';

const base = process.argv[2] || 'http://localhost:4173/';
const fails = [];
let ok = 0, bytes = 0;
async function check(path) {
  const url = new URL(path, base).href;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    const b = await r.arrayBuffer();
    bytes += b.byteLength; ok++;
    return new TextDecoder().decode(b.slice(0, 200000));
  } catch (e) { fails.push(`${path} -> ${e.message}`); return ''; }
}
const html = await check('');
for (const m of html.matchAll(/(?:src|href)="(\.?\/?assets\/[^"]+)"/g)) await check(m[1]);
for (const m of ['assets/models/hospital.glb', 'assets/models/items.glb', 'assets/models/koala.glb']) await check(m);
for (const u of new Set(Object.values(MANIFEST).flat())) await check(u);
console.log(`ok ${ok}, failed ${fails.length}, ${(bytes / 1e6).toFixed(2)} MB`);
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
