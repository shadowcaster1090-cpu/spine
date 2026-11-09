// Spine service worker: network first, with the app shell and static files cached for offline opens.
const V = 'spine-v5';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(V);
    try {
      const res = await fetch(r);
      if (res.ok && (r.mode === 'navigate' || /\.(js|css|svg|png|jpg|webp|webmanifest)$/.test(u.pathname))) cache.put(r, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(r);
      if (hit) return hit;
      if (r.mode === 'navigate') { const shell = await cache.match('/'); if (shell) return shell; }
      throw err;
    }
  })());
});
