// Rendering: draws the map with flat shapes on a 2D canvas. Reads state, never mutates it.

import { TILE, TERRAIN, FLAG } from './map.js';
import { roadLoad, roadTime } from './traffic.js';

export const TS = 32; // tile size in world units

const PAL = {
  bg: '#1d2430',
  grass: ['#a9cf8c', '#a4cb86', '#aed392', '#a0c783'],
  water: '#6bb3dd', waterLight: '#8cc7e8', bank: '#8fbf78',
  tree: ['#4f8f45', '#5c9d4e', '#467f3d'], treeShadow: 'rgba(30,60,30,0.25)',
  asphalt: '#5c6370', asphaltEdge: '#4b515c', laneMark: '#f3d27a', bridgeRail: '#8a6a4a',
  park: '#86c870', parkPath: '#e9dcae',
  lot: { 2: '#d8edc6', 3: '#cfe0f3', 4: '#f2e3bb' },
  lotEdge: { 2: '#7dbb64', 3: '#5f97d3', 4: '#cda24a' },
  // roofs per zone per level (1..3): light -> dark = small -> large
  roof: {
    2: [null, '#f2a37c', '#e07b58', '#b8563e'],
    3: [null, '#8fc3ec', '#5b9bdb', '#2f6db5'],
    4: [null, '#e8c874', '#c9a04a', '#94712f'],
  },
  laneWhite: 'rgba(255,255,255,0.7)', median: '#8fae6e',
  cars: ['#e8665a', '#f2f2f2', '#5b9bdb', '#f2c14e', '#3d4450', '#8fd0a4', '#c9a0dc'],
  abandoned: '#8d8a86', abandonedDark: '#6c6a67',
  shadow: 'rgba(20,30,40,0.28)',
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

    // Pass 1: ground (terrain, roads, lots). Pass 2: buildings & trees (they cast shadows onto neighbours).
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.drawGround(map, x, y);
    if (cam.zoom >= 0.7) this.drawGrid(x0, y0, x1, y1);
    if (cam.zoom >= 0.55) this.drawCars(map, x0, y0, x1, y1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.drawObjects(map, x, y);

    if (this.overlay) this.drawOverlay(map, x0, y0, x1, y1);

    if (preview && preview.tiles.size) {
      ctx.fillStyle = preview.ok ? 'rgba(255,255,255,0.35)' : 'rgba(230,70,60,0.45)';
      for (const i of preview.tiles) {
        const px = (i % map.width) * TS, py = ((i / map.width) | 0) * TS;
        ctx.fillRect(px, py, TS, TS);
      }
    }
    if (hover && map.inBounds(hover.x, hover.y)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2 / cam.zoom;
      ctx.strokeRect(hover.x * TS + 1, hover.y * TS + 1, TS - 2, TS - 2);
    }
    // map border
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2 / cam.zoom;
    ctx.strokeRect(0, 0, map.width * TS, map.height * TS);
  }

  drawGround(map, x, y) {
    const ctx = this.ctx, i = map.idx(x, y), px = x * TS, py = y * TS;
    const t = map.type[i], v = map.variant[i];
    if (map.terrain[i] === TERRAIN.WATER) {
      ctx.fillStyle = PAL.water;
      ctx.fillRect(px, py, TS + 0.5, TS + 0.5);
      ctx.fillStyle = PAL.waterLight;
      const o = (v % 3) * 6;
      ctx.fillRect(px + 5 + o, py + 8 + (v % 5), 8, 2);
      ctx.fillRect(px + 14 - o / 2, py + 21 - (v % 4), 9, 2);
    } else {
      ctx.fillStyle = PAL.grass[v & 3];
      ctx.fillRect(px, py, TS + 0.5, TS + 0.5); // overlap hides anti-aliasing seams
    }
    if (t === TILE.ROAD) this.drawRoad(map, x, y, map.terrain[i] === TERRAIN.WATER);
    else if (t === TILE.PARK) this.drawPark(px, py, v);
    else if (t === TILE.RES || t === TILE.COM || t === TILE.IND) {
      const ab = map.hasFlag(i, FLAG.ABANDONED);
      ctx.fillStyle = ab ? '#cfccc6' : PAL.lot[t];
      ctx.fillRect(px + 1, py + 1, TS - 2, TS - 2);
      if (map.level[i] === 0) {
        // vacant lot: dashed outline in zone colour (grey if it has no road access)
        const access = map.hasRoadAccess(i);
        ctx.strokeStyle = access ? PAL.lotEdge[t] : '#a09c94';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(px + 3, py + 3, TS - 6, TS - 6);
        ctx.setLineDash([]);
        if (!access) {
          ctx.fillStyle = 'rgba(120,110,100,0.35)';
          ctx.fillRect(px + 12, py + 15, 8, 2);
        }
      }
    }
  }

  drawGrid(x0, y0, x1, y1) {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(40,60,30,0.07)';
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
    const avenue = map.roadClass[map.idx(x, y)] === 1;
    const hw = avenue ? 15 : 11; // half width of carriageway
    const c = TS / 2;
    ctx.fillStyle = PAL.asphalt;
    ctx.fillRect(px + c - hw, py + c - hw, hw * 2, hw * 2);
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
    const horiz = (cw || ce) && !cn && !cs, vert = (cn || cs) && !cw && !ce;
    if (!horiz && !vert) return;
    const along = (fn) => { for (let k = 2; k < TS; k += 10) fn(k); };
    if (avenue) {
      // planted median + dashed white lane lines
      ctx.fillStyle = PAL.median;
      if (horiz) ctx.fillRect(px, py + c - 1.5, TS, 3); else ctx.fillRect(px + c - 1.5, py, 3, TS);
      ctx.fillStyle = PAL.laneWhite;
      along((k) => {
        if (horiz) { ctx.fillRect(px + k, py + c - 8, 5, 1); ctx.fillRect(px + k, py + c + 7, 5, 1); }
        else { ctx.fillRect(px + c - 8, py + k, 1, 5); ctx.fillRect(px + c + 7, py + k, 1, 5); }
      });
    } else {
      ctx.fillStyle = PAL.laneMark;
      along((k) => {
        if (horiz && (cw || k > c) && (ce || k < c)) ctx.fillRect(px + k, py + c - 1, 5, 2);
        if (vert && (cn || k > c) && (cs || k < c)) ctx.fillRect(px + c - 1, py + k, 2, 5);
      });
    }
  }

  // Little cars on straight road tiles; count follows volume, speed follows congestion.
  drawCars(map, x0, y0, x1, y1) {
    const ctx = this.ctx, t = this.time;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = map.idx(x, y);
      if (map.type[i] !== TILE.ROAD || map.traffic[i] < 4) continue;
      const road = (dx, dy) => map.inBounds(x + dx, y + dy) && map.type[map.idx(x + dx, y + dy)] === TILE.ROAD;
      const h = road(-1, 0) || road(1, 0) || x === 0 || x === map.width - 1;
      const v = road(0, -1) || road(0, 1);
      if (h === v) continue; // intersections, corners, isolated tiles
      const avenue = map.roadClass[i] === 1;
      const lanes = avenue ? [-11, -4.5, 4.5, 11] : [-5, 5];
      const perLane = Math.min(avenue ? 2 : 3, Math.ceil(map.traffic[i] / (avenue ? 90 : 35) / lanes.length * 2));
      const speed = 34 / (roadTime(map, i) / (avenue ? 0.5 : 0.8)); // px/s, slows when congested
      const seed = map.variant[i];
      for (let l = 0; l < lanes.length; l++) {
        const dir = lanes[l] < 0 ? -1 : 1; // opposite directions either side of the centre line
        for (let k = 0; k < perLane; k++) {
          let pos = (t * speed + k * (TS / perLane) + ((seed * (l + 3)) % TS)) % TS;
          if (dir < 0) pos = TS - pos;
          ctx.fillStyle = PAL.cars[(seed + k * 3 + l) % PAL.cars.length];
          const off = TS / 2 + lanes[l];
          if (h) ctx.fillRect(x * TS + pos - 3, y * TS + off - 1.75, 6, 3.5);
          else ctx.fillRect(x * TS + off - 1.75, y * TS + pos - 3, 3.5, 6);
        }
      }
    }
  }

  drawPark(px, py, v) {
    const ctx = this.ctx;
    ctx.fillStyle = PAL.park;
    ctx.fillRect(px + 1, py + 1, TS - 2, TS - 2);
    ctx.strokeStyle = PAL.parkPath;
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (v & 1) { ctx.moveTo(px + 2, py + 20); ctx.quadraticCurveTo(px + 16, py + 8, px + 30, py + 14); }
    else { ctx.moveTo(px + 12, py + 2); ctx.quadraticCurveTo(px + 22, py + 16, px + 16, py + 30); }
    ctx.stroke();
    if (this.flatOnly) return; // the 3D view draws park trees as meshes
    this.treeBlob(px + 8, py + 9, 5, v);
    this.treeBlob(px + 24, py + 23, 6, v >> 2);
    if (v & 4) this.treeBlob(px + 23, py + 7, 4, v >> 3);
  }

  treeBlob(cx, cy, r, v) {
    const ctx = this.ctx;
    ctx.fillStyle = PAL.treeShadow;
    ctx.beginPath(); ctx.arc(cx + 2, cy + 2, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PAL.tree[v % 3];
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
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
    if (t !== TILE.RES && t !== TILE.COM && t !== TILE.IND) return;
    const lv = map.level[i];
    if (lv === 0) return;
    const ab = map.hasFlag(i, FLAG.ABANDONED);
    if (t === TILE.RES) this.drawResidential(px, py, lv, v, ab);
    else if (t === TILE.COM) this.drawCommercial(px, py, lv, v, ab);
    else this.drawIndustrial(px, py, lv, v, ab);
  }

  // A box with a drop shadow whose length reads as height.
  box(x, y, w, h, height, color, ab) {
    const ctx = this.ctx;
    ctx.fillStyle = PAL.shadow;
    ctx.fillRect(x + height, y + height, w, h);
    ctx.fillStyle = ab ? PAL.abandoned : color;
    ctx.fillRect(x, y, w, h);
  }

  windows(x, y, w, h, step, ab) {
    const ctx = this.ctx;
    ctx.fillStyle = ab ? PAL.abandonedDark : 'rgba(255,255,255,0.45)';
    for (let yy = y + 3; yy < y + h - 3; yy += step) for (let xx = x + 3; xx < x + w - 3; xx += step) ctx.fillRect(xx, yy, 2, 2);
  }

  cracks(x, y, w, h) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#4e4b48';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + w - 2, y + h - 2);
    ctx.moveTo(x + w - 2, y + 2); ctx.lineTo(x + 2, y + h - 2);
    ctx.stroke();
  }

  drawResidential(px, py, lv, v, ab) {
    const roof = PAL.roof[TILE.RES][lv], ctx = this.ctx;
    if (lv === 1) {
      // a pair of small houses with pitched-roof ridge lines
      const houses = (v & 1) ? [[5, 5], [18, 17]] : [[18, 5], [5, 17]];
      for (const [hx, hy] of houses) {
        this.box(px + hx, py + hy, 10, 10, 2, roof, ab);
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(px + hx, py + hy + 4, 10, 2);
        if (ab) this.cracks(px + hx, py + hy, 10, 10);
      }
    } else if (lv === 2) {
      this.box(px + 4, py + 5, 24, 20, 4, roof, ab);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(px + 4, py + 14, 24, 2);
      this.windows(px + 4, py + 5, 24, 20, 5, ab);
      if (ab) this.cracks(px + 4, py + 5, 24, 20);
    } else {
      this.box(px + 3, py + 3, 26, 26, 7, roof, ab);
      ctx.fillStyle = ab ? PAL.abandonedDark : 'rgba(255,255,255,0.18)';
      ctx.fillRect(px + 6, py + 6, 20, 20);
      this.windows(px + 3, py + 3, 26, 26, 4, ab);
      ctx.fillStyle = ab ? '#777' : '#7a3b2c';
      ctx.fillRect(px + 12, py + 12, 8, 8); // roof plant
      if (ab) this.cracks(px + 3, py + 3, 26, 26);
    }
  }

  drawCommercial(px, py, lv, v, ab) {
    const roof = PAL.roof[TILE.COM][lv], ctx = this.ctx;
    if (lv === 1) {
      this.box(px + 5, py + 8, 22, 14, 2, roof, ab);
      ctx.fillStyle = ab ? PAL.abandonedDark : ['#e8665a', '#f2b84b', '#6cc19c'][v % 3];
      ctx.fillRect(px + 5, py + 20, 22, 3); // awning
      if (ab) this.cracks(px + 5, py + 8, 22, 14);
    } else if (lv === 2) {
      this.box(px + 3, py + 4, 26, 22, 4, roof, ab);
      this.windows(px + 3, py + 4, 26, 22, 4, ab);
      ctx.fillStyle = ab ? PAL.abandonedDark : '#f2d16b';
      ctx.fillRect(px + 3, py + 23, 26, 3);
      if (ab) this.cracks(px + 3, py + 4, 26, 22);
    } else {
      this.box(px + 3, py + 3, 26, 26, 9, roof, ab);
      // glass curtain wall grid
      ctx.strokeStyle = ab ? PAL.abandonedDark : 'rgba(210,235,255,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 7; k < 29; k += 5) { ctx.moveTo(px + k, py + 4); ctx.lineTo(px + k, py + 28); ctx.moveTo(px + 4, py + k); ctx.lineTo(px + 28, py + k); }
      ctx.stroke();
      ctx.fillStyle = ab ? '#777' : '#1f4f8a';
      ctx.fillRect(px + 11, py + 11, 10, 10);
      if (ab) this.cracks(px + 3, py + 3, 26, 26);
    }
  }

  drawIndustrial(px, py, lv, v, ab) {
    const roof = PAL.roof[TILE.IND][lv], ctx = this.ctx;
    if (lv === 1) {
      this.box(px + 4, py + 6, 16, 18, 2, roof, ab);
      ctx.fillStyle = ab ? PAL.abandonedDark : '#b98a3b';
      ctx.fillRect(px + 22, py + 16, 6, 8); // crates
      if (ab) this.cracks(px + 4, py + 6, 16, 18);
    } else if (lv === 2) {
      this.box(px + 3, py + 4, 26, 22, 3, roof, ab);
      // sawtooth roof
      ctx.fillStyle = ab ? PAL.abandonedDark : 'rgba(0,0,0,0.18)';
      for (let k = 0; k < 4; k++) ctx.fillRect(px + 3, py + 7 + k * 5, 26, 2);
      if (ab) this.cracks(px + 3, py + 4, 26, 22);
    } else {
      this.box(px + 2, py + 5, 22, 24, 4, roof, ab);
      ctx.fillStyle = ab ? PAL.abandonedDark : 'rgba(0,0,0,0.18)';
      for (let k = 0; k < 4; k++) ctx.fillRect(px + 2, py + 8 + k * 6, 22, 2);
      // smokestacks
      this.box(px + 24, py + 3, 6, 6, 8, ab ? PAL.abandoned : '#6d6259', ab);
      this.box(px + 24, py + 13, 5, 5, 6, ab ? PAL.abandoned : '#6d6259', ab);
      if (!ab) {
        ctx.fillStyle = 'rgba(90,90,90,0.35)';
        ctx.beginPath(); ctx.arc(px + 29, py + 1, 4 + (v & 3), 0, Math.PI * 2); ctx.fill();
      } else this.cracks(px + 2, py + 5, 22, 24);
    }
  }

  drawOverlay(map, x0, y0, x1, y1) {
    const ctx = this.ctx;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = map.idx(x, y);
      if (this.overlay === 'traffic') {
        ctx.fillStyle = map.type[i] === TILE.ROAD ? trafficColor(map.traffic[i] > 0.5 ? roadLoad(map, i) : -1) : 'rgba(20,28,38,0.45)';
      } else if (this.overlay === 'landValue') {
        if (map.terrain[i] === TERRAIN.WATER && map.type[i] !== TILE.ROAD) continue;
        ctx.fillStyle = landValueColor(map.landValue[i]);
      } else {
        const p = map.pollution[i];
        if (p < 1) continue;
        ctx.fillStyle = `rgba(110,45,120,${Math.min(0.8, 0.12 + p / 110)})`;
      }
      ctx.fillRect(x * TS, y * TS, TS, TS);
    }
  }
}

// green (free-flowing) -> yellow (busy) -> red (over capacity); grey = unused
export function trafficColor(load) {
  if (load < 0) return 'rgba(200,205,212,0.55)';
  if (load < 0.5) return 'rgba(80,190,100,0.8)';
  if (load < 1) return 'rgba(240,200,60,0.85)';
  if (load < 1.6) return 'rgba(235,120,50,0.9)';
  return 'rgba(215,55,50,0.9)';
}

// red (0) -> yellow (50) -> green (100)
export function landValueColor(v, alpha = 0.62) {
  const t = Math.max(0, Math.min(1, v / 100));
  let r, g, b;
  if (t < 0.5) { const k = t / 0.5; r = 214; g = Math.round(80 + (205 - 80) * k); b = 70; }
  else { const k = (t - 0.5) / 0.5; r = Math.round(214 - (214 - 60) * k); g = Math.round(205 - (205 - 170) * k); b = Math.round(70 + (90 - 70) * k); }
  return `rgba(${r},${g},${b},${alpha})`;
}
