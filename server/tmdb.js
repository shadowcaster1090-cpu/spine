import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { similarity } from './viewing.js';

// The Movie Database: film details and posters. Needs TMDB_API_KEY (a v3 key or a v4 read token).
// This product uses the TMDB API but is not endorsed or certified by TMDB.

export const TMDB_IMG = 'https://image.tmdb.org/t/p/';

export function tmdbClient(key, { fetchImpl = fetch, base = process.env.TMDB_BASE || 'https://api.themoviedb.org/3' } = {}) {
  return {
    enabled: !!key,
    async get(pathname, params = {}) {
      if (!key) throw Object.assign(new Error('Film lookup is off. Set TMDB_API_KEY on the server to turn it on.'), { status: 501 });
      const u = new URL(base + pathname);
      for (const [k, val] of Object.entries(params)) if (val !== undefined && val !== null && val !== '') u.searchParams.set(k, val);
      const headers = { accept: 'application/json' };
      if (key.length > 40) headers.authorization = 'Bearer ' + key; else u.searchParams.set('api_key', key);
      let res;
      try { res = await fetchImpl(u, { headers, signal: AbortSignal.timeout(8000) }); } catch { throw Object.assign(new Error('Could not reach TMDB. Try again shortly.'), { status: 502 }); }
      if (!res.ok) throw Object.assign(new Error(`TMDB answered ${res.status}.`), { status: 502 });
      return res.json();
    }
  };
}

// A TMDB movie (with credits appended) as Spine's film fields.
export function normalizeMovie(m) {
  return {
    tmdb_id: m.id, title: m.title, original_title: m.original_title && m.original_title !== m.title ? m.original_title : '',
    year: m.release_date ? +m.release_date.slice(0, 4) : null,
    country: m.production_countries?.[0]?.name || '',
    language: m.spoken_languages?.find((l) => l.iso_639_1 === m.original_language)?.english_name || m.spoken_languages?.[0]?.english_name || '',
    runtime: m.runtime || null, aspect: '', synopsis: m.overview || '',
    directors: (m.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.name),
    poster_path: m.poster_path || '',
    backdrop_path: m.backdrop_path || ''
  };
}

export const movieDetails = async (tmdb, id) => normalizeMovie(await tmdb.get(`/movie/${+id}`, { append_to_response: 'credits' }));

// Best TMDB match for a title (and maybe a year). Returns null when nothing is close enough.
export async function matchMovie(tmdb, title, year, { minScore = .62 } = {}) {
  if (!tmdb.enabled || !title) return null;
  const tries = year ? [{ query: title, year }, { query: title }] : [{ query: title }];
  let best = null;
  for (const t of tries) {
    const data = await tmdb.get('/search/movie', { query: t.query, year: t.year, include_adult: 'false' });
    for (const m of (data.results || []).slice(0, 10)) {
      const my = m.release_date ? +m.release_date.slice(0, 4) : null;
      const sim = Math.max(similarity(title, m.title), similarity(title, m.original_title || ''));
      let score = sim;
      if (year && my) score += Math.abs(my - year) <= 1 ? .15 : Math.abs(my - year) <= 3 ? 0 : -.2;
      score += Math.min((m.vote_count || 0) / 5000, .08);   // a nudge towards the well-known film among near-identical titles
      if (!best || score > best.score) best = { score, sim, m };
    }
    if (best && best.score >= minScore + .1) break;
  }
  if (!best || best.score < minScore) return null;
  const m = best.m;
  return { tmdb_id: m.id, title: m.title, original_title: m.original_title, year: m.release_date ? +m.release_date.slice(0, 4) : null, poster_path: m.poster_path || '', score: +best.score.toFixed(2) };
}

/* ---------- images ---------- */
export const MAGIC = [
  { ext: '.jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.png', test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: '.webp', test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' }
];
export const sniffImage = (buf) => MAGIC.find((t) => t.test(buf)) || null;

// Downloads an image into the uploads folder. Returns the stored file name, or null when the URL
// did not give a usable image. Never throws: artwork is a nicety, not a reason to fail a save.
export async function fetchImageToUploads(url, uploadsDir, { fetchImpl = fetch, maxBytes = 6e6, timeout = 10000 } = {}) {
  try {
    if (!/^https?:\/\//i.test(String(url))) return null;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeout), headers: { accept: 'image/*', 'user-agent': 'Spine/1.0 (+https://github.com/shadowcaster1090-cpu/spine)' }, redirect: 'follow' });
    if (!res.ok) return null;
    const len = +res.headers.get('content-length') || 0;
    if (len > maxBytes) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > maxBytes) return null;
    const type = sniffImage(buf);
    if (!type) return null;
    const file = crypto.randomBytes(12).toString('hex') + type.ext;
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, file), buf);
    return file;
  } catch { return null; }
}

export const posterUrl = (posterPath, size = 'w500') => (posterPath ? (process.env.TMDB_IMG_BASE || TMDB_IMG) + size + posterPath : '');
