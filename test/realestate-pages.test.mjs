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

const TREND_WEEKS = ["2026-07-27", "2026-08-03", "2026-08-10"];

const PENDING_WEEKS = ["2026-08-17", "2026-08-24"];

const pendingTrendData = () => {
  const trend = trendData();
  trend.pendingWeeks = PENDING_WEEKS;
  trend.overall["2026-08-17"] = metrics(-300);
  trend.overall["2026-08-24"] = metrics(-600);
  trend.districts[TREND_DISTRICT.name]["2026-08-17"] = metrics(200);
  trend.districts[TREND_DISTRICT.name]["2026-08-24"] = metrics(100);
  return trend;
};

const trendData = () => ({
  weeks: TREND_WEEKS,
  overall: {
    "2026-07-27": metrics(-40),
    "2026-08-03": metrics(-20),
    "2026-08-10": metrics(),
  },
  districts: {
    [TREND_DISTRICT.name]: {
      "2026-07-27": metrics(460),
      "2026-08-03": metrics(480),
      "2026-08-10": metrics(500),
    },
  },
});

test("84㎡ 환산이 손계산과 같다", () => {
  assert.equal(BASE_AREA_PYEONG.toFixed(3), "25.410");
  assert.equal(areaPrice(4449), Math.round(4449 * BASE_AREA_PYEONG));
  assert.equal(formatEok(areaPrice(4449)), "11억 3,049만원");
  assert.equal(formatEok(30000), "3억원");
  assert.equal(formatEok(5000), "5,000만원");
  assert.equal(areaPrice(null), null);
  assert.equal(formatEok(null), "-");
});

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
  assert.deepEqual(headCells(realestateHeadHtml("jeonse")), ["지역", "평당 보증금", "84㎡ 환산", "전세가율", "거래건수"]);
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

test("이번 달 표본이 충분하면 지난달 값을 쓰지 않는다", () => {
  const entry = { ...thinWithPrev("강남구"), sale: { avgPricePerPyeong10k: 8000, transactionCount: 30 } };
  const html = realestateTableHtml({ previousPeriod: "202607", districts: [entry] }, "sale");
  assert.ok(html.includes("8,000만원"));
  assert.ok(!html.includes("prev-tag"), "이번 달 값인데 지난달 표시가 붙었다");
});

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

test("전세가율은 전세를 매매로 나눈 값이다", () => {
  const entry = district("강남구", {
    sale: { avgPricePerPyeong10k: 10000, transactionCount: 10 },
    jeonse: { avgDepositPerPyeong10k: 4000, transactionCount: 20 },
  });
  assert.equal(jeonseRatio(entry).ratio.toFixed(1), "40.0");
  assert.ok(realestateTableHtml({ districts: [entry] }, "jeonse").includes("40.0%"));
});

test("한쪽 표본이 모자라면 전세가율을 내지 않는다", () => {
  const entry = district("종로구", {
    sale: { avgPricePerPyeong10k: 13358, transactionCount: 2 },
  });
  assert.equal(jeonseRatio(entry), null);
  const html = realestateTableHtml({ districts: [entry] }, "jeonse");
  assert.ok(html.includes("<td data-label=\"전세가율\">-</td>"), "표본이 모자란데 비율이 나왔다");
});

test("기준 달이 서로 다르면 전세가율을 내지 않는다", () => {
  const entry = {
    name: "노원구",
    sale: { avgPricePerPyeong10k: 9999, transactionCount: 2 },
    jeonse: { avgDepositPerPyeong10k: 1900, transactionCount: 60 },
    prev: { sale: { avgPricePerPyeong10k: 4000, transactionCount: 40 } },
  };
  assert.equal(jeonseRatio(entry), null);
});

test("매매·월세 페이지에는 전세가율이 없다", () => {
  assert.ok(!realestateHeadHtml("sale").includes("전세가율"));
  assert.ok(!realestateHeadHtml("wolse").includes("전세가율"));
});

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

test("거래 유형마다 자기 지표의 추이를 그린다", async () => {
  const realestate = trendRealestate();
  const trend = trendData();

  for (const kind of ["sale", "jeonse", "wolse"]) {
    const page = await loadRealestatePage({ realestate, trend, kind });
    assert.ok(page.trendHtml().includes("polyline"), `${kind}: 그래프가 없다`);
    assert.equal(page.byId("trend-section").hidden, false);
  }
});

