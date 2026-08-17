const CACHE_NAME = "econ-digest-v8";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./rates.html",
  "./news.html",
  "./analytics.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

function dataCacheKey(url) {
  return new Request(`${url.origin}${url.pathname}`);
}

function isHtmlRequest(request, url) {
  return (
    request.mode === "navigate" ||
    url.pathname.endsWith("/") ||
    url.pathname.endsWith(".html") ||
    (request.headers?.get?.("accept") ?? "").includes("text/html")
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  if (url.origin !== location.origin) return;

  if (url.pathname.includes("/data/")) {
    const key = dataCacheKey(url);
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(key, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(key).then(
            (cached) =>
              cached ?? new Response("", { status: 503, statusText: "offline, no cached data" })
          )
        )
    );
    return;
  }

  if (isHtmlRequest(event.request, url)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() =>
          caches
            .match(event.request)
            .then((cached) => cached ?? caches.match("./index.html"))
            .then((cached) => cached ?? new Response("", { status: 503, statusText: "offline" }))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
