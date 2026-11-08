import { get } from '../api.js';
import { esc, filmCard, setTitle, $ } from '../ui.js';

const DECADES = [['', 'All'], ['1920', '20s'], ['1930', '30s'], ['1940', '40s'], ['1950', '50s'], ['1960', '60s'], ['1970', '70s'], ['1980', '80s'], ['1990', '90s'], ['2000', '00s'], ['2010', '10s'], ['2020', '20s']];

export default async function ({ el, query, go }) {
  const q = query.get('q') || '';
  setTitle(q ? `“${q}”` : 'Films');
  document.getElementById('q').value = q;
  const res = await get('/api/films?' + query.toString());
  const people = q.length >= 2 ? await get('/api/people?q=' + encodeURIComponent(q)).catch(() => ({ items: [] })) : { items: [] };
  const set = (k, val) => { const p = new URLSearchParams(query); if (val) p.set(k, val); else p.delete(k); p.delete('page'); go('/films?' + p); };
  el.innerHTML = `<div class="wrap">
    <div class="colhead"><div><div class="eyebrow">The register</div><h1 class="big">${q ? '“' + esc(q) + '”' : 'Films'}</h1></div>
      <div class="end"><div class="segmented"><a class="on" href="/films">Films</a><a href="/browse${q ? '?q=' + encodeURIComponent(q) : ''}">Editions</a><a href="/labels">Labels</a></div></div></div>
    ${people.items.length ? `<div class="friendrow" style="margin-bottom:18px">${people.items.map((p) => `<a href="/u/${esc(p.username)}"><span class="avatar xs" style="--av-a:#888;--av-b:#555">${esc((p.display_name || p.username)[0])}</span>${esc(p.display_name || p.username)} <span class="dim2">@${esc(p.username)}</span></a>`).join('')}</div>` : ''}
    ${q ? '' : `<div class="tools"><div class="chips">${DECADES.map(([v, l]) => `<button class="chip${(query.get('decade') || '') === v ? ' on' : ''}" data-dec="${v}">${l}</button>`).join('')}</div>
      <select id="f-sort" aria-label="Sort">${[['title', 'A–Z'], ['popular', 'Most watched'], ['rating', 'Highest rated'], ['year', 'Newest films'], ['recent', 'Recently added']].map(([v, l]) => `<option value="${v}"${(query.get('sort') || 'title') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <span class="count">${res.total} films</span></div>`}
    ${res.items.length ? `<div class="grid films" id="grid">${res.items.map((f) => filmCard(f)).join('')}</div>${res.pages > res.page ? '<div class="more"><button class="btn" id="more">Show more</button></div>' : ''}`
      : `<div class="empty">No films match${q ? ` “${esc(q)}”` : ''}. ${q ? `Try <a href="/browse?q=${encodeURIComponent(q)}">editions</a>, or <a href="/add">add the DVD</a> and the film comes with it.` : ''}</div>`}
  </div>`;
  el.querySelectorAll('[data-dec]').forEach((b) => b.onclick = () => set('decade', b.dataset.dec));
  $('#f-sort', el)?.addEventListener('change', (e) => set('sort', e.target.value === 'title' ? '' : e.target.value));
  let page = res.page;
  const more = $('#more', el);
  if (more) more.onclick = async () => {
    more.disabled = true;
    const p = new URLSearchParams(query); p.set('page', ++page);
    const r = await get('/api/films?' + p);
    $('#grid', el).insertAdjacentHTML('beforeend', r.items.map((f) => filmCard(f)).join(''));
    if (r.page >= r.pages) more.remove(); else more.disabled = false;
  };
}
