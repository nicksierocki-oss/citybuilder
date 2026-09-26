// @ts-check
// Utilities (power, water), public-service coverage and residential happiness.
// Pure simulation — no DOM.

import { CONFIG } from './config.js';
import { TILE, FLAG, KINDS, SUPPLY, TERRAIN, footprintSize, ZONE_KEY, isZone, isHome, isShop, homeCap, jobCap } from './map.js';
import { ordinance } from './cityhall.js';
import { regionInfo } from './region.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// Buildings whose coverage adds land value and happiness (see CONFIG.buildings[k].landValue / .happiness).
export const AMENITY_KINDS = ['school', 'clinic', 'plaza', 'townpark', 'centralpark', 'university', 'stadium', 'statue', 'hospital',
  'museum', 'aquarium', 'zoo', 'amusement', 'opera', 'clocktower', 'arch', 'cathedral', 'skytower', 'pyramid'];

// Funding group of each public building kind (see CONFIG.budgets.groups).
const GROUP_OF = Object.fromEntries(Object.entries(CONFIG.budgets.groups).flatMap(([g, d]) => d.kinds.map((k) => [k, g])));
export function groupOf(kind) { return GROUP_OF[kind] ?? null; }

// Funding level (0.5..1.5) for a building kind; 1 when it has no group.
export function funding(state, kind) {
  const g = GROUP_OF[kind];
  return g ? (state.budgets?.[g] ?? 1) : 1;
}
// How strongly a service works at a funding level: full at 100%, less below, a little more above.
export function fundingStrength(f) {
  return f <= 1 ? f : 1 + (f - 1) * CONFIG.budgets.overSpend;
}

export function kindOf(map, i) {
  return map.type[i] === TILE.SERVICE ? KINDS[map.kind[i]] : null;
}

// Park tiles, including the tiles of park landmarks: they absorb pollution and don't burn.
export function isParkTile(map, i) {
  return map.type[i] === TILE.PARK || (map.type[i] === TILE.SERVICE && !!CONFIG.buildings[KINDS[map.kind[i]]]?.park);
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
    if (k === 'coal' || k === 'wind' || k === 'pump' || k === 'bus' || k === 'parking' || k === 'landfill' || CONFIG.buildings[k]?.park || map.part[i]) return 0;
    return U.serviceUse * (CONFIG.buildings[k]?.size ? 3 : 1); // landmarks use more, counted on their anchor
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

  // Components that reach the map edge can trade with the neighbours.
  const edge = new Uint8Array(ncomp);
  for (let i = 0; i < size; i++) if (comp[i] >= 0 && map.roadDist[i] === 0) edge[comp[i]] = 1;
  const R = CONFIG.region, deals = state.tradeDeals ?? {};
  let capLeft = regionInfo(state).tradeCap;
  const trade = {};

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
    // Trade: buy to cover shortfalls, or sell what's spare, through the edge links.
    const want = new Float64Array(ncomp);
    for (const [, , c, use] of consumers) want[c] += use;
    let imported = 0, exported = 0;
    for (let c = 0; c < ncomp; c++) {
      if (!edge[c] || capLeft <= 0) continue;
      if (deals[`buy_${res}`] && pool[c] < want[c]) {
        const add = Math.min(want[c] - pool[c], capLeft);
        pool[c] += add; imported += add; capLeft -= add;
      } else if (deals[`sell_${res}`] && pool[c] > want[c] * (1 + R.reserve)) {
        const sold = Math.min(pool[c] - want[c] * (1 + R.reserve), capLeft);
        pool[c] -= sold; exported += sold; capLeft -= sold;
      }
    }
    trade[res] = { imported: Math.round(imported), exported: Math.round(exported) };
    const sourced = pool.map((p) => (p > 0 ? 1 : 0));
    for (const [, i, c, use] of consumers) {
      if (out[i] === SUPPLY.OK) continue;                          // a source serves itself
      if (!sourced[c]) { out[i] = SUPPLY.NONE; continue; }          // network has no plant/pump
      if (use === 0) { out[i] = SUPPLY.OK; continue; }              // vacant lot: would be served
      if (pool[c] >= use) { pool[c] -= use; out[i] = SUPPLY.OK; } else { pool[c] = 0; out[i] = SUPPLY.SHORT; }
    }
    summary[res] = { supply: Math.round(supply + imported), demand: Math.round(demand + exported), imported: Math.round(imported), exported: Math.round(exported) };
  }
  state.utilities = summary;
  state.trade = trade;
}

