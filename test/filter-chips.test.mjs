import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadDealSearchPage } from "./helpers/deal-search-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (name) => readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);

async function page(query = "") {
  const [budget, search, deals] = await Promise.all([
    readJson("budget-deals"),
    readJson("deal-search"),
    readJson("deals-nowon"),
  ]);
  const p = await loadDealSearchPage({ budget, search, deals: { 노원구: deals }, query });
  for (let i = 0; i < 300 && !p.resultHtml(); i += 1) await new Promise((r) => setTimeout(r, 5));
  return p;
}

test("선택지가 적은 조건은 칩으로 고른다", async () => {
  const p = await page();
  for (const options of [p.kindOptions(), p.areaOptions(), p.ageOptions()]) {
    assert.match(options, /class="chip"/, "아직 셀렉트다");
    assert.match(options, /role="radio"/, "한 갈래만 고르는 묶음인데 역할이 없다");
  }
});

test("지역과 예산은 셀렉트로 남는다", async () => {
  // 칩 스물다섯 개를 가로로 훑어 은평구를 찾는 것은 목록에서 고르는 것보다 나쁘다.
  const p = await page();
  assert.match(p.districtOptions(), /<option/, "지역까지 칩으로 바꿨다");
  assert.match(p.budgetOptions(), /<option/, "예산까지 칩으로 바꿨다");
});

test("켜진 칩이 하나뿐이고 눈에 보인다", async () => {
  const p = await page();
  const checked = (html) => (html.match(/aria-checked="true"/g) ?? []).length;
  assert.equal(checked(p.kindOptions()), 1);
  assert.equal(checked(p.areaOptions()), 1);

  await p.chooseArea("60-85");
  assert.equal(checked(p.areaOptions()), 1, "켜진 칩이 하나가 아니다");
  assert.match(p.areaOptions(), /data-value="60-85"[^>]*aria-checked="true"/);
});

test("칩을 누르면 결과가 바로 좁혀진다", async () => {
  const p = await page();
  const count = () => Number((/([\d,]+)건이 거래됐습니다/.exec(p.resultHtml())?.[1] ?? "0").replace(/,/g, ""));

  await p.chooseDistrict("노원구");
  const before = count();
  await p.chooseArea("60");
  const after = count();

  assert.ok(before > 0, "처음부터 결과가 없다");
  assert.ok(after < before, `칩을 눌렀는데 건수가 안 줄었다 (${before} → ${after})`);
});

test("칩도 주소에 남는다", async () => {
  const p = await page();
  await p.chooseArea("60-85");
  await p.chooseAge("10");
  const url = p.sandbox.location.search ?? "";
  assert.match(url, /area=60-85/);
  assert.match(url, /age=10/);
});

test("조건이 걸려 있을 때만 지우기가 뜬다", async () => {
  const p = await page();
  assert.equal(p.fieldHidden("reset-field"), true, "조건이 없는데 지우기가 떠 있다");

  await p.chooseArea("60");
  assert.equal(p.fieldHidden("reset-field"), false, "조건을 걸었는데 지우기가 없다");
});

test("지우기를 누르면 조건이 전부 풀린다", async () => {
  const p = await page("?district=노원구&area=60&age=10&apt=상계&direct=exclude");
  assert.equal(p.fieldHidden("reset-field"), false);

  await p.resetFilters();

  assert.match(p.areaOptions(), /data-value="all"[^>]*aria-checked="true"/);
  assert.match(p.ageOptions(), /data-value="all"[^>]*aria-checked="true"/);
  assert.equal(p.byId("apt-input").value, "");
  assert.equal(p.byId("direct-check").checked, false);
  assert.equal(p.fieldHidden("reset-field"), true, "다 풀렸는데 지우기가 남아 있다");
  assert.ok(!/area=|age=|apt=/.test(p.sandbox.location.search ?? ""), "주소에 조건이 남았다");
});
