// Simulation: pure data in, data out. No DOM, no canvas.
// A tick runs an ordered list of systems. Future systems (traffic, power,
// services) plug into SYSTEMS without touching rendering.

import { CONFIG } from './config.js';
import { GameMap, generateMap, TILE, TERRAIN, FLAG, isZone } from './map.js';
import { economySystem } from './economy.js';
import { trafficSystem } from './traffic.js';
import { utilitySystem, coverageSystem, happinessSystem, happinessReasons, utilitiesEnforced, kindOf, safetySystem, fireSystem } from './services.js';
import { SUPPLY } from './map.js';

export function createGame(seed, size = CONFIG.map.defaultSize) {
  const map = generateMap(seed, size);
  const state = {
    map,
    tick: 0,
    month: 0,
    year: CONFIG.time.startYear,
    funds: CONFIG.economy.startingFunds,
    taxRate: CONFIG.economy.taxRate,
    demand: { r: 0, c: 0, i: 0 },
    stats: emptyStats(),
    lastMonth: null,          // { income, expenses, breakdown }
    negativeMonths: 0,
    bankrupt: false,
    milestones: [],
    traffic: { workers: 0, employed: 0, avgCommute: 0, freightTrips: 0, congested: 0 },
    utilities: { power: { supply: 0, demand: 0 }, water: { supply: 0, demand: 0 } },
    happiness: 0,
    crime: 0,                 // population-weighted average crime in homes
    fires: 0,                 // buildings burning right now
    utilityGrace: 0,          // months left before utilities are enforced (older saves)
    events: [],               // messages for the UI to show, drained by it
    rng: Math.random,
  };
  runFieldSystems(state);
  computeStats(state);
  return state;
}

function emptyStats() {
  return {
    population: 0, comJobs: 0, indJobs: 0, jobs: 0, workers: 0,
    roads: 0, avenues: 0, highways: 0, bridges: 0, parks: 0,
    zoned: { r: 0, c: 0, i: 0 }, abandoned: 0,
    services: {},             // count per public building kind
  };
}

export function emit(state, text, kind = 'info') {
  state.events.push({ text, kind });
}

// ---------------------------------------------------------------- systems

// Roads: BFS from road tiles on the map edge. Unconnected roads get -1.
export function roadSystem(state) {
  const map = state.map;
  if (!map.roadsDirty) return;
  map.roadsDirty = false;
  const { width: w, height: h } = map;
  map.roadDist.fill(-1);
  const q = [];
  for (let i = 0; i < map.size; i++) {
    if (map.type[i] !== TILE.ROAD) continue;
    const x = i % w, y = (i / w) | 0;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { map.roadDist[i] = 0; q.push(i); }
  }
  for (let head = 0; head < q.length; head++) {
    const i = q[head], x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (map.type[j] === TILE.ROAD && map.roadDist[j] < 0) { map.roadDist[j] = map.roadDist[i] + 1; q.push(j); }
    }
  }
}

// Pollution: industry (and big commerce) emit with linear falloff;
// parks and trees absorb.
export function pollutionSystem(state) {
  const map = state.map, P = CONFIG.pollution;
  const { width: w, height: h } = map;
  const pol = map.pollution;
  pol.fill(0);
  for (let i = 0; i < map.size; i++) {
    const t = map.type[i], lv = map.level[i];
    if ((lv === 0 && t !== TILE.SERVICE) || map.hasFlag(i, FLAG.ABANDONED)) continue;
    let e = 0, r = 0;
    if (t === TILE.SERVICE && kindOf(map, i) === 'coal') { e = CONFIG.buildings.coal.pollution; r = CONFIG.buildings.coal.pollutionRadius; }
    else if (t === TILE.IND) { e = P.industryEmission[lv]; r = P.industryRadius[lv]; }
    else if (t === TILE.COM) { e = P.commercialEmission[lv]; r = P.commercialRadius[lv]; }
    if (e <= 0) continue;
    const x0 = i % w, y0 = (i / w) | 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const d = Math.hypot(dx, dy);
      if (d > r + 0.5) continue;
      pol[y * w + x] += e * (1 - d / (r + 1));
    }
  }
  // Traffic exhaust: busy roads pollute themselves and their neighbours.
  const TR = CONFIG.traffic;
  for (let i = 0; i < map.size; i++) {
    if (map.type[i] !== TILE.ROAD || map.traffic[i] <= 0) continue;
    const e = Math.min(TR.pollutionCap, map.traffic[i] * TR.pollutionPerTrip);
    const x0 = i % w, y0 = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      pol[y * w + x] += dx === 0 && dy === 0 ? e : e * 0.5;
    }
  }
  // Recycling centres cut pollution across their catchment.
  const cut = CONFIG.buildings.recycling.pollutionCut, rec = map.coverage.recycling;
  for (let i = 0; i < map.size; i++) if (rec[i] > 0) pol[i] *= 1 - cut * Math.min(1, rec[i] * 1.5);
  for (let i = 0; i < map.size; i++) {
    if (pol[i] <= 0) continue;
    let absorb = 0;
    const x0 = i % w, y0 = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const j = y * w + x, self = dx === 0 && dy === 0;
      if (map.type[j] === TILE.PARK) absorb += self ? P.parkAbsorb : P.parkAbsorb * 0.4;
      else if (map.hasFlag(j, FLAG.TREES)) absorb += self ? P.treeAbsorb : P.treeAbsorb * 0.3;
    }
    pol[i] = Math.max(0, Math.min(100, pol[i] - absorb));
  }
}

