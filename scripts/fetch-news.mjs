import Parser from "rss-parser";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const FEEDS = [
  { source: "매일경제 부동산", url: "https://www.mk.co.kr/rss/50300009/" },
  { source: "한국경제 경제", url: "https://www.hankyung.com/feed/economy" },
  { source: "한국경제 부동산", url: "https://www.hankyung.com/feed/realestate" },
  { source: "연합뉴스 경제", url: "https://www.yna.co.kr/rss/economy.xml" },
];

const KEYWORDS = ["부동산", "집값", "아파트", "전세", "월세", "금리", "경제", "환율", "코스피", "증시"];
const MAX_ITEMS = 20;

const dataDir = path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "news.json");

function matchesKeyword(title) {
  return KEYWORDS.some((k) => title.includes(k));
}

async function fetchFeed(parser, feed) {
  try {
    const parsed = await parser.parseURL(feed.url);
    return (parsed.items ?? []).map((item) => ({
      title: item.title?.trim() ?? "",
      link: item.link ?? "",
      publishedAt: item.isoDate ?? item.pubDate ?? null,
      source: feed.source,
    }));
  } catch (err) {
    console.error(`[fetch-news] ${feed.source} 실패: ${err.message}`);
    return [];
  }
}

async function main() {
  const parser = new Parser();
  const results = await Promise.all(FEEDS.map((feed) => fetchFeed(parser, feed)));
  let items = results.flat().filter((item) => item.title && matchesKeyword(item.title));

  items.sort((a, b) => new Date(b.publishedAt ?? 0) - new Date(a.publishedAt ?? 0));

  const seen = new Set();
  items = items.filter((item) => {
    if (seen.has(item.title)) return false;
    seen.add(item.title);
    return true;
  });

  items = items.slice(0, MAX_ITEMS);

  if (items.length === 0) {
    console.error("[fetch-news] 모든 피드 실패, 기존 news.json 유지");
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await writeFile(
    outFile,
    JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 2)
  );

  console.log(`[fetch-news] ${items.length}건 저장 완료`);
}

main();
