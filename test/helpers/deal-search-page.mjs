// docs/deal-search.html의 인라인 스크립트를 가짜 DOM 위에서 실제로 돌리는 하네스.
// 시세·뉴스·금리 하네스와 같은 이유로 필요하다 - 이 환경엔 브라우저가 없고, 이 화면은
// 정적 HTML에 결과가 없는(조건을 고른 뒤에야 그려지는) 페이지라 HTML만 읽어서는
// 무엇이 나오는지 알 수 없다.
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "../..");

// 화면 코드가 이벤트 위임에서 e.target.id로 어느 select인지 가른다. id를 안 심으면
// Proxy가 함수를 돌려줘서 비교가 조용히 실패하고, 테스트는 "아무 일도 안 일어남"만 본다.
function stubElement(attrs = {}, id = "") {
  const listeners = {};
  const base = {
    id,
    listeners,
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener() {},
    dispatch(type, extra = {}) {
      for (const fn of listeners[type] ?? []) fn({ target: this, ...extra });
    },
    textContent: "",
    innerHTML: "",
    value: "",
    hidden: false,
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    getAttribute: (name) => attrs[name] ?? null,
    setAttribute() {},
  };
  return new Proxy(base, {
    get: (t, p) => (p in t ? t[p] : typeof p === "symbol" ? undefined : () => {}),
    set: (t, p, v) => ((t[p] = v), true),
  });
}

// status로 응답 코드를 바꿀 수 있게 열어 둔다. "파일이 아직 없다(404)"와 "못 받았다"는
// 화면에서 다르게 말해야 하는 상태라, 하나로 뭉뚱그리면 그 차이를 볼 방법이 없다.
export async function loadDealSearchPage({ budget, search, status = 404, locale = "ko", query = "", analytics } = {}) {
  const html = await readFile(path.join(root, "docs/deal-search.html"), "utf8");
  const script = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]).pop();

  const store = { lang: locale };
  const byId = new Map();
  const data = { "budget-deals": budget, "deal-search": search };

  // 2층 내비게이션은 화면이 언어에 맞춰 글자를 갈아 끼운다. 빈 배열로 두면 그 코드가
  // 도는지 확인할 방법이 없다.
  const navLinks = ["all", "sale", "jeonse", "wolse", "search"].map((page) =>
    stubElement({ "data-re-page": page })
  );

  function applyUrl(url) {
    const [pathname, q = ""] = String(url).split("?");
    sandbox.location.pathname = pathname;
    sandbox.location.search = q ? `?${q}` : "";
    sandbox.location.href = `https://x${pathname}${q ? `?${q}` : ""}`;
  }

  const sandbox = {
    console: { ...console, warn() {}, error() {} },
    Math, Date, JSON, Intl, URL, URLSearchParams, Promise,
    setTimeout, clearTimeout,
    fetch: async (url) => {
      const name = String(url).match(/\/([a-z-]+)\.json/)?.[1];
      const body = data[name];
      if (!body) return { ok: false, status, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    },
    localStorage: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => (store[k] = String(v)),
      removeItem: (k) => delete store[k],
    },
    navigator: { language: locale },
    location: { search: query, origin: "https://x", pathname: "/deal-search.html", href: `https://x/deal-search.html${query}` },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    // 고른 조건을 주소에 남기는 것도 화면 동작의 일부다 - "노원구 8억대"를 그대로
    // 보낼 수 있어야 검색 화면이다.
    history: {
      pushState(_state, _title, url) {
        applyUrl(url);
      },
      replaceState(_state, _title, url) {
        applyUrl(url);
      },
    },
    document: {
      getElementById: (id) => {
        if (!byId.has(id)) byId.set(id, stubElement({}, id));
        return byId.get(id);
      },
      querySelector: (sel) => {
        if (!byId.has(sel)) byId.set(sel, stubElement());
        return byId.get(sel);
      },
      querySelectorAll: (sel) => (sel === "[data-re-page]" ? navLinks : []),
      createElement: () => stubElement(),
      addEventListener() {},
      documentElement: stubElement(),
      body: stubElement(),
      head: stubElement(),
      title: "",
    },
  };
  if (analytics) sandbox.analytics = analytics;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  new vm.Script(script, { filename: "docs/deal-search.html:inline" }).runInContext(sandbox);

  // main()이 두 파일을 받아 첫 렌더를 마칠 때까지 기다린다.
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));

  const select = (id, value) => {
    const el = sandbox.document.getElementById(id);
    el.value = value;
    sandbox.document.getElementById("search-controls").dispatch("change", { target: el });
  };

  return {
    sandbox,
    navLinks,
    byId: (id) => sandbox.document.getElementById(id),
    resultHtml: () => sandbox.document.getElementById("search-result").innerHTML,
    districtOptions: () => sandbox.document.getElementById("district-select").innerHTML,
    budgetOptions: () => sandbox.document.getElementById("budget-select").innerHTML,
    chooseDistrict: (value) => select("district-select", value),
    chooseBudget: (value) => select("budget-select", value),
  };
}
