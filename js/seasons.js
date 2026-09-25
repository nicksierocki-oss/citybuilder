// Seasons and time of day for the renderers. Pure functions, no DOM.
// The season follows the in-game month; the time of day follows the animation clock
// (it runs only while the game does, faster at higher speeds).

import { CONFIG } from './config.js';

export const SEASON_NAMES = ['Winter', 'Spring', 'Summer', 'Autumn'];

// Key colours at the middle of each season: winter, spring, summer, autumn.
const KEYS = {
  grass: [
    ['#eef2f5', '#e9eef2', '#f2f5f8', '#e6ecf0'],
    ['#dcf0c8', '#d6edc1', '#e0f2ce', '#d2eabc'],
    ['#e2f0d3', '#deedcd', '#e5f2d8', '#dbebc9'],
    ['#eeebcf', '#eae5c6', '#f1edd6', '#e6e0c0'],
  ],
  tree: [
    ['#c6d6ce', '#d2ddd8', '#bccdc4'],
    ['#b3dc9b', '#c2e2a6', '#f0cad8'],
    ['#a9d39a', '#9ecc8e', '#b3daa5'],
    ['#ecb77a', '#e59f6e', '#e8cd7a'],
  ],
  park: ['#e4ebee', '#c6e8b2', '#c9e6b8', '#e2dfb6'],
  water: ['#b9dcef', '#a6d6ee', '#a6d6ee', '#a9d3e8'],
};

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toHex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
export function mix(a, b, t) {
  const A = hex(a), B = hex(b);
  return toHex(A.map((v, k) => v + (B[k] - v) * t));
}
const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// Season index (0 winter .. 3 autumn) for a month (0 = Jan).
export function seasonOf(month) {
  return month === 11 || month < 2 ? 0 : month < 5 ? 1 : month < 8 ? 2 : 3;
}

// Palette for a point in the year. `monthF` is the month with a fraction (0..12).
// Seasons hold steady mid-season and blend in the weeks around the change.
export function seasonPalette(monthF) {
  // Season centres: mid-Jan (0.5), mid-Apr (3.5), mid-Jul (6.5), mid-Oct (9.5).
  const pos = (((monthF - 0.5) % 12) + 12) % 12 / 3;
  const k = Math.floor(pos) % 4, n = (k + 1) % 4, t = smooth(0.45, 1, pos - Math.floor(pos));
  const blend = (arr) => arr[k].map((c, j) => mix(c, arr[n][j], t));
  return {
    season: seasonOf(Math.floor(monthF) % 12),
    grass: blend(KEYS.grass),
    tree: blend(KEYS.tree),
    park: mix(KEYS.park[k], KEYS.park[n], t),
    water: mix(KEYS.water[k], KEYS.water[n], t),
    // Snow on roofs and ground in winter (0..1).
    snow: k === 0 ? 1 - t : n === 0 ? t : 0,
    blossom: k === 1 ? 1 - t : n === 1 ? t : 0,
  };
}

// The clock runs faster at night: 06:00–20:00 takes DAY_SHARE of each cycle.
const DAY_SHARE = 0.75;
const hourAt = (u) => (u < DAY_SHARE ? 6 + 14 * u / DAY_SHARE : (20 + 10 * (u - DAY_SHARE) / (1 - DAY_SHARE)) % 24);
const cycleAt = (hour) => { const h = (hour + 18) % 24; return h < 14 ? h / 14 * DAY_SHARE : DAY_SHARE + (h - 14) / 10 * (1 - DAY_SHARE); };

// Time of day from the animation clock: hour 0..24, sun height -1..1 and how dark it is (0..1).
export function timeOfDay(animTime, enabled = true) {
  const V = CONFIG.visuals;
  if (!enabled) return { hour: 12, sun: 1, night: 0, dusk: 0 };
  const u = (((animTime / V.dayLengthSec) + cycleAt(V.startHour)) % 1 + 1) % 1;
  const hour = hourAt(u), phase = hour / 24;
  const sun = Math.sin((phase - 0.25) * Math.PI * 2); // 1 at noon, -1 at midnight
  const night = 1 - smooth(-0.45, -0.05, sun); // twilight lingers a little past sunset
  // Warm light around sunrise and sunset.
  const dusk = Math.max(0, 1 - Math.abs(sun + 0.1) / 0.35) * (1 - night * 0.7);
  return { hour, sun, night, dusk };
}

// Combined environment the renderers read each frame.
// With seasons off the city stays in its summer colours.
export function environment(state, animTime, dayNight = true, seasons = true) {
  const frac = (state.tick % CONFIG.time.ticksPerMonth) / CONFIG.time.ticksPerMonth;
  return { ...seasonPalette(seasons ? state.month + frac : 6.5), ...timeOfDay(animTime, dayNight) };
}

export function clockText(hour) {
  const h = Math.floor(hour), m = Math.floor((hour - h) * 60 / 10) * 10;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
