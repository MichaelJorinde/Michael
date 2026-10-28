// ETF Tracker — single-page app zonder build-stap.
import { lineChart, barChart, legend } from './charts.js';
import { energyViews } from './energy.js';
import { privateViews } from './private.js';
import { analyse } from './signals.js';

const app = document.getElementById('app');
const tabbars = { etf: document.getElementById('tabbar'), energy: document.getElementById('tabbar-energy'), private: document.getElementById('tabbar-private') };
const sectionNav = document.getElementById('sections');
const topbarUser = document.getElementById('topbar-user');
const toastEl = document.getElementById('toast');

const state = { user: null, config: null, owner: null, section: 'etf' };
try { state.section = ['energy', 'private'].includes(localStorage.getItem('section')) ? localStorage.getItem('section') : 'etf'; } catch { /* privémodus */ }
// Vaste volgorde van grafiekkleuren (CSS-variabelen, met donkere variant)
const COLORS = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `var(--c${i})`);
const OTHER_COLOR = 'var(--muted)';

try { state.owner = sessionStorage.getItem('owner') || null; } catch { /* privémodus */ }
function setOwner(owner) {
  state.owner = owner || null;
  try {
    if (state.owner) sessionStorage.setItem('owner', state.owner); else sessionStorage.removeItem('owner');
  } catch { /* privémodus */ }
}
const ownerQuery = (prefix = '?') => (state.owner ? `${prefix}owner=${encodeURIComponent(state.owner)}` : '');

// ---------- helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function money(v, cur = 'EUR') {
  if (v == null) return '—';
  try {
    return new Intl.NumberFormat('nl-BE', { style: 'currency', currency: cur }).format(v);
  } catch {
    return `${num(v, 2)} ${cur}`;
  }
}
const num = (v, max = 4) => new Intl.NumberFormat('nl-BE', { maximumFractionDigits: max }).format(v);
const pct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${new Intl.NumberFormat('nl-BE', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`);
const signed = (v, cur) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${money(v, cur)}`);
const cls = (v) => (v == null ? '' : v >= 0 ? 'gain' : 'loss');
const dateFmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' });
const monthFmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });
const timeAgo = (ms) => {
  if (!ms) return '';
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return 'zonet';
  if (min < 60) return `${min} min geleden`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} u geleden`;
  return new Date(ms).toLocaleDateString('nl-BE');
};
const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD in lokale tijd
const parseNum = (s) => Number(String(s).trim().replace(/\s/g, '').replace(',', '.'));

function toast(msg, isError = false) {
  toastEl.textContent = msg;
  toastEl.className = `toast${isError ? ' err' : ''}`;
  toastEl.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { toastEl.hidden = true; }, 3000);
}

// Elke navigatie krijgt een volgnummer. Antwoorden die binnenkomen nadat de gebruiker al
// naar een ander scherm ging, worden genegeerd, zodat een traag scherm (bv. Energie)
// het nieuwe scherm (bv. ETF's) niet meer kan overschrijven.
let renderSeq = 0;
class StaleView extends Error {}

async function api(path, { method = 'GET', body } = {}) {
  const seq = renderSeq;
  const res = await fetch(`/api/${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('auth/')) {
    state.user = null;
    location.hash = '#/login';
    throw new Error('Niet aangemeld');
  }
  if (!res.ok) throw new Error(data.error || `Fout ${res.status}`);
  if (method === 'GET' && seq !== renderSeq) throw new StaleView();
  return data;
}

function formError(form, msg) {
  let el = form.querySelector('.error');
  if (!el) {
    el = document.createElement('p');
    el.className = 'error';
    form.appendChild(el);
  }
  el.textContent = msg || '';
}

async function submitting(form, fn) {
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  formError(form, '');
  try {
    await fn();
  } catch (err) {
    formError(form, err.message);
  } finally {
    btn.disabled = false;
  }
}

// section: 'etf' of 'energy'; zonder section blijft het huidige onderdeel actief (bv. Account).
function setChrome(tab, section = tab ? 'etf' : state.section) {
  const loggedIn = Boolean(state.user);
  if (loggedIn && section !== state.section) {
    // € Privé vergrendelt zodra je naar een ander onderdeel gaat.
    if (state.section === 'private') lockPrivate();
    state.section = section;
    try { localStorage.setItem('section', section); } catch { /* privémodus */ }
  }
  Object.entries(tabbars).forEach(([k, bar]) => {
    bar.hidden = !loggedIn || k !== state.section;
    bar.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  });
  sectionNav.hidden = !loggedIn;
  sectionNav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.section === state.section));
  document.body.classList.toggle('no-tabs', !loggedIn);
  topbarUser.textContent = loggedIn ? state.user.name : '';
}

// ---------- views: auth ----------

function viewLogin() {
  setChrome();
  app.innerHTML = `
    <section class="auth card stack">
      <div>
        <h1>Aanmelden</h1>
        <p class="muted">Volg de waarde van je ETF's op.</p>
      </div>
      <form id="f" novalidate>
        <div class="field"><label for="email">E-mailadres</label>
          <input id="email" name="email" type="email" autocomplete="email" inputmode="email" required></div>
        <div class="field"><label for="password">Wachtwoord</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required></div>
        <div class="field"><button class="btn-block" type="submit">Aanmelden</button></div>
      </form>
      ${state.config?.registrationOpen ? '<p class="switch">Nog geen account? <a href="#/register">Registreer</a></p>' : ''}
    </section>`;
  const f = document.getElementById('f');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(f, async () => {
      const { user } = await api('auth/login', { method: 'POST', body: { email: f.email.value, password: f.password.value } });
      state.user = user;
      location.hash = state.section === 'energy' ? '#/energy' : state.section === 'private' ? '#/private' : '#/';
    });
  });
}

function viewRegister() {
  setChrome();
  const needCode = state.config?.registrationCodeRequired;
  app.innerHTML = `
    <section class="auth card stack">
      <div>
        <h1>Account maken</h1>
        <p class="muted">Elk account heeft een eigen, afgeschermde portefeuille.</p>
      </div>
      <form id="f" novalidate>
        <div class="field"><label for="name">Naam</label>
          <input id="name" name="name" autocomplete="name" required></div>
        <div class="field"><label for="email">E-mailadres</label>
          <input id="email" name="email" type="email" autocomplete="email" inputmode="email" required></div>
        <div class="field"><label for="password">Wachtwoord</label>
          <input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required>
          <p class="hint">Minstens 8 tekens.</p></div>
        ${needCode ? `<div class="field"><label for="code">Uitnodigingscode</label>
          <input id="code" name="code" autocomplete="off" required></div>` : ''}
        <div class="field"><button class="btn-block" type="submit">Account maken</button></div>
      </form>
      <p class="switch">Al een account? <a href="#/login">Aanmelden</a></p>
    </section>`;
  const f = document.getElementById('f');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(f, async () => {
      const { user } = await api('auth/register', {
        method: 'POST',
        body: { name: f.name.value, email: f.email.value, password: f.password.value, code: f.code?.value },
      });
      state.user = user;
      location.hash = state.section === 'energy' ? '#/energy' : state.section === 'private' ? '#/private' : '#/';
    });
  });
}

