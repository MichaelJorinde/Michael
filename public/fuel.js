// Tanken: actuele prijzen bij Maes Buggenhout, dagelijkse historiek en wanneer je best tankt.
import { lineChart, legend } from './charts.js';
import { pageHead, info } from './ui.js';

const SERIES = [
  { key: 'euro95', label: 'Euro 95', color: 'var(--c1)' },
  { key: 'diesel', label: 'Diesel B7', color: 'var(--c2)' },
];
const RANGES = [['1M', 31], ['3M', 92], ['1J', 366], ['Alles', 0]];

// Vandaag t.o.v. de voorbije 30 dagen: goedkoop, gemiddeld of duur.
export function fuelVerdict(history, key) {
  const pts = history.filter((h) => h[key] != null);
  if (!pts.length) return null;
  const last = pts[pts.length - 1];
  const prev = pts.length > 1 ? pts[pts.length - 2] : null;
  const window = pts.slice(-31, -1);
  const out = { price: last[key], change: prev ? last[key] - prev[key] : null, days: pts.length };
  if (window.length < 7) return { ...out, level: null };
  const avg = window.reduce((s, h) => s + h[key], 0) / window.length;
  const min = Math.min(...window.map((h) => h[key]));
  const diff = last[key] / avg - 1;
  out.avg = avg;
  out.min = min;
  out.diff = diff;
  out.level = last[key] <= min + 0.005 || diff <= -0.02 ? 'excellent' : diff <= -0.005 ? 'good' : diff >= 0.01 ? 'high' : 'fair';
  return out;
}
const LEVEL = {
  excellent: { t: 'Nu tanken', note: 'Bij de laagste prijzen van de voorbije maand.' },
  good: { t: 'Goed moment', note: 'Onder het gemiddelde van de voorbije maand.' },
  fair: { t: 'Gemiddeld', note: 'Ongeveer de gewone prijs van de voorbije maand.' },
  high: { t: 'Liever wachten', note: 'Duurder dan gemiddeld; tank enkel wat je nodig hebt.' },
};

export function fuelViews({ app, api, esc, num, setChrome }) {
  let range = '3M';
  const price = (v) => (v == null ? '—' : `€ ${num(v, 3)}`);
  const cents = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${num(Math.abs(v) * 100, 1)} ct`;

  async function overview() {
    setChrome('f-overview', 'fuel');
    app.innerHTML = '<div class="loading">Prijzen laden…</div>';
    const d = await api('fuel');
    const history = d.history || [];
    const card = (s) => {
      const v = fuelVerdict(history, s.key);
      const live = d.prices[s.key] ?? v?.price ?? null;
      return `<div class="stat">
        <div class="k"><i class="dot" style="background:${s.color}"></i>${esc(s.label)}</div>
        <div class="v num" style="font-size:1.35rem">${price(live)}</div>
        ${v?.change != null && v.change !== 0 ? `<div class="small ${v.change > 0 ? 'loss' : 'gain'}">${cents(v.change)} t.o.v. vorige</div>` : '<div class="muted small">per liter</div>'}
        ${v?.level ? `<div style="margin-top:6px"><span class="vbadge vbadge-${v.level}">${esc(LEVEL[v.level].t)}</span></div>` : ''}
      </div>`;
    };
    const verdicts = SERIES.map((s) => ({ s, v: fuelVerdict(history, s.key) })).filter((x) => x.v?.level);

    app.innerHTML = `
      <div class="stack">
        ${pageHead('Tanken', `<a class="btn btn-ghost btn-small" href="${esc(d.station.url)}" target="_blank" rel="noopener">Maes ›</a>`, `${esc(d.station.name)} · ${esc(d.station.address)}`)}
        <section class="card hero">
          <div class="label">Prijs vandaag</div>
          <div class="stats" style="margin-top:8px">${SERIES.map(card).join('')}</div>
          ${d.error && !Object.keys(d.prices).length ? `<p class="muted small" style="margin:10px 0 0">Live prijs nu niet beschikbaar (${esc(d.error)}); laatst bewaarde prijs getoond.</p>` : ''}
          ${verdicts.length ? `<div style="margin-top:10px">${verdicts.map(({ s, v }) => `<p class="small" style="margin:4px 0 0"><b>${esc(s.label)}:</b> ${esc(LEVEL[v.level].note)} Gemiddeld ${price(v.avg)}, laagste ${price(v.min)}.</p>`).join('')}</div>`
            : `<p class="muted small" style="margin:10px 0 0">Vanaf 7 dagen historiek zie je hier of het een goed moment is om te tanken. Nu: ${history.length} dag${history.length === 1 ? '' : 'en'}.</p>`}
        </section>
        <section class="card chart-card">
          <div class="chart-head"><h2>Prijsverloop</h2></div>
          <div class="chips" style="margin-top:8px">${RANGES.map(([k]) => `<button type="button" class="chip ${k === range ? 'active' : ''}" data-range="${k}">${k}</button>`).join('')}</div>
          ${legend(SERIES)}
          <div id="ch-fuel"></div>
          ${history.length < 2 ? '<p class="muted small">De grafiek vult zich vanaf vandaag elke dag aan.</p>' : ''}
          ${info('De prijs wordt elke dag twee keer opgehaald bij Maes (rond 7u en 16u) en bewaard. "Nu tanken" = bij de laagste prijs van de voorbije 30 dagen of minstens 2% onder het gemiddelde; "Liever wachten" = minstens 1% duurder dan gemiddeld. In België volgen de prijzen de officiële maximumprijzen, die vaak al de dag ervoor aangekondigd worden.', 'Hoe werkt dit?')}
        </section>
      </div>`;

    const draw = () => {
      const el = document.getElementById('ch-fuel');
      if (!el || history.length < 2) return;
      const days = RANGES.find(([k]) => k === range)[1];
      const from = days ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : '';
      const pts = history.filter((h) => h.date >= from).map((h) => ({ d: h.date, euro95: h.euro95, diesel: h.diesel }));
      if (pts.length < 2) { el.innerHTML = '<p class="muted small">Nog te weinig dagen in deze periode.</p>'; return; }
      lineChart(el, {
        points: pts, series: SERIES, yFormat: price, yTick: (v) => num(v, 2),
        dateFormat: (dd, long) => new Date(`${dd}T00:00:00`).toLocaleDateString('nl-BE', long ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' }),
      });
    };
    draw();
    app.querySelectorAll('.chip[data-range]').forEach((b) => b.addEventListener('click', () => {
      range = b.dataset.range;
      app.querySelectorAll('.chip[data-range]').forEach((c) => c.classList.toggle('active', c === b));
      draw();
    }));
  }

  return { overview };
}
