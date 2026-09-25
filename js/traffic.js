// Traffic & commuting: workers travel from homes to jobs over the road network,
// industry sends freight to the highway, and the resulting volumes congest roads.
// Pure simulation — no DOM.

import { CONFIG } from './config.js';
import { TILE, FLAG, KINDS, JUNCTION, skilledShare } from './map.js';
import { ordinance } from './cityhall.js';

// Minimal binary min-heap of (node, priority).
class Heap {
  constructor() { this.n = []; this.p = []; }
  get size() { return this.n.length; }
  clear() { this.n.length = 0; this.p.length = 0; }
  push(node, pri) {
    const n = this.n, p = this.p;
    let i = n.length;
    n.push(node); p.push(pri);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (p[up] <= pri) break;
      n[i] = n[up]; p[i] = p[up]; i = up;
    }
    n[i] = node; p[i] = pri;
  }
  pop() {
    const n = this.n, p = this.p, top = n[0], topP = p[0];
    const lastN = n.pop(), lastP = p.pop();
    if (n.length) {
      let i = 0;
      const len = n.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= len) break;
        if (c + 1 < len && p[c + 1] < p[c]) c++;
        if (p[c] >= lastP) break;
        n[i] = n[c]; p[i] = p[c]; i = c;
      }
      n[i] = lastN; p[i] = lastP;
    }
    this.lastPri = topP;
    return top;
  }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Travel minutes through one road tile given its current volume, including any junction delay.
export function roadTime(map, i) {
  const T = CONFIG.traffic, c = map.roadClass[i];
  const load = map.traffic[i] / T.capacity[c];
  return T.minutesPerTile[c] * Math.min(T.maxCongestion, 1 + T.congestionK * load * load) + junctionDelay(map, i, load);
}

// Extra minutes spent crossing a junction tile (0 on plain road).
export function junctionDelay(map, i, load = map.traffic[i] / CONFIG.traffic.capacity[map.roadClass[i]]) {
  const J = CONFIG.traffic.junction, kind = map.junctionKind(i);
  if (kind === JUNCTION.NONE) return 0;
  const lights = map.hasFlag(i, FLAG.LIGHTS);
  const [base, k] = kind === JUNCTION.MERGE ? J.merge
    : kind === JUNCTION.INTERSECTION ? (lights ? J.lights : J.plain)
    : map.hasFlag(i, FLAG.INTERCHANGE) ? J.interchange
    : lights ? J.highwayLights : J.highwayAtGrade;
  return base * (1 + k * Math.min(4, load * load));
}

export function roadLoad(map, i) {
  return map.traffic[i] / CONFIG.traffic.capacity[map.roadClass[i]];
}

