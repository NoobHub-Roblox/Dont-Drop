import { MAX_TILT } from './constants.js';

/**
 * Smooth platform tilt. Input is a vector in [-1, 1]^2 (right, forward).
 * The platform angle follows the target through a critically damped spring
 * with a hard cap on angular speed, so rotation never jumps.
 */
export class Tilt {
  constructor() {
    this.reset();
  }

  reset() {
    this.ax = 0; // rotation about X (pitch)
    this.az = 0; // rotation about Z (roll)
    this.vx = 0;
    this.vz = 0;
  }

  /**
   * @param {number} dt       seconds
   * @param {number} right    -1..1  (+1 lowers the +x side)
   * @param {number} forward  -1..1  (+1 lowers the far (-z) side)
   * @param {number} sens     0.5..2 responsiveness multiplier
   */
  update(dt, right, forward, sens = 1) {
    // Clamp the input to the unit disc so diagonals are not stronger.
    const len = Math.hypot(right, forward);
    if (len > 1) { right /= len; forward /= len; }

    const targetAz = -right * MAX_TILT;
    const targetAx = -forward * MAX_TILT;

    const omega = 5.2 * Math.sqrt(sens);        // spring frequency (rad/s)
    const maxRate = 0.95 * sens;                 // rad/s hard cap (~55 deg/s at sens 1)
    const sub = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      this.vx += (omega * omega * (targetAx - this.ax) - 2 * omega * this.vx) * h;
      this.vz += (omega * omega * (targetAz - this.az) - 2 * omega * this.vz) * h;
      this.vx = Math.max(-maxRate, Math.min(maxRate, this.vx));
      this.vz = Math.max(-maxRate, Math.min(maxRate, this.vz));
      this.ax += this.vx * h;
      this.az += this.vz * h;
    }
    const cap = MAX_TILT * 1.02;
    this.ax = Math.max(-cap, Math.min(cap, this.ax));
    this.az = Math.max(-cap, Math.min(cap, this.az));
  }

  /** Quaternion {x,y,z,w} for the current tilt: q = qx * qz. */
  quaternion(out = { x: 0, y: 0, z: 0, w: 1 }) {
    return quatFromTilt(this.ax, this.az, out);
  }
}

export function quatFromTilt(ax, az, out = { x: 0, y: 0, z: 0, w: 1 }) {
  const sx = Math.sin(ax / 2), cx = Math.cos(ax / 2);
  const sz = Math.sin(az / 2), cz = Math.cos(az / 2);
  // Hamilton product of qx = (sx,0,0,cx) and qz = (0,0,sz,cz).
  out.x = sx * cz;
  out.y = -sx * sz;
  out.z = cx * sz;
  out.w = cx * cz;
  return out;
}

/** Rotate vector v by the inverse of q (world -> platform-local). */
export function toLocal(q, v, out = { x: 0, y: 0, z: 0 }) {
  const qx = -q.x, qy = -q.y, qz = -q.z, qw = q.w;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);
  out.x = v.x + qw * tx + (qy * tz - qz * ty);
  out.y = v.y + qw * ty + (qz * tx - qx * tz);
  out.z = v.z + qw * tz + (qx * ty - qy * tx);
  return out;
}
