// Real posters for films, from TMDB. Runs on demand (admin tool) and in the background on the server,
// so films that arrive without artwork (Letterboxd and streaming imports, typed-in films) get their
// poster, credits and synopsis within minutes without anyone pressing anything.
import { v } from './db.js';
import { movieDetails, matchMovie, fetchImageToUploads, posterUrl } from './tmdb.js';
import { setDirectors, reindexFilm } from './catalogue.js';

const TRIED = '-';   // poster_path marker: looked on TMDB, found nothing (don't retry every pass)

export async function backfillPosters(db, tmdb, uploadsDir, { limit = 40, retryMisses = false } = {}) {
  if (!tmdb.enabled) return { done: 0, matched: 0, missed: [], remaining: 0, disabled: true };
  const rows = db.prepare(`SELECT id, title, year, tmdb_id, poster_path FROM films WHERE poster = '' ${retryMisses ? '' : "AND poster_path != '-'"} ORDER BY id LIMIT ?`).all(limit);
  let done = 0, matched = 0; const missed = [];
  for (const f of rows) {
    try {
      let details = null;
      if (f.tmdb_id) details = await movieDetails(tmdb, f.tmdb_id);
      else {
        const m = await matchMovie(tmdb, f.title, f.year);
        if (m) { details = await movieDetails(tmdb, m.tmdb_id); matched++; }
      }
      if (!details) { db.prepare("UPDATE films SET poster_path = ? WHERE id = ? AND poster_path = ''").run(TRIED, f.id); missed.push(f.title); continue; }
      const dup = db.prepare('SELECT id FROM films WHERE tmdb_id = ? AND id != ?').get(details.tmdb_id, f.id);
      const file = details.poster_path ? await fetchImageToUploads(posterUrl(details.poster_path, 'w780'), uploadsDir) : null;
      db.prepare(`UPDATE films SET poster = coalesce(?, poster), poster_path = ?, tmdb_id = coalesce(tmdb_id, ?),
          synopsis = CASE WHEN synopsis = '' THEN ? ELSE synopsis END, runtime = coalesce(runtime, ?),
          country = CASE WHEN country = '' THEN ? ELSE country END, language = CASE WHEN language = '' THEN ? ELSE language END,
          original_title = CASE WHEN original_title = '' THEN ? ELSE original_title END WHERE id = ?`)
        .run(file, details.poster_path || TRIED, dup ? null : details.tmdb_id, details.synopsis, v(details.runtime), details.country, details.language, details.original_title, f.id);
      if (!db.prepare('SELECT 1 FROM film_directors WHERE film_id = ?').get(f.id) && details.directors.length) { setDirectors(db, f.id, details.directors); reindexFilm(db, f.id); }
      done++;
    } catch (e) { missed.push(`${f.title} (${e.message})`); }
  }
  const remaining = db.prepare("SELECT count(*) n FROM films WHERE poster = '' AND poster_path != '-'").get().n;
  return { done, matched, missed, remaining };
}

// Background worker: a batch soon after boot, then a batch every few minutes while there is work.
export function startPosterWorker(db, tmdb, uploadsDir, { first = 20e3, every = 5 * 60e3, batch = 25, log = console.log } = {}) {
  if (!tmdb.enabled) return () => {};
  let timer = null, running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await backfillPosters(db, tmdb, uploadsDir, { limit: batch });
      if (r.done || r.missed.length) log(`posters: ${r.done} fetched, ${r.missed.length} unmatched, ${r.remaining} to go`);
      timer = setTimeout(tick, r.remaining ? 30e3 : every);
    } catch (e) { log('posters: ' + e.message); timer = setTimeout(tick, every); }
    running = false;
  };
  timer = setTimeout(tick, first);
  return () => clearTimeout(timer);
}
