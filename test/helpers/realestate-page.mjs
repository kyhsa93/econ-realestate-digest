// docs/realestate.html의 인라인 스크립트를 가짜 DOM 위에서 실제로 돌리는 하네스.
// 뉴스·금리 하네스와 같은 이유로 필요하다 - 이 환경엔 브라우저가 없고, 프리렌더한
// HTML은 데이터를 받는 순간 클라이언트가 통째로 다시 그리기 때문에 "정적 HTML엔
// 있는데 화면에선 사라지는" 상태를 프리렌더 테스트만으로는 못 잡는다.
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "../..");

// 화면 코드가 이벤트 위임에서 e.target.id로 어느 입력인지 가른다. id를 안 심으면
// Proxy가 함수를 돌려줘서 비교가 조용히 실패하고, 테스트는 "아무 일도 안 일어남"만 본다.
function stubElement(attrs = {}, id = "") {
  // 리스너를 실제로 붙잡아 둬야 한다. 그냥 삼켜버리면 화면이 이벤트를 안 듣는 것과
  // 구분이 안 되고, 테스트는 "아무 일도 안 일어남"만 보게 된다.
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

// kind를 주면 거래 유형별 페이지(apartment-sale.html 등)처럼 동작한다 - 그 값은
// 화면에서 <meta name="realestate-kind">로만 들어오기 때문에 여기서도 같은 길로 넣는다.
export async function loadRealestatePage({ realestate, history, budget, budgetBand = null, kind = null, district = null, locale = "ko", search = "", analytics } = {}) {
  const html = await readFile(path.join(root, "docs/realestate.html"), "utf8");
  const script = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]).pop();

  const store = { lang: locale };
  const byId = new Map();
  const data = { realestate, "realestate-history-lite": history, "budget-deals": budget };

  function applyUrl(url) {
    const [pathname, query = ""] = String(url).split("?");
    sandbox.location.pathname = pathname;
    sandbox.location.search = query ? `?${query}` : "";
    sandbox.location.href = `https://x${pathname}${query ? `?${query}` : ""}`;
  }

  const sandbox = {
    console: { ...console, warn() {}, error() {} },
    Math, Date, JSON, Intl, URL, URLSearchParams,
    setTimeout, clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: async (url) => {
      const name = String(url).match(/\/([a-z-]+)\.json/)?.[1];
      const body = data[name];
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    },
    localStorage: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => (store[k] = String(v)),
      removeItem: (k) => delete store[k],
    },
    navigator: { language: locale },
    location: { search, origin: "https://x", pathname: "/", href: `https://x/${search}` },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    // 고른 평형을 주소에 남기는 것도 화면 동작의 일부다(그 화면을 공유할 수 있어야
    // 한다). 아무것도 안 하는 스텁으로 두면 그걸 확인할 방법이 없다.
    history: {
      pushState(_state, _title, url) {
        applyUrl(url);
      },
      replaceState(_state, _title, url) {
        applyUrl(url);
      },
    },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    document: {
      getElementById: (id) => {
        if (!byId.has(id)) byId.set(id, stubElement({}, id));
        return byId.get(id);
      },
      querySelector: (sel) => {
        if (sel.includes("realestate-kind")) return kind ? stubElement({ content: kind }) : null;
        if (sel.includes("realestate-district")) return district ? stubElement({ content: district }) : null;
        // budget-*.html은 다루는 구간을 meta로만 알려준다. 여기서도 같은 길로 넣는다.
        if (sel.includes("budget-band")) return budgetBand === null ? null : stubElement({ content: String(budgetBand) });
        if (!byId.has(sel)) byId.set(sel, stubElement());
        return byId.get(sel);
      },
      querySelectorAll: () => [],
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
  new vm.Script(script, { filename: "docs/realestate.html:inline" }).runInContext(sandbox);

  // main()이 데이터를 받아 첫 렌더를 마칠 때까지 기다린다.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {
    app: sandbox,
    sandbox,
    byId: (id) => sandbox.document.getElementById(id),
    tableHtml: () => sandbox.document.getElementById("district-grid").innerHTML,
    trendHtml: () => sandbox.document.getElementById("trend-chart").innerHTML,
    trendMeta: () => sandbox.document.getElementById("trend-meta").textContent,
    headHtml: () => sandbox.document.getElementById("district-head").innerHTML,
    overallHtml: () => sandbox.document.getElementById("overall-cards").innerHTML,
    budgetHtml: () => sandbox.document.getElementById("budget-result").innerHTML,
  };
}
