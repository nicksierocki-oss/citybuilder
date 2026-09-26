// Headless regression tests: save round-trip, damaged-save fuzzing, undo, automatic transit
// routes, the autosave backup slot.
// Run: node tools/test.js   (exits non-zero on failure)

import assert from 'node:assert/strict';
import { createGame, tick, refreshFields } from '../js/simulation.js';
import { serialize, deserialize, sanitizeLayers, autosave, loadAutosave, clearAutosave, hasBackup, restoreBackup } from '../js/save.js';
import { applyTool, undoAction } from '../js/economy.js';
import { TILE, TERRAIN, KINDS, KIND_ID, FLAG, PERSISTENT_LAYERS, highwayEntry, footprintSize } from '../js/map.js';
import { layTramTrack } from '../js/transit.js';
import { MAYOR_LEVELS, levelFromAchievements } from '../js/goals.js';
import { monthlyBudget } from '../js/economy.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); } catch (err) { failed++; console.log(`FAIL ${name}\n     ${err.stack.split('\n').slice(0, 4).join('\n     ')}`); }
}

// Deterministic RNG so failures reproduce.
function rng(seed) { let a = seed >>> 0; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); }

// A dense city with every zone type, road class and one-tile building kind, built directly.
function builtCity() {
  const s = createGame(42, 64), m = s.map;
  const zones = [TILE.RES, TILE.COM, TILE.IND, TILE.PARK, TILE.OFFICE, TILE.FARM, TILE.MIXED];
  const small = KINDS.filter((k) => k && footprintSize(k)[0] === 1 && footprintSize(k)[1] === 1);
  let k = 0;
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
    const i = m.idx(x, y);
    if (m.terrain[i] !== TERRAIN.GRASS) continue;
    if (x % 4 === 0 || y % 4 === 0) { m.type[i] = TILE.ROAD; m.roadClass[i] = (x + y) % 3; }
    else { m.type[i] = zones[(x + y) % zones.length]; m.level[i] = 1 + ((x * y) % 3); m.roadClass[i] = 0; }
    if (x % 8 === 6 && y % 8 === 6) { m.type[i] = TILE.SERVICE; m.kind[i] = KIND_ID[small[k]]; m.level[i] = 0; k = (k + 1) % small.length; }
  }
  m.roadsDirty = true;
  m.version++;
  s.funds = 1e6;
  for (let t = 0; t < 40; t++) tick(s);
  return s;
}

// A small city on the regional road: homes to the west, industry to the east, a street between.
function streetCity() {
  const s = createGame(5, 64), m = s.map;
  s.funds = 1e6;
  const { row, length: x0 } = highwayEntry(m.width, m.height);
  const tiles = (x1, x2, y1, y2) => { const o = []; for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) o.push(m.idx(x, y)); return o; };
  applyTool(s, 'road', tiles(x0, x0 + 40, row, row));
  applyTool(s, 'residential', tiles(x0, x0 + 13, row - 3, row - 1));
  applyTool(s, 'industrial', tiles(x0 + 26, x0 + 39, row + 1, row + 3));
  return { s, m, row, x0 };
}

test('save round-trip keeps every persistent value', () => {
  const s = builtCity();
  const a = serialize(s), b = serialize(deserialize(JSON.parse(JSON.stringify(a))));
  delete a.savedAt; delete b.savedAt;
  assert.deepEqual(b.map, a.map);
  for (const f of ['tick', 'month', 'year', 'funds', 'taxRate', 'milestones', 'loans', 'districts', 'budgets']) assert.deepEqual(b[f], a[f], f);
});

test('loader repair leaves a valid city untouched', () => {
  const s = builtCity();
  for (let i = 0; i < s.map.size; i++) if (s.map.type[i] === TILE.RES && i % 5 === 0) s.map.setFlag(i, FLAG.ABANDONED, true);
  assert.equal(sanitizeLayers(s.map), 0, 'a save written by the game must not need repair');
});

test('loader repair leaves a landmark untouched', () => {
  const s = createGame(8, 64), m = s.map;
  s.funds = 1e6;
  const { row, length: x0 } = highwayEntry(m.width, m.height);
  const [w] = footprintSize('townpark');
  const road = []; for (let x = x0; x < x0 + 10; x++) road.push(m.idx(x, row));
  applyTool(s, 'road', road);
  const park = []; for (let dy = 0; dy < w; dy++) for (let dx = 0; dx < w; dx++) park.push(m.idx(x0 + 2 + dx, row + 1 + dy));
  s.population = 1e6; if (s.stats) s.stats.population = 1e6;
  const r = applyTool(s, 'townpark', park);
  assert.ok(r.applied, 'town park built');
  assert.equal(sanitizeLayers(m), 0);
});

