// Economy: build costs, player tools, and the monthly budget.

import { CONFIG } from './config.js';
import { TILE, TERRAIN, FLAG, KIND_ID, KINDS, JUNCTION, PERSISTENT_LAYERS, isZone, footprintSize } from './map.js';
import { ordinance, ordinancesCost } from './cityhall.js';
import { funding, groupOf } from './services.js';

export const TOOLS = {
  inspect:     { label: 'Inspect / Pan', key: '0', shape: 'point' },
  road:        { label: 'Street',      key: '1', shape: 'line', tile: TILE.ROAD, roadClass: 0 },
  avenue:      { label: 'Avenue',      key: '7', shape: 'line', tile: TILE.ROAD, roadClass: 1 },
  highway:     { label: 'Highway',     key: '8', shape: 'line', tile: TILE.ROAD, roadClass: 2 },
  upgrade:     { label: 'Upgrade road', key: '9', shape: 'line' },
  lights:      { label: 'Traffic lights', shape: 'rect' },
  interchange: { label: 'Interchange', shape: 'single' },
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
  bus:         { label: 'Bus stop',    shape: 'single', building: 'bus' },
  metro:       { label: 'Metro station', shape: 'single', building: 'metro' },
  // Landmarks: multi-tile, placed centred on the cursor
  townpark:    { label: 'Town park',    shape: 'footprint', building: 'townpark', footprint: true },
  centralpark: { label: 'Central park', shape: 'footprint', building: 'centralpark', footprint: true },
  university:  { label: 'University',   shape: 'footprint', building: 'university', footprint: true },
  stadium:     { label: 'Stadium',      shape: 'footprint', building: 'stadium', footprint: true },
  statue:      { label: "Mayor's statue", shape: 'single', building: 'statue' },
  hospital:    { label: 'Hospital',     shape: 'footprint', building: 'hospital', footprint: true },
  landfill:    { label: 'Landfill',     shape: 'footprint', building: 'landfill', footprint: true },
  // Paints the selected district (arg = district id, 0 erases)
  district:    { label: 'Paint district', shape: 'rect' },
};

// Is a building available yet? Landmarks unlock at a population and stay unlocked.
// Scenarios can ban tools (state.scenario.banned).
export function isUnlocked(state, kind) {
  const B = CONFIG.buildings[kind];
  if (state.scenario?.banned?.includes(kind)) return false;
  if (B?.unlockRating) return state.milestones.includes(`unlock:${kind}`);
  return !B?.unlock || state.milestones.includes(`unlock:${kind}`) || state.stats.population >= B.unlock;
}

