import { patch, del, get, post, me, loadMe } from '../api.js';
import { esc, bindForm, toast, setTitle, field, area, poster, modal, confirmDialog, $ } from '../ui.js';
import { startProviderSignIn } from '../oauth.js';
import { appVersion, hasBridge, canNativeFetch } from '../bridge.js';
import { identify } from '../identify.js';

const DIAG_CODE = '5051892210034';   // Dunkirk, Warner 4K: a disc UPCitemdb knows, so a working path shows a title

export default async function view(ctx) {
  const { el, needLogin, go, refreshHeader } = ctx;
  if (!me.user) return needLogin();
  setTitle('Settings');
  const u = me.user;
  const favs = u.favourites.length ? (await get(`/api/users/${encodeURIComponent(u.username)}`)).favourites : [];
  const { applyTheme } = await import('../app.js');
  const providers = await get('/api/auth/providers').then((r) => r.providers).catch(() => []);
  const linked = (id) => u.logins.includes(id);
  const PNAME = { google: 'Google', apple: 'Apple' };
  if (ctx.query?.get('linked')) { toast(`${PNAME[ctx.query.get('linked')] || 'Account'} linked`); history.replaceState(null, '', '/settings'); }

  el.innerHTML = `<div class="wrap narrow"><div class="colhead"><div><div class="eyebrow">@${esc(u.username)}</div><h1 class="big">Settings</h1></div></div>

    <div class="group-title">Profile</div>
    <form class="inset" id="prof" style="padding:16px">
      <div class="form">${field('display_name', 'Name', { value: u.display_name, attrs: 'maxlength="40" placeholder="How friends see you"' })}${area('bio', 'About you', { value: u.bio, attrs: 'rows="3" maxlength="600"', hint: 'Shown on your profile' })}${field('email', 'Email', { type: 'email', value: u.email, attrs: 'required autocomplete="email"' })}
      <div class="err"></div><div><button class="btn primary" type="submit">Save profile</button></div></div></form>

    <div class="group-title" id="favourites">Favourite films</div>
    <div class="inset" style="padding:16px"><div class="favs" id="favs"></div><p class="group-note" style="margin:10px 0 0">Four films that say who you are. They sit at the top of your profile.</p></div>

    <div class="group-title">Appearance</div>
    <div class="inset"><div class="row"><span class="grow"><span class="t">Theme</span><span class="s">Dark is the house style; Paper is an ivory variant for daylight</span></span><div class="seg" id="theme">${[['dark', 'Dark'], ['light', 'Paper']].map(([v, l]) => `<button type="button" data-t="${v}" class="${(u.theme === 'light' ? 'light' : 'dark') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>

    <div class="group-title">Privacy & prompts</div>
    <div class="inset">
      <label class="row"><span class="grow"><span class="t">Public collection</span><span class="s">Let other members see your shelf and wantlist</span></span><span class="switch"><input type="checkbox" data-pref="public_collection" ${u.public_collection ? 'checked' : ''}><span></span></span></label>
      <label class="row"><span class="grow"><span class="t">Public diary</span><span class="s">Let other members see your diary, watchlist and likes. Reviews are always public.</span></span><span class="switch"><input type="checkbox" data-pref="public_diary" ${u.public_diary ? 'checked' : ''}><span></span></span></label>
      <label class="row"><span class="grow"><span class="t">Ask me to rate imported films</span><span class="s">When Netflix, Prime or Trakt say you watched something</span></span><span class="switch"><input type="checkbox" data-pref="prompt_reviews" ${u.prompt_reviews ? 'checked' : ''}><span></span></span></label>
      <a class="row" href="/streaming"><span class="grow"><span class="t">Streaming services</span><span class="s">Connect Netflix, Prime Video or Trakt</span></span><span class="chev">›</span></a>
    </div>

    ${providers.length || u.logins.length ? `<div class="group-title">Sign-in methods</div>
    <div class="inset" id="logins">${[...new Set([...providers.map((p) => p.id), ...u.logins])].map((id) => `<div class="row"><span class="grow"><span class="t">${esc(PNAME[id] || id)}</span><span class="s">${linked(id) ? 'Linked · you can sign in with it' : 'Not linked'}</span></span>${linked(id) ? `<button type="button" class="btn sm" data-unlink="${id}">Unlink</button>` : `<button type="button" class="btn sm primary" data-link="${id}">Link</button>`}</div>`).join('')}</div>` : ''}

    <div class="group-title">Password</div>
    ${u.has_password
      ? `<form class="inset" id="pw" style="padding:16px"><div class="form">${field('current_password', 'Current password', { type: 'password', attrs: 'required autocomplete="current-password"' })}${field('new_password', 'New password', { type: 'password', attrs: 'required minlength="8" autocomplete="new-password"', hint: 'At least 8 characters' })}<div class="err"></div><div><button class="btn primary" type="submit">Change password</button></div></div></form>`
      : `<form class="inset" id="setpw" style="padding:16px"><p class="dim" style="font-size:14px;margin:0 0 12px">You sign in with ${u.logins.map((l) => PNAME[l] || l).join(' and ') || 'a linked service'}. A password lets you sign in without it too.</p><div class="form">${field('new_password', 'New password', { type: 'password', attrs: 'required minlength="8" autocomplete="new-password"', hint: 'At least 8 characters' })}<div class="err"></div><div><button class="btn primary" type="submit">Set a password</button></div></div></form>`}

    <div class="group-title">Your data</div>
    <div class="inset"><a class="row" href="/import"><span class="grow"><span class="t">Import from Letterboxd</span><span class="s">Bring your diary, ratings, reviews, likes and watchlist</span></span><span class="chev">›</span></a>
      <a class="row" href="/api/me/export" download><span class="grow"><span class="t">Download my data</span><span class="s">Everything Spine holds about you, as JSON</span></span><span class="chev">›</span></a>
      <a class="row" href="/api/collection/export.csv" download><span class="grow"><span class="t">Download my collection</span><span class="s">A spreadsheet of your shelf</span></span><span class="chev">›</span></a></div>

    ${appVersion() || hasBridge() ? `<div class="group-title">This iPhone</div><div class="inset">
      <button class="row" id="chsrv"><span class="grow"><span class="t">Change server address</span><span class="s">${esc(location.origin)}</span></span><span class="chev">›</span></button>
      <div class="row"><span class="grow"><span class="t">Barcode lookup diagnostics</span><span class="s mono" style="white-space:normal">SpineApp/${esc(appVersion() || '?')} · bridge ${hasBridge() ? 'present' : 'missing'} · native lookups ${canNativeFetch() ? 'on' : 'off'}</span></span><button type="button" class="btn sm" id="diag-run">Test lookup</button></div>
      <div id="diag-out" hidden style="padding:2px 16px 14px"></div></div>` : ''}

    ${u.role === 'admin' ? `<div class="group-title">Register (admin)</div>
    <div class="inset"><button class="row" id="posters"><span class="grow"><span class="t">Fetch real posters from TMDB</span><span class="s">Matches films without artwork and stores their posters, credits and synopses</span></span><span class="chev">›</span></button></div>` : ''}

    <div class="group-title">Delete account</div>
    <form class="inset" id="delacc" style="padding:16px"><p class="dim" style="font-size:14px">This removes your account, diary, collection, wantlist, reviews and lists for good. Editions you added to the register stay, without your name.</p>
      <div class="form" style="max-width:360px">${u.has_password ? field('password', 'Password to confirm', { type: 'password', attrs: 'required autocomplete="current-password"' }) : field('confirm', 'Type your username to confirm', { attrs: 'required autocomplete="off" autocapitalize="none"' })}<div class="err"></div><div><button class="btn danger" type="submit">Delete my account</button></div></div></form>
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
  if ($('#pw', el)) bindForm($('#pw', el), async (v, f) => { await patch('/api/me', v); f.reset(); toast('Password changed'); });
  if ($('#setpw', el)) bindForm($('#setpw', el), async (v) => { await post('/api/me/password', v); await loadMe(); toast('Password set'); view(ctx); });
  bindForm($('#delacc', el), async (v) => { await del('/api/me', u.has_password ? { password: v.password } : { confirm: v.confirm }); await loadMe(); refreshHeader(); toast('Your account has been deleted'); go('/'); });
  $('#logins', el)?.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.link) return startProviderSignIn(b.dataset.link, { next: '/settings', link: true });
    if (b.dataset.unlink && await confirmDialog(`Unlink ${PNAME[b.dataset.unlink] || b.dataset.unlink}? You will no longer be able to sign in with it.`, 'Unlink', true)) {
      try { await del(`/api/me/logins/${b.dataset.unlink}`); await loadMe(); toast('Unlinked'); view(ctx); } catch (e) { toast(e.message, true); }
    }
  });
  el.querySelectorAll('[data-pref]').forEach((c) => c.onchange = async () => { try { await patch('/api/me', { [c.dataset.pref]: c.checked }); await loadMe(); toast('Saved'); } catch (e) { toast(e.message, true); c.checked = !c.checked; } });
  $('#theme', el).onclick = async (ev) => {
    const b = ev.target.closest('[data-t]'); if (!b) return;
    applyTheme(b.dataset.t); $('#theme', el).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    await patch('/api/me', { theme: b.dataset.t }); await loadMe();
  };
  $('#posters', el)?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.disabled = true;
    let total = 0, matched = 0, missed = [];
    try {
      for (let i = 0; i < 20; i++) {
        const r = await post('/api/admin/posters', { limit: 40 });
        total += r.done; matched += r.matched; missed = missed.concat(r.missed);
        toast(`Posters: ${total} done, ${r.remaining} to go`);
        if (!r.remaining || (!r.done && r.missed.length === 0)) break;
        if (!r.done) break;
      }
      toast(`Done: ${total} films now have posters${missed.length ? `; ${missed.length} could not be matched` : ''}`);
      if (missed.length) console.info('Not matched on TMDB:', missed);
    } catch (e) { toast(e.message, true); }
    b.disabled = false;
  });
  $('#chsrv', el)?.addEventListener('click', () => { try { window.webkit.messageHandlers.spine.postMessage({ type: 'resetServer' }); } catch { toast('Not running in the Spine app', true); } });
  // Barcode lookup diagnostics: one tap says whether the shell's native fetch answers, and how each side did.
  $('#diag-run', el)?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget, out = $('#diag-out', el);
    b.disabled = true; b.textContent = 'Testing…'; out.hidden = false;
    out.innerHTML = `<p class="mono dim" style="margin:0">Looking up ${DIAG_CODE} (Dunkirk, Warner 4K)…</p>`;
    try {
      const r = await identify(DIAG_CODE);
      const d = r.diag || {};
      const http = (x) => [x.status ? `HTTP ${x.status}` : 'no answer', x.error, x.errors?.length ? x.errors.join('; ') : '', x.cached ? 'cached' : '', x.ms != null ? `${x.ms} ms` : ''].filter(Boolean).join(' · ');
      const rows = [
        ['Answered by', r.trouble ? `nobody · ${r.side || 'unknown'} side failed` : r.via || 'server'],
        d.phone ? ['Phone → UPCitemdb', http(d.phone)] : d.browser ? ['Browser → UPCitemdb', http(d.browser)] : ['Phone → UPCitemdb', 'not asked · no bridge (SpineApp/1.2 or later needed)'],
        [`Server · ${d.server?.step || 'lookup'}`, d.server ? http(d.server) : 'not asked'],
        ['Elapsed', `${d.ms ?? 0} ms`],
        ['Title', r.product ? `${r.parsed?.title || r.product.title}${r.film?.year ? ` (${r.film.year})` : ''} · ${r.film ? `TMDB ${r.film.tmdb_id}` : 'no TMDB match'}` : r.trouble ? '—' : `not in the databases${r.hint?.label ? ` · hint ${r.hint.label}` : ''}`],
        r.trouble ? ['Message', r.trouble] : null
      ].filter(Boolean);
      out.innerHTML = `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd style="text-align:left;white-space:normal;overflow-wrap:anywhere">${esc(v)}</dd>`).join('')}</dl>`;
    } catch (e) { out.innerHTML = `<p class="mono dim" style="margin:0">${esc(e.message)}</p>`; }
    b.disabled = false; b.textContent = 'Test lookup';
  });
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