// ---------- views: overzicht ----------

function totalsCard(t) {
  return `
    <section class="card hero">
      <div class="label">Huidige waarde${t.currency !== 'EUR' ? ` (${esc(t.currency)})` : ''}</div>
      <div class="big num">${money(t.value, t.currency)}</div>
      <div class="stats">
        <div class="stat"><div class="k">Geïnvesteerd</div><div class="v num">${money(t.invested, t.currency)}</div></div>
        <div class="stat"><div class="k">Winst / verlies</div>
          <div class="v num ${cls(t.gain)}">${signed(t.gain, t.currency)}</div>
          <span class="pill num ${cls(t.gain)}">${pct(t.gainPct)}</span></div>
      </div>
      ${t.complete ? '' : '<p class="warn">Niet alle koersen zijn beschikbaar — de huidige waarde is onvolledig.</p>'}
    </section>`;
}

function allocationCard(positions) {
  let items = positions.map((p, i) => ({ label: p.ticker, w: p.value ?? p.invested, c: COLORS[i] }));
  if (items.length > COLORS.length) {
    const rest = items.slice(COLORS.length - 1);
    items = items.slice(0, COLORS.length - 1).concat({ label: 'Overig', w: rest.reduce((s, x) => s + x.w, 0), c: OTHER_COLOR });
  }
  const sum = items.reduce((s, x) => s + x.w, 0);
  if (positions.length < 2 || !sum) return '';
  return `
    <section class="card">
      <h2>Verdeling</h2>
      <div class="alloc" style="margin-top:12px">${items.map((x) => `<span style="width:${(x.w / sum) * 100}%;background:${x.c}"></span>`).join('')}</div>
      <div class="legend">${items.map((x) => `<span><i style="background:${x.c}"></i>${esc(x.label)} ${num((x.w / sum) * 100, 1)}%</span>`).join('')}</div>
    </section>`;
}

function ownerChips(owners) {
  if (owners.length < 2) return '';
  const names = [null, ...owners.map((o) => o.owner)];
  return `<div class="chips" role="tablist">${names.map((n) => `
    <button type="button" class="chip ${n === state.owner ? 'active' : ''}" data-owner="${esc(n ?? '')}">${esc(n ?? 'Iedereen')}</button>`).join('')}</div>`;
}

function bindOwnerChips(rerender) {
  app.querySelectorAll('.chip[data-owner]').forEach((b) => b.addEventListener('click', () => {
    setOwner(b.dataset.owner);
    rerender();
  }));
}

function personsCard(owners) {
  if (owners.length < 2 || state.owner) return '';
  return `
    <section class="card">
      <h2>Per persoon</h2>
      ${owners.map((o) => o.totals.map((t) => `
        <a class="person" href="#/" data-owner="${esc(o.owner)}">
          <div class="grow">
            <b>${esc(o.owner)}</b>
            <div class="muted small">${esc(o.tickers.join(', '))}</div>
            <div class="muted small num">Geïnvesteerd ${money(t.invested, t.currency)}</div>
          </div>
          <div class="r">
            <div class="num"><b>${money(t.value, t.currency)}</b></div>
            <span class="pill num ${cls(t.gain)}">${pct(t.gainPct)}</span>
            <div class="small num ${cls(t.gain)}">${signed(t.gain, t.currency)}</div>
          </div>
        </a>`).join('')).join('')}
    </section>`;
}

function positionCard(p) {
  return `
    <a class="card position" href="#/position/${encodeURIComponent(p.ticker)}">
      <div class="row between">
        <div class="grow">
          <div class="ticker">${esc(p.ticker)}</div>
          <div class="name">${esc(p.name || '')}</div>
        </div>
        <div class="value">
          <div class="num">${money(p.value, p.currency)}</div>
          <span class="pill num ${cls(p.gain)}">${pct(p.gainPct)}</span>
        </div>
      </div>
      <div class="sub num">
        <span>${num(p.quantity)} × ${money(p.price, p.currency)}${p.priceSource === 'manual' ? ' ✎' : ''}</span>
        <span class="${cls(p.gain)}">${signed(p.gain, p.currency)}</span>
      </div>
      ${p.owners.length > 1 || (!state.owner && state.ownerCount > 1) ? `<div class="tags">${p.owners.map((o) => `<span class="owner-tag">${esc(o.owner)} · ${num(o.quantity)}</span>`).join(' ')}</div>` : ''}
      ${p.priceError && p.price == null ? `<div class="warn">Geen koers: ${esc(p.priceError)}</div>` : ''}
      ${p.priceCurrency && p.priceCurrency !== p.currency ? `<div class="warn">Let op: koers in ${esc(p.priceCurrency)}, aankopen in ${esc(p.currency)}.</div>` : ''}
    </a>`;
}

async function viewDashboard(refresh = false) {
  setChrome('dashboard');
  if (!refresh) app.innerHTML = '<div class="loading">Portefeuille laden…</div>';
  let data = await api(`portfolio?${refresh ? 'refresh=1' : ''}${ownerQuery('&')}`);
  if (state.owner && !data.owners.some((o) => o.owner === state.owner)) {
    setOwner(null);
    data = await api('portfolio');
  }
  state.ownerCount = data.owners.length;
  if (!data.positions.length) {
    app.innerHTML = `
      <section class="card empty stack">
        <h2>Welkom, ${esc(state.user.name)}!</h2>
        <p>Je hebt nog geen aankopen geregistreerd.</p>
        <a class="btn" href="#/add">Eerste aankoop toevoegen</a>
      </section>`;
    return;
  }
  const latest = Math.max(...data.positions.map((p) => p.priceUpdatedAt || 0));
  app.innerHTML = `
    <div class="stack">
      ${ownerChips(data.owners)}
      ${data.totals.map(totalsCard).join('')}
      <div class="row between">
        <span class="muted small">Koersen bijgewerkt ${esc(timeAgo(latest))}</span>
        <button id="refresh" class="btn-ghost btn-small" type="button">
          <svg width="16" height="16" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Vernieuwen</button>
      </div>
      <section class="card accent-card" id="trends-card"><div class="trends-head"><h2>Koersverloop</h2></div><div class="loading" style="padding:16px">Koersen laden…</div></section>
      ${personsCard(data.owners)}
      ${allocationCard(data.positions)}
      <h2>Posities${state.owner ? ` van ${esc(state.owner)}` : ''}</h2>
      <div>${data.positions.map(positionCard).join('')}</div>
    </div>`;
  bindOwnerChips(() => viewDashboard());
  loadTrendsCard(data.positions).catch(() => {});
  app.querySelectorAll('.person[data-owner]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    setOwner(a.dataset.owner);
    viewDashboard();
  }));
  document.getElementById('refresh').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.querySelector('svg').classList.add('spin');
    try {
      await viewDashboard(true);
      toast('Koersen bijgewerkt');
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      btn.querySelector('svg').classList.remove('spin');
    }
  });
}

