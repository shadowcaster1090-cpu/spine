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
const eanAsked = [];   // EAN-Search queries, by the ean they asked for

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
      // Four real discs from a shelf, as UPCitemdb answered on 9 Nov 2026: two products, two valid codes it has no product for.
      if (code === '5051892210034') return json({ code: 'OK', total: 1, items: [{ ean: '5051892210034', title: 'Dunkirk 4k Ultra Hd + Blu-ray + Digital (2017)', brand: 'Warner', description: '', category: 'Media > Movies', images: [`${mockBase}/img/dunkirk-1.jpg`, `${mockBase}/img/dunkirk-2.jpg`], offers: [{ title: 'Dunkirk (4K Ultra HD + Blu-ray + Digital) [2017]' }] }] });
      if (code === '5055761913446') return json({ code: 'OK', total: 1, items: [{ ean: '5055761913446', title: 'Hacksaw Ridge 4K Ultra HD [Blu-ray] [2017]', brand: 'Lionsgate UK', model: 'LIU95410', images: [`${mockBase}/img/hacksaw.jpg`], offers: [] }] });
      if (code === '5051892251990' || code === '5051429990422') return json({ code: 'OK', total: 0, offset: 0, items: [] });
      return json({ code: 'INVALID_UPC', message: 'not found' }, 404);
    }
    if (u.pathname === '/ean/api') {
      // EAN-Search's documented answer is a JSON array; misses and failures come back as {error}, or as plain text.
      const ean = u.searchParams.get('ean');
      eanAsked.push(ean);
      if (u.searchParams.get('token') !== 'test-token' || u.searchParams.get('op') !== 'barcode-lookup' || u.searchParams.get('format') !== 'json') return json([{ error: 'Invalid token' }]);
      if (ean === '5012345678900') return json([{ ean, name: 'The Third Man [Blu-ray] [1949]', categoryId: '60', categoryName: 'Movies & Video', googleCategoryId: '839', issuingCountry: 'UK' }]);
      if (ean === '5012345678924') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('Barcode not found'); }
      if (ean === '5012345678931') return json([{ error: 'Query limit exceeded' }]);
      return json([{ error: 'Barcode not found' }]);
    }
    if (u.pathname === '/tmdb/search/movie') {
      hits.tmdbSearch++;
      const q = u.searchParams.get('query').toLowerCase();
      if (q.includes('mood for love')) return json({ results: [{ id: 843, title: 'In the Mood for Love', original_title: '花樣年華', release_date: '2000-09-29', poster_path: '/mood.jpg', vote_count: 2500 }, { id: 9999, title: 'In the Mood', release_date: '1987-01-01', vote_count: 5 }] });
      if (q.includes('holiday')) return json({ results: [{ id: 1581, title: 'The Holiday', original_title: 'The Holiday', release_date: '2006-12-08', poster_path: '/holiday.jpg', vote_count: 6000 }] });
      if (q.includes('stalker')) return json({ results: [{ id: 1398, title: 'Stalker', original_title: 'Сталкер', release_date: '1979-05-25', poster_path: '/stalker.jpg', vote_count: 3000 }] });
      if (q.includes('dunkirk')) return json({ results: [{ id: 1215, title: 'Dunkirk', original_title: 'Dunkirk', release_date: '1958-03-20', poster_path: '/dunkirk58.jpg', vote_count: 90 }, { id: 374720, title: 'Dunkirk', original_title: 'Dunkirk', release_date: '2017-07-19', poster_path: '/dunkirk.jpg', vote_count: 15000 }] });
      if (q.includes('hacksaw')) return json({ results: [{ id: 324786, title: 'Hacksaw Ridge', original_title: 'Hacksaw Ridge', release_date: '2016-10-07', poster_path: '/hacksaw.jpg', vote_count: 12000 }] });
      return json({ results: [] });
    }
    const mv = u.pathname.match(/^\/tmdb\/movie\/(\d+)$/);
    if (mv) {
      const id = +mv[1];
      const films = { 843: { id, title: 'In the Mood for Love', original_title: '花樣年華', release_date: '2000-09-29', poster_path: '/mood.jpg', overview: 'Two neighbours…', runtime: 98, original_language: 'cn', spoken_languages: [{ iso_639_1: 'cn', english_name: 'Cantonese' }], production_countries: [{ name: 'Hong Kong' }], credits: { crew: [{ job: 'Director', name: 'Wong Kar-wai' }] } },
        1581: { id, title: 'The Holiday', release_date: '2006-12-08', poster_path: '/holiday.jpg', overview: 'Two women swap homes.', runtime: 136, credits: { crew: [{ job: 'Director', name: 'Nancy Meyers' }] } },
        1398: { id, title: 'Stalker', original_title: 'Сталкер', release_date: '1979-05-25', poster_path: '/stalker.jpg', overview: 'A guide leads two men…', runtime: 162, credits: { crew: [{ job: 'Director', name: 'Andrei Tarkovsky' }] } },
        374720: { id, title: 'Dunkirk', original_title: 'Dunkirk', release_date: '2017-07-19', poster_path: '/dunkirk.jpg', overview: 'Allied soldiers are surrounded…', runtime: 107, credits: { crew: [{ job: 'Director', name: 'Christopher Nolan' }] } },
        324786: { id, title: 'Hacksaw Ridge', original_title: 'Hacksaw Ridge', release_date: '2016-10-07', poster_path: '/hacksaw.jpg', overview: 'A conscientious objector…', runtime: 139, credits: { crew: [{ job: 'Director', name: 'Mel Gibson' }] } } };
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
  // Combo packs: formats and digital copies go, the film stays, and a real "+" in a title survives.
  p = parseProductTitle('Dunkirk 4k Ultra Hd + Blu-ray + Digital (2017)', { brand: 'Warner', code: '5051892210034' });
  assert.equal(p.title, 'Dunkirk'); assert.equal(p.year, 2017); assert.equal(p.format, 'uhd'); assert.equal(p.label, 'Warner Bros.'); assert.equal(p.region, '2'); assert.equal(p.standard, 'PAL');
  assert.equal(parseProductTitle('Blade Runner 2049 (4K UHD + Blu-ray + Digital Download) [2017]', {}).title, 'Blade Runner 2049');
  assert.equal(parseProductTitle('The Dark Knight - Blu-ray + DVD + Digital HD', {}).title, 'The Dark Knight');
  assert.equal(parseProductTitle('Inception Zavvi Exclusive Steelbook [4K UHD + Blu-ray]', {}).title, 'Inception');
  assert.equal(parseProductTitle('Jaws Includes Digital Copy [Blu-ray]', {}).title, 'Jaws');
  assert.equal(parseProductTitle('Romeo + Juliet [Blu-ray] [1996]', {}).title, 'Romeo + Juliet');
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
  assert.equal(labelFromBarcode('5051429990422'), 'Icon');           // Malcolm X 4K (2024), Icon Film Distribution
  assert.equal(labelFromBarcode('5051892251990'), 'Warner Bros.');   // Corpse Bride 4K (2025)
  assert.equal(labelFromBarcode('5055761913446'), 'Lionsgate');
  assert.equal(labelFromBarcode('715515123456'), 'The Criterion Collection');   // 12-digit UPC
  assert.equal(labelFromBarcode('9999999999999'), '');
  const h = hintFromBarcode('5051429990422');
  assert.equal(h.region, '2');
  assert.equal(h.standard, 'PAL');
});

