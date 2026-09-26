// @ts-check
// Transit lines: the city plans bus lines itself from the stops the player places. Stops are
// grouped into areas by what's around them (homes, jobs or both), and each line links an area
// of homes with the nearest area of jobs. Vehicles drive the roads between stops (so they feel
// congestion), out and back. A line whose route runs on tram track runs trams. Pure, no DOM.

import { CONFIG } from './config.js';
import { TILE, KINDS, FLAG, canDrive, isHome, isJob, homeCap, jobCap } from './map.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const TRACK_PULL = 0.6; // routes treat tram track as this much quicker, so upgraded lines stay on it

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

// ---------------------------------------------------------------- automatic lines

const JOB_LABEL = { [TILE.COM]: 'Shops', [TILE.IND]: 'Industry', [TILE.OFFICE]: 'Offices', [TILE.FARM]: 'Farms' };

// Bus-drivable road pieces (highways excluded), ignoring one-way rules: stops on the same
// piece can be linked. Returns a component id per tile (-1 off road).
function roadComponents(map) {
  const { width: w, height: h, size } = map, comp = new Int32Array(size).fill(-1);
  const ok = (i) => map.type[i] === TILE.ROAD && map.roadClass[i] !== 2;
  let n = 0;
  for (let i = 0; i < size; i++) {
    if (!ok(i) || comp[i] >= 0) continue;
    const q = [i];
    comp[i] = n;
    for (let hd = 0; hd < q.length; hd++) {
      const u = q[hd], x = u % w, y = (u / w) | 0;
      for (const [dx, dy] of DIRS) {
        if (x + dx < 0 || y + dy < 0 || x + dx >= w || y + dy >= h) continue;
        const v = u + dx + dy * w;
        if (ok(v) && comp[v] < 0) { comp[v] = n; q.push(v); }
      }
    }
    n++;
  }
  return comp;
}

// What a stop serves: homes, jobs, both ('mixed') or nothing yet ('none'), from the buildings
// within walking distance (residents and jobs; an empty zoned lot counts a little, so a new
// neighbourhood is routed before it fills). `kinds` weighs each job zone type.
function stopProfile(map, i) {
  const r = CONFIG.buildings.bus.radius, w = map.width, x0 = i % w, y0 = (i / w) | 0;
  let homes = 0, jobs = 0;
  const kinds = {};
  for (let y = Math.max(0, y0 - r); y <= Math.min(map.height - 1, y0 + r); y++) {
    for (let x = Math.max(0, x0 - r); x <= Math.min(w - 1, x0 + r); x++) {
      const j = y * w + x, t = map.type[j];
      if (!isHome(t) && !isJob(t)) continue;
      const live = map.level[j] > 0 && !map.hasFlag(j, FLAG.ABANDONED);
      if (isHome(t)) homes += live ? homeCap(map, j) : 2;
      if (isJob(t)) { const n = live ? jobCap(map, j) : 2; jobs += n; kinds[t] = (kinds[t] ?? 0) + n; }
    }
  }
  const cls = homes && homes >= 2 * jobs ? 'home' : jobs && jobs >= 2 * homes ? 'work' : homes && jobs ? 'mixed' : 'none';
  return { cls, kinds };
}

// Stops in visiting order: nearest next, starting from `first`.
function chain(stops, first, xy) {
  const left = stops.filter((s) => s !== first), out = [first];
  while (left.length) {
    const [x, y] = xy(out[out.length - 1]);
    let best = 0, bd = Infinity;
    left.forEach((s, k) => { const [sx, sy] = xy(s), d = Math.hypot(sx - x, sy - y); if (d < bd) { bd = d; best = k; } });
    out.push(left.splice(best, 1)[0]);
  }
  return out;
}

