// Headless balance playtest: runs the real simulation with scripted players.
// Usage: node tools/playtest.js
import { createGame, tick, refreshFields, evaluateTile } from '../js/simulation.js';
import { applyTool, budgetAdvice, takeLoan, repayLoan, loanPayoff } from '../js/economy.js';
import { createScenario, SCENARIOS, homePollution } from '../js/goals.js';
import { CONFIG } from '../js/config.js';
import { TILE, TERRAIN, highwayEntry } from '../js/map.js';
const SIZE = 40; // the scripted layouts below were designed for the small map
const H0 = highwayEntry(SIZE, SIZE).row;

const TPM = CONFIG.time.ticksPerMonth;

function line(state, x0, y0, x1, y1) {
  const out = [];
  const m = state.map;
  if (y0 === y1) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) out.push(m.idx(x, y0));
  else for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) out.push(m.idx(x0, y));
  return out;
}
function rect(state, x0, y0, x1, y1) {
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(state.map.idx(x, y));
  return out;
}
function riverX(state, y) {
  for (let x = 0; x < state.map.width; x++) if (state.map.terrain[state.map.idx(x, y)] === TERRAIN.WATER) return x;
  return state.map.width;
}

// A sensible player: a small street grid, mixed zoning, a park, grows as demand appears.
function sensible(state, avenues = false) {
  const H = highwayEntry(state.map.width, state.map.height).row;
  const rx = Math.min(riverX(state, H - 6), riverX(state, H + 6), riverX(state, H)) - 2;
  const plan = [
    () => {
      applyTool(state, 'road', line(state, 10, H, rx, H));
      applyTool(state, 'road', line(state, 13, H - 6, 13, H + 6));
      applyTool(state, 'road', line(state, 18, H - 6, 18, H + 6));
      applyTool(state, 'industrial', rect(state, 2, H - 2, 9, H - 1));
      applyTool(state, 'industrial', rect(state, 2, H + 1, 9, H + 1));
      applyTool(state, 'residential', rect(state, 14, H - 6, 17, H - 2));
      applyTool(state, 'residential', rect(state, 14, H + 2, 17, H + 6));
      applyTool(state, 'commercial', rect(state, 14, H - 1, 17, H - 1));
      applyTool(state, 'commercial', rect(state, 14, H + 1, 17, H + 1));
      applyTool(state, 'park', rect(state, 15, H - 4, 16, H - 4));
    },
  ];
  plan[0]();
  let stage = 0;
  return (month) => {
    const s = state.stats;
    // Utilities as demand appears: wind first, coal once the city can afford it.
    const u = state.utilities;
    if (month === 3) applyTool(state, 'wind', [state.map.idx(12, H + 2)]);
    if (month === 6) applyTool(state, 'pump', [state.map.idx(rx, H + 1)]);
    if (month > 6 && u.power.demand > 0.85 * u.power.supply && state.funds > 3500) {
      const spots = [[10, H + 1], [11, H + 1], [10, H - 1], [11, H - 1]];
      for (const [x, y] of spots) if (applyTool(state, 'coal', [state.map.idx(x, y)]).applied) break;
    }
    if (month > 6 && u.water.demand > 0.85 * u.water.supply && state.funds > 1500) {
      for (const [x, y] of [[rx - 1, H + 1], [rx + 1, H - 1], [rx - 1, H - 1]]) if (applyTool(state, 'pump', [state.map.idx(x, y)]).applied) break;
    }
    if (month === 12) applyTool(state, 'police', [state.map.idx(12, H - 2)]);
    if (month === 16) applyTool(state, 'school', [state.map.idx(12, H - 4)]);
    if (month === 18) applyTool(state, 'fire', [state.map.idx(12, H + 5)]);
    if (month === 36) applyTool(state, 'clinic', [state.map.idx(12, H + 8)]);
    if (stage === 0 && month >= 14) {
      stage++;
      if (avenues) {
        applyTool(state, 'avenue', line(state, 10, H, rx, H));
        applyTool(state, 'avenue', line(state, 13, H - 12, 13, H + 12));
      }
      applyTool(state, 'road', line(state, 13, H - 12, 13, H - 7));
      applyTool(state, 'road', line(state, 13, H - 12, rx, H - 12));
      applyTool(state, 'road', line(state, rx, H - 12, rx, H));
      applyTool(state, 'residential', rect(state, 14, H - 11, rx - 1, H - 7));
      applyTool(state, 'park', rect(state, 19, H - 9, 20, H - 9));
      applyTool(state, 'industrial', rect(state, 2, H + 2, 9, H + 3));
      applyTool(state, 'road', line(state, 2, H + 4, 12, H + 4));
      applyTool(state, 'commercial', rect(state, 19, H - 1, rx - 1, H - 1));
    }
    if (stage === 1 && month >= 30) {
      stage++;
      applyTool(state, 'road', line(state, 13, H + 7, 13, H + 12));
      applyTool(state, 'road', line(state, 13, H + 12, rx, H + 12));
      applyTool(state, 'road', line(state, rx, H + 1, rx, H + 12));
      applyTool(state, 'residential', rect(state, 19, H + 2, rx - 1, H + 11));
      applyTool(state, 'residential', rect(state, 14, H + 7, 17, H + 11));
      applyTool(state, 'park', rect(state, 21, H + 6, 22, H + 7));
      applyTool(state, 'industrial', rect(state, 2, H + 5, 12, H + 6));
      applyTool(state, 'commercial', rect(state, 19, H - 6, rx - 1, H - 2));
    }
  };
}

