import { get, post, del, patch, me } from '../api.js';
import { esc, num, money, card, cover, poster, filmCard, spineEl, regTag, condTag, stars, stars10, when, dateWords, viaTag, modal, toast, confirmDialog, setTitle, bindForm, avatar, nameOf, reviewCard, wireReviews, I, plural, $ } from '../ui.js';
import { copyModal, logSheet, followButton, wireFollows } from '../forms.js';

const TABS = [['overview', 'Profile'], ['films', 'Films'], ['diary', 'Diary'], ['reviews', 'Reviews'], ['shelf', 'Shelf'], ['wants', 'Wants'], ['watchlist', 'Watchlist'], ['lists', 'Lists'], ['likes', 'Likes']];

export default async function view(ctx) {
  const { el, params, query, needLogin } = ctx;
  if (params.self && !me.user) return needLogin();
  const name = params.self ? me.user.username : params.name;
  let tab = params.tab || 'overview';
  const p = await get(`/api/users/${encodeURIComponent(name)}`);
  if (tab === 'compare' && (p.own || !me.user)) tab = 'overview';
  const u = p.user, own = p.own, s = p.stats;
  setTitle(own ? ({ shelf: 'Your shelf', wants: 'Wantlist', watchlist: 'Watchlist', diary: 'Diary' }[tab] || 'You') : nameOf(u));
  const base = `/u/${encodeURIComponent(u.username)}`;
  const rerender = () => view(ctx);

  el.innerHTML = `<div class="wrap">
    <div class="profile">${avatar(u, 'xl')}
      <div style="flex:1;min-width:240px">
        <h1>${esc(nameOf(u))}<span class="handle">@${esc(u.username)}</span>${u.role !== 'member' ? ` <span class="pill">${esc(u.role)}</span>` : ''}${p.follows_you && !own ? ' <span class="pill">Follows you</span>' : ''}</h1>
        ${u.bio ? `<p class="bio">${esc(u.bio)}</p>` : ''}
        <div class="pstats">
          <a href="${base}/films"><b>${num(s.films)}</b><small>Films</small></a>
          <a href="${base}/diary"><b>${num(s.this_year)}</b><small>This year</small></a>
          <a href="${base}/shelf"><b>${num(s.copies)}</b><small>Discs</small></a>
          <a href="${own ? '/friends/following' : base}"><b>${num(s.following)}</b><small>Following</small></a>
          <a href="${own ? '/friends/followers' : base}"><b>${num(s.followers)}</b><small>Followers</small></a>
        </div></div>
      <div class="btns">${own ? `<button class="btn primary" id="log">${I.plus} Log</button><a class="btn" href="/settings">Edit profile</a>` : me.user ? `${followButton(u.username, p.following, '')}<a class="btn" href="${base}/compare">Compare</a>` : ''}</div>
    </div>
    <nav class="tabsbar">${TABS.filter(([v]) => !(v === 'wants' && !own && !u.public_collection)).map(([v, l]) => `<a href="${v === 'overview' ? base : base + '/' + v}" class="${tab === v ? 'on' : ''}">${l}</a>`).join('')}${!own && me.user ? `<a href="${base}/compare" class="${tab === 'compare' ? 'on' : ''}">Compare</a>` : ''}</nav>
    <div id="tab"></div><div style="height:60px"></div></div>`;
  wireFollows(el, rerender);
  $('#log', el)?.addEventListener('click', () => logSheet({ onSaved: rerender }));
  const box = $('#tab', el);
  const privateNote = (what) => `<div class="empty">${esc(nameOf(u))} keeps their ${what} private.</div>`;

  if (tab === 'overview') return overview(box, p, u, own, base, rerender);
  if (tab === 'films') { if (!p.diary_visible) return (box.innerHTML = privateNote('diary')); return films(box, u, own, query, base, rerender); }
  if (tab === 'diary') { if (!p.diary_visible) return (box.innerHTML = privateNote('diary')); return diary(box, u, own, query, base, rerender); }
  if (tab === 'reviews') return reviews(box, u, own, rerender);
  if (tab === 'shelf') { if (!p.visible) return (box.innerHTML = privateNote('collection')); return shelf(box, u, own, rerender); }
  if (tab === 'wants') { if (!p.visible) return (box.innerHTML = privateNote('wantlist')); return wants(box, u, own, rerender); }
  if (tab === 'watchlist') { if (!p.diary_visible) return (box.innerHTML = privateNote('watchlist')); return watchlist(box, u, own, rerender); }
  if (tab === 'likes') { if (!p.diary_visible) return (box.innerHTML = privateNote('likes')); return likes(box, u); }
  if (tab === 'lists') return lists(box, u, own);
  if (tab === 'compare') return compare(box, u);
}