// Land value: water, parks, trees and shops add; pollution and blight subtract.
export function landValueSystem(state) {
  const map = state.map, L = CONFIG.landValue;
  const { width: w, height: h } = map;
  const lv = map.landValue;
  const parkB = new Float32Array(map.size), treeB = new Float32Array(map.size);
  const comB = new Float32Array(map.size), abB = new Float32Array(map.size);

  const spread = (target, i, r, amount, linear) => {
    const x0 = i % w, y0 = (i / w) | 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      target[y * w + x] += linear ? amount * (1 - d / (r + 1)) : amount;
    }
  };
  for (let i = 0; i < map.size; i++) {
    const t = map.type[i];
    if (t === TILE.PARK) spread(parkB, i, L.parkRadius, L.parkBonus, true);
    else if (map.hasFlag(i, FLAG.TREES)) spread(treeB, i, L.treeRadius, L.treeBonus, false);
    if (t === TILE.COM && map.level[i] > 0 && !map.hasFlag(i, FLAG.ABANDONED)) {
      spread(comB, i, L.commercialRadius, L.commercialBonus * map.level[i], false);
    }
    if (map.hasFlag(i, FLAG.ABANDONED)) spread(abB, i, L.abandonedRadius, L.abandonedPenalty, false);
  }
  for (let i = 0; i < map.size; i++) {
    if (map.terrain[i] === TERRAIN.WATER) { lv[i] = 0; continue; }
    const wd = map.waterDist[i];
    let v = L.base;
    if (wd <= L.waterRadius) v += L.waterBonus * (1 - (wd - 1) / L.waterRadius);
    v += Math.min(L.parkCap, parkB[i]);
    v += Math.min(L.treeCap, treeB[i]);
    v += Math.min(L.commercialCap, comB[i]);
    v -= abB[i];
    v -= map.crime[i] * CONFIG.crime.landValueWeight;
    const B = CONFIG.buildings, cov = map.coverage;
    v += cov.school[i] * B.school.landValue + cov.clinic[i] * B.clinic.landValue + cov.plaza[i] * B.plaza.landValue;
    if (map.type[i] !== TILE.ROAD) v -= Math.min(CONFIG.traffic.noiseCap, map.passing[i] * CONFIG.traffic.noisePerTrip);
    v -= map.pollution[i] * L.pollutionWeight;
    lv[i] = Math.max(0, Math.min(100, v));
  }
}

// Shoppers: residents within a radius, via a summed-area table.
export function shopperSystem(state) {
  const map = state.map, r = CONFIG.growth.shopperRadius;
  const { width: w, height: h } = map;
  const cap = CONFIG.capacity.residential;
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (map.type[i] === TILE.RES && !map.hasFlag(i, FLAG.ABANDONED)) row += cap[map.level[i]];
      sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row;
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r);
    const x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1);
    map.shoppers[y * w + x] = sat[y1 * (w + 1) + x1] - sat[y0 * (w + 1) + x1]
      - sat[y1 * (w + 1) + x0] + sat[y0 * (w + 1) + x0];
  }
}