test('GS1 prefixes: a real disc barcode for every checked prefix names its label', async () => {
  const { labelFromBarcode, COMPANY_PREFIXES } = await import('../server/lookup.js');
  // [barcode as printed, label, the disc it is on]. Gathered from retailer and catalogue pages, Nov 2026.
  const DISCS = [
    ['715515054911', 'The Criterion Collection', 'Seven Samurai, Blu-ray'], ['025192231575', 'Universal', 'Wet Hot American Summer, Blu-ray'],
    ['025193227423', 'Universal', 'The Bourne Ultimatum, DVD'], ['043396177130', 'Sony Pictures', 'Gridiron Gang, Blu-ray'],
    ['883929681266', 'Warner Bros.', 'Batman 80th Anniversary Collection, Blu-ray'], ['085391296225', 'Warner Bros.', 'Dave, DVD'],
    ['012569594159', 'Warner Bros.', 'Batman Begins, DVD'], ['888574774400', 'Warner Archive', 'Starsky & Hutch, Blu-ray'],
    ['794043148033', 'New Line', 'Blade, Blu-ray'], ['026359156229', 'HBO', 'No Escape, DVD'], ['097361297248', 'Paramount', 'Beverly Hills Cop, Blu-ray'],
    ['032429264343', 'Paramount', 'Star Trek: Enterprise, Blu-ray'], ['024543017851', '20th Century Fox', 'Knight and Day, Blu-ray'],
    ['786936761481', 'Disney', 'Dead Poets Society, Blu-ray'], ['027616861078', 'MGM', 'The Magnificent Seven, DVD'], ['667068901221', 'DreamWorks', 'Shrek, DVD'],
    ['031398314134', 'Lionsgate', 'Midway, Blu-ray'], ['012236110491', 'Lionsgate', 'The Blair Witch Project, Blu-ray'],
    ['738329252045', 'Kino Lorber', 'The Suspect, Blu-ray'], ['826663271096', 'Shout! Factory', 'Grave of the Fireflies, Blu-ray'],
    ['654930322697', 'Synapse Films', 'Phenomena, 4K UHD'], ['827058100496', 'Blue Underground', 'Daughters of Darkness, DVD'],
    ['814456021461', 'Vinegar Syndrome', 'Star_Time, Blu-ray'], ['663390002537', 'Severin Films', 'Brides of Blood, Blu-ray'],
    ['887090043007', 'Olive Films', 'A Double Life, Blu-ray'], ['811956021007', 'Twilight Time', 'The Big Heat, Blu-ray'],
    ['617311600593', 'Flicker Alley', 'French Revelations, Blu-ray'], ['876964006187', 'Magnolia', 'Blackfish, Blu-ray'], ['810180990882', 'A24', 'The Brutalist, Blu-ray'],
    ['812491019658', 'Well Go USA', 'Ichi the Killer, Blu-ray'], ['683904507389', 'Mill Creek', 'Ultraman: The Complete Series'],
    ['014381959451', 'Image Entertainment', 'Peggy Sue Got Married, Blu-ray'], ['013132630236', 'Anchor Bay', 'Woman in Gold, Blu-ray'],
    ['841887051385', 'PBS', 'Lewis and Clark, DVD'], ['054961273096', 'Acorn Media', 'Patrick Melrose, DVD'],
    ['843276028497', 'Mondo Macabro', 'Shadow of Death, Blu-ray'], ['881190023792', 'Cult Epics', 'Girls, Blu-ray'], ['790357987900', 'Troma', 'The Toxic Avenger, Blu-ray'],
    ['795975106535', 'Zeitgeist', 'The Corporation, DVD'], ['720229918282', 'First Run Features', 'The Quiet Epidemic, DVD'],
    ['704400103254', 'Funimation', 'Violet Evergarden, Blu-ray'], ['782009248118', 'VIZ Media', 'Bleach: Thousand-Year Blood War Part 1, Blu-ray'],
    ['669198247002', 'Bandai', 'SD Gundam Force, DVD'], ['013023153899', 'Pioneer', 'Akira, DVD'], ['814131017376', 'Sentai Filmworks', 'Beyond the Boundary, Blu-ray'],
    ['816726025759', 'Sentai Filmworks', 'Beyond the Boundary, Blu-ray (2022)'], ['875707065092', 'Discotek Media', 'Vampire Hunter D: Bloodlust, Blu-ray'],
    ['5051892210034', 'Warner Bros.', 'Dunkirk, 4K UHD'], ['5055761913446', 'Lionsgate', 'Hacksaw Ridge, 4K UHD'],
    ['9398700039439', 'Roadshow Entertainment', 'Suicide Squad, Blu-ray (AU)'], ['9398710323399', 'Roadshow Entertainment', 'Swordfish, DVD (AU)'],
    ['9398711368894', 'Roadshow Entertainment', 'The Imitation Game, DVD (AU)'], ['9325336108840', 'Warner Bros.', 'The Dark Knight, Blu-ray (AU)'],
    ['9321337042350', '20th Century Fox', 'AVP, DVD (AU)'], ['9324915041127', 'Paramount', 'World War Z, Blu-ray (AU)'],
    ['9398540899071', 'Disney', 'WALL·E, Blu-ray (AU)'], ['9398580949071', 'Disney', 'Dumbo, Blu-ray (AU)'],
    ['9344256006968', 'Umbrella Entertainment', 'Deep Red, Blu-ray (AU)'], ['9322225241589', 'Madman', "Darwin's Game, Blu-ray (AU)"],
    ['9345228002254', 'Shock Entertainment', 'Dr. Phibes Rises Again, Blu-ray (AU)'],
    // United Kingdom
    ['5050582572230', 'Universal', 'Doomsday, Blu-ray'], ['5053083260675', 'Universal', 'Pearl, Blu-ray'],
    ['5050629892857', 'Sony Pictures', 'Leave No Trace, Blu-ray'], ['5050630459018', 'Sony Pictures', "Bram Stoker's Dracula, 4K UHD"],
    ['5035822136632', 'Sony Pictures', 'Sunset, DVD (Columbia TriStar)'], ['5051892222730', 'Warner Bros.', 'Batman & Robin, 4K UHD'],
    ['5051892251990', 'Warner Bros.', 'Corpse Bride, 4K UHD'], ['7321900115216', 'Warner Bros.', 'Batman Begins, Blu-ray'],
    ['5014437935632', 'Paramount', 'The Sons of Katie Elder, DVD'], ['5051368203232', 'Paramount', 'The Godfather, Blu-ray'],
    ['5017188811668', 'Disney', 'Heavyweights, DVD'], ['8717418185657', 'Disney', 'The Love Bug, DVD'],
    ['5039036054157', '20th Century Fox', 'Prometheus, Blu-ray'], ['5050070008319', 'MGM', 'The Crying Game, DVD'],
    ['5055761915945', 'Lionsgate', 'Clerks III, Blu-ray'], ['5060052419668', 'Lionsgate', 'The Lives of Others, Blu-ray'],
    ['5060223760025', 'Lionsgate', 'The Expendables, Blu-ray'], ['5030305520199', 'Entertainment One', 'Spotlight, Blu-ray'],
    ['5055744700483', 'Entertainment One', 'The Raid + The Raid 2, Blu-ray'], ['5017239192753', 'Entertainment in Video', 'Death Machine, DVD'],
    ['5051429990422', 'Icon', 'Malcolm X, 4K UHD'], ['5060116727319', 'Momentum Pictures', 'The Raid, Blu-ray'],
    ['5060049145198', 'Momentum Pictures', 'Lost in Translation, DVD'], ['5055201808608', 'StudioCanal', 'High Tension, Blu-ray (Optimum)'],
    ['5027035017372', 'Arrow Video', 'The Ghoul, Blu-ray'], ['5035673012802', 'BFI', 'When the Wind Blows, Blu-ray'],
    ['5022655000124', 'BFI', 'Seven Samurai, 4K UHD'], ['5060000702156', 'Eureka Entertainment', '1900, Blu-ray (Masters of Cinema)'],
    ['5028836040125', 'Second Sight', 'Flight of the Navigator, Blu-ray'], ['5060697920482', 'Indicator', 'The Collector, Blu-ray'],
    ['5060710971781', '88 Films', 'The Bite, Blu-ray'], ['5060496452405', '88 Films', 'Hackers, Blu-ray'],
    ['5060974681488', 'Radiance Films', 'Häxan, Blu-ray'], ['5060114152267', 'Second Run', 'Manthan, Blu-ray'],
    ['5060148532196', 'Third Window Films', 'Violence Voyager, Blu-ray'], ['5027626703943', 'Network', 'The Lodger, Blu-ray'],
    ['5021866183404', 'Curzon', 'Stalker, Blu-ray (Artificial Eye)'], ['5036193020797', 'Acorn Media', 'Creepshow Seasons 1–4, Blu-ray'],
    ['5050968009909', 'Dogwoof', "The Spirit of '45, DVD"], ['5019322231875', 'Simply Media', 'Pathfinders, DVD'],
    ['5060020621741', 'Anchor Bay', 'The Evil Dead Trilogy, DVD'], ['5023965354426', 'Tartan', 'Sympathy for Mr. Vengeance, DVD'],
    ['5060262858493', 'Signature Entertainment', 'Sea Fever, Blu-ray'], ['5030697042750', 'Fabulous Films', 'Couples Retreat, DVD'],
    ['5060758901948', 'Kaleidoscope', 'The Man in the White Van, DVD'], ['5060018652375', 'Peccadillo', 'Tomboy, DVD'],
    ['5060265151904', 'Peccadillo', 'The Swimmer, DVD'], ['5022366881845', 'Manga Entertainment', 'Paprika, Blu-ray'],
    ['5060067009380', 'MVM Entertainment', 'Release the Spyce, Blu-ray'],
    // Germany
    ['4030521757349', 'Sony Pictures', 'Urban Legends: Final Cut, DVD (DE)'], ['4010232008787', '20th Century Fox', 'The Abyss, DVD (DE)'],
    ['4011976849186', 'Constantin Film', 'Michael Clayton, DVD (DE)']
  ];
  for (const [code, label, disc] of DISCS) assert.equal(labelFromBarcode(code), label, `${code} (${disc})`);
  // Every prefix in the table is unique, seven digits, and named by a real disc above.
  const prefixes = COMPANY_PREFIXES.map(([p]) => p);
  assert.equal(new Set(prefixes).size, prefixes.length, 'no duplicate prefixes');
  for (const p of prefixes) assert.match(p, /^\d{7}$/);
  const covered = new Set(DISCS.map(([code]) => (code.length === 12 ? '0' + code : code).slice(0, 7)));
  assert.deepEqual(prefixes.filter((p) => !covered.has(p)), [], 'every prefix has a disc in this test');
  // Shared by several labels, so no single-label hint: Indicator's The Missionary, Altitude's Green Room, Arrow US via MVD.
  for (const code of ['5037899071809', '5060105723988', '760137143642']) assert.equal(labelFromBarcode(code), '', code);
  // Matched no disc anywhere (9397810, 5060352, 5027182) or belonged to someone else, so gone or corrected.
  for (const code of ['9397810123459', '5060352000005', '5027182000003']) assert.equal(labelFromBarcode(code), '', code);
});