test("추이는 주 단위로 적는다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });

  assert.match(page.trendMeta(), /2026-07-27 ~ 2026-08-10/);
  assert.match(page.trendMeta(), /3주/, page.trendMeta());
});

test("값이 없는 주는 추이에서 뺀다", async () => {
  const realestate = await readJson("realestate");
  const trend = {
    weeks: ["2026-07-27", "2026-08-03", "2026-08-10"],
    overall: {
      "2026-08-03": { sale: { avgPricePerPyeong10k: 4000, transactionCount: 50 } },
      "2026-08-10": { sale: { avgPricePerPyeong10k: 4100, transactionCount: 60 } },
    },
    districts: {},
  };
  const page = await loadRealestatePage({ realestate, trend, kind: "sale" });

  assert.match(page.trendMeta(), /2026-08-03 ~ 2026-08-10/, `값 없는 주가 남았다: ${page.trendMeta()}`);
  assert.match(page.trendMeta(), /2주/);
});

test("한 주뿐이면 빈 그래프 대신 이유를 적는다", async () => {
  const realestate = await readJson("realestate");
  const trend = {
    weeks: ["2026-08-10"],
    overall: { "2026-08-10": { sale: { avgPricePerPyeong10k: 4000, transactionCount: 50 } } },
    districts: {},
  };
  const page = await loadRealestatePage({ realestate, trend, kind: "sale" });

  assert.equal(page.trendHtml(), "");
  assert.match(page.trendMeta(), /두 주 이상/);
});

test("추이를 못 받아도 표는 그대로 나온다", async () => {
  const realestate = await readJson("realestate");
  const page = await loadRealestatePage({ realestate, kind: "sale" });
  assert.ok(cells(page.tableHtml()).length > 0, "추이가 없다고 표까지 비었다");
});

test("자치구 페이지는 한 지역의 세 유형을 행으로 보여준다", async () => {
  const realestate = await readJson("realestate");
  const page = await loadRealestatePage({ realestate, district: "강남구" });

  assert.deepEqual(headCells(page.headHtml()), ["구분", "평당가", "84㎡ 환산", "거래건수"]);
  assert.deepEqual(names(page.tableHtml()), ["매매", "전세", "월세"]);
  assert.match(page.sandbox.document.title, /강남구/);
});

test("자치구 페이지의 월세 행에는 환산가가 없다", async () => {
  const realestate = await readJson("realestate");
  const page = await loadRealestatePage({ realestate, district: "강남구" });
  const rows = page.tableHtml().split("</tr>");
  const wolseRow = rows.find((r) => r.includes(">월세<"));
  assert.ok(wolseRow.includes('data-label="84㎡ 환산">-<'), `월세 행: ${wolseRow}`);
});

test("자치구 페이지 추이는 그 지역 값을 그린다", async () => {
  const realestate = trendRealestate();
  const trend = trendData();

  const seoul = await loadRealestatePage({ realestate, trend, kind: "sale" });
  const page = await loadRealestatePage({ realestate, trend, district: TREND_DISTRICT.name });
  assert.notEqual(page.trendHtml(), seoul.trendHtml(), "서울 전체 추이를 그대로 쓰고 있다");

  const now = realestate.districts.find((d) => d.name === TREND_DISTRICT.name).sale.avgPricePerPyeong10k;
  assert.match(page.cardCurrent("trend"), new RegExp(`${now.toLocaleString("ko-KR")}만원`));
});

