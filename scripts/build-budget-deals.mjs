// cache/realestate-deals.json(거래 원본) → docs/data/budget-deals.json(예산 구간).
//
// 원본은 gitignore된 캐시라 CI 러너가 바뀌면 사라진다. 그래서 이 스크립트는 "재료가
// 없으면 기존 결과를 그대로 둔다". 하루 4회 갱신 중 부동산 조회가 도는 건 한 번뿐이고,
// 나머지 세 번은 재료 없이 실행되기 때문이다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_MONTHS, buildBands, mergeBands, mergeMonths } from "./budget-bands.mjs";

const root = path.resolve(import.meta.dirname, "..");

const dealsFile = process.env.REALESTATE_DEALS_FILE
  ? path.resolve(process.env.REALESTATE_DEALS_FILE)
  : path.join(root, "cache/realestate-deals.json");

// 화면이 받는 파일. 월별 원본을 합쳐 놓은 결과만 담는다.
const outFile = process.env.BUDGET_DEALS_FILE
  ? path.resolve(process.env.BUDGET_DEALS_FILE)
  : path.join(root, "docs/data/budget-deals.json");

// 달마다 굳은 구간을 보관하는 파일. 지난달 거래는 다시 받아올 수 없어서(호출 한도 때문에
// 이 저장소는 지난달 집계도 캐시해 쓴다) 커밋해 두어야 다음 달에 합칠 수 있다. 화면은 이
// 파일을 받지 않는다 - 합쳐 둔 결과와 내용이 겹쳐서, 같이 내려보내면 크기만 세 배가 된다
// (realestate-prev.json이 docs/data에 있으면서 화면에 안 나가는 것과 같은 자리다).
const monthsFile = process.env.BUDGET_MONTHS_FILE
  ? path.resolve(process.env.BUDGET_MONTHS_FILE)
  : path.join(root, "docs/data/budget-months.json");

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf-8"));
  } catch {
    return null;
  }
}

export function buildPayload(source, existingMonths, now) {
  const deals = Object.values(source?.districts ?? {}).flat();
  if (!deals.length) return null;

  const months = mergeMonths(existingMonths, source.period, buildBands(deals), MAX_MONTHS);
  const periods = Object.keys(months).sort();

  return {
    screen: { updatedAt: now.toISOString(), periods, bands: mergeBands(months) },
    months: { updatedAt: now.toISOString(), months },
  };
}

async function main() {
  const source = await readJson(dealsFile);
  if (!source?.period) {
    // 조용히 넘어가지 않는다. 재료가 계속 안 잡히는 상태와 "오늘은 조회를 안 한 날"은
    // 화면상 구분이 안 가서, 로그가 없으면 며칠이 지나도 알아채지 못한다.
    console.log("  거래 원본이 없습니다 - 기존 예산 데이터를 그대로 둡니다");
    return;
  }

  const existingMonths = await readJson(monthsFile);
  const payload = buildPayload(source, existingMonths, new Date());
  if (!payload) {
    console.log(`  ${source.period} 거래가 한 건도 없습니다 - 기존 예산 데이터를 그대로 둡니다`);
    return;
  }

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload.screen, null, 2));
  await mkdir(path.dirname(monthsFile), { recursive: true });
  await writeFile(monthsFile, JSON.stringify(payload.months, null, 2));

  const total = payload.screen.bands.reduce((sum, band) => sum + band.count, 0);
  console.log(
    `  예산 구간 ${payload.screen.bands.length}칸 · 거래 ${total.toLocaleString("ko-KR")}건` +
      ` (${payload.screen.periods.join(", ")})`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`예산 구간 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
