(function () {
  const GA_MEASUREMENT_ID = "G-Z1LH7S1ZE5";
  const ADSENSE_CLIENT_ID = "ca-pub-1195159445218373";
  const PAGE_VIEW_FALLBACK_MS = 4000;
  const SEARCH_DEBOUNCE_MS = 800;

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;

  gtag("js", new Date());

  const debugMode = new URLSearchParams(location.search ?? "").has("ga_debug");
  const siteGroup = document.querySelector('meta[name="site-group"]')?.getAttribute("content");

  gtag("config", GA_MEASUREMENT_ID, {
    send_page_view: false,
    ...(siteGroup ? { content_group: siteGroup } : {}),
    ...(debugMode ? { debug_mode: true } : {}),
  });

  let pageViewSent = false;

  function pageView(params) {
    if (pageViewSent) return;
    pageViewSent = true;
    gtag("event", "page_view", {
      page_title: document.title,
      page_location: location.href,
      ...params,
    });
  }

  function event(name, params) {
    gtag("event", name, params ?? {});
  }

  const debounceTimers = {};
  function debouncedEvent(name, params, delay) {
    clearTimeout(debounceTimers[name]);
    debounceTimers[name] = setTimeout(() => event(name, params), delay ?? SEARCH_DEBOUNCE_MS);
  }

  window.analytics = { pageView, event, debouncedEvent };

  setTimeout(() => pageView(), PAGE_VIEW_FALLBACK_MS);

  const gaScript = document.createElement("script");
  gaScript.async = true;
  gaScript.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(gaScript);

  const adScript = document.createElement("script");
  adScript.async = true;
  adScript.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT_ID}`;
  adScript.crossOrigin = "anonymous";
  document.head.appendChild(adScript);
})();
