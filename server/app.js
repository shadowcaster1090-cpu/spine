import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionUser } from './auth.js';
import authRoutes from './routes/auth.js';
import catalogueRoutes from './routes/catalogue.js';
import submissionRoutes from './routes/submissions.js';
import collectionRoutes from './routes/collection.js';
import socialRoutes from './routes/social.js';
import accountRoutes from './routes/account.js';
import diaryRoutes from './routes/diary.js';
import friendsRoutes from './routes/friends.js';
import streamingRoutes from './routes/streaming.js';
import { editionMeta } from './catalogue.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, '..', 'public');

import { HttpError, fail } from './errors.js';
export { HttpError, fail };

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json'
};

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

function makeRouter() {
  const routes = [];
  const add = (method) => (pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler });
  };
  return {
    get: add('GET'), post: add('POST'), patch: add('PATCH'), put: add('PUT'), delete: add('DELETE'),
    match(method, pathname) {
      let allowed = false;
      for (const r of routes) {
        const m = pathname.match(r.re);
        if (!m) continue;
        allowed = true;
        if (r.method !== method) continue;
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { handler: r.handler, params };
      }
      return allowed ? 'method' : null;
    }
  };
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) fail(413, 'That upload is too large.');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  const type = req.headers['content-type'] || '';
  if (type.includes('application/json')) {
    try { return JSON.parse(raw); } catch { fail(400, 'The request body is not valid JSON.'); }
  }
  fail(415, 'Send requests as JSON.');
}

// Very small fixed-window limiter, per IP and bucket.
const hits = new Map();
export function rateLimit(ip, bucket, max, windowMs) {
  const key = bucket + ':' + ip, now = Date.now();
  const e = hits.get(key);
  if (!e || e.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return; }
  if (++e.n > max) fail(429, 'Too many attempts. Wait a few minutes and try again.');
}

export function createApp({ db, uploadsDir, tmdbKey = process.env.TMDB_API_KEY, secureCookies = false }) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const r = makeRouter();
  const ctx = { db, uploadsDir, tmdbKey, secureCookies, fail, rateLimit };
  for (const reg of [authRoutes, catalogueRoutes, diaryRoutes, friendsRoutes, streamingRoutes, submissionRoutes, collectionRoutes, socialRoutes, accountRoutes]) reg(r, ctx);
  const indexHtml = () => fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', ...headers });
    res.end(body);
  }

  function serveFile(res, file, cache) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
      send(res, 200, fs.readFileSync(file), {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': cache
      });
    });
  }

  function spa(res, pathname) {
    let html = indexHtml();
    const m = pathname.match(/^\/release\/(\d+)/);
    const fm = pathname.match(/^\/film\/(\d+)/);
    if (m) {
      const meta = editionMeta(db, +m[1]);
      if (meta) {
        const e = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        html = html.replace(/<title>.*?<\/title>/, `<title>${e(meta.title)} · Spine</title>`)
          .replace('<!--meta-->', `<meta name="description" content="${e(meta.description)}"><meta property="og:title" content="${e(meta.title)}"><meta property="og:description" content="${e(meta.description)}">${meta.image ? `<meta property="og:image" content="/uploads/${e(meta.image)}">` : ''}`);
      }
    } else if (fm) {
      const f = db.prepare('SELECT title, year, synopsis FROM films WHERE id = ?').get(+fm[1]);
      if (f) {
        const e = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        html = html.replace(/<title>.*?<\/title>/, `<title>${e(f.title)}${f.year ? ' (' + f.year + ')' : ''} · Spine</title>`)
          .replace('<!--meta-->', `<meta name="description" content="${e(f.synopsis || 'Editions, reviews and who owns it, on Spine.')}">`);
      }
    }
    send(res, 200, html, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' });
  }

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const { pathname } = url;
    try {
      if (!pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
        if (pathname.startsWith('/uploads/')) {
          const f = path.join(uploadsDir, path.basename(pathname));
          return serveFile(res, f, 'public, max-age=31536000, immutable');
        }
        const f = path.normalize(path.join(PUBLIC, pathname));
        if (f.startsWith(PUBLIC) && path.extname(f) && fs.existsSync(f)) return serveFile(res, f, 'no-cache');
        if (path.extname(pathname)) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
        return spa(res, pathname);
      }

      const found = r.match(req.method, pathname);
      if (!found) fail(404, 'No such endpoint.');
      if (found === 'method') fail(405, 'Method not allowed.');

      // CSRF: state-changing requests must be same-origin JSON.
      if (req.method !== 'GET') {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) fail(403, 'Cross-site request refused.');
      }
      const ip = req.socket.remoteAddress || '';
      const body = req.method === 'GET' ? {} : await readBody(req, pathname.endsWith('/images') ? 8e6 : pathname.endsWith('/import') || pathname.includes('/import/') ? 60e6 : 2e5);
      const user = sessionUser(db, req);
      const out = await found.handler({ req, res, params: found.params, query: url.searchParams, body, user, ip });
      if (res.writableEnded) return;
      if (out && out.__raw) return send(res, 200, out.body, out.headers);
      send(res, 200, JSON.stringify(out ?? { ok: true }), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    } catch (err) {
      let status = err.status || 500;
      if (status === 500 && /UNIQUE constraint/.test(err.message)) { status = 409; err.message = 'That already exists.'; }
      if (status === 500) console.error(err);
      if (!res.headersSent) send(res, status, JSON.stringify({ error: status === 500 ? 'Something went wrong on the server.' : err.message }), { 'Content-Type': 'application/json' });
    }
  };
}
