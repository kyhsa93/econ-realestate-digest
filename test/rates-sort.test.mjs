import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRatesPage } from "./helpers/rates-page.mjs";

const rateOf = (row, key) => row.option[key];

function assertOrdered(rows, key, dir, label) {
  const values = rows.map((r) => rateOf(r, key));
  const known = values.filter((v) => v !== null && v !== undefined);
  for (let i = 1; i < known.length; i += 1) {
    const ok = dir === "asc" ? known[i] >= known[i - 1] : known[i] <= known[i - 1];
    assert.ok(ok, `${label}: ${i}번째에서 역전 (${known[i - 1]} → ${known[i]})`);
  }
  const firstMissing = values.findIndex((v) => v === null || v === undefined);
  if (firstMissing !== -1) {
    assert.ok(
      values.slice(firstMissing).every((v) => v === null || v === undefined),
      `${label}: 값 없는 상품이 중간에 섞여 있다`
    );
  }
}

test("대출 탭은 최저금리 오름차순이 기본이다", async () => {
  const { sandbox, clickTab } = await loadRatesPage();
  for (const category of ["mortgage", "rentLoan"]) {
    clickTab(category);
    assertOrdered(sandbox.visibleRows(), "min", "asc", category);
  }
});

test("예금·적금 탭은 최고금리 내림차순이 기본이다", async () => {
  const { sandbox, clickTab } = await loadRatesPage();
  assertOrdered(sandbox.visibleRows(), "maxRate", "desc", "deposit");
  clickTab("saving");
  assertOrdered(sandbox.visibleRows(), "maxRate", "desc", "saving");
});

test("금리 열 머리글을 누르면 그 열 기준으로 다시 정렬된다", async () => {
  const { sandbox, clickTab, clickSortHeader } = await loadRatesPage();

  clickSortHeader("rate");
  assertOrdered(sandbox.visibleRows(), "rate", "desc", "기본금리 내림차순");

  clickTab("mortgage");
  clickSortHeader("avg");
  assertOrdered(sandbox.visibleRows(), "avg", "asc", "평균금리 오름차순");
});

test("같은 머리글을 다시 누르면 오름·내림이 뒤집힌다", async () => {
  const { sandbox, clickSortHeader } = await loadRatesPage();
  clickSortHeader("rate");
  assertOrdered(sandbox.visibleRows(), "rate", "desc", "첫 클릭");
  clickSortHeader("rate");
  assertOrdered(sandbox.visibleRows(), "rate", "asc", "두 번째 클릭");
  clickSortHeader("rate");
  assertOrdered(sandbox.visibleRows(), "rate", "desc", "세 번째 클릭");
});

test("머리글을 여러 번 눌러도 계속 먹는다", async () => {
  const { sandbox, clickSortHeader } = await loadRatesPage();
  const keys = ["rate", "maxRate", "rate", "maxRate"];
  for (const key of keys) {
    clickSortHeader(key);
    const { key: activeKey } = sandbox.__state.sort.saving;
    assert.equal(activeKey, key, `${key} 정렬이 적용되지 않았다`);
  }
});

test("평균금리로 정렬해도 평균이 없는 상품이 사라지지 않는다", async () => {
  const loan = (i, avg) => ({
    id: `전세대출-${i}`,
    sector: "bank",
    company: `${i}은행`,
    name: `전세대출 상품 ${i}`,
    options: [{ rateType: "변동금리", min: 3 + i / 10, max: 4 + i / 10, avg }],
  });
  const rentLoan = [loan(0, 3.5), loan(1, null), loan(2, 3.1), loan(3, undefined), loan(4, 3.9)];

  const { sandbox, clickTab, clickSortHeader } = await loadRatesPage({
    rates: { updatedAt: "2026-08-17T00:00:00.000Z", deposit: [], saving: [], mortgage: [], rentLoan },
  });
  clickTab("rentLoan");
  const before = sandbox.visibleRows().length;
  assert.equal(before, rentLoan.length);

  clickSortHeader("avg");
  const after = sandbox.visibleRows();
  assert.equal(after.length, before, "평균이 없는 상품이 표에서 빠졌다");
  assert.ok(
    after.some((r) => r.option.avg === null || r.option.avg === undefined),
    "평균 없는 상품이 섞이지 않아 이 테스트가 의미 없다"
  );
  assertOrdered(after, "avg", "asc", "평균금리 정렬");
});

test("정렬 기준은 같은 열 구성을 쓰는 탭끼리 유지된다", async () => {
  const { sandbox, clickTab, clickSortHeader } = await loadRatesPage();

  clickSortHeader("rate");
  clickTab("saving");
  assert.equal(sandbox.__state.sort.saving.key, "rate", "예금→적금에서 정렬이 풀렸다");
  assertOrdered(sandbox.visibleRows(), "rate", "desc", "적금");

  clickTab("mortgage");
  assert.equal(sandbox.__state.sort.loan.key, "min");
  clickSortHeader("avg");
  clickTab("rentLoan");
  assert.equal(sandbox.__state.sort.loan.key, "avg", "주담대→전세대출에서 정렬이 풀렸다");

  clickTab("deposit");
  assert.equal(sandbox.__state.sort.saving.key, "rate");
});

test("표에 보이는 숫자와 정렬 기준이 같은 옵션에서 나온다", async () => {
  const { sandbox, clickTab, clickSortHeader } = await loadRatesPage();
  clickTab("mortgage");

  for (const row of sandbox.visibleRows()) {
    const candidates = (row.product.options ?? []).filter((o) => o.min !== null && o.min !== undefined);
    if (!candidates.length) continue;
    const lowest = Math.min(...candidates.map((o) => o.min));
    assert.equal(row.option.min, lowest, `${row.product.company}: 최저금리 옵션이 아닌 줄이 뽑혔다`);
  }

  clickSortHeader("avg");
  for (const row of sandbox.visibleRows()) {
    const candidates = (row.product.options ?? []).filter((o) => o.avg !== null && o.avg !== undefined);
    if (!candidates.length) continue;
    const lowest = Math.min(...candidates.map((o) => o.avg));
    assert.equal(row.option.avg, lowest, `${row.product.company}: 평균금리 옵션이 아닌 줄이 뽑혔다`);
  }
});

test("정렬 중인 열에만 방향 표시가 붙는다", async () => {
  const { byId, clickSortHeader } = await loadRatesPage();
  const head = () => byId.get("products-head").innerHTML;

  assert.ok(head().includes("▼"), "기본 정렬 열에 방향 표시가 없다");
  assert.equal((head().match(/[▲▼]/g) ?? []).length, 1, "방향 표시가 여러 열에 붙었다");

  clickSortHeader("rate");
  assert.equal((head().match(/[▲▼]/g) ?? []).length, 1);
  assert.ok(head().includes('aria-sort="descending"'));
});
