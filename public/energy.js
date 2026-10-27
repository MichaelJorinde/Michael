// Energie: meterstanden (HomeWizard), tarieven en maandoverzicht.
import { columnChart, legend } from './charts.js';

const UTIL = {
  elec: { label: 'Elektriciteit', unit: 'kWh', color: 'var(--c1)' },
  gas: { label: 'Gas', unit: 'm³', color: 'var(--c2)' },
  water: { label: 'Water', unit: 'm³', color: 'var(--c3)' },
};
const ELEC_SERIES = [
  { key: 'day', label: 'Afname dag', color: 'var(--c4)' },
  { key: 'night', label: 'Afname nacht', color: 'var(--c7)' },
  { key: 'injection', label: 'Injectie', color: 'var(--c3)' },
];
const METER_FIELDS = [
  { group: 'Elektriciteit', fields: [
    { key: 'elec_t1', label: 'Afname dag (T1)', unit: 'kWh' },
    { key: 'elec_t2', label: 'Afname nacht (T2)', unit: 'kWh' },
    { key: 'inj_t1', label: 'Injectie dag (T1)', unit: 'kWh' },
    { key: 'inj_t2', label: 'Injectie nacht (T2)', unit: 'kWh' },
  ] },
  { group: 'Gas', fields: [{ key: 'gas', label: 'Gasmeter', unit: 'm³' }] },
  { group: 'Water', fields: [{ key: 'water', label: 'Watermeter', unit: 'm³' }] },
];
const TARIFF_GROUPS = [
  { group: 'Elektriciteit', fields: [
    { key: 'elec_day', label: 'Dagtarief', unit: '€/kWh', ph: '0,35' },
    { key: 'elec_night', label: 'Nachttarief', unit: '€/kWh', ph: '0,28' },
    { key: 'elec_injection', label: 'Injectievergoeding', unit: '€/kWh', ph: '0,04' },
    { key: 'fixed_elec', label: 'Vaste kosten', unit: '€/maand', ph: '12,50', hint: 'Abonnement, capaciteitstarief, heffingen…' },
  ] },
  { group: 'Gas', fields: [
    { key: 'gas', label: 'Prijs', unit: '€/kWh', ph: '0,09', hint: 'Prijs per kWh zoals op je factuur. Rekent je leverancier per m³? Laat de omrekenfactor dan leeg.' },
    { key: 'gas_factor', label: 'Omrekenfactor', unit: 'kWh/m³', ph: '10,6', hint: 'Staat op je gasfactuur (bovenste verbrandingswaarde).' },
    { key: 'fixed_gas', label: 'Vaste kosten', unit: '€/maand', ph: '8,00' },
  ] },
  { group: 'Water', fields: [
    { key: 'water', label: 'Prijs', unit: '€/m³', ph: '5,20' },
    { key: 'fixed_water', label: 'Vaste kosten', unit: '€/maand', ph: '4,00' },
  ] },
];

