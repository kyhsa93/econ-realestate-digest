// 거래 유형별 시세 페이지는 검색 결과로 바로 들어오는 착지 페이지라, 여기 적힌 숫자가
// 그 사람이 보는 전부다. 84㎡ 환산은 우리가 만들어낸 값이라 특히 틀리면 안 되고,
// 표본이 모자란 지역을 가리는 규칙도 화면 표와 같아야 한다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  BASE_AREA_PYEONG,
  areaPrice,
  formatEok,
  jeonseRatio,
  metricOf,
  normalizeArea,
} from "../scripts/realestate-format.mjs";
import {
  realestateHeadHtml,
  realestateOverallHtml,
  realestateTableHtml,
} from "../scripts/prerender.mjs";
import {
  REALESTATE_PAGES,
  buildDistrictPage,
  buildRealestatePage,
} from "../scripts/build-realestate-pages.mjs";
import { DISTRICT_PAGES } from "../scripts/district-slugs.mjs";
import { districtSentences } from "../scripts/district-summary.mjs";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const readJson = (name) => read(`docs/data/${name}.json`).then(JSON.parse);

const cells = (html) => [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].trim());
const names = (html) => [...html.matchAll(/<tr[^>]*><td>([^<]*)</g)].map((m) => m[1]);
const headCells = (html) => [...html.matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1]);

const district = (name, extra = {}) => ({
  name,
  sale: { avgPricePerPyeong10k: 4000, transactionCount: 10, change: null },
  jeonse: { avgDepositPerPyeong10k: 2000, transactionCount: 20 },
  wolse: { avgDeposit10k: 20000, avgMonthlyRent10k: 90, transactionCount: 30 },
  ...extra,
});

// 추이는 "며칠치가 표본을 넘겼나"에 걸려 있다. 그날 수집분으로 검사하면 달 초처럼 표본이
// 얇은 날, 전월세 API가 하루 죽은 날에 CI가 빨개지고 그날 수집분이 통째로 유실된다.
// 그래서 추이 검사는 기간과 표본을 여기서 만들어 쓴다.
const metrics = (offset = 0) => ({
  sale: { avgPricePerPyeong10k: 4400 + offset, transactionCount: 50 },
  saleNational84: { avgPricePerPyeong10k: 4100 + offset, transactionCount: 30 },
  jeonse: { avgDepositPerPyeong10k: 2500 + offset, transactionCount: 40 },
  wolse: { avgDeposit10k: 22000 + offset, avgMonthlyRent10k: 96, transactionCount: 35 },
});

const TREND_DISTRICT = { code: "11680", name: "강남구" };

const trendRealestate = () => ({
  period: "202608",
  updatedAt: "2026-08-15T00:00:00.000Z",
  overall: metrics(),
  districts: [{ ...TREND_DISTRICT, ...metrics(500) }, { code: "11350", name: "노원구", ...metrics(-500) }],
});

// 마지막 날은 현재 값과 같아야 한다 - 화면이 오늘 값을 추이의 끝점으로 그리기 때문이다.
const trendHistory = () => [
  { date: "2026-08-13", overall: metrics(-40), districts: [{ code: TREND_DISTRICT.code, ...metrics(460) }] },
  { date: "2026-08-14", overall: metrics(-20), districts: [{ code: TREND_DISTRICT.code, ...metrics(480) }] },
  { date: "2026-08-15", overall: metrics(), districts: [{ code: TREND_DISTRICT.code, ...metrics(500) }] },
];

test("84㎡ 환산이 손계산과 같다", () => {
  // 84㎡ = 84 / 3.3058 = 25.410평. 평당 4,449만원이면 약 11억 3천만원.
  assert.equal(BASE_AREA_PYEONG.toFixed(3), "25.410");
  assert.equal(areaPrice(4449), Math.round(4449 * BASE_AREA_PYEONG));
  assert.equal(formatEok(areaPrice(4449)), "11억 3,049만원");
  // 억 단위가 딱 떨어지면 만원을 안 붙인다
  assert.equal(formatEok(30000), "3억원");
  assert.equal(formatEok(5000), "5,000만원");
  assert.equal(areaPrice(null), null);
  assert.equal(formatEok(null), "-");
});

