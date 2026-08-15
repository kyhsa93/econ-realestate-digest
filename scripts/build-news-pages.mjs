// 카테고리별 뉴스 페이지(부동산/증시·환율/금리)를 news.html에서 찍어낸다.
//
// 왜 나누나: "오늘의 경제 뉴스"보다 "부동산 뉴스", "금리 뉴스"처럼 분야 단위로 검색한다.
// 날짜별 아카이브와 달리 페이지 수가 늘지 않으면서 검색 의도마다 착지점이 생긴다.
//
// "기타 경제 소식"은 만들지 않는다 - 아무도 그렇게 검색하지 않고, 내용도 그날그날
// 남는 기사를 모은 것이라 페이지의 주제가 서지 않는다.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyPrerender, newsListHtml, newsSummaryHtml } from "./prerender.mjs";

const root = path.resolve(import.meta.dirname, "..");
const NEWS_PATH = path.join(root, "docs/news.html");
const BASE_URL = "https://kyhsa93.github.io/econ-realestate-digest/";

const BASE_TITLE = "오늘의 경제·부동산 뉴스";
const BASE_DESCRIPTION =
  "경제지 RSS에서 모은 오늘의 경제·부동산 뉴스를 카테고리별로 정리하고, 오픈소스 AI가 요약합니다. 하루 4회 자동 갱신합니다.";

export const NEWS_PAGES = [
  {
    category: "realestate",
    file: "realestate-news.html",
    title: "부동산 뉴스 - 오늘의 아파트·전세·분양 소식",
    description:
      "오늘의 부동산 뉴스를 한곳에 모았습니다. 아파트·전세·월세·분양·재건축 소식을 경제지 RSS에서 모아 하루 4회 갱신하고, 오픈소스 AI가 요약합니다.",
  },
  {
    category: "stocks",
    file: "stock-news.html",
    title: "증시·환율 뉴스 - 오늘의 코스피·달러 소식",
    description:
      "오늘의 증시·환율 뉴스를 한곳에 모았습니다. 코스피·코스닥·주가·원달러 환율 소식을 경제지 RSS에서 모아 하루 4회 갱신하고, 오픈소스 AI가 요약합니다.",
  },
  {
    category: "rates",
    file: "rate-news.html",
    title: "금리 뉴스 - 오늘의 기준금리·예금·채권 소식",
    description:
      "오늘의 금리 뉴스를 한곳에 모았습니다. 기준금리·예금·채권·펀드 소식을 경제지 RSS에서 모아 하루 4회 갱신하고, 오픈소스 AI가 요약합니다.",
  },
];

function replaceOnce(html, needle, replacement, what) {
  if (!html.includes(needle)) throw new Error(`${what}를 찾지 못했습니다: ${needle.slice(0, 60)}`);
  return html.replace(needle, replacement);
}

export function buildNewsPage(baseHtml, page, { news, summary }) {
  let html = baseHtml;

  html = html.replaceAll(BASE_TITLE, page.title);
  html = html.replaceAll(BASE_DESCRIPTION, page.description);
  html = html.replaceAll(`${BASE_URL}news.html`, `${BASE_URL}${page.file}`);

  html = replaceOnce(
    html,
    '<link rel="canonical"',
    `<meta name="news-category" content="${page.category}">\n<link rel="canonical"`,
    "정규 URL 링크"
  );

  html = replaceOnce(
    html,
    '<a href="./news.html" data-news-page="all" aria-current="page">',
    '<a href="./news.html" data-news-page="all">',
    "뉴스 전체 링크"
  );

  html = replaceOnce(
    html,
    `<a href="./${page.file}" data-news-page="${page.category}">`,
    `<a href="./${page.file}" data-news-page="${page.category}" aria-current="page">`,
    "카테고리 링크"
  );

  return applyPrerender(html, {
    newsSummary: newsSummaryHtml(summary, page.category),
    newsList: newsListHtml(news, page.category),
  });
}

async function main() {
  const [baseHtml, news, summary] = await Promise.all([
    readFile(NEWS_PATH, "utf8"),
    readFile(path.join(root, "docs/data/news.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "docs/data/summary.json"), "utf8").then(JSON.parse),
  ]);

  for (const page of NEWS_PAGES) {
    const html = buildNewsPage(baseHtml, page, { news, summary });
    const target = path.join(root, "docs", page.file);
    const before = await readFile(target, "utf8").catch(() => null);
    if (before === html) {
      console.log(`  docs/${page.file} 변경 없음`);
      continue;
    }
    await writeFile(target, html);
    console.log(`  docs/${page.file} ${before === null ? "생성" : "갱신"}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`뉴스 페이지 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
