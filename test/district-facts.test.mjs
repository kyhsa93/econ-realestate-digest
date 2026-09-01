import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { districtFacts, factSentences } from "../scripts/district-facts.mjs";
import { DISTRICT_PAGES, DISTRICT_SLUGS } from "../scripts/district-slugs.mjs";

const root = path.resolve(import.meta.dirname, "..");
const dealsOf = (name) =>
  readFile(path.join(root, `docs/data/deals-${DISTRICT_SLUGS[name]}.json`), "utf8")
    .then(JSON.parse)
    .catch(() => null);

const sentencesFor = async (name) => factSentences(districtFacts(await dealsOf(name)), "ko");

/**
 * 문턱을 하나도 넘지 않는 거래 200건.
 *
 * 실제 자치구를 골라 "이 구는 튀는 데가 없다"고 단언하던 검사가 있었는데, 동대문구에서
 * 한 단지가 5%를 넘은 날 깨졌다. 코드는 그대로인데 시장이 움직여서 깨진 것이고, 이
 * 저장소에서 그런 단언은 수집 후 테스트를 막아 그날 데이터를 통째로 날린다.
 *
 * 그래서 동작은 여기서 만든 표본으로 확인한다. 한 동이 30%(몰림 40%·흩어짐 20% 어느
 * 쪽도 아님), 전용 70㎡(소형 60·대형 85 어느 쪽도 아님), 준공 15년(노후 30·신축 5 어느
 * 쪽도 아님), 단지 스물다섯 곳에 고르게(한 단지 4% < 5%), 직거래 없음.
 */
const PLAIN_YEAR = 2026;

function plainDeals(over = (deal) => deal) {
  const deals = [];
  for (let i = 0; i < 200; i += 1) {
    deals.push(
      over({
        dong: i < 60 ? "몰린동" : `흩어진동${i % 9}`,
        apt: `단지${i % 25}`,
        area: 70,
        floor: 5,
        amount10k: 100000,
        date: "2026-08-01",
        buildYear: PLAIN_YEAR - 15,
        direct: false,
      }, i)
    );
  }
  return { deals, updatedAt: `${PLAIN_YEAR}-08-20T00:00:00.000Z`, periods: ["202606", "202607", "202608"] };
}

const NOTABLE = ["concentrated", "spreadOut", "smallHeavy", "largeHeavy", "old", "fresh", "oneComplex", "directHeavy"];

test("자치구 페이지가 서로 다른 이야기를 한다", async () => {
  // 이 검사가 있는 이유. 애드센스가 "가치가 별로 없는 콘텐츠"로 반려했을 때, 스물다섯
  // 개 자치구 페이지는 한 문장 틀에 숫자만 바꿔 넣은 것이었다 — 평당 얼마, 평균의 몇
  // 배, 몇 번째. 심사자가 다섯 장을 넘겨보면 같은 페이지를 다섯 번 본다.
  //
  // 그래서 여기서 재는 것은 분량이 아니라 **말하는 종류**다. 같은 문장을 길게 늘여도
  // 통과하지 못하게.
  const shapes = new Map();
  for (const { name } of DISTRICT_PAGES) {
    const facts = districtFacts(await dealsOf(name));
    if (!facts) continue;
    const shape = ["concentrated", "spreadOut", "smallHeavy", "largeHeavy", "old", "fresh", "oneComplex", "directHeavy", "typical"]
      .filter((k) => facts[k])
      .join("+");
    shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
  }

  assert.ok(shapes.size >= 8, `관찰 조합이 ${shapes.size}가지뿐입니다: ${[...shapes.keys()].join(" / ")}`);
  const biggest = Math.max(...shapes.values());
  assert.ok(
    biggest <= DISTRICT_PAGES.length / 3,
    `한 조합이 ${biggest}개 구를 덮습니다 — 문턱이 느슨해 다시 하나의 틀이 되었습니다`
  );
});

test("표본이 얇은 구에서는 비중을 말하지 않는다", async () => {
  // 종로구는 석 달 신고가 백 건이 안 된다. 그 위에서 "열 건 중 넷이 대형"이라고 하면
  // 스물몇 건짜리 이야기가 되고, 한 단지가 입주하면 다음 주에 뒤집힌다. 표본 위에
  // 조건을 얹으면 건수가 거짓말을 한다는 건 실거래 검색에서 이미 겪은 일이다.
  const thin = districtFacts({ deals: [{ dong: "가", apt: "나", area: 84, amount10k: 100000, buildYear: 1990 }] });
  assert.ok(thin.top, "가장 비싼 거래는 한 건만 있어도 사실이라 말한다");
  for (const key of ["concentrated", "spreadOut", "smallHeavy", "largeHeavy", "old", "fresh", "oneComplex", "directHeavy", "typical"]) {
    assert.equal(thin[key], undefined, `${key}는 표본이 얇으면 말하지 않아야 합니다`);
  }
  assert.equal(districtFacts({ deals: [] }), null);
  assert.equal(districtFacts(null), null);
  assert.deepEqual(factSentences(null), []);
});

