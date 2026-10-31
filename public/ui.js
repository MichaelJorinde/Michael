// Gedeelde bouwstenen voor een rustige, consistente opmaak.

// Paginakop: titel links, acties rechts, optioneel een korte regel eronder.
export const pageHead = (title, actions = '', sub = '') => `
  <header class="page-head">
    <div class="grow"><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
    ${actions ? `<div class="row">${actions}</div>` : ''}
  </header>`;

// Uitleg verstopt achter een klein ⓘ-knopje; html is al ge-escaped.
export const info = (html, label = 'Uitleg') => `<details class="info"><summary>${label}</summary><div>${html}</div></details>`;

// ETF of aandeel: eerst wat de koersbron meldt, anders afgeleid uit de naam.
export function kindOf(kind, name = '') {
  if (kind === 'ETF' || kind === 'MUTUALFUND') return 'etf';
  if (kind === 'EQUITY') return 'stock';
  if (/\b(ETF|UCITS|ETC)\b|ishares|vanguard|spdr|xtrackers|amundi|lyxor|invesco/i.test(name || '')) return 'etf';
  return null;
}
export const kindBadge = (k) => (k === 'etf' ? '<span class="kind kind-etf">🧺 ETF</span>'
  : k === 'stock' ? '<span class="kind kind-stock">🏢 Aandeel</span>' : '');
export const KIND_TEXT = {
  etf: 'Een <b>ETF</b> is een mandje met heel veel bedrijven tegelijk. Gaat één bedrijf slecht, dan merk je dat amper: de koers beweegt rustiger. Ideaal om lang te houden en elke maand een vast bedrag in te leggen.',
  stock: 'Een <b>aandeel</b> is een stukje van één enkel bedrijf. Het kan veel harder stijgen, maar ook veel harder dalen. Draait dat ene bedrijf slecht, dan verlies je veel. Houd het beperkt, bv. hooguit 5 à 10% van wat je belegt.',
};
export const kindLegend = () => `<div class="kind-legend"><span>${kindBadge('etf')} mandje met veel bedrijven · rustiger</span><span>${kindBadge('stock')} één bedrijf · meer risico</span></div>`;
