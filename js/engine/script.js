import * as THREE from 'three';
import { PhysicsWorld, initPhysics, FIXED_DT } from './PhysicsWorld.js';
import { parseLevel, PORTAL_COLORS } from './parseLevel.js';
import { LEVELS } from '../levels/levels.js';
import { SceneManager } from '../render/SceneManager.js';
import { LevelView } from '../render/LevelView.js';
import { Particles } from '../render/Particles.js';
import { Input } from '../core/Input.js';
import { AudioManager } from '../core/AudioManager.js';
import { Storage } from '../core/Storage.js';
import { UI } from '../ui/UI.js';

const FALL_ANIM = 1.6; // real seconds of (slow-motion) falling before the failure screen
const WIN_ANIM = 0.9;

/**
 * Top-level controller. States:
 *   menu | playing | paused | failing | failed | winning | won
 * Exactly one requestAnimationFrame loop exists for the lifetime of the page.
 */
export class Game {
  constructor(canvas) {
    this.storage = new Storage();
    this.parsed = LEVELS.map(parseLevel);
    this.audio = new AudioManager({ enabled: this.storage.settings.sound, volume: this.storage.settings.volume });
    this.sm = new SceneManager(canvas);
    this.particles = new Particles(this.sm.scene);
    this.input = new Input(canvas);
    this.ui = new UI(this._handlers());
    this.state = 'menu';
    this.levelIndex = 0;
    this.pw = null;
    this.view = null;
    this.levelTime = 0;
    this.stateTime = 0;
    this.clock = 0;
    this.running = false;
    this.last = 0;
    this.overlayFrom = 'menu';
    this.raf = 0;
    this.replayData = null; // { log, endState, difficulty } of the last finished attempt
    this.fallClock = -1; // real seconds since a ball dropped (-1 = none); drives slow motion
    this.replayIdx = 0;
    this.replayAcc = 0;
    this.replaySpeed = 1;

    this.ui.setSettings(this.storage.settings);
    this.sm.setShadows(this.storage.settings.shadows);

    // One-time global listeners
    this.ac = new AbortController();
    const opt = { signal: this.ac.signal };
    window.addEventListener('keydown', (e) => this._onKey(e), opt);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); }, opt);
    // Browsers only allow audio after a gesture.
    window.addEventListener('pointerdown', () => this.audio.unlock(), opt);
    window.addEventListener('keydown', () => this.audio.unlock(), opt);
  }

  async start() {
    await initPhysics();
    this._loadLevel(0, { demo: true });
    this.ui.show('menu', { clear: true });
    this.ui.showHud(false);
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      this.raf = requestAnimationFrame((t) => this._frame(t));
    }
  }

  /* ------------------------------------------------------------ handlers */
  _handlers() {
    const s = this.storage;
    return {
      onClick: () => { this.audio.unlock(); this.audio.click(); },
      onPlay: () => this.startLevel(Math.min(s.unlocked, LEVELS.length) - 1),
      onSelectLevel: (i) => this.startLevel(i),
      onOpenLevels: (from) => { this.overlayFrom = from; this._showLevels(); },
      onBackFromLevels: () => this._backTo(this.overlayFrom),
      onOpenSettings: (from) => { this.overlayFrom = from; this.ui.show('settings', { clear: false }); },
      onBackFromSettings: () => this._backTo(this.overlayFrom),
      onToggleSound: () => this._applySetting('sound', !s.settings.sound),
      onSetting: (k, v) => this._applySetting(k, v),
      onResume: () => this.resume(),
      onPause: () => this.pause(),
      onRestart: () => this.restart(),
      onMenu: () => this.toMenu(),
      onNext: () => this.next(),
      onPad: (dir, down) => this.input.setPad(dir, down),
      onReplay: () => this.startReplay(),
      onReplayStop: () => this.stopReplay(),
      onReplaySpeed: () => this.toggleReplaySpeed(),
    };
  }

  _applySetting(key, value) {
    this.storage.setSetting(key, value);
    const s = this.storage.settings;
    if (key === 'sound') { this.audio.setEnabled(value); this.ui.setSound(value); if (value) this.audio.click(); }
    if (key === 'volume') this.audio.setVolume(value);
    if (key === 'sensitivity' && this.pw) this.pw.sensitivity = value;
    if (key === 'difficulty') this.ui.toast('Difficulty applies when the level restarts');
    if (key === 'onScreenControls') this.ui.setPadVisible(value);
    if (key === 'shadows') this.sm.setShadows(value);
    void s;
  }

  _showLevels() {
    const s = this.storage;
    this.ui.buildLevelSelect(LEVELS, s.unlocked, s.data.best, this.levelIndex);
    this.ui.show('levels', { clear: false });
  }

  /** Return from a sub-screen (levels/settings) to whichever screen opened it. */
  _backTo(from) {
    if (from === 'menu') this.ui.show('menu', { clear: true });
    else if (from === 'pause') this.ui.show('pause');
    else if (from === 'fail') this.ui.show('fail', { clear: true });
    else if (from === 'complete') this.ui.show('complete', { clear: true });
    else this.ui.show('menu', { clear: true });
  }

  /* --------------------------------------------------------- level flow */
  _loadLevel(index, { demo = false, animate = true, keepReplay = false, difficulty = null } = {}) {
    if (!keepReplay) this.replayData = null;
    this.fallClock = -1;
    document.body.classList.remove('slowmo');
    if (this.view) this.view.dispose();
    if (this.pw) this.pw.dispose();
    this.particles.clear();
    this.input.clear();
    this.levelIndex = index;
    const level = this.parsed[index];
    this.pw = new PhysicsWorld(level, { sensitivity: this.storage.settings.sensitivity, difficulty: difficulty || this.storage.settings.difficulty });
    this.view = new LevelView(this.sm.scene, level);
    this.view.sync(this.pw);
    this.sm.setLevel(level.bounds, { animate });
    this.sm.zoomTarget = 1;
    this.sm.orbit = demo ? 0.0001 : 0;
    this.levelTime = 0;
    this.stateTime = 0;
    this.audio.setRoll(0);
    this.ui.setLevelInfo(index, LEVELS[index].name, LEVELS.length);
    this.ui.setBalls(this.pw.balls.map((b) => b.state));
  }

  startLevel(index) {
    this._loadLevel(index);
    this.state = 'playing';
    this.input.enabled = true;
    this.ui.showReplay(false);
    this.ui.hideAll();
    this.ui.showHud(true);
    this.ui.showHint(LEVELS[index].hint);
  }

  restart() {
    if (this.state === 'menu') return;
    this._loadLevel(this.levelIndex, { animate: false });
    this.state = 'playing';
    this.input.enabled = true;
    this.ui.showReplay(false);
    this.ui.hideAll();
    this.ui.showHud(true);
    this.ui.showHint('');
  }

  next() {
    if (this.levelIndex + 1 >= LEVELS.length) { this.toMenu(); return; }
    this.startLevel(this.levelIndex + 1);
  }

  toMenu() {
    this.state = 'menu';
    this._loadLevel(0, { demo: true });
    this.ui.showReplay(false);
    this.ui.showHud(false);
    this.ui.show('menu', { clear: true });
    this.ui.showHint('');
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.clear();
    this.audio.setRoll(0);
    this.overlayFrom = 'pause';
    this.ui.show('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.hideAll();
    this.last = performance.now();
  }

  _onKey(e) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) && e.code !== 'Escape') return;
    switch (e.code) {
      case 'KeyR':
        if (['playing', 'failing', 'failed', 'winning', 'won', 'replay'].includes(this.state)) this.restart();
        break;
      case 'KeyP':
      case 'Escape':
        if (this.state === 'replay') this.stopReplay();
        else if (this.state === 'playing') this.pause();
        else if (this.state === 'paused' && this.ui.current === 'pause') this.resume();
        break;
      case 'KeyN':
        if (this.state === 'won') this.next();
        break;
      default:
    }
  }

  /* ------------------------------------------------------------- events */
  _handleEvents(events) {
    let fell = null;
    for (const ev of events) {
      if (ev.type === 'fallen' && !fell) fell = ev;
    }
    for (const ev of events) {
      if (ev.type === 'impact') {
        if (this.state !== 'menu') this.audio.impact(ev.strength);
      } else if (ev.type === 'teleport') {
        this.view.warp(ev.index, ev.portal);
        const col = new THREE.Color(PORTAL_COLORS[ev.portal.pair]);
        this.particles.emit(this.view.toWorld(ev.portal), { count: 18, color: col, speed: 1.8, up: 1.2, life: 0.7, gravity: 3 });
        this.particles.emit(this.view.toWorld(ev.portal.exit), { count: 22, color: col, speed: 2.2, up: 1.4, life: 0.8, gravity: 3 });
        if (this.state !== 'menu') this.audio.teleport();
      } else if (ev.type === 'collected') {
        this.view.collect(ev.index, ev.hole);
        const world = this.view.toWorld({ x: ev.hole.x, y: 0.05, z: ev.hole.z });
        this.particles.emit(world, { count: 28, color: this.view.balls[ev.index].color, speed: 2.4, up: 1.1, life: 0.9, gravity: 5 });
        if (this.state !== 'menu') this.audio.hole(this.pw.collectedCount - 1);
      }
    }
    if (fell) this._onFallen(fell);
  }

  _onFallen(ev) {
    if (this.state === 'menu') { this._loadLevel(0, { demo: true }); return; }
    if (this.state === 'replay') {
      this.view.markFallen(ev.index);
      this.particles.emit(ev.pos, { count: 22, color: new THREE.Color('#ff6b57'), speed: 1.6, up: 0.4, life: 0.9, gravity: 2 });
      this.audio.fall();
      this.ui.flash('fail');
      this.fallClock = 0;
      return;
    }
    if (this.state !== 'playing') return;
    this.state = 'failing';
    this.stateTime = 0;
    this.view.markFallen(ev.index);
    this.particles.emit(ev.pos, { count: 22, color: new THREE.Color('#ff6b57'), speed: 1.6, up: 0.4, life: 0.9, gravity: 2 });
    this.audio.fall();
    this.ui.flash('fail');
    this.sm.zoomTarget = 0.9;
    this.fallClock = 0;
    document.body.classList.add('slowmo');
    this.ui.showHint('');
  }

  _onWin() {
    this.state = 'winning';
    this.stateTime = 0;
    const s = this.storage;
    const isBest = s.recordTime(this.levelIndex, this.levelTime);
    s.unlock(this.levelIndex + 2, LEVELS.length);
    this.ui.setComplete({
      time: this.levelTime, best: s.bestTime(this.levelIndex), isBest, isLast: this.levelIndex + 1 >= LEVELS.length,
    });
    this.audio.win();
    this.audio.setRoll(0);
    this.ui.flash('win');
    this.sm.zoomTarget = 0.93;
    const gold = new THREE.Color('#ffd27a');
    const cols = [gold, new THREE.Color('#4ee0b0'), new THREE.Color('#ff6b57'), new THREE.Color('#b69cff')];
    cols.forEach((c, i) => {
      setTimeout(() => {
        if (this.state !== 'winning' && this.state !== 'won') return;
        for (const [x, z] of [[-2, 0], [2, 0], [0, -1.5]]) this.particles.emit({ x, y: 1.2, z }, { count: 18, color: c, speed: 3.2, up: 1.4, life: 1.4, gravity: 4, spread: 0.6 });
      }, i * 160);
    });
  }

  /** Slow motion after a drop: quick ease down to 25%, hold, then speed back up as the ball plunges. */
  _fallScale() {
    const t = this.fallClock;
    if (t < 0) return 1;
    if (t < 0.12) return 1 - 0.75 * (t / 0.12);
    if (t < 0.9) return 0.25;
    return 0.25 + 0.75 * Math.min(1, (t - 0.9) / 0.5);
  }

  /* ------------------------------------------------------------- replay */
  startReplay() {
    if (this.state !== 'failed' && this.state !== 'won') return;
    const fresh = this.pw.recording && this.pw.log.length > 0;
    const data = fresh ? { log: this.pw.log, endState: this.state, difficulty: this.pw.difficulty } : this.replayData;
    if (!data) return;
    this.replayData = data;
    this._loadLevel(this.levelIndex, { animate: false, keepReplay: true, difficulty: data.difficulty });
    this.pw.recording = false;
    this.replayIdx = 0;
    this.replayAcc = 0;
    this.replaySpeed = 1;
    this.state = 'replay';
    this.input.enabled = false;
    this.ui.hideAll();
    this.ui.showHud(true);
    this.ui.showHint('');
    this.ui.showReplay(true, 1);
  }

  toggleReplaySpeed() {
    this.replaySpeed = this.replaySpeed === 1 ? 2 : this.replaySpeed === 2 ? 0.5 : 1;
    this.ui.showReplay(true, this.replaySpeed);
  }

  /** Skip: silently run the remaining recorded steps, then show the end screen. */
  stopReplay() {
    if (this.state !== 'replay') return;
    const { log } = this.replayData;
    while (this.replayIdx < log.length) {
      const e = log[this.replayIdx++];
      this.pw.sensitivity = e[2];
      this.pw.events = [];
      this.pw.fixedStep({ x: e[0], z: e[1] });
      for (const ev of this.pw.events) {
        if (ev.type === 'collected') this.view.collect(ev.index, ev.hole);
        else if (ev.type === 'fallen') this.view.markFallen(ev.index);
      }
    }
    this._endReplay();
  }

  _endReplay() {
    this.ui.showReplay(false);
    this.input.enabled = true;
    this.fallClock = -1;
    this.audio.setRoll(0);
    this.ui.setBalls(this.pw.balls.map((b) => b.state));
    if (this.replayData.endState === 'won') {
      this.state = 'winning';
      this.stateTime = 0;
      this.sm.zoomTarget = 0.93;
      this.audio.win();
      this.ui.flash('win');
    } else {
      this.state = 'failed';
      this.sm.zoomTarget = 1.05;
      this.ui.show('fail', { clear: true });
    }
  }

  /* --------------------------------------------------------------- loop */
  _frame(now) {
    this.raf = requestAnimationFrame((t) => this._frame(t));
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.clock += dt;
    this._update(dt);
    this.sm.render();
  }

  _update(dt) {
    const { pw, view, state } = this;
    if (!pw || !view) return;
    if (this.fallClock >= 0) this.fallClock += dt;
    const sdt = dt * this._fallScale();

    if (state === 'playing') {
      this.levelTime += dt;
      const events = pw.advance(dt, this.input.vector);
      this._handleEvents(events);
      this.audio.setRoll(pw.rollSpeed);
      this.ui.setBalls(pw.balls.map((b) => b.state));
      if (this.state === 'playing' && pw.fallenCount === 0 && pw.collectedCount === pw.balls.length) this._onWin();
    } else if (state === 'failing') {
      this.stateTime += dt;
      pw.advance(sdt, { x: 0, z: 0 });
      this.ui.setBalls(pw.balls.map((b) => b.state));
      this.audio.setRoll(0);
      if (this.stateTime >= FALL_ANIM) {
        this.state = 'failed';
        this.audio.fail();
        this.ui.show('fail', { clear: true });
      }
    } else if (state === 'replay') {
      const { log } = this.replayData;
      this.replayAcc += sdt * this.replaySpeed;
      const events = [];
      while (this.replayAcc >= FIXED_DT && this.replayIdx < log.length) {
        const e = log[this.replayIdx++];
        pw.sensitivity = e[2];
        pw.events = [];
        pw.fixedStep({ x: e[0], z: e[1] });
        events.push(...pw.events);
        this.replayAcc -= FIXED_DT;
      }
      this._handleEvents(events);
      this.audio.setRoll(pw.rollSpeed);
      this.ui.setBalls(pw.balls.map((b) => b.state));
      if (this.replayIdx >= log.length) this._endReplay();
    } else if (state === 'menu') {
      const t = this.clock;
      const events = pw.advance(dt, { x: Math.sin(t * 0.55) * 0.7, z: Math.cos(t * 0.4) * 0.7 });
      this._handleEvents(events);
      if (pw.collectedCount > 0 || pw.fallenCount > 0) this._loadLevel(0, { demo: true, animate: false });
      this.sm.orbit += dt * 0.05;
    } else if (state === 'winning') {
      this.stateTime += dt;
      const k = Math.min(1, this.stateTime / WIN_ANIM);
      const e = 1 - Math.pow(1 - k, 3);
      view.setCelebration(0.5 * e, Math.PI * 2 * e);
      if (k >= 1) {
        this.state = 'won';
        this.ui.show('complete', { clear: true });
      }
    } else if (state === 'won') {
      view.setCelebration(0.5 + Math.sin(this.clock * 1.5) * 0.06, 0);
    }

    // Visuals (frozen physics states still animate FX)
    if (state === 'playing' || state === 'failing' || state === 'menu' || state === 'replay') view.sync(pw);
    view.update(sdt);
    this.particles.update(sdt);
    this.sm.sway = { x: -pw.tilt.az * 1.4, z: pw.tilt.ax * 0.9 };
    this.sm.update(dt, this.clock);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.running = false;
    this.ac.abort();
    this.input.dispose();
    this.view?.dispose();
    this.pw?.dispose();
    this.particles.dispose();
    this.sm.dispose();
  }
}
