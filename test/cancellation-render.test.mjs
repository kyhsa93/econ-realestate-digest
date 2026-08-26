import test from "node:test";
import assert from "node:assert/strict";
import { buildPayload } from "../scripts/build-cancellation.mjs";
import { loadCancellationPage } from "./helpers/cancellation-page.mjs";

const NOW = new Date("2026-08-26T00:00:00Z");

const sale = (extra = {}) => ({
  sggCd: 11350,
  aptNm: "극동아파트",
  jibun: "123",
  excluUseAr: 84.9,
  dealAmount: "100,000",
  dealYear: 2026,
  dealMonth: 3,
  dealDay: 10,
  rgstDate: "26.05.15",
  cdealType: "",
  cdealDay: "",
  ...extra,
});

function districtDeals(name, { stale = 10, cancel = 3 } = {}) {
  return [
    ...Array.from({ length: 100 }, (_, i) => sale({ dealMonth: 3, dealDay: (i % 28) + 1 })),
    ...Array.from({ length: stale }, (_, i) => sale({ dealMonth: 3, dealDay: (i % 28) + 1, rgstDate: "" })),
    ...Array.from({ length: cancel }, (_, i) =>
      sale({ dealMonth: 3, dealDay: (i % 28) + 1, cdealType: "O", cdealDay: "26.04.08", rgstDate: "", dealAmount: "80,000" })
    ),
    // 아직 안 익은 달 - 미등기지만 세면 안 된다.
    ...Array.from({ length: 40 }, (_, i) => sale({ dealMonth: 8, dealDay: (i % 25) + 1, rgstDate: "" })),
  ].map((item) => ({ ...item, aptNm: `${name}아파트` }));
}

const CANCELLATION = buildPayload({
  byDistrict: { 노원구: districtDeals("노원", { stale: 10, cancel: 3 }), 강남구: districtDeals("강남", { stale: 30, cancel: 8 }) },
  months: ["202603", "202608"],
  now: NOW,
});

const open = (extra = {}) => loadCancellationPage({ cancellation: CANCELLATION, ...extra });

test("첫 문단은 빌드가 만든 문장을 그대로 쓴다", async () => {
  const page = await open();
  assert.equal(page.leadText(), CANCELLATION.seoul.leadKo);
  assert.match(page.leadText(), /해제됐다/);
});

test("자치구 표에 해제율과 미등기율이 함께 나온다", async () => {
  const page = await open();
  const table = page.districtTable();

  assert.match(table, /자치구/);
  assert.match(table, /해제율/);
  assert.match(table, /미등기율/);
  assert.match(table, /노원구/);
  assert.match(table, /강남구/);
});

test("익은 달만 굵게 표시해 어느 달을 세었는지 보인다", async () => {
  const page = await open();
  const table = page.monthTable();

  assert.match(table, /<tr class="spot"><td>2026-03/);
  assert.ok(!/<tr class="spot"><td>2026-08/.test(table), "아직 안 익은 달을 센 것처럼 표시했다");
});

test("안 익은 달의 미등기는 자치구 미등기율에 들어가지 않는다", async () => {
  const page = await open();
  const rows = page.districtTable().split("<tr>").filter((r) => r.includes("노원구"));

  // 3월 계약 110건 중 미등기 10건 = 9.1%. 8월의 미등기 40건은 세지 않는다.
  assert.match(rows[0], /9\.1%/);
});

test("등기 문단이 중앙값과 미등기 건수를 말한다", async () => {
  const page = await open();
  assert.match(page.monthLeadText(), /중앙값/);
  assert.match(page.monthLeadText(), /아직 등기를 마치지 않았습니다/);
});

test("자치구별 시세로 가는 링크가 걸린다", async () => {
  const page = await open();
  assert.match(page.districtLinks(), /district-nowon\.html/);
});

test("영어로 바꾸면 문장도 표 머리도 영어가 된다", async () => {
  const page = await open();
  await page.toggleLang();

  assert.equal(page.leadText(), CANCELLATION.seoul.leadEn);
  assert.match(page.districtTable(), /District/);
  assert.match(page.monthTable(), /Contract month/);
});

test("자료가 없으면 그렇다고 말한다", async () => {
  const page = await loadCancellationPage({ cancellation: null });
  assert.match(page.leadText(), /아직 해제·등기 자료가 없습니다/);
});

test("불러오다 실패하면 다시 시도할 수 있다", async () => {
  const page = await loadCancellationPage({ cancellation: undefined, status: 500 });
  assert.match(page.leadHtml(), /다시 시도/);
});
