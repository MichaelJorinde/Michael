// € Privé: uitgaven uit bankexports — vaste kosten, categorieën en grafieken.
import { barChart, columnChart, legend } from './charts.js';
import { pageHead, info } from './ui.js';
import { decode, parseCsv, findHeader, detectColumns, extract } from './bankcsv.js';

const FREQ = [
  { name: 'maandelijks', min: 25, max: 36, perMonth: 1 },
  { name: 'per 2 maanden', min: 55, max: 66, perMonth: 1 / 2 },
  { name: 'per kwartaal', min: 80, max: 100, perMonth: 1 / 3 },
  { name: 'halfjaarlijks', min: 170, max: 200, perMonth: 1 / 6 },
  { name: 'jaarlijks', min: 330, max: 400, perMonth: 1 / 12 },
];
const VARIABLE = new Set(['Boodschappen', 'Horeca', 'Vrije tijd & shopping', 'Cash', 'Inkomsten', 'Kredietkaart']);
// Geld naar je eigen rekeningen en potjes: geen uitgave (en terug: geen inkomen).
const NON_SPEND = new Set(['Sparen & beleggen', 'Spaarpotjes', 'Interne overschrijving']);
const COLORS = [1, 2, 3, 4, 5, 6, 7].map((i) => `var(--c${i})`);
const OTHER = 'var(--muted)';

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// Terugkerende uitgaven: zelfde tegenpartij, regelmatig interval en een vrij stabiel bedrag.
export function detectRecurring(txs) {
  const groups = new Map();
  txs.filter((t) => t.amount < 0 && !NON_SPEND.has(t.category)).forEach((t) => {
    const k = t.counterparty.toLowerCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  });
  const out = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const gaps = list.slice(1).map((t, i) => (Date.parse(t.date) - Date.parse(list[i].date)) / 86400000);
    const freq = FREQ.find((f) => { const g = median(gaps); return g >= f.min && g <= f.max; });
    if (!freq) continue;
    if (freq.perMonth === 1 && list.length < 3 && gaps[0] > 0) {
      // Twee betalingen is (nog) geen patroon, tenzij het bedrag identiek is.
      if (Math.abs(list[0].amount - list[1].amount) > 0.01) continue;
    }
    const amounts = list.map((t) => -t.amount);
    const avg = mean(amounts);
    const cv = Math.sqrt(mean(amounts.map((a) => (a - avg) ** 2))) / avg;
    if (cv > 0.35) continue;
    const category = list[list.length - 1].category;
    if (VARIABLE.has(category) && cv > 0.1) continue;
    out.push({ counterparty: list[0].counterparty, category, frequency: freq.name, count: list.length, avg, perMonth: avg * freq.perMonth, last: list[list.length - 1], cv });
  }
  return out.sort((a, b) => b.perMonth - a.perMonth);
}

