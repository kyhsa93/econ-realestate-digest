import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  applyPrerender,
  escapeHtml,
  marketHtml,
  newsHtml,
  ratesHtml,
  realestateHtml,
  summaryHtml,
} from "../scripts/prerender.mjs";
import { loadRatesPage } from "./helpers/rates-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readIndex = () => readFile(path.join(root, "docs/index.html"), "utf8");
const readRates = () => readFile(path.join(root, "docs/rates.html"), "utf8");

const productNames = (html) => [...html.matchAll(/class="product-name">([^<]*)/g)].map((m) => m[1].trim());
const readData = async (name) =>
  JSON.parse(await readFile(path.join(root, `docs/data/${name}.json`), "utf8"));

const wrap = (name, inner) => `<div><!--prerender:${name}-->${inner}<!--/prerender:${name}--></div>`;

test("자리표시 주석 사이를 갈아끼우고, 다시 돌려도 결과가 같다", () => {
  const once = applyPrerender(wrap("news", "불러오는 중..."), { news: "<li>기사</li>" });
  assert.equal(once, wrap("news", "<li>기사</li>"));
  assert.equal(applyPrerender(once, { news: "<li>기사</li>" }), once);
});

test("데이터가 없으면 기존 안내 문구를 그대로 둔다", () => {
  const html = wrap("news", "불러오는 중...");
  assert.equal(applyPrerender(html, { news: null }), html);
});

test("자리표시 주석이 사라졌으면 조용히 넘어가지 않는다", () => {
  assert.throws(() => applyPrerender("<div>표시 없음</div>", { news: "<li>기사</li>" }), /자리표시/);
});

test("기사 제목의 따옴표·꺾쇠는 마크업으로 새지 않는다", () => {
  const html = newsHtml({
    items: [{ title: '<script>alert("x")</script> & 금리', link: "https://x/a?b=1&c=2", source: "매체" }],
  });
  assert.ok(!html.includes("<script>"), html);
  assert.ok(html.includes("&lt;script&gt;"), html);
  assert.ok(html.includes("&amp;c=2"), html);
  assert.equal(escapeHtml('a"b'), "a&quot;b");
});

test("신고 건수가 적은 구는 정적 HTML에도 값이 실리지 않는다", () => {
  const html = realestateHtml({
    overall: { sale: { avgPricePerPyeong10k: 4449, transactionCount: 575 } },
    districts: [
      { name: "표본부족구", sale: { avgPricePerPyeong10k: 9999, transactionCount: 2 } },
      {
        name: "정상구",
        sale: { avgPricePerPyeong10k: 5000, transactionCount: 40 },
        jeonse: { avgDepositPerPyeong10k: 3000, transactionCount: 3 },
      },
    ],
  });

  assert.ok(!html.includes("9,999"), "표본이 부족한 구의 값이 실렸다");
  assert.ok(html.includes("표본 2건"), "표본이 부족하다는 사실 자체를 안 적었다");
  assert.ok(html.includes("정상구") && html.includes("5,000만원"));
  assert.ok(!html.includes("3,000만원"), "표본이 부족한 전세 값이 실렸다");
  assert.ok(html.includes("표본 3건"));
  assert.ok(html.indexOf("정상구") < html.indexOf("표본부족구"), "표본이 부족한 구가 위로 갔다");
});

test("시장지표는 값이 있는 항목만 줄을 만든다", () => {
  assert.equal(marketHtml(null), null);
  assert.equal(marketHtml({}), null);
  const html = marketHtml({ kospi: { value: "6,977.94", change: "164.60" }, baseRate: { value: "2.75" } });
  assert.ok(html.includes("코스피") && html.includes("6,977.94"));
  assert.ok(html.includes("기준금리") && html.includes("2.75%"));
  assert.ok(!html.includes("환율"), "값이 없는 환율까지 줄을 만들었다");
});

test("요약은 카테고리별 한국어 문장을 싣는다", () => {
  assert.equal(summaryHtml({ categories: [] }), null);
  const html = summaryHtml({ categories: [{ name: "부동산", lineKo: "서울 주택난" }, { name: "증시" }] });
  assert.ok(html.includes("<strong>부동산</strong>") && html.includes("서울 주택난"));
  assert.ok(!html.includes("증시"), "문장이 없는 카테고리까지 실었다");
});

test("배포된 index.html에 자리표시 주석 네 쌍이 남아 있다", async () => {
  const html = await readIndex();
  for (const name of ["summary", "market", "realestate", "news"]) {
    assert.ok(html.includes(`<!--prerender:${name}-->`), `${name} 여는 주석이 없다`);
    assert.ok(html.includes(`<!--/prerender:${name}-->`), `${name} 닫는 주석이 없다`);
  }
});