test('damaged saves load repaired or are rejected, never crash', () => {
  const base = serialize(builtCity()), r = rng(7);
  const junk = [null, 'x', -5, 1e308, NaN, {}, [], '<b>x</b>', true, Infinity];
  const pick = (arr) => arr[(r() * arr.length) | 0];
  for (let n = 0; n < 120; n++) {
    const d = structuredClone(base);
    for (const k of Object.keys(d.map.layers)) {
      const c = atob(d.map.layers[k]).split('');
      for (let j = 0; j < 40; j++) c[(r() * c.length) | 0] = String.fromCharCode((r() * 256) | 0);
      d.map.layers[k] = btoa(c.join(''));
    }
    for (const f of ['tick', 'month', 'year', 'funds', 'taxRate', 'demand', 'milestones', 'loans', 'lastMonth', 'utilityGrace', 'negativeMonths',
      'districts', 'budgets', 'ordinances', 'tradeDeals', 'history', 'news', 'achievements', 'goals', 'rating', 'lines']) {
      if (r() < 0.3) d[f] = pick(junk);
    }
    if (n % 10 === 0) d.map.width = pick(junk);
    if (n % 17 === 0) d.map.layers.type = 12;
    let s;
    try { s = deserialize(d); } catch (err) {
      assert.match(err.message, /damaged|Not a Gridline|newer/, `unexpected loader error: ${err.message}`);
      continue;
    }
    for (let t = 0; t < 24; t++) tick(s);
    assert.ok(Number.isFinite(s.funds) && Number.isFinite(s.taxRate), 'funds and tax stay numbers');
    assert.ok(s.month >= 0 && s.month < 12, 'month in range');
  }
});

test('undo restores tiles and money, newest first', () => {
  const s = createGame(3, 64), m = s.map;
  const snap = () => PERSISTENT_LAYERS.map((k) => m[k].slice());
  const before = snap(), funds0 = s.funds;
  const { row, length: x0 } = highwayEntry(m.width, m.height);
  const tiles = [];
  for (let x = x0; x < x0 + 10; x++) tiles.push(m.idx(x, row));
  const a = applyTool(s, 'road', tiles);
  assert.ok(a.applied > 0);
  const afterRoad = snap(), fundsRoad = s.funds;
  const b = applyTool(s, 'residential', tiles.map((i) => i - m.width));
  assert.ok(b.applied > 0);
  assert.ok(undoAction(s, b.undo));
  assert.deepEqual(snap(), afterRoad);
  assert.equal(s.funds, fundsRoad);
  assert.ok(undoAction(s, a.undo));
  assert.deepEqual(snap(), before);
  assert.equal(s.funds, funds0);
});

test('undo of a demolition restores the building and takes the refund back', () => {
  const s = createGame(3, 64), m = s.map;
  const { row, length: x0 } = highwayEntry(m.width, m.height);
  const road = []; for (let x = x0; x < x0 + 6; x++) road.push(m.idx(x, row));
  applyTool(s, 'road', road);
  const i = m.idx(x0 + 3, row + 1);
  assert.ok(applyTool(s, 'school', [i]).applied);
  const funds0 = s.funds;
  const d = applyTool(s, 'bulldoze', [i]);
  assert.equal(m.type[i], TILE.EMPTY);
  assert.ok(s.funds > funds0, 'demolition refunds');
  assert.ok(undoAction(s, d.undo));
  assert.equal(m.type[i], TILE.SERVICE);
  assert.equal(m.kind[i], KIND_ID.school);
  assert.equal(s.funds, funds0);
});

test('bus stops among homes and jobs link up into a route by themselves', () => {
  const { s, m, row, x0 } = streetCity();
  for (const x of [x0 + 2, x0 + 8, x0 + 13]) assert.ok(applyTool(s, 'bus', [m.idx(x, row + 1)]).applied);
  for (const x of [x0 + 28, x0 + 36]) assert.ok(applyTool(s, 'bus', [m.idx(x, row - 1)]).applied);
  refreshFields(s);
  assert.equal(s.lines.length, 1, 'one route');
  const line = s.lines[0];
  assert.equal(line.stops.length, 5, 'every stop is on it');
  assert.match(line.name, /Homes → Industry/);
  assert.equal(line.homeStops, 3, 'starts among the homes');
  assert.ok(s.transitRoutes[line.id].ok, 'route found along the road');
  assert.equal(line.mode, 'bus');
  for (let t = 0; t < 400; t++) tick(s);
  assert.ok(s.lineStats[s.lines[0].id].riders > 0, 'people ride it');
});

