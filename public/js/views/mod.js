import { get, post, me, isMod, loadMe } from '../api.js';
import { esc, when, toast, setTitle, $ } from '../ui.js';

const KIND = { edition: 'New edition', edition_edit: 'Edition edit', film_edit: 'Film edit', label_edit: 'Label edit' };
const show = (v) => v == null || v === '' ? '<span class="dim">—</span>' : Array.isArray(v) ? v.map(esc).join('<br>') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : esc(v);
const targetLink = (s) => s.kind === 'film_edit' ? `/film/${s.target_id}` : s.kind === 'label_edit' ? `/label/${s.target_id}` : s.kind === 'edition_edit' ? `/release/${s.target_id}` : s.result_id ? `/release/${s.result_id}` : null;

export function subBody(s) {
  if (s.kind === 'edition') {
    const film = s.payload.film ? Object.entries(s.payload.film).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length)) : [];
    const ed = Object.entries(s.payload).filter(([k, v]) => !['film', 'film_id'].includes(k) && v !== '' && v != null && !(Array.isArray(v) && !v.length));
    return `${s.payload.film_id ? `<p class="dim">Film: existing <a class="link" href="/film/${s.payload.film_id}">#${s.payload.film_id}</a></p>` : `<p class="eyebrow">New film</p><table class="diff"><tbody>${film.map(([k, v]) => `<tr><td class="mono" style="width:180px">${esc(k.replace(/_/g, ' '))}</td><td>${show(v)}</td></tr>`).join('')}</tbody></table>`}
      <p class="eyebrow" style="margin-top:14px">Edition</p><table class="diff"><tbody>${ed.map(([k, v]) => `<tr><td class="mono" style="width:180px">${esc(k.replace(/_/g, ' '))}</td><td>${show(v)}</td></tr>`).join('')}</tbody></table>`;
  }
  const ch = s.payload.changes || {}, cur = s.current || {};
  return `${s.payload.summary ? `<p>“${esc(s.payload.summary)}”</p>` : ''}<div class="tbl"><table class="diff"><thead><tr><th>Field</th><th>Now</th><th>Proposed</th></tr></thead><tbody>${Object.keys(ch).map((k) => `<tr><td class="mono">${esc(k.replace(/_/g, ' '))}</td><td class="old">${show(k === 'label_name' ? cur.label_name : cur[k])}</td><td class="new">${show(ch[k])}</td></tr>`).join('')}</tbody></table></div>`;
}

export default async function view(ctx) {
  const { el, params, needLogin } = ctx;
  if (!me.user) return needLogin();
  if (!isMod()) { el.innerHTML = '<div class="wrap"><div class="empty">Moderation is for moderators.</div></div>'; return; }
  const tab = params.tab || 'queue';
  setTitle('Moderation');
  el.innerHTML = `<div class="wrap" style="max-width:1000px"><div class="colhead"><div><div class="eyebrow">Keep the register accurate</div><h1 class="big">Moderation</h1></div></div>
    <nav class="tabsbar"><a href="/mod" class="${tab === 'queue' ? 'on' : ''}">Queue</a><a href="/mod/reviewed" class="${tab === 'reviewed' ? 'on' : ''}">Recently reviewed</a>${me.user.role === 'admin' ? `<a href="/mod/members" class="${tab === 'members' ? 'on' : ''}">Members</a>` : ''}</nav><div id="mt"></div><div style="height:60px"></div></div>`;
  const box = $('#mt', el);
  const rerender = () => view(ctx);

  if (tab === 'members') {
    const draw = async (q = '') => {
      const { items } = await get('/api/admin/users?q=' + encodeURIComponent(q));
      $('#ul', box).innerHTML = `<table><thead><tr><th>Member</th><th>Email</th><th>Joined</th><th class="num">Approved edits</th><th class="num">Copies</th><th>Role</th></tr></thead><tbody>${items.map((u) => `<tr><td><a href="/u/${esc(u.username)}">${esc(u.username)}</a></td><td class="mono">${esc(u.email)}</td><td class="mono">${when(u.created_at)}</td><td class="num">${u.approved}</td><td class="num">${u.copies}</td><td><select data-role="${u.id}" aria-label="Role for ${esc(u.username)}">${['member', 'mod', 'admin'].map((r) => `<option${r === u.role ? ' selected' : ''}>${r}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table>`;
    };
    box.innerHTML = `<div class="tools"><input type="search" id="uq" placeholder="Find a member"></div><div class="tbl" id="ul"></div>`;
    await draw();
    let t; $('#uq', box).oninput = (e) => { clearTimeout(t); t = setTimeout(() => draw(e.target.value), 200); };
    box.onchange = async (ev) => {
      const s = ev.target.closest('[data-role]'); if (!s) return;
      try { await post(`/api/admin/users/${s.dataset.role}/role`, { role: s.value }); toast('Role updated'); } catch (e) { toast(e.message, true); draw($('#uq', box).value); }
    };
    return;
  }

  const { items } = await get(`/api/submissions?status=${tab === 'queue' ? 'pending' : 'approved'}`);
  const rejected = tab === 'reviewed' ? (await get('/api/submissions?status=rejected')).items : [];
  const all = [...items, ...rejected].sort((a, b) => (b.reviewed_at || '').localeCompare(a.reviewed_at || ''));
  const list = tab === 'queue' ? items : all.slice(0, 100);
  box.innerHTML = list.length ? list.map((s) => `<article class="sub" data-id="${s.id}">
      <div class="meta"><span class="status ${s.status}">${s.status}</span><h3>${KIND[s.kind]}${s.target ? ': ' + esc(s.target) : ''}</h3>
        <span class="mono dim">by ${s.username ? `<a href="/u/${esc(s.username)}">${esc(s.username)}</a>` : 'deleted member'} · ${when(s.created_at)}</span>${targetLink(s) ? `<a class="link" href="${targetLink(s)}" style="margin-left:auto">Open</a>` : ''}</div>
      ${subBody(s)}
      ${s.status === 'pending' ? `<form class="form" style="margin-top:14px" data-review="${s.id}"><textarea name="note" rows="2" placeholder="Note to the contributor (required to reject)" aria-label="Note"></textarea>
        <div class="btns"><button class="btn sm primary" name="act" value="approve">Approve</button><button class="btn sm danger" name="act" value="reject">Reject</button></div></form>` : s.note ? `<p class="dim" style="margin-top:10px">Note: ${esc(s.note)}</p>` : ''}
    </article>`).join('') : `<div class="empty">${tab === 'queue' ? 'The queue is empty. Nothing waiting for review.' : 'Nothing reviewed yet.'}</div>`;
  box.onsubmit = async (ev) => {
    ev.preventDefault();
    const form = ev.target, act = ev.submitter?.value || 'approve';
    try {
      await post(`/api/submissions/${form.dataset.review}/${act}`, { note: form.note.value });
      toast(act === 'approve' ? 'Approved' : 'Rejected'); await loadMe(); ctx.refreshHeader(); rerender();
    } catch (e) { toast(e.message, true); }
  };
}
