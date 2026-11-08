// Shared sheets and forms: logging a film, review prompts, a copy on your shelf, edition and film fields.
import { post, patch, del, get, me } from './api.js';
import { esc, modal, bindForm, field, area, select, toast, CONDITIONS, poster, rateInput, I, VIA_NAMES, dateWords, confirmDialog, stars10, avatar, nameOf } from './ui.js';

const today = () => new Date().toISOString().slice(0, 10);

/* ---------- Log a film: date, where you watched it (your own disc?), rating, like, review ---------- */
export async function logSheet({ film = null, watch = null, copyId = null, via = null, onSaved } = {}) {
  if (!me.user) { location.assign('/login?next=' + encodeURIComponent(location.pathname)); return; }
  const state = {
    film: film || watch?.film || null,
    watched_on: watch ? watch.watched_on : today(),
    via: watch ? watch.via : (via || ''),
    copy_id: watch?.copy_id || copyId || null,
    edition_id: watch?.edition?.id || null,
    rewatch: watch ? watch.rewatch : false,
    rating: watch?.rating || null, liked: watch ? watch.liked : false,
    review: watch?.review || '', spoilers: watch ? watch.spoilers : false
  };
  let copies = [], seenBefore = false, rateCtl;

  const close = modal('<div class="logsheet"><h2>' + (watch ? 'Edit diary entry' : 'Log a film') + '</h2><div id="ls"></div></div>', { cls: 'logsheet', onMount: (d) => { void d; } });
  const box = document.getElementById('ls');

  async function loadFilmContext() {
    if (!state.film) return;
    try {
      const r = await get(`/api/films/${state.film.id}`);
      copies = r.mine?.copies || [];
      seenBefore = (r.mine?.watches || []).some((w) => !watch || w.id !== watch.id);
      if (!watch && seenBefore) state.rewatch = true;
      if (!watch && copies.length && !state.via) { state.via = 'dvd'; state.copy_id = copies[0].id; }
      if (state.copy_id && !state.edition_id) state.edition_id = copies.find((c) => c.id === state.copy_id)?.edition_id || null;
    } catch { /* fine */ }
  }

  function pickFilm() {
    box.innerHTML = `<div class="field"><label for="lf-q">Which film?</label><input id="lf-q" type="search" placeholder="Search the register" autocomplete="off"></div><div class="filmpick" id="lf-res"></div>
      <p class="dim" style="font-size:13px;margin-top:12px">Not on the register? <a class="link" href="/add">Add its DVD</a>, or log it straight from a <a class="link" href="/streaming">Netflix or Prime import</a>.</p>`;
    const q = box.querySelector('#lf-q'), res = box.querySelector('#lf-res');
    let t;
    q.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
      const v = q.value.trim(); if (v.length < 2) { res.innerHTML = ''; return; }
      const r = await get(`/api/films?q=${encodeURIComponent(v)}`);
      if (q.value.trim() !== v) return;
      res.innerHTML = r.items.map((f) => `<button type="button" data-f="${f.id}">${poster(f)}<div><b>${esc(f.title)}</b> <span>${f.year || ''}${f.directors?.length ? ' · ' + esc(f.directors[0].name) : ''}</span></div></button>`).join('') || '<p class="dim" style="padding:8px">Nothing on the register matches.</p>';
      res.querySelectorAll('[data-f]').forEach((b) => b.onclick = async () => { state.film = r.items.find((f) => f.id === +b.dataset.f); await loadFilmContext(); form(); });
    }, 200); };
    q.focus();
  }

  function form() {
    const f = state.film;
    const vias = ['dvd', 'netflix', 'prime', 'disney', 'apple', 'mubi', 'cinema', 'tv', 'other'];
    box.innerHTML = `
      <div class="film">${poster(f)}<div><div class="t">${esc(f.title)}</div><div class="s">${f.year || ''}${f.directors?.length ? ' · ' + esc(f.directors.map((d) => d.name).join(', ')) : ''} ${!watch && !film ? '· <button type="button" class="link" id="lf-change">Change</button>' : ''}</div></div></div>
      <div class="rowc"><label for="lf-date">Watched on</label><span style="display:flex;gap:8px;align-items:center"><input id="lf-date" type="date" max="${today()}" value="${esc(state.watched_on)}"><button type="button" class="btn sm ghost" id="lf-nodate" title="Leave the date out">${state.watched_on ? 'Don’t know' : 'Set'}</button></span></div>
      <div class="rowc" style="flex-direction:column;align-items:stretch;gap:10px"><span>Where did you watch it?</span>
        <div class="vias">${vias.map((v) => `<button type="button" data-via="${v}" class="${state.via === v ? 'on' : ''}">${v === 'dvd' ? 'My DVD' : esc(VIA_NAMES[v].replace('the ', ''))}</button>`).join('')}</div>
        <div id="lf-copies"></div></div>
      <div class="rowc"><span>Rating</span><div id="lf-rate"></div></div>
      <div class="rowc"><span>Like</span><button type="button" class="btn ghost heart ${state.liked ? 'on' : ''}" id="lf-like" aria-pressed="${state.liked}" style="width:44px;height:40px;padding:0">${state.liked ? I.heart : I.heartO}</button></div>
      <div class="rowc"><span>I’ve seen this before</span><label class="switch"><input type="checkbox" id="lf-rewatch" ${state.rewatch ? 'checked' : ''}><span></span></label></div>
      <div class="field" style="margin-top:12px"><label for="lf-review">Review <span class="dim" style="font-weight:400">(optional)</span></label><textarea id="lf-review" rows="4" placeholder="What stayed with you? If it was your own disc, how was the transfer?">${esc(state.review)}</textarea></div>
      <label class="check" style="margin-top:10px"><input type="checkbox" id="lf-spoilers" ${state.spoilers ? 'checked' : ''}> Contains spoilers</label>
      <div class="err" id="lf-err" style="margin-top:8px"></div>
      <div class="btns" style="margin-top:14px;justify-content:space-between"><div class="btns"><button type="button" class="btn primary lg" id="lf-save">${watch ? 'Save' : 'Save to diary'}</button><button type="button" class="btn ghost" id="lf-cancel">Cancel</button></div>${watch ? '<button type="button" class="btn ghost danger" id="lf-del">Delete</button>' : ''}</div>`;
    box.querySelector('#lf-change')?.addEventListener('click', pickFilm);
    const dateI = box.querySelector('#lf-date'), noDate = box.querySelector('#lf-nodate');
    dateI.onchange = () => { state.watched_on = dateI.value; noDate.textContent = state.watched_on ? 'Don’t know' : 'Set'; };
    noDate.onclick = () => { state.watched_on = state.watched_on ? '' : today(); dateI.value = state.watched_on; noDate.textContent = state.watched_on ? 'Don’t know' : 'Set'; };
    const paintCopies = () => {
      const cb = box.querySelector('#lf-copies');
      if (state.via !== 'dvd') { cb.innerHTML = ''; return; }
      cb.innerHTML = copies.length
        ? `<div class="copies">${copies.map((c) => `<button type="button" data-copy="${c.id}" class="${state.copy_id === c.id ? 'on' : ''}"><span><b>${esc(c.label || 'Unknown label')}</b> ${esc(c.cat_no || '')} <span class="reg r${esc((c.region || '')[0] || '')}">R${esc(c.region || '?')} ${esc(c.standard || '')}</span></span>${state.copy_id === c.id ? I.check : ''}</button>`).join('')}</div>`
        : `<p class="dim" style="font-size:13px;margin:4px 0 0">You don’t have this film on your shelf. The entry will say “on DVD”. <a class="link" href="/film/${f.id}">See editions</a> to add one.</p>`;
      cb.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => { state.copy_id = +b.dataset.copy; state.edition_id = copies.find((c) => c.id === state.copy_id)?.edition_id || null; paintCopies(); });
    };
    box.querySelectorAll('[data-via]').forEach((b) => b.onclick = () => {
      state.via = state.via === b.dataset.via ? '' : b.dataset.via;
      if (state.via !== 'dvd') { state.copy_id = null; state.edition_id = null; } else if (copies.length && !state.copy_id) { state.copy_id = copies[0].id; state.edition_id = copies[0].edition_id; }
      box.querySelectorAll('[data-via]').forEach((x) => x.classList.toggle('on', x.dataset.via === state.via)); paintCopies();
    });
    paintCopies();
    rateCtl = rateInput(box.querySelector('#lf-rate'), state.rating, (v) => { state.rating = v; });
    const likeB = box.querySelector('#lf-like');
    likeB.onclick = () => { state.liked = !state.liked; likeB.classList.toggle('on', state.liked); likeB.setAttribute('aria-pressed', state.liked); likeB.innerHTML = state.liked ? I.heart : I.heartO; };
    box.querySelector('#lf-rewatch').onchange = (e) => { state.rewatch = e.target.checked; };
    box.querySelector('#lf-cancel').onclick = close;
    box.querySelector('#lf-del')?.addEventListener('click', async () => {
      if (!await confirmDialog('Delete this diary entry?', 'Delete', true)) return;
      await del(`/api/watches/${watch.id}`); close(); toast('Entry deleted'); onSaved?.(null);
    });
    box.querySelector('#lf-save').onclick = async () => {
      const err = box.querySelector('#lf-err'); err.textContent = '';
      const body = { watched_on: state.watched_on, via: state.via, rewatch: state.rewatch, rating: state.rating, liked: state.liked, review: box.querySelector('#lf-review').value, spoilers: box.querySelector('#lf-spoilers').checked };
      if (state.via === 'dvd') { body.copy_id = state.copy_id; body.edition_id = state.edition_id; } else { body.copy_id = null; body.edition_id = null; }
      try {
        const r = watch ? await patch(`/api/watches/${watch.id}`, body) : await post('/api/watches', { ...body, film_id: f.id });
        me.watched.add(f.id); me.watchlist.delete(f.id); if (state.liked) me.liked.add(f.id); else me.liked.delete(f.id);
        close(); toast(watch ? 'Entry updated' : body.review ? 'Review posted' : 'Added to your diary'); onSaved?.(r.watch);
      } catch (e) { err.textContent = e.message; }
    };
  }

  if (state.film) { await loadFilmContext(); form(); } else pickFilm();
  return close;
}

