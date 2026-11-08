// Domain logic for the catalogue: validation, reads, applying moderated submissions.
import { tx, v } from './db.js';
import { fail } from './errors.js';

/* ---------- validation ---------- */
const str = (max) => (x, name) => {
  if (x == null) return '';
  if (typeof x !== 'string' && typeof x !== 'number') fail(400, `${name} must be text.`);
  const s = String(x).trim();
  if (s.length > max) fail(400, `${name} can be at most ${max} characters.`);
  return s;
};
const int = (min, max) => (x, name) => {
  if (x === '' || x == null) return null;
  const n = Number(x);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `${name} must be a whole number from ${min} to ${max}.`);
  return n;
};
const bool = (x) => (x === '' || x == null ? null : x === true || x === 1 || x === '1' || x === 'true' ? 1 : 0);
const oneOf = (opts) => (x, name) => {
  const s = x == null ? '' : String(x);
  if (!opts.includes(s)) fail(400, `${name} must be one of: ${opts.filter(Boolean).join(', ')}.`);
  return s;
};
const pattern = (re, msg) => (x, name) => {
  const s = x == null ? '' : String(x).trim().replace(/\s+/g, '');
  if (s && !re.test(s)) fail(400, `${name}: ${msg}`);
  return s;
};
const strList = (maxItems, maxLen) => (x, name) => {
  if (x == null || x === '') return [];
  const arr = Array.isArray(x) ? x : String(x).split('\n');
  const out = arr.map((s) => String(s).trim()).filter(Boolean);
  if (out.length > maxItems) fail(400, `${name} can have at most ${maxItems} entries.`);
  out.forEach((s) => { if (s.length > maxLen) fail(400, `Each ${name} entry can be at most ${maxLen} characters.`); });
  return out;
};

export const EDITION_FIELDS = {
  cat_no: str(40),
  spine_no: int(0, 99999),
  region: pattern(/^(0|[1-8](,[1-8])*)$/, 'use 0 for region-free, or region numbers like 2 or 2,4.'),
  standard: oneOf(['', 'PAL', 'NTSC']),
  anamorphic: bool,
  release_year: int(1995, 2100),
  discs: int(1, 50),
  disc_type: oneOf(['', 'DVD-5', 'DVD-9', 'DVD-10', 'DVD-18']),
  packaging: str(60),
  barcode: pattern(/^\d{8,14}$/, 'a barcode is 8 to 14 digits.'),
  oop: bool,
  audio: str(300),
  subtitles: str(300),
  extras: strList(80, 300),
  notes: str(3000)
};
export const FILM_FIELDS = {
  title: str(200),
  original_title: str(200),
  year: int(1888, 2100),
  country: str(80),
  language: str(80),
  runtime: int(1, 2000),
  aspect: pattern(/^\d\.\d{2}:1$/, 'write aspect ratios like 1.37:1 or 2.35:1.'),
  synopsis: str(3000),
  tmdb_id: int(1, 1e9),
  directors: strList(12, 100)
};
export const LABEL_FIELDS = { name: str(100), country: str(60), website: str(200), about: str(2000) };

function clean(spec, input, { partial }) {
  if (!input || typeof input !== 'object') fail(400, 'Missing details.');
  const out = {};
  for (const [k, fn] of Object.entries(spec)) {
    if (partial && !(k in input)) continue;
    out[k] = fn(input[k], k.replace(/_/g, ' '));
  }
  return out;
}

export function cleanFilm(input, partial = false) {
  const f = clean(FILM_FIELDS, input, { partial });
  if (!partial || 'title' in f) if (!f.title) fail(400, 'A film needs a title.');
  return f;
}
export function cleanEdition(input, partial = false) {
  const e = clean(EDITION_FIELDS, input, { partial });
  if (!partial && !e.discs) e.discs = 1;
  if ('label_name' in input) e.label_name = str(100)(input.label_name, 'label');
  if (partial && 'discs' in e && e.discs == null) delete e.discs;
  if ('oop' in e && e.oop == null) e.oop = 0;
  return e;
}
export function cleanLabel(input, partial = false) {
  const l = clean(LABEL_FIELDS, input, { partial });
  if ((!partial || 'name' in l) && !l.name) fail(400, 'A label needs a name.');
  return l;
}

