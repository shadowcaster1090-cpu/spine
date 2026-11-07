import { get, post, me } from '../api.js';
import { esc, bindForm, setTitle, area } from '../ui.js';
import { filmFields, readFilm, changed } from '../forms.js';
import { submitted } from './shared-submitted.js';

export default async function ({ el, params, go, needLogin }) {
  if (!me.user) return needLogin();
  const { film: f } = await get(`/api/films/${params.id}`);
  setTitle(`Edit ${f.title}`);
  el.innerHTML = `<div class="wrap" style="max-width:900px">
    <div class="crumb mono"><a href="/film/${f.id}">${esc(f.title)}</a> / Edit film</div>
    <div class="colhead"><div><div class="eyebrow">Film #${f.id} · changes apply to every edition</div><h1 class="big">Edit the film</h1></div></div>
    <form class="form cols panel" style="margin:0 0 60px" novalidate>${filmFields(f)}
      ${area('summary', 'What did you change, and what is your source?', { cls: 'full', attrs: 'rows="2"' })}
      <div class="full err"></div><div class="full btns"><button class="btn primary" type="submit">Submit edit</button><a class="btn ghost" href="/film/${f.id}">Cancel</a></div></form></div>`;
  bindForm(el.querySelector('form'), async (v) => {
    const next = readFilm(v);
    const cur = { ...f, directors: f.directors.map((d) => d.name) };
    const changes = changed(cur, next);
    if (!Object.keys(changes).length) throw new Error('Nothing has changed yet.');
    const r = await post('/api/submissions', { kind: 'film_edit', target_id: f.id, payload: { changes, summary: v.summary } });
    submitted(el, r, `/film/${f.id}`, go);
  });
}
