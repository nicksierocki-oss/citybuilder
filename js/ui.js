// UI: top bar, toolbar, demand panel, overlays + legend, tile info, toasts and dialogs (DOM only).

import { CONFIG } from './config.js';
import { TOOLS, monthlyBudget, toolPrice, takeLoan, canTakeLoan, budgetAdvice, isUnlocked, visitorIncome, repayLoan, loanPayoff } from './economy.js';
import { TILE, TERRAIN, FLAG, ZONE_NAMES, ROAD_NAMES, KINDS, SUPPLY, JUNCTION, isZone, isHome, homeCap, jobCap, skilledShare, footprintSize } from './map.js';
import { evaluateTile, levelName, districtAt, tourismScore } from './simulation.js';
import { roadLoad, junctionDelay } from './traffic.js';
import { supplyOf, happinessReasons, educationTarget } from './services.js';
import { OVERLAYS, OVERLAY_ORDER, overlayValueText } from './overlays.js';
import { SEASON_NAMES, seasonOf, clockText } from './seasons.js';
import { Graphs } from './graphs.js';
import { Minimap } from './minimap.js';
import { CityHallUI } from './cityhall-ui.js';
import { LinesUI } from './lines-ui.js';
import { isStop } from './transit.js';
import { SCENARIOS, SCENARIO_ORDER } from './goals.js';

const DISTRICT_NAMES = ['Old Town', 'Riverside', 'Hillcrest', 'Northside', 'Westgate', 'Eastbrook', 'Southfield', 'Uptown',
  'Harborview', 'Parkside', 'Midtown', 'Greenwood', 'Lakeside', 'Brookfield'];
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Toolbar layout: groups of tools.
const GROUPS = [
  ['Roads', ['road', 'avenue', 'highway', 'upgrade', 'lights', 'interchange']],
  ['Zones', ['residential', 'commercial', 'industrial', 'office', 'farm', 'mixed']],
  ['Utilities', ['wind', 'coal', 'pump', 'landfill']],
  ['Public', ['school', 'clinic', 'plaza', 'recycling', 'park', 'trees']],
  ['Transit', ['bus', 'metro']],
  ['Safety', ['police', 'fire']],
  ['Landmarks', ['townpark', 'centralpark', 'university', 'stadium', 'hospital', 'statue']],
  ['Tools', ['inspect', 'bulldoze']],
];

const TOOL_COLOR = {
  road: '#a3aab4', avenue: '#8f98a4', highway: '#7d8795', upgrade: '#a795e0',
  residential: '#7cc47a', commercial: '#6fa6e3', industrial: '#e3b75a', office: '#5abec8', farm: '#b9c46a', mixed: '#cd9678',
  wind: '#8fcfe0', coal: '#b3a79c', pump: '#6fb6e8',
  police: '#7f9ee0', fire: '#ee8a6e', lights: '#8fbf8a', interchange: '#8a94a6', bus: '#e3a35a', metro: '#b38fd6',
  school: '#f2c55f', clinic: '#ee8a8f', plaza: '#d6b98f', recycling: '#79c28a', park: '#92cf7a', trees: '#6fb86a',
  inspect: '#9aa7b8', bulldoze: '#e58f82',
  townpark: '#86c878', centralpark: '#5fb86a', university: '#d9a58f', stadium: '#8fa8e0', statue: '#c9a86a', hospital: '#ee8a8f', landfill: '#b8a27e',
};

const TOOL_HELP = {
  road: 'Cheap two-lane street. Buildings front onto it.',
  avenue: '3× a street\'s capacity. Paint over streets to upgrade.',
  highway: 'Fastest, 7.5× capacity, but no driveways: pair with streets.',
  upgrade: 'Drag along roads: Street → Avenue → Highway (pay the difference).',
  residential: 'Homes. Grow when there are jobs.',
  commercial: 'Shops and offices. Grow with residents nearby.',
  industrial: 'Factories. Need workers; pollute.',
  office: 'Offices: many skilled jobs, clean, high tax. Need educated residents nearby.',
  farm: 'Farms: cheap outlying land, no power needed, no pollution. Fields can be 2 tiles from a road.',
  mixed: 'Mixed-use: homes upstairs, shops at street level. Grows with both housing and shop demand.',
  wind: 'Clean power (150 units). Place beside a road.',
  coal: 'Lots of power (600 units) but pollutes.',
  pump: 'Water (400 units near a river, 130 on dry land).',
  school: 'Happier residents and higher land value nearby.',
  clinic: 'Happier residents nearby.',
  plaza: 'Small square: happiness, land value, busier shops.',
  recycling: 'Halves pollution around it.',
  park: 'Raises land value, absorbs pollution.',
  trees: 'Plant trees on open land: cheap clean air.',
  police: 'Cuts crime within 10 tiles: happier homes, busier shops.',
  lights: 'Add to busy intersections: a small fixed wait, but far less congestion.',
  interchange: 'Carries a highway over a crossing road with ramps: no more at-grade bottleneck.',
  bus: 'Bus or tram stop. Riders within 3 tiles use the lines that call here: create lines under Transit lines.',
  metro: 'Fast. People within 4 tiles ride to jobs near any other metro station. Raises land value.',
  fire: 'Prevents fires and puts them out within 10 tiles.',
  townpark: '2×2 park: land value and happiness across a neighbourhood.',
  centralpark: '3×3 park with a pond: big land value boost, cleans the air.',
  university: '3×2 campus: educates residents within 14 tiles, making room for offices and high-tech industry.',
  stadium: '3×3 stadium: visitors bring ticket income, busier shops and happier residents across 16 tiles.',
  statue: 'A bronze mayor: raises land value and happiness nearby. Unlocked by a mayor rating of 80.',
  hospital: '2×2 hospital: big health boost within 14 tiles (healthier residents are happier). Unlocks at 2,000 residents.',
  landfill: '2×2 dump: collects 700 units of garbage a month within 24 tiles. Smells: keep it away from homes.',
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
  office: I('<rect x="6" y="3" width="12" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>'),
  farm: I('<path d="M3 20h18M4 16c3-1 5-1 8 0s5 1 8 0"/><path d="M7 13V7l3-3 3 3v6z"/><path d="M16 13V8h3v5"/>'),
  mixed: I('<path d="M5 21V8l7-5 7 5v13z"/><path d="M5 15h14"/><path d="M9 21v-3h6v3M9 10h2M13 10h2"/>'),
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
  lights: I('<rect x="8" y="2" width="8" height="16" rx="3"/><circle cx="12" cy="6.5" r="1.5"/><circle cx="12" cy="13.5" r="1.5"/><path d="M12 18v4"/>'),
  interchange: I('<path d="M3 12h18"/><path d="M12 3v18"/><path d="M7 7a7 7 0 0 0 5 5M17 17a7 7 0 0 0-5-5"/>'),
  bus: I('<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 21v-3M16 21v-3"/><circle cx="8" cy="14.5" r="1"/><circle cx="16" cy="14.5" r="1"/>'),
  metro: I('<circle cx="12" cy="12" r="9"/><path d="M8 16V8l4 5 4-5v8"/>'),
  police: I('<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z"/><path d="m12 8 1.2 2.5 2.8.4-2 2 .5 2.8L12 14.4l-2.5 1.3.5-2.8-2-2 2.8-.4z"/>'),
  fire: I('<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 1.5 1 2.5 2 3 0-3 .5-5.5.5-8z"/>'),
  bulldoze: I('<path d="M6 6l12 12M18 6 6 18"/>'),
  townpark: I('<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="9" cy="10" r="3"/><circle cx="15.5" cy="14.5" r="2.5"/>'),
  centralpark: I('<rect x="3" y="3" width="18" height="18" rx="4"/><ellipse cx="15" cy="9" rx="3.5" ry="2.2"/><circle cx="8" cy="15" r="2.6"/><path d="M8 17.6V20"/>'),
  university: I('<path d="M3 20h18M5 20V10M19 20V10M9 20v-6h6v6"/><path d="M3 10 12 4l9 6z"/>'),
  stadium: I('<ellipse cx="12" cy="12" rx="9" ry="7"/><rect x="8" y="9.5" width="8" height="5" rx="1"/><path d="M12 9.5v5"/>'),
  hospital: I('<rect x="3" y="6" width="18" height="15" rx="2"/><path d="M12 9v8M8 13h8"/><path d="M8 6V3h8v3"/>'),
  landfill: I('<path d="M3 19c2-5 5-8 9-8s7 3 9 8z"/><path d="M8 8l1-3M13 7l1-4M17 9l2-2"/>'),
  statue: I('<circle cx="12" cy="5" r="2"/><path d="M10 8h4l1 7h-6zM7 21h10M8 21v-3h8v3"/>'),
};