// ---------- views: positie ----------

function purchaseRow(p, showTicker = true) {
  return `
    <li class="purchase">
      <div class="grow">
        <div><b>${showTicker ? esc(p.ticker) : dateFmt(p.date)}</b>${showTicker ? ` <span class="date">${dateFmt(p.date)}</span>` : ''}
          ${p.owner ? `<span class="owner-tag">${esc(p.owner)}</span>` : ''}</div>
        <div class="muted small num">${num(p.quantity)} × ${money(p.price, p.currency)}${p.fees ? ` + ${money(p.fees, p.currency)} kosten` : ''}</div>
        ${p.note ? `<div class="muted small">${esc(p.note)}</div>` : ''}
      </div>
      <div class="num" style="font-weight:700;text-align:right">${money(p.quantity * p.price + p.fees, p.currency)}</div>
      <a class="btn icon-btn" href="#/edit/${p.id}" aria-label="Bewerken">
        <svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
      </a>
    </li>`;
}

async function viewPosition(ticker) {
  setChrome('dashboard');
  app.innerHTML = '<div class="loading">Laden…</div>';
  const [pf, { purchases }] = await Promise.all([api('portfolio'), api('purchases')]);
  const p = pf.positions.find((x) => x.ticker === ticker);
  if (!p) {
    app.innerHTML = '<div class="empty">Positie niet gevonden. <a href="#/">Terug</a></div>';
    return;
  }
  const mine = purchases.filter((x) => x.ticker === ticker);
  app.innerHTML = `
    <div class="stack">
      <a href="#/" class="small">← Overzicht</a>
      <section class="card hero">
        <div class="label">${esc(p.ticker)}</div>
        <div class="muted">${esc(p.name || '')}</div>
        <div class="big num">${money(p.value, p.currency)}</div>
        <div class="stats">
          <div class="stat"><div class="k">Geïnvesteerd</div><div class="v num">${money(p.invested, p.currency)}</div></div>
          <div class="stat"><div class="k">Winst / verlies</div><div class="v num ${cls(p.gain)}">${signed(p.gain, p.currency)}</div>
            <span class="pill num ${cls(p.gain)}">${pct(p.gainPct)}</span></div>
          <div class="stat"><div class="k">Aantal stuks</div><div class="v num">${num(p.quantity, 6)}</div></div>
          <div class="stat"><div class="k">Gem. aankoopprijs</div><div class="v num">${money(p.avgPrice, p.currency)}</div></div>
          <div class="stat"><div class="k">Huidige koers</div><div class="v num">${money(p.price, p.currency)}</div>
            <div class="muted small">${p.priceSource === 'manual' ? 'manueel ingesteld' : esc(timeAgo(p.priceUpdatedAt))}</div></div>
          <div class="stat"><div class="k">Totale kosten</div><div class="v num">${money(p.fees, p.currency)}</div></div>
        </div>
        ${p.priceError ? `<p class="warn">Koersbron: ${esc(p.priceError)}</p>` : ''}
      </section>

      <section class="card chart-card accent-card" id="price-card">
        <h2>Koersverloop</h2>
        <div class="loading">Koershistoriek laden…</div>
      </section>

      <section class="card">
        <h2>Koers manueel instellen</h2>
        <p class="muted small">Handig als de automatische koers ontbreekt of afwijkt. Enkel zichtbaar voor jou.</p>
        <form id="mp" class="row" novalidate>
          <input class="grow" name="price" inputmode="decimal" placeholder="bv. 112,35" value="${p.priceSource === 'manual' ? esc(String(p.price).replace('.', ',')) : ''}" aria-label="Manuele koers">
          <button type="submit">Opslaan</button>
        </form>
        ${p.priceSource === 'manual' ? '<button id="mp-clear" class="btn-ghost btn-small" type="button" style="margin-top:10px">Terug naar marktkoers</button>' : ''}
      </section>

      <section class="card">
        <div class="row between"><h2>Aankopen (${mine.length})</h2>
          <a class="btn btn-small" href="#/add?ticker=${encodeURIComponent(ticker)}">+ Toevoegen</a></div>
        <ul class="list">${mine.map((x) => purchaseRow(x, false)).join('')}</ul>
      </section>
    </div>`;

  loadPriceCard(ticker, p);

  const mp = document.getElementById('mp');
  mp.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(mp, async () => {
      await api(`prices/${encodeURIComponent(ticker)}`, { method: 'PUT', body: { price: parseNum(mp.price.value) } });
      toast('Koers opgeslagen');
      viewPosition(ticker);
    });
  });
  document.getElementById('mp-clear')?.addEventListener('click', async () => {
    try {
      await api(`prices/${encodeURIComponent(ticker)}`, { method: 'DELETE' });
      toast('Marktkoers hersteld');
      viewPosition(ticker);
    } catch (err) { toast(err.message, true); }
  });
}

// ---------- koersverloop per ETF ----------

const PRICE_RANGES = [['1M', 31], ['6M', 183], ['1J', 365], ['5J', null]];
let priceRange = '1J';

