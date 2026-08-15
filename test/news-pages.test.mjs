// 카테고리별 뉴스 페이지는 news.html에서 찍어낸 것이라, 원본이 바뀌면 조용히 어긋난다.
// "찍어낸 결과와 커밋된 파일이 같은가"와 "그 페이지가 자기 분야 기사만 싣는가"를 지킨다.
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
      html.includes(`<link rel="canonical" href="https://kyhsa93.github.io/econ-realestate-digest/${page.file}">`),
      `${page.file} 정규 URL이 자기 자신을 가리키지 않는다`
    );
    assert.ok(html.includes(`<meta name="news-category" content="${page.category}">`), `${page.file} 분야 지정이 없다`);
    assert.ok(!html.includes("<title>오늘의 경제·부동산 뉴스</title>"), `${page.file}에 원본 제목이 남았다`);
    // 영어 사전까지 안 바꾸면 언어를 전환하는 순간 네 페이지가 같은 제목으로 돌아간다.
    assert.ok(html.includes(`title: "${page.titleEn}"`), `${page.file} 영어 사전 제목이 안 바뀌었다`);
    assert.ok(
      !html.includes('title: "Today\'s Korean Economy & Real Estate News"'),
      `${page.file} 영어 사전에 원본 제목이 남았다`
    );
  }
});

test("각 페이지의 정적 목록에 다른 분야 기사가 섞이지 않는다", async () => {
  const news = await readJson("news");

  for (const page of NEWS_PAGES) {
    const listed = new Set(titles(newsListHtml(news, page.category) ?? ""));
    assert.ok(listed.size > 0, `${page.file} 정적 목록이 비어 있다`);

    for (const item of news.items) {
      const belongs = item.category === page.category;
      assert.equal(
        listed.has(escapeHtml(item.title).trim()),
        belongs,
        `${page.file}: "${item.title}"(${item.category})가 ${belongs ? "빠졌다" : "섞였다"}`
      );
    }
  }
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

// 상대 시간을 정적 HTML에 넣으면 데이터가 그대로여도 하루 뒤엔 결과가 달라져서,
// 커밋된 HTML이 데이터와 맞는지 검사할 수 없게 된다.
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

  // 크롤러가 메인에서 뉴스 허브로 들어올 수 있어야 한다.
  const index = await read("docs/index.html");
  assert.ok(index.includes('href="./news.html"'), "메인에 뉴스 허브 링크가 없다");
});

// 메인·금리 페이지엔 있는 토글이 여기만 없으면 사이트 안에서 UI가 끊긴다.
test("뉴스 페이지에도 테마·언어 토글이 있다", async () => {
  for (const file of ["docs/news.html", ...NEWS_PAGES.map((p) => `docs/${p.file}`)]) {
    const html = await read(file);
    assert.ok(html.includes('id="theme-toggle"'), `${file}에 테마 토글이 없다`);
    assert.ok(html.includes('id="lang-toggle"'), `${file}에 언어 토글이 없다`);
    // 영어 화면에서 한국어가 남지 않으려면 사전이 양쪽 다 있어야 한다.
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
