// @ts-check
// City hall: ordinances (city-wide policies with a monthly cost) and the mayor rating.
// Pure simulation, no DOM.

import { CONFIG } from './config.js';

export const ORDINANCE_ORDER = ['recycling', 'freeTransit', 'watch', 'smoke', 'tourism', 'carFree'];

// Is ordinance k in force? (Callers use this so a missing state.ordinances is safe.)
export function ordinance(state, k) {
  return !!state.ordinances?.[k];
}

export function ordinanceCost(state, k) {
  const O = CONFIG.ordinances[k];
  return O.base + O.perResident * (state.stats?.population ?? 0);
}

export function ordinancesCost(state) {
  let total = 0;
  for (const k of ORDINANCE_ORDER) if (ordinance(state, k)) total += ordinanceCost(state, k);
  return total;
}

// What the rating would move toward right now, with each part (0..100) for the UI.
export function ratingParts(state) {
  const s = state.stats, tr = state.traffic ?? {}, lm = state.lastMonth;
  const pop = s?.population ?? 0;
  if (!pop) return null;
  const clamp = (v) => Math.max(0, Math.min(100, v));
  const net = lm?.net ?? 0;
  const budget = state.funds < 0 ? 5
    : clamp(55 + Math.max(-45, Math.min(35, net / Math.max(1, pop) * 60)) - (state.loans?.length ?? 0) * 8);
  const parts = {
    happiness: clamp(state.happiness),
    budget,
    safety: clamp(100 - state.crime * 2.5 - (state.fires ?? 0) * 5),
    commute: clamp(100 - Math.max(0, (tr.avgCommute ?? 0) - 12) * 3.5),
    jobs: clamp(tr.workers > 0 ? tr.employed / tr.workers * 100 : 100),
  };
  let target = 0;
  for (const [k, w] of Object.entries(CONFIG.mayor.weights)) target += parts[k] * w;
  const prestige = state.tourism?.prestige ?? 0; // monuments make the city proud
  target = Math.min(100, target + prestige);
  return { parts, target, prestige };
}

// Monthly: the rating drifts toward its target; January pays a grant if it's high;
// a high rating unlocks the statue, a low one brings protests (see news.js).
export function mayorSystem(state) {
  if (state.tick % CONFIG.time.ticksPerMonth !== 0) return;
  const M = CONFIG.mayor, r = ratingParts(state);
  if (state.rating == null) state.rating = M.start;
  if (!r) return;
  state.rating += (r.target - state.rating) * M.smoothing;
  const pop = state.stats.population;
  if (state.month === 0 && state.rating >= M.grantRating && pop > 0) {
    const grant = Math.round(Math.min(M.grantMax, pop * M.grantPerResident));
    state.funds += grant;
    state.lastGrant = state.tick;
    state.events.push({ text: `The council is pleased (rating ${Math.round(state.rating)}): a grant of $${grant.toLocaleString()}!`, kind: 'good' });
  }
  if (state.rating >= M.statueRating && !state.milestones.includes('unlock:statue')) {
    state.milestones.push('unlock:statue');
    state.events.push({ text: "Your rating is sky-high: the Mayor's statue is unlocked in Landmarks!", kind: 'good' });
  }
}

export function ratingWord(r) {
  return r >= 80 ? 'beloved' : r >= 65 ? 'popular' : r >= 50 ? 'steady' : r >= 35 ? 'shaky' : 'unpopular';
}
