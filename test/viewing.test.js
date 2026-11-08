import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseViewingHistory, similarity, normTitle } from '../server/viewing.js';
import { openDb } from '../server/db.js';
import { applyTraktHistory } from '../server/routes/streaming.js';
import { createBareFilm } from '../server/viewing.js';

test('netflix "download all" format: tv episodes and previews skipped, UK dates', () => {
  const csv = 'Title,Date\n"Paris, Texas","03/11/26"\n"Dark: Season 1: Secrets","02/11/26"\n"The Crown: Limited Series: Episode 1","01/11/26"\n"Solaris (4K UHD)","25/12/25"\n';
  const r = parseViewingHistory(csv, { order: 'dmy' });
  assert.deepEqual(r.rows, [{ title: 'Paris, Texas', date: '2026-11-03' }, { title: 'Solaris', date: '2025-12-25' }]);
  assert.equal(r.skipped.tv, 2);
});

test('netflix "get my info" format: autoplayed previews, trailers and short plays skipped', () => {
  const csv = 'Profile Name,Start Time,Duration,Attributes,Title,Supplemental Video Type,Device Type,Bookmark,Latest Bookmark,Country\n' +
    'Sharaf,2026-11-02 21:03:11,01:38:02,,Stalker,,Apple TV,01:38:02,01:38:02,GB (United Kingdom)\n' +
    'Sharaf,2026-11-02 20:59:00,00:00:31,Autoplayed: user action: None;,Eraserhead,,Apple TV,00:00:31,00:00:31,GB (United Kingdom)\n' +
    'Sharaf,2026-11-01 19:00:00,00:01:50,,Mulholland Drive,TRAILER,Apple TV,00:01:50,00:01:50,GB (United Kingdom)\n' +
    'Sharaf,2026-10-30 19:00:00,00:03:12,,Persona,,iPhone,00:03:12,00:03:12,GB (United Kingdom)\n';
  const r = parseViewingHistory(csv);
  assert.deepEqual(r.rows, [{ title: 'Stalker', date: '2026-11-02' }]);
  assert.equal(r.skipped.previews, 3);
});

test('prime video data-request format', () => {
  const csv = '"Playback Hour","Operating System","Browser","Delivery Type","City","Country","ISP","State","Content Quality Entitled","Entitlement Type","Video Type","Audio Language","Title"\n' +
    '"2026-10-12T20:00:00Z","iOS","","Streaming","London","GB","BT","","HD","Prime","Movie","en","Taxi Driver"\n' +
    '"2026-10-13T20:00:00Z","iOS","","Streaming","London","GB","BT","","HD","Prime","TV Episode","en","Reacher - Season 2 - Ep 3"\n';
  const r = parseViewingHistory(csv);
  assert.deepEqual(r.rows, [{ title: 'Taxi Driver', date: '2026-10-12' }]);
  assert.equal(r.skipped.tv, 1);
});

test('US date order', () => {
  const r = parseViewingHistory('Title,Date\nStalker,11/03/26\n', { order: 'mdy' });
  assert.equal(r.rows[0].date, '2026-11-03');
});

test('title similarity', () => {
  assert.ok(similarity('8 1/2', '8½') < 1);
  assert.ok(similarity('The Third Man', 'Third Man') > 0.95);
  assert.ok(similarity('Stalkr', 'Stalker') > 0.7);
  assert.ok(similarity('Solaris', 'Polaris') < 0.8);
  assert.equal(normTitle('Cléo de 5 à 7'), 'cleo de 5 a 7');
});

test('trakt history maps to films and prompts, idempotently', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (username, email, pass) VALUES ('t', 't@example.com', 'x')").run();
  createBareFilm(db, { title: 'Stalker', year: 1979 });
  const items = [
    { id: 1, watched_at: '2026-11-01T21:00:00.000Z', type: 'movie', movie: { title: 'Stalker', year: 1979, ids: { tmdb: 1398 } } },
    { id: 2, watched_at: '2026-11-02T21:00:00.000Z', type: 'movie', movie: { title: 'Solaris', year: 1972, ids: { tmdb: 593 } } },
    { id: 3, watched_at: '2026-11-02T22:00:00.000Z', type: 'episode', show: { title: 'Dark' } }
  ];
  assert.equal(applyTraktHistory(db, 1, items), 2);
  assert.equal(applyTraktHistory(db, 1, items), 0, 'second sync adds nothing');
  assert.equal(db.prepare('SELECT count(*) n FROM films').get().n, 2);
  assert.equal(db.prepare('SELECT tmdb_id FROM films WHERE title = ?').get('Stalker').tmdb_id, 1398);
  assert.equal(db.prepare("SELECT count(*) n FROM watches WHERE prompt_state = 'pending'").get().n, 2);
  db.close();
});
