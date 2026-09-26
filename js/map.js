// @ts-check
// Map data model: a fixed grid stored as flat typed-array layers.
// Adding a system later (power, water, traffic) = adding a layer here.

import { CONFIG } from './config.js';

export const TERRAIN = { GRASS: 0, WATER: 1 };
// New types go at the END (saves store the number).
export const TILE = { EMPTY: 0, ROAD: 1, RES: 2, COM: 3, IND: 4, PARK: 5, SERVICE: 6, OFFICE: 7, FARM: 8, MIXED: 9, RAIL: 10 };
export const ZONE_NAMES = ['Empty', 'Road', 'Residential', 'Commercial', 'Industrial', 'Park', 'Public building', 'Offices', 'Farm', 'Mixed-use', 'Railway'];
// Public building kinds stored in map.kind for TILE.SERVICE tiles (keys of CONFIG.buildings).
// New kinds go at the END (saves store the index).
export const KINDS = [null, 'coal', 'wind', 'pump', 'school', 'clinic', 'plaza', 'recycling', 'police', 'fire', 'bus', 'metro',
  'townpark', 'centralpark', 'university', 'stadium', 'statue', 'hospital', 'landfill', 'railstation', 'parking'];
export const KIND_ID = Object.fromEntries(KINDS.map((k, i) => [k, i]).filter(([k]) => k));
// Utility service status per tile (map.power / map.water)
export const SUPPLY = { NONE: 0, SHORT: 1, OK: 2 };
export const FLAG = { TREES: 1, ABANDONED: 2, FIRE: 4, LIGHTS: 8, INTERCHANGE: 16, HIGHTECH: 32, HOTEL: 64, TRAM: 128 };
// Junction kinds (see junctionKind): how a road tile meets its neighbours.
export const JUNCTION = { NONE: 0, MERGE: 1, INTERSECTION: 2, HIGHWAY: 3 };

export const ROAD_CLASS = { STREET: 0, AVENUE: 1, HIGHWAY: 2 };
export const ROAD_NAMES = ['Street', 'Avenue', 'Highway'];

// Road modifiers (map.roadMod): the low 3 bits are a one-way direction (index into ONEWAY),
// plus a roundabout bit on intersections.
export const ROADMOD = { DIR: 7, ROUNDABOUT: 8 };
export const ONEWAY = [null, [1, 0], [-1, 0], [0, 1], [0, -1]]; // 1 east, 2 west, 3 south, 4 north
export const ONEWAY_NAMES = ['', 'east', 'west', 'south', 'north'];
export function onewayCode(dx, dy) { return dx > 0 ? 1 : dx < 0 ? 2 : dy > 0 ? 3 : dy < 0 ? 4 : 0; }

// Road tiles next to i (a junction has 3 or 4).
export function roadLegs(map, i) {
  const w = map.width, x = i % w;
  return +(x > 0 && map.type[i - 1] === TILE.ROAD) + +(x < w - 1 && map.type[i + 1] === TILE.ROAD)
    + +(i >= w && map.type[i - w] === TILE.ROAD) + +(i + w < map.size && map.type[i + w] === TILE.ROAD);
}

// One-way direction that applies at road tile i (junctions never restrict: the streets either
// side of them do).
export function onewayAt(map, i) {
  const d = map.roadMod[i] & ROADMOD.DIR;
  return d && roadLegs(map, i) < 3 ? d : 0;
}

// May a car drive from road tile a to the adjacent road tile b? Not against a one-way street
// (leaving or entering it); turning on or off one is fine.
export function canDrive(map, a, b) {
  if (!(map.roadMod[a] & ROADMOD.DIR) && !(map.roadMod[b] & ROADMOD.DIR)) return true;
  const ma = onewayAt(map, a), mb = onewayAt(map, b);
  if (!ma && !mb) return true;
  const d = b - a, w = map.width;
  const code = d === 1 ? 1 : d === -1 ? 2 : d === w ? 3 : 4;
  const opp = [0, 2, 1, 4, 3][code];
  return ma !== opp && mb !== opp;
}

// Footprint [w, h] of a public building kind (1×1 unless it's a landmark).
export function footprintSize(kind) {
  return CONFIG.buildings[kind]?.size ?? [1, 1];
}

