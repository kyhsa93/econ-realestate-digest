import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NEWS_PAGES, buildNewsPage } from "../scripts/build-news-pages.mjs";
import { escapeHtml, newsListHtml, newsSummaryHtml } from "../scripts/prerender.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const readJson = (name) => read(`docs/data/${name}.json`).then(JSON.parse);
const titles = (html) => [...html.matchAll(/rel="noopener">([^<]*)</g)].map((m) => m[1].trim());

test("커밋된 카테고리 페이지가 지금 원본·데이터로 찍은 결과와 같다", async () => {
  const [baseHtml, news, summary] = await Promise.all([read("docs/news.html"), readJson("news"), readJson("summary")]);

  for (const page of NEWS_PAGES) {
    const built = buildNewsPage(baseHtml, page, { news, summary });
    assert.equal(
      await read(`docs/${page.file}`),
      built,
      `docs/${page.file}이 원본과 어긋납니다. node scripts/build-news-pages.mjs를 실행하세요.`
    );
  }
});

test("각 페이지가 자기 분야를 정규 URL·제목·필터로 선언한다", async () => {
  for (const page of NEWS_PAGES) {
    const html = await read(`docs/${page.file}`);
    assert.ok(html.includes(`<title>${page.title}</title>`), `${page.file} 제목이 다르다`);
    assert.ok(
      html.includes(`<link rel="canonical" href="https://kyhsa93.github.io/jipgye/${page.file}">`),
      `${page.file} 정규 URL이 자기 자신을 가리키지 않는다`
    );
    assert.ok(html.includes(`<meta name="news-category" content="${page.category}">`), `${page.file} 분야 지정이 없다`);
    assert.ok(!html.includes("<title>오늘의 경제·부동산 뉴스</title>"), `${page.file}에 원본 제목이 남았다`);
    assert.ok(html.includes(`title: "${page.titleEn}"`), `${page.file} 영어 사전 제목이 안 바뀌었다`);
    assert.ok(
      !html.includes('title: "Today\'s Korean Economy & Real Estate News"'),
      `${page.file} 영어 사전에 원본 제목이 남았다`
    );
  }
});

test("각 페이지의 정적 목록에 다른 분야 기사가 섞이지 않는다", async () => {
  const news = await readJson("news");

  let listedTotal = 0;

  for (const page of NEWS_PAGES) {
    const listed = new Set(titles(newsListHtml(news, page.category) ?? ""));
    listedTotal += listed.size;

    for (const item of news.items) {
      const belongs = item.category === page.category;
      assert.equal(
        listed.has(escapeHtml(item.title).trim()),
        belongs,
        `${page.file}: "${item.title}"(${item.category})가 ${belongs ? "빠졌다" : "섞였다"}`
      );
    }
  }

  assert.ok(listedTotal > 0, "세 카테고리 페이지의 정적 목록이 전부 비어 있다");
});

test("요약도 그 분야 문장만 싣는다", async () => {
  const summary = await readJson("summary");
  for (const page of NEWS_PAGES) {
    const html = newsSummaryHtml(summary, page.category);
    if (!html) continue;
    const name = summary.categories.find((c) => c.key === page.category)?.name;
    assert.ok(html.includes(`<strong>${name}</strong>`), `${page.file} 요약이 자기 분야가 아니다`);
    assert.equal(html.match(/<strong>/g).length, 1, `${page.file} 요약에 다른 분야가 섞였다`);
  }
});

test("정적 목록에 만든 시점에 좌우되는 값을 넣지 않는다", async () => {
  const html = newsListHtml(await readJson("news"));
  assert.ok(!/분 전|시간 전|일 전/.test(html), "상대 시간이 정적 HTML에 실렸다");
});

test("허브와 카테고리 페이지가 서로를 진짜 링크로 가리킨다", async () => {
  const files = ["docs/news.html", ...NEWS_PAGES.map((p) => `docs/${p.file}`)];
  for (const file of files) {
    const html = await read(file);
    for (const page of NEWS_PAGES) {
      assert.ok(html.includes(`href="./${page.file}"`), `${file}에 ${page.file} 링크가 없다`);
    }
    assert.ok(html.includes('href="./index.html"'), `${file}에 메인 링크가 없다`);
  }

  const index = await read("docs/index.html");
  assert.ok(index.includes('href="./news.html"'), "메인에 뉴스 허브 링크가 없다");
});

