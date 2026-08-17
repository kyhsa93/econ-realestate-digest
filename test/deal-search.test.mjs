import test from "node:test";
import assert from "node:assert/strict";
import { buildPayload } from "../scripts/build-budget-deals.mjs";
import { buildDealFiles } from "../scripts/deal-files.mjs";
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

const DEALS = [
  deal(85_000, { apt: "노원팔억가", direct: false }),
  deal(86_000, { apt: "노원팔억나", date: "2026-08-15", area: 84.97, buildYear: 2023 }),
  deal(95_000, { apt: "노원구억", direct: true }),
  deal(85_500, { district: "도봉구", dong: "창동", apt: "도봉팔억", floor: 12, date: "2026-08-16" }),
  deal(120_000, { district: "강남구", dong: "역삼동", apt: "강남십이억", buildYear: null }),
];

function fixtureOf(deals, period = "202608") {
  const payload = buildPayload({ period, districts: { seoul: deals } }, NOW);
  const files = buildDealFiles({ period, districts: { seoul: deals } }, NOW) ?? {};
  return {
    budget: payload.screen,
    search: payload.search,
    deals: Object.fromEntries(Object.values(files).map((file) => [file.district, file])),
  };
}

const FIXTURE = fixtureOf(DEALS);

const open = (extra = {}) => loadDealSearchPage({ ...FIXTURE, ...extra });

test("지역과 예산을 같이 걸면 그 칸의 거래만 나온다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");
  await page.chooseBudget("8");

  const html = page.resultHtml();
  assert.match(html, /노원팔억가/);
  assert.match(html, /노원팔억나/);
  assert.ok(!html.includes("도봉팔억"), "예산은 맞지만 다른 지역 거래가 섞였다");
  assert.ok(!html.includes("노원구억"), "지역은 맞지만 다른 예산대 거래가 섞였다");
});

test("지역만 고르면 그 지역의 모든 예산대를 최근 순으로 모은다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");

  const html = page.resultHtml();
  assert.match(html, /노원구에서 3건이 거래됐습니다/);
  assert.ok(!html.includes("도봉팔억"), "다른 지역 거래가 섞였다");
  assert.ok(
    html.indexOf("노원팔억나") < html.indexOf("노원팔억가"),
    "최근 거래가 먼저 나와야 한다"
  );
});

test("예산만 고르면 서울 전체에서 그 구간을 보여준다", async () => {
  const page = await open();
  await page.chooseBudget("8");

  const html = page.resultHtml();
  assert.match(html, /서울 전체 8억대에서 3건이 거래됐습니다/);
  assert.match(html, /도봉구 창동 도봉팔억/);
  assert.ok(!html.includes("강남십이억"), "다른 예산대 거래가 섞였다");
});

test("서울 전체에서 구간을 고르면 어느 지역에 몰렸는지 같이 적는다", async () => {
  const page = await open();
  await page.chooseBudget("8");
  assert.match(page.resultHtml(), /거래가 많은 지역: 노원구 2 · 도봉구 1/);
});

test("지역을 고른 뒤에는 지역 분포를 적지 않는다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");
  await page.chooseBudget("8");
  assert.ok(!page.resultHtml().includes("거래가 많은 지역"));
});

test("거래마다 단지·면적·층·거래일·거래가를 적는다", async () => {
  const page = await open();
  await page.chooseBudget("8");

  const html = page.resultHtml();
  assert.match(html, /도봉구 창동 도봉팔억/);
  assert.match(html, /55\.72㎡ · 12층/);
  assert.match(html, /8\/16/);
  assert.match(html, /8억 5,500만원/);
});

test("지역 이름이 빠진 자료에도 고른 지역을 붙여 적는다", async () => {
  const page = await open();
  await page.chooseDistrict("도봉구");
  assert.match(page.resultHtml(), /도봉구 창동 도봉팔억/);
});