// Coverage of public buildings (linear falloff over their radius, measured from the footprint's edge).
// Buildings with a capacity (`serves`) look after the homes they cover best; one with more
// residents than it serves stretches thin and its coverage is scaled down (see CONFIG.serviceLoad).
// Results per building go to state.serviceLoad, per kind to state.serviceUse.
export function coverageSystem(state) {
  const map = state.map, { width: w, height: h } = map, BU = CONFIG.budgets, SL = CONFIG.serviceLoad;
  const buildings = [];
  for (let i = 0; i < map.size; i++) {
    const k = kindOf(map, i);
    if (!k || !map.coverage[k] || map.part[i]) continue;
    const f = funding(state, k);
    buildings.push({ i, k, f, scale: 1, strength: fundingStrength(f), r: Math.max(1, Math.round(CONFIG.buildings[k].radius * (BU.radiusBase + BU.radiusPer * f))) });
  }
  // Paint every building's reach; `owner` (per capacity kind) remembers which one covers a tile best.
  const owners = {};
  const paint = (b, scale, owner) => {
    const layer = map.coverage[b.k], [fw, fh] = footprintSize(b.k), x0 = b.i % w, y0 = (b.i / w) | 0, r = b.r;
    for (let y = Math.max(0, y0 - r); y <= Math.min(h - 1, y0 + fh - 1 + r); y++) {
      const dy = y < y0 ? y0 - y : y > y0 + fh - 1 ? y - (y0 + fh - 1) : 0;
      for (let x = Math.max(0, x0 - r); x <= Math.min(w - 1, x0 + fw - 1 + r); x++) {
        const dx = x < x0 ? x0 - x : x > x0 + fw - 1 ? x - (x0 + fw - 1) : 0;
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        const v = b.strength * scale * (1 - d / (r + 1)), j = y * w + x;
        if (v > layer[j]) { layer[j] = v; if (owner) owner[j] = b.i; }
      }
    }
  };
  const live = (j) => map.level[j] > 0 && !map.hasFlag(j, FLAG.ABANDONED);
  const residents = (j) => (isHome(map.type[j]) && live(j) ? homeCap(map, j) : 0);
  const jobs = (j) => (live(j) ? jobCap(map, j) : 0);
  for (const k of Object.keys(map.coverage)) map.coverage[k].fill(0);
  for (const b of buildings) {
    if (CONFIG.buildings[b.k].serves && !owners[b.k]) owners[b.k] = new Int32Array(map.size).fill(-1);
    paint(b, 1, owners[b.k]);
  }
  // Load per building: residents of the homes it covers best (police and fire also count the
  // jobs at the businesses they protect).
  const res = new Map(), job = new Map(), use = {};
  const add = (m, b, n) => m.set(b, (m.get(b) ?? 0) + n);
  for (const [k, owner] of Object.entries(owners)) {
    const layer = map.coverage[k], withJobs = !!CONFIG.buildings[k].countsJobs;
    const u = use[k] = { buildings: 0, load: 0, capacity: 0, full: 0, busy: 0, unserved: 0, unservedJobs: 0, residents: 0, jobs: 0, countsJobs: withJobs };
    for (let j = 0; j < map.size; j++) {
      const p = residents(j), n = withJobs ? jobs(j) : 0;
      if (!p && !n) continue;
      if (owner[j] >= 0 && layer[j] > 0.05) { if (p) add(res, owner[j], p); if (n) add(job, owner[j], n); } else { u.unserved += p; u.unservedJobs += n; }
    }
  }
  // Overloaded buildings stretch thin: repaint their kinds with each building's strength scaled.
  state.serviceLoad = {};
  const scaled = new Set();
  for (const b of buildings) {
    const serves = CONFIG.buildings[b.k].serves;
    if (!serves) continue;
    const r = res.get(b.i) ?? 0, jb = job.get(b.i) ?? 0, cap = serves * fundingStrength(b.f), l = r + jb, u = use[b.k];
    b.scale = l > cap ? Math.max(SL.minStrength, cap / l) : 1;
    if (b.scale < 1) scaled.add(b.k);
    state.serviceLoad[b.i] = { kind: b.k, load: Math.round(l), residents: Math.round(r), jobs: Math.round(jb), capacity: Math.round(cap), share: cap > 0 ? l / cap : 0 };
    u.buildings++; u.load += l; u.capacity += cap; u.residents += r; u.jobs += jb;
    if (l > cap) u.full++; else if (l > cap * SL.busy) u.busy++;
  }
  for (const k of scaled) {
    map.coverage[k].fill(0);
    for (const b of buildings) if (b.k === k) paint(b, b.scale, null);
  }
  for (const u of Object.values(use)) for (const f of ['load', 'capacity', 'unserved', 'unservedJobs', 'residents', 'jobs']) u[f] = Math.round(u[f]);
  state.serviceUse = use;
}

