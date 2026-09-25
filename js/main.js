// Entry point: wires state, simulation clock, renderer, input and UI together.

import { CONFIG } from './config.js';
import { createGame, tick } from './simulation.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { downloadSave, readSaveFile, autosave, loadAutosave, clearAutosave } from './save.js';

const canvas = document.getElementById('game');
const canvas3d = document.getElementById('game3d');
const VIEW_KEY = 'gridline.view';

const game = {
  state: null,
  tool: 'road',
  speed: 1,           // 0 = paused
  hover: null,
  pinned: null,
  preview: null,
  renderer: null,          // the active view (2D or 3D)
  renderer2d: new Renderer(canvas),
  renderer3d: null,        // created on first switch to 3D (loads Three.js lazily)
  animTime: 0,
  ui: null,
  input: null,

  setTool(name) { this.tool = name; this.preview = null; this.ui.setActiveTool(name); },
  setSpeed(s) { this.speed = s; if (s > 0) this.lastSpeed = s; this.ui.setActiveSpeed(s); },
  togglePause() { this.setSpeed(this.speed === 0 ? (this.lastSpeed || 1) : 0); },
  toggleOverlay(o) {
    const next = this.renderer.overlay === o ? null : o;
    for (const r of [this.renderer2d, this.renderer3d]) if (r) r.overlay = next;
    this.ui.setOverlay(next);
  },
  async toggle3D() {
    if (this.renderer === this.renderer3d) return this.setView('2d');
    return this.setView('3d');
  },
  async setView(view) {
    const from = this.renderer;
    if (view === '3d') {
      if (!this.renderer3d) {
        this.ui.toast('Loading 3D view…', 'info', 1500);
        try {
          const { Renderer3D } = await import('./renderer3d.js');
          canvas3d.hidden = false;
          this.renderer3d = new Renderer3D(canvas3d);
          this.renderer3d.overlay = this.renderer2d.overlay;
        } catch (err) {
          canvas3d.hidden = true;
          this.ui.toast(`3D view unavailable: ${err.message}`, 'bad', 5000);
          return;
        }
      }
      this.renderer = this.renderer3d;
    } else {
      this.renderer = this.renderer2d;
    }
    canvas.hidden = this.renderer !== this.renderer2d;
    canvas3d.hidden = this.renderer !== this.renderer3d;
    this.renderer.resize();
    // Keep looking at the same part of the city.
    if (from && from !== this.renderer) {
      const c = from.viewCenterTile();
      this.renderer.centerOn(this.state.map, c.x, c.y);
    }
    this.hover = null;
    this.ui.setView(view);
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ }
  },
  setTax(v) {
    const E = CONFIG.economy;
    this.state.taxRate = Math.max(E.taxRateMin, Math.min(E.taxRateMax, v));
  },
  setState(state) {
    this.state = state;
    this.ui.clearToasts();
    this.pinned = null;
    this.preview = null;
    const H = CONFIG.map.highwayRow;
    this.renderer2d.cam.zoom = 1.25;
    for (const r of [this.renderer2d, this.renderer3d]) if (r) r.centerOn(state.map, CONFIG.map.highwayLength + 4, H);
  },
  newCity() {
    clearAutosave();
    this.setState(createGame());
    this.setSpeed(1);
    this.ui.toast('Welcome! Extend the highway with roads, then zone next to them.', 'good', 6000);
  },
  save() { downloadSave(this.state); this.ui.toast('City saved to your downloads.', 'good'); },
  async load(file) {
    try {
      this.setState(await readSaveFile(file));
      this.ui.toast('City loaded.', 'good');
      this.setSpeed(0);
    } catch (err) {
      this.ui.toast(`Could not load: ${err.message}`, 'bad', 5000);
    }
  },
};

game.renderer = game.renderer2d;
game.ui = new UI(game);
game.input = new Input(game, [canvas, canvas3d]);

const restored = loadAutosave();
if (restored && !restored.bankrupt) {
  game.setState(restored);
  game.setSpeed(0);
  game.ui.toast('Restored your last city (paused). Press Space to resume.', 'info', 5000);
} else {
  game.newCity();
}
game.setTool('road');
game.ui.setOverlay(null);
try { if (localStorage.getItem(VIEW_KEY) === '3d') game.setView('3d'); } catch { /* ignore */ }

window.addEventListener('resize', () => { game.renderer.resize(); game.renderer.clampCamera(game.state.map); });
document.getElementById('btnView').addEventListener('click', () => game.toggle3D());

// Fixed-timestep simulation, decoupled from the render frame rate.
let last = performance.now(), acc = 0, lastAutosaveYear = null;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  game.input.update(dt);
  if (game.speed > 0 && !game.state.bankrupt) game.animTime += dt * (0.6 + 0.4 * game.speed);
  game.renderer.time = game.animTime;
  if (game.speed > 0 && !game.state.bankrupt) {
    acc += dt * 1000;
    const step = CONFIG.time.msPerTick[game.speed];
    let n = 0;
    while (acc >= step && n < 8) { tick(game.state); acc -= step; n++; }
    if (n === 8) acc = 0;
  } else acc = 0;
  if (game.state.month === 0 && game.state.year !== lastAutosaveYear) {
    lastAutosaveYear = game.state.year;
    autosave(game.state);
  }
  game.renderer.render(game.state, game.hover, game.preview);
  game.ui.update(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.addEventListener('beforeunload', () => { if (!game.state.bankrupt) autosave(game.state); });

// Handy for tinkering from the dev console.
window.gridline = game;
