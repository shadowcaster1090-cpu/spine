import { me, post, del } from './api.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const num = (n) => Number(n || 0).toLocaleString('en-GB');
export const money = (n) => n == null ? '' : '£' + Number(n).toFixed(2);
export const pad = (n) => n == null ? '' : String(n).padStart(3, '0');
export const directors = (ds, link = true) => (ds || []).map((d) => link ? `<a class="dir" href="/director/${d.id}">${esc(d.name)}</a>` : esc(d.name)).join(' & ');
export const plural = (n, one, many = one + 's') => `${num(n)} ${n === 1 ? one : many}`;

const toDate = (iso) => new Date(iso.includes('T') || iso.includes(' ') ? iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z') : iso + 'T12:00:00');
export const when = (iso) => {
  if (!iso) return '';
  const d = toDate(iso), s = (Date.now() - d) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 86400 * 7) return Math.floor(s / 86400) + 'd';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};
export const dateWords = (ymd) => {
  if (!ymd) return 'date unknown';
  const d = toDate(ymd), today = new Date().toISOString().slice(0, 10);
  if (ymd === today) return 'today';
  if (ymd === new Date(Date.now() - 864e5).toISOString().slice(0, 10)) return 'yesterday';
  return d.toLocaleDateString('en-GB', { weekday: ymd > new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10) ? 'long' : undefined, day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};
export const regionText = (r) => !r ? '?' : r === '0' ? '0' : r.replace(/,/g, '/');
export const FORMAT_NAMES = { dvd: 'DVD', bluray: 'Blu-ray', uhd: '4K UHD' };
export const fmtTag = (e) => e.format && e.format !== 'dvd' ? `<span class="reg fmt ${esc(e.format)}">${esc(FORMAT_NAMES[e.format] || e.format)}</span>` : '';
export const regTag = (e) => (e.region || e.standard ? `<span class="reg r${esc((e.region || '').split(',')[0])}">R${esc(regionText(e.region))} ${esc(e.standard || '')}</span>` : '') + fmtTag(e);
export const condTag = (c) => c ? `<span class="cond ${c.replace('+', 'p')}">${esc(c)}</span>` : '';
export const CONDITIONS = [['', '—'], ['M', 'Mint'], ['NM', 'Near Mint'], ['VG+', 'Very Good Plus'], ['VG', 'Very Good'], ['G', 'Good'], ['F', 'Fair'], ['P', 'Poor']];
export const VIA_NAMES = { dvd: 'my DVD', netflix: 'Netflix', prime: 'Prime Video', disney: 'Disney+', apple: 'Apple TV', mubi: 'MUBI', bfi: 'BFI Player', cinema: 'the cinema', tv: 'TV', other: 'elsewhere' };
export const viaTag = (w) => w.via ? `<span class="via ${esc(w.via)}"><i></i>${w.via === 'dvd' ? (w.edition ? `on ${esc(w.edition.label || 'DVD')}${w.edition.cat_no ? ' ' + esc(w.edition.cat_no) : ''}` : 'on DVD') : 'on ' + esc(VIA_NAMES[w.via] || w.via)}</span>` : '';

/* ---------- icons ---------- */
export const I = {
  star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.8l2.8 6.1 6.7.7-5 4.5 1.4 6.6L12 17.3 6.1 20.7l1.4-6.6-5-4.5 6.7-.7z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.4C.8 7.9 3.2 4 7 4c2 0 3.6 1.1 5 2.8C13.4 5.1 15 4 17 4c3.8 0 6.2 3.9 4.6 7.6C19.5 16.4 12 21 12 21z"/></svg>',
  heartO: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 20.3s-7-4.3-9-8.7C1.6 8.3 3.8 4.8 7.2 4.8c1.8 0 3.3 1 4.8 2.6 1.5-1.6 3-2.6 4.8-2.6 3.4 0 5.6 3.5 4.2 6.8-2 4.4-9 8.7-9 8.7z"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeF: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 5C5.5 5 2 12 2 12s3.5 7 10 7 10-7 10-7-3.5-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  clockF: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm.9 10.6V7h-1.8v6.4l4.2 2.6 1-1.5-3.4-2z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  disc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 10a8 8 0 0 1 14-4l2 2M20 14a8 8 0 0 1-14 4l-2-2"/><path d="M20 4v4h-4M4 20v-4h4"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2"/><path d="M8 8v8M11 8v8M14 8v8M16.5 8v8"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1.2" fill="currentColor"/><circle cx="4" cy="12" r="1.2" fill="currentColor"/><circle cx="4" cy="18" r="1.2" fill="currentColor"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m13.5 6.5 3 3"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.7c2.8.2 5 1.9 5.8 5.3"/></svg>'
};

/* ---------- avatars ---------- */
function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
// Warm darkroom tones for member avatars, picked by a hash of the username.
const AVATAR_TONES = [['#8a3b2a', '#4d1e16'], ['#5f6b3a', '#2f3a1c'], ['#3b5a73', '#1f3243'], ['#7a5a2b', '#4a3414'], ['#6b3a5b', '#3a1f32'], ['#2f6f6a', '#183b38'], ['#8a6a3a', '#4a3a1a'], ['#4a4a4a', '#262626'], ['#9a4a2a', '#5a2a14'], ['#3d4a6b', '#20283a']];
export function avatar(u, cls = '') {
  const name = typeof u === 'string' ? u : (u?.username || '?');
  const [a, b] = AVATAR_TONES[hash(name) % AVATAR_TONES.length];
  const label = (typeof u === 'object' && u?.display_name) || name;
  return `<span class="avatar ${cls}" style="--av-a:${a};--av-b:${b}" title="${esc(label)}" aria-hidden="true">${esc(label.trim()[0] || '?')}</span>`;
}
export const nameOf = (u) => u?.display_name || u?.username || '';

/* ---------- stars ---------- */
// value on the 0–5 scale, halves allowed.
export function stars(value, cls = '') {
  const v = Math.max(0, Math.min(5, Number(value) || 0));
  let out = `<span class="stars ${cls}" aria-label="${v} out of 5">`;
  for (let i = 1; i <= 5; i++) {
    const fill = Math.max(0, Math.min(1, v - (i - 1)));
    out += `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><clipPath id="c${i}${hash(String(v))}"><rect x="0" y="0" width="${24 * fill}" height="24"/></clipPath></defs><path d="M12 2.8l2.8 6.1 6.7.7-5 4.5 1.4 6.6L12 17.3 6.1 20.7l1.4-6.6-5-4.5 6.7-.7z" fill="currentColor" opacity=".22"/><path d="M12 2.8l2.8 6.1 6.7.7-5 4.5 1.4 6.6L12 17.3 6.1 20.7l1.4-6.6-5-4.5 6.7-.7z" fill="currentColor" clip-path="url(#c${i}${hash(String(v))})"/></svg>`;
  }
  return out + '</span>';
}
export const stars10 = (n, cls = '') => n == null ? '' : stars(n / 2, cls);

// Tap-to-rate with half stars: the left half of each star gives a half. Calls onChange(1..10 | null).
export function rateInput(el, value, onChange, { size = '' } = {}) {
  let cur = value || 0;
  el.className = `rate ${size}`;
  el.setAttribute('role', 'slider'); el.setAttribute('aria-label', 'Rating'); el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', '10');
  el.innerHTML = [1, 2, 3, 4, 5].map((i) => `<button type="button" data-i="${i}" aria-label="${i} star${i > 1 ? 's' : ''}">${I.star}<span class="half">${I.star}</span></button>`).join('');
  const paint = () => {
    el.setAttribute('aria-valuenow', cur);
    el.querySelectorAll('button').forEach((b) => { const i = +b.dataset.i; b.classList.toggle('on', cur >= i * 2); b.classList.toggle('half-on', cur === i * 2 - 1); });
  };
  el.onclick = (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    const i = +b.dataset.i, rect = b.getBoundingClientRect(), half = ev.clientX - rect.left < rect.width / 2;
    let next = half ? i * 2 - 1 : i * 2;
    if (next === cur) next = 0; // tap again to clear
    cur = next; paint(); onChange(cur || null);
  };
  el.onkeydown = (ev) => { if (ev.key === 'ArrowRight') { cur = Math.min(10, cur + 1); paint(); onChange(cur || null); } if (ev.key === 'ArrowLeft') { cur = Math.max(0, cur - 1); paint(); onChange(cur || null); } };
  paint();
  return { set(v) { cur = v || 0; paint(); } };
}

/* ---------- generated artwork (used until a real scan exists) ---------- */
function rng(seed) { let a = hash(seed); return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function wrapT(t, max) { const w = t.split(' '); const L = []; let cur = ''; for (const x of w) { if (cur && (cur + ' ' + x).length > max) { L.push(cur); cur = x; } else cur = cur ? cur + ' ' + x : x; } L.push(cur); return L.slice(0, 4); }
function art(e, w, h) {
  const [bg, fg, ac] = e.palette || ['#222', '#eee', '#dd4a2e'];
  const R = rng(e.title + (e.year || '')), tpl = hash(e.title + '|' + (e.year || '')) % 10;
  const cx = w / 2, cy = h * .42;
  let s = '';
  switch (tpl) {
    case 0: s = `<circle cx="${cx}" cy="${cy}" r="${w * .33}" fill="${ac}"/><rect x="0" y="${h * .55}" width="${w}" height="${h * .2}" fill="${bg}"/><rect x="${w * .09}" y="${h * .55}" width="${w * .82}" height="1.5" fill="${fg}"/>`; break;
    case 1: for (let i = 0; i < 7; i++) { const ww = w * (.25 + R() * .65), x = R() < .5 ? 0 : w - ww; s += `<rect x="${x.toFixed(1)}" y="${h * .12 + i * h * .075}" width="${ww.toFixed(1)}" height="${h * .035}" fill="${i % 3 === 1 ? ac : fg}" opacity="${i % 3 === 1 ? 1 : .85}"/>`; } break;
    case 2: s = `<rect x="0" y="${h * .06}" width="${w * .46}" height="${h * .7}" fill="${ac}"/><rect x="${w * .59}" y="${h * .18}" width="${w * .23}" height="${w * .23}" fill="${fg}"/><circle cx="${w * .7}" cy="${h * .57}" r="${w * .03}" fill="${ac}"/>`; break;
    case 3: for (let k = 5; k >= 0; k--) s += `<circle cx="${cx}" cy="${cy}" r="${w * .09 + k * w * .07}" fill="none" stroke="${k % 2 ? fg : ac}" stroke-width="${k % 2 ? 1.5 : 4}" opacity="${1 - k * .08}"/>`; s += `<circle cx="${cx}" cy="${cy}" r="${w * .03}" fill="${fg}"/>`; break;
    case 4: for (let r = 0; r < 7; r++) for (let c = 0; c < 8; c++) s += `<circle cx="${w * .15 + c * w * .1}" cy="${h * .13 + r * h * .078}" r="${(1.5 + R() * w * .03).toFixed(1)}" fill="${R() < .14 ? ac : fg}" opacity=".9"/>`; break;
    case 5: s = `<rect x="${w * .22}" y="${h * .09}" width="${w * .56}" height="${h * .63}" fill="#0b0a09"/>`; for (let y = h * .11; y < h * .7; y += h * .046) s += `<rect x="${w * .245}" y="${y}" width="${w * .03}" height="${h * .025}" rx="1" fill="${bg}"/><rect x="${w * .725}" y="${y}" width="${w * .03}" height="${h * .025}" rx="1" fill="${bg}"/>`; s += `<rect x="${w * .31}" y="${h * .14}" width="${w * .38}" height="${h * .25}" fill="${ac}"/><rect x="${w * .31}" y="${h * .42}" width="${w * .38}" height="${h * .25}" fill="${fg}" opacity=".9"/>`; break;
    case 6: s = `<polygon points="0,${h * .69} ${w},${h * .17} ${w},${h * .32} 0,${h * .85}" fill="${ac}"/><polygon points="0,${h * .42} ${w * .6},${h * .06} ${w * .8},${h * .06} 0,${h * .53}" fill="${fg}" opacity=".9"/>`; break;
    case 7: s = `<rect x="${w * .1}" y="${h * .08}" width="${w * .8}" height="${h * .6}" fill="none" stroke="${fg}" stroke-width="2"/><rect x="${w * .18}" y="${h * .14}" width="${w * .64}" height="${h * .48}" fill="${ac}"/><circle cx="${w * .5}" cy="${h * .38}" r="${w * .12}" fill="${bg}"/>`; break;
    case 8: for (let i = 0; i < 9; i++) s += `<line x1="${w * .08 + i * w * .105}" y1="${h * .06}" x2="${w * .08 + i * w * .105}" y2="${h * .72}" stroke="${i === 4 ? ac : fg}" stroke-width="${i === 4 ? 10 : 2 + (i % 3)}" opacity="${i === 4 ? 1 : .8}"/>`; break;
    default: s = `<path d="M0 ${h * .62} C ${w * .3} ${h * .3}, ${w * .6} ${h * .85}, ${w} ${h * .4} L ${w} ${h * .75} L 0 ${h * .75} Z" fill="${ac}"/><circle cx="${w * .72}" cy="${h * .2}" r="${w * .09}" fill="${fg}"/>`;
  }
  const lines = wrapT(e.title, 11), ml = Math.max(...lines.map((l) => l.length)), fs = Math.min(w * .19, (w * .86) / (ml * .5), lines.length > 2 ? w * .14 : w * .19);
  const tt = lines.map((l, i) => `<text x="${w * .07}" y="${(h * .9 - (lines.length - 1 - i) * fs * 1).toFixed(1)}" font-family="Instrument Serif, Georgia, serif" font-style="italic" font-weight="400" font-size="${fs.toFixed(1)}" fill="${fg}">${esc(l)}</text>`).join('');
  const dir = (e.directors || []).map((d) => d.name).join(' & ');
  return { bg, fg, body: s, text: tt, dir };
}
export function coverSvg(e) {
  const a = art(e, 200, 284);
  return `<svg viewBox="0 0 200 284" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="200" height="284" fill="${a.bg}"/>${a.body}<rect width="200" height="18" fill="#000" opacity=".25"/><text x="9" y="12" font-family="IBM Plex Mono, Menlo, monospace" font-size="6.6" letter-spacing=".8" fill="${a.fg}">${esc((e.label || '').toUpperCase().slice(0, 28))}</text>${e.spine_no != null ? `<text x="191" y="12" text-anchor="end" font-family="IBM Plex Mono, Menlo, monospace" font-size="6.6" fill="${a.fg}">No. ${pad(e.spine_no)}</text>` : ''}${a.text}<text x="14" y="276" font-family="IBM Plex Mono, Menlo, monospace" font-size="6.2" letter-spacing="1" fill="${a.fg}" opacity=".75">${esc(a.dir.toUpperCase().slice(0, 34))}${e.year ? ' · ' + e.year : ''}</text></svg>`;
}
export function posterSvg(f) {
  const a = art(f, 200, 300);
  return `<svg viewBox="0 0 200 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="200" height="300" fill="${a.bg}"/>${a.body}${a.text}<text x="14" y="292" font-family="IBM Plex Mono, Menlo, monospace" font-size="6.4" letter-spacing="1" fill="${a.fg}" opacity=".75">${esc(a.dir.toUpperCase().slice(0, 34))}${f.year ? ' · ' + f.year : ''}</text></svg>`;
}
export function cover(e, cls = '') {
  if (e.cover) return `<div class="cv ${cls}"><img src="/uploads/${esc(e.cover)}" alt="${esc(e.title)} cover" loading="lazy"></div>`;
  return `<div class="cv gen ${cls}" role="img" aria-label="${esc(e.title)}">${coverSvg(e)}</div>`;
}
export function poster(f, cls = '') {
  if (!f) return `<div class="poster ${cls}"></div>`;
  if (f.cover) return `<div class="poster ${cls}"><img src="/uploads/${esc(f.cover)}" alt="${esc(f.title)}" loading="lazy"></div>`;
  return `<div class="poster gen ${cls}" role="img" aria-label="${esc(f.title)}">${posterSvg(f)}</div>`;
}

/* ---------- cards ---------- */
export function card(e) {
  const badge = me.copies.has(e.id) ? '<span class="owned">On shelf</span>' : me.wants.has(e.id) ? '<span class="owned w">Wanted</span>' : '';
  return `<a class="card" href="/release/${e.id}">${badge}${cover(e)}<div>
    <div class="t">${esc(e.title)}</div>
    <div class="s">${esc(e.label || 'Unknown label')}${e.cat_no ? ' · ' + esc(e.cat_no) : ''}</div>
    <div class="row">${regTag(e)}${e.oop ? '<span class="oop">OOP</span>' : ''}${e.year ? `<span class="dim2" style="font-size:12px">${e.year}</span>` : ''}</div>
  </div></a>`;
}
export function filmCard(f, opts = {}) {
  const seen = me.watched.has(f.id);
  const badge = opts.badge !== false ? (seen ? `<span class="owned seen">Seen</span>` : me.watchlist.has(f.id) ? '<span class="owned w">Watchlist</span>' : '') : '';
  const meta = 'rating' in opts ? (opts.rating != null ? stars10(opts.rating, 'sm') : '') : f.rating ? `${stars(f.rating, 'sm')}<span class="ratenum">${f.rating}</span>` : '';
  return `<a class="fcard" href="/film/${f.id}">${badge}${poster(f)}<div>
    <div class="t">${esc(f.title)}</div>
    <div class="s">${f.year || ''}${f.directors?.length ? ' · ' + esc(f.directors[0].name) : ''}</div>
    ${meta || opts.sub ? `<div class="meta">${meta}${opts.sub ? `<span>${opts.sub}</span>` : ''}</div>` : ''}
  </div></a>`;
}
export function spineEl(e) {
  const [bg, fg, ac] = e.palette;
  const w = e.discs > 2 ? 52 : e.discs > 1 ? 42 : 32;
  return `<a class="sp" href="/release/${e.id}" title="${esc(e.title)} · ${esc(e.label || '')}" style="width:${w}px;background:${bg};color:${fg};border-top:3px solid ${ac}"><span class="lb">${esc((e.label || '').split(' ').map((w) => w[0]).join('').slice(0, 4).toUpperCase())}</span><span class="tt">${esc(e.title)}</span><span class="no">${e.spine_no ?? ''}</span></a>`;
}

/* a diary entry / review, as a card */
export function reviewCard(w, { showFilm = true, showUser = true, onChange } = {}) {
  const u = w.user, mine = me.user && u.username === me.user.username;
  const who = showUser ? `${avatar(u, 'xs')}<a href="/u/${esc(u.username)}"><b>${esc(nameOf(u))}</b></a>` : '';
  return `<article class="review-card${showFilm ? '' : ' noposter'}" data-watch="${w.id}">
    ${showFilm ? `<a href="/film/${w.film?.id}">${poster(w.film)}</a>` : `<a href="/u/${esc(u.username)}">${avatar(u, 'md')}</a>`}
    <div>
      <div class="meta">${who}${w.rating ? stars10(w.rating, 'sm') : ''}${w.liked ? `<span class="heart on" style="display:inline-flex;width:14px">${I.heart}</span>` : ''}${w.rewatch ? `<span class="dim2" title="Rewatch" style="display:inline-flex;width:14px">${I.repeat}</span>` : ''}<span class="dim2">${dateWords(w.watched_on)}</span>${viaTag(w)}</div>
      ${showFilm ? `<a class="t" href="/film/${w.film?.id}">${esc(w.film?.title || '')} <span class="dim" style="font-weight:400;font-size:14px">${w.film?.year || ''}</span></a>` : ''}
      ${w.review ? `<div class="txt${w.spoilers ? ' spoiler' : ''}" ${w.spoilers ? 'title="Contains spoilers. Tap to reveal." tabindex="0"' : ''}>${esc(w.review)}</div>` : ''}
      <div class="acts">
        <button data-like="${w.id}" class="${w.liked_by_me ? 'heart on' : ''}" aria-pressed="${w.liked_by_me}">${w.liked_by_me ? I.heart : I.heartO}<span>${w.likes ? num(w.likes) : 'Like'}</span></button>
        <a href="/review/${w.id}">Permalink</a>
        ${mine ? `<button data-edit-watch="${w.id}">Edit</button>` : ''}
      </div>
    </div></article>`;
}
// Wires like / spoiler / edit on review cards inside root. editHandler(watchId) opens the log sheet.
export function wireReviews(root, editHandler) {
  root.addEventListener('click', async (ev) => {
    const sp = ev.target.closest('.spoiler'); if (sp) { sp.classList.add('open'); return; }
    const lk = ev.target.closest('[data-like]');
    if (lk) {
      if (!me.user) { location.assign('/login?next=' + encodeURIComponent(location.pathname)); return; }
      const on = lk.classList.contains('on');
      try {
        if (on) await del(`/api/watches/${lk.dataset.like}/like`); else await post(`/api/watches/${lk.dataset.like}/like`);
        const n = lk.querySelector('span'), count = (parseInt(n.textContent) || 0) + (on ? -1 : 1);
        lk.classList.toggle('on', !on); lk.classList.toggle('heart', !on); lk.setAttribute('aria-pressed', String(!on)); lk.innerHTML = `${!on ? I.heart : I.heartO}<span>${count ? count : 'Like'}</span>`;
      } catch (e) { toast(e.message, true); }
      return;
    }
    const ed = ev.target.closest('[data-edit-watch]'); if (ed && editHandler) editHandler(+ed.dataset.editWatch);
  });
}

/* ---------- toast, modals, forms ---------- */
let tt;
export function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('bad', bad); t.classList.add('show');
  clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), bad ? 4200 : 2200);
}

