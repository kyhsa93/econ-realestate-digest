import Parser from "rss-parser";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { categorizeTitle } from "./categories.mjs";
import { extractArticleBody, isScrapable, stripTags } from "./article-body.mjs";

const FEEDS = [
  { source: "매일경제 부동산", url: "https://www.mk.co.kr/rss/50300009/" },
  { source: "한국경제 경제", url: "https://www.hankyung.com/feed/economy" },
  { source: "한국경제 부동산", url: "https://www.hankyung.com/feed/realestate" },
  { source: "연합뉴스 경제", url: "https://www.yna.co.kr/rss/economy.xml" },
  { source: "조선비즈 부동산", url: "https://biz.chosun.com/arc/outboundfeeds/rss/category/real_estate/?outputType=xml" },
  { source: "뉴시스 경제", url: "https://www.newsis.com/RSS/economy.xml" },
];

const KEYWORDS = [
  "부동산", "집값", "아파트", "전세", "월세", "금리", "경제", "환율", "코스피", "증시",
  "주택", "재건축", "대출",
];
const MAX_ITEMS = 24;
const MAX_PREVIEW_LENGTH = 120;
const MAX_DUPES = 3;
const MAX_ITEMS_PER_SOURCE = 8;

const MAX_BODY_LENGTH = 1200;
const MIN_BODY_LENGTH = 200;
const SCRAPE_CONCURRENCY = 3;
const SCRAPE_TIMEOUT_MS = 8000;
const USER_AGENT = "Mozilla/5.0 (compatible; jipgye/1.0; +https://kyhsa93.github.io/jipgye/)";

const dataDir = path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "news.json");
const historyFile = path.join(dataDir, "news-history.json");
const cacheDir = path.resolve(import.meta.dirname, "../cache");
const bodiesFile = path.join(cacheDir, "news-bodies.json");
const HISTORY_MAX_DAYS = 180;

function matchesKeyword(title) {
  return KEYWORDS.some((k) => title.includes(k));
}

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
    const duplicateIndex = normalizedKept.findIndex(
      (existing) => diceSimilarity(normalized, existing) >= DEDUP_SIMILARITY_THRESHOLD
    );
    if (duplicateIndex === -1) {
      kept.push({ ...item, dupes: [] });
      normalizedKept.push(normalized);
      continue;
    }
    const canonical = kept[duplicateIndex];
    if (canonical.dupes.length < MAX_DUPES && canonical.source !== item.source) {
      canonical.dupes.push({ title: item.title, link: item.link, source: item.source });
    }
  }
  return kept;
}

function capPerSource(items, maxPerSource) {
  const counts = new Map();
  const kept = [];
  for (const item of items) {
    const count = counts.get(item.source) ?? 0;
    if (count >= maxPerSource) continue;
    counts.set(item.source, count + 1);
    kept.push(item);
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
  }

  const today = kstDateString(now);
  const record = { date: today, items };

  const idx = history.findIndex((h) => h.date === today);
  if (idx >= 0) {
    history[idx] = record;
  } else {
    history.push(record);
  }

  history.sort((a, b) => a.date.localeCompare(b.date));
  if (history.length > HISTORY_MAX_DAYS) {
    history = history.slice(history.length - HISTORY_MAX_DAYS);
  }

  await writeFile(historyFile, JSON.stringify(history, null, 2));
}

function rawArticleText(item) {
  return item["content:encoded"] ?? item.content ?? item.contentSnippet ?? item.summary ?? "";
}

function buildPreview(item, title) {
  const text = stripTags(rawArticleText(item));
  if (!text || text.length < 20 || text.startsWith(title)) return null;
  return text.length > MAX_PREVIEW_LENGTH ? `${text.slice(0, MAX_PREVIEW_LENGTH).trimEnd()}…` : text;
}

function buildBody(item) {
  const text = stripTags(rawArticleText(item));
  return text ? text.slice(0, MAX_BODY_LENGTH) : null;
}

async function fetchArticleBody(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: controller.signal });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return extractArticleBody(url, await res.text());
  } finally {
    clearTimeout(timer);
  }
}

async function fillMissingBodies(items) {
  const targets = items.filter(
    (item) => (item.body?.length ?? 0) < MIN_BODY_LENGTH && isScrapable(item.link)
  );
  if (targets.length === 0) return;

  const queue = [...targets];
  let filled = 0;
  const workers = Array.from({ length: Math.min(SCRAPE_CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      try {
        const body = await fetchArticleBody(item.link);
        if (body && body.length > (item.body?.length ?? 0)) {
          item.body = body.slice(0, MAX_BODY_LENGTH);
          filled += 1;
        }
      } catch (err) {
        console.error(`[fetch-news] 본문 수집 실패 ${item.link}: ${err.message}`);
      }
    }
  });
  await Promise.all(workers);
  console.log(`[fetch-news] 기사 본문 보강 ${filled}/${targets.length}건`);
}

async function fetchFeed(parser, feed) {
  try {
    const parsed = await parser.parseURL(feed.url);
    return (parsed.items ?? []).map((item) => {
      const title = item.title?.trim() ?? "";
      return {
        title,
        link: item.link ?? "",
        publishedAt: item.isoDate ?? item.pubDate ?? null,
        source: feed.source,
        category: categorizeTitle(title).key,
        preview: buildPreview(item, title),
        body: buildBody(item),
      };
    });
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
  items = capPerSource(items, MAX_ITEMS_PER_SOURCE);
  items = items.slice(0, MAX_ITEMS);

  if (items.length === 0) {
    console.error("[fetch-news] 모든 피드 실패, 기존 news.json 유지");
    return;
  }

  await fillMissingBodies(items);

  const now = new Date();
  const publicItems = items.map(({ body, ...rest }) => rest);
  const bodies = Object.fromEntries(items.filter((item) => item.body).map((item) => [item.link, item.body]));

  await mkdir(dataDir, { recursive: true });
  await writeFile(
    outFile,
    JSON.stringify({ updatedAt: now.toISOString(), date: kstDateString(now), items: publicItems }, null, 2)
  );
  await appendHistory(now, publicItems);

  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    bodiesFile,
    JSON.stringify({ updatedAt: now.toISOString(), date: kstDateString(now), bodies }, null, 2)
  );

  const withBody = items.filter((item) => (item.body?.length ?? 0) >= MIN_BODY_LENGTH).length;
  const totalChars = items.reduce((sum, item) => sum + (item.body?.length ?? 0), 0);
  console.log(
    `[fetch-news] ${items.length}건 저장 완료 (본문 확보 ${withBody}/${items.length}건, 총 ${totalChars.toLocaleString("en-US")}자)`
  );
}

main();