async function overview(box, p, u, own, base, rerender) {
  const s = p.stats;
  const bins = Array.from({ length: 10 }, (_, i) => p.ratings.find((h) => h.rating === i + 1)?.n || 0), mx = Math.max(1, ...bins), total = bins.reduce((a, b) => a + b, 0);
  const avg = total ? (bins.reduce((a, n, i) => a + n * (i + 1), 0) / total / 2).toFixed(1) : null;
  box.innerHTML = `<div class="sidegrid">
    <div>
      <section class="sec" style="margin-top:0"><div class="hd"><h2>Favourite films</h2>${own ? '<a class="end" href="/settings#favourites">Edit</a>' : ''}</div>
        ${p.favourites.length ? `<div class="favs">${p.favourites.map((f) => `<a href="/film/${f.id}" title="${esc(f.title)}">${poster(f)}</a>`).join('')}${Array.from({ length: Math.max(0, 4 - p.favourites.length) }).map(() => own ? '<a class="poster empty-slot" href="/settings#favourites">+</a>' : '').join('')}</div>`
          : own ? `<div class="favs">${Array.from({ length: 4 }).map(() => '<a class="poster empty-slot" href="/settings#favourites">+</a>').join('')}</div><p class="dim" style="font-size:13px;margin-top:8px">Pick four films that say who you are.</p>` : '<p class="dim">No favourites chosen yet.</p>'}</section>
      ${p.recent.length ? `<section class="sec"><div class="hd"><h2>Recent activity</h2><a class="end" href="${base}/diary">Diary →</a></div><div class="grid tight">${p.recent.map((w) => filmCard(w.film, { rating: w.rating, badge: false, sub: dateWords(w.watched_on) })).join('')}</div></section>` : p.diary_visible ? `<section class="sec"><div class="hd"><h2>Recent activity</h2></div><div class="empty">${own ? 'Nothing logged yet. Tap Log to add the first film.' : 'Nothing logged yet.'}</div></section>` : ''}
      <section class="sec"><div class="hd"><h2>Recent reviews</h2><a class="end" href="${base}/reviews">All ${num(s.reviews)} →</a></div><div class="reviews" id="rv"></div></section>
    </div>
    <aside>
      <section class="sec" style="margin-top:0"><div class="hd"><h2>Ratings</h2>${avg ? `<span class="end">${avg} average</span>` : ''}</div>
        <div class="box"><div class="histo-wrap">${stars(0.5, 'sm')}<div class="histo" style="flex:1">${bins.map((n, i) => `<i style="height:${Math.max(4, n / mx * 100)}%" title="${(i + 1) / 2} stars: ${n}"></i>`).join('')}</div>${stars(5, 'sm')}</div><p class="dim" style="font-size:12px;margin:8px 0 0">${plural(total, 'rating')}</p></div></section>
      <section class="sec"><div class="hd"><h2>At a glance</h2></div><div class="box"><dl class="kv">
        <dt>Diary entries</dt><dd>${num(s.diary)}</dd><dt>Films this year</dt><dd>${num(s.this_year)}</dd><dt>Reviews</dt><dd>${num(s.reviews)}</dd>
        <dt>Likes</dt><dd>${num(s.likes)}</dd><dt>Watchlist</dt><dd>${num(s.watchlist)}</dd><dt>Editions on shelf</dt><dd>${num(s.editions)}</dd><dt>Wanted</dt><dd>${num(s.wants)}</dd>
        <dt>Contributions</dt><dd>${num(s.contributions)}</dd><dt>Member since</dt><dd>${new Date(u.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</dd></dl></div></section>
    </aside></div>`;
  const rv = $('#rv', box);
  const r = await get(`/api/users/${encodeURIComponent(u.username)}/reviews`).catch(() => ({ items: [] }));
  rv.innerHTML = r.items.length ? r.items.slice(0, 3).map((w) => reviewCard(w, { showUser: false })).join('') : `<div class="empty">${own ? 'You haven’t written a review yet.' : 'No reviews yet.'}</div>`;
  wireReviews(rv, (id) => logSheet({ watch: r.items.find((w) => w.id === id), onSaved: rerender }));
}

