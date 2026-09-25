// Overlay registry shared by the 2D view, the 3D ground texture and the UI legend.
// kind 'field'  -> smooth heatmap (bilinear-blended per-tile colours)
// kind 'roads'  -> colours road tiles only
// kind 'supply' -> per-tile utility status for buildings and lots

import { TILE, TERRAIN, SUPPLY, FLAG, isZone } from './map.js';
import { roadLoad } from './traffic.js';

const lerp = (a, b, t) => a + (b - a) * t;
function ramp(stops) {
  // stops: [[t, [r,g,b,a]], ...] sorted by t in 0..1
  return (t) => {
    t = Math.max(0, Math.min(1, t));
    for (let k = 1; k < stops.length; k++) {
      if (t <= stops[k][0]) {
        const [t0, c0] = stops[k - 1], [t1, c1] = stops[k], u = (t - t0) / (t1 - t0 || 1);
        return c0.map((v, j) => lerp(v, c1[j], u));
      }
    }
    return stops[stops.length - 1][1];
  };
}
const css = (c) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${(c[3] ?? 1).toFixed(3)})`;
const gradient = (fn) => `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => css(fn(t))).join(', ')})`;

// Soft palettes: warm coral -> butter -> sage
const goodBad = ramp([[0, [232, 122, 110, 0.62]], [0.5, [246, 214, 120, 0.55]], [1, [120, 196, 140, 0.6]]]);
const haze = ramp([[0, [170, 120, 200, 0.0]], [0.15, [170, 120, 200, 0.18]], [1, [120, 70, 160, 0.72]]]);
const dusk = ramp([[0, [140, 130, 210, 0.0]], [0.12, [140, 130, 210, 0.2]], [0.5, [150, 120, 205, 0.5]], [1, [200, 90, 130, 0.72]]]);
const ember = ramp([[0, [245, 170, 100, 0.0]], [0.12, [245, 190, 110, 0.22]], [0.5, [242, 150, 90, 0.5]], [1, [226, 96, 80, 0.75]]]);
const cover = ramp([[0, [120, 190, 210, 0.0]], [0.1, [120, 190, 210, 0.2]], [1, [60, 150, 190, 0.65]]]);

const isLand = (map, i) => map.terrain[i] !== TERRAIN.WATER || map.type[i] === TILE.ROAD;
// Buildings and lots that sit on a road (others can't be served, so they stay neutral).
function consumer(map, i) {
  if (!isZone(map.type[i]) && map.type[i] !== TILE.SERVICE) return false;
  const x = i % map.width, y = (i / map.width) | 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (map.inBounds(x + dx, y + dy) && map.type[map.idx(x + dx, y + dy)] === TILE.ROAD) return true;
  }
  return false;
}

function supplyColors(ok) {
  return {
    [SUPPLY.OK]: ok,
    [SUPPLY.SHORT]: [240, 170, 90, 0.7],
    [SUPPLY.NONE]: [232, 122, 110, 0.6],
  };
}

export const OVERLAYS = {
  landValue: {
    label: 'Land value', key: 'l', kind: 'field',
    value: (map, i) => (isLand(map, i) ? map.landValue[i] : null),
    color: (v) => goodBad(v / 100),
    legend: { gradient: gradient(goodBad), labels: ['low', 'medium', 'high'] },
    hint: 'Parks, water, schools and shops raise it; pollution, traffic noise and blight lower it. Homes need 40 for medium and 62 for high density.',
  },
  pollution: {
    label: 'Pollution', key: 'p', kind: 'field',
    value: (map, i) => (isLand(map, i) ? map.pollution[i] : null),
    color: (v) => haze(v / 80),
    legend: { gradient: gradient(haze), labels: ['clean', 'hazy', 'heavy'] },
    hint: 'Industry, coal plants and busy roads pollute. Parks, trees and recycling centers clean the air.',
  },
  happiness: {
    label: 'Happiness', key: 'h', kind: 'field',
    value: (map, i) => (isLand(map, i) && map.type[i] !== TILE.ROAD ? map.happiness[i] : null),
    color: (v) => goodBad(v / 100),
    legend: { gradient: gradient(goodBad), labels: ['unhappy', 'okay', 'happy'] },
    hint: 'Schools, clinics, plazas, land value and short commutes make residents happy; pollution and missing utilities don\'t.',
  },
  services: {
    label: 'Services', kind: 'field',
    value: (map, i) => (isLand(map, i) ? Math.max(map.coverage.school[i], map.coverage.clinic[i]) * 100 : null),
    color: (v) => cover(v / 100),
    legend: { gradient: gradient(cover), labels: ['none', 'some', 'full'] },
    hint: 'Coverage from schools and clinics (strongest of the two). Hover a tile for each one.',
  },
  crime: {
    label: 'Crime', key: 'c', kind: 'field',
    value: (map, i) => (isLand(map, i) ? map.crime[i] : null),
    color: (v) => dusk(v / 60),
    legend: { gradient: gradient(dusk), labels: ['safe', 'uneasy', 'rough'] },
    hint: 'Dense, run-down and jobless areas attract crime. Police stations cut it by up to 85% within 10 tiles.',
  },
  fireRisk: {
    label: 'Fire risk', key: 'f', kind: 'field',
    value: (map, i) => (isLand(map, i) ? map.fireRisk[i] : null),
    color: (v, map, i) => (map.hasFlag(i, FLAG.FIRE) ? [230, 80, 60, 0.85] : ember(v / 40)),
    legend: { gradient: gradient(ember), labels: ['low', 'medium', 'high'] },
    hint: 'Dense buildings, industry and coal plants catch fire most. Fire stations cut the risk and put fires out within 10 tiles.',
  },
  traffic: {
    label: 'Traffic', key: 't', kind: 'roads',
    value: (map, i) => (map.type[i] === TILE.ROAD ? roadLoad(map, i) * 100 : null),
    color: (v, map, i) => (map.traffic[i] < 0.5 ? [205, 210, 216, 0.6] : v < 50 ? [120, 196, 140, 0.85] : v < 100 ? [246, 206, 110, 0.9] : v < 160 ? [240, 150, 90, 0.92] : [226, 100, 96, 0.92]),
    legend: { gradient: 'linear-gradient(90deg, rgb(120,196,140) 0 33%, rgb(246,206,110) 33% 66%, rgb(226,100,96) 66%)', labels: ['free', 'busy', 'jammed'] },
    hint: 'Share of each road\'s capacity in use. Upgrade busy roads with the Upgrade tool (9).',
    unit: '%',
  },
  power: {
    label: 'Power', kind: 'supply',
    value: (map, i) => (consumer(map, i) ? map.power[i] : null),
    color: (v) => supplyColors([250, 210, 90, 0.7])[v],
    legend: { swatches: [['#fad25a', 'powered'], ['#f0aa5a', 'shortage'], ['#e87a6e', 'no power']] },
    hint: 'Power travels along roads from plants. Buildings need it to reach medium density.',
    format: (v) => ['none', 'shortage', 'powered'][v],
  },
  water: {
    label: 'Water', kind: 'supply',
    value: (map, i) => (consumer(map, i) ? map.water[i] : null),
    color: (v) => supplyColors([110, 180, 235, 0.7])[v],
    legend: { swatches: [['#6eb4eb', 'water'], ['#f0aa5a', 'shortage'], ['#e87a6e', 'no water']] },
    hint: 'Pumps near rivers produce the most. Buildings need water to reach high density.',
    format: (v) => ['none', 'shortage', 'running'][v],
  },
};

export const OVERLAY_ORDER = ['landValue', 'pollution', 'happiness', 'services', 'crime', 'fireRisk', 'traffic', 'power', 'water'];

// Draw an overlay into a 2D context whose transform maps 1 tile to `ts` units.
const offscreen = typeof document !== 'undefined' ? document.createElement('canvas') : null;
export function drawOverlay(ctx, map, key, ts, x0 = 0, y0 = 0, x1 = map.width - 1, y1 = map.height - 1) {
  const o = OVERLAYS[key];
  if (!o) return;
  if (o.kind === 'field') {
    // One pixel per tile, scaled up with smoothing -> a soft heatmap.
    const w = map.width, h = map.height;
    if (offscreen.width !== w || offscreen.height !== h) { offscreen.width = w; offscreen.height = h; }
    const octx = offscreen.getContext('2d');
    const img = octx.createImageData(w, h), d = img.data;
    for (let i = 0; i < map.size; i++) {
      const v = o.value(map, i);
      if (v == null) continue;
      const c = o.color(v, map, i);
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = (c[3] ?? 1) * 255;
    }
    octx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(offscreen, 0, 0, w, h, 0, 0, w * ts, h * ts);
    ctx.restore();
    return;
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = map.idx(x, y), v = o.value(map, i);
    if (v == null) { if (o.kind === 'roads') { ctx.fillStyle = 'rgba(245,247,250,0.35)'; ctx.fillRect(x * ts, y * ts, ts, ts); } continue; }
    ctx.fillStyle = css(o.color(v, map, i));
    roundRect(ctx, x * ts + ts * 0.06, y * ts + ts * 0.06, ts * 0.88, ts * 0.88, ts * 0.2);
    ctx.fill();
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

export function overlayValueText(key, map, i) {
  const o = OVERLAYS[key], v = o?.value(map, i);
  if (v == null) return '—';
  if (o.format) return o.format(v);
  return `${Math.round(v)}${o.unit ?? ''}`;
}
