import { HttpError, json, readJson, assertSameOrigin } from '../_lib/http.js';
import {
  hashPassword, verifyPassword, validatePassword, createSession, getUser, destroySession,
  assertNotThrottled, recordFailure, clearFailures,
} from '../_lib/auth.js';
import { getPrices, searchTickers } from '../_lib/prices.js';
import { getHistories } from '../_lib/history.js';
import { USAGE_FIELDS, TARIFF_FIELDS, monthlyOverview } from '../_lib/energy.js';
import { privateRoute } from '../_lib/private.js';

const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-^=]{0,19}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- validatie ----------

function normTicker(value) {
  const ticker = String(value || '').trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) throw new HttpError(400, 'Ongeldige ticker');
  return ticker;
}

function positiveNumber(value, label, { allowZero = false } = {}) {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0) || n > 1e12) {
    throw new HttpError(400, `Ongeldige waarde voor ${label}`);
  }
  return n;
}

function parsePurchase(body) {
  const date = String(body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    throw new HttpError(400, 'Ongeldige datum');
  }
  const currency = String(body.currency || 'EUR').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'Ongeldige munt');
  const name = body.name ? String(body.name).trim().slice(0, 120) : null;
  const note = body.note ? String(body.note).trim().slice(0, 300) : null;
  const owner = String(body.owner || '').trim().slice(0, 40);
  if (!owner) throw new HttpError(400, 'Vul in voor wie de aankoop is');
  return {
    owner,
    ticker: normTicker(body.ticker),
    name,
    date,
    quantity: positiveNumber(body.quantity, 'aantal'),
    price: positiveNumber(body.price, 'aankoopprijs'),
    fees: positiveNumber(body.fees || 0, 'kosten', { allowZero: true }),
    currency,
    note,
  };
}

function purchaseOut(r) {
  return {
    id: r.id, ticker: r.ticker, name: r.name, date: r.purchase_date, quantity: r.quantity,
    price: r.price, fees: r.fees, currency: r.currency, note: r.note, owner: r.owner,
  };
}

// ---------- portefeuille ----------

const DAY_MS = 86400000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

async function loadPurchases(db, user) {
  const { results } = await db.prepare(
    'SELECT * FROM purchases WHERE user_id = ? ORDER BY purchase_date, id',
  ).bind(user.id).all();
  return results.map((r) => ({ ...r, owner: r.owner || user.name }));
}

// Geeft een functie ticker → { price, source, currency, updatedAt, error, name }.
async function loadPricing(db, user, tickers, force = false) {
  const { results: manual } = await db.prepare(
    'SELECT ticker, price, updated_at FROM user_prices WHERE user_id = ?',
  ).bind(user.id).all();
  const manualMap = Object.fromEntries(manual.map((m) => [m.ticker, m]));
  const market = await getPrices(db, tickers.filter((t) => !manualMap[t]), { force });
  return (ticker) => {
    const m = manualMap[ticker];
    if (m) return { price: m.price, source: 'manual', currency: null, updatedAt: m.updated_at, error: null, name: null };
    const q = market[ticker] || {};
    return {
      price: q.price ?? null,
      source: q.price != null ? 'market' : null,
      currency: q.currency || null,
      updatedAt: q.updatedAt || null,
      error: q.error || null,
      name: q.name || null,
    };
  };
}

// items: [{ currency, invested, value|null }] → totalen per munt.
// Winst enkel berekend over items waarvan de koers gekend is.
function aggregateTotals(items) {
  const totals = {};
  for (const it of items) {
    const t = (totals[it.currency] ||= { currency: it.currency, invested: 0, value: 0, pricedInvested: 0, complete: true });
    t.invested += it.invested;
    if (it.value != null) {
      t.value += it.value;
      t.pricedInvested += it.invested;
    } else {
      t.complete = false;
    }
  }
  return Object.values(totals).map(({ pricedInvested, ...t }) => {
    const gain = pricedInvested > 0 ? t.value - pricedInvested : null;
    return { ...t, value: pricedInvested > 0 ? t.value : null, gain, gainPct: gain != null ? gain / pricedInvested : null };
  });
}