export function toolPrice(tool) {
  const def = TOOLS[tool];
  if (def.building) return CONFIG.buildings[def.building].cost;
  if (tool === 'trees') return CONFIG.costs.plantTrees;
  return CONFIG.costs[tool] ?? 0;
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

// Cost of applying `tool` at tile i, or null if not allowed. For landmarks this is the per-tile
// part only (clearing trees); footprintCost adds the building's price once.
export function toolCost(state, tool, i, arg = 0) {
  const map = state.map, C = CONFIG.costs;
  const t = map.type[i], water = map.terrain[i] === TERRAIN.WATER;
  const trees = map.hasFlag(i, FLAG.TREES) ? C.clearTrees : 0;
  const def = TOOLS[tool];
  if (def?.building) {
    if (!def.footprint && !isUnlocked(state, def.building)) return null;
    if (water || t === TILE.ROAD || t === TILE.SERVICE || t === TILE.PARK) return null;
    if (isZone(t) && map.level[i] > 0) return null;
    return def.footprint ? trees : CONFIG.buildings[def.building].cost + trees;
  }
  switch (tool) {
    case 'district':
      if (water && t !== TILE.ROAD) return null;
      return map.district[i] === arg ? null : 0;
    case 'lights': {
      const j = map.junctionKind(i);
      if ((j !== JUNCTION.INTERSECTION && j !== JUNCTION.HIGHWAY) || map.hasFlag(i, FLAG.LIGHTS) || map.hasFlag(i, FLAG.INTERCHANGE)) return null;
      return C.lights;
    }
    case 'interchange':
      if (map.junctionKind(i) !== JUNCTION.HIGHWAY || map.hasFlag(i, FLAG.INTERCHANGE)) return null;
      return C.interchange;
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
      if (t === TILE.SERVICE) {
        // Selling a public building back refunds part of its price (a negative cost), once per landmark.
        const k = KINDS[map.kind[i]];
        if (map.part[i]) return C.bulldoze;
        return C.bulldoze - Math.round(CONFIG.buildings[k].cost * CONFIG.economy.refundShare);
      }
      return C.bulldoze;
    default:
      return null;
  }
}

// Total cost of placing a landmark on `tiles` (its footprint, row by row), or null if it can't go there.
export function footprintCost(state, tool, tiles) {
  const kind = TOOLS[tool].building, [w, h] = footprintSize(kind);
  if (tiles.length !== w * h || !isUnlocked(state, kind)) return null;
  let total = CONFIG.buildings[kind].cost;
  for (const i of tiles) {
    const c = toolCost(state, tool, i);
    if (c == null) return null;
    total += c;
  }
  return total;
}

// The tiles a tool really acts on: bulldozing any part of a landmark removes all of it.
export function expandSelection(map, tool, tiles) {
  if (tool !== 'bulldoze') return tiles;
  const out = new Set();
  for (const i of tiles) for (const j of map.footprintTiles(i)) out.add(j);
  return [...out];
}

function applyOne(state, tool, i, arg = 0, part = 0) {
  const map = state.map;
  const wasRoad = map.type[i] === TILE.ROAD;
  if (tool === 'district') {
    map.district[i] = arg;
  } else if (tool === 'trees') {
    map.setFlag(i, FLAG.TREES, true);
  } else if (tool === 'lights') {
    map.setFlag(i, FLAG.LIGHTS, true);
  } else if (tool === 'interchange') {
    map.setFlag(i, FLAG.INTERCHANGE, true);
    map.setFlag(i, FLAG.LIGHTS, false); // ramps replace the lights
  } else if (TOOLS[tool]?.building) {
    map.type[i] = TILE.SERVICE;
    map.kind[i] = KIND_ID[TOOLS[tool].building];
    map.part[i] = part;
    map.level[i] = 0;
    map.roadClass[i] = 0;
    map.setFlag(i, FLAG.TREES, false);
    map.setFlag(i, FLAG.ABANDONED, false);
  } else if (tool === 'bulldoze') {
    if (map.type[i] === TILE.EMPTY) map.setFlag(i, FLAG.TREES, false);
    map.type[i] = TILE.EMPTY;
    map.level[i] = 0;
    map.kind[i] = 0;
    map.part[i] = 0;
    map.roadClass[i] = 0;
    map.flags[i] = 0; // clears fire, abandonment, lights and interchanges (trees handled above)
    map.burn[i] = 0;
    map.traffic[i] = 0;
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

// Snapshot of a tile's saved layers, so an action can be undone.
function snapshot(map, i) {
  return [i, PERSISTENT_LAYERS.map((k) => map[k][i])];
}

// Apply a tool to a list of tile indices, stopping when money runs out. `arg` is the district id
// for the district brush. Returns { applied, spent, undo } where undo restores the tiles and money.
export function applyTool(state, tool, tiles, arg = 0) {
  const map = state.map, none = { applied: 0, spent: 0, undo: null };
  if (state.bankrupt) return none;
  tiles = expandSelection(map, tool, tiles);
  const undo = { map, tool, tiles: [], spent: 0 };
  if (TOOLS[tool]?.footprint) {
    const cost = footprintCost(state, tool, tiles);
    if (cost == null) { push(state, `No room for a ${CONFIG.buildings[TOOLS[tool].building].label.toLowerCase()} here`, 'bad'); return none; }
    if (cost > state.funds) { push(state, 'Not enough funds', 'bad'); return none; }
    const w = footprintSize(TOOLS[tool].building)[0];
    tiles.forEach((i, k) => {
      undo.tiles.push(snapshot(map, i));
      applyOne(state, tool, i, arg, k === 0 ? 0 : 1 + (k % w) + 8 * Math.floor(k / w));
    });
    state.funds -= cost;
    undo.spent = cost;
    return { applied: tiles.length, spent: cost, undo };
  }
  let applied = 0, spent = 0, broke = false;
  for (const i of tiles) {
    const cost = toolCost(state, tool, i, arg);
    if (cost == null) continue;
    // Demolition is always allowed (even in debt) so players can cut upkeep to recover.
    if (tool !== 'bulldoze' && cost > state.funds) { broke = true; break; }
    state.funds -= cost;
    spent += cost;
    undo.tiles.push(snapshot(map, i));
    applyOne(state, tool, i, arg);
    applied++;
  }
  if (broke) push(state, 'Not enough funds', 'bad');
  undo.spent = spent;
  return { applied, spent, undo: applied ? undo : null };
}

// Put the tiles from an applyTool call back and return the money. Tiles that changed since
// (a lot that grew, say) go back to how they were before the action.
export function undoAction(state, undo) {
  if (!undo || undo.map !== state.map) return false;
  const map = state.map;
  for (const [i, values] of undo.tiles) {
    PERSISTENT_LAYERS.forEach((k, n) => { map[k][i] = values[n]; });
    map.burn[i] = 0;
    if (map.type[i] !== TILE.ROAD) map.traffic[i] = 0;
  }
  state.funds += undo.spent;
  map.roadsDirty = true;
  map.version++;
  return true;
}

export function previewCost(state, tool, tiles, arg = 0) {
  tiles = expandSelection(state.map, tool, tiles);
  if (TOOLS[tool]?.footprint) {
    const c = footprintCost(state, tool, tiles);
    return c == null ? { total: 0, count: 0, blocked: true } : { total: c, count: 1 };
  }
  let total = 0, count = 0;
  for (const i of tiles) {
    const c = toolCost(state, tool, i, arg);
    if (c != null) { total += c; count++; }
  }
  return { total, count };
}

// Ticket income from landmarks that draw visitors, growing with the city.
export function visitorIncome(state) {
  let total = 0;
  for (const [k, n] of Object.entries(state.stats.services || {})) {
    const B = CONFIG.buildings[k];
    if (B?.income) total += n * B.income * Math.min(1, state.stats.population / B.visitorsAt);
  }
  return total * (ordinance(state, 'tourism') ? CONFIG.ordinances.tourism.visitorMult : 1);
}

// What this month's budget looks like with the current city.
export function monthlyBudget(state) {
  const E = CONFIG.economy, s = state.stats, rate = state.taxRate / 100;
  const base = s.taxBase ?? { r: s.population, c: s.comJobs, i: s.indJobs };
  const income = {
    residential: base.r * E.taxPerResident * rate,
    commercial: base.c * E.taxPerCommercialJob * rate,
    industrial: base.i * E.taxPerIndustrialJob * rate,
    visitors: visitorIncome(state),
  };
  const expenses = {
    roads: s.roads * E.roadMaintenance,
    avenues: s.avenues * E.avenueMaintenance,
    highways: s.highways * E.highwayMaintenance,
    bridges: s.bridges * E.bridgeMaintenance,
    parks: s.parks * E.parkMaintenance * (state.budgets?.parks ?? 1),
    junctions: s.lights * E.lightsMaintenance + s.interchanges * E.interchangeMaintenance,
    utilities: 0,
    services: 0,
    loans: (state.loans ?? []).reduce((a, l) => a + l.payment, 0),
    ordinances: ordinancesCost(state),
  };
  for (const [k, n] of Object.entries(s.services || {})) {
    const upkeep = n * CONFIG.buildings[k].upkeep * funding(state, k);
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

  // Loan repayments count down; paid-off loans disappear.
  if (state.loans?.length) {
    for (const l of state.loans) l.monthsLeft--;
    const done = state.loans.filter((l) => l.monthsLeft <= 0).length;
    state.loans = state.loans.filter((l) => l.monthsLeft > 0);
    if (done) { state.loansPaid = (state.loansPaid ?? 0) + done; push(state, 'A loan has been paid off!', 'good'); }
  }

  state.positiveMonths = net >= 0 ? (state.positiveMonths ?? 0) + 1 : 0;

  // Early warning while there is still time to act.
  const E = CONFIG.economy;
  if (net < 0 && state.funds > 0) {
    const runway = Math.floor(state.funds / -net);
    const since = state.tick - (state.lastBudgetWarn ?? -1e9);
    if (runway < E.warnRunwayMonths && since >= 6 * CONFIG.time.ticksPerMonth) {
      state.lastBudgetWarn = state.tick;
      push(state, `Budget: losing $${-net}/month, about ${runway} months of money left. Open “Last month” for tips.`, 'bad');
    }
  }

  if (state.garbageGrace > 0) {
    state.garbageGrace--;
    const g = state.garbageGrace;
    if (g === 6 || g === 3 || g === 1) push(state, `Garbage collection needed in ${g} month${g === 1 ? '' : 's'}: build a landfill`, 'bad');
    if (g === 0) push(state, 'Uncollected garbage now piles up: landfills and recycling centres collect it', 'bad');
  }

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
      const canBorrow = (state.loans?.length ?? 0) < CONFIG.economy.maxLoans;
      push(state, `In debt! ${left} month${left === 1 ? '' : 's'} until bankruptcy.${canBorrow ? ' Take a loan from the budget panel.' : ''}`, 'bad');
    }
  } else {
    state.negativeMonths = 0;
  }
}

// ---------------------------------------------------------------- loans & advice

export function canTakeLoan(state) {
  return (state.loans?.length ?? 0) < CONFIG.economy.maxLoans && !state.bankrupt;
}

export function takeLoan(state) {
  if (!canTakeLoan(state)) return false;
  const E = CONFIG.economy;
  state.loans = [...(state.loans ?? []), { monthsLeft: E.loanMonths, payment: E.loanPayment }];
  state.funds += E.loanAmount;
  if (state.funds >= 0) state.negativeMonths = 0;
  push(state, `Borrowed $${E.loanAmount.toLocaleString()}: $${E.loanPayment}/month for ${E.loanMonths / 12} years.`, 'good');
  return true;
}

// Paying a loan off early costs what's left of it, minus the interest not yet charged.
export function loanPayoff(loan) {
  const E = CONFIG.economy;
  return Math.round(loan.monthsLeft * loan.payment * (E.loanAmount / (E.loanMonths * E.loanPayment)));
}

// Repay the loan that's cheapest to clear. Returns false if there's none or not enough money.
export function repayLoan(state) {
  const loans = state.loans ?? [];
  if (!loans.length) return false;
  const k = loans.reduce((best, l, n) => (loanPayoff(l) < loanPayoff(loans[best]) ? n : best), 0);
  const cost = loanPayoff(loans[k]);
  if (cost > state.funds) return false;
  state.funds -= cost;
  state.loans = loans.filter((_, n) => n !== k);
  state.loansPaid = (state.loansPaid ?? 0) + 1;
  push(state, `Loan repaid early for $${cost.toLocaleString()}.`, 'good');
  return true;
}

// Plain-language suggestions for fixing the budget, most useful first.
export function budgetAdvice(state) {
  const map = state.map, s = state.stats, b = monthlyBudget(state), E = CONFIG.economy, out = [];
  const net = b.totalIncome - b.totalExpenses;
  // Roads nobody uses: no traffic and no building or public building beside them.
  const upkeep = [E.roadMaintenance, E.avenueMaintenance, E.highwayMaintenance];
  let idle = 0, idleCost = 0;
  for (let i = 0; i < map.size; i++) {
    if (map.type[i] !== TILE.ROAD || map.traffic[i] > 1) continue;
    const x = i % map.width, y = (i / map.width) | 0;
    if (x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1) continue; // keep the link to the region
    let used = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!map.inBounds(x + dx, y + dy)) continue;
      const j = map.idx(x + dx, y + dy), t = map.type[j];
      if ((isZone(t) && map.level[j] > 0) || t === TILE.SERVICE) used = true;
    }
    if (!used) { idle++; idleCost += map.terrain[i] === TERRAIN.WATER ? E.bridgeMaintenance : upkeep[map.roadClass[i]]; }
  }
  if (idle >= 8) out.push(`${idle} road tiles carry no traffic and serve no buildings: that's $${Math.round(idleCost)}/month. Bulldoze the ones you don't need yet.`);
  if (b.expenses.services > b.totalIncome * 0.35 && s.population < 1500) {
    out.push(`Public services cost $${Math.round(b.expenses.services)}/month, a lot for ${s.population.toLocaleString()} residents. Add them as the city grows (one school/clinic per neighbourhood); bulldozing refunds half their price.`);
  }
  const u = state.utilities;
  if (u && u.power.supply > u.power.demand * 3 + 200) out.push(`Power plants make ${u.power.supply} units but the city uses ${u.power.demand}. You're paying for spare capacity.`);
  if (u && u.power.demand > u.power.supply) out.push(`Power is short (${u.power.demand}/${u.power.supply}): without it buildings can't grow past low density, so income stalls. A wind farm is $1,000.`);
  if (u && u.water.demand > u.water.supply) out.push(`Water is short (${u.water.demand}/${u.water.supply}): pumps within 2 tiles of the river make 3× more.`);
  const d = state.demand;
  if (d.r > 0.25 || d.c > 0.25 || d.i > 0.25) {
    const want = [['r', 'homes'], ['c', 'shops'], ['i', 'industry']].filter(([k]) => d[k] > 0.25).map(([, n]) => n).join(' and ');
    out.push(`Demand is strong for ${want}: zone more next to existing roads. Growth is the best cure for a deficit.`);
  }
  if (s.population >= 300 && state.taxRate <= E.taxRate && Math.max(d.r, d.c, d.i) > 0.3 && net < 0) out.push('Demand is high, so you can afford a tax rise of 1–2 points.');
  // Junctions that cost commuters time.
  let busyPlain = 0, atGrade = 0;
  for (let i = 0; i < map.size; i++) {
    if (map.type[i] !== TILE.ROAD || map.traffic[i] < 1) continue;
    const j = map.junctionKind(i);
    const load = map.traffic[i] / CONFIG.traffic.capacity[map.roadClass[i]];
    if (j === JUNCTION.HIGHWAY && !map.hasFlag(i, FLAG.INTERCHANGE)) atGrade++;
    else if (j === JUNCTION.INTERSECTION && !map.hasFlag(i, FLAG.LIGHTS) && load > 0.7) busyPlain++;
  }
  if (atGrade) out.push(`${atGrade} highway junction${atGrade > 1 ? 's' : ''} cross other roads at grade: an Interchange ($${CONFIG.costs.interchange.toLocaleString()}) removes the slowdown.`);
  if (busyPlain) out.push(`${busyPlain} busy intersection${busyPlain > 1 ? 's' : ''} without traffic lights: lights ($${CONFIG.costs.lights}) cut the delay.`);
  const gb = state.garbage;
  if (gb && gb.uncollected > 20) out.push(`${gb.uncollected.toLocaleString()} units of garbage a month go uncollected (capacity ${gb.capacity.toLocaleString()}, made ${gb.made.toLocaleString()}): a landfill ($${CONFIG.buildings.landfill.cost.toLocaleString()}) collects ${CONFIG.buildings.landfill.garbage}. Keep it away from homes.`);
  const cut = Object.entries(state.budgets ?? {}).filter(([, f]) => f < 1);
  if (cut.length && net > 0) out.push(`Services running below full funding: ${cut.map(([g, f]) => `${CONFIG.budgets.groups[g].label} ${Math.round(f * 100)}%`).join(', ')}. You can afford to restore them.`);
  const open = Math.round(state.traffic?.skilledOpen ?? 0);
  if (open >= 15) out.push(`${open} skilled jobs are empty, so shops and industry can't grow denser. Schools${s.population >= CONFIG.buildings.university.unlock ? ' and a university' : ''} raise education over time.`);
  const breaks = (state.districts ?? []).filter((d) => d.policies.taxBreak);
  if (breaks.length && net < 0) out.push(`Tax breaks in ${breaks.map((d) => d.name).join(', ')} waive ${Math.round(CONFIG.districts.taxBreakCut * 100)}% of their taxes. Lift them once the district has grown.`);
  if (s.abandoned > 5) out.push(`${s.abandoned} abandoned buildings earn nothing: hover them to see why (jobs, pollution, commute).`);
  if (net < 0 && canTakeLoan(state)) out.push(`A $${E.loanAmount.toLocaleString()} loan buys time while the city grows.`);
  return out;
}