test("말할 것이 없으면 문단이 통째로 빈다", async () => {
  // 비어 있는 것이 정상 경로다. 억지로 채우면 다시 한 틀이 된다.
  const only = factSentences(districtFacts({ deals: [{ dong: "가", apt: "나", area: 84, amount10k: 500000 }] }), "ko");
  assert.equal(only.length, 1, "얇은 구는 가장 비싼 거래 한 문장뿐이다");
  assert.match(only[0], /가장 비싸게 팔린/);
});

test("한 단지가 구를 대표해 버리면 그렇다고 말한다", async () => {
  // 대단지 입주장이면 그 구의 평균은 그 단지의 평균에 가깝고, 시세를 읽는 사람이
  // 알아야 하는 사실이다.
  const one = plainDeals((deal, i) => (i < 20 ? { ...deal, dong: "몰린동", apt: "대표단지" } : deal));
  assert.match(factSentences(districtFacts(one), "ko").join(" "), /한 단지가 유독 많이 팔렸습니다/);
  assert.doesNotMatch(factSentences(districtFacts(plainDeals()), "ko").join(" "), /한 단지가 유독/);
});

test("튀는 데가 없으면 그렇다고 말한다", async () => {
  // 지어내는 대신 재고서 아무것도 안 나왔다고 말한다. 문턱을 하나라도 넘으면
  // 이 문장이 나오면 안 된다 — 그러면 다시 모든 페이지에 붙는 한 줄이 된다.
  assert.match(factSentences(districtFacts(plainDeals()), "ko").join(" "), /튀는 데가 없습니다/);

  const small = plainDeals((deal) => ({ ...deal, area: 40 }));
  assert.doesNotMatch(factSentences(districtFacts(small), "ko").join(" "), /튀는 데가 없습니다/);
});

test("어느 구든 튀는 데가 없다는 말과 문턱을 넘은 관찰이 같이 나오지 않는다", async () => {
  // 실제 자료로 확인하되, 시장이 움직여도 깨지지 않는 것만 단언한다 — 어느 구가 어느
  // 관찰에 걸리는지는 데이터가 정하지만, 둘이 같이 나올 수 없다는 것은 코드가 정한다.
  //
  // 표본이 문턱(120건) 아래인 구는 둘 다 없는 것이 맞다. 재 보지도 않고 "튀는 데가
  // 없다"고 말하면 안 되기 때문이다 — 종로구가 실제로 그 상태다.
  for (const { name } of DISTRICT_PAGES) {
    const facts = districtFacts(await dealsOf(name));
    if (!facts) continue;
    assert.ok(
      !(facts.typical && NOTABLE.some((key) => facts[key])),
      `${name}: 문턱을 넘은 관찰과 "튀는 데가 없다"가 같이 나옵니다`
    );
  }
});

test("직거래가 많으면 시세를 그대로 읽지 말라고 적는다", async () => {
  // 직거래에는 증여성 거래와 시행사 정산이 섞인다. 스물다섯 구가 0%에서 41%까지
  // 갈리는데 시세표에는 흔적이 없어서, 평균만 보면 알 수 없는 사실이다.
  const heavy = plainDeals((deal, i) => (i < 30 ? { ...deal, direct: true } : deal));
  assert.match(factSentences(districtFacts(heavy), "ko").join(" "), /직거래가 \d+%/);

  const light = plainDeals((deal, i) => (i < 10 ? { ...deal, direct: true } : deal));
  assert.doesNotMatch(factSentences(districtFacts(light), "ko").join(" "), /직거래가 \d+%/);
});

test("영문 문단도 같은 관찰을 말한다", async () => {
  const ko = await sentencesFor("노원구");
  const en = factSentences(districtFacts(await dealsOf("노원구")), "en");
  assert.equal(ko.length, en.length, "한쪽에만 있는 문장이 있으면 안 됩니다");
  // 한글이 남아 있는 것은 정상이다 — 상계동과 중계동 동진신안에는 영어 이름이 없고,
  // 기존 시세 문장도 "Apartments in 강남구"라고 쓴다. 없어야 하는 것은 한국어 *문장*이라
  // 종결어미로 잡는다.
  assert.doesNotMatch(en.join(" "), /입니다|습니다|합니다/, "영문 문단에 한국어 문장이 섞였습니다");
  assert.match(en.join(" "), /reported/, "영문 문단이 영어로 쓰여 있어야 합니다");
});

test("창을 밝히고 시작한다", async () => {
  // 위 시세표는 최근 네 주 계약분이고 여기 숫자는 석 달 신고분이라, 두 숫자가 어긋나
  // 보일 때 어느 쪽이 무엇인지 읽는 사람이 알 수 있어야 한다.
  const lines = await sentencesFor("노원구");
  assert.match(lines[0], /최근 네 주가 아니라/);
  assert.match(lines[0], /개월 동안 신고된/);
});
