# Gridline

A cozy, readable top-down city builder for the browser. Lay roads, paint zones,
and watch a small city grow. Zoning, density and circulation drive everything.

**Play:** https://nicksierocki-oss.github.io/citybuilder/ (once GitHub Pages is enabled, see [Deploying](#deploying))

Plain HTML + CSS + JavaScript (ES modules) on a `<canvas>`. No frameworks, no build step, no image assets.
There's an optional **3D view**, built with Three.js. The library is included in the repo and only loads the first time you switch to 3D.

---

## How to play

1. **Extend the regional road.** An avenue enters from the west edge. It is your
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
5. **Keep traffic moving.** Workers drive to the nearest jobs with open positions.
   Long or jammed commutes make homes decline, and homes with no job in reach empty out.
   Roads come in three tiers. Build them directly, or drag the **Upgrade** tool (`9`)
   along a road to step it up one tier for the price difference:

   | Tier | Capacity | Speed | Notes |
   | --- | --- | --- | --- |
   | Street | 160 trips | 0.8 min/tile | cheap, quiet |
   | Avenue | 480 trips | 0.5 min/tile | the workhorse |
   | Highway | 1,200 trips | 0.3 min/tile | **limited access**: buildings can't front onto it, so pair it with streets |
 Busy roads
   are noisy and polluting, so they lower land value next to them. Shops like passing traffic.
6. **Power and water.** Build a **wind farm** (clean, 150 units) or a **coal plant**
   (600 units, but it pollutes), plus a **water pump** (400 units within 2 tiles of the
   river, 130 on dry land). Place them beside a road: power lines and pipes run under the
   streets, so each connected road network pools its supply and serves the nearest
   buildings first. Buildings need **power for medium density** and **power + water for
   high density**. The top bar shows supply against demand.
7. **Public buildings and happiness.**
   - **School** and **clinic** (radius 9) make residents happier. Schools also raise land value.
   - **Plaza** (radius 4) adds happiness, land value and busier shops.
   - **Recycling center** halves pollution around it.
   - **Park** and **Plant trees** clean the air.

   Happiness (0–100) comes from those services, land value, pollution, commute and utilities.
   Happy neighbourhoods grow faster, and unhappy ones decline.
8. **Junctions and transit.**
   - **Intersections cost time:** a tile where 3 or 4 roads meet adds a delay that grows
     with traffic. **Traffic lights** ($150) add a small fixed wait but stop the delay from
     ballooning, so they pay off at busy junctions.
   - **Highways crossing other roads at grade** are a big bottleneck. An **Interchange**
     ($1,500, the *Ramps* tool) carries the highway over on a deck.
   - **Road joins:** where a highway simply turns into an avenue, the road tapers smoothly
     (a merge, with only a small delay).
   - **Bus stops** ($150): people within 3 tiles ride to jobs near other bus stops.
     Up to 35% of a home's workers, 150 riders a month per stop, slower rides.
   - **Metro stations** ($2,500): people within 4 tiles ride to jobs near any other
     station. Up to 60%, 600 riders a month, fast. Stations also raise land value.
   - **Riders never use the roads,** so transit cuts congestion, noise and pollution.
     Stops work in pairs: one near homes, one near jobs. Tile info shows each stop's
     ridership, and the **Transit** overlay (`M`) shows walking coverage.
9. **Police and fire.**
   - **Crime:** each building's crime comes from its density, low land value,
     unemployment and nearby abandoned buildings. It lowers happiness and land value,
     and scares off shops and industry. A **police station** cuts crime by up to 85%
     within 10 tiles.
   - **Fire risk:** dense buildings, industry and coal plants catch fire most often.
     A **fire station** cuts the risk by up to 90% within 10 tiles, and its crews put
     fires out within a few days.
   - **Unattended fires:** a fire outside station cover can spread next door. After
     two months it burns the building down, leaving the zoned lot vacant.
   - **Alerts:** fire alerts are clickable. They jump the camera to the fire.
