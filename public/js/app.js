import { me, loadMe, post, get, isMod } from './api.js';
import { $, $$, esc, toast, avatar, I } from './ui.js';
import { logSheet, promptSheet } from './forms.js';

const ROUTES = [
  [/^\/$/, 'home'],
  [/^\/films$/, 'films'],
  [/^\/browse$/, 'browse'],
  [/^\/film\/(\d+)$/, 'film', ['id']],
  [/^\/film\/(\d+)\/edit$/, 'edit-film', ['id']],
  [/^\/release\/(\d+)$/, 'release', ['id']],
  [/^\/release\/(\d+)\/edit$/, 'edit-edition', ['id']],
  [/^\/release\/(\d+)\/history$/, 'history', ['id']],
  [/^\/review\/(\d+)$/, 'review', ['id']],
  [/^\/labels$/, 'labels'],
  [/^\/label\/(\d+)$/, 'label', ['id']],
  [/^\/label\/(\d+)\/edit$/, 'edit-label', ['id']],
  [/^\/director\/(\d+)$/, 'person', ['id']],
  [/^\/friends(?:\/(activity|following|followers|find))?$/, 'friends', ['tab']],
  [/^\/u\/([^/]+)(?:\/(films|diary|reviews|shelf|wants|watchlist|lists|likes|compare))?$/, 'user', ['name', 'tab']],
  [/^\/me$/, 'user', [], { self: true, tab: 'overview' }],
  [/^\/collection$/, 'user', [], { self: true, tab: 'shelf' }],
  [/^\/wantlist$/, 'user', [], { self: true, tab: 'wants' }],
  [/^\/watchlist$/, 'user', [], { self: true, tab: 'watchlist' }],
  [/^\/diary$/, 'user', [], { self: true, tab: 'diary' }],
  [/^\/lists$/, 'lists'],
  [/^\/list\/(\d+)$/, 'list', ['id']],
  [/^\/add$/, 'add'],
  [/^\/scan$/, 'scan'],
  [/^\/streaming$/, 'streaming'],
  [/^\/import$/, 'import'],
  [/^\/contributions$/, 'contributions'],
  [/^\/mod(?:\/(queue|reviewed|members))?$/, 'mod', ['tab']],
  [/^\/notifications$/, 'notifications'],
  [/^\/settings$/, 'settings'],
  [/^\/(login|signup)$/, 'auth', ['mode']],
  [/^\/(about|privacy|terms|guidelines)$/, 'pages', ['page']]
];
const NAV = { home: 'home', films: 'films', film: 'films', person: 'films', browse: 'browse', release: 'browse', labels: 'browse', label: 'browse', lists: 'lists', list: 'lists', friends: 'friends', review: 'friends', scan: 'scan', add: 'scan' };

const main = $('#app');
let cleanup = null, seq = 0;

export function go(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path);
  render();
}
export const needLogin = () => { go('/login?next=' + encodeURIComponent(location.pathname + location.search), { replace: true }); };

async function render() {
  const mySeq = ++seq;
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  main.onclick = main.onkeydown = main.onchange = main.oninput = main.onsubmit = null;
  const url = new URL(location.href);
  let match = null;
  for (const [re, view, keys = [], extra = {}] of ROUTES) {
    const m = url.pathname.match(re);
    if (m) { const params = { ...extra }; keys.forEach((k, i) => { if (m[i + 1] !== undefined) params[k] = decodeURIComponent(m[i + 1]); }); match = { view, params }; break; }
  }
  setNav(match?.view, match?.params);
  if (!match) { main.innerHTML = `<div class="wrap"><div class="empty" style="margin-top:40px">That page doesn’t exist. <a href="/">Go home</a>.</div></div>`; return; }
  main.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const mod = await import(`./views/${match.view}.js`);
    if (mySeq !== seq) return;
    cleanup = await mod.default({ el: main, params: match.params, query: url.searchParams, go, needLogin, refreshHeader, logSheet });
    if (mySeq === seq && !location.hash) window.scrollTo(0, 0);
  } catch (e) {
    if (mySeq !== seq) return;
    if (e.status === 401) return needLogin();
    main.innerHTML = `<div class="wrap"><div class="empty" style="margin-top:40px">${esc(e.message || 'Something went wrong.')}</div></div>`;
    if (!e.status) console.error(e);
  }
}

function setNav(view, params = {}) {
  let key = NAV[view];
  if (view === 'user') {
    const self = params.self || (me.user && params.name === me.user.username);
    if (self) key = params.tab === 'diary' ? 'diary' : params.tab === 'shelf' || params.tab === 'wants' ? 'collection' : 'me';
    else key = 'friends';
  }
  $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === key));
}

