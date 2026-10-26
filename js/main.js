import { Game } from './engine/script.js';

const canvas = document.getElementById('game');

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

if (!webglAvailable()) {
  document.getElementById('app').innerHTML =
    '<div style="display:grid;place-items:center;height:100%;padding:24px;text-align:center">Don\'t Drop needs WebGL, which this browser has disabled or does not support.</div>';
} else {
  const game = new Game(canvas);
  window.__dontDrop = game; // handy for debugging in the console
  game.start().catch((err) => {
    console.error(err);
    document.getElementById('toast').textContent = 'Failed to start: ' + err.message;
    document.getElementById('toast').classList.remove('hidden');
  });
}
