// 3D view (Three.js). Same interface as the 2D Renderer, reads the same state.
// Ground (terrain, roads, lots, overlays) reuses the 2D tile painter as a texture;
// buildings, trees and cars are instanced low-poly meshes.

import * as THREE from '../vendor/three/three.module.js';
import { RoundedBoxGeometry } from '../vendor/three/RoundedBoxGeometry.js';
import { Renderer, TS, forEachCar } from './renderer.js';
import { TILE, FLAG, KINDS } from './map.js';

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
  cone: new THREE.ConeGeometry(0.5, 1, 14).translate(0, 0.5, 0),
  blob: new THREE.IcosahedronGeometry(0.5, 2).translate(0, 0.5, 0),
};

// Soft pastel palette matching the 2D view.
const COL = {
  resWall: '#fbf1e6', resWall2: '#f3e7f0', resRoof: [null, '#eda386', '#e3957a', '#d98a72'], resRoof2: ['#f0b7a0', '#c9b3dd', '#9fcdb9'],
  comWall: '#eef4fb', comRoof: [null, '#90bbe8', '#7fb0e2', '#73a6dc'], glass: '#a9cdef', glassBand: '#f3f8fd', glass2: '#bfe0dc',
  indWall: '#f6eedc', indRoof: [null, '#e6c682', '#dcbc78', '#d2ae6c'], stack: '#c9c0b7', crate: '#dcb98a', tank: '#e9e4dc',
  band: '#e3d7c8', awnings: ['#f4a39a', '#f6d27a', '#9fd8b4'],
  abandoned: '#d4d0ca', abandonedRoof: '#bdb8b1',
  trunk: '#b39478', leaves: ['#8fc47c', '#83bb70', '#9bcd88'], hedge: '#a3d18c', garden: '#b6dd9f',
  slab: '#dccfbf', bg: '#e6edf2',
  svc: {
    coal: '#cfc6bd', coalTower: '#ebe7e1', steam: '#ffffff', wind: '#ffffff', pump: '#bfe0f4', tank: '#e1f0f9',
    school: '#f8e2a4', schoolRoof: '#ee9f86', clinic: '#ffffff', cross: '#ef7f86', plaza: '#efe6d6', fountain: '#a6d6ee',
    recycling: '#b7deb0', bins: ['#86b8e8', '#f6d27a', '#9fd8b4'], flag: '#ef7f86',
    police: '#dbe5f8', policeTrim: '#7f9ee0', fire: '#f5b3a2', fireTrim: '#e0705c', door: '#fbf6ee',
  },
};
const colorCache = new Map();
function color(hex) {
  let c = colorCache.get(hex);
  if (!c) { c = new THREE.Color(hex); colorCache.set(hex, c); }
  return c;
}

