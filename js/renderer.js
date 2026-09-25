// Rendering: draws the map with soft flat shapes on a 2D canvas. Reads state, never mutates it.

import { TILE, TERRAIN, FLAG, KINDS } from './map.js';
import { roadTime } from './traffic.js';
import { drawOverlay as paintOverlay, roundRect } from './overlays.js';

export const TS = 32; // tile size in world units

// Light, soft palette.
export const PAL = {
  bg: '#e6edf2',
  grass: ['#d0e7b8', '#cce4b3', '#d4eabd', '#c9e2af'],
  water: '#a6d6ee', waterLight: '#c9e8f7',
  tree: ['#8fc47c', '#83bb70', '#9bcd88'], treeShadow: 'rgba(70,100,70,0.16)',
  asphalt: ['#a3aab4', '#959da8', '#8a929e'], laneMark: '#fff1bf', laneWhite: 'rgba(255,255,255,0.85)',
  median: '#b9dca4', barrier: '#eeebe4', bridgeRail: '#c9ad8e',
  park: '#b6dd9f', parkPath: '#f4ecd2',
  lot: { 2: '#e4f2d8', 3: '#dce9f7', 4: '#f7edd3' },
  lotEdge: { 2: '#a6d38f', 3: '#94bde6', 4: '#e2c27d' },
  wall: { 2: '#fbf1e6', 3: '#eef4fb', 4: '#f6eedc' },
  // roofs per zone per level (1..3): light -> deeper = small -> large
  roof: {
    2: [null, '#f5bea4', '#eda386', '#de8b72'],
    3: [null, '#b2d3f1', '#90bbe8', '#73a6dc'],
    4: [null, '#f2da9c', '#e6c682', '#d2ae6c'],
  },
  cars: ['#f08c80', '#ffffff', '#86b8e8', '#f6d27a', '#7d8794', '#9fd8b4', '#cdb0e2'],
  abandoned: '#c9c6c1', abandonedDark: '#a8a5a0',
  shadow: 'rgba(70,80,100,0.16)',
  svc: {
    coal: '#bdb3aa', coalTower: '#d9d4ce', wind: '#ffffff', pump: '#9ccfee', pumpTank: '#d6ecf8',
    school: '#f6d98c', schoolRoof: '#ec9f7e', yard: '#c8e4b2', clinic: '#ffffff', cross: '#ef7f86',
    plaza: '#efe6d6', fountain: '#a6d6ee', recycling: '#a9d6a0', bins: ['#86b8e8', '#f6d27a', '#9fd8b4'],
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
    if (cn) ctx.fillRect(px + c - hw, py, hw * 2, c);
    if (cs) ctx.fillRect(px + c - hw, py + c, hw * 2, c);
    if (cw) ctx.fillRect(px, py + c - hw, c, hw * 2);
    if (ce) ctx.fillRect(px + c, py + c - hw, c, hw * 2);
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
    const pad = { plaza: S.plaza, school: S.yard, wind: PAL.park }[k] ?? '#ece8e0';
    ctx.fillStyle = pad;
    roundRect(ctx, px + 1.5, py + 1.5, TS - 3, TS - 3, 6);
    ctx.fill();
    if (k === 'plaza') {
      ctx.strokeStyle = 'rgba(190,175,150,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let a = 8; a < TS; a += 8) { ctx.moveTo(px + a, py + 3); ctx.lineTo(px + a, py + TS - 3); ctx.moveTo(px + 3, py + a); ctx.lineTo(px + TS - 3, py + a); }
      ctx.stroke();
      ctx.fillStyle = '#d8ccb6';
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
    if (t === TILE.SERVICE) { this.drawService(map, i, px, py, v); return; }
    if (t !== TILE.RES && t !== TILE.COM && t !== TILE.IND) return;
    const lv = map.level[i];
    if (lv === 0) return;
    const ab = map.hasFlag(i, FLAG.ABANDONED);
    if (t === TILE.RES) this.drawResidential(px, py, lv, v, ab);
    else if (t === TILE.COM) this.drawCommercial(px, py, lv, v, ab);
    else this.drawIndustrial(px, py, lv, v, ab);
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
      ctx.fillStyle = ab ? '#aaa' : '#c97a66';
      roundRect(ctx, px + 12, py + 12, 8, 8, 2); ctx.fill();
      if (ab) this.cracks(px + 3, py + 3, 26, 26);
    }
  }

  drawCommercial(px, py, lv, v, ab) {
    const roof = PAL.roof[TILE.COM][lv], ctx = this.ctx;
    if (lv === 1) {
      this.box(px + 5, py + 8, 22, 14, 2, roof, ab, 3);
      ctx.fillStyle = ab ? PAL.abandonedDark : ['#f4a39a', '#f6d27a', '#9fd8b4'][v % 3];
      roundRect(ctx, px + 4, py + 20, 24, 3.5, 1.5); ctx.fill(); // awning
      if (ab) this.cracks(px + 5, py + 8, 22, 14);
    } else if (lv === 2) {
      this.box(px + 3, py + 4, 26, 22, 4, roof, ab, 4);
      this.windows(px + 3, py + 4, 26, 22, 4, ab);
      ctx.fillStyle = ab ? PAL.abandonedDark : '#f6d27a';
      roundRect(ctx, px + 3, py + 23, 26, 3, 1.5); ctx.fill();
      if (ab) this.cracks(px + 3, py + 4, 26, 22);
    } else {
      this.box(px + 3, py + 3, 26, 26, 9, roof, ab, 5);
      ctx.strokeStyle = ab ? PAL.abandonedDark : 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 8; k < 28; k += 5) { ctx.moveTo(px + k, py + 5); ctx.lineTo(px + k, py + 27); ctx.moveTo(px + 5, py + k); ctx.lineTo(px + 27, py + k); }
      ctx.stroke();
      ctx.fillStyle = ab ? '#aaa' : '#5f93cc';
      roundRect(ctx, px + 11, py + 11, 10, 10, 3); ctx.fill();
      if (ab) this.cracks(px + 3, py + 3, 26, 26);
    }
  }

  drawIndustrial(px, py, lv, v, ab) {
    const roof = PAL.roof[TILE.IND][lv], ctx = this.ctx;
    if (lv === 1) {
      this.box(px + 4, py + 6, 16, 18, 2, roof, ab, 3);
      ctx.fillStyle = ab ? PAL.abandonedDark : '#d9b27a';
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
      this.round(px + 27, py + 6, 3.5, ab ? PAL.abandoned : '#a89d94', 6);
      this.round(px + 26.5, py + 16, 3, ab ? PAL.abandoned : '#a89d94', 5);
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
        ctx.fillStyle = '#bfb8b0';
        ctx.beginPath(); ctx.arc(px + 22, py + 10, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.beginPath(); ctx.arc(px + 24, py + 5, 4 + Math.sin(this.time * 2 + v) * 0.8, 0, Math.PI * 2); ctx.fill();
        this.round(px + 8, py + 8, 2.5, '#a89d94', 7);
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
        ctx.fillStyle = '#b8dcf2';
        ctx.beginPath(); ctx.arc(px + 22, py + 21, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#9fb4c4';
        roundRect(ctx, px + 10, py + 19, 8, 2.5, 1.2); ctx.fill();
        break;
      case 'school':
        this.box(px + 3, py + 3, 26, 11, 4, S.school, false, 3);
        this.box(px + 3, py + 3, 11, 25, 4, S.school, false, 3);
        ctx.fillStyle = S.schoolRoof;
        roundRect(ctx, px + 5, py + 5, 7, 7, 2); ctx.fill();
        ctx.fillStyle = '#ef7f86';
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
