// UI: top bar, toolbar, demand panel, overlays + legend, tile info, toasts and dialogs (DOM only).

import { CONFIG } from './config.js';
import { TOOLS, monthlyBudget, toolPrice } from './economy.js';
import { TILE, TERRAIN, FLAG, ZONE_NAMES, ROAD_NAMES, KINDS, SUPPLY, isZone } from './map.js';
import { evaluateTile, levelName } from './simulation.js';
import { roadLoad } from './traffic.js';
import { supplyOf, happinessReasons } from './services.js';
import { OVERLAYS, OVERLAY_ORDER, overlayValueText } from './overlays.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Toolbar layout: groups of tools.
const GROUPS = [
  ['Roads', ['road', 'avenue', 'highway', 'upgrade']],
  ['Zones', ['residential', 'commercial', 'industrial']],
  ['Utilities', ['wind', 'coal', 'pump']],
  ['Public', ['school', 'clinic', 'plaza', 'recycling', 'park', 'trees']],
  ['Tools', ['inspect', 'bulldoze']],
];

const TOOL_COLOR = {
  road: '#a3aab4', avenue: '#8f98a4', highway: '#7d8795', upgrade: '#a795e0',
  residential: '#7cc47a', commercial: '#6fa6e3', industrial: '#e3b75a',
  wind: '#8fcfe0', coal: '#b3a79c', pump: '#6fb6e8',
  school: '#f2c55f', clinic: '#ee8a8f', plaza: '#d6b98f', recycling: '#79c28a', park: '#92cf7a', trees: '#6fb86a',
  inspect: '#9aa7b8', bulldoze: '#e58f82',
};

const TOOL_HELP = {
  road: 'Cheap two-lane street. Buildings front onto it.',
  avenue: '3× a street\'s capacity. Paint over streets to upgrade.',
  highway: 'Fastest, 7.5× capacity, but no driveways: pair with streets.',
  upgrade: 'Drag along roads: Street → Avenue → Highway (pay the difference).',
  residential: 'Homes. Grow when there are jobs.',
  commercial: 'Shops and offices. Grow with residents nearby.',
  industrial: 'Factories. Need workers; pollute.',
  wind: 'Clean power (150 units). Place beside a road.',
  coal: 'Lots of power (600 units) but pollutes.',
  pump: 'Water (400 units near a river, 130 on dry land).',
  school: 'Happier residents and higher land value nearby.',
  clinic: 'Happier residents nearby.',
  plaza: 'Small square: happiness, land value, busier shops.',
  recycling: 'Halves pollution around it.',
  park: 'Raises land value, absorbs pollution.',
  trees: 'Plant trees on open land: cheap clean air.',
  inspect: 'Look around: click to pin tile info; drag to pan.',
  bulldoze: 'Clear anything.',
};

// Simple line icons (24×24, stroke = currentColor).
const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  road: I('<path d="M8 3 6 21M16 3l2 18"/><path d="M12 5v2M12 11v2M12 17v2"/>'),
  avenue: I('<path d="M5 3 3 21M19 3l2 18"/><path d="M12 3v18" stroke-width="3"/>'),
  highway: I('<path d="M4 3 2 21M20 3l2 18M12 3v18"/><path d="M7 8v2M7 14v2M17 8v2M17 14v2"/>'),
  upgrade: I('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  residential: I('<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>'),
  commercial: I('<path d="M4 9h16l-1.5-4h-13z"/><path d="M5 9v10h14V9"/><path d="M9 19v-5h6v5"/>'),
  industrial: I('<path d="M3 20V10l5 3V10l5 3V6h4v14z"/><path d="M3 20h18"/>'),
  wind: I('<path d="M12 12v9"/><path d="M12 12 12 3M12 12l7.5 4.5M12 12l-7.5 4.5"/><circle cx="12" cy="12" r="1.2"/>'),
  coal: I('<path d="M3 20v-7h7v7"/><path d="M13 20c.8-3 .8-8 0-12h6c-.8 4-.8 9 0 12z"/><path d="M15 4c1-1 2 0 3-1"/>'),
  pump: I('<path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/>'),
  school: I('<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>'),
  clinic: I('<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/>'),
  plaza: I('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/>'),
  recycling: I('<path d="M7 10 9.5 5.5a2 2 0 0 1 3.4 0L15 9"/><path d="M17 13l2 3.5a2 2 0 0 1-1.7 3H13"/><path d="M9 19.5H6.7a2 2 0 0 1-1.7-3L6.5 14"/>'),
  park: I('<circle cx="12" cy="9" r="5"/><path d="M12 14v7"/>'),
  trees: I('<circle cx="8" cy="10" r="4"/><circle cx="16" cy="8" r="3.5"/><path d="M8 14v6M16 11.5V20"/>'),
  inspect: I('<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>'),
  bulldoze: I('<path d="M6 6l12 12M18 6 6 18"/>'),
};