// ---------------------------------------------------------------- education

// Skilled share a neighbourhood's residents are heading toward.
export function educationTarget(map, i) {
  const E = CONFIG.education, c = map.coverage;
  return Math.min(E.max, E.base + c.school[i] * E.school + c.university[i] * E.university);
}

// Monthly: each home's education drifts toward its target. Vacant lots take the target at once
// (new arrivals are as educated as the area).
export function educationMonthlySystem(state) {
  if (state.tick % CONFIG.time.ticksPerMonth !== 0) return;
  const map = state.map, rate = CONFIG.education.ratePerMonth;
  for (let i = 0; i < map.size; i++) {
    if (!isHome(map.type[i])) continue;
    const target = educationTarget(map, i) * 255, cur = map.education[i];
    if (map.level[i] === 0) { map.education[i] = Math.round(target); continue; }
    const diff = target - cur;
    if (Math.abs(diff) < 0.5) continue;
    const step = Math.sign(diff) * Math.max(1, Math.abs(diff) * rate);
    map.education[i] = Math.max(0, Math.min(255, Math.round(cur + (Math.abs(step) > Math.abs(diff) ? diff : step))));
  }
}

// Skilled residents (and their share) within the high-tech radius of every tile (summed-area table).
// Also seeds education on maps that don't have it yet (new cities, older saves).
export function educationFieldSystem(state) {
  const map = state.map, { width: w, height: h } = map, cap = CONFIG.capacity.residential;
  if (!map.educationReady) {
    for (let i = 0; i < map.size; i++) if (isHome(map.type[i])) map.education[i] = Math.round(educationTarget(map, i) * 255);
    map.educationReady = true;
  }
  const r = CONFIG.education.hightech.radius, W = w + 1;
  const pop = new Float64Array(W * (h + 1)), sk = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rp = 0, rs = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (isHome(map.type[i]) && map.level[i] > 0 && !map.hasFlag(i, FLAG.ABANDONED)) {
        const p = homeCap(map, i);
        rp += p; rs += p * map.education[i] / 255;
      }
      pop[(y + 1) * W + x + 1] = pop[y * W + x + 1] + rp;
      sk[(y + 1) * W + x + 1] = sk[y * W + x + 1] + rs;
    }
  }
  const box = (a, x0, y0, x1, y1) => a[y1 * W + x1] - a[y0 * W + x1] - a[y1 * W + x0] + a[y0 * W + x0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1);
    const p = box(pop, x0, y0, x1, y1), s = box(sk, x0, y0, x1, y1), i = y * w + x;
    map.skilledNearby[i] = s;
    map.eduNearby[i] = p > 0 ? s / p : 0;
  }
}

