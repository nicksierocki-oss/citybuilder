// Transit lines panel (DOM). Lines are planned automatically from the bus stops (transit.js);
// here the player sees each route, how busy it is, and can upgrade it to trams.

import { CONFIG } from './config.js';
import { lineCost, lineCapacity, layTramTrack, removeTramTrack, tramTrackNeeded } from './transit.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class LinesUI {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.selected = null; // stops key of the open line (ids change when lines are re-planned)
    this.html = null;
    $('lineList').addEventListener('click', (e) => {
      const row = e.target.closest('[data-line]');
      if (!row) return;
      const line = this.lineByKey(row.dataset.line), act = e.target.closest('[data-act]')?.dataset.act;
      if (!line) return;
      if (act === 'tram') { this.upgrade(line); return; }
      if (act === 'untram') {
        this.ui.confirm(`Take up the tram track on ${line.name}?`, 'The line goes back to buses. The track is removed for free (no refund).', 'Remove track', () => {
          removeTramTrack(this.game.state, line);
          this.changed();
        });
        return;
      }
      if (act === 'show') { const [x, y] = this.center(line); this.game.renderer.centerOn(this.game.state.map, x, y); return; }
      if (e.target.closest('.leditor')) return;
      this.selected = this.selected === row.dataset.line ? null : row.dataset.line;
      this.render();
    });
    this.render();
  }

  key(line) { return line.stops.join('-'); }
  lineByKey(k) { return (this.game.state.lines ?? []).find((l) => this.key(l) === k); }
  center(line) {
    const w = this.game.state.map.width, n = line.stops.length;
    return [line.stops.reduce((a, i) => a + (i % w), 0) / n, line.stops.reduce((a, i) => a + ((i / w) | 0), 0) / n];
  }

  upgrade(line) {
    const s = this.game.state, need = tramTrackNeeded(s, line).length, cost = need * CONFIG.transit.modes.tram.trackCost;
    this.ui.confirm(`Upgrade ${line.name} to trams?`, `Lays tram track on ${need} road tile${need === 1 ? '' : 's'} along the route for $${cost.toLocaleString()}. Trams carry more riders and make the street nicer to live on; the track costs a little upkeep.`, 'Lay track', () => {
      if (!layTramTrack(this.game.state, line)) { this.ui.toast('Not enough money for the tram track.', 'bad'); return; }
      this.ui.flashCost(-cost);
      this.changed();
    });
  }

  // After track changes: re-plan routes and refresh the panel.
  changed() {
    this.game.refresh();
    this.ui.lastBudgetHtml = null;
    this.html = null;
    this.render();
  }

  // Called every UI update; only touches the DOM when something shown changed.
  render() {
    const s = this.game.state, box = $('lineList');
    if (!box || !s) return;
    const lines = s.lines ?? [], routes = s.transitRoutes ?? {}, stats = s.lineStats ?? {};
    const html = lines.map((l) => {
      const k = this.key(l), sel = k === this.selected, r = routes[l.id], st = stats[l.id];
      const vehicles = l.mode === 'tram' ? (l.freq === 1 ? 'tram' : 'trams') : (l.freq === 1 ? 'bus' : 'buses');
      const status = r?.broken ? r.reason : `${st?.riders ?? 0}/${Math.round(lineCapacity(s, l))} riders`;
      const need = sel && l.mode !== 'tram' && r?.ok ? tramTrackNeeded(s, l).length : 0;
      return `<div class="district tline${sel ? ' sel' : ''}" data-line="${k}">
        <div class="dhead"><i style="background:${l.color}"></i><b>${esc(l.name)}</b><small class="${r?.broken ? 'bad' : ''}">${l.stops.length} stops · ${l.mode === 'tram' ? 'Tram' : 'Bus'} · ${status}</small></div>
        ${sel ? `<div class="leditor deditor">
          <div class="lrow">${l.freq} ${vehicles} running (set by demand)<small>$${Math.round(lineCost(s, l))}/mo</small></div>
          <div class="dbtns">
            <button data-act="show">Show</button>
            ${l.mode === 'tram'
              ? '<button data-act="untram" class="danger">Back to buses</button>'
              : `<button data-act="tram" ${r?.ok ? '' : 'disabled'}>Upgrade to tram · $${(need * CONFIG.transit.modes.tram.trackCost).toLocaleString()}</button>`}
          </div>
        </div>` : ''}
      </div>`;
    }).join('') || '<p class="muted small">Place bus stops near homes and near jobs on the same roads: routes link them up automatically. Riders board near home and ride to stops near work.</p>';
    if (html === this.html) return;
    this.html = html;
    box.innerHTML = html;
  }
}
