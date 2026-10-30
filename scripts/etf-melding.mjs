// Dagelijkse pushmelding via ntfy met de koers en het koopmoment van elke ETF.
// Draait in GitHub Actions (zie .github/workflows/etf-melding.yml). De logs van een
// openbare repository zijn openbaar: dit script logt daarom geen tickers of koersen.
import { execFileSync } from 'node:child_process';
import { analyse } from '../public/signals.js';

const SITE = 'https://etf-tracker-7tv.pages.dev';
const TOPIC = process.env.NTFY_TOPIC;
const DRY_RUN = process.env.DRY_RUN === '1';
const LEVEL = {
  excellent: { icon: '🔵', label: 'uitstekend om bij te kopen' },
  good: { icon: '🟢', label: 'goed moment om bij te kopen' },
  fair: { icon: '🟠', label: 'redelijk goed' },
  high: { icon: '🔴', label: 'relatief hoog' },
};
const HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; etf-tracker)', accept: 'application/json' };

// ETF's van het eerste account, rechtstreeks uit D1 (uitvoer niet naar de log).
function positions() {
  const sql = `SELECT ticker, MAX(name) AS name, SUM(quantity) AS qty, SUM(quantity * price + fees) / SUM(quantity) AS avg
    FROM purchases WHERE user_id = ${Number(process.env.USER_ID) || '(SELECT MIN(id) FROM users)'} GROUP BY ticker`;
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'etf-tracker', process.env.D1_LOCAL ? '--local' : '--remote', '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out)[0].results.filter((r) => r.qty > 0);
}

async function quote(ticker) {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - 420 * 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`koersbron ${res.status}`);
  const r = (await res.json())?.chart?.result?.[0];
  const scale = ['GBp', 'GBX'].includes(r?.meta?.currency) ? 0.01 : 1;
  const offset = r?.meta?.gmtoffset || 0;
  const closes = [];
  (r?.timestamp || []).forEach((ts, i) => {
    const c = r.indicators?.quote?.[0]?.close?.[i];
    if (typeof c === 'number') closes.push([new Date((ts + offset) * 1000).toISOString().slice(0, 10), c * scale]);
  });
  const price = typeof r?.meta?.regularMarketPrice === 'number' ? r.meta.regularMarketPrice * scale : null;
  return { closes, price, currency: scale === 1 ? r?.meta?.currency || 'EUR' : 'GBP' };
}

const money = (v, cur) => new Intl.NumberFormat('nl-BE', { style: 'currency', currency: cur }).format(v);
const pct = (v) => `${v >= 0 ? '+' : '−'}${new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 1 }).format(Math.abs(v) * 100)}%`;

async function main() {
  if (!TOPIC && !DRY_RUN) throw new Error('NTFY_TOPIC ontbreekt (GitHub-secret)');
  const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' });
  const rows = await Promise.all(positions().map(async (p) => {
    try {
      const q = await quote(p.ticker);
      const a = analyse(q.closes, q.price, todayStr);
      // Dagverandering t.o.v. de vorige slotkoers.
      const prev = a && a.closes.length > 1 ? a.closes[a.closes.length - 2].c : null;
      return a && { ...p, ...q, a, change: prev ? a.last.c / prev - 1 : null };
    } catch {
      return { ...p, failed: true };
    }
  }));
  const ok = rows.filter((r) => r && !r.failed);
  if (!ok.length) throw new Error('geen koersen opgehaald');

  const order = ['excellent', 'good', 'fair', 'high'];
  ok.sort((x, y) => order.indexOf(x.a.level) - order.indexOf(y.a.level));
  const buy = ok.filter((r) => r.a.level === 'excellent' || r.a.level === 'good');
  // Dip zet zich verder: al minstens 3% onder de 3-maandtop én vandaag opnieuw lager.
  const deeper = ok.filter((r) => r.a.dip <= -0.03 && r.change != null && r.change < 0);
  const label = (r) => r.ticker.replace(/\..*$/, '');
  const lines = ok.map((r) => {
    const l = LEVEL[r.a.level];
    const today = r.change == null ? '' : ` · vandaag ${pct(r.change)}`;
    return `${l.icon} ${label(r)} ${money(r.a.last.c, r.currency)}${today} · ${l.label}\n   ${r.a.dip > -0.005 ? 'op de 3-maandtop' : `${pct(r.a.dip)} t.o.v. 3-maandtop`} · ${pct(r.a.last.c / r.avg - 1)} t.o.v. jouw aankoop`;
  });
  const failed = rows.filter((r) => r?.failed).map(label);
  if (failed.length) lines.push(`⚠️ Geen koers voor ${failed.join(', ')}`);

  const date = new Date().toLocaleDateString('nl-BE', { timeZone: 'Europe/Brussels', weekday: 'short', day: 'numeric', month: 'short' });
  const msg = {
    topic: TOPIC,
    title: deeper.length
      ? `Dip zet verder: ${deeper.map((r) => `${label(r)} ${pct(r.change)}`).join(', ')}${buy.length ? ' · koopmoment' : ''}`
      : buy.length ? `Koopmoment: ${buy.map(label).join(', ')}` : `ETF's ${date}: geen koopmoment`,
    message: lines.join('\n'),
    priority: buy.length || deeper.length ? 4 : 2,
    tags: [buy.length || deeper.length ? 'chart_with_downwards_trend' : 'bar_chart'],
    click: SITE,
  };
  if (DRY_RUN) { console.log(JSON.stringify({ ...msg, topic: '(verborgen)' }, null, 2)); return; }
  const res = await fetch('https://ntfy.sh/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(msg) });
  if (!res.ok) throw new Error(`ntfy antwoordde met ${res.status}`);
  console.log(`Melding verstuurd (${ok.length} ETF's, ${buy.length} koopmoment, ${deeper.length} verdere dip).`);
}

main().catch((err) => { console.error(`Mislukt: ${err.message}`); process.exit(1); });