// Koerssignalen: voortschrijdende gemiddelden, 1-jaarsbereik en een beoordeling laag/gemiddeld/hoog.
function priceSignals(data, avgPrice) {
  const a = analyse(data.closes, data.price, today());
  if (!a) return null;
  const { fromHigh, vsMa200 } = a;
  const vsAvg = avgPrice ? a.last.c / avgPrice - 1 : null;

  // Vier niveaus, van uitstekend (blauw) tot relatief hoog (rood).
  const under = `${pct(-fromHigh).replace('+', '')} onder het hoogste punt van het voorbije jaar`;
  let verdict;
  if (a.level === 'excellent') {
    verdict = { level: 'excellent', title: 'Uitstekend om bij te kopen', text: `De koers ligt ${under}${vsMa200 != null && vsMa200 < 0 ? ` en ${pct(-vsMa200).replace('+', '')} onder het 200-daags gemiddelde` : ''}. Zo'n diepe dip komt niet vaak voor; historisch waren dit sterke instapmomenten, al is dat geen garantie.` };
  } else if (a.level === 'good') {
    verdict = { level: 'good', title: 'Goed moment om bij te kopen', text: `De koers ligt ${under}${vsMa200 != null && vsMa200 <= -0.02 ? ' en onder het 200-daags gemiddelde' : ''}. Een gunstig moment om extra in te leggen.` };
  } else if (a.level === 'high') {
    verdict = { level: 'high', title: 'Relatief hoog', text: 'De koers staat dicht bij het hoogste punt van het voorbije jaar en duidelijk boven het 200-daags gemiddelde. Wie wil timen, wacht op een dip; wie maandelijks inlegt, gaat gewoon door.' };
  } else {
    verdict = { level: 'fair', title: 'Redelijk goed', text: 'De koers zit niet bij een uitschieter: niet uitzonderlijk laag of hoog ten opzichte van het voorbije jaar en het 200-daags gemiddelde. Een gewoon moment voor je vaste inleg.' };
  }
  return { ...a, vsAvg, verdict };
}

const VERDICT_ICON = { excellent: '▼▼', good: '▼', fair: '●', high: '▲' };
const verdictBadge = (v) => `<span class="vbadge vbadge-${v.level}"><span aria-hidden="true">${VERDICT_ICON[v.level]}</span> ${esc(v.title)}</span>`;

// Mini-grafiek (laatste jaar) met 200-daags gemiddelde en gemiddelde aankoopprijs.
function sparkline(points, avgPrice) {
  const W = 300;
  const H = 64;
  const vals = points.flatMap((pt) => [pt.c, pt.ma200]).filter((v) => v != null);
  if (avgPrice) vals.push(avgPrice);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i) => (i / (points.length - 1)) * W;
  const y = (v) => H - 4 - ((v - min) / span) * (H - 8);
  const path = (key) => {
    let pen = 'M';
    return points.map((pt, i) => {
      if (pt[key] == null) { pen = 'M'; return ''; }
      const seg = `${pen}${x(i).toFixed(1)},${y(pt[key]).toFixed(1)}`;
      pen = 'L';
      return seg;
    }).join('');
  };
  const line = path('c');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${line}L${W},${H}L0,${H}Z" fill="var(--c1)" opacity=".12"/>
    ${avgPrice ? `<line x1="0" x2="${W}" y1="${y(avgPrice)}" y2="${y(avgPrice)}" class="spark-ref"/>` : ''}
    <path d="${path('ma200')}" fill="none" stroke="var(--c2)" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>
    <path d="${line}" fill="none" stroke="var(--c1)" stroke-width="2.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

// Kaart 'Koersverloop' op het overzicht: per ETF een mini-grafiek en een beoordeling.
async function loadTrendsCard(positions) {
  const el = document.getElementById('trends-card');
  if (!el) return;
  const results = await Promise.all(positions.map((p) => api(`chart/${encodeURIComponent(p.ticker)}`)
    .then((data) => ({ p, sig: priceSignals(data, p.avgPrice) }))
    .catch((err) => { if (err instanceof StaleView) throw err; return { p, sig: null }; })))
    .catch(() => null);
  if (!results || !document.body.contains(el)) return;
  el.innerHTML = `
    <div class="trends-head">
      <h2>Koersverloop</h2>
      <span class="small">laatste jaar</span>
    </div>
    ${results.map(({ p, sig }) => {
      if (!sig) return `<a class="trend" href="#/position/${encodeURIComponent(p.ticker)}"><b>${esc(p.ticker)}</b><span class="muted small">Geen koershistoriek beschikbaar</span></a>`;
      return `
      <a class="trend" href="#/position/${encodeURIComponent(p.ticker)}">
        <div class="row between">
          <div class="grow"><b>${esc(p.ticker)}</b> <span class="num">${money(sig.last.c, p.currency)}</span></div>
          ${verdictBadge(sig.verdict)}
        </div>
        ${sparkline(sig.year, p.avgPrice)}
        <div class="trend-stats num">
          <span>${pct(sig.fromHigh)} <small>t.o.v. 1j-hoogste</small></span>
          <span>${sig.vsMa200 == null ? '—' : pct(sig.vsMa200)} <small>t.o.v. 200d-gem.</small></span>
          <span class="${cls(sig.vsAvg)}">${sig.vsAvg == null ? '—' : pct(sig.vsAvg)} <small>t.o.v. jouw aankoop</small></span>
        </div>
      </a>`;
    }).join('')}
    <p class="small muted" style="margin:8px 0 0">Blauw = koers · oranje stippellijn = 200-daags gemiddelde · grijze lijn = jouw gemiddelde aankoopprijs. Tik voor details.</p>`;
}