export function refreshHeader() {
  const box = $('#userbox');
  $$('[data-auth]').forEach((a) => { a.hidden = !me.user; });
  if (!me.user) {
    box.innerHTML = `<a class="btn sm ghost hide-m" href="/login">Sign in</a><a class="btn sm primary" href="/signup">Join</a>`;
    return;
  }
  const u = me.user;
  const badge = me.unread + (isMod() ? me.pending : 0);
  box.innerHTML = `
    <button class="btn sm primary" id="logbtn" aria-label="Log a film">${I.plus}<span>Log</span></button>
    <a class="iconbtn" href="/notifications" aria-label="Notifications${me.unread ? `, ${me.unread} unread` : ''}">${I.bell}${badge ? `<span class="dot">${badge > 99 ? '99+' : badge}</span>` : ''}</a>
    <div class="menu" id="umenu"><button class="avatar" aria-haspopup="true" aria-expanded="false" aria-label="Account menu" style="${avatarStyle(u.username)}">${esc((u.display_name || u.username)[0])}</button>
      <div class="menu-pop" role="menu">
        <a href="/u/${esc(u.username)}"><span>Profile</span><span class="dim2">${esc(u.username)}</span></a>
        <a href="/diary">Diary</a><a href="/collection">Shelf</a><a href="/watchlist">Watchlist</a><a href="/wantlist">Wantlist</a>
        <hr><a href="/scan">Scan discs</a><a href="/add">Add an edition</a><a href="/streaming">Streaming services${me.prompts ? `<span class="pill accent">${me.prompts}</span>` : ''}</a><a href="/import">Import from Letterboxd</a><a href="/contributions">Contributions</a>
        ${isMod() ? `<a href="/mod">Moderation ${me.pending ? `<span class="pill accent">${me.pending}</span>` : ''}</a>` : ''}
        <hr><a href="/settings">Settings</a><button data-logout>Sign out</button>
      </div></div>`;
  $('#logbtn').onclick = () => logSheet({ onSaved: () => render() });
  const menu = $('#umenu'), btn = menu.querySelector('.avatar');
  btn.onclick = (ev) => { ev.stopPropagation(); const open = menu.classList.toggle('open'); btn.setAttribute('aria-expanded', open); };
  menu.querySelector('[data-logout]').onclick = async () => { await post('/api/auth/logout'); await loadMe(); refreshHeader(); toast('Signed out'); go('/'); };
}
function avatarStyle(name) { const t = document.createElement('div'); t.innerHTML = avatar(name); return t.firstElementChild.getAttribute('style'); }

/* review prompts: once per session, when there is something waiting */
export async function checkPrompts() {
  if (!me.user || !me.prompts) return;
  try {
    const r = await get('/api/prompts');
    // Show the sheet once per session for any given entry; new imports bring it back.
    let seen = [];
    try { seen = JSON.parse(sessionStorage.getItem('spine-prompted') || '[]'); } catch { /* ignore */ }
    const fresh = r.items.filter((w) => !seen.includes(w.id));
    if (!fresh.length) return;
    try { sessionStorage.setItem('spine-prompted', JSON.stringify([...seen, ...r.items.map((w) => w.id)].slice(-50))); } catch { /* ignore */ }
    promptSheet(r.items, async () => { await loadMe(); refreshHeader(); render(); });
  } catch { /* quiet */ }
}

document.addEventListener('click', (ev) => {
  $('#umenu')?.classList.remove('open');
  const a = ev.target.closest('a[href]');
  if (!a || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
  const href = a.getAttribute('href');
  if (!href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/') || href.startsWith('/uploads/') || a.target || a.hasAttribute('download')) return;
  ev.preventDefault();
  if (href === location.pathname + location.search) return;
  go(href);
});
window.addEventListener('popstate', render);
$('#search').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const q = $('#q').value.trim();
  if (!q) return go('/films');
  if (/^\d{8,14}$/.test(q.replace(/\s/g, ''))) return go('/browse?q=' + encodeURIComponent(q));
  if (q.startsWith('@')) return go('/friends/find?q=' + encodeURIComponent(q.slice(1)));
  go('/films?q=' + encodeURIComponent(q));
});

export function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('spine-theme', t || 'system'); } catch { /* ignore */ }
  // The iPhone shell matches its status bar to the theme.
  try { window.webkit?.messageHandlers?.spine?.postMessage({ type: 'theme', value: t || 'system' }); } catch { /* not in the app */ }
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

loadMe().catch(() => {}).finally(() => {
  if (me.user?.theme && me.user.theme !== 'system') applyTheme(me.user.theme);
  refreshHeader(); render(); checkPrompts();
  if (me.user) get('/api/streaming/poke').catch(() => {});
});
