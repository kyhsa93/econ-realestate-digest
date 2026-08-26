import test from "node:test";
import assert from "node:assert/strict";
import {
  AREA_BANDS,
  LOAN_LTV,
  bandOf,
  compare,
  conversionPairs,
  districtRates,
  median,
  monthlyCost,
  verdictOf,
} from "../scripts/conversion.mjs";
import { buildPayload, depositRateOf, loanRateOf } from "../scripts/build-conversion.mjs";

const NOW = new Date("2026-08-26T00:00:00Z");

const rent = (extra = {}) => ({
  district: "노원구",
  dong: "하계동",
  apt: "극동아파트",
  area: 84.9,
  floor: 7,
  date: "2026-08-14",
  buildYear: 1988,
  deposit10k: 50_000,
  renewal: false,
  ...extra,
});

const jeonse = (deposit10k, extra = {}) => rent({ deposit10k, ...extra });
const wolse = (deposit10k, monthlyRent10k, extra = {}) => rent({ deposit10k, monthlyRent10k, ...extra });

test("같은 단지·면적대에 전세와 월세가 다 있어야 전환율이 나온다", () => {
  const pairs = conversionPairs([
    jeonse(50_000),
    wolse(20_000, 125),
    jeonse(60_000, { apt: "전세만있는단지" }),
    wolse(10_000, 80, { apt: "월세만있는단지" }),
  ]);

  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].apt, "극동아파트");
  // 125만 × 12개월 ÷ (5억 − 2억) = 5.00%
  assert.equal(pairs[0].rate, 5);
});

test("갱신계약은 시세가 아니라 이전 조건을 잇는 것이라 세지 않는다", () => {
  const pairs = conversionPairs([jeonse(50_000, { renewal: true }), wolse(20_000, 125, { renewal: true })]);
  assert.equal(pairs.length, 0);
});

test("계약구분이 아예 없는 신고는 신규인지 판단할 수 없어 버린다", () => {
  const deals = [jeonse(50_000), wolse(20_000, 125)].map(({ renewal: _r, ...rest }) => rest);
  assert.equal(conversionPairs(deals).length, 0);
});

test("면적대가 다르면 같은 단지라도 따로 센다", () => {
  const pairs = conversionPairs([
    jeonse(50_000, { area: 84.9 }),
    wolse(20_000, 125, { area: 84.9 }),
    jeonse(30_000, { area: 45.1 }),
    wolse(10_000, 100, { area: 45.1 }),
  ]);

  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs.map((p) => p.band).sort(), ["60to85", "under60"]);
});

test("월세 보증금이 전세가보다 높으면 전환율이 성립하지 않으므로 뺀다", () => {
  const pairs = conversionPairs([jeonse(20_000), wolse(50_000, 100)]);
  assert.equal(pairs.length, 0);
});

test("같은 단지에 신고가 여러 건이면 중앙값으로 모은다", () => {
  const pairs = conversionPairs([
    jeonse(40_000),
    jeonse(50_000),
    jeonse(90_000),
    wolse(20_000, 125),
  ]);

  assert.equal(pairs[0].jeonse10k, 50_000);
  assert.equal(pairs[0].rate, 5);
});

test("면적대 경계는 사이트의 다른 화면과 같은 자리에 있다", () => {
  assert.equal(bandOf(59.9).key, "under60");
  assert.equal(bandOf(60).key, "60to85");
  assert.equal(bandOf(84.9).key, "60to85");
  assert.equal(bandOf(85).key, "over85");
  assert.equal(bandOf(0), null);
  assert.equal(AREA_BANDS.length, 3);
});

test("표본이 얇은 자치구×면적 칸은 내보내지 않는다", () => {
  const pairs = [
    { district: "노원구", band: "60to85", rate: 5, jeonse10k: 50_000, deposit10k: 20_000, monthly10k: 125 },
    { district: "노원구", band: "60to85", rate: 4, jeonse10k: 40_000, deposit10k: 20_000, monthly10k: 66.7 },
    { district: "노원구", band: "60to85", rate: 6, jeonse10k: 60_000, deposit10k: 20_000, monthly10k: 200 },
    { district: "중구", band: "60to85", rate: 5, jeonse10k: 50_000, deposit10k: 20_000, monthly10k: 125 },
  ];

  const cells = districtRates(pairs);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].district, "노원구");
  assert.equal(cells[0].rate, 5);
  assert.equal(cells[0].pairs, 3);
});

test("가진 돈으로 보증금을 다 내면 대출이 없고 남은 돈은 예금 이자를 낳는다", () => {
  const cost = monthlyCost({ deposit10k: 20_000, cash10k: 30_000, loanRate: 4, depositRate: 3.8 });

  assert.equal(cost.loan10k, 0);
  assert.equal(cost.spare10k, 10_000);
  assert.equal(cost.interest10k, 0);
  // 1억 × 3.8% ÷ 12 × (1 − 0.154) = 26.8만
  assert.equal(cost.earned10k, 26.8);
  assert.equal(cost.cost10k, -26.8);
});