test("조건에 맞는 거래가 없으면 빈 상태로 알린다", async () => {
  const page = await open();
  await page.chooseDistrict("강남구");
  await page.chooseBudget("8");
  assert.match(page.resultHtml(), /조건에 맞는 신고 거래가 없습니다/);
});

test("선택지는 자료에 있는 지역·구간으로만 만든다", async () => {
  const page = await open();

  const districts = page.districtOptions();
  assert.match(districts, /value="all"[^>]*>서울 전체/);
  for (const name of ["강남구", "노원구", "도봉구"]) assert.match(districts, new RegExp(`>${name}<`));
  assert.ok(!districts.includes("송파구"), "거래가 없는 지역까지 고르게 뒀다");

  const budgets = page.budgetOptions();
  assert.match(budgets, /value="8"[^>]*>8억대/);
  assert.match(budgets, /value="12"[^>]*>12억대/);
  assert.ok(!budgets.includes(">10억대<"), "거래가 없는 구간까지 고르게 뒀다");
});

test("주소로 조건을 받고, 바꾸면 주소에 남긴다", async () => {
  const page = await open({ query: "?district=%EB%85%B8%EC%9B%90%EA%B5%AC&budget=9" });
  assert.match(page.resultHtml(), /노원구억/);

  await page.chooseBudget("8");
  assert.equal(page.sandbox.location.search, "?district=%EB%85%B8%EC%9B%90%EA%B5%AC&budget=8");
});

test("기본 조건은 주소에 남기지 않는다", async () => {
  const page = await open({ query: "?district=%EB%85%B8%EC%9B%90%EA%B5%AC&budget=8" });
  await page.chooseDistrict("all");
  await page.chooseBudget("all");
  assert.equal(page.sandbox.location.search, "");
});

test("자료에 없는 지역이 주소로 들어오면 서울 전체로 되돌린다", async () => {
  const page = await open({ query: "?district=%EC%84%B1%EB%82%A8%EC%8B%9C" });
  assert.equal(page.sandbox.location.search, "");
  assert.match(page.resultHtml(), /서울 전체에서 5건이 거래됐습니다/);
});

test("서울 전체에서 고른 구간은 그 예산대 페이지로 이어진다", async () => {
  const page = await open();
  await page.chooseBudget("8");
  assert.match(page.resultHtml(), /href="\.\/budget-8eok\.html"/);
});

test("지역을 고른 상태에서는 예산대 페이지로 보내지 않는다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");
  await page.chooseBudget("8");
  assert.ok(!page.resultHtml().includes("budget-8eok.html"));
});

test("매물이 아니라 신고된 거래라는 안내가 붙는다", async () => {
  const note = (await open()).byId("search-note").textContent;
  assert.match(note, /신고된 아파트 매매 실거래 기록/);
  assert.match(note, /매물이 아니며/);
});

test("자료가 아직 없는 날은 오류가 아니라 준비 중이라고 알린다", async () => {
  const page = await loadDealSearchPage({ status: 404 });
  assert.match(page.resultHtml(), /아직 검색할 실거래 자료가 없습니다/);
  assert.ok(!page.resultHtml().includes("load-retry"), "다시 시도해도 달라질 게 없다");
  assert.equal(page.byId("search-controls").hidden, true, "고를 수 없는 조건을 남겨 뒀다");
});

test("자료를 못 받으면 다시 시도할 길을 준다", async () => {
  const page = await loadDealSearchPage({ status: 500 });
  assert.match(page.resultHtml(), /실거래를 불러오지 못했습니다/);
  assert.match(page.resultHtml(), /id="load-retry"/);
});

test("영어 화면은 결과도 조건도 영어로 그린다", async () => {
  const page = await open({ locale: "en" });
  await page.chooseBudget("8");

  const html = page.resultHtml();
  assert.match(html, /3 deals filed in All of Seoul, ₩0\.8B–0\.9B/);
  assert.match(html, /12F/);
  assert.ok(!html.includes("거래됐습니다"), "영어 화면에 한국어가 남아 있다");
  assert.match(page.byId("search-note").textContent, /not listings for sale/);
  assert.equal(page.navLinks[4].textContent, "Deal search");
});

