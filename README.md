# Gridline

A cozy, readable top-down city builder for the browser. Lay roads, paint zones,
and watch a small city grow. Zoning, density and circulation drive everything.

**Play:** https://nicksierocki-oss.github.io/citybuilder/ (once GitHub Pages is enabled, see [Deploying](#deploying))

Plain HTML + CSS + JavaScript (ES modules) on a `<canvas>`. No frameworks, no build step, no image assets.

---

## How to play

1. **Extend the highway.** A grey road enters from the west edge. It is your
   city's link to the region. Only roads connected to a map edge count.
2. **Zone beside roads.** Paint Residential (R), Commercial (C) and Industrial (I)
   zones by dragging. A zoned lot only develops if it touches (4-neighbour) a
   connected road. Lots without access show a grey dashed outline.
3. **Read the RCI meter** (left sidebar):
   - **R** rises when there are jobs (industry, shops, or neighbouring towns).
   - **C** rises when there are residents to shop.
   - **I** rises with demand for goods (your residents plus regional exports), as long as there are workers.
4. **Build density.** Buildings grow from small to medium to large when demand is
   positive and the site is good. Residential density is capped by land value:
   medium needs about 40 and high needs about 62. Parks and waterfront raise land value.
   Industrial pollution lowers it.
5. **Balance the books.** Taxes come in monthly. Roads, bridges and parks cost
   upkeep. If funds stay negative for 6 months, the council removes you.

A good opener: run a street off the highway, put industry near the highway
entrance, homes a few blocks away, a strip of shops between them, and a park
among the homes.

### Controls

| Action | Input |
| --- | --- |
| Tools | `1` Road · `2` Residential · `3` Commercial · `4` Industrial · `5` Park · `6` Bulldoze · `0`/`Esc` Inspect |
| Paint | Left-drag. Roads follow an L-shaped path; zones, parks and bulldoze paint rectangles |
| Pan | `WASD` / arrow keys, right- or middle-drag, or left-drag with the Inspect tool |
| Zoom | Mouse wheel, `+` / `-` |
| Time | `Space` pause/resume · `,` `.` slower/faster · buttons in the top bar |
| Overlays | `L` land value · `P` pollution |
| Tile info | Hover any tile. With Inspect, click to pin the panel (`Esc` to unpin) |
| Budget | Click **Last month** in the top bar |
| Taxes | `−` / `+` in the top bar (higher tax = more income, less demand) |

**Save / Load** download the city as a JSON file and load it back. The game also
autosaves to your browser each in-game year and when you close the tab.

---

## How the simulation works

The simulation runs on a fixed tick (8 ticks = 1 month). At 1× a tick is 400 ms,
so a month is about 3 seconds. Each tick runs an ordered pipeline of *systems* (`js/simulation.js`):

1. **Roads.** A breadth-first search from road tiles on the map edge. Each road gets a
   distance to the edge, or -1 if it is disconnected.
2. **Pollution.** Industry emits 30 / 50 / 75 by density, with linear falloff over
   radius 3 / 4 / 6. Large commerce emits a little. Parks and trees absorb pollution nearby.
3. **Land value.** Starts at 32. Adds up to +20 for waterfront, parks (up to +36),
   trees and nearby shops. Subtracts 0.8 × pollution and a penalty near abandoned buildings.
4. **Shoppers.** Residents within 6 tiles of each tile, computed with a summed-area table.
5. **Demand (RCI).**
   - Residential target population = (jobs + 50 outside jobs) / 0.5 workforce ratio.
   - Commercial target = 0.2 jobs per resident.
   - Industrial target = 0.32 jobs per resident + 40 export jobs.
   - C and I are also capped by available labour.
   - Each gap is normalised to −1..1, shifted by the tax rate, and smoothed.
6. **Growth.** Every zoned tile gets a score:
   - **R:** demand + land value.
   - **C:** demand + land value + nearby shoppers.
   - **I:** demand + freight access, meaning a short road trip to the highway.

   Positive scores can raise density, up to the cap the site allows:
   - Land value caps residential density.
   - Land value and shoppers cap commercial density.

   Negative scores shrink buildings, and a very bad small building is abandoned.
   Abandoned buildings recover when conditions improve. Tiles cut off from the road
   network decline.
7. **Economy.** At each month boundary, taxes minus upkeep go into funds. Debt counts down to bankruptcy.

The **tile info panel** explains why a tile isn't growing, for example "Needs a road next
to it", "Land value 34 caps density at low (needs 40)", or "Only 45 residents
nearby".

### Balancing

**Every balance number lives in [`js/config.js`](js/config.js)**, including costs,
upkeep, tax bases, capacities, demand ratios, growth chances, density thresholds,
pollution and land-value weights, and tick speed.

`tools/playtest.js` runs the real simulation headless with three scripted
players and prints population, funds and RCI over six years:

```sh
node tools/playtest.js
```

Current results (seed 12345):

- **Sensible layout:** 1,000 people by month about 22 (about 70 s at 1×) and about +$650 per month by year 6.
- **Sprawl** (road grid everywhere, industry mixed into housing): stalls near 700 people and slowly bleeds money.
- **Careless** (everything zoned residential, 300+ roads): bankrupt within 6 months.

---

## Code layout

```
index.html          page shell (top bar, sidebar, panels)
css/style.css       UI styling
js/config.js        ALL balance numbers
js/map.js           GameMap: grid of typed-array layers + map generator (river, trees, highway)
js/simulation.js    systems pipeline: roads, pollution, land value, demand, growth, stats
js/economy.js       tools, build costs, monthly budget, bankruptcy
js/renderer.js      canvas drawing, camera (pan/zoom), overlays
js/input.js         mouse painting, panning, keyboard shortcuts
js/ui.js            DOM: top bar, toolbar, RCI meter, tile info, toasts, dialogs
js/save.js          JSON save/load (+ localStorage autosave)
js/main.js          wires everything; fixed-timestep loop
tools/playtest.js   headless balance test (Node)
```

**Data model.** `GameMap` stores one flat typed array per layer.
- Persistent layers: `terrain`, `type` (empty/road/R/C/I/park), `level` (0 = vacant lot, 1–3 = density), `flags` (trees, abandoned), `variant` (cosmetic).
- Derived layers, recomputed by systems: `pollution`, `landValue`, `roadDist`, `shoppers`.

**Separation.** The simulation modules (`map`, `simulation`, `economy`, `config`)
never touch the DOM, which is why the playtest can run in Node. The renderer only
reads state.

**Extending.** A new feature such as power, water, traffic or services usually means:
1. Add a layer to `GameMap`.
2. Add a system function to `SYSTEMS` in `simulation.js`.
3. Add a term to `evaluateTile` (for example, "no power → score −1").
4. Add a tool in `economy.js` and an overlay in `renderer.js`.
5. Add the new layer to `LAYERS` in `save.js` if it must persist.

---

## Running locally

ES modules need a web server (opening `index.html` from disk won't work):

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploying

`.github/workflows/pages.yml` publishes the site on every push to `main` (or the
development branch). One-time setup: in the repository go to **Settings → Pages →
Build and deployment → Source** and choose **GitHub Actions**, then re-run the
workflow. The site appears at `https://<owner>.github.io/citybuilder/`.
