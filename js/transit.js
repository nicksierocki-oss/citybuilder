// Transit lines: bus and tram lines drawn through stops in order. Vehicles drive the roads
// between stops (so they feel congestion), shuttling end to end. Pure simulation, no DOM.

import { CONFIG } from './config.js';
import { TILE, KINDS, FLAG } from './map.js';

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
  return line.freq * M.vehicleCost + (line.mode === 'tram' ? (route?.path.length ?? 0) * M.trackUpkeep : 0);
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
function roadPath(map, a, b, time) {
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
      if (map.type[v] !== TILE.ROAD || map.roadClass[v] === 2) continue; // buses stay off highways
      const nd = dist.get(u) + time[v];
      if (!dist.has(v) || nd < dist.get(v)) { dist.set(v, nd); prev.set(v, u); heap.push(v, nd); }
    }
  }
  return null;
}

// Rebuild every line's route: drop stops that no longer exist, find the road path between
// consecutive stops, and the travel time from the first stop to each stop (`at`).
// `time` is the per-tile road time (with congestion) from the traffic system.
export function buildRoutes(state, time) {
  const map = state.map, routes = {};
  for (const line of state.lines ?? []) {
    line.stops = line.stops.filter((i) => i < map.size && isStop(map, i));
    const M = CONFIG.transit.modes[line.mode];
    const path = [], at = [0];
    let t = 0, ok = line.stops.length >= 2;
    for (let k = 1; k < line.stops.length && ok; k++) {
      const seg = roadPath(map, line.stops[k - 1], line.stops[k], time);
      if (!seg) { ok = false; break; }
      path.push(...(path.length && path[path.length - 1] === seg.path[0] ? seg.path.slice(1) : seg.path));
      t += seg.time * M.timeFactor + M.dwell;
      at.push(t);
    }
    routes[line.id] = { ok, path: ok ? path : [], at: ok ? at : [], broken: line.stops.length >= 2 && !ok };
  }
  state.transitRoutes = routes;
  return routes;
}

// Trams lay track along their route (a flag on the road tiles). Returns the tiles that need new
// track (the caller charges for them).
export function tramTrackNeeded(state, line) {
  const route = state.transitRoutes?.[line.id], map = state.map;
  return (route?.path ?? []).filter((i) => !map.hasFlag(i, FLAG.TRAM));
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

// Where each vehicle is right now: [{ x, y, horiz, color, mode }], in tile units. Vehicles shuttle
// end to end; `t` is the animation clock in seconds.
export function vehiclePositions(state, t) {
  const out = [], map = state.map;
  (state.lines ?? []).forEach((line, n) => {
    const route = state.transitRoutes?.[line.id];
    if (!route?.ok || route.path.length < 2) return;
    const P = route.path, L = P.length - 1, cycle = L * 2;
    const speed = CONFIG.transit.modes[line.mode].animSpeed;
    const count = Math.max(1, line.freq * 2);
    for (let v = 0; v < count; v++) {
      let s = (t * speed + (v / count) * cycle + n * 1.7) % cycle;
      const back = s > L;
      if (back) s = cycle - s;
      const k = Math.min(L - 1, Math.floor(s)), f = s - k;
      const a = P[k], b = P[k + 1];
      const ax = a % map.width, ay = (a / map.width) | 0, bx = b % map.width, by = (b / map.width) | 0;
      const horiz = ay === by;
      // Keep to the right of the road for the direction of travel.
      const side = (back ? -1 : 1) * (horiz ? Math.sign(bx - ax) : -Math.sign(by - ay)) * 0.14;
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