/* ---------- "You watched X on Netflix. Rate it?" ---------- */
export function promptSheet(items, onDone) {
  const shown = items.slice(0, 3), rest = items.length - shown.length;
  modal(`<h2>Welcome back</h2><p class="dim" style="margin-top:-10px">${shown.length === 1 ? 'A film you watched is waiting for a rating.' : 'A few films you watched are waiting for a rating.'}</p>
    <div id="pr">${shown.map((w) => `<div class="prompt" data-id="${w.id}">${poster(w.film)}<div>
      <div class="t">${esc(w.film.title)} <span class="dim" style="font-weight:400;font-size:14px">${w.film.year || ''}</span></div>
      <div class="s">Watched on ${esc(VIA_NAMES[w.via] || 'a service')} · ${dateWords(w.watched_on)}${w.rewatch ? ' · rewatch' : ''}</div>
      <div class="acts"><div class="r" data-rate></div><button class="btn sm" data-review>Review</button><button class="btn sm ghost" data-later>Not now</button><button class="link dim" data-notme style="font-size:12px">Didn’t watch this</button></div>
    </div></div>`).join('')}</div>
    ${rest ? `<p class="dim" style="font-size:13px;margin:12px 0 0">${rest} more in <a class="link" href="/diary">your diary</a>.</p>` : ''}
    <div class="btns" style="margin-top:16px"><button class="btn ghost" data-all>Skip all for now</button></div>`, {
    onMount: (d, close) => {
      const act = async (row, action) => { await post(`/api/prompts/${row.dataset.id}`, { action }); row.remove(); if (!d.querySelector('.prompt')) { close(); onDone?.(); } };
      d.querySelectorAll('.prompt').forEach((row) => {
        const w = shown.find((x) => x.id === +row.dataset.id);
        rateInput(row.querySelector('[data-rate]'), null, async (v) => {
          if (!v) return;
          try { await patch(`/api/watches/${w.id}`, { rating: v }); toast(`Rated ${v / 2} stars`); row.remove(); if (!d.querySelector('.prompt')) { close(); onDone?.(); } } catch (e) { toast(e.message, true); }
        }, { size: 'sm' });
        row.querySelector('[data-review]').onclick = () => { close(); logSheet({ watch: w, onSaved: () => onDone?.() }); };
        row.querySelector('[data-later]').onclick = () => act(row, 'dismiss');
        row.querySelector('[data-notme]').onclick = () => act(row, 'not_me');
      });
      d.querySelector('[data-all]').onclick = async () => { await post(`/api/prompts/${shown[0].id}`, { action: 'dismiss_all' }); close(); onDone?.(); };
    }
  });
}

