import test from "node:test";
import assert from "node:assert/strict";
import { attachChanges, findBaseline } from "../scripts/realestate-metrics.mjs";

const entry = (date, period, count, perPyeong) => ({
  date,
  period,
  overall: { sale: { avgPricePerM2: perPyeong * 3, avgPricePerPyeong10k: perPyeong, transactionCount: count } },
  districts: [
    { code: "11110", sale: { avgPricePerPyeong10k: perPyeong, transactionCount: count } },
  ],
});

const AUGUST = [
  entry("2026-08-01", "202608", 40, 3500),
  entry("2026-08-08", "202608", 300, 3600),
  entry("2026-08-15", "202608", 575, 3620),
  entry("2026-08-25", "202608", 1180, 3640),
  entry("2026-08-31", "202608", 1400, 3650),
];

const at = (date) => new Date(`${date}T00:00:00Z`);

test("같은 달 안에서는 이레 전 값을 기준으로 잡는다", () => {
  const baseline = findBaseline(AUGUST, at("2026-08-15"));
  assert.equal(baseline.date, "2026-08-08");
});

test("달이 바뀌어도 이레 전 값을 그대로 견준다", () => {
  const history = [...AUGUST, entry("2026-09-01", "202609", 1210, 3660)];

  const baseline = findBaseline(history, at("2026-09-01"));
  assert.equal(baseline.date, "2026-08-25", "달이 바뀌었다고 기준을 놓쳤다");
});

test("기준값이 없으면 증감을 붙이지 않는다", () => {
  const overall = { sale: { avgPricePerPyeong10k: 3200, transactionCount: 45 }, saleNational84: null, jeonse: null, wolse: null };
  const districts = [{ code: "11110", name: "종로구", sale: { avgPricePerPyeong10k: 3200, transactionCount: 45 } }];

  const withChanges = attachChanges(overall, districts, null);

  assert.equal(withChanges.overall.sale.change, undefined, "기준 없이 증감을 만들어냈다");
  assert.equal(withChanges.overall.sale.baselineDate, undefined);
  assert.equal(withChanges.districts[0].sale.change, undefined);
});

test("기록이 비어 있어도 기준값을 지어내지 않는다", () => {
  assert.equal(findBaseline([], at("2026-08-15")), null);
  assert.equal(findBaseline(AUGUST.slice(0, 1), at("2026-08-01")), null);
});
