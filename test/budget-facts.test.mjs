import test from "node:test";
import assert from "node:assert/strict";
import { budgetFacts, budgetFactSentences } from "../scripts/budget-facts.mjs";

/**
 * 이 파일은 그날 데이터를 읽지 않는다.
 *
 * 수집 후 테스트가 그날 분포에 기대면 기능과 무관하게 그날치 수집이 통째로 유실된다.
 * 문턱을 넘느냐 마느냐는 코드가 정하는 것이므로, 넘는 표본과 못 넘는 표본을 여기서
 * 직접 만들어 확인한다.
 */

const deal = (over = {}) => ({
  district: "가구",
  dong: "가동",
  apt: "가아파트",
  area: 70,
  floor: 5,
  amount10k: 100000,
  date: "2026-08-01",
  buildYear: 2010,
  direct: false,
  ...over,
});

const many = (n, over = {}) => Array.from({ length: n }, () => deal(over));

test("가장 좁은 것과 가장 넓은 것은 표본이 얇아도 말한다", () => {
  const facts = budgetFacts([deal({ area: 40 }), deal({ area: 130 })], { year: 2026 });
  assert.equal(facts.total, 2);
  assert.equal(facts.span.min.area, 40);
  assert.equal(facts.span.max.area, 130);

  // 비중은 하나도 없어야 한다 — 두 건 위에서 "몇 %"를 말하면 거짓말이 된다.
  for (const key of ["smallHeavy", "largeHeavy", "old", "fresh", "directHeavy"]) {
    assert.equal(facts[key], undefined, `${key}를 두 건 위에서 말합니다`);
  }
});

test("좁은 것과 넓은 것이 같은 한 건뿐이면 그 문장을 만들지 않는다", () => {
  const facts = budgetFacts([deal({ area: 84 })], { year: 2026 });
  const sentences = budgetFactSentences(facts, "ko");
  assert.ok(!sentences.some((s) => s.includes("부터")), `한 건으로 폭을 말합니다: ${sentences[0]}`);
});

test("국민평형은 없으면 없다고, 얇으면 건수만, 충분하면 어디인지까지 말한다", () => {
  const none = budgetFacts(many(200, { area: 59 }), { year: 2026 });
  assert.equal(none.standard.count, 0);
  assert.equal(none.standard.districts, undefined);
  assert.match(budgetFactSentences(none, "ko").join(" "), /한 건도 없었습니다/);

  const thin = budgetFacts([...many(200, { area: 59 }), ...many(5, { area: 84 })], { year: 2026 });
  assert.equal(thin.standard.count, 5);
  assert.equal(thin.standard.districts, undefined, "다섯 건으로 어느 구인지를 말합니다");
  assert.match(budgetFactSentences(thin, "ko").join(" "), /5건뿐입니다/);

  const enough = budgetFacts(
    [
      ...many(200, { area: 59 }),
      ...many(40, { area: 84, district: "나구" }),
      ...many(10, { area: 84, district: "다구" }),
    ],
    { year: 2026 }
  );
  assert.equal(enough.standard.count, 50);
  assert.deepEqual(enough.standard.districts.map((d) => d.name), ["나구", "다구"]);
  assert.equal(enough.standard.districtCount, 2);
  assert.match(budgetFactSentences(enough, "ko").join(" "), /나구 40건/);
});

test("표본이 얇으면 비중은 아예 세지 않는다", () => {
  // 백 건은 문턱(120건) 아래다. 전부 소형이어도 소형이 많다고 말하면 안 된다.
  const thin = budgetFacts(many(100, { area: 40 }), { year: 2026 });
  assert.equal(thin.smallHeavy, undefined);

  const thick = budgetFacts(many(200, { area: 40 }), { year: 2026 });
  assert.equal(thick.smallHeavy.share, 1);
});

test("소형과 대형은 둘 중 하나만 말한다", () => {
  const facts = budgetFacts(
    [...many(150, { area: 40 }), ...many(100, { area: 120 })],
    { year: 2026 }
  );
  assert.ok(facts.smallHeavy && !facts.largeHeavy);
});

test("연식은 준공 30년과 5년 두 갈래로만 갈리고, 어느 쪽도 아니면 침묵한다", () => {
  const old = budgetFacts(many(200, { buildYear: 1990 }), { year: 2026 });
  assert.equal(old.old.years, 30);
  assert.equal(old.fresh, undefined);

  const fresh = budgetFacts(many(200, { buildYear: 2024 }), { year: 2026 });
  assert.equal(fresh.fresh.years, 5);
  assert.equal(fresh.old, undefined);

  const between = budgetFacts(many(200, { buildYear: 2005 }), { year: 2026 });
  assert.equal(between.old, undefined);
  assert.equal(between.fresh, undefined);
});

test("준공연도를 모르는 해에는 연식을 말하지 않는다", () => {
  const facts = budgetFacts(many(200, { buildYear: 1990 }), {});
  assert.equal(facts.old, undefined, "기준 연도가 없는데 연식을 셉니다");
});

test("직거래는 10%를 넘을 때만 말한다", () => {
  const light = budgetFacts([...many(190), ...many(10, { direct: true })], { year: 2026 });
  assert.equal(light.directHeavy, undefined);

  const heavy = budgetFacts([...many(150), ...many(50, { direct: true })], { year: 2026 });
  assert.equal(Math.round(heavy.directHeavy.share * 100), 25);
});

test("면적이 없는 거래는 세지 않는다", () => {
  const facts = budgetFacts([deal({ area: null }), deal({ area: 0 }), deal({ area: 84 })], { year: 2026 });
  assert.equal(facts.total, 1);
});

test("두 언어가 같은 개수의 문장을 낸다", () => {
  const facts = budgetFacts(
    [...many(150, { area: 40, buildYear: 1990 }), ...many(50, { area: 84, direct: true })],
    { year: 2026 }
  );
  assert.equal(
    budgetFactSentences(facts, "ko").length,
    budgetFactSentences(facts, "en").length
  );
  assert.ok(budgetFactSentences(facts, "ko").length >= 4);
});

test("아무것도 없으면 빈손으로 돌려준다", () => {
  assert.equal(budgetFacts([], { year: 2026 }), null);
  assert.deepEqual(budgetFactSentences(null, "ko"), []);
});
