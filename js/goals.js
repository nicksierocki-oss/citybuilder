// @ts-check
// Goals, scenarios and achievements. Pure simulation, no DOM.
// - Goal chains: a guided first city ('tutorial') flowing into 'career' goals with cash rewards.
// - Scenarios: a fixed map, a setup, goals that must all hold at once, a deadline, banned tools.
// - Achievements: checked monthly; the UI remembers them across cities (per browser).

import { CONFIG } from './config.js';
import { TILE, FLAG, makeRng, isHome, homeCap } from './map.js';

const svc = (s, k) => s.stats.services?.[k] ?? 0;
const pop = (s) => s.stats.population;
const transitShare = (s) => (s.traffic?.employed > 0 ? (s.traffic.transitRiders ?? 0) / s.traffic.employed : 0);

// Population-weighted average pollution in homes (0..100).
export function homePollution(state) {
  const m = state.map, cap = CONFIG.capacity.residential;
  let sum = 0, w = 0;
  for (let i = 0; i < m.size; i++) {
    if (!isHome(m.type[i]) || !m.level[i] || m.hasFlag(i, FLAG.ABANDONED)) continue;
    const p = homeCap(m, i);
    sum += m.pollution[i] * p; w += p;
  }
  return w ? sum / w : 0;
}

const reach = (n) => ({ check: (s) => pop(s) >= n, progress: (s) => [pop(s), n] });

// A goal: { id, text, hint, check(state), progress?(state) -> [have, need], reward, tool?, highlight? }
export const CHAINS = {
  tutorial: [
    { id: 't-road', text: 'Draw a street off the regional road', hint: 'Pick Street (1) and drag from the end of the grey avenue on the left.', tool: 'road',
      check: (s) => s.stats.roads >= 5, progress: (s) => [s.stats.roads, 5], reward: 200 },
    { id: 't-homes', text: 'Zone 12 homes beside your street', hint: 'Pick Homes (2) and drag a rectangle next to the street.', tool: 'residential',
      check: (s) => s.stats.zoned.r >= 12, progress: (s) => [s.stats.zoned.r, 12], reward: 300 },
    { id: 't-jobs', text: 'Zone 4 shops and 6 industry for jobs', hint: 'People need work: shops (3) near homes, industry (4) near the map edge.', tool: 'industrial',
      check: (s) => s.stats.zoned.c >= 4 && s.stats.zoned.i >= 6, progress: (s) => [Math.min(4, s.stats.zoned.c) + Math.min(6, s.stats.zoned.i), 10], reward: 400 },
    { id: 't-power', text: 'Build a wind farm beside a road', hint: 'Power travels along roads. Buildings need it to grow past low density.', tool: 'wind',
      check: (s) => svc(s, 'wind') + svc(s, 'coal') >= 1, reward: 500 },
    { id: 't-water', text: 'Build a water pump, best by the river', hint: 'A pump within 2 tiles of water makes three times as much.', tool: 'pump',
      check: (s) => svc(s, 'pump') >= 1, reward: 500 },
    { id: 't-250', text: 'Grow to 250 residents', hint: 'Follow the demand panel: zone whatever is positive.', ...reach(250), reward: 750 },
    { id: 't-school', text: 'Build a school', hint: 'Schools make residents happier and more skilled.', tool: 'school',
      check: (s) => svc(s, 'school') >= 1, reward: 750 },
    { id: 't-landfill', text: 'Build a landfill away from homes', hint: 'Towns over 400 people make garbage. A landfill collects it from 24 tiles around but smells: put it by industry.', tool: 'landfill',
      check: (s) => svc(s, 'landfill') + svc(s, 'recycling') >= 1, reward: 750 },
    { id: 't-district', text: 'Create a district and paint it', hint: 'Districts panel in the sidebar: + New, then drag on the map.', highlight: '#btnNewDistrict',
      check: (s) => (s.districts?.length ?? 0) > 0 && s.map.district.some((v) => v), reward: 500 },
    { id: 't-1000', text: 'Reach 1,000 residents', hint: 'Keep power and water ahead of demand and add services as neighbourhoods fill.', ...reach(1000), reward: 2000 },
  ],
  career: [
    { id: 'c-2500', text: 'Reach 2,500 residents', ...reach(2500), reward: 3000 },
    { id: 'c-uni', text: 'Build a university', hint: 'Unlocks at 1,500 residents. It educates everyone within 14 tiles.', tool: 'university',
      check: (s) => svc(s, 'university') >= 1, reward: 2000 },
    { id: 'c-edu', text: 'Educate the city: 40% of residents skilled', hint: 'Schools and universities raise it over a couple of years (overlay N).',
      check: (s) => s.education >= 0.4, progress: (s) => [Math.round(s.education * 100), 40], reward: 2000 },
    { id: 'c-offices', text: 'Employ 200 people in offices', hint: 'Zone Offices near well-educated homes; they pay the most tax per job.', tool: 'office',
      check: (s) => (s.stats.officeJobs ?? 0) >= 200, progress: (s) => [s.stats.officeJobs ?? 0, 200], reward: 2500 },
    { id: 'c-happy', text: 'Keep 2,000+ residents at 60% happiness', hint: 'Hover unhappy homes to see why; parks, clinics and short commutes help.',
      check: (s) => pop(s) >= 2000 && s.happiness >= 60, progress: (s) => [Math.round(s.happiness), 60], reward: 2500 },
    { id: 'c-transit', text: 'Get 10% of commuters onto transit', hint: 'Place bus stops among homes and among jobs on the same roads (routes link them automatically), or pair metro stations.', tool: 'bus',
      check: (s) => pop(s) >= 1000 && transitShare(s) >= 0.1, progress: (s) => [Math.round(transitShare(s) * 100), 10], reward: 2500 },
    { id: 'c-stadium', text: 'Build a stadium', hint: 'Unlocks at 2,500 residents; sells tickets as the city grows.', tool: 'stadium',
      check: (s) => svc(s, 'stadium') >= 1, reward: 3000 },
    { id: 'c-5000', text: 'Reach 5,000 residents', ...reach(5000), reward: 5000 },
    { id: 'c-tech', text: 'Attract 5 high-tech industries', hint: 'Industry near well-educated homes turns high-tech.',
      check: (s) => s.stats.hightech >= 5, progress: (s) => [s.stats.hightech, 5], reward: 3000 },
    { id: 'c-rating', text: 'Reach a mayor rating of 75', hint: 'City hall shows what the rating is made of.',
      check: (s) => (s.rating ?? 0) >= 75, progress: (s) => [Math.round(s.rating ?? 0), 75], reward: 4000 },
    { id: 'c-10000', text: 'Reach 10,000 residents', ...reach(10000), reward: 10000 },
  ],
};

