import { get, me } from '../api.js';
import { esc, card, directors, setTitle } from '../ui.js';

export default async function ({ el, params }) {
  const { film: f, editions } = await get(`/api/films/${params.id}`);
  setTitle(f.title);
  const regions = [...new Set(editions.map((e) => e.region).filter(Boolean))];
  el.innerHTML = `<div class="wrap">
    <div class="crumb mono"><a href="/browse">Browse</a> / ${esc(f.title)}</div>
    <div class="colhead"><div style="max-width:880px"><div class="eyebrow">Film · ${editions.length} edition${editions.length === 1 ? '' : 's'} on the register</div><h1 class="big">${esc(f.title)}</h1>
      <div class="by" style="margin-top:12px">${directors(f.directors)}${f.country ? ' &nbsp;·&nbsp; ' + esc(f.country) : ''}${f.year ? ', ' + f.year : ''}${f.runtime ? ' &nbsp;·&nbsp; ' + f.runtime + ' min' : ''}${f.aspect ? ' &nbsp;·&nbsp; ' + esc(f.aspect) : ''}</div>
      ${f.original_title ? `<div class="dim" style="margin-top:6px">${esc(f.original_title)}${f.language ? ' · ' + esc(f.language) : ''}</div>` : ''}
      ${f.synopsis ? `<p class="prose" style="margin-top:14px">${esc(f.synopsis)}</p>` : ''}</div>
      <div class="end">${me.user ? `<a class="btn" href="/film/${f.id}/edit">Edit film</a><a class="btn primary" href="/add?film=${f.id}">+ Add an edition</a>` : ''}</div></div>
    ${regions.length > 1 ? `<p class="mono dim" style="margin-bottom:20px">Released in regions ${regions.map(esc).join(', ')}</p>` : ''}
    <div class="grid">${editions.map(card).join('')}</div></div>`;
}
