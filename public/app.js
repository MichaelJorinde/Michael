// ETF Tracker — single-page app zonder build-stap.
const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');
const topbarUser = document.getElementById('topbar-user');
const toastEl = document.getElementById('toast');

const state = { user: null, config: null };
const COLORS = ['#0f766e', '#2563eb', '#d97706', '#9333ea', '#db2777', '#059669', '#64748b', '#dc2626', '#0891b2', '#65a30d'];

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

async function api(path, { method = 'GET', body } = {}) {
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

function setChrome(tab) {
  const loggedIn = Boolean(state.user);
  tabbar.hidden = !loggedIn;
  document.body.classList.toggle('no-tabs', !loggedIn);
  topbarUser.textContent = loggedIn ? state.user.name : '';
  tabbar.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
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
      location.hash = '#/';
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
      location.hash = '#/';
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
  const items = positions.map((p, i) => ({ p, w: p.value ?? p.invested, c: COLORS[i % COLORS.length] }));
  const sum = items.reduce((s, x) => s + x.w, 0);
  if (positions.length < 2 || !sum) return '';
  return `
    <section class="card">
      <h2>Verdeling</h2>
      <div class="alloc" style="margin-top:12px">${items.map((x) => `<span style="width:${(x.w / sum) * 100}%;background:${x.c}"></span>`).join('')}</div>
      <div class="legend">${items.map((x) => `<span><i style="background:${x.c}"></i>${esc(x.p.ticker)} ${num((x.w / sum) * 100, 1)}%</span>`).join('')}</div>
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
      ${p.priceError && p.price == null ? `<div class="warn">Geen koers: ${esc(p.priceError)}</div>` : ''}
      ${p.priceCurrency && p.priceCurrency !== p.currency ? `<div class="warn">Let op: koers in ${esc(p.priceCurrency)}, aankopen in ${esc(p.currency)}.</div>` : ''}
    </a>`;
}

async function viewDashboard(refresh = false) {
  setChrome('dashboard');
  if (!refresh) app.innerHTML = '<div class="loading">Portefeuille laden…</div>';
  const data = await api(`portfolio${refresh ? '?refresh=1' : ''}`);
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
      ${data.totals.map(totalsCard).join('')}
      <div class="row between">
        <span class="muted small">Koersen bijgewerkt ${esc(timeAgo(latest))}</span>
        <button id="refresh" class="btn-ghost btn-small" type="button">
          <svg width="16" height="16" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Vernieuwen</button>
      </div>
      ${allocationCard(data.positions)}
      <h2>Posities</h2>
      <div>${data.positions.map(positionCard).join('')}</div>
    </div>`;
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
        <div><b>${showTicker ? esc(p.ticker) : dateFmt(p.date)}</b>${showTicker ? ` <span class="date">${dateFmt(p.date)}</span>` : ''}</div>
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

// ---------- views: aankoop toevoegen / bewerken ----------

async function viewPurchaseForm(id, presetTicker) {
  setChrome(id ? 'purchases' : 'add');
  let p = { ticker: presetTicker || '', name: '', date: today(), quantity: '', price: '', fees: '', currency: 'EUR', note: '' };
  if (id) {
    app.innerHTML = '<div class="loading">Laden…</div>';
    const { purchases } = await api('purchases');
    const found = purchases.find((x) => x.id === Number(id));
    if (!found) {
      app.innerHTML = '<div class="empty">Aankoop niet gevonden.</div>';
      return;
    }
    p = found;
  } else if (presetTicker) {
    const { purchases } = await api('purchases').catch(() => ({ purchases: [] }));
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
        fees: f.fees.value ? parseNum(f.fees.value) : 0, note: f.note.value,
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
  setChrome('settings');
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

// ---------- router ----------

async function render() {
  const [path, query] = location.hash.slice(1).split('?');
  const parts = (path || '/').split('/').filter(Boolean);
  const params = new URLSearchParams(query || '');
  const publicRoute = parts[0] === 'login' || parts[0] === 'register';

  if (!state.user && !publicRoute) { location.hash = '#/login'; return; }
  if (state.user && publicRoute) { location.hash = '#/'; return; }

  window.scrollTo(0, 0);
  try {
    switch (parts[0]) {
      case 'login': return viewLogin();
      case 'register': return viewRegister();
      case 'add': return await viewPurchaseForm(null, params.get('ticker'));
      case 'edit': return await viewPurchaseForm(parts[1]);
      case 'purchases': return await viewPurchases();
      case 'position': return await viewPosition(decodeURIComponent(parts[1] || ''));
      case 'settings': return viewSettings();
      default: return await viewDashboard();
    }
  } catch (err) {
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
  render();
}

init();