test("자치구 페이지에는 평형 선택이 뜬다", async () => {
  const realestate = await readJson("realestate");
  const page = await loadRealestatePage({ realestate, district: "강남구" });
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

test("모든 시세 페이지가 25개 자치구로 링크한다", async () => {
  for (const file of ["realestate.html", "apartment-sale.html", "district-gangnam.html"]) {
    const html = await read(`docs/${file}`);
    for (const { file: target } of DISTRICT_PAGES) {
      assert.ok(html.includes(`href="./${target}"`), `${file}: ${target} 링크가 없다`);
    }
  }
});

test("표가 있는 페이지에는 하단 지역 목록을 두지 않는다", async () => {
  const block = async (file) =>
    (await read(`docs/${file}`)).split("<!--prerender:districtLinks-->")[1]?.split("<!--/prerender")[0] ?? "";

  for (const file of ["realestate.html", "apartment-sale.html", "apartment-jeonse.html"]) {
    assert.equal(await block(file), "", `${file}: 하단 목록이 남아 있다`);
  }

  assert.equal((await block("district-gangnam.html")).match(/<a /g)?.length, 25);
});

test("표의 지역 이름이 그 지역 페이지로 간다", async () => {
  const html = await read("docs/realestate.html");
  assert.match(html, /<td><a href="\.\/district-gangnam\.html">강남구<\/a>/);
  assert.match(html, /<tr class="overall-row"><td>서울 전체<\/td>/);
});

test("자치구 페이지는 자기 지역을 링크 목록에서 표시한다", async () => {
  const html = await read("docs/district-songpa.html");
  const block = html.split("<!--prerender:districtLinks-->")[1].split("<!--/prerender")[0];
  assert.ok(block.includes('<a href="./district-songpa.html" aria-current="page">송파구</a>'));
});

test("지역마다 다른 문장이 나온다", async (t) => {
  const realestate = await readJson("realestate");
  const of = (entry) => districtSentences(entry, realestate).join(" ");

  const priced = realestate.districts
    .filter((d) => typeof d.sale?.avgPricePerPyeong10k === "number" && d.sale.transactionCount >= 5)
    .sort((a, b) => b.sale.avgPricePerPyeong10k - a.sale.avgPricePerPyeong10k);

  if (priced.length < 2) {
    t.diagnostic(`표본이 충분한 구가 ${priced.length}개뿐이라 순위 문장 검사를 건너뛴다`);
    return;
  }

  const top = of(priced[0]);
  const bottom = of(priced[priced.length - 1]);

  assert.notEqual(top, bottom);
  assert.match(top, /가장 높습니다/);
  assert.match(bottom, /가장 낮습니다/);
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
  assert.match(text, /전세는 평당 보증금/);
});

test("조사를 받침에 맞춰 고른다", () => {
  const thin = (name) => ({ name, sale: { avgPricePerPyeong10k: 9999, transactionCount: 1 } });
  assert.match(districtSentences(thin("종로구"), {}).join(" "), /종로구는/);
  assert.match(districtSentences(thin("서울시"), {}).join(" "), /서울시는/);
  assert.match(districtSentences(thin("한남동"), {}).join(" "), /한남동은/);
});

test("정적 HTML에 한국어·영어 문단이 모두 심긴다", async () => {
  const html = await read("docs/district-songpa.html");
  const ko = html.split("<!--prerender:districtSummaryKo-->")[1].split("<!--/prerender")[0];
  const en = html.split("<!--prerender:districtSummaryEn-->")[1].split("<!--/prerender")[0];

  assert.ok(ko.includes("송파구"), `한국어 문단이 비었거나 다른 지역이다: ${ko.slice(0, 80)}`);
  assert.ok(en.includes("송파구"), `영어 문단이 비었거나 다른 지역이다: ${en.slice(0, 80)}`);
  assert.match(ko, /니다\./, "한국어 문단이 문장으로 안 끝난다");
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

test("추이가 어느 날짜 기준인지 밝힌다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });
  const meta = page.trendMeta();

  assert.match(meta, /계약일 기준/, meta);
  assert.match(meta, /신고 기한/, meta);
  assert.ok(!meta.includes("현재 "), `마지막 주 값을 현재 시세처럼 적었다: ${meta}`);
});

test("추이가 어느 지표인지 라벨로 밝힌다", async () => {
  const realestate = trendRealestate();
  const trend = trendData();

  const expected = {
    sale: "매매 평당가",
    jeonse: "전세 평당 보증금",
    wolse: "월세 보증금(평당 아님)",
  };

  for (const [kind, label] of Object.entries(expected)) {
    const page = await loadRealestatePage({ realestate, trend, kind });
    assert.match(page.cardLabel("trend"), new RegExp(label.replace(/[()]/g, "\\$&")), `${kind}: ${page.cardLabel("trend")}`);
  }
});

test("거래량 추이를 함께 그린다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });

  assert.ok(page.volumeHtml().includes("polyline"), "거래량 그래프가 없다");
  assert.match(page.cardLabel("volume"), /매매 거래량/, page.cardLabel("volume"));
  assert.match(page.cardCurrent("volume"), /50건/, page.cardCurrent("volume"));
  assert.match(page.cardMinMax("volume"), /최고 .*건 · 최저 .*건/, page.cardMinMax("volume"));
  assert.equal(page.cardHidden("volume-card"), false);
});

test("거래 유형을 바꾸면 거래량도 그 유형을 센다", async () => {
  const realestate = trendRealestate();
  const trend = trendData();

  const jeonse = await loadRealestatePage({ realestate, trend, kind: "jeonse" });
  assert.match(jeonse.cardLabel("volume"), /전세 거래량/);
  assert.match(jeonse.cardCurrent("volume"), /40건/, jeonse.cardCurrent("volume"));

  const wolse = await loadRealestatePage({ realestate, trend, kind: "wolse" });
  assert.match(wolse.cardLabel("volume"), /월세 거래량/);
});

test("전세가율 추이를 그린다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });

  assert.ok(page.ratioHtml().includes("polyline"), "전세가율 그래프가 없다");
  assert.match(page.cardLabel("ratio"), /전세가율/, page.cardLabel("ratio"));
  assert.match(page.cardCurrent("ratio"), /56\.8%/, `2500/4400 = 56.8%가 아니다: ${page.cardCurrent("ratio")}`);
});

test("월세 페이지에는 전세가율을 두지 않는다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "wolse" });
  assert.equal(page.cardHidden("ratio-card"), true, "월세와 상관없는 지표가 남았다");
});

