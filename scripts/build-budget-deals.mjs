import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildDistrictBands,
  flattenDistrictMonths,
  mergeBands,
  mergeDistrictMonths,
} from "./budget-bands.mjs";
import { budgetFacts } from "./budget-facts.mjs";
import { buildDealFiles, dealFileName, periodOf } from "./deal-files.mjs";
import { DISTRICT_SLUGS } from "./district-slugs.mjs";
import { readDealSource } from "./realestate-source.mjs";

const root = path.resolve(import.meta.dirname, "..");

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

export function buildPayload(source, now) {
  const deals = Object.values(source?.districts ?? {}).flat();
  if (!deals.length) return null;

  const byPeriod = new Map();
  for (const deal of deals) {
    const period = periodOf(deal?.date);
    if (!period) continue;
    if (!byPeriod.has(period)) byPeriod.set(period, []);
    byPeriod.get(period).push(deal);
  }

  const periods = [...byPeriod.keys()].sort();
  if (!periods.length) return null;

  const months = Object.fromEntries(
    periods.map((period) => [period, buildDistrictBands(byPeriod.get(period))])
  );
  const updatedAt = now.toISOString();
  const byDistrict = mergeDistrictMonths(months);

  // 관찰은 대표 거래가 아니라 전수 위에서 낸다. 화면에 실리는 band.deals는 열두 건으로
  // 잘려 나가므로, 그 위에서 비중을 세면 건수는 전수인데 분포는 열두 건인 화면이 된다.
  const bands = withFacts(mergeBands(flattenDistrictMonths(months)), deals, now);

  return {
    screen: { updatedAt, periods, bands },
    search: { updatedAt, periods, slugs: slugsFor(byDistrict), districts: trimForSearch(byDistrict) },
    months: { updatedAt, months },
  };
}

function withFacts(bands, deals, now) {
  const year = now.getUTCFullYear();
  return bands.map((band) => {
    const inBand = deals.filter(
      (deal) =>
        Number.isFinite(deal?.amount10k) &&
        deal.amount10k >= band.min10k &&
        (band.max10k === null || deal.amount10k < band.max10k)
    );
    const facts = budgetFacts(inBand, { year });
    return facts ? { ...band, facts } : band;
  });
}

async function writeDealFiles(source, now) {
  const files = buildDealFiles(source, now);
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
  const now = new Date();
  const source = await readDealSource(now);
  if (!Object.keys(source.districts).length) {
    console.log("  거래 원본이 없습니다 - 기존 예산 데이터를 그대로 둡니다");
    return;
  }

  const payload = buildPayload(source, now);
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
      ` (${payload.screen.periods.join(", ")} · 해제 ${source.cancelled.toLocaleString("ko-KR")}건 제외)`
  );
  console.log(`  거래내역 검색 ${Object.keys(payload.search.districts).length}개 지역`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`예산 구간 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
