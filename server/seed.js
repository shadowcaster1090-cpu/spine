// Loads a demo catalogue and two demo members so the app has something to show.
// The films are real; the labels, catalogue numbers and barcodes are invented. Do not ship this data.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, tx } from './db.js';
import { applySubmission } from './catalogue.js';
import { hashPassword } from './auth.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] || path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'spine.db');

const LABELS = {
  'Halide Collection': ['US', 'Restoration-led American label, numbered spines since 1998.'],
  'Silver Salt': ['UK', 'London label specialising in post-war European and Asian cinema.'],
  'Nitrate Archive': ['UK', 'Archival label known for thick booklets and academic commentaries.'],
  'Meridian Video': ['US', 'Region-free cult and arthouse imprint.'],
  'Obsidian': ['HK', 'Hong Kong label, often the first DVD release of Asian classics.'],
  'Lumière Éditions': ['FR', 'Paris label with French-language supplements.']
};
// title, original, directors, year, country, language, runtime, aspect, synopsis, editions
// edition: [label, cat, spine, region, standard, anamorphic, released, discs, packaging, oop, extras]
const X = ['Audio commentary with a film historian', 'New video essay on the film’s visual style', 'Archival interview with the director', 'Restoration demonstration', 'Original theatrical trailer', 'Illustrated booklet with new essay', 'Early short film by the director', 'Making-of documentary', 'Stills and poster gallery', 'Interview with the cinematographer', 'Television documentary from the period'];
const ex = (...i) => i.map((n) => X[n]);
const FILMS = [
  ['In the Mood for Love', '花樣年華', ['Wong Kar-wai'], 2000, 'Hong Kong', 'Cantonese', 98, '1.66:1', 'Two neighbours in 1962 Hong Kong discover their spouses are having an affair.', [['Halide Collection', 'HAL-147', 147, '1', 'NTSC', 1, 2002, 2, 'Digipak', 0, ex(0, 2, 4, 5, 9)], ['Silver Salt', 'SSA-033', 33, '2', 'PAL', 1, 2005, 1, 'Keep case', 1, ex(4, 8)], ['Obsidian', 'OBS-012', 12, '3', 'NTSC', 0, 2001, 1, 'Keep case', 1, ex(4)]]],
  ['Stalker', 'Сталкер', ['Andrei Tarkovsky'], 1979, 'USSR', 'Russian', 162, '1.37:1', 'A guide leads a writer and a scientist into the Zone, where a room is said to grant wishes.', [['Halide Collection', 'HAL-112', 112, '1', 'NTSC', 0, 2006, 2, 'Snapper', 0, ex(0, 3, 9, 10, 5)], ['Nitrate Archive', 'NIT-008', 8, '2', 'PAL', 0, 2002, 2, 'Slipcase + keep case', 1, ex(2, 5, 8)]]],
  ['Paris, Texas', '', ['Wim Wenders'], 1984, 'West Germany', 'English', 147, '1.66:1', 'A man walks out of the desert after four years and tries to reunite his family.', [['Silver Salt', 'SSA-041', 41, '2', 'PAL', 1, 2004, 1, 'Keep case', 0, ex(0, 7, 4)], ['Meridian Video', 'MER-209', 209, '0', 'NTSC', 0, 2001, 1, 'Snapper', 1, ex(4)]]],
  ['Tokyo Story', '東京物語', ['Yasujirō Ozu'], 1953, 'Japan', 'Japanese', 136, '1.37:1', 'An elderly couple visit their grown children in Tokyo and find them too busy to care.', [['Halide Collection', 'HAL-217', 217, '1', 'NTSC', 0, 2003, 2, 'Keep case', 0, ex(0, 10, 5)], ['Nitrate Archive', 'NIT-003', 3, '2', 'PAL', 0, 2005, 1, 'Keep case', 0, ex(5, 2)]]],
  ['Persona', '', ['Ingmar Bergman'], 1966, 'Sweden', 'Swedish', 85, '1.37:1', 'A nurse cares for an actress who has stopped speaking, and their identities begin to merge.', [['Meridian Video', 'MER-118', 118, '0', 'NTSC', 0, 1999, 1, 'Snapper', 1, ex(4)], ['Nitrate Archive', 'NIT-027', 27, '2', 'PAL', 0, 2004, 1, 'Keep case', 0, ex(0, 2, 5)]]],
  ['Chungking Express', '重慶森林', ['Wong Kar-wai'], 1994, 'Hong Kong', 'Cantonese', 102, '1.66:1', 'Two lovesick Hong Kong policemen, a woman in a blonde wig and a snack bar.', [['Halide Collection', 'HAL-453', 453, '1', 'NTSC', 1, 2008, 1, 'Keep case', 0, ex(0, 9, 4)], ['Obsidian', 'OBS-004', 4, '3', 'NTSC', 0, 2000, 1, 'Keep case', 1, ex(4)]]],
  ['La Haine', '', ['Mathieu Kassovitz'], 1995, 'France', 'French', 98, '1.85:1', 'Twenty-four hours with three friends in the Paris banlieue after a riot.', [['Lumière Éditions', 'LUM-014', 14, '2', 'PAL', 1, 2001, 2, 'Digipak', 0, ex(0, 7, 8, 4)], ['Halide Collection', 'HAL-381', 381, '1', 'NTSC', 1, 2007, 2, 'Keep case', 0, ex(0, 2, 7, 3)]]],
  ['Mulholland Drive', '', ['David Lynch'], 2001, 'USA', 'English', 147, '1.85:1', 'An aspiring actress and an amnesiac woman search Los Angeles for answers.', [['Meridian Video', 'MER-305', 305, '1', 'NTSC', 1, 2002, 1, 'Keep case', 0, ex(4)], ['Silver Salt', 'SSA-058', 58, '2', 'PAL', 1, 2006, 1, 'Steelbook', 1, ex(4, 8)]]],
  ['Seven Samurai', '七人の侍', ['Akira Kurosawa'], 1954, 'Japan', 'Japanese', 207, '1.37:1', 'Farmers hire seven masterless samurai to defend their village from bandits.', [['Halide Collection', 'HAL-002', 2, '1', 'NTSC', 0, 1998, 1, 'Keep case', 1, ex(0)], ['Halide Collection', 'HAL-002R', 2, '1', 'NTSC', 0, 2006, 3, 'Digipak', 0, ex(0, 2, 3, 5, 7, 10)], ['Nitrate Archive', 'NIT-001', 1, '2', 'PAL', 0, 2002, 2, 'Slipcase + keep case', 0, ex(5, 2, 8)]]],
  ['8½', '', ['Federico Fellini'], 1963, 'Italy', 'Italian', 138, '1.85:1', 'A film director with creative block retreats into memories and fantasies.', [['Halide Collection', 'HAL-140', 140, '1', 'NTSC', 1, 2001, 2, 'Digipak', 0, ex(0, 7, 10)], ['Nitrate Archive', 'NIT-044', 44, '2', 'PAL', 1, 2006, 1, 'Keep case', 0, ex(5)]]],
  ['Breathless', 'À bout de souffle', ['Jean-Luc Godard'], 1960, 'France', 'French', 90, '1.37:1', 'A small-time thief on the run and an American student in Paris.', [['Lumière Éditions', 'LUM-002', 2, '2', 'PAL', 0, 2000, 1, 'Keep case', 1, ex(4)], ['Halide Collection', 'HAL-408', 408, '1', 'NTSC', 0, 2007, 2, 'Digipak', 0, ex(0, 2, 6, 10, 5)]]],
  ['Yi Yi', '一一', ['Edward Yang'], 2000, 'Taiwan', 'Mandarin', 173, '1.85:1', 'A year in the life of a Taipei family, from a wedding to a funeral.', [['Halide Collection', 'HAL-339', 339, '1', 'NTSC', 1, 2006, 1, 'Keep case', 0, ex(0, 5)], ['Obsidian', 'OBS-021', 21, '3', 'NTSC', 0, 2001, 1, 'Keep case', 1, ex(4)]]],
  ['Cléo from 5 to 7', 'Cléo de 5 à 7', ['Agnès Varda'], 1962, 'France', 'French', 90, '1.66:1', 'A singer wanders Paris for two hours while waiting for a medical result.', [['Halide Collection', 'HAL-073', 73, '1', 'NTSC', 1, 2000, 1, 'Keep case', 0, ex(2, 6, 4)], ['Lumière Éditions', 'LUM-009', 9, '2', 'PAL', 1, 2004, 1, 'Digipak', 0, ex(2, 5)]]],
  ['The Third Man', '', ['Carol Reed'], 1949, 'UK', 'English', 104, '1.37:1', 'A pulp writer arrives in post-war Vienna to find his friend has died.', [['Halide Collection', 'HAL-064', 64, '1', 'NTSC', 0, 1999, 1, 'Keep case', 1, ex(0, 4)], ['Silver Salt', 'SSA-002', 2, '2', 'PAL', 0, 2005, 2, 'Slipcase + keep case', 0, ex(0, 3, 7, 10)]]],
  ['Solaris', 'Солярис', ['Andrei Tarkovsky'], 1972, 'USSR', 'Russian', 167, '2.35:1', 'A psychologist sent to a space station orbiting an ocean planet meets his dead wife.', [['Halide Collection', 'HAL-164', 164, '1', 'NTSC', 1, 2002, 2, 'Keep case', 0, ex(0, 9, 2)], ['Nitrate Archive', 'NIT-012', 12, '2', 'PAL', 1, 2003, 2, 'Slipcase + keep case', 0, ex(5, 2, 10)]]],
  ['Beau Travail', '', ['Claire Denis'], 1999, 'France', 'French', 92, '1.66:1', 'A former Foreign Legion sergeant recalls his jealousy of a young recruit in Djibouti.', [['Nitrate Archive', 'NIT-051', 51, '2', 'PAL', 1, 2006, 1, 'Keep case', 0, ex(5, 2)], ['Lumière Éditions', 'LUM-022', 22, '2', 'PAL', 0, 2000, 1, 'Keep case', 1, ex(4)]]],
  ['Close-Up', 'Nema-ye Nazdik', ['Abbas Kiarostami'], 1990, 'Iran', 'Persian', 98, '1.37:1', 'The real-life case of a man who impersonated a famous director, re-enacted by its participants.', [['Nitrate Archive', 'NIT-019', 19, '2', 'PAL', 0, 2004, 1, 'Keep case', 1, ex(5, 2, 7)]]],
  ['Ugetsu', '雨月物語', ['Kenji Mizoguchi'], 1953, 'Japan', 'Japanese', 97, '1.37:1', 'Two peasants chase wealth and glory during a civil war, at a ghostly cost.', [['Halide Collection', 'HAL-309', 309, '1', 'NTSC', 0, 2005, 2, 'Digipak', 0, ex(0, 7, 5)], ['Nitrate Archive', 'NIT-006', 6, '2', 'PAL', 0, 2001, 1, 'Keep case', 1, ex(5)]]],
  ['Taxi Driver', '', ['Martin Scorsese'], 1976, 'USA', 'English', 114, '1.85:1', 'An insomniac veteran drives a cab through New York at night.', [['Meridian Video', 'MER-077', 77, '1', 'NTSC', 1, 1999, 1, 'Snapper', 0, ex(4, 7)], ['Silver Salt', 'SSA-017', 17, '2', 'PAL', 1, 2007, 2, 'Steelbook', 0, ex(0, 7, 8)]]],
  ['Pather Panchali', 'পথের পাঁচালী', ['Satyajit Ray'], 1955, 'India', 'Bengali', 125, '1.37:1', 'A boy grows up in a poor Bengali village with his sister and parents.', [['Nitrate Archive', 'NIT-033', 33, '2', 'PAL', 0, 2003, 1, 'Keep case', 1, ex(5, 2)]]],
  ['Jeanne Dielman, 23 quai du Commerce, 1080 Bruxelles', '', ['Chantal Akerman'], 1975, 'Belgium', 'French', 201, '1.66:1', 'Three days in the routine of a widowed mother in Brussels.', [['Halide Collection', 'HAL-535', 535, '1', 'NTSC', 1, 2009, 2, 'Digipak', 0, ex(0, 2, 7, 6, 5)]]],
  ['The Red Shoes', '', ['Michael Powell', 'Emeric Pressburger'], 1948, 'UK', 'English', 133, '1.37:1', 'A young ballerina is torn between love and her art.', [['Halide Collection', 'HAL-044', 44, '1', 'NTSC', 0, 1999, 1, 'Keep case', 0, ex(0, 8)], ['Silver Salt', 'SSA-009', 9, '2', 'PAL', 0, 2005, 2, 'Slipcase + keep case', 0, ex(0, 3, 7)]]],
  ['Eraserhead', '', ['David Lynch'], 1977, 'USA', 'English', 89, '1.85:1', 'A man in an industrial wasteland cares for his deformed child.', [['Meridian Video', 'MER-001', 1, '0', 'NTSC', 1, 2001, 1, 'Snapper', 1, ex(2)]]],
  ['Happy Together', '春光乍洩', ['Wong Kar-wai'], 1997, 'Hong Kong', 'Cantonese', 96, '1.85:1', 'A couple from Hong Kong break up and make up in Buenos Aires.', [['Obsidian', 'OBS-009', 9, '3', 'NTSC', 0, 1998, 1, 'Keep case', 1, ex(4)], ['Lumière Éditions', 'LUM-031', 31, '2', 'PAL', 1, 2003, 1, 'Keep case', 0, ex(7, 4)]]]
];

