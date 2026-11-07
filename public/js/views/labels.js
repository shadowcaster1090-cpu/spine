import { get } from '../api.js';
import { esc, setTitle } from '../ui.js';

export default async function ({ el }) {
  setTitle('Labels');
  const { items } = await get('/api/labels');
  el.innerHTML = `<div class="wrap"><div class="colhead"><div><div class="eyebrow">${items.length} labels</div><h1 class="big">Labels</h1></div></div>
    <div class="labelgrid" style="margin-bottom:60px">${items.map((l) => `<a href="/label/${l.id}"><b>${esc(l.name)}</b><span class="mono dim">${esc(l.country || '—')} · ${l.n} edition${l.n === 1 ? '' : 's'}${l.first ? ` · ${l.first}–${l.last}` : ''}</span></a>`).join('')}</div></div>`;
}