// A careless player: huge road grid, all residential, industry dumped in the middle.
function careless(state) {
  const H = H0;
  for (let x = 10; x < 38; x += 3) applyTool(state, 'road', line(state, x, 1, x, 38));
  for (let y = 2; y < 38; y += 4) applyTool(state, 'road', line(state, 10, y, 37, y));
  applyTool(state, 'road', line(state, 10, H, 37, H));
  applyTool(state, 'residential', rect(state, 11, 3, 37, 37));
  applyTool(state, 'industrial', rect(state, 14, 10, 20, 14));
  return () => {};
}

// A sprawling player: a generous road grid, zones everywhere, industry mixed into housing.
function sprawl(state) {
  const H = H0;
  applyTool(state, 'road', line(state, 10, H, 22, H));
  for (let x = 12; x <= 22; x += 5) applyTool(state, 'road', line(state, x, 3, x, 36));
  for (let y = 3; y <= 36; y += 5) applyTool(state, 'road', line(state, 12, y, 22, y));
  for (let y = 4; y <= 35; y++) {
    if (y % 5 === 3) continue;
    const kind = (y % 10 < 3) ? 'industrial' : (y % 10 === 5 ? 'commercial' : 'residential');
    applyTool(state, kind, [state.map.idx(13, y), state.map.idx(16, y), state.map.idx(18, y), state.map.idx(21, y)]);
  }
  return () => {};
}

// An eager player: a tidy grid and every kind of public building within the first year.
function eager(state) {
  const H = H0;
  applyTool(state, 'road', line(state, 10, H, 24, H));
  for (const x of [13, 17, 21]) applyTool(state, 'road', line(state, x, H - 8, x, H + 8));
  applyTool(state, 'road', line(state, 13, H - 8, 21, H - 8));
  applyTool(state, 'road', line(state, 13, H + 8, 21, H + 8));
  applyTool(state, 'industrial', rect(state, 2, H - 2, 9, H - 1));
  applyTool(state, 'residential', rect(state, 14, H - 7, 16, H - 1));
  applyTool(state, 'residential', rect(state, 18, H - 7, 20, H - 1));
  applyTool(state, 'residential', rect(state, 14, H + 2, 16, H + 7));
  applyTool(state, 'commercial', rect(state, 18, H + 1, 20, H + 3));
  applyTool(state, 'wind', [state.map.idx(12, H + 1)]);
  applyTool(state, 'pump', [state.map.idx(12, H + 3)]);
  return (month) => {
    const at = (k, x, y) => applyTool(state, k, [state.map.idx(x, y)]);
    if (month === 2) at('school', 12, H - 3);
    if (month === 3) at('clinic', 12, H - 5);
    if (month === 4) at('police', 22, H - 3);
    if (month === 5) at('fire', 22, H + 3);
    if (month === 6) at('park', 12, H + 5);
    if (month === 8) at('coal', 10, H + 1);
    if (month === 10) at('plaza', 22, H - 6);
  };
}

// A planner: the sensible layout plus a low-rise, tax-break district, early schooling,
// a town park and a university once it unlocks (uses the education and district systems).
function planner(state) {
  const H = H0, base = sensible(state);
  state.districts.push({ id: 1, name: 'Old Town', color: '#e58f82', policies: { height: 2, noHeavyIndustry: false, taxBreak: true } });
  applyTool(state, 'district', rect(state, 14, H - 6, 17, H - 1), 1);
  return (month) => {
    base(month);
    const s = state.stats;
    if (month === 8) applyTool(state, 'school', [state.map.idx(12, H - 6)]);
    if (month === 20) applyTool(state, 'townpark', rect(state, 19, H - 5, 20, H - 4));
    if (month === 40) state.districts[0].policies.taxBreak = false; // grown enough: lift the tax break
    if (!state.uni && s.population >= CONFIG.buildings.university.unlock && state.funds > 9000) {
      for (const [x, y] of [[2, H + 8], [2, H - 6], [5, H + 8]]) {
        if (applyTool(state, 'university', rect(state, x, y, x + 2, y + 1)).applied) { state.uni = month; break; }
      }
    }
  };
}

