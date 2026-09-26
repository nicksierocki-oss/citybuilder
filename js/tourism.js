// @ts-check
// Tourism, airports and seaports. Attractions and monuments draw visitors; the ways into the
// city (road links, trains, flights, cruise ships) cap how many can come. Visitors buy tickets,
// stay in hotels and shop. Airports and seaports also carry cargo and business travellers.
// Pure simulation, no DOM.

import { CONFIG } from './config.js';
import { TILE, TERRAIN, KINDS, FLAG, footprintSize } from './map.js';
import { funding, fundingStrength } from './services.js';
import { regionInfo } from './region.js';
import { railExits } from './transit.js';
import { ordinance } from './cityhall.js';

// Building kinds that draw visitors of their own (tickets), and the monuments among them.
export const ATTRACTION_KINDS = Object.keys(CONFIG.buildings).filter((k) => CONFIG.buildings[k].attraction);
export const MONUMENT_KINDS = ATTRACTION_KINDS.filter((k) => CONFIG.buildings[k].unlockLevel);
export const HUB_KINDS = ['airport', 'seaport'];

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Tiles of the footprint of a `kind` building anchored (top-left) at tile a.
function footprint(map, kind, a) {
  const [w, h] = footprintSize(kind), out = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push(a + dx + dy * map.width);
  return out;
}

// Tiles just outside a footprint (4-neighbours of its tiles that aren't part of it).
function rim(map, tiles) {
  const inside = new Set(tiles), out = new Set();
  for (const i of tiles) {
    const x = i % map.width, y = (i / map.width) | 0;
    for (const [dx, dy] of DIRS) {
      if (!map.inBounds(x + dx, y + dy)) continue;
      const j = map.idx(x + dx, y + dy);
      if (!inside.has(j)) out.add(j);
    }
  }
  return [...out];
}

// Why a big building can't go on `tiles` (its footprint), or null if the site suits it. Only the
// special rules: flat ground, a shore, water nearby. (Clear land is checked by toolCost.)
export function placementProblem(state, kind, tiles) {
  const map = state.map, B = CONFIG.buildings[kind];
  if (B.flat && tiles.some((i) => map.slope(i) > 0)) return 'needs flat ground: level it with Raise/Lower land';
  if (B.shore && rim(map, tiles).filter((j) => map.terrain[j] === TERRAIN.WATER).length < B.shore) return `must sit on the shore, with at least ${B.shore} water tiles along its edge`;
  if (B.nearWater && !tiles.some((i) => map.waterDist[i] <= B.nearWater)) return `must be within ${B.nearWater} tiles of water`;
  return null;
}

// Does the building anchored at a have a connected street or avenue beside it?
export function hubConnected(map, kind, a) {
  return rim(map, footprint(map, kind, a)).some((j) => map.isLocalRoad(j) && map.roadDist[j] >= 0);
}

// Road tiles beside working seaports: freight trucks can deliver there instead of the map edge.
// Cached per map version.
export function portRoads(map) {
  const c = map._portRoads;
  if (c && c.version === map.version && c.size === map.size && c.dirty === map.roadsDirty) return c.roads;
  const roads = [];
  for (let i = 0; i < map.size; i++) {
    if (map.type[i] !== TILE.SERVICE || map.part[i] || KINDS[map.kind[i]] !== 'seaport') continue;
    for (const j of rim(map, footprint(map, 'seaport', i))) if (map.isLocalRoad(j)) roads.push(j);
  }
  map._portRoads = { version: map.version, size: map.size, dirty: map.roadsDirty, roads };
  return roads;
}

