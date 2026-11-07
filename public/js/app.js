import { me, loadMe, post, isMod } from './api.js';
import { $, $$, esc, toast } from './ui.js';

const ROUTES = [
  [/^\/$/, 'home'],
  [/^\/browse$/, 'browse'],
  [/^\/release\/(\d+)$/, 'release', ['id']],
  [/^\/release\/(\d+)\/edit$/, 'edit-edition', ['id']],
  [/^\/release\/(\d+)\/history$/, 'history', ['id']],
  [/^\/film\/(\d+)$/, 'film', ['id']],
  [/^\/film\/(\d+)\/edit$/, 'edit-film', ['id']],
  [/^\/labels$/, 'labels'],
  [/^\/label\/(\d+)$/, 'label', ['id']],
  [/^\/label\/(\d+)\/edit$/, 'edit-label', ['id']],
  [/^\/director\/(\d+)$/, 'person', ['id']],
  [/^\/u\/([^/]+)(?:\/(shelf|wants|lists|reviews))?$/, 'user', ['name', 'tab']],
  [/^\/collection$/, 'user', [], { self: true, tab: 'shelf' }],
  [/^\/wantlist$/, 'user', [], { self: true, tab: 'wants' }],
  [/^\/me$/, 'user', [], { self: true, tab: 'shelf' }],
  [/^\/lists$/, 'lists'],
  [/^\/list\/(\d+)$/, 'list', ['id']],
  [/^\/add$/, 'add'],
  [/^\/contributions$/, 'contributions'],
  [/^\/mod(?:\/(queue|reviewed|members))?$/, 'mod', ['tab']],
  [/^\/notifications$/, 'notifications'],
  [/^\/settings$/, 'settings'],
  [/^\/(login|signup)$/, 'auth', ['mode']],
  [/^\/(about|privacy|terms|guidelines)$/, 'pages', ['page']]
];
const NAV = { browse: 'browse', release: 'browse', film: 'browse', person: 'browse', labels: 'labels', label: 'labels', lists: 'lists', list: 'lists', add: 'add' };

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
  main.onclick = main.onkeydown = main.onchange = main.oninput = null;
  const url = new URL(location.href);
  let match = null;
  for (const [re, view, keys = [], extra = {}] of ROUTES) {
    const m = url.pathname.match(re);
    if (m) { const params = { ...extra }; keys.forEach((k, i) => { if (m[i + 1] !== undefined) params[k] = decodeURIComponent(m[i + 1]); }); match = { view, params }; break; }
  }
  setNav(match?.view, match?.params);
  if (!match) { main.innerHTML = `<div class="wrap"><div class="empty">That page is not on the register. <a href="/">Go to the front page</a>.</div></div>`; return; }
  main.innerHTML = '<div class="loading">Threading the projector…</div>';
  try {
    const mod = await import(`./views/${match.view}.js`);
    if (mySeq !== seq) return;
    cleanup = await mod.default({ el: main, params: match.params, query: url.searchParams, go, needLogin, refreshHeader });
    if (mySeq === seq && !location.hash) window.scrollTo(0, 0);
  } catch (e) {
    if (mySeq !== seq) return;
    if (e.status === 401) return needLogin();
    main.innerHTML = `<div class="wrap"><div class="empty">${esc(e.message || 'Something went wrong.')}</div></div>`;
    if (!e.status) console.error(e);
  }
}

function setNav(view, params = {}) {
  let key = NAV[view];
  if (view === 'user' && (params.self || (me.user && params.name === me.user.username))) key = params.tab === 'wants' ? 'wantlist' : params.tab === 'shelf' || !params.tab ? (location.pathname === '/me' ? 'me' : 'collection') : 'me';
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
  box.innerHTML = `
    <a class="btn sm hide-m" href="/add">+ Add</a>
    <a class="iconbtn" href="/notifications" aria-label="Notifications${me.unread ? `, ${me.unread} unread` : ''}"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>${me.unread ? `<span class="dot">${me.unread > 99 ? '99+' : me.unread}</span>` : ''}</a>
    <div class="menu" id="umenu"><button class="avatar" aria-haspopup="true" aria-expanded="false" title="${esc(u.username)}">${esc(u.username[0])}</button>
      <div class="menu-pop" role="menu">
        <a href="/u/${esc(u.username)}">Profile</a><a href="/collection">Collection</a><a href="/wantlist">Wantlist</a><a href="/u/${esc(u.username)}/lists">My lists</a>
        <a href="/contributions">My contributions</a>
        ${isMod() ? `<a href="/mod">Moderation ${me.pending ? `<span class="mono" style="color:var(--lamp)">${me.pending}</span>` : ''}</a>` : ''}
        <hr><a href="/settings">Settings</a><button data-logout>Sign out</button>
      </div></div>`;
  const menu = $('#umenu');
  const btn = menu.querySelector('.avatar');
  btn.onclick = (ev) => { ev.stopPropagation(); const open = menu.classList.toggle('open'); btn.setAttribute('aria-expanded', open); };
  menu.querySelector('[data-logout]').onclick = async () => {
    await post('/api/auth/logout');
    await loadMe(); refreshHeader(); toast('Signed out'); go('/');
  };
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
  go('/browse' + (q ? '?q=' + encodeURIComponent(q) : ''));
});

loadMe().catch(() => {}).finally(() => { refreshHeader(); render(); });
