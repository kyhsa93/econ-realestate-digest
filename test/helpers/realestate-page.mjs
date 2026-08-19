import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "../..");

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

export async function loadRealestatePage({ realestate, trend, budget, budgetBand = null, kind = null, district = null, locale = "ko", search = "", analytics } = {}) {
  const html = await readFile(path.join(root, "docs/realestate.html"), "utf8");
  const script = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]).pop();

  const store = { lang: locale };
  const byId = new Map();
  const data = { realestate, "realestate-trend": trend, "budget-deals": budget };

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

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {
    app: sandbox,
    sandbox,
    byId: (id) => sandbox.document.getElementById(id),
    tableHtml: () => sandbox.document.getElementById("district-grid").innerHTML,
    trendHtml: () => sandbox.document.getElementById("trend-chart").innerHTML,
    trendMeta: () => sandbox.document.getElementById("trend-meta").textContent,
    volumeHtml: () => sandbox.document.getElementById("volume-chart").innerHTML,
    ratioHtml: () => sandbox.document.getElementById("ratio-chart").innerHTML,
    cardLabel: (prefix) => sandbox.document.getElementById(`${prefix}-label`).textContent,
    cardCurrent: (prefix) => sandbox.document.getElementById(`${prefix}-current`).textContent,
    cardMinMax: (prefix) => sandbox.document.getElementById(`${prefix}-minmax`).textContent,
    cardHidden: (id) => sandbox.document.getElementById(id).hidden,
    headHtml: () => sandbox.document.getElementById("district-head").innerHTML,
    overallHtml: () => sandbox.document.getElementById("overall-cards").innerHTML,
    budgetHtml: () => sandbox.document.getElementById("budget-result").innerHTML,
  };
}