// 신고가 한두 건이면 "그 구의 시세"가 아니라 "그 아파트 한 채의 가격"이다.
test("신고 건수가 5건 미만이면 값을 내지 않는다", () => {
  const thin = district("노원구", {
    sale: { avgPricePerPyeong10k: 9999, transactionCount: 2 },
  });
  assert.equal(metricOf(thin, "sale"), null);

  const html = realestateTableHtml({ districts: [thin] }, "sale");
  assert.ok(html.includes("신고 2건"), "표본 부족 표시가 없다");
  assert.ok(!html.includes("9,999"), "가려야 할 평당가가 그대로 나왔다");
});

test("거래 유형마다 열 구성이 다르다", () => {
  assert.deepEqual(headCells(realestateHeadHtml("sale")), ["지역", "평당가", "84㎡ 환산", "거래건수"]);
  // 전세 페이지에만 전세가율이 붙는다(매매 페이지에 넣으면 같은 값이 두 번 나온다).
  assert.deepEqual(headCells(realestateHeadHtml("jeonse")), ["지역", "평당 보증금", "84㎡ 환산", "전세가율", "거래건수"]);
  // 월세는 평당 개념이 아니라 보증금·월세 평균이라 환산하지 않는다.
  assert.deepEqual(headCells(realestateHeadHtml("wolse")), ["지역", "평균 보증금", "평균 월세", "거래건수"]);
  assert.deepEqual(headCells(realestateHeadHtml()), ["지역", "매매", "전세", "월세"]);
});

test("월세 표에는 84㎡ 환산이 들어가지 않는다", () => {
  const html = realestateTableHtml({ districts: [district("강남구")] }, "wolse");
  assert.ok(html.includes("월 90만원"), "월세 금액이 없다");
  assert.ok(!html.includes("억"), "월세인데 84㎡ 환산가가 붙었다");
});

test("비싼 지역이 위로 오고, 값을 못 내는 지역은 맨 아래로 간다", () => {
  const data = {
    districts: [
      district("싼구", { sale: { avgPricePerPyeong10k: 3000, transactionCount: 10 } }),
      district("표본부족구", { sale: { avgPricePerPyeong10k: 9999, transactionCount: 1 } }),
      district("비싼구", { sale: { avgPricePerPyeong10k: 8000, transactionCount: 10 } }),
    ],
  };
  assert.deepEqual(names(realestateTableHtml(data, "sale")), ["비싼구", "싼구", "표본부족구"]);
});

test("서울 전체가 표 맨 위에 온다", async () => {
  const realestate = await readJson("realestate");
  const html = realestateTableHtml(realestate, "sale");
  assert.equal(names(html)[0], "서울 전체");
  assert.ok(html.startsWith('<tr class="overall-row">'));
});

test("정적 HTML의 표가 실제 화면과 같다", async () => {
  const realestate = await readJson("realestate");

  for (const kind of [null, "sale", "jeonse", "wolse"]) {
    const page = await loadRealestatePage({ realestate, kind });
    assert.deepEqual(
      cells(page.tableHtml()),
      cells(realestateTableHtml(realestate, kind)),
      `${kind ?? "전체"} 표가 프리렌더와 다르다`
    );
    assert.equal(page.headHtml(), realestateHeadHtml(kind), `${kind ?? "전체"} 머리글이 다르다`);
    assert.equal(
      page.overallHtml(),
      realestateOverallHtml(realestate, kind),
      `${kind ?? "전체"} 요약 카드가 다르다`
    );
  }
});

test("커밋된 거래 유형별 페이지가 지금 원본·데이터로 찍은 결과와 같다", async () => {
  const [baseHtml, realestate] = await Promise.all([read("docs/realestate.html"), readJson("realestate")]);

  for (const page of REALESTATE_PAGES) {
    assert.equal(
      await read(`docs/${page.file}`),
      buildRealestatePage(baseHtml, page, realestate),
      `docs/${page.file}이 원본과 어긋납니다. node scripts/build-realestate-pages.mjs를 실행하세요.`
    );
  }
});

// 제목을 사전에서 안 바꾸면 하이드레이션 뒤에 클라이언트가 원래 제목으로 되돌려놓는다.
test("생성된 페이지는 화면을 그린 뒤에도 자기 제목을 유지한다", async () => {
  const realestate = await readJson("realestate");
  const { sandbox } = await loadRealestatePage({ realestate, kind: "sale" });
  assert.match(sandbox.document.title, /매매/);
  assert.ok(!sandbox.document.title.includes("전세"), sandbox.document.title);
});

