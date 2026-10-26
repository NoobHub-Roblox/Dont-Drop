import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BALL_RADIUS } from '../engine/PhysicsWorld.js';
import { RIM_HEIGHT, TILE_DEPTH, PORTAL_COLORS } from '../engine/parseLevel.js';

export const BALL_COLORS = ['#ff6b57', '#ffc857', '#4ee0b0', '#b69cff', '#6fc3ff'];
const TOP_H = 0.34;
const TIER_TINTS = [['#9ba7bd', '#8d99b0'], ['#8296ad', '#758aa3'], ['#6f869b', '#637a90']];
const HOLE_COLORS = { target: 0xffd27a, decoy: 0xd9483b, drop: 0x5cc8ff };

/** All Three.js objects for one level attempt: platform tiers and ball meshes. */
export class LevelView {
  constructor(scene, level) {
    this.scene = scene;
    this.level = level;
    this.group = new THREE.Group();
    this.balls = [];
    this.rings = [];
    this.pulses = [];
    this.disposables = [];
    this.t = 0;
    this._build();
    scene.add(this.group);
  }

  _track(o) { this.disposables.push(o); return o; }

  _build() {
    const { level, group } = this;

    // Tiles: lighter slab on top, darker base underneath for visible thickness.
    const topGeo = this._track(new RoundedBoxGeometry(0.98, TOP_H, 0.98, 3, 0.05));
    const topMat = this._track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 }));
    const top = new THREE.InstancedMesh(topGeo, topMat, level.tiles.length);
    const baseH = TILE_DEPTH - TOP_H + 0.04;
    const baseGeo = this._track(new RoundedBoxGeometry(0.96, baseH, 0.96, 2, 0.03));
    const baseMat = this._track(new THREE.MeshStandardMaterial({ color: 0x3a4357, roughness: 0.8, metalness: 0.1 }));
    const base = new THREE.InstancedMesh(baseGeo, baseMat, level.tiles.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    level.tiles.forEach((t, i) => {
      m.makeTranslation(t.x, t.y - TOP_H / 2, t.z);
      top.setMatrixAt(i, m);
      const tint = TIER_TINTS[Math.min(t.layer, TIER_TINTS.length - 1)];
      c.set(t.shade ? tint[0] : tint[1]);
      top.setColorAt(i, c);
      m.makeTranslation(t.x, t.y - TILE_DEPTH + baseH / 2 - 0.02, t.z);
      base.setMatrixAt(i, m);
    });
    for (const mesh of [top, base]) { mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); }

    // Rim walls
    if (level.rims.length) {
      const rimGeo = this._track(new THREE.BoxGeometry(1, 1, 1));
      const rimMat = this._track(new THREE.MeshStandardMaterial({ color: 0xe9e3d6, roughness: 0.45, metalness: 0.05 }));
      const rims = new THREE.InstancedMesh(rimGeo, rimMat, level.rims.length);
      level.rims.forEach((w, i) => {
        m.compose(new THREE.Vector3(w.x, w.y + RIM_HEIGHT / 2, w.z), new THREE.Quaternion(), new THREE.Vector3(w.w, RIM_HEIGHT, w.d));
        rims.setMatrixAt(i, m);
      });
      rims.castShadow = rims.receiveShadow = true;
      group.add(rims);
    }

    // Blocks and pillars
    const blockMat = this._track(new THREE.MeshStandardMaterial({ color: 0xcfc7b6, roughness: 0.5, metalness: 0.05 }));
    const blockGeo = this._track(new RoundedBoxGeometry(0.96, 0.7, 0.96, 3, 0.06));
    for (const b of level.blocks) {
      const mesh = new THREE.Mesh(blockGeo, blockMat);
      mesh.position.set(b.x, b.y + 0.35, b.z);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    const pillarMat = this._track(new THREE.MeshStandardMaterial({ color: 0xd6945a, roughness: 0.4, metalness: 0.15 }));
    const pillarGeo = this._track(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 36));
    for (const p of level.pillars) {
      const mesh = new THREE.Mesh(pillarGeo, pillarMat);
      mesh.position.set(p.x, p.y + 0.3, p.z);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }

    // Holes: dark shaft + glowing lip.
    const shaftGeo = this._track(new THREE.CylinderGeometry(0.5 * Math.SQRT2 * 0.995, 0.5 * Math.SQRT2 * 0.995, TILE_DEPTH, 4, 1, true));
    shaftGeo.rotateY(Math.PI / 4);
    const shaftMat = this._track(new THREE.MeshBasicMaterial({ color: 0x030406, side: THREE.BackSide }));
    const ringGeo = this._track(new THREE.TorusGeometry(0.43, 0.028, 10, 56));
    const innerGeo = this._track(new THREE.TorusGeometry(0.28, 0.02, 8, 40));
    const discGeo = this._track(new THREE.CircleGeometry(0.36, 40));
    const ringMat = (hex) => this._track(new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 1.1, roughness: 0.4 }));
    const bar = this._track(new THREE.BoxGeometry(0.5, 0.012, 0.045));

    const addHole = (h, kind, hex) => {
      const mat = ringMat(hex);
      const shaft = new THREE.Mesh(shaftGeo, shaftMat);
      shaft.position.set(h.x, h.y - TILE_DEPTH / 2, h.z);
      group.add(shaft);
      const ring = new THREE.Mesh(ringGeo, mat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(h.x, h.y + 0.012, h.z);
      group.add(ring);
      const entry = { ring, kind, hole: h, mat, spin: [] };
      if (kind === 'decoy') {
        for (const a of [Math.PI / 4, -Math.PI / 4]) {
          const x = new THREE.Mesh(bar, mat);
          x.rotation.y = a;
          x.position.set(h.x, h.y + 0.012, h.z);
          group.add(x);
        }
      }
      if (kind === 'portal') {
        const inner = new THREE.Mesh(innerGeo, mat);
        inner.rotation.x = Math.PI / 2;
        inner.position.set(h.x, h.y + 0.012, h.z);
        group.add(inner);
        entry.spin.push(inner);
        // faint glow far down the shaft hints that this is a warp
        const disc = new THREE.Mesh(discGeo, this._track(new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.35, depthWrite: false })));
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(h.x, h.y - TILE_DEPTH + 0.02, h.z);
        group.add(disc);
      }
      this.rings.push(entry);
      return entry;
    };
    level.holes.forEach((h) => addHole(h, 'target', HOLE_COLORS.target));
    level.decoys.forEach((h) => addHole(h, 'decoy', HOLE_COLORS.decoy));
    level.drops.forEach((h) => addHole(h, 'drop', HOLE_COLORS.drop));
    level.portals.forEach((p) => { p.view = addHole(p, 'portal', new THREE.Color(PORTAL_COLORS[p.pair]).getHex()); });

    // Teleport exit pads: glowing ring on a solid tile
    for (const e of level.exits) {
      const hex = new THREE.Color(PORTAL_COLORS[e.pair]).getHex();
      const mat = ringMat(hex);
      const ring = new THREE.Mesh(ringGeo, mat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(e.x, e.y + 0.012, e.z);
      group.add(ring);
      const disc = new THREE.Mesh(discGeo, this._track(new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.22, depthWrite: false })));
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(e.x, e.y + 0.008, e.z);
      group.add(disc);
      e.view = { ring, kind: 'exit', hole: e, mat, spin: [], flash: 0 };
      this.rings.push(e.view);
    }

    // Balls (world space, driven by physics) with an x-ray ghost so they stay visible under upper tiers
    const ballGeo = this._track(new THREE.SphereGeometry(BALL_RADIUS, 48, 32));
    level.balls.forEach((b, i) => {
      const color = BALL_COLORS[i % BALL_COLORS.length];
      const mat = this._track(new THREE.MeshPhysicalMaterial({
        color, roughness: 0.18, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.3,
      }));
      const mesh = new THREE.Mesh(ballGeo, mat);
      mesh.castShadow = true;
      mesh.position.set(b.x, b.y + BALL_RADIUS + 0.01, b.z);
      if (level.layers > 1) {
        const ghostMat = this._track(new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.4, depthFunc: THREE.GreaterDepth, depthWrite: false,
        }));
        const ghost = new THREE.Mesh(ballGeo, ghostMat);
        ghost.scale.setScalar(1.02);
        ghost.renderOrder = 6;
        mesh.add(ghost);
      }
      this.scene.add(mesh);
      this.balls.push({ mesh, color: new THREE.Color(color), gone: 0, hidden: false });
    });
  }

  /** Copy physics poses to the meshes. */
  sync(pw) {
    const q = pw.quat;
    this.platformQuat = q;
    this.group.quaternion.set(q.x, q.y, q.z, q.w);
    pw.balls.forEach((b, i) => {
      const v = this.balls[i];
      if (!b.body) return;
      const p = b.body.translation();
      const r = b.body.rotation();
      v.mesh.position.set(p.x, p.y, p.z);
      v.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    });
  }

  /** World position of a platform-local point. */
  toWorld(local) {
    return new THREE.Vector3(local.x, local.y, local.z).applyQuaternion(this.group.quaternion).add(this.group.position);
  }

  _pulse(local, color) {
    const geo = this._track(new THREE.TorusGeometry(0.43, 0.02, 8, 48));
    const mat = this._track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    const pulse = new THREE.Mesh(geo, mat);
    pulse.rotation.x = Math.PI / 2;
    pulse.position.set(local.x, local.y + 0.02, local.z);
    this.group.add(pulse);
    this.pulses.push({ mesh: pulse, t: 0 });
  }

  /** Ball dropped into a target hole: it shrinks into the opening and the lip pulses. */
  collect(index, hole) {
    const v = this.balls[index];
    v.gone = 0.0001;
    v.start = v.mesh.position.clone();
    v.hole = this.toWorld({ x: hole.x, y: hole.y - 0.25, z: hole.z });
    const ring = this.rings.find((r) => r.hole === hole);
    if (ring) ring.flash = 1;
    this._pulse(hole, v.color);
  }

  /** Ball entered a teleport hole: flash both ends. */
  warp(index, portal) {
    const color = new THREE.Color(PORTAL_COLORS[portal.pair]);
    if (portal.view) portal.view.flash = 1;
    if (portal.exit.view) portal.exit.view.flash = 1;
    this._pulse(portal, color);
    this._pulse(portal.exit, color);
  }

  markFallen(index) {
    this.balls[index].fallen = true;
  }

  hideBall(index) {
    this.balls[index].mesh.visible = false;
  }

  update(dt) {
    this.t += dt;
    for (const r of this.rings) {
      r.flash = Math.max(0, (r.flash || 0) - dt * 2.5);
      let base = 1.0;
      if (r.kind === 'target') base = 1.0 + 0.25 * Math.sin(this.t * 3);
      else if (r.kind === 'decoy') base = 0.7;
      else if (r.kind === 'drop') base = 0.55;
      else base = 0.75 + 0.25 * Math.sin(this.t * 4);
      r.mat.emissiveIntensity = base + r.flash * 3;
      for (const s of r.spin) s.rotation.z += dt * 2.4;
    }
    for (const v of this.balls) {
      if (v.gone > 0) {
        v.gone += dt;
        const k = Math.min(1, v.gone / 0.35);
        v.mesh.position.lerpVectors(v.start, v.hole, k * k);
        v.mesh.scale.setScalar(Math.max(0.001, 1 - k * 0.9));
        if (k >= 1) v.mesh.visible = false;
      }
      if (v.fallen && v.mesh.position.y < -30) v.mesh.visible = false;
    }
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.t += dt;
      const k = p.t / 0.7;
      p.mesh.scale.setScalar(1 + k * 1.4);
      p.mesh.material.opacity = Math.max(0, 0.9 * (1 - k));
      if (k >= 1) { p.mesh.removeFromParent(); this.pulses.splice(i, 1); }
    }
  }

  /** Extra pose for the victory animation (lift + spin around the vertical axis). */
  setCelebration(lift, spin) {
    this.group.position.y = lift;
    const q = this.platformQuat || { x: 0, y: 0, z: 0, w: 1 };
    const spinQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin);
    this.group.quaternion.copy(spinQ).multiply(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  }

  dispose() {
    this.group.removeFromParent();
    for (const b of this.balls) b.mesh.removeFromParent();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.balls = [];
  }
}
