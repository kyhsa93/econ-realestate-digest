import { DISTRICTS } from "./realestate-districts.mjs";
import { dropCancelled, normalizeDeal, normalizeRentDeal } from "./realestate-metrics.mjs";
import { readSlotFile } from "./realestate-raw.mjs";
import { shiftMonth, yearMonthOf } from "./realestate-slots.mjs";

export const SEARCH_MONTHS = 3;

export function recentMonths(now, count = SEARCH_MONTHS) {
  const current = yearMonthOf(now);
  return Array.from({ length: count }, (_, i) => shiftMonth(current, -(count - 1 - i)));
}

async function collect(kind, months, normalize) {
  const byDistrict = new Map();
  let cancelled = 0;

  await Promise.all(
    months.flatMap((yearMonth) =>
      DISTRICTS.map(async ({ code, name }) => {
        const file = await readSlotFile(kind, code, yearMonth);
        if (file?.ok === false || !Array.isArray(file?.items)) return;

        const items = kind === "sale" ? dropCancelled(file.items) : file.items;
        cancelled += file.items.length - items.length;

        const deals = items.map((item) => normalize(item, name)).filter(Boolean);
        if (!deals.length) return;

        if (!byDistrict.has(code)) byDistrict.set(code, []);
        byDistrict.get(code).push(...deals);
      })
    )
  );

  return { byDistrict, cancelled };
}

export async function readDealSource(now, months = recentMonths(now)) {
  const { byDistrict, cancelled } = await collect("sale", months, normalizeDeal);
  return {
    period: months[months.length - 1],
    months,
    cancelled,
    districts: Object.fromEntries(byDistrict),
  };
}

export async function readRentSource(now, months = recentMonths(now)) {
  const { byDistrict } = await collect("rent", months, normalizeRentDeal);
  return {
    period: months[months.length - 1],
    months,
    districts: Object.fromEntries(byDistrict),
  };
}
