import test from "node:test";
import assert from "node:assert/strict";
import {
  CAP_MISS_BELOW,
  MIN_RENEWALS,
  classify,
  isClosedMonth,
  renewalFacts,
  renewalSentences,
  seoulTally,
  tally,
} from "../scripts/renewal-facts.mjs";
import { buildPayload } from "../scripts/build-renewal-facts.mjs";
import { districtRenewalHtml } from "../scripts/prerender.mjs";

const NOW = new Date("2026-08-26T00:00:00Z");

const renewal = (extra = {}) => ({
  sggCd: 11350,
  dealYear: 2026,
  dealMonth: 5,
  dealDay: 10,
  contractType: "갱신",
  preDeposit: "50,000",
  preMonthlyRent: "",
  deposit: "52,500",
  monthlyRent: 0,
  useRRRight: "사용",
  ...extra,
});

test("신고 기한이 남은 달은 아직 닫히지 않았다", () => {
  // 7월 계약은 8월 30일까지 신고할 수 있으므로 8월 26일에는 아직 열려 있다.
  assert.equal(isClosedMonth(2026, 7, NOW), false);
  assert.equal(isClosedMonth(2026, 6, NOW), true);
  assert.equal(isClosedMonth(2026, 8, NOW), false);
});

test("아직 닫히지 않은 달의 신고는 세지 않는다", () => {
  const counts = tally([renewal({ dealMonth: 5 }), renewal({ dealMonth: 7 }), renewal({ dealMonth: 8 })], NOW);
  assert.equal(counts.renewals, 1);
});

test("신규 계약과 이전 조건이 없는 신고는 갱신으로 세지 않는다", () => {
  const counts = tally(
    [renewal(), renewal({ contractType: "신규" }), renewal({ preDeposit: "" })],
    NOW
  );
  assert.equal(counts.renewals, 1);
});

test("상한에 닿았는지는 5%보다 조금 아래에서 가른다", () => {
  assert.equal(CAP_MISS_BELOW, 4.5);

  const reached = tally([renewal({ preDeposit: "50,000", deposit: "52,500" })], NOW); // +5.0%
  assert.equal(reached.capMissed, 0);
  assert.equal(reached.rightUsed, 1);

  const missed = tally([renewal({ preDeposit: "50,000", deposit: "51,000" })], NOW); // +2.0%
  assert.equal(missed.capMissed, 1);
});

test("요구권을 쓰지 않은 갱신은 상한 통계에 넣지 않는다", () => {
  const counts = tally([renewal({ useRRRight: "" }), renewal()], NOW);
  assert.equal(counts.renewals, 2);
  assert.equal(counts.rightUsed, 1);
});

test("전세로 살던 세입자가 월세로 바꾼 것을 센다", () => {
  const counts = tally(
    [
      renewal(),
      renewal({ deposit: "10,000", monthlyRent: 130 }),
      renewal({ preDeposit: "10,000", preMonthlyRent: "130", deposit: "50,000", monthlyRent: 0 }),
    ],
    NOW
  );

  assert.equal(counts.fromJeonse, 2);
  assert.equal(counts.toWolse, 1);
  assert.equal(counts.toWolseShare, 50);
});

test("유형이 바뀐 갱신은 인상률을 재지 않는다", () => {
  // 보증금 5억 전세에서 보증금 1억 + 월세로 가면 산술적으로는 -80%지만
  // 그것은 인상률이 아니라 유형이 바뀐 것이다.
  const row = classify(renewal({ deposit: "10,000", monthlyRent: 130 }));
  assert.equal(row.switched, "toWolse");
  assert.equal(row.changePct, undefined);
});

test("월세끼리는 보증금과 월세를 묶어 견준다", () => {
  const row = classify(
    renewal({ preDeposit: "10,000", preMonthlyRent: "100", deposit: "10,000", monthlyRent: 110 })
  );
  // 월세만 100만원에서 110만원이 됐다. 보증금까지 묶으면
  // (1억 + 110×100) ÷ (1억 + 100×100) = +5.0%이지, 월세만 보고 +10%가 아니다.
  assert.equal(Math.round(row.changePct * 100) / 100, 5);
});

const many = (n, extra) => Array.from({ length: n }, (_, i) => renewal({ dealDay: (i % 28) + 1, ...extra }));

test("표본이 얇은 구는 말하지 않는다", () => {
  const thin = tally(many(MIN_RENEWALS - 1, { preDeposit: "50,000", deposit: "51,000" }), NOW);
  const seoul = { capMissShare: 44.8, toWolseShare: 7.5 };
  assert.equal(renewalFacts(thin, seoul), null);
});