test('a lone stop is on no route; a second one links them', () => {
  const { s, m, row, x0 } = streetCity();
  applyTool(s, 'bus', [m.idx(x0 + 5, row + 1)]);
  refreshFields(s);
  assert.equal(s.lines.length, 0);
  applyTool(s, 'bus', [m.idx(x0 + 30, row - 1)]);
  refreshFields(s);
  assert.equal(s.lines.length, 1);
});

test('downgrading a road keeps the buildings beside it and refunds part of the price', () => {
  const { s, m, row, x0 } = streetCity();
  const road = []; for (let x = x0; x < x0 + 10; x++) road.push(m.idx(x, row));
  assert.ok(applyTool(s, 'upgrade', road).applied === 10, 'street to avenue');
  const homes = road.map((i) => i - m.width);
  for (const i of homes) m.level[i] = 2;
  const funds = s.funds;
  const r = applyTool(s, 'downgrade', road);
  assert.equal(r.applied, 10);
  assert.ok(s.funds > funds, 'refunded');
  for (const i of road) { assert.equal(m.type[i], TILE.ROAD); assert.equal(m.roadClass[i], 0); }
  for (const i of homes) assert.equal(m.level[i], 2, 'homes untouched');
  assert.equal(applyTool(s, 'downgrade', road).applied, 0, 'a street cannot go lower');
  assert.ok(undoAction(s, r.undo) && m.roadClass[road[0]] === 1, 'undo brings the avenue back');
});

test('an overloaded school stretches thin and says so', () => {
  const { s, m, row, x0 } = streetCity();
  for (let i = 0; i < m.size; i++) if (m.type[i] === TILE.RES) m.level[i] = 3;
  m.version++;
  assert.ok(applyTool(s, 'school', [m.idx(x0 + 5, row + 1)]).applied);
  refreshFields(s);
  const [entry] = Object.values(s.serviceLoad);
  assert.equal(entry.kind, 'school');
  assert.ok(entry.load > entry.capacity, `load ${entry.load} over ${entry.capacity}`);
  assert.equal(s.serviceUse.school.full, 1);
  const full = s.map.coverage.school[m.idx(x0 + 5, row + 2)];
  assert.ok(full < 1 && full >= 0.35, 'coverage scaled down but not below the floor');
  m.level.fill(0); refreshFields(s);
  assert.equal(Object.values(s.serviceLoad)[0].load, 0, 'no homes, no load');
});

test('airport, seaport and attractions bring visitors and money', () => {
  const { s, m, row, x0 } = streetCity();
  const rect = (x1, y1, x2, y2) => { const o = []; for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) o.push(m.idx(x, y)); return o; };
  for (let i = 0; i < m.size; i++) if (m.type[i] !== TILE.ROAD) { m.type[i] = TILE.EMPTY; m.level[i] = 0; }
  m.version++;
  assert.equal(applyTool(s, 'airport', rect(x0 + 2, row + 1, x0 + 6, row + 3)).applied, 0, 'locked below 3,000 residents');
  s.stats.population = 20000;
  assert.equal(applyTool(s, 'airport', rect(x0 + 2, row + 1, x0 + 6, row + 3)).applied, 15);
  assert.equal(applyTool(s, 'museum', rect(x0 + 8, row - 2, x0 + 9, row - 1)).applied, 4);
  assert.equal(applyTool(s, 'seaport', rect(x0 + 12, row + 5, x0 + 14, row + 7)).applied, 0, 'a seaport needs the shore');
  assert.equal(applyTool(s, 'pyramid', rect(x0 + 16, row - 3, x0 + 18, row - 1)).applied, 0, 'monuments wait for the mayor level');
  s.mayorLevel = MAYOR_LEVELS.length;
  assert.equal(applyTool(s, 'pyramid', rect(x0 + 16, row - 3, x0 + 18, row - 1)).applied, 9);
  refreshFields(s);
  const t = s.tourism;
  assert.equal(t.airports, 1);
  assert.ok(t.byMode.air > 0 && t.visitors > 0, 'tourists fly in');
  assert.ok(t.prestige > 0);
  const b = monthlyBudget(s).income;
  assert.ok(b.attractions > 0 && b.airport > 0, 'tickets and airport fees');
  const a = serialize(s), back = deserialize(JSON.parse(JSON.stringify(a)));
  assert.equal(back.mayorLevel, s.mayorLevel, 'level saved');
});

