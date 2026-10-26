/** Fully synthesized, subtle sound effects (no audio files needed). */
export class AudioManager {
  constructor({ enabled = true, volume = 0.7 } = {}) {
    this.enabled = enabled;
    this.volume = volume;
    this.ctx = null;
    this.master = null;
    this.rollGain = null;
    this.rollFilter = null;
    this.lastImpact = 0;
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch { return; }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? this.volume * 0.6 : 0;
      this.master.connect(this.ctx.destination);
      this._initRoll();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    this._applyVolume();
  }

  setVolume(v) {
    this.volume = v;
    this._applyVolume();
  }

  _applyVolume() {
    if (this.master) this.master.gain.setTargetAtTime(this.enabled ? this.volume * 0.6 : 0, this.ctx.currentTime, 0.03);
  }

  _initRoll() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { // brown noise: soft rumble
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = 'lowpass';
    this.rollFilter.frequency.value = 200;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    src.connect(this.rollFilter).connect(this.rollGain).connect(this.master);
    src.start();
  }

  /** speed: fastest ball speed on the platform (m/s). Pass 0 to silence. */
  setRoll(speed) {
    if (!this.ctx || !this.rollGain) return;
    const s = Math.min(speed, 8);
    const g = s < 0.15 ? 0 : Math.min(0.16, s * 0.022);
    this.rollGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.06);
    this.rollFilter.frequency.setTargetAtTime(160 + s * 90, this.ctx.currentTime, 0.08);
  }

  _tone(freq, dur, { type = 'sine', gain = 0.2, slideTo = null, delay = 0, attack = 0.005 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  click() { this._tone(520, 0.07, { type: 'triangle', gain: 0.12, slideTo: 380 }); }
  hover() { this._tone(700, 0.04, { type: 'sine', gain: 0.04 }); }

  impact(strength) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastImpact < 0.05) return;
    this.lastImpact = now;
    const g = Math.min(0.2, 0.02 + strength * 0.012);
    this._tone(300 + Math.random() * 180, 0.09, { type: 'triangle', gain: g, slideTo: 160 });
  }

  hole(order = 0) {
    const base = 520 * Math.pow(1.122, order * 2);
    this._tone(base, 0.35, { type: 'sine', gain: 0.18, slideTo: base * 0.55 });
    this._tone(base * 1.5, 0.45, { type: 'sine', gain: 0.1, delay: 0.08 });
  }

  teleport() {
    this._tone(260, 0.28, { type: 'sine', gain: 0.14, slideTo: 1100 });
    this._tone(1320, 0.3, { type: 'triangle', gain: 0.06, slideTo: 440, delay: 0.1 });
  }

  fall() {
    this._tone(620, 0.9, { type: 'sine', gain: 0.16, slideTo: 70 });
    this._tone(310, 0.9, { type: 'triangle', gain: 0.07, slideTo: 40 });
  }

  fail() {
    this._tone(196, 0.25, { type: 'triangle', gain: 0.14, delay: 0.1 });
    this._tone(147, 0.4, { type: 'triangle', gain: 0.14, delay: 0.3 });
  }

  win() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this._tone(f, 0.55, { type: 'sine', gain: 0.14, delay: i * 0.11 });
      this._tone(f * 2, 0.4, { type: 'sine', gain: 0.04, delay: i * 0.11 });
    });
  }
}