// One InstancedMesh per geometry; filled from scratch whenever the city changes.
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
  add(x, y, z, sx, sy, sz, hex, rotY = 0) {
    if (this.n >= this.capacity) return;
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

    scene.add(new THREE.HemisphereLight('#ffffff', '#c9d6bd', 2.1));
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
    this.smoke = new Batch(scene, GEO.blob, Math.max(64, tiles / 2), { shadows: false });
    this.smoke.setOpacity(0.55);
    this.dynamicBatches = [this.cars, this.blades, this.flames, this.smoke];
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
    return this.raycaster.ray.intersectPlane(this.groundPlane, hit) ? hit : null;
  }

  screenToTile(sx, sy) {
    const p = this.groundPoint(sx, sy);
    return p ? { x: Math.floor(p.x), y: Math.floor(p.z) } : { x: -1, y: -1 };
  }

  tileToScreen(x, y) {
    this.updateCamera();
    const v = new THREE.Vector3(x + 1, 0, y + 1).project(this.camera);
    return { x: (v.x + 1) / 2 * this.viewW, y: (1 - v.y) / 2 * this.viewH };
  }

  // ------------------------------------------------------------ scene building
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
    this.groundTex.dispose();
    this.groundTex.image = this.groundCanvas;
    this.ground.geometry.dispose();
    this.ground.geometry = new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2).translate(w / 2, 0, h / 2);
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

  paintGround(map) {
    const ctx = this.groundCanvas.getContext('2d');
    const p = this.painter;
    p.ctx = ctx;
    p.overlay = this.overlay;
    const scale = this.texPx / TS;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) p.drawGround(map, x, y);
    p.drawGrid(0, 0, map.width - 1, map.height - 1);
    if (this.overlay) p.drawOverlay(map, 0, 0, map.width - 1, map.height - 1);
    this.groundTex.needsUpdate = true;
  }

  buildMeshes(map) {
    for (const b of this.buildingBatches) b.begin();
    this.turbines = [];
    this.burning = [];
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
      } else if ((t === TILE.RES || t === TILE.COM || t === TILE.IND) && map.level[i] > 0) {
        this.building(this.placer(map, x, y), t, map.level[i], v, map.hasFlag(i, FLAG.ABANDONED));
      } else if (t === TILE.SERVICE) {
        this.service(this.placer(map, x, y), KINDS[map.kind[i]], v, x, y);
      }
      if (map.hasFlag(i, FLAG.FIRE)) this.burning.push({ x, y, v });
    }
    for (const b of this.buildingBatches) b.end();
  }

  tree(x, z, size, v) {
    const h = size * (0.9 + (v & 3) * 0.12);
    this.cylinders.add(x, 0, z, 0.06, h * 0.45, 0.06, COL.trunk);
    this.blobs.add(x, h * 0.3, z, size, h, size, COL.leaves[v % 3]);
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
    const roof = (hex) => (ab ? COL.abandonedRoof : hex);
    const alt = (v >> 5) & 1; // two designs per zone and density level
    const bands = (u, w, sx, sz, h, step, hex, from = step) => {
      for (let y0 = from; y0 < h - 0.05; y0 += step) P(this.boxes, u, w, sx + 0.025, sz + 0.025, y0, 0.03, hex);
    };
    if (t === TILE.RES) {
      const r = roof(COL.resRoof[lv]);
      if (lv === 1 && !alt) {        // two gabled cottages
        for (const [u, w] of [[-0.2, -0.18], [0.2, 0.16]]) {
          P(this.rboxes, u, w, 0.3, 0.3, 0, 0.21, wall(COL.resWall));
          P(this.roofs, u, w, 0.36, 0.36, 0.21, 0.17, r);
        }
      } else if (lv === 1) {         // bungalow with a garden hedge
        P(this.rboxes, 0, -0.08, 0.56, 0.38, 0, 0.2, wall(COL.resWall2));
        P(this.roofs, 0, -0.08, 0.66, 0.46, 0.2, 0.13, roof(COL.resRoof2[v % 3]));
        P(this.boxes, 0, 0.36, 0.7, 0.07, 0, 0.1, roof(COL.hedge));
        P(this.blobs, 0.3, 0.2, 0.2, 0.2, 0.02, 0.24, roof(COL.leaves[v % 3]));
      } else if (lv === 2 && !alt) { // apartment slab
        const h = 0.72 + (v & 3) * 0.06;
        P(this.rboxes, 0, -0.03, 0.76, 0.62, 0, h, wall(COL.resWall));
        bands(0, -0.03, 0.76, 0.62, h, 0.24, roof(COL.band));
        P(this.rboxes, 0, -0.03, 0.8, 0.66, h, 0.06, r);
      } else if (lv === 2) {         // row of three townhouses
        for (let n = 0; n < 3; n++) {
          const u = -0.27 + n * 0.27, h = 0.5 + ((v >> n) & 1) * 0.12;
          P(this.rboxes, u, -0.02, 0.25, 0.6, 0, h, wall(n === 1 ? COL.resWall2 : COL.resWall));
          P(this.roofs, u, -0.02, 0.3, 0.66, h, 0.16, roof(COL.resRoof2[(v + n) % 3]));
        }
      } else if (!alt) {             // tower with floor bands and a roof plant
        const h = 1.9 + (v & 3) * 0.2;
        P(this.rboxes, 0, 0, 0.8, 0.8, 0, h, wall(COL.resWall));
        bands(0, 0, 0.8, 0.8, h, 0.3, roof(COL.band));
        P(this.rboxes, 0, 0, 0.84, 0.84, h, 0.07, r);
        P(this.rboxes, 0, 0, 0.26, 0.26, h + 0.07, 0.18, roof('#c9a08c'));
      } else {                       // terraced tower with roof gardens
        const steps = [[0.84, 0.8], [0.66, 0.75], [0.48, 0.7]];
        let y0 = 0;
        steps.forEach(([sz, h], n) => {
          P(this.rboxes, 0, -0.04 * n, sz, sz, y0, h, wall(COL.resWall2));
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
        P(this.rboxes, 0, -0.03, 0.82, 0.7, 0, h, wall('#d4e5f5'));
        bands(0, -0.03, 0.82, 0.7, h, 0.22, roof(COL.glassBand));
        P(this.rboxes, 0, -0.03, 0.85, 0.73, h, 0.05, r);
      } else if (lv === 2) {         // low mall with a glass atrium
        P(this.rboxes, 0, -0.02, 0.88, 0.76, 0, 0.42, wall(COL.comWall));
        P(this.rboxes, 0, -0.02, 0.4, 0.4, 0.42, 0.2, roof(COL.glass2));
        P(this.boxes, 0, 0.37, 0.7, 0.04, 0.3, 0.04, roof(COL.awnings[v % 3]));
      } else if (!alt) {             // glass tower with a crown
        const h = 2.6 + (v & 3) * 0.25;
        P(this.rboxes, 0, 0, 0.78, 0.78, 0, h, wall(COL.glass));
        bands(0, 0, 0.78, 0.78, h, 0.26, wall(COL.glassBand));
        P(this.rboxes, 0, 0, 0.56, 0.56, h, 0.3, r);
        P(this.cylinders, 0, 0, 0.05, 0.05, h + 0.3, 0.45, roof('#eef2f6'));
      } else {                       // round tower with a spire
        const h = 2.4 + (v & 3) * 0.25;
        P(this.cylinders, 0, 0, 0.78, 0.78, 0, h, wall(COL.glass2));
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
        for (let n = 0; n < 4; n++) P(this.boxes, 0, -0.3 + n * 0.18, 0.84, 0.09, 0.5, 0.1, r);
      } else if (lv === 2) {         // tank farm beside a small office
        P(this.rboxes, -0.25, 0.2, 0.36, 0.4, 0, 0.36, wall(COL.indWall));
        for (const [u, w, d] of [[0.2, -0.2, 0.36], [0.2, 0.22, 0.3], [-0.22, -0.25, 0.3]]) {
          P(this.cylinders, u, w, d, d, 0, 0.42, roof(COL.tank));
          P(this.cylinders, u, w, d * 0.9, d * 0.9, 0.42, 0.04, r);
        }
      } else if (!alt) {             // plant with smokestacks
        P(this.rboxes, -0.1, 0.03, 0.7, 0.76, 0, 0.66, wall(COL.indWall));
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

  service(P, k, v, x, y) {
    const S = COL.svc;
    switch (k) {
      case 'coal':
        P(this.rboxes, -0.2, 0.18, 0.5, 0.4, 0, 0.45, S.coal);
        P(this.towers, 0.18, -0.15, 0.5, 0.5, 0, 0.95, S.coalTower);
        P(this.cylinders, -0.3, -0.25, 0.1, 0.1, 0, 1.3, '#bdb3aa');
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
        P(this.cylinders, 0.2, 0.18, 0.42, 0.42, 0.5, 0.04, '#9fc3dc');
        P(this.boxes, 0.02, 0.05, 0.3, 0.06, 0.12, 0.06, '#9fb4c4');
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
        P(this.cylinders, 0, 0, 0.5, 0.5, 0, 0.07, '#e2d6c2');
        P(this.cylinders, 0, 0, 0.42, 0.42, 0.02, 0.06, S.fountain);
        P(this.cylinders, 0, 0, 0.06, 0.06, 0, 0.26, '#e2d6c2');
        P(this.blobs, 0, 0, 0.12, 0.12, 0.24, 0.1, S.fountain);
        for (const [u, w] of [[-0.36, -0.36], [0.36, 0.36], [0.36, -0.36], [-0.36, 0.36]]) {
          P(this.cylinders, u, w, 0.04, 0.04, 0, 0.12, COL.trunk);
          P(this.blobs, u, w, 0.2, 0.2, 0.08, 0.22, COL.leaves[(v + Math.round(u * 5)) % 3]);
        }
        break;
      case 'police':
        P(this.rboxes, 0, -0.08, 0.8, 0.58, 0, 0.5, S.police);
        P(this.boxes, 0, -0.08, 0.84, 0.62, 0.5, 0.05, S.policeTrim);
        P(this.boxes, -0.06, -0.08, 0.1, 0.08, 0.55, 0.06, '#ef7f86');
        P(this.boxes, 0.06, -0.08, 0.1, 0.08, 0.55, 0.06, '#6f9ee8');
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
      case 'recycling':
        P(this.rboxes, -0.08, -0.12, 0.66, 0.5, 0, 0.42, S.recycling);
        P(this.roofs, -0.08, -0.12, 0.7, 0.54, 0.42, 0.12, '#93c98a');
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
    const b = this.blades;
    b.begin();
    for (const t of this.turbines ?? []) {
      const a0 = this.time * 2.2 + t.ph;
      for (let n = 0; n < 3; n++) {
        const a = a0 + n * (Math.PI * 2 / 3);
        // A blade is a thin box rotated about the hub, facing +z.
        b.mesh.setMatrixAt(b.n, new THREE.Matrix4().compose(
          new THREE.Vector3(t.x + Math.cos(a) * 0.2, t.y + Math.sin(a) * 0.2, t.z + 0.08),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a),
          new THREE.Vector3(0.42, 0.035, 0.015)));
        b.mesh.setColorAt(b.n, color('#ffffff'));
        b.n++;
      }
    }
    b.end();
  }

  // ------------------------------------------------------------ frame
  render(state, hover, preview) {
    const map = state.map, c = this.cache, now = performance.now();
    if (c.map !== map) {
      this.fitMap(map);
      c.map = map; c.version = -1; c.tick = -1; c.overlay = undefined;
    }
    const edited = c.version !== map.version;
    const ticked = c.tick !== state.tick;
    const groundEvery = GROUND_THROTTLE_MS * (map.size > 5000 ? 2.5 : 1);
    if (edited || c.overlay !== this.overlay || (ticked && now - c.groundAt > groundEvery)) {
      this.paintGround(map);
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
    for (const b of this.buildingBatches) if (b.mesh.material.opacity !== faded) b.setOpacity(faded);

    // Cars: every frame on normal maps, ~30 fps on big ones; hidden when zoomed far out.
    if (this.orbit.dist >= 60) { this.cars.begin(); this.cars.end(); }
    else if (map.size <= 5000 || now - (c.carsAt ?? 0) > 33) { this.buildCars(map); c.carsAt = now; }
    this.buildBlades();
    this.buildFires();

    if (hover && map.inBounds(hover.x, hover.y)) {
      this.hoverMesh.visible = true;
      this.hoverMesh.position.set(hover.x, 0.03, hover.y);
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
