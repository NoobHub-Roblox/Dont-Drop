// Pure data model for a level. No rendering and no physics in here, so it can
// be shared by the browser game and the headless test runner.
//
// Map legend (one character per cell, row 0 is the far edge, column 0 the left):
//   #  floor tile            .  empty space (void)
//   1-6 floor tile + ball n  O  hole that accepts any ball
//   a-f hole for ball 1-6    P  floor tile + peg
//   X  floor tile + block    G  floor tile + gate (opens after N balls are home)

import { BALL_R, WALL_T } from '../core/constants.js';

const SIDES = {
  N: { dr: -1, dc: 0 },
  S: { dr: 1, dc: 0 },
  W: { dr: 0, dc: -1 },
  E: { dr: 0, dc: 1 },
};

/** Edge helpers used by the level files. Each returns [[row, col, side], ...]. */
export const edgeRange = (side, line, from, to) => {
  const out = [];
  for (let i = from; i <= to; i++) {
    out.push(side === 'N' || side === 'S' ? [line, i, side] : [i, line, side]);
  }
  return out;
};
export const N = (row, c0, c1 = c0) => edgeRange('N', row, c0, c1);
export const S = (row, c0, c1 = c0) => edgeRange('S', row, c0, c1);
export const W = (col, r0, r1 = r0) => edgeRange('W', col, r0, r1);
export const E = (col, r0, r1 = r0) => edgeRange('E', col, r0, r1);

const isHoleChar = (ch) => ch === 'O' || (ch >= 'a' && ch <= 'f');
const isBallChar = (ch) => ch >= '1' && ch <= '6';
const isFloorChar = (ch) =>
  ch === '#' || isBallChar(ch) || ch === 'P' || ch === 'X' || ch === 'G';