/* ---------- a copy on your shelf ---------- */
export function copyModal(edition, copy, onSaved) {
  const c = copy || {};
  modal(`<h2>${copy ? 'Edit your copy' : 'Add to your shelf'}</h2>
    <p class="dim" style="margin-top:-8px">${esc(edition.title)} · ${esc(edition.label || '')} ${esc(edition.cat_no || '')}</p>
    <form class="form cols" novalidate>
      ${select('disc_cond', 'Disc condition', CONDITIONS, c.disc_cond)}
      ${select('case_cond', 'Case condition', CONDITIONS, c.case_cond)}
      ${field('price', 'Price paid (£)', { type: 'number', value: c.price ?? '', attrs: 'min="0" step="0.01" inputmode="decimal"' })}
      ${field('acquired', 'Acquired', { value: c.acquired, attrs: 'placeholder="YYYY-MM-DD" pattern="\\d{4}(-\\d{2}(-\\d{2})?)?"', hint: 'Year, month or full date' })}
      ${field('tags', 'Tags', { value: c.tags, cls: 'full', hint: 'Comma separated, e.g. tarkovsky, to rewatch' })}
      ${area('notes', 'Notes', { value: c.notes, cls: 'full', attrs: 'rows="3" placeholder="Bought at… / disc 2 has a scratch…"' })}
      <div class="full err"></div>
      <div class="full btns"><button class="btn primary" type="submit">${copy ? 'Save copy' : 'Add to shelf'}</button></div>
    </form>`, {
    onMount: (d, close) => bindForm(d.querySelector('form'), async (v) => {
      const body = { ...v, price: v.price === '' ? null : Number(v.price) };
      const r = copy ? await patch(`/api/copies/${copy.id}`, body) : await post('/api/copies', { ...body, edition_id: edition.id });
      me.copies.add(edition.id); me.wants.delete(edition.id);
      close(); toast(copy ? 'Copy updated' : 'Added to your shelf');
      onSaved?.(r.copy);
    })
  });
}

