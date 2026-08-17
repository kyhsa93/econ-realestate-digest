// "지금 다시 요약할 만한가"를 판정한다.
//
// 요약과 번역은 러너에 Ollama를 깔고 9GB 모델을 받아 돌리는 작업이라 한 번에 40분에서
// 한 시간이 걸린다. 수집은 하루 네 번 돌아야 하지만(기사는 계속 들어온다) 요약까지 네 번
// 다시 쓸 이유는 없다 - 같은 하루의 다이제스트는 아침에 한 번 제대로 쓰면 그날 대부분의
// 기사를 이미 담고 있다.
//
// 그래서 수집 파이프라인에서 떼어내고, 이 판정이 참일 때만 요약 워크플로가 모델을 받는다.
import { readFile, appendFile } from "node:fs/promises";
import path from "node:path";

const dataDir = process.env.SUMMARY_DATA_DIR
  ? path.resolve(process.env.SUMMARY_DATA_DIR)
  : path.resolve(import.meta.dirname, "../docs/data");

// 하루 첫 요약은 무조건 돌리고, 그 뒤로는 기사가 이만큼 새로 들어왔을 때만 다시 쓴다.
// 하루 24건 남짓 들어오는 흐름에서 10건이면 대략 하루 한두 번이다.
const NEW_ARTICLES_THRESHOLD = Number(process.env.SUMMARY_NEW_ARTICLES ?? 10);

// 번역은 기사 단위라 못 한 것만 이어서 하면 된다. 다만 영어 화면에 한국어 제목이 여러 줄
// 남는 상태를 오래 두지는 않는다.
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

/**
 * @returns {{needed: boolean, reason: string}} 판정과 그 이유.
 *   이유를 같이 돌려주는 게 핵심이다 - 안 돌린 날 로그에 "왜 안 돌렸는지"가 없으면
 *   요약이 며칠째 묵어도 알아챌 방법이 없다.
 */
export function decide(news, summary, source, now) {
  if (!news?.items?.length) return { needed: false, reason: "뉴스가 없습니다" };

  const today = kstDate(now);
  if (!summary?.updatedAt || kstDate(summary.updatedAt) !== today) {
    return { needed: true, reason: `오늘(${today}) 요약이 아직 없습니다` };
  }

  const links = new Set(source?.links ?? []);
  // 요약은 있는데 그 요약이 무엇을 보고 쓰였는지 모르는 상태(이 기능 이전에 만들어진
  // 요약). 셀 수가 없으니 한 번 다시 쓰고 기록을 남긴다.
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
    // 판정에 실패했다고 요약을 막으면 요약이 영영 안 돈다. 막히는 쪽보다 도는 쪽이 안전하다.
    console.error(`[summary-needed] 판정 실패, 요약을 돌립니다: ${err.message}`);
    if (process.env.GITHUB_OUTPUT) {
      appendFile(process.env.GITHUB_OUTPUT, `needed=true\nreason=판정 실패: ${err.message}\n`).catch(() => {});
    }
  });
}