// UPC-A (12 digits) and the same code written as EAN-13 with a leading zero are one barcode.
export const barcodeAlt = (c) => (c.length === 12 ? '0' + c : c.length === 13 && c.startsWith('0') ? c.slice(1) : c);

/* ---------- palette for generated covers ---------- */
export function paletteFor(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h >>>= 0;
  const hue = h % 360, shift = 30 + (h >> 9) % 150, light = (h >> 4) % 4 === 0;
  return light
    ? [`hsl(${hue} 22% 88%)`, `hsl(${hue} 20% 12%)`, `hsl(${(hue + shift) % 360} 62% 46%)`]
    : [`hsl(${hue} 34% 17%)`, `hsl(${hue} 30% 89%)`, `hsl(${(hue + shift) % 360} 58% 56%)`];
}

/* ---------- reads ---------- */
export function attachDirectors(db, rows, key = 'film_id') {
  const ids = [...new Set(rows.map((r) => r[key]))];
  if (!ids.length) return rows;
  const dirs = db.prepare(`SELECT fd.film_id, p.id, p.name FROM film_directors fd JOIN people p ON p.id = fd.person_id
    WHERE fd.film_id IN (${ids.map(() => '?').join(',')}) ORDER BY fd.position`).all(...ids);
  const by = {};
  for (const d of dirs) (by[d.film_id] ||= []).push({ id: d.id, name: d.name });
  for (const r of rows) r.directors = by[r[key]] || [];
  return rows;
}

const CARD_SQL = `SELECT e.id, e.cat_no, e.spine_no, e.region, e.standard, e.oop, e.discs, e.release_year, e.packaging, e.anamorphic,
  f.id AS film_id, f.title, f.year, f.country, f.palette, f.aspect,
  l.id AS label_id, l.name AS label,
  (SELECT file FROM images WHERE id = e.cover_image_id) AS cover,
  (SELECT count(DISTINCT user_id) FROM copies WHERE edition_id = e.id) AS have,
  (SELECT count(*) FROM wants WHERE edition_id = e.id) AS want,
  (SELECT round(avg(rating), 2) FROM reviews WHERE edition_id = e.id) AS rating,
  (SELECT json_array_length(e.extras)) AS extras_count
  FROM editions e JOIN films f ON f.id = e.film_id LEFT JOIN labels l ON l.id = e.label_id`;