export function computeStats(state) {
  const map = state.map, cap = CONFIG.capacity;
  const s = emptyStats();
  for (let i = 0; i < map.size; i++) {
    const t = map.type[i], lv = map.level[i];
    const alive = !map.hasFlag(i, FLAG.ABANDONED) && !map.hasFlag(i, FLAG.FIRE);
    if (t === TILE.RES) { s.zoned.r++; if (alive) s.population += cap.residential[lv]; }
    else if (t === TILE.COM) { s.zoned.c++; if (alive) s.comJobs += cap.commercial[lv]; }
    else if (t === TILE.IND) { s.zoned.i++; if (alive) s.indJobs += cap.industrial[lv]; }
    else if (t === TILE.ROAD) {
      if (map.terrain[i] === TERRAIN.WATER) s.bridges++;
      else if (map.roadClass[i] === 1) s.avenues++;
      else if (map.roadClass[i] === 2) s.highways++;
      else s.roads++;
    }
    else if (t === TILE.PARK) s.parks++;
    else if (t === TILE.SERVICE) { const k = kindOf(map, i); s.services[k] = (s.services[k] || 0) + 1; }
    if (isZone(t) && !alive) s.abandoned++;
  }
  s.jobs = s.comJobs + s.indJobs;
  s.workers = s.population * CONFIG.demand.workforceRatio;
  state.stats = s;
}

// RCI demand — the classic meter. See README for the model.
export function targetDemand(state) {
  const D = CONFIG.demand, s = state.stats;
  const P = s.population, C = s.comJobs, I = s.indJobs, jobs = C + I;
  const norm = (want, have) => (want - have) / Math.max(want, D.scaleMin);

  // Residential: people move in when there are jobs for them.
  const targetPop = (jobs + D.externalJobs) / D.workforceRatio;
  let r = norm(targetPop, P);

  // Labour: can the city staff more businesses?
  const labor = P * D.workforceRatio + D.externalLabor;
  const laborRoom = norm(labor, jobs) + D.laborSlack;

  // Commercial: shoppers need shops.
  let c = Math.min(norm(P * D.comPerResident + D.comBase, C), laborRoom);
  // Industrial: goods for residents + regional exports.
  let i = Math.min(norm(P * D.indPerResident + D.indBase, I), laborRoom);

  const tax = (state.taxRate - D.taxNeutral) * D.taxSensitivity;
  const clamp = (v) => Math.max(-1, Math.min(1, v - tax));
  return { r: clamp(r), c: clamp(c), i: clamp(i) };
}

export function demandSystem(state) {
  const t = targetDemand(state), k = CONFIG.demand.smoothing;
  state.demand.r += (t.r - state.demand.r) * k;
  state.demand.c += (t.c - state.demand.c) * k;
  state.demand.i += (t.i - state.demand.i) * k;
}