// Green City: the sensible layout minus coal (banned), plus parks, trees and a recycling centre.
function greenPlayer(state) {
  const H = highwayEntry(state.map.width, state.map.height).row, base = sensible(state);
  state.ordinances.recycling = true;
  return (month) => {
    base(month);
    const u = state.utilities, at = (k, x, y) => applyTool(state, k, [state.map.idx(x, y)]).applied;
    if (month > 6 && u.power.demand > 0.8 * u.power.supply && state.funds > 1500) for (const [x, y] of [[11, H + 1], [10, H + 1], [11, H - 1], [10, H - 1], [11, H + 2], [10, H + 2], [9, H + 4]]) if (at('wind', x, y)) break;
    if (month === 10) applyTool(state, 'trees', rect(state, 2, H - 6, 9, H - 4));
    if (month === 20) at('recycling', 12, H - 8);
    if (month === 26) applyTool(state, 'trees', rect(state, 2, H + 8, 12, H + 9));
  };
}

// Rust Belt rescue: borrow to rebuild, swap coal for wind, move the factories away from homes,
// add schools and a clinic early, then repay the loans before the deadline.
function rescue(state) {
  const m = state.map, H = highwayEntry(m.width, m.height).row;
  applyTool(state, 'bulldoze', [...rect(state, 20, H - 8, 21, H - 1), m.idx(12, H + 1)]);
  for (const [x, y] of [[12, H + 1], [11, H + 1]]) applyTool(state, 'wind', [m.idx(x, y)]);
  applyTool(state, 'residential', rect(state, 20, H - 8, 21, H - 1));
  applyTool(state, 'school', [m.idx(12, H - 5)]);
  state.taxRate = 9;
  return (month) => {
    const at = (k, x, y) => applyTool(state, k, [m.idx(x, y)]).applied;
    const u = state.utilities;
    if (u.power.demand > 0.85 * u.power.supply && state.funds > 1200) for (const [x, y] of [[11, H - 1], [10, H + 1], [10, H - 1], [11, H + 2]]) if (at('wind', x, y)) break;
    if (u.water.demand > u.water.supply && state.funds > 1000) for (const [x, y] of [[12, H + 3], [11, H + 3], [12, H + 7]]) if (at('pump', x, y)) break;
    if (month === 12 && state.funds > 2000) applyTool(state, 'park', rect(state, 11, H - 4, 11, H - 2));
    if (month >= 15 && !state.stats.services.clinic && state.funds > 2000) at('clinic', 12, H + 5);
    if (month >= 24 && !state.stats.services.police && state.funds > 2000) at('police', 12, H - 7);
    if (month === 20) applyTool(state, 'commercial', rect(state, 23, H - 8, 23, H + 8).filter((i) => state.map.terrain[i] === TERRAIN.GRASS));
    if (month === 30 && state.funds > 800) { applyTool(state, 'bulldoze', rect(state, 20, H + 1, 21, H + 8)); applyTool(state, 'residential', rect(state, 20, H + 1, 21, H + 8)); }
    if (month === 44) applyTool(state, 'industrial', rect(state, 2, H + 1, 9, H + 2));
    for (const l of [...state.loans]) if (state.funds > loanPayoff(l) + 3000) repayLoan(state);
  };
}