const REGION_HINT = 'Number printed on the case. 0 for region-free; several as 2,4.';

export function editionFields(e = {}, labels = []) {
  return `
    <div class="field"><label for="f-label_name">Label</label><input id="f-label_name" name="label_name" list="label-list" value="${esc(e.label_name ?? e.label ?? '')}" required autocomplete="off"><datalist id="label-list">${labels.map((l) => `<option value="${esc(l.name)}">`).join('')}</datalist></div>
    ${field('cat_no', 'Catalogue number', { value: e.cat_no, hint: 'As printed on the spine or back' })}
    ${field('spine_no', 'Spine number', { type: 'number', value: e.spine_no ?? '', attrs: 'min="0" inputmode="numeric"' })}
    ${field('region', 'Region', { value: e.region, hint: REGION_HINT, attrs: 'required inputmode="numeric" pattern="0|[1-8](,[1-8])*"' })}
    ${select('standard', 'Video standard', [['', 'Unknown'], ['PAL', 'PAL'], ['NTSC', 'NTSC']], e.standard)}
    ${select('anamorphic', 'Anamorphic 16:9', [['', 'Unknown / n.a.'], ['1', 'Yes'], ['0', 'No (letterboxed)']], e.anamorphic == null ? '' : e.anamorphic ? '1' : '0')}
    ${field('release_year', 'Release year', { type: 'number', value: e.release_year ?? '', attrs: 'min="1995" max="2100" inputmode="numeric"' })}
    ${field('discs', 'Discs', { type: 'number', value: e.discs ?? 1, attrs: 'min="1" max="50" inputmode="numeric"' })}
    ${select('disc_type', 'Disc type', [['', 'Unknown'], ['DVD-5', 'DVD-5 (single layer)'], ['DVD-9', 'DVD-9 (dual layer)'], ['DVD-10', 'DVD-10'], ['DVD-18', 'DVD-18']], e.disc_type)}
    ${field('packaging', 'Packaging', { value: e.packaging, attrs: 'list="pack-list"', hint: 'Keep case, Snapper, Digipak…' })}<datalist id="pack-list">${['Keep case', 'Snapper', 'Digipak', 'Slim case', 'Slipcase + keep case', 'Steelbook', 'Box set', 'Card sleeve'].map((p) => `<option value="${p}">`).join('')}</datalist>
    ${field('barcode', 'Barcode', { value: e.barcode, attrs: 'inputmode="numeric" pattern="\\d{8,14}"', hint: 'Digits under the barcode on the back' })}
    <div class="field"><span class="lbl">Availability</span><label class="check"><input type="checkbox" name="oop" value="1" ${e.oop ? 'checked' : ''}> Out of print</label></div>
    ${field('audio', 'Audio', { value: e.audio, cls: 'full', hint: 'e.g. Russian mono (Dolby Digital 1.0); English commentary' })}
    ${field('subtitles', 'Subtitles', { value: e.subtitles, cls: 'full', hint: 'e.g. English (optional), French' })}
    ${area('extras', 'Supplements', { value: (e.extras || []).join('\n'), cls: 'full', hint: 'One per line, as listed on the case', attrs: 'rows="6"' })}
    ${area('notes', 'Notes', { value: e.notes, cls: 'full', hint: 'Transfer quality, variants, how to tell pressings apart', attrs: 'rows="3"' })}`;
}

