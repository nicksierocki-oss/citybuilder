// Traffic & commuting: workers travel from homes to jobs over the road network,
// industry sends freight to the highway, and the resulting volumes congest roads.
// Pure simulation — no DOM.

import { CONFIG } from './config.js';
import { TILE, FLAG } from './map.js';

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

// Travel minutes through one road tile given its current volume.
export function roadTime(map, i) {
  const T = CONFIG.traffic, c = map.roadClass[i];
  const load = map.traffic[i] / T.capacity[c];
  return T.minutesPerTile[c] * Math.min(T.maxCongestion, 1 + T.congestionK * load * load);
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
  const accessRoads = (i) => nbrs(i, []).filter((j) => isNode[j]);

  // --- job sinks: remaining positions per job tile, listed on each adjacent road
  const remaining = new Float32Array(size);
  const jobsAt = new Map(); // road index -> [job tile indices]
  for (let i = 0; i < size; i++) {
    const t = map.type[i];
    if ((t !== TILE.COM && t !== TILE.IND) || map.level[i] === 0 || map.hasFlag(i, FLAG.ABANDONED)) continue;
    remaining[i] = (t === TILE.COM ? CAP.commercial : CAP.industrial)[map.level[i]];
    for (const r of accessRoads(i)) {
      if (!jobsAt.has(r)) jobsAt.set(r, []);
      jobsAt.get(r).push(i);
    }
  }
  let external = D.externalJobs; // jobs in neighbouring towns, reached via any edge road
  const isEdge = (i) => map.roadDist[i] === 0;

  const volume = new Float32Array(size);
  const dist = new Float64Array(size);
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
    map.commute[i] = Infinity;
    map.employed[i] = 1;
    const roads = accessRoads(i);
    let best = Infinity;
    for (const r of roads) best = Math.min(best, access[r]);
    map.commute[i] = best;
    if (map.level[i] > 0 && !map.hasFlag(i, FLAG.ABANDONED) && roads.length) homes.push(i);
  }
  const rng = state.rng;
  for (let k = homes.length - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    [homes[k], homes[j]] = [homes[j], homes[k]];
  }

  let totalWorkers = 0, totalEmployed = 0, totalMinutes = 0;
  for (const home of homes) {
    const workers = CAP.residential[map.level[home]] * D.workforceRatio;
    let left = workers, minutes = 0;
    dist.fill(Infinity);
    heap.clear();
    for (const r of accessRoads(home)) { dist[r] = time[r]; parent[r] = -1; heap.push(r, time[r]); }
    while (heap.size && left > 0) {
      const u = heap.pop();
      const d = heap.lastPri;
      if (d > dist[u]) continue;
      if (d > T.maxCommute) break;
      let took = 0;
      const jobs = jobsAt.get(u);
      if (jobs) {
        for (const j of jobs) {
          if (left <= 0) break;
          const take = Math.min(left, remaining[j]);
          if (take <= 0) continue;
          remaining[j] -= take; left -= take; took += take;
        }
      }
      if (left > 0 && external > 0 && isEdge(u)) {
        const take = Math.min(left, external);
        external -= take; left -= take; took += take;
      }
      if (took > 0) {
        minutes += took * d;
        for (let p = u; p !== -1; p = parent[p]) volume[p] += took;
      }
      for (const v of nbrs(u, tmp)) {
        if (!isNode[v]) continue;
        const nd = d + time[v];
        if (nd < dist[v]) { dist[v] = nd; parent[v] = u; heap.push(v, nd); }
      }
    }
    const employed = workers - left;
    map.employed[home] = workers > 0 ? employed / workers : 1;
    if (employed > 0) map.commute[home] = minutes / employed;
    totalWorkers += workers; totalEmployed += employed; totalMinutes += minutes;
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
    const trips = CAP.industrial[map.level[i]] * T.freightPerJob;
    freightTrips += trips;
    for (let p = start; p !== -1; p = edgeParent[p]) volume[p] += trips;
  }

  // --- smooth volumes (keeps routes from flip-flopping), then passing traffic per tile
  let congested = 0;
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
  };
}
