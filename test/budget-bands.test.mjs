// 예산 구간은 "8억이면 뭘 살 수 있나"에 답하는 자리다. 구간을 잘못 자르면 예산보다 비싼
// 거래가 답으로 나오고, 대표 거래를 잘못 고르면 한 단지가 목록을 다 차지한다.
import test from "node:test";
import assert from "node:assert/strict";
import {
  BAND_MAX,
  BAND_MIN,
  DEALS_PER_BAND,
  bandEnd,
  bandStart,
  buildBands,
  mergeBands,
  mergeMonths,
} from "../scripts/budget-bands.mjs";
import { buildPayload } from "../scripts/build-budget-deals.mjs";

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

test("금액을 1억 단위 구간으로 나눈다", () => {
  assert.equal(bandStart(85_000), 80_000);
  assert.equal(bandStart(80_000), 80_000);
  assert.equal(bandStart(79_999), 70_000);

  assert.equal(bandEnd(80_000), 90_000);
  assert.equal(bandEnd(0), BAND_MIN);
  assert.equal(bandEnd(BAND_MAX), null, "맨 위 구간은 끝이 없다");
});

// 양 끝은 한 칸으로 묶는다. 2억짜리와 1억짜리를 따로 세어봐야 서울에서는 표본이 안 되고,
// 30억 위로는 1억 간격이 의미가 없다.
test("아래위 오픈 구간으로 모은다", () => {
  assert.equal(bandStart(29_999), 0);
  assert.equal(bandStart(BAND_MAX), BAND_MAX);
  assert.equal(bandStart(1_200_000), BAND_MAX);
  assert.equal(bandStart(0), null);
  assert.equal(bandStart(-5), null);
});

test("구간마다 건수와 대표 거래를 담는다", () => {
  const bands = buildBands([
    deal(85_000, { apt: "가단지" }),
    deal(88_000, { apt: "나단지" }),
    deal(92_000, { apt: "다단지" }),
  ]);

  assert.deepEqual(bands.map((b) => [b.min10k, b.count]), [
    [80_000, 2],
    [90_000, 1],
  ]);
  assert.deepEqual(bands[0].deals.map((d) => d.apt), ["나단지", "가단지"], "같은 날이면 비싼 쪽이 먼저");
});

// 한 단지가 대표 자리를 다 차지하면 "이 예산대에 뭐가 있나"를 보여주지 못한다.
test("대표 거래는 단지마다 한 건씩만 남긴다", () => {
  const many = Array.from({ length: 12 }, (_, i) => deal(85_000, { apt: `단지${i % 3}`, date: `2026-08-${10 + i}` }));
  const [band] = buildBands(many);

  assert.equal(band.count, 12, "건수는 전부 센다");
  assert.deepEqual(band.deals.map((d) => d.apt), ["단지2", "단지1", "단지0"]);
});

test("대표 거래 수를 넘기지 않는다", () => {
  const many = Array.from({ length: 20 }, (_, i) => deal(85_000, { apt: `단지${i}` }));
  assert.equal(buildBands(many)[0].deals.length, DEALS_PER_BAND);
});

test("어느 지역에 몰려 있는지 같이 센다", () => {
  const [band] = buildBands([
    deal(85_000, { district: "노원구", apt: "가" }),
    deal(86_000, { district: "노원구", apt: "나" }),
    deal(87_000, { district: "도봉구", apt: "다" }),
  ]);
  assert.deepEqual(band.districts, [
    { name: "노원구", count: 2 },
    { name: "도봉구", count: 1 },
  ]);
});

// 지난달 거래는 다시 받아올 방법이 없다(호출 한도 때문에 이 저장소는 지난달 집계도
// 캐시해 쓴다). 여기서 지우면 영영 사라진다.
test("지난달 구간은 그대로 두고 오래된 달만 떨어뜨린다", () => {
  const first = mergeMonths(null, "202606", buildBands([deal(85_000)]));
  const second = mergeMonths({ months: first }, "202607", buildBands([deal(95_000)]));
  const third = mergeMonths({ months: second }, "202608", buildBands([deal(105_000)]));

  assert.deepEqual(Object.keys(third), ["202606", "202607", "202608"]);

  const fourth = mergeMonths({ months: third }, "202609", buildBands([deal(115_000)]));
  assert.deepEqual(Object.keys(fourth), ["202607", "202608", "202609"], "석 달치만 남는다");
});

test("여러 달의 같은 구간을 하나로 합친다", () => {
  const months = {
    "202607": buildBands([deal(85_000, { apt: "가단지", date: "2026-07-20" })]),
    "202608": buildBands([
      deal(86_000, { apt: "나단지", date: "2026-08-14" }),
      deal(87_000, { apt: "다단지", district: "도봉구", date: "2026-08-15" }),
    ]),
  };

  const [band] = mergeBands(months);
  assert.equal(band.count, 3);
  assert.deepEqual(band.deals.map((d) => d.apt), ["다단지", "나단지", "가단지"], "최근 거래가 먼저");
  assert.deepEqual(band.districts, [
    { name: "노원구", count: 2 },
    { name: "도봉구", count: 1 },
  ]);
});

test("거래 원본이 비면 기존 결과를 건드리지 않는다", () => {
  const now = new Date("2026-08-17T00:00:00Z");
  assert.equal(buildPayload({ period: "202608", districts: {} }, null, now), null);
  assert.equal(buildPayload(null, null, now), null);
});

test("구별 원본을 하나로 모아 구간을 만든다", () => {
  const now = new Date("2026-08-17T00:00:00Z");
  const source = {
    period: "202608",
    districts: {
      11350: [deal(85_000, { apt: "가단지" })],
      11680: [deal(1_200_000, { district: "강남구", apt: "나단지" })],
    },
  };

  const payload = buildPayload(source, null, now);
  assert.deepEqual(payload.screen.periods, ["202608"]);
  assert.deepEqual(payload.screen.bands.map((b) => b.min10k), [80_000, BAND_MAX]);
  assert.deepEqual(Object.keys(payload.months.months), ["202608"]);

  // 화면이 받는 파일에는 월별 원본이 실리지 않는다. 같이 넣으면 크기만 세 배가 된다.
  assert.ok(!("months" in payload.screen));
});
