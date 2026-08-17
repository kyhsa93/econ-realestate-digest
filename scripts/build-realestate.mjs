import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DISTRICTS } from "./realestate-districts.mjs";
import {
  attachChanges,
  carryForward,
  computeOverall,
  fetchSummary,
  findBaseline,
  kstDateString,
  normalizeDeal,
  summarizeRent,
  summarizeSaleItems,
} from "./realestate-metrics.mjs";
import { attachPrevious, isPreviousUsable } from "./realestate-previous.mjs";
import { readSlotFile } from "./realestate-raw.mjs";
import { shiftMonth, yearMonthOf } from "./realestate-slots.mjs";

const dataDir = process.env.REALESTATE_DATA_DIR
  ? path.resolve(process.env.REALESTATE_DATA_DIR)
  : path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "realestate.json");
const historyFile = path.join(dataDir, "realestate-history.json");
const previousFile = path.join(dataDir, "realestate-prev.json");
const dealsFile = process.env.REALESTATE_DEALS_FILE
  ? path.resolve(process.env.REALESTATE_DEALS_FILE)
  : path.resolve(import.meta.dirname, "../cache/realestate-deals.json");

const HISTORY_MAX_DAYS = 180;

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf-8"));
  } catch {
    return fallback;
  }
}

async function readMonth(yearMonth) {
  const items = new Map();
  await Promise.all(
    DISTRICTS.flatMap(({ code }) =>
      ["sale", "rent"].map(async (kind) => {
        const file = await readSlotFile(kind, code, yearMonth);
        if (file?.ok !== false && Array.isArray(file?.items)) items.set(`${kind}:${code}`, file.items);
      })
    )
  );
  return items;
}

export function districtEntries(months, { onDeals } = {}) {
  return DISTRICTS.map(({ code, name }) => {
    const entry = { code, name, sale: null, saleNational84: null, jeonse: null, wolse: null };

    const saleItems = months.get(`sale:${code}`);
    if (saleItems) {
      const summary = summarizeSaleItems(saleItems);
      entry.sale = summary.sale;
      entry.saleNational84 = summary.saleNational84;
      onDeals?.(code, summary, name);
    }

    const rentItems = months.get(`rent:${code}`);
    if (rentItems) {
      const rent = summarizeRent(rentItems);
      entry.jeonse = rent.jeonse;
      entry.wolse = rent.wolse;
    }

    return entry.sale || entry.jeonse || entry.wolse ? entry : null;
  }).filter(Boolean);
}

function appendHistory(history, now, entry) {
  const today = kstDateString(now);
  const record = { date: today, ...entry };

  const idx = history.findIndex((h) => h.date === today);
  if (idx >= 0) history[idx] = record;
  else history.push(record);

  history.sort((a, b) => a.date.localeCompare(b.date));
  return history.length > HISTORY_MAX_DAYS ? history.slice(history.length - HISTORY_MAX_DAYS) : history;
}

async function writeDeals(period, at, dealsByDistrict, cancelledTotal) {
  if (dealsByDistrict.size === 0) return;

  const existingDeals = await readJson(dealsFile);
  const byDistrict = new Map(
    existingDeals?.period === period ? Object.entries(existingDeals.districts ?? {}) : []
  );
  for (const [code, deals] of dealsByDistrict) byDistrict.set(code, deals);

  const districtsObj = Object.fromEntries(byDistrict);
  const all = Object.values(districtsObj).flat();
  const directCount = all.filter((deal) => deal.direct === true).length;
  const unknownCount = all.filter((deal) => !("direct" in deal)).length;

  await mkdir(path.dirname(dealsFile), { recursive: true });
  await writeFile(
    dealsFile,
    JSON.stringify({ period, updatedAt: at.toISOString(), districts: districtsObj }, null, 2)
  );

  console.log(
    `[build-realestate] 예산 검색용 거래 ${all.length.toLocaleString("ko-KR")}건 저장` +
      ` (해제 ${cancelledTotal.toLocaleString("ko-KR")}건 제외,` +
      ` 직거래 ${directCount.toLocaleString("ko-KR")}건 · 거래형태 미상 ${unknownCount.toLocaleString("ko-KR")}건)`
  );
}

async function main() {
  const now = new Date();
  const period = yearMonthOf(now);
  const previousPeriod = shiftMonth(period, -1);

  const dealsByDistrict = new Map();
  let cancelledTotal = 0;

  const current = await readMonth(period);
  const newlyFetched = districtEntries(current, {
    onDeals: (code, summary, name) => {
      dealsByDistrict.set(code, summary.items.map((item) => normalizeDeal(item, name)).filter(Boolean));
      cancelledTotal += summary.cancelledCount;
    },
  });

  if (newlyFetched.length === 0) {
    console.error(`[build-realestate] ${period} 원본이 없습니다, 기존 데이터를 그대로 둡니다`);
    return;
  }

  const existing = await readJson(outFile);
  const existingIsToday =
    Boolean(existing?.updatedAt) && kstDateString(new Date(existing.updatedAt)) === kstDateString(now);

  const { districts, carriedNames } = carryForward(DISTRICTS, newlyFetched, existing, existingIsToday);
  if (carriedNames.length > 0) {
    console.warn(
      `[build-realestate] ${carriedNames.length}개구를 지난번 값으로 채웠습니다: ${carriedNames.join(", ")}`
    );
  }

  const overall = computeOverall(districts);

  await mkdir(dataDir, { recursive: true });

  const history = await readJson(historyFile, []);
  const withChanges = attachChanges(overall, districts, findBaseline(history, now));

  let previous = await readJson(previousFile);
  if (!isPreviousUsable(previous, previousPeriod)) {
    const prevDistricts = districtEntries(await readMonth(previousPeriod));
    if (prevDistricts.length) {
      previous = { period: previousPeriod, fetchedAt: now.toISOString(), districts: prevDistricts };
      await writeFile(previousFile, JSON.stringify(previous, null, 2));
      console.log(`[build-realestate] 지난달(${previousPeriod}) 요약 저장 (${prevDistricts.length}개구)`);
    } else {
      console.error(`[build-realestate] 지난달(${previousPeriod}) 원본이 없어 비교값을 만들지 못했습니다`);
      previous = null;
    }
  }

  const payload = attachPrevious({ updatedAt: now.toISOString(), period, ...withChanges }, previous);
  await writeFile(outFile, JSON.stringify(payload, null, 2));

  const nextHistory = appendHistory(history, now, {
    period,
    overall: carriedNames.length ? computeOverall(newlyFetched) : overall,
    districts: newlyFetched,
  });
  await writeFile(historyFile, JSON.stringify(nextHistory, null, 2));

  await writeDeals(period, now, dealsByDistrict, cancelledTotal);

  console.log(`[build-realestate] 저장 완료 (${fetchSummary(districts)})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
