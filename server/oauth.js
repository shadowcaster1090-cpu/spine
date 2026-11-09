import crypto from 'node:crypto';

// Sign in with Google and Apple over the plain OAuth 2.0 / OpenID Connect code flow.
// Nothing here talks to the network; routes/oauth.js does the redirects and the token exchange.

const env = (k) => process.env[k] || '';
// Tests point both providers at a local mock server.
const base = (real, pathName) => (env('OAUTH_MOCK_BASE') ? env('OAUTH_MOCK_BASE') + pathName : real);

export const PROVIDERS = {
  google: {
    name: 'Google',
    authorize: () => base('https://accounts.google.com/o/oauth2/v2/auth', '/authorize'),
    token: () => base('https://oauth2.googleapis.com/token', '/token'),
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    scope: 'openid email profile',
    extra: { prompt: 'select_account' },
    configured: () => !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET')),
    clientId: () => env('GOOGLE_CLIENT_ID'),
    clientSecret: () => env('GOOGLE_CLIENT_SECRET')
  },
  apple: {
    name: 'Apple',
    authorize: () => base('https://appleid.apple.com/auth/authorize', '/authorize'),
    token: () => base('https://appleid.apple.com/auth/token', '/token'),
    issuers: ['https://appleid.apple.com'],
    scope: 'name email',
    // Apple only returns name/email scopes through a form POST back to us.
    extra: { response_mode: 'form_post' },
    configured: () => !!(env('APPLE_CLIENT_ID') && env('APPLE_TEAM_ID') && env('APPLE_KEY_ID') && env('APPLE_PRIVATE_KEY')),
    clientId: () => env('APPLE_CLIENT_ID'),
    clientSecret: () => appleClientSecret()
  }
};

export const configuredProviders = () => Object.entries(PROVIDERS).filter(([, p]) => p.configured()).map(([id, p]) => ({ id, name: p.name }));

export const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const randomToken = (n = 24) => crypto.randomBytes(n).toString('base64url');

export function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) throw new Error('Not a JWT');
  const json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
  return { header: json(parts[0]), payload: json(parts[1]) };
}

// Apple's "client secret" is a short-lived ES256 JWT signed with the key from the developer portal.
let appleSecretCache = { value: '', until: 0 };
export function appleClientSecret() {
  const now = Math.floor(Date.now() / 1000);
  if (appleSecretCache.until > now + 3600) return appleSecretCache.value;
  const key = env('APPLE_PRIVATE_KEY').replace(/\\n/g, '\n');
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: env('APPLE_KEY_ID'), typ: 'JWT' }));
  const exp = now + 60 * 60 * 24 * 30; // Apple allows up to six months; a month keeps rotation cheap.
  const payload = b64url(JSON.stringify({ iss: env('APPLE_TEAM_ID'), iat: now, exp, aud: 'https://appleid.apple.com', sub: env('APPLE_CLIENT_ID') }));
  const data = `${header}.${payload}`;
  const sig = crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' });
  appleSecretCache = { value: `${data}.${b64url(sig)}`, until: exp };
  return appleSecretCache.value;
}

// A per-install secret for signing the short-lived state cookie, kept in the database so restarts don't break sign-ins in flight.
export function appSecret(db) {
  const row = db.prepare("SELECT value FROM kv WHERE key = 'secret'").get();
  if (row) return row.value;
  const value = randomToken(32);
  db.prepare("INSERT INTO kv (key, value) VALUES ('secret', ?)").run(value);
  return value;
}

export function signState(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyState(token, secret) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.exp > Date.now() ? payload : null;
  } catch { return null; }
}

// Turn "Ada Lovelace" or "ada.lovelace@example.com" into a free username.
export function usernameFor(db, name, email) {
  const clean = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9_.-]/g, '').replace(/^[._-]+|[._-]+$/g, '').slice(0, 20);
  let stem = clean(name) || clean(String(email || '').split('@')[0]) || 'member';
  if (stem.length < 3) stem = (stem + 'xyz').slice(0, 3);
  const taken = (u) => db.prepare('SELECT 1 FROM users WHERE username = ?').get(u);
  if (!taken(stem)) return stem;
  for (let i = 2; i < 10000; i++) if (!taken(`${stem}${i}`)) return `${stem}${i}`;
  return `${stem}-${randomToken(3)}`;
}
