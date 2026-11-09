// identify(): who asks UPCitemdb (phone, browser, server), and what the member is told when nobody can.
// The client module runs here with its outside calls swapped for stubs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identify, productFromItem, phoneTrouble } from '../public/js/identify.js';

const DUNKIRK = { ean: '5051892210034', title: 'Dunkirk 4k Ultra Hd + Blu-ray + Digital (2017)', brand: 'Warner', description: '', category: 'Media > Movies', images: ['https://img.example/dunkirk-1.jpg', 'https://img.example/dunkirk-2.jpg'], offers: [{ title: 'Dunkirk (4K Ultra HD + Blu-ray + Digital) [2017]' }] };
const HINT = { label: 'Warner Bros.', region: '2', standard: 'PAL' };
const RATE_LIMITED = { product: null, parsed: null, film: null, errors: ['upcitemdb: rate limited'], cached: false, hint: HINT };
const READ = { product: { source: 'upcitemdb', title: DUNKIRK.title, brand: 'Warner', images: DUNKIRK.images }, parsed: { title: 'Dunkirk', year: 2017, format: 'uhd', label: 'Warner Bros.', region: '2', standard: 'PAL' }, film: { tmdb_id: 374720, title: 'Dunkirk', year: 2017 }, hint: HINT };

const NOT_KNOWN = { product: null, parsed: null, film: null, errors: [], cached: false, known: false, hint: HINT };

// A fake server: GET lookup?cached=1 answers `own` (Spine's own records), any other GET lookup answers `lookup`,
// POST identify answers `read`; each may be an Error to throw. Every call is recorded.
function server({ own = NOT_KNOWN, lookup = RATE_LIMITED, read = READ } = {}) {
  const calls = [];
  const answer = (x) => { if (x instanceof Error) throw x; return x; };
  return { calls, get: async (u) => { calls.push(['GET', u]); return answer(u.endsWith('?cached=1') ? own : lookup); }, post: async (u, b) => { calls.push(['POST', u, b]); return answer(read); } };
}
const silentPhone = { canNative: () => true, native: async () => { throw new Error('the phone must not be asked'); }, fetchImpl: null };
const apiError = (status, message) => Object.assign(new Error(message), { status });
const phone = (reply) => ({ canNative: () => true, native: async () => reply, fetchImpl: null });
const browser = (fetchImpl) => ({ canNative: () => false, fetchImpl });
const ok = (body) => ({ status: 200, body: JSON.stringify(body), error: '', ms: 310 });

test('the phone finds the product: the server reads it, and the answer says it came from the phone', async () => {
  const s = server();
  const r = await identify('5051892210034', { ...phone(ok({ code: 'OK', total: 1, items: [DUNKIRK] })), ...s });
  assert.equal(r.via, 'phone'); assert.equal(r.parsed.title, 'Dunkirk'); assert.equal(r.film.tmdb_id, 374720); assert.equal(r.trouble, undefined);
  assert.deepEqual(s.calls.map((c) => c[0] + ' ' + c[1]), ['GET /api/barcode/5051892210034/lookup?cached=1', 'POST /api/barcode/5051892210034/identify']);
  assert.deepEqual(s.calls[1][2].product, productFromItem(DUNKIRK));
  assert.equal(s.calls[1][2].product.titles[0], DUNKIRK.offers[0].title);
  assert.equal(r.diag.via, 'phone'); assert.equal(r.diag.own.known, false); assert.equal(r.diag.phone.status, 200); assert.equal(r.diag.phone.ms, 310); assert.equal(r.diag.server.step, 'identify'); assert.ok(r.diag.ms >= 0);
});

test("Spine's own records answer first: a product found before costs no outside lookup", async () => {
  const s = server({ own: { ...READ, errors: [], cached: true, known: true } });
  const r = await identify('5051892210034', { ...silentPhone, ...s });
  assert.equal(r.via, 'spine'); assert.equal(r.parsed.title, 'Dunkirk'); assert.equal(r.film.tmdb_id, 374720); assert.equal(r.trouble, undefined);
  assert.deepEqual(s.calls.map((c) => c[0] + ' ' + c[1]), ['GET /api/barcode/5051892210034/lookup?cached=1']);
  assert.equal(r.diag.own.known, true); assert.equal(r.diag.phone, null);
});

