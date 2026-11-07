import { get, post, me } from '../api.js';
import { esc, bindForm, setTitle, area } from '../ui.js';
import { editionFields, readEdition, loadLabels, changed } from '../forms.js';
import { submitted } from './shared-submitted.js';

export default async function ({ el, params, go, needLogin }) {
  if (!me.user) return needLogin();
  const [d, labels] = await Promise.all([get(`/api/editions/${params.id}`), loadLabels()]);
  if (d.redirect) return go(`/release/${d.redirect}/edit`, { replace: true });
  const e = { ...d.edition, label_name: d.label?.name || '' };
  setTitle(`Edit ${d.film.title}`);
  el.innerHTML = `<div class="wrap" style="max-width:900px">
    <div class="crumb mono"><a href="/release/${e.id}">${esc(d.film.title)} · ${esc(e.label_name)} ${esc(e.cat_no)}</a> / Suggest an edit</div>
    <div class="colhead"><div><div class="eyebrow">Edition #${e.id}</div><h1 class="big">Fix the record</h1></div></div>
    <p class="prose">Change only what you can see on the case or disc. ${me.user.role === 'member' ? 'A moderator reviews edits before they go live.' : 'Your edits go live straight away.'} To change the film itself (title, director, year), <a href="/film/${d.film.id}/edit">edit the film</a>.</p>
    <form class="form cols panel" style="margin:20px 0 60px" novalidate>
      ${editionFields(e, labels)}
      ${area('summary', 'What did you change, and how do you know?', { cls: 'full', attrs: 'rows="2" placeholder="Checked against my copy: the back lists a booklet."' })}
      <div class="full err"></div>
      <div class="full btns"><button class="btn primary" type="submit">Submit edit</button><a class="btn ghost" href="/release/${e.id}">Cancel</a></div>
    </form></div>`;
  bindForm(el.querySelector('form'), async (v) => {
    const next = readEdition(v);
    const cur = { ...e, extras: e.extras };
    const changes = changed(cur, next);
    if (!Object.keys(changes).length) throw new Error('Nothing has changed yet.');
    const r = await post('/api/submissions', { kind: 'edition_edit', target_id: e.id, payload: { changes, summary: v.summary } });
    submitted(el, r, `/release/${e.id}`, go);
  });
}
