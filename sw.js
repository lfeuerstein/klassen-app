/* Klassen-App: hält die Programmdateien auf dem Gerät, damit die App ohne Internet startet.
   Es werden nur die eigenen Programmdateien zwischengespeichert, keine Daten. */
const CACHE = 'klassen-app-2026-11-27-18';
const DATEIEN = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((namen) => Promise.all(namen.filter((n) => n !== CACHE).map((n) => caches.delete(n)))).then(() => self.clients.claim()));
});
// Sofort aus dem Zwischenspeicher starten (WLAN der Schule fällt manchmal aus), im Hintergrund die neue Fassung holen.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const alt = await c.match(req, { ignoreSearch: true });
    const neu = fetch(req).then((r) => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
    if (alt) { e.waitUntil(neu); return alt; }
    return (await neu) || (await c.match('index.html')) || Response.error();
  }));
});
