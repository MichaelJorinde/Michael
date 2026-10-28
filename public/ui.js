// Gedeelde bouwstenen voor een rustige, consistente opmaak.

// Paginakop: titel links, acties rechts, optioneel een korte regel eronder.
export const pageHead = (title, actions = '', sub = '') => `
  <header class="page-head">
    <div class="grow"><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
    ${actions ? `<div class="row">${actions}</div>` : ''}
  </header>`;

// Uitleg verstopt achter een klein ⓘ-knopje; html is al ge-escaped.
export const info = (html, label = 'Uitleg') => `<details class="info"><summary>${label}</summary><div>${html}</div></details>`;
