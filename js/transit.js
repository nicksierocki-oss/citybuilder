// Transit lines: bus and tram lines drawn through stops in order. Vehicles drive the roads
// between stops (so they feel congestion), shuttling end to end. Pure simulation, no DOM.

import { CONFIG } from './config.js';
import { TILE, KINDS, FLAG, canDrive } from './map.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Small binary min-heap of [node, priority].
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n, p) {
    const a = this.a;
    a.push([n, p]);
    for (let i = a.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (a[up][1] <= p) break;
      [a[up], a[i]] = [a[i], a[up]]; i = up;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        let c = 2 * i + 1;
        if (c >= a.length) break;
        if (c + 1 < a.length && a[c + 1][1] < a[c][1]) c++;
        if (a[c][1] >= a[i][1]) break;
        [a[c], a[i]] = [a[i], a[c]]; i = c;
      }
    }
    return top;
  }
}

export function isStop(map, i) {
  return map.type[i] === TILE.SERVICE && KINDS[map.kind[i]] === 'bus';
}

export function lineColor(n) {
  const C = CONFIG.transit.colors;
  return C[n % C.length];
}

// Monthly cost of running a line (vehicles; trams also pay track upkeep along the route).
export function lineCost(state, line) {
  const M = CONFIG.transit.modes[line.mode], route = state.transitRoutes?.[line.id];
  return line.freq * M.vehicleCost + (line.mode === 'tram' ? (route?.tiles ?? 0) * M.trackUpkeep : 0);
}

// Minutes riding a line from stop k to stop d: outbound if d comes later, else on the way back.
export function rideMinutes(route, k, d) {
  return d > k ? route.at[d] - route.at[k] : route.back[d] - route.back[k];
}
export function linesCost(state) {
  return (state.lines ?? []).reduce((a, l) => a + lineCost(state, l), 0);
}

// Riders a line can carry a month.
export function lineCapacity(state, line) {
  return line.freq * CONFIG.transit.modes[line.mode].perVehicle * (state.budgets?.transit ?? 1);
}

// Road tiles a building at i can drive onto.
function accessRoads(map, i) {
  const x = i % map.width, y = (i / map.width) | 0, out = [];
  for (const [dx, dy] of DIRS) {
    if (!map.inBounds(x + dx, y + dy)) continue;
    const j = map.idx(x + dx, y + dy);
    if (map.isLocalRoad(j)) out.push(j);
  }
  return out;
}

// Quickest road path from stop a to stop b over the given per-tile times (Dijkstra).
// Returns { path: [road tiles], time } or null if they aren't connected.
function roadPath(map, a, b, time, tram = false) {
  const starts = accessRoads(map, a), goals = new Set(accessRoads(map, b));
  if (!starts.length || !goals.size) return null;
  const dist = new Map(), prev = new Map(), heap = new MinHeap();
  for (const s of starts) { dist.set(s, time[s]); prev.set(s, -1); heap.push(s, time[s]); }
  while (heap.size) {
    const [u, d] = heap.pop();
    if (d > dist.get(u)) continue;
    if (goals.has(u)) {
      const path = [];
      for (let p = u; p !== -1; p = prev.get(p)) path.push(p);
      return { path: path.reverse(), time: dist.get(u) };
    }
    const x = u % map.width, y = (u / map.width) | 0;
    for (const [dx, dy] of DIRS) {
      if (!map.inBounds(x + dx, y + dy)) continue;
      const v = map.idx(x + dx, y + dy);
      if (map.type[v] !== TILE.ROAD || map.roadClass[v] === 2 || !canDrive(map, u, v)) continue; // buses stay off highways
      const nd = dist.get(u) + time[v] * (tram && !map.hasFlag(v, FLAG.TRAM) ? 3 : 1); // trams keep to their track
      if (!dist.has(v) || nd < dist.get(v)) { dist.set(v, nd); prev.set(v, u); heap.push(v, nd); }
    }
  }
  return null;
}

