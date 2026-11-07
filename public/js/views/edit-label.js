import { get, post, me } from '../api.js';
import { esc, bindForm, setTitle, field, area } from '../ui.js';
import { changed } from '../forms.js';
import { submitted } from './shared-submitted.js';

export default async function ({ el, params, go, needLogin }) {
  if (!me.user) return needLogin();
  const { label: l } = await get(`/api/labels/${params.id}`);
  setTitle(`Edit ${l.name}`);
  el.innerHTML = `<div class="wrap" style="max-width:760px"><div class="crumb mono"><a href="/label/${l.id}">${esc(l.name)}</a> / Edit</div>
    <div class="colhead"><div><h1 class="big">Edit label</h1></div></div>
    <form class="form panel" style="margin-bottom:60px" novalidate>${field('name', 'Name', { value: l.name, attrs: 'required' })}${field('country', 'Country', { value: l.country })}${field('website', 'Website', { type: 'url', value: l.website })}${area('about', 'About', { value: l.about })}
    <div class="err"></div><div class="btns"><button class="btn primary" type="submit">Submit edit</button></div></form></div>`;
  bindForm(el.querySelector('form'), async (v) => {
    const changes = changed(l, v);
    if (!Object.keys(changes).length) throw new Error('Nothing has changed yet.');
    const r = await post('/api/submissions', { kind: 'label_edit', target_id: l.id, payload: { changes } });
    submitted(el, r, `/label/${l.id}`, go);
  });
}
