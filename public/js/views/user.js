import { get, post, del, me } from '../api.js';
import { esc, num, money, card, cover, spineEl, regTag, condTag, stars, when, modal, toast, confirmDialog, setTitle, bindForm, $ } from '../ui.js';
import { copyModal } from '../forms.js';

export default async function view(ctx) {
  const { el, params, needLogin } = ctx;
  if (params.self && !me.user) return needLogin();
  const name = params.self ? me.user.username : params.name;
  const tab = params.tab || 'shelf';
  const p = await get(`/api/users/${encodeURIComponent(name)}`);
  const u = p.user, own = p.own;
  setTitle(own ? (tab === 'wants' ? 'Wantlist' : 'Collection') : u.username);
  const base = `/u/${encodeURIComponent(u.username)}`;
  el.innerHTML = `<div class="wrap">
    <div class="profile"><div class="avatar">${esc(u.username[0])}</div>
      <div style="flex:1;min-width:220px"><div class="eyebrow">${u.role !== 'member' ? esc(u.role) + ' · ' : ''}Member since ${new Date(u.created_at.replace(' ', 'T') + 'Z').getFullYear()}${p.stats.contributions ? ` · ${p.stats.contributions} contributions` : ''}</div>
        <h1 class="big">${esc(u.username)}</h1>${u.bio ? `<p class="dim" style="margin-top:10px;max-width:60ch">${esc(u.bio)}</p>` : ''}</div>
      ${own ? `<div class="btns"><button class="btn sm" data-act="import">Import CSV</button><a class="btn sm" href="/api/collection/export.csv" download>Export CSV</a><a class="btn sm ghost" href="/settings">Settings</a></div>` : ''}
    </div>
    <nav class="tabsbar">
      <a href="${base}" class="${tab === 'shelf' ? 'on' : ''}">Shelf · ${num(p.stats.copies)}</a>
      <a href="${base}/wants" class="${tab === 'wants' ? 'on' : ''}">Wants · ${num(p.stats.wants)}</a>
      <a href="${base}/lists" class="${tab === 'lists' ? 'on' : ''}">Lists · ${num(p.stats.lists)}</a>
      <a href="${base}/reviews" class="${tab === 'reviews' ? 'on' : ''}">Reviews · ${num(p.stats.reviews)}</a>
    </nav>
    <div id="tab"></div><div style="height:60px"></div></div>`;
  const box = $('#tab', el);
  const rerender = () => view(ctx);
  el.onclick = (ev) => { if (ev.target.closest('[data-act="import"]')) importModal(rerender); };

  if (!p.visible && (tab === 'shelf' || tab === 'wants')) { box.innerHTML = `<div class="empty">${esc(u.username)} keeps their collection private.</div>`; return; }
  if (tab === 'shelf') return shelf(box, u, own, rerender);
  if (tab === 'wants') return wants(box, u, own, rerender);
  if (tab === 'lists') return lists(box, u, own);
  box.innerHTML = p.reviews.length ? p.reviews.map((r) => `<div class="review"><div class="who"><span class="stars">${stars(r.rating)}</span><a href="/release/${r.edition_id}"><b>${esc(r.title)}</b></a><span class="dim">${esc(r.label || '')}</span><span class="mono dim">${when(r.updated_at)}</span></div>${r.body ? `<p>${esc(r.body)}</p>` : ''}</div>`).join('') : '<div class="empty">No reviews yet.</div>';
}

const SORTS = {
  label: (a, b) => (a.edition.label || '~').localeCompare(b.edition.label || '~') || (a.edition.spine_no ?? 1e9) - (b.edition.spine_no ?? 1e9),
  director: (a, b) => (a.edition.directors[0]?.name || '~').localeCompare(b.edition.directors[0]?.name || '~') || (a.edition.year || 0) - (b.edition.year || 0),
  year: (a, b) => (a.edition.year || 0) - (b.edition.year || 0),
  title: (a, b) => a.edition.title.localeCompare(b.edition.title),
  added: (a, b) => b.copy.id - a.copy.id
};

