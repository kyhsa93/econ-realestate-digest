const CACHE_NAME = "econ-digest-v5";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

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

  // 이 오프라인 지원은 이 사이트 자체의 셸/데이터에만 해당한다. 실시간 환율
  // API, GA/애드센스 스크립트 같은 크로스 오리진 요청까지 캐시 우선으로
  // 가로채면 "실시간" 값이 오래된 캐시로 나오거나 분석/광고 스크립트가 낡은
  // 버전으로 고정될 수 있어서, 이 오리진이 아니면 그냥 브라우저 기본 동작에 맡긴다.
  if (url.origin !== location.origin) return;

  // 데이터 파일(docs/data/*.json)은 매일 갱신되는 게 이 사이트의 핵심이라
  // 신선도가 오프라인 지원보다 중요함 -> 네트워크 우선, 실패 시에만 캐시로 폴백.
  if (url.pathname.includes("/data/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 앱 셸(HTML/CSS/JS/아이콘)은 캐시 우선 + 백그라운드 갱신(stale-while-revalidate)
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
