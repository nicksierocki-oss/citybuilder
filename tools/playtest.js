// Headless balance playtest: runs the real simulation with scripted players.
// Usage: node tools/playtest.js
import { createGame, tick, refreshFields, evaluateTile } from '../js/simulation.js';
import { applyTool } from '../js/economy.js';
import { CONFIG } from '../js/config.js';
import { TILE, TERRAIN } from '../js/map.js';

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
  const H = CONFIG.map.highwayRow;
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
  const H = CONFIG.map.highwayRow;
  for (let x = 10; x < 38; x += 3) applyTool(state, 'road', line(state, x, 1, x, 38));
  for (let y = 2; y < 38; y += 4) applyTool(state, 'road', line(state, 10, y, 37, y));
  applyTool(state, 'road', line(state, 10, H, 37, H));
  applyTool(state, 'residential', rect(state, 11, 3, 37, 37));
  applyTool(state, 'industrial', rect(state, 14, 10, 20, 14));
  return () => {};
}

// A sprawling player: a generous road grid, zones everywhere, industry mixed into housing.
function sprawl(state) {
  const H = CONFIG.map.highwayRow;
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

function run(name, strategy, months = 72, seed = 12345) {
  const state = createGame(seed);
  state.rng = (() => { let a = 99; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
  const step = strategy(state);
  refreshFields(state);
  console.log(`\n=== ${name} === start funds after opening: ${state.funds}`);
  let hit1000 = null;
  for (let m = 1; m <= months && !state.bankrupt; m++) {
    for (let t = 0; t < TPM; t++) tick(state);
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
  }
  const secs1x = hit1000 ? (hit1000 * TPM * CONFIG.time.msPerTick[1] / 1000).toFixed(0) : '-';
  const secs2x = hit1000 ? (hit1000 * TPM * CONFIG.time.msPerTick[2] / 1000).toFixed(0) : '-';
  console.log(`-> reached 1000 pop at month ${hit1000 ?? 'never'} (${secs1x}s at 1x, ${secs2x}s at 2x); bankrupt: ${state.bankrupt}`);
}

run('sensible', sensible);
run('sensible + avenues', (st) => sensible(st, true));
run('sprawl', sprawl);
run('careless', careless);
