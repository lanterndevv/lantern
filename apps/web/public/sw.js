// Service worker a mano. Cachea el shell (navegación → index) y /static/* de Vite (stale-while-revalidate); /assets/* son subidas inmutables (caché primero).
// Nunca toca /api ni /ws ni otros orígenes.
const C = 'lantern-v2';

self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.add('/')).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api') || u.pathname.startsWith('/ws')) return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then(res => { if (res.ok) caches.open(C).then(c => c.put('/', res.clone())); return res; })
      .catch(() => caches.match('/').then(m => m || Response.error())));
  } else if (u.pathname.startsWith('/static/') || u.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(C).then(async c => {
      const hit = await c.match(r);
      const net = fetch(r).then(res => { if (res.ok) c.put(r, res.clone()); return res; }).catch(() => hit || Response.error());
      return hit || net;
    }));
  }
});
