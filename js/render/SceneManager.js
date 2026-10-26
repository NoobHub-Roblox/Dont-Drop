import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const BG = 0x090c11;
const ELEVATION = THREE.MathUtils.degToRad(56);

function voidTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(70,92,140,0.55)');
  grad.addColorStop(0.35, 'rgba(34,46,76,0.3)');
  grad.addColorStop(1, 'rgba(9,12,17,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Owns the renderer, camera, lights, environment and the dark void. */
export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.FogExp2(BG, 0.016);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.55;

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);

    this.hemi = new THREE.HemisphereLight(0xa9bbdb, 0x0a0d12, 0.45);
    this.scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0xfff0dc, 2.6);
    this.key.position.set(5, 13, 7);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.025;
    this.key.shadow.radius = 4;
    this.scene.add(this.key, this.key.target);

    this.fill = new THREE.DirectionalLight(0x7f9bff, 0.7);
    this.fill.position.set(-8, 5, -6);
    this.scene.add(this.fill);

    // The void: a faint glow far below the platform plus slow drifting dust.
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 90),
      new THREE.MeshBasicMaterial({ map: voidTexture(), transparent: true, depthWrite: false, fog: false })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -22;
    this.scene.add(glow);
    this.glow = glow;

    const n = 180;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 36;
      arr[i * 3 + 1] = -Math.random() * 20 + 3;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 36;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0x8aa0cf, size: 0.07, transparent: true, opacity: 0.35, depthWrite: false }));
    this.scene.add(this.dust);

    this.bounds = { w: 7, d: 7 };
    this.distance = 14;
    this.zoom = 1; // transient multiplier (win / fail camera moves)
    this.zoomTarget = 1;
    this.orbit = 0; // slow yaw used by the menu backdrop
    this.sway = { x: 0, z: 0 }; // subtle camera drift that follows the tilt
    this.intro = 1; // 1 -> 0 camera fly-in
    this.camDir = new THREE.Vector3(0, Math.sin(ELEVATION), Math.cos(ELEVATION));
    this.lookAt = new THREE.Vector3(0, -0.3, 0);

    this.ac = new AbortController();
    window.addEventListener('resize', () => this.resize(), { signal: this.ac.signal });
    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(canvas.parentElement || canvas);
    }
    this.resize();
  }

  setShadows(on) {
    this.key.castShadow = on;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  resize() {
    const host = this.canvas.parentElement || document.body;
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fit();
  }

  /** Called when a new level is shown: sizes shadows and the camera to the platform. */
  setLevel(bounds, { animate = true } = {}) {
    this.bounds = bounds;
    const r = Math.hypot(bounds.w, bounds.d) / 2 + 2.5;
    const s = this.key.shadow.camera;
    s.left = -r; s.right = r; s.top = r; s.bottom = -r;
    s.near = 1; s.far = 45;
    s.updateProjectionMatrix();
    const tiers = bounds.layers || 1;
    this.lookAt.y = -0.3 - (tiers - 1) * 0.55;
    this.fit();
    this.zoom = this.zoomTarget = 1;
    this.intro = animate ? 1 : 0;
  }

  /** Find the closest camera distance at which the whole (tilted) platform is comfortably in view. */
  fit() {
    const { w, d } = this.bounds;
    const drop = ((this.bounds.layers || 1) - 1) * 1.2;
    const hx = w / 2 + 0.9, hz = d / 2 + 0.9;
    const corners = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [-0.9 - drop, 0.9]) corners.push(new THREE.Vector3(sx * hx, y, sz * hz));
    const cam = this.camera.clone();
    const limitX = 0.9, limitY = 0.74;
    let lo = 4, hi = 90;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      cam.position.copy(this.camDir).multiplyScalar(mid).add(this.lookAt);
      cam.lookAt(this.lookAt);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      let ok = true;
      for (const c of corners) {
        const p = c.clone().project(cam);
        if (Math.abs(p.x) > limitX || Math.abs(p.y) > limitY) { ok = false; break; }
      }
      if (ok) hi = mid; else lo = mid;
    }
    this.distance = hi;
    this._place(1);
  }

  _place(k) {
    const dist = this.distance * this.zoom * (1 + 0.45 * this.intro * this.intro);
    const dir = this.camDir.clone();
    dir.y += 0.35 * this.intro * this.intro;
    dir.normalize();
    if (this.orbit) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(this.orbit) * 0.5);
    this.camera.position.copy(dir).multiplyScalar(dist).add(this.lookAt);
    this.camera.position.x += this.sway.x * 0.25;
    this.camera.position.z += this.sway.z * 0.25;
    this.camera.lookAt(this.lookAt);
  }

  update(dt, t) {
    this.intro = Math.max(0, this.intro - dt / 1.1);
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 3);
    this._place(1);
    this.dust.rotation.y = t * 0.01;
    this.dust.position.y = Math.sin(t * 0.2) * 0.3;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.ac.abort();
    if (this.ro) this.ro.disconnect();
    this.renderer.dispose();
  }
}