const $ = (id) => document.getElementById(id);
const money = (v) => (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString();

export class UI {
  constructor(game) {
    this.game = game;
    this.lastUpdate = 0;
    this.overlay = null;
    this.buildToolbar();
    this.buildOverlays();
    this.bindTopBar();
  }

  buildToolbar() {
    const box = $('tools');
    for (const [title, names] of GROUPS) {
      const g = document.createElement('div');
      g.className = 'tgroup';
      g.innerHTML = `<h4>${title}</h4><div class="tgrid"></div>`;
      const grid = g.querySelector('.tgrid');
      for (const name of names) {
        const def = TOOLS[name];
        const price = toolPrice(name);
        const b = document.createElement('button');
        b.className = 'tool';
        b.dataset.tool = name;
        const short = { residential: 'Homes', commercial: 'Shops', industrial: 'Industry', upgrade: 'Upgrade', recycling: 'Recycle', trees: 'Trees', inspect: 'Inspect', coal: 'Coal', wind: 'Wind', pump: 'Pump' }[name] ?? def.label;
        b.innerHTML = `<span class="ico" style="background:${TOOL_COLOR[name]}2e;color:${shade(TOOL_COLOR[name])}">${ICONS[name] ?? ''}</span>
          <span class="tl">${short}</span>${price ? `<span class="tc">$${price.toLocaleString()}</span>` : ''}
          ${def.key ? `<span class="tk">${def.key}</span>` : ''}`;
        b.title = `${def.label}${def.key ? ` (${def.key})` : ''}${price ? ` · $${price.toLocaleString()}` : ''}\n${TOOL_HELP[name] ?? ''}`;
        b.addEventListener('click', () => this.game.setTool(name));
        grid.appendChild(b);
      }
      box.appendChild(g);
    }
  }

  buildOverlays() {
    const box = $('overlayChips');
    for (const key of OVERLAY_ORDER) {
      const o = OVERLAYS[key];
      const b = document.createElement('button');
      b.className = 'ovl';
      b.dataset.overlay = key;
      b.innerHTML = `<span>${o.label}</span>${o.key ? `<kbd>${o.key.toUpperCase()}</kbd>` : ''}`;
      b.title = o.hint;
      b.addEventListener('click', () => this.game.toggleOverlay(key));
      box.appendChild(b);
    }
  }

  bindTopBar() {
    for (const btn of document.querySelectorAll('[data-speed]')) {
      btn.addEventListener('click', () => this.game.setSpeed(Number(btn.dataset.speed)));
    }
    $('taxDown').addEventListener('click', () => this.game.setTax(this.game.state.taxRate - 1));
    $('taxUp').addEventListener('click', () => this.game.setTax(this.game.state.taxRate + 1));
    const menu = $('menuList');
    const closeMenu = () => { menu.hidden = true; };
    $('btnMenu').addEventListener('click', (e) => {
      e.stopPropagation();
      const r = $('btnMenu').getBoundingClientRect();
      menu.style.top = `${r.bottom}px`;
      menu.style.right = `${window.innerWidth - r.right}px`;
      menu.hidden = !menu.hidden;
    });
    window.addEventListener('click', closeMenu);
    $('btnSave').addEventListener('click', () => { closeMenu(); this.game.save(); });
    $('btnLoad').addEventListener('click', () => { closeMenu(); $('fileInput').click(); });
    $('fileInput').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) this.game.load(f);
      e.target.value = '';
    });
    $('btnNew').addEventListener('click', () => { closeMenu(); this.newCityDialog((size) => this.game.newCity(size)); });
    $('btnReset').addEventListener('click', () => {
      const n = this.game.state.map.width;
      this.confirm('Reset the city?', `Start over from scratch on a fresh ${n}×${n} map with $${CONFIG.economy.startingFunds.toLocaleString()}. Your current city will be lost unless you save it first.`,
        'Reset', () => this.game.newCity(n));
    });
    $('btnExpand').addEventListener('click', () => {
      closeMenu();
      const map = this.game.state.map, next = CONFIG.map.expandSteps.find((n) => n > Math.max(map.width, map.height));
      if (!next) return;
      const cost = CONFIG.map.expansionCost[next] ?? 0;
      this.confirm(`Expand to ${next}×${next}?`,
        `New land is added on every side of your ${map.width}×${map.height} city. The river continues and roads to the region are extended to the new edge.`
        + (cost ? ` The land costs $${cost.toLocaleString()}.` : ''),
        'Expand', () => this.game.expandMap(next));
    });
    $('budgetStat').addEventListener('click', () => $('budget').classList.toggle('open'));
    $('helpBtn').addEventListener('click', () => $('help').classList.toggle('open'));
    $('helpClose').addEventListener('click', () => $('help').classList.remove('open'));
  }

  setActiveTool(name) {
    for (const b of document.querySelectorAll('.tool')) b.classList.toggle('active', b.dataset.tool === name);
    document.body.dataset.tool = name;
  }
  setView(view) {
    const b = $('btnView');
    b.textContent = view === '3d' ? '2D' : '3D';
    b.title = view === '3d' ? 'Switch to the 2D map (V)' : 'Switch to the 3D view (V)';
    document.body.dataset.view = view;
  }
  setActiveSpeed(s) {
    for (const b of document.querySelectorAll('[data-speed]')) b.classList.toggle('active', Number(b.dataset.speed) === s);
  }
  setOverlay(o) {
    for (const b of document.querySelectorAll('[data-overlay]')) b.classList.toggle('active', b.dataset.overlay === o);
    this.overlay = o;
    const lg = $('legend');
    lg.hidden = !o;
    if (!o) return;
    const def = OVERLAYS[o], L = def.legend;
    const scale = L.swatches
      ? `<div class="swatches">${L.swatches.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('')}</div>`
      : `<div class="ramp" style="background:${L.gradient}"></div><div class="rampl">${L.labels.map((t) => `<span>${t}</span>`).join('')}</div>`;
    lg.innerHTML = `<b>${def.label}</b><span class="here" id="legendHere"></span>${scale}<p>${def.hint}</p>`;
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
    const hp = s.happiness;
    $('happy').textContent = st.population > 0 ? `${Math.round(hp)}%` : '—';
    $('happyDetail').textContent = st.population === 0 ? 'no residents yet' : hp >= 65 ? 'cheerful' : hp >= 50 ? 'content' : hp >= 38 ? 'grumbling' : 'unhappy';
    $('happyDetail').classList.toggle('warn', st.population > 0 && hp < 45);
    const tr = s.traffic;
    $('commute').textContent = tr && tr.employed > 0 ? `${Math.round(tr.avgCommute)} min` : '—';
    const unemployed = tr ? Math.max(0, Math.round(tr.workers - tr.employed)) : 0;
    $('commuteDetail').textContent = tr && tr.congested ? `${tr.congested} jammed road${tr.congested > 1 ? 's' : ''}` : unemployed ? `${unemployed} can't reach jobs` : 'traffic flowing';
    $('commuteDetail').classList.toggle('warn', !!(tr && (tr.congested || unemployed)));
    this.updateGauge('gPower', s.utilities?.power, s.utilityGrace);
    this.updateGauge('gWater', s.utilities?.water, s.utilityGrace);
    $('tax').textContent = `${s.taxRate}%`;
    this.updateDemand();
    this.updateExpandButton();
    this.updateBudget();
    this.updateInfo();
    this.updateLegendValue();
  }

  updateGauge(id, u, grace) {
    const el = $(id);
    if (!u) return;
    const pct = u.supply > 0 ? Math.min(1, u.demand / u.supply) : (u.demand > 0 ? 1 : 0);
    el.querySelector('i').style.width = `${Math.round(pct * 100)}%`;
    el.querySelector('small').textContent = grace > 0 && u.demand > u.supply ? `due in ${grace} mo` : `${u.demand} / ${u.supply}`;
    el.classList.toggle('short', u.demand > u.supply);
    el.classList.toggle('tight', u.demand <= u.supply && pct > 0.85);
  }

  // Demand panel: centred bars (−100%..+100%) with a one-line reason each.
  updateDemand() {
    const s = this.game.state, d = s.demand, st = s.stats, D = CONFIG.demand;
    const P = st.population, jobs = st.jobs;
    const openJobs = Math.round(jobs + D.externalJobs - P * D.workforceRatio);
    const shops = Math.round(P * D.comPerResident + D.comBase - st.comJobs);
    const goods = Math.round(P * D.indPerResident + D.indBase - st.indJobs);
    const labour = Math.round(P * D.workforceRatio + D.externalLabor - jobs);
    const taxNote = s.taxRate >= D.taxNeutral + 2 ? 'high taxes hurt' : s.taxRate < D.taxNeutral ? 'low taxes help' : '';
    const rows = [
      ['r', 'Homes', 'var(--r)', openJobs >= 0 ? `${openJobs} open jobs want workers` : `${-openJobs} residents need jobs: zone C or I`],
      ['c', 'Shops', 'var(--c)', labour < 0 ? 'short of workers: zone homes' : shops >= 0 ? `shoppers want ~${shops} more shop jobs` : 'more shops than shoppers'],
      ['i', 'Industry', 'var(--i)', labour < 0 ? 'short of workers: zone homes' : goods >= 0 ? `~${goods} more factory jobs wanted` : 'enough industry for now'],
    ];
    const bar = (v, color) => {
      const w = Math.abs(v) * 50;
      return `<b style="left:${v >= 0 ? 50 : 50 - w}%;width:${w}%;background:${v >= 0 ? color : 'var(--bad)'};opacity:${v >= 0 ? 1 : 0.55}"></b>`;
    };
    $('demand').innerHTML = `<h4><span>Demand</span><span>${taxNote}</span></h4>` + rows.map(([k, name, color, why]) => {
      const v = Math.max(-1, Math.min(1, d[k]));
      const pct = Math.round(v * 100);
      return `<div class="drow"><span class="dname"><i style="background:${color}"></i>${name}</span>
        <div class="dbar">${bar(v, color)}</div><span class="dval ${pct < 0 ? 'neg' : ''}">${pct > 0 ? '+' : ''}${pct}%</span></div>
        <div class="dsub">${why}</div>`;
    }).join('');
  }

  updateLegendValue() {
    const el = $('legendHere');
    if (!el || !this.overlay) return;
    const g = this.game, t = g.pinned ?? g.hover, map = g.state.map;
    el.textContent = t && map.inBounds(t.x, t.y) ? `here: ${overlayValueText(this.overlay, map, map.idx(t.x, t.y))}` : '';
  }

  updateBudget() {
    const el = $('budget');
    if (!el.classList.contains('open')) return;
    const s = this.game.state, b = monthlyBudget(s);
    const row = (k, v, cls = '') => `<tr class="${cls}"><td>${k}</td><td>${money(v)}</td></tr>`;
    const nz = (k, v) => (Math.round(v) ? row(k, -v) : '');
    el.innerHTML = `<h3>Monthly budget <small>(projected at ${s.taxRate}% tax)</small></h3><table>
      <tr class="sep"><td>Income</td><td></td></tr>
      ${row('Residential tax', b.income.residential)}
      ${row('Commercial tax', b.income.commercial)}
      ${row('Industrial tax', b.income.industrial)}
      <tr class="sep"><td>Upkeep</td><td></td></tr>
      ${nz('Streets', b.expenses.roads)}${nz('Avenues', b.expenses.avenues)}${nz('Highways', b.expenses.highways)}
      ${nz('Bridges', b.expenses.bridges)}${nz('Parks', b.expenses.parks)}
      ${nz('Power & water', b.expenses.utilities)}${nz('Public services', b.expenses.services)}
      ${row('Net', b.totalIncome - b.totalExpenses, 'total')}
    </table>
    <p class="muted">Workers ${Math.round(s.stats.workers)} / jobs ${s.stats.jobs}. Click “Last month” to close.</p>`;
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
    const rows = [], notes = [];
    const supply = (v) => `<span class="pill ${['none', 'short', 'ok'][v]}">${['none', 'shortage', 'yes'][v]}</span>`;
    if (isZone(type)) {
      const cap = CONFIG.capacity[['', '', 'residential', 'commercial', 'industrial'][type]][lv];
      rows.push(['Density', ab ? 'Abandoned' : lv === 0 ? 'Vacant lot' : `${levelName(lv)} (${lv}/3)`]);
      if (!ab && lv > 0) rows.push([type === TILE.RES ? 'Residents' : 'Jobs', cap]);
      rows.push(['Power · Water', `${supply(map.power[i])} ${supply(map.water[i])}`]);
    }
    if (type === TILE.SERVICE) {
      const k = KINDS[map.kind[i]], B = CONFIG.buildings[k];
      title = B.label;
      if (B.power || k === 'pump') {
        const res = B.power ? 'power' : 'water', out = supplyOf(map, i, res);
        rows.push(['Output', `${out} ${res}`]);
        if (k === 'pump' && out < B.water) notes.push('Dry land: pumps within 2 tiles of water produce 3× more');
        if (map[res][i] !== SUPPLY.OK) notes.push('Not beside a road: its output isn\'t reaching anyone');
      }
      if (B.radius) rows.push(['Reach', `${B.radius} tiles`]);
      rows.push(['Upkeep', `${money(B.upkeep)}/mo`]);
      if (!B.power && k !== 'pump') rows.push(['Power · Water', `${supply(map.power[i])} ${supply(map.water[i])}`]);
    }
    if (type === TILE.ROAD) {
      title = ROAD_NAMES[map.roadClass[i]] + (water ? ' bridge' : '');
      rows.push(['Network', map.roadDist[i] >= 0 ? `${map.roadDist[i]} tiles to the map edge` : 'Not connected!']);
      if (map.roadDist[i] >= 0) {
        const load = roadLoad(map, i);
        rows.push(['Traffic', `${Math.round(map.traffic[i])} trips/mo`]);
        rows.push(['Capacity', `${Math.round(load * 100)}% ${load > 1 ? '— jammed' : load > 0.5 ? '— busy' : ''}`]);
        if (load > 0.8 && map.roadClass[i] < 2) {
          notes.push(`Busy: upgrade to ${ROAD_NAMES[map.roadClass[i] + 1]} with the Upgrade tool (9)`);
        }
      }
      if (map.roadClass[i] === 2) notes.push('Limited access: buildings can\'t use a highway as their street');
    }
    if (type === TILE.RES && lv > 0 && !ab) {
      const c = map.commute[i];
      rows.push(['Happiness', bar(map.happiness[i], 'hp')]);
      rows.push(['Commute', Number.isFinite(c) ? `${Math.round(c)} min` : 'no job in reach']);
      rows.push(['Employed', `${Math.round(map.employed[i] * 100)}%`]);
    } else if (type === TILE.RES && Number.isFinite(map.commute[i])) {
      rows.push(['Nearest job', `${Math.round(map.commute[i])} min`]);
    }
    if (type === TILE.COM) rows.push(['Passing trips', Math.round(map.passing[i])]);
    if (!water) {
      rows.push(['Land value', bar(map.landValue[i], 'lv')]);
      rows.push(['Pollution', bar(map.pollution[i], 'pol')]);
      const cov = ['school', 'clinic', 'plaza', 'recycling'].filter((k) => map.coverage[k][i] > 0.05);
      if (cov.length) rows.push(['Served by', cov.join(', ')]);
    }
    if (isZone(type)) {
      const ev = evaluateTile(g.state, i);
      if (ev.connected && !ab) {
        const trend = lv < ev.maxLevel && ev.score > CONFIG.growth.growThreshold ? '▲ growing'
          : (lv > ev.maxLevel || ev.score < CONFIG.growth.declineThreshold) && lv > 0 ? '▼ declining' : '■ stable';
        rows.push(['Outlook', trend]);
      }
      notes.push(...ev.reasons);
      if (type === TILE.RES && lv === 0 && map.happiness[i] < 40) {
        const why = happinessReasons(g.state, i);
        if (why.length) notes.push(`Not a happy spot: ${why.join(', ')}`);
      }
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
    const sp = r.tileToScreen(h.x, h.y), sx = sp.x + 8, sy = sp.y + 8;
    tip.style.transform = `translate(${Math.min(sx, r.viewW - 130)}px, ${Math.min(sy, r.viewH - 30)}px)`;
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
      this.toast(e.text, e.kind, e.kind === 'bad' ? 5000 : 3200);
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

  // New-city dialog with a map-size choice.
  newCityDialog(onPick) {
    const m = $('modal');
    m.querySelector('h2').textContent = 'Start a new city?';
    const sizes = Object.entries(CONFIG.map.sizes);
    m.querySelector('p').innerHTML = 'Your current city will be lost unless you save it first. Pick a map size:'
      + `<span class="sizes">${sizes.map(([name, n]) => `<button data-size="${n}" class="${n === CONFIG.map.defaultSize ? 'sel' : ''}">${name}<small>${n}×${n}</small></button>`).join('')}</span>`;
    let size = CONFIG.map.defaultSize;
    for (const b of m.querySelectorAll('[data-size]')) {
      b.onclick = () => {
        size = Number(b.dataset.size);
        for (const o of m.querySelectorAll('[data-size]')) o.classList.toggle('sel', o === b);
      };
    }
    const ok = $('modalOk'), cancel = $('modalCancel');
    ok.textContent = 'New city';
    cancel.textContent = 'Cancel';
    cancel.hidden = false;
    m.hidden = false;
    const close = () => { m.hidden = true; ok.onclick = cancel.onclick = null; };
    ok.onclick = () => { close(); onPick(size); };
    cancel.onclick = close;
  }

  updateExpandButton() {
    const map = this.game.state.map, next = CONFIG.map.expandSteps.find((n) => n > Math.max(map.width, map.height));
    const b = $('btnExpand');
    b.disabled = !next;
    b.textContent = next ? `Expand map to ${next}×${next}…` : 'Map is at its largest';
  }

  confirm(title, body, okLabel, onOk) {
    const m = $('modal');
    m.querySelector('h2').textContent = title;
    m.querySelector('p').textContent = body;
    const ok = $('modalOk'), cancel = $('modalCancel');
    ok.textContent = okLabel;
    cancel.textContent = 'Cancel';
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
    ok.textContent = 'Start over';
    cancel.textContent = 'Load save…';
    cancel.hidden = false;
    m.hidden = false;
    ok.onclick = () => { m.hidden = true; cancel.textContent = 'Cancel'; this.game.newCity(s.map.width); };
    cancel.onclick = () => { m.hidden = true; cancel.textContent = 'Cancel'; $('fileInput').click(); };
  }
}

function bar(v, cls) {
  return `<span class="mbar ${cls}"><i style="width:${Math.round(v)}%"></i></span> ${Math.round(v)}`;
}

// Darker version of a hex colour for icon strokes.
function shade(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.round(c * 0.62).toString(16).padStart(2, '0');
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}