// Share of a job tile's positions that need skilled (educated) workers.
export function skilledShare(map, i) {
  const E = CONFIG.education, t = map.type[i], lv = map.level[i];
  if (t === TILE.COM) return E.skilledShare.commercial[lv];
  if (t === TILE.OFFICE) return E.skilledShare.office[lv];
  if (t === TILE.FARM) return E.skilledShare.farm[lv];
  if (t === TILE.MIXED) return E.skilledShare.mixed[lv];
  if (t !== TILE.IND) return 0;
  return lv > 0 && map.hasFlag(i, FLAG.HIGHTECH) ? E.hightech.skilledShare : E.skilledShare.industrial[lv];
}

export function isZone(type) {
  return type === TILE.RES || type === TILE.COM || type === TILE.IND || type === TILE.OFFICE || type === TILE.FARM || type === TILE.MIXED;
}
// Zones people live in / work in (mixed-use is both).
export function isHome(type) { return type === TILE.RES || type === TILE.MIXED; }
export function isJob(type) { return type === TILE.COM || type === TILE.IND || type === TILE.OFFICE || type === TILE.FARM || type === TILE.MIXED; }
// Shop-like zones (attract shoppers, count as commercial).
export function isShop(type) { return type === TILE.COM || type === TILE.MIXED; }

// Residents / jobs of tile i at its current density (0 if vacant; abandonment is the caller's call).
export function homeCap(map, i) {
  const t = map.type[i], C = CONFIG.capacity;
  return t === TILE.RES ? C.residential[map.level[i]] : t === TILE.MIXED ? C.mixedHomes[map.level[i]] : 0;
}
const JOB_CAP = { [TILE.COM]: 'commercial', [TILE.IND]: 'industrial', [TILE.OFFICE]: 'office', [TILE.FARM]: 'farm', [TILE.MIXED]: 'mixedJobs' };
export function jobCap(map, i) {
  const k = JOB_CAP[map.type[i]];
  return k ? CONFIG.capacity[k][map.level[i]] : 0;
}
// Config key for per-zone tables (utility use etc.).
export const ZONE_KEY = { [TILE.RES]: 'residential', [TILE.COM]: 'commercial', [TILE.IND]: 'industrial', [TILE.OFFICE]: 'office', [TILE.FARM]: 'farm', [TILE.MIXED]: 'mixed' };