async function films(box, u, own, query, base, rerender) {
  const sort = query.get('sort') || 'recent';
  const { items } = await get(`/api/users/${encodeURIComponent(u.username)}/films?sort=${sort}`);
  box.innerHTML = `<div class="tools"><div class="seg">${[['recent', 'Recent'], ['rating', 'Rating'], ['title', 'A–Z'], ['year', 'Year']].map(([v, l]) => `<a href="${base}/films?sort=${v}" class="${sort === v ? 'on' : ''}">${l}</a>`).join('')}</div><span class="count">${plural(items.length, 'film')}</span></div>
    ${items.length ? `<div class="grid films">${items.map((x) => filmCard(x.film, { rating: x.my_rating, badge: false, sub: x.times > 1 ? `×${x.times}` : '' })).join('')}</div>` : `<div class="empty">${own ? 'Log your first film and it will show up here.' : 'No films logged yet.'}</div>`}`;
  void rerender;
}

async function diary(box, u, own, query, base, rerender) {
  const year = query.get('year') || '';
  const r = await get(`/api/users/${encodeURIComponent(u.username)}/diary${year ? '?year=' + year : ''}`);
  const groups = [];
  for (const w of r.items) {
    const key = w.watched_on ? w.watched_on.slice(0, 7) : 'undated';
    if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, items: [] });
    groups[groups.length - 1].items.push(w);
  }
  const monthName = (k) => k === 'undated' ? 'Date unknown' : new Date(k + '-15').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  box.innerHTML = `<div class="tools"><div class="seg"><a href="${base}/diary" class="${!year ? 'on' : ''}">All</a>${r.years.map((y) => `<a href="${base}/diary?year=${y.y}" class="${year === y.y ? 'on' : ''}">${y.y} <span class="dim2">${y.n}</span></a>`).join('')}</div>${own ? '<button class="btn sm primary" id="dlog" style="margin-left:auto">Log a film</button>' : ''}</div>
    ${r.items.length ? `<div class="diary">${groups.map((g) => `<div class="month">${monthName(g.key)}</div><div>${g.items.map((w) => `<div class="dentry">
        <div class="day">${w.watched_on ? +w.watched_on.slice(8, 10) : '—'}</div>
        <a href="/film/${w.film.id}">${poster(w.film)}</a>
        <div style="min-width:0"><a class="t" href="/film/${w.film.id}">${esc(w.film.title)} <span class="dim" style="font-weight:400">${w.film.year || ''}</span></a>
          <div class="s">${viaTag(w)}${w.rewatch ? `<span title="Rewatch" style="display:inline-flex;width:13px">${I.repeat}</span>` : ''}${w.review ? `<a href="/review/${w.id}" class="link">Review</a>` : ''}${w.source !== 'manual' ? '<span class="pill">imported</span>' : ''}</div></div>
        <div class="r">${w.rating ? stars10(w.rating) : '<span class="dim2" style="font-size:12px">unrated</span>'}${w.liked ? `<span class="heart on" style="display:inline-flex;width:16px">${I.heart}</span>` : ''}${own ? `<button class="btn sm ghost" data-edit="${w.id}">Edit</button>` : ''}</div>
      </div>`).join('')}</div>`).join('')}</div>` : `<div class="empty">${own ? 'Your diary is empty. Log a film, <a href="/import">import your Letterboxd history</a>, or <a href="/streaming">connect a streaming service</a>.' : 'Nothing in the diary yet.'}</div>`}`;
  $('#dlog', box)?.addEventListener('click', () => logSheet({ onSaved: rerender }));
  box.onclick = (ev) => { const b = ev.target.closest('[data-edit]'); if (b) logSheet({ watch: r.items.find((w) => w.id === +b.dataset.edit), onSaved: rerender }); };
}