let n = 0;
const barcode = (region) => {
  const body = (region === '2' ? '50' : '7') + String(1e9 + (n++ * 7919) % 9e9).slice(0, region === '2' ? 10 : 10);
  const digits = body.slice(0, 12).padEnd(12, '0');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += +digits[i] * (i % 2 ? 3 : 1);
  return digits + ((10 - sum % 10) % 10);
};

const db = openDb(file);
if (db.prepare('SELECT 1 FROM editions LIMIT 1').get()) {
  console.log('The database already has editions. Seed skipped.');
  process.exit(0);
}

tx(db, () => {
  const mk = (username, email, role, display, bio) => Number(db.prepare('INSERT INTO users (username, email, pass, role, display_name, bio) VALUES (?, ?, ?, ?, ?, ?)')
    .run(username, email, hashPassword('spine-demo'), role, display, bio).lastInsertRowid);
  const admin = mk('demo', 'demo@example.com', 'admin', 'Sharaf', 'Runs the register. Region 2 completist, Tarkovsky and Wong Kar-wai above all.');
  const member = mk('cinephile', 'cinephile@example.com', 'member', 'Mina', 'Mostly Japanese cinema. Ozu on a Sunday afternoon.');
  const nour = mk('nour', 'nour@example.com', 'member', 'Nour', 'French New Wave and anything with a good booklet.');
  const tomas = mk('tomas', 'tomas@example.com', 'member', 'Tomás', 'Lynch, Scorsese, late nights. Still buying snapper cases.');
  for (const [name, [country, about]] of Object.entries(LABELS)) db.prepare('INSERT INTO labels (name, country, about) VALUES (?, ?, ?)').run(name, country, about);

  const ids = {};
  for (const [title, original, directors, year, country, language, runtime, aspect, synopsis, eds] of FILMS) {
    let filmId = null;
    eds.forEach(([label, cat, spine, region, standard, ana, released, discs, pack, oop, extras], i) => {
      const payload = {
        ...(filmId ? { film_id: filmId } : { film: { title, original_title: original, directors, year, country, language, runtime, aspect, synopsis } }),
        label_name: label, cat_no: cat, spine_no: spine, region, standard, anamorphic: ana, release_year: released, discs, disc_type: 'DVD-9',
        packaging: pack, oop, barcode: barcode(region), extras,
        audio: year < 1980 ? `${language} mono (Dolby Digital 1.0)` : `${language} Dolby Digital 5.1 and 2.0`,
        subtitles: language === 'English' ? 'English SDH (optional)' : 'English (optional)'
      };
      const { lastInsertRowid } = db.prepare("INSERT INTO submissions (user_id, kind, payload, status) VALUES (?, 'edition', ?, 'approved')").run(admin, JSON.stringify(payload));
      const id = applySubmission(db, { id: Number(lastInsertRowid), user_id: admin, kind: 'edition', payload: JSON.stringify(payload) }, admin);
      db.prepare('UPDATE submissions SET result_id = ?, reviewer_id = ? WHERE id = ?').run(id, admin, lastInsertRowid);
      filmId = db.prepare('SELECT film_id FROM editions WHERE id = ?').get(id).film_id;
      ids[`${title}#${i}`] = id;
    });
  }
  const e = (t, i = 0) => ids[`${t}#${i}`];

  const own = [['In the Mood for Love', 0, 'NM', 'NM', 18, '2019-03'], ['Stalker', 0, 'M', 'NM', 32, '2020-11'], ['Tokyo Story', 0, 'NM', 'VG+', 14, '2018'],
    ['Persona', 1, 'VG+', 'VG', 6.5, '2017-06'], ['Chungking Express', 0, 'NM', 'NM', 12, '2021'], ['Mulholland Drive', 0, 'VG+', 'VG+', 4, '2016'],
    ['8½', 0, 'NM', 'NM', 15, '2019-08'], ['Cléo from 5 to 7', 0, 'M', 'M', 22, '2022-02'], ['The Third Man', 1, 'NM', 'VG+', 9, '2018-12'],
    ['Solaris', 0, 'NM', 'NM', 20, '2020'], ['Beau Travail', 0, 'NM', 'NM', 11, '2023-05'], ['The Red Shoes', 1, 'NM', 'NM', 16, '2021-04'],
    ['Happy Together', 1, 'VG+', 'VG', 8, '2019'], ['La Haine', 0, 'NM', 'VG+', 13, '2017'], ['Seven Samurai', 1, 'M', 'NM', 28, '2022-10'],
    ['Taxi Driver', 0, 'VG', 'VG', 3, '2015'], ['Breathless', 1, 'NM', 'NM', 17, '2024-01']];
  let k = 0;
  const ago = (days) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 19).replace('T', ' ');
  for (const [t, i, dc, cc, price, acq] of own) db.prepare('INSERT INTO copies (user_id, edition_id, disc_cond, case_cond, price, acquired, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(admin, e(t, i), dc, cc, price, acq, i === 0 && /Stalker|Solaris/.test(t) ? 'tarkovsky, favourite' : '', ago(400 - k++ * 20));
  for (const [t, i] of [['Yi Yi', 0], ['Jeanne Dielman, 23 quai du Commerce, 1080 Bruxelles', 0], ['Close-Up', 0], ['Ugetsu', 1], ['Pather Panchali', 0], ['Eraserhead', 0]]) db.prepare('INSERT INTO wants (user_id, edition_id) VALUES (?, ?)').run(admin, e(t, i));
  for (const [t, i] of [['Tokyo Story', 0], ['Ugetsu', 0], ['Seven Samurai', 2], ['Stalker', 1], ['Yi Yi', 0]]) db.prepare('INSERT INTO copies (user_id, edition_id, disc_cond, case_cond, created_at) VALUES (?, ?, ?, ?, ?)').run(member, e(t, i), 'NM', 'NM', ago(7 + k++ * 9));
  db.prepare('INSERT INTO wants (user_id, edition_id, created_at) VALUES (?, ?, ?)').run(member, e('In the Mood for Love', 0), ago(3));

  // Diaries. Ratings are half-stars (1–10). via 'dvd' entries point at the copy they were watched on.
  const fid = (t) => db.prepare('SELECT film_id FROM editions WHERE id = ?').get(e(t)).film_id;
  const copyOf = (u, t, i) => db.prepare('SELECT id FROM copies WHERE user_id = ? AND edition_id = ?').get(u, e(t, i));
  const log = (u, t, { on, via = 'dvd', i = 0, rating = null, liked = 0, review = '', rewatch = 0, source = 'manual', prompt = 'none', daysAgo = null }) => {
    const c = via === 'dvd' ? copyOf(u, t, i) : null;
    const date = on || new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);
    db.prepare(`INSERT INTO watches (user_id, film_id, watched_on, via, edition_id, copy_id, rewatch, rating, liked, review, source, prompt_state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(u, fid(t), date, via, c ? e(t, i) : (via === 'dvd' ? e(t, i) : null), c ? c.id : null, rewatch, rating, liked, review, source, prompt, date + ' 21:30:00', date + ' 21:30:00');
    if (liked) db.prepare('INSERT OR IGNORE INTO likes (user_id, film_id, created_at) VALUES (?, ?, ?)').run(u, fid(t), date + ' 21:31:00');
  };
  log(admin, 'Stalker', { daysAgo: 3, rating: 10, liked: 1, review: 'The transfer finally keeps the sepia sections warm instead of green. Watched on the Halide two-disc, and the cinematographer interview alone is worth the price. The Zone has never looked more like a place you could walk into.' });
  log(admin, 'In the Mood for Love', { daysAgo: 9, rating: 9, liked: 1, review: 'Lovely colour on this disc. The deleted scenes are the reason to own the Halide edition; the Obsidian one is softer but has the better cover.' });
  log(admin, 'Solaris', { daysAgo: 16, rating: 9, review: 'Slower than I remembered, and better for it.' });
  log(admin, 'La Haine', { daysAgo: 24, rating: 8 });
  log(admin, 'Chungking Express', { daysAgo: 31, rating: 9, liked: 1, rewatch: 1, review: 'Fourth time. California Dreamin’ still works.' });
  log(admin, 'Cléo from 5 to 7', { daysAgo: 40, rating: 9 });
  log(admin, 'The Red Shoes', { i: 1, daysAgo: 55, rating: 10, liked: 1, review: 'The Silver Salt two-disc is the one to own: the restoration demo shows how far gone the negative was.' });
  log(admin, 'Taxi Driver', { daysAgo: 70, rating: 8, rewatch: 1 });
  log(admin, 'Breathless', { i: 1, daysAgo: 95, rating: 7 });
  log(admin, 'Tokyo Story', { daysAgo: 130, rating: 10, liked: 1 });
  // A Netflix import from last week, still waiting for ratings: these show up as prompts when demo opens the app.
  log(admin, 'Mulholland Drive', { daysAgo: 1, via: 'netflix', source: 'import:netflix', prompt: 'pending', rewatch: 1 });
  log(admin, 'Paris, Texas', { daysAgo: 2, via: 'netflix', source: 'import:netflix', prompt: 'pending' });
  log(admin, 'Happy Together', { daysAgo: 6, via: 'netflix', source: 'import:netflix', prompt: 'pending', rewatch: 1 });
  db.prepare("INSERT INTO streaming_accounts (user_id, service, label, last_sync_at) VALUES (?, 'netflix', 'Family account', datetime('now', '-1 day'))").run(admin);
  db.prepare("INSERT INTO watch_imports (user_id, service, rows, logged, skipped, created_at) VALUES (?, 'netflix', 41, 3, 38, datetime('now', '-1 day'))").run(admin);

  log(member, 'Tokyo Story', { daysAgo: 2, rating: 10, liked: 1, review: 'Stable, grain intact, and the commentary is patient and generous. The Halide disc remains the one to own.' });
  log(member, 'Stalker', { i: 1, daysAgo: 5, rating: 8, review: 'Booklet is excellent. PAL speed-up is noticeable in the score if you know the film well.' });
  log(member, 'Ugetsu', { daysAgo: 12, rating: 9, liked: 1 });
  log(member, 'Seven Samurai', { i: 2, daysAgo: 20, rating: 10, liked: 1, review: 'Three and a half hours that feel like ninety minutes.' });
  log(member, 'Yi Yi', { daysAgo: 33, rating: 9 });
  log(member, 'In the Mood for Love', { daysAgo: 48, via: 'mubi', rating: 9, liked: 1 });
  log(member, 'Persona', { daysAgo: 60, via: 'cinema', rating: 8, review: 'Saw it at the BFI on a 35mm print. The film burning through the gate got a gasp.' });

  for (const [t, i] of [['Breathless', 0], ['Cléo from 5 to 7', 1], ['La Haine', 0], ['Beau Travail', 0], ['8½', 1]]) db.prepare('INSERT INTO copies (user_id, edition_id, disc_cond, case_cond, created_at) VALUES (?, ?, ?, ?, ?)').run(nour, e(t, i), 'NM', 'VG+', ago(2 + k++ * 11));
  log(nour, 'Breathless', { daysAgo: 4, rating: 9, liked: 1, review: 'Still the most alive film ever made. The Lumière disc is bare but the transfer is honest.' });
  log(nour, 'Cléo from 5 to 7', { i: 1, daysAgo: 11, rating: 10, liked: 1 });
  log(nour, 'Beau Travail', { daysAgo: 18, rating: 9, review: 'That last scene.' });
  log(nour, 'La Haine', { daysAgo: 27, rating: 8 });
  log(nour, 'Stalker', { daysAgo: 45, via: 'prime', rating: 7, review: 'I think I need to see this properly, on a disc, in the dark.' });
  log(nour, 'Mulholland Drive', { daysAgo: 80, via: 'netflix', rating: 9, liked: 1 });

  for (const [t, i] of [['Mulholland Drive', 0], ['Eraserhead', 0], ['Taxi Driver', 0], ['Paris, Texas', 1], ['The Third Man', 0]]) db.prepare('INSERT INTO copies (user_id, edition_id, disc_cond, case_cond, created_at) VALUES (?, ?, ?, ?, ?)').run(tomas, e(t, i), 'VG+', 'VG', ago(1 + k++ * 13));
  log(tomas, 'Mulholland Drive', { daysAgo: 1, rating: 10, liked: 1, rewatch: 1, review: 'The Meridian snapper case has survived four house moves. Silencio.' });
  log(tomas, 'Eraserhead', { daysAgo: 8, rating: 8, review: 'Mono track on this disc is the right call.' });
  log(tomas, 'Taxi Driver', { daysAgo: 15, rating: 9 });
  log(tomas, 'Paris, Texas', { i: 1, daysAgo: 22, rating: 10, liked: 1 });
  log(tomas, 'Chungking Express', { daysAgo: 50, via: 'netflix', rating: 8 });
  log(tomas, 'The Third Man', { daysAgo: 65, rating: 9 });

  // Who follows whom, watchlists, favourites.
  const follow = (a, b) => db.prepare('INSERT OR IGNORE INTO follows (follower_id, followed_id, created_at) VALUES (?, ?, ?)').run(a, b, ago(30 + k++ * 5));
  follow(admin, member); follow(admin, nour); follow(admin, tomas); follow(member, admin); follow(nour, admin); follow(nour, member); follow(tomas, admin); follow(tomas, nour);
  const wl = (u, t) => db.prepare('INSERT OR IGNORE INTO watchlist (user_id, film_id, created_at) VALUES (?, ?, ?)').run(u, fid(t), ago(k++ * 4));
  wl(admin, 'Jeanne Dielman, 23 quai du Commerce, 1080 Bruxelles'); wl(admin, 'Close-Up'); wl(admin, 'Pather Panchali'); wl(admin, 'Beau Travail');
  wl(member, 'Eraserhead'); wl(member, 'Taxi Driver'); wl(nour, 'Tokyo Story'); wl(nour, 'Yi Yi'); wl(tomas, 'Stalker'); wl(tomas, 'In the Mood for Love');
  const favs = (u, ...ts) => db.prepare('UPDATE users SET favourites = ? WHERE id = ?').run(JSON.stringify(ts.map(fid)), u);
  favs(admin, 'Stalker', 'In the Mood for Love', 'The Red Shoes', 'Tokyo Story');
  favs(member, 'Tokyo Story', 'Seven Samurai', 'Ugetsu', 'Yi Yi');
  favs(nour, 'Cléo from 5 to 7', 'Breathless', 'Beau Travail', 'Mulholland Drive');
  favs(tomas, 'Mulholland Drive', 'Paris, Texas', 'Taxi Driver', 'Eraserhead');
  db.prepare('INSERT INTO review_likes (user_id, watch_id) SELECT ?, id FROM watches WHERE user_id = ? AND review != \'\' LIMIT 3').run(member, admin);
  db.prepare('INSERT INTO review_likes (user_id, watch_id) SELECT ?, id FROM watches WHERE user_id = ? AND review != \'\' LIMIT 2').run(nour, admin);
  db.prepare('INSERT INTO review_likes (user_id, watch_id) SELECT ?, id FROM watches WHERE user_id = ? AND review != \'\' LIMIT 2').run(admin, tomas);

  const list = Number(db.prepare('INSERT INTO lists (user_id, title, description) VALUES (?, ?, ?)').run(admin, 'Region 2 essentials', 'PAL editions that beat their American counterparts on extras or transfer.').lastInsertRowid);
  [['Stalker', 1, 'Two discs, superb booklet.'], ['Seven Samurai', 2, ''], ['The Third Man', 1, 'Better than the early R1.'], ['Solaris', 1, '']].forEach(([t, i, note], pos) =>
    db.prepare('INSERT INTO list_items (list_id, edition_id, position, note) VALUES (?, ?, ?, ?)').run(list, e(t, i), pos, note));

  // One pending edit so the moderation queue has something in it.
  db.prepare("INSERT INTO submissions (user_id, kind, target_id, payload) VALUES (?, 'edition_edit', ?, ?)")
    .run(member, e('Yi Yi', 0), JSON.stringify({ changes: { packaging: 'Keep case with slipcover', extras: [...ex(0, 5), 'Interview with the lead actor'] }, summary: 'My copy has a slipcover and an extra interview' }));
});

console.log(`Seeded ${db.prepare('SELECT count(*) n FROM editions').get().n} editions into ${file}.`);
console.log('Demo sign-ins (password spine-demo): demo (admin), cinephile, nour, tomas.');
db.close();
