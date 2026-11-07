import { hashPassword, verifyPassword, createSession, sessionCookie, sessionToken, requireUser } from '../auth.js';

const USERNAME = /^[a-zA-Z0-9_.-]{3,24}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function (r, { db, fail, rateLimit, secureCookies }) {
  const publicUser = (u) => ({ id: u.id, username: u.username, email: u.email, role: u.role, bio: u.bio, public_collection: !!u.public_collection, created_at: u.created_at });

  r.post('/api/auth/signup', ({ body, res, ip }) => {
    rateLimit(ip, 'signup', 10, 60 * 60e3);
    const username = String(body.username || '').trim();
    const email = String(body.email || '').trim();
    const password = String(body.password || '');
    if (!USERNAME.test(username)) fail(400, 'Usernames are 3 to 24 letters, numbers, dots, dashes or underscores.');
    if (!EMAIL.test(email)) fail(400, 'Enter a valid email address.');
    if (password.length < 8) fail(400, 'Use a password of at least 8 characters.');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail(409, 'That username is taken.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, 'An account already uses that email. Sign in instead.');
    // The very first account runs the place.
    const first = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
    const { lastInsertRowid } = db.prepare('INSERT INTO users (username, email, pass, role) VALUES (?, ?, ?, ?)')
      .run(username, email, hashPassword(password), first ? 'admin' : 'member');
    const s = createSession(db, Number(lastInsertRowid));
    res.setHeader('Set-Cookie', sessionCookie(s.token, s.expires, secureCookies));
    return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid)) };
  });

  r.post('/api/auth/login', ({ body, res, ip }) => {
    rateLimit(ip, 'login', 20, 15 * 60e3);
    const id = String(body.login || '').trim();
    const u = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(id, id);
    if (!u || !verifyPassword(String(body.password || ''), u.pass)) fail(401, 'That username or password is not right.');
    const s = createSession(db, u.id);
    res.setHeader('Set-Cookie', sessionCookie(s.token, s.expires, secureCookies));
    return { user: publicUser(u) };
  });

  r.post('/api/auth/logout', ({ req, res }) => {
    const t = sessionToken(req);
    if (t) db.prepare('DELETE FROM sessions WHERE token = ?').run(t);
    res.setHeader('Set-Cookie', sessionCookie('', 0, secureCookies));
    return { ok: true };
  });

  r.get('/api/me', ({ user }) => {
    if (!user) return { user: null };
    const unread = db.prepare('SELECT count(*) n FROM notifications WHERE user_id = ? AND read = 0').get(user.id).n;
    const pending = user.role !== 'member' ? db.prepare("SELECT count(*) n FROM submissions WHERE status = 'pending'").get().n : 0;
    return { user: publicUser(user), unread, pending };
  });

  // Lightweight ownership map so the client can badge cards.
  r.get('/api/me/ids', ({ user }) => {
    if (!user) return { copies: [], wants: [] };
    return {
      copies: db.prepare('SELECT DISTINCT edition_id FROM copies WHERE user_id = ?').all(user.id).map((x) => x.edition_id),
      wants: db.prepare('SELECT edition_id FROM wants WHERE user_id = ?').all(user.id).map((x) => x.edition_id)
    };
  });

  r.patch('/api/me', ({ user, body }) => {
    requireUser(user);
    if ('bio' in body) {
      const bio = String(body.bio || '').slice(0, 600);
      db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, user.id);
    }
    if ('public_collection' in body) db.prepare('UPDATE users SET public_collection = ? WHERE id = ?').run(body.public_collection ? 1 : 0, user.id);
    if ('email' in body) {
      const email = String(body.email || '').trim();
      if (!EMAIL.test(email)) fail(400, 'Enter a valid email address.');
      if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, user.id)) fail(409, 'Another account uses that email.');
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, user.id);
    }
    if (body.new_password) {
      const u = db.prepare('SELECT pass FROM users WHERE id = ?').get(user.id);
      if (!verifyPassword(String(body.current_password || ''), u.pass)) fail(400, 'Your current password is not right.');
      if (String(body.new_password).length < 8) fail(400, 'Use a new password of at least 8 characters.');
      db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPassword(String(body.new_password)), user.id);
    }
    return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) };
  });
}
