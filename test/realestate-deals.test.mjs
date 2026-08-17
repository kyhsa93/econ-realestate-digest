// 개별 실거래를 한 건씩 다루기 시작하면서 생긴 위험을 지킨다.
//
// 평균만 낼 때는 이상한 거래 한 건이 수백 건에 묻혔지만, 예산 화면은 거래를 단지 이름과
// 함께 한 줄씩 보여준다. 해제된 거래가 섞이면 취소된 계약을 실제 거래인 것처럼 게시하는
// 셈이 되고, 그건 평균이 조금 틀리는 것과는 성격이 다른 사고다.
import test from "node:test";
import assert from "node:assert/strict";
import {
  carryForward,
  dealingDirect,
  dropCancelled,
  errorDetail,
  fetchSummary,
  isCancelledDeal,
  normalizeDeal,
} from "../scripts/fetch-realestate.mjs";

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

  // 국토부는 해제가 아닌 거래에도 필드 자체는 내려보낸다. 빈 칸을 해제로 읽으면
  // 그날 거래가 통째로 사라진다.
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

// 직거래에는 특수관계인 사이의 저가 거래가 섞여 있어 시세를 읽는 눈으로 보면 노이즈다.
// 검색 화면이 "직거래 제외"를 걸려면 이 필드가 거래마다 붙어 있어야 한다.
test("거래 형태를 직거래·중개거래·미상 셋으로 가른다", () => {
  assert.equal(dealingDirect("직거래"), true);
  assert.equal(dealingDirect("중개거래"), false);
  assert.equal(dealingDirect(" 직거래 "), true);

  // 미상을 중개거래로 접어 넣으면, 국토부가 이 필드를 안 주는 날에도 화면상 달라지는 게
  // 없어 알아챌 방법이 없다.
  assert.equal(dealingDirect(""), null);
  assert.equal(dealingDirect("   "), null);
  assert.equal(dealingDirect(undefined), null);
});

test("거래 형태를 신고한 거래에만 표시를 남긴다", () => {
  assert.equal(normalizeDeal(deal({ dealingGbn: "직거래" }), "강남구").direct, true);
  assert.equal(normalizeDeal(deal({ dealingGbn: "중개거래" }), "강남구").direct, false);
  assert.ok(!("direct" in normalizeDeal(deal(), "강남구")), "미상에도 값을 지어냈다");
});

// 예산 화면은 "어느 아파트가 그 값에 팔렸나"에 답하는 자리다. 이름 없는 줄은
// 보여줄 수도 없고 세어봐야 의미도 없다.
test("이름이나 금액이 없는 거래는 담지 않는다", () => {
  assert.equal(normalizeDeal(deal({ aptNm: "" }), "강남구"), null);
  assert.equal(normalizeDeal(deal({ aptNm: "   " }), "강남구"), null);
  assert.equal(normalizeDeal(deal({ dealAmount: "" }), "강남구"), null);
  assert.equal(normalizeDeal(deal({ dealAmount: "0" }), "강남구"), null);
  assert.equal(normalizeDeal(deal({ excluUseAr: "0" }), "강남구"), null);
  assert.equal(normalizeDeal(deal({ dealDay: "" }), "강남구"), null);
});

// 층과 건축년도는 없는 거래가 실제로 있다. 그 한 칸 때문에 거래를 버리지는 않는다.
test("층·건축년도가 비어도 거래는 살린다", () => {
  const parsed = normalizeDeal(deal({ floor: "", buildYear: "" }), "강남구");
  assert.equal(parsed.floor, null);
  assert.equal(parsed.buildYear, null);
  assert.equal(parsed.amount10k, 115000);
});

test("한 자리 월·일도 두 자리로 맞춘다", () => {
  assert.equal(normalizeDeal(deal({ dealMonth: 9, dealDay: 3 }), "강남구").date, "2026-09-03");
});

// 25개구가 한꺼번에 "fetch failed"로 죽은 날, 로그만 보고는 API가 죽은 건지 우리가 막힌
// 건지 알 수가 없었다. 진짜 이유는 err.cause에 들어 있다.
test("네트워크 실패는 원인까지 적는다", () => {
  const err = new Error("fetch failed", { cause: Object.assign(new Error("timeout"), { code: "UND_ERR_CONNECT_TIMEOUT" }) });
  assert.equal(errorDetail(err), "fetch failed ← UND_ERR_CONNECT_TIMEOUT");

  assert.equal(errorDetail(new Error("http 500")), "http 500");
});

// 조회가 실패한 구를 그냥 빠뜨리면 표가 조용히 24개구가 되고, 읽는 사람은 그 구에 거래가
// 없었다고 읽는다. 못 받은 것과 거래가 없는 것은 전혀 다른 얘기다.
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

// 매번 오늘로 갱신하면 며칠째 묵은 값이 어제 받은 값처럼 보인다.
test("이미 묵은 구는 처음 받은 시각을 물려받는다", () => {
  const existing = {
    updatedAt: "2026-08-16T23:30:00.000Z",
    districts: [{ ...entry("11110", "종로구"), staleAt: "2026-08-14T23:32:15.722Z" }],
  };

  const { districts } = carryForward(DISTRICTS, [], existing, false);
  assert.equal(districts[0].staleAt, "2026-08-14T23:32:15.722Z");
});

// 오늘 이미 받아둔 구를 누락분만 다시 도는 실행에서 묵은 값으로 표시하면 안 된다.
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

// 조회가 실제로 성공한 날에만 도는 마무리 줄이라, 전 구 타임아웃으로 일찍 return하던
// 동안에는 없는 변수를 참조하는 채로 오래 남아 있었다. 데이터를 다 저장해 놓고 마지막
// 줄에서 죽어 CI가 통째로 실패했다.
test("마무리 로그는 유형별로 값이 있는 구만 센다", () => {
  const districts = [
    { name: "노원구", sale: { transactionCount: 3 }, jeonse: { transactionCount: 9 }, wolse: { transactionCount: 5 } },
    { name: "도봉구", sale: null, jeonse: { transactionCount: 4 }, wolse: null },
    { name: "종로구" },
  ];

  assert.equal(fetchSummary(districts), "매매 1개구, 전세 2개구, 월세 1개구");
  assert.equal(fetchSummary([]), "매매 0개구, 전세 0개구, 월세 0개구");
});
