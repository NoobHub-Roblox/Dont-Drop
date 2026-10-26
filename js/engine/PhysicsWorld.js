import RAPIER from '@dimforge/rapier3d-compat';
import { mergeTiles, RIM_HEIGHT, TILE_DEPTH } from './parseLevel.js';

export const BALL_RADIUS = 0.3;
export const FIXED_DT = 1 / 120;
export const MAX_TILT = 0.3; // radians (~17 degrees)
const GRAVITY = 16;
const FALL_DEPTH = -0.2; // below the lowest tier's surface and not over a hole: ball counts as lost
const PIT_DEPTH = -0.1; // below a hole's rim: ball is inside the opening
const PIT_FLOOR = -0.75; // ...but above this (a tier below must not trigger the hole)
/** Ball feel per difficulty: damping (how quickly balls slow down) and the hole's pull assist. */
export const DIFFICULTY = {
  easy: { linDamp: 0.12, angDamp: 0.5, pull: 5.5 },
  normal: { linDamp: 0.03, angDamp: 0.2, pull: 3.0 },
  hard: { linDamp: 0.0, angDamp: 0.07, pull: 1.0 },
};

let rapierReady = null;
export function initPhysics() {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}
export { RAPIER };

const quatMul = (a, b) => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

/** Rotate vector v by quaternion q. */
export function rotateVec(q, v) {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}
const conj = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

export function tiltQuaternion(ax, az) {
  const qx = { x: Math.sin(ax / 2), y: 0, z: 0, w: Math.cos(ax / 2) };
  const qz = { x: 0, y: 0, z: Math.sin(az / 2), w: Math.cos(az / 2) };
  return quatMul(qx, qz);
}

/**
 * Rapier world for one level attempt. Contains no rendering code so it can
 * also be driven headless by tools/verify-levels.mjs.
 * Ball states: 'active' | 'collected' | 'fallen'.
 */
export class PhysicsWorld {
  constructor(level, { sensitivity = 1, difficulty = 'normal' } = {}) {
    this.level = level;
    this.sensitivity = sensitivity;
    this.difficulty = DIFFICULTY[difficulty] ? difficulty : 'normal';
    this.diff = DIFFICULTY[this.difficulty];
    // Farthest point from the pivot: limits tilt acceleration so the floor never drops faster than gravity.
    this.radius = Math.max(2, ...level.tiles.map((t) => Math.hypot(t.x, t.z))) + 0.7;
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = FIXED_DT;
    this.accumulator = 0;
    this.time = 0;
    this.events = [];
    this.log = []; // [x, z, sensitivity] per fixed step, used for replays
    this.recording = true;
    this.rollSpeed = 0;
    this.tilt = { ax: 0, az: 0, vx: 0, vz: 0 };
    this.quat = { x: 0, y: 0, z: 0, w: 1 };
    this.balls = [];
    this._build();
  }

