import { get, post, del, me } from '../api.js';
import { esc, cover, regTag, setTitle, toast, $ } from '../ui.js';
import { copyModal } from '../forms.js';
import { startScanner, decodeFile, normalise, unlockFeedback, feedback } from '../scan.js';

const KEY = 'spine-scan-session';
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || { mode: 'shelf', items: [] }; } catch { return { mode: 'shelf', items: [] }; } };
const save = (s) => { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } };

export default async function ({ el, needLogin, go }) {
  if (!me.user) return needLogin();
  setTitle('Scan discs');
  const S = load();
  let scanner = null;
  const busy = new Set();

  el.innerHTML = `<div class="wrap">
    <div class="colhead"><div><div class="eyebrow">Point the camera at the barcode on the back of the case</div><h1 class="big">Scan discs</h1></div>
      <div class="end"><span class="eyebrow">Add to</span><div class="seg" role="radiogroup" aria-label="Add scanned discs to">
        <button data-mode="shelf" role="radio">My shelf</button><button data-mode="want" role="radio">Wantlist</button></div></div></div>
    <div class="scanlayout">
      <div>
        <div class="scanner" id="scanner"><video id="video" playsinline muted></video><div class="aim"></div>
          <div class="scanflash" id="flash" aria-hidden="true"></div>
          <div class="scanidle" id="idle"><button class="btn primary" id="start">Start camera</button><span>Scanning keeps going, so you can work through a stack of discs.</span></div></div>
        <div class="btns" style="margin-top:12px">
          <button class="btn sm" id="stop" hidden>Stop camera</button>
          <button class="btn sm" id="torch" hidden aria-pressed="false">Torch</button>
          <label class="btn sm" for="photo">Use a photo instead</label><input id="photo" type="file" accept="image/*" capture="environment" hidden>
          <span class="dim mono" id="status" role="status" aria-live="polite"></span>
        </div>
        <form id="manual" class="btns" style="margin-top:16px" autocomplete="off">
          <label class="sr" for="code">Barcode</label><input id="code" inputmode="numeric" placeholder="Or type the barcode" style="max-width:260px">
          <button class="btn sm" type="submit">Add</button></form>
      </div>
      <div><div class="sec" style="margin-top:0"><div class="hd"><h2>This session</h2><span class="end mono dim" id="tally"></span></div><div id="items" class="rows"></div>
        <p class="dim" style="margin-top:14px;font-size:13px">Discs go straight onto your shelf, ungraded. Tap <b>Grade</b> to add condition, price and notes now, or do it later from your collection.</p></div></div>
    </div></div>`;

  const status = (t) => { $('#status', el).textContent = t; };
  const paintMode = () => el.querySelectorAll('[data-mode]').forEach((b) => { const on = b.dataset.mode === S.mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  paintMode();

  function row(it, i) {
    const e = it.edition;
    const head = e ? `<a href="/release/${e.id}">${cover(e)}</a><div><a class="t" href="/release/${e.id}">${esc(e.title)}</a><div class="s"><span>${esc(e.label || '')} ${esc(e.cat_no || '')}</span>${regTag(e)}<span class="mono">${esc(it.code)}</span></div>`
      : `<div class="cv gen" style="display:grid;place-items:center;font-family:var(--mono);font-size:10px;color:var(--dim)">?</div><div><div class="t">${it.state === 'looking' ? 'Looking up…' : 'Not on the register'}</div><div class="s"><span class="mono">${esc(it.code)}</span></div>`;
    const chip = {
      looking: '', added: '<span class="status approved">On your shelf</span>', wanted: '<span class="status approved">Wanted</span>',
      already: '<span class="status pending">Already on your shelf</span>', owned: '<span class="status pending">You own this</span>',
      multiple: `<span class="status pending">${it.choices?.length} editions share this barcode</span>`, unknown: '', pending: '<span class="status pending">Waiting for review</span>', error: `<span class="status rejected">${esc(it.error || 'Failed')}</span>`
    }[it.state] || '';
    const acts = {
      added: it.copyId ? `<button class="btn sm" data-grade="${i}">Grade</button><button class="link" data-undo="${i}">Undo</button>` : '',
      wanted: `<button class="link" data-undo="${i}">Undo</button>`,
      already: `<button class="btn sm" data-again="${i}">Add another copy</button>`,
      unknown: `<a class="btn sm primary" href="/add?barcode=${esc(it.code)}&own=${S.mode === 'shelf' ? 1 : 0}&back=scan">Add it</a>`,
      error: `<button class="btn sm" data-retry="${i}">Try again</button>`
    }[it.state] || '';
    const choices = it.state === 'multiple' ? `<div class="pick" style="margin-top:8px">${it.choices.map((c, k) => `<button data-choose="${i}:${k}"><span><b>${esc(c.label || '')}</b> <span class="dim">${esc(c.cat_no)} · ${esc(c.packaging || '')}</span></span>${regTag(c)}</button>`).join('')}</div>` : '';
    const note = it.state === 'unknown' ? '<p class="dim" style="margin:6px 0 0;font-size:13px">Add its details once and it goes on your shelf; everyone else can scan it after that.</p>'
      : it.state === 'pending' ? `<p class="dim" style="margin:6px 0 0;font-size:13px">${it.mine ? 'You already submitted this edition. It will go on your shelf when a moderator approves it.' : 'Someone has submitted this edition. Scan it again once it’s approved.'}</p>` : '';
    return `<div class="wrow scanrow">${head}<div class="s" style="margin-top:6px">${chip}</div>${note}${choices}</div><div class="act btns">${acts}</div></div>`;
  }
  const paint = () => {
    $('#items', el).innerHTML = S.items.length ? S.items.map(row).join('') : '<p class="dim" style="padding:16px 0">Nothing scanned yet.</p>';
    const n = S.items.filter((i) => i.state === 'added').length, w = S.items.filter((i) => i.state === 'wanted').length;
    $('#tally', el).textContent = [n && `${n} added`, w && `${w} wanted`].filter(Boolean).join(' · ');
    save(S);
  };
  paint();

  function flash(text, ok = true) {
    const f = $('#flash', el);
    f.textContent = text; f.className = 'scanflash show' + (ok ? '' : ' warn');
    clearTimeout(flash.t); flash.t = setTimeout(() => { f.className = 'scanflash'; }, 1400);
  }

  async function addEdition(it, e) {
    if (S.mode === 'want') {
      if (me.copies.has(e.id)) { it.state = 'owned'; return; }
      await post('/api/wants', { edition_id: e.id }); me.wants.add(e.id); it.state = 'wanted';
    } else {
      const r = await post('/api/copies', { edition_id: e.id });
      me.copies.add(e.id); me.wants.delete(e.id);
      it.copyId = r.copy.id; it.state = 'added';
    }
  }

  async function handle(code, fresh = true) {
    if (busy.has(code)) return;
    // Scanning the same disc again within this session: don't add a second copy by accident.
    const prev = S.items.find((x) => x.code === code);
    if (fresh && prev && prev.state !== 'error') {
      S.items = [prev, ...S.items.filter((x) => x !== prev)]; paint();
      flash(prev.edition ? `Already scanned: ${prev.edition.title}` : 'Already scanned', false);
      return;
    }
    busy.add(code);
    const it = prev && !fresh ? prev : { code, state: 'looking' };
    if (!prev || fresh) S.items.unshift(it);
    it.state = 'looking'; paint();
    try {
      const r = await get(`/api/barcode/${code}`);
      if (r.items.length === 1) {
        it.edition = r.items[0];
        if (S.mode === 'shelf' && me.copies.has(it.edition.id)) it.state = 'already';
        else await addEdition(it, it.edition);
      } else if (r.items.length > 1) { it.state = 'multiple'; it.choices = r.items; it.edition = { ...r.items[0], label: '', cat_no: '' }; }
      else if (r.pending) { it.state = 'pending'; it.mine = r.pending.mine; }
      else it.state = 'unknown';
      const t = it.edition?.title;
      flash(it.state === 'added' ? `Added: ${t}` : it.state === 'wanted' ? `Wanted: ${t}` : it.state === 'already' ? `Already on your shelf: ${t}` : it.state === 'unknown' ? 'Not on the register yet' : it.state === 'multiple' ? 'Pick the edition' : t || 'Scanned', ['added', 'wanted'].includes(it.state));
      if (!['added', 'wanted'].includes(it.state)) feedback(false);
    } catch (e) { it.state = 'error'; it.error = e.message; feedback(false); }
    busy.delete(code);
    paint();
  }

  async function begin() {
    unlockFeedback();
    status('Starting camera…');
    try {
      scanner = await startScanner($('#video', el), (code) => handle(code), { continuous: true });
      $('#idle', el).hidden = true; $('#stop', el).hidden = false; $('#torch', el).hidden = !scanner.torch;
      status('Hold the barcode inside the red box.');
    } catch (e) { status(''); toast(e.message, true); }
  }
  const end = () => { scanner?.stop(); scanner = null; $('#idle', el) && ($('#idle', el).hidden = false); $('#stop', el) && ($('#stop', el).hidden = true); $('#torch', el) && ($('#torch', el).hidden = true); status(''); };

  $('#start', el).onclick = begin;
  $('#stop', el).onclick = end;
  $('#torch', el).onclick = (ev) => { const on = ev.currentTarget.getAttribute('aria-pressed') !== 'true'; ev.currentTarget.setAttribute('aria-pressed', on); ev.currentTarget.classList.toggle('on', on); scanner?.setTorch(on); };
  $('#photo', el).onchange = async (ev) => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    status('Reading the photo…');
    try {
      const code = await decodeFile(f);
      status('');
      if (code) { feedback(true); handle(code); } else toast('Couldn’t find a barcode in that photo. Get closer, keep it flat and in focus, or type the numbers.', true);
    } catch { status(''); toast('Couldn’t read that image.', true); }
  };
  $('#manual', el).onsubmit = (ev) => {
    ev.preventDefault();
    const raw = $('#code', el).value.replace(/\D/g, '');
    const code = normalise(raw) || (raw.length >= 8 && raw.length <= 14 ? raw : null);
    if (!code) return toast('A barcode is 8 to 14 digits.', true);
    if (!normalise(raw)) toast('That barcode’s check digit doesn’t add up. Looking it up anyway.');
    $('#code', el).value = ''; unlockFeedback(); handle(code);
  };
  el.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { S.mode = b.dataset.mode; paintMode(); save(S); toast(S.mode === 'want' ? 'Scans now go to your wantlist' : 'Scans now go to your shelf'); });

  $('#items', el).onclick = async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.undo) {
        const it = S.items[+b.dataset.undo];
        if (it.state === 'added') { await del(`/api/copies/${it.copyId}`); me.copies.delete(it.edition.id); }
        if (it.state === 'wanted') { await del(`/api/wants/${it.edition.id}`); me.wants.delete(it.edition.id); }
        S.items.splice(+b.dataset.undo, 1); paint(); toast('Undone');
      }
      if (b.dataset.grade) {
        const it = S.items[+b.dataset.grade];
        copyModal(it.edition, { id: it.copyId, disc_cond: '', case_cond: '', price: null, acquired: '', tags: '', notes: '' }, () => {});
      }
      if (b.dataset.again) { const it = S.items[+b.dataset.again]; S.mode = 'shelf'; paintMode(); const r = await post('/api/copies', { edition_id: it.edition.id }); it.copyId = r.copy.id; it.state = 'added'; paint(); toast('Another copy added'); }
      if (b.dataset.retry) handle(S.items[+b.dataset.retry].code, false);
      if (b.dataset.choose) {
        const [i, k] = b.dataset.choose.split(':').map(Number), it = S.items[i];
        it.edition = it.choices[k]; delete it.choices;
        if (S.mode === 'shelf' && me.copies.has(it.edition.id)) it.state = 'already'; else await addEdition(it, it.edition);
        paint();
      }
    } catch (e) { toast(e.message, true); }
  };

  // Back from adding an unknown disc: look those codes up again.
  for (const it of S.items.filter((x) => ['unknown', 'pending', 'looking'].includes(x.state))) {
    get(`/api/barcode/${it.code}`).then((r) => {
      if (r.items.length === 1) { it.edition = r.items[0]; it.state = me.copies.has(it.edition.id) ? 'added' : 'unknown'; if (it.state === 'unknown') return handle(it.code, false); }
      else if (r.pending) { it.state = 'pending'; it.mine = r.pending.mine; }
      paint();
    }).catch(() => {});
  }

  // Start the camera straight away when permission was already given. (e.g. back from adding a new edition) or straight from the tab bar: start at once if allowed.
  try {
    const perm = await navigator.permissions?.query({ name: 'camera' });
    if (perm?.state === 'granted') begin();
  } catch { /* permissions API unsupported */ }
  void go;
  return end;
}
