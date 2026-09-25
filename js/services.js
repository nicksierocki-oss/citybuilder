// @ts-check
// Utilities (power, water), public-service coverage and residential happiness.
// Pure simulation — no DOM.

import { CONFIG } from './config.js';
import { TILE, FLAG, KINDS, SUPPLY, TERRAIN } from './map.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ZONE_KEY = { [TILE.RES]: 'residential', [TILE.COM]: 'commercial', [TILE.IND]: 'industrial' };

export function kindOf(map, i) {
  return map.type[i] === TILE.SERVICE ? KINDS[map.kind[i]] : null;
}

// How much a source tile produces of a resource ('power' | 'water').
export function supplyOf(map, i, res) {
  const k = kindOf(map, i);
  if (!k) return 0;
  const B = CONFIG.buildings[k];
  if (res === 'power') return B.power ?? 0;
  if (k !== 'pump') return 0;
  return map.waterDist[i] <= B.nearWaterRange ? B.water : B.dryWater;
}

// Units a tile consumes (developed zones and public buildings).
export function useOf(map, i, res) {
  const U = CONFIG.utilities, t = map.type[i];
  if (t === TILE.SERVICE) {
    const k = kindOf(map, i);
    if (k === 'coal' || k === 'wind' || k === 'pump' || k === 'bus') return 0;
    return U.serviceUse;
  }
  const key = ZONE_KEY[t];
  if (!key || map.level[i] === 0 || map.hasFlag(i, FLAG.ABANDONED)) return 0;
  return (res === 'power' ? U.powerUse : U.waterUse)[key][map.level[i]];
}

// Power and water flow through connected road networks. Each network pools the output of the
// plants/pumps beside it and serves consumers nearest to a source first. A network with no
// source leaves its buildings unserved; one that runs short leaves the farthest ones short.
export function utilitySystem(state) {
  const map = state.map, { width: w, height: h, size } = map;
  const nbrs = (i) => {
    const x = i % w, y = (i / w) | 0, out = [];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) out.push(ny * w + nx);
    }
    return out;
  };
  // Label road components once; both resources share them.
  const comp = new Int32Array(size).fill(-1);
  let ncomp = 0;
  for (let i = 0; i < size; i++) {
    if (map.type[i] !== TILE.ROAD || comp[i] >= 0) continue;
    const q = [i]; comp[i] = ncomp;
    for (let head = 0; head < q.length; head++) {
      for (const j of nbrs(q[head])) if (map.type[j] === TILE.ROAD && comp[j] < 0) { comp[j] = ncomp; q.push(j); }
    }
    ncomp++;
  }

  const summary = {};
  for (const res of ['power', 'water']) {
    const out = map[res];
    out.fill(SUPPLY.NONE);
    const pool = new Float64Array(ncomp);
    const dist = new Int32Array(size).fill(-1);
    const q = [];
    let supply = 0, demand = 0;
    for (let i = 0; i < size; i++) {
      const s = supplyOf(map, i, res);
      if (s <= 0) continue;
      let c = -1;
      for (const j of nbrs(i)) if (map.type[j] === TILE.ROAD) { c = comp[j]; if (dist[j] < 0) { dist[j] = 0; q.push(j); } }
      if (c >= 0) { pool[c] += s; supply += s; out[i] = SUPPLY.OK; } // only plants beside a road count
    }
    for (let head = 0; head < q.length; head++) {
      const u = q[head];
      for (const v of nbrs(u)) if (map.type[v] === TILE.ROAD && dist[v] < 0) { dist[v] = dist[u] + 1; q.push(v); }
    }
    // Consumers, nearest to a source first.
    const consumers = [];
    for (let i = 0; i < size; i++) {
      const t = map.type[i];
      if (t === TILE.ROAD || t === TILE.EMPTY || t === TILE.PARK) continue;
      let best = -1, c = -1;
      for (const j of nbrs(i)) {
        if (map.type[j] !== TILE.ROAD) continue;
        if (c < 0) c = comp[j];
        if (dist[j] >= 0 && (best < 0 || dist[j] < best)) { best = dist[j]; c = comp[j]; }
      }
      if (c < 0) continue;
      const use = useOf(map, i, res);
      demand += use;
      consumers.push([best < 0 ? 1e9 : best, i, c, use]);
    }
    consumers.sort((a, b) => a[0] - b[0]);
    const sourced = pool.map((p) => (p > 0 ? 1 : 0));
    for (const [, i, c, use] of consumers) {
      if (out[i] === SUPPLY.OK) continue;                          // a source serves itself
      if (!sourced[c]) { out[i] = SUPPLY.NONE; continue; }          // network has no plant/pump
      if (use === 0) { out[i] = SUPPLY.OK; continue; }              // vacant lot: would be served
      if (pool[c] >= use) { pool[c] -= use; out[i] = SUPPLY.OK; } else { pool[c] = 0; out[i] = SUPPLY.SHORT; }
    }
    summary[res] = { supply: Math.round(supply), demand: Math.round(demand) };
  }
  state.utilities = summary;
}

