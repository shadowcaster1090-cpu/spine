import { get, me } from '../api.js';
import { esc, num, poster, cover, filmCard, card, reviewCard, wireReviews, directors, setTitle, I, stars, nameOf, avatar, dateWords, VIA_NAMES, when } from '../ui.js';
import { logSheet } from '../forms.js';

export default async function ({ el, go }) {
  setTitle('');
  const d = await get('/api/home');
  if (!me.user) return landing(el, d);

  const m = d.mine, name = me.user.display_name || me.user.username;
  const hour = new Date().getHours(), greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const feed = me.following.size ? await get('/api/feed?scope=friends').catch(() => ({ items: [] })) : { items: [] };
  const prompts = me.prompts ? await get('/api/prompts').catch(() => ({ items: [] })) : { items: [] };

  el.innerHTML = `<div class="wrap">
    <div class="colhead"><div><div class="eyebrow">${greet}</div><h1 class="big">${esc(name)}</h1></div>
      <div class="end"><button class="btn primary" id="log">${I.plus} Log a film</button><a class="btn" href="/scan">${I.scan} Scan a disc</a></div></div>

    ${prompts.items.length ? `<section class="prompts"><div class="hd"><h2>Waiting for your rating</h2><a class="end dim" href="/streaming">From your services</a></div>
      ${prompts.items.slice(0, 3).map((w) => `<div class="prompt">${poster(w.film)}<div><a class="t" href="/film/${w.film.id}">${esc(w.film.title)}</a><div class="s">Watched on ${esc(VIA_NAMES[w.via] || 'a service')} · ${dateWords(w.watched_on)}</div>
        <div class="acts"><button class="btn sm primary" data-review="${w.id}">Rate or review</button><button class="btn sm ghost" data-dismiss="${w.id}">Not now</button></div></div></div>`).join('')}
      ${prompts.items.length > 3 ? `<p class="dim" style="font-size:13px;margin:12px 0 0">${prompts.items.length - 3} more in <a class="link" href="/diary">your diary</a>.</p>` : ''}</section>` : ''}

    ${!m.films && !m.copies ? `<div class="note-banner info" style="margin-top:20px;display:flex;gap:14px;align-items:center;flex-wrap:wrap"><span style="flex:1;min-width:220px"><b>New here?</b> Bring your Letterboxd diary across in one go, then scan the discs on your shelf.</span><a class="btn sm primary" href="/import">Import Letterboxd</a><a class="btn sm" href="/scan">Scan discs</a></div>` : ''}
    <div class="stat-strip">
      <a href="/diary"><div class="n">${num(m.this_year)}</div><div class="l">Films this year</div></a>
      <a href="/u/${esc(me.user.username)}/films"><div class="n">${num(m.films)}</div><div class="l">Films watched</div></a>
      <a href="/collection"><div class="n">${num(m.copies)}</div><div class="l">Discs on your shelf</div></a>
      <a href="/friends"><div class="n">${num(m.following)}</div><div class="l">Following</div></a>
    </div>

    <section class="sec"><div class="hd"><h2>Friends</h2><a class="end" href="/friends">All activity →</a></div>
      ${feed.items.length ? `<div class="feed">${feed.items.slice(0, 6).map(feedItem).join('')}</div>`
        : me.following.size ? '<div class="empty">Your friends haven’t logged anything yet.</div>'
        : `<div class="empty">You’re not following anyone yet. <a href="/friends/find">Find people</a> to see what they watch and collect.</div>`}</section>

    ${m.watchlist.length ? `<section class="sec"><div class="hd"><h2>Your watchlist</h2><a class="end" href="/watchlist">${num(m.watchlist.length)} films →</a></div><div class="rail posters">${m.watchlist.map((f) => filmCard(f, { badge: false })).join('')}</div></section>` : ''}

    <section class="sec"><div class="hd"><h2>Popular on Spine</h2><a class="end" href="/films?sort=popular">More →</a></div><div class="rail posters">${d.popular.map((f) => filmCard(f)).join('')}</div></section>
    <section class="sec"><div class="hd"><h2>Recently catalogued</h2><a class="end" href="/browse?sort=recent">All editions →</a></div><div class="rail">${d.recent.map(card).join('')}</div></section>
    ${d.reviews.length ? `<section class="sec"><div class="hd"><h2>Recent reviews</h2></div><div class="reviews" id="revs">${d.reviews.slice(0, 4).map((w) => reviewCard(w)).join('')}</div></section>` : ''}
    <div style="height:30px"></div></div>`;

  const rerender = () => go(location.pathname, { replace: true });
  el.querySelector('#log').onclick = () => logSheet({ onSaved: rerender });
  el.onclick = async (ev) => {
    const b = ev.target.closest('[data-review],[data-dismiss]'); if (!b) return;
    if (b.dataset.review) { const w = prompts.items.find((x) => x.id === +b.dataset.review); logSheet({ watch: w, onSaved: rerender }); }
    if (b.dataset.dismiss) { const { post } = await import('../api.js'); await post(`/api/prompts/${b.dataset.dismiss}`, { action: 'dismiss' }); rerender(); }
  };
  const revs = el.querySelector('#revs'); if (revs) wireReviews(revs, (id) => { const w = d.reviews.find((x) => x.id === id); logSheet({ watch: w, onSaved: rerender }); });
}

