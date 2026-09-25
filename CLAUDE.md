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

**Phases A, B and C are done** (see Done; weather and disasters were skipped). Next up: Phase D.

Deferred: **Weather and disasters.** Floods (levee tool), heatwaves, winter storms, rare
tornadoes; rain and snow particles; Disasters off / mild / full.

**Phase D: engine-level (own branch each, extra save-compatibility testing)**
9. **Road tools 2.0.** One-way streets, roundabouts and parking are done; still to do: diagonal
   roads (needs diagonal adjacency in pathfinding, rendering and zoning).
10. **Terrain.** Height layer, hills and coastline maps, slope costs, terraforming.

## Done (recent)

- Phase D item 9 (part): `map.roadMod` layer (one-way direction in the low bits, `ROADMOD.ROUNDABOUT`),
  `canDrive(map, a, b)` used by every road search (reverse searches check `canDrive(map, v, u)`),
  `roadCapacity` (one-way ×1.6), roundabout junction delay, `onewayDirs` for drags, parking lot
  building (`parking`, shop/office bonus).

- Phase C, Transit 2.0 (`js/transit.js`, `js/lines-ui.js`): drawn bus and tram lines
  (`state.lines`, frequency and cost, road-path routes, vehicles in 2D/3D, tram track via
  `FLAG.TRAM`), railways (`TILE.RAIL`, persistent `rail` layer, level crossings, bridges), train
  stations (`railstation`), regional trains from rail at the map edge (`railExits`, region link).

- Phase B: service funding per group (budget panel, scales reach/strength/upkeep), hospital +
  `health` field, garbage (landfill, recycling capacity, trash piles, grace for old saves; save v5);
  offices, farms, mixed-use (`TILE.OFFICE/FARM/MIXED`, helpers `isHome/isJob/homeCap/jobCap` in
  map.js), hotels (`FLAG.HOTEL`, tourist income); region and trade (`js/region.js`: neighbours per
  map edge, link weight, utility buy/sell in `utilitySystem`, export demand replaces most of
  `indBase`), Region tab in City hall.

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
- `js/goals.js`, `js/news.js`, `js/cityhall.js`, `js/region.js` (pure) and `js/cityhall-ui.js` (DOM).
- Zone types: use `isZone/isHome/isJob/homeCap/jobCap` from map.js rather than checking RES/COM/IND.
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