// Coverage of schools, clinics, plazas and recycling centres (linear falloff over their radius).
export function coverageSystem(state) {
  const map = state.map, { width: w, height: h } = map;
  for (const k of Object.keys(map.coverage)) map.coverage[k].fill(0);
  for (let i = 0; i < map.size; i++) {
    const k = kindOf(map, i);
    if (!k || !map.coverage[k]) continue;
    const r = CONFIG.buildings[k].radius, layer = map.coverage[k];
    const x0 = i % w, y0 = (i / w) | 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      const v = 1 - d / (r + 1), j = y * w + x;
      if (v > layer[j]) layer[j] = v;
    }
  }
}

export function utilitiesEnforced(state) {
  return !(state.utilityGrace > 0);
}

// Happiness (0..100) for every land tile; it matters for homes.
export function happinessSystem(state) {
  const map = state.map, H = CONFIG.happiness, B = CONFIG.buildings, T = CONFIG.traffic;
  const enforce = utilitiesEnforced(state);
  let sum = 0, weight = 0;
  for (let i = 0; i < map.size; i++) {
    if (map.terrain[i] === TERRAIN.WATER) { map.happiness[i] = 0; continue; }
    const c = map.coverage;
    let v = H.base
      + c.school[i] * B.school.happiness + c.clinic[i] * B.clinic.happiness + c.plaza[i] * B.plaza.happiness
      + Math.max(c.bus[i] * B.bus.happiness, c.metro[i] * B.metro.happiness)
      + (map.landValue[i] - 40) * H.landValueWeight
      - map.pollution[i] * H.pollutionWeight;
    v -= map.crime[i] * CONFIG.crime.happinessWeight;
    if (map.hasFlag(i, FLAG.FIRE)) v -= 30;
    if (map.type[i] === TILE.RES) {
      const cm = map.commute[i];
      if (Number.isFinite(cm) && cm > T.comfortCommute) v -= (cm - T.comfortCommute) * H.commuteWeight;
      if (map.level[i] > 0 && enforce) {
        if (map.power[i] !== SUPPLY.OK) v -= H.noPower;
        if (map.water[i] !== SUPPLY.OK) v -= H.noWater;
      }
    }
    v = Math.max(0, Math.min(100, v));
    map.happiness[i] = v;
    if (map.type[i] === TILE.RES && map.level[i] > 0 && !map.hasFlag(i, FLAG.ABANDONED)) {
      const pop = CONFIG.capacity.residential[map.level[i]];
      sum += v * pop; weight += pop;
    }
  }
  state.happiness = weight > 0 ? sum / weight : 0;
}

// Human-readable reasons a home is unhappy (for the tile info panel).
export function happinessReasons(state, i) {
  const map = state.map, out = [];
  if (map.coverage.school[i] < 0.05) out.push('no school nearby');
  if (map.coverage.clinic[i] < 0.05) out.push('no clinic nearby');
  if (map.pollution[i] > 20) out.push('pollution');
  if (map.crime[i] > 25) out.push(map.coverage.police[i] < 0.05 ? 'crime (no police nearby)' : 'crime');
  if (map.landValue[i] < 30) out.push('low land value');
  if (utilitiesEnforced(state) && map.level[i] > 0) {
    if (map.power[i] !== SUPPLY.OK) out.push('no power');
    if (map.water[i] !== SUPPLY.OK) out.push('no water');
  }
  return out;
}

// ---------------------------------------------------------------- safety

function isBuilding(map, i) {
  const t = map.type[i];
  return ((t === TILE.RES || t === TILE.COM || t === TILE.IND) && map.level[i] > 0) || t === TILE.SERVICE;
}

