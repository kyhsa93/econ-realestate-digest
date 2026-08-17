import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MAX_MONTHS,
  buildDistrictBands,
  flattenDistrictMonths,
  mergeBands,
  mergeDistrictMonths,
  mergeMonths,
} from "./budget-bands.mjs";
import { buildDealFiles, dealFileName } from "./deal-files.mjs";
import { DISTRICT_SLUGS } from "./district-slugs.mjs";

const root = path.resolve(import.meta.dirname, "..");

const dealsFile = process.env.REALESTATE_DEALS_FILE
  ? path.resolve(process.env.REALESTATE_DEALS_FILE)
  : path.join(root, "cache/realestate-deals.json");

const outFile = process.env.BUDGET_DEALS_FILE
  ? path.resolve(process.env.BUDGET_DEALS_FILE)
  : path.join(root, "docs/data/budget-deals.json");

const searchFile = process.env.DEAL_SEARCH_FILE
  ? path.resolve(process.env.DEAL_SEARCH_FILE)
  : path.join(root, "docs/data/deal-search.json");

const monthsFile = process.env.BUDGET_MONTHS_FILE
  ? path.resolve(process.env.BUDGET_MONTHS_FILE)
  : path.join(root, "docs/data/budget-months.json");

const dealFilesDir = process.env.DEAL_FILES_DIR
  ? path.resolve(process.env.DEAL_FILES_DIR)
  : path.join(root, "docs/data");

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf-8"));
  } catch {
    return null;
  }
}

const trimForSearch = (byDistrict) =>
  Object.fromEntries(
    Object.entries(byDistrict).map(([name, bands]) => [
      name,
      bands.map(({ districts: _counts, deals, ...band }) => ({
        ...band,
        deals: deals.map(({ district: _name, buildYear: _year, ...deal }) => deal),
      })),
    ])
  );

const slugsFor = (byDistrict) =>
  Object.fromEntries(
    Object.keys(byDistrict)
      .filter((name) => DISTRICT_SLUGS[name])
      .map((name) => [name, DISTRICT_SLUGS[name]])
  );

export function buildPayload(source, existingMonths, now) {
  const deals = Object.values(source?.districts ?? {}).flat();
  if (!deals.length) return null;

  const months = mergeMonths(existingMonths, source.period, buildDistrictBands(deals), MAX_MONTHS);
  const periods = Object.keys(months).sort();
  const updatedAt = now.toISOString();
  const byDistrict = mergeDistrictMonths(months);

  return {
    screen: { updatedAt, periods, bands: mergeBands(flattenDistrictMonths(months)) },
    search: { updatedAt, periods, slugs: slugsFor(byDistrict), districts: trimForSearch(byDistrict) },
    months: { updatedAt, months },
  };
}

async function readExistingDealFiles() {
  const entries = await Promise.all(
    Object.entries(DISTRICT_SLUGS).map(async ([name, slug]) => {
      const file = await readJson(path.join(dealFilesDir, dealFileName(slug)));
      return file?.deals?.length ? [name, file] : null;
    })
  );
  return Object.fromEntries(entries.filter(Boolean));
}

async function writeDealFiles(source, now) {
  const files = buildDealFiles(source, await readExistingDealFiles(), now);
  if (!files) return;

  await mkdir(dealFilesDir, { recursive: true });
  await Promise.all(
    Object.entries(files).map(([slug, payload]) =>
      writeFile(path.join(dealFilesDir, dealFileName(slug)), JSON.stringify(payload))
    )
  );

  const all = Object.values(files).flatMap((file) => file.deals);
  const direct = all.filter((deal) => deal.direct === true).length;
  const unknown = all.filter((deal) => !("direct" in deal)).length;
  console.log(
    `  자치구별 전수 ${Object.keys(files).length}개 파일 · 거래 ${all.length.toLocaleString("ko-KR")}건` +
      ` (직거래 ${direct.toLocaleString("ko-KR")}건 · 거래형태 미상 ${unknown.toLocaleString("ko-KR")}건)`
  );
}

async function main() {
  const source = await readJson(dealsFile);
  if (!source?.period) {
    console.log("  거래 원본이 없습니다 - 기존 예산 데이터를 그대로 둡니다");
    return;
  }

  const existingMonths = await readJson(monthsFile);
  const now = new Date();
  const payload = buildPayload(source, existingMonths, now);
  if (!payload) {
    console.log(`  ${source.period} 거래가 한 건도 없습니다 - 기존 예산 데이터를 그대로 둡니다`);
    return;
  }

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload.screen, null, 2));
  await mkdir(path.dirname(searchFile), { recursive: true });
  await writeFile(searchFile, JSON.stringify(payload.search));
  await mkdir(path.dirname(monthsFile), { recursive: true });
  await writeFile(monthsFile, JSON.stringify(payload.months));
  await writeDealFiles(source, now);

  const total = payload.screen.bands.reduce((sum, band) => sum + band.count, 0);
  console.log(
    `  예산 구간 ${payload.screen.bands.length}칸 · 거래 ${total.toLocaleString("ko-KR")}건` +
      ` (${payload.screen.periods.join(", ")})`
  );
  console.log(`  거래내역 검색 ${Object.keys(payload.search.districts).length}개 지역`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`예산 구간 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