// Scenarios. Goals must all be met at the same time before the deadline.
export const SCENARIOS = {
  boomtown: {
    name: 'Boomtown', size: 40, seed: 777, years: 6, funds: 15000,
    blurb: 'A small valley and a tight budget. Grow fast without going broke.',
    goals: [
      { id: 'pop', text: 'Reach 2,000 residents', ...reach(2000) },
      { id: 'money', text: 'Stay out of debt, with no loans', check: (s) => s.funds >= 0 && !(s.loans?.length) },
    ],
  },
  river: {
    name: 'River Town', size: 64, seed: 4242, years: 10, funds: 25000, banned: ['coal'],
    blurb: 'The townsfolk love their river. No coal plants allowed: power the city with wind.',
    goals: [
      { id: 'pop', text: 'Reach 3,000 residents', ...reach(3000) },
      { id: 'happy', text: 'Happiness of 52% or more', check: (s) => s.happiness >= 52, progress: (s) => [Math.round(s.happiness), 52] },
    ],
  },
  green: {
    name: 'Green City', size: 64, seed: 99, years: 12, funds: 22000, banned: ['coal'],
    blurb: 'Build a clean, happy city: little pollution where people live.',
    goals: [
      { id: 'pop', text: 'Reach 1,500 residents', ...reach(1500) },
      { id: 'clean', text: 'Pollution in homes averages under 6', check: (s) => pop(s) > 0 && homePollution(s) < 6, progress: (s) => [Math.round(homePollution(s)), 6], lowerIsBetter: true },
      { id: 'happy', text: 'Happiness of 55% or more', check: (s) => s.happiness >= 55, progress: (s) => [Math.round(s.happiness), 55] },
    ],
  },
  rustbelt: {
    name: 'Rust Belt', size: 40, seed: 12345, years: 8, prebuilt: true,
    blurb: 'You inherit a smoky, unhappy factory town with a loan to repay. Clean it up and win the residents back.',
    goals: [
      { id: 'debt', text: 'Clear the debt: funds above $0 and no loans', check: (s) => s.funds >= 0 && !(s.loans?.length) },
      { id: 'clean', text: 'Pollution in homes averages under 15', check: (s) => pop(s) > 0 && homePollution(s) < 15, progress: (s) => [Math.round(homePollution(s)), 15], lowerIsBetter: true },
      { id: 'happy', text: 'Happiness of 52% or more', check: (s) => s.happiness >= 52, progress: (s) => [Math.round(s.happiness), 52] },
      { id: 'pop', text: 'Reach 1,200 residents', ...reach(1200) },
    ],
    // Builds the run-down town. `api` = { applyTool, tick, refreshFields, highwayEntry }.
    setup(state, api) {
      const m = state.map, H = api.highwayEntry(m.width, m.height).row;
      const line = (x0, y0, x1, y1) => { const o = []; for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) o.push(m.idx(x, y)); return o; };
      state.funds = 1e6;
      api.applyTool(state, 'road', line(10, H, 24, H));
      for (const x of [13, 16, 19, 22]) api.applyTool(state, 'road', line(x, H - 8, x, H + 8));
      api.applyTool(state, 'industrial', line(2, H - 3, 9, H - 1));
      api.applyTool(state, 'industrial', line(20, H - 8, 21, H - 1));   // factories between the homes
      api.applyTool(state, 'industrial', line(20, H + 1, 21, H + 8));
      api.applyTool(state, 'residential', line(14, H - 8, 15, H - 1));
      api.applyTool(state, 'residential', line(17, H - 8, 18, H - 1));
      api.applyTool(state, 'residential', line(14, H + 1, 15, H + 8));
      api.applyTool(state, 'commercial', line(17, H + 1, 18, H + 8));
      api.applyTool(state, 'coal', [m.idx(12, H + 1)]);
      api.applyTool(state, 'pump', [m.idx(12, H + 3)]);
      api.applyTool(state, 'landfill', line(2, H + 5, 3, H + 6)); // the town dump, by the factories
      api.refreshFields(state);
      for (let k = 0; k < 30 * CONFIG.time.ticksPerMonth; k++) api.tick(state);
      // Heavy, dirty industry right next to the homes.
      for (let i = 0; i < m.size; i++) if (m.type[i] === TILE.IND) { m.level[i] = 2; m.setFlag(i, FLAG.HIGHTECH, false); m.setFlag(i, FLAG.ABANDONED, false); }
      m.version++;
      api.refreshFields(state);
      state.funds = 6000; // some cash, but the loan is the debt to clear
      state.loans = [{ monthsLeft: 60, payment: CONFIG.economy.loanPayment }];
      state.negativeMonths = 0;
      state.taxRate = 10;
      state.rating = 32;
      state.events.length = 0;
      state.history.samples.length = 0;
    },
  },
};
export const SCENARIO_ORDER = ['boomtown', 'river', 'green', 'rustbelt'];

