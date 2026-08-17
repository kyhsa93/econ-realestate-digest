import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { RATE_PAGES, buildRatePage } from "../scripts/build-rate-pages.mjs";
import { ratesHtml } from "../scripts/prerender.mjs";
import { loadRatesPage } from "./helpers/rates-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const readRates = () => read("docs/data/rates.json").then(JSON.parse);
const productNames = (html) => [...html.matchAll(/class="product-name">([^<]*)/g)].map((m) => m[1].trim());

test("커밋된 상품군별 페이지가 지금 원본·데이터로 찍은 결과와 같다", async () => {
  const [baseHtml, rates] = await Promise.all([read("docs/rates.html"), readRates()]);

  for (const page of RATE_PAGES) {
    const built = buildRatePage(baseHtml, page, rates);
    const committed = await read(`docs/${page.file}`);
    assert.equal(
      committed,
      built,
      `docs/${page.file}이 원본과 어긋납니다. node scripts/build-rate-pages.mjs를 실행하세요.`
    );
  }
});

test("각 페이지가 자기 상품군을 정규 URL·제목·첫 탭으로 선언한다", async () => {
  for (const page of RATE_PAGES) {
    const html = await read(`docs/${page.file}`);
    assert.ok(html.includes(`<title>${page.title}</title>`), `${page.file} 제목이 다르다`);
    assert.ok(
      html.includes(`<link rel="canonical" href="https://kyhsa93.github.io/econ-realestate-digest/${page.file}">`),
      `${page.file} 정규 URL이 자기 자신을 가리키지 않는다`
    );
    assert.ok(
      html.includes(`<meta name="rates-category" content="${page.category}">`),
      `${page.file} 첫 탭 지정이 없다`
    );
    assert.ok(!html.includes('title: "예금·적금·대출 금리 비교"'), `${page.file} 스크립트 사전에 옛 제목이 남았다`);
  }
});

test("각 페이지의 정적 표가 그 페이지 첫 화면과 같은 상품·순서다", async () => {
  const rates = await readRates();

  for (const page of RATE_PAGES) {
    const { byId } = await loadRatesPage({ file: `docs/${page.file}` });
    const rendered = productNames(byId.get("products-body").innerHTML);
    const prerendered = productNames(ratesHtml(rates, { category: page.category }));

    assert.ok(prerendered.length > 0, `${page.file} 정적 표가 비어 있다`);
    assert.deepEqual(prerendered, rendered.slice(0, prerendered.length), `${page.file} 표가 화면과 어긋난다`);
  }
});

test("네 페이지가 서로 다른 상품을 보여준다", async () => {
  const rates = await readRates();
  const firstRows = RATE_PAGES.map((page) => productNames(ratesHtml(rates, { category: page.category }))[0]);
  assert.equal(new Set(firstRows).size, RATE_PAGES.length, `상품군별로 표가 갈리지 않는다: ${firstRows}`);
});

test("모든 금리 페이지가 서로를 진짜 링크로 가리킨다", async () => {
  const files = ["docs/rates.html", ...RATE_PAGES.map((p) => `docs/${p.file}`)];
  for (const file of files) {
    const html = await read(file);
    for (const page of RATE_PAGES) {
      assert.ok(html.includes(`href="./${page.file}"`), `${file}에 ${page.file} 링크가 없다`);
    }
  }
});
