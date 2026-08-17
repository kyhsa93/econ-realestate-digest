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
  // 값이 없는 상품은 반드시 뒤쪽에 몰려 있어야 한다.
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
  // 탭에서 났던 것과 같은 사고를 막는다. 머리글은 다시 그릴 때마다 새로 만들어지므로
  // 버튼에 직접 리스너를 붙이면 첫 정렬 이후로 죽는다.
  const { sandbox, clickSortHeader } = await loadRatesPage();
  const keys = ["rate", "maxRate", "rate", "maxRate"];
  for (const key of keys) {
    clickSortHeader(key);
    const { key: activeKey } = sandbox.__state.sort.saving;
    assert.equal(activeKey, key, `${key} 정렬이 적용되지 않았다`);
  }
});

// 공시의 평균금리는 "지난달 실제 취급 평균"이라 3분의 1 남짓은 값 자체가 없다. 그 비율은
// 금감원이 정하는 값이라, 실제 자료에서 "평균 없는 상품이 있어야 한다"고 전제하면 언젠가
// 조용히 무의미해지거나 깨진다. 섞인 상태를 여기서 만들어 쓴다.
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

  // 대출은 열 구성이 달라서 따로 기억한다. 예적금에서 고른 기준이 넘어오면 안 된다.
  clickTab("mortgage");
  assert.equal(sandbox.__state.sort.loan.key, "min");
  clickSortHeader("avg");
  clickTab("rentLoan");
  assert.equal(sandbox.__state.sort.loan.key, "avg", "주담대→전세대출에서 정렬이 풀렸다");

  // 다시 예적금으로 돌아오면 아까 고른 기준이 그대로다.
  clickTab("deposit");
  assert.equal(sandbox.__state.sort.saving.key, "rate");
});

test("표에 보이는 숫자와 정렬 기준이 같은 옵션에서 나온다", async () => {
  // 한 상품에 조건이 다른 옵션이 여러 개 있다. 최저금리로 줄을 세우면서 평균이
  // 가장 낮은 옵션의 숫자를 보여주면, 순서와 표시가 서로 다른 얘기를 하게 된다.
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
