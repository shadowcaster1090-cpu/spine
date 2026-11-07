import { get, me } from '../api.js';
import { esc, cover, card, regTag, pad, setTitle } from '../ui.js';

export default async function view(ctx) {
  const { el, params, query, go } = ctx;
  const { label: l, editions, gaps } = await get(`/api/labels/${params.id}`);
  setTitle(l.name);
  const mode = query.get('view') || 'run';
  const numbered = editions.filter((e) => e.spine_no != null);
  const owned = numbered.filter((e) => me.copies.has(e.id)).length;
  // Merge editions and gaps into one numbered run, collapsing long gaps.
  const run = [];
  if (numbered.length) {
    const byNo = new Map();
    numbered.forEach((e) => (byNo.get(e.spine_no) || byNo.set(e.spine_no, []).get(e.spine_no)).push(e));
    const nos = [...new Set([...byNo.keys(), ...gaps])].sort((a, b) => a - b);
    let gapStart = null;
    const flush = (end) => { if (gapStart != null) { run.push({ gap: [gapStart, end] }); gapStart = null; } };
    let prev = null;
    for (const n of nos) {
      if (byNo.has(n)) { flush(prev); byNo.get(n).forEach((e) => run.push({ e })); }
      else if (gapStart == null) gapStart = n;
      prev = n;
    }
    flush(prev);
  }
  const unnumbered = editions.filter((e) => e.spine_no == null);
  el.innerHTML = `<div class="wrap">
    <div class="crumb mono"><a href="/labels">Labels</a> / ${esc(l.name)}</div>
    <div class="colhead"><div style="max-width:760px"><div class="eyebrow">${esc(l.country || 'Label')} · ${editions.length} editions${gaps.length ? ` · ${gaps.length} spine numbers not yet catalogued` : ''}</div><h1 class="big">${esc(l.name)}</h1>
      ${l.about ? `<p class="prose" style="margin-top:14px">${esc(l.about)}</p>` : ''}${l.website ? `<p><a class="link" href="${esc(l.website)}" rel="noopener nofollow">${esc(l.website.replace(/^https?:\/\//, ''))}</a></p>` : ''}</div>
      <div class="end"><div class="seg"><a href="?view=run" class="${mode === 'run' ? 'on' : ''}">Spine run</a><a href="?view=covers" class="${mode === 'covers' ? 'on' : ''}">Covers</a></div>${me.user ? `<a class="btn sm" href="/label/${l.id}/edit">Edit label</a>` : ''}</div></div>
    ${me.user && numbered.length ? `<p class="mono dim" style="margin-bottom:16px">You own ${owned} of ${numbered.length} numbered editions.</p>` : ''}
    ${mode === 'covers' ? `<div class="grid">${editions.map(card).join('')}</div>` : `
    ${run.length ? `<div class="run">${run.map((x) => x.gap
      ? `<div class="gap"><span class="no">${pad(x.gap[0])}${x.gap[1] !== x.gap[0] ? '–' + pad(x.gap[1]) : ''}</span><span class="ph"></span><span>Not on the register yet${me.user ? ` · <a class="link" href="/add?label=${encodeURIComponent(l.name)}&spine=${x.gap[0]}">add it</a>` : ''}</span></div>`
      : `<a href="/release/${x.e.id}" class="${me.copies.has(x.e.id) ? 'mine' : ''}"><span class="no">${pad(x.e.spine_no)}</span>${cover(x.e, 'thumb')}<span class="t">${esc(x.e.title)}<small>${x.e.year || ''} · ${x.e.directors.map((d) => esc(d.name)).join(', ')} · ${regTag(x.e)}${me.copies.has(x.e.id) ? ' · in your shelf' : ''}</small></span></a>`).join('')}</div>` : ''}
    ${unnumbered.length ? `<section class="sec"><div class="hd"><h2>Unnumbered releases</h2></div><div class="grid">${unnumbered.map(card).join('')}</div></section>` : ''}`}
    <div style="height:60px"></div></div>`;
  void go;
}
