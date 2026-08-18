import test from "node:test";
import assert from "node:assert/strict";
import {
  attachWeeklyChanges,
  buildWeekly,
  firstFullWeek,
  nextWeek,
  settledWeek,
  weekStart,
} from "../scripts/realestate-weekly.mjs";
import { arrivalRows, arrivalWindowReady, representWindow } from "../scripts/build-realestate.mjs";
import { itemKey } from "../scripts/realestate-raw.mjs";

const NOW = new Date("2026-09-07T00:00:00Z");

const sale = (observedOn, extra = {}) => ({
  type: "sale",
  district: "노원구",
  observedOn,
  amount10k: 60_000,
  area: 60,
  ...extra,
});

const jeonse = (observedOn, extra = {}) => ({
  type: "jeonse",
  district: "노원구",
  observedOn,
  deposit10k: 30_000,
  area: 60,
  ...extra,
});

const wolse = (observedOn, extra = {}) => ({
  type: "wolse",
  district: "노원구",
  observedOn,
  deposit10k: 10_000,
  monthlyRent10k: 80,
  area: 60,
  ...extra,
});

test("한 주는 월요일에 시작한다", () => {
  assert.equal(weekStart("2026-08-24"), "2026-08-24");
  assert.equal(weekStart("2026-08-30"), "2026-08-24");
  assert.equal(weekStart("2026-08-31"), "2026-08-31");
  assert.equal(weekStart(new Date("2026-08-30T15:30:00Z")), "2026-08-31", "KST로 날짜를 세지 않는다");
});

test("주는 달과 해를 넘어서도 이어진다", () => {
  assert.equal(nextWeek("2026-08-31", -1), "2026-08-24");
  assert.equal(nextWeek("2026-12-28", 1), "2027-01-04");
  assert.equal(weekStart("2027-01-01"), "2026-12-28");
});

test("이번 주는 아직 끝나지 않았으므로 확정 주는 지난주다", () => {
  assert.equal(settledWeek(NOW), "2026-08-31");
});

test("진행 중인 주는 집계에 넣지 않는다", () => {
  const weekly = buildWeekly([sale("2026-08-25"), sale("2026-09-01"), sale("2026-09-07")], NOW);

  assert.deepEqual(weekly.weeks, ["2026-08-24", "2026-08-31"]);
  assert.ok(!weekly.overall["2026-09-07"], "이번 주를 확정으로 셌다");
});

test("서울 전체는 그 주 신고분만으로 센다", () => {
  const weekly = buildWeekly(
    [
      sale("2026-08-25", { amount10k: 60_000, area: 60 }),
      sale("2026-08-26", { amount10k: 90_000, area: 60 }),
      sale("2026-09-01", { amount10k: 120_000, area: 60 }),
    ],
    NOW
  );

  assert.equal(weekly.overall["2026-08-24"].sale.transactionCount, 2);
  assert.equal(weekly.overall["2026-08-31"].sale.transactionCount, 1, "지난주 거래가 이번 확정 주에 섞였다");
});

test("자치구는 네 주를 겹쳐 센다", () => {
  const arrivals = ["2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31"].map((day) => sale(day));
  const weekly = buildWeekly(arrivals, NOW);

  assert.equal(weekly.districts.노원구["2026-08-31"].sale.transactionCount, 4, "이동평균이 아니다");
  assert.equal(weekly.overall["2026-08-31"].sale.transactionCount, 1, "서울 전체까지 겹쳐 셌다");
  assert.equal(weekly.movingWeeks, 4);
});

test("전세와 월세를 갈라 센다", () => {
  const weekly = buildWeekly(
    [jeonse("2026-08-25"), jeonse("2026-08-26", { deposit10k: 50_000 }), wolse("2026-08-27")],
    NOW
  );

  const week = weekly.overall["2026-08-24"];
  assert.equal(week.jeonse.transactionCount, 2);
  assert.equal(week.wolse.transactionCount, 1);
  assert.equal(week.wolse.avgMonthlyRent10k, 80);
  assert.ok(!week.sale, "매매가 없는데 값을 만들었다");
});

