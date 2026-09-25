// Economy: build costs, player tools, and the monthly budget.

import { CONFIG } from './config.js';
import { TILE, TERRAIN, FLAG, KIND_ID, isZone } from './map.js';

export const TOOLS = {
  inspect:     { label: 'Inspect / Pan', key: '0', shape: 'point' },
  road:        { label: 'Street',      key: '1', shape: 'line', tile: TILE.ROAD, roadClass: 0 },
  avenue:      { label: 'Avenue',      key: '7', shape: 'line', tile: TILE.ROAD, roadClass: 1 },
  highway:     { label: 'Highway',     key: '8', shape: 'line', tile: TILE.ROAD, roadClass: 2 },
  upgrade:     { label: 'Upgrade road', key: '9', shape: 'line' },
  residential: { label: 'Residential', key: '2', shape: 'rect', tile: TILE.RES },
  commercial:  { label: 'Commercial',  key: '3', shape: 'rect', tile: TILE.COM },
  industrial:  { label: 'Industrial',  key: '4', shape: 'rect', tile: TILE.IND },
  park:        { label: 'Park',        key: '5', shape: 'rect', tile: TILE.PARK },
  trees:       { label: 'Plant trees', shape: 'rect' },
  bulldoze:    { label: 'Bulldoze',    key: '6', shape: 'rect' },
  // Public buildings: one per click
  coal:        { label: 'Coal plant',  shape: 'single', building: 'coal' },
  wind:        { label: 'Wind farm',   shape: 'single', building: 'wind' },
  pump:        { label: 'Water pump',  shape: 'single', building: 'pump' },
  school:      { label: 'School',      shape: 'single', building: 'school' },
  clinic:      { label: 'Clinic',      shape: 'single', building: 'clinic' },
  plaza:       { label: 'Plaza',       shape: 'single', building: 'plaza' },
  recycling:   { label: 'Recycling',   shape: 'single', building: 'recycling' },
  police:      { label: 'Police station', shape: 'single', building: 'police' },
  fire:        { label: 'Fire station', shape: 'single', building: 'fire' },
};

export function toolPrice(tool) {
  const def = TOOLS[tool];
  if (def.building) return CONFIG.buildings[def.building].cost;
  if (tool === 'trees') return CONFIG.costs.plantTrees;
  return CONFIG.costs[tool];
}

function push(state, text, kind = 'info') { state.events.push({ text, kind }); }

// Build cost of a road class on land or water.
export function roadCost(cls, water) {
  const C = CONFIG.costs;
  return water ? [C.bridge, C.avenueBridge, C.highwayBridge][cls] : [C.road, C.avenue, C.highway][cls];
}

// Road class a road tool would leave on tile i (null = no change).
function targetRoadClass(map, tool, i) {
  if (tool === 'upgrade') return map.type[i] === TILE.ROAD && map.roadClass[i] < 2 ? map.roadClass[i] + 1 : null;
  const want = TOOLS[tool].roadClass;
  if (map.type[i] !== TILE.ROAD) return want;
  return want > map.roadClass[i] ? want : null; // painting a bigger road over a smaller one upgrades it
}

// Cost of applying `tool` at tile i, or null if not allowed.
export function toolCost(state, tool, i) {
  const map = state.map, C = CONFIG.costs;
  const t = map.type[i], water = map.terrain[i] === TERRAIN.WATER;
  const trees = map.hasFlag(i, FLAG.TREES) ? C.clearTrees : 0;
  if (TOOLS[tool]?.building) {
    if (water || t === TILE.ROAD || t === TILE.SERVICE || t === TILE.PARK) return null;
    if (isZone(t) && map.level[i] > 0) return null;
    return CONFIG.buildings[TOOLS[tool].building].cost + trees;
  }
  switch (tool) {
    case 'trees':
      return t === TILE.EMPTY && !water && !map.hasFlag(i, FLAG.TREES) ? C.plantTrees : null;
    case 'road': case 'avenue': case 'highway': case 'upgrade': {
      const cls = targetRoadClass(map, tool, i);
      if (cls == null) return null;
      if (t === TILE.ROAD) return roadCost(cls, water) - roadCost(map.roadClass[i], water);
      if (isZone(t) && map.level[i] > 0) return null;       // bulldoze buildings first
      if (t === TILE.PARK || t === TILE.SERVICE) return null;
      return roadCost(cls, water) + (water ? 0 : trees);
    }
    case 'residential': case 'commercial': case 'industrial': case 'park': {
      const want = TOOLS[tool].tile;
      if (water || t === TILE.ROAD || t === want || t === TILE.SERVICE) return null;
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
  if (tool === 'trees') {
    map.setFlag(i, FLAG.TREES, true);
  } else if (TOOLS[tool]?.building) {
    map.type[i] = TILE.SERVICE;
    map.kind[i] = KIND_ID[TOOLS[tool].building];
    map.level[i] = 0;
    map.roadClass[i] = 0;
    map.setFlag(i, FLAG.TREES, false);
    map.setFlag(i, FLAG.ABANDONED, false);
  } else if (tool === 'bulldoze') {
    if (map.type[i] === TILE.EMPTY) map.setFlag(i, FLAG.TREES, false);
    map.type[i] = TILE.EMPTY;
    map.level[i] = 0;
    map.kind[i] = 0;
    map.roadClass[i] = 0;
    map.setFlag(i, FLAG.FIRE, false);
    map.burn[i] = 0;
    map.traffic[i] = 0;
    map.setFlag(i, FLAG.ABANDONED, false);
  } else if (tool === 'road' || tool === 'avenue' || tool === 'highway' || tool === 'upgrade') {
    map.roadClass[i] = targetRoadClass(map, tool, i);
    map.type[i] = TILE.ROAD;
    map.kind[i] = 0;
    map.level[i] = 0;
    map.setFlag(i, FLAG.TREES, false);
    map.setFlag(i, FLAG.ABANDONED, false);
  } else {
    map.type[i] = TOOLS[tool].tile;
    map.roadClass[i] = 0;
    map.kind[i] = 0;
    map.level[i] = 0;
    map.setFlag(i, FLAG.TREES, false);
    map.setFlag(i, FLAG.ABANDONED, false);
  }
  if (wasRoad || map.type[i] === TILE.ROAD) map.roadsDirty = true;
  map.version++;
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
    avenues: s.avenues * E.avenueMaintenance,
    highways: s.highways * E.highwayMaintenance,
    bridges: s.bridges * E.bridgeMaintenance,
    parks: s.parks * E.parkMaintenance,
    utilities: 0,
    services: 0,
  };
  for (const [k, n] of Object.entries(s.services || {})) {
    const upkeep = n * CONFIG.buildings[k].upkeep;
    if (k === 'coal' || k === 'wind' || k === 'pump') expenses.utilities += upkeep; else expenses.services += upkeep;
  }
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

  if (state.utilityGrace > 0) {
    state.utilityGrace--;
    const g = state.utilityGrace;
    if (g === 6 || g === 3 || g === 1) push(state, `Utilities required in ${g} month${g === 1 ? '' : 's'}: build power plants and water pumps`, 'bad');
    if (g === 0) push(state, 'Utilities are now required for medium and high density', 'bad');
  }

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
