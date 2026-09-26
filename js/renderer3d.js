// 3D view (Three.js). Same interface as the 2D Renderer, reads the same state.
// Ground (terrain, roads, lots, overlays) reuses the 2D tile painter as a texture;
// buildings, trees and cars are instanced low-poly meshes.

import * as THREE from '../vendor/three/three.module.js';
import { RoundedBoxGeometry } from '../vendor/three/RoundedBoxGeometry.js';
import { Renderer, TS, forEachCar } from './renderer.js';
import { CONFIG } from './config.js';
import { TILE, FLAG, KINDS, footprintSize, isZone } from './map.js';
import { drawDistricts } from './overlays.js';
import { seasonPalette, timeOfDay, mix } from './seasons.js';
import { vehiclePositions, trainPositions } from './transit.js';

// Ground texture pixels per tile: full 2D detail on small maps, capped near 2k px for big ones.
const texPx = (size) => Math.max(16, Math.min(TS, Math.floor(2048 / size)));
const GROUND_THROTTLE_MS = 200; // max ground-texture redraw rate while the sim runs
const MESH_THROTTLE_MS = 120;

// Geometries with their origin at the base centre, so scale.y = height.
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  rbox: new RoundedBoxGeometry(1, 1, 1, 3, 0.09).translate(0, 0.5, 0), // soft-edged building bodies
  pyramid: new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 16).translate(0, 0.5, 0),
  tower: new THREE.CylinderGeometry(0.36, 0.5, 1, 18, 1, true).translate(0, 0.5, 0), // cooling tower
  bowl: new THREE.CylinderGeometry(0.5, 0.4, 1, 28, 1, true).translate(0, 0.5, 0),   // stadium stands
  pool: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),                           // lamp light on the ground
  cone: new THREE.ConeGeometry(0.5, 1, 14).translate(0, 0.5, 0),
  blob: new THREE.IcosahedronGeometry(0.5, 2).translate(0, 0.5, 0),
};

// Soft pastel palette matching the 2D view.
const COL = {
  resWall: '#faf4ec', resWall2: '#f4ecf1', resRoof: [null, '#e6bba8', '#ddae9b', '#d3a390'], resRoof2: ['#ebc6b7', '#d6cbe3', '#bcd9cb'],
  comWall: '#f1f5f9', comRoof: [null, '#b1cae3', '#a4c0de', '#98b6d6'], glass: '#c3d8ec', glassBand: '#f5f8fb', glass2: '#d0e4e1',
  indWall: '#f6f1e6', indRoof: [null, '#e2d2aa', '#daca9f', '#d0bf93'], stack: '#d0cac3', crate: '#dcc3a0', tank: '#ece8e1',
  band: '#e7dfd4', awnings: ['#e9b8b0', '#ecd9a6', '#b8dac6'],
  abandoned: '#d8d5cf', abandonedRoof: '#c4c0ba',
  trunk: '#bea58d', leaves: ['#a9d39a', '#9ecc8e', '#b3daa5'], hedge: '#b9daa7', garden: '#c9e6b8',
  slab: '#e2d8cb', bg: '#e9eff3',
  svc: {
    coal: '#d4cdc6', coalTower: '#ece9e4', steam: '#ffffff', wind: '#ffffff', pump: '#cce3f0', tank: '#e6f1f7',
    school: '#f1e4c0', schoolRoof: '#e2b6a4', clinic: '#ffffff', cross: '#e4a0a4', plaza: '#f0eadf', fountain: '#b5dcee',
    recycling: '#c8e2c2', bins: ['#aac6e2', '#ecd9a6', '#b8dac6'], flag: '#e4a0a4',
    bus: '#efcf9f', busSign: '#e3a35a', metro: '#ddd0ec', metroSign: '#a98bd0',
    police: '#dfe6f4', policeTrim: '#a3b5da', fire: '#efc6ba', fireTrim: '#d9998b', door: '#fbf7f0',
    stands: '#eeeaf2', seats: ['#b9c8e8', '#e9b8b0'], pitch: '#a6d68f', mast: '#c9ced6',
    uniWall: '#f1e6d2', uniRoof: '#d9a58f', dome: '#b9cde0', bench: '#c9a57a',
  },
  hightech: { wall: '#e3edf5', roof: '#cfdeea', glass: '#a9cbe6', solar: '#7f98bd', green: '#bfe0b0' },
  window: '#ffd98a', lamp: '#ffe3a8', pole: '#9aa3ad',
};
const DAY_BG = '#e9eff3', DUSK_BG = '#f3d8c2', NIGHT_BG = '#1b2236';
const hash = (a, b, c) => (((a * 73856093) ^ (b * 19349663) ^ (c * 83492791)) >>> 0) % 1000 / 1000;
const SNOW = new Map();

