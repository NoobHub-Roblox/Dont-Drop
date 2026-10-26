const KEY = 'dont-drop-save-v1';

const DEFAULTS = {
  unlocked: 1,
  best: {}, // levelIndex -> best time in seconds
  settings: {
    sound: true,
    volume: 0.7,
    sensitivity: 1,
    onScreenControls: true,
    shadows: true,
    difficulty: 'normal',
  },
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }

/** Persistent save data (unlocked levels, best times, settings) in localStorage. */
export class Storage {
  constructor() {
    this.data = clone(DEFAULTS);
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.data.unlocked = Math.max(1, Number(parsed.unlocked) || 1);
        this.data.best = parsed.best && typeof parsed.best === 'object' ? parsed.best : {};
        this.data.settings = { ...DEFAULTS.settings, ...(parsed.settings || {}) };
      }
    } catch {
      /* storage unavailable or corrupt: fall back to defaults */
    }
  }

  save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }

  get settings() { return this.data.settings; }
  get unlocked() { return this.data.unlocked; }

  setSetting(name, value) {
    this.data.settings[name] = value;
    this.save();
  }

  unlock(levelNumber, total) {
    if (levelNumber > this.data.unlocked && levelNumber <= total) {
      this.data.unlocked = levelNumber;
      this.save();
    }
  }

  recordTime(levelIndex, seconds) {
    const prev = this.data.best[levelIndex];
    const isBest = prev === undefined || seconds < prev;
    if (isBest) { this.data.best[levelIndex] = seconds; this.save(); }
    return isBest;
  }

  bestTime(levelIndex) { return this.data.best[levelIndex]; }
}