// Small deterministic RNG (mulberry32) so a seed reproduces a map.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class GameMap {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    const n = width * height;
    this.size = n;
    // Persistent layers (saved)
    this.terrain = new Uint8Array(n);
    this.type = new Uint8Array(n);
    this.level = new Uint8Array(n);     // 0 = vacant lot, 1..3 = density
    this.flags = new Uint8Array(n);
    this.variant = new Uint8Array(n);   // cosmetic randomness per tile
    this.roadClass = new Uint8Array(n); // ROAD_CLASS for road tiles
    this.kind = new Uint8Array(n);      // KINDS index for public buildings
    this.part = new Uint8Array(n);      // multi-tile buildings: 0 = anchor (top-left), else 1 + dx + 8 * dy
    this.district = new Uint8Array(n);  // district id, 0 = none
    this.rail = new Uint8Array(n);      // 1 = railway track (TILE.RAIL, or a road with a level crossing)
    this.roadMod = new Uint8Array(n);   // ROADMOD: one-way direction, roundabout
    this.elev = new Uint8Array(n);      // terrain height, 0 = base level (water is always 0)
    this.heightVersion = 0;             // bumped when heights change (3D ground rebuild)
    this.education = new Uint8Array(n); // homes: skilled share of residents × 255 (changes slowly)
    this.educationReady = false;        // false until education has been seeded (new maps, old saves)
    /** @type {number | null} */
    this.seed = null;                   // generation seed (null for unknown)
    // Derived layers (recomputed by the simulation)
    this.pollution = new Float32Array(n);
    this.landValue = new Float32Array(n);
    this.roadDist = new Int32Array(n);  // road tiles to the map edge, -1 = not connected
    this.oneWayTrap = new Uint8Array(n); // road cut off by one-way streets: 1 no way out, 2 no way in
    this.shoppers = new Float32Array(n);// residents within shopping radius
    this.waterDist = new Float32Array(n);
    // Traffic (derived, see traffic.js)
    this.traffic = new Float32Array(n);   // trips per month through a road tile (smoothed; also sets route costs)
    this.commute = new Float32Array(n);   // residential: avg commute minutes (Infinity = no job reachable)
    this.employed = new Float32Array(n);  // residential: share of workers who found a job (1 if vacant)
    this.passing = new Float32Array(n);   // trips on roads next to this tile
    this.skillFill = new Float32Array(n); // jobs: share of skilled posts filled (1 if none)
    this.eduNearby = new Float32Array(n); // skilled share of residents within the high-tech radius
    this.skilledNearby = new Float32Array(n); // skilled residents within that radius
    this.employed.fill(1);
    this.skillFill.fill(1);
    // Utilities & services (derived, see services.js)
    this.power = new Uint8Array(n);       // SUPPLY status
    this.water = new Uint8Array(n);
    this.coverage = {                     // 0..1 service coverage per tile
      school: new Float32Array(n), clinic: new Float32Array(n),
      plaza: new Float32Array(n), recycling: new Float32Array(n),
      police: new Float32Array(n), fire: new Float32Array(n),
      bus: new Float32Array(n), metro: new Float32Array(n),
      townpark: new Float32Array(n), centralpark: new Float32Array(n),
      university: new Float32Array(n), stadium: new Float32Array(n), statue: new Float32Array(n),
      hospital: new Float32Array(n), landfill: new Float32Array(n), railstation: new Float32Array(n),
      parking: new Float32Array(n),
    };
    this.riders = new Float32Array(n);    // transit boardings + alightings per station tile
    this.crime = new Float32Array(n);     // 0..100 per building
    this.fireRisk = new Float32Array(n);  // 0..100 per building
    this.burn = new Uint16Array(n);       // ticks a fire has been burning (FLAG.FIRE tiles)
    this.happiness = new Float32Array(n);
    this.health = new Float32Array(n);    // 0..100
    this.trash = new Float32Array(n);     // uncollected garbage level 0..100 (buildings)
    this.roadsDirty = true;
    this.version = 0;                   // bumped on every player edit (renderers cache on it)
  }

  idx(x, y) { return y * this.width + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.width && y < this.height; }

  // Anchor (top-left) tile of the public building covering tile i (i itself if 1×1).
  anchorOf(i) {
    const p = this.part[i];
    if (!p || this.type[i] !== TILE.SERVICE) return i;
    return i - ((p - 1) & 7) - ((p - 1) >> 3) * this.width;
  }

  // Every tile of the public building covering tile i (just [i] for anything else).
  footprintTiles(i) {
    if (this.type[i] !== TILE.SERVICE) return [i];
    const a = this.anchorOf(i), [w, h] = footprintSize(KINDS[this.kind[a]]);
    if (w === 1 && h === 1) return [a];
    const out = [];
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push(a + dx + dy * this.width);
    return out;
  }

  hasFlag(i, f) { return (this.flags[i] & f) !== 0; }
  setFlag(i, f, on) { this.flags[i] = on ? (this.flags[i] | f) : (this.flags[i] & ~f); }

  // Is tile i next to (4-neighbour) a road connected to the regional network?
  hasRoadAccess(i) {
    const x = i % this.width, y = (i / this.width) | 0;
    const d = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of d) {
      const nx = x + dx, ny = y + dy;
      if (!this.inBounds(nx, ny)) continue;
      const j = this.idx(nx, ny);
      if (this.isLocalRoad(j) && this.roadDist[j] >= 0) return true;
    }
    return false;
  }

  // Is there a connected local road within r tiles (fields don't need their own frontage)?
  roadWithin(i, r) {
    const x0 = i % this.width, y0 = (i / this.width) | 0;
    for (let y = Math.max(0, y0 - r); y <= Math.min(this.height - 1, y0 + r); y++) {
      for (let x = Math.max(0, x0 - r); x <= Math.min(this.width - 1, x0 + r); x++) {
        const j = y * this.width + x;
        if (this.isLocalRoad(j) && this.roadDist[j] >= 0) return true;
      }
    }
    return false;
  }

  // How road tile i meets its neighbours: a highway crossing/joining other roads (legs >= 3),
  // an ordinary intersection, a merge where road classes change in a straight run, or none.
  junctionKind(i) {
    if (this.type[i] !== TILE.ROAD) return JUNCTION.NONE;
    const x = i % this.width, y = (i / this.width) | 0, cls = this.roadClass[i];
    let legs = 0, highway = cls === ROAD_CLASS.HIGHWAY, mixed = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!this.inBounds(x + dx, y + dy)) continue;
      const j = this.idx(x + dx, y + dy);
      if (this.type[j] !== TILE.ROAD) continue;
      legs++;
      if (this.roadClass[j] === ROAD_CLASS.HIGHWAY) highway = true;
      if (this.roadClass[j] !== cls) mixed = true;
    }
    if (legs >= 3) return highway && mixed ? JUNCTION.HIGHWAY : JUNCTION.INTERSECTION;
    return mixed && highway ? JUNCTION.MERGE : JUNCTION.NONE;
  }

  // Roads a building can front onto. Highways are limited-access: no driveways.
  isLocalRoad(j) {
    return this.type[j] === TILE.ROAD && this.roadClass[j] !== ROAD_CLASS.HIGHWAY;
  }

  // Shortest road distance to the edge among adjacent roads (for freight), -1 if none.
  accessRoadDist(i) {
    const x = i % this.width, y = (i / this.width) | 0;
    let best = -1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!this.inBounds(nx, ny)) continue;
      const j = this.idx(nx, ny);
      if (this.isLocalRoad(j) && this.roadDist[j] >= 0) {
        if (best < 0 || this.roadDist[j] < best) best = this.roadDist[j];
      }
    }
    return best;
  }

  // Biggest height step from land tile i to a neighbouring land tile.
  slope(i) {
    if (this.terrain[i] === TERRAIN.WATER) return 0;
    const x = i % this.width, y = (i / this.width) | 0, h = this.elev[i];
    let s = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!this.inBounds(x + dx, y + dy)) continue;
      const j = this.idx(x + dx, y + dy);
      if (this.terrain[j] !== TERRAIN.WATER) s = Math.max(s, Math.abs(this.elev[j] - h));
    }
    return s;
  }

  computeWaterDistance() {
    // Multi-source BFS (Chebyshev) from water tiles.
    const { width: w, height: h } = this;
    this.waterDist.fill(Infinity);
    const q = [];
    for (let i = 0; i < this.size; i++) {
      if (this.terrain[i] === TERRAIN.WATER) { this.waterDist[i] = 0; q.push(i); }
    }
    for (let head = 0; head < q.length; head++) {
      const i = q[head], x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (this.waterDist[j] === Infinity) { this.waterDist[j] = this.waterDist[i] + 1; q.push(j); }
      }
    }
  }
}

