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
} from "../scripts/realestate-format.mjs";
import {
  realestateHeadHtml,
  realestateOverallHtml,
  realestateTableHtml,
} from "../scripts/prerender.mjs";
import { REALESTATE_PAGES, buildRealestatePage } from "../scripts/build-realestate-pages.mjs";
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
