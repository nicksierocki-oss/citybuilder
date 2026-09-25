// Entry point: wires state, simulation clock, renderer, input and UI together.

import { CONFIG } from './config.js';
import { createGame, tick } from './simulation.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { downloadSave, readSaveFile, autosave, loadAutosave, clearAutosave } from './save.js';

const canvas = document.getElementById('game');

const game = {
  state: null,
  tool: 'road',
  speed: 1,           // 0 = paused
  hover: null,
  pinned: null,
  preview: null,
  renderer: new Renderer(canvas),
  ui: null,
  input: null,

  setTool(name) { this.tool = name; this.preview = null; this.ui.setActiveTool(name); },
  setSpeed(s) { this.speed = s; if (s > 0) this.lastSpeed = s; this.ui.setActiveSpeed(s); },
  togglePause() { this.setSpeed(this.speed === 0 ? (this.lastSpeed || 1) : 0); },
  toggleOverlay(o) {
    this.renderer.overlay = this.renderer.overlay === o ? null : o;
    this.ui.setOverlay(this.renderer.overlay);
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
    this.renderer.cam.zoom = 1.25;
    this.renderer.centerOn(state.map, CONFIG.map.highwayLength + 4, H);
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

game.ui = new UI(game);
game.input = new Input(game, canvas);

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

window.addEventListener('resize', () => { game.renderer.resize(); game.renderer.clampCamera(game.state.map); });

// Fixed-timestep simulation, decoupled from the render frame rate.
let last = performance.now(), acc = 0, lastAutosaveYear = null;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  game.input.update(dt);
  if (game.speed > 0 && !game.state.bankrupt) game.renderer.time += dt * (0.6 + 0.4 * game.speed);
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
