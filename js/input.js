// Input: mouse painting, panning, zooming and keyboard shortcuts.

import { TOOLS, applyTool, previewCost } from './economy.js';
import { refreshFields } from './simulation.js';

const PAN_KEYS = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1],
};

// Tiles covered by a drag for the given tool shape.
export function tilesForDrag(map, shape, a, b) {
  const out = [];
  const clampX = (v) => Math.max(0, Math.min(map.width - 1, v));
  const clampY = (v) => Math.max(0, Math.min(map.height - 1, v));
  if (shape === 'line') {
    // L-shaped: along the longer axis first, then the other.
    const ax = clampX(a.x), ay = clampY(a.y), bx = clampX(b.x), by = clampY(b.y);
    const horizFirst = Math.abs(bx - ax) >= Math.abs(by - ay);
    const cx = horizFirst ? bx : ax, cy = horizFirst ? ay : by;
    const seg = (x0, y0, x1, y1) => {
      const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
      let x = x0, y = y0;
      out.push(map.idx(x, y));
      while (x !== x1 || y !== y1) { x += dx; y += dy; out.push(map.idx(x, y)); }
    };
    seg(ax, ay, cx, cy);
    seg(cx, cy, bx, by);
    return [...new Set(out)];
  }
  const x0 = clampX(Math.min(a.x, b.x)), x1 = clampX(Math.max(a.x, b.x));
  const y0 = clampY(Math.min(a.y, b.y)), y1 = clampY(Math.max(a.y, b.y));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(map.idx(x, y));
  return out;
}

export class Input {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.keys = new Set();
    this.drag = null;   // { start: {x,y}, end: {x,y} }
    this.pan = null;    // { sx, sy, cx, cy }
    this.bind();
  }

  get renderer() { return this.game.renderer; }

  localPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointerleave', () => { if (!this.drag) this.game.hover = null; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = this.localPos(e);
      this.renderer.zoomAt(this.game.state.map, p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
    window.addEventListener('blur', () => this.keys.clear());
  }

  onDown(e) {
    const p = this.localPos(e);
    const tool = this.game.tool;
    this.canvas.setPointerCapture?.(e.pointerId);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && tool === 'inspect')) {
      this.pan = { sx: p.x, sy: p.y, cx: this.renderer.cam.x, cy: this.renderer.cam.y, moved: false };
      return;
    }
    if (e.button !== 0) return;
    const t = this.renderer.screenToTile(p.x, p.y);
    this.drag = { start: t, end: t };
    this.updatePreview();
  }

  onMove(e) {
    const p = this.localPos(e);
    const t = this.renderer.screenToTile(p.x, p.y);
    this.game.hover = t;
    if (this.pan) {
      const z = this.renderer.cam.zoom;
      if (Math.abs(p.x - this.pan.sx) + Math.abs(p.y - this.pan.sy) > 3) this.pan.moved = true;
      this.renderer.cam.x = this.pan.cx - (p.x - this.pan.sx) / z;
      this.renderer.cam.y = this.pan.cy - (p.y - this.pan.sy) / z;
      this.renderer.clampCamera(this.game.state.map);
    } else if (this.drag) {
      this.drag.end = t;
      this.updatePreview();
    }
  }

  onUp() {
    if (this.pan) {
      // A click (no movement) with the inspect tool pins the tile info.
      if (!this.pan.moved && this.game.tool === 'inspect' && this.game.hover) this.game.pinned = { ...this.game.hover };
      this.pan = null;
      return;
    }
    if (!this.drag) return;
    const state = this.game.state;
    const tiles = this.game.preview ? [...this.game.preview.tiles] : [];
    this.drag = null;
    this.game.preview = null;
    if (!tiles.length) return;
    const { applied, spent } = applyTool(state, this.game.tool, tiles);
    if (applied) {
      refreshFields(state);
      this.game.ui.flashCost(-spent);
    }
  }

  updatePreview() {
    const map = this.game.state.map, tool = this.game.tool;
    const shape = TOOLS[tool].shape;
    const tiles = tilesForDrag(map, shape, this.drag.start, this.drag.end);
    const cost = previewCost(this.game.state, tool, tiles);
    this.game.preview = {
      tiles: new Set(tiles),
      ok: cost.count > 0 && cost.total <= this.game.state.funds,
      cost,
    };
  }

  onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (PAN_KEYS[k]) { this.keys.add(k); e.preventDefault(); return; }
    const g = this.game;
    for (const [name, def] of Object.entries(TOOLS)) {
      if (def.key === k) { g.setTool(name); return; }
    }
    switch (k) {
      case 'Escape': this.drag = null; g.preview = null; g.pinned = null; g.setTool('inspect'); break;
      case ' ': e.preventDefault(); g.togglePause(); break;
      case 'l': g.toggleOverlay('landValue'); break;
      case 'p': g.toggleOverlay('pollution'); break;
      case '=': case '+': this.renderer.zoomAt(g.state.map, this.renderer.viewW / 2, this.renderer.viewH / 2, 1.2); break;
      case '-': case '_': this.renderer.zoomAt(g.state.map, this.renderer.viewW / 2, this.renderer.viewH / 2, 1 / 1.2); break;
      case '.': case '>': g.setSpeed(Math.min(3, g.speed + 1)); break;
      case ',': case '<': g.setSpeed(Math.max(0, g.speed - 1)); break;
      default: break;
    }
  }

  // Called every frame for smooth keyboard panning.
  update(dt) {
    let dx = 0, dy = 0;
    for (const k of this.keys) { dx += PAN_KEYS[k][0]; dy += PAN_KEYS[k][1]; }
    if (!dx && !dy) return;
    const speed = 700 / this.renderer.cam.zoom; // world units per second
    this.renderer.cam.x += dx * speed * dt;
    this.renderer.cam.y += dy * speed * dt;
    this.renderer.clampCamera(this.game.state.map);
  }
}
