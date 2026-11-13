// Keeps the app working without internet after a first visit (playing as a guest).
//
// Pages, code and lists: from the network when online (so updates show up at once), from the
// copy kept here when offline. Pictures, fonts and textures: from the copy when there is one,
// since they don't change (library pictures carry a version in their address).
// Account data (/api/) is never kept here.

const CACHE = 'puzzle-table-v2';
const SHELL = [
  './', 'index.html', 'styles.css', 'assets/fonts.css', 'manifest.webmanifest', 'vendor/gsap.min.js',
  'js/main.js', 'js/game.js', 'js/cutter.js', 'js/pieceOptions.js', 'js/textures.js', 'js/pouch.js',
  'js/effects.js', 'js/audio.js', 'js/timer.js', 'js/library.js', 'js/api.js', 'js/daily.js',
  'js/achievements.js', 'js/gallery.js', 'js/icons.js', 'js/hero.js', 'js/intro.js', 'js/scrollPieces.js',
  'js/photoLibrary.js', 'js/imageLoader.js', 'js/account.js', 'js/social.js', 'js/multiplayer.js',
  'js/music.js', 'js/guide.js', 'js/i18n.js', 'js/messages.js', 'js/app.js', 'js/saving.js',
  'js/resultCard.js', 'js/resumeCard.js', 'js/dailyCard.js', 'js/friendPlay.js', 'js/galleryScreen.js',
  'js/musicPanel.js', 'js/settingsPanel.js', 'assets/library/library.json', 'assets/icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // One at a time and forgiving: a missing file mustn't stop the rest from being kept.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz' || url.pathname.endsWith('/admin.html')) return;
  const lasting = /\.(webp|jpg|png|svg|woff2)$/.test(url.pathname);
  event.respondWith(lasting ? fromCacheFirst(request) : fromNetworkFirst(request));
});

async function fromNetworkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const kept = await cache.match(request, { ignoreSearch: true });
    if (kept) return kept;
    if (request.mode === 'navigate') return (await cache.match('index.html')) ?? Response.error();
    return Response.error();
  }
}

async function fromCacheFirst(request) {
  const cache = await caches.open(CACHE);
  const kept = await cache.match(request);
  if (kept) return kept;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}
