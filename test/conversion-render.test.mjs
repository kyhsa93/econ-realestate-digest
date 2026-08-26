import test from "node:test";
import assert from "node:assert/strict";
import { buildPayload } from "../scripts/build-conversion.mjs";
import { loadConversionPage } from "./helpers/conversion-page.mjs";

const NOW = new Date("2026-08-26T00:00:00Z");

const rent = (extra) => ({
  district: "노원구",
  dong: "하계동",
  apt: "극동아파트",
  area: 84.9,
  date: "2026-08-14",
  renewal: false,
  ...extra,
});

/** 자치구 하나당 단지 셋씩 - MIN_PAIRS를 넘겨야 칸이 만들어진다. */
function dealsFor(district, { jeonse10k, deposit10k, monthly10k, area = 84.9 }) {
  return ["가", "나", "다"].flatMap((name) => [
    rent({ district, apt: `${district}${name}`, area, deposit10k: jeonse10k }),
    rent({ district, apt: `${district}${name}`, area, deposit10k, monthlyRent10k: monthly10k }),
  ]);
}

const DEALS = [
  ...dealsFor("노원구", { jeonse10k: 50_000, deposit10k: 20_000, monthly10k: 125 }),
  ...dealsFor("강남구", { jeonse10k: 95_000, deposit10k: 40_000, monthly10k: 220 }),
  ...dealsFor("노원구", { jeonse10k: 30_000, deposit10k: 10_000, monthly10k: 70, area: 45 }),
];

const RATES = {
  rentLoan: [{ options: [{ min: 3.3, max: 5.5, avg: 4 }] }],
  deposit: [{ options: [{ term: 12, rate: 3.8 }] }],
};

const CONVERSION = buildPayload({ deals: DEALS, rates: RATES, months: ["202603", "202608"], now: NOW });

const open = (extra = {}) => loadConversionPage({ conversion: CONVERSION, ...extra });

test("아무것도 고르지 않아도 첫 자치구의 비교가 나온다", async () => {
  const page = await open();
  const html = page.resultHtml();

  assert.match(html, /전세/);
  assert.match(html, /월세/);
  assert.match(html, /월 실부담/);
});

test("가진 돈이 늘면 전세 쪽 대출이자가 줄어든다", async () => {
  const cost = (html) => Number(/<div class="cost">([\d,.]+)만원<\/div>/.exec(html)?.[1]?.replace(/,/g, ""));

  const page = await open({ query: "?district=노원구&band=60to85&cash=2" });
  const poor = cost(page.resultHtml());

  await page.typeCash(4);
  const rich = cost(page.resultHtml());

  assert.ok(poor > rich, `가진 돈을 2억에서 4억으로 늘렸는데 부담이 ${poor} → ${rich}이다`);

  // 보증금 5억을 다 내고 나면 빌릴 것이 없다.
  await page.typeCash(5);
  assert.ok(!page.resultHtml().includes("빌리는 돈"), "5억 전세에 5억을 내고도 빌리고 있다");
});

test("가진 돈이 보증금의 20%도 안 되면 그쪽만 불가능하다고 말한다", async () => {
  // 강남 9.5억 전세는 80%를 빌려도 1억으로는 못 채운다. 반면 보증금 4억짜리 월세는
  // 같은 1억으로 성립하므로, 불가능하다는 말은 전세 카드에만 붙어야 한다.
  const page = await open({ query: "?district=강남구&band=60to85&cash=1" });
  const cards = page.resultHtml().split('<div class="option');

  const jeonseCard = cards.find((c) => c.includes(">전세<"));
  const wolseCard = cards.find((c) => c.includes(">월세<"));

  assert.match(jeonseCard, /보증금의 80%까지 빌려도/);
  assert.ok(!jeonseCard.includes("월 실부담"), "성립하지 않는 전세에 월 비용을 적었다");
  assert.match(wolseCard, /월 실부담/);
});

test("한쪽이 불가능하면 어느 쪽이 싸다고 말하지 않는다", async () => {
  const page = await open({ query: "?district=강남구&band=60to85&cash=1" });
  assert.match(page.resultHtml(), /가진 돈으로는 한쪽을 고를 수 없다/);
});

test("고른 자치구가 표에서 굵게 표시된다", async () => {
  const page = await open({ query: "?district=노원구&band=60to85&cash=3" });
  const table = page.tableHtml();

  assert.match(table, /<tr class="spot"><td>노원구/);
  assert.ok(!/<tr class="spot"><td>강남구/.test(table), "고르지 않은 자치구가 굵게 표시됐다");
});

test("자치구를 바꾸면 그 자치구에 있는 면적대만 고를 수 있다", async () => {
  const page = await open({ query: "?district=노원구&band=under60&cash=3" });
  assert.match(page.bandOptions(), /under60/);

  await page.chooseDistrict("강남구");
  assert.ok(!page.bandOptions().includes("under60"), "강남구에 없는 면적대가 남아 있다");
});

test("고른 조건이 주소에 남아 새로고침해도 그대로다", async () => {
  const page = await open();
  await page.chooseDistrict("강남구");
  await page.typeCash(7.5);

  const search = page.search();
  assert.match(search, /district=%EA%B0%95%EB%82%A8%EA%B5%AC|district=강남구/);
  assert.match(search, /cash=7\.5/);
});

test("첫 문단은 빌드가 만든 문장을 그대로 쓴다", async () => {
  const page = await open();
  assert.equal(page.leadText(), CONVERSION.seoul.leadKo);
});

test("영어로 바꾸면 문장도 표 머리도 영어가 된다", async () => {
  const page = await open();
  await page.toggleLang();

  assert.equal(page.leadText(), CONVERSION.seoul.leadEn);
  assert.match(page.tableHtml(), /District/);
  assert.match(page.resultHtml(), /Real monthly cost|cannot cover/);
});

test("자료가 없으면 조건 칸을 감추고 그렇다고 말한다", async () => {
  const page = await loadConversionPage({ conversion: null });

  assert.equal(page.byId("calc-controls").hidden, true);
  assert.match(page.resultHtml(), /아직 전환율을 낼 자료가 없습니다/);
});

test("불러오다 실패하면 다시 시도할 수 있다", async () => {
  const page = await loadConversionPage({ conversion: undefined, status: 500 });
  assert.match(page.resultHtml(), /다시 시도/);
});
