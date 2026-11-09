import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { decodeJwt } from '../server/oauth.js';

let server, base, db, dir, mock, mockBase;
// What the mock provider will put in the id_token for each code it is asked to exchange.
const codes = new Map();
const tokenRequests = [];
const appleKey = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims) => `${b64({ alg: 'none' })}.${b64(claims)}.sig`;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-oauth-'));
  db = openDb(path.join(dir, 'test.db'));
  server = http.createServer(createApp({ db, uploadsDir: path.join(dir, 'uploads') }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;

  mock = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/token') {
      let raw = ''; for await (const c of req) raw += c;
      const form = Object.fromEntries(new URLSearchParams(raw));
      tokenRequests.push(form);
      const claims = codes.get(form.code);
      if (!claims) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'invalid_grant' })); }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id_token: idToken({ exp: Math.floor(Date.now() / 1000) + 300, ...claims }), access_token: 'x' }));
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => mock.listen(0, r));
  mockBase = `http://127.0.0.1:${mock.address().port}`;
  process.env.OAUTH_MOCK_BASE = mockBase;
  process.env.GOOGLE_CLIENT_ID = 'google-client';
  process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
  process.env.APPLE_CLIENT_ID = 'com.sharaf.spine.web';
  process.env.APPLE_TEAM_ID = 'TEAM123456';
  process.env.APPLE_KEY_ID = 'KEY1234567';
  process.env.APPLE_PRIVATE_KEY = appleKey.privateKey.export({ type: 'pkcs8', format: 'pem' });
});
after(() => {
  server.close(); mock.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
  for (const k of ['OAUTH_MOCK_BASE', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY']) delete process.env[k];
});

// A browser: keeps cookies, never follows redirects so we can inspect them.
function browser() {
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const absorb = (res) => {
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';'); const [k, ...v] = pair.split('='); const val = v.join('=');
      if (!val) jar.delete(k); else jar.set(k, val);
    }
  };
  const b = {
    jar,
    async get(url, headers = {}) {
      const res = await fetch(url.startsWith('http') ? url : base + url, { redirect: 'manual', headers: { cookie: cookieHeader(), ...headers } });
      absorb(res);
      const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, location: res.headers.get('location'), data };
    },
    async send(method, url, body, headers = {}) {
      const form = typeof body === 'string';
      const res = await fetch(base + url, { method, redirect: 'manual', headers: { cookie: cookieHeader(), 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json', ...headers }, body: form ? body : JSON.stringify(body ?? {}) });
      absorb(res);
      const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, location: res.headers.get('location'), data };
    }
  };
  return b;
}

// Walk a browser through start → provider → callback, pretending the provider approved `claims`.
async function signInWith(b, provider, claims, { query = '', input = {} } = {}) {
  const start = await b.get(`/api/auth/oauth/${provider}/start${query}`);
  assert.equal(start.status, 302, JSON.stringify(start.data));
  const u = new URL(start.location);
  assert.equal(u.origin + u.pathname, `${mockBase}/authorize`);
  const code = crypto.randomUUID();
  codes.set(code, { iss: provider === 'google' ? 'https://accounts.google.com' : 'https://appleid.apple.com', aud: provider === 'google' ? 'google-client' : 'com.sharaf.spine.web', nonce: u.searchParams.get('nonce'), ...claims });
  const params = new URLSearchParams({ code, state: u.searchParams.get('state'), ...input });
  return provider === 'apple'
    ? b.send('POST', `/api/auth/oauth/apple/callback`, params.toString(), { origin: 'https://appleid.apple.com' })
    : b.get(`/api/auth/oauth/google/callback?${params}`);
}

test('providers are advertised only when configured', async () => {
  const b = browser();
  const r = await b.get('/api/auth/providers');
  assert.deepEqual(r.data.providers.map((p) => p.id), ['google', 'apple']);
});

test('first Google sign-in creates the (admin) account, with a username from the name', async () => {
  const b = browser();
  const cb = await signInWith(b, 'google', { sub: 'g-1', email: 'Ada@Example.com', email_verified: true, name: 'Ada Lovelace' }, { query: '?next=/films' });
  assert.equal(cb.status, 302, JSON.stringify(cb.data));
  assert.equal(cb.location, '/films');
  assert.ok(b.jar.has('spine_session'));
  assert.ok(!b.jar.has('spine_oauth'), 'state cookie is cleared');
  const me = await b.get('/api/me');
  assert.equal(me.data.user.username, 'adalovelace');
  assert.equal(me.data.user.email, 'ada@example.com');
  assert.equal(me.data.user.display_name, 'Ada Lovelace');
  assert.equal(me.data.user.role, 'admin');
  assert.equal(me.data.user.has_password, false);
  assert.deepEqual(me.data.user.logins, ['google']);
  const t = tokenRequests.at(-1);
  assert.equal(t.client_secret, 'google-secret');
  assert.match(t.redirect_uri, /\/api\/auth\/oauth\/google\/callback$/);
});

test('the same Google account signs in again without a duplicate', async () => {
  const b = browser();
  const cb = await signInWith(b, 'google', { sub: 'g-1', email: 'ada@example.com', email_verified: true, name: 'Ada L' });
  assert.equal(cb.location, '/');
  const me = await b.get('/api/me');
  assert.equal(me.data.user.username, 'adalovelace');
  assert.equal(db.prepare('SELECT count(*) n FROM users').get().n, 1);
});

test('a provider account with a verified email matching a password account links to it', async () => {
  const b = browser();
  let r = await b.send('POST', '/api/auth/signup', { username: 'ben', email: 'ben@example.com', password: 'battery staple' });
  assert.equal(r.status, 200);
  const fresh = browser();
  const cb = await signInWith(fresh, 'google', { sub: 'g-2', email: 'ben@example.com', email_verified: true, name: 'Ben' });
  assert.equal(cb.location, '/');
  const me = await fresh.get('/api/me');
  assert.equal(me.data.user.username, 'ben');
  assert.equal(me.data.user.has_password, true);
  assert.deepEqual(me.data.user.logins, ['google']);
  // An unverified email never auto-links, and cannot become a second account either.
  const other = browser();
  const cb2 = await signInWith(other, 'google', { sub: 'g-3', email: 'ben@example.com', email_verified: false, name: 'Ben' });
  assert.match(decodeURIComponent(cb2.location), /^\/login\?error=An account already uses that email/);
  assert.ok(!other.jar.has('spine_session'));
  // A fresh verified address with a taken name gets a numbered username.
  const third = browser();
  await signInWith(third, 'google', { sub: 'g-4', email: 'ben.two@example.com', email_verified: true, name: 'Ben' });
  assert.equal((await third.get('/api/me')).data.user.username, 'ben2');
});

test('password sign-in explains that a provider account has no password', async () => {
  const b = browser();
  const r = await b.send('POST', '/api/auth/login', { login: 'adalovelace', password: 'anything' });
  assert.equal(r.status, 401);
  assert.match(r.data.error, /signs in with Google/);
});

test('a bad or missing state is refused and sends the browser back to /login', async () => {
  const b = browser();
  const start = await b.get('/api/auth/oauth/google/start');
  const u = new URL(start.location);
  const r = await b.get(`/api/auth/oauth/google/callback?code=x&state=wrong`);
  assert.equal(r.status, 302);
  assert.match(r.location, /^\/login\?error=/);
  assert.ok(!b.jar.has('spine_session'));
  // Right state, provider error.
  const start2 = await b.get('/api/auth/oauth/google/start');
  const u2 = new URL(start2.location);
  const r2 = await b.get(`/api/auth/oauth/google/callback?error=access_denied&state=${u2.searchParams.get('state')}`);
  assert.match(decodeURIComponent(r2.location), /cancelled/);
  void u;
});

test('the iPhone app gets a one-time token on its own URL scheme and swaps it for a session', async () => {
  const b = browser();
  const cb = await signInWith(b, 'google', { sub: 'g-1', email: 'ada@example.com', email_verified: true }, { query: '?app=1' });
  assert.equal(cb.status, 302);
  assert.match(cb.location, /^spine:\/\/auth\?t=/);
  assert.ok(!b.jar.has('spine_session'), 'no session in the system sign-in sheet');
  const t = new URL(cb.location).searchParams.get('t');
  const app = browser();
  const r = await app.get(`/api/auth/oauth/token?t=${t}`);
  assert.equal(r.status, 302);
  assert.equal(r.location, '/');
  assert.ok(app.jar.has('spine_session'));
  assert.equal((await app.get('/api/me')).data.user.username, 'adalovelace');
  // Single use.
  const again = browser();
  const r2 = await again.get(`/api/auth/oauth/token?t=${t}`);
  assert.match(r2.location, /^\/login\?error=/);
});

test('a signed-in member can link a provider, also from the app via a link token', async () => {
  const b = browser();
  await b.send('POST', '/api/auth/signup', { username: 'cleo', email: 'cleo@example.com', password: 'correct horse' });
  const cb = await signInWith(b, 'google', { sub: 'g-cleo', email: 'cleo.other@example.com', email_verified: true }, { query: '?next=/settings' });
  assert.equal(cb.location, '/settings?linked=google');
  assert.deepEqual((await b.get('/api/me')).data.user.logins, ['google']);
  // From the app: the system sheet has no cookies, so a link token carries the user.
  const lt = await b.send('POST', '/api/auth/oauth/link');
  const sheet = browser();
  const cb2 = await signInWith(sheet, 'apple', { sub: 'a-cleo', email: 'hidden@privaterelay.appleid.com', email_verified: 'true' }, { query: `?app=1&link=${lt.data.token}` });
  assert.equal(cb2.location, 'spine://auth?linked=apple');
  assert.deepEqual((await b.get('/api/me')).data.user.logins, ['google', 'apple']);
  // A provider account already attached to someone else cannot be linked.
  const d = browser();
  await d.send('POST', '/api/auth/signup', { username: 'dan', email: 'dan@example.com', password: 'correct horse' });
  const cb3 = await signInWith(d, 'google', { sub: 'g-cleo', email: 'cleo.other@example.com', email_verified: true });
  assert.match(decodeURIComponent(cb3.location), /already linked to another member/);
});

test('Apple: form post callback, name from the first authorisation, ES256 client secret', async () => {
  tokenRequests.length = 0;
  const b = browser();
  const cb = await signInWith(b, 'apple', { sub: 'a-1', email: 'eve@privaterelay.appleid.com', email_verified: 'true' },
    { input: { user: JSON.stringify({ name: { firstName: 'Eve', lastName: 'Polastri' }, email: 'eve@privaterelay.appleid.com' }) } });
  assert.equal(cb.status, 302, JSON.stringify(cb.data));
  assert.equal(cb.location, '/');
  const me = await b.get('/api/me');
  assert.equal(me.data.user.username, 'evepolastri');
  assert.equal(me.data.user.display_name, 'Eve Polastri');
  assert.deepEqual(me.data.user.logins, ['apple']);
  const secret = tokenRequests.at(-1).client_secret;
  const { header, payload } = decodeJwt(secret);
  assert.equal(header.alg, 'ES256'); assert.equal(header.kid, 'KEY1234567');
  assert.equal(payload.iss, 'TEAM123456'); assert.equal(payload.sub, 'com.sharaf.spine.web'); assert.equal(payload.aud, 'https://appleid.apple.com');
  const [h, p, s] = secret.split('.');
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: appleKey.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
});

test('provider accounts can set a password, then unlink; the last way in cannot be removed', async () => {
  const b = browser();
  await signInWith(b, 'google', { sub: 'g-solo', email: 'solo@example.com', email_verified: true, name: 'Solo' });
  let r = await b.send('DELETE', '/api/me/logins/google');
  assert.equal(r.status, 409);
  r = await b.send('POST', '/api/me/password', { new_password: 'a longer password' });
  assert.equal(r.status, 200);
  assert.equal((await b.get('/api/me')).data.user.has_password, true);
  r = await b.send('DELETE', '/api/me/logins/google');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.logins, []);
  r = await b.send('POST', '/api/auth/login', { login: 'solo', password: 'a longer password' });
  assert.equal(r.status, 200);
});

test('a provider account without a password deletes itself by typing its username', async () => {
  const b = browser();
  await signInWith(b, 'google', { sub: 'g-bye', email: 'bye@example.com', email_verified: true, name: 'Bye Now' });
  let r = await b.send('DELETE', '/api/me', { password: 'whatever' });
  assert.equal(r.status, 400);
  r = await b.send('DELETE', '/api/me', { confirm: 'byenow' });
  assert.equal(r.status, 200);
  assert.equal((await b.get('/api/me')).data.user, null);
});

test('an unconfigured provider is a 404', async () => {
  delete process.env.APPLE_PRIVATE_KEY;
  const b = browser();
  const r = await b.get('/api/auth/oauth/apple/start');
  assert.equal(r.status, 404);
  assert.deepEqual((await b.get('/api/auth/providers')).data.providers.map((p) => p.id), ['google']);
});
