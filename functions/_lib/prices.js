// Koersen via de (sleutelloze) Yahoo Finance API, gecachet in D1.
const CACHE_MS = 15 * 60 * 1000;
const MIN_REFRESH_MS = 60 * 1000;
const HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; etf-tracker)', accept: 'application/json' };

export async function fetchQuote(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Koersbron antwoordde met ${res.status}`);
  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== 'number') throw new Error('Geen koers gevonden');
  let price = meta.regularMarketPrice;
  let currency = meta.currency || null;
  // Londense noteringen staan in pence.
  if (currency === 'GBp' || currency === 'GBX') {
    price /= 100;
    currency = 'GBP';
  }
  return { price, currency, name: meta.longName || meta.shortName || null, kind: meta.instrumentType || null };
}

async function refresh(db, ticker) {
  const quote = await fetchQuote(ticker);
  const now = Date.now();
  await db.prepare(
    `INSERT INTO prices (ticker, price, currency, name, kind, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(ticker) DO UPDATE SET price = excluded.price, currency = excluded.currency,
       name = COALESCE(excluded.name, prices.name), kind = COALESCE(excluded.kind, prices.kind), updated_at = excluded.updated_at`,
  ).bind(ticker, quote.price, quote.currency, quote.name, quote.kind, now).run();
  return { ticker, ...quote, updatedAt: now };
}

// Geeft { [ticker]: { price, currency, name, updatedAt, error? } } terug.
export async function getPrices(db, tickers, { force = false } = {}) {
  if (!tickers.length) return {};
  const placeholders = tickers.map(() => '?').join(',');
  const { results } = await db.prepare(`SELECT * FROM prices WHERE ticker IN (${placeholders})`).bind(...tickers).all();
  const cached = Object.fromEntries(results.map((r) => [r.ticker, r]));
  const now = Date.now();

  const entries = await Promise.all(tickers.map(async (ticker) => {
    const row = cached[ticker];
    const age = row ? now - row.updated_at : Infinity;
    if (row && (age < CACHE_MS && !(force && age > MIN_REFRESH_MS))) {
      return [ticker, { price: row.price, currency: row.currency, name: row.name, kind: row.kind, updatedAt: row.updated_at }];
    }
    try {
      return [ticker, await refresh(db, ticker)];
    } catch (err) {
      if (row) {
        return [ticker, { price: row.price, currency: row.currency, name: row.name, kind: row.kind, updatedAt: row.updated_at, error: err.message }];
      }
      return [ticker, { price: null, error: err.message }];
    }
  }));
  return Object.fromEntries(entries);
}

export async function searchTickers(query) {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&listsCount=0`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Zoeken mislukt (${res.status})`);
  const data = await res.json();
  return (data.quotes || [])
    .filter((q) => q.symbol && ['ETF', 'EQUITY', 'MUTUALFUND', 'INDEX', 'CRYPTOCURRENCY'].includes(q.quoteType))
    .map((q) => ({
      symbol: q.symbol,
      name: q.longname || q.shortname || q.symbol,
      exchange: q.exchDisp || q.exchange || '',
      type: q.quoteType,
    }));
}