async function buildPortfolio(db, user, { force = false, owner = null } = {}) {
  const all = await loadPurchases(db, user);
  const priceOf = await loadPricing(db, user, [...new Set(all.map((r) => r.ticker))], force);
  const itemOf = (r) => {
    const { price } = priceOf(r.ticker);
    return { currency: r.currency, invested: r.quantity * r.price + r.fees, value: price != null ? r.quantity * price : null };
  };

  // Uitsplitsing per persoon (altijd over alle aankopen)
  const ownerNames = [...new Set(all.map((r) => r.owner))].sort((a, b) => a.localeCompare(b, 'nl'));
  const owners = ownerNames.map((name) => {
    const rows = all.filter((r) => r.owner === name);
    return { owner: name, purchases: rows.length, tickers: [...new Set(rows.map((r) => r.ticker))], totals: aggregateTotals(rows.map(itemOf)) };
  });

  const rows = owner ? all.filter((r) => r.owner === owner) : all;
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.ticker)) {
      groups.set(r.ticker, { ticker: r.ticker, name: r.name, currency: r.currency, quantity: 0, cost: 0, fees: 0, count: 0, firstDate: r.purchase_date, byOwner: {} });
    }
    const g = groups.get(r.ticker);
    g.quantity += r.quantity;
    g.cost += r.quantity * r.price;
    g.fees += r.fees;
    g.count += 1;
    g.byOwner[r.owner] = (g.byOwner[r.owner] || 0) + r.quantity;
    if (r.name) g.name = r.name;
  }

  const positions = [...groups.values()].map((g) => {
    const q = priceOf(g.ticker);
    const invested = g.cost + g.fees;
    const value = q.price != null ? g.quantity * q.price : null;
    const gain = value != null ? value - invested : null;
    return {
      ticker: g.ticker,
      name: g.name || q.name || null,
      currency: g.currency,
      quantity: g.quantity,
      avgPrice: g.cost / g.quantity,
      invested,
      fees: g.fees,
      purchases: g.count,
      firstDate: g.firstDate,
      owners: Object.entries(g.byOwner).map(([name, quantity]) => ({ owner: name, quantity })),
      price: q.price,
      priceSource: q.source,
      priceCurrency: q.source === 'manual' ? g.currency : q.currency,
      priceUpdatedAt: q.updatedAt,
      priceError: q.error,
      value,
      gain,
      gainPct: gain != null && invested > 0 ? gain / invested : null,
    };
  });
  positions.sort((a, b) => (b.value ?? b.invested) - (a.value ?? a.invested));

  return { owner, owners, positions, totals: aggregateTotals(positions) };
}

// Waarde en geïnvesteerd bedrag doorheen de tijd.
async function buildHistory(db, user, owner) {
  const all = await loadPurchases(db, user);
  let rows = owner ? all.filter((r) => r.owner === owner) : all;
  if (!rows.length) return { currency: null, points: [], owners: [], skipped: 0 };

  // Grafiek in één munt: de munt met het grootste geïnvesteerde bedrag.
  const perCurrency = {};
  rows.forEach((r) => { perCurrency[r.currency] = (perCurrency[r.currency] || 0) + r.quantity * r.price; });
  const currency = Object.entries(perCurrency).sort((a, b) => b[1] - a[1])[0][0];
  const skipped = rows.filter((r) => r.currency !== currency).length;
  rows = rows.filter((r) => r.currency === currency);

  const fromDates = {};
  rows.forEach((r) => { if (!fromDates[r.ticker] || r.purchase_date < fromDates[r.ticker]) fromDates[r.ticker] = r.purchase_date; });
  const tickers = Object.keys(fromDates);
  const [histories, priceOf] = await Promise.all([getHistories(db, fromDates), loadPricing(db, user, tickers)]);

  const start = Date.parse(rows[0].purchase_date);
  const todayStr = isoDay(Date.now());
  const end = Date.parse(todayStr);
  const spanDays = Math.round((end - start) / DAY_MS);
  const step = spanDays > 730 ? 7 : spanDays > 180 ? 2 : 1; // max. ~400 punten
  const dates = [];
  for (let t = start; t < end; t += step * DAY_MS) dates.push(isoDay(t));
  dates.push(todayStr);

  const series = (subset) => valueSeries(subset, dates, histories, priceOf, todayStr);
  const points = series(rows).map((p, i) => ({ d: dates[i], ...p }));

  // Zonder filter: ook een tijdlijn per persoon (zelfde datums).
  const ownerNames = owner ? [] : [...new Set(rows.map((r) => r.owner))].sort((a, b) => a.localeCompare(b, 'nl'));
  const owners = ownerNames.length > 1
    ? ownerNames.map((name) => ({ owner: name, points: series(rows.filter((r) => r.owner === name)) }))
    : [];

  return { currency, points, owners, skipped };
}