// Crime and fire risk for every building (0..100).
export function safetySystem(state) {
  const map = state.map, C = CONFIG.crime, F = CONFIG.fire, { width: w, height: h } = map;
  let crimeSum = 0, crimeW = 0;
  for (let i = 0; i < map.size; i++) {
    map.crime[i] = 0;
    map.fireRisk[i] = 0;
    if (!isBuilding(map, i)) continue;
    const t = map.type[i], lv = map.level[i], k = kindOf(map, i);
    // Crime: zones only (public buildings are staffed).
    if (t !== TILE.SERVICE && !map.hasFlag(i, FLAG.ABANDONED)) {
      let c = lv * C.perLevel + (t === TILE.COM ? C.commercialExtra : 0)
        + Math.max(0, 45 - map.landValue[i]) * C.lowLandValue;
      if (t === TILE.RES) c += (1 - map.employed[i]) * C.unemployment;
      const x0 = i % w, y0 = (i / w) | 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = x0 + dx, y = y0 + dy;
        if (x >= 0 && y >= 0 && x < w && y < h && map.hasFlag(y * w + x, FLAG.ABANDONED)) c += C.abandonedNearby;
      }
      c *= 1 - C.policeCut * map.coverage.police[i];
      map.crime[i] = Math.max(0, Math.min(100, c));
      if (t === TILE.RES) { const pop = CONFIG.capacity.residential[lv]; crimeSum += map.crime[i] * pop; crimeW += pop; }
    }
    // Fire risk: every building; industry and coal plants most.
    let r = k === 'coal' ? F.coalPlantRisk : t === TILE.SERVICE ? F.riskPerLevel : lv * F.riskPerLevel + (t === TILE.IND ? F.industryExtra : 0);
    r *= 1 - F.stationCut * map.coverage.fire[i];
    map.fireRisk[i] = Math.max(0, Math.min(100, r));
  }
  state.crime = crimeW > 0 ? crimeSum / crimeW : 0;
}

// Fires: ignite by risk (checked monthly), spread to neighbours, get put out near a fire
// station, or destroy the building (it becomes a vacant lot) if left burning too long.
export function fireSystem(state) {
  const map = state.map, F = CONFIG.fire, { width: w, height: h } = map, rng = state.rng;
  const TPM = CONFIG.time.ticksPerMonth, burnTicks = F.burnMonths * TPM;
  let active = 0;
  const ignite = [];
  for (let i = 0; i < map.size; i++) {
    if (!map.hasFlag(i, FLAG.FIRE)) continue;
    if (!isBuilding(map, i)) { map.setFlag(i, FLAG.FIRE, false); map.burn[i] = 0; continue; }
    active++;
    map.burn[i]++;
    const cover = map.coverage.fire[i];
    const putOut = cover > 0.05 ? F.extinguishChance * Math.min(1, cover * 1.5) : F.burnOutChance;
    if (rng() < putOut) {
      map.setFlag(i, FLAG.FIRE, false);
      map.burn[i] = 0;
      continue;
    }
    // Spread to adjacent buildings (fire crews nearby halve the chance).
    const x0 = i % w, y0 = (i / w) | 0;
    for (const [dx, dy] of DIRS) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const j = y * w + x;
      if (isBuilding(map, j) && !map.hasFlag(j, FLAG.FIRE) && rng() < F.spreadChance * (cover > 0.05 ? 0.5 : 1)) ignite.push(j);
    }
    if (map.burn[i] >= burnTicks) {
      // Burned down: the zone stays, the building is gone.
      map.setFlag(i, FLAG.FIRE, false);
      map.burn[i] = 0;
      if (map.type[i] === TILE.SERVICE) { map.type[i] = TILE.EMPTY; map.kind[i] = 0; }
      else { map.level[i] = 0; map.setFlag(i, FLAG.ABANDONED, false); }
      map.version++;
      state.events.push({ text: `A building burned down at ${x0}, ${y0}. A fire station would have saved it.`, kind: 'bad', x: x0, y: y0 });
    }
  }
  for (const j of ignite) { map.setFlag(j, FLAG.FIRE, true); map.burn[j] = 0; }
  // New fires, rolled once a month.
  if (F.enabled && state.tick % TPM === 0) {
    for (let i = 0; i < map.size; i++) {
      if (map.fireRisk[i] <= 0 || map.hasFlag(i, FLAG.FIRE)) continue;
      if (rng() < (map.fireRisk[i] / 100) * F.igniteChance) {
        map.setFlag(i, FLAG.FIRE, true);
        map.burn[i] = 0;
        map.version++;
        const x = i % w, y = (i / w) | 0;
        state.events.push({ text: `Fire at ${x}, ${y}! Click to look.`, kind: 'bad', x, y });
      }
    }
  }
  state.fires = active + ignite.length;
}
