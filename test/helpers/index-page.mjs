// docs/index.html의 인라인 스크립트를 가짜 DOM 위에서 실제로 돌리는 하네스.
// 렌더 함수 테스트와 계측 테스트가 같은 걸 쓰므로 여기 한 곳에 둔다.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "../..");

function stubElement() {
  const base = {
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

// analytics를 넣어주면 페이지가 실제로 계측을 부르는지까지 볼 수 있다.
// 안 넣으면 광고 차단으로 로더가 안 뜬 상황과 같아진다.
// fetch는 기본이 실패다 - 데이터 없이도 스크립트가 끝까지 도는지 보려는 하네스라서.
export async function loadIndexPage({ analytics, fetch: fetchImpl } = {}) {
  const html = await readFile(path.join(root, "docs/index.html"), "utf8");
  const script = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]).pop();
  assert.ok(script.includes("hasEnoughSample"), "렌더링 스크립트를 찾지 못했다");

  const store = {};
  const observed = [];

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
    navigator: { language: "ko" },
    location: { search: "", origin: "https://x", pathname: "/", href: "https://x/" },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    // 섹션 노출 계측이 실제로 관찰을 거는지 보고, 화면에 들어온 순간을 흉내낼 수 있게 한다.
    IntersectionObserver: class {
      constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        observed.push(this);
        this.targets = [];
      }
      observe(el) {
        this.targets.push(el);
      }
      unobserve(el) {
        this.targets = this.targets.filter((t) => t !== el);
      }
      disconnect() {
        this.targets = [];
      }
    },
    document: {
      getElementById: () => stubElement(),
      querySelectorAll: () => [],
      querySelector: () => null,
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
  new vm.Script(script, { filename: "docs/index.html:inline" }).runInContext(sandbox);

  // main()이 await로 데이터를 읽고 첫 렌더를 마칠 때까지 기다린다.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {
    app: sandbox,
    // 관찰 중인 섹션이 화면에 들어온 것처럼 만든다.
    scrollTo: (index) => {
      const observer = observed[0];
      assert.ok(observer, "섹션 관찰이 걸리지 않았다");
      const target = observer.targets[index];
      if (!target) return false;
      observer.callback([{ target, isIntersecting: true }]);
      return true;
    },
    observerCount: () => observed.length,
    observedCount: () => observed[0]?.targets.length ?? 0,
  };
}