// Plan the lines from the stops on the map. Cached until the map changes (the player builds
// or zones something) or `period` changes (callers pass the month, so routes follow the city
// as it grows). Returns { lines, unrouted } where unrouted lists stops on no line, with why.
export function planLines(map, period = 0) {
  const cached = map._linePlan;
  if (cached && cached.version === map.version && cached.size === map.size && cached.period === period) return cached;
  const T = CONFIG.transit, w = map.width;
  const xy = (i) => [i % w, (i / w) | 0];
  const comp = roadComponents(map);
  // Every stop with a road beside it, with its road piece and profile.
  const stops = [];
  for (let i = 0; i < map.size; i++) {
    if (!isStop(map, i)) continue;
    const road = accessRoads(map, i).find((j) => comp[j] >= 0);
    if (road == null) continue;
    stops.push({ i, comp: comp[road], x: i % w, y: (i / w) | 0, ...stopProfile(map, i) });
  }
  // Areas: stops of the same kind close together on the same road piece (union-find).
  const parent = stops.map((_, k) => k);
  const find = (k) => { while (parent[k] !== k) k = parent[k] = parent[parent[k]]; return k; };
  for (let a = 0; a < stops.length; a++) {
    for (let b = a + 1; b < stops.length; b++) {
      const A = stops[a], B = stops[b];
      if (A.comp !== B.comp || A.cls === 'none' || A.cls !== B.cls) continue;
      if (Math.max(Math.abs(A.x - B.x), Math.abs(A.y - B.y)) <= T.areaGap) parent[find(a)] = find(b);
    }
  }
  // Stops with nothing around them yet join the nearest area on their road piece.
  for (let a = 0; a < stops.length; a++) {
    if (stops[a].cls !== 'none') continue;
    let best = -1, bd = Infinity;
    stops.forEach((B, b) => {
      if (B.cls === 'none' || B.comp !== stops[a].comp) return;
      const d = Math.hypot(B.x - stops[a].x, B.y - stops[a].y);
      if (d < bd) { bd = d; best = b; }
    });
    if (best >= 0) parent[a] = find(best);
  }
  const groups = new Map();
  stops.forEach((s, k) => { const r = find(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(s); });
  // Big areas are split into chunks of nearby stops so each line stays a sensible length.
  const areas = [];
  for (const g of groups.values()) {
    const cls = g.find((s) => s.cls !== 'none')?.cls ?? 'none';
    const kinds = {};
    for (const s of g) for (const [t, c] of Object.entries(s.kinds)) kinds[t] = (kinds[t] ?? 0) + c;
    const byI = new Map(g.map((s) => [s.i, s]));
    const start = g.reduce((a, b) => (b.x + b.y < a.x + a.y ? b : a)).i; // a corner, so the chain sweeps across
    const order = chain(g.map((s) => s.i), start, xy);
    for (let k = 0; k < order.length; k += T.areaMaxStops) {
      const part = order.slice(k, k + T.areaMaxStops).map((i) => byI.get(i));
      areas.push({
        stops: part.map((s) => s.i), comp: part[0].comp, cls, kinds,
        x: part.reduce((a, s) => a + s.x, 0) / part.length, y: part.reduce((a, s) => a + s.y, 0) / part.length,
      });
    }
  }
  const label = (A) => {
    if (A.cls === 'home') return 'Homes';
    if (A.cls === 'mixed') return 'Mixed';
    if (A.cls === 'none') return 'Stops';
    const top = Object.entries(A.kinds).sort((a, b) => b[1] - a[1])[0];
    return JOB_LABEL[top?.[0]] ?? 'Jobs';
  };
  const home = (A) => A.cls === 'home' || A.cls === 'mixed';
  const work = (A) => A.cls === 'work' || A.cls === 'mixed';
  const dist = (A, B) => Math.hypot(A.x - B.x, A.y - B.y);
  // Routes: every home area to its nearest job area. A job area still unserved rides along on
  // the route from its nearest home area (or gets its own route there if that one is full).
  const routes = [];
  const nearest = (A, pred) => areas.filter((B) => B !== A && B.comp === A.comp && pred(B)).sort((a, b) => dist(A, a) - dist(A, b))[0];
  for (const H of areas.filter(home)) { const W = nearest(H, work); if (W) routes.push({ H, W: [W] }); }
  const served = new Set(routes.flatMap((r) => [r.H, ...r.W]));
  for (const W of areas.filter(work)) {
    if (served.has(W)) continue;
    const H = nearest(W, home);
    if (!H) continue;
    const size = (list) => list.reduce((n, B) => n + B.stops.length, 0);
    const r = routes.find((o) => o.H === H && size(o.W) + W.stops.length <= T.areaMaxStops);
    if (r) r.W.push(W); else routes.push({ H, W: [W] });
    served.add(H); served.add(W);
  }
  const lines = [];
  const add = (stopsInOrder, name, homeStops = 0) => {
    if (stopsInOrder.length < 2) return;
    const id = lines.length + 1;
    lines.push({ id, name: `Route ${id} · ${name}`, color: lineColor(id - 1), mode: 'bus', stops: stopsInOrder, freq: 1, homeStops });
  };
  const at = (i) => ({ x: xy(i)[0], y: xy(i)[1] });
  for (const { H, W } of routes) {
    // Start at the home stop farthest from the jobs, then on through the job stops nearest first.
    const hFirst = H.stops.reduce((a, b) => (dist(at(b), W[0]) > dist(at(a), W[0]) ? b : a));
    const hs = chain(H.stops, hFirst, xy), last = at(hs[hs.length - 1]);
    const ws = W.flatMap((B) => B.stops);
    const wFirst = ws.reduce((a, b) => (dist(at(b), last) < dist(at(a), last) ? b : a));
    const names = [...new Set(W.map(label))].join(' & ');
    add([...hs, ...chain(ws, wFirst, xy)], `${label(H)} → ${names}`, hs.length);
  }
  // Areas left out: a mixed area can run its own local line (it has homes and jobs); areas of
  // only homes or only jobs with nothing to link to get no line (it would go nowhere), and the
  // panel says why.
  const covered = new Set(routes.flatMap((r) => [r.H, ...r.W]));
  const unrouted = [];
  for (const A of areas) {
    if (covered.has(A)) continue;
    if (A.cls === 'mixed' && A.stops.length >= 2) { add(chain(A.stops, A.stops[0], xy), 'Mixed local'); continue; }
    const why = A.cls === 'home' ? 'no stops near jobs on the same roads: place one where people work'
      : A.cls === 'work' ? 'no stops near homes on the same roads: place one where people live'
      : A.cls === 'mixed' ? 'needs a second stop: near other homes or jobs on the same roads'
      : 'no homes or jobs within 3 tiles yet';
    for (const i of A.stops) unrouted.push({ i, why });
  }
  map._linePlan = { version: map.version, size: map.size, period, lines, unrouted };
  return map._linePlan;
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

// Quickest road path from stop a to stop b over the given per-tile times (Dijkstra), keeping
// to tram track where there is some. Returns { path: [road tiles], time } or null if they
// aren't connected.
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
      let t = 0;
      for (let p = u; p !== -1; p = prev.get(p)) { path.push(p); t += time[p]; }
      return { path: path.reverse(), time: t };
    }
    const x = u % map.width, y = (u / map.width) | 0;
    for (const [dx, dy] of DIRS) {
      if (!map.inBounds(x + dx, y + dy)) continue;
      const v = map.idx(x + dx, y + dy);
      if (map.type[v] !== TILE.ROAD || map.roadClass[v] === 2 || !canDrive(map, u, v)) continue; // buses stay off highways
      const nd = dist.get(u) + time[v] * (map.hasFlag(v, FLAG.TRAM) ? TRACK_PULL : 1); // trams keep to their track
      if (!dist.has(v) || nd < dist.get(v)) { dist.set(v, nd); prev.set(v, u); heap.push(v, nd); }
    }
  }
  return null;
}

