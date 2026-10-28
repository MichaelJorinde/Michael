// Koopmoment-analyse, gedeeld door de app en de dagelijkse melding (scripts/etf-melding.mjs).
// closes: [[YYYY-MM-DD, koers], ...] oplopend; price: huidige koers (of null); todayStr: YYYY-MM-DD.
export function analyse(closesRaw, price, todayStr) {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const closes = closesRaw.map(([d, c]) => ({ d, c }));
  // Laatste punt = huidige koers.
  if (price != null) {
    if (closes.length && closes[closes.length - 1].d === todayStr) closes[closes.length - 1].c = price;
    else closes.push({ d: todayStr, c: price });
  }
  if (closes.length < 2) return null;

  // Voortschrijdende gemiddelden over 50 en 200 handelsdagen.
  const movingAvg = (n) => {
    let total = 0;
    return closes.map((pt, i) => {
      total += pt.c;
      if (i >= n) total -= closes[i - n].c;
      return i >= n - 1 ? total / n : null;
    });
  };
  const ma50 = movingAvg(50);
  const ma200 = movingAvg(200);
  closes.forEach((pt, i) => { pt.ma50 = ma50[i]; pt.ma200 = ma200[i]; });

  const last = closes[closes.length - 1];
  const year = closes.filter((pt) => pt.d >= day(Date.parse(last.d) - 365 * 86400000));
  const hi = Math.max(...year.map((pt) => pt.c));
  const lo = Math.min(...year.map((pt) => pt.c));
  const fromHigh = last.c / hi - 1;
  const rangePos = hi > lo ? (last.c - lo) / (hi - lo) : 0.5;
  const vsMa200 = last.ma200 ? last.c / last.ma200 - 1 : null;

  // Vier niveaus, van uitstekend (blauw) tot relatief hoog (rood).
  let level;
  if (fromHigh <= -0.15 || (vsMa200 != null && vsMa200 <= -0.05)) level = 'excellent';
  else if (fromHigh <= -0.08 || (vsMa200 != null && vsMa200 <= -0.02)) level = 'good';
  else if (rangePos >= 0.85 && (vsMa200 == null || vsMa200 > 0.03)) level = 'high';
  else level = 'fair';
  return { closes, last, year, hi, lo, fromHigh, rangePos, vsMa200, level };
}
