// 거래내역 검색. 지역과 예산을 같이 걸어 신고된 실거래를 찾는 화면이다.
//
// 조건이 둘이라 어긋나는 방향도 둘이다 - 지역 조건이 안 걸려 다른 구 거래가 섞이거나,
// 예산 조건이 옆 칸으로 새거나. 둘 다 화면에서는 그럴듯해 보이는 목록으로 나오기 때문에
// 눈으로는 못 잡는다. 그리고 이 화면이 매물 검색으로 읽히면 성격 자체가 바뀐다.
import test from "node:test";
import assert from "node:assert/strict";
import { buildDistrictBands, flattenDistrictMonths, mergeBands, mergeDistrictMonths } from "../scripts/budget-bands.mjs";
import { buildPayload } from "../scripts/build-budget-deals.mjs";
import { loadDealSearchPage } from "./helpers/deal-search-page.mjs";

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
  deal(85_000, { apt: "노원팔억가" }),
  deal(86_000, { apt: "노원팔억나", date: "2026-08-15" }),
  deal(95_000, { apt: "노원구억" }),
  deal(85_500, { district: "도봉구", dong: "창동", apt: "도봉팔억", floor: 12, date: "2026-08-16" }),
  deal(120_000, { district: "강남구", dong: "역삼동", apt: "강남십이억" }),
];

const months = { "202608": buildDistrictBands(DEALS) };

const BUDGET = {
  updatedAt: "2026-08-17T00:00:00.000Z",
  periods: ["202608"],
  bands: mergeBands(flattenDistrictMonths(months)),
};

const SEARCH = {
  updatedAt: "2026-08-17T00:00:00.000Z",
  periods: ["202608"],
  districts: mergeDistrictMonths(months),
};

const open = (extra = {}) => loadDealSearchPage({ budget: BUDGET, search: SEARCH, ...extra });

test("지역과 예산을 같이 걸면 그 칸의 거래만 나온다", async () => {
  const page = await open();
  page.chooseDistrict("노원구");
  page.chooseBudget("8");

  const html = page.resultHtml();
  assert.match(html, /노원팔억가/);
  assert.match(html, /노원팔억나/);
  assert.ok(!html.includes("도봉팔억"), "예산은 맞지만 다른 지역 거래가 섞였다");
  assert.ok(!html.includes("노원구억"), "지역은 맞지만 다른 예산대 거래가 섞였다");
});

test("지역만 고르면 그 지역의 모든 예산대를 최근 순으로 모은다", async () => {
  const page = await open();
  page.chooseDistrict("노원구");

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
  page.chooseBudget("8");

  const html = page.resultHtml();
  assert.match(html, /서울 전체 8억대에서 3건이 거래됐습니다/);
  assert.match(html, /도봉구 창동 도봉팔억/);
  assert.ok(!html.includes("강남십이억"), "다른 예산대 거래가 섞였다");
});

test("서울 전체에서 구간을 고르면 어느 지역에 몰렸는지 같이 적는다", async () => {
  const page = await open();
  page.chooseBudget("8");
  assert.match(page.resultHtml(), /거래가 많은 지역: 노원구 2 · 도봉구 1/);
});

// 지역을 이미 고른 화면에서 "거래가 많은 지역: 노원구"는 읽을 값이 없다.
test("지역을 고른 뒤에는 지역 분포를 적지 않는다", async () => {
  const page = await open();
  page.chooseDistrict("노원구");
  page.chooseBudget("8");
  assert.ok(!page.resultHtml().includes("거래가 많은 지역"));
});

test("거래마다 단지·면적·층·거래일·거래가를 적는다", async () => {
  const page = await open();
  page.chooseBudget("8");

  const html = page.resultHtml();
  assert.match(html, /도봉구 창동 도봉팔억/);
  assert.match(html, /55\.72㎡ · 12층/);
  assert.match(html, /8\/16/);
  assert.match(html, /8억 5,500만원/);
});

// 지역별 파일은 지역 이름을 빼고 담는다(열쇠가 곧 지역이라 파일만 커진다). 그 자리를
// 화면이 채우지 않으면 줄이 "창동 도봉팔억"으로 시작한다.
test("지역 이름이 빠진 자료에도 고른 지역을 붙여 적는다", async () => {
  const stripped = {
    ...SEARCH,
    districts: Object.fromEntries(
      Object.entries(SEARCH.districts).map(([name, bands]) => [
        name,
        bands.map((band) => ({ ...band, deals: band.deals.map(({ district: _n, ...d }) => d) })),
      ])
    ),
  };

  const page = await loadDealSearchPage({ budget: BUDGET, search: stripped });
  page.chooseDistrict("도봉구");
  assert.match(page.resultHtml(), /도봉구 창동 도봉팔억/);
});

