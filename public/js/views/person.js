import { get } from '../api.js';
import { esc, card, setTitle } from '../ui.js';

export default async function ({ el, params }) {
  const { person, editions } = await get(`/api/people/${params.id}`);
  setTitle(person.name);
  const films = new Map();
  editions.forEach((e) => (films.get(e.film_id) || films.set(e.film_id, { title: e.title, year: e.year, eds: [] }).get(e.film_id)).eds.push(e));
  el.innerHTML = `<div class="wrap"><div class="colhead"><div><div class="eyebrow">Director · ${films.size} film${films.size === 1 ? '' : 's'} · ${editions.length} editions</div><h1 class="big">${esc(person.name)}</h1></div></div>
    ${[...films.entries()].map(([id, f]) => `<section class="sec"><div class="hd"><h2><a href="/film/${id}">${esc(f.title)}</a></h2><span class="end mono dim">${f.year || ''}</span></div><div class="grid" style="padding-bottom:0">${f.eds.map(card).join('')}</div></section>`).join('')}
    <div style="height:60px"></div></div>`;
}