test("서울보다 상한을 못 채운 구와 채운 구를 갈라 말한다", () => {
  const seoul = { capMissShare: 44.8, toWolseShare: 7.5 };

  const missed = tally(
    [...many(180, { preDeposit: "50,000", deposit: "51,000" }), ...many(120, { preDeposit: "50,000", deposit: "52,500" })],
    NOW
  );
  assert.equal(renewalFacts(missed, seoul).capMissed.share, 60);

  const reached = tally(
    [...many(60, { preDeposit: "50,000", deposit: "51,000" }), ...many(240, { preDeposit: "50,000", deposit: "52,500" })],
    NOW
  );
  assert.equal(renewalFacts(reached, seoul).capReached.share, 20);
});

test("서울 언저리에 있는 구는 상한 이야기를 갖지 않는다", () => {
  const seoul = { capMissShare: 44.8, toWolseShare: 7.5 };
  const middling = tally(
    [...many(135, { preDeposit: "50,000", deposit: "51,000" }), ...many(165, { preDeposit: "50,000", deposit: "52,500" })],
    NOW
  );
  assert.equal(renewalFacts(middling, seoul)?.capMissed, undefined);
  assert.equal(renewalFacts(middling, seoul)?.capReached, undefined);
});

test("월세 전환은 서울 대비 배수로 문턱을 넘는다", () => {
  const seoul = { capMissShare: 44.8, toWolseShare: 7.5 };

  const heavy = tally(
    [...many(40, { deposit: "10,000", monthlyRent: 130 }), ...many(260)],
    NOW
  );
  assert.equal(renewalFacts(heavy, seoul).toWolseHeavy.share, 13.3);

  const light = tally([...many(9, { deposit: "10,000", monthlyRent: 130 }), ...many(291)], NOW);
  assert.equal(renewalFacts(light, seoul).toWolseLight.share, 3);
});

test("문장은 그 구의 값과 서울 값을 함께 말한다", () => {
  const sentences = renewalSentences(
    { capMissed: { share: 58.9, seoul: 44.8, counted: 824 } },
    "ko"
  );
  assert.equal(sentences.length, 1);
  assert.match(sentences[0], /58\.9%/);
  assert.match(sentences[0], /서울 전체는 44\.8%/);

  const en = renewalSentences({ capMissed: { share: 58.9, seoul: 44.8, counted: 824 } }, "en");
  assert.match(en[0], /5% cap/);
});

test("관찰이 없으면 문단이 통째로 비어 화면에서 숨는다", () => {
  assert.deepEqual(renewalSentences(null, "ko"), []);
  assert.equal(districtRenewalHtml(null, "ko"), "");
});

test("빌드 결과에는 문턱을 넘은 구만 들어간다", () => {
  const byDistrict = {
    마포구: [...many(180, { preDeposit: "50,000", deposit: "51,000" }), ...many(120, { preDeposit: "50,000", deposit: "52,500" })],
    종로구: many(10, { preDeposit: "50,000", deposit: "51,000" }),
  };

  const payload = buildPayload({ byDistrict, now: NOW });

  assert.ok(payload.districts["마포구"]);
  assert.equal(payload.districts["종로구"], undefined);
  assert.ok(payload.seoul.renewals > 0);
});

test("갱신 신고가 하나도 없으면 만들지 않는다", () => {
  assert.equal(buildPayload({ byDistrict: { 마포구: [renewal({ contractType: "신규" })] }, now: NOW }), null);
  assert.equal(seoulTally({}, NOW).renewals, 0);
});

// --- 갱신 vs 신규 전세 격차 -------------------------------------------------

const jeonse = (extra = {}) => ({
  sggCd: 11350,
  aptNm: "가상아파트",
  excluUseAr: 59.94,
  dealYear: 2026,
  dealMonth: 5,
  dealDay: 10,
  contractType: "신규",
  deposit: "50,000",
  monthlyRent: 0,
  ...extra,
});

const market = (n, amount) =>
  Array.from({ length: n }, (_, i) => jeonse({ deposit: String(amount), dealDay: 1 + i }));

test("갱신 보증금을 같은 칸의 신규 중앙값과 견준다", async () => {
  const { renewalGap } = await import("../scripts/renewal-facts.mjs");
  const items = [
    ...market(3, 50000),
    jeonse({ contractType: "갱신", deposit: "45,000" }), // 10% 싸다
  ];
  const gap = renewalGap(items, NOW);

  assert.equal(gap.gapMatched, 1);
  assert.equal(gap.gapMedian, -10);
  assert.equal(gap.gapCheaperShare, 100);
});

test("신규가 세 건에 못 미치는 칸은 견줄 시세로 쓰지 않는다", async () => {
  const { renewalGap, MIN_MARKET_DEALS } = await import("../scripts/renewal-facts.mjs");
  assert.equal(MIN_MARKET_DEALS, 3, "두 건으로 낸 중앙값은 그냥 두 값의 평균이다");

  const thin = [...market(2, 50000), jeonse({ contractType: "갱신", deposit: "45,000" })];
  assert.equal(renewalGap(thin, NOW).gapMatched, 0);
});