test("영어 화면은 억 단위 대신 백만원 단위로 적는다", async () => {
  const realestate = await readJson("realestate");
  const { overallHtml } = await loadRealestatePage({ realestate, kind: "sale", locale: "en" });
  const html = overallHtml();
  assert.ok(html.includes("For 84m²"), "영어 라벨이 없다");
  assert.ok(/₩[\d,]+M/.test(html), `영어 금액 표기가 없다: ${html.slice(0, 200)}`);
  assert.ok(!html.includes("억"), "영어 화면에 억 표기가 남았다");
});

// --- 월초 표본 부족 대체 ---
// 국토부 신고 기한이 계약 후 30일이라 매달 1~10일경에는 이번 달 신고가 거의 없다.
// 실제로 8월 10일에는 25개 구 중 12곳만 표본 5건을 넘겼다. 그때 검색으로 들어온
// 사람에게 반쪽짜리 표를 보여주지 않으려고 지난달 값으로 대체한다.
const thinWithPrev = (name) => ({
  name,
  sale: { avgPricePerPyeong10k: 9999, transactionCount: 2 },
  jeonse: { avgDepositPerPyeong10k: 2000, transactionCount: 20 },
  wolse: null,
  prev: {
    sale: { avgPricePerPyeong10k: 4000, transactionCount: 40 },
    jeonse: { avgDepositPerPyeong10k: 1900, transactionCount: 60 },
  },
});

test("이번 달 표본이 모자라면 지난달 값을 쓰고 기준 월을 밝힌다", () => {
  const data = { previousPeriod: "202607", districts: [thinWithPrev("노원구")] };
  const html = realestateTableHtml(data, "sale");

  assert.ok(html.includes("4,000만원"), "지난달 값으로 대체되지 않았다");
  assert.ok(!html.includes("9,999"), "표본 2건짜리 값이 그대로 나왔다");
  assert.ok(html.includes("prev-tag"), "기준 월 표시가 없다");
  assert.ok(html.includes(">7월<"), `기준 월이 7월이 아니다: ${html.slice(0, 300)}`);
});

test("이번 달 표본이 충분하면 지난달 값을 쓰지 않는다", () => {
  const entry = { ...thinWithPrev("강남구"), sale: { avgPricePerPyeong10k: 8000, transactionCount: 30 } };
  const html = realestateTableHtml({ previousPeriod: "202607", districts: [entry] }, "sale");
  assert.ok(html.includes("8,000만원"));
  assert.ok(!html.includes("prev-tag"), "이번 달 값인데 지난달 표시가 붙었다");
});

// 증감은 이번 달 값끼리 비교한 결과라, 지난달로 대체한 셀에 붙이면 다른 달 사이의
// 변화를 이번 달 변화인 것처럼 보여주게 된다.
test("지난달로 대체한 셀에는 증감을 붙이지 않는다", () => {
  const entry = thinWithPrev("도봉구");
  entry.prev.sale.change = { value10k: 500 };
  entry.prev.sale.baselineDate = "2026-07-10";
  const html = realestateTableHtml({ previousPeriod: "202607", districts: [entry] }, "sale");
  assert.ok(!html.includes("change up"), "대체된 셀에 증감이 붙었다");
});

test("지난달 값도 없으면 표본 부족으로 남긴다", () => {
  const entry = { name: "종로구", sale: { avgPricePerPyeong10k: 9999, transactionCount: 1 }, prev: {} };
  const html = realestateTableHtml({ previousPeriod: "202607", districts: [entry] }, "sale");
  assert.ok(html.includes("신고 1건"));
  assert.ok(!html.includes("9,999"));
});

test("대체된 지역도 값 순서대로 줄을 선다", () => {
  const data = {
    previousPeriod: "202607",
    districts: [
      district("싼구", { sale: { avgPricePerPyeong10k: 3000, transactionCount: 10 } }),
      thinWithPrev("대체구"), // 지난달 4,000만원
      district("비싼구", { sale: { avgPricePerPyeong10k: 8000, transactionCount: 10 } }),
    ],
  };
  assert.deepEqual(names(realestateTableHtml(data, "sale")), ["비싼구", "대체구", "싼구"]);
});

