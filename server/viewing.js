// Viewing-history files from streaming services, and matching their titles to films on the register.
import { parseCsv } from './csv.js';
import { reindexFilm, paletteFor } from './catalogue.js';

export const SERVICES = {
  netflix: {
    name: 'Netflix', kind: 'import',
    how: 'On netflix.com open Account → Profiles → your profile → Viewing activity, then choose “Download all” at the bottom. Netflix gives you a small CSV of everything that profile has watched.',
    url: 'https://www.netflix.com/viewingactivity'
  },
  prime: {
    name: 'Prime Video', kind: 'import',
    how: 'Amazon only releases watch history through “Request your data” (Account → Privacy → Request your information → Prime Video). It arrives by email, usually within a day or two, as a zip; import the PrimeVideo.ViewingHistory CSV from it.',
    url: 'https://www.amazon.co.uk/hz/privacy-central/data-requests/preview.html'
  },
  disney: { name: 'Disney+', kind: 'import', how: 'Disney+ has no history download. You can log Disney+ viewings by hand, or connect Trakt and let a Trakt scrobbler record them.' },
  apple: { name: 'Apple TV', kind: 'import', how: 'Apple TV has no history download. Log Apple TV viewings by hand, or connect Trakt.' },
  mubi: { name: 'MUBI', kind: 'import', how: 'MUBI has no history download yet. Log MUBI viewings by hand.' },
  trakt: {
    name: 'Trakt', kind: 'api',
    how: 'Trakt keeps a live record of what you watch. Its free browser extensions and apps (search “Trakt scrobbler”) notice when you play something on Netflix, Prime Video, Disney+ and others and send it to Trakt. Connect once and Spine pulls your history every time you open the app.',
    url: 'https://trakt.tv'
  }
};

/* ---------- title normalisation and similarity ---------- */
export function normTitle(t) {
  return String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
const stripArticle = (s) => s.replace(/^(the|a|an|le|la|les|el|los|las|il|der|die|das) /, '');
function bigrams(s) { const out = new Map(); const w = ' ' + s + ' '; for (let i = 0; i + 2 <= w.length; i++) { const g = w.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); } return out; }
export function similarity(a, b) {
  a = stripArticle(normTitle(a)); b = stripArticle(normTitle(b));
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, total = 0;
  for (const [g, n] of A) { total += n; if (B.has(g)) inter += Math.min(n, B.get(g)); }
  for (const n of B.values()) total += n;
  return total ? (2 * inter) / total : 0;
}

/* ---------- reading the files ---------- */
const TV = /:\s*(season|series|part|volume|chapter|book|collection|limited series|miniseries)\b|\b(episode|ep\.?)\s*\d|:\s*s\d{1,2}\s*e\d{1,3}\b/i;
const CLEAN = [/\s*[([](?:4k|uhd|hd|sd|ultra hd|4k uhd|hdr|dolby vision|dubbed|subbed|subtitled|english subtitles|director'?s cut|extended|theatrical|remastered|bonus|trailer)[^)\]]*[)\]]/gi, /\s*[-–:]\s*(trailer|teaser|bonus|recap|behind the scenes).*$/i];

function parseDate(s, order) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    let [a, b, y] = [+m[1], +m[2], m[3]];
    if (y.length === 2) y = '20' + y;
    let d, mo;
    if (order === 'mdy') { mo = a; d = b; } else { d = a; mo = b; }
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // whichever order was chosen, this can only be the other
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const t = Date.parse(s);
  return isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10);
}

function durationSeconds(s) {
  const m = String(s || '').match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
}

// Returns { rows: [{ title, date, kind }], skipped: { tv, previews, undated }, columns }
export function parseViewingHistory(text, { order = 'dmy' } = {}) {
  const table = parseCsv(text);
  if (table.length < 2) throw new Error('The file needs a header row and at least one viewing.');
  const head = table[0].map((h) => h.trim().toLowerCase());
  const find = (...names) => { for (const n of names) { const i = head.findIndex((h) => h === n); if (i >= 0) return i; } for (const n of names) { const i = head.findIndex((h) => h.includes(n)); if (i >= 0) return i; } return -1; };
  const iTitle = find('title', 'name');
  const iDate = find('date', 'start time', 'playback hour', 'watched', 'time');
  if (iTitle < 0) throw new Error('Couldn’t find a Title column. Export the viewing history file again and import that.');
  const iSupp = find('supplemental video type'), iAttr = find('attributes'), iDur = find('duration'), iKind = find('video type', 'content type');
  const skipped = { tv: 0, previews: 0, undated: 0 };
  const seen = new Set(), rows = [];
  for (const r of table.slice(1)) {
    let title = (r[iTitle] || '').trim();
    if (!title) continue;
    if (iSupp >= 0 && (r[iSupp] || '').trim()) { skipped.previews++; continue; }
    if (iAttr >= 0 && /autoplayed: user action: none/i.test(r[iAttr] || '')) { skipped.previews++; continue; }
    if (iDur >= 0) { const d = durationSeconds(r[iDur]); if (d != null && d < 300) { skipped.previews++; continue; } }
    if (iKind >= 0 && /episode|season|series|tv/i.test(r[iKind] || '') && !/movie|film/i.test(r[iKind] || '')) { skipped.tv++; continue; }
    if (TV.test(title)) { skipped.tv++; continue; }
    for (const re of CLEAN) title = title.replace(re, '');
    title = title.replace(/\s+/g, ' ').trim();
    const date = iDate >= 0 ? parseDate(r[iDate], order) : '';
    if (!date) { skipped.undated++; }
    const key = normTitle(title) + '|' + date;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ title, date });
  }
  return { rows, skipped, columns: { title: table[0][iTitle], date: iDate >= 0 ? table[0][iDate] : null } };
}

