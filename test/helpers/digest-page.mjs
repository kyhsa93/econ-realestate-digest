import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "../..");

export const settle = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

export function stubElement(attrs = {}, id = "") {
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

/**
 * 다이제스트의 화면 하나를 브라우저인 척하는 자리에 올려 돌린다.
 *
 * 화면마다 사전과 그리는 것이 다르지만 올리는 방법은 같다 - 인라인 스크립트를 꺼내
 * 가짜 document와 fetch 위에서 실행하는 것. 그 같은 부분만 여기 둔다.
 */
export async function loadPage({ file, data = {}, subNav = [], status = 404, locale = "ko", query = "", analytics } = {}) {
  const html = await readFile(path.join(root, "docs", file), "utf8");
  const script = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]).pop();

  const store = { lang: locale };
  const byId = new Map();
  const navLinks = subNav.map((page) => stubElement({ "data-re-page": page }));

  function applyUrl(url) {
    const [pathname, q = ""] = String(url).split("?");
    sandbox.location.pathname = pathname;
    sandbox.location.search = q ? `?${q}` : "";
    sandbox.location.href = `https://x${pathname}${q ? `?${q}` : ""}`;
  }

  const sandbox = {
    console: { ...console, warn() {}, error() {} },
    Math, Date, JSON, Intl, URL, URLSearchParams, Promise, Number, String, Object, Array, Set, Map,
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
    location: { search: query, origin: "https://x", pathname: `/${file}`, href: `https://x/${file}${query}` },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
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
  new vm.Script(script, { filename: `docs/${file}:inline` }).runInContext(sandbox);

  await settle();

  return {
    sandbox,
    navLinks,
    settle,
    byId: (id) => sandbox.document.getElementById(id),
    text: (id) => sandbox.document.getElementById(id).textContent,
    html: (id) => sandbox.document.getElementById(id).innerHTML,
    search: () => sandbox.location.search,
    click: async (id) => {
      sandbox.document.getElementById(id).dispatch("click");
      await settle();
    },
  };
}