export function cards(db, where = '1', params = [], order = 'f.title COLLATE NOCASE', limit = 48, offset = 0) {
  const rows = db.prepare(`${CARD_SQL} WHERE e.merged_into IS NULL AND (${where}) ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset).map(card);
  return attachDirectors(db, rows);
}

function card(r) {
  return { ...r, oop: !!r.oop, palette: r.palette ? JSON.parse(r.palette) : paletteFor(r.title) };
}

function ftsPhrase(q) { return '"' + q.replace(/"/g, '""') + '"'; }
function trigramsOr(q) {
  const s = q.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
  const grams = new Set();
  for (const w of s.split(' ')) for (let i = 0; i + 3 <= w.length; i++) grams.add(w.slice(i, i + 3));
  return [...grams].map(ftsPhrase).join(' OR ');
}

const SORTS = {
  title: 'f.title COLLATE NOCASE, e.release_year',
  year: 'f.year, f.title COLLATE NOCASE',
  want: 'want DESC, f.title COLLATE NOCASE',
  have: 'have DESC, f.title COLLATE NOCASE',
  recent: 'e.id DESC',
  spine: 'e.spine_no IS NULL, e.spine_no, e.release_year'
};

export function searchEditions(db, query) {
  const where = [], params = [];
  const q = (query.get('q') || '').trim();
  let order = SORTS[query.get('sort')] || SORTS.title;
  let fuzzy = false;
  if (q) {
    if (/^\d{8,14}$/.test(q.replace(/\s/g, ''))) {
      where.push('e.barcode = ?'); params.push(q.replace(/\s/g, ''));
    } else if (q.length >= 3) {
      where.push('e.id IN (SELECT edition_id FROM search_index WHERE search_index MATCH ?)'); params.push(ftsPhrase(q));
    } else {
      where.push('(f.title LIKE ? OR f.original_title LIKE ?)'); params.push(q + '%', q + '%');
    }
  }
  const region = query.get('region');
  if (region) { where.push("(',' || e.region || ',') LIKE ?"); params.push('%,' + region + ',%'); }
  if (query.get('standard')) { where.push('e.standard = ?'); params.push(query.get('standard')); }
  if (query.get('label')) { where.push('e.label_id = ?'); params.push(+query.get('label')); }
  if (query.get('decade')) { where.push('f.year >= ? AND f.year < ?'); params.push(+query.get('decade'), +query.get('decade') + 10); }
  if (query.get('oop') === '1') where.push('e.oop = 1');
  const limit = Math.min(+query.get('limit') || 48, 100);
  const page = Math.max(+query.get('page') || 1, 1);
  const w = where.join(' AND ') || '1';
  let items = cards(db, w, params, order, limit, (page - 1) * limit);
  let total = db.prepare(`SELECT count(*) n FROM editions e JOIN films f ON f.id = e.film_id WHERE e.merged_into IS NULL AND (${w})`).get(...params).n;
  // Nothing matched exactly: retry as a fuzzy trigram search so small typos still find the film.
  if (!total && q.length >= 4 && !/^\d+$/.test(q)) {
    const ors = trigramsOr(q);
    if (ors) {
      const fw = where.slice(1).concat('e.id IN (SELECT edition_id FROM search_index WHERE search_index MATCH ? ORDER BY rank LIMIT 60)');
      const fp = [...params.slice(1), ors];
      items = cards(db, fw.join(' AND '), fp, order, limit, 0);
      total = items.length;
      fuzzy = true;
    }
  }
  return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)), fuzzy };
}

export function reindex(db, editionId) {
  db.prepare('DELETE FROM search_index WHERE edition_id = ?').run(editionId);
  const e = db.prepare(`SELECT e.*, f.title, f.original_title, f.year, f.country, l.name AS label FROM editions e
    JOIN films f ON f.id = e.film_id LEFT JOIN labels l ON l.id = e.label_id WHERE e.id = ?`).get(editionId);
  if (!e || e.merged_into) return;
  const dirs = db.prepare('SELECT p.name FROM film_directors fd JOIN people p ON p.id = fd.person_id WHERE fd.film_id = ?').all(e.film_id).map((d) => d.name);
  const body = [e.title, e.original_title, dirs.join(' '), e.label, e.cat_no, e.year, e.country, e.barcode].filter(Boolean).join(' · ');
  db.prepare('INSERT INTO search_index (edition_id, body) VALUES (?, ?)').run(editionId, body);
}

export function getEdition(db, id, user) {
  const e = db.prepare('SELECT * FROM editions WHERE id = ?').get(id);
  if (!e) fail(404, 'That edition is not on the register.');
  if (e.merged_into) return { redirect: e.merged_into };
  const film = getFilmRow(db, e.film_id);
  const label = e.label_id ? db.prepare('SELECT * FROM labels WHERE id = ?').get(e.label_id) : null;
  const images = db.prepare(`SELECT i.id, i.file, i.kind, i.w, i.h, i.created_at, u.username FROM images i
    LEFT JOIN users u ON u.id = i.user_id WHERE edition_id = ? ORDER BY (i.id = ?) DESC, i.id`).all(id, e.cover_image_id ?? -1);
  const stats = db.prepare(`SELECT
    (SELECT count(DISTINCT user_id) FROM copies WHERE edition_id = ?) AS have,
    (SELECT count(*) FROM wants WHERE edition_id = ?) AS want,
    (SELECT round(avg(rating), 2) FROM reviews WHERE edition_id = ?) AS rating,
    (SELECT count(*) FROM reviews WHERE edition_id = ?) AS votes`).get(id, id, id, id);
  const reviews = db.prepare(`SELECT r.id, r.rating, r.body, r.created_at, r.updated_at, u.username FROM reviews r
    JOIN users u ON u.id = r.user_id WHERE r.edition_id = ? ORDER BY r.updated_at DESC LIMIT 50`).all(id);
  const siblings = cards(db, 'e.film_id = ?', [e.film_id], 'e.release_year, e.id', 50);
  const lists = db.prepare(`SELECT l.id, l.title, u.username FROM list_items li JOIN lists l ON l.id = li.list_id
    JOIN users u ON u.id = l.user_id WHERE li.edition_id = ? AND l.public = 1 ORDER BY l.updated_at DESC LIMIT 8`).all(id);
  const revisions = db.prepare("SELECT count(*) n FROM revisions WHERE entity = 'edition' AND entity_id = ?").get(id).n;
  const pending = db.prepare("SELECT count(*) n FROM submissions WHERE status = 'pending' AND kind = 'edition_edit' AND target_id = ?").get(id).n;
  let mine = null;
  if (user) {
    mine = {
      copies: db.prepare('SELECT * FROM copies WHERE user_id = ? AND edition_id = ? ORDER BY id').all(user.id, id),
      want: !!db.prepare('SELECT 1 FROM wants WHERE user_id = ? AND edition_id = ?').get(user.id, id),
      review: db.prepare('SELECT rating, body FROM reviews WHERE user_id = ? AND edition_id = ?').get(user.id, id) || null,
      lists: db.prepare(`SELECT l.id, l.title, EXISTS(SELECT 1 FROM list_items WHERE list_id = l.id AND edition_id = ?) AS has
        FROM lists l WHERE l.user_id = ? ORDER BY l.updated_at DESC`).all(id, user.id).map((l) => ({ ...l, has: !!l.has }))
    };
  }
  const cover = images.find((i) => i.id === e.cover_image_id);
  return {
    edition: { ...e, extras: JSON.parse(e.extras), oop: !!e.oop, anamorphic: e.anamorphic == null ? null : !!e.anamorphic, cover: cover ? cover.file : null },
    film, label, images, stats, reviews, siblings, lists, revisions, pending, mine
  };
}

export function getFilmRow(db, id) {
  const f = db.prepare('SELECT * FROM films WHERE id = ?').get(id);
  if (!f) fail(404, 'That film is not on the register.');
  const directors = db.prepare('SELECT p.id, p.name FROM film_directors fd JOIN people p ON p.id = fd.person_id WHERE fd.film_id = ? ORDER BY fd.position').all(id);
  return { ...f, palette: f.palette ? JSON.parse(f.palette) : paletteFor(f.title), directors };
}

export function editionMeta(db, id) {
  try {
    const r = db.prepare(`SELECT f.title, f.year, l.name AS label, e.cat_no, e.region, e.standard,
      (SELECT file FROM images WHERE id = e.cover_image_id) AS image FROM editions e JOIN films f ON f.id = e.film_id
      LEFT JOIN labels l ON l.id = e.label_id WHERE e.id = ?`).get(id);
    if (!r) return null;
    return {
      title: `${r.title} (${r.year ?? ''}) – ${r.label || 'DVD'}`,
      description: `${r.label || 'DVD'} ${r.cat_no} · Region ${r.region || '?'} ${r.standard}. Specs, supplements and collector notes on Spine.`,
      image: r.image
    };
  } catch { return null; }
}

/* ---------- writes ---------- */
function setDirectors(db, filmId, names) {
  db.prepare('DELETE FROM film_directors WHERE film_id = ?').run(filmId);
  names.forEach((name, i) => {
    db.prepare('INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(name);
    const p = db.prepare('SELECT id FROM people WHERE name = ?').get(name);
    db.prepare('INSERT OR IGNORE INTO film_directors (film_id, person_id, position) VALUES (?, ?, ?)').run(filmId, p.id, i);
  });
}

function labelId(db, name) {
  if (!name) return null;
  db.prepare('INSERT INTO labels (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(name);
  return db.prepare('SELECT id FROM labels WHERE name = ?').get(name).id;
}

function revision(db, entity, entityId, userId, subId, summary, before, after) {
  db.prepare('INSERT INTO revisions (entity, entity_id, user_id, submission_id, summary, before, after) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(entity, entityId, v(userId), v(subId), summary, JSON.stringify(before), JSON.stringify(after));
}

export function notify(db, userId, text, link = '') {
  db.prepare('INSERT INTO notifications (user_id, text, link) VALUES (?, ?, ?)').run(userId, text, link);
}

function findOrCreateFilm(db, input) {
  if (input.film_id) {
    const f = db.prepare('SELECT id FROM films WHERE id = ?').get(+input.film_id);
    if (!f) fail(400, 'That film is not on the register.');
    return { id: f.id, created: false };
  }
  const f = cleanFilm(input.film || {});
  const existing = (f.tmdb_id && db.prepare('SELECT id FROM films WHERE tmdb_id = ?').get(f.tmdb_id))
    || db.prepare('SELECT id FROM films WHERE title = ? COLLATE NOCASE AND year IS ?').get(f.title, f.year);
  if (existing) return { id: existing.id, created: false };
  const { lastInsertRowid } = db.prepare(`INSERT INTO films (title, original_title, year, country, language, runtime, aspect, synopsis, tmdb_id, palette)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(f.title, f.original_title, v(f.year), f.country, f.language, v(f.runtime), f.aspect, f.synopsis, v(f.tmdb_id), JSON.stringify(paletteFor(f.title + f.year)));
  setDirectors(db, Number(lastInsertRowid), f.directors);
  return { id: Number(lastInsertRowid), created: true };
}

const EDITION_COLS = Object.keys(EDITION_FIELDS);

export function validateSubmission(kind, targetId, payload, db) {
  if (kind === 'edition') {
    if (!payload.film_id && !payload.film) fail(400, 'Choose the film this edition is of, or describe a new one.');
    if (payload.film && !payload.film_id) cleanFilm(payload.film);
    const e = cleanEdition(payload);
    if (!e.label_name) fail(400, 'Which label released this edition?');
    if (!e.region) fail(400, 'Add the region printed on the case (0 for region-free).');
    if (e.barcode) {
      const dupe = db.prepare('SELECT id FROM editions WHERE barcode IN (?, ?) AND merged_into IS NULL').get(e.barcode, barcodeAlt(e.barcode));
      if (dupe) fail(409, `An edition with barcode ${e.barcode} is already on the register (#${dupe.id}).`);
    }
    return;
  }
  if (!targetId) fail(400, 'Which entry are you editing?');
  const changes = payload.changes;
  if (!changes || !Object.keys(changes).length) fail(400, 'There are no changes to submit.');
  if (kind === 'edition_edit') { if (!db.prepare('SELECT 1 FROM editions WHERE id = ?').get(targetId)) fail(404, 'No such edition.'); cleanEdition(changes, true); }
  else if (kind === 'film_edit') { if (!db.prepare('SELECT 1 FROM films WHERE id = ?').get(targetId)) fail(404, 'No such film.'); cleanFilm(changes, true); }
  else if (kind === 'label_edit') { if (!db.prepare('SELECT 1 FROM labels WHERE id = ?').get(targetId)) fail(404, 'No such label.'); cleanLabel(changes, true); }
  else fail(400, 'Unknown kind of submission.');
}

// Applies a submission to the catalogue. Returns the id of the affected entry.
export function applySubmission(db, sub, actorId) {
  const payload = JSON.parse(sub.payload);
  const by = sub.user_id;
  if (sub.kind === 'edition') {
    const film = findOrCreateFilm(db, payload);
    const e = cleanEdition(payload);
    const lid = labelId(db, e.label_name);
    const { lastInsertRowid } = db.prepare(`INSERT INTO editions (film_id, label_id, ${EDITION_COLS.join(', ')}, created_by)
      VALUES (?, ?, ${EDITION_COLS.map(() => '?').join(', ')}, ?)`)
      .run(film.id, lid, ...EDITION_COLS.map((k) => v(k === 'extras' ? JSON.stringify(e[k]) : e[k])), v(by));
    const id = Number(lastInsertRowid);
    reindex(db, id);
    revision(db, 'edition', id, by, sub.id, 'Added to the register', {}, { ...e, film_id: film.id });
    // The contributor said they own it (often straight from a scan): put it on their shelf.
    if (payload.add_to_shelf && by && db.prepare('SELECT 1 FROM users WHERE id = ?').get(by)) {
      db.prepare('INSERT INTO copies (user_id, edition_id) VALUES (?, ?)').run(by, id);
      db.prepare('DELETE FROM wants WHERE user_id = ? AND edition_id = ?').run(by, id);
    }
    // Tell people who own or want another edition of this film.
    const title = db.prepare('SELECT title FROM films WHERE id = ?').get(film.id).title;
    const fans = db.prepare(`SELECT DISTINCT user_id FROM (
        SELECT c.user_id FROM copies c JOIN editions x ON x.id = c.edition_id WHERE x.film_id = ? AND x.id != ?
        UNION SELECT w.user_id FROM wants w JOIN editions x ON x.id = w.edition_id WHERE x.film_id = ? AND x.id != ?)
      WHERE user_id IS NOT ?`).all(film.id, id, film.id, id, v(by));
    for (const f of fans) notify(db, f.user_id, `New edition of ${title}: ${e.label_name}${e.cat_no ? ' ' + e.cat_no : ''}, Region ${e.region}.`, `/release/${id}`);
    return id;
  }
  if (sub.kind === 'edition_edit') {
    const cur = db.prepare('SELECT * FROM editions WHERE id = ?').get(sub.target_id);
    if (!cur) fail(404, 'That edition no longer exists.');
    const ch = cleanEdition(payload.changes, true);
    const before = {}, after = {};
    if ('label_name' in ch) {
      const lid = labelId(db, ch.label_name);
      if (lid !== cur.label_id) { before.label_id = cur.label_id; after.label_id = lid; }
      delete ch.label_name;
    }
    for (const [k, val] of Object.entries(ch)) {
      const stored = k === 'extras' ? JSON.stringify(val) : val;
      if (String(cur[k] ?? '') !== String(stored ?? '')) { before[k] = k === 'extras' ? JSON.parse(cur[k]) : cur[k]; after[k] = val; }
    }
    if (!Object.keys(after).length) return cur.id;
    const sets = Object.keys(after).map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE editions SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
      .run(...Object.keys(after).map((k) => v(k === 'extras' ? JSON.stringify(after[k]) : after[k])), cur.id);
    reindex(db, cur.id);
    revision(db, 'edition', cur.id, by, sub.id, payload.summary || 'Edited details', before, after);
    return cur.id;
  }
  if (sub.kind === 'film_edit') {
    const cur = getFilmRow(db, sub.target_id);
    const ch = cleanFilm(payload.changes, true);
    const before = {}, after = {};
    if (ch.directors) {
      const old = cur.directors.map((d) => d.name);
      if (old.join('|') !== ch.directors.join('|')) { before.directors = old; after.directors = ch.directors; setDirectors(db, cur.id, ch.directors); }
      delete ch.directors;
    }
    for (const [k, val] of Object.entries(ch)) if (String(cur[k] ?? '') !== String(val ?? '')) { before[k] = cur[k]; after[k] = val; }
    const cols = Object.keys(after).filter((k) => k !== 'directors');
    if (cols.length) db.prepare(`UPDATE films SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((k) => v(after[k])), cur.id);
    for (const e of db.prepare('SELECT id FROM editions WHERE film_id = ?').all(cur.id)) reindex(db, e.id);
    if (Object.keys(after).length) revision(db, 'film', cur.id, by, sub.id, payload.summary || 'Edited film details', before, after);
    return cur.id;
  }
  if (sub.kind === 'label_edit') {
    const cur = db.prepare('SELECT * FROM labels WHERE id = ?').get(sub.target_id);
    if (!cur) fail(404, 'That label no longer exists.');
    const ch = cleanLabel(payload.changes, true);
    const before = {}, after = {};
    for (const [k, val] of Object.entries(ch)) if (String(cur[k] ?? '') !== String(val ?? '')) { before[k] = cur[k]; after[k] = val; }
    const cols = Object.keys(after);
    if (cols.length) {
      db.prepare(`UPDATE labels SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((k) => after[k]), cur.id);
      for (const e of db.prepare('SELECT id FROM editions WHERE label_id = ?').all(cur.id)) reindex(db, e.id);
      revision(db, 'label', cur.id, by, sub.id, payload.summary || 'Edited label details', before, after);
    }
    return cur.id;
  }
  fail(400, 'Unknown kind of submission.');
}