// Rebuild every line's route: drop stops that no longer exist, then find the road path out
// through the stops in order and back through them in reverse (each leg obeys one-way
// streets, so the way back can differ). `at[k]` is the time from the first stop to stop k
// outbound, `back[k]` the time from the last stop to stop k on the way back. `path` is the
// whole loop, out then back. `time` is the per-tile road time from the traffic system.
export function buildRoutes(state, time) {
  const map = state.map, routes = {};
  for (const line of state.lines ?? []) {
    line.stops = line.stops.filter((i) => i < map.size && isStop(map, i));
    const M = CONFIG.transit.modes[line.mode], S = line.stops, n = S.length, tram = line.mode === 'tram';
    const path = [], at = [0], back = new Array(n).fill(0);
    const join = (seg) => path.push(...(path.length && path[path.length - 1] === seg.path[0] ? seg.path.slice(1) : seg.path));
    let ok = n >= 2, reason = null, t = 0;
    for (let k = 1; k < n && ok; k++) {
      const seg = roadPath(map, S[k - 1], S[k], time, tram);
      if (!seg) { ok = false; reason = 'stops not connected by road'; break; }
      join(seg);
      t += seg.time * M.timeFactor + M.dwell;
      at.push(t);
    }
    t = 0;
    for (let k = n - 1; k > 0 && ok; k--) {
      const seg = roadPath(map, S[k], S[k - 1], time, tram);
      if (!seg) { ok = false; reason = 'no way back (one-way streets)'; break; }
      join(seg);
      t += seg.time * M.timeFactor + M.dwell;
      back[k - 1] = t;
    }
    routes[line.id] = ok
      ? { ok, path, at, back, tiles: new Set(path).size, broken: false }
      : { ok: false, path: [], at: [], back: [], tiles: 0, broken: n >= 2, reason };
  }
  state.transitRoutes = routes;
  return routes;
}

// Trams lay track along their route (a flag on the road tiles). Returns the tiles that need new
// track (the caller charges for them).
export function tramTrackNeeded(state, line) {
  const route = state.transitRoutes?.[line.id], map = state.map;
  return [...new Set(route?.path ?? [])].filter((i) => !map.hasFlag(i, FLAG.TRAM));
}

// Lay any missing tram track along a tram line's route. Returns false (and lays nothing) if the
// city can't afford it.
export function layTramTrack(state, line) {
  if (line.mode !== 'tram') return true;
  const need = tramTrackNeeded(state, line), cost = need.length * CONFIG.transit.modes.tram.trackCost;
  if (cost > state.funds) return false;
  state.funds -= cost;
  for (const i of need) state.map.setFlag(i, FLAG.TRAM, true);
  if (need.length) state.events.push({ text: `Tram track laid: ${need.length} tiles ($${cost.toLocaleString()}).`, kind: 'cost' });
  return true;
}

// Where each vehicle is right now: [{ x, y, horiz, color, mode }], in tile units. Vehicles go
// round the loop (out, then back); `t` is the animation clock in seconds.
export function vehiclePositions(state, t) {
  const out = [], map = state.map;
  (state.lines ?? []).forEach((line, n) => {
    const route = state.transitRoutes?.[line.id];
    if (!route?.ok || route.path.length < 2) return;
    const P = route.path, L = P.length - 1;
    const speed = CONFIG.transit.modes[line.mode].animSpeed;
    const count = Math.max(1, line.freq * 2);
    for (let v = 0; v < count; v++) {
      const s = (t * speed + (v / count) * L + n * 1.7) % L;
      const k = Math.min(L - 1, Math.floor(s)), f = s - k;
      const a = P[k], b = P[k + 1];
      const ax = a % map.width, ay = (a / map.width) | 0, bx = b % map.width, by = (b / map.width) | 0;
      const horiz = ay === by;
      // Keep to the right of the road for the direction of travel.
      const side = (horiz ? Math.sign(bx - ax) : -Math.sign(by - ay)) * 0.14;
      out.push({ x: ax + (bx - ax) * f + 0.5 + (horiz ? 0 : side), y: ay + (by - ay) * f + 0.5 + (horiz ? side : 0), horiz, color: line.color, mode: line.mode });
    }
  });
  return out;
}

// Older cities had bus stops but no lines: join them into one line (nearest stop next).
export function migrateStops(state) {
  if (state.lines?.length) return;
  const map = state.map, stops = [];
  for (let i = 0; i < map.size; i++) if (isStop(map, i)) stops.push(i);
  state.lines = [];
  if (stops.length < 2) return;
  const xy = (i) => [i % map.width, (i / map.width) | 0];
  stops.sort((a, b) => xy(a)[0] - xy(b)[0]);
  const order = [stops.shift()];
  while (stops.length) {
    const [x, y] = xy(order[order.length - 1]);
    let best = 0;
    stops.forEach((s, k) => { const [sx, sy] = xy(s), [bx, by] = xy(stops[best]); if (Math.hypot(sx - x, sy - y) < Math.hypot(bx - x, by - y)) best = k; });
    order.push(stops.splice(best, 1)[0]);
  }
  state.lines.push({ id: 1, name: 'Line 1', color: lineColor(0), mode: 'bus', stops: order, freq: 2 });
}

// ---------------------------------------------------------------- railways

