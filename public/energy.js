// Energie: maandelijks totaalverbruik (HomeWizard), tarieven en overzicht per maand.
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

export function energyViews({ app, api, esc, money, num, toast, submitting, setChrome, today, parseNum, dateFmt }) {
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
      <div class="chips">${[['total', 'Totaal'], ...Object.entries(UTIL).map(([k, u]) => [k, u.label])].map(([k, l]) => `
        <button type="button" class="chip ${k === util ? 'active' : ''}" data-util="${k}">${l}</button>`).join('')}</div>
      ${years.length > 1 ? `<div class="chips">${years.map((y) => `
        <button type="button" class="chip ${y === year ? 'active' : ''}" data-year="${y}">${y}</button>`).join('')}</div>` : ''}`;
    const tariffBanner = hasTariff ? '' : '<p class="banner">Stel je <a href="#/energy/tariffs">tarieven</a> in om ook de kosten te zien.</p>';

    let body;
    let drawCharts;
    if (util === 'total') {
      const costSeries = Object.entries(UTIL).map(([k, u]) => ({ key: k, label: u.label, color: u.color }));
      const perUtil = Object.fromEntries(Object.keys(UTIL).map((k) => [k, sum(filled.map((m) => m[k]?.cost))]));
      const costMonths = filled.filter((m) => m.total != null);
      const yearTotal = sum(costMonths.map((m) => m.total));
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
      drawCharts = () => hasTariff && columnChart(document.getElementById('ch-a'), {
        labels, longLabels, series: costSeries, format: eur, tickFormat: compactEur,
        rows: months.map((m) => m && Object.fromEntries(Object.keys(UTIL).map((k) => [k, m[k]?.cost ?? null]))),
      });
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

    app.innerHTML = `<div class="stack"><div class="row between"><h1>Energie</h1><a class="btn btn-small" href="#/energy/add">+ Maand</a></div>${chips}${body}</div>`;
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
        <div class="row between"><h1>Per maand</h1>
          <div class="row"><a class="btn btn-small btn-ghost" href="#/energy/import">Importeren</a><a class="btn btn-small" href="#/energy/add">+ Maand</a></div></div>
        ${data.months.slice().reverse().map((m) => `
          <a class="card position" href="#/energy/month/${m.month}">
            <div class="row between"><b>${esc(monthName(m.month))}</b><b class="num">${eur(m.total)}</b></div>
            <dl class="kv" style="margin-top:8px">
              ${m.elec ? `<dt>Elektriciteit</dt><dd>${kwh(m.elec.import)} afname · ${kwh(m.elec.export)} injectie · <b>${eur(m.elec.cost)}</b></dd>` : ''}
              ${m.gas ? `<dt>Gas</dt><dd>${m3(m.gas.usage)} · <b>${eur(m.gas.cost)}</b></dd>` : ''}
              ${m.water ? `<dt>Water</dt><dd>${liter(m.water.usage)} · <b>${eur(m.water.cost)}</b></dd>` : ''}
            </dl>
            ${m.note ? `<div class="muted small">${esc(m.note)}</div>` : ''}
          </a>`).join('')}
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

  // ---------- tarieven ----------

  async function tariffs() {
    setChrome('e-tariffs', 'energy');
    app.innerHTML = '<div class="loading">Laden…</div>';
    const { tariffs: list } = await api('energy/tariffs');
    app.innerHTML = `
      <div class="stack">
        <div class="row between"><h1>Tarieven</h1><a class="btn btn-small" href="#/energy/tariff/new">+ Tarief</a></div>
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

  return { overview, monthForm, monthsList, tariffs, tariffForm, importView };
}
