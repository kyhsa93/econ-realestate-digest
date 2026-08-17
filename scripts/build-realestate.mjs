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
  dropCancelled,
  normalizeDeal,
  normalizeRentDeal,
  summarizeRent,
  summarizeSaleItems,
} from "./realestate-metrics.mjs";
import { attachPrevious, isPreviousUsable } from "./realestate-previous.mjs";
import { itemKey, readSlotFile } from "./realestate-raw.mjs";
import { shiftMonth, windowMonths, yearMonthOf } from "./realestate-slots.mjs";
import { attachWeeklyChanges, buildWeekly } from "./realestate-weekly.mjs";
import { buildRentFiles, rentFileName } from "./deal-files.mjs";
import { DISTRICT_SLUGS } from "./district-slugs.mjs";

const dataDir = process.env.REALESTATE_DATA_DIR
  ? path.resolve(process.env.REALESTATE_DATA_DIR)
  : path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "realestate.json");
const historyFile = path.join(dataDir, "realestate-history.json");
const previousFile = path.join(dataDir, "realestate-prev.json");
const weeklyFile = path.join(dataDir, "realestate-weekly.json");
const rentFilesDir = process.env.DEAL_FILES_DIR
  ? path.resolve(process.env.DEAL_FILES_DIR)
  : dataDir;
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

export function districtEntries(months, { onDeals, onRents } = {}) {
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
      onRents?.(code, rentItems, name);
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

export function arrivalRows(file, districtName) {
  const arrivals = file?.arrivals ?? {};
  if (!Object.keys(arrivals).length) return [];

  const rows = [];
  const items = file.kind === "sale" ? dropCancelled(file.items ?? []) : file.items ?? [];

  for (const item of items) {
    const observedOn = arrivals[itemKey(item)];
    if (!observedOn) continue;

    if (file.kind === "sale") {
      const deal = normalizeDeal(item, districtName);
      if (deal) rows.push({ type: "sale", district: districtName, observedOn, amount10k: deal.amount10k, area: deal.area });
      continue;
    }

    const deal = normalizeRentDeal(item, districtName);
    if (!deal) continue;
    rows.push({
      type: deal.monthlyRent10k > 0 ? "wolse" : "jeonse",
      district: districtName,
      observedOn,
      deposit10k: deal.deposit10k,
      monthlyRent10k: deal.monthlyRent10k ?? 0,
      area: deal.area,
    });
  }

  return rows;
}

async function readArrivals(now) {
  const months = windowMonths(now);
  const perSlot = await Promise.all(
    months.flatMap((yearMonth) =>
      DISTRICTS.flatMap(({ code, name }) =>
        ["sale", "rent"].map(async (kind) => arrivalRows(await readSlotFile(kind, code, yearMonth), name))
      )
    )
  );
  return perSlot.flat();
}

async function writeWeekly(now) {
  const weekly = attachWeeklyChanges(buildWeekly(await readArrivals(now), now));
  if (!weekly) {
    console.log("[build-realestate] 확정된 주가 아직 없어 주간 시세를 만들지 않았습니다");
    return;
  }

  await writeFile(weeklyFile, JSON.stringify({ updatedAt: now.toISOString(), ...weekly }, null, 2));

  const latest = weekly.overall[weekly.latestWeek] ?? {};
  const counts = ["sale", "jeonse", "wolse"]
    .filter((kind) => latest[kind])
    .map((kind) => `${kind} ${latest[kind].transactionCount.toLocaleString("ko-KR")}건`)
    .join(" · ");
  console.log(
    `[build-realestate] 주간 시세 ${weekly.weeks.length}주 · 확정 주 ${weekly.latestWeek}` +
      (counts ? ` (${counts})` : "") +
      (weekly.baselineWeek ? ` · ${weekly.baselineWeek} 대비` : " · 견줄 주 없음")
  );
}

async function readExistingRentFiles() {
  const entries = await Promise.all(
    Object.entries(DISTRICT_SLUGS).map(async ([name, slug]) => {
      const file = await readJson(path.join(rentFilesDir, rentFileName(slug)));
      return file?.deals?.length ? [name, file] : null;
    })
  );
  return Object.fromEntries(entries.filter(Boolean));
}

async function writeRentFiles(period, now, rentsByDistrict) {
  if (rentsByDistrict.size === 0) return;

  const source = { period, districts: Object.fromEntries(rentsByDistrict) };
  const files = buildRentFiles(source, await readExistingRentFiles(), now);
  if (!files) return;

  await mkdir(rentFilesDir, { recursive: true });
  await Promise.all(
    Object.entries(files).map(([slug, payload]) =>
      writeFile(path.join(rentFilesDir, rentFileName(slug)), JSON.stringify(payload))
    )
  );

  const all = Object.values(files).flatMap((file) => file.deals);
  const wolse = all.filter((deal) => deal.monthlyRent10k > 0).length;
  const renewal = all.filter((deal) => deal.renewal === true).length;
  console.log(
    `[build-realestate] 전월세 전수 ${Object.keys(files).length}개 파일 · 거래 ${all.length.toLocaleString("ko-KR")}건` +
      ` (전세 ${(all.length - wolse).toLocaleString("ko-KR")}건 · 월세 ${wolse.toLocaleString("ko-KR")}건` +
      ` · 갱신계약 ${renewal.toLocaleString("ko-KR")}건)`
  );
}

async function main() {
  const now = new Date();
  const period = yearMonthOf(now);
  const previousPeriod = shiftMonth(period, -1);

  const dealsByDistrict = new Map();
  const rentsByDistrict = new Map();
  let cancelledTotal = 0;

  const current = await readMonth(period);
  const newlyFetched = districtEntries(current, {
    onDeals: (code, summary, name) => {
      dealsByDistrict.set(code, summary.items.map((item) => normalizeDeal(item, name)).filter(Boolean));
      cancelledTotal += summary.cancelledCount;
    },
    onRents: (code, items, name) => {
      rentsByDistrict.set(code, items.map((item) => normalizeRentDeal(item, name)).filter(Boolean));
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
  const withChanges = attachChanges(overall, districts, findBaseline(history, now, period));

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
  await writeRentFiles(period, now, rentsByDistrict);
  await writeWeekly(now);

  console.log(`[build-realestate] 저장 완료 (${fetchSummary(districts)})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