async function loadPriceCard(ticker, p) {
  const el = document.getElementById('price-card');
  let data;
  try {
    data = await api(`chart/${encodeURIComponent(ticker)}`);
  } catch (err) {
    if (!(err instanceof StaleView)) el.innerHTML = `<h2>Koersverloop</h2><p class="muted small">Koershistoriek niet beschikbaar: ${esc(err.message)}</p>`;
    return;
  }
  const cur = p.currency;
  const fmt = (v) => money(v, cur);
  const sig = priceSignals(data, p.avgPrice);
  if (!sig) {
    el.innerHTML = '<h2>Koersverloop</h2><p class="muted small">Nog onvoldoende koersgegevens voor een grafiek.</p>';
    return;
  }
  const { closes, last, hi, lo, fromHigh, rangePos, vsMa200, vsAvg, verdict } = sig;
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);

  const series = [
    { key: 'c', label: 'Koers', color: 'var(--c1)' },
    { key: 'ma50', label: '50-daags gem.', color: 'var(--c3)', width: 1.5, dash: '2 3' },
    { key: 'ma200', label: '200-daags gem.', color: 'var(--c2)', width: 1.5, dash: '6 4' },
  ];
  const markers = data.purchases.map((b) => ({ d: b.date, v: b.price, label: `Aankoop: ${num(b.quantity)} × ${fmt(b.price)}${b.owner ? ` (${b.owner})` : ''}` }));
  const shortDate = (d, long) => new Date(`${d}T00:00:00`).toLocaleDateString('nl-BE', long ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short', year: '2-digit' });

  el.innerHTML = `
    <div class="chart-head"><h2>Koersverloop</h2><span class="num"><b>${fmt(last.c)}</b></span></div>
    <div class="chips" style="margin-top:8px">${PRICE_RANGES.map(([k]) => `<button type="button" class="chip ${k === priceRange ? 'active' : ''}" data-range="${k}">${k}</button>`).join('')}</div>
    ${legend(series)}
    <div id="ch-price"></div>
    <p class="muted small" style="margin-top:4px">Stippellijn: jouw gemiddelde aankoopprijs · ○ = jouw aankopen</p>
    <div class="verdict verdict-${verdict.level}">${verdictBadge(verdict)}<p>${esc(verdict.text)}</p></div>
    <div class="stats" style="margin-top:12px">
      <div class="stat"><div class="k">t.o.v. hoogste (1 jaar)</div><div class="v num">${pct(fromHigh)}</div><div class="muted small">hoogste ${fmt(hi)}</div></div>
      <div class="stat"><div class="k">t.o.v. 200-daags gem.</div><div class="v num">${vsMa200 == null ? '—' : pct(vsMa200)}</div><div class="muted small">${last.ma200 ? fmt(last.ma200) : 'te weinig historiek'}</div></div>
      <div class="stat"><div class="k">t.o.v. jouw aankoopprijs</div><div class="v num ${cls(vsAvg)}">${vsAvg == null ? '—' : pct(vsAvg)}</div><div class="muted small">gem. ${fmt(p.avgPrice)}</div></div>
      <div class="stat"><div class="k">Plaats in 1-jaarsbereik</div><div class="v num">${num(rangePos * 100, 0)}%</div>
        <div class="meter" style="margin-top:6px"><span style="width:${Math.max(3, rangePos * 100)}%;background:var(--c1)"></span></div>
        <div class="muted small">0% = laagste ${fmt(lo)}</div></div>
    </div>
    <p class="muted small">Dit is een hulpmiddel, geen beleggingsadvies. Voor wie op lange termijn belegt, werkt regelmatig inleggen meestal beter dan proberen het perfecte moment te kiezen.</p>`;

  const draw = () => {
    const cfg = PRICE_RANGES.find(([k]) => k === priceRange);
    const pts = cfg[1] ? closes.filter((pt) => pt.d >= day(Date.parse(last.d) - cfg[1] * 86400000)) : closes;
    lineChart(document.getElementById('ch-price'), {
      points: pts, series, yFormat: fmt, yTick: (v) => num(v, 0), dateFormat: shortDate,
      refLines: p.avgPrice ? [{ value: p.avgPrice, label: `Gem. aankoop ${fmt(p.avgPrice)}` }] : [],
      markers,
    });
  };
  el.querySelectorAll('.chip[data-range]').forEach((b) => b.addEventListener('click', () => {
    priceRange = b.dataset.range;
    el.querySelectorAll('.chip[data-range]').forEach((c) => c.classList.toggle('active', c === b));
    draw();
  }));
  draw();
}

// ---------- views: aankoop toevoegen / bewerken ----------

