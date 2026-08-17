import test from "node:test";
import assert from "node:assert/strict";
import { contractRenewal, normalizeRentDeal } from "../scripts/realestate-metrics.mjs";
import { buildRentFiles, collectDeals } from "../scripts/deal-files.mjs";

const NOW = new Date("2026-08-17T00:00:00Z");

const raw = (extra = {}) => ({
  aptNm: "역삼아이파크",
  umdNm: "역삼동",
  excluUseAr: "84.97",
  deposit: " 115,000",
  monthlyRent: 0,
  dealYear: 2026,
  dealMonth: 8,
  dealDay: 14,
  floor: "12",
  buildYear: "2005",
  ...extra,
});

const rentDeal = (extra = {}) => ({
  district: "강남구",
  dong: "역삼동",
  apt: "역삼아이파크",
  area: 84.97,
  floor: 12,
  deposit10k: 115_000,
  date: "2026-08-14",
  buildYear: 2005,
  ...extra,
});

const sourceOf = (deals, period = "202608") => ({ period, districts: { seoul: deals } });

test("보증금만 있으면 전세로 남는다", () => {
  const deal = normalizeRentDeal(raw(), "강남구");

  assert.equal(deal.deposit10k, 115_000);
  assert.ok(!("monthlyRent10k" in deal), "전세에 월세 항목이 남았다");
  assert.equal(deal.area, 84.97);
  assert.equal(deal.floor, 12);
  assert.equal(deal.date, "2026-08-14");
  assert.equal(deal.buildYear, 2005);
});

test("월세가 있으면 월세로 남는다", () => {
  const deal = normalizeRentDeal(raw({ monthlyRent: "150" }), "강남구");
  assert.equal(deal.deposit10k, 115_000);
  assert.equal(deal.monthlyRent10k, 150);
});

test("보증금이 없거나 0이면 담지 않는다", () => {
  assert.equal(normalizeRentDeal(raw({ deposit: "" }), "강남구"), null);
  assert.equal(normalizeRentDeal(raw({ deposit: "0" }), "강남구"), null);
});

test("단지명·면적·계약일이 성하지 않으면 담지 않는다", () => {
  assert.equal(normalizeRentDeal(raw({ aptNm: "  " }), "강남구"), null);
  assert.equal(normalizeRentDeal(raw({ excluUseAr: "0" }), "강남구"), null);
  assert.equal(normalizeRentDeal(raw({ dealMonth: 13 }), "강남구"), null);
});

test("갱신계약은 표시해 둔다", () => {
  assert.equal(contractRenewal("갱신"), true);
  assert.equal(contractRenewal("신규"), false);
  assert.equal(contractRenewal(""), null);
  assert.equal(contractRenewal(undefined), null);

  assert.equal(normalizeRentDeal(raw({ contractType: "갱신" }), "강남구").renewal, true);
  assert.equal(normalizeRentDeal(raw({ contractType: "신규" }), "강남구").renewal, false);
  assert.ok(!("renewal" in normalizeRentDeal(raw(), "강남구")), "계약 구분이 없는데 값을 지어냈다");
});

test("전월세는 보증금이 큰 쪽을 앞에 둔다", () => {
  const { deals } = collectDeals(
    [
      rentDeal({ apt: "싼쪽", deposit10k: 50_000 }),
      rentDeal({ apt: "어제", date: "2026-08-13" }),
      rentDeal({ apt: "비싼쪽", deposit10k: 90_000 }),
    ],
    3,
    (deal) => deal.deposit10k ?? 0
  );

  assert.deepEqual(deals.map((d) => d.apt), ["비싼쪽", "싼쪽", "어제"]);
});

test("지역별 전월세 파일을 나누고 석 달만 남긴다", () => {
  const files = buildRentFiles(
    sourceOf([
      rentDeal({ date: "2026-05-10", apt: "다섯달" }),
      rentDeal({ date: "2026-06-10", apt: "여섯달" }),
      rentDeal({ date: "2026-07-10", apt: "지난달" }),
      rentDeal({ apt: "이번달" }),
    ]),
    NOW
  );

  assert.deepEqual(Object.keys(files), ["gangnam"]);
  assert.deepEqual(files.gangnam.periods, ["202606", "202607", "202608"]);

  const names = files.gangnam.deals.map((d) => d.apt);
  assert.ok(names.includes("지난달"));
  assert.ok(names.includes("이번달"));
  assert.ok(!names.includes("다섯달"), "보관 기간을 넘긴 거래가 남았다");
  assert.ok(files.gangnam.deals.every((d) => !("district" in d)), "지역 이름이 거래마다 남았다");
});
