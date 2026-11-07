import { me } from './api.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const num = (n) => Number(n || 0).toLocaleString('en-GB');
export const money = (n) => n == null ? '' : '£' + Number(n).toFixed(2);
export const pad = (n) => n == null ? '' : String(n).padStart(3, '0');
export const directors = (ds, link = true) => (ds || []).map((d) => link ? `<a class="dir" href="/director/${d.id}">${esc(d.name)}</a>` : esc(d.name)).join(' & ');
export const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'));
  const s = (Date.now() - d) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' d ago';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
export const regionText = (r) => !r ? '?' : r === '0' ? '0' : r.replace(/,/g, '/');
export const regTag = (e) => e.region || e.standard ? `<span class="reg r${esc((e.region || '').split(',')[0])}">R${esc(regionText(e.region))} ${esc(e.standard || '')}</span>` : '';
export const stars = (r) => { const n = Math.round(r || 0); return '★'.repeat(n) + '<span style="opacity:.25">' + '★'.repeat(5 - n) + '</span>'; };
export const condTag = (c) => c ? `<span class="cond ${c.replace('+', 'p')}">${esc(c)}</span>` : '';
export const CONDITIONS = [['', '—'], ['M', 'Mint'], ['NM', 'Near Mint'], ['VG+', 'Very Good Plus'], ['VG', 'Very Good'], ['G', 'Good'], ['F', 'Fair'], ['P', 'Poor']];

/* ---------- generated cover art, used when no scan has been uploaded ---------- */
function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function rng(seed) { let a = hash(seed); return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function wrapT(t, max) { const w = t.split(' '); const L = []; let cur = ''; for (const x of w) { if (cur && (cur + ' ' + x).length > max) { L.push(cur); cur = x; } else cur = cur ? cur + ' ' + x : x; } L.push(cur); return L.slice(0, 4); }

export function coverSvg(e) {
  const [bg, fg, ac] = e.palette || ['#222', '#eee', '#e5482f'];
  const R = rng(e.title + (e.year || '')), tpl = hash(e.title) % 7;
  let s = '';
  switch (tpl) {
    case 0: s = `<circle cx="100" cy="116" r="66" fill="${ac}"/><rect x="0" y="150" width="200" height="70" fill="${bg}"/><rect x="18" y="150" width="164" height="1.5" fill="${fg}"/>`; break;
    case 1: for (let i = 0; i < 7; i++) { const w = 50 + R() * 130, x = R() < .5 ? 0 : 200 - w; s += `<rect x="${x.toFixed(1)}" y="${34 + i * 21}" width="${w.toFixed(1)}" height="10" fill="${i % 3 === 1 ? ac : fg}" opacity="${i % 3 === 1 ? 1 : .85}"/>`; } break;
    case 2: s = `<rect x="0" y="18" width="92" height="196" fill="${ac}"/><rect x="118" y="52" width="46" height="46" fill="${fg}"/><circle cx="141" cy="162" r="6" fill="${ac}"/>`; break;
    case 3: for (let k = 5; k >= 0; k--) s += `<circle cx="100" cy="114" r="${18 + k * 14}" fill="none" stroke="${k % 2 ? fg : ac}" stroke-width="${k % 2 ? 1.5 : 4}" opacity="${1 - k * .08}"/>`; s += `<circle cx="100" cy="114" r="6" fill="${fg}"/>`; break;
    case 4: for (let r = 0; r < 7; r++) for (let c = 0; c < 8; c++) s += `<circle cx="${30 + c * 20}" cy="${38 + r * 22}" r="${(1.5 + R() * 6).toFixed(1)}" fill="${R() < .14 ? ac : fg}" opacity=".9"/>`; break;
    case 5: s = `<rect x="44" y="26" width="112" height="178" fill="#0b0a09"/>`; for (let y = 31; y < 200; y += 13) s += `<rect x="49" y="${y}" width="6" height="7" rx="1" fill="${bg}"/><rect x="145" y="${y}" width="6" height="7" rx="1" fill="${bg}"/>`; s += `<rect x="62" y="40" width="76" height="70" fill="${ac}"/><rect x="62" y="120" width="76" height="70" fill="${fg}" opacity=".9"/><circle cx="100" cy="155" r="14" fill="${ac}"/>`; break;
    default: s = `<polygon points="0,196 200,48 200,92 0,240" fill="${ac}"/><polygon points="0,120 120,18 160,18 0,150" fill="${fg}" opacity=".9"/>`;
  }
  const lines = wrapT(e.title, 11), ml = Math.max(...lines.map((l) => l.length)), fs = Math.min(36, 176 / (ml * .44), lines.length > 2 ? 26 : 36);
  const tt = lines.map((l, i) => `<text x="14" y="${(258 - (lines.length - 1 - i) * fs * .92).toFixed(1)}" font-family="Instrument Serif,Georgia,serif" font-style="italic" font-size="${fs.toFixed(1)}" fill="${fg}">${esc(l)}</text>`).join('');
  const dir = (e.directors || []).map((d) => d.name).join(' & ');
  return `<svg viewBox="0 0 200 284" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="200" height="284" fill="${bg}"/>${s}<rect width="200" height="18" fill="#000" opacity=".28"/><text x="9" y="12" font-family="IBM Plex Mono,monospace" font-size="6.6" letter-spacing=".8" fill="${fg}">${esc((e.label || '').toUpperCase().slice(0, 28))}</text>${e.spine_no != null ? `<text x="191" y="12" text-anchor="end" font-family="IBM Plex Mono,monospace" font-size="6.6" fill="${fg}">No. ${pad(e.spine_no)}</text>` : ''}${tt}<text x="14" y="274" font-family="IBM Plex Mono,monospace" font-size="6.4" letter-spacing="1" fill="${fg}" opacity=".75">${esc(dir.toUpperCase().slice(0, 34))}${e.year ? ' · ' + e.year : ''}</text></svg>`;
}

export function cover(e, cls = '') {
  if (e.cover) return `<div class="cv ${cls}"><img src="/uploads/${esc(e.cover)}" alt="${esc(e.title)} cover" loading="lazy"></div>`;
  return `<div class="cv gen ${cls}" role="img" aria-label="${esc(e.title)}">${coverSvg(e)}</div>`;
}

export function card(e) {
  const badge = me.copies.has(e.id) ? '<span class="owned">In shelf</span>' : me.wants.has(e.id) ? '<span class="owned w">Wanted</span>' : '';
  return `<a class="card" href="/release/${e.id}">${badge}${cover(e)}<div>
    <div class="t">${esc(e.title)}</div>
    <div class="s">${directors(e.directors, false)}${e.year ? ' · ' + e.year : ''}</div>
    <div class="row">${regTag(e)}<span class="mono dim">${esc(e.label || '')}${e.cat_no ? ' · ' + esc(e.cat_no) : ''}</span>${e.oop ? '<span class="oop">OOP</span>' : ''}</div>
  </div></a>`;
}

export function spineEl(e) {
  const [bg, fg, ac] = e.palette;
  const w = e.discs > 2 ? 52 : e.discs > 1 ? 42 : 32;
  return `<a class="sp" href="/release/${e.id}" title="${esc(e.title)} · ${esc(e.label || '')}" style="width:${w}px;background:${bg};color:${fg};border-top:3px solid ${ac}"><span class="lb">${esc((e.label || '').split(' ').map((w) => w[0]).join('').slice(0, 4).toUpperCase())}</span><span class="tt">${esc(e.title)}</span><span class="no">${e.spine_no ?? ''}</span></a>`;
}

/* ---------- toast & modal ---------- */
let tt;
export function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('bad', bad); t.classList.add('show');
  clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), bad ? 4200 : 2200);
}