// Score a zone tile: >0 wants to grow, <0 wants to shrink. Also returns the
// max density the site supports and human-readable reasons (for the UI).
export function evaluateTile(state, i) {
  const map = state.map, G = CONFIG.growth;
  const t = map.type[i];
  const reasons = [];
  if (!isZone(t)) return null;
  if (!map.hasRoadAccess(i)) {
    const near = adjacentRoadKinds(map, i);
    reasons.push(near.local ? 'Road is not connected to the regional network'
      : near.highway ? 'Highways have no driveways: needs a street or avenue next to it'
      : 'Needs a road next to it');
    return { score: -1, maxLevel: 0, reasons, connected: false };
  }
  const lv = map.landValue[i];
  let score, maxLevel = 3;
  if (t === TILE.RES) {
    const hp = map.happiness[i];
    score = state.demand.r + (lv - 40) / 60 * G.landValueWeight + (hp - 50) / 50 * CONFIG.happiness.scoreWeight;
    if (hp < 40 && map.level[i] > 0) {
      const why = happinessReasons(state, i);
      reasons.push(`Unhappy residents (${Math.round(hp)})${why.length ? ': ' + why.join(', ') : ''}`);
    }
    while (maxLevel > 1 && lv < G.residentialLevelLV[maxLevel]) maxLevel--;
    if (state.demand.r <= 0) reasons.push('No residential demand — the city needs more jobs');
    if (maxLevel < 3) reasons.push(`Land value ${lv.toFixed(0)} caps density at ${levelName(maxLevel)} (needs ${G.residentialLevelLV[maxLevel + 1]})`);
    if (map.pollution[i] > 20) reasons.push('Pollution is hurting this neighbourhood');
    const TR = CONFIG.traffic, c = map.commute[i];
    if (!Number.isFinite(c)) {
      score -= TR.commuteWeight;
      reasons.push(`No jobs within a ${TR.maxCommute}-minute commute`);
    } else if (c > TR.comfortCommute) {
      score -= Math.min(1, (c - TR.comfortCommute) / (TR.maxCommute - TR.comfortCommute)) * TR.commuteWeight;
      reasons.push(`Long commute: ${c.toFixed(0)} min (comfortable is ${TR.comfortCommute})`);
    }
    const emp = map.employed[i];
    if (map.level[i] > 0 && emp < TR.unemploymentThreshold) {
      score -= (TR.unemploymentThreshold - emp) * TR.unemploymentWeight;
      reasons.push(`${Math.round((1 - emp) * 100)}% of workers here can't reach a job`);
    }
  } else if (t === TILE.COM) {
    const shoppers = map.shoppers[i];
    const TR = CONFIG.traffic;
    score = state.demand.c + (lv - 40) / 60 * 0.3 + Math.min(0.3, shoppers / 400) - 0.1
      + map.coverage.plaza[i] * CONFIG.buildings.plaza.shopBonus
      - map.crime[i] / 100 * CONFIG.crime.businessWeight
      + Math.min(TR.passingBonusCap, map.passing[i] / TR.passingBonusPer * 0.1);
    while (maxLevel > 1 && (lv < G.commercialLevelLV[maxLevel] || shoppers < G.commercialLevelShoppers[maxLevel])) maxLevel--;
    if (state.demand.c <= 0) reasons.push('No commercial demand — needs more residents (or workers)');
    if (maxLevel < 3) {
      if (shoppers < G.commercialLevelShoppers[maxLevel + 1]) reasons.push(`Only ${shoppers.toFixed(0)} residents nearby — ${levelName(maxLevel + 1)} shops need ${G.commercialLevelShoppers[maxLevel + 1]}`);
      if (lv < G.commercialLevelLV[maxLevel + 1]) reasons.push(`Land value ${lv.toFixed(0)} caps density (needs ${G.commercialLevelLV[maxLevel + 1]})`);
    }
  } else {
    const rd = map.accessRoadDist(i);
    score = state.demand.i - map.crime[i] / 100 * CONFIG.crime.businessWeight;
    if (rd <= G.freightNear) score += G.freightBonus;
    else if (rd > G.freightFar) { score -= G.freightPenalty; reasons.push(`Long freight trip: ${rd} road tiles to the highway`); }
    if (state.demand.i <= 0) reasons.push('No industrial demand — needs more residents (or workers)');
  }
  // Utilities cap density: power for medium, power + water for high.
  const U = CONFIG.utilities;
  const enforce = utilitiesEnforced(state);
  const hasPower = map.power[i] === SUPPLY.OK, hasWater = map.water[i] === SUPPLY.OK;
  let utilCap = 3;
  if (!hasPower) utilCap = U.powerForLevel - 1;
  else if (!hasWater) utilCap = U.waterForLevel - 1;
  if (utilCap < maxLevel) {
    const need = !hasPower ? (map.power[i] === SUPPLY.SHORT ? 'Power shortage: build another plant' : 'No power: build a power plant beside a connected road')
      : (map.water[i] === SUPPLY.SHORT ? 'Water shortage: build another pump' : 'No water: build a water pump beside a connected road');
    if (enforce) {
      maxLevel = Math.max(1, utilCap);
      reasons.push(`${need} (caps density at ${levelName(maxLevel)})`);
    } else {
      reasons.push(`${need}. Required in ${state.utilityGrace} month${state.utilityGrace === 1 ? '' : 's'}`);
    }
  }
  if (t !== TILE.RES && map.crime[i] > 30) {
    reasons.push(`Crime ${Math.round(map.crime[i])} is scaring off business${map.coverage.police[i] < 0.05 ? ': build a police station nearby' : ''}`);
  }
  if (map.hasFlag(i, FLAG.FIRE)) {
    reasons.unshift(map.coverage.fire[i] > 0.05 ? 'On fire! Firefighters are on the way' : 'On fire! No fire station nearby: it may burn down');
  }
  if (map.hasFlag(i, FLAG.ABANDONED) && score > 0) reasons.push('Conditions improving — may be reoccupied');
  return { score, maxLevel, reasons, connected: true };
}

