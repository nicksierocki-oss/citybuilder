# Gridline: notes for Claude

Browser city builder. Plain HTML/CSS/JS ES modules on canvas, no build step. The optional 3D
view uses Three.js vendored in `vendor/three/`. Live at
https://nicksierocki-oss.github.io/citybuilder/. Every push to the working branch
redeploys via `.github/workflows/pages.yml`.

## Start of a new session

The owner plans features from the **Roadmap** below. At the start of a session, show the
roadmap and ask which items to build (or take the one they name). When an item ships,
move it to **Done** with a one-line note.

## Roadmap (next features, most impactful first)

1. **Seasons and a day/night cycle.** Lit windows and streetlights at night, seasonal
   grass and tree colours. Big atmosphere boost for little simulation cost.
2. **Education and skill-based jobs.** Schools raise education; skilled jobs, offices and
   high-tech industry need educated workers.
3. **Districts and zoning policies.** Name neighbourhoods and set per-district rules:
   low-rise only, no heavy industry, tax breaks.
4. **Landmarks and parks of different sizes.** Stadium, university, large central park;
   multi-tile buildings that draw visitors and lift a whole area.
5. **Statistics and history graphs.** Population, budget, commute, happiness over time.

Smaller ideas: undo for the last action, a mini-map, zoning brushes (line or circle),
naming your city.

## Done (recent)

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
