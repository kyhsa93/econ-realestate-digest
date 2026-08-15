// 메인 화면이 받는 부동산 히스토리를 차트에 필요한 만큼으로 줄인다.
//
// 원본 realestate-history.json은 180일치를 25개 구 전 항목으로 들고 있어서 하루 14KB씩
// 자란다(180일이면 2.5MB). 그런데 메인 화면 차트는 최근 30일치의 평당가·거래건수만
// 쓴다 - 나머지는 받아놓고 안 쓰는 데이터다. 지금은 86KB라 티가 안 나지만 석 달 뒤엔
// 모든 방문자가 매 방문마다 1MB 넘게 받게 된다.
//
// 그래서 차트가 실제로 읽는 필드만 남긴 경량 파일을 따로 만들고, 메인은 이것만 받는다.
// 아카이브(?date=)는 특정 날짜의 전체 내용이 필요하므로 원본을 그대로 쓴다.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const FULL_PATH = path.join(root, "docs/data/realestate-history.json");
const LITE_PATH = path.join(root, "docs/data/realestate-history-lite.json");

// 차트는 history.slice(-30)만 그린다. 조금 여유를 둔다.
export const LITE_DAYS = 35;

const price = (metric) =>
  metric
    ? {
        avgPricePerPyeong10k: metric.avgPricePerPyeong10k ?? null,
        transactionCount: metric.transactionCount ?? null,
      }
    : null;

// 전세·월세는 차트에서 거래 건수만 쓴다.
const count = (metric) => (metric ? { transactionCount: metric.transactionCount ?? null } : null);

const scope = (entry) =>
  entry
    ? {
        sale: price(entry.sale),
        saleNational84: price(entry.saleNational84),
        jeonse: count(entry.jeonse),
        wolse: count(entry.wolse),
      }
    : null;

export function toLite(history) {
  return (Array.isArray(history) ? history : []).slice(-LITE_DAYS).map((day) => ({
    date: day.date,
    overall: scope(day.overall),
    // 구 이름은 오늘치 realestate.json에서 가져다 쓰므로 히스토리엔 코드만 있으면 된다.
    districts: (day.districts ?? []).map((d) => ({ code: d.code, ...scope(d) })),
  }));
}

async function main() {
  const history = await readFile(FULL_PATH, "utf8")
    .then(JSON.parse)
    .catch(() => null);

  if (!history) {
    console.log("  realestate-history.json 없음 - 건너뜀");
    return;
  }

  const lite = JSON.stringify(toLite(history));
  const before = await readFile(LITE_PATH, "utf8").catch(() => null);

  if (before === lite) {
    console.log("  realestate-history-lite.json 변경 없음");
    return;
  }

  await writeFile(LITE_PATH, lite);
  const full = (await readFile(FULL_PATH, "utf8")).length;
  console.log(
    `  realestate-history-lite.json 갱신 (${(lite.length / 1024).toFixed(0)}KB, 원본 ${(full / 1024).toFixed(0)}KB의 ${Math.round((lite.length / full) * 100)}%)`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`경량 히스토리 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