async function shelf(box, u, own, rerender) {
  const { items } = await get(`/api/users/${encodeURIComponent(u.username)}/collection`);
  let mode = sessionStorage.getItem('shelf-mode') || 'spines', sort = sessionStorage.getItem('shelf-sort') || 'label', tag = '', q = '';
  const tags = [...new Set(items.flatMap((i) => i.copy.tags.split(',').map((t) => t.trim()).filter(Boolean)))].sort();
  const draw = () => {
    const list = items.filter((i) => (!tag || i.copy.tags.split(',').map((t) => t.trim()).includes(tag)) && (!q || (i.edition.title + ' ' + (i.edition.label || '') + ' ' + i.edition.directors.map((d) => d.name).join(' ')).toLowerCase().includes(q))).sort(SORTS[sort]);
    const count = (fn) => { const o = {}; list.forEach((i) => { const k = fn(i); if (k) o[k] = (o[k] || 0) + 1; }); return o; };
    const bars = (o) => { const arr = Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 10), mx = Math.max(1, ...arr.map((a) => a[1])); return arr.length ? `<div class="bars">${arr.map(([k, v]) => `<div class="r"><span title="${esc(k)}">${esc(k)}</span><div class="tr"><div class="fl" style="width:${v / mx * 100}%"></div></div><span style="text-align:right">${v}</span></div>`).join('')}</div>` : '<p class="dim">—</p>'; };
    const paid = list.reduce((s, i) => s + (i.copy.price || 0), 0);
    const oldest = list.reduce((a, i) => (!a || (i.edition.year && i.edition.year < a.edition.year) ? i : a), null);
    const perRow = Math.max(12, Math.ceil(list.length / Math.ceil(list.length / 22)));
    const rows = []; for (let i = 0; i < list.length; i += perRow) rows.push(list.slice(i, i + perRow));
    const body = !list.length ? (items.length ? '<div class="empty">Nothing matches that filter.</div>' : `<div class="empty">${own ? 'Your shelf is empty. <a href="/add">Scan a barcode</a> or <a href="/browse">browse the register</a> to add your first disc.' : 'Nothing on this shelf yet.'}</div>`)
      : mode === 'spines' ? `<div class="shelf">${rows.map((r) => `<div class="shelfrow">${r.map((i) => spineEl(i.edition)).join('')}</div>`).join('')}</div>`
      : mode === 'covers' ? `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">${list.map((i) => card(i.edition)).join('')}</div>`
      : `<div class="tbl"><table><thead><tr><th>Edition</th><th>Region</th><th>Disc</th><th>Case</th>${own ? '<th class="num">Paid</th>' : ''}<th>Acquired</th><th>Tags</th>${own ? '<th></th>' : ''}</tr></thead><tbody>${list.map((i) => `<tr><td><a class="cellt" href="/release/${i.edition.id}"><div class="thumb">${cover(i.edition)}</div><div><b>${esc(i.edition.title)}</b><span>${esc(i.edition.label || '')} ${esc(i.edition.cat_no)}</span></div></a></td><td>${regTag(i.edition)}</td><td>${condTag(i.copy.disc_cond)}</td><td>${condTag(i.copy.case_cond)}</td>${own ? `<td class="num">${money(i.copy.price)}</td>` : ''}<td class="mono">${esc(i.copy.acquired)}</td><td>${i.copy.tags.split(',').filter((t) => t.trim()).map((t) => `<span class="tag">${esc(t.trim())}</span>`).join(' ')}</td>${own ? `<td class="num"><button class="link" data-edit="${i.copy.id}">Edit</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
    box.innerHTML = `
      <div class="tiles"><div><div class="n">${num(list.length)}</div><div class="l">Copies</div></div>
        <div><div class="n">${own ? '£' + Math.round(paid).toLocaleString('en-GB') : num(new Set(list.map((i) => i.edition.label_id)).size)}</div><div class="l">${own ? 'Paid in total' : 'Labels'}</div></div>
        <div><div class="n">${Object.keys(count((i) => i.edition.region && 'R' + i.edition.region + ' ' + i.edition.standard)).length}</div><div class="l">Region / standard mixes</div></div>
        <div><div class="n">${oldest?.edition.year || '—'}</div><div class="l">Oldest film${oldest ? ' · ' + esc(oldest.edition.title) : ''}</div></div></div>
      <div class="tools">
        <div class="seg">${[['spines', 'Spines'], ['covers', 'Covers'], ['table', 'Table']].map(([v, l]) => `<button class="${mode === v ? 'on' : ''}" data-mode="${v}">${l}</button>`).join('')}</div>
        <select id="s-sort" aria-label="Order">${[['label', 'By label & spine'], ['director', 'By director'], ['year', 'By film year'], ['title', 'By title'], ['added', 'Recently added']].map(([v, l]) => `<option value="${v}"${sort === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        ${tags.length ? `<select id="s-tag" aria-label="Tag"><option value="">All tags</option>${tags.map((t) => `<option${t === tag ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}
        <input type="search" id="s-q" placeholder="Filter this shelf" value="${esc(q)}" aria-label="Filter this shelf">
      </div>
      <div class="colgrid"><div>${body}</div>
        <div class="side"><div class="box"><h3>By region</h3>${bars(count((i) => i.edition.region && `R${i.edition.region} ${i.edition.standard}`))}</div>
          <div class="box"><h3>By decade</h3>${bars(count((i) => i.edition.year && Math.floor(i.edition.year / 10) * 10 + 's'))}</div>
          <div class="box"><h3>By label</h3>${bars(count((i) => i.edition.label))}</div>
          <div class="box"><h3>By disc condition</h3>${bars(count((i) => i.copy.disc_cond || 'Ungraded'))}</div></div></div>`;
    box.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { mode = b.dataset.mode; sessionStorage.setItem('shelf-mode', mode); draw(); });
    $('#s-sort', box).onchange = (e) => { sort = e.target.value; sessionStorage.setItem('shelf-sort', sort); draw(); };
    $('#s-tag', box)?.addEventListener('change', (e) => { tag = e.target.value; draw(); });
    const qi = $('#s-q', box);
    qi.oninput = () => { q = qi.value.toLowerCase(); const pos = qi.selectionStart; draw(); const n = $('#s-q', box); n.focus(); n.setSelectionRange(pos, pos); };
    box.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => { const i = items.find((x) => x.copy.id === +b.dataset.edit); copyModal(i.edition, i.copy, rerender); });
  };
  draw();
}

async function wants(box, u, own, rerender) {
  const { items } = await get(`/api/users/${encodeURIComponent(u.username)}/wants`);
  box.innerHTML = items.length ? `<div class="rows">${items.map(({ edition: e, alternatives }) => `<div class="wrow">
      <a href="/release/${e.id}">${cover(e)}</a>
      <div><a href="/release/${e.id}" class="t">${esc(e.title)}</a><div class="s"><span>${esc(e.label || '')} ${esc(e.cat_no)}</span>${regTag(e)}${e.oop ? '<span class="oop">OOP</span>' : ''}${alternatives ? `<a class="link" href="/film/${e.film_id}">${alternatives} other edition${alternatives > 1 ? 's' : ''}</a>` : ''}</div></div>
      ${own ? `<div class="act btns"><button class="btn sm primary" data-got="${e.id}">I got it</button><button class="btn sm ghost" data-rm="${e.id}">Remove</button></div>` : '<div></div>'}
    </div>`).join('')}</div>` : `<div class="empty">${own ? 'No wants yet. Tap ♡ Want on any edition to start the hunt.' : 'Nothing on this wantlist.'}</div>`;
  box.onclick = async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.rm) { await del(`/api/wants/${b.dataset.rm}`); me.wants.delete(+b.dataset.rm); toast('Removed from wantlist'); rerender(); }
      if (b.dataset.got) copyModal(items.find((i) => i.edition.id === +b.dataset.got).edition, null, rerender);
    } catch (e) { toast(e.message, true); }
  };
}