// Plan the lines (see planLines), then find each one's road path out through the stops in
// order and back through them in reverse (each leg obeys one-way streets, so the way back can
// differ). `at[k]` is the time from the first stop to stop k outbound, `back[k]` the time from
// the last stop to stop k on the way back. `path` is the whole loop, out then back. `time` is
// the per-tile road time from the traffic system. A line runs trams when most of its route has
// tram track, and as many vehicles as the homes along it need.
export function buildRoutes(state, time) {
  const map = state.map, routes = {}, T = CONFIG.transit;
  const plan = planLines(map, Math.floor((state.tick ?? 0) / CONFIG.time.ticksPerMonth));
  state.lines = plan.lines;
  state.unroutedStops = plan.unrouted;
  for (const line of state.lines) {
    const S = line.stops, n = S.length;
    const path = [], legs = [], backLegs = [];
    const join = (seg) => path.push(...(path.length && path[path.length - 1] === seg.path[0] ? seg.path.slice(1) : seg.path));
    let ok = n >= 2, reason = null;
    for (let k = 1; k < n && ok; k++) {
      const seg = roadPath(map, S[k - 1], S[k], time);
      if (!seg) { ok = false; reason = 'stops not connected by road'; break; }
      join(seg); legs.push(seg.time);
    }
    for (let k = n - 1; k > 0 && ok; k--) {
      const seg = roadPath(map, S[k], S[k - 1], time);
      if (!seg) { ok = false; reason = 'no way back (one-way streets)'; break; }
      join(seg); backLegs.push(seg.time);
    }
    if (!ok) { routes[line.id] = { ok: false, path: [], at: [], back: [], tiles: 0, broken: true, reason }; continue; }
    const tiles = new Set(path);
    let track = 0;
    for (const i of tiles) if (map.hasFlag(i, FLAG.TRAM)) track++;
    line.mode = track >= tiles.size * T.tramShare ? 'tram' : 'bus';
    const M = T.modes[line.mode];
    const at = [0], back = new Array(n).fill(0);
    legs.forEach((t, k) => at.push(at[k] + t * M.timeFactor + M.dwell));
    backLegs.forEach((t, k) => { back[n - 2 - k] = (k ? back[n - 1 - k] : 0) + t * M.timeFactor + M.dwell; });
    line.freq = autoFreq(map, line, M);
    routes[line.id] = { ok, path, at, back, tiles: tiles.size, track, broken: false };
  }
  state.transitRoutes = routes;
  return routes;
}

