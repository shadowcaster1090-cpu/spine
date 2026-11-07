import crypto from 'node:crypto';
import { HttpError } from './errors.js';

const SESSION_DAYS = 30;
export const COOKIE = 'spine_session';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, s, k] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = crypto.scryptSync(pw, Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(k, 'base64');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)').run(token, userId, expires);
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  return { token, expires };
}

export function sessionCookie(token, expires, secure) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Expires=${new Date(expires).toUTCString()}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function readCookie(req, name) {
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

export function sessionToken(req) { return readCookie(req, COOKIE); }

export function sessionUser(db, req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.username, u.email, u.role, u.bio, u.public_collection, u.created_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?`).get(token, Date.now());
  return row ? { ...row } : null;
}

export function requireUser(user) {
  if (!user) throw new HttpError(401, 'Sign in to do that.');
  return user;
}

export function isMod(user) { return !!user && (user.role === 'mod' || user.role === 'admin'); }

export function requireMod(user) {
  requireUser(user);
  if (!isMod(user)) throw new HttpError(403, 'Only moderators can do that.');
  return user;
}