// ---------------------------------------------------------------- mayor levels & achievements

const MONUMENTS = ['clocktower', 'arch', 'cathedral', 'skytower', 'pyramid'];
const ATTRACTIONS = ['museum', 'aquarium', 'zoo', 'amusement', 'opera'];
const count = (s, kinds) => kinds.reduce((a, k) => a + svc(s, k), 0);
const riding = (s, pred = (/** @type {any} */ _l) => true) => (s.lines ?? []).filter((l) => pred(l) && (s.lineStats?.[l.id]?.riders ?? 0) > 0).length;
const tour = (s) => s.tourism ?? { visitors: 0, airports: 0, seaports: 0, cargo: 0 };
const ts = (s) => s.transitStats ?? {};
const years = (s) => s.tick / (CONFIG.time.ticksPerMonth * 12);
// Every capacity service built and none over capacity or leaving many homes out.
const wellServed = (s, maxOut) => ['school', 'clinic', 'police', 'fire'].every((k) => {
  const u = s.serviceUse?.[k];
  return u?.buildings && !u.full && u.unserved <= pop(s) * maxOut;
});

// Mayor levels: each has a dozen achievements; earning `need` of them promotes the mayor, pays
// `reward` and unlocks the level's monument. Achievements can be earned in any order.
// Achievement: { id, name, text, check(state) }. Ids are stored in saves and the browser.
export const MAYOR_LEVELS = [
  { title: 'Village mayor', need: 9, reward: 5000, achievements: [
    { id: 'roads50', name: 'First streets', text: 'Lay 50 street tiles', check: (s) => s.stats.roads + s.stats.avenues >= 50 },
    { id: 'pop250', name: 'Hamlet', text: 'Reach 250 residents', check: (s) => pop(s) >= 250 },
    { id: 'utilities', name: 'Lights on', text: 'Run a power plant and a water pump', check: (s) => svc(s, 'wind') + svc(s, 'coal') > 0 && svc(s, 'pump') > 0 },
    { id: 'school1', name: 'School bell', text: 'Build a school', check: (s) => svc(s, 'school') > 0 },
    { id: 'clinic1', name: 'Doctor in town', text: 'Build a clinic', check: (s) => svc(s, 'clinic') > 0 },
    { id: 'safety1', name: 'Safe and sound', text: 'Build a police station and a fire station', check: (s) => svc(s, 'police') > 0 && svc(s, 'fire') > 0 },
    { id: 'parks5', name: 'Green spaces', text: 'Lay out 5 park tiles', check: (s) => s.stats.parks >= 5 },
    { id: 'shops50', name: 'Main street', text: '50 people working in shops', check: (s) => s.stats.comJobs >= 50 },
    { id: 'trash1', name: 'Clean streets', text: 'Collect garbage with a landfill or recycling centre', check: (s) => svc(s, 'landfill') + svc(s, 'recycling') > 0 },
    { id: 'route1', name: 'All aboard', text: 'A bus route carrying riders', check: (s) => riding(s) > 0 },
    { id: 'profit', name: 'Balanced books', text: 'A month with a $300+ surplus', check: (s) => (s.lastMonth?.net ?? 0) >= 300 },
    { id: 'pop1k', name: 'Town', text: 'Reach 1,000 residents', check: (s) => pop(s) >= 1000 },
  ] },
  { title: 'Town mayor', need: 9, reward: 10000, unlocks: 'clocktower', achievements: [
    { id: 'pop2500', name: 'Market town', text: 'Reach 2,500 residents', check: (s) => pop(s) >= 2500 },
    { id: 'hoods', name: 'Neighbourhoods', text: 'Three districts', check: (s) => (s.districts?.length ?? 0) >= 3 },
    { id: 'debtfree', name: 'Debt free', text: 'Pay off a loan', check: (s) => (s.loansPaid ?? 0) > 0 },
    { id: 'black', name: 'In the black', text: 'Two years in a row without a loss-making month', check: (s) => (s.positiveMonths ?? 0) >= 24 },
    { id: 'happy55', name: 'Content town', text: '1,000+ residents at 55% happiness', check: (s) => pop(s) >= 1000 && s.happiness >= 55 },
    { id: 'avenue30', name: 'Boulevard', text: 'Build 30 avenue tiles', check: (s) => s.stats.avenues >= 30 },
    { id: 'skilled30', name: 'Learning town', text: '30% of residents skilled', check: (s) => pop(s) >= 500 && s.education >= 0.3 },
    { id: 'farms', name: 'Breadbasket', text: '100 people working on farms', check: (s) => (s.stats.farmJobs ?? 0) >= 100 },
    { id: 'lawmaker', name: 'Lawmaker', text: 'Two ordinances in force', check: (s) => Object.keys(s.ordinances ?? {}).length >= 2 },
    { id: 'routes3', name: 'Bus network', text: 'Three routes carrying riders', check: (s) => riding(s) >= 3 },
    { id: 'hotel1', name: 'Welcome visitors', text: 'Your first hotel', check: (s) => (s.stats.hotels ?? 0) >= 1 },
    { id: 'served', name: 'Well served', text: '1,000+ residents; schools, clinics, police and fire all with room', check: (s) => pop(s) >= 1000 && wellServed(s, 0.2) },
  ] },
  { title: 'City mayor', need: 9, reward: 20000, unlocks: 'arch', achievements: [
    { id: 'pop5k', name: 'City', text: 'Reach 5,000 residents', check: (s) => pop(s) >= 5000 },
    { id: 'ivory', name: 'Ivory tower', text: 'Build a university', check: (s) => svc(s, 'university') > 0 },
    { id: 'silicon', name: 'Silicon valley', text: 'Five high-tech industries', check: (s) => s.stats.hightech >= 5 },
    { id: 'offices200', name: 'Business district', text: '200 people working in offices', check: (s) => (s.stats.officeJobs ?? 0) >= 200 },
    { id: 'hospital', name: 'Healing hands', text: 'Build a hospital', check: (s) => svc(s, 'hospital') > 0 },
    { id: 'tram', name: 'Clang clang', text: 'A tram line carrying riders', check: (s) => riding(s, (l) => l.mode === 'tram') > 0 },
    { id: 'metro', name: 'Underground', text: 'A metro carrying 100 riders a month', check: (s) => (ts(s).metro ?? 0) >= 100 },
    { id: 'railriders', name: 'Commuter belt', text: 'Trains carrying 100 riders a month', check: (s) => (ts(s).rail ?? 0) >= 100 },
    { id: 'stadium', name: 'Game day', text: 'Build a stadium', check: (s) => svc(s, 'stadium') > 0 },
    { id: 'harbour', name: 'Harbour town', text: 'A working seaport', check: (s) => tour(s).seaports > 0 },
    { id: 'museum', name: 'Culture club', text: 'Open a museum', check: (s) => svc(s, 'museum') > 0 },
    { id: 'rating70', name: 'Popular mayor', text: 'A mayor rating of 70', check: (s) => (s.rating ?? 0) >= 70 },
  ] },
  { title: 'Metropolitan mayor', need: 9, reward: 40000, unlocks: 'cathedral', achievements: [
    { id: 'pop10k', name: 'Metropolis', text: 'Reach 10,000 residents', check: (s) => pop(s) >= 10000 },
    { id: 'transit', name: 'Transit town', text: 'A quarter of commuters ride transit (1,000+ residents)', check: (s) => pop(s) >= 1000 && transitShare(s) >= 0.25 },
    { id: 'safe', name: 'Safe streets', text: '2,000+ residents and crime under 8', check: (s) => pop(s) >= 2000 && s.crime < 8 },
    { id: 'clean', name: 'Clean air', text: '2,000+ residents breathing almost no pollution', check: (s) => pop(s) >= 2000 && homePollution(s) < 5 },
    { id: 'resort', name: 'Resort town', text: 'Five hotels', check: (s) => (s.stats.hotels ?? 0) >= 5 },
    { id: 'flight', name: 'First flight', text: 'A working airport', check: (s) => tour(s).airports > 0 },
    { id: 'tourists1k', name: 'Tourist magnet', text: '1,000 visitors a month', check: (s) => tour(s).visitors >= 1000 },
    { id: 'monument1', name: 'Monumental', text: 'Build a monument', check: (s) => count(s, MONUMENTS) >= 1 },
    { id: 'skilled50', name: 'Educated city', text: '50% of residents skilled (3,000+ residents)', check: (s) => pop(s) >= 3000 && s.education >= 0.5 },
    { id: 'commute20', name: 'Easy commute', text: '3,000+ residents averaging under 20 minutes to work', check: (s) => pop(s) >= 3000 && (s.traffic?.avgCommute ?? 99) < 20 },
    { id: 'rich100k', name: 'Deep pockets', text: '$100,000 in the bank', check: (s) => s.funds >= 100000 },
    { id: 'healthy', name: 'Healthy city', text: '3,000+ residents with health of 70', check: (s) => pop(s) >= 3000 && (s.health ?? 0) >= 70 },
  ] },
  { title: 'Regional mayor', need: 9, reward: 75000, unlocks: 'skytower', achievements: [
    { id: 'pop20k', name: 'Big city', text: 'Reach 20,000 residents', check: (s) => pop(s) >= 20000 },
    { id: 'beloved', name: 'Beloved mayor', text: 'A mayor rating of 85', check: (s) => (s.rating ?? 0) >= 85 },
    { id: 'tourists3k', name: 'Destination', text: '3,000 visitors a month', check: (s) => tour(s).visitors >= 3000 },
    { id: 'attractions3', name: 'Something for everyone', text: 'Three different kinds of attraction', check: (s) => ATTRACTIONS.filter((k) => svc(s, k) > 0).length >= 3 },
    { id: 'monument3', name: 'Skyline of history', text: 'Three monuments', check: (s) => count(s, MONUMENTS) >= 3 },
    { id: 'thrills', name: 'Thrill seeker', text: 'Open an amusement park', check: (s) => svc(s, 'amusement') > 0 },
    { id: 'shipping', name: 'Shipping hub', text: 'Ship 1,000 truckloads a month by sea', check: (s) => tour(s).cargo >= 1000 },
    { id: 'transit35', name: 'Car-light city', text: '35% of commuters on transit (5,000+ residents)', check: (s) => pop(s) >= 5000 && transitShare(s) >= 0.35 },
    { id: 'nojam', name: 'Free flowing', text: '10,000+ residents and no jammed roads', check: (s) => pop(s) >= 10000 && (s.traffic?.congested ?? 1) === 0 },
    { id: 'hightech20', name: 'Tech capital', text: 'Twenty high-tech industries', check: (s) => s.stats.hightech >= 20 },
    { id: 'income20k', name: 'Booming budget', text: '$20,000 income in a month', check: (s) => (s.lastMonth?.income ?? 0) >= 20000 },
    { id: 'happy65', name: 'Joyful city', text: '10,000+ residents at 65% happiness', check: (s) => pop(s) >= 10000 && s.happiness >= 65 },
  ] },
  { title: 'Legendary mayor', need: 9, reward: 150000, unlocks: 'pyramid', achievements: [
    { id: 'pop35k', name: 'Megacity', text: 'Reach 35,000 residents', check: (s) => pop(s) >= 35000 },
    { id: 'tourists6k', name: 'World famous', text: '6,000 visitors a month', check: (s) => tour(s).visitors >= 6000 },
    { id: 'monument5', name: 'Wonders of the world', text: 'Five monuments', check: (s) => count(s, MONUMENTS) >= 5 },
    { id: 'opera', name: 'Night at the opera', text: 'Open an opera house', check: (s) => svc(s, 'opera') > 0 },
    { id: 'skilled70', name: 'City of scholars', text: '70% of residents skilled (10,000+ residents)', check: (s) => pop(s) >= 10000 && s.education >= 0.7 },
    { id: 'rating90', name: 'Mayor for life', text: 'A mayor rating of 90', check: (s) => (s.rating ?? 0) >= 90 },
    { id: 'rich500k', name: 'Treasure chest', text: '$500,000 in the bank', check: (s) => s.funds >= 500000 },
    { id: 'crime3', name: 'Crime-free', text: '20,000+ residents and crime under 3', check: (s) => pop(s) >= 20000 && s.crime < 3 },
    { id: 'servedall', name: 'Nobody left out', text: '20,000+ residents, every service with room and reaching 95% of homes', check: (s) => pop(s) >= 20000 && wellServed(s, 0.05) },
    { id: 'years25', name: 'Veteran', text: '25 years in office', check: (s) => years(s) >= 25 },
    { id: 'green20k', name: 'Garden city', text: '20,000+ residents breathing almost no pollution', check: (s) => pop(s) >= 20000 && homePollution(s) < 5 },
    { id: 'airhub', name: 'Air hub', text: 'Two airports', check: (s) => tour(s).airports >= 2 },
  ] },
];
export const LEGEND_TITLE = 'Mayor of legend';