export function utilitiesEnforced(state) {
  return !(state.utilityGrace > 0);
}

// Happiness (0..100) for every land tile; it matters for homes.
export function happinessSystem(state) {
  const map = state.map, H = CONFIG.happiness, B = CONFIG.buildings, T = CONFIG.traffic;
  const enforce = utilitiesEnforced(state);
  const carFree = ordinance(state, 'carFree') ? CONFIG.ordinances.carFree.happiness : 0;
  let sum = 0, weight = 0;
  for (let i = 0; i < map.size; i++) {
    if (map.terrain[i] === TERRAIN.WATER) { map.happiness[i] = 0; continue; }
    const c = map.coverage;
    let v = H.base
      + Math.max(c.bus[i] * B.bus.happiness, c.metro[i] * B.metro.happiness, c.railstation[i] * B.railstation.happiness)
      + (map.landValue[i] - 40) * H.landValueWeight
      - map.pollution[i] * H.pollutionWeight;
    for (const k of AMENITY_KINDS) v += c[k][i] * B[k].happiness;
    v += carFree + (map.health[i] - 50) * CONFIG.health.happinessWeight - map.trash[i] * CONFIG.garbage.happinessWeight;
    v -= map.crime[i] * CONFIG.crime.happinessWeight;
    if (map.hasFlag(i, FLAG.FIRE)) v -= 30;
    if (isHome(map.type[i])) {
      const cm = map.commute[i];
      if (Number.isFinite(cm) && cm > T.comfortCommute) v -= (cm - T.comfortCommute) * H.commuteWeight;
      if (map.level[i] > 0 && enforce) {
        if (map.power[i] !== SUPPLY.OK) v -= H.noPower;
        if (map.water[i] !== SUPPLY.OK) v -= H.noWater;
      }
    }
    v = Math.max(0, Math.min(100, v));
    map.happiness[i] = v;
    if (isHome(map.type[i]) && map.level[i] > 0 && !map.hasFlag(i, FLAG.ABANDONED)) {
      const pop = homeCap(map, i);
      sum += v * pop; weight += pop;
    }
  }
  state.happiness = weight > 0 ? sum / weight : 0;
}

// ---------------------------------------------------------------- health & garbage

// Health (0..100): clinics and hospitals raise it; pollution and uncollected trash lower it.
export function healthSystem(state) {
  const map = state.map, H = CONFIG.health, c = map.coverage, cap = CONFIG.capacity.residential;
  let sum = 0, w = 0;
  for (let i = 0; i < map.size; i++) {
    if (map.terrain[i] === TERRAIN.WATER) { map.health[i] = 0; continue; }
    const v = H.base + Math.min(1, c.clinic[i]) * H.clinic + Math.min(1.2, c.hospital[i]) * H.hospital
      - map.pollution[i] * H.pollutionWeight - map.trash[i] * H.trashWeight;
    map.health[i] = Math.max(0, Math.min(100, v));
    if (isHome(map.type[i]) && map.level[i] > 0 && !map.hasFlag(i, FLAG.ABANDONED)) { const p = homeCap(map, i); sum += map.health[i] * p; w += p; }
  }
  state.health = w ? sum / w : 0;
}

// Trash made by tile i each month.
export function trashOf(map, i) {
  const t = map.type[i], G = CONFIG.garbage, C = CONFIG.capacity;
  if (!map.level[i] || map.hasFlag(i, FLAG.ABANDONED)) return 0;
  if (!isZone(t)) return 0;
  return homeCap(map, i) * G.perResident + jobCap(map, i) * G.perJob * (t === TILE.FARM ? 0.5 : 1);
}

