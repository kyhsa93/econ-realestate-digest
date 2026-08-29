const CACHE_NAME = "jipgye-v13";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./rates.html",
  "./news.html",
  "./style.css",
  "./nav.js",
  "./search.js",
  "./analytics.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// 브라우저 HTTP 캐시를 건너뛰고 받는다. GitHub Pages가 HTML과 스크립트에 max-age를
// 걸어 두어, 그냥 받으면 새로 올린 코드 대신 몇 분 전 것이 그대로 돌아온다.
function fetchFresh(request) {
  return fetch(request, { cache: "reload" });
}

function keepInCache(key, response) {
  if (!response.ok) return response;
  const copy = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(key, copy));
  return response;
}

function offlineResponse(statusText) {
  return new Response("", { status: 503, statusText });
}

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

// 페이지를 움직이는 코드는 HTML 안에도 있고 따로 받는 스크립트·스타일시트에도 있다.
// 셋 다 네트워크를 먼저 본다 - 캐시부터 주면 새로 올린 코드가 다음 실행에나 걸린다.
// style.css는 62장이 같은 파일을 보므로, 한 번 낡으면 사이트 전체가 낡는다.
function isPageCode(request, url) {
  return isHtmlRequest(request, url) || url.pathname.endsWith(".js") || url.pathname.endsWith(".css");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS.map((asset) => new Request(asset, { cache: "reload" }))))
  );
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
      fetchFresh(event.request)
        .then((response) => keepInCache(key, response))
        .catch(() =>
          caches.match(key).then((cached) => cached ?? offlineResponse("offline, no cached data"))
        )
    );
    return;
  }

  if (isPageCode(event.request, url)) {
    const html = isHtmlRequest(event.request, url);
    event.respondWith(
      fetchFresh(event.request)
        .then((response) => keepInCache(event.request, response))
        .catch(() =>
          caches
            .match(event.request)
            .then((cached) => cached ?? (html ? caches.match("./index.html") : undefined))
            .then((cached) => cached ?? offlineResponse("offline"))
        )
    );
    return;
  }

  // 아이콘처럼 내용이 바뀌지 않는 파일만 캐시부터 준다.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => keepInCache(event.request, response))
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