async function viewPurchaseForm(id, presetTicker) {
  setChrome(id ? 'purchases' : 'add');
  let p = { ticker: presetTicker || '', name: '', date: today(), quantity: '', price: '', fees: '', currency: 'EUR', note: '', owner: '' };
  app.innerHTML = '<div class="loading">Laden…</div>';
  const { purchases } = await api('purchases');
  const knownOwners = [...new Set([state.user.name, ...purchases.map((x) => x.owner).filter(Boolean)])];
  p.owner = state.owner || purchases[0]?.owner || state.user.name;
  if (id) {
    const found = purchases.find((x) => x.id === Number(id));
    if (!found) {
      app.innerHTML = '<div class="empty">Aankoop niet gevonden.</div>';
      return;
    }
    p = found;
  } else if (presetTicker) {
    const prev = purchases.find((x) => x.ticker === presetTicker);
    if (prev) Object.assign(p, { name: prev.name || '', currency: prev.currency });
  }
  const dec = (v) => (v === '' || v == null ? '' : String(v).replace('.', ','));

  app.innerHTML = `
    <section class="card stack">
      <h1>${id ? 'Aankoop bewerken' : 'Aankoop toevoegen'}</h1>
      <form id="f" novalidate autocomplete="off">
        <div class="field suggest">
          <label for="ticker">ETF (ticker of naam)</label>
          <input id="ticker" name="ticker" value="${esc(p.ticker)}" placeholder="bv. VWCE.DE of iShares MSCI World" autocapitalize="characters" spellcheck="false" required>
          <ul id="sugg" class="suggest-list" hidden></ul>
          <p id="tname" class="hint">${esc(p.name || 'Gebruik de Yahoo Finance-ticker, bv. IWDA.AS (Amsterdam) of VWCE.DE (Xetra).')}</p>
        </div>
        <input type="hidden" name="name" value="${esc(p.name || '')}">
        <div class="field" style="margin-top:14px"><label for="owner">Voor wie?</label>
          <input id="owner" name="owner" list="owners" value="${esc(p.owner || '')}" maxlength="40" autocomplete="off" required>
          <datalist id="owners">${knownOwners.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>
          <div class="chips" style="margin-top:8px">${knownOwners.map((o) => `<button type="button" class="chip" data-pick="${esc(o)}">${esc(o)}</button>`).join('')}</div>
          <p class="hint">Bv. je eigen naam of die van een kind. Typ een nieuwe naam om iemand toe te voegen.</p></div>
        <div class="field-row">
          <div class="field"><label for="date">Datum</label>
            <input id="date" name="date" type="date" value="${esc(p.date)}" max="${today()}" required></div>
          <div class="field"><label for="currency">Munt</label>
            <select id="currency" name="currency">
              ${['EUR', 'USD', 'GBP', 'CHF'].concat(['EUR', 'USD', 'GBP', 'CHF'].includes(p.currency) ? [] : [p.currency])
                .map((c) => `<option ${c === p.currency ? 'selected' : ''}>${esc(c)}</option>`).join('')}
            </select></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="quantity">Aantal stuks</label>
            <input id="quantity" name="quantity" inputmode="decimal" value="${esc(dec(p.quantity))}" placeholder="bv. 10" required></div>
          <div class="field"><label for="price">Prijs per stuk</label>
            <input id="price" name="price" inputmode="decimal" value="${esc(dec(p.price))}" placeholder="bv. 112,35" required></div>
        </div>
        <button id="useq" type="button" class="btn-ghost btn-small" style="margin-top:8px">Huidige koers gebruiken</button>
        <div class="field" style="margin-top:14px"><label for="fees">Transactiekosten (optioneel)</label>
          <input id="fees" name="fees" inputmode="decimal" value="${esc(dec(p.fees || ''))}" placeholder="0,00"></div>
        <div class="field"><label for="note">Notitie (optioneel)</label>
          <input id="note" name="note" value="${esc(p.note || '')}" maxlength="300" placeholder="bv. maandelijkse inleg"></div>
        <div class="total-line"><span>Totaal</span><span id="total" class="num">—</span></div>
        <div class="field" style="margin-top:16px"><button class="btn-block" type="submit">${id ? 'Opslaan' : 'Aankoop toevoegen'}</button></div>
        ${id ? '<div class="field"><button id="del" class="btn-danger btn-block" type="button">Verwijderen</button></div>' : ''}
      </form>
    </section>`;

  const f = document.getElementById('f');
  const sugg = document.getElementById('sugg');
  const markOwner = () => f.querySelectorAll('.chip[data-pick]').forEach((c) => c.classList.toggle('active', c.dataset.pick === f.owner.value.trim()));
  f.querySelectorAll('.chip[data-pick]').forEach((c) => c.addEventListener('click', () => { f.owner.value = c.dataset.pick; markOwner(); }));
  f.owner.addEventListener('input', markOwner);
  markOwner();
  const tname = document.getElementById('tname');

  const updateTotal = () => {
    const q = parseNum(f.quantity.value);
    const pr = parseNum(f.price.value);
    const fe = f.fees.value ? parseNum(f.fees.value) : 0;
    document.getElementById('total').textContent = q > 0 && pr > 0 && fe >= 0 ? money(q * pr + fe, f.currency.value) : '—';
  };
  ['quantity', 'price', 'fees', 'currency'].forEach((n) => f[n].addEventListener('input', updateTotal));
  updateTotal();

  let timer;
  let seq = 0;
  f.ticker.addEventListener('input', () => {
    clearTimeout(timer);
    f.name.value = '';
    const q = f.ticker.value.trim();
    if (q.length < 2) { sugg.hidden = true; return; }
    timer = setTimeout(async () => {
      const mySeq = ++seq;
      try {
        const { results } = await api(`search?q=${encodeURIComponent(q)}`);
        if (mySeq !== seq) return;
        sugg.innerHTML = results.map((r) => `
          <li><button type="button" data-symbol="${esc(r.symbol)}" data-name="${esc(r.name)}">
            <b>${esc(r.symbol)}</b><small>${esc(r.name)} · ${esc(r.exchange)} · ${esc(r.type)}</small></button></li>`).join('');
        sugg.hidden = !results.length;
      } catch { sugg.hidden = true; }
    }, 300);
  });
  sugg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-symbol]');
    if (!btn) return;
    f.ticker.value = btn.dataset.symbol;
    f.name.value = btn.dataset.name;
    tname.textContent = btn.dataset.name;
    sugg.hidden = true;
    loadQuote(false);
  });
  f.ticker.addEventListener('blur', () => setTimeout(() => { sugg.hidden = true; }, 200));

  async function loadQuote(fillPrice) {
    const t = f.ticker.value.trim().toUpperCase();
    if (!t) { toast('Vul eerst een ticker in', true); return; }
    try {
      const q = await api(`quote/${encodeURIComponent(t)}`);
      if (q.name && !f.name.value) { f.name.value = q.name; tname.textContent = q.name; }
      if (q.currency && [...f.currency.options].some((o) => o.value === q.currency)) f.currency.value = q.currency;
      if (fillPrice) f.price.value = String(q.price).replace('.', ',');
      updateTotal();
    } catch (err) {
      if (fillPrice) toast(err.message, true);
    }
  }
  document.getElementById('useq').addEventListener('click', () => loadQuote(true));

  f.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(f, async () => {
      const body = {
        ticker: f.ticker.value, name: f.name.value || null, date: f.date.value, currency: f.currency.value,
        quantity: parseNum(f.quantity.value), price: parseNum(f.price.value),
        fees: f.fees.value ? parseNum(f.fees.value) : 0, note: f.note.value, owner: f.owner.value,
      };
      if (id) {
        await api(`purchases/${id}`, { method: 'PUT', body });
        toast('Aankoop bijgewerkt');
        history.back();
      } else {
        const { purchase } = await api('purchases', { method: 'POST', body });
        toast('Aankoop toegevoegd');
        location.hash = `#/position/${encodeURIComponent(purchase.ticker)}`;
      }
    });
  });

  document.getElementById('del')?.addEventListener('click', async () => {
    if (!confirm('Deze aankoop verwijderen?')) return;
    try {
      await api(`purchases/${id}`, { method: 'DELETE' });
      toast('Aankoop verwijderd');
      location.hash = '#/purchases';
    } catch (err) { toast(err.message, true); }
  });
}

// ---------- views: grafieken ----------

const shortDate = (d, long) => new Date(`${d}T00:00:00`).toLocaleDateString('nl-BE', long ? { day: 'numeric', month: 'short', year: 'numeric' } : { month: 'short', year: '2-digit' });
const compact = (cur) => (v) => new Intl.NumberFormat('nl-BE', { style: 'currency', currency: cur, notation: 'compact', maximumFractionDigits: 1 }).format(v);