// Inleg en waarde per datum voor een (gesorteerde) reeks aankopen.
// Koers = laatste gekende slotkoers op of vóór de datum, anders de aankoopprijs;
// op de laatste dag de huidige koers.
function valueSeries(rows, dates, histories, priceOf, todayStr) {
  const cursor = {};
  const qty = {};
  const lastBuyPrice = {};
  let pi = 0;
  let invested = 0;
  return dates.map((d) => {
    while (pi < rows.length && rows[pi].purchase_date <= d) {
      const r = rows[pi++];
      qty[r.ticker] = (qty[r.ticker] || 0) + r.quantity;
      invested += r.quantity * r.price + r.fees;
      lastBuyPrice[r.ticker] = r.price;
    }
    let value = 0;
    for (const t of Object.keys(qty)) {
      const h = histories[t] || [];
      const c = (cursor[t] ||= { i: 0, last: null });
      while (c.i < h.length && h[c.i][0] <= d) c.last = h[c.i++][1];
      let price = c.last ?? lastBuyPrice[t];
      if (d === todayStr && priceOf(t).price != null) price = priceOf(t).price;
      value += qty[t] * price;
    }
    return { invested: Math.round(invested * 100) / 100, value: Math.round(value * 100) / 100 };
  });
}

// ---------- energie ----------

function parseDate(value) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new HttpError(400, 'Ongeldige datum');
  return date;
}

function optionalNumber(value, label) {
  if (value === '' || value == null) return null;
  return positiveNumber(value, label, { allowZero: true });
}

const USAGE_LABELS = { elec_import: 'afname', elec_export: 'injectie', gas: 'gas', water: 'water' };

function parseMonth(value) {
  const month = String(value || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'Ongeldige maand');
  return month;
}

function parseUsage(body) {
  const u = { note: body.note ? String(body.note).trim().slice(0, 200) : null };
  for (const k of USAGE_FIELDS) u[k] = optionalNumber(body[k], USAGE_LABELS[k]);
  if (USAGE_FIELDS.every((k) => u[k] == null)) throw new HttpError(400, 'Vul minstens één verbruik in');
  return u;
}

function parseTariff(body) {
  const t = { valid_from: parseDate(body.valid_from) };
  for (const k of TARIFF_FIELDS) t[k] = optionalNumber(body[k], k) ?? 0;
  return t;
}

const tariffOut = ({ user_id, ...t }) => t;

