// Headless regression tests: save round-trip, damaged-save fuzzing, undo.
// Run: node tools/test.js   (exits non-zero on failure)

import assert from 'node:assert/strict';
import { createGame, tick } from '../js/simulation.js';
import { serialize, deserialize, sanitizeLayers } from '../js/save.js';
import { applyTool, undoLast } from '../js/economy.js';
import { TILE, TERRAIN, KINDS, KIND_ID, FLAG } from '../js/map.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); } catch (err) { failed++; console.log(`FAIL ${name}\n     ${err.stack.split('\n').slice(0, 3).join('\n     ')}`); }
}

// Deterministic RNG so failures reproduce.
function rng(seed) { let a = seed >>> 0; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); }

// A dense city using every tile type, building kind and road class.
function builtCity() {
  const s = createGame(42, 64), m = s.map;
  let k = 1;
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
    const i = m.idx(x, y);
    if (m.terrain[i] !== TERRAIN.GRASS) continue;
    if (x % 4 === 0 || y % 4 === 0) { m.type[i] = TILE.ROAD; m.roadClass[i] = (x + y) % 3; }
    else { m.type[i] = [TILE.RES, TILE.COM, TILE.IND, TILE.PARK][(x + y) % 4]; m.level[i] = 1 + ((x * y) % 3); m.roadClass[i] = 0; }
    if (x % 8 === 6 && y % 8 === 6) { m.type[i] = TILE.SERVICE; m.kind[i] = k; m.level[i] = 0; k = k % (KINDS.length - 1) + 1; }
  }
  m.roadsDirty = true;
  s.funds = 1e6;
  for (let t = 0; t < 40; t++) tick(s);
  return s;
}

test('save round-trip keeps every persistent value', () => {
  const s = builtCity();
  const a = serialize(s), b = serialize(deserialize(JSON.parse(JSON.stringify(a))));
  delete a.savedAt; delete b.savedAt;
  assert.deepEqual(b.map, a.map);
  for (const f of ['tick', 'month', 'year', 'funds', 'taxRate', 'milestones', 'loans']) assert.deepEqual(b[f], a[f], f);
});

test('loader repair leaves a valid city untouched', () => {
  const s = builtCity();
  for (let i = 0; i < s.map.size; i++) if (s.map.type[i] === TILE.RES && i % 5 === 0) s.map.setFlag(i, FLAG.ABANDONED, true);
  assert.equal(sanitizeLayers(s.map), 0, 'a save written by the game must not need repair');
});

test('damaged saves load repaired or are rejected, never crash', () => {
  const base = serialize(builtCity()), r = rng(7);
  const junk = [null, 'x', -5, 1e308, NaN, {}, [], '<b>x</b>', true, Infinity];
  const pick = (arr) => arr[(r() * arr.length) | 0];
  for (let n = 0; n < 150; n++) {
    const d = structuredClone(base);
    for (const k of Object.keys(d.map.layers)) {
      const c = atob(d.map.layers[k]).split('');
      for (let j = 0; j < 40; j++) c[(r() * c.length) | 0] = String.fromCharCode((r() * 256) | 0);
      d.map.layers[k] = btoa(c.join(''));
    }
    for (const f of ['tick', 'month', 'year', 'funds', 'taxRate', 'demand', 'milestones', 'loans', 'lastMonth', 'utilityGrace', 'negativeMonths']) {
      if (r() < 0.4) d[f] = pick(junk);
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
  const snap = () => [m.type.slice(), m.level.slice(), m.flags.slice(), m.kind.slice(), m.roadClass.slice()];
  const before = snap(), funds0 = s.funds;
  const tiles = [];
  for (let x = 20; x < 30; x++) tiles.push(m.idx(x, 20));
  assert.ok(applyTool(s, 'road', tiles).applied > 0);
  const afterRoad = snap(), fundsRoad = s.funds;
  const zone = tiles.map((i) => i + m.width);
  assert.ok(applyTool(s, 'residential', zone).applied > 0);
  assert.ok(undoLast(s).ok);
  assert.deepEqual(snap(), afterRoad);
  assert.equal(s.funds, fundsRoad);
  assert.ok(undoLast(s).ok);
  assert.deepEqual(snap(), before);
  assert.equal(s.funds, funds0);
  assert.equal(undoLast(s).ok, false, 'empty stack');
});

test('undo of a demolition restores the building', () => {
  const s = createGame(3, 64), m = s.map, i = m.idx(25, 25);
  m.type[i] = TILE.SERVICE; m.kind[i] = KIND_ID.school;
  const funds0 = s.funds;
  applyTool(s, 'bulldoze', [i]);
  assert.equal(m.type[i], TILE.EMPTY);
  assert.ok(undoLast(s).ok);
  assert.equal(m.type[i], TILE.SERVICE);
  assert.equal(m.kind[i], KIND_ID.school);
  assert.equal(s.funds, funds0);
});

if (failed) { console.log(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nall tests passed');
