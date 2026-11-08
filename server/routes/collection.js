import { requireUser } from '../auth.js';
import { cards, filmsById, watchRows } from '../catalogue.js';
import { parseCsv, toCsv } from '../csv.js';
import { tx } from '../db.js';

export const CONDITIONS = ['', 'M', 'NM', 'VG+', 'VG', 'G', 'F', 'P'];

export default function (r, { db, fail }) {
  const findUser = (name, viewer) => {
    const u = db.prepare('SELECT id, username, role, bio, public_collection, created_at FROM users WHERE username = ?').get(name);
    if (!u) fail(404, 'No member by that name.');
    const own = viewer && viewer.id === u.id;
    return { u, own, visible: own || !!u.public_collection };
  };

  const copyFields = (body, partial) => {
    const out = {};
    const has = (k) => !partial || k in body;
    if (has('disc_cond')) { const c = String(body.disc_cond ?? ''); if (!CONDITIONS.includes(c)) fail(400, 'Disc condition must be M, NM, VG+, VG, G, F or P.'); out.disc_cond = c; }
    if (has('case_cond')) { const c = String(body.case_cond ?? ''); if (!CONDITIONS.includes(c)) fail(400, 'Case condition must be M, NM, VG+, VG, G, F or P.'); out.case_cond = c; }
    if (has('price')) {
      const p = body.price === '' || body.price == null ? null : Number(body.price);
      if (p != null && (!isFinite(p) || p < 0 || p > 1e6)) fail(400, 'Price paid must be a positive number.');
      out.price = p == null ? null : Math.round(p * 100) / 100;
    }
    if (has('acquired')) { const a = String(body.acquired ?? '').trim(); if (a && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(a)) fail(400, 'Write the date acquired as YYYY, YYYY-MM or YYYY-MM-DD.'); out.acquired = a; }
    if (has('notes')) out.notes = String(body.notes ?? '').slice(0, 1000);
    if (has('tags')) out.tags = String(body.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 12).join(', ').slice(0, 300);
    return out;
  };

  const liveEdition = (id) => {
    const e = db.prepare('SELECT id, merged_into FROM editions WHERE id = ?').get(+id);
    if (!e) fail(404, 'That edition is not on the register.');
    return e.merged_into || e.id;
  };

  r.get('/api/users/:name', ({ params, user }) => {
    const { u, own, visible } = findUser(params.name, user);
    const full = db.prepare('SELECT display_name, public_diary, favourites FROM users WHERE id = ?').get(u.id);
    const year = new Date().getFullYear() + '';
    const s = db.prepare(`SELECT (SELECT count(*) FROM copies WHERE user_id = ?) copies,
      (SELECT count(DISTINCT edition_id) FROM copies WHERE user_id = ?) editions,
      (SELECT count(*) FROM wants WHERE user_id = ?) wants,
      (SELECT count(DISTINCT film_id) FROM watches WHERE user_id = ?) films,
      (SELECT count(*) FROM watches WHERE user_id = ? AND substr(watched_on, 1, 4) = ?) this_year,
      (SELECT count(*) FROM watches WHERE user_id = ?) diary,
      (SELECT count(*) FROM watches WHERE user_id = ? AND review != '') reviews,
      (SELECT count(*) FROM watchlist WHERE user_id = ?) watchlist,
      (SELECT count(*) FROM likes WHERE user_id = ?) likes,
      (SELECT count(*) FROM lists WHERE user_id = ? AND (public = 1 OR ?)) lists,
      (SELECT count(*) FROM follows WHERE follower_id = ?) following,
      (SELECT count(*) FROM follows WHERE followed_id = ?) followers,
      (SELECT count(*) FROM submissions WHERE user_id = ? AND status = 'approved') contributions`)
      .get(u.id, u.id, u.id, u.id, u.id, year, u.id, u.id, u.id, u.id, u.id, own ? 1 : 0, u.id, u.id, u.id);
    const favIds = JSON.parse(full.favourites || '[]');
    const favFilms = filmsById(db, favIds);
    const recent = (own || full.public_diary) ? watchRows(db, 'w.user_id = ?', [u.id], user, 6) : [];
    const ratings = db.prepare('SELECT rating, count(*) n FROM watches WHERE user_id = ? AND rating IS NOT NULL GROUP BY rating').all(u.id);
    return {
      user: { ...u, display_name: full.display_name, public_collection: !!u.public_collection, public_diary: !!full.public_diary },
      own, visible, diary_visible: own || !!full.public_diary, stats: s,
      favourites: favIds.map((id) => favFilms[id]).filter(Boolean), recent, ratings,
      following: !!user && !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?').get(user.id, u.id),
      follows_you: !!user && !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?').get(u.id, user.id)
    };
  });

  r.get('/api/users/:name/collection', ({ params, user }) => {
    const { u, visible } = findUser(params.name, user);
    if (!visible) fail(403, `${u.username} keeps their collection private.`);
    const copies = db.prepare('SELECT * FROM copies WHERE user_id = ? ORDER BY id').all(u.id);
    const ids = [...new Set(copies.map((c) => c.edition_id))];
    const eds = ids.length ? cards(db, `e.id IN (${ids.map(() => '?').join(',')})`, ids, 'e.id', 100000) : [];
    const byId = Object.fromEntries(eds.map((e) => [e.id, e]));
    return { items: copies.filter((c) => byId[c.edition_id]).map((c) => ({ copy: c, edition: byId[c.edition_id] })) };
  });

  r.get('/api/users/:name/wants', ({ params, user }) => {
    const { u, visible } = findUser(params.name, user);
    if (!visible) fail(403, `${u.username} keeps their wantlist private.`);
    const wants = db.prepare('SELECT * FROM wants WHERE user_id = ? ORDER BY created_at DESC').all(u.id);
    const ids = wants.map((w) => w.edition_id);
    const eds = ids.length ? cards(db, `e.id IN (${ids.map(() => '?').join(',')})`, ids, 'e.id', 100000) : [];
    const byId = Object.fromEntries(eds.map((e) => [e.id, e]));
    // For each want, the other editions of the same film (useful when the exact one is scarce).
    return {
      items: wants.filter((w) => byId[w.edition_id]).map((w) => ({
        want: w, edition: byId[w.edition_id],
        alternatives: db.prepare('SELECT count(*) n FROM editions WHERE film_id = ? AND id != ? AND merged_into IS NULL').get(byId[w.edition_id].film_id, w.edition_id).n
      }))
    };
  });

  r.post('/api/copies', ({ body, user }) => {
    requireUser(user);
    const editionId = liveEdition(body.edition_id);
    const f = copyFields(body, false);
    const { lastInsertRowid } = db.prepare('INSERT INTO copies (user_id, edition_id, disc_cond, case_cond, price, acquired, notes, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(user.id, editionId, f.disc_cond, f.case_cond, f.price, f.acquired, f.notes, f.tags);
    // Owning it ends the hunt.
    db.prepare('DELETE FROM wants WHERE user_id = ? AND edition_id = ?').run(user.id, editionId);
    return { copy: db.prepare('SELECT * FROM copies WHERE id = ?').get(lastInsertRowid) };
  });

  const ownCopy = (id, user) => {
    requireUser(user);
    const c = db.prepare('SELECT * FROM copies WHERE id = ?').get(+id);
    if (!c || c.user_id !== user.id) fail(404, 'That copy is not in your collection.');
    return c;
  };

  r.patch('/api/copies/:id', ({ params, body, user }) => {
    const c = ownCopy(params.id, user);
    const f = copyFields(body, true);
    const keys = Object.keys(f);
    if (keys.length) db.prepare(`UPDATE copies SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => f[k]), c.id);
    return { copy: db.prepare('SELECT * FROM copies WHERE id = ?').get(c.id) };
  });

  r.delete('/api/copies/:id', ({ params, user }) => {
    const c = ownCopy(params.id, user);
    db.prepare('DELETE FROM copies WHERE id = ?').run(c.id);
    return { ok: true };
  });

  r.post('/api/wants', ({ body, user }) => {
    requireUser(user);
    const editionId = liveEdition(body.edition_id);
    db.prepare('INSERT INTO wants (user_id, edition_id, note) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET note = excluded.note')
      .run(user.id, editionId, String(body.note || '').slice(0, 500));
    return { ok: true };
  });

  r.delete('/api/wants/:id', ({ params, user }) => {
    requireUser(user);
    db.prepare('DELETE FROM wants WHERE user_id = ? AND edition_id = ?').run(user.id, +params.id);
    return { ok: true };
  });

  const HEAD = ['edition_id', 'title', 'year', 'directors', 'label', 'cat_no', 'spine_no', 'region', 'standard', 'barcode', 'disc_condition', 'case_condition', 'price_paid', 'acquired', 'tags', 'notes'];

  r.get('/api/collection/export.csv', ({ user }) => {
    requireUser(user);
    const copies = db.prepare('SELECT * FROM copies WHERE user_id = ? ORDER BY id').all(user.id);
    const ids = [...new Set(copies.map((c) => c.edition_id))];
    const eds = ids.length ? cards(db, `e.id IN (${ids.map(() => '?').join(',')})`, ids, 'e.id', 100000) : [];
    const barcodes = Object.fromEntries(ids.length ? db.prepare(`SELECT id, barcode FROM editions WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((r) => [r.id, r.barcode]) : []);
    const byId = Object.fromEntries(eds.map((e) => [e.id, e]));
    const rows = [HEAD, ...copies.filter((c) => byId[c.edition_id]).map((c) => {
      const e = byId[c.edition_id];
      return [e.id, e.title, e.year, e.directors.map((d) => d.name).join('; '), e.label, e.cat_no, e.spine_no, e.region, e.standard, barcodes[e.id], c.disc_cond, c.case_cond, c.price, c.acquired, c.tags, c.notes];
    })];
    return { __raw: true, body: toCsv(rows), headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="spine-collection-${user.username}.csv"` } };
  });

  r.post('/api/collection/import', ({ body, user }) => {
    requireUser(user);
    const rows = parseCsv(body.csv || '');
    if (rows.length < 2) fail(400, 'The file needs a header row and at least one row of data.');
    const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
    const col = (row, ...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0 && row[i] != null && row[i].trim() !== '') return row[i].trim(); } return ''; };
    if (!['edition_id', 'barcode', 'cat_no', 'catalog_number', 'catalogue_number'].some((h) => head.includes(h))) {
      fail(400, 'Include at least one of these columns: edition_id, barcode, or label and cat_no.');
    }
    const dryRun = !!body.dry_run;
    const result = { added: 0, matched: [], unmatched: [] };
    tx(db, () => {
      rows.slice(1).forEach((row, i) => {
        const line = i + 2;
        let ed = null;
        const id = col(row, 'edition_id');
        const barcode = col(row, 'barcode', 'upc', 'ean').replace(/\D/g, '');
        const cat = col(row, 'cat_no', 'catalog_number', 'catalogue_number');
        const label = col(row, 'label');
        if (id) ed = db.prepare('SELECT id, merged_into FROM editions WHERE id = ?').get(+id);
        if (!ed && barcode) ed = db.prepare('SELECT id, merged_into FROM editions WHERE barcode IN (?, ?) LIMIT 1').get(barcode, barcode.length === 12 ? '0' + barcode : barcode.replace(/^0/, ''));
        if (!ed && cat) ed = db.prepare(`SELECT e.id, e.merged_into FROM editions e LEFT JOIN labels l ON l.id = e.label_id
          WHERE e.cat_no = ? COLLATE NOCASE AND (? = '' OR l.name = ? COLLATE NOCASE) LIMIT 1`).get(cat, label, label);
        if (!ed) { result.unmatched.push({ line, title: col(row, 'title'), barcode, cat_no: cat, label, reason: 'No matching edition on the register' }); return; }
        const editionId = ed.merged_into || ed.id;
        let f;
        try {
          f = copyFields({
            disc_cond: col(row, 'disc_condition', 'disc_cond', 'media_condition'), case_cond: col(row, 'case_condition', 'case_cond', 'sleeve_condition'),
            price: col(row, 'price_paid', 'price'), acquired: col(row, 'acquired', 'date_acquired'), tags: col(row, 'tags'), notes: col(row, 'notes')
          }, false);
        } catch (err) { result.unmatched.push({ line, title: col(row, 'title'), barcode, cat_no: cat, label, reason: err.message }); return; }
        result.matched.push({ line, edition_id: editionId });
        if (!dryRun) {
          db.prepare('INSERT INTO copies (user_id, edition_id, disc_cond, case_cond, price, acquired, notes, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(user.id, editionId, f.disc_cond, f.case_cond, f.price, f.acquired, f.notes, f.tags);
          db.prepare('DELETE FROM wants WHERE user_id = ? AND edition_id = ?').run(user.id, editionId);
          result.added++;
        }
      });
    });
    return result;
  });
}
