// City news: citizens talk about what the simulation sees at their address, and a monthly
// headline sums up the month. Pure simulation, no DOM. Items live in state.news (newest last).

import { CONFIG } from './config.js';
import { TILE, FLAG, makeRng } from './map.js';
import { happinessReasons } from './services.js';
import { ordinance } from './cityhall.js';

const NAMES = ['Ava', 'Ben', 'Chloe', 'Dev', 'Elena', 'Finn', 'Grace', 'Hugo', 'Isla', 'Jonah', 'Kira', 'Leo', 'Maya', 'Nico',
  'Olive', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Theo', 'Uma', 'Vik', 'Wren', 'Yara', 'Zane', 'Amir', 'Bea', 'Caleb', 'Dana', 'Eli'];
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

// What a resident at home i might say, as [topic, text] (null if nothing notable).
function residentLine(state, i, rng) {
  const m = state.map, T = CONFIG.traffic;
  const hp = m.happiness[i], c = m.commute[i], why = happinessReasons(state, i);
  if (m.hasFlag(i, FLAG.FIRE)) return ['fire', 'Our building is on fire! Where are the fire trucks?'];
  if (m.employed[i] < 0.6) return ['jobs', pick(rng, ['Still no job I can get to. Any work near here?', 'Half my street is out of work.'])];
  if (!Number.isFinite(c) || c > T.comfortCommute + 12) return ['commute', pick(rng, [`${Number.isFinite(c) ? Math.round(c) : 'Endless'} minutes to work every morning. We need better roads or a bus.`, 'Stuck in traffic again. A bus stop here would change my life.'])];
  if (why.includes('no power') || why.includes('no water')) return ['utilities', `We still have ${why.includes('no power') ? 'no power' : 'no water'} in this block!`];
  if (why.some((w) => w.startsWith('crime'))) return ['crime', pick(rng, ["Another break-in on our street. We need police around here.", "I don't walk home alone after dark any more."])];
  if (why.includes('pollution')) return ['pollution', pick(rng, ["Can't hang the washing out: the air here is filthy.", 'The kids keep coughing. Move the factories away from homes!'])];
  if (why.includes('no school nearby')) return ['school', 'The nearest school is miles away. Our kids deserve better.'];
  if (why.includes('uncollected garbage')) return ['garbage', pick(rng, ['The bins have not been emptied in weeks. The whole street stinks!', 'Rubbish bags piled up to the fence. Where is the garbage truck?'])];
  if (why.includes('poor health care')) return ['health', 'Three hours in the waiting room again. We need a proper hospital.'];
  if (why.includes('no clinic nearby')) return ['clinic', 'Had to go across town to see a doctor. A clinic nearby, please?'];
  if (state.taxRate >= CONFIG.demand.taxNeutral + 3) return ['tax', `${state.taxRate}% tax? That's daylight robbery.`];
  if (hp >= 72) {
    if (m.coverage.centralpark[i] > 0.2 || m.coverage.townpark[i] > 0.2) return ['happy', 'Morning jog through the park, then coffee. I love this neighbourhood.'];
    if (m.coverage.stadium[i] > 0.2) return ['happy', 'Big match at the stadium tonight. What a place to live!'];
    return ['happy', pick(rng, ['Honestly? Best neighbourhood in the city.', 'Quiet street, good school, short commute. No complaints!'])];
  }
  return null;
}

// What a business owner at job tile i might say.
function businessLine(state, i) {
  const m = state.map;
  if (m.skillFill[i] < 0.5) return ['skills', "I can't find skilled staff anywhere. Build more schools!"];
  if (m.crime[i] > 35) return ['crime', 'Third shoplifting this week. Where are the police?'];
  if (m.type[i] === TILE.COM && m.shoppers[i] < 30 && m.level[i] >= 1) return ['customers', 'The shop is empty all day. We need more homes nearby.'];
  if (m.type[i] === TILE.COM && ordinance(state, 'carFree') && state.month % 2 === 0) return ['carfree', 'Car-free Sundays are killing my weekend trade.'];
  return null;
}

function where(state, i) {
  const id = state.map.district[i], d = id && state.districts?.find((x) => x.id === id);
  return d ? d.name : `${i % state.map.width}, ${(i / state.map.width) | 0}`;
}

function add(state, item) {
  state.news ??= [];
  state.news.push({ tick: state.tick, y: state.year, m: state.month, ...item });
  const keep = CONFIG.news.keep;
  if (state.news.length > keep) state.news.splice(0, state.news.length - keep);
}

// Monthly headline: the biggest story of the month, as [topic, text]. Recurring topics
// (deficits, jams) aren't repeated for half a year.
function headline(state) {
  const s = state.stats, h = state.history?.samples ?? [], prev = h[h.length - 12] ?? h[0], last = h[h.length - 1];
  const P = s.population, lm = state.lastMonth;
  // What happened since last month, from the simulation's own records (not the UI's event queue).
  const seen = state.newsSeen ??= { milestones: state.milestones.length, burned: state.burnedDown ?? 0, grant: state.lastGrant ?? -1 };
  const fresh = state.milestones.slice(seen.milestones), burned = (state.burnedDown ?? 0) > seen.burned, grant = (state.lastGrant ?? -1) !== seen.grant;
  seen.milestones = state.milestones.length; seen.burned = state.burnedDown ?? 0; seen.grant = state.lastGrant ?? -1;
  const pops = fresh.filter((x) => typeof x === 'number');
  if (pops.length) return ['milestone', `${state.cityName} passes ${Math.max(...pops).toLocaleString()} residents!`];
  if (burned) return ['fire', 'Blaze destroys building: residents ask where the fire station was'];
  if (fresh.includes('hightech')) return ['tech', 'Tech boom: first high-tech firm moves in'];
  const unlock = fresh.find((x) => typeof x === 'string' && x.startsWith('unlock:'));
  if (unlock) return ['unlock', `City can now build a ${CONFIG.buildings[unlock.slice(7)].label.toLowerCase()}`];
  if (grant) return ['grant', 'Council rewards popular mayor with a grant'];
  if ((state.rating ?? 50) < CONFIG.mayor.protestRating && P > 200) return ['protest', `Residents march on city hall: mayor's rating falls to ${Math.round(state.rating)}`];
  if (state.funds < 0) return ['debt', `City in the red: ${CONFIG.economy.bankruptcyMonths - state.negativeMonths} months to fix the budget`];
  if (prev && last && prev.pop > 200 && P > prev.pop * 1.15) return ['boom', `Boom year: population up ${Math.round((P / prev.pop - 1) * 100)}% since last year`];
  if (prev && last && prev.pop > 200 && P < prev.pop * 0.9) return ['exodus', `Exodus: ${Math.round((1 - P / prev.pop) * 100)}% fewer residents than a year ago`];
  if (state.traffic?.congested > 10) return ['jam', `Gridlock: ${state.traffic.congested} road tiles jammed at rush hour`];
  if (lm && lm.net < 0 && P > 0) return ['deficit', `City spends $${Math.abs(lm.net).toLocaleString()} more than it earns this month`];
  if (P === 0) return ['empty', `${state.cityName} awaits its first residents`];
  return null;
}

// Monthly: a couple of citizen posts (a topic isn't repeated for a few months) and a headline.
export function newsSystem(state) {
  if (state.tick % CONFIG.time.ticksPerMonth !== 0) return;
  // Own random numbers: news must never change the simulation's dice.
  const m = state.map, rng = makeRng(state.tick * 7919 + 17);
  const recent = state.newsTopics ??= {};
  const topicFree = (t) => (state.tick - (recent[t] ?? -1e9)) > 5 * CONFIG.time.ticksPerMonth;
  let posted = 0;
  if (state.stats.population > 0) {
    for (let tries = 0; tries < 40 && posted < CONFIG.news.chirpsPerMonth; tries++) {
      const i = Math.floor(rng() * m.size), t = m.type[i];
      if (!m.level[i] || m.hasFlag(i, FLAG.ABANDONED)) continue;
      const line = t === TILE.RES ? residentLine(state, i, rng) : t === TILE.COM || t === TILE.IND ? businessLine(state, i) : null;
      if (!line || !topicFree(line[0])) continue;
      recent[line[0]] = state.tick;
      const who = `${pick(rng, NAMES)}${t === TILE.RES ? '' : t === TILE.COM ? ', shop owner' : ', factory boss'}`;
      add(state, { kind: 'chirp', who, place: where(state, i), text: line[1], tx: i % m.width, ty: (i / m.width) | 0, mood: line[0] === 'happy' ? 'good' : 'bad' });
      posted++;
    }
  }
  const head = headline(state);
  const once = ['milestone', 'fire', 'tech', 'unlock', 'grant']; // one-off events always make the news
  if (head && (once.includes(head[0]) || topicFree(`h:${head[0]}`))) {
    recent[`h:${head[0]}`] = state.tick;
    add(state, { kind: 'headline', text: head[1] });
  }
}
