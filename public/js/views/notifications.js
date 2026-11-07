import { get, post, me } from '../api.js';
import { esc, when, setTitle } from '../ui.js';

export default async function ({ el, needLogin, refreshHeader }) {
  if (!me.user) return needLogin();
  setTitle('Notifications');
  const { items } = await get('/api/notifications');
  el.innerHTML = `<div class="wrap" style="max-width:860px"><div class="colhead"><div><h1 class="big">Notifications</h1></div></div>
    ${items.length ? items.map((n) => `<div class="notif${n.read ? '' : ' unread'}">${n.link ? `<a href="${esc(n.link)}">${esc(n.text)}</a>` : `<span>${esc(n.text)}</span>`}<span class="when mono dim">${when(n.created_at)}</span></div>`).join('')
      : '<div class="empty">Nothing yet. You’ll hear here when your contributions are reviewed, or when a new edition of a film you own or want is catalogued.</div>'}<div style="height:60px"></div></div>`;
  if (items.some((n) => !n.read)) { await post('/api/notifications/read'); me.unread = 0; refreshHeader(); }
}
