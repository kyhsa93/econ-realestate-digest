import test from "node:test";
import assert from "node:assert/strict";
import { attachPrevious, isPreviousUsable } from "../scripts/realestate-previous.mjs";

const current = {
  period: "202608",
  overall: { sale: { avgPricePerPyeong10k: 4449, transactionCount: 575 } },
  districts: [
    { code: "11680", name: "강남구", sale: { avgPricePerPyeong10k: 10870, transactionCount: 14 } },
    { code: "11350", name: "노원구", sale: { avgPricePerPyeong10k: 9999, transactionCount: 2 } },
  ],
};

const previous = {
  period: "202607",
  districts: [
    { code: "11350", name: "노원구", sale: { avgPricePerPyeong10k: 3600, transactionCount: 40 }, jeonse: null },
  ],
};

test("지난달 캐시는 기간이 맞을 때만 쓴다", () => {
  assert.equal(isPreviousUsable(previous, "202607"), true);
  assert.equal(isPreviousUsable(previous, "202606"), false, "달이 바뀌었는데 옛 캐시를 썼다");
  assert.equal(isPreviousUsable(null, "202607"), false);
  assert.equal(isPreviousUsable({ period: "202607" }, "202607"), false, "districts 없는 캐시를 통과시켰다");
});

test("이번 달 값을 덮어쓰지 않고 prev로 얹는다", () => {
  const merged = attachPrevious(current, previous);
  const nowon = merged.districts.find((d) => d.code === "11350");

  assert.equal(nowon.sale.avgPricePerPyeong10k, 9999, "이번 달 값이 사라졌다");
  assert.equal(nowon.prev.sale.avgPricePerPyeong10k, 3600);
  assert.equal(merged.previousPeriod, "202607");
});

test("지난달에 없던 지역은 그대로 둔다", () => {
  const merged = attachPrevious(current, previous);
  const gangnam = merged.districts.find((d) => d.code === "11680");
  assert.ok(!("prev" in gangnam), "지난달 자료가 없는데 prev가 붙었다");
});

test("값이 비어 있는 지표는 prev에 넣지 않는다", () => {
  const merged = attachPrevious(current, previous);
  const nowon = merged.districts.find((d) => d.code === "11350");
  assert.ok(!("jeonse" in nowon.prev), "null인 지표까지 prev에 실렸다");
});

test("지난달 자료가 아예 없으면 원본을 그대로 돌려준다", () => {
  assert.equal(attachPrevious(current, null), current);
  assert.equal(attachPrevious(current, { period: "202607", districts: [] }), current);
});
