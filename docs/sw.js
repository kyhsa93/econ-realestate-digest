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

// 데이터 요청은 클라이언트가 ?_=타임스탬프를 붙여 브라우저 캐시를 피한다. 그 주소를
// 그대로 캐시 키로 쓰면 매번 다른 키가 되어 캐시에 영영 걸리지 않는다 - 네트워크가
// 끊기면 캐시가 있어도 폴백이 안 됐다. 쿼리를 떼고 저장하고 찾는다.
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
              // 캐시도 없으면 응답을 안 주는 대신 실패를 분명히 알린다. 예전엔 undefined를
              // 돌려줘서 페이지가 알 수 없는 오류로 죽었다.
              cached ?? new Response("", { status: 503, statusText: "offline, no cached data" })
          )
        )
    );
    return;
  }

  // 페이지는 매일 내용이 바뀌므로 네트워크를 먼저 본다. 캐시를 먼저 주면 배포한 지
  // 한참 지나도 예전 화면이 남는다. 네트워크가 안 되면 캐시로 떨어진다.
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

  // 나머지 정적 파일(아이콘·스크립트)은 거의 안 바뀌므로 캐시를 먼저 주고 뒤에서 갱신한다.
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