test("뉴스 페이지에도 테마·언어 토글이 있다", async () => {
  for (const file of ["docs/news.html", ...NEWS_PAGES.map((p) => `docs/${p.file}`)]) {
    const html = await read(file);
    assert.ok(html.includes('id="theme-toggle"'), `${file}에 테마 토글이 없다`);
    assert.ok(html.includes('id="lang-toggle"'), `${file}에 언어 토글이 없다`);
    assert.ok(html.includes("navRealestate:"), `${file}에 언어 사전이 없다`);
  }
});

test("뉴스 페이지에도 GA 로더와 사이트 구분이 붙어 있다", async () => {
  for (const file of ["docs/news.html", ...NEWS_PAGES.map((p) => `docs/${p.file}`)]) {
    const html = await read(file);
    assert.ok(html.includes('<script src="./analytics.js"></script>'), `${file}에 로더가 없다`);
    assert.ok(html.includes('<meta name="site-group" content="digest">'), `${file}에 사이트 구분이 없다`);
    assert.ok(html.includes("privacy-policy"), `${file}에 개인정보처리방침 링크가 없다`);
  }
});

test("기사 로드 실패는 원인을 함께 알린다", async () => {
  for (const file of ["docs/news.html", ...NEWS_PAGES.map((p) => `docs/${p.file}`)]) {
    const html = await read(file);
    assert.ok(html.includes("throw new Error(`HTTP ${res.status}`)"), `${file}가 상태 코드를 안 남긴다`);
    assert.ok(html.includes("t(\"loadError\")(newsLoadError)"), `${file}가 실패 이유를 화면에 안 쓴다`);
    assert.ok(html.includes("loadError: (reason)"), `${file} 문구가 이유를 받지 않는다`);
  }
});

test("뉴스 페이지는 색인에서 빠지고, 데이터 페이지는 빠지지 않는다", async () => {
  // 애드센스가 "가치가 별로 없는 콘텐츠"로 반려한 뒤의 결정이다. 뉴스 면에 있는 것은
  // 남의 기사 제목과 그 AI 요약이고, 그건 우리가 만든 것이 아니라서 변호가 서지 않는다.
  // 실거래·금리는 공공데이터를 우리 방식으로 가공한 것이라 남긴다.
  //
  // 이 검사가 지키는 것은 두 방향이다. 뉴스가 다시 색인에 들어오는 것과, 색인에서
  // 빼는 손이 미끄러져 돈이 되는 페이지까지 가져가는 것.
  for (const file of ["news.html", "deal-search.html", ...NEWS_PAGES.map((p) => p.file)]) {
    const html = await read(`docs/${file}`);
    assert.match(
      html,
      /<meta name="robots" content="noindex, follow">/,
      `docs/${file}에 noindex가 없습니다`
    );
  }

  for (const file of ["index.html", "realestate.html", "rates.html", "district-gangnam.html", "budget-10eok.html"]) {
    const html = await read(`docs/${file}`);
    assert.doesNotMatch(html, /noindex/, `docs/${file}은 색인에서 빠지면 안 됩니다`);
  }
});

test("첫 화면에 먼저 오는 것은 우리가 만든 데이터다", async () => {
  // AI 요약이 맨 위에 있었다. 심사자가 사이트에서 처음 보는 것이 AI가 쓴 문단이면
  // 그 사이트가 무엇으로 만들어졌는지에 대한 첫 인상이 그것으로 정해진다(53d9c9a).
  //
  // 그때는 시장 지표를 맨 위에 뒀는데, 코스피·환율·기준금리는 받아서 그대로 옮기는
  // 숫자지 우리가 만든 것이 아니다. 우리 계산이 들어간 것은 실거래 쪽이므로
  // 원칙("처음 보는 것이 우리가 만든 데이터")을 그대로 적용하면 실거래가 맨 위다.
  const html = await read("docs/index.html");
  const at = (id) => html.indexOf(`<section id="${id}">`);
  assert.ok(at("market-section") > 0 && at("realestate-section") > 0 && at("summary-section") > 0);
  assert.ok(
    at("summary-section") > at("realestate-section"),
    "AI 요약이 실거래 시세보다 위에 있습니다"
  );
  assert.ok(
    at("market-section") > at("realestate-section"),
    "받아 옮기기만 하는 코스피·환율이 우리가 계산한 실거래보다 위에 있습니다"
  );
});