// Garbage: buildings covered by a landfill or recycling centre get collected, as far as the
// city's collection capacity stretches. Everyone else's trash piles up (it builds up and clears
// gradually). Small towns cope on their own; the effect grows with the city.
export function garbageSystem(state) {
  const map = state.map, G = CONFIG.garbage, B = CONFIG.buildings, pop = state.stats?.population ?? 0;
  let capacity = 0;
  for (let i = 0; i < map.size; i++) {
    const k = kindOf(map, i);
    if (k && B[k].garbage && !map.part[i]) capacity += B[k].garbage * fundingStrength(funding(state, k));
  }
  let made = 0, covered = 0;
  for (let i = 0; i < map.size; i++) {
    const g = trashOf(map, i);
    if (!g) continue;
    made += g;
    if (map.coverage.landfill[i] > 0.02 || map.coverage.recycling[i] > 0.02) covered += g;
  }
  const rate = covered > 0 ? Math.min(1, capacity / covered) : 0;
  const severity = state.garbageGrace > 0 ? 0 : Math.max(0, Math.min(1, (pop - G.startPop) / (G.fullPop - G.startPop)));
  let piled = 0;
  for (let i = 0; i < map.size; i++) {
    const g = trashOf(map, i);
    let target = 0;
    if (g) {
      const served = map.coverage.landfill[i] > 0.02 || map.coverage.recycling[i] > 0.02 ? rate : 0;
      target = (1 - served) * G.maxLevel * severity;
      if (target > 1) piled += g * (1 - served);
    }
    map.trash[i] += (target - map.trash[i]) * G.settle;
    if (map.trash[i] < 0.05) map.trash[i] = 0;
  }
  state.garbage = { made: Math.round(made), capacity: Math.round(capacity), uncollected: Math.round(piled) };
}

// Human-readable reasons a home is unhappy (for the tile info panel).
export function happinessReasons(state, i) {
  const map = state.map, out = [];
  if (map.coverage.school[i] < 0.05) out.push('no school nearby');
  if (map.coverage.clinic[i] < 0.05) out.push('no clinic nearby');
  if (map.pollution[i] > 20) out.push('pollution');
  if (map.crime[i] > 25) out.push(map.coverage.police[i] < 0.05 ? 'crime (no police nearby)' : 'crime');
  if (map.landValue[i] < 30) out.push('low land value');
  if (map.trash[i] > 20) out.push('uncollected garbage');
  if (map.health[i] < 35) out.push('poor health care');
  if (utilitiesEnforced(state) && map.level[i] > 0) {
    if (map.power[i] !== SUPPLY.OK) out.push('no power');
    if (map.water[i] !== SUPPLY.OK) out.push('no water');
  }
  return out;
}

// ---------------------------------------------------------------- safety

function isBuilding(map, i) {
  const t = map.type[i];
  return (isZone(t) && map.level[i] > 0) || (t === TILE.SERVICE && !isParkTile(map, i));
}

