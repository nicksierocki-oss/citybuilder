// 3D view (Three.js). Same interface as the 2D Renderer, reads the same state.
// Ground (terrain, roads, lots, overlays) reuses the 2D tile painter as a texture;
// buildings, trees and cars are instanced low-poly meshes.

import * as THREE from '../vendor/three/three.module.js';
import { Renderer, TS, forEachCar } from './renderer.js';
import { TILE, FLAG } from './map.js';

// Ground texture pixels per tile: full 2D detail on small maps, capped near 2k px for big ones.
const texPx = (size) => Math.max(16, Math.min(TS, Math.floor(2048 / size)));
const GROUND_THROTTLE_MS = 200; // max ground-texture redraw rate while the sim runs
const MESH_THROTTLE_MS = 120;

// Geometries with their origin at the base centre, so scale.y = height.
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  pyramid: new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 10).translate(0, 0.5, 0),
  blob: new THREE.IcosahedronGeometry(0.5, 1).translate(0, 0.5, 0),
};

const COL = {
  resWall: '#f3e3cf', resRoof: [null, '#e0795a', '#d86f52', '#b8563e'],
  comWall: '#dce8f4', comRoof: [null, '#5b9bdb', '#3f7fc4', '#2f6db5'], glass: '#6d9fd4', glassBand: '#dbe9f7',
  indWall: '#e3d3a8', indRoof: [null, '#c9a04a', '#b08a3c', '#94712f'], stack: '#6d6259', crate: '#b98a3b',
  band: '#00000022', awnings: ['#e8665a', '#f2b84b', '#6cc19c'],
  abandoned: '#9b9893', abandonedRoof: '#7c7975',
  trunk: '#7a5a3a', leaves: ['#4f8f45', '#5c9d4e', '#467f3d'],
  slab: '#4a3f35', bg: '#1d2430',
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

    scene.add(new THREE.HemisphereLight('#e4f0ff', '#51603f', 1.6));
    const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
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
    if (this.cars) this.scene.remove(this.cars.mesh);
    const scene = this.scene;
    this.boxes = new Batch(scene, GEO.box, tiles * 7);
    this.roofs = new Batch(scene, GEO.pyramid, tiles * 2);
    this.cylinders = new Batch(scene, GEO.cylinder, tiles * 3);
    this.blobs = new Batch(scene, GEO.blob, tiles * 3);
    this.cars = new Batch(scene, GEO.box, tiles * 3, { shadows: false });
    this.buildingBatches = [this.boxes, this.roofs, this.cylinders, this.blobs];
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
        this.building(x, y, t, map.level[i], v, map.hasFlag(i, FLAG.ABANDONED));
      }
    }
    for (const b of this.buildingBatches) b.end();
  }

  tree(x, z, size, v) {
    const h = size * (0.9 + (v & 3) * 0.12);
    this.cylinders.add(x, 0, z, 0.06, h * 0.45, 0.06, COL.trunk);
    this.blobs.add(x, h * 0.3, z, size, h, size, COL.leaves[v % 3]);
  }

  // Box helper in tile-local coordinates: (u, w) = footprint centre in 0..1, sizes in tile units.
  bx(x, y, u, w, sx, sz, y0, h, hex, rot = 0) { this.boxes.add(x + u, y0, y + w, sx, h, sz, hex, rot); }

  floors(x, y, u, w, sx, sz, h, step, hex) {
    for (let k = step; k < h - 0.05; k += step) this.bx(x, y, u, w, sx + 0.02, sz + 0.02, k, 0.035, hex);
  }

  building(x, y, t, lv, v, ab) {
    const A = ab;
    const wall = (hex) => (A ? COL.abandoned : hex);
    const roof = (hex) => (A ? COL.abandonedRoof : hex);
    if (t === TILE.RES) {
      const r = COL.resRoof[lv];
      if (lv === 1) {
        const houses = (v & 1) ? [[10, 10], [23, 22]] : [[23, 10], [10, 22]];
        for (const [hx, hz] of houses) {
          const rot = (v & 2) ? 0 : Math.PI / 2;
          this.bx(x, y, hx / 32, hz / 32, 0.3, 0.3, 0, 0.2, wall(COL.resWall));
          this.roofs.add(x + hx / 32, 0.2, y + hz / 32, 0.36, 0.16, 0.36, roof(r), rot);
        }
      } else if (lv === 2) {
        const h = 0.7 + (v & 3) * 0.06;
        this.bx(x, y, 0.5, 0.47, 0.76, 0.62, 0, h, wall(COL.resWall));
        this.floors(x, y, 0.5, 0.47, 0.76, 0.62, h, 0.24, roof('#c9b49c'));
        this.bx(x, y, 0.5, 0.47, 0.8, 0.66, h, 0.06, roof(r));
      } else {
        const h = 1.9 + (v & 3) * 0.2;
        this.bx(x, y, 0.5, 0.5, 0.8, 0.8, 0, h, wall(COL.resWall));
        this.floors(x, y, 0.5, 0.5, 0.8, 0.8, h, 0.3, roof('#c4a98f'));
        this.bx(x, y, 0.5, 0.5, 0.84, 0.84, h, 0.07, roof(r));
        this.bx(x, y, 0.5, 0.5, 0.26, 0.26, h + 0.07, 0.18, roof('#7a3b2c'));
      }
    } else if (t === TILE.COM) {
      const r = COL.comRoof[lv];
      if (lv === 1) {
        this.bx(x, y, 0.5, 0.45, 0.7, 0.46, 0, 0.34, wall(COL.comWall));
        this.bx(x, y, 0.5, 0.45, 0.72, 0.48, 0.34, 0.04, roof(r));
        this.bx(x, y, 0.5, 0.72, 0.72, 0.1, 0.22, 0.04, A ? COL.abandonedRoof : COL.awnings[v % 3]);
      } else if (lv === 2) {
        const h = 1.0 + (v & 3) * 0.08;
        this.bx(x, y, 0.5, 0.47, 0.82, 0.7, 0, h, wall('#bcd3ea'));
        this.floors(x, y, 0.5, 0.47, 0.82, 0.7, h, 0.22, roof('#8fb3d6'));
        this.bx(x, y, 0.5, 0.47, 0.84, 0.72, h, 0.05, roof(r));
      } else {
        const h = 2.6 + (v & 3) * 0.25;
        this.bx(x, y, 0.5, 0.5, 0.78, 0.78, 0, h, wall(COL.glass));
        this.floors(x, y, 0.5, 0.5, 0.78, 0.78, h, 0.26, wall(COL.glassBand));
        this.bx(x, y, 0.5, 0.5, 0.56, 0.56, h, 0.3, roof(r));
        this.bx(x, y, 0.5, 0.5, 0.06, 0.06, h + 0.3, 0.45, roof('#dfe7ef'));
      }
    } else {
      const r = COL.indRoof[lv];
      if (lv === 1) {
        this.bx(x, y, 0.38, 0.47, 0.5, 0.56, 0, 0.36, wall(COL.indWall));
        this.bx(x, y, 0.38, 0.47, 0.52, 0.58, 0.36, 0.04, roof(r));
        this.bx(x, y, 0.78, 0.62, 0.16, 0.16, 0, 0.14, roof(COL.crate));
        this.bx(x, y, 0.8, 0.8, 0.14, 0.14, 0, 0.12, roof(COL.crate));
      } else if (lv === 2) {
        this.bx(x, y, 0.5, 0.47, 0.84, 0.7, 0, 0.5, wall(COL.indWall));
        for (let k = 0; k < 4; k++) this.bx(x, y, 0.5, 0.2 + k * 0.18, 0.84, 0.09, 0.5, 0.1, roof(r));
      } else {
        this.bx(x, y, 0.4, 0.53, 0.7, 0.76, 0, 0.66, wall(COL.indWall));
        for (let k = 0; k < 4; k++) this.bx(x, y, 0.4, 0.24 + k * 0.19, 0.7, 0.09, 0.66, 0.12, roof(r));
        this.cylinders.add(x + 0.86, 0, y + 0.2, 0.15, 1.5, 0.15, roof(COL.stack));
        this.cylinders.add(x + 0.86, 0, y + 0.5, 0.12, 1.15, 0.12, roof(COL.stack));
      }
    }
  }

  // Cars: same placement as the 2D view, one small box each.
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