test("정적 HTML과 화면이 대체 표시까지 같게 그린다", async () => {
  const realestate = await readJson("realestate");
  const data = {
    ...realestate,
    previousPeriod: "202607",
    districts: realestate.districts.map((d, i) => (i % 3 === 0 ? thinWithPrev(d.name) : d)),
  };
  const page = await loadRealestatePage({ realestate: data, kind: "sale" });
  assert.deepEqual(cells(page.tableHtml()), cells(realestateTableHtml(data, "sale")));
  assert.ok(page.tableHtml().includes("prev-tag"), "화면에 대체 표시가 없다");
});

// --- 전세가율 ---
// 매매·전세 평당가를 둘 다 갖고 있으니 계산만 하면 되는데, 이걸 표로 주는 곳이 드물다.
// 다만 두 지표의 기준이 어긋나면 나오는 숫자가 아무 의미도 없어진다.
test("전세가율은 전세를 매매로 나눈 값이다", () => {
  const entry = district("강남구", {
    sale: { avgPricePerPyeong10k: 10000, transactionCount: 10 },
    jeonse: { avgDepositPerPyeong10k: 4000, transactionCount: 20 },
  });
  assert.equal(jeonseRatio(entry).ratio.toFixed(1), "40.0");
  assert.ok(realestateTableHtml({ districts: [entry] }, "jeonse").includes("40.0%"));
});

test("한쪽 표본이 모자라면 전세가율을 내지 않는다", () => {
  // 매매 5건짜리 구에서 나오는 비율은 시세가 아니라 그 한 채의 가격 때문이다.
  const entry = district("종로구", {
    sale: { avgPricePerPyeong10k: 13358, transactionCount: 2 },
  });
  assert.equal(jeonseRatio(entry), null);
  const html = realestateTableHtml({ districts: [entry] }, "jeonse");
  assert.ok(html.includes("<td data-label=\"전세가율\">-</td>"), "표본이 모자란데 비율이 나왔다");
});

// 7월 전세를 8월 매매로 나눈 값은 어느 시점의 전세가율도 아니다.
test("기준 달이 서로 다르면 전세가율을 내지 않는다", () => {
  const entry = {
    name: "노원구",
    sale: { avgPricePerPyeong10k: 9999, transactionCount: 2 },
    jeonse: { avgDepositPerPyeong10k: 1900, transactionCount: 60 },
    prev: { sale: { avgPricePerPyeong10k: 4000, transactionCount: 40 } },
  };
  // 매매는 지난달로 대체되고 전세는 이번 달이라 비율을 낼 수 없다
  assert.equal(jeonseRatio(entry), null);
});

test("둘 다 지난달로 대체되면 전세가율을 낸다", () => {
  const entry = {
    name: "도봉구",
    sale: { avgPricePerPyeong10k: 9999, transactionCount: 1 },
    jeonse: { avgDepositPerPyeong10k: 8888, transactionCount: 1 },
    prev: {
      sale: { avgPricePerPyeong10k: 4000, transactionCount: 40 },
      jeonse: { avgDepositPerPyeong10k: 2800, transactionCount: 50 },
    },
  };
  const ratio = jeonseRatio(entry);
  assert.equal(ratio.ratio.toFixed(1), "70.0");
  assert.equal(ratio.isPrevious, true);
});

test("매매·월세 페이지에는 전세가율이 없다", () => {
  assert.ok(!realestateHeadHtml("sale").includes("전세가율"));
  assert.ok(!realestateHeadHtml("wolse").includes("전세가율"));
});

// --- 평형 선택 ---
// 84㎡가 기본이지만 59㎡를 찾는 사람도 많다. 세후 이자의 금액 입력과 같은 성격이라
// 고른 값이 표 전체에 반영되고 주소에도 남아야 한다.
test("평형을 바꾸면 환산가와 열 제목이 같이 바뀐다", async () => {
  const realestate = await readJson("realestate");
  const page = await loadRealestatePage({ realestate, kind: "sale" });

  const before = cells(page.tableHtml());
  assert.ok(page.headHtml().includes("84㎡ 환산"));

  const select = page.byId("area-select");
  select.value = "59";
  page.byId("area-controls").dispatch("change", { target: select });

  const after = cells(page.tableHtml());
  assert.ok(page.headHtml().includes("59㎡ 환산"), `열 제목이 안 바뀌었다: ${page.headHtml()}`);
  assert.notDeepEqual(after, before, "평형을 바꿨는데 표가 그대로다");
  assert.ok(page.sandbox.location.search.includes("area=59"), page.sandbox.location.search);
});