test('four shelf discs: UPCitemdb products become found cards by both paths; 200 with no items is a known unknown with hints', async () => {
  // Phone path: the app posts what UPCitemdb told it, the server reads the retail title and finds the film.
  let r = await admin('POST', '/api/barcode/5051892210034/identify', { product: { source: 'upcitemdb', title: 'Dunkirk 4k Ultra Hd + Blu-ray + Digital (2017)', brand: 'Warner', description: '', category: 'Media > Movies', images: [`${mockBase}/img/dunkirk-1.jpg`, `${mockBase}/img/dunkirk-2.jpg`], titles: ['Dunkirk (4K Ultra HD + Blu-ray + Digital) [2017]'] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.parsed.title, 'Dunkirk'); assert.equal(r.data.parsed.year, 2017); assert.equal(r.data.parsed.format, 'uhd');
  assert.equal(r.data.parsed.label, 'Warner Bros.'); assert.equal(r.data.parsed.region, '2'); assert.equal(r.data.parsed.standard, 'PAL');
  assert.equal(r.data.film.tmdb_id, 374720, 'the 2017 film, not the 1958 one'); assert.equal(r.data.film.year, 2017); assert.match(r.data.film.poster_url, /\/t\/p\/w342\/dunkirk\.jpg$/);
  assert.equal(r.data.product.images.length, 2); assert.equal(r.data.existing_film_id, null);
  // Server path: the same code through the server's own lookup, with the other disc.
  r = await admin('GET', '/api/barcode/5055761913446/lookup');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.product.source, 'upcitemdb'); assert.equal(r.data.parsed.title, 'Hacksaw Ridge'); assert.equal(r.data.parsed.format, 'uhd'); assert.equal(r.data.parsed.label, 'Lionsgate');
  assert.equal(r.data.parsed.region, '2'); assert.equal(r.data.film.tmdb_id, 324786); assert.equal(r.data.film.year, 2016); assert.match(r.data.film.poster_url, /hacksaw\.jpg$/);
  assert.equal(r.data.product.images.length, 1);
  // Known unknowns: a clean answer with no items gives no product, no errors, and the barcode's own hints.
  for (const [code, label] of [['5051892251990', 'Warner Bros.'], ['5051429990422', 'Icon']]) {
    r = await admin('GET', `/api/barcode/${code}/lookup`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.product, null); assert.equal(r.data.film, null); assert.deepEqual(r.data.errors, []);
    assert.deepEqual(r.data.hint, { label, region: '2', standard: 'PAL' });
  }
  // The phone cannot post an empty product as if it were one.
  const bad = await admin('POST', '/api/barcode/5051892251990/identify', { product: { source: 'upcitemdb', title: '', images: [] } });
  assert.equal(bad.status, 400);
});

test('one tap puts Dunkirk on the shelf with the retailer cover and the TMDB poster', async () => {
  const r = await admin('POST', '/api/barcode/5051892210034/create', {
    tmdb_id: 374720, cover_url: `${mockBase}/img/dunkirk-1.jpg`, source: 'upcitemdb', add_to: 'shelf',
    edition: { label_name: 'Warner Bros.', region: '2', standard: 'PAL', format: 'uhd', discs: 2, notes: '' }
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.edition.title, 'Dunkirk'); assert.equal(r.data.edition.format, 'uhd'); assert.equal(r.data.edition.label, 'Warner Bros.');
  assert.equal(r.data.cover, true); assert.equal(r.data.poster, true); assert.ok(r.data.copy, 'on the shelf');
  const film = (await admin('GET', `/api/films/${r.data.film_id}`)).data.film;
  assert.equal(film.tmdb_id, 374720); assert.ok(film.cover); assert.equal(film.directors[0].name, 'Christopher Nolan');
  const again = await admin('GET', '/api/barcode/5051892210034');
  assert.equal(again.data.items.length, 1, 'the next scan is an instant hit');
});

test('EAN-Search answers only with a token, after the free sources; misses and failures are told apart; the token stays on the server', async () => {
  assert.deepEqual(eanAsked, [], 'never asked without EANSEARCH_TOKEN');
  process.env.EANSEARCH_TOKEN = 'test-token';
  process.env.EANSEARCH_BASE = mockBase + '/ean';
  try {
    let r = await admin('GET', '/api/barcode/5012345678900/lookup');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.product.source, 'eansearch'); assert.deepEqual(r.data.product.images, []);
    assert.equal(r.data.parsed.title, 'The Third Man'); assert.equal(r.data.parsed.year, 1949); assert.equal(r.data.parsed.format, 'bluray');
    assert.equal(r.data.cached, false);
    for (const code of ['5012345678917', '5012345678924']) {   // {error: "Barcode not found"} and a plain-text miss
      r = await admin('GET', `/api/barcode/${code}/lookup`);
      assert.equal(r.data.product, null); assert.deepEqual(r.data.errors, [], code);
    }
    r = await admin('GET', '/api/barcode/5012345678931/lookup');
    assert.equal(r.data.product, null); assert.deepEqual(r.data.errors, ['eansearch: Query limit exceeded']);
    assert.ok(!JSON.stringify(r.data).includes('test-token'), 'the token is not echoed to the client');
    const n = eanAsked.length;
    r = await admin('GET', '/api/barcode/012345678905/lookup');   // a 12-digit UPC costs one query, asked as EAN-13
    assert.equal(r.status, 200);
    assert.deepEqual(eanAsked.slice(n), ['0012345678905']);
    r = await admin('GET', '/api/barcode/5012345678900/lookup');   // a hit is remembered: no second query
    assert.equal(r.data.cached, true); assert.equal(eanAsked.filter((e) => e === '5012345678900').length, 1);
  } finally { delete process.env.EANSEARCH_TOKEN; delete process.env.EANSEARCH_BASE; }
});

test("Spine's own barcode records answer without any outside lookup, and remember discs no source has", async () => {
  const before = hits.upc;
  let r = await admin('GET', '/api/barcode/5099999999992/lookup?cached=1');   // never seen
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.product, null); assert.equal(r.data.known, false);
  r = await admin('GET', '/api/barcode/5051892210034/lookup?cached=1');      // the phone posted Dunkirk earlier
  assert.equal(r.data.known, true); assert.equal(r.data.cached, true); assert.equal(r.data.parsed.title, 'Dunkirk'); assert.equal(r.data.film.tmdb_id, 374720);
  // The phone was told "no items" by UPCitemdb: the server skips it, asks the rest, and remembers the clean miss.
  r = await admin('GET', '/api/barcode/5000000000001/lookup?upcitemdb=none');
  assert.equal(r.data.product, null); assert.deepEqual(r.data.errors, []); assert.equal(r.data.known, true);
  r = await admin('GET', '/api/barcode/5000000000001/lookup?cached=1');
  assert.equal(r.data.known, true); assert.equal(r.data.product, null); assert.equal(r.data.cached, true);
  assert.equal(hits.upc, before, 'UPCitemdb was never asked');
});