// Vehicles a line runs: enough for the workers living near its stops who'd ride.
function autoFreq(map, line, M) {
  const r = CONFIG.buildings.bus.radius, w = map.width, seen = new Set();
  let workers = 0;
  for (const s of line.stops) {
    const x0 = s % w, y0 = (s / w) | 0;
    for (let y = Math.max(0, y0 - r); y <= Math.min(map.height - 1, y0 + r); y++) {
      for (let x = Math.max(0, x0 - r); x <= Math.min(w - 1, x0 + r); x++) {
        const j = y * w + x;
        if (seen.has(j)) continue;
        seen.add(j);
        workers += homeCap(map, j);
      }
    }
  }
  const riders = workers * CONFIG.demand.workforceRatio * M.share;
  return Math.max(1, Math.min(CONFIG.transit.maxFreq, Math.ceil(riders / M.perVehicle)));
}

// Trams lay track along their route (a flag on the road tiles). Returns the tiles that need new
// track (the caller charges for them).
export function tramTrackNeeded(state, line) {
  const route = state.transitRoutes?.[line.id], map = state.map;
  return [...new Set(route?.path ?? [])].filter((i) => !map.hasFlag(i, FLAG.TRAM));
}

// Lay any missing tram track along a line's route, so it runs trams from the next refresh.
// Returns false (and lays nothing) if the city can't afford it.
export function layTramTrack(state, line) {
  const need = tramTrackNeeded(state, line), cost = need.length * CONFIG.transit.modes.tram.trackCost;
  if (cost > state.funds) return false;
  state.funds -= cost;
  for (const i of need) state.map.setFlag(i, FLAG.TRAM, true);
  if (need.length) state.events.push({ text: `Tram track laid: ${need.length} tiles ($${cost.toLocaleString()}).`, kind: 'cost' });
  state.map.version++;
  return true;
}

// Take up the tram track along a line's route (free), except where another tram line runs.
export function removeTramTrack(state, line) {
  const map = state.map, routes = state.transitRoutes ?? {}, keep = new Set();
  for (const l of state.lines ?? []) if (l !== line && l.mode === 'tram') for (const i of routes[l.id]?.path ?? []) keep.add(i);
  for (const i of routes[line.id]?.path ?? []) if (!keep.has(i)) map.setFlag(i, FLAG.TRAM, false);
  map.version++;
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
