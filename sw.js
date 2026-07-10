const CACHE = 'controlate-v2';
const STATIC = [
  'https://fonts.googleapis.com/css2?family=Public+Sans:wght@300;400;500;600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
];

// Archivos propios NUNCA se cachean — siempre van a la red
const NO_CACHE = ['/app.js', '/supabase.js', '/index.html', '/sw.js'];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(STATIC).catch(function(){});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Supabase, Cloudflare, Anthropic: siempre red
  if (url.includes('supabase.co') || url.includes('workers.dev') || url.includes('anthropic')) return;

  // Archivos propios JS/HTML: siempre red, nunca caché
  var isOwn = NO_CACHE.some(function(p){ return url.includes(p); });
  if (isOwn || url.includes('github.io/Controlate')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // CDN externos: caché first
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request);
    })
  );
});