test("평형이 다르면 같은 단지라도 견주지 않는다", async () => {
  const { renewalGap } = await import("../scripts/renewal-facts.mjs");
  const items = [
    ...market(3, 50000),
    jeonse({ contractType: "갱신", deposit: "45,000", excluUseAr: 84.97 }),
  ];
  assert.equal(renewalGap(items, NOW).gapMatched, 0, "59㎡ 시세로 84㎡ 갱신을 쟀다");
});

test("반전세는 순수 전세와 견주지 않는다", async () => {
  const { renewalGap } = await import("../scripts/renewal-facts.mjs");
  // 보증금과 월세를 한 값으로 묶으려면 전환율을 먼저 가정해야 한다.
  const items = [
    ...market(3, 50000),
    jeonse({ contractType: "갱신", deposit: "30,000", monthlyRent: 60 }),
  ];
  assert.equal(renewalGap(items, NOW).gapMatched, 0);
});

test("기한이 남은 달은 격차에서도 뺀다", async () => {
  const { renewalGap } = await import("../scripts/renewal-facts.mjs");
  const open = { dealYear: 2026, dealMonth: 8 };
  const items = [
    ...market(3, 50000).map((r) => ({ ...r, ...open })),
    jeonse({ contractType: "갱신", deposit: "45,000", ...open }),
  ];
  assert.equal(renewalGap(items, NOW).gapMatched, 0);
});

test("견줄 값이 잘못 붙은 것은 버린다", async () => {
  const { renewalGap, GAP_OUTLIER } = await import("../scripts/renewal-facts.mjs");
  assert.equal(GAP_OUTLIER, 90);
  const items = [...market(3, 50000), jeonse({ contractType: "갱신", deposit: "1,000" })];
  assert.equal(renewalGap(items, NOW).gapMatched, 0, "98% 어긋난 것을 격차로 셌다");
});

test("말하는 문턱이 표본 잡음 바깥에 있다", async () => {
  const { MIN_GAP_SAMPLE, GAP_WIDE_RATIO, GAP_NARROW_RATIO } = await import(
    "../scripts/renewal-facts.mjs"
  );
  // 서울 표본을 60건씩 다시 뽑으면 서울과 똑같은 구도 -12.5% ~ -5.0%에 떨어진다.
  // 두 문턱은 그 바깥이어야 한다 - 안쪽이면 우연이 문장을 만든다.
  const SEOUL = -8.9;
  const NOISE_LOW = -12.5;
  const NOISE_HIGH = -5.0;

  assert.equal(MIN_GAP_SAMPLE, 60);
  assert.ok(SEOUL * GAP_WIDE_RATIO < NOISE_LOW, `유독 싸다 문턱 ${(SEOUL * GAP_WIDE_RATIO).toFixed(1)}%가 잡음 안에 있다`);
  assert.ok(SEOUL * GAP_NARROW_RATIO > NOISE_HIGH, `차이 없다 문턱 ${(SEOUL * GAP_NARROW_RATIO).toFixed(1)}%가 잡음 안에 있다`);
});

test("격차가 0이면 0% 싸다고 쓰지 않는다", async () => {
  const { renewalSentences } = await import("../scripts/renewal-facts.mjs");
  const flat = renewalSentences({ renewGapNarrow: { gap: 0, seoul: -9.7, cheaper: 22.1, counted: 95 } })[0];
  assert.match(flat, /사실상 차이가 없습니다/);
  assert.ok(!/0\.0% /.test(flat), `"0.0% 싸다"는 문장이 아니다: ${flat}`);

  const higher = renewalSentences({ renewGapNarrow: { gap: 1.4, seoul: -9.7, cheaper: 31, counted: 120 } })[0];
  assert.match(higher, /오히려 1\.4% 높습니다/, "갱신이 더 비싼 경우를 싸다고 적었다");
});

test("문턱을 넘은 구만 격차를 말한다", async () => {
  const { renewalFacts } = await import("../scripts/renewal-facts.mjs");
  const seoul = { gapMedian: -9.7, capMissShare: 44.8, toWolseShare: 7.5 };
  const base = { rightUsed: 0, fromJeonse: 0, capMissShare: null, toWolseShare: null, gapCheaperShare: 80 };

  const thin = renewalFacts({ ...base, gapMatched: 59, gapMedian: -20 }, seoul);
  assert.equal(thin, null, "표본 59건으로 격차를 말했다");

  const ordinary = renewalFacts({ ...base, gapMatched: 300, gapMedian: -9.5 }, seoul);
  assert.equal(ordinary, null, "서울과 다를 것 없는 구가 말을 했다");

  const wide = renewalFacts({ ...base, gapMatched: 156, gapMedian: -16.7 }, seoul);
  assert.ok(wide?.renewGapWide, "유독 싼 구가 말을 안 했다");

  const narrow = renewalFacts({ ...base, gapMatched: 95, gapMedian: 0 }, seoul);
  assert.ok(narrow?.renewGapNarrow, "차이 없는 구가 말을 안 했다");
});
