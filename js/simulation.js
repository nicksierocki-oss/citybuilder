// @ts-check
// Simulation: pure data in, data out. No DOM, no canvas.
// A tick runs an ordered list of systems. Future systems (traffic, power,
// services) plug into SYSTEMS without touching rendering.

import { CONFIG } from './config.js';
import { generateMap, TILE, TERRAIN, FLAG, SUPPLY, KINDS, JUNCTION, ROADMOD, isZone, isHome, isShop, homeCap, jobCap, skilledShare } from './map.js';
import { economySystem } from './economy.js';
import { trafficSystem } from './traffic.js';
import { utilitySystem, coverageSystem, happinessSystem, happinessReasons, utilitiesEnforced, kindOf, safetySystem, fireSystem, healthSystem, garbageSystem,
  educationFieldSystem, educationMonthlySystem, isParkTile, AMENITY_KINDS } from './services.js';
import { ordinance, mayorSystem } from './cityhall.js';
import { goalsSystem, emptyGoals } from './goals.js';
import { newsSystem } from './news.js';
import { exportDemand } from './region.js';
import { railExits } from './transit.js';
import { tourismSystem, hubExports, hubOffices, ATTRACTION_KINDS } from './tourism.js';

export const DEFAULT_CITY_NAME = 'My City';
const CITY_NAMES = ['Willowbrook', 'Riverton', 'Maple Bay', 'Fairhaven', 'Linden Park', 'Ashford', 'Brightwater',
  'Clearfield', 'Elm Harbor', 'Pine Hollow', 'Sunnydale', 'Oakridge', 'Millbrook', 'Harbor Point'];

export function emptyHistory() {
  return { samples: [] };
}

export function createGame(seed, size = CONFIG.map.defaultSize, landform = 'plains') {
  const map = generateMap(seed, size, landform);
  const state = {
    map,
    tick: 0,
    month: CONFIG.time.startMonth ?? 0,
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
    loans: [],                // [{ monthsLeft, payment }]
    events: [],               // messages for the UI to show, drained by it
    rng: Math.random,
    cityName: CITY_NAMES[Math.floor(Math.random() * CITY_NAMES.length)],
    districts: [],            // [{ id, name, color, policies: { height, noHeavyIndustry, taxBreak } }]
    history: emptyHistory(),  // monthly samples for the graphs panel
    education: 0,             // population-weighted skilled share of residents
    ordinances: {},           // city-wide policies in force (see cityhall.js)
    budgets: {},              // service funding per group, 0.5..1.5 (missing = 1)
    garbageGrace: 0,          // months before garbage matters (older saves)
    health: 0,                // population-weighted health
    garbage: { made: 0, capacity: 0, uncollected: 0 },
    lines: [],                // transit lines [{ id, name, color, mode, stops, freq }]
    tradeDeals: {},           // buy_power, sell_power, buy_water, sell_water
    trade: {},                // last month's utility trade (region.js)
    rating: CONFIG.mayor.start, // mayor rating 0..100
    goals: emptyGoals('tutorial'),
    scenario: null,           // { id, status: 'active'|'won'|'lost', banned, deadlineYear }
    achievements: [],         // achievement ids earned in this city
    mayorLevel: 1,            // mayor level from achievements (goals.js MAYOR_LEVELS)
    news: [],                 // citizen posts and headlines (news.js)
  };
  runFieldSystems(state);
  computeStats(state);
  tourismSystem(state);
  return state;
}

function emptyStats() {
  return {
    population: 0, comJobs: 0, indJobs: 0, jobs: 0, workers: 0,
    roads: 0, avenues: 0, highways: 0, bridges: 0, parks: 0, lights: 0, interchanges: 0,
    zoned: { r: 0, c: 0, i: 0, o: 0, f: 0, m: 0 }, abandoned: 0,
    officeJobs: 0, farmJobs: 0, hotels: 0, hotelIncome: 0, rails: 0, railBridges: 0, roundabouts: 0,
    services: {},             // count per public building kind (landmarks count once)
    taxBase: { r: 0, c: 0, i: 0, o: 0, f: 0 }, // taxable residents/jobs after education, high-tech and tax breaks
    skilledJobs: 0, hightech: 0,
    districts: {},            // id -> { population, jobs, happiness, homes }
  };
}

