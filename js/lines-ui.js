// Transit lines panel (DOM): create bus and tram lines, pick the one to extend, set frequency.
// Stops are added on the map with the Bus stop tool while a line is being edited (see input.js).

import { CONFIG } from './config.js';
import { lineColor, lineCost, lineCapacity, layTramTrack } from './transit.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class LinesUI {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    $('btnNewBusLine').addEventListener('click', () => this.newLine('bus'));
    $('btnNewTramLine').addEventListener('click', () => this.newLine('tram'));
    const box = $('lineList');
    box.addEventListener('click', (e) => {
      const row = e.target.closest('[data-line]');
      if (!row) return;
      const id = Number(row.dataset.line), line = this.lineById(id), act = e.target.closest('[data-act]')?.dataset.act;
      if (!line) return;
      if (act === 'freq') { line.freq = Math.max(1, Math.min(CONFIG.transit.maxFreq, line.freq + Number(e.target.closest('[data-act]').dataset.d))); this.ui.lastBudgetHtml = null; this.render(); return; }
      if (act === 'extend') { this.edit(this.game.activeLine === id ? null : id); return; }
      if (act === 'undo') { line.stops.pop(); this.changed(); return; }
      if (act === 'delete') {
        this.ui.confirm(`Delete ${line.name}?`, 'The stops stay; only the line and its vehicles go.', 'Delete', () => {
          const s = this.game.state;
          s.lines = s.lines.filter((l) => l.id !== id);
          if (this.game.activeLine === id) this.edit(null);
          this.changed();
        });
        return;
      }
      if (e.target.closest('.leditor')) return;
      this.selected = this.selected === id ? null : id;
      this.render();
    });
    box.addEventListener('change', (e) => {
      const line = this.lineById(Number(e.target.closest('[data-line]')?.dataset.line));
      if (line && e.target.dataset.field === 'name') { line.name = e.target.value.trim().slice(0, 30) || line.name; this.render(); }
    });
    this.render();
  }

  lineById(id) { return (this.game.state.lines ?? []).find((l) => l.id === id); }

  newLine(mode) {
    const s = this.game.state, lines = s.lines ??= [];
    const id = lines.reduce((m, l) => Math.max(m, l.id), 0) + 1;
    const label = CONFIG.transit.modes[mode].label;
    lines.push({ id, name: `${label} ${lines.filter((l) => l.mode === mode).length + 1}`, color: lineColor(id - 1), mode, stops: [], freq: 2 });
    this.selected = id;
    this.edit(id);
    this.ui.toast(`Click bus stops in order (or empty land beside a road to build one). Esc when done.${mode === 'tram' ? ` Trams lay track along the route: $${CONFIG.transit.modes.tram.trackCost} a tile.` : ''}`, 'info', 5000);
  }

  // Start (id) or stop (null) adding stops to a line.
  edit(id) {
    const g = this.game;
    g.activeLine = id;
    if (id) g.setTool('bus'); else if (g.tool === 'bus') g.setTool('inspect');
    this.render();
  }

  // Called after stops change so routes and the panel refresh.
  changed() {
    const s = this.game.state;
    s.map.version++;
    this.game.refresh();
    for (const line of s.lines ?? []) {
      if (line.mode === 'tram' && !layTramTrack(s, line)) {
        line.stops.pop();
        this.ui.toast('Not enough money for the tram track to that stop.', 'bad');
        this.game.refresh();
      }
    }
    s.map.version++;
    this.ui.lastBudgetHtml = null;
    this.render();
  }

  render() {
    const s = this.game.state, box = $('lineList');
    if (!box || !s) return;
    const lines = s.lines ?? [], routes = s.transitRoutes ?? {}, stats = s.lineStats ?? {};
    box.innerHTML = lines.map((l) => {
      const sel = l.id === this.selected, editing = this.game.activeLine === l.id, r = routes[l.id], st = stats[l.id];
      const status = l.stops.length < 2 ? 'needs 2+ stops' : r?.broken ? 'stops not connected by road' : `${st?.riders ?? 0}/${Math.round(lineCapacity(s, l))} riders`;
      return `<div class="district tline${sel ? ' sel' : ''}${editing ? ' editing' : ''}" data-line="${l.id}">
        <div class="dhead"><i style="background:${l.color}"></i><b>${esc(l.name)}</b><small class="${r?.broken ? 'bad' : ''}">${l.stops.length} stops · ${status}</small></div>
        ${sel ? `<div class="leditor deditor">
          <input data-field="name" value="${esc(l.name)}" maxlength="30" aria-label="Line name">
          <div class="lrow">${l.mode === 'tram' ? 'Trams' : 'Buses'} running
            <span class="fund"><button data-act="freq" data-d="-1" ${l.freq <= 1 ? 'disabled' : ''}>−</button><b>${l.freq}</b><button data-act="freq" data-d="1" ${l.freq >= CONFIG.transit.maxFreq ? 'disabled' : ''}>+</button></span>
            <small>$${Math.round(lineCost(s, l))}/mo</small></div>
          <div class="dbtns">
            <button data-act="extend" class="${editing ? 'on' : ''}">${editing ? 'Done adding' : 'Add stops'}</button>
            <button data-act="undo" ${l.stops.length ? '' : 'disabled'}>Remove last</button>
            <button data-act="delete" class="danger">Delete</button>
          </div>
        </div>` : ''}
      </div>`;
    }).join('') || '<p class="muted small">Draw bus or tram lines through stops. Riders board near home and ride to stops near work.</p>';
  }
}
