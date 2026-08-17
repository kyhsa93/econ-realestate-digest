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

export function mergeDeals(existingDeals, period, freshDeals, maxMonths = MAX_MONTHS, valueOf = byAmount) {
  const kept = (existingDeals ?? []).filter((deal) => periodOf(deal?.date) !== period);
  const all = [...kept, ...(freshDeals ?? []).map(trimDeal)].filter((deal) => periodOf(deal?.date));

  const periods = [...new Set(all.map((deal) => periodOf(deal.date)))].sort().slice(-maxMonths);
  const within = new Set(periods);

  const deals = all
    .filter((deal) => within.has(periodOf(deal.date)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || valueOf(b) - valueOf(a));

  return { periods, deals };
}

export function buildDealFiles(source, existingByDistrict, now, maxMonths = MAX_MONTHS, valueOf = byAmount) {
  const period = source?.period;
  if (!period) return null;

  const freshByDistrict = new Map();
  for (const deal of Object.values(source?.districts ?? {}).flat()) {
    const name = String(deal?.district ?? "").trim();
    if (!name || !DISTRICT_SLUGS[name]) continue;
    if (!freshByDistrict.has(name)) freshByDistrict.set(name, []);
    freshByDistrict.get(name).push(deal);
  }

  const names = new Set([...freshByDistrict.keys(), ...Object.keys(existingByDistrict ?? {})]);
  const updatedAt = now.toISOString();
  const files = {};

  for (const name of [...names].sort((a, b) => a.localeCompare(b, "ko"))) {
    const slug = DISTRICT_SLUGS[name];
    if (!slug) continue;

    const { periods, deals } = mergeDeals(
      existingByDistrict?.[name]?.deals,
      period,
      freshByDistrict.get(name) ?? [],
      maxMonths,
      valueOf
    );
    if (!deals.length) continue;

    files[slug] = { district: name, updatedAt, periods, deals };
  }

  return files;
}

export const dealFileName = (slug) => `deals-${slug}.json`;

export const rentFileName = (slug) => `rents-${slug}.json`;

export function buildRentFiles(source, existingByDistrict, now, maxMonths = MAX_MONTHS) {
  return buildDealFiles(source, existingByDistrict, now, maxMonths, byDeposit);
}