10. **Educate.** Each home has a share of *skilled* residents. Without schooling it's 20%;
   a school adds up to 40 points nearby and a university up to 35 more, and the share
   moves toward its target over a couple of years. Denser shops (25–50% of jobs),
   factories (10–20%) and high-tech industry (60%) need skilled workers: a business
   whose skilled posts stay empty can't grow denser and eventually shrinks. Skilled
   residents also pay up to 50% more tax. Industry in a well-educated area (45%+ skilled
   within 10 tiles) can turn **high-tech**: a quarter of the pollution, half the trucks and
   1.8× the tax. The **Education** overlay (`N`) shows it.
11. **Landmarks** unlock with population and cover several tiles:
   - **Town park** (2×2, $400) and **Central park** (3×3 with a pond, 1,000 residents):
     big land-value and happiness boosts, and they clean the air.
   - **University** (3×2, 1,500 residents): educates residents within 14 tiles.
   - **Stadium** (3×3, 2,500 residents): happier residents and busier shops across 16 tiles,
     plus ticket income that grows with the city (up to $180/month).
   Hover to see the footprint before you click; bulldozing any tile removes (and refunds) the whole landmark.
12. **Districts.** In the sidebar, **+ New** creates a district; drag on the map to paint it
   (Erase removes tiles). Rename it and set its policies:
   - **Height limit:** medium at most, or low-rise only.
   - **No heavy industry:** factories stay small unless they're high-tech.
   - **Tax break:** 50% less tax there, and faster growth.
   Names float over the map, and the **Districts** overlay colours them in.
13. **Watch the seasons and the clock.** Grass, trees and parks follow the seasons
   (blossom in spring, gold in autumn, snow on roofs in winter). Evenings bring street
   lamps, lit windows and headlights. The ☾ and 🍂 buttons in the top bar (also in the
   **City** menu) switch the day/night cycle and the seasons off or on; the game remembers.
14. **Look back.** Click **Population** (or press `G`) for the city history graphs:
   population and jobs, funds, income and upkeep, commute and jams, happiness, crime and
   education, over 2 years, 10 years or the whole game.
15. **City hall.** The card at the bottom left shows your **mayor rating** and the current goal;
   click it for the City hall panel.
   - **Goals:** a guided first city, then career goals, each paying a cash reward.
   - **Ordinances:** city-wide rules with a monthly fee: recycling, free transit,
     neighbourhood watch, smoke detectors, a tourism campaign and car-free Sundays.
   - **Rating:** drifts toward how the city is doing (happiness, budget, safety, commutes, jobs).
     At 70+ the council pays a grant each January; at 80+ you unlock the Mayor's statue; under 30, protests.
   - **Achievements** are remembered in your browser across cities.
16. **Scenarios.** City → *New city or scenario* offers challenge maps with goals and a deadline:
   Boomtown, River Town (no coal), Green City and Rust Belt (fix a polluted, indebted town).
17. **City news** (top right) has residents and business owners saying what bothers them at
   their address (click one to fly there), plus a monthly headline.
18. **Fund services, heal and clean up.** The budget panel has a funding control (50–150%) for
   each service group: less money shrinks a service's reach and effect, more stretches them a little.
   A **hospital** (2×2, from 2,000 residents) raises health; health, from clinics and hospitals minus
   pollution and garbage, nudges happiness (**Health** overlay). Towns over 400 people make
   **garbage**: a **landfill** (2×2, collects 700 a month within 24 tiles, smelly) or recycling centres
   collect it; uncollected garbage piles up at the kerb and hurts happiness, land value and health
   (**Garbage** overlay).
19. **Specialised zones.** Beside homes, shops and industry:
   - **Offices:** many skilled jobs, no pollution, the highest tax per job. They need educated
     residents nearby (30%+ skilled) and land value to grow tall.
   - **Farms:** cheap outlying land, no power or water needed, no pollution; fields only need a
     road within 2 tiles. Crops change colour with the seasons.
   - **Mixed-use:** homes upstairs, shops at street level; grows with both housing and shop demand.
   - **Hotels:** shops at medium density or more near water, landmarks and high land value may
     become hotels, which bring tourist spending each month (more with the tourism campaign).
   Offices and farms get their own demand bars once they matter.
