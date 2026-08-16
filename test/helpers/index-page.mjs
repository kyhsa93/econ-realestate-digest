// docs/index.html의 인라인 스크립트를 가짜 DOM 위에서 실제로 돌리는 하네스.
// 렌더 함수 테스트와 계측 테스트가 같은 걸 쓰므로 여기 한 곳에 둔다.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "../..");

function stubElement() {
  // 리스너를 실제로 붙잡아 둬야 한다. Proxy가 삼켜버리면 화면이 이벤트를 안 듣는
  // 것과 구분이 안 되고, 테스트는 "아무 일도 안 일어남"만 보게 된다.
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

// analytics를 넣어주면 페이지가 실제로 계측을 부르는지까지 볼 수 있다.
// 안 넣으면 광고 차단으로 로더가 안 뜬 상황과 같아진다.
// fetch는 기본이 실패다 - 데이터 없이도 스크립트가 끝까지 도는지 보려는 하네스라서.
// storage로 언어·테마 같은 저장된 설정을 미리 심을 수 있다. 언어는 주소가 아니라
// localStorage에서 오기 때문에, 이게 없으면 영어 화면을 테스트할 방법이 없다.
export async function loadIndexPage({ analytics, fetch: fetchImpl, search = "", serviceWorker, storage } = {}) {
  const html = await readFile(path.join(root, "docs/index.html"), "utf8");
  const script = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]).pop();
  assert.ok(script.includes("hasEnoughSample"), "렌더링 스크립트를 찾지 못했다");

  const store = { ...storage };
  const observed = [];
  const byId = new Map();

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
    location: { search, origin: "https://x", pathname: "/", href: "https://x/" },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    // 페이지가 popstate를 듣고 주소로 상태를 되돌린다. window 쪽 API가 없으면 로드 자체가 죽는다.
    addEventListener() {},
    removeEventListener() {},
    history: { pushState() {}, replaceState() {} },
    // 섹션 노출 계측이 실제로 관찰을 거는지 보고, 화면에 들어온 순간을 흉내낼 수 있게 한다.
    IntersectionObserver: class {
      constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        observed.push(this);
        // 관찰을 끊은 뒤에도 브라우저는 콜백을 부르지 않는다. 그 동작을 그대로
        // 흉내내야 "한 번만 센다"가 코드 덕분인지 하네스 덕분인지 구분된다.
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
      // 같은 id는 같은 노드를 돌려줘야 렌더 결과를 읽어볼 수 있다.
      getElementById: (id) => {
        if (!byId.has(id)) byId.set(id, stubElement());
        return byId.get(id);
      },
      // "#realestate-grid tr[data-district-name]" 같은 셀렉터를 실제로 답한다.
      // 빈 배열만 돌려주면 화면이 행을 감추는 코드(지역 검색, 상위 N개 제한)가
      // 통째로 안 돌고, 그 상태가 "기능이 없는 것"과 구분되지 않은 채 통과한다.
      querySelectorAll: (sel) => {
        const m = /^#([\w-]+) tr\[data-([\w-]+)\]$/.exec(String(sel));
        if (!m) return [];
        const parent = byId.get(m[1]);
        if (!parent) return [];

        const html = String(parent.innerHTML ?? "");
        // innerHTML이 그대로면 같은 노드를 돌려줘야 hidden 같은 상태가 유지된다.
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
      // 실제 문서엔 있는 요소들이라, null을 주면 페이지가 로드 도중 죽어버려서
      // 정작 보려던 렌더 동작에 닿지 못한다(금리 하네스와 같은 이유).
      querySelector: (sel) => {
        if (!byId.has(sel)) byId.set(sel, stubElement());
        return byId.get(sel);
      },
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
  // 스크립트 최상위의 const는 컨텍스트 밖에서 못 보므로 cache만 따로 내보낸다.
  new vm.Script(script + "\nglobalThis.__cache = cache; globalThis.__realestateSort = realestateSort; globalThis.__newsState = () => ({ cat: newsCategoryFilter, q: newsQuery });", { filename: "docs/index.html:inline" }).runInContext(sandbox);

  // main()이 await로 데이터를 읽고 첫 렌더를 마칠 때까지 기다린다.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {
    app: sandbox,
    byId: (id) => sandbox.document.getElementById(id),
    // 관찰 중인 섹션이 화면에 들어온 것처럼 만든다.
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
