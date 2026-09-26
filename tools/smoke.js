// Browser smoke test: loads the game in headless Chromium and drives it like a player.
// Run: node tools/smoke.js   (needs `npm install`; exits non-zero on failure)

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

// Tiny static server so the test needs nothing but Node.
const server = http.createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (!path || path === '.') path = 'index.html';
  if (path.startsWith('..')) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
// External fonts are optional; don't let a blocked network fail the test.
await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());

let failed = 0;
async function step(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (err) { failed++; console.log(`FAIL ${name}: ${err.message}`); }
}
const check = (cond, msg) => { if (!cond) throw new Error(msg); };
const game = (fn, arg) => page.evaluate(fn, arg);

await page.goto(url);
await page.waitForFunction(() => window.gridline?.state);

// Screen position of a tile in the 2D view.
async function tilePos(x, y) {
  const box = await page.locator('#game').boundingBox();
  const p = await game(([x, y]) => window.gridline.renderer.tileToScreen(x - 0.5, y - 0.5) /* returns the far corner */, [x, y]);
  return { x: box.x + p.x, y: box.y + p.y };
}

await step('page loads without errors', async () => {
  check(errors.length === 0, errors.join(' | '));
});

await step('drag a street, then undo it', async () => {
  const { x, y } = await game(() => { const g = window.gridline, m = g.state.map;
    // Find an empty grass tile with 3 more to its right.
    for (let y = 5; y < m.height - 5; y++) for (let x = 5; x < m.width - 8; x++) {
      let ok = true;
      for (let k = 0; k < 4; k++) { const i = m.idx(x + k, y); if (m.type[i] || m.terrain[i]) ok = false; }
      if (ok) { g.renderer.centerOn(m, x + 2, y); return { x, y }; }
    }
    return null;
  });
  await page.keyboard.press('1');
  const funds0 = await game(() => window.gridline.state.funds);
  const a = await tilePos(x, y), b = await tilePos(x + 3, y);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
  const built = await game(([x, y]) => { const m = window.gridline.state.map; return m.type[m.idx(x, y)] === 1 && m.type[m.idx(x + 3, y)] === 1; }, [x, y]);
  check(built, 'road was not built');
  check(await game(() => window.gridline.state.funds) < funds0, 'road cost nothing');
  await page.keyboard.press('Control+z');
  check(await game(([x, y]) => window.gridline.state.map.type[window.gridline.state.map.idx(x, y)] === 0, [x, y]), 'undo did not remove road');
  check(await game(() => window.gridline.state.funds) === funds0, 'undo did not refund');
});

await step('bus stops link into a route by themselves', async () => {
  const ok = await game(async () => {
    const g = window.gridline, s = g.state, m = s.map;
    // Build with the game's own tool code: a street, homes one side, industry further on, two stops.
    const { applyTool } = await import('/js/economy.js');
    let row = -1, x0 = -1;
    for (let y = 8; y < m.height - 8 && row < 0; y++) for (let x = 4; x < m.width - 36; x++) {
      let clear = true;
      for (let dy = -3; dy <= 3 && clear; dy++) for (let k = 0; k < 32; k++) { const i = m.idx(x + k, y + dy); if (m.type[i] || m.terrain[i] || m.elev[i]) { clear = false; break; } }
      if (clear) { row = y; x0 = x; break; }
    }
    if (row < 0) return 'no room';
    s.funds = 1e6;
    const t = (x1, x2, y1, y2) => { const o = []; for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) o.push(m.idx(x, y)); return o; };
    applyTool(s, 'road', t(x0, x0 + 31, row, row));
    applyTool(s, 'residential', t(x0, x0 + 10, row - 3, row - 1));
    applyTool(s, 'industrial', t(x0 + 20, x0 + 31, row + 1, row + 3));
    applyTool(s, 'bus', [m.idx(x0 + 4, row + 1)]);
    applyTool(s, 'bus', [m.idx(x0 + 25, row - 1)]);
    g.refresh();
    return s.lines.length;
  });
  check(ok === 1, `expected one route, got ${ok}`);
  await page.waitForFunction(() => /Route 1/.test(document.getElementById('lineList').textContent), null, { timeout: 5000 });
});

await step('clicking beside the map builds nothing', async () => {
  const v = await game(() => window.gridline.state.map.version);
  const box = await page.locator('#game').boundingBox();
  await game(() => { const g = window.gridline; g.renderer.centerOn(g.state.map, 0, 0); });
  await page.mouse.click(box.x + 20, box.y + 20);
  check(await game(() => window.gridline.state.map.version) === v, 'map changed');
});

await step('simulation advances at top speed', async () => {
  const m0 = await game(() => window.gridline.state.tick);
  await game(() => window.gridline.setSpeed(3));
  // Headless Chromium on a software renderer can draw only a few frames a second: allow time.
  await page.waitForFunction((t) => window.gridline.state.tick > t + 5, m0, { timeout: 20000 });
  await game(() => window.gridline.setSpeed(0));
});

await step('save to file and load it back', async () => {
  await page.click('#btnMenu');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnSave')]);
  const file = await dl.path();
  const funds = await game(() => window.gridline.state.funds);
  await game(() => { window.gridline.state.funds = 1; });
  await page.setInputFiles('#fileInput', file);
  await page.waitForFunction((f) => window.gridline.state.funds === f, funds, { timeout: 5000 });
});

await step('loading a broken file shows an error, keeps the city', async () => {
  const funds = await game(() => window.gridline.state.funds);
  await page.setInputFiles('#fileInput', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"game":"gridline","map":{"width":-1}}') });
  await page.waitForFunction(() => /Could not load/.test(document.getElementById('toasts').textContent), null, { timeout: 5000 });
  check(await game(() => window.gridline.state.funds) === funds, 'city was replaced');
});

await step('starting a new city keeps the old one to restore', async () => {
  const name = await game(() => { window.gridline.state.cityName = 'Smoketown'; return window.gridline.state.cityName; });
  await game(() => window.gridline.newCity(64));
  check(await game(() => window.gridline.state.cityName) !== name, 'new city has the old name');
  await page.click('#btnMenu');
  check(await page.isVisible('#btnRestore'), 'restore button hidden');
  await page.click('#btnRestore');
  await page.click('#modalOk');
  await page.waitForFunction((n) => window.gridline.state.cityName === n, name, { timeout: 5000 });
});

await step('3D view loads', async () => {
  await page.keyboard.press('v');
  await page.waitForFunction(() => window.gridline.renderer === window.gridline.renderer3d, null, { timeout: 20000 });
  await page.waitForTimeout(1000);
});

await step('no errors during the session', async () => {
  check(errors.length === 0, errors.join(' | '));
});

await browser.close();
server.close();
if (failed) { console.log(`\n${failed} step(s) failed`); process.exit(1); }
console.log('\nsmoke test passed');
