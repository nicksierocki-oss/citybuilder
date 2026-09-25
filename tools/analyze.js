// City report from a save file: node tools/analyze.js path/to/gridline-city.json
import { readFileSync } from 'fs';
import { deserialize } from '../js/save.js';
import { evaluateTile, targetDemand } from '../js/simulation.js';
import { monthlyBudget, budgetAdvice } from '../js/economy.js';
import { CONFIG } from '../js/config.js';
import { TILE, FLAG, KINDS, ROAD_NAMES, SUPPLY, isZone } from '../js/map.js';
import { roadLoad } from '../js/traffic.js';

const file = process.argv[2];
if (!file) { console.error('Usage: node tools/analyze.js <save.json>'); process.exit(1); }
const state = deserialize(JSON.parse(readFileSync(file, 'utf8')));
const m = state.map, s = state.stats, b = monthlyBudget(state), d = targetDemand(state);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const $ = (v) => (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString();
const pct = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;

console.log(`\n# ${MONTHS[state.month]} ${state.year} · ${m.width}×${m.height} map`);
console.log(`Population ${s.population.toLocaleString()} · jobs ${s.jobs} (shops ${s.comJobs}, industry ${s.indJobs}) · workers ${Math.round(s.workers)}`);
console.log(`Funds ${$(state.funds)} · tax ${state.taxRate}% · loans ${state.loans?.length ?? 0} · months in debt ${state.negativeMonths}${state.utilityGrace ? ` · utilities grace ${state.utilityGrace} mo` : ''}`);
const net = b.totalIncome - b.totalExpenses;
console.log(`\n## Budget (per month): income ${$(b.totalIncome)}, upkeep ${$(b.totalExpenses)}, net ${$(net)}`);
for (const [k, v] of Object.entries(b.income)) console.log(`  + ${k.padEnd(12)} ${$(v)}`);
for (const [k, v] of Object.entries(b.expenses)) if (Math.round(v)) console.log(`  - ${k.padEnd(12)} ${$(v)}`);
if (net < 0 && state.funds > 0) console.log(`  runway: ~${Math.floor(state.funds / -net)} months`);

console.log(`\n## Demand: homes ${pct(d.r)}, shops ${pct(d.c)}, industry ${pct(d.i)}`);
const u = state.utilities;
console.log(`Power ${u.power.demand}/${u.power.supply} · Water ${u.water.demand}/${u.water.supply} · happiness ${Math.round(state.happiness)} · crime ${Math.round(state.crime)} · fires ${state.fires}`);
console.log(`Traffic: avg commute ${Math.round(state.traffic.avgCommute)} min, ${Math.round(state.traffic.workers - state.traffic.employed)} can't reach jobs, ${state.traffic.congested} jammed road tiles`);

// Zones by density and why they aren't growing
const zones = { [TILE.RES]: 'homes', [TILE.COM]: 'shops', [TILE.IND]: 'industry' };
const levels = {}, reasons = {};
let vacantNoRoad = 0;
for (let i = 0; i < m.size; i++) {
  const t = m.type[i];
  if (!isZone(t)) continue;
  const key = zones[t];
  levels[key] ??= [0, 0, 0, 0, 0];
  levels[key][m.hasFlag(i, FLAG.ABANDONED) ? 4 : m.level[i]]++;
  const ev = evaluateTile(state, i);
  if (!ev.connected && m.level[i] === 0) { vacantNoRoad++; continue; }
  for (const r of ev.reasons) {
    const k = `${key}: ${r.replace(/\d+/g, '#')}`;
    reasons[k] = (reasons[k] || 0) + 1;
  }
}
console.log('\n## Zones  [vacant, low, medium, high, abandoned]');
for (const [k, v] of Object.entries(levels)) console.log(`  ${k.padEnd(9)} ${JSON.stringify(v)}`);
if (vacantNoRoad) console.log(`  ${vacantNoRoad} zoned lots have no road beside them (they can never grow)`);
console.log('\n## What holds tiles back (count of tiles)');
for (const [k, n] of Object.entries(reasons).sort((a, c) => c[1] - a[1]).slice(0, 14)) console.log(`  ${String(n).padStart(4)}  ${k}`);

// Public buildings and homes left uncovered
const svc = {};
for (let i = 0; i < m.size; i++) if (m.type[i] === TILE.SERVICE) { const k = KINDS[m.kind[i]]; svc[k] = (svc[k] || 0) + 1; }
console.log(`\n## Public buildings: ${Object.entries(svc).map(([k, n]) => `${k} ×${n}`).join(', ') || 'none'}`);
const homes = [];
for (let i = 0; i < m.size; i++) if (m.type[i] === TILE.RES && m.level[i] > 0) homes.push(i);
for (const k of ['school', 'clinic', 'police', 'fire']) {
  const miss = homes.filter((i) => m.coverage[k][i] < 0.05);
  if (!miss.length) continue;
  let sx = 0, sy = 0;
  for (const i of miss) { sx += i % m.width; sy += (i / m.width) | 0; }
  console.log(`  ${miss.length}/${homes.length} homes have no ${k === 'fire' ? 'fire station' : k} nearby (centre of the gap ≈ ${Math.round(sx / miss.length)}, ${Math.round(sy / miss.length)})`);
}
const unpowered = homes.filter((i) => m.power[i] !== SUPPLY.OK).length, dry = homes.filter((i) => m.water[i] !== SUPPLY.OK).length;
if (unpowered || dry) console.log(`  homes without power: ${unpowered}, without water: ${dry}`);

// Busiest roads
const roads = [];
for (let i = 0; i < m.size; i++) if (m.type[i] === TILE.ROAD && m.traffic[i] > 0) roads.push([roadLoad(m, i), i]);
roads.sort((a, c) => c[0] - a[0]);
if (roads.length && roads[0][0] > 0.8) {
  console.log('\n## Busiest roads');
  for (const [l, i] of roads.slice(0, 6)) console.log(`  ${ROAD_NAMES[m.roadClass[i]]} at ${i % m.width}, ${(i / m.width) | 0}: ${Math.round(l * 100)}% of capacity`);
}

console.log('\n## Advisor');
for (const a of budgetAdvice(state)) console.log(`  - ${a}`);
console.log(`\n(${CONFIG.map.expandSteps.find((n) => n > m.width) ? 'Map can still be expanded.' : 'Map is at its largest.'})`);
