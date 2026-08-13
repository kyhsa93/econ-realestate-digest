import Parser from "rss-parser";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { categorizeTitle } from "./categories.mjs";

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
// 목록에 곁들이는 한두 줄 미리보기 길이. 기사 본문을 그대로 싣지 않도록
// 짧게 자르고, 원문 링크는 항상 같이 노출한다.
const MAX_PREVIEW_LENGTH = 120;
// 같은 사건을 여러 매체가 보도한 경우 대표 기사 하나만 남기는데(dedupe),
// 버리는 대신 "다른 매체 N곳" 링크로 남겨둘 최대 개수.
const MAX_DUPES = 3;
// 뉴시스처럼 게시량이 많은 매체 하나가 "최신순 정렬 후 상위 N개" 로직에서
// 다른 소스를 다 밀어내는 걸 막기 위한 소스별 상한. 소스를 늘리면서 같이 도입.
const MAX_ITEMS_PER_SOURCE = 8;

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

// 중복으로 판정된 기사를 그냥 버리면 "몇 개 매체가 같이 다룬 사건인지"라는
// 정보까지 같이 사라진다. 대표 기사 하나만 목록에 남기되, 나머지는 dupes로
// 붙여서 화면에서 "다른 매체 N곳"으로 펼쳐볼 수 있게 한다.
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

// 최신순 정렬 상태를 유지하면서, 소스별로 maxPerSource개까지만 남긴다.
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

// RSS 요약문에는 매체에 따라 HTML 태그, 기자 이메일 서명, 사진 캡션 같은 게
// 섞여 들어온다. 태그/공백을 정리하고 짧게 잘라서 제목 아래 한두 줄 미리보기로만 쓴다.
function buildPreview(item, title) {
  const raw = item.contentSnippet ?? item.summary ?? item.content ?? "";
  const text = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  // 매체에 따라 요약문이 제목과 사실상 같은 경우가 있어, 그럴 땐 표시하지 않는다.
  if (!text || text.length < 20 || text.startsWith(title)) return null;
  return text.length > MAX_PREVIEW_LENGTH ? `${text.slice(0, MAX_PREVIEW_LENGTH).trimEnd()}…` : text;
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

  // 중복 제거를 소스별 상한보다 먼저 한다: 상한에 걸려 미리 잘려나간 기사는
  // 어느 매체가 같은 사건을 함께 다뤘는지(dupes) 세는 데도 못 쓰이기 때문.
  // 상한은 중복 제거 후 남은 "고유 기사" 기준으로 적용되는 게 원래 의도에도 맞다.
  items = dedupeSimilarTitles(items);
  items = capPerSource(items, MAX_ITEMS_PER_SOURCE);
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
