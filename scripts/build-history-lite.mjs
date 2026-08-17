import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const FULL_PATH = path.join(root, "docs/data/realestate-history.json");
const LITE_PATH = path.join(root, "docs/data/realestate-history-lite.json");

export const LITE_DAYS = 35;

const price = (metric) =>
  metric
    ? {
        avgPricePerPyeong10k: metric.avgPricePerPyeong10k ?? null,
        transactionCount: metric.transactionCount ?? null,
      }
    : null;

const jeonsePrice = (metric) =>
  metric
    ? {
        avgDepositPerPyeong10k: metric.avgDepositPerPyeong10k ?? null,
        transactionCount: metric.transactionCount ?? null,
      }
    : null;

const wolsePrice = (metric) =>
  metric
    ? {
        avgDeposit10k: metric.avgDeposit10k ?? null,
        avgMonthlyRent10k: metric.avgMonthlyRent10k ?? null,
        transactionCount: metric.transactionCount ?? null,
      }
    : null;

const scope = (entry) =>
  entry
    ? {
        sale: price(entry.sale),
        saleNational84: price(entry.saleNational84),
        jeonse: jeonsePrice(entry.jeonse),
        wolse: wolsePrice(entry.wolse),
      }
    : null;

export function toLite(history) {
  return (Array.isArray(history) ? history : []).slice(-LITE_DAYS).map((day) => ({
    date: day.date,
    overall: scope(day.overall),
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