test('the barcode database exports to a spreadsheet and imports one, for moderators only', async () => {
  const member = client();
  await member('POST', '/api/auth/signup', { username: 'bea', email: 'bea@example.com', password: 'correct horse' });
  for (const [m, u, b] of [['GET', '/api/barcodes/stats'], ['GET', '/api/barcodes/export.csv'], ['POST', '/api/barcodes/import', { csv: 'barcode,title\n5099999000011,X' }]]) {
    assert.equal((await member(m, u, b)).status, 403, u);
  }
  const csv = 'Barcode,Title,Label\n5099999000011,Some Film [Blu-ray] [1971],Arrow\n5051892210034,Dunkirk,Warner\nnot-a-code,No barcode,\n5000000000001,Filled In Over A Miss,Nobody\n';
  let r = await admin('POST', '/api/barcodes/import', { csv });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.added, r.data.already, r.data.skipped], [2, 1, 1]);   // Dunkirk is on the register; a miss can be filled in
  r = await admin('POST', '/api/barcodes/import', { csv: '5099999000028,Another Film [DVD]\n5099999000011,Should Not Replace\n' });   // no header row
  assert.deepEqual([r.data.added, r.data.already, r.data.skipped], [1, 1, 0]);
  assert.equal(r.data.stats.imported, 3);
  // A scan of an imported code is answered from Spine's records, read like any retail title.
  r = await admin('GET', '/api/barcode/5099999000011/lookup?cached=1');
  assert.equal(r.data.known, true); assert.equal(r.data.product.source, 'import'); assert.equal(r.data.parsed.title, 'Some Film');
  assert.equal(r.data.parsed.year, 1971); assert.equal(r.data.parsed.format, 'bluray'); assert.equal(r.data.parsed.label, 'Arrow Video');
  // The export has every barcode Spine knows, and reimporting it adds nothing.
  const exp = await admin('GET', '/api/barcodes/export.csv');
  assert.equal(exp.status, 200);
  const text = String(exp.data);
  assert.match(text.split('\r\n')[0], /^barcode,status,title,label_or_brand,source,updated$/);
  assert.match(text, /\r\n5051892210034,on the register,Dunkirk \(2017\),Warner Bros\.,register,/);
  assert.match(text, /\r\n5099999000011,product,Some Film \[Blu-ray\] \[1971\],Arrow,import,/);
  assert.doesNotMatch(text, /\r\n5051892210034,product,/, 'a disc on the register is listed once, as on the register');
  assert.match(text, /,no source has it,/);
  r = await admin('POST', '/api/barcodes/import', { csv: text });
  assert.equal(r.data.added, 0);
  const stats = (await admin('GET', '/api/barcodes/stats')).data;
  assert.ok(stats.register >= 3 && stats.products >= 5 && stats.unknown >= 1, JSON.stringify(stats));
});
