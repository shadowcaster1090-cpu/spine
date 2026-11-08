import { requireUser, requireMod, verifyPassword } from '../auth.js';
import { tx } from '../db.js';

export default function (r, { db, fail }) {
  // GDPR: everything we hold about the member, in one file.
  r.get('/api/me/export', ({ user }) => {
    requireUser(user);
    const q = (sql) => db.prepare(sql).all(user.id);
    const data = {
      exported_at: new Date().toISOString(),
      account: db.prepare('SELECT id, username, display_name, email, role, bio, public_collection, public_diary, prompt_reviews, favourites, created_at FROM users WHERE id = ?').get(user.id),
      copies: q('SELECT * FROM copies WHERE user_id = ?'),
      wants: q('SELECT * FROM wants WHERE user_id = ?'),
      diary: q('SELECT * FROM watches WHERE user_id = ?'),
      likes: q('SELECT * FROM likes WHERE user_id = ?'),
      watchlist: q('SELECT * FROM watchlist WHERE user_id = ?'),
      following: q('SELECT u.username, f.created_at FROM follows f JOIN users u ON u.id = f.followed_id WHERE f.follower_id = ?'),
      followers: q('SELECT u.username, f.created_at FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followed_id = ?'),
      streaming: q('SELECT service, label, last_sync_at, connected_at FROM streaming_accounts WHERE user_id = ?'),
      imports: q('SELECT * FROM watch_imports WHERE user_id = ?'),
      lists: q('SELECT * FROM lists WHERE user_id = ?'),
      list_items: q('SELECT li.* FROM list_items li JOIN lists l ON l.id = li.list_id WHERE l.user_id = ?'),
      submissions: q('SELECT * FROM submissions WHERE user_id = ?'),
      images: q('SELECT id, edition_id, file, kind, created_at FROM images WHERE user_id = ?'),
      notifications: q('SELECT * FROM notifications WHERE user_id = ?')
    };
    return { __raw: true, body: JSON.stringify(data, null, 2), headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="spine-export-${user.username}.json"` } };
  });

  // Deletes the account and personal data. Catalogue contributions stay, credited to nobody.
  r.delete('/api/me', ({ body, user, res }) => {
    requireUser(user);
    const u = db.prepare('SELECT pass, role FROM users WHERE id = ?').get(user.id);
    if (!verifyPassword(String(body.password || ''), u.pass)) fail(400, 'Enter your password to confirm.');
    if (u.role === 'admin' && db.prepare("SELECT count(*) n FROM users WHERE role = 'admin'").get().n === 1) {
      fail(409, 'You are the only admin. Make someone else an admin first.');
    }
    tx(db, () => {
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    });
    res.setHeader('Set-Cookie', 'spine_session=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    return { ok: true };
  });

  r.get('/api/admin/users', ({ query, user }) => {
    requireMod(user);
    const q = '%' + (query.get('q') || '') + '%';
    return { items: db.prepare(`SELECT u.id, u.username, u.email, u.role, u.created_at,
      (SELECT count(*) FROM submissions WHERE user_id = u.id AND status = 'approved') approved,
      (SELECT count(*) FROM copies WHERE user_id = u.id) copies
      FROM users u WHERE u.username LIKE ? OR u.email LIKE ? ORDER BY u.id DESC LIMIT 100`).all(q, q) };
  });

  r.post('/api/admin/users/:id/role', ({ params, body, user }) => {
    requireMod(user);
    if (user.role !== 'admin') fail(403, 'Only admins can change roles.');
    const role = String(body.role || '');
    if (!['member', 'mod', 'admin'].includes(role)) fail(400, 'Role must be member, mod or admin.');
    const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(+params.id);
    if (!target) fail(404, 'No such member.');
    if (target.role === 'admin' && role !== 'admin' && db.prepare("SELECT count(*) n FROM users WHERE role = 'admin'").get().n === 1) fail(409, 'There must always be at least one admin.');
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
    return { ok: true };
  });
}
