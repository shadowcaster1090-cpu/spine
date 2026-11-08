import { get, post, me } from '../api.js';
import { esc, card, bindForm, setTitle, toast, $ } from '../ui.js';
import { editionFields, readEdition, filmFields, readFilm, loadLabels, copyModal } from '../forms.js';
import { submitted } from './shared-submitted.js';
import { startScanner, decodeFile, normalise, unlockFeedback } from '../scan.js';

export default async function ({ el, query, go, needLogin }) {
  if (!me.user) return needLogin();
  setTitle('Add an edition');
  const own = query.get('own') !== '0', back = query.get('back') === 'scan' ? '/scan' : null;
  const state = { barcode: query.get('barcode') || '', film: null, newFilm: null, label: query.get('label') || '', spine: query.get('spine') || '' };
  let stopScan = null;
  const stop = () => { if (stopScan) { stopScan(); stopScan = null; } };

  const frame = (step, inner) => {
    stop();
    el.innerHTML = `<div class="wrap" style="max-width:980px">
      <div class="colhead"><div><div class="eyebrow">Add to the register</div><h1 class="big">${step === 'scan' ? 'Scan the barcode' : step === 'film' ? 'Which film?' : 'Edition details'}</h1></div></div>
      <div class="steps"><span class="${step === 'scan' ? 'on' : ''}">1 · Barcode</span><span class="${step === 'film' ? 'on' : ''}">2 · Film</span><span class="${step === 'details' ? 'on' : ''}">3 · Details</span></div>
      ${inner}<div style="height:60px"></div></div>`;
  };

  /* step 1: barcode */
  function scanStep() {
    frame('scan', `<div style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:32px" class="addgrid">
      <div><div class="scanner" id="scanner"><video id="video" playsinline muted></video><div class="aim"></div></div>
        <div class="btns" style="margin-top:12px"><button class="btn primary" id="cam">Start camera</button><label class="btn" for="photo">Use a photo</label><input id="photo" type="file" accept="image/*" capture="environment" hidden><span class="dim" id="camnote" style="font-size:13px"></span></div>
        <p class="dim" style="margin-top:10px;font-size:13px">Adding a stack of discs you own? <a class="link" href="/scan">Scan to shelf</a> adds them one after another.</p></div>
      <div><form class="form" id="manual"><div class="field"><label for="f-code">Or type the barcode</label><input id="f-code" name="code" inputmode="numeric" autocomplete="off" value="${esc(state.barcode)}" placeholder="e.g. 5022089123457"><small>The 8 to 14 digits under the bars on the back of the case.</small></div><div class="err"></div>
        <div class="btns"><button class="btn primary" type="submit">Look it up</button><button class="btn ghost" type="button" id="skip">No barcode</button></div></form>
        <div id="found" style="margin-top:24px"></div></div></div>`);
    const video = $('#video', el), note = $('#camnote', el);
    $('#cam', el).onclick = async () => {
      note.textContent = 'Starting camera…';
      unlockFeedback();
      try { const sc = await startScanner(video, (code) => { stopScan = null; $('#f-code', el).value = code; lookup(code).catch((e) => toast(e.message, true)); }); stopScan = sc.stop; note.textContent = 'Hold the barcode inside the red box.'; }
      catch (e) { note.textContent = e.message; }
    };
    $('#photo', el).onchange = async (ev) => {
      const f = ev.target.files[0]; ev.target.value = '';
      if (!f) return;
      note.textContent = 'Reading the photo…';
      const code = await decodeFile(f).catch(() => null);
      note.textContent = code ? '' : 'No barcode found in that photo. Type the numbers instead.';
      if (code) { $('#f-code', el).value = code; lookup(code).catch((e) => toast(e.message, true)); }
    };
    $('#skip', el).onclick = () => { state.barcode = ''; filmStep(); };
    bindForm($('#manual', el), async (v) => lookup(v.code));
    if (state.barcode) lookup(state.barcode).catch((e) => toast(e.message, true));
  }

  async function lookup(raw) {
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 14) throw new Error('A barcode is 8 to 14 digits.');
    const code = normalise(digits) || digits;
    state.barcode = code;
    const r = await get(`/api/barcode/${code}`);
    const box = $('#found', el);
    if (!r.items.length) { toast('Not on the register yet. Let’s add it.'); return filmStep(); }
    box.innerHTML = `<div class="eyebrow" style="margin-bottom:12px">Already on the register</div><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr));padding-bottom:12px">${r.items.map(card).join('')}</div>
      <div class="btns">${r.items.length === 1 ? `<button class="btn primary" data-own="${r.items[0].id}">${me.copies.has(r.items[0].id) ? 'Add another copy' : 'Add to my shelf'}</button>` : ''}<button class="btn ghost" id="different">It’s a different edition</button></div>`;
    box.querySelector('[data-own]')?.addEventListener('click', () => copyModal(r.items[0], null, () => go(`/release/${r.items[0].id}`)));
    $('#different', box).onclick = () => { state.barcode = ''; filmStep(); };
  }

  /* step 2: film */
  function filmStep() {
    frame('film', `<p class="prose">Search for the film this disc contains. If it is already on the register, pick it so editions stay grouped together.</p>
      <div class="field" style="max-width:520px;margin:18px 0"><label for="f-fq">Film title</label><input id="f-fq" type="search" autocomplete="off" placeholder="Start typing a title"></div>
      <div id="fres"></div>
      <p style="margin-top:18px"><button class="link" id="manualfilm">The film isn’t listed: enter its details</button></p>
      ${state.barcode ? `<p class="mono dim" style="margin-top:20px">Barcode ${esc(state.barcode)} will be saved with the edition.</p>` : ''}`);
    const inp = $('#f-fq', el), res = $('#fres', el);
    let t, tmdbOff = false;
    inp.oninput = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const q = inp.value.trim();
        if (q.length < 2) { res.innerHTML = ''; return; }
        const [local, remote] = await Promise.all([get(`/api/films?q=${encodeURIComponent(q)}`), tmdbOff ? null : get(`/api/tmdb/search?q=${encodeURIComponent(q)}`).then((r) => { if (r.disabled) tmdbOff = true; return r; }).catch(() => null)]);
        if (inp.value.trim() !== q) return;
        const known = new Set(local.items.map((f) => `${f.title.toLowerCase()}|${f.year}`));
        const ext = (remote?.items || []).filter((m) => !known.has(`${m.title.toLowerCase()}|${m.year}`));
        res.innerHTML = `${local.items.length ? `<div class="eyebrow" style="margin:6px 0">On the register</div><div class="pick">${local.items.map((f) => `<button data-film="${f.id}"><span><b>${esc(f.title)}</b> <span class="dim">${f.year || ''} · ${f.directors.map((d) => esc(d.name)).join(', ')}</span></span><span class="mono dim">${f.editions} edition${f.editions === 1 ? '' : 's'}</span></button>`).join('')}</div>` : ''}
          ${ext.length ? `<div class="eyebrow" style="margin:18px 0 6px">From The Movie Database</div><div class="pick">${ext.map((m) => `<button data-tmdb="${m.tmdb_id}"><span><b>${esc(m.title)}</b> <span class="dim">${m.year || ''}${m.original_title && m.original_title !== m.title ? ' · ' + esc(m.original_title) : ''}</span></span><span class="mono dim">new to Spine</span></button>`).join('')}</div>` : ''}
          ${!local.items.length && !ext.length ? '<p class="dim">No films found.</p>' : ''}`;
      }, 220);
    };
    res.onclick = async (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.film) { state.film = (await get(`/api/films/${b.dataset.film}`)).film; state.newFilm = null; }
        if (b.dataset.tmdb) {
          const r = await get(`/api/tmdb/movie/${b.dataset.tmdb}`);
          if (r.existing_film_id) { state.film = (await get(`/api/films/${r.existing_film_id}`)).film; state.newFilm = null; } else { state.film = null; state.newFilm = r.film; }
        }
        detailsStep();
      } catch (e) { toast(e.message, true); }
    };
    $('#manualfilm', el).onclick = () => { state.film = null; state.newFilm = { title: inp.value.trim() }; detailsStep(); };
    inp.focus();
  }

  /* step 3: details */
  async function detailsStep() {
    const labels = await loadLabels();
    const f = state.film;
    frame('details', `<form class="form" novalidate>
      ${f ? `<div class="panel" style="display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap"><div><div class="eyebrow">Film</div><div style="font-family:var(--display);font-size:28px;font-style:italic">${esc(f.title)}</div><div class="dim">${f.directors.map((d) => esc(d.name)).join(', ')}${f.year ? ' · ' + f.year : ''}</div></div><button class="btn sm ghost" type="button" id="chfilm">Change film</button></div>`
        : `<div class="panel"><div class="eyebrow" style="margin-bottom:14px">New film${state.newFilm?.tmdb_id ? ' · details from TMDB, check them' : ''}</div><div class="form cols">${filmFields(state.newFilm || {})}</div></div>`}
      <div class="panel"><div class="eyebrow" style="margin-bottom:14px">This edition · copy what is printed on the case</div><div class="form cols">${editionFields({ barcode: state.barcode, label_name: state.label, spine_no: state.spine, discs: 1 }, labels)}</div></div>
      <label class="check"><input type="checkbox" name="own" value="1" ${own ? 'checked' : ''}> I own this edition: put it on my shelf ${me.user.role === 'member' ? 'once a moderator approves it' : ''}</label>
      <div class="err"></div>
      <div class="btns"><button class="btn primary" type="submit">${me.user.role === 'member' ? 'Submit for review' : 'Add to the register'}</button><button class="btn ghost" type="button" id="back">Back</button></div></form>`);
    $('#chfilm', el)?.addEventListener('click', filmStep);
    $('#back', el).onclick = filmStep;
    bindForm(el.querySelector('form'), async (v) => {
      const payload = { ...readEdition(v) };
      if (f) payload.film_id = f.id;
      else payload.film = { ...readFilm(v), tmdb_id: state.newFilm?.tmdb_id || null };
      if (!payload.label_name) throw new Error('Which label released this edition?');
      if (!payload.region) throw new Error('Add the region printed on the case (0 for region-free).');
      payload.add_to_shelf = !!v.own;
      const r = await post('/api/submissions', { kind: 'edition', payload });
      if (r.status === 'approved' && v.own) { me.copies.add(r.result_id); me.wants.delete(r.result_id); }
      submitted(el, r, back || (r.result_id ? `/release/${r.result_id}` : '/contributions'), go, back ? 'Back to scanning' : 'Back');
    });
  }

  if (query.get('film')) {
    state.film = (await get(`/api/films/${query.get('film')}`)).film;
    await detailsStep();
  } else if (state.label) {
    filmStep();
  } else scanStep();
  return stop;
}
