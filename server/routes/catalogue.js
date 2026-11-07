import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { searchEditions, getEdition, getFilmRow, cards, mergeEditions } from '../catalogue.js';
import { requireUser, requireMod, isMod } from '../auth.js';

const MAGIC = [
  { ext: '.jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.png', test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: '.webp', test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' }
];

export default function (r, { db, fail, rateLimit, uploadsDir, tmdbKey }) {
  r.get('/api/home', () => {
    const stats = db.prepare(`SELECT (SELECT count(*) FROM editions WHERE merged_into IS NULL) editions,
      (SELECT count(*) FROM films) films, (SELECT count(*) FROM labels) labels, (SELECT count(*) FROM users) members,
      (SELECT count(*) FROM copies) copies`).get();
    // Feature the most-wanted edition that has a real scan; fall back to most-wanted overall.
    const featured = cards(db, 'e.cover_image_id IS NOT NULL', [], 'want DESC, have DESC', 1)[0] || cards(db, '1', [], 'want DESC, have DESC, e.id', 1)[0] || null;
    const recent = cards(db, '1', [], 'e.id DESC', 12);
    const labels = db.prepare(`SELECT l.id, l.name, l.country, count(e.id) n FROM labels l JOIN editions e ON e.label_id = l.id AND e.merged_into IS NULL
      GROUP BY l.id ORDER BY n DESC LIMIT 12`).all();
    const lists = db.prepare(`SELECT l.id, l.title, u.username, (SELECT count(*) FROM list_items WHERE list_id = l.id) n FROM lists l
      JOIN users u ON u.id = l.user_id WHERE l.public = 1 AND EXISTS (SELECT 1 FROM list_items WHERE list_id = l.id) ORDER BY l.updated_at DESC LIMIT 6`).all();
    return { stats, featured, recent, labels, lists };
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

  r.get('/api/barcode/:code', ({ params }) => {
    const code = params.code.replace(/\D/g, '');
    if (code.length < 8) fail(400, 'A barcode is 8 to 14 digits.');
    // UPC-A (12) and EAN-13 with a leading zero are the same code.
    const alt = code.length === 12 ? '0' + code : code.length === 13 && code.startsWith('0') ? code.slice(1) : code;
    return { code, items: cards(db, 'e.barcode IN (?, ?)', [code, alt], 'e.id', 20) };
  });

  r.get('/api/films', ({ query }) => {
    const q = (query.get('q') || '').trim();
    if (q.length < 2) return { items: [] };
    const rows = db.prepare(`SELECT f.id, f.title, f.year, f.country, (SELECT count(*) FROM editions WHERE film_id = f.id AND merged_into IS NULL) editions
      FROM films f WHERE f.title LIKE ? OR f.original_title LIKE ? ORDER BY f.title COLLATE NOCASE LIMIT 12`).all(`%${q}%`, `%${q}%`);
    return { items: rows.map((f) => ({ ...f, directors: getFilmRow(db, f.id).directors })) };
  });

  r.get('/api/films/:id', ({ params }) => {
    const film = getFilmRow(db, +params.id);
    const editions = cards(db, 'e.film_id = ?', [film.id], 'e.release_year, e.id', 100);
    const revisions = db.prepare("SELECT count(*) n FROM revisions WHERE entity = 'film' AND entity_id = ?").get(film.id).n;
    return { film, editions, revisions };
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
  async function tmdb(pathname, params = {}) {
    if (!tmdbKey) fail(501, 'Film lookup is off. Set TMDB_API_KEY on the server to turn it on.');
    const u = new URL('https://api.themoviedb.org/3' + pathname);
    for (const [k, val] of Object.entries(params)) u.searchParams.set(k, val);
    const headers = { accept: 'application/json' };
    if (tmdbKey.length > 40) headers.authorization = 'Bearer ' + tmdbKey; else u.searchParams.set('api_key', tmdbKey);
    let res;
    try { res = await fetch(u, { headers, signal: AbortSignal.timeout(8000) }); } catch { fail(502, 'Could not reach TMDB. Try again shortly.'); }
    if (!res.ok) fail(502, `TMDB answered ${res.status}.`);
    return res.json();
  }

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
    const m = await tmdb(`/movie/${+params.id}`, { append_to_response: 'credits' });
    const existing = db.prepare('SELECT id FROM films WHERE tmdb_id = ?').get(m.id);
    return {
      existing_film_id: existing ? existing.id : null,
      film: {
        tmdb_id: m.id, title: m.title, original_title: m.original_title !== m.title ? m.original_title : '',
        year: m.release_date ? +m.release_date.slice(0, 4) : null,
        country: m.production_countries?.[0]?.name || '',
        language: m.spoken_languages?.find((l) => l.iso_639_1 === m.original_language)?.english_name || m.spoken_languages?.[0]?.english_name || '',
        runtime: m.runtime || null, aspect: '', synopsis: m.overview || '',
        directors: (m.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.name)
      }
    };
  });
}