test("평당가는 면적으로 가중해 낸다", () => {
  const weekly = buildWeekly(
    [sale("2026-08-25", { amount10k: 60_000, area: 60 }), sale("2026-08-26", { amount10k: 30_000, area: 30 })],
    NOW
  );

  assert.equal(weekly.overall["2026-08-24"].sale.avgPricePerPyeong10k, Math.round((1000 * 3.3058)));
});

test("확정된 두 주가 있어야 증감을 낸다", () => {
  const oneWeek = attachWeeklyChanges(buildWeekly([sale("2026-08-25")], NOW));
  assert.equal(oneWeek.overall["2026-08-24"].sale.change, undefined, "견줄 주가 없는데 증감을 만들었다");
  assert.equal(oneWeek.latestWeek, "2026-08-24");

  const twoWeeks = attachWeeklyChanges(
    buildWeekly(
      [sale("2026-08-25", { amount10k: 60_000, area: 60 }), sale("2026-09-01", { amount10k: 66_000, area: 60 })],
      NOW
    )
  );

  const latest = twoWeeks.overall["2026-08-31"].sale;
  assert.equal(twoWeeks.baselineWeek, "2026-08-24");
  assert.equal(latest.change.avgPricePerPyeong10k.percent.toFixed(1), "10.0");
  assert.ok(latest.change.avgPricePerPyeong10k.value10k > 0);
  assert.equal(latest.baselineWeek, "2026-08-24");
});

test("월세는 보증금과 월세 양쪽 증감을 낸다", () => {
  const weekly = attachWeeklyChanges(
    buildWeekly(
      [wolse("2026-08-25"), wolse("2026-09-01", { deposit10k: 12_000, monthlyRent10k: 100 })],
      NOW
    )
  );

  const change = weekly.overall["2026-08-31"].wolse.change;
  assert.equal(change.avgDeposit10k.value10k, 2_000);
  assert.equal(change.avgMonthlyRent10k.value10k, 20);
});

test("신고 기록이 없으면 아무것도 만들지 않는다", () => {
  assert.equal(buildWeekly([], NOW), null);
  assert.equal(buildWeekly([sale("2026-09-07")], NOW), null, "이번 주뿐인데 주간값을 만들었다");
  assert.equal(attachWeeklyChanges(null), null);
});

test("보관 주 수를 넘기면 오래된 주부터 떨어뜨린다", () => {
  const arrivals = [];
  for (let i = 0; i < 30; i += 1) arrivals.push(sale(nextWeek("2026-02-02", i)));

  const weekly = buildWeekly(arrivals, NOW, { weeksKept: 26 });
  assert.equal(weekly.weeks.length, 26);
  assert.equal(weekly.weeks.at(-1), "2026-08-24");
});

const rawFile = (kind, items, days) => ({
  kind,
  items,
  arrivals: Object.fromEntries(items.map((item, i) => [itemKey(item), days[i]]).filter(([, day]) => day)),
});

const saleRaw = (extra = {}) => ({
  aptNm: "단지",
  dealAmount: "60,000",
  dealDay: 3,
  dealMonth: 8,
  dealYear: 2026,
  excluUseAr: 60,
  umdNm: "동",
  ...extra,
});

const rentRaw = (extra = {}) => ({
  aptNm: "단지",
  deposit: "30,000",
  dealDay: 3,
  dealMonth: 8,
  dealYear: 2026,
  excluUseAr: 60,
  monthlyRent: 0,
  umdNm: "동",
  ...extra,
});

test("원본에서 신고일이 적힌 거래만 뽑는다", () => {
  const items = [saleRaw({ aptNm: "먼저" }), saleRaw({ aptNm: "나중" })];
  const rows = arrivalRows(rawFile("sale", items, [null, "2026-08-25"]), "노원구");

  assert.equal(rows.length, 1, "신고일을 모르는 거래까지 셌다");
  assert.deepEqual(rows[0], {
    type: "sale",
    district: "노원구",
    observedOn: "2026-08-25",
    amount10k: 60_000,
    area: 60,
  });
});

