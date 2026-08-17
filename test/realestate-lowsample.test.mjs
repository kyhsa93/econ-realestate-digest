import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadIndexPage } from "./helpers/index-page.mjs";

const root = path.resolve(import.meta.dirname, "..");

const loadRenderer = async () => (await loadIndexPage()).app;

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const saleOf = (transactionCount) => ({
  avgPricePerM2: 13619744,
  avgPricePerPyeong10k: 4502,
  transactionCount,
  change: { value10k: 506, percent: 19.5 },
  baselineDate: "2026-08-10",
});

test("신고 5건 미만이면 평당가 대신 표본 수를 보여준다", async () => {
  const app = await loadRenderer();
  for (const n of [0, 1, 2, 3, 4]) {
    const cell = text(app.realestateSaleCellHtml(saleOf(n)));
    assert.ok(!cell.includes("4,502"), `n=${n}인데 값이 보인다: ${cell}`);
    assert.ok(!cell.includes("19"), `n=${n}인데 증감이 보인다: ${cell}`);
    assert.ok(cell.includes(String(n)), cell);
  }
});

test("5건부터는 평당가를 그대로 보여준다", async () => {
  const app = await loadRenderer();
  for (const n of [5, 12, 400]) {
    const cell = text(app.realestateSaleCellHtml(saleOf(n)));
    assert.ok(cell.includes("4,502"), `n=${n}인데 값이 안 보인다: ${cell}`);
  }
});

test("표본이 부족한 구는 평당가 순위에서 빠진다", async () => {
  const app = await loadRenderer();
  const expensive = { name: "표본1건구", sale: saleOf(1) };
  const ordinary = { name: "보통구", sale: { ...saleOf(30), avgPricePerPyeong10k: 3000 } };
  assert.ok(app.compareDistricts(ordinary, expensive) < 0);
  app.__realestateSort.dir = "asc";
  assert.ok(app.compareDistricts(ordinary, expensive) < 0);
  app.__realestateSort.dir = "desc";
});

test("고른 열의 표본이 부족하면 다른 지표로 대신 줄 세우지 않는다", async () => {
  const app = await loadRenderer();
  const saleMissing = { name: "매매부족구", sale: saleOf(2), jeonse: { avgDepositPerPyeong10k: 9999, transactionCount: 40 } };
  const saleOk = { name: "보통구", sale: { ...saleOf(30), avgPricePerPyeong10k: 3000 } };

  assert.ok(app.compareDistricts(saleOk, saleMissing) < 0, "전세 값이 커도 매매 기준에선 아래로 가야 한다");

  app.__realestateSort.key = "jeonse";
  assert.ok(app.compareDistricts(saleMissing, saleOk) < 0);
  app.__realestateSort.key = "sale";
});

test("거래 건수를 모르는 과거 기록은 부족하다고 단정하지 않는다", async () => {
  const app = await loadRenderer();
  const legacy = { avgPricePerPyeong10k: 4502, transactionCount: null };
  assert.ok(text(app.realestateSaleCellHtml(legacy)).includes("4,502"));
});

test("실제 데이터에서도 임계값 아래 구만 가려진다", async () => {
  const app = await loadRenderer();
  const data = JSON.parse(await readFile(path.join(root, "docs/data/realestate.json"), "utf8"));

  assert.ok(text(app.realestateSaleCellHtml(data.overall.sale)).includes("만원"));

  for (const d of data.districts) {
    if (!d.sale) continue;
    const shown = text(app.realestateSaleCellHtml(d.sale)).includes("만원");
    assert.equal(shown, d.sale.transactionCount >= 5, `${d.name} n=${d.sale.transactionCount}`);
  }
});
