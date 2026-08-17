import test from "node:test";
import assert from "node:assert/strict";
import { errorDetail } from "../scripts/fetch-realestate.mjs";
import {
  carryForward,
  dealingDirect,
  dropCancelled,
  fetchSummary,
  isCancelledDeal,
  normalizeDeal,
} from "../scripts/realestate-metrics.mjs";

const deal = (extra = {}) => ({
  aptNm: "역삼아이파크",
  umdNm: "역삼동",
  excluUseAr: "84.97",
  dealAmount: " 115,000",
  dealYear: 2026,
  dealMonth: 8,
  dealDay: 14,
  floor: 12,
  buildYear: 2004,
  ...extra,
});

test("해제 표시가 붙은 거래를 걸러낸다", () => {
  assert.equal(isCancelledDeal(deal({ cdealType: "O" })), true);
  assert.equal(isCancelledDeal(deal({ cdealDay: "26.08.16" })), true);

  assert.equal(isCancelledDeal(deal({ cdealType: "", cdealDay: "" })), false);
  assert.equal(isCancelledDeal(deal({ cdealType: "   " })), false);
  assert.equal(isCancelledDeal(deal()), false);
});

test("해제분만 빼고 나머지는 그대로 남긴다", () => {
  const items = [deal(), deal({ cdealType: "O" }), deal({ aptNm: "다른단지" })];
  const kept = dropCancelled(items);
  assert.equal(kept.length, 2);
  assert.deepEqual(kept.map((d) => d.aptNm), ["역삼아이파크", "다른단지"]);
});

test("거래 한 건을 화면이 쓸 모양으로 옮긴다", () => {
  assert.deepEqual(normalizeDeal(deal(), "강남구"), {
    district: "강남구",
    dong: "역삼동",
    apt: "역삼아이파크",
    area: 84.97,
    floor: 12,
    amount10k: 115000,
    date: "2026-08-14",
    buildYear: 2004,
  });
});

test("거래 형태를 직거래·중개거래·미상 셋으로 가른다", () => {
  assert.equal(dealingDirect("직거래"), true);
  assert.equal(dealingDirect("중개거래"), false);
  assert.equal(dealingDirect(" 직거래 "), true);

  assert.equal(dealingDirect(""), null);
  assert.equal(dealingDirect("   "), null);
  assert.equal(dealingDirect(undefined), null);
});

test("거래 형태를 신고한 거래에만 표시를 남긴다", () => {
  assert.equal(normalizeDeal(deal({ dealingGbn: "직거래" }), "강남구").direct, true);
  assert.equal(normalizeDeal(deal({ dealingGbn: "중개거래" }), "강남구").direct, false);
  assert.ok(!("direct" in normalizeDeal(deal(), "강남구")), "미상에도 값을 지어냈다");
});

test("이름이나 금액이 없는 거래는 담지 않는다", () => {
  assert.equal(normalizeDeal(deal({ aptNm: "" }), "강남구"), null);
  assert.equal(normalizeDeal(deal({ aptNm: "   " }), "강남구"), null);
  assert.equal(normalizeDeal(deal({ dealAmount: "" }), "강남구"), null);
  assert.equal(normalizeDeal(deal({ dealAmount: "0" }), "강남구"), null);
  assert.equal(normalizeDeal(deal({ excluUseAr: "0" }), "강남구"), null);
  assert.equal(normalizeDeal(deal({ dealDay: "" }), "강남구"), null);
});

test("층·건축년도가 비어도 거래는 살린다", () => {
  const parsed = normalizeDeal(deal({ floor: "", buildYear: "" }), "강남구");
  assert.equal(parsed.floor, null);
  assert.equal(parsed.buildYear, null);
  assert.equal(parsed.amount10k, 115000);
});

test("한 자리 월·일도 두 자리로 맞춘다", () => {
  assert.equal(normalizeDeal(deal({ dealMonth: 9, dealDay: 3 }), "강남구").date, "2026-09-03");
});

test("네트워크 실패는 원인까지 적는다", () => {
  const err = new Error("fetch failed", { cause: Object.assign(new Error("timeout"), { code: "UND_ERR_CONNECT_TIMEOUT" }) });
  assert.equal(errorDetail(err), "fetch failed ← UND_ERR_CONNECT_TIMEOUT");

  assert.equal(errorDetail(new Error("http 500")), "http 500");
});

const DISTRICTS = [
  { code: "11110", name: "종로구" },
  { code: "11350", name: "노원구" },
  { code: "11680", name: "강남구" },
];

const entry = (code, name, count = 30) => ({
  code,
  name,
  sale: { avgPricePerPyeong10k: 4000, transactionCount: count },
});

test("조회에 실패한 구를 지난번 값으로 채운다", () => {
  const existing = {
    updatedAt: "2026-08-14T23:32:15.722Z",
    districts: [entry("11110", "종로구", 11), entry("11350", "노원구", 41), entry("11680", "강남구", 14)],
  };
  const fetched = [entry("11350", "노원구", 45)];

  const { districts, carriedNames } = carryForward(DISTRICTS, fetched, existing, false);

  assert.deepEqual(districts.map((d) => d.name), ["종로구", "노원구", "강남구"], "구가 사라졌다");
  assert.deepEqual(carriedNames, ["종로구", "강남구"]);
  assert.equal(districts[1].sale.transactionCount, 45, "새로 받은 값이 밀렸다");
  assert.equal(districts[0].staleAt, "2026-08-14T23:32:15.722Z");
  assert.ok(!("staleAt" in districts[1]), "새로 받은 구에 묵은 표시가 붙었다");
});

test("이미 묵은 구는 처음 받은 시각을 물려받는다", () => {
  const existing = {
    updatedAt: "2026-08-16T23:30:00.000Z",
    districts: [{ ...entry("11110", "종로구"), staleAt: "2026-08-14T23:32:15.722Z" }],
  };

  const { districts } = carryForward(DISTRICTS, [], existing, false);
  assert.equal(districts[0].staleAt, "2026-08-14T23:32:15.722Z");
});

test("같은 날 재조회에서는 묵은 표시를 붙이지 않는다", () => {
  const existing = { updatedAt: "2026-08-17T01:00:00.000Z", districts: [entry("11110", "종로구")] };
  const { districts, carriedNames } = carryForward(DISTRICTS, [], existing, true);

  assert.equal(districts.length, 1);
  assert.ok(!("staleAt" in districts[0]));
  assert.deepEqual(carriedNames, []);
});

test("지난번 값도 없는 구는 만들어내지 않는다", () => {
  const { districts, carriedNames } = carryForward(DISTRICTS, [entry("11350", "노원구")], null, false);
  assert.deepEqual(districts.map((d) => d.name), ["노원구"]);
  assert.deepEqual(carriedNames, []);
});

test("마무리 로그는 유형별로 값이 있는 구만 센다", () => {
  const districts = [
    { name: "노원구", sale: { transactionCount: 3 }, jeonse: { transactionCount: 9 }, wolse: { transactionCount: 5 } },
    { name: "도봉구", sale: null, jeonse: { transactionCount: 4 }, wolse: null },
    { name: "종로구" },
  ];

  assert.equal(fetchSummary(districts), "매매 1개구, 전세 2개구, 월세 1개구");
  assert.equal(fetchSummary([]), "매매 0개구, 전세 0개구, 월세 0개구");
});