test("기본 평형은 주소에 남기지 않는다", async () => {
  const realestate = await readJson("realestate");
  const page = await loadRealestatePage({ realestate, kind: "sale" });
  const select = page.byId("area-select");

  select.value = "59";
  page.byId("area-controls").dispatch("change", { target: select });
  select.value = "84";
  page.byId("area-controls").dispatch("change", { target: select });

  assert.ok(!page.sandbox.location.search.includes("area="), page.sandbox.location.search);
});

test("지원하지 않는 평형은 기본값으로 돌린다", () => {
  assert.equal(normalizeArea("999"), 84);
  assert.equal(normalizeArea(null), 84);
  assert.equal(normalizeArea("59"), 59);
});

// 월세는 보증금·월세 평균이라 환산 자체가 없고, 허브는 평당가만 나열한다.
test("환산가가 없는 화면에는 평형 선택을 띄우지 않는다", async () => {
  const realestate = await readJson("realestate");
  for (const kind of ["wolse", null]) {
    const page = await loadRealestatePage({ realestate, kind });
    assert.equal(page.byId("area-controls").hidden, true, `${kind ?? "허브"}에 평형 선택이 떴다`);
  }
  const sale = await loadRealestatePage({ realestate, kind: "sale" });
  assert.equal(sale.byId("area-controls").hidden, false);
});

test("주소로 들어온 평형으로 시작한다", async () => {
  const realestate = await readJson("realestate");
  const page = await loadRealestatePage({ realestate, kind: "sale", search: "?area=114" });
  assert.ok(page.headHtml().includes("114㎡ 환산"), page.headHtml());
});

// --- 시세 추이 ---
// 기록이 하루 4회 쌓이므로 지금은 6일치뿐이지만, 착지 페이지에서 먼저 알고 싶은 건
// "요즘 오르는가 내리는가"라 자리를 만들어 둔다.
test("거래 유형마다 자기 지표의 추이를 그린다", async () => {
  const realestate = trendRealestate();
  const history = trendHistory();

  for (const kind of ["sale", "jeonse", "wolse"]) {
    const page = await loadRealestatePage({ realestate, history, kind });
    assert.ok(page.trendHtml().includes("polyline"), `${kind}: 그래프가 없다`);
    assert.equal(page.byId("trend-section").hidden, false);
  }
});

// 표에서 가린 값을 그래프에서만 보여주면 같은 페이지가 두 기준으로 말하는 셈이 된다.
test("표본이 모자란 날짜는 추이에서 뺀다", async () => {
  const realestate = await readJson("realestate");
  const history = [
    { date: "2026-08-01", overall: { sale: { avgPricePerPyeong10k: 9999, transactionCount: 2 } } },
    { date: "2026-08-02", overall: { sale: { avgPricePerPyeong10k: 4000, transactionCount: 50 } } },
    { date: "2026-08-03", overall: { sale: { avgPricePerPyeong10k: 4100, transactionCount: 60 } } },
  ];
  const page = await loadRealestatePage({ realestate, history, kind: "sale" });
  assert.match(page.trendMeta(), /2026-08-02/, `표본 부족한 날이 남았다: ${page.trendMeta()}`);
  assert.match(page.trendMeta(), /2일/);
});

test("기록이 하루뿐이면 빈 그래프 대신 이유를 적는다", async () => {
  const realestate = await readJson("realestate");
  const history = [{ date: "2026-08-15", overall: { sale: { avgPricePerPyeong10k: 4000, transactionCount: 50 } } }];
  const page = await loadRealestatePage({ realestate, history, kind: "sale" });
  assert.equal(page.trendHtml(), "");
  assert.match(page.trendMeta(), /이틀 이상/);
});

test("추이를 못 받아도 표는 그대로 나온다", async () => {
  const realestate = await readJson("realestate");
  const page = await loadRealestatePage({ realestate, kind: "sale" });
  assert.ok(cells(page.tableHtml()).length > 0, "추이가 없다고 표까지 비었다");
});