  _build() {
    const { world, level } = this;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.platform = body;
    this.platformHandle = body.handle;

    const add = (desc) => world.createCollider(desc, body);
    for (const r of mergeTiles(level.tiles)) {
      add(
        RAPIER.ColliderDesc.cuboid(r.w / 2, TILE_DEPTH / 2, r.d / 2)
          .setTranslation(r.x, r.y - TILE_DEPTH / 2, r.z)
          .setFriction(0.9).setRestitution(0.0)
      );
    }
    for (const w of level.rims) {
      add(
        RAPIER.ColliderDesc.cuboid(w.w / 2, RIM_HEIGHT / 2, w.d / 2)
          .setTranslation(w.x, w.y + RIM_HEIGHT / 2, w.z)
          .setFriction(0.3).setRestitution(0.25)
      );
    }
    for (const b of level.blocks) {
      add(
        RAPIER.ColliderDesc.cuboid(0.48, 0.35, 0.48)
          .setTranslation(b.x, b.y + 0.35, b.z)
          .setFriction(0.3).setRestitution(0.25)
      );
    }
    for (const p of level.pillars) {
      add(
        RAPIER.ColliderDesc.cylinder(0.3, 0.3)
          .setTranslation(p.x, p.y + 0.3, p.z)
          .setFriction(0.3).setRestitution(0.35)
      );
    }

    level.balls.forEach((b, i) => {
      const rb = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(b.x, b.y + BALL_RADIUS + 0.01, b.z)
          .setLinearDamping(this.diff.linDamp)
          .setAngularDamping(this.diff.angDamp)
          .setCcdEnabled(true)
      );
      world.createCollider(
        RAPIER.ColliderDesc.ball(BALL_RADIUS).setDensity(1).setFriction(0.8).setRestitution(0.12)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min),
        rb
      );
      this.balls.push({
        index: i, body: rb, handle: rb.handle, state: 'active',
        prevVel: { x: 0, y: 0, z: 0 }, lastPos: { x: b.x, y: b.y + BALL_RADIUS, z: b.z },
      });
    });
    this.platform.setNextKinematicRotation(this.quat);
  }

  get activeCount() { return this.balls.filter((b) => b.state === 'active').length; }
  get collectedCount() { return this.balls.filter((b) => b.state === 'collected').length; }
  get fallenCount() { return this.balls.filter((b) => b.state === 'fallen').length; }

  /** Advance by real elapsed seconds using a fixed-step accumulator. */
  advance(dt, input) {
    this.accumulator = Math.min(this.accumulator + dt, 0.1);
    this.events = [];
    while (this.accumulator >= FIXED_DT) {
      this.fixedStep(input);
      this.accumulator -= FIXED_DT;
    }
    return this.events;
  }

  _updateTilt(input) {
    const t = this.tilt;
    const omega = 9 * this.sensitivity;
    // Edge acceleration (alphaMax * radius) stays well under gravity so balls are never thrown off the floor.
    const alphaMax = (0.7 * GRAVITY / this.radius) * (0.75 + 0.25 * this.sensitivity);
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const axis = (angle, vel, target) => {
      const wanted = clamp(omega * (target - angle), -1.6, 1.6);
      vel += clamp((wanted - vel) * 14, -alphaMax, alphaMax) * FIXED_DT;
      let next = angle + vel * FIXED_DT;
      if (Math.abs(next) > MAX_TILT) { next = clamp(next, -MAX_TILT, MAX_TILT); vel = 0; }
      return [next, vel];
    };
    [t.ax, t.vx] = axis(t.ax, t.vx, -input.z * MAX_TILT);
    [t.az, t.vz] = axis(t.az, t.vz, -input.x * MAX_TILT);
    this.quat = tiltQuaternion(t.ax, t.az);
    this.platform.setNextKinematicRotation(this.quat);
  }

  fixedStep(input = { x: 0, z: 0 }) {
    if (this.recording) this.log.push([input.x, input.z, this.sensitivity]);
    this._updateTilt(input);
    this._applyHolePull();
    this.world.step();
    this.time += FIXED_DT;
    this._classify();
  }

  /** Holes that balls can roll into: targets and teleport entrances. */
  _openings() {
    if (!this._open) this._open = [...this.level.holes.map((h) => ({ h, kind: 'hole' })), ...this.level.portals.map((h) => ({ h, kind: 'portal' }))];
    return this._open;
  }

  _applyHolePull() {
    const inv = conj(this.quat);
    for (const b of this.balls) {
      if (b.state !== 'active') continue;
      const l = rotateVec(inv, b.body.translation());
      for (const { h } of this._openings()) {
        if (l.y > h.y + 0.5 || l.y < h.y + PIT_DEPTH) continue;
        const dx = h.x - l.x, dz = h.z - l.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.5 && d > 1e-4) {
          const a = this.diff.pull * (1 - d / 0.5);
          const w = rotateVec(this.quat, { x: dx / d, y: 0, z: dz / d });
          const m = b.body.mass() * a * FIXED_DT;
          b.body.applyImpulse({ x: w.x * m, y: 0, z: w.z * m }, true);
        }
      }
    }
  }

  _classify() {
    const inv = conj(this.quat);
    const lostY = this.level.bottomY + FALL_DEPTH;
    let roll = 0;
    for (const b of this.balls) {
      if (!b.body) continue;
      const p = b.body.translation();
      const v = b.body.linvel();
      b.lastPos = { x: p.x, y: p.y, z: p.z };
      if (b.state === 'fallen') {
        if (p.y < -30) { this.world.removeRigidBody(b.body); b.body = null; }
        continue;
      }
      if (b.state !== 'active') continue;

      const dv = Math.hypot(v.x - b.prevVel.x, v.y - b.prevVel.y, v.z - b.prevVel.z);
      b.prevVel = { x: v.x, y: v.y, z: v.z };
      if (dv > 1.1 && this.time > 0.3 && !b.justWarped) this.events.push({ type: 'impact', index: b.index, strength: dv });
      b.justWarped = false;

      const l = rotateVec(inv, p);
      b.local = l;
      roll = Math.max(roll, Math.abs(v.y) > 1.5 ? 0 : Math.hypot(v.x, v.z));

      // Inside the shaft of a hole on some tier?
      const inShaft = (h) => Math.abs(l.x - h.x) < 0.5 && Math.abs(l.z - h.z) < 0.5 && l.y < h.y + PIT_DEPTH && l.y > h.y + PIT_FLOOR;
      const target = this.level.holes.find(inShaft);
      if (target) {
        b.state = 'collected';
        this.world.removeRigidBody(b.body);
        b.body = null;
        this.events.push({ type: 'collected', index: b.index, hole: target, pos: { x: p.x, y: p.y, z: p.z } });
        continue;
      }
      const portal = this.level.portals.find(inShaft);
      if (portal) {
        this._teleport(b, portal, v);
        continue;
      }
      const overOpening = this._openings().some(({ h }) => Math.abs(l.x - h.x) < 0.5 && Math.abs(l.z - h.z) < 0.5);
      if (l.y < (overOpening ? this.level.bottomY - 0.75 : lostY)) {
        b.state = 'fallen';
        this.events.push({ type: 'fallen', index: b.index, pos: { x: p.x, y: p.y, z: p.z } });
      }
    }
    this.rollSpeed = roll;
  }

  /** Move a ball from a teleport hole to its exit pad, keeping some momentum. */
  _teleport(b, portal, v) {
    const from = b.body.translation();
    const ex = portal.exit;
    const pos = rotateVec(this.quat, { x: ex.x, y: ex.y + BALL_RADIUS + 0.04, z: ex.z });
    const hv = Math.hypot(v.x, v.z);
    const k = hv > 3 ? 3 / hv : 1;
    b.body.setTranslation(pos, true);
    b.body.setLinvel({ x: v.x * 0.5 * k, y: 0, z: v.z * 0.5 * k }, true);
    b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    b.prevVel = { x: v.x * 0.5 * k, y: 0, z: v.z * 0.5 * k };
    b.justWarped = true;
    this.events.push({ type: 'teleport', index: b.index, portal, from: { x: from.x, y: from.y, z: from.z }, to: pos });
  }

  /* ---- snapshot support (used by the headless solver) ---- */
  saveState() {
    return {
      snap: this.world.takeSnapshot(),
      tilt: { ...this.tilt },
      time: this.time,
      balls: this.balls.map((b) => ({ state: b.state, hasBody: !!b.body, prevVel: { ...b.prevVel }, lastPos: { ...b.lastPos } })),
    };
  }

  loadState(s) {
    this.world.free();
    this.world = RAPIER.World.restoreSnapshot(s.snap);
    this.platform = this.world.getRigidBody(this.platformHandle);
    this.tilt = { ...s.tilt };
    this.quat = tiltQuaternion(this.tilt.ax, this.tilt.az);
    this.time = s.time;
    this.balls.forEach((b, i) => {
      const sb = s.balls[i];
      b.state = sb.state;
      b.prevVel = { ...sb.prevVel };
      b.lastPos = { ...sb.lastPos };
      b.body = sb.hasBody ? this.world.getRigidBody(b.handle) : null;
    });
  }

  dispose() {
    if (this.world) this.world.free();
    this.world = null;
  }
}
