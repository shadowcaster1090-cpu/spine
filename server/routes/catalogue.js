import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { searchEditions, getEdition, getFilmRow, cards, mergeEditions, barcodeAlt, filmCards, searchFilms, filmsById, watchRows, findOrCreateFilm, cleanEdition, reindex, reindexFilm, setDirectors } from '../catalogue.js';
import { tmdbClient, movieDetails, matchMovie, fetchImageToUploads, posterUrl, MAGIC } from '../tmdb.js';
import { suggestFromBarcode } from '../lookup.js';
import { tx, v } from '../db.js';
import { requireUser, requireMod, isMod } from '../auth.js';

export default function (r, { db, fail, rateLimit, uploadsDir, tmdbKey }) {
  r.get('/api/home', ({ user }) => {
    const stats = db.prepare(`SELECT (SELECT count(*) FROM editions WHERE merged_into IS NULL) editions,
      (SELECT count(*) FROM films) films, (SELECT count(*) FROM labels) labels, (SELECT count(*) FROM users) members,
      (SELECT count(*) FROM copies) copies, (SELECT count(*) FROM watches) watches`).get();
    const featured = cards(db, 'e.cover_image_id IS NOT NULL', [], 'want DESC, have DESC', 1)[0] || cards(db, '1', [], 'want DESC, have DESC, e.id', 1)[0] || null;
    const recent = cards(db, '1', [], 'e.id DESC', 12);
    const popular = filmCards(db, '1', [], 'watches DESC, likes DESC, f.title', 12);
    const reviews = watchRows(db, "w.review != ''", [], user, 6);
    const labels = db.prepare(`SELECT l.id, l.name, l.country, count(e.id) n FROM labels l JOIN editions e ON e.label_id = l.id AND e.merged_into IS NULL
      GROUP BY l.id ORDER BY n DESC LIMIT 8`).all();
    const lists = db.prepare(`SELECT l.id, l.title, u.username, (SELECT count(*) FROM list_items WHERE list_id = l.id) n FROM lists l
      JOIN users u ON u.id = l.user_id WHERE l.public = 1 AND EXISTS (SELECT 1 FROM list_items WHERE list_id = l.id) ORDER BY l.updated_at DESC LIMIT 6`).all();
    let mine = null;
    if (user) {
      const year = new Date().getFullYear() + '';
      mine = {
        this_year: db.prepare('SELECT count(*) n FROM watches WHERE user_id = ? AND substr(watched_on, 1, 4) = ?').get(user.id, year).n,
        films: db.prepare('SELECT count(DISTINCT film_id) n FROM watches WHERE user_id = ?').get(user.id).n,
        copies: db.prepare('SELECT count(*) n FROM copies WHERE user_id = ?').get(user.id).n,
        following: db.prepare('SELECT count(*) n FROM follows WHERE follower_id = ?').get(user.id).n,
        watchlist: (() => { const rows = db.prepare('SELECT film_id FROM watchlist WHERE user_id = ? ORDER BY created_at DESC LIMIT 8').all(user.id); const f = filmsById(db, rows.map((x) => x.film_id)); return rows.map((x) => f[x.film_id]).filter(Boolean); })(),
        recent: watchRows(db, 'w.user_id = ?', [user.id], user, 4)
      };
    }
    return { stats, featured, recent, popular, reviews, labels, lists, mine };
  });

  r.get('/api/editions', ({ query }) => searchEditions(db, query));

  r.get('/api/editions/:id', ({ params, user }) => getEdition(db, +params.id, user));

  r.get('/api/editions/:id/history', ({ params }) => {
    const id = +params.id;
    const e = db.prepare('SELECT film_id, label_id FROM editions WHERE id = ?').get(id);
    if (!e) fail(404, 'That edition is not on the register.');
    const rows = db.prepare(`SELECT r.*, u.username FROM revisions r LEFT JOIN users u ON u.id = r.user_id
      WHERE (r.entity = 'edition' AND r.entity_id = ?) OR (r.entity = 'film' AND r.entity_id = ?)
      ORDER BY r.id DESC LIMIT 200`).all(id, e.film_id);
    return { revisions: rows.map((x) => ({ ...x, before: JSON.parse(x.before), after: JSON.parse(x.after) })) };
  });

  r.get('/api/barcode/:code', ({ params, user }) => {
    const code = params.code.replace(/\D/g, '');
    if (code.length < 8) fail(400, 'A barcode is 8 to 14 digits.');
    // UPC-A (12) and EAN-13 with a leading zero are the same code.
    const alt = barcodeAlt(code);
    // Also report a pending submission with this barcode, so scanners don't add the same disc twice.
    const pending = db.prepare("SELECT id, user_id FROM submissions WHERE status = 'pending' AND kind = 'edition' AND json_extract(payload, '$.barcode') IN (?, ?) ORDER BY id LIMIT 1").get(code, alt);
    return { code, items: cards(db, 'e.barcode IN (?, ?)', [code, alt], 'e.id', 20), pending: pending ? { id: pending.id, mine: !!user && pending.user_id === user.id } : null };
  });

  r.get('/api/films', ({ query }) => {
    const q = (query.get('q') || '').trim();
    if (q) return { items: searchFilms(db, q, 12) };
    const where = [], params = [];
    if (query.get('decade')) { where.push('f.year >= ? AND f.year < ?'); params.push(+query.get('decade'), +query.get('decade') + 10); }
    if (query.get('director')) { where.push('f.id IN (SELECT film_id FROM film_directors WHERE person_id = ?)'); params.push(+query.get('director')); }
    const order = { title: 'f.title COLLATE NOCASE', year: 'f.year DESC, f.title', popular: 'watches DESC, likes DESC, f.title', rating: 'rating DESC NULLS LAST, watches DESC', recent: 'f.id DESC' }[query.get('sort')] || 'f.title COLLATE NOCASE';
    const limit = Math.min(+query.get('limit') || 48, 100), page = Math.max(+query.get('page') || 1, 1);
    const w = where.join(' AND ') || '1';
    const total = db.prepare(`SELECT count(*) n FROM films f WHERE ${w}`).get(...params).n;
    return { items: filmCards(db, w, params, order, limit, (page - 1) * limit), total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  });

  r.get('/api/films/:id', ({ params, user }) => {
    const film = getFilmRow(db, +params.id);
    const editions = cards(db, 'e.film_id = ?', [film.id], 'e.release_year, e.id', 100);
    const revisions = db.prepare("SELECT count(*) n FROM revisions WHERE entity = 'film' AND entity_id = ?").get(film.id).n;
    const stats = db.prepare(`SELECT (SELECT count(*) FROM watches WHERE film_id = ?) watches,
      (SELECT count(DISTINCT user_id) FROM watches WHERE film_id = ?) watchers,
      (SELECT round(avg(rating) / 2.0, 2) FROM watches WHERE film_id = ? AND rating IS NOT NULL) rating,
      (SELECT count(*) FROM watches WHERE film_id = ? AND rating IS NOT NULL) ratings,
      (SELECT count(*) FROM likes WHERE film_id = ?) likes,
      (SELECT count(*) FROM watchlist WHERE film_id = ?) watchlist,
      (SELECT count(DISTINCT c.user_id) FROM copies c JOIN editions e ON e.id = c.edition_id WHERE e.film_id = ?) owners`).get(film.id, film.id, film.id, film.id, film.id, film.id, film.id);
    const histogram = db.prepare('SELECT rating, count(*) n FROM watches WHERE film_id = ? AND rating IS NOT NULL GROUP BY rating').all(film.id);
    const reviews = watchRows(db, "w.film_id = ? AND w.review != ''", [film.id], user, 30);
    let mine = null;
    if (user) {
      mine = {
        watches: watchRows(db, 'w.film_id = ? AND w.user_id = ?', [film.id, user.id], user, 50),
        liked: !!db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND film_id = ?').get(user.id, film.id),
        watchlist: !!db.prepare('SELECT 1 FROM watchlist WHERE user_id = ? AND film_id = ?').get(user.id, film.id),
        copies: db.prepare(`SELECT c.id, c.edition_id, c.disc_cond, e.cat_no, e.region, e.standard, l.name label FROM copies c JOIN editions e ON e.id = c.edition_id
          LEFT JOIN labels l ON l.id = e.label_id WHERE c.user_id = ? AND e.film_id = ? ORDER BY c.id`).all(user.id, film.id),
        wants: db.prepare('SELECT w.edition_id FROM wants w JOIN editions e ON e.id = w.edition_id WHERE w.user_id = ? AND e.film_id = ?').all(user.id, film.id).map((x) => x.edition_id)
      };
    }
    const related = film.directors.length ? filmCards(db, 'f.id != ? AND f.id IN (SELECT film_id FROM film_directors WHERE person_id = ?)', [film.id, film.directors[0].id], 'f.year', 8) : [];
    return { film, editions, revisions, stats, histogram, reviews, mine, related };
  });

  r.get('/api/labels', () => ({
    items: db.prepare(`SELECT l.*, count(e.id) n, min(e.release_year) first, max(e.release_year) last FROM labels l
      LEFT JOIN editions e ON e.label_id = l.id AND e.merged_into IS NULL GROUP BY l.id ORDER BY l.name COLLATE NOCASE`).all()
  }));

  r.get('/api/labels/:id', ({ params }) => {
    const label = db.prepare('SELECT * FROM labels WHERE id = ?').get(+params.id);
    if (!label) fail(404, 'That label is not on the register.');
    const editions = cards(db, 'e.label_id = ?', [label.id], 'e.spine_no IS NULL, e.spine_no, e.release_year, f.title', 2000);
    const nums = editions.map((e) => e.spine_no).filter((n) => n != null);
    let gaps = [];
    if (nums.length) {
      const have = new Set(nums), lo = Math.min(...nums), hi = Math.max(...nums);
      if (hi - lo <= 3000) for (let i = Math.max(1, lo); i <= hi; i++) if (!have.has(i)) gaps.push(i);
    }
    return { label, editions, gaps };
  });

  r.get('/api/people/:id', ({ params }) => {
    const person = db.prepare('SELECT * FROM people WHERE id = ?').get(+params.id);
    if (!person) fail(404, 'That person is not on the register.');
    const editions = cards(db, 'e.film_id IN (SELECT film_id FROM film_directors WHERE person_id = ?)', [person.id], 'f.year, e.release_year', 500);
    return { person, editions };
  });

  r.post('/api/editions/:id/images', ({ params, body, user }) => {
    requireUser(user);
    rateLimit(String(user.id), 'upload', 60, 60 * 60e3);
    const id = +params.id;
    const e = db.prepare('SELECT id, cover_image_id, merged_into FROM editions WHERE id = ?').get(id);
    if (!e || e.merged_into) fail(404, 'That edition is not on the register.');
    const m = String(body.data || '').match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
    if (!m) fail(400, 'Upload a JPEG, PNG or WebP image.');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 5e6) fail(413, 'Images can be at most 5 MB.');
    const type = MAGIC.find((t) => t.test(buf));
    if (!type) fail(400, 'That file is not a JPEG, PNG or WebP image.');
    const kind = ['front', 'back', 'spine', 'disc', 'other'].includes(body.kind) ? body.kind : 'front';
    const file = crypto.randomBytes(12).toString('hex') + type.ext;
    fs.writeFileSync(path.join(uploadsDir, file), buf);
    const w = Number.isInteger(body.w) ? body.w : null, h = Number.isInteger(body.h) ? body.h : null;
    const { lastInsertRowid } = db.prepare('INSERT INTO images (edition_id, user_id, file, kind, w, h) VALUES (?, ?, ?, ?, ?, ?)').run(id, user.id, file, kind, w, h);
    if (!e.cover_image_id && kind === 'front') db.prepare('UPDATE editions SET cover_image_id = ? WHERE id = ?').run(lastInsertRowid, id);
    db.prepare("INSERT INTO revisions (entity, entity_id, user_id, summary, after) VALUES ('edition', ?, ?, ?, ?)")
      .run(id, user.id, `Added ${kind} image`, JSON.stringify({ image: file }));
    return { id: Number(lastInsertRowid), file };
  });

  r.post('/api/images/:id/cover', ({ params, user }) => {
    const img = db.prepare('SELECT * FROM images WHERE id = ?').get(+params.id);
    if (!img) fail(404, 'No such image.');
    const e = db.prepare('SELECT cover_image_id FROM editions WHERE id = ?').get(img.edition_id);
    requireUser(user);
    if (!isMod(user) && !(img.user_id === user.id && !e.cover_image_id)) fail(403, 'Only moderators can change an existing cover.');
    db.prepare('UPDATE editions SET cover_image_id = ? WHERE id = ?').run(img.id, img.edition_id);
    return { ok: true };
  });

  r.delete('/api/images/:id', ({ params, user }) => {
    requireUser(user);
    const img = db.prepare('SELECT * FROM images WHERE id = ?').get(+params.id);
    if (!img) fail(404, 'No such image.');
    if (!isMod(user) && img.user_id !== user.id) fail(403, 'You can only remove images you uploaded.');
    db.prepare('UPDATE editions SET cover_image_id = NULL WHERE cover_image_id = ?').run(img.id);
    db.prepare('DELETE FROM images WHERE id = ?').run(img.id);
    fs.rm(path.join(uploadsDir, img.file), () => {});
    return { ok: true };
  });

  r.post('/api/editions/:id/merge', ({ params, body, user }) => {
    requireMod(user);
    mergeEditions(db, +params.id, +body.into, user.id);
    return { ok: true, into: +body.into };
  });

  /* TMDB lookups for adding films. Needs TMDB_API_KEY (v3 key or v4 read token). */
  const tmdbc = tmdbClient(tmdbKey);
  const tmdb = (pathname, params) => tmdbc.get(pathname, params).catch((e) => fail(e.status || 502, e.message));

  r.get('/api/tmdb/search', async ({ query, user }) => {
    requireUser(user);
    if (!tmdbKey) return { items: [], disabled: true };
    const q = (query.get('q') || '').trim();
    if (q.length < 2) return { items: [] };
    const data = await tmdb('/search/movie', { query: q, include_adult: 'false' });
    return {
      items: (data.results || []).slice(0, 10).map((m) => ({
        tmdb_id: m.id, title: m.title, original_title: m.original_title, year: m.release_date ? +m.release_date.slice(0, 4) : null
      }))
    };
  });

  r.get('/api/tmdb/movie/:id', async ({ params, user }) => {
    requireUser(user);
    const film = await movieDetails(tmdbc, +params.id).catch((e) => fail(e.status || 502, e.message));
    const existing = db.prepare('SELECT id FROM films WHERE tmdb_id = ?').get(film.tmdb_id);
    return { existing_film_id: existing ? existing.id : null, film: { ...film, poster_url: posterUrl(film.poster_path, 'w342') } };
  });

  /* ---------- barcode lookup: product services + TMDB, then one tap to the register ---------- */
  r.get('/api/barcode/:code/lookup', async ({ params, query, user, ip }) => {
    requireUser(user);
    rateLimit(String(user.id), 'lookup', 120, 60 * 60e3);
    rateLimit(ip, 'lookup-ip', 300, 60 * 60e3);
    const code = params.code.replace(/\D/g, '');
    if (code.length < 8 || code.length > 14) fail(400, 'A barcode is 8 to 14 digits.');
    const s = await suggestFromBarcode(db, tmdbc, code, { force: query.get('force') === '1' && isMod(user) });
    let existing = null;
    if (s.film?.tmdb_id) existing = db.prepare('SELECT id FROM films WHERE tmdb_id = ?').get(s.film.tmdb_id)?.id || null;
    if (!existing && s.parsed?.title) existing = db.prepare('SELECT id FROM films WHERE title = ? COLLATE NOCASE AND (? IS NULL OR year IS NULL OR year = ?)').get(s.parsed.title, v(s.parsed.year), v(s.parsed.year))?.id || null;
    return {
      code, ...s, tmdb: tmdbc.enabled, existing_film_id: existing,
      film: s.film ? { ...s.film, poster_url: posterUrl(s.film.poster_path, 'w342') } : null
    };
  });

  // Creates the film (from TMDB or the given fields) and the edition in one go, with the retailer's cover
  // and the film's poster fetched in the background of the request. Used by the scanner's "Add to shelf".
  r.post('/api/barcode/:code/create', async ({ params, body, user }) => {
    requireUser(user);
    rateLimit(String(user.id), 'submit', 120, 60 * 60e3);
    const code = params.code.replace(/\D/g, '');
    if (code.length < 8 || code.length > 14) fail(400, 'A barcode is 8 to 14 digits.');
    const dupe = db.prepare('SELECT id FROM editions WHERE barcode IN (?, ?) AND merged_into IS NULL').get(code, barcodeAlt(code));
    if (dupe) fail(409, `That barcode is already on the register (#${dupe.id}).`);
    // Film: an existing one, a TMDB id (details fetched here so the client cannot invent them), or typed fields.
    let filmInput;
    if (body.film_id) filmInput = { film_id: +body.film_id };
    else if (body.tmdb_id) {
      const existing = db.prepare('SELECT id FROM films WHERE tmdb_id = ?').get(+body.tmdb_id);
      filmInput = existing ? { film_id: existing.id } : { film: await movieDetails(tmdbc, +body.tmdb_id).catch((e) => fail(e.status || 502, e.message)) };
    } else if (body.film && body.film.title) filmInput = { film: body.film };
    else fail(400, 'Say which film this disc is: pick the match, or type a title.');
    const e = cleanEdition({ ...body.edition, barcode: code });
    if (!e.label_name) e.label_name = 'Unknown label';
    if (!e.region) e.region = '0';
    const coverUrl = typeof body.cover_url === 'string' && /^https?:\/\//.test(body.cover_url) ? body.cover_url : '';
    const provenance = String(body.source || 'barcode').slice(0, 40);

    const { editionId, filmId, created } = tx(db, () => {
      const film = findOrCreateFilm(db, filmInput);
      const lid = e.label_name ? (db.prepare('INSERT INTO labels (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(e.label_name), db.prepare('SELECT id FROM labels WHERE name = ?').get(e.label_name).id) : null;
      const cols = ['cat_no', 'spine_no', 'region', 'standard', 'anamorphic', 'release_year', 'discs', 'disc_type', 'packaging', 'format', 'barcode', 'oop', 'audio', 'subtitles', 'extras', 'notes'];
      const { lastInsertRowid } = db.prepare(`INSERT INTO editions (film_id, label_id, ${cols.join(', ')}, provenance, created_by) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?, ?)`)
        .run(film.id, lid, ...cols.map((k) => v(k === 'extras' ? JSON.stringify(e[k] || []) : e[k])), provenance, user.id);
      const id = Number(lastInsertRowid);
      reindex(db, id);
      db.prepare("INSERT INTO revisions (entity, entity_id, user_id, summary, before, after) VALUES ('edition', ?, ?, ?, '{}', ?)").run(id, user.id, `Added from a scan (${provenance})`, JSON.stringify({ ...e, film_id: film.id }));
      db.prepare("INSERT INTO submissions (user_id, kind, payload, status, reviewer_id, result_id, note, reviewed_at) VALUES (?, 'edition', ?, 'approved', ?, ?, 'Created from a barcode lookup', datetime('now'))")
        .run(user.id, JSON.stringify({ ...e, film_id: film.id, barcode: code }), user.id, id);
      if (body.add_to === 'shelf') { db.prepare('INSERT INTO copies (user_id, edition_id) VALUES (?, ?)').run(user.id, id); db.prepare('DELETE FROM wants WHERE user_id = ? AND edition_id = ?').run(user.id, id); }
      if (body.add_to === 'want') db.prepare('INSERT OR IGNORE INTO wants (user_id, edition_id) VALUES (?, ?)').run(user.id, id);
      return { editionId: id, filmId: film.id, created: film.created };
    });

    // Artwork, best effort: the retailer's cover for the edition, TMDB's poster for the film.
    const filmRow = db.prepare('SELECT poster, poster_path FROM films WHERE id = ?').get(filmId);
    const [coverFile, posterFile] = await Promise.all([
      coverUrl ? fetchImageToUploads(coverUrl, uploadsDir) : null,
      !filmRow.poster && filmRow.poster_path ? fetchImageToUploads(posterUrl(filmRow.poster_path, 'w780'), uploadsDir) : null
    ]);
    if (coverFile) {
      const { lastInsertRowid } = db.prepare("INSERT INTO images (edition_id, user_id, file, kind) VALUES (?, ?, ?, 'front')").run(editionId, user.id, coverFile);
      db.prepare('UPDATE editions SET cover_image_id = ? WHERE id = ?').run(lastInsertRowid, editionId);
    }
    if (posterFile) db.prepare('UPDATE films SET poster = ? WHERE id = ?').run(posterFile, filmId);
    const copy = body.add_to === 'shelf' ? db.prepare('SELECT * FROM copies WHERE user_id = ? AND edition_id = ? ORDER BY id DESC').get(user.id, editionId) : null;
    return { edition: cards(db, 'e.id = ?', [editionId], 'e.id', 1)[0], film_id: filmId, film_created: created, copy, cover: !!coverFile, poster: !!posterFile };
  });

  // Previews of artwork the lookup found, before anything is saved. Only URLs that a provider or TMDB
  // actually returned can be fetched, so this is not a general proxy.
  r.get('/api/img', async ({ query, res, user }) => {
    requireUser(user);
    const u = String(query.get('u') || '');
    if (!/^https?:\/\/[^\s]+$/i.test(u) || u.length > 1000) fail(400, 'Bad image URL.');
    const allowed = /^https:\/\/image\.tmdb\.org\//.test(u) || !!db.prepare("SELECT 1 FROM barcode_cache WHERE instr(data, ?) > 0 LIMIT 1").get(JSON.stringify(u).slice(1, -1));
    if (!allowed) fail(403, 'That image was not part of a lookup.');
    let r2;
    try { r2 = await fetch(u, { signal: AbortSignal.timeout(10000), redirect: 'follow', headers: { accept: 'image/*', 'user-agent': 'Spine/1.0' } }); } catch { fail(502, 'Could not fetch the image.'); }
    if (!r2.ok) fail(502, `Image host answered ${r2.status}.`);
    const buf = Buffer.from(await r2.arrayBuffer());
    const type = MAGIC.find((t) => t.test(buf));
    if (!type || buf.length > 6e6) fail(415, 'Not an image.');
    res.writeHead(200, { 'Content-Type': type.ext === '.jpg' ? 'image/jpeg' : type.ext === '.png' ? 'image/png' : 'image/webp', 'Cache-Control': 'private, max-age=86400', 'Content-Length': buf.length, 'X-Content-Type-Options': 'nosniff' });
    res.end(buf);
  });

  r.post('/api/editions/:id/cover-from-url', async ({ params, body, user }) => {
    requireUser(user);
    const id = +params.id;
    const e = db.prepare('SELECT id, cover_image_id, merged_into FROM editions WHERE id = ?').get(id);
    if (!e || e.merged_into) fail(404, 'That edition is not on the register.');
    if (e.cover_image_id && !isMod(user)) fail(409, 'This edition already has a cover.');
    const u = String(body.url || '');
    const allowed = /^https:\/\/image\.tmdb\.org\//.test(u) || !!db.prepare('SELECT 1 FROM barcode_cache WHERE instr(data, ?) > 0 LIMIT 1').get(JSON.stringify(u).slice(1, -1));
    if (!allowed) fail(403, 'That image was not part of a lookup.');
    const file = await fetchImageToUploads(u, uploadsDir);
    if (!file) fail(502, 'Could not fetch that image.');
    const { lastInsertRowid } = db.prepare("INSERT INTO images (edition_id, user_id, file, kind) VALUES (?, ?, ?, 'front')").run(id, user.id, file);
    db.prepare('UPDATE editions SET cover_image_id = ? WHERE id = ?').run(lastInsertRowid, id);
    return { id: Number(lastInsertRowid), file };
  });

  // Admin: give existing films real posters (and TMDB ids, directors, synopses) from TMDB.
  r.post('/api/admin/posters', async ({ user, body }) => {
    requireMod(user);
    if (!tmdbc.enabled) fail(501, 'Set TMDB_API_KEY on the server first.');
    const limit = Math.min(+body.limit || 40, 100);
    const rows = db.prepare("SELECT id, title, year, tmdb_id, poster_path FROM films WHERE poster = '' ORDER BY id LIMIT ?").all(limit);
    let done = 0, matched = 0, missed = [];
    for (const f of rows) {
      try {
        let details = null;
        if (f.tmdb_id) details = await movieDetails(tmdbc, f.tmdb_id);
        else {
          const m = await matchMovie(tmdbc, f.title, f.year);
          if (m) { details = await movieDetails(tmdbc, m.tmdb_id); matched++; }
        }
        if (!details) { missed.push(f.title); continue; }
        const dup = db.prepare('SELECT id FROM films WHERE tmdb_id = ? AND id != ?').get(details.tmdb_id, f.id);
        const file = details.poster_path ? await fetchImageToUploads(posterUrl(details.poster_path, 'w780'), uploadsDir) : null;
        db.prepare(`UPDATE films SET poster = coalesce(?, poster), poster_path = ?, tmdb_id = coalesce(tmdb_id, ?), synopsis = CASE WHEN synopsis = '' THEN ? ELSE synopsis END,
          runtime = coalesce(runtime, ?), country = CASE WHEN country = '' THEN ? ELSE country END, language = CASE WHEN language = '' THEN ? ELSE language END, original_title = CASE WHEN original_title = '' THEN ? ELSE original_title END WHERE id = ?`)
          .run(file, details.poster_path, dup ? null : details.tmdb_id, details.synopsis, v(details.runtime), details.country, details.language, details.original_title, f.id);
        if (!db.prepare('SELECT 1 FROM film_directors WHERE film_id = ?').get(f.id) && details.directors.length) { setDirectors(db, f.id, details.directors); reindexFilm(db, f.id); }
        done++;
      } catch (e) { missed.push(`${f.title} (${e.message})`); }
    }
    const remaining = db.prepare("SELECT count(*) n FROM films WHERE poster = ''").get().n;
    return { done, matched, missed, remaining };
  });
}