20. **Balance the books.** You start with $20,000. Click **Last month** for the budget:
   it shows how long your money will last, a **Borrow $10,000** button (up to 3 loans,
   repaid at $105/month for 10 years), and an **advisor** that spots the usual money
   drains. Loans can be repaid early from the same panel. Bulldozing a public building refunds half its price, and demolition works even while in debt. Twelve months in debt
   and the council takes over.

### Strategy: staying solvent

- **Grow first, serve later.** Taxes come from residents and jobs. In the first minutes,
  build a short street off the regional road, a strip of industry by the map entrance,
  homes a few tiles away and a row of shops between them.
- **Build roads only where you zone.** Every road tile costs upkeep forever, and the
  advisor counts the idle ones.
- **Start utilities small.** One wind farm ($1,000) and one pump beside the river cover
  about 500 people. Add capacity when the Power or Water gauge turns orange.
- **Add services as neighbourhoods fill.** Each covers a 9–10 tile radius. Around 500
  residents is a good time for a first school, clinic, police station and fire station.
- **Follow the demand panel.** Zone whatever is positive, a little at a time.
- **If you're losing money,** open the budget and act on the advisor's list: bulldoze
  idle roads, sell back an oversized plant, zone what's in demand, or borrow to bridge the gap.

### Controls

| Action | Input |
| --- | --- |
| Tools | Grouped in the sidebar. Hover a tool for its cost and what it does. `1` Street · `7` Avenue · `8` Highway · `9` Upgrade road · `2` Residential · `3` Commercial · `4` Industrial · `5` Park · `6` Bulldoze · `0`/`Esc` Inspect |
| Paint | Left-drag. Roads follow an L-shaped path; zones, parks and bulldoze paint rectangles, or a one-tile line or a circle with the **Brush** buttons (`B` cycles) |
| Undo | `Ctrl`+`Z` or **↶** in the top bar undoes the last build and returns the money |
| City name | Click the name in the top-left corner |
| Mini-map | Top-right. Click or drag to move the camera; hide it from the **City** menu |
| Pan | `WASD` / arrow keys, **`Shift` + drag** (any button) or **`Shift` + scroll**, middle-drag, right-drag (2D), or left-drag with the Inspect tool |
| 2D / 3D | `V` or the **3D** button. The game remembers your choice. In 3D, right-drag orbits and `Q`/`E` rotate |
| Map size | **New** offers Small 40×40, Medium 64×64 (default) or Large 96×96. **Expand** grows your current city to the next size: new land on every side, the river continues, and edge roads are extended so the city stays connected. Free by default; set `map.expansionCost` in the config to charge for land |
| Zoom | Mouse wheel, `+` / `-` |
| Time | `Space` pause/resume · `,` `.` slower/faster · buttons in the top bar |
| Overlays | `L` land value · `P` pollution · `H` happiness · `N` education · `M` transit · `C` crime · `F` fire risk · `T` traffic · `O` cycles through all, including services, power and water. The legend shows the value under the cursor; in 3D, buildings turn see-through |
| Start over | **Reset** (top bar) restarts on a fresh map of the same size. The **City** menu has New city (pick a size), Expand map, Save and Load |
| Tile info | Hover any tile. With Inspect, click to pin the panel (`Esc` to unpin) |
| Budget | Click **Last month** in the top bar |
| Graphs | Click **Population** in the top bar, or press `G` |
| Taxes | `−` / `+` in the top bar (higher tax = more income, less demand) |

**Save / Load** download the city as a JSON file and load it back. The game also
autosaves to your browser each in-game year and when you close the tab.

---

## How the simulation works

The simulation runs on a fixed tick (8 ticks = 1 month). At 1× a tick is 400 ms,
so a month is about 3 seconds. Each tick runs an ordered pipeline of *systems* (`js/simulation.js`):

1. **Roads.** A breadth-first search from road tiles on the map edge. Each road gets a
   distance to the edge, or -1 if it is disconnected.
