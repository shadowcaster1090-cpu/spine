// The diary: logging films, reviews, review prompts, likes and the watchlist.
import { requireUser } from '../auth.js';
import { watchRows, filmCards, filmsById, notify } from '../catalogue.js';
import { tx } from '../db.js';

export const VIA = ['', 'dvd', 'netflix', 'prime', 'disney', 'apple', 'mubi', 'bfi', 'cinema', 'tv', 'other'];
export const VIA_NAMES = { dvd: 'own DVD', netflix: 'Netflix', prime: 'Prime Video', disney: 'Disney+', apple: 'Apple TV', mubi: 'MUBI', bfi: 'BFI Player', cinema: 'cinema', tv: 'TV', other: 'elsewhere' };

export default function (r, { db, fail }) {
  const findUser = (name, viewer) => {
    const u = db.prepare('SELECT id, username, display_name, public_collection, public_diary FROM users WHERE username = ?').get(name);
    if (!u) fail(404, 'No member by that name.');
    return { u, own: !!viewer && viewer.id === u.id };
  };
  const liveFilm = (id) => {
    const f = db.prepare('SELECT id FROM films WHERE id = ?').get(+id);
    if (!f) fail(404, 'That film is not on the register.');
    return f.id;
  };

  function fields(body, partial, user) {
    const out = {};
    const has = (k) => !partial || k in body;
    if (has('watched_on')) {
      const d = String(body.watched_on ?? '').trim();
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) fail(400, 'Write the date as YYYY-MM-DD.');
      if (d && d > new Date(Date.now() + 864e5).toISOString().slice(0, 10)) fail(400, 'That date is in the future.');
      out.watched_on = d;
    }
    if (has('via')) { const v = String(body.via ?? ''); if (!VIA.includes(v)) fail(400, 'Pick where you watched it from the list.'); out.via = v; }
    if (has('copy_id') || has('edition_id')) {
      out.copy_id = null; out.edition_id = null;
      if (body.copy_id) {
        const c = db.prepare('SELECT id, edition_id FROM copies WHERE id = ? AND user_id = ?').get(+body.copy_id, user.id);
        if (!c) fail(400, 'That copy is not on your shelf.');
        out.copy_id = c.id; out.edition_id = c.edition_id; out.via = 'dvd';
      } else if (body.edition_id) {
        const e = db.prepare('SELECT id, merged_into FROM editions WHERE id = ?').get(+body.edition_id);
        if (!e) fail(400, 'That edition is not on the register.');
        out.edition_id = e.merged_into || e.id;
      }
    }
    if (has('rewatch')) out.rewatch = body.rewatch ? 1 : 0;
    if (has('rating')) {
      const n = body.rating === '' || body.rating == null ? null : Number(body.rating);
      if (n != null && (!Number.isInteger(n) || n < 1 || n > 10)) fail(400, 'Ratings go from ½ to 5 stars.');
      out.rating = n;
    }
    if (has('liked')) out.liked = body.liked ? 1 : 0;
    if (has('review')) out.review = String(body.review ?? '').trim().slice(0, 10000);
    if (has('spoilers')) out.spoilers = body.spoilers ? 1 : 0;
    return out;
  }

  const afterSave = (user, filmId, f) => {
    if (f.liked === 1) db.prepare('INSERT OR IGNORE INTO likes (user_id, film_id) VALUES (?, ?)').run(user.id, filmId);
    if (f.liked === 0) db.prepare('DELETE FROM likes WHERE user_id = ? AND film_id = ?').run(user.id, filmId);
    db.prepare('DELETE FROM watchlist WHERE user_id = ? AND film_id = ?').run(user.id, filmId);
  };

  r.post('/api/watches', ({ body, user }) => {
    requireUser(user);
    const filmId = liveFilm(body.film_id);
    const f = fields(body, false, user);
    if (f.via !== 'dvd') { /* keep edition if given explicitly */ }
    const earlier = db.prepare('SELECT 1 FROM watches WHERE user_id = ? AND film_id = ? LIMIT 1').get(user.id, filmId);
    if (earlier && !('rewatch' in body)) f.rewatch = 1;
    const done = f.review || f.rating != null;
    const id = tx(db, () => {
      const { lastInsertRowid } = db.prepare(`INSERT INTO watches (user_id, film_id, watched_on, via, edition_id, copy_id, rewatch, rating, liked, review, spoilers, source, prompt_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`)
        .run(user.id, filmId, f.watched_on, f.via, f.edition_id ?? null, f.copy_id ?? null, f.rewatch, f.rating, f.liked, f.review, f.spoilers, done ? 'done' : 'none');
      afterSave(user, filmId, f);
      return Number(lastInsertRowid);
    });
    return { watch: watchRows(db, 'w.id = ?', [id], user, 1)[0] };
  });

  const own = (id, user) => {
    requireUser(user);
    const w = db.prepare('SELECT * FROM watches WHERE id = ?').get(+id);
    if (!w || w.user_id !== user.id) fail(404, 'That diary entry is not yours.');
    return w;
  };

  r.get('/api/watches/:id', ({ params, user }) => {
    const w = watchRows(db, 'w.id = ?', [+params.id], user, 1)[0];
    if (!w) fail(404, 'No such diary entry.');
    const owner = db.prepare('SELECT id, public_diary FROM users WHERE username = ?').get(w.user.username);
    if (!owner.public_diary && !w.review && (!user || user.id !== owner.id)) fail(404, 'No such diary entry.');
    return { watch: w, own: !!user && user.id === owner.id };
  });

  r.patch('/api/watches/:id', ({ params, body, user }) => {
    const w = own(params.id, user);
    const f = fields(body, true, user);
    if (f.review || f.rating != null) f.prompt_state = 'done';
    const keys = Object.keys(f);
    tx(db, () => {
      if (keys.length) db.prepare(`UPDATE watches SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...keys.map((k) => f[k]), w.id);
      afterSave(user, w.film_id, f);
    });
    return { watch: watchRows(db, 'w.id = ?', [w.id], user, 1)[0] };
  });

  r.delete('/api/watches/:id', ({ params, user }) => {
    const w = own(params.id, user);
    db.prepare('DELETE FROM watches WHERE id = ?').run(w.id);
    return { ok: true };
  });

  r.post('/api/watches/:id/like', ({ params, user }) => {
    requireUser(user);
    const w = db.prepare('SELECT id, user_id, film_id FROM watches WHERE id = ?').get(+params.id);
    if (!w) fail(404, 'No such review.');
    const r2 = db.prepare('INSERT OR IGNORE INTO review_likes (user_id, watch_id) VALUES (?, ?)').run(user.id, w.id);
    if (r2.changes && w.user_id !== user.id) {
      const t = db.prepare('SELECT title FROM films WHERE id = ?').get(w.film_id)?.title;
      notify(db, w.user_id, `${user.username} liked your review of ${t}.`, `/review/${w.id}`);
    }
    return { ok: true };
  });
  r.delete('/api/watches/:id/like', ({ params, user }) => {
    requireUser(user);
    db.prepare('DELETE FROM review_likes WHERE user_id = ? AND watch_id = ?').run(user.id, +params.id);
    return { ok: true };
  });

  /* review prompts: things a service says you watched, waiting for a rating or review */
  r.get('/api/prompts', ({ user }) => {
    if (!user) return { items: [] };
    if (!db.prepare('SELECT prompt_reviews FROM users WHERE id = ?').get(user.id).prompt_reviews) return { items: [] };
    return { items: watchRows(db, "w.user_id = ? AND w.prompt_state = 'pending'", [user.id], user, 8) };
  });
  r.post('/api/prompts/:id', ({ params, body, user }) => {
    const w = own(params.id, user);
    const action = String(body.action || '');
    if (action === 'dismiss') db.prepare("UPDATE watches SET prompt_state = 'dismissed' WHERE id = ?").run(w.id);
    else if (action === 'not_me') db.prepare('DELETE FROM watches WHERE id = ?').run(w.id);
    else if (action === 'dismiss_all') db.prepare("UPDATE watches SET prompt_state = 'dismissed' WHERE user_id = ? AND prompt_state = 'pending'").run(user.id);
    else fail(400, 'Unknown action.');
    return { ok: true };
  });

  /* likes & watchlist */
  const toggle = (table, verb) => ({
    on: ({ params, user }) => { requireUser(user); const id = liveFilm(params.id); db.prepare(`INSERT OR IGNORE INTO ${table} (user_id, film_id) VALUES (?, ?)`).run(user.id, id); return { ok: true, [verb]: true }; },
    off: ({ params, user }) => { requireUser(user); db.prepare(`DELETE FROM ${table} WHERE user_id = ? AND film_id = ?`).run(user.id, +params.id); return { ok: true, [verb]: false }; }
  });
  const L = toggle('likes', 'liked'), W = toggle('watchlist', 'watchlist');
  r.post('/api/films/:id/like', L.on); r.delete('/api/films/:id/like', L.off);
  r.post('/api/films/:id/watchlist', W.on); r.delete('/api/films/:id/watchlist', W.off);

  /* a member's diary, reviews, films, watchlist, likes */
  const diaryVisible = ({ u, own }) => { if (!own && !u.public_diary) fail(403, `${u.username} keeps their diary private.`); };

  r.get('/api/users/:name/diary', ({ params, query, user }) => {
    const who = findUser(params.name, user); diaryVisible(who);
    const year = query.get('year');
    const where = ['w.user_id = ?'], p = [who.u.id];
    if (year) { where.push('substr(w.watched_on, 1, 4) = ?'); p.push(year); }
    const page = Math.max(1, +query.get('page') || 1), limit = 60;
    const items = watchRows(db, where.join(' AND '), p, user, limit, (page - 1) * limit);
    const years = db.prepare("SELECT substr(watched_on, 1, 4) y, count(*) n FROM watches WHERE user_id = ? AND watched_on != '' GROUP BY y ORDER BY y DESC").all(who.u.id);
    return { items, years, page, more: items.length === limit };
  });

  r.get('/api/users/:name/reviews', ({ params, user }) => {
    const who = findUser(params.name, user);
    return { items: watchRows(db, "w.user_id = ? AND w.review != ''", [who.u.id], user, 100) };
  });

  r.get('/api/users/:name/films', ({ params, query, user }) => {
    const who = findUser(params.name, user); diaryVisible(who);
    const sort = { recent: 'last DESC', rating: 'my_rating DESC NULLS LAST, last DESC', title: 'f.title COLLATE NOCASE', year: 'f.year DESC' }[query.get('sort')] || 'last DESC';
    const rows = db.prepare(`SELECT f.id, max(w.watched_on) last, max(w.rating) my_rating, count(*) times, max(w.liked) liked
      FROM watches w JOIN films f ON f.id = w.film_id WHERE w.user_id = ? GROUP BY f.id ORDER BY ${sort} LIMIT 500`).all(who.u.id);
    const films = filmsById(db, rows.map((x) => x.id));
    return { items: rows.map((x) => ({ film: films[x.id], last: x.last, my_rating: x.my_rating, times: x.times, liked: !!x.liked })) };
  });

  r.get('/api/users/:name/watchlist', ({ params, user }) => {
    const who = findUser(params.name, user); diaryVisible(who);
    const rows = db.prepare('SELECT film_id, created_at FROM watchlist WHERE user_id = ? ORDER BY created_at DESC').all(who.u.id);
    const films = filmsById(db, rows.map((x) => x.film_id));
    return { items: rows.map((x) => ({ film: films[x.film_id], added: x.created_at })).filter((x) => x.film) };
  });

  r.get('/api/users/:name/likes', ({ params, user }) => {
    const who = findUser(params.name, user); diaryVisible(who);
    const rows = db.prepare('SELECT film_id FROM likes WHERE user_id = ? ORDER BY created_at DESC').all(who.u.id);
    const films = filmsById(db, rows.map((x) => x.film_id));
    return { items: rows.map((x) => films[x.film_id]).filter(Boolean) };
  });

  r.get('/api/popular-films', () => ({ items: filmCards(db, '1', [], 'watches DESC, likes DESC, f.title', 24) }));
}
