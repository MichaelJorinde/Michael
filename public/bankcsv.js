// Bankexport (CSV) lezen in de browser. Enkel datum, bedrag en naam van de tegenpartij
// worden eruit gehaald; al de rest (rekeningnummers, saldo, adressen, mededelingen) blijft op het toestel.

export function decode(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer); // oudere exports (bv. KBC)
  }
}

// CSV met ; , of tab als scheidingsteken en "aanhalingstekens".
export function parseCsv(text) {
  const firstLines = text.split(/\r?\n/).slice(0, 15).join('\n');
  const delim = [';', '\t', ','].map((d) => [d, firstLines.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// Kolommen herkennen op basis van de kolomnamen (NL/FR/EN, verschillende banken).
const PATTERNS = {
  date: [/^(boekings|uitvoerings|verrichtings|transactie)?datum$/, /^datum/, /date/, /^datum verrichting/],
  amount: [/^bedrag/, /^amount/, /^montant/],
  counterparty: [/naam (van de )?tegenpartij/, /^tegenpartij$/, /naam begunstigde/, /^begunstigde$/, /contrepartie/, /counterparty/, /^naam$/, /^nom/, /^name/],
  description: [/omschrijving/, /detail/, /mededeling/, /bericht/, /description/, /communicat/, /^transactie$/, /libelle/],
};
const EXCLUDE = /(rekening|iban|bic|adres|address|saldo|solde|balance|valuta|munt|currency|nummer|number)/;

export function detectColumns(header) {
  const h = header.map(norm);
  const find = (key) => {
    for (const re of PATTERNS[key]) {
      const i = h.findIndex((c, idx) => re.test(c) && !(key !== 'date' && EXCLUDE.test(c)) && !(key === 'date' && /valuta/.test(c)) && !used.has(idx));
      if (i >= 0) { used.add(i); return i; }
    }
    return -1;
  };
  const used = new Set();
  const date = find('date');
  const amount = find('amount');
  const counterparty = find('counterparty');
  // Alle omschrijvingskolommen: de handelaarsnaam staat niet bij elke bank in dezelfde kolom.
  const descriptions = [];
  for (let idx; (idx = find('description')) >= 0;) descriptions.push(idx);
  return { date, amount, counterparty, descriptions };
}

// De kopregel is de eerste regel waarin we een datum- én bedragkolom herkennen.
export function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cols = detectColumns(rows[i]);
    if (cols.date >= 0 && cols.amount >= 0) return { index: i, cols };
  }
  return null;
}

export function parseDate(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

export function parseAmount(s) {
  let t = String(s || '').replace(/[€\s]|EUR/gi, '');
  if (!t) return null;
  const neg = /^-|-$|^\(.*\)$/.test(t);
  t = t.replace(/[()+-]/g, '');
  // 1.234,56 of 1,234.56 of 1234,56
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

// Handelaarsnaam uit een omschrijving halen, zonder kaartnummers, IBAN's, data, uren of referenties.
const NOISE = new Set(['betaling', 'aankoop', 'aankopen', 'bancontact', 'maestro', 'visa', 'mastercard', 'debetkaart', 'kredietkaart', 'kaart', 'kaartnr',
  'domiciliering', 'europese', 'overschrijving', 'instantoverschrijving', 'doorlopende', 'opdracht', 'eur', 'via', 'met', 'op', 'om', 'uur', 'te', 'in',
  'referentie', 'bankreferentie', 'valutadatum', 'mededeling', 'contactloos', 'apple', 'pay', 'google', 'payconiq', 'nr', 'van', 'naar', 'datum', 'debet', 'credit',
  'mandaat', 'schuldeiser', 'id', 'sepa', 'eiseres', 'payment', 'purchase', 'card', 'nummer', 'number', 'numéro', 'avec', 'carte', 'paiement', 'de', 'la', 'le']);
export function merchantFrom(text) {
  const words = String(text || '')
    .replace(/[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}/gi, ' ') // IBAN
    .replace(/\d{4}\s?\d{2}X{2,}\s?X*\s?\d{4}/gi, ' ') // kaartnummer
    .replace(/\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/g, ' ') // datum
    .replace(/\b\d{1,2}[:.h]\d{2}\b/g, ' ') // uur
    .replace(/[^A-Za-zÀ-ÿ0-9&'.+ -]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/\d{3,}/.test(w) && !NOISE.has(w.toLowerCase()) && w.length > 1);
  return words.slice(0, 4).join(' ').slice(0, 40);
}

async function fingerprint(parts) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Rijen omzetten naar { date, amount, counterparty, fingerprint }.
export async function extract(rows, header) {
  const { index, cols } = header;
  const out = [];
  let skipped = 0;
  for (const r of rows.slice(index + 1)) {
    const date = parseDate(r[cols.date]);
    const amount = parseAmount(r[cols.amount]);
    if (!date || amount == null || amount === 0) { skipped++; continue; }
    const name = cols.counterparty >= 0 ? merchantFrom(r[cols.counterparty]) : '';
    const fromDescription = cols.descriptions.map((i) => merchantFrom(r[i])).find(Boolean);
    const counterparty = (name || fromDescription || 'Onbekend').toUpperCase();
    // Vingerafdruk op basis van de volledige regel (blijft op het toestel; enkel de hash wordt verstuurd).
    out.push({ date, amount, counterparty, fingerprint: await fingerprint([date, amount, ...r]) });
  }
  return { transactions: out, skipped };
}
