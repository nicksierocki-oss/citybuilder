// History graphs panel: monthly samples from state.history drawn as simple line charts (DOM + canvas).
// One y-axis per chart; measures on different scales get their own chart.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Categorical slots, always assigned in this order.
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a'];
const INK = '#34404f', MUTED = '#8491a3', GRID = '#e8edf2', SURFACE = '#ffffff';

const money = (v) => (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString();
const TABS = {
  population: {
    label: 'Population',
    charts: [{ title: 'Residents and jobs', series: [['pop', 'Residents'], ['jobs', 'Jobs']], fmt: (v) => Math.round(v).toLocaleString() }],
  },
  money: {
    label: 'Money',
    charts: [
      { title: 'Funds', series: [['funds', 'Funds']], fmt: money, zero: true },
      { title: 'Monthly income and upkeep', series: [['income', 'Income'], ['expenses', 'Upkeep']], fmt: money },
    ],
  },
  commute: {
    label: 'Traffic',
    charts: [
      { title: 'Average commute (minutes)', series: [['commute', 'Commute']], fmt: (v) => `${v.toFixed(1)} min` },
      { title: 'Jammed road tiles', series: [['congested', 'Jammed roads']], fmt: (v) => Math.round(v).toLocaleString() },
    ],
  },
  wellbeing: {
    label: 'Wellbeing',
    charts: [{ title: 'Happiness, crime and skilled residents (0–100)', series: [['happiness', 'Happiness'], ['crime', 'Crime'], ['education', 'Skilled %']], fmt: (v) => `${Math.round(v)}`, max: 100 }],
  },
};
const RANGES = [['24', '2 yr'], ['120', '10 yr'], ['all', 'All']];

function niceStep(span, ticks) {
  const raw = span / ticks, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}

export class Graphs {
  constructor(el, getState) {
    this.el = el;
    this.getState = getState;
    this.tab = 'population';
    this.range = '120';
    this.key = null;
    this.hover = null; // { chart, index }
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-gtab]'), r = e.target.closest('[data-grange]');
      if (t) { this.tab = t.dataset.gtab; this.render(true); }
      if (r) { this.range = r.dataset.grange; this.render(true); }
    });
  }

  samples() {
    const all = this.getState().history?.samples ?? [];
    return this.range === 'all' ? all : all.slice(-Number(this.range));
  }

  render(force = false) {
    if (!this.el.classList.contains('open')) return;
    const data = this.samples();
    const key = `${this.tab}|${this.range}|${data.length}|${data[data.length - 1]?.funds}`;
    if (!force && key === this.key) return;
    this.key = key;
    const tab = TABS[this.tab];
    this.el.innerHTML = `<button id="btnGraphsClose" class="x" aria-label="Close">×</button>
      <h3>City history</h3>
      <div class="gbar">
        <div class="gtabs">${Object.entries(TABS).map(([k, t]) => `<button data-gtab="${k}" class="${k === this.tab ? 'on' : ''}">${t.label}</button>`).join('')}</div>
        <div class="gtabs">${RANGES.map(([k, t]) => `<button data-grange="${k}" class="${k === this.range ? 'on' : ''}">${t}</button>`).join('')}</div>
      </div>
      ${data.length < 2 ? '<p class="muted">The graphs fill in month by month. Let the city run for a little while.</p>'
        : tab.charts.map((c, n) => `<div class="gchart"><div class="gtitle">${c.title}</div>
          ${c.series.length > 1 ? `<div class="glegend">${c.series.map(([, name], k) => `<span><i style="background:${SERIES[k]}"></i>${name}</span>`).join('')}</div>` : ''}
          <div class="gwrap"><canvas data-chart="${n}"></canvas><div class="gtip" hidden></div></div></div>`).join('')}
      <details class="gtable"><summary>Show as a table</summary>${this.table(data, tab)}</details>`;
    if (data.length < 2) return;
    for (const cv of this.el.querySelectorAll('canvas[data-chart]')) {
      const chart = tab.charts[Number(cv.dataset.chart)];
      this.draw(cv, chart, data);
      cv.onpointermove = (e) => this.onHover(cv, chart, data, e);
      cv.onpointerleave = () => { cv.nextElementSibling.hidden = true; this.draw(cv, chart, data); };
    }
  }

  table(data, tab) {
    const cols = tab.charts.flatMap((c) => c.series.map(([k, name]) => [k, name, c.fmt]));
    const rows = data.slice(-24).reverse();
    return `<table><tr><th>Month</th>${cols.map(([, n]) => `<th>${n}</th>`).join('')}</tr>
      ${rows.map((s) => `<tr><td>${MONTHS[s.m]} ${s.y}</td>${cols.map(([k, , f]) => `<td>${f(s[k] ?? 0)}</td>`).join('')}</tr>`).join('')}</table>`;
  }

  layout(cv, chart, data) {
    const W = cv.clientWidth || 360, H = cv.clientHeight || 150;
    let lo = Infinity, hi = -Infinity;
    for (const s of data) for (const [k] of chart.series) { const v = s[k] ?? 0; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (chart.max) { lo = 0; hi = Math.max(hi, chart.max); }
    if (lo > 0 && !chart.zero) lo = 0;
    if (chart.zero) lo = Math.min(lo, 0);
    if (hi - lo < 1e-9) hi = lo + 1;
    const step = niceStep(hi - lo, 4);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const pad = { l: 54, r: 70, t: 8, b: 20 };
    const x = (k) => pad.l + (W - pad.l - pad.r) * (data.length === 1 ? 0 : k / (data.length - 1));
    const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
    return { W, H, lo, hi, step, pad, x, y };
  }

  draw(cv, chart, data, hoverIdx = null) {
    const L = this.layout(cv, chart, data), dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(L.W * dpr); cv.height = Math.round(L.H * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = SURFACE; ctx.fillRect(0, 0, L.W, L.H);
    ctx.font = '11px Nunito, system-ui, sans-serif';
    // Recessive hairline grid with value ticks
    ctx.strokeStyle = GRID; ctx.lineWidth = 1; ctx.fillStyle = MUTED; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = L.lo; v <= L.hi + L.step / 2; v += L.step) {
      const yy = Math.round(L.y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(L.pad.l, yy); ctx.lineTo(L.W - L.pad.r, yy); ctx.stroke();
      ctx.fillText(chart.fmt(v), L.pad.l - 6, yy);
    }
    // Year ticks along the bottom
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const years = [];
    data.forEach((s, k) => { if (k === 0 || s.y !== data[k - 1].y) years.push([k, s.y]); });
    const every = Math.max(1, Math.ceil(years.length / 6));
    years.forEach(([k, yr], n) => { if (n % every === 0) ctx.fillText(String(yr), L.x(k), L.H - 5); });
    // Lines (2px, round), then end labels in text ink beside a small colour key
    const ends = [];
    chart.series.forEach(([key, name], n) => {
      ctx.strokeStyle = SERIES[n]; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      data.forEach((s, k) => { const px = L.x(k), py = L.y(s[key] ?? 0); if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.stroke();
      const last = data[data.length - 1][key] ?? 0;
      ends.push({ n, y: L.y(last), text: chart.fmt(last), name });
    });
    ends.sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13; // keep labels apart
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const e of ends) {
      ctx.fillStyle = SERIES[e.n]; ctx.fillRect(L.W - L.pad.r + 6, e.y - 1, 8, 2);
      ctx.fillStyle = INK; ctx.fillText(e.text, L.W - L.pad.r + 17, e.y);
    }
    if (hoverIdx != null) {
      const hx = Math.round(L.x(hoverIdx)) + 0.5;
      ctx.strokeStyle = '#b9c3cf'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hx, L.pad.t); ctx.lineTo(hx, L.H - L.pad.b); ctx.stroke();
      chart.series.forEach(([key], n) => {
        const py = L.y(data[hoverIdx][key] ?? 0);
        ctx.fillStyle = SURFACE; ctx.beginPath(); ctx.arc(hx, py, 6, 0, Math.PI * 2); ctx.fill(); // surface ring
        ctx.fillStyle = SERIES[n]; ctx.beginPath(); ctx.arc(hx, py, 4, 0, Math.PI * 2); ctx.fill();
      });
    }
    return L;
  }

  onHover(cv, chart, data, e) {
    const r = cv.getBoundingClientRect(), L = this.layout(cv, chart, data);
    const t = (e.clientX - r.left - L.pad.l) / (L.W - L.pad.l - L.pad.r);
    const k = Math.max(0, Math.min(data.length - 1, Math.round(t * (data.length - 1))));
    this.draw(cv, chart, data, k);
    const tip = cv.nextElementSibling, s = data[k];
    tip.hidden = false;
    tip.innerHTML = `<b>${MONTHS[s.m]} ${s.y}</b>${chart.series.map(([key, name], n) => `<div><i style="background:${SERIES[n]}"></i>${name} <b>${chart.fmt(s[key] ?? 0)}</b></div>`).join('')}`;
    const x = L.x(k);
    tip.style.left = `${x > L.W / 2 ? x - tip.offsetWidth - 10 : x + 10}px`;
    tip.style.top = '6px';
  }
}