export function feedItem(x) {
  const u = x.user, who = `${avatar(u, 'sm')}`;
  const name = `<a href="/u/${esc(u.username)}"><b>${esc(nameOf(u))}</b></a>`;
  const t = `<span class="when">${when(x.at)}</span>`;
  let line = '', body = '';
  if (x.type === 'watch') {
    const w = x.watch;
    line = `${name} ${w.review ? 'reviewed' : w.rating ? 'rated' : w.rewatch ? 'rewatched' : 'watched'} ${t}`;
    body = `<div class="body"><a href="/film/${w.film.id}">${poster(w.film)}</a><div><a class="t" href="/film/${w.film.id}">${esc(w.film.title)} <span class="dim" style="font-weight:400;font-size:14px">${w.film.year || ''}</span></a>
      <div class="s">${w.rating ? stars(w.rating / 2, 'sm') : ''}${w.liked ? `<span class="heart on" style="display:inline-flex;width:14px">${I.heart}</span>` : ''}${w.via ? `<span class="via ${esc(w.via)}"><i></i>${w.via === 'dvd' ? (w.edition ? `on ${esc(w.edition.label || 'DVD')}` : 'on DVD') : 'on ' + esc(VIA_NAMES[w.via] || w.via)}</span>` : ''}<span class="dim2">${dateWords(w.watched_on)}</span></div>
      ${w.review ? `<div class="txt clamp${w.spoilers ? ' spoiler' : ''}">${esc(w.review)}</div>` : ''}
      <div class="acts"><button data-like="${w.id}" class="${w.liked_by_me ? 'heart on' : ''}">${w.liked_by_me ? I.heart : I.heartO}<span>${w.likes ? num(w.likes) : 'Like'}</span></button>${w.review ? `<a href="/review/${w.id}">Read</a>` : ''}</div></div></div>`;
  } else if (['copy', 'want', 'watchlist', 'like'].includes(x.type)) {
    const all = [x.edition || x.film, ...(x.more || [])];
    const n = all.length;
    const verb = { copy: n > 1 ? `added ${n} discs to their shelf` : 'added to their shelf', want: n > 1 ? `wants ${n} editions` : 'wants', watchlist: n > 1 ? `added ${n} films to their watchlist` : 'added to their watchlist', like: n > 1 ? `liked ${n} films` : 'liked' }[x.type];
    line = `${name} ${verb} ${t}`;
    const isEd = x.type === 'copy' || x.type === 'want';
    body = n === 1
      ? `<div class="body"><a href="${isEd ? '/release/' : '/film/'}${all[0].id}">${isEd ? cover(all[0]) : poster(all[0])}</a><div><a class="t" href="${isEd ? '/release/' : '/film/'}${all[0].id}">${esc(all[0].title)}</a><div class="s">${isEd ? `<span>${esc(all[0].label || '')} ${esc(all[0].cat_no || '')}</span>` : `${all[0].year || ''}${all[0].directors?.length ? ' · ' + esc(all[0].directors[0].name) : ''}`}</div></div></div>`
      : `<div class="rail posters" style="margin-top:10px;grid-auto-columns:72px;gap:10px;padding-bottom:4px">${all.slice(0, 12).map((it) => `<a href="${isEd ? '/release/' : '/film/'}${it.id}" title="${esc(it.title)}">${isEd ? cover(it) : poster(it)}</a>`).join('')}</div>`;
  } else if (x.type === 'list') {
    line = `${name} updated a list ${t}`;
    body = `<div style="margin-top:8px"><a class="t" href="/list/${x.list.id}" style="font-weight:700;font-size:17px">${esc(x.list.title)}</a> <span class="dim">· ${x.list.n} editions</span></div>`;
  } else if (x.type === 'follow') {
    line = `${name} started following <a href="/u/${esc(x.other.username)}"><b>${esc(nameOf(x.other))}</b></a> ${t}`;
  }
  return `<article class="feed-item">${who}<div><div class="who">${line}</div>${body}</div></article>`;
}