export function readEdition(v) {
  return {
    label_name: v.label_name, cat_no: v.cat_no, spine_no: v.spine_no, region: v.region.replace(/\s/g, ''), standard: v.standard,
    anamorphic: v.anamorphic === '' ? null : v.anamorphic === '1', release_year: v.release_year, discs: v.discs || 1, disc_type: v.disc_type,
    packaging: v.packaging, barcode: v.barcode.replace(/\s/g, ''), oop: v.oop === '1', audio: v.audio, subtitles: v.subtitles,
    extras: v.extras.split('\n').map((s) => s.trim()).filter(Boolean), notes: v.notes
  };
}

export function filmFields(f = {}) {
  return `
    ${field('title', 'Title', { value: f.title, cls: 'full', attrs: 'required', hint: 'Usual English-language title' })}
    ${field('original_title', 'Original title', { value: f.original_title })}
    ${field('directors', 'Director(s)', { value: (f.directors || []).map((d) => d.name || d).join(', '), hint: 'Comma separated' })}
    ${field('year', 'Year', { type: 'number', value: f.year ?? '', attrs: 'min="1888" max="2100" inputmode="numeric"' })}
    ${field('country', 'Country', { value: f.country })}
    ${field('language', 'Original language', { value: f.language })}
    ${field('runtime', 'Runtime (min, at film speed)', { type: 'number', value: f.runtime ?? '', attrs: 'min="1" inputmode="numeric"' })}
    ${field('aspect', 'Original aspect ratio', { value: f.aspect, attrs: 'placeholder="1.85:1" pattern="\\d\\.\\d{2}:1"' })}
    ${area('synopsis', 'Synopsis', { value: f.synopsis, cls: 'full', attrs: 'rows="3"', hint: 'One or two sentences, in your own words' })}`;
}

export function readFilm(v) {
  return {
    title: v.title, original_title: v.original_title, directors: v.directors.split(',').map((s) => s.trim()).filter(Boolean),
    year: v.year, country: v.country, language: v.language, runtime: v.runtime, aspect: v.aspect, synopsis: v.synopsis
  };
}

export const loadLabels = () => get('/api/labels').then((r) => r.items);

export function changed(current, next) {
  const out = {};
  for (const [k, val] of Object.entries(next)) {
    const a = current[k], b = val;
    const norm = (x) => Array.isArray(x) ? JSON.stringify(x) : x === true ? '1' : x === false ? '0' : x == null ? '' : String(x);
    if (norm(a) !== norm(b)) out[k] = val;
  }
  return out;
}

/* follow button used in several places */
export function followButton(username, following, cls = 'sm') {
  return `<button class="btn ${cls} ${following ? '' : 'primary'}" data-follow="${esc(username)}" aria-pressed="${following}">${following ? 'Following' : 'Follow'}</button>`;
}
export function wireFollows(root, onChange) {
  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-follow]'); if (!b) return;
    if (!me.user) { location.assign('/login?next=' + encodeURIComponent(location.pathname)); return; }
    const on = b.getAttribute('aria-pressed') === 'true';
    try {
      if (on) { await del(`/api/users/${encodeURIComponent(b.dataset.follow)}/follow`); me.following.delete(b.dataset.follow); }
      else { await post(`/api/users/${encodeURIComponent(b.dataset.follow)}/follow`); me.following.add(b.dataset.follow); }
      b.setAttribute('aria-pressed', !on); b.textContent = on ? 'Follow' : 'Following'; b.classList.toggle('primary', on);
      toast(on ? `Unfollowed ${b.dataset.follow}` : `Following ${b.dataset.follow}`);
      onChange?.(b.dataset.follow, !on);
    } catch (e) { toast(e.message, true); }
  });
}
void stars10; void avatar; void nameOf;
