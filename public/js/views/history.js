import { get } from '../api.js';
import { esc, when, setTitle } from '../ui.js';

const show = (v) => v == null || v === '' ? '<span class="dim">—</span>' : Array.isArray(v) ? v.map(esc).join('<br>') : esc(typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v);

export default async function ({ el, params }) {
  const [d, h] = await Promise.all([get(`/api/editions/${params.id}`), get(`/api/editions/${params.id}/history`)]);
  setTitle(`History · ${d.film?.title || ''}`);
  el.innerHTML = `<div class="wrap" style="max-width:960px">
    <div class="crumb mono"><a href="/release/${params.id}">${esc(d.film.title)} · ${esc(d.label?.name || '')} ${esc(d.edition.cat_no)}</a> / History</div>
    <div class="colhead"><div><div class="eyebrow">Every change, newest first</div><h1 class="big">History</h1></div></div>
    ${h.revisions.map((r) => {
      const keys = [...new Set([...Object.keys(r.before), ...Object.keys(r.after)])];
      return `<div class="sub"><div class="meta"><h3>${esc(r.summary)}</h3><span class="mono dim">${r.entity === 'film' ? 'film · ' : ''}${r.username ? `<a href="/u/${esc(r.username)}">${esc(r.username)}</a>` : 'deleted member'} · ${when(r.created_at)}</span></div>
        ${keys.length && Object.keys(r.before).length ? `<div class="tbl"><table class="diff"><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>${keys.map((k) => `<tr><td class="mono">${esc(k.replace(/_/g, ' '))}</td><td class="old">${show(r.before[k])}</td><td class="new">${show(r.after[k])}</td></tr>`).join('')}</tbody></table></div>` : ''}
      </div>`;
    }).join('') || '<div class="empty">No changes recorded.</div>'}
    <div style="height:40px"></div></div>`;
}
