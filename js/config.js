// Gridline — every balance number lives here. Tweak freely.
// Units: money is in $, time is in simulation ticks (see `time`).

export const CONFIG = {
  map: {
    width: 40,
    height: 40,
    treeChance: 0.14,        // chance a grass tile starts with trees (clustered)
    riverWidth: 2,
    highwayRow: 18,          // pre-built road entering from the west edge
    highwayLength: 11,
  },

  time: {
    ticksPerMonth: 8,
    msPerTick: { 1: 400, 2: 200, 3: 90 },   // speed -> real milliseconds per tick
    startYear: 2000,
  },

  economy: {
    startingFunds: 10000,
    taxRate: 9,              // % default; player can change 0..20
    taxRateMin: 0,
    taxRateMax: 20,
    // monthly tax base at 100% rate (multiplied by taxRate/100)
    taxPerResident: 2.2,
    taxPerCommercialJob: 3,
    taxPerIndustrialJob: 3,
    // monthly upkeep
    roadMaintenance: 1.5,
    bridgeMaintenance: 5,
    avenueMaintenance: 3,
    parkMaintenance: 4,
    // consecutive months with negative funds before the council fires you
    bankruptcyMonths: 6,
  },

  costs: {
    road: 10,
    bridge: 60,              // road placed on water
    avenue: 30,              // new avenue tile (upgrading a street costs the difference)
    avenueBridge: 120,
    residential: 10,
    commercial: 10,
    industrial: 10,
    park: 40,
    clearTrees: 5,           // extra charge when building on trees
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
    taxNeutral: 7,           // tax % with no demand penalty
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
    abandonedPenalty: 8, abandonedRadius: 2,
    pollutionWeight: 0.8,
  },

  traffic: {
    everyTicks: 4,              // recompute commuting every N ticks
    minutesPerTile: [0.8, 0.5], // free-flow travel time per tile: [street, avenue]
    capacity: [160, 480],       // trips/month before a tile is "full": [street, avenue]
    congestionK: 1.6,           // travel time x (1 + K * load^2) where load = volume / capacity
    maxCongestion: 5,           // cap on that multiplier
    smoothing: 0.5,             // how quickly route costs react to new volumes
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
  },

  sim: {
    fieldsEveryTicks: 2,     // recompute pollution / land value every N ticks
  },
};