async function energyRoute(method, key, kind, request, db, user) {
  if (kind === 'monthly' && method === 'GET') {
    const [{ results: rows }, { results: tariffs }] = await Promise.all([
      db.prepare('SELECT * FROM energy_usage WHERE user_id = ?').bind(user.id).all(),
      db.prepare('SELECT * FROM energy_tariffs WHERE user_id = ?').bind(user.id).all(),
    ]);
    const settings = await db.prepare('SELECT advance, covers, period_start FROM energy_settings WHERE user_id = ?').bind(user.id).first();
    return json({ months: monthlyOverview(rows, tariffs), tariffs: tariffs.map(tariffOut), settings: settings || null });
  }

  if (kind === 'settings' && method === 'PUT') {
    const body = await readJson(request);
    const advance = positiveNumber(body.advance ?? 0, 'voorschot', { allowZero: true });
    const covers = [...new Set([].concat(body.covers || []))].filter((c) => ['elec', 'gas', 'water'].includes(c));
    if (!covers.length) throw new HttpError(400, 'Kies minstens één onderdeel dat het voorschot dekt');
    const periodStart = parseMonth(body.period_start);
    await db.prepare(
      `INSERT INTO energy_settings (user_id, advance, covers, period_start) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET advance = excluded.advance, covers = excluded.covers, period_start = excluded.period_start`,
    ).bind(user.id, advance, covers.join(','), periodStart).run();
    return json({ ok: true });
  }

  if (kind === 'usage' && key) {
    const month = parseMonth(key);
    if (method === 'PUT') {
      const u = parseUsage(await readJson(request));
      await db.prepare(
        `INSERT INTO energy_usage (user_id, month, ${USAGE_FIELDS.join(', ')}, note, updated_at)
         VALUES (?, ?, ${USAGE_FIELDS.map(() => '?').join(', ')}, ?, datetime('now'))
         ON CONFLICT(user_id, month) DO UPDATE SET ${USAGE_FIELDS.map((k) => `${k} = excluded.${k}`).join(', ')},
           note = excluded.note, updated_at = excluded.updated_at`,
      ).bind(user.id, month, ...USAGE_FIELDS.map((k) => u[k]), u.note).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      const res = await db.prepare('DELETE FROM energy_usage WHERE user_id = ? AND month = ?').bind(user.id, month).run();
      if (!res.meta.changes) throw new HttpError(404, 'Maand niet gevonden');
      return json({ ok: true });
    }
  }

  if (kind === 'tariffs') {
    const id = key != null ? Number(key) : null;
    if (key != null && !Number.isInteger(id)) throw new HttpError(404, 'Niet gevonden');
    if (!id && method === 'GET') {
      const { results } = await db.prepare('SELECT * FROM energy_tariffs WHERE user_id = ? ORDER BY valid_from DESC').bind(user.id).all();
      return json({ tariffs: results.map(tariffOut) });
    }
    if (!id && method === 'POST') {
      const t = parseTariff(await readJson(request));
      const row = await db.prepare(
        `INSERT INTO energy_tariffs (user_id, valid_from, ${TARIFF_FIELDS.join(', ')})
         VALUES (?, ?, ${TARIFF_FIELDS.map(() => '?').join(', ')}) RETURNING *`,
      ).bind(user.id, t.valid_from, ...TARIFF_FIELDS.map((k) => t[k])).first();
      return json({ tariff: tariffOut(row) }, 201);
    }
    if (id && method === 'PUT') {
      const t = parseTariff(await readJson(request));
      const row = await db.prepare(
        `UPDATE energy_tariffs SET valid_from = ?, ${TARIFF_FIELDS.map((k) => `${k} = ?`).join(', ')}
         WHERE id = ? AND user_id = ? RETURNING *`,
      ).bind(t.valid_from, ...TARIFF_FIELDS.map((k) => t[k]), id, user.id).first();
      if (!row) throw new HttpError(404, 'Tarief niet gevonden');
      return json({ tariff: tariffOut(row) });
    }
    if (id && method === 'DELETE') {
      const res = await db.prepare('DELETE FROM energy_tariffs WHERE id = ? AND user_id = ?').bind(id, user.id).run();
      if (!res.meta.changes) throw new HttpError(404, 'Tarief niet gevonden');
      return json({ ok: true });
    }
  }

  throw new HttpError(404, 'Niet gevonden');
}

// ---------- routes ----------