async function lists(box, u, own) {
  const { items } = await get(`/api/lists?user=${encodeURIComponent(u.username)}`);
  box.innerHTML = `${own ? '<div class="btns" style="margin-bottom:18px"><button class="btn sm primary" data-new>+ New list</button></div>' : ''}
    ${items.length ? `<div class="labelgrid">${items.map((l) => `<a href="/list/${l.id}"><b>${esc(l.title)}</b><span class="mono dim">${l.n} edition${l.n === 1 ? '' : 's'}${l.public ? '' : ' · private'}</span></a>`).join('')}</div>` : '<div class="empty">No lists yet.</div>'}`;
  box.querySelector('[data-new]')?.addEventListener('click', () => newListModal());
}

export function newListModal() {
  modal(`<h2>New list</h2><form class="form"><div class="field"><label for="f-t">Title</label><input id="f-t" name="title" required></div><div class="field"><label for="f-d">Description</label><textarea id="f-d" name="description" rows="3"></textarea></div><label class="check"><input type="checkbox" name="private" value="1"> Keep it private</label><div class="err"></div><div class="btns"><button class="btn primary" type="submit">Create list</button></div></form>`, {
    onMount: (d, close) => bindForm(d.querySelector('form'), async (v) => {
      const r = await post('/api/lists', { title: v.title, description: v.description, public: !v.private });
      close(); history.pushState({}, '', `/list/${r.id}`); dispatchEvent(new PopStateEvent('popstate'));
    })
  });
}

