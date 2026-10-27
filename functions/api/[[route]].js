import { HttpError, json, readJson, assertSameOrigin } from '../_lib/http.js';
import {
  hashPassword, verifyPassword, validatePassword, createSession, getUser, destroySession,
  assertNotThrottled, recordFailure, clearFailures,
} from '../_lib/auth.js';
import { getPrices, searchTickers } from '../_lib/prices.js';

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
  return {
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
    price: r.price, fees: r.fees, currency: r.currency, note: r.note,
  };
}

// ---------- portefeuille ----------

async function buildPortfolio(db, user, force) {
  const { results: rows } = await db.prepare(
    'SELECT * FROM purchases WHERE user_id = ? ORDER BY purchase_date, id',
  ).bind(user.id).all();
  const { results: manual } = await db.prepare(
    'SELECT ticker, price, updated_at FROM user_prices WHERE user_id = ?',
  ).bind(user.id).all();
  const manualMap = Object.fromEntries(manual.map((m) => [m.ticker, m]));

  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.ticker)) {
      groups.set(r.ticker, { ticker: r.ticker, name: r.name, currency: r.currency, quantity: 0, cost: 0, fees: 0, count: 0, firstDate: r.purchase_date });
    }
    const g = groups.get(r.ticker);
    g.quantity += r.quantity;
    g.cost += r.quantity * r.price;
    g.fees += r.fees;
    g.count += 1;
    if (r.name) g.name = r.name;
  }

  const market = await getPrices(db, [...groups.keys()].filter((t) => !manualMap[t]), { force });

  const totals = {};
  const positions = [...groups.values()].map((g) => {
    const m = manualMap[g.ticker];
    const q = market[g.ticker] || {};
    const price = m ? m.price : q.price;
    const invested = g.cost + g.fees;
    const value = price != null ? g.quantity * price : null;
    const gain = value != null ? value - invested : null;
    const t = (totals[g.currency] ||= { currency: g.currency, invested: 0, value: 0, pricedInvested: 0, complete: true });
    t.invested += invested;
    if (value != null) {
      t.value += value;
      t.pricedInvested += invested;
    } else {
      t.complete = false;
    }
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
      price: price ?? null,
      priceSource: m ? 'manual' : (q.price != null ? 'market' : null),
      priceCurrency: m ? g.currency : (q.currency || null),
      priceUpdatedAt: m ? m.updated_at : (q.updatedAt || null),
      priceError: q.error || null,
      value,
      gain,
      gainPct: gain != null && invested > 0 ? gain / invested : null,
    };
  });
  positions.sort((a, b) => (b.value ?? b.invested) - (a.value ?? a.invested));

  return {
    positions,
    // Winst enkel berekenen over posities waarvoor een koers gekend is.
    totals: Object.values(totals).map(({ pricedInvested, ...t }) => {
      const gain = pricedInvested > 0 ? t.value - pricedInvested : null;
      return {
        ...t,
        value: pricedInvested > 0 ? t.value : null,
        gain,
        gainPct: gain != null ? gain / pricedInvested : null,
      };
    }),
  };
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

  if (a === 'portfolio' && method === 'GET') {
    return json(await buildPortfolio(db, user, url.searchParams.get('refresh') === '1'));
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
        `INSERT INTO purchases (user_id, ticker, name, purchase_date, quantity, price, fees, currency, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      ).bind(user.id, p.ticker, p.name, p.date, p.quantity, p.price, p.fees, p.currency, p.note).first();
      return json({ purchase: purchaseOut(row) }, 201);
    }
    const id = Number(b);
    if (!Number.isInteger(id)) throw new HttpError(404, 'Niet gevonden');
    if (method === 'PUT') {
      const p = parsePurchase(await readJson(request));
      const row = await db.prepare(
        `UPDATE purchases SET ticker = ?, name = ?, purchase_date = ?, quantity = ?, price = ?, fees = ?, currency = ?, note = ?
         WHERE id = ? AND user_id = ? RETURNING *`,
      ).bind(p.ticker, p.name, p.date, p.quantity, p.price, p.fees, p.currency, p.note, id, user.id).first();
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

