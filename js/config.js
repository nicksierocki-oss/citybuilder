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

  sim: {
    fieldsEveryTicks: 2,     // recompute pollution / land value every N ticks
  },
};
