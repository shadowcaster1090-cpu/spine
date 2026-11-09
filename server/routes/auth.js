import { hashPassword, verifyPassword, createSession, sessionCookie, sessionToken, requireUser } from '../auth.js';

const USERNAME = /^[a-zA-Z0-9_.-]{3,24}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function (r, { db, fail, rateLimit, secureCookies }) {
  const publicUser = (u) => ({ id: u.id, username: u.username, display_name: u.display_name, email: u.email, role: u.role, bio: u.bio, public_collection: !!u.public_collection, public_diary: !!u.public_diary, prompt_reviews: !!u.prompt_reviews, theme: u.theme, favourites: JSON.parse(u.favourites || '[]'), created_at: u.created_at,
    has_password: !!u.pass, logins: db.prepare('SELECT provider FROM identities WHERE user_id = ? ORDER BY created_at').all(u.id).map((x) => x.provider) });

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
    if (u && !u.pass) {
      const via = db.prepare('SELECT provider FROM identities WHERE user_id = ? ORDER BY created_at').all(u.id).map((x) => x.provider[0].toUpperCase() + x.provider.slice(1));
      fail(401, `That account signs in with ${via.join(' or ') || 'a linked service'}. Use that button, or set a password from Settings once you are in.`);
    }
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
    const full = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    const unread = db.prepare('SELECT count(*) n FROM notifications WHERE user_id = ? AND read = 0').get(user.id).n;
    const pending = user.role !== 'member' ? db.prepare("SELECT count(*) n FROM submissions WHERE status = 'pending'").get().n : 0;
    const prompts = full.prompt_reviews ? db.prepare("SELECT count(*) n FROM watches WHERE user_id = ? AND prompt_state = 'pending'").get(user.id).n : 0;
    return { user: publicUser(full), unread, pending, prompts };
  });

  // Lightweight ownership map so the client can badge cards.
  r.get('/api/me/ids', ({ user }) => {
    if (!user) return { copies: [], wants: [], watched: [], liked: [], watchlist: [], following: [] };
    return {
      copies: db.prepare('SELECT DISTINCT edition_id FROM copies WHERE user_id = ?').all(user.id).map((x) => x.edition_id),
      wants: db.prepare('SELECT edition_id FROM wants WHERE user_id = ?').all(user.id).map((x) => x.edition_id),
      watched: db.prepare('SELECT DISTINCT film_id FROM watches WHERE user_id = ?').all(user.id).map((x) => x.film_id),
      liked: db.prepare('SELECT film_id FROM likes WHERE user_id = ?').all(user.id).map((x) => x.film_id),
      watchlist: db.prepare('SELECT film_id FROM watchlist WHERE user_id = ?').all(user.id).map((x) => x.film_id),
      following: db.prepare('SELECT u.username FROM follows f JOIN users u ON u.id = f.followed_id WHERE f.follower_id = ?').all(user.id).map((x) => x.username)
    };
  });

  r.patch('/api/me', ({ user, body }) => {
    requireUser(user);
    if ('bio' in body) {
      const bio = String(body.bio || '').slice(0, 600);
      db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, user.id);
    }
    if ('public_collection' in body) db.prepare('UPDATE users SET public_collection = ? WHERE id = ?').run(body.public_collection ? 1 : 0, user.id);
    if ('public_diary' in body) db.prepare('UPDATE users SET public_diary = ? WHERE id = ?').run(body.public_diary ? 1 : 0, user.id);
    if ('prompt_reviews' in body) db.prepare('UPDATE users SET prompt_reviews = ? WHERE id = ?').run(body.prompt_reviews ? 1 : 0, user.id);
    if ('display_name' in body) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(String(body.display_name || '').trim().slice(0, 40), user.id);
    if ('theme' in body) { const t = String(body.theme); if (!['system', 'light', 'dark'].includes(t)) fail(400, 'Theme must be system, light or dark.'); db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(t, user.id); }
    if ('favourites' in body) {
      if (!Array.isArray(body.favourites) || body.favourites.length > 4) fail(400, 'Pick up to four favourite films.');
      const ids = [...new Set(body.favourites.map(Number))].filter((id) => db.prepare('SELECT 1 FROM films WHERE id = ?').get(id));
      db.prepare('UPDATE users SET favourites = ? WHERE id = ?').run(JSON.stringify(ids), user.id);
    }
    if ('email' in body) {
      const email = String(body.email || '').trim();
      if (!EMAIL.test(email)) fail(400, 'Enter a valid email address.');
      if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, user.id)) fail(409, 'Another account uses that email.');
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, user.id);
    }
    if (body.new_password) {
      const u = db.prepare('SELECT pass FROM users WHERE id = ?').get(user.id);
      if (u.pass && !verifyPassword(String(body.current_password || ''), u.pass)) fail(400, 'Your current password is not right.');
      if (String(body.new_password).length < 8) fail(400, 'Use a new password of at least 8 characters.');
      db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPassword(String(body.new_password)), user.id);
    }
    return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) };
  });
}
