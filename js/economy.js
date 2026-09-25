// Economy: build costs, player tools, and the monthly budget.

import { CONFIG } from './config.js';
import { TILE, TERRAIN, FLAG, isZone } from './map.js';

export const TOOLS = {
  inspect:     { label: 'Inspect / Pan', key: '0', shape: 'point' },
  road:        { label: 'Road',        key: '1', shape: 'line', tile: TILE.ROAD },
  residential: { label: 'Residential', key: '2', shape: 'rect', tile: TILE.RES },
  commercial:  { label: 'Commercial',  key: '3', shape: 'rect', tile: TILE.COM },
  industrial:  { label: 'Industrial',  key: '4', shape: 'rect', tile: TILE.IND },
  park:        { label: 'Park',        key: '5', shape: 'rect', tile: TILE.PARK },
  bulldoze:    { label: 'Bulldoze',    key: '6', shape: 'rect' },
};

function push(state, text, kind = 'info') { state.events.push({ text, kind }); }

// Cost of applying `tool` at tile i, or null if not allowed (reason in .why).
export function toolCost(state, tool, i) {
  const map = state.map, C = CONFIG.costs;
  const t = map.type[i], water = map.terrain[i] === TERRAIN.WATER;
  const trees = map.hasFlag(i, FLAG.TREES) ? C.clearTrees : 0;
  switch (tool) {
    case 'road':
      if (t === TILE.ROAD) return null;
      if (isZone(t) && map.level[i] > 0) return null;       // bulldoze buildings first
      if (t === TILE.PARK) return null;
      return water ? C.bridge : C.road + trees;
    case 'residential': case 'commercial': case 'industrial': case 'park': {
      const want = TOOLS[tool].tile;
      if (water || t === TILE.ROAD || t === want) return null;
      if (isZone(t) && map.level[i] > 0) return null;
      if (t === TILE.PARK && want !== TILE.PARK) return null;
      return C[tool] + trees;
    }
    case 'bulldoze':
      if (t === TILE.EMPTY) return map.hasFlag(i, FLAG.TREES) ? C.clearTrees : null;
      if (isZone(t)) return C.bulldoze + C.bulldozePerLevel * map.level[i];
      return C.bulldoze;
    default:
      return null;
  }
}

function applyOne(state, tool, i) {
  const map = state.map;
  const wasRoad = map.type[i] === TILE.ROAD;
  if (tool === 'bulldoze') {
    if (map.type[i] === TILE.EMPTY) map.setFlag(i, FLAG.TREES, false);
    map.type[i] = TILE.EMPTY;
    map.level[i] = 0;
    map.setFlag(i, FLAG.ABANDONED, false);
  } else {
    map.type[i] = TOOLS[tool].tile;
    map.level[i] = 0;
    map.setFlag(i, FLAG.TREES, false);
    map.setFlag(i, FLAG.ABANDONED, false);
  }
  if (wasRoad || map.type[i] === TILE.ROAD) map.roadsDirty = true;
}

// Apply a tool to a list of tile indices, stopping when money runs out.
// Returns { applied, spent }.
export function applyTool(state, tool, tiles) {
  if (state.bankrupt) return { applied: 0, spent: 0 };
  let applied = 0, spent = 0, broke = false;
  for (const i of tiles) {
    const cost = toolCost(state, tool, i);
    if (cost == null) continue;
    if (cost > state.funds) { broke = true; break; }
    state.funds -= cost;
    spent += cost;
    applyOne(state, tool, i);
    applied++;
  }
  if (broke) push(state, 'Not enough funds', 'bad');
  return { applied, spent };
}

export function previewCost(state, tool, tiles) {
  let total = 0, count = 0;
  for (const i of tiles) {
    const c = toolCost(state, tool, i);
    if (c != null) { total += c; count++; }
  }
  return { total, count };
}

// What this month's budget looks like with the current city.
export function monthlyBudget(state) {
  const E = CONFIG.economy, s = state.stats, rate = state.taxRate / 100;
  const income = {
    residential: s.population * E.taxPerResident * rate,
    commercial: s.comJobs * E.taxPerCommercialJob * rate,
    industrial: s.indJobs * E.taxPerIndustrialJob * rate,
  };
  const expenses = {
    roads: s.roads * E.roadMaintenance,
    bridges: s.bridges * E.bridgeMaintenance,
    parks: s.parks * E.parkMaintenance,
  };
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  return { income, expenses, totalIncome: sum(income), totalExpenses: sum(expenses) };
}

// Runs every tick; acts at month boundaries.
export function economySystem(state) {
  if (state.tick % CONFIG.time.ticksPerMonth !== 0) return;
  const b = monthlyBudget(state);
  const net = Math.round(b.totalIncome - b.totalExpenses);
  state.funds += net;
  state.lastMonth = { income: Math.round(b.totalIncome), expenses: Math.round(b.totalExpenses), net, breakdown: b };
  state.month++;
  if (state.month >= 12) { state.month = 0; state.year++; }

  if (state.funds < 0) {
    state.negativeMonths++;
    const left = CONFIG.economy.bankruptcyMonths - state.negativeMonths;
    if (left <= 0) {
      state.bankrupt = true;
      push(state, 'Bankrupt! The city council has taken over.', 'bad');
    } else {
      push(state, `In debt! ${left} month${left === 1 ? '' : 's'} until bankruptcy.`, 'bad');
    }
  } else {
    state.negativeMonths = 0;
  }
}