test("a disc no source has is answered from Spine's records, with the barcode's hints, without asking the phone again", async () => {
  const s = server({ own: { ...NOT_KNOWN, cached: true, known: true } });
  const r = await identify('5051892251990', { ...silentPhone, ...s });
  assert.equal(r.via, 'spine'); assert.equal(r.product, null); assert.equal(r.trouble, undefined); assert.deepEqual(r.hint, HINT);
  assert.equal(s.calls.length, 1);
});

test("when Spine's records can't be asked the lookup carries on outside, and the diagnostics skip them on purpose", async () => {
  let s = server({ own: apiError(0, 'Could not reach Spine. Check your connection and try again.') });
  let r = await identify('5051892210034', { ...phone(ok({ items: [DUNKIRK] })), ...s });
  assert.equal(r.via, 'phone'); assert.equal(r.diag.own.status, 0);
  s = server({ own: { ...READ, errors: [], cached: true, known: true } });
  r = await identify('5051892210034', { ...phone(ok({ items: [DUNKIRK] })), ...s, ownFirst: false });
  assert.equal(r.via, 'phone'); assert.equal(r.diag.own, null);
  assert.deepEqual(s.calls.map((c) => c[1]), ['/api/barcode/5051892210034/identify']);
});

test('UPCitemdb answering 200 with no items is a known unknown with the barcode hints, not a failure, even while the server is rate limited', async () => {
  const s = server();
  const r = await identify('5051892251990', { ...phone(ok({ code: 'OK', total: 0, offset: 0, items: [] })), ...s });
  assert.equal(r.product, null); assert.equal(r.trouble, undefined); assert.equal(r.via, 'phone'); assert.deepEqual(r.hint, HINT);
  // The server is told UPCitemdb already said no, so it asks only its other sources (and can remember the miss).
  assert.deepEqual(s.calls.map((c) => c[0] + ' ' + c[1]), ['GET /api/barcode/5051892251990/lookup?cached=1', 'GET /api/barcode/5051892251990/lookup?upcitemdb=none']);
  assert.deepEqual(r.diag.server.errors, ['upcitemdb: rate limited']);   // recorded for the diagnostics row, not shown as the verdict
});

test('a 404 from UPCitemdb is a known unknown too, and so is a server that cannot be reached afterwards', async () => {
  let r = await identify('5051892251990', { ...phone({ status: 404, body: '{"code":"INVALID_UPC","message":"not found"}', error: '', ms: 200 }), ...server() });
  assert.equal(r.product, null); assert.equal(r.trouble, undefined); assert.equal(r.via, 'phone'); assert.equal(r.hint.label, 'Warner Bros.');
  r = await identify('5051892251990', { ...phone(ok({ items: [] })), ...server({ lookup: apiError(0, 'Could not reach Spine. Check your connection and try again.') }) });
  assert.equal(r.product, null); assert.equal(r.trouble, undefined); assert.equal(r.via, 'phone'); assert.equal(r.diag.server.status, 0);
});