export function financeViews({ app, api, esc, money, num, toast, setChrome, gate }) {
  const eur = (v) => money(v, 'EUR');
  const monthName = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });
  const monthShort = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('nl-BE', { month: 'short' }).replace('.', '');
  const dayFmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' });
  const compactEur = (v) => new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 }).format(v);

  async function overview(lockButton) {
    const { transactions: txs, categories } = await api('private/tx');
    setChrome('p-overview', 'private');
    if (!txs.length) {
      app.innerHTML = `
        <div class="stack">
          ${pageHead('€ Privé', lockButton)}
          <section class="card accent-card stack">
            <h2>Je uitgaven in kaart brengen</h2>
            <p>Exporteer je verrichtingen als <b>CSV-bestand</b> in je bankapp of internetbankieren (meestal via "Exporteren" of "Downloaden" bij je rekening) en importeer het hier. Liefst 6 à 12 maanden.</p>
            <a class="btn" href="#/private/import">Bankbestand importeren</a>
            <p class="muted small">Het bestand wordt op je toestel gelezen. Enkel datum, bedrag en de naam van de tegenpartij worden bewaard — geen rekeningnummers, saldo, adressen of mededelingen.</p>
          </section>
        </div>`;
      bindLock();
      return;
    }

    const months = [...new Set(txs.map((t) => t.date.slice(0, 7)))].sort();
    // Volledige maanden: de eerste en laatste maand zijn vaak onvolledig.
    const full = months.length > 2 ? months.slice(1, -1) : months;
    const inFull = (t) => full.includes(t.date.slice(0, 7));
    const spend = txs.filter((t) => t.amount < 0 && !NON_SPEND.has(t.category));
    const avgSpend = spend.filter(inFull).reduce((s, t) => s - t.amount, 0) / full.length;
    const avgIncome = txs.filter((t) => t.amount > 0 && t.category === 'Inkomsten' && inFull(t)).reduce((s, t) => s + t.amount, 0) / full.length;
    // Netto naar potjes en spaar-/beleggingsrekeningen (stortingen min opnames).
    const avgSaved = txs.filter((t) => NON_SPEND.has(t.category) && t.category !== 'Interne overschrijving' && inFull(t)).reduce((s, t) => s - t.amount, 0) / full.length;
    const fixed = detectRecurring(txs);
    const fixedTotal = fixed.reduce((s, f) => s + f.perMonth, 0);

    // Categorieën: gemiddelde per (volledige) maand, top 6 + rest.
    const byCat = {};
    spend.filter(inFull).forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) - t.amount; });
    const catList = Object.entries(byCat).map(([c, v]) => ({ c, avg: v / full.length })).sort((a, b) => b.avg - a.avg);
    const top = catList.slice(0, 6).map((x) => x.c);
    const color = (c) => (top.includes(c) ? COLORS[top.indexOf(c)] : OTHER);
    const stackSeries = [...top.map((c) => ({ key: c, label: c, color: color(c) })), ...(catList.length > 6 ? [{ key: 'Rest', label: 'Overige categorieën', color: OTHER }] : [])];
    const monthRows = months.map((m) => {
      const row = {};
      spend.filter((t) => t.date.startsWith(m)).forEach((t) => { const k = top.includes(t.category) ? t.category : 'Rest'; row[k] = (row[k] || 0) - t.amount; });
      return row;
    });

    const fixedRow = (f) => `
            <li class="purchase">
              <div class="grow"><b>${esc(f.counterparty)}</b>
                <div class="muted small">${esc(f.category)} · ${esc(f.frequency)}</div></div>
              <div class="num" style="text-align:right"><b>${eur(f.perMonth)}</b>${f.frequency !== 'maandelijks' ? `<div class="muted small">${eur(f.avg)} ${esc(f.frequency)}</div>` : ''}</div>
            </li>`;
    const catOptions = (sel) => categories.map((c) => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');
    const byMonth = months.slice().reverse().map((m) => ({ m, list: txs.filter((t) => t.date.startsWith(m)) }));

    app.innerHTML = `
      <div class="stack">
        ${pageHead('€ Privé', lockButton, `${esc(monthShort(months[0]))} ${months[0].slice(0, 4)} – ${esc(monthShort(months[months.length - 1]))} ${months[months.length - 1].slice(0, 4)} · gemiddeld per maand`)}
        <section class="card hero">
          <div class="label">Uitgaven per maand</div>
          <div class="big num">${eur(avgSpend)}</div>
          <div class="stats">
            <div class="stat"><div class="k">Inkomsten</div><div class="v num">${eur(avgIncome)}</div></div>
            <div class="stat"><div class="k">Vaste kosten</div><div class="v num">${eur(fixedTotal)}</div></div>
            <div class="stat"><div class="k">Variabel</div><div class="v num">${eur(Math.max(0, avgSpend - fixedTotal))}</div></div>
            <div class="stat"><div class="k">Potjes & sparen</div><div class="v num">${eur(avgSaved)}</div></div>
          </div>
          <div class="callout"><span>Over per maand</span><span class="num ${avgIncome - avgSpend - avgSaved >= 0 ? 'gain' : 'loss'}">${eur(avgIncome - avgSpend - avgSaved)}</span></div>
          ${info(`Gemiddelden over ${full.length} volledige maand${full.length === 1 ? '' : 'en'} (de eerste en laatste maand van je export tellen niet mee, die zijn vaak onvolledig). "Over" = inkomsten min uitgaven min wat naar potjes en spaarrekeningen gaat.`)}
        </section>

        <section class="card">
          <div class="trends-head"><h2>Vaste kosten</h2><b class="num">${eur(fixedTotal)}/maand</b></div>
          ${fixed.length ? `<ul class="list">${fixed.slice(0, 5).map(fixedRow).join('')}</ul>
          ${fixed.length > 5 ? `<details class="fold"><summary><span class="small" style="color:var(--primary);font-weight:700">Toon alle ${fixed.length}</span></summary><ul class="list">${fixed.slice(5).map(fixedRow).join('')}</ul></details>` : ''}` : '<p class="muted">Nog geen vaste kosten herkend. Importeer meer maanden.</p>'}
          ${info('Automatisch herkend: zelfde tegenpartij, regelmatig, vrij stabiel bedrag. Kosten per kwartaal of jaar zijn omgerekend naar een maandbedrag.', 'Hoe herkend?')}
        </section>

        <section class="card chart-card">
          <h2>Uitgaven per categorie</h2>
          <p class="muted small" style="margin:4px 0 0">Gemiddeld per maand</p>
          ${barChart({ items: catList.map((x) => ({ label: x.c, sub: `${num((x.avg / avgSpend) * 100, 0)}%`, values: { v: x.avg } })), series: [{ key: 'v', label: 'Per maand', color: 'var(--c1)' }], format: eur })}
        </section>

        <section class="card chart-card">
          <h2>Uitgaven per maand</h2>
          ${legend(stackSeries)}
          <div id="ch-fin"></div>
        </section>

        <section class="card">
          <div class="row between"><h2>Verrichtingen</h2><a class="btn btn-small" href="#/private/import">Importeren</a></div>
          ${info('Klopt een categorie niet? Kies de juiste; die wordt onthouden voor alle verrichtingen van die tegenpartij.', 'Categorie aanpassen')}
          ${byMonth.map(({ m, list }) => `
            <details class="tx-month">
              <summary><span>${esc(monthName(m))}</span><span class="num">${eur(list.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0))}</span></summary>
              <ul class="list">${list.map((t) => `
                <li class="purchase">
                  <div class="grow"><b class="small">${esc(t.counterparty)}</b>
                    <div><select class="cat-select" data-id="${t.id}" aria-label="Categorie">${catOptions(t.category)}</select>
                    <span class="muted small">${esc(dayFmt(t.date))}</span></div></div>
                  <div class="num ${t.amount > 0 ? 'gain' : ''}" style="font-weight:700">${eur(t.amount)}</div>
                </li>`).join('')}</ul>
            </details>`).join('')}
          <button id="wipe" class="btn-danger btn-block" type="button" style="margin-top:14px">Alle bankgegevens wissen</button>
        </section>
      </div>`;

    columnChart(document.getElementById('ch-fin'), {
      labels: months.map(monthShort), longLabels: months.map(monthName), rows: monthRows,
      series: stackSeries, format: eur, tickFormat: compactEur,
    });
    bindLock();
    app.querySelectorAll('.cat-select').forEach((sel) => sel.addEventListener('change', async () => {
      try {
        await api(`private/tx/${sel.dataset.id}`, { method: 'PUT', body: { category: sel.value, remember: true } });
        toast('Categorie onthouden');
        overview(lockButton);
      } catch (e) { toast(e.message, true); }
    }));
    document.getElementById('wipe').addEventListener('click', async () => {
      if (!confirm('Alle geïmporteerde bankgegevens en je categorie-aanpassingen definitief wissen?')) return;
      await api('private/tx/all', { method: 'DELETE' });
      toast('Bankgegevens gewist');
      overview(lockButton);
    });
  }

  function bindLock() {
    document.getElementById('lock')?.addEventListener('click', () => { location.hash = '#/private/lock'; });
  }

  async function importView() {
    await gate(() => {
      setChrome('p-import', 'private');
      app.innerHTML = `
        <section class="card stack">
          <h1>Bankbestand importeren</h1>
          <p class="muted small">Exporteer je verrichtingen in je bankapp of internetbankieren als <b>CSV</b> en kies het bestand hieronder. Het wordt op je toestel gelezen; enkel <b>datum, bedrag en naam van de tegenpartij</b> worden bewaard. Verrichtingen die al geïmporteerd zijn, worden overgeslagen.</p>
          <label class="btn btn-block" for="file">CSV-bestand kiezen</label>
          <input id="file" type="file" accept=".csv,text/csv,text/plain" hidden>
          <div id="preview"></div>
        </section>`;
      document.getElementById('file').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const prev = document.getElementById('preview');
        if (/\.pdf$/i.test(file.name)) { prev.innerHTML = '<p class="error">Dit is een PDF. Kies de CSV-export (Excel/CSV) van je bank.</p>'; return; }
        const rows = parseCsv(decode(await file.arrayBuffer()));
        let header = findHeader(rows);
        if (!header) {
          prev.innerHTML = '<p class="error">Ik herken de kolommen datum en bedrag niet in dit bestand. Is het een CSV-export van je verrichtingen?</p>';
          return;
        }
        const render = async () => {
          const { transactions, skipped } = await extract(rows, header);
          const head = rows[header.index];
          const opt = (sel, allowNone) => `${allowNone ? '<option value="-1">— geen —</option>' : ''}${head.map((h, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(h || `kolom ${i + 1}`)}</option>`).join('')}`;
          prev.innerHTML = `
            <fieldset class="field-group"><legend>Herkende kolommen</legend>
              <div class="field"><label for="c-date">Datum</label><select id="c-date">${opt(header.cols.date)}</select></div>
              <div class="field"><label for="c-amount">Bedrag</label><select id="c-amount">${opt(header.cols.amount)}</select></div>
              <div class="field"><label for="c-cp">Naam tegenpartij</label><select id="c-cp">${opt(header.cols.counterparty, true)}</select></div>
            </fieldset>
            <h2 style="margin-top:16px">${transactions.length} verrichtingen</h2>
            <p class="muted small">${transactions.length ? `${esc(transactions[transactions.length - 1].date)} tot ${esc(transactions[0].date)}` : ''}${skipped ? ` · ${skipped} regels overgeslagen (geen datum of bedrag)` : ''}</p>
            <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tegenpartij</th><th>Datum</th><th>Bedrag</th></tr></thead>
              <tbody>${transactions.slice(0, 12).map((t) => `<tr><td>${esc(t.counterparty)}</td><td>${esc(t.date)}</td><td>${eur(t.amount)}</td></tr>`).join('')}</tbody></table></div>
            <p class="muted small">Dit is alles wat er bewaard wordt.</p>
            <button id="go" class="btn-block" type="button" ${transactions.length ? '' : 'disabled'}>${transactions.length} verrichtingen importeren</button>`;
          ['c-date', 'c-amount', 'c-cp'].forEach((id) => document.getElementById(id).addEventListener('change', () => {
            header = { index: header.index, cols: { ...header.cols, date: Number(document.getElementById('c-date').value), amount: Number(document.getElementById('c-amount').value), counterparty: Number(document.getElementById('c-cp').value) } };
            render();
          }));
          document.getElementById('go').addEventListener('click', async (ev) => {
            ev.target.disabled = true;
            ev.target.textContent = 'Bezig met importeren…';
            try {
              let added = 0;
              for (let i = 0; i < transactions.length; i += 400) {
                const r = await api('private/tx/import', { method: 'POST', body: { rows: transactions.slice(i, i + 400) } });
                added += r.added;
              }
              toast(`${added} nieuwe verrichtingen, ${transactions.length - added} al aanwezig`);
              location.hash = '#/private';
            } catch (err) {
              toast(err.message, true);
              ev.target.disabled = false;
              ev.target.textContent = 'Opnieuw proberen';
            }
          });
        };
        render();
      });
    });
  }

  return { overview, importView, detectColumns };
}