export function highwayEntry(width, height) {
  return {
    row: Math.round(height * CONFIG.map.highwayRowShare),
    length: Math.round(width * CONFIG.map.highwayLengthShare),
  };
}

// Tree clumps: seed some, then let them spread. `mask(i)` limits where trees may appear.
/** @param {(i: number) => boolean} [mask] */
function growTrees(map, rng, mask = (_i) => true) {
  const { width, height } = map, treeChance = CONFIG.map.treeChance;
  for (let i = 0; i < map.size; i++) {
    if (mask(i) && map.terrain[i] === TERRAIN.GRASS && rng() < treeChance * 0.35) map.setFlag(i, FLAG.TREES, true);
  }
  for (let pass = 0; pass < 2; pass++) {
    const snapshot = map.flags.slice();
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = map.idx(x, y);
      if (!mask(i) || map.terrain[i] !== TERRAIN.GRASS || map.type[i] !== TILE.EMPTY) continue;
      let n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (map.inBounds(x + dx, y + dy) && (snapshot[map.idx(x + dx, y + dy)] & FLAG.TREES)) n++;
      }
      if (n > 0 && rng() < treeChance * n * 0.9) map.setFlag(i, FLAG.TREES, true);
    }
  }
}

// Smooth value noise in 0..1: random values on a coarse grid, bilinear in between.
function valueNoise(w, h, cell, rng) {
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2, g = new Float32Array(gw * gh).map(() => rng());
  const out = new Float32Array(w * h), ease = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = ease(gx - x0), fy = ease(gy - y0);
    const v = (a, b) => g[(y0 + b) * gw + x0 + a];
    out[y * w + x] = (v(0, 0) * (1 - fx) + v(1, 0) * fx) * (1 - fy) + (v(0, 1) * (1 - fx) + v(1, 1) * fx) * fy;
  }
  return out;
}

// Keep neighbouring land within `step` levels of each other (lowers the higher side).
export function limitSlopes(map, step = 1) {
  for (let pass = 0; pass < CONFIG.terrain.maxHeight + 1; pass++) {
    let changed = false;
    for (let i = 0; i < map.size; i++) {
      if (map.terrain[i] === TERRAIN.WATER) { map.elev[i] = 0; continue; }
      const x = i % map.width, y = (i / map.width) | 0;
      let lo = 255;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (map.inBounds(x + dx, y + dy)) lo = Math.min(lo, map.elev[map.idx(x + dx, y + dy)]);
      if (map.elev[i] > lo + step) { map.elev[i] = lo + step; changed = true; }
    }
    if (!changed) break;
  }
}