// --- 자치구별 페이지 ---
// "강남구 아파트 시세"처럼 지역 단위로 검색하는 사람에게 착지점을 만든다.
test("자치구 페이지는 한 지역의 세 유형을 행으로 보여준다", async () => {
  const [realestate, history] = await Promise.all([readJson("realestate"), readJson("realestate-history-lite")]);
  const page = await loadRealestatePage({ realestate, history, district: "강남구" });

  assert.deepEqual(headCells(page.headHtml()), ["구분", "평당가", "84㎡ 환산", "거래건수"]);
  assert.deepEqual(names(page.tableHtml()), ["매매", "전세", "월세"]);
  assert.match(page.sandbox.document.title, /강남구/);
});

// 월세는 평당 개념이 아니라 보증금·월세 평균이라 환산 칸이 비어야 한다.
test("자치구 페이지의 월세 행에는 환산가가 없다", async () => {
  const realestate = await readJson("realestate");
  const page = await loadRealestatePage({ realestate, district: "강남구" });
  const rows = page.tableHtml().split("</tr>");
  const wolseRow = rows.find((r) => r.includes(">월세<"));
  assert.ok(wolseRow.includes('data-label="84㎡ 환산">-<'), `월세 행: ${wolseRow}`);
});

// 그날 강남구 평당가를 적어두면 값이 움직일 때마다 깨지고(10,870 → 11,108), 그날
// 데이터에서 꺼내 쓰면 강남구 신고가 5건에 못 미치는 달 초에 그 날짜가 추이에서 빠져
// 마지막 점이 며칠 전 값이 된다. 확인하려는 건 "이 페이지가 자기 지역 값을 그리는가"라,
// 지역과 기간을 여기서 만들어 쓴다.
test("자치구 페이지 추이는 그 지역 값을 그린다", async () => {
  const realestate = trendRealestate();
  const history = trendHistory();

  const seoul = await loadRealestatePage({ realestate, history, kind: "sale" });
  const page = await loadRealestatePage({ realestate, history, district: TREND_DISTRICT.name });
  assert.notEqual(page.trendMeta(), seoul.trendMeta(), "서울 전체 추이를 그대로 쓰고 있다");

  const now = realestate.districts.find((d) => d.name === TREND_DISTRICT.name).sale.avgPricePerPyeong10k;
  assert.match(page.trendMeta(), new RegExp(`${now.toLocaleString("ko-KR")}만원`));
});

test("자치구 페이지에는 평형 선택이 뜬다", async () => {
  const realestate = await readJson("realestate");
  const page = await loadRealestatePage({ realestate, district: "강남구" });
  // 84㎡ 환산 열이 있으므로 평형을 고를 수 있어야 한다
  assert.equal(page.byId("area-controls").hidden, false);
});

test("커밋된 자치구 페이지 25개가 지금 원본·데이터로 찍은 결과와 같다", async () => {
  const [baseHtml, realestate] = await Promise.all([read("docs/realestate.html"), readJson("realestate")]);

  assert.equal(DISTRICT_PAGES.length, 25);
  for (const district of DISTRICT_PAGES) {
    assert.equal(
      await read(`docs/${district.file}`),
      buildDistrictPage(baseHtml, district, realestate),
      `docs/${district.file}이 원본과 어긋납니다. node scripts/build-realestate-pages.mjs를 실행하세요.`
    );
  }
});

// 크롤러가 25개 페이지를 발견하는 유일한 내부 경로다. sitemap만으로는 늦다.
//
// 경로는 페이지마다 다르다 - 전체·거래 유형 페이지는 표의 지역 이름이 곧 링크이고,
// 자치구 페이지는 그 표가 없으므로 하단 목록이 그 역할을 한다. 어느 쪽이든 25개가 다
// 걸려 있어야 한다.
test("모든 시세 페이지가 25개 자치구로 링크한다", async () => {
  for (const file of ["realestate.html", "apartment-sale.html", "district-gangnam.html"]) {
    const html = await read(`docs/${file}`);
    for (const { file: target } of DISTRICT_PAGES) {
      assert.ok(html.includes(`href="./${target}"`), `${file}: ${target} 링크가 없다`);
    }
  }
});

// 표에서 바로 갈 수 있는데 같은 목록을 아래 한 번 더 두면 화면만 길어진다.
test("표가 있는 페이지에는 하단 지역 목록을 두지 않는다", async () => {
  const block = async (file) =>
    (await read(`docs/${file}`)).split("<!--prerender:districtLinks-->")[1]?.split("<!--/prerender")[0] ?? "";

  for (const file of ["realestate.html", "apartment-sale.html", "apartment-jeonse.html"]) {
    assert.equal(await block(file), "", `${file}: 하단 목록이 남아 있다`);
  }

  // 자치구 페이지는 그 지역 표만 보여주므로 목록이 유일한 이동 수단이다.
  assert.equal((await block("district-gangnam.html")).match(/<a /g)?.length, 25);
});