test("커밋된 HTML이 지금 데이터로 다시 그린 결과와 같다", async () => {
  const html = await readIndex();
  const [summary, market, realestate, news] = await Promise.all(
    ["summary", "market", "realestate", "news"].map(readData)
  );

  const expected = applyPrerender(html, {
    summary: summaryHtml(summary),
    market: marketHtml(market),
    realestate: realestateHtml(realestate),
    news: newsHtml(news),
  });

  assert.equal(html, expected, "docs/index.html이 데이터와 어긋납니다. node scripts/prerender.mjs를 실행하세요.");
});

test("금리 표의 정적 HTML이 실제 첫 화면과 같은 상품·순서다", async () => {
  const [rates, { byId }] = await Promise.all([
    readFile(path.join(root, "docs/data/rates.json"), "utf8").then(JSON.parse),
    loadRatesPage(),
  ]);

  const rendered = productNames(byId.get("products-body").innerHTML);
  const prerendered = productNames(ratesHtml(rates));

  assert.ok(prerendered.length > 0, "정적 표가 비어 있다");
  assert.deepEqual(prerendered, rendered.slice(0, prerendered.length));
});

test("금리 표는 첫 화면에 없는 탭까지 심지 않는다", async () => {
  const [rates, html] = await Promise.all([
    readFile(path.join(root, "docs/data/rates.json"), "utf8").then(JSON.parse),
    readRates(),
  ]);

  const staticNames = new Set(productNames(ratesHtml(rates)));
  for (const product of rates.mortgage ?? []) {
    assert.ok(!staticNames.has(product.name), `대출 상품이 실렸다: ${product.name}`);
  }
  assert.ok(html.includes("<!--prerender:rates-->"), "rates.html에 자리표시 주석이 없다");
});

test("커밋된 rates.html이 지금 데이터로 다시 그린 결과와 같다", async () => {
  const [html, rates] = await Promise.all([
    readRates(),
    readFile(path.join(root, "docs/data/rates.json"), "utf8").then(JSON.parse),
  ]);

  assert.equal(
    html,
    applyPrerender(html, { rates: ratesHtml(rates) }),
    "docs/rates.html이 데이터와 어긋납니다. node scripts/prerender.mjs를 실행하세요."
  );
});

test("크롤러가 받는 HTML에 오늘 기사 제목이 실제로 들어 있다", async () => {
  const [html, news] = await Promise.all([readIndex(), readData("news")]);
  const first = news.items[0];
  assert.ok(first, "기사가 한 건도 없다 - 수집이 통째로 실패했다");
  assert.ok(html.includes(escapeHtml(first.title)), "첫 기사 제목이 정적 HTML에 없다");
  assert.ok(html.includes(escapeHtml(first.link)), "첫 기사 링크가 정적 HTML에 없다");
});

test("좁은 화면 카드 라벨이 클라이언트 사전과 같은 글자다", async () => {
  const [ratesHtmlSource, indexHtml] = await Promise.all([readRates(), readIndex()]);

  const labelsIn = (html, block) => {
    const body = new RegExp(`<!--prerender:${block}-->([\\s\\S]*?)<!--/prerender:${block}-->`).exec(html)?.[1] ?? "";
    return new Set([...body.matchAll(/data-label="([^"]+)"/g)].map((m) => m[1]));
  };

  for (const label of labelsIn(ratesHtmlSource, "rates")) {
    assert.ok(ratesHtmlSource.includes(`: "${label}"`), `금리 표 라벨이 사전에 없다: ${label}`);
  }
  for (const label of labelsIn(indexHtml, "realestate")) {
    assert.ok(indexHtml.includes(`: "${label}"`), `부동산 표 라벨이 사전에 없다: ${label}`);
  }
  for (const label of labelsIn(indexHtml, "market")) {
    assert.ok(indexHtml.includes(`: "${label}"`), `시장지표 표 라벨이 사전에 없다: ${label}`);
  }
});

test("정적 마크업이 클라이언트가 그리는 구조와 같은 뼈대다", async () => {
  const news = await readData("news");
  const item = newsHtml(news).split("</li>")[0];
  assert.ok(item, "기사가 한 건도 없다 - 수집이 통째로 실패했다");

  assert.ok(item.includes('<div class="news-meta">'), "매체 줄이 다른 요소로 그려진다");
  assert.ok(!item.includes('class="news-source"'), "클라이언트에 없는 클래스를 쓴다");

  const realestate = realestateHtml({
    overall: { sale: { avgPricePerPyeong10k: 4449, transactionCount: 575, change: { value10k: 12 } } },
    districts: [
      { name: "강남구", sale: { avgPricePerPyeong10k: 10870, transactionCount: 14, change: { value10k: -30 } } },
    ],
  });
  assert.ok(realestate.includes('<span class="change">'), "증감이 빠져 있다");
  assert.ok(realestate.includes('<span class="count">'), "거래 건수가 빠져 있다");
});
