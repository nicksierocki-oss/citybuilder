// @ts-check
// Save / load: serialise persistent state to JSON. Derived layers are recomputed on load.

import { GameMap, TILE, TERRAIN, FLAG, ROAD_CLASS, KINDS, highwayEntry } from './map.js';
import { CONFIG } from './config.js';
import { refreshFields } from './simulation.js';

const VERSION = 3;
const LAYERS = ['terrain', 'type', 'level', 'flags', 'variant', 'roadClass', 'kind'];
// Layers added after v1; older saves simply don't have them (defaults to zeros).
const OPTIONAL_LAYERS = new Set(['roadClass', 'kind']);

// Uint8 layer -> base64 string (compact and JSON-safe)
function encode(arr) {
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}
function decode(str, n) {
  if (typeof str !== 'string') throw new Error('Save file is damaged (missing map data)');
  let s;
  try { s = atob(str); } catch { throw new Error('Save file is damaged (bad map data)'); }
  const out = new Uint8Array(n);
  if (s.length !== n) throw new Error('Save file is damaged (map size mismatch)');
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
  };
}

export function deserialize(data) {
  if (!data || data.game !== 'gridline') throw new Error('Not a Gridline save file');
  if (data.version > VERSION) throw new Error('Save is from a newer version');
  const { width, height, layers } = data.map ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < MIN_DIM || height < MIN_DIM
    || width > MAX_DIM || height > MAX_DIM || !layers || typeof layers !== 'object') {
    throw new Error('Save file is damaged (bad map size)');
  }
  const map = new GameMap(width, height);
  map.seed = Number.isFinite(data.map.seed) ? data.map.seed : null;
  for (const k of LAYERS) {
    if (layers[k] == null && OPTIONAL_LAYERS.has(k)) continue;
    map[k] = decode(layers[k], width * height);
  }
  sanitizeLayers(map);
  if ((data.version | 0) < 2) migrateV1(map);
  map.computeWaterDistance();
  map.roadsDirty = true;
  const E = CONFIG.economy, d = data.demand ?? {}, lm = data.lastMonth;
  const state = {
    map,
    tick: Math.max(0, data.tick | 0), month: clamp(data.month | 0, 0, 11), year: data.year | 0 || CONFIG.time.startYear,
    funds: num(data.funds, 0),
    taxRate: data.taxRate == null ? E.taxRate : clamp(num(data.taxRate, E.taxRate), E.taxRateMin, E.taxRateMax),
    demand: { r: clamp(num(d.r, 0), -1, 1), c: clamp(num(d.c, 0), -1, 1), i: clamp(num(d.i, 0), -1, 1) },
    stats: null,
    // Only the headline numbers are shown before the next month closes; the breakdown is rebuilt then.
    lastMonth: lm && typeof lm === 'object' ? { income: num(lm.income, 0), expenses: num(lm.expenses, 0), net: num(lm.net, 0) } : null,
    negativeMonths: Math.max(0, data.negativeMonths | 0), bankrupt: false,
    milestones: Array.isArray(data.milestones) ? data.milestones.filter(Number.isFinite) : [],
    events: [], rng: Math.random,
    utilityGrace: Math.max(0, data.utilityGrace | 0),
    loans: Array.isArray(data.loans) ? data.loans.filter((l) => l && typeof l === 'object').slice(0, E.maxLoans)
      .map((l) => ({ monthsLeft: clamp(l.monthsLeft | 0, 1, E.loanMonths), payment: Math.max(0, num(l.payment, E.loanPayment)) })) : [],
    traffic: { workers: 0, employed: 0, avgCommute: 0, freightTrips: 0, congested: 0 },
    utilities: { power: { supply: 0, demand: 0 }, water: { supply: 0, demand: 0 } },
    happiness: 0,
    crime: 0,
    fires: 0,
  };
  // Cities from before utilities existed get time to build power and water.
  if ((data.version | 0) < 3) {
    let dense = false;
    for (let i = 0; i < map.size && !dense; i++) if (map.level[i] >= 2) dense = true;
    if (dense) {
      state.utilityGrace = CONFIG.utilities.graceMonths;
      state.events.push({ text: `New: power & water! You have ${state.utilityGrace} months to supply your denser buildings.`, kind: 'bad' });
    }
  }
  refreshFields(state);
  return state;
}