test("해제된 거래는 주간 시세에서 뺀다", () => {
  const items = [saleRaw({ aptNm: "해제", cdealType: "해제", cdealDay: "26.08.20" }), saleRaw({ aptNm: "성사" })];
  const rows = arrivalRows(rawFile("sale", items, ["2026-08-25", "2026-08-25"]), "노원구");

  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount10k, 60_000);
});

test("전세와 월세를 원본에서 갈라 담는다", () => {
  const items = [rentRaw({ aptNm: "전세" }), rentRaw({ aptNm: "월세", monthlyRent: "80" })];
  const rows = arrivalRows(rawFile("rent", items, ["2026-08-25", "2026-08-26"]), "노원구");

  assert.deepEqual(rows.map((row) => row.type), ["jeonse", "wolse"]);
  assert.equal(rows[0].monthlyRent10k, 0);
  assert.equal(rows[1].monthlyRent10k, 80);
});

test("신고 기록이 없는 원본은 아무것도 내놓지 않는다", () => {
  assert.deepEqual(arrivalRows(rawFile("sale", [saleRaw()], [null]), "노원구"), []);
  assert.deepEqual(arrivalRows(null, "노원구"), []);
});

test("주간 시세에서도 갱신계약을 뺀다", () => {
  const items = [rentRaw({ aptNm: "신규" }), rentRaw({ aptNm: "갱신", contractType: "갱신" })];
  const rows = arrivalRows(rawFile("rent", items, ["2026-08-25", "2026-08-25"]), "노원구");

  assert.equal(rows.length, 1, "갱신계약이 주간 집계에 들어갔다");
});

test("보관 창에 걸쳐 잘린 첫 주는 넣지 않는다", () => {
  assert.equal(firstFullWeek("2026-03-01"), "2026-03-02", "일요일에 시작하는 달의 첫 주가 잘린 채 남았다");
  assert.equal(firstFullWeek("2026-06-01"), "2026-06-01", "월요일에 시작하는 달까지 한 주를 버렸다");

  const rows = [sale("2026-03-01"), sale("2026-03-03"), sale("2026-03-10")];
  const weekly = buildWeekly(rows, NOW, { from: firstFullWeek("2026-03-01") });

  assert.ok(!weekly.weeks.includes("2026-02-23"), "3월 하루치뿐인 주가 남았다");
  assert.deepEqual(weekly.weeks, ["2026-03-02", "2026-03-09"]);
});

test("신고 기한이 오늘 끝나는 주는 아직 확정으로 보지 않는다", () => {
  const now = new Date("2026-08-18T00:00:00Z");

  assert.equal(settledWeek(now, 30), "2026-07-06", "마감일 당일인 주를 확정으로 넣었다");
  assert.equal(settledWeek(new Date("2026-08-19T00:00:00Z"), 30), "2026-07-13", "하루 지나도 안 넘어왔다");
});

test("신고일 기준 창은 이번 주다", () => {
  const window = representWindow(new Date("2026-09-25T00:00:00Z"), "arrival");

  assert.equal(window.basis, "arrival");
  assert.equal(window.from, "2026-09-21", `주 시작이 아니다: ${JSON.stringify(window)}`);
  assert.equal(window.to, "2026-09-25", "오늘까지를 담아야 한다");
  assert.equal(window.weeks, 1);
});

test("계약일 기준 창은 신고 기한만큼 더 뒤로 잡는다", () => {
  const now = new Date("2026-09-25T00:00:00Z");
  const contract = representWindow(now, "contract");

  assert.ok(contract.to < representWindow(now, "arrival").from, "계약일 기준이 이번 주를 보고 있다");
  assert.equal(contract.weeks, 4);
});

test("신고가 자치구 절반에 못 미치면 신고일 기준을 쓰지 않는다", () => {
  const items = (codes) => new Map(codes.flatMap((c) => [[`sale:${c}`, []], [`rent:${c}`, []]]));
  const codes = (n) => Array.from({ length: n }, (_, i) => `111${String(i).padStart(2, "0")}`);

  assert.equal(arrivalWindowReady(items(codes(13)), 25), true);
  assert.equal(arrivalWindowReady(items(codes(12)), 25), false, "몇 개 구 신고만으로 서울 시세를 냈다");
  assert.equal(arrivalWindowReady(new Map(), 25), false);
});
