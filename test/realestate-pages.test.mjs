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
  assert.deepEqual(headCells(realestateHeadHtml("jeonse")), ["지역", "평당 보증금", "84㎡ 환산", "거래건수"]);
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