function landing(el, d) {
  el.innerHTML = `<div class="wrap">
    <section class="landing">
      <div class="eyebrow">For people who still buy the disc</div>
      <h1>Every film you’ve watched.<br>Every disc you own.</h1>
      <p>Spine is a diary for films and a register for DVD editions. Log what you watch, note whether it was your own copy, follow friends, and keep the shelf in your pocket.</p>
      <div class="btns" style="justify-content:center"><a class="btn primary lg" href="/signup">Create an account</a><a class="btn lg" href="/films">Browse films</a></div>
    </section>
    ${d.featured ? `<div class="hero-film"><div class="bgp" style="background:linear-gradient(135deg, ${d.featured.palette[0]}, ${d.featured.palette[2]})"></div><div class="in">
      <a href="/release/${d.featured.id}">${poster(d.featured)}</a>
      <div><div class="eyebrow">Most wanted edition</div><h1>${esc(d.featured.title)}</h1><div class="by">${directors(d.featured.directors, false)} · ${d.featured.year || ''} · ${esc(d.featured.label || '')} ${esc(d.featured.cat_no || '')}</div>
      <p>${num(d.featured.want)} members are hunting for this disc and ${num(d.featured.have)} have it on the shelf.</p><div class="btns"><a class="btn" href="/release/${d.featured.id}">See the edition</a><a class="btn ghost" href="/browse">All editions</a></div></div></div></div>` : ''}
    <div class="features">
      <div><h3>A diary, not a database</h3><p>Log a film in two taps, with a half-star rating, a like, and whether you watched your own DVD, a stream or a print.</p></div>
      <div><h3>Friends</h3><p>See what the people you follow watched this week, how they rated it, and what sits on their shelves.</p></div>
      <div><h3>Scan the barcode</h3><p>Point your phone at the back of a case and the exact edition lands on your shelf, graded and dated.</p></div>
      <div><h3>Streaming, logged</h3><p>Import your Netflix or Prime Video history, or connect Trakt, and Spine asks you to rate what you watched.</p></div>
    </div>
    <section class="sec"><div class="hd"><h2>Popular on Spine</h2><a class="end" href="/films?sort=popular">More →</a></div><div class="rail posters">${d.popular.map((f) => filmCard(f)).join('')}</div></section>
    ${d.reviews.length ? `<section class="sec"><div class="hd"><h2>Recent reviews</h2></div><div class="reviews">${d.reviews.slice(0, 3).map((w) => reviewCard(w)).join('')}</div></section>` : ''}
    <section class="sec"><div class="hd"><h2>Recently catalogued</h2><a class="end" href="/browse">All editions →</a></div><div class="rail">${d.recent.map(card).join('')}</div></section>
    <div style="height:30px"></div></div>`;
  void stars;
}
