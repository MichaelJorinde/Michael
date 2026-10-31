// Brandstofprijzen van één Maes-tankstation, gelezen van de publieke stationspagina.
const STATION = { name: 'Maes Buggenhout', address: 'Beukenstraat 125', url: 'https://www.maesmobility.be/nl/tankstation/buggenhout-maes/' };
const FUELS = [
  { key: 'euro95', label: 'Euro 95', re: /\b(euro\s*95|super\s*95|95\s*e10|e10)\b/i },
  { key: 'diesel', label: 'Diesel', re: /\b(diesel(?!\s*\+)|b7)\b/i },
];

// Pagina → platte tekst, en per brandstof de eerste prijs (1,000–3,999 €/l) vlak na het label.
export function parseFuel(html) {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&euro;|&#8364;/g, '€')
    .replace(/\s+/g, ' ');
  const out = {};
  for (const f of FUELS) {
    const m = f.re.exec(text);
    if (!m) continue;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 80);
    const p = /(?:€\s*)?\b([1-3])[,.](\d{2,3})\b/.exec(after);
    if (p) out[f.key] = Number(`${p[1]}.${p[2]}`);
  }
  return out;
}

export async function fuelPrices() {
  try {
    // Cloudflare bewaart de pagina 3 uur in de cache: Maes wordt hooguit een paar keer per dag bevraagd.
    const res = await fetch(STATION.url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; etf-tracker)', accept: 'text/html' },
      cf: { cacheTtl: 3 * 3600, cacheEverything: true },
    });
    if (!res.ok) throw new Error(`Maes antwoordde met ${res.status}`);
    const prices = parseFuel(await res.text());
    return { station: STATION, prices, fuels: FUELS.map(({ key, label }) => ({ key, label })), error: Object.keys(prices).length ? null : 'Geen prijzen gevonden op de pagina' };
  } catch (err) {
    return { station: STATION, prices: {}, fuels: FUELS.map(({ key, label }) => ({ key, label })), error: err.message };
  }
}
