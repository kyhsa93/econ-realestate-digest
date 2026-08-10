import Parser from "rss-parser";
import { writeFile, mkdir, readFile } from "node:fs/promises";
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
const historyFile = path.join(dataDir, "news-history.json");
const HISTORY_MAX_DAYS = 180;

function matchesKeyword(title) {
  return KEYWORDS.some((k) => title.includes(k));
}

// 여러 언론사가 같은 통신사 기사를 살짝 다르게(예: "(종합)" 태그, 띄어쓰기
// 차이) 재게시하는 경우가 많아서, 제목이 정확히 똑같을 때만 걸러내는
// 것으로는 부족하다. [속보]/(종합) 같은 태그와 공백/문장부호를 지운 뒤
// 문자 bigram 유사도로 비교해서 사실상 같은 기사를 하나만 남긴다.
function normalizeForDedup(title) {
  return title
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

function bigrams(str) {
  const set = new Set();
  for (let i = 0; i < str.length - 1; i++) set.add(str.slice(i, i + 2));
  return set;
}

function diceSimilarity(a, b) {
  if (a === b) return 1;
  const setA = bigrams(a);
  const setB = bigrams(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const bg of setA) if (setB.has(bg)) overlap++;
  return (2 * overlap) / (setA.size + setB.size);
}

const DEDUP_SIMILARITY_THRESHOLD = 0.75;

function dedupeSimilarTitles(items) {
  const kept = [];
  const normalizedKept = [];
  for (const item of items) {
    const normalized = normalizeForDedup(item.title);
    const isDuplicate = normalizedKept.some(
      (existing) => diceSimilarity(normalized, existing) >= DEDUP_SIMILARITY_THRESHOLD
    );
    if (!isDuplicate) {
      kept.push(item);
      normalizedKept.push(normalized);
    }
  }
  return kept;
}

function kstDateString(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

async function appendHistory(now, items) {
  let history = [];
  try {
    history = JSON.parse(await readFile(historyFile, "utf-8"));
  } catch {
    // 최초 실행이면 이전 기록 없음
  }

  const today = kstDateString(now);
  const record = { date: today, items };

  const idx = history.findIndex((h) => h.date === today);
  if (idx >= 0) {
    history[idx] = record; // 같은 날 재실행 시 덮어쓰기 (중복 방지)
  } else {
    history.push(record);
  }

  history.sort((a, b) => a.date.localeCompare(b.date));
  if (history.length > HISTORY_MAX_DAYS) {
    history = history.slice(history.length - HISTORY_MAX_DAYS);
  }

  await writeFile(historyFile, JSON.stringify(history, null, 2));
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

  items = dedupeSimilarTitles(items);
  items = items.slice(0, MAX_ITEMS);

  if (items.length === 0) {
    console.error("[fetch-news] 모든 피드 실패, 기존 news.json 유지");
    return;
  }

  const now = new Date();
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    outFile,
    // date(KST)는 summarize-digest.mjs가 "오늘 뉴스로 오늘 요약을 만드는지"
    // 검증하는 데 쓴다 (RSS 전체 실패로 news.json이 갱신 안 된 날, 어제
    // 뉴스로 오늘 날짜 요약을 만들어버리는 걸 막기 위함).
    JSON.stringify({ updatedAt: now.toISOString(), date: kstDateString(now), items }, null, 2)
  );
  await appendHistory(now, items);

  console.log(`[fetch-news] ${items.length}건 저장 완료`);
}

main();
