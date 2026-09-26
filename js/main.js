// @ts-check
// Entry point: wires state, simulation clock, renderer, input and UI together.

import { CONFIG } from './config.js';
import { createGame, tick, refreshFields } from './simulation.js';
import { expandMap, highwayEntry } from './map.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { downloadSave, readSaveFile, autosave, loadAutosave, clearAutosave, restoreBackup } from './save.js';
import { undoAction, applyTool } from './economy.js';
import { createScenario, SCENARIOS } from './goals.js';
import { environment } from './seasons.js';
import { startUpdater } from './updater.js';

const canvas = document.getElementById('game');
const canvas3d = document.getElementById('game3d');
const VIEW_KEY = 'gridline.view';
const DAYNIGHT_KEY = 'gridline.daynight';
const SEASONS_KEY = 'gridline.seasons';
const BRUSHES = ['rect', 'line', 'circle'];
const UNDO_DEPTH = 20;
const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };

const game = {
  state: null,
  tool: 'road',
  toolArg: 0,         // district id for the district brush
  brush: 'rect',      // how rectangle tools paint: rect | line | circle
  dayNight: pref(DAYNIGHT_KEY, '1') === '1',
  seasons: pref(SEASONS_KEY, '1') === '1',
  undoStack: [],      // undo records of recent build actions, newest last
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

  setTool(name, arg = this.toolArg) {
    this.tool = name;
    this.toolArg = arg;
    this.preview = null;
    this.ui.setActiveTool(name);
    this.input?.hoverPreview();
  },
  cycleBrush() { this.setBrush(BRUSHES[(BRUSHES.indexOf(this.brush) + 1) % BRUSHES.length]); },
  setBrush(b) { this.brush = b; this.ui.setBrush(b); },
  refresh() { refreshFields(this.state); },
  setDayNight(on) {
    this.dayNight = on;
    try { localStorage.setItem(DAYNIGHT_KEY, on ? '1' : '0'); } catch { /* ignore */ }
    this.ui.toast(on ? 'Day and night cycle on.' : 'Always daytime.', 'info', 1800);
    this.ui.updateMenuLabels();
  },
  setSeasons(on) {
    this.seasons = on;
    try { localStorage.setItem(SEASONS_KEY, on ? '1' : '0'); } catch { /* ignore */ }
    this.ui.toast(on ? 'Seasons on: the city changes colour through the year.' : 'Seasons off: always summer colours.', 'info', 1800);
    this.ui.updateMenuLabels();
  },
  pushUndo(record) {
    if (!record) return;
    this.undoStack.push(record);
    if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
  },
  undo() {
    const u = this.undoStack;
    while (u.length && u[u.length - 1].map !== this.state.map) u.pop(); // the map was expanded since
    const last = u[u.length - 1];
    if (!last) { this.ui.toast('Nothing to undo', 'info', 1200); return; }
    if (this.state.bankrupt) { this.ui.toast('Cannot undo after bankruptcy', 'bad', 1800); return; }
    const spent = last.spent;
    // Undoing a demolition takes its refund back: only if the city can pay it.
    if (spent < 0 && this.state.funds < -spent) { this.ui.toast(`Undo needs $${Math.round(-spent).toLocaleString()} to take the refund back`, 'bad', 2500); return; }
    u.pop();
    if (undoAction(this.state, last)) {
      refreshFields(this.state);
      this.ui.toast(`Undone${spent > 0 ? `: ${'$' + Math.round(spent).toLocaleString()} back` : spent < 0 ? `: refund of $${Math.round(-spent).toLocaleString()} returned` : ''}`, 'info', 1800);
    }
  },
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
    this.undoStack = [];
    this.ui.onNewState();
    const entry = highwayEntry(state.map.width, state.map.height);
    this.renderer2d.cam.zoom = 1.25;
    for (const r of [this.renderer2d, this.renderer3d]) if (r) r.centerOn(state.map, entry.length + 4, entry.row);
  },
  // The city being left becomes the previous city (City ▾ → Restore previous city).
  keepPrevious() {
    if (this.state && !this.state.bankrupt) autosave(this.state);
    clearAutosave();
  },
  newCity(size = CONFIG.map.defaultSize) {
    this.keepPrevious();
    this.setState(createGame(undefined, size, this.landform ?? 'plains'));
    this.setSpeed(1);
    this.ui.toast('Welcome! Extend the regional road with streets, then zone next to them.', 'good', 6000);
  },
  expandMap(size) {
    const s = this.state, cost = CONFIG.map.expansionCost[size] ?? 0;
    if (cost > s.funds) { this.ui.toast(`Expanding costs $${cost.toLocaleString()}: not enough funds`, 'bad'); return; }
    const view = this.renderer.viewCenterTile();
    const { map, dx, dy } = expandMap(s.map, size);
    s.funds -= cost;
    // Carry traffic volumes over so routes and congestion don't reset on expansion.
    for (let y = 0; y < s.map.height; y++) for (let x = 0; x < s.map.width; x++) {
      const a = s.map.idx(x, y), b = map.idx(x + dx, y + dy);
      map.traffic[b] = s.map.traffic[a];
    }
    for (const n of s.news ?? []) if (n.tx != null) { n.tx += dx; n.ty += dy; }
    s.map = map;
    refreshFields(s);
    this.undoStack = [];
    this.pinned = null;
    this.preview = null;
    for (const r of [this.renderer2d, this.renderer3d]) if (r) r.centerOn(map, view.x + dx, view.y + dy);
    this.ui.toast(`The city now spans ${size}×${size}. New land on every side!`, 'good', 4500);
    autosave(s);
  },
  newScenario(id) {
    this.keepPrevious();
    this.ui.toast('Setting up the scenario…', 'info', 1200);
    const state = createScenario(id, { createGame, applyTool, tick, refreshFields, highwayEntry });
    this.setState(state);
    this.setSpeed(0);
    this.ui.cityhall.toggle(true);
    this.ui.toast(`${SCENARIOS[id].name}: ${SCENARIOS[id].blurb} Press Space to start.`, 'good', 7000);
  },
  restorePrevious() {
    try {
      this.setState(restoreBackup(this.state));
      this.setSpeed(0);
      this.ui.toast('Previous city restored (paused). The city you were on is now the previous one.', 'good', 6000);
    } catch (err) {
      this.ui.toast(`Could not restore: ${err.message}`, 'bad', 5000);
    }
  },
  save() { downloadSave(this.state); this.ui.toast('City saved to your downloads.', 'good'); },
  async load(file) {
    try {
      const loaded = await readSaveFile(file);
      this.keepPrevious();
      autosave(loaded);
      this.setState(loaded);
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
if (restored?.state && !restored.state.bankrupt) {
  game.setState(restored.state);
  game.setSpeed(0);
  game.ui.toast('Restored your last city (paused). Press Space to resume.', 'info', 5000);
} else {
  game.newCity(); // keeps any previous save as the backup
  if (restored?.error) {
    game.ui.toast(`Your saved city could not be loaded (${restored.error}). It was kept: City ▾ → Restore previous city.`, 'bad', 12000);
  }
}
game.setTool('road');
game.ui.setOverlay(null);
try { if (localStorage.getItem(VIEW_KEY) === '3d') game.setView('3d'); } catch { /* ignore */ }

window.addEventListener('resize', () => { game.renderer.resize(); game.renderer.clampCamera(game.state.map); });
document.getElementById('btnView').addEventListener('click', () => game.toggle3D());

// Fixed-timestep simulation, decoupled from the render frame rate.
let last = performance.now(), acc = 0, lastAutosaveYear = null;
function frame(now) {
  requestAnimationFrame(frame); // schedule first so one bad frame can't stop the game
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  game.input.update(dt);
  if (game.speed > 0 && !game.state.bankrupt) game.animTime += dt * (0.6 + 0.4 * game.speed);
  game.renderer.time = game.animTime;
  game.renderer.env = environment(game.state, game.animTime, game.dayNight, game.seasons);
  if (game.speed > 0 && !game.state.bankrupt) {
    acc += dt * 1000;
    const step = CONFIG.time.msPerTick[game.speed];
    let n = 0;
    try {
      while (acc >= step && n < 8) { tick(game.state); acc -= step; n++; }
    } catch (err) {
      // Keep the city viewable and saveable instead of repeating the error every frame.
      console.error(err);
      game.setSpeed(0);
      game.ui.toast(`Simulation error, game paused: ${err.message}`, 'bad', 8000);
    }
    if (n === 8) acc = 0;
  } else acc = 0;
  if (game.state.month === 0 && game.state.year !== lastAutosaveYear) {
    lastAutosaveYear = game.state.year;
    autosave(game.state);
  }
  game.renderer.render(game.state, game.hover, game.preview);
  game.ui.update(now);
  game.ui.frame();
}
requestAnimationFrame(frame);
const saveOnExit = () => { if (!game.state.bankrupt) autosave(game.state); };
window.addEventListener('beforeunload', saveOnExit);
// Mobile browsers often skip beforeunload when a tab is closed from the switcher.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveOnExit(); });

// Pick up new deploys while the game is open (the city is saved first and restored on reload).
startUpdater(game, { onBeforeReload: saveOnExit });

// Handy for tinkering from the dev console.
/** @type {any} */ (window).gridline = game;