2. **Traffic** (`js/traffic.js`, every 4 ticks).
   - **Commuting:** homes are visited in random order. Each one runs a shortest-time
     search over the road network and fills the nearest open jobs with its workers
     (half its residents). Map-edge roads lead to 50 jobs in neighbouring towns.
     Commutes are capped at 45 minutes.
   - **Freight:** each industrial job sends 0.4 truck trips to the nearest highway exit.
   - **Congestion:** trips add volume to every road tile on their route. A street tile
     takes 0.8 min and an avenue 0.5 min at free flow, multiplied by
     `1 + 1.6 × load²`, where load = volume / capacity (160 per street, 480 per avenue).
     Junction tiles add a delay (intersections, highway crossings, merges) that traffic
     lights and interchanges reduce. Transit riders are assigned first and never touch the roads.
     Volumes are smoothed between runs (80% of the previous volume is kept), so drivers
     gradually shift to less-jammed routes instead of oscillating.
   - **Effects:**
     - Homes lose score above a 20-minute commute and when under 70% of their workers are employed.
     - Shops gain from passing trips.
     - Busy roads add pollution and noise, which lowers land value.
3. **Coverage and utilities** (`js/services.js`).
   - **Coverage:** each school, clinic, plaza and recycling center covers tiles within its radius, with linear falloff.
   - **Supply:** road tiles are grouped into connected networks. Each network pools the output of the plants and pumps next to it.
   - **Distribution:** consumers are served in order of road distance from a source. When supply runs out, the farthest buildings are left short.
   - **Density cap:** without power, buildings stay at low density; without water, they stop at medium.
4. **Pollution.** Industry emits 30 / 50 / 75 by density, with linear falloff over
   radius 3 / 4 / 6. Large commerce emits a little. Parks and trees absorb pollution nearby.
5. **Land value**, then **crime and fire risk** (`safetySystem`), then **fires** each tick
   (`fireSystem`): monthly ignition by risk, spread, extinguishing by station cover, burn-down. **Land value:** Starts at 32. Adds up to +20 for waterfront, parks (up to +36),
   trees and nearby shops. Subtracts 0.8 × pollution and a penalty near abandoned buildings.
6. **Shoppers**, then **happiness**:
   50 + school/clinic/plaza coverage + 0.3 × (land value − 40) − 0.35 × pollution
   − commute over 20 min − utility outages. **Shoppers:** Residents within 6 tiles of each tile, computed with a summed-area table.
7. **Demand (RCI).**
   - Residential target population = (jobs + 50 outside jobs) / 0.5 workforce ratio.
   - Commercial target = 0.2 jobs per resident.
   - Industrial target = 0.32 jobs per resident + 40 export jobs.
   - C and I are also capped by available labour.
   - Each gap is normalised to −1..1, shifted by the tax rate, and smoothed.
8. **Growth.** Every zoned tile gets a score:
   - **R:** demand + land value + happiness − commute and unemployment penalties.
   - **C:** demand + land value + nearby shoppers + passing traffic.
   - **I:** demand + freight access, meaning a short road trip to the highway.

   Positive scores can raise density, up to the cap the site allows:
   - Land value caps residential density.
   - Land value and shoppers cap commercial density.

   Negative scores shrink buildings, and a very bad small building is abandoned.
   Abandoned buildings recover when conditions improve. Tiles cut off from the road
   network decline.
9. **Economy.** At each month boundary, taxes minus upkeep go into funds. Debt counts down to bankruptcy.
   Taxes use a *tax base*: residents weighted by education, high-tech jobs by 1.8, and tax-break districts halved.
10. **Education and history.** Once a month each home's skilled share drifts toward what its schools
    support, and a sample of the city's numbers is stored for the graphs.

The **tile info panel** explains why a tile isn't growing, for example "Needs a road next
to it", "Land value 34 caps density at low (needs 40)", or "Only 45 residents
nearby".

### Balancing

**Every balance number lives in [`js/config.js`](js/config.js)**, including costs,
upkeep, tax bases, capacities, demand ratios, growth chances, density thresholds,
pollution and land-value weights, and tick speed.

