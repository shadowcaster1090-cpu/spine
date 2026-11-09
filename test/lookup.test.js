import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { parseProductTitle, regionFromBarcode, formatOf } from '../server/lookup.js';

let server, base, db, dir, mock, mockBase;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const hits = { upc: 0, tmdbSearch: 0, images: 0 };

before(async () => {
  // One mock server plays UPCitemdb, TMDB and the image hosts.
  mock = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (o, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/upc/lookup') {
      hits.upc++;
      const code = u.searchParams.get('upc');
      if (code === '0715515099417' || code === '715515099417') return json({ code: 'OK', items: [{ ean: '0715515099417', title: 'in the Mood for Love (Criterion Collection)', brand: 'Sony Pictures Entertainment', description: 'Hong Kong 1962…', images: [`${mockBase}/img/cover.jpg`], offers: [{ title: 'In the Mood for Love' }] }] });
      if (code === '5050582485318') return json({ code: 'OK', items: [{ ean: '5050582485318', title: 'Diaz, Cameron-the Holiday (uk Import) Dvd [region 2]', brand: '', images: [], offers: [] }] });
      return json({ code: 'INVALID_UPC', message: 'not found' }, 404);
    }
    if (u.pathname === '/tmdb/search/movie') {
      hits.tmdbSearch++;
      const q = u.searchParams.get('query').toLowerCase();
      if (q.includes('mood for love')) return json({ results: [{ id: 843, title: 'In the Mood for Love', original_title: '花樣年華', release_date: '2000-09-29', poster_path: '/mood.jpg', vote_count: 2500 }, { id: 9999, title: 'In the Mood', release_date: '1987-01-01', vote_count: 5 }] });
      if (q.includes('holiday')) return json({ results: [{ id: 1581, title: 'The Holiday', original_title: 'The Holiday', release_date: '2006-12-08', poster_path: '/holiday.jpg', vote_count: 6000 }] });
      if (q.includes('stalker')) return json({ results: [{ id: 1398, title: 'Stalker', original_title: 'Сталкер', release_date: '1979-05-25', poster_path: '/stalker.jpg', vote_count: 3000 }] });
      return json({ results: [] });
    }
    const mv = u.pathname.match(/^\/tmdb\/movie\/(\d+)$/);
    if (mv) {
      const id = +mv[1];
      const films = { 843: { id, title: 'In the Mood for Love', original_title: '花樣年華', release_date: '2000-09-29', poster_path: '/mood.jpg', overview: 'Two neighbours…', runtime: 98, original_language: 'cn', spoken_languages: [{ iso_639_1: 'cn', english_name: 'Cantonese' }], production_countries: [{ name: 'Hong Kong' }], credits: { crew: [{ job: 'Director', name: 'Wong Kar-wai' }] } },
        1581: { id, title: 'The Holiday', release_date: '2006-12-08', poster_path: '/holiday.jpg', overview: 'Two women swap homes.', runtime: 136, credits: { crew: [{ job: 'Director', name: 'Nancy Meyers' }] } },
        1398: { id, title: 'Stalker', original_title: 'Сталкер', release_date: '1979-05-25', poster_path: '/stalker.jpg', overview: 'A guide leads two men…', runtime: 162, credits: { crew: [{ job: 'Director', name: 'Andrei Tarkovsky' }] } } };
      return films[id] ? json(films[id]) : json({ status_message: 'not found' }, 404);
    }
    if (u.pathname.startsWith('/img/') || u.pathname.startsWith('/t/p/')) { hits.images++; res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => mock.listen(0, r));
  mockBase = `http://127.0.0.1:${mock.address().port}`;
  process.env.UPCITEMDB_BASE = mockBase + '/upc';
  process.env.OPF_OFF = '1';
  process.env.TMDB_BASE = mockBase + '/tmdb';
  process.env.TMDB_IMG_BASE = mockBase + '/t/p/';

  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-lookup-'));
  db = openDb(path.join(dir, 'test.db'));
  server = http.createServer(createApp({ db, uploadsDir: path.join(dir, 'uploads'), tmdbKey: 'test-key' }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close(); mock.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
  for (const k of ['UPCITEMDB_BASE', 'OPF_OFF', 'TMDB_BASE', 'TMDB_IMG_BASE']) delete process.env[k];
});

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}
const admin = client();

test('retail titles are read into film title, year, format, label and region', () => {
  let p = parseProductTitle('Diaz, Cameron-the Holiday (uk Import) Dvd [region 2]', { code: '5050582485318' });
  assert.equal(p.title, 'The Holiday'); assert.equal(p.format, 'dvd'); assert.equal(p.region, '2'); assert.equal(p.standard, 'PAL');
  p = parseProductTitle('Seven Samurai (The Criterion Collection) [DVD] [1954]', { code: '0715515009720' });
  assert.equal(p.title, 'Seven Samurai'); assert.equal(p.year, 1954); assert.equal(p.label, 'The Criterion Collection'); assert.equal(p.region, '1'); assert.equal(p.standard, 'NTSC');
  p = parseProductTitle('Tokyo Story (Masters of Cinema) (Dual Format Edition) [Blu-ray]', { code: '5060000700000' });
  assert.equal(p.title, 'Tokyo Story'); assert.equal(p.format, 'bluray'); assert.equal(p.label, 'Eureka Entertainment');
  p = parseProductTitle('Taxi Driver (2-Disc Collector\'s Edition) [DVD] [1976]', { code: '5035822003033' });
  assert.equal(p.discs, 2); assert.deepEqual(p.edition, ["Collector's Edition"]); assert.equal(p.year, 1976);
  assert.equal(parseProductTitle('Paris, Texas - 2 Disc Special Edition [DVD] [1984]', { code: '5060034578024' }).title, 'Paris, Texas');
  assert.equal(parseProductTitle('Film Socialisme [DVD]', {}).title, 'Film Socialisme');
  assert.deepEqual(regionFromBarcode('9398700000000'), { region: '4', standard: 'PAL' });
  assert.deepEqual(regionFromBarcode('4988000000000'), { region: '2', standard: 'NTSC' });
  assert.equal(formatOf('Blade Runner 4K Ultra HD + Blu-ray'), 'uhd');
});

test('a scanned barcode is looked up, parsed and matched to the film on TMDB; answers are cached', async () => {
  await admin('POST', '/api/auth/signup', { username: 'ada', email: 'ada@example.com', password: 'correct horse' });
  let r = await admin('GET', '/api/barcode/715515099417/lookup');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.product.source, 'upcitemdb');
  assert.equal(r.data.parsed.title, 'In the Mood for Love');
  assert.equal(r.data.parsed.label, 'The Criterion Collection');
  assert.equal(r.data.parsed.region, '1');
  assert.equal(r.data.film.tmdb_id, 843);
  assert.match(r.data.film.poster_url, /\/t\/p\/w342\/mood\.jpg$/);
  assert.equal(r.data.existing_film_id, null);
  assert.equal(r.data.cached, false);
  const before = hits.upc;
  r = await admin('GET', '/api/barcode/0715515099417/lookup');   // same disc, EAN-13 spelling
  assert.equal(r.data.cached, true);
  assert.equal(hits.upc, before, 'no second provider call');
});

