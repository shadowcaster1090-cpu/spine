import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

let server, base, db, dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-test-'));
  db = openDb(path.join(dir, 'test.db'));
  server = http.createServer(createApp({ db, uploadsDir: path.join(dir, 'uploads') }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body)
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}

const admin = client(), member = client(), anon = client();
const film = { title: 'Stalker', original_title: 'Сталкер', year: 1979, country: 'USSR', language: 'Russian', runtime: 162, aspect: '1.37:1', directors: ['Andrei Tarkovsky'] };
let editionId, secondId;

test('first account becomes admin; later ones are members', async () => {
  let r = await admin('POST', '/api/auth/signup', { username: 'ada', email: 'ada@example.com', password: 'correct horse' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'admin');
  r = await member('POST', '/api/auth/signup', { username: 'ben', email: 'ben@example.com', password: 'battery staple' });
  assert.equal(r.data.user.role, 'member');
  r = await anon('POST', '/api/auth/signup', { username: 'ben', email: 'x@example.com', password: 'battery staple' });
  assert.equal(r.status, 409);
  r = await anon('POST', '/api/auth/login', { login: 'ben', password: 'wrong password' });
  assert.equal(r.status, 401);
});

test('admin submissions apply immediately and create film, label and search entry', async () => {
  const r = await admin('POST', '/api/submissions', { kind: 'edition', payload: { film, label_name: 'Halide Collection', cat_no: 'HAL-112', spine_no: 112, region: '1', standard: 'NTSC', barcode: '715515012345', extras: ['Commentary', 'Booklet'] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, 'approved');
  editionId = r.data.result_id;
  const s = await anon('GET', '/api/editions?q=tarkov');
  assert.equal(s.data.total, 1);
  assert.equal(s.data.items[0].directors[0].name, 'Andrei Tarkovsky');
  const fuzzy = await anon('GET', '/api/editions?q=stalkr');
  assert.equal(fuzzy.data.items[0]?.id, editionId, 'typo still finds it');
  const bc = await anon('GET', '/api/barcode/715515012345');
  assert.equal(bc.data.items.length, 1);
});

test('member submissions wait for moderation, then notify', async () => {
  let r = await member('POST', '/api/submissions', { kind: 'edition', payload: { film_id: (await anon('GET', `/api/editions/${editionId}`)).data.film.id, label_name: 'Nitrate Archive', cat_no: 'NIT-008', region: '2', standard: 'PAL' } });
  assert.equal(r.data.status, 'pending');
  const subId = r.data.id;
  r = await member('POST', `/api/submissions/${subId}/approve`, {});
  assert.equal(r.status, 403);
  r = await admin('GET', '/api/submissions?status=pending');
  assert.equal(r.data.items.length, 1);
  r = await admin('POST', `/api/submissions/${subId}/approve`, { note: 'Thanks' });
  secondId = r.data.result_id;
  r = await member('GET', '/api/notifications');
  assert.match(r.data.items[0].text, /approved/);
});

test('a scanned unknown disc goes on the shelf once approved', async () => {
  const filmId = (await anon('GET', `/api/editions/${editionId}`)).data.film.id;
  let r = await member('POST', '/api/submissions', { kind: 'edition', payload: { film_id: filmId, label_name: 'Silver Salt', cat_no: 'SSA-1', region: '2', standard: 'PAL', barcode: '5012345678900', add_to_shelf: true } });
  assert.equal(r.data.status, 'pending');
  r = await member('GET', '/api/barcode/5012345678900');
  assert.equal(r.data.items.length, 0);
  assert.equal(r.data.pending.mine, true, 'scanner learns it is already waiting for review');
  r = await admin('POST', `/api/submissions/${(await admin('GET', '/api/submissions')).data.items.at(-1).id}/approve`, {});
  const id = r.data.result_id;
  r = await member('GET', '/api/me/ids');
  assert.ok(r.data.copies.includes(id));
  r = await member('GET', '/api/notifications');
  assert.match(r.data.items[0].text, /added to your shelf/);
  // UPC-A and its EAN-13 form are the same disc
  r = await anon('GET', '/api/barcode/0715515012345');
  assert.equal(r.data.items[0]?.id, editionId);
  r = await member('POST', '/api/submissions', { kind: 'edition', payload: { film_id: filmId, label_name: 'X', region: '1', barcode: '0715515012345' } });
  assert.equal(r.status, 409);
});

test('bad input is refused with a readable message', async () => {
  let r = await admin('POST', '/api/submissions', { kind: 'edition', payload: { film, label_name: 'X', region: '9' } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /region/i);
  r = await admin('POST', '/api/submissions', { kind: 'edition', payload: { film, label_name: 'X', region: '1', barcode: '715515012345' } });
  assert.equal(r.status, 409);
});

test('edits record history', async () => {
  await admin('POST', '/api/submissions', { kind: 'edition_edit', target_id: editionId, payload: { changes: { packaging: 'Snapper', oop: true } } });
  const h = await anon('GET', `/api/editions/${editionId}/history`);
  const edit = h.data.revisions.find((x) => x.after.packaging === 'Snapper');
  assert.ok(edit);
  assert.equal(edit.before.packaging, '');
});

test('collection, wants, CSV round trip and privacy', async () => {
  let r = await member('POST', '/api/wants', { edition_id: editionId });
  assert.equal(r.status, 200);
  r = await member('POST', '/api/copies', { edition_id: editionId, disc_cond: 'NM', case_cond: 'VG+', price: 12.5, acquired: '2024-03', tags: 'tarkovsky, favourite' });
  assert.equal(r.data.copy.tags, 'tarkovsky, favourite');
  r = await member('GET', '/api/users/ben/wants');
  assert.equal(r.data.items.length, 0, 'owning removes the want');
  r = await member('POST', '/api/copies', { edition_id: editionId, disc_cond: 'Mint-ish' });
  assert.equal(r.status, 400);
  const csv = await member('GET', '/api/collection/export.csv');
  assert.match(csv.data, /HAL-112/);
  r = await admin('POST', '/api/collection/import', { csv: 'barcode,label,cat_no,disc_condition,price_paid\n715515012345,,,NM,9\n,Nitrate Archive,NIT-008,VG,\n000000000000,,,,' });
  assert.equal(r.data.added, 2);
  assert.equal(r.data.unmatched.length, 1);
  await member('PATCH', '/api/me', { public_collection: false });
  r = await anon('GET', '/api/users/ben/collection');
  assert.equal(r.status, 403);
  r = await member('GET', '/api/users/ben/collection');
  assert.equal(r.data.items.length, 2, 'scanned disc plus the one added by hand');
});

test('reviews and lists', async () => {
  let r = await member('PUT', `/api/editions/${editionId}/review`, { rating: 5, body: 'Superb.' });
  assert.equal(r.status, 200);
  r = await anon('GET', `/api/editions/${editionId}`);
  assert.equal(r.data.stats.rating, 5);
  r = await member('POST', '/api/lists', { title: 'Tarkovsky on disc', edition_id: editionId });
  const listId = r.data.id;
  await member('POST', `/api/lists/${listId}/items`, { edition_id: secondId, note: 'PAL' });
  await member('PUT', `/api/lists/${listId}/order`, { edition_ids: [secondId, editionId] });
  r = await anon('GET', `/api/lists/${listId}`);
  assert.deepEqual(r.data.items.map((i) => i.edition_id), [secondId, editionId]);
  r = await admin('DELETE', `/api/lists/${listId}`);
  assert.equal(r.status, 403);
});

test('label page lists spine gaps', async () => {
  await admin('POST', '/api/submissions', { kind: 'edition', payload: { film: { title: 'Solaris', year: 1972, directors: ['Andrei Tarkovsky'] }, label_name: 'Halide Collection', cat_no: 'HAL-115', spine_no: 115, region: '1', standard: 'NTSC' } });
  const labels = await anon('GET', '/api/labels');
  const hal = labels.data.items.find((l) => l.name === 'Halide Collection');
  const r = await anon('GET', `/api/labels/${hal.id}`);
  assert.deepEqual(r.data.gaps, [113, 114]);
});

test('merging duplicates moves collections and redirects', async () => {
  const r = await admin('POST', `/api/editions/${secondId}/merge`, { into: editionId });
  assert.equal(r.status, 200);
  const e = await anon('GET', `/api/editions/${secondId}`);
  assert.equal(e.data.redirect, editionId);
  const c = await admin('GET', '/api/users/ada/collection');
  assert.ok(c.data.items.every((i) => i.edition.id === editionId));
});

test('image upload checks the file type', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  let r = await member('POST', `/api/editions/${editionId}/images`, { data: png, kind: 'front' });
  assert.equal(r.status, 200);
  r = await anon('GET', `/api/editions/${editionId}`);
  assert.ok(r.data.edition.cover);
  r = await member('POST', `/api/editions/${editionId}/images`, { data: 'data:image/png;base64,' + Buffer.from('not an image').toString('base64') });
  assert.equal(r.status, 400);
});

test('cross-site writes are refused', async () => {
  const res = await fetch(base + '/api/wants', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('account export and deletion', async () => {
  let r = await member('GET', '/api/me/export');
  assert.equal(r.data.account.username, 'ben');
  r = await member('DELETE', '/api/me', { password: 'nope' });
  assert.equal(r.status, 400);
  r = await member('DELETE', '/api/me', { password: 'battery staple' });
  assert.equal(r.status, 200);
  r = await anon('GET', '/api/users/ben');
  assert.equal(r.status, 404);
  r = await anon('GET', `/api/editions/${editionId}`);
  assert.equal(r.status, 200, 'catalogue entries survive');
});