export function trafficSystem(state) {
  const map = state.map, T = CONFIG.traffic, CAP = CONFIG.capacity, D = CONFIG.demand;
  const { width: w, height: h, size } = map;

  // --- graph: connected road tiles, their neighbours and travel times
  const isNode = new Uint8Array(size);
  const time = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    if (map.type[i] === TILE.ROAD && map.roadDist[i] >= 0) { isNode[i] = 1; time[i] = roadTime(map, i); }
  }
  const nbrs = (i, out) => {
    out.length = 0;
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      out.push(ny * w + nx);
    }
    return out;
  };
  const tmp = [];
  // Roads a building can drive onto (highways are limited-access).
  const accessRoads = (i) => nbrs(i, []).filter((j) => isNode[j] && map.roadClass[j] !== 2);

  // --- job sinks: open positions per job tile (unskilled in `remaining`, skilled in `remainingS`),
  // listed on each adjacent road. Skilled workers can take any job; unskilled ones only unskilled jobs.
  const remaining = new Float32Array(size), remainingS = new Float32Array(size), skilledPosts = new Float32Array(size);
  let openS = 0, openU = 0; // open posts city-wide, so searches can stop when nothing is left to find
  const jobsAt = new Map(); // road index -> [job tile indices]
  for (let i = 0; i < size; i++) {
    const t = map.type[i];
    if ((t !== TILE.COM && t !== TILE.IND) || map.level[i] === 0 || map.hasFlag(i, FLAG.ABANDONED) || map.hasFlag(i, FLAG.FIRE)) continue;
    const posts = (t === TILE.COM ? CAP.commercial : CAP.industrial)[map.level[i]];
    skilledPosts[i] = remainingS[i] = posts * skilledShare(map, i);
    remaining[i] = posts - remainingS[i];
    openS += remainingS[i]; openU += remaining[i];
    for (const r of accessRoads(i)) {
      if (!jobsAt.has(r)) jobsAt.set(r, []);
      jobsAt.get(r).push(i);
    }
  }
  let external = D.externalJobs; // jobs in neighbouring towns, reached via any edge road
  const isEdge = (i) => map.roadDist[i] === 0;

  const volume = new Float32Array(size);
  const dist = new Float64Array(size);
  const stamp = new Int32Array(size); // dist[i] is valid only when stamp[i] === run (avoids clearing per home)
  let run = 0;
  const parent = new Int32Array(size);
  const heap = new Heap();

  // --- nearest-job access time for every road (multi-source, ignores job capacity).
  // Used for vacant homes so they know whether jobs are within reach.
  const access = new Float64Array(size).fill(Infinity);
  heap.clear();
  for (let i = 0; i < size; i++) {
    if (!isNode[i]) continue;
    if (jobsAt.has(i) || (isEdge(i) && external > 0)) { access[i] = time[i]; heap.push(i, time[i]); }
  }
  while (heap.size) {
    const u = heap.pop();
    if (heap.lastPri > access[u]) continue;
    for (const v of nbrs(u, tmp)) {
      if (!isNode[v]) continue;
      const nd = access[u] + time[v];
      if (nd < access[v] && nd <= T.maxCommute) { access[v] = nd; heap.push(v, nd); }
    }
  }

  // --- commuting: each home (random order) fills the nearest open jobs
  const homes = [];
  for (let i = 0; i < size; i++) {
    if (map.type[i] !== TILE.RES) continue;
    map.employed[i] = 1;
    const roads = accessRoads(i);
    let best = Infinity;
    for (const r of roads) best = Math.min(best, access[r]);
    map.commute[i] = best;
    if (map.level[i] > 0 && !map.hasFlag(i, FLAG.ABANDONED) && !map.hasFlag(i, FLAG.FIRE) && roads.length) homes.push(i);
  }
  const rng = state.rng;
  for (let k = homes.length - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    [homes[k], homes[j]] = [homes[j], homes[k]];
  }

  // --- transit: stops with their walk-in catchments and the jobs around them
  const B = CONFIG.buildings;
  const stations = [];
  map.riders.fill(0);
  for (let i = 0; i < size; i++) {
    if (map.type[i] !== TILE.SERVICE) continue;
    const k = KINDS[map.kind[i]];
    if ((k !== 'bus' && k !== 'metro') || !accessRoads(i).length) continue;
    const r = B[k].radius, x0 = i % w, y0 = (i / w) | 0, jobs = [];
    for (let y = Math.max(0, y0 - r); y <= Math.min(h - 1, y0 + r); y++) {
      for (let x = Math.max(0, x0 - r); x <= Math.min(w - 1, x0 + r); x++) {
        const j = y * w + x;
        if (remaining[j] + remainingS[j] > 0) jobs.push(j);
      }
    }
    stations.push({ i, k, x: x0, y: y0, jobs, left: B[k].capacity });
  }
  const nearStations = (home) => {
    const x = home % w, y = (home / w) | 0;
    return stations.filter((s) => Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) <= B[s.k].radius && s.left > 0);
  };
  let transitRiders = 0;
  const shareMult = ordinance(state, 'freeTransit') ? CONFIG.ordinances.freeTransit.shareMult : 1;

  let totalWorkers = 0, totalEmployed = 0, totalMinutes = 0;
  let leftS = 0, leftU = 0; // this home's skilled / unskilled workers still looking
  // Fill up to `max` positions at job tile j: skilled posts with skilled workers first, then
  // unskilled posts with unskilled workers, then any spare unskilled posts with skilled workers.
  const hire = (j, max) => {
    let took = 0, a;
    a = Math.min(leftS, remainingS[j], max - took); remainingS[j] -= a; leftS -= a; took += a; openS -= a;
    a = Math.min(leftU, remaining[j], max - took); remaining[j] -= a; leftU -= a; took += a; openU -= a;
    a = Math.min(leftS, remaining[j], max - took); remaining[j] -= a; leftS -= a; took += a; openU -= a;
    return took;
  };
  // Nothing left anywhere that this home's remaining workers could take?
  const hopeless = () => external <= 1e-6
    && (leftU <= 1e-6 || openU <= 1e-6) && (leftS <= 1e-6 || openU + openS <= 1e-6);
  for (const home of homes) {
    const workers = CAP.residential[map.level[home]] * D.workforceRatio;
    leftS = workers * map.education[home] / 255;
    leftU = workers - leftS;
    let left = workers, minutes = 0;
    // Some workers near a stop ride transit to jobs near another stop on the same mode
    // (buses and metro form separate networks). Riders never touch the roads.
    if (stations.length) {
      for (const from of nearStations(home).sort((a, b) => B[b.k].share - B[a.k].share)) {
        let want = Math.min(left, workers * Math.min(0.95, B[from.k].share * shareMult), from.left);
        if (want <= 0) continue;
        const dests = stations.filter((s) => s.k === from.k && s.left > 0)
          .sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
        for (const to of dests) {
          if (want <= 0) break;
          const ride = T.walkMinutes * 2 + B[to.k].wait + Math.hypot(to.x - from.x, to.y - from.y) * B[to.k].minutesPerTile;
          if (ride > T.maxCommute) break;
          for (const j of to.jobs) {
            if (want <= 0 || to.left <= 0) break;
            const take = hire(j, Math.min(want, to.left, from.left));
            if (take <= 0) continue;
            want -= take; left -= take;
            from.left -= take; if (to !== from) to.left -= take;
            map.riders[from.i] += take; map.riders[to.i] += take;
            minutes += take * ride;
            transitRiders += take;
          }
        }
      }
    }
    run++;
    heap.clear();
    for (const r of accessRoads(home)) { dist[r] = time[r]; stamp[r] = run; parent[r] = -1; heap.push(r, time[r]); }
    while (heap.size && left > 0 && !hopeless()) {
      const u = heap.pop();
      const d = heap.lastPri;
      if (d > dist[u]) continue;
      if (d > T.maxCommute) break;
      let took = 0;
      const jobs = jobsAt.get(u);
      if (jobs) {
        for (const j of jobs) {
          if (left <= 0) break;
          const take = hire(j, left);
          left -= take; took += take;
        }
      }
      if (left > 0 && external > 0 && isEdge(u)) {
        const take = Math.min(left, external), u2 = Math.min(leftU, take);
        leftU -= u2; leftS -= take - u2;
        external -= take; left -= take; took += take;
      }
      if (took > 0) {
        minutes += took * d;
        for (let p = u; p !== -1; p = parent[p]) volume[p] += took;
      }
      for (const v of nbrs(u, tmp)) {
        if (!isNode[v]) continue;
        const nd = d + time[v];
        if (nd > T.maxCommute) continue;
        if (stamp[v] !== run || nd < dist[v]) { dist[v] = nd; stamp[v] = run; parent[v] = u; heap.push(v, nd); }
      }
    }
    const employed = workers - left;
    map.employed[home] = workers > 0 ? employed / workers : 1;
    if (employed > 0) map.commute[home] = minutes / employed;
    totalWorkers += workers; totalEmployed += employed; totalMinutes += minutes;
  }

  // --- skilled posts filled per job tile (smoothed like traffic so growth doesn't flicker)
  let skilledTotal = 0, skilledOpen = 0;
  for (let i = 0; i < size; i++) {
    if (skilledPosts[i] <= 0) { map.skillFill[i] = 1; continue; }
    skilledTotal += skilledPosts[i]; skilledOpen += remainingS[i];
    map.skillFill[i] = map.skillFill[i] * 0.5 + (1 - remainingS[i] / skilledPosts[i]) * 0.5;
  }

  // --- freight: industry trucks to the nearest highway exit (shortest-time tree from the edge)
  const toEdge = new Float64Array(size).fill(Infinity);
  const edgeParent = new Int32Array(size).fill(-1);
  heap.clear();
  for (let i = 0; i < size; i++) if (isNode[i] && isEdge(i)) { toEdge[i] = time[i]; heap.push(i, time[i]); }
  while (heap.size) {
    const u = heap.pop();
    if (heap.lastPri > toEdge[u]) continue;
    for (const v of nbrs(u, tmp)) {
      if (!isNode[v]) continue;
      const nd = toEdge[u] + time[v];
      if (nd < toEdge[v]) { toEdge[v] = nd; edgeParent[v] = u; heap.push(v, nd); }
    }
  }
  let freightTrips = 0;
  for (let i = 0; i < size; i++) {
    if (map.type[i] !== TILE.IND || map.level[i] === 0 || map.hasFlag(i, FLAG.ABANDONED)) continue;
    let start = -1;
    for (const r of accessRoads(i)) if (start < 0 || toEdge[r] < toEdge[start]) start = r;
    if (start < 0 || toEdge[start] === Infinity) continue;
    const trips = CAP.industrial[map.level[i]] * T.freightPerJob * (map.hasFlag(i, FLAG.HIGHTECH) ? CONFIG.education.hightech.freight : 1);
    freightTrips += trips;
    for (let p = start; p !== -1; p = edgeParent[p]) volume[p] += trips;
  }

  // --- smooth volumes (keeps routes from flip-flopping), then passing traffic per tile
  let congested = 0;
  const carFree = ordinance(state, 'carFree') ? 1 - CONFIG.ordinances.carFree.trafficCut : 1;
  if (carFree < 1) for (let i = 0; i < size; i++) volume[i] *= carFree;
  for (let i = 0; i < size; i++) {
    map.traffic[i] = isNode[i] ? map.traffic[i] * T.smoothing + volume[i] * (1 - T.smoothing) : 0;
    if (isNode[i] && roadLoad(map, i) > 1) congested++;
  }
  for (let i = 0; i < size; i++) {
    let p = 0;
    for (const j of nbrs(i, tmp)) if (map.type[j] === TILE.ROAD) p += map.traffic[j];
    map.passing[i] = p;
  }

  state.traffic = {
    workers: totalWorkers,
    employed: totalEmployed,
    avgCommute: totalEmployed > 0 ? totalMinutes / totalEmployed : 0,
    freightTrips,
    congested,
    transitRiders,
    skilledJobs: skilledTotal,
    skilledOpen,
  };
}
