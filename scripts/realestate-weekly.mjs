import { kstDateParts } from "./realestate-slots.mjs";

const PYEONG_M2 = 3.3058;
export const MOVING_WEEKS = 4;
export const WEEKS_KEPT = 26;

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

export function nextWeek(start, steps = 1) {
  return new Date(Date.parse(`${start}T00:00:00Z`) + steps * 7 * 86_400_000).toISOString().slice(0, 10);
}

export function settledWeek(now) {
  return nextWeek(weekStart(now), -1);
}

function saleStats(rows) {
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

function statsOf(rows) {
  const out = {};
  for (const [key, fn] of Object.entries(STATS)) {
    const value = fn(rows.filter((row) => row.type === key));
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

export function buildWeekly(arrivals, now, { weeksKept = WEEKS_KEPT, movingWeeks = MOVING_WEEKS } = {}) {
  const settled = settledWeek(now);
  const byWeek = groupByWeek(arrivals.filter((row) => weekStart(row.observedOn) <= settled));

  const weeks = [...byWeek.keys()].sort().slice(-weeksKept);
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

  const overall = {};
  for (const week of weeks) {
    const stats = statsOf(byWeek.get(week) ?? []);
    if (stats) overall[week] = stats;
  }

  const districts = {};
  for (const [name, perWeek] of [...districtRows.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko"))) {
    const entry = {};
    for (const week of weeks) {
      const stats = statsOf(movingRows(perWeek, week, movingWeeks));
      if (stats) entry[week] = stats;
    }
    if (Object.keys(entry).length) districts[name] = entry;
  }

  return { weeks, movingWeeks, overall, districts };
}

const PICK = {
  sale: ["avgPricePerPyeong10k"],
  jeonse: ["avgDepositPerPyeong10k"],
  wolse: ["avgDeposit10k", "avgMonthlyRent10k"],
};

export function attachWeeklyChanges(weekly) {
  if (!weekly?.weeks?.length) return weekly;

  const [previous, current] = weekly.weeks.slice(-2);
  if (!previous || !current) return { ...weekly, latestWeek: weekly.weeks.at(-1) };

  const changed = (scope) => {
    const now = scope[current];
    const before = scope[previous];
    if (!now || !before) return scope;

    const next = { ...scope, [current]: { ...now } };
    for (const [kind, fields] of Object.entries(PICK)) {
      if (!now[kind] || !before[kind]) continue;
      const change = {};
      for (const field of fields) {
        const from = before[kind][field];
        const to = now[kind][field];
        if (typeof from !== "number" || typeof to !== "number" || from === 0) continue;
        change[field] = { value10k: to - from, percent: ((to - from) / from) * 100 };
      }
      if (Object.keys(change).length) {
        next[current][kind] = { ...now[kind], change, baselineWeek: previous };
      }
    }
    return next;
  };

  return {
    ...weekly,
    latestWeek: current,
    baselineWeek: previous,
    overall: changed(weekly.overall),
    districts: Object.fromEntries(
      Object.entries(weekly.districts).map(([name, scope]) => [name, changed(scope)])
    ),
  };
}