// Hills and coastlines for non-plains maps. Own random numbers, so the rest of the map (and
// plains maps) come out exactly as before.
function shapeLand(map, seed, landform) {
  const T = CONFIG.terrain, { width: w, height: h } = map, rng = makeRng(seed * 7 + 13);
  const { row, length } = highwayEntry(w, h);
  if (landform === 'coast') {
    // Sea along the south edge with a wavy shore; land rises gently inland.
    const wave = valueNoise(w, 1, 7, rng);
    for (let x = 0; x < w; x++) {
      const shore = Math.round(h * (0.8 + wave[x] * 0.1));
      for (let y = shore; y < h; y++) { const i = map.idx(x, y); map.terrain[i] = TERRAIN.WATER; map.type[i] = TILE.EMPTY; map.flags[i] = 0; }
    }
  }
  const a = valueNoise(w, h, Math.max(6, Math.round(w / 6)), rng), b = valueNoise(w, h, 4, rng);
  for (let i = 0; i < map.size; i++) {
    if (map.terrain[i] === TERRAIN.WATER) continue;
    const x = i % w, y = (i / w) | 0;
    let v = landform === 'hills' ? (a[i] * 0.8 + b[i] * 0.2) * (T.maxHeight + 2) - 2 : (a[i] * 0.7 + b[i] * 0.3) * 3.2 - 0.6;
    if (landform === 'coast') v += (y / h) < 0.8 ? (0.8 - y / h) * 4 : 0; // higher inland
    if (Math.abs(y - row) <= 3 && x < length + 4) v = 0;                 // flat start by the regional road
    map.elev[i] = Math.max(0, Math.min(T.maxHeight, Math.round(v)));
  }
  limitSlopes(map, 1);
  map.heightVersion++;
}

export function generateMap(seed = (Math.random() * 1e9) | 0, size = CONFIG.map.defaultSize, landform = 'plains') {
  const width = size, height = size;
  const riverWidth = Math.max(2, Math.round(size / 32));
  const { row: highwayRow, length: highwayLength } = highwayEntry(width, height);
  const map = new GameMap(width, height);
  map.seed = seed;
  const rng = makeRng(seed);

  for (let i = 0; i < map.size; i++) map.variant[i] = (rng() * 256) | 0;

  // River: meanders top to bottom on the east half.
  let cx = Math.floor(width * 0.62 + rng() * 4);
  for (let y = 0; y < height; y++) {
    if (rng() < 0.35) cx += rng() < 0.5 ? -1 : 1;
    cx = Math.max(Math.floor(width * 0.5), Math.min(width - 6, cx));
    for (let k = 0; k < riverWidth; k++) map.terrain[map.idx(cx + k, y)] = TERRAIN.WATER;
    // occasional bulge for a more natural bank
    if (rng() < 0.2) map.terrain[map.idx(cx + riverWidth, y)] = TERRAIN.WATER;
  }

  growTrees(map, rng);

  // Regional road entering from the west edge: the city's link to the world.
  for (let x = 0; x < highwayLength; x++) {
    const i = map.idx(x, highwayRow);
    map.type[i] = TILE.ROAD;
    map.roadClass[i] = ROAD_CLASS.AVENUE;
    map.setFlag(i, FLAG.TREES, false);
  }
  // Keep the area around its end clear so the first blocks are easy.
  for (let y = highwayRow - 3; y <= highwayRow + 3; y++) {
    for (let x = 0; x < highwayLength + 3; x++) {
      if (map.inBounds(x, y) && rng() < 0.8) map.setFlag(map.idx(x, y), FLAG.TREES, false);
    }
  }

  if (landform !== 'plains') shapeLand(map, seed, landform);
  map.computeWaterDistance();
  map.roadsDirty = true;
  return map;
}

export const PERSISTENT_LAYERS = ['terrain', 'type', 'level', 'flags', 'variant', 'roadClass', 'kind', 'part', 'district', 'education', 'rail', 'roadMod', 'elev'];

