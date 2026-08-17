import test from "node:test";
import assert from "node:assert/strict";
import {
  planFetch,
  planSummary,
  refreshMonths,
  shiftMonth,
  slotKey,
  slotStateOf,
  windowMonths,
  yearMonthOf,
} from "../scripts/realestate-slots.mjs";

const NOW = new Date("2026-08-17T00:00:00Z");
const DISTRICTS = [{ code: "11110" }, { code: "11680" }];
const KINDS = ["sale", "rent"];

const okSlot = (count = 3) => ({ ok: true, count, totalCount: count });

const plan = (extra = {}) => planFetch({ now: NOW, districts: DISTRICTS, kinds: KINDS, ...extra });

const filled = (months, meta = okSlot()) => {
  const slots = {};
  for (const month of months) {
    for (const kind of KINDS) {
      for (const { code } of DISTRICTS) slots[slotKey(kind, code, month)] = meta;
    }
  }
  return slots;
};

const monthsOf = (slots) => [...new Set(slots.map((slot) => slot.yearMonth))];

test("KST 기준으로 년월을 뽑는다", () => {
  assert.equal(yearMonthOf(NOW), "202608");
  assert.equal(yearMonthOf(new Date("2026-08-31T15:00:00Z")), "202609");
  assert.equal(yearMonthOf(new Date("2026-08-31T14:59:00Z")), "202608");
});

test("월 산술이 연 경계를 넘는다", () => {
  assert.equal(shiftMonth("202601", -1), "202512");
  assert.equal(shiftMonth("202512", 1), "202601");
  assert.equal(shiftMonth("202608", -6), "202602");
  assert.equal(shiftMonth("", -1), null);
});

test("보관 창은 최신 달부터 6개월이다", () => {
  assert.deepEqual(windowMonths(NOW), ["202608", "202607", "202606", "202605", "202604", "202603"]);
});

test("매일 갱신하는 달은 당월과 전월이다", () => {
  assert.deepEqual(refreshMonths(NOW), ["202608", "202607"]);
});

test("월초 사흘은 전전월까지 넓혀 받는다", () => {
  assert.deepEqual(refreshMonths(new Date("2026-10-03T00:00:00Z")), ["202610", "202609", "202608"]);
  assert.deepEqual(refreshMonths(new Date("2026-10-04T00:00:00Z")), ["202610", "202609"]);
});

test("파일이 멀쩡해도 당월·전월은 매일 다시 받는다", () => {
  const { fetch } = plan({ slots: filled(windowMonths(NOW)) });

  assert.deepEqual(monthsOf(fetch), ["202608", "202607"]);
  assert.ok(fetch.every((slot) => slot.reason === "stale"));
  assert.equal(fetch.length, 2 * KINDS.length * DISTRICTS.length);
});

test("확정된 과거 달은 건드리지 않는다", () => {
  const { fetch, pending } = plan({ slots: filled(windowMonths(NOW)) });

  assert.ok(!monthsOf(fetch).includes("202606"));
  assert.equal(pending, 0);
});

test("빈 저장소는 창 전체를 신규로 잡는다", () => {
  const { fetch } = plan();

  assert.equal(fetch.length, 6 * KINDS.length * DISTRICTS.length);
  assert.deepEqual(monthsOf(fetch), windowMonths(NOW));
});

test("한 구만 빠져도 그 구만 채운다", () => {
  const slots = filled(windowMonths(NOW));
  delete slots[slotKey("sale", "11680", "202605")];

  const { fetch } = plan({ slots });
  const backfill = fetch.filter((slot) => slot.reason !== "stale");

  assert.deepEqual(backfill, [{ kind: "sale", code: "11680", yearMonth: "202605", reason: "missing" }]);
});

test("조회 실패로 남은 슬롯은 다시 받는다", () => {
  const slots = filled(windowMonths(NOW));
  slots[slotKey("rent", "11110", "202604")] = { ok: false };

  const { fetch } = plan({ slots });
  const backfill = fetch.filter((slot) => slot.reason !== "stale");

  assert.deepEqual(backfill.map((slot) => slot.reason), ["broken"]);
  assert.equal(backfill[0].yearMonth, "202604");
});

test("성공한 0건은 확정으로 둔다", () => {
  const slots = filled(windowMonths(NOW), { ok: true, count: 0, totalCount: 0 });
  const { fetch } = plan({ slots });

  assert.ok(fetch.every((slot) => slot.reason === "stale"), "0건인 달을 매일 다시 받고 있다");
});

test("응답이 잘린 슬롯은 다시 받는다", () => {
  assert.equal(slotStateOf({ ok: true, count: 9999, totalCount: 12000 }, false), "broken");
  assert.equal(slotStateOf({ ok: true, count: 9999, totalCount: 9999 }, false), "frozen");
  assert.equal(slotStateOf({ ok: true, count: 12 }, false), "frozen");
  assert.equal(slotStateOf({ ok: true }, false), "broken");
});

test("갱신 대상은 상한과 무관하게 전부 받는다", () => {
  const { fetch, pending } = plan({ backfillLimit: 3 });
  const refresh = fetch.filter((slot) => slot.reason === "stale");
  const backfill = fetch.filter((slot) => slot.reason !== "stale");

  assert.equal(refresh.length, 2 * KINDS.length * DISTRICTS.length);
  assert.equal(backfill.length, 3);
  assert.equal(pending, 4 * KINDS.length * DISTRICTS.length - 3);
});

test("백필은 최신 달부터, 재조회가 신규보다 먼저다", () => {
  const slots = filled(windowMonths(NOW));
  delete slots[slotKey("sale", "11110", "202608")];
  delete slots[slotKey("sale", "11110", "202605")];
  delete slots[slotKey("sale", "11110", "202603")];
  slots[slotKey("sale", "11110", "202604")] = { ok: false };

  const backfill = plan({ slots }).fetch.filter((slot) => slot.reason !== "stale");

  assert.deepEqual(
    backfill.map((slot) => `${slot.yearMonth}:${slot.reason}`),
    ["202604:broken", "202605:missing", "202603:missing"]
  );
});

test("창을 벗어난 슬롯은 만료로 알린다", () => {
  const slots = { ...filled(["202608"]), [slotKey("sale", "11110", "202602")]: okSlot() };
  const { expired, fetch } = plan({ slots });

  assert.deepEqual(expired, [{ kind: "sale", code: "11110", yearMonth: "202602" }]);
  assert.ok(!monthsOf(fetch).includes("202602"));
});

test("키가 없는 종류는 계획에서 빠진다", () => {
  const { fetch } = planFetch({ now: NOW, districts: DISTRICTS, kinds: ["sale"] });
  assert.ok(fetch.every((slot) => slot.kind === "sale"));
});

test("계획을 한 줄로 요약한다", () => {
  const slots = filled(windowMonths(NOW));
  delete slots[slotKey("sale", "11680", "202605")];

  assert.equal(planSummary(plan({ slots })), "갱신 8 · 재조회 0 · 신규 1");
  assert.match(planSummary(plan({ backfillLimit: 2 })), /대기 14$/);
});
