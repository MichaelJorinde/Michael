// Energie: maandelijks totaalverbruik (HomeWizard), tarieven en overzicht per maand.
import { pageHead, info } from './ui.js';
import { columnChart, legend } from './charts.js';

const UTIL = {
  elec: { label: 'Elektriciteit', color: 'var(--c1)' },
  gas: { label: 'Gas', color: 'var(--c2)' },
  water: { label: 'Water', color: 'var(--c3)' },
};
const USAGE_FIELDS = [
  { key: 'elec_import', group: 'Elektriciteit', label: 'Afname', unit: 'kWh' },
  { key: 'elec_export', group: 'Elektriciteit', label: 'Injectie', unit: 'kWh' },
  { key: 'gas', group: 'Gas', label: 'Verbruik', unit: 'm³' },
  { key: 'water', group: 'Water', label: 'Verbruik', unit: 'liter' },
];
const TARIFF_GROUPS = [
  { group: 'Elektriciteit', fields: [
    { key: 'elec_import', label: 'Afname', unit: '€/kWh', ph: '0,259' },
    { key: 'elec_export', label: 'Injectievergoeding', unit: '€/kWh', ph: '0,009' },
    { key: 'fixed_elec', label: 'Vaste kosten', unit: '€/maand', ph: '0', hint: 'Optioneel: abonnement, capaciteitstarief… (jaarbedrag ÷ 12).' },
  ] },
  { group: 'Gas', fields: [
    { key: 'gas', label: 'Prijs', unit: '€/m³', ph: '0,760' },
    { key: 'fixed_gas', label: 'Vaste kosten', unit: '€/maand', ph: '0' },
  ] },
  { group: 'Water', fields: [
    { key: 'water', label: 'Prijs', unit: '€/m³', ph: '5,910', hint: 'Prijs per m³ (1 m³ = 1.000 liter).' },
    { key: 'fixed_water', label: 'Vaste kosten', unit: '€/maand', ph: '0' },
  ] },
];

