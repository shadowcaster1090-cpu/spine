import { get, patch, del, put } from '../api.js';
import { esc, cover, regTag, directors, setTitle, toast, confirmDialog, modal, bindForm, when } from '../ui.js';

export default async function view(ctx) {
  const { el, params, go } = ctx;
  const { list: l, own, items } = await get(`/api/lists/${params.id}`);
  setTitle(l.title);
  el.innerHTML = `<div class="wrap" style="max-width:1000px">
    <div class="crumb mono"><a href="/lists">Lists</a> / <a href="/u/${esc(l.username)}/lists">${esc(l.username)}</a></div>
    <div class="colhead"><div style="max-width:720px"><div class="eyebrow">${items.length} edition${items.length === 1 ? '' : 's'} · updated ${when(l.updated_at)}${l.public ? '' : ' · private'}</div><h1 class="big">${esc(l.title)}</h1>
      ${l.description ? `<p class="prose" style="margin-top:14px;white-space:pre-wrap">${esc(l.description)}</p>` : ''}</div>
      ${own ? '<div class="end"><button class="btn sm" data-act="edit">Edit list</button><button class="btn sm danger" data-act="delete">Delete</button></div>' : ''}</div>
    ${items.length ? `<ol class="rows" style="list-style:none;padding:0;margin:0 0 60px">${items.map((i, n) => `<li class="wrow" style="grid-template-columns:28px 56px minmax(0,1fr) auto">
        <span class="mono dim">${n + 1}</span><a href="/release/${i.edition.id}">${cover(i.edition)}</a>
        <div><a class="t" href="/release/${i.edition.id}">${esc(i.edition.title)}</a><div class="s"><span>${directors(i.edition.directors, false)} · ${i.edition.year || ''}</span><span>${esc(i.edition.label || '')} ${esc(i.edition.cat_no)}</span>${regTag(i.edition)}</div>
          ${i.note ? `<p class="dim" style="margin:6px 0 0">${esc(i.note)}</p>` : ''}</div>
        ${own ? `<div class="btns"><button class="btn sm ghost" data-up="${n}" ${n === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button class="btn sm ghost" data-down="${n}" ${n === items.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button><button class="link" data-note="${i.edition.id}">Note</button><button class="link" data-rm="${i.edition.id}">Remove</button></div>` : '<span></span>'}
      </li>`).join('')}</ol>` : `<div class="empty">This list is empty.${own ? ' Use “Add to a list” on any edition page.' : ''}</div>`}</div>`;
  const rerender = () => view(ctx);
  el.onclick = async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    try {
      const ids = items.map((i) => i.edition.id);
      if (b.dataset.up || b.dataset.down) {
        const n = +(b.dataset.up ?? b.dataset.down), m = b.dataset.up ? n - 1 : n + 1;
        [ids[n], ids[m]] = [ids[m], ids[n]];
        await put(`/api/lists/${l.id}/order`, { edition_ids: ids }); rerender();
      }
      if (b.dataset.rm) { await del(`/api/lists/${l.id}/items/${b.dataset.rm}`); toast('Removed from list'); rerender(); }
      if (b.dataset.note) {
        const it = items.find((i) => i.edition.id === +b.dataset.note);
        modal(`<h2>Note</h2><form class="form"><textarea name="note" rows="3" aria-label="Note">${esc(it.note)}</textarea><div class="err"></div><div class="btns"><button class="btn primary" type="submit">Save</button></div></form>`, {
          onMount: (d, close) => bindForm(d.querySelector('form'), async (v) => { await patch(`/api/lists/${l.id}/items/${it.edition.id}`, { note: v.note }); close(); rerender(); })
        });
      }
      if (b.dataset.act === 'delete' && await confirmDialog(`Delete “${l.title}”? The editions stay on the register.`, 'Delete list', true)) { await del(`/api/lists/${l.id}`); toast('List deleted'); go(`/u/${l.username}/lists`); }
      if (b.dataset.act === 'edit') modal(`<h2>Edit list</h2><form class="form"><div class="field"><label for="f-t">Title</label><input id="f-t" name="title" value="${esc(l.title)}" required></div><div class="field"><label for="f-d">Description</label><textarea id="f-d" name="description" rows="4">${esc(l.description)}</textarea></div><label class="check"><input type="checkbox" name="private" value="1" ${l.public ? '' : 'checked'}> Keep it private</label><div class="err"></div><div class="btns"><button class="btn primary" type="submit">Save</button></div></form>`, {
        onMount: (d, close) => bindForm(d.querySelector('form'), async (v) => { await patch(`/api/lists/${l.id}`, { title: v.title, description: v.description, public: !v.private }); close(); rerender(); })
      });
    } catch (e) { toast(e.message, true); }
  };
}