/* ---------- matching titles to films ---------- */
export function matchTitle(db, title, year = null) {
  const n = normTitle(title);
  const exact = db.prepare(`SELECT id, title, year FROM films WHERE lower(title) = ? OR lower(original_title) = ?`).all(n, n)
    .concat(db.prepare('SELECT id, title, year FROM films').all().filter((f) => normTitle(f.title) === n));
  const uniq = (arr) => arr.filter((f, i) => arr.findIndex((x) => x.id === f.id) === i);
  let cands = uniq(exact);
  if (cands.length === 1 && (!year || !cands[0].year || cands[0].year === year)) return { match: cands[0], confidence: 1, candidates: [] };
  if (cands.length > 1 && year) { const y = cands.filter((f) => f.year === year); if (y.length === 1) return { match: y[0], confidence: 1, candidates: [] }; }
  if (cands.length > 1) return { match: null, confidence: 0.9, candidates: cands.slice(0, 5) };
  // Fuzzy: trigram search, scored by bigram similarity.
  if (n.length >= 3) {
    const phrase = '"' + n.replace(/"/g, '""') + '"';
    let rows = db.prepare('SELECT f.id, f.title, f.year, f.original_title FROM films f WHERE f.id IN (SELECT film_id FROM film_index WHERE film_index MATCH ?) LIMIT 20').all(phrase);
    if (!rows.length) {
      const grams = new Set();
      for (const w of n.split(' ')) for (let i = 0; i + 3 <= w.length; i++) grams.add(w.slice(i, i + 3));
      const ors = [...grams].map((g) => '"' + g.replace(/"/g, '""') + '"').join(' OR ');
      if (ors) rows = db.prepare('SELECT f.id, f.title, f.year, f.original_title FROM films f WHERE f.id IN (SELECT film_id FROM film_index WHERE film_index MATCH ? ORDER BY rank LIMIT 20)').all(ors);
    }
    const scored = rows.map((f) => ({ ...f, score: Math.max(similarity(title, f.title), similarity(title, f.original_title)) })).sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best && best.score >= 0.92 && (!year || !best.year || Math.abs(best.year - year) <= 1) && (!scored[1] || scored[1].score < best.score - 0.1)) {
      return { match: { id: best.id, title: best.title, year: best.year }, confidence: best.score, candidates: [] };
    }
    return { match: null, confidence: best ? best.score : 0, candidates: scored.filter((f) => f.score >= 0.45).slice(0, 5).map(({ id, title: t, year: y, score }) => ({ id, title: t, year: y, score: Math.round(score * 100) / 100 })) };
  }
  return { match: null, confidence: 0, candidates: [] };
}

// A film the register doesn't have yet, created from an import with whatever is known.
export function createBareFilm(db, { title, year = null, tmdb_id = null }) {
  title = String(title || '').trim().slice(0, 200);
  if (!title) throw new Error('A film needs a title.');
  if (tmdb_id) { const f = db.prepare('SELECT id FROM films WHERE tmdb_id = ?').get(tmdb_id); if (f) return f.id; }
  const f = db.prepare('SELECT id FROM films WHERE lower(title) = lower(?) AND year IS ?').get(title, year);
  if (f) return f.id;
  const { lastInsertRowid } = db.prepare('INSERT INTO films (title, year, tmdb_id, palette) VALUES (?, ?, ?, ?)').run(title, year, tmdb_id, JSON.stringify(paletteFor(title + (year || ''))));
  reindexFilm(db, Number(lastInsertRowid));
  return Number(lastInsertRowid);
}
