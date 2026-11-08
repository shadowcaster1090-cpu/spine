import { get, me } from '../api.js';
import { esc, num, avatar, nameOf, setTitle, poster, stars10, dateWords, $ } from '../ui.js';
import { followButton, wireFollows, logSheet } from '../forms.js';
import { feedItem } from './home.js';
import { wireReviews } from '../ui.js';

export default async function view(ctx) {
  const { el, params, query, needLogin, go } = ctx;
  if (!me.user) return needLogin();
  const tab = params.tab || 'activity';
  setTitle('Friends');
  el.innerHTML = `<div class="wrap mid">
    <div class="colhead"><div><div class="eyebrow">People you follow</div><h1 class="big">Friends</h1></div>
      <div class="end"><div class="segmented">${[['activity', 'Activity'], ['following', 'Following'], ['followers', 'Followers'], ['find', 'Find people']].map(([v, l]) => `<a href="/friends/${v}" class="${tab === v ? 'on' : ''}">${l}</a>`).join('')}</div></div></div>
    <div id="fb"></div><div style="height:40px"></div></div>`;
  const box = $('#fb', el);
  wireFollows(box);

  if (tab === 'activity') {
    const scope = query.get('scope') || 'friends';
    const r = await get(`/api/feed?scope=${scope}`);
    box.innerHTML = `<div class="tools"><div class="seg">${[['friends', 'Friends'], ['everyone', 'Everyone'], ['me', 'You']].map(([v, l]) => `<a href="/friends/activity?scope=${v}" class="${scope === v ? 'on' : ''}">${l}</a>`).join('')}</div></div>
      ${r.items.length ? `<div class="feed" id="feed">${r.items.map(feedItem).join('')}</div>${r.next ? '<div class="more"><button class="btn" id="more">Older</button></div>' : ''}`
        : r.empty === 'nobody' ? '<div class="empty">You’re not following anyone yet. <a href="/friends/find">Find people</a> whose taste you trust.</div>' : '<div class="empty">Nothing here yet.</div>'}`;
    wireReviews(box, async (id) => { const w = (await get(`/api/watches/${id}`)).watch; logSheet({ watch: w, onSaved: () => view(ctx) }); });
    let next = r.next;
    $('#more', box)?.addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      const r2 = await get(`/api/feed?scope=${scope}&before=${encodeURIComponent(next)}`);
      $('#feed', box).insertAdjacentHTML('beforeend', r2.items.map(feedItem).join(''));
      next = r2.next; if (!next) ev.target.remove(); else ev.target.disabled = false;
    });
    return;
  }

  const personRow = (p) => `<div class="person">${avatar(p, 'lg')}<div style="min-width:0"><a class="n" href="/u/${esc(p.username)}">${esc(nameOf(p))}<small>@${esc(p.username)}</small>${p.follows_you && p.username !== me.user.username ? ' <span class="pill">Follows you</span>' : ''}</a>
      <div class="s">${num(p.stats.films)} films · ${num(p.stats.copies)} discs · ${num(p.stats.reviews)} reviews${p.overlap ? ` · <b>${p.overlap} in common</b>` : ''}</div>
      ${p.last_film?.id ? `<div class="s">Last watched <a href="/film/${p.last_film.id}">${esc(p.last_film.title)}</a> ${p.last_film.rating ? stars10(p.last_film.rating, 'sm') : ''} <span class="dim2">${dateWords(p.last_film.watched_on)}</span></div>` : ''}</div>
      <div class="btns">${p.username === me.user.username ? '' : followButton(p.username, p.following)}</div></div>`;

  if (tab === 'find') {
    const q = query.get('q') || '';
    const [fr, found] = await Promise.all([get('/api/friends'), q.length >= 2 ? get('/api/people?q=' + encodeURIComponent(q)) : { items: [] }]);
    box.innerHTML = `<form class="tools" id="pf"><input type="search" name="q" value="${esc(q)}" placeholder="Search by name or username" style="max-width:360px" aria-label="Search people"><button class="btn">Search</button></form>
      ${q ? `<h3 style="margin:8px 0 10px">${found.items.length ? 'Results' : 'Nobody matches'}</h3>${found.items.length ? `<div class="people">${found.items.map(personRow).join('')}</div>` : `<p class="dim">Ask them to join and share their username, or send them to <span class="mono">${location.origin}/signup</span>.</p>`}` : ''}
      ${fr.suggestions.length ? `<h3 style="margin:28px 0 10px">People you might know</h3><p class="dim" style="margin-top:-6px;margin-bottom:12px;font-size:13px">Ranked by films and discs you have in common.</p><div class="people">${fr.suggestions.map(personRow).join('')}</div>` : ''}
      <div class="panel" style="margin-top:28px"><h3>Invite friends</h3><p class="dim" style="margin:6px 0 12px">Spine is better with the people whose shelves you envy. Send them the sign-up link and follow each other.</p><div class="btns"><button class="btn" id="copylink">Copy invite link</button><a class="btn ghost" href="/signup">Open sign-up page</a></div></div>`;
    $('#pf', box).onsubmit = (ev) => { ev.preventDefault(); go('/friends/find?q=' + encodeURIComponent(new FormData(ev.target).get('q'))); };
    $('#copylink', box).onclick = async () => { try { await navigator.clipboard.writeText(location.origin + '/signup'); const { toast } = await import('../ui.js'); toast('Link copied'); } catch { prompt('Copy this link', location.origin + '/signup'); } };
    return;
  }

  const fr = await get('/api/friends');
  const list = tab === 'following' ? fr.following : fr.followers;
  box.innerHTML = list.length ? `<div class="people">${list.map(personRow).join('')}</div>`
    : `<div class="empty">${tab === 'following' ? 'You don’t follow anyone yet. <a href="/friends/find">Find people</a>.' : 'Nobody follows you yet. Share your profile: <span class="mono">' + location.origin + '/u/' + esc(me.user.username) + '</span>'}</div>`;
  void poster;
}
