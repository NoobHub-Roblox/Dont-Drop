// Shared tuning constants. Used by both the browser game and the headless tests.

export const CELL = 1;           // size of one grid cell in world units
export const TILE_T = 0.5;       // platform thickness (tile top sits at y = 0)
export const WALL_H = 0.6;       // wall height above the tile top
export const WALL_T = 0.14;      // wall thickness
export const BALL_R = 0.3;       // ball radius
export const PEG_R = 0.2;
export const PEG_H = 0.6;
export const BLOCK_H = 0.6;
export const GATE_H = 0.75;

export const GRAVITY = 16;
export const PHYSICS_DT = 1 / 120;
export const MAX_TILT = (17 * Math.PI) / 180; // hard cap on platform tilt

// Ball colours (muted, readable on the pale platform). Index 0 is unused so
// that ball number n maps to BALL_COLORS[n].
export const BALL_COLORS = [
  '#ffffff',
  '#f2b84b', // 1 amber
  '#6f8ff2', // 2 periwinkle
  '#ee7ba3', // 3 rose
  '#6fcf97', // 4 mint
  '#b58cf0', // 5 violet
  '#f29a5c', // 6 orange
];

export const ANY_HOLE_COLOR = '#e8f4ff';
export const DANGER_COLOR = '#e5484d';

export const STORAGE_KEY = 'dontdrop.v1';
