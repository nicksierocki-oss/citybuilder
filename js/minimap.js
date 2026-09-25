// Mini-map: one pixel per tile, the camera's view outlined; click or drag to move the camera.

import { TILE, TERRAIN, FLAG, isZone } from './map.js';

const KEY = 'gridline.minimap';
const COL = {
  grass: [226, 240, 211], water: [166, 214, 238], trees: [169, 211, 154], road: [150, 157, 168], rail: [150, 126, 104],
  [TILE.RES]: [124, 196, 122], [TILE.COM]: [111, 166, 227], [TILE.IND]: [227, 183, 90],
  [TILE.OFFICE]: [90, 190, 200], [TILE.FARM]: [196, 206, 110], [TILE.MIXED]: [205, 150, 120],
  park: [146, 207, 122], service: [200, 170, 210], abandoned: [190, 186, 180], fire: [232, 100, 80],
};

export class Minimap {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.game = game;
    this.base = document.createElement('canvas');
    this.key = null;
    this.drawnAt = 0;
    try { this.visible = localStorage.getItem(KEY) !== '0'; } catch { this.visible = true; }
    canvas.parentElement.hidden = !this.visible;
    let dragging = false;
    const jump = (e) => {
      const r = canvas.getBoundingClientRect(), map = this.game.state.map;
      const tx = Math.floor((e.clientX - r.left) / r.width * map.width), ty = Math.floor((e.clientY - r.top) / r.height * map.height);
      this.game.renderer.centerOn(map, Math.max(0, Math.min(map.width - 1, tx)), Math.max(0, Math.min(map.height - 1, ty)));
    };
    canvas.addEventListener('pointerdown', (e) => { dragging = true; canvas.setPointerCapture(e.pointerId); jump(e); });
    canvas.addEventListener('pointermove', (e) => { if (dragging) jump(e); });
    canvas.addEventListener('pointerup', () => { dragging = false; });
  }

  toggle() {
    this.visible = !this.visible;
    this.canvas.parentElement.hidden = !this.visible;
    try { localStorage.setItem(KEY, this.visible ? '1' : '0'); } catch { /* ignore */ }
  }

  // Repaint the tiles (throttled: the city changes slowly).
  draw() {
    if (!this.visible) return;
    const map = this.game.state.map, now = performance.now();
    const key = `${map.version}|${map.width}`;
    if (key === this.key && now - this.drawnAt < 1500) return;
    this.key = key;
    this.drawnAt = now;
    const b = this.base;
    if (b.width !== map.width || b.height !== map.height) { b.width = map.width; b.height = map.height; }
    const g = b.getContext('2d'), img = g.createImageData(map.width, map.height), d = img.data;
    for (let i = 0; i < map.size; i++) {
      const t = map.type[i];
      let c;
      if (map.hasFlag(i, FLAG.FIRE)) c = COL.fire;
      else if (t === TILE.ROAD) c = COL.road;
      else if (isZone(t)) c = map.hasFlag(i, FLAG.ABANDONED) ? COL.abandoned : COL[t];
      else if (t === TILE.RAIL) c = COL.rail;
      else if (t === TILE.PARK) c = COL.park;
      else if (t === TILE.SERVICE) c = COL.service;
      else if (map.terrain[i] === TERRAIN.WATER) c = COL.water;
      else c = map.hasFlag(i, FLAG.TREES) ? COL.trees : COL.grass;
      const dim = isZone(t) && map.level[i] === 0 ? 0.55 : 1; // vacant lots paler
      d[i * 4] = 255 - (255 - c[0]) * dim; d[i * 4 + 1] = 255 - (255 - c[1]) * dim; d[i * 4 + 2] = 255 - (255 - c[2]) * dim; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }

  // Every frame: tiles plus the outline of what the camera sees.
  drawView() {
    if (!this.visible) return;
    const cv = this.canvas, map = this.game.state.map, r = this.game.renderer;
    const size = cv.clientWidth || 150, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(size * dpr)) { cv.width = cv.height = Math.round(size * dpr); }
    const ctx = cv.getContext('2d'), s = cv.width / Math.max(map.width, map.height);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(this.base, 0, 0, map.width * s, map.height * s);
    const corners = [[0, 0], [r.viewW, 0], [r.viewW, r.viewH], [0, r.viewH]].map(([x, y]) => r.screenToTile(x, y));
    if (corners.some((p) => p.x === -1 && p.y === -1)) {
      // 3D view looking at the horizon: just mark the centre.
      const c = r.viewCenterTile();
      ctx.strokeStyle = '#34404f'; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc((c.x + 0.5) * s, (c.y + 0.5) * s, 4 * dpr, 0, Math.PI * 2); ctx.stroke();
      return;
    }
    ctx.strokeStyle = 'rgba(52,64,79,0.9)'; ctx.lineWidth = 1.5 * dpr; ctx.lineJoin = 'round';
    ctx.beginPath();
    corners.forEach((p, k) => (k ? ctx.lineTo(p.x * s, p.y * s) : ctx.moveTo(p.x * s, p.y * s)));
    ctx.closePath();
    ctx.stroke();
  }
}
