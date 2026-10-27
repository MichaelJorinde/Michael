// € Privé: pincode instellen, ontgrendelen en vergrendelen.
// Ontgrendeling geldt per sessie (toestel) en vervalt na UNLOCK_MS zonder activiteit.
import { HttpError, json, readJson } from './http.js';
import { hashPassword, verifyPassword, sessionHash, assertNotThrottled, recordFailure, clearFailures } from './auth.js';

const UNLOCK_MS = 10 * 60 * 1000;

function validatePin(pin) {
  if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) throw new HttpError(400, 'De pincode moet uit 4 tot 8 cijfers bestaan');
}

async function state(db, user, request) {
  const hash = await sessionHash(request);
  const row = await db.prepare(
    `SELECT u.private_pin_hash AS pin, s.private_until AS until FROM users u
     JOIN sessions s ON s.user_id = u.id WHERE u.id = ? AND s.token_hash = ?`,
  ).bind(user.id, hash).first();
  return { hash, pinHash: row?.pin || null, unlocked: Boolean(row?.pin) && (row?.until || 0) > Date.now() };
}

async function setUnlocked(db, hash, until) {
  await db.prepare('UPDATE sessions SET private_until = ? WHERE token_hash = ?').bind(until, hash).run();
}

// Gebruik dit in elke route die privégegevens teruggeeft; verlengt de ontgrendeling.
export async function requirePrivate(db, user, request) {
  const s = await state(db, user, request);
  if (!s.unlocked) throw new HttpError(423, 'Vergrendeld');
  await setUnlocked(db, s.hash, Date.now() + UNLOCK_MS);
}

export async function privateRoute(method, action, request, db, user) {
  const throttleKey = `pin:${user.id}`;

  if (action === 'status' && method === 'GET') {
    const s = await state(db, user, request);
    return json({ hasPin: Boolean(s.pinHash), unlocked: s.unlocked });
  }

  if (action === 'pin' && method === 'POST') {
    const body = await readJson(request);
    const s = await state(db, user, request);
    if (s.pinHash) {
      await assertNotThrottled(db, throttleKey);
      if (typeof body.current !== 'string' || !(await verifyPassword(body.current, s.pinHash))) {
        await recordFailure(db, throttleKey);
        throw new HttpError(400, 'Huidige pincode is onjuist');
      }
    }
    validatePin(body.pin);
    await db.batch([
      db.prepare('UPDATE users SET private_pin_hash = ? WHERE id = ?').bind(await hashPassword(body.pin), user.id),
      // Andere toestellen opnieuw laten ontgrendelen met de nieuwe pincode.
      db.prepare('UPDATE sessions SET private_until = 0 WHERE user_id = ? AND token_hash != ?').bind(user.id, s.hash),
      db.prepare('UPDATE sessions SET private_until = ? WHERE token_hash = ?').bind(Date.now() + UNLOCK_MS, s.hash),
    ]);
    await clearFailures(db, throttleKey);
    return json({ ok: true });
  }

  if (action === 'unlock' && method === 'POST') {
    const body = await readJson(request);
    const s = await state(db, user, request);
    if (!s.pinHash) throw new HttpError(400, 'Stel eerst een pincode in');
    await assertNotThrottled(db, throttleKey);
    if (typeof body.pin !== 'string' || !(await verifyPassword(body.pin, s.pinHash))) {
      await recordFailure(db, throttleKey);
      throw new HttpError(403, 'Onjuiste pincode'); // geen 401: dat betekent 'afgemeld' in de app
    }
    await clearFailures(db, throttleKey);
    await setUnlocked(db, s.hash, Date.now() + UNLOCK_MS);
    return json({ ok: true });
  }

  if (action === 'lock' && method === 'POST') {
    const hash = await sessionHash(request);
    await setUnlocked(db, hash, 0);
    return json({ ok: true });
  }

  throw new HttpError(404, 'Niet gevonden');
}
