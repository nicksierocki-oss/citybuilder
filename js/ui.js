// UI: top bar, toolbar, RCI meter, tile info, toasts and dialogs (DOM only).

import { CONFIG } from './config.js';
import { TOOLS, monthlyBudget } from './economy.js';
import { TILE, TERRAIN, FLAG, ZONE_NAMES, isZone } from './map.js';
import { evaluateTile, levelName } from './simulation.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TOOL_SWATCH = {
  inspect: '#9aa4b2', road: '#5c6370', residential: '#6fbf5a', commercial: '#4f8fd6',
  industrial: '#d9a93f', park: '#86c870', bulldoze: '#d9674f',
};
const TOOL_ICON = { inspect: '✋', road: '▦', residential: 'R', commercial: 'C', industrial: 'I', park: '♣', bulldoze: '✕' };

const $ = (id) => document.getElementById(id);
const money = (v) => (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString();

export class UI {
  constructor(game) {
    this.game = game;
    this.lastUpdate = 0;
    this.buildToolbar();
    this.bindTopBar();
  }

  buildToolbar() {
    const box = $('tools');
    for (const [name, def] of Object.entries(TOOLS)) {
      const b = document.createElement('button');
      b.className = 'tool';
      b.dataset.tool = name;
      const cost = CONFIG.costs[name];
      b.innerHTML = `<span class="swatch" style="background:${TOOL_SWATCH[name]}">${TOOL_ICON[name]}</span>
        <span class="tlabel">${def.label}</span>
        <span class="tmeta"><kbd>${def.key}</kbd>${cost ? ` $${cost}` : ''}</span>`;
      b.title = `${def.label} (${def.key})`;
      b.addEventListener('click', () => this.game.setTool(name));
      box.appendChild(b);
    }
    for (const btn of document.querySelectorAll('[data-overlay]')) {
      btn.addEventListener('click', () => this.game.toggleOverlay(btn.dataset.overlay));
    }
  }

  bindTopBar() {
    for (const btn of document.querySelectorAll('[data-speed]')) {
      btn.addEventListener('click', () => this.game.setSpeed(Number(btn.dataset.speed)));
    }
    $('taxDown').addEventListener('click', () => this.game.setTax(this.game.state.taxRate - 1));
    $('taxUp').addEventListener('click', () => this.game.setTax(this.game.state.taxRate + 1));
    $('btnSave').addEventListener('click', () => this.game.save());
    $('btnLoad').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) this.game.load(f);
      e.target.value = '';
    });
    $('btnNew').addEventListener('click', () => {
      this.confirm('Start a new city?', 'Your current city will be lost unless you save it first.', 'New city', () => this.game.newCity());
    });
    $('budgetStat').addEventListener('click', () => $('budget').classList.toggle('open'));
    $('helpBtn').addEventListener('click', () => $('help').classList.toggle('open'));
    $('helpClose').addEventListener('click', () => $('help').classList.remove('open'));
  }

  setActiveTool(name) {
    for (const b of document.querySelectorAll('.tool')) b.classList.toggle('active', b.dataset.tool === name);
    document.body.dataset.tool = name;
  }
  setActiveSpeed(s) {
    for (const b of document.querySelectorAll('[data-speed]')) b.classList.toggle('active', Number(b.dataset.speed) === s);
  }
  setOverlay(o) {
    for (const b of document.querySelectorAll('[data-overlay]')) b.classList.toggle('active', b.dataset.overlay === o);
    const lg = $('legend');
    lg.hidden = !o;
    if (o === 'landValue') lg.innerHTML = '<b>Land value</b><div class="ramp lv"></div><div class="rampl"><span>0</span><span>50</span><span>100</span></div>';
    if (o === 'pollution') lg.innerHTML = '<b>Pollution</b><div class="ramp pol"></div><div class="rampl"><span>clean</span><span>heavy</span></div>';
  }

  // Throttled per-frame refresh of numbers.
  update(now) {
    this.drainEvents();
    this.updateCostTip();
    if (now - this.lastUpdate < 120) return;
    this.lastUpdate = now;
    const s = this.game.state, st = s.stats;
    $('funds').textContent = money(s.funds);
    $('funds').classList.toggle('neg', s.funds < 0);
    const lm = s.lastMonth;
    const net = $('net');
    if (lm) {
      net.textContent = (lm.net >= 0 ? '+' : '') + money(lm.net);
      net.className = lm.net >= 0 ? 'pos' : 'neg';
      $('netDetail').textContent = `${money(lm.income)} in · ${money(lm.expenses)} out`;
    } else {
      const b = monthlyBudget(s);
      net.textContent = '—';
      net.className = '';
      $('netDetail').textContent = `est. ${money(b.totalIncome - b.totalExpenses)}/mo`;
    }
    $('pop').textContent = st.population.toLocaleString();
    $('jobs').textContent = `${st.jobs.toLocaleString()} jobs`;
    $('date').textContent = `${MONTHS[s.month]} ${s.year}`;
    $('tax').textContent = `${s.taxRate}%`;
    this.updateRCI();
    this.updateBudget();
    this.updateInfo();
  }

  updateRCI() {
    const d = this.game.state.demand;
    for (const k of ['r', 'c', 'i']) {
      const bar = $(`rci-${k}`);
      const v = Math.max(-1, Math.min(1, d[k]));
      bar.style.height = `${Math.abs(v) * 50}%`;
      bar.style.top = v >= 0 ? `${50 - v * 50}%` : '50%';
      bar.classList.toggle('neg', v < 0);
    }
  }

  updateBudget() {
    const el = $('budget');
    if (!el.classList.contains('open')) return;
    const s = this.game.state, b = monthlyBudget(s);
    const row = (k, v, cls = '') => `<tr class="${cls}"><td>${k}</td><td>${money(v)}</td></tr>`;
    el.innerHTML = `<h3>Monthly budget <small>(projected at ${s.taxRate}% tax)</small></h3><table>
      ${row('Residential tax', b.income.residential)}
      ${row('Commercial tax', b.income.commercial)}
      ${row('Industrial tax', b.income.industrial)}
      ${row('Road upkeep', -b.expenses.roads)}
      ${row('Bridge upkeep', -b.expenses.bridges)}
      ${row('Park upkeep', -b.expenses.parks)}
      ${row('Net', b.totalIncome - b.totalExpenses, 'total')}
    </table>
    <p class="muted">${s.stats.roads} road · ${s.stats.bridges} bridge · ${s.stats.parks} park tiles.
    Workers ${Math.round(s.stats.workers)} / jobs ${s.stats.jobs}.</p>`;
  }

  updateInfo() {
    const g = this.game, el = $('info');
    const t = g.pinned ?? g.hover;
    const map = g.state.map;
    if (!t || !map.inBounds(t.x, t.y)) { el.hidden = true; return; }
    el.hidden = false;
    const i = map.idx(t.x, t.y);
    const type = map.type[i], lv = map.level[i];
    const water = map.terrain[i] === TERRAIN.WATER;
    const ab = map.hasFlag(i, FLAG.ABANDONED);
    let title = ZONE_NAMES[type];
    if (type === TILE.EMPTY) title = water ? 'Water' : map.hasFlag(i, FLAG.TREES) ? 'Woodland' : 'Open land';
    if (type === TILE.ROAD && water) title = 'Bridge';
    const rows = [];
    if (isZone(type)) {
      const cap = CONFIG.capacity[['', '', 'residential', 'commercial', 'industrial'][type]][lv];
      rows.push(['Density', ab ? 'Abandoned' : lv === 0 ? 'Vacant lot' : `${levelName(lv)} (${lv}/3)`]);
      if (!ab && lv > 0) rows.push([type === TILE.RES ? 'Residents' : 'Jobs', cap]);
    }
    if (type === TILE.ROAD) rows.push(['Network', map.roadDist[i] >= 0 ? `${map.roadDist[i]} tiles to highway` : 'Not connected!']);
    if (!water) {
      rows.push(['Land value', bar(map.landValue[i], 'lv')]);
      rows.push(['Pollution', bar(map.pollution[i], 'pol')]);
    }
    let notes = [];
    if (isZone(type)) {
      const ev = evaluateTile(g.state, i);
      if (ev.connected && !ab) {
        const trend = lv < ev.maxLevel && ev.score > CONFIG.growth.growThreshold ? '▲ growing'
          : (lv > ev.maxLevel || ev.score < CONFIG.growth.declineThreshold) && lv > 0 ? '▼ declining' : '■ stable';
        rows.push(['Outlook', trend]);
      }
      notes = ev.reasons;
    }
    el.innerHTML = `<div class="ihead"><b>${title}</b><span class="muted">${t.x}, ${t.y}${g.pinned ? ' · pinned (Esc)' : ''}</span></div>
      <table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      ${notes.length ? `<ul class="notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}`;
  }

  updateCostTip() {
    const tip = $('costTip'), p = this.game.preview;
    if (!p) { tip.hidden = true; return; }
    const h = this.game.hover;
    if (!h) return;
    const r = this.game.renderer;
    tip.hidden = false;
    const sx = ((h.x + 1) * 32 - r.cam.x) * r.cam.zoom + 8, sy = ((h.y + 1) * 32 - r.cam.y) * r.cam.zoom + 8;
    tip.style.transform = `translate(${Math.min(sx, r.viewW - 120)}px, ${Math.min(sy, r.viewH - 30)}px)`;
    tip.className = p.ok ? '' : 'bad';
    tip.textContent = p.cost.count ? `${p.cost.count} tile${p.cost.count > 1 ? 's' : ''} · $${p.cost.total.toLocaleString()}` : 'Nothing to build here';
  }

  flashCost(amount) {
    if (amount) this.toast(`${money(amount)}`, 'cost', 900);
  }

  drainEvents() {
    const ev = this.game.state.events;
    while (ev.length) {
      const e = ev.shift();
      this.toast(e.text, e.kind);
      if (this.game.state.bankrupt) this.showBankrupt();
    }
  }

  clearToasts() { $('toasts').replaceChildren(); }

  toast(text, kind = 'info', ms = 3200) {
    const box = $('toasts');
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, ms);
  }

  confirm(title, body, okLabel, onOk) {
    const m = $('modal');
    m.querySelector('h2').textContent = title;
    m.querySelector('p').textContent = body;
    const ok = $('modalOk'), cancel = $('modalCancel');
    ok.textContent = okLabel;
    cancel.hidden = false;
    m.hidden = false;
    const close = () => { m.hidden = true; ok.onclick = cancel.onclick = null; };
    ok.onclick = () => { close(); onOk(); };
    cancel.onclick = close;
  }

  showBankrupt() {
    const s = this.game.state;
    const m = $('modal');
    m.querySelector('h2').textContent = 'Bankrupt!';
    m.querySelector('p').textContent = `After ${CONFIG.economy.bankruptcyMonths} months in debt the council has taken over. `
      + `Your city peaked at ${s.stats.population.toLocaleString()} residents. Load a save or start again.`;
    const ok = $('modalOk'), cancel = $('modalCancel');
    ok.textContent = 'New city';
    cancel.textContent = 'Load save…';
    cancel.hidden = false;
    m.hidden = false;
    ok.onclick = () => { m.hidden = true; cancel.textContent = 'Cancel'; this.game.newCity(); };
    cancel.onclick = () => { m.hidden = true; cancel.textContent = 'Cancel'; $('fileInput').click(); };
  }
}

function bar(v, cls) {
  return `<span class="mbar ${cls}"><i style="width:${Math.round(v)}%"></i></span> ${Math.round(v)}`;
}