async function reviews(box, u, own, rerender) {
  const { items } = await get(`/api/users/${encodeURIComponent(u.username)}/reviews`);
  box.innerHTML = items.length ? `<div class="reviews">${items.map((w) => reviewCard(w, { showUser: false })).join('')}</div>` : `<div class="empty">${own ? 'You haven’t written a review yet. Add one when you log a film.' : 'No reviews yet.'}</div>`;
  wireReviews(box, (id) => logSheet({ watch: items.find((w) => w.id === id), onSaved: rerender }));
}

async function watchlist(box, u, own, rerender) {
  const { items } = await get(`/api/users/${encodeURIComponent(u.username)}/watchlist`);
  box.innerHTML = items.length ? `<p class="dim" style="margin-bottom:14px">${plural(items.length, 'film')} to watch.</p><div class="grid films">${items.map((x) => `<div style="position:relative">${filmCard(x.film, { badge: false })}${own ? `<div class="btns" style="margin-top:6px"><button class="btn sm" data-log="${x.film.id}">Watched</button><button class="btn sm ghost" data-rm="${x.film.id}" aria-label="Remove">×</button></div>` : ''}</div>`).join('')}</div>`
    : `<div class="empty">${own ? 'Nothing on your watchlist. Tap the clock on any film to add it.' : 'An empty watchlist.'}</div>`;
  box.onclick = async (ev) => {
    const b = ev.target.closest('[data-log],[data-rm]'); if (!b) return;
    if (b.dataset.log) return logSheet({ film: items.find((x) => x.film.id === +b.dataset.log).film, onSaved: rerender });
    await del(`/api/films/${b.dataset.rm}/watchlist`); me.watchlist.delete(+b.dataset.rm); toast('Removed'); rerender();
  };
}

