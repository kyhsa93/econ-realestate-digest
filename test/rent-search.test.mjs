import test from "node:test";
import assert from "node:assert/strict";
import { buildPayload } from "../scripts/build-budget-deals.mjs";
import { buildDealFiles, buildRentFiles } from "../scripts/deal-files.mjs";
import { loadDealSearchPage } from "./helpers/deal-search-page.mjs";

const NOW = new Date("2026-08-17T00:00:00Z");

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

const rent = (deposit10k, extra = {}) => ({
  district: "노원구",
  dong: "하계동",
  apt: "극동아파트",
  area: 55.72,
  floor: 7,
  deposit10k,
  date: "2026-08-14",
  buildYear: 1988,
  ...extra,
});

const RENTS = [
  rent(40_000, { apt: "노원전세넷" }),
  rent(62_000, { apt: "노원전세여섯", area: 84.97, buildYear: 2023, date: "2026-08-15" }),
  rent(120_000, { apt: "노원전세열둘", renewal: true }),
  rent(10_000, { apt: "노원월세", monthlyRent10k: 80 }),
  rent(30_000, { apt: "노원월세비싼", monthlyRent10k: 220, date: "2026-08-16" }),
  rent(50_000, { district: "강남구", dong: "역삼동", apt: "강남전세", area: 84.97 }),
];

const SALE_SOURCE = { period: "202608", districts: { seoul: [deal(85_000)] } };

const FIXTURE = (() => {
  const payload = buildPayload(SALE_SOURCE, NOW);
  const deals = buildDealFiles(SALE_SOURCE, NOW) ?? {};
  const rents = buildRentFiles({ period: "202608", districts: { seoul: RENTS } }, NOW) ?? {};
  return {
    budget: payload.screen,
    search: payload.search,
    deals: Object.fromEntries(Object.values(deals).map((file) => [file.district, file])),
    rents: Object.fromEntries(Object.values(rents).map((file) => [file.district, file])),
  };
})();

const open = (options = {}) => loadDealSearchPage({ ...FIXTURE, ...options });

const names = (html) => [...html.matchAll(/<span class="place">([^<]+)<\/span>/g)].map((m) => m[1]);

test("전세를 고르고 지역을 고르면 그 지역 전세만 나온다", async () => {
  const page = await open();
  await page.chooseKind("jeonse");
  await page.chooseDistrict("노원구");

  const listed = names(page.resultHtml());
  assert.ok(listed.every((row) => row.startsWith("노원구")), listed.join(" / "));
  assert.ok(listed.some((row) => row.includes("노원전세넷")));
  assert.ok(!listed.some((row) => row.includes("노원월세")), "월세가 전세 목록에 섞였다");
  assert.ok(!listed.some((row) => row.includes("강남전세")), "다른 지역이 섞였다");
});

test("월세를 고르면 보증금만 있는 계약은 빠진다", async () => {
  const page = await open();
  await page.chooseKind("wolse");
  await page.chooseDistrict("노원구");

  const listed = names(page.resultHtml());
  assert.deepEqual(listed.map((row) => row.split(" ").pop()).sort(), ["노원월세", "노원월세비싼"]);
});

test("월세는 보증금과 월세를 함께 적는다", async () => {
  const page = await open();
  await page.chooseKind("wolse");
  await page.chooseDistrict("노원구");

  assert.match(page.resultHtml(), /1억원 \/ 월 80만원/);
});

test("전월세는 지역을 고르기 전까지 목록을 만들지 않는다", async () => {
  const page = await open();
  await page.chooseKind("jeonse");

  assert.match(page.resultHtml(), /지역을 하나 골라야/);
  assert.equal(names(page.resultHtml()).length, 0, "서울 전체인데 목록을 그렸다");
});

test("보증금 구간으로 좁힌다", async () => {
  const page = await open();
  await page.chooseKind("jeonse");
  await page.chooseDistrict("노원구");
  await page.chooseDeposit("5-7");

  assert.deepEqual(names(page.resultHtml()).map((row) => row.split(" ").pop()), ["노원전세여섯"]);
});

test("월세 구간으로 좁힌다", async () => {
  const page = await open();
  await page.chooseKind("wolse");
  await page.chooseDistrict("노원구");
  await page.chooseRent("200");

  assert.deepEqual(names(page.resultHtml()).map((row) => row.split(" ").pop()), ["노원월세비싼"]);
});

test("면적·연식·단지명 조건은 전월세에도 걸린다", async () => {
  const page = await open();
  await page.chooseKind("jeonse");
  await page.chooseDistrict("노원구");
  await page.chooseArea("60-85");

  assert.deepEqual(names(page.resultHtml()).map((row) => row.split(" ").pop()), ["노원전세여섯"]);

  await page.chooseArea("all");
  await page.typeApt("열둘");
  assert.deepEqual(names(page.resultHtml()).map((row) => row.split(" ").pop()), ["노원전세열둘"]);
});

test("갱신계약은 표시가 붙는다", async () => {
  const page = await open();
  await page.chooseKind("jeonse");
  await page.chooseDistrict("노원구");

  assert.match(page.resultHtml(), /<span class="tag">갱신<\/span>/);
});

test("유형에 따라 조건 칸을 갈아 끼운다", async () => {
  const page = await open();
  assert.equal(page.fieldHidden("budget-field"), false);
  assert.equal(page.fieldHidden("deposit-field"), true);
  assert.equal(page.fieldHidden("rent-field"), true);
  assert.equal(page.fieldHidden("direct-field"), false);

  await page.chooseKind("jeonse");
  assert.equal(page.fieldHidden("budget-field"), true);
  assert.equal(page.fieldHidden("deposit-field"), false);
  assert.equal(page.fieldHidden("rent-field"), true, "전세에 월세 칸이 열렸다");
  assert.equal(page.fieldHidden("direct-field"), true, "전월세에 직거래 칸이 남았다");

  await page.chooseKind("wolse");
  assert.equal(page.fieldHidden("rent-field"), false);
});

test("고른 유형과 조건이 주소에 남는다", async () => {
  const page = await open();
  await page.chooseKind("wolse");
  await page.chooseDistrict("노원구");
  await page.chooseDeposit("1-3");
  await page.chooseRent("50-100");

  const query = page.sandbox.location.search;
  assert.match(query, /kind=wolse/);
  assert.match(query, /deposit=1-3/);
  assert.match(query, /rent=50-100/);

  await page.chooseKind("sale");
  assert.ok(!page.sandbox.location.search.includes("kind="), page.sandbox.location.search);
  assert.ok(!page.sandbox.location.search.includes("deposit="), "매매인데 보증금 조건이 남았다");
});

test("주소에 적힌 유형과 조건으로 시작한다", async () => {
  const page = await open({ query: "?kind=jeonse&district=노원구&deposit=10" });

  assert.deepEqual(names(page.resultHtml()).map((row) => row.split(" ").pop()), ["노원전세열둘"]);
  assert.match(page.depositOptions(), /value="10" selected/);
});

test("전월세 자료가 없는 지역은 그렇다고 말한다", async () => {
  const page = await open({ rents: {} });
  await page.chooseKind("jeonse");
  await page.chooseDistrict("노원구");

  assert.match(page.resultHtml(), /전월세 자료가 아직 없습니다/);
});

test("전월세를 보면 안내 문구도 전월세 쪽으로 바뀐다", async () => {
  const page = await open();
  assert.match(page.byId("search-note").textContent, /아파트 매매 실거래/);

  await page.chooseKind("jeonse");
  assert.match(page.byId("search-note").textContent, /아파트 전월세 계약/);
});