export function buildModel(def) {
  const rows = def.map.length;
  const cols = Math.max(...def.map.map((r) => r.length));
  const grid = def.map.map((row) => row.padEnd(cols, '.').split(''));

  const at = (r, c) => (r < 0 || c < 0 || r >= rows || c >= cols ? '.' : grid[r][c]);
  const solidAt = (r, c) => isFloorChar(at(r, c)) || isHoleChar(at(r, c));

  // Bounding box of everything that is not void; platform pivots around its centre.
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (solidAt(r, c)) {
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      }
    }
  }
  if (!isFinite(minR)) throw new Error(`Level ${def.id}: map has no tiles`);
  const cx = (minC + maxC) / 2;
  const cz = (minR + maxR) / 2;
  const lx = (c) => c - cx;
  const lz = (r) => r - cz;

  const model = {
    id: def.id,
    name: def.name,
    hint: def.hint || '',
    cols, rows,
    grid,
    center: { c: cx, r: cz },
    floor: [],
    floorRects: [],
    holes: [],
    balls: [],
    pegs: [],
    blocks: [],
    gates: [],
    walls: [],
    dangerStrips: [],
    gateAfter: def.gateAfter ?? 1,
    wallMode: def.walls || 'all',
    radius: 0,
    halfW: (maxC - minC + 1) / 2,
    halfD: (maxR - minR + 1) / 2,
  };

  // ---- Cells --------------------------------------------------------------
  let maxCorner = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = at(r, c);
      if (!solidAt(r, c)) continue;
      const x = lx(c), z = lz(r);
      maxCorner = Math.max(maxCorner, Math.hypot(Math.abs(x) + 0.5, Math.abs(z) + 0.5));

      if (isHoleChar(ch)) {
        const color = ch === 'O' ? 0 : ch.charCodeAt(0) - 96;
        model.holes.push({ r, c, x, z, color });
        continue;
      }
      model.floor.push({ r, c, x, z });
      if (isBallChar(ch)) {
        const idx = Number(ch);
        model.balls.push({ index: idx, x, y: BALL_R + 0.002, z, r, c });
      } else if (ch === 'P') model.pegs.push({ x, z, r, c });
      else if (ch === 'X') model.blocks.push({ x, z, r, c });
      else if (ch === 'G') model.gates.push({ x, z, r, c });
    }
  }
  model.radius = maxCorner;
  model.balls.sort((a, b) => a.index - b.index);

  // ---- Floor rectangles (merged for fewer colliders) -----------------------
  const runs = [];
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (!isFloorChar(at(r, c))) { c++; continue; }
      const c0 = c;
      while (c < cols && isFloorChar(at(r, c))) c++;
      runs.push({ r0: r, r1: r, c0, c1: c - 1 });
    }
  }
  const merged = [];
  for (const run of runs) {
    const prev = merged.find((m) => m.c0 === run.c0 && m.c1 === run.c1 && m.r1 === run.r0 - 1);
    if (prev) prev.r1 = run.r1;
    else merged.push({ ...run });
  }
  for (const m of merged) {
    model.floorRects.push({
      x: lx((m.c0 + m.c1) / 2),
      z: lz((m.r0 + m.r1) / 2),
      w: m.c1 - m.c0 + 1,
      d: m.r1 - m.r0 + 1,
    });
  }

  // ---- Edges ---------------------------------------------------------------
  // An edge is identified by orientation + boundary index + position along it.
  //   'h' edge: wall running along x at z = b - 0.5, covering column j.
  //   'v' edge: wall running along z at x = b - 0.5, covering row i.
  const edgeOf = (r, c, side) => {
    switch (side) {
      case 'N': return { o: 'h', b: r, p: c };
      case 'S': return { o: 'h', b: r + 1, p: c };
      case 'W': return { o: 'v', b: c, p: r };
      case 'E': return { o: 'v', b: c + 1, p: r };
      default: throw new Error(`Bad side ${side}`);
    }
  };
  const key = (e) => `${e.o}:${e.b}:${e.p}`;

  const exposed = new Map(); // key -> {edge, inward:{x,z}}
  for (const cell of model.floor) {
    for (const [side, d] of Object.entries(SIDES)) {
      if (!solidAt(cell.r + d.dr, cell.c + d.dc)) {
        const e = edgeOf(cell.r, cell.c, side);
        exposed.set(key(e), { edge: e, inward: { x: -d.dc, z: -d.dr } });
      }
    }
  }

  const walls = new Map();
  if (model.wallMode === 'all') {
    for (const [k, v] of exposed) walls.set(k, v.edge);
    for (const [r, c, side] of def.open || []) walls.delete(key(edgeOf(r, c, side)));
  }
  for (const [r, c, side] of def.add || []) {
    const e = edgeOf(r, c, side);
    walls.set(key(e), e);
  }

  // Merge wall edges into continuous runs.
  const groupRuns = (edges) => {
    const groups = new Map();
    for (const e of edges) {
      const g = `${e.o}:${e.b}`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(e);
    }
    const out = [];
    for (const list of groups.values()) {
      list.sort((a, b) => a.p - b.p);
      let start = list[0], prev = list[0];
      for (let i = 1; i <= list.length; i++) {
        const cur = list[i];
        if (cur && cur.p === prev.p + 1) { prev = cur; continue; }
        out.push({ o: start.o, b: start.b, p0: start.p, p1: prev.p });
        start = cur; prev = cur;
      }
    }
    return out;
  };

  for (const run of groupRuns([...walls.values()])) {
    const len = run.p1 - run.p0 + 1 + WALL_T;
    const mid = (run.p0 + run.p1) / 2;
    if (run.o === 'h') model.walls.push({ x: lx(mid), z: lz(run.b - 0.5), w: len, d: WALL_T });
    else model.walls.push({ x: lx(run.b - 0.5), z: lz(mid), w: WALL_T, d: len });
  }

  // Danger strips: exposed edges with no wall. Grouped by inward direction.
  const danger = [];
  for (const [k, v] of exposed) if (!walls.has(k)) danger.push({ ...v.edge, inward: v.inward });
  const dGroups = new Map();
  for (const e of danger) {
    const g = `${e.o}:${e.b}:${e.inward.x},${e.inward.z}`;
    if (!dGroups.has(g)) dGroups.set(g, []);
    dGroups.get(g).push(e);
  }
  const INSET = 0.07, STRIP = 0.07;
  for (const list of dGroups.values()) {
    for (const run of groupRuns(list)) {
      const inward = list[0].inward;
      const len = run.p1 - run.p0 + 1 - 0.1;
      const mid = (run.p0 + run.p1) / 2;
      if (run.o === 'h') {
        model.dangerStrips.push({
          x: lx(mid), z: lz(run.b - 0.5) + inward.z * (INSET + STRIP / 2), w: len, d: STRIP,
        });
      } else {
        model.dangerStrips.push({
          x: lx(run.b - 0.5) + inward.x * (INSET + STRIP / 2), z: lz(mid), w: STRIP, d: len,
        });
      }
    }
  }

  // ---- Validation ----------------------------------------------------------
  if (model.balls.length === 0) throw new Error(`Level ${def.id}: no balls`);
  if (model.holes.length === 0) throw new Error(`Level ${def.id}: no holes`);
  for (const b of model.balls) {
    const hasHole = model.holes.some((h) => h.color === 0 || h.color === b.index);
    if (!hasHole) throw new Error(`Level ${def.id}: ball ${b.index} has no matching hole`);
  }
  return model;
}

/** Walkable cells for path planning in the headless solver. */
export function walkableGrid(model, gatesOpen = false) {
  const g = model.grid;
  return (r, c) => {
    const ch = (g[r] && g[r][c]) || '.';
    if (ch === 'X' || ch === 'P') return false;
    if (ch === 'G') return gatesOpen;
    return ch === '#' || isBallChar(ch) || isHoleChar(ch);
  };
}
