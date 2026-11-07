import { get, me } from '../api.js';
import { esc, setTitle, when } from '../ui.js';
import { newListModal } from './user.js';

export default async function ({ el }) {
  setTitle('Lists');
  const { items } = await get('/api/lists');
  el.innerHTML = `<div class="wrap"><div class="colhead"><div><div class="eyebrow">Curated by collectors</div><h1 class="big">Lists</h1></div>
    ${me.user ? '<div class="end"><button class="btn primary" data-new>+ New list</button></div>' : ''}</div>
    ${items.length ? `<div class="labelgrid" style="margin-bottom:60px">${items.map((l) => `<a href="/list/${l.id}"><b>${esc(l.title)}</b><span class="mono dim">${esc(l.username)} · ${l.n} edition${l.n === 1 ? '' : 's'} · ${when(l.updated_at)}</span></a>`).join('')}</div>` : '<div class="empty">No lists yet. Start one from any edition page.</div>'}</div>`;
  el.querySelector('[data-new]')?.addEventListener('click', newListModal);
}