export function energyViews({ app, api, esc, money, num, toast, submitting, setChrome, today, parseNum, dateFmt }) {
  const pref = { util: 'total', year: null };
  try { pref.util = sessionStorage.getItem('energy-util') || 'total'; } catch { /* privémodus */ }

  const eur = (v) => money(v, 'EUR');
  const qty = (v, unit) => (v == null ? '—' : `${num(v, unit === 'kWh' ? 1 : 2)} ${unit}`);
  const dec = (v) => (v == null || v === '' ? '' : String(v).replace('.', ','));
  const sum = (arr) => arr.reduce((a, b) => a + (b ?? 0), 0);
  const compactEur = (v) => new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const compactNum = (v) => new Intl.NumberFormat('nl-BE', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const monthShort = (i) => new Date(2000, i, 1).toLocaleDateString('nl-BE', { month: 'short' }).replace('.', '');
  const monthLong = (i, y) => new Date(y, i, 1).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });

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
    if (!data.months.length) {
      app.innerHTML = `
        <section class="card empty stack">
          <h2>Energie opvolgen</h2>
          <p>Geef je meterstanden in uit de HomeWizard Energy-app. Vanaf twee standen zie je je verbruik en kosten per maand.</p>
          <p class="small">Tip: noteer telkens op de laatste dag van de maand alle standen.</p>
          <a class="btn" href="#/energy/add">Meterstand ingeven</a>
          ${data.hasTariff ? '' : '<a href="#/energy/tariffs" class="small">Of stel eerst je tarieven in</a>'}
        </section>`;
      return;
    }

    const years = [...new Set(data.months.map((m) => Number(m.month.slice(0, 4))))].sort();
    const year = years.includes(pref.year) ? pref.year : years[years.length - 1];
    const util = pref.util;
    const byMonth = Object.fromEntries(data.months.map((m) => [m.month, m]));
    const months = Array.from({ length: 12 }, (_, i) => byMonth[`${year}-${String(i + 1).padStart(2, '0')}`] || null);
    const filled = months.filter(Boolean);
    const labels = months.map((_, i) => monthShort(i));
    const longLabels = months.map((m, i) => `${monthLong(i, year)}${m?.partial ? ' (deels)' : ''}`);
    const mark = (m, i) => `${monthShort(i)}${m.partial ? '*' : ''}`;

    const chips = `
      <div class="chips">${[['total', 'Totaal'], ...Object.entries(UTIL).map(([k, u]) => [k, u.label])].map(([k, l]) => `
        <button type="button" class="chip ${k === util ? 'active' : ''}" data-util="${k}">${l}</button>`).join('')}</div>
      ${years.length > 1 ? `<div class="chips">${years.map((y) => `
        <button type="button" class="chip ${y === year ? 'active' : ''}" data-year="${y}">${y}</button>`).join('')}</div>` : ''}`;
    const tariffBanner = data.hasTariff ? '' : '<p class="banner">Stel je <a href="#/energy/tariffs">tarieven</a> in om ook de kosten te zien.</p>';
    const partialNote = filled.some((m) => m.partial) ? '<p class="muted small">* Onvolledige maand: er zijn nog geen standen voor de hele maand.</p>' : '';

    let html;
    if (util === 'total') {
      const totals = Object.fromEntries(Object.keys(UTIL).map((k) => [k, sum(filled.map((m) => m[k]?.cost))]));
      const costMonths = filled.filter((m) => m.total != null);
      const yearTotal = sum(costMonths.map((m) => m.total));
      const costSeries = Object.entries(UTIL).map(([k, u]) => ({ key: k, label: u.label, color: u.color }));
      html = `
        <section class="card hero">
          <div class="label">Kosten ${year}</div>
          <div class="big num">${data.hasTariff ? eur(yearTotal) : '—'}</div>
          <div class="stats">
            ${Object.entries(UTIL).map(([k, u]) => `<div class="stat"><div class="k">${u.label}</div><div class="v num">${data.hasTariff ? eur(totals[k]) : '—'}</div></div>`).join('')}
            <div class="stat"><div class="k">Gemiddeld / maand</div><div class="v num">${costMonths.length ? eur(yearTotal / costMonths.length) : '—'}</div></div>
          </div>
        </section>
        ${tariffBanner}
        ${data.hasTariff ? `
        <section class="card chart-card">
          <h2>Kosten per maand</h2>
          ${legend(costSeries)}
          <div id="ch-a"></div>
          ${table(['Maand', ...costSeries.map((s) => s.label), 'Totaal'], months.map((m, i) => m && [mark(m, i), ...Object.keys(UTIL).map((k) => (m[k]?.cost != null ? eur(m[k].cost) : '—')), m.total != null ? eur(m.total) : '—']).filter(Boolean))}
        </section>` : ''}
        <section class="card">
          <h2>Verbruik ${year}</h2>
          <dl class="kv" style="margin-top:10px">
            <dt>Elektriciteit afname</dt><dd>${qty(sum(filled.map((m) => m.elec?.usage)), 'kWh')}</dd>
            <dt>Injectie (zonnepanelen)</dt><dd>${qty(sum(filled.map((m) => m.elec?.injection)), 'kWh')}</dd>
            <dt>Gas</dt><dd>${qty(sum(filled.map((m) => m.gas?.usage)), 'm³')}</dd>
            <dt>Water</dt><dd>${qty(sum(filled.map((m) => m.water?.usage)), 'm³')}</dd>
          </dl>
        </section>
        ${partialNote}`;
      app.innerHTML = `<div class="stack"><h1>Energie</h1>${chips}${html}</div>`;
      if (data.hasTariff) {
        columnChart(document.getElementById('ch-a'), {
          labels, longLabels, series: costSeries, format: eur, tickFormat: compactEur,
          rows: months.map((m) => m && Object.fromEntries(Object.keys(UTIL).map((k) => [k, m[k]?.cost ?? null]))),
        });
      }
    } else {
      const u = UTIL[util];
      const ms = months.map((m) => m && m[util]);
      const have = ms.filter(Boolean);
      const yearCost = sum(have.map((x) => x.cost));
      const yearUsage = sum(have.map((x) => x.usage));
      const isElec = util === 'elec';
      const costSeries = [{ key: 'cost', label: `Kosten ${u.label.toLowerCase()}`, color: u.color }];
      const usageSeries = isElec ? ELEC_SERIES : [{ key: 'usage', label: `Verbruik ${u.label.toLowerCase()}`, color: u.color }];
      html = `
        <section class="card hero">
          <div class="label">${u.label} · kosten ${year}</div>
          <div class="big num">${data.hasTariff ? eur(yearCost) : '—'}</div>
          <div class="stats">
            <div class="stat"><div class="k">Verbruik</div><div class="v num">${qty(yearUsage, u.unit)}</div></div>
            <div class="stat"><div class="k">Gemiddeld / maand</div><div class="v num">${have.length && data.hasTariff ? eur(yearCost / have.length) : '—'}</div></div>
            ${isElec ? `
            <div class="stat"><div class="k">Injectie</div><div class="v num">${qty(sum(have.map((x) => x.injection)), 'kWh')}</div></div>
            <div class="stat"><div class="k">Netto afname</div><div class="v num">${qty(sum(have.map((x) => x.net)), 'kWh')}</div></div>` : ''}
          </div>
        </section>
        ${tariffBanner}
        ${have.length ? `
        <section class="card chart-card">
          <h2>Verbruik per maand</h2>
          ${isElec ? legend(usageSeries) : ''}
          <div id="ch-u"></div>
          ${isElec ? '<p class="muted small">Injectie staat onder de nullijn.</p>' : ''}
          ${table(['Maand', ...usageSeries.map((s) => s.label)], months.map((m, i) => m && m[util] && [mark(m, i), ...usageSeries.map((s) => qty(m[util][s.key], u.unit))]).filter(Boolean))}
        </section>
        ${data.hasTariff ? `
        <section class="card chart-card">
          <h2>Kosten per maand</h2>
          <div id="ch-c"></div>
          ${isElec ? '<p class="muted small">Netto: afname min injectievergoeding, plus vaste kosten.</p>' : ''}
          ${table(['Maand', 'Kosten'], months.map((m, i) => m && m[util] && [mark(m, i), eur(m[util].cost)]).filter(Boolean))}
        </section>` : ''}` : `<section class="card empty">Nog geen standen voor ${u.label.toLowerCase()} in ${year}.</section>`}
        ${partialNote}`;
      app.innerHTML = `<div class="stack"><h1>Energie</h1>${chips}${html}</div>`;
      if (have.length) {
        const unitFmt = (v) => qty(v, u.unit);
        columnChart(document.getElementById('ch-u'), {
          labels, longLabels, series: usageSeries, format: unitFmt, tickFormat: compactNum, totalLabel: 'Netto',
          rows: ms.map((x) => x && (isElec ? { day: x.day, night: x.night, injection: x.injection ? -x.injection : 0 } : { usage: x.usage })),
        });
        if (data.hasTariff) {
          columnChart(document.getElementById('ch-c'), {
            labels, longLabels, series: costSeries, format: eur, tickFormat: compactEur,
            rows: ms.map((x) => x && { cost: x.cost }),
          });
        }
      }
    }

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

  // ---------- meterstanden ----------

  async function readingForm(id) {
    setChrome(id ? 'e-readings' : 'e-add', 'energy');
    app.innerHTML = '<div class="loading">Laden…</div>';
    const { readings } = await api('energy/readings');
    const r = id ? readings.find((x) => x.id === Number(id)) : { date: today() };
    if (!r) { app.innerHTML = '<div class="empty">Meterstand niet gevonden.</div>'; return; }
    const latest = (key, beforeDate) => readings.find((x) => x[key] != null && x.id !== r.id && (!beforeDate || x.date <= beforeDate));

    app.innerHTML = `
      <section class="card stack">
        <h1>${id ? 'Meterstand bewerken' : 'Meterstand ingeven'}</h1>
        <p class="muted small">Neem de totale tellerstanden over uit de HomeWizard Energy-app. Vul in wat je hebt; lege velden worden overgeslagen. In België is T1 het dagtarief en T2 het nachttarief.</p>
        <form id="f" novalidate autocomplete="off">
          <div class="field"><label for="date">Datum</label>
            <input id="date" name="date" type="date" value="${esc(r.date)}" max="${today()}" required></div>
          ${METER_FIELDS.map((g) => `
            <fieldset class="field-group"><legend>${g.group}</legend>
              ${g.fields.map((f) => {
                const prev = latest(f.key);
                return `<div class="field"><label for="${f.key}">${f.label} <span class="muted small">(${f.unit})</span></label>
                  <input id="${f.key}" name="${f.key}" inputmode="decimal" value="${esc(dec(r[f.key]))}" placeholder="${prev ? esc(dec(prev[f.key])) : ''}">
                  ${prev ? `<p class="hint">Vorige stand: ${num(prev[f.key], 3)} ${f.unit} (${dateFmt(prev.date)})</p>` : ''}</div>`;
              }).join('')}
            </fieldset>`).join('')}
          <div class="field" style="margin-top:14px"><label for="note">Notitie (optioneel)</label>
            <input id="note" name="note" value="${esc(r.note || '')}" maxlength="200"></div>
          <div class="field" style="margin-top:16px"><button class="btn-block" type="submit">${id ? 'Opslaan' : 'Meterstand opslaan'}</button></div>
          ${id ? '<div class="field"><button id="del" class="btn-danger btn-block" type="button">Verwijderen</button></div>' : ''}
        </form>
      </section>`;

    const f = document.getElementById('f');
    const keys = METER_FIELDS.flatMap((g) => g.fields.map((x) => x.key));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      submitting(f, async () => {
        const body = { date: f.date.value, note: f.note.value };
        keys.forEach((k) => { body[k] = f[k].value.trim() === '' ? null : parseNum(f[k].value); });
        const lower = keys.filter((k) => {
          const prev = latest(k, body.date);
          return body[k] != null && prev && prev.date <= body.date && body[k] < prev[k];
        });
        if (lower.length && !confirm('Sommige standen zijn lager dan de vorige stand. Een meter telt normaal alleen op. Toch opslaan?')) return;
        if (id) await api(`energy/readings/${id}`, { method: 'PUT', body });
        else await api('energy/readings', { method: 'POST', body });
        toast('Meterstand opgeslagen');
        location.hash = '#/energy/readings';
      });
    });
    document.getElementById('del')?.addEventListener('click', async () => {
      if (!confirm('Deze meterstand verwijderen?')) return;
      try {
        await api(`energy/readings/${id}`, { method: 'DELETE' });
        toast('Meterstand verwijderd');
        location.hash = '#/energy/readings';
      } catch (err) { toast(err.message, true); }
    });
  }

  async function readingsList() {
    setChrome('e-readings', 'energy');
    app.innerHTML = '<div class="loading">Laden…</div>';
    const { readings } = await api('energy/readings');
    if (!readings.length) {
      app.innerHTML = '<section class="card empty stack"><p>Nog geen meterstanden.</p><a class="btn" href="#/energy/add">Meterstand ingeven</a></section>';
      return;
    }
    const fields = METER_FIELDS.flatMap((g) => g.fields);
    app.innerHTML = `
      <div class="stack">
        <div class="row between"><h1>Meterstanden</h1><a class="btn btn-small" href="#/energy/add">+ Stand</a></div>
        <section class="card"><ul class="list">${readings.map((r) => `
          <li class="reading">
            <div class="grow">
              <b>${dateFmt(r.date)}</b>
              <dl class="kv" style="margin-top:4px">${fields.filter((x) => r[x.key] != null).map((x) => `
                <dt>${x.label}</dt><dd>${num(r[x.key], 3)} ${x.unit}</dd>`).join('')}</dl>
              ${r.note ? `<div class="muted small">${esc(r.note)}</div>` : ''}
            </div>
            <a class="btn icon-btn" href="#/energy/edit/${r.id}" aria-label="Bewerken">
              <svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
            </a>
          </li>`).join('')}</ul></section>
      </div>`;
  }

  // ---------- tarieven ----------

  async function tariffs() {
    setChrome('e-tariffs', 'energy');
    app.innerHTML = '<div class="loading">Laden…</div>';
    const { tariffs: list } = await api('energy/tariffs');
    app.innerHTML = `
      <div class="stack">
        <div class="row between"><h1>Tarieven</h1><a class="btn btn-small" href="#/energy/tariff/new">+ Tarief</a></div>
        <p class="muted small">Vul all-in prijzen in (inclusief btw, netkosten en heffingen), zoals op je factuur. Verandert je contract, voeg dan een nieuw tarief toe met de datum vanaf wanneer het geldt; oudere maanden blijven het oude tarief gebruiken.</p>
        ${list.length ? list.map((t) => `
          <a class="card position" href="#/energy/tariff/${t.id}">
            <div class="row between"><b>Vanaf ${dateFmt(t.valid_from)}</b><span class="muted small">Bewerken ›</span></div>
            <dl class="kv" style="margin-top:8px">
              <dt>Elektriciteit dag / nacht</dt><dd>${num(t.elec_day, 4)} / ${num(t.elec_night, 4)} €/kWh</dd>
              <dt>Injectievergoeding</dt><dd>${num(t.elec_injection, 4)} €/kWh</dd>
              <dt>Gas</dt><dd>${num(t.gas, 4)} ${t.gas_factor > 0 ? `€/kWh × ${num(t.gas_factor, 3)} kWh/m³` : '€/m³'}</dd>
              <dt>Water</dt><dd>${num(t.water, 4)} €/m³</dd>
              <dt>Vaste kosten / maand</dt><dd>${eur(t.fixed_elec + t.fixed_gas + t.fixed_water)}</dd>
            </dl>
          </a>`).join('') : '<section class="card empty stack"><p>Nog geen tarieven.</p><a class="btn" href="#/energy/tariff/new">Tarief toevoegen</a></section>'}
      </div>`;
  }

  async function tariffForm(id) {
    setChrome('e-tariffs', 'energy');
    app.innerHTML = '<div class="loading">Laden…</div>';
    const { tariffs: list } = await api('energy/tariffs');
    const isNew = id === 'new';
    const t = isNew ? { ...(list[0] || {}), valid_from: list.length ? today() : `${today().slice(0, 4)}-01-01` } : list.find((x) => x.id === Number(id));
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
              ${g.fields.map((f) => `
                <div class="field"><label for="${f.key}">${f.label} <span class="muted small">(${f.unit})</span></label>
                  <input id="${f.key}" name="${f.key}" inputmode="decimal" value="${esc(dec(t[f.key] || ''))}" placeholder="bv. ${f.ph}">
                  ${f.hint ? `<p class="hint">${f.hint}</p>` : ''}</div>`).join('')}
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

  return { overview, readingForm, readingsList, tariffs, tariffForm };
}
