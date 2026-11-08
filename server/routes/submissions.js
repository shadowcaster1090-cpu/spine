import { requireUser, requireMod, isMod } from '../auth.js';
import { validateSubmission, applySubmission, notify, getFilmRow } from '../catalogue.js';
import { tx } from '../db.js';

// Members whose work has been approved this many times skip the queue.
export const TRUSTED_AFTER = 10;

export default function (r, { db, fail, rateLimit }) {
  const trusted = (user) => isMod(user) ||
    db.prepare("SELECT count(*) n FROM submissions WHERE user_id = ? AND status = 'approved'").get(user.id).n >= TRUSTED_AFTER;

  const describe = (s) => {
    const p = JSON.parse(s.payload);
    let target = null, current = null;
    if (s.kind === 'edition_edit' && s.target_id) {
      current = db.prepare(`SELECT e.*, f.title, l.name AS label_name FROM editions e JOIN films f ON f.id = e.film_id
        LEFT JOIN labels l ON l.id = e.label_id WHERE e.id = ?`).get(s.target_id);
      if (current) { current.extras = JSON.parse(current.extras); target = `${current.title} · ${current.label_name || ''} ${current.cat_no}`; }
    } else if (s.kind === 'film_edit' && s.target_id) {
      try { current = getFilmRow(db, s.target_id); current.directors = current.directors.map((d) => d.name); target = current.title; } catch { /* deleted */ }
    } else if (s.kind === 'label_edit' && s.target_id) {
      current = db.prepare('SELECT * FROM labels WHERE id = ?').get(s.target_id);
      target = current?.name;
    } else if (s.kind === 'edition') {
      const filmTitle = p.film_id ? db.prepare('SELECT title FROM films WHERE id = ?').get(p.film_id)?.title : p.film?.title;
      target = `${filmTitle || 'Unknown film'} · ${p.label_name || ''} ${p.cat_no || ''}`;
    }
    return { ...s, payload: p, target, current };
  };

  r.post('/api/submissions', ({ body, user }) => {
    requireUser(user);
    rateLimit(String(user.id), 'submit', 120, 60 * 60e3);
    const kind = String(body.kind || '');
    const targetId = body.target_id ? +body.target_id : null;
    const payload = body.payload || {};
    validateSubmission(kind, targetId, payload, db);
    return tx(db, () => {
      const { lastInsertRowid } = db.prepare('INSERT INTO submissions (user_id, kind, target_id, payload) VALUES (?, ?, ?, ?)')
        .run(user.id, kind, targetId, JSON.stringify(payload));
      const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(lastInsertRowid);
      if (trusted(user)) {
        const resultId = applySubmission(db, sub, user.id);
        db.prepare("UPDATE submissions SET status = 'approved', reviewer_id = ?, result_id = ?, note = 'Auto-approved', reviewed_at = datetime('now') WHERE id = ?")
          .run(user.id, resultId, sub.id);
        return { id: sub.id, status: 'approved', result_id: resultId };
      }
      return { id: sub.id, status: 'pending', result_id: null };
    });
  });

  r.get('/api/submissions', ({ query, user }) => {
    requireUser(user);
    const status = query.get('status') || 'pending';
    if (query.get('mine') === '1') {
      const rows = db.prepare('SELECT * FROM submissions WHERE user_id = ? ORDER BY id DESC LIMIT 200').all(user.id);
      return { items: rows.map(describe) };
    }
    requireMod(user);
    const rows = db.prepare(`SELECT s.*, u.username FROM submissions s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.status = ? ORDER BY ${status === 'pending' ? 's.id' : 's.reviewed_at DESC'} LIMIT 200`).all(status);
    return { items: rows.map(describe) };
  });

  const load = (id) => {
    const s = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id);
    if (!s) fail(404, 'No such submission.');
    return s;
  };

  r.post('/api/submissions/:id/approve', ({ params, body, user }) => {
    requireMod(user);
    const s = load(+params.id);
    if (s.status !== 'pending') fail(409, 'That submission has already been reviewed.');
    const note = String(body.note || '').slice(0, 1000);
    const resultId = tx(db, () => {
      const id = applySubmission(db, s, user.id);
      db.prepare("UPDATE submissions SET status = 'approved', reviewer_id = ?, note = ?, result_id = ?, reviewed_at = datetime('now') WHERE id = ?").run(user.id, note, id, s.id);
      const link = s.kind === 'film_edit' ? `/film/${id}` : s.kind === 'label_edit' ? `/label/${id}` : `/release/${id}`;
      const shelved = s.kind === 'edition' && JSON.parse(s.payload).add_to_shelf;
      if (s.user_id && s.user_id !== user.id) notify(db, s.user_id, `Your ${s.kind === 'edition' ? 'new edition' : 'edit'} was approved${shelved ? ' and added to your shelf' : ''}.${note ? ' Note: ' + note : ''}`, link);
      return id;
    });
    return { ok: true, result_id: resultId };
  });

  r.post('/api/submissions/:id/reject', ({ params, body, user }) => {
    requireMod(user);
    const s = load(+params.id);
    if (s.status !== 'pending') fail(409, 'That submission has already been reviewed.');
    const note = String(body.note || '').trim().slice(0, 1000);
    if (!note) fail(400, 'Tell the contributor why, so they can fix it.');
    db.prepare("UPDATE submissions SET status = 'rejected', reviewer_id = ?, note = ?, reviewed_at = datetime('now') WHERE id = ?").run(user.id, note, s.id);
    if (s.user_id && s.user_id !== user.id) notify(db, s.user_id, `Your submission was not accepted: ${note}`, '/contributions');
    return { ok: true };
  });

  r.post('/api/submissions/:id/withdraw', ({ params, user }) => {
    requireUser(user);
    const s = load(+params.id);
    if (s.user_id !== user.id) fail(403, 'You can only withdraw your own submissions.');
    if (s.status !== 'pending') fail(409, 'That submission has already been reviewed.');
    db.prepare("UPDATE submissions SET status = 'rejected', note = 'Withdrawn by contributor', reviewed_at = datetime('now') WHERE id = ?").run(s.id);
    return { ok: true };
  });
}