// The map side ('N', 'E', 'S', 'W') that track at edge tile i runs off, or null. Track has to
// meet the edge head on: a line running along the border isn't a way out.
export function railExitSide(map, i) {
  if (!map.rail[i]) return null;
  const w = map.width, h = map.height, x = i % w, y = (i / w) | 0;
  const r = (dx, dy) => map.inBounds(x + dx, y + dy) && map.rail[map.idx(x + dx, y + dy)];
  const lone = !r(1, 0) && !r(-1, 0) && !r(0, 1) && !r(0, -1);
  if (x === 0 && (r(1, 0) || lone)) return 'W';
  if (x === w - 1 && (r(-1, 0) || lone)) return 'E';
  if (y === 0 && (r(0, 1) || lone)) return 'N';
  if (y === h - 1 && (r(0, -1) || lone)) return 'S';
  return null;
}

// The rail network, rebuilt when the map changes: connected track (components), the stations
// on each, travel minutes between stations and to the map edge, and paths for the trains.
export function railNetwork(state) {
  const map = state.map, cached = map._rail;
  if (cached && cached.version === map.version && cached.size === map.size) return cached;
  const { width: w, height: h, size } = map, comp = new Int32Array(size).fill(-1);
  const nb = (i) => { const x = i % w, y = (i / w) | 0, o = []; for (const [dx, dy] of DIRS) if (x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h) o.push((y + dy) * w + x + dx); return o; };
  const comps = [];
  for (let i = 0; i < size; i++) {
    if (!map.rail[i] || comp[i] >= 0) continue;
    const c = comps.length, q = [i], edges = [];
    comp[i] = c;
    for (let hd = 0; hd < q.length; hd++) {
      const u = q[hd], x = u % w, y = (u / w) | 0;
      if (railExitSide(map, u)) edges.push(u);
      for (const v of nb(u)) if (map.rail[v] && comp[v] < 0) { comp[v] = c; q.push(v); }
    }
    comps.push({ tiles: q.length, edges, stations: [] });
  }
  // Stations and the track tile each one boards from.
  const stations = [];
  for (let i = 0; i < size; i++) {
    if (map.type[i] !== TILE.SERVICE || KINDS[map.kind[i]] !== 'railstation') continue;
    const track = nb(i).find((j) => map.rail[j]);
    if (track == null) continue;
    const st = { i, track, comp: comp[track], x: i % w, y: (i / w) | 0 };
    stations.push(st);
    comps[st.comp].stations.push(st);
  }
  // Tile distances along the track from each station (BFS), with parents for the train paths.
  const mpt = CONFIG.rail.minutesPerTile;
  for (const st of stations) {
    const dist = new Int32Array(size).fill(-1), par = new Int32Array(size).fill(-1), q = [st.track];
    dist[st.track] = 0;
    for (let hd = 0; hd < q.length; hd++) for (const v of nb(q[hd])) if (map.rail[v] && dist[v] < 0) { dist[v] = dist[q[hd]] + 1; par[v] = q[hd]; q.push(v); }
    st.minutesTo = new Map(comps[st.comp].stations.map((o) => [o.i, dist[o.track] * mpt]));
    const edge = comps[st.comp].edges.reduce((b, e) => (b < 0 || dist[e] < dist[b] ? e : b), -1);
    st.edgeMinutes = edge >= 0 ? dist[edge] * mpt : Infinity;
    const pathTo = (t) => { const p = []; for (let u = t; u >= 0; u = par[u]) p.push(u); return p.reverse(); };
    st.paths = new Map(comps[st.comp].stations.map((o) => [o.i, pathTo(o.track)]));
    st.edgePath = edge >= 0 ? pathTo(edge) : null;
  }
  // Train runs to animate: each station to the next one on its network, and out to the edge.
  const runs = [];
  for (const c of comps) {
    c.stations.forEach((st, k) => {
      const next = c.stations[k + 1];
      if (next) runs.push(st.paths.get(next.i));
    });
    if (c.edges.length && c.stations.length) runs.push(c.stations[0].edgePath);
  }
  map._rail = { version: map.version, size, comp, comps, stations, runs: runs.filter((p) => p && p.length > 1) };
  return map._rail;
}

// Railway links to the region (track tiles on the map edge).
export function railExits(state) {
  return railNetwork(state).comps.reduce((a, c) => a + (c.stations.length ? c.edges.length : 0), 0);
}

// Trains shuttling along each run: [{ x, y, horiz }] in tile units.
export function trainPositions(state, t) {
  const map = state.map, out = [];
  railNetwork(state).runs.forEach((P, n) => {
    const L = P.length - 1, cycle = L * 2, s0 = (t * 3.2 + n * 5.3) % cycle;
    const s = s0 > L ? cycle - s0 : s0, k = Math.min(L - 1, Math.floor(s)), f = s - k;
    const a = P[k], b = P[k + 1], ax = a % map.width, ay = (a / map.width) | 0, bx = b % map.width, by = (b / map.width) | 0;
    out.push({ x: ax + (bx - ax) * f + 0.5, y: ay + (by - ay) * f + 0.5, horiz: ay === by });
  });
  return out;
}
