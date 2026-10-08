// Plays camera animations authored in Blender (blender/scripts/ns_camera.py) and baked to
// public/assets/cams/<name>.json: per-frame position, quaternion and vertical FOV in three.js
// space. Frames are interpolated (lerp / slerp) except across authored hard cuts.
import * as THREE from 'three';

const cache = new Map();
export function loadCamTrack(name) {
  if (!cache.has(name)) {
    cache.set(name, fetch(`${import.meta.env.BASE_URL}assets/cams/${name}.json`)
      .then(r => (r.ok ? r.json() : null)).catch(() => null));
  }
  return cache.get(name);
}

const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
export class CamTrack {
  constructor(data) {
    this.d = data;
    this.fps = data.fps;
    this.start = data.start || 0;
    this.end = this.start + (data.frames.length - 1) / this.fps;
  }
  // applies the pose at time t (seconds, track time) to the camera; returns false outside the track
  apply(cam, t) {
    const F = this.d.frames;
    if (t < this.start || t > this.end) return false;
    const x = (t - this.start) * this.fps;
    const i = Math.min(F.length - 1, Math.floor(x));
    const j = Math.min(F.length - 1, i + 1);
    let u = x - i;
    // never blend across a hard cut
    const ti = this.start + i / this.fps, tj = this.start + j / this.fps;
    if (this.d.cuts?.some(c => c > ti + 1e-4 && c <= tj + 1e-4)) u = t >= this.d.cuts.find(c => c > ti + 1e-4) ? 1 : 0;
    const a = F[i], b = F[j];
    cam.position.set(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);
    qa.set(a[3], a[4], a[5], a[6]); qb.set(b[3], b[4], b[5], b[6]);
    cam.quaternion.copy(qa.slerp(qb, u));
    const fov = a[7] + (b[7] - a[7]) * u;
    if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
    return true;
  }
}
