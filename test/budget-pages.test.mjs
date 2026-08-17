// 예산 구간 착지 페이지(budget-8eok.html 등).
//
// 이 페이지들은 검색 결과에 그대로 실리는 정적 HTML이라, 프리렌더가 심은 내용이 화면
// 렌더와 어긋나면 데이터를 받는 순간 내용이 바뀐다. 두 결과를 직접 대조한다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BUDGET_PAGES, budgetPageFile } from "../scripts/budget-pages.mjs";
import { buildBudgetPage } from "../scripts/build-budget-pages.mjs";
import { budgetBodyHtml, budgetLinksHtml } from "../scripts/prerender.mjs";
import { buildBands, mergeBands } from "../scripts/budget-bands.mjs";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";

const root = path.resolve(import.meta.dirname, "..");

const deal = (amount10k, extra = {}) => ({
  district: "노원구",
  dong: "하계동",
  apt: "극동아파트",
  area: 55.72,
  floor: 7,
  amount10k,
  date: "2026-08-14",
  buildYear: 1988,
  ...extra,
});

const BUDGET = {
  updatedAt: "2026-08-17T00:00:00.000Z",
  periods: ["202608"],
  bands: mergeBands({
    "202608": buildBands([
      deal(85_000, { apt: "팔억가단지" }),
      deal(88_000, { apt: "팔억나단지", district: "도봉구", dong: "창동", floor: 12 }),
    ]),
  }),
};

const REALESTATE = {
  updatedAt: "2026-08-17T00:00:00.000Z",
  period: "202608",
  overall: {
    sale: { avgPricePerM2: 13_457_520, avgPricePerPyeong10k: 4449, transactionCount: 575 },
    jeonse: { avgDepositPerM2: 7_777_223, avgDepositPerPyeong10k: 2571, transactionCount: 2525 },
    wolse: { avgDeposit10k: 22166, avgMonthlyRent10k: 96, transactionCount: 2223 },
  },
  districts: [],
};

const page8 = BUDGET_PAGES.find((p) => p.eok === 8);
const baseHtml = () => readFile(path.join(root, "docs/realestate.html"), "utf8");

test("주소는 예산 단위로 고정한다", () => {
  assert.equal(budgetPageFile(8), "budget-8eok.html");
  assert.deepEqual(
    [BUDGET_PAGES.at(0).eok, BUDGET_PAGES.at(-1).eok],
    [3, 20],
    "구간 목록이 바뀌면 이미 색인된 주소가 404가 된다"
  );
});

test("예산 페이지에 그 구간 거래와 제목이 들어간다", async () => {
  const html = buildBudgetPage(await baseHtml(), page8, BUDGET);

  assert.match(html, /<title>8억대로 살 수 있는 서울 아파트 - 최근 실거래<\/title>/);
  assert.match(html, /<meta name="budget-band" content="80000">/);
  assert.match(html, /<section id="budget-section">/, "예산 섹션이 접힌 채로 나갔다");
  assert.match(html, /팔억가단지/);
  assert.match(html, /도봉구 창동 팔억나단지/);
  assert.match(html, /canonical" href="[^"]*budget-8eok\.html/);
});

test("옆 칸 페이지와 전체 검색으로 가는 길을 남긴다", async () => {
  const html = buildBudgetPage(await baseHtml(), page8, BUDGET);
  assert.match(html, /href="\.\/budget-7eok\.html"/);
  assert.match(html, /href="\.\/budget-9eok\.html"/);
  assert.match(html, /href="\.\/realestate\.html\?budget=8"/);
});

// 양 끝 구간은 한쪽 이웃이 없다. 없는 주소로 링크하면 404가 된다.
test("목록 양 끝에서는 없는 이웃을 링크하지 않는다", async () => {
  const base = await baseHtml();
  const lowest = BUDGET_PAGES.at(0);
  const budget = { periods: ["202608"], bands: buildBands([deal(lowest.min10k + 500)]) };

  const html = buildBudgetPage(base, lowest, budget);
  assert.ok(!html.includes(`budget-${lowest.eok - 1}eok.html`), "없는 아래 칸을 링크했다");
  assert.match(html, new RegExp(`budget-${lowest.eok + 1}eok\\.html`));
});

test("거래가 없는 구간은 페이지를 만들지 않는다", async () => {
  const empty = BUDGET_PAGES.find((p) => p.eok === 19);
  assert.equal(buildBudgetPage(await baseHtml(), empty, BUDGET), null);
});

// 찍히지 않은 페이지까지 링크하면 404가 된다.
test("링크 목록은 넘겨받은 페이지만 건다", () => {
  const html = budgetLinksHtml(BUDGET_PAGES.filter((p) => p.eok <= 5));
  assert.match(html, /budget-3eok\.html/);
  assert.ok(!html.includes("budget-6eok.html"));
});

test("프리렌더가 심은 거래 목록을 클라이언트가 그대로 다시 그린다", async () => {
  const page = await loadRealestatePage({
    realestate: REALESTATE,
    budget: BUDGET,
    budgetBand: page8.min10k,
  });

  const band = BUDGET.bands.find((b) => b.min10k === page8.min10k);
  assert.equal(page.budgetHtml(), budgetBodyHtml(band, BUDGET.periods));
});

// 구간이 곧 주소인 페이지에서 값을 바꾸면 주소와 화면이 어긋난다. 입력창 대신 옆 칸
// 링크로만 움직인다.
test("예산 페이지에서는 입력창을 접고 주소를 건드리지 않는다", async () => {
  const page = await loadRealestatePage({
    realestate: REALESTATE,
    budget: BUDGET,
    budgetBand: page8.min10k,
    search: "",
  });

  assert.equal(page.byId("budget-section").hidden, false);
  assert.equal(page.byId("budget-controls").hidden, true);
  assert.equal(page.sandbox.location.search, "");
  assert.ok(!page.budgetHtml().includes("data-budget-to"), "정적 페이지에 이동 버튼이 남았다");
});