test('an unknown barcode comes back empty, without errors, and the miss is remembered', async () => {
  const r = await admin('GET', '/api/barcode/4006381333931/lookup');
  assert.equal(r.status, 200);
  assert.equal(r.data.product, null); assert.equal(r.data.film, null); assert.deepEqual(r.data.errors, []);
  assert.ok(db.prepare('SELECT 1 FROM barcode_cache WHERE code = ?').get('4006381333931'));
});

test('one tap creates the film from TMDB and the edition with the retailer cover, and shelves it', async () => {
  const r = await admin('POST', '/api/barcode/715515099417/create', {
    tmdb_id: 843, cover_url: `${mockBase}/img/cover.jpg`, source: 'upcitemdb', add_to: 'shelf',
    edition: { label_name: 'The Criterion Collection', region: '1', standard: 'NTSC', format: 'dvd', release_year: 2002, discs: 2 }
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.film_created, true);
  assert.equal(r.data.cover, true); assert.equal(r.data.poster, true);
  assert.equal(r.data.edition.title, 'In the Mood for Love');
  assert.equal(r.data.edition.label, 'The Criterion Collection');
  assert.equal(r.data.edition.format, 'dvd');
  assert.ok(r.data.edition.cover, 'edition has a cover file');
  assert.ok(r.data.copy, 'a copy was added');
  // The film carries the poster and credits from TMDB.
  const film = (await admin('GET', `/api/films/${r.data.film_id}`)).data.film;
  assert.equal(film.tmdb_id, 843); assert.ok(film.cover); assert.equal(film.directors[0].name, 'Wong Kar-wai'); assert.equal(film.runtime, 98);
  assert.ok(fs.existsSync(path.join(dir, 'uploads', film.cover)));
  // Now the barcode resolves instantly for everyone.
  const again = await admin('GET', '/api/barcode/715515099417');
  assert.equal(again.data.items.length, 1);
  assert.equal(again.data.items[0].id, r.data.edition.id);
  // And it cannot be created twice.
  const dup = await admin('POST', '/api/barcode/715515099417/create', { tmdb_id: 843, edition: { region: '1' } });
  assert.equal(dup.status, 409);
});

test('a disc with no TMDB match can still be added with a typed title', async () => {
  const r = await admin('POST', '/api/barcode/4006381333931/create', { film: { title: 'Obscure Short Films', year: 1999 }, edition: { label_name: 'Someone', region: '2', standard: 'PAL' }, add_to: 'want' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.cover, false);
  assert.equal(r.data.edition.title, 'Obscure Short Films');
  const ids = (await admin('GET', '/api/me/ids')).data;
  assert.ok(ids.wants.includes(r.data.edition.id));
});

test('the poster backfill matches bare films on TMDB and stores their posters', async () => {
  db.prepare('INSERT INTO films (title, year) VALUES (?, ?)').run('Stalker', 1979);
  db.prepare('INSERT INTO films (title, year) VALUES (?, ?)').run('Totally Unknown Film', 1931);
  const r = await admin('POST', '/api/admin/posters', { limit: 50 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.done >= 1, true);
  assert.ok(r.data.missed.some((m) => m.startsWith('Totally Unknown Film')));
  const stalker = db.prepare("SELECT tmdb_id, poster, poster_path FROM films WHERE title = 'Stalker'").get();
  assert.equal(stalker.tmdb_id, 1398); assert.ok(stalker.poster); assert.equal(stalker.poster_path, '/stalker.jpg');
  assert.equal(db.prepare("SELECT count(*) n FROM film_directors fd JOIN films f ON f.id = fd.film_id WHERE f.title = 'Stalker'").get().n, 1);
});

test('barcode hints: GS1 prefix gives the label and region for discs no database knows', async () => {
  const { hintFromBarcode, labelFromBarcode } = await import('../server/lookup.js');
  assert.equal(labelFromBarcode('5051429990422'), 'Entertainment One');
  assert.equal(labelFromBarcode('5051892251990'), 'Warner Bros.');
  assert.equal(labelFromBarcode('5055761913446'), 'Lionsgate');
  assert.equal(labelFromBarcode('715515123456'), 'The Criterion Collection');   // 12-digit UPC
  assert.equal(labelFromBarcode('9999999999999'), '');
  const h = hintFromBarcode('5051429990422');
  assert.equal(h.region, '2');
  assert.equal(h.standard, 'PAL');
});
