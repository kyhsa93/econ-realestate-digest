// docs/rates.html의 스크립트를 가짜 DOM 위에서 실제로 돌리는 하네스.
// 탭과 정렬 테스트가 같은 걸 쓰므로 여기 한 곳에 둔다.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "../..");

// innerHTML로 갈아끼워지는 요소를 흉내내야 한다. 탭이 안 먹는 건 렌더 자체가
// 틀려서가 아니라 다시 그릴 때 요소가 통째로 새로 생기면서 붙어 있던 클릭
// 리스너가 같이 사라지기 때문이라, 그 교체를 재현하지 않으면 아무 문제도 안 보인다.
function makeDom() {
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
      // 새 마크업이 들어오면 기존 자식(과 그 리스너)은 버려진다. 실제 브라우저와 같다.
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
    // renderMeta가 <meta>/<link> 같은 걸 셀렉터로 찾아 고친다. 없다고 하면
    // 첫 렌더에서 죽어서 정작 보려던 탭 동작에 닿지 못한다.
    querySelector(sel) {
      if (!byId.has(sel)) byId.set(sel, makeNode(sel));
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

export async function loadRatesPage() {
  const html = await readFile(path.join(root, "docs/rates.html"), "utf8");
  const script = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]).pop();
  assert.ok(script.includes("CATEGORY_KEYS"), "금리 페이지 스크립트를 찾지 못했다");

  const rates = JSON.parse(await readFile(path.join(root, "docs/data/rates.json"), "utf8"));
  const history = JSON.parse(await readFile(path.join(root, "docs/data/rates-history.json"), "utf8"));
  const { document, byId } = makeDom();
  const store = {};

  const sandbox = {
    console: { ...console, warn() {}, error() {} },
    Math, Date, JSON, Intl, URL, URLSearchParams,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    fetch: async (url) => ({
      ok: true,
      json: async () => (String(url).includes("rates-history") ? history : rates),
    }),
    localStorage: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => (store[k] = String(v)),
      removeItem: (k) => delete store[k],
    },
    navigator: { language: "ko" },
    location: { search: "", origin: "https://x", pathname: "/", href: "https://x/" },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    document,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
    // 스크립트 최상위의 const는 컨텍스트 밖에서 못 보므로 state만 따로 내보낸다.
  new vm.Script(script + "\nglobalThis.__state = state;", { filename: "docs/rates.html:inline" }).runInContext(sandbox);

  // main()이 await로 데이터를 읽고 첫 렌더를 마칠 때까지 기다린다.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const clickTab = (category) => {
    const tabs = byId.get("tabs");
    const tab = tabs.children.find((c) => c.dataset.category === category);
    assert.ok(tab, `${category} 탭이 없다`);
    // 위임이든 개별 부착이든 실제 클릭과 같은 경로를 타게 한다.
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

  return { sandbox, byId, clickTab, clickSortHeader, rates, state: sandbox.__state };
}
