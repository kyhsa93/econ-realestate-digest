import test from "node:test";
import assert from "node:assert/strict";
import { buildBands, mergeBands } from "../scripts/budget-bands.mjs";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";

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
      deal(72_000, { apt: "칠억단지" }),
      deal(85_000, { apt: "팔억가단지" }),
      deal(88_000, { apt: "팔억나단지", district: "도봉구", dong: "창동", floor: 12 }),
      deal(95_000, { apt: "구억단지" }),
    ]),
  }),
};

const open = (extra = {}) => loadRealestatePage({ realestate: REALESTATE, budget: BUDGET, ...extra });

test("입력한 예산이 속한 구간의 거래를 보여준다", async () => {
  const page = await open();

  assert.equal(page.byId("budget-section").hidden, false);
  const html = page.budgetHtml();
  assert.match(html, /8억대에서 2건이 거래됐습니다/);
  assert.match(html, /팔억가단지/);
  assert.match(html, /팔억나단지/);
  assert.ok(!html.includes("칠억단지"), "예산 아래 구간 거래가 섞였다");
  assert.ok(!html.includes("구억단지"), "예산 위 구간 거래가 섞였다");
});

test("거래마다 면적·층·거래일을 같이 적는다", async () => {
  const html = (await open()).budgetHtml();
  assert.match(html, /도봉구 창동 팔억나단지/);
  assert.match(html, /55\.72㎡ · 12층/);
  assert.match(html, /8\/14/);
  assert.match(html, /8억 8,000만원/);
});

test("주소로 예산을 받고, 바꾸면 주소에 남긴다", async () => {
  const page = await open({ search: "?budget=9" });
  assert.match(page.budgetHtml(), /구억단지/);

  page.byId("budget-input").dispatch("input", { target: { value: "7" } });
  assert.match(page.budgetHtml(), /칠억단지/);
  assert.equal(page.sandbox.location.search, "?budget=7");
});

test("기본 예산은 주소에 남기지 않는다", async () => {
  const page = await open({ search: "?budget=7" });
  page.byId("budget-input").dispatch("input", { target: { value: "8" } });
  assert.equal(page.sandbox.location.search, "");
});

test("옆 칸으로 옮기는 버튼이 예산을 바꾼다", async () => {
  const page = await open();
  const html = page.budgetHtml();
  assert.match(html, /data-budget-to="7"/);
  assert.match(html, /data-budget-to="9"/);

  page.byId("budget-result").dispatch("click", {
    target: { closest: (sel) => (sel === "[data-budget-to]" ? { getAttribute: () => "9" } : null) },
  });
  assert.match(page.budgetHtml(), /구억단지/);
});

test("거래가 없는 예산대는 빈 상태로 알린다", async () => {
  const page = await open({ search: "?budget=25" });
  assert.match(page.budgetHtml(), /이 예산대에는 신고된 거래가 없습니다/);
});

test("매물이 아니라 신고된 거래라는 안내가 붙는다", async () => {
  const page = await open();
  const note = page.byId("budget-note").textContent;
  assert.match(note, /신고된 실거래 기록/);
  assert.match(note, /매물이 아니며/);
});

test("데이터가 없는 날에는 섹션을 접는다", async () => {
  const page = await loadRealestatePage({ realestate: REALESTATE });
  assert.equal(page.byId("budget-section").hidden, true);
});

test("자치구·거래 유형 페이지에서는 열지 않는다", async () => {
  for (const extra of [{ kind: "sale" }, { kind: "jeonse" }, { district: "노원구" }]) {
    const page = await open(extra);
    assert.equal(page.byId("budget-section").hidden, true, `${JSON.stringify(extra)}에서 예산 섹션이 열렸다`);
  }
});

test("영어 화면은 예산 결과도 영어로 그린다", async () => {
  const page = await open({ locale: "en" });
  const html = page.budgetHtml();
  assert.match(html, /deals filed in the/);
  assert.match(html, /12F/);
  assert.ok(!html.includes("거래됐습니다"), "영어 화면에 한국어가 남아 있다");
  assert.match(page.byId("budget-note").textContent, /not listings for sale/);
});
