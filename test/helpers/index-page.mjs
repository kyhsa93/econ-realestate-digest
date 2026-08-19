import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "../..");

function stubElement() {
  const listeners = {};
  const base = {
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
  };
  return new Proxy(base, {
    get: (t, p) => (p in t ? t[p] : typeof p === "symbol" ? undefined : () => {}),
    set: (t, p, v) => ((t[p] = v), true),
  });
}

export async function loadIndexPage({ analytics, fetch: fetchImpl, search = "", serviceWorker, storage } = {}) {
  const html = await readFile(path.join(root, "docs/index.html"), "utf8");
  const script = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]).pop();
  assert.ok(script.includes("hasEnoughSample"), "렌더링 스크립트를 찾지 못했다");

  const store = { ...storage };
  const observed = [];
  const byId = new Map();
  const listeners = { window: {}, document: {} };
  const reloads = [];

  const listen = (where) => (type, fn) => (listeners[where][type] ||= []).push(fn);
  const fire = (where, type, event = {}) => {
    for (const fn of listeners[where][type] ?? []) fn(event);
  };

  const sandbox = {
    console: { ...console, warn() {}, error() {} },
    Math, Date, JSON, Intl, URL, URLSearchParams,
    setTimeout, clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: fetchImpl ?? (async () => ({ ok: false, json: async () => ({}) })),
    localStorage: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => (store[k] = String(v)),
      removeItem: (k) => delete store[k],
    },
    navigator: { language: "ko", ...(serviceWorker ? { serviceWorker } : {}) },
    location: {
      search,
      origin: "https://x",
      pathname: "/",
      href: "https://x/",
      reload: () => reloads.push(true),
    },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener: listen("window"),
    removeEventListener() {},
    history: { pushState() {}, replaceState() {} },
    IntersectionObserver: class {
      constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        observed.push(this);
        this.targets = [];
        this.active = new Set();
      }
      observe(el) {
        this.targets.push(el);
        this.active.add(el);
      }
      unobserve(el) {
        this.active.delete(el);
      }
      disconnect() {
        this.active.clear();
      }
    },
    document: {
      getElementById: (id) => {
        if (!byId.has(id)) byId.set(id, stubElement());
        return byId.get(id);
      },
      querySelectorAll: (sel) => {
        const m = /^#([\w-]+) tr\[data-([\w-]+)\]$/.exec(String(sel));
        if (!m) return [];
        const parent = byId.get(m[1]);
        if (!parent) return [];

        const html = String(parent.innerHTML ?? "");
        if (parent._rowsHtml !== html) {
          const attr = `data-${m[2]}`;
          const re = new RegExp(`<tr[^>]*${attr}="([^"]*)"`, "g");
          parent._rowsHtml = html;
          parent._rows = [...html.matchAll(re)].map(([, value]) => {
            const row = stubElement();
            row.getAttribute = (name) => (name === attr ? value : null);
            return row;
          });
        }
        return parent._rows;
      },
      querySelector: (sel) => {
        if (!byId.has(sel)) byId.set(sel, stubElement());
        return byId.get(sel);
      },
      createElement: () => stubElement(),
      addEventListener: listen("document"),
      visibilityState: "visible",
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
  new vm.Script(script + "\nglobalThis.__cache = cache; globalThis.__realestateSort = realestateSort; globalThis.__newsState = () => ({ cat: newsCategoryFilter, q: newsQuery });", { filename: "docs/index.html:inline" }).runInContext(sandbox);

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {
    app: sandbox,
    fire,
    reloads: () => reloads.length,
    byId: (id) => sandbox.document.getElementById(id),
    scrollTo: (index) => {
      const observer = observed[0];
      assert.ok(observer, "섹션 관찰이 걸리지 않았다");
      const target = observer.targets[index];
      if (!target || !observer.active.has(target)) return false;
      observer.callback([{ target, isIntersecting: true }]);
      return true;
    },
    observer: () => {
      assert.ok(observed[0], "섹션 관찰이 걸리지 않았다");
      return observed[0];
    },
    observerCount: () => observed.length,
    observedCount: () => observed[0]?.targets.length ?? 0,
  };
}
