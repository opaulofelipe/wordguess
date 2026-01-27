const CACHE_NAME = "palavras-pwa-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./script.js",
  "./manifest.json",
  "./icon-192.png",
  "./palavras.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Apenas GET
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached) => {
      // Tenta cache primeiro
      if (cached) return cached;

      // Senão, busca na rede e salva no cache (pra próxima)
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => {
        // Se offline e não tem no cache, cai pro index (shell)
        return caches.match("./index.html");
      });
    })
  );
});