// Achievements: every level's, then scenario wins.
export const ACHIEVEMENTS = [
  ...MAYOR_LEVELS.flatMap((L, n) => L.achievements.map((a) => ({ ...a, level: n + 1 }))),
  ...SCENARIO_ORDER.map((k) => ({ id: `scenario:${k}`, name: SCENARIOS[k].name, text: `Win the ${SCENARIOS[k].name} scenario`, level: 0,
    check: (s) => s.scenario?.id === k && s.scenario.status === 'won' })),
];

// Level a city has reached from its achievements (1 = first level; MAYOR_LEVELS.length + 1 = legend).
export function levelFromAchievements(earned) {
  const have = new Set(earned ?? []);
  let level = 1;
  while (level <= MAYOR_LEVELS.length && MAYOR_LEVELS[level - 1].achievements.filter((a) => have.has(a.id)).length >= MAYOR_LEVELS[level - 1].need) level++;
  return level;
}
export function levelTitle(level) {
  return MAYOR_LEVELS[level - 1]?.title ?? LEGEND_TITLE;
}

export function emptyGoals(chain = 'tutorial') {
  return { chain, index: 0, done: [], hidden: false };
}

export function currentGoal(state) {
  const g = state.goals;
  if (!g || !g.chain || state.scenario?.status === 'active') return null;
  return CHAINS[g.chain]?.[g.index] ?? null;
}

