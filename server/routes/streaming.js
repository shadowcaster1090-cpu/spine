// Streaming connections: viewing-history imports (Netflix, Prime Video and any CSV) and the Trakt API.
import crypto from 'node:crypto';
import { requireUser } from '../auth.js';
import { SERVICES, parseViewingHistory, matchTitle, createBareFilm, normTitle } from '../viewing.js';
import { watchRows, filmsById } from '../catalogue.js';
import { tx } from '../db.js';

const TRAKT_API = 'https://api.trakt.tv';
const oauthStates = new Map(); // state -> { userId, at }

export default function (r, { db, fail, rateLimit, traktId = process.env.TRAKT_CLIENT_ID, traktSecret = process.env.TRAKT_CLIENT_SECRET }) {
  const accounts = (userId) => db.prepare('SELECT id, service, label, last_sync_at, connected_at FROM streaming_accounts WHERE user_id = ? ORDER BY connected_at').all(userId);

  r.get('/api/streaming', ({ user }) => {
    requireUser(user);
    const services = Object.entries(SERVICES).map(([id, s]) => ({ id, ...s, available: id !== 'trakt' || !!traktId }));
    return {
      services, accounts: accounts(user.id),
      imports: db.prepare('SELECT * FROM watch_imports WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(user.id),
      pending: db.prepare("SELECT count(*) n FROM watches WHERE user_id = ? AND prompt_state = 'pending'").get(user.id).n,
      prompt_reviews: !!db.prepare('SELECT prompt_reviews FROM users WHERE id = ?').get(user.id).prompt_reviews
    };
  });

  // Connecting an import-only service just records it, so the app can remind you to import now and then.
  r.post('/api/streaming/connect', ({ body, user }) => {
    requireUser(user);
    const service = String(body.service || '');
    if (!SERVICES[service] || SERVICES[service].kind !== 'import') fail(400, 'Unknown service.');
    db.prepare('INSERT INTO streaming_accounts (user_id, service, label) VALUES (?, ?, ?) ON CONFLICT (user_id, service) DO UPDATE SET label = excluded.label')
      .run(user.id, service, String(body.label || '').slice(0, 80));
    return { accounts: accounts(user.id) };
  });

  r.delete('/api/streaming/:service', ({ params, user }) => {
    requireUser(user);
    db.prepare('DELETE FROM streaming_accounts WHERE user_id = ? AND service = ?').run(user.id, params.service);
    return { accounts: accounts(user.id) };
  });

  /* file import: preview, then commit what the member confirmed */
  r.post('/api/streaming/import/preview', ({ body, user }) => {
    requireUser(user);
    rateLimit(String(user.id), 'import-preview', 30, 60 * 60e3);
    const service = SERVICES[body.service] && SERVICES[body.service].kind === 'import' ? body.service : 'other';
    let parsed;
    try { parsed = parseViewingHistory(body.csv || '', { order: body.order === 'mdy' ? 'mdy' : 'dmy' }); } catch (e) { fail(400, e.message); }
    const mine = db.prepare('SELECT film_id, watched_on FROM watches WHERE user_id = ?').all(user.id);
    const have = new Set(mine.map((w) => `${w.film_id}|${w.watched_on}`));
    const watchedFilms = new Set(mine.map((w) => w.film_id));
    const rows = parsed.rows.slice(0, 2000).map((row) => {
      const m = matchTitle(db, row.title);
      const out = { title: row.title, date: row.date, film: m.match, confidence: m.confidence, candidates: m.candidates };
      if (m.match) { out.duplicate = have.has(`${m.match.id}|${row.date}`); out.rewatch = watchedFilms.has(m.match.id); }
      return out;
    });
    return {
      service, rows, skipped: parsed.skipped, columns: parsed.columns, truncated: parsed.rows.length > 2000,
      summary: { matched: rows.filter((x) => x.film && !x.duplicate).length, duplicates: rows.filter((x) => x.duplicate).length, unmatched: rows.filter((x) => !x.film).length }
    };
  });

  r.post('/api/streaming/import/commit', ({ body, user }) => {
    requireUser(user);
    const service = SERVICES[body.service] ? body.service : 'other';
    const via = ['netflix', 'prime', 'disney', 'apple', 'mubi'].includes(service) ? service : 'other';
    if (!Array.isArray(body.rows)) fail(400, 'Nothing to import.');
    const ask = !!db.prepare('SELECT prompt_reviews FROM users WHERE id = ?').get(user.id).prompt_reviews;
    const result = { logged: 0, skipped: 0, created: 0 };
    tx(db, () => {
      for (const row of body.rows.slice(0, 2000)) {
        if (row.skip) { result.skipped++; continue; }
        let filmId = row.film_id ? +row.film_id : null;
        if (!filmId && row.new_title) { filmId = createBareFilm(db, { title: row.new_title, year: row.year ? +row.year : null }); result.created++; }
        if (!filmId || !db.prepare('SELECT 1 FROM films WHERE id = ?').get(filmId)) { result.skipped++; continue; }
        const date = /^\d{4}-\d{2}-\d{2}$/.test(row.date || '') ? row.date : '';
        if (db.prepare('SELECT 1 FROM watches WHERE user_id = ? AND film_id = ? AND watched_on = ?').get(user.id, filmId, date)) { result.skipped++; continue; }
        const rewatch = db.prepare('SELECT 1 FROM watches WHERE user_id = ? AND film_id = ? AND watched_on < ?').get(user.id, filmId, date || '9999') ? 1 : 0;
        db.prepare(`INSERT INTO watches (user_id, film_id, watched_on, via, rewatch, source, prompt_state) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(user.id, filmId, date, via, rewatch, 'import:' + service, ask ? 'pending' : 'none');
        db.prepare('DELETE FROM watchlist WHERE user_id = ? AND film_id = ?').run(user.id, filmId);
        result.logged++;
      }
      db.prepare('INSERT INTO watch_imports (user_id, service, rows, logged, skipped) VALUES (?, ?, ?, ?, ?)').run(user.id, service, body.rows.length, result.logged, result.skipped);
      if (SERVICES[service]) db.prepare(`INSERT INTO streaming_accounts (user_id, service, last_sync_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT (user_id, service) DO UPDATE SET last_sync_at = datetime('now')`).run(user.id, service);
    });
    return result;
  });

  /* Trakt: real OAuth, real history. Needs TRAKT_CLIENT_ID and TRAKT_CLIENT_SECRET. */
  const traktHeaders = (token) => ({ 'content-type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': traktId, ...(token ? { authorization: 'Bearer ' + token } : {}) });
  const redirectUri = (req) => `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}/api/streaming/trakt/callback`;

  r.get('/api/streaming/trakt/connect', ({ req, user }) => {
    requireUser(user);
    if (!traktId) fail(501, 'Trakt is not set up on this server. Set TRAKT_CLIENT_ID and TRAKT_CLIENT_SECRET.');
    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, { userId: user.id, at: Date.now() });
    for (const [k, s] of oauthStates) if (Date.now() - s.at > 15 * 60e3) oauthStates.delete(k);
    const u = new URL('https://trakt.tv/oauth/authorize');
    u.searchParams.set('response_type', 'code'); u.searchParams.set('client_id', traktId);
    u.searchParams.set('redirect_uri', redirectUri(req)); u.searchParams.set('state', state);
    return { url: u.toString() };
  });

  r.get('/api/streaming/trakt/callback', async ({ req, res, query, user }) => {
    const st = oauthStates.get(query.get('state'));
    oauthStates.delete(query.get('state'));
    const back = (msg) => { res.writeHead(302, { Location: '/streaming' + (msg ? '?error=' + encodeURIComponent(msg) : '?connected=trakt') }); res.end(); };
    if (!st || !user || st.userId !== user.id) return back('That sign-in link had expired. Try connecting again.');
    let data;
    try {
      const resp = await fetch(TRAKT_API + '/oauth/token', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ code: query.get('code'), client_id: traktId, client_secret: traktSecret, redirect_uri: redirectUri(req), grant_type: 'authorization_code' }) });
      if (!resp.ok) return back(`Trakt refused the connection (${resp.status}).`);
      data = await resp.json();
    } catch { return back('Could not reach Trakt.'); }
    db.prepare(`INSERT INTO streaming_accounts (user_id, service, access_token, refresh_token, token_expires) VALUES (?, 'trakt', ?, ?, ?)
      ON CONFLICT (user_id, service) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token, token_expires = excluded.token_expires`)
      .run(user.id, data.access_token, data.refresh_token || '', Date.now() + (data.expires_in || 7776000) * 1000);
    try { await syncTrakt(user.id); } catch { /* shown on the streaming page */ }
    back('');
  });

  async function traktToken(acc) {
    if (acc.token_expires && acc.token_expires - Date.now() > 3600e3) return acc.access_token;
    const resp = await fetch(TRAKT_API + '/oauth/token', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ refresh_token: acc.refresh_token, client_id: traktId, client_secret: traktSecret, redirect_uri: 'urn:ietf:wg:oauth:2.0:oob', grant_type: 'refresh_token' }) });
    if (!resp.ok) throw new Error('Trakt asked you to connect again.');
    const d = await resp.json();
    db.prepare('UPDATE streaming_accounts SET access_token = ?, refresh_token = ?, token_expires = ? WHERE id = ?').run(d.access_token, d.refresh_token || acc.refresh_token, Date.now() + (d.expires_in || 7776000) * 1000, acc.id);
    return d.access_token;
  }

  // Pulls movie history since the last sync and logs anything new. Exported for tests via mapTraktHistory.
  async function syncTrakt(userId) {
    const acc = db.prepare("SELECT * FROM streaming_accounts WHERE user_id = ? AND service = 'trakt'").get(userId);
    if (!acc) throw new Error('Trakt is not connected.');
    const token = await traktToken(acc);
    const u = new URL(TRAKT_API + '/sync/history/movies');
    u.searchParams.set('limit', '200');
    if (acc.last_sync_at) u.searchParams.set('start_at', new Date(acc.last_sync_at.replace(' ', 'T') + 'Z').toISOString());
    const resp = await fetch(u, { headers: traktHeaders(token), signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`Trakt answered ${resp.status}.`);
    const items = await resp.json();
    const n = applyTraktHistory(db, userId, items);
    db.prepare("UPDATE streaming_accounts SET last_sync_at = datetime('now') WHERE id = ?").run(acc.id);
    return n;
  }

  r.post('/api/streaming/trakt/sync', async ({ user }) => {
    requireUser(user);
    rateLimit(String(user.id), 'trakt-sync', 20, 60 * 60e3);
    try { return { logged: await syncTrakt(user.id) }; } catch (e) { fail(502, e.message); }
  });

  // Background refresh when the app opens: at most once an hour, never blocking the caller.
  r.get('/api/streaming/poke', ({ user }) => {
    if (!user || !traktId) return { ok: true };
    const acc = db.prepare("SELECT last_sync_at FROM streaming_accounts WHERE user_id = ? AND service = 'trakt'").get(user.id);
    if (acc && (!acc.last_sync_at || Date.now() - Date.parse(acc.last_sync_at.replace(' ', 'T') + 'Z') > 3600e3)) syncTrakt(user.id).catch(() => {});
    return { ok: true };
  });

  r.get('/api/streaming/recent', ({ user }) => {
    requireUser(user);
    return { items: watchRows(db, "w.user_id = ? AND w.source != 'manual'", [user.id], user, 30) };
  });
  void filmsById; void normTitle;
}

// Maps Trakt history items onto films and diary entries. Pure enough to unit test with a fixture.
export function applyTraktHistory(db, userId, items) {
  const ask = !!db.prepare('SELECT prompt_reviews FROM users WHERE id = ?').get(userId).prompt_reviews;
  let logged = 0;
  tx(db, () => {
    for (const it of items) {
      if (it.type !== 'movie' || !it.movie) continue;
      const m = it.movie, tmdb = m.ids?.tmdb || null, date = (it.watched_at || '').slice(0, 10);
      if (db.prepare('SELECT 1 FROM watches WHERE user_id = ? AND source = ?').get(userId, 'trakt:' + it.id)) continue;
      let filmId = tmdb ? db.prepare('SELECT id FROM films WHERE tmdb_id = ?').get(tmdb)?.id : null;
      if (!filmId) { const r = matchTitle(db, m.title, m.year); filmId = r.match?.id || null; }
      if (!filmId) filmId = createBareFilm(db, { title: m.title, year: m.year, tmdb_id: tmdb });
      else if (tmdb) db.prepare('UPDATE films SET tmdb_id = coalesce(tmdb_id, ?) WHERE id = ?').run(tmdb, filmId);
      if (db.prepare('SELECT 1 FROM watches WHERE user_id = ? AND film_id = ? AND watched_on = ?').get(userId, filmId, date)) continue;
      const rewatch = db.prepare('SELECT 1 FROM watches WHERE user_id = ? AND film_id = ?').get(userId, filmId) ? 1 : 0;
      db.prepare("INSERT INTO watches (user_id, film_id, watched_on, via, rewatch, source, prompt_state) VALUES (?, ?, ?, 'other', ?, ?, ?)")
        .run(userId, filmId, date, rewatch, 'trakt:' + it.id, ask ? 'pending' : 'none');
      db.prepare('DELETE FROM watchlist WHERE user_id = ? AND film_id = ?').run(userId, filmId);
      logged++;
    }
  });
  return logged;
}
