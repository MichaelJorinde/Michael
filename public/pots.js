// € Privé: potjes — vaste maandelijkse reserveringen en spaardoelen (versie 1.0).
import { barChart, legend } from './charts.js';

export const POTS_VERSION = '1.0';
const GROUP_COLOR = { 'Vaste kosten': 'var(--c1)', 'Sparen & doelen': 'var(--c2)', Kinderen: 'var(--c3)', Beleggen: 'var(--c4)' };
const GROUP_HINT = {
  'Vaste kosten': 'Geld opzij voor rekeningen die per jaar of per kwartaal komen.',
  'Sparen & doelen': 'Sparen voor iets dat je wilt doen of kopen.',
  Kinderen: 'Spaargeld en uitgaven voor de kinderen.',
  Beleggen: 'Vaste inleg in beleggingen.',
};

export function potsViews({ app, api, esc, money, num, toast, submitting, setChrome, gate, parseNum, LOCK_BUTTON }) {
  const eur = (v) => money(v, 'EUR');
  const dec = (v) => (v == null || v === '' ? '' : String(v).replace('.', ','));

  async function overview() {
    await gate(async () => {
      setChrome('p-pots', 'private');
      const { pots, groups } = await api('private/pots');
      if (!pots.length) {
        app.innerHTML = `
          <div class="stack">
            <div class="row between"><h1>Potjes</h1>${LOCK_BUTTON}</div>
            <section class="card accent-card stack">
              <h2>Je potjes in één overzicht</h2>
              <p>Zet hier elk bedrag dat je maandelijks opzij zet: voor jaarlijkse rekeningen, spaardoelen, de kinderen of beleggen. Geef bij een potje ook de verwachte jaarkost op, dan zie je of het potje volstaat.</p>
              <a class="btn" href="#/private/pots/import">Potjes in één keer plakken</a>
              <a class="btn btn-ghost" href="#/private/pot/new">Eén potje toevoegen</a>
            </section>
            <p class="muted small" style="text-align:center">Potjes · versie ${POTS_VERSION}</p>
          </div>`;
        bindLock();
        return;
      }

      const total = pots.reduce((s, p) => s + p.monthly, 0);
      const perGroup = groups.map((g) => ({ g, list: pots.filter((p) => p.grp === g) })).filter((x) => x.list.length);
      const sumOf = (list) => list.reduce((s, p) => s + p.monthly, 0);
      const checks = pots.filter((p) => p.yearly_cost > 0).map((p) => ({ p, yearly: p.monthly * 12, gap: p.yearly_cost - p.monthly * 12 }));
      const short = checks.filter((c) => c.gap > 0.5);

      app.innerHTML = `
        <div class="stack">
          <div class="row between"><h1>Potjes</h1>${LOCK_BUTTON}</div>
          <section class="card hero">
            <div class="label">Per maand opzij</div>
            <div class="big num">${eur(total)}</div>
            <div class="stats">
              ${perGroup.map(({ g, list }) => `<div class="stat"><div class="k"><i class="dot" style="background:${GROUP_COLOR[g]}"></i>${esc(g)}</div><div class="v num">${eur(sumOf(list))}</div></div>`).join('')}
            </div>
            <p class="muted small" style="margin:10px 0 0">${eur(total * 12)} per jaar · ${pots.length} potjes</p>
          </section>

          ${checks.length ? `
          <section class="card ${short.length ? 'accent-card' : ''}">
            <div class="trends-head"><h2>Volstaat je potje?</h2>${short.length ? `<span class="vbadge vbadge-high">▲ ${short.length} te krap</span>` : '<span class="vbadge vbadge-good">✓ alles gedekt</span>'}</div>
            <p class="muted small" style="margin:4px 0 0">Maandbedrag × 12 tegenover de verwachte jaarkost.</p>
            <ul class="list">${checks.sort((a, b) => b.gap - a.gap).map(({ p, yearly, gap }) => `
              <li class="purchase">
                <div class="grow"><b>${esc(p.name)}</b>
                  <div class="muted small num">${eur(yearly)} per jaar opzij · nodig ${eur(p.yearly_cost)}</div>
                  <div class="meter"><span style="width:${Math.min(100, (yearly / p.yearly_cost) * 100)}%;background:${gap > 0.5 ? 'var(--v-high)' : 'var(--v-good)'}"></span></div></div>
                <div class="num" style="text-align:right">${gap > 0.5
                  ? `<span class="vbadge vbadge-high">▲ tekort</span><div class="small"><b>+${eur(gap / 12)}</b>/maand</div>`
                  : '<span class="vbadge vbadge-good">✓ gedekt</span>'}</div>
              </li>`).join('')}</ul>
          </section>` : ''}

          <section class="card chart-card">
            <h2>Verdeling</h2>
            ${legend(perGroup.map(({ g }) => ({ label: g, color: GROUP_COLOR[g] })))}
            ${barChart({ items: perGroup.map(({ g, list }) => ({ label: g, sub: `${num((sumOf(list) / total) * 100, 0)}%`, color: GROUP_COLOR[g], values: { v: sumOf(list) } })),
              series: [{ key: 'v', label: 'Per maand' }], format: eur })}
          </section>

          ${perGroup.map(({ g, list }) => `
          <section class="card">
            <div class="trends-head"><h2 class="pot-group" style="--gc:${GROUP_COLOR[g]}">${esc(g)}</h2><b class="num">${eur(sumOf(list))}/maand</b></div>
            <p class="muted small" style="margin:4px 0 0">${esc(GROUP_HINT[g])}</p>
            <ul class="list">${list.map((p) => `
              <li><a class="purchase pot-row" href="#/private/pot/${p.id}">
                <div class="grow"><b>${esc(p.name)}</b>${p.purpose ? `<div class="muted small">${esc(p.purpose)}</div>` : ''}</div>
                <div class="num" style="text-align:right"><b>${eur(p.monthly)}</b><div class="muted small">${eur(p.monthly * 12)}/jaar</div></div>
              </a></li>`).join('')}</ul>
          </section>`).join('')}

          <div class="row"><a class="btn grow" href="#/private/pot/new">+ Potje</a><a class="btn btn-ghost grow" href="#/private/pots/import">Plakken</a></div>
          <p class="muted small" style="text-align:center">Potjes · versie ${POTS_VERSION}</p>
        </div>`;
      bindLock();
    });
  }

  function bindLock() {
    document.getElementById('lock')?.addEventListener('click', () => { location.hash = '#/private/lock'; });
  }

  async function form(id) {
    await gate(async () => {
      setChrome('p-pots', 'private');
      const { pots, groups } = await api('private/pots');
      const isNew = id === 'new';
      const p = isNew ? { name: '', monthly: '', grp: 'Vaste kosten', yearly_cost: '', purpose: '' } : pots.find((x) => x.id === Number(id));
      if (!p) { app.innerHTML = '<div class="empty">Potje niet gevonden.</div>'; return; }
      app.innerHTML = `
        <section class="card stack">
          <a href="#/private/pots" class="small">← Potjes</a>
          <h1>${isNew ? 'Nieuw potje' : 'Potje bewerken'}</h1>
          <form id="f" novalidate autocomplete="off">
            <div class="field"><label for="name">Naam</label><input id="name" name="name" value="${esc(p.name)}" maxlength="40" required></div>
            <div class="field-row">
              <div class="field"><label for="monthly">Per maand (€)</label><input id="monthly" name="monthly" inputmode="decimal" value="${esc(dec(p.monthly))}" required></div>
              <div class="field"><label for="grp">Soort</label><select id="grp" name="grp">${groups.map((g) => `<option ${g === p.grp ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></div>
            </div>
            <div class="field" style="margin-top:14px"><label for="yearly_cost">Verwachte jaarkost (€, optioneel)</label>
              <input id="yearly_cost" name="yearly_cost" inputmode="decimal" value="${esc(dec(p.yearly_cost))}">
              <p class="hint">Bv. de jaarlijkse aanslag of premie. Dan zie je of dit potje volstaat.</p></div>
            <div class="field"><label for="purpose">Waarvoor (optioneel)</label><input id="purpose" name="purpose" value="${esc(p.purpose || '')}" maxlength="80"></div>
            <div class="field" style="margin-top:16px"><button class="btn-block" type="submit">Opslaan</button></div>
            ${isNew ? '' : '<div class="field"><button id="del" class="btn-danger btn-block" type="button">Verwijderen</button></div>'}
          </form>
        </section>`;
      const f = document.getElementById('f');
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        submitting(f, async () => {
          const body = { name: f.name.value, monthly: parseNum(f.monthly.value), grp: f.grp.value,
            yearly_cost: f.yearly_cost.value.trim() === '' ? null : parseNum(f.yearly_cost.value), purpose: f.purpose.value };
          if (isNew) await api('private/pots', { method: 'POST', body });
          else await api(`private/pots/${id}`, { method: 'PUT', body });
          toast('Potje opgeslagen');
          location.hash = '#/private/pots';
        });
      });
      document.getElementById('del')?.addEventListener('click', async () => {
        if (!confirm(`Potje "${p.name}" verwijderen?`)) return;
        await api(`private/pots/${id}`, { method: 'DELETE' });
        toast('Potje verwijderd');
        location.hash = '#/private/pots';
      });
    });
  }

  // Plakken: één potje per regel — naam; bedrag per maand; soort; verwachte jaarkost; waarvoor
  function parsePaste(text, groups) {
    const rows = [];
    const errors = [];
    text.split(/\r?\n/).forEach((line, i) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const [name, monthly, grp = '', yearly = '', purpose = ''] = t.split(';').map((c) => c.trim());
      const m = parseNum(monthly ?? '');
      if (!name || !Number.isFinite(m)) { errors.push(`Regel ${i + 1}: naam en bedrag per maand zijn nodig`); return; }
      const g = groups.find((x) => x.toLowerCase() === grp.toLowerCase()) || 'Vaste kosten';
      const y = yearly === '' ? null : parseNum(yearly);
      rows.push({ name, monthly: m, grp: g, yearly_cost: Number.isFinite(y) ? y : null, purpose });
    });
    return { rows, errors };
  }

  async function importView() {
    await gate(async () => {
      setChrome('p-pots', 'private');
      const { pots, groups } = await api('private/pots');
      app.innerHTML = `
        <section class="card stack">
          <a href="#/private/pots" class="small">← Potjes</a>
          <h1>Potjes plakken</h1>
          <p class="muted small">Eén potje per regel, gescheiden door puntkomma's:<br><code>naam; bedrag per maand; soort; verwachte jaarkost; waarvoor</code><br>
            Soort is ${groups.map((g) => `<code>${esc(g)}</code>`).join(', ')}. Jaarkost en "waarvoor" mogen leeg blijven.</p>
          ${pots.length ? `<p class="banner">Je hebt al ${pots.length} potjes; geplakte potjes komen er extra bij.</p>` : ''}
          <form id="f" novalidate>
            <div class="field"><label for="text">Potjes</label>
              <textarea id="text" rows="10" spellcheck="false" style="font-family:ui-monospace,monospace;font-size:14px" placeholder="Autobelasting; 30; Vaste kosten; 360; jaarlijkse verkeersbelasting"></textarea></div>
            <div id="prev"></div>
            <div class="field" style="margin-top:14px"><button class="btn-block" type="submit" disabled>Importeren</button></div>
          </form>
        </section>`;
      const f = document.getElementById('f');
      const btn = f.querySelector('button[type=submit]');
      let parsed = { rows: [], errors: [] };
      f.text.addEventListener('input', () => {
        parsed = parsePaste(f.text.value, groups);
        document.getElementById('prev').innerHTML = `
          ${parsed.errors.map((e) => `<p class="error">${esc(e)}</p>`).join('')}
          ${parsed.rows.length ? `<div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr><th>Potje</th><th>Soort</th><th>Per maand</th></tr></thead>
            <tbody>${parsed.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.grp)}</td><td>${eur(r.monthly)}</td></tr>`).join('')}</tbody></table></div>
            <p class="muted small">Totaal ${eur(parsed.rows.reduce((s, r) => s + r.monthly, 0))} per maand</p>` : ''}`;
        btn.disabled = !parsed.rows.length || parsed.errors.length > 0;
        btn.textContent = parsed.rows.length ? `${parsed.rows.length} potjes importeren` : 'Importeren';
      });
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        submitting(f, async () => {
          await api('private/pots/import', { method: 'POST', body: { rows: parsed.rows } });
          toast(`${parsed.rows.length} potjes toegevoegd`);
          location.hash = '#/private/pots';
        });
      });
    });
  }

  return { overview, form, importView };
}
