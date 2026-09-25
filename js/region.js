// The region around the city: neighbouring towns on each map edge a road leaves from, how
// much those connections can carry, and the trade deals with them. Pure simulation, no DOM.

import { CONFIG } from './config.js';
import { TILE, makeRng } from './map.js';
import { railNetwork } from './transit.js';

const SIDES = ['N', 'E', 'S', 'W'];
const SIDE_NAMES = { N: 'north', E: 'east', S: 'south', W: 'west' };

// Edge connections per side: { N: { weight, exits }, ... } where weight sums the road classes
// (street 1, avenue 2, highway 4) of road tiles on that edge. Cached per map version.
export function regionInfo(state) {
  const map = state.map;
  if (map._region && map._region.version === map.version && map._region.w === map.width) return map._region;
  const R = CONFIG.region, sides = Object.fromEntries(SIDES.map((s) => [s, { weight: 0, exits: 0 }]));
  const rail = railNetwork(state);
  const add = (i, side) => {
    if (map.rail[i] && rail.comps[rail.comp[i]]?.stations.length) { sides[side].weight += CONFIG.rail.linkWeight; sides[side].rails = (sides[side].rails ?? 0) + 1; }
    if (map.type[i] !== TILE.ROAD) return;
    sides[side].weight += R.exitWeight[map.roadClass[i]];
    sides[side].exits++;
  };
  for (let x = 0; x < map.width; x++) { add(map.idx(x, 0), 'N'); add(map.idx(x, map.height - 1), 'S'); }
  for (let y = 1; y < map.height - 1; y++) { add(map.idx(0, y), 'W'); add(map.idx(map.width - 1, y), 'E'); }
  const rng = makeRng((map.seed ?? 1) * 31 + 7), names = [...R.names];
  for (let k = names.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [names[k], names[j]] = [names[j], names[k]]; }
  const neighbours = SIDES.map((s, k) => ({ side: s, dir: SIDE_NAMES[s], name: names[k], ...sides[s] }));
  const weight = neighbours.reduce((a, n) => a + n.weight, 0);
  map._region = { version: map.version, w: map.width, neighbours, weight, tradeCap: weight * R.tradeCapPerWeight };
  return map._region;
}

// Industrial export demand from the region: grows with the size of the road links out.
export function exportDemand(state) {
  return regionInfo(state).weight * CONFIG.region.exportPerWeight;
}

// Money from utility trade last computed by utilitySystem (per month).
export function tradeMoney(state) {
  const R = CONFIG.region, t = state.trade ?? {};
  let income = 0, cost = 0;
  for (const res of ['power', 'water']) {
    income += (t[res]?.exported ?? 0) * R.sellPrice[res];
    cost += (t[res]?.imported ?? 0) * R.buyPrice[res];
  }
  return { income, cost };
}
