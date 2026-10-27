import { HttpError } from './http.js';

// Cloudflare Workers ondersteunt maximaal 100.000 PBKDF2-iteraties.
const ITERATIONS = 100000;
const COOKIE = 'etf_session';
const SESSION_DAYS = 30;
const MAX_FAILURES = 8;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [alg, iterations, salt, hash] = stored.split('$');
  if (alg !== 'pbkdf2') return false;
  const actual = await pbkdf2(password, fromHex(salt), Number(iterations));
  return timingSafeEqual(actual, fromHex(hash));
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'Wachtwoord moet minstens 8 tekens lang zijn');
  }
  if (password.length > 200) throw new HttpError(400, 'Wachtwoord is te lang');
}

export function sessionCookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function createSession(db, userId) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = Date.now() + SESSION_DAYS * 86400 * 1000;
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()),
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256Hex(token), userId, expiresAt),
  ]);
  return sessionCookie(token, SESSION_DAYS * 86400);
}

function readToken(request) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return match ? match[1] : null;
}

export async function getUser(request, db) {
  const token = readToken(request);
  if (!token) return null;
  return db.prepare(
    `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(await sha256Hex(token), Date.now()).first();
}

export async function destroySession(request, db) {
  const token = readToken(request);
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return sessionCookie('', 0);
}

export async function assertNotThrottled(db, email) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM login_failures WHERE email = ? AND at > ?')
    .bind(email, Date.now() - FAILURE_WINDOW_MS).first();
  if (row.n >= MAX_FAILURES) {
    throw new HttpError(429, 'Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw.');
  }
}

export async function recordFailure(db, email) {
  await db.batch([
    db.prepare('DELETE FROM login_failures WHERE at < ?').bind(Date.now() - FAILURE_WINDOW_MS),
    db.prepare('INSERT INTO login_failures (email, at) VALUES (?, ?)').bind(email, Date.now()),
  ]);
}

export async function clearFailures(db, email) {
  await db.prepare('DELETE FROM login_failures WHERE email = ?').bind(email).run();
}
