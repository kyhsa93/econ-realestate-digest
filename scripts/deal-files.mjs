import { DISTRICT_SLUGS } from "./district-slugs.mjs";

export const MAX_MONTHS = 3;

export function periodOf(date) {
  const text = String(date ?? "");
  const period = text.slice(0, 4) + text.slice(5, 7);
  return /^\d{6}$/.test(period) ? period : null;
}

function trimDeal({ district: _name, ...deal }) {
  return deal;
}

const byAmount = (deal) => deal.amount10k ?? 0;
const byDeposit = (deal) => deal.deposit10k ?? 0;

export function collectDeals(freshDeals, maxMonths = MAX_MONTHS, valueOf = byAmount) {
  const all = (freshDeals ?? []).map(trimDeal).filter((deal) => periodOf(deal?.date));

  const periods = [...new Set(all.map((deal) => periodOf(deal.date)))].sort().slice(-maxMonths);
  const within = new Set(periods);

  const deals = all
    .filter((deal) => within.has(periodOf(deal.date)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || valueOf(b) - valueOf(a));

  return { periods, deals };
}

export function buildDealFiles(source, now, maxMonths = MAX_MONTHS, valueOf = byAmount) {
  if (!source?.period) return null;

  const byDistrict = new Map();
  for (const deal of Object.values(source?.districts ?? {}).flat()) {
    const name = String(deal?.district ?? "").trim();
    if (!name || !DISTRICT_SLUGS[name]) continue;
    if (!byDistrict.has(name)) byDistrict.set(name, []);
    byDistrict.get(name).push(deal);
  }

  const updatedAt = now.toISOString();
  const files = {};

  for (const name of [...byDistrict.keys()].sort((a, b) => a.localeCompare(b, "ko"))) {
    const { periods, deals } = collectDeals(byDistrict.get(name), maxMonths, valueOf);
    if (!deals.length) continue;

    files[DISTRICT_SLUGS[name]] = { district: name, updatedAt, periods, deals };
  }

  return files;
}

export const dealFileName = (slug) => `deals-${slug}.json`;

export const rentFileName = (slug) => `rents-${slug}.json`;

export function buildRentFiles(source, now, maxMonths = MAX_MONTHS) {
  return buildDealFiles(source, now, maxMonths, byDeposit);
}
