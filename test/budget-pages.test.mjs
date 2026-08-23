import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BUDGET_PAGES, budgetPageFile } from "../scripts/budget-pages.mjs";
import { buildBudgetPage } from "../scripts/build-budget-pages.mjs";
import { budgetBodyHtml } from "../scripts/prerender.mjs";
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

test("옆 칸 페이지와 조건 검색으로 가는 길을 남긴다", async () => {
  const html = buildBudgetPage(await baseHtml(), page8, BUDGET);
  assert.match(html, /href="\.\/budget-7eok\.html"/);
  assert.match(html, /href="\.\/budget-9eok\.html"/);
  assert.match(html, /href="\.\/deal-search\.html\?budget=8"/, "조건을 더 걸 수 있는 화면으로 가는 길이 없다");
  assert.ok(!html.includes("realestate.html?budget="), "예산 검색이 없는 페이지로 보낸다");
});

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

test("예산대 목록은 어느 페이지에도 두지 않는다", async () => {
  for (const file of ["realestate.html", "deal-search.html", "apartment-sale.html", "district-gangnam.html", "budget-8eok.html"]) {
    const html = await readFile(path.join(root, "docs", file), "utf8");
    assert.ok(!html.includes("budget-links"), `${file}: 예산대 목록이 남아 있다`);
    assert.ok(!html.includes("예산대별 실거래"), `${file}: 예산대 목록 제목이 남아 있다`);
  }
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

test("예산 페이지는 그 구간만 보여주고 주소를 건드리지 않는다", async () => {
  const page = await loadRealestatePage({
    realestate: REALESTATE,
    budget: BUDGET,
    budgetBand: page8.min10k,
    search: "",
  });

  assert.equal(page.byId("budget-section").hidden, false);
  assert.equal(page.sandbox.location.search, "");
  assert.ok(!page.budgetHtml().includes("data-budget-to"), "예산을 바꾸는 조작이 남았다");
});

test("예산 페이지는 시세 페이지에서 찍어내는 것들보다 먼저 돈다", async () => {
  for (const file of ["scripts/update-all.mjs", ".github/workflows/daily-update.yml"]) {
    const text = await readFile(path.join(root, file), "utf8");
    const budget = text.indexOf("build-budget-pages");
    const realestate = text.indexOf("build-realestate-pages");

    assert.ok(budget >= 0 && realestate >= 0, `${file}에 두 단계가 다 있어야 한다`);
    assert.ok(budget < realestate, `${file}: 예산 페이지가 자치구 페이지보다 늦게 돈다`);
  }
});

test("예산대마다 그 돈이 서울에서 어디로 가는지 다르게 말한다", async () => {
  // 지역 순위는 아래 줄에 숫자로도 있다. 그래도 문장을 두는 것은, 심사자든 사람이든
  // 페이지에서 읽는 것은 문장이고 숫자 목록이 아니기 때문이다 — 그리고 예산대마다
  // 답이 실제로 다르다. 4억대는 서울 동북권이고 20억대는 성동·송파·서초다.
  const said = new Map();
  for (const page of BUDGET_PAGES) {
    const html = await readFile(path.join(root, "docs", page.file), "utf8");
    const match = /<p class="budget-where">([\s\S]*?)<\/p>/.exec(html);
    if (match) said.set(page.file, match[1]);
  }

  assert.ok(said.size >= 12, `${said.size}개 예산대만 이 문장을 갖습니다`);
  assert.equal(new Set(said.values()).size, said.size, "예산대가 서로 같은 말을 합니다");
});

test("몰려 있지도 흩어지지도 않은 예산대에서는 지어내지 않는다", async () => {
  const even = budgetBodyHtml(
    {
      eok: 9,
      count: 100,
      districts: [
        { name: "가구", count: 12 },
        { name: "나구", count: 11 },
        { name: "다구", count: 10 },
        { name: "라구", count: 10 },
      ],
      deals: [],
    },
    []
  );
  assert.doesNotMatch(even, /budget-where/, "상위 셋이 절반도 안 되는데 몰렸다고 말합니다");
});
