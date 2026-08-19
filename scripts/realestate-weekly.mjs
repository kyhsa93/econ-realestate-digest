import { kstDateParts } from "./realestate-slots.mjs";

const PYEONG_M2 = 3.3058;
export const MOVING_WEEKS = 4;
export const WEEKS_KEPT = 26;
export const TREND_MIN_SAMPLE = 5;
export const REPRESENT_WEEKS = 4;
export const FILING_GRACE_DAYS = 30;

export function weekStart(date) {
  const { year, month, day } = typeof date === "string" ? partsOfDate(date) : kstDateParts(date);
  const utc = Date.UTC(year, month - 1, day);
  const weekday = (new Date(utc).getUTCDay() + 6) % 7;
  const monday = new Date(utc - weekday * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

function partsOfDate(text) {
  const [year, month, day] = String(text).split("-").map(Number);
  return { year, month, day };
}

export function firstFullWeek(firstDay) {
  const start = weekStart(firstDay);
  return start === firstDay ? start : nextWeek(start, 1);
}

export function nextWeek(start, steps = 1) {
  return new Date(Date.parse(`${start}T00:00:00Z`) + steps * 7 * 86_400_000).toISOString().slice(0, 10);
}

export function settledWeek(now, graceDays = 0) {
  if (!graceDays) return nextWeek(weekStart(now), -1);
  const parts = kstDateParts(now);
  const cutoff = Date.UTC(parts.year, parts.month - 1, parts.day) - (graceDays + 7) * 86_400_000;
  return weekStart(new Date(cutoff).toISOString().slice(0, 10));
}

const NATIONAL_MIN_M2 = 82;
const NATIONAL_MAX_M2 = 86;

function pricePerPyeong(rows) {
  let amountWon = 0;
  let area = 0;
  for (const row of rows) {
    amountWon += row.amount10k * 10_000;
    area += row.area;
  }
  if (!rows.length || area === 0) return null;
  return {
    avgPricePerPyeong10k: Math.round(((amountWon / area) * PYEONG_M2) / 10_000),
    transactionCount: rows.length,
  };
}

function saleStats(rows) {
  const base = pricePerPyeong(rows);
  if (!base) return null;

  const national = pricePerPyeong(
    rows.filter((row) => row.area >= NATIONAL_MIN_M2 && row.area <= NATIONAL_MAX_M2)
  );
  return national ? { ...base, national84: national } : base;
}

function jeonseStats(rows) {
  let depositWon = 0;
  let area = 0;
  for (const row of rows) {
    depositWon += row.deposit10k * 10_000;
    area += row.area;
  }
  if (!rows.length || area === 0) return null;
  return {
    avgDepositPerPyeong10k: Math.round(((depositWon / area) * PYEONG_M2) / 10_000),
    transactionCount: rows.length,
  };
}

function wolseStats(rows) {
  if (!rows.length) return null;
  const sum = (pick) => rows.reduce((total, row) => total + pick(row), 0);
  return {
    avgDeposit10k: Math.round(sum((row) => row.deposit10k) / rows.length),
    avgMonthlyRent10k: Math.round(sum((row) => row.monthlyRent10k) / rows.length),
    transactionCount: rows.length,
  };
}

const STATS = { sale: saleStats, jeonse: jeonseStats, wolse: wolseStats };

function statsOf(rows, minSample) {
  const out = {};
  for (const [key, fn] of Object.entries(STATS)) {
    const picked = rows.filter((row) => row.type === key);
    if (picked.length < minSample) continue;
    const value = fn(picked);
    if (value) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

export function groupByWeek(arrivals) {
  const weeks = new Map();
  for (const row of arrivals) {
    const week = weekStart(row.observedOn);
    if (!weeks.has(week)) weeks.set(week, []);
    weeks.get(week).push(row);
  }
  return weeks;
}

function movingRows(weeks, week, span) {
  const rows = [];
  for (let back = 0; back < span; back += 1) {
    rows.push(...(weeks.get(nextWeek(week, -back)) ?? []));
  }
  return rows;
}

export function buildWeekly(arrivals, now, { weeksKept = WEEKS_KEPT, movingWeeks = MOVING_WEEKS, minSample = 1, graceDays = 0, from = null } = {}) {
  const settled = settledWeek(now, graceDays);
  // 신고 기한이 남은 주도 함께 낸다 - 그림에 점선으로 이어 붙이는 몫이다. 이번 주는
  // 아직 흐르는 중이라 끝난 주까지만 센다.
  const elapsed = settledWeek(now, 0);
  const byWeek = groupByWeek(arrivals.filter((row) => weekStart(row.observedOn) <= elapsed));

  const known = [...byWeek.keys()].sort().filter((week) => !from || week >= from);
  const weeks = known.filter((week) => week <= settled).slice(-weeksKept);
  const pendingWeeks = known.filter((week) => week > settled);
  if (!weeks.length) return null;

  const districtRows = new Map();
  for (const [week, rows] of byWeek) {
    for (const row of rows) {
      if (!districtRows.has(row.district)) districtRows.set(row.district, new Map());
      const perWeek = districtRows.get(row.district);
      if (!perWeek.has(week)) perWeek.set(week, []);
      perWeek.get(week).push(row);
    }
  }

  const drawn = [...weeks, ...pendingWeeks];

  const overall = {};
  for (const week of drawn) {
    const stats = statsOf(byWeek.get(week) ?? [], minSample);
    if (stats) overall[week] = stats;
  }

  const districts = {};
  for (const [name, perWeek] of [...districtRows.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko"))) {
    const entry = {};
    for (const week of drawn) {
      const stats = statsOf(movingRows(perWeek, week, movingWeeks), minSample);
      if (stats) entry[week] = stats;
    }
    if (Object.keys(entry).length) districts[name] = entry;
  }

  return { weeks, pendingWeeks, movingWeeks, settledWeek: settled, overall, districts };
}
