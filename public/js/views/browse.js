import { get } from '../api.js';
import { esc, card, setTitle, $ } from '../ui.js';

const DECADES = [['', 'All'], ['1920', '20s'], ['1930', '30s'], ['1940', '40s'], ['1950', '50s'], ['1960', '60s'], ['1970', '70s'], ['1980', '80s'], ['1990', '90s'], ['2000', '00s'], ['2010', '10s']];
const REGIONS = [['', 'All'], ['0', 'R0'], ['1', 'R1'], ['2', 'R2'], ['3', 'R3'], ['4', 'R4']];

export default async function ({ el, query, go }) {
  const q = query.get('q') || '';
  setTitle(q ? `“${q}”` : 'Browse');
  document.getElementById('q').value = q;
  const [labels, res] = await Promise.all([get('/api/labels'), get('/api/editions?' + query.toString())]);
  const set = (k, val) => { const p = new URLSearchParams(query); if (val) p.set(k, val); else p.delete(k); p.delete('page'); go('/browse?' + p); };
  const chips = (k, opts) => opts.map(([v, l]) => `<button class="chip${(query.get(k) || '') === v ? ' on' : ''}" data-k="${k}" data-v="${v}">${l}</button>`).join('');
  el.innerHTML = `<div class="wrap">
    <div class="colhead" style="padding-bottom:0"><div><div class="eyebrow">The register</div><h1 class="big">${q ? '“' + esc(q) + '”' : 'Browse'}</h1></div></div>
    <div class="bar">
      <div class="grp"><span class="eyebrow">Region</span><div class="chips">${chips('region', REGIONS)}</div></div>
      <div class="grp"><span class="eyebrow">Decade</span><div class="chips">${chips('decade', DECADES)}</div></div>
      <div class="grp"><label class="eyebrow" for="b-label">Label</label><select id="b-label"><option value="">All labels</option>${labels.items.filter((l) => l.n).map((l) => `<option value="${l.id}"${query.get('label') == l.id ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
      <div class="grp"><label class="eyebrow" for="b-sort">Sort</label><select id="b-sort">${[['title', 'Title A–Z'], ['year', 'Film year'], ['want', 'Most wanted'], ['have', 'Most collected'], ['recent', 'Recently added']].map(([v, l]) => `<option value="${v}"${(query.get('sort') || 'title') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <label class="check"><input type="checkbox" id="b-oop" ${query.get('oop') === '1' ? 'checked' : ''}> Out of print only</label>
      <div class="count mono">${res.total} edition${res.total === 1 ? '' : 's'}${res.fuzzy ? ' · close matches' : ''}</div>
    </div>
    ${res.items.length ? `<div class="grid" id="grid">${res.items.map(card).join('')}</div>${res.pages > res.page ? '<div class="more"><button class="btn" id="more">Show more</button></div>' : ''}`
      : `<div class="empty">Nothing on the register matches${q ? ` “${esc(q)}”` : ''}. Try fewer filters, or <a href="/add">add the edition yourself</a>.</div>`}
  </div>`;
  el.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => set(b.dataset.k, b.dataset.v));
  $('#b-label', el).onchange = (e) => set('label', e.target.value);
  $('#b-sort', el).onchange = (e) => set('sort', e.target.value === 'title' ? '' : e.target.value);
  $('#b-oop', el).onchange = (e) => set('oop', e.target.checked ? '1' : '');
  let page = res.page;
  const more = $('#more', el);
  if (more) more.onclick = async () => {
    more.disabled = true;
    const p = new URLSearchParams(query); p.set('page', ++page);
    const r = await get('/api/editions?' + p);
    $('#grid', el).insertAdjacentHTML('beforeend', r.items.map(card).join(''));
    if (r.page >= r.pages) more.remove(); else more.disabled = false;
  };
}