test("면적 구간을 걸면 그 구간의 거래만 남는다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");
  await page.chooseArea("60-85");

  const html = page.resultHtml();
  assert.match(html, /노원팔억나/, "84.97㎡가 60~85㎡ 칸에서 빠졌다");
  assert.ok(!html.includes("노원팔억가"), "55.72㎡가 60~85㎡ 칸에 섞였다");
  assert.match(html, /1건이 거래됐습니다/);
});

test("면적 경계는 위쪽을 포함한다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");
  await page.chooseArea("85-135");
  assert.match(page.resultHtml(), /조건에 맞는 신고 거래가 없습니다/);
});

test("단지명으로 서울 전체를 훑는다", async () => {
  const page = await open();
  await page.typeApt("팔억");

  const html = page.resultHtml();
  assert.match(html, /3건이 거래됐습니다/);
  assert.match(html, /도봉구 창동 도봉팔억/, "다른 지역 파일까지 훑지 않았다");
  assert.ok(!html.includes("노원구억"), "단지명이 안 맞는 거래가 섞였다");
});

test("단지명은 띄어쓰기를 무시하고 찾는다", async () => {
  const page = await open();
  await page.typeApt("노원 팔억");
  assert.match(page.resultHtml(), /2건이 거래됐습니다/);
});

test("연식을 걸면 준공연도로 거른다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");
  await page.chooseAge("5");

  const html = page.resultHtml();
  assert.match(html, /노원팔억나/, "2023년 준공이 5년 이내에서 빠졌다");
  assert.match(html, /1건이 거래됐습니다/);

  await page.chooseAge("30");
  const old = page.resultHtml();
  assert.match(old, /노원팔억가/);
  assert.match(old, /노원구억/);
  assert.ok(!old.includes("노원팔억나"), "2023년 준공이 30년 이상에 섞였다");
});

test("준공연도가 없는 거래는 연식 조건에서 뺀다", async () => {
  const page = await open();
  await page.chooseDistrict("강남구");
  await page.chooseAge("30");
  assert.match(page.resultHtml(), /조건에 맞는 신고 거래가 없습니다/);
});

test("직거래를 빼면 직거래로 신고된 거래만 사라진다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");
  await page.toggleDirect(true);

  const html = page.resultHtml();
  assert.ok(!html.includes("노원구억"), "직거래가 남았다");
  assert.match(html, /2건이 거래됐습니다/);
});

test("거래 형태가 없는 거래는 직거래 제외에 걸리지 않는다", async () => {
  const page = await open();
  await page.chooseDistrict("도봉구");
  await page.toggleDirect(true);
  assert.match(page.resultHtml(), /도봉팔억/);
});

test("직거래는 목록에 표시하고 중개거래에는 아무 표시도 하지 않는다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");

  const html = page.resultHtml();
  const direct = html.slice(html.indexOf("노원구억"));
  assert.match(direct.slice(0, 200), /class="tag">직거래</);
  assert.equal(html.match(/class="tag"/g).length, 1, "중개거래·미상에도 표시가 붙었다");
});

test("무엇으로 걸렀는지 결과와 같은 자리에 적는다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");
  await page.chooseBudget("8");
  await page.chooseArea("60-85");
  await page.chooseAge("5");
  await page.toggleDirect(true);

  assert.match(page.resultHtml(), /노원구 8억대 60~85㎡ 5년 이내 직거래 제외에서 1건/);
});

