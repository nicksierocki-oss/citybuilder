// Map data model: a fixed grid stored as flat typed-array layers.
// Adding a system later (power, water, traffic) = adding a layer here.

import { CONFIG } from './config.js';

export const TERRAIN = { GRASS: 0, WATER: 1 };
export const TILE = { EMPTY: 0, ROAD: 1, RES: 2, COM: 3, IND: 4, PARK: 5 };
export const ZONE_NAMES = ['Empty', 'Road', 'Residential', 'Commercial', 'Industrial', 'Park'];
export const FLAG = { TREES: 1, ABANDONED: 2 };

export function isZone(type) {
  return type === TILE.RES || type === TILE.COM || type === TILE.IND;
}

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
    // Derived layers (recomputed by the simulation)
    this.pollution = new Float32Array(n);
    this.landValue = new Float32Array(n);
    this.roadDist = new Int32Array(n);  // road tiles to the map edge, -1 = not connected
    this.shoppers = new Float32Array(n);// residents within shopping radius
    this.waterDist = new Float32Array(n);
    this.roadsDirty = true;
  }

  idx(x, y) { return y * this.width + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.width && y < this.height; }

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
      if (this.type[j] === TILE.ROAD && this.roadDist[j] >= 0) return true;
    }
    return false;
  }

  // Shortest road distance to the edge among adjacent roads (for freight), -1 if none.
  accessRoadDist(i) {
    const x = i % this.width, y = (i / this.width) | 0;
    let best = -1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!this.inBounds(nx, ny)) continue;
      const j = this.idx(nx, ny);
      if (this.type[j] === TILE.ROAD && this.roadDist[j] >= 0) {
        if (best < 0 || this.roadDist[j] < best) best = this.roadDist[j];
      }
    }
    return best;
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

export function generateMap(seed = (Math.random() * 1e9) | 0) {
  const { width, height, treeChance, riverWidth, highwayRow, highwayLength } = CONFIG.map;
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

  // Trees: seed clumps, then grow them a little.
  for (let i = 0; i < map.size; i++) {
    if (map.terrain[i] === TERRAIN.GRASS && rng() < treeChance * 0.35) map.setFlag(i, FLAG.TREES, true);
  }
  for (let pass = 0; pass < 2; pass++) {
    const snapshot = map.flags.slice();
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = map.idx(x, y);
      if (map.terrain[i] !== TERRAIN.GRASS) continue;
      let n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (map.inBounds(x + dx, y + dy) && (snapshot[map.idx(x + dx, y + dy)] & FLAG.TREES)) n++;
      }
      if (n > 0 && rng() < treeChance * n * 0.9) map.setFlag(i, FLAG.TREES, true);
    }
  }

  // Regional highway entering from the west edge — the city's link to the world.
  for (let x = 0; x < highwayLength; x++) {
    const i = map.idx(x, highwayRow);
    map.type[i] = TILE.ROAD;
    map.setFlag(i, FLAG.TREES, false);
  }
  // Keep the area around the highway end clear so the first blocks are easy.
  for (let y = highwayRow - 3; y <= highwayRow + 3; y++) {
    for (let x = 0; x < highwayLength + 3; x++) {
      if (map.inBounds(x, y) && rng() < 0.8) map.setFlag(map.idx(x, y), FLAG.TREES, false);
    }
  }

  map.computeWaterDistance();
  map.roadsDirty = true;
  return map;
}
