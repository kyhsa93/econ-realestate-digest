// docs/index.html의 렌더링 스크립트를 떼어내 가짜 DOM 위에서 돌린다.
//
// 표본이 한두 건인 구의 평당가는 "그 구의 시세"가 아니라 "그 아파트 한 채의 가격"인데,
// 화면에서는 거래가 많은 구의 평균과 똑같이 생겼다. 틀린 티가 안 나는 종류라서
// 임계값 동작을 여기에 고정해둔다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");

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

async function loadRenderer() {
  const html = await readFile(path.join(root, "docs/index.html"), "utf8");
  const script = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]).pop();
  assert.ok(script.includes("hasEnoughSample"), "렌더링 스크립트를 찾지 못했다");

  const store = {};
  const sandbox = {
    console: { ...console, warn() {}, error() {} },
    Math, Date, JSON, Intl, URL, URLSearchParams,
    setTimeout, clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    localStorage: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => (store[k] = String(v)),
      removeItem: (k) => delete store[k],
    },
    navigator: { language: "ko" },
    location: { search: "", origin: "https://x", pathname: "/", href: "https://x/" },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
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
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  new vm.Script(script, { filename: "docs/index.html:inline" }).runInContext(sandbox);
  return sandbox;
}

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const saleOf = (transactionCount) => ({
  avgPricePerM2: 13619744,
  avgPricePerPyeong10k: 4502,
  transactionCount,
  change: { value10k: 506, percent: 19.5 },
  baselineDate: "2026-08-10",
});

test("신고 5건 미만이면 평당가 대신 표본 수를 보여준다", async () => {
  const app = await loadRenderer();
  for (const n of [0, 1, 2, 3, 4]) {
    const cell = text(app.realestateSaleCellHtml(saleOf(n)));
    assert.ok(!cell.includes("4,502"), `n=${n}인데 값이 보인다: ${cell}`);
    // 증감률도 같이 감춰야 한다 -- 한두 건으로 낸 주간 증감은 더 흔들린다.
    assert.ok(!cell.includes("19"), `n=${n}인데 증감이 보인다: ${cell}`);
    assert.ok(cell.includes(String(n)), cell);
  }
});

test("5건부터는 평당가를 그대로 보여준다", async () => {
  const app = await loadRenderer();
  for (const n of [5, 12, 400]) {
    const cell = text(app.realestateSaleCellHtml(saleOf(n)));
    assert.ok(cell.includes("4,502"), `n=${n}인데 값이 안 보인다: ${cell}`);
  }
});

test("표본이 부족한 구는 평당가 순위에서 빠진다", async () => {
  const app = await loadRenderer();
  // 값을 감춰놓고 순위는 그대로 두면, 비싼 한 건이 잡힌 구가 화면 맨 위에 그대로 남는다.
  const expensive = { name: "표본1건구", sale: saleOf(1) };
  const ordinary = { name: "보통구", sale: { ...saleOf(30), avgPricePerPyeong10k: 3000 } };
  assert.ok(app.realestateSortValue(ordinary) > app.realestateSortValue(expensive));
  assert.equal(app.realestateSortValue(expensive), 0);
});

test("매매 표본이 부족해도 전세 표본이 충분하면 전세로 줄을 세운다", async () => {
  const app = await loadRenderer();
  const entry = {
    name: "구",
    sale: saleOf(2),
    jeonse: { avgDepositPerPyeong10k: 3092, transactionCount: 40 },
  };
  assert.equal(app.realestateSortValue(entry), 3092);
});

test("거래 건수를 모르는 과거 기록은 부족하다고 단정하지 않는다", async () => {
  const app = await loadRenderer();
  // transactionCount가 없던 시절의 history 항목이 통째로 가려지면 추이가 끊긴다.
  const legacy = { avgPricePerPyeong10k: 4502, transactionCount: null };
  assert.ok(text(app.realestateSaleCellHtml(legacy)).includes("4,502"));
});

test("실제 데이터에서도 임계값 아래 구만 가려진다", async () => {
  const app = await loadRenderer();
  const data = JSON.parse(await readFile(path.join(root, "docs/data/realestate.json"), "utf8"));

  // 서울 전체 평균은 25개 구를 합친 값이라 가려질 일이 없어야 한다.
  assert.ok(text(app.realestateSaleCellHtml(data.overall.sale)).includes("만원"));

  for (const d of data.districts) {
    if (!d.sale) continue;
    const shown = text(app.realestateSaleCellHtml(d.sale)).includes("만원");
    assert.equal(shown, d.sale.transactionCount >= 5, `${d.name} n=${d.sale.transactionCount}`);
  }
});
