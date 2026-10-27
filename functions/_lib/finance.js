// € Privé: categorieën voor bankverrichtingen.
import { HttpError, json, readJson } from './http.js';
import { requirePrivate } from './private.js';

export const CATEGORIES = [
  'Wonen', 'Energie & water', 'Verzekeringen', 'Telecom & abonnementen', 'Boodschappen', 'Vervoer',
  'Kinderen & school', 'Gezondheid', 'Belastingen', 'Sparen & beleggen', 'Vrije tijd & shopping', 'Horeca',
  'Cash', 'Persoonlijke verzorging', 'Kredietkaart', 'Gezinsrekening', 'Spaarpotjes', 'Interne overschrijving', 'Overige', 'Inkomsten',
];

// Geen echte uitgave of inkomst: geld dat naar (of van) je eigen rekeningen en potjes gaat.
export const NON_SPEND = ['Sparen & beleggen', 'Spaarpotjes', 'Interne overschrijving'];

// Trefwoorden (kleine letters) per categorie, afgestemd op Belgische tegenpartijen.
const KEYWORDS = [
  ['Energie & water', ['totalenergies', 'total energies', 'engie', 'luminus', 'eneco', 'mega ', 'bolt energie', 'octa+', 'fluvius', 'farys', 'watergroep', 'pidpa', 'water-link', 'aquafin', 'elicio', 'dats 24 energie']],
  ['Verzekeringen', ['verzekering', 'assurance', 'ethias', 'ag insurance', 'axa', 'baloise', 'p&v', 'dvv', 'allianz', 'vivium', 'federale', 'kbc verzeker', 'belfius insurance', 'dela', 'yuzzu', 'corona direct']],
  ['Telecom & abonnementen', ['proximus', 'telenet', 'orange', 'base ', 'mobile vikings', 'scarlet', 'voo', 'netflix', 'spotify', 'disney', 'apple.com', 'itunes', 'google', 'youtube', 'hbo', 'streamz', 'prime video', 'amazon prime', 'icloud', 'microsoft', 'adobe', 'chatgpt', 'openai', 'anthropic', 'claude', 'dropbox', 'canal', 'dpg media', 'mediahuis', 'het nieuwsblad', 'de standaard']],
  ['Wonen', ['hypothe', 'woonkrediet', 'lening', 'krediet', 'huur', 'syndic', 'onroerende voorheffing', 'kadast', 'ivago', 'recupel', 'afvalintercommunale', 'ilva', 'iverlek', 'mirom', 'verko']],
  ['Boodschappen', ['co&go', 'collect&go', 'collect & go', 'colruyt', 'delhaize', 'aldi', 'lidl', 'carrefour', 'albert heijn', 'okay', 'spar', 'intermarch', 'jumbo', 'bioplanet', 'match', 'cora', 'louis delhaize', 'slagerij', 'bakkerij', 'bakker', 'beenhouwerij', 'kruidvat', 'hema', 'action', 'trafic', 'zeeman']],
  ['Vervoer', ['maes ', 'q8', 'shell', 'esso', 'lukoil', 'dats 24', 'gabri', 'texaco', 'tankstation', 'nmbs', 'sncb', 'de lijn', 'parking', 'interparking', 'tesla', 'ionity', 'allego', 'car wash', 'carwash', 'garage', "d'ieteren", 'autokeuring', 'aibv', 'touring', 'vab', 'blue bike', 'cambio', 'kilometerheffing', 'viapass']],
  ['Kinderen & school', ['school', 'kinderopvang', 'crèche', 'creche', 'opvang', 'scholengroep', 'academie', 'jeugdbeweging', 'chiro', 'scouts', 'ksa', 'speelplein', 'kampen', 'muziekschool']],
  ['Gezondheid', ['apotheek', 'pharma', 'mutualiteit', 'ziekenfonds', 'cm ', 'helan', 'solidaris', 'partena', 'ziekenhuis', 'az ', 'uz ', 'dokter', 'huisarts', 'tandarts', 'kinesist', 'optiek', 'pearle', 'hans anders']],
  ['Belastingen', ['vlabel', 'fod financi', 'belasting', 'vlaamse belastingdienst', 'gemeentebestuur', 'stad ', 'gemeente', 'provincie', 'verkeersbelasting', 'belastingdienst']],
  ['Sparen & beleggen', ['bolero', 'degiro', 'keytrade', 'saxo', 'trade republic', 'spaarrekening', 'pensioensparen', 'beleggingsrekening', 'easy invest', 'birdee', 'curvo', 'ing invest', 'lynx', 'rebel']],
  ['Horeca', ['restaurant', 'cafe', 'café', 'bistro', 'brasserie', 'pizzeria', 'frituur', 'friture', 'mcdonald', 'quick', 'burger king', 'takeaway', 'uber eats', 'deliveroo', 'starbucks', 'panos', 'exki', 'brood', 'sushi']],
  ['Vrije tijd & shopping', ['kinepolis', 'decathlon', 'bol.com', 'zalando', 'amazon', 'ikea', 'mediamarkt', 'coolblue', 'vanden borre', 'fnac', 'standaard boekhandel', 'brico', 'gamma', 'hubo', 'aveve', 'primark', 'c&a', 'h&m', 'zara', 'jbc', 'torfs', 'sport', 'fitness', 'basic-fit', 'zwembad', 'plopsa', 'pairi daiza', 'booking.com', 'airbnb', 'ryanair', 'brussels airlines', 'tui']],
  ['Cash', ['geldopname', 'atm', 'bancontact cash', 'cash withdrawal', 'retrait']],
  ['Kredietkaart', ['mastercard', 'bank card company', 'kredietkaart afrekening', 'visa afrekening']],
  ['Persoonlijke verzorging', ['kapper', 'kapsalon', 'coiffure', 'barber', 'schoonheid', 'nagelstudio']],
];