function adjacentRoadKinds(map, i) {
  const x = i % map.width, y = (i / map.width) | 0, out = { local: false, highway: false };
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (!map.inBounds(x + dx, y + dy)) continue;
    const j = map.idx(x + dx, y + dy);
    if (map.isLocalRoad(j)) out.local = true;
    else if (map.type[j] === TILE.ROAD) out.highway = true;
  }
  return out;
}

export function levelName(l) { return ['vacant', 'low', 'medium', 'high'][l]; }

export function growthSystem(state) {
  const map = state.map, G = CONFIG.growth, rng = state.rng;
  for (let i = 0; i < map.size; i++) {
    const t = map.type[i];
    if (!isZone(t)) continue;
    const ev = evaluateTile(state, i);
    const level = map.level[i];
    if (map.hasFlag(i, FLAG.FIRE)) continue; // nothing grows while it burns
    const abandoned = map.hasFlag(i, FLAG.ABANDONED);
    if (abandoned) {
      if (ev.score > 0.1 && rng() < G.recoverChance) map.setFlag(i, FLAG.ABANDONED, false);
      continue;
    }
    if (!ev.connected) {
      // Cut off from the network: businesses and residents leave.
      if (level > 0 && rng() < G.declineChance) {
        if (level === 1) map.setFlag(i, FLAG.ABANDONED, true); else map.level[i]--;
      }
      continue;
    }
    if (level < ev.maxLevel && ev.score > G.growThreshold) {
      if (rng() < G.growChance * ev.score * G.levelGrowMult[level]) {
        map.level[i]++;
        map.variant[i] = (rng() * 256) | 0;
      }
    } else if (level > 0 && (level > ev.maxLevel || ev.score < G.declineThreshold)) {
      if (rng() < G.declineChance) {
        if (level === 1 && ev.score < G.abandonThreshold) map.setFlag(i, FLAG.ABANDONED, true);
        else if (level > 1 || ev.score < G.declineThreshold) map.level[i]--;
      }
    }
  }
}

function runFieldSystems(state) {
  roadSystem(state);
  trafficSystem(state);
  coverageSystem(state);
  utilitySystem(state);
  pollutionSystem(state);
  landValueSystem(state);
  shopperSystem(state);
  safetySystem(state);
  happinessSystem(state);
}

const MILESTONES = [100, 500, 1000, 2500, 5000, 10000, 20000];

function milestoneSystem(state) {
  const p = state.stats.population;
  for (const m of MILESTONES) {
    if (p >= m && !state.milestones.includes(m)) {
      state.milestones.push(m);
      emit(state, `Milestone: population ${m.toLocaleString()}!`, 'good');
    }
  }
}

// Ordered pipeline. Each entry: { name, run(state), every?: ticks }
export const SYSTEMS = [
  { name: 'roads', run: roadSystem },
  { name: 'traffic', run: trafficSystem, every: CONFIG.traffic.everyTicks },
  { name: 'coverage', run: coverageSystem, every: CONFIG.sim.fieldsEveryTicks },
  { name: 'utilities', run: utilitySystem, every: CONFIG.utilities.everyTicks },
  { name: 'pollution', run: pollutionSystem, every: CONFIG.sim.fieldsEveryTicks },
  { name: 'landValue', run: landValueSystem, every: CONFIG.sim.fieldsEveryTicks },
  { name: 'shoppers', run: shopperSystem, every: CONFIG.sim.fieldsEveryTicks },
  { name: 'safety', run: safetySystem, every: CONFIG.sim.fieldsEveryTicks },
  { name: 'happiness', run: happinessSystem, every: CONFIG.sim.fieldsEveryTicks },
  { name: 'stats', run: computeStats },
  { name: 'demand', run: demandSystem },
  { name: 'growth', run: growthSystem },
  { name: 'fire', run: fireSystem },
  { name: 'stats2', run: computeStats },
  { name: 'milestones', run: milestoneSystem },
  { name: 'economy', run: economySystem },
];

export function tick(state) {
  if (state.bankrupt) return;
  state.tick++;
  for (const sys of SYSTEMS) {
    if (sys.every && state.tick % sys.every !== 0) continue;
    sys.run(state);
  }
}

// Call after the player edits the map so fields update immediately.
export function refreshFields(state) {
  runFieldSystems(state);
  computeStats(state);
}

export { GameMap };