async function route(method, parts, request, env, url) {
  const db = env.DB;
  if (!db) throw new HttpError(500, 'D1-database (binding "DB") is niet geconfigureerd');
  const [a, b] = parts;

  // Publieke routes
  if (a === 'config' && method === 'GET') {
    return json({ registrationCodeRequired: Boolean(env.REGISTRATION_CODE), registrationOpen: env.REGISTRATION_OPEN !== 'false' });
  }

  if (a === 'auth') {
    if (b === 'register' && method === 'POST') {
      if (env.REGISTRATION_OPEN === 'false') throw new HttpError(403, 'Registratie is uitgeschakeld');
      const body = await readJson(request);
      if (env.REGISTRATION_CODE && body.code !== env.REGISTRATION_CODE) {
        throw new HttpError(403, 'Ongeldige uitnodigingscode');
      }
      const email = String(body.email || '').trim().toLowerCase();
      const name = String(body.name || '').trim().slice(0, 60);
      if (!EMAIL_RE.test(email) || email.length > 200) throw new HttpError(400, 'Ongeldig e-mailadres');
      if (!name) throw new HttpError(400, 'Naam is verplicht');
      validatePassword(body.password);
      const exists = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
      if (exists) throw new HttpError(409, 'Er bestaat al een account met dit e-mailadres');
      const user = await db.prepare(
        'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?) RETURNING id, email, name',
      ).bind(email, name, await hashPassword(body.password)).first();
      const cookie = await createSession(db, user.id);
      return json({ user }, 201, { 'set-cookie': cookie });
    }

    if (b === 'login' && method === 'POST') {
      const body = await readJson(request);
      const email = String(body.email || '').trim().toLowerCase();
      await assertNotThrottled(db, email);
      const row = await db.prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?').bind(email).first();
      const ok = row && typeof body.password === 'string' && await verifyPassword(body.password, row.password_hash);
      if (!ok) {
        await recordFailure(db, email);
        throw new HttpError(401, 'E-mailadres of wachtwoord is onjuist');
      }
      await clearFailures(db, email);
      const cookie = await createSession(db, row.id);
      return json({ user: { id: row.id, email: row.email, name: row.name } }, 200, { 'set-cookie': cookie });
    }

    if (b === 'logout' && method === 'POST') {
      return json({ ok: true }, 200, { 'set-cookie': await destroySession(request, db) });
    }
  }

  // Vanaf hier: aangemeld zijn verplicht
  const user = await getUser(request, db);
  if (!user) throw new HttpError(401, 'Niet aangemeld');

  if (a === 'me') {
    if (!b && method === 'GET') return json({ user });
    if (b === 'password' && method === 'POST') {
      const body = await readJson(request);
      const row = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first();
      if (typeof body.current !== 'string' || !(await verifyPassword(body.current, row.password_hash))) {
        throw new HttpError(400, 'Huidig wachtwoord is onjuist');
      }
      validatePassword(body.password);
      await db.batch([
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(body.password), user.id),
        db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
      ]);
      return json({ ok: true }, 200, { 'set-cookie': await createSession(db, user.id) });
    }
  }

  if (a === 'energy') return energyRoute(method, parts[2] ?? null, b, request, db, user);

  if (a === 'private') return privateRoute(method, b, request, db, user);

  if (a === 'portfolio' && method === 'GET') {
    return json(await buildPortfolio(db, user, {
      force: url.searchParams.get('refresh') === '1',
      owner: url.searchParams.get('owner') || null,
    }));
  }

  if (a === 'history' && method === 'GET') {
    return json(await buildHistory(db, user, url.searchParams.get('owner') || null));
  }

  if (a === 'purchases') {
    if (!b && method === 'GET') {
      const { results } = await db.prepare(
        'SELECT * FROM purchases WHERE user_id = ? ORDER BY purchase_date DESC, id DESC',
      ).bind(user.id).all();
      return json({ purchases: results.map(purchaseOut) });
    }
    if (!b && method === 'POST') {
      const p = parsePurchase(await readJson(request));
      const row = await db.prepare(
        `INSERT INTO purchases (user_id, ticker, name, purchase_date, quantity, price, fees, currency, note, owner)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      ).bind(user.id, p.ticker, p.name, p.date, p.quantity, p.price, p.fees, p.currency, p.note, p.owner).first();
      return json({ purchase: purchaseOut(row) }, 201);
    }
    const id = Number(b);
    if (!Number.isInteger(id)) throw new HttpError(404, 'Niet gevonden');
    if (method === 'PUT') {
      const p = parsePurchase(await readJson(request));
      const row = await db.prepare(
        `UPDATE purchases SET ticker = ?, name = ?, purchase_date = ?, quantity = ?, price = ?, fees = ?, currency = ?, note = ?, owner = ?
         WHERE id = ? AND user_id = ? RETURNING *`,
      ).bind(p.ticker, p.name, p.date, p.quantity, p.price, p.fees, p.currency, p.note, p.owner, id, user.id).first();
      if (!row) throw new HttpError(404, 'Aankoop niet gevonden');
      return json({ purchase: purchaseOut(row) });
    }
    if (method === 'DELETE') {
      const res = await db.prepare('DELETE FROM purchases WHERE id = ? AND user_id = ?').bind(id, user.id).run();
      if (!res.meta.changes) throw new HttpError(404, 'Aankoop niet gevonden');
      return json({ ok: true });
    }
  }

  if (a === 'quote' && b && method === 'GET') {
    const ticker = normTicker(decodeURIComponent(b));
    const prices = await getPrices(db, [ticker]);
    const q = prices[ticker];
    if (q.price == null) throw new HttpError(404, `Geen koers voor ${ticker}: ${q.error}`);
    return json({ ticker, ...q });
  }

  // Koersgrafiek: 5 jaar dagkoersen + huidige koers + eigen aankopen van deze ticker.
  if (a === 'chart' && b && method === 'GET') {
    const ticker = normTicker(decodeURIComponent(b));
    const from = isoDay(Date.now() - 5 * 365.25 * DAY_MS);
    const [histories, priceOf, { results }] = await Promise.all([
      getHistories(db, { [ticker]: from }),
      loadPricing(db, user, [ticker]),
      db.prepare('SELECT purchase_date, price, quantity, owner FROM purchases WHERE user_id = ? AND ticker = ? ORDER BY purchase_date')
        .bind(user.id, ticker).all(),
    ]);
    const q = priceOf(ticker);
    return json({
      ticker,
      closes: histories[ticker] || [],
      price: q.price,
      priceSource: q.source,
      priceUpdatedAt: q.updatedAt,
      purchases: results.map((r) => ({ date: r.purchase_date, price: r.price, quantity: r.quantity, owner: r.owner })),
    });
  }

  if (a === 'search' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) return json({ results: [] });
    try {
      return json({ results: await searchTickers(q.slice(0, 50)) });
    } catch (err) {
      throw new HttpError(502, err.message);
    }
  }

  if (a === 'prices' && b) {
    const ticker = normTicker(decodeURIComponent(b));
    if (method === 'PUT') {
      const body = await readJson(request);
      const price = positiveNumber(body.price, 'koers');
      await db.prepare(
        `INSERT INTO user_prices (user_id, ticker, price, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, ticker) DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at`,
      ).bind(user.id, ticker, price, Date.now()).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM user_prices WHERE user_id = ? AND ticker = ?').bind(user.id, ticker).run();
      return json({ ok: true });
    }
  }

  throw new HttpError(404, 'Niet gevonden');
}

export async function onRequest({ request, env, params }) {
  const url = new URL(request.url);
  const parts = [].concat(params.route || []);
  try {
    if (request.method !== 'GET') assertSameOrigin(request);
    return await route(request.method, parts, request, env, url);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Er ging iets mis op de server' }, 500);
  }
}