export const ruleKey = (counterparty) => counterparty.toLowerCase().replace(/\s+/g, ' ').trim();

export function categorize(counterparty, amount, rules) {
  const key = ruleKey(counterparty);
  if (rules[key]) return rules[key];
  const text = ` ${key} `;
  if (amount > 0) return 'Inkomsten'; // loon, groeipakket, terugbetalingen, …
  for (const [cat, words] of KEYWORDS) if (words.some((w) => text.includes(w))) return cat;
  return 'Overige';
}

async function loadRules(db, user) {
  const { results } = await db.prepare('SELECT key, category FROM private_rules WHERE user_id = ?').bind(user.id).all();
  return Object.fromEntries(results.map((r) => [r.key, r.category]));
}

function parseTx(r) {
  const date = String(r.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new HttpError(400, 'Ongeldige datum in import');
  const amount = Number(r.amount);
  if (!Number.isFinite(amount) || Math.abs(amount) > 1e9) throw new HttpError(400, 'Ongeldig bedrag in import');
  const counterparty = String(r.counterparty || '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Onbekend';
  const fingerprint = String(r.fingerprint || '');
  if (!/^[a-f0-9]{16,64}$/.test(fingerprint)) throw new HttpError(400, 'Ongeldige import');
  return { date, amount: Math.round(amount * 100) / 100, counterparty, fingerprint };
}

export async function financeRoute(method, id, request, db, user) {
  await requirePrivate(db, user, request);

  if (!id && method === 'GET') {
    const { results } = await db.prepare(
      'SELECT id, date, amount, counterparty, category FROM private_tx WHERE user_id = ? ORDER BY date DESC, id DESC',
    ).bind(user.id).all();
    return json({ transactions: results, categories: CATEGORIES });
  }

  if (id === 'import' && method === 'POST') {
    const body = await readJson(request);
    const rows = [].concat(body.rows || []);
    if (!rows.length || rows.length > 500) throw new HttpError(400, 'Stuur 1 tot 500 verrichtingen per keer');
    const parsed = rows.map(parseTx);
    const rules = await loadRules(db, user);
    const stmts = [];
    for (let i = 0; i < parsed.length; i += 14) { // max. 100 parameters per statement
      const chunk = parsed.slice(i, i + 14);
      stmts.push(db.prepare(
        `INSERT INTO private_tx (user_id, date, amount, counterparty, category, fingerprint) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}
         ON CONFLICT(user_id, fingerprint) DO NOTHING`,
      ).bind(...chunk.flatMap((t) => [user.id, t.date, t.amount, t.counterparty, categorize(t.counterparty, t.amount, rules), t.fingerprint])));
    }
    const results = await db.batch(stmts);
    const added = results.reduce((n, r) => n + (r.meta?.changes || 0), 0);
    return json({ added, skipped: parsed.length - added });
  }

  if (id === 'all' && method === 'DELETE') {
    await db.batch([
      db.prepare('DELETE FROM private_tx WHERE user_id = ?').bind(user.id),
      db.prepare('DELETE FROM private_rules WHERE user_id = ?').bind(user.id),
    ]);
    return json({ ok: true });
  }

  const txId = Number(id);
  if (Number.isInteger(txId) && method === 'PUT') {
    const body = await readJson(request);
    if (!CATEGORIES.includes(body.category)) throw new HttpError(400, 'Onbekende categorie');
    const tx = await db.prepare('SELECT counterparty FROM private_tx WHERE id = ? AND user_id = ?').bind(txId, user.id).first();
    if (!tx) throw new HttpError(404, 'Verrichting niet gevonden');
    if (body.remember) {
      // Onthouden voor deze tegenpartij en alle bestaande verrichtingen ervan aanpassen.
      const key = ruleKey(tx.counterparty);
      await db.batch([
        db.prepare(`INSERT INTO private_rules (user_id, key, category) VALUES (?, ?, ?)
          ON CONFLICT(user_id, key) DO UPDATE SET category = excluded.category`).bind(user.id, key, body.category),
        db.prepare('UPDATE private_tx SET category = ? WHERE user_id = ? AND lower(counterparty) = ?').bind(body.category, user.id, key),
      ]);
    } else {
      await db.prepare('UPDATE private_tx SET category = ? WHERE id = ? AND user_id = ?').bind(body.category, txId, user.id).run();
    }
    return json({ ok: true });
  }

  throw new HttpError(404, 'Niet gevonden');
}
