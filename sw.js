/* Service worker: deixa o app abrir offline. Os DADOS ficam no IndexedDB e nunca passam por aqui,
   então atualizar o app não apaga nada. Ao publicar uma nova versão, aumente o número em CACHE. */
const CACHE = 'meucorpo-v5';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'db.js', 'foods-base.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Rede primeiro (pega a versão nova quando há internet); se falhar ou demorar, usa o cache.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const net = await Promise.race([
        fetch(req, { cache: 'no-cache' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
      ]);
      if (net && net.ok) cache.put(req, net.clone());
      return net;
    } catch (_) {
      return (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('index.html') : Response.error());
    }
  })());
});
