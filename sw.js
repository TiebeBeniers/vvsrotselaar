// ============================================================
//  VVS Rotselaar — Service Worker (root domain)
//
//  Cachingstrategie:
//   • CACHE_NAME/PAGES_CACHE zijn NIET meer per deploy versioneerd
//     (voorheen: bump-sw-cache.js verhoogde dit automatisch, wat
//     de volledige cache bij ELKE deploy wiste — ook voor bestanden
//     die niet gewijzigd waren). Enkel manueel ophogen als je ooit
//     bewust de volledige cache bij iedereen wil forceren resetten
//     (bv. na een structurele wijziging aan deze caching-logica zelf).
//   • Statische bestanden (js/css/afbeeldingen/fonts/manifest):
//     stale-while-revalidate — toon meteen de gecachte versie, en
//     ververs op de achtergrond via een normale fetch(). Firebase
//     Hosting zet automatisch ETags, dus die achtergrond-check kost
//     bijna niets (een goedkope "304 Not Modified") zolang het
//     bestand niet écht gewijzigd is. Enkel bestanden die effectief
//     aangepast zijn bij een deploy worden opnieuw volledig gedownload.
//   • HTML-pagina's: Network First (ongewijzigd) — altijd de meest
//     recente pagina, met offline-fallback.
// ============================================================

const BASE        = '';
const CACHE_NAME  = 'vvs-static-v1';
const PAGES_CACHE = 'vvs-pages-v1';
const OFFLINE_URL = BASE + '/offline.html';
const NOTFOUND_URL = BASE + '/404.html';

// Kern-shell: altijd meteen beschikbaar, ook bij de eerste (offline) install.
const STATIC_ASSETS = [
  BASE + '/manifest.json',
  BASE + '/assets/logo.png',
  BASE + '/assets/icons/icon-192.png',
  BASE + '/assets/icons/icon-512.png',
  BASE + '/assets/icons/apple-touch-icon.png',
  BASE + '/offline.html',
  BASE + '/404.html',
];

// Alle overige pagina's — worden voorgeladen voor betere offline-ondersteuning,
// maar spelen geen rol in de cache-busting logica (dat is Network First, zie onder).
const HTML_PAGES = [
  BASE + '/index.html',
  BASE + '/admin.html',
  BASE + '/admin2.html',
  BASE + '/admin3.html',
  BASE + '/contact.html',
  BASE + '/evenementen.html',
  BASE + '/galerij.html',
  BASE + '/kalender.html',
  BASE + '/live.html',
  BASE + '/login.html',
  BASE + '/partners.html',
  BASE + '/privacy.html',
  BASE + '/rockwerchter.html',
  BASE + '/speler.html',
  BASE + '/veteranen.html',
  BASE + '/webshop.html',
  BASE + '/werklijst.html',
  BASE + '/zaterdag.html',
  BASE + '/zondag.html',
];

// Bestandstypes die via stale-while-revalidate lopen (JS, CSS, afbeeldingen,
// fonts, JSON). sw.js en firebase-messaging-sw.js zelf NOOIT hier in laten
// terechtkomen — de browser moet die altijd vers kunnen checken (zie firebase.json:
// Cache-Control: no-cache voor die twee bestanden).
const STATIC_EXT_RE = /\.(css|js|json|woff2?|ttf|eot|otf|svg|png|jpg|jpeg|gif|webp|avif|ico)$/;

const NETWORK_ONLY_DOMAINS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebasestorage.googleapis.com',
  'www.gstatic.com',
];

// ── Install ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then(cache =>
        cache.addAll(STATIC_ASSETS).catch(e => console.warn('[SW] Pre-cache static:', e))),
      caches.open(PAGES_CACHE).then(cache =>
        cache.addAll(HTML_PAGES).catch(e => console.warn('[SW] Pre-cache pages:', e))),
    ]).then(() => self.skipWaiting())
  );
});

// ── Activate ─────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        // Ruimt enkel oude/verweesde cachenamen op (bv. nog een vvs-static-v51
        // van vóór deze wijziging bij iemand die lang niet gedeployed heeft).
        // Bij een normale deploy verandert er hier niets meer, want de namen
        // blijven nu constant.
        keys.filter(k => ![CACHE_NAME, PAGES_CACHE].includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Firebase / externe diensten → altijd network
  if (NETWORK_ONLY_DOMAINS.some(d => url.hostname.includes(d))) return;
  if (request.method !== 'GET') return;

  // sw.js / firebase-messaging-sw.js zelf: nooit via onze eigen cache-logica
  // laten lopen — de browser moet die altijd rechtstreeks kunnen ophalen om
  // updates tijdig te detecteren.
  if (url.pathname === BASE + '/sw.js' || url.pathname === BASE + '/firebase-messaging-sw.js') return;

  // HTML pagina's → Network First
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstHtml(request));
    return;
  }

  // Statische assets → Stale While Revalidate
  if (STATIC_EXT_RE.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event));
    return;
  }
});

async function staleWhileRevalidate(event) {
  const request = event.request;
  const cache   = await caches.open(CACHE_NAME);
  const cached  = await cache.match(request);

  // Ververs op de achtergrond. Dankzij Firebase's ETags is dit meestal een
  // goedkope 304 (geen nieuwe download) zolang het bestand niet gewijzigd is.
  const networkFetch = fetch(request)
    .then(response => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  // Houdt de service worker actief tot de achtergrond-update écht klaar is,
  // ook al hebben we hieronder al een antwoord teruggegeven.
  event.waitUntil(networkFetch);

  if (cached) return cached;

  // Nog niets gecacht: wacht op het netwerk.
  const fresh = await networkFetch;
  return fresh || new Response('', { status: 408 });
}
function event_waitUntilSafe(promise) { promise.catch(() => {}); }

async function networkFirstHtml(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(PAGES_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return caches.match(OFFLINE_URL);
  }
}

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // Kiosk toggle: refresh alle open clients (tabs/apparaten) meteen
  if (event.data?.type === 'KIOSK_RELOAD') {
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      clients.forEach(client => {
        client.postMessage({ type: 'KIOSK_RELOAD' });
      });
    });
  }
});