test("조건에 맞는 거래가 없으면 빈 상태로 알린다", async () => {
  const page = await open();
  page.chooseDistrict("강남구");
  page.chooseBudget("8");
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

  page.chooseBudget("8");
  assert.equal(page.sandbox.location.search, "?district=%EB%85%B8%EC%9B%90%EA%B5%AC&budget=8");
});

// 기본값을 주소에 남기면 공유한 주소마다 필터가 붙어 다닌다(다른 페이지와 같은 규칙).
test("기본 조건은 주소에 남기지 않는다", async () => {
  const page = await open({ query: "?district=%EB%85%B8%EC%9B%90%EA%B5%AC&budget=8" });
  page.chooseDistrict("all");
  page.chooseBudget("all");
  assert.equal(page.sandbox.location.search, "");
});

// 없는 지역을 고른 채로 두면 빈 화면만 남고, 조건이 틀린 건지 자료가 없는 건지 모른다.
test("자료에 없는 지역이 주소로 들어오면 서울 전체로 되돌린다", async () => {
  const page = await open({ query: "?district=%EC%84%B1%EB%82%A8%EC%8B%9C" });
  assert.equal(page.sandbox.location.search, "");
  assert.match(page.resultHtml(), /서울 전체에서 5건이 거래됐습니다/);
});

test("서울 전체에서 고른 구간은 그 예산대 페이지로 이어진다", async () => {
  const page = await open();
  page.chooseBudget("8");
  assert.match(page.resultHtml(), /href="\.\/budget-8eok\.html"/);
});

// 예산 페이지는 서울 전체 기준으로 찍는다. 지역을 고른 화면에서 링크를 걸면 누른 사람이
// 보게 될 목록이 지금 화면과 다르다.
test("지역을 고른 상태에서는 예산대 페이지로 보내지 않는다", async () => {
  const page = await open();
  page.chooseDistrict("노원구");
  page.chooseBudget("8");
  assert.ok(!page.resultHtml().includes("budget-8eok.html"));
});

// 이 화면이 매물 검색으로 읽히면 안 된다. 안내 문구가 빠지는 순간 성격이 바뀐다.
test("매물이 아니라 신고된 거래라는 안내가 붙는다", async () => {
  const note = (await open()).byId("search-note").textContent;
  assert.match(note, /신고된 아파트 매매 실거래 기록/);
  assert.match(note, /매물이 아니며/);
});

// 부동산 조회가 도는 건 하루 한 번이라 자료 없이 뜨는 날이 있다. 거기에 오류를 띄우면
// 멀쩡한 화면을 고장 난 것으로 읽게 된다.
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
  page.chooseBudget("8");

  const html = page.resultHtml();
  assert.match(html, /3 deals filed in All of Seoul, ₩0\.8B–0\.9B/);
  assert.match(html, /12F/);
  assert.ok(!html.includes("거래됐습니다"), "영어 화면에 한국어가 남아 있다");
  assert.match(page.byId("search-note").textContent, /not listings for sale/);
  assert.equal(page.navLinks[4].textContent, "Deal search");
});

// --- 자료 만들기 ---

// 서울 전체 구간과 지역별 구간이 서로 다른 원본에서 나오면, 한쪽만 갱신된 날 같은 조건에
// 다른 답이 나온다. 저장은 지역별로 한 벌만 하고 서울 전체는 그걸 다시 합쳐 만든다.
test("서울 전체 건수는 지역별 건수의 합과 같다", () => {
  const now = new Date("2026-08-17T00:00:00Z");
  const payload = buildPayload({ period: "202608", districts: { 11350: DEALS } }, null, now);

  const seoul = payload.screen.bands.reduce((sum, b) => sum + b.count, 0);
  const byDistrict = Object.values(payload.search.districts)
    .flat()
    .reduce((sum, b) => sum + b.count, 0);

  assert.equal(seoul, DEALS.length);
  assert.equal(byDistrict, DEALS.length);
});

test("검색 자료는 지역별로 나뉘고 지역 이름을 다시 담지 않는다", () => {
  const now = new Date("2026-08-17T00:00:00Z");
  const payload = buildPayload({ period: "202608", districts: { 11350: DEALS } }, null, now);

  assert.deepEqual(Object.keys(payload.search.districts).sort(), ["강남구", "노원구", "도봉구"]);

  const band = payload.search.districts["노원구"].find((b) => b.min10k === 80_000);
  assert.equal(band.count, 2);
  assert.ok(!("districts" in band), "지역 분포가 지역별 파일에 남았다");
  assert.ok(band.deals.every((d) => !("district" in d)), "지역 이름이 거래마다 남았다");

  // 화면이 받는 두 파일에는 월별 원본이 실리지 않는다.
  assert.ok(!("months" in payload.search));
});
