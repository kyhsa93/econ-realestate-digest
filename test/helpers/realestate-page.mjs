import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "../..");

/**
 * 그래프 폭. 실제 화면에서 재는 값을 대신한다.
 *
 * 손이 어느 주 위에 있는지는 `(clientX - rect.left) / rect.width`로 정하므로, 이 숫자가
 * 있어야 포인터 경로가 돌아간다. 없으면 `rect.width`에서 멈춘다.
 */
const CHART_WIDTH = 300;

function stubElement(attrs = {}, id = "", shared = null) {
  const listeners = {};
  // 안쪽 요소들. svg는 그래프 칸과 같은 주머니를 쓴다 — 실제 DOM에서 `#trend-chart .marker`
  // 와 `#trend-chart svg`의 `.marker`는 같은 하나이기 때문이다. 따로 두면 마커를 찍는
  // 경로와 지우는 경로가 서로 다른 것을 만지게 되고, 검사만 통과하고 화면은 안 지워진다.
  const children = shared ?? new Map();
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
    offsetWidth: 110,
    style: {},
    dataset: {},
    attrs,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    getAttribute: (name) => attrs[name] ?? null,
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    removeAttribute(name) {
      delete attrs[name];
    },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: CHART_WIDTH,
      height: 120,
      right: CHART_WIDTH,
      bottom: 120,
    }),
    // 마커처럼 그래프 안쪽에서 찾는 것들. 같은 선택자는 같은 것을 돌려줘야 검사에서
    // 좌표를 읽을 수 있다.
    querySelector(sel) {
      if (!children.has(sel)) {
        // 마커는 마크업에서 `hidden`으로 태어난다. 스텁도 그래야 "한 번도 안 찍힌 것"과
        // "찍혔다 지워진 것"이 같게 보인다.
        const born = sel === ".marker" ? { hidden: "hidden" } : {};
        children.set(sel, stubElement(born, `${id}${sel}`, sel === "svg" ? children : null));
      }
      return children.get(sel);
    },
    querySelectorAll: () => [],
    closest: () => null,
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
  // 추이 격자 하나. 이 화면의 그래프는 전부 여기 들어 있고, 서로 같은 주를 x축으로 쓴다.
  const CHART_PREFIXES = ["trend", "rent", "volume", "ratio"];
  const grid = stubElement({}, "history-grid");
  grid.querySelectorAll = (sel) =>
    sel === ".history-chart"
      ? CHART_PREFIXES.map((prefix) => sandbox.document.getElementById(`${prefix}-chart`))
      : [];
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
        if (!byId.has(id)) {
          const el = stubElement({}, id);
          // 그래프는 자기 카드 안에 있고, 카드는 모두 한 격자 안에 있다. 같은 축을
          // 쓰는 그래프를 찾는 코드가 이 두 관계를 타고 올라간다.
          const chart = /^(.+)-chart$/.exec(id);
          if (chart) {
            el.closest = (sel) =>
              sel === ".history-card"
                ? sandbox.document.getElementById(`${chart[1]}-card`)
                : sel === ".history-grid"
                  ? grid
                  : null;
          }
          byId.set(id, el);
        }
        return byId.get(id);
      },
      querySelector: (sel) => {
        if (sel.includes("realestate-kind")) return kind ? stubElement({ content: kind }) : null;
        if (sel.includes("realestate-district")) return district ? stubElement({ content: district }) : null;
        if (sel.includes("budget-band")) return budgetBand === null ? null : stubElement({ content: String(budgetBand) });
        // "#trend-chart svg", "#trend-chart .marker" 처럼 한 요소 안쪽을 가리키는 것은
        // 그 요소에게 넘긴다. 그래야 검사가 마커에 찍힌 좌표를 같은 경로로 되읽는다.
        const inside = /^#([a-zA-Z0-9_-]+)\s+(.+)$/.exec(sel);
        if (inside) return sandbox.document.getElementById(inside[1]).querySelector(inside[2]);
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
    tipHtml: () => sandbox.document.getElementById("chart-tip").innerHTML,
    tipHidden: () => sandbox.document.getElementById("chart-tip").hidden,
    /** 그래프 위 어느 지점을 짚는다. 0이 왼쪽 끝, 1이 오른쪽 끝. */
    pointAt: (prefix, ratio) => {
      const holder = sandbox.document.getElementById(`${prefix}-chart`);
      sandbox.document.getElementById("trend-section").dispatch("click", {
        target: { ...holder, closest: (sel) => (sel === ".history-chart" ? holder : null) },
        clientX: ratio * CHART_WIDTH,
        clientY: 100,
      });
    },
    /** 그 그래프의 마커가 지금 어디에 찍혀 있나. 숨었으면 null. */
    marker: (prefix) => {
      const svg = sandbox.document.getElementById(`${prefix}-chart`).querySelector("svg");
      const marker = svg.querySelector(".marker");
      if (marker.getAttribute("hidden") !== null) return null;
      return {
        x: Number(marker.querySelector(".marker-dot").getAttribute("cx")),
        y: Number(marker.querySelector(".marker-dot").getAttribute("cy")),
      };
    },
  };
}