export function mergeEditions(db, fromId, intoId, actorId) {
  if (fromId === intoId) fail(400, 'Choose two different editions.');
  const a = db.prepare('SELECT * FROM editions WHERE id = ?').get(fromId);
  const b = db.prepare('SELECT * FROM editions WHERE id = ?').get(intoId);
  if (!a || !b || a.merged_into || b.merged_into) fail(404, 'Both editions must exist and not already be merged.');
  tx(db, () => {
    db.prepare('UPDATE copies SET edition_id = ? WHERE edition_id = ?').run(intoId, fromId);
    db.prepare('INSERT OR IGNORE INTO wants (user_id, edition_id, note, created_at) SELECT user_id, ?, note, created_at FROM wants WHERE edition_id = ?').run(intoId, fromId);
    db.prepare('DELETE FROM wants WHERE edition_id = ?').run(fromId);
    db.prepare('UPDATE reviews SET edition_id = ? WHERE edition_id = ? AND user_id NOT IN (SELECT user_id FROM reviews WHERE edition_id = ?)').run(intoId, fromId, intoId);
    db.prepare('DELETE FROM reviews WHERE edition_id = ?').run(fromId);
    db.prepare('INSERT OR IGNORE INTO list_items (list_id, edition_id, position, note) SELECT list_id, ?, position, note FROM list_items WHERE edition_id = ?').run(intoId, fromId);
    db.prepare('DELETE FROM list_items WHERE edition_id = ?').run(fromId);
    db.prepare('UPDATE images SET edition_id = ? WHERE edition_id = ?').run(intoId, fromId);
    if (!b.cover_image_id && a.cover_image_id) db.prepare('UPDATE editions SET cover_image_id = ? WHERE id = ?').run(a.cover_image_id, intoId);
    db.prepare('UPDATE editions SET merged_into = ?, cover_image_id = NULL WHERE id = ?').run(intoId, fromId);
    db.prepare('DELETE FROM search_index WHERE edition_id = ?').run(fromId);
    revision(db, 'edition', intoId, actorId, null, `Merged duplicate #${fromId} into this edition`, {}, { merged_from: fromId });
    revision(db, 'edition', fromId, actorId, null, `Merged into #${intoId}`, {}, { merged_into: intoId });
  });
}