// Crime and fire risk for every building (0..100).
export function safetySystem(state) {
  const map = state.map, C = CONFIG.crime, F = CONFIG.fire, { width: w, height: h } = map;
  let crimeSum = 0, crimeW = 0;
  const watch = ordinance(state, 'watch') ? 1 - CONFIG.ordinances.watch.crimeCut : 1;
  const smoke = ordinance(state, 'smoke') ? 1 - CONFIG.ordinances.smoke.fireCut : 1;
  for (let i = 0; i < map.size; i++) {
    map.crime[i] = 0;
    map.fireRisk[i] = 0;
    if (!isBuilding(map, i)) continue;
    const t = map.type[i], lv = map.level[i], k = kindOf(map, i);
    // Crime: zones only (public buildings are staffed).
    if (t !== TILE.SERVICE && !map.hasFlag(i, FLAG.ABANDONED)) {
      let c = lv * C.perLevel * (t === TILE.FARM ? 0.3 : 1) + (isShop(t) || t === TILE.OFFICE ? C.commercialExtra : 0)
        + Math.max(0, 45 - map.landValue[i]) * C.lowLandValue;
      if (isHome(t)) c += (1 - map.employed[i]) * C.unemployment;
      const x0 = i % w, y0 = (i / w) | 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = x0 + dx, y = y0 + dy;
        if (x >= 0 && y >= 0 && x < w && y < h && map.hasFlag(y * w + x, FLAG.ABANDONED)) c += C.abandonedNearby;
      }
      c *= (1 - C.policeCut * map.coverage.police[i]) * watch;
      map.crime[i] = Math.max(0, Math.min(100, c));
      if (isHome(t)) { const pop = homeCap(map, i); crimeSum += map.crime[i] * pop; crimeW += pop; }
    }
    // Fire risk: every building; industry and coal plants most.
    let r = k === 'coal' ? F.coalPlantRisk : t === TILE.SERVICE ? F.riskPerLevel : lv * F.riskPerLevel * (t === TILE.FARM ? 0.5 : 1) + (t === TILE.IND ? F.industryExtra : 0);
    r *= (1 - F.stationCut * map.coverage.fire[i]) * smoke;
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
      if (map.type[i] === TILE.SERVICE) {
        // A landmark burns down as a whole.
        for (const j of map.footprintTiles(i)) {
          map.type[j] = TILE.EMPTY; map.kind[j] = 0; map.part[j] = 0;
          map.setFlag(j, FLAG.FIRE, false); map.burn[j] = 0;
        }
      } else { map.level[i] = 0; map.setFlag(i, FLAG.ABANDONED, false); }
      map.version++;
      state.burnedDown = (state.burnedDown ?? 0) + 1;
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

// ---------------------------------------------------------------- service load advice

// Kinds that have a capacity, in display order.
export const LOAD_KINDS = ['school', 'university', 'clinic', 'hospital', 'police', 'fire'];
const PLURALS = { school: 'schools', university: 'universities', clinic: 'clinics', hospital: 'hospitals', police: 'police stations', fire: 'fire stations' };

// Plain-language status of one building's load: { share, word, cls }.
export function loadStatus(entry) {
  const share = entry?.share ?? 0;
  return share > 1 ? { share, word: 'over capacity', cls: 'none' } : share > CONFIG.serviceLoad.busy ? { share, word: 'nearly full', cls: 'short' } : { share, word: share < 0.05 ? 'idle' : 'has room', cls: 'ok' };
}

// Advisor lines about services: which are full, and how many residents no building reaches.
export function serviceAdvice(state) {
  const out = [], use = state.serviceUse ?? {}, pop = state.stats?.population ?? 0;
  const plural = (k, n) => (n === 1 ? CONFIG.buildings[k].label.toLowerCase() : PLURALS[k]);
  for (const k of LOAD_KINDS) {
    const u = use[k];
    if (!u || !u.buildings) continue;
    if (u.full) out.push(`${u.full} of ${u.buildings} ${plural(k, u.buildings)} ${u.full === 1 ? 'is' : 'are'} over capacity (${u.load.toLocaleString()} ${CONFIG.buildings[k].countsJobs ? 'residents and jobs' : 'residents'} for room for ${u.capacity.toLocaleString()}): they work at reduced strength. Build another ${CONFIG.buildings[k].label.toLowerCase()} near the busiest one, or raise its funding.`);
    if (u.unserved >= Math.max(150, pop * 0.1)) out.push(`${u.unserved.toLocaleString()} residents live out of reach of any ${CONFIG.buildings[k].label.toLowerCase()}. The existing ones ${u.full ? 'are full too' : `still have room (${Math.round(u.load / Math.max(1, u.capacity) * 100)}% used)`}, so the fix is a new one where those homes are (City hall → Services).`);
  }
  return out;
}
