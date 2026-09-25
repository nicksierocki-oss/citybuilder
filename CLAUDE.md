# Gridline: notes for Claude

Browser city builder. Plain HTML/CSS/JS ES modules on canvas, no build step. The optional 3D
view uses Three.js vendored in `vendor/three/`. Live at
https://nicksierocki-oss.github.io/citybuilder/. Every push to the working branch
redeploys via `.github/workflows/pages.yml`.

## Start of a new session

The owner plans features from the **Roadmap** below. At the start of a session, show the
roadmap and ask which items to build (or take the one they name). When an item ships,
move it to **Done** with a one-line note.

## Roadmap (build in phase order)

We're in app-development mode (gameplay first, not distribution).

**Phase A (the game loop) is done** (see Done). Next up: Phase B.

**Phase B: economic depth**
4. **Service budgets, hospital, garbage.** Funding sliders per service (scale coverage and upkeep);
   hospital landmark and a `health` layer; trash, landfill and a Garbage overlay.
5. **Specialised zones.** Offices (skilled, clean, high tax), farms, tourism/hotels, mixed-use.
6. **Neighbouring cities and trade.** Sell or buy power and water at edge connections; exports
   grow with highway exits; a Region panel.

**Phase C: living systems**
7. **Weather and disasters.** Floods (levee tool), heatwaves, winter storms, rare tornadoes;
   rain and snow particles; Disasters off / mild / full.
8. **Transit 2.0.** Drawn bus lines with frequency and cost, buses on the roads, a lines panel;
   then tram and rail tracks and a regional train station.

**Phase D: engine-level (own branch each, extra save-compatibility testing)**
9. **Road tools 2.0.** One-way streets, roundabouts, parking; diagonal roads last.
10. **Terrain.** Height layer, hills and coastline maps, slope costs, terraforming.

## Done (recent)

- Phase A: goals (tutorial then career chain, cash rewards), four scenarios with deadlines and
  banned tools (`js/goals.js`, seeded setup), achievements (per browser), city news (`js/news.js`,
  own RNG so it never changes the sim), ordinances and mayor rating (`js/cityhall.js`), Mayor's
  statue, early loan repayment. UI in `js/cityhall-ui.js`. Scenario playtests in `tools/playtest.js`
  (`QUICK=1` skips them); the scripted players are modest, so not every scenario is won by script.

- Seasons (palette blends by month; snow on roofs) and a day/night cycle (lamps, lit windows,
  headlights, floodlights; toggle under City menu) in 2D and 3D. `js/seasons.js`.
- Education: skilled share per home (persistent `education` layer), skilled posts per job,
  high-tech industry (`FLAG.HIGHTECH`), Education overlay, tax bonus.
- Districts with height limit / no heavy industry / tax break (`district` layer, sidebar panel,
  labels, overlay).
- Landmarks: town park, central park, university, stadium; multi-tile via the `part` layer;
  unlock by population; stadium ticket income.
- History graphs (`js/graphs.js`, `state.history`), plus undo, mini-map, line/circle brushes
  and city naming.

- Public transit (bus stops, metro stations), traffic lights, interchanges (Ramps tool),
  tapered road joins; traffic smoothing raised to 0.8 to stop jam/empty oscillation.
- Code review: in-debt demolition, fire/abandonment stats, save tax default, cleanup.
- Police and fire stations (crime, fires), power and water, schools, clinics, plazas,
  recycling, happiness; loans, refunds, budget advisor; 3D view with two designs per zone
  and density; map sizes and Expand; road tiers and Upgrade tool.

## Code map

- `js/config.js`: **all** balance numbers. Change numbers here, not in logic.
- `js/map.js`: `GameMap` typed-array layers, flags, `KINDS`, map generation, `expandMap`.
- `js/simulation.js`: `SYSTEMS` pipeline (tick), growth scoring (`evaluateTile`), demand.
- `js/traffic.js`: commuting (Dijkstra), transit assignment, freight, junction delays.
- `js/services.js`: power and water networks, service coverage, happiness, crime, fires.
- `js/economy.js`: `TOOLS`, costs, monthly budget, loans, budget advisor.
- `js/renderer.js` (2D) and `js/renderer3d.js` (3D): same camera interface; 3D ground reuses
  the 2D tile painter as a texture.
- `js/overlays.js`, `js/ui.js`, `js/input.js`, `js/save.js`, `js/main.js`.
- `js/seasons.js` (palettes, clock), `js/graphs.js` (history panel), `js/minimap.js`.
- Multi-tile buildings: `map.part`, `map.anchorOf(i)`, `map.footprintTiles(i)`; landmark size in
  `CONFIG.buildings[k].size`.
- The simulation modules never touch the DOM, so they run headless in Node.

## Checks before pushing

- `node tools/playtest.js` (add `DIAG=1` for detail): balance scenarios. A sensible city
  should reach 1,000 people in about 25–30 in-game months without going bankrupt;
  "careless" should still go bankrupt.
- `node tools/analyze.js <save.json>`: report on a player's saved city.
- Browser check: `python3 -m http.server 8123`, then drive it with Playwright (Chromium
  is preinstalled; for 3D launch with `--use-angle=swiftshader`).
- Saves must stay backward compatible: add new persistent layers to `OPTIONAL_LAYERS` in
  `js/save.js`, and add new building kinds at the **end** of `KINDS`.
