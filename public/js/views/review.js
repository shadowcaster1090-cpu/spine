import { get } from '../api.js';
import { esc, reviewCard, wireReviews, setTitle, nameOf, filmCard } from '../ui.js';
import { logSheet } from '../forms.js';

export default async function view(ctx) {
  const { el, params } = ctx;
  const { watch: w } = await get(`/api/watches/${params.id}`);
  setTitle(`${nameOf(w.user)} on ${w.film.title}`);
  el.innerHTML = `<div class="wrap narrow"><div class="crumb"><a href="/u/${esc(w.user.username)}">${esc(nameOf(w.user))}</a> / <a href="/u/${esc(w.user.username)}/diary">Diary</a></div>
    <div class="colhead"><div><div class="eyebrow">${w.review ? 'Review' : 'Diary entry'}</div><h1 class="big">${esc(w.film.title)}</h1></div></div>
    <div class="reviews" id="rv">${reviewCard(w)}</div>
    <section class="sec"><div class="hd"><h2>The film</h2></div><div class="grid films" style="max-width:160px">${filmCard(w.film)}</div></section><div style="height:40px"></div></div>`;
  wireReviews(el.querySelector('#rv'), () => logSheet({ watch: w, onSaved: () => view(ctx) }));
}