async function viewCharts() {
  setChrome('charts');
  app.innerHTML = '<div class="loading">Grafieken laden…</div>';
  let [pf, hist] = await Promise.all([api(`portfolio${ownerQuery()}`), api(`history${ownerQuery()}`)]);
  if (state.owner && !pf.owners.some((o) => o.owner === state.owner)) {
    setOwner(null);
    [pf, hist] = await Promise.all([api('portfolio'), api('history')]);
  }
  if (!hist.points.length) {
    app.innerHTML = '<section class="card empty stack"><p>Voeg eerst een aankoop toe om grafieken te zien.</p><a class="btn" href="#/add">Aankoop toevoegen</a></section>';
    return;
  }
  const cur = hist.currency;
  const pts = hist.points.map((p) => ({ ...p, gain: Math.round((p.value - p.invested) * 100) / 100 }));
  const last = pts[pts.length - 1];
  const fmt = (v) => money(v, cur);
  const valueSeries = [
    { key: 'value', label: 'Waarde', color: 'var(--c1)' },
    { key: 'invested', label: 'Geïnvesteerd', color: 'var(--c2)' },
  ];
  const positions = pf.positions.filter((p) => p.gain != null && p.currency === cur);
  const owners = pf.owners.map((o) => ({ owner: o.owner, t: o.totals.find((t) => t.currency === cur) })).filter((o) => o.t && o.t.value != null);

  // Tijdlijn per persoon: kleur volgt de persoon (vaste volgorde, max. 8 lijnen)
  const ownerIndex = Object.fromEntries(pf.owners.map((o, i) => [o.owner, i]));
  const personLines = (hist.owners || []).slice(0, COLORS.length).map((o) => ({
    ...o, key: `p${ownerIndex[o.owner]}`, color: COLORS[ownerIndex[o.owner] % COLORS.length],
  }));
  const PP_METRICS = [
    { key: 'value', label: 'Waarde' },
    { key: 'invested', label: 'Inleg' },
    { key: 'gain', label: 'Winst' },
  ];
  let ppMetric = viewCharts.metric || 'value';
  const ppPoints = (metric) => pts.map((p, i) => ({
    d: p.d,
    ...Object.fromEntries(personLines.map((o) => {
      const q = o.points[i];
      return [o.key, metric === 'gain' ? Math.round((q.value - q.invested) * 100) / 100 : q[metric]];
    })),
  }));

  const table = (head, rows) => `
    <details class="table-view"><summary>Toon als tabel</summary>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    </details>`;

  app.innerHTML = `
    <div class="stack">
      <h1>Grafieken${state.owner ? ` · ${esc(state.owner)}` : ''}</h1>
      ${ownerChips(pf.owners)}

      <section class="card chart-card">
        <div class="chart-head"><h2>Waarde en inleg</h2><span class="muted small">sinds ${esc(shortDate(pts[0].d, true))}</span></div>
        ${legend(valueSeries.map((s) => ({ ...s, label: `${s.label} ${fmt(last[s.key])}` })))}
        <div id="ch-value"></div>
        ${table(['Datum', 'Waarde', 'Geïnvesteerd'], pts.slice().reverse().map((p) => [shortDate(p.d, true), fmt(p.value), fmt(p.invested)]))}
      </section>

      <section class="card chart-card">
        <div class="chart-head"><h2>Winst / verlies</h2><span class="num ${cls(last.gain)}"><b>${signed(last.gain, cur)}</b></span></div>
        <div id="ch-gain"></div>
        ${table(['Datum', 'Winst / verlies'], pts.slice().reverse().map((p) => [shortDate(p.d, true), signed(p.gain, cur)]))}
      </section>

      ${positions.length ? `
      <section class="card chart-card">
        <h2>Winst per ETF</h2>
        ${barChart({
          items: positions.map((p) => ({ label: p.ticker, sub: pct(p.gainPct), values: { gain: p.gain } })),
          series: [{ key: 'gain', label: 'Winst / verlies', color: 'var(--c1)', negColor: 'var(--c8)' }],
          format: (v) => signed(v, cur),
        })}
      </section>` : ''}

      ${personLines.length ? `
      <section class="card chart-card">
        <div class="chart-head"><h2>Per persoon doorheen de tijd</h2></div>
        <div class="chips" style="margin-top:8px" id="pp-metric">
          ${PP_METRICS.map((mt) => `<button type="button" class="chip ${mt.key === ppMetric ? 'active' : ''}" data-metric="${mt.key}">${mt.label}</button>`).join('')}
        </div>
        <div id="pp-legend"></div>
        <div id="ch-persons"></div>
        <div id="pp-table"></div>
      </section>` : ''}

      ${owners.length > 1 && !state.owner ? `
      <section class="card chart-card">
        <h2>Winst per persoon</h2>
        ${barChart({
          items: owners.map((o) => ({ label: o.owner, sub: pct(o.t.gainPct), values: { gain: o.t.gain } })),
          series: [{ key: 'gain', label: 'Winst / verlies', color: 'var(--c1)', negColor: 'var(--c8)' }],
          format: (v) => signed(v, cur),
        })}
      </section>

      <section class="card chart-card">
        <h2>Waarde en inleg per persoon</h2>
        ${legend(valueSeries)}
        ${barChart({
          items: owners.map((o) => ({ label: o.owner, sub: pct(o.t.gainPct), values: { value: o.t.value, invested: o.t.invested } })),
          series: valueSeries,
          format: fmt,
        })}
      </section>` : ''}

      ${hist.skipped ? `<p class="muted small">${hist.skipped} aankoop/aankopen in een andere munt dan ${esc(cur)} zitten niet in de tijdlijn.</p>` : ''}
      <p class="muted small">De tijdlijn gebruikt historische slotkoersen; de laatste dag gebruikt de huidige koers.</p>
    </div>`;

  bindOwnerChips(() => viewCharts());
  const draw = () => {
    lineChart(document.getElementById('ch-value'), { points: pts, series: valueSeries, yFormat: fmt, yTick: compact(cur), dateFormat: shortDate });
    lineChart(document.getElementById('ch-gain'), {
      points: pts, series: [{ key: 'gain', label: 'Winst / verlies', color: 'var(--c1)', area: true }],
      yFormat: (v) => signed(v, cur), yTick: compact(cur), dateFormat: shortDate, zero: true,
    });
  };
  const drawPersons = () => {
    if (!personLines.length) return;
    const data = ppPoints(ppMetric);
    const f = ppMetric === 'gain' ? (v) => signed(v, cur) : fmt;
    const last2 = data[data.length - 1];
    document.getElementById('pp-legend').innerHTML = legend(personLines.map((o) => ({ color: o.color, label: `${o.owner} ${f(last2[o.key])}` })));
    lineChart(document.getElementById('ch-persons'), {
      points: data, series: personLines.map((o) => ({ key: o.key, label: o.owner, color: o.color })),
      yFormat: f, yTick: compact(cur), dateFormat: shortDate, zero: ppMetric === 'gain',
    });
    document.getElementById('pp-table').innerHTML = table(['Datum', ...personLines.map((o) => o.owner)],
      data.slice().reverse().map((p) => [shortDate(p.d, true), ...personLines.map((o) => f(p[o.key]))]));
  };
  app.querySelectorAll('#pp-metric .chip').forEach((b) => b.addEventListener('click', () => {
    ppMetric = viewCharts.metric = b.dataset.metric;
    app.querySelectorAll('#pp-metric .chip').forEach((c) => c.classList.toggle('active', c === b));
    drawPersons();
  }));
  draw();
  drawPersons();
  clearTimeout(viewCharts.t);
  window.onresize = () => { clearTimeout(viewCharts.t); viewCharts.t = setTimeout(() => { if (document.getElementById('ch-value')) { draw(); drawPersons(); } }, 150); };
}

