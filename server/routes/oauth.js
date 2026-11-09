import { createSession, sessionCookie, requireUser, hashPassword } from '../auth.js';
import { tx } from '../db.js';
import { PROVIDERS, configuredProviders, appSecret, signState, verifyState, randomToken, decodeJwt, usernameFor } from '../oauth.js';

const STATE_COOKIE = 'spine_oauth';
const STATE_TTL = 10 * 60e3;
const LOGIN_TOKEN_TTL = 2 * 60e3;

// Sign in with Google / Apple.
//   GET  /api/auth/oauth/:provider/start?next=/films[&app=1][&link=<token>]  → redirect to the provider
//   GET|POST /api/auth/oauth/:provider/callback                               ← the provider sends the code here
//   GET  /api/auth/oauth/token?t=…   the iPhone app turns a one-time token into a session in its own web view
export default function (r, { db, fail, rateLimit, secureCookies }) {
  const secret = appSecret(db);
  const publicBase = (req) => (process.env.PUBLIC_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`).replace(/\/$/, '');
  const redirectUri = (req, provider) => `${publicBase(req)}/api/auth/oauth/${provider}/callback`;
  const stateCookie = (value, maxAge) => {
    // Apple posts the result back cross-site, which a Lax cookie would not accompany; None needs Secure, so HTTPS only.
    const parts = [`${STATE_COOKIE}=${value}`, 'Path=/api/auth/oauth', 'HttpOnly', `Max-Age=${maxAge}`, `SameSite=${secureCookies ? 'None' : 'Lax'}`];
    if (secureCookies) parts.push('Secure');
    return parts.join('; ');
  };
  const readCookie = (req) => {
    for (const part of (req.headers.cookie || '').split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === STATE_COOKIE) return rest.join('=');
    }
    return null;
  };
  const redirect = (res, location, cookies = []) => { res.writeHead(302, { Location: location, 'Set-Cookie': cookies, 'Cache-Control': 'no-store' }); res.end(); };
  const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)/.test(n) ? n : '/');
  const provider = (id) => {
    const p = PROVIDERS[id];
    if (!p || !p.configured()) fail(404, 'That sign-in method is not available here.');
    return p;
  };

  r.get('/api/auth/providers', () => ({ providers: configuredProviders() }));

  // The signed-in web app asks for this before linking from inside the iPhone app, where the system
  // sign-in sheet has no Spine cookies.
  r.post('/api/auth/oauth/link', ({ user }) => {
    requireUser(user);
    const token = randomToken();
    db.prepare("INSERT INTO login_tokens (token, user_id, purpose, expires) VALUES (?, ?, 'link', ?)").run(token, user.id, Date.now() + STATE_TTL);
    return { token };
  });

  r.get('/api/auth/oauth/:provider/start', ({ req, res, params, query, user, ip }) => {
    rateLimit(ip, 'oauth', 30, 15 * 60e3);
    const p = provider(params.provider);
    let link = user ? user.id : 0;
    if (query.get('link')) {
      const row = db.prepare("SELECT user_id FROM login_tokens WHERE token = ? AND purpose = 'link' AND expires > ?").get(query.get('link'), Date.now());
      if (!row) fail(400, 'That link request expired. Try again from Settings.');
      db.prepare('DELETE FROM login_tokens WHERE token = ?').run(query.get('link'));
      link = row.user_id;
    }
    const state = randomToken(), nonce = randomToken();
    const payload = { s: state, n: nonce, next: safeNext(query.get('next')), app: query.get('app') === '1', link, exp: Date.now() + STATE_TTL };
    const u = new URL(p.authorize());
    const q = { client_id: p.clientId(), redirect_uri: redirectUri(req, params.provider), response_type: 'code', scope: p.scope, state, nonce, ...p.extra };
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    redirect(res, u.toString(), [stateCookie(signState(payload, secret), STATE_TTL / 1000)]);
  });

  async function finish({ req, res, params, input, ip }) {
    rateLimit(ip, 'oauth', 30, 15 * 60e3);
    const id = params.provider;
    const p = provider(id);
    const st = verifyState(readCookie(req), secret);
    const clear = stateCookie('', 0);
    const back = (msg) => redirect(res, st?.app ? `spine://auth?error=${encodeURIComponent(msg)}` : `/login?error=${encodeURIComponent(msg)}`, [clear]);
    if (!st || !input.state || input.state !== st.s) return back('That sign-in took too long or came from another browser. Please try again.');
    if (input.error) return back(input.error === 'access_denied' || input.error === 'user_cancelled_authorize' ? 'You cancelled the sign-in.' : `${p.name} would not complete the sign-in (${input.error}).`);
    if (!input.code) return back(`${p.name} sent no sign-in code back.`);

    let claims;
    try {
      const tokRes = await fetch(p.token(), {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ code: String(input.code), client_id: p.clientId(), client_secret: p.clientSecret(), redirect_uri: redirectUri(req, id), grant_type: 'authorization_code' })
      });
      const tok = await tokRes.json().catch(() => ({}));
      if (!tokRes.ok || !tok.id_token) throw new Error(tok.error_description || tok.error || `HTTP ${tokRes.status}`);
      claims = decodeJwt(tok.id_token).payload;
    } catch (e) {
      console.error(`${id} token exchange failed:`, e.message);
      return back(`${p.name} did not confirm the sign-in. Please try again.`);
    }
    // The token came straight from the provider over TLS in exchange for our client secret, so the
    // claims are trusted; still check they are meant for us.
    const now = Math.floor(Date.now() / 1000);
    if (claims.aud !== p.clientId() && !(Array.isArray(claims.aud) && claims.aud.includes(p.clientId()))) return back('The sign-in response was meant for another app.');
    if (!p.issuers.includes(claims.iss)) return back('The sign-in response came from an unexpected issuer.');
    if (claims.exp && claims.exp < now - 60) return back('The sign-in response had already expired.');
    if (claims.nonce !== undefined && claims.nonce !== st.n) return back('The sign-in response did not match this browser.');

    const subject = String(claims.sub || '');
    if (!subject) return back(`${p.name} returned no account id.`);
    const email = String(claims.email || '').trim().toLowerCase();
    const verified = claims.email_verified === true || claims.email_verified === 'true' || (id === 'apple' && !!email);
    let name = String(claims.name || '').trim();
    if (id === 'apple' && input.user) {
      // Apple sends the name once, on first authorisation, as a JSON string in the form post.
      try { const u = typeof input.user === 'string' ? JSON.parse(input.user) : input.user; name = [u?.name?.firstName, u?.name?.lastName].filter(Boolean).join(' ').trim() || name; } catch {}
    }

    const ident = db.prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?').get(id, subject);
    let userId;
    try {
      if (st.link) {
        if (ident && ident.user_id !== st.link) return back(`That ${p.name} account is already linked to another member.`);
        if (!ident) db.prepare('INSERT INTO identities (provider, subject, user_id, email) VALUES (?, ?, ?, ?)').run(id, subject, st.link, email);
        const dest = st.next === '/' ? '/settings' : st.next;
        return redirect(res, st.app ? `spine://auth?linked=${id}` : `${dest}${dest.includes('?') ? '&' : '?'}linked=${id}`, [clear]);
      }
      if (ident) {
        userId = ident.user_id;
      } else {
        const existing = email ? db.prepare('SELECT id FROM users WHERE email = ?').get(email) : null;
        if (existing && !verified) return back(`An account already uses that email, but ${p.name} has not verified it. Sign in with your password, then link ${p.name} from Settings.`);
        if (existing) {
          userId = existing.id;
          db.prepare('INSERT INTO identities (provider, subject, user_id, email) VALUES (?, ?, ?, ?)').run(id, subject, userId, email);
        } else {
          if (!email) return back(`We need an email address from ${p.name} to create your account.`);
          userId = tx(db, () => {
            const first = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
            const username = usernameFor(db, name, email);
            const { lastInsertRowid } = db.prepare('INSERT INTO users (username, email, pass, role, display_name) VALUES (?, ?, ?, ?, ?)')
              .run(username, email, '', first ? 'admin' : 'member', name.slice(0, 40));
            db.prepare('INSERT INTO identities (provider, subject, user_id, email) VALUES (?, ?, ?, ?)').run(id, subject, Number(lastInsertRowid), email);
            return Number(lastInsertRowid);
          });
        }
      }
    } catch (e) {
      console.error(`${id} sign-in failed:`, e.message);
      return back('Something went wrong while signing you in. Please try again.');
    }

    if (st.app) {
      const t = randomToken();
      db.prepare("INSERT INTO login_tokens (token, user_id, purpose, expires) VALUES (?, ?, 'login', ?)").run(t, userId, Date.now() + LOGIN_TOKEN_TTL);
      return redirect(res, `spine://auth?t=${t}`, [clear]);
    }
    const s = createSession(db, userId);
    redirect(res, st.next, [sessionCookie(s.token, s.expires, secureCookies), clear]);
  }

  r.get('/api/auth/oauth/:provider/callback', (c) => finish({ ...c, input: Object.fromEntries(c.query) }));
  r.post('/api/auth/oauth/:provider/callback', (c) => finish({ ...c, input: c.body }));

  r.get('/api/auth/oauth/token', ({ query, res }) => {
    const t = String(query.get('t') || '');
    db.prepare('DELETE FROM login_tokens WHERE expires < ?').run(Date.now());
    const row = db.prepare("SELECT user_id FROM login_tokens WHERE token = ? AND purpose = 'login' AND expires > ?").get(t, Date.now());
    if (!row) return redirect(res, '/login?error=' + encodeURIComponent('That sign-in link expired. Please try again.'));
    db.prepare('DELETE FROM login_tokens WHERE token = ?').run(t);
    const s = createSession(db, row.user_id);
    redirect(res, '/', [sessionCookie(s.token, s.expires, secureCookies)]);
  });

  r.get('/api/me/logins', ({ user }) => {
    requireUser(user);
    return { logins: db.prepare('SELECT provider, email, created_at FROM identities WHERE user_id = ? ORDER BY created_at').all(user.id) };
  });

  r.delete('/api/me/logins/:provider', ({ user, params }) => {
    requireUser(user);
    const u = db.prepare('SELECT pass FROM users WHERE id = ?').get(user.id);
    const n = db.prepare('SELECT count(*) n FROM identities WHERE user_id = ?').get(user.id).n;
    if (!u.pass && n <= 1) fail(409, 'Set a password first, or you would have no way to sign in.');
    db.prepare('DELETE FROM identities WHERE user_id = ? AND provider = ?').run(user.id, params.provider);
    return { logins: db.prepare('SELECT provider, email, created_at FROM identities WHERE user_id = ? ORDER BY created_at').all(user.id) };
  });

  // Members who arrived through a provider can add a password later without knowing a "current" one.
  r.post('/api/me/password', ({ user, body }) => {
    requireUser(user);
    const u = db.prepare('SELECT pass FROM users WHERE id = ?').get(user.id);
    if (u.pass) fail(400, 'You already have a password. Change it from Settings.');
    if (String(body.new_password || '').length < 8) fail(400, 'Use a password of at least 8 characters.');
    db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPassword(String(body.new_password)), user.id);
    return { ok: true };
  });
}