function runScenario(id, strategy) {
  const def = SCENARIOS[id];
  const state = createScenario(id, { createGame, applyTool, tick, refreshFields, highwayEntry });
  state.rng = (() => { let a = 99; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
  const step = strategy(state);
  refreshFields(state);
  const months = def.years * 12;
  for (let mo = 1; mo <= months && !state.bankrupt && state.scenario.status === 'active'; mo++) {
    for (let t = 0; t < TPM; t++) tick(state);
    state.events.length = 0;
    step(mo);
    refreshFields(state);
    if (process.env.TRACE === id && mo % 3 === 0) { const b = state.lastMonth?.breakdown; console.log(`  m${mo} pop ${state.stats.population} ind ${state.stats.indJobs} com ${state.stats.comJobs} funds ${Math.round(state.funds)} net ${state.lastMonth?.net} exp ${b ? JSON.stringify(Object.fromEntries(Object.entries(b.expenses).filter(([, v]) => v > 1).map(([k, v]) => [k, Math.round(v)]))) : ''} RCI ${state.demand.r.toFixed(2)} ${state.demand.c.toFixed(2)} ${state.demand.i.toFixed(2)} water ${JSON.stringify(state.utilities.water)}`); }
  }
  if (process.env.TRACE === id) {
    const reasons = {};
    for (let i = 0; i < state.map.size; i++) if (state.map.type[i] === TILE.RES) for (const r of evaluateTile(state, i).reasons) { const k = r.replace(/\d+/g, '#'); reasons[k] = (reasons[k] || 0) + 1; }
    console.log(reasons, 'demand', JSON.stringify(state.demand), 'traffic', JSON.stringify(state.traffic));
  }
  const s = state.stats;
  console.log(`\n=== scenario ${def.name} === ${state.scenario.status.toUpperCase()} in ${state.year - (state.scenario.deadlineYear - def.years)} yr: pop ${s.population}, funds ${Math.round(state.funds)}, loans ${state.loans.length}, happiness ${Math.round(state.happiness)}, home pollution ${homePollution(state).toFixed(1)}, rating ${Math.round(state.rating)}${state.bankrupt ? ', BANKRUPT' : ''}`);
  console.log('   goals:', def.goals.map((g) => `${g.id} ${g.check(state) ? 'ok' : 'no'}`).join(', '));
}

function run(name, strategy, months = 72, seed = 12345) {
  const state = createGame(seed, SIZE);
  state.rng = (() => { let a = 99; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
  const step = strategy(state);
  refreshFields(state);
  console.log(`\n=== ${name} === start funds after opening: ${state.funds}`);
  let hit1000 = null, burned = 0;
  const burnLog = [];
  const countBurn = () => {
    for (const e of state.events) if (/burned down/.test(e.text)) { burned++; burnLog.push(`m${Math.floor(state.tick / TPM)}@${e.x},${e.y}`); }
    state.events.length = 0;
  };
  for (let m = 1; m <= months && !state.bankrupt; m++) {
    for (let t = 0; t < TPM; t++) { tick(state); countBurn(); }
    step(m);
    refreshFields(state);
    const s = state.stats, d = state.demand;
    if (hit1000 == null && s.population >= 1000) hit1000 = m;
    if (m % 6 === 0 || state.bankrupt) {
      const lvl = [0, 0, 0, 0]; for (let i = 0; i < state.map.size; i++) if (state.map.type[i] === TILE.RES) lvl[state.map.level[i]]++;
      console.log(`m${String(m).padStart(3)} pop ${String(s.population).padStart(5)} com ${String(s.comJobs).padStart(4)} ind ${String(s.indJobs).padStart(4)} ` +
        `funds ${String(Math.round(state.funds)).padStart(6)} net ${String(state.lastMonth?.net ?? 0).padStart(5)} ` +
        `RCI ${d.r.toFixed(2)} ${d.c.toFixed(2)} ${d.i.toFixed(2)} abandoned ${s.abandoned} Rlvls ${lvl.join('/')}`);
    }
  }
  if (process.env.DIAG) {
    const reasons = {};
    for (let i = 0; i < state.map.size; i++) if (state.map.type[i] === TILE.RES) {
      for (const r of evaluateTile(state, i).reasons) { const k = r.replace(/\d+/g, '#'); reasons[k] = (reasons[k] || 0) + 1; }
    }
    let maxLoad = 0; for (let i = 0; i < state.map.size; i++) if (state.map.type[i] === TILE.ROAD) maxLoad = Math.max(maxLoad, state.map.traffic[i]);
    console.log('traffic', JSON.stringify(state.traffic), 'maxVolume', maxLoad.toFixed(0), reasons);
    console.log('services', JSON.stringify(state.stats.services), 'utilities', JSON.stringify(state.utilities), 'happiness', state.happiness.toFixed(0),
      'crime', state.crime.toFixed(0), 'fires burning', state.fires, 'burned down', burned, burnLog.join(' '));
    console.log('budget', JSON.stringify(state.lastMonth?.breakdown));
    for (const a of budgetAdvice(state)) console.log('  advice:', a);
  }
  const secs1x = hit1000 ? (hit1000 * TPM * CONFIG.time.msPerTick[1] / 1000).toFixed(0) : '-';
  const secs2x = hit1000 ? (hit1000 * TPM * CONFIG.time.msPerTick[2] / 1000).toFixed(0) : '-';
  console.log(`   education ${Math.round(state.education * 100)}% · skilled jobs open ${Math.round(state.traffic.skilledOpen ?? 0)} · high-tech ${state.stats.hightech}${state.uni ? ` · university at m${state.uni}` : ''}`);
  console.log(`-> reached 1000 pop at month ${hit1000 ?? 'never'} (${secs1x}s at 1x, ${secs2x}s at 2x); bankrupt: ${state.bankrupt}`);
}

run('sensible', sensible);
run('sensible + avenues', (st) => sensible(st, true));
run('planner (districts, education)', planner);
run('eager builder', eager);
if (!process.env.QUICK) {
  runScenario('boomtown', sensible);
  runScenario('river', (st) => sensible(st, true));
  runScenario('green', greenPlayer);
  runScenario('rustbelt', rescue);
}
run('sprawl', sprawl);
run('careless', careless);