export function modal(inner, { wide = false, onMount, onClose, cls = '' } = {}) {
  const root = $('#modal-root');
  const prev = document.activeElement;
  root.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="dlg ${wide ? 'wide' : ''} ${cls}"><div class="grab"></div><button class="x" aria-label="Close">×</button>${inner}</div></div>`;
  const el = root.firstElementChild;
  document.body.style.overflow = 'hidden';
  const close = () => { root.innerHTML = ''; document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); prev?.focus?.(); onClose?.(); };
  const onKey = (ev) => { if (ev.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  el.addEventListener('click', (ev) => { if (ev.target === el || ev.target.closest('.x')) close(); });
  const first = el.querySelector('input:not([type=hidden]), select, textarea, button:not(.x)');
  if (first && !matchMedia('(max-width: 720px)').matches) first.focus();
  onMount?.(el.querySelector('.dlg'), close);
  return close;
}

export function confirmDialog(text, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    modal(`<p style="font-size:17px;font-weight:600;margin:8px 0 20px;padding-right:32px">${esc(text)}</p><div class="btns"><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button><button class="btn ghost" data-no>Cancel</button></div>`, {
      onMount: (d, c) => { d.querySelector('[data-ok]').onclick = () => { resolve(true); c(); }; d.querySelector('[data-no]').onclick = () => c(); },
      onClose: () => resolve(false)
    });
  });
}

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
export const toggle = (name, label, checked, hint = '') => `<label class="inset-toggle row"><span class="grow"><span class="t">${esc(label)}</span>${hint ? `<span class="s">${esc(hint)}</span>` : ''}</span><span class="switch"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span></span></span></label>`;

export function setTitle(t) { document.title = t ? `${t} · Spine` : 'Spine'; }

export async function shrinkImage(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return { data: c.toDataURL('image/jpeg', 0.88), w: c.width, h: c.height };
}
