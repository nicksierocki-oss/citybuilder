// @ts-check
// Input: mouse painting, panning, zooming and keyboard shortcuts.

import { TOOLS, applyTool, previewCost, expandSelection } from './economy.js';
import { refreshFields } from './simulation.js';
import { OVERLAY_ORDER } from './overlays.js';
import { footprintSize } from './map.js';

const PAN_KEYS = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1],
};

// Tiles covered by a drag for the given tool shape. `size` is a landmark's [w, h] footprint.
export function tilesForDrag(map, shape, a, b, size = [1, 1]) {
  const out = [];
  const clampX = (v) => Math.max(0, Math.min(map.width - 1, v));
  const clampY = (v) => Math.max(0, Math.min(map.height - 1, v));
  if (shape === 'single') return [map.idx(clampX(b.x), clampY(b.y))];
  if (shape === 'footprint') {
    // Centred on the cursor, row by row from the top-left (the anchor). Off-map tiles are
    // dropped, which makes the placement invalid.
    const [w, h] = size, ax = b.x - Math.floor((w - 1) / 2), ay = b.y - Math.floor((h - 1) / 2);
    for (let y = ay; y < ay + h; y++) for (let x = ax; x < ax + w; x++) if (map.inBounds(x, y)) out.push(map.idx(x, y));
    return out;
  }
  if (shape === 'circle') {
    // Disc around the drag start, radius = drag length.
    const r = Math.hypot(b.x - a.x, b.y - a.y);
    for (let y = Math.floor(a.y - r); y <= Math.ceil(a.y + r); y++) for (let x = Math.floor(a.x - r); x <= Math.ceil(a.x + r); x++) {
      if (map.inBounds(x, y) && Math.hypot(x - a.x, y - a.y) <= r + 0.35) out.push(map.idx(x, y));
    }
    return out;
  }
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
  constructor(game, canvases) {
    this.game = game;
    this.canvases = canvases;
    this.keys = new Set();
    this.drag = null;   // { start: {x,y}, end: {x,y} }
    this.pan = null;    // { sx, sy, lx, ly, moved, orbit }
    this.bind();
  }

  get renderer() { return this.game.renderer; }

  get canvas() { return this.renderer.canvas; }

  localPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  bind() {
    for (const c of this.canvases) {
      c.addEventListener('contextmenu', (e) => e.preventDefault());
      c.addEventListener('pointerdown', (e) => this.onDown(e));
      c.addEventListener('pointermove', (e) => this.onMove(e));
      c.addEventListener('pointerleave', () => { if (!this.drag) this.game.hover = null; });
      c.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (e.shiftKey) {
          // Shift + wheel/trackpad scroll pans (browsers may report it as horizontal scroll).
          const dx = e.deltaX || 0, dy = e.deltaX && !e.deltaY ? 0 : e.deltaY;
          this.renderer.panBy(this.game.state.map, -dx, -dy);
          return;
        }
        const p = this.localPos(e);
        this.renderer.zoomAt(this.game.state.map, p.x, p.y, Math.exp(-e.deltaY * 0.0015));
      }, { passive: false });
    }
    window.addEventListener('pointerup', () => this.onUp());
    // A cancelled pointer (touch interrupted, capture lost) must not leave a drag or pan stuck.
    window.addEventListener('pointercancel', () => { this.drag = null; this.pan = null; this.game.preview = null; });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      if (e.key === 'Shift') document.body.classList.remove('shift-pan');
    });
    window.addEventListener('blur', () => { this.keys.clear(); document.body.classList.remove('shift-pan'); });
  }

  onDown(e) {
    const p = this.localPos(e);
    const tool = this.game.tool;
    this.canvas.setPointerCapture?.(e.pointerId);
    const shiftPan = e.shiftKey && (e.button === 0 || e.button === 2);
    if (shiftPan || e.button === 1 || e.button === 2 || (e.button === 0 && tool === 'inspect')) {
      // Shift + drag always pans. Otherwise right-drag orbits in 3D; everything else pans.
      const orbit = !shiftPan && e.button === 2 && !!this.renderer.rotateBy;
      this.pan = { sx: p.x, sy: p.y, lx: p.x, ly: p.y, moved: false, orbit };
      return;
    }
    if (e.button !== 0) return;
    const t = this.renderer.screenToTile(p.x, p.y);
    // Clicking beside the map must not build on the nearest edge tile.
    if (!this.game.state.map.inBounds(t.x, t.y)) return;
    this.drag = { start: t, end: t };
    this.updatePreview();
  }

  // Landmarks show where they'd go while hovering, before any click.
  hoverPreview() {
    const g = this.game;
    if (this.drag || this.pan || !TOOLS[g.tool]?.footprint) return;
    if (!g.hover || !g.state.map.inBounds(g.hover.x, g.hover.y)) { g.preview = null; return; }
    this.drag = { start: g.hover, end: g.hover };
    this.updatePreview();
    this.drag = null;
  }

  onMove(e) {
    const p = this.localPos(e);
    const t = this.renderer.screenToTile(p.x, p.y);
    this.game.hover = t;
    if (this.pan) {
      if (Math.abs(p.x - this.pan.sx) + Math.abs(p.y - this.pan.sy) > 3) this.pan.moved = true;
      const dx = p.x - this.pan.lx, dy = p.y - this.pan.ly;
      this.pan.lx = p.x; this.pan.ly = p.y;
      if (this.pan.orbit) this.renderer.rotateBy(dx, dy);
      else this.renderer.panBy(this.game.state.map, dx, dy);
    } else if (this.drag) {
      this.drag.end = t;
      this.updatePreview();
    } else this.hoverPreview();
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
    const { applied, spent, undo } = applyTool(state, this.game.tool, tiles, this.game.toolArg);
    if (applied) {
      this.game.pushUndo(undo);
      refreshFields(state);
      this.game.ui.flashCost(-spent);
    }
    this.hoverPreview();
  }

  updatePreview() {
    const g = this.game, map = g.state.map, tool = g.tool, def = TOOLS[tool];
    // Zone-style tools can paint with a line or circle brush instead of a rectangle.
    const shape = def.shape === 'rect' && g.brush !== 'rect' ? g.brush : def.shape;
    const tiles = tilesForDrag(map, shape, this.drag.start, this.drag.end, def.footprint ? footprintSize(def.building) : undefined);
    const cost = previewCost(g.state, tool, tiles, g.toolArg);
    g.preview = {
      tiles: new Set(expandSelection(map, tool, tiles)), // bulldozing part of a landmark shows all of it
      ok: cost.count > 0 && (tool === 'bulldoze' || cost.total <= g.state.funds),
      cost,
    };
  }

  onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') { e.preventDefault(); this.game.undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Shift') { document.body.classList.add('shift-pan'); return; }
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
      case 't': g.toggleOverlay('traffic'); break;
      case 'h': g.toggleOverlay('happiness'); break;
      case 'c': g.toggleOverlay('crime'); break;
      case 'm': g.toggleOverlay('transit'); break;
      case 'f': g.toggleOverlay('fireRisk'); break;
      case 'o': {
        const i = OVERLAY_ORDER.indexOf(g.renderer.overlay);
        const next = OVERLAY_ORDER[i + 1] ?? null; // cycles through every overlay, then off
        if (next) g.toggleOverlay(next); else if (g.renderer.overlay) g.toggleOverlay(g.renderer.overlay);
        break;
      }
      case 'v': g.toggle3D(); break;
      case 'b': g.cycleBrush(); break;
      case 'g': g.ui.toggleGraphs(); break;
      case 'n': g.toggleOverlay('education'); break;
      case 'q': this.renderer.rotateBy?.(-40, 0); break;
      case 'e': this.renderer.rotateBy?.(40, 0); break;
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
    const speed = 700; // screen pixels per second
    this.renderer.panBy(this.game.state.map, -dx * speed * dt, -dy * speed * dt);
  }
}