// Soft round glow texture for lamp pools.
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,220,150,1)');
  grad.addColorStop(0.4, 'rgba(255,200,120,0.45)');
  grad.addColorStop(1, 'rgba(255,190,110,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const colorCache = new Map();
function color(hex) {
  let c = colorCache.get(hex);
  if (!c) { c = new THREE.Color(hex); colorCache.set(hex, c); }
  return c;
}

// One InstancedMesh per geometry; filled from scratch whenever the city changes.
// Ground height under a point (x, z) on hilly maps, set by Renderer3D.updateTerrain; every batched
// object is lifted by it so buildings, cars and trees sit on the hills. null on flat maps.
let LIFT = null;

class Batch {
  constructor(scene, geometry, capacity, { shadows = true, basic = false } = {}) {
    const mat = basic ? new THREE.MeshBasicMaterial() : new THREE.MeshLambertMaterial();
    this.mesh = new THREE.InstancedMesh(geometry, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, color('#ffffff'));
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = shadows;
    this.mesh.frustumCulled = false;
    this.capacity = capacity;
    this.n = 0;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.p = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    scene.add(this.mesh);
  }
  begin() { this.n = 0; }
  // Add an instance from an explicit position/rotation/scale (for non-axis rotations).
  addTRS(p, q, s, hex) {
    if (this.n >= this.capacity) return;
    if (LIFT) p.y += LIFT(p.x, p.z);
    this.m.compose(p, q, s);
    this.mesh.setMatrixAt(this.n, this.m);
    this.mesh.setColorAt(this.n, color(hex));
    this.n++;
  }
  add(x, y, z, sx, sy, sz, hex, rotY = 0) {
    if (this.n >= this.capacity) return;
    if (LIFT) y += LIFT(x, z);
    this.q.setFromAxisAngle(this.up, rotY);
    this.m.compose(this.p.set(x, y, z), this.q, this.s.set(sx, sy, sz));
    this.mesh.setMatrixAt(this.n, this.m);
    this.mesh.setColorAt(this.n, color(hex));
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  setOpacity(o) {
    const m = this.mesh.material;
    m.transparent = o < 1;
    m.opacity = o;
    m.depthWrite = o >= 1;
    m.needsUpdate = true; // transparency changes need a shader recompile
  }
}

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.overlay = null;
    this.time = 0;
    this.env = { ...seasonPalette(6.5), ...timeOfDay(0, false) };
    this.viewW = 1; this.viewH = 1;

    const gl = new THREE.WebGLRenderer({ canvas, antialias: true });
    gl.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl = gl;

    const scene = new THREE.Scene();
    scene.background = color(COL.bg);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
    this.orbit = { target: new THREE.Vector3(20, 0, 20), yaw: -0.6, pitch: 0.85, dist: 28 };

    this.hemi = new THREE.HemisphereLight('#ffffff', '#c9d6bd', 2.1);
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight('#fff6ea', 1.7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);
    this.sun = sun;

    // Ground: a canvas texture painted with the 2D tile painter.
    this.groundCanvas = document.createElement('canvas');
    this.groundTex = new THREE.CanvasTexture(this.groundCanvas);
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    this.groundTex.anisotropy = gl.capabilities.getMaxAnisotropy();
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ map: this.groundTex }));
    this.ground.receiveShadow = true;
    scene.add(this.ground);
    this.slab = new THREE.Mesh(GEO.box, new THREE.MeshLambertMaterial({ color: COL.slab }));
    scene.add(this.slab);

    this.painter = Object.create(Renderer.prototype);
    this.painter.cam = { zoom: 1 };
    this.painter.flatOnly = true;

    this.makeBatches(40 * 40);

    // Hover outline + drag preview
    const sq = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 0, 1), new THREE.Vector3(0, 0, 1)]);
    this.hoverMesh = new THREE.LineLoop(sq, new THREE.LineBasicMaterial({ color: '#ffffff' }));
    scene.add(this.hoverMesh);
    const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.preview = new Batch(scene, quad, 1600, { shadows: false, basic: true });
    this.preview.setOpacity(0.5);

    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.cache = { map: null, version: -1, tick: -1, overlay: undefined, groundAt: 0, meshAt: 0 };
    this.resize();
  }

  // Instance capacity scales with map area (worst case: every tile built up).
  makeBatches(tiles) {
    for (const b of this.buildingBatches ?? []) this.scene.remove(b.mesh);
    for (const b of this.dynamicBatches ?? []) this.scene.remove(b.mesh);
    const scene = this.scene;
    this.rboxes = new Batch(scene, GEO.rbox, tiles * 5);
    this.boxes = new Batch(scene, GEO.box, tiles * 8);
    this.roofs = new Batch(scene, GEO.pyramid, tiles * 3);
    this.cylinders = new Batch(scene, GEO.cylinder, tiles * 4);
    this.towers = new Batch(scene, GEO.tower, Math.max(64, tiles / 4));
    this.cones = new Batch(scene, GEO.cone, tiles * 2);
    this.blobs = new Batch(scene, GEO.blob, tiles * 4);
    this.buildingBatches = [this.rboxes, this.boxes, this.roofs, this.cylinders, this.towers, this.cones, this.blobs];
    this.towers.mesh.material.side = THREE.DoubleSide;
    // Moving things, rebuilt every frame
    this.cars = new Batch(scene, GEO.box, tiles * 3, { shadows: false });
    this.blades = new Batch(scene, new THREE.BoxGeometry(1, 1, 1), Math.max(64, tiles / 2), { shadows: false });
    this.flames = new Batch(scene, GEO.blob, Math.max(64, tiles / 2), { shadows: false, basic: true });
    this.lamps = new Batch(scene, GEO.box, Math.max(64, tiles), { shadows: false, basic: true });
    this.smoke = new Batch(scene, GEO.blob, Math.max(64, tiles / 2), { shadows: false });
    this.smoke.setOpacity(0.55);
    // Stadium stands and night lighting (built with the buildings, shown by time of day)
    this.bowls = new Batch(scene, GEO.bowl, Math.max(16, tiles / 9));
    this.bowls.mesh.material.side = THREE.DoubleSide;
    this.windows = new Batch(scene, GEO.box, tiles * 10, { shadows: false, basic: true });
    this.poles = new Batch(scene, GEO.cylinder, tiles, { shadows: false });
    this.heads = new Batch(scene, GEO.box, tiles, { shadows: false, basic: true });
    this.pools = new Batch(scene, GEO.pool, tiles, { shadows: false, basic: true });
    const pm = this.pools.mesh.material;
    Object.assign(pm, { map: this.glowTex ??= glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.pools.mesh.renderOrder = 2;
    this.pools.glowing = true; // keeps its additive blend when overlays fade the buildings
    this.buildingBatches.push(this.bowls, this.windows, this.poles, this.heads, this.pools);
    this.transitVehicles = new Batch(scene, GEO.rbox, Math.max(64, tiles / 4), { shadows: false });
    this.dynamicBatches = [this.cars, this.blades, this.flames, this.smoke, this.lamps, this.transitVehicles];
    this.batchTiles = tiles;
  }

  // ------------------------------------------------------------ camera API
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.viewW = Math.max(1, r.width);
    this.viewH = Math.max(1, r.height);
    this.gl.setSize(this.viewW, this.viewH, false);
    this.camera.aspect = this.viewW / this.viewH;
    this.camera.updateProjectionMatrix();
  }

  updateCamera() {
    const o = this.orbit, c = Math.cos(o.pitch);
    // Keep depth precision proportional to how far out we are (big maps zoom out a lot).
    const near = Math.max(0.1, o.dist * 0.02), far = Math.max(400, o.dist * 8);
    if (this.camera.near !== near || this.camera.far !== far) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.set(
      o.target.x + Math.sin(o.yaw) * c * o.dist,
      o.target.y + Math.sin(o.pitch) * o.dist,
      o.target.z + Math.cos(o.yaw) * c * o.dist);
    this.camera.lookAt(o.target);
  }

  clampCamera(map) {
    const t = this.orbit.target;
    t.x = Math.max(0, Math.min(map.width, t.x));
    t.z = Math.max(0, Math.min(map.height, t.z));
  }

  centerOn(map, tx, ty) {
    this.orbit.target.set(tx + 0.5, 0, ty + 0.5);
    this.clampCamera(map);
  }

  viewCenterTile() {
    return { x: Math.floor(this.orbit.target.x), y: Math.floor(this.orbit.target.z) };
  }

  panBy(map, dx, dy) {
    const o = this.orbit;
    const scale = (2 * o.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / this.viewH;
    const rx = Math.cos(o.yaw), rz = -Math.sin(o.yaw);   // screen-right on the ground
    const fx = -Math.sin(o.yaw), fz = -Math.cos(o.yaw);  // screen-up (away from camera) on the ground
    const v = dy * scale / Math.max(0.35, Math.sin(o.pitch));
    o.target.x += -rx * dx * scale + fx * v;
    o.target.z += -rz * dx * scale + fz * v;
    this.clampCamera(map);
  }

  rotateBy(dx, dy) {
    const o = this.orbit;
    o.yaw -= dx * 0.008;
    o.pitch = Math.max(0.3, Math.min(1.45, o.pitch + dy * 0.005));
  }

  zoomAt(map, sx, sy, factor) {
    const o = this.orbit;
    const p = this.groundPoint(sx, sy);
    const before = o.dist;
    o.dist = Math.max(6, Math.min(this.maxDist ?? 90, o.dist / factor));
    const k = 1 - o.dist / before; // move toward the cursor as we zoom in
    if (p) { o.target.x += (p.x - o.target.x) * k; o.target.z += (p.z - o.target.z) * k; }
    this.clampCamera(map);
  }

  groundPoint(sx, sy) {
    this.updateCamera();
    const ndc = new THREE.Vector2((sx / this.viewW) * 2 - 1, -(sy / this.viewH) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (LIFT) { const h = this.raycaster.intersectObject(this.ground)[0]; return h ? h.point : null; }
    return this.raycaster.ray.intersectPlane(this.groundPlane, hit) ? hit : null;
  }

  screenToTile(sx, sy) {
    const p = this.groundPoint(sx, sy);
    return p ? { x: Math.floor(p.x), y: Math.floor(p.z) } : { x: -1, y: -1 };
  }

  tileToScreen(x, y) {
    this.updateCamera();
    const v = new THREE.Vector3(x + 1, LIFT ? LIFT(x + 1, y + 1) : 0, y + 1).project(this.camera);
    return { x: (v.x + 1) / 2 * this.viewW, y: (1 - v.y) / 2 * this.viewH };
  }

  // ------------------------------------------------------------ scene building
  // Hills: the ground mesh gets a vertex per tile corner at the average height of the tiles
  // around it, and LIFT interpolates those corners for everything placed on top.
  updateTerrain(map) {
    if (this.terrainMap === map && this.terrainVer === map.heightVersion) return;
    this.terrainMap = map; this.terrainVer = map.heightVersion;
    const w = map.width, h = map.height, S = CONFIG.terrain.step3d;
    const hilly = map.elev.some((v) => v > 0);
    this.ground.geometry.dispose();
    const geo = new THREE.PlaneGeometry(w, h, hilly ? w : 1, hilly ? h : 1).rotateX(-Math.PI / 2).translate(w / 2, 0, h / 2);
    this.ground.geometry = geo;
    if (!hilly) { LIFT = null; return; }
    const W = w + 1, corners = new Float32Array(W * (h + 1));
    for (let cy = 0; cy <= h; cy++) for (let cx = 0; cx <= w; cx++) {
      let sum = 0, n = 0;
      for (const [tx, ty] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]) if (tx >= 0 && ty >= 0 && tx < w && ty < h) { sum += map.elev[ty * w + tx]; n++; }
      corners[cy * W + cx] = (sum / n) * S;
    }
    const pos = geo.attributes.position;
    for (let k = 0; k < pos.count; k++) pos.setY(k, corners[Math.round(pos.getZ(k)) * W + Math.round(pos.getX(k))]);
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    LIFT = (x, z) => {
      const fx = Math.max(0, Math.min(w - 1e-6, x)), fz = Math.max(0, Math.min(h - 1e-6, z));
      const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0, c = (a, b) => corners[(z0 + b) * W + x0 + a];
      return (c(0, 0) * (1 - tx) + c(1, 0) * tx) * (1 - tz) + (c(0, 1) * (1 - tx) + c(1, 1) * tx) * tz;
    };
  }

  fitMap(map) {
    const w = map.width, h = map.height;
    if (w * h > this.batchTiles) this.makeBatches(w * h);
    if (w * h > this.preview.capacity) {
      this.scene.remove(this.preview.mesh);
      this.preview = new Batch(this.scene, this.preview.mesh.geometry, w * h, { shadows: false, basic: true });
      this.preview.setOpacity(0.5);
    }
    this.texPx = texPx(Math.max(w, h));
    this.groundCanvas.width = w * this.texPx;
    this.groundCanvas.height = h * this.texPx;
    this.maxDist = Math.max(w, h) * 2.2;
    this.orbit.dist = Math.min(this.orbit.dist, this.maxDist); // a smaller map shouldn't start zoomed far out
    this.groundTex.dispose();
    this.groundTex.image = this.groundCanvas;
    this.ground.geometry.dispose();
    this.ground.geometry = new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2).translate(w / 2, 0, h / 2);
    this.terrainMap = null; // rebuilt with heights by updateTerrain
    this.slab.scale.set(w + 0.6, 1.2, h + 0.6);
    this.slab.position.set(w / 2, -1.28, h / 2); // top 8cm below the ground: no z-fighting
    const s = this.sun;
    const k = Math.max(w, h) / 40;
    s.position.set(w / 2 - 22 * k, 38 * k, h / 2 + 16 * k);
    s.target.position.set(w / 2, 0, h / 2);
    const r = Math.max(w, h) * 0.8;
    const shadowRes = Math.max(w, h) > 64 ? 4096 : 2048;
    if (s.shadow.mapSize.x !== shadowRes) {
      s.shadow.mapSize.set(shadowRes, shadowRes);
      s.shadow.map?.dispose();
      s.shadow.map = null;
    }
    Object.assign(s.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 120 * k });
    s.shadow.camera.updateProjectionMatrix();
  }

  paintGround(map, districts) {
    const ctx = this.groundCanvas.getContext('2d');
    const p = this.painter;
    p.ctx = ctx;
    p.overlay = this.overlay;
    p.env = this.env;
    const scale = this.texPx / TS;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) p.drawGround(map, x, y);
    p.drawGrid(0, 0, map.width - 1, map.height - 1);
    if (this.overlay !== 'districts') drawDistricts(ctx, map, districts, TS, 0, 0, map.width - 1, map.height - 1);
    if (this.routesState) p.drawRoutes(this.routesState);
    if (this.overlay) p.drawOverlay(map, 0, 0, map.width - 1, map.height - 1, districts);
    this.groundTex.needsUpdate = true;
  }

  buildMeshes(map) {
    for (const b of this.buildingBatches) b.begin();
    this.turbines = [];
    this.burning = [];
    this.signals = [];
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      const i = map.idx(x, y), t = map.type[i], v = map.variant[i];
      if (t === TILE.EMPTY && map.hasFlag(i, FLAG.TREES)) {
        this.tree(x + (9 + (v & 3)) / 32, y + 10 / 32, 0.36, v);
        this.tree(x + 22 / 32, y + (12 + ((v >> 2) & 3)) / 32, 0.3, v >> 1);
        this.tree(x + (14 + ((v >> 4) & 3)) / 32, y + 23 / 32, 0.38, v >> 2);
      } else if (t === TILE.PARK) {
        this.tree(x + 8 / 32, y + 9 / 32, 0.32, v);
        this.tree(x + 24 / 32, y + 23 / 32, 0.38, v >> 2);
        if (v & 4) this.tree(x + 23 / 32, y + 7 / 32, 0.26, v >> 3);
      } else if (isZone(t) && map.level[i] > 0) {
        const ab = map.hasFlag(i, FLAG.ABANDONED), P = this.placer(map, x, y);
        this.lit = !ab && !map.hasFlag(i, FLAG.FIRE) ? { seed: v + i, share: t === TILE.RES ? 0.5 : t === TILE.COM ? 0.6 : 0.3 } : null;
        if (t === TILE.IND && !ab && map.hasFlag(i, FLAG.HIGHTECH)) this.hightech(P, map.level[i], v);
        else if (t === TILE.COM && !ab && map.hasFlag(i, FLAG.HOTEL)) this.hotel(P, map.level[i], v);
        else if (t === TILE.OFFICE || t === TILE.FARM || t === TILE.MIXED) this.special(P, t, map.level[i], v, ab);
        else this.building(P, t, map.level[i], v, ab);
      } else if (t === TILE.SERVICE) {
        const k = KINDS[map.kind[i]], [fw, fh] = footprintSize(k);
        if (fw > 1 || fh > 1) { if (!map.part[i]) this.landmark(k, x, y, fw, fh, v); }
        else this.service(this.placer(map, x, y), k, v, x, y);
      } else if (t === TILE.ROAD && (x + y) % 2 === 0) {
        this.streetLamp(map, x, y, i);
      }
      if (map.hasFlag(i, FLAG.FIRE)) this.burning.push({ x, y, v });
      if (map.trash[i] > 25) for (let k = 0; k < Math.min(4, Math.ceil(map.trash[i] / 18)); k++) this.blobs.add(x + 0.15 + ((v >> k) & 7) * 0.09, 0, y + 0.85 - (k % 2) * 0.08, 0.1, 0.09, 0.1, ['#5f6670', '#7b8a6e', '#6d6272'][(v + k) % 3]);
      if (t === TILE.ROAD && map.hasFlag(i, FLAG.INTERCHANGE)) this.interchange(map, x, y);
      if (t === TILE.ROAD && map.hasFlag(i, FLAG.LIGHTS)) {
        // Four signal poles at the corners; their lamps change colour every frame (buildSignals).
        const hw = map.roadClass[i] > 0 ? 0.47 : 0.36;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const px = x + 0.5 + sx * hw, pz = y + 0.5 + sy * hw;
          this.cylinders.add(px, 0, pz, 0.03, 0.34, 0.03, '#8a929c');
          this.boxes.add(px, 0.3, pz, 0.07, 0.1, 0.07, '#6f7782');
          this.signals.push({ x: px, z: pz, ns: sx === sy });
        }
      }
    }
    for (const b of this.buildingBatches) b.end();
  }

  tree(x, z, size, v) {
    const h = size * (0.9 + (v & 3) * 0.12);
    this.cylinders.add(x, 0, z, 0.06, h * 0.45, 0.06, COL.trunk);
    this.blobs.add(x, h * 0.3, z, size, h, size, this.env.tree[v % 3]);
  }

  // Roof colour dusted with snow in winter.
  snowy(hex) {
    const snow = Math.round((this.env.snow ?? 0) * 10) / 10;
    if (!snow) return hex;
    const key = hex + snow;
    let c = SNOW.get(key);
    if (!c) { c = mix(hex, '#ffffff', snow * 0.6); SNOW.set(key, c); }
    return c;
  }

  // Windows on the four faces of a building body (u, w, sx, sz from y0 to y0 + h), lit at night.
  win(P, u, w, sx, sz, h, y0 = 0, step = 0.22) {
    const L = this.lit;
    if (!L) return;
    let f = 0;
    for (let y = y0 + 0.09; y < y0 + h - 0.1; y += step, f++) {
      for (const k of [-1, 1]) {
        const a = hash(L.seed, f, k), b = hash(L.seed + 7, f, k);
        if (a < L.share) P(this.windows, u + k * sx * 0.24, w + sz / 2 + 0.006, sx * 0.2, 0.012, y, 0.07, COL.window);
        if (b < L.share) P(this.windows, u + k * sx * 0.24, w - sz / 2 - 0.006, sx * 0.2, 0.012, y, 0.07, COL.window);
        if (hash(L.seed + 3, f, k) < L.share) P(this.windows, u + sx / 2 + 0.006, w + k * sz * 0.24, 0.012, sz * 0.2, y, 0.07, COL.window);
        if (hash(L.seed + 5, f, k) < L.share) P(this.windows, u - sx / 2 - 0.006, w + k * sz * 0.24, 0.012, sz * 0.2, y, 0.07, COL.window);
      }
    }
  }

  // Street lamp on the verge of a road tile, with a pool of light on the ground at night.
  streetLamp(map, x, y, i) {
    const road = (dx, dy) => map.inBounds(x + dx, y + dy) && map.type[map.idx(x + dx, y + dy)] === TILE.ROAD;
    const horiz = road(-1, 0) || road(1, 0), vert = road(0, -1) || road(0, 1);
    if (horiz && vert) return; // no lamps in the middle of junctions
    const off = map.roadClass[i] > 0 ? 0.5 : 0.4, side = (x & 1) ? -1 : 1;
    const px = x + 0.5 + (horiz ? 0.18 * side : off * side), pz = y + 0.5 + (horiz ? off * side : 0.18 * side);
    this.poles.add(px, 0, pz, 0.025, 0.42, 0.025, COL.pole);
    this.heads.add(px, 0.42, pz, 0.07, 0.035, 0.07, COL.lamp);
    this.pools.add(px, 0.015, pz, 1.1, 1, 1.1, '#ffffff');
  }

  // Returns a helper that places parts in tile-local coordinates, turned so the building's
  // front (local +z) faces an adjacent road. (u, w) are offsets from the tile centre.
  placer(map, x, y) {
    const road = (dx, dy) => map.inBounds(x + dx, y + dy) && map.type[map.idx(x + dx, y + dy)] === TILE.ROAD;
    const k = road(0, 1) ? 0 : road(1, 0) ? 1 : road(0, -1) ? 2 : road(-1, 0) ? 3 : 0;
    const a = k * Math.PI / 2, c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));
    const cx = x + 0.5, cz = y + 0.5;
    return (batch, u, w, sx, sz, y0, h, hex, rot = 0) =>
      batch.add(cx + u * c + w * s, y0, cz - u * s + w * c, sx, h, sz, hex, a + rot);
  }

  building(P, t, lv, v, ab) {
    const wall = (hex) => (ab ? COL.abandoned : hex);
    const roof = (hex) => (ab ? COL.abandonedRoof : this.snowy(hex));
    const alt = (v >> 5) & 1; // two designs per zone and density level
    const bands = (u, w, sx, sz, h, step, hex, from = step) => {
      for (let y0 = from; y0 < h - 0.05; y0 += step) P(this.boxes, u, w, sx + 0.025, sz + 0.025, y0, 0.03, hex);
    };
    if (t === TILE.RES) {
      const r = roof(COL.resRoof[lv]);
      if (lv === 1 && !alt) {        // two gabled cottages
        for (const [u, w] of [[-0.2, -0.18], [0.2, 0.16]]) {
          P(this.rboxes, u, w, 0.3, 0.3, 0, 0.21, wall(COL.resWall));
          this.win(P, u, w, 0.3, 0.3, 0.21);
          P(this.roofs, u, w, 0.36, 0.36, 0.21, 0.17, r);
        }
      } else if (lv === 1) {         // bungalow with a garden hedge
        P(this.rboxes, 0, -0.08, 0.56, 0.38, 0, 0.2, wall(COL.resWall2));
        this.win(P, 0, -0.08, 0.56, 0.38, 0.2);
        P(this.roofs, 0, -0.08, 0.66, 0.46, 0.2, 0.13, roof(COL.resRoof2[v % 3]));
        P(this.boxes, 0, 0.36, 0.7, 0.07, 0, 0.1, roof(COL.hedge));
        P(this.blobs, 0.3, 0.2, 0.2, 0.2, 0.02, 0.24, roof(COL.leaves[v % 3]));
      } else if (lv === 2 && !alt) { // apartment slab
        const h = 0.72 + (v & 3) * 0.06;
        P(this.rboxes, 0, -0.03, 0.76, 0.62, 0, h, wall(COL.resWall));
        this.win(P, 0, -0.03, 0.76, 0.62, h, 0, 0.24);
        bands(0, -0.03, 0.76, 0.62, h, 0.24, roof(COL.band));
        P(this.rboxes, 0, -0.03, 0.8, 0.66, h, 0.06, r);
      } else if (lv === 2) {         // row of three townhouses
        for (let n = 0; n < 3; n++) {
          const u = -0.27 + n * 0.27, h = 0.5 + ((v >> n) & 1) * 0.12;
          P(this.rboxes, u, -0.02, 0.25, 0.6, 0, h, wall(n === 1 ? COL.resWall2 : COL.resWall));
          this.win(P, u, -0.02, 0.25, 0.6, h);
          P(this.roofs, u, -0.02, 0.3, 0.66, h, 0.16, roof(COL.resRoof2[(v + n) % 3]));
        }
      } else if (!alt) {             // tower with floor bands and a roof plant
        const h = 1.9 + (v & 3) * 0.2;
        P(this.rboxes, 0, 0, 0.8, 0.8, 0, h, wall(COL.resWall));
        this.win(P, 0, 0, 0.8, 0.8, h, 0, 0.3);
        bands(0, 0, 0.8, 0.8, h, 0.3, roof(COL.band));
        P(this.rboxes, 0, 0, 0.84, 0.84, h, 0.07, r);
        P(this.rboxes, 0, 0, 0.26, 0.26, h + 0.07, 0.18, roof('#d6b7a8'));
      } else {                       // terraced tower with roof gardens
        const steps = [[0.84, 0.8], [0.66, 0.75], [0.48, 0.7]];
        let y0 = 0;
        steps.forEach(([sz, h], n) => {
          P(this.rboxes, 0, -0.04 * n, sz, sz, y0, h, wall(COL.resWall2));
          this.win(P, 0, -0.04 * n, sz, sz, h, y0, 0.25);
          bands(0, -0.04 * n, sz, sz, h, 0.25, roof(COL.band), 0.25);
          y0 += h;
          P(this.boxes, 0, -0.04 * n, sz - 0.04, sz - 0.04, y0, 0.03, roof(COL.garden));
          if (n < 2) P(this.blobs, sz / 2 - 0.1, sz / 2 - 0.1 - 0.04 * n, 0.14, 0.14, y0, 0.14, roof(COL.leaves[(v + n) % 3]));
        });
      }
    } else if (t === TILE.COM) {
      const r = roof(COL.comRoof[lv]);
      if (lv === 1 && !alt) {        // shop with an awning
        P(this.rboxes, 0, -0.05, 0.7, 0.46, 0, 0.34, wall(COL.comWall));
        this.win(P, 0, -0.05, 0.7, 0.46, 0.34);
        P(this.boxes, 0, -0.05, 0.72, 0.48, 0.34, 0.04, r);
        P(this.boxes, 0, 0.22, 0.72, 0.12, 0.22, 0.04, roof(COL.awnings[v % 3]));
      } else if (lv === 1) {         // café kiosk with a patio of umbrellas
        P(this.cylinders, -0.15, -0.12, 0.42, 0.42, 0, 0.32, wall(COL.comWall));
        P(this.cones, -0.15, -0.12, 0.5, 0.5, 0.32, 0.12, r);
        for (const [u, w] of [[0.2, 0.22], [0.28, -0.12], [-0.12, 0.3]]) {
          P(this.cylinders, u, w, 0.025, 0.025, 0, 0.2, roof('#9aa4b2'));
          P(this.cones, u, w, 0.22, 0.22, 0.2, 0.07, roof(COL.awnings[(v + Math.round(u * 10)) % 3]));
        }
      } else if (lv === 2 && !alt) { // office block
        const h = 1.0 + (v & 3) * 0.08;
        P(this.rboxes, 0, -0.03, 0.82, 0.7, 0, h, wall('#e1ebf5'));
        this.win(P, 0, -0.03, 0.82, 0.7, h, 0, 0.22);
        bands(0, -0.03, 0.82, 0.7, h, 0.22, roof(COL.glassBand));
        P(this.rboxes, 0, -0.03, 0.85, 0.73, h, 0.05, r);
      } else if (lv === 2) {         // low mall with a glass atrium
        P(this.rboxes, 0, -0.02, 0.88, 0.76, 0, 0.42, wall(COL.comWall));
        this.win(P, 0, -0.02, 0.88, 0.76, 0.42);
        P(this.rboxes, 0, -0.02, 0.4, 0.4, 0.42, 0.2, roof(COL.glass2));
        P(this.boxes, 0, 0.37, 0.7, 0.04, 0.3, 0.04, roof(COL.awnings[v % 3]));
      } else if (!alt) {             // glass tower with a crown
        const h = 2.6 + (v & 3) * 0.25;
        P(this.rboxes, 0, 0, 0.78, 0.78, 0, h, wall(COL.glass));
        this.win(P, 0, 0, 0.78, 0.78, h, 0, 0.26);
        bands(0, 0, 0.78, 0.78, h, 0.26, wall(COL.glassBand));
        P(this.rboxes, 0, 0, 0.56, 0.56, h, 0.3, r);
        P(this.cylinders, 0, 0, 0.05, 0.05, h + 0.3, 0.45, roof('#eef2f6'));
      } else {                       // round tower with a spire
        const h = 2.4 + (v & 3) * 0.25;
        P(this.cylinders, 0, 0, 0.78, 0.78, 0, h, wall(COL.glass2));
        this.win(P, 0, 0, 0.7, 0.7, h, 0, 0.28);
        for (let y0 = 0.28; y0 < h - 0.05; y0 += 0.28) P(this.cylinders, 0, 0, 0.8, 0.8, y0, 0.03, wall(COL.glassBand));
        P(this.cylinders, 0, 0, 0.6, 0.6, h, 0.2, r);
        P(this.cones, 0, 0, 0.2, 0.2, h + 0.2, 0.6, roof('#eef2f6'));
      }
    } else {
      const r = roof(COL.indRoof[lv]);
      if (lv === 1 && !alt) {        // workshop with crates
        P(this.rboxes, -0.12, -0.03, 0.5, 0.56, 0, 0.36, wall(COL.indWall));
        P(this.boxes, -0.12, -0.03, 0.52, 0.58, 0.36, 0.04, r);
        P(this.rboxes, 0.28, 0.12, 0.16, 0.16, 0, 0.14, roof(COL.crate));
        P(this.rboxes, 0.3, 0.3, 0.14, 0.14, 0, 0.12, roof(COL.crate));
      } else if (lv === 1) {         // warehouse with a loading dock and a truck
        P(this.rboxes, 0, -0.12, 0.8, 0.5, 0, 0.32, wall(COL.indWall));
        P(this.roofs, 0, -0.12, 0.84, 0.54, 0.32, 0.08, r);
        P(this.rboxes, -0.18, 0.3, 0.14, 0.26, 0, 0.12, roof('#f6f6f6'));
        P(this.rboxes, -0.18, 0.2, 0.12, 0.08, 0, 0.1, roof(COL.awnings[v % 3]));
      } else if (lv === 2 && !alt) { // sawtooth factory
        P(this.rboxes, 0, -0.03, 0.84, 0.7, 0, 0.5, wall(COL.indWall));
        this.win(P, 0, -0.03, 0.84, 0.7, 0.5);
        for (let n = 0; n < 4; n++) P(this.boxes, 0, -0.3 + n * 0.18, 0.84, 0.09, 0.5, 0.1, r);
      } else if (lv === 2) {         // tank farm beside a small office
        P(this.rboxes, -0.25, 0.2, 0.36, 0.4, 0, 0.36, wall(COL.indWall));
        for (const [u, w, d] of [[0.2, -0.2, 0.36], [0.2, 0.22, 0.3], [-0.22, -0.25, 0.3]]) {
          P(this.cylinders, u, w, d, d, 0, 0.42, roof(COL.tank));
          P(this.cylinders, u, w, d * 0.9, d * 0.9, 0.42, 0.04, r);
        }
      } else if (!alt) {             // plant with smokestacks
        P(this.rboxes, -0.1, 0.03, 0.7, 0.76, 0, 0.66, wall(COL.indWall));
        this.win(P, -0.1, 0.03, 0.7, 0.76, 0.66);
        for (let n = 0; n < 4; n++) P(this.boxes, -0.1, -0.26 + n * 0.19, 0.7, 0.09, 0.66, 0.12, r);
        P(this.cylinders, 0.36, -0.3, 0.15, 0.15, 0, 1.5, roof(COL.stack));
        P(this.cylinders, 0.36, 0, 0.12, 0.12, 0, 1.15, roof(COL.stack));
      } else {                       // refinery: silos, pipes and a flare stack
        for (const [u, w] of [[-0.24, -0.24], [0.02, -0.24], [-0.24, 0.04], [0.02, 0.04]]) {
          P(this.cylinders, u, w, 0.22, 0.22, 0, 1.0, roof(COL.tank));
          P(this.cones, u, w, 0.22, 0.22, 1.0, 0.1, r);
        }
        P(this.boxes, -0.11, -0.1, 0.5, 0.05, 0.55, 0.05, roof(COL.stack));
        P(this.boxes, 0.3, 0.2, 0.05, 0.5, 0.3, 0.05, roof(COL.stack));
        P(this.cylinders, 0.32, 0.3, 0.08, 0.08, 0, 1.8, roof(COL.stack));
      }
    }
  }

  // Offices, farms and mixed-use.
  special(P, t, lv, v, ab) {
    const wall = (hex) => (ab ? COL.abandoned : hex), roof = (hex) => (ab ? COL.abandonedRoof : this.snowy(hex));
    if (t === TILE.OFFICE) {
      const h = [0, 0.7, 1.6, 3.2][lv] + (v & 3) * 0.12, sz = [0, 0.5, 0.74, 0.8][lv];
      P(this.rboxes, 0, 0, sz, sz, 0, h, wall('#cfe8ec'));
      this.win(P, 0, 0, sz, sz, h, 0, 0.22);
      for (let y0 = 0.22; y0 < h - 0.05; y0 += 0.22) P(this.boxes, 0, 0, sz + 0.02, sz + 0.02, y0, 0.025, wall('#eef8f9'));
      P(this.rboxes, 0, 0, sz * 0.7, sz * 0.7, h, 0.12, roof('#8ecbd3'));
    } else if (t === TILE.FARM) {
      const E = this.env, crop = ab ? '#d6d0c2' : E.snow > 0.5 ? '#eef2f0' : E.season === 3 ? '#e3c27a' : E.season === 2 ? '#c6dd8e' : '#d8e6a8';
      P(this.boxes, 0, 0, 0.9, 0.9, 0, 0.03, crop);
      for (let k = -3; k <= 3; k++) P(this.boxes, k * 0.12, 0, 0.05, 0.84, 0.03, 0.04 + (lv >= 2 && E.season === 2 ? 0.05 : 0), ab ? '#c4beb0' : '#9fbf6e');
      if (lv >= 2) { P(this.rboxes, -0.25, -0.25, 0.3, 0.26, 0, 0.26, wall('#d98a7a')); P(this.roofs, -0.25, -0.25, 0.34, 0.3, 0.26, 0.14, roof('#b86f62')); }
      if (lv >= 3) { P(this.cylinders, 0.26, -0.26, 0.16, 0.16, 0, 0.62, wall('#e4e1da')); P(this.cones, 0.26, -0.26, 0.17, 0.17, 0.62, 0.1, roof('#c9c3b8')); }
    } else {
      const h = [0, 0.42, 0.85, 1.4][lv], sz = [0, 0.6, 0.8, 0.84][lv];
      P(this.rboxes, 0, -0.03, sz, sz * 0.85, 0, h, wall('#e8c7b4'));
      this.win(P, 0, -0.03, sz, sz * 0.85, h, 0.24, 0.24);
      P(this.boxes, 0, -0.03 + sz * 0.425 + 0.04, sz, 0.1, 0.18, 0.04, roof(COL.awnings[v % 3])); // awning over the shops
      P(this.rboxes, 0, -0.03, sz + 0.03, sz * 0.85 + 0.03, h, 0.05, roof('#cc947c'));
    }
  }

  // Hotels: a tower with a rooftop pool.
  hotel(P, lv, v) {
    const h = lv === 3 ? 2.2 : 1.3;
    P(this.rboxes, 0, 0, 0.74, 0.74, 0, h, '#f3e3d3');
    this.win(P, 0, 0, 0.74, 0.74, h, 0, 0.24);
    P(this.boxes, 0, 0, 0.78, 0.78, h, 0.05, this.snowy('#d9a58f'));
    P(this.boxes, 0, -0.1, 0.4, 0.26, h + 0.05, 0.02, '#9ed3ee');
    for (const u of [-0.25, 0.25]) P(this.cones, u, 0.22, 0.14, 0.14, h + 0.05, 0.08, '#e9b8b0');
  }

  // High-tech industry: glass labs, solar roofs and green courtyards.
  hightech(P, lv, v) {
    const H = COL.hightech, sn = (c) => this.snowy(c);
    if (lv === 1) {
      P(this.rboxes, 0, -0.08, 0.7, 0.5, 0, 0.3, H.wall);
      this.win(P, 0, -0.08, 0.7, 0.5, 0.3);
      P(this.boxes, 0, -0.08, 0.4, 0.14, 0.3, 0.05, H.glass);
      P(this.boxes, 0, 0.32, 0.72, 0.16, 0, 0.02, H.green);
    } else if (lv === 2) {
      P(this.rboxes, 0, -0.26, 0.84, 0.34, 0, 0.5, H.wall);
      this.win(P, 0, -0.26, 0.84, 0.34, 0.5);
      P(this.rboxes, -0.22, 0.18, 0.38, 0.36, 0, 0.44, H.wall);
      this.win(P, -0.22, 0.18, 0.38, 0.36, 0.44);
      P(this.boxes, 0.22, 0.18, 0.36, 0.34, 0, 0.02, H.green);
      for (let k = 0; k < 4; k++) P(this.boxes, -0.3 + k * 0.2, -0.26, 0.15, 0.24, 0.5, 0.02, sn(H.solar));
    } else {
      P(this.cylinders, 0, 0, 0.84, 0.84, 0, 0.6, H.wall);
      this.win(P, 0, 0, 0.74, 0.74, 0.6);
      P(this.blobs, 0, 0, 0.72, 0.72, 0.38, 0.5, H.glass);
      P(this.boxes, 0.3, 0.34, 0.2, 0.12, 0, 0.02, sn(H.solar));
    }
  }

  // Multi-tile landmarks, laid out in map coordinates from their top-left tile.
  landmark(k, x, y, w, h, v) {
    if (this.tourism3d(k, x, y, w, h, v)) return;
    const S = COL.svc, cx = x + w / 2, cz = y + h / 2, sn = (c) => this.snowy(c);
    if (k === 'stadium') {
      this.bowls.add(cx, 0, cz, 2.8, 0.6, 2.55, sn(S.stands));
      this.bowls.add(cx, 0.02, cz, 2.5, 0.52, 2.25, S.seats[v % 2]);
      this.boxes.add(cx, 0, cz, 1.65, 0.03, 1.07, this.env.snow > 0.5 ? '#e8f0e4' : S.pitch);
      this.boxes.add(cx, 0.03, cz, 0.025, 0.005, 0.9, '#ffffff');
      for (const [dx, dz] of [[-1.25, -1.25], [1.25, -1.25], [-1.25, 1.25], [1.25, 1.25]]) {
        this.cylinders.add(cx + dx, 0, cz + dz, 0.06, 1.35, 0.06, S.mast);
        this.boxes.add(cx + dx, 1.35, cz + dz, 0.26, 0.1, 0.1, S.mast);
        this.heads.add(cx + dx * 0.97, 1.33, cz + dz * 0.97, 0.22, 0.05, 0.08, COL.lamp);
        this.pools.add(cx + dx * 0.4, 0.04, cz + dz * 0.4, 1.8, 1, 1.8, '#ffffff');
      }
      this.lit = null;
    } else if (k === 'university') {
      this.lit = { seed: v, share: 0.45 };
      const hall = [cx, y + 0.35, w - 0.35, 0.5], wings = [[x + 0.33, cz + 0.12], [x + w - 0.33, cz + 0.12]];
      this.rboxes.add(hall[0], 0, hall[1], hall[2], 0.62, hall[3], S.uniWall);
      this.roofs.add(hall[0], 0.62, hall[1], hall[2] + 0.06, 0.2, hall[3] + 0.06, sn(S.uniRoof));
      const P0 = (b, u, ww, sx, sz, y0, hh, hex) => b.add(u, y0, ww, sx, hh, sz, hex);
      this.win(P0, hall[0], hall[1], hall[2], hall[3], 0.62);
      for (const [wx, wz] of wings) {
        this.rboxes.add(wx, 0, wz, 0.5, 0.55, h - 0.6, S.uniWall);
        this.roofs.add(wx, 0.55, wz, 0.56, 0.18, h - 0.54, sn(S.uniRoof));
        this.win(P0, wx, wz, 0.5, h - 0.6, 0.55);
      }
      this.cylinders.add(cx, 0.62, y + 0.35, 0.44, 0.22, 0.44, S.uniWall);
      this.blobs.add(cx, 0.72, y + 0.35, 0.46, 0.46, 0.46, sn(S.dome));
      for (const [tx, tz] of [[x + 1.05, y + 1.05], [x + w - 1.05, y + 1.05], [x + 1.1, y + h - 0.35], [x + w - 1.1, y + h - 0.35]]) this.tree(tx, tz, 0.28, v + Math.round(tx * 7));
      this.lit = null;
    } else if (k === 'centralpark') {
      const spots = [[12, 14, 7], [30, 10, 6], [14, 36, 6], [26, 60, 7], [12, 80, 6], [36, 84, 7], [60, 80, 6], [84, 82, 7],
        [86, 58, 6], [64, 44, 5], [88, 12, 5], [46, 26, 5], [24, 48, 5], [78, 70, 5]];
      for (const [tx, ty, r] of spots) this.tree(x + tx / 32, y + ty / 32, r * 0.065, v + tx * 3 + ty);
      this.cylinders.add(x + 46 / 32, 0, y + 62 / 32, 0.3, 0.18, 0.3, '#eee5d8');
      this.cones.add(x + 46 / 32, 0.18, y + 62 / 32, 0.38, 0.16, 0.38, sn('#d3a390'));
    } else if (k === 'hospital') {
      this.lit = { seed: v, share: 0.6 };
      const P0 = (b, u, ww, sx, sz, y0, hh, hex) => b.add(u, y0, ww, sx, hh, sz, hex);
      this.rboxes.add(cx, 0, y + 0.72, w - 0.3, 1.1, 1.1, '#ffffff');
      this.win(P0, cx, y + 0.72, w - 0.3, 1.1, 1.1);
      this.rboxes.add(cx - 0.35, 0, y + h - 0.45, 0.9, 0.45, 0.6, '#f4f1ec');
      this.boxes.add(cx, 1.1, y + 0.72, 0.12, 0.02, 0.5, S.cross);
      this.boxes.add(cx, 1.1, y + 0.72, 0.5, 0.02, 0.12, S.cross);
      this.cylinders.add(x + w - 0.45, 0, y + h - 0.45, 0.5, 0.03, 0.5, '#c9d6ec'); // helipad
      this.lit = null;
    } else if (k === 'landfill') {
      for (const [mx, mz, r, c] of [[0.62, 0.7, 0.8, '#b9ab8c'], [1.3, 0.62, 0.62, '#a99b7d'], [0.95, 1.3, 0.72, '#c2b596']]) this.blobs.add(x + mx, -0.15, y + mz, r, 0.5, r, this.snowy(c));
      this.rboxes.add(x + 1.55, 0, y + 1.5, 0.28, 0.14, 0.18, '#e8c86a');
    } else if (k === 'townpark') {
      for (const [tx, ty, r] of [[10, 10, 6], [26, 50, 7], [10, 44, 5], [54, 50, 6], [36, 14, 5]]) this.tree(x + tx / 32, y + ty / 32, r * 0.065, v + tx + ty);
      const sx = x + 1.35, sz = y + 0.5; // swing set over the sandpit
      for (const d of [-0.2, 0.2]) this.cylinders.add(sx + d, 0, sz, 0.025, 0.28, 0.025, '#b8a894');
      this.boxes.add(sx, 0.28, sz, 0.44, 0.02, 0.02, '#b8a894');
      this.boxes.add(x + 0.7, 0.05, y + 0.92, 0.28, 0.03, 0.08, S.bench);
    }
  }

  // Transport hubs, attractions and monuments (the ground texture carries runways, paths, pools).
  tourism3d(k, x, y, w, h, v) {
    const cx = x + w / 2, cz = y + h / 2, sn = (c) => this.snowy(c);
    const P0 = (b, u, ww, sx, sz, y0, hh, hex) => b.add(u, y0, ww, sx, hh, sz, hex);
    const plane = (px, pz, rot, col = '#ffffff') => {
      const c = Math.cos(rot), s2 = Math.sin(rot);
      this.rboxes.add(px, 0.08, pz, 0.12, 0.12, 0.62, col, rot);                  // fuselage
      this.boxes.add(px, 0.12, pz, 0.62, 0.02, 0.14, col, rot);                    // wings
      this.boxes.add(px - s2 * 0.26, 0.14, pz - c * 0.26, 0.24, 0.02, 0.08, col, rot); // tailplane
      this.boxes.add(px - s2 * 0.28, 0.14, pz - c * 0.28, 0.02, 0.16, 0.1, col, rot);  // fin
    };
    switch (k) {
      case 'airport': {
        this.lit = { seed: v, share: 0.6 };
        const tw = w * 0.55;
        this.rboxes.add(x + 0.2 + tw / 2, 0, y + 0.55, tw, 0.42, 0.7, '#eef1f5');
        this.win(P0, x + 0.2 + tw / 2, y + 0.55, tw, 0.7, 0.42);
        this.boxes.add(x + 0.2 + tw / 2, 0.42, y + 0.55, tw + 0.08, 0.05, 0.78, sn('#9fb6d8'));
        for (let n = 0; n < 4; n++) this.boxes.add(x + 0.5 + n * 0.56, 0.2, y + 1.0, 0.1, 0.1, 0.35, '#dfe3ea');
        this.cylinders.add(x + w - 0.7, 0, y + 0.5, 0.16, 1.3, 0.16, '#e8ecf2');     // control tower
        this.cylinders.add(x + w - 0.7, 1.3, y + 0.5, 0.36, 0.2, 0.36, '#8fb0d8');
        this.cones.add(x + w - 0.7, 1.5, y + 0.5, 0.36, 0.1, 0.36, '#e8ecf2');
        plane(x + 0.7, y + 1.45, 0);
        plane(x + 1.8, y + 1.45, 0, '#fbe9dc');
        this.lit = null;
        return true;
      }
      case 'seaport': {
        this.rboxes.add(x + 0.8, 0, y + 0.5, 1.2, 0.4, 0.6, '#e6dccb');
        this.roofs.add(x + 0.8, 0.4, y + 0.5, 1.26, 0.14, 0.66, sn('#c9a88f'));
        const cols = ['#e58f82', '#6fa6e3', '#e3b75a', '#7cc47a', '#b38fd6'];
        for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
          if (!((v >> (r * 4 + c)) & 1) && !(c % 2)) continue;
          const stack = 1 + ((v >> c) & 1);
          for (let z = 0; z < stack; z++) this.boxes.add(x + 0.5 + c * 0.4, z * 0.16, y + 1.3 + r * 0.34, 0.34, 0.15, 0.2, cols[(v + r * 4 + c + z) % cols.length]);
        }
        for (const gx of [x + w - 0.7, x + w - 0.35]) {                                   // cranes
          for (const dz of [-0.2, 0.2]) this.boxes.add(gx, 0, cz + dz, 0.05, 1.1, 0.05, '#e3a35a');
          this.boxes.add(gx, 1.1, cz, 0.06, 0.06, 1.3, '#e3a35a');
          this.boxes.add(gx, 1.0, cz + 0.5, 0.04, 0.3, 0.02, '#6f7782');
        }
        return true;
      }
      case 'museum':
        this.lit = { seed: v, share: 0.4 };
        this.rboxes.add(cx, 0, cz - 0.1, w - 0.4, 0.55, h - 0.8, '#f1e8da');
        this.win(P0, cx, cz - 0.1, w - 0.4, h - 0.8, 0.55);
        for (let n = 0; n < 6; n++) this.cylinders.add(x + 0.35 + n * 0.26, 0, y + h - 0.45, 0.07, 0.55, 0.07, '#fbf7f0'); // colonnade
        this.boxes.add(cx, 0.55, y + h - 0.45, w - 0.4, 0.06, 0.2, '#f1e8da');
        this.roofs.add(cx, 0.55, cz - 0.1, w - 0.3, 0.3, h - 0.7, sn('#c9a88f'));
        this.lit = null;
        return true;
      case 'aquarium':
        this.rboxes.add(cx, 0, y + 0.55, w - 0.4, 0.3, 0.8, '#e8f1f6');
        this.blobs.add(cx, 0.05, y + 0.6, 0.9, 0.8, 0.9, '#9fd0e8');
        this.blobs.add(x + 0.5, 0.02, y + h - 0.35, 0.08, 0.04, 0.16, '#f0a06e');
        return true;
      case 'zoo':
        for (const [tx, ty, r] of [[60, 14, 6], [84, 50, 6], [14, 60, 7], [30, 84, 6], [70, 84, 5], [48, 44, 5]]) this.tree(x + tx / 32, y + ty / 32, r * 0.065, v + tx + ty);
        for (const [ax2, az, hh, col] of [[0.55, 0.55, 0.45, '#e3c06a'], [0.9, 0.8, 0.2, '#c9a06a']]) {        // a giraffe and a lion
          this.boxes.add(x + ax2, hh * 0.4, y + az, 0.18, 0.1, 0.08, col);
          if (hh > 0.3) this.boxes.add(x + ax2 + 0.07, hh * 0.5, y + az, 0.03, 0.3, 0.03, col);
        }
        this.rboxes.add(x + w - 0.95, 0, y + 0.55, 0.45, 0.3, 0.32, '#9a8f82');                         // elephant house
        for (const dx of [0, 0.12]) this.blobs.add(x + w - 0.8 + dx, 0, y + h - 0.7, 0.06, 0.1, 0.06, '#3f4652'); // penguins
        return true;
      case 'amusement': {
        const wx = x + w * 0.3, wz = y + h * 0.32;                                        // ferris wheel, standing up
        for (const dx of [-0.25, 0.25]) this.boxes.add(wx + dx, 0, wz, 0.05, 0.75, 0.05, '#c9ced6');
        for (let n = 0; n < 10; n++) {
          const a = n * Math.PI / 5;
          this.rboxes.add(wx + Math.cos(a) * 0.6, 0.75 + Math.sin(a) * 0.6, wz, 0.14, 0.12, 0.14, ['#6fa6e3', '#e3b75a', '#7cc47a', '#e58f82', '#e38fb0'][n % 5]);
          this.boxes.add(wx + Math.cos(a) * 0.3, 0.75 + Math.sin(a) * 0.3, wz, 0.6, 0.02, 0.02, sn('#e38fb0'), 0);
        }
        this.cylinders.add(wx, 0.72, wz, 0.08, 0.08, 0.3, '#e38fb0');
        for (let n = 0; n < 12; n++) {                                                    // roller coaster track on stilts
          const a = n / 12 * Math.PI * 2, px = x + w * 0.72 + Math.cos(a) * 0.9, pz = y + h * 0.35 + Math.sin(a) * 0.9, hh = 0.3 + (Math.sin(a * 2) + 1) * 0.35;
          this.boxes.add(px, 0, pz, 0.03, hh, 0.03, '#c9ced6');
          this.boxes.add(px, hh, pz, 0.12, 0.04, 0.12, '#b38fd6');
        }
        this.cylinders.add(x + w * 0.3, 0, y + h * 0.78, 0.9, 0.25, 0.9, '#f3c6d6');       // carousel
        this.cones.add(x + w * 0.3, 0.25, y + h * 0.78, 1.0, 0.35, 1.0, sn('#e38fb0'));
        this.rboxes.add(x + w * 0.72, 0, y + h * 0.8, 1.0, 0.3, 0.6, '#fbe9dc');
        return true;
      }
      case 'opera':
        for (const [fx, sz, hh] of [[0.25, 0.7, 0.55], [0.5, 0.9, 0.75], [0.75, 0.7, 0.55]]) {
          this.blobs.add(x + w * fx, 0, cz, sz, hh * 1.4, sz * 0.8, sn('#fbfaf6'));
        }
        this.boxes.add(cx, 0, cz + 0.5, w - 0.5, 0.12, 0.3, '#e6dcc6');
        return true;
      case 'arch':
        for (const dx of [-0.55, 0.55]) this.rboxes.add(cx + dx, 0, cz, 0.5, 1.1, 0.7, '#e6dcc6');
        this.rboxes.add(cx, 1.1, cz, 1.7, 0.45, 0.72, '#e6dcc6');
        this.boxes.add(cx, 1.3, cz, 1.72, 0.06, 0.74, '#c9a86a');
        this.boxes.add(cx, 1.55, cz, 0.5, 0.2, 0.3, '#b08a4e');                          // quadriga on top
        return true;
      case 'cathedral':
        this.lit = { seed: v, share: 0.5 };
        this.rboxes.add(cx, 0, cz + 0.1, 0.9, 0.9, h - 0.8, '#ede4d4');                   // nave
        this.roofs.add(cx, 0.9, cz + 0.1, 0.95, 0.45, h - 0.75, sn('#a897c9'));
        this.rboxes.add(cx, 0, cz, w - 0.8, 0.85, 0.7, '#ede4d4');                        // transept
        this.roofs.add(cx, 0.85, cz, w - 0.75, 0.4, 0.75, sn('#a897c9'));
        for (const dx of [-0.35, 0.35]) {                                                 // west towers with spires
          this.rboxes.add(cx + dx, 0, y + h - 0.45, 0.4, 1.7, 0.4, '#e2d8c4');
          this.cones.add(cx + dx, 1.7, y + h - 0.45, 0.42, 0.7, 0.42, sn('#a897c9'));
        }
        this.cylinders.add(cx, 0.85, cz, 0.6, 0.3, 0.6, '#e2d8c4');
        this.blobs.add(cx, 0.9, cz, 0.62, 0.7, 0.62, sn('#bfb2d8'));
        this.lit = null;
        return true;
      case 'skytower':
        this.cylinders.add(cx, 0, cz, 0.35, 0.3, 0.35, '#e8ecf2');
        this.cylinders.add(cx, 0, cz, 0.16, 3.2, 0.16, '#e8ecf2');
        this.cylinders.add(cx, 2.5, cz, 0.8, 0.35, 0.8, '#7fb0d8');                       // observation deck
        this.blobs.add(cx, 2.35, cz, 0.7, 0.3, 0.7, '#e8ecf2');
        this.cylinders.add(cx, 3.2, cz, 0.04, 0.8, 0.04, '#c9ced6');                      // antenna
        this.heads.add(cx, 4.0, cz, 0.08, 0.08, 0.08, '#e87a6e');
        return true;
      case 'pyramid':
        this.roofs.add(cx, 0, cz, w * 0.72, 1.8, h * 0.72, sn('#9fd0e2'));
        this.roofs.add(cx, 0, cz, w * 0.74, 0.02, h * 0.74, '#ffffff');
        return true;
      default:
        return false;
    }
  }

  service(P, k, v, x, y) {
    const S = COL.svc;
    switch (k) {
      case 'coal':
        P(this.rboxes, -0.2, 0.18, 0.5, 0.4, 0, 0.45, S.coal);
        P(this.towers, 0.18, -0.15, 0.5, 0.5, 0, 0.95, S.coalTower);
        P(this.cylinders, -0.3, -0.25, 0.1, 0.1, 0, 1.3, '#cdc6bf');
        P(this.blobs, 0.2, -0.18, 0.4, 0.4, 0.95, 0.3, S.steam);
        break;
      case 'wind':
        for (const [u, w, ph] of [[-0.2, -0.2, 0], [0.22, 0.2, 1.3]]) {
          P(this.cylinders, u, w, 0.05, 0.05, 0, 1.1, S.wind);
          P(this.rboxes, u, w, 0.1, 0.14, 1.1, 0.08, S.wind);
          this.turbines.push({ x: x + 0.5 + u, y: 1.14, z: y + 0.5 + w, ph: ph + v });
        }
        break;
      case 'pump':
        P(this.rboxes, -0.18, -0.15, 0.42, 0.4, 0, 0.32, S.pump);
        P(this.cylinders, 0.2, 0.18, 0.4, 0.4, 0, 0.5, S.tank);
        P(this.cylinders, 0.2, 0.18, 0.42, 0.42, 0.5, 0.04, '#bcd3e3');
        P(this.boxes, 0.02, 0.05, 0.3, 0.06, 0.12, 0.06, '#b4c3cf');
        break;
      case 'school':
        P(this.rboxes, 0, -0.28, 0.86, 0.3, 0, 0.5, S.school);
        P(this.rboxes, -0.28, 0.08, 0.3, 0.46, 0, 0.5, S.school);
        P(this.boxes, 0, -0.28, 0.88, 0.32, 0.5, 0.05, S.schoolRoof);
        P(this.boxes, -0.28, 0.08, 0.32, 0.48, 0.5, 0.05, S.schoolRoof);
        P(this.cylinders, 0.34, 0.3, 0.025, 0.025, 0, 0.8, '#b8c0ca');
        P(this.boxes, 0.4, 0.3, 0.14, 0.01, 0.62, 0.1, S.flag);
        break;
      case 'clinic':
        P(this.rboxes, 0, 0, 0.78, 0.7, 0, 0.62, S.clinic);
        P(this.boxes, 0, 0, 0.1, 0.4, 0.62, 0.03, S.cross);
        P(this.boxes, 0, 0, 0.4, 0.1, 0.62, 0.03, S.cross);
        P(this.boxes, 0, 0.36, 0.36, 0.03, 0.18, 0.18, S.cross);
        break;
      case 'plaza':
        P(this.cylinders, 0, 0, 0.5, 0.5, 0, 0.07, '#e9e1d2');
        P(this.cylinders, 0, 0, 0.42, 0.42, 0.02, 0.06, S.fountain);
        P(this.cylinders, 0, 0, 0.06, 0.06, 0, 0.26, '#e9e1d2');
        P(this.blobs, 0, 0, 0.12, 0.12, 0.24, 0.1, S.fountain);
        for (const [u, w] of [[-0.36, -0.36], [0.36, 0.36], [0.36, -0.36], [-0.36, 0.36]]) {
          P(this.cylinders, u, w, 0.04, 0.04, 0, 0.12, COL.trunk);
          P(this.blobs, u, w, 0.2, 0.2, 0.08, 0.22, COL.leaves[(v + Math.round(u * 5)) % 3]);
        }
        break;
      case 'parking': {
        // Parked cars on the painted stalls (same slots as the 2D lot).
        const cars = ['#e9a59c', '#ffffff', '#a6c4e2', '#eed7a0', '#9098a3', '#b4d8c3', '#d3c1e0'];
        for (let s = 0; s < 8; s++) {
          if (!((v >> s) & 1) && s % 3) continue;
          const col = s % 4, row = s >> 2;
          P(this.rboxes, (7.4 + col * 6) / 32 - 0.5, row ? 0.284 : -0.278, 0.12, 0.19, 0, 0.08, cars[(v + s) % cars.length]);
        }
        break;
      }
      case 'bus':
        P(this.rboxes, 0, 0.12, 0.62, 0.22, 0.26, 0.04, S.bus);          // shelter roof
        for (const u of [-0.27, 0.27]) P(this.cylinders, u, 0.18, 0.03, 0.03, 0, 0.26, '#b8c0ca');
        P(this.boxes, 0, 0.05, 0.6, 0.02, 0, 0.24, '#e8f1f8');             // glass back panel
        P(this.boxes, 0, 0.14, 0.4, 0.08, 0.06, 0.03, '#c9a57a');          // bench
        P(this.cylinders, 0.38, 0.3, 0.025, 0.025, 0, 0.42, '#b8c0ca');    // sign post
        P(this.rboxes, 0.38, 0.3, 0.14, 0.03, 0.36, 0.1, S.busSign);
        break;
      case 'metro':
        P(this.rboxes, 0, -0.05, 0.72, 0.56, 0, 0.3, S.metro);
        P(this.rboxes, 0, -0.05, 0.64, 0.48, 0.3, 0.12, '#eaf2f8');        // glass canopy
        P(this.cylinders, 0.32, 0.32, 0.03, 0.03, 0, 0.5, '#b8c0ca');
        P(this.cylinders, 0.32, 0.32, 0.18, 0.18, 0.5, 0.04, S.metroSign); // "M" roundel
        break;
      case 'police':
        P(this.rboxes, 0, -0.08, 0.8, 0.58, 0, 0.5, S.police);
        P(this.boxes, 0, -0.08, 0.84, 0.62, 0.5, 0.05, S.policeTrim);
        P(this.boxes, -0.06, -0.08, 0.1, 0.08, 0.55, 0.06, '#e4a0a4');
        P(this.boxes, 0.06, -0.08, 0.1, 0.08, 0.55, 0.06, '#9fb6e0');
        P(this.rboxes, -0.2, 0.36, 0.14, 0.24, 0, 0.1, '#ffffff'); // patrol car
        P(this.boxes, -0.2, 0.36, 0.1, 0.05, 0.1, 0.03, S.policeTrim);
        break;
      case 'fire':
        P(this.rboxes, -0.08, -0.05, 0.68, 0.7, 0, 0.5, S.fire);
        P(this.boxes, -0.08, -0.05, 0.72, 0.74, 0.5, 0.05, S.fireTrim);
        for (const u of [-0.24, 0.08]) P(this.boxes, u, 0.305, 0.24, 0.02, 0.02, 0.32, S.door);
        P(this.rboxes, 0.36, -0.28, 0.18, 0.18, 0, 1.0, S.fireTrim); // hose-drying tower
        P(this.rboxes, 0.36, 0.3, 0.14, 0.3, 0, 0.13, S.fireTrim);   // engine
        break;
      case 'railstation':
        P(this.rboxes, 0, -0.12, 0.84, 0.4, 0, 0.45, '#f1e6d8');
        P(this.roofs, 0, -0.12, 0.9, 0.46, 0.45, 0.16, this.snowy('#c98f6a'));
        P(this.boxes, 0, 0.26, 0.9, 0.22, 0, 0.06, '#e4ddd0');
        for (const u of [-0.35, 0, 0.35]) P(this.cylinders, u, 0.3, 0.03, 0.03, 0.06, 0.28, '#9aa3ad');
        P(this.boxes, 0, 0.3, 0.9, 0.2, 0.34, 0.03, '#c98f6a');
        break;
      case 'clocktower':
        P(this.rboxes, 0, 0, 0.44, 0.44, 0, 1.6, '#e6dcc6');
        for (const [u, w] of [[0, 0.225], [0.225, 0], [0, -0.225], [-0.225, 0]]) P(this.boxes, u, w, u ? 0.02 : 0.24, u ? 0.24 : 0.02, 1.12, 0.24, '#ffffff'); // clock faces
        P(this.roofs, 0, 0, 0.5, 0.5, 1.6, 0.45, this.snowy('#b8a07a'));
        break;
      case 'statue':
        P(this.rboxes, 0, 0, 0.36, 0.36, 0, 0.3, '#e4ddd0');
        P(this.cylinders, 0, 0, 0.12, 0.12, 0.3, 0.32, '#a8834a');
        P(this.blobs, 0, 0, 0.12, 0.12, 0.6, 0.12, '#a8834a');
        P(this.boxes, 0.08, 0, 0.18, 0.04, 0.46, 0.04, '#a8834a'); // raised arm
        for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; P(this.blobs, Math.cos(a) * 0.34, Math.sin(a) * 0.34, 0.1, 0.1, 0, 0.08, this.snowy(COL.leaves[k % 3])); }
        break;
      case 'recycling':
        P(this.rboxes, -0.08, -0.12, 0.66, 0.5, 0, 0.42, S.recycling);
        P(this.roofs, -0.08, -0.12, 0.7, 0.54, 0.42, 0.12, '#b3d6aa');
        S.bins.forEach((c, n) => P(this.rboxes, -0.25 + n * 0.22, 0.32, 0.16, 0.16, 0, 0.18, c));
        break;
      default:
        break;
    }
  }

  // Cars and turbine blades: same placement as the 2D view, rebuilt every frame.
  buildCars(map) {
    const cars = this.cars;
    cars.begin();
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      forEachCar(map, x, y, this.time, (along, off, horiz, hex) => {
        if (horiz) cars.add(x + along, 0.02, y + off, 0.2, 0.09, 0.11, hex);
        else cars.add(x + off, 0.02, y + along, 0.11, 0.09, 0.2, hex);
      });
    }
    cars.end();
  }

  // Flickering flames and rising smoke on burning buildings.
  // Signal lamps: north-south and east-west take turns on green.
  buildSignals() {
    const b = this.lamps, nsGreen = Math.floor(this.time / 2.5) % 2 === 0;
    b.begin();
    for (const s of this.signals ?? []) b.add(s.x, 0.34, s.z, 0.05, 0.04, 0.05, s.ns === nsGreen ? '#7fd09a' : '#f08a80');
    b.end();
  }

  // Interchange: an elevated highway deck on two piers over the crossing road.
  interchange(map, x, y) {
    const isHwy = (dx, dy) => map.inBounds(x + dx, y + dy) && map.type[map.idx(x + dx, y + dy)] === TILE.ROAD
      && map.roadClass[map.idx(x + dx, y + dy)] === 2;
    const horiz = isHwy(-1, 0) || isHwy(1, 0) || !(isHwy(0, -1) || isHwy(0, 1));
    const [sx, sz] = horiz ? [1.02, 0.78] : [0.78, 1.02];
    this.rboxes.add(x + 0.5, 0.3, y + 0.5, sx, 0.08, sz, '#c3c8cf');
    this.boxes.add(x + 0.5, 0.38, y + 0.5, horiz ? 1.02 : 0.03, 0.05, horiz ? 0.03 : 1.02, '#eeebe4');
    for (const k of [-0.3, 0.3]) {
      const [px, pz] = horiz ? [x + 0.5, y + 0.5 + k] : [x + 0.5 + k, y + 0.5];
      this.cylinders.add(px, 0, pz, 0.1, 0.3, 0.1, '#d8d4cd');
    }
  }

  buildFires() {
    const f = this.flames, s = this.smoke, t = this.time;
    f.begin(); s.begin();
    for (const b of this.burning ?? []) {
      for (let k = 0; k < 3; k++) {
        const ph = t * 7 + b.v + k * 2.1, u = b.x + 0.3 + k * 0.2, w = b.y + 0.35 + ((b.v >> k) & 1) * 0.3;
        const sz = 0.28 + Math.sin(ph) * 0.05;
        f.add(u, 0.15, w, sz, sz * 1.6, sz, k === 1 ? '#ffc766' : '#f59a62');
      }
      for (let k = 0; k < 3; k++) {
        const rise = ((t * 0.4 + k / 3 + b.v * 0.01) % 1);
        const sz = 0.3 + rise * 0.5;
        s.add(b.x + 0.5 + rise * 0.3, 0.8 + rise * 1.6, b.y + 0.4, sz, sz, sz, '#9c9ca2');
      }
    }
    f.end(); s.end();
  }

  buildBlades() {
    const b = this.blades, p = new THREE.Vector3(), q = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 0, 1), size = new THREE.Vector3(0.42, 0.035, 0.015);
    b.begin();
    for (const t of this.turbines ?? []) {
      const a0 = this.time * 2.2 + t.ph;
      for (let n = 0; n < 3; n++) {
        // A blade is a thin box rotated about the hub, facing +z.
        const a = a0 + n * (Math.PI * 2 / 3);
        b.addTRS(p.set(t.x + Math.cos(a) * 0.2, t.y + Math.sin(a) * 0.2, t.z + 0.08), q.setFromAxisAngle(axis, a), size, '#ffffff');
      }
    }
    b.end();
  }

  // Sun, sky and night lights from the time of day.
  applyLighting(map) {
    const env = this.env, n = env.night, d = env.dusk;
    this.hemi.intensity = 2.1 - n * 1.55;
    this.hemi.color.set(mix(mix('#ffffff', '#ffd9b8', d * 0.7), '#8494d6', n));
    this.hemi.groundColor.set(mix('#c9d6bd', '#39415c', n));
    const s = this.sun, w = map.width, h = map.height, k = Math.max(w, h) / 40;
    // The sun swings from east to west over the day; at night a dim moon takes its place.
    const swing = n > 0.5 ? 0 : Math.max(-1, Math.min(1, (env.hour - 12) / 7));
    const lift = n > 0.5 ? 1 : 0.45 + 0.55 * Math.max(0, env.sun);
    s.position.set(w / 2 - 22 * k + swing * 30 * k, 38 * k * lift, h / 2 + 16 * k - Math.abs(swing) * 6 * k);
    s.intensity = n > 0.5 ? 0.35 * n : 1.7 * (1 - n) + d * 0.2;
    s.color.set(n > 0.5 ? '#9fb2ff' : mix('#fff6ea', '#ffb27a', d * 0.8));
    this.scene.background = color(mix(mix(DAY_BG, DUSK_BG, d * 0.8), NIGHT_BG, n));
    const on = n > 0.05;
    for (const b of [this.windows, this.heads, this.pools]) b.mesh.visible = on && !this.overlay;
    if (on) {
      this.windows.mesh.material.color.setScalar(Math.min(1, n * 1.3));
      this.heads.mesh.material.color.setScalar(Math.min(1, n * 1.3));
      this.pools.mesh.material.opacity = n * 0.55;
    }
    this.poles.mesh.visible = true;
  }

  // ------------------------------------------------------------ frame
  render(state, hover, preview) {
    const map = state.map, c = this.cache, now = performance.now();
    if (c.map !== map) {
      this.fitMap(map);
      c.map = map; c.version = -1; c.tick = -1; c.overlay = undefined;
    }
    this.updateTerrain(map);
    const edited = c.version !== map.version;
    const ticked = c.tick !== state.tick;
    const groundEvery = GROUND_THROTTLE_MS * (map.size > 5000 ? 2.5 : 1);
    this.applyLighting(map);
    if (edited || c.overlay !== this.overlay || (ticked && now - c.groundAt > groundEvery)) {
      this.routesState = state;
      this.paintGround(map, state.districts);
      c.groundAt = now;
      c.overlay = this.overlay;
    }
    if (edited || (ticked && now - c.meshAt > MESH_THROTTLE_MS)) {
      this.buildMeshes(map);
      c.meshAt = now;
      c.tick = state.tick;
    }
    c.version = map.version;
    const faded = this.overlay ? 0.28 : 1;
    for (const b of this.buildingBatches) if (!b.glowing && b.mesh.material.opacity !== faded) b.setOpacity(faded);

    // Cars: every frame on normal maps, ~30 fps on big ones; hidden when zoomed far out.
    if (this.orbit.dist >= 60) { this.cars.begin(); this.cars.end(); }
    else if (map.size <= 5000 || now - (c.carsAt ?? 0) > 33) { this.buildCars(map); c.carsAt = now; }
    this.buildBlades();
    this.buildFires();
    this.buildSignals();
    const tv = this.transitVehicles;
    tv.begin();
    for (const tr of trainPositions(state, this.time)) tv.add(tr.x, 0.03, tr.y, tr.horiz ? 0.85 : 0.2, 0.2, tr.horiz ? 0.2 : 0.85, '#e8e4dc');
    for (const v of vehiclePositions(state, this.time)) {
      const len = v.mode === 'tram' ? 0.5 : 0.32;
      tv.add(v.x, 0.02, v.y, v.horiz ? len : 0.15, 0.16, v.horiz ? 0.15 : len, v.color);
    }
    tv.end();

    if (hover && map.inBounds(hover.x, hover.y)) {
      this.hoverMesh.visible = true;
      this.hoverMesh.position.set(hover.x, 0.03 + (LIFT ? LIFT(hover.x + 0.5, hover.y + 0.5) : 0), hover.y);
    } else this.hoverMesh.visible = false;

    this.preview.begin();
    if (preview) {
      const hex = preview.ok ? '#ffffff' : '#e6463c';
      for (const i of preview.tiles) this.preview.add((i % map.width) + 0.5, 0.04, ((i / map.width) | 0) + 0.5, 1, 1, 1, hex);
    }
    this.preview.end();

    this.updateCamera();
    this.gl.render(this.scene, this.camera);
  }
}