test("상세 조건도 주소에 남고, 주소로 받아 그대로 연다", async () => {
  const page = await open();
  await page.chooseDistrict("노원구");
  await page.chooseArea("60-85");
  await page.chooseAge("5");
  await page.typeApt("팔억");
  await page.toggleDirect(true);

  const query = page.sandbox.location.search;
  assert.match(query, /area=60-85/);
  assert.match(query, /age=5/);
  assert.match(query, /apt=/);
  assert.match(query, /direct=exclude/);

  const reopened = await open({ query });
  assert.match(reopened.resultHtml(), /노원팔억나/);
  assert.match(reopened.resultHtml(), /1건이 거래됐습니다/);
});

test("모르는 면적·연식 값이 주소로 들어오면 무시한다", async () => {
  const page = await open({ query: "?district=%EB%85%B8%EC%9B%90%EA%B5%AC&area=42&age=99" });
  assert.match(page.resultHtml(), /노원구에서 3건이 거래됐습니다/);
  assert.equal(page.sandbox.location.search, "?district=%EB%85%B8%EC%9B%90%EA%B5%AC");
});

test("상세 조건이 걸리면 예산대 페이지로 보내지 않는다", async () => {
  const page = await open();
  await page.chooseBudget("8");
  assert.match(page.resultHtml(), /budget-8eok\.html/);

  await page.chooseArea("60-85");
  assert.ok(!page.resultHtml().includes("budget-8eok.html"));
});

test("전수 자료가 없으면 상세 조건에 요약으로 답하지 않는다", async () => {
  const page = await loadDealSearchPage({ budget: FIXTURE.budget, search: FIXTURE.search });
  await page.chooseArea("60-85");

  const html = page.resultHtml();
  assert.match(html, /지역별 실거래 자료가 있어야/);
  assert.ok(!html.includes("노원팔억"), "조건을 못 거는 자료로 목록을 그렸다");
});

test("지역을 고르면 표본이 아니라 전수를 보여준다", async () => {
  const many = Array.from({ length: 9 }, (_, i) =>
    deal(85_000 + i * 10, { apt: `노원많음${i}`, date: `2026-08-${String(i + 1).padStart(2, "0")}` })
  );
  const page = await loadDealSearchPage(fixtureOf(many));
  await page.chooseDistrict("노원구");

  const html = page.resultHtml();
  assert.match(html, /9건이 거래됐습니다/);
  assert.equal(html.match(/class="budget-deal"/g).length, 9, "대표 표본 수에서 목록이 멈췄다");
});

test("서울 전체 건수는 지역별 건수의 합과 같다", () => {
  const payload = buildPayload({ period: "202608", districts: { 11350: DEALS } }, NOW);

  const seoul = payload.screen.bands.reduce((sum, b) => sum + b.count, 0);
  const byDistrict = Object.values(payload.search.districts)
    .flat()
    .reduce((sum, b) => sum + b.count, 0);

  assert.equal(seoul, DEALS.length);
  assert.equal(byDistrict, DEALS.length);
});

test("검색 자료는 지역별로 나뉘고 지역 이름을 다시 담지 않는다", () => {
  const payload = buildPayload({ period: "202608", districts: { 11350: DEALS } }, NOW);

  assert.deepEqual(Object.keys(payload.search.districts).sort(), ["강남구", "노원구", "도봉구"]);

  const band = payload.search.districts["노원구"].find((b) => b.min10k === 80_000);
  assert.equal(band.count, 2);
  assert.ok(!("districts" in band), "지역 분포가 지역별 파일에 남았다");
  assert.ok(band.deals.every((d) => !("district" in d)), "지역 이름이 거래마다 남았다");

  assert.ok(!("months" in payload.search));
});

test("전수 파일 주소는 자료가 알려준다", () => {
  const payload = buildPayload({ period: "202608", districts: { 11350: DEALS } }, NOW);
  assert.equal(payload.search.slugs["노원구"], "nowon");
  assert.equal(payload.search.slugs["강남구"], "gangnam");
  assert.ok(!("송파구" in payload.search.slugs), "거래가 없는 지역까지 주소를 냈다");
});