const $ = (id) => document.getElementById(id);
const money = (v) => (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString();

export class UI {
  constructor(game) {
    this.game = game;
    this.lastUpdate = 0;
    this.overlay = null;
    this.selectedDistrict = null;
    this.buildToolbar();
    this.buildOverlays();
    this.bindTopBar();
    this.bindDistricts();
    this.bindBrushes();
    this.graphs = new Graphs($('graphs'), () => this.game.state);
    this.minimap = new Minimap($('minimap'), game);
    this.cityhall = new CityHallUI(game, this);
    this.lines = new LinesUI(game, this);
    $('graphs').addEventListener('click', (e) => { if (e.target.closest('#btnGraphsClose')) this.toggleGraphs(false); });
  }

  // A different city was loaded or started.
  onNewState() {
    this.selectedDistrict = null;
    if (this.lines) { this.game.activeLine = null; this.lines.selected = null; this.lines.render(); }
    if (this.cityhall) { this.cityhall.newsKey = null; this.cityhall.panelHtml = null; this.cityhall.renderPanel(true); }
    this.renderDistricts();
    this.labelKey = null;
    if (this.overlay) this.setOverlay(this.overlay);
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
        const short = { police: 'Police', fire: 'Fire', lights: 'Lights', interchange: 'Ramps', bus: 'Bus', metro: 'Metro', residential: 'Homes', commercial: 'Shops', industrial: 'Industry', office: 'Offices', farm: 'Farms', mixed: 'Mixed', upgrade: 'Upgrade', recycling: 'Recycle', trees: 'Trees', statue: 'Statue', hospital: 'Hospital', landfill: 'Landfill', inspect: 'Inspect', coal: 'Coal', wind: 'Wind', pump: 'Pump' }[name] ?? def.label;
        b.innerHTML = `<span class="ico" style="background:${TOOL_COLOR[name]}2e;color:${shade(TOOL_COLOR[name])}">${ICONS[name] ?? ''}</span>
          <span class="tl">${short}</span>${price ? `<span class="tc">$${price.toLocaleString()}</span>` : ''}
          ${def.key ? `<span class="tk">${def.key}</span>` : ''}`;
        b.title = `${def.label}${def.key ? ` (${def.key})` : ''}${price ? ` · $${price.toLocaleString()}` : ''}\n${TOOL_HELP[name] ?? ''}`;
        b.addEventListener('click', () => {
          const B = CONFIG.buildings[def.building], st = this.game.state;
          if (B && !isUnlocked(st, def.building)) {
            this.toast(st.scenario?.banned?.includes(def.building) ? `${B.label}s are not allowed in this scenario.`
              : B.unlockRating ? `${B.label} unlocks at a mayor rating of ${B.unlockRating}.` : `${B.label} unlocks at ${B.unlock.toLocaleString()} residents.`, 'info', 2400);
            return;
          }
          this.game.setTool(name);
        });
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
    $('btnNew').addEventListener('click', () => { closeMenu(); this.newCityDialog((size) => this.game.newCity(size), (id) => this.game.newScenario(id)); });
    $('btnCityHall').addEventListener('click', () => { closeMenu(); this.cityhall.toggle(true); });
    $('btnRegion').addEventListener('click', () => { closeMenu(); this.cityhall.tab = 'region'; this.cityhall.toggle(true); });
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
    $('budgetStat').addEventListener('click', () => this.toggleBudget());
    // The budget panel re-renders often, so handle its buttons by delegation.
    $('budget').addEventListener('click', (e) => {
      const id = e.target.closest('button')?.id;
      if (id === 'btnLoan') { takeLoan(this.game.state); this.lastBudgetHtml = null; this.updateBudget(); }
      const fund = e.target.closest('[data-fund]');
      if (fund) {
        const s = this.game.state, g = fund.dataset.fund, B = CONFIG.budgets;
        s.budgets ??= {};
        const v = Math.round(Math.max(B.min, Math.min(B.max, (s.budgets[g] ?? 1) + Number(fund.dataset.d) * B.step)) * 10) / 10;
        if (v === 1) delete s.budgets[g]; else s.budgets[g] = v;
        this.lastBudgetHtml = null; this.updateBudget();
      }
      if (id === 'btnRepay') { if (!repayLoan(this.game.state)) this.toast('Not enough money to repay a loan yet.', 'info'); this.lastBudgetHtml = null; this.updateBudget(); }
      if (id === 'btnBudgetClose') this.toggleBudget(false);
    });
    $('btnDayNight').addEventListener('click', () => { closeMenu(); this.game.setDayNight(!this.game.dayNight); });
    $('btnSeasons').addEventListener('click', () => { closeMenu(); this.game.setSeasons(!this.game.seasons); });
    $('tglDayNight').addEventListener('click', () => this.game.setDayNight(!this.game.dayNight));
    $('tglSeasons').addEventListener('click', () => this.game.setSeasons(!this.game.seasons));
    $('btnUndo').addEventListener('click', () => this.game.undo());
    $('popStat').addEventListener('click', () => this.toggleGraphs());
    $('btnMinimap').addEventListener('click', () => { closeMenu(); this.minimap.toggle(); this.updateMenuLabels(); });
    $('cityName').closest('button').addEventListener('click', () => {
      this.prompt('Name your city', 'City name', this.game.state.cityName, (v) => { this.game.state.cityName = v; });
    });
    this.updateMenuLabels();
    $('helpBtn').addEventListener('click', () => $('help').classList.toggle('open'));
    $('helpClose').addEventListener('click', () => $('help').classList.remove('open'));
  }

  setActiveTool(name) {
    for (const b of document.querySelectorAll('.tool')) b.classList.toggle('active', b.dataset.tool === name);
    document.body.dataset.tool = name;
    document.body.classList.toggle('brushable', TOOLS[name]?.shape === 'rect');
    if (name !== 'district') { this.renderDistricts(); }
  }

  updateMenuLabels() {
    const g = this.game;
    $('btnDayNight').textContent = g.dayNight ? 'Day & night: on' : 'Day & night: off';
    $('btnSeasons').textContent = g.seasons ? 'Seasons: on' : 'Seasons: off';
    $('tglDayNight').classList.toggle('active', g.dayNight);
    $('tglDayNight').title = `Day & night cycle: ${g.dayNight ? 'on' : 'off'} (click to turn ${g.dayNight ? 'off' : 'on'})`;
    $('tglSeasons').classList.toggle('active', g.seasons);
    $('tglSeasons').title = `Seasons: ${g.seasons ? 'on' : 'off, always summer colours'} (click to turn ${g.seasons ? 'off' : 'on'})`;
    $('btnMinimap').textContent = this.minimap?.visible === false ? 'Show mini-map' : 'Hide mini-map';
  }

  // ------------------------------------------------------------ brushes
  bindBrushes() {
    for (const b of document.querySelectorAll('[data-brush]')) b.addEventListener('click', () => this.game.setBrush(b.dataset.brush));
    this.setBrush(this.game.brush);
  }
  setBrush(brush) {
    for (const b of document.querySelectorAll('[data-brush]')) b.classList.toggle('active', b.dataset.brush === brush);
  }

  // ------------------------------------------------------------ districts
  bindDistricts() {
    $('btnNewDistrict').addEventListener('click', () => this.newDistrict());
    const list = $('districtList');
    list.addEventListener('click', (e) => {
      const row = e.target.closest('[data-district]');
      if (!row) return;
      const id = Number(row.dataset.district), act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'paint') { this.game.setTool('district', id); this.renderDistricts(); return; }
      if (act === 'erase') { this.game.setTool('district', 0); this.renderDistricts(); return; }
      if (act === 'delete') { this.deleteDistrict(id); return; }
      if (e.target.closest('.deditor')) return;
      this.selectedDistrict = this.selectedDistrict === id ? null : id;
      if (this.selectedDistrict) this.game.setTool('district', id);
      this.renderDistricts();
    });
    list.addEventListener('change', (e) => {
      const d = this.districtById(Number(e.target.closest('[data-district]')?.dataset.district));
      if (!d) return;
      const p = e.target.dataset.policy;
      if (p === 'height') d.policies.height = Number(e.target.value);
      else if (p) d.policies[p] = e.target.checked;
      if (e.target.dataset.field === 'name') {
        d.name = e.target.value.trim().slice(0, 40) || d.name;
        this.labelKey = null;
      }
      this.afterDistrictChange();
    });
    this.renderDistricts();
  }

  districtById(id) { return (this.game.state.districts ?? []).find((d) => d.id === id); }

  newDistrict() {
    const s = this.game.state, list = s.districts ??= [];
    if (list.length >= CONFIG.districts.max) { this.toast(`Up to ${CONFIG.districts.max} districts.`, 'info'); return; }
    const id = list.reduce((m, d) => Math.max(m, d.id), 0) + 1;
    const used = new Set(list.map((d) => d.name));
    const name = DISTRICT_NAMES.find((n) => !used.has(n)) ?? `District ${id}`;
    const colors = CONFIG.districts.colors, usedC = new Set(list.map((d) => d.color));
    const color = colors.find((c) => !usedC.has(c)) ?? colors[id % colors.length];
    list.push({ id, name, color, policies: { height: 3, noHeavyIndustry: false, taxBreak: false } });
    this.selectedDistrict = id;
    this.game.setTool('district', id);
    this.afterDistrictChange();
    this.toast(`Drag on the map to paint ${name}.`, 'info', 2600);
  }

  deleteDistrict(id) {
    const d = this.districtById(id);
    if (!d) return;
    this.confirm(`Delete ${d.name}?`, 'Its tiles stay as they are; only the district and its policies go.', 'Delete', () => {
      const s = this.game.state, map = s.map;
      for (let i = 0; i < map.size; i++) if (map.district[i] === id) map.district[i] = 0;
      map.version++;
      s.districts = s.districts.filter((x) => x.id !== id);
      if (this.selectedDistrict === id) this.selectedDistrict = null;
      if (this.game.tool === 'district') this.game.setTool('inspect');
      this.afterDistrictChange();
    });
  }

  afterDistrictChange() {
    const s = this.game.state;
    s.map.version++; // repaint borders (3D ground texture)
    this.labelKey = null;
    this.renderDistricts();
    if (this.overlay === 'districts') this.setOverlay('districts');
  }

  renderDistricts() {
    const s = this.game.state, list = s?.districts ?? [];
    const box = $('districtList');
    if (!box || !s) return;
    const g = this.game, painting = g.tool === 'district';
    const heights = [[3, 'No limit'], [2, 'Medium at most'], [1, 'Low-rise only']];
    box.innerHTML = list.map((d) => {
      const sel = d.id === this.selectedDistrict, P = d.policies;
      const tags = [P.height < 3 ? (P.height === 1 ? 'low-rise' : 'mid-rise') : '', P.noHeavyIndustry ? 'no heavy ind.' : '', P.taxBreak ? 'tax break' : ''].filter(Boolean).join(' · ');
      return `<div class="district${sel ? ' sel' : ''}" data-district="${d.id}">
        <div class="dhead"><i style="background:${d.color}"></i><b>${esc(d.name)}</b><small data-dstat="${d.id}"></small></div>
        ${tags && !sel ? `<div class="dtags">${tags}</div>` : ''}
        ${sel ? `<div class="deditor">
          <input data-field="name" value="${esc(d.name)}" maxlength="40" aria-label="District name">
          <label>Height <select data-policy="height">${heights.map(([v, t]) => `<option value="${v}" ${P.height === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label class="chk"><input type="checkbox" data-policy="noHeavyIndustry" ${P.noHeavyIndustry ? 'checked' : ''}> No heavy industry <small>factories stay small unless high-tech</small></label>
          <label class="chk"><input type="checkbox" data-policy="taxBreak" ${P.taxBreak ? 'checked' : ''}> Tax break <small>${Math.round(CONFIG.districts.taxBreakCut * 100)}% less tax here, faster growth</small></label>
          <div class="dbtns">
            <button data-act="paint" class="${painting && g.toolArg === d.id ? 'on' : ''}">Paint</button>
            <button data-act="erase" class="${painting && g.toolArg === 0 ? 'on' : ''}" title="Remove tiles from any district">Erase</button>
            <button data-act="delete" class="danger">Delete</button>
          </div>
        </div>` : ''}
      </div>`;
    }).join('') || '<p class="muted small">Name neighbourhoods and give them their own rules: height limits, no heavy industry, tax breaks.</p>';
    this.updateDistrictStats();
  }

  updateDistrictStats() {
    const st = this.game.state.stats?.districts ?? {};
    for (const el of document.querySelectorAll('[data-dstat]')) {
      const d = st[el.dataset.dstat];
      el.textContent = d ? `${d.population.toLocaleString()} ppl · ${d.jobs.toLocaleString()} jobs${d.population ? ` · ☺ ${Math.round(d.happiness)}` : ''}` : '';
    }
  }

  // District name labels over the map (both views), positioned at each district's centre.
  updateLabels() {
    const s = this.game.state, map = s.map, box = $('labels'), r = this.game.renderer;
    const key = `${map.version}|${(s.districts ?? []).map((d) => d.id + d.name).join()}|${map.width}`;
    if (key !== this.labelKey) {
      this.labelKey = key;
      const acc = new Map();
      for (let i = 0; i < map.size; i++) {
        const id = map.district[i];
        if (!id) continue;
        const a = acc.get(id) ?? { x: 0, y: 0, n: 0 };
        a.x += i % map.width + 0.5; a.y += ((i / map.width) | 0) + 0.5; a.n++;
        acc.set(id, a);
      }
      this.labelPos = (s.districts ?? []).filter((d) => acc.get(d.id)?.n).map((d) => {
        const a = acc.get(d.id);
        return { d, x: a.x / a.n, y: a.y / a.n };
      });
      box.innerHTML = this.labelPos.map(({ d }) => `<span class="dlabel" style="--c:${d.color}">${esc(d.name)}</span>`).join('');
    }
    const els = box.children;
    (this.labelPos ?? []).forEach((l, k) => {
      const p = r.tileToScreen(l.x - 1, l.y - 1), el = els[k];
      if (!el) return;
      const off = p.x < -50 || p.y < -20 || p.x > r.viewW + 50 || p.y > r.viewH + 20;
      el.style.display = off ? 'none' : '';
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%)`;
    });
  }

  toggleGraphs(open) {
    const el = $('graphs');
    const show = open ?? !el.classList.contains('open');
    el.classList.toggle('open', show);
    if (show) this.graphs.render(true);
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
    const def = OVERLAYS[o], L = o === 'districts'
      ? { swatches: (this.game.state.districts ?? []).map((d) => [d.color, esc(d.name)]) }
      : def.legend;
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
    $('date').textContent = `${MONTHS[s.month]} ${s.year}`;
    const env = this.game.renderer.env;
    $('clock').textContent = `${SEASON_NAMES[seasonOf(s.month)]}${this.game.dayNight && env ? ` · ${env.night > 0.5 ? '☾' : '☀'} ${clockText(env.hour)}` : ''}`;
    if ($('cityName').textContent !== s.cityName) $('cityName').textContent = s.cityName;
    $('jobs').textContent = `${st.jobs.toLocaleString()} jobs · ${Math.round((s.education ?? 0) * 100)}% skilled`;
    for (const b of document.querySelectorAll('.tool')) {
      const k = TOOLS[b.dataset.tool]?.building, B = CONFIG.buildings[k];
      if (!B || !(B.unlock || B.unlockRating || s.scenario?.banned?.includes(k))) { b.classList.remove('locked'); continue; }
      const locked = !isUnlocked(s, k);
      b.classList.toggle('locked', locked);
      const tc = b.querySelector('.tc');
      if (tc) tc.textContent = !locked ? `$${B.cost.toLocaleString()}` : s.scenario?.banned?.includes(k) ? '🚫 banned' : B.unlockRating ? `🔒 rating ${B.unlockRating}` : `🔒 ${B.unlock.toLocaleString()}`;
    }
    $('btnUndo').disabled = !this.game.lastUndo;
    this.updateDistrictStats();
    this.graphs.render();
    this.cityhall.render();
    this.minimap.draw();
    const hp = s.happiness;
    $('happy').textContent = st.population > 0 ? `${Math.round(hp)}%` : '—';
    $('happyDetail').textContent = st.population === 0 ? 'no residents yet' : hp >= 65 ? 'cheerful' : hp >= 50 ? 'content' : hp >= 38 ? 'grumbling' : 'unhappy';
    $('happyDetail').classList.toggle('warn', st.population > 0 && hp < 45);
    const tr = s.traffic;
    $('commute').textContent = tr && tr.employed > 0 ? `${Math.round(tr.avgCommute)} min` : '—';
    const unemployed = tr ? Math.max(0, Math.round(tr.workers - tr.employed)) : 0;
    const transitPct = tr && tr.employed > 0 ? Math.round((tr.transitRiders ?? 0) / tr.employed * 100) : 0;
    $('commuteDetail').textContent = tr && tr.congested ? `${tr.congested} jammed road${tr.congested > 1 ? 's' : ''}`
      : unemployed ? `${unemployed} can't reach jobs` : transitPct ? `${transitPct}% ride transit` : 'traffic flowing';
    $('commuteDetail').classList.toggle('warn', !!(tr && (tr.congested || unemployed)));
    const crime = s.crime ?? 0, fires = s.fires ?? 0;
    $('safety').textContent = st.population > 0 ? (crime < 12 ? 'Safe' : crime < 25 ? 'Fair' : crime < 40 ? 'Uneasy' : 'Rough') : '—';
    $('safetyDetail').textContent = fires ? `${fires} fire${fires > 1 ? 's' : ''} burning!` : st.population > 0 ? `crime ${Math.round(crime)}` : 'no residents yet';
    $('safetyDetail').classList.toggle('warn', fires > 0 || crime >= 25);
    this.updateGauge('gPower', s.utilities?.power, s.utilityGrace);
    this.updateGauge('gWater', s.utilities?.water, s.utilityGrace);
    $('tax').textContent = `${s.taxRate}%`;
    this.updateDemand();
    this.updateExpandButton();
    this.updateBudget();
    this.updateInfo();
    this.updateLegendValue();
  }

  // Every frame: things that follow the camera.
  frame() {
    this.updateLabels();
    this.minimap.drawView();
  }

  updateGauge(id, u, grace) {
    const el = $(id);
    if (!u) return;
    const pct = u.supply > 0 ? Math.min(1, u.demand / u.supply) : (u.demand > 0 ? 1 : 0);
    el.querySelector('i').style.width = `${Math.round(pct * 100)}%`;
    el.querySelector('small').textContent = grace > 0 && u.demand > u.supply ? `due in ${grace} mo` : u.exported ? `sells ${u.exported}` : u.imported ? `buys ${u.imported}` : `${u.demand} / ${u.supply}`;
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
    // Offices and farms only show once they matter (zoned, or clearly wanted).
    if (st.zoned.o || (P >= 500 && (d.o ?? 0) > 0.2)) rows.push(['o', 'Offices', '#5abec8', (s.education ?? 0) < 0.3 ? 'need more skilled residents: build schools' : (d.o ?? 0) > 0 ? 'skilled workers want office jobs' : 'enough offices for now']);
    if (st.zoned.f || (P >= 500 && (d.f ?? 0) > 0.2)) rows.push(['f', 'Farms', '#b9c46a', (d.f ?? 0) > 0 ? 'the region wants more produce' : 'enough farms for now']);
    const bar = (v, color) => {
      const w = Math.abs(v) * 50;
      return `<b style="left:${v >= 0 ? 50 : 50 - w}%;width:${w}%;background:${v >= 0 ? color : 'var(--bad)'};opacity:${v >= 0 ? 1 : 0.55}"></b>`;
    };
    $('demand').innerHTML = `<h4><span>Demand</span><span>${taxNote}</span></h4>` + rows.map(([k, name, color, why]) => {
      const v = Math.max(-1, Math.min(1, d[k] ?? 0));
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
    if (!t || !map.inBounds(t.x, t.y)) { el.textContent = ''; return; }
    const i = map.idx(t.x, t.y);
    el.textContent = this.overlay === 'districts' ? (districtAt(g.state, i)?.name ?? 'no district')
      : `here: ${overlayValueText(this.overlay, map, i)}`;
  }

  toggleBudget(open) {
    const el = $('budget');
    el.classList.toggle('open', open);
    this.lastBudgetHtml = null;
    this.updateBudget();
  }

  updateBudget() {
    const el = $('budget');
    if (!el.classList.contains('open')) return;
    const s = this.game.state, b = monthlyBudget(s), E = CONFIG.economy;
    const row = (k, v, cls = '') => `<tr class="${cls}"><td>${k}</td><td>${money(v)}</td></tr>`;
    const nz = (k, v) => (Math.round(v) ? row(k, -v) : '');
    const net = b.totalIncome - b.totalExpenses;
    const runway = net < 0 && s.funds > 0 ? Math.floor(s.funds / -net) : null;
    const loans = s.loans ?? [];
    const advice = budgetAdvice(s);
    const html = `<button id="btnBudgetClose" class="x" aria-label="Close">×</button>
    <h3>Monthly budget <small>(projected at ${s.taxRate}% tax)</small></h3><table>
      <tr class="sep"><td>Income</td><td></td></tr>
      ${row('Residential tax', b.income.residential)}
      ${row('Commercial tax', b.income.commercial)}
      ${row('Industrial tax', b.income.industrial)}
      ${Math.round(b.income.utilitySales) ? row('Utility sales', b.income.utilitySales) : ''}${Math.round(b.income.offices) ? row('Office tax', b.income.offices) : ''}${Math.round(b.income.farms) ? row('Farm tax', b.income.farms) : ''}${Math.round(b.income.tourism) ? row('Tourists (hotels)', b.income.tourism) : ''}
      ${Math.round(b.income.visitors) ? row('Visitors (landmarks)', b.income.visitors) : ''}
      <tr class="sep"><td>Upkeep</td><td></td></tr>
      ${nz('Streets', b.expenses.roads)}${nz('Avenues', b.expenses.avenues)}${nz('Highways', b.expenses.highways)}
      ${nz('Bridges', b.expenses.bridges)}${nz('Lights & interchanges', b.expenses.junctions)}${nz('Parks', b.expenses.parks)}
      ${nz('Power & water', b.expenses.utilities)}${nz('Public services', b.expenses.services)}
      ${nz('Transit lines', b.expenses.transitLines)}${nz('Loan repayments', b.expenses.loans)}${nz('Ordinances', b.expenses.ordinances)}${nz('Utility imports', b.expenses.imports)}
      ${row('Net', net, 'total')}
    </table>
    ${this.fundingHtml(s)}
    ${runway != null ? `<p class="warnline">At this rate the money runs out in about ${runway} month${runway === 1 ? '' : 's'}.</p>` : ''}
    <div class="loans">
      <div><b>Loans</b> <span class="muted">${loans.length}/${E.maxLoans}${loans.length ? ` · ${loans.map((l) => `${Math.ceil(l.monthsLeft / 12)} yr left`).join(', ')}` : ''}</span></div>
      <span class="loanbtns">${loans.length ? (() => { const c = Math.min(...loans.map(loanPayoff)); return `<button id="btnRepay" ${c > s.funds ? 'disabled' : ''} title="Pay off a loan early">Repay $${c.toLocaleString()}</button>`; })() : ''}
      <button id="btnLoan" ${canTakeLoan(s) ? '' : 'disabled'} title="Repay $${E.loanPayment}/month for ${E.loanMonths / 12} years">Borrow $${E.loanAmount.toLocaleString()}</button></span>
    </div>
    ${advice.length ? `<h4>Advisor</h4><ul class="advice">${advice.map((a) => `<li>${a}</li>`).join('')}</ul>` : '<p class="muted">Advisor: the budget looks healthy.</p>'}`;
    if (html !== this.lastBudgetHtml) { el.innerHTML = html; this.lastBudgetHtml = html; }
  }

  // Service funding rows in the budget panel (only groups the city has buildings for).
  fundingHtml(s) {
    const B = CONFIG.budgets, have = s.stats.services ?? {};
    const rows = Object.entries(B.groups).filter(([g, d]) => d.kinds.some((k) => have[k]) || (g === 'parks' && s.stats.parks)).map(([g, d]) => {
      const f = s.budgets?.[g] ?? 1;
      let cost = d.kinds.reduce((a, k) => a + (have[k] ?? 0) * CONFIG.buildings[k].upkeep, 0);
      if (g === 'parks') cost += s.stats.parks * CONFIG.economy.parkMaintenance;
      return `<tr><td>${d.label}</td><td class="fund"><button data-fund="${g}" data-d="-1" ${f <= B.min ? 'disabled' : ''}>−</button>
        <b class="${f < 1 ? 'low' : f > 1 ? 'high' : ''}">${Math.round(f * 100)}%</b><button data-fund="${g}" data-d="1" ${f >= B.max ? 'disabled' : ''}>+</button></td>
        <td>${money(-cost * f)}</td></tr>`;
    });
    if (!rows.length) return '';
    return `<h4>Service funding</h4><table class="funding">${rows.join('')}</table>
      <p class="muted small">Less money shrinks a service's reach and effect; more stretches both a little.</p>`;
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
      const cap = jobCap(map, i);
      if (type === TILE.IND && lv > 0 && !ab && map.hasFlag(i, FLAG.HIGHTECH)) title = 'High-tech industry';
      if (type === TILE.COM && lv > 0 && !ab && map.hasFlag(i, FLAG.HOTEL)) title = 'Hotel';
      rows.push(['Density', ab ? 'Abandoned' : lv === 0 ? 'Vacant lot' : `${levelName(lv)} (${lv}/3)`]);
      if (!ab && lv > 0 && isHome(type)) rows.push(['Residents', homeCap(map, i)]);
      if (!ab && lv > 0 && cap) rows.push(['Jobs', cap]);
      if (type === TILE.COM) {
        const t = tourismScore(map, i);
        if (map.hasFlag(i, FLAG.HOTEL)) rows.push(['Tourists', `${money(CONFIG.economy.hotelIncome[lv] * (1 + t))}/mo`]);
        else if (t > CONFIG.zones.hotelThreshold * 0.6) notes.push(t >= CONFIG.zones.hotelThreshold ? (lv >= 2 ? 'Great spot for tourists: may become a hotel' : 'Great spot for tourists: a hotel may open here once it grows to medium density') : 'Nearly a tourist spot: a park, landmark or higher land value would attract hotels');
      }
      if (type !== TILE.RES && !ab && lv > 0) {
        const posts = cap * skilledShare(map, i);
        if (posts >= 0.5) rows.push(['Skilled jobs', `${Math.round(posts)} · ${Math.round(map.skillFill[i] * 100)}% filled`]);
      }
      rows.push(['Power · Water', `${supply(map.power[i])} ${supply(map.water[i])}`]);
    }
    if (type === TILE.SERVICE) {
      const k = KINDS[map.kind[i]], B = CONFIG.buildings[k];
      title = B.label;
      if (B.size) rows.push(['Size', `${B.size[0]}×${B.size[1]} landmark`]);
      if (B.income) rows.push(['Visitors', `${money(B.income * Math.min(1, g.state.stats.population / B.visitorsAt))}/mo in tickets`]);
      if (k === 'university') notes.push('Educates residents in reach: offices, big shops and high-tech industry need them');
      if (k === 'stadium') notes.push('Draws crowds: shops within reach do better, and residents are happier');
      if (B.power || k === 'pump') {
        const res = B.power ? 'power' : 'water', out = supplyOf(map, i, res);
        rows.push(['Output', `${out} ${res}`]);
        if (k === 'pump' && out < B.water) notes.push('Dry land: pumps within 2 tiles of water produce 3× more');
        if (map[res][i] !== SUPPLY.OK) notes.push('Not beside a road: its output isn\'t reaching anyone');
      }
      if (B.radius) rows.push(['Reach', `${B.radius} tiles`]);
      if (k === 'metro') {
        rows.push(['Riders', `${Math.round(map.riders[i])} / ${B.capacity} a month`]);
        if (map.riders[i] < 5) notes.push('No riders yet: people ride between metro stations, so build another near jobs or homes');
      }
      if (k === 'bus') {
        const served = (g.state.lines ?? []).filter((l) => l.stops.includes(i));
        rows.push(['Lines', served.length ? served.map((l) => `<i class="dchip" style="background:${l.color}"></i>${esc(l.name)}`).join(' ') : 'none']);
        rows.push(['Riders', `${Math.round(map.riders[i])} a month`]);
        if (!served.length) notes.push('Not on any line: pick a line under Transit lines, then click this stop');
        else if (map.riders[i] < 5) notes.push('Few riders: a line needs stops near homes and stops near jobs');
      }
      rows.push(['Upkeep', `${money(B.upkeep)}/mo`]);
      if (!B.power && k !== 'pump' && !B.park) rows.push(['Power · Water', `${supply(map.power[i])} ${supply(map.water[i])}`]);
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
      const jk = map.junctionKind(i);
      if (jk !== JUNCTION.NONE) {
        const what = jk === JUNCTION.MERGE ? 'Merge' : jk === JUNCTION.INTERSECTION ? 'Intersection' : 'Highway junction';
        const control = map.hasFlag(i, FLAG.INTERCHANGE) ? ' · interchange' : map.hasFlag(i, FLAG.LIGHTS) ? ' · traffic lights' : '';
        rows.push(['Junction', `${what}${control} · +${junctionDelay(map, i).toFixed(1)} min`]);
        const load = roadLoad(map, i);
        if (jk === JUNCTION.HIGHWAY && !map.hasFlag(i, FLAG.INTERCHANGE)) notes.push('Highway crossing at grade: an Interchange removes the bottleneck');
        else if (jk === JUNCTION.INTERSECTION && !map.hasFlag(i, FLAG.LIGHTS) && load > 0.7) notes.push('Busy intersection: traffic lights would cut the delay');
      }
    }
    if (isHome(type) && lv > 0 && !ab) rows.push(['Health', bar(map.health[i], 'hp')]);
    if (map.trash[i] > 3) rows.push(['Garbage', `${bar(map.trash[i], 'trash')}${map.coverage.landfill[i] < 0.02 && map.coverage.recycling[i] < 0.02 ? ' · no pickup' : ''}`]);
    if (isHome(type) && lv > 0 && !ab) {
      const c = map.commute[i], edu = map.education[i] / 2.55, target = educationTarget(map, i) * 100;
      rows.push(['Happiness', bar(map.happiness[i], 'hp')]);
      rows.push(['Skilled', `${Math.round(edu)}%${Math.abs(target - edu) >= 3 ? ` (${target > edu ? 'rising' : 'falling'} to ${Math.round(target)}%)` : ''}`]);
      rows.push(['Commute', Number.isFinite(c) ? `${Math.round(c)} min` : 'no job in reach']);
      rows.push(['Employed', `${Math.round(map.employed[i] * 100)}%`]);
    } else if (type === TILE.RES && Number.isFinite(map.commute[i])) {
      rows.push(['Nearest job', `${Math.round(map.commute[i])} min`]);
    }
    if (type === TILE.COM) rows.push(['Passing trips', Math.round(map.passing[i])]);
    if (map.hasFlag(i, FLAG.FIRE)) rows.unshift(['Status', '<span class="pill none">on fire</span>']);
    if (!water && (isZone(type) || type === TILE.SERVICE) && (lv > 0 || type === TILE.SERVICE)) {
      if (type !== TILE.SERVICE) rows.push(['Crime', bar(map.crime[i], 'crime')]);
      rows.push(['Fire risk', bar(map.fireRisk[i], 'firerisk')]);
    }
    if (!water) {
      rows.push(['Land value', bar(map.landValue[i], 'lv')]);
      rows.push(['Pollution', bar(map.pollution[i], 'pol')]);
      const cov = ['school', 'university', 'clinic', 'hospital', 'plaza', 'townpark', 'centralpark', 'stadium', 'recycling', 'landfill', 'police', 'fire']
        .filter((k) => map.coverage[k][i] > 0.05)
        .map((k) => ({ fire: 'fire station', townpark: 'town park', centralpark: 'central park' }[k] ?? k));
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
    const district = districtAt(g.state, i);
    if (district) rows.unshift(['District', `<i class="dchip" style="background:${district.color}"></i>${esc(district.name)}`]);
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
    const total = p.cost.total;
    const tool = this.game.tool, B = CONFIG.buildings[TOOLS[tool]?.building];
    if (TOOLS[tool]?.footprint) {
      tip.textContent = p.cost.blocked
        ? (!isUnlocked(this.game.state, TOOLS[tool].building) ? `Unlocks at ${B.unlock.toLocaleString()} residents` : `No room: needs ${B.size[0]}×${B.size[1]} clear land`)
        : `${B.label} · $${total.toLocaleString()}`;
      return;
    }
    if (tool === 'bus' && this.game.activeLine) {
      const line = this.game.state.lines?.find((l) => l.id === this.game.activeLine), h = this.game.hover, map = this.game.state.map;
      const onStop = h && map.inBounds(h.x, h.y) && isStop(map, map.idx(h.x, h.y));
      tip.className = '';
      tip.textContent = onStop ? `Add stop to ${line?.name}` : p.cost.count ? `New stop on ${line?.name} · $${total.toLocaleString()}` : 'Click a bus stop, or land beside a road';
      return;
    }
    if (tool === 'district') {
      const d = this.districtById(this.game.toolArg);
      tip.textContent = p.cost.count ? `${d ? `Paint ${d.name}` : 'Erase district'} · ${p.cost.count} tile${p.cost.count > 1 ? 's' : ''}` : 'Already painted';
      return;
    }
    tip.textContent = p.cost.count
      ? `${p.cost.count} tile${p.cost.count > 1 ? 's' : ''} · ${total < 0 ? `refund $${(-total).toLocaleString()}` : `$${total.toLocaleString()}`}`
      : 'Nothing to build here';
  }

  flashCost(amount) {
    if (amount) this.toast(amount > 0 ? `+${money(amount)} refund` : `${money(amount)}`, 'cost', 900);
  }

  drainEvents() {
    const ev = this.game.state.events;
    while (ev.length) {
      const e = ev.shift();
      if (e.achievement && !this.cityhall.onAchievement(e.achievement)) continue; // already earned in this browser
      if (e.scenario) this.showScenarioEnd(e.scenario);
      const t = this.toast(e.text, e.kind, e.kind === 'bad' || e.kind === 'achievement' ? 6000 : 3200, e.x != null ? { x: e.x, y: e.y } : null);
      if (e.goal || e.achievement) { t.classList.add('link'); t.addEventListener('click', () => this.cityhall.toggle(true)); }
      if (/^Budget:|In debt/.test(e.text)) { t.classList.add('link'); t.addEventListener('click', () => this.toggleBudget(true)); }
      if (this.game.state.bankrupt) this.showBankrupt();
    }
  }

  clearToasts() { $('toasts').replaceChildren(); }

  toast(text, kind = 'info', ms = 3200, at = null) {
    const box = $('toasts');
    const t = document.createElement('div');
    t.className = `toast ${kind}${at ? ' link' : ''}`;
    t.textContent = text;
    if (at) {
      // Click to fly the camera to the event and pin its tile info.
      t.addEventListener('click', () => {
        const g = this.game;
        g.renderer.centerOn(g.state.map, at.x, at.y);
        g.pinned = { x: at.x, y: at.y };
      });
    }
    box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, ms);
    return t;
  }

  // New-city dialog with a map-size choice.
  // New-city dialog: free play on a map size, or a scenario. onPick(size) or onScenario(id).
  newCityDialog(onPick, onScenario) {
    const m = $('modal');
    m.querySelector('h2').textContent = 'Start a new city?';
    const sizes = Object.entries(CONFIG.map.sizes);
    m.querySelector('p').innerHTML = 'Your current city will be lost unless you save it first.'
      + '<b class="dlg-h">Free play</b>'
      + `<span class="sizes">${sizes.map(([name, n]) => `<button data-size="${n}" class="${n === CONFIG.map.defaultSize ? 'sel' : ''}">${name}<small>${n}×${n}</small></button>`).join('')}</span>`
      + '<b class="dlg-h">Scenarios</b>'
      + `<span class="scenarios">${SCENARIO_ORDER.map((k) => { const S = SCENARIOS[k], won = this.cityhall.earned.has(`scenario:${k}`);
        return `<button data-scenario="${k}"><b>${S.name}${won ? ' 🏆' : ''}</b><small>${S.blurb} ${S.years} years.</small></button>`; }).join('')}</span>`;
    let pick = { size: CONFIG.map.defaultSize };
    const sel = (b) => { for (const o of m.querySelectorAll('[data-size],[data-scenario]')) o.classList.toggle('sel', o === b); };
    for (const b of m.querySelectorAll('[data-size]')) b.onclick = () => { pick = { size: Number(b.dataset.size) }; sel(b); };
    for (const b of m.querySelectorAll('[data-scenario]')) b.onclick = () => { pick = { scenario: b.dataset.scenario }; sel(b); };
    const ok = $('modalOk'), cancel = $('modalCancel');
    ok.textContent = 'Start';
    cancel.textContent = 'Cancel';
    cancel.hidden = false;
    m.hidden = false;
    const close = () => { m.hidden = true; ok.onclick = cancel.onclick = null; };
    ok.onclick = () => { close(); if (pick.scenario) onScenario(pick.scenario); else onPick(pick.size); };
    cancel.onclick = close;
  }

  showScenarioEnd(result) {
    const s = this.game.state, def = SCENARIOS[s.scenario?.id];
    if (!def) return;
    const m = $('modal');
    m.querySelector('h2').textContent = result === 'won' ? `🏆 ${def.name}: you did it!` : `${def.name}: time's up`;
    m.querySelector('p').textContent = result === 'won'
      ? `All goals met in ${s.year - (s.scenario.deadlineYear - def.years)} years. Keep building here in free play, or try another scenario.`
      : 'The deadline passed before every goal was met. You can keep playing this city in free play, or try again.';
    const ok = $('modalOk'), cancel = $('modalCancel');
    ok.textContent = 'Keep playing';
    cancel.textContent = 'New city…';
    cancel.hidden = false;
    m.hidden = false;
    this.game.setSpeed(0);
    ok.onclick = () => { m.hidden = true; ok.onclick = cancel.onclick = null; this.game.setSpeed(1); };
    cancel.onclick = () => { m.hidden = true; ok.onclick = cancel.onclick = null; this.newCityDialog((size) => this.game.newCity(size), (id) => this.game.newScenario(id)); };
  }

  updateExpandButton() {
    const map = this.game.state.map, next = CONFIG.map.expandSteps.find((n) => n > Math.max(map.width, map.height));
    const b = $('btnExpand');
    b.disabled = !next;
    b.textContent = next ? `Expand map to ${next}×${next}…` : 'Map is at its largest';
  }

  // Small text prompt in the modal.
  prompt(title, label, value, onOk) {
    const m = $('modal');
    m.querySelector('h2').textContent = title;
    m.querySelector('p').innerHTML = `<label class="field">${esc(label)}<input id="modalInput" maxlength="40" value="${esc(value)}"></label>`;
    const ok = $('modalOk'), cancel = $('modalCancel'), input = $('modalInput');
    ok.textContent = 'Save';
    cancel.textContent = 'Cancel';
    cancel.hidden = false;
    m.hidden = false;
    input.focus();
    input.select();
    const close = () => { m.hidden = true; ok.onclick = cancel.onclick = input.onkeydown = null; };
    const done = () => { const v = input.value.trim(); close(); if (v) onOk(v.slice(0, 40)); };
    ok.onclick = done;
    cancel.onclick = close;
    input.onkeydown = (e) => { if (e.key === 'Enter') done(); if (e.key === 'Escape') close(); };
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
