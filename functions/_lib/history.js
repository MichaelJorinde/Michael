// Historische dagkoersen via Yahoo Finance, gecachet in D1.
const CACHE_MS = 6 * 60 * 60 * 1000;
const HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; etf-tracker)', accept: 'application/json' };
const ROWS_PER_INSERT = 30; // D1 staat max. 100 parameters per statement toe

async function fetchHistory(ticker, fromDate) {
  const period1 = Math.floor(Date.parse(fromDate) / 1000) - 10 * 86400;
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Koersbron antwoordde met ${res.status}`);
  const result = (await res.json())?.chart?.result?.[0];
  const stamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const offset = result?.meta?.gmtoffset || 0;
  const scale = ['GBp', 'GBX'].includes(result?.meta?.currency) ? 0.01 : 1;
  const rows = [];
  stamps.forEach((ts, i) => {
    if (typeof closes[i] === 'number') {
      rows.push([new Date((ts + offset) * 1000).toISOString().slice(0, 10), closes[i] * scale]);
    }
  });
  return rows;
}

async function store(db, ticker, fromDate, rows) {
  const stmts = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
    const chunk = rows.slice(i, i + ROWS_PER_INSERT);
    stmts.push(db.prepare(
      `INSERT INTO price_history (ticker, date, close) VALUES ${chunk.map(() => '(?, ?, ?)').join(', ')}
       ON CONFLICT(ticker, date) DO UPDATE SET close = excluded.close`,
    ).bind(...chunk.flatMap(([d, c]) => [ticker, d, c])));
  }
  stmts.push(db.prepare(
    `INSERT INTO history_meta (ticker, from_date, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(ticker) DO UPDATE SET from_date = MIN(history_meta.from_date, excluded.from_date), fetched_at = excluded.fetched_at`,
  ).bind(ticker, fromDate, Date.now()));
  await db.batch(stmts);
}

// fromDates: { [ticker]: 'YYYY-MM-DD' } → { [ticker]: [[date, close], ...] } (oplopend)
export async function getHistories(db, fromDates) {
  const tickers = Object.keys(fromDates);
  const entries = await Promise.all(tickers.map(async (ticker) => {
    const from = fromDates[ticker];
    const meta = await db.prepare('SELECT from_date, fetched_at FROM history_meta WHERE ticker = ?').bind(ticker).first();
    if (!meta || meta.from_date > from || Date.now() - meta.fetched_at > CACHE_MS) {
      try {
        await store(db, ticker, from, await fetchHistory(ticker, from));
      } catch (err) {
        console.error(`Historiek ${ticker}:`, err.message);
      }
    }
    const { results } = await db.prepare(
      'SELECT date, close FROM price_history WHERE ticker = ? AND date >= ? ORDER BY date',
    ).bind(ticker, from).all();
    return [ticker, results.map((r) => [r.date, r.close])];
  }));
  return Object.fromEntries(entries);
}
