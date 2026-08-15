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
  realestateHtml,
  summaryHtml,
} from "../scripts/prerender.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readIndex = () => readFile(path.join(root, "docs/index.html"), "utf8");
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

  assert.ok(!html.includes("표본부족구"), "표본이 부족한 구가 실렸다");
  assert.ok(!html.includes("9,999"), "표본이 부족한 구의 값이 실렸다");
  assert.ok(html.includes("정상구") && html.includes("5,000만원"));
  // 같은 구라도 전세 표본이 부족하면 그 칸만 비운다.
  assert.ok(!html.includes("3,000만원"), "표본이 부족한 전세 값이 실렸다");
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

test("크롤러가 받는 HTML에 오늘 기사 제목이 실제로 들어 있다", async () => {
  const [html, news] = await Promise.all([readIndex(), readData("news")]);
  const first = news.items[0];
  assert.ok(html.includes(escapeHtml(first.title)), "첫 기사 제목이 정적 HTML에 없다");
  assert.ok(html.includes(escapeHtml(first.link)), "첫 기사 링크가 정적 HTML에 없다");
});