test("매매나 전세 값이 없는 주는 전세가율에서 뺀다", async () => {
  const realestate = await readJson("realestate");
  const trend = {
    weeks: ["2026-07-27", "2026-08-03", "2026-08-10"],
    overall: {
      "2026-07-27": { sale: { avgPricePerPyeong10k: 4000, transactionCount: 50 } },
      "2026-08-03": {
        sale: { avgPricePerPyeong10k: 4000, transactionCount: 50 },
        jeonse: { avgDepositPerPyeong10k: 2400, transactionCount: 40 },
      },
      "2026-08-10": {
        sale: { avgPricePerPyeong10k: 4000, transactionCount: 50 },
        jeonse: { avgDepositPerPyeong10k: 2000, transactionCount: 40 },
      },
    },
    districts: {},
  };
  const page = await loadRealestatePage({ realestate, trend, kind: "sale" });

  const weeks = [...page.ratioHtml().matchAll(/class="axis x">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(weeks, ["8/3", "8/10"], `값 없는 주가 남았다: ${weeks.join(" ")}`);
  assert.match(page.cardCurrent("ratio"), /50\.0%/);
});

test("신고가 덜 찬 주는 점선으로 이어 그린다", async () => {
  const page = await loadRealestatePage({
    realestate: trendRealestate(),
    trend: pendingTrendData(),
    kind: "sale",
  });
  const svg = page.trendHtml();

  const lines = [...svg.matchAll(/<polyline([^>]*)>/g)].map((m) => m[1]);
  assert.equal(lines.length, 2, `실선과 점선 두 줄이어야 한다: ${lines.length}줄`);
  assert.ok(!lines[0].includes("stroke-dasharray"), "확정 구간까지 점선으로 그렸다");
  assert.match(lines[1], /class="pending"/, "잠정 구간에 표시가 없다");
  assert.match(lines[1], /stroke-dasharray/, "잠정 구간이 실선이다");

  const weeks = [...svg.matchAll(/class="axis x">([^<]+)</g)].map((m) => m[1]);
  assert.equal(weeks.at(-1), "8/24", `잠정 주까지 가로축에 담기지 않았다: ${weeks.join(" ")}`);
});

test("점선은 마지막 확정 지점에서 이어 나간다", async () => {
  const page = await loadRealestatePage({
    realestate: trendRealestate(),
    trend: pendingTrendData(),
    kind: "sale",
  });
  const [firm, pending] = [...page.trendHtml().matchAll(/points="([^"]+)"/g)].map((m) => m[1].split(" "));

  assert.equal(firm.length, TREND_WEEKS.length, "확정 구간 지점 수가 다르다");
  assert.equal(pending.length, PENDING_WEEKS.length + 1, "점선이 이어 붙지 않고 떨어져 있다");
  assert.equal(pending[0], firm.at(-1), "점선이 마지막 확정 지점에서 시작하지 않는다");
});

test("잠정 주는 카드에 적는 숫자로 세지 않는다", async () => {
  const firm = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });
  const withPending = await loadRealestatePage({
    realestate: trendRealestate(),
    trend: pendingTrendData(),
    kind: "sale",
  });

  assert.equal(withPending.cardCurrent("trend"), firm.cardCurrent("trend"), "덜 찬 주를 현재값으로 적었다");
  assert.equal(withPending.cardMinMax("trend"), firm.cardMinMax("trend"), "덜 찬 주가 최고·최저에 섞였다");
  assert.match(withPending.trendMeta(), /2026-07-27 ~ 2026-08-10/, "잠정 주까지 기간에 넣었다");
  assert.match(withPending.trendMeta(), /점선/, "점선이 무엇인지 밝히지 않았다");
});

