// Keyboard + mouse + pointer lock handling.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0; this.mouseDY = 0;
    this.locked = false;
    this.enabled = false;
    this.onLockChange = null;
    this.lockFailed = false;

    window.addEventListener('keydown', e => {
      if (e.repeat) { if (this.enabled && this.isGameKey(e.code)) e.preventDefault(); return; }
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (this.enabled && this.isGameKey(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); });
    document.addEventListener('mousemove', e => {
      // Mouse-look only through Pointer Lock — no button holding required.
      if (!this.locked) return;
      // Guard against browser spikes on lock acquisition.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX; this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.lockFailed = true;
      console.warn('[input] pointer lock request failed (needs a user gesture).');
    });
  }
  isGameKey(code) {
    return ['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ControlLeft', 'ControlRight', 'KeyF', 'KeyE', 'KeyR', 'ShiftLeft', 'Tab'].includes(code);
  }
  requestLock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => {
        try { const q = this.canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch { /* ignore */ }
      });
    } catch {
      try { this.canvas.requestPointerLock(); } catch { /* ignore */ }
    }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  down(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  consumeMouse() { const d = [this.mouseDX, this.mouseDY]; this.mouseDX = 0; this.mouseDY = 0; return d; }
  endFrame() { this.pressed.clear(); }
}