export function energyViews({ app, api, esc, money, num, toast, submitting, setChrome, today, parseNum, dateFmt, cls }) {
  const pref = { util: 'total', year: null };
  try { pref.util = sessionStorage.getItem('energy-util') || 'total'; } catch { /* privémodus */ }

  const eur = (v) => (v == null ? '—' : money(v, 'EUR'));
  const kwh = (v) => (v == null ? '—' : `${num(v, 1)} kWh`);
  const m3 = (v) => (v == null ? '—' : `${num(v, 2)} m³`);
  const liter = (v) => (v == null ? '—' : `${num(v, 0)} L`);
  const UNIT_FMT = { elec: kwh, gas: m3, water: liter };
  const UNIT = { elec: 'kWh', gas: 'm³', water: 'L' };
  const dec = (v) => (v == null || v === '' ? '' : String(v).replace('.', ','));
  const sum = (arr) => arr.reduce((a, b) => a + (b ?? 0), 0);
  const compactEur = (v) => new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const compactNum = (v) => new Intl.NumberFormat('nl-BE', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const monthShort = (i) => new Date(2000, i, 1).toLocaleDateString('nl-BE', { month: 'short' }).replace('.', '');
  const monthName = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });
  const addMonths = (ym, n) => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return d.toISOString().slice(0, 7);
  };

  // Eindafrekening: werkelijke kosten vs. betaalde voorschotten binnen de afrekeningsperiode,
  // plus een prognose voor de maanden zonder gegevens.
  function settlement(allMonths, s) {
    if (!s || !s.advance || !allMonths.length) return null;
    const covers = s.covers.split(',');
    const byMonth = Object.fromEntries(allMonths.map((m) => [m.month, m]));
    const costOf = (m) => {
      if (!m) return null;
      const parts = covers.map((k) => m[k]?.cost).filter((c) => c != null);
      return parts.length ? sum(parts) : null;
    };
    const latest = allMonths[allMonths.length - 1].month;
    let start = s.period_start;
    while (addMonths(start, 12) <= latest) start = addMonths(start, 12);
    while (start > latest) start = addMonths(start, -12);
    const keys = Array.from({ length: 12 }, (_, i) => addMonths(start, i));
    const actual = keys.filter((k) => costOf(byMonth[k]) != null);
    if (!actual.length) return null;
    const avg = sum(actual.map((k) => costOf(byMonth[k]))) / actual.length;
    // Schatting voor maanden zonder gegevens, in volgorde van voorkeur:
    // 1. dezelfde maand vorig jaar;
    // 2. de 'spiegelmaand' in het stookseizoen (okt≈apr, nov≈mrt, dec≈feb, …), meest recente eerst;
    // 3. het gemiddelde van de gekende maanden.
    const mirrorOf = (k) => String((((2 - Number(k.slice(5))) % 12) + 12) % 12 || 12).padStart(2, '0');
    const recentWithMonth = (mm) => allMonths.filter((m) => m.month.slice(5) === mm && costOf(m) != null).pop();
    const rows = keys.map((k) => {
      const c = costOf(byMonth[k]);
      if (c != null) return { month: k, actual: true, cost: c, parts: Object.fromEntries(covers.map((u) => [u, byMonth[k][u]?.cost ?? 0])) };
      const ly = costOf(byMonth[addMonths(k, -12)]);
      if (ly != null) return { month: k, actual: false, cost: ly, basis: 'vorig jaar' };
      const mirror = recentWithMonth(mirrorOf(k));
      if (mirror) return { month: k, actual: false, cost: costOf(mirror), basis: `zoals ${monthName(mirror.month)}` };
      return { month: k, actual: false, cost: avg, basis: 'gemiddelde' };
    });
    const costSoFar = sum(rows.filter((r) => r.actual).map((r) => r.cost));
    const paidSoFar = s.advance * actual.length;
    const projected = sum(rows.map((r) => r.cost));
    return {
      start, end: keys[11], covers, advance: s.advance, rows,
      monthsKnown: actual.length, costSoFar, paidSoFar, balanceNow: paidSoFar - costSoFar,
      projected, paidTotal: s.advance * 12, balanceEnd: s.advance * 12 - projected,
    };
  }

  const prevMonth = () => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return d.toLocaleDateString('sv-SE').slice(0, 7);
  };

  // Zelfde berekening als de server, voor de live voorvertoning in het formulier.
  function tariffFor(tariffs, month) {
    const sorted = [...tariffs].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
    let found = sorted[0] || null;
    for (const t of sorted) if (t.valid_from.slice(0, 7) <= month) found = t;
    return found;
  }
  function costs(u, t) {
    if (!t) return null;
    const has = (k) => u[k] != null;
    const elec = has('elec_import') || has('elec_export')
      ? (u.elec_import ?? 0) * t.elec_import - (u.elec_export ?? 0) * t.elec_export + t.fixed_elec : null;
    const gas = has('gas') ? u.gas * t.gas + t.fixed_gas : null;
    const water = has('water') ? (u.water / 1000) * t.water + t.fixed_water : null;
    const parts = [elec, gas, water].filter((x) => x != null);
    return { elec, gas, water, total: parts.length ? sum(parts) : null };
  }

  // Water opvolgen: liter per dag, vergelijking met eerdere maanden en kosten t.o.v. het watervoorschot.
  function waterCard(allMonths, s, hasTariff) {
    const w = allMonths.filter((m) => m.water);
    const adv = s?.water_advance || 0;
    if (!w.length) {
      return `<section class="card accent-card stack">
        <h2>Water opvolgen</h2>
        <p>Geef vanaf nu elke maand je waterverbruik in liter in, uit de HomeWizard Watermeter. Dan zie je hier je verbruik per dag, ongewone pieken (bv. een lek) en of je ${adv ? `voorschot van ${eur(adv)}/maand` : 'voorschot'} volstaat.</p>
        <a class="btn" href="#/energy/month/${prevMonth()}">Water van ${esc(monthName(prevMonth()))} ingeven</a>
      </section>`;
    }
    const days = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0).getDate();
    const perDay = (m) => m.water.usage / days(m.month);
    const last = w[w.length - 1];
    const prev = w.slice(0, -1);
    const avgPrev = prev.length ? sum(prev.map(perDay)) / prev.length : null;
    const diff = avgPrev ? perDay(last) / avgPrev - 1 : null;
    const alert = diff != null && diff > 0.25;
    // Het voorschot-saldo telt enkel echt gemeten maanden, niet de geschatte jaren uit oude afrekeningen.
    const costs = w.filter((m) => !(m.note || '').startsWith('Water: schatting')).map((m) => m.water.cost).filter((c) => c != null);
    const costSoFar = sum(costs);
    const paid = adv * costs.length;
    const balance = paid - costSoFar;
    return `<section class="card ${alert ? 'accent-card' : ''}">
      <div class="chart-head"><h2>Water opvolgen</h2><a class="small" href="#/energy/settings">Voorschot ›</a></div>
      <p class="muted small" style="margin:2px 0 0">Laatste maand: ${esc(monthName(last.month))}</p>
      <div class="stats" style="margin-top:10px">
        <div class="stat"><div class="k">Per dag</div><div class="v num">${num(perDay(last), 0)} L</div>
          ${diff != null ? `<div class="small ${diff > 0.05 ? 'loss' : diff < -0.05 ? 'gain' : 'muted'}">${diff >= 0 ? '+' : '−'}${num(Math.abs(diff) * 100, 0)}% t.o.v. gemiddeld</div>` : '<div class="muted small">eerste maand</div>'}</div>
        <div class="stat"><div class="k">Deze maand</div><div class="v num">${liter(last.water.usage)}</div><div class="muted small">${num(last.water.usage / 1000, 1)} m³</div></div>
        ${hasTariff ? `<div class="stat"><div class="k">Kosten deze maand</div><div class="v num">${eur(last.water.cost)}</div>${adv ? `<div class="muted small">voorschot ${eur(adv)}</div>` : ''}</div>` : ''}
        ${hasTariff && adv ? `<div class="stat"><div class="k">Saldo t.o.v. voorschot (${costs.length} mnd)</div><div class="v num ${cls(balance)}">${balance >= 0 ? '+' : '−'}${eur(Math.abs(balance))}</div><div class="muted small">${balance >= 0 ? 'je betaalt genoeg' : 'voorschot te laag'}</div></div>` : ''}
      </div>
      ${alert ? `<p class="banner" style="margin-top:12px">⚠️ Je verbruikte ${num(diff * 100, 0)}% meer per dag dan gemiddeld. Kijk in de HomeWizard-app of er 's nachts water blijft lopen (lekkende kraan of wc).</p>` : ''}
      ${info('Kosten = verbruik × je waterprijs per m³ plus vaste kosten (zie Tarieven). Geef de vaste vergoeding van je waterfactuur in bij Tarieven voor een juistere vergelijking. Een gemiddeld Vlaams gezin verbruikt zo\'n 100 liter per persoon per dag.')}
    </section>`;
  }

  const table = (head, rows) => `
    <details class="table-view"><summary>Toon als tabel</summary>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    </details>`;

  // ---------- overzicht ----------

  async function overview() {
    setChrome('e-overview', 'energy');
    app.innerHTML = '<div class="loading">Energie laden…</div>';
    const data = await api('energy/monthly');
    const hasTariff = data.tariffs.length > 0;
    if (!data.months.length) {
      app.innerHTML = `
        <section class="card empty stack">
          <h2>Energie opvolgen</h2>
          <p>Geef één keer per maand je totaalverbruik in uit de HomeWizard Energy-app: elektriciteit (afname en injectie), gas en water.</p>
          ${hasTariff ? '' : '<p class="small">Stel ook je <a href="#/energy/tariffs">tarieven</a> in, dan zie je meteen de kosten.</p>'}
          <a class="btn" href="#/energy/add">Maandverbruik ingeven</a>
          <a href="#/energy/import" class="small">Of meerdere maanden tegelijk importeren</a>
        </section>`;
      return;
    }

    const years = [...new Set(data.months.map((m) => Number(m.month.slice(0, 4))))].sort();
    const year = years.includes(pref.year) ? pref.year : years[years.length - 1];
    const util = pref.util;
    const byMonth = Object.fromEntries(data.months.map((m) => [m.month, m]));
    const keys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    const months = keys.map((k) => byMonth[k] || null);
    const filled = months.filter(Boolean);
    const labels = keys.map((_, i) => monthShort(i));
    const longLabels = keys.map(monthName);

    const chips = `
      <div class="chips">${[['total', 'Totaal'], ...Object.entries(UTIL).map(([k, u]) => [k, u.label]), ['battery', '🔋 Batterij']].map(([k, l]) => `
        <button type="button" class="chip ${k === util ? 'active' : ''}" data-util="${k}">${l}</button>`).join('')}</div>
      ${years.length > 1 ? `<div class="chips">${years.map((y) => `
        <button type="button" class="chip ${y === year ? 'active' : ''}" data-year="${y}">${y}</button>`).join('')}</div>` : ''}`;
    const tariffBanner = hasTariff ? '' : '<p class="banner">Stel je <a href="#/energy/tariffs">tarieven</a> in om ook de kosten te zien.</p>';

    let body;
    let drawCharts;
    if (util === 'battery') {
      ({ body, draw: drawCharts } = batteryView(data));
    } else if (util === 'total') {
      const costSeries = Object.entries(UTIL).map(([k, u]) => ({ key: k, label: u.label, color: u.color }));
      const perUtil = Object.fromEntries(Object.keys(UTIL).map((k) => [k, sum(filled.map((m) => m[k]?.cost))]));
      const costMonths = filled.filter((m) => m.total != null);
      const yearTotal = sum(costMonths.map((m) => m.total));
      const st = hasTariff ? settlement(data.months, data.settings) : null;
      const coverLabel = (c) => c.map((k) => UTIL[k].label.toLowerCase()).join(' + ');
      const verdict = (v) => (v >= 0 ? `≈ ${eur(v)} terug` : `≈ ${eur(-v)} bijbetalen`);
      const settleSeries = st ? [
        ...st.covers.map((k) => ({ key: k, label: UTIL[k].label, color: UTIL[k].color })),
        { key: 'est', label: 'Schatting', color: 'var(--muted)' },
      ] : [];
      const settleCard = st ? `
        <section class="card chart-card">
          <div class="chart-head"><h2>Eindafrekening</h2><a class="small" href="#/energy/settings">Voorschot ›</a></div>
          <p class="muted small" style="margin:2px 0 0">${esc(monthName(st.start))} – ${esc(monthName(st.end))} · ${esc(coverLabel(st.covers))}</p>
          <div class="big num ${cls(st.balanceEnd)}" style="font-size:1.9rem;font-weight:800;margin-top:10px">${verdict(st.balanceEnd)}</div>
          <div class="stats" style="margin-top:12px">
            <div class="stat"><div class="k">Saldo nu (${st.monthsKnown} mnd)</div><div class="v num ${cls(st.balanceNow)}">${st.balanceNow >= 0 ? '+' : '−'}${eur(Math.abs(st.balanceNow))}</div></div>
            <div class="stat"><div class="k">Prognose 12 mnd</div><div class="v num">${eur(st.projected)}</div><div class="muted small">voorschot ${eur(st.paidTotal)}</div></div>
          </div>
          <div id="ch-s" style="margin-top:12px"></div>
          ${legend(settleSeries)}
          ${info(`Je betaalt ${eur(st.advance)} per maand voorschot. Tot nu betaalde je ${eur(st.paidSoFar)} en verbruikte je voor ${eur(st.costSoFar)}. De stippellijn in de grafiek is het voorschot; vage kolommen zijn geschat met dezelfde maand vorig jaar, of anders met een vergelijkbare maand uit het stookseizoen (oktober ≈ april, november ≈ maart, december ≈ februari). Hoe meer maanden je ingeeft, hoe juister de prognose.`, 'Hoe wordt dit berekend?')}
          ${table(['Maand', 'Kosten', 'Voorschot', 'Verschil'], st.rows.map((r) => [`${monthShort(Number(r.month.slice(5)) - 1)} ${r.month.slice(2, 4)}${r.actual ? '' : ` (schatting, ${r.basis})`}`, eur(r.cost), eur(st.advance), `${st.advance - r.cost >= 0 ? '+' : '−'}${eur(Math.abs(st.advance - r.cost))}`]))}
        </section>` : (hasTariff && !data.settings?.advance ? '<p class="banner">Stel je <a href="#/energy/settings">maandelijks voorschot</a> in om je eindafrekening te volgen.</p>' : '');
      body = `
        <section class="card hero">
          <div class="label">Kosten ${year}</div>
          <div class="big num">${hasTariff ? eur(yearTotal) : '—'}</div>
          <div class="stats">
            ${Object.entries(UTIL).map(([k, u]) => `<div class="stat"><div class="k">${u.label}</div><div class="v num">${hasTariff ? eur(perUtil[k]) : '—'}</div></div>`).join('')}
            <div class="stat"><div class="k">Gemiddeld / maand</div><div class="v num">${costMonths.length ? eur(yearTotal / costMonths.length) : '—'}</div></div>
          </div>
        </section>
        ${tariffBanner}
        ${settleCard}
        ${hasTariff ? `
        <section class="card chart-card">
          <h2>Kosten per maand</h2>
          ${legend(costSeries)}
          <div id="ch-a"></div>
          ${table(['Maand', 'Elek.', 'Gas', 'Water', 'Totaal'], filled.map((m) => [monthShort(Number(m.month.slice(5)) - 1), eur(m.elec?.cost), eur(m.gas?.cost), eur(m.water?.cost), eur(m.total)]))}
        </section>` : ''}
        <section class="card">
          <h2>Verbruik ${year}</h2>
          <dl class="kv" style="margin-top:10px">
            <dt>Elektriciteit afname</dt><dd>${kwh(sum(filled.map((m) => m.elec?.import)))}</dd>
            <dt>Elektriciteit injectie</dt><dd>${kwh(sum(filled.map((m) => m.elec?.export)))}</dd>
            <dt>Gas</dt><dd>${m3(sum(filled.map((m) => m.gas?.usage)))}</dd>
            <dt>Water</dt><dd>${liter(sum(filled.map((m) => m.water?.usage)))}</dd>
          </dl>
        </section>`;
      drawCharts = () => {
        if (!hasTariff) return;
        columnChart(document.getElementById('ch-a'), {
          labels, longLabels, series: costSeries, format: eur, tickFormat: compactEur,
          rows: months.map((m) => m && Object.fromEntries(Object.keys(UTIL).map((k) => [k, m[k]?.cost ?? null]))),
        });
        if (st) {
          columnChart(document.getElementById('ch-s'), {
            labels: st.rows.map((r) => monthShort(Number(r.month.slice(5)) - 1)),
            longLabels: st.rows.map((r) => monthName(r.month)),
            series: settleSeries, format: eur, tickFormat: compactEur,
            rows: st.rows.map((r) => (r.actual ? r.parts : { est: r.cost })),
            faded: st.rows.map((r) => !r.actual),
            refLine: { value: st.advance, label: `Voorschot ${eur(st.advance)}` },
          });
        }
      };
    } else {
      const u = UTIL[util];
      const fmt = UNIT_FMT[util];
      const isElec = util === 'elec';
      const have = filled.filter((m) => m[util]);
      const yearCost = sum(have.map((m) => m[util].cost));
      const usageSeries = isElec
        ? [{ key: 'import', label: 'Afname', color: 'var(--c1)' }, { key: 'export', label: 'Injectie', color: 'var(--c3)' }]
        : [{ key: 'usage', label: `Verbruik ${u.label.toLowerCase()}`, color: u.color }];
      body = `
        <section class="card hero">
          <div class="label">${u.label} · kosten ${year}</div>
          <div class="big num">${hasTariff ? eur(yearCost) : '—'}</div>
          <div class="stats">
            ${isElec ? `
            <div class="stat"><div class="k">Afname</div><div class="v num">${kwh(sum(have.map((m) => m.elec.import)))}</div></div>
            <div class="stat"><div class="k">Injectie</div><div class="v num">${kwh(sum(have.map((m) => m.elec.export)))}</div></div>
            <div class="stat"><div class="k">Netto afname</div><div class="v num">${kwh(sum(have.map((m) => m.elec.net)))}</div></div>`
              : `<div class="stat"><div class="k">Verbruik</div><div class="v num">${fmt(sum(have.map((m) => m[util].usage)))}</div></div>`}
            <div class="stat"><div class="k">Gemiddeld / maand</div><div class="v num">${have.length && hasTariff ? eur(yearCost / have.length) : '—'}</div></div>
          </div>
        </section>
        ${tariffBanner}
        ${util === 'water' ? waterCard(data.months, data.settings, hasTariff) : ''}
        ${have.length ? `
        <section class="card chart-card">
          <h2>Verbruik per maand</h2>
          ${isElec ? legend(usageSeries) : ''}
          <div id="ch-u"></div>
          ${isElec ? '<p class="muted small">Injectie staat onder de nullijn.</p>' : ''}
        </section>
        ${hasTariff ? `
        <section class="card chart-card">
          <h2>Kosten per maand</h2>
          <div id="ch-c"></div>
          ${isElec ? '<p class="muted small">Afname min injectievergoeding, plus vaste kosten.</p>' : ''}
        </section>` : ''}
        <section class="card">
          <h2>Per maand</h2>
          <div class="tbl-wrap" style="max-height:none"><table class="tbl" style="margin-top:8px">
            <thead><tr><th>Maand</th>${isElec ? '<th>Afname (kWh)</th><th>Injectie (kWh)</th>' : `<th>Verbruik (${UNIT[util]})</th>`}<th>Kosten</th></tr></thead>
            <tbody>${have.slice().reverse().map((m) => `<tr>
              <td><a href="#/energy/month/${m.month}">${esc(monthShort(Number(m.month.slice(5)) - 1))}</a></td>
              ${isElec ? `<td>${num(m.elec.import, 1)}</td><td>${num(m.elec.export, 1)}</td>` : `<td>${num(m[util].usage, util === 'gas' ? 2 : 0)}</td>`}
              <td>${eur(m[util].cost)}</td></tr>`).join('')}</tbody>
          </table></div>
        </section>` : `<section class="card empty">Nog geen verbruik voor ${u.label.toLowerCase()} in ${year}.</section>`}`;
      drawCharts = () => {
        if (!have.length) return;
        columnChart(document.getElementById('ch-u'), {
          labels, longLabels, series: usageSeries, format: fmt, tickFormat: compactNum, totalLabel: 'Netto',
          rows: months.map((m) => m && m[util] && (isElec ? { import: m.elec.import, export: -m.elec.export } : { usage: m[util].usage })),
        });
        if (hasTariff) {
          columnChart(document.getElementById('ch-c'), {
            labels, longLabels, series: [{ key: 'cost', label: `Kosten ${u.label.toLowerCase()}`, color: u.color }],
            format: eur, tickFormat: compactEur, rows: months.map((m) => m && m[util] && { cost: m[util].cost }),
          });
        }
      };
    }

    app.innerHTML = `<div class="stack">${pageHead('Energie', '<a class="btn btn-small" href="#/energy/add">+ Maand</a>')}${chips}${body}</div>`;
    drawCharts();
    app.querySelectorAll('.chip[data-util]').forEach((b) => b.addEventListener('click', () => {
      pref.util = b.dataset.util;
      try { sessionStorage.setItem('energy-util', pref.util); } catch { /* privémodus */ }
      overview();
    }));
    app.querySelectorAll('.chip[data-year]').forEach((b) => b.addEventListener('click', () => {
      pref.year = Number(b.dataset.year);
      overview();
    }));
  }

  // ---------- thuisbatterij (simulatie) ----------

  const BAT_DEFAULTS = { price: 1000, bebat: 180, bebatIncluded: false, usable: 4.6, type: 'stekker', keuring: 150 };
  const BAT_TYPES = {
    stekker: { label: 'Stekker (max. 800 W)', factor: 0.85, note: 'Geen keuring nodig; met een digitale meter ook geen melding bij Fluvius.' },
    vast: { label: 'Vaste aansluiting (±2,5 kW)', factor: 0.92, note: 'Keuring en melding bij Fluvius verplicht; vangt ook grotere verbruikspieken op.' },
  };
  const EFF = 0.88; // rendement laden + ontladen
  const EVENING_SHARE = 0.65; // deel van de afname wanneer de zon niet schijnt

  function loadBat() {
    try { return { ...BAT_DEFAULTS, ...JSON.parse(localStorage.getItem('battery-sim') || '{}') }; } catch { return { ...BAT_DEFAULTS }; }
  }
  function saveBat(o) {
    try { localStorage.setItem('battery-sim', JSON.stringify(o)); } catch { /* privémodus */ }
  }

  // Per kalendermaand: hoeveel zonne-overschot de batterij 's avonds kan inzetten, en wat dat bespaart.
  // Maanden zonder gegevens: zelfde maand vorig jaar, anders de 'zonnespiegel' (okt≈mrt, nov≈feb, dec≈jan, …), anders het gemiddelde.
  function simulateBattery(allMonths, tariffs, o) {
    const factor = BAT_TYPES[o.type].factor;
    const withElec = allMonths.filter((m) => m.elec && tariffFor(tariffs, m.month));
    const latest = (mm) => withElec.filter((m) => Number(m.month.slice(5)) === mm).pop();
    const calc = (m) => {
      const [y, mo] = m.month.split('-').map(Number);
      const days = new Date(y, mo, 0).getDate();
      const t = tariffFor(tariffs, m.month);
      const charge = Math.min(m.elec.export / days, o.usable);
      const need = (EVENING_SHARE * m.elec.import) / days;
      const kwh = Math.min(charge * EFF, need) * factor * days;
      return { kwh, eur: kwh * t.elec_import - (kwh / EFF) * t.elec_export, exp: m.elec.export, imp: m.elec.import };
    };
    let rows = Array.from({ length: 12 }, (_, i) => {
      const mm = i + 1;
      const own = latest(mm);
      if (own) return { mm, src: 'actual', from: own.month, ...calc(own) };
      const mirror = latest(13 - mm);
      if (mirror) return { mm, src: 'mirror', from: mirror.month, ...calc(mirror) };
      return { mm, src: 'avg' };
    });
    const known = rows.filter((r) => r.src !== 'avg');
    if (!known.length) return null;
    const avg = (k) => sum(known.map((r) => r[k])) / known.length;
    rows = rows.map((r) => (r.src === 'avg' ? { ...r, kwh: avg('kwh'), eur: avg('eur'), exp: avg('exp'), imp: avg('imp') } : r));
    const cost = o.price + (o.bebatIncluded ? 0 : o.bebat) + (o.type === 'vast' ? o.keuring : 0);
    const yearEur = sum(rows.map((r) => r.eur));
    const yearKwh = sum(rows.map((r) => r.kwh));
    const yearExp = sum(rows.map((r) => r.exp));
    const yearImp = sum(rows.map((r) => r.imp));
    return { rows, cost, yearEur, yearKwh, yearExp, yearImp, actualMonths: rows.filter((r) => r.src === 'actual').length };
  }

  function batteryView(data) {
    const o = loadBat();
    if (!data.tariffs.length) {
      return { body: '<p class="banner">Stel eerst je <a href="#/energy/tariffs">tarieven</a> in; de besparing hangt af van je afname- en injectieprijs.</p>', draw: () => {} };
    }
    const body = `
      <div id="bat-results"></div>
      <section class="card">
        <details class="fold" id="bat-fold">
        <summary><div><h2>Batterij aanpassen</h2><div class="muted small" id="bat-sum"></div></div></summary>
        <form id="bat" novalidate autocomplete="off" style="margin-top:6px">
          <div class="field-row">
            <div class="field"><label for="b-price">Prijs batterij (€)</label><input id="b-price" inputmode="decimal" value="${esc(dec(o.price))}"></div>
            <div class="field"><label for="b-usable">Bruikbaar (kWh)</label><input id="b-usable" inputmode="decimal" value="${esc(dec(o.usable))}"></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="b-bebat">Bebat-bijdrage (€)</label><input id="b-bebat" inputmode="decimal" value="${esc(dec(o.bebat))}"></div>
            <div class="field" style="align-self:end"><label class="check"><input type="checkbox" id="b-bebat-in" ${o.bebatIncluded ? 'checked' : ''}> Zit al in de prijs</label></div>
          </div>
          <div class="field" style="margin-top:14px"><label for="b-type">Aansluiting</label>
            <select id="b-type">${Object.entries(BAT_TYPES).map(([k, t]) => `<option value="${k}" ${k === o.type ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
            <p class="hint" id="b-type-note"></p></div>
          <div class="field" id="b-keuring-wrap"><label for="b-keuring">Keuring + aansluiting (€)</label><input id="b-keuring" inputmode="decimal" value="${esc(dec(o.keuring))}"></div>
        </form>
        </details>
      </section>`;

    const draw = () => {
      const $ = (id) => document.getElementById(id);
      const read = () => ({
        price: parseNum($('b-price').value) || 0,
        usable: Math.max(0.5, parseNum($('b-usable').value) || BAT_DEFAULTS.usable),
        bebat: parseNum($('b-bebat').value) || 0,
        bebatIncluded: $('b-bebat-in').checked,
        type: $('b-type').value,
        keuring: parseNum($('b-keuring').value) || 0,
      });
      const renderResults = () => {
        const cur = read();
        saveBat(cur);
        $('b-type-note').textContent = BAT_TYPES[cur.type].note;
        $('b-keuring-wrap').hidden = cur.type !== 'vast';
        $('bat-sum').textContent = `${eur(cur.price)} · ${num(cur.usable, 1)} kWh · ${BAT_TYPES[cur.type].label}`;
        const sim = simulateBattery(data.months, data.tariffs, cur);
        const el = $('bat-results');
        if (!sim) { el.innerHTML = '<p class="banner">Nog geen elektriciteitsgegevens om mee te rekenen.</p>'; return; }
        const payback = sim.yearEur > 0 ? sim.cost / sim.yearEur : null;
        const roi = sim.cost > 0 ? sim.yearEur / sim.cost : null;
        const verdict = payback == null ? { level: 'high', t: 'Niet rendabel' }
          : payback <= 6 ? { level: 'excellent', t: 'Zeer interessant' }
            : payback <= 9 ? { level: 'good', t: 'Interessant' }
              : payback <= 12 ? { level: 'fair', t: 'Twijfelachtig' } : { level: 'high', t: 'Weinig interessant' };
        el.innerHTML = `
          <section class="card hero">
            <div class="row between"><div class="label">Thuisbatterij · besparing per jaar</div><span class="vbadge vbadge-${verdict.level}">${esc(verdict.t)}</span></div>
            <div class="big num">${eur(sim.yearEur)}</div>
            <div class="stats">
              <div class="stat"><div class="k">Totale kost</div><div class="v num">${eur(sim.cost)}</div>
                <div class="muted small">${cur.bebatIncluded ? 'Bebat inbegrepen' : `incl. ${eur(cur.bebat)} Bebat`}${cur.type === 'vast' ? ` + ${eur(cur.keuring)} keuring` : ''}</div></div>
              <div class="stat"><div class="k">Terugverdiend in</div><div class="v num">${payback ? `${num(payback, 1)} jaar` : '—'}</div></div>
              <div class="stat"><div class="k">Rendement per jaar</div><div class="v num">${roi != null ? `${num(roi * 100, 1)}%` : '—'}</div></div>
              <div class="stat"><div class="k">Winst na 10 jaar</div><div class="v num ${sim.yearEur * 10 - sim.cost >= 0 ? 'gain' : 'loss'}">${eur(sim.yearEur * 10 - sim.cost)}</div></div>
            </div>
          </section>
          <section class="card chart-card">
            <h2>Besparing per maand</h2>
            <div id="ch-bat"></div>
            ${info('Volle kolommen: berekend met jouw gegevens van die maand. Vage kolommen: geschat (zelfde maand vorig jaar, of een maand met evenveel zon).')}
          </section>
          <section class="card">
            <h2>Met en zonder batterij (per jaar)</h2>
            <dl class="kv" style="margin-top:10px">
              <dt>Injectie nu</dt><dd>${kwh(sim.yearExp)}</dd>
              <dt>Daarvan 's avonds zelf gebruikt</dt><dd>${kwh(sim.yearKwh)} (${num((sim.yearKwh / EFF / sim.yearExp) * 100, 0)}% van je injectie)</dd>
              <dt>Afname van het net nu</dt><dd>${kwh(sim.yearImp)}</dd>
              <dt>Afname met batterij</dt><dd>${kwh(sim.yearImp - sim.yearKwh)} (−${num((sim.yearKwh / sim.yearImp) * 100, 0)}%)</dd>
            </dl>
            ${table(['Maand', 'Injectie', 'Via batterij', 'Besparing'], sim.rows.map((r) => [`${monthShort(r.mm - 1)}${r.src === 'actual' ? '' : ' (geschat)'}`, kwh(r.exp), kwh(r.kwh), eur(r.eur)]))}
          </section>
          ${info(`Aannames: ${num(cur.usable, 1)} kWh bruikbaar, ${num(EFF * 100, 0)}% rendement, ${num(EVENING_SHARE * 100, 0)}% van je afname valt 's avonds/'s nachts, correctie voor bewolkte dagen en verbruikspieken. Gerekend met je eigen tarieven (afname min gemiste injectievergoeding). Zonder premie; geen dynamisch tarief. Dit is een schatting op basis van maandtotalen.`, 'Aannames van de simulatie')}`;
        columnChart(document.getElementById('ch-bat'), {
          labels: sim.rows.map((r) => monthShort(r.mm - 1)),
          longLabels: sim.rows.map((r) => `${new Date(2000, r.mm - 1, 1).toLocaleDateString('nl-BE', { month: 'long' })}${r.src === 'actual' ? ` ${r.from.slice(0, 4)}` : ' (geschat)'}`),
          rows: sim.rows.map((r) => ({ eur: r.eur })),
          faded: sim.rows.map((r) => r.src !== 'actual'),
          series: [{ key: 'eur', label: 'Besparing', color: 'var(--c1)' }],
          format: eur, tickFormat: compactEur,
        });
      };
      ['b-price', 'b-usable', 'b-bebat', 'b-keuring'].forEach((id) => $(id).addEventListener('input', renderResults));
      ['b-bebat-in', 'b-type'].forEach((id) => $(id).addEventListener('change', renderResults));
      renderResults();
    };
    return { body, draw };
  }

  // ---------- maandverbruik ----------

  async function monthForm(month) {
    setChrome(month ? 'e-months' : 'e-add', 'energy');
    app.innerHTML = '<div class="loading">Laden…</div>';
    const data = await api('energy/monthly');
    const byMonth = Object.fromEntries(data.months.map((m) => [m.month, m]));
    const toUsage = (m) => (m ? { elec_import: m.elec?.import ?? null, elec_export: m.elec?.export ?? null, gas: m.gas?.usage ?? null, water: m.water?.usage ?? null, note: m.note } : {});
    const initial = month || prevMonth();

    app.innerHTML = `
      <section class="card stack">
        <h1>Maandverbruik</h1>
        <p class="muted small">Neem de totalen van de maand over uit de HomeWizard Energy-app. Laat een veld leeg als je het (nog) niet hebt.</p>
        <form id="f" novalidate autocomplete="off">
          <div class="field"><label for="month">Maand</label>
            <input id="month" name="month" type="month" value="${initial}" max="${today().slice(0, 7)}" required>
            <p id="exists" class="hint"></p></div>
          ${['Elektriciteit', 'Gas', 'Water'].map((g) => `
            <fieldset class="field-group"><legend>${g}</legend>
              ${USAGE_FIELDS.filter((x) => x.group === g).map((x) => `
                <div class="field"><label for="${x.key}">${x.label} <span class="muted small">(${x.unit})</span></label>
                  <input id="${x.key}" name="${x.key}" inputmode="decimal"></div>`).join('')}
            </fieldset>`).join('')}
          <div class="field" style="margin-top:14px"><label for="note">Notitie (optioneel)</label>
            <input id="note" name="note" maxlength="200"></div>
          <div id="preview" class="card" style="margin-top:14px;box-shadow:none;background:var(--surface-2)"></div>
          <div class="field" style="margin-top:16px"><button class="btn-block" type="submit">Opslaan</button></div>
          <div class="field"><button id="del" class="btn-danger btn-block" type="button" hidden>Deze maand verwijderen</button></div>
        </form>
      </section>`;

    const f = document.getElementById('f');
    const read = () => Object.fromEntries(USAGE_FIELDS.map((x) => [x.key, f[x.key].value.trim() === '' ? null : parseNum(f[x.key].value)]));
    const fill = () => {
      const existing = byMonth[f.month.value];
      const u = toUsage(existing);
      USAGE_FIELDS.forEach((x) => { f[x.key].value = dec(u[x.key]); });
      f.note.value = u.note || '';
      document.getElementById('exists').textContent = existing ? 'Voor deze maand is al verbruik ingegeven; je past het nu aan.' : '';
      document.getElementById('del').hidden = !existing;
      preview();
    };
    const preview = () => {
      const t = tariffFor(data.tariffs, f.month.value);
      const el = document.getElementById('preview');
      if (!t) { el.innerHTML = '<p class="small muted" style="margin:0">Stel je <a href="#/energy/tariffs">tarieven</a> in om de kosten te zien.</p>'; return; }
      const c = costs(read(), t);
      el.innerHTML = `
        <h2>Kosten ${esc(monthName(f.month.value))}</h2>
        <dl class="kv" style="margin-top:8px">
          <dt>Elektriciteit</dt><dd>${eur(c.elec)}</dd>
          <dt>Gas</dt><dd>${eur(c.gas)}</dd>
          <dt>Water</dt><dd>${eur(c.water)}</dd>
          <dt><b>Totaal</b></dt><dd><b>${eur(c.total)}</b></dd>
        </dl>
        <p class="muted small" style="margin:6px 0 0">Tarief vanaf ${esc(dateFmt(t.valid_from))}</p>`;
    };
    f.month.addEventListener('change', fill);
    USAGE_FIELDS.forEach((x) => f[x.key].addEventListener('input', preview));
    fill();

    f.addEventListener('submit', (e) => {
      e.preventDefault();
      submitting(f, async () => {
        if (!f.month.value) throw new Error('Kies een maand');
        await api(`energy/usage/${f.month.value}`, { method: 'PUT', body: { ...read(), note: f.note.value } });
        toast(`${monthName(f.month.value)} opgeslagen`);
        location.hash = '#/energy';
      });
    });
    document.getElementById('del').addEventListener('click', async () => {
      if (!confirm(`Verbruik van ${monthName(f.month.value)} verwijderen?`)) return;
      try {
        await api(`energy/usage/${f.month.value}`, { method: 'DELETE' });
        toast('Maand verwijderd');
        location.hash = '#/energy/months';
      } catch (err) { toast(err.message, true); }
    });
  }

  async function monthsList() {
    setChrome('e-months', 'energy');
    app.innerHTML = '<div class="loading">Laden…</div>';
    const data = await api('energy/monthly');
    if (!data.months.length) {
      app.innerHTML = '<section class="card empty stack"><p>Nog geen maandverbruik.</p><a class="btn" href="#/energy/add">Maandverbruik ingeven</a><a href="#/energy/import" class="small">Of meerdere maanden importeren</a></section>';
      return;
    }
    app.innerHTML = `
      <div class="stack">
        ${pageHead('Per maand', '<a class="btn btn-small btn-ghost" href="#/energy/import">Importeren</a><a class="btn btn-small" href="#/energy/add">+ Maand</a>')}
        <section class="card" style="padding-top:4px;padding-bottom:4px">${data.months.slice().reverse().map((m) => `
          <a class="month-row" href="#/energy/month/${m.month}">
            <div class="grow"><b style="text-transform:capitalize">${esc(monthName(m.month))}</b>
              <div class="meta num">
                ${m.elec ? `<span>⚡ ${kwh(m.elec.import)} · ↩ ${kwh(m.elec.export)}</span>` : ''}
                ${m.gas ? `<span>🔥 ${m3(m.gas.usage)}</span>` : ''}
                ${m.water ? `<span>💧 ${liter(m.water.usage)}</span>` : ''}
              </div>
              ${m.note ? `<div class="muted small">${esc(m.note)}</div>` : ''}</div>
            <b class="num">${eur(m.total)}</b>
          </a>`).join('')}</section>
        ${info('⚡ afname van het net · ↩ injectie (zonnepanelen) · 🔥 gas · 💧 water. Tik op een maand om ze aan te passen.', 'Legende')}
      </div>`;
  }

  // ---------- importeren ----------

  // Eén maand per regel: maand; afname kWh; injectie kWh; gas m³; water liter
  function parseImport(text) {
    const rows = [];
    const errors = [];
    text.split(/\r?\n/).forEach((line, i) => {
      const clean = line.trim();
      if (!clean || clean.startsWith('#')) return;
      const cells = clean.split(/[;\t]/).map((c) => c.trim());
      const [month, ...vals] = cells;
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { errors.push(`Regel ${i + 1}: ongeldige maand "${month}" (gebruik JJJJ-MM)`); return; }
      const nums = vals.slice(0, 4).map((v) => (v === '' || v == null ? null : parseNum(v)));
      if (nums.some((n) => n != null && (!Number.isFinite(n) || n < 0))) { errors.push(`Regel ${i + 1}: ongeldig getal`); return; }
      const [elec_import = null, elec_export = null, gas = null, water = null] = nums;
      if ([elec_import, elec_export, gas, water].every((n) => n == null)) { errors.push(`Regel ${i + 1}: geen verbruik`); return; }
      rows.push({ month, elec_import, elec_export, gas, water });
    });
    return { rows, errors };
  }

  async function importView() {
    setChrome('e-months', 'energy');
    app.innerHTML = '<div class="loading">Laden…</div>';
    const data = await api('energy/monthly');
    const existing = new Set(data.months.map((m) => m.month));
    app.innerHTML = `
      <section class="card stack">
        <h1>Importeren</h1>
        <p class="muted small">Eén maand per regel, gescheiden door puntkomma's:<br>
          <code>maand; afname kWh; injectie kWh; gas m³; water liter</code><br>
          bv. <code>2026-05; 256; 369; 42,4;</code> — laat een waarde leeg als je ze niet hebt.</p>
        <form id="f" novalidate>
          <div class="field"><label for="text">Gegevens</label>
            <textarea id="text" name="text" rows="10" spellcheck="false" style="font-family:ui-monospace,monospace;font-size:14px" placeholder="2026-01; 415; 97; 189;"></textarea></div>
          <div id="prev"></div>
          <div class="field" style="margin-top:14px"><button class="btn-block" type="submit" disabled>Importeren</button></div>
        </form>
      </section>`;
    const f = document.getElementById('f');
    const btn = f.querySelector('button[type=submit]');
    let parsed = { rows: [], errors: [] };
    const render = () => {
      parsed = parseImport(f.text.value);
      const prev = document.getElementById('prev');
      prev.innerHTML = `
        ${parsed.errors.map((e) => `<p class="error">${esc(e)}</p>`).join('')}
        ${parsed.rows.length ? `<div class="tbl-wrap" style="max-height:none"><table class="tbl">
          <thead><tr><th>Maand</th><th>Afname</th><th>Injectie</th><th>Gas</th><th>Water</th></tr></thead>
          <tbody>${parsed.rows.map((r) => `<tr>
            <td>${esc(monthShort(Number(r.month.slice(5)) - 1))} ${r.month.slice(0, 4)}${existing.has(r.month) ? ' *' : ''}</td>
            <td>${r.elec_import == null ? '—' : num(r.elec_import, 1)}</td><td>${r.elec_export == null ? '—' : num(r.elec_export, 1)}</td>
            <td>${r.gas == null ? '—' : num(r.gas, 2)}</td><td>${r.water == null ? '—' : num(r.water, 0)}</td></tr>`).join('')}</tbody>
        </table></div>
        ${parsed.rows.some((r) => existing.has(r.month)) ? '<p class="muted small">* Deze maand bestaat al en wordt overschreven.</p>' : ''}` : ''}`;
      btn.disabled = !parsed.rows.length || parsed.errors.length > 0;
      btn.textContent = parsed.rows.length ? `${parsed.rows.length} maand(en) importeren` : 'Importeren';
    };
    f.text.addEventListener('input', render);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      submitting(f, async () => {
        for (const r of parsed.rows) {
          const { month, ...body } = r;
          await api(`energy/usage/${month}`, { method: 'PUT', body });
        }
        toast(`${parsed.rows.length} maand(en) geïmporteerd`);
        location.hash = '#/energy';
      });
    });
  }

  // ---------- voorschot ----------

  async function settingsView() {
    setChrome('e-tariffs', 'energy');
    app.innerHTML = '<div class="loading">Laden…</div>';
    const data = await api('energy/monthly');
    const s = data.settings || { advance: '', covers: 'elec,gas', period_start: `${today().slice(0, 4)}-01` };
    const covers = s.covers.split(',');
    app.innerHTML = `
      <section class="card stack">
        <h1>Voorschot</h1>
        <p class="muted small">Hiermee volg je op hoe je eindafrekening er voorstaat: wat je aan voorschotten betaalt tegenover je werkelijke kosten.</p>
        <form id="f" novalidate>
          <div class="field"><label for="advance">Voorschot per maand (€)</label>
            <input id="advance" name="advance" inputmode="decimal" value="${esc(dec(s.advance))}" placeholder="bv. 160"></div>
          <fieldset class="field-group"><legend>Het voorschot dekt</legend>
            ${Object.entries(UTIL).map(([k, u]) => `
              <label class="check"><input type="checkbox" name="covers" value="${k}" ${covers.includes(k) ? 'checked' : ''}> ${u.label}</label>`).join('')}
          </fieldset>
          <div class="field" style="margin-top:14px"><label for="water_advance">Watervoorschot per maand (€)</label>
            <input id="water_advance" name="water_advance" inputmode="decimal" value="${esc(dec(s.water_advance || ''))}" placeholder="bv. 40">
            <p class="hint">Apart voorschot voor water, bv. Farys: €120 per kwartaal = €40 per maand. Laat leeg als water in het voorschot hierboven zit.</p></div>
          <div class="field" style="margin-top:14px"><label for="period_start">Afrekeningsperiode start in</label>
            <input id="period_start" name="period_start" type="month" value="${esc(s.period_start)}" required>
            <p class="hint">De eerste maand van de 12 maanden die je eindafrekening dekt (zie je vorige afrekening). Het jaar maakt niet uit; de periode schuift elk jaar mee.</p></div>
          <div class="field" style="margin-top:16px"><button class="btn-block" type="submit">Opslaan</button></div>
        </form>
      </section>`;
    const f = document.getElementById('f');
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      submitting(f, async () => {
        await api('energy/settings', { method: 'PUT', body: {
          advance: f.advance.value.trim() === '' ? 0 : parseNum(f.advance.value),
          covers: [...f.querySelectorAll('input[name=covers]:checked')].map((c) => c.value),
          period_start: f.period_start.value,
          water_advance: f.water_advance.value.trim() === '' ? 0 : parseNum(f.water_advance.value),
        } });
        pref.util = 'total';
        toast('Voorschot opgeslagen');
        location.hash = '#/energy';
      });
    });
  }

  // ---------- tarieven ----------

  async function tariffs() {
    setChrome('e-tariffs', 'energy');
    app.innerHTML = '<div class="loading">Laden…</div>';
    const { tariffs: list } = await api('energy/tariffs');
    app.innerHTML = `
      <div class="stack">
        ${pageHead('Tarieven', '<a class="btn btn-small" href="#/energy/tariff/new">+ Tarief</a>')}
        <a class="card position" href="#/energy/settings"><div class="row between"><b>Voorschot &amp; eindafrekening</b><span class="muted small">Instellen ›</span></div></a>
        <p class="muted small">Verandert een prijs, voeg dan een nieuw tarief toe met de datum vanaf wanneer het geldt. Het geldt vanaf de maand waarin die datum valt; oudere maanden houden hun tarief.</p>
        ${list.length ? list.map((t) => `
          <a class="card position" href="#/energy/tariff/${t.id}">
            <div class="row between"><b>Vanaf ${dateFmt(t.valid_from)}</b><span class="muted small">Bewerken ›</span></div>
            <dl class="kv" style="margin-top:8px">
              <dt>Elektriciteit afname</dt><dd>${num(t.elec_import, 4)} €/kWh</dd>
              <dt>Injectievergoeding</dt><dd>${num(t.elec_export, 4)} €/kWh</dd>
              <dt>Gas</dt><dd>${num(t.gas, 4)} €/m³</dd>
              <dt>Water</dt><dd>${num(t.water, 4)} €/m³</dd>
              ${t.fixed_elec + t.fixed_gas + t.fixed_water ? `<dt>Vaste kosten / maand</dt><dd>${eur(t.fixed_elec + t.fixed_gas + t.fixed_water)}</dd>` : ''}
            </dl>
          </a>`).join('') : '<section class="card empty stack"><p>Nog geen tarieven.</p><a class="btn" href="#/energy/tariff/new">Tarief toevoegen</a></section>'}
      </div>`;
  }

  async function tariffForm(id) {
    setChrome('e-tariffs', 'energy');
    app.innerHTML = '<div class="loading">Laden…</div>';
    const { tariffs: list } = await api('energy/tariffs');
    const isNew = id === 'new';
    const t = isNew ? { ...(list[0] || {}), valid_from: today() } : list.find((x) => x.id === Number(id));
    if (!t) { app.innerHTML = '<div class="empty">Tarief niet gevonden.</div>'; return; }

    app.innerHTML = `
      <section class="card stack">
        <h1>${isNew ? 'Nieuw tarief' : 'Tarief bewerken'}</h1>
        ${isNew && list.length ? '<p class="muted small">Ingevuld met je huidige tarief; pas aan wat veranderd is.</p>' : ''}
        <form id="f" novalidate autocomplete="off">
          <div class="field"><label for="valid_from">Geldig vanaf</label>
            <input id="valid_from" name="valid_from" type="date" value="${esc(t.valid_from)}" required>
            <p class="hint">Je eerste tarief geldt ook voor alle maanden ervoor.</p></div>
          ${TARIFF_GROUPS.map((g) => `
            <fieldset class="field-group"><legend>${g.group}</legend>
              ${g.fields.map((x) => `
                <div class="field"><label for="${x.key}">${x.label} <span class="muted small">(${x.unit})</span></label>
                  <input id="${x.key}" name="${x.key}" inputmode="decimal" value="${esc(dec(t[x.key] || ''))}" placeholder="bv. ${x.ph}">
                  ${x.hint ? `<p class="hint">${x.hint}</p>` : ''}</div>`).join('')}
            </fieldset>`).join('')}
          <div class="field" style="margin-top:16px"><button class="btn-block" type="submit">Opslaan</button></div>
          ${isNew ? '' : '<div class="field"><button id="del" class="btn-danger btn-block" type="button">Verwijderen</button></div>'}
        </form>
      </section>`;

    const f = document.getElementById('f');
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      submitting(f, async () => {
        const body = { valid_from: f.valid_from.value };
        TARIFF_GROUPS.flatMap((g) => g.fields).forEach((x) => { body[x.key] = f[x.key].value.trim() === '' ? 0 : parseNum(f[x.key].value); });
        if (isNew) await api('energy/tariffs', { method: 'POST', body });
        else await api(`energy/tariffs/${id}`, { method: 'PUT', body });
        toast('Tarief opgeslagen');
        location.hash = '#/energy/tariffs';
      });
    });
    document.getElementById('del')?.addEventListener('click', async () => {
      if (!confirm('Dit tarief verwijderen?')) return;
      try {
        await api(`energy/tariffs/${id}`, { method: 'DELETE' });
        toast('Tarief verwijderd');
        location.hash = '#/energy/tariffs';
      } catch (err) { toast(err.message, true); }
    });
  }

  return { overview, monthForm, monthsList, tariffs, tariffForm, importView, settingsView };
}
