import { patch, del, get, me, loadMe } from '../api.js';
import { esc, bindForm, toast, setTitle, field, area, poster, modal, $ } from '../ui.js';

export default async function view(ctx) {
  const { el, needLogin, go, refreshHeader } = ctx;
  if (!me.user) return needLogin();
  setTitle('Settings');
  const u = me.user;
  const favs = u.favourites.length ? (await get(`/api/users/${encodeURIComponent(u.username)}`)).favourites : [];
  const { applyTheme } = await import('../app.js');

  el.innerHTML = `<div class="wrap narrow"><div class="colhead"><div><div class="eyebrow">@${esc(u.username)}</div><h1 class="big">Settings</h1></div></div>

    <div class="group-title">Profile</div>
    <form class="inset" id="prof" style="padding:16px">
      <div class="form">${field('display_name', 'Name', { value: u.display_name, attrs: 'maxlength="40" placeholder="How friends see you"' })}${area('bio', 'About you', { value: u.bio, attrs: 'rows="3" maxlength="600"', hint: 'Shown on your profile' })}${field('email', 'Email', { type: 'email', value: u.email, attrs: 'required autocomplete="email"' })}
      <div class="err"></div><div><button class="btn primary" type="submit">Save profile</button></div></div></form>

    <div class="group-title" id="favourites">Favourite films</div>
    <div class="inset" style="padding:16px"><div class="favs" id="favs"></div><p class="group-note" style="margin:10px 0 0">Four films that say who you are. They sit at the top of your profile.</p></div>

    <div class="group-title">Appearance</div>
    <div class="inset"><div class="row"><span class="grow"><span class="t">Theme</span><span class="s">System follows your device</span></span><div class="seg" id="theme">${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button type="button" data-t="${v}" class="${(u.theme || 'system') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>

    <div class="group-title">Privacy & prompts</div>
    <div class="inset">
      <label class="row"><span class="grow"><span class="t">Public collection</span><span class="s">Let other members see your shelf and wantlist</span></span><span class="switch"><input type="checkbox" data-pref="public_collection" ${u.public_collection ? 'checked' : ''}><span></span></span></label>
      <label class="row"><span class="grow"><span class="t">Public diary</span><span class="s">Let other members see your diary, watchlist and likes. Reviews are always public.</span></span><span class="switch"><input type="checkbox" data-pref="public_diary" ${u.public_diary ? 'checked' : ''}><span></span></span></label>
      <label class="row"><span class="grow"><span class="t">Ask me to rate imported films</span><span class="s">When Netflix, Prime or Trakt say you watched something</span></span><span class="switch"><input type="checkbox" data-pref="prompt_reviews" ${u.prompt_reviews ? 'checked' : ''}><span></span></span></label>
      <a class="row" href="/streaming"><span class="grow"><span class="t">Streaming services</span><span class="s">Connect Netflix, Prime Video or Trakt</span></span><span class="chev">›</span></a>
    </div>

    <div class="group-title">Password</div>
    <form class="inset" id="pw" style="padding:16px"><div class="form">${field('current_password', 'Current password', { type: 'password', attrs: 'required autocomplete="current-password"' })}${field('new_password', 'New password', { type: 'password', attrs: 'required minlength="8" autocomplete="new-password"', hint: 'At least 8 characters' })}<div class="err"></div><div><button class="btn primary" type="submit">Change password</button></div></div></form>

    <div class="group-title">Your data</div>
    <div class="inset"><a class="row" href="/api/me/export" download><span class="grow"><span class="t">Download my data</span><span class="s">Everything Spine holds about you, as JSON</span></span><span class="chev">›</span></a>
      <a class="row" href="/api/collection/export.csv" download><span class="grow"><span class="t">Download my collection</span><span class="s">A spreadsheet of your shelf</span></span><span class="chev">›</span></a></div>

    ${navigator.userAgent.includes('SpineApp') ? `<div class="group-title">This iPhone</div><div class="inset"><button class="row" id="chsrv"><span class="grow"><span class="t">Change server address</span><span class="s">${esc(location.origin)}</span></span><span class="chev">›</span></button></div>` : ''}

    <div class="group-title">Delete account</div>
    <form class="inset" id="delacc" style="padding:16px"><p class="dim" style="font-size:14px">This removes your account, diary, collection, wantlist, reviews and lists for good. Editions you added to the register stay, without your name.</p>
      <div class="form" style="max-width:360px">${field('password', 'Password to confirm', { type: 'password', attrs: 'required autocomplete="current-password"' })}<div class="err"></div><div><button class="btn danger" type="submit">Delete my account</button></div></div></form>
    <div style="height:60px"></div></div>`;

  const paintFavs = () => {
    $('#favs', el).innerHTML = favs.map((f, i) => `<button type="button" class="poster" data-rm="${i}" title="Remove ${esc(f.title)}" style="border:0;padding:0;cursor:pointer">${poster(f).replace(/^<div[^>]*>|<\/div>$/g, '')}</button>`).join('') +
      Array.from({ length: Math.max(0, 4 - favs.length) }).map(() => '<button type="button" class="poster empty-slot" data-add aria-label="Add a favourite">+</button>').join('');
  };
  paintFavs();
  const saveFavs = async () => { await patch('/api/me', { favourites: favs.map((f) => f.id) }); await loadMe(); paintFavs(); };
  $('#favs', el).onclick = (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.rm != null) { favs.splice(+b.dataset.rm, 1); saveFavs(); return; }
    pickFilm((f) => { if (!favs.some((x) => x.id === f.id)) { favs.push(f); saveFavs(); } });
  };

  bindForm($('#prof', el), async (v) => { await patch('/api/me', { display_name: v.display_name, bio: v.bio, email: v.email }); await loadMe(); refreshHeader(); toast('Profile saved'); });
  bindForm($('#pw', el), async (v, f) => { await patch('/api/me', v); f.reset(); toast('Password changed'); });
  bindForm($('#delacc', el), async (v) => { await del('/api/me', { password: v.password }); await loadMe(); refreshHeader(); toast('Your account has been deleted'); go('/'); });
  el.querySelectorAll('[data-pref]').forEach((c) => c.onchange = async () => { try { await patch('/api/me', { [c.dataset.pref]: c.checked }); await loadMe(); toast('Saved'); } catch (e) { toast(e.message, true); c.checked = !c.checked; } });
  $('#theme', el).onclick = async (ev) => {
    const b = ev.target.closest('[data-t]'); if (!b) return;
    applyTheme(b.dataset.t); $('#theme', el).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    await patch('/api/me', { theme: b.dataset.t }); await loadMe();
  };
  $('#chsrv', el)?.addEventListener('click', () => { try { window.webkit.messageHandlers.spine.postMessage({ type: 'resetServer' }); } catch { toast('Not running in the Spine app', true); } });
  if (location.hash === '#favourites') setTimeout(() => $('#favourites', el)?.scrollIntoView({ block: 'start' }), 50);
}

function pickFilm(onPick) {
  modal(`<h2>Add a favourite</h2><div class="field"><input id="pf-q" type="search" placeholder="Search films" autocomplete="off" aria-label="Search films"></div><div class="filmpick" id="pf-res"></div>`, { onMount: (d, close) => {
    const q = d.querySelector('#pf-q'), res = d.querySelector('#pf-res');
    let t;
    q.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
      const v = q.value.trim(); if (v.length < 2) { res.innerHTML = ''; return; }
      const r = await get(`/api/films?q=${encodeURIComponent(v)}`);
      res.innerHTML = r.items.map((f) => `<button type="button" data-f="${f.id}">${poster(f)}<div><b>${esc(f.title)}</b> <span>${f.year || ''}</span></div></button>`).join('') || '<p class="dim" style="padding:8px">No films match.</p>';
      res.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { onPick(r.items.find((f) => f.id === +b.dataset.f)); close(); });
    }, 200); };
    q.focus();
  } });
}