export function modal(inner, { wide = false, onMount, onClose } = {}) {
  const root = $('#modal-root');
  const prev = document.activeElement;
  root.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="dlg${wide ? ' wide' : ''}"><button class="x" aria-label="Close">×</button>${inner}</div></div>`;
  const el = root.firstElementChild;
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); prev?.focus?.(); onClose?.(); };
  const onKey = (ev) => { if (ev.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  el.addEventListener('click', (ev) => { if (ev.target === el || ev.target.closest('.x')) close(); });
  (el.querySelector('input, select, textarea, button:not(.x)') || el.querySelector('.x')).focus();
  onMount?.(el.querySelector('.dlg'), close);
  return close;
}

export function confirmDialog(text, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    modal(`<p style="font-size:16px;margin:8px 0 20px">${esc(text)}</p><div class="btns"><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button><button class="btn ghost" data-no>Cancel</button></div>`, {
      onMount: (d, c) => {
        d.querySelector('[data-ok]').onclick = () => { resolve(true); c(); };
        d.querySelector('[data-no]').onclick = () => c();
      },
      onClose: () => resolve(false)
    });
  });
}

// Wires a <form> to an async submit handler with a shared error line and busy state.
export function bindForm(form, handler) {
  const err = form.querySelector('.err');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('[type=submit]');
    if (err) err.textContent = '';
    btn && (btn.disabled = true);
    try { await handler(Object.fromEntries(new FormData(form)), form); }
    catch (e) { if (err) err.textContent = e.message; else toast(e.message, true); }
    finally { btn && (btn.disabled = false); }
  });
}

export const field = (name, label, { type = 'text', value = '', hint = '', attrs = '', cls = '' } = {}) =>
  `<div class="field ${cls}"><label for="f-${name}">${esc(label)}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value ?? '')}" ${attrs}>${hint ? `<small>${esc(hint)}</small>` : ''}</div>`;
export const area = (name, label, { value = '', hint = '', attrs = '', cls = '' } = {}) =>
  `<div class="field ${cls}"><label for="f-${name}">${esc(label)}</label><textarea id="f-${name}" name="${name}" ${attrs}>${esc(value ?? '')}</textarea>${hint ? `<small>${esc(hint)}</small>` : ''}</div>`;
export const select = (name, label, opts, value, { hint = '', cls = '' } = {}) =>
  `<div class="field ${cls}"><label for="f-${name}">${esc(label)}</label><select id="f-${name}" name="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>${hint ? `<small>${esc(hint)}</small>` : ''}</div>`;

export function setTitle(t) { document.title = t ? `${t} · Spine` : 'Spine · The DVD register'; }

/* Shrinks an image file in the browser before upload. */
export async function shrinkImage(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return { data: c.toDataURL('image/jpeg', 0.88), w: c.width, h: c.height };
}