// Monthly-ish: count what draws visitors and how many can get here, then the money they bring.
export function tourismSystem(state) {
  const map = state.map, T = CONFIG.tourism, B = CONFIG.buildings, pop = state.stats?.population ?? 0;
  const draws = {}, hubs = { airport: 0, seaport: 0, idle: 0 };
  let prestige = 0;
  for (let i = 0; i < map.size; i++) {
    if (map.type[i] !== TILE.SERVICE || map.part[i]) continue;
    const k = KINDS[map.kind[i]], D = B[k];
    if (!D) continue;
    if (HUB_KINDS.includes(k)) {
      if (hubConnected(map, k, i)) hubs[k] += fundingStrength(funding(state, k)); else hubs.idle++;
      continue;
    }
    if (D.attraction) {
      if (!hubConnected(map, k, i)) continue; // visitors need a way in
      draws[k] = (draws[k] ?? 0) + D.attraction * fundingStrength(funding(state, k));
      prestige += D.prestige ?? 0;
    } else if (k === 'stadium') draws[k] = (draws[k] ?? 0) + T.stadiumDraw;
    else if (k === 'centralpark') draws[k] = (draws[k] ?? 0) + T.parkDraw;
  }
  const draw = Object.values(draws).reduce((a, b) => a + b, 0);
  const popFactor = T.popMin + (1 - T.popMin) * Math.min(1, pop / T.popFull);
  const mood = 0.7 + 0.6 * Math.max(0, Math.min(100, state.happiness ?? 50)) / 100;
  const wanted = draw * popFactor * mood * (ordinance(state, 'tourism') ? CONFIG.ordinances.tourism.visitorMult : 1);
  // Ways in, each with room for so many visitors a month.
  const caps = {
    road: regionInfo(state).weight * T.roadPerWeight,
    rail: railExits(state) * T.railPerLink,
    air: hubs.airport * B.airport.passengers,
    sea: hubs.seaport * B.seaport.cruise,
  };
  const room = caps.road + caps.rail + caps.air + caps.sea;
  const visitors = Math.min(wanted, room);
  const byMode = Object.fromEntries(Object.entries(caps).map(([m, c]) => [m, room > 0 ? Math.round(visitors * c / room) : 0]));
  // Money: tickets at each attraction, hotel stays, fees at the airport and the port.
  let tickets = 0;
  for (const [k, d] of Object.entries(draws)) tickets += visitors * (d / Math.max(1, draw)) * (B[k].ticket ?? 0);
  let beds = 0;
  for (let i = 0; i < map.size; i++) if (map.type[i] === TILE.COM && map.hasFlag(i, FLAG.HOTEL) && !map.hasFlag(i, FLAG.ABANDONED)) beds += T.bedsPerHotel[map.level[i]];
  const staying = Math.min(visitors * T.staying, beds);
  const flyers = hubs.airport > 0 ? Math.min(hubs.airport * B.airport.passengers, pop * T.residentFlyers + byMode.air) : 0;
  const freight = state.traffic?.freightTrips ?? 0;
  const cargo = Math.min(hubs.seaport * B.seaport.cargo, freight * (hubs.seaport > 0 ? 1 : 0));
  state.tourism = {
    visitors: Math.round(visitors), wanted: Math.round(wanted), room: Math.round(room), draw: Math.round(draw), draws,
    caps, byMode, beds, staying: Math.round(staying), flyers: Math.round(flyers), cargo: Math.round(cargo),
    airports: hubs.airport, seaports: hubs.seaport, idleHubs: hubs.idle,
    prestige: Math.min(T.maxPrestige, prestige),
    income: {
      tickets: Math.round(tickets),
      stays: Math.round(staying * T.staySpend),
      airport: Math.round(flyers * B.airport.fee),
      port: Math.round(cargo * B.seaport.cargoFee + byMode.sea * B.seaport.fee),
    },
  };
}

// Extra industrial export demand and office demand from working airports and seaports.
export function hubExports(state) {
  const t = state.tourism, B = CONFIG.buildings;
  return t ? t.airports * B.airport.exports + t.seaports * B.seaport.exports : 0;
}
export function hubOffices(state) {
  return (state.tourism?.airports ?? 0) * CONFIG.buildings.airport.offices;
}

// Monthly income from tourism and the hubs (all 0 until something draws visitors or a hub runs).
export function tourismMoney(state) {
  const m = state.tourism?.income;
  return m ? m.tickets + m.stays + m.airport + m.port : 0;
}
