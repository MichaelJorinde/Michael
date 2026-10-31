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
  const vsMa50 = last.ma50 ? last.c / last.ma50 - 1 : null;
  // Dip: hoe ver de koers onder het hoogste punt van de voorbije 3 maanden (±63 beursdagen) zit.
  const top3m = Math.max(...closes.slice(-63).map((pt) => pt.c));
  const dip = last.c / top3m - 1;
  // Langdurig dalende trend: ver onder het 200-daags gemiddelde én 50-daags onder 200-daags.
  const falling = vsMa200 != null && vsMa200 <= -0.15 && last.ma50 != null && last.ma50 < last.ma200;

  // Beweeglijkheid: typische dagschommeling over het voorbije jaar. Een brede ETF schommelt
  // ±1% per dag; een los aandeel zoals NVIDIA vaak 2-3%. De drempels schalen daarmee mee,
  // zodat een gewone week voor een beweeglijk aandeel geen "uitstekend" geeft.
  const rets = year.slice(1).map((pt, i) => pt.c / year[i].c - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const vol = rets.length > 20 ? Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length) : 0.01;
  const scale = Math.min(3, Math.max(1, vol / 0.01));

  // Vier niveaus, van uitstekend (blauw) tot relatief hoog (rood).
  let level;
  if (dip <= -0.10 * scale || fromHigh <= -0.20 * scale) level = 'excellent';
  else if (dip <= -0.05 * scale) level = 'good';
  else if (dip >= -0.01 && vsMa50 != null && vsMa50 >= 0.03 * scale) level = 'high';
  else level = 'fair';
  return { closes, last, year, hi, lo, fromHigh, rangePos, vsMa200, vsMa50, top3m, dip, falling, vol, scale, level };
}
