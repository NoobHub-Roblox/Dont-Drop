const KEY_MAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
};

/**
 * Combines keyboard, pointer-drag (mouse/touch) and on-screen button input
 * into one analog vector: x = right (+), z = away from camera (+, "W").
 * All listeners are registered once and removed by dispose().
 */
export class Input {
  constructor(canvas, { dragRadius = 110 } = {}) {
    this.canvas = canvas;
    this.dragRadius = dragRadius;
    this.keys = new Set();
    this.pad = new Set();
    this.drag = null; // { id, sx, sy, x, z }
    this.enabled = true;
    this.ac = new AbortController();
    const opt = { signal: this.ac.signal };

    window.addEventListener('keydown', (e) => this._key(e, true), opt);
    window.addEventListener('keyup', (e) => this._key(e, false), opt);
    window.addEventListener('blur', () => this.clear(), opt);

    canvas.addEventListener('pointerdown', (e) => this._down(e), opt);
    window.addEventListener('pointermove', (e) => this._move(e), opt);
    window.addEventListener('pointerup', (e) => this._up(e), opt);
    window.addEventListener('pointercancel', (e) => this._up(e), opt);
  }

  _key(e, down) {
    const dir = KEY_MAP[e.code];
    if (!dir) return;
    if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    e.preventDefault();
    if (down) this.keys.add(dir); else this.keys.delete(dir);
  }

  _down(e) {
    if (!this.enabled || this.drag) return;
    this.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: 0, z: 0 };
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  _move(e) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = (e.clientX - d.sx) / this.dragRadius;
    const dy = (e.clientY - d.sy) / this.dragRadius;
    const len = Math.hypot(dx, dy);
    const k = len > 1 ? 1 / len : 1;
    d.x = dx * k;
    d.z = -dy * k; // dragging up tilts the far edge down (balls roll away)
  }

  _up(e) {
    if (this.drag && this.drag.id === e.pointerId) this.drag = null;
  }

  /** On-screen D-pad: hold a direction by name ('up' | 'down' | 'left' | 'right'). */
  setPad(dir, down) {
    if (down) this.pad.add(dir); else this.pad.delete(dir);
  }

  clear() {
    this.keys.clear();
    this.pad.clear();
    this.drag = null;
  }

  /** Current analog input in [-1, 1]. */
  get vector() {
    if (!this.enabled) return { x: 0, z: 0 };
    const held = (set, n) => (set.has(n) ? 1 : 0);
    let x = held(this.keys, 'right') - held(this.keys, 'left') + held(this.pad, 'right') - held(this.pad, 'left');
    let z = held(this.keys, 'up') - held(this.keys, 'down') + held(this.pad, 'up') - held(this.pad, 'down');
    if (this.drag) { x += this.drag.x; z += this.drag.z; }
    return { x: Math.max(-1, Math.min(1, x)), z: Math.max(-1, Math.min(1, z)) };
  }

  dispose() {
    this.ac.abort();
  }
}
