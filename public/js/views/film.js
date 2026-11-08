import { get, post, del, me } from '../api.js';
import { esc, num, poster, cover, filmCard, directors, stars, stars10, reviewCard, wireReviews, avatar, nameOf, setTitle, toast, I, dateWords, viaTag, plural, regTag } from '../ui.js';
import { logSheet } from '../forms.js';

export default async function view(ctx) {
  const { el, params, go, needLogin } = ctx;
  const [d, fr] = await Promise.all([get(`/api/films/${params.id}`), me.user ? get(`/api/films/${params.id}/friends`) : { watched: [], own: [], watchlist: [], liked: [] }]);
  const f = d.film, s = d.stats, m = d.mine;
  setTitle(`${f.title}${f.year ? ' (' + f.year + ')' : ''}`);
  const rerender = () => view(ctx);
  const seen = m?.watches.length > 0;
  const last = m?.watches[0];
  const myRating = m ? Math.max(0, ...m.watches.map((w) => w.rating || 0)) : 0;

  // Rating histogram, ½ to 5 in ten bins.
  const bins = Array.from({ length: 10 }, (_, i) => d.histogram.find((h) => h.rating === i + 1)?.n || 0);
  const mx = Math.max(1, ...bins);

  el.innerHTML = `<div class="wrap">
    <div class="crumb"><a href="/films">Films</a>${f.directors.length ? ` / <a href="/director/${f.directors[0].id}">${esc(f.directors[0].name)}</a>` : ''}</div>
    <div class="filmhead">
      <div>${poster(f)}

      </div>
      <div>
        <div class="eyebrow">${f.year || ''}${f.country ? ' · ' + esc(f.country) : ''}${f.runtime ? ' · ' + f.runtime + ' min' : ''}${f.aspect ? ' · ' + esc(f.aspect) : ''}</div>
        <h1>${esc(f.title)}</h1>
        ${f.original_title ? `<div class="dim" style="margin-top:4px;font-size:15px">${esc(f.original_title)}</div>` : ''}
        <div class="by">Directed by ${directors(f.directors) || '<span class="dim2">unknown</span>'}${f.language ? ` · ${esc(f.language)}` : ''}</div>
        ${f.synopsis ? `<p class="synopsis">${esc(f.synopsis)}</p>` : ''}
        <div class="actions">
          <button class="btn primary lg" data-act="log">${seen ? I.repeat : I.eye} ${seen ? 'Log again' : 'Log or review'}</button>
          <button class="btn icon ${m?.liked ? 'on heart' : ''}" data-act="like" aria-pressed="${!!m?.liked}" title="Like">${m?.liked ? I.heart : I.heartO}</button>
          <button class="btn icon ${m?.watchlist ? 'on' : ''}" data-act="watchlist" aria-pressed="${!!m?.watchlist}" title="Watchlist">${m?.watchlist ? I.clockF : I.clock}</button>
          <button class="btn icon" data-act="list" title="Add to a list">${I.list}</button>
          ${me.user ? `<a class="btn ghost" href="/film/${f.id}/edit">${I.pen} Edit</a>` : ''}
        </div>
${m ? `<div class="mine-box">${seen ? `<b>${m.watches.length === 1 ? 'Watched once' : plural(m.watches.length, 'time') + ' watched'}</b>, last ${dateWords(last.watched_on)}${last.via ? ' ' + viaTag(last).replace(/<[^>]+>/g, '').trim() : ''}.${myRating ? ` You gave it ${stars10(myRating, 'sm')}` : ''}` : 'You haven’t logged this film.'}
          ${m.copies.length ? `<div style="margin-top:6px">${I.disc.replace('<svg', '<svg style="width:14px;height:14px;display:inline;vertical-align:-2px"')} On your shelf: ${m.copies.map((c) => `<a class="link" href="/release/${c.edition_id}">${esc(c.label || 'DVD')} ${esc(c.cat_no || '')}</a>`).join(', ')}</div>` : ''}</div>` : ''}
        <div class="you" style="margin-top:18px;gap:18px">
          <div class="histo-wrap" title="How members rated it"><div>${s.rating ? `<div style="display:flex;align-items:baseline;gap:8px"><span style="font-size:28px;font-weight:800;letter-spacing:-.03em">${s.rating.toFixed(1)}</span>${stars(s.rating)}<span class="dim" style="font-size:13px">${plural(s.ratings, 'rating')}</span></div>` : '<span class="dim">No ratings yet</span>'}
            <div class="histo" style="margin-top:6px;width:200px">${bins.map((n, i) => `<i style="height:${Math.max(4, n / mx * 100)}%" class="${myRating === i + 1 ? 'mine' : ''}" title="${(i + 1) / 2} stars: ${n}"></i>`).join('')}</div></div></div>
          <div class="dim" style="font-size:13px;line-height:1.7">${plural(s.watchers, 'member')} watched · ${plural(s.likes, 'like')} · ${plural(s.watchlist, 'watchlist')}<br>${plural(s.owners, 'member')} own it on disc · ${plural(d.editions.length, 'edition')}</div>
        </div>
      </div>
    </div>

    <div class="sidegrid">
      <div>
        ${me.user ? `<section class="sec"><div class="hd"><h2>Friends</h2>${fr.nobody ? '<a class="end" href="/friends/find">Find people →</a>' : ''}</div>
          ${fr.watched.length || fr.own.length || fr.watchlist.length ? `
            ${fr.watched.length ? `<div class="friendrow">${fr.watched.map((w) => `<a href="/u/${esc(w.username)}" title="${esc(nameOf(w))}${w.has_review ? ' wrote a review' : ''}">${avatar(w, 'xs')}${esc(nameOf(w))}${w.rating ? stars10(w.rating, 'sm') : ''}${w.liked ? `<span class="heart on" style="display:inline-flex;width:12px">${I.heart}</span>` : ''}</a>`).join('')}</div>` : ''}
            ${fr.own.length ? `<p class="dim" style="margin:12px 0 0;font-size:14px"><b>On friends’ shelves:</b> ${fr.own.map((o) => `<a class="link" href="/u/${esc(o.username)}/shelf">${esc(nameOf(o))}</a> (<a class="link" href="/release/${o.edition_id}">${esc(o.label || 'DVD')} ${esc(o.cat_no || '')}</a>)`).join(', ')}</p>` : ''}
            ${fr.watchlist.length ? `<p class="dim" style="margin:8px 0 0;font-size:14px"><b>Want to see it:</b> ${fr.watchlist.map((o) => `<a class="link" href="/u/${esc(o.username)}">${esc(nameOf(o))}</a>`).join(', ')}</p>` : ''}`
            : `<p class="dim">${fr.nobody ? 'Follow some people and you’ll see who has watched this.' : 'None of your friends have logged this yet.'}</p>`}</section>` : ''}

        ${m?.watches.length ? `<section class="sec"><div class="hd"><h2>Your diary</h2></div><div class="rows">${m.watches.map((w) => `<div class="wrow" style="grid-template-columns:minmax(0,1fr) auto"><div><div class="t">${dateWords(w.watched_on)} ${w.rewatch ? '<span class="pill">rewatch</span>' : ''}</div><div class="s">${w.rating ? stars10(w.rating, 'sm') : '<span>Unrated</span>'}${w.liked ? `<span class="heart on" style="display:inline-flex;width:14px">${I.heart}</span>` : ''}${viaTag(w)}${w.review ? `<span>“${esc(w.review.slice(0, 80))}${w.review.length > 80 ? '…' : ''}”</span>` : ''}</div></div><button class="btn sm" data-edit="${w.id}">Edit</button></div>`).join('')}</div></section>` : ''}

        <section class="sec"><div class="hd"><h2>Reviews</h2><span class="end">${plural(d.reviews.length, 'review')}</span></div>
          ${d.reviews.length ? `<div class="reviews" id="revs">${d.reviews.map((w) => reviewCard(w, { showFilm: false })).join('')}</div>` : `<div class="empty">No reviews yet. ${me.user ? '<button class="link" data-act="log">Be the first.</button>' : ''}</div>`}</section>
      </div>
      <aside>
        <section class="sec" style="margin-top:36px"><div class="hd"><h2>On disc</h2><a class="end" href="/add?film=${f.id}">+ Add</a></div>
          ${d.editions.length ? `<div class="rows">${d.editions.map((e) => `<a class="wrow" href="/release/${e.id}" style="grid-template-columns:40px minmax(0,1fr) auto">${cover(e, 'thumb')}<div><div class="t">${esc(e.label || 'Unknown label')}</div><div class="s">${esc(e.cat_no || '')}${e.packaging ? ' · ' + esc(e.packaging) : ''}${e.release_year ? ' · ' + e.release_year : ''}</div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">${regTag(e)}${me.copies.has(e.id) ? '<span class="pill accent">on shelf</span>' : me.wants.has(e.id) ? '<span class="pill">wanted</span>' : ''}</div></a>`).join('')}</div>` : '<div class="empty">No editions catalogued yet.</div>'}</section>
        ${d.related.length ? `<section class="sec"><div class="hd"><h2>More by ${esc(f.directors[0].name)}</h2></div><div class="grid tight">${d.related.map((x) => filmCard(x)).join('')}</div></section>` : ''}
      </aside>
    </div></div>`;

  el.onclick = async (ev) => {
    const b = ev.target.closest('[data-act],[data-edit]'); if (!b) return;
    if (!me.user) return needLogin();
    try {
      if (b.dataset.edit) return logSheet({ watch: m.watches.find((w) => w.id === +b.dataset.edit), onSaved: rerender });
      const act = b.dataset.act;
      if (act === 'log') return logSheet({ film: f, onSaved: rerender });
      if (act === 'like') { if (m.liked) { await del(`/api/films/${f.id}/like`); me.liked.delete(f.id); } else { await post(`/api/films/${f.id}/like`); me.liked.add(f.id); } return rerender(); }
      if (act === 'watchlist') { if (m.watchlist) { await del(`/api/films/${f.id}/watchlist`); me.watchlist.delete(f.id); toast('Removed from watchlist'); } else { await post(`/api/films/${f.id}/watchlist`); me.watchlist.add(f.id); toast('Added to your watchlist'); } return rerender(); }
      if (act === 'list') {
        if (!d.editions.length) return toast('Lists hold editions. Add a DVD of this film first.', true);
        const { listModal } = await import('./release.js');
        const lists = (await get(`/api/editions/${d.editions[0].id}`)).mine?.lists || [];
        return listModal(d.editions[0].id, lists, rerender);
      }
    } catch (e) { toast(e.message, true); }
  };
  const revs = el.querySelector('#revs'); if (revs) wireReviews(revs, (id) => logSheet({ watch: d.reviews.find((w) => w.id === id), onSaved: rerender }));
  void go; void num;
}
