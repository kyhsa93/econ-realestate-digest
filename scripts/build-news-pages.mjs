import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyPrerender, newsListHtml, newsRealestateStatsHtml, newsSummaryHtml } from "./prerender.mjs";

const root = path.resolve(import.meta.dirname, "..");
const NEWS_PATH = path.join(root, "docs/news.html");
const BASE_URL = "https://kyhsa93.github.io/econ-realestate-digest/";

const BASE_TITLE = "오늘의 경제·부동산 뉴스";
const BASE_DESCRIPTION =
  "경제지 RSS에서 모은 오늘의 경제·부동산 뉴스를 카테고리별로 정리하고, 오픈소스 AI가 요약합니다. 하루 4회 자동 갱신합니다.";

const BASE_TITLE_EN = "Today's Korean Economy & Real Estate News";
const BASE_DESCRIPTION_EN =
  "Korean economy and real estate headlines collected from newspaper RSS feeds, grouped by category and summarized by an open-source AI. Updated four times a day.";

export const NEWS_PAGES = [
  {
    category: "realestate",
    file: "realestate-news.html",
    title: "부동산 뉴스 - 오늘의 아파트·전세·분양 소식",
    description:
      "오늘의 부동산 뉴스를 한곳에 모았습니다. 아파트·전세·월세·분양·재건축 소식을 경제지 RSS에서 모아 하루 4회 갱신하고, 오픈소스 AI가 요약합니다.",
    titleEn: "Real Estate News - Korean Housing, Jeonse & Presale",
    descriptionEn:
      "Today's Korean real estate headlines in one place: apartments, jeonse, monthly rent, presales and redevelopment, updated four times a day and summarized by an open-source AI.",
  },
  {
    category: "stocks",
    file: "stock-news.html",
    title: "증시·환율 뉴스 - 오늘의 코스피·달러 소식",
    description:
      "오늘의 증시·환율 뉴스를 한곳에 모았습니다. 코스피·코스닥·주가·원달러 환율 소식을 경제지 RSS에서 모아 하루 4회 갱신하고, 오픈소스 AI가 요약합니다.",
    titleEn: "Stocks & FX News - KOSPI and the Korean Won",
    descriptionEn:
      "Today's Korean stock and currency headlines in one place: KOSPI, KOSDAQ, share prices and the won-dollar rate, updated four times a day and summarized by an open-source AI.",
  },
  {
    category: "rates",
    file: "rate-news.html",
    title: "금리 뉴스 - 오늘의 기준금리·예금·채권 소식",
    description:
      "오늘의 금리 뉴스를 한곳에 모았습니다. 기준금리·예금·채권·펀드 소식을 경제지 RSS에서 모아 하루 4회 갱신하고, 오픈소스 AI가 요약합니다.",
    titleEn: "Interest Rate News - Korea Base Rate, Deposits & Bonds",
    descriptionEn:
      "Today's Korean interest rate headlines in one place: the base rate, deposits, bonds and funds, updated four times a day and summarized by an open-source AI.",
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
  html = html.replaceAll(BASE_TITLE_EN, page.titleEn);
  html = html.replaceAll(BASE_DESCRIPTION_EN, page.descriptionEn);
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

  const stats = page.category === "realestate" ? newsRealestateStatsHtml(news) : null;
  if (stats) {
    html = replaceOnce(
      html,
      '<section id="realestate-stats-section" hidden>',
      '<section id="realestate-stats-section">',
      "시세 카드 섹션"
    );
  }

  return applyPrerender(html, {
    newsSummary: newsSummaryHtml(summary, page.category),
    newsList: newsListHtml(news, page.category),
    ...(stats ? { realestateStats: stats } : {}),
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