function importModal(done) {
  modal(`<h2>Import a collection</h2>
    <p class="dim">Upload a CSV with a header row. Spine matches each row by <span class="mono">edition_id</span>, then <span class="mono">barcode</span>, then <span class="mono">label</span> + <span class="mono">cat_no</span>. Optional columns: disc_condition, case_condition, price_paid, acquired, tags, notes. A Spine export works as-is.</p>
    <form class="form"><div class="field"><label for="f-csv">CSV file</label><input id="f-csv" type="file" accept=".csv,text/csv" required></div><div id="imp"></div><div class="err"></div>
    <div class="btns"><button class="btn primary" type="submit">Check file</button></div></form>`, {
    wide: true,
    onMount: (d, close) => {
      let text = null, checked = false;
      const form = d.querySelector('form');
      form.querySelector('#f-csv').onchange = () => { checked = false; form.querySelector('[type=submit]').textContent = 'Check file'; d.querySelector('#imp').innerHTML = ''; };
      bindForm(form, async () => {
        const f = form.querySelector('#f-csv').files[0];
        if (!f) throw new Error('Choose a CSV file.');
        text = await f.text();
        if (!checked) {
          const r = await post('/api/collection/import', { csv: text, dry_run: true });
          d.querySelector('#imp').innerHTML = `<p><b>${r.matched.length}</b> rows match editions on the register. ${r.unmatched.length ? `<b>${r.unmatched.length}</b> don’t:` : ''}</p>
            ${r.unmatched.length ? `<div class="tbl" style="max-height:220px"><table><thead><tr><th>Line</th><th>Title</th><th>Barcode / Cat no.</th><th>Why</th></tr></thead><tbody>${r.unmatched.slice(0, 200).map((x) => `<tr><td class="mono">${x.line}</td><td>${esc(x.title)}</td><td class="mono">${esc(x.barcode || x.cat_no)}</td><td class="dim">${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div><p class="dim" style="margin-top:8px">Rows that don’t match are skipped. You can add those editions to the register first, then import again.</p>` : ''}`;
          checked = true;
          if (r.matched.length) form.querySelector('[type=submit]').textContent = `Import ${r.matched.length} ${r.matched.length === 1 ? "copy" : "copies"}`; else checked = false;
          return;
        }
        const r = await post('/api/collection/import', { csv: text });
        close(); toast(`Imported ${r.added} ${r.added === 1 ? "copy" : "copies"}`); done();
      });
    }
  });
}
