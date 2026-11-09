// Import a Letterboxd data export (the zip from letterboxd.com/settings/data) into a member's diary.
import zlib from 'node:zlib';
import { parseCsv } from './csv.js';
import { matchTitle, createBareFilm } from './viewing.js';
import { tx } from './db.js';

/* ---------- a small zip reader: enough for Letterboxd's export (stored or deflated entries) ---------- */
export function readZip(buf) {
  const files = {};
  // Find the end-of-central-directory record.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('That file is not a zip archive.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || usize > 50e6) continue;
    const lnameLen = buf.readUInt16LE(localOff + 26), lextraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lnameLen + lextraLen;
    const data = buf.slice(start, start + csize);
    if (method === 0) files[name] = data;
    else if (method === 8) files[name] = zlib.inflateRawSync(data);
  }
  return files;
}

const col = (head) => (row, name) => { const i = head.indexOf(name.toLowerCase()); return i >= 0 ? (row[i] || '').trim() : ''; };
function table(text) {
  if (!text) return [];
  const rows = parseCsv(text.toString('utf8'));
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase()), get = col(head);
  return rows.slice(1).map((r) => ({ get: (n) => get(r, n) }));
}
const key = (name, year) => `${name.trim().toLowerCase()}|${year || ''}`;
const toRating = (s) => { const n = parseFloat(s); return n > 0 ? Math.round(n * 2) : null; };

/**
 * files: { 'diary.csv': Buffer, 'watched.csv': Buffer, 'ratings.csv', 'reviews.csv', 'watchlist.csv', 'likes/films.csv' } (any subset).
 * Returns the plan: per film, what would be created. commit=true writes it.
 */
export function importLetterboxd(db, userId, files, { commit = false } = {}) {
  const pick = (n) => { const k = Object.keys(files).find((f) => f === n || f.endsWith('/' + n)); return k ? table(files[k]) : []; };
  const diary = pick('diary.csv'), watched = pick('watched.csv'), ratings = pick('ratings.csv'), reviews = pick('reviews.csv'), watchlist = pick('watchlist.csv'), likes = pick('likes/films.csv').length ? pick('likes/films.csv') : pick('films.csv');
  if (!diary.length && !watched.length && !ratings.length && !watchlist.length) throw new Error('No Letterboxd files found. Upload the whole export zip, or diary.csv / watched.csv from it.');

  // Films referenced anywhere, keyed by name + year.
  const films = new Map();
  const touch = (r) => { const name = r.get('Name'), year = +r.get('Year') || null; if (!name) return null; const k = key(name, year); if (!films.has(k)) films.set(k, { name, year, watches: [], rating: null, liked: false, watchlist: false }); return films.get(k); };
  const reviewBy = new Map();
  for (const r of reviews) { const f = touch(r); if (f) reviewBy.set(`${key(f.name, f.year)}|${r.get('Watched Date')}`, r); }
  for (const r of diary) {
    const f = touch(r); if (!f) continue;
    const date = r.get('Watched Date') || r.get('Date');
    const rv = reviewBy.get(`${key(f.name, f.year)}|${date}`);
    f.watches.push({ date, rating: toRating(r.get('Rating')), rewatch: /yes/i.test(r.get('Rewatch')), review: rv ? rv.get('Review') : '' });
  }
  // Reviews without a diary row (older exports): add as entries.
  for (const [k, r] of reviewBy) { const f = films.get(k.split('|').slice(0, 2).join('|')); if (f && !f.watches.some((w) => w.date === r.get('Watched Date'))) f.watches.push({ date: r.get('Watched Date'), rating: toRating(r.get('Rating')), rewatch: /yes/i.test(r.get('Rewatch')), review: r.get('Review') }); }
  for (const r of ratings) { const f = touch(r); if (f) f.rating = toRating(r.get('Rating')); }
  for (const r of watched) { const f = touch(r); if (f && !f.watches.length) f.watches.push({ date: '', rating: null, rewatch: false, review: '' }); }
  for (const r of ratings) { const f = touch(r); if (f && !f.watches.length) f.watches.push({ date: '', rating: f.rating, rewatch: false, review: '' }); }
  for (const r of likes) { const f = touch(r); if (f) f.liked = true; }
  for (const r of watchlist) { const f = touch(r); if (f) f.watchlist = true; }
  // A film rated but with undated/unrated watches: put the rating on the latest watch.
  for (const f of films.values()) if (f.rating && f.watches.length && !f.watches.some((w) => w.rating)) f.watches.sort((a, b) => (a.date > b.date ? -1 : 1))[0].rating = f.rating;

  const plan = { films: films.size, matched: 0, created: 0, watches: 0, reviews: 0, likes: 0, watchlist: 0, skipped: 0, sample: [] };
  const run = () => {
    for (const f of films.values()) {
      const m = matchTitle(db, f.name, f.year);
      let filmId = m.match?.id || null;
      if (filmId) plan.matched++;
      else if (commit) { filmId = createBareFilm(db, { title: f.name, year: f.year }); plan.created++; }
      else { plan.created++; if (plan.sample.length < 8) plan.sample.push(`${f.name} (${f.year || '?'})`); }
      if (f.watchlist) { plan.watchlist++; if (commit && !db.prepare('SELECT 1 FROM watches WHERE user_id = ? AND film_id = ?').get(userId, filmId) && !f.watches.length) db.prepare('INSERT OR IGNORE INTO watchlist (user_id, film_id) VALUES (?, ?)').run(userId, filmId); }
      if (f.liked) { plan.likes++; if (commit) db.prepare('INSERT OR IGNORE INTO likes (user_id, film_id) VALUES (?, ?)').run(userId, filmId); }
      f.watches.sort((a, b) => (a.date < b.date ? -1 : 1));
      f.watches.forEach((w, i) => {
        if (commit && db.prepare("SELECT 1 FROM watches WHERE user_id = ? AND film_id = ? AND watched_on = ? AND source = 'import:letterboxd'").get(userId, filmId, w.date || '')) { plan.skipped++; return; }
        plan.watches++; if (w.review) plan.reviews++;
        if (commit) db.prepare(`INSERT INTO watches (user_id, film_id, watched_on, via, rewatch, rating, liked, review, source, prompt_state) VALUES (?, ?, ?, '', ?, ?, ?, ?, 'import:letterboxd', 'none')`)
          .run(userId, filmId, w.date || '', w.rewatch || i > 0 ? 1 : 0, w.rating, f.liked && i === f.watches.length - 1 ? 1 : 0, w.review || '');
      });
    }
  };
  if (commit) tx(db, run); else run();
  return plan;
}
