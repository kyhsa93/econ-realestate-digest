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
      html.includes(`<link rel="canonical" href="https://kyhsa93.github.io/jipgye/${page.file}">`),
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

test("원본 금리 페이지는 색인에서 빠지고, 상품군 페이지 넷만 남는다", async () => {
  // docs/rates.html은 예금 탭을 먼저 그리는 파일이라 deposit-rates.html과 본문이
  // 글자까지 같다. 둘 다 색인에 두면 검색엔진에는 완전히 같은 페이지 두 장이 된다.
  // 내비게이션이 닿는 자리로는 남기되 색인은 상품군 페이지 넷에만 맡긴다.
  const base = await read("docs/rates.html");
  assert.match(base, /<meta name="robots" content="noindex, follow">/);

  for (const page of RATE_PAGES) {
    const html = await read(`docs/${page.file}`);
    assert.match(
      html,
      /<meta name="robots" content="index, follow">/,
      `docs/${page.file}이 원본의 noindex를 그대로 물려받았습니다`
    );
  }
});

test("원본과 예금 페이지가 같은 표를 그린다는 것을 잊지 않는다", async () => {
  // 이 단언이 깨졌다면 rates.html이 예금 페이지와 다른 것을 그리기 시작했다는 뜻이고,
  // 그러면 색인에서 빼 둔 이유가 사라진다. 위 검사와 함께 다시 판단할 것.
  const rates = await readRates();
  assert.equal(
    ratesHtml(rates, { category: "deposit" }),
    ratesHtml(rates),
    "rates.html이 이제 예금 페이지와 다른 표를 그립니다 — noindex를 유지할 이유를 다시 보세요"
  );
});
