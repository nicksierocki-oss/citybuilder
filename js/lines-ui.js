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
      const go = e.target.closest('[data-tx]');
      if (go) {
        const g = this.game, x = Number(go.dataset.tx), y = Number(go.dataset.ty);
        g.renderer.centerOn(g.state.map, x, y);
        g.pinned = { x, y };
        return;
      }
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
    const lines = s.lines ?? [], routes = s.transitRoutes ?? {}, stats = s.lineStats ?? {}, ts = s.transitStats ?? {}, w = s.map.width;
    const num = (v) => Math.round(v ?? 0).toLocaleString();
    const rows = lines.map((l) => {
      const k = this.key(l), sel = k === this.selected, r = routes[l.id], st = stats[l.id];
      const vehicles = l.mode === 'tram' ? (l.freq === 1 ? 'tram' : 'trams') : (l.freq === 1 ? 'bus' : 'buses');
      const [cls, why] = lineStatus(l, r, st);
      const cap = Math.round(lineCapacity(s, l)), full = st && cap ? Math.round(st.riders / cap * 100) : 0;
      const need = sel && l.mode !== 'tram' && r?.ok ? tramTrackNeeded(s, l).length : 0;
      const cost = lineCost(s, l);
      return `<div class="district tline${sel ? ' sel' : ''}" data-line="${k}">
        <div class="dhead"><i style="background:${l.color}"></i><b>${esc(l.name)}</b><span class="mode ${l.mode}">${l.mode === 'tram' ? 'Tram' : 'Bus'}</span></div>
        <div class="lstat"><b>${r?.broken ? '—' : num(st?.riders)}</b> riders/mo <small>${l.stops.length} stops · ${r?.broken ? 'not running' : `${full}% full`}</small></div>
        ${why ? `<div class="lwhy ${cls}">${esc(why)}</div>` : ''}
        ${sel ? `<div class="leditor deditor">
          <table class="ldetail">
            <tr><td>Runs</td><td>${l.homeStops ? `${l.homeStops} stop${l.homeStops > 1 ? 's' : ''} among homes, then ${l.stops.length - l.homeStops} among jobs, and back` : 'between stops among homes and jobs, and back'}</td></tr>
            <tr><td>Vehicles</td><td>${l.freq} ${vehicles} (set by demand) · carries up to ${cap.toLocaleString()}/mo</td></tr>
            ${st ? `<tr><td>Catchment</td><td>${num(st.workers)} workers live near its stops · ${num(st.jobs)} jobs near them</td></tr>
            <tr><td>End to end</td><td>${st.ride} min door to door (riders give up over ${CONFIG.traffic.maxCommute})</td></tr>` : ''}
            <tr><td>Cost</td><td>$${Math.round(cost).toLocaleString()}/mo${st?.riders ? ` · $${(cost / st.riders).toFixed(2)} per rider` : ''}</td></tr>
          </table>
          <div class="dbtns">
            <button data-act="show">Show</button>
            ${l.mode === 'tram'
              ? '<button data-act="untram" class="danger">Back to buses</button>'
              : `<button data-act="tram" ${r?.ok ? '' : 'disabled'}>Upgrade to tram · $${(need * CONFIG.transit.modes.tram.trackCost).toLocaleString()}</button>`}
          </div>
        </div>` : ''}
      </div>`;
    });
    if (ts.metroStations) rows.push(`<div class="district tline"><div class="dhead"><i style="background:#b38fd6"></i><b>Metro network</b><span class="mode metro">Metro</span></div>
      <div class="lstat"><b>${num(ts.metro)}</b> riders/mo <small>${ts.metroStations} station${ts.metroStations > 1 ? 's' : ''} · ${ts.metroCapacity ? Math.round(ts.metro / ts.metroCapacity * 100) : 0}% full</small></div>
      ${ts.metroStations < 2 ? '<div class="lwhy bad">One station goes nowhere: build a second near jobs or homes</div>' : !ts.metro ? '<div class="lwhy warn">No riders: stations need homes near one and jobs near another</div>' : ''}</div>`);
    if (ts.railStations) rows.push(`<div class="district tline"><div class="dhead"><i style="background:#c98f6a"></i><b>Railway</b><span class="mode rail">Train</span></div>
      <div class="lstat"><b>${num(ts.rail)}</b> riders/mo <small>${ts.railStations} station${ts.railStations > 1 ? 's' : ''}${ts.railLinks ? ` · ${num(ts.regional)} to the region` : ''}</small></div>
      ${ts.railStations < 2 && !ts.railLinks ? '<div class="lwhy bad">A lone station goes nowhere: add another on the same track, or run the track to the map edge</div>' : ''}</div>`);
    const lost = s.unroutedStops ?? [];
    if (lost.length) rows.push(`<div class="lost"><b>${lost.length} stop${lost.length > 1 ? 's' : ''} on no route</b>${lost.slice(0, 8).map((u) => `<div class="golink" data-tx="${u.i % w}" data-ty="${(u.i / w) | 0}" title="Show on the map">📍 ${u.i % w}, ${(u.i / w) | 0}: ${esc(u.why)}</div>`).join('')}</div>`);
    const total = (ts.bus ?? 0) + (ts.tram ?? 0) + (ts.metro ?? 0) + (ts.rail ?? 0), emp = s.traffic?.employed ?? 0;
    const head = total ? `<div class="tsum">${num(total)} riders/mo · ${emp ? Math.round(total / emp * 100) : 0}% of commuters<br><small>${[['Bus', ts.bus], ['Tram', ts.tram], ['Metro', ts.metro], ['Train', ts.rail]].filter(([, v]) => v).map(([n, v]) => `${n} ${num(v)}`).join(' · ')}</small></div>` : '';
    const html = rows.length ? head + rows.join('') : '<p class="muted small">Place bus stops near homes and near jobs on the same roads: routes link them up automatically, always from homes to jobs. Riders board near home and ride to stops near work.</p>';
    if (html === this.html) return;
    this.html = html;
    box.innerHTML = html;
  }
}

// [class, text] saying why a line isn't doing well, or ['', ''] when it is.
function lineStatus(line, route, st) {
  if (route?.broken) return ['bad', `Not running: ${route.reason}`];
  if (!st) return ['', ''];
  if (st.riders >= st.capacity * 0.95) return ['warn', line.freq >= CONFIG.transit.maxFreq && line.mode !== 'tram' ? 'Full: upgrade it to trams to carry more' : 'Full: more vehicles are added as demand grows'];
  if (st.riders >= 1) return ['', ''];
  if (!st.workers) return ['bad', 'No riders: nobody lives near its stops yet'];
  if (!st.jobs) return ['bad', 'No riders: no jobs near its stops yet'];
  if (st.ride > CONFIG.traffic.maxCommute) return ['bad', `No riders: the trip takes ${st.ride} min, over the ${CONFIG.traffic.maxCommute}-min limit. Use stops closer together`];
  return ['warn', 'No riders yet: the jobs near its stops are taken by people who drive. Zone more jobs there'];
}