const MIN_DIM = 8, MAX_DIM = 512;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, def) => (v != null && Number.isFinite(Number(v)) ? Number(v) : def);

// Hand-edited or damaged saves must not put unknown values in the map: the renderers
// and simulation index lookup tables by these. Limits come from the enums, so new
// tile types, flags, road classes and KINDS are accepted automatically.
const MAX_LEVEL = 3;
const maxOf = (o) => Math.max(...Object.values(o));
export function sanitizeLayers(map) {
  const maxTerrain = maxOf(TERRAIN), maxType = maxOf(TILE), maxRoad = maxOf(ROAD_CLASS);
  const flagMask = Object.values(FLAG).reduce((a, b) => a | b, 0);
  let fixed = 0;
  for (let i = 0; i < map.size; i++) {
    const t = map.terrain[i], ty = map.type[i], lv = map.level[i], fl = map.flags[i], rc = map.roadClass[i], k = map.kind[i];
    if (map.terrain[i] > maxTerrain) map.terrain[i] = TERRAIN.GRASS;
    if (map.type[i] > maxType) map.type[i] = TILE.EMPTY;
    if (map.level[i] > MAX_LEVEL) map.level[i] = MAX_LEVEL;
    map.flags[i] &= flagMask;
    if (map.type[i] === TILE.ROAD) { if (map.roadClass[i] > maxRoad) map.roadClass[i] = maxRoad; } else map.roadClass[i] = 0;
    if (map.type[i] === TILE.SERVICE) {
      if (!map.kind[i] || map.kind[i] >= KINDS.length) { map.type[i] = TILE.EMPTY; map.kind[i] = 0; map.level[i] = 0; }
    } else map.kind[i] = 0;
    if (t !== map.terrain[i] || ty !== map.type[i] || lv !== map.level[i] || fl !== map.flags[i] || rc !== map.roadClass[i] || k !== map.kind[i]) fixed++;
  }
  return fixed; // tiles repaired (0 for any save the game itself wrote)
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
// The city an autosave replaced (new city, reset, or a save that failed to load), so a
// mistake or a bug never destroys a city outright. "Restore previous city" swaps it back.
const BACKUP_KEY = 'gridline.autosave.previous';
export function autosave(state) {
  try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serialize(state))); } catch { /* storage unavailable */ }
}
// Returns { state } on success, { error } if a save exists but could not be loaded
// (it is then kept as the backup), or null when there is no save.
export function loadAutosave() {
  let raw = null;
  try { raw = localStorage.getItem(AUTOSAVE_KEY); } catch { return null; }
  if (!raw) return null;
  try { return { state: deserialize(JSON.parse(raw)) }; } catch (err) {
    try { localStorage.setItem(BACKUP_KEY, raw); } catch { /* ignore */ }
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
// Moves the current autosave to the backup slot instead of deleting it.
export function clearAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) localStorage.setItem(BACKUP_KEY, raw);
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch { /* ignore */ }
}
export function hasBackup() {
  try { return !!localStorage.getItem(BACKUP_KEY); } catch { return false; }
}
// Loads the backup city; the city being replaced becomes the new backup (so it can be undone).
export function restoreBackup(current) {
  const raw = localStorage.getItem(BACKUP_KEY);
  if (!raw) throw new Error('No previous city saved');
  const state = deserialize(JSON.parse(raw));
  localStorage.setItem(BACKUP_KEY, JSON.stringify(serialize(current)));
  localStorage.setItem(AUTOSAVE_KEY, raw);
  return state;
}
