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
import { itemKey, readSlotFile } from "./realestate-raw.mjs";
import { windowMonths } from "./realestate-slots.mjs";
import {
  FILING_GRACE_DAYS,
  REPRESENT_WEEKS,
  TREND_MIN_SAMPLE,
  attachWeeklyChanges,
  buildWeekly,
  firstFullWeek,
  nextWeek,
  settledWeek,
} from "./realestate-weekly.mjs";
import { buildRentFiles, rentFileName } from "./deal-files.mjs";
import { readRentSource } from "./realestate-source.mjs";

const dataDir = process.env.REALESTATE_DATA_DIR
  ? path.resolve(process.env.REALESTATE_DATA_DIR)
  : path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "realestate.json");
const historyFile = path.join(dataDir, "realestate-history.json");
const weeklyFile = path.join(dataDir, "realestate-weekly.json");
const trendFile = path.join(dataDir, "realestate-trend.json");
const rentFilesDir = process.env.DEAL_FILES_DIR
  ? path.resolve(process.env.DEAL_FILES_DIR)
  : dataDir;
const HISTORY_MAX_DAYS = 180;

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function contractDate(item) {
  const year = Number(item?.dealYear);
  const month = Number(item?.dealMonth);
  const day = Number(item?.dealDay);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function representWindow(now, weeks = REPRESENT_WEEKS) {
  const settled = settledWeek(now, FILING_GRACE_DAYS);
  const until = nextWeek(settled, 1);
  return {
    from: nextWeek(settled, -(weeks - 1)),
    to: new Date(Date.parse(`${until}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10),
    until,
    weeks,
  };
}

function monthsBetween(from, until) {
  const months = new Set();
  for (let at = from; at < until; at = nextWeek(at)) months.add(at.slice(0, 4) + at.slice(5, 7));
  months.add(until.slice(0, 4) + until.slice(5, 7));
  return [...months];
}

async function readWindowItems(window) {
  const items = new Map();

  await Promise.all(
    monthsBetween(window.from, window.until).flatMap((yearMonth) =>
      DISTRICTS.flatMap(({ code }) =>
        ["sale", "rent"].map(async (kind) => {
          const file = await readSlotFile(kind, code, yearMonth);
          if (file?.ok === false || !Array.isArray(file?.items)) return;

          const picked = file.items.filter((item) => {
            const date = contractDate(item);
            return date && date >= window.from && date < window.until;
          });
          if (!picked.length) return;

          const key = `${kind}:${code}`;
          items.set(key, [...(items.get(key) ?? []), ...picked]);
        })
      )
    )
  );

  return items;
}

export function districtEntries(months) {
  return DISTRICTS.map(({ code, name }) => {
    const entry = { code, name, sale: null, saleNational84: null, jeonse: null, wolse: null };

    const saleItems = months.get(`sale:${code}`);
    if (saleItems) {
      const summary = summarizeSaleItems(saleItems);
      entry.sale = summary.sale;
      entry.saleNational84 = summary.saleNational84;
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

function saleRow(deal, districtName, observedOn) {
  return { type: "sale", district: districtName, observedOn, amount10k: deal.amount10k, area: deal.area };
}

function rentRow(deal, districtName, observedOn) {
  return {
    type: deal.monthlyRent10k > 0 ? "wolse" : "jeonse",
    district: districtName,
    observedOn,
    deposit10k: deal.deposit10k,
    monthlyRent10k: deal.monthlyRent10k ?? 0,
    area: deal.area,
  };
}

function weeklyRows(file, districtName, dateOf) {
  if (!file) return [];

  const rows = [];
  const items = file.kind === "sale" ? dropCancelled(file.items ?? []) : file.items ?? [];

  for (const item of items) {
    const observedOn = dateOf(item);
    if (!observedOn) continue;

    if (file.kind === "sale") {
      const deal = normalizeDeal(item, districtName);
      if (deal) rows.push(saleRow(deal, districtName, observedOn));
      continue;
    }

    const deal = normalizeRentDeal(item, districtName);
    if (deal && deal.renewal !== true) rows.push(rentRow(deal, districtName, observedOn));
  }

  return rows;
}

export function arrivalRows(file, districtName) {
  const arrivals = file?.arrivals ?? {};
  if (!Object.keys(arrivals).length) return [];
  return weeklyRows(file, districtName, (item) => arrivals[itemKey(item)]);
}

export function contractRows(file, districtName) {
  return weeklyRows(file, districtName, (item) => {
    const year = Number(item?.dealYear);
    const month = Number(item?.dealMonth);
    const day = Number(item?.dealDay);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  });
}

async function readWeeklyRows(now, rowsOf) {
  const months = windowMonths(now);
  const perSlot = await Promise.all(
    months.flatMap((yearMonth) =>
      DISTRICTS.flatMap(({ code, name }) =>
        ["sale", "rent"].map(async (kind) => rowsOf(await readSlotFile(kind, code, yearMonth), name))
      )
    )
  );
  return perSlot.flat();
}

async function writeWeekly(now) {
  const weekly = attachWeeklyChanges(buildWeekly(await readWeeklyRows(now, arrivalRows), now));
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

async function writeTrend(now) {
  const oldest = windowMonths(now).at(-1);
  const trend = buildWeekly(await readWeeklyRows(now, contractRows), now, {
    minSample: TREND_MIN_SAMPLE,
    graceDays: FILING_GRACE_DAYS,
    from: firstFullWeek(`${oldest.slice(0, 4)}-${oldest.slice(4, 6)}-01`),
  });
  if (!trend) {
    console.log("[build-realestate] 계약일 기준 주간 추이를 만들 재료가 없습니다");
    return;
  }

  await writeFile(trendFile, JSON.stringify({ updatedAt: now.toISOString(), ...trend }));
  console.log(
    `[build-realestate] 주간 추이 ${trend.weeks.length}주 (${trend.weeks[0]} ~ ${trend.weeks.at(-1)})` +
      ` · 자치구 ${Object.keys(trend.districts).length}곳`
  );
}

async function writeRentFiles(now) {
  const source = await readRentSource(now);
  const files = buildRentFiles(source, now);
  if (!files || !Object.keys(files).length) return;

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
      ` · 갱신계약 ${renewal.toLocaleString("ko-KR")}건 · ${source.months.join(", ")})`
  );
}

async function writeRepresentative(now, window) {
  const newlyFetched = districtEntries(await readWindowItems(window));

  if (newlyFetched.length === 0) {
    console.error(
      `[build-realestate] ${window.from}~${window.to} 계약분 원본이 없습니다, 시세는 기존 값을 그대로 둡니다`
    );
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
  const history = await readJson(historyFile, []);

  await writeFile(
    outFile,
    JSON.stringify({ updatedAt: now.toISOString(), window, ...attachChanges(overall, districts, findBaseline(history, now)) }, null, 2)
  );

  const nextHistory = appendHistory(history, now, {
    window,
    overall: carriedNames.length ? computeOverall(newlyFetched) : overall,
    districts: newlyFetched,
  });
  await writeFile(historyFile, JSON.stringify(nextHistory, null, 2));

  console.log(
    `[build-realestate] 시세 저장 — ${window.from}부터 ${window.weeks}주 계약분 (${fetchSummary(districts)})`
  );
}

async function main() {
  const now = new Date();

  await mkdir(dataDir, { recursive: true });

  await writeRepresentative(now, representWindow(now));
  await writeRentFiles(now);
  await writeWeekly(now);
  await writeTrend(now);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