test("잠정 주가 없으면 점선도 안내도 없다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });

  assert.ok(!page.trendHtml().includes("stroke-dasharray"), "그릴 잠정 주가 없는데 점선을 그었다");
  assert.ok(!page.trendMeta().includes("점선"), "점선이 없는데 점선을 설명한다");
});

test("표본이 모자란 지역은 값을 비운다", () => {
  const html = realestateTableHtml({ districts: [thinWithPrev("노원구")] }, "sale");

  assert.ok(!html.includes("9999"), `표본 한 건짜리 평균이 표에 남았다: ${html}`);
  assert.ok(!html.includes("지난달"), "지난달로 대체하는 표시가 남았다");
});

test("추이 그래프에 양 축 눈금을 적는다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });
  const svg = page.trendHtml();

  const yLabels = [...svg.matchAll(/class="axis y">([^<]+)</g)].map((m) => m[1]);
  const xLabels = [...svg.matchAll(/class="axis x">([^<]+)</g)].map((m) => m[1]);

  assert.equal(yLabels.length, 3, `세로 눈금이 없다: ${svg}`);
  assert.ok(yLabels[0].includes("만원"), `세로 눈금에 단위가 없다: ${yLabels[0]}`);
  assert.deepEqual(xLabels, ["7/27", "8/3", "8/10"], "가로 눈금이 주 날짜가 아니다");
  assert.ok(!svg.includes('preserveAspectRatio="none"'), "가로로 늘어나 글자가 찌그러진다");
});

test("눈금 위아래로 값의 범위를 담는다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });
  const yLabels = [...page.trendHtml().matchAll(/class="axis y">([^<]+)</g)].map((m) => m[1]);

  const nums = yLabels.map((s) => Number(s.replace(/[^\d]/g, "")));
  assert.ok(nums[0] > nums[2], `위쪽이 더 큰 값이어야 한다: ${yLabels.join(" / ")}`);
  assert.equal(nums[0], 4400, "최댓값이 눈금에 없다");
  assert.equal(nums[2], 4360, "최솟값이 눈금에 없다");
});

test("가로 위치에서 가장 가까운 지점을 고른다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });
  const at = page.app.chartIndexAt;

  assert.equal(at(0, 3), 0, "왼쪽 끝이 첫 지점이 아니다");
  assert.equal(at(1, 3), 2, "오른쪽 끝이 마지막 지점이 아니다");
  assert.equal(at(0.5, 3), 1);
  assert.equal(at(-5, 3), 0, "그래프 밖을 벗어난 좌표를 가두지 못했다");
  assert.equal(at(9, 3), 2);
  assert.equal(at(0.5, 0), null);
});

test("축 글자를 시세 표 글자와 같은 크기로 적는다", async () => {
  const html = await readFile(path.join(root, "docs/realestate.html"), "utf8");
  const table = html.match(/\.data-table \{[^}]*font-size: ([\d.]+rem)/)?.[1];
  const axis = html.match(/\.history-card \.axis \{[^}]*font-size: ([\d.]+rem)/)?.[1];

  assert.ok(table, "시세 표 글자 크기를 읽지 못했다");
  assert.equal(axis, table, "그래프 축 글자가 시세 표 글자와 다른 크기다");
});