// Move to a chain, quietly ticking off goals the city already meets (no reward for those).
export function startChain(state, chain) {
  state.goals = { ...(state.goals ?? emptyGoals()), chain, index: 0 };
  skipMet(state);
}

function skipMet(state) {
  const g = state.goals;
  for (let goal = CHAINS[g.chain]?.[g.index]; goal && goal.check(state); goal = CHAINS[g.chain]?.[g.index]) {
    g.done.push(goal.id);
    g.index++;
  }
  if (g.chain === 'tutorial' && g.index >= CHAINS.tutorial.length) { g.chain = 'career'; g.index = 0; skipMet(state); }
}

// Monthly: goal progress and rewards, scenario win/lose, achievements.
export function goalsSystem(state) {
  if (state.tick % CONFIG.time.ticksPerMonth !== 0 || !state.stats) return;
  const push = (text, kind = 'good', extra = {}) => state.events.push({ text, kind, ...extra });
  // Goal chain: one goal at a time; completing it pays the reward.
  const goal = currentGoal(state);
  if (goal && goal.check(state)) {
    const reward = Math.round((goal.reward ?? 0) * CONFIG.goals.rewardScale);
    state.funds += reward;
    state.goals.done.push(goal.id);
    state.goals.index++;
    if (state.goals.chain === 'tutorial' && state.goals.index >= CHAINS.tutorial.length) {
      push('Tutorial complete! Career goals are next: find them in City hall.', 'good');
      state.goals.chain = 'career'; state.goals.index = 0;
    }
    push(`Goal complete: ${goal.text}${reward ? ` (+$${reward.toLocaleString()})` : ''}`, 'good', { goal: true });
  }
  // Scenario
  const sc = state.scenario;
  if (sc?.status === 'active') {
    const def = SCENARIOS[sc.id];
    if (def.goals.every((g) => g.check(state))) {
      sc.status = 'won';
      sc.endedYear = state.year;
      push(`Scenario won: ${def.name}! Keep playing in free play if you like.`, 'good', { scenario: 'won' });
      startChain(state, 'career');
    } else if (state.year >= sc.deadlineYear) {
      sc.status = 'lost';
      push(`Time is up: ${def.name} not completed. You can keep playing in free play.`, 'bad', { scenario: 'lost' });
      startChain(state, 'career');
    }
  }
  // Achievements (per city here; the UI keeps the browser-wide list)
  state.achievements ??= [];
  for (const a of ACHIEVEMENTS) {
    if (state.achievements.includes(a.id) || !a.check(state)) continue;
    state.achievements.push(a.id);
    push(`🏆 ${a.name}: ${a.text}`, 'achievement', { achievement: a.id });
  }
  // Mayor levels: promote (possibly several times) as each level's achievements come in.
  state.mayorLevel ??= 1;
  const target = levelFromAchievements(state.achievements);
  while (state.mayorLevel < target) {
    const L = MAYOR_LEVELS[state.mayorLevel - 1], reward = Math.round(L.reward * CONFIG.goals.rewardScale);
    state.mayorLevel++;
    state.funds += reward;
    const next = MAYOR_LEVELS[state.mayorLevel - 1]?.unlocks; // the new level's monument
    push(`🎖 Promoted to ${levelTitle(state.mayorLevel)}! The council awards $${reward.toLocaleString()}.${next ? ` Unlocked: ${CONFIG.buildings[next].label} (Monuments).` : ''}`, 'good', { goal: true });
  }
}

// New scenario city. `api` = { createGame, applyTool, tick, refreshFields, highwayEntry }.
export function createScenario(id, api) {
  const def = SCENARIOS[id];
  const state = api.createGame(def.seed, def.size);
  state.cityName = def.name;
  if (def.funds) state.funds = def.funds;
  state.goals = emptyGoals(null);
  const rng = state.rng;
  state.rng = makeRng(def.seed); // every player gets the same starting town
  if (def.setup) def.setup(state, api); // runs the simulation, so the scenario is attached afterwards
  state.rng = rng;
  state.scenario = { id, status: 'active', banned: def.banned ?? [], deadlineYear: state.year + def.years };
  state.achievements = [];
  state.mayorLevel = 1;
  state.events.length = 0;
  api.refreshFields(state);
  return state;
}