// Grow a city's map to newSize x newSize, adding land evenly on every side.
// The river keeps meandering into the new land and every road that ran off the old
// edge is extended to the new edge, so the city stays connected to the region.
// Returns { map, dx, dy } where (dx, dy) is where the old map now sits.
export function expandMap(old, newSize, seed = (Math.random() * 1e9) | 0) {
  const W = Math.max(newSize, old.width), H = Math.max(newSize, old.height);
  const dx = Math.floor((W - old.width) / 2), dy = Math.floor((H - old.height) / 2);
  const map = new GameMap(W, H);
  map.seed = old.seed;
  map.educationReady = old.educationReady;
  const rng = makeRng(seed);
  for (let i = 0; i < map.size; i++) map.variant[i] = (rng() * 256) | 0;
  for (let y = 0; y < old.height; y++) for (let x = 0; x < old.width; x++) {
    const a = old.idx(x, y), b = map.idx(x + dx, y + dy);
    for (const k of PERSISTENT_LAYERS) map[k][b] = old[k][a];
  }
  // New land continues the height of the nearest old edge (water is reset to 0 below).
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ox = Math.max(0, Math.min(old.width - 1, x - dx)), oy = Math.max(0, Math.min(old.height - 1, y - dy));
    if (ox !== x - dx || oy !== y - dy) map.elev[map.idx(x, y)] = old.elev[old.idx(ox, oy)];
  }
  map.heightVersion = 1;
  const inOld = (x, y) => x >= dx && y >= dy && x < dx + old.width && y < dy + old.height;

  // Rivers: continue each run of water on the old top/bottom (and left/right) edge.
  const extendWater = (runs, steps, place) => {
    for (const run of runs) {
      let offset = 0;
      for (let s = 1; s <= steps; s++) {
        if (rng() < 0.3) offset += rng() < 0.5 ? -1 : 1;
        for (const k of run) place(k + offset, s);
      }
    }
  };
  const edgeRuns = (len, isWater) => {
    const runs = []; let cur = null;
    for (let k = 0; k < len; k++) {
      if (isWater(k)) { (cur ??= []).push(k); } else if (cur) { runs.push(cur); cur = null; }
    }
    if (cur) runs.push(cur);
    return runs;
  };
  const setWater = (x, y) => { if (map.inBounds(x, y) && !inOld(x, y)) map.terrain[map.idx(x, y)] = TERRAIN.WATER; };
  const W1 = TERRAIN.WATER;
  extendWater(edgeRuns(old.width, (k) => old.terrain[old.idx(k, 0)] === W1), dy, (k, s) => setWater(k + dx, dy - s));
  extendWater(edgeRuns(old.width, (k) => old.terrain[old.idx(k, old.height - 1)] === W1), H - dy - old.height, (k, s) => setWater(k + dx, dy + old.height - 1 + s));
  extendWater(edgeRuns(old.height, (k) => old.terrain[old.idx(0, k)] === W1), dx, (k, s) => setWater(dx - s, k + dy));
  extendWater(edgeRuns(old.height, (k) => old.terrain[old.idx(old.width - 1, k)] === W1), W - dx - old.width, (k, s) => setWater(dx + old.width - 1 + s, k + dy));

  for (let i = 0; i < map.size; i++) if (map.terrain[i] === TERRAIN.WATER) map.elev[i] = 0;
  growTrees(map, rng, (i) => !inOld(i % W, (i / W) | 0));

  // Roads that ran off the old edge continue straight to the new edge (free).
  const extendRoad = (x, y, sx, sy, cls) => {
    for (x += sx, y += sy; map.inBounds(x, y) && !inOld(x, y); x += sx, y += sy) {
      const i = map.idx(x, y);
      map.type[i] = TILE.ROAD;
      map.roadClass[i] = cls;
      map.setFlag(i, FLAG.TREES, false);
    }
  };
  for (let x = 0; x < old.width; x++) {
    const top = old.idx(x, 0), bot = old.idx(x, old.height - 1);
    if (old.type[top] === TILE.ROAD) extendRoad(x + dx, dy, 0, -1, old.roadClass[top]);
    if (old.type[bot] === TILE.ROAD) extendRoad(x + dx, dy + old.height - 1, 0, 1, old.roadClass[bot]);
  }
  for (let y = 0; y < old.height; y++) {
    const left = old.idx(0, y), right = old.idx(old.width - 1, y);
    if (old.type[left] === TILE.ROAD) extendRoad(dx, y + dy, -1, 0, old.roadClass[left]);
    if (old.type[right] === TILE.ROAD) extendRoad(dx + old.width - 1, y + dy, 1, 0, old.roadClass[right]);
  }

  map.computeWaterDistance();
  map.roadsDirty = true;
  map.version = old.version + 1;
  return { map, dx, dy };
}