async function likes(box, u) {
  const { items } = await get(`/api/users/${encodeURIComponent(u.username)}/likes`);
  box.innerHTML = items.length ? `<div class="grid films">${items.map((f) => filmCard(f, { badge: false })).join('')}</div>` : '<div class="empty">No liked films yet.</div>';
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
    const bars = (o) => { const arr = Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8), mx = Math.max(1, ...arr.map((a) => a[1])); return arr.length ? `<div class="bars">${arr.map(([k, v]) => `<div class="r"><span title="${esc(k)}">${esc(k)}</span><div class="tr"><div class="fl" style="width:${v / mx * 100}%"></div></div><span style="text-align:right">${v}</span></div>`).join('')}</div>` : '<p class="dim">—</p>'; };
    const paid = list.reduce((s, i) => s + (i.copy.price || 0), 0);
    const perRow = Math.max(12, Math.ceil(list.length / Math.max(1, Math.ceil(list.length / 22))));
    const rows = []; for (let i = 0; i < list.length; i += perRow) rows.push(list.slice(i, i + perRow));
    const body = !list.length ? (items.length ? '<div class="empty">Nothing matches that filter.</div>' : `<div class="empty">${own ? 'Your shelf is empty. <a href="/scan">Scan the barcodes</a> on your discs or <a href="/browse">browse the register</a>.' : 'Nothing on this shelf yet.'}</div>`)
      : mode === 'spines' ? `<div class="shelf">${rows.map((r) => `<div class="shelfrow">${r.map((i) => spineEl(i.edition)).join('')}</div>`).join('')}</div>`
      : mode === 'covers' ? `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">${list.map((i) => card(i.edition)).join('')}</div>`
      : `<div class="tbl"><table><thead><tr><th>Edition</th><th>Region</th><th>Disc</th><th>Case</th>${own ? '<th class="num">Paid</th>' : ''}<th>Acquired</th><th>Tags</th>${own ? '<th></th>' : ''}</tr></thead><tbody>${list.map((i) => `<tr><td><a class="cellt" href="/release/${i.edition.id}">${cover(i.edition, 'thumb')}<div><b>${esc(i.edition.title)}</b><span>${esc(i.edition.label || '')} ${esc(i.edition.cat_no)}</span></div></a></td><td>${regTag(i.edition)}</td><td>${condTag(i.copy.disc_cond)}</td><td>${condTag(i.copy.case_cond)}</td>${own ? `<td class="num">${money(i.copy.price)}</td>` : ''}<td class="mono">${esc(i.copy.acquired)}</td><td>${i.copy.tags.split(',').filter((t) => t.trim()).map((t) => `<span class="tag">${esc(t.trim())}</span>`).join(' ')}</td>${own ? `<td class="num"><button class="link" data-edit="${i.copy.id}">Edit</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
    box.innerHTML = `
      <div class="tiles"><div><div class="n">${num(list.length)}</div><div class="l">Discs</div></div>
        <div><div class="n">${own ? '£' + Math.round(paid).toLocaleString('en-GB') : num(new Set(list.map((i) => i.edition.label_id)).size)}</div><div class="l">${own ? 'Paid in total' : 'Labels'}</div></div>
        <div><div class="n">${Object.keys(count((i) => i.edition.region && 'R' + i.edition.region)).length}</div><div class="l">Regions</div></div>
        <div><div class="n">${num(list.filter((i) => me.watched.has(i.edition.film_id)).length)}</div><div class="l">${own ? 'Watched' : 'You’ve watched'}</div></div></div>
      <div class="tools">
        <div class="seg">${[['spines', 'Spines'], ['covers', 'Covers'], ['table', 'Table']].map(([v, l]) => `<button class="${mode === v ? 'on' : ''}" data-mode="${v}">${l}</button>`).join('')}</div>
        <select id="s-sort" aria-label="Order">${[['label', 'By label & spine'], ['director', 'By director'], ['year', 'By film year'], ['title', 'By title'], ['added', 'Recently added']].map(([v, l]) => `<option value="${v}"${sort === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        ${tags.length ? `<select id="s-tag" aria-label="Tag"><option value="">All tags</option>${tags.map((t) => `<option${t === tag ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}
        <input type="search" id="s-q" placeholder="Filter" value="${esc(q)}" aria-label="Filter this shelf" style="max-width:200px">
        ${own ? `<div class="btns" style="margin-left:auto"><a class="btn sm primary" href="/scan">${I.scan} Scan</a><button class="btn sm" data-act="import">Import CSV</button><a class="btn sm ghost" href="/api/collection/export.csv" download>Export</a></div>` : ''}
      </div>
      <div class="colgrid"><div>${body}</div>
        <div class="side"><div class="box"><h3>By label</h3>${bars(count((i) => i.edition.label))}</div><div class="box"><h3>By decade</h3>${bars(count((i) => i.edition.year && Math.floor(i.edition.year / 10) * 10 + 's'))}</div>
          <div class="box"><h3>By region</h3>${bars(count((i) => i.edition.region && `R${i.edition.region} ${i.edition.standard}`))}</div><div class="box"><h3>By disc condition</h3>${bars(count((i) => i.copy.disc_cond || 'Ungraded'))}</div></div></div>`;
    box.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { mode = b.dataset.mode; sessionStorage.setItem('shelf-mode', mode); draw(); });
    $('#s-sort', box).onchange = (e) => { sort = e.target.value; sessionStorage.setItem('shelf-sort', sort); draw(); };
    $('#s-tag', box)?.addEventListener('change', (e) => { tag = e.target.value; draw(); });
    const qi = $('#s-q', box);
    qi.oninput = () => { q = qi.value.toLowerCase(); const pos = qi.selectionStart; draw(); const n = $('#s-q', box); n.focus(); n.setSelectionRange(pos, pos); };
    box.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => { const i = items.find((x) => x.copy.id === +b.dataset.edit); copyModal(i.edition, i.copy, rerender); });
    box.querySelector('[data-act="import"]')?.addEventListener('click', () => importModal(rerender));
  };
  draw();
}

async function wants(box, u, own, rerender) {
  const { items } = await get(`/api/users/${encodeURIComponent(u.username)}/wants`);
  box.innerHTML = items.length ? `<p class="dim" style="margin-bottom:14px">Editions ${own ? 'you’re' : nameOf(u) + ' is'} hunting for.</p><div class="rows">${items.map(({ edition: e, alternatives }) => `<div class="wrow">
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
    ${items.length ? `<div class="labelgrid">${items.map((l) => `<a href="/list/${l.id}"><b>${esc(l.title)}</b><span class="dim" style="font-size:13px">${l.n} edition${l.n === 1 ? '' : 's'}${l.public ? '' : ' · private'}</span></a>`).join('')}</div>` : '<div class="empty">No lists yet.</div>'}`;
  box.querySelector('[data-new]')?.addEventListener('click', () => newListModal());
}

async function compare(box, u) {
  const r = await get(`/api/users/${encodeURIComponent(u.username)}/compare`);
  const n = nameOf(u);
  box.innerHTML = `<div class="tiles" style="grid-template-columns:repeat(3,1fr)"><div><div class="n">${r.taste == null ? '—' : r.taste + '%'}</div><div class="l">Taste match${r.rated ? ` · ${r.rated} films both rated` : ''}</div></div><div><div class="n">${num(r.both.length)}</div><div class="l">Films you’ve both seen</div></div><div><div class="n">${num(r.shared_shelf)}</div><div class="l">Same editions on both shelves</div></div></div>
    ${r.both.length ? `<section class="sec"><div class="hd"><h2>Both watched</h2><span class="end">your rating · theirs</span></div><div class="grid films">${r.both.map((x) => `<div>${filmCard(x.film, { badge: false })}<div class="s" style="display:flex;gap:8px;align-items:center;margin-top:4px;font-size:12px">${x.mine ? stars10(x.mine, 'sm') : '<span class="dim2">—</span>'}<span class="dim2">·</span>${x.theirs ? stars10(x.theirs, 'sm') : '<span class="dim2">—</span>'}</div></div>`).join('')}</div></section>` : ''}
    ${r.theirs_only.length ? `<section class="sec"><div class="hd"><h2>${esc(n)} has seen, you haven’t</h2></div><div class="grid films">${r.theirs_only.map((x) => filmCard(x.film, { rating: x.rating, badge: false })).join('')}</div></section>` : ''}
    ${r.shelf_only_theirs.length ? `<section class="sec"><div class="hd"><h2>On ${esc(n)}’s shelf, not yours</h2></div><div class="grid">${r.shelf_only_theirs.map(card).join('')}</div></section>` : ''}
    ${!r.both.length && !r.theirs_only.length && !r.shelf_only_theirs.length ? '<div class="empty">Not enough in common yet to compare.</div>' : ''}`;
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
            ${r.unmatched.length ? `<div class="tbl" style="max-height:220px"><table><thead><tr><th>Line</th><th>Title</th><th>Barcode / Cat no.</th><th>Why</th></tr></thead><tbody>${r.unmatched.slice(0, 200).map((x) => `<tr><td class="mono">${x.line}</td><td>${esc(x.title)}</td><td class="mono">${esc(x.barcode || x.cat_no)}</td><td class="dim">${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
          checked = true;
          if (r.matched.length) form.querySelector('[type=submit]').textContent = `Import ${r.matched.length} ${r.matched.length === 1 ? 'copy' : 'copies'}`; else checked = false;
          return;
        }
        const r = await post('/api/collection/import', { csv: text });
        close(); toast(`Imported ${r.added} ${r.added === 1 ? 'copy' : 'copies'}`); done();
      });
    }
  });
}
void patch; void when; void confirmDialog; void stars;
