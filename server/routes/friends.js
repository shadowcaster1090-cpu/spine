// Friends: following, the activity feed, finding people, and comparing collections and diaries.
import { requireUser } from '../auth.js';
import { watchRows, filmsById, cards, notify } from '../catalogue.js';

export default function (r, { db, fail }) {
  const byName = (name) => {
    const u = db.prepare('SELECT id, username, display_name, bio, public_collection, public_diary, created_at FROM users WHERE username = ?').get(name);
    if (!u) fail(404, 'No member by that name.');
    return u;
  };
  const followingIds = (userId) => db.prepare('SELECT followed_id FROM follows WHERE follower_id = ?').all(userId).map((x) => x.followed_id);

  // A member as shown in people lists: counts plus the viewer's relationship to them.
  function person(u, viewer) {
    const s = db.prepare(`SELECT (SELECT count(*) FROM watches WHERE user_id = ?) films,
      (SELECT count(*) FROM copies WHERE user_id = ?) copies,
      (SELECT count(*) FROM watches WHERE user_id = ? AND review != '') reviews,
      (SELECT count(*) FROM follows WHERE followed_id = ?) followers,
      (SELECT count(*) FROM follows WHERE follower_id = ?) following`).get(u.id, u.id, u.id, u.id, u.id);
    const last = db.prepare('SELECT film_id, watched_on, rating FROM watches WHERE user_id = ? ORDER BY watched_on DESC, id DESC LIMIT 1').get(u.id);
    return {
      username: u.username, display_name: u.display_name, bio: u.bio, stats: s,
      public_collection: !!u.public_collection, public_diary: !!u.public_diary,
      following: !!viewer && !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?').get(viewer.id, u.id),
      follows_you: !!viewer && !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?').get(u.id, viewer.id),
      last_film: last ? { ...(filmsById(db, [last.film_id])[last.film_id] || {}), watched_on: last.watched_on, rating: last.rating } : null
    };
  }

  r.post('/api/users/:name/follow', ({ params, user }) => {
    requireUser(user);
    const u = byName(params.name);
    if (u.id === user.id) fail(400, 'You can’t follow yourself.');
    const res = db.prepare('INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?, ?)').run(user.id, u.id);
    if (res.changes) notify(db, u.id, `${user.username} started following you.`, `/u/${user.username}`);
    return { following: true };
  });
  r.delete('/api/users/:name/follow', ({ params, user }) => {
    requireUser(user);
    const u = byName(params.name);
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?').run(user.id, u.id);
    return { following: false };
  });

  r.get('/api/friends', ({ user }) => {
    requireUser(user);
    const following = db.prepare('SELECT u.* FROM follows f JOIN users u ON u.id = f.followed_id WHERE f.follower_id = ? ORDER BY f.created_at DESC').all(user.id).map((u) => person(u, user));
    const followers = db.prepare('SELECT u.* FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followed_id = ? ORDER BY f.created_at DESC').all(user.id).map((u) => person(u, user));
    // People you don't follow yet, ranked by overlap with your shelf and diary, then activity.
    const suggestions = db.prepare(`SELECT u.*,
        (SELECT count(*) FROM copies c JOIN editions e ON e.id = c.edition_id WHERE c.user_id = u.id AND e.film_id IN (SELECT e2.film_id FROM copies c2 JOIN editions e2 ON e2.id = c2.edition_id WHERE c2.user_id = ?)) +
        (SELECT count(DISTINCT film_id) FROM watches WHERE user_id = u.id AND film_id IN (SELECT film_id FROM watches WHERE user_id = ?)) AS overlap,
        (SELECT count(*) FROM watches WHERE user_id = u.id) + (SELECT count(*) FROM copies WHERE user_id = u.id) AS activity
      FROM users u WHERE u.id != ? AND u.id NOT IN (SELECT followed_id FROM follows WHERE follower_id = ?)
      ORDER BY overlap DESC, activity DESC LIMIT 12`).all(user.id, user.id, user.id, user.id).map((u) => ({ ...person(u, user), overlap: u.overlap }));
    return { following, followers, suggestions };
  });

  r.get('/api/people', ({ query, user }) => {
    const q = (query.get('q') || '').trim();
    if (q.length < 2) return { items: [] };
    const rows = db.prepare('SELECT * FROM users WHERE username LIKE ? OR display_name LIKE ? ORDER BY username LIMIT 20').all(`%${q}%`, `%${q}%`);
    return { items: rows.map((u) => person(u, user)) };
  });

  /* the activity feed */
  r.get('/api/feed', ({ query, user }) => {
    const scope = query.get('scope') || (user ? 'friends' : 'everyone');
    let ids = null;
    if (scope === 'friends') { requireUser(user); ids = followingIds(user.id); if (!ids.length) return { items: [], empty: 'nobody' }; }
    if (scope === 'me') { requireUser(user); ids = [user.id]; }
    const before = query.get('before') || '9999';
    const inIds = ids ? `IN (${ids.map(() => '?').join(',')})` : 'IS NOT NULL';
    const p = (n) => (ids ? Array(n).fill(ids).flat() : []);
    const sql = `SELECT * FROM (
        SELECT 'watch' type, w.id ref, w.user_id, w.film_id, NULL edition_id, NULL list_id, NULL other_id, w.created_at at FROM watches w WHERE w.user_id ${inIds}
        UNION ALL SELECT 'copy', c.id, c.user_id, NULL, c.edition_id, NULL, NULL, c.created_at FROM copies c WHERE c.user_id ${inIds}
        UNION ALL SELECT 'want', NULL, wa.user_id, NULL, wa.edition_id, NULL, NULL, wa.created_at FROM wants wa WHERE wa.user_id ${inIds}
        UNION ALL SELECT 'watchlist', NULL, wl.user_id, wl.film_id, NULL, NULL, NULL, wl.created_at FROM watchlist wl WHERE wl.user_id ${inIds}
        UNION ALL SELECT 'like', NULL, lk.user_id, lk.film_id, NULL, NULL, NULL, lk.created_at FROM likes lk WHERE lk.user_id ${inIds} AND NOT EXISTS (SELECT 1 FROM watches x WHERE x.user_id = lk.user_id AND x.film_id = lk.film_id AND x.liked = 1)
        UNION ALL SELECT 'list', l.id, l.user_id, NULL, NULL, l.id, NULL, l.updated_at FROM lists l WHERE l.public = 1 AND l.user_id ${inIds} AND EXISTS (SELECT 1 FROM list_items WHERE list_id = l.id)
        UNION ALL SELECT 'follow', NULL, f.follower_id, NULL, NULL, NULL, f.followed_id, f.created_at FROM follows f WHERE f.follower_id ${inIds}
      ) WHERE at < ? ORDER BY at DESC LIMIT 40`;
    const rows = db.prepare(sql).all(...p(7), before);
    // Hydrate.
    const users = Object.fromEntries(db.prepare(`SELECT id, username, display_name FROM users WHERE id IN (${[...new Set(rows.flatMap((x) => [x.user_id, x.other_id]).filter(Boolean))].map(() => '?').join(',') || 'NULL'})`)
      .all(...[...new Set(rows.flatMap((x) => [x.user_id, x.other_id]).filter(Boolean))]).map((u) => [u.id, u]));
    const watchIds = rows.filter((x) => x.type === 'watch').map((x) => x.ref);
    const watches = watchIds.length ? Object.fromEntries(watchRows(db, `w.id IN (${watchIds.map(() => '?').join(',')})`, watchIds, user, watchIds.length).map((w) => [w.id, w])) : {};
    const films = filmsById(db, rows.map((x) => x.film_id));
    const edIds = [...new Set(rows.map((x) => x.edition_id).filter(Boolean))];
    const editions = edIds.length ? Object.fromEntries(cards(db, `e.id IN (${edIds.map(() => '?').join(',')})`, edIds, 'e.id', edIds.length).map((e) => [e.id, e])) : {};
    const listIds = rows.filter((x) => x.list_id).map((x) => x.list_id);
    const lists = listIds.length ? Object.fromEntries(db.prepare(`SELECT id, title, (SELECT count(*) FROM list_items WHERE list_id = lists.id) n FROM lists WHERE id IN (${listIds.map(() => '?').join(',')})`).all(...listIds).map((l) => [l.id, l])) : {};
    const items = rows.map((x) => ({
      type: x.type, at: x.at, user: users[x.user_id],
      watch: x.type === 'watch' ? watches[x.ref] : undefined,
      film: x.film_id ? films[x.film_id] : undefined,
      edition: x.edition_id ? editions[x.edition_id] : undefined,
      list: x.list_id ? lists[x.list_id] : undefined,
      other: x.other_id ? users[x.other_id] : undefined
    })).filter((x) => x.user && (x.type !== 'watch' || x.watch) && (!x.edition_id || x.edition));
    return { items, next: rows.length === 40 ? rows[rows.length - 1].at : null };
  });

  /* what friends think of a film or own of it */
  r.get('/api/films/:id/friends', ({ params, user }) => {
    if (!user) return { watched: [], own: [], watchlist: [], liked: [] };
    const ids = followingIds(user.id);
    if (!ids.length) return { watched: [], own: [], watchlist: [], liked: [], nobody: true };
    const inIds = `IN (${ids.map(() => '?').join(',')})`;
    const filmId = +params.id;
    const watched = db.prepare(`SELECT u.username, u.display_name, w.id watch_id, w.rating, w.liked, w.watched_on, w.review != '' has_review, w.via
      FROM watches w JOIN users u ON u.id = w.user_id WHERE w.film_id = ? AND w.user_id ${inIds}
      AND w.id = (SELECT id FROM watches WHERE user_id = w.user_id AND film_id = w.film_id ORDER BY watched_on DESC, id DESC LIMIT 1)`).all(filmId, ...ids);
    const own = db.prepare(`SELECT DISTINCT u.username, u.display_name, e.id edition_id, l.name label, e.cat_no, e.region, e.standard FROM copies c JOIN users u ON u.id = c.user_id
      JOIN editions e ON e.id = c.edition_id LEFT JOIN labels l ON l.id = e.label_id WHERE e.film_id = ? AND c.user_id ${inIds} AND u.public_collection = 1`).all(filmId, ...ids);
    const watchlist = db.prepare(`SELECT u.username, u.display_name FROM watchlist w JOIN users u ON u.id = w.user_id WHERE w.film_id = ? AND w.user_id ${inIds} AND u.public_diary = 1`).all(filmId, ...ids);
    const liked = db.prepare(`SELECT u.username FROM likes k JOIN users u ON u.id = k.user_id WHERE k.film_id = ? AND k.user_id ${inIds}`).all(filmId, ...ids);
    return { watched: watched.map((w) => ({ ...w, liked: !!w.liked, has_review: !!w.has_review })), own, watchlist, liked };
  });

  r.get('/api/editions/:id/friends', ({ params, user }) => {
    if (!user) return { own: [], want: [], watched: [] };
    const ids = followingIds(user.id);
    if (!ids.length) return { own: [], want: [], watched: [] };
    const inIds = `IN (${ids.map(() => '?').join(',')})`, id = +params.id;
    return {
      own: db.prepare(`SELECT DISTINCT u.username, u.display_name FROM copies c JOIN users u ON u.id = c.user_id WHERE c.edition_id = ? AND c.user_id ${inIds} AND u.public_collection = 1`).all(id, ...ids),
      want: db.prepare(`SELECT u.username, u.display_name FROM wants w JOIN users u ON u.id = w.user_id WHERE w.edition_id = ? AND w.user_id ${inIds} AND u.public_collection = 1`).all(id, ...ids),
      watched: db.prepare(`SELECT DISTINCT u.username, u.display_name FROM watches w JOIN users u ON u.id = w.user_id WHERE w.edition_id = ? AND w.user_id ${inIds}`).all(id, ...ids)
    };
  });

  /* you and another member side by side */
  r.get('/api/users/:name/compare', ({ params, user }) => {
    requireUser(user);
    const u = byName(params.name);
    if (u.id === user.id) fail(400, 'That’s you.');
    const both = db.prepare(`SELECT a.film_id, max(a.rating) mine, max(b.rating) theirs FROM watches a JOIN watches b ON b.film_id = a.film_id
      WHERE a.user_id = ? AND b.user_id = ? GROUP BY a.film_id ORDER BY abs(coalesce(max(a.rating), 0) - coalesce(max(b.rating), 0)) DESC LIMIT 60`).all(user.id, u.id);
    const theirsOnly = u.public_diary ? db.prepare(`SELECT film_id, max(rating) r FROM watches WHERE user_id = ? AND film_id NOT IN (SELECT film_id FROM watches WHERE user_id = ?)
      GROUP BY film_id ORDER BY r DESC NULLS LAST LIMIT 24`).all(u.id, user.id) : [];
    const shelfOnlyTheirs = u.public_collection ? db.prepare(`SELECT DISTINCT c.edition_id FROM copies c WHERE c.user_id = ? AND c.edition_id NOT IN (SELECT edition_id FROM copies WHERE user_id = ?) LIMIT 60`).all(u.id, user.id).map((x) => x.edition_id) : [];
    const sharedShelf = u.public_collection ? db.prepare(`SELECT count(DISTINCT c.edition_id) n FROM copies c WHERE c.user_id = ? AND c.edition_id IN (SELECT edition_id FROM copies WHERE user_id = ?)`).get(u.id, user.id).n : 0;
    const films = filmsById(db, [...both.map((x) => x.film_id), ...theirsOnly.map((x) => x.film_id)]);
    const eds = shelfOnlyTheirs.length ? cards(db, `e.id IN (${shelfOnlyTheirs.map(() => '?').join(',')})`, shelfOnlyTheirs, 'f.title', 60) : [];
    // Taste match: 1 - mean absolute rating gap over films you both rated, on the 10-point scale.
    const rated = both.filter((x) => x.mine != null && x.theirs != null);
    const taste = rated.length ? Math.round(100 * (1 - rated.reduce((s, x) => s + Math.abs(x.mine - x.theirs), 0) / rated.length / 9)) : null;
    return {
      user: { username: u.username, display_name: u.display_name },
      both: both.map((x) => ({ film: films[x.film_id], mine: x.mine, theirs: x.theirs })).filter((x) => x.film),
      theirs_only: theirsOnly.map((x) => ({ film: films[x.film_id], rating: x.r })).filter((x) => x.film),
      shelf_only_theirs: eds, shared_shelf: sharedShelf, taste, rated: rated.length
    };
  });
}