// ---------- views: historiek ----------

async function viewPurchases() {
  setChrome('purchases');
  app.innerHTML = '<div class="loading">Laden…</div>';
  const { purchases } = await api('purchases');
  if (!purchases.length) {
    app.innerHTML = '<section class="card empty stack"><p>Nog geen aankopen.</p><a class="btn" href="#/add">Aankoop toevoegen</a></section>';
    return;
  }
  let html = '';
  let month = '';
  for (const p of purchases) {
    const m = p.date.slice(0, 7);
    if (m !== month) {
      if (month) html += '</ul></section>';
      html += `<div class="month">${esc(monthFmt(p.date))}</div><section class="card"><ul class="list">`;
      month = m;
    }
    html += purchaseRow(p);
  }
  html += '</ul></section>';
  app.innerHTML = `<h1>Historiek</h1>${html}`;
}

// ---------- views: account ----------

function viewSettings() {
  setChrome('settings', state.section);
  app.innerHTML = `
    <div class="stack">
      <section class="card">
        <h2>${esc(state.user.name)}</h2>
        <p class="muted">${esc(state.user.email)}</p>
        <button id="logout" class="btn-ghost btn-block" type="button">Afmelden</button>
      </section>
      <section class="card">
        <h2>Wachtwoord wijzigen</h2>
        <form id="pw" novalidate style="margin-top:12px">
          <div class="field"><label for="current">Huidig wachtwoord</label>
            <input id="current" name="current" type="password" autocomplete="current-password" required></div>
          <div class="field"><label for="password">Nieuw wachtwoord</label>
            <input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required></div>
          <div class="field"><button class="btn-block" type="submit">Wijzigen</button></div>
        </form>
        <p class="muted small">Na het wijzigen worden andere toestellen afgemeld.</p>
      </section>
      <section class="card small muted">
        <p>Tip: voeg deze site toe aan je beginscherm (deel-menu → "Zet op beginscherm") om hem als app te gebruiken.</p>
        <p>Koersen komen van Yahoo Finance en worden 15 minuten gecachet.</p>
        <p>Energie: je maandverbruik geef je zelf in vanuit de HomeWizard Energy-app.</p>
      </section>
    </div>`;
  document.getElementById('logout').addEventListener('click', async () => {
    await api('auth/logout', { method: 'POST' }).catch(() => {});
    state.user = null;
    location.hash = '#/login';
  });
  const pw = document.getElementById('pw');
  pw.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(pw, async () => {
      await api('me/password', { method: 'POST', body: { current: pw.current.value, password: pw.password.value } });
      pw.reset();
      toast('Wachtwoord gewijzigd');
    });
  });
}

const priv = privateViews({ app, api, esc, money, num, toast, setChrome, submitting, parseNum });

function lockPrivate() {
  fetch('/api/private/lock', { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => {});
}

const energy = energyViews({ app, api, esc, money, num, toast, submitting, setChrome, today, parseNum, dateFmt, cls });

// ---------- router ----------

async function render() {
  renderSeq += 1;
  const [path, query] = location.hash.slice(1).split('?');
  const parts = (path || '/').split('/').filter(Boolean);
  const params = new URLSearchParams(query || '');
  const publicRoute = parts[0] === 'login' || parts[0] === 'register';

  if (!state.user && !publicRoute) { location.hash = '#/login'; return; }
  if (state.user && publicRoute) { location.hash = state.section === 'energy' ? '#/energy' : state.section === 'private' ? '#/private' : '#/'; return; }

  window.scrollTo(0, 0);
  try {
    switch (parts[0]) {
      case 'login': return viewLogin();
      case 'register': return viewRegister();
      case 'add': return await viewPurchaseForm(null, params.get('ticker'));
      case 'edit': return await viewPurchaseForm(parts[1]);
      case 'purchases': return await viewPurchases();
      case 'charts': return await viewCharts();
      case 'position': return await viewPosition(decodeURIComponent(parts[1] || ''));
      case 'settings': return viewSettings();
      case 'private':
        switch (parts[1]) {
          case 'pin': return await priv.changePin();
          case 'lock': return await priv.lockNow();
          case 'import': return await priv.importView();
          case 'pots': return parts[2] === 'import' ? await priv.potsImport(params.get('d')) : await priv.pots();
          case 'pot': return await priv.potForm(parts[2]);
          default: return await priv.overview();
        }
      case 'energy':
        switch (parts[1]) {
          case 'add': return await energy.monthForm(null);
          case 'month': return await energy.monthForm(parts[2]);
          case 'months': return await energy.monthsList();
          case 'import': return await energy.importView();
          case 'settings': return await energy.settingsView();
          case 'tariffs': return await energy.tariffs();
          case 'tariff': return await energy.tariffForm(parts[2]);
          default: return await energy.overview();
        }
      default: return await viewDashboard();
    }
  } catch (err) {
    if (err instanceof StaleView) return; // gebruiker is al naar een ander scherm gegaan
    if (state.user) app.innerHTML = `<div class="empty">${esc(err.message)}<br><br><a href="#/">Opnieuw proberen</a></div>`;
  }
}

async function init() {
  try {
    state.config = await fetch('/api/config').then((r) => r.json());
  } catch {
    state.config = { registrationOpen: true };
  }
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (res.ok) state.user = (await res.json()).user;
  } catch { /* offline */ }
  window.addEventListener('hashchange', render);
  // Wisselen naar een andere app vergrendelt € Privé niet meer: de ontgrendeling vervalt pas
  // na 10 minuten zonder activiteit (server). Bij terugkeer enkel de pincode vragen als die tijd om is.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || state.section !== 'private' || !location.hash.startsWith('#/private')) return;
    try {
      const s = await api('private/status');
      if (!s.unlocked) render();
    } catch { /* offline */ }
  });
  // Een tab aantikken waarvan het adres al open staat, laadt het scherm opnieuw.
  document.querySelectorAll('.tabbar a, #sections a').forEach((a) => a.addEventListener('click', (e) => {
    if (a.getAttribute('href') === (location.hash || '#/')) {
      e.preventDefault();
      render();
    }
  }));
  render();
}

init();