test("시세 페이지 추이 카드가 데일리 다이제스트와 같은 짜임이다", async () => {
  const [realestate, index] = await Promise.all([
    readFile(path.join(root, "docs/realestate.html"), "utf8"),
    readFile(path.join(root, "docs/index.html"), "utf8"),
  ]);

  const rules = (html) =>
    [
      ".history-grid",
      ".history-card",
      ".history-card .label",
      ".history-stats",
      ".history-current",
      ".history-minmax",
      ".history-card .axis",
    ].map((selector) => {
      const at = html.indexOf(`  ${selector} {`);
      assert.notEqual(at, -1, `${selector} 규칙이 없다`);
      return html.slice(at, html.indexOf("}", at)).replace(/\s+/g, " ").trim();
    });

  assert.deepEqual(rules(realestate), rules(index), "두 화면의 카드 스타일이 갈라졌다");

  for (const [what, html] of [["시세", realestate], ["다이제스트", index]]) {
    assert.match(html, /class="history-card"/, `${what}: 카드 짜임이 다르다`);
    assert.match(html, /class="history-stats"/, `${what}: 값 줄이 없다`);
    assert.match(html, /class="history-chart"/, `${what}: 그래프 자리가 없다`);
  }
});

test("두 화면의 그래프가 같은 좌표계로 그려진다", async () => {
  const [realestate, index] = await Promise.all([
    readFile(path.join(root, "docs/realestate.html"), "utf8"),
    readFile(path.join(root, "docs/index.html"), "utf8"),
  ]);

  const chartConst = (html) => html.match(/const CHART = \{[^}]*\}/)?.[0].replace(/\s+/g, " ");
  assert.ok(chartConst(realestate), "시세 페이지 좌표계를 읽지 못했다");
  assert.equal(chartConst(realestate), chartConst(index), "두 화면의 그래프 크기 규칙이 갈라졌다");
});

test("그래프 좌표계를 그려질 자리의 픽셀과 1:1로 잡는다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });
  const box = page.app.chartBox(700, ["11,607만원", "9,983만원", "8,360만원"]);

  assert.equal(box.w, 700, "가로 좌표가 그려질 자리 너비와 어긋나면 글자가 확대된다");
  assert.equal(box.h, Math.round(700 * 0.7 * (132 / 320)), "예전 높이의 70%가 아니다");
  assert.ok(box.left >= page.app.axisTextWidth("11,607만원"), `세로 눈금 글자가 잘린다: ${box.left}`);
});

test("좁은 화면에서도 그래프가 납작해지지 않는다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });
  const box = page.app.chartBox(300, ["4,400만원"]);

  assert.ok(box.h >= 120, `높이가 너무 낮다: ${box.h}`);
  assert.ok(box.left < box.w * 0.45, `세로 눈금이 그림 자리를 다 먹었다: ${box.left}`);
});

test("거래량·전세가율 눈금에는 마지막 주 문구를 붙이지 않는다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });

  for (const [what, svg] of [["거래량", page.volumeHtml()], ["전세가율", page.ratioHtml()]]) {
    const labels = [...svg.matchAll(/class="axis y">([^<]+)</g)].map((m) => m[1]);
    assert.equal(labels.length, 3, `${what} 세로 눈금이 없다`);
    for (const label of labels) {
      assert.ok(!label.includes("마지막 주"), `${what} 눈금에 설명 문구가 들어가 잘린다: ${label}`);
    }
  }
  assert.match(page.cardCurrent("volume"), /^\d[\d,]*건$/, "카드 값에 설명 문구가 붙었다");
});

test("그래프에 마우스를 올릴 자리를 마련해 둔다", async () => {
  const page = await loadRealestatePage({ realestate: trendRealestate(), trend: trendData(), kind: "sale" });
  assert.match(page.trendHtml(), /class="marker" hidden/, "짚어줄 표시가 없다");

  const html = await readFile(path.join(root, "docs/realestate.html"), "utf8");
  assert.match(html, /<div class="chart-tip" id="chart-tip" hidden>/, "말풍선이 처음부터 떠 있다");
  assert.match(html, /trendSection\.addEventListener\("mousemove"/, "마우스를 따라가지 않는다");
  assert.match(html, /trendSection\.addEventListener\("touchstart"/, "손가락으로는 볼 수 없다");
});
