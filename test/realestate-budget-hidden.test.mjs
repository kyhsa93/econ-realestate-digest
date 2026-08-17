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

test("시세 페이지에서는 예산으로 찾기를 열지 않는다", async () => {
  const page = await open();

  assert.equal(page.byId("budget-section").hidden, true, "거래내역 검색과 겹치는 기능이 남아 있다");
  assert.equal(page.budgetHtml(), "");
});

test("주소에 예산이 붙어 있어도 열지 않는다", async () => {
  const page = await open({ search: "?budget=9" });

  assert.equal(page.byId("budget-section").hidden, true);
  assert.equal(page.sandbox.location.search, "?budget=9", "주소를 건드렸다");
});

test("자치구·거래 유형 페이지에서도 열지 않는다", async () => {
  for (const extra of [{ districtName: "노원구" }, { kind: "sale" }]) {
    const page = await open(extra);
    assert.equal(page.byId("budget-section").hidden, true, JSON.stringify(extra));
  }
});
