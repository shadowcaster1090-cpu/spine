import { requireUser } from '../auth.js';
import { cards } from '../catalogue.js';

export default function (r, { db, fail }) {
  const liveEdition = (id) => {
    const e = db.prepare('SELECT id, merged_into FROM editions WHERE id = ?').get(+id);
    if (!e || e.merged_into) fail(404, 'That edition is not on the register.');
    return e.id;
  };

  r.put('/api/editions/:id/review', ({ params, body, user }) => {
    requireUser(user);
    const id = liveEdition(params.id);
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail(400, 'Give a rating from 1 to 5.');
    const text = String(body.body || '').trim().slice(0, 5000);
    db.prepare(`INSERT INTO reviews (user_id, edition_id, rating, body) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, edition_id) DO UPDATE SET rating = excluded.rating, body = excluded.body, updated_at = datetime('now')`).run(user.id, id, rating, text);
    return { ok: true };
  });

  r.delete('/api/editions/:id/review', ({ params, user }) => {
    requireUser(user);
    db.prepare('DELETE FROM reviews WHERE user_id = ? AND edition_id = ?').run(user.id, +params.id);
    return { ok: true };
  });

  /* lists */
  const loadList = (id, user, write) => {
    const l = db.prepare('SELECT l.*, u.username FROM lists l JOIN users u ON u.id = l.user_id WHERE l.id = ?').get(+id);
    const own = user && l && l.user_id === user.id;
    if (!l || (!l.public && !own)) fail(404, 'No such list.');
    if (write && !own) fail(403, 'Only the list’s owner can change it.');
    return l;
  };
  const touch = (id) => db.prepare("UPDATE lists SET updated_at = datetime('now') WHERE id = ?").run(id);
  const listFields = (body, partial) => {
    const out = {};
    if (!partial || 'title' in body) { out.title = String(body.title || '').trim().slice(0, 120); if (!out.title) fail(400, 'Give the list a title.'); }
    if (!partial || 'description' in body) out.description = String(body.description || '').trim().slice(0, 3000);
    if (!partial || 'public' in body) out.public = body.public === false || body.public === 0 ? 0 : 1;
    return out;
  };

  r.get('/api/lists', ({ query, user }) => {
    const name = query.get('user');
    if (name) {
      const u = db.prepare('SELECT id FROM users WHERE username = ?').get(name);
      if (!u) fail(404, 'No member by that name.');
      const own = user && user.id === u.id;
      return { items: db.prepare(`SELECT l.*, (SELECT count(*) FROM list_items WHERE list_id = l.id) n FROM lists l
        WHERE l.user_id = ? AND (l.public = 1 OR ?) ORDER BY l.updated_at DESC`).all(u.id, own ? 1 : 0) };
    }
    return { items: db.prepare(`SELECT l.*, u.username, (SELECT count(*) FROM list_items WHERE list_id = l.id) n FROM lists l
      JOIN users u ON u.id = l.user_id WHERE l.public = 1 ORDER BY l.updated_at DESC LIMIT 60`).all() };
  });

  r.get('/api/lists/:id', ({ params, user }) => {
    const l = loadList(params.id, user, false);
    const items = db.prepare('SELECT edition_id, note, position FROM list_items WHERE list_id = ? ORDER BY position, rowid').all(l.id);
    const ids = items.map((i) => i.edition_id);
    const eds = ids.length ? cards(db, `e.id IN (${ids.map(() => '?').join(',')})`, ids, 'e.id', 10000) : [];
    const byId = Object.fromEntries(eds.map((e) => [e.id, e]));
    return { list: { ...l, public: !!l.public }, own: !!user && user.id === l.user_id, items: items.filter((i) => byId[i.edition_id]).map((i) => ({ ...i, edition: byId[i.edition_id] })) };
  });

  r.post('/api/lists', ({ body, user }) => {
    requireUser(user);
    const f = listFields(body, false);
    const { lastInsertRowid } = db.prepare('INSERT INTO lists (user_id, title, description, public) VALUES (?, ?, ?, ?)').run(user.id, f.title, f.description, f.public);
    if (body.edition_id) db.prepare('INSERT OR IGNORE INTO list_items (list_id, edition_id) VALUES (?, ?)').run(lastInsertRowid, liveEdition(body.edition_id));
    return { id: Number(lastInsertRowid) };
  });

  r.patch('/api/lists/:id', ({ params, body, user }) => {
    const l = loadList(params.id, user, true);
    const f = listFields(body, true);
    const keys = Object.keys(f);
    if (keys.length) db.prepare(`UPDATE lists SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...keys.map((k) => f[k]), l.id);
    return { ok: true };
  });

  r.delete('/api/lists/:id', ({ params, user }) => {
    const l = loadList(params.id, user, true);
    db.prepare('DELETE FROM lists WHERE id = ?').run(l.id);
    return { ok: true };
  });

  r.post('/api/lists/:id/items', ({ params, body, user }) => {
    const l = loadList(params.id, user, true);
    const eid = liveEdition(body.edition_id);
    const pos = db.prepare('SELECT coalesce(max(position), -1) + 1 p FROM list_items WHERE list_id = ?').get(l.id).p;
    db.prepare('INSERT OR IGNORE INTO list_items (list_id, edition_id, position, note) VALUES (?, ?, ?, ?)').run(l.id, eid, pos, String(body.note || '').slice(0, 1000));
    touch(l.id);
    return { ok: true };
  });

  r.patch('/api/lists/:id/items/:eid', ({ params, body, user }) => {
    const l = loadList(params.id, user, true);
    db.prepare('UPDATE list_items SET note = ? WHERE list_id = ? AND edition_id = ?').run(String(body.note || '').slice(0, 1000), l.id, +params.eid);
    touch(l.id);
    return { ok: true };
  });

  r.delete('/api/lists/:id/items/:eid', ({ params, user }) => {
    const l = loadList(params.id, user, true);
    db.prepare('DELETE FROM list_items WHERE list_id = ? AND edition_id = ?').run(l.id, +params.eid);
    touch(l.id);
    return { ok: true };
  });

  r.put('/api/lists/:id/order', ({ params, body, user }) => {
    const l = loadList(params.id, user, true);
    if (!Array.isArray(body.edition_ids)) fail(400, 'Send the new order as a list of edition ids.');
    const st = db.prepare('UPDATE list_items SET position = ? WHERE list_id = ? AND edition_id = ?');
    body.edition_ids.forEach((id, i) => st.run(i, l.id, +id));
    touch(l.id);
    return { ok: true };
  });

  /* notifications */
  r.get('/api/notifications', ({ user }) => {
    requireUser(user);
    return { items: db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(user.id) };
  });

  r.post('/api/notifications/read', ({ user }) => {
    requireUser(user);
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(user.id);
    return { ok: true };
  });
}
