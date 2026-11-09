// Barcode → product: the phone asks first, the server second. Shared by the scan screen and the
// Settings diagnostics row, and tested under Node: every outside call can be swapped in `deps`.
//
// UPCitemdb's free endpoint allows 100 lookups a day per internet address and refuses cross-origin
// browser calls. So the iPhone shell asks from the phone's own address (its own allowance), a plain
// browser's attempt nearly always fails, and the server's shared address is usually out of lookups.
// Whoever gets the product, the server reads it (title, label, format, region) and finds the film.
import { get as apiGet, post as apiPost } from './api.js';
import { canNativeFetch as bridgeCan, nativeFetch as bridgeFetch } from './bridge.js';

export const UPC_TRIAL = 'https://api.upcitemdb.com/prod/trial/lookup?upc=';
export const PHONE_TIMEOUT = 9000;
const now = () => (globalThis.performance?.now ? performance.now() : Date.now());

// A UPCitemdb item in the shape POST /api/barcode/:code/identify reads.
export const productFromItem = (item) => ({ source: 'upcitemdb', title: item.title, brand: item.brand, description: item.description, category: item.category, images: item.images, titles: (item.offers || []).map((o) => o.title) });

// Plain words for a phone answer that was not a product. Each one names the phone: a shell timeout or
// a dropped request is never dressed up as the server's rate limit.
export function phoneTrouble(r, timeout = PHONE_TIMEOUT) {
  if (r.status === 429) return 'UPCitemdb has had its 100 free lookups from this phone today.';
  if (r.status === 0) {
    if (r.error === 'timeout') return `This phone asked UPCitemdb but had no answer within ${Math.round(timeout / 1000)} seconds.`;
    if (r.error === 'refused') return 'This build of the Spine app does not allow lookups to UPCitemdb; rebuild it from Xcode.';
    if (r.error === 'bridge') return 'The Spine app did not take the request; rebuild it from Xcode.';
    return `This phone could not reach UPCitemdb${r.error ? ` (${r.error})` : ''}.`;
  }
  return `UPCitemdb answered this phone with HTTP ${r.status}.`;
}

// Plain words for the server's own failure.
const serverTrouble = (err) => (/rate limit|429/i.test(err) ? "UPCitemdb has used up the server's shared daily allowance." : `the server could not look it up (${err}).`);

const firstItem = (text) => { const data = JSON.parse(text || '{}'); return (data.items || [])[0] || null; };

// Resolves to the server's reading ({product, parsed, film, hint, …} plus `via`: 'phone' | 'browser' | 'server'),
// or to {product: null, trouble, side} when nobody could answer, `side` naming who failed ('phone', 'server'
// or 'both'). `diag` records what each side did, for the Settings diagnostics row.
export async function identify(code, deps = {}) {
  const { get = apiGet, post = apiPost, canNative = bridgeCan, native = bridgeFetch, fetchImpl = globalThis.fetch?.bind(globalThis), timeout = PHONE_TIMEOUT } = deps;
  const t0 = now();
  const diag = { code, phone: null, browser: null, server: null };
  const done = (r) => ({ ...r, diag: { ...diag, via: r.via || '', ms: Math.round(now() - t0) } });
  const url = UPC_TRIAL + encodeURIComponent(code);
  let asked = '', item = null, saidUnknown = false, trouble = '';

  if (canNative()) {
    asked = 'phone';
    const r = await native(url, { timeout });
    diag.phone = { status: r.status, ms: r.ms ?? null, error: r.error || '' };
    if (r.status === 404) saidUnknown = true;   // a valid code UPCitemdb has never heard of
    else if (r.status === 200) {
      try { item = firstItem(r.body); saidUnknown = !item; } catch { trouble = 'UPCitemdb answered this phone with something it could not read.'; }
    } else trouble = phoneTrouble(r, timeout);
  } else if (fetchImpl) {
    asked = 'browser';
    const t = now();
    try {
      const r = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
      const text = await r.text();
      diag.browser = { status: r.status, ms: Math.round(now() - t), error: '' };
      if (r.status === 404) saidUnknown = true;
      else if (r.status === 200) { try { item = firstItem(text); saidUnknown = !item; } catch { /* the server tries */ } }
      else if (r.status === 429) trouble = 'UPCitemdb has had its 100 free lookups from this address today.';
    } catch (e) { diag.browser = { status: 0, ms: Math.round(now() - t), error: e?.name === 'TimeoutError' ? 'timeout' : 'blocked' }; }
  }

  if (item) {
    // Somebody has the product: the server reads it and finds the film.
    const t = now();
    try {
      const s = await post(`/api/barcode/${code}/identify`, { product: productFromItem(item) });
      diag.server = { step: 'identify', status: 200, ms: Math.round(now() - t) };
      return done({ ...s, via: asked });
    } catch (e) {
      diag.server = { step: 'identify', status: e.status ?? 0, ms: Math.round(now() - t), error: e.message };
      return done({ product: null, trouble: `${asked === 'phone' ? 'This phone' : 'This browser'} found the disc on UPCitemdb, but Spine's server could not read it (${e.message}).`, side: 'server' });
    }
  }

  // Nothing from the phone: the server tries its own sources (and its memory of earlier lookups).
  const t = now();
  let s;
  try { s = await get(`/api/barcode/${code}/lookup`); }
  catch (e) {
    diag.server = { step: 'lookup', status: e.status ?? 0, ms: Math.round(now() - t), error: e.message };
    if (saidUnknown) return done({ product: null, via: asked });
    return done({ product: null, trouble: [trouble, `Spine's server could not be asked (${e.message}).`].filter(Boolean).join(' '), side: trouble ? 'both' : 'server' });
  }
  diag.server = { step: 'lookup', status: 200, ms: Math.round(now() - t), cached: !!s.cached, errors: s.errors || [] };
  if (s.product) return done({ ...s, via: 'server' });
  if (saidUnknown) return done({ ...s, via: asked });              // UPCitemdb itself said no: a genuine unknown, with the barcode's hints
  if (!s.errors?.length) return done({ ...s, via: 'server' });     // the server's sources answered and found nothing: also genuine
  // Nobody could answer. Say which side failed; the server's exhausted allowance is never pinned on the phone.
  const why = serverTrouble(s.errors[0]);
  if (asked === 'phone') return done({ product: null, trouble: `${trouble} ${why.replace(/^UPCitemdb has used up/, 'UPCitemdb has also used up').replace(/^the server/, 'The server')}`, side: 'both' });
  return done({ product: null, trouble: `${trouble ? trouble + ' And' : 'Browsers cannot ask UPCitemdb themselves, and'} ${why} Add the disc by hand, or scan it in the Spine app.`, side: 'server' });
}
