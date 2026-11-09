/* eslint-disable no-undef */
/**
 * Service worker voor de webvarianten.
 *
 * - Zet de app volledig in de cache zodat ze offline werkt (ook als
 *   beginscherm-app op iPad en Android).
 * - Network-first voor de shell (nieuwe versie komt snel door), cache-first
 *   voor onveranderlijke bestanden (lettertypes).
 * - Geen enkele externe URL in de cache: de app werkt zonder internet, en de
 *   advertentie wordt niet gecached.
 *
 * De versie wordt bij de build vervangen (zie scripts/build.mjs).
 */
const VERSION = '202611091622';
const CACHE = `rekenkampioen-${VERSION}`;
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './fonts/baloo-2-latin-600-800.woff2',
  './fonts/baloo-2-latin-ext-600-800.woff2',
  './fonts/lexend-latin-400-600.woff2',
  './fonts/lexend-latin-ext-400-600.woff2',
];

/**
 * De gebouwde JS en CSS hebben een hash in de naam en zijn dus niet op
 * voorhand bekend. Bij de installatie halen we de index.html op en zetten we
 * alle bestanden waar de pagina naar verwijst meteen in de cache. Zo werkt de
 * app ook offline als je na het eerste bezoek direct het internet afsluit.
 */
async function precacheBuild() {
  const cache = await caches.open(CACHE);
  await cache.addAll(PRECACHE).catch(() => undefined);
  try {
    const res = await fetch('./index.html', { cache: 'reload' });
    if (!res.ok) return;
    const html = await res.clone().text();
    await cache.put('./index.html', res.clone());
    const urls = new Set();
    for (const m of html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)) {
      urls.add(m[1]);
    }
    await Promise.all(
      [...urls].map((u) =>
        cache.add(u).catch(() => undefined),
      ),
    );
  } catch {
    // Zonder netwerk blijft de rest van de precache gewoon staan.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheBuild().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Alleen eigen bestanden: nooit advertentie- of andere externe verzoeken.
  if (url.origin !== self.location.origin) return;

  // Vaste bestanden: altijd eerst uit de cache (ook manifest en iconen, zodat
  // de app ook offline volledig kan starten vanaf het beginscherm).
  const vast =
    url.pathname.includes('/assets/') ||
    url.pathname.includes('/fonts/') ||
    url.pathname.endsWith('/manifest.webmanifest') ||
    /\/icon-[^/]*\.png$/.test(url.pathname) ||
    url.pathname.endsWith('/apple-touch-icon.png') ||
    url.pathname.endsWith('/favicon.svg');

  if (vast) {
    // Onveranderlijke bestanden: eerst uit de cache.
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // De shell: netwerk eerst, en bij geen internet terug naar de cache.
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit ?? caches.match('./index.html'))),
  );
});
