// Rendering: draws the map with soft flat shapes on a 2D canvas. Reads state, never mutates it.

import { TILE, TERRAIN, FLAG, KINDS } from './map.js';
import { roadTime } from './traffic.js';
import { drawOverlay as paintOverlay, roundRect } from './overlays.js';

export const TS = 32; // tile size in world units

// Light, soft palette.
export const PAL = {
  bg: '#e9eff3',
  grass: ['#e2f0d3', '#deedcd', '#e5f2d8', '#dbebc9'],
  water: '#a6d6ee', waterLight: '#c9e8f7',
  tree: ['#a9d39a', '#9ecc8e', '#b3daa5'], treeShadow: 'rgba(70,100,70,0.12)',
  asphalt: ['#b3b9c1', '#a8aeb7', '#9ea5ae'], laneMark: '#fbf0cc', laneWhite: 'rgba(255,255,255,0.85)',
  median: '#c6e1b6', barrier: '#eeebe4', bridgeRail: '#cfbba5',
  park: '#c9e6b8', parkPath: '#f5efdc',
  lot: { 2: '#ecf3e6', 3: '#e8eef5', 4: '#f5f1e6' },
  lotEdge: { 2: '#bad6ac', 3: '#b2c8df', 4: '#dccaa2' },
  wall: { 2: '#faf4ec', 3: '#f1f5f9', 4: '#f6f1e6' },
  // roofs per zone per level (1..3): light -> deeper = small -> large
  roof: {
    2: [null, '#efcdbe', '#e6bba8', '#d9aa97'],
    3: [null, '#c6d9ec', '#b1cae3', '#9fbad8'],
    4: [null, '#ede0bd', '#e2d2aa', '#d3c197'],
  },
  cars: ['#e9a59c', '#ffffff', '#a6c4e2', '#eed7a0', '#9098a3', '#b4d8c3', '#d3c1e0'],
  abandoned: '#d2cfca', abandonedDark: '#b3b0ab',
  shadow: 'rgba(70,80,100,0.12)',
  svc: {
    coal: '#ccc5be', coalTower: '#e2ded9', wind: '#ffffff', pump: '#bcd9ea', pumpTank: '#e0eef6',
    school: '#efdfb4', schoolRoof: '#e2b6a4', yard: '#d4e8c4', clinic: '#ffffff', cross: '#e4a0a4',
    plaza: '#f0eadf', fountain: '#b5dcee', recycling: '#c1ddba', bins: ['#aac6e2', '#ecd9a6', '#b8dac6'],
    police: '#cdd7ee', policeRoof: '#a3b5da', fire: '#edc2b6', fireRoof: '#d9998b', door: '#fbf7f0',
    bus: '#efcf9f', busSign: '#e3a35a', metro: '#d9cbe9', metroSign: '#a98bd0',
  },
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.dpr = 1;
    this.overlay = null; // 'landValue' | 'pollution' | 'traffic' | null
    this.time = 0;       // animation clock in seconds (advanced only while the sim runs)
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.viewW = r.width;
    this.viewH = r.height;
  }

  centerOn(map, tx, ty) {
    this.cam.x = tx * TS - this.viewW / (2 * this.cam.zoom);
    this.cam.y = ty * TS - this.viewH / (2 * this.cam.zoom);
    this.clampCamera(map);
  }

  clampCamera(map) {
    const z = this.cam.zoom, mw = map.width * TS, mh = map.height * TS;
    const vw = this.viewW / z, vh = this.viewH / z;
    const margin = 4 * TS;
    this.cam.x = vw > mw + 2 * margin ? (mw - vw) / 2 : Math.max(-margin, Math.min(mw + margin - vw, this.cam.x));
    this.cam.y = vh > mh + 2 * margin ? (mh - vh) / 2 : Math.max(-margin, Math.min(mh + margin - vh, this.cam.y));
  }

  // Drag the map by a screen-space offset (content follows the pointer).
  panBy(map, dx, dy) {
    this.cam.x -= dx / this.cam.zoom;
    this.cam.y -= dy / this.cam.zoom;
    this.clampCamera(map);
  }

  // Screen position of a tile's bottom-right corner (for tooltips).
  tileToScreen(x, y) {
    return { x: ((x + 1) * TS - this.cam.x) * this.cam.zoom, y: ((y + 1) * TS - this.cam.y) * this.cam.zoom };
  }

  viewCenterTile() {
    return this.screenToTile(this.viewW / 2, this.viewH / 2);
  }

  screenToTile(sx, sy) {
    const wx = sx / this.cam.zoom + this.cam.x, wy = sy / this.cam.zoom + this.cam.y;
    return { x: Math.floor(wx / TS), y: Math.floor(wy / TS) };
  }

  zoomAt(map, sx, sy, factor) {
    const before = { x: sx / this.cam.zoom + this.cam.x, y: sy / this.cam.zoom + this.cam.y };
    this.cam.zoom = Math.max(0.45, Math.min(3, this.cam.zoom * factor));
    this.cam.x = before.x - sx / this.cam.zoom;
    this.cam.y = before.y - sy / this.cam.zoom;
    this.clampCamera(map);
  }

  // preview: { tiles: Set<index>, ok: boolean } ; hover: {x,y} | null
  render(state, hover, preview) {
    const { ctx, cam, dpr } = this;
    const map = state.map;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    const z = cam.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);

    const x0 = Math.max(0, Math.floor(cam.x / TS)), y0 = Math.max(0, Math.floor(cam.y / TS));
    const x1 = Math.min(map.width - 1, Math.floor((cam.x + this.viewW / cam.zoom) / TS));
    const y1 = Math.min(map.height - 1, Math.floor((cam.y + this.viewH / cam.zoom) / TS));

    // The map sits on the page like a soft card.
    ctx.save();
    ctx.shadowColor = 'rgba(60,80,100,0.18)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = PAL.grass[0];
    roundRect(ctx, 0, 0, map.width * TS, map.height * TS, 18);
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, 0, 0, map.width * TS, map.height * TS, 18);
    ctx.clip();

    // Pass 1: ground (terrain, roads, lots). Pass 2: buildings & trees (they cast shadows onto neighbours).
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.drawGround(map, x, y);
    if (cam.zoom >= 0.7) this.drawGrid(x0, y0, x1, y1);
    if (cam.zoom >= 0.55) this.drawCars(map, x0, y0, x1, y1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.drawObjects(map, x, y);

    if (this.overlay) this.drawOverlay(map, x0, y0, x1, y1);

    if (preview && preview.tiles.size) {
      ctx.fillStyle = preview.ok ? 'rgba(255,255,255,0.5)' : 'rgba(232,110,100,0.45)';
      for (const i of preview.tiles) {
        const px = (i % map.width) * TS, py = ((i / map.width) | 0) * TS;
        roundRect(ctx, px + 1.5, py + 1.5, TS - 3, TS - 3, 6);
        ctx.fill();
      }
    }
    if (hover && map.inBounds(hover.x, hover.y)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2.5 / cam.zoom;
      roundRect(ctx, hover.x * TS + 1.5, hover.y * TS + 1.5, TS - 3, TS - 3, 7);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawOverlay(map, x0, y0, x1, y1) {
    paintOverlay(this.ctx, map, this.overlay, TS, x0, y0, x1, y1);
  }

  drawGround(map, x, y) {
    const ctx = this.ctx, i = map.idx(x, y), px = x * TS, py = y * TS;
    const t = map.type[i], v = map.variant[i];
    if (map.terrain[i] === TERRAIN.WATER) {
      ctx.fillStyle = PAL.water;
      ctx.fillRect(px, py, TS + 0.5, TS + 0.5);
      ctx.strokeStyle = PAL.waterLight;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      const o = (v % 3) * 5;
      ctx.beginPath();
      ctx.moveTo(px + 5 + o, py + 9 + (v % 5)); ctx.quadraticCurveTo(px + 9 + o, py + 6 + (v % 5), px + 13 + o, py + 9 + (v % 5));
      ctx.moveTo(px + 14 - o / 2, py + 22 - (v % 4)); ctx.quadraticCurveTo(px + 18 - o / 2, py + 19 - (v % 4), px + 22 - o / 2, py + 22 - (v % 4));
      ctx.stroke();
    } else {
      ctx.fillStyle = PAL.grass[v & 3];
      ctx.fillRect(px, py, TS + 0.5, TS + 0.5); // overlap hides anti-aliasing seams
    }
    if (t === TILE.ROAD) this.drawRoad(map, x, y, map.terrain[i] === TERRAIN.WATER);
    else if (t === TILE.PARK) this.drawPark(px, py, v);
    else if (t === TILE.SERVICE) this.drawServicePad(map, i, px, py);
    else if (t === TILE.RES || t === TILE.COM || t === TILE.IND) {
      const ab = map.hasFlag(i, FLAG.ABANDONED);
      ctx.fillStyle = ab ? '#e2dfda' : PAL.lot[t];
      roundRect(ctx, px + 1.5, py + 1.5, TS - 3, TS - 3, 6);
      ctx.fill();
      if (map.level[i] === 0) {
        // vacant lot: dashed outline in zone colour (grey if it has no road access)
        const access = map.hasRoadAccess(i);
        ctx.strokeStyle = access ? PAL.lotEdge[t] : '#c3beb6';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        roundRect(ctx, px + 4, py + 4, TS - 8, TS - 8, 5);
        ctx.stroke();
        ctx.setLineDash([]);
        if (!access) {
          ctx.fillStyle = 'rgba(150,140,130,0.45)';
          roundRect(ctx, px + 11, py + 15, 10, 2.5, 1.2);
          ctx.fill();
        }
      }
    }
  }

  drawGrid(x0, y0, x1, y1) {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(90,120,70,0.06)';
    ctx.lineWidth = 1 / this.cam.zoom;
    ctx.beginPath();
    for (let x = x0; x <= x1 + 1; x++) { ctx.moveTo(x * TS, y0 * TS); ctx.lineTo(x * TS, (y1 + 1) * TS); }
    for (let y = y0; y <= y1 + 1; y++) { ctx.moveTo(x0 * TS, y * TS); ctx.lineTo((x1 + 1) * TS, y * TS); }
    ctx.stroke();
  }

  drawRoad(map, x, y, bridge) {
    const ctx = this.ctx, px = x * TS, py = y * TS;
    const isRoad = (dx, dy) => {
      const nx = x + dx, ny = y + dy;
      if (!map.inBounds(nx, ny)) return false;
      return map.type[map.idx(nx, ny)] === TILE.ROAD;
    };
    const n = isRoad(0, -1), s = isRoad(0, 1), w = isRoad(-1, 0), e = isRoad(1, 0);
    // Edge roads continue off-map (to the region) when they run straight into the edge.
    const cn = n || (y === 0 && (s || (!w && !e)));
    const cs = s || (y === map.height - 1 && (n || (!w && !e)));
    const cw = w || (x === 0 && (e || (!n && !s)));
    const ce = e || (x === map.width - 1 && (w || (!n && !s)));
    const cls = map.roadClass[map.idx(x, y)];
    const avenue = cls === 1, highway = cls === 2;
    const hw = cls > 0 ? 14.5 : 10.5; // half width of carriageway
    const c = TS / 2;
    const links = cn + cs + cw + ce;
    const horiz = (cw || ce) && !cn && !cs, vert = (cn || cs) && !cw && !ce;
    ctx.fillStyle = PAL.asphalt[cls];
    // Corners and dead ends get a round hub so turns and ends are smooth.
    if (links <= 1 || (!horiz && !vert && links === 2)) {
      ctx.beginPath(); ctx.arc(px + c, py + c, hw, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillRect(px + c - hw, py + c - hw, hw * 2, hw * 2);
    }
    // Arms taper to meet a neighbour of a different width halfway, so street/avenue/highway
    // joins blend instead of stepping.
    const HW = [10.5, 14.5, 14.5];
    const edgeHw = (dx, dy) => (isRoad(dx, dy) ? (hw + HW[map.roadClass[map.idx(x + dx, y + dy)]]) / 2 : hw);
    const arm = (dx, dy) => {
      const e = edgeHw(dx, dy);
      ctx.beginPath();
      if (dx) { // horizontal arm from the centre to the west/east edge
        const ex = px + c + dx * c;
        ctx.moveTo(px + c, py + c - hw); ctx.lineTo(ex, py + c - e); ctx.lineTo(ex, py + c + e); ctx.lineTo(px + c, py + c + hw);
      } else {
        const ey = py + c + dy * c;
        ctx.moveTo(px + c - hw, py + c); ctx.lineTo(px + c - e, ey); ctx.lineTo(px + c + e, ey); ctx.lineTo(px + c + hw, py + c);
      }
      ctx.closePath(); ctx.fill();
    };
    if (cn) arm(0, -1);
    if (cs) arm(0, 1);
    if (cw) arm(-1, 0);
    if (ce) arm(1, 0);
    const i = map.idx(x, y);
    if (map.hasFlag(i, FLAG.INTERCHANGE)) this.drawInterchange(map, x, y, px, py);
    if (map.hasFlag(i, FLAG.LIGHTS) && links >= 3) this.drawLights(px, py, hw);
    if (bridge) {
      ctx.fillStyle = PAL.bridgeRail;
      if (cw || ce) { ctx.fillRect(px, py + c - hw - 2, TS, 2); ctx.fillRect(px, py + c + hw, TS, 2); }
      if (cn || cs) { ctx.fillRect(px + c - hw - 2, py, 2, TS); ctx.fillRect(px + c + hw, py, 2, TS); }
    }
    // lane markings (skip at intersections and corners)
    if (!horiz && !vert) return;
    const along = (fn) => { for (let k = 2; k < TS; k += 10) fn(k); };
    const dash = (x0, y0, w0, h0) => { roundRect(ctx, x0, y0, w0, h0, Math.min(w0, h0) / 2); ctx.fill(); };
    if (highway) {
      ctx.fillStyle = PAL.barrier;
      if (horiz) ctx.fillRect(px, py + c - 1.2, TS, 2.4); else ctx.fillRect(px + c - 1.2, py, 2.4, TS);
      ctx.fillStyle = PAL.laneWhite;
      if (horiz) { ctx.fillRect(px, py + c - 12.5, TS, 1); ctx.fillRect(px, py + c + 11.5, TS, 1); }
      else { ctx.fillRect(px + c - 12.5, py, 1, TS); ctx.fillRect(px + c + 11.5, py, 1, TS); }
      along((k) => {
        if (horiz) { dash(px + k, py + c - 7, 6, 1.2); dash(px + k, py + c + 6, 6, 1.2); }
        else { dash(px + c - 7, py + k, 1.2, 6); dash(px + c + 6, py + k, 1.2, 6); }
      });
    } else if (avenue) {
      ctx.fillStyle = PAL.median;
      if (horiz) dash(px - 1, py + c - 1.8, TS + 2, 3.6); else dash(px + c - 1.8, py - 1, 3.6, TS + 2);
      ctx.fillStyle = PAL.laneWhite;
      along((k) => {
        if (horiz) { dash(px + k, py + c - 8, 5, 1.2); dash(px + k, py + c + 7, 5, 1.2); }
        else { dash(px + c - 8, py + k, 1.2, 5); dash(px + c + 7, py + k, 1.2, 5); }
      });
    } else {
      ctx.fillStyle = PAL.laneMark;
      along((k) => {
        if (horiz && (cw || k > c) && (ce || k < c)) dash(px + k, py + c - 1, 5, 2);
        if (vert && (cn || k > c) && (cs || k < c)) dash(px + c - 1, py + k, 2, 5);
      });
    }
  }

  // Traffic signals at the four corners of an intersection; north-south and east-west
  // take turns on green.
  drawLights(px, py, hw) {
    const ctx = this.ctx, c = TS / 2, nsGreen = Math.floor(this.time / 2.5) % 2 === 0;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = px + c + sx * (hw + 1), y = py + c + sy * (hw + 1);
      ctx.fillStyle = '#7d8794';
      roundRect(ctx, x - 2.2, y - 2.2, 4.4, 4.4, 1.4); ctx.fill();
      const ns = sx === sy; // two opposite corners face north-south traffic
      ctx.fillStyle = ns === nsGreen ? '#7fd09a' : '#f08a80';
      ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Interchange: the highway passes over on a bridge deck; curved ramps link it to the
  // crossing road in each quadrant.
  drawInterchange(map, x, y, px, py) {
    const ctx = this.ctx, c = TS / 2;
    const isHwy = (dx, dy) => map.inBounds(x + dx, y + dy) && map.type[map.idx(x + dx, y + dy)] === TILE.ROAD
      && map.roadClass[map.idx(x + dx, y + dy)] === 2;
    const hwyH = isHwy(-1, 0) || isHwy(1, 0) || !(isHwy(0, -1) || isHwy(0, 1)); // which way the deck runs
    ctx.strokeStyle = PAL.asphalt[0];
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.beginPath();
      ctx.arc(px + c + sx * c, py + c + sy * c, c - 3, sx < 0 ? (sy < 0 ? 0 : -Math.PI / 2) : (sy < 0 ? Math.PI / 2 : Math.PI), sx < 0 ? (sy < 0 ? Math.PI / 2 : 0) : (sy < 0 ? Math.PI : Math.PI * 1.5));
      ctx.stroke();
    }
    // Deck with a soft shadow on both sides so it reads as elevated.
    ctx.fillStyle = 'rgba(60,70,90,0.18)';
    if (hwyH) ctx.fillRect(px, py + c - 13, TS, 28); else ctx.fillRect(px + c - 13, py, 28, TS);
    ctx.fillStyle = PAL.asphalt[2];
    if (hwyH) ctx.fillRect(px, py + c - 11.5, TS, 23); else ctx.fillRect(px + c - 11.5, py, 23, TS);
    ctx.fillStyle = PAL.barrier;
    if (hwyH) { ctx.fillRect(px, py + c - 12.5, TS, 1.5); ctx.fillRect(px, py + c + 11, TS, 1.5); ctx.fillRect(px, py + c - 0.8, TS, 1.6); }
    else { ctx.fillRect(px + c - 12.5, py, 1.5, TS); ctx.fillRect(px + c + 11, py, 1.5, TS); ctx.fillRect(px + c - 0.8, py, 1.6, TS); }
  }

  // Little cars on straight road tiles; count follows volume, speed follows congestion.
  drawCars(map, x0, y0, x1, y1) {
    const ctx = this.ctx;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      forEachCar(map, x, y, this.time, (along, off, horiz, hex) => {
        ctx.fillStyle = hex;
        if (horiz) roundRect(ctx, x * TS + along * TS - 3, y * TS + off * TS - 1.75, 6, 3.5, 1.4);
        else roundRect(ctx, x * TS + off * TS - 1.75, y * TS + along * TS - 3, 3.5, 6, 1.4);
        ctx.fill();
      });
    }
  }

  drawPark(px, py, v) {
    const ctx = this.ctx;
    ctx.fillStyle = PAL.park;
    roundRect(ctx, px + 1.5, py + 1.5, TS - 3, TS - 3, 7);
    ctx.fill();
    ctx.strokeStyle = PAL.parkPath;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (v & 1) { ctx.moveTo(px + 3, py + 20); ctx.quadraticCurveTo(px + 16, py + 8, px + 29, py + 14); }
    else { ctx.moveTo(px + 12, py + 3); ctx.quadraticCurveTo(px + 22, py + 16, px + 16, py + 29); }
    ctx.stroke();
    if (this.flatOnly) return; // the 3D view draws park trees as meshes
    this.treeBlob(px + 8, py + 9, 5, v);
    this.treeBlob(px + 24, py + 23, 6, v >> 2);
    if (v & 4) this.treeBlob(px + 23, py + 7, 4, v >> 3);
  }

  // Ground-level parts of public buildings (the 3D view reuses these).
  drawServicePad(map, i, px, py) {
    const ctx = this.ctx, k = KINDS[map.kind[i]], S = PAL.svc;
    const pad = { plaza: S.plaza, school: S.yard, wind: PAL.park, bus: S.plaza, metro: S.plaza }[k] ?? '#ece8e0';
    ctx.fillStyle = pad;
    roundRect(ctx, px + 1.5, py + 1.5, TS - 3, TS - 3, 6);
    ctx.fill();
    if (k === 'plaza') {
      ctx.strokeStyle = 'rgba(190,175,150,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let a = 8; a < TS; a += 8) { ctx.moveTo(px + a, py + 3); ctx.lineTo(px + a, py + TS - 3); ctx.moveTo(px + 3, py + a); ctx.lineTo(px + TS - 3, py + a); }
      ctx.stroke();
      ctx.fillStyle = '#e0d6c4';
      ctx.beginPath(); ctx.arc(px + 16, py + 16, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = S.fountain;
      ctx.beginPath(); ctx.arc(px + 16, py + 16, 6, 0, Math.PI * 2); ctx.fill();
    } else if (k === 'school') {
      ctx.strokeStyle = '#f4ecd2';
      ctx.lineWidth = 2;
      roundRect(ctx, px + 16, py + 17, 13, 11, 5.5);
      ctx.stroke();
    }
  }

  treeBlob(cx, cy, r, v) {
    const ctx = this.ctx;
    ctx.fillStyle = PAL.treeShadow;
    ctx.beginPath(); ctx.arc(cx + 1.5, cy + 2, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PAL.tree[v % 3];
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.arc(cx - r * 0.3, cy - r * 0.35, r * 0.45, 0, Math.PI * 2); ctx.fill();
  }

  drawObjects(map, x, y) {
    const i = map.idx(x, y), px = x * TS, py = y * TS, v = map.variant[i];
    const t = map.type[i];
    if (t === TILE.EMPTY && map.hasFlag(i, FLAG.TREES)) {
      this.treeBlob(px + 9 + (v & 3), py + 10, 6, v);
      this.treeBlob(px + 22, py + 12 + ((v >> 2) & 3), 5, v >> 1);
      this.treeBlob(px + 14 + ((v >> 4) & 3), py + 23, 6, v >> 2);
      return;
    }
    if (t === TILE.SERVICE) this.drawService(map, i, px, py, v);
    else if (t === TILE.RES || t === TILE.COM || t === TILE.IND) {
      const lv = map.level[i];
      if (lv === 0) return;
      const ab = map.hasFlag(i, FLAG.ABANDONED);
      if (t === TILE.RES) this.drawResidential(px, py, lv, v, ab);
      else if (t === TILE.COM) this.drawCommercial(px, py, lv, v, ab);
      else this.drawIndustrial(px, py, lv, v, ab);
    }
    if (map.hasFlag(i, FLAG.FIRE)) this.drawFire(px, py, v);
  }

  // Flickering flames and a smoke plume over a burning building.
  drawFire(px, py, v) {
    const ctx = this.ctx, t = this.time * 6 + v;
    ctx.fillStyle = 'rgba(90,80,80,0.18)';
    roundRect(ctx, px + 2, py + 2, TS - 4, TS - 4, 6); ctx.fill();
    ctx.fillStyle = 'rgba(150,150,155,0.45)';
    for (let k = 0; k < 3; k++) {
      const r = 5 + k * 2 + Math.sin(t * 0.5 + k) * 1;
      ctx.beginPath(); ctx.arc(px + 20 + k * 3, py + 6 - k * 5, r, 0, Math.PI * 2); ctx.fill();
    }
    for (const [fx, fy, s] of [[10, 18, 1], [20, 14, 1.2], [15, 22, 0.9]]) {
      const f = s * (1 + Math.sin(t + fx) * 0.15);
      ctx.fillStyle = '#f59a62';
      ctx.beginPath(); ctx.ellipse(px + fx, py + fy, 5 * f, 7 * f, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd36e';
      ctx.beginPath(); ctx.ellipse(px + fx, py + fy + 1.5, 2.8 * f, 4.2 * f, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // A rounded box with a soft drop shadow whose length reads as height.
  box(x, y, w, h, height, color, ab, r = 3) {
    const ctx = this.ctx;
    ctx.fillStyle = PAL.shadow;
    roundRect(ctx, x + height * 0.8, y + height, w, h, r);
    ctx.fill();
    ctx.fillStyle = ab ? PAL.abandoned : color;
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
  }

  windows(x, y, w, h, step, ab) {
    const ctx = this.ctx;
    ctx.fillStyle = ab ? PAL.abandonedDark : 'rgba(255,255,255,0.55)';
    for (let yy = y + 3; yy < y + h - 3; yy += step) for (let xx = x + 3; xx < x + w - 3; xx += step) ctx.fillRect(xx, yy, 2, 2);
  }

  cracks(x, y, w, h) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#8f8b86';
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + w - 3, y + h - 3);
    ctx.moveTo(x + w - 3, y + 3); ctx.lineTo(x + 3, y + h - 3);
    ctx.stroke();
  }

  drawResidential(px, py, lv, v, ab) {
    const roof = PAL.roof[TILE.RES][lv], ctx = this.ctx;
    if (lv === 1) {
      const houses = (v & 1) ? [[5, 5], [18, 17]] : [[18, 5], [5, 17]];
      for (const [hx, hy] of houses) {
        this.box(px + hx, py + hy, 10, 10, 2, roof, ab, 2.5);
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(px + hx + 1, py + hy + 4.5, 8, 1.2);
        if (ab) this.cracks(px + hx, py + hy, 10, 10);
      }
    } else if (lv === 2) {
      this.box(px + 4, py + 5, 24, 20, 4, roof, ab, 4);
      ctx.fillStyle = 'rgba(0,0,0,0.07)';
      ctx.fillRect(px + 6, py + 14, 20, 1.5);
      this.windows(px + 4, py + 5, 24, 20, 5, ab);
      if (ab) this.cracks(px + 4, py + 5, 24, 20);
    } else {
      this.box(px + 3, py + 3, 26, 26, 7, roof, ab, 5);
      ctx.fillStyle = ab ? PAL.abandonedDark : 'rgba(255,255,255,0.22)';
      roundRect(ctx, px + 6, py + 6, 20, 20, 4); ctx.fill();
      this.windows(px + 3, py + 3, 26, 26, 4, ab);
      ctx.fillStyle = ab ? '#bbb' : '#cfa292';
      roundRect(ctx, px + 12, py + 12, 8, 8, 2); ctx.fill();
      if (ab) this.cracks(px + 3, py + 3, 26, 26);
    }
  }

  drawCommercial(px, py, lv, v, ab) {
    const roof = PAL.roof[TILE.COM][lv], ctx = this.ctx;
    if (lv === 1) {
      this.box(px + 5, py + 8, 22, 14, 2, roof, ab, 3);
      ctx.fillStyle = ab ? PAL.abandonedDark : ['#e9b8b0', '#ecd9a6', '#b8dac6'][v % 3];
      roundRect(ctx, px + 4, py + 20, 24, 3.5, 1.5); ctx.fill(); // awning
      if (ab) this.cracks(px + 5, py + 8, 22, 14);
    } else if (lv === 2) {
      this.box(px + 3, py + 4, 26, 22, 4, roof, ab, 4);
      this.windows(px + 3, py + 4, 26, 22, 4, ab);
      ctx.fillStyle = ab ? PAL.abandonedDark : '#ecd9a6';
      roundRect(ctx, px + 3, py + 23, 26, 3, 1.5); ctx.fill();
      if (ab) this.cracks(px + 3, py + 4, 26, 22);
    } else {
      this.box(px + 3, py + 3, 26, 26, 9, roof, ab, 5);
      ctx.strokeStyle = ab ? PAL.abandonedDark : 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 8; k < 28; k += 5) { ctx.moveTo(px + k, py + 5); ctx.lineTo(px + k, py + 27); ctx.moveTo(px + 5, py + k); ctx.lineTo(px + 27, py + k); }
      ctx.stroke();
      ctx.fillStyle = ab ? '#bbb' : '#8eaed2';
      roundRect(ctx, px + 11, py + 11, 10, 10, 3); ctx.fill();
      if (ab) this.cracks(px + 3, py + 3, 26, 26);
    }
  }

  drawIndustrial(px, py, lv, v, ab) {
    const roof = PAL.roof[TILE.IND][lv], ctx = this.ctx;
    if (lv === 1) {
      this.box(px + 4, py + 6, 16, 18, 2, roof, ab, 3);
      ctx.fillStyle = ab ? PAL.abandonedDark : '#dcc3a0';
      roundRect(ctx, px + 22, py + 16, 6, 8, 1.5); ctx.fill(); // crates
      if (ab) this.cracks(px + 4, py + 6, 16, 18);
    } else if (lv === 2) {
      this.box(px + 3, py + 4, 26, 22, 3, roof, ab, 3);
      ctx.fillStyle = ab ? PAL.abandonedDark : 'rgba(0,0,0,0.09)';
      for (let k = 0; k < 4; k++) ctx.fillRect(px + 4, py + 7 + k * 5, 24, 2);
      if (ab) this.cracks(px + 3, py + 4, 26, 22);
    } else {
      this.box(px + 2, py + 5, 22, 24, 4, roof, ab, 3);
      ctx.fillStyle = ab ? PAL.abandonedDark : 'rgba(0,0,0,0.09)';
      for (let k = 0; k < 4; k++) ctx.fillRect(px + 3, py + 8 + k * 6, 20, 2);
      // smokestacks
      this.round(px + 27, py + 6, 3.5, ab ? PAL.abandoned : '#bdb5ad', 6);
      this.round(px + 26.5, py + 16, 3, ab ? PAL.abandoned : '#bdb5ad', 5);
      if (!ab) {
        ctx.fillStyle = 'rgba(160,160,160,0.28)';
        ctx.beginPath(); ctx.arc(px + 29, py + 2, 4 + (v & 3), 0, Math.PI * 2); ctx.fill();
      } else this.cracks(px + 2, py + 5, 22, 24);
    }
  }

  // Round object seen from above with a shadow (towers, tanks, stacks).
  round(cx, cy, r, color, height = 3) {
    const ctx = this.ctx;
    ctx.fillStyle = PAL.shadow;
    ctx.beginPath(); ctx.arc(cx + height * 0.8, cy + height, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }

  drawService(map, i, px, py, v) {
    const ctx = this.ctx, k = KINDS[map.kind[i]], S = PAL.svc;
    switch (k) {
      case 'coal':
        this.box(px + 3, py + 15, 16, 13, 4, S.coal, false, 3);
        this.round(px + 22, py + 10, 7, S.coalTower, 8);
        ctx.fillStyle = '#cdc7c0';
        ctx.beginPath(); ctx.arc(px + 22, py + 10, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.beginPath(); ctx.arc(px + 24, py + 5, 4 + Math.sin(this.time * 2 + v) * 0.8, 0, Math.PI * 2); ctx.fill();
        this.round(px + 8, py + 8, 2.5, '#bdb5ad', 7);
        break;
      case 'wind':
        for (const [cx, cy, ph] of [[10, 11, 0], [22, 22, 1.3]]) {
          this.round(px + cx, py + cy, 1.6, '#f4f4f4', 6);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.6;
          ctx.lineCap = 'round';
          ctx.beginPath();
          const a0 = this.time * 3 + ph + v;
          for (let b = 0; b < 3; b++) {
            const a = a0 + b * (Math.PI * 2 / 3);
            ctx.moveTo(px + cx, py + cy); ctx.lineTo(px + cx + Math.cos(a) * 8, py + cy + Math.sin(a) * 8);
          }
          ctx.stroke();
        }
        break;
      case 'pump':
        this.box(px + 4, py + 6, 13, 12, 3, S.pump, false, 3);
        this.round(px + 22, py + 21, 6.5, S.pumpTank, 5);
        ctx.fillStyle = '#cbe4f2';
        ctx.beginPath(); ctx.arc(px + 22, py + 21, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#b4c3cf';
        roundRect(ctx, px + 10, py + 19, 8, 2.5, 1.2); ctx.fill();
        break;
      case 'school':
        this.box(px + 3, py + 3, 26, 11, 4, S.school, false, 3);
        this.box(px + 3, py + 3, 11, 25, 4, S.school, false, 3);
        ctx.fillStyle = S.schoolRoof;
        roundRect(ctx, px + 5, py + 5, 7, 7, 2); ctx.fill();
        ctx.fillStyle = '#e4a0a4';
        ctx.fillRect(px + 25, py + 17, 4, 3);
        ctx.fillStyle = '#9aa4b2';
        ctx.fillRect(px + 24.5, py + 17, 0.8, 8);
        break;
      case 'clinic':
        this.box(px + 4, py + 4, 24, 24, 5, S.clinic, false, 5);
        ctx.fillStyle = S.cross;
        roundRect(ctx, px + 13, py + 8, 6, 16, 1.5); ctx.fill();
        roundRect(ctx, px + 8, py + 13, 16, 6, 1.5); ctx.fill();
        break;
      case 'plaza':
        this.treeBlob(px + 6, py + 6, 3.5, v);
        this.treeBlob(px + 26, py + 26, 3.5, v >> 1);
        this.treeBlob(px + 26, py + 6, 3.5, v >> 2);
        this.treeBlob(px + 6, py + 26, 3.5, v >> 3);
        break;
      case 'bus': {
        // Shelter, a bench, and the stop sign
        this.box(px + 6, py + 12, 18, 8, 3, S.bus, false, 2.5);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        roundRect(ctx, px + 8, py + 14, 14, 3, 1.2); ctx.fill();
        this.round(px + 26, py + 10, 3, S.busSign, 5);
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, px + 24.6, py + 9.3, 2.8, 1.4, 0.6); ctx.fill();
        break;
      }
      case 'metro':
        // Station entrance with stairs down and the "M" roundel
        this.box(px + 5, py + 7, 22, 16, 4, S.metro, false, 4);
        ctx.fillStyle = 'rgba(90,80,110,0.25)';
        for (let k = 0; k < 4; k++) ctx.fillRect(px + 9, py + 11 + k * 2.6, 10, 1.2);
        this.round(px + 23.5, py + 11, 4, S.metroSign, 4);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(px + 21.6, py + 13); ctx.lineTo(px + 21.6, py + 9.2); ctx.lineTo(px + 23.5, py + 11.6); ctx.lineTo(px + 25.4, py + 9.2); ctx.lineTo(px + 25.4, py + 13); ctx.stroke();
        break;
      case 'police':
        this.box(px + 4, py + 5, 24, 20, 4, S.police, false, 4);
        ctx.fillStyle = S.policeRoof;
        roundRect(ctx, px + 7, py + 8, 18, 5, 2); ctx.fill();
        ctx.fillStyle = '#e4a0a4'; roundRect(ctx, px + 11, py + 16, 4, 3, 1); ctx.fill();
        ctx.fillStyle = '#9fb6e0'; roundRect(ctx, px + 17, py + 16, 4, 3, 1); ctx.fill();
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, px + 8, py + 26, 6, 3, 1.2); ctx.fill(); // patrol car
        break;
      case 'fire':
        this.box(px + 3, py + 6, 20, 22, 4, S.fire, false, 3);
        ctx.fillStyle = S.door;
        for (let k = 0; k < 2; k++) { roundRect(ctx, px + 5 + k * 9, py + 21, 7, 6, 1.2); ctx.fill(); }
        this.box(px + 23, py + 4, 6, 8, 7, S.fireRoof, false, 2); // hose tower
        ctx.fillStyle = '#d9998b';
        roundRect(ctx, px + 24, py + 23, 5, 7, 1.5); ctx.fill(); // engine
        break;
      case 'recycling':
        this.box(px + 4, py + 4, 18, 15, 4, S.recycling, false, 4);
        S.bins.forEach((c, n) => { this.box(px + 6 + n * 8, py + 23, 6, 6, 2, c, false, 1.5); });
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(px + 13, py + 11.5, 3.5, 0.3, Math.PI * 1.7); ctx.stroke();
        break;
      default:
        break;
    }
  }
}

// Car placement shared by the 2D and 3D views. Calls emit(along, offset, horizontal, colour)
// with along/offset in tile units (0..1) for every car on tile (x, y) at time t.
const LANES = [[-5, 5], [-11, -4.5, 4.5, 11], [-10.5, -5, 5, 10.5]];
const CARS_PER = [35, 90, 150];    // trips per car shown, by road class
const MAX_PER_LANE = [3, 2, 3];
export function forEachCar(map, x, y, t, emit) {
  const i = map.idx(x, y);
  if (map.type[i] !== TILE.ROAD || map.traffic[i] < 4) return;
  const road = (dx, dy) => map.inBounds(x + dx, y + dy) && map.type[map.idx(x + dx, y + dy)] === TILE.ROAD;
  const h = road(-1, 0) || road(1, 0) || x === 0 || x === map.width - 1;
  const v = road(0, -1) || road(0, 1);
  if (h === v) return; // intersections, corners, isolated tiles
  const cls = map.roadClass[i], lanes = LANES[cls];
  const perLane = Math.min(MAX_PER_LANE[cls], Math.ceil(map.traffic[i] / CARS_PER[cls] / lanes.length * 2));
  const free = [0.8, 0.5, 0.3][cls];
  const speed = 34 * (cls === 2 ? 1.6 : 1) / (roadTime(map, i) / free); // px/s, slows when congested
  const seed = map.variant[i];
  for (let l = 0; l < lanes.length; l++) {
    const dir = lanes[l] < 0 ? -1 : 1; // opposite directions either side of the centre line
    for (let k = 0; k < perLane; k++) {
      let pos = (t * speed + k * (TS / perLane) + ((seed * (l + 3)) % TS)) % TS;
      if (dir < 0) pos = TS - pos;
      emit(pos / TS, (TS / 2 + lanes[l]) / TS, h, PAL.cars[(seed + k * 3 + l) % PAL.cars.length]);
    }
  }
}