test('a bridge timeout is told as the phone side failing, never as rate limiting', async () => {
  const r = await identify('5051892210034', { ...phone({ status: 0, body: '', error: 'timeout', ms: 9000 }), ...server() });
  assert.equal(r.product, null); assert.equal(r.side, 'both');
  assert.match(r.trouble, /^This phone asked UPCitemdb but had no answer within 9 seconds\./);
  assert.doesNotMatch(r.trouble, /rate limit/i);
  assert.match(r.trouble, /the server's shared daily allowance/);
  assert.equal(r.diag.phone.error, 'timeout'); assert.equal(r.diag.server.step, 'lookup');
});

test('status 0 from the shell names the phone, with the shell\'s own reason when it gives one', async () => {
  const trouble = async (reply) => (await identify('5051892210034', { ...phone(reply), ...server() })).trouble;
  assert.match(await trouble({ status: 0, body: '', error: 'The Internet connection appears to be offline.' }), /^This phone could not reach UPCitemdb \(The Internet connection appears to be offline\.\)\./);
  assert.match(await trouble({ status: 0, body: '', error: '' }), /^This phone could not reach UPCitemdb\./);
  assert.match(await trouble({ status: 0, body: '', error: 'refused' }), /^This build of the Spine app does not allow lookups to UPCitemdb; rebuild it from Xcode\./);
  assert.match(await trouble({ status: 0, body: '', error: 'bridge' }), /^The Spine app did not take the request/);
  assert.match(await trouble({ status: 429, body: '{"code":"EXCEED_LIMIT"}', error: '' }), /^UPCitemdb has had its 100 free lookups from this phone today\./);
  assert.match(await trouble({ status: 503, body: '', error: '' }), /^UPCitemdb answered this phone with HTTP 503\./);
  assert.equal(phoneTrouble({ status: 0, error: 'timeout' }, 5000), 'This phone asked UPCitemdb but had no answer within 5 seconds.');
});

test('a server error other than its allowance is quoted, after the phone side', async () => {
  const r = await identify('5051892210034', { ...phone({ status: 0, body: '', error: 'timeout', ms: 9000 }), ...server({ lookup: { ...RATE_LIMITED, errors: ['upcitemdb: HTTP 500'] } }) });
  assert.equal(r.trouble, 'This phone asked UPCitemdb but had no answer within 9 seconds. The server could not look it up (upcitemdb: HTTP 500).');
});

test('in a plain browser the message says browsers cannot ask, blames the server side, and steers to adding by hand', async () => {
  const r = await identify('5051892210034', { ...browser(async () => { throw new TypeError('Failed to fetch'); }), ...server() });
  assert.equal(r.product, null); assert.equal(r.side, 'server');
  assert.equal(r.trouble, "Browsers cannot ask UPCitemdb themselves, and UPCitemdb has used up the server's shared daily allowance. Add the disc by hand, or scan it in the Spine app.");
  assert.equal(r.diag.browser.status, 0); assert.equal(r.diag.browser.error, 'blocked'); assert.equal(r.diag.phone, null);
});

test('the server answering with a product wins when the phone had nothing, and a clean miss from the server is an unknown via the server', async () => {
  let r = await identify('5051892210034', { ...phone({ status: 0, body: '', error: 'timeout' }), ...server({ lookup: { ...READ, errors: [], cached: true } }) });
  assert.equal(r.via, 'server'); assert.equal(r.parsed.title, 'Dunkirk'); assert.equal(r.trouble, undefined); assert.equal(r.diag.server.cached, true);
  r = await identify('5051892251990', { ...phone({ status: 0, body: '', error: 'timeout' }), ...server({ lookup: { ...RATE_LIMITED, errors: [] } }) });
  assert.equal(r.product, null); assert.equal(r.trouble, undefined); assert.equal(r.via, 'server'); assert.deepEqual(r.hint, HINT);
});

test('when the phone found the product but the server could not read it, the server side is blamed', async () => {
  const r = await identify('5051892210034', { ...phone(ok({ items: [DUNKIRK] })), ...server({ read: apiError(500, 'Something went wrong on the server.') }) });
  assert.equal(r.product, null); assert.equal(r.side, 'server');
  assert.equal(r.trouble, "This phone found the disc on UPCitemdb, but Spine's server could not read it (Something went wrong on the server.).");
  assert.equal(r.diag.server.step, 'identify'); assert.equal(r.diag.server.status, 500);
});

test('when nobody can be asked at all, both sides are named', async () => {
  const r = await identify('5051892210034', { ...phone({ status: 0, body: '', error: 'timeout' }), ...server({ lookup: apiError(0, 'Could not reach Spine. Check your connection and try again.') }) });
  assert.equal(r.side, 'both');
  assert.equal(r.trouble, "This phone asked UPCitemdb but had no answer within 9 seconds. Spine's server could not be asked (Could not reach Spine. Check your connection and try again.).");
});