test('mayor levels promote from achievements and pay once', () => {
  const s = createGame(9, 40);
  assert.equal(s.mayorLevel, 1);
  for (const L of MAYOR_LEVELS) assert.ok(L.achievements.length >= 10 && L.achievements.length <= 15, `${L.title} has 10-15 achievements`);
  const ids = MAYOR_LEVELS.flatMap((L) => L.achievements.map((a) => a.id));
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  s.achievements = MAYOR_LEVELS[0].achievements.slice(0, MAYOR_LEVELS[0].need).map((a) => a.id);
  assert.equal(levelFromAchievements(s.achievements), 2);
  const funds = s.funds;
  while (s.tick % 8 !== 7) tick(s);
  tick(s);
  assert.equal(s.mayorLevel, 2, 'promoted');
  assert.ok(s.funds >= funds + MAYOR_LEVELS[0].reward - 2000, 'reward paid');
  const d = serialize(s); delete d.mayorLevel;
  assert.equal(deserialize(JSON.parse(JSON.stringify(d))).mayorLevel, 2, 'older saves work their level out');
});

test('stops with only homes around them make no route that goes nowhere', () => {
  const { s, m, row, x0 } = streetCity();
  for (let i = 0; i < m.size; i++) if (m.type[i] === TILE.IND) m.type[i] = TILE.EMPTY;
  m.version++;
  for (const x of [x0 + 2, x0 + 8]) applyTool(s, 'bus', [m.idx(x, row + 1)]);
  refreshFields(s);
  assert.equal(s.lines.length, 0, 'no homes-to-homes line');
  assert.equal(s.unroutedStops.length, 2, 'both stops are listed as on no route');
  assert.match(s.unroutedStops[0].why, /jobs/);
});

test('laying tram track turns a route into a tram line', () => {
  const { s, m, row, x0 } = streetCity();
  applyTool(s, 'bus', [m.idx(x0 + 5, row + 1)]);
  applyTool(s, 'bus', [m.idx(x0 + 30, row - 1)]);
  refreshFields(s);
  const funds = s.funds;
  assert.ok(layTramTrack(s, s.lines[0]));
  assert.ok(s.funds < funds, 'track costs money');
  refreshFields(s);
  assert.equal(s.lines[0].mode, 'tram');
});

test('saves from before automatic routes (with drawn lines) still load', () => {
  const { s, m, row, x0 } = streetCity();
  applyTool(s, 'bus', [m.idx(x0 + 5, row + 1)]);
  applyTool(s, 'bus', [m.idx(x0 + 30, row - 1)]);
  const d = serialize(s);
  d.lines = [{ id: 1, name: 'Old line', color: '#fff', mode: 'bus', stops: [m.idx(x0 + 5, row + 1)], freq: 2 }];
  const t = deserialize(JSON.parse(JSON.stringify(d)));
  assert.equal(t.lines.length, 1, 'routes re-planned from the stops');
});

// A minimal localStorage for the autosave tests.
globalThis.localStorage = {
  data: new Map(),
  getItem(k) { return this.data.has(k) ? this.data.get(k) : null; },
  setItem(k, v) { this.data.set(k, String(v)); },
  removeItem(k) { this.data.delete(k); },
};

test('a new city keeps the old one as the previous city', () => {
  localStorage.data.clear();
  const a = createGame(1, 64); a.cityName = 'Old town';
  autosave(a);
  clearAutosave();
  assert.ok(hasBackup());
  assert.equal(loadAutosave(), null);
  const b = createGame(2, 64); b.cityName = 'New town';
  const back = restoreBackup(b);
  assert.equal(back.cityName, 'Old town');
  assert.equal(restoreBackup(back).cityName, 'New town', 'and it swaps back');
});

test('an autosave that fails to load is kept, not deleted', () => {
  localStorage.data.clear();
  localStorage.setItem('gridline.autosave', '{"game":"gridline","version":5,"map":{"width":-1}}');
  const r = loadAutosave();
  assert.ok(r?.error, 'reports the error');
  assert.ok(hasBackup(), 'the damaged save is kept as the previous city');
});

if (failed) { console.log(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nall tests passed');