test("모자란 보증금은 빌리고 그 이자가 월 비용이 된다", () => {
  const cost = monthlyCost({ deposit10k: 50_000, cash10k: 20_000, loanRate: 4, depositRate: 3.8 });

  assert.equal(cost.loan10k, 30_000);
  // 3억 × 4% ÷ 12 = 100만
  assert.equal(cost.interest10k, 100);
  assert.equal(cost.cost10k, 100);
  assert.equal(cost.feasible, true);
});

test("보증금의 80%를 넘게는 못 빌리므로 모자라면 불가능하다고 알린다", () => {
  const cost = monthlyCost({ deposit10k: 50_000, cash10k: 5_000, loanRate: 4, depositRate: 3.8 });

  assert.equal(cost.loan10k, 50_000 * LOAN_LTV);
  assert.equal(cost.short10k, 5_000);
  assert.equal(cost.feasible, false);
});

test("월세는 대출이자에 월세를 더해 잰다", () => {
  const cost = monthlyCost({ deposit10k: 20_000, monthlyRent10k: 125, cash10k: 20_000, loanRate: 4, depositRate: 3.8 });

  assert.equal(cost.loan10k, 0);
  assert.equal(cost.rent10k, 125);
  assert.equal(cost.cost10k, 125);
});

test("전세와 월세를 같은 자로 재고 싼 쪽을 고른다", () => {
  const result = compare({
    jeonse10k: 50_000,
    deposit10k: 20_000,
    monthly10k: 125,
    cash10k: 20_000,
    loanRate: 4,
    depositRate: 3.8,
  });

  assert.equal(result.jeonse.cost10k, 100);
  assert.equal(result.wolse.cost10k, 125);
  assert.equal(result.cheaper, "jeonse");
  assert.equal(result.gap10k, 25);
});

test("한쪽이 애초에 불가능하면 승자를 말하지 않는다", () => {
  const result = compare({
    jeonse10k: 50_000,
    deposit10k: 20_000,
    monthly10k: 125,
    cash10k: 5_000,
    loanRate: 4,
    depositRate: 3.8,
  });

  assert.equal(result.jeonse.feasible, false);
  assert.equal(result.comparable, false);
  assert.equal(result.cheaper, null);
  assert.equal(result.gap10k, null);
});

test("전환율이 대출금리보다 높으면 빌려서 전세로 가는 쪽이 싸다", () => {
  assert.equal(verdictOf(5.5, 4).side, "jeonse");
  assert.equal(verdictOf(3.5, 4.38).side, "wolse");
  assert.equal(verdictOf(4.2, 4).side, "even");
  assert.equal(verdictOf(4.2, 4).gap, 0.2);
  assert.equal(verdictOf(NaN, 4), null);
});

test("예금은 우대조건이 필요한 최고금리 대신 기본금리로 센다", () => {
  const rates = {
    deposit: [
      { options: [{ term: 12, rate: 3.0, maxRate: 5.0 }, { term: 24, rate: 9.9 }] },
      { options: [{ term: 12, rate: 4.0, maxRate: 6.0 }] },
    ],
  };
  assert.equal(depositRateOf(rates).rate, 3.5);
});

test("전세자금대출은 대표값과 함께 구간의 폭도 같이 낸다", () => {
  const rates = {
    rentLoan: [
      { options: [{ min: 3.3, max: 5.0, avg: 4.0 }] },
      { options: [{ min: 4.0, max: 6.5, avg: 5.0 }] },
    ],
  };
  const loan = loanRateOf(rates);
  assert.equal(loan.rate, 4.5);
  assert.equal(loan.min, 3.3);
  assert.equal(loan.max, 6.5);
  assert.equal(loan.products, 2);
});

test("금리가 없으면 화면을 만들지 않는다", () => {
  const deals = [jeonse(50_000), wolse(20_000, 125)];
  assert.equal(buildPayload({ deals, rates: { rentLoan: [], deposit: [] }, months: ["202608"], now: NOW }), null);
});

test("빌드 결과에는 화면이 고르는 칸과 금리가 함께 들어간다", () => {
  const deals = [
    jeonse(50_000),
    jeonse(50_000, { apt: "두번째" }),
    jeonse(50_000, { apt: "세번째" }),
    wolse(20_000, 125),
    wolse(20_000, 125, { apt: "두번째" }),
    wolse(20_000, 125, { apt: "세번째" }),
  ];
  const rates = {
    rentLoan: [{ options: [{ min: 3.3, max: 5.0, avg: 4.0 }] }],
    deposit: [{ options: [{ term: 12, rate: 3.8 }] }],
  };

  const payload = buildPayload({ deals, rates, months: ["202608"], now: NOW });

  assert.equal(payload.cells.length, 1);
  assert.equal(payload.seoul.rate, 5);
  assert.equal(payload.seoul.verdict.side, "jeonse");
  assert.equal(payload.loan.rate, 4);
  assert.equal(payload.deposit.rate, 3.8);
  assert.equal(payload.ltv, LOAN_LTV);
  assert.equal(payload.slugs["노원구"], "nowon");
});

test("중앙값은 짝수 개일 때 가운데 둘의 평균이다", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([]), null);
});
