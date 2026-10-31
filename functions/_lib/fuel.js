// Brandstofprijzen van één Maes-tankstation, gelezen van de publieke stationspagina.
const STATION = { name: 'Maes Buggenhout', address: 'Beukenstraat 125', url: 'https://www.maesmobility.be/nl/tankstation/buggenhout-maes/' };
const FUELS = [
  { key: 'euro95', label: 'Euro 95', re: /\b(euro\s*95|super\s*95|95\s*\(?e10\)?|e10)\b/gi },
  { key: 'diesel', label: 'Diesel', re: /\b(diesel|b7|gasolie|gasoil)\b/gi },
];
// Labels van andere producten: daar stopt het zoekvenster, zodat we nooit hun prijs nemen.
const OTHER = /\b(super\s*98|euro\s*98|e5|lpg|cng|adblue|hvo|xtl)\b/i;
const PRICE = /\b([1-3])[,.](\d{2,3})\b/;

// Pagina → platte tekst, en per brandstof de eerste vermelding waar binnen 120 tekens een prijs
// (1,000–3,999 €/l) volgt, vóór het label van een ander product. Zo telt bv. "Diesel" in het menu niet mee.
function pageText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&euro;|&#8364;/g, '€')
    .replace(/\s+/g, ' ');
}

export function parseFuel(html) {
  const text = pageText(html);
  const out = {};
  for (const f of FUELS) {
    const others = FUELS.filter((o) => o !== f).map((o) => new RegExp(o.re.source, 'i'));
    for (const m of text.matchAll(f.re)) {
      let win = text.slice(m.index + m[0].length, m.index + m[0].length + 120);
      const stops = [OTHER, ...others].map((r) => win.search(r)).filter((i) => i > 0);
      if (stops.length) win = win.slice(0, Math.min(...stops));
      const p = PRICE.exec(win);
      if (p) { out[f.key] = Number(`${p[1]}.${p[2]}`); break; }
    }
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
    const html = await res.text();
    const prices = parseFuel(html);
    // Hulp bij het afstellen: als een brandstof ontbreekt, de tekst rond het label meesturen.
    const text = pageText(html);
    const debug = FUELS.filter((f) => prices[f.key] == null).map((f) => ({
      label: f.label,
      snippets: [...text.matchAll(f.re)].slice(0, 4).map((m) => text.slice(Math.max(0, m.index - 30), m.index + 110)),
    }));
    return { station: STATION, prices, debug, fuels: FUELS.map(({ key, label }) => ({ key, label })), error: FUELS.every((f) => prices[f.key] != null) ? null : `Niet gevonden: ${FUELS.filter((f) => prices[f.key] == null).map((f) => f.label).join(', ')}` };
  } catch (err) {
    return { station: STATION, prices: {}, fuels: FUELS.map(({ key, label }) => ({ key, label })), error: err.message };
  }
}
