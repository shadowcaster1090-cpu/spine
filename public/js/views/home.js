import { get, me } from '../api.js';
import { esc, num, cover, card, directors, regTag, setTitle } from '../ui.js';

export default async function ({ el }) {
  setTitle('');
  const d = await get('/api/home');
  const f = d.featured;
  if (!f) {
    el.innerHTML = `<div class="wrap"><div class="colhead"><div><div class="eyebrow">An empty register</div><h1 class="big">Start the shelf.</h1></div></div>
      <p class="prose">Nothing has been catalogued yet. ${me.user ? '<a href="/add">Add the first edition</a>: scan its barcode or type the details from the case.' : '<a href="/signup">Create an account</a> to add the first edition. The first account becomes the administrator.'}</p></div>`;
    return;
  }
  const [bg, , ac] = f.palette;
  el.innerHTML = `
  <section class="hero"><div class="glow" style="background:radial-gradient(40% 60% at 22% 50%,${ac},transparent 70%),radial-gradient(40% 60% at 80% 30%,${bg},transparent 70%)"></div><div class="wrap">
    <a href="/release/${f.id}" aria-label="Open ${esc(f.title)}">${cover(f)}</a>
    <div><div class="eyebrow">Most wanted on the register · ${esc(f.label || '')}${f.spine_no != null ? ' No. ' + f.spine_no : ''}</div>
      <h1>${esc(f.title)}</h1>
      <div class="by">${directors(f.directors)} &nbsp;·&nbsp; ${esc(f.country || '')}${f.year ? ', ' + f.year : ''} &nbsp;·&nbsp; ${regTag(f)}</div>
      <p class="blurb">Spine catalogues DVD editions the way collectors think about them: by label, spine number, region and transfer. Track what is on your shelf, hunt what is missing, and fix the record when you know better.</p>
      <div class="statrow"><div class="stat"><div class="n">${num(f.have)}</div><div class="l">Have it</div></div><div class="stat"><div class="n">${num(f.want)}</div><div class="l">Want it</div></div><div class="stat"><div class="n">${f.rating ?? '—'}</div><div class="l">Rating</div></div></div>
      <div class="btns"><a class="btn primary" href="/release/${f.id}">View edition</a><a class="btn" href="/browse">Browse the register</a></div>
    </div></div></section>
  <div class="strip">
    <div><div class="n">${num(d.stats.editions)}</div><div class="l">Editions</div></div>
    <div><div class="n">${num(d.stats.films)}</div><div class="l">Films</div></div>
    <div><div class="n">${num(d.stats.labels)}</div><div class="l">Labels</div></div>
    <div><div class="n">${num(d.stats.members)}</div><div class="l">Members</div></div>
    <div><div class="n">${num(d.stats.copies)}</div><div class="l">Discs on shelves</div></div>
  </div>
  <div class="wrap">
    <section class="sec"><div class="hd"><h2>Recently catalogued</h2><a class="end mono dim" href="/browse?sort=recent">See all →</a></div>
      <div class="rail">${d.recent.map(card).join('')}</div></section>
    <section class="sec"><div class="hd"><h2>Labels</h2><a class="end mono dim" href="/labels">All labels →</a></div>
      <div class="labelgrid">${d.labels.map((l) => `<a href="/label/${l.id}"><b>${esc(l.name)}</b><span class="mono dim">${esc(l.country || '')} · ${l.n} editions</span></a>`).join('')}</div></section>
    ${d.lists.length ? `<section class="sec"><div class="hd"><h2>Lists from collectors</h2><a class="end mono dim" href="/lists">All lists →</a></div>
      <div class="labelgrid">${d.lists.map((l) => `<a href="/list/${l.id}"><b>${esc(l.title)}</b><span class="mono dim">${esc(l.username)} · ${l.n} editions</span></a>`).join('')}</div></section>` : ''}
    <div style="height:40px"></div>
  </div>`;
}