test("표의 지역 이름이 그 지역 페이지로 간다", async () => {
  const html = await read("docs/realestate.html");
  assert.match(html, /<td><a href="\.\/district-gangnam\.html">강남구<\/a>/);
  // 서울 전체 행은 갈 곳이 없다.
  assert.match(html, /<tr class="overall-row"><td>서울 전체<\/td>/);
});

test("자치구 페이지는 자기 지역을 링크 목록에서 표시한다", async () => {
  const html = await read("docs/district-songpa.html");
  const block = html.split("<!--prerender:districtLinks-->")[1].split("<!--/prerender")[0];
  assert.ok(block.includes('<a href="./district-songpa.html" aria-current="page">송파구</a>'));
});

// --- 지역별 서술 ---
// 25개 페이지가 구조만 같고 숫자만 다르면 템플릿 대량 생산으로 읽힌다. 그 지역
// 데이터로만 만들 수 있는 문장이라야 페이지마다 실제로 다른 내용이 된다.
// 어느 구가 1위인지는 그날 신고에 따라 바뀐다(1·2위 차이가 0.25%인 날도 있었고, 달 초에는
// 강남구 신고가 5건에 못 미쳐 순위 문장 자체가 안 나온다). 검사하려는 건 "1등 구에 1등
// 문장이 붙는가"라, 구 이름을 적어두지 않고 그날 데이터가 정한 1등·꼴찌를 꺼내 본다.
test("지역마다 다른 문장이 나온다", async (t) => {
  const realestate = await readJson("realestate");
  const of = (entry) => districtSentences(entry, realestate).join(" ");

  const priced = realestate.districts
    .filter((d) => typeof d.sale?.avgPricePerPyeong10k === "number" && d.sale.transactionCount >= 5)
    .sort((a, b) => b.sale.avgPricePerPyeong10k - a.sale.avgPricePerPyeong10k);

  // 달이 바뀐 직후에는 표본 5건을 넘긴 구가 둘도 안 되는 날이 있다(신고 기한이 30일이다).
  // 그때는 순위 문장이 아예 안 나오는 게 맞는 동작이라(district-summary.mjs의 saleRank가
  // null을 돌려준다) 검사할 것이 없다. 순위 규칙 자체는 바로 아래 고정 재료 테스트가 본다.
  if (priced.length < 2) {
    t.diagnostic(`표본이 충분한 구가 ${priced.length}개뿐이라 순위 문장 검사를 건너뛴다`);
    return;
  }

  const top = of(priced[0]);
  const bottom = of(priced[priced.length - 1]);

  assert.notEqual(top, bottom);
  assert.match(top, /가장 높습니다/);
  assert.match(bottom, /가장 낮습니다/);
  // 가장 비슷한 구가 서로 다르므로 문장도 갈린다
  assert.ok(!top.includes(priced[priced.length - 1].name) || !bottom.includes(priced[0].name));
});

test("서울 평균 대비 배수와 순위가 맞다", () => {
  const realestate = {
    overall: { sale: { avgPricePerPyeong10k: 4000, transactionCount: 500 } },
    districts: [
      district("비싼구", { sale: { avgPricePerPyeong10k: 8000, transactionCount: 10 } }),
      district("보통구", { sale: { avgPricePerPyeong10k: 4000, transactionCount: 10 } }),
      district("싼구", { sale: { avgPricePerPyeong10k: 2000, transactionCount: 10 } }),
    ],
  };
  const text = districtSentences(realestate.districts[0], realestate).join(" ");
  assert.match(text, /2배/);
  assert.match(text, /3개 구 가운데 가장 높습니다/);

  const same = districtSentences(realestate.districts[1], realestate).join(" ");
  assert.match(same, /같은 수준/, `1.0배는 '같다'로 써야 한다: ${same}`);
});

