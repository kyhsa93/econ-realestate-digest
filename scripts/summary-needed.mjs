import { readFile, appendFile } from "node:fs/promises";
import path from "node:path";

const dataDir = process.env.SUMMARY_DATA_DIR
  ? path.resolve(process.env.SUMMARY_DATA_DIR)
  : path.resolve(import.meta.dirname, "../docs/data");

const NEW_ARTICLES_THRESHOLD = Number(process.env.SUMMARY_NEW_ARTICLES ?? 10);

const UNTRANSLATED_THRESHOLD = Number(process.env.SUMMARY_UNTRANSLATED ?? 5);

const kstDate = (value) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(value));

async function readJson(name) {
  try {
    return JSON.parse(await readFile(path.join(dataDir, `${name}.json`), "utf-8"));
  } catch {
    return null;
  }
}

export function decide(news, summary, source, now) {
  if (!news?.items?.length) return { needed: false, reason: "뉴스가 없습니다" };

  const today = kstDate(now);
  if (!summary?.updatedAt || kstDate(summary.updatedAt) !== today) {
    return { needed: true, reason: `오늘(${today}) 요약이 아직 없습니다` };
  }

  const links = new Set(source?.links ?? []);
  if (links.size === 0) return { needed: true, reason: "요약이 다룬 기사 목록이 없습니다" };

  const fresh = news.items.filter((item) => item.link && !links.has(item.link)).length;
  if (fresh >= NEW_ARTICLES_THRESHOLD) {
    return { needed: true, reason: `요약 이후 새 기사 ${fresh}건 (기준 ${NEW_ARTICLES_THRESHOLD}건)` };
  }

  const untranslated = news.items.filter((item) => !item.titleEn).length;
  if (untranslated >= UNTRANSLATED_THRESHOLD) {
    return { needed: true, reason: `번역 안 된 기사 ${untranslated}건 (기준 ${UNTRANSLATED_THRESHOLD}건)` };
  }

  return {
    needed: false,
    reason: `새 기사 ${fresh}건 · 미번역 ${untranslated}건 - 기준에 못 미칩니다`,
  };
}

async function main() {
  const [news, summary, source] = await Promise.all([
    readJson("news"),
    readJson("summary"),
    readJson("summary-source"),
  ]);

  const { needed, reason } = decide(news, summary, source, new Date());
  console.log(`[summary-needed] ${needed ? "요약함" : "건너뜀"}: ${reason}`);

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `needed=${needed}\nreason=${reason}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`[summary-needed] 판정 실패, 요약을 돌립니다: ${err.message}`);
    if (process.env.GITHUB_OUTPUT) {
      appendFile(process.env.GITHUB_OUTPUT, `needed=true\nreason=판정 실패: ${err.message}\n`).catch(() => {});
    }
  });
}
