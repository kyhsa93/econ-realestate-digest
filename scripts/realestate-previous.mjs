export function isPreviousUsable(cache, previousPeriod) {
  return Boolean(cache) && cache.period === previousPeriod && Array.isArray(cache.districts);
}

const METRIC_KEYS = ["sale", "saleNational84", "jeonse", "wolse"];

function pickMetrics(entry) {
  if (!entry) return null;
  const out = {};
  for (const key of METRIC_KEYS) {
    if (entry[key]) out[key] = entry[key];
  }
  return Object.keys(out).length ? out : null;
}

export function attachPrevious(current, previous) {
  if (!previous?.districts?.length) return current;

  const byCode = new Map(previous.districts.map((d) => [d.code, d]));
  const districts = (current.districts ?? []).map((district) => {
    const prev = pickMetrics(byCode.get(district.code));
    return prev ? { ...district, prev } : district;
  });

  const overallPrev = pickMetrics(previous.overall);
  const overall = overallPrev ? { ...current.overall, prev: overallPrev } : current.overall;

  return { ...current, previousPeriod: previous.period, overall, districts };
}
