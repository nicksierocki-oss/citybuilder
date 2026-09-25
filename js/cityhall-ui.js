// City hall UI (DOM): the goal card, the City hall panel (goals, ordinances, rating,
// achievements), the news feed and the tutorial hint on the toolbar.

import { CONFIG } from './config.js';
import { CHAINS, SCENARIOS, ACHIEVEMENTS, currentGoal, startChain } from './goals.js';
import { ORDINANCE_ORDER, ordinance, ordinanceCost, ratingParts, ratingWord } from './cityhall.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ACH_KEY = 'gridline.achievements';
const NEWS_KEY = 'gridline.newsOpen';

// Browser-wide achievements (earned in any city).
export function loadAchievements() {
  try { return new Set(JSON.parse(localStorage.getItem(ACH_KEY) ?? '[]')); } catch { return new Set(); }
}
function saveAchievements(set) {
  try { localStorage.setItem(ACH_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

const bar = (have, need, lower = false) => {
  const pct = lower ? (have <= need ? 100 : Math.max(0, 100 - (have - need) / need * 100)) : Math.max(0, Math.min(100, have / need * 100));
  return `<span class="gprog"><i style="width:${Math.round(pct)}%"></i></span>`;
};

export class CityHallUI {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.tab = 'goals';
    this.earned = loadAchievements();
    this.newsKey = null;
    try { this.newsOpen = localStorage.getItem(NEWS_KEY) !== '0'; } catch { this.newsOpen = true; }
    $('goalCard').addEventListener('click', (e) => {
      if (e.target.closest('#btnHideGoals')) { this.game.state.goals.hidden = !this.game.state.goals.hidden; this.render(); return; }
      if (e.target.closest('#btnSkipTutorial')) { startChain(this.game.state, 'career'); this.render(); return; }
      this.toggle(true);
    });
    $('cityhall').addEventListener('click', (e) => {
      const t = e.target.closest('[data-chtab]');
      if (t) { this.tab = t.dataset.chtab; this.renderPanel(true); return; }
      if (e.target.closest('#btnCityHallClose')) this.toggle(false);
    });
    $('cityhall').addEventListener('change', (e) => {
      const k = e.target.dataset.ordinance;
      if (!k) return;
      const s = this.game.state;
      s.ordinances ??= {};
      if (e.target.checked) s.ordinances[k] = true; else delete s.ordinances[k];
      this.ui.toast(`${CONFIG.ordinances[k].label} ${e.target.checked ? 'enacted' : 'repealed'}.`, 'info', 1800);
      this.ui.lastBudgetHtml = null;
      this.renderPanel(true);
    });
    $('newsBox').addEventListener('click', (e) => {
      if (e.target.closest('#btnNewsToggle')) {
        this.newsOpen = !this.newsOpen;
        try { localStorage.setItem(NEWS_KEY, this.newsOpen ? '1' : '0'); } catch { /* ignore */ }
        this.newsKey = null;
        this.renderNews();
        return;
      }
      const item = e.target.closest('[data-tx]');
      if (item) {
        const g = this.game, x = Number(item.dataset.tx), y = Number(item.dataset.ty);
        g.renderer.centerOn(g.state.map, x, y);
        g.pinned = { x, y };
      }
    });
  }

  toggle(open) {
    const el = $('cityhall');
    const show = open ?? !el.classList.contains('open');
    el.classList.toggle('open', show);
    if (show) this.renderPanel(true);
  }

  // Called by UI.drainEvents: toasts only achievements that are new to this browser.
  onAchievement(id) {
    if (this.earned.has(id)) return false;
    this.earned.add(id);
    saveAchievements(this.earned);
    return true;
  }

  // Throttled refresh (UI.update).
  render() {
    this.renderCard();
    this.renderPanel();
    this.renderNews();
    this.renderHint();
  }

  renderCard() {
    const s = this.game.state, el = $('goalCard'), sc = s.scenario;
    const r = s.rating ?? CONFIG.mayor.start, trend = ratingParts(s);
    const arrow = !trend ? '' : trend.target > r + 1 ? '▲' : trend.target < r - 1 ? '▼' : '';
    let body = '';
    if (sc?.status === 'active') {
      const def = SCENARIOS[sc.id];
      body = `<div class="gc-title">🎯 ${esc(def.name)} <small>by ${sc.deadlineYear} · ${sc.deadlineYear - s.year} yr left</small></div>
        <ul class="gc-list">${def.goals.map((g) => {
          const ok = g.check(s), p = g.progress?.(s);
          return `<li class="${ok ? 'ok' : ''}">${ok ? '✓' : '○'} ${esc(g.text)}${!ok && p ? ` <small>${p[0].toLocaleString()} / ${p[1].toLocaleString()}</small>` : ''}</li>`;
        }).join('')}</ul>`;
    } else if (!s.goals?.hidden) {
      const g = currentGoal(s);
      if (g) {
        const p = g.progress?.(s);
        body = `<div class="gc-title">🎯 ${esc(g.text)}${g.reward ? ` <small>+$${g.reward.toLocaleString()}</small>` : ''}</div>
          ${p ? `<div class="gc-p">${bar(p[0], p[1])}<small>${Math.min(p[0], p[1]).toLocaleString()} / ${p[1].toLocaleString()}</small></div>` : ''}
          ${g.hint ? `<div class="gc-hint">${esc(g.hint)}</div>` : ''}
          ${s.goals.chain === 'tutorial' ? '<button id="btnSkipTutorial" class="linkbtn">Skip tutorial</button>' : ''}`;
      } else body = '<div class="gc-title">🎯 All goals done. Try a scenario from City → New city.</div>';
    }
    const html = `<div class="gc-head"><span>Mayor</span><b>${Math.round(r)}</b><small>${ratingWord(r)} ${arrow}</small>
      <span class="gc-spacer"></span><span class="gc-open">City hall ▸</span>${sc?.status === 'active' ? '' : `<button id="btnHideGoals" class="linkbtn" title="${s.goals?.hidden ? 'Show' : 'Hide'} the current goal">${s.goals?.hidden ? 'show goal' : 'hide goal'}</button>`}</div>${body}`;
    if (html !== this.cardHtml) { el.innerHTML = html; this.cardHtml = html; }
  }

  renderPanel(force = false) {
    const el = $('cityhall');
    if (!el.classList.contains('open')) return;
    const s = this.game.state;
    const tabs = [['goals', 'Goals'], ['ordinances', 'Ordinances'], ['rating', 'Rating'], ['achievements', 'Achievements']];
    let body = '';
    if (this.tab === 'goals') body = this.goalsTab(s);
    else if (this.tab === 'ordinances') body = this.ordinancesTab(s);
    else if (this.tab === 'rating') body = this.ratingTab(s);
    else body = this.achievementsTab(s);
    const html = `<button id="btnCityHallClose" class="x" aria-label="Close">×</button><h3>🏛 City hall · ${esc(s.cityName)}</h3>
      <div class="gtabs chtabs">${tabs.map(([k, t]) => `<button data-chtab="${k}" class="${k === this.tab ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="chbody">${body}</div>`;
    if (force || html !== this.panelHtml) { el.innerHTML = html; this.panelHtml = html; }
  }

  goalsTab(s) {
    const sc = s.scenario;
    let out = '';
    if (sc) {
      const def = SCENARIOS[sc.id];
      out += `<h4>Scenario: ${esc(def.name)} <span class="pill ${sc.status === 'won' ? 'ok' : sc.status === 'lost' ? 'none' : 'short'}">${sc.status}</span></h4>
        <p class="muted">${esc(def.blurb)} Deadline: end of ${sc.deadlineYear - 1}.${sc.banned.length ? ` Not allowed: ${sc.banned.map((b) => CONFIG.buildings[b]?.label ?? b).join(', ')}.` : ''}</p>
        <ul class="chgoals">${def.goals.map((g) => { const ok = g.check(s), p = g.progress?.(s); return `<li class="${ok ? 'ok' : ''}">${ok ? '✓' : '○'} ${esc(g.text)}${p ? ` ${bar(p[0], p[1], g.lowerIsBetter)} <small>${p[0].toLocaleString()} / ${p[1].toLocaleString()}</small>` : ''}</li>`; }).join('')}</ul>`;
    }
    for (const chain of ['tutorial', 'career']) {
      const list = CHAINS[chain], g = s.goals ?? { done: [] }, active = currentGoal(s);
      out += `<h4>${chain === 'tutorial' ? 'First city' : 'Career goals'}</h4><ul class="chgoals">${list.map((goal) => {
        const done = g.done.includes(goal.id), now = active?.id === goal.id;
        return `<li class="${done ? 'ok' : now ? 'now' : 'later'}">${done ? '✓' : now ? '▸' : '○'} ${esc(goal.text)}${goal.reward ? ` <small>$${goal.reward.toLocaleString()}</small>` : ''}</li>`;
      }).join('')}</ul>`;
    }
    return out;
  }

  ordinancesTab(s) {
    const total = ORDINANCE_ORDER.filter((k) => ordinance(s, k)).reduce((a, k) => a + ordinanceCost(s, k), 0);
    return `<p class="muted">City-wide rules. Each costs a monthly fee that grows with the population.${total ? ` In force now: <b>${money(total)}/month</b>.` : ''}</p>
      <div class="ords">${ORDINANCE_ORDER.map((k) => {
        const O = CONFIG.ordinances[k], on = ordinance(s, k);
        return `<label class="ord ${on ? 'on' : ''}"><input type="checkbox" data-ordinance="${k}" ${on ? 'checked' : ''}>
          <span><b>${O.label}</b> <small>${money(ordinanceCost(s, k))}/mo</small><br><span class="muted">${O.text}</span></span></label>`;
      }).join('')}</div>`;
  }

  ratingTab(s) {
    const r = s.rating ?? CONFIG.mayor.start, R = ratingParts(s), M = CONFIG.mayor;
    const names = { happiness: 'Happiness', budget: 'Budget health', safety: 'Safety', commute: 'Commutes', jobs: 'Jobs for everyone' };
    return `<div class="rating-big"><b>${Math.round(r)}</b><span>${ratingWord(r)}</span></div>
      <p class="muted">The rating drifts each month toward how the city is doing${R ? ` (right now: <b>${Math.round(R.target)}</b>)` : ''}.
      At ${M.grantRating}+ in January the council pays a grant of $${M.grantPerResident} per resident; at ${M.statueRating}+ you unlock the Mayor's statue; under ${M.protestRating} people protest.</p>
      ${R ? `<table class="rparts">${Object.entries(M.weights).map(([k, w]) => `<tr><td>${names[k]} <small>${Math.round(w * 100)}%</small></td><td>${bar(R.parts[k], 100)}</td><td>${Math.round(R.parts[k])}</td></tr>`).join('')}</table>`
        : '<p class="muted">No residents yet.</p>'}`;
  }

  achievementsTab(s) {
    const mine = new Set(s.achievements ?? []);
    const got = ACHIEVEMENTS.filter((a) => this.earned.has(a.id) || mine.has(a.id)).length;
    return `<p class="muted">${got} of ${ACHIEVEMENTS.length} earned in this browser.</p>
      <div class="achs">${ACHIEVEMENTS.map((a) => {
        const have = this.earned.has(a.id) || mine.has(a.id);
        return `<div class="ach ${have ? 'got' : ''}"><span>${have ? '🏆' : '🔒'}</span><div><b>${esc(a.name)}</b><br><small>${esc(a.text)}</small></div></div>`;
      }).join('')}</div>`;
  }

  renderNews() {
    const s = this.game.state, el = $('newsBox'), news = s.news ?? [];
    const key = `${news.length}|${news[news.length - 1]?.tick}|${this.newsOpen}`;
    if (key === this.newsKey) return;
    this.newsKey = key;
    const items = news.slice(-5).reverse();
    el.innerHTML = `<div class="nb-head"><b>City news</b><button id="btnNewsToggle" class="linkbtn">${this.newsOpen ? 'hide' : 'show'}</button></div>
      ${this.newsOpen ? (items.length ? items.map((n) => (n.kind === 'headline'
        ? `<div class="nb-head-item">📰 ${esc(n.text)} <small>${MONTHS[n.m]} ${n.y}</small></div>`
        : `<div class="nb-chirp ${n.mood}" data-tx="${n.tx}" data-ty="${n.ty}" title="Show on the map"><b>${esc(n.who)}</b> <small>· ${esc(n.place)}</small><br>${esc(n.text)}</div>`)).join('')
        : '<p class="muted small">News arrives month by month.</p>') : ''}`;
  }

  // Tutorial: pulse the tool (or button) the current goal needs.
  renderHint() {
    const g = currentGoal(this.game.state);
    const sel = !g || this.game.state.goals?.hidden ? null : g.highlight ?? (g.tool ? `.tool[data-tool="${g.tool}"]` : null);
    if (sel === this.hintSel) return;
    document.querySelector('.hint')?.classList.remove('hint');
    this.hintSel = sel;
    if (sel) document.querySelector(sel)?.classList.add('hint');
  }
}
