import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { openDb } from '../server/db.js';
import { importLetterboxd, readZip } from '../server/letterboxd.js';
import { createBareFilm } from '../server/viewing.js';

// Builds a real zip (deflated entries) so the reader is exercised end to end.
function zip(entries) {
  const parts = [], central = []; let off = 0;
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text), comp = zlib.deflateRawSync(data), n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc32(data), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, n, comp); central.push(ch, n); off += lh.length + n.length + comp.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(central.length / 2, 8); e.writeUInt16LE(central.length / 2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}

test('letterboxd export zip imports diary, reviews, ratings, likes and watchlist', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (username, email, pass) VALUES ('t', 't@example.com', 'x')").run();
  const stalker = createBareFilm(db, { title: 'Stalker', year: 1979 });
  const files = readZip(zip({
    'diary.csv': 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n2026-11-01,Stalker,1979,https://boxd.it/a,4.5,,,2026-10-31\n2026-11-02,Stalker,1979,https://boxd.it/b,5,Yes,,2026-11-02\n2026-11-03,Yi Yi,2000,https://boxd.it/c,4,,,2026-11-03\n',
    'reviews.csv': 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date\n2026-11-02,Stalker,1979,https://boxd.it/b,5,Yes,"Better every time, ""Zone"" and all.",,2026-11-02\n',
    'watched.csv': 'Date,Name,Year,Letterboxd URI\n2026-11-01,Stalker,1979,https://boxd.it/x\n2025-01-01,Persona,1966,https://boxd.it/y\n',
    'ratings.csv': 'Date,Name,Year,Letterboxd URI,Rating\n2025-01-01,Persona,1966,https://boxd.it/y,3.5\n',
    'watchlist.csv': 'Date,Name,Year,Letterboxd URI\n2026-01-01,Close-Up,1990,https://boxd.it/z\n',
    'likes/films.csv': 'Date,Name,Year,Letterboxd URI\n2026-01-01,Stalker,1979,https://boxd.it/a\n'
  }));
  const plan = importLetterboxd(db, 1, files, { commit: false });
  assert.equal(plan.watches, 4, 'two Stalker entries, Yi Yi, Persona');
  assert.equal(plan.reviews, 1);
  assert.equal(plan.matched, 1); assert.equal(plan.created, 3);
  assert.equal(db.prepare('SELECT count(*) n FROM watches').get().n, 0, 'preview writes nothing');
  const done = importLetterboxd(db, 1, files, { commit: true });
  assert.equal(done.watches, 4);
  const ws = db.prepare('SELECT * FROM watches WHERE film_id = ? ORDER BY watched_on').all(stalker);
  assert.equal(ws.length, 2);
  assert.equal(ws[0].rating, 9); assert.equal(ws[1].rating, 10); assert.equal(ws[1].rewatch, 1);
  assert.match(ws[1].review, /"Zone"/);
  assert.equal(ws[1].liked, 1);
  assert.equal(db.prepare("SELECT rating FROM watches w JOIN films f ON f.id = w.film_id WHERE f.title = 'Persona'").get().rating, 7);
  assert.equal(db.prepare('SELECT count(*) n FROM watchlist').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM likes').get().n, 1);
  const again = importLetterboxd(db, 1, files, { commit: true });
  assert.equal(again.watches, 0); assert.equal(again.skipped, 4, 'importing twice adds nothing');
  db.close();
});