The scripted playtest uses the Small map. On a fully built 96×96 city (about 60,000 people)
a simulation tick takes about 12 ms, well under the 90 ms tick at 3× speed.

`tools/playtest.js` runs the real simulation headless with four scripted
players and prints population, funds and RCI over six years:

```sh
node tools/playtest.js          # add DIAG=1 for traffic stats and why homes aren't growing
node tools/analyze.js save.json  # report on one of your saved cities (City → Save to file)
```

Current results (seed 12345):

- **Sensible layout** (streets only; builds wind, a pump, then coal, a school and a clinic as demand appears):
  1,000 people by month 27 (about 86 s at 1×) and about 1,600 by year 6, earning about +$480/month.
- **Same layout with avenues:** 1,000 by month 22 and about 2,000 by year 6.
- **Planner** (the sensible layout plus a low-rise tax-break district, an early school, a town park and
  a university): 1,000 by month 32, solvent, with the university from month 48.
- **Sprawl** (road grid, industry mixed into housing, no utilities): stalls around 440 people with a small deficit.
- **Eager builder** (every public building in the first year): used to run out of money and stall.
  With the current costs it stays solvent (about $9,000 in hand after 6 years) and the advisor
  names what's holding it back.
- **Careless** (everything zoned residential, 300+ roads): still bankrupt, at month 22 (loans not used).

---

## Code layout

```
index.html          page shell (top bar, sidebar, panels)
css/style.css       UI styling
js/config.js        ALL balance numbers
js/map.js           GameMap: grid of typed-array layers + map generator (river, trees, highway)
js/simulation.js    systems pipeline: roads, traffic, pollution, land value, demand, growth, stats
js/traffic.js       commuting, freight, congestion (Dijkstra over the road graph)
js/services.js      power & water networks, service coverage, happiness
js/overlays.js      overlay registry (values, colours, legends) shared by both views; district borders
js/seasons.js       season palettes and the day/night clock (pure functions)
js/graphs.js        city history graphs panel
js/minimap.js       mini-map
js/goals.js         goal chains, scenarios, achievements (pure)
js/news.js          citizen posts and headlines (pure)
js/cityhall.js      ordinances and mayor rating (pure)
js/cityhall-ui.js   goal card, City hall panel, news feed
js/economy.js       tools, build costs, monthly budget, bankruptcy
js/renderer.js      2D canvas drawing, camera (pan/zoom), overlays
js/renderer3d.js    3D view (Three.js): instanced buildings (two designs per zone & density,
                    facing their street), public buildings, trees, cars, turbines; orbit camera
vendor/three/       three.js r186, unmodified (MIT), loaded only when 3D is first used
js/input.js         mouse painting, panning, keyboard shortcuts
js/ui.js            DOM: top bar, toolbar, RCI meter, tile info, toasts, dialogs
js/save.js          JSON save/load (+ localStorage autosave)
js/main.js          wires everything; fixed-timestep loop
tools/playtest.js   headless balance test (Node)
```

**Data model.** `GameMap` stores one flat typed array per layer.
- Persistent layers: `terrain`, `type` (empty/road/R/C/I/park/public), `level` (0 = vacant lot, 1–3 = density), `flags` (trees, abandoned, fire, lights, interchange, high-tech), `variant` (cosmetic), `roadClass`, `kind` (public building), `part` (which tile of a multi-tile landmark: 0 = the top-left anchor), `district`, `education`.
- Districts, history samples and the city name are saved alongside the map.
- Derived layers, recomputed by systems: `pollution`, `landValue`, `roadDist`, `shoppers`.

**Views.** Both renderers expose the same small interface: `render`, `screenToTile`,
`tileToScreen`, `panBy`, `zoomAt`, `centerOn` and `resize`, so input and UI don't care
which view is active. The 3D view paints its ground with the 2D tile painter. That means
roads, lots and overlays look identical in both views, and anything new drawn in 2D
shows up in 3D automatically.
- **Buildings, trees and cars** use a few `InstancedMesh`es (boxes, pyramids,
  cylinders, blobs), so the whole city draws in a handful of calls.
- **A new building style** is a few lines in `Renderer3D.building()`.

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
