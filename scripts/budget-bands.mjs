export const BAND_UNIT = 10_000;
export const BAND_MIN = 30_000;
export const BAND_MAX = 300_000;

export const DEALS_PER_BAND = 6;

export const DEALS_PER_DISTRICT_BAND = 3;

export function bandStart(amount10k) {
  if (!Number.isFinite(amount10k) || amount10k <= 0) return null;
  if (amount10k < BAND_MIN) return 0;
  if (amount10k >= BAND_MAX) return BAND_MAX;
  return Math.floor(amount10k / BAND_UNIT) * BAND_UNIT;
}

export function bandEnd(start) {
  if (start === 0) return BAND_MIN;
  if (start === BAND_MAX) return null;
  return start + BAND_UNIT;
}

function pickRepresentatives(deals, limit = DEALS_PER_BAND) {
  const sorted = [...deals].sort(
    (a, b) => b.date.localeCompare(a.date) || b.amount10k - a.amount10k
  );

  const seen = new Set();
  const picked = [];
  for (const deal of sorted) {
    const key = `${deal.district}|${deal.apt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(deal);
    if (picked.length >= limit) break;
  }
  return picked;
}

function districtCounts(deals, limit = 5) {
  const counts = new Map();
  for (const deal of deals) counts.set(deal.district, (counts.get(deal.district) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

export function buildBands(deals, limit = DEALS_PER_BAND) {
  const byStart = new Map();

  for (const deal of deals ?? []) {
    const start = bandStart(deal?.amount10k);
    if (start === null) continue;
    if (!byStart.has(start)) byStart.set(start, []);
    byStart.get(start).push(deal);
  }

  return [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, list]) => ({
      min10k: start,
      max10k: bandEnd(start),
      count: list.length,
      districts: districtCounts(list),
      deals: pickRepresentatives(list, limit),
    }));
}

export function buildDistrictBands(deals, limit = DEALS_PER_DISTRICT_BAND) {
  const byDistrict = new Map();

  for (const deal of deals ?? []) {
    const name = String(deal?.district ?? "").trim();
    if (!name) continue;
    if (!byDistrict.has(name)) byDistrict.set(name, []);
    byDistrict.get(name).push(deal);
  }

  return Object.fromEntries(
    [...byDistrict.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "ko"))
      .map(([name, list]) => [name, buildBands(list, limit)])
  );
}

export function flattenDistrictMonths(months) {
  return Object.fromEntries(
    Object.entries(months ?? {}).map(([period, byDistrict]) => [
      period,
      Object.values(byDistrict ?? {}).flat(),
    ])
  );
}

export function mergeDistrictMonths(months, limit = DEALS_PER_DISTRICT_BAND * 2) {
  const byDistrict = new Map();

  for (const [period, districts] of Object.entries(months ?? {})) {
    for (const [name, bands] of Object.entries(districts ?? {})) {
      if (!byDistrict.has(name)) byDistrict.set(name, {});
      byDistrict.get(name)[period] = bands;
    }
  }

  return Object.fromEntries(
    [...byDistrict.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "ko"))
      .map(([name, monthsOf]) => [name, mergeBands(monthsOf, limit)])
  );
}

export function mergeBands(months, limit = DEALS_PER_BAND * 2) {
  const byStart = new Map();

  for (const bands of Object.values(months ?? {})) {
    for (const band of bands ?? []) {
      const current = byStart.get(band.min10k);
      if (!current) {
        byStart.set(band.min10k, { ...band, deals: [...band.deals] });
        continue;
      }
      current.count += band.count;
      current.deals.push(...band.deals);
      for (const { name, count } of band.districts ?? []) {
        const found = current.districts.find((d) => d.name === name);
        if (found) found.count += count;
        else current.districts.push({ name, count });
      }
    }
  }

  return [...byStart.values()]
    .sort((a, b) => a.min10k - b.min10k)
    .map((band) => ({
      ...band,
      districts: [...band.districts].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko")).slice(0, 5),
      deals: pickRepresentatives(band.deals, limit),
    }));
}
