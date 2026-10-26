import { BALL_COLORS } from '../render/LevelView.js';

const $ = (id) => document.getElementById(id);
const LOCK_SVG = '<svg class="lock" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

export function formatTime(s) {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
}

/**
 * DOM layer: menus, HUD and overlays. All listeners are attached exactly once
 * in the constructor; Game only calls the public methods below.
 */
export class UI {
  constructor(h) {
    this.h = h; // handlers
    this.screens = ['menu', 'levels', 'settings', 'pause', 'fail', 'complete'];
    this.current = 'menu';
    this.hintTimer = 0;
    this.toastTimer = 0;
    this._bind();
  }

  _on(id, fn) { $(id).addEventListener('click', () => { this.h.onClick(); fn(); }); }

  _bind() {
    const h = this.h;
    this._on('menu-play', () => h.onPlay());
    this._on('menu-levels', () => h.onOpenLevels('menu'));
    this._on('menu-settings', () => h.onOpenSettings('menu'));
    this._on('menu-sound', () => h.onToggleSound());
    this._on('levels-back', () => h.onBackFromLevels());
    this._on('settings-back', () => h.onBackFromSettings());
    this._on('pause-resume', () => h.onResume());
    this._on('pause-restart', () => h.onRestart());
    this._on('pause-settings', () => h.onOpenSettings('pause'));
    this._on('pause-levels', () => h.onOpenLevels('pause'));
    this._on('pause-menu', () => h.onMenu());
    this._on('fail-retry', () => h.onRestart());
    this._on('fail-levels', () => h.onOpenLevels('fail'));
    this._on('fail-replay', () => h.onReplay());
    this._on('complete-watch', () => h.onReplay());
    this._on('btn-replay-speed', () => h.onReplaySpeed());
    this._on('btn-replay-stop', () => h.onReplayStop());
    this._on('complete-next', () => h.onNext());
    this._on('complete-replay', () => h.onRestart());
    this._on('complete-levels', () => h.onOpenLevels('complete'));
    this._on('btn-restart', () => h.onRestart());
    this._on('btn-pause', () => h.onPause());

    $('level-grid').addEventListener('click', (e) => {
      const b = e.target.closest('.lvl');
      if (!b || b.disabled) return;
      h.onClick();
      h.onSelectLevel(Number(b.dataset.index));
    });

    const sens = $('set-sens'), vol = $('set-vol');
    sens.addEventListener('input', () => { $('out-sens').textContent = Number(sens.value).toFixed(2); h.onSetting('sensitivity', Number(sens.value)); });
    vol.addEventListener('input', () => { $('out-vol').textContent = Math.round(vol.value * 100); h.onSetting('volume', Number(vol.value)); });
    $('set-diff').addEventListener('change', (e) => h.onSetting('difficulty', e.target.value));
    $('set-sound').addEventListener('change', (e) => h.onSetting('sound', e.target.checked));
    $('set-pad').addEventListener('change', (e) => h.onSetting('onScreenControls', e.target.checked));
    $('set-shadows').addEventListener('change', (e) => h.onSetting('shadows', e.target.checked));

    // Hold-to-tilt on-screen buttons (pointer events cover mouse, pen and touch)
    $('dpad').querySelectorAll('button').forEach((btn) => {
      const dir = btn.dataset.dir;
      const press = (e) => { e.preventDefault(); btn.setPointerCapture?.(e.pointerId); btn.classList.add('on'); h.onPad(dir, true); };
      const release = () => { btn.classList.remove('on'); h.onPad(dir, false); };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
    });
  }

  show(name, { clear = false } = {}) {
    this.current = name;
    for (const s of this.screens) {
      const el = $(`screen-${s}`);
      el.classList.toggle('hidden', s !== name);
      el.classList.toggle('clear', clear);
    }
    const focus = { menu: 'menu-play', pause: 'pause-resume', fail: 'fail-retry', complete: 'complete-next' }[name];
    if (focus) $(focus).focus({ preventScroll: true });
  }

  hideAll() {
    this.current = null;
    for (const s of this.screens) $(`screen-${s}`).classList.add('hidden');
  }

  showHud(on) { $('hud').classList.toggle('hidden', !on); }

  showReplay(on, speed = 1) {
    $('replay-bar').classList.toggle('hidden', !on);
    $('hud').classList.toggle('replaying', on);
    $('btn-replay-speed').textContent = `${speed}\u00d7`;
  }

  setPadVisible(on) { $('dpad').classList.toggle('off', !on); }

  setSound(on) { $('menu-sound').textContent = `Sound: ${on ? 'On' : 'Off'}`; $('menu-sound').setAttribute('aria-pressed', String(on)); $('set-sound').checked = on; }

  setSettings(s) {
    $('set-sens').value = s.sensitivity;
    $('out-sens').textContent = Number(s.sensitivity).toFixed(2);
    $('set-vol').value = s.volume;
    $('out-vol').textContent = Math.round(s.volume * 100);
    $('set-diff').value = s.difficulty;
    $('set-pad').checked = s.onScreenControls;
    $('set-shadows').checked = s.shadows;
    this.setSound(s.sound);
    this.setPadVisible(s.onScreenControls);
  }

  setLevelInfo(index, name, total) {
    $('hud-num').textContent = `LEVEL ${String(index + 1).padStart(2, '0')} / ${total}`;
    $('hud-name').textContent = name;
  }

  /** Dots: one per ball. state[i] = 'active' | 'collected' | 'fallen' */
  setBalls(states) {
    const box = $('hud-dots');
    if (box.children.length !== states.length) {
      box.innerHTML = '';
      states.forEach((_, i) => {
        const d = document.createElement('i');
        d.style.setProperty('--c', BALL_COLORS[i % BALL_COLORS.length]);
        box.appendChild(d);
      });
    }
    states.forEach((s, i) => {
      box.children[i].className = s === 'collected' ? 'done' : s === 'fallen' ? 'lost' : '';
    });
    $('hud-remaining').textContent = states.filter((s) => s === 'active').length;
  }

  showHint(text, ms = 5200) {
    const el = $('hint');
    clearTimeout(this.hintTimer);
    if (!text) { el.classList.remove('show'); return; }
    el.textContent = text;
    el.classList.add('show');
    this.hintTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  toast(text, ms = 1800) {
    const el = $('toast');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  flash(kind) {
    const el = $('flash');
    el.classList.toggle('win', kind === 'win');
    el.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('on')));
  }

  buildLevelSelect(levels, unlocked, bestTimes, currentIndex) {
    const grid = $('level-grid');
    grid.innerHTML = '';
    levels.forEach((lv, i) => {
      const locked = i + 1 > unlocked;
      const b = document.createElement('button');
      b.className = 'lvl';
      b.dataset.index = i;
      b.disabled = locked;
      const best = bestTimes[i];
      if (best !== undefined) b.classList.add('done');
      if (i === currentIndex) b.classList.add('current');
      b.title = locked ? 'Complete the previous level to unlock' : lv.name;
      b.innerHTML = locked
        ? `${LOCK_SVG}<small>${lv.name.length > 11 ? '' : ''}Locked</small>`
        : `<b>${i + 1}</b><small>${best !== undefined ? formatTime(best) : lv.name}</small>`;
      grid.appendChild(b);
    });
  }

  setComplete({ time, best, isBest, isLast }) {
    $('complete-stats').textContent = `${formatTime(time)}${isBest ? '  ·  New best!' : best !== undefined ? `  ·  Best ${formatTime(best)}` : ''}`;
    $('complete-next').textContent = isLast ? 'Main Menu' : 'Next Level';
  }
}