// 값을 못 내는 상태를 문장으로 덮으면 안 된다. 왜 비어 있는지가 오히려 정보다.
//
// 예전엔 그날 realestate.json에서 종로구를 꺼내 봤는데, 종로구 신고가 쌓이면(35건이 된
// 날이 있었다) 테스트가 깨졌다. 검사하려는 건 특정 구의 그날 사정이 아니라 "표본이
// 모자랄 때 문장이 어떻게 나오는가"라, 그 상태를 직접 만들어 확인한다.
test("표본이 모자라면 지어내지 않고 그 사실을 쓴다", () => {
  const thin = {
    name: "종로구",
    sale: { avgPricePerPyeong10k: 9999, transactionCount: 2 },
    jeonse: { avgDepositPerPyeong10k: 3478, transactionCount: 11 },
    wolse: { avgDeposit10k: 27349, avgMonthlyRent10k: 110, transactionCount: 18 },
  };
  const realestate = {
    period: "202608",
    overall: {
      sale: { avgPricePerPyeong10k: 4449, transactionCount: 575 },
      jeonse: { avgDepositPerPyeong10k: 2571, transactionCount: 2525 },
      wolse: { avgDeposit10k: 22166, avgMonthlyRent10k: 96, transactionCount: 2223 },
    },
    districts: [thin],
  };
  const text = districtSentences(thin, realestate).join(" ");

  assert.match(text, /신고가 2건뿐이라 평균을 내지 않았습니다/);
  assert.ok(!text.includes("배입니다"), `평균을 못 내는데 배수를 썼다: ${text}`);
  // 매매가 없어도 전세는 신고가 많아 값이 있다. 그것마저 빼면 페이지가 빈 것처럼 보인다.
  assert.match(text, /전세는 평당 보증금/);
});

test("조사를 받침에 맞춰 고른다", () => {
  const thin = (name) => ({ name, sale: { avgPricePerPyeong10k: 9999, transactionCount: 1 } });
  assert.match(districtSentences(thin("종로구"), {}).join(" "), /종로구는/);
  assert.match(districtSentences(thin("서울시"), {}).join(" "), /서울시는/);
  assert.match(districtSentences(thin("한남동"), {}).join(" "), /한남동은/);
});

// 문장 첫머리를 그대로 적어두면 안 된다 - 그 구의 신고가 5건에 못 미치는 달 초에는
// "송파구는 이번 달 아파트 매매 신고가 2건뿐이라 평균을 내지 않았습니다"로 바뀐다.
// 그건 맞는 동작이고, 여기서 볼 것은 "두 언어 문단이 자기 지역 얘기로 심겼는가"다.
test("정적 HTML에 한국어·영어 문단이 모두 심긴다", async () => {
  const html = await read("docs/district-songpa.html");
  const ko = html.split("<!--prerender:districtSummaryKo-->")[1].split("<!--/prerender")[0];
  const en = html.split("<!--prerender:districtSummaryEn-->")[1].split("<!--/prerender")[0];

  assert.ok(ko.includes("송파구"), `한국어 문단이 비었거나 다른 지역이다: ${ko.slice(0, 80)}`);
  assert.ok(en.includes("송파구"), `영어 문단이 비었거나 다른 지역이다: ${en.slice(0, 80)}`);
  assert.match(ko, /니다\./, "한국어 문단이 문장으로 안 끝난다");
  // 지역 이름은 영어 문단에서도 한국어 그대로 쓴다("Apartments in 송파구"). 문장이
  // 영어로 쓰였는지만 본다.
  assert.match(en, /[a-z]{4,}/, "영어 문단에 영어가 없다");
  assert.ok(!/니다\./.test(en), `영어 문단에 한국어 문장이 남았다: ${en.slice(0, 80)}`);
});

test("자치구가 아닌 페이지에는 서술이 없다", async () => {
  for (const file of ["realestate.html", "apartment-sale.html"]) {
    const html = await read(`docs/${file}`);
    const ko = html.split("<!--prerender:districtSummaryKo-->")[1].split("<!--/prerender")[0];
    assert.equal(ko, "", `${file}에 서술이 들어갔다`);
  }
});

// 언어별 문단 전환은 여기서 검증하지 않는다. 이 하네스의 querySelectorAll이 빈 배열을
// 돌려주기 때문에 루프가 아예 안 돌고, 그러면 "화면이 아무 일도 안 하는" 상태와
// 구분되지 않는 채로 통과한다. 실제로 그렇게 통과하는 테스트를 한 번 만들었다가 뺐다.
// 정적 HTML에 두 언어가 모두 심기는지는 위에서 확인하고, 전환은 hidden 속성을 바꾸는
// 세 줄짜리 코드다.
