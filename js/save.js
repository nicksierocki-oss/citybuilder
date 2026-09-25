// Save / load: serialise persistent state to JSON. Derived layers are recomputed on load.

import { GameMap, TILE, highwayEntry } from './map.js';
import { refreshFields } from './simulation.js';

const VERSION = 2;
const LAYERS = ['terrain', 'type', 'level', 'flags', 'variant', 'roadClass'];
// Layers added after v1; older saves simply don't have them (defaults to zeros).
const OPTIONAL_LAYERS = new Set(['roadClass']);

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
  };
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
  if ((data.version | 0) < 2) migrateV1(map);
  map.computeWaterDistance();
  map.roadsDirty = true;
  const state = {
    map,
    tick: data.tick | 0, month: data.month | 0, year: data.year | 0,
    funds: Number(data.funds) || 0, taxRate: Number(data.taxRate) || 0,
    demand: { r: 0, c: 0, i: 0, ...data.demand },
    stats: null, lastMonth: data.lastMonth ?? null,
    negativeMonths: data.negativeMonths | 0, bankrupt: false,
    milestones: Array.isArray(data.milestones) ? data.milestones : [],
    events: [], rng: Math.random,
  };
  refreshFields(state);
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
