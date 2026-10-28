// € Privé: potjes.
import { HttpError, json, readJson } from './http.js';
import { requirePrivate } from './private.js';

// 'Maandelijkse kosten' zijn geen potjes maar rechtstreekse vaste lasten; ze tellen apart.
export const POT_GROUPS = ['Vaste kosten', 'Sparen & doelen', 'Kinderen', 'Beleggen', 'Maandelijkse kosten'];

function parsePot(b) {
  const name = String(b.name || '').trim().slice(0, 40);
  if (!name) throw new HttpError(400, 'Geef het potje een naam');
  const monthly = Number(b.monthly);
  if (!Number.isFinite(monthly) || monthly < 0 || monthly > 1e6) throw new HttpError(400, `Ongeldig maandbedrag voor ${name}`);
  const grp = POT_GROUPS.includes(b.grp) ? b.grp : 'Vaste kosten';
  const yearly = b.yearly_cost === '' || b.yearly_cost == null ? null : Number(b.yearly_cost);
  if (yearly != null && (!Number.isFinite(yearly) || yearly < 0)) throw new HttpError(400, `Ongeldige jaarkost voor ${name}`);
  const purpose = b.purpose ? String(b.purpose).trim().slice(0, 80) : null;
  const share = b.share == null || b.share === '' ? 1 : Number(b.share);
  if (!Number.isFinite(share) || share < 0.05 || share > 1) throw new HttpError(400, `Ongeldig aandeel voor ${name}`);
  return { name, monthly: Math.round(monthly * 100) / 100, grp, yearly_cost: yearly, purpose, share };
}

const out = ({ user_id, ...p }) => p;

export async function potsRoute(method, id, request, db, user) {
  await requirePrivate(db, user, request);

  if (!id && method === 'GET') {
    const { results } = await db.prepare('SELECT * FROM private_pots WHERE user_id = ? ORDER BY grp, sort, monthly DESC').bind(user.id).all();
    return json({ pots: results.map(out), groups: POT_GROUPS });
  }
  if (!id && method === 'POST') {
    const p = parsePot(await readJson(request));
    const row = await db.prepare(
      'INSERT INTO private_pots (user_id, name, monthly, grp, yearly_cost, purpose, share) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
    ).bind(user.id, p.name, p.monthly, p.grp, p.yearly_cost, p.purpose, p.share).first();
    return json({ pot: out(row) }, 201);
  }
  if (id === 'import' && method === 'POST') {
    const rows = [].concat((await readJson(request)).rows || []);
    if (!rows.length || rows.length > 100) throw new HttpError(400, 'Stuur 1 tot 100 potjes');
    const pots = rows.map(parsePot);
    await db.batch(pots.map((p, i) => db.prepare(
      'INSERT INTO private_pots (user_id, name, monthly, grp, yearly_cost, purpose, share, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(user.id, p.name, p.monthly, p.grp, p.yearly_cost, p.purpose, p.share, i)));
    return json({ added: pots.length });
  }
  const potId = Number(id);
  if (!Number.isInteger(potId)) throw new HttpError(404, 'Niet gevonden');
  if (method === 'PUT') {
    const p = parsePot(await readJson(request));
    const row = await db.prepare(
      'UPDATE private_pots SET name = ?, monthly = ?, grp = ?, yearly_cost = ?, purpose = ?, share = ? WHERE id = ? AND user_id = ? RETURNING *',
    ).bind(p.name, p.monthly, p.grp, p.yearly_cost, p.purpose, p.share, potId, user.id).first();
    if (!row) throw new HttpError(404, 'Potje niet gevonden');
    return json({ pot: out(row) });
  }
  if (method === 'DELETE') {
    const res = await db.prepare('DELETE FROM private_pots WHERE id = ? AND user_id = ?').bind(potId, user.id).run();
    if (!res.meta.changes) throw new HttpError(404, 'Potje niet gevonden');
    return json({ ok: true });
  }
  throw new HttpError(404, 'Niet gevonden');
}
