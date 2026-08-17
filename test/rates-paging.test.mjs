import test from "node:test";
import assert from "node:assert/strict";
import { loadRatesPage } from "./helpers/rates-page.mjs";

const rowCount = (html) => (html.match(/<tr>/g) ?? []).length;
const body = (page) => page.byId.get("products-body").innerHTML;
const more = (page) => page.byId.get("show-more").innerHTML;

const clickShowMore = (page) =>
  page.byId.get("show-more").dispatch("click", { target: { id: "show-more-button" } });

const savingProducts = (prefix, count) =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    sector: "bank",
    company: `${prefix}은행`,
    name: `${prefix} 상품 ${i}`,
    options: [{ term: 12, rateTypeName: "단리", rate: 3 + i / 100, maxRate: 3.5 + i / 100 }],
  }));

const loanProducts = (prefix, count) =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    sector: "bank",
    company: `${prefix}은행`,
    name: `${prefix} 상품 ${i}`,
    options: [{ rateType: "변동금리", mortgageType: "아파트", min: 3 + i / 100, max: 4 + i / 100, avg: null }],
  }));

const RATES = {
  updatedAt: "2026-08-17T00:00:00.000Z",
  disclosureMonth: "202607",
  deposit: savingProducts("예금", 65),
  saving: savingProducts("적금", 25),
  mortgage: loanProducts("주담대", 12),
  rentLoan: loanProducts("전세대출", 8),
};

const open = () => loadRatesPage({ rates: RATES });

test("처음에는 20개만 그린다", async () => {
  assert.equal(rowCount(body(await open())), 20);
});

test("남은 개수와 전체 개수를 밝힌다", async () => {
  const page = await open();
  const text = more(page).replace(/<[^>]+>/g, " ");
  assert.match(text, /45개 남음/);
  assert.match(text, /65개 중 20개/);
});

test("더 보기를 누르면 20개씩 늘어난다", async () => {
  const page = await open();
  assert.match(more(page), /show-more-button/, "더 보기 버튼이 없다");

  clickShowMore(page);
  assert.equal(rowCount(body(page)), 40);

  clickShowMore(page);
  assert.equal(rowCount(body(page)), 60);
});

test("마지막 장을 지나면 더 보기가 사라진다", async () => {
  const page = await open();
  clickShowMore(page);
  clickShowMore(page);
  clickShowMore(page);

  assert.equal(rowCount(body(page)), 65);
  assert.ok(!more(page).includes("show-more-button"), "다 그렸는데 더 보기가 남았다");
});

test("탭·정렬·필터를 바꾸면 다시 20개부터 본다", async () => {
  const page = await open();
  clickShowMore(page);
  assert.equal(rowCount(body(page)), 40);

  page.clickTab("saving");
  assert.equal(rowCount(body(page)), 20, "탭을 바꿨는데 이전 개수가 남았다");

  clickShowMore(page);
  page.clickSortHeader("rate");
  assert.equal(rowCount(body(page)), 20, "정렬을 바꿨는데 이전 개수가 남았다");
});

test("상품이 20개 이하인 탭에는 더 보기가 없다", async () => {
  const page = await open();
  page.clickTab("mortgage");

  assert.equal(rowCount(body(page)), 12);
  assert.ok(!more(page).includes("더 보기"), "12개뿐인데 더 보기가 떴다");
});

test("정적 HTML과 초기 화면의 행 수가 같다", async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve(import.meta.dirname, "..");
  const html = await readFile(path.join(root, "docs/rates.html"), "utf8");
  const prerendered = html.split("<!--prerender:rates-->")[1].split("<!--/prerender")[0];

  const page = await loadRatesPage();
  assert.equal(rowCount(prerendered), rowCount(body(page)));
});
