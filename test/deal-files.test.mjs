// 자치구별 실거래 전수 파일. 검색 조건이 붙는 자리이자, 지난달 거래의 유일한 보관처다.
//
// 거래 원본은 gitignore된 캐시라 러너가 바뀌면 사라지고, 호출 한도 때문에 지난달을 다시
// 받아올 방법이 없다. 그래서 여기서 지난달치를 흘리면 그 달은 영영 사라진다 - 파일이
// 멀쩡해 보이면서 내용만 한 달치로 줄어드는 실패라, 화면에서는 "거래가 적은 달"로 읽힌다.
import test from "node:test";
import assert from "node:assert/strict";
import { buildDealFiles, mergeDeals, periodOf } from "../scripts/deal-files.mjs";

const NOW = new Date("2026-08-17T00:00:00Z");

const deal = (extra = {}) => ({
  district: "노원구",
  dong: "상계동",
  apt: "상계주공7",
  area: 45.9,
  floor: 5,
  amount10k: 52_000,
  date: "2026-08-14",
  buildYear: 1988,
  ...extra,
});

const sourceOf = (deals, period = "202608") => ({ period, districts: { seoul: deals } });

test("거래일에서 신고 기간을 뽑는다", () => {
  assert.equal(periodOf("2026-08-14"), "202608");
  assert.equal(periodOf("2026-12-01"), "202612");
  assert.equal(periodOf(""), null);
  assert.equal(periodOf(undefined), null);
});

test("이번 달은 갈아끼우고 지난달은 그대로 둔다", () => {
  const existing = [deal({ date: "2026-07-20", apt: "지난달단지" }), deal({ apt: "옛날에받은이번달" })];
  const { deals, periods } = mergeDeals(existing, "202608", [deal({ apt: "오늘받은이번달" })]);

  assert.deepEqual(periods, ["202607", "202608"]);
  const names = deals.map((d) => d.apt);
  assert.ok(names.includes("지난달단지"), "지난달치가 사라졌다");
  assert.ok(names.includes("오늘받은이번달"));
  assert.ok(!names.includes("옛날에받은이번달"), "이번 달이 두 벌로 남았다");
});

test("보관 기간을 넘긴 달만 떨어뜨린다", () => {
  const existing = [
    deal({ date: "2026-05-10", apt: "다섯달" }),
    deal({ date: "2026-06-10", apt: "여섯달" }),
    deal({ date: "2026-07-10", apt: "일곱달" }),
  ];
  const { periods, deals } = mergeDeals(existing, "202608", [deal({ apt: "여덟달" })], 3);

  assert.deepEqual(periods, ["202606", "202607", "202608"]);
  assert.ok(!deals.some((d) => d.apt === "다섯달"));
  assert.equal(deals.length, 3);
});

test("최근 거래가 먼저, 같은 날이면 비싼 쪽이 먼저", () => {
  const { deals } = mergeDeals(
    [],
    "202608",
    [
      deal({ apt: "싼쪽", amount10k: 50_000 }),
      deal({ apt: "어제", date: "2026-08-13" }),
      deal({ apt: "비싼쪽", amount10k: 90_000 }),
    ]
  );
  assert.deepEqual(deals.map((d) => d.apt), ["비싼쪽", "싼쪽", "어제"]);
});

test("지역별로 파일을 나누고 지역 이름을 거래마다 담지 않는다", () => {
  const files = buildDealFiles(
    sourceOf([deal(), deal({ district: "강남구", apt: "역삼아이파크" })]),
    null,
    NOW
  );

  assert.deepEqual(Object.keys(files).sort(), ["gangnam", "nowon"]);
  assert.equal(files.nowon.district, "노원구");
  assert.ok(files.nowon.deals.every((d) => !("district" in d)), "지역 이름이 거래마다 남았다");
  assert.deepEqual(files.nowon.periods, ["202608"]);
});

// 조건으로 쓰이는 필드를 여기서 떼면 그 조건을 만들 수가 없다. 면적·층·준공연도·거래형태는
// 예산 구간 파일이 버리는 값이라, 이 파일이 유일하게 들고 있는 자리다.
test("조건에 쓰이는 필드를 전부 남긴다", () => {
  const files = buildDealFiles(sourceOf([deal({ direct: true })]), null, NOW);
  assert.deepEqual(files.nowon.deals[0], {
    dong: "상계동",
    apt: "상계주공7",
    area: 45.9,
    floor: 5,
    amount10k: 52_000,
    date: "2026-08-14",
    buildYear: 1988,
    direct: true,
  });
});

// 이번 달에 거래가 없는 구를 빼면 그 구의 지난달치까지 같이 사라진다.
test("이번 달 거래가 없는 구도 지난달치를 들고 남는다", () => {
  const existing = { 강남구: { deals: [deal({ district: "강남구", date: "2026-07-02", apt: "지난달강남" })] } };
  const files = buildDealFiles(sourceOf([deal()]), existing, NOW);

  assert.ok(files.gangnam, "이번 달 거래가 없는 구의 파일이 사라졌다");
  assert.equal(files.gangnam.deals[0].apt, "지난달강남");
});

// 빈 파일을 내려보내면 화면이 "조건에 맞는 거래가 없다"와 "이 구는 자료가 없다"를 같은
// 모양으로 말하게 된다.
test("거래가 한 건도 없는 구는 파일을 만들지 않는다", () => {
  const files = buildDealFiles(sourceOf([deal()]), { 강남구: { deals: [] } }, NOW);
  assert.ok(!("gangnam" in files));
});

test("재료가 없으면 아무것도 만들지 않는다", () => {
  assert.equal(buildDealFiles(null, null, NOW), null);
  assert.equal(buildDealFiles({ districts: {} }, null, NOW), null);
});

// 서울 25개구가 아닌 이름이 섞여 들어오면 주소를 만들 수 없다. 조용히 담으면 파일 이름이
// undefined가 된다.
test("모르는 지역은 담지 않는다", () => {
  const files = buildDealFiles(sourceOf([deal({ district: "성남시" }), deal()]), null, NOW);
  assert.deepEqual(Object.keys(files), ["nowon"]);
});
