// Save / load: serialise persistent state to JSON. Derived layers are recomputed on load.

import { GameMap, TILE, highwayEntry, PERSISTENT_LAYERS } from './map.js';
import { CONFIG } from './config.js';
import { refreshFields, emptyHistory, DEFAULT_CITY_NAME } from './simulation.js';
import { CHAINS, SCENARIOS, emptyGoals, startChain } from './goals.js';
import { ORDINANCE_ORDER } from './cityhall.js';
import { migrateStops, lineColor } from './transit.js';

const VERSION = 5;
const LAYERS = PERSISTENT_LAYERS;
// Layers added after v1; older saves simply don't have them (defaults to zeros).
const OPTIONAL_LAYERS = new Set(['roadClass', 'kind', 'part', 'district', 'education', 'rail', 'roadMod']);

// Uint8 layer -> base64 string (compact and JSON-safe)
function encode(arr) {
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}
function decode(str, n) {
  const s = atob(str), out = new Uint8Array(n);
  if (s.length !== n) throw new Error('Layer size mismatch');
  for (let i = 0; i < n; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function serialize(state) {
  const m = state.map;
  const layers = {};
  for (const k of LAYERS) layers[k] = encode(m[k]);
  return {
    game: 'gridline',
    version: VERSION,
    savedAt: new Date().toISOString(),
    map: { width: m.width, height: m.height, seed: m.seed ?? null, layers },
    tick: state.tick, month: state.month, year: state.year,
    funds: state.funds, taxRate: state.taxRate,
    demand: state.demand, negativeMonths: state.negativeMonths,
    milestones: state.milestones, lastMonth: state.lastMonth,
    utilityGrace: state.utilityGrace,
    loans: state.loans ?? [],
    cityName: state.cityName,
    districts: state.districts ?? [],
    history: state.history,
    ordinances: state.ordinances ?? {},
    budgets: state.budgets ?? {},
    tradeDeals: state.tradeDeals ?? {},
    lines: state.lines ?? [],
    garbageGrace: state.garbageGrace | 0,
    rating: state.rating,
    goals: state.goals,
    scenario: state.scenario,
    achievements: state.achievements ?? [],
    news: (state.news ?? []).slice(-CONFIG.news.keep),
    loansPaid: state.loansPaid ?? 0,
    positiveMonths: state.positiveMonths ?? 0,
  };
}

function readDistricts(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((d) => d && (d.id | 0) > 0).map((d) => ({
    id: d.id | 0,
    name: String(d.name ?? `District ${d.id}`).slice(0, 40),
    color: typeof d.color === 'string' ? d.color : CONFIG.districts.colors[(d.id - 1) % CONFIG.districts.colors.length],
    policies: {
      height: [1, 2, 3].includes(d.policies?.height) ? d.policies.height : 3,
      noHeavyIndustry: !!d.policies?.noHeavyIndustry,
      taxBreak: !!d.policies?.taxBreak,
    },
  }));
}

function readHistory(h) {
  if (!h || !Array.isArray(h.samples)) return emptyHistory();
  return { samples: h.samples.filter((x) => x && typeof x === 'object') };
}

export function deserialize(data) {
  if (!data || data.game !== 'gridline') throw new Error('Not a Gridline save file');
  if (data.version > VERSION) throw new Error('Save is from a newer version');
  const { width, height, layers } = data.map;
  const map = new GameMap(width, height);
  map.seed = data.map.seed;
  for (const k of LAYERS) {
    if (layers[k] == null && OPTIONAL_LAYERS.has(k)) continue;
    map[k] = decode(layers[k], width * height);
  }
  map.educationReady = layers.education != null;
  if ((data.version | 0) < 2) migrateV1(map);
  map.computeWaterDistance();
  map.roadsDirty = true;
  const state = {
    map,
    tick: data.tick | 0, month: data.month | 0, year: data.year | 0,
    funds: Number(data.funds) || 0,
    taxRate: Number.isFinite(Number(data.taxRate)) && data.taxRate != null ? Number(data.taxRate) : CONFIG.economy.taxRate,
    demand: { r: 0, c: 0, i: 0, ...data.demand },
    stats: null, lastMonth: data.lastMonth ?? null,
    negativeMonths: data.negativeMonths | 0, bankrupt: false,
    milestones: Array.isArray(data.milestones) ? data.milestones : [],
    events: [], rng: Math.random,
    utilityGrace: data.utilityGrace | 0,
    loans: Array.isArray(data.loans) ? data.loans.map((l) => ({ monthsLeft: l.monthsLeft | 0, payment: Number(l.payment) || 0 })) : [],
    traffic: { workers: 0, employed: 0, avgCommute: 0, freightTrips: 0, congested: 0 },
    utilities: { power: { supply: 0, demand: 0 }, water: { supply: 0, demand: 0 } },
    happiness: 0,
    crime: 0,
    fires: 0,
    cityName: typeof data.cityName === 'string' && data.cityName.trim() ? data.cityName.slice(0, 40) : DEFAULT_CITY_NAME,
    districts: readDistricts(data.districts),
    history: readHistory(data.history),
    ordinances: Object.fromEntries(ORDINANCE_ORDER.filter((k) => data.ordinances?.[k]).map((k) => [k, true])),
    rating: Number.isFinite(data.rating) ? data.rating : CONFIG.mayor.start,
    goals: data.goals && (data.goals.chain == null || CHAINS[data.goals.chain])
      ? { ...emptyGoals(), ...data.goals, done: Array.isArray(data.goals.done) ? data.goals.done : [] } : null,
    scenario: data.scenario && SCENARIOS[data.scenario.id] ? { banned: [], ...data.scenario } : null,
    achievements: Array.isArray(data.achievements) ? data.achievements : [],
    news: Array.isArray(data.news) ? data.news : [],
    budgets: Object.fromEntries(Object.keys(CONFIG.budgets.groups).filter((g) => Number.isFinite(data.budgets?.[g]))
      .map((g) => [g, Math.max(CONFIG.budgets.min, Math.min(CONFIG.budgets.max, Math.round(data.budgets[g] * 10) / 10))])),
    garbageGrace: data.garbageGrace | 0,
    tradeDeals: Object.fromEntries(['buy_power', 'sell_power', 'buy_water', 'sell_water'].filter((k) => data.tradeDeals?.[k]).map((k) => [k, true])),
    trade: {},
    lines: Array.isArray(data.lines) ? data.lines.filter((l) => l && (l.id | 0) > 0 && Array.isArray(l.stops)).map((l, n) => ({
      id: l.id | 0, name: String(l.name ?? `Line ${l.id}`).slice(0, 30), color: typeof l.color === 'string' ? l.color : lineColor(n),
      mode: l.mode === 'tram' ? 'tram' : 'bus', stops: l.stops.map((i) => i | 0), freq: Math.max(1, Math.min(CONFIG.transit.maxFreq, l.freq | 0 || 1)),
    })) : null,
    garbage: { made: 0, capacity: 0, uncollected: 0 },
    health: 0,
    loansPaid: data.loansPaid | 0,
    positiveMonths: data.positiveMonths | 0,
  };
  // Tiles pointing at a district that no longer exists lose it.
  const ids = new Set(state.districts.map((d) => d.id));
  for (let i = 0; i < map.size; i++) if (map.district[i] && !ids.has(map.district[i])) map.district[i] = 0;
  // Cities from before utilities existed get time to build power and water.
  if ((data.version | 0) < 3) {
    let dense = false;
    for (let i = 0; i < map.size && !dense; i++) if (map.level[i] >= 2) dense = true;
    if (dense) {
      state.utilityGrace = CONFIG.utilities.graceMonths;
      state.events.push({ text: `New: power & water! You have ${state.utilityGrace} months to supply your denser buildings.`, kind: 'bad' });
    }
  }
  // Cities from before transit lines join their bus stops into one line.
  if (!state.lines) migrateStops(state);
  // Cities from before garbage existed get time to build a landfill.
  if ((data.version | 0) < 5) {
    let pop = 0;
    for (let i = 0; i < map.size; i++) if (map.type[i] === TILE.RES) pop += CONFIG.capacity.residential[map.level[i]];
    if (pop >= CONFIG.garbage.startPop) {
      state.garbageGrace = CONFIG.garbage.graceMonths;
      state.events.push({ text: `New: garbage! Build a landfill within ${state.garbageGrace} months before rubbish piles up.`, kind: 'bad' });
    }
  }
  refreshFields(state);
  // Cities saved before goals existed start on the career goals, skipping what they've already done.
  if (!state.goals) startChain(state, 'career');
  return state;
}

// v1 had no avenues. New maps start with the regional highway as an avenue,
// so give v1 cities the same (free) upgrade — otherwise commuters would jam it.
function migrateV1(map) {
  const { row: highwayRow, length: highwayLength } = highwayEntry(map.width, map.height);
  if (highwayRow >= map.height) return;
  for (let x = 0; x < Math.min(highwayLength, map.width); x++) {
    const i = map.idx(x, highwayRow);
    if (map.type[i] === TILE.ROAD) map.roadClass[i] = 1;
  }
}

export function downloadSave(state) {
  const blob = new Blob([JSON.stringify(serialize(state))], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = `${state.year}-${String(state.month + 1).padStart(2, '0')}`;
  a.download = `gridline-city-${d}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function readSaveFile(file) {
  return file.text().then((txt) => deserialize(JSON.parse(txt)));
}

const AUTOSAVE_KEY = 'gridline.autosave';
export function autosave(state) {
  try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serialize(state))); } catch { /* storage unavailable */ }
}
export function loadAutosave() {
  try {
    const s = localStorage.getItem(AUTOSAVE_KEY);
    return s ? deserialize(JSON.parse(s)) : null;
  } catch { return null; }
}
export function clearAutosave() {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
}
