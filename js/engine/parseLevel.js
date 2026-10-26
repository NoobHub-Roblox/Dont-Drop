/**
 * Level map legend (one character per 1x1 cell, row 0 is the far edge):
 *   ' '  empty space (void)
 *   '.'  floor tile, protective rim on every exposed edge
 *   ','  floor tile, NO rim (open edge)
 *   'b'  ball start on a rimmed tile      'B'  ball start on a rimless tile
 *   '#'  solid block on a floor tile      'o'  round pillar on a floor tile
 *   'H'  target hole (ball is collected)
 *   'X'  decoy hole (falling in = lost, unless a lower tier catches the ball)
 *   'D'  drop hole: drops the ball onto the tier below
 *   'T' 'U' 'V'  teleport hole: sends the ball to the matching exit pad
 *   't' 'u' 'v'  teleport exit pad (rimmed floor tile) for T / U / V
 *
 * A level has either `map` (one tier) or `layers` (several tiers, top first).
 * All tiers share one coordinate grid and tilt together as one platform.
 */
export const RIM_THICKNESS = 0.12;
export const RIM_HEIGHT = 0.5;
export const TILE_DEPTH = 0.5;
export const LAYER_GAP = 1.2;

const EXIT_CHARS = { t: 'T', u: 'U', v: 'V' };
const FLOOR = new Set(['.', ',', 'b', 'B', '#', 'o', 't', 'u', 'v']);
const RIMMED = new Set(['.', 'b', '#', 'o', 't', 'u', 'v']);
const HOLES = new Set(['H', 'X', 'D', 'T', 'U', 'V']);
export const PORTAL_COLORS = { T: '#9b5cff', U: '#14c4e6', V: '#ff4fa3' };

export function parseLevel(def) {
  const tiers = def.layers || [def.map];
  const n = tiers.length;
  const h = Math.max(...tiers.map((t) => t.length));
  const w = Math.max(...tiers.flat().map((r) => r.length));
  const isFloorLike = (ch) => FLOOR.has(ch) || HOLES.has(ch);
  const atTier = (rows, c, r) => (r < 0 || r >= h || c < 0 ? ' ' : rows[r]?.[c] ?? ' ');

  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const rows of tiers) {
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (isFloorLike(atTier(rows, c, r))) {
          minC = Math.min(minC, c); maxC = Math.max(maxC, c);
          minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        }
      }
    }
  }
  if (!isFinite(minC)) throw new Error(`Level "${def.name}" has no floor`);
  const cx = (minC + maxC) / 2;
  const cz = (minR + maxR) / 2;

  const out = {
    name: def.name,
    hint: def.hint || '',
    layers: n,
    bottomY: -(n - 1) * LAYER_GAP,
    tiles: [], holes: [], decoys: [], drops: [], portals: [], exits: [],
    balls: [], blocks: [], pillars: [], rims: [],
    bounds: { w: maxC - minC + 1, d: maxR - minR + 1, layers: n },
  };

  const sides = [
    { dc: 0, dr: -1, horizontal: true, sign: -1 },
    { dc: 0, dr: 1, horizontal: true, sign: 1 },
    { dc: -1, dr: 0, horizontal: false, sign: -1 },
    { dc: 1, dr: 0, horizontal: false, sign: 1 },
  ];

  tiers.forEach((rows, layer) => {
    const y = -layer * LAYER_GAP;
    const at = (c, r) => atTier(rows, c, r);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const ch = at(c, r);
        const x = c - cx;
        const z = r - cz;
        if (HOLES.has(ch)) {
          const hole = { x, y, z, layer };
          if (ch === 'H') out.holes.push(hole);
          else if (ch === 'X') out.decoys.push(hole);
          else if (ch === 'D') out.drops.push(hole);
          else out.portals.push({ ...hole, pair: ch });
          continue;
        }
        if (!FLOOR.has(ch)) continue;
        out.tiles.push({ x, y, z, layer, shade: (c + r) % 2 });
        if (ch === 'b' || ch === 'B') out.balls.push({ x, y, z, layer });
        if (ch === '#') out.blocks.push({ x, y, z });
        if (ch === 'o') out.pillars.push({ x, y, z });
        if (EXIT_CHARS[ch]) out.exits.push({ x, y, z, layer, pair: EXIT_CHARS[ch] });
        if (RIMMED.has(ch) && ch !== '#') {
          for (const s of sides) {
            if (!isFloorLike(at(c + s.dc, r + s.dr))) {
              const off = 0.5 - RIM_THICKNESS / 2;
              out.rims.push(
                s.horizontal
                  ? { x, y, z: z + s.sign * off, w: 1, d: RIM_THICKNESS }
                  : { x: x + s.sign * off, y, z, w: RIM_THICKNESS, d: 1 }
              );
            }
          }
        }
      }
    }
  });

  for (const p of out.portals) {
    const exit = out.exits.find((e) => e.pair === p.pair);
    if (!exit) throw new Error(`Level "${def.name}": teleport ${p.pair} has no exit pad`);
    p.exit = exit;
  }
  if (out.balls.length === 0) throw new Error(`Level "${def.name}" has no balls`);
  if (out.holes.length === 0) throw new Error(`Level "${def.name}" has no target hole`);
  return out;
}

/** Greedy-merge floor tiles (per tier) into rectangles (fewer colliders). */
export function mergeTiles(tiles) {
  const rects = [];
  for (const layer of new Set(tiles.map((t) => t.layer ?? 0))) {
    const group = tiles.filter((t) => (t.layer ?? 0) === layer);
    const y = group[0].y ?? 0;
    const key = (x, z) => `${x},${z}`;
    const free = new Map(group.map((t) => [key(t.x, t.z), t]));
    const sorted = [...group].sort((a, b) => a.z - b.z || a.x - b.x);
    for (const t of sorted) {
      if (!free.has(key(t.x, t.z))) continue;
      let wCount = 1;
      while (free.has(key(t.x + wCount, t.z))) wCount++;
      let dCount = 1;
      outer: for (;;) {
        for (let i = 0; i < wCount; i++) if (!free.has(key(t.x + i, t.z + dCount))) break outer;
        dCount++;
      }
      for (let j = 0; j < dCount; j++) for (let i = 0; i < wCount; i++) free.delete(key(t.x + i, t.z + j));
      rects.push({ x: t.x + (wCount - 1) / 2, y, z: t.z + (dCount - 1) / 2, w: wCount, d: dCount });
    }
  }
  return rects;
}
