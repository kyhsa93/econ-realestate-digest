import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRatesPage } from "./helpers/rates-page.mjs";

test("탭을 여러 번 눌러도 계속 전환된다", async () => {
  const { sandbox, clickTab, rates } = await loadRatesPage();
  assert.equal(sandbox.products().length, rates.deposit.length);

  clickTab("saving");
  assert.equal(sandbox.products().length, rates.saving.length, "적금으로 전환 실패");

  clickTab("mortgage");
  assert.equal(sandbox.products().length, rates.mortgage.length, "주택담보대출로 전환 실패");

  clickTab("rentLoan");
  assert.equal(sandbox.products().length, rates.rentLoan.length, "전세자금대출로 전환 실패");

  clickTab("deposit");
  assert.equal(sandbox.products().length, rates.deposit.length, "정기예금으로 되돌아가기 실패");
});

test("네 종류 모두 첫 클릭에 바로 전환된다", async () => {
  for (const category of ["saving", "mortgage", "rentLoan"]) {
    const { sandbox, clickTab, rates } = await loadRatesPage();
    clickTab(category);
    assert.equal(sandbox.products().length, rates[category].length, `${category} 전환 실패`);
  }
});

test("대출 탭에서도 표에 행이 실제로 그려진다", async () => {
  const { sandbox, byId, clickTab } = await loadRatesPage();
  clickTab("mortgage");
  const body = byId.get("products-body");
  assert.ok(!body.innerHTML.includes("empty-row"), "주택담보대출 표가 비어 있다");
  assert.ok(body.innerHTML.includes("data-detail"), "주택담보대출 행이 그려지지 않았다");
});
