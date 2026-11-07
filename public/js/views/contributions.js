import { get, post, me } from '../api.js';
import { esc, when, toast, setTitle } from '../ui.js';
import { subBody } from './mod.js';

export default async function view(ctx) {
  const { el, needLogin } = ctx;
  if (!me.user) return needLogin();
  setTitle('My contributions');
  const { items } = await get('/api/submissions?mine=1');
  const approved = items.filter((s) => s.status === 'approved').length;
  el.innerHTML = `<div class="wrap" style="max-width:1000px"><div class="colhead"><div><div class="eyebrow">${approved} approved${me.user.role === 'member' ? ` · ${Math.max(0, 10 - approved)} more until your edits skip the queue` : ''}</div><h1 class="big">My contributions</h1></div><div class="end"><a class="btn primary" href="/add">+ Add an edition</a></div></div>
    ${items.length ? items.map((s) => `<article class="sub"><div class="meta"><span class="status ${s.status}">${s.status}</span><h3>${esc(s.target || '')}</h3><span class="mono dim">${when(s.created_at)}</span>
      ${s.status === 'approved' && s.result_id ? `<a class="link" style="margin-left:auto" href="${s.kind === 'film_edit' ? '/film/' : s.kind === 'label_edit' ? '/label/' : '/release/'}${s.result_id}">Open</a>` : ''}
      ${s.status === 'pending' ? `<button class="link" style="margin-left:auto" data-withdraw="${s.id}">Withdraw</button>` : ''}</div>
      ${s.note && s.note !== 'Auto-approved' ? `<p class="note-banner" style="margin-bottom:12px">Moderator: ${esc(s.note)}</p>` : ''}
      <details><summary class="dim" style="cursor:pointer">What you submitted</summary><div style="margin-top:10px">${subBody(s)}</div></details></article>`).join('')
      : '<div class="empty">Nothing yet. <a href="/add">Add an edition</a> or suggest an edit on any edition page.</div>'}<div style="height:60px"></div></div>`;
  el.onclick = async (ev) => {
    const b = ev.target.closest('[data-withdraw]'); if (!b) return;
    try { await post(`/api/submissions/${b.dataset.withdraw}/withdraw`); toast('Withdrawn'); view(ctx); } catch (e) { toast(e.message, true); }
  };
}
