import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "../..");

function makeDom(html = "") {
  const byId = new Map();

  function makeNode(id) {
    const node = {
      id,
      children: [],
      listeners: {},
      dataset: {},
      textContent: "",
      value: "",
      style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener(type, fn) {
        (this.listeners[type] ||= []).push(fn);
      },
      removeEventListener() {},
      setAttribute() {},
      removeAttribute() {},
      getAttribute: () => null,
      appendChild(child) {
        this.children.push(child);
      },
      closest(sel) {
        const key = /\[data-([a-z]+)\]/.exec(sel)?.[1];
        return key && this.dataset[key] !== undefined ? this : null;
      },
      querySelectorAll: (sel) => collect(node, sel),
      querySelector: (sel) => collect(node, sel)[0] ?? null,
      focus() {},
      getBoundingClientRect: () => ({ width: 600, height: 300, top: 0, left: 0 }),
      dispatch(type, extra = {}) {
        for (const fn of this.listeners[type] ?? []) fn({ target: this, ...extra });
      },
      get innerHTML() {
        return this._html ?? "";
      },
      set innerHTML(html) {
        this._html = html;
        this.children = [...String(html).matchAll(/data-(category|detail|sort)="([^"]*)"/g)].map((m) => {
          const child = makeNode(`${this.id}>${m[2]}`);
          child.dataset[m[1]] = m[2];
          return child;
        });
      },
    };
    return node;
  }

  function collect(node, sel) {
    const key = /\[data-([a-z]+)\]/.exec(sel)?.[1] ?? null;
    const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        if (!key || c.dataset[key] !== undefined) out.push(c);
        walk(c);
      }
    };
    if (node) walk(node);
    return out;
  }

  const document = {
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, makeNode(id));
      return byId.get(id);
    },
    querySelectorAll(sel) {
      const all = [];
      for (const node of byId.values()) all.push(...collect(node, sel));
      return all;
    },
    querySelector(sel) {
      if (!byId.has(sel)) {
        const node = makeNode(sel);
        if (sel === 'meta[name="rates-category"]') {
          const value = /<meta name="rates-category" content="([^"]*)"/.exec(html)?.[1] ?? null;
          node.getAttribute = (name) => (name === "content" ? value : null);
        }
        byId.set(sel, node);
      }
      return byId.get(sel);
    },
    createElement: (tag) => makeNode(tag),
    createTextNode: () => makeNode("#text"),
    addEventListener() {},
    documentElement: makeNode("html"),
    body: makeNode("body"),
    head: makeNode("head"),
    title: "",
  };
  return { document, byId };
}

export async function loadRatesPage({
  analytics,
  fetch: fetchImpl,
  file = "docs/rates.html",
  search = "",
  rates: ratesOverride,
} = {}) {
  const html = await readFile(path.join(root, file), "utf8");
  const script = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]).pop();
  assert.ok(script.includes("CATEGORY_KEYS"), "금리 페이지 스크립트를 찾지 못했다");

  const rates =
    ratesOverride ?? JSON.parse(await readFile(path.join(root, "docs/data/rates.json"), "utf8"));
  const history = JSON.parse(await readFile(path.join(root, "docs/data/rates-history.json"), "utf8"));
  const { document, byId } = makeDom(html);
  const store = {};

  const pushed = [];
  const replaced = [];
  function applyUrl(url) {
    const [pathname, query = ""] = String(url).split("?");
    sandbox.location.pathname = pathname;
    sandbox.location.search = query ? `?${query}` : "";
    sandbox.location.href = `https://x${pathname}${query ? `?${query}` : ""}`;
  }

  const sandbox = {
    console: { ...console, warn() {}, error() {} },
    Math, Date, JSON, Intl, URL, URLSearchParams,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    fetch:
      fetchImpl ??
      (async (url) => ({
        ok: true,
        json: async () => (String(url).includes("rates-history") ? history : rates),
      })),
    localStorage: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => (store[k] = String(v)),
      removeItem: (k) => delete store[k],
    },
    navigator: { language: "ko" },
    location: { search, origin: "https://x", pathname: "/", href: `https://x/${search}` },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_state, _title, url) {
        pushed.push(url);
        applyUrl(url);
      },
      replaceState(_state, _title, url) {
        replaced.push(url);
        applyUrl(url);
      },
    },
    document,
  };
  if (analytics) sandbox.analytics = analytics;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  new vm.Script(script + "\nglobalThis.__state = state;", { filename: "docs/rates.html:inline" }).runInContext(sandbox);

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const clickTab = (category) => {
    const tabs = byId.get("tabs");
    const tab = tabs.children.find((c) => c.dataset.category === category);
    assert.ok(tab, `${category} 탭이 없다`);
    if ((tab.listeners.click ?? []).length > 0) tab.dispatch("click");
    else for (const fn of tabs.listeners.click ?? []) fn({ target: tab });
  };

  const clickSortHeader = (key) => {
    const head = byId.get("products-head");
    const button = head.children.find((c) => c.dataset.sort === key);
    assert.ok(button, `${key} 정렬 머리글이 없다`);
    if ((button.listeners.click ?? []).length > 0) button.dispatch("click");
    else for (const fn of head.listeners.click ?? []) fn({ target: button });
  };

  return { sandbox, byId, clickTab, clickSortHeader, rates, state: sandbox.__state, pushed, replaced };
}