// Policies of the district tile i belongs to (null if none).
export function districtAt(state, i) {
  const id = state.map.district[i];
  if (!id || !state.districts) return null;
  return state.districts.find((d) => d.id === id) ?? null;
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
    const sk = t === TILE.SERVICE && !map.part[i] ? kindOf(map, i) : null;
    if (sk && CONFIG.buildings[sk].pollution) { e = CONFIG.buildings[sk].pollution; r = CONFIG.buildings[sk].pollutionRadius; }
    else if (t === TILE.IND) {
      e = P.industryEmission[lv] * (map.hasFlag(i, FLAG.HIGHTECH) ? CONFIG.education.hightech.emission : 1);
      r = P.industryRadius[lv];
    }
    else if (isShop(t)) { e = P.commercialEmission[lv]; r = P.commercialRadius[lv]; }
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
  if (ordinance(state, 'recycling')) { const k = 1 - CONFIG.ordinances.recycling.pollutionCut; for (let i = 0; i < map.size; i++) pol[i] *= k; }
  for (let i = 0; i < map.size; i++) {
    if (pol[i] <= 0) continue;
    let absorb = 0;
    const x0 = i % w, y0 = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const j = y * w + x, self = dx === 0 && dy === 0;
      if (isParkTile(map, j)) absorb += self ? P.parkAbsorb : P.parkAbsorb * 0.4;
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
    if (isShop(t) && map.level[i] > 0 && !map.hasFlag(i, FLAG.ABANDONED)) {
      spread(comB, i, L.commercialRadius, L.commercialBonus * map.level[i], false);
    }
    if (map.hasFlag(i, FLAG.ABANDONED)) spread(abB, i, L.abandonedRadius, L.abandonedPenalty, false);
  }
  // Tiles beside tram track are nicer places to be.
  const tramNear = new Uint8Array(map.size);
  for (let i = 0; i < map.size; i++) {
    if (!map.hasFlag(i, FLAG.TRAM) || map.type[i] !== TILE.ROAD) continue;
    const x0 = i % w, y0 = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (map.inBounds(x0 + dx, y0 + dy)) tramNear[(y0 + dy) * w + x0 + dx] = 1;
  }
  for (let i = 0; i < map.size; i++) {
    if (map.terrain[i] === TERRAIN.WATER) { lv[i] = 0; continue; }
    const wd = map.waterDist[i];
    let v = L.base;
    if (wd <= L.waterRadius) v += L.waterBonus * (1 - (wd - 1) / L.waterRadius);
    v += Math.min(L.parkCap, parkB[i]);
    v += Math.min(L.treeCap, treeB[i]);
    v += Math.min(L.commercialCap, comB[i]);
    v -= Math.min(L.abandonedCap, abB[i]);
    v -= map.crime[i] * CONFIG.crime.landValueWeight;
    const B = CONFIG.buildings, cov = map.coverage;
    for (const k of AMENITY_KINDS) v += cov[k][i] * B[k].landValue;
    v += Math.max(cov.bus[i] * B.bus.landValue, cov.metro[i] * B.metro.landValue, cov.railstation[i] * B.railstation.landValue);
    if (map.type[i] !== TILE.ROAD) v -= Math.min(CONFIG.traffic.noiseCap, map.passing[i] * CONFIG.traffic.noisePerTrip);
    v -= map.pollution[i] * L.pollutionWeight + map.trash[i] * CONFIG.garbage.landValueWeight;
    if (tramNear[i]) v += CONFIG.transit.modes.tram.landValue;
    if (map.elev[i]) v += Math.min(CONFIG.terrain.viewValueMax, map.elev[i] * CONFIG.terrain.viewValue); // hillside views
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
      if (isHome(map.type[i]) && !map.hasFlag(i, FLAG.ABANDONED)) row += homeCap(map, i);
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
  const map = state.map, cap = CONFIG.capacity, E = CONFIG.education, cut = 1 - CONFIG.districts.taxBreakCut;
  const s = emptyStats();
  const policies = new Map((state.districts ?? []).map((d) => [d.id, d.policies]));
  let eduSum = 0;
  for (const d of state.districts ?? []) s.districts[d.id] = { population: 0, jobs: 0, happiness: 0, homes: 0 };
  for (let i = 0; i < map.size; i++) {
    const t = map.type[i], lv = map.level[i];
    const abandoned = map.hasFlag(i, FLAG.ABANDONED);
    const alive = !abandoned && !map.hasFlag(i, FLAG.FIRE); // burning buildings are empty for now
    const did = map.district[i], ds = did ? s.districts[did] : null;
    const tax = did && policies.get(did)?.taxBreak ? cut : 1;
    if (isZone(t)) {
      if (t === TILE.RES) s.zoned.r++; else if (t === TILE.COM) s.zoned.c++; else if (t === TILE.IND) s.zoned.i++;
      else if (t === TILE.OFFICE) s.zoned.o++; else if (t === TILE.FARM) s.zoned.f++; else s.zoned.m++;
      if (alive && isHome(t)) {
        const pop = homeCap(map, i), edu = map.education[i] / 255;
        s.population += pop;
        eduSum += pop * edu;
        s.taxBase.r += pop * (1 + E.taxBonus * edu) * tax;
        if (ds && lv > 0) { ds.population += pop; ds.happiness += map.happiness[i] * pop; ds.homes++; }
      }
      const jobs = alive ? jobCap(map, i) : 0;
      if (jobs) {
        const ht = t === TILE.IND && map.hasFlag(i, FLAG.HIGHTECH);
        if (isShop(t)) { s.comJobs += jobs; s.taxBase.c += jobs * tax; }
        else if (t === TILE.IND) { s.indJobs += jobs; s.taxBase.i += jobs * tax * (ht ? E.hightech.taxMult : 1); }
        else if (t === TILE.OFFICE) { s.officeJobs += jobs; s.taxBase.o += jobs * tax; }
        else { s.farmJobs += jobs; s.taxBase.f += jobs * tax; }
        if (t === TILE.COM && map.hasFlag(i, FLAG.HOTEL)) { s.hotels++; s.hotelIncome += CONFIG.economy.hotelIncome[lv] * (1 + tourismScore(map, i)); }
        s.skilledJobs += jobs * skilledShare(map, i);
        if (ht) s.hightech++;
        if (ds) ds.jobs += jobs;
      }
    }
    else if (t === TILE.ROAD) {
      if (map.terrain[i] === TERRAIN.WATER) s.bridges++;
      else if (map.roadClass[i] === 1) s.avenues++;
      else if (map.roadClass[i] === 2) s.highways++;
      else s.roads++;
      if (map.hasFlag(i, FLAG.LIGHTS)) s.lights++;
      if (map.hasFlag(i, FLAG.INTERCHANGE)) s.interchanges++;
      if (map.roadMod[i] & ROADMOD.ROUNDABOUT && map.junctionKind(i) === JUNCTION.INTERSECTION) s.roundabouts++;
    }
    else if (t === TILE.PARK) s.parks++;
    if (map.rail[i]) { if (map.terrain[i] === TERRAIN.WATER) s.railBridges++; else s.rails++; }
    else if (t === TILE.SERVICE && !map.part[i]) { const k = kindOf(map, i); s.services[k] = (s.services[k] || 0) + 1; }
    if (isZone(t) && abandoned) s.abandoned++;
  }
  for (const ds of Object.values(s.districts)) ds.happiness = ds.population ? ds.happiness / ds.population : 0;
  s.jobs = s.comJobs + s.indJobs + s.officeJobs + s.farmJobs;
  s.workers = s.population * CONFIG.demand.workforceRatio;
  state.education = s.population ? eduSum / s.population : 0;
  state.stats = s;
}

// RCI demand — the classic meter. See README for the model.
export function targetDemand(state) {
  const D = CONFIG.demand, s = state.stats;
  const P = s.population, C = s.comJobs, I = s.indJobs, O = s.officeJobs ?? 0, F = s.farmJobs ?? 0, jobs = C + I + O + F;
  const norm = (want, have) => (want - have) / Math.max(want, D.scaleMin);

  // Residential: people move in when there are jobs for them.
  const targetPop = (jobs + D.externalJobs) / D.workforceRatio;
  let r = norm(targetPop, P);

  // Labour: can the city staff more businesses?
  const labor = P * D.workforceRatio + D.externalLabor + railExits(state) * CONFIG.rail.regionalWorkers; // trains bring commuters in
  const laborRoom = norm(labor, jobs) + D.laborSlack;

  // Commercial: shoppers need shops.
  let c = Math.min(norm(P * D.comPerResident + D.comBase + (state.tourism?.visitors ?? 0) * CONFIG.tourism.shopJobsPerVisitor, C), laborRoom);
  // Industrial: goods for residents + regional exports.
  let i = Math.min(norm(P * D.indPerResident + D.indBase + exportDemand(state) + hubExports(state), I), laborRoom);
  // Offices: skilled workers looking for skilled work.
  const skilled = P * D.workforceRatio * (state.education ?? 0);
  let o = Math.min(norm(skilled * D.officePerSkilled + D.officeBase + hubOffices(state), O), laborRoom);
  // Farms: food for residents plus regional produce demand.
  let f = Math.min(norm(P * D.farmPerResident + D.farmBase, F), laborRoom);

  const tax = (state.taxRate - D.taxNeutral) * D.taxSensitivity;
  const clamp = (v) => Math.max(-1, Math.min(1, v - tax));
  return { r: clamp(r), c: clamp(c), i: clamp(i), o: clamp(o), f: clamp(f) };
}

export function demandSystem(state) {
  const t = targetDemand(state), k = CONFIG.demand.smoothing;
  state.demand.r += (t.r - state.demand.r) * k;
  state.demand.c += (t.c - state.demand.c) * k;
  state.demand.i += (t.i - state.demand.i) * k;
  state.demand.o = (state.demand.o ?? 0) + (t.o - (state.demand.o ?? 0)) * k;
  state.demand.f = (state.demand.f ?? 0) + (t.f - (state.demand.f ?? 0)) * k;
}

// Score a zone tile: >0 wants to grow, <0 wants to shrink. Also returns the
// max density the site supports and human-readable reasons (for the UI).
export function evaluateTile(state, i) {
  const map = state.map, G = CONFIG.growth;
  const t = map.type[i];
  const reasons = [];
  if (!isZone(t)) return null;
  if (!map.hasRoadAccess(i) && !(t === TILE.FARM && map.roadWithin(i, 2))) {
    const near = adjacentRoadKinds(map, i);
    reasons.push(near.local ? 'Road is not connected to the regional network'
      : near.highway ? 'Highways have no driveways: needs a street or avenue next to it'
      : 'Needs a road next to it');
    return { score: -1, maxLevel: 0, reasons, connected: false };
  }
  const lv = map.landValue[i];
  // Residential part (homes and mixed-use upstairs).
  const homePart = () => {
    let score, maxLevel = 3;
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
    return [score, maxLevel];
  };
  // Shop part (shops and mixed-use street level).
  const shopPart = () => {
    let score, maxLevel = 3;
    const shoppers = map.shoppers[i];
    const TR = CONFIG.traffic;
    score = state.demand.c + (lv - 40) / 60 * 0.3 + Math.min(0.3, shoppers / 400) - 0.1
      + map.coverage.plaza[i] * CONFIG.buildings.plaza.shopBonus + map.coverage.stadium[i] * CONFIG.buildings.stadium.shopBonus + map.coverage.parking[i] * CONFIG.buildings.parking.shopBonus
      - map.crime[i] / 100 * CONFIG.crime.businessWeight
      + Math.min(TR.passingBonusCap, map.passing[i] / TR.passingBonusPer * 0.1)
      - (ordinance(state, 'carFree') ? CONFIG.ordinances.carFree.shopPenalty : 0);
    while (maxLevel > 1 && (lv < G.commercialLevelLV[maxLevel] || shoppers < G.commercialLevelShoppers[maxLevel])) maxLevel--;
    if (state.demand.c <= 0) reasons.push('No commercial demand — needs more residents (or workers)');
    if (maxLevel < 3) {
      if (shoppers < G.commercialLevelShoppers[maxLevel + 1]) reasons.push(`Only ${shoppers.toFixed(0)} residents nearby — ${levelName(maxLevel + 1)} shops need ${G.commercialLevelShoppers[maxLevel + 1]}`);
      if (lv < G.commercialLevelLV[maxLevel + 1]) reasons.push(`Land value ${lv.toFixed(0)} caps density (needs ${G.commercialLevelLV[maxLevel + 1]})`);
    }
    return [score, maxLevel];
  };
  let score, maxLevel = 3;
  if (t === TILE.RES) [score, maxLevel] = homePart();
  else if (t === TILE.COM) [score, maxLevel] = shopPart();
  else if (t === TILE.MIXED) {
    const a = homePart(), b = shopPart();
    score = (a[0] + b[0]) / 2 + 0.05; // a little extra appeal: shops downstairs, homes upstairs
    maxLevel = Math.min(a[1], Math.max(1, b[1]));
  } else if (t === TILE.OFFICE) {
    const Z = CONFIG.zones, edu = map.eduNearby[i];
    score = (state.demand.o ?? 0) + (lv - 40) / 60 * 0.3 + (edu - 0.3) * Z.officeEduWeight - map.crime[i] / 100 * CONFIG.crime.businessWeight
      + map.coverage.parking[i] * CONFIG.buildings.parking.officeBonus;
    while (maxLevel > 1 && lv < Z.officeLevelLV[maxLevel]) maxLevel--;
    if ((state.demand.o ?? 0) <= 0) reasons.push('No office demand: offices need skilled residents (schools, a university)');
    if (edu < 0.3) reasons.push(`Only ${Math.round(edu * 100)}% of nearby residents are skilled: offices want 30%+`);
    if (maxLevel < 3) reasons.push(`Land value ${lv.toFixed(0)} caps offices at ${levelName(maxLevel)} (needs ${Z.officeLevelLV[maxLevel + 1]})`);
  } else if (t === TILE.FARM) {
    const Z = CONFIG.zones;
    score = (state.demand.f ?? 0) + 0.05 - Math.max(0, lv - Z.farmMaxLandValue) / 50 - Math.max(0, map.pollution[i] - Z.farmPollutionLimit) / 50;
    if ((state.demand.f ?? 0) <= 0) reasons.push('No farm demand right now');
    if (lv > Z.farmMaxLandValue) reasons.push(`Land here is too valuable for farming (${lv.toFixed(0)}; farms like under ${Z.farmMaxLandValue})`);
    if (map.pollution[i] > Z.farmPollutionLimit) reasons.push('Crops don\'t grow well in polluted air');
  } else {
    const rd = map.accessRoadDist(i);
    if (map.hasFlag(i, FLAG.HIGHTECH) && map.level[i] > 0) reasons.push('High-tech industry: clean, well paid, needs skilled workers');
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
  if (t === TILE.FARM) utilCap = 3; // farms get by on wells and generators
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
  // Hillsides: steep lots can't take tall buildings.
  const slope = map.slope(i), slopeCap = CONFIG.terrain.zoneMaxLevel[Math.min(2, slope)];
  if (slopeCap < maxLevel) { maxLevel = slopeCap; reasons.push(`Sloping ground (${slope} level${slope > 1 ? 's' : ''}) caps density at ${levelName(slopeCap)}: flatten it with Lower/Raise land`); }
  // District policies
  const district = districtAt(state, i);
  if (district) {
    const P = district.policies;
    if (P.height < maxLevel) { maxLevel = P.height; reasons.push(`${district.name}: height limit of ${levelName(P.height)} density`); }
    if (t === TILE.IND && P.noHeavyIndustry && !map.hasFlag(i, FLAG.HIGHTECH) && maxLevel > 1) {
      maxLevel = 1;
      reasons.push(`${district.name} bans heavy industry: only small workshops or high-tech`);
    }
    if (P.taxBreak) score += CONFIG.districts.taxBreakBonus;
  }
  // Skilled jobs: denser businesses need educated workers.
  if (t !== TILE.RES && map.level[i] > 0) {
    const E = CONFIG.education, lv0 = map.level[i];
    const posts = jobCap(map, i) * skilledShare(map, i);
    if (posts >= E.minSkilledPosts) {
      const fill = map.skillFill[i];
      const why = `Only ${Math.round(fill * 100)}% of its ${Math.round(posts)} skilled jobs are filled${map.coverage.school[i] < 0.05 ? ': build a school nearby' : ': more schools raise education'}`;
      if (fill < E.growFill && maxLevel > lv0) { maxLevel = lv0; reasons.push(why); }
      if (fill < E.declineFill) {
        score -= E.penalty * (1 - fill);
        if (!reasons.includes(why)) reasons.push(why);
      }
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
    if (!isZone(t) || map.hasFlag(i, FLAG.FIRE)) continue; // nothing grows while it burns
    const ev = evaluateTile(state, i);
    const level = map.level[i];
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
    if (t === TILE.IND && level > 0) highTechCheck(state, i);
    if (t === TILE.COM) hotelCheck(state, i);
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

// How attractive tile i is to visitors (0..~1.3): water views, landmarks nearby, land value.
export function tourismScore(map, i) {
  const Z = CONFIG.zones, c = map.coverage, wd = map.waterDist[i];
  const water = wd <= 3 ? Z.hotelWater * (1 - (wd - 1) / 3) : 0;
  let sights = Math.max(c.stadium[i], c.centralpark[i], c.townpark[i] * 0.6, c.university[i] * 0.5, c.statue[i] * 0.5);
  for (const k of ATTRACTION_KINDS) sights = Math.max(sights, c[k][i]);
  return water + Math.min(1, sights) * Z.hotelLandmarks + map.landValue[i] / 100 * Z.hotelLandValue;
}

// Shops (medium density and up) in attractive spots may become hotels, and back if the spot fades.
function hotelCheck(state, i) {
  const map = state.map, Z = CONFIG.zones, hotel = map.hasFlag(i, FLAG.HOTEL);
  if (map.level[i] < 2 || map.hasFlag(i, FLAG.ABANDONED)) { if (hotel) map.setFlag(i, FLAG.HOTEL, false); return; }
  const score = tourismScore(map, i);
  if (!hotel && score >= Z.hotelThreshold && state.rng() < Z.hotelChance) {
    map.setFlag(i, FLAG.HOTEL, true);
    map.version++;
    if (!state.milestones.includes('hotel')) {
      state.milestones.push('hotel');
      state.events.push({ text: 'Your first hotel! Tourists come for the views and landmarks, and spend money in town.', kind: 'good', x: i % map.width, y: (i / map.width) | 0 });
    }
  } else if (hotel && score < Z.hotelThreshold * 0.7 && state.rng() < Z.hotelChance) {
    map.setFlag(i, FLAG.HOTEL, false);
    map.version++;
  }
}

// Industry in a well-educated area may turn high-tech (and back if education falls).
function highTechCheck(state, i) {
  const map = state.map, HT = CONFIG.education.hightech, rng = state.rng;
  const ht = map.hasFlag(i, FLAG.HIGHTECH);
  if (!ht && map.eduNearby[i] >= HT.minShare && map.skilledNearby[i] >= HT.minSkilled && rng() < HT.chance) {
    map.setFlag(i, FLAG.HIGHTECH, true);
    map.variant[i] = (rng() * 256) | 0;
    map.version++;
    if (!state.milestones.includes('hightech')) {
      state.milestones.push('hightech');
      const x = i % map.width, y = (i / map.width) | 0;
      state.events.push({ text: 'Your first high-tech industry! Educated workers attract clean, well-paid jobs.', kind: 'good', x, y });
    }
  } else if (ht && map.eduNearby[i] < HT.revertShare && rng() < HT.chance) {
    map.setFlag(i, FLAG.HIGHTECH, false);
    map.version++;
  }
}

function runFieldSystems(state) {
  roadSystem(state);
  coverageSystem(state);
  educationFieldSystem(state);
  trafficSystem(state);
  utilitySystem(state);
  pollutionSystem(state);
  garbageSystem(state);
  landValueSystem(state);
  shopperSystem(state);
  safetySystem(state);
  healthSystem(state);
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
  for (const [k, B] of Object.entries(CONFIG.buildings)) {
    if (!B.unlock || p < B.unlock || state.milestones.includes(`unlock:${k}`)) continue;
    state.milestones.push(`unlock:${k}`);
    emit(state, `Unlocked: ${B.label}! Find it in the Landmarks toolbar.`, 'good');
  }
}

// One sample per month for the graphs panel. Old samples are thinned so long games stay small.
export const HISTORY_SERIES = ['pop', 'jobs', 'funds', 'income', 'expenses', 'happiness', 'crime', 'education', 'commute', 'unemployed', 'congested', 'transit', 'tourists'];
function historySystem(state) {
  if (state.tick % CONFIG.time.ticksPerMonth !== 0) return;
  const s = state.stats, tr = state.traffic ?? {}, lm = state.lastMonth;
  const h = state.history ??= emptyHistory();
  h.samples.push({
    y: state.year, m: state.month,
    pop: s.population, jobs: s.jobs, funds: Math.round(state.funds),
    income: lm?.income ?? 0, expenses: lm?.expenses ?? 0,
    happiness: Math.round(state.happiness * 10) / 10, crime: Math.round(state.crime * 10) / 10,
    education: Math.round(state.education * 1000) / 10,
    commute: Math.round((tr.avgCommute ?? 0) * 10) / 10,
    unemployed: Math.max(0, Math.round((tr.workers ?? 0) - (tr.employed ?? 0))),
    congested: tr.congested ?? 0,
    transit: Math.round(tr.transitRiders ?? 0), tourists: state.tourism?.visitors ?? 0,
  });
  const max = CONFIG.history.maxSamples;
  if (h.samples.length > max) {
    // Drop every other sample from the oldest half: recent months stay monthly.
    const half = Math.floor(max / 2);
    h.samples = h.samples.slice(0, half).filter((_, k) => k % 2 === 0).concat(h.samples.slice(half));
  }
}

// Ordered pipeline. Each entry: { name, run(state), every?: ticks }
export const SYSTEMS = [
  { name: 'roads', run: roadSystem },
  { name: 'traffic', run: trafficSystem, every: CONFIG.traffic.everyTicks },
  { name: 'coverage', run: coverageSystem, every: CONFIG.sim.fieldsEveryTicks },
  { name: 'education', run: educationMonthlySystem },
  { name: 'educationField', run: educationFieldSystem, every: CONFIG.sim.fieldsEveryTicks },
  { name: 'utilities', run: utilitySystem, every: CONFIG.utilities.everyTicks },
  { name: 'pollution', run: pollutionSystem, every: CONFIG.sim.fieldsEveryTicks },
  { name: 'garbage', run: garbageSystem, every: CONFIG.sim.fieldsEveryTicks },
  { name: 'landValue', run: landValueSystem, every: CONFIG.sim.fieldsEveryTicks },
  { name: 'shoppers', run: shopperSystem, every: CONFIG.sim.fieldsEveryTicks },
  { name: 'safety', run: safetySystem, every: CONFIG.sim.fieldsEveryTicks },
  { name: 'health', run: healthSystem, every: CONFIG.sim.fieldsEveryTicks },
  { name: 'happiness', run: happinessSystem, every: CONFIG.sim.fieldsEveryTicks },
  { name: 'stats', run: computeStats },
  { name: 'demand', run: demandSystem },
  { name: 'growth', run: growthSystem },
  { name: 'fire', run: fireSystem },
  { name: 'stats2', run: computeStats },
  { name: 'tourism', run: tourismSystem, every: CONFIG.traffic.everyTicks },
  { name: 'milestones', run: milestoneSystem },
  { name: 'economy', run: economySystem },
  { name: 'mayor', run: mayorSystem },
  { name: 'goals', run: goalsSystem },
  { name: 'news', run: newsSystem },
  { name: 'history', run: historySystem },
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
  tourismSystem(state);
}

