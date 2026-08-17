export const WINDOW_MONTHS = 6;

export const MONTH_START_GRACE_DAYS = 3;

export function kstDateParts(date) {
  const text = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const [year, month, day] = text.split("-").map(Number);
  return { year, month, day };
}

export function yearMonthOf(date) {
  const { year, month } = kstDateParts(date);
  return `${year}${String(month).padStart(2, "0")}`;
}

export function shiftMonth(yearMonth, delta) {
  const text = String(yearMonth ?? "");
  if (!/^\d{6}$/.test(text)) return null;

  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  if (month < 1 || month > 12) return null;

  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}${String((index % 12) + 1).padStart(2, "0")}`;
}

export function windowMonths(now, count = WINDOW_MONTHS) {
  const current = yearMonthOf(now);
  return Array.from({ length: count }, (_, i) => shiftMonth(current, -i));
}

export function refreshMonths(now) {
  const current = yearMonthOf(now);
  const months = [current, shiftMonth(current, -1)];
  if (kstDateParts(now).day <= MONTH_START_GRACE_DAYS) months.push(shiftMonth(current, -2));
  return months;
}

export const slotKey = (kind, code, yearMonth) => `${kind}:${code}:${yearMonth}`;

export function parseSlotKey(key) {
  const [kind, code, yearMonth] = String(key).split(":");
  return { kind, code, yearMonth };
}

export function slotStateOf(meta, refreshing) {
  if (refreshing) return "stale";
  if (!meta) return "missing";
  if (meta.ok === false) return "broken";
  if (!Number.isInteger(meta.count)) return "broken";
  if (Number.isInteger(meta.totalCount) && meta.totalCount !== meta.count) return "broken";
  return "frozen";
}

export function planFetch({
  now,
  districts,
  kinds,
  slots = {},
  backfillLimit = Infinity,
  windowSize = WINDOW_MONTHS,
}) {
  const months = windowMonths(now, windowSize);
  const within = new Set(months);
  const refreshing = new Set(refreshMonths(now).filter((month) => within.has(month)));

  const refresh = [];
  const broken = [];
  const missing = [];

  for (const yearMonth of months) {
    for (const kind of kinds) {
      for (const { code } of districts) {
        const state = slotStateOf(slots[slotKey(kind, code, yearMonth)], refreshing.has(yearMonth));
        if (state === "frozen") continue;
        const slot = { kind, code, yearMonth, reason: state };
        if (state === "stale") refresh.push(slot);
        else if (state === "broken") broken.push(slot);
        else missing.push(slot);
      }
    }
  }

  const queued = [...broken, ...missing];
  const backfill = queued.slice(0, backfillLimit);

  return {
    fetch: [...refresh, ...backfill],
    expired: Object.keys(slots)
      .map(parseSlotKey)
      .filter((slot) => !within.has(slot.yearMonth)),
    pending: queued.length - backfill.length,
  };
}

export function planSummary(plan) {
  const countOf = (reason) => plan.fetch.filter((slot) => slot.reason === reason).length;
  const parts = [
    `갱신 ${countOf("stale")}`,
    `재조회 ${countOf("broken")}`,
    `신규 ${countOf("missing")}`,
  ];
  if (plan.pending > 0) parts.push(`대기 ${plan.pending}`);
  if (plan.expired.length > 0) parts.push(`만료 ${plan.expired.length}`);
  return parts.join(" · ");
}
