// 프리렌더는 화면에 안 보이는 작업이라(클라이언트가 어차피 다시 그린다) 눈으로는
// 깨진 걸 못 잡는다. 크롤러가 받는 HTML이 실제로 채워져 있는지는 테스트로만 지킨다.
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

// 심었다고 생각하는데 실제로는 아무것도 안 들어간 상태가 제일 나쁘다.
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

// 화면에서 가리는 것과 같은 기준을 정적 HTML도 지켜야 한다. 여기 실린 숫자는
// 검색 결과에 그대로 노출될 수 있어서 오히려 더 위험하다.
//
// 값은 숨기되 줄은 남긴다. 예전에는 표본이 부족한 구를 정적 HTML에서 통째로 뺐는데,
// 화면은 그 구를 "표본 N건"으로 그려서 신고가 얇은 달 초에는 정적 표가 여덟 줄, 화면은
// 열한 줄이 되어 데이터를 받는 순간 표 아래가 통째로 밀렸다(광고가 붙은 페이지다).
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
  // 같은 구라도 전세 표본이 부족하면 그 칸만 값이 빠진다.
  assert.ok(!html.includes("3,000만원"), "표본이 부족한 전세 값이 실렸다");
  assert.ok(html.includes("표본 3건"));
  // 값을 못 내는 구는 아래로 간다(화면의 compareDistricts와 같은 규칙).
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

// 데이터만 커밋되고 HTML은 옛날 것이 남는 어긋남을 잡는다.
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

// 정적 HTML이 화면과 다른 순서를 보여주면, 검색 결과로 들어온 사람이 보는 표가
// 검색 결과에 뜬 내용과 어긋난다. 그래서 실제 렌더 결과와 직접 대조한다.
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
  // 대출 상품이 정적 HTML에 섞여 있으면 첫 화면(정기예금)과 다른 걸 보여주는 것이다.
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
  // RSS가 전부 죽어 기사가 한 건도 없는 날에는 검사할 제목 자체가 없다. 그냥 꺼내 쓰면
  // 단언 실패가 아니라 TypeError로 죽어서 무엇이 문제인지 로그에 안 남는다.
  assert.ok(first, "기사가 한 건도 없다 - 수집이 통째로 실패했다");
  assert.ok(html.includes(escapeHtml(first.title)), "첫 기사 제목이 정적 HTML에 없다");
  assert.ok(html.includes(escapeHtml(first.link)), "첫 기사 링크가 정적 HTML에 없다");
});

// 정적 마크업과 클라이언트 렌더의 라벨이 다르면 데이터를 받는 순간 화면이 튄다.
test("좁은 화면 카드 라벨이 클라이언트 사전과 같은 글자다", async () => {
  const [ratesHtmlSource, indexHtml] = await Promise.all([readRates(), readIndex()]);

  const labelsIn = (html, block) => {
    const body = new RegExp(`<!--prerender:${block}-->([\\s\\S]*?)<!--/prerender:${block}-->`).exec(html)?.[1] ?? "";
    return new Set([...body.matchAll(/data-label="([^"]+)"/g)].map((m) => m[1]));
  };

  // 예적금 표(rates.html 기본 화면)
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

// 정적 마크업과 클라이언트 마크업의 구조가 다르면 데이터를 받는 순간 높이가 바뀌며
// 화면이 밀린다. 광고가 붙은 페이지라 이 밀림은 수익에도 영향을 준다.
test("정적 마크업이 클라이언트가 그리는 구조와 같은 뼈대다", async () => {
  const news = await readData("news");
  const item = newsHtml(news).split("</li>")[0];
  assert.ok(item, "기사가 한 건도 없다 - 수집이 통째로 실패했다");

  // 기사 한 건은 제목 줄 + 매체 줄(+ 미리보기)로, 클라이언트와 같은 요소를 쓴다.
  assert.ok(item.includes('<div class="news-meta">'), "매체 줄이 다른 요소로 그려진다");
  assert.ok(!item.includes('class="news-source"'), "클라이언트에 없는 클래스를 쓴다");

  // 값만 있고 증감·건수가 없으면 셀 높이가 하이드레이션 뒤에 바뀐다.
  //
  // 증감은 기준선(며칠 전 기록)이 있어야 붙는 값이라 그날 자료로 검사하면 히스토리가
  // 새로 시작된 날 CI가 빨개진다. 마크업 규칙을 보는 자리라 재료를 여기서 만든다.
  const realestate = realestateHtml({
    overall: { sale: { avgPricePerPyeong10k: 4449, transactionCount: 575, change: { value10k: 12 } } },
    districts: [
      { name: "강남구", sale: { avgPricePerPyeong10k: 10870, transactionCount: 14, change: { value10k: -30 } } },
    ],
  });
  assert.ok(realestate.includes('<span class="change">'), "증감이 빠져 있다");
  assert.ok(realestate.includes('<span class="count">'), "거래 건수가 빠져 있다");
});
