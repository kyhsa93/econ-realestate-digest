// docs/news.html의 인라인 스크립트를 가짜 DOM 위에서 실제로 돌리는 하네스.
// index.html 하네스와 같은 이유로 필요하다 - 이 환경엔 브라우저가 없고, 프리렌더한
// HTML은 데이터를 받는 순간 클라이언트가 통째로 다시 그리기 때문에 "정적 HTML엔
// 있는데 화면에선 사라지는" 상태를 프리렌더 테스트만으로는 못 잡는다.
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "../..");

function stubElement(attrs = {}) {
  const base = {
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

// category를 주면 카테고리 페이지(realestate-news.html 등)처럼 동작한다 - 그 값은
// 화면에서 <meta name="news-category">로만 들어오기 때문에 여기서도 같은 길로 넣는다.
export async function loadNewsPage({ news, summary, category = null, locale = "ko", analytics } = {}) {
  const html = await readFile(path.join(root, "docs/news.html"), "utf8");
  const script = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]).pop();

  const store = { lang: locale };
  const byId = new Map();
  const data = { news, summary };

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
    location: { search: "", origin: "https://x", pathname: "/", href: "https://x/" },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    history: { pushState() {}, replaceState() {} },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    document: {
      getElementById: (id) => {
        if (!byId.has(id)) byId.set(id, stubElement());
        return byId.get(id);
      },
      querySelector: (sel) => {
        if (sel.includes("news-category")) return category ? stubElement({ content: category }) : null;
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
  new vm.Script(script, { filename: "docs/news.html:inline" }).runInContext(sandbox);

  // main()이 데이터를 받아 첫 렌더를 마칠 때까지 기다린다.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {
    app: sandbox,
    byId: (id) => sandbox.document.getElementById(id),
    newsListHtml: () => sandbox.document.getElementById("news-list").innerHTML,
  };
}
