// Gridline — every balance number lives here. Tweak freely.
// Units: money is in $, time is in simulation ticks (see `time`).

export const CONFIG = {
  map: {
    sizes: { Small: 40, Medium: 64, Large: 96 }, // square maps offered for a new city
    defaultSize: 64,
    expandSteps: [40, 64, 96],     // "Expand map" grows a city to the next step
    expansionCost: { 64: 0, 96: 0 }, // $ to buy the extra land (0 = free)
    treeChance: 0.14,        // chance a grass tile starts with trees (clustered)
    // Pre-built regional highway entering from the west edge, as a share of map size
    highwayRowShare: 0.45,
    highwayLengthShare: 0.27,
  },

  time: {
    ticksPerMonth: 8,
    msPerTick: { 1: 400, 2: 200, 3: 90 },   // speed -> real milliseconds per tick
    startYear: 2000,
    startMonth: 3,           // new cities start in April (0 = January)
  },

  economy: {
    startingFunds: 20000,
    taxRate: 9,              // % default; player can change 0..20
    taxRateMin: 0,
    taxRateMax: 20,
    // monthly tax base at 100% rate (multiplied by taxRate/100)
    taxPerResident: 3,
    taxPerCommercialJob: 4,
    taxPerIndustrialJob: 4,
    // monthly upkeep
    roadMaintenance: 1.25,
    bridgeMaintenance: 5,
    avenueMaintenance: 3,
    lightsMaintenance: 2,
    interchangeMaintenance: 10,
    highwayMaintenance: 8,
    parkMaintenance: 4,
    // consecutive months with negative funds before the council fires you
    bankruptcyMonths: 12,
    // Loans (city bonds): borrow now, repay a fixed amount monthly
    loanAmount: 10000,
    loanMonths: 120,
    loanPayment: 105,        // per month -> repays $12,600 in total
    maxLoans: 3,
    refundShare: 0.5,        // share of a public building's price refunded when bulldozed
    warnRunwayMonths: 18,    // warn when funds would run out within this many months
  },

  costs: {
    road: 10,
    bridge: 60,              // road placed on water
    avenue: 30,              // new avenue tile (upgrading a street costs the difference)
    avenueBridge: 120,
    lights: 150,             // traffic lights on an intersection
    interchange: 1500,       // grade-separated highway junction (ramps)
    highway: 80,             // limited access: buildings can't use it as their frontage road
    highwayBridge: 240,
    // The Upgrade tool (and painting a bigger road over a smaller one) charges the difference.
    residential: 10,
    commercial: 10,
    industrial: 10,
    park: 40,
    clearTrees: 5,           // extra charge when building on trees
    plantTrees: 15,
    bulldoze: 5,
    bulldozePerLevel: 10,    // extra per building density level
  },

  // Capacity per density level [vacant, small, medium, large]
  capacity: {
    residential: [0, 10, 35, 90],   // residents
    commercial: [0, 6, 18, 45],     // jobs
    industrial: [0, 10, 25, 50],    // jobs
  },

  demand: {
    workforceRatio: 0.5,     // share of residents who hold a job
    externalJobs: 50,        // jobs in neighbouring towns (lets the first homes appear)
    externalLabor: 40,       // commuters from outside willing to work here
    comPerResident: 0.2,     // commercial jobs a resident "supports" by shopping
    comBase: 5,
    indPerResident: 0.32,    // industrial jobs needed per resident (goods)
    indBase: 40,             // regional export demand for goods
    scaleMin: 60,            // normalisation floor so small cities aren't jumpy
    laborSlack: 0.25,        // how far C/I demand may exceed labour supply
    taxNeutral: 9,           // tax % with no demand penalty (the default rate)
    taxSensitivity: 0.045,   // demand lost per % above neutral (gained below)
    smoothing: 0.25,         // 0..1, how fast the RCI meter follows its target
  },

  growth: {
    growChance: 0.10,        // base chance per tick for a tile to level up (x score)
    levelGrowMult: [1.0, 0.45, 0.25],   // multiplier when growing from level 0, 1, 2
    growThreshold: 0.05,     // minimum score to grow
    declineThreshold: -0.2,  // below this score buildings shrink
    abandonThreshold: -0.35, // below this, small buildings are abandoned
    declineChance: 0.05,
    recoverChance: 0.04,
    // Max density allowed by land value (index = level): residential needs value
    residentialLevelLV: [0, 0, 40, 62],
    commercialLevelLV: [0, 0, 30, 48],
    commercialLevelShoppers: [0, 0, 60, 350], // residents within `shopperRadius`
    shopperRadius: 6,
    // Industry wants short road trips to the regional highway (map edge)
    freightNear: 15,          // road tiles; closer => bonus
    freightFar: 30,           // road tiles; further => penalty
    freightBonus: 0.1,
    freightPenalty: 0.25,
    landValueWeight: 0.5,     // how much land value shifts residential score
  },

  pollution: {
    industryEmission: [0, 30, 50, 75],
    industryRadius: [0, 3, 4, 6],
    commercialEmission: [0, 0, 3, 8],
    commercialRadius: [0, 0, 1, 2],
    parkAbsorb: 18,
    treeAbsorb: 6,
  },

  landValue: {
    base: 32,
    waterBonus: 20, waterRadius: 4,
    parkBonus: 18,  parkRadius: 5, parkCap: 36,
    treeBonus: 2,   treeRadius: 2, treeCap: 8,
    commercialBonus: 2, commercialRadius: 3, commercialCap: 10,
    abandonedPenalty: 8, abandonedRadius: 2, abandonedCap: 16, // blight, capped so clusters can recover
    pollutionWeight: 0.8,
  },

  traffic: {
    everyTicks: 4,              // recompute commuting every N ticks
    minutesPerTile: [0.8, 0.5, 0.3], // free-flow travel time per tile: [street, avenue, highway]
    capacity: [160, 480, 1200],      // trips/month before a tile is "full": [street, avenue, highway]
    congestionK: 1.6,           // travel time x (1 + K * load^2) where load = volume / capacity
    maxCongestion: 5,           // cap on that multiplier
    smoothing: 0.8,             // share of last run's volume kept (higher = steadier routes, slower to react)
    maxCommute: 45,             // minutes; beyond this, workers won't take the job
    comfortCommute: 20,         // minutes; above this, homes become less desirable
    commuteWeight: 0.4,         // score lost at maxCommute
    unemploymentThreshold: 0.7, // employed share below which homes suffer
    unemploymentWeight: 0.8,
    freightPerJob: 0.4,         // truck trips per industrial job, routed to the highway
    passingBonusPer: 350,       // commercial score +0.1 per this many passing trips...
    passingBonusCap: 0.25,      // ...up to this
    noisePerTrip: 0.03,         // land value lost next to a road per trip
    noiseCap: 14,
    pollutionPerTrip: 0.025,    // road tile pollution per trip (radius 1)
    pollutionCap: 18,
    // Junction delays in minutes, each x (1 + k * load^2). Lights trade a fixed wait for
    // much less congestion; they pay off above ~70% load. Highways crossing other roads at
    // grade are slow unless an interchange carries them over.
    junction: {
      plain: [0.15, 4], lights: [0.3, 1], highwayAtGrade: [0.8, 3], highwayLights: [0.5, 1.5],
      interchange: [0.1, 0.5], merge: [0.1, 2],
    },
    walkMinutes: 3,             // to and from transit stops
  },

  // Public buildings (one tile each). Utilities must touch a road: power and water
  // travel through the road network (lines and pipes run under the streets).
  buildings: {
    coal:      { label: 'Coal plant',   cost: 2500, upkeep: 40, power: 600, pollution: 55, pollutionRadius: 5 },
    wind:      { label: 'Wind farm',    cost: 1000, upkeep: 15, power: 150 },
    pump:      { label: 'Water pump',   cost: 800,  upkeep: 20, water: 400, dryWater: 130, nearWaterRange: 2 },
    school:    { label: 'School',       cost: 1200, upkeep: 20, radius: 9, happiness: 14, landValue: 8 },
    clinic:    { label: 'Clinic',       cost: 1200, upkeep: 20, radius: 9, happiness: 14, landValue: 5 },
    plaza:     { label: 'Plaza',        cost: 250,  upkeep: 5,  radius: 4, happiness: 8,  landValue: 6, shopBonus: 0.12 },
    recycling: { label: 'Recycling center', cost: 1800, upkeep: 25, radius: 7, pollutionCut: 0.5 },
    police:    { label: 'Police station', cost: 1000, upkeep: 20, radius: 10 },
    // Transit: people within `radius` tiles may ride to jobs near another stop on the network.
    bus:       { label: 'Bus stop',      cost: 150,  upkeep: 6,  radius: 3, capacity: 150, wait: 4, minutesPerTile: 0.7,  share: 0.35, landValue: 3, happiness: 3 },
    metro:     { label: 'Metro station', cost: 2500, upkeep: 40, radius: 4, capacity: 600, wait: 2, minutesPerTile: 0.25, share: 0.6,  landValue: 8, happiness: 5 },
    fire:      { label: 'Fire station',   cost: 1000, upkeep: 20, radius: 10 },
    // Landmarks: multi-tile (`size` = [w, h]), unlocked by population. `radius` counts from the
    // footprint's edge. Visitors pay `income` a month at full draw (scales with city size).
    townpark:    { label: 'Town park',    cost: 400,  upkeep: 10, size: [2, 2], radius: 6,  landValue: 14, happiness: 7,  park: true },
    centralpark: { label: 'Central park', cost: 2500, upkeep: 30, size: [3, 3], radius: 9,  landValue: 22, happiness: 12, park: true, unlock: 1000 },
    university:  { label: 'University',   cost: 6000, upkeep: 90, size: [3, 2], radius: 14, landValue: 10, happiness: 6,  unlock: 1500 },
    stadium:     { label: 'Stadium',      cost: 8000, upkeep: 60, size: [3, 3], radius: 16, landValue: 6,  happiness: 10, shopBonus: 0.2, unlock: 2500,
      income: 180, visitorsAt: 8000 }, // ticket income reaches `income` at `visitorsAt` residents
    // Unlocked by a high mayor rating (see `mayor.statueRating`), not population.
    statue:      { label: "Mayor's statue", cost: 500, upkeep: 5, radius: 6, landValue: 8, happiness: 6, unlockRating: 80 },
  },

  // City-wide ordinances: monthly cost = base + perResident × population.
  ordinances: {
    recycling:   { label: 'Recycling programme', base: 20, perResident: 0.02, pollutionCut: 0.15,
      text: 'Kerbside recycling: 15% less pollution everywhere.' },
    freeTransit: { label: 'Free public transit', base: 30, perResident: 0.02, shareMult: 1.35,
      text: 'No fares: 35% more people ride buses and metro (needs stops to matter).' },
    watch:       { label: 'Neighbourhood watch', base: 10, perResident: 0.015, crimeCut: 0.15,
      text: 'Residents look out for each other: 15% less crime.' },
    smoke:       { label: 'Smoke detectors', base: 10, perResident: 0.01, fireCut: 0.25,
      text: 'Required in every building: 25% less fire risk.' },
    tourism:     { label: 'Tourism campaign', base: 60, perResident: 0, visitorMult: 1.5,
      text: 'Advertise your landmarks: 50% more ticket income from visitors.' },
    carFree:     { label: 'Car-free Sundays', base: 5, perResident: 0, trafficCut: 0.07, happiness: 4, shopPenalty: 0.03,
      text: '7% less traffic and happier residents, but shops sell a little less.' },
  },

  // Mayor rating (0..100), updated monthly from how the city is doing.
  mayor: {
    start: 50,
    smoothing: 0.15,         // share of the gap to the target closed each month
    weights: { happiness: 0.35, budget: 0.2, safety: 0.15, commute: 0.15, jobs: 0.15 },
    grantRating: 70,         // at or above this in January: a council grant...
    grantPerResident: 2,     // ...of this much per resident
    grantMax: 20000,
    statueRating: 80,        // unlocks the Mayor's statue
    protestRating: 30,       // below this, residents protest (news)
  },

  // Goal rewards and news cadence (the goals themselves are in js/goals.js).
  goals: {
    rewardScale: 1,          // multiply every goal's cash reward
  },
  news: {
    chirpsPerMonth: 2,
    keep: 30,                // news items kept
  },

  utilities: {
    // Units consumed per building by density level [vacant, low, medium, high]
    powerUse: { residential: [0, 1, 3, 7], commercial: [0, 2, 4, 9], industrial: [0, 3, 6, 12] },
    waterUse: { residential: [0, 1, 3, 7], commercial: [0, 1, 3, 6], industrial: [0, 3, 6, 10] },
    serviceUse: 4,           // power and water used by schools, clinics, etc.
    powerForLevel: 2,        // buildings need power to grow to this density or higher...
    waterForLevel: 3,        // ...and water for this one
    graceMonths: 12,         // cities from older versions get this long to build utilities
    everyTicks: 4,
  },

  // Crime (0..100 per building) from density, low land value and unemployment.
  crime: {
    perLevel: 9,             // denser buildings attract more crime
    commercialExtra: 6,      // shops and offices are targets
    lowLandValue: 0.5,       // per point of land value below 45
    unemployment: 35,        // at 100% of a home's workers jobless
    abandonedNearby: 6,      // per abandoned building within 2 tiles
    policeCut: 0.85,         // share removed at full police coverage
    happinessWeight: 0.3,    // happiness lost per point of crime
    landValueWeight: 0.15,
    businessWeight: 0.25,    // commercial/industrial score lost at crime 100
  },

  // Fire: buildings can catch fire; fire stations put fires out and prevent them.
  fire: {
    enabled: true,
    riskPerLevel: 6,
    industryExtra: 12,
    coalPlantRisk: 30,
    stationCut: 0.9,         // share of risk removed at full fire coverage
    igniteChance: 0.004,     // per building per month at risk 100
    burnMonths: 2,           // an unattended fire destroys the building after this long
    extinguishChance: 0.35,  // per tick at full fire coverage
    spreadChance: 0.015,     // per tick to each neighbouring building (halved near a station)
    burnOutChance: 0.03,     // per tick an unattended fire dies down by itself
  },

  happiness: {
    base: 50,
    landValueWeight: 0.3,    // per point of land value above/below 40
    pollutionWeight: 0.35,
    commuteWeight: 0.8,      // per minute over the comfortable commute
    noPower: 15,
    noWater: 10,
    scoreWeight: 0.25,       // residential growth score shift at 0 or 100 happiness
  },

  // Education: schools and universities raise the share of skilled residents. Denser shops,
  // offices and industry need some skilled workers; high-tech industry needs many.
  education: {
    base: 0.2,               // skilled share of residents with no school nearby
    school: 0.4,             // added at full school coverage
    university: 0.35,        // added at full university coverage
    max: 0.95,
    ratePerMonth: 0.1,       // how fast a neighbourhood moves toward its target (people take time to learn)
    taxBonus: 0.5,           // skilled residents pay up to this much more tax
    // Share of jobs that need skilled workers, by density level
    skilledShare: { commercial: [0, 0.05, 0.25, 0.5], industrial: [0, 0, 0.1, 0.2] },
    minSkilledPosts: 1,      // below this many skilled posts a building doesn't care
    growFill: 0.75,          // share of skilled posts filled before a building can grow denser
    declineFill: 0.35,       // below this, the business loses score
    penalty: 0.35,           // score lost with every skilled post empty
    hightech: {
      radius: 10,            // skilled residents counted within this many tiles of the factory
      minShare: 0.45,        // local skilled share needed to convert
      minSkilled: 40,        // and at least this many skilled workers nearby
      revertShare: 0.3,      // falls back to ordinary industry below this
      chance: 0.03,          // per tick while eligible
      skilledShare: 0.6,
      emission: 0.25,        // pollution multiplier
      freight: 0.5,          // truck trips multiplier
      taxMult: 1.8,          // tax per job multiplier
    },
  },

  // District policies (see ui.js district panel)
  districts: {
    max: 12,
    taxBreakCut: 0.5,        // share of tax waived in a tax-break district
    taxBreakBonus: 0.15,     // growth score added there
    colors: ['#e58f82', '#6fa6e3', '#e3b75a', '#7cc47a', '#b38fd6', '#5fc2c0', '#ee8ac0', '#a3a05a', '#8a94a6', '#f0a060', '#6f7fe0', '#9bc46a'],
  },

  history: {
    maxSamples: 480,         // monthly samples kept at full detail; older ones are thinned
  },

  visuals: {
    dayLengthSec: 180,       // real seconds (at 1x) for a full day/night cycle
    startHour: 8,
  },

  sim: {
    fieldsEveryTicks: 2,     // recompute pollution / land value every N ticks
  },
};